import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorHvscClient } from "../../services/falkor-hvsc.js";
import { hydrateOneTune } from "../hydrate.js";

const GRAPH = "c64_hvsc_hydrate_harmony_test";
const MD5 = "e".repeat(32);
let c: FalkorHvscClient;

beforeAll(async () => {
  c = new FalkorHvscClient({ graphName: GRAPH });
  await c.connect();
  await c.dropGraph();
});
afterAll(async () => { await c.dropGraph(); await c.disconnect(); });

describe("hydrate harmony", () => {
  it("mines a per-section progression and links Section-HAS_PROGRESSION", async () => {
    // Section 0..200: window 0 = C maj (60,64,67), window 1 = G maj (67,71,74).
    // tempo 30 bpm -> frames/beat = round(3000/30) = 100, so two 100-frame windows.
    const mk = (start: number, midis: number[]) =>
      midis.flatMap((m, i) => {
        const pitch = 440 * Math.pow(2, (m - 69) / 12);
        return [
          { frame: start, voice: 1 + i, kind: "on", pitch, sid_chip: 1, waveform: "pulse" },
          { frame: start + 100, voice: 1 + i, kind: "off", pitch: 0, sid_chip: 1 },
        ];
      });
    const events = [...mk(0, [60, 64, 67]), ...mk(100, [67, 71, 74])];
    await hydrateOneTune({
      file_md5: MD5, subtune_index: 0,
      meta: { title: "H", composer: "X", hvsc_path: "/h", key_signature: "C", key_mode: "major", tempo_bpm: 30 },
      instruments: [], patches: [], events, filter_curve: [], pulsewidth: [],
      structure: { sections: [{ label: "A", start_frame: 0, end_frame: 200 }], repeat_shape: "A", intro_frames: 0 },
      driver: { hash: "d" }, vibrato: [],
    } as any, { falkor: c, skipQdrant: true });

    const rows = await c.rawQuery<{ d: string }>(
      `MATCH (:Tune {file_md5:$m})-[:HAS_SECTION]->(:Section)-[:HAS_PROGRESSION]->(p:Progression) RETURN p.degrees AS d`,
      { m: MD5 });
    expect(rows.length).toBe(1);
    expect(rows[0].d).toBe("0maj-7maj");
  });

  it("skips harmony when key is missing", async () => {
    const md5b = "f".repeat(32);
    await hydrateOneTune({
      file_md5: md5b, subtune_index: 0,
      meta: { title: "H2", composer: "X", hvsc_path: "/h2" }, // no key_signature
      instruments: [], patches: [], events: [
        { frame: 0, voice: 1, kind: "on", pitch: 440, sid_chip: 1, waveform: "pulse" },
        { frame: 50, voice: 1, kind: "off", pitch: 0, sid_chip: 1 },
      ],
      filter_curve: [], pulsewidth: [],
      structure: { sections: [{ label: "A", start_frame: 0, end_frame: 100 }] },
      driver: { hash: "d" }, vibrato: [],
    } as any, { falkor: c, skipQdrant: true });
    const rows = await c.rawQuery<{ n: number }>(
      `MATCH (:Tune {file_md5:$m})-[:HAS_SECTION]->(:Section)-[:HAS_PROGRESSION]->(:Progression) RETURN count(*) AS n`,
      { m: md5b });
    expect(Number(rows[0].n)).toBe(0);
  });
});
