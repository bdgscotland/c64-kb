import { describe, it, expect } from "vitest";
import { extractGraphEntities } from "../src/graph/extract.ts";

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
    if (tech) {
      expect(tech.name).toBe("stable_raster_irq");
      expect(tech.title).toBe("Stable raster IRQ");
      expect(tech.category).toBe("raster");
      expect(tech.complexity).toBe("medium");
    }
    const usesReg = ents.filter((e) => e.type === "technique_uses_register");
    expect(usesReg).toHaveLength(3);
    expect(usesReg.map((e) => e.register).sort()).toEqual([
      "D011",
      "D012",
      "D019",
    ]);
    const usesK = ents.filter((e) => e.type === "technique_uses_kernal");
    expect(usesK).toHaveLength(1);
  });

  it("refuses a technique doc whose category is outside the ontology's set, with a warning", () => {
    const doc = `---
category: bogus
---

<!-- doc-type: technique-reference -->

# Bogus

## some_trick — Some trick

**Region:** both

Body.
`;
    const warnings: string[] = [];
    const orig = console.warn;
    console.warn = (msg: unknown) => {
      warnings.push(String(msg));
    };
    try {
      const ents = extractGraphEntities(doc, "techniques/bogus.md");
      expect(ents.filter((e) => e.type === "technique")).toHaveLength(0);
    } finally {
      console.warn = orig;
    }
    expect(warnings.some((w) => w.includes('category "bogus"'))).toBe(true);
  });

  it("accepts the game-foundation categories added in schema 20", () => {
    for (const category of ["input", "logic", "maths", "text", "io", "render"]) {
      const doc = `---
category: ${category}
---

<!-- doc-type: technique-reference -->

# ${category}

## example_${category} — Example

**Region:** both

Body.
`;
      const ents = extractGraphEntities(doc, `techniques/${category}.md`);
      const tech = ents.find((e) => e.type === "technique");
      expect(tech, category).toBeDefined();
      if (tech) expect(tech.category).toBe(category);
    }
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
    if (req) {
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

  it("emits one technique_requires entity per **Requires:** word, deduplicated", () => {
    const doc = `---
category: scroll
---

<!-- doc-type: technique-reference -->

# Scroll

## infinite_scroll_h — Combine soft + buffer

**Complexity:** medium
**Region:** both
**Uses registers:** D016
**Requires:** soft_scroll_h, \`char_scroll_buffer_h\`, soft_scroll_h

Body.

## soft_scroll_h — Horizontal soft scroll

**Requires:** (none)

Body.
`;
    const ents = extractGraphEntities(doc, "techniques/scroll.md");
    const req = ents.filter((e) => e.type === "technique_requires") as {
      technique: string;
      requires: string;
    }[];
    expect(req.map((r) => `${r.technique}:${r.requires}`).sort()).toEqual([
      "infinite_scroll_h:char_scroll_buffer_h",
      "infinite_scroll_h:soft_scroll_h",
    ]);
  });

  it("refuses a self-reference and a name that is not snake_case under **Requires:**", () => {
    const warnings: string[] = [];
    const orig = console.warn;
    console.warn = (msg: string) => {
      warnings.push(msg);
    };
    try {
      const doc = `---
category: raster
---

<!-- doc-type: technique-reference -->

# Raster

## double_irq — Double IRQ

**Requires:** double_irq, Stable Raster IRQ, stable_raster_irq

Body.
`;
      const ents = extractGraphEntities(doc, "techniques/raster.md");
      const req = ents.filter((e) => e.type === "technique_requires") as {
        technique: string;
        requires: string;
      }[];
      expect(req).toEqual([
        { type: "technique_requires", technique: "double_irq", requires: "stable_raster_irq" },
      ]);
      expect(warnings.some((w) => w.includes("lists itself"))).toBe(true);
      expect(warnings.some((w) => w.includes("not a snake_case technique name"))).toBe(true);
    } finally {
      console.warn = orig;
    }
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
    if (imp) {
      expect(imp.recipe).toBe("oscar64-raster-bars");
      expect(imp.technique).toBe("raster_bars");
    }
  });
});
