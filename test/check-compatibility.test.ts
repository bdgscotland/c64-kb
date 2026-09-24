import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorService } from "../src/services/falkor.ts";
import { checkCompatibility, checkDesignCompatibility, timingBudget } from "../src/tools/query.ts";
import { CompatibilityCheckSchema } from "../src/schemas/tool-outputs.ts";

describe("checkCompatibility", () => {
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
    await f.addRegister("D016", "$D016", "VIC-II", "RW", []);
    await f.linkTechniqueUsesRegister("stable_raster_irq", "D016");
    await f.linkTechniqueUsesRegister("raster_bars", "D016");
  });
  afterAll(async () => f.close());

  it("flags shared-register conflicts", async () => {
    const r = await checkCompatibility(["stable_raster_irq", "raster_bars"]);
    expect(r.structured.conflicts.length).toBeGreaterThan(0);
    expect(r.structured.conflicts.some((c) => c.kind === "shared_register")).toBe(true);
    expect(r.structured.verdict).toBe("warnings");
  });

  it("returns compatible when no shared resources", async () => {
    await f.addTechnique({
      name: "cpu_io_port_bank",
      title: "CPU I/O port bank",
      category: "banking",
      complexity: "low",
    });
    const r = await checkCompatibility(["cpu_io_port_bank", "raster_bars"]);
    expect(r.structured.verdict).toBe("compatible");
  });

  it("reports incompatible for region mismatch", async () => {
    await f.addTechnique({
      name: "pal_only_tech",
      title: "PAL-only",
      category: "raster",
      complexity: "high",
    });
    await f.addTechnique({
      name: "ntsc_only_tech",
      title: "NTSC-only",
      category: "raster",
      complexity: "high",
    });
    await f.linkTechniqueRequiresRegion("pal_only_tech", "PAL");
    await f.linkTechniqueRequiresRegion("ntsc_only_tech", "NTSC");
    const r = await checkCompatibility(["pal_only_tech", "ntsc_only_tech"]);
    expect(r.structured.conflicts.some((c) => c.kind === "region_mismatch")).toBe(true);
    expect(r.structured.verdict).toBe("incompatible");
  });

  it("flags shared raster discipline between sprite_multiplex_24 and fli_image", async () => {
    await f.addTechnique({
      name: "sprite_multiplex_24",
      title: "24-sprite multiplexer",
      category: "raster",
      complexity: "high",
    });
    await f.addTechnique({
      name: "fli_image",
      title: "FLI image display",
      category: "raster",
      complexity: "high",
    });
    const r = await checkCompatibility(["sprite_multiplex_24", "fli_image"]);
    expect(r.structured.shared_infrastructure.length).toBeGreaterThanOrEqual(1);
    expect(r.structured.shared_infrastructure.some((s) => s.kind === "discipline")).toBe(true);
  });

  it("does NOT flag shared infra between unrelated techniques", async () => {
    await f.addTechnique({
      name: "plasma",
      title: "Plasma effect",
      category: "effect",
      complexity: "medium",
    });
    await f.addTechnique({
      name: "sid_voice_setup",
      title: "SID voice setup",
      category: "music",
      complexity: "low",
    });
    const r = await checkCompatibility(["plasma", "sid_voice_setup"]);
    expect(r.structured.shared_infrastructure).toEqual([]);
  });

  it("raster-discipline detected via USES->Register even when only one category=raster", async () => {
    // Seed two techniques: one category=raster, one category=effect.
    // Both USE SCROLY and RASTER.
    await f.addTechnique({ name: "tech_a", title: "A", category: "raster", complexity: "low" });
    await f.addTechnique({ name: "tech_b", title: "B", category: "effect", complexity: "low" });
    await f.addRegister("SCROLY", "$D011", "VIC-II", "RW", ["D011"]);
    await f.addRegister("RASTER", "$D012", "VIC-II", "RW", ["D012"]);
    await f.linkTechniqueUsesRegister("tech_a", "SCROLY");
    await f.linkTechniqueUsesRegister("tech_a", "RASTER");
    await f.linkTechniqueUsesRegister("tech_b", "SCROLY");
    await f.linkTechniqueUsesRegister("tech_b", "RASTER");

    const r = await checkCompatibility(["tech_a", "tech_b"]);
    expect(r.structured.shared_infrastructure.some((s) => s.name === "raster_discipline")).toBe(true);
  });

  it("checks a design phase by phase: an init member is not checked beside play (#37)", async () => {
    await f.addGameDesign({ name: "phase_test", title: "Phase test", measured: [], source_doc: "p.md" });
    expect(await f.linkComposes("phase_test", "stable_raster_irq", "play")).toBe(true);
    expect(await f.linkComposes("phase_test", "raster_bars", "init")).toBe(true);
    // Flat, the pair shares D016 (warnings); by phase they never run together.
    const r = await checkDesignCompatibility("phase_test");
    CompatibilityCheckSchema.parse(r.structured);
    expect(r.structured.phases).toEqual([
      { phase: "play", techniques: ["stable_raster_irq"], verdict: "compatible" },
      { phase: "init", techniques: ["raster_bars"], verdict: "compatible" },
    ]);
    expect(r.structured.conflicts).toEqual([]);
    expect(r.structured.verdict).toBe("compatible");
    expect(r.structured.design?.name).toBe("phase_test");
    expect(r.text).toContain("## Phase: init");
    // An extra member joins its phase, and a finding carries that phase.
    const withExtra = await checkDesignCompatibility("phase_test", ["raster_bars:play"]);
    expect(withExtra.structured.verdict).toBe("warnings");
    expect(withExtra.structured.conflicts.every((c) => c.phase === "play")).toBe(true);
    await expect(checkDesignCompatibility("no_such_design")).rejects.toThrow(/known: phase_test/);
  });

  it("names the node type of a refused name that is not a technique (#19)", async () => {
    await f.addPitfall({
      name: "jitter_pitfall",
      title: "Jitter",
      severity: "high",
      region: "both",
      category: "raster",
    });
    expect(await f.linkTriggeredBy("jitter_pitfall", "raster_bars", "Technique")).toBe(true);
    expect(await f.linkMitigatedBy("jitter_pitfall", "stable_raster_irq")).toBe(true);
    await f.addFileFormat("CRT", "Cartridge image");
    const r = await checkCompatibility([
      "raster_bars",
      "jitter_pitfall",
      "crt",
      "Raster_Bars",
      "nothing_here",
    ]);
    expect(r.structured.verdict).toBe("unknown_technique");
    expect(r.structured.not_found).toEqual(["jitter_pitfall", "crt", "Raster_Bars", "nothing_here"]);
    expect(r.text).toContain(
      "- `jitter_pitfall` is a Pitfall (`jitter_pitfall`), not a technique. Arises in: raster_bars. Cured by: stable_raster_irq.",
    );
    expect(r.text).toContain("- `crt` is a FileFormat (`CRT`), not a technique.");
    expect(r.text).toContain("- `Raster_Bars` is the technique `raster_bars`; pass it with that spelling.");
    expect(r.text).not.toContain("`nothing_here` is");
    // Caller order is kept.
    expect(r.text.indexOf("`jitter_pitfall` is")).toBeLessThan(r.text.indexOf("`crt` is"));
  });
});

describe("timingBudget", () => {
  it("returns PAL cycle math", async () => {
    const r = await timingBudget({ technique: "stable_raster_irq", region: "PAL" });
    expect(r.structured.cycles_per_line).toBe(63);
    expect(r.structured.cycles_per_frame).toBe(63 * 312);
    expect(r.structured.user_cycles_per_line_normal).toBeLessThan(63);
    expect(r.structured.badline_cycles_lost).toBe(43); // 40 bus cycles + 3 BA cycles the CPU can only write in
  });

  it("returns NTSC cycle math", async () => {
    const r = await timingBudget({ technique: "stable_raster_irq", region: "NTSC" });
    expect(r.structured.cycles_per_line).toBe(65);
    expect(r.structured.cycles_per_frame).toBe(65 * 263);
  });

  it("normalizes region case", async () => {
    const r = await timingBudget({ technique: "stable_raster_irq", region: "pal" });
    expect(r.structured.region).toBe("PAL");
    expect(r.structured.cycles_per_line).toBe(63);
  });
});
