import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorHvscClient } from "../../services/falkor-hvsc.js";
import { clusterTimbreGesturesInGraph } from "../cluster-timbre-gestures.js";

const GRAPH = "c64_hvsc_timbre_gesture_cluster_test";
let c: FalkorHvscClient;

// A minimal Gesture descriptor shared across multiple tunes/voices.
const SHARED_GESTURE = {
  voice: 1, sid_chip: 1,
  kind: "pwm" as const,
  archetype: "slow_sweep",
  depth_band: "deep",
  rate_band: "slow",
  resonance_band: null as unknown as string,
  mode: null as unknown as string,
  gesture_hash: "pwm_slow_sweep_deep_slow_shared",
  template: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 90, 80, 70, 60, 50],
  count: 4,
  fraction: 0.8,
};

// A second gesture that only appears in one tune — should get weight 1.
const SINGLE_GESTURE = {
  voice: 2, sid_chip: 1,
  kind: "filter" as const,
  archetype: "hi_pass_sweep",
  depth_band: "shallow",
  rate_band: "fast",
  resonance_band: null as unknown as string,
  mode: null as unknown as string,
  gesture_hash: "filter_hipass_shallow_fast_single",
  template: [100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 0, 10, 20, 30, 40, 50],
  count: 1,
  fraction: 0.2,
};

type TimbreGestureInput = Parameters<FalkorHvscClient["upsertTimbreGestures"]>[2][number];

async function tuneWithGestures(
  md5: string,
  composer: string,
  gestures: TimbreGestureInput[],
) {
  await c.upsertTune({
    file_md5: md5, subtune_index: 0, title: "T", composer,
    year: null, chip: "either", region: "PAL", length_sec: null, hvsc_path: "/" + md5,
  });
  await c.upsertVoiceParts(md5, 0, [
    { voice: 1, sid_chip: 1, role: "lead", avgPitchHz: 440, pitchRange: 12, noteCount: 10, noisePercent: 0, avgGateLengthFrames: 6, rhythmRegularity: 0.5 },
    { voice: 2, sid_chip: 1, role: "bass", avgPitchHz: 220, pitchRange: 6, noteCount: 8, noisePercent: 0, avgGateLengthFrames: 8, rhythmRegularity: 0.7 },
  ]);
  await c.upsertTimbreGestures(md5, 0, gestures);
}

beforeAll(async () => {
  c = new FalkorHvscClient({ graphName: GRAPH });
  await c.connect();
  await c.dropGraph();

  // tune A: shared gesture + single gesture (both voices)
  await tuneWithGestures("a".repeat(32), "Timbre", [SHARED_GESTURE, SINGLE_GESTURE]);
  // tune B: shared gesture only (same composer -> weight must accumulate to 2)
  await tuneWithGestures("b".repeat(32), "Timbre", [SHARED_GESTURE]);
});

afterAll(async () => {
  await c.dropGraph();
  await c.disconnect();
});

describe("clusterTimbreGesturesInGraph", () => {
  it("builds Composer-FAVORS_TIMBRE_GESTURE with weight > 1 for a shared gesture (bound-alias count(u))", async () => {
    await clusterTimbreGesturesInGraph(c);

    // Shared gesture appears in 2 tunes -> weight must be 2, NOT 1 (the count-gotcha value).
    const shared = await c.rawQuery<{ w: number }>(
      `MATCH (:Composer {name:'timbre'})-[r:FAVORS_TIMBRE_GESTURE]->(:Gesture {gesture_hash:$h})
       RETURN r.weight AS w`,
      { h: SHARED_GESTURE.gesture_hash },
    );
    expect(Number(shared[0]?.w)).toBe(2); // bound count(u), NOT collapsed to 1

    // Single-occurrence gesture gets weight 1.
    const single = await c.rawQuery<{ w: number }>(
      `MATCH (:Composer {name:'timbre'})-[r:FAVORS_TIMBRE_GESTURE]->(:Gesture {gesture_hash:$h})
       RETURN r.weight AS w`,
      { h: SINGLE_GESTURE.gesture_hash },
    );
    expect(Number(single[0]?.w)).toBe(1);
  });

  it("creates exactly 2 FAVORS_TIMBRE_GESTURE edges for the one composer", async () => {
    const rows = await c.rawQuery<{ n: number }>(
      "MATCH (:Composer {name:'timbre'})-[r:FAVORS_TIMBRE_GESTURE]->(:Gesture) RETURN count(r) AS n",
    );
    expect(Number(rows[0].n)).toBe(2); // one per distinct Gesture
  });
});
