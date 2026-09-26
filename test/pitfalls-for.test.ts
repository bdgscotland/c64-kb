import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { FalkorService } from "../src/services/falkor.ts";
import { getQdrant } from "../src/context.ts";
import { ingestDoc } from "../src/tools/hydrate.ts";
import { pitfallsFor } from "../src/tools/pitfalls.ts";

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
    await f.addTechnique({
      name: "stable_raster_irq",
      title: "Stable raster IRQ",
      category: "raster",
      complexity: "medium",
    });
    await f.addTechnique({
      name: "sprite_multiplex_8",
      title: "8-sprite multiplexer",
      category: "sprite",
      complexity: "high",
    });

    // Seed pitfalls triggered by D012 and stable_raster_irq
    await f.addPitfall({
      name: "badline_cycle_loss",
      title: "Badline DMA steals 40-43 cycles from the CPU",
      severity: "critical",
      region: "both",
      category: "raster",
    });
    await f.linkTriggeredBy("badline_cycle_loss", "D011", "Register");
    await f.linkTriggeredBy("badline_cycle_loss", "D012", "Register");
    await f.linkTriggeredBy("badline_cycle_loss", "stable_raster_irq", "Technique");
    await f.linkTriggeredBy("badline_cycle_loss", "sprite_multiplex_8", "Technique");

    await f.addPitfall({
      name: "d012_wrap_around",
      title: "$D012 wraps at line 255; bit 7 of $D011 holds the 9th bit",
      severity: "high",
      region: "both",
      category: "raster",
    });
    await f.linkTriggeredBy("d012_wrap_around", "D011", "Register");
    // Register-mediated: soft_scroll_h declares $D016; a pitfall triggered
    // only by that register must reach the technique through it.
    await f.addRegister("D016", "$D016", "VIC-II", "RW", ["SCROLX"]);
    await f.addTechnique({
      name: "soft_scroll_h",
      title: "Hardware horizontal soft-scroll",
      category: "scroll",
      complexity: "low",
    });
    await f.linkTechniqueUsesRegister("soft_scroll_h", "D016");
    await f.addPitfall({
      name: "d016_unmasked_rmw_clobbers_csel_mcm",
      title: "Writing $D016 without masking destroys CSEL and MCM",
      severity: "high",
      region: "both",
      category: "scroll",
    });
    await f.linkTriggeredBy("d016_unmasked_rmw_clobbers_csel_mcm", "D016", "Register");
    await f.linkTriggeredBy("d012_wrap_around", "D012", "Register");
    await f.linkTriggeredBy("d012_wrap_around", "stable_raster_irq", "Technique");

    await f.addPitfall({
      name: "raster_irq_first_line_jitter",
      title: "First raster IRQ after enable has unpredictable entry timing",
      severity: "high",
      region: "both",
      category: "raster",
    });
    await f.linkTriggeredBy("raster_irq_first_line_jitter", "D011", "Register");
    await f.linkTriggeredBy("raster_irq_first_line_jitter", "D012", "Register");
    await f.linkTriggeredBy("raster_irq_first_line_jitter", "stable_raster_irq", "Technique");

    // A technique reachable only as a remedy: double_irq triggers nothing here
    // and is the Fix for the jitter pitfall.
    await f.addTechnique({
      name: "double_irq",
      title: "Double IRQ",
      category: "raster",
      complexity: "scene-tier",
    });
    await f.linkMitigatedBy("raster_irq_first_line_jitter", "double_irq");
    await f.linkMitigatedBy("raster_irq_first_line_jitter", "stable_raster_irq");

    // An Oscar64 header function that wraps $D011/$D012 (#19).
    await f.addLibraryFunction({
      name: "vic_waitLine",
      header: "vic.h",
      tool: "oscar64-headers",
      source_doc: "toolchains/oscar64-headers-reference.md",
    });
    await f.linkWraps("vic_waitLine", "D012", "Register");

    // KB-GAPS 6: a register-reached pitfall that other techniques trigger
    // belongs to them. scroll_step_v uses D011 only; fpp_thing owns
    // fpp_like_window; needs_fpp requires fpp_thing, so it keeps it.
    for (const name of ["scroll_step_v", "fpp_thing", "needs_fpp"]) {
      await f.addTechnique({ name, title: name, category: "scroll", complexity: "low" });
      await f.linkTechniqueUsesRegister(name, "D011");
    }
    await f.linkTechniqueRequires("needs_fpp", "fpp_thing");
    await f.addPitfall({
      name: "fpp_like_window",
      title: "An FPP write outside its window",
      severity: "high",
      region: "both",
      category: "raster",
    });
    await f.linkTriggeredBy("fpp_like_window", "D011", "Register");
    await f.linkTriggeredBy("fpp_like_window", "fpp_thing", "Technique");
    await f.addPitfall({
      name: "d011_general_only",
      title: "A pitfall of the register alone",
      severity: "medium",
      region: "both",
      category: "raster",
    });
    await f.linkTriggeredBy("d011_general_only", "D011", "Register");

    // KB-GAPS 7 and 19: techniques no Pitfall node names.
    await f.addTechnique({ name: "lonely_technique", title: "Lonely", category: "logic", complexity: "low" });
    await f.addRegister("DC00", "$DC00", "CIA1", "RW", ["PRA"]);
    await f.addTechnique({
      name: "facing_turn_step",
      title: "Sixteen-direction aim",
      category: "input",
      complexity: "low",
    });
    await f.linkTechniqueUsesRegister("facing_turn_step", "DC00");
    await f.addPitfall({
      name: "keyboard_thing",
      title: "A keyboard-scan pitfall",
      severity: "high",
      region: "both",
      category: "input",
    });
    await f.linkTriggeredBy("keyboard_thing", "DC00", "Register");
    await f.addTechnique({
      name: "keyboard_matrix_scan_x",
      title: "Scan",
      category: "input",
      complexity: "low",
    });
    await f.linkTriggeredBy("keyboard_thing", "keyboard_matrix_scan_x", "Technique");
  });

  afterAll(async () => f.close());

  it("answers from the graph for a technique that is only a remedy (MITIGATED_BY)", async () => {
    const r = await pitfallsFor("double_irq");
    expect(r.structured.topic_kind).toBe("Technique");
    expect(r.structured.pitfalls.map((p) => p.name)).toEqual(["raster_irq_first_line_jitter"]);
    const p = r.structured.pitfalls[0]!;
    expect(p.mitigated_by.map((m) => m.name).sort()).toEqual(["double_irq", "stable_raster_irq"]);
    expect(p.triggered_by.map((t) => t.name)).not.toContain("double_irq");
    expect(r.text).toMatch(/\*\*Mitigated by:\*\* double_irq, stable_raster_irq/);
  });

  it("lists a pitfall once when the technique both triggers and mitigates it", async () => {
    const r = await pitfallsFor("stable_raster_irq");
    const jitter = r.structured.pitfalls.filter((p) => p.name === "raster_irq_first_line_jitter");
    expect(jitter).toHaveLength(1);
    expect(jitter[0]!.mitigated_by.map((m) => m.name)).toContain("stable_raster_irq");
    // A pitfall with no remedy edge carries an empty list, not a missing field.
    const badline = r.structured.pitfalls.find((p) => p.name === "badline_cycle_loss");
    expect(badline?.mitigated_by).toEqual([]);
  });

  it("does not widen Register lookups to MITIGATED_BY", async () => {
    const r = await pitfallsFor("D012");
    expect(r.structured.topic_kind).toBe("Register");
    expect(r.structured.pitfalls.every((p) => Array.isArray(p.mitigated_by))).toBe(true);
  });

  it("returns pitfalls for a register topic (D012)", async () => {
    const r = await pitfallsFor("D012");
    expect(r.structured.topic_kind).toBe("Register");
    expect(r.structured.pitfalls.length).toBeGreaterThanOrEqual(2);
    const names = r.structured.pitfalls.map((p) => p.name);
    expect(names).toContain("d012_wrap_around");
  });

  it("reaches a pitfall through a register the technique declares, and says so", async () => {
    const r = await pitfallsFor("soft_scroll_h");
    expect(r.structured.topic_kind).toBe("Technique");
    const p = r.structured.pitfalls.find((x) => x.name === "d016_unmasked_rmw_clobbers_csel_mcm");
    expect(p).toBeDefined();
    expect(p?.via).toEqual([{ name: "D016", kind: "Register", address: "$D016" }]);
    expect(r.text).toContain("**Reached through:** D016 $D016 (Register)");
    // A directly triggered pitfall carries no via.
    const direct = (await pitfallsFor("stable_raster_irq")).structured.pitfalls.find(
      (x) => x.name === "badline_cycle_loss",
    );
    expect(direct?.via).toBeUndefined();
  });

  it("answers a C library function with the pitfalls of the register it wraps (#19)", async () => {
    const r = await pitfallsFor("vic_waitline");
    expect(r.structured.topic_kind).toBe("LibraryFunction");
    const names = r.structured.pitfalls.map((p) => p.name);
    expect(names).toContain("d012_wrap_around");
    expect(r.structured.pitfalls[0]?.via).toEqual([{ name: "D012", kind: "Register", address: "$D012" }]);
    expect(r.text).toContain("**Reached through:** D012 $D012 (Register), which this function wraps");
    expect(await f.linkWraps("vic_waitLine", "FFFF", "Register")).toBe(false);
  });

  it("leaves out a register-reached pitfall that belongs to techniques this one neither is nor requires (KB-GAPS 6)", async () => {
    const r = await pitfallsFor("scroll_step_v");
    const names = r.structured.pitfalls.map((p) => p.name);
    expect(names).toContain("d011_general_only");
    expect(names).not.toContain("d012_wrap_around"); // stable_raster_irq's
    expect(names).not.toContain("fpp_like_window");
    expect(r.structured.left_out).toContainEqual({ name: "fpp_like_window", owners: ["fpp_thing"] });
    expect(r.text).toMatch(/Left out.*fpp_like_window \(fpp_thing\)/s);
    // The owner itself, and a technique that requires the owner, keep it.
    expect((await pitfallsFor("fpp_thing")).structured.pitfalls.map((p) => p.name)).toContain(
      "fpp_like_window",
    );
    expect((await pitfallsFor("needs_fpp")).structured.pitfalls.map((p) => p.name)).toContain(
      "fpp_like_window",
    );
  });

  it("says a technique exists and no Pitfall node names it, instead of no match (KB-GAPS 7)", async () => {
    const r = await pitfallsFor("lonely_technique");
    expect(r.structured.topic_kind).toBe("Technique");
    expect(r.structured.pitfalls).toEqual([]);
    expect(r.text).toMatch(/lonely_technique is a technique/);
    expect(r.text).not.toMatch(/No direct entity match/);
  });

  it("returns a technique's own page pitfalls (KB-GAPS 19)", async () => {
    const r = await pitfallsFor("facing_turn_step");
    expect(r.structured.topic_kind).toBe("Technique");
    expect(r.structured.page_pitfalls?.source).toBe("techniques/input.md");
    expect(r.structured.page_pitfalls?.items).toHaveLength(4);
    expect(r.text).toMatch(/A centred stick must hold the facing/);
    // Its register-reached pitfall that another technique owns is left out.
    expect(r.structured.pitfalls.map((p) => p.name)).not.toContain("keyboard_thing");
    // A technique the graph does not hold still answers from its page.
    const g = await pitfallsFor("grenade_lob");
    expect(g.structured.topic_kind).toBe("Technique");
    expect(g.structured.page_pitfalls?.items).toHaveLength(4);
    expect(g.text).toMatch(/not in the graph/);
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
