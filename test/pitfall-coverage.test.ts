import { execFileSync } from "node:child_process";
import { describe, it, expect } from "vitest";

describe("check-pitfall-coverage (#19)", () => {
  it("lists registers and KERNAL routines no pitfall names, and exits 0", () => {
    const out = execFileSync(process.execPath, ["scripts/check-pitfall-coverage.ts"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    expect(out).toMatch(/^\d+ registers documented; \d+ named by a pitfall; \d+ not$/m);
    expect(out).toMatch(/^\d+ KERNAL routines documented; \d+ named by a pitfall; \d+ not$/m);
    // SCNKEY is on the keyboard pitfalls' Triggered-by kernal line: never listed as bare.
    expect(out).not.toMatch(/^ {2}\$FF9F +SCNKEY /m);
    // A bare register row carries access and the technique count.
    expect(out).toMatch(/^ {2}\$[0-9A-F]{4} +\w+ +\S+ +(R|W|RW) +\d+ {2}\S/m);
  });
});
