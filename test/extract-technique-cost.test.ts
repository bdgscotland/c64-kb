import { describe, it, expect, vi } from "vitest";
import { extractGraphEntities, COST_VOCABULARY, COST_BASIS_WORDS } from "../src/graph/extract.js";

// The **Cost:** and **Cost basis:** lines (docs/CONVENTIONS-techniques.md,
// schema 22). The figures ride the technique entity; nothing here is an edge.

function doc(meta: string): string {
  return `---
category: raster
chip: VIC-II
---

<!-- doc-type: technique-reference -->

# Raster Techniques

## stable_raster_irq — Stable raster IRQ

**Complexity:** medium
**Region:** both
${meta}

Body text.
`;
}

function techOf(ents: ReturnType<typeof extractGraphEntities>) {
  const t = ents.find((e) => e.type === "technique");
  if (!t || t.type !== "technique") throw new Error("no technique entity");
  return t;
}

describe("extractGraphEntities - technique Cost lines", () => {
  it("parses a valid Cost line and its basis onto the technique entity", () => {
    const t = techOf(extractGraphEntities(doc(
      "**Cost:** cycles_per_frame=124, lines_active=2, irq_slots=1, zp_bytes=0\n**Cost basis:** arithmetic"
    ), "techniques/raster.md"));
    expect(t.cost).toEqual({ cycles_per_frame: 124, lines_active: 2, irq_slots: 1, zp_bytes: 0 });
    expect(t.cost_basis).toBe("arithmetic");
  });

  it("accepts the basis line before the Cost line and backticks around the word", () => {
    const t = techOf(extractGraphEntities(doc(
      "**Cost basis:** `measured-vice`\n**Cost:** cycles_per_frame=332"
    ), "techniques/raster.md"));
    expect(t.cost).toEqual({ cycles_per_frame: 332 });
    expect(t.cost_basis).toBe("measured-vice");
  });

  it("leaves cost absent when the page has no Cost line", () => {
    const t = techOf(extractGraphEntities(doc(""), "techniques/raster.md"));
    expect(t.cost).toBeUndefined();
    expect(t.cost_basis).toBeUndefined();
  });

  it("warns about and skips an unknown key, keeping the rest of the line", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const t = techOf(extractGraphEntities(doc(
        "**Cost:** cycles_per_frame=124, cycles_per_fortnight=9, irq_slots=1\n**Cost basis:** arithmetic"
      ), "techniques/raster.md"));
      expect(t.cost).toEqual({ cycles_per_frame: 124, irq_slots: 1 });
      expect(t.cost_basis).toBe("arithmetic");
      expect(warn.mock.calls.some((c) => String(c[0]).includes('cost key "cycles_per_fortnight"'))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it("warns about and skips a non-integer or negative value", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const t = techOf(extractGraphEntities(doc(
        "**Cost:** cycles_per_frame=about 124, bytes_code=12.5, zp_bytes=-2, irq_slots=1\n**Cost basis:** estimated"
      ), "techniques/raster.md"));
      expect(t.cost).toEqual({ irq_slots: 1 });
      const msgs = warn.mock.calls.map((c) => String(c[0]));
      expect(msgs.filter((m) => m.includes("is not a non-negative integer"))).toHaveLength(3);
    } finally {
      warn.mockRestore();
    }
  });

  it("drops the whole Cost line for a basis word outside the set", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const t = techOf(extractGraphEntities(doc(
        "**Cost:** cycles_per_frame=124, irq_slots=1\n**Cost basis:** guessed"
      ), "techniques/raster.md"));
      expect(t.cost).toBeUndefined();
      expect(t.cost_basis).toBeUndefined();
      expect(warn.mock.calls.some((c) => String(c[0]).includes('cost basis "guessed"'))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it("drops the Cost line when there is no basis line at all", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const t = techOf(extractGraphEntities(doc("**Cost:** cycles_per_frame=124"), "techniques/raster.md"));
      expect(t.cost).toBeUndefined();
      expect(warn.mock.calls.some((c) => String(c[0]).includes("no **Cost basis:** line"))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it("does not let a Cost line leak across the next H2", () => {
    const two = doc("**Cost:** cycles_per_frame=124\n**Cost basis:** arithmetic") +
      "\n## raster_bars — Raster color bars\n\n**Complexity:** low\n\nBody.\n";
    const ents = extractGraphEntities(two, "techniques/raster.md");
    const bars = ents.find((e) => e.type === "technique" && e.name === "raster_bars");
    expect(bars && bars.type === "technique" ? bars.cost : "missing").toBeUndefined();
  });

  it("exposes the vocabulary and basis words the conventions document", () => {
    expect(Object.keys(COST_VOCABULARY).sort()).toEqual([
      "bytes_code", "bytes_data", "cycles_per_frame", "cycles_per_line", "irq_slots", "lines_active", "sprites_per_line", "zp_bytes",
    ]);
    expect([...COST_BASIS_WORDS]).toEqual(["measured-vice", "derived-listing", "arithmetic", "estimated"]);
  });

  it("every shipped technique page parses its Cost lines without a warning", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dir = path.resolve(__dirname, "../docs/techniques");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      let costed = 0;
      for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".md"))) {
        const ents = extractGraphEntities(fs.readFileSync(path.join(dir, f), "utf8"), `techniques/${f}`);
        for (const e of ents) if (e.type === "technique" && e.cost) costed++;
      }
      const costWarnings = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.toLowerCase().includes("cost"));
      expect(costWarnings).toEqual([]);
      expect(costed).toBeGreaterThanOrEqual(19);
    } finally {
      warn.mockRestore();
    }
  });
});
