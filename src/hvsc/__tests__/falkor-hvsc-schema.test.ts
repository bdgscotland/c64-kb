import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorHvscClient } from "../../services/falkor-hvsc.js";

const TEST_GRAPH = `c64_hvsc_schema_test_${Date.now()}`;

describe("upsertTune new schema (M4.1)", () => {
  let client: FalkorHvscClient;
  beforeAll(async () => {
    process.env.FALKOR_HVSC_GRAPH = TEST_GRAPH;
    client = new FalkorHvscClient({ graphName: TEST_GRAPH });
    await client.connect();
  });
  afterAll(async () => {
    try { await client.dropGraph(); } catch {}
    await client.disconnect();
  });

  it("creates Tracker + Driver + USES_DRIVER + EMITTED_BY edges", async () => {
    await client.upsertTune({
      file_md5: "abc123driver",
      subtune_index: 0,
      title: "Test",
      composer: "Test Composer",
      year: 1987,
      chip: "6581",
      region: "PAL",
      length_sec: 120,
      hvsc_path: "/test1.sid",
      tracker_id: "goattracker-v2",
      tracker_confidence: 0.95,
      driver_hash: "deadbeef0001",
      driver_byte_signature: "20 04 10",
      driver_play_offset: 16,
      driver_init_offset: 0,
      sid_count: 1,
      is_rsid: false,
      credits: [],
    });
    const rows = await client.rawQuery<{ hash: string; tid: string }>(`
      MATCH (t:Tune {file_md5: 'abc123driver'})
      MATCH (t)-[:USES_DRIVER]->(d:Driver)-[:EMITTED_BY]->(tr:Tracker)
      RETURN d.driver_hash AS hash, tr.id AS tid
    `);
    expect(rows[0]).toEqual({ hash: "deadbeef0001", tid: "goattracker-v2" });
  });

  it("omits Tracker edges when tracker_id is unknown", async () => {
    await client.upsertTune({
      file_md5: "noTrackerHere",
      subtune_index: 0,
      title: "Untracked",
      composer: "Mystery",
      year: 1985,
      chip: "6581",
      region: "PAL",
      length_sec: 60,
      hvsc_path: "/untracked.sid",
      tracker_id: "unknown",
      tracker_confidence: 0.0,
      driver_hash: "feedface0002",
      driver_byte_signature: "AA BB",
      driver_play_offset: 0,
      driver_init_offset: 0,
      sid_count: 1,
      is_rsid: false,
      credits: [],
    });
    const trackerRows = await client.rawQuery(`
      MATCH (t:Tune {file_md5: 'noTrackerHere'})-[:USES_TRACKER]->()
      RETURN count(*) as n
    `);
    expect((trackerRows[0] as any).n).toBe(0);
    const driverRows = await client.rawQuery(`
      MATCH (t:Tune {file_md5: 'noTrackerHere'})-[:USES_DRIVER]->(d:Driver)
      RETURN d.driver_hash AS hash
    `);
    expect(driverRows).toHaveLength(1);
  });

  it("creates Person + CREDITED_IN edges with role property", async () => {
    await client.upsertTune({
      file_md5: "creditsExist",
      subtune_index: 0,
      title: "Credits",
      composer: "Primary Composer",
      year: 1988,
      chip: "8580",
      region: "PAL",
      length_sec: 90,
      hvsc_path: "/credits.sid",
      tracker_id: "unknown",
      driver_hash: "babebeef0003",
      driver_byte_signature: "CC DD",
      sid_count: 1,
      is_rsid: false,
      credits: [
        { name: "Original Composer", role: "cover-of" },
        { name: "Cover Artist", role: "artist" },
      ],
    });
    const rows = await client.rawQuery<{ name: string; role: string }>(`
      MATCH (p:Person)-[r:CREDITED_IN]->(t:Tune {file_md5: 'creditsExist'})
      RETURN p.display_name AS name, r.role AS role
      ORDER BY p.display_name
    `);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const roles = rows.map((r) => r.role);
    expect(roles).toContain("cover-of");
    expect(roles).toContain("artist");
  });

  it("idempotent: re-upserting same tune doesn't duplicate edges", async () => {
    const input = {
      file_md5: "idempotentTest",
      subtune_index: 0,
      title: "Idem",
      composer: "Idem Composer",
      year: 1990,
      chip: "6581" as const,
      region: "PAL" as const,
      length_sec: 60,
      hvsc_path: "/idem.sid",
      tracker_id: "sidwizard-v1",
      tracker_confidence: 0.92,
      driver_hash: "cafecafe0004",
      sid_count: 1,
      is_rsid: false,
      credits: [{ name: "Idem Composer", role: "composer" }],
    };
    await client.upsertTune(input);
    await client.upsertTune(input);
    const rows = await client.rawQuery(`
      MATCH (t:Tune {file_md5: 'idempotentTest'})
      OPTIONAL MATCH (t)-[r1:USES_DRIVER]->()
      OPTIONAL MATCH (t)-[r2:USES_TRACKER]->()
      OPTIONAL MATCH ()-[r3:CREDITED_IN]->(t)
      RETURN count(distinct r1) AS d, count(distinct r2) AS tr, count(distinct r3) AS c
    `);
    expect((rows[0] as any).d).toBe(1);
    expect((rows[0] as any).tr).toBe(1);
    expect((rows[0] as any).c).toBe(1);
  });
});
