import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorHvscClient } from "../../services/falkor-hvsc.js";
import { clusterPhrasesInGraph } from "../../hvsc/cluster-phrases.js";
import { styleProximity } from "../style.js";

const GRAPH = "c64_hvsc_style_phrase_test";
const MD5 = "a".repeat(32);
let c: FalkorHvscClient;

beforeAll(async () => {
  c = new FalkorHvscClient({ graphName: GRAPH });
  await c.connect();
  await c.dropGraph();
  await c.upsertTune({
    file_md5: MD5, subtune_index: 0, title: "T", composer: "Test Composer",
    year: null, chip: "either", region: "PAL", length_sec: null, hvsc_path: "/x",
  });
  await c.upsertVoiceParts(MD5, 0, [
    { voice: 1, sid_chip: 1, role: "lead", avgPitchHz: 440, pitchRange: 12, noteCount: 10,
      noisePercent: 0, avgGateLengthFrames: 6, rhythmRegularity: 0.5 },
  ]);
  // Phrase: intervals=[4,-2,3,-1], iois=[1,1,1,1,1], gates=[1,1,1,1,1] (16th-grid units)
  // phraseKey = "4,-2,3,-1|1:1;1:1;1:1;1:1;1:1"
  await c.upsertPhrases(MD5, 0, [
    { key: "4,-2,3,-1|1:1;1:1;1:1;1:1;1:1",
      intervals: [4, -2, 3, -1], iois: [1, 1, 1, 1, 1], gates: [1, 1, 1, 1, 1],
      voice: 1, sid_chip: 1, occurrences: 3 },
  ]);
  await clusterPhrasesInGraph(c);
});

afterAll(async () => {
  await c.dropGraph();
  await c.disconnect();
});

describe("styleProximity phrase_in_palette", () => {
  it("flags an in-palette phrase as phrase_in_palette true", async () => {
    // midis=[60,64,62,65,64] → intervals [4,-2,3,-1]
    // onsets=[0,0.25,0.5,0.75,1.0] beats, gates=[0.25,...] beats
    // q(0.25 * 4) = q(1.0) = 1 for each ioi and gate
    // → candidate key = "4,-2,3,-1|1:1;1:1;1:1;1:1;1:1" — exact palette match
    const res = await styleProximity({
      composer: "Test Composer",
      graphName: GRAPH,
      voices: [{
        patch: { waveform: "pulse", adsr: [0, 0, 3, 3] },
        midis: [60, 64, 62, 65, 64],
        onsets: [0, 0.25, 0.5, 0.75, 1.0],
        gates: [0.25, 0.25, 0.25, 0.25, 0.25],
      }],
    });
    expect(res.per_voice[0].phrase_in_palette).toBe(true);
  });

  it("flags an off-palette phrase as phrase_in_palette false", async () => {
    // midis=[60,60,60,60,60] → intervals [0,0,0,0] — no matching phrase
    const res = await styleProximity({
      composer: "Test Composer",
      graphName: GRAPH,
      voices: [{
        patch: { waveform: "pulse", adsr: [0, 0, 3, 3] },
        midis: [60, 60, 60, 60, 60],
        onsets: [0, 0.25, 0.5, 0.75, 1.0],
        gates: [0.25, 0.25, 0.25, 0.25, 0.25],
      }],
    });
    expect(res.per_voice[0].phrase_in_palette).toBe(false);
  });

  it("falls back gracefully when voice has no onsets/gates (phrase_in_palette false)", async () => {
    // No onsets or gates — phrase check is skipped; motif path runs instead.
    const res = await styleProximity({
      composer: "Test Composer",
      graphName: GRAPH,
      voices: [{
        patch: { waveform: "pulse", adsr: [0, 0, 3, 3] },
        midis: [60, 64, 62, 65],
      }],
    });
    expect(res.per_voice[0].phrase_in_palette).toBe(false);
    // The call should still succeed (motif path is used)
    expect(res.per_voice[0]).toHaveProperty("motif_in_palette");
  });
});
