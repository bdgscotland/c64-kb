import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { FalkorService } from "../src/services/falkor.js";

describe("FalkorService — Archetype, FEATURES, RISKS", () => {
  let f: FalkorService;

  beforeAll(async () => {
    f = new FalkorService();
    await f.connect();
    await f.clean();
    await f.ensureSchema();
    await f.addTechnique({ name: "soft_scroll_v", title: "Vertical soft-scroll", category: "scroll", complexity: "low" });
    await f.addTechnique({ name: "sprite_multiplex_24", title: "24-sprite multiplexer", category: "sprite", complexity: "high" });
    await f.addPitfall({ name: "sprite_dma_overflow", title: "Too many sprites on one line", severity: "high", region: "both", category: "sprite" });
  });

  afterAll(async () => {
    await f?.close();
  });

  it("addArchetype creates the node with all properties and MERGEs on name", async () => {
    await f.addArchetype({ name: "vertical_shmup", title: "Vertical Shmup", kind: "game", source_doc: "docs/game-design/c64-game-archetypes.md" });
    await f.addArchetype({ name: "vertical_shmup", title: "Vertical Shmup", kind: "game", source_doc: "docs/game-design/c64-game-archetypes.md" });
    const r = await f.roQuery(
      `MATCH (a:Archetype {name: "vertical_shmup"}) RETURN count(a) AS n, collect(a.title)[0] AS title, collect(a.kind)[0] AS kind, collect(a.source_doc)[0] AS src`
    );
    const row = r.data[0] as { n: number; title: string; kind: string; src: string };
    expect(row.n).toBe(1);
    expect(row.title).toBe("Vertical Shmup");
    expect(row.kind).toBe("game");
    expect(row.src).toBe("docs/game-design/c64-game-archetypes.md");
  });

  it("linkArchetypeFeatures lands a FEATURES edge to an existing Technique and reports it", async () => {
    expect(await f.linkArchetypeFeatures("vertical_shmup", "soft_scroll_v")).toBe(true);
    expect(await f.linkArchetypeFeatures("vertical_shmup", "sprite_multiplex_24")).toBe(true);
    // Repeat is folded by MERGE.
    expect(await f.linkArchetypeFeatures("vertical_shmup", "soft_scroll_v")).toBe(true);
    const r = await f.roQuery(
      `MATCH (a:Archetype {name: "vertical_shmup"})-[:FEATURES]->(t:Technique) RETURN t.name AS name ORDER BY name`
    );
    expect((r.data as Array<{ name: string }>).map(x => x.name)).toEqual(["soft_scroll_v", "sprite_multiplex_24"]);
  });

  it("linkArchetypeFeatures drops a name that matches no Technique, warns, and creates no stub", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await f.linkArchetypeFeatures("vertical_shmup", "no_such_technique")).toBe(false);
    expect(warn.mock.calls.some(c => String(c[0]).includes("no_such_technique"))).toBe(true);
    warn.mockRestore();
    const stub = await f.roQuery(`MATCH (t:Technique {name: "no_such_technique"}) RETURN count(t) AS n`);
    expect((stub.data[0] as { n: number }).n).toBe(0);
  });

  it("linkArchetypeRisks lands a RISKS edge to an existing Pitfall and drops a missing one", async () => {
    expect(await f.linkArchetypeRisks("vertical_shmup", "sprite_dma_overflow")).toBe(true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await f.linkArchetypeRisks("vertical_shmup", "no_such_pitfall")).toBe(false);
    expect(await f.linkArchetypeRisks("no_such_archetype", "sprite_dma_overflow")).toBe(false);
    warn.mockRestore();
    const r = await f.roQuery(
      `MATCH (a:Archetype)-[:RISKS]->(p:Pitfall) RETURN a.name AS a, p.name AS p`
    );
    expect(r.data).toEqual([{ a: "vertical_shmup", p: "sprite_dma_overflow" }]);
    const stub = await f.roQuery(`MATCH (p:Pitfall {name: "no_such_pitfall"}) RETURN count(p) AS n`);
    expect((stub.data[0] as { n: number }).n).toBe(0);
  });

  it("clean() removes Archetype nodes", async () => {
    await f.clean();
    const r = await f.roQuery(`MATCH (a:Archetype) RETURN count(a) AS n`);
    expect((r.data[0] as { n: number }).n).toBe(0);
  });
});
