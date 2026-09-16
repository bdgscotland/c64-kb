import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorService } from "../src/services/falkor.js";
import { techniqueLookup, techniquesFor } from "../src/tools/query.js";

describe("techniqueLookup", () => {
  let f: FalkorService;
  beforeAll(async () => {
    f = new FalkorService();
    await f.connect();
    await f.clean();
    await f.ensureSchema();
    await f.addTechnique({
      name: "stable_raster_irq",
      title: "Stable raster IRQ",
      category: "raster",
      complexity: "medium",
    });
    await f.addRegister("D011", "$D011", "VIC-II", "RW", []);
    await f.linkTechniqueUsesRegister("stable_raster_irq", "D011");
  });
  afterAll(async () => f.close());

  it("returns Technique metadata + USES edges", async () => {
    const r = await techniqueLookup("stable_raster_irq");
    expect(r.structured.name).toBe("stable_raster_irq");
    expect(r.structured.category).toBe("raster");
    expect(r.structured.uses_registers.map((x) => x.name)).toContain("D011");
  });

  it("returns suggestions when not found", async () => {
    const r = await techniqueLookup("stable_raster");
    expect(r.structured.name).toBe("");
    expect(r.text).toContain("stable_raster_irq");
  });
});

describe("techniquesFor", () => {
  let f: FalkorService;
  beforeAll(async () => {
    f = new FalkorService();
    await f.connect();
    await f.clean();
    await f.ensureSchema();
    await f.addTechnique({
      name: "stable_raster_irq",
      title: "Stable raster IRQ",
      category: "raster",
      complexity: "medium",
    });
    await f.addTechnique({
      name: "raster_bars",
      title: "Raster bars",
      category: "raster",
      complexity: "low",
    });
    await f.addTechnique({
      name: "soft_scroll_h",
      title: "Horizontal soft scroll",
      category: "scroll",
      complexity: "low",
    });
  });
  afterAll(async () => f.close());

  it("filters by category", async () => {
    const r = await techniquesFor({ category: "raster" });
    expect(r.structured.techniques.length).toBeGreaterThan(0);
    expect(r.structured.techniques.every((t) => t.category === "raster")).toBe(true);
  });

  it("returns all techniques when no filter", async () => {
    const r = await techniquesFor({});
    expect(r.structured.techniques.length).toBeGreaterThanOrEqual(3);
  });

  it("returns empty for unknown category", async () => {
    const r = await techniquesFor({ category: "nonexistent_category" });
    expect(r.structured.techniques.length).toBe(0);
  });
});
