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
    await f.linkRecipeUsesTool("oscar64-hello-world", "oscar64");

    const recipe = await f.roQuery(
      `MATCH (r:Recipe {name: 'oscar64-hello-world'}) RETURN r.toolchain AS toolchain, r.output_format AS output_format, r.region AS region`
    );
    expect(recipe.data?.[0]).toMatchObject({ toolchain: "oscar64", output_format: "PRG", region: "both" });

    const edge = await f.roQuery(
      `MATCH (r:Recipe {name: 'oscar64-hello-world'})-[:USES]->(k:KernalRoutine {name: 'CHROUT'}) RETURN count(*) AS cnt`
    );
    expect((edge.data?.[0] as any).cnt).toBe(1);

    // The recipe-to-tool link carries the ontology's name, REQUIRES_TOOL; it
    // was written as USES until data 713, which left REQUIRES_TOOL empty.
    const tool = await f.roQuery(
      `MATCH (r:Recipe {name: 'oscar64-hello-world'})-[:REQUIRES_TOOL]->(t:Tool {name: 'oscar64'}) RETURN count(*) AS cnt`
    );
    expect((tool.data?.[0] as any).cnt).toBe(1);
    const wrong = await f.roQuery(
      `MATCH (r:Recipe {name: 'oscar64-hello-world'})-[:USES]->(t:Tool) RETURN count(*) AS cnt`
    );
    expect((wrong.data?.[0] as any).cnt).toBe(0);
  });

  it("a second addTool with a different home_url updates rather than failing", async () => {
    // The unique constraint is on Tool.name, so the MERGE updates in place.
    // The constraint failure path is covered separately by a direct Cypher insert.
    await f.addTool({
      name: "oscar64",
      kind: "c-compiler",
      home_url: "https://example.com/oscar64-moved",
    });
    const r = await f.roQuery(
      `MATCH (t:Tool {name: 'oscar64'}) RETURN count(t) AS cnt, collect(t.home_url)[0] AS url`
    );
    const row = r.data?.[0] as any;
    expect(row.cnt).toBe(1);
    expect(row.url).toBe("https://example.com/oscar64-moved");
  });
});
