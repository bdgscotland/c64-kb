import { describe, expect, it } from "vitest";
import { REGION_TIMING } from "../src/domain/timing.ts";
import type { Hit } from "../src/re/monlog.ts";
import { analyseRegion, regionCommands } from "../src/re/frame-profile.ts";

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
const TIMER_B = {
  start: { store: 0xdc0f, value: 0x11 },
  stop: { store: 0xdc0f, value: 0x00 },
};
const PAL = REGION_TIMING.PAL.cycles_per_frame;

describe("region samples", () => {
  it("pairs each start with the next stop and ignores the stop that precedes a start", () => {
    // timer_start writes $00 then $11; timer_stop writes $00.
    const hits = [st(0, 10), st(0x11, 20), st(0, 520), st(0, 19700), st(0x11, 19710), st(0, 20010)];
    const p = analyseRegion(hits, TIMER_B, PAL, 0);
    expect(p.samples.map((s) => s.cycles)).toEqual([500, 300]);
    expect(p.samples.map((s) => s.frame)).toEqual([0, 1]);
    expect(p).toMatchObject({ worst: 500, typical: 300, count: 2, unpaired: 0 });
  });

  it("drops a start the run cut off and counts it", () => {
    const p = analyseRegion([st(0x11, 20), st(0, 520), st(0x11, 900)], TIMER_B, PAL, 0);
    expect(p).toMatchObject({ count: 1, unpaired: 1, worst: 500 });
  });

  it("counts a sample longer than a frame but keeps it", () => {
    const p = analyseRegion([st(0x11, 0), st(0, 30000)], TIMER_B, PAL, 0);
    expect(p).toMatchObject({ over_frame: 1, worst: 30000 });
  });

  it("pairs by PC as well as by store", () => {
    const ex = (pc: number, clock: number): Hit => ({ ...base, kind: "exec", addr: pc, pc, clock });
    const p = analyseRegion(
      [ex(0x2000, 0), ex(0x2100, 77)],
      { start: { pc: 0x2000 }, stop: { pc: 0x2100 } },
      PAL,
      0,
    );
    expect(p.worst).toBe(77);
  });

  it("gives null figures when nothing paired", () => {
    expect(analyseRegion([], TIMER_B, PAL, 0)).toMatchObject({ worst: null, typical: null, count: 0 });
  });

  it("counts a start overwritten by a second start as unpaired", () => {
    const p = analyseRegion([st(0x11, 10), st(0x11, 50), st(0, 80), st(0x11, 90)], TIMER_B, PAL, 0);
    expect(p.samples.map((s) => s.cycles)).toEqual([30]);
    expect(p.unpaired).toBe(2);
  });

  it("finds the worst of 200,000 samples without a spread", () => {
    const hits: Hit[] = [];
    for (let i = 0; i < 200_000; i++) hits.push(st(0x11, i * 100), st(0, i * 100 + 10 + (i % 7)));
    const p = analyseRegion(hits, TIMER_B, PAL, 0);
    expect(p).toMatchObject({ count: 200_000, worst: 16 });
  });

  it("does not match a load hit at the store marker address", () => {
    const load = (a: number, clock: number): Hit => ({ ...base, kind: "load", a, clock });
    const p = analyseRegion([load(0x11, 10), st(0, 20)], TIMER_B, PAL, 0);
    expect(p).toMatchObject({ count: 0, samples: [], worst: null, typical: null });
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
