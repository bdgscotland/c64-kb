import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorHvscClient } from "../falkor-hvsc.js";
const GRAPH = "c64_hvsc_arp_upsert_test", MD5 = "a".repeat(32);
let c: FalkorHvscClient;
beforeAll(async () => {
  c = new FalkorHvscClient({ graphName: GRAPH }); await c.connect(); await c.dropGraph();
  await c.upsertTune({ file_md5: MD5, subtune_index: 0, title: "T", composer: "X",
    year: null, chip: "either", region: "PAL", length_sec: null, hvsc_path: "/x" });
  await c.upsertVoiceParts(MD5, 0, [{ voice: 1, sid_chip: 1, role: "arp", avgPitchHz: 440,
    pitchRange: 12, noteCount: 60, noisePercent: 0, avgGateLengthFrames: 1, rhythmRegularity: 0.95 }]);
});
afterAll(async () => { await c.dropGraph(); await c.disconnect(); });
describe("upsertArps", () => {
  it("creates a deduped Arp + VoicePart-USES_ARP", async () => {
    await c.upsertArps(MD5, 0, [
      { key: "0,3,7|0,3,7|r2", chord_intervals: [0,3,7], cycle: [0,3,7], n_steps: 3, rate_frames: 2, voice: 1, sid_chip: 1, occurrences: 4 },
      { key: "0,3,7|0,3,7|r2", chord_intervals: [0,3,7], cycle: [0,3,7], n_steps: 3, rate_frames: 2, voice: 1, sid_chip: 1, occurrences: 2 },
    ]);
    const n = await c.rawQuery<{ n: number }>("MATCH (a:Arp) RETURN count(a) AS n");
    expect(Number(n[0].n)).toBe(1);
    const e = await c.rawQuery<{ n: number; occ: number }>(
      "MATCH (:VoicePart)-[r:USES_ARP]->(:Arp) RETURN count(r) AS n, max(r.occurrences) AS occ");
    expect(Number(e[0].n)).toBe(1);
    const a = await c.rawQuery<{ ci: string; cy: string; r: number }>(
      "MATCH (a:Arp) RETURN a.chord_intervals AS ci, a.cycle AS cy, a.rate_frames AS r");
    expect(a[0].ci).toBe("0,3,7"); expect(a[0].cy).toBe("0,3,7"); expect(Number(a[0].r)).toBe(2);
  });
});
