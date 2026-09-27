import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { FalkorService } from "../src/services/falkor.ts";
import { getQdrant } from "../src/context.ts";
import { ingestDoc } from "../src/tools/hydrate.ts";
import { toolchainHint } from "../src/tools/query.ts";

describe("toolchainHint", () => {
  let f: FalkorService;
  beforeAll(async () => {
    f = new FalkorService();
    await f.connect();
    await f.clean();
    await f.ensureSchema();
    // The snippet comes from a Qdrant search over the isolated test
    // collection (vitest.config.ts); seed the doc it is expected to find.
    const q = await getQdrant();
    await q.ensureCollection();
    const rel = "toolchains/oscar64-reference.md";
    const seeded = await ingestDoc(rel, readFileSync(new URL(`../docs/${rel}`, import.meta.url), "utf8"));
    if (/not available/i.test(seeded)) throw new Error(`test collection could not be seeded: ${seeded}`);
    await f.addTool({
      name: "oscar64",
      kind: "c-compiler",
      home_url: "https://github.com/drmortalwombat/oscar64",
    });
    await f.addTool({
      name: "kickassembler",
      kind: "assembler",
      home_url: "http://theweb.dk/KickAssembler/",
    });
    await f.addTool({ name: "cc65", kind: "c-compiler", home_url: "https://cc65.github.io/" });
    // KB-GAPS 8: a technique whose only recipe is KickAssembler, and one
    // with an Oscar64 recipe beside a KickAssembler recipe that also
    // implements it.
    for (const name of ["row_map_redraw", "object_pool", "frame_sync_loop"]) {
      await f.addTechnique({ name, title: name, category: "scroll", complexity: "medium" });
    }
    await f.addRecipe({
      name: "kickassembler-row-map-redraw",
      toolchain: "kickassembler",
      output_format: "PRG",
      region: "both",
      source_doc: "recipes/kickassembler/row-map-redraw.md",
    });
    await f.addRecipe({
      name: "oscar64-object-pool",
      toolchain: "oscar64",
      output_format: "PRG",
      region: "both",
      source_doc: "recipes/oscar64/object-pool.md",
    });
    await f.linkRecipeImplements("kickassembler-row-map-redraw", "row_map_redraw");
    await f.linkRecipeImplements("kickassembler-row-map-redraw", "frame_sync_loop");
    await f.linkRecipeImplements("oscar64-object-pool", "object_pool");
  });
  afterAll(async () => {
    await f.close();
  });

  it("returns the canonical Oscar64 snippet for raster-irq intent", async () => {
    const r = await toolchainHint("oscar64", "raster irq");
    expect(r.structured.toolchain).toBe("oscar64");
    expect(r.text).toMatch(/rasterirq\.h|rirq_/);
  });

  it("biases toward Oscar64 when no toolchain specified", async () => {
    const r = await toolchainHint(undefined, "sprite multiplex");
    expect(r.structured.toolchain).toBe("oscar64");
  });

  it("returns kickassembler snippet when explicitly requested", async () => {
    const r = await toolchainHint("kickassembler", "raster irq");
    expect(r.structured.toolchain).toBe("kickassembler");
  });

  it("gives a technique's recipe listing, in the toolchain of its only recipe (KB-GAPS 8)", async () => {
    const r = await toolchainHint(undefined, "row_map_redraw");
    expect(r.structured.toolchain).toBe("kickassembler");
    expect(r.structured.recipe).toBe("kickassembler-row-map-redraw");
    expect(r.structured.snippet).toMatch(/BasicUpstart2|\*\s*=\s*\$/);
    expect(r.structured.rationale).toMatch(/only recipe.*kickassembler-row-map-redraw/);
    expect(r.text).toContain("```asm");
  });

  it("keeps Oscar64 first when it has a recipe, and reads a spaced intent as the name", async () => {
    const r = await toolchainHint(undefined, "object pool");
    expect(r.structured.toolchain).toBe("oscar64");
    expect(r.structured.recipe).toBe("oscar64-object-pool");
    expect(r.text).toContain("```c");
  });

  it("says so when the requested toolchain has no recipe and another has", async () => {
    const r = await toolchainHint("oscar64", "row_map_redraw");
    expect(r.structured.toolchain).toBe("oscar64");
    expect(r.structured.recipe).toBeUndefined();
    expect(r.structured.rationale).toMatch(/no oscar64 recipe.*kickassembler-row-map-redraw/);
  });
});
