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
 * Which vectors an interrupt reads follows the banking: $0314/$0318
 * through the KERNAL when $00 and $01 map it (HIRAM read high, CpuPort),
 * the RAM at $FFFE/$FFFA when they do not. An earlier version ignored the
 * banking and took any vector's value that ran first. Before any store to
 * $00/$01 (a trace without the KERNAL's boot) and after one the trace
 * cannot value, both sets are candidates; the latter is named in
 * `unknowns`.
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
import { CpuPort } from "../claims/units.ts";
import type { RegionTiming } from "../domain/timing.ts";
import { findFrameRef, frameOf, type FrameRef } from "./frames.ts";
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
      "trace store 0000 0001",
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
  /** $00 and $01; null until the trace stores to either (then the power-on values fill the other). */
  port: CpuPort | null = null;
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

  readonly timing: RegionTiming;
  readonly startClock: number;
  /** The hit that anchors frame 0, or the start clock itself when none qualified. */
  readonly ref: FrameRef;
  /** Bytes of every pointer a traced `JMP (pointer)` read. */
  readonly ptrBytes: Set<number>;

  constructor(timing: RegionTiming, startClock: number, ref: FrameRef, pointers: number[]) {
    this.timing = timing;
    this.startClock = startClock;
    this.ref = ref;
    this.ptrBytes = new Set(pointers.flatMap(pointerBytes));
  }

  /** The KERNAL mapped (HIRAM set), banked out, or null when $00/$01 are unknown. */
  mapped(): boolean | null {
    const bits = this.port?.bits ?? null;
    return bits === null ? null : (bits & 2) !== 0;
  }

  candidates(): Candidate[] {
    return candidates((v) => this.vector(v), this.mapped());
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

function onInterrupt(s: State, h: Hit): void {
  s.out.interrupts++;
  if (s.port && s.mapped() === null)
    s.out.unknowns.push(
      `$00/$01 not known at the interrupt at clock ${h.clock}; both the KERNAL and the RAM vectors are candidates`,
    );
  for (const c of s.candidates()) addTo(s.live, c.handler, c.vector);
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

/**
 * $FFFE and $FFFA naming one RAM handler: the entry cannot say whether an
 * IRQ or an NMI ran it. Both stay in via (neither is transient) and the
 * interrupt is named in `unknowns`.
 */
function sharedRamVector(s: State, clock: number, via: Candidate[]): void {
  const hw = via.filter((c) => c.vector === "irq_fffe" || c.vector === "nmi_fffa");
  if (hw.length < 2) return;
  s.out.unknowns.push(
    `interrupt at clock ${clock}: $FFFE and $FFFA both name $${hex4(hw[0]?.handler ?? 0).toUpperCase()}, so IRQ or NMI is not known`,
  );
}

/** An exec of a traced address: an entry only when it is the dispatch of a waiting interrupt. */
function onExec(s: State, h: Hit): void {
  if (!interruptOpen(s, h.clock)) return;
  const via: Candidate[] = s.candidates().filter((c) => c.handler === h.addr);
  if (!via.length) return;
  sharedRamVector(s, s.pending.shift() ?? h.clock, via);
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
    frame: frameOf(h.clock, s.ref, s.timing),
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
/** A store to $00 or $01: the banking from here on. */
function onPort(s: State, h: Hit): void {
  s.port ??= new CpuPort();
  s.port.store(h.addr, storedValue(h));
}

function seed(s: State, h: Hit): void {
  if (h.kind !== "store") return;
  if (h.addr <= 0x0001) onPort(s, h);
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

/** A store that changes the state; an interrupt's push is not one (observeClock handles it). */
function onStore(s: State, h: Hit): void {
  const v = vectorOf(h.addr);
  if (h.addr <= 0x0001) onPort(s, h);
  else if (v) onVector(s, h, v);
  else if (h.addr === 0xd011 || h.addr === 0xd012) onArm(s, h);
}

/**
 * Stores to the bytes of a `JMP (pointer)`, pushes included: a pointer in
 * the stack page can be overwritten by one. VICE logs an interrupt's three
 * pushes against the interrupted instruction, so the byte pushed is not
 * logged (an STA's A is not it): a store to one of the three push
 * addresses ($0100+SP+1 to +3, SP from the interrupt's marker) at its
 * clock leaves the byte null. Any other store at that clock, such as the
 * interrupted STA's own, keeps its value. JSR, PHA and PHP pushes are null
 * already (storedValue). An earlier version skipped the interrupt's push
 * and kept the stale byte; the one after it nulled every page-1 store at
 * the clock, the interrupted instruction's own included.
 */
function trackPointers(s: State, hs: Hit[]): void {
  const pushAddrs = new Set(
    hs.filter(isInterruptPush).flatMap((p) => [1, 2, 3].map((k) => 0x100 | ((p.sp + k) & 0xff))),
  );
  for (const h of hs) {
    if (h.kind !== "store" || !s.ptrBytes.has(h.addr)) continue;
    const pushed = pushAddrs.has(h.addr);
    s.bytes.set(h.addr, pushed ? null : storedValue(h));
    if (pushed && h.clock >= s.startClock)
      s.out.unknowns.push(
        `interrupt at clock ${h.clock} pushed over pointer byte $${hex4(h.addr).toUpperCase()}: value not logged`,
      );
  }
}

/**
 * The hits of one observed clock: the state-changing stores first, then
 * the interrupt's pushes (which read the vectors and banking for the
 * handlers a pass must trace), then the execs. VICE's log order within a
 * clock is not the order of effect. An earlier version handled a push in
 * log order, so a vector or $01 store logged after it at that clock was
 * missed in discovery and the real handler got no checkpoint.
 */
function observeClock(s: State, hs: Hit[]): void {
  const pushes = hs.filter(isInterruptPush);
  trackPointers(s, hs);
  for (const h of hs) if (h.kind === "store" && !isInterruptPush(h)) onStore(s, h);
  for (const h of pushes) onInterrupt(s, h);
  for (const h of hs) if (h.kind === "exec") onExec(s, h);
}

/** Runs of consecutive hits that share a clock. */
function* byClock(all: Hit[]): Generator<[number, Hit[]]> {
  let run: Hit[] = [];
  for (const h of all) {
    if (run.length && run[0]?.clock !== h.clock) {
      yield [run[0]?.clock ?? 0, run];
      run = [];
    }
    run.push(h);
  }
  if (run.length) yield [run[0]?.clock ?? 0, run];
}

/**
 * Hits with clock < startClock seed the state; the rest are observations.
 * VICE logs a $FFFE handler's first exec before the interrupted
 * instruction's own stores and the pushes, all at one clock (measured on
 * bdgscotland/re-irq-dispatch's banked-fffe probe: a PHP's push follows
 * the exec). So at each clock the stores are applied first, then the
 * execs read: a vector or pointer written by the interrupted instruction
 * is the one the dispatch used. An earlier version read hits in log order
 * and took the stale value.
 */
/** A dummy timing for passes that discover handlers only: frame numbers go unused. */
const UNTIMED: RegionTiming = { cycles_per_line: 1, lines_per_frame: 1, cycles_per_frame: 1 };

function walk(hits: Iterable<Hit>, timing: RegionTiming, startClock: number): State {
  const all = [...hits];
  const ref = findFrameRef(all, startClock);
  const s = new State(
    timing,
    startClock,
    ref ?? { clock: startClock, line: 0, cycle: 0 },
    indirectPointers(all),
  );
  if (!ref)
    s.out.unknowns.push(
      `no hit at or after clock ${startClock} logged a raster line and cycle; frames numbered from the start clock`,
    );
  s.pending = all.filter((h) => h.clock >= startClock && isInterruptPush(h)).map((h) => h.clock);
  for (const [clock, hs] of byClock(all)) {
    if (clock >= startClock) observeClock(s, hs);
    else {
      trackPointers(s, hs);
      for (const h of hs) seed(s, h);
    }
  }
  return s;
}

/** Every handler a vector held at an interrupt: the exec checkpoints of the second pass. */
export function liveHandlers(hits: Iterable<Hit>, startClock: number): number[] {
  return sorted(walk(hits, UNTIMED, startClock).live.keys());
}

export function analyseIrqChain(hits: Iterable<Hit>, timing: RegionTiming, startClock: number): IrqChain {
  const s = walk(hits, timing, startClock);
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
