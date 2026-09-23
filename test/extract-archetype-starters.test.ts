import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { extractGraphEntities } from "../src/graph/extract.ts";

// A **Starter:** line on an archetype page names a directory in templates/
// that c64_game_briefing tells an agent to copy. A name with no directory
// behind it would send the agent to nothing (CLAUDE.md rule 7), so every
// line on the real pages is checked against the tree.
const ROOT = new URL("..", import.meta.url).pathname;
const PAGES = ["docs/game-design/c64-game-archetypes.md", "docs/demo-design/intro-cracktro-patterns.md"];

describe("archetype **Starter:** lines", () => {
  const starters = PAGES.flatMap((page) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const entities = extractGraphEntities(readFileSync(join(ROOT, page), "utf8"), page);
    warn.mockRestore();
    return entities.flatMap((e) =>
      e.type === "archetype" && e.starter ? [{ archetype: e.name, starter: e.starter }] : [],
    );
  });

  it("each names a starter with a Makefile and an expect.json", () => {
    for (const { archetype, starter } of starters) {
      const dir = join(ROOT, "templates", starter);
      expect(existsSync(join(dir, "Makefile")), `${archetype} -> templates/${starter}/Makefile`).toBe(true);
      expect(existsSync(join(dir, "expect.json")), `${archetype} -> templates/${starter}/expect.json`).toBe(
        true,
      );
    }
  });
});
