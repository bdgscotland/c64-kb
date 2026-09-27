import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { resolveX64sc } from "../src/services/vice-bin.ts";
import { runBatch, ViceBatchError } from "../src/services/vice-batch.ts";
import { findToolchains } from "../scripts/lib/toolchains.ts";

const tools = findToolchains();
const x64sc = resolveX64sc();
const canRun = x64sc !== null && !x64sc.windowed && tools.kickass !== null && tools.java !== null;

/** Every mkdtemp directory a test makes, removed after the file's tests. */
const made: string[] = [];
const tempDir = (prefix: string): string => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  made.push(d);
  return d;
};
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

const reasonOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return "resolved";
  } catch (e) {
    return e instanceof ViceBatchError ? e.reason : String(e);
  }
};

describe("runBatch refusals", () => {
  const prg = join(tempDir("vice-batch-refusal-"), "p.prg");
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

/** A stand-in x64sc: a shell script that writes to its -monlogname file, forever or once. */
function fakeX64sc(forever: boolean): () => { path: string; kind: "env"; windowed: boolean } {
  const dir = tempDir("fake-x64sc-");
  const bin = join(dir, "x64sc");
  const write = forever
    ? 'while :; do echo "#1 (Trace store 0400)  0/$000,  0/$00" >> "$log"; done'
    : 'echo "#1 (Trace store 0400)  0/$000,  0/$00" > "$log"; exit 1';
  writeFileSync(
    bin,
    `#!/bin/sh\nwhile [ $# -gt 0 ]; do [ "$1" = "-monlogname" ] && log="$2"; shift; done\n${write}\n`,
    { mode: 0o755 },
  );
  return () => ({ path: bin, kind: "env", windowed: false });
}

describe("runBatch log cap", () => {
  const prg = join(tempDir("vice-batch-cap-"), "p.prg");
  writeFileSync(prg, Buffer.from([0x01, 0x08, 0x00, 0x00]));
  const run = { prg, monCommands: "", cycles: 1000, model: "pal" as const };

  it("stops the emulator once the log passes maxLogBytes and says the log was truncated", async () => {
    const r = await runBatch({ ...run, maxLogBytes: 200_000 }, fakeX64sc(true));
    try {
      expect(r.truncated).toBe(true);
      expect(statSync(r.log).size).toBeGreaterThanOrEqual(200_000);
    } finally {
      r.dispose();
    }
  }, 30_000);

  it("a run that ends by itself under the cap is not truncated", async () => {
    const r = await runBatch({ ...run, maxLogBytes: 200_000 }, fakeX64sc(false));
    expect(r.truncated).toBe(false);
    r.dispose();
  });
});

describe.skipIf(!canRun)("runBatch in VICE", () => {
  it("runs a PRG under -moncommands and returns a log with the traced store", async () => {
    const dir = tempDir("vice-batch-test-");
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
    const dir = tempDir("vice-batch-test-");
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

  /**
   * VICE -default sets RAMInitRandomChance=10: power-on RAM bits are flipped
   * with a per-run random seed, so two runs at the same clock can differ in
   * one or more bytes (measured: two c64_re_snapshot runs at clock 35,080,026
   * differed at $07EA: $FB vs $FF; four default irq-chain recipe runs gave
   * two distinct RAM images). runBatch passes -raminitrandomchance 0, which
   * forces a fixed seed, making RAM byte-for-byte identical across runs.
   */
  it("-raminitrandomchance 0 makes power-on RAM identical across two runs at the same checkpoint", async () => {
    const dir = tempDir("vice-batch-ram-det-");
    writeFileSync(join(dir, "t.asm"), "BasicUpstart2(start)\nstart: lda #$2a\n    sta $d012\n    jmp *\n");
    const asm = spawnSync(tools.java ?? "java", ["-jar", tools.kickass ?? "", "t.asm", "-o", "t.prg"], {
      cwd: dir,
    });
    expect(asm.status).toBe(0);
    // Checkpoint 1 fires on the first sta $d012; save all RAM then disable.
    const monCommands =
      'trace store d012 d012\ncommand 1 "bank ram; save \\"ram.bin\\" 0 0000 ffff; disable 1"\n';
    const dumpOf = async (): Promise<Buffer> => {
      const r = await runBatch({
        prg: join(dir, "t.prg"),
        monCommands,
        cycles: 4_000_000,
        model: "pal",
      });
      try {
        const p = join(r.work, "ram.bin");
        return existsSync(p) ? readFileSync(p) : Buffer.alloc(0);
      } finally {
        r.dispose();
      }
    };
    const a = await dumpOf();
    const b = await dumpOf();
    expect(a.length).toBe(65538); // 2-byte load-address header + 64 KB
    expect(b.length).toBe(65538);
    expect(a.equals(b)).toBe(true);
  }, 120_000);
});
