import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { designPattern, designPatternsFor, parseDesignPatterns } from "../src/tools/query/design-patterns.ts";

const DOCS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../docs");

const PAGE = `<!-- doc-type: reference -->

# Game Structure

## alpha_pattern — The alpha

**Kind:** structure
**Applies to:** vertical_shmup, puzzle
**Realised by:** frame_sync_loop, oscar64/simple-shmup

Text.

## beta_pattern — The beta

**Applies to:** puzzle

## Not a pattern

**Applies to:** vertical_shmup
`;

describe("game-design patterns from their pages (KB-GAPS 28)", () => {
  it("reads name, title, Applies to and Realised by under each snake_case H2", () => {
    expect(parseDesignPatterns(PAGE, "game-design/x.md")).toEqual([
      {
        name: "alpha_pattern",
        title: "The alpha",
        source: "game-design/x.md",
        applies_to: ["vertical_shmup", "puzzle"],
        realised_by: ["frame_sync_loop", "oscar64/simple-shmup"],
      },
      {
        name: "beta_pattern",
        title: "The beta",
        source: "game-design/x.md",
        applies_to: ["puzzle"],
        realised_by: [],
      },
    ]);
  });

  it("gives vertical_run_and_gun the front end, the state machine and the level patterns", () => {
    const names = designPatternsFor(DOCS, ["vertical_run_and_gun"]).map((p) => p.name);
    for (const n of [
      "game_state_machine",
      "front_end_and_attract",
      "level_end_conditions",
      "level_transition_sequence",
    ])
      expect(names).toContain(n);
  });

  it("gives several candidates only what applies to all of them, and a text adventure no front end", () => {
    const both = designPatternsFor(DOCS, ["vertical_shmup", "text_adventure"]).map((p) => p.name);
    expect(both).not.toContain("front_end_and_attract");
    expect(designPatternsFor(DOCS, ["text_adventure"]).map((p) => p.name)).not.toContain(
      "front_end_and_attract",
    );
    expect(designPatternsFor(DOCS, [])).toEqual([]);
  });

  it("finds one pattern by name, for a lookup that is not a technique", () => {
    const p = designPattern(DOCS, "front_end_and_attract");
    expect(p?.source).toBe("game-design/game-structure.md");
    expect(p?.realised_by).toContain("high_score_table_insert");
    expect(designPattern(DOCS, "no_such_pattern")).toBeNull();
  });
});
