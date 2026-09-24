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

describe("runBatch refusals", () => {
  it("refuses a missing PRG before launching anything", () => {
    expect(() => runBatch({ prg: "/nonexistent.prg", monCommands: "", cycles: 1000, model: "pal" })).toThrow(
      ViceBatchError,
    );
  });
});

describe.skipIf(!canRun)("runBatch in VICE", () => {
  it("runs a PRG under -moncommands and returns a log with the traced store", () => {
    const dir = mkdtempSync(join(tmpdir(), "vice-batch-test-"));
    writeFileSync(join(dir, "t.asm"), "BasicUpstart2(start)\nstart: lda #$2a\n    sta $d012\n    jmp *\n");
    const asm = spawnSync(tools.java ?? "java", ["-jar", tools.kickass ?? "", "t.asm", "-o", "t.prg"], {
      cwd: dir,
    });
    expect(asm.status).toBe(0);
    const r = runBatch({
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

  it("gives the same traced raster line on two separate runs (+autostart-delay-random)", () => {
    const dir = mkdtempSync(join(tmpdir(), "vice-batch-test-"));
    writeFileSync(join(dir, "t.asm"), "BasicUpstart2(start)\nstart: lda #$2a\n    sta $d012\n    jmp *\n");
    const asm = spawnSync(tools.java ?? "java", ["-jar", tools.kickass ?? "", "t.asm", "-o", "t.prg"], {
      cwd: dir,
    });
    expect(asm.status).toBe(0);
    const lineOf = (): number | null => {
      const r = runBatch({
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
    const first = lineOf();
    const second = lineOf();
    expect(first).not.toBeNull();
    expect(second).toBe(first);
  }, 60_000);
});
