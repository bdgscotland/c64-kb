import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { hydrateOneTune } from "../hydrate.js";
import type { CatalogEnrichment } from "../hydrate.js";
import { FalkorHvscClient } from "../../services/falkor-hvsc.js";

const TEST_GRAPH = `c64_hvsc_hydrate_test_${Date.now()}`;

const FAKE_EXTRACT = {
  kind: "extract" as const,
  file_md5: "b".repeat(32),
  subtune_index: 0,
  meta: {
    title: "Hydrate Test",
    composer: "Test Composer",
    year: 1987,
    chip: "6581" as const,
    region: "PAL" as const,
    length_sec: 95,
    hvsc_path: "/test.sid",
    subtune_count: 1,
  },
  events: [],
  instruments: [],
  patches: [],
  filter_curve: [],
  pulsewidth: [],
  vibrato: [],
  structure: { sections: [] },
  driver: { hash: "deadbeef", init_offset: 0, play_offset: 3, byte_signature: "20 c1 10" },
  pipeline_version: "0.1.0",
  clustering_params_hash: "test",
};

describe("hydrateOneTune", () => {
  let falkor: FalkorHvscClient;

  beforeAll(async () => {
    falkor = new FalkorHvscClient({ graphName: TEST_GRAPH });
    await falkor.connect();
  });

  afterAll(async () => {
    await falkor.dropGraph();
    await falkor.disconnect();
  });

  it("writes a Tune node + Composer + COMPOSED_BY edge", async () => {
    await hydrateOneTune(FAKE_EXTRACT, { falkor, skipQdrant: true });
    expect(await falkor.tuneCount()).toBe(1);
  });

  it("is idempotent — re-hydrating doesn't duplicate", async () => {
    await hydrateOneTune(FAKE_EXTRACT, { falkor, skipQdrant: true });
    await hydrateOneTune(FAKE_EXTRACT, { falkor, skipQdrant: true });
    expect(await falkor.tuneCount()).toBe(1);
  });

  it("persists extract.structure as Section nodes + tune-level repeat_shape", async () => {
    const structured = {
      ...FAKE_EXTRACT,
      file_md5: "f".repeat(32),
      meta: { ...FAKE_EXTRACT.meta, title: "Structured Hydrate" },
      structure: {
        repeat_shape: "AB",
        intro_frames: 25,
        sections: [
          { label: "A", start_frame: 0, end_frame: 150, repeat_of: null },
          { label: "B", start_frame: 150, end_frame: 300, repeat_of: null },
        ],
      },
    };
    await hydrateOneTune(structured, { falkor, skipQdrant: true });

    const sections = await falkor.rawQuery<{ label: string; order: number }>(
      `MATCH (:Tune {file_md5: $f})-[:HAS_SECTION]->(s:Section)
       RETURN s.label AS label, s.order AS order ORDER BY s.order`,
      { f: "f".repeat(32) }
    );
    expect(sections.map((s) => s.label)).toEqual(["A", "B"]);

    const tune = await falkor.rawQuery<{ shape: string }>(
      "MATCH (t:Tune {file_md5: $f}) RETURN t.repeat_shape AS shape",
      { f: "f".repeat(32) }
    );
    expect(tune[0]?.shape).toBe("AB");
  });

  it("mines + persists Motif nodes from extract.events", async () => {
    // Voice 1 plays the interval pattern [+2,+2,-1] (a 4-note motif) twice.
    const note = (frame: number, pitch: number) => ({ frame, voice: 1, kind: "on", pitch, gate: true, adsr: [0, 0, 0, 0], sid_chip: 1 });
    // C4=261.63, D4=293.66, E4=329.63, D#4=311.13 → intervals [+2,+2,-1] repeated.
    const seq = [261.63, 293.66, 329.63, 311.13];
    const events = [
      ...seq.map((p, i) => note(i * 10, p)),
      ...seq.map((p, i) => note(100 + i * 10, p)),
    ];
    const extract = {
      ...FAKE_EXTRACT,
      file_md5: "e".repeat(32),
      meta: { ...FAKE_EXTRACT.meta, title: "Motif Hydrate" },
      events,
      structure: { sections: [] },
    };
    await hydrateOneTune(extract, { falkor, skipQdrant: true });

    const motifs = await falkor.rawQuery<{ intervals: string; occ: number }>(
      `MATCH (:Tune {file_md5: $f})-[r:USES_MOTIF]->(m:Motif)
       RETURN m.intervals AS intervals, r.occurrences AS occ`,
      { f: "e".repeat(32) }
    );
    expect(motifs.length).toBeGreaterThanOrEqual(1);
    expect(JSON.parse(motifs[0].intervals)).toEqual([2, 2, -1]);
    expect(motifs[0].occ).toBe(2);
  });

  it("classifies + persists VoicePart nodes from extract.events", async () => {
    const md5 = "1".repeat(32);
    // Voice 3: noise notes → percussion.
    const noiseNote = (on: number) => [
      { frame: on, voice: 3, kind: "on", pitch: 100, gate: true, adsr: [0, 0, 0, 0], sid_chip: 1, waveform: "noise" },
      { frame: on + 2, voice: 3, kind: "off", pitch: 100, gate: false, adsr: [0, 0, 0, 0], sid_chip: 1, waveform: "" },
    ];
    const events = [0, 8, 16, 24, 32, 40].flatMap(noiseNote);
    const extract = {
      ...FAKE_EXTRACT, file_md5: md5,
      meta: { ...FAKE_EXTRACT.meta, title: "Voice Hydrate" },
      events, structure: { sections: [] },
    };
    await hydrateOneTune(extract, { falkor, skipQdrant: true });

    const vps = await falkor.rawQuery<{ voice: number; role: string }>(
      `MATCH (:Tune {file_md5: $f})-[:HAS_VOICE]->(v:VoicePart)
       RETURN v.voice AS voice, v.role AS role`, { f: md5 });
    expect(vps).toHaveLength(1);
    expect(vps[0].voice).toBe(3);
    expect(vps[0].role).toBe("percussion");
  });
});

describe("hydrateOneTune with enrichment", () => {
  it("accepts and forwards length_sec + stil_comment to upsertTune", async () => {
    const calls: any[] = [];
    const mockFalkor: any = {
      upsertTune: async (t: any) => { calls.push(t); },
    };
    const extract: any = {
      kind: "extract",
      file_md5: "testmd5",
      subtune_index: 0,
      meta: { title: "T", composer: "C", year: 1990, chip: "6581", region: "PAL", hvsc_path: "/T.sid" },
      events: [], instruments: [], structure: {}, driver: {},
    };
    const enrichment: CatalogEnrichment = {
      length_sec: 123.45,
      stil_comment: "test comment",
      stil_credits: [],
    };
    await hydrateOneTune(extract, { falkor: mockFalkor as any, skipQdrant: true }, enrichment);
    expect(calls).toHaveLength(1);
    expect(calls[0].length_sec).toBe(123.45);
    expect(calls[0].stil_comment).toBe("test comment");
  });

  it("defaults enrichment to empty when omitted — existing callers unaffected", async () => {
    const calls: any[] = [];
    const mockFalkor: any = {
      upsertTune: async (t: any) => { calls.push(t); },
    };
    const extract: any = {
      kind: "extract",
      file_md5: "testmd52",
      subtune_index: 0,
      meta: { title: "T2", composer: "C2", year: 1991, chip: "8580", region: "NTSC", hvsc_path: "/T2.sid", length_sec: 60 },
      events: [], instruments: [], structure: {}, driver: {},
    };
    await hydrateOneTune(extract, { falkor: mockFalkor as any, skipQdrant: true });
    expect(calls).toHaveLength(1);
    // Falls back to meta.length_sec when no enrichment supplied
    expect(calls[0].length_sec).toBe(60);
    expect(calls[0].stil_comment).toBe("");
  });
});
