/**
 * Tests for c64_re_coverage: parser unit tests (fixture-based) and a
 * VICE integration test on the jmp-indirect fixture PRG.
 *
 * Fixture: test/fixtures/re/memmap.monlog is verbatim VICE x64sc 3.10
 * output (PAL, -default, windowless) from the jmp-indirect fixture PRG
 * with `trace exec 080e 080e; command 1 "memmapzap; disable 1";
 * trace store d019 d019; ignore 2 7; command 2 "memmapshow; disable 2"`.
 * The show fired at the 8th $D019 write (two full IRQ cycles), clock
 * 3000362. All three slot handlers ($0846, $085D, $0874) are present as
 * executed. Measured 2026-09-26.
 */
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  classifyCoverage,
  extendByInstrLen,
  instrLenOf,
  parseMemmapLog,
  type MemmapRow,
} from "../src/re/coverage.ts";
import { reCoverage } from "../src/tools/re-coverage.ts";
import { resolveX64sc } from "../src/services/vice-bin.ts";
import { findToolchains } from "../scripts/lib/toolchains.ts";

// Empty code set for tests that don't need extension
const noCode = new Set<number>();

// ---------------------------------------------------------------------------
// parseMemmapLog unit tests (fixture-based, no VICE)
// ---------------------------------------------------------------------------

describe("parseMemmapLog", () => {
  it("returns empty for a log with no memmapshow section", () => {
    expect(parseMemmapLog("no memmap here")).toEqual([]);
  });

  it("returns empty for a log with only the header (memmapzap was just run)", () => {
    expect(parseMemmapLog("addr: IO  ROM RAM\n")).toEqual([]);
  });

  it("parses rows from the measured fixture format", () => {
    const text = [
      "addr: IO  ROM RAM",
      "0800: --- --- -w-",
      "0801: --- --- rwx (uninitialized exec)",
      "0840: --- --- r-x (uninitialized exec)",
      "01f0: --- --- r-- (dummy)",
      "d019: -w- --- ---",
      "ff48: --- --x ---",
    ].join("\n");
    const rows = parseMemmapLog(text);
    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatchObject({ addr: 0x0800, ram: "-w-" });
    expect(rows[1]).toMatchObject({ addr: 0x0801, ram: "rwx" });
    expect(rows[2]).toMatchObject({ addr: 0x0840, ram: "r-x" });
    expect(rows[3]).toMatchObject({ addr: 0x01f0, ram: "r--" }); // dummy suffix ignored
    expect(rows[4]).toMatchObject({ addr: 0xd019, ram: "---" }); // I/O-only
    expect(rows[5]).toMatchObject({ addr: 0xff48, ram: "---" }); // ROM-only
  });

  it("stops the section at the first non-matching line", () => {
    const text = [
      "addr: IO  ROM RAM",
      "0800: --- --- -w-",
      "0801: --- --- --x",
      "some other line",
      "0802: --- --- --x",
    ].join("\n");
    expect(parseMemmapLog(text)).toHaveLength(2);
  });

  it("parses the verbatim fixture file showing all three slot handlers", () => {
    const text = readFileSync(join(import.meta.dirname, "fixtures", "re", "memmap.monlog"), "utf8");
    const rows = parseMemmapLog(text);
    // All three IRQ slot handlers from jmp-indirect.asm must be present
    const hasAddr = (addr: number) => rows.some((r) => r.addr === addr);
    expect(hasAddr(0x0846)).toBe(true); // part1
    expect(hasAddr(0x085d)).toBe(true); // part2
    expect(hasAddr(0x0874)).toBe(true); // part3
    // They must all be executed (--x in RAM)
    const execRow = (addr: number) => rows.find((r) => r.addr === addr);
    expect(execRow(0x0846)?.ram[2]).toBe("x");
    expect(execRow(0x085d)?.ram[2]).toBe("x");
    expect(execRow(0x0874)?.ram[2]).toBe("x");
  });
});

// ---------------------------------------------------------------------------
// instrLenOf unit tests
// ---------------------------------------------------------------------------

describe("instrLenOf", () => {
  it("1-byte implied instructions", () => {
    expect(instrLenOf(0x78)).toBe(1); // SEI
    expect(instrLenOf(0x60)).toBe(1); // RTS
    expect(instrLenOf(0xea)).toBe(1); // NOP
  });
  it("2-byte immediate and relative", () => {
    expect(instrLenOf(0xa9)).toBe(2); // LDA #
    expect(instrLenOf(0xd0)).toBe(2); // BNE rel
    expect(instrLenOf(0x85)).toBe(2); // STA zpg
  });
  it("3-byte absolute", () => {
    expect(instrLenOf(0xad)).toBe(3); // LDA abs
    expect(instrLenOf(0x8d)).toBe(3); // STA abs
    expect(instrLenOf(0x20)).toBe(3); // JSR abs
  });
  it("defaults to 1 for illegal opcodes", () => {
    expect(instrLenOf(0x02)).toBe(1); // JAM/KIL
    expect(instrLenOf(0xff)).toBe(1); // ISC abs,X (illegal but some use 3; default 1 here is safe)
  });
});

// ---------------------------------------------------------------------------
// extendByInstrLen unit tests
// ---------------------------------------------------------------------------

describe("extendByInstrLen", () => {
  it("extends a 2-byte instruction at $080f to cover $080f-$0810", () => {
    // Build a fake 49152-byte dump (PRG header + $0000-$BFFF)
    const dump = new Uint8Array(2 + 0xc000);
    dump[0] = 0x00; // load addr low
    dump[1] = 0x00; // load addr high
    // At address $080f: opcode $A9 (LDA #) = 2 bytes
    dump[0x080f + 2] = 0xa9;
    const result = extendByInstrLen([0x080f], dump);
    expect(result.has(0x080f)).toBe(true); // opcode
    expect(result.has(0x0810)).toBe(true); // operand
    expect(result.has(0x0811)).toBe(false);
  });

  it("extends a 3-byte instruction at $0811 to cover $0811-$0813", () => {
    const dump = new Uint8Array(2 + 0xc000);
    dump[0x0811 + 2] = 0x8d; // STA abs = 3 bytes
    const result = extendByInstrLen([0x0811], dump);
    expect(result.has(0x0811)).toBe(true);
    expect(result.has(0x0812)).toBe(true);
    expect(result.has(0x0813)).toBe(true);
    expect(result.has(0x0814)).toBe(false);
  });

  it("does not extend addresses above $BFFF (no dump coverage)", () => {
    const dump = new Uint8Array(2 + 0xc000);
    const result = extendByInstrLen([0xc000], dump);
    expect(result.has(0xc000)).toBe(true); // opcode addr itself is always added
    // $c001 would be extension if in dump range, but $c000 > $bfff so no extension
    expect(result.has(0xc001)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// classifyCoverage unit tests
// ---------------------------------------------------------------------------

describe("classifyCoverage", () => {
  const rows = (specs: string[]): MemmapRow[] =>
    specs.map((s) => {
      const [addr, io, rom, ram] = s.split(" ");
      return { addr: parseInt(addr ?? "0", 16), io: io ?? "---", rom: rom ?? "---", ram: ram ?? "---" };
    });

  it("classifies exec-only as code", () => {
    const r = rows(["0800 --- --- --x", "0801 --- --- --x"]);
    const c = classifyCoverage(r, new Set([0x0800, 0x0801]));
    expect(c.code).toEqual([{ start: 0x0800, end: 0x0801, kinds: ["x"] }]);
    expect(c.data).toEqual([]);
    expect(c.written_only).toEqual([]);
  });

  it("classifies read-only (not in codeSet) as data", () => {
    const r = rows(["0900 --- --- r--"]);
    const c = classifyCoverage(r, noCode);
    expect(c.data).toEqual([{ start: 0x0900, end: 0x0900, kinds: ["r"] }]);
    expect(c.code).toEqual([]);
  });

  it("classifies write-only (not in codeSet, no r) as written_only", () => {
    const r = rows(["0314 --- --- -w-", "0315 --- --- -w-"]);
    const c = classifyCoverage(r, noCode);
    expect(c.written_only).toEqual([{ start: 0x0314, end: 0x0315, kinds: ["w"] }]);
  });

  it("reclassifies data (r--) addresses that are in codeSet as code", () => {
    // $0810 is a read address in memmapshow (operand byte), but codeSet includes it
    const r = rows(["080f --- --- --x", "0810 --- --- r--"]);
    const c = classifyCoverage(r, new Set([0x080f, 0x0810]));
    // Both must be in code, not data
    expect(c.code.some((rng) => rng.start <= 0x0810 && rng.end >= 0x0810)).toBe(true);
    expect(c.data).toEqual([]);
  });

  it("extended addresses not in memmapshow appear in code with kinds ['x']", () => {
    const r = rows(["080f --- --- --x"]); // only opcode; operand not in memmapshow
    const c = classifyCoverage(r, new Set([0x080f, 0x0810])); // 0x0810 extended, not in rows
    expect(c.code.some((rng) => rng.start <= 0x0810 && rng.end >= 0x0810)).toBe(true);
  });

  it("skips I/O-only and ROM-only rows (--- in RAM column) from code/data/written_only", () => {
    const r = rows(["d019 -w- --- ---", "ff48 --- --x ---"]);
    const c = classifyCoverage(r, noCode);
    expect(c.code).toEqual([]);
    expect(c.data).toEqual([]);
    expect(c.written_only).toEqual([]);
  });

  it("reports unknown ranges for untouched $0000-$FFFF addresses", () => {
    // Only address $0900 is code; everything else is unknown
    const r = rows(["0900 --- --- --x"]);
    const c = classifyCoverage(r, new Set([0x0900]));
    // unknown must cover $0000-$08FF and $0901-$FFFF
    const totalUnknown = c.unknown.reduce((s, rng) => s + (rng.end - rng.start + 1), 0);
    expect(totalUnknown).toBe(0x10000 - 1); // 65535 addresses unknown
  });

  it("parses and classifies the verbatim fixture file", () => {
    const text = readFileSync(join(import.meta.dirname, "fixtures", "re", "memmap.monlog"), "utf8");
    const r = parseMemmapLog(text);
    // Without instruction extension; use noCode to keep it simple
    const c = classifyCoverage(r, noCode);
    // $0846 ($085D, $0874) are --x → with noCode, they end up... wait, noCode means NOT in codeSet.
    // So --x rows not in codeSet would be classified as... let's check.
    // kindsOf("--x") has 'x'. If addr not in codeSet: goes to data? No: data is 'r' but no 'x'.
    // Actually looking at classifyCoverage: code = codeSet; data = rows with 'r' not in codeSet;
    // written_only = rows with 'w', no 'r', not in codeSet. Rows with only 'x' but not in codeSet
    // are SKIPPED (they're not data or written_only).
    // For fixture test with noCode: --x rows are skipped, rw- rows are data.
    expect(c.data.some((rng) => rng.start <= 0x0314 && rng.end >= 0x0314)).toBe(true);
    // unknown must be large (most of 64KB untouched)
    expect(c.unknown.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// VICE integration test (skipped without windowless x64sc + KickAssembler)
// ---------------------------------------------------------------------------

const tools = findToolchains();
const x64sc = resolveX64sc();
const canRun = x64sc !== null && !x64sc.windowed && tools.kickass !== null && tools.java !== null;

describe.skipIf(!canRun)(
  "c64_re_coverage in VICE, on the jmp-indirect fixture PRG (two passes, clock-based)",
  () => {
    function buildPrg(): string {
      const dir = mkdtempSync(join(tmpdir(), "re-cov-"));
      copyFileSync(join(import.meta.dirname, "fixtures", "re", "jmp-indirect.asm"), join(dir, "t.asm"));
      expect(
        spawnSync(tools.java ?? "java", ["-jar", tools.kickass ?? "", "t.asm", "-o", "t.prg"], {
          cwd: dir,
        }).status,
      ).toBe(0);
      return join(dir, "t.prg");
    }

    it("refuses a PRG with no SYS line", async () => {
      const dir = mkdtempSync(join(tmpdir(), "re-cov-"));
      const nosys = join(dir, "nosys.prg");
      writeFileSync(nosys, Buffer.from([0x01, 0x08, 0xea, 0xea]));
      const r = await reCoverage({ prg_path: nosys });
      expect(r).toMatchObject({ ok: false, reason: "no-entry" });
    }, 5000);

    it("shows all three slot handlers ($085D, $0874) in executed ranges with frames=2", async () => {
      const prg = buildPrg();
      // frames=2: pass 1 measures d019PerFrame≈4 (setup+3 parts), preEntryD019≈1 (KERNAL).
      // Pass 2 shows at ≈ entry_clock + 2 × frame_cycles, covering both IRQ cycles.
      const r = await reCoverage({ prg_path: prg, cycles: 4_000_000, frames: 2 });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      // Span must be positive (show fired after entry)
      expect(r.result.show_clock).toBeGreaterThan(0);
      expect(r.result.span_cycles).toBeGreaterThan(0);
      expect(r.result.span_frames).toBeGreaterThan(0);
      // Code ranges must include $080e (program entry)
      const inCode = (addr: number) => r.result.code.some((rng) => rng.start <= addr && rng.end >= addr);
      expect(inCode(0x080e)).toBe(true);
      // All three slot handlers must be code
      expect(inCode(0x0846)).toBe(true); // part1
      expect(inCode(0x085d)).toBe(true); // part2
      expect(inCode(0x0874)).toBe(true); // part3
      // Unknown ranges cover most of 64KB
      const totalUnknown = r.result.unknown.reduce((s, rng) => s + (rng.end - rng.start + 1), 0);
      expect(totalUnknown).toBeGreaterThan(0x8000); // more than half of 64KB is unknown
      expect(r.result.unknowns).toEqual([]);
    }, 120_000);
  },
);
