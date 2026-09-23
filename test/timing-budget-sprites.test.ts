import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { FalkorService } from "../src/services/falkor.js";
import { timingBudget, spriteDmaCycles, techniqueLookup } from "../src/tools/query.js";
import { extractGraphEntities } from "../src/graph/extract.js";

// Sprite DMA in c64_timing_budget (schema 24). The figures are the measured
// ones in docs/hardware/vic-ii-reference.md, "Sprite DMA": 5 cycles for one
// sprite, 19 for eight, 3 + 2n for sprites numbered without gaps.
describe("spriteDmaCycles", () => {
  it("matches the measured points", () => {
    expect(spriteDmaCycles(0)).toBe(0);
    expect(spriteDmaCycles(1)).toBe(5);
    expect(spriteDmaCycles(8)).toBe(19);
  });
});

describe("sprites_per_line cost key", () => {
  const doc = (cost: string) => `---
category: sprite
chip: VIC-II
---

<!-- doc-type: technique-reference -->

## sprite_thing — A sprite thing

**Complexity:** low
**Cost:** ${cost}
**Cost basis:** arithmetic

Body.
`;
  it("is read onto the technique's cost", () => {
    const t = extractGraphEntities(doc("cycles_per_frame=100, sprites_per_line=8"), "techniques/sprite.md")
      .find((e) => e.type === "technique");
    expect(t && t.type === "technique" ? t.cost : null).toEqual({ cycles_per_frame: 100, sprites_per_line: 8 });
  });

  it("refuses more than eight", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const t = extractGraphEntities(doc("cycles_per_frame=100, sprites_per_line=9"), "techniques/sprite.md")
        .find((e) => e.type === "technique");
      expect(t && t.type === "technique" ? t.cost : null).toEqual({ cycles_per_frame: 100 });
      expect(warn.mock.calls.some((c) => String(c[0]).includes("hardware maximum"))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("timingBudget with sprite DMA", () => {
  let f: FalkorService;
  beforeAll(async () => {
    f = new FalkorService();
    await f.connect();
    await f.clean();
    await f.ensureSchema();
    await f.addTechnique({ name: "plain_split", title: "plain", category: "raster", complexity: "low" });
    await f.addTechnique({
      name: "eight_sprite_band", title: "eight", category: "sprite", complexity: "high",
      cost: { cycles_per_frame: 700, sprites_per_line: 8 }, cost_basis: "estimated",
    });
  });
  afterAll(async () => f.close());

  it("without a sprite figure it counts none and says so", async () => {
    const r = await timingBudget({ technique: "plain_split", region: "pal" });
    expect(r.structured.sprites_per_line).toBe(0);
    expect(r.structured.sprites_source).toBe("none");
    expect(r.structured.sprite_dma_cycles).toBe(0);
    expect(r.structured.user_cycles_per_line_normal).toBe(63 - 36);
    expect(r.structured.notes.join(" ")).toMatch(/Sprite DMA: not counted/);
  });

  it("subtracts the technique's own sprites_per_line", async () => {
    const r = await timingBudget({ technique: "eight_sprite_band", region: "pal" });
    expect(r.structured.sprites_source).toBe("technique");
    expect(r.structured.sprite_dma_cycles).toBe(19);
    expect(r.structured.user_cycles_per_line_normal).toBe(63 - 36 - 19);
    expect(r.structured.user_cycles_per_line_badline).toBe(0);
    expect(r.text).toContain("| Sprite DMA cycles | 19 |");
    // Without the IRQ entry: 63 - 19 = 44 on a normal line, 63 - 43 - 19 = 1
    // on a badline (cpu-cycle-tricks.md measures 4 with the 3 write-only).
    expect(r.structured.notes.join(" ")).toMatch(/leaves 44 cycles, a badline 1/);
  });

  it("the request's figure overrides the technique's, on NTSC too", async () => {
    const r = await timingBudget({ technique: "eight_sprite_band", region: "ntsc", sprites_per_line: 1 });
    expect(r.structured.sprites_source).toBe("input");
    expect(r.structured.sprite_dma_cycles).toBe(5);
    expect(r.structured.user_cycles_per_line_normal).toBe(65 - 36 - 5);
    const z = await timingBudget({ technique: "eight_sprite_band", region: "pal", sprites_per_line: 0 });
    expect(z.structured.sprite_dma_cycles).toBe(0);
    expect(z.structured.user_cycles_per_line_normal).toBe(27);
  });

  it("technique_lookup returns the figure in cost", async () => {
    const t = await techniqueLookup("eight_sprite_band");
    expect(t.structured.cost?.sprites_per_line).toBe(8);
  });
});
