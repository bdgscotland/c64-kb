import { readFileSync } from "node:fs";
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
      // Schema 40: a page with no kind is built, and has no study lines.
      kind: "built",
      irq_chain: [],
      memory_map: [],
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

// Schema 40: a studied game is a GameDesign (kind: studied, docs/game-design/studies/).
describe("game-design extractor: a studied design", () => {
  const STUDY = readFileSync("test/fixtures/study-page.md", "utf8");
  const PATH = "game-design/studies/test-shooter.md";

  it("reads kind, Studied from, IRQ chain and Memory map onto the node", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const es = extractGraphEntities(STUDY, PATH);
    const node = es.find((e) => e.type === "game_design");
    expect(node).toMatchObject({
      name: "test_shooter_study",
      kind: "studied",
      region: "PAL",
      studied_from: {
        title: "Test Shooter",
        year: 1985,
        authors: ["Ann Coder", "Test House"],
        image_sha1: "0123456789abcdef0123456789abcdef01234567",
        session: "studies/sessions/test-shooter.json",
      },
      irq_chain: [
        {
          phase: "play",
          region: "PAL",
          handlers: [
            { pc: "$41C5", lines: [30] },
            { pc: "$4284", lines: [50, 52] },
            { pc: "$4389", lines: [192] },
          ],
          basis: "measured-vice",
          source: "obs test#1-#3",
        },
        {
          phase: "title",
          region: "PAL",
          handlers: [{ pc: "$4134", lines: [30] }],
          basis: "measured-vice",
          source: "obs test#4",
        },
      ],
      memory_map: [
        {
          entries: [
            { label: "VIC bank", value: "3" },
            { label: "screen", value: "$C000" },
            { label: "charset", value: "$D000" },
            { label: "sprites", value: "$E000-$E7FF" },
            { label: "$01", value: "$35", when: "play" },
          ],
          basis: "measured-vice",
          source: "obs test#5-#9",
        },
      ],
      measured: [
        {
          phase: "play",
          region: "PAL",
          worst: 18000,
          typical: 15000,
          basis: "measured-vice-study",
          source: "frame mode over 200 frames, obs test#10",
        },
      ],
      source_doc: PATH,
    });
    // A studied design composes nothing and is realised by no recipe: no warning for either.
    expect(warn).not.toHaveBeenCalled();
  });

  it("emits STUDIES to the title and DIVERGES_FROM per technique with its direction", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const es = extractGraphEntities(STUDY, PATH);
    expect(es.filter((e) => e.type === "studies")).toEqual([
      { type: "studies", design: "test_shooter_study", production: "Test Shooter" },
    ]);
    // Names are MATCHed at ingest; an unknown one is dropped and counted there, not here.
    expect(es.filter((e) => e.type === "diverges_from")).toEqual([
      {
        type: "diverges_from",
        design: "test_shooter_study",
        technique: "invalid_mode_band",
        direction: "extra",
      },
      {
        type: "diverges_from",
        design: "test_shooter_study",
        technique: "not_a_technique",
        direction: "extra",
      },
      {
        type: "diverges_from",
        design: "test_shooter_study",
        technique: "soft_scroll_v",
        direction: "missing",
      },
    ]);
  });

  it("a page without kind is built, and the study lines on it are refused", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const es = extractGraphEntities(STUDY.replace("kind: studied", "title: x"), PATH);
    const node = es.find((e) => e.type === "game_design");
    expect(node).toMatchObject({ kind: "built", irq_chain: [], memory_map: [], measured: [] });
    expect(node).not.toHaveProperty("studied_from");
    expect(es.filter((e) => e.type === "studies" || e.type === "diverges_from")).toEqual([]);
    const warnings = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(warnings).toContain("only read on a kind: studied page");
    // measured-vice-study is a study's basis; on a built design the line is refused.
    expect(warnings).toContain("measured-vice-study");
  });

  it("refuses an unknown kind and reads the page as built", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const es = extractGraphEntities(STUDY.replace("kind: studied", "kind: observed"), PATH);
    expect(es.find((e) => e.type === "game_design")).toMatchObject({ kind: "built" });
    expect(warn.mock.calls.map((c) => String(c[0])).join("\n")).toContain('kind "observed"');
  });

  it("refuses each malformed study line whole", () => {
    const cases: [string, string, string][] = [
      ["**Studied from:**", "Test Shooter (1985, Ann Coder); image sha1=abc; session x.json", "Studied from"],
      [
        "**Studied from:**",
        "Test Shooter 1985; image sha1=0123456789abcdef0123456789abcdef01234567; session x.json",
        "Studied from",
      ],
      ["**IRQ chain:**", "play pal: $41C5 @ line 30, $4284 at 50 (measured-vice, obs)", "IRQ chain"],
      ["**IRQ chain:**", "play secam: $41C5 @ line 30 (measured-vice, obs)", "IRQ chain"],
      ["**IRQ chain:**", "play pal: $41C5 @ line 30 (guessed, obs)", "IRQ chain"],
      ["**IRQ chain:**", "play pal: $41C5 @ line 30", "IRQ chain"],
      ["**Memory map:**", "VIC bank 3; screen at the top (measured-vice, obs)", "Memory map"],
      ["**Memory map:**", "VIC bank 3; screen $C000", "Memory map"],
      [
        "**Diverges from archetype:**",
        "extra: invalid_mode_band; surplus: soft_scroll_v",
        "Diverges from archetype",
      ],
      ["**Diverges from archetype:**", "extra: invalid_mode_band, Not A Name", "Diverges from archetype"],
    ];
    for (const [label, value, word] of cases) {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const line = new RegExp(`^${label.replace(/\*/g, "\\*")}.*$`, "m");
      // Every line of this label is replaced, so no good line of the same label survives.
      const doc = STUDY.split("\n")
        .filter((l, i, all) => !line.test(l) || all.findIndex((x) => line.test(x)) === i)
        .join("\n")
        .replace(line, `${label} ${value}`);
      const es = extractGraphEntities(doc, PATH);
      const node = es.find((e) => e.type === "game_design");
      const warnings = warn.mock.calls.map((c) => String(c[0])).join("\n");
      expect(warnings, value).toContain(`**${word}:** line refused`);
      if (word === "Studied from") {
        expect(node, value).not.toHaveProperty("studied_from");
        expect(
          es.filter((e) => e.type === "studies"),
          value,
        ).toEqual([]);
      }
      if (word === "IRQ chain") expect(node, value).toHaveProperty("irq_chain", []);
      if (word === "Memory map") expect(node, value).toHaveProperty("memory_map", []);
      if (word === "Diverges from archetype")
        expect(
          es.filter((e) => e.type === "diverges_from"),
          value,
        ).toEqual([]);
      warn.mockRestore();
    }
  });

  it("reads the widened Memory map grammar: digits after in, any I/O port, - / ( ) in labels (Task 8 review)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const line =
      "**Memory map:** charset area 0 $C000-$C7FF; blank sprite (block $FF) $FFC0-$FFFF; code/tables $0850-$44FF; sound-driver $5000; $DD00=$94; $D018=$80 in area 0; $01=$36 in play (measured-vice, obs x)";
    const es = extractGraphEntities(STUDY.replace(/^\*\*Memory map:\*\*.*$/m, line), PATH);
    expect(es.find((e) => e.type === "game_design")).toMatchObject({
      memory_map: [
        {
          entries: [
            { label: "charset area 0", value: "$C000-$C7FF" },
            { label: "blank sprite (block $FF)", value: "$FFC0-$FFFF" },
            { label: "code/tables", value: "$0850-$44FF" },
            { label: "sound-driver", value: "$5000" },
            { label: "$DD00", value: "$94" },
            { label: "$D018", value: "$80", when: "area 0" },
            { label: "$01", value: "$36", when: "play" },
          ],
        },
      ],
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns when a second Studied from line parses, and keeps the first", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const second =
      "**Studied from:** Other Shooter (1986, Bo Coder); image sha1=89abcdef0123456789abcdef0123456789abcdef; session x.json";
    const doc = STUDY.replace(/^(\*\*Studied from:\*\*.*)$/m, `$1\n${second}`);
    const es = extractGraphEntities(doc, PATH);
    expect(es.find((e) => e.type === "game_design")).toMatchObject({
      studied_from: { title: "Test Shooter" },
    });
    expect(es.filter((e) => e.type === "studies")).toHaveLength(1);
    expect(warn.mock.calls.map((c) => String(c[0])).join("\n")).toContain("more than one **Studied from:**");
  });

  it("bounds IRQ chain lines by region: PAL 0-311, NTSC 0-262", () => {
    const chain = (value: string) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const doc = STUDY.split("\n")
        .filter((l) => !l.startsWith("**IRQ chain:**"))
        .join("\n")
        .replace("**Memory map:**", `**IRQ chain:** ${value} (measured-vice, obs x)\n**Memory map:**`);
      const node = extractGraphEntities(doc, PATH).find((e) => e.type === "game_design");
      const warned = warn.mock.calls.map((c) => String(c[0])).join("\n");
      warn.mockRestore();
      return { irq: (node as { irq_chain: unknown[] }).irq_chain, warned };
    };
    expect(chain("play pal: $41C5 @ line 311").irq).toHaveLength(1);
    expect(chain("play pal: $41C5 @ line 312").warned).toContain("above 311");
    expect(chain("play ntsc: $41C5 @ line 262").irq).toHaveLength(1);
    const ntsc = chain("play ntsc: $41C5 @ line 30/290");
    expect(ntsc.irq).toEqual([]);
    expect(ntsc.warned).toContain("above 262");
  });

  it("a studied page with no Studied from line is warned about", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    extractGraphEntities(STUDY.replace(/^\*\*Studied from:\*\*.*$/m, ""), PATH);
    expect(warn.mock.calls.map((c) => String(c[0])).join("\n")).toContain("has no **Studied from:** line");
  });
});
