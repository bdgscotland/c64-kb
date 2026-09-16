import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { coverage } from "../src/tools/selfimprovement.js";
import { FalkorService } from "../src/services/falkor.js";

const f = new FalkorService();

beforeAll(async () => {
  await f.connect();
  await f.clean();
  await f.ensureSchema();
  await f.addTechnique({ name: "tech_a", title: "A", category: "raster", complexity: "low" });
  await f.addTechnique({ name: "tech_b", title: "B", category: "sprite", complexity: "medium" });
});

afterAll(async () => {
  try { await f.close(); } catch { /* expected */ }
});

describe("c64_coverage", () => {
  it("returns structured coverage with all expected fields", async () => {
    const r = await coverage();
    expect(r.structured.totals.falkor_nodes).toBeGreaterThanOrEqual(2);
    expect(r.structured.dimensions.technique_categories.length).toBeGreaterThan(0);
    expect(Array.isArray(r.structured.recent_gaps)).toBe(true);
    expect(r.structured.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("emits text with markdown headings", async () => {
    const r = await coverage();
    expect(r.text).toContain("# c64-kb Coverage Snapshot");
    expect(r.text).toContain("## Totals");
    expect(r.text).toContain("## Technique categories");
  });
});
