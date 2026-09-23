import { describe, it, expect } from "vitest";
import { extractGraphEntities } from "../src/graph/extract.ts";

describe("extractGraphEntities — Register", () => {
  it("extracts a single register from a hardware-reference doc", () => {
    const md = `# VIC-II reference

## Quick reference

(table)

## Detail

### $D011 — D011 — Screen Control Register 1 (RW)

**Chip:** VIC-II

The screen control register.

<!-- doc-type: hardware-reference -->
`;
    const entities = extractGraphEntities(md, "vic-ii-reference.md");
    const regs = entities.filter((e): e is Extract<typeof e, { type: "register" }> => e.type === "register");
    expect(regs).toHaveLength(1);
    expect(regs[0]).toEqual({
      type: "register",
      name: "D011",
      address: "$D011",
      chip: "VIC-II",
      rw: "RW",
      aliases: [],
    });
  });

  it("emits hex-form alias when canonical name is a mnemonic", () => {
    const md = `# VIC-II

### $D011 — SCROLY — Screen control 1 (RW)

**Chip:** VIC-II

<!-- doc-type: hardware-reference -->
`;
    const entities = extractGraphEntities(md, "vic-ii-reference.md");
    const reg = entities.find((e): e is Extract<typeof e, { type: "register" }> => e.type === "register");
    expect(reg?.name).toBe("SCROLY");
    expect(reg?.aliases).toEqual(["D011"]);
  });

  it("extracts multiple registers and uses the doc's frontmatter chip as fallback", () => {
    const md = `---
chip: SID
---

# SID reference

### $D400 — D400 — Voice 1 frequency low (W)

Voice 1 freq low byte.

### $D401 — D401 — Voice 1 frequency high (W)

**Chip:** SID

Voice 1 freq high byte.

<!-- doc-type: hardware-reference -->
`;
    const entities = extractGraphEntities(md, "sid-reference.md");
    const regs = entities.filter((e): e is Extract<typeof e, { type: "register" }> => e.type === "register");
    expect(regs).toHaveLength(2);
    expect(regs.map((r) => r.name)).toEqual(["D400", "D401"]);
    expect(regs.every((r) => r.chip === "SID")).toBe(true);
  });
});

describe("extractGraphEntities — KernalRoutine", () => {
  it("extracts a routine and its PAIRS_WITH edges", () => {
    const md = `# KERNAL

### $FFD2 — CHROUT — Output a character

**Input:** A = byte to print
**Output:** None
**Affects:** A
**Pairs with:** CHRIN, GETIN

Description.

<!-- doc-type: hardware-reference -->
`;
    const entities = extractGraphEntities(md, "kernal-routines-reference.md");
    const routines = entities.filter(
      (e): e is Extract<typeof e, { type: "kernal_routine" }> => e.type === "kernal_routine",
    );
    const pairs = entities.filter(
      (e): e is Extract<typeof e, { type: "pairs_with" }> => e.type === "pairs_with",
    );
    expect(routines).toHaveLength(1);
    expect(routines[0]).toMatchObject({ name: "CHROUT", address: "$FFD2" });
    expect(pairs).toHaveLength(2);
    expect(pairs.map((p) => p.b).sort()).toEqual(["CHRIN", "GETIN"]);
    expect(pairs.every((p) => p.a === "CHROUT")).toBe(true);
  });
});

describe("extractGraphEntities — MemoryRegion", () => {
  it("extracts a memory region range", () => {
    const md = `# Memory map

### $0400-$07FF — Default Screen RAM

**Default use:** Screen character codes (1000 bytes used; rest is screen padding)
**Bank-switchable:** No

<!-- doc-type: hardware-reference -->
`;
    const entities = extractGraphEntities(md, "c64-memory-map.md");
    const regions = entities.filter(
      (e): e is Extract<typeof e, { type: "memory_region" }> => e.type === "memory_region",
    );
    expect(regions).toHaveLength(1);
    expect(regions[0]).toMatchObject({
      type: "memory_region",
      name: "Default Screen RAM",
      start: "$0400",
      end: "$07FF",
      bank_switchable: false,
    });
  });
});

describe("extractGraphEntities — skip non-hardware-reference docs", () => {
  it("returns empty for docs missing the file-type marker", () => {
    const md = `# Random doc

### $D011 — D011 — Looks like a register but isn't in a hardware doc (RW)

No file-type marker.
`;
    const entities = extractGraphEntities(md, "random.md");
    expect(entities).toHaveLength(0);
  });
});

describe("extractGraphEntities — skip CONVENTIONS-*.md", () => {
  it("returns empty for conventions docs even though they bear the doc-type marker", () => {
    // Real conventions docs include the marker because they explain it.
    // But their example H3s should not become graph entities.
    const md = `# Hardware Reference Conventions

## Register definitions

Example shape:

### $D011 — D011 — Screen Control Register 1 (RW)

**Chip:** VIC-II

Description here.

### $FFD2 — CHROUT — Output a character

**Pairs with:** CHROUT

<!-- doc-type: hardware-reference -->
`;
    const entities = extractGraphEntities(md, "CONVENTIONS-hardware-reference.md");
    expect(entities).toHaveLength(0);
  });

  it("still extracts from a sibling conventions-named doc only if filename does not start with CONVENTIONS-", () => {
    // Confirm the skip is precise: a doc named "conventions-of-foo.md" (lowercase) is NOT skipped.
    const md = `### $D011 — D011 — Test Register (RW)

**Chip:** VIC-II

Body.

<!-- doc-type: hardware-reference -->
`;
    const entities = extractGraphEntities(md, "conventions-of-foo.md");
    expect(entities.filter((e) => e.type === "register")).toHaveLength(1);
  });
});
