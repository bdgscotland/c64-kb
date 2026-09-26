import { describe, expect, it } from "vitest";
import { REGION_TIMING } from "../src/domain/timing.ts";
import type { Hit } from "../src/re/monlog.ts";
import {
  analyseFrames,
  analyseRegion,
  frameCommands,
  regionCommands,
  rtiAddresses,
  waitExit,
  type FrameEntry,
} from "../src/re/frame-profile.ts";

const base: Hit = {
  kind: "store",
  addr: 0xdc0f,
  pc: 0x1000,
  mnemonic: "STA",
  operand: "",
  a: 0,
  x: 0,
  y: 0,
  sp: 0xf6,
  flags: "",
  clock: 0,
  line: 0,
  cycle: 0,
};
const st = (a: number, clock: number): Hit => ({ ...base, a, clock });
/** A hit at a given raster line, for the frame-numbering tests. */
const stAt = (a: number, clock: number, line: number, cycle = 20): Hit => ({
  ...base,
  a,
  clock,
  line,
  cycle,
});
const TIMER_B = {
  start: { store: 0xdc0f, value: 0x11 },
  stop: { store: 0xdc0f, value: 0x00 },
};
const PAL_TIMING = REGION_TIMING.PAL;

describe("region samples", () => {
  it("pairs each start with the next stop and ignores the stop that precedes a start", () => {
    // timer_start writes $00 then $11; timer_stop writes $00.
    const hits = [st(0, 10), st(0x11, 20), st(0, 520), st(0, 19700), st(0x11, 19710), st(0, 20010)];
    const p = analyseRegion(hits, TIMER_B, PAL_TIMING, 0);
    expect(p.samples.map((s) => s.cycles)).toEqual([500, 300]);
    expect(p.samples.map((s) => s.frame)).toEqual([0, 1]);
    expect(p).toMatchObject({ worst: 500, typical: 300, count: 2, unpaired: 0 });
  });

  it("drops a start the run cut off and counts it", () => {
    const p = analyseRegion([st(0x11, 20), st(0, 520), st(0x11, 900)], TIMER_B, PAL_TIMING, 0);
    expect(p).toMatchObject({ count: 1, unpaired: 1, worst: 500 });
  });

  it("counts a sample longer than a frame but keeps it", () => {
    const p = analyseRegion([st(0x11, 0), st(0, 30000)], TIMER_B, PAL_TIMING, 0);
    expect(p).toMatchObject({ over_frame: 1, worst: 30000 });
  });

  it("pairs by PC as well as by store", () => {
    const ex = (pc: number, clock: number): Hit => ({ ...base, kind: "exec", addr: pc, pc, clock });
    const p = analyseRegion(
      [ex(0x2000, 0), ex(0x2100, 77)],
      { start: { pc: 0x2000 }, stop: { pc: 0x2100 } },
      PAL_TIMING,
      0,
    );
    expect(p.worst).toBe(77);
  });

  it("gives null figures when nothing paired", () => {
    expect(analyseRegion([], TIMER_B, PAL_TIMING, 0)).toMatchObject({ worst: null, typical: null, count: 0 });
  });

  it("counts a start overwritten by a second start as unpaired", () => {
    const p = analyseRegion([st(0x11, 10), st(0x11, 50), st(0, 80), st(0x11, 90)], TIMER_B, PAL_TIMING, 0);
    expect(p.samples.map((s) => s.cycles)).toEqual([30]);
    expect(p.unpaired).toBe(2);
  });

  it("finds the worst of 200,000 samples without a spread", () => {
    const hits: Hit[] = [];
    for (let i = 0; i < 200_000; i++) hits.push(st(0x11, i * 100), st(0, i * 100 + 10 + (i % 7)));
    const p = analyseRegion(hits, TIMER_B, PAL_TIMING, 0);
    expect(p).toMatchObject({ count: 200_000, worst: 16 });
  });

  it("does not match a load hit at the store marker address", () => {
    const load = (a: number, clock: number): Hit => ({ ...base, kind: "load", a, clock });
    const p = analyseRegion([load(0x11, 10), st(0, 20)], TIMER_B, PAL_TIMING, 0);
    expect(p).toMatchObject({ count: 0, samples: [], worst: null, typical: null });
  });

  it("numbers frames from raster line 0, not the start clock: a sample near a frame's end no longer splits from one near its start", () => {
    // Raster lines 30 and 222 are one true frame; line 30 again is the next
    // (line 0 cycle 0 of that frame is clock 8000, derived below from the
    // first sample's own line and cycle). The old start-clock scheme split
    // the first two into frames 0 and 1: floor(9910/19656)=0,
    // floor(22006/19656)=1. A hit with no logged line (-1) is skipped when
    // picking the anchor, so the filler below is never it.
    const filler = { ...st(0x05, 50), line: -1, cycle: -1 }; // matches neither marker; unlogged raster position
    const hits = [
      filler,
      stAt(0x11, 9910, 30),
      stAt(0x00, 9950, 30),
      stAt(0x11, 22006, 222),
      stAt(0x00, 22046, 222),
      stAt(0x11, 29566, 30),
      stAt(0x00, 29606, 30),
    ];
    const p = analyseRegion(hits, TIMER_B, PAL_TIMING, 0);
    expect(p.samples.map((s) => s.frame)).toEqual([0, 0, 1]);
  });
});

describe("region commands", () => {
  it("traces the marker addresses", () => {
    expect(regionCommands(TIMER_B)).toBe("trace store dc0f dc0f\n");
    expect(regionCommands({ start: { pc: 0x2000 }, stop: { pc: 0x2100 } })).toBe(
      "trace exec 2000 2000\ntrace exec 2100 2100\n",
    );
  });
});

// Frame mode. PAL: 63 cycles a line, 19,656 a frame; frame 0 starts at clock 0.
const F = PAL_TIMING.cycles_per_frame;
const at = (frame: number, line: number, cycle = 10) => frame * F + line * 63 + cycle;
const lineOf = (clock: number) => Math.floor((clock % F) / 63);
/** An interrupt's three pushes log one hit at $0100+SP+3, at the clock the sequence ended (measured). */
const push = (clock: number, sp = 0xf3): Hit => ({
  ...base,
  kind: "store",
  addr: 0x100 | ((sp + 3) & 0xff),
  mnemonic: "JMP",
  sp,
  clock,
  line: lineOf(clock),
  cycle: clock % 63,
});
const exec = (pc: number, clock: number, mnemonic = "NOP", sp = 0xf0): Hit => ({
  ...base,
  kind: "exec",
  addr: pc,
  pc,
  mnemonic,
  sp,
  clock,
  line: lineOf(clock),
  cycle: clock % 63,
});
/** An exec hit with an operand, for the wait-loop search. */
const op = (pc: number, clock: number, insn: [string, string], sp: number): Hit => ({
  ...exec(pc, clock, insn[0], sp),
  operand: insn[1],
});
const rti = (clock: number, sp = 0xf3, pc = 0xea86) => exec(pc, clock, "RTI", sp);
const entry = (handler: number, clock: number, target: number | null = null): FrameEntry => ({
  handler,
  target,
  clock,
  line: lineOf(clock),
});

/**
 * Two handlers a frame: $1000 at line 40 (push, entry 29 cycles later, RTI
 * 200 cycles after the push) and $2000 at line 200 (RTI 400 after). Cost is
 * the interrupt sequence (7) to the end of RTI (6): 213 and 413.
 */
function twoHandlers(frames: number): { hits: Hit[]; entries: FrameEntry[] } {
  const hits: Hit[] = [];
  const entries: FrameEntry[] = [];
  for (let f = 0; f < frames; f++) {
    const a = at(f, 40);
    const b = at(f, 200);
    hits.push(push(a), exec(0x1000, a + 29), rti(a + 200), push(b), exec(0x2000, b + 29), rti(b + 400));
    entries.push(entry(0x1000, a + 29), entry(0x2000, b + 29));
  }
  hits.push(exec(0x0900, frames * F + 5, "JMP", 0xf6));
  return { hits, entries };
}

const opts = { timing: PAL_TIMING, startClock: 0, region: "pal" as const, rtis: [0xea86], wait: null };

describe("frame mode", () => {
  it("sums each frame's handler cycles and gives main plus idle as the rest", () => {
    const { hits, entries } = twoHandlers(3);
    const b = analyseFrames(hits, entries, opts);
    expect(b.frames.map((f) => f.handlers)).toEqual([626, 626, 626]);
    expect(b.frames.map((f) => f.rest)).toEqual([F - 626, F - 626, F - 626]);
    expect(b.frames.every((f) => f.idle === null && f.main === null)).toBe(true);
    expect(b.parts.map((p) => [p.handler, p.slot, p.entries, p.cost.typical, p.dispatch.typical])).toEqual([
      [0x1000, 0, 3, 213, 36],
      [0x2000, 0, 3, 413, 36],
    ]);
    expect(b.per_frame.handlers).toEqual({ worst: 626, typical: 626, least: 626 });
    expect(b.measured_frame).toBeNull();
    expect(b.unknowns.join()).toMatch(/no wait/);
  });

  it("numbers slots when one handler is entered several times a frame", () => {
    const hits: Hit[] = [];
    const entries: FrameEntry[] = [];
    for (let f = 0; f < 2; f++)
      for (const [k, line] of [40, 130, 260].entries()) {
        const c = at(f, line);
        hits.push(push(c), rti(c + 100 + k * 10));
        entries.push(entry(0x0876, c + 29));
      }
    hits.push(exec(0x0900, 2 * F + 5));
    const b = analyseFrames(hits, entries, opts);
    expect(b.parts.map((p) => [p.slot, p.cost.typical, p.entry_lines])).toEqual([
      [0, 113, [40]],
      [1, 123, [130]],
      [2, 133, [260]],
    ]);
    expect(b.frames.map((f) => f.handlers)).toEqual([369, 369]);
  });

  it("keys a JMP (pointer) handler's parts by target", () => {
    const c = at(0, 30);
    const d = at(0, 213);
    const hits = [push(c), rti(c + 1000), push(d), rti(d + 240), exec(0x0900, F + 1)];
    const b = analyseFrames(hits, [entry(0x4134, c + 34, 0x41c5), entry(0x4134, d + 34, 0x4137)], opts);
    expect(b.parts.map((p) => [p.handler, p.target, p.cost.typical])).toEqual([
      [0x4134, 0x4137, 253],
      [0x4134, 0x41c5, 1013],
    ]);
  });

  it("takes a nested interrupt's cycles out of the one it interrupted, and counts the span once per frame", () => {
    const c = at(0, 100);
    const hits = [
      push(c, 0xf3),
      push(c + 50, 0xed),
      rti(c + 80, 0xed, 0xfe72),
      rti(c + 200, 0xf3),
      exec(0x0900, F + 1),
    ];
    const b = analyseFrames(hits, [entry(0x1000, c + 29), entry(0x3000, c + 60)], {
      ...opts,
      rtis: [0xea86, 0xfe72],
    });
    const cost = Object.fromEntries(b.parts.map((p) => [p.handler, p.cost.typical]));
    // The NMI: push c+50 less 7 to RTI c+80 plus 6 = 43; the IRQ spans 213 and keeps 170.
    expect(cost[0x3000]).toBe(43);
    expect(cost[0x1000]).toBe(213 - 43);
    expect(b.frames[0]?.handlers).toBe(213);
  });

  it("splits an interrupt that crosses a frame boundary between the two frames", () => {
    const c = F - 100;
    const hits = [exec(0x0900, 0, "JMP", 0xf6), push(c), rti(c + 200), exec(0x0900, 2 * F + 1)];
    const b = analyseFrames(hits, [entry(0x1000, c + 29)], opts);
    expect(b.frames.map((f) => f.handlers)).toEqual([107, 106]);
  });

  it("names an interrupt that never returned and leaves it out of the sums", () => {
    const c = at(0, 50);
    const b = analyseFrames([push(c), exec(0x0900, F + 1)], [entry(0x1000, c + 29)], opts);
    expect(b.unreturned).toBe(1);
    expect(b.frames[0]?.handlers).toBe(0);
    expect(b.unknowns.join()).toMatch(/1 of 1 interrupts.*RTI/);
  });

  it("measures idle as the wait loop's cycles less the interrupts inside it, and main as the rest", () => {
    const { hits, entries } = twoHandlers(2);
    const wait = { pc: 0x402a, exit: 0x4032 };
    for (let f = 0; f < 2; f++)
      hits.push(exec(0x402a, at(f, 100), "LDA", 0xf4), exec(0x4032, at(f, 250), "RTS", 0xf4));
    hits.sort((x, y) => x.clock - y.clock);
    const b = analyseFrames(hits, entries, { ...opts, wait });
    const idle = 150 * 63 - 413;
    expect(b.frames.map((f) => f.idle)).toEqual([idle, idle]);
    expect(b.frames.map((f) => f.main)).toEqual([F - 626 - idle, F - 626 - idle]);
    expect(b.measured_frame).toBe(`play pal worst=${F - idle} typical=${F - idle}`);
  });
});

describe("frame mode discovery", () => {
  it("lists every RTI address executed at or after the start", () => {
    const hits = [rti(10, 0xf3, 0xea31), rti(100, 0xf3, 0xea86), rti(120, 0xf3, 0x0950), rti(130)];
    expect(rtiAddresses(hits, 50)).toEqual([0x0950, 0xea86]);
  });

  it("finds a wait loop's exit: the instruction after the backward branch, at the wait's stack depth", () => {
    const hits = [
      op(0x402a, 100, ["LDA", "$040B"], 0xf4),
      op(0x402d, 104, ["CMP", "$040B"], 0xf4),
      exec(0xff48, 106, "PHA", 0xed),
      op(0xff53, 110, ["BEQ", "$FF50"], 0xed),
      op(0x4030, 140, ["BEQ", "$402D"], 0xf4),
    ];
    expect(waitExit(hits, 0x402a)).toBe(0x4032);
    expect(waitExit(hits, 0x5000)).toBeNull();
  });

  it("traces each RTI and the wait's two addresses", () => {
    expect(frameCommands([0xea86], { pc: 0x402a, exit: 0x4032 })).toBe(
      "trace exec ea86 ea86\ntrace exec 402a 402a\ntrace exec 4032 4032\n",
    );
  });
});
