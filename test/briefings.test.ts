import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorService } from "../src/services/falkor.js";
import { demoBriefing, gameBriefing, whyProposed } from "../src/tools/briefings.js";
import { BriefingSchema } from "../src/schemas/tool-outputs.js";

/**
 * Briefing tests — seed a minimal representative graph so we can test
 * technique resolution, pitfall surfacing, compatibility check, and
 * build order without depending on a pre-loaded live corpus.
 *
 * Graph setup mirrors the patterns in technique-lookup.test.ts and
 * pitfalls-for.test.ts: clean() → ensureSchema() → seed minimal nodes.
 */
describe("demoBriefing", () => {
  let f: FalkorService;

  beforeAll(async () => {
    f = new FalkorService();
    await f.connect();
    await f.clean();
    await f.ensureSchema();

    // --- Techniques ---
    await f.addTechnique({ name: "stable_raster_irq", title: "Stable raster IRQ", category: "raster", complexity: "medium" });
    await f.addTechnique({ name: "raster_bars", title: "Raster color bars", category: "raster", complexity: "low" });
    await f.addTechnique({ name: "soft_scroll_h", title: "Hardware horizontal soft-scroll", category: "scroll", complexity: "low", cost: { cycles_per_frame: 74041 }, cost_basis: "measured-vice" });
    await f.addTechnique({ name: "sprite_multiplex_8", title: "8-sprite multiplexer", category: "sprite", complexity: "medium" });
    await f.addTechnique({ name: "sid_play_routine_pattern", title: "The init+play subroutine convention", category: "music", complexity: "low", cost: { cycles_per_frame: 327, irq_slots: 1 }, cost_basis: "measured-vice" });
    await f.addTechnique({ name: "sprite_multiplex_24", title: "24-sprite multiplexer", category: "sprite", complexity: "high", cost: { cycles_per_frame: 700, irq_slots: 3, bytes_code: 900 }, cost_basis: "estimated" });
    await f.addTechnique({ name: "sid_voice_setup", title: "Frequency / waveform / ADSR per voice", category: "music", complexity: "low" });
    await f.addTechnique({ name: "standard_bitmap", title: "Standard bitmap mode", category: "bitmap", complexity: "low" });
    await f.addTechnique({ name: "plasma", title: "Plasma effect via sine table additions", category: "effect", complexity: "medium" });

    // --- Registers ---
    await f.addRegister("D011", "$D011", "VIC-II", "RW", ["SCROLY"]);
    await f.addRegister("D012", "$D012", "VIC-II", "RW", ["RASTER"]);
    await f.addRegister("D019", "$D019", "VIC-II", "RW", ["VICIRQ"]);
    await f.addRegister("D01A", "$D01A", "VIC-II", "RW", ["IRQMSK"]);
    await f.addRegister("D020", "$D020", "VIC-II", "W", ["EXTCOL"]);
    await f.addRegister("D021", "$D021", "VIC-II", "W", ["BGCOL0"]);
    await f.addRegister("D016", "$D016", "VIC-II", "RW", ["SCROLX"]);
    await f.addRegister("D400", "$D400", "SID", "W", ["FRELO1"]);
    await f.addRegister("D418", "$D418", "SID", "W", ["SIGVOL"]);

    // --- USES edges ---
    await f.linkTechniqueUsesRegister("stable_raster_irq", "D011");
    await f.linkTechniqueUsesRegister("stable_raster_irq", "D012");
    await f.linkTechniqueUsesRegister("stable_raster_irq", "D019");
    await f.linkTechniqueUsesRegister("stable_raster_irq", "D01A");
    await f.linkTechniqueUsesRegister("raster_bars", "D012");
    await f.linkTechniqueUsesRegister("raster_bars", "D019");
    await f.linkTechniqueUsesRegister("raster_bars", "D020");
    await f.linkTechniqueUsesRegister("raster_bars", "D021");
    await f.linkTechniqueUsesRegister("soft_scroll_h", "D016");
    await f.linkTechniqueUsesRegister("sid_voice_setup", "D400");
    await f.linkTechniqueUsesRegister("sid_play_routine_pattern", "D400");
    await f.linkTechniqueUsesRegister("sid_play_routine_pattern", "D418");

    // --- DEMANDS edges (what the toolchain handoff reads) ---
    // stable_raster_irq takes interrupts inside the display; raster_bars, in
    // the same category, declares nothing and stays in C.
    await f.linkTechniqueDemands("stable_raster_irq", "midframe_raster_irqs", "takes raster interrupts inside the display area");

    // --- Recipes ---
    await f.addRecipe({
      name: "oscar64-stable-raster-irq",
      toolchain: "oscar64",
      output_format: "PRG",
      region: "both",
      source_doc: "recipes/oscar64/stable-raster-irq.md",
    });
    await f.linkRecipeImplements("oscar64-stable-raster-irq", "stable_raster_irq");

    await f.addRecipe({
      name: "kickassembler-raster-bars",
      toolchain: "kickassembler",
      output_format: "PRG",
      region: "both",
      source_doc: "recipes/kickassembler/raster-bars.md",
    });
    await f.linkRecipeImplements("kickassembler-raster-bars", "raster_bars");

    await f.addRecipe({
      name: "oscar64-sid-music-player",
      toolchain: "oscar64",
      output_format: "PRG",
      region: "both",
      source_doc: "recipes/oscar64/sid-music-player.md",
    });
    await f.linkRecipeImplements("oscar64-sid-music-player", "sid_play_routine_pattern");

    await f.addRecipe({
      name: "oscar64-simple-shmup",
      toolchain: "oscar64",
      output_format: "PRG",
      region: "both",
      source_doc: "recipes/oscar64/simple-shmup.md",
    });
    await f.linkRecipeImplements("oscar64-simple-shmup", "sprite_multiplex_8");

    // --- Pitfalls ---
    await f.addPitfall({
      name: "raster_irq_jitter",
      title: "Raster IRQ fires with 1-2 cycle jitter without stable-IRQ",
      severity: "high",
      region: "both",
      category: "raster",
    });
    await f.linkTriggeredBy("raster_irq_jitter", "stable_raster_irq", "Technique");
    await f.linkTriggeredBy("raster_irq_jitter", "D012", "Register");

    await f.addPitfall({
      name: "sprite_dma_overflow",
      title: "More than 8 active sprites causes DMA overflow and corruption",
      severity: "high",
      region: "both",
      category: "sprite",
    });
    await f.linkTriggeredBy("sprite_dma_overflow", "sprite_multiplex_8", "Technique");

    await f.addPitfall({
      name: "sid_chip_variation",
      title: "6581 vs 8580 filter differences break cross-chip portability",
      severity: "medium",
      region: "both",
      category: "sid",
    });
    await f.linkTriggeredBy("sid_chip_variation", "sid_voice_setup", "Technique");
    await f.linkTriggeredBy("sid_chip_variation", "sid_play_routine_pattern", "Technique");
  });

  afterAll(async () => f?.close());

  it("returns a structured plan for a sprite-scroller brief", async () => {
    const r = await demoBriefing("sprite scroller with raster bars and SID music");
    expect(r.structured.brief).toBeTruthy();
    expect(r.structured.proposed_techniques.length).toBeGreaterThanOrEqual(3);
    const names = r.structured.proposed_techniques.map(t => t.name);
    expect(names.some(n => n.includes("scroll") || n.includes("sprite"))).toBe(true);
    expect(names.some(n => n.includes("raster") || n.includes("bar"))).toBe(true);
    expect(names.some(n => n.includes("sid"))).toBe(true);
  });

  it("adds the plan up from the graph's cost properties and names the techniques without a line", async () => {
    const r = await demoBriefing("sprite scroller with raster bars and SID music");
    const b = r.structured.budget;
    expect(b.region).toBe("PAL");
    expect(b.frame_cycles).toBe(19656);
    const names = r.structured.proposed_techniques.map(t => t.name);
    const costed = names.filter(n => ["soft_scroll_h", "sid_play_routine_pattern", "sprite_multiplex_24"].includes(n));
    expect(costed.length).toBeGreaterThanOrEqual(1);
    for (const n of costed) expect(b.contributors.map(c => c.name)).toContain(n);
    for (const n of names.filter(n => !costed.includes(n))) expect(b.without_cost).toContain(n);
    expect(b.is_floor).toBe(b.without_cost.length > 0);
    const expected = b.contributors.reduce((s, c) => s + (c.cycles_per_frame ?? 0), 0);
    expect(b.cycles_per_frame_sum).toBe(expected);
    expect(b.cycles_verdict).toBe(expected > 19656 ? "over" : "under");
    expect(r.text).toContain("## Budget (PAL)");
    expect(BriefingSchema.parse(r.structured)).toBeTruthy();
  });

  it("includes pitfalls relevant to proposed techniques", async () => {
    const r = await demoBriefing("stable raster IRQ with 24 sprites");
    expect(r.structured.pitfalls.length).toBeGreaterThanOrEqual(1);
  });

  it("proposes Oscar64 as primary toolchain", async () => {
    const r = await demoBriefing("simple bitmap demo");
    expect(r.structured.toolchain_split.primary).toBe("oscar64");
  });

  it("hands a technique to KickAssembler by what it demands, not by its category", async () => {
    const r = await demoBriefing("stable raster bars");
    const proposed = r.structured.proposed_techniques.map(t => t.name);
    const handoff = r.structured.toolchain_split.cycle_tight_handoff;
    // Both are category raster. Only stable_raster_irq declares a demand
    // (midframe_raster_irqs), so only it is handed off; deciding by category
    // used to hand off raster_bars as well.
    if (proposed.includes("stable_raster_irq")) expect(handoff).toContain("stable_raster_irq");
    expect(handoff).not.toContain("raster_bars");
    expect(proposed).toContain("raster_bars");
  });

  // P5-4 regression: sideborder_open must not be tagged as SID music
  it("does not falsely tag sideborder_open as SID music", async () => {
    const r = await demoBriefing("open sideborder for raster bars");
    const tech = r.structured.proposed_techniques.find(t => t.name === "sideborder_open");
    if (tech) {
      expect(tech.why_proposed).not.toContain("SID music");
    }
  });

  it("uses category not name-substring for SID classification (direct unit test)", () => {
    // sideborder_open: category=raster — must NOT classify as SID
    expect(whyProposed("sideborder_open", "raster", "open sideborder raster bars demo"))
      .not.toContain("SID");

    // sid_play_routine_pattern: category=music — MUST classify as SID
    expect(whyProposed("sid_play_routine_pattern", "music", "game with background music"))
      .toBe("SID music / audio requested in brief");

    // sid_voice_setup: category=music — MUST classify as SID
    expect(whyProposed("sid_voice_setup", "music", "anything"))
      .toBe("SID music / audio requested in brief");
  });

  it("caps techniques per category at 3 (SID over-representation guard)", async () => {
    const r = await demoBriefing("music demo with SID FM filter wavetable digi voice");
    const categoryCounts = new Map<string, number>();
    for (const t of r.structured.proposed_techniques) {
      categoryCounts.set(t.category, (categoryCounts.get(t.category) ?? 0) + 1);
    }
    for (const [cat, count] of categoryCounts) {
      expect(count, `category ${cat} should be capped at 3`).toBeLessThanOrEqual(3);
    }
  });

  // P5-9: no-match brief — must return a valid BriefingOutput without crashing
  it("returns empty proposed_techniques for an unrecognizable brief", async () => {
    const r = await demoBriefing("zxqyzx unrelated nonsense gibberish");
    // We expect either 0 techniques OR a fallback set with low confidence,
    // but never a crash. The contract is: must return a valid BriefingOutput.
    expect(r.structured.brief).toBeDefined();
    expect(Array.isArray(r.structured.proposed_techniques)).toBe(true);
    expect(Array.isArray(r.structured.build_order)).toBe(true);
  });

  // DEMO-DOG-1 regression: "raster bars + scroller + SID" should surface
  // the foundation techniques (stable_raster_irq, soft_scroll_h, a sid_*),
  // not just exotic scene-tier siblings. Before the recipe-evidence +
  // complexity-penalty scoring, the briefing missed all three.
  it("surfaces foundation techniques (recipe-rich + low complexity) over exotic siblings", async () => {
    // Seed an exotic high-complexity technique with no recipes so we can
    // verify the foundation outranks it. text_zoom has no implementing
    // recipe in the live KB, so it should NOT outrank stable_raster_irq.
    await f.addTechnique({ name: "text_zoom", title: "Per-line $D016 zoom", category: "effect", complexity: "high" });

    const r = await demoBriefing("raster bars with a horizontal scroller and SID music");
    const names = r.structured.proposed_techniques.map(t => t.name);

    // Foundations must appear
    expect(names, "stable_raster_irq is the raster foundation; must surface").toContain("stable_raster_irq");
    expect(names, "soft_scroll_h is the canonical scroll technique; must surface").toContain("soft_scroll_h");
    // At least one SID technique
    expect(names.some(n => n.startsWith("sid_")), "at least one sid_* technique must surface").toBe(true);

    // The exotic high-complexity sibling with no recipes must NOT outrank the
    // recipe-backed foundation. Find both indices.
    const ftZoomIdx = names.indexOf("text_zoom");
    const ftStableIdx = names.indexOf("stable_raster_irq");
    if (ftZoomIdx !== -1) {
      expect(ftStableIdx).toBeGreaterThan(-1);
      expect(ftStableIdx, "stable_raster_irq must outrank exotic text_zoom").toBeLessThan(ftZoomIdx);
    }
  });

  // P5-9: schema-parse stability across varied briefs
  it("output validates against BriefingSchema for varied briefs", async () => {
    const briefs = [
      "demo with no specific technique signal",
      "music heavy SID demo",
      "raster bars stable IRQ",
    ];
    for (const desc of briefs) {
      const r = await demoBriefing(desc);
      expect(() => BriefingSchema.parse(r.structured)).not.toThrow();
    }
  });
});

describe("gameBriefing", () => {
  let f: FalkorService;

  beforeAll(async () => {
    f = new FalkorService();
    await f.connect();
    await f.clean();
    await f.ensureSchema();

    // Seed techniques relevant to shmup
    await f.addTechnique({ name: "sprite_multiplex_8", title: "8-sprite multiplexer", category: "sprite", complexity: "medium" });
    await f.addTechnique({ name: "soft_scroll_v", title: "Hardware vertical soft-scroll", category: "scroll", complexity: "low" });
    await f.addTechnique({ name: "sid_play_routine_pattern", title: "The init+play subroutine convention", category: "music", complexity: "low" });
    await f.addTechnique({ name: "stable_raster_irq", title: "Stable raster IRQ", category: "raster", complexity: "medium" });

    // Registers
    await f.addRegister("D011", "$D011", "VIC-II", "RW", ["SCROLY"]);
    await f.addRegister("D016", "$D016", "VIC-II", "RW", ["SCROLX"]);
    await f.addRegister("D418", "$D418", "SID", "W", ["SIGVOL"]);

    // Recipes — must include shmup recipe
    await f.addRecipe({
      name: "oscar64-simple-shmup",
      toolchain: "oscar64",
      output_format: "PRG",
      region: "both",
      source_doc: "recipes/oscar64/simple-shmup.md",
    });
    await f.linkRecipeImplements("oscar64-simple-shmup", "sprite_multiplex_8");

    await f.addRecipe({
      name: "oscar64-stable-raster-irq",
      toolchain: "oscar64",
      output_format: "PRG",
      region: "both",
      source_doc: "recipes/oscar64/stable-raster-irq.md",
    });
    await f.linkRecipeImplements("oscar64-stable-raster-irq", "stable_raster_irq");

    await f.addRecipe({
      name: "oscar64-sid-music-player",
      toolchain: "oscar64",
      output_format: "PRG",
      region: "both",
      source_doc: "recipes/oscar64/sid-music-player.md",
    });
    await f.linkRecipeImplements("oscar64-sid-music-player", "sid_play_routine_pattern");
  });

  afterAll(async () => f?.close());

  it("returns a structured plan with archetype for a shmup brief", async () => {
    const r = await gameBriefing("vertical scrolling shoot-em-up", "shmup");
    expect(r.structured.proposed_techniques.length).toBeGreaterThanOrEqual(3);
    expect(r.structured.build_order.some(s => s.recipes.some(rec => rec.includes("shmup")))).toBe(true);
  });

  // P5-9: gameBriefing without archetype — isGame=false (archetype===undefined),
  // so no scaffold step is added and the brief is labelled as a "demo" plan.
  it("gameBriefing without archetype still builds a valid plan (no scaffold step)", async () => {
    const r = await gameBriefing("a small arcade game", undefined);
    // isGame = archetype !== undefined → false when undefined, so brief says "demo"
    expect(r.structured.brief).toContain("demo");
    // No scaffold step because isGame is false
    const scaffoldStep = r.structured.build_order.find(s => s.label.includes("Game scaffold"));
    expect(scaffoldStep).toBeUndefined();
  });
});

// Forced-technique enforcement (puzzle-tetris dogfood, 2026-05-18):
// A pre-Phase-7 puzzle briefing didn't surface the text-mode rendering
// foundation, so the dirty_cell_skip_leaves_overlay_trail pitfall never made
// it to the agent. This fixture has no Archetype nodes, so it exercises the
// FALLBACK_FORCED_TECHNIQUES table only. With the archetype page ingested
// the same guarantee comes from the page's fingerprint (puzzle and
// action_puzzle both name text_mode_overlay_render); the graph path is
// covered in "gameBriefing reads the archetype from the graph" below.
describe("gameBriefing FORCED_TECHNIQUES_FOR_ARCHETYPE enforcement", () => {
  let f: FalkorService;

  beforeAll(async () => {
    f = new FalkorService();
    await f.connect();
    await f.clean();
    await f.ensureSchema();

    // Forced technique for puzzle/adventure
    await f.addTechnique({
      name: "text_mode_overlay_render",
      title: "Playfield + moving-piece overlay in text mode",
      category: "render",
      complexity: "low",
    });

    // A noise technique the keyword scorer might otherwise rank above the forced one
    await f.addTechnique({ name: "sid_play_routine_pattern", title: "init+play", category: "music", complexity: "low" });

    // Pitfall triggered by the forced technique
    await f.addPitfall({
      name: "dirty_cell_skip_leaves_overlay_trail",
      title: "Skipping unchanged cells leaves the moving piece's prior position un-cleared",
      severity: "high",
      region: "both",
      category: "render",
    });
    await f.linkTriggeredBy(
      "dirty_cell_skip_leaves_overlay_trail",
      "text_mode_overlay_render",
      "Technique"
    );
  });

  afterAll(async () => f?.close());

  it("puzzle archetype always proposes text_mode_overlay_render even when the description omits rendering keywords", async () => {
    const r = await gameBriefing("a thinky logic game", "puzzle");
    const names = r.structured.proposed_techniques.map(t => t.name);
    expect(names).toContain("text_mode_overlay_render");
  });

  it("puzzle archetype surfaces dirty_cell_skip_leaves_overlay_trail via the forced technique", async () => {
    const r = await gameBriefing("tetris-like falling pieces", "puzzle");
    const pitfallNames = r.structured.pitfalls.map(p => p.name);
    expect(pitfallNames).toContain("dirty_cell_skip_leaves_overlay_trail");
  });

  it("adventure archetype also forces text_mode_overlay_render (text-mode adventures share the overlay pattern)", async () => {
    const r = await gameBriefing("a small text adventure", "adventure");
    const names = r.structured.proposed_techniques.map(t => t.name);
    expect(names).toContain("text_mode_overlay_render");
  });

  it("shmup archetype does NOT force text_mode_overlay_render (sprite-based, not text-mode)", async () => {
    const r = await gameBriefing("vertical shoot-em-up", "shmup");
    const names = r.structured.proposed_techniques.map(t => t.name);
    expect(names).not.toContain("text_mode_overlay_render");
  });

  it("demo brief mentioning 'text-mode playfield' forces the render technique regardless of archetype", async () => {
    const r = await demoBriefing("a text-mode playfield demo with falling glyphs");
    const names = r.structured.proposed_techniques.map(t => t.name);
    expect(names).toContain("text_mode_overlay_render");
  });

  it("description keyword 'tetris' alone (no archetype) is enough to force the render technique", async () => {
    const r = await gameBriefing("a tetris clone", undefined);
    const names = r.structured.proposed_techniques.map(t => t.name);
    expect(names).toContain("text_mode_overlay_render");
  });
});

// Archetypes live in the graph (schema 21, docs/CONVENTIONS-archetypes.md).
// With Archetype nodes present the briefing reads FEATURES and RISKS and
// never consults the built-in fallback tables; the describes above build
// graphs WITHOUT Archetype nodes and exercise the fallback.
describe("gameBriefing reads the archetype from the graph", () => {
  let f: FalkorService;

  beforeAll(async () => {
    f = new FalkorService();
    await f.connect();
    await f.clean();
    await f.ensureSchema();

    // Four sprite techniques: with the fingerprint forcing all four, the
    // three-per-category cap must not cut one of them.
    await f.addTechnique({ name: "sprite_multiplex_24", title: "24-sprite multiplexer", category: "sprite", complexity: "high" });
    await f.addTechnique({ name: "sprite_collision_detect", title: "Hardware sprite collision", category: "sprite", complexity: "low" });
    await f.addTechnique({ name: "sprite_expand", title: "Sprite X/Y expand", category: "sprite", complexity: "low" });
    await f.addTechnique({ name: "sprite_multiplex_8", title: "8-sprite multiplexer", category: "sprite", complexity: "medium" });
    await f.addTechnique({ name: "soft_scroll_v", title: "Hardware vertical soft-scroll", category: "scroll", complexity: "low" });
    await f.addTechnique({ name: "stable_raster_irq", title: "Stable raster IRQ", category: "raster", complexity: "medium" });
    // Present in the graph, not in the fingerprint: must not be forced.
    await f.addTechnique({ name: "text_mode_overlay_render", title: "Playfield overlay in text mode", category: "render", complexity: "low" });

    await f.addPitfall({ name: "sprite_dma_overflow", title: "Too many sprites on one line", severity: "high", region: "both", category: "sprite" });
    await f.linkTriggeredBy("sprite_dma_overflow", "sprite_multiplex_24", "Technique");
    // A risk no proposed technique triggers: reaches the plan only through RISKS.
    await f.addPitfall({ name: "raster_line_count_difference", title: "PAL and NTSC frames differ in length", severity: "medium", region: "both", category: "region" });

    await f.addArchetype({ name: "vertical_shmup", title: "Vertical Shmup", kind: "game", source_doc: "docs/game-design/c64-game-archetypes.md" });
    for (const t of ["soft_scroll_v", "sprite_multiplex_24", "sprite_collision_detect", "sprite_expand", "sprite_multiplex_8", "stable_raster_irq"]) {
      await f.linkArchetypeFeatures("vertical_shmup", t);
    }
    await f.linkArchetypeRisks("vertical_shmup", "sprite_dma_overflow");
    await f.linkArchetypeRisks("vertical_shmup", "raster_line_count_difference");
    await f.addArchetype({ name: "puzzle", title: "Puzzle", kind: "game", source_doc: "docs/game-design/c64-game-archetypes.md" });
    await f.linkArchetypeFeatures("puzzle", "stable_raster_irq");

    // Shaped like the page's action_puzzle: the fingerprint names the
    // text-mode technique, and the pitfall behind it must reach the plan
    // through FEATURES alone, with nothing in the description to match.
    await f.addPitfall({ name: "dirty_cell_skip_leaves_overlay_trail", title: "Skipping unchanged cells leaves the moving piece's prior position un-cleared", severity: "high", region: "both", category: "render" });
    await f.linkTriggeredBy("dirty_cell_skip_leaves_overlay_trail", "text_mode_overlay_render", "Technique");
    await f.addArchetype({ name: "action_puzzle", title: "Action Puzzle", kind: "game", source_doc: "docs/game-design/c64-game-archetypes.md" });
    await f.linkArchetypeFeatures("action_puzzle", "stable_raster_irq");
    await f.linkArchetypeFeatures("action_puzzle", "text_mode_overlay_render");

    await f.addRecipe({ name: "oscar64-simple-shmup", toolchain: "oscar64", output_format: "PRG", region: "both", source_doc: "recipes/oscar64/simple-shmup.md" });
    await f.linkRecipeImplements("oscar64-simple-shmup", "sprite_multiplex_8");
  });

  afterAll(async () => f?.close());

  it("forces every FEATURES target into the proposal, past the per-category cap", async () => {
    const r = await gameBriefing("a shooter", "vertical_shmup");
    const names = r.structured.proposed_techniques.map(t => t.name);
    for (const t of ["soft_scroll_v", "sprite_multiplex_24", "sprite_collision_detect", "sprite_expand", "sprite_multiplex_8", "stable_raster_irq"]) {
      expect(names).toContain(t);
    }
    expect(names.filter(n => n.startsWith("sprite_"))).toHaveLength(4);
    expect(r.structured.archetype).toEqual({
      name: "vertical_shmup",
      title: "Vertical Shmup",
      kind: "game",
      features: ["soft_scroll_v", "sprite_collision_detect", "sprite_expand", "sprite_multiplex_24", "sprite_multiplex_8", "stable_raster_irq"],
      risks: ["raster_line_count_difference", "sprite_dma_overflow"],
    });
    expect(r.structured.archetype_not_found).toBeUndefined();
    expect(BriefingSchema.safeParse(r.structured).success).toBe(true);
  });

  it("adds every RISKS target to the pitfalls, including one no proposed technique triggers", async () => {
    const r = await gameBriefing("a shooter", "vertical_shmup");
    const byName = new Map(r.structured.pitfalls.map(p => [p.name, p]));
    expect(byName.get("sprite_dma_overflow")?.triggered_by_proposed).toEqual(["sprite_multiplex_24"]);
    expect(byName.get("raster_line_count_difference")?.triggered_by_proposed).toEqual([]);
    expect(r.text).toContain("archetype risk");
  });

  it("resolves a partial archetype name when exactly one archetype contains it, and says what it resolved from", async () => {
    // Only vertical_shmup contains "shmup" in this fixture.
    const r = await gameBriefing("a shooter", "shmup");
    expect(r.structured.archetype?.name).toBe("vertical_shmup");
    expect(r.structured.archetype?.resolved_from).toBe("shmup");
    expect(r.structured.archetype_not_found).toBeUndefined();
    expect(BriefingSchema.safeParse(r.structured).success).toBe(true);
  });

  it("reports candidates instead of guessing when a partial name matches several archetypes", async () => {
    // "zzle" is contained by puzzle and action_puzzle.
    const r = await gameBriefing("a thinky game", "zzle");
    expect(r.structured.archetype).toBeUndefined();
    expect(r.structured.archetype_not_found?.candidates?.sort()).toEqual(["action_puzzle", "puzzle"]);
    expect(r.structured.archetype_not_found?.known).toContain("vertical_shmup");
    expect(r.text).toContain("Did you mean one of");
  });

  it("does not read the fallback tables when the graph has archetypes", async () => {
    // "puzzle" in the fallback table forced text_mode_overlay_render; this
    // fixture's puzzle fingerprint does not name it, so it must not appear.
    const r = await gameBriefing("a thinky logic game", "puzzle");
    const names = r.structured.proposed_techniques.map(t => t.name);
    expect(names).toContain("stable_raster_irq");
    expect(names).not.toContain("text_mode_overlay_render");
    expect(r.structured.archetype?.name).toBe("puzzle");
  });

  it("surfaces dirty_cell_skip_leaves_overlay_trail through a FEATURES edge alone (2026-05-18 dogfood guard, graph path)", async () => {
    // No rendering keyword in the description: the technique arrives only
    // because the archetype's fingerprint names it, and the pitfall only
    // because that technique triggers it.
    const r = await gameBriefing("a thinky logic game", "action_puzzle");
    const names = r.structured.proposed_techniques.map(t => t.name);
    expect(names).toContain("text_mode_overlay_render");
    const pitfall = r.structured.pitfalls.find(p => p.name === "dirty_cell_skip_leaves_overlay_trail");
    expect(pitfall?.triggered_by_proposed).toEqual(["text_mode_overlay_render"]);
    expect(r.structured.archetype?.features).toEqual(["stable_raster_irq", "text_mode_overlay_render"]);
  });

  it("reads a title-cased or hyphenated name as the snake_case node", async () => {
    const r = await gameBriefing("a shooter", "Vertical-Shmup");
    expect(r.structured.archetype?.name).toBe("vertical_shmup");
    expect(r.structured.brief).toContain("vertical_shmup");
  });

  it("seeds the shmup scaffold recipe from the graph name, not the string 'shmup'", async () => {
    const r = await gameBriefing("a shooter", "vertical_shmup");
    expect(r.structured.build_order[0].label).toContain("vertical_shmup");
    expect(r.structured.build_order[0].recipes).toEqual(["oscar64-simple-shmup"]);
  });

  it("reports archetype_not_found with the known names for a name the graph lacks", async () => {
    // "racer" shares no word with any fixture archetype, so nothing resolves or is offered.
    const r = await gameBriefing("vertical scrolling shoot-em-up", "racer");
    expect(r.structured.archetype).toBeUndefined();
    expect(r.structured.archetype_not_found).toEqual({ requested: "racer", known: ["action_puzzle", "puzzle", "vertical_shmup"] });
    expect(r.structured.brief).toContain("not an archetype the graph knows");
    expect(r.text).toContain("Known archetypes: action_puzzle, puzzle, vertical_shmup");
    // The plan is still built from the description; nothing is forced.
    expect(r.structured.build_order[0].label).toContain("Game scaffold");
    expect(r.structured.build_order[0].recipes).toEqual([]);
    expect(BriefingSchema.safeParse(r.structured).success).toBe(true);
  });
});

// Demo forms ride the same Archetype node with kind: demo
// (docs/demo-design/intro-cracktro-patterns.md, docs/CONVENTIONS-archetypes.md).
// demoBriefing with an archetype must read FEATURES and RISKS from the graph
// the way gameBriefing does, and a name the graph lacks must be reported.
describe("demoBriefing reads a demo archetype from the graph", () => {
  let f: FalkorService;

  beforeAll(async () => {
    f = new FalkorService();
    await f.connect();
    await f.clean();
    await f.ensureSchema();

    // Four raster techniques in the fingerprint: the three-per-category cap
    // must not cut one of them. Nothing in the description "a small intro"
    // names any of these, so a proposal can only come from FEATURES.
    await f.addTechnique({ name: "stable_raster_irq", title: "Stable raster IRQ", category: "raster", complexity: "medium" });
    await f.addTechnique({ name: "sideborder_open", title: "Open the side borders", category: "raster", complexity: "high" });
    await f.addTechnique({ name: "raster_bars", title: "Raster bars", category: "raster", complexity: "low" });
    await f.addTechnique({ name: "irq_chain_table", title: "Table-driven IRQ chain", category: "raster", complexity: "medium" });
    await f.addTechnique({ name: "soft_scroll_h", title: "Hardware horizontal soft-scroll", category: "scroll", complexity: "low" });
    await f.addTechnique({ name: "sid_play_routine_pattern", title: "SID init/play convention", category: "sid", complexity: "low" });
    // In the graph, not in the fingerprint: must not be forced.
    await f.addTechnique({ name: "plasma", title: "Plasma", category: "effect", complexity: "high" });

    await f.addPitfall({ name: "raster_irq_first_line_jitter", title: "First raster IRQ after enable has unpredictable entry timing", severity: "medium", region: "both", category: "raster" });
    await f.linkTriggeredBy("raster_irq_first_line_jitter", "stable_raster_irq", "Technique");
    // A risk no proposed technique triggers: reaches the plan only through RISKS.
    await f.addPitfall({ name: "d016_unmasked_rmw_clobbers_csel_mcm", title: "Writing $D016 without masking destroys CSEL and MCM", severity: "high", region: "both", category: "scroll" });

    await f.addArchetype({ name: "cracktro", title: "Crack Intro", kind: "demo", source_doc: "docs/demo-design/intro-cracktro-patterns.md" });
    for (const t of ["stable_raster_irq", "sideborder_open", "raster_bars", "irq_chain_table", "soft_scroll_h", "sid_play_routine_pattern"]) {
      await f.linkArchetypeFeatures("cracktro", t);
    }
    await f.linkArchetypeRisks("cracktro", "raster_irq_first_line_jitter");
    await f.linkArchetypeRisks("cracktro", "d016_unmasked_rmw_clobbers_csel_mcm");
    await f.addArchetype({ name: "dentro", title: "Mini-Demo / Dentro", kind: "demo", source_doc: "docs/demo-design/intro-cracktro-patterns.md" });
    await f.linkArchetypeFeatures("dentro", "sid_play_routine_pattern");
    // A game archetype beside the demo ones: the known list spans both kinds.
    await f.addArchetype({ name: "puzzle", title: "Puzzle", kind: "game", source_doc: "docs/game-design/c64-game-archetypes.md" });
    await f.linkArchetypeFeatures("puzzle", "stable_raster_irq");
  });

  afterAll(async () => f?.close());

  it("forces every FEATURES target into the proposal, past the per-category cap", async () => {
    const r = await demoBriefing("a small intro", "cracktro");
    const names = r.structured.proposed_techniques.map(t => t.name);
    for (const t of ["stable_raster_irq", "sideborder_open", "raster_bars", "irq_chain_table", "soft_scroll_h", "sid_play_routine_pattern"]) {
      expect(names).toContain(t);
    }
    expect(names).not.toContain("plasma");
    expect(r.structured.archetype).toEqual({
      name: "cracktro",
      title: "Crack Intro",
      kind: "demo",
      features: ["irq_chain_table", "raster_bars", "sid_play_routine_pattern", "sideborder_open", "soft_scroll_h", "stable_raster_irq"],
      risks: ["d016_unmasked_rmw_clobbers_csel_mcm", "raster_irq_first_line_jitter"],
    });
    expect(r.structured.archetype_not_found).toBeUndefined();
    expect(r.structured.brief).toContain("C64 demo plan");
    expect(r.structured.brief).toContain("form: cracktro");
    expect(r.text).toContain("# C64 Demo Briefing");
    expect(r.text).toContain("**Archetype:** cracktro (Crack Intro, demo)");
    // No game scaffold step on a demo plan.
    expect(r.structured.build_order.some(s => /scaffold/i.test(s.label))).toBe(false);
    expect(BriefingSchema.safeParse(r.structured).success).toBe(true);
  });

  it("adds every RISKS target to the pitfalls, including one no proposed technique triggers", async () => {
    const r = await demoBriefing("a small intro", "cracktro");
    const names = r.structured.pitfalls.map(p => p.name);
    expect(names).toContain("raster_irq_first_line_jitter");
    expect(names).toContain("d016_unmasked_rmw_clobbers_csel_mcm");
    const orphan = r.structured.pitfalls.find(p => p.name === "d016_unmasked_rmw_clobbers_csel_mcm");
    expect(orphan?.triggered_by_proposed).toEqual([]);
    expect(r.text).toContain("archetype risk");
  });

  it("reads a title-cased or hyphenated name as the snake_case node", async () => {
    const r = await demoBriefing("a small intro", "Cracktro");
    expect(r.structured.archetype?.name).toBe("cracktro");
    const r2 = await demoBriefing("two parts and a loader", "Dentro");
    expect(r2.structured.archetype?.name).toBe("dentro");
    expect(r2.structured.proposed_techniques.map(t => t.name)).toContain("sid_play_routine_pattern");
  });

  it("reports archetype_not_found with the known names of both kinds for a name the graph lacks", async () => {
    const r = await demoBriefing("a small intro", "trackmo");
    expect(r.structured.archetype).toBeUndefined();
    expect(r.structured.archetype_not_found).toEqual({ requested: "trackmo", known: ["cracktro", "dentro", "puzzle"] });
    expect(r.structured.brief).toContain('form "trackmo" is not an archetype the graph knows');
    expect(r.text).toContain("Known archetypes: cracktro, dentro, puzzle");
    // Nothing forced: the fingerprint techniques are not in the plan.
    expect(r.structured.proposed_techniques.map(t => t.name)).not.toContain("sideborder_open");
    expect(BriefingSchema.safeParse(r.structured).success).toBe(true);
  });

  it("without an archetype builds the plan as before, with neither field", async () => {
    const r = await demoBriefing("a small intro");
    expect(r.structured.archetype).toBeUndefined();
    expect(r.structured.archetype_not_found).toBeUndefined();
    expect(r.structured.brief).toContain("C64 demo plan");
  });
});
