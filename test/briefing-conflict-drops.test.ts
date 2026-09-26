import { describe, it, expect } from "vitest";
import { searchOnlyConflictDrops } from "../src/tools/briefings/conflict-drops.ts";

// #97: the briefing proposed sprite_multiplex_8 beside the forced
// sprite_multiplex_game, a pair check-compatibility calls a hard conflict.
const hard = (a: string, b: string) => ({
  a,
  b,
  kind: "unit_contention",
  rationale: `${a} and ${b} both own it`,
});

describe("searchOnlyConflictDrops", () => {
  it("drops a search-found technique in a hard conflict with a forced one, and says beside which", () => {
    const r = searchOnlyConflictDrops(
      ["sprite_multiplex_game", "lfsr_random", "sprite_multiplex_8"],
      [hard("sprite_multiplex_game", "sprite_multiplex_8")],
      new Set(["sprite_multiplex_game"]),
    );
    expect([...r.dropped]).toEqual(["sprite_multiplex_8"]);
    expect(r.leftOut.get("sprite_multiplex_game")).toEqual([
      {
        name: "sprite_multiplex_8",
        kind: "unit_contention",
        rationale: "sprite_multiplex_game and sprite_multiplex_8 both own it",
      },
    ]);
  });

  it("keeps two search-found techniques and two forced ones: the conflict is the plan's to resolve", () => {
    const pair = [hard("sprite_multiplex_8", "sprite_multiplex_24")];
    expect(
      searchOnlyConflictDrops(["sprite_multiplex_8", "sprite_multiplex_24"], pair, new Set()).dropped.size,
    ).toBe(0);
    const forced = new Set(["sprite_multiplex_8", "sprite_multiplex_24"]);
    expect(
      searchOnlyConflictDrops(["sprite_multiplex_8", "sprite_multiplex_24"], pair, forced).dropped.size,
    ).toBe(0);
  });

  it("ignores soft-only neighbours and techniques with no conflict", () => {
    const r = searchOnlyConflictDrops(["a", "b", "c"], [], new Set(["a"]));
    expect(r.dropped.size).toBe(0);
    expect(r.leftOut.size).toBe(0);
  });
});
