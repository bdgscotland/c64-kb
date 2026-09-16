import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorHvscClient } from "../../services/falkor-hvsc.js";
import { clusterFormInGraph } from "../cluster-form.js";

const GRAPH = "c64_hvsc_form_cluster_test";
let c: FalkorHvscClient;

async function tuneWithArc(md5: string, composer: string, arc: string) {
  await c.upsertTune({
    file_md5: md5, subtune_index: 0, title: "T", composer,
    year: null, chip: "either", region: "PAL", length_sec: null, hvsc_path: "/" + md5,
  });
  await c.upsertSections(md5, 0, { sections: [
    { label: "A", start_frame: 0, end_frame: 100, repeat_of: null },
    { label: "B", start_frame: 100, end_frame: 200, repeat_of: null },
  ] });
  await c.upsertForm(md5, 0, {
    arc, peak_section: 1, energy_range: 0.6,
    sections: [
      { order: 0, energy: 0.2, density: 0.1, register: 60, voice_activity: 1 },
      { order: 1, energy: 0.8, density: 0.3, register: 72, voice_activity: 2 },
    ],
  });
}

beforeAll(async () => {
  c = new FalkorHvscClient({ graphName: GRAPH });
  await c.connect();
  await c.dropGraph();
  await tuneWithArc("a".repeat(32), "Archy", "arch");
  await tuneWithArc("b".repeat(32), "Archy", "arch");
  await tuneWithArc("c".repeat(32), "Archy", "rising");
  // empty cache dir → walk is a no-op; only the FAVORS_ARC aggregation runs over seeded HAS_ARC
  await clusterFormInGraph(c, "/tmp/__no_such_cache_dir__");
});
afterAll(async () => { await c.dropGraph(); await c.disconnect(); });

describe("Form-as-dynamics as first-class graph entities", () => {
  it("sets per-section energy props", async () => {
    const rows = await c.rawQuery<{ e: number }>(
      `MATCH (:Tune {file_md5: $m})-[:HAS_SECTION]->(s:Section {order: 1}) RETURN s.energy AS e`,
      { m: "a".repeat(32) });
    expect(Number(rows[0].e)).toBeCloseTo(0.8, 5);
  });

  it("creates one ArcShape per archetype + HAS_ARC per tune", async () => {
    const arcs = await c.rawQuery<{ n: number }>("MATCH (a:ArcShape) RETURN count(a) AS n");
    expect(Number(arcs[0].n)).toBe(2); // arch + rising
    const has = await c.rawQuery<{ n: number }>("MATCH (:Tune)-[r:HAS_ARC]->(:ArcShape) RETURN count(r) AS n");
    expect(Number(has[0].n)).toBe(3);
  });

  it("aggregates Composer-FAVORS_ARC with true incidence weight (bound count(u))", async () => {
    const rows = await c.rawQuery<{ arc: string; weight: number }>(
      `MATCH (:Composer {name: 'archy'})-[r:FAVORS_ARC]->(a:ArcShape)
       RETURN a.arc AS arc, r.weight AS weight ORDER BY r.weight DESC`);
    expect(rows.length).toBe(2);
    expect(rows[0].arc).toBe("arch");
    expect(Number(rows[0].weight)).toBe(2); // NOT flattened to 1
    expect(Number(rows[1].weight)).toBe(1); // rising
  });
});
