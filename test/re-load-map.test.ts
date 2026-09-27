import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Hit } from "../src/re/monlog.ts";
import {
  entryFromHits,
  entryWindow,
  findStubs,
  firstProgramDispatch,
  groupWriters,
  WriterAggregator,
  type Stub,
} from "../src/re/load-map.ts";
import { reLoadMap } from "../src/tools/re-load-map.ts";
import { resolveX64sc } from "../src/services/vice-bin.ts";
import { findToolchains } from "../scripts/lib/toolchains.ts";

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
  flags: "",
  clock: 0,
  line: 0,
  cycle: 0,
};
const st = (pc: number, addr: number, clock: number): Hit => ({ ...base, pc, addr, clock });
const ex = (pc: number, clock: number): Hit => ({ ...base, kind: "exec", pc, addr: pc, clock });

describe("groupWriters: PC clustering", () => {
  it("groups store hits by PC within 256 bytes into one writer, with dest range, counts and clocks", () => {
    const hits = [st(0x2000, 0x8000, 100), st(0x2003, 0x8001, 110), st(0x2000, 0x8002, 120)];
    const { writers } = groupWriters(hits);
    expect(writers).toEqual([
      {
        pc_range: { start: 0x2000, end: 0x2003 },
        dest_ranges: [{ start: 0x8000, end: 0x8002 }],
        stores: 3,
        first_clock: 100,
        last_clock: 120,
        in_stack_page: false,
        ram_under_io: [],
        stage: null,
        id: "w0",
        basis: "measured-vice",
        rung: 1,
      },
    ]);
  });

  it("keeps two writers separate when their PCs are more than 256 bytes apart", () => {
    const hits = [st(0x018c, 0xfffa, 10), st(0x018c, 0xfffb, 20), st(0x3eb3, 0xfffe, 30)];
    const { writers } = groupWriters(hits);
    expect(writers).toHaveLength(2);
    expect(writers.map((w) => w.pc_range)).toEqual([
      { start: 0x018c, end: 0x018c },
      { start: 0x3eb3, end: 0x3eb3 },
    ]);
    expect(writers[1]?.dest_ranges).toEqual([{ start: 0xfffe, end: 0xfffe }]);
  });

  it("flags a writer whose PC range overlaps $0100-$01FF as in_stack_page", () => {
    const hits = [st(0x0105, 0x8000, 10), st(0x0112, 0x8001, 20)];
    const { writers } = groupWriters(hits);
    expect(writers[0]?.in_stack_page).toBe(true);
    expect(writers[0]?.pc_range).toEqual({ start: 0x0105, end: 0x0112 });
  });

  it("a writer outside the stack page is not flagged", () => {
    const { writers } = groupWriters([st(0x4125, 0x0314, 10), st(0x412a, 0x0315, 20)]);
    expect(writers[0]?.in_stack_page).toBe(false);
  });

  it("gives a writer two dest_ranges when it touches two separated address spans", () => {
    const hits = [st(0x0105, 0x0119, 10), st(0x0108, 0x8000, 20), st(0x010b, 0x8001, 30)];
    const { writers } = groupWriters(hits);
    expect(writers).toHaveLength(1);
    expect(writers[0]?.dest_ranges).toEqual([
      { start: 0x0119, end: 0x0119 },
      { start: 0x8000, end: 0x8001 },
    ]);
  });

  it("ignores exec and load hits: only store hits are grouped", () => {
    const { writers, hits } = groupWriters([ex(0x2000, 10), st(0x2000, 0x8000, 20)]);
    expect(hits).toBe(1);
    expect(writers).toHaveLength(1);
  });

  it("a hit cap stops the feed and is reported; writers past the cap are not included", () => {
    const many = [st(0x2000, 0x8000, 10), st(0x2000, 0x8001, 20), st(0x5000, 0x9000, 30)];
    const { writers, capped, hits } = groupWriters(many, 2);
    expect(capped).toBe(2);
    expect(hits).toBe(2);
    expect(writers).toEqual([
      {
        pc_range: { start: 0x2000, end: 0x2000 },
        dest_ranges: [{ start: 0x8000, end: 0x8001 }],
        stores: 2,
        first_clock: 10,
        last_clock: 20,
        in_stack_page: false,
        ram_under_io: [],
        stage: null,
        id: "w0",
        basis: "measured-vice",
        rung: 1,
      },
    ]);
  });

  it("no cap given: capped is null even for a large feed", () => {
    const { capped } = groupWriters([st(0x2000, 0x8000, 10)]);
    expect(capped).toBeNull();
  });

  it("WriterAggregator.add returns false once its cap is reached, true before", () => {
    const agg = new WriterAggregator(1);
    expect(agg.add(st(0x2000, 0x8000, 10))).toBe(true);
    expect(agg.add(st(0x2000, 0x8001, 20))).toBe(false);
    expect(agg.total).toBe(1);
    expect(agg.capped).toBe(1);
  });
});

// A minimal BASIC-program byte buffer: 2-byte load header, one line
// "10 SYS 2217 COMPUTERBRAINS", terminated by a $0000 end-of-program link.
function basicPrg(load: number, lineNum: number, sys: number, text: string): Uint8Array {
  const tokens = [0x9e, ...Buffer.from(` ${sys} ${text}`, "latin1")];
  const lineLen = 4 + tokens.length + 1; // link(2) + linenum(2) + tokens + $00
  const nextLine = load + lineLen;
  const bytes: number[] = [
    load & 0xff,
    load >> 8, // PRG header: load address
    nextLine & 0xff,
    nextLine >> 8, // link to next line (0 = end, else this line's own end)
    lineNum & 0xff,
    lineNum >> 8,
    ...tokens,
    0x00, // end of line
    0x00,
    0x00, // end of program (link = 0)
  ];
  return new Uint8Array(bytes);
}

describe("findStubs", () => {
  it("finds a BASIC line's SYS stub by walking its link bytes", () => {
    const bytes = basicPrg(0x0801, 10, 2217, "COMPUTERBRAINS");
    expect(findStubs(bytes, 0x0801)).toMatchObject([
      { addr: 0x0801, sys: 2217, text: "COMPUTERBRAINS", line: 10 },
    ]);
  });

  it("finds a second stub embedded elsewhere in the image, not on a linked BASIC line", () => {
    const first = basicPrg(0x0801, 10, 2217, "COMPUTERBRAINS");
    // Append arbitrary "packed data" holding a second $9E+digits+text, not reachable by the line's own link.
    const junk = Buffer.from("xx\x9e 2066 C.C.S.\x00yy", "latin1");
    const bytes = new Uint8Array([...first, ...junk]);
    const stubs = findStubs(bytes, 0x0801);
    expect(stubs).toHaveLength(2);
    expect(stubs[0]).toMatchObject({ addr: 0x0801, sys: 2217, text: "COMPUTERBRAINS", line: 10 });
    expect(stubs[1]).toMatchObject({ sys: 2066, text: "C.C.S." });
  });

  it("does not walk BASIC lines for a PRG that does not load at $0801, but still scans raw bytes", () => {
    const bytes = new Uint8Array([0x00, 0x90, ...Buffer.from("\x9e 4096 HELLO\x00", "latin1")]);
    const stubs = findStubs(bytes, 0x9000);
    expect(stubs).toMatchObject([{ addr: 0x9000, sys: 4096, text: "HELLO", line: null }]);
  });

  it("reports each stub's BASIC line number: the linked line's, or a scanned line's whose link says it runs at $0801", () => {
    const first = basicPrg(0x0801, 2049, 2217, "COMPUTERBRAINS");
    // Commando's inner stub as it sits in the packed image: link $0812, line $FFFF, then SYS 2066 C.C.S.
    const inner = [0x12, 0x08, 0xff, 0xff, 0x9e, ...Buffer.from("2066 C.C.S.", "latin1"), 0x00];
    const loose = Buffer.from("\x03\x05\x00\xb6\x9e2061\x00", "latin1");
    const bytes = new Uint8Array([...first, ...inner, ...loose]);
    const stubs = findStubs(bytes, 0x0801);
    expect(stubs.map((s) => [s.sys, s.line])).toEqual([
      [2217, 2049],
      [2066, 0xffff],
      [2061, null],
    ]);
    // The inner stub's addr is its line's start in the image, the link byte, not the $9E.
    expect(stubs[1]?.addr).toBe(0x0801 + first.length - 2);
  });

  it("gives no stubs for a plain PRG with no $9E anywhere", () => {
    expect(findStubs(new Uint8Array([0x00, 0x08, 0xa9, 0x00, 0x60]), 0x0801)).toEqual([]);
  });

  it("dedupes when the raw scan rediscovers the same linked stub", () => {
    const bytes = basicPrg(0x0801, 10, 2217, "COMPUTERBRAINS");
    const stubs: Stub[] = findStubs(bytes, 0x0801);
    expect(stubs).toHaveLength(1);
  });
});

/** A store hit with its mnemonic and A register, for the $01 tracking. */
const stm = (pc: number, addr: number, clock: number, insn: { mnemonic: string; a?: number }): Hit => ({
  ...base,
  pc,
  addr,
  clock,
  mnemonic: insn.mnemonic,
  a: insn.a ?? 0,
});

describe("groupWriters: code generations and the CPU port", () => {
  it("splits one PC range into two writers when its code is rewritten between runs (two depack stages at the same PCs)", () => {
    const hits = [
      st(0x0820, 0x018c, 1_000), // an installer writes the stage-1 code at $018C
      st(0x018c, 0x0801, 3_400_000),
      st(0x018c, 0x0802, 3_400_100),
      st(0x0830, 0x018c, 8_920_000), // a second installer overwrites it
      st(0x018c, 0xffff, 8_990_000),
      st(0x018c, 0xfffe, 8_990_100),
    ];
    const { writers } = groupWriters(hits);
    const at018c = writers.filter((w) => w.pc_range.start === 0x018c);
    expect(at018c.map((w) => [w.first_clock, w.dest_ranges])).toEqual([
      [3_400_000, [{ start: 0x0801, end: 0x0802 }]],
      [8_990_000, [{ start: 0xfffe, end: 0xffff }]],
    ]);
  });

  it("keeps code written at different times apart even when the PCs are within 256 bytes ($0073 CHRGET vs a stack-page loop)", () => {
    const hits = [
      st(0xe3a0, 0x0073, 500), // the KERNAL copies CHRGET
      st(0x0820, 0x0105, 3_000_000), // an installer writes a loop to $0105
      st(0x0073, 0x007a, 3_100_000),
      st(0x0105, 0x8000, 3_200_000),
    ];
    const { writers } = groupWriters(hits);
    const low = writers.filter((w) => w.pc_range.end < 0x0200);
    expect(low.map((w) => w.pc_range)).toEqual([
      { start: 0x0073, end: 0x0073 },
      { start: 0x0105, end: 0x0105 },
    ]);
  });

  it("lists writers in order of first store, not by PC", () => {
    const { writers } = groupWriters([st(0x4000, 0x8000, 10), st(0x2000, 0x9000, 20)]);
    expect(writers.map((w) => w.pc_range.start)).toEqual([0x4000, 0x2000]);
  });

  it("reports stores to $D000-$DFFF made with I/O banked out as ram_under_io, following STA/DEC/INC to $01", () => {
    const hits = [
      stm(0x4000, 0x0001, 100, { mnemonic: "STA", a: 0x38 }), // all RAM
      stm(0x0820, 0xd400, 200, { mnemonic: "STA" }),
      stm(0x4000, 0x0001, 300, { mnemonic: "DEC" }), // $37: I/O back in
      stm(0x0820, 0xd401, 400, { mnemonic: "STA" }),
    ];
    const { writers } = groupWriters(hits);
    const w = writers.find((x) => x.pc_range.start === 0x0820);
    expect(w?.dest_ranges).toEqual([{ start: 0xd400, end: 0xd401 }]);
    expect(w?.ram_under_io).toEqual([{ start: 0xd400, end: 0xd400 }]);
  });

  it("does not treat code run from BASIC ROM as the RAM under it, once that RAM has been written", () => {
    const hits = [
      st(0x0900, 0xa35a, 1_000), // RAM under BASIC ROM written; ROM still visible ($01=$37 at reset)
      st(0xa35a, 0x0010, 2_000_000), // runs from BASIC ROM
      stm(0x0910, 0x0001, 2_500_000, { mnemonic: "STA", a: 0x36 }), // BASIC out
      st(0xa35a, 0xd000, 2_600_000), // now the RAM routine runs
    ];
    const { writers } = groupWriters(hits);
    const atA35a = writers.filter((w) => w.pc_range.start === 0xa35a);
    expect(atA35a.map((w) => w.first_clock)).toEqual([2_000_000, 2_600_000]);
  });
});

describe("groupWriters: banking that cannot be followed", () => {
  it("a later STA to $01 with a known value restores the banking after an LSR $01", () => {
    const hits = [
      stm(0x4000, 0x0001, 100, { mnemonic: "LSR" }),
      stm(0x4000, 0x0001, 200, { mnemonic: "STA", a: 0x38 }),
      stm(0x0820, 0xd400, 300, { mnemonic: "STA" }),
    ];
    const agg = new WriterAggregator();
    for (const h of hits) agg.add(h);
    const w = agg.finish().find((x) => x.pc_range.start === 0x0820);
    expect(w?.ram_under_io).toEqual([{ start: 0xd400, end: 0xd400 }]);
    expect(agg.unresolved).toBe(0);
  });

  it("with $01 unknown, a store to $D000-$DFFF is unresolved: ram_under_io is null and the count says so", () => {
    const agg = new WriterAggregator();
    agg.add(stm(0x4000, 0x0001, 100, { mnemonic: "LSR" }));
    agg.add(stm(0x0820, 0xd400, 200, { mnemonic: "STA" }));
    const w = agg.finish().find((x) => x.pc_range.start === 0x0820);
    expect(w?.ram_under_io).toBeNull();
    expect(agg.unresolved).toBe(1);
  });

  it("with $01 unknown, code in a ROM window is its own generation, not the RAM's", () => {
    const hits = [
      st(0x0900, 0xa35a, 1_000), // RAM under BASIC written
      st(0xa35a, 0x0010, 2_000), // BASIC ROM ($01 = $37)
      stm(0x0910, 0x0001, 3_000, { mnemonic: "ROL" }), // $01 unknown from here
      st(0xa35a, 0x0011, 4_000),
    ];
    const agg = new WriterAggregator();
    for (const h of hits) agg.add(h);
    const at = agg.finish().filter((w) => w.pc_range.start === 0xa35a);
    expect(at.map((w) => w.first_clock)).toEqual([2_000, 4_000]);
    expect(agg.unresolved).toBe(1);
  });
});

describe("observations and stages", () => {
  it("every writer carries id, basis and rung; stack-page writers are numbered as stages in clock order", () => {
    const { writers } = groupWriters([
      st(0x0820, 0x0105, 10), // installer
      st(0x0105, 0x0801, 1_000_000), // stage 1
      st(0x0a30, 0x0105, 2_000_000), // second installer
      st(0x0105, 0xffff, 3_000_000), // stage 2
    ]);
    expect(writers.map((w) => [w.id, w.basis, w.rung, w.stage])).toEqual([
      ["w0", "measured-vice", 1, null],
      ["w1", "measured-vice", 1, 1],
      ["w2", "measured-vice", 1, null],
      ["w3", "measured-vice", 1, 2],
    ]);
  });

  it("every stub carries id, basis and rung", () => {
    const stubs = findStubs(basicPrg(0x0801, 10, 2217, "X"), 0x0801);
    expect(stubs[0]).toMatchObject({ id: "s0", basis: "measured-vice", rung: 1 });
  });
});

describe("entry_pc is never read from an incomplete trace", () => {
  const stageWriters = groupWriters([
    st(0x0820, 0x0105, 10),
    st(0x0105, 0x0801, 1_000_000),
    st(0x0105, 0x0802, 2_000_000),
  ]).writers;
  const complete = { truncated: false, hitCapped: false, endClock: 3_000_000 };
  const FRAME = 19_656;

  it("a complete store trace gives the window after the last stage's last store", () => {
    expect(entryWindow(stageWriters, complete, FRAME)).toEqual({ from: 2_000_000, stage: 1 });
  });

  it("no stage: no window and nothing unknown", () => {
    expect(entryWindow(groupWriters([st(0x2000, 0x8000, 10)]).writers, complete, FRAME)).toBeNull();
  });

  it("a store trace stopped by the byte cap gives no entry, and says why", () => {
    const r = entryWindow(stageWriters, { ...complete, truncated: true }, FRAME);
    expect(r).toEqual({
      unknown: "entry_pc unknown: the store trace was stopped early, so stage 1 may not have finished",
    });
  });

  it("a store trace stopped by the hit cap gives no entry", () => {
    expect(entryWindow(stageWriters, { ...complete, hitCapped: true }, FRAME)).toMatchObject({
      unknown: expect.stringContaining("stopped early") as string,
    });
  });

  it("a stage still storing within a frame of the trace's end gives no entry", () => {
    const r = entryWindow(stageWriters, { ...complete, endClock: 2_010_000 }, FRAME);
    expect(r).toEqual({
      unknown:
        "entry_pc unknown: stage 1 stored at clock 2000000, within a frame of the trace's end (2010000)",
    });
  });

  it("the entry pass gives the first exec after the window", () => {
    const hits = [ex(0x0900, 1_999_000), ex(0x0850, 2_000_050), ex(0x0853, 2_000_060)];
    expect(entryFromHits(hits, { from: 2_000_000, stage: 1 }, false)).toEqual({ pc: 0x0850 });
  });

  it("a truncated entry pass gives no entry, even when a hit was read", () => {
    const hits = [ex(0x0850, 2_000_050)];
    expect(entryFromHits(hits, { from: 2_000_000, stage: 1 }, true)).toEqual({
      unknown: "entry_pc unknown: the entry pass was stopped early",
    });
  });

  it("an entry pass with no exec after the window names the ranges it looked in", () => {
    expect(entryFromHits([ex(0x0900, 10)], { from: 2_000_000, stage: 1 }, false)).toMatchObject({
      unknown: expect.stringContaining("$0200-$9FFF") as string,
    });
  });
});

const irqHit = {
  id: "e0",
  basis: "measured-vice" as const,
  rung: 1 as const,
  target: null,
  line: null,
  cycle: null,
};

describe("firstProgramDispatch", () => {
  it("skips an early entry into the KERNAL's own ROM handler and picks the first RAM one", () => {
    const entries = [
      { ...irqHit, id: "e0", handler: 0xea31, clock: 20_000, frame: 0 },
      { ...irqHit, id: "e1", handler: 0xea31, clock: 40_000, frame: 1 },
      { ...irqHit, id: "e2", handler: 0x4134, clock: 15_243_156, frame: 700 },
    ];
    expect(firstProgramDispatch(entries).clock).toBe(15_243_156);
  });

  it("finds a handler at $E100 when the KERNAL is banked out at the dispatch", () => {
    const entries = [
      { ...irqHit, handler: 0xea31, clock: 100, frame: 0 },
      { ...irqHit, handler: 0xe100, clock: 5_000, frame: 1 },
    ];
    const port = [stm(0x0900, 0x0001, 4_000, { mnemonic: "STA", a: 0x35 })];
    expect(firstProgramDispatch(entries, port)).toEqual({ clock: 5_000, unknowns: [] });
  });

  it("a handler above $E000 with $01 unknown at the dispatch is not counted, and says so", () => {
    const entries = [{ ...irqHit, handler: 0xe100, clock: 5_000, frame: 1 }];
    const port = [stm(0x0900, 0x0001, 4_000, { mnemonic: "LSR" })];
    const r = firstProgramDispatch(entries, port);
    expect(r.clock).toBeNull();
    expect(r.unknowns).toEqual([
      "$01 not known at the entry to $E100 at clock 5000: ROM or RAM handler unknown",
    ]);
  });

  it("is null when every entry is still in KERNAL ROM", () => {
    expect(firstProgramDispatch([{ ...irqHit, handler: 0xea31, clock: 100, frame: 0 }]).clock).toBeNull();
  });

  it("is null with no entries at all", () => {
    expect(firstProgramDispatch([]).clock).toBeNull();
  });
});

const tools = findToolchains();
const x64sc = resolveX64sc();
const canRun = x64sc !== null && !x64sc.windowed && tools.kickass !== null && tools.java !== null;

/** Builds test/fixtures/re/reloc-stub.asm fresh into a scratch dir. */
function buildRelocStub(): string {
  const dir = mkdtempSync(join(tmpdir(), "re-load-map-"));
  // Assembled from a copy, in the scratch dir: KickAssembler writes a .sym
  // file beside its source, and the committed fixture must stay clean.
  copyFileSync(join(import.meta.dirname, "fixtures", "re", "reloc-stub.asm"), join(dir, "t.asm"));
  const r = spawnSync(tools.java ?? "java", ["-jar", tools.kickass ?? "", "t.asm", "-o", "t.prg"], {
    cwd: dir,
  });
  if (r.status !== 0)
    throw new Error(`KickAssembler failed:\n${r.stdout.toString()}\n${r.stderr.toString()}`);
  return join(dir, "t.prg");
}

describe.skipIf(!canRun)(
  "c64_re_load_map in VICE, on a relocator that copies itself from the stack page",
  () => {
    it("finds the stack-page writer that copies to $8000, the code that then runs from $8000, and the BASIC stub", async () => {
      const prg = buildRelocStub();
      const r = await reLoadMap({ prg_path: prg, model: "pal", cycles: 4_000_000 });
      expect(r.ok, JSON.stringify(r)).toBe(true);
      if (!r.ok) return;

      expect(r.result.load).toBe(0x0801);
      expect(r.result.stubs.length).toBeGreaterThanOrEqual(1);
      expect(r.result.stubs[0]).toMatchObject({ addr: 0x0801 });

      // The reloc loop, copied into the stack page by the install loop and run
      // from there: its own writer (BASIC's CHRGET at $0073 is within 256
      // bytes but was written at boot, another generation). Its dest_ranges
      // cover the copy to $8000-$80FF; its return pointer is a second range.
      const stackWriter = r.result.writers.find((w) => w.in_stack_page);
      expect(stackWriter, JSON.stringify(r.result.writers)).toBeDefined();
      expect(stackWriter?.pc_range.start).toBeGreaterThanOrEqual(0x0100);
      expect(stackWriter?.pc_range.end).toBeLessThanOrEqual(0x01ff);
      expect(stackWriter?.dest_ranges).toContainEqual({ start: 0x8000, end: 0x80ff });
      expect(stackWriter?.stores).toBeGreaterThanOrEqual(256);
      expect(stackWriter?.stage).toBe(1);
      // The first PC run after the stage's last store: the JMP ($8000) target.
      expect(r.result.entry_pc).toBe(0x8000);

      // The installer (not in the stack page) that copied the reloc loop's own
      // bytes into $0100.
      const installer = r.result.writers.find(
        (w) => !w.in_stack_page && w.dest_ranges.some((d) => d.start <= 0x0100 && d.end >= 0x0100),
      );
      expect(installer, JSON.stringify(r.result.writers)).toBeDefined();

      // Proof the JMP ($8000) landed on the copy, not the original at $0900:
      // a writer whose own PC is at $8000 storing to $D021.
      const landed = r.result.writers.find((w) => w.pc_range.start >= 0x8000 && w.pc_range.start < 0x8100);
      expect(landed, JSON.stringify(r.result.writers)).toBeDefined();
      expect(landed?.in_stack_page).toBe(false);
      expect(landed?.dest_ranges).toContainEqual({ start: 0xd021, end: 0xd021 });

      // This fixture never installs its own interrupt handler (only the
      // KERNAL's default, in ROM, ever runs): first_program_dispatch_clock is
      // null, named in unknowns, and the writers cover the whole 4,000,000
      // cycle run (no smaller cap was derived).
      expect(r.result.first_program_dispatch_clock).toBeNull();
      expect(
        r.result.unknowns.some((u) => u.includes("no interrupt entered a handler the program installed")),
      ).toBe(true);
    }, 180_000);
  },
);

const commando = JSON.parse(
  existsSync(join(import.meta.dirname, "..", "data", "games", "manifest.json"))
    ? readFileSync(join(import.meta.dirname, "..", "data", "games", "manifest.json"), "utf8")
    : "{}",
) as Record<string, { path: string }>;
const hasCommando =
  canRun && existsSync(commando.b2ca47949468c3d1790dfe8b2fc9b54cb9638c3f?.path ?? "/nonexistent");

describe.skipIf(!hasCommando)(
  "c64_re_load_map on Commando (the maintainer's image; skips without it)",
  () => {
    it("separates the two depack stages, the raw copy under I/O and the game's init, and finds the first dispatch", async () => {
      const r = await reLoadMap({ session: "docs/game-design/studies/sessions/commando.json" });
      expect(r.ok, JSON.stringify(r)).toBe(true);
      if (!r.ok) return;
      const { stubs, writers } = r.result;
      const has = (w: (typeof writers)[number] | undefined, start: number, end: number) =>
        w?.dest_ranges.some((d) => d.start <= start && d.end >= end) ?? false;
      const shown = JSON.stringify(writers.map((w) => [w.pc_range, w.first_clock]));

      // Stubs: the outer one and the inner one stage 1 unpacks to $0801; their
      // line numbers (2049 = $0801, 65535 = $FFFF) are each stage's output pointer.
      expect(stubs[0]).toMatchObject({ addr: 0x0801, sys: 2217, text: "COMPUTERBRAINS", line: 2049 });
      expect(stubs.find((s) => s.sys === 2066)).toMatchObject({ text: "C.C.S.", line: 0xffff });

      // Two stack-page writers at the same PCs, split by the code copied over the first.
      const stages = writers.filter((w) => w.in_stack_page && w.stores > 100_000);
      expect(stages, shown).toHaveLength(2);
      const [one, two] = stages;
      expect(has(one, 0x0801, 0xb37c)).toBe(true); // stage 1: forward to $0801-$B37C
      expect(one?.last_clock).toBeLessThan(8_920_000);
      expect(two?.pc_range.start).toBeLessThanOrEqual(0x018c); // stage 2's put-byte
      expect(two?.pc_range.end).toBeGreaterThanOrEqual(0x018c);
      expect(has(two, 0x0800, 0xcfff) && has(two, 0xe000, 0xffff)).toBe(true);
      expect(two?.dest_ranges.some((d) => d.start <= 0xdfff && d.end >= 0xd000)).toBe(false);

      // The 4 KB raw copy to $D000-$DFFF went to RAM under I/O ($01 = $38).
      expect(writers.some((w) => w.ram_under_io?.some((d) => d.start === 0xd000 && d.end === 0xdfff))).toBe(
        true,
      );

      // $3EB1-$3EB9 clears $FFC0-$FFFF at game init, after the load, not during it.
      const init = writers.find((w) => w.pc_range.start <= 0x3eb3 && w.pc_range.end >= 0x3eb3);
      expect(has(init, 0xffc0, 0xffff), shown).toBe(true);
      expect(init?.first_clock).toBeGreaterThan(15_190_000);
      expect(has(init, 0x0314, 0x0315)).toBe(true); // $4125/$412A install $4134

      expect([one?.stage, two?.stage]).toEqual([1, 2]);
      expect(r.result.entry_pc).toBe(0x0850);
      expect(r.result.first_program_dispatch_clock).toBe(15_243_156);
    }, 300_000);
  },
);
