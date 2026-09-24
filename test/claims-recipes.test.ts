import { spawn } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveX64sc } from "../src/services/vice-bin.ts";
import { findToolchains } from "../scripts/lib/toolchains.ts";

// The claims gate (#84): every runnable KickAssembler recipe, built and run
// in VICE under claims-watch, makes no store its page does not declare.
// Skipped without a windowless x64sc or KickAssembler, like the VICE block
// of claims-watch.test.ts. About a minute with six recipes at once.
const root = join(import.meta.dirname, "..");
const x64sc = resolveX64sc();
const tools = findToolchains();
const canRun = x64sc !== null && !x64sc.windowed && tools.kickass !== null && tools.java !== null;
if (!canRun)
  console.warn("claims-recipes.test: no windowless x64sc or no KickAssembler; the recipe gate is skipped");

function runGate(): Promise<{ status: number | null; out: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(root, "scripts/claims-recipes.ts"), "--jobs", "6"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (b: Buffer) => (out += b.toString()));
    child.stderr.on("data", (b: Buffer) => (out += b.toString()));
    child.on("error", reject);
    child.on("close", (status) => {
      resolve({ status, out });
    });
  });
}

describe.skipIf(!canRun)("claims-watch over the KickAssembler recipes", () => {
  it("finds no undeclared store in any runnable recipe", async () => {
    const r = await runGate();
    const failed = r.out.split("\n").filter((l) => l.startsWith("FAIL"));
    expect(failed).toEqual([]);
    expect(r.status).toBe(0);
  }, 900_000);
});
