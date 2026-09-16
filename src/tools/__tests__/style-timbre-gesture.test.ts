/**
 * Tests for the timbre-gesture dimension in styleProximity (T7).
 *
 * Seeds a minimal isolated graph with a composer who has FAVORS_TIMBRE_GESTURE
 * edges (via upsertTimbreGestures + clusterTimbreGesturesInGraph), then asserts:
 *   1. A voice whose timbre_gesture archetype matches → timbre_gesture_in_palette true
 *      and a higher in_style_pct than a voice with an off-palette gesture.
 *   2. A voice with no timbre_gesture declared is not penalized (score unchanged
 *      vs the same voice without the dimension).
 *
 * Skips gracefully if FalkorDB is unreachable.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorHvscClient } from "../../services/falkor-hvsc.js";
import { clusterTimbreGesturesInGraph } from "../../hvsc/cluster-timbre-gestures.js";
import { styleProximity } from "../style.js";

const GRAPH = "c64_hvsc_style_timbre_gesture_test";
const MD5 = "c".repeat(32);

// The gesture the composer favours — sweep_up PWM.
const IN_PALETTE_GESTURE = {
  voice: 1, sid_chip: 1,
  kind: "pwm" as const,
  archetype: "sweep_up",
  depth_band: "deep",
  rate_band: "slow",
  gesture_hash: "pwm_sweep_up_deep_slow_t7test",
  template: Array.from({ length: 16 }, (_, i) => i / 15),
  count: 6,
  fraction: 0.75,
};

// A base voice that scores well on patch + motif (pulse, recognizable intervals).
const BASE_VOICE = {
  patch: { waveform: "pulse", adsr: [0, 2, 4, 4] },
  midis: [60, 62, 64, 63, 65, 67, 66, 68],
};

let c: FalkorHvscClient;
let skipReason: string | undefined;

beforeAll(async () => {
  c = new FalkorHvscClient({ graphName: GRAPH });
  try {
    await c.connect();
    await c.dropGraph();
    await c.upsertTune({
      file_md5: MD5, subtune_index: 0, title: "T", composer: "Timbre Composer",
      year: null, chip: "either", region: "PAL", length_sec: null, hvsc_path: "/x",
    });
    await c.upsertVoiceParts(MD5, 0, [
      { voice: 1, sid_chip: 1, role: "lead", avgPitchHz: 440, pitchRange: 12,
        noteCount: 20, noisePercent: 0, avgGateLengthFrames: 6, rhythmRegularity: 0.5 },
    ]);
    await c.upsertTimbreGestures(MD5, 0, [IN_PALETTE_GESTURE]);
    await clusterTimbreGesturesInGraph(c);
  } catch (err) {
    skipReason = `FalkorDB unavailable: ${String(err)}`;
  }
});

afterAll(async () => {
  try { await c.dropGraph(); } catch {}
  try { await c.disconnect(); } catch {}
});

describe("styleProximity timbre_gesture_in_palette", () => {
  it("flags an in-palette timbre gesture as timbre_gesture_in_palette true", async () => {
    if (skipReason) { console.warn(`SKIP: ${skipReason}`); return; }
    const res = await styleProximity({
      composer: "Timbre Composer", graphName: GRAPH,
      voices: [{
        ...BASE_VOICE,
        timbre_gesture: { kind: "pwm", archetype: "sweep_up" },
      }],
    });
    expect(res.per_voice[0].timbre_gesture_in_palette).toBe(true);
  });

  it("flags an off-palette timbre gesture as timbre_gesture_in_palette false", async () => {
    if (skipReason) { console.warn(`SKIP: ${skipReason}`); return; }
    const res = await styleProximity({
      composer: "Timbre Composer", graphName: GRAPH,
      voices: [{
        ...BASE_VOICE,
        timbre_gesture: { kind: "filter", archetype: "cutoff_dip" },
      }],
    });
    expect(res.per_voice[0].timbre_gesture_in_palette).toBe(false);
  });

  it("in-palette gesture yields higher in_style_pct than off-palette gesture", async () => {
    if (skipReason) { console.warn(`SKIP: ${skipReason}`); return; }
    const resOn = await styleProximity({
      composer: "Timbre Composer", graphName: GRAPH,
      voices: [{ ...BASE_VOICE, timbre_gesture: { kind: "pwm", archetype: "sweep_up" } }],
    });
    const resOff = await styleProximity({
      composer: "Timbre Composer", graphName: GRAPH,
      voices: [{ ...BASE_VOICE, timbre_gesture: { kind: "filter", archetype: "cutoff_dip" } }],
    });
    expect(resOn.in_style_pct).toBeGreaterThan(resOff.in_style_pct);
  });

  it("does not penalize a voice with no timbre_gesture declared (absent = not scored)", async () => {
    if (skipReason) { console.warn(`SKIP: ${skipReason}`); return; }
    // A voice with no timbre_gesture should score the same as a voice with timbre_gesture: null.
    const resAbsent = await styleProximity({
      composer: "Timbre Composer", graphName: GRAPH,
      voices: [{ ...BASE_VOICE }],
    });
    const resNull = await styleProximity({
      composer: "Timbre Composer", graphName: GRAPH,
      voices: [{ ...BASE_VOICE, timbre_gesture: null }],
    });
    // Both omit the dimension from terms — scores must be identical.
    expect(resAbsent.per_voice[0].score).toBeCloseTo(resNull.per_voice[0].score, 10);
    expect(resAbsent.per_voice[0].timbre_gesture_in_palette).toBe(false);
    // Neither should be dragged below a no-gesture baseline.
    // The off-palette voice (gesture declared but wrong) should score strictly lower.
    const resOff = await styleProximity({
      composer: "Timbre Composer", graphName: GRAPH,
      voices: [{ ...BASE_VOICE, timbre_gesture: { kind: "filter", archetype: "cutoff_dip" } }],
    });
    expect(resAbsent.per_voice[0].score).toBeGreaterThanOrEqual(resOff.per_voice[0].score);
  });

  it("timbre_gesture_in_palette false when no timbre gestures in composer palette (empty set)", async () => {
    if (skipReason) { console.warn(`SKIP: ${skipReason}`); return; }
    // Use a composer name that has no data — favTimbreGestureSet will be empty.
    // Voice with a declared gesture: useTimbreGesture is false (set empty),
    // so the dimension is not folded in — timbre_gesture_in_palette stays false.
    const res = await styleProximity({
      composer: "Unknown Composer XYZ", graphName: GRAPH,
      voices: [{ ...BASE_VOICE, timbre_gesture: { kind: "pwm", archetype: "sweep_up" } }],
    });
    expect(res.per_voice[0].timbre_gesture_in_palette).toBe(false);
  });
});
