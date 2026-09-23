import { describe, it, expect } from "vitest";
import { extractGraphEntities } from "../src/graph/extract.ts";

const PITFALL_DOC = `---
category: raster
---

<!-- doc-type: pitfall-reference -->

# Raster Pitfalls

## badline_cycle_loss — Badline DMA steals 40-43 cycles from the CPU

**Severity:** critical
**Region:** both
**Triggered by registers:** D011, D012
**Triggered by techniques:** stable_raster_irq

Symptom: cycle-tight code overruns its scanline budget...

## d012_wrap_around — $D012 wraps at line 256 on NTSC

**Severity:** high
**Region:** NTSC
**Triggered by registers:** D012
**Triggered by techniques:** stable_raster_irq
**Mitigated by techniques:** pal_ntsc_detection, \`double_irq\`, pal_ntsc_detection, Not A Name

Symptom: raster IRQ fires twice or never...
`;

describe("extractGraphEntities — pitfall-reference doc", () => {
  it("extracts two Pitfall nodes", () => {
    const entities = extractGraphEntities(PITFALL_DOC, "docs/pitfalls/raster-and-badline.md");
    const pitfalls = entities.filter(e => e.type === "pitfall");
    expect(pitfalls).toHaveLength(2);
    expect(pitfalls[0]).toMatchObject({
      type: "pitfall",
      name: "badline_cycle_loss",
      title: "Badline DMA steals 40-43 cycles from the CPU",
      severity: "critical",
      region: "both",
      category: "raster",
    });
  });

  it("emits TRIGGERED_BY edges for registers + techniques", () => {
    const entities = extractGraphEntities(PITFALL_DOC, "docs/pitfalls/raster-and-badline.md");
    const triggers = entities.filter(e => e.type === "triggered_by");
    // badline: 2 registers + 1 technique = 3; d012_wrap: 1 register + 1 technique = 2
    expect(triggers).toHaveLength(5);
    expect(triggers).toContainEqual({
      type: "triggered_by",
      pitfall: "badline_cycle_loss",
      target: "D011",
      targetKind: "Register",
    });
    expect(triggers).toContainEqual({
      type: "triggered_by",
      pitfall: "d012_wrap_around",
      target: "stable_raster_irq",
      targetKind: "Technique",
    });
  });

  it("emits MITIGATED_BY edges from the Mitigated-by line, deduplicated, refusing non-names", () => {
    const warnings: string[] = [];
    const orig = console.warn;
    console.warn = (msg: string) => { warnings.push(String(msg)); };
    let entities;
    try {
      entities = extractGraphEntities(PITFALL_DOC, "docs/pitfalls/raster-and-badline.md");
    } finally {
      console.warn = orig;
    }
    const mitigated = entities.filter(e => e.type === "mitigated_by");
    expect(mitigated).toEqual([
      { type: "mitigated_by", pitfall: "d012_wrap_around", target: "pal_ntsc_detection" },
      { type: "mitigated_by", pitfall: "d012_wrap_around", target: "double_irq" },
    ]);
    expect(warnings.some(w => /Not A Name/.test(w) && /not a snake_case technique name/.test(w))).toBe(true);
    // A pitfall without the line emits nothing.
    expect(mitigated.some(m => m.type === "mitigated_by" && m.pitfall === "badline_cycle_loss")).toBe(false);
  });
});

const FAILURE_DOC = `<!-- doc-type: failure-reference -->

# Failure Patterns

## black_screen — Display goes solid color

**Likely causes:** vic_bank_misconfigured, screen_pointer_outside_bank, di_d011_blanked
**Diagnosis steps:** Check $D018; verify $DD00 VIC bank bits; inspect $D011 bit 4.
**Caused by registers:** D011, D018, DD00
**Caused by techniques:** vic_bank_switch

Symptom...
`;

describe("extractGraphEntities — failure-reference doc", () => {
  it("extracts CrashPattern node + CAUSED_BY edges", () => {
    const e = extractGraphEntities(FAILURE_DOC, "docs/c64-failure-patterns.md");
    const crashes = e.filter(x => x.type === "crash_pattern");
    expect(crashes).toHaveLength(1);
    expect(crashes[0]).toMatchObject({
      type: "crash_pattern",
      symptom: "black_screen",
      likely_causes: ["vic_bank_misconfigured", "screen_pointer_outside_bank", "di_d011_blanked"],
    });

    const causedBy = e.filter(x => x.type === "caused_by");
    expect(causedBy).toHaveLength(4); // 3 registers + 1 technique
  });
});
