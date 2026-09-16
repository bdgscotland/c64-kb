import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorHvscClient } from "../falkor-hvsc.js";
const GRAPH = "c64_hvsc_phrase_test", MD5 = "a".repeat(32);
let c: FalkorHvscClient;
beforeAll(async () => {
  c = new FalkorHvscClient({ graphName: GRAPH }); await c.connect(); await c.dropGraph();
  await c.upsertTune({ file_md5: MD5, subtune_index: 0, title: "T", composer: "X",
    year: null, chip: "either", region: "PAL", length_sec: null, hvsc_path: "/x" });
  await c.upsertVoiceParts(MD5, 0, [{ voice: 1, sid_chip: 1, role: "lead", avgPitchHz: 440,
    pitchRange: 12, noteCount: 10, noisePercent: 0, avgGateLengthFrames: 6, rhythmRegularity: 0.5 }]);
});
afterAll(async () => { await c.dropGraph(); await c.disconnect(); });
describe("upsertPhrases", () => {
  it("creates deduped Phrase + VoicePart-USES_PHRASE", async () => {
    await c.upsertPhrases(MD5, 0, [
      { key: "4,-2|1:1;1:1;1:1", intervals: [4,-2], iois: [1,1,1], gates: [1,1,1], voice: 1, sid_chip: 1, occurrences: 3 },
      { key: "4,-2|1:1;1:1;1:1", intervals: [4,-2], iois: [1,1,1], gates: [1,1,1], voice: 1, sid_chip: 1, occurrences: 2 },
    ]);
    const n = await c.rawQuery<{ n: number }>("MATCH (p:Phrase) RETURN count(p) AS n");
    expect(Number(n[0].n)).toBe(1);
    const e = await c.rawQuery<{ n: number; occ: number }>("MATCH (:VoicePart)-[r:USES_PHRASE]->(:Phrase) RETURN count(r) AS n, max(r.occurrences) AS occ");
    expect(Number(e[0].n)).toBe(1);
  });
});
