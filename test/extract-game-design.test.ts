import { describe, it, expect, vi, afterEach } from "vitest";
import { extractGraphEntities } from "../src/graph/extract.ts";
import { parseComposes, parseMeasuredFrame } from "../src/graph/extract/game-design.ts";

// docs/CONVENTIONS-game-designs.md (schema 28).
const DOC = `<!-- doc-type: game-design -->

# Game design: test

Prose before any H2.

## Test platformer (Oscar64)

**Game design:** \`test_platformer\`
**Instance of:** single_screen_platformer, \`Not A Name\`
**Realised by:** oscar64-platformer-scaffold, not_a_recipe
**Region:** both
**Composes:** tile_map_render (init), lfsr_random (init), lfsr_random, decimal_print, kernal_file_write_seq (transition), bad_phase (later), decimal_print
**Measured frame:** play pal worst=8693 typical=4966; play ntsc worst=10287 (measured-vice, CIA1 timer B, recipes/oscar64/platformer-scaffold.md "Expected output")
**Measured frame:** play pal worst=1 (estimated, a second PAL play entry)

## Prose section

Nothing here.

## Missing name

**Composes:** decimal_print
`;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("game-design extractor", () => {
  it("emits the node, one COMPOSES per technique and phase, INSTANCE_OF and REALISED_BY", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const es = extractGraphEntities(DOC, "game-design/designs/test.md");
    const node = es.find((e) => e.type === "game_design");
    expect(node).toEqual({
      type: "game_design",
      name: "test_platformer",
      title: "Test platformer (Oscar64)",
      region: "both",
      measured: [
        {
          phase: "play",
          region: "PAL",
          worst: 8693,
          typical: 4966,
          basis: "measured-vice",
          source: 'CIA1 timer B, recipes/oscar64/platformer-scaffold.md "Expected output"',
        },
        {
          phase: "play",
          region: "NTSC",
          worst: 10287,
          basis: "measured-vice",
          source: 'CIA1 timer B, recipes/oscar64/platformer-scaffold.md "Expected output"',
        },
        // #107: a second line for play PAL is its own measurement, kept.
        { phase: "play", region: "PAL", worst: 1, basis: "estimated", source: "a second PAL play entry" },
      ],
      source_doc: "game-design/designs/test.md",
    });
    const composes = es.flatMap((e) => (e.type === "composes" ? [`${e.technique}:${e.phase}`] : []));
    expect(composes).toEqual([
      "tile_map_render:init",
      "lfsr_random:init",
      "lfsr_random:play",
      "decimal_print:play",
      "kernal_file_write_seq:transition",
    ]);
    expect(es.filter((e) => e.type === "instance_of")).toEqual([
      { type: "instance_of", design: "test_platformer", archetype: "single_screen_platformer" },
    ]);
    expect(es.filter((e) => e.type === "realised_by")).toEqual([
      { type: "realised_by", design: "test_platformer", recipe: "oscar64-platformer-scaffold" },
    ]);
    const warnings = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(warnings).toContain('phase "later"');
    expect(warnings).toContain('"Not A Name"');
    expect(warnings).toContain('"not_a_recipe"');
    expect(warnings).not.toContain("Measured frame");
    expect(warnings).toContain('H2 "Missing name" has a **Composes:** line but no **Game design:** line');
    // Only one design: the prose H2 and the unnamed one are not ingested.
    expect(es.filter((e) => e.type === "game_design")).toHaveLength(1);
  });

  it("a page without the marker yields nothing", () => {
    expect(extractGraphEntities(DOC.replace("<!-- doc-type: game-design -->", ""), "x.md")).toEqual([]);
  });

  it("refuses a Measured frame line whole on any malformed part", () => {
    expect(parseMeasuredFrame("play pal worst=10 (measured-vice, here)")).toEqual([
      { phase: "play", region: "PAL", worst: 10, basis: "measured-vice", source: "here" },
    ]);
    const bad = [
      "play pal worst=10",
      "play pal worst=10 (guessed, here)",
      "play pal typical=10 (measured-vice, here)",
      "play pal worst=10 cycles=3 (measured-vice, here)",
      "attract pal worst=10 (measured-vice, here)",
      "play secam worst=10 (measured-vice, here)",
      "play pal worst=10; play pal worst=11 (measured-vice, here)",
      "(measured-vice, here)",
    ];
    for (const line of bad) expect(parseMeasuredFrame(line), line).toHaveProperty("error");
  });

  it("parses the Composes grammar", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(parseComposes("`a`, b (init), c ( transition ), d(x), E", "t")).toEqual([
      { technique: "a", phase: "play" },
      { technique: "b", phase: "init" },
      { technique: "c", phase: "transition" },
    ]);
  });

  it("reads a call count, ×N or ×M-N, before the phase, and refuses a bad one (#37)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(parseComposes("decimal_print ×2-7, b ×3 (init), c x4, d*5, e ×9-2, f ×0", "t")).toEqual([
      { technique: "decimal_print", phase: "play", calls: { low: 2, high: 7 } },
      { technique: "b", phase: "init", calls: { low: 3, high: 3 } },
      { technique: "c", phase: "play", calls: { low: 4, high: 4 } },
      { technique: "d", phase: "play", calls: { low: 5, high: 5 } },
    ]);
    const warnings = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(warnings).toContain('"e ×9-2"');
    expect(warnings).toContain('"f ×0"');
  });

  it("the three design pages in docs extract with no warning", async () => {
    const fs = await import("node:fs");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (const f of ["platformer-scaffold", "falling-blocks", "simple-shmup"]) {
      const path = `game-design/designs/${f}.md`;
      const es = extractGraphEntities(fs.readFileSync(`docs/${path}`, "utf8"), path);
      expect(
        es.filter((e) => e.type === "game_design"),
        f,
      ).toHaveLength(1);
      expect(
        es.filter((e) => e.type === "realised_by"),
        f,
      ).toHaveLength(1);
    }
    expect(warn).not.toHaveBeenCalled();
  });
});
