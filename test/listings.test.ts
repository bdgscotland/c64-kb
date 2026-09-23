import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";

// Every recipe listing in docs/recipes/ must build with the toolchain it is
// written for, and every KickAssembler fragment elsewhere in docs/ must at
// least assemble. scripts/check-listings.ts does the work; this wrapper runs
// it with --allow-missing so a machine without the toolchains reports the
// gap loudly instead of failing, and any listing that a present toolchain
// rejects fails the suite.
//
// Set KICKASS_JAR, OSCAR64 and/or CL65 (see the script header) to enable
// each toolchain. `npm run check:listings` runs the strict form.

describe("code listings build", () => {
  it("every recipe builds and every KickAssembler fragment assembles", () => {
    const r = spawnSync("node", ["scripts/check-listings.ts", "--allow-missing"], {
      encoding: "utf8",
      timeout: 600_000,
    });
    const out = r.stdout + r.stderr;
    if (/toolchains not found/.test(out)) {
      console.warn(out.split("\n").filter((l) => /toolchains not found|skipped/.test(l)).join("\n"));
    }
    expect(out, out).not.toMatch(/^FAIL/m);
    expect(r.status, out).toBe(0);
  });
});
