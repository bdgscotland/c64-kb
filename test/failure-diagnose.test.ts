import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorService } from "../src/services/falkor.js";
import { failureDiagnose } from "../src/tools/pitfalls.js";

describe("failureDiagnose", () => {
  let f: FalkorService;

  beforeAll(async () => {
    f = new FalkorService();
    await f.connect();
    await f.clean();
    await f.ensureSchema();

    // Seed CrashPatterns for the two test cases
    await f.addCrashPattern({
      symptom: "black_screen",
      description: "Display goes solid color or stays $00 — nothing visible on screen",
      likely_causes: ["vic_bank_misconfigured", "screen_pointer_outside_bank", "den_bit_cleared"],
      diagnosis_steps: "Check $D018 for screen pointer; verify $DD00 VIC bank; confirm DEN bit in $D011.",
    });

    await f.addCrashPattern({
      symptom: "sprite_flicker_periodic",
      description: "Sprites flicker on every N-th frame in a repeating periodic pattern",
      likely_causes: ["sprite_dma_budget_exceeded", "irq_late_on_badline", "sprite_y_update_missed"],
      diagnosis_steps: "Count active sprites per line; verify IRQ fires before sprite Y DMA window; check badline overlap.",
    });

    await f.addCrashPattern({
      symptom: "sprite_flicker_random",
      description: "Sprites flicker randomly and unpredictably across the frame",
      likely_causes: ["sprite_priority_conflict", "irq_jitter_too_high", "dma_conflict"],
      diagnosis_steps: "Verify sprite priorities; check IRQ entry jitter with stable-raster double-IRQ trick.",
    });

    // Seed some Techniques for CAUSED_BY edges
    await f.addTechnique({ name: "vic_bank_switch", title: "VIC Bank Switching", category: "banking", complexity: "medium" });
    await f.addTechnique({ name: "sprite_multiplex_8", title: "8-sprite multiplexer", category: "sprite", complexity: "high" });
    await f.linkCausedBy("black_screen", "vic_bank_switch", "Technique");
    await f.linkCausedBy("sprite_flicker_periodic", "sprite_multiplex_8", "Technique");
  });

  afterAll(async () => f?.close());

  it("matches a known symptom keyword (black screen)", async () => {
    const r = await failureDiagnose("black screen");
    expect(r.structured.matches.length).toBeGreaterThanOrEqual(1);
    expect(r.structured.matches[0].symptom).toBe("black_screen");
  });

  it("ranks matches by relevance", async () => {
    const r = await failureDiagnose("sprites flicker every other frame");
    expect(r.structured.matches.length).toBeGreaterThanOrEqual(1);
    const top = r.structured.matches[0];
    expect(["sprite_flicker_periodic", "sprite_flicker_random"]).toContain(top.symptom);
  });
});
