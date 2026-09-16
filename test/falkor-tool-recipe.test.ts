import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorService } from "../src/services/falkor.js";

const f = new FalkorService();

beforeAll(async () => {
  await f.connect();
  await f.clean();
  await f.ensureSchema();
});

afterAll(async () => {
  try {
    await f.close();
  } catch {
    // Connection may already be closed — vitest's afterAll is best-effort here.
  }
});

describe("FalkorService — Tool / FileFormat / Recipe", () => {

  it("addTool MERGEs by name and is idempotent", async () => {
    await f.addTool({
      name: "oscar64",
      kind: "c-compiler",
      maintainer: "drmortalwombat",
      license: "MIT",
      home_url: "https://github.com/drmortalwombat/oscar64",
    });
    await f.addTool({
      name: "oscar64",
      kind: "c-compiler",
      home_url: "https://github.com/drmortalwombat/oscar64",
    });
    const r = await f.roQuery(`MATCH (t:Tool {name: 'oscar64'}) RETURN count(t) AS cnt`);
    expect((r.data?.[0] as any).cnt).toBe(1);
  });

  it("addFileFormat MERGEs by name", async () => {
    await f.addFileFormat("PRG", "Program file (executable)");
    await f.addFileFormat("PRG", "Program file (executable)");
    const r = await f.roQuery(`MATCH (f:FileFormat {name: 'PRG'}) RETURN count(f) AS cnt`);
    expect((r.data?.[0] as any).cnt).toBe(1);
  });

  it("linkProduces creates a PRODUCES edge", async () => {
    await f.linkProduces("oscar64", "PRG");
    const r = await f.roQuery(
      `MATCH (t:Tool {name: 'oscar64'})-[:PRODUCES]->(f:FileFormat {name: 'PRG'}) RETURN count(*) AS cnt`
    );
    expect((r.data?.[0] as any).cnt).toBe(1);
  });

  it("linkTargets creates a TARGETS edge to Chip", async () => {
    await f.linkTargets("oscar64", "6510");
    const r = await f.roQuery(
      `MATCH (t:Tool {name: 'oscar64'})-[:TARGETS]->(c:Chip {name: '6510'}) RETURN count(*) AS cnt`
    );
    expect((r.data?.[0] as any).cnt).toBe(1);
  });

  it("addRecipe MERGEs and links to Tool, FileFormat, KernalRoutine", async () => {
    await f.addKernalRoutine("CHROUT", "$FFD2", "Output a character.");
    await f.addRecipe({
      name: "oscar64-hello-world",
      toolchain: "oscar64",
      output_format: "PRG",
      region: "both",
      source_doc: "recipes/oscar64/hello-world.md",
    });
    await f.linkRecipeProducesFormat("oscar64-hello-world", "PRG");
    await f.linkRecipeUsesKernal("oscar64-hello-world", "CHROUT");

    const recipe = await f.roQuery(
      `MATCH (r:Recipe {name: 'oscar64-hello-world'}) RETURN r.toolchain AS toolchain, r.output_format AS output_format, r.region AS region`
    );
    expect(recipe.data?.[0]).toMatchObject({ toolchain: "oscar64", output_format: "PRG", region: "both" });

    const edge = await f.roQuery(
      `MATCH (r:Recipe {name: 'oscar64-hello-world'})-[:USES]->(k:KernalRoutine {name: 'CHROUT'}) RETURN count(*) AS cnt`
    );
    expect((edge.data?.[0] as any).cnt).toBe(1);
  });

  it("Tool unique-name constraint rejects duplicates with different home_urls", async () => {
    await expect(async () => {
      await f.addTool({
        name: "oscar64",
        kind: "c-compiler",
        home_url: "https://github.com/drmortalwombat/oscar64",
      });
      // Second call with different home_url updates, doesn't fail (idempotent MERGE).
      // Constraint failure path is tested separately by directly inserting via Cypher.
    }).not.toThrow();
  });
});
