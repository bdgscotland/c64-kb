import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorHvscClient } from "../../services/falkor-hvsc.js";
import { hydrateOneTune } from "../hydrate.js";
import { clusterPatchesInGraph } from "../cluster-patches.js";
import { c64InstrumentLookup } from "../../tools/hvsc-mcp.js";

const GRAPH = "c64_hvsc_patch_test";

describe("upsertPatches", () => {
  let c: FalkorHvscClient;
  beforeAll(async () => {
    c = new FalkorHvscClient({ graphName: GRAPH });
    await c.connect();
    await c.dropGraph();
    await c.upsertTune({
      file_md5: "a".repeat(32), subtune_index: 0, title: "T", composer: "X",
      year: null, chip: "either", region: "PAL", length_sec: null, hvsc_path: "/x",
    });
  });
  afterAll(async () => { await c.dropGraph(); await c.disconnect(); });

  it("creates Patch nodes + USES_PATCH edges, deduped by patch_hash", async () => {
    await c.upsertPatches("a".repeat(32), 0, [
      { patch_hash: "h1", waveform: "pulse", adsr: [0, 9, 10, 9], voice: 1, sid_chip: 1, hard_restart: "classic" },
      { patch_hash: "h1", waveform: "pulse", adsr: [0, 9, 10, 9], voice: 2, sid_chip: 1, hard_restart: "classic" },
    ]);
    const patches = await c.rawQuery<{ n: number }>("MATCH (p:Patch) RETURN count(p) AS n");
    expect(Number(patches[0].n)).toBe(1); // deduped by patch_hash
    const edges = await c.rawQuery<{ n: number }>("MATCH (:Tune)-[r:USES_PATCH]->(:Patch) RETURN count(r) AS n");
    expect(Number(edges[0].n)).toBe(2); // one per voice
  });

  it("hydrate persists patches from a TuneExtract", async () => {
    const md5 = "b".repeat(32);
    await hydrateOneTune(
      {
        file_md5: md5, subtune_index: 0,
        meta: { title: "H", composer: "Y", hvsc_path: "/h" },
        instruments: [], patches: [
          { patch_hash: "hp1", waveform: "saw", adsr: [0, 8, 12, 8], hard_restart: "", duration_frames: 10 },
        ],
        events: [], filter_curve: [], pulsewidth: [], structure: {},
        driver: { hash: "d1" },
      } as any,
      { falkor: c, skipQdrant: true },
    );
    const n = await c.rawQuery<{ n: number }>(
      `MATCH (:Tune {file_md5: $m})-[:USES_PATCH]->(p:Patch) RETURN count(p) AS n`,
      { m: md5 },
    );
    expect(Number(n[0].n)).toBe(1);
  });

  it("clusters patches into families with INSTANCE_OF + FAVORS_PATCH", async () => {
    // Add a near-duplicate patch on the same tune (composer Y).
    await c.upsertPatches("b".repeat(32), 0, [
      { patch_hash: "hp2", waveform: "saw", adsr: [0, 8, 13, 8], hard_restart: "", voice: 0, sid_chip: 1 },
    ]);
    await clusterPatchesInGraph(c, { adsrTolerance: 4, pwTolerance: 256 });
    const fams = await c.rawQuery<{ n: number }>("MATCH (f:PatchFamily) RETURN count(f) AS n");
    expect(Number(fams[0].n)).toBeGreaterThanOrEqual(1);
    const inst = await c.rawQuery<{ n: number }>("MATCH (:Patch)-[:INSTANCE_OF]->(:PatchFamily) RETURN count(*) AS n");
    expect(Number(inst[0].n)).toBeGreaterThanOrEqual(2);
    const fav = await c.rawQuery<{ n: number }>("MATCH (:Composer)-[:FAVORS_PATCH]->(:PatchFamily) RETURN count(*) AS n");
    expect(Number(fav[0].n)).toBeGreaterThanOrEqual(1);
  });

  it("c64InstrumentLookup returns patch families for a composer", async () => {
    const res = await c64InstrumentLookup({ composer: "Y", graphName: GRAPH });
    expect(Array.isArray(res.families)).toBe(true);
    expect(res.families.length).toBeGreaterThanOrEqual(1);
  });

  it("hydrate persists rhythm cells + PLAYS_RHYTHM from a TuneExtract", async () => {
    const md5 = "c".repeat(32);
    const events: any[] = [];
    for (let i = 0; i < 8; i++) {
      events.push({ frame: i * 6, voice: 1, kind: "on", pitch: 220 });
      events.push({ frame: i * 6 + 3, voice: 1, kind: "off", pitch: 0 });
    }
    await hydrateOneTune(
      {
        file_md5: md5, subtune_index: 0,
        meta: { title: "R", composer: "Z", hvsc_path: "/r", tempo_bpm: 125 },
        instruments: [], patches: [], events,
        filter_curve: [], pulsewidth: [], structure: {}, driver: { hash: "d" },
      } as any,
      { falkor: c, skipQdrant: true },
    );
    const cells = await c.rawQuery<{ n: number }>(
      `MATCH (:Tune {file_md5: $m})-[:USES_RHYTHM]->(rc:RhythmCell) RETURN count(rc) AS n`, { m: md5 });
    expect(Number(cells[0].n)).toBeGreaterThanOrEqual(1);
    const plays = await c.rawQuery<{ n: number }>(
      `MATCH (:Tune {file_md5: $m})-[:HAS_VOICE]->(:VoicePart)-[:PLAYS_RHYTHM]->(:RhythmCell) RETURN count(*) AS n`, { m: md5 });
    expect(Number(plays[0].n)).toBeGreaterThanOrEqual(1);
  });
});
