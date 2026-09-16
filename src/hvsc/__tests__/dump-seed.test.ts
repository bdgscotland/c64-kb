import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorHvscClient } from "../../services/falkor-hvsc.js";
import { dumpSeed } from "../dump-seed.js";

describe("dumpSeed", () => {
  const GRAPH = `c64_hvsc_dumpseed_test_${Date.now()}`;
  const F = "d".repeat(32);
  let c: FalkorHvscClient;

  beforeAll(async () => {
    c = new FalkorHvscClient({ graphName: GRAPH });
    await c.connect();
    await c.upsertTune({
      file_md5: F, subtune_index: 0, title: "Seed", composer: "T",
      year: 1990, chip: "6581", region: "PAL", length_sec: 100, hvsc_path: "/s.sid",
      key_signature: "A", key_mode: "minor", tempo_bpm: 125,
    } as any);
    await c.upsertSections(F, 0, { sections: [
      { label: "A", start_frame: 0, end_frame: 600, repeat_of: null },
    ], repeat_shape: "A", intro_frames: 0 });
    await c.upsertMotifs(F, 0, [{ intervals: [2, 2, 1], voice: 1, occurrences: 4 }]);
    await c.upsertRhythm(F, 0, [{ slots: [[1, 1], [1, 1], [1, 1], [1, 1]], voice: 1, occurrences: 4 }]);
    await c.upsertPatches(F, 0, [{ patch_hash: "dh1", waveform: "pulse", adsr: [0, 9, 10, 9],
      filter_routed: false, hard_restart: "", ring_mod: false, hard_sync: false,
      duration_frames: 6, voice: 1, sid_chip: 1, occurrences: 4 }]);
    await c.upsertVoiceParts(F, 0, [{ voice: 1, sid_chip: 1, role: "lead", avgPitchHz: 440,
      pitchRange: 12, noteCount: 20, noisePercent: 0, avgGateLengthFrames: 4, rhythmRegularity: 0.9 }]);
  });
  afterAll(async () => { await c.dropGraph(); await c.disconnect(); });

  it("returns the seed vocabulary shape realize consumes", async () => {
    const seed = await dumpSeed(c, F, 0);
    expect(seed.tune.key_signature).toBe("A");
    expect(seed.tune.tempo_bpm).toBe(125);
    expect(seed.sections.length).toBe(1);
    expect(seed.voices.length).toBe(1);
    const v = seed.voices[0];
    expect(v.voice).toBe(1);
    expect(v.motifs[0].intervals).toEqual([2, 2, 1]);
    expect(v.rhythms[0].slots.length).toBe(4);
    expect(v.patches[0].waveform).toBe("pulse");
  });
});
