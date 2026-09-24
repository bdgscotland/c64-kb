import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { extractGraphEntities } from "../src/graph/extract.ts";
import { pickByBriefWords, topByBriefWords } from "../src/tools/briefings/archetype.ts";
import { pickByGenreHeads } from "../src/tools/briefings/route-heads.ts";

describe("routing a brief by its genre noun (#19)", () => {
  const src = "docs/game-design/c64-game-archetypes.md";
  const text = fs.readFileSync(path.resolve(__dirname, "..", src), "utf8");
  const rows = extractGraphEntities(text, src).flatMap((e) =>
    e.type === "archetype" && e.kind === "game" ? [{ name: e.name, words: e.brief_words }] : [],
  );
  /** The two passes as the briefing runs them: whole phrases first, then genre nouns. */
  const route = (brief: string): string | string[] | undefined => {
    const top = topByBriefWords(brief, rows);
    if (top.length === 1) return top[0]?.row.name;
    if (top.length > 1) return top.map((t) => t.row.name).sort();
    const heads = pickByGenreHeads(brief, rows);
    if (!heads) return undefined;
    return "row" in heads ? heads.row.name : heads.candidates.map((c) => c.name).sort();
  };

  it("offers both platformers for 'a platformer' and both shmups for 'a shooter'", () => {
    expect(route("a platformer")).toEqual(["scrolling_platformer", "single_screen_platformer"]);
    expect(route("a shooter")).toEqual(["horizontal_shmup", "vertical_shmup"]);
    expect(route("a shoot em up with shooters")).toEqual(["horizontal_shmup", "vertical_shmup"]);
  });

  it("offers both puzzle archetypes for 'a puzzle game', a tie in the phrase pass", () => {
    expect(pickByBriefWords("a puzzle game", rows)).toBeUndefined();
    expect(pickByGenreHeads("a puzzle game", rows)).toMatchObject({ matched: ["puzzle"] });
    expect(route("a puzzle game")).toEqual(["action_puzzle", "puzzle"]);
  });

  it("routes a noun only one archetype holds, and leaves the phrase pass first", () => {
    expect(route("a racing game with a lap counter")).toBe("racing");
    expect(route("a single screen platformer")).toBe("single_screen_platformer");
    expect(route("a scrolling platformer")).toBe("scrolling_platformer");
  });

  it("does not read a head used once, or a word that names no genre", () => {
    expect(route("a gun that fires three shots")).toBeUndefined();
    expect(route("a title screen with a power up")).toBeUndefined();
  });
});
