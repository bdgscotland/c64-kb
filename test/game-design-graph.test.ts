import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { FalkorService } from "../src/services/falkor.ts";
import { planBudgetTool } from "../src/tools/query.ts";
import { designsOfArchetype } from "../src/tools/query/game-design.ts";
import { PlanBudgetSchema } from "../src/schemas/tool-outputs.ts";
import { readFileSync } from "node:fs";
import { extractGraphEntities } from "../src/graph/extract.ts";
import { applyEdge, applyNode, isNodeEntity } from "../src/graph/apply.ts";
import { EdgeTally } from "../src/ingest/tally.ts";

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

// Schema 40: a studied game is a GameDesign. The fixture page goes through
// the extractor and apply.ts, as an ingest would take it.
describe("a studied GameDesign in the graph, the budget and the briefing's list", () => {
  let f: FalkorService;
  const PATH = "game-design/studies/test-shooter.md";
  const entities = () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const es = extractGraphEntities(readFileSync("test/fixtures/study-page.md", "utf8"), PATH);
    warn.mockRestore();
    return es;
  };
  beforeAll(async () => {
    f = new FalkorService();
    await f.connect();
    await f.clean();
    await f.ensureSchema();
    for (const name of ["invalid_mode_band", "soft_scroll_v"])
      await f.addTechnique({ name, title: name, category: "raster", complexity: "low" });
    await f.addArchetype({
      name: "vertical_shmup",
      title: "Vertical Shmup",
      kind: "game",
      source_doc: "a.md",
    });
    await f.addProduction({ name: "Test Shooter", kind: "game", year: 1985, url: "https://example.org/ts" });
  });
  afterAll(async () => {
    await f.close();
  });

  it("stores kind and the study lines on the node; STUDIES and DIVERGES_FROM land, an unknown technique is counted", async () => {
    const es = entities();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const tally = new EdgeTally();
    for (const e of es) {
      if (isNodeEntity(e)) await applyNode(f, e);
      else tally.record(e, await applyEdge(f, e));
    }
    const node = await f.roQuery(
      `MATCH (g:GameDesign {name: 'test_shooter_study'})
       RETURN g.kind AS kind, g.studied_from AS sf, g.irq_chain AS irq, g.memory_map AS mm`,
    );
    const row = node.data[0] as { kind: string; sf: string; irq: string; mm: string };
    expect(row.kind).toBe("studied");
    expect(JSON.parse(row.sf)).toMatchObject({
      title: "Test Shooter",
      year: 1985,
      authors: ["Ann Coder", "Test House"],
    });
    expect(JSON.parse(row.irq)).toHaveLength(2);
    expect((JSON.parse(row.mm) as { entries: unknown[] }[])[0]?.entries).toHaveLength(5);
    const studies = await f.roQuery(`MATCH (:GameDesign)-[:STUDIES]->(p:Production) RETURN p.name AS p`);
    expect(studies.data).toEqual([{ p: "Test Shooter" }]);
    const div = await f.roQuery(
      `MATCH (:GameDesign)-[d:DIVERGES_FROM]->(t:Technique) RETURN t.name AS t, d.direction AS d ORDER BY t`,
    );
    expect(div.data).toEqual([
      { t: "invalid_mode_band", d: "extra" },
      { t: "soft_scroll_v", d: "missing" },
    ]);
    expect(tally.dropped("diverges_from")).toBe(1);
    expect(tally.distinct("diverges_from")).toBe(3);
    expect(tally.dropped("studies")).toBe(0);
    expect(warn.mock.calls.map((c) => String(c[0])).join("\n")).toContain("not_a_technique");
    warn.mockRestore();
  });

  it("a STUDIES title that names no Production is dropped, never created", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await f.linkStudies("test_shooter_study", "No Such Game")).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    const r = await f.roQuery(`MATCH (p:Production {name: 'No Such Game'}) RETURN p`);
    expect(r.data).toHaveLength(0);
  });

  it("c64_plan_budget prints a studied design's measured frame and says there is no recipe to predict from", async () => {
    const { structured, text } = await planBudgetTool({ design: "test_shooter_study" });
    PlanBudgetSchema.parse(structured);
    expect(structured.design?.kind).toBe("studied");
    expect(structured.design?.studied_from?.title).toBe("Test Shooter");
    expect(structured.phases).toEqual([]);
    expect(structured.design?.measured).toEqual([
      expect.objectContaining({
        phase: "play",
        region: "PAL",
        worst: 18000,
        typical: 15000,
        basis: "measured-vice-study",
        predicted: null,
        position: "not_predicted",
      }),
    ]);
    expect(structured.design?.measured[0]?.finding).toContain("no recipe to predict from");
    expect(text).toContain("Studied from Test Shooter (1985, Ann Coder, Test House)");
    expect(text).toContain("worst 18000, typical 15000");
    expect(text).toContain("no recipe to predict from");
  });

  it("a studied design lists with its kind among the archetype's designs", async () => {
    const ds = await designsOfArchetype("vertical_shmup");
    expect(ds.map((d) => [d.name, d.kind, d.source_doc])).toEqual([["test_shooter_study", "studied", PATH]]);
  });

  it("a re-ingest through the extractor of the page without its IRQ chain lines clears them and keeps the rest", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const doc = readFileSync("test/fixtures/study-page.md", "utf8")
      .split("\n")
      .filter((l) => !l.startsWith("**IRQ chain:**"))
      .join("\n");
    for (const e of extractGraphEntities(doc, PATH)) if (isNodeEntity(e)) await applyNode(f, e);
    warn.mockRestore();
    const r = await f.roQuery(
      `MATCH (g:GameDesign {name: 'test_shooter_study'})
       RETURN g.kind AS kind, g.irq_chain AS irq, g.memory_map AS mm`,
    );
    const row = r.data[0] as { kind: string; irq: string | null; mm: string };
    expect(row.kind).toBe("studied");
    expect(row.irq).toBeNull();
    expect((JSON.parse(row.mm) as unknown[]).length).toBe(1);
  });

  it("a re-ingest as a built page clears kind and the study lines", async () => {
    await f.addGameDesign({
      name: "test_shooter_study",
      title: "T",
      measured: [],
      source_doc: PATH,
      kind: "built",
      irq_chain: [],
      memory_map: [],
    });
    const r = await f.roQuery(
      `MATCH (g:GameDesign {name: 'test_shooter_study'})
       RETURN g.kind AS kind, g.studied_from AS sf, g.irq_chain AS irq, g.memory_map AS mm`,
    );
    expect(r.data[0]).toEqual({ kind: "built", sf: null, irq: null, mm: null });
  });
});
