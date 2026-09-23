import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorService } from "../src/services/falkor.ts";

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
      `MATCH (t:Technique {name: 'stable_raster_irq'})-[:USES]->(reg:Register {name: 'D011'}) RETURN count(*) AS n`,
    );
    expect((r.data?.[0] as { n: number }).n).toBe(1);
  });

  it("linkTechniqueRequiresRegion creates REQUIRES_REGION edge", async () => {
    await f.linkTechniqueRequiresRegion("stable_raster_irq", "PAL");
    const r = await f.roQuery(
      `MATCH (t:Technique {name: 'stable_raster_irq'})-[:REQUIRES_REGION]->(reg:Region {name: 'PAL'}) RETURN count(*) AS n`,
    );
    expect((r.data?.[0] as { n: number }).n).toBe(1);
  });

  it("linkTechniqueBelongsTo creates BELONGS_TO edge", async () => {
    await f.linkTechniqueBelongsTo("stable_raster_irq", "VIC-II");
    const r = await f.roQuery(
      `MATCH (t:Technique {name: 'stable_raster_irq'})-[:BELONGS_TO]->(c:Chip {name: 'VIC-II'}) RETURN count(*) AS n`,
    );
    expect((r.data?.[0] as { n: number }).n).toBe(1);
  });

  it("linkTechniqueUsesKernal creates USES edge", async () => {
    await f.addKernalRoutine("CINT", "$FF81", "Init screen editor.");
    await f.linkTechniqueUsesKernal("stable_raster_irq", "CINT");
    const r = await f.roQuery(
      `MATCH (t:Technique {name: 'stable_raster_irq'})-[:USES]->(k:KernalRoutine {name: 'CINT'}) RETURN count(*) AS n`,
    );
    expect((r.data?.[0] as { n: number }).n).toBe(1);
  });
});

describe("FalkorService - Technique REQUIRES", () => {
  let f: FalkorService;
  const warnings: string[] = [];
  const origWarn = console.warn;
  beforeAll(async () => {
    f = new FalkorService();
    await f.connect();
    await f.clean();
    await f.ensureSchema();
    for (const name of ["stable_raster_irq", "fli_image", "ifli_image", "text_zoom"]) {
      await f.addTechnique({ name, title: name, category: "raster", complexity: "high" });
    }
    console.warn = (msg: string) => {
      warnings.push(String(msg));
    };
  });
  afterAll(async () => {
    console.warn = origWarn;
    await f.close();
  });

  const count = async (a: string, b: string): Promise<number> => {
    const r = await f.roQuery(
      `MATCH (a:Technique {name: $a})-[:REQUIRES]->(b:Technique {name: $b}) RETURN count(*) AS n`,
      { a, b },
    );
    return Number((r.data?.[0] as { n: number }).n);
  };

  it("creates a REQUIRES edge between two existing techniques and is idempotent", async () => {
    expect(await f.linkTechniqueRequires("fli_image", "stable_raster_irq")).toBe(true);
    expect(await f.linkTechniqueRequires("fli_image", "stable_raster_irq")).toBe(true);
    expect(await count("fli_image", "stable_raster_irq")).toBe(1);
  });

  it("MATCHes both ends: a missing target drops the edge and creates no stub", async () => {
    expect(await f.linkTechniqueRequires("text_zoom", "no_such_technique")).toBe(false);
    const stub = await f.roQuery(`MATCH (t:Technique {name: 'no_such_technique'}) RETURN count(t) AS n`);
    expect(Number((stub.data?.[0] as { n: number }).n)).toBe(0);
    expect(warnings.some((w) => w.includes("text_zoom -> no_such_technique") && w.includes("dropped"))).toBe(
      true,
    );
  });

  it("refuses an edge that would close a cycle, directly or through a chain", async () => {
    expect(await f.linkTechniqueRequires("ifli_image", "fli_image")).toBe(true);
    // stable_raster_irq -> fli_image would make fli_image -> stable_raster_irq -> fli_image
    expect(await f.linkTechniqueRequires("stable_raster_irq", "fli_image")).toBe(false);
    // stable_raster_irq -> ifli_image would close the three-step loop
    expect(await f.linkTechniqueRequires("stable_raster_irq", "ifli_image")).toBe(false);
    expect(await count("stable_raster_irq", "fli_image")).toBe(0);
    expect(await count("stable_raster_irq", "ifli_image")).toBe(0);
    expect(warnings.filter((w) => w.includes("would close a cycle")).length).toBeGreaterThanOrEqual(2);
  });

  it("refuses a self-reference", async () => {
    expect(await f.linkTechniqueRequires("text_zoom", "text_zoom")).toBe(false);
    expect(await count("text_zoom", "text_zoom")).toBe(0);
  });
});
