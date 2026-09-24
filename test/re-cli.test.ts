import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const cli = join(import.meta.dirname, "..", "src", "cli.ts");
const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });

describe("re-irq-chain / re-frame-profile options", () => {
  it("refuses --cycles below 100000 or not an integer, before any run", () => {
    for (const c of ["5", "1e6x", "150000.5"]) {
      const r = run("re-irq-chain", "/tmp/none.prg", "--cycles", c);
      expect(r.status, c).toBe(1);
      expect(r.stderr, c).toMatch(/cycles/i);
    }
  });
  it("refuses a --model other than pal or ntsc", () => {
    const r = run(
      "re-frame-profile",
      "/tmp/none.prg",
      "--start",
      "pc:$1000",
      "--stop",
      "pc:$1001",
      "--model",
      "secam",
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/pal, ntsc/);
  });
  it("re-irq-chain takes --disk", () => {
    const r = run("re-irq-chain", "--help");
    expect(r.stdout).toMatch(/--disk <d64>/);
  });
});
