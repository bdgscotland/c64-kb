import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorService } from "../src/services/falkor.js";
import { checkCompatibility } from "../src/tools/query.js";
import { extractGraphEntities, DEMAND_VOCABULARY } from "../src/graph/extract.js";

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
