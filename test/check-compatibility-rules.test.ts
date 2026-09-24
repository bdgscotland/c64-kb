import { describe, it, expect } from "vitest";
import {
  evaluateCompatibility,
  type CompatibilityFacts,
  type TechniqueFacts,
} from "../src/tools/query/compatibility/index.ts";
import { renderCompatibility } from "../src/tools/query/compatibility/render.ts";
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
