import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorHvscClient } from "../../services/falkor-hvsc.js";
import { clusterArpsInGraph } from "../../hvsc/cluster-arps.js";
import { c64ArpLookup } from "../palette-mcp.js";
const GRAPH = "c64_hvsc_arp_lookup_test", MD5 = "a".repeat(32);
let c: FalkorHvscClient;
beforeAll(async () => {
  c = new FalkorHvscClient({ graphName: GRAPH }); await c.connect(); await c.dropGraph();
  await c.upsertTune({ file_md5: MD5, subtune_index: 0, title: "T", composer: "Rob Hubbard",
    year: null, chip: "either", region: "PAL", length_sec: null, hvsc_path: "/x" });
  await c.upsertVoiceParts(MD5, 0, [{ voice: 1, sid_chip: 1, role: "arp", avgPitchHz: 440,
    pitchRange: 12, noteCount: 60, noisePercent: 0, avgGateLengthFrames: 1, rhythmRegularity: 0.95 }]);
  await c.upsertArps(MD5, 0, [{ key: "0,3,7|0,3,7|r2", chord_intervals: [0,3,7], cycle: [0,3,7], n_steps: 3, rate_frames: 2, voice: 1, sid_chip: 1, occurrences: 4 }]);
  await clusterArpsInGraph(c);
});
afterAll(async () => { await c.dropGraph(); await c.disconnect(); });
describe("c64ArpLookup", () => {
  it("returns favoured arps with chord/cycle/rate", async () => {
    const r = await c64ArpLookup({ composer: "Rob Hubbard", graphName: GRAPH });
    expect(r.arps.length).toBe(1);
    expect(r.arps[0].chord_intervals).toEqual([0,3,7]);
    expect(r.arps[0].cycle).toEqual([0,3,7]);
    expect(r.arps[0].rate_frames).toBe(2);
    expect(r.arps[0].quality).toBe("min");
    expect(r.arps[0].weight).toBe(1);
  });
});
