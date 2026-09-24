import { describe, it, expect } from "vitest";
import { oneOfEachAlternative } from "../src/tools/briefings/alternatives.ts";
import type { TechniqueLookupOutput } from "../src/schemas/tool-outputs.ts";

type Alt = { name: string; tradeoff: string; stated_on: string };

function tech(name: string, recipes: number, alternatives: Alt[] = [], title = name): TechniqueLookupOutput {
  return {
    name,
    title,
    category: "sprite",
    complexity: "high",
    uses_registers: [],
    uses_kernal: [],
    recipes: Array.from({ length: recipes }, (_, i) => ({
      name: `${name}-r${i}`,
      toolchain: "kickassembler",
    })),
    alternatives: alternatives.map((a) => ({ ...a, title: a.name })),
    documentation: [],
  };
}

const tradeoff = "more than 16 sprites; needs a Y-sorted list";
const m24 = (recipes: number) =>
  tech("sprite_multiplex_24", recipes, [
    { name: "sprite_multiplex_8", tradeoff, stated_on: "sprite_multiplex_24" },
  ]);
const m8 = (recipes: number) =>
  tech("sprite_multiplex_8", recipes, [
    { name: "sprite_multiplex_24", tradeoff, stated_on: "sprite_multiplex_24" },
  ]);

describe("oneOfEachAlternative (#17 ONTO-07)", () => {
  it("keeps one multiplexer of the pair and reports the other as its alternative", () => {
    const { kept, leftOut } = oneOfEachAlternative([m24(1), tech("raster_bars", 1), m8(2)], new Set());
    expect(kept.map((t) => t.name)).toEqual(["sprite_multiplex_8", "raster_bars"]);
    expect(leftOut.get("sprite_multiplex_8")).toEqual([
      { name: "sprite_multiplex_24", tradeoff, stated_on: "sprite_multiplex_24" },
    ]);
  });

  it("keeps the higher-ranked on a recipe tie, and a forced one over a found one", () => {
    expect(oneOfEachAlternative([m24(1), m8(1)], new Set()).kept.map((t) => t.name)).toEqual([
      "sprite_multiplex_24",
    ]);
    expect(
      oneOfEachAlternative([m8(3), m24(0)], new Set(["sprite_multiplex_24"])).kept.map((t) => t.name),
    ).toEqual(["sprite_multiplex_24"]);
  });

  // #91: the brief states a count; the titles and tradeoff are the pages' own.
  const brief24 = "sprite multiplexer demo with 24 sprites on screen via raster reuse";
  const real24 = (recipes: number) =>
    tech(
      "sprite_multiplex_24",
      recipes,
      [{ name: "sprite_multiplex_8", tradeoff, stated_on: "sprite_multiplex_24" }],
      "Up to 24+ sprites via raster reuse",
    );
  const real8 = (recipes: number) =>
    tech(
      "sprite_multiplex_8",
      recipes,
      [{ name: "sprite_multiplex_24", tradeoff, stated_on: "sprite_multiplex_24" }],
      "8-sprite multiplexer",
    );

  it("keeps the technique whose title states the brief's count over one with more recipes (#91)", () => {
    const { kept, leftOut } = oneOfEachAlternative([real8(3), real24(1)], new Set(), brief24);
    expect(kept.map((t) => t.name)).toEqual(["sprite_multiplex_24"]);
    expect(leftOut.get("sprite_multiplex_24")?.map((e) => e.name)).toEqual(["sprite_multiplex_8"]);
    expect(
      oneOfEachAlternative([real24(1), real8(0)], new Set(), "an 8-sprite multiplexer").kept.map(
        (t) => t.name,
      ),
    ).toEqual(["sprite_multiplex_8"]);
  });

  it("reads the tradeoff's 'more than N' against the brief's count, and a count beats forcing", () => {
    const untitled24 = tech("sprite_multiplex_24", 0, [
      { name: "sprite_multiplex_8", tradeoff, stated_on: "sprite_multiplex_24" },
    ]);
    expect(
      oneOfEachAlternative([real8(3), untitled24], new Set(["sprite_multiplex_8"]), "20 sprites").kept.map(
        (t) => t.name,
      ),
    ).toEqual(["sprite_multiplex_24"]);
    // 12 is not more than 16, and 24 frames is not a sprite count: recipes decide.
    for (const b of ["12 sprites", "24 frames of animation", "no number here"]) {
      expect(oneOfEachAlternative([real24(1), real8(3)], new Set(), b).kept.map((t) => t.name)).toEqual([
        "sprite_multiplex_8",
      ]);
    }
  });

  it("keeps both when both are forced", () => {
    const forced = new Set(["sprite_multiplex_24", "sprite_multiplex_8"]);
    const { kept, leftOut } = oneOfEachAlternative([m24(1), m8(1)], forced);
    expect(kept).toHaveLength(2);
    expect(leftOut.size).toBe(0);
  });
});
