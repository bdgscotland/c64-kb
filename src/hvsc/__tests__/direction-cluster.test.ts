import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorHvscClient } from "../../services/falkor-hvsc.js";
import { clusterDirectionInGraph } from "../cluster-direction.js";

const GRAPH = "c64_hvsc_direction_cluster_test";
let c: FalkorHvscClient;

async function tuneWithCadences(md5: string, composer: string, cadences: Array<{ degree: number; closed: boolean }>) {
  await c.upsertTune({
    file_md5: md5, subtune_index: 0, title: "T", composer,
    year: null, chip: "either", region: "PAL", length_sec: null, hvsc_path: "/" + md5,
  });
  await c.upsertDirection(md5, 0, {
    resolution_rate: 0.5, qa_rate: 0.5, mean_phrase_len: 4, n_phrases: cadences.length, cadences,
  });
}

beforeAll(async () => {
  c = new FalkorHvscClient({ graphName: GRAPH });
  await c.connect();
  await c.dropGraph();
  // tune1: tonic(0) x2 + fifth(7) x1 ; tune2: tonic x1 + fifth x1
  await tuneWithCadences("a".repeat(32), "Cady", [{ degree: 0, closed: true }, { degree: 0, closed: true }, { degree: 7, closed: false }]);
  await tuneWithCadences("b".repeat(32), "Cady", [{ degree: 0, closed: true }, { degree: 7, closed: false }]);
  await clusterDirectionInGraph(c, "/tmp/__no_such_cache_dir__");  // bogus → only FAVORS_CADENCE aggregation runs
});
afterAll(async () => { await c.dropGraph(); await c.disconnect(); });

describe("Melodic direction as first-class graph entities", () => {
  it("sets Tune direction props", async () => {
    const rows = await c.rawQuery<{ q: number }>(
      `MATCH (t:Tune {file_md5: $m}) RETURN t.direction_qa_rate AS q`, { m: "a".repeat(32) });
    expect(Number(rows[0].q)).toBeCloseTo(0.5, 5);
  });

  it("creates one Cadence per landing degree + ENDS_PHRASE_ON with counts", async () => {
    const cad = await c.rawQuery<{ n: number }>("MATCH (cad:Cadence) RETURN count(cad) AS n");
    expect(Number(cad[0].n)).toBe(2); // degree 0 and 7
    const ends = await c.rawQuery<{ n: number }>("MATCH (:Tune)-[r:ENDS_PHRASE_ON]->(:Cadence) RETURN count(r) AS n");
    expect(Number(ends[0].n)).toBe(4); // tune1: 2 cadences, tune2: 2 cadences
  });

  it("aggregates Composer-FAVORS_CADENCE with summed incidence (bound sum(u.count))", async () => {
    const rows = await c.rawQuery<{ degree: number; weight: number }>(
      `MATCH (:Composer {name: 'cady'})-[r:FAVORS_CADENCE]->(cad:Cadence)
       RETURN cad.degree AS degree, r.weight AS weight ORDER BY r.weight DESC`);
    expect(rows.length).toBe(2);
    expect(Number(rows[0].degree)).toBe(0);
    expect(Number(rows[0].weight)).toBe(3);  // tonic: 2 + 1 — NOT flattened
    expect(Number(rows[1].weight)).toBe(2);  // fifth: 1 + 1
  });
});
