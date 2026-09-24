import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveX64sc } from "../src/services/vice-bin.ts";
import { runBatch, ViceBatchError } from "../src/services/vice-batch.ts";
import { findToolchains } from "../scripts/lib/toolchains.ts";

const tools = findToolchains();
const x64sc = resolveX64sc();
const canRun = x64sc !== null && !x64sc.windowed && tools.kickass !== null && tools.java !== null;

const reasonOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return "resolved";
  } catch (e) {
    return e instanceof ViceBatchError ? e.reason : String(e);
  }
};

describe("runBatch refusals", () => {
  const prg = join(mkdtempSync(join(tmpdir(), "vice-batch-refusal-")), "p.prg");
  writeFileSync(prg, Buffer.from([0x01, 0x08, 0x00, 0x00]));
  const run = { prg, monCommands: "", cycles: 1000, model: "pal" as const };

  it("refuses a missing PRG before launching anything", async () => {
    expect(await reasonOf(runBatch({ ...run, prg: "/nonexistent.prg" }))).toBe("no-prg");
  });
  it("refuses when no x64sc is found", async () => {
    expect(await reasonOf(runBatch(run, () => null))).toBe("no-x64sc");
  });
  it("refuses a windowed x64sc", async () => {
    const windowed = () => ({ path: "/usr/bin/true", kind: "path" as const, windowed: true });
    expect(await reasonOf(runBatch(run, windowed))).toBe("windowed");
  });
  it("refuses a disk that is missing or not a .d64", async () => {
    expect(await reasonOf(runBatch({ ...run, disk: "/nonexistent.d64" }))).toBe("disk");
    expect(await reasonOf(runBatch({ ...run, disk: prg }))).toBe("disk");
  });
});

describe.skipIf(!canRun)("runBatch in VICE", () => {
  it("runs a PRG under -moncommands and returns a log with the traced store", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vice-batch-test-"));
    writeFileSync(join(dir, "t.asm"), "BasicUpstart2(start)\nstart: lda #$2a\n    sta $d012\n    jmp *\n");
    const asm = spawnSync(tools.java ?? "java", ["-jar", tools.kickass ?? "", "t.asm", "-o", "t.prg"], {
      cwd: dir,
    });
    expect(asm.status).toBe(0);
    const r = await runBatch({
      prg: join(dir, "t.prg"),
      monCommands: "trace store d012 d012\n",
      cycles: 4_000_000,
      model: "pal",
    });
    try {
      expect(readFileSync(r.log, "utf8")).toMatch(/Trace store d012/);
    } finally {
      r.dispose();
    }
    expect(existsSync(r.work)).toBe(false);
  }, 60_000);

  it("gives the same traced raster line on two separate runs (+autostart-delay-random)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vice-batch-test-"));
    writeFileSync(join(dir, "t.asm"), "BasicUpstart2(start)\nstart: lda #$2a\n    sta $d012\n    jmp *\n");
    const asm = spawnSync(tools.java ?? "java", ["-jar", tools.kickass ?? "", "t.asm", "-o", "t.prg"], {
      cwd: dir,
    });
    expect(asm.status).toBe(0);
    const lineOf = async (): Promise<number | null> => {
      const r = await runBatch({
        prg: join(dir, "t.prg"),
        monCommands: "trace store d012 d012\n",
        cycles: 4_000_000,
        model: "pal",
      });
      try {
        const head = readFileSync(r.log, "utf8")
          .split("\n")
          .find((l) => l.includes("Trace store d012"));
        const m = head ? /(\d+)\/\$[0-9a-f]+,/.exec(head) : null;
        return m?.[1] ? Number(m[1]) : null;
      } finally {
        r.dispose();
      }
    };
    const first = await lineOf();
    const second = await lineOf();
    expect(first).not.toBeNull();
    expect(second).toBe(first);
  }, 60_000);
});
