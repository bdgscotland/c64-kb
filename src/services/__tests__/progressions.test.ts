import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorHvscClient } from "../falkor-hvsc.js";

const GRAPH = "c64_hvsc_progression_test";
const MD5 = "a".repeat(32);
let c: FalkorHvscClient;

beforeAll(async () => {
  c = new FalkorHvscClient({ graphName: GRAPH });
  await c.connect();
  await c.dropGraph();
  await c.upsertTune({
    file_md5: MD5, subtune_index: 0, title: "T", composer: "X",
    year: null, chip: "either", region: "PAL", length_sec: null, hvsc_path: "/x",
  });
  await c.upsertSections(MD5, 0, {
    sections: [
      { label: "A", start_frame: 0, end_frame: 100 },
      { label: "B", start_frame: 100, end_frame: 200 },
    ],
    repeat_shape: "AB", intro_frames: 0,
  });
});
afterAll(async () => { await c.dropGraph(); await c.disconnect(); });

describe("upsertProgressions", () => {
  it("creates deduped Progression nodes + Section-HAS_PROGRESSION edges", async () => {
    await c.upsertProgressions(MD5, 0, [
      { order: 0, degrees: "0maj-7maj", length: 2 },
      { order: 1, degrees: "0maj-7maj", length: 2 }, // same shape -> one node
    ]);
    const nodes = await c.rawQuery<{ n: number }>("MATCH (p:Progression) RETURN count(p) AS n");
    expect(Number(nodes[0].n)).toBe(1);
    const edges = await c.rawQuery<{ n: number }>(
      "MATCH (:Section)-[r:HAS_PROGRESSION]->(:Progression) RETURN count(r) AS n");
    expect(Number(edges[0].n)).toBe(2);
    const deg = await c.rawQuery<{ d: string; len: number }>(
      "MATCH (p:Progression) RETURN p.degrees AS d, p.length AS len");
    expect(deg[0].d).toBe("0maj-7maj");
    expect(Number(deg[0].len)).toBe(2);
  });
});
