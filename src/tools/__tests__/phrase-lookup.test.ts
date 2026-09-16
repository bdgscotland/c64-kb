import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorHvscClient } from "../../services/falkor-hvsc.js";
import { clusterPhrasesInGraph } from "../../hvsc/cluster-phrases.js";
import { c64PhraseLookup, c64ComposerPalette } from "../palette-mcp.js";

const GRAPH = "c64_hvsc_phraselookup_test";
const MD5A = "a".repeat(32);
const MD5B = "b".repeat(32);
let c: FalkorHvscClient;

beforeAll(async () => {
  c = new FalkorHvscClient({ graphName: GRAPH });
  await c.connect();
  await c.dropGraph();

  // Two tunes by the same composer so FAVORS_PHRASE weight can be > 1
  for (const [md5, idx] of [[MD5A, 0], [MD5B, 0]] as [string, number][]) {
    await c.upsertTune({
      file_md5: md5, subtune_index: idx, title: "T", composer: "Test Composer",
      year: null, chip: "either", region: "PAL", length_sec: null, hvsc_path: "/x",
    });
    await c.upsertVoiceParts(md5, idx, [
      {
        voice: 1, sid_chip: 1, role: "lead", avgPitchHz: 440, pitchRange: 12,
        noteCount: 10, noisePercent: 0, avgGateLengthFrames: 6, rhythmRegularity: 0.5,
      },
      {
        voice: 2, sid_chip: 1, role: "bass", avgPitchHz: 220, pitchRange: 7,
        noteCount: 8, noisePercent: 0, avgGateLengthFrames: 8, rhythmRegularity: 0.6,
      },
    ]);
    await c.upsertPhrases(md5, idx, [
      // shared phrase across both tunes — FAVORS weight should be 2
      {
        key: "4,-2|1:1;1:1;1:1",
        intervals: [4, -2], iois: [1, 1, 1], gates: [1, 1, 1],
        voice: 1, sid_chip: 1, occurrences: 3,
      },
      // bass-only phrase
      {
        key: "3,5|2:1;2:1;2:1",
        intervals: [3, 5], iois: [2, 2, 2], gates: [1, 1, 1],
        voice: 2, sid_chip: 1, occurrences: 2,
      },
    ]);
  }
  await clusterPhrasesInGraph(c);
});

afterAll(async () => { await c.dropGraph(); await c.disconnect(); });

describe("c64PhraseLookup — no role", () => {
  it("returns FAVORS_PHRASE ordered by weight with beats_hint", async () => {
    const res = await c64PhraseLookup({ composer: "Test Composer", graphName: GRAPH });
    expect(res.phrases.length).toBeGreaterThanOrEqual(1);
    // beats_hint converts iois/gates from 16ths (×0.25) to beats
    const first = res.phrases[0];
    expect(Array.isArray(first.intervals)).toBe(true);
    expect(Array.isArray(first.iois)).toBe(true);
    expect(Array.isArray(first.gates)).toBe(true);
    expect(typeof first.n_notes).toBe("number");
    expect(typeof first.weight).toBe("number");
    expect(first.weight).toBeGreaterThanOrEqual(1);
    // beats_hint should have iois_beats and gates_beats as ×0.25 of iois/gates
    expect(Array.isArray(first.beats_hint.iois_beats)).toBe(true);
    expect(first.beats_hint.iois_beats[0]).toBeCloseTo(first.iois[0] * 0.25, 5);
    expect(first.beats_hint.gates_beats[0]).toBeCloseTo(first.gates[0] * 0.25, 5);
  });

  it("returns empty for an unknown composer", async () => {
    const res = await c64PhraseLookup({ composer: "Nobody", graphName: GRAPH });
    expect(res.phrases).toEqual([]);
  });
});

describe("c64PhraseLookup — with role", () => {
  it("filters by voice role and aggregates occurrences", async () => {
    const res = await c64PhraseLookup({ composer: "Test Composer", role: "lead", graphName: GRAPH });
    // Only the lead phrase (key "4,-2|...") should appear
    expect(res.phrases.length).toBeGreaterThanOrEqual(1);
    // All returned phrases linked via lead VoiceParts
    const leadIntervals = res.phrases.map((p) => p.intervals.join(","));
    expect(leadIntervals).toContain("4,-2");
    // Should have total occurrences across both tunes (2 tunes × 3 occ = 6)
    const leadPhrase = res.phrases.find((p) => p.intervals.join(",") === "4,-2")!;
    expect(leadPhrase.weight).toBeGreaterThanOrEqual(6);
  });

  it("returns only bass phrases when role=bass", async () => {
    const res = await c64PhraseLookup({ composer: "Test Composer", role: "bass", graphName: GRAPH });
    expect(res.phrases.length).toBeGreaterThanOrEqual(1);
    const intervals = res.phrases.map((p) => p.intervals.join(","));
    expect(intervals).toContain("3,5");
    expect(intervals).not.toContain("4,-2");
  });
});

describe("c64ComposerPalette phrases", () => {
  it("includes top FAVORS_PHRASE in the palette", async () => {
    const res = await c64ComposerPalette({ composer: "Test Composer", graphName: GRAPH });
    expect(Array.isArray(res.phrases)).toBe(true);
    expect(res.phrases.length).toBeGreaterThanOrEqual(1);
    const first = res.phrases[0];
    expect(Array.isArray(first.intervals)).toBe(true);
    expect(typeof first.weight).toBe("number");
    expect(Array.isArray(first.beats_hint.iois_beats)).toBe(true);
  });
});
