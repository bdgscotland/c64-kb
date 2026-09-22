import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { FalkorService } from "../src/services/falkor.js";
import { getQdrant } from "../src/context.js";
import { ingestDoc } from "../src/tools/hydrate.js";
import { pitfallsFor } from "../src/tools/pitfalls.js";

describe("pitfallsFor", () => {
  let f: FalkorService;

  beforeAll(async () => {
    f = new FalkorService();
    await f.connect();
    await f.clean();
    await f.ensureSchema();

    // The search fallback reads the (isolated, see vitest.config.ts) Qdrant
    // collection, so seed it with the one doc the fallback test needs
    // instead of relying on whatever a previous ingest left in the live one.
    const q = await getQdrant();
    await q.ensureCollection();
    const rel = "pitfalls/raster-and-badline.md";
    const seeded = await ingestDoc(rel, readFileSync(new URL(`../docs/${rel}`, import.meta.url), "utf8"));
    if (/not available/i.test(seeded)) throw new Error(`test collection could not be seeded: ${seeded}`);

    // Seed the registers and techniques needed for TRIGGERED_BY edges
    await f.addRegister("D011", "$D011", "VIC-II", "RW", ["SCROLY"]);
    await f.addRegister("D012", "$D012", "VIC-II", "RW", ["RASTER"]);
    await f.addTechnique({ name: "stable_raster_irq", title: "Stable raster IRQ", category: "raster", complexity: "medium" });
    await f.addTechnique({ name: "sprite_multiplex_8", title: "8-sprite multiplexer", category: "sprite", complexity: "high" });

    // Seed pitfalls triggered by D012 and stable_raster_irq
    await f.addPitfall({ name: "badline_cycle_loss", title: "Badline DMA steals 40-43 cycles from the CPU", severity: "critical", region: "both", category: "raster" });
    await f.linkTriggeredBy("badline_cycle_loss", "D011", "Register");
    await f.linkTriggeredBy("badline_cycle_loss", "D012", "Register");
    await f.linkTriggeredBy("badline_cycle_loss", "stable_raster_irq", "Technique");
    await f.linkTriggeredBy("badline_cycle_loss", "sprite_multiplex_8", "Technique");

    await f.addPitfall({ name: "d012_wrap_around", title: "$D012 wraps at line 255; bit 7 of $D011 holds the 9th bit", severity: "high", region: "both", category: "raster" });
    await f.linkTriggeredBy("d012_wrap_around", "D011", "Register");
    await f.linkTriggeredBy("d012_wrap_around", "D012", "Register");
    await f.linkTriggeredBy("d012_wrap_around", "stable_raster_irq", "Technique");

    await f.addPitfall({ name: "raster_irq_first_line_jitter", title: "First raster IRQ after enable has unpredictable entry timing", severity: "high", region: "both", category: "raster" });
    await f.linkTriggeredBy("raster_irq_first_line_jitter", "D011", "Register");
    await f.linkTriggeredBy("raster_irq_first_line_jitter", "D012", "Register");
    await f.linkTriggeredBy("raster_irq_first_line_jitter", "stable_raster_irq", "Technique");
  });

  afterAll(async () => f?.close());

  it("returns pitfalls for a register topic (D012)", async () => {
    const r = await pitfallsFor("D012");
    expect(r.structured.topic_kind).toBe("Register");
    expect(r.structured.pitfalls.length).toBeGreaterThanOrEqual(2);
    const names = r.structured.pitfalls.map(p => p.name);
    expect(names).toContain("d012_wrap_around");
  });

  it("returns pitfalls for a technique topic (stable_raster_irq)", async () => {
    const r = await pitfallsFor("stable_raster_irq");
    expect(r.structured.topic_kind).toBe("Technique");
    expect(r.structured.pitfalls.length).toBeGreaterThanOrEqual(2);
  });

  it("falls back to vector search for an unrecognized topic", async () => {
    const r = await pitfallsFor("how does timing work");
    expect(r.structured.topic_kind).toBe("search");
    expect(Array.isArray(r.structured.pitfalls)).toBe(true);
  });

  it("falls back to Qdrant search when no entity matches", async () => {
    const r = await pitfallsFor("badline timing");
    expect(r.structured.topic_kind).toBe("search");
    expect(r.structured.search_results).toBeDefined();
    expect(r.structured.search_results!.length).toBeGreaterThan(0);
  });
});
