import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { FalkorService } from "../src/services/falkor.ts";
import { getQdrant } from "../src/context.ts";
import { ingestDoc } from "../src/tools/hydrate.ts";
import { techniqueLookup } from "../src/tools/query.ts";
import { isAboutTechnique } from "../src/tools/query/technique-docs.ts";

// #41: the card's Documentation section padded with whatever the search
// ranked next (vice-reference.md's ROM-licensing pitfall on
// stable_raster_irq, fld.md's Expected output on raster_split_modes).
// Techniques first, so the recipes' IMPLEMENTS edges find their targets.
const SEEDED = [
  "techniques/raster.md",
  "runtime/vice-reference.md",
  "recipes/kickassembler/fld.md",
  "recipes/kickassembler/stable-raster-irq.md",
];

let f: FalkorService;

beforeAll(async () => {
  f = new FalkorService();
  await f.connect();
  await f.clean();
  await f.ensureSchema();
  const q = await getQdrant();
  await q.ensureCollection();
  for (const rel of SEEDED) {
    const seeded = await ingestDoc(rel, readFileSync(new URL(`../docs/${rel}`, import.meta.url), "utf8"));
    if (/not available/i.test(seeded)) throw new Error(`test collection could not be seeded: ${seeded}`);
  }
  // Seeding embeds large pages through Ollama: over a minute on CI's CPU
  // runner, so the default 60 s hook limit failed every CI run from 7e5a515.
}, 600_000);

// The test collection is shared by every file; leave it as it was found.
afterAll(async () => {
  const q = await getQdrant();
  for (const rel of SEEDED) await q.deleteBySource(rel);
  await f.close();
}, 120_000);

describe("technique card documentation floor (#41)", () => {
  it.each(["raster_split_modes", "stable_raster_irq", "fld_flexible_line_distance"])(
    "%s prints only chunks about the technique",
    async (name) => {
      const r = await techniqueLookup(name);
      for (const d of r.structured.documentation) {
        expect(d.source).not.toBe("runtime/vice-reference.md");
        const own = d.section.includes(`${name} — `) || d.text.includes(name);
        expect(own || d.source.startsWith("recipes/"), `${d.source} > ${d.section}`).toBe(true);
      }
    },
  );

  it("prints no Documentation section when nothing clears the floor", async () => {
    // A technique with no page: every chunk the search finds is about something else.
    await f.addTechnique({
      name: "zoned_mode_split",
      title: "Raster split modes with badline timing",
      category: "raster",
      complexity: "low",
    });
    const r = await techniqueLookup("zoned_mode_split");
    expect(r.structured.documentation).toEqual([]);
    expect(r.text).not.toContain("## Documentation");
  });

  it("a card with no recipe says so and does not pad with another technique's recipe", async () => {
    const r = await techniqueLookup("raster_split_modes");
    expect(r.structured.recipes).toEqual([]);
    expect(r.text).toContain("No recipe realises this technique yet.");
    expect(r.structured.documentation.some((d) => d.source === "recipes/kickassembler/fld.md")).toBe(false);
  });

  it("keeps a chunk from a recipe that realises the technique, and drops an unrelated one", () => {
    const pages = new Set(["recipes/kickassembler/fld.md"]);
    const chunk = (source: string, section: string, text: string) => ({ source, section, text, score: 1 });
    expect(isAboutTechnique(chunk("recipes/kickassembler/fld.md", "FLD > Build", "x"), "fld_x", pages)).toBe(
      true,
    );
    expect(
      isAboutTechnique(chunk("techniques/raster.md", "Raster > fld_x — FLD > Why", "x"), "fld_x", pages),
    ).toBe(true);
    expect(isAboutTechnique(chunk("runtime/vice-reference.md", "VICE > ROMs", "x"), "fld_x", pages)).toBe(
      false,
    );
  });
});
