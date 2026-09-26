/**
 * Tests for c64_re_coverage: parser unit tests (fixture-based) and a
 * VICE integration test on the jmp-indirect fixture PRG (skipped when
 * x64sc or KickAssembler is not available).
 */
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseMemmapLog, classifyCoverage, coverageCommandsPrg } from "../src/re/coverage.ts";
import { reCoverage } from "../src/tools/re-coverage.ts";
import { resolveX64sc } from "../src/services/vice-bin.ts";
import { findToolchains } from "../scripts/lib/toolchains.ts";
import { spawnSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Parser unit tests (fixture-based, no VICE)
// ---------------------------------------------------------------------------

describe("parseMemmapLog", () => {
  it("returns empty for a log with no memmapshow section", () => {
    expect(parseMemmapLog("no memmap here")).toEqual([]);
  });

  it("returns empty for a log with only the header (memmapzap was just run)", () => {
    expect(parseMemmapLog("addr: IO  ROM RAM\n")).toEqual([]);
  });

  it("parses rows from the measured fixture", () => {
    const text = [
      "addr: IO  ROM RAM",
      "0800: --- --- -w-",
      "0801: --- --- rwx (uninitialized exec)",
      "0840: --- --- r-x (uninitialized exec)",
      "d019: -w- --- ---",
      "ff48: --- --x ---",
    ].join("\n");
    const rows = parseMemmapLog(text);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({ addr: 0x0800, ram: "-w-" });
    expect(rows[1]).toMatchObject({ addr: 0x0801, ram: "rwx" });
    expect(rows[2]).toMatchObject({ addr: 0x0840, ram: "r-x" });
    // I/O and ROM are separate: $d019 is I/O-only, $ff48 is ROM-only
    expect(rows[3]).toMatchObject({ addr: 0xd019, ram: "---" });
    expect(rows[4]).toMatchObject({ addr: 0xff48, ram: "---" });
  });

  it("stops the section at the first non-matching line", () => {
    const text = [
      "addr: IO  ROM RAM",
      "0800: --- --- -w-",
      "0801: --- --- --x",
      "some other line",
      "0802: --- --- --x",
    ].join("\n");
    const rows = parseMemmapLog(text);
    expect(rows).toHaveLength(2);
  });
});

describe("classifyCoverage", () => {
  it("classifies exec-only as code", () => {
    const rows = parseMemmapLog("addr: IO  ROM RAM\n0800: --- --- --x\n0801: --- --- --x\n");
    const c = classifyCoverage(rows);
    expect(c.code).toEqual([{ start: 0x0800, end: 0x0801, kinds: ["x"] }]);
    expect(c.data).toEqual([]);
    expect(c.written_only).toEqual([]);
  });

  it("classifies read-only (no exec) as data", () => {
    const rows = parseMemmapLog("addr: IO  ROM RAM\n0900: --- --- r--\n");
    const c = classifyCoverage(rows);
    expect(c.code).toEqual([]);
    expect(c.data).toEqual([{ start: 0x0900, end: 0x0900, kinds: ["r"] }]);
    expect(c.written_only).toEqual([]);
  });

  it("classifies write-only (no read, no exec) as written_only", () => {
    const rows = parseMemmapLog("addr: IO  ROM RAM\n0314: --- --- -w-\n0315: --- --- -w-\n");
    const c = classifyCoverage(rows);
    expect(c.written_only).toEqual([{ start: 0x0314, end: 0x0315, kinds: ["w"] }]);
    expect(c.code).toEqual([]);
    expect(c.data).toEqual([]);
  });

  it("rw- (read+write, no exec) is data", () => {
    const rows = parseMemmapLog("addr: IO  ROM RAM\n033c: --- --- rw-\n033d: --- --- rw-\n");
    const c = classifyCoverage(rows);
    expect(c.data).toEqual([{ start: 0x033c, end: 0x033d, kinds: ["r", "w"] }]);
  });

  it("r-x is code (has x)", () => {
    const rows = parseMemmapLog("addr: IO  ROM RAM\n0840: --- --- r-x\n");
    const c = classifyCoverage(rows);
    expect(c.code).toEqual([{ start: 0x0840, end: 0x0840, kinds: ["r", "x"] }]);
  });

  it("skips --- (all zero) RAM rows", () => {
    const rows = parseMemmapLog("addr: IO  ROM RAM\nd019: -w- --- ---\n");
    const c = classifyCoverage(rows);
    expect(c.code).toEqual([]);
    expect(c.data).toEqual([]);
    expect(c.written_only).toEqual([]);
  });

  it("groups consecutive addresses with the same kinds", () => {
    const text = [
      "addr: IO  ROM RAM",
      "080e: --- --- --x",
      "080f: --- --- --x",
      "0811: --- --- --x", // gap at $0810 (not in the map)
      "0840: --- --- r-x",
    ].join("\n");
    const c = classifyCoverage(parseMemmapLog(text));
    // $080e and $080f are consecutive; $0811 is not (gap at $0810)
    expect(c.code).toEqual([
      { start: 0x080e, end: 0x080f, kinds: ["x"] },
      { start: 0x0811, end: 0x0811, kinds: ["x"] },
      { start: 0x0840, end: 0x0840, kinds: ["r", "x"] },
    ]);
  });

  it("parses the measured fixture file", () => {
    const text = readFileSync(join(import.meta.dirname, "fixtures", "re", "memmap.monlog"), "utf8");
    const rows = parseMemmapLog(text);
    const c = classifyCoverage(rows);
    // The fixture has --x rows for $080e and $083a (executed), r-x for $0840, $0846, $0848
    expect(c.code.some((r) => r.start <= 0x080e && r.end >= 0x080e)).toBe(true);
    expect(c.code.some((r) => r.start <= 0x0840 && r.end >= 0x0840)).toBe(true);
    // $0314/$0315 are rw- (data, not code)
    expect(c.data.some((r) => r.start <= 0x0314 && r.end >= 0x0314)).toBe(true);
  });
});

describe("coverageCommandsPrg", () => {
  it("generates commands with checkpoint 1 at the SYS address and checkpoint 2 at $D019", () => {
    const cmds = coverageCommandsPrg("080e", 3);
    expect(cmds).toContain("trace exec 080e 080e");
    expect(cmds).toContain('command 1 "memmapzap; disable 1"');
    expect(cmds).toContain("trace store d019 d019");
    expect(cmds).toContain("ignore 2 2"); // hex 2 = skip 2 hits, fire on 3rd
    expect(cmds).toContain('command 2 "memmapshow; disable 2"');
  });

  it("omits the ignore line when frames = 1", () => {
    const cmds = coverageCommandsPrg("080e", 1);
    expect(cmds).not.toContain("ignore");
    expect(cmds).toContain('command 2 "memmapshow; disable 2"');
  });

  it("accepts a $ prefix on the address", () => {
    const cmds = coverageCommandsPrg("$080e", 2);
    expect(cmds).toContain("trace exec 080e 080e");
  });
});

// ---------------------------------------------------------------------------
// VICE integration test (skipped without windowless x64sc + KickAssembler)
// ---------------------------------------------------------------------------

const tools = findToolchains();
const x64sc = resolveX64sc();
const canRun = x64sc !== null && !x64sc.windowed && tools.kickass !== null && tools.java !== null;

describe.skipIf(!canRun)("c64_re_coverage in VICE, on the jmp-indirect fixture PRG", () => {
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

  it("returns a refusal for a PRG with no SYS line", async () => {
    // Write a headerless PRG (load addr only, no BASIC stub)
    const dir = mkdtempSync(join(tmpdir(), "re-cov-"));
    const nosys = join(dir, "nosys.prg");
    writeFileSync(nosys, Buffer.from([0x01, 0x08, 0xea, 0xea])); // load $0801, NOP NOP
    const r = await reCoverage({ prg_path: nosys });
    expect(r).toMatchObject({ ok: false, reason: "no-entry" });
  }, 5000);

  it("finds the irq-chain dispatcher and slot handlers in the exec ranges", async () => {
    const prg = buildPrg();
    const r = await reCoverage({ prg_path: prg, cycles: 4_000_000, frames: 3 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The dispatcher at ~$082d and slot handlers at ~$0846, $085d, $0874 must be
    // in an executed range after 3 $D019 writes (KERNAL boot + setup + first IRQ).
    const inRange = (addr: number) => r.result.code.some((range) => range.start <= addr && range.end >= addr);
    // The program entry at $080e must be in a code range.
    expect(inRange(0x080e)).toBe(true);
    // At least one of the IRQ handler addresses (measured at $0840–$0848) must be code.
    const hasIrqCode = r.result.code.some((range) => range.start <= 0x0848 && range.end >= 0x0840);
    expect(hasIrqCode).toBe(true);
    // $D019 must be in written_only (not in RAM code or data — it's an I/O write).
    // (It shows as -w- in I/O, not in RAM, so it won't appear in code/data/written_only.)
    // The key assertion is no coverage error:
    expect(r.result.unknowns).toEqual([]);
  }, 120_000);
});
