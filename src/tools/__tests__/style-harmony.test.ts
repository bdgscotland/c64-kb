import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorHvscClient } from "../../services/falkor-hvsc.js";
import { clusterProgressionsInGraph } from "../../hvsc/cluster-progressions.js";
import { styleProximity } from "../style.js";

const GRAPH = "c64_hvsc_style_harmony_test";
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
  await c.upsertSections(MD5, 0, { sections: [{ label: "A", start_frame: 0, end_frame: 100 }], repeat_shape: "A", intro_frames: 0 });
  // Composer favours i-bVII-bVI (degrees 0min-10maj-8maj).
  await c.upsertProgressions(MD5, 0, [{ order: 0, degrees: "0min-10maj-8maj", length: 3 }]);
  await clusterProgressionsInGraph(c);
});
afterAll(async () => { await c.dropGraph(); await c.disconnect(); });

describe("styleProximity harmony", () => {
  it("flags an in-palette progression (Am-G-F in key A minor = i-bVII-bVI)", async () => {
    const res = await styleProximity({
      composer: "Test Composer", graphName: GRAPH,
      voices: [], chords: ["Am", "G", "F"], key: "A", mode: "minor",
    });
    expect(res.harmony_in_palette).toBe(true);
  });

  it("flags an off-palette progression as not in palette", async () => {
    const res = await styleProximity({
      composer: "Test Composer", graphName: GRAPH,
      voices: [], chords: ["C", "Dm", "Em"], key: "C", mode: "major",
    });
    expect(res.harmony_in_palette).toBe(false);
  });

  it("omits the harmony dimension when no chords given", async () => {
    const res = await styleProximity({
      composer: "Test Composer", graphName: GRAPH,
      voices: [{ patch: { waveform: "pulse", adsr: [0, 0, 3, 3] }, midis: [60, 62, 64, 63] }],
    });
    expect(res.harmony_in_palette).toBeUndefined();
  });
});
