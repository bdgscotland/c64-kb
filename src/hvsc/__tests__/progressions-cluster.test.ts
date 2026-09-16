import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorHvscClient } from "../../services/falkor-hvsc.js";
import { clusterProgressionsInGraph } from "../cluster-progressions.js";

const GRAPH = "c64_hvsc_progcluster_test";
let c: FalkorHvscClient;

async function tuneWithProg(md5: string, prog: string) {
  await c.upsertTune({
    file_md5: md5, subtune_index: 0, title: "T", composer: "X",
    year: null, chip: "either", region: "PAL", length_sec: null, hvsc_path: "/" + md5,
  });
  await c.upsertSections(md5, 0, { sections: [{ label: "A", start_frame: 0, end_frame: 100 }], repeat_shape: "A", intro_frames: 0 });
  await c.upsertProgressions(md5, 0, [{ order: 0, degrees: prog, length: prog.split("-").length }]);
}

beforeAll(async () => {
  c = new FalkorHvscClient({ graphName: GRAPH });
  await c.connect();
  await c.dropGraph();
  // Two tunes by the SAME composer use the SAME progression -> weight must be 2.
  await tuneWithProg("a".repeat(32), "0min-10maj-8maj");
  await tuneWithProg("b".repeat(32), "0min-10maj-8maj");
});
afterAll(async () => { await c.dropGraph(); await c.disconnect(); });

describe("clusterProgressionsInGraph", () => {
  it("builds Composer-FAVORS_PROGRESSION with a non-flattened weight", async () => {
    await clusterProgressionsInGraph(c);
    const fav = await c.rawQuery<{ w: number; n: number }>(
      "MATCH (:Composer {name:'x'})-[r:FAVORS_PROGRESSION]->(:Progression) RETURN max(r.weight) AS w, count(r) AS n");
    expect(Number(fav[0].w)).toBe(2); // bound-alias count(hp), NOT collapsed to 1
    expect(Number(fav[0].n)).toBe(1); // one distinct progression
  });
});
