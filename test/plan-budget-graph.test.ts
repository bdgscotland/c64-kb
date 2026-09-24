import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorService } from "../src/services/falkor.ts";
import type { TechniqueNode } from "../src/services/falkor/nodes.ts";
import { planBudgetTool, techniqueLookup } from "../src/tools/query.ts";
import { findCostReferenceMisses } from "../src/ingest/report.ts";
import { PlanBudgetSchema, TechniqueLookupSchema } from "../src/schemas/tool-outputs.ts";

// Schema 27: the measured-on, conditions, includes and typical properties
// land on the Technique node, clear when the page drops them, and feed
// c64_plan_budget through the graph (band, REQUIRES closure, IMPLEMENTS).
describe("c64_plan_budget over the graph", () => {
  let f: FalkorService;
  beforeAll(async () => {
    f = new FalkorService();
    await f.connect();
    await f.clean();
    await f.ensureSchema();
    const tech = (name: string, extra: Partial<TechniqueNode>) =>
      f.addTechnique({ name, title: name, category: "logic", complexity: "low", ...extra });
    await tech("wave_director", {
      cost: { cycles_per_frame: 3188, cycles_per_frame_typical: 1170 },
      cost_basis: "measured-vice",
      cost_recipe: "oscar64-wave-director",
      cost_conditions: "worst frame, screen blanked",
      cost_includes: ["object_pool", "ghost_technique"],
    });
    await tech("object_pool", {
      cost: { cycles_per_frame: 380 },
      cost_basis: "measured-vice",
      cost_recipe: "oscar64-no-such-recipe",
    });
    await tech("fli_image", {
      cost: { cycles_per_line: 63, lines_active: 207, cycles_per_frame: 13041 },
      cost_basis: "estimated",
      raster_band: "45-251",
    });
    await tech("stable_raster_irq", { cost: { cycles_per_frame: 124 }, cost_basis: "arithmetic" });
    await tech("double_irq", { cost: { cycles_per_frame: 160 }, cost_basis: "arithmetic" });
    await tech("fixed_point_8_8", {});
    // #41: a Cost measured on a recipe that realises another technique.
    await tech("region_probe", {
      cost: { cycles_per_frame: 27301 },
      cost_basis: "measured-vice",
      cost_recipe: "oscar64-fixed-point-jump",
    });
    await f.linkTechniqueRequires("fli_image", "stable_raster_irq");
    await f.linkTechniqueRequires("stable_raster_irq", "double_irq");
    await f.addRecipe({
      name: "oscar64-wave-director",
      toolchain: "oscar64",
      output_format: "PRG",
      region: "both",
      source_doc: "recipes/oscar64/wave-director.md",
    });
    await f.addRecipe({
      name: "oscar64-fixed-point-jump",
      toolchain: "oscar64",
      output_format: "PRG",
      region: "both",
      source_doc: "recipes/oscar64/fixed-point-jump.md",
    });
    await f.linkRecipeImplements("oscar64-wave-director", "wave_director");
    await f.linkRecipeImplements("oscar64-fixed-point-jump", "fixed_point_8_8");
  });
  afterAll(async () => {
    await f.close();
  });

  it("stores the provenance properties and clears them with the Cost line", async () => {
    const r = await f.roQuery(
      `MATCH (t:Technique {name: 'wave_director'})
       RETURN t.cost_recipe AS recipe, t.cost_conditions AS cond, t.cost_includes AS inc,
              t.cost_cycles_per_frame_typical AS typ`,
    );
    expect(r.data[0]).toEqual({
      recipe: "oscar64-wave-director",
      cond: "worst frame, screen blanked",
      inc: ["object_pool", "ghost_technique"],
      typ: 1170,
    });
    await f.addTechnique({ name: "double_irq", title: "double_irq", category: "raster", complexity: "low" });
    const cleared = await f.roQuery(
      `MATCH (t:Technique {name: 'double_irq'}) RETURN t.cost_recipe AS recipe, t.cost_includes AS inc`,
    );
    expect(cleared.data[0]).toEqual({ recipe: null, inc: null });
    await f.addTechnique({
      name: "double_irq",
      title: "double_irq",
      category: "raster",
      complexity: "low",
      cost: { cycles_per_frame: 160 },
      cost_basis: "arithmetic",
    });
  });

  it("technique lookup returns the provenance beside the figures", async () => {
    const r = await techniqueLookup("wave_director");
    expect(r.structured.cost).toMatchObject({
      cycles_per_frame: 3188,
      cycles_per_frame_typical: 1170,
      basis: "measured-vice",
      measured_on: "oscar64-wave-director",
      conditions: "worst frame, screen blanked",
      includes: ["object_pool", "ghost_technique"],
    });
    expect(TechniqueLookupSchema.parse(r.structured)).toBeTruthy();
    expect(r.text).toContain("**Cost measured on:** oscar64-wave-director (worst frame, screen blanked)");
  });

  it("ingest's check names a measured-on recipe that is no node or realises another technique, and an included technique that is no node", async () => {
    const misses = await findCostReferenceMisses(f);
    expect(misses.sort()).toEqual([
      "object_pool: Cost measured on oscar64-no-such-recipe (no such recipe)",
      "region_probe: Cost measured on oscar64-fixed-point-jump (a recipe that does not realise it)",
      "wave_director: Cost includes ghost_technique (no such technique)",
    ]);
  });

  it("budgets a list with phases from the graph: includes, band closure, unknown with a recipe, refused input", async () => {
    const r = await planBudgetTool({
      techniques: [
        "wave_director",
        "object_pool",
        "fixed_point_8_8",
        "fli_image:transition",
        "stable_raster_irq:transition",
        "double_irq:transition",
        "no_such_technique",
        "x:later",
      ],
      region: "PAL",
    });
    const s = PlanBudgetSchema.parse(r.structured);
    expect(s.refused).toEqual([
      { input: "x:later", why: 'phase "later" is not one of play, transition, init' },
    ]);
    const play = s.phases.find((p) => p.phase === "play");
    expect(play?.excluded).toEqual([{ name: "object_pool", reason: "included_by", by: "wave_director" }]);
    expect(play?.unknown).toEqual(["fixed_point_8_8"]);
    expect(play?.to_measure).toEqual([
      { technique: "fixed_point_8_8", recipe: "oscar64-fixed-point-jump", why: "no **Cost:** line" },
    ]);
    expect(play?.not_found).toEqual(["no_such_technique"]);
    expect([play?.low, play?.high]).toEqual([1170, 3188]);
    expect(play?.verdict).toBe("undetermined");
    const transition = s.phases.find((p) => p.phase === "transition");
    expect(transition?.high).toBe(13041);
    expect(transition?.excluded.map((e) => [e.name, e.reason])).toEqual([
      ["stable_raster_irq", "inside_band_of"],
      ["double_irq", "inside_band_of"],
    ]);
    expect(transition?.verdict).toBe("fits");
    expect(r.text).toContain("## play (PAL, 19656 cycles a frame): undetermined");
    expect(r.text).toContain("object_pool: not added, inside wave_director's figure (Cost includes)");
    expect(r.text).toContain("fixed_point_8_8: no **Cost:** line; measure it on oscar64-fixed-point-jump");
  });
});
