import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { extractGraphEntities } from "../src/graph/extract.ts";
import { briefTokens, numberPhraseMissing, unaskedEffect } from "../src/tools/briefings/discovery.ts";
import { describedReason, pickByBriefWords, seedsFor } from "../src/tools/briefings/archetype.ts";
import { whyProposed } from "../src/tools/briefings/why-proposed.ts";

// The pure parts of briefing discovery that the #39 starter builds found
// wrong (#41); no graph needed.

describe("brief tokens", () => {
  it("reads multicolour as multicolor, so it can meet multicolor_bitmap", () => {
    expect(briefTokens("static multicolour bitmap backgrounds")).toContain("multicolor");
    expect(briefTokens("static multicolour bitmap backgrounds")).not.toContain("multicolour");
  });

  it("drops number words: 'eight events' is not 'Eight sprites'", () => {
    expect(briefTokens("eight events and a four-sprite player")).not.toContain("eight");
    expect(briefTokens("eight events and a four-sprite player")).not.toContain("four");
  });

  it("drops a sentence's closing full stop", () => {
    expect(briefTokens("saved to disk.")).toContain("disk");
  });
});

describe("a demo effect the game brief does not name (#41)", () => {
  const knight = "two-player medieval combat, multi-sprite fighters, static multicolour bitmap backgrounds";
  it("is left out: an effect page's technique, or one whose name carries an effect word", () => {
    expect(unaskedEffect({ name: "mci_interlace_bitmap", category: "bitmap" }, knight)).toBe(true);
    expect(unaskedEffect({ name: "sprite_sine_chain", category: "sprite" }, knight)).toBe(true);
    expect(unaskedEffect({ name: "vector_balls_sprites", category: "effect" }, knight)).toBe(true);
    expect(unaskedEffect({ name: "dot_flag_sine_plotter", category: "effect" }, knight)).toBe(true);
  });

  it("stays when the brief names it, and a plain technique is never an effect", () => {
    expect(unaskedEffect({ name: "mci_interlace_bitmap", category: "bitmap" }, "an interlace picture")).toBe(
      false,
    );
    expect(unaskedEffect({ name: "starfield", category: "effect" }, "a shooter over a starfield")).toBe(
      false,
    );
    expect(unaskedEffect({ name: "multicolor_bitmap", category: "bitmap" }, knight)).toBe(false);
    expect(unaskedEffect({ name: "colour_fade", category: "effect" }, "fade the title out")).toBe(false);
  });
});

describe("a name that starts with a number word matches only as a phrase", () => {
  it("a four-sprite player is not a four-player adapter", () => {
    expect(numberPhraseMissing("four_player_read", "a beat-em-up with a four-sprite player")).toBe(true);
    expect(numberPhraseMissing("four_player_read", "four-player joystick adapter")).toBe(false);
    expect(numberPhraseMissing("two_player_state_swap", "a 2-player game")).toBe(false);
    expect(numberPhraseMissing("sprite_multiplex_8", "anything")).toBe(false);
  });
});

describe("techniques the brief's own words ask for", () => {
  const forced = (description: string, isGame = true) =>
    seedsFor({ description, archetype: undefined, resolved: undefined, isGame }).forced;

  it("a game gets a frame loop; a demo does not", () => {
    expect(forced("a one-on-one fighter")).toContain("frame_sync_loop");
    expect(forced("a small intro", false)).not.toContain("frame_sync_loop");
    expect(describedReason("frame_sync_loop", "a fighter", true)).toMatch(/frame loop/);
  });

  it("saving to disk brings the sequential file pair and the status channel", () => {
    const f = forced("a text adventure with a parser; save and load the game to disk");
    expect(f).toEqual(
      expect.arrayContaining(["kernal_file_write_seq", "kernal_file_read_seq", "error_channel_check"]),
    );
    expect(forced("a high score saved to and loaded from disk")).toContain("kernal_file_write_seq");
    expect(forced("events loaded from disk one at a time")).not.toContain("kernal_file_write_seq");
  });

  it("PAL and NTSC bring detection; one of them alone does not", () => {
    expect(forced("runs on PAL and NTSC machines")).toContain("pal_ntsc_detection");
    expect(forced("a PAL-only demo")).not.toContain("pal_ntsc_detection");
  });

  it("animated characters and animated sprites bring their table techniques", () => {
    expect(forced("a cave with animated characters")).toContain("charset_animation");
    expect(forced("animated sprites from a frame table")).toContain("sprite_animation_table");
    expect(describedReason("charset_animation", "animated tiles", true)).toMatch(/animates characters/);
  });
});

describe("why proposed names the words that matched (#41)", () => {
  it("lists the brief's words found in the name or title", () => {
    expect(
      whyProposed("char_bullets", "render", "bullets drawn as characters", "Bullets drawn as characters"),
    ).toBe('The brief\'s words "bullets", "drawn", "characters" are in its name or title');
  });

  it("says so when no word matched (a vector-search hit)", () => {
    expect(whyProposed("mystery", "render", "a road shooter", "Something else")).toMatch(
      /^Found by semantic search/,
    );
  });
});

describe("routing a brief by the shipped archetype page's brief words", () => {
  const src = "docs/game-design/c64-game-archetypes.md";
  const text = fs.readFileSync(path.resolve(__dirname, "..", src), "utf8");
  const rows = extractGraphEntities(text, src).flatMap((e) =>
    e.type === "archetype" && e.kind === "game" ? [{ name: e.name, words: e.brief_words }] : [],
  );
  const route = (brief: string) => pickByBriefWords(brief, rows)?.row.name;

  it("a one-on-one medieval combat brief routes to sports (#41)", () => {
    expect(
      route(
        "a Knight Games-style two-player side-view medieval combat game, one-on-one bouts with a computer",
      ),
    ).toBe("sports");
    expect(route("karate: a one on one fighter")).toBe("sports");
  });

  it("a fighting-game brief still routes to beat_em_up", () => {
    expect(route("a fighting game in the style of Double Dragon")).toBe("beat_em_up");
  });
});
