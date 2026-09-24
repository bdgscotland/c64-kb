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
 * `handlers` and `armed_before` read the state at each entry, not those.
 *
 * Two passes: storeCommands() finds the vector values; execCommands() adds
 * an exec checkpoint on each handler they named. An entry is the handler's
 * first instruction, so a $0314 handler's line includes the KERNAL's
 * dispatch at $FF48 (29 cycles) and a $FFFE handler's does not.
 */
import { storedValue, type Hit } from "./monlog.ts";

const VECTORS = { irq_0314: 0x0314, nmi_0318: 0x0318, nmi_fffa: 0xfffa, irq_fffe: 0xfffe } as const;
type VectorName = keyof typeof VECTORS;

export interface Obs {
  id: string;
  basis: "measured-vice";
  rung: 1;
}
export interface VectorWrite extends Obs {
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
  line: number | null;
  cycle: number | null;
  clock: number;
  frame: number;
}
interface HandlerSummary {
  handler: number;
  via: VectorName[];
  entries: number;
  entry_lines: number[];
  armed_before: number[];
}
export interface IrqChain {
  vectors: VectorWrite[];
  arms: Arm[];
  entries: Entry[];
  handlers: HandlerSummary[];
  unknowns: string[];
}

const hex4 = (n: number) => n.toString(16).padStart(4, "0");
const obs = (id: string): Obs => ({ id, basis: "measured-vice", rung: 1 });

export function storeCommands(): string {
  return (
    [
      "trace store 0314 0319",
      "trace store fffa ffff",
      "trace store d011 d012",
      "trace store d01a d01a",
      "trace store dc0d dc0d",
      "trace store dd0d dd0d",
    ].join("\n") + "\n"
  );
}

export function execCommands(handlers: number[]): string {
  return storeCommands() + handlers.map((h) => `trace exec ${hex4(h)} ${hex4(h)}`).join("\n") + "\n";
}

export function handlersFrom(vectors: VectorWrite[]): number[] {
  return [...new Set(vectors.flatMap((v) => (v.value === null ? [] : [v.value])))].sort((a, b) => a - b);
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

class State {
  bytes = new Map<number, number | null>();
  d011: Byte = undefined;
  d012: Byte = undefined;
  lastArm: number | null = null;
  out: IrqChain = { vectors: [], arms: [], entries: [], handlers: [], unknowns: [] };
  armedBefore = new Map<number, Set<number>>();
  via = new Map<number, Set<VectorName>>();
}

function onVector(s: State, h: Hit, v: { name: VectorName; hi: boolean }): void {
  const value = storedValue(h);
  s.bytes.set(h.addr, value);
  const base = VECTORS[v.name];
  const lo = s.bytes.get(base);
  const hi = s.bytes.get(base + 1);
  const full = lo == null || hi == null ? null : (hi << 8) | lo;
  if (value === null)
    s.out.unknowns.push(`${h.mnemonic} $${hex4(h.addr).toUpperCase()} at $${hex4(h.pc)}: byte not logged`);
  const line = h.line === -1 ? null : h.line;
  if (line === null) s.out.unknowns.push(`raster timing not logged for ${v.name} write at $${hex4(h.pc)}`);
  s.out.vectors.push({
    ...obs(`v${s.out.vectors.length}`),
    vector: v.name,
    value: full,
    pc: h.pc,
    clock: h.clock,
    line,
  });
  if (full !== null) s.via.set(full, (s.via.get(full) ?? new Set()).add(v.name));
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

function onEntry(s: State, h: Hit, frameCycles: number, startClock: number): void {
  const frame = Math.floor((h.clock - startClock) / frameCycles);
  const line = h.line === -1 ? null : h.line;
  const cycle = h.cycle === -1 ? null : h.cycle;
  if (line === null) s.out.unknowns.push(`raster timing not logged for handler entry at $${hex4(h.addr)}`);
  s.out.entries.push({
    ...obs(`e${s.out.entries.length}`),
    handler: h.addr,
    line,
    cycle,
    clock: h.clock,
    frame,
  });
  if (s.lastArm !== null) s.armedBefore.set(h.addr, (s.armedBefore.get(h.addr) ?? new Set()).add(s.lastArm));
}

function summarise(s: State): HandlerSummary[] {
  const by = new Map<number, Entry[]>();
  for (const e of s.out.entries) by.set(e.handler, [...(by.get(e.handler) ?? []), e]);
  const sorted = (xs: Iterable<number>) => [...new Set(xs)].sort((a, b) => a - b);
  return [...by.entries()]
    .sort(([a], [b]) => a - b)
    .map(([handler, es]) => ({
      handler,
      via: [...(s.via.get(handler) ?? [])].sort(),
      entries: es.length,
      entry_lines: sorted(es.flatMap((e) => (e.line === null ? [] : [e.line]))),
      armed_before: sorted(s.armedBefore.get(handler) ?? []),
    }));
}

/** A write before the entry clock: update the state, observe nothing. */
function seed(s: State, h: Hit): void {
  if (h.kind !== "store") return;
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

/** Hits with clock < startClock seed the state; the rest are observations. */
export function analyseIrqChain(hits: Iterable<Hit>, frameCycles: number, startClock: number): IrqChain {
  const s = new State();
  for (const h of hits) {
    if (h.clock < startClock) {
      seed(s, h);
      continue;
    }
    if (h.kind === "exec") {
      onEntry(s, h, frameCycles, startClock);
      continue;
    }
    if (h.kind !== "store") continue;
    const v = vectorOf(h.addr);
    if (v) onVector(s, h, v);
    else if (h.addr === 0xd011 || h.addr === 0xd012) onArm(s, h);
  }
  unwrittenBytes(s);
  s.out.handlers = summarise(s);
  return s.out;
}
