import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorHvscClient } from "../../services/falkor-hvsc.js";
import { hydrateOneTune } from "../hydrate.js";

const GRAPH = "c64_hvsc_hydrate_phrase_test";
const MD5 = "9".repeat(32);
let c: FalkorHvscClient;

beforeAll(async () => {
  c = new FalkorHvscClient({ graphName: GRAPH });
  await c.connect();
  await c.dropGraph();
});
afterAll(async () => { await c.dropGraph(); await c.disconnect(); });

describe("hydrate phrases", () => {
  it("mines a repeated 5-note riff and links VoicePart-USES_PHRASE->Phrase", async () => {
    // Build a 5-note riff [C4 E4 D4 F4 E4] repeated twice, with on/off pairs.
    // Onsets at multiples of 8 frames; gate 6 frames; gap 16 frames between passes.
    const midis = [60, 64, 62, 65, 64];
    const events: Array<{ frame: number; voice: number; kind: string; pitch: number; sid_chip: number; waveform: string }> = [];
    let f = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (const m of midis) {
        const pitch = 440 * Math.pow(2, (m - 69) / 12);
        events.push({ frame: f, voice: 1, kind: "on", pitch, sid_chip: 1, waveform: "pulse" });
        events.push({ frame: f + 6, voice: 1, kind: "off", pitch: 0, sid_chip: 1, waveform: "" });
        f += 8;
      }
      f += 16;
    }

    // tempo 120 bpm -> PAL_FRAMES_PER_SIXTEENTH_NUMERATOR (750) / 120 = round(6.25) = 6
    // -> stepFrames = 6; each 8-frame IOI quantizes to max(1,round(8/6))=1 sixteenth
    await hydrateOneTune({
      file_md5: MD5, subtune_index: 0,
      meta: { title: "PhraseTest", composer: "Riff", hvsc_path: "/p.sid", tempo_bpm: 120 },
      instruments: [], patches: [], events, filter_curve: [], pulsewidth: [],
      structure: { sections: [] },
      driver: { hash: "d" }, vibrato: [],
    } as any, { falkor: c, skipQdrant: true });

    // A Phrase node must exist.
    const phrases = await c.rawQuery<{ n: number }>("MATCH (p:Phrase) RETURN count(p) AS n");
    expect(Number(phrases[0].n)).toBeGreaterThanOrEqual(1);

    // The Tune->VoicePart->USES_PHRASE->Phrase chain must exist.
    const edges = await c.rawQuery<{ n: number }>(
      `MATCH (:Tune {file_md5:$m})-[:HAS_VOICE]->(:VoicePart)-[r:USES_PHRASE]->(:Phrase)
       RETURN count(r) AS n`,
      { m: MD5 });
    expect(Number(edges[0].n)).toBeGreaterThanOrEqual(1);
  });
});
