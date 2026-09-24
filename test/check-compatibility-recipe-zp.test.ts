import { describe, it, expect } from "vitest";
import {
  evaluateCompatibility,
  type CompatibilityFacts,
  type TechniqueFacts,
} from "../src/tools/query/compatibility/index.ts";
import type { RecipeZeroPage } from "../src/tools/query/compatibility/recipe-rules.ts";

// recipe_zero_page_overlap (#22 step 8): the data point was sine_scroller +
// sfx_in_player, whose recipes both own $FB-$FE and which the check passed
// in silence (2026-09-23).
const known: TechniqueFacts = {
  found: true,
  demands: new Set(),
  registers: 1,
  kernal: [],
  band: null,
  region: null,
  category: null,
  rasterRegisters: 0,
  claims: [],
  claimsStated: "none",
};

function check(techniques: string[], recipeZeroPage: RecipeZeroPage[]) {
  const facts: CompatibilityFacts = {
    techniques,
    requires: new Map(techniques.map((t) => [t, []])),
    facts: new Map(techniques.map((t) => [t, known])),
    sharedRegisters: new Map(),
    sharedKernal: new Map(),
    recipeUses: [],
    recipeZeroPage,
  };
  return evaluateCompatibility(facts);
}

describe("recipe_zero_page_overlap", () => {
  it("names both recipes and the bytes, as info that leaves the verdict alone", () => {
    const r = check(
      ["sine_scroller", "sfx_in_player"],
      [
        { recipe: "kickassembler-sine-scroller", implements: ["sine_scroller"], ranges: "FB-FE" },
        { recipe: "kickassembler-sfx-in-player", implements: ["sfx_in_player"], ranges: "02-05,FB-FE" },
      ],
    );
    expect(r.verdict).toBe("compatible");
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]).toMatchObject({
      a: "sine_scroller",
      b: "sfx_in_player",
      kind: "recipe_zero_page_overlap",
      severity: "info",
      shared: ["$FB-$FE"],
    });
    expect(r.conflicts[0]?.rationale).toContain(
      "kickassembler-sine-scroller and kickassembler-sfx-in-player ($FB-$FE)",
    );
  });

  it("says nothing when the bytes differ, or when one recipe builds both techniques", () => {
    expect(
      check(
        ["a", "b"],
        [
          { recipe: "ra", implements: ["a"], ranges: "FB-FC" },
          { recipe: "rb", implements: ["b"], ranges: "FD-FE" },
        ],
      ).conflicts,
    ).toEqual([]);
    expect(
      check(
        ["a", "b"],
        [
          { recipe: "both", implements: ["a", "b"], ranges: "FB-FE" },
          { recipe: "rb", implements: ["b"], ranges: "FB-FE" },
        ],
      ).conflicts,
    ).toEqual([]);
  });
});
