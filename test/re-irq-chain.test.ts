import { describe, expect, it } from "vitest";
import type { Hit } from "../src/re/monlog.ts";
import { REGION_TIMING } from "../src/domain/timing.ts";
import { analyseIrqChain, execCommands, liveHandlers, storeCommands } from "../src/re/irq-chain.ts";
import { isInterruptPush } from "../src/re/interrupts.ts";

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
/** An interrupt as VICE logs it: PC high at $0100 + SP + 3, SP after all three pushes. */
const irq = (clock: number, sp = 0xf3, mnemonic = "JMP"): Hit => ({
  ...base,
  addr: 0x100 + sp + 3,
  pc: 0x0926,
  mnemonic,
  sp,
  clock,
});
const PAL = REGION_TIMING.PAL.cycles_per_frame;

describe("vector writes", () => {
  it("reports a vector once both bytes are known, byte by byte", () => {
    const r = analyseIrqChain([st(0x314, 0x00, 10), st(0x315, 0x20, 20), st(0x314, 0x40, 30)], PAL, 0);
    expect(r.vectors.map((v) => v.value)).toEqual([null, 0x2000, 0x2040]);
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
      [
        st(0x314, 0, 1),
        st(0x315, 0x20, 2),
        st(0xd011, 0x1b, 5),
        st(0xd012, 40, 10),
        ld(0xd012, 15),
        irq(71),
        ex(0x2000, 100, 40),
      ],
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

describe("state before the entry clock", () => {
  it("seeds $D011 from a pre-entry write so a $D012-only program gets an armed line", () => {
    const r = analyseIrqChain(
      [
        st(0x314, 0, 1),
        st(0x315, 0x20, 2),
        st(0xd011, 0x9b, 5),
        st(0xd012, 0x04, 100),
        irq(171),
        ex(0x2000, 200, 260),
      ],
      PAL,
      50,
    );
    expect(r.arms.map((a) => a.line)).toEqual([260]);
    expect(r.arms).toHaveLength(1);
  });
  it("seeds vector bytes and emits no observation or entry before the entry clock", () => {
    const r = analyseIrqChain(
      [st(0x314, 0x31, 1), st(0x315, 0xea, 2), ex(0xea31, 3, 0), st(0x314, 0x00, 100)],
      PAL,
      50,
    );
    expect(r.vectors.map((v) => v.value)).toEqual([0xea00]);
    expect(r.entries).toHaveLength(0);
  });
  it("names a vector with only one byte ever written as unknown", () => {
    const r = analyseIrqChain([st(0xfffe, 0x00, 100)], PAL, 50);
    expect(r.vectors.map((v) => v.value)).toEqual([null]);
    expect(r.unknowns.join(" ")).toMatch(/irq_fffe.*\$FFFF never written/);
  });
  it("names an armed line left unknown because $D011 was never written", () => {
    const r = analyseIrqChain([st(0xd012, 0x40, 100)], PAL, 50);
    expect(r.arms.map((a) => a.line)).toEqual([null]);
    expect(r.unknowns.join(" ")).toMatch(/\$D011 never written/);
  });
  it("adds no unknown for a vector whose second byte arrives later", () => {
    const r = analyseIrqChain([st(0x314, 0x00, 100), st(0x315, 0x20, 110)], PAL, 50);
    expect(r.unknowns).toEqual([]);
  });
});

describe("entries and summary", () => {
  it("numbers frames from the start clock and lists entry lines per handler", () => {
    const hits = [
      st(0x314, 0x00, 1),
      st(0x315, 0x20, 2),
      st(0xd011, 0x1b, 3),
      st(0xd012, 40, 4),
      irq(71),
      ex(0x2000, 100, 40),
      irq(71 + PAL),
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
    const r = analyseIrqChain([st(0x314, 0x00, 1), st(0x315, 0x20, 2), irq(71), missingTimingHit], PAL, 0);
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

describe("interrupts from the stack pushes", () => {
  it("takes the push at SP + 3 as an interrupt, not a JSR's or PHA's own, nor BRK's", () => {
    expect(isInterruptPush(irq(10))).toBe(true);
    // A JSR alone pushes at SP + 1 and SP + 2; one taken before an interrupt at SP + 4 and SP + 5.
    for (const off of [1, 2, 4, 5])
      expect(isInterruptPush({ ...irq(10, 0xf0, "JSR"), addr: 0x100 + 0xf0 + off })).toBe(false);
    expect(isInterruptPush(irq(10, 0xf0, "JSR"))).toBe(true);
    expect(isInterruptPush(irq(10, 0xf3, "BRK"))).toBe(false);
  });

  it("counts an interrupt no traced handler ran as unknown", () => {
    const r = analyseIrqChain([st(0x314, 0, 1), st(0x315, 0x20, 2), irq(100), ex(0x2000, 400, 40)], PAL, 0);
    expect(r.interrupts).toBe(1);
    expect(r.entries).toHaveLength(0);
    expect(r.unknowns.join(" ")).toMatch(/1 of 1 interrupts entered no traced handler/);
  });
});

// #66, both cases measured in VICE x64sc 3.10 on the recipes named.
describe("an entry is a dispatch, not an execution of the address", () => {
  it("sprite-multiplex-game: an IRQ exit falling into `nmi: rti` is not an NMI entry", () => {
    const hits: Hit[] = [
      st(0xfffe, 0xf8, 10),
      st(0xffff, 0x0a, 11),
      st(0xfffa, 0x8c, 12),
      st(0xfffb, 0x0b, 13),
    ];
    // VICE logs a $FFFE handler's first exec before the interrupt's pushes, at the same clock.
    for (const t of [1000, 1000 + PAL, 1000 + 2 * PAL])
      hits.push(ex(0x0af8, t, 112), irq(t), ex(0x0b8c, t + 140, 113));
    const r = analyseIrqChain(hits, PAL, 0);
    expect(r.interrupts).toBe(3);
    expect(r.handlers).toEqual([
      expect.objectContaining({ handler: 0x0af8, via: ["irq_fffe"], entries: 3 }),
      expect.objectContaining({ handler: 0x0b8c, via: ["nmi_fffa"], entries: 0 }),
    ]);
    expect(liveHandlers(hits, 0)).toContain(0x0b8c);
  });

  it("raster-bars: a half-written $0314 is transient, not a handler, and gets no checkpoint", () => {
    const hits: Hit[] = [
      st(0x314, 0xcf, 10),
      st(0x315, 0x0b, 11),
      irq(1000),
      ex(0x0bcf, 1029, 119),
      // Handler at $0BCF re-points to $0C04 low byte first: $0B04 for 6 cycles.
      st(0x314, 0x04, 1100),
      st(0x315, 0x0c, 1106),
      irq(2000),
      ex(0x0c04, 2029, 135),
      // $0B04 is the TAX inside handler 0: executed, but no interrupt is waiting for it.
      ex(0x0b04, 2033, 135),
      st(0x314, 0x00, 2100),
      st(0x315, 0x0b, 2106),
      irq(3000),
      ex(0x0b00, 3029, 55),
      ex(0x0b04, 3033, 55),
    ];
    const r = analyseIrqChain(hits, PAL, 5);
    expect(r.handlers.map((h) => [h.handler, h.entries])).toEqual([
      [0x0b00, 1],
      [0x0bcf, 1],
      [0x0c04, 1],
    ]);
    expect(r.transient).toEqual([
      { vector: "irq_0314", value: 0x0b04, writes: 1 },
      { vector: "irq_0314", value: 0x0c00, writes: 1 },
    ]);
    expect(liveHandlers(hits, 5)).toEqual([0x0b00, 0x0bcf, 0x0c04]);
  });

  it("names the $0314 handler, not a RAM $FFFE value, when the KERNAL dispatches", () => {
    const hits: Hit[] = [
      st(0x314, 0x00, 1),
      st(0x315, 0x20, 2),
      st(0xfffe, 0x00, 3),
      st(0xffff, 0x30, 4),
      irq(1000),
      ex(0x2000, 1029, 40),
    ];
    const r = analyseIrqChain(hits, PAL, 0);
    expect(r.handlers).toEqual([
      expect.objectContaining({ handler: 0x2000, via: ["irq_0314"], entries: 1 }),
      expect.objectContaining({ handler: 0x3000, via: ["irq_fffe"], entries: 0 }),
    ]);
  });
});

describe("monitor commands", () => {
  it("traces the stack, both bytes of every vector and the IRQ registers, then the handlers", () => {
    expect(storeCommands()).toContain("trace store 0100 01ff");
    expect(storeCommands()).toContain("trace store 0314 0319");
    expect(storeCommands()).toContain("trace store fffa ffff");
    expect(storeCommands()).toContain("trace store d011 d012");
    expect(execCommands([0x2000])).toContain("trace exec 2000 2000");
  });
});
