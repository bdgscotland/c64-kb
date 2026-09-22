import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { FalkorService } from "../src/services/falkor.js";
import { getQdrant } from "../src/context.js";
import { ingestDoc } from "../src/tools/hydrate.js";
import { toolchainHint } from "../src/tools/query.js";

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
    await f.addTool({ name: "oscar64", kind: "c-compiler", home_url: "https://github.com/drmortalwombat/oscar64" });
    await f.addTool({ name: "kickassembler", kind: "assembler", home_url: "http://theweb.dk/KickAssembler/" });
    await f.addTool({ name: "cc65", kind: "c-compiler", home_url: "https://cc65.github.io/" });
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
});
