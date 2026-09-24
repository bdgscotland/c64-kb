import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorService } from "../src/services/falkor.ts";
import { demoBriefing, gameBriefing, whyProposed } from "../src/tools/briefings.ts";
import { BriefingSchema } from "../src/schemas/tool-outputs.ts";
import {
  briefTokens,
  contradictsBriefAxis,
  extractTechniqueNameFromSection,
} from "../src/tools/briefings/discovery.ts";

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
    await f.addTechnique({
      name: "stable_raster_irq",
      title: "Stable raster IRQ",
      category: "raster",
      complexity: "medium",
    });
    await f.addTechnique({
      name: "raster_bars",
      title: "Raster color bars",
      category: "raster",
      complexity: "low",
    });
    await f.addTechnique({
      name: "soft_scroll_h",
      title: "Hardware horizontal soft-scroll",
      category: "scroll",
      complexity: "low",
      cost: { cycles_per_frame: 74041 },
      cost_basis: "measured-vice",
    });
    await f.addTechnique({
      name: "sprite_multiplex_8",
      title: "8-sprite multiplexer",
      category: "sprite",
      complexity: "medium",
    });
    await f.addTechnique({
      name: "sid_play_routine_pattern",
      title: "The init+play subroutine convention",
      category: "music",
      complexity: "low",
      cost: { cycles_per_frame: 327, irq_slots: 1 },
      cost_basis: "measured-vice",
    });
    await f.addTechnique({
      name: "sprite_multiplex_24",
      title: "24-sprite multiplexer",
      category: "sprite",
      complexity: "high",
      cost: { cycles_per_frame: 700, irq_slots: 3, bytes_code: 900 },
      cost_basis: "estimated",
    });
    await f.addTechnique({
      name: "sid_voice_setup",
      title: "Frequency / waveform / ADSR per voice",
      category: "music",
      complexity: "low",
    });
    await f.addTechnique({
      name: "standard_bitmap",
      title: "Standard bitmap mode",
      category: "bitmap",
      complexity: "low",
    });
    await f.addTechnique({
      name: "plasma",
      title: "Plasma effect via sine table additions",
      category: "effect",
      complexity: "medium",
    });

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
    await f.linkTechniqueDemands(
      "stable_raster_irq",
      "midframe_raster_irqs",
      "takes raster interrupts inside the display area",
    );

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

  afterAll(async () => f.close());

  it("returns a structured plan for a sprite-scroller brief", async () => {
    const r = await demoBriefing("sprite scroller with raster bars and SID music");
    expect(r.structured.brief).toBeTruthy();
    expect(r.structured.proposed_techniques.length).toBeGreaterThanOrEqual(3);
    const names = r.structured.proposed_techniques.map((t) => t.name);
    expect(names.some((n) => n.includes("scroll") || n.includes("sprite"))).toBe(true);
    expect(names.some((n) => n.includes("raster") || n.includes("bar"))).toBe(true);
    expect(names.some((n) => n.includes("sid"))).toBe(true);
  });

  it("adds the plan up from the graph's cost properties and names the techniques without a line", async () => {
    const r = await demoBriefing("sprite scroller with raster bars and SID music");
    const b = r.structured.budget;
    expect(b.region).toBe("PAL");
    expect(b.frame_cycles).toBe(19656);
    const names = r.structured.proposed_techniques.map((t) => t.name);
    const costed = names.filter((n) =>
      ["soft_scroll_h", "sid_play_routine_pattern", "sprite_multiplex_24"].includes(n),
    );
    expect(costed.length).toBeGreaterThanOrEqual(1);
    for (const n of costed) expect(b.contributors.map((c) => c.name)).toContain(n);
    for (const n of names.filter((n) => !costed.includes(n))) expect(b.without_cost).toContain(n);
    // Schema 27: a member with no cycles figure is unknown, never zero, so
    // the verdict cannot be "under" while one is in the set.
    for (const n of b.without_cost) expect(b.unknown).toContain(n);
    expect(b.is_floor).toBe(b.unknown.length > 0);
    const expected = b.contributors.reduce((s, c) => s + (c.cycles_per_frame ?? 0), 0);
    expect(b.cycles_per_frame_sum).toBe(expected);
    if (b.unknown.length > 0) expect(b.cycles_verdict).toBe("undetermined");
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

  it("decides the handoff by what a technique demands and whether Oscar64 has a recipe for it, not by its category", async () => {
    const r = await demoBriefing("stable raster bars");
    const proposed = r.structured.proposed_techniques.map((t) => t.name);
    const handoff = r.structured.toolchain_split.cycle_tight_handoff;
    // Both are category raster. Only stable_raster_irq declares a demand
    // (midframe_raster_irqs); deciding by category used to hand off
    // raster_bars as well. And since 2026-09-22 a cycle-tight technique
    // that an Oscar64 recipe implements stays in Oscar64: this fixture has
    // oscar64-stable-raster-irq, so stable_raster_irq is named as kept.
    expect(handoff).not.toContain("raster_bars");
    expect(proposed).toContain("raster_bars");
    if (proposed.includes("stable_raster_irq")) {
      expect(handoff).not.toContain("stable_raster_irq");
      expect(r.structured.toolchain_split.rationale).toContain(
        "kept in Oscar64 because a recipe exists: stable_raster_irq",
      );
    }
  });

  // P5-4 regression: sideborder_open must not be tagged as SID music
  it("does not falsely tag sideborder_open as SID music", async () => {
    const r = await demoBriefing("open sideborder for raster bars");
    const tech = r.structured.proposed_techniques.find((t) => t.name === "sideborder_open");
    if (tech) {
      expect(tech.why_proposed).not.toContain("SID music");
    }
  });

  it("uses category not name-substring for SID classification (direct unit test)", () => {
    // sideborder_open: category=raster — must NOT classify as SID
    expect(whyProposed("sideborder_open", "raster", "open sideborder raster bars demo")).not.toContain("SID");

    // sid_play_routine_pattern: category=music — MUST classify as SID
    expect(whyProposed("sid_play_routine_pattern", "music", "game with background music")).toBe(
      "SID music / audio requested in brief",
    );

    // sid_voice_setup: category=music — MUST classify as SID
    expect(whyProposed("sid_voice_setup", "music", "anything")).toBe("SID music / audio requested in brief");
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
    await f.addTechnique({
      name: "text_zoom",
      title: "Per-line $D016 zoom",
      category: "effect",
      complexity: "high",
    });

    const r = await demoBriefing("raster bars with a horizontal scroller and SID music");
    const names = r.structured.proposed_techniques.map((t) => t.name);

    // Foundations must appear
    expect(names, "stable_raster_irq is the raster foundation; must surface").toContain("stable_raster_irq");
    expect(names, "soft_scroll_h is the canonical scroll technique; must surface").toContain("soft_scroll_h");
    // At least one SID technique
    expect(
      names.some((n) => n.startsWith("sid_")),
      "at least one sid_* technique must surface",
    ).toBe(true);

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
    await f.addTechnique({
      name: "sprite_multiplex_8",
      title: "8-sprite multiplexer",
      category: "sprite",
      complexity: "medium",
    });
    await f.addTechnique({
      name: "soft_scroll_v",
      title: "Hardware vertical soft-scroll",
      category: "scroll",
      complexity: "low",
    });
    await f.addTechnique({
      name: "sid_play_routine_pattern",
      title: "The init+play subroutine convention",
      category: "music",
      complexity: "low",
    });
    await f.addTechnique({
      name: "stable_raster_irq",
      title: "Stable raster IRQ",
      category: "raster",
      complexity: "medium",
    });

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

  afterAll(async () => f.close());

  it("returns a structured plan with archetype for a shmup brief", async () => {
    const r = await gameBriefing("vertical scrolling shoot-em-up", "shmup");
    expect(r.structured.proposed_techniques.length).toBeGreaterThanOrEqual(3);
    expect(r.structured.build_order.some((s) => s.recipes.some((rec) => rec.includes("shmup")))).toBe(true);
  });

  // P5-9: gameBriefing without archetype. Until 2026-09-23 it was framed as
  // a demo plan ("# C64 Demo Briefing"); it is a game plan, and with no
  // archetype named or routed (this fixture has no Archetype nodes) it has
  // no scaffold step.
  it("gameBriefing without archetype is still a game plan, with no scaffold step", async () => {
    const r = await gameBriefing("a small arcade game", undefined);
    expect(r.structured.brief).toMatch(/^C64 game plan for/);
    expect(r.text.split("\n")[0]).toBe("# C64 Game Briefing");
    expect(r.structured.archetype).toBeUndefined();
    const scaffoldStep = r.structured.build_order.find((s) => s.label.includes("Game scaffold"));
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
    await f.addTechnique({
      name: "sid_play_routine_pattern",
      title: "init+play",
      category: "music",
      complexity: "low",
    });

    // Pitfall triggered by the forced technique
    await f.addPitfall({
      name: "dirty_cell_skip_leaves_overlay_trail",
      title: "Skipping unchanged cells leaves the moving piece's prior position un-cleared",
      severity: "high",
      region: "both",
      category: "render",
    });
    await f.linkTriggeredBy("dirty_cell_skip_leaves_overlay_trail", "text_mode_overlay_render", "Technique");
  });

  afterAll(async () => f.close());

  it("puzzle archetype always proposes text_mode_overlay_render even when the description omits rendering keywords", async () => {
    const r = await gameBriefing("a thinky logic game", "puzzle");
    const names = r.structured.proposed_techniques.map((t) => t.name);
    expect(names).toContain("text_mode_overlay_render");
  });

  it("puzzle archetype surfaces dirty_cell_skip_leaves_overlay_trail via the forced technique", async () => {
    const r = await gameBriefing("tetris-like falling pieces", "puzzle");
    const pitfallNames = r.structured.pitfalls.map((p) => p.name);
    expect(pitfallNames).toContain("dirty_cell_skip_leaves_overlay_trail");
  });

  it("adventure archetype also forces text_mode_overlay_render (text-mode adventures share the overlay pattern)", async () => {
    const r = await gameBriefing("a small text adventure", "adventure");
    const names = r.structured.proposed_techniques.map((t) => t.name);
    expect(names).toContain("text_mode_overlay_render");
  });

  it("shmup archetype does NOT force text_mode_overlay_render (sprite-based, not text-mode)", async () => {
    const r = await gameBriefing("vertical shoot-em-up", "shmup");
    const names = r.structured.proposed_techniques.map((t) => t.name);
    expect(names).not.toContain("text_mode_overlay_render");
  });

  it("demo brief mentioning 'text-mode playfield' forces the render technique regardless of archetype", async () => {
    const r = await demoBriefing("a text-mode playfield demo with falling glyphs");
    const names = r.structured.proposed_techniques.map((t) => t.name);
    expect(names).toContain("text_mode_overlay_render");
  });

  it("description keyword 'tetris' alone (no archetype) is enough to force the render technique", async () => {
    const r = await gameBriefing("a tetris clone", undefined);
    const names = r.structured.proposed_techniques.map((t) => t.name);
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
    await f.addTechnique({
      name: "sprite_multiplex_24",
      title: "24-sprite multiplexer",
      category: "sprite",
      complexity: "high",
    });
    await f.addTechnique({
      name: "sprite_collision_detect",
      title: "Hardware sprite collision",
      category: "sprite",
      complexity: "low",
    });
    await f.addTechnique({
      name: "sprite_expand",
      title: "Sprite X/Y expand",
      category: "sprite",
      complexity: "low",
    });
    await f.addTechnique({
      name: "sprite_multiplex_8",
      title: "8-sprite multiplexer",
      category: "sprite",
      complexity: "medium",
    });
    await f.addTechnique({
      name: "soft_scroll_v",
      title: "Hardware vertical soft-scroll",
      category: "scroll",
      complexity: "low",
    });
    await f.addTechnique({
      name: "stable_raster_irq",
      title: "Stable raster IRQ",
      category: "raster",
      complexity: "medium",
    });
    // Present in the graph, not in the fingerprint: must not be forced.
    await f.addTechnique({
      name: "text_mode_overlay_render",
      title: "Playfield overlay in text mode",
      category: "render",
      complexity: "low",
    });

    await f.addPitfall({
      name: "sprite_dma_overflow",
      title: "Too many sprites on one line",
      severity: "high",
      region: "both",
      category: "sprite",
    });
    await f.linkTriggeredBy("sprite_dma_overflow", "sprite_multiplex_24", "Technique");
    // A risk no proposed technique triggers: reaches the plan only through RISKS.
    await f.addPitfall({
      name: "raster_line_count_difference",
      title: "PAL and NTSC frames differ in length",
      severity: "medium",
      region: "both",
      category: "region",
    });

    await f.addArchetype({
      name: "vertical_shmup",
      title: "Vertical Shmup",
      kind: "game",
      source_doc: "docs/game-design/c64-game-archetypes.md",
    });
    for (const t of [
      "soft_scroll_v",
      "sprite_multiplex_24",
      "sprite_collision_detect",
      "sprite_expand",
      "sprite_multiplex_8",
      "stable_raster_irq",
    ]) {
      await f.linkArchetypeFeatures("vertical_shmup", t);
    }
    await f.linkArchetypeRisks("vertical_shmup", "sprite_dma_overflow");
    await f.linkArchetypeRisks("vertical_shmup", "raster_line_count_difference");
    await f.addArchetype({
      name: "puzzle",
      title: "Puzzle",
      kind: "game",
      source_doc: "docs/game-design/c64-game-archetypes.md",
    });
    await f.linkArchetypeFeatures("puzzle", "stable_raster_irq");

    // Shaped like the page's action_puzzle: the fingerprint names the
    // text-mode technique, and the pitfall behind it must reach the plan
    // through FEATURES alone, with nothing in the description to match.
    await f.addPitfall({
      name: "dirty_cell_skip_leaves_overlay_trail",
      title: "Skipping unchanged cells leaves the moving piece's prior position un-cleared",
      severity: "high",
      region: "both",
      category: "render",
    });
    await f.linkTriggeredBy("dirty_cell_skip_leaves_overlay_trail", "text_mode_overlay_render", "Technique");
    await f.addArchetype({
      name: "action_puzzle",
      title: "Action Puzzle",
      kind: "game",
      source_doc: "docs/game-design/c64-game-archetypes.md",
    });
    await f.linkArchetypeFeatures("action_puzzle", "stable_raster_irq");
    await f.linkArchetypeFeatures("action_puzzle", "text_mode_overlay_render");

    await f.addRecipe({
      name: "oscar64-simple-shmup",
      toolchain: "oscar64",
      output_format: "PRG",
      region: "both",
      source_doc: "recipes/oscar64/simple-shmup.md",
    });
    await f.linkRecipeImplements("oscar64-simple-shmup", "sprite_multiplex_8");
    // The scaffold is an edge, not a name match: vertical_shmup has one,
    // puzzle and action_puzzle have none.
    expect(await f.linkRecipeScaffolds("oscar64-simple-shmup", "vertical_shmup")).toBe(true);
    // A scaffolds: entry naming an archetype the graph lacks is dropped, not stubbed.
    expect(await f.linkRecipeScaffolds("oscar64-simple-shmup", "no_such_archetype")).toBe(false);
  });

  afterAll(async () => f.close());

  it("offers the recipe that SCAFFOLDS the archetype, and names its page in the text", async () => {
    const r = await gameBriefing("a shooter", "vertical_shmup");
    const step = r.structured.build_order[0]!;
    expect(step.label).toBe("Game scaffold (vertical_shmup archetype)");
    expect(step.recipes).toEqual(["oscar64-simple-shmup"]);
    // Once, on the scaffold step only: the same recipe implements
    // sprite_multiplex_8 and so recurs in a later step, which must not
    // repeat the page line.
    const pageLine =
      "copy the scaffold from docs/recipes/oscar64/simple-shmup.md (recipe oscar64-simple-shmup)";
    expect(r.text.split(pageLine).length - 1).toBe(1);
    expect(r.structured.build_order.slice(1).some((s) => s.recipes.includes("oscar64-simple-shmup"))).toBe(
      true,
    );
    expect(BriefingSchema.safeParse(r.structured).success).toBe(true);
  });

  it("gives an archetype with no SCAFFOLDS edge an empty scaffold step", async () => {
    const r = await gameBriefing("a falling-block game", "puzzle");
    const step = r.structured.build_order[0]!;
    expect(step.label).toBe("Game scaffold (puzzle archetype)");
    expect(step.recipes).toEqual([]);
    expect(r.text).not.toContain("copy the scaffold from");
    // No stub Archetype was created by the dropped edge above.
    expect(r.structured.archetype_not_found).toBeUndefined();
    const known = await f.roQuery(`MATCH (a:Archetype {name: "no_such_archetype"}) RETURN a.name AS name`);
    expect(known.data).toHaveLength(0);
  });

  it("forces every FEATURES target into the proposal, past the per-category cap", async () => {
    const r = await gameBriefing("a shooter", "vertical_shmup");
    const names = r.structured.proposed_techniques.map((t) => t.name);
    for (const t of [
      "soft_scroll_v",
      "sprite_multiplex_24",
      "sprite_collision_detect",
      "sprite_expand",
      "sprite_multiplex_8",
      "stable_raster_irq",
    ]) {
      expect(names).toContain(t);
    }
    expect(names.filter((n) => n.startsWith("sprite_"))).toHaveLength(4);
    expect(r.structured.archetype).toEqual({
      name: "vertical_shmup",
      title: "Vertical Shmup",
      kind: "game",
      features: [
        "soft_scroll_v",
        "sprite_collision_detect",
        "sprite_expand",
        "sprite_multiplex_24",
        "sprite_multiplex_8",
        "stable_raster_irq",
      ],
      risks: ["raster_line_count_difference", "sprite_dma_overflow"],
    });
    expect(r.structured.archetype_not_found).toBeUndefined();
    expect(BriefingSchema.safeParse(r.structured).success).toBe(true);
  });

  it("adds every RISKS target to the pitfalls, including one no proposed technique triggers", async () => {
    const r = await gameBriefing("a shooter", "vertical_shmup");
    const byName = new Map(r.structured.pitfalls.map((p) => [p.name, p]));
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
    const names = r.structured.proposed_techniques.map((t) => t.name);
    expect(names).toContain("stable_raster_irq");
    expect(names).not.toContain("text_mode_overlay_render");
    expect(r.structured.archetype?.name).toBe("puzzle");
  });

  it("surfaces dirty_cell_skip_leaves_overlay_trail through a FEATURES edge alone (2026-05-18 dogfood guard, graph path)", async () => {
    // No rendering keyword in the description: the technique arrives only
    // because the archetype's fingerprint names it, and the pitfall only
    // because that technique triggers it.
    const r = await gameBriefing("a thinky logic game", "action_puzzle");
    const names = r.structured.proposed_techniques.map((t) => t.name);
    expect(names).toContain("text_mode_overlay_render");
    const pitfall = r.structured.pitfalls.find((p) => p.name === "dirty_cell_skip_leaves_overlay_trail");
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
    expect(r.structured.build_order[0]!.label).toContain("vertical_shmup");
    expect(r.structured.build_order[0]!.recipes).toEqual(["oscar64-simple-shmup"]);
  });

  it("refuses a name the graph lacks: archetype_not_found with the known names, and no plan (#41)", async () => {
    // "racer" shares no word with any fixture archetype, so nothing resolves or is offered.
    const r = await gameBriefing("vertical scrolling shoot-em-up", "racer");
    expect(r.structured.archetype).toBeUndefined();
    expect(r.structured.archetype_not_found).toEqual({
      requested: "racer",
      known: ["action_puzzle", "puzzle", "vertical_shmup"],
    });
    expect(r.structured.brief).toMatch(/^Refused: genre "racer" is not an archetype the graph knows/);
    expect(r.text).toContain("Known archetypes: action_puzzle, puzzle, vertical_shmup");
    // An earlier version went on to plan from the description alone.
    expect(r.structured.proposed_techniques).toEqual([]);
    expect(r.structured.build_order).toEqual([]);
    expect(r.text).not.toContain("## Proposed Techniques");
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
    await f.addTechnique({
      name: "stable_raster_irq",
      title: "Stable raster IRQ",
      category: "raster",
      complexity: "medium",
    });
    await f.addTechnique({
      name: "sideborder_open",
      title: "Open the side borders",
      category: "raster",
      complexity: "high",
    });
    await f.addTechnique({
      name: "raster_bars",
      title: "Raster bars",
      category: "raster",
      complexity: "low",
    });
    await f.addTechnique({
      name: "irq_chain_table",
      title: "Table-driven IRQ chain",
      category: "raster",
      complexity: "medium",
    });
    await f.addTechnique({
      name: "soft_scroll_h",
      title: "Hardware horizontal soft-scroll",
      category: "scroll",
      complexity: "low",
    });
    await f.addTechnique({
      name: "sid_play_routine_pattern",
      title: "SID init/play convention",
      category: "sid",
      complexity: "low",
    });
    // In the graph, not in the fingerprint: must not be forced.
    await f.addTechnique({ name: "plasma", title: "Plasma", category: "effect", complexity: "high" });

    await f.addPitfall({
      name: "raster_irq_first_line_jitter",
      title: "First raster IRQ after enable has unpredictable entry timing",
      severity: "medium",
      region: "both",
      category: "raster",
    });
    await f.linkTriggeredBy("raster_irq_first_line_jitter", "stable_raster_irq", "Technique");
    // A risk no proposed technique triggers: reaches the plan only through RISKS.
    await f.addPitfall({
      name: "d016_unmasked_rmw_clobbers_csel_mcm",
      title: "Writing $D016 without masking destroys CSEL and MCM",
      severity: "high",
      region: "both",
      category: "scroll",
    });

    await f.addArchetype({
      name: "cracktro",
      title: "Crack Intro",
      kind: "demo",
      source_doc: "docs/demo-design/intro-cracktro-patterns.md",
    });
    for (const t of [
      "stable_raster_irq",
      "sideborder_open",
      "raster_bars",
      "irq_chain_table",
      "soft_scroll_h",
      "sid_play_routine_pattern",
    ]) {
      await f.linkArchetypeFeatures("cracktro", t);
    }
    await f.linkArchetypeRisks("cracktro", "raster_irq_first_line_jitter");
    await f.linkArchetypeRisks("cracktro", "d016_unmasked_rmw_clobbers_csel_mcm");
    await f.addArchetype({
      name: "dentro",
      title: "Mini-Demo / Dentro",
      kind: "demo",
      source_doc: "docs/demo-design/intro-cracktro-patterns.md",
    });
    await f.linkArchetypeFeatures("dentro", "sid_play_routine_pattern");
    // A game archetype beside the demo ones: the known list spans both kinds.
    await f.addArchetype({
      name: "puzzle",
      title: "Puzzle",
      kind: "game",
      source_doc: "docs/game-design/c64-game-archetypes.md",
    });
    await f.linkArchetypeFeatures("puzzle", "stable_raster_irq");
  });

  afterAll(async () => f.close());

  it("forces every FEATURES target into the proposal, past the per-category cap", async () => {
    const r = await demoBriefing("a small intro", "cracktro");
    const names = r.structured.proposed_techniques.map((t) => t.name);
    for (const t of [
      "stable_raster_irq",
      "sideborder_open",
      "raster_bars",
      "irq_chain_table",
      "soft_scroll_h",
      "sid_play_routine_pattern",
    ]) {
      expect(names).toContain(t);
    }
    expect(names).not.toContain("plasma");
    expect(r.structured.archetype).toEqual({
      name: "cracktro",
      title: "Crack Intro",
      kind: "demo",
      features: [
        "irq_chain_table",
        "raster_bars",
        "sid_play_routine_pattern",
        "sideborder_open",
        "soft_scroll_h",
        "stable_raster_irq",
      ],
      risks: ["d016_unmasked_rmw_clobbers_csel_mcm", "raster_irq_first_line_jitter"],
    });
    expect(r.structured.archetype_not_found).toBeUndefined();
    expect(r.structured.brief).toContain("C64 demo plan");
    expect(r.structured.brief).toContain("form: cracktro");
    expect(r.text).toContain("# C64 Demo Briefing");
    expect(r.text).toContain("**Archetype:** cracktro (Crack Intro, demo)");
    // No game scaffold step on a demo plan.
    expect(r.structured.build_order.some((s) => /scaffold/i.test(s.label))).toBe(false);
    expect(BriefingSchema.safeParse(r.structured).success).toBe(true);
  });

  it("adds every RISKS target to the pitfalls, including one no proposed technique triggers", async () => {
    const r = await demoBriefing("a small intro", "cracktro");
    const names = r.structured.pitfalls.map((p) => p.name);
    expect(names).toContain("raster_irq_first_line_jitter");
    expect(names).toContain("d016_unmasked_rmw_clobbers_csel_mcm");
    const orphan = r.structured.pitfalls.find((p) => p.name === "d016_unmasked_rmw_clobbers_csel_mcm");
    expect(orphan?.triggered_by_proposed).toEqual([]);
    expect(r.text).toContain("archetype risk");
  });

  it("reads a title-cased or hyphenated name as the snake_case node", async () => {
    const r = await demoBriefing("a small intro", "Cracktro");
    expect(r.structured.archetype?.name).toBe("cracktro");
    const r2 = await demoBriefing("two parts and a loader", "Dentro");
    expect(r2.structured.archetype?.name).toBe("dentro");
    expect(r2.structured.proposed_techniques.map((t) => t.name)).toContain("sid_play_routine_pattern");
  });

  it("reports archetype_not_found with the known names of both kinds for a name the graph lacks", async () => {
    const r = await demoBriefing("a small intro", "trackmo");
    expect(r.structured.archetype).toBeUndefined();
    expect(r.structured.archetype_not_found).toEqual({
      requested: "trackmo",
      known: ["cracktro", "dentro", "puzzle"],
    });
    expect(r.structured.brief).toContain('form "trackmo" is not an archetype the graph knows');
    expect(r.text).toContain("Known archetypes: cracktro, dentro, puzzle");
    // Refused: no plan at all (#41).
    expect(r.structured.proposed_techniques).toEqual([]);
    expect(BriefingSchema.safeParse(r.structured).success).toBe(true);
  });

  it("without an archetype builds the plan as before, with neither field", async () => {
    const r = await demoBriefing("a small intro");
    expect(r.structured.archetype).toBeUndefined();
    expect(r.structured.archetype_not_found).toBeUndefined();
    expect(r.structured.brief).toContain("C64 demo plan");
  });
});

// Proposer precision and the handoff rule (three-arm build test,
// 2026-09-22): a platformer brief with a "budget bar" was offered
// raster_bars and every bitmap technique through the category word, and the
// KB's own Oscar64 raster recipes were handed to KickAssembler.
describe("gameBriefing proposer precision and handoff", () => {
  let f: FalkorService;

  beforeAll(async () => {
    f = new FalkorService();
    await f.connect();
    await f.clean();
    await f.ensureSchema();
    await f.addTechnique({
      name: "raster_bars",
      title: "Raster color bars",
      category: "raster",
      complexity: "low",
    });
    await f.addTechnique({
      name: "frame_sync_loop",
      title: "Frame-synchronised main loop with a budget bar",
      category: "raster",
      complexity: "low",
    });
    await f.addTechnique({
      name: "koala_format",
      title: "Koala bitmap file format",
      category: "bitmap",
      complexity: "low",
    });
    await f.addTechnique({
      name: "sprite_multiplex_8",
      title: "8-sprite multiplexer",
      category: "sprite",
      complexity: "medium",
    });
    await f.addTechnique({
      name: "sprite_multiplex_24",
      title: "24-sprite multiplexer",
      category: "sprite",
      complexity: "high",
    });
    await f.linkTechniqueDemands("sprite_multiplex_8", "changes_sprite_set", "re-points sprites mid-frame");
    await f.linkTechniqueDemands("sprite_multiplex_24", "changes_sprite_set", "re-points sprites mid-frame");
    // Both own the one raster compare: a hard unit_contention between them.
    for (const owner of ["sprite_multiplex_8", "sprite_multiplex_24"]) {
      await f.linkClaims({
        owner,
        ownerKind: "Technique",
        unit: "vic_raster_irq",
        mode: "owns",
        basis: "derived-listing",
      });
    }
    const recipes: [string, string, string | null][] = [
      ["oscar64-sprite-multiplex-8", "oscar64", "sprite_multiplex_8"],
      ["kickassembler-sprite-multiplex-24", "kickassembler", "sprite_multiplex_24"],
      ["oscar64-frame-sync-loop", "oscar64", "frame_sync_loop"],
      ["oscar64-headless-verify", "oscar64", null],
    ];
    for (const [name, toolchain, tech] of recipes) {
      await f.addRecipe({
        name,
        toolchain,
        output_format: "PRG",
        region: "both",
        source_doc: `recipes/${toolchain}/${name}.md`,
      });
      if (tech) await f.linkRecipeImplements(name, tech);
    }
  });

  afterAll(async () => f.close());

  it("matches whole words: a budget bar is not raster bars and a tile map is not a bitmap format", async () => {
    const r = await gameBriefing("a frame loop with a budget bar and a tile map", undefined);
    const names = r.structured.proposed_techniques.map((t) => t.name);
    expect(names).toContain("frame_sync_loop");
    expect(names).not.toContain("raster_bars");
    expect(names).not.toContain("koala_format");
  });

  it("still proposes raster bars when the brief asks for raster bars", async () => {
    const r = await gameBriefing("raster bars behind the playfield", undefined);
    expect(r.structured.proposed_techniques.map((t) => t.name)).toContain("raster_bars");
  });

  it("keeps a cycle-tight technique in Oscar64 when an Oscar64 recipe implements it, and hands off one that has none", async () => {
    const r = await gameBriefing("a sprite multiplexer for 8 sprites and a 24 sprite multiplexer", undefined);
    const names = r.structured.proposed_techniques.map((t) => t.name);
    expect(names).toContain("sprite_multiplex_8");
    expect(names).toContain("sprite_multiplex_24");
    expect(r.structured.toolchain_split.cycle_tight_handoff).toContain("sprite_multiplex_24");
    expect(r.structured.toolchain_split.cycle_tight_handoff).not.toContain("sprite_multiplex_8");
    expect(r.structured.toolchain_split.rationale).toContain(
      "kept in Oscar64 because a recipe exists: sprite_multiplex_8",
    );
  });

  it("lists every hard conflict an incompatible verdict rests on (#41)", async () => {
    // Before, only region_mismatch reached compatibility.conflicts, so the
    // brief said incompatible over a body of soft notes.
    const r = await gameBriefing("a sprite multiplexer for 8 sprites and a 24 sprite multiplexer", undefined);
    expect(r.structured.brief).toContain("Compatibility: incompatible");
    const hard = r.structured.compatibility.conflicts;
    expect(hard.map((c) => c.kind)).toContain("unit_contention");
    expect(hard.every((c) => c.severity === "hard")).toBe(true);
    expect(r.text).toMatch(
      /\*\*unit_contention\*\* \(hard\): sprite_multiplex_(8|24) × sprite_multiplex_(8|24)/,
    );
  });

  it("ends every build order with the headless verification step when the recipe exists", async () => {
    const r = await gameBriefing("a frame loop", "shmup");
    const last = r.structured.build_order.at(-1)!;
    expect(last.label).toContain("Headless verification");
    expect(last.recipes).toEqual(["oscar64-headless-verify"]);
    expect(BriefingSchema.safeParse(r.structured).success).toBe(true);
  });
});

// Issue #38, briefing routing (2026-09-23). A game brief that names no
// archetype is routed by the archetypes' **Brief words:** lines. Before, a
// Spy Hunter brief was framed as a demo, got no archetype, and was proposed
// char_scroll_buffer_h (the word "scroll"), screen_ram_relocation (the verb
// "ram") and a tail of techniques that matched no word at all, while the
// vector hits on vehicle_control's H3 sections contributed no name.
describe("gameBriefing routes a brief that names no archetype", () => {
  let f: FalkorService;

  const tech = (name: string, title: string, category: string, complexity = "medium") =>
    f.addTechnique({ name, title, category, complexity });

  beforeAll(async () => {
    f = new FalkorService();
    await f.connect();
    await f.clean();
    await f.ensureSchema();
    await tech("soft_scroll_v", "Hardware vertical soft-scroll", "scroll", "low");
    await tech("soft_scroll_h", "Hardware horizontal soft-scroll", "scroll", "low");
    await tech(
      "char_scroll_buffer_h",
      "Char-mode horizontal scroll with screen-RAM buffer rotation",
      "scroll",
    );
    await tech("scroll_panel_split", "Vertically scrolled playfield over a fixed score panel", "scroll");
    await tech("screen_ram_relocation", "Move screen RAM via $D018 hi-nibble", "banking", "low");
    await tech("sprite_multiplex_game", "Game multiplexer in assembly", "sprite", "high");
    await tech("per_frame_hitbox", "Collision boxes per animation frame", "sprite");
    await tech("wave_director", "Attack waves triggered by scroll position", "logic");
    await tech(
      "vehicle_control",
      "Top-down driving on a vertical scroll: throttle is the scroll speed",
      "logic",
    );
    await tech("car_contact_response", "Car contact: push apart, crash off the road", "logic");
    await tech("lane_pursuit_ai", "Road pursuit cars: approach, pull alongside, ram with a lead", "logic");
    await tech("raster_bars", "Raster color bars", "raster", "low");
    await tech("decimal_print", "Print a number in decimal", "text", "low");
    await tech("drive_code_upload_and_job_queue", "Upload code to the 1541 and read sectors", "io");

    // Recipe-rich techniques that share no word with the brief: before the
    // fix their recipe bonus alone put them in the plan.
    for (const [recipe, target] of [
      ["oscar64-decimal-print", "decimal_print"],
      ["oscar64-decimal-print-2", "decimal_print"],
      ["oscar64-drive-code", "drive_code_upload_and_job_queue"],
      ["oscar64-simple-shmup", "soft_scroll_v"],
    ] as const) {
      await f.addRecipe({
        name: recipe,
        toolchain: "oscar64",
        output_format: "PRG",
        region: "both",
        source_doc: `recipes/oscar64/${recipe}.md`,
      });
      await f.linkRecipeImplements(recipe, target);
    }

    const archetypes: [string, string, string[], string[]][] = [
      [
        "vertical_shmup",
        "Vertical Shmup",
        ["vertical shooter", "vertically scrolling", "road shooter", "road", "car", "spy hunter"],
        ["soft_scroll_v", "scroll_panel_split", "sprite_multiplex_game", "per_frame_hitbox", "wave_director"],
      ],
      [
        "horizontal_shmup",
        "Horizontal Shmup",
        ["horizontal shooter", "horizontally scrolling"],
        ["soft_scroll_h"],
      ],
      ["racing", "Racing", ["racing", "race", "pseudo 3d"], ["raster_bars"]],
    ];
    for (const [name, title, words, features] of archetypes) {
      const starter = name === "vertical_shmup" ? { starter: "shmup-vertical" } : {};
      await f.addArchetype({ name, title, kind: "game", source_doc: "a.md", brief_words: words, ...starter });
      for (const t of features) await f.linkArchetypeFeatures(name, t);
    }
    expect(await f.linkRecipeScaffolds("oscar64-simple-shmup", "vertical_shmup")).toBe(true);
  });

  afterAll(async () => f.close());

  const names = (r: Awaited<ReturnType<typeof gameBriefing>>) =>
    r.structured.proposed_techniques.map((t) => t.name);

  it("routes 'Spy Hunter style road shooter' to vertical_shmup and proposes the road-shooter parts", async () => {
    const r = await gameBriefing("Spy Hunter style road shooter");
    expect(r.structured.archetype?.name).toBe("vertical_shmup");
    expect(r.structured.archetype?.inferred_from).toEqual(["road shooter", "road", "spy hunter"]);
    // A routed archetype keeps its starter; the routing query once dropped it.
    expect(r.structured.archetype?.starter).toBe("shmup-vertical");
    expect(r.text).toContain("npm run new-project -- shmup-vertical");
    expect(r.text.split("\n")[0]).toBe("# C64 Game Briefing");
    expect(r.text).toContain("Routed from the brief's words: road shooter, road, spy hunter");
    expect(r.structured.build_order[0]).toEqual({
      step: 1,
      label: "Game scaffold (vertical_shmup archetype)",
      recipes: ["oscar64-simple-shmup"],
    });
    const got = names(r);
    for (const t of [
      "sprite_multiplex_game",
      "scroll_panel_split",
      "per_frame_hitbox",
      "wave_director",
      "vehicle_control",
      "car_contact_response",
      "lane_pursuit_ai",
    ]) {
      expect(got).toContain(t);
    }
    for (const t of ["soft_scroll_h", "char_scroll_buffer_h", "raster_bars", "decimal_print"]) {
      expect(got).not.toContain(t);
    }
    const why = (n: string) => r.structured.proposed_techniques.find((t) => t.name === n)?.why_proposed;
    expect(why("scroll_panel_split")).toBe("In the vertical_shmup archetype's technique fingerprint");
    expect(why("vehicle_control")).not.toContain("fingerprint");
    expect(BriefingSchema.safeParse(r.structured).success).toBe(true);
  });

  it("reads lower-case 'ram' as the verb and drops the other scroll axis", async () => {
    const r = await gameBriefing("vertically scrolling road shooter: enemy cars ram the player's car");
    const got = names(r);
    expect(r.structured.archetype?.name).toBe("vertical_shmup");
    expect(got).not.toContain("screen_ram_relocation");
    expect(got).not.toContain("char_scroll_buffer_h");
    expect(got).not.toContain("drive_code_upload_and_job_queue");
  });

  it("still reads 'RAM' in capitals as the acronym", async () => {
    const r = await gameBriefing("move the screen RAM");
    expect(names(r)).toContain("screen_ram_relocation");
  });

  it("routes a pseudo-3D racing brief that mentions a road to racing, not vertical_shmup", async () => {
    const r = await gameBriefing("pseudo-3D racing game with a curving road");
    expect(r.structured.archetype?.name).toBe("racing");
    expect(r.structured.archetype?.inferred_from).toEqual(["racing", "pseudo 3d"]);
  });

  it("routes nowhere on a tie and says Game with no scaffold step", async () => {
    const r = await gameBriefing("a car racing game");
    expect(r.structured.archetype).toBeUndefined();
    // The tie is offered, not guessed between (#19).
    expect(r.structured.archetype_candidates).toEqual({
      candidates: ["racing", "vertical_shmup"],
      from: ["car", "racing"],
      shared_features: [],
      shared_risks: [],
    });
    expect(r.structured.brief).toContain("(genre not chosen: one of racing, vertical_shmup)");
    expect(r.text.split("\n")[0]).toBe("# C64 Game Briefing");
    expect(r.structured.build_order.some((s) => s.label.startsWith("Game scaffold"))).toBe(false);
  });

  it("offers both shmups for 'a shooter', which no brief-word phrase matches (#19)", async () => {
    const r = await gameBriefing("a shooter");
    expect(r.structured.archetype).toBeUndefined();
    expect(r.structured.archetype_candidates?.candidates).toEqual(["horizontal_shmup", "vertical_shmup"]);
    expect(r.structured.archetype_candidates?.from).toEqual(["shooter"]);
    expect(r.text).toContain(
      `**Archetype:** not chosen. The brief's "shooter" fits horizontal_shmup, vertical_shmup; pass archetype to choose one.`,
    );
    expect(BriefingSchema.safeParse(r.structured).success).toBe(true);
  });

  it("keeps a named archetype over the brief's words", async () => {
    const r = await gameBriefing("Spy Hunter style road shooter", "racing");
    expect(r.structured.archetype?.name).toBe("racing");
    expect(r.structured.archetype?.inferred_from).toBeUndefined();
  });

  it("does not route a demo brief", async () => {
    const r = await demoBriefing("a road shooter intro");
    expect(r.structured.archetype).toBeUndefined();
    expect(r.text.split("\n")[0]).toBe("# C64 Demo Briefing");
  });
});

describe("briefing discovery helpers", () => {
  it("reads the technique name from an H3 chunk's section, not only an H2 one", () => {
    expect(
      extractTechniqueNameFromSection("Logic Techniques > vehicle_control — Top-down driving > How"),
    ).toBe("vehicle_control");
    expect(extractTechniqueNameFromSection("Raster Techniques > stable_raster_irq — Stable raster IRQ")).toBe(
      "stable_raster_irq",
    );
    expect(extractTechniqueNameFromSection("Logic Techniques > Overview > How")).toBeNull();
  });

  it("drops stop words and a lower-case homograph from the brief's tokens", () => {
    const tokens = briefTokens("cars ram through the road and RAM with style");
    expect(tokens).toContain("ram");
    expect(briefTokens("cars ram the road")).not.toContain("ram");
    for (const w of ["and", "the", "through", "with", "style"]) expect(tokens).not.toContain(w);
  });

  it("finds the other scroll axis in a name, a title or a required technique", () => {
    const brief = "vertically scrolling shooter";
    expect(contradictsBriefAxis({ name: "soft_scroll_h", title: "x" }, brief)).toBe(true);
    expect(contradictsBriefAxis({ name: "x", title: "Hardware horizontal soft-scroll" }, brief)).toBe(true);
    const parallax = {
      name: "charset_parallax",
      title: "x",
      requires: [{ name: "infinite_scroll_h", title: "y" }],
    };
    expect(contradictsBriefAxis(parallax, brief)).toBe(true);
    expect(
      contradictsBriefAxis({ name: "soft_scroll_v", title: "Hardware vertical soft-scroll" }, brief),
    ).toBe(false);
    // A brief naming both axes, or neither, rules nothing out.
    expect(
      contradictsBriefAxis({ name: "soft_scroll_h", title: "x" }, "eight-way: vertical and horizontal"),
    ).toBe(false);
    expect(contradictsBriefAxis({ name: "soft_scroll_h", title: "x" }, "a scroller")).toBe(false);
  });
});

describe("gameBriefing on the #22 section 4.1 shmup brief (#97)", () => {
  let f: FalkorService;

  // Issue #22 section 4.1, the game test's brief, without its closing
  // instructions to the agent.
  const BRIEF =
    "Vertically scrolling shoot-'em-up for a stock PAL C64 that also runs on NTSC. The playfield scrolls down one pixel a frame through a level map at least three screens tall, above a fixed five-row score panel. Up to 16 enemies and the player are sprites on screen at once. Enemies arrive in attack waves triggered by scroll position and follow entry paths. Player bullets are characters, up to eight. Collisions use a hitbox per animation frame. A three-voice tune plays throughout, and sound effects take over one voice. Enemy variation is random. A high-score table is saved to disk, and level 2's map is loaded from disk between levels.";

  const FEATURES = [
    "soft_scroll_v",
    "scroll_panel_split",
    "sprite_multiplex_game",
    "per_frame_hitbox",
    "wave_director",
    "sprite_collision_detect",
    "sfx_in_player",
    "sid_play_routine_pattern",
    "sid_voice_setup",
  ];

  // Name, title, category and complexity as the technique pages give them,
  // and a number of implementing recipes. The found techniques the live
  // graph ranks above text_mode_overlay_render are here too, as they fill
  // the plan's slots there.
  const TECHS: [string, string, string, string, number][] = [
    [
      "sfx_in_player",
      "Sound effects inside the music player: voice stealing, priority and hand-back",
      "music",
      "medium",
      2,
    ],
    ["sid_play_routine_pattern", "The init+play subroutine convention", "music", "low", 2],
    ["sid_voice_setup", "Frequency / waveform / ADSR per voice", "music", "low", 2],
    ["sfx_engine_beside_music", "Sound-effect engine beside a music player", "music", "medium", 2],
    ["object_pool", "Fixed-slot object pool for enemies, bullets and effects", "logic", "low", 6],
    [
      "high_score_table_insert",
      "A new score into a sorted table: rank, shift down, drop the last, write",
      "text",
      "low",
      1,
    ],
    ["tile_grid_collision", "Tile-grid collision against a decoded map", "logic", "medium", 4],
    ["tile_map_render", "Metatile map decode to screen and colour RAM", "scroll", "medium", 6],
    ["char_scroll_buffer_v", "Char-mode vertical scroll", "scroll", "medium", 2],
    ["pal_ntsc_detection", "Detect PAL vs NTSC at boot", "raster", "low", 7],
    ["frame_sync_loop", "Raster-synced frame loop", "raster", "low", 2],
    ["soft_scroll_v", "Hardware vertical soft-scroll", "scroll", "low", 2],
    ["scroll_panel_split", "Vertically scrolled playfield over a fixed score panel", "scroll", "medium", 1],
    [
      "sprite_multiplex_game",
      "Game multiplexer in assembly: persistent sort, double-buffered table, zone IRQs, late guard",
      "sprite",
      "high",
      1,
    ],
    [
      "per_frame_hitbox",
      "Collision boxes per animation frame, emitted at draw time, tested by group",
      "sprite",
      "medium",
      2,
    ],
    [
      "wave_director",
      "Attack waves triggered by scroll position, with path bytecode per enemy",
      "logic",
      "medium",
      1,
    ],
    ["sprite_collision_detect", "Sprite-sprite and sprite-background collision", "sprite", "low", 1],
    ["sprite_multiplex_8", "8-sprite multiplexer", "sprite", "medium", 3],
    ["text_mode_overlay_render", "Playfield + moving-piece overlay in text mode", "render", "low", 2],
    [
      "mixed_sprite_char_actors",
      "Large actors drawn partly in hardware sprites and partly in reserved character cells",
      "sprite",
      "medium",
      1,
    ],
    [
      "software_sprite_preshifted",
      "Pre-shifted masked software sprites in a character back buffer",
      "sprite",
      "medium",
      1,
    ],
    [
      "multi_sprite_object",
      "Bosses and large objects from several hardware sprites at fixed offsets from one origin",
      "sprite",
      "medium",
      2,
    ],
    [
      "sprite_animation_table",
      "Sprite animation from tables: frames, durations, end actions and events",
      "sprite",
      "low",
      1,
    ],
    ["lfsr_random", "Linear-feedback shift register random numbers", "maths", "low", 2],
    ["kernal_load_to_address", "LOAD a raw asset to an address of your choosing", "io", "low", 1],
    ["kernal_file_write_seq", "Write a sequential file with OPEN/CHKOUT/CHROUT", "io", "low", 1],
    ["kernal_file_read_seq", "Read a sequential file with CHKIN/CHRIN/READST", "io", "low", 1],
    ["error_channel_check", "Read the drive's status line from channel 15", "io", "low", 1],
    [
      "hires_plot",
      "Set one pixel in a hires bitmap through a row table and a mask table",
      "bitmap",
      "low",
      2,
    ],
    ["screen_wipe", "Reveal or hide the screen a row, a column or a line at a time", "effect", "low", 1],
    ["colour_cycling", "Rotate a colour table through a fixed set of cells", "effect", "low", 1],
    [
      "vector_balls_sprites",
      "Eight sprite balls on a tilted ring, depth-sorted onto the VIC's fixed sprite priority",
      "effect",
      "medium",
      1,
    ],
    [
      "light_pen_read",
      "Read the light pen's latched beam position from LPX/LPY once per frame",
      "input",
      "low",
      1,
    ],
  ];

  beforeAll(async () => {
    f = new FalkorService();
    await f.connect();
    await f.clean();
    await f.ensureSchema();
    for (const [name, title, category, complexity, recipes] of TECHS) {
      await f.addTechnique({ name, title, category, complexity });
      for (let i = 0; i < recipes; i++) {
        const recipe = `oscar64-${name.replace(/_/g, "-")}-${i}`;
        await f.addRecipe({
          name: recipe,
          toolchain: "oscar64",
          output_format: "PRG",
          region: "both",
          source_doc: `recipes/oscar64/${recipe}.md`,
        });
        await f.linkRecipeImplements(recipe, name);
      }
    }
    await f.addArchetype({
      name: "vertical_shmup",
      title: "Vertical Shmup",
      kind: "game",
      source_doc: "a.md",
      brief_words: ["vertical shooter", "vertically scrolling"],
      starter: "shmup-vertical",
    });
    for (const t of FEATURES) await f.linkArchetypeFeatures("vertical_shmup", t);
    // Both multiplexers own the one raster compare, as their pages claim:
    // check-compatibility calls the pair a hard unit_contention (#97).
    for (const owner of ["sprite_multiplex_game", "sprite_multiplex_8"]) {
      await f.linkClaims({
        owner,
        ownerKind: "Technique",
        unit: "vic_raster_irq",
        mode: "owns",
        basis: "derived-listing",
      });
    }
  });

  afterAll(async () => f.close());

  it("proposes lfsr_random and kernal_load_to_address, and none of the parts that do not fit", async () => {
    const r = await gameBriefing(BRIEF);
    expect(r.structured.archetype?.name).toBe("vertical_shmup");
    const got = r.structured.proposed_techniques.map((t) => t.name);
    for (const t of [...FEATURES, "lfsr_random", "kernal_load_to_address", "sprite_animation_table"]) {
      expect(got).toContain(t);
    }
    for (const t of [
      "text_mode_overlay_render",
      "mixed_sprite_char_actors",
      "software_sprite_preshifted",
      "hires_plot",
      "screen_wipe",
      "light_pen_read",
    ]) {
      expect(got).not.toContain(t);
    }
    const why = (n: string) => r.structured.proposed_techniques.find((t) => t.name === n)?.why_proposed;
    expect(why("lfsr_random")).toBe("The brief asks for random numbers: a linear-feedback shift register");
    expect(why("kernal_load_to_address")).toBe(
      "The brief loads data from disk while it runs: LOAD a file to an address the program chooses",
    );
    expect(BriefingSchema.safeParse(r.structured).success).toBe(true);
  });

  it("drops sprite_multiplex_8, found by search, for its hard conflict with the forced sprite_multiplex_game (#97)", async () => {
    // The #22 run-2 brief got sprite_multiplex_8 from the live graph's vector
    // search; this seeded graph has no vectors, so the brief names it.
    const r = await gameBriefing("A vertical shooter whose sprite multiplexer handles 8 sprites");
    expect(r.structured.archetype?.name).toBe("vertical_shmup");
    const got = r.structured.proposed_techniques.map((t) => t.name);
    expect(got).toContain("sprite_multiplex_game");
    expect(got).not.toContain("sprite_multiplex_8");
    const game = r.structured.proposed_techniques.find((t) => t.name === "sprite_multiplex_game");
    expect(game?.conflicts_left_out?.map((c) => c.name)).toEqual(["sprite_multiplex_8"]);
    const hard = r.structured.compatibility.conflicts;
    expect(hard.some((c) => [c.a, c.b].includes("sprite_multiplex_8"))).toBe(false);
    expect(r.text).toContain("**sprite_multiplex_8**, a hard");
  });

  it("still forces text_mode_overlay_render for a text-mode playfield", async () => {
    const r = await gameBriefing("A falling block puzzle on a text-mode playfield");
    expect(r.structured.proposed_techniques.map((t) => t.name)).toContain("text_mode_overlay_render");
  });
});
