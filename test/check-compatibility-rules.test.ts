import { describe, it, expect } from "vitest";
import {
  evaluateCompatibility,
  type CompatibilityFacts,
  type TechniqueFacts,
} from "../src/tools/query/compatibility/index.ts";
import { renderCompatibility } from "../src/tools/query/compatibility/render.ts";
import { readPlacements, splitPlacement } from "../src/tools/query/compatibility/placement.ts";
import type { Claim } from "../src/graph/claims.ts";

// The pure rules for the #29 and #41 cases; no graph needed.
const tech = (demands: string[], claims: Claim[] = []): TechniqueFacts => ({
  found: true,
  demands: new Set(demands),
  registers: 0,
  kernal: [],
  band: null,
  region: null,
  category: null,
  rasterRegisters: 0,
  claims,
  claimsStated: claims.length > 0 ? "stated" : "unknown",
});
const irq = (mode: Claim["mode"]): Claim => ({ unit: "vic_raster_irq", mode });

const FACTS: Record<string, TechniqueFacts> = {
  // As on the pages: the every-line effects own the raster compare, the
  // entry methods share it, the multiplexer owns it and changes sprites.
  fli_image: tech(["cpu_every_line", "constant_sprite_set"], [irq("owns")]),
  sideborder_open: tech(["cpu_every_line", "constant_sprite_set"], [irq("owns")]),
  stable_raster_irq: tech(["midframe_raster_irqs"], [irq("shares")]),
  double_irq: tech(["midframe_raster_irqs"], [irq("shares")]),
  sprite_multiplex_24: tech(
    ["midframe_raster_irqs", "changes_sprite_set"],
    [irq("owns"), { unit: "sprite_0", mode: "owns" }],
  ),
  raster_bars: tech(["midframe_raster_irqs"], [irq("owns")]),
  raster_split_modes: tech(["midframe_raster_irqs"], [irq("owns")]),
  irq_chain_table: tech(["midframe_raster_irqs"], [irq("owns")]),
  every_line_no_claims: tech(["cpu_every_line"]),
  dysp_side_border_sprites: tech(["cpu_every_line", "midframe_raster_irqs"], [irq("owns")]),
};
const REQUIRES: Record<string, string[]> = {
  fli_image: ["stable_raster_irq"],
  sideborder_open: ["double_irq"],
  dysp_side_border_sprites: ["sideborder_open", "stable_raster_irq"],
};

const check = (techniques: string[]) => {
  const facts: CompatibilityFacts = {
    techniques,
    requires: new Map(Object.entries(REQUIRES)),
    facts: new Map(Object.entries(FACTS)),
    sharedRegisters: new Map(),
    sharedKernal: new Map(),
    recipeUses: [],
  };
  return evaluateCompatibility(facts);
};
const hard = (r: ReturnType<typeof check>) =>
  r.conflicts.filter((c) => c.severity === "hard").map((c) => `${c.underlying_kind ?? c.kind} ${c.a}×${c.b}`);

describe("cpu_vs_irq and the effect's own entry method (#29)", () => {
  it.each([
    ["fli_image", "stable_raster_irq"],
    ["fli_image", "double_irq"],
    ["sideborder_open", "stable_raster_irq"],
    ["sideborder_open", "double_irq"],
  ])("%s × %s: no hard conflict", (a, b) => {
    const r = check([a, b]);
    expect(hard(r)).toEqual([]);
    expect(r.verdict).not.toBe("incompatible");
  });

  it("an every-line technique and the every-line technique it requires: neither line rule fires", () => {
    expect(hard(check(["dysp_side_border_sprites", "sideborder_open"]))).toEqual([]);
  });

  it("still fires against a multiplexer that takes interrupts inside the band", () => {
    const r = check(["fli_image", "sprite_multiplex_24"]);
    expect(hard(r)).toContain("cpu_vs_irq fli_image×sprite_multiplex_24");
    expect(r.verdict).toBe("incompatible");
  });

  it("still fires against another owner of the compare (raster bars inside the FLI lines)", () => {
    expect(hard(check(["fli_image", "raster_bars"]))).toContain("cpu_vs_irq fli_image×raster_bars");
  });

  it("still fires when the every-line side states no claims", () => {
    expect(hard(check(["every_line_no_claims", "stable_raster_irq"]))).toEqual([
      "cpu_vs_irq every_line_no_claims×stable_raster_irq",
    ]);
  });
});

describe("the irq_chain_table suggestion (#41)", () => {
  it("adding the host the resolution names does not make the verdict worse", () => {
    const pair = check(["raster_bars", "raster_split_modes"]);
    expect(hard(pair)).toEqual(["unit_contention raster_bars×raster_split_modes"]);
    expect(pair.conflicts.at(0)?.resolution).toMatch(/irq_chain_table/);
    const hosted = check(["raster_bars", "raster_split_modes", "irq_chain_table"]);
    expect(hard(hosted)).toEqual([]);
    expect(hosted.verdict).toBe("warnings");
    const guests = hosted.conflicts.find((c) => c.a === "raster_bars" && c.b === "raster_split_modes");
    expect(guests?.resolution).toMatch(/irq_chain_table is in the set: rewrite both raster handlers/);
  });

  it("the host softens the raster-compare contention only, not the demand rules", () => {
    const r = check(["sprite_multiplex_24", "irq_chain_table", "every_line_no_claims"]);
    expect(r.conflicts.find((c) => c.kind === "unit_contention")?.severity).toBe("soft");
    expect(hard(r)).toContain("cpu_vs_irq sprite_multiplex_24×every_line_no_claims");
  });
});

describe("unknown technique names (#41)", () => {
  it("refuses, lists the names and hints at names joined into one argument", () => {
    const r = check(["fli_image double_irq", "raster_bars", "nope"]);
    expect(r.verdict).toBe("unknown_technique");
    expect(r.not_found).toEqual(["fli_image double_irq", "nope"]);
    const text = renderCompatibility(
      { techniques: ["fli_image double_irq", "raster_bars", "nope"], ...r },
      r.closureOnly,
    );
    expect(text).toMatch(/refused, no verdict\. No such technique: fli_image double_irq, nope\./);
    expect(text).toMatch(/Several names in one argument\?/);
    expect(text).not.toMatch(/COMPATIBLE/);
  });
});

// #90: two composed recipes run raster-compare owners in one chain on
// disjoint lines, place movable bands, and give sideborder_open its constant
// sprite set from another technique's sprites.
describe("chained owners, placed bands and a constant set's supplier (#90)", () => {
  const sprites = (mode: Claim["mode"]): Claim[] =>
    [0, 1, 2, 3, 4, 5, 6, 7].map((n) => ({ unit: `sprite_${n}`, mode }));
  const banded = (F: TechniqueFacts, band: string | null): TechniqueFacts => ({ ...F, band });
  const F90: Record<string, TechniqueFacts> = {
    // As on the pages after #90.
    sideborder_open: banded(tech(["cpu_every_line", "constant_sprite_set"], [irq("owns")]), "movable"),
    fli_image: banded(tech(["cpu_every_line", "constant_sprite_set"], [irq("owns")]), "45-251"),
    raster_bars: tech(["midframe_raster_irqs"], [irq("owns")]),
    topbottom_border_open: tech(["midframe_raster_irqs"], [irq("shares")]),
    sprite_border_scroller: banded(
      tech(["midframe_raster_irqs"], [...sprites("owns"), irq("owns")]),
      "movable",
    ),
    sprite_multiplex_24: tech(
      ["midframe_raster_irqs", "changes_sprite_set"],
      [irq("owns"), ...sprites("owns")],
    ),
    lines_20_40: banded(tech(["midframe_raster_irqs"], [irq("owns")]), "20-40"),
    lines_60_80: banded(tech(["midframe_raster_irqs"], [irq("owns")]), "60-80"),
    lines_30_70: banded(tech(["midframe_raster_irqs"], [irq("owns")]), "30-70"),
  };
  const run = (techniques: string[], placements: Record<string, string> = {}) =>
    evaluateCompatibility({
      techniques,
      requires: new Map(),
      facts: new Map(Object.entries(F90)),
      sharedRegisters: new Map(),
      sharedKernal: new Map(),
      recipeUses: [],
      placements: new Map(Object.entries(placements)),
    });
  const kinds = (r: ReturnType<typeof run>) =>
    r.conflicts.map(
      (c) => `${c.severity} ${c.underlying_kind ?? c.kind} ${c.a}×${c.b} ${c.shared.join(",")}`,
    );

  it("two owners of the compare on disjoint stated bands are one chain: soft", () => {
    const r = run(["lines_20_40", "lines_60_80"]);
    expect(kinds(r)).toEqual(["soft unit_contention lines_20_40×lines_60_80 vic_raster_irq"]);
    expect(r.conflicts[0]?.resolution).toMatch(/Their lines do not meet .* chain the handlers/);
  });

  it("on overlapping bands, or with a band unknown, the contention stays hard", () => {
    expect(kinds(run(["lines_20_40", "lines_30_70"]))).toEqual([
      "hard unit_contention lines_20_40×lines_30_70 vic_raster_irq",
    ]);
    expect(kinds(run(["raster_bars", "lines_20_40"]))).toEqual([
      "hard unit_contention raster_bars×lines_20_40 vic_raster_irq",
    ]);
  });

  it("a movable band placed clear of the other's lines clears the line rules and the contention", () => {
    const bare = run(["sideborder_open", "raster_bars"]);
    expect(kinds(bare)).toEqual([
      "hard unit_contention sideborder_open×raster_bars vic_raster_irq",
      "hard cpu_vs_irq sideborder_open×raster_bars cpu_every_line,midframe_raster_irqs",
    ]);
    expect(bare.conflicts[1]?.rationale).toMatch(/movable; place it with "sideborder_open@lines"/);
    const placed = run(["sideborder_open", "raster_bars"], {
      sideborder_open: "248-272",
      raster_bars: "17-50",
    });
    expect(kinds(placed)).toEqual(["soft unit_contention sideborder_open×raster_bars vic_raster_irq"]);
    expect(placed.band_separated).toEqual([
      { a: "sideborder_open", b: "raster_bars", a_band: "248-272", b_band: "17-50", rules: ["cpu_vs_irq"] },
    ]);
    expect(placed.data_coverage.find((d) => d.technique === "sideborder_open")).toMatchObject({
      raster_band: "movable",
      placed_band: "248-272",
    });
  });

  it("placed bands that overlap keep every rule hard", () => {
    const r = run(["sideborder_open", "raster_bars"], { sideborder_open: "248-272", raster_bars: "260-270" });
    expect(r.verdict).toBe("incompatible");
    expect(r.conflicts[1]?.rationale).toMatch(
      /sideborder_open is placed on lines 248-272.*The bands overlap/,
    );
  });

  it("refuses a placement on a band the page states, and one outside the grammar", () => {
    const r = run(["fli_image", "sprite_border_scroller"], {
      fli_image: "0-10",
      sprite_border_scroller: "273-400",
    });
    expect(r.placements_refused?.map((p) => p.input)).toEqual([
      "fli_image@0-10",
      "sprite_border_scroller@273-400",
    ]);
    expect(r.placements_refused?.[0]?.why).toMatch(/its page states lines 45-251/);
    expect(r.placements_refused?.[1]?.why).toMatch(/past the last raster line/);
    // Refused placements leave the page bands, so the rules stay as unplaced.
    expect(r.verdict).toBe("incompatible");
  });

  it("the FLI and the sprite scroller, placed as fli-music-scroller runs them: no hard conflict", () => {
    const r = run(["fli_image", "topbottom_border_open", "sprite_border_scroller"], {
      sprite_border_scroller: "273-299",
    });
    expect(kinds(r).filter((k) => k.startsWith("hard"))).toEqual([]);
    expect(kinds(r)).toContain("soft unit_shared fli_image×topbottom_border_open vic_raster_irq");
    expect(kinds(r)).toContain(
      "soft sprite_set fli_image×sprite_border_scroller constant_sprite_set,sprite_0-7",
    );
  });

  it("topbottom_border_open shares the compare, so it runs inside an every-line owner's handler", () => {
    const r = run(["fli_image", "topbottom_border_open"]);
    expect(kinds(r)).toEqual(["soft unit_shared fli_image×topbottom_border_open vic_raster_irq"]);
  });

  it("sprites that do not change mid-frame can be the constant set: soft, not a unit contention", () => {
    const r = run(["sideborder_open", "sprite_border_scroller"], {
      sideborder_open: "248-272",
      sprite_border_scroller: "273-311,0-1",
    });
    expect(kinds(r)).toEqual([
      "soft unit_contention sideborder_open×sprite_border_scroller vic_raster_irq",
      "soft sprite_set sideborder_open×sprite_border_scroller constant_sprite_set,sprite_0-7",
    ]);
    expect(r.conflicts[1]?.resolution).toMatch(/same on every line of sideborder_open's region/);
  });

  it("a multiplexer that changes the set mid-frame still breaks the constant set: hard", () => {
    const r = run(["sideborder_open", "sprite_multiplex_24"]);
    expect(kinds(r)).toContain(
      "hard sprite_set sideborder_open×sprite_multiplex_24 constant_sprite_set,changes_sprite_set",
    );
    expect(kinds(r).some((k) => k.startsWith("soft sprite_set"))).toBe(false);
  });
});

describe("placements in the spec (#90)", () => {
  it("takes 'name@lines' off the spec, keeps a phase, and keeps the first band", () => {
    expect(splitPlacement("sideborder_open@248-272")).toEqual({ spec: "sideborder_open", band: "248-272" });
    expect(splitPlacement("raster_bars@17-50:play")).toEqual({ spec: "raster_bars:play", band: "17-50" });
    expect(splitPlacement("raster_bars")).toEqual({ spec: "raster_bars" });
    const r = readPlacements(["a@1-2", "a@3-4", "b@273-311,0-1:init", "c"]);
    expect(r.specs).toEqual(["a", "a", "b:init", "c"]);
    expect([...r.placements]).toEqual([
      ["a", "1-2"],
      ["b", "273-311,0-1"],
    ]);
  });
});
