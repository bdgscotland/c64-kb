import { describe, it, expect, vi } from "vitest";
import { parseHardwareDoc } from "../src/graph/extract/hardware.ts";
import { formatClobbers, parseClobbers } from "../src/graph/kernal-clobbers.ts";

// The **Clobbers zero page:** line under a KERNAL routine H3 (schema 26).
const routine = (lines: string) => `---
type: hardware-reference
---
### $FFBA — SETLFS — Set logical file parameters

**Input:** A = logical file number
**Affects:** None
${lines}
**Pairs with:** SETNAM
`;

describe("parseClobbers", () => {
  it("parses ranges, bound and basis, merging touching ranges", () => {
    expect(parseClobbers("$B8, $B9-$BA, $01 (may; ROM walk from $FFBA)")).toEqual({
      ranges: [
        [0x01, 0x01],
        [0xb8, 0xba],
      ],
      bound: "may",
      basis: "ROM walk from $FFBA",
    });
  });

  it("keeps a basis that has its own parentheses", () => {
    const c = parseClobbers("$90 (must; VICE x64sc store trace, OPEN on drive 8 (true drive emulation))");
    expect(c).toMatchObject({
      bound: "must",
      basis: "VICE x64sc store trace, OPEN on drive 8 (true drive emulation)",
    });
  });

  it("reads none as the empty set and round-trips through formatClobbers", () => {
    const c = parseClobbers("none (may; ROM walk from $FFED)");
    expect(c).toEqual({ ranges: [], bound: "may", basis: "ROM walk from $FFED" });
    if (!("error" in c)) expect(formatClobbers(c)).toBe("none (may; ROM walk from $FFED)");
  });

  it("refuses a missing bound, a bad byte and a backwards range", () => {
    expect(parseClobbers("$B8-$BA")).toHaveProperty("error");
    expect(parseClobbers("$B8-$BA (maybe; walk)")).toHaveProperty("error");
    expect(parseClobbers("$B8-$BAA (may; walk)")).toHaveProperty("error");
    expect(parseClobbers("$BA-$B8 (may; walk)")).toHaveProperty("error");
  });
});

describe("parseHardwareDoc: CLOBBERS_ZP entities", () => {
  it("emits one entity per line, may and must, with canonical ranges", () => {
    const e = parseHardwareDoc(
      routine(`**Clobbers zero page:** $B8-$BA (may; ROM walk from $FFBA)
**Clobbers zero page:** $B8-$BA (must; VICE x64sc store trace, SETLFS 2,8,2)`),
    ).filter((x) => x.type === "kernal_clobbers_zp");
    expect(e).toEqual([
      {
        type: "kernal_clobbers_zp",
        routine: "SETLFS",
        ranges: "B8-BA",
        bound: "may",
        basis: "ROM walk from $FFBA",
      },
      {
        type: "kernal_clobbers_zp",
        routine: "SETLFS",
        ranges: "B8-BA",
        bound: "must",
        basis: "VICE x64sc store trace, SETLFS 2,8,2",
      },
    ]);
  });

  it("keeps none as an edge with empty ranges", () => {
    const e = parseHardwareDoc(routine("**Clobbers zero page:** none (may; ROM walk from $FFBA)"));
    expect(e.find((x) => x.type === "kernal_clobbers_zp")).toMatchObject({ ranges: "" });
  });

  it("warns about and drops a line that does not parse", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const e = parseHardwareDoc(routine("**Clobbers zero page:** $B8 to $BA"));
    expect(e.some((x) => x.type === "kernal_clobbers_zp")).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/SETLFS: \*\*Clobbers zero page:\*\* refused/));
  });

  it("the routine node still parses beside the line", () => {
    const e = parseHardwareDoc(routine("**Clobbers zero page:** $B8-$BA (may; ROM walk from $FFBA)"));
    expect(e[0]).toMatchObject({ type: "kernal_routine", name: "SETLFS", affects: "None" });
  });
});
