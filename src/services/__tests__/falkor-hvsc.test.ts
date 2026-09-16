import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorHvscClient } from "../falkor-hvsc.js";

const TEST_GRAPH = `c64_hvsc_test_${Date.now()}`;

describe("FalkorHvscClient", () => {
  let client: FalkorHvscClient;

  beforeAll(async () => {
    client = new FalkorHvscClient({ graphName: TEST_GRAPH });
    await client.connect();
  });

  afterAll(async () => {
    await client.dropGraph();
    await client.disconnect();
  });

  it("creates a Tune node with composite (file_md5, subtune_index) key", async () => {
    await client.upsertTune({
      file_md5: "a".repeat(32),
      subtune_index: 0,
      title: "Test Tune",
      composer: "Test Composer",
      year: 2026,
      chip: "6581",
      region: "PAL",
      length_sec: 120,
      hvsc_path: "/test.sid",
    });
    expect(await client.tuneCount()).toBe(1);

    // Idempotent re-upsert: same composite key produces no duplicates
    await client.upsertTune({
      file_md5: "a".repeat(32),
      subtune_index: 0,
      title: "Test Tune",
      composer: "Test Composer",
      year: 2026,
      chip: "6581",
      region: "PAL",
      length_sec: 120,
      hvsc_path: "/test.sid",
    });
    expect(await client.tuneCount()).toBe(1);

    // Different subtune of same file = new node (composite key)
    await client.upsertTune({
      file_md5: "a".repeat(32),
      subtune_index: 1,
      title: "Test Tune sub01",
      composer: "Test Composer",
      year: 2026,
      chip: "6581",
      region: "PAL",
      length_sec: 60,
      hvsc_path: "/test.sid",
    });
    expect(await client.tuneCount()).toBe(2);
  });
});

describe("FalkorHvscClient.upsertSections", () => {
  const GRAPH = `c64_hvsc_sections_test_${Date.now()}`;
  const F = "c".repeat(32);
  let client: FalkorHvscClient;

  const baseTune = {
    file_md5: F,
    subtune_index: 0,
    title: "Structured Tune",
    composer: "Test Composer",
    year: 1988,
    chip: "6581" as const,
    region: "PAL" as const,
    length_sec: 100,
    hvsc_path: "/struct.sid",
  };

  const structure = {
    repeat_shape: "ABA",
    intro_frames: 50,
    sections: [
      { label: "A", start_frame: 0, end_frame: 100, repeat_of: null },
      { label: "B", start_frame: 100, end_frame: 200, repeat_of: null },
      { label: "A'", start_frame: 200, end_frame: 300, repeat_of: "A" },
    ],
  };

  beforeAll(async () => {
    client = new FalkorHvscClient({ graphName: GRAPH });
    await client.connect();
    await client.upsertTune(baseTune);
  });

  afterAll(async () => {
    await client.dropGraph();
    await client.disconnect();
  });

  async function sectionCount(): Promise<number> {
    const r = await client.rawQuery<{ n: number }>(
      "MATCH (:Tune {file_md5: $f, subtune_index: 0})-[:HAS_SECTION]->(s:Section) RETURN count(s) AS n",
      { f: F }
    );
    return Number(r[0]?.n ?? 0);
  }

  async function nextCount(): Promise<number> {
    const r = await client.rawQuery<{ n: number }>(
      "MATCH (:Section {file_md5: $f})-[r:NEXT]->(:Section) RETURN count(r) AS n",
      { f: F }
    );
    return Number(r[0]?.n ?? 0);
  }

  it("creates ordered Section nodes + HAS_SECTION + NEXT chain", async () => {
    await client.upsertSections(F, 0, structure);

    expect(await sectionCount()).toBe(3);
    expect(await nextCount()).toBe(2);

    const rows = await client.rawQuery<{
      label: string;
      start_frame: number;
      end_frame: number;
      repeat_of: string | null;
      order: number;
      length_frames: number;
    }>(
      `MATCH (:Tune {file_md5: $f, subtune_index: 0})-[:HAS_SECTION]->(s:Section)
       RETURN s.label AS label, s.start_frame AS start_frame, s.end_frame AS end_frame,
              s.repeat_of AS repeat_of, s.order AS order, s.length_frames AS length_frames
       ORDER BY s.order`,
      { f: F }
    );
    expect(rows.map((r) => r.label)).toEqual(["A", "B", "A'"]);
    expect(rows.map((r) => r.order)).toEqual([0, 1, 2]);
    expect(rows[2].repeat_of).toBe("A");
    expect(rows[0].length_frames).toBe(100);
  });

  it("records repeat_shape + intro_frames on the Tune", async () => {
    const r = await client.rawQuery<{ shape: string; intro: number }>(
      "MATCH (t:Tune {file_md5: $f, subtune_index: 0}) RETURN t.repeat_shape AS shape, t.intro_frames AS intro",
      { f: F }
    );
    expect(r[0]?.shape).toBe("ABA");
    expect(r[0]?.intro).toBe(50);
  });

  it("is idempotent — re-running does not duplicate sections or edges", async () => {
    await client.upsertSections(F, 0, structure);
    expect(await sectionCount()).toBe(3);
    expect(await nextCount()).toBe(2);
  });

  it("replaces sections when the section list changes (delete-then-create)", async () => {
    await client.upsertSections(F, 0, {
      repeat_shape: "loop",
      intro_frames: 0,
      sections: [{ label: "loop", start_frame: 0, end_frame: 400, repeat_of: null }],
    });
    expect(await sectionCount()).toBe(1);
    expect(await nextCount()).toBe(0);
    const r = await client.rawQuery<{ shape: string }>(
      "MATCH (t:Tune {file_md5: $f, subtune_index: 0}) RETURN t.repeat_shape AS shape",
      { f: F }
    );
    expect(r[0]?.shape).toBe("loop");
  });

  it("handles empty structure without error", async () => {
    await client.upsertSections(F, 0, { sections: [] });
    expect(await sectionCount()).toBe(0);
  });
});

describe("FalkorHvscClient.upsertMotifs", () => {
  const GRAPH = `c64_hvsc_motifs_test_${Date.now()}`;
  const F = "d".repeat(32);
  let client: FalkorHvscClient;

  beforeAll(async () => {
    client = new FalkorHvscClient({ graphName: GRAPH });
    await client.connect();
    await client.upsertTune({
      file_md5: F,
      subtune_index: 0,
      title: "Motif Tune",
      composer: "Test Composer",
      year: 1989,
      chip: "6581",
      region: "PAL",
      length_sec: 100,
      hvsc_path: "/motif.sid",
    });
  });

  afterAll(async () => {
    await client.dropGraph();
    await client.disconnect();
  });

  async function motifCount(): Promise<number> {
    const r = await client.rawQuery<{ n: number }>("MATCH (m:Motif) RETURN count(m) AS n");
    return Number(r[0]?.n ?? 0);
  }
  async function usesCount(): Promise<number> {
    const r = await client.rawQuery<{ n: number }>(
      "MATCH (:Tune {file_md5: $f})-[r:USES_MOTIF]->(:Motif) RETURN count(r) AS n",
      { f: F }
    );
    return Number(r[0]?.n ?? 0);
  }

  it("creates Motif nodes (deduped by motif_hash) + USES_MOTIF edges", async () => {
    await client.upsertMotifs(F, 0, [
      { intervals: [2, 2, -1], voice: 1, occurrences: 3 },
      { intervals: [0, 5, -5], voice: 2, occurrences: 2 },
    ]);
    expect(await motifCount()).toBe(2);
    expect(await usesCount()).toBe(2);

    const rows = await client.rawQuery<{ intervals: string; n_notes: number; occ: number; voice: number }>(
      `MATCH (:Tune {file_md5: $f})-[r:USES_MOTIF]->(m:Motif)
       RETURN m.intervals AS intervals, m.n_notes AS n_notes, r.occurrences AS occ, r.voice AS voice
       ORDER BY r.voice`,
      { f: F }
    );
    expect(JSON.parse(rows[0].intervals)).toEqual([2, 2, -1]);
    expect(rows[0].n_notes).toBe(4);
    expect(rows[0].occ).toBe(3);
  });

  it("dedupes the same interval sequence across calls (global Motif vocab)", async () => {
    // Same intervals as voice-1 motif above → same motif_hash → no new node.
    await client.upsertMotifs(F, 0, [{ intervals: [2, 2, -1], voice: 1, occurrences: 3 }]);
    expect(await motifCount()).toBe(2);
    expect(await usesCount()).toBe(2);
  });
});

describe("FalkorHvscClient.upsertRhythm", () => {
  const GRAPH = `c64_hvsc_rhythm_test_${Date.now()}`;
  const F = "f".repeat(32);
  let client: FalkorHvscClient;

  beforeAll(async () => {
    client = new FalkorHvscClient({ graphName: GRAPH });
    await client.connect();
    await client.upsertTune({
      file_md5: F, subtune_index: 0, title: "Rhythm Tune", composer: "Test",
      year: 1990, chip: "6581", region: "PAL", length_sec: 100, hvsc_path: "/r.sid",
    });
  });
  afterAll(async () => { await client.dropGraph(); await client.disconnect(); });

  it("creates RhythmCell nodes (deduped by rhythm_hash) + USES_RHYTHM edges", async () => {
    await client.upsertRhythm(F, 0, [
      { slots: [[1, 1], [1, 1], [2, 1], [1, 1]], voice: 1, occurrences: 3 },
      { slots: [[1, 1], [1, 1], [2, 1], [1, 1]], voice: 2, occurrences: 2 }, // same cell, other voice
    ]);
    const cells = await client.rawQuery<{ n: number }>("MATCH (rc:RhythmCell) RETURN count(rc) AS n");
    expect(Number(cells[0].n)).toBe(1); // deduped by rhythm_hash
    const edges = await client.rawQuery<{ n: number }>(
      "MATCH (:Tune)-[r:USES_RHYTHM]->(:RhythmCell) RETURN count(r) AS n");
    expect(Number(edges[0].n)).toBe(2); // one per voice
    const occ = await client.rawQuery<{ o: number }>(
      "MATCH (:Tune)-[r:USES_RHYTHM {voice:1}]->(:RhythmCell) RETURN r.occurrences AS o");
    expect(Number(occ[0].o)).toBe(3);
  });
});

describe("FalkorHvscClient.upsertVoiceParts", () => {
  const GRAPH = `c64_hvsc_voice_test_${Date.now()}`;
  const F = "e".repeat(32);
  let client: FalkorHvscClient;

  beforeAll(async () => {
    client = new FalkorHvscClient({ graphName: GRAPH });
    await client.connect();
    await client.upsertTune({
      file_md5: F, subtune_index: 0, title: "Voice Tune", composer: "Test Composer",
      year: 1990, chip: "6581", region: "PAL", length_sec: 100, hvsc_path: "/voice.sid",
    });
    // A motif on voice 1, so PLAYS can link.
    await client.upsertMotifs(F, 0, [{ intervals: [2, 2, -1], voice: 1, occurrences: 3 }]);
    // A patch on voice 1 only, so PLAYS_PATCH links voice 1 but not voice 3.
    await client.upsertPatches(F, 0, [
      {
        patch_hash: "patchvoice0001", waveform: "pulse", adsr: [0, 9, 10, 9],
        filter_routed: false, hard_restart: "", ring_mod: false, hard_sync: false,
        duration_frames: 10, voice: 1, sid_chip: 1, occurrences: 4,
      },
    ]);
    // A rhythm cell on voice 1 only, so PLAYS_RHYTHM links voice 1 but not voice 3.
    await client.upsertRhythm(F, 0, [
      { slots: [[1, 1], [1, 1], [2, 1], [1, 1]], voice: 1, occurrences: 3 },
    ]);
  });

  afterAll(async () => {
    await client.dropGraph();
    await client.disconnect();
  });

  const parts = [
    { voice: 1, sid_chip: 1, role: "bass", avgPitchHz: 90, pitchRange: 60, noteCount: 32, noisePercent: 0, avgGateLengthFrames: 12, rhythmRegularity: 0.9 },
    { voice: 3, sid_chip: 1, role: "percussion", avgPitchHz: 0, pitchRange: 0, noteCount: 40, noisePercent: 0.85, avgGateLengthFrames: 2, rhythmRegularity: 0.95 },
  ];

  async function vpCount(): Promise<number> {
    const r = await client.rawQuery<{ n: number }>(
      "MATCH (:Tune {file_md5: $f})-[:HAS_VOICE]->(v:VoicePart) RETURN count(v) AS n", { f: F });
    return Number(r[0]?.n ?? 0);
  }

  it("creates VoicePart nodes + HAS_VOICE + PLAYS->Motif by voice", async () => {
    await client.upsertVoiceParts(F, 0, parts);
    expect(await vpCount()).toBe(2);

    const rows = await client.rawQuery<{ voice: number; role: string; noise: number }>(
      `MATCH (:Tune {file_md5: $f})-[:HAS_VOICE]->(v:VoicePart)
       RETURN v.voice AS voice, v.role AS role, v.noise_percent AS noise ORDER BY v.voice`, { f: F });
    expect(rows.map((r) => r.role)).toEqual(["bass", "percussion"]);

    // voice-1 VoicePart PLAYS the voice-1 motif
    const plays = await client.rawQuery<{ n: number }>(
      `MATCH (v:VoicePart {file_md5: $f, voice: 1})-[:PLAYS]->(:Motif) RETURN count(*) AS n`, { f: F });
    expect(Number(plays[0]?.n ?? 0)).toBe(1);
  });

  it("is idempotent (delete-then-create)", async () => {
    await client.upsertVoiceParts(F, 0, parts);
    expect(await vpCount()).toBe(2);
    const plays = await client.rawQuery<{ n: number }>(
      `MATCH (:VoicePart {file_md5: $f, voice: 1})-[r:PLAYS]->(:Motif) RETURN count(r) AS n`, { f: F });
    expect(Number(plays[0]?.n ?? 0)).toBe(1);
  });

  it("links VoicePart-PLAYS_PATCH->Patch by matching USES_PATCH voice + sid_chip", async () => {
    await client.upsertVoiceParts(F, 0, parts);
    // voice-1 VoicePart PLAYS_PATCH the voice-1 patch (exactly one, not duplicated)
    const v1 = await client.rawQuery<{ n: number }>(
      `MATCH (:VoicePart {file_md5: $f, voice: 1})-[r:PLAYS_PATCH]->(:Patch) RETURN count(r) AS n`, { f: F });
    expect(Number(v1[0]?.n ?? 0)).toBe(1);
    // voice-3 VoicePart has no patch on its voice -> no PLAYS_PATCH edge
    const v3 = await client.rawQuery<{ n: number }>(
      `MATCH (:VoicePart {file_md5: $f, voice: 3})-[r:PLAYS_PATCH]->(:Patch) RETURN count(r) AS n`, { f: F });
    expect(Number(v3[0]?.n ?? 0)).toBe(0);
  });

  it("links VoicePart-PLAYS_RHYTHM->RhythmCell by matching USES_RHYTHM.voice", async () => {
    await client.upsertVoiceParts(F, 0, parts);
    const v1 = await client.rawQuery<{ n: number }>(
      `MATCH (:VoicePart {file_md5: $f, voice: 1})-[r:PLAYS_RHYTHM]->(:RhythmCell) RETURN count(r) AS n`, { f: F });
    expect(Number(v1[0]?.n ?? 0)).toBe(1);
    const v3 = await client.rawQuery<{ n: number }>(
      `MATCH (:VoicePart {file_md5: $f, voice: 3})-[r:PLAYS_RHYTHM]->(:RhythmCell) RETURN count(r) AS n`, { f: F });
    expect(Number(v3[0]?.n ?? 0)).toBe(0);
  });
});
