import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { FalkorService } from "../src/services/falkor.ts";
import { planBudgetTool } from "../src/tools/query.ts";
import { designsOfArchetype } from "../src/tools/query/game-design.ts";
import { PlanBudgetSchema } from "../src/schemas/tool-outputs.ts";

// Schema 28: GameDesign, COMPOSES (with phase), INSTANCE_OF, REALISED_BY,
// and c64_plan_budget taking a design name.
describe("GameDesign in the graph and in c64_plan_budget", () => {
  let f: FalkorService;
  beforeAll(async () => {
    f = new FalkorService();
    await f.connect();
    await f.clean();
    await f.ensureSchema();
    const tech = (name: string, cycles?: number) =>
      f.addTechnique({
        name,
        title: name,
        category: "logic",
        complexity: "low",
        ...(cycles !== undefined
          ? {
              cost: { cycles_per_frame: cycles },
              cost_basis: "measured-vice" as const,
              cost_conditions: "screen on",
            }
          : {}),
      });
    await tech("falling_block_rules", 5888);
    await tech("lfsr_random", 14);
    await tech("text_mode_overlay_render");
    await tech("pal_ntsc_detection");
    await f.addArchetype({ name: "action_puzzle", title: "Action-Puzzle", kind: "game", source_doc: "a.md" });
    await f.addRecipe({
      name: "oscar64-falling-blocks",
      toolchain: "oscar64",
      output_format: "PRG",
      region: "both",
      source_doc: "recipes/oscar64/falling-blocks.md",
    });
    await f.addGameDesign({
      name: "falling_blocks_oscar64",
      title: "Falling-block puzzle (Oscar64)",
      region: "both",
      measured: [
        { phase: "play", region: "PAL", worst: 6276, basis: "measured-vice", source: "CIA1 timer A" },
        { phase: "play", region: "NTSC", worst: 6491, basis: "measured-vice", source: "CIA1 timer A" },
      ],
      source_doc: "game-design/designs/falling-blocks.md",
    });
    for (const [t, phase] of [
      ["falling_block_rules", "play"],
      ["lfsr_random", "play"],
      ["lfsr_random", "init"],
      ["pal_ntsc_detection", "init"],
    ] as const)
      expect(await f.linkComposes("falling_blocks_oscar64", t, phase)).toBe(true);
    expect(await f.linkInstanceOf("falling_blocks_oscar64", "action_puzzle")).toBe(true);
    expect(await f.linkRealisedBy("falling_blocks_oscar64", "oscar64-falling-blocks")).toBe(true);
  });
  afterAll(async () => {
    await f.close();
  });

  it("drops an edge to a name that is no node, and says so", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await f.linkComposes("falling_blocks_oscar64", "no_such_technique", "play")).toBe(false);
    expect(await f.linkInstanceOf("falling_blocks_oscar64", "no_such_archetype")).toBe(false);
    expect(await f.linkRealisedBy("falling_blocks_oscar64", "oscar64-no-such")).toBe(false);
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
    const r = await f.roQuery(
      `MATCH (:GameDesign)-[e:COMPOSES]->(t) RETURN t.name AS t, e.phase AS p ORDER BY t, p`,
    );
    expect(r.data).toEqual([
      { t: "falling_block_rules", p: "play" },
      { t: "lfsr_random", p: "init" },
      { t: "lfsr_random", p: "play" },
      { t: "pal_ntsc_detection", p: "init" },
    ]);
  });

  it("a design name expands to its phases; the measured frame sits beside the prediction", async () => {
    const { structured, text } = await planBudgetTool({ design: "falling_blocks_oscar64" });
    PlanBudgetSchema.parse(structured);
    // The design's region (both) is the default.
    expect(structured.region).toBe("both");
    expect(structured.techniques).toEqual([
      "falling_block_rules",
      "lfsr_random",
      "lfsr_random:init",
      "pal_ntsc_detection:init",
    ]);
    expect(structured.phases.map((p) => `${p.phase}/${p.region}`)).toEqual([
      "play/PAL",
      "play/NTSC",
      "init/PAL",
      "init/NTSC",
    ]);
    const d = structured.design;
    expect(d?.instance_of).toEqual(["action_puzzle"]);
    expect(d?.realised_by).toEqual(["oscar64-falling-blocks"]);
    const pal = d?.measured.find((m) => m.region === "PAL");
    // 5888 + 14 summed; measured on with the screen on, so no badline charge.
    expect(pal?.predicted).toMatchObject({ low: 5902, high: 5902, fixed: 0, verdict: "fits", missing: [] });
    expect(pal?.position).toBe("above_high");
    expect(pal?.finding).toContain(
      "measured worst 6276 (measured-vice) is above the predicted 5902-5902 by 374",
    );
    expect(text).toContain("Measured beside predicted:");
  });

  it("an unknown member is named in the comparison, and techniques add to the design", async () => {
    const { structured } = await planBudgetTool({
      design: "falling_blocks_oscar64",
      techniques: ["text_mode_overlay_render", "lfsr_random"],
      region: "PAL",
    });
    expect(structured.refused).toEqual([
      { input: "lfsr_random", why: "lfsr_random is already listed in play; counted once" },
    ]);
    const m = structured.design?.measured ?? [];
    expect(m.find((x) => x.region === "NTSC")?.position).toBe("not_predicted");
    const pal = m.find((x) => x.region === "PAL");
    expect(pal?.predicted?.missing).toEqual(["text_mode_overlay_render"]);
    // Above the counted range; the uncounted member may explain it, and the finding says so.
    expect(pal?.position).toBe("above_high");
    expect(pal?.finding).toContain("the uncounted cycles may account for the excess");
    expect(pal?.finding).toContain("1 member has no figure (text_mode_overlay_render)");
  });

  it("an unknown design is reported with the known names, not guessed", async () => {
    const { structured, text } = await planBudgetTool({ design: "tetris" });
    expect(structured.design).toBeNull();
    expect(structured.design_not_found).toEqual({ requested: "tetris", known: ["falling_blocks_oscar64"] });
    expect(text).toContain('No GameDesign is named "tetris"');
    await expect(planBudgetTool({})).rejects.toThrow(/techniques, a design/);
  });

  it("lists the designs of an archetype for the briefing", async () => {
    const ds = await designsOfArchetype("action_puzzle");
    expect(ds.map((d) => d.name)).toEqual(["falling_blocks_oscar64"]);
    expect(ds[0]?.measured.map((m) => m.worst)).toEqual([6276, 6491]);
    expect(await designsOfArchetype("vertical_shmup")).toEqual([]);
  });

  it("a re-ingest that drops the measured lines clears them", async () => {
    await f.addGameDesign({
      name: "falling_blocks_oscar64",
      title: "Falling-block puzzle (Oscar64)",
      measured: [],
      source_doc: "game-design/designs/falling-blocks.md",
    });
    const r = await f.roQuery(
      `MATCH (g:GameDesign {name: 'falling_blocks_oscar64'}) RETURN g.measured AS m, g.region AS r`,
    );
    expect(r.data[0]).toEqual({ m: null, r: null });
  });

  it("a call count rides the COMPOSES edge and multiplies the member's figure (#37)", async () => {
    await f.addGameDesign({ name: "calls_test", title: "Calls", measured: [], source_doc: "c.md" });
    expect(await f.linkComposes("calls_test", "lfsr_random", "play", { low: 2, high: 3 })).toBe(true);
    const { structured, text } = await planBudgetTool({ design: "calls_test", region: "PAL" });
    PlanBudgetSchema.parse(structured);
    expect(structured.design?.composes).toEqual([
      { technique: "lfsr_random", phase: "play", calls: { low: 2, high: 3 } },
    ]);
    expect(structured.techniques).toEqual(["lfsr_random ×2-3"]);
    expect(structured.phases[0]?.contributors[0]).toMatchObject({
      low: 28,
      high: 42,
      calls: { low: 2, high: 3 },
    });
    expect(text).toContain("×2-3 calls");
    // A re-link without a count removes it.
    await f.linkComposes("calls_test", "lfsr_random", "play");
    const r = await f.roQuery(
      `MATCH (:GameDesign {name: 'calls_test'})-[c:COMPOSES]->() RETURN c.calls_low AS l, c.calls_high AS h`,
    );
    expect(r.data).toEqual([{ l: null, h: null }]);
  });
});
