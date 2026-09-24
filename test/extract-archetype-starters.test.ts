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

// #41: fingerprints proposed what the archetype's starter does not use:
// sprite_multiplex_8 for a Boulder Dash cave game, ram_under_kernal for a
// text adventure that fits with the ROMs in, stable_raster_irq and
// double_irq for a shooter whose panel split polls.
describe("archetype fingerprints match their starters (#41)", () => {
  const page = PAGES[0] ?? "";
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const entities = extractGraphEntities(readFileSync(join(ROOT, page), "utf8"), page);
  warn.mockRestore();
  const features = (archetype: string) =>
    entities.flatMap((e) =>
      e.type === "archetype_features" && e.archetype === archetype ? [e.technique] : [],
    );

  it.each([
    ["vertical_shmup", ["stable_raster_irq", "double_irq"], ["sfx_in_player", "scroll_panel_split"]],
    ["puzzle", ["sprite_multiplex_8", "stable_raster_irq"], ["cave_scan_engine", "frame_sync_loop"]],
    [
      "text_adventure",
      ["ram_under_kernal", "cpu_io_port_bank", "exomizer_basics"],
      ["two_word_parser", "kernal_file_write_seq"],
    ],
  ])("%s", (archetype, absent, present) => {
    const f = features(archetype);
    for (const t of absent) expect(f).not.toContain(t);
    for (const t of present) expect(f).toContain(t);
  });
});
