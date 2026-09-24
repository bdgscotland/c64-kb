import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  followIncludes,
  planBudget,
  rankRecipesFor,
  type BudgetMember,
  type PhaseBudget,
} from "../src/domain/budget.ts";
import { extractGraphEntities } from "../src/graph/extract.ts";
import { budgetRegion, parseMemberSpec, parseMemberSpecs } from "../src/tools/query/plan-budget.ts";
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

  it("names the recipe that realises the technique most directly, as the card lists first (#41)", () => {
    // It named oscar64-attract-replay, the alphabetical first; the card led with joystick-input.
    const p = play(
      planBudget([
        m("joystick_edge_detect", undefined, {
          recipes: ["oscar64-attract-replay", "oscar64-joystick-input"],
        }),
      ]),
    );
    expect(p.to_measure.at(0)?.recipe).toBe("oscar64-joystick-input");
    expect(
      rankRecipesFor("frame_sync_loop", ["oscar64-a", "oscar64-frame-sync-loop", "oscar64-frame-z"]),
    ).toEqual(["oscar64-frame-sync-loop", "oscar64-frame-z", "oscar64-a"]);
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

  it("treats a figure the same on both models: 18,559 is summed on PAL and NTSC, over the NTSC frame (#41)", () => {
    // An earlier version left it out of NTSC as multi-frame and summed it on PAL.
    const b = planBudget([m("cave_scan_engine", { cycles_per_frame: 18559, basis: "measured-vice" })], {
      region: "both",
    });
    expect(play(b, "PAL").excluded).toEqual([]);
    expect(play(b, "PAL").verdict).toBe("fits");
    const ntsc = play(b, "NTSC");
    expect(ntsc.excluded).toEqual([]);
    expect(ntsc.high).toBe(18559);
    expect(ntsc.verdict).toBe("undetermined");
    expect(ntsc.notes.some((n) => n.includes("The low end, 18559 + "))).toBe(true);
    expect(ntsc.notes.some((n) => /is over the 17095-cycle frame by \d+/.test(n))).toBe(true);
    expect(b.verdict).toBe("undetermined");
  });

  it("the low end past the frame is called over, with the sum (#41)", () => {
    // #39 read 'The low end, 36919 + 1873, passes the 19656-cycle frame' as fitting.
    const p = play(
      planBudget([
        m("a", { cycles_per_frame: 19000, cycles_per_frame_typical: 18000, basis: "measured-vice" }),
        m("b", { cycles_per_frame: 4000, cycles_per_frame_typical: 3000, basis: "measured-vice" }),
      ]),
    );
    const note = p.notes.find((n) => n.startsWith("The low end"));
    expect(note).toMatch(
      /^The low end, 21000 \+ \d+ = \d+, is over the 19656-cycle frame by \d+, but it is not a floor/,
    );
    expect(note).not.toMatch(/passes the/);
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
    expect(blanked.fixed_losses).toEqual({
      badlines: 1075,
      sprite_dma: 0,
      charged_for: ["a"],
      badlines_in_bands: 0,
      floor: 1075,
    });
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
    expect(on.fixed_losses).toEqual({
      badlines: 0,
      sprite_dma: 0,
      charged_for: [],
      badlines_in_bands: 0,
      floor: 0,
    });
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

  it("says over only when the floor passes the frame, fits when the high end fits", () => {
    // Two typical frames past the frame are not over: a typical figure may be
    // a real run's worst frame, and two members' such frames need not coincide.
    const typicals = play(
      planBudget([
        m("a", { cycles_per_frame: 12000, cycles_per_frame_typical: 11000, basis: "measured-vice" }),
        m("b", { cycles_per_frame: 9500, cycles_per_frame_typical: 9000, basis: "measured-vice" }),
        m("c"),
      ]),
    );
    expect(typicals.floor).toBe(1075);
    expect(typicals.verdict).toBe("undetermined");
    expect(typicals.notes.some((n) => n.includes("it is not a floor: the figures of a, b"))).toBe(true);
    const worst = play(
      planBudget([
        m("a", { cycles_per_frame: 12000, cycles_per_frame_typical: 11000, basis: "measured-vice" }),
        m("b", { cycles_per_frame: 9000, basis: "measured-vice" }),
      ]),
    );
    expect(worst.worst_only).toEqual(["b"]);
    expect(worst.verdict).toBe("undetermined");
    expect(
      worst.notes.some((n) => n.includes("b has no typical frame, so its low end is a worst frame")),
    ).toBe(true);
    const fits = play(planBudget([m("a", { cycles_per_frame: 18500, basis: "arithmetic" })]));
    // 18,500 + 1,075 badlines = 19,575 of 19,656.
    expect(fits.verdict).toBe("fits");
    const tight = play(planBudget([m("a", { cycles_per_frame: 18600, basis: "arithmetic" })]));
    expect(tight.verdict).toBe("undetermined");
    // Every-frame work past the frame is over, a worst-only member beside it
    // or not (review finding 2): band 13,041 + 110 whole lines 6,930.
    const band = play(
      planBudget([
        m("fli", { cycles_per_line: 63, lines_active: 207, basis: "estimated" }, { raster_band: "45-251" }),
        m("fld", { cycles_per_line: 63, lines_active: 110, basis: "arithmetic" }),
        m("b", { cycles_per_frame: 500, basis: "measured-vice" }),
      ]),
    );
    expect(band.floor).toBe(13041 + 6930);
    expect(band.verdict).toBe("over");
    expect(band.notes.some((n) => n.includes("not a floor"))).toBe(false);
    // The exact badline loss is part of the floor when no figure can hold it:
    // a per-line charge that is not whole lines holds no stall.
    const perLine = play(
      planBudget([
        m("x", { cycles_per_line: 30, lines_active: 600, basis: "arithmetic" }),
        m("b", { cycles_per_frame: 1000, basis: "measured-vice" }),
      ]),
    );
    // 18,000 + 25 × 43 = 19,075: fits the frame, so the worst-only b tips it.
    expect(perLine.floor).toBe(18000 + 1075);
    expect(perLine.verdict).toBe("undetermined");
    const perLineOver = play(
      planBudget([m("x", { cycles_per_line: 30, lines_active: 620, basis: "arithmetic" }), m("b")]),
    );
    // 18,600 + 1,075 = 19,675 > 19,656, with b unknown: still over.
    expect(perLineOver.verdict).toBe("over");
  });

  it("charges only the badlines outside a band, and counts none in the floor that a screen-on figure may hold", () => {
    const band = play(
      planBudget([
        m("fli", { cycles_per_line: 63, lines_active: 207, basis: "arithmetic" }, { raster_band: "45-251" }),
        m("b", { cycles_per_frame: 1000, basis: "measured-vice", conditions: "screen blanked" }),
      ]),
    );
    expect(band.fixed_losses).toMatchObject({
      badlines: 0,
      badlines_in_bands: 25,
      floor: 0,
      charged_for: ["b"],
    });
    expect(band.notes[0]).toContain("all 25 badlines fall inside fli's band");
    const part = play(
      planBudget([
        m("top", { cycles_per_line: 63, lines_active: 50, basis: "arithmetic" }, { raster_band: "40-89" }),
        m("b", { cycles_per_frame: 1000, basis: "measured-vice" }),
      ]),
    );
    // Lines 51, 59, 67, 75, 83 are inside 40-89: 20 badlines left.
    expect(part.fixed_losses).toMatchObject({ badlines: 20 * 43, badlines_in_bands: 5, floor: 20 * 43 });
    expect(part.notes[0]).toContain("the charge is exact");
    const mixed = play(
      planBudget([
        m("a", { cycles_per_frame: 400, basis: "measured-vice", conditions: "screen on" }),
        m("b", { cycles_per_frame: 1000, basis: "arithmetic" }),
      ]),
    );
    expect(mixed.fixed_losses).toMatchObject({ badlines: 1075, floor: 0 });
    expect(mixed.notes[0]).toContain("a was measured with the screen on");
    expect(mixed.notes[0]).not.toContain("border");
    const onlyBand = play(
      planBudget([
        m("fli", { cycles_per_line: 63, lines_active: 207, basis: "arithmetic" }, { raster_band: "45-251" }),
      ]),
    );
    expect(onlyBand.notes[0]).toBe(
      "No fixed losses charged: every summed figure is a band charge, whole raster lines with their stalls included.",
    );
    const sprites = play(
      planBudget([m("b", { cycles_per_frame: 100, basis: "arithmetic" })], { sprites_per_line: 8 }),
    );
    // Unstated sprite lines: 200 lines charged as a ceiling, none in the floor.
    expect(sprites.fixed_losses).toMatchObject({ sprite_dma: 19 * 200, floor: 1075 });
    const stated = play(
      planBudget([m("b", { cycles_per_frame: 100, basis: "arithmetic" })], {
        sprites_per_line: 8,
        sprite_lines: 21,
      }),
    );
    expect(stated.fixed_losses.floor).toBe(1075 + 19 * 21);
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
      inside: [],
      without_bytes: ["plain"],
    });
  });

  it("lets a member left out as multi-frame hold nothing: what it includes is budgeted as itself", () => {
    const p = play(
      planBudget([
        m("big", { cycles_per_frame: 74041, basis: "measured-vice", includes: ["small"] }),
        m("small", undefined, { recipes: ["oscar64-small"] }),
      ]),
    );
    expect(p.excluded).toEqual([{ name: "big", reason: "multi_frame", cycles: 74041, measured_on: null }]);
    expect(p.unknown).toEqual(["small"]);
    expect(p.to_measure[0]?.recipe).toBe("oscar64-small");
  });

  it("follows includes through techniques outside the set, and keeps the first of two that include each other", () => {
    const pages: Record<string, string[]> = { a: ["b"], b: ["c"], c: ["a"] };
    expect(followIncludes("a", (n) => pages[n] ?? [])).toEqual(["b", "c"]);
    // a includes b, b (not in the set) includes c: a holds c.
    const through = play(
      planBudget([
        m("a", { cycles_per_frame: 900, basis: "measured-vice", includes: ["b", "c"] }),
        m("c", { cycles_per_frame: 300, basis: "measured-vice" }),
      ]),
    );
    expect(through.excluded).toEqual([{ name: "c", reason: "included_by", by: "a" }]);
    const mutual = play(
      planBudget([
        m("x", { cycles_per_frame: 900, basis: "measured-vice", includes: ["y"] }),
        m("y", { cycles_per_frame: 300, basis: "measured-vice", includes: ["x"] }),
      ]),
    );
    expect(mutual.contributors.map((c) => c.name)).toEqual(["x"]);
    expect(mutual.excluded).toEqual([{ name: "y", reason: "included_by", by: "x" }]);
  });

  it("does not let a member inside another's figure make the byte sum a floor", () => {
    const b = planBudget([
      m(
        "fli_image",
        { cycles_per_line: 63, lines_active: 207, bytes_code: 3488, bytes_data: 16001, basis: "arithmetic" },
        { raster_band: "45-251", requires_closure: ["stable_raster_irq"] },
      ),
      m("stable_raster_irq", { cycles_per_frame: 124, basis: "arithmetic" }),
      m("wave_director", { cycles_per_frame: 3188, basis: "measured-vice", includes: ["object_pool"] }),
      m("object_pool", { cycles_per_frame: 380, bytes_code: 500, basis: "measured-vice" }),
    ]);
    expect(b.bytes.inside).toEqual([{ name: "stable_raster_irq", by: "fli_image" }]);
    // wave_director states no bytes, so object_pool's are summed and wave_director makes it a floor.
    expect(b.bytes.sum).toBe(3488 + 16001 + 500);
    expect(b.bytes.without_bytes).toEqual(["wave_director"]);
  });

  it("says when PAL-locked and NTSC-locked members are mixed, and writes 'an init'", () => {
    const b = planBudget([
      m("a", { cycles_per_frame: 10, basis: "arithmetic" }, { requires_region: "pal" }),
      m("b", { cycles_per_frame: 10, basis: "arithmetic" }, { requires_region: "ntsc" }),
      { ...m("c", { cycles_per_frame: 10, basis: "arithmetic" }), phase: "init" },
    ]);
    expect(
      b.assumptions.some((a) => a.startsWith("Mixed regions: a is PAL-locked and b is NTSC-locked")),
    ).toBe(true);
    expect(
      b.phases.find((p) => p.phase === "init")?.notes.some((n) => n.includes("an init that takes")),
    ).toBe(true);
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

  it("counts a name listed twice in one phase once, and says so", () => {
    expect(parseMemberSpecs(["object_pool", "a:b:c", "object_pool:play", "object_pool:init"])).toEqual({
      specs: [
        { name: "object_pool", phase: "play" },
        { name: "object_pool", phase: "init" },
      ],
      refused: [
        { input: "a:b:c", why: '"a:b:c" is not "name" or "name:phase"' },
        { input: "object_pool:play", why: "object_pool is already listed in play; counted once" },
      ],
    });
  });

  it("refuses a region that is not pal, ntsc or both", () => {
    expect(budgetRegion(" Ntsc ")).toBe("NTSC");
    expect(budgetRegion("BOTH")).toBe("both");
    expect(budgetRegion(undefined)).toBeUndefined();
    expect(() => budgetRegion("secam")).toThrow('region "secam" is not pal, ntsc or both');
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

function includesOnPages(name: string): string[] {
  const t = ENTITIES.find((e) => e.type === "technique" && e.name === name);
  return t?.type === "technique" ? (t.cost_includes ?? []) : [];
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
            includes: followIncludes(parsed.name, includesOnPages),
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

  it("cracktro-template: soft_scroll_h is multi-frame, so the char buffer it includes is unknown; undetermined", () => {
    // Measured: all non-split work in about 7,000 cycles of blank, screenshot stable (cracktro-template.md).
    // soft_scroll_h's 74,041 is left out of this frame, so it holds nothing
    // here: char_scroll_buffer_h is a member with no figure (review finding 4).
    const pal = play(plan(recipeTechniques("kickassembler-cracktro-template")));
    expect(pal.excluded.map((e) => [e.name, e.reason])).toEqual([["soft_scroll_h", "multi_frame"]]);
    expect(pal.high).toBe(990 + 327);
    expect(pal.unknown).toEqual(["char_scroll_buffer_h"]);
    expect(pal.to_measure.find((t) => t.technique === "char_scroll_buffer_h")?.recipe).not.toBeNull();
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
    // The frontmatter names seven since #22 step 4, every one in play here.
    expect(pal.unknown.sort()).toEqual([
      "frame_sync_loop",
      "joystick_autorepeat",
      "joystick_edge_detect",
      "pal_ntsc_detection",
      "text_mode_overlay_render",
    ]);
    expect(pal.high).toBe(5888 + 14);
    expect(pal.verdict).toBe("undetermined");
    expect(play(b, "NTSC").verdict).toBe("undetermined");
  });

  it("fli_image beside screen-blanked figures is not over: its band holds every badline (review finding 1)", () => {
    // 13,041 + 4,171 + 1,170 + 357 = 18,739 is under 19,656; the old charge of
    // 1,075 for badlines already inside fli_image's band 45-251 made it 19,814, over.
    const pal = play(plan(["fli_image", "ghost_target_tile_ai", "wave_director", "sprite_animation_table"]));
    expect(pal.fixed_losses).toMatchObject({ badlines: 0, badlines_in_bands: 25, floor: 0 });
    expect([pal.low, pal.high, pal.floor]).toEqual([18739, 24203, 13041]);
    expect(pal.verdict).toBe("undetermined");
  });

  it("fli_image, ghost targeting, game-tree search and a decimal print: undetermined, not over (review findings 2 and 3)", () => {
    // Low 13,041 + 4,171 + 5,325 + 1,361 = 23,898 passes the frame, but 4,171
    // is a run's worst frame (WST) and 5,325 the worst measured slice: no
    // floor. The floor is fli_image's band alone, 13,041.
    const pal = play(plan(["fli_image", "ghost_target_tile_ai", "game_tree_search", "decimal_print"]));
    expect(pal.low).toBe(23898);
    expect(pal.floor).toBe(13041);
    expect(pal.worst_only).toEqual(["decimal_print"]);
    expect(pal.verdict).toBe("undetermined");
    expect(
      pal.notes.some((n) =>
        n.includes("it is not a floor: the figures of ghost_target_tile_ai, game_tree_search, decimal_print"),
      ),
    ).toBe(true);
  });

  it("every composition's output parses with the tool's schema", () => {
    const b = plan(["fli_image", "stable_raster_irq", "double_irq", "soft_scroll_h", "nope:transition"], {
      region: "both",
      sprites_per_line: 8,
      sprite_lines: 21,
    });
    expect(() => PlanBudgetSchema.parse({ design: null, techniques: [], refused: [], ...b })).not.toThrow();
  });
});
