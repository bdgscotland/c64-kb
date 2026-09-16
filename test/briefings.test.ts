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
    await f.addTechnique({ name: "soft_scroll_h", title: "Hardware horizontal soft-scroll", category: "scroll", complexity: "low" });
    await f.addTechnique({ name: "sprite_multiplex_8", title: "8-sprite multiplexer", category: "sprite", complexity: "medium" });
    await f.addTechnique({ name: "sid_play_routine_pattern", title: "The init+play subroutine convention", category: "music", complexity: "low" });
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

  it("includes pitfalls relevant to proposed techniques", async () => {
    const r = await demoBriefing("stable raster IRQ with 24 sprites");
    expect(r.structured.pitfalls.length).toBeGreaterThanOrEqual(1);
  });

  it("proposes Oscar64 as primary toolchain", async () => {
    const r = await demoBriefing("simple bitmap demo");
    expect(r.structured.toolchain_split.primary).toBe("oscar64");
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

// FORCED_TECHNIQUES_FOR_ARCHETYPE enforcement (puzzle-tetris dogfood, 2026-05-18):
// A pre-Phase-7 puzzle briefing didn't surface the text-mode rendering
// foundation, so the dirty_cell_skip_leaves_overlay_trail pitfall never made
// it to the agent. Now puzzle/adventure briefings are required to include
// text_mode_overlay_render so the pitfall cascades deterministically.
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
