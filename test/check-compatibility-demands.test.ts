import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorService } from "../src/services/falkor.ts";
import { checkCompatibility } from "../src/tools/query.ts";
import { extractGraphEntities, DEMAND_VOCABULARY } from "../src/graph/extract.ts";

// Hard conflicts derived from DEMANDS edges, and the data-coverage report.
// The graph name comes from vitest.config.ts (c64_test), never the live one.
describe("checkCompatibility with resource demands", () => {
  let f: FalkorService;
  beforeAll(async () => {
    f = new FalkorService();
    await f.connect();
    await f.clean();
    await f.ensureSchema();
    for (const [name, category] of [
      ["fli_image", "bitmap"], ["sideborder_open", "raster"], ["sprite_multiplex_24", "sprite"],
      ["raster_bars", "raster"], ["digi_4bit", "music"], ["ram_under_kernal", "banking"],
      ["prints_with_kernal", "render"], ["mystery_technique", "effect"], ["sine_scroller", "scroll"],
    ] as const) {
      await f.addTechnique({ name, title: name, category, complexity: "high" });
    }
    const d = (t: string, r: string) => f.linkTechniqueDemands(t, r, DEMAND_VOCABULARY[r]);
    await d("fli_image", "cpu_every_line");
    await d("fli_image", "constant_sprite_set");
    await d("sideborder_open", "cpu_every_line");
    await d("sideborder_open", "constant_sprite_set");
    await d("sprite_multiplex_24", "midframe_raster_irqs");
    await d("sprite_multiplex_24", "changes_sprite_set");
    await d("raster_bars", "midframe_raster_irqs");
    await d("digi_4bit", "continuous_interrupts");
    await d("ram_under_kernal", "kernal_rom_out");
    await f.addKernalRoutine("CHROUT", "$FFD2", "Output a character");
    await f.linkTechniqueUsesKernal("prints_with_kernal", "CHROUT");
    await f.addRegister("SCROLX", "$D016", "VIC-II", "RW", ["D016"]);
    await f.linkTechniqueUsesRegister("sine_scroller", "D016");
  });
  afterAll(async () => f.close());

  it("two cpu_every_line techniques are incompatible", async () => {
    const r = (await checkCompatibility(["fli_image", "sideborder_open"])).structured;
    expect(r.verdict).toBe("incompatible");
    const c = r.conflicts.find((x) => x.kind === "cpu_exclusive");
    expect(c?.severity).toBe("hard");
    expect(c?.resolution).toMatch(/band|border/);
  });

  it("FLI against a multiplexer is incompatible on two grounds", async () => {
    const r = (await checkCompatibility(["fli_image", "sprite_multiplex_24"])).structured;
    expect(r.verdict).toBe("incompatible");
    expect(r.conflicts.map((c) => c.kind).sort()).toEqual(["cpu_vs_irq", "sprite_set"]);
  });

  it("side border against raster bars: interrupts inside the region", async () => {
    const r = (await checkCompatibility(["raster_bars", "sideborder_open"])).structured;
    expect(r.verdict).toBe("incompatible");
    expect(r.conflicts[0].kind).toBe("cpu_vs_irq");
    expect(r.conflicts[0].resolution).toMatch(/outside/);
  });

  it("digi playback against FLI", async () => {
    const r = (await checkCompatibility(["digi_4bit", "fli_image"])).structured;
    expect(r.verdict).toBe("incompatible");
    expect(r.conflicts[0].shared).toContain("continuous_interrupts");
  });

  it("KERNAL banked out against a technique that calls the KERNAL", async () => {
    const r = (await checkCompatibility(["ram_under_kernal", "prints_with_kernal"])).structured;
    expect(r.verdict).toBe("incompatible");
    const c = r.conflicts.find((x) => x.kind === "kernal_banked_out");
    expect(c?.shared).toEqual(["CHROUT"]);
  });

  it("two multiplexers or two IRQ users are not flagged by demands alone", async () => {
    const r = (await checkCompatibility(["raster_bars", "sprite_multiplex_24"])).structured;
    expect(r.conflicts.filter((c) => c.severity === "hard")).toEqual([]);
  });

  it("reports what it does not know instead of clearing it", async () => {
    const r = (await checkCompatibility(["mystery_technique", "fli_image"])).structured;
    expect(r.verdict).toBe("compatible");
    const cov = r.data_coverage.find((d) => d.technique === "mystery_technique");
    expect(cov?.found).toBe(true);
    expect(cov?.known).toBe(false);
    const text = (await checkCompatibility(["mystery_technique", "fli_image"])).text;
    expect(text).toMatch(/Not covered/);
    expect(text).toMatch(/mystery_technique/);
  });

  it("names a technique that does not exist", async () => {
    const r = await checkCompatibility(["no_such_thing", "fli_image"]);
    expect(r.structured.data_coverage[0].found).toBe(false);
    expect(r.text).toMatch(/no such technique/);
  });

  it("soft conflicts stay warnings", async () => {
    await f.linkTechniqueUsesRegister("sideborder_open", "D016");
    const r = (await checkCompatibility(["sine_scroller", "sideborder_open"])).structured;
    expect(r.verdict).toBe("warnings");
    expect(r.conflicts.every((c) => c.severity === "soft")).toBe(true);
  });
});

// The REQUIRES closure: prerequisites take part in the check without being
// named, hits are their own kind, and a technique is never reported against
// a prerequisite it declared itself.
describe("checkCompatibility with REQUIRES closure", () => {
  let f: FalkorService;
  beforeAll(async () => {
    f = new FalkorService();
    await f.connect();
    await f.clean();
    await f.ensureSchema();
    for (const [name, category] of [
      ["stable_raster_irq", "raster"], ["text_zoom", "effect"], ["fli_image", "bitmap"],
      ["ifli_image", "bitmap"], ["sid_voice_setup", "music"], ["digi_4bit", "music"],
      ["speech_sample", "music"], ["plain_thing", "effect"], ["ntsc_only_thing", "effect"],
      ["needs_ntsc_thing", "effect"],
    ] as const) {
      await f.addTechnique({ name, title: name, category, complexity: "high" });
    }
    const d = (t: string, r: string) => f.linkTechniqueDemands(t, r, DEMAND_VOCABULARY[r]);
    await d("stable_raster_irq", "midframe_raster_irqs");
    await d("fli_image", "cpu_every_line");
    await d("fli_image", "constant_sprite_set");
    await d("digi_4bit", "continuous_interrupts");
    await f.linkTechniqueRequiresRegion("fli_image", "PAL");
    await f.linkTechniqueRequiresRegion("ntsc_only_thing", "NTSC");
    // text_zoom presupposes the stable IRQ; FLI does not declare it here, so
    // the closure is the only route by which the IRQ's demand reaches FLI.
    await f.linkTechniqueRequires("text_zoom", "stable_raster_irq");
    await f.linkTechniqueRequires("ifli_image", "fli_image");
    await f.linkTechniqueRequires("digi_4bit", "sid_voice_setup");
    await f.linkTechniqueRequires("speech_sample", "digi_4bit");
    await f.linkTechniqueRequires("needs_ntsc_thing", "ntsc_only_thing");
  });
  afterAll(async () => f.close());

  it("reports a prerequisite's demand against the other technique as prerequisite_conflict", async () => {
    const r = await checkCompatibility(["fli_image", "text_zoom"]);
    expect(r.structured.verdict).toBe("incompatible");
    const c = r.structured.conflicts.find((x) => x.kind === "prerequisite_conflict");
    expect(c).toBeDefined();
    expect(c?.severity).toBe("hard");
    expect([c?.a, c?.b].sort()).toEqual(["fli_image", "text_zoom"]);
    expect(c?.via).toEqual(["stable_raster_irq"]);
    expect(c?.shared).toEqual(["cpu_every_line", "midframe_raster_irqs"]);
    expect(c?.rationale).toMatch(/text_zoom requires stable_raster_irq/);
    expect(c?.rationale).toMatch(/fli_image needs every CPU cycle/);
    expect(c?.resolution).toMatch(/outside fli_image's region/);
    // The prerequisite is reported as leaned-on, not as a conflict of its own.
    const mp = r.structured.shared_infrastructure.find((s) => s.kind === "missing_prerequisite");
    expect(mp?.name).toBe("stable_raster_irq");
    expect(mp?.required_by).toEqual(["text_zoom"]);
    expect(r.text).toMatch(/\*\*Via prerequisite\(s\):\*\* stable_raster_irq/);
    expect(r.text).toMatch(/prerequisite, not in the set/);
    // Coverage lists the implied technique and says who implied it.
    const cov = r.structured.data_coverage.find((d) => d.technique === "stable_raster_irq");
    expect(cov?.implied_by).toEqual(["text_zoom"]);
    // fli_image's own demand set is untouched.
    expect(r.structured.data_coverage.find((d) => d.technique === "fli_image")?.demands).toEqual(["constant_sprite_set", "cpu_every_line"]);
  });

  it("walks the chain: a two-step prerequisite still reaches the other technique", async () => {
    const r = (await checkCompatibility(["speech_sample", "fli_image"])).structured;
    const c = r.conflicts.find((x) => x.kind === "prerequisite_conflict");
    expect(c?.via).toEqual(["digi_4bit"]);
    expect(c?.rationale).toMatch(/speech_sample requires digi_4bit/);
    expect(c?.shared).toContain("continuous_interrupts");
    const names = r.shared_infrastructure.filter((s) => s.kind === "missing_prerequisite").map((s) => s.name).sort();
    expect(names).toEqual(["digi_4bit", "sid_voice_setup"]);
  });

  it("applies the region rule through the closure", async () => {
    const r = (await checkCompatibility(["needs_ntsc_thing", "fli_image"])).structured;
    const c = r.conflicts.find((x) => x.kind === "prerequisite_conflict");
    expect(c?.shared).toEqual(["ntsc", "pal"]);
    expect(c?.via).toEqual(["ntsc_only_thing"]);
  });

  it("never reports a technique against a prerequisite it declared itself", async () => {
    // ifli_image requires fli_image; fli_image's cpu_every_line must not be
    // turned against ifli_image, and the pair with a shared prerequisite is
    // left to the named-input rules.
    const r = (await checkCompatibility(["ifli_image", "plain_thing"])).structured;
    expect(r.conflicts.filter((c) => c.kind === "prerequisite_conflict")).toEqual([]);
    expect(r.verdict).toBe("compatible");
    const mp = r.shared_infrastructure.find((s) => s.kind === "missing_prerequisite");
    expect(mp?.name).toBe("fli_image");
    expect(mp?.required_by).toEqual(["ifli_image"]);
  });

  it("a prerequisite that is also named is checked as a named technique, once", async () => {
    const r = (await checkCompatibility(["text_zoom", "stable_raster_irq", "fli_image"])).structured;
    // stable_raster_irq vs fli_image is the input loop's cpu_vs_irq; the
    // closure must not report it a second time under prerequisite_conflict.
    expect(r.conflicts.filter((c) => c.kind === "prerequisite_conflict")).toEqual([]);
    expect(r.conflicts.some((c) => c.kind === "cpu_vs_irq")).toBe(true);
    expect(r.shared_infrastructure.filter((s) => s.kind === "missing_prerequisite")).toEqual([]);
    expect(r.data_coverage.every((d) => d.implied_by === undefined)).toBe(true);
  });

  it("without REQUIRES edges the old behaviour is unchanged", async () => {
    const r = (await checkCompatibility(["plain_thing", "fli_image"])).structured;
    expect(r.verdict).toBe("compatible");
    expect(r.shared_infrastructure).toEqual([]);
    expect(r.data_coverage.map((d) => d.technique)).toEqual(["plain_thing", "fli_image"]);
  });
});

// The shipped docs' shape: ifli_image requires fli_image, fli_image requires
// stable_raster_irq, and the two FLI entries demand cpu_every_line while the
// stable IRQ demands midframe_raster_irqs. Naming the bottom of the chain
// beside the top must not turn the middle technique against the IRQ it
// declared it runs on top of.
describe("checkCompatibility: an implied technique against its own prerequisite", () => {
  let f: FalkorService;
  beforeAll(async () => {
    f = new FalkorService();
    await f.connect();
    await f.clean();
    await f.ensureSchema();
    for (const [name, category] of [
      ["stable_raster_irq", "raster"], ["fli_image", "bitmap"], ["ifli_image", "bitmap"],
      ["raster_bars", "raster"],
    ] as const) {
      await f.addTechnique({ name, title: name, category, complexity: "high" });
    }
    const d = (t: string, r: string) => f.linkTechniqueDemands(t, r, DEMAND_VOCABULARY[r]);
    await d("stable_raster_irq", "midframe_raster_irqs");
    await d("fli_image", "cpu_every_line");
    await d("fli_image", "constant_sprite_set");
    await d("ifli_image", "cpu_every_line");
    await d("ifli_image", "constant_sprite_set");
    await d("raster_bars", "midframe_raster_irqs");
    await f.linkTechniqueRequires("fli_image", "stable_raster_irq");
    await f.linkTechniqueRequires("ifli_image", "fli_image");
  });
  afterAll(async () => f.close());

  it("never reports the middle of a chain against the prerequisite at its end", async () => {
    for (const inputs of [["ifli_image", "stable_raster_irq"], ["stable_raster_irq", "ifli_image"]]) {
      const r = (await checkCompatibility(inputs)).structured;
      // fli_image declared stable_raster_irq itself; it is not turned against it.
      expect(r.conflicts.filter((c) => c.kind === "prerequisite_conflict")).toEqual([]);
      // The named pair is still the named pair's business.
      const named = r.conflicts.filter((c) => c.kind === "cpu_vs_irq");
      expect(named).toHaveLength(1);
      expect([named[0].a, named[0].b].sort()).toEqual(["ifli_image", "stable_raster_irq"]);
      expect(r.verdict).toBe("incompatible");
      // The implied technique is still reported as leaned on.
      const mp = r.shared_infrastructure.filter((s) => s.kind === "missing_prerequisite");
      expect(mp.map((s) => s.name)).toEqual(["fli_image"]);
      expect(mp[0].required_by).toEqual(["ifli_image"]);
    }
  });

  it("still reports the implied technique against something off its chain", async () => {
    // raster_bars is on nobody's REQUIRES chain, so fli_image's cpu_every_line
    // against its mid-frame interrupts is a real prerequisite_conflict.
    const r = (await checkCompatibility(["ifli_image", "raster_bars"])).structured;
    const pc = r.conflicts.filter((c) => c.kind === "prerequisite_conflict");
    expect(pc.length).toBeGreaterThan(0);
    expect(pc.every((c) => c.via?.join() === "fli_image")).toBe(true);
    expect(pc[0].rationale).toMatch(/ifli_image requires fli_image/);
    expect(pc[0].shared).toEqual(["cpu_every_line", "midframe_raster_irqs"]);
  });
});

describe("extractor: **Demands:** lines", () => {
  const doc = `---
category: raster
chip: VIC-II
---

<!-- doc-type: technique-reference -->

## thing_one — Thing one

**Complexity:** high
**Region:** both
**Uses registers:** D016
**Demands:** cpu_every_line, constant_sprite_set

### Why

## thing_two — Thing two

**Complexity:** low
**Region:** both
**Demands:** not_a_real_demand

### Why
`;
  it("emits one technique_demands entity per known word and drops unknown ones", () => {
    const ents = extractGraphEntities(doc, "techniques/test.md");
    const demands = ents.filter((e) => e.type === "technique_demands") as Array<{ technique: string; resource: string }>;
    expect(demands.map((d) => `${d.technique}:${d.resource}`).sort()).toEqual([
      "thing_one:constant_sprite_set",
      "thing_one:cpu_every_line",
    ]);
  });
});

describe("extractor: recipe load addresses", () => {
  const doc = `---
recipe: t
toolchain: kickassembler
output_format: PRG
region: both
techniques: []
file_formats: [PRG]
uses_registers: []
uses_kernal: []
---

<!-- doc-type: recipe -->

\`\`\`asm
* = $0900
start: rts
* = $2000
data: .byte 0
\`\`\`
`;
  it("emits recipe_occupies for each origin", () => {
    const ents = extractGraphEntities(doc, "recipes/kickassembler/t.md");
    const occ = ents.filter((e) => e.type === "recipe_occupies") as Array<{ start: number; end: number }>;
    expect(occ.map((o) => o.start)).toEqual([0x0900, 0x2000]);
  });
});
