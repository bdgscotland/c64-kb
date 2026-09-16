import { describe, it, expect } from "vitest";
import { extractGraphEntities } from "../src/graph/extract.js";

describe("extractGraphEntities - technique-reference docs", () => {
  it("extracts a Technique entity from H2 + metadata", () => {
    const doc = `---
category: raster
chip: VIC-II
---

<!-- doc-type: technique-reference -->

# Raster Techniques

## stable_raster_irq — Stable raster IRQ

**Complexity:** medium
**Region:** both
**Uses registers:** D011, D012, D019
**Uses kernal:** CINT

Body text.
`;
    const ents = extractGraphEntities(doc, "techniques/raster.md");
    const tech = ents.find((e) => e.type === "technique");
    expect(tech).toBeDefined();
    if (tech && tech.type === "technique") {
      expect(tech.name).toBe("stable_raster_irq");
      expect(tech.title).toBe("Stable raster IRQ");
      expect(tech.category).toBe("raster");
      expect(tech.complexity).toBe("medium");
    }
    const usesReg = ents.filter((e) => e.type === "technique_uses_register");
    expect(usesReg).toHaveLength(3);
    expect(usesReg.map((e) => e.type === "technique_uses_register" ? e.register : "").sort()).toEqual([
      "D011",
      "D012",
      "D019",
    ]);
    const usesK = ents.filter((e) => e.type === "technique_uses_kernal");
    expect(usesK).toHaveLength(1);
  });

  it("emits REQUIRES_REGION when Region is not both", () => {
    const doc = `---
category: raster
---

<!-- doc-type: technique-reference -->

# Raster

## badline_synchronization — Badline synchronization

**Region:** PAL

Body.
`;
    const ents = extractGraphEntities(doc, "techniques/raster.md");
    const req = ents.find((e) => e.type === "technique_requires_region");
    expect(req).toBeDefined();
    if (req && req.type === "technique_requires_region") {
      expect(req.technique).toBe("badline_synchronization");
      expect(req.region).toBe("PAL");
    }
  });

  it("does not emit REQUIRES_REGION when Region is both or missing", () => {
    const doc = `---
category: raster
---

<!-- doc-type: technique-reference -->

# Raster

## stable_raster_irq — Stable raster IRQ

**Region:** both

Body.

## raster_bars — Raster bars

Body.
`;
    const ents = extractGraphEntities(doc, "techniques/raster.md");
    expect(ents.filter((e) => e.type === "technique_requires_region")).toHaveLength(0);
    expect(ents.filter((e) => e.type === "technique")).toHaveLength(2);
  });

  it("skips files without the technique-reference marker", () => {
    const doc = `## stable_raster_irq — Stable raster IRQ

Body without marker.
`;
    const ents = extractGraphEntities(doc, "misc.md");
    expect(ents.filter((e) => e.type === "technique")).toHaveLength(0);
  });

  it("extracts IMPLEMENTS edge from a recipe's techniques: [...] frontmatter", () => {
    const doc = `---
recipe: raster-bars
toolchain: oscar64
output_format: PRG
region: both
techniques: [raster_bars]
file_formats: [PRG]
uses_registers: [D021]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Raster Bars

## Synopsis

Color bars via stable raster IRQ.
`;
    const ents = extractGraphEntities(doc, "recipes/oscar64/raster-bars.md");
    const imp = ents.find((e) => e.type === "implements");
    expect(imp).toBeDefined();
    if (imp && imp.type === "implements") {
      expect(imp.recipe).toBe("oscar64-raster-bars");
      expect(imp.technique).toBe("raster_bars");
    }
  });
});
