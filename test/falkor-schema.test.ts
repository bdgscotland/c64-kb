import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorService } from "../src/services/falkor.ts";

const svc = new FalkorService();

beforeAll(async () => {
  await svc.connect();
  await svc.ensureSchema();
});

afterAll(async () => {
  await svc.close();
});

describe("FalkorService schema seed", () => {
  it("seeds exactly 5 Chip nodes with expected names", async () => {
    const rows = await svc.roQuery(`MATCH (c:Chip) RETURN c.name AS name ORDER BY c.name`);
    const names = (rows.data ?? []).map((r: any) => r.name).sort();
    expect(names).toEqual(["6510", "CIA1", "CIA2", "SID", "VIC-II"]);
  });

  it("seeds exactly 2 Region nodes (PAL and NTSC)", async () => {
    const rows = await svc.roQuery(`MATCH (r:Region) RETURN r.name AS name ORDER BY r.name`);
    const names = (rows.data ?? []).map((r: any) => r.name).sort();
    expect(names).toEqual(["NTSC", "PAL"]);
  });

  it("Region nodes carry refresh_hz and cycles_per_line", async () => {
    const rows = await svc.roQuery(
      `MATCH (r:Region {name: 'PAL'}) RETURN r.refresh_hz AS refresh, r.cycles_per_line AS cycles, r.lines_per_frame AS lines`,
    );
    const pal = rows.data?.[0] as any;
    expect(pal.refresh).toBe(50);
    expect(pal.cycles).toBe(63);
    expect(pal.lines).toBe(312);
  });

  it("getStats returns at least the seeded nodes", async () => {
    const stats = await svc.getStats();
    expect(stats.nodes).toBeGreaterThanOrEqual(7); // 5 Chip + 2 Region
    expect(stats.edges).toBeGreaterThanOrEqual(0);
  });
});

describe("FalkorService mutations", () => {
  it("addRegister + linkBelongsTo creates a Register node and connects it to its Chip", async () => {
    await svc.addRegister("D011", "$D011", "VIC-II", "RW");
    await svc.linkBelongsTo("Register", "D011", "VIC-II");
    const rows = await svc.roQuery(
      `MATCH (r:Register {name: 'D011'})-[:BELONGS_TO]->(c:Chip)
       RETURN r.address AS addr, r.rw AS rw, c.name AS chip`,
    );
    const row = rows.data?.[0] as { addr: string; rw: string; chip: string };
    expect(row).toMatchObject({ addr: "$D011", rw: "RW", chip: "VIC-II" });
  });

  it("addRegister with aliases stores them and is queryable by alias", async () => {
    await svc.addRegister("SCROLY", "$D011", "VIC-II", "RW", ["D011"]);
    const rows = await svc.roQuery(
      `MATCH (r:Register)
       WHERE r.name = 'SCROLY' OR 'D011' IN r.aliases
       RETURN r.name AS name, r.address AS addr, r.aliases AS aliases
       ORDER BY r.name`,
    );
    const matches = (rows.data ?? []) as { name: string; addr: string; aliases: string[] }[];
    const scroly = matches.find((m) => m.name === "SCROLY");
    expect(scroly).toBeDefined();
    expect(scroly!.addr).toBe("$D011");
    expect(scroly!.aliases).toEqual(["D011"]);
  });

  it("addKernalRoutine creates a KernalRoutine node with description", async () => {
    await svc.addKernalRoutine("CHROUT", "$FFD2", "Output a character");
    const rows = await svc.roQuery(
      `MATCH (k:KernalRoutine {name: 'CHROUT'}) RETURN k.address AS addr, k.description AS desc`,
    );
    expect(rows.data?.[0]).toMatchObject({ addr: "$FFD2", desc: "Output a character" });
  });

  it("linkPairsWith creates a PAIRS_WITH edge between two routines", async () => {
    await svc.addKernalRoutine("CHRIN", "$FFCF", "Get a character");
    await svc.linkPairsWith("CHROUT", "CHRIN");
    const rows = await svc.roQuery(
      `MATCH (a:KernalRoutine {name: 'CHROUT'})-[:PAIRS_WITH]->(b:KernalRoutine {name: 'CHRIN'})
       RETURN b.name AS partner`,
    );
    expect(rows.data?.[0]).toMatchObject({ partner: "CHRIN" });
  });

  it("addMemoryRegion creates a MemoryRegion node", async () => {
    await svc.addMemoryRegion("Default Screen RAM", "$0400", "$07FF", "Screen character codes", false);
    const rows = await svc.roQuery(
      `MATCH (m:MemoryRegion {name: 'Default Screen RAM'})
       RETURN m.start AS start, m.end AS end, m.bank_switchable AS bank`,
    );
    expect(rows.data?.[0]).toMatchObject({ start: "$0400", end: "$07FF", bank: false });
  });
});
