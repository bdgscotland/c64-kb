import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorHvscClient } from "../../services/falkor-hvsc.js";
import { arrangeTune } from "../arrange.js";
const GRAPH = "c64_hvsc_arrange_test", MD5 = "a".repeat(32);
let c: FalkorHvscClient;
beforeAll(async () => {
  c = new FalkorHvscClient({ graphName: GRAPH }); await c.connect(); await c.dropGraph();
  await c.upsertTune({ file_md5: MD5, subtune_index: 0, title: "TestTune", composer: "Rob Hubbard",
    year: null, chip: "either", region: "PAL", length_sec: null, hvsc_path: "/x" });
  await c.rawWrite(`MATCH (t:Tune {file_md5:$m, subtune_index:0}) SET t.key_signature='C', t.key_mode='minor', t.tempo_bpm=125, t.region='PAL'`, { m: MD5 });
  // A (0..192 = 2 bars @125bpm: fpb=24, bar=96), B (192..288 = 1 bar)
  await c.upsertSections(MD5, 0, { sections: [
    { label: "A", start_frame: 0, end_frame: 192 },
    { label: "B", start_frame: 192, end_frame: 288 },
  ], repeat_shape: "AB", intro_frames: 0 });
  // progression on section order 0 (A): C minor i-bVI = 0min-8maj
  await c.upsertProgressions(MD5, 0, [{ order: 0, degrees: "0min-8maj", length: 2 }]);
  await c.upsertVoiceParts(MD5, 0, [
    { voice: 1, sid_chip: 1, role: "lead", avgPitchHz: 440, pitchRange: 12, noteCount: 40, noisePercent: 0, avgGateLengthFrames: 6, rhythmRegularity: 0.5 },
    { voice: 2, sid_chip: 1, role: "bass", avgPitchHz: 110, pitchRange: 12, noteCount: 40, noisePercent: 0, avgGateLengthFrames: 6, rhythmRegularity: 0.5 },
  ]);
  await c.upsertPatches(MD5, 0, [{ patch_hash: "p1", waveform: "pulse", adsr: [0,8,8,12], hard_restart: "classic", voice: 1, sid_chip: 1 }]);
  await c.upsertPhrases(MD5, 0, [
    { key: "0,0,3,2|2:1;2:1;2:1;4:1;1:1", intervals: [0,0,3,2], iois: [2,2,2,4,1], gates: [1,1,1,1,1], voice: 1, sid_chip: 1, occurrences: 5 },
    { key: "1,1,1,1|2:1;2:1;2:1;2:1;1:1", intervals: [1,1,1,1], iois: [2,2,2,2,1], gates: [1,1,1,1,1], voice: 1, sid_chip: 1, occurrences: 3 },
  ]);
});
afterAll(async () => { await c.dropGraph(); await c.disconnect(); });
describe("arrangeTune structure", () => {
  it("builds sections with bar counts + meta from the tune", async () => {
    const r = await arrangeTune({ title: "TestTune", graphName: GRAPH });
    expect(r.score.meta.key).toBe("C");
    expect(r.score.meta.mode).toBe("minor");
    expect(r.score.meta.tempo_bpm).toBe(125);
    expect(r.score.sections.length).toBe(2);
    expect(r.score.sections[0].bars).toBe(2);
    expect(r.score.sections[1].bars).toBe(1);
    expect(r.score.sections[0].chords.length).toBeGreaterThan(0);
    expect(r.summary.tune).toBe("TestTune");
  });
  it("populates voices from the tune's VoiceParts", async () => {
    const r = await arrangeTune({ title: "TestTune", graphName: GRAPH });
    expect(r.score.voices.length).toBe(2);
    const lead = r.score.voices.find((v: any) => v.role === "lead");
    expect(lead.patch.waveform).toBe("pulse");
    expect(lead.patch.adsr).toEqual([0,8,8,12]);
    expect(lead.phrases.length).toBeGreaterThan(0);
    const bass = r.score.voices.find((v: any) => v.role === "bass");
    expect(bass.notes.length).toBeGreaterThan(0);
    expect(bass.patch.waveform).toBe("triangle");   // clean sparse bass (not the buzzy mined patch)
    expect(lead.harmonize).toBe(true);              // lead opts into voice-leading
    expect(r.summary.voices).toBe(2);
  });
});
