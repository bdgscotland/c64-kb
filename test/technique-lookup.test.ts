import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorService } from "../src/services/falkor.ts";
import { techniqueLookup, techniquesFor } from "../src/tools/query.ts";

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
    // REQUIRES in both directions, and a pitfall this technique is the Fix for.
    await f.addTechnique({ name: "text_zoom", title: "Text zoom", category: "effect", complexity: "high" });
    await f.addTechnique({
      name: "double_irq",
      title: "Double IRQ",
      category: "raster",
      complexity: "scene-tier",
      cost: { cycles_per_frame: 160, lines_active: 2, irq_slots: 2 },
      cost_basis: "arithmetic",
    });
    await f.addTechnique({
      name: "raster_bars",
      title: "Raster bars",
      category: "raster",
      complexity: "low",
      cost: { cycles_per_frame: 1471, bytes_code: 577, bytes_data: 33 },
      cost_basis: "measured-vice",
      cost_bytes_basis: "derived-listing",
    });
    await f.linkTechniqueRequires("text_zoom", "stable_raster_irq");
    await f.addPitfall({
      name: "raster_irq_first_line_jitter",
      title: "First raster IRQ jitters",
      severity: "high",
      region: "both",
      category: "raster",
    });
    await f.linkMitigatedBy("raster_irq_first_line_jitter", "stable_raster_irq");
    await f.linkMitigatedBy("raster_irq_first_line_jitter", "double_irq");
  });
  afterAll(async () => f.close());

  it("returns the cost object only for a technique whose page carried a Cost line", async () => {
    const withCost = await techniqueLookup("double_irq");
    expect(withCost.structured.cost).toEqual({
      cycles_per_frame: 160,
      lines_active: 2,
      irq_slots: 2,
      basis: "arithmetic",
    });
    expect(withCost.text).toContain("**Cost:** cycles_per_frame=160, lines_active=2, irq_slots=2");
    expect(withCost.text).toContain("**Cost basis:** arithmetic");
    const without = await techniqueLookup("text_zoom");
    expect(without.structured.cost).toBeUndefined();
  });

  it("returns a Cost bytes basis apart from the Cost basis when the page states one (#72)", async () => {
    const r = await techniqueLookup("raster_bars");
    expect(r.structured.cost).toEqual({
      cycles_per_frame: 1471,
      bytes_code: 577,
      bytes_data: 33,
      basis: "measured-vice",
      bytes_basis: "derived-listing",
    });
    expect(r.text).toContain("**Cost basis:** measured-vice\n**Cost bytes basis:** derived-listing\n");
    const one = await techniqueLookup("double_irq");
    expect(one.text).not.toContain("Cost bytes basis");
  });

  it("returns Technique metadata + USES edges", async () => {
    const r = await techniqueLookup("stable_raster_irq");
    expect(r.structured.name).toBe("stable_raster_irq");
    expect(r.structured.category).toBe("raster");
    expect(r.structured.uses_registers.map((x) => x.name)).toContain("D011");
  });

  it("reports REQUIRES in both directions and the pitfalls it mitigates", async () => {
    const zoom = await techniqueLookup("text_zoom");
    expect(zoom.structured.requires).toEqual([{ name: "stable_raster_irq", title: "Stable raster IRQ" }]);
    expect(zoom.structured.required_by).toEqual([]);
    expect(zoom.structured.mitigates).toEqual([]);
    expect(zoom.text).toMatch(/\*\*Requires:\*\* stable_raster_irq/);
    expect(zoom.text).not.toMatch(/Required by/);

    const irq = await techniqueLookup("stable_raster_irq");
    expect(irq.structured.requires).toEqual([]);
    expect(irq.structured.required_by).toEqual([{ name: "text_zoom", title: "Text zoom" }]);
    expect(irq.structured.mitigates).toEqual([
      { name: "raster_irq_first_line_jitter", title: "First raster IRQ jitters", severity: "high" },
    ]);
    expect(irq.text).toMatch(/\*\*Required by:\*\* text_zoom/);
    expect(irq.text).toMatch(/\*\*Mitigates:\*\* raster_irq_first_line_jitter \(high\)/);
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
    await f.addTechnique({
      name: "infinite_scroll_h",
      title: "Infinite scroll",
      category: "scroll",
      complexity: "medium",
    });
    await f.addTechnique({
      name: "parallax_dual_layer",
      title: "Parallax",
      category: "scroll",
      complexity: "high",
    });
    await f.linkTechniqueRequires("infinite_scroll_h", "soft_scroll_h");
    await f.linkTechniqueRequires("parallax_dual_layer", "infinite_scroll_h");
    // Named as the live graph names it: SCROLY at $D011, alias D011.
    await f.addRegister("SCROLY", "$D011", "VIC-II", "RW", ["D011"]);
    await f.linkTechniqueUsesRegister("stable_raster_irq", "SCROLY");
    await f.linkTechniqueUsesRegister("raster_bars", "SCROLY");
  });
  afterAll(async () => f.close());

  it("filters by register name, alias or address, in any case (#41)", async () => {
    for (const register of ["D011", "$D011", "d011", "0xD011", "SCROLY", "scroly"]) {
      const r = await techniquesFor({ register });
      expect(r.structured.techniques.map((t) => t.name).sort(), register).toEqual([
        "raster_bars",
        "stable_raster_irq",
      ]);
    }
    expect((await techniquesFor({ register: "D016" })).structured.techniques).toEqual([]);
    const both = await techniquesFor({ register: "D011", category: "raster" });
    expect(both.structured.techniques).toHaveLength(2);
  });

  it("filters by requires, following the chain", async () => {
    const r = await techniquesFor({ requires: "soft_scroll_h" });
    expect(r.structured.techniques.map((t) => t.name).sort()).toEqual([
      "infinite_scroll_h",
      "parallax_dual_layer",
    ]);
    expect(r.structured.filter.requires).toBe("soft_scroll_h");
    const none = await techniquesFor({ requires: "parallax_dual_layer" });
    expect(none.structured.techniques).toEqual([]);
  });

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
