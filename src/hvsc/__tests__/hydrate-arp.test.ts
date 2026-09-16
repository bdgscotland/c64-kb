import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorHvscClient } from "../../services/falkor-hvsc.js";
import { hydrateOneTune } from "../hydrate.js";
const GRAPH = "c64_hvsc_hydrate_arp_test";
let c: FalkorHvscClient;
beforeAll(async () => {
  c = new FalkorHvscClient({ graphName: GRAPH }); await c.connect(); await c.dropGraph();
  const md5 = "a".repeat(32); const cyc = [60, 63, 67]; const events: any[] = []; let f = 0;
  for (let i = 0; i < 18; i++) {
    events.push({ frame: f, voice: 1, kind: "on", pitch: 440 * Math.pow(2, (cyc[i % 3] - 69) / 12), sid_chip: 1, waveform: "pulse" });
    events.push({ frame: f + 1, voice: 1, kind: "off", pitch: 0, sid_chip: 1 }); f += 2;
  }
  await hydrateOneTune({
    file_md5: md5, subtune_index: 0,
    meta: { title: "T", composer: "Test Composer", hvsc_path: "/x", tempo_bpm: 125 },
    instruments: [], events,
    patches: [{ patch_hash: "p1", waveform: "pulse", adsr: [0,2,4,4], hard_restart: "", voice: 1, sid_chip: 1 }],
    filter_curve: [], pulsewidth: [], structure: {}, driver: { hash: "d" }, vibrato: [],
  } as any, { falkor: c, skipQdrant: true });
});
afterAll(async () => { await c.dropGraph(); await c.disconnect(); });
describe("hydrate arps", () => {
  it("creates USES_ARP for a fast-cycle voice", async () => {
    const r = await c.rawQuery<{ n: number }>("MATCH (:VoicePart)-[u:USES_ARP]->(:Arp) RETURN count(u) AS n");
    expect(Number(r[0].n)).toBeGreaterThan(0);
  });
});
