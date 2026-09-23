import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { FalkorService } from "../src/services/falkor.ts";
import { recipeLookup, recipesFor } from "../src/tools/query.ts";
import { RecipeLookupSchema } from "../src/schemas/tool-outputs.ts";

// Schema 29: MachineVariant seeds, VERIFIED_ON edges owned by runs.json.
describe("MachineVariant and VERIFIED_ON in the graph", () => {
  let f: FalkorService;
  const recipe = (name: string, stem: string) =>
    f.addRecipe({
      name,
      toolchain: "oscar64",
      output_format: "PRG",
      region: "both",
      source_doc: `recipes/oscar64/${stem}.md`,
    });
  const edge = (stem: string, variant: string, model: string) => ({
    source_doc: `recipes/oscar64/${stem}.md`,
    variant,
    model,
    cycles: 8000000,
    shot: `screenshots/${stem}.png`,
    flags: "",
    pinned: true,
  });
  beforeAll(async () => {
    f = new FalkorService();
    await f.connect();
    await f.clean();
    await f.ensureSchema();
    await recipe("oscar64-pal-ntsc-detect", "pal-ntsc-detect");
    await recipe("oscar64-hello-world", "hello-world");
  });
  afterAll(async () => {
    await f.close();
  });

  it("seeds seven variants with their chips, and clean() keeps them", async () => {
    await f.clean();
    await f.ensureSchema();
    await recipe("oscar64-pal-ntsc-detect", "pal-ntsc-detect");
    await recipe("oscar64-hello-world", "hello-world");
    const r = await f.roQuery(
      `MATCH (v:MachineVariant) RETURN v.name AS n, v.vic AS vic, v.cycles_per_line AS c, v.lines AS l, v.vice_default AS d ORDER BY n`,
    );
    expect(r.data).toHaveLength(7);
    expect(r.data).toContainEqual({ n: "c64c", vic: "8565", c: 63, l: 312, d: true });
    expect(r.data).toContainEqual({ n: "oldntsc", vic: "6567R56A", c: 64, l: 262, d: false });
  });

  it("replaceVerifiedOn owns the edge type: old edges go, a recipe that is no node is dropped", async () => {
    await f.replaceVerifiedOn([edge("hello-world", "ntsc", "ntsc")]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const res = await f.replaceVerifiedOn([
      edge("pal-ntsc-detect", "c64c", "pal"),
      edge("pal-ntsc-detect", "ntsc", "ntsc"),
      edge("pal-ntsc-detect", "oldntsc", "oldntsc"),
      edge("hello-world", "c64c", "pal"),
      edge("no-such-page", "c64c", "pal"),
    ]);
    warn.mockRestore();
    expect(res).toEqual({ landed: 4, dropped: ["recipes/oscar64/no-such-page.md -> c64c"] });
    const r = await f.roQuery(
      `MATCH (r:Recipe)-[:VERIFIED_ON]->(v) RETURN r.name AS r, v.name AS v ORDER BY r, v`,
    );
    expect(r.data).toEqual([
      { r: "oscar64-hello-world", v: "c64c" },
      { r: "oscar64-pal-ntsc-detect", v: "c64c" },
      { r: "oscar64-pal-ntsc-detect", v: "ntsc" },
      { r: "oscar64-pal-ntsc-detect", v: "oldntsc" },
    ]);
  });

  it("c64_recipe_lookup returns verified_on", async () => {
    const { structured, text } = await recipeLookup("oscar64-pal-ntsc-detect");
    RecipeLookupSchema.parse(structured);
    expect(structured.verified_on?.map((v) => `${v.variant}:${v.model}`)).toEqual([
      "c64c:pal",
      "ntsc:ntsc",
      "oldntsc:oldntsc",
    ]);
    expect(text).toContain("**Verified on:** c64c (8565, 8580, 8521");
  });

  it("c64_recipes_for filters by variant name or region word", async () => {
    const names = async (verified_on: string) =>
      (await recipesFor({ verified_on })).structured.recipes.map((r) => r.name);
    expect(await names("oldntsc")).toEqual(["oscar64-pal-ntsc-detect"]);
    expect(await names("NTSC")).toEqual(["oscar64-pal-ntsc-detect"]);
    expect(await names("pal")).toEqual(["oscar64-hello-world", "oscar64-pal-ntsc-detect"]);
    expect(await names("drean")).toEqual([]);
  });
});
