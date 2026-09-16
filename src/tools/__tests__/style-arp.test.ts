import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorHvscClient } from "../../services/falkor-hvsc.js";
import { clusterArpsInGraph } from "../../hvsc/cluster-arps.js";
import { styleProximity } from "../style.js";
const GRAPH = "c64_hvsc_style_arp_test", MD5 = "a".repeat(32);
let c: FalkorHvscClient;
beforeAll(async () => {
  c = new FalkorHvscClient({ graphName: GRAPH }); await c.connect(); await c.dropGraph();
  await c.upsertTune({ file_md5: MD5, subtune_index: 0, title: "T", composer: "Test Composer",
    year: null, chip: "either", region: "PAL", length_sec: null, hvsc_path: "/x" });
  await c.upsertVoiceParts(MD5, 0, [{ voice: 1, sid_chip: 1, role: "arp", avgPitchHz: 440,
    pitchRange: 12, noteCount: 60, noisePercent: 0, avgGateLengthFrames: 1, rhythmRegularity: 0.95 }]);
  await c.upsertArps(MD5, 0, [{ key: "0,3,7|0,3,7|r2", chord_intervals: [0,3,7], cycle: [0,3,7], n_steps: 3, rate_frames: 2, voice: 1, sid_chip: 1, occurrences: 4 }]);
  await clusterArpsInGraph(c);
});
afterAll(async () => { await c.dropGraph(); await c.disconnect(); });
describe("styleProximity arp_in_palette", () => {
  it("flags an in-palette arp true", async () => {
    const res = await styleProximity({ composer: "Test Composer", graphName: GRAPH,
      voices: [{ patch: { waveform: "pulse", adsr: [0,2,4,4] }, midis: [60,63,67],
        arp: { chord_intervals: [0,3,7], cycle: [0,3,7], rate_frames: 2 } }] });
    expect(res.per_voice[0].arp_in_palette).toBe(true);
  });
  it("flags an off-palette arp false", async () => {
    const res = await styleProximity({ composer: "Test Composer", graphName: GRAPH,
      voices: [{ patch: { waveform: "pulse", adsr: [0,2,4,4] }, midis: [60,65,69],
        arp: { chord_intervals: [0,5,9], cycle: [0,5,9], rate_frames: 2 } }] });
    expect(res.per_voice[0].arp_in_palette).toBe(false);
  });
  it("arp_in_palette false when no arp supplied", async () => {
    const res = await styleProximity({ composer: "Test Composer", graphName: GRAPH,
      voices: [{ patch: { waveform: "pulse", adsr: [0,2,4,4] }, midis: [60,62,64,63] }] });
    expect(res.per_voice[0].arp_in_palette).toBe(false);
  });
});
