import { describe, it, expect } from "vitest";
import { oneOfEachAlternative } from "../src/tools/briefings/alternatives.ts";
import type { TechniqueLookupOutput } from "../src/schemas/tool-outputs.ts";

type Alt = { name: string; tradeoff: string; stated_on: string };

function tech(name: string, recipes: number, alternatives: Alt[] = []): TechniqueLookupOutput {
  return {
    name,
    title: name,
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

  it("keeps both when both are forced", () => {
    const forced = new Set(["sprite_multiplex_24", "sprite_multiplex_8"]);
    const { kept, leftOut } = oneOfEachAlternative([m24(1), m8(1)], forced);
    expect(kept).toHaveLength(2);
    expect(leftOut.size).toBe(0);
  });
});
