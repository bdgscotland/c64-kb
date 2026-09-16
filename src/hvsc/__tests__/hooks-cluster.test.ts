import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorHvscClient } from "../../services/falkor-hvsc.js";
import { clusterHooksInGraph } from "../cluster-hooks.js";

const GRAPH = "c64_hvsc_hooks_cluster_test";
let c: FalkorHvscClient;

async function tuneWithHook(md5: string, composer: string, intervals: number[]) {
  await c.upsertTune({
    file_md5: md5, subtune_index: 0, title: "T", composer,
    year: null, chip: "either", region: "PAL", length_sec: null, hvsc_path: "/" + md5,
  });
  await c.upsertHook(md5, 0, { intervals, strength: 0.3, occurrences: 3, n_notes: intervals.length + 1 });
}

beforeAll(async () => {
  c = new FalkorHvscClient({ graphName: GRAPH });
  await c.connect();
  await c.dropGraph();
  // Two tunes by Hooky share the SAME hook [-2,2] (one Hook node, two USES_HOOK edges);
  // a third has a different-contour hook [2,2].
  await tuneWithHook("a".repeat(32), "Hooky", [-2, 2]);
  await tuneWithHook("b".repeat(32), "Hooky", [-2, 2]);
  await tuneWithHook("c".repeat(32), "Hooky", [2, 2]);
  await clusterHooksInGraph(c);
});
afterAll(async () => { await c.dropGraph(); await c.disconnect(); });

describe("Hook as first-class graph entity", () => {
  it("dedups identical hooks to one node but keeps both USES_HOOK edges", async () => {
    const nodes = await c.rawQuery<{ n: number }>("MATCH (h:Hook) RETURN count(h) AS n");
    expect(Number(nodes[0].n)).toBe(2); // [-2,2] and [2,2]
    const edges = await c.rawQuery<{ n: number }>("MATCH (:Tune)-[r:USES_HOOK]->(:Hook) RETURN count(r) AS n");
    expect(Number(edges[0].n)).toBe(3); // three tunes
  });

  it("clusters hooks into HookFamily by contour", async () => {
    const fams = await c.rawQuery<{ n: number }>("MATCH (f:HookFamily) RETURN count(f) AS n");
    expect(Number(fams[0].n)).toBe(2); // contour "-1,1" and "1,1"
  });

  it("aggregates Composer-FAVORS_HOOK with true incidence weight (bound count(u))", async () => {
    const rows = await c.rawQuery<{ key: string; weight: number }>(
      `MATCH (:Composer {name: 'hooky'})-[r:FAVORS_HOOK]->(f:HookFamily)
       RETURN f.key AS key, r.weight AS weight ORDER BY r.weight DESC`);
    expect(rows.length).toBe(2);
    expect(Number(rows[0].weight)).toBe(2); // the [-2,2] family used by 2 tunes — NOT flattened to 1
  });
});
