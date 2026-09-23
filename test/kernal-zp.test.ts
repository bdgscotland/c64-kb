import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { findKernal, KernalWalker, toRanges } from "../scripts/lib/kernal-walk.ts";
import {
  KERNAL_PAGE,
  applyWalkToPage,
  pageDisagreements,
  walkAll,
  type WalkAll,
} from "../scripts/lib/kernal-zp-page.ts";
import { formatClobberRanges } from "../src/graph/kernal-clobbers.ts";

// The ROM walk behind the **Clobbers zero page:** lines. The walk tests need the KERNAL 901227-03 image (a VICE
// install, the repo's headless VICE, or KERNAL_ROM); without it they skip
// and say so, and the page stays the committed result.
const root = join(import.meta.dirname, "..");
const rom = findKernal(root);
const page = readFileSync(join(root, KERNAL_PAGE), "utf8");
if (!rom) console.warn("kernal-zp.test: no KERNAL 901227-03 image; the ROM walk checks are skipped");

describe.skipIf(!rom)("kernal-zp-walk against the ROM", () => {
  const walk = rom ? walkAll(rom.bytes, page) : ({} as WalkAll);
  const byName = (n: string) => walk.routines.find((r) => r.name === n);

  it("the page agrees with the walk (kernal-zp-walk --check)", () => {
    expect(pageDisagreements(page, walk)).toEqual([]);
  });

  it("covers all 39 jump-table slots, every one resolved", () => {
    expect(walk.routines).toHaveLength(39);
    expect(walk.missingSlots).toEqual([]);
    for (const r of walk.routines) {
      expect(r.unresolved, r.name).toEqual([]);
      expect(r.unboundedIndex, r.name).toEqual([]);
      expect(r.badOpcode, r.name).toEqual([]);
      expect(r.outside, r.name).toEqual([]);
    }
  });

  it("gives the small routines the sets their Affects lines state", () => {
    expect(byName("SETLFS")?.bytes).toEqual(["$B8", "$B9", "$BA"]);
    expect(byName("SETNAM")?.bytes).toEqual(["$B7", "$BB", "$BC"]);
    expect(byName("SETTIM")?.bytes).toEqual(["$A0", "$A1", "$A2"]);
    expect(byName("SCREEN")?.bytes).toEqual([]);
  });

  it("follows $028F through CINT's default, so SCNKEY is resolved", () => {
    expect(byName("SCNKEY")?.followed).toEqual(["$028F"]);
  });

  it("does not run the BRK handler from the tape code's fake IRQ at $FF43", () => {
    // JMP ($0316) leads to the warm start: IOINIT writes $00, and the path
    // leaves through JMP ($A002) into BASIC. Neither may show in CHROUT.
    const chrout = byName("CHROUT");
    expect(chrout?.bytes).not.toContain("$00");
    expect(chrout?.unresolved).toEqual([]);
    for (const b of ["$02", "$8F", "$FB", "$FE"]) expect(chrout?.bytes).not.toContain(b);
  });

  it("counts the tape IRQ handlers LOAD installs", () => {
    // $A7 is written only by the tape read handlers reached through $FD9B.
    expect(byName("LOAD")?.bytes).toContain("$A7");
    expect(byName("SETLFS")?.bytes).not.toContain("$A7");
  });

  it("expands the line-link table stores to their rows, not all of zero page, not all of zero page", () => {
    const cint = rom ? new KernalWalker(rom.bytes).walk(0xff81) : null;
    expect(formatClobberRanges(toRanges(cint?.bytes ?? []))).toContain("$D9-$F4");
    expect(cint?.bytes.has(0x02)).toBe(false);
  });

  it("writes a missing line after **Affects:** and leaves a current page unchanged", () => {
    expect(applyWalkToPage(page, walk)).toBe(page);
    const stripped = page.replace(/^\*\*Clobbers zero page:\*\* \$B8-\$BA \(may;.*\n/m, "");
    expect(pageDisagreements(stripped, walk).some((d) => d.startsWith("SETLFS"))).toBe(true);
    expect(applyWalkToPage(stripped, walk)).toBe(page);
  });

  it("refuses a must line with a byte outside the may set", () => {
    const bad = page.replace(
      "**Clobbers zero page:** $B8-$BA (must;",
      "**Clobbers zero page:** $B8-$BA, $FB (must;",
    );
    expect(pageDisagreements(bad, walk)).toContain("SETLFS: must byte $FB is outside the walk's may set");
  });
});
