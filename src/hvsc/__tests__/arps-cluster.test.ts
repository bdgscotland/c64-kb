import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorHvscClient } from "../../services/falkor-hvsc.js";
import { clusterArpsInGraph } from "../cluster-arps.js";
const GRAPH = "c64_hvsc_arp_cluster_test";
let c: FalkorHvscClient;
const arp = { key: "0,3,7|0,3,7|r2", chord_intervals: [0,3,7], cycle: [0,3,7], n_steps: 3, rate_frames: 2, voice: 1, sid_chip: 1, occurrences: 3 };
beforeAll(async () => {
  c = new FalkorHvscClient({ graphName: GRAPH }); await c.connect(); await c.dropGraph();
  for (const md5 of ["a".repeat(32), "b".repeat(32)]) {
    await c.upsertTune({ file_md5: md5, subtune_index: 0, title: "T", composer: "Rob Hubbard",
      year: null, chip: "either", region: "PAL", length_sec: null, hvsc_path: "/x" });
    await c.upsertVoiceParts(md5, 0, [{ voice: 1, sid_chip: 1, role: "arp", avgPitchHz: 440,
      pitchRange: 12, noteCount: 60, noisePercent: 0, avgGateLengthFrames: 1, rhythmRegularity: 0.95 }]);
    await c.upsertArps(md5, 0, [arp]);
  }
  await clusterArpsInGraph(c);
});
afterAll(async () => { await c.dropGraph(); await c.disconnect(); });
describe("clusterArpsInGraph", () => {
  it("aggregates FAVORS_ARP weight via bound-alias (not flattened to 1)", async () => {
    const r = await c.rawQuery<{ w: number }>(
      "MATCH (:Composer)-[r:FAVORS_ARP]->(:Arp) RETURN max(r.weight) AS w");
    expect(Number(r[0].w)).toBe(2);
  });
});
