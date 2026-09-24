import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorService } from "../src/services/falkor.ts";
import { recipeLookup, recipesFor } from "../src/tools/query.ts";

describe("recipeLookup", () => {
  let f: FalkorService;
  beforeAll(async () => {
    f = new FalkorService();
    await f.connect();
    await f.clean();
    await f.ensureSchema();
    await f.addTool({
      name: "oscar64",
      kind: "c-compiler",
      home_url: "https://github.com/drmortalwombat/oscar64",
    });
    await f.addRecipe({
      name: "oscar64-hello-world",
      toolchain: "oscar64",
      output_format: "PRG",
      region: "both",
      source_doc: "recipes/oscar64/hello-world.md",
    });
    await f.addRecipe({
      name: "kickassembler-sine-scroller",
      toolchain: "kickassembler",
      output_format: "prg",
      region: "both",
      source_doc: "recipes/kickassembler/sine-scroller.md",
      claims_stated: "stated",
      claims_basis: "measured-vice",
    });
    await f.linkClaims({
      owner: "kickassembler-sine-scroller",
      ownerKind: "Recipe",
      unit: "zero_page",
      mode: "owns",
      ranges: "FB-FE",
      basis: "measured-vice",
    });
    await f.linkClaims({
      owner: "kickassembler-sine-scroller",
      ownerKind: "Recipe",
      unit: "irq_vector_0314",
      mode: "owns",
      basis: "measured-vice",
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

  it("carries the page's Source listing so a caller with no file access can copy the code", async () => {
    const r = await recipeLookup("oscar64-hello-world");
    expect(r.structured.source_code?.language).toBe("c");
    expect(r.structured.source_code?.text).toContain("main");
    expect(r.text).toContain("## Source listing (c, ");
    expect(r.text).toContain("copy as-is");
  });

  it("returns the recipe's own claims (schema 34), and unknown for a page with no claims: key", async () => {
    const r = await recipeLookup("kickassembler-sine-scroller");
    expect(r.structured.claims_stated).toBe("stated");
    expect(r.structured.claims).toEqual([
      { unit: "irq_vector_0314", mode: "owns" },
      { unit: "zero_page", mode: "owns", ranges: "FB-FE" },
    ]);
    expect(r.text).toContain("**Claims:** zero_page $FB-$FE (owns), irq_vector_0314 (owns)");
    const u = await recipeLookup("oscar64-hello-world");
    expect(u.structured.claims_stated).toBe("unknown");
    expect(u.text).toContain("**Claims:** unknown (the page has no claims: key");
  });

  it("re-adding a recipe drops the CLAIMS edges its page stopped making", async () => {
    await f.addRecipe({
      name: "kickassembler-sine-scroller",
      toolchain: "kickassembler",
      output_format: "prg",
      region: "both",
      source_doc: "recipes/kickassembler/sine-scroller.md",
    });
    const r = await recipeLookup("kickassembler-sine-scroller");
    expect(r.structured.claims).toEqual([]);
    expect(r.structured.claims_stated).toBe("unknown");
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
    expect(r.structured.recipes.at(0)?.toolchain).toBe("oscar64");
  });

  it("lists recipes by region", async () => {
    const r = await recipesFor({ region: "both" });
    expect(r.structured.recipes.length).toBeGreaterThan(0);
  });
});
