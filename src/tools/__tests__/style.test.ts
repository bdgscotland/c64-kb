import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorHvscClient } from "../../services/falkor-hvsc.js";
import { hydrateOneTune } from "../../hvsc/hydrate.js";
import { clusterPatchesInGraph } from "../../hvsc/cluster-patches.js";
import { clusterMotifsInGraph } from "../../hvsc/cluster-motifs.js";
import { clusterGesturesInGraph } from "../../hvsc/cluster-gestures.js";
import { styleProximity } from "../style.js";

const GRAPH = "c64_hvsc_style_test";
let c: FalkorHvscClient;

beforeAll(async () => {
  c = new FalkorHvscClient({ graphName: GRAPH });
  await c.connect();
  await c.dropGraph();
  const md5 = "a".repeat(32);
  const events: any[] = [];
  const midis = [60, 62, 64, 63, 65, 67, 66, 68];
  for (let i = 0; i < midis.length; i++) {
    events.push({ frame: i * 8, voice: 1, kind: "on", pitch: 440 * Math.pow(2, (midis[i] - 69) / 12), sid_chip: 1, waveform: "pulse" });
    events.push({ frame: i * 8 + 6, voice: 1, kind: "off", pitch: 0, sid_chip: 1 });
  }
  await hydrateOneTune({
    file_md5: md5, subtune_index: 0,
    meta: { title: "T", composer: "Test Composer", hvsc_path: "/x" },
    instruments: [], events,
    patches: [{ patch_hash: "p1", waveform: "pulse", adsr: [0, 0, 3, 3], hard_restart: "classic", voice: 1, sid_chip: 1 }],
    filter_curve: [], pulsewidth: [], structure: {}, driver: { hash: "d" },
    vibrato: [{ voice: 1, sid_chip: 1, has_vibrato: true, rate_frames: 8, depth_cents: 20, onset_delay_frames: 0 }],
  } as any, { falkor: c, skipQdrant: true });
  await clusterPatchesInGraph(c, { adsrTolerance: 4, pwTolerance: 256 });
  await clusterMotifsInGraph(c);
  await clusterGesturesInGraph(c);
});
afterAll(async () => { await c.dropGraph(); await c.disconnect(); });

describe("styleProximity", () => {
  it("scores an in-palette patch/motif/gesture as high in-style", async () => {
    const res = await styleProximity({
      composer: "Test Composer", graphName: GRAPH,
      voices: [{
        patch: { waveform: "pulse", adsr: [0, 0, 3, 3], hard_restart: "classic" },
        vibrato: { rate_frames: 8, depth_cents: 20 },
        midis: [60, 62, 64, 63],
      }],
    });
    expect(res.in_style_pct).toBeGreaterThan(50);
    expect(res.per_voice[0].patch_in_palette).toBe(true);
    expect(res.per_voice[0].motif_in_palette).toBe(true);
    expect(res.per_voice[0].gesture_in_palette).toBe(true);
  });

  it("scores an off-palette voice low", async () => {
    const res = await styleProximity({
      composer: "Test Composer", graphName: GRAPH,
      voices: [{
        patch: { waveform: "noise", adsr: [0, 15, 15, 15], hard_restart: "" },
        vibrato: null,
        midis: [60, 60, 60, 60],
      }],
    });
    expect(res.per_voice[0].patch_in_palette).toBe(false);
  });

  it("does not dilute in_style_pct when chords are given but the composer has no mined progression", async () => {
    // This graph has Test Composer's patch/motif/gesture palette but NO progressions.
    // A fully in-palette voice must still score 100 — harmony is omitted, not a phantom 0.
    const res = await styleProximity({
      composer: "Test Composer", graphName: GRAPH,
      voices: [{
        patch: { waveform: "pulse", adsr: [0, 0, 3, 3], hard_restart: "classic" },
        vibrato: { rate_frames: 8, depth_cents: 20 },
        midis: [60, 62, 64, 63],
      }],
      chords: ["C", "F", "G"], key: "C", mode: "major",
    });
    expect(res.harmony_in_palette).toBeUndefined();
    expect(res.in_style_pct).toBeGreaterThan(50); // not dragged to 50 by a phantom harmony dim
  });
});
