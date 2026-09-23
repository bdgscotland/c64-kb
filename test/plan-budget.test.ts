import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { planBudget, type BudgetMember, type PhaseBudget } from "../src/domain/budget.ts";
import { extractGraphEntities } from "../src/graph/extract.ts";
import { parseMemberSpec } from "../src/tools/query/plan-budget.ts";
import { PlanBudgetSchema } from "../src/schemas/tool-outputs.ts";

// The honest budget (#22 step 3, schema 27): each rule of planBudget on a
// small fixture, then the validation compositions of design 2.1 built from
// the shipped pages themselves, so a Cost line that changes shows up here.

const m = (name: string, cost?: BudgetMember["cost"], extra: Partial<BudgetMember> = {}): BudgetMember => ({
  name,
  phase: "play",
  found: true,
  ...(cost ? { cost } : {}),
  ...extra,
});
const play = (b: ReturnType<typeof planBudget>, region = "PAL"): PhaseBudget => {
  const p = b.phases.find((x) => x.phase === "play" && x.region === region);
  if (!p) throw new Error(`no play phase for ${region}`);
  return p;
};

describe("planBudget rules", () => {
  it("never counts a missing figure as zero: unknown, to_measure with a recipe, verdict undetermined", () => {
    const b = planBudget([
      m("a", { cycles_per_frame: 100, basis: "measured-vice" }),
      m("fixed_point_8_8", undefined, { recipes: ["oscar64-actor", "oscar64-fixed-point-8-8"] }),
      m(
        "frame_sync_loop",
        { bytes_code: 985, basis: "arithmetic" },
        { recipes: ["oscar64-frame-sync-loop"] },
      ),
    ]);
    const p = play(b);
    expect(p.unknown).toEqual(["fixed_point_8_8", "frame_sync_loop"]);
    expect(p.to_measure).toEqual([
      { technique: "fixed_point_8_8", recipe: "oscar64-fixed-point-8-8", why: "no **Cost:** line" },
      {
        technique: "frame_sync_loop",
        recipe: "oscar64-frame-sync-loop",
        why: "the Cost line has no cycles_per_frame (nor cycles_per_line with lines_active)",
      },
    ]);
    expect(p.low).toBe(100);
    expect(p.verdict).toBe("undetermined");
    expect(b.verdict).toBe("undetermined");
  });

  it("names no recipe when nothing implements the missing technique", () => {
    const p = play(planBudget([m("lonely")]));
    expect(p.to_measure).toEqual([{ technique: "lonely", recipe: null, why: "no **Cost:** line" }]);
  });

  it("never sums a figure above one frame: multi_frame, and not fits", () => {
    const b = planBudget([
      m("soft_scroll_h", {
        cycles_per_frame: 74041,
        basis: "measured-vice",
        measured_on: "oscar64-soft-scroll-h",
      }),
      m("sid_play_routine_pattern", { cycles_per_frame: 327, basis: "measured-vice" }),
    ]);
    const p = play(b);
    expect(p.excluded).toEqual([
      { name: "soft_scroll_h", reason: "multi_frame", cycles: 74041, measured_on: "oscar64-soft-scroll-h" },
    ]);
    expect(p.high).toBe(327);
    expect(p.verdict).toBe("undetermined");
  });

  it("judges the frame per region: 18,559 fits a PAL frame and is multi-frame on NTSC", () => {
    const b = planBudget([m("cave_scan_engine", { cycles_per_frame: 18559, basis: "measured-vice" })], {
      region: "both",
    });
    expect(play(b, "PAL").excluded).toEqual([]);
    expect(play(b, "PAL").verdict).toBe("fits");
    expect(play(b, "NTSC").excluded.map((e) => e.reason)).toEqual(["multi_frame"]);
    expect(b.verdict).toBe("undetermined");
  });

  it("reports a range: low sums typical figures, high sums worst", () => {
    const p = play(
      planBudget([
        m("wave_director", {
          cycles_per_frame: 3188,
          cycles_per_frame_typical: 1170,
          basis: "measured-vice",
        }),
        m("b", { cycles_per_frame: 100, basis: "measured-vice" }),
      ]),
    );
    expect([p.low, p.high]).toEqual([1270, 3288]);
  });

  it("drops a member another member's Cost includes", () => {
    const p = play(
      planBudget([
        m("wave_director", { cycles_per_frame: 3188, basis: "measured-vice", includes: ["object_pool"] }),
        m("object_pool", { cycles_per_frame: 380, basis: "measured-vice" }),
      ]),
    );
    expect(p.excluded).toEqual([{ name: "object_pool", reason: "included_by", by: "wave_director" }]);
    expect(p.high).toBe(3188);
  });

  it("an included member with no figure is not unknown", () => {
    const p = play(
      planBudget([
        m("soft_scroll_h", {
          cycles_per_frame: 500,
          basis: "measured-vice",
          includes: ["char_scroll_buffer_h"],
        }),
        m("char_scroll_buffer_h"),
      ]),
    );
    expect(p.unknown).toEqual([]);
    expect(p.verdict).toBe("fits");
  });

  it("charges a whole-line technique its band, and leaves its REQUIRES closure inside the band", () => {
    const members = [
      m(
        "fli_image",
        { cycles_per_line: 63, lines_active: 200, cycles_per_frame: 12600, basis: "estimated" },
        { raster_band: "45-251", requires_closure: ["stable_raster_irq", "double_irq", "multicolor_bitmap"] },
      ),
      m("stable_raster_irq", { cycles_per_frame: 124, basis: "arithmetic" }),
      m("double_irq", { cycles_per_frame: 160, basis: "arithmetic" }),
    ];
    const b = planBudget(members, { region: "both" });
    const pal = play(b, "PAL");
    expect(pal.contributors).toEqual([
      expect.objectContaining({ name: "fli_image", low: 13041, high: 13041, charge: "band" }),
    ]);
    expect(pal.excluded.map((e) => [e.name, e.reason, e.by])).toEqual([
      ["stable_raster_irq", "inside_band_of", "fli_image"],
      ["double_irq", "inside_band_of", "fli_image"],
    ]);
    // The band's lines already hold their badlines: no fixed loss.
    expect(pal.fixed_losses.badlines).toBe(0);
    expect(pal.verdict).toBe("fits");
    expect(play(b, "NTSC").high).toBe(207 * 65);
  });

  it("charges cycles_per_line × lines_active when there is no frame figure, using the machine's line for 63", () => {
    const b = planBudget(
      [m("fld_flexible_line_distance", { cycles_per_line: 63, lines_active: 40, basis: "arithmetic" })],
      { region: "both" },
    );
    expect(play(b, "PAL").contributors[0]).toMatchObject({ high: 2520, charge: "per_line" });
    expect(play(b, "NTSC").contributors[0]).toMatchObject({ high: 2600 });
  });

  it("charges badlines with the screen on only for figures not measured wall-clock with it on", () => {
    const blanked = play(
      planBudget([
        m("a", { cycles_per_frame: 3188, basis: "measured-vice", conditions: "worst frame, screen blanked" }),
      ]),
    );
    expect(blanked.fixed_losses).toEqual({ badlines: 1075, sprite_dma: 0, charged_for: ["a"] });
    const vblank = play(
      planBudget([
        m("a", { cycles_per_frame: 455, basis: "measured-vice", conditions: "in the vertical blank" }),
      ]),
    );
    expect(vblank.fixed_losses.badlines).toBe(1075);
    const arith = play(planBudget([m("a", { cycles_per_frame: 124, basis: "arithmetic" })]));
    expect(arith.fixed_losses.badlines).toBe(1075);
    const on = play(
      planBudget([
        m("a", { cycles_per_frame: 415, basis: "measured-vice", conditions: "spawn frame, screen on" }),
      ]),
    );
    expect(on.fixed_losses).toEqual({ badlines: 0, sprite_dma: 0, charged_for: [] });
    const silent = play(
      planBudget([m("a", { cycles_per_frame: 20, basis: "measured-vice", conditions: "one call" })]),
    );
    expect(silent.fixed_losses.badlines).toBe(1075);
    const off = play(planBudget([m("a", { cycles_per_frame: 124, basis: "arithmetic" })], { screen: "off" }));
    expect(off.fixed_losses.badlines).toBe(0);
  });

  it("charges stated sprite DMA with the badlines: (3 + 2n) × lines", () => {
    const b = planBudget([m("a", { cycles_per_frame: 100, basis: "arithmetic" })], {
      sprites_per_line: 8,
      sprite_lines: 21,
    });
    expect(b.sprites).toEqual({ per_line: 8, lines: 21, dma_per_frame: 19 * 21 });
    expect(play(b).fixed_losses.sprite_dma).toBe(399);
    expect(planBudget([], { sprites_per_line: 2 }).sprites?.lines).toBe(200);
  });

  it("says over when even the low end and fixed losses pass the frame, fits when the high end fits", () => {
    const over = play(
      planBudget([
        m("a", { cycles_per_frame: 12000, cycles_per_frame_typical: 11000, basis: "measured-vice" }),
        m("b", { cycles_per_frame: 9500, cycles_per_frame_typical: 9000, basis: "measured-vice" }),
        m("c"),
      ]),
    );
    expect(over.verdict).toBe("over");
    // A low end made of worst frames alone is not a floor: undetermined, with the reason.
    const worst = play(
      planBudget([
        m("a", { cycles_per_frame: 12000, cycles_per_frame_typical: 11000, basis: "measured-vice" }),
        m("b", { cycles_per_frame: 9000, basis: "measured-vice" }),
      ]),
    );
    expect(worst.worst_only).toEqual(["b"]);
    expect(worst.verdict).toBe("undetermined");
    expect(worst.notes.some((n) => n.includes("holds worst frames with no measured typical frame (b)"))).toBe(
      true,
    );
    const between = play(
      planBudget([
        m("a", { cycles_per_frame: 12000, cycles_per_frame_typical: 5000, basis: "measured-vice" }),
        m("b", { cycles_per_frame: 9000, basis: "measured-vice" }),
      ]),
    );
    expect(between.verdict).toBe("undetermined");
    const fits = play(planBudget([m("a", { cycles_per_frame: 18500, basis: "arithmetic" })]));
    // 18,500 + 1,075 badlines = 19,575 of 19,656.
    expect(fits.verdict).toBe("fits");
    const tight = play(planBudget([m("a", { cycles_per_frame: 18600, basis: "arithmetic" })]));
    expect(tight.verdict).toBe("undetermined");
    const band = play(
      planBudget([
        m("fli", { cycles_per_line: 63, lines_active: 207, basis: "estimated" }, { raster_band: "45-251" }),
        m("b", { cycles_per_frame: 7000, cycles_per_frame_typical: 6000, basis: "measured-vice" }),
      ]),
    );
    // 13,041 + 6,000 + 1,075 badlines for b's figure > 19,656: a floor, so over.
    expect(band.verdict).toBe("over");
  });

  it("budgets phases alone and gives the overall verdict of the worst phase", () => {
    const b = planBudget([
      m("a", { cycles_per_frame: 5000, basis: "measured-vice" }),
      { ...m("level_decode", { cycles_per_frame: 21575, basis: "measured-vice" }), phase: "transition" },
      { ...m("lfsr_random", { cycles_per_frame: 14, basis: "arithmetic" }), phase: "init" },
    ]);
    expect(b.phases.map((p) => [p.phase, p.verdict])).toEqual([
      ["play", "fits"],
      ["transition", "undetermined"],
      ["init", "fits"],
    ]);
    expect(b.verdict).toBe("undetermined");
  });

  it("names a technique the graph does not have and keeps the verdict open", () => {
    const p = play(planBudget([{ name: "no_such", phase: "play", found: false }]));
    expect(p.not_found).toEqual(["no_such"]);
    expect(p.verdict).toBe("undetermined");
  });

  it("names the weakest basis among the summed figures and sums irq slots", () => {
    const p = play(
      planBudget([
        m("a", { cycles_per_frame: 1, irq_slots: 1, basis: "measured-vice" }),
        m("b", { cycles_per_frame: 1, irq_slots: 2, basis: "estimated" }),
      ]),
    );
    expect(p.weakest_basis).toBe("estimated");
    expect(p.irq_slots).toBe(3);
  });

  it("picks NTSC only when every region-locked member is NTSC-locked", () => {
    expect(planBudget([m("a", undefined, { requires_region: "ntsc" })]).phases[0]?.region).toBe("NTSC");
    expect(
      planBudget([
        m("a", undefined, { requires_region: "ntsc" }),
        m("b", undefined, { requires_region: "pal" }),
      ]).phases[0]?.region,
    ).toBe("PAL");
  });

  it("does not sum byte figures flagged as the whole program", () => {
    const b = planBudget([
      m("lfsr_random", {
        cycles_per_frame: 14,
        bytes_code: 1947,
        basis: "arithmetic",
        conditions: "one 8-bit step, screen blanked; bytes are the whole PRG",
      }),
      m("sine_table_generation", { bytes_code: 221, bytes_data: 256, basis: "derived-listing" }),
      m("plain"),
    ]);
    expect(b.bytes).toEqual({
      sum: 477,
      contributors: [{ name: "sine_table_generation", bytes: 477, basis: "derived-listing" }],
      excluded: [{ name: "lfsr_random", bytes: 1947, reason: "whole_program" }],
      without_bytes: ["plain"],
    });
  });
});

describe("parseMemberSpec", () => {
  it("reads name and name:phase, and refuses anything else", () => {
    expect(parseMemberSpec("tile_map_render")).toEqual({ name: "tile_map_render", phase: "play" });
    expect(parseMemberSpec(" kernal_file_read_seq:Transition ")).toEqual({
      name: "kernal_file_read_seq",
      phase: "transition",
    });
    expect(parseMemberSpec("lfsr_random:init")).toEqual({ name: "lfsr_random", phase: "init" });
    expect(parseMemberSpec("x:later")).toEqual({
      error: 'phase "later" is not one of play, transition, init',
    });
    expect(parseMemberSpec("a:b:c")).toHaveProperty("error");
    expect(parseMemberSpec(":play")).toHaveProperty("error");
  });
});

// ---------------------------------------------------------------------------
// Validation (design 2.1): the compositions that exist as built recipes,
// with each member's Cost, band, REQUIRES closure and recipes read from the
// shipped pages. "measured" is what the recipe page measured, cited.

type Entity = ReturnType<typeof extractGraphEntities>[number];

function loadDocs(): Entity[] {
  const out: Entity[] = [];
  const root = path.resolve(__dirname, "../docs");
  for (const dir of ["techniques", "recipes/oscar64", "recipes/kickassembler", "recipes/cc65"]) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs).filter((n) => n.endsWith(".md"))) {
      out.push(...extractGraphEntities(fs.readFileSync(path.join(abs, f), "utf8"), `${dir}/${f}`));
    }
  }
  return out;
}

const ENTITIES = loadDocs();

function closureOf(name: string): string[] {
  const direct = new Map<string, string[]>();
  for (const e of ENTITIES) {
    if (e.type === "technique_requires")
      direct.set(e.technique, [...(direct.get(e.technique) ?? []), e.requires]);
  }
  const seen = new Set<string>();
  const stack = [...(direct.get(name) ?? [])];
  while (stack.length > 0) {
    const n = stack.pop();
    if (n === undefined || seen.has(n)) continue;
    seen.add(n);
    stack.push(...(direct.get(n) ?? []));
  }
  return [...seen];
}

function memberFromDocs(spec: string): BudgetMember {
  const parsed = parseMemberSpec(spec);
  if ("error" in parsed) throw new Error(parsed.error);
  const t = ENTITIES.find((e) => e.type === "technique" && e.name === parsed.name);
  if (t?.type !== "technique") return { ...parsed, found: false };
  const recipes = ENTITIES.flatMap((e) =>
    e.type === "implements" && e.technique === parsed.name ? [e.recipe] : [],
  );
  const region = ENTITIES.find((e) => e.type === "technique_requires_region" && e.technique === parsed.name);
  return {
    ...parsed,
    found: true,
    requires_region: region?.type === "technique_requires_region" ? region.region : undefined,
    raster_band: t.raster_band,
    requires_closure: closureOf(parsed.name),
    recipes: recipes.sort(),
    ...(t.cost && t.cost_basis
      ? {
          cost: {
            ...t.cost,
            basis: t.cost_basis,
            measured_on: t.cost_recipe,
            conditions: t.cost_conditions,
            includes: t.cost_includes,
          },
        }
      : {}),
  };
}

function recipeTechniques(recipe: string): string[] {
  return ENTITIES.flatMap((e) => (e.type === "implements" && e.recipe === recipe ? [e.technique] : []));
}

const plan = (specs: string[], opts: Parameters<typeof planBudget>[1] = {}) =>
  planBudget(specs.map(memberFromDocs), opts);

describe("planBudget on the shipped pages (design 2.1 validation)", () => {
  it("platformer-scaffold: undetermined, five unknowns named, known range well under the measured 8,693 peak", () => {
    // Measured (platformer-scaffold.md, "What was measured"): CYC 4,966, MAX 8,606-8,693 PAL; 10,287 NTSC.
    const specs = recipeTechniques("oscar64-platformer-scaffold").map((t) =>
      t === "lfsr_random"
        ? `${t}:init`
        : ["kernal_file_write_seq", "kernal_file_read_seq", "error_channel_check"].includes(t)
          ? `${t}:transition`
          : t,
    );
    expect(specs).toContain("sid_play_routine_pattern");
    const b = plan(specs, { region: "both" });
    const pal = play(b, "PAL");
    expect(pal.unknown.sort()).toEqual(
      [
        "fixed_point_8_8",
        "frame_sync_loop",
        "joystick_autorepeat",
        "joystick_edge_detect",
        "jump_arc_table",
      ].sort(),
    );
    expect(pal.to_measure.find((t) => t.technique === "frame_sync_loop")?.recipe).toBe(
      "oscar64-frame-sync-loop",
    );
    // tile_map_render 268 + tile_grid_collision 2,345 + object_pool 380 + decimal_print 1,361
    // + sid_play_routine_pattern 327 + sfx_engine_beside_music 50-258.
    expect([pal.low, pal.high]).toEqual([4731, 4939]);
    expect(pal.fixed_losses.badlines).toBe(1075);
    expect(pal.verdict).toBe("undetermined");
    expect(b.phases.find((p) => p.phase === "transition")?.unknown.length).toBe(3);
    expect(b.bytes.excluded.map((e) => e.name).sort()).toEqual(["frame_sync_loop", "lfsr_random"]);
  });

  it("simple-shmup: undetermined, soft_scroll_v unknown", () => {
    // Not measured whole (simple-shmup.md: main loop 123 runs against about 245 music IRQs, "not settled").
    const pal = play(plan(recipeTechniques("oscar64-simple-shmup")));
    expect(pal.unknown).toEqual(["soft_scroll_v"]);
    expect(pal.high).toBe(5301 + 327);
    expect(pal.verdict).toBe("undetermined");
  });

  it("cracktro-template: soft_scroll_h is multi-frame and holds the char buffer's work; undetermined", () => {
    // Measured: all non-split work in about 7,000 cycles of blank, screenshot stable (cracktro-template.md).
    const pal = play(plan(recipeTechniques("kickassembler-cracktro-template")));
    expect(pal.excluded.map((e) => [e.name, e.reason])).toEqual([
      ["char_scroll_buffer_h", "included_by"],
      ["soft_scroll_h", "multi_frame"],
    ]);
    expect(pal.high).toBe(990 + 327);
    expect(pal.unknown).toEqual([]);
    expect(pal.verdict).toBe("undetermined");
  });

  it("fli-image: the band rule gives 13,041, the arithmetic truth, and fits", () => {
    const b = plan(recipeTechniques("kickassembler-fli-image"));
    const pal = play(b);
    expect([pal.low, pal.high]).toEqual([13041, 13041]);
    expect(pal.excluded.map((e) => [e.name, e.reason])).toEqual([
      ["stable_raster_irq", "included_by"],
      ["double_irq", "included_by"],
    ]);
    expect(pal.verdict).toBe("fits");
  });

  it("scroll-panel-split: undetermined with the two scroll techniques named", () => {
    // Truth by arithmetic: carry frame 413 + 20 rows × 560 = 11,613 (scroll-panel-split.md).
    const pal = play(plan(recipeTechniques("kickassembler-scroll-panel-split")));
    expect(pal.high).toBe(413);
    expect(pal.unknown.sort()).toEqual(["char_scroll_buffer_v", "soft_scroll_v"]);
    expect(pal.fixed_losses.badlines).toBe(0);
    expect(pal.verdict).toBe("undetermined");
  });

  it("sprite-multiplex-game: fits PAL on its 16,600 arithmetic ceiling, undetermined NTSC; no measured typical frame yet", () => {
    // Measured in play: sort 611-953, build 3,815, IRQs 2,201-2,764 (sprite.md "Cycle budget").
    const pal = play(plan(recipeTechniques("kickassembler-sprite-multiplex-game")));
    expect([pal.low, pal.high]).toEqual([16600, 16600]);
    expect(pal.fixed_losses.badlines).toBe(1075);
    expect(pal.verdict).toBe("fits");
    // NTSC: 16,600 + 1,075 passes 17,095, but 16,600 is a built worst frame
    // with no measured typical beside it; the recipe runs on NTSC with 24 of 24 drawn.
    const ntsc = play(
      plan(recipeTechniques("kickassembler-sprite-multiplex-game"), { region: "NTSC" }),
      "NTSC",
    );
    expect(ntsc.worst_only).toEqual(["sprite_multiplex_game"]);
    expect(ntsc.verdict).toBe("undetermined");
  });

  it("wave-director: object_pool counted once; 1,170-3,188 plus the badline charge; fits", () => {
    // Measured: worst frame 3,188, screen blanked (wave-director.md); typical 1,170 (logic.md).
    const pal = play(plan(recipeTechniques("oscar64-wave-director")));
    expect(pal.excluded).toEqual([{ name: "object_pool", reason: "included_by", by: "wave_director" }]);
    expect([pal.low, pal.high]).toEqual([1170, 3188]);
    expect(pal.fixed_losses.badlines).toBe(1075);
    expect(pal.verdict).toBe("fits");
  });

  it("falling-blocks: undetermined, the render and the autorepeat named", () => {
    // Measured: the scripted game's dearest frame 6,276 PAL / 6,491 NTSC; the built worst subject 15,028 / 15,282.
    const b = plan(recipeTechniques("oscar64-falling-blocks"), { region: "both" });
    const pal = play(b, "PAL");
    expect(pal.unknown.sort()).toEqual(["joystick_autorepeat", "text_mode_overlay_render"]);
    expect(pal.high).toBe(5888 + 14);
    expect(pal.verdict).toBe("undetermined");
    expect(play(b, "NTSC").verdict).toBe("undetermined");
  });

  it("every composition's output parses with the tool's schema", () => {
    const b = plan(["fli_image", "stable_raster_irq", "double_irq", "soft_scroll_h", "nope:transition"], {
      region: "both",
      sprites_per_line: 8,
      sprite_lines: 21,
    });
    expect(() => PlanBudgetSchema.parse({ techniques: [], refused: [], ...b })).not.toThrow();
  });
});
