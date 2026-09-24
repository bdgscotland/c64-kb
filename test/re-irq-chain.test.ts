import { describe, expect, it } from "vitest";
import type { Hit } from "../src/re/monlog.ts";
import { REGION_TIMING } from "../src/domain/timing.ts";
import { analyseIrqChain, execCommands, handlersFrom, storeCommands } from "../src/re/irq-chain.ts";

const base: Hit = {
  kind: "store",
  addr: 0,
  pc: 0x1000,
  mnemonic: "STA",
  operand: "",
  a: 0,
  x: 0,
  y: 0,
  sp: 0xf6,
  flags: "..-..I..",
  clock: 0,
  line: 0,
  cycle: 0,
};
const st = (addr: number, a: number, clock: number, mnemonic = "STA"): Hit => ({
  ...base,
  addr,
  a,
  clock,
  mnemonic,
});
const ex = (addr: number, clock: number, line: number): Hit => ({
  ...base,
  kind: "exec",
  addr,
  pc: addr,
  clock,
  line,
  cycle: 20,
});
const ld = (addr: number, clock: number): Hit => ({
  ...base,
  kind: "load",
  addr,
  clock,
});
const PAL = REGION_TIMING.PAL.cycles_per_frame;

describe("vector writes", () => {
  it("reports a vector once both bytes are known, byte by byte", () => {
    const r = analyseIrqChain([st(0x314, 0x00, 10), st(0x315, 0x20, 20), st(0x314, 0x40, 30)], PAL, 0);
    expect(r.vectors.map((v) => v.value)).toEqual([null, 0x2000, 0x2040]);
    expect(handlersFrom(r.vectors)).toEqual([0x2000, 0x2040]);
  });
});

describe("armed lines", () => {
  it("combines $D012 with $D011 bit 7 and recomputes on each write", () => {
    const r = analyseIrqChain([st(0xd011, 0x1b, 5), st(0xd012, 0x04, 10), st(0xd011, 0x9b, 20)], PAL, 0);
    expect(r.arms.map((a) => a.line)).toEqual([null, 4, 260]);
  });
  it("leaves a read-modify-write of $D012 unknown", () => {
    const r = analyseIrqChain([st(0xd011, 0x1b, 5), st(0xd012, 0, 10, "INC")], PAL, 0);
    expect(r.arms.at(-1)?.line).toBeNull();
    expect(r.unknowns.join(" ")).toMatch(/INC \$D012/);
  });
  it("ignores load hits (regression: load of $D012 does not create a false arm)", () => {
    const r = analyseIrqChain(
      [st(0xd011, 0x1b, 5), st(0xd012, 40, 10), ld(0xd012, 15), ex(0x2000, 100, 40)],
      PAL,
      0,
    );
    expect(r.arms.map((a) => a.line)).toEqual([null, 40]);
    expect(r.entries).toHaveLength(1);
    expect(r.handlers[0]).toEqual(
      expect.objectContaining({
        handler: 0x2000,
        armed_before: [40],
      }),
    );
  });
});

describe("entries and summary", () => {
  it("numbers frames from the start clock and lists entry lines per handler", () => {
    const hits = [
      st(0x314, 0x00, 1),
      st(0x315, 0x20, 2),
      st(0xd011, 0x1b, 3),
      st(0xd012, 40, 4),
      ex(0x2000, 100, 40),
      ex(0x2000, 100 + PAL, 41),
    ];
    const r = analyseIrqChain(hits, PAL, 0);
    expect(r.entries.map((e) => e.frame)).toEqual([0, 1]);
    expect(r.handlers).toEqual([
      expect.objectContaining({
        handler: 0x2000,
        via: ["irq_0314"],
        entries: 2,
        entry_lines: [40, 41],
        armed_before: [40],
      }),
    ]);
    expect(new Set(r.entries.map((e) => e.id)).size).toBe(2);
  });
  it("handles missing timing (-1) by storing null and recording unknowns", () => {
    const missingTimingHit: Hit = {
      ...base,
      kind: "exec",
      addr: 0x2000,
      pc: 0x2000,
      clock: 100,
      line: -1,
      cycle: -1,
    };
    const r = analyseIrqChain([st(0x314, 0x00, 1), st(0x315, 0x20, 2), missingTimingHit], PAL, 0);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]).toEqual(
      expect.objectContaining({
        handler: 0x2000,
        line: null,
        cycle: null,
      }),
    );
    expect(r.handlers[0]).toEqual(expect.objectContaining({ entry_lines: [] }));
    expect(r.unknowns.join(" ")).toMatch(/raster timing not logged for handler entry/);
  });
});

describe("monitor commands", () => {
  it("traces both bytes of every vector and the IRQ registers, then the handlers", () => {
    expect(storeCommands()).toContain("trace store 0314 0319");
    expect(storeCommands()).toContain("trace store fffa ffff");
    expect(storeCommands()).toContain("trace store d011 d012");
    expect(execCommands([0x2000])).toContain("trace exec 2000 2000");
  });
});
