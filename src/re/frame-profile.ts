/**
 * Cycles between two markers in a running program, once per occurrence:
 * the region a game's own timer brackets, or two PCs. A marker is a store
 * of a given value (timer_start's `STA $DC0F` with $11) or an executed PC.
 * The figure is the CPU clock difference between the two hits, badline and
 * sprite stalls included, which is what a CIA timer across the same region
 * counts, give or take the few cycles of the timer writes themselves.
 */
import type { RegionTiming } from "../domain/timing.ts";
import { findFrameRef, frameOf, type FrameRef } from "./frames.ts";
import { DISPATCH_WINDOW, isInterruptPush } from "./interrupts.ts";
import type { Obs } from "./irq-chain.ts";
import { storedValue, type Hit } from "./monlog.ts";

export type Marker = { store: number; value: number } | { pc: number };
export interface Region {
  start: Marker;
  stop: Marker;
}
interface Sample extends Obs {
  cycles: number;
  start_clock: number;
  frame: number;
}
export interface Profile {
  samples: Sample[];
  worst: number | null;
  typical: number | null;
  count: number;
  unpaired: number;
  over_frame: number;
  /** What the run could not know, such as the entry of a PRG with no SYS line. */
  unknowns: string[];
}

const hex4 = (n: number) => n.toString(16).padStart(4, "0");

function command(m: Marker): string {
  return "store" in m
    ? `trace store ${hex4(m.store)} ${hex4(m.store)}`
    : `trace exec ${hex4(m.pc)} ${hex4(m.pc)}`;
}

export function regionCommands(region: Region): string {
  return [...new Set([command(region.start), command(region.stop)])].join("\n") + "\n";
}

function matches(h: Hit, m: Marker): boolean {
  if ("store" in m) return h.kind === "store" && h.addr === m.store && storedValue(h) === m.value;
  return h.kind === "exec" && h.addr === m.pc;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)] ?? null;
}

/** The largest value, by loop: a spread into Math.max overflows the stack past ~100,000 samples. */
function largest(xs: number[]): number | null {
  let m: number | null = null;
  for (const x of xs) if (m === null || x > m) m = x;
  return m;
}

/**
 * A start while another is open replaces it; the replaced start counts in
 * `unpaired`, as does a start still open when the run ends.
 */
export function analyseRegion(
  hits: Iterable<Hit>,
  region: Region,
  timing: RegionTiming,
  startClock: number,
): Profile {
  const all = [...hits];
  const ref = findFrameRef(all, startClock);
  const unknowns: string[] = ref
    ? []
    : [
        `no hit at or after clock ${startClock} logged a raster line and cycle; frames numbered from the start clock`,
      ];
  const frameRef = ref ?? { clock: startClock, line: 0, cycle: 0 };
  const samples: Sample[] = [];
  let open: number | null = null;
  let overwritten = 0;
  for (const h of all) {
    if (matches(h, region.start)) {
      if (open !== null) overwritten++;
      open = h.clock;
    } else if (open !== null && matches(h, region.stop)) {
      samples.push({
        id: `s${samples.length}`,
        basis: "measured-vice",
        rung: 1,
        cycles: h.clock - open,
        start_clock: open,
        frame: frameOf(open, frameRef, timing),
      });
      open = null;
    }
  }
  const cycles = samples.map((s) => s.cycles);
  return {
    samples,
    worst: largest(cycles),
    typical: median(cycles),
    count: samples.length,
    unpaired: overwritten + (open === null ? 0 : 1),
    over_frame: cycles.filter((c) => c > timing.cycles_per_frame).length,
    unknowns,
  };
}

// ---------------------------------------------------------------------------
// Frame mode: where each raster-aligned frame's cycles went, with no timer in
// the program. A studied game brackets nothing with a CIA timer, so region
// mode has no markers to pair; frame mode reads the interrupts themselves.
//
// An interrupt runs from the start of its 7-cycle sequence to the end of its
// RTI (6 cycles). VICE logs the three pushes at the clock the sequence ends,
// with the SP after them, and an RTI's exec hit at its first cycle with the
// SP before it (measured on kickassembler/irq-chain in VICE x64sc 3.10: last
// JMP $0873 at clock 2990233, pushes and $FF48 at 2990243, SP $F3; RTI at
// $EA86 at 2990389 with SP $F3, the next JMP at 2990395). So an interrupt
// is [push - 7, RTI + 6), and its RTI is the first RTI executed after the
// push with the push's SP: an NMI inside an IRQ pushes lower and returns
// first. Its cost includes the dispatch: 7 cycles of sequence, the KERNAL's
// $FF48 stub (29 cycles) for a $0314 handler, and a JMP (pointer)'s 5.
// ---------------------------------------------------------------------------

/** Cycles of the interrupt sequence before VICE logs its pushes, and of RTI (6502 timings, confirmed by the trace above). */
const INTERRUPT_CYCLES = 7;
const RTI_CYCLES = 6;
/** Instructions at the wait's stack depth searched for its loop branch. */
const WAIT_SEARCH = 64;

/** What frame mode needs of an irq-chain entry. */
export interface FrameEntry {
  handler: number;
  target: number | null;
  clock: number;
  line: number | null;
}
/** A wait loop: its first instruction and the instruction its loop branch falls through to. */
export interface Wait {
  pc: number;
  exit: number;
}
export interface Stat {
  worst: number | null;
  typical: number | null;
  least: number | null;
}
interface Part {
  handler: number;
  /** A JMP (pointer) handler's target at these entries, else null. */
  target: number | null;
  /** The n-th entry of this handler (and target) in its frame, from 0. */
  slot: number;
  entries: number;
  entry_lines: number[];
  /** Interrupt sequence to the end of RTI, less any interrupt nested inside. */
  cost: Stat;
  /** Interrupt sequence to the handler's first instruction. */
  dispatch: Stat;
}
interface FrameRow extends Obs {
  frame: number;
  start_clock: number;
  /** Cycles inside interrupts, nested ones once. */
  handlers: number;
  /** Cycles in the wait loop outside interrupts; null without a wait. */
  idle: number | null;
  /** frame - handlers - idle; null without a wait. */
  main: number | null;
  /** frame - handlers: main and idle together. */
  rest: number;
}
export interface FrameBudget {
  mode: "frame";
  frames: FrameRow[];
  parts: Part[];
  per_frame: { handlers: Stat; rest: Stat; main: Stat | null; idle: Stat | null };
  /** The `**Measured frame:**` figures: frame - idle per frame; null without a wait. */
  measured_frame: string | null;
  wait: Wait | null;
  interrupts: number;
  unreturned: number;
  unknowns: string[];
}
export interface FrameOpts {
  timing: RegionTiming;
  startClock: number;
  region: "pal" | "ntsc";
  /** Addresses of the RTIs the program executes (rtiAddresses on a full trace). */
  rtis: number[];
  wait: Wait | null;
}

interface Span {
  start: number;
  end: number | null;
  sp: number;
  children: Span[];
  top: boolean;
  entry: FrameEntry | null;
}

const hexUp = (n: number) => "$" + n.toString(16).toUpperCase().padStart(4, "0");

/** Every RTI address executed at or after `startClock`: the exec checkpoints frame mode adds. */
export function rtiAddresses(hits: Iterable<Hit>, startClock: number): number[] {
  const out = new Set<number>();
  for (const h of hits)
    if (h.kind === "exec" && h.mnemonic === "RTI" && h.clock >= startClock) out.add(h.addr);
  return [...out].sort((a, b) => a - b);
}

const BRANCH = /^B(CC|CS|EQ|NE|MI|PL|VC|VS)$/;

/** A conditional branch's target, from the exec hit's operand; else null. */
function branchTarget(h: Hit): number | null {
  const m = BRANCH.test(h.mnemonic) ? /^\$([0-9A-F]{4})$/i.exec(h.operand) : null;
  return m ? parseInt(m[1] ?? "", 16) : null;
}

/**
 * The exit of the wait loop that starts at `pc`: the instruction after the
 * first conditional branch back to between `pc` and itself, executed at the
 * stack depth `pc` ran at (an interrupt inside the loop runs deeper and is
 * skipped). Null when `pc` never ran or no such branch follows within
 * WAIT_SEARCH instructions (a loop closed by JMP, say).
 */
export function waitExit(hits: Hit[], pc: number): number | null {
  const i = hits.findIndex((h) => h.kind === "exec" && h.addr === pc);
  const sp = hits[i]?.sp;
  if (sp === undefined) return null;
  let seen = 0;
  for (let k = i; k < hits.length && seen < WAIT_SEARCH; k++) {
    const h = hits[k];
    if (h?.kind !== "exec" || h.sp !== sp) continue;
    seen++;
    const t = branchTarget(h);
    if (t !== null && t >= pc && t <= h.pc) return h.pc + 2;
  }
  return null;
}

const execLine = (a: number) => `trace exec ${hex4(a)} ${hex4(a)}`;

/** The final pass's extra checkpoints: every RTI, and the wait's start and exit. */
export function frameCommands(rtis: number[], wait: Wait | null): string {
  const lines = [...rtis, ...(wait ? [wait.pc, wait.exit] : [])].map(execLine);
  return [...new Set(lines)].map((l) => l + "\n").join("");
}

interface Event {
  clock: number;
  /** RTIs sort before pushes at one clock: an RTI cannot close an interrupt pushed at its own clock. */
  kind: 0 | 1;
  sp: number;
}

function events(hits: Hit[], rtis: Set<number>, startClock: number): Event[] {
  const out = new Map<string, Event>();
  for (const h of hits) {
    if (h.clock < startClock) continue;
    let kind: 0 | 1 | null = null;
    if (isInterruptPush(h)) kind = 1;
    else if (h.kind === "exec" && h.mnemonic === "RTI" && rtis.has(h.addr)) kind = 0;
    // One key per event: two checkpoints on one address log the same hit twice.
    if (kind !== null) out.set(`${h.clock}:${kind}:${h.sp}`, { clock: h.clock, kind, sp: h.sp });
  }
  return [...out.values()].sort((a, b) => a.clock - b.clock || a.kind - b.kind);
}

/** Interrupts from their pushes, each closed by the first RTI at its SP; nesting from the open stack. */
function interruptSpans(hits: Hit[], o: FrameOpts): Span[] {
  const spans: Span[] = [];
  const open: Span[] = [];
  for (const e of events(hits, new Set(o.rtis), o.startClock)) {
    if (e.kind === 1) {
      const parent = open.at(-1);
      const s: Span = {
        start: e.clock - INTERRUPT_CYCLES,
        end: null,
        sp: e.sp,
        children: [],
        top: !parent,
        entry: null,
      };
      parent?.children.push(s);
      spans.push(s);
      open.push(s);
      continue;
    }
    const i = open.findLastIndex((s) => s.sp === e.sp);
    const s = open[i];
    if (!s) continue; // an RTI of an interrupt raised before the start, or RTI used as a jump
    s.end = e.clock + RTI_CYCLES;
    open.splice(i);
  }
  return spans;
}

/** Each interrupt's handler entry: the first unused one within DISPATCH_WINDOW of its push. */
function matchEntries(spans: Span[], entries: FrameEntry[]): void {
  const es = [...entries].sort((a, b) => a.clock - b.clock);
  let j = 0;
  for (const s of spans) {
    const pushed = s.start + INTERRUPT_CYCLES;
    while (j < es.length && (es[j]?.clock ?? 0) < pushed) j++;
    const e = es[j];
    if (e && e.clock <= pushed + DISPATCH_WINDOW) {
      s.entry = e;
      j++;
    }
  }
}

const length = (s: Span): number => (s.end === null ? 0 : s.end - s.start);
const selfCost = (s: Span): number | null =>
  s.end === null ? null : length(s) - s.children.reduce((n, c) => n + length(c), 0);
const overlap = (a0: number, a1: number, b0: number, b1: number): number =>
  Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

function stat(xs: number[]): Stat {
  let least: number | null = null;
  for (const x of xs) if (least === null || x < least) least = x;
  return { worst: largest(xs), typical: median(xs), least };
}

/** The complete frames in the trace: from the first that starts at or after the start clock to the last that ends by the last hit. */
function frameRange(hits: Hit[], ref: FrameRef, o: FrameOpts): { zero: number; first: number; last: number } {
  const F = o.timing.cycles_per_frame;
  const zero = ref.clock - (ref.line * o.timing.cycles_per_line + ref.cycle);
  const lastClock = hits.reduce((m, h) => Math.max(m, h.clock), 0);
  return { zero, first: Math.ceil((o.startClock - zero) / F), last: Math.floor((lastClock - zero) / F) - 1 };
}

/** Wait intervals: each exec of the wait's pc to the next exec of its exit at the same SP. */
function waitIntervals(hits: Hit[], wait: Wait, startClock: number): [number, number][] {
  const out: [number, number][] = [];
  let open: Hit | null = null;
  for (const h of hits) {
    if (h.kind !== "exec" || h.clock < startClock) continue;
    if (h.addr === wait.pc && open === null) open = h;
    else if (h.addr === wait.exit && open !== null && h.sp === open.sp) {
      out.push([open.clock, h.clock]);
      open = null;
    }
  }
  return out;
}

/** Cycles of [a, b) inside frame [f0, f1) that no top-level interrupt took. */
function outsideInterrupts([a, b]: [number, number], [f0, f1]: [number, number], tops: Span[]): number {
  const lo = Math.max(a, f0);
  const hi = Math.min(b, f1);
  if (hi <= lo) return 0;
  return hi - lo - tops.reduce((n, s) => n + (s.end === null ? 0 : overlap(s.start, s.end, lo, hi)), 0);
}

function frameRows(
  spans: Span[],
  waits: [number, number][] | null,
  range: { zero: number; first: number; last: number },
  F: number,
): FrameRow[] {
  const tops = spans.filter((s) => s.top && s.end !== null);
  const rows: FrameRow[] = [];
  for (let k = range.first; k <= range.last; k++) {
    const f0 = range.zero + k * F;
    const f1 = f0 + F;
    const here = tops.filter((s) => s.start < f1 && (s.end ?? 0) > f0);
    const handlers = here.reduce((n, s) => n + overlap(s.start, s.end ?? 0, f0, f1), 0);
    const idle = waits
      ? waits.reduce((n, [a, b]) => (b > f0 && a < f1 ? n + outsideInterrupts([a, b], [f0, f1], here) : n), 0)
      : null;
    rows.push({
      id: `f${rows.length}`,
      basis: "measured-vice",
      rung: 1,
      frame: k,
      start_clock: f0,
      handlers,
      idle,
      main: idle === null ? null : F - handlers - idle,
      rest: F - handlers,
    });
  }
  return rows;
}

/** Parts: each handler (and JMP (pointer) target) by its order of entry within the frame. */
function partsOf(spans: Span[], frame: (clock: number) => number): Part[] {
  const groups = new Map<
    string,
    {
      handler: number;
      target: number | null;
      slot: number;
      cost: number[];
      dispatch: number[];
      lines: Set<number>;
      entries: number;
    }
  >();
  const seen = new Map<string, number>();
  for (const s of spans) {
    const e = s.entry;
    if (!e) continue;
    const who = `${e.handler}:${e.target ?? ""}`;
    const perFrame = `${who}@${frame(s.start)}`;
    const slot = seen.get(perFrame) ?? 0;
    seen.set(perFrame, slot + 1);
    const key = `${who}#${slot}`;
    const g = groups.get(key) ?? {
      handler: e.handler,
      target: e.target,
      slot,
      cost: [],
      dispatch: [],
      lines: new Set(),
      entries: 0,
    };
    g.entries++;
    const c = selfCost(s);
    if (c !== null) g.cost.push(c);
    g.dispatch.push(e.clock - s.start);
    if (e.line !== null) g.lines.add(e.line);
    groups.set(key, g);
  }
  return [...groups.values()]
    .sort((a, b) => a.handler - b.handler || (a.target ?? -1) - (b.target ?? -1) || a.slot - b.slot)
    .map((g) => ({
      handler: g.handler,
      target: g.target,
      slot: g.slot,
      entries: g.entries,
      entry_lines: [...g.lines].sort((a, b) => a - b),
      cost: stat(g.cost),
      dispatch: stat(g.dispatch),
    }));
}

function frameUnknowns(spans: Span[], o: FrameOpts, ref: FrameRef | null): string[] {
  const out: string[] = [];
  if (!ref)
    out.push(
      `no hit at or after clock ${o.startClock} logged a raster line and cycle; frames numbered from the start clock`,
    );
  const unreturned = spans.filter((s) => s.end === null).length;
  if (unreturned)
    out.push(
      `${unreturned} of ${spans.length} interrupts reached no traced RTI at their stack depth; their cycles are left out of the sums`,
    );
  const lost = spans.filter((s) => !s.entry).length;
  if (lost)
    out.push(
      `${lost} of ${spans.length} interrupts entered no traced handler; they count in handlers but in no part`,
    );
  if (!o.wait)
    out.push(
      "no wait loop (wait_pc not given, or its exit not found), so main and idle are one figure (rest) and there is no measured_frame",
    );
  return out;
}

/**
 * Per raster-aligned frame: cycles inside interrupts, and with a wait loop,
 * idle (the loop's cycles outside interrupts) and main (the rest). Per part:
 * each handler entry's own cost, nested interrupts taken out. Frames are the
 * complete ones between the start clock and the last hit.
 */
export function analyseFrames(hits: Hit[], entries: FrameEntry[], o: FrameOpts): FrameBudget {
  const F = o.timing.cycles_per_frame;
  const found = findFrameRef(hits, o.startClock);
  const ref = found ?? { clock: o.startClock, line: 0, cycle: 0 };
  const spans = interruptSpans(hits, o);
  matchEntries(spans, entries);
  const waits = o.wait ? waitIntervals(hits, o.wait, o.startClock) : null;
  const frames = frameRows(spans, waits, frameRange(hits, ref, o), F);
  const col = (k: "idle" | "main") => (o.wait ? stat(frames.map((f) => f[k] ?? 0)) : null);
  const busy = stat(frames.map((f) => F - (f.idle ?? 0)));
  return {
    mode: "frame",
    frames,
    parts: partsOf(spans, (c) => frameOf(c, ref, o.timing)),
    per_frame: {
      handlers: stat(frames.map((f) => f.handlers)),
      rest: stat(frames.map((f) => f.rest)),
      main: col("main"),
      idle: col("idle"),
    },
    measured_frame:
      o.wait && frames.length ? `play ${o.region} worst=${busy.worst} typical=${busy.typical}` : null,
    wait: o.wait,
    interrupts: spans.length,
    unreturned: spans.filter((s) => s.end === null).length,
    unknowns: frameUnknowns(spans, o, found),
  };
}

export const waitLabel = (w: Wait): string => `${hexUp(w.pc)} to ${hexUp(w.exit)}`;
