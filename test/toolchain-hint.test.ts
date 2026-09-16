import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorService } from "../src/services/falkor.js";
import { toolchainHint } from "../src/tools/query.js";

describe("toolchainHint", () => {
  let f: FalkorService;
  beforeAll(async () => {
    f = new FalkorService();
    await f.connect();
    await f.clean();
    await f.ensureSchema();
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
