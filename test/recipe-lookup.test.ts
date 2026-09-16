import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorService } from "../src/services/falkor.js";
import { recipeLookup, recipesFor } from "../src/tools/query.js";

describe("recipeLookup", () => {
  let f: FalkorService;
  beforeAll(async () => {
    f = new FalkorService();
    await f.connect();
    await f.clean();
    await f.ensureSchema();
    await f.addTool({ name: "oscar64", kind: "c-compiler", home_url: "https://github.com/drmortalwombat/oscar64" });
    await f.addRecipe({
      name: "oscar64-hello-world",
      toolchain: "oscar64",
      output_format: "PRG",
      region: "both",
      source_doc: "recipes/oscar64/hello-world.md",
    });
  });
  afterAll(async () => {
    await f.close();
  });

  it("finds a recipe by canonical name", async () => {
    const r = await recipeLookup("oscar64-hello-world");
    expect(r.structured.name).toBe("oscar64-hello-world");
    expect(r.structured.toolchain).toBe("oscar64");
    expect(r.structured.region).toBe("both");
  });

  it("returns helpful suggestions when not found", async () => {
    const r = await recipeLookup("oscar64-hello");
    expect(r.structured.name).toBe("");
    expect(r.text).toContain("oscar64-hello-world");
  });
});

describe("recipesFor", () => {
  it("lists recipes by toolchain", async () => {
    const r = await recipesFor({ toolchain: "oscar64" });
    expect(r.structured.recipes.length).toBeGreaterThan(0);
    expect(r.structured.recipes[0].toolchain).toBe("oscar64");
  });

  it("lists recipes by region", async () => {
    const r = await recipesFor({ region: "both" });
    expect(r.structured.recipes.length).toBeGreaterThan(0);
  });
});
