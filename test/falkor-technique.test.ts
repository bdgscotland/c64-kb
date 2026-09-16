import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorService } from "../src/services/falkor.js";

describe("FalkorService - Technique + REQUIRES_REGION", () => {
  let f: FalkorService;
  beforeAll(async () => {
    f = new FalkorService();
    await f.connect();
    await f.clean();
    await f.ensureSchema();
  });
  afterAll(async () => {
    await f.close();
  });

  it("addTechnique MERGEs by name and is idempotent", async () => {
    await f.addTechnique({
      name: "stable_raster_irq",
      title: "Stable raster IRQ",
      category: "raster",
      complexity: "medium",
    });
    await f.addTechnique({
      name: "stable_raster_irq",
      title: "Stable raster IRQ",
      category: "raster",
      complexity: "medium",
    });
    const r = await f.roQuery(`MATCH (t:Technique {name: 'stable_raster_irq'}) RETURN count(t) AS n`);
    expect((r.data?.[0] as { n: number }).n).toBe(1);
  });

  it("linkTechniqueUsesRegister creates USES edge", async () => {
    await f.addRegister("D011", "$D011", "VIC-II", "RW", ["SCROLY"]);
    await f.linkTechniqueUsesRegister("stable_raster_irq", "D011");
    const r = await f.roQuery(
      `MATCH (t:Technique {name: 'stable_raster_irq'})-[:USES]->(reg:Register {name: 'D011'}) RETURN count(*) AS n`
    );
    expect((r.data?.[0] as { n: number }).n).toBe(1);
  });

  it("linkTechniqueRequiresRegion creates REQUIRES_REGION edge", async () => {
    await f.linkTechniqueRequiresRegion("stable_raster_irq", "PAL");
    const r = await f.roQuery(
      `MATCH (t:Technique {name: 'stable_raster_irq'})-[:REQUIRES_REGION]->(reg:Region {name: 'PAL'}) RETURN count(*) AS n`
    );
    expect((r.data?.[0] as { n: number }).n).toBe(1);
  });

  it("linkTechniqueBelongsTo creates BELONGS_TO edge", async () => {
    await f.linkTechniqueBelongsTo("stable_raster_irq", "VIC-II");
    const r = await f.roQuery(
      `MATCH (t:Technique {name: 'stable_raster_irq'})-[:BELONGS_TO]->(c:Chip {name: 'VIC-II'}) RETURN count(*) AS n`
    );
    expect((r.data?.[0] as { n: number }).n).toBe(1);
  });

  it("linkTechniqueUsesKernal creates USES edge", async () => {
    await f.addKernalRoutine("CINT", "$FF81", "Init screen editor.");
    await f.linkTechniqueUsesKernal("stable_raster_irq", "CINT");
    const r = await f.roQuery(
      `MATCH (t:Technique {name: 'stable_raster_irq'})-[:USES]->(k:KernalRoutine {name: 'CINT'}) RETURN count(*) AS n`
    );
    expect((r.data?.[0] as { n: number }).n).toBe(1);
  });
});
