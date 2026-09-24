import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorService } from "../src/services/falkor.ts";

// The cost model lands as cost_<key> and cost_basis on the Technique node
// (schema 22), and a re-ingest that drops the line clears them.
describe("FalkorService - Technique cost properties", () => {
  let f: FalkorService;
  beforeAll(async () => {
    f = new FalkorService();
    await f.connect();
    await f.clean();
    await f.ensureSchema();
  });
  afterAll(async () => {
    await f.close();
  });

  it("addTechnique sets only the cost keys the entity carried, plus the basis", async () => {
    await f.addTechnique({
      name: "sid_play_routine_pattern",
      title: "The init+play subroutine convention",
      category: "music",
      complexity: "low",
      cost: { cycles_per_frame: 332, irq_slots: 1 },
      cost_basis: "measured-vice",
    });
    const r = await f.roQuery(
      `MATCH (t:Technique {name: 'sid_play_routine_pattern'})
       RETURN t.cost_cycles_per_frame AS cpf, t.cost_irq_slots AS slots, t.cost_bytes_code AS bc, t.cost_basis AS basis`,
    );
    expect(r.data[0]).toEqual({ cpf: 332, slots: 1, bc: null, basis: "measured-vice" });
  });

  it("a technique without a Cost line has no cost properties, so IS NOT NULL finds the costed ones", async () => {
    await f.addTechnique({ name: "plasma", title: "Plasma", category: "effect", complexity: "medium" });
    const r = await f.roQuery(
      `MATCH (t:Technique) WHERE t.cost_cycles_per_frame IS NOT NULL RETURN collect(t.name) AS names`,
    );
    expect(r.data[0]).toEqual({ names: ["sid_play_routine_pattern"] });
  });

  it("stores a Cost bytes basis beside the Cost basis, and clears it when the page drops it (#72)", async () => {
    const base = { name: "raster_bars", title: "Raster bars", category: "raster", complexity: "low" };
    await f.addTechnique({
      ...base,
      cost: { cycles_per_frame: 1471, bytes_code: 577 },
      cost_basis: "measured-vice",
      cost_bytes_basis: "derived-listing",
    });
    const q = `MATCH (t:Technique {name: 'raster_bars'}) RETURN t.cost_basis AS basis, t.cost_bytes_basis AS bytes`;
    expect((await f.roQuery(q)).data[0]).toEqual({ basis: "measured-vice", bytes: "derived-listing" });
    await f.addTechnique({
      ...base,
      cost: { cycles_per_frame: 1471, bytes_code: 577 },
      cost_basis: "measured-vice",
    });
    expect((await f.roQuery(q)).data[0]).toEqual({ basis: "measured-vice", bytes: null });
  });

  it("re-ingesting without the line clears the properties", async () => {
    await f.addTechnique({
      name: "sid_play_routine_pattern",
      title: "The init+play subroutine convention",
      category: "music",
      complexity: "low",
    });
    const r = await f.roQuery(
      `MATCH (t:Technique {name: 'sid_play_routine_pattern'})
       RETURN t.cost_cycles_per_frame AS cpf, t.cost_basis AS basis, t.title AS title`,
    );
    expect(r.data[0]).toEqual({ cpf: null, basis: null, title: "The init+play subroutine convention" });
  });
});
