/**
 * The interrupt chain of a running program, from a monitor trace: which
 * handlers the IRQ and NMI vectors point at over time, which raster line
 * each write to $D012/$D011 arms, and where each handler is entered.
 * Observations only: a byte the trace cannot value (a read-modify-write of
 * $D012, a vector whose other byte was never written) is null and named in
 * `unknowns`.
 *
 * Hits before the entry clock (the KERNAL's boot, the BASIC stub) are not
 * observations, but they seed the state: the $D011 and vector bytes the
 * KERNAL wrote at power-on are known when the program's first write lands.
 *
 * Every write is an observation of the state right after it. A program
 * that sets a vector low byte then high byte (or $D012 then $D011) leaves
 * one observation of the mixed value in between: in `vectors` a handler
 * address that was never meant, in `arms` a line that was never meant.
 * A vector value no interrupt ever found is listed in `transient`, not as
 * a handler; `armed_before` reads the state at each entry.
 *
 * Two passes. storeCommands() traces the vectors and the stack, which
 * finds each interrupt (src/re/interrupts.ts) and the handlers the vectors
 * held at that moment; execCommands() adds an exec checkpoint on each. An
 * entry is the first of those handlers executed after an interrupt, so an
 * address the program reaches any other way (an IRQ exit that falls into
 * an `nmi: rti`) is not one. An entry is the handler's first instruction,
 * so a $0314 handler's line includes the KERNAL's dispatch at $FF48 (29
 * cycles) and a $FFFE handler's does not.
 *
 * A handler whose first instruction is `JMP (pointer)` hides a chain that
 * rewrites the pointer, not the vector (Commando: $4134 JMP ($0406), five
 * parts a frame). Each entry names the pointer's value at that moment
 * (`target`) and the handler's `dispatch` counts entries per target. The
 * pointer is read from the entry's exec hit; when pass B finds one, a third
 * pass adds stores to its two bytes (indirectPointers). The bytes are read
 * with the 6502's page wrap: JMP ($xxFF) takes the high byte from $xx00.
 *
 * An earlier version put an exec checkpoint on every value a vector ever
 * held and counted every execution as an entry: on
 * kickassembler/sprite-multiplex-game it reported 2,338 NMI entries (the
 * IRQ exit's RTI) and on kickassembler/raster-bars 11 handlers for 10 bars,
 * one of them a TAX inside handler 0 (#66).
 */
import { storedValue, type Hit } from "./monlog.ts";
import {
  candidates,
  DISPATCH_WINDOW,
  isInterruptPush,
  VECTORS,
  type Candidate,
  type VectorName,
} from "./interrupts.ts";

export interface Obs {
  id: string;
  basis: "measured-vice";
  rung: 1;
}
interface VectorWrite extends Obs {
  vector: VectorName;
  value: number | null;
  pc: number;
  clock: number;
  line: number | null;
}
interface Arm extends Obs {
  line: number | null;
  pc: number;
  clock: number;
  at_line: number | null;
}
interface Entry extends Obs {
  handler: number;
  /** For a handler that is `JMP (pointer)`: the pointer's value at this entry, else null. */
  target: number | null;
  line: number | null;
  cycle: number | null;
  clock: number;
  frame: number;
}
interface Counts {
  entries: number;
  entry_lines: number[];
  armed_before: number[];
}
interface HandlerSummary extends Counts {
  handler: number;
  via: VectorName[];
  /** The pointer when the handler's first instruction is `JMP (pointer)`, else null. */
  pointer: number | null;
  /** Entries by the address the pointer named at each: the sub-handlers. */
  dispatch: (Counts & { target: number })[];
}
/** A vector value some write left but no interrupt ever found there. */
interface Transient {
  vector: VectorName;
  value: number;
  writes: number;
}
export interface IrqChain {
  /** Interrupts raised after the entry, from the stack pushes; BRK is not one. */
  interrupts: number;
  vectors: VectorWrite[];
  arms: Arm[];
  entries: Entry[];
  handlers: HandlerSummary[];
  transient: Transient[];
  unknowns: string[];
}

const hex4 = (n: number) => n.toString(16).padStart(4, "0");
const obs = (id: string): Obs => ({ id, basis: "measured-vice", rung: 1 });

export function storeCommands(): string {
  return (
    [
      "trace store 0100 01ff",
      "trace store 0314 0319",
      "trace store fffa ffff",
      "trace store d011 d012",
      "trace store d01a d01a",
      "trace store dc0d dc0d",
      "trace store dd0d dd0d",
    ].join("\n") + "\n"
  );
}

/** The two bytes JMP (p) reads: the 6502 takes the high byte from the same page ($xxFF, then $xx00). */
const pointerBytes = (p: number): [number, number] => [p, (p & 0xff00) | ((p + 1) & 0xff)];

/** Pass B's commands: the stores, an exec checkpoint on each handler, and each pointer's two bytes. */
export function execCommands(handlers: number[], pointers: number[] = []): string {
  const ptrs = pointers.flatMap((p) => {
    const [lo, hi] = pointerBytes(p);
    return hi === lo + 1
      ? [`trace store ${hex4(lo)} ${hex4(hi)}`]
      : [lo, hi].map((b) => `trace store ${hex4(b)} ${hex4(b)}`);
  });
  const execs = handlers.map((h) => `trace exec ${hex4(h)} ${hex4(h)}`);
  return storeCommands() + [...ptrs, ...execs].map((l) => l + "\n").join("");
}

/** The pointer a `JMP ($xxxx)` reads, from the exec hit's operand; else null. */
function pointerOf(h: Hit): number | null {
  const m = h.mnemonic === "JMP" ? /^\(\$([0-9A-F]{4})\)$/i.exec(h.operand) : null;
  return m ? parseInt(m[1] ?? "", 16) : null;
}

/** Every pointer a traced `JMP ($xxxx)` read: the stores the next pass must trace. */
export function indirectPointers(hits: Iterable<Hit>): number[] {
  const out = new Set<number>();
  for (const h of hits) {
    const p = h.kind === "exec" ? pointerOf(h) : null;
    if (p !== null) out.add(p);
  }
  return [...out].sort((a, b) => a - b);
}

function vectorOf(addr: number): { name: VectorName; hi: boolean } | null {
  for (const [name, base] of Object.entries(VECTORS) as [VectorName, number][]) {
    if (addr === base) return { name, hi: false };
    if (addr === base + 1) return { name, hi: true };
  }
  return null;
}

/** A register byte: undefined never written, null written but not logged. */
type Byte = number | null | undefined;

const addTo = <K, V>(m: Map<K, Set<V>>, k: K, v: V) => m.set(k, (m.get(k) ?? new Set()).add(v));

class State {
  bytes = new Map<number, number | null>();
  d011: Byte = undefined;
  d012: Byte = undefined;
  lastArm: number | null = null;
  out: IrqChain = {
    interrupts: 0,
    vectors: [],
    arms: [],
    entries: [],
    handlers: [],
    transient: [],
    unknowns: [],
  };
  /** The armed line at each entry, by entry index. */
  entryArm: (number | null)[] = [];
  /** Handler -> the pointer its `JMP (pointer)` reads. */
  pointer = new Map<number, number>();
  /** Handler -> the vectors that held it at an interrupt. */
  live = new Map<number, Set<VectorName>>();
  /** Handler -> the vectors an entry into it was dispatched through. */
  entered = new Map<number, Set<VectorName>>();
  /** Clocks of the interrupts not yet matched to an entry, oldest first. */
  pending: number[] = [];
  unmatched = 0;

  readonly frameCycles: number;
  readonly startClock: number;
  /** Bytes of every pointer a traced `JMP (pointer)` read. */
  readonly ptrBytes: Set<number>;

  constructor(frameCycles: number, startClock: number, pointers: number[]) {
    this.frameCycles = frameCycles;
    this.startClock = startClock;
    this.ptrBytes = new Set(pointers.flatMap(pointerBytes));
  }

  vector(name: VectorName): number | null {
    const lo = this.bytes.get(VECTORS[name]);
    const hi = this.bytes.get(VECTORS[name] + 1);
    return lo == null || hi == null ? null : (hi << 8) | lo;
  }
}

function onVector(s: State, h: Hit, v: { name: VectorName; hi: boolean }): void {
  const value = storedValue(h);
  s.bytes.set(h.addr, value);
  if (value === null)
    s.out.unknowns.push(`${h.mnemonic} $${hex4(h.addr).toUpperCase()} at $${hex4(h.pc)}: byte not logged`);
  const line = h.line === -1 ? null : h.line;
  if (line === null) s.out.unknowns.push(`raster timing not logged for ${v.name} write at $${hex4(h.pc)}`);
  s.out.vectors.push({
    ...obs(`v${s.out.vectors.length}`),
    vector: v.name,
    value: s.vector(v.name),
    pc: h.pc,
    clock: h.clock,
    line,
  });
}

function setArm(s: State, h: Hit): number | null {
  const value = storedValue(h);
  if (h.addr === 0xd011) s.d011 = value;
  else s.d012 = value;
  return value;
}

function armLine(s: State): number | null {
  return s.d011 == null || s.d012 == null ? null : ((s.d011 & 0x80) << 1) | s.d012;
}

function onArm(s: State, h: Hit): void {
  const value = setArm(s, h);
  if (value === null)
    s.out.unknowns.push(`${h.mnemonic} $${hex4(h.addr).toUpperCase()} at $${hex4(h.pc)}: value not logged`);
  for (const [reg, v] of [
    ["$D011", s.d011],
    ["$D012", s.d012],
  ] as const)
    if (v === undefined)
      s.out.unknowns.push(
        `arm write at $${hex4(h.pc)}: ${reg} never written before it, so the armed line is unknown`,
      );
  const line = armLine(s);
  s.lastArm = line;
  const at_line = h.line === -1 ? null : h.line;
  if (at_line === null) s.out.unknowns.push(`raster timing not logged for arm write at $${hex4(h.pc)}`);
  s.out.arms.push({ ...obs(`a${s.out.arms.length}`), line, pc: h.pc, clock: h.clock, at_line });
}

function onInterrupt(s: State): void {
  s.out.interrupts++;
  for (const c of candidates((v) => s.vector(v))) addTo(s.live, c.handler, c.vector);
}

/** Is an interrupt waiting whose window holds this clock? Older ones are dropped as unmatched. */
function interruptOpen(s: State, clock: number): boolean {
  while (s.pending.length && (s.pending[0] ?? 0) < clock - DISPATCH_WINDOW) {
    s.pending.shift();
    s.unmatched++;
  }
  const t = s.pending[0];
  return t !== undefined && t <= clock;
}

/** The value a `JMP (pointer)` handler jumps through at this entry; null when unknown. */
function targetOf(s: State, h: Hit, p: number | null): number | null {
  if (p === null) return null;
  const [lo, hi] = pointerBytes(p).map((b) => s.bytes.get(b));
  if (lo != null && hi != null) return (hi << 8) | lo;
  s.out.unknowns.push(
    `pointer $${hex4(p).toUpperCase()} not known at the entry at clock ${h.clock}, so its target is unknown`,
  );
  return null;
}

/** An exec of a traced address: an entry only when it is the dispatch of a waiting interrupt. */
function onExec(s: State, h: Hit): void {
  if (!interruptOpen(s, h.clock)) return;
  const via: Candidate[] = candidates((v) => s.vector(v)).filter((c) => c.handler === h.addr);
  if (!via.length) return;
  s.pending.shift();
  for (const c of via) addTo(s.entered, h.addr, c.vector);
  const line = h.line === -1 ? null : h.line;
  const cycle = h.cycle === -1 ? null : h.cycle;
  if (line === null) s.out.unknowns.push(`raster timing not logged for handler entry at $${hex4(h.addr)}`);
  const p = pointerOf(h);
  if (p !== null) s.pointer.set(h.addr, p);
  s.out.entries.push({
    ...obs(`e${s.out.entries.length}`),
    handler: h.addr,
    target: targetOf(s, h, p),
    line,
    cycle,
    clock: h.clock,
    frame: Math.floor((h.clock - s.startClock) / s.frameCycles),
  });
  s.entryArm.push(s.lastArm);
}

const sorted = <T extends number | string>(xs: Iterable<T>): T[] =>
  [...new Set(xs)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/** Values the program wrote to a vector that an interrupt later found there. */
function installed(s: State): number[] {
  return s.out.vectors.flatMap((v) =>
    v.value !== null && s.live.get(v.value)?.has(v.vector) ? [v.value] : [],
  );
}

/** Entry indices grouped by a key, in key order; entries whose key is null are left out. */
function group(s: State, key: (e: Entry) => number | null, seed: number[] = []): [number, number[]][] {
  const by = new Map<number, number[]>(seed.map((k) => [k, []]));
  s.out.entries.forEach((e, i) => {
    const k = key(e);
    if (k !== null) by.set(k, [...(by.get(k) ?? []), i]);
  });
  return [...by.entries()].sort(([a], [b]) => a - b);
}

function counts(s: State, is: number[]): Counts {
  return {
    entries: is.length,
    entry_lines: sorted(is.flatMap((i) => s.out.entries[i]?.line ?? [])),
    armed_before: sorted(is.flatMap((i) => s.entryArm[i] ?? [])),
  };
}

/** Every handler entered, and every handler the program installed that no interrupt entered. */
function summarise(s: State): HandlerSummary[] {
  return group(s, (e) => e.handler, installed(s)).map(([handler, is]) => ({
    handler,
    via: sorted((is.length ? s.entered : s.live).get(handler) ?? []),
    ...counts(s, is),
    pointer: s.pointer.get(handler) ?? null,
    dispatch: group(s, (e) => (e.handler === handler ? e.target : null)).map(([target, ts]) => ({
      target,
      ...counts(s, ts),
    })),
  }));
}

function transients(s: State): Transient[] {
  const out = new Map<string, Transient>();
  for (const v of s.out.vectors) {
    if (v.value === null || s.live.get(v.value)?.has(v.vector)) continue;
    const key = `${v.vector}:${v.value}`;
    const t = out.get(key) ?? { vector: v.vector, value: v.value, writes: 0 };
    t.writes++;
    out.set(key, t);
  }
  return [...out.values()].sort((a, b) => a.value - b.value);
}

/** A write before the entry clock: update the state, observe nothing. */
function seed(s: State, h: Hit): void {
  if (h.kind !== "store") return;
  if (s.ptrBytes.has(h.addr)) s.bytes.set(h.addr, storedValue(h));
  if (vectorOf(h.addr)) s.bytes.set(h.addr, storedValue(h));
  else if (h.addr === 0xd011 || h.addr === 0xd012) setArm(s, h);
}

/** A vector with an observation but a byte never written by the end of the trace. */
function unwrittenBytes(s: State): void {
  const seen = new Set(s.out.vectors.map((v) => v.vector));
  for (const name of seen) {
    const base = VECTORS[name];
    for (const addr of [base, base + 1])
      if (!s.bytes.has(addr))
        s.out.unknowns.push(
          `${name}: $${hex4(addr).toUpperCase()} never written, so the handler address is unknown`,
        );
  }
}

function onStore(s: State, h: Hit): void {
  if (s.ptrBytes.has(h.addr)) s.bytes.set(h.addr, storedValue(h));
  const v = vectorOf(h.addr);
  if (isInterruptPush(h)) onInterrupt(s);
  else if (v) onVector(s, h, v);
  else if (h.addr === 0xd011 || h.addr === 0xd012) onArm(s, h);
}

/**
 * Hits with clock < startClock seed the state; the rest are observations.
 * VICE logs a $FFFE handler's first exec before the pushes of the interrupt
 * that entered it, at the same clock, so the interrupts are found first.
 */
function walk(hits: Iterable<Hit>, frameCycles: number, startClock: number): State {
  const all = [...hits];
  const s = new State(frameCycles, startClock, indirectPointers(all));
  s.pending = all.filter((h) => h.clock >= startClock && isInterruptPush(h)).map((h) => h.clock);
  for (const h of all) {
    if (h.clock < startClock) seed(s, h);
    else if (h.kind === "exec") onExec(s, h);
    else if (h.kind === "store") onStore(s, h);
  }
  return s;
}

/** Every handler a vector held at an interrupt: the exec checkpoints of the second pass. */
export function liveHandlers(hits: Iterable<Hit>, startClock: number): number[] {
  return sorted(walk(hits, 1, startClock).live.keys());
}

export function analyseIrqChain(hits: Iterable<Hit>, frameCycles: number, startClock: number): IrqChain {
  const s = walk(hits, frameCycles, startClock);
  const unmatched = s.unmatched + s.pending.length;
  if (unmatched)
    s.out.unknowns.push(
      `${unmatched} of ${s.out.interrupts} interrupts entered no traced handler within ${DISPATCH_WINDOW} cycles`,
    );
  unwrittenBytes(s);
  s.out.handlers = summarise(s);
  s.out.transient = transients(s);
  return s.out;
}
