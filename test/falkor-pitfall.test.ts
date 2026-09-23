import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorService } from "../src/services/falkor.ts";

describe("FalkorService — Pitfall + CrashPattern", () => {
  let f: FalkorService;

  beforeAll(async () => {
    f = new FalkorService();
    await f.connect();
    await f.clean();
    await f.ensureSchema();
  });

  afterAll(async () => {
    await f?.close();
  });

  it("addPitfall creates node with all properties", async () => {
    await f.addPitfall({
      name: "badline_cycle_loss",
      title: "Badline DMA steals 40-43 cycles",
      severity: "critical",
      region: "both",
      category: "raster",
    });

    const r = await f.roQuery(
      `MATCH (p:Pitfall {name: "badline_cycle_loss"}) RETURN p.title, p.severity, p.region, p.category`,
    );
    expect(r.data).toHaveLength(1);
    expect((r.data[0] as any)["p.title"]).toBe("Badline DMA steals 40-43 cycles");
    expect((r.data[0] as any)["p.severity"]).toBe("critical");
  });

  it("addPitfall MERGEs idempotently on name", async () => {
    // already created in previous test; calling again should not create a second node
    await f.addPitfall({
      name: "badline_cycle_loss",
      title: "Badline DMA steals 40-43 cycles",
      severity: "critical",
      region: "both",
      category: "raster",
    });
    const r = await f.roQuery(`MATCH (p:Pitfall {name: "badline_cycle_loss"}) RETURN count(p) AS n`);
    expect((r.data[0] as { n: number }).n).toBe(1);
  });

  it("linkTriggeredBy creates TRIGGERED_BY edge to existing Register", async () => {
    await f.addRegister("D011", "$D011", "VIC-II", "RW", []);
    await f.addPitfall({
      name: "badline_cycle_loss2",
      title: "T",
      severity: "high",
      region: "both",
      category: "raster",
    });
    await f.linkTriggeredBy("badline_cycle_loss2", "D011", "Register");

    const r = await f.roQuery(`MATCH (p:Pitfall)-[:TRIGGERED_BY]->(reg:Register) RETURN p.name, reg.name`);
    expect(r.data).toHaveLength(1);
    expect((r.data[0] as any)["p.name"]).toBe("badline_cycle_loss2");
    expect((r.data[0] as any)["reg.name"]).toBe("D011");
  });

  it("linkTriggeredBy logs and skips when target absent", async () => {
    await f.addPitfall({ name: "x", title: "x", severity: "low", region: "both", category: "raster" });
    await f.linkTriggeredBy("x", "NONEXISTENT", "Register");

    const r = await f.roQuery(`MATCH (p:Pitfall {name: "x"})-[:TRIGGERED_BY]->(reg) RETURN reg.name`);
    // pitfall "x" should have no edges at all
    expect(r.data).toHaveLength(0);
  });

  it("linkMitigatedBy creates MITIGATED_BY edge to an existing Technique and is idempotent", async () => {
    await f.addTechnique({
      name: "double_irq",
      title: "Double IRQ",
      category: "raster",
      complexity: "scene-tier",
    });
    await f.addPitfall({
      name: "raster_irq_first_line_jitter",
      title: "T",
      severity: "high",
      region: "both",
      category: "raster",
    });
    expect(await f.linkMitigatedBy("raster_irq_first_line_jitter", "double_irq")).toBe(true);
    expect(await f.linkMitigatedBy("raster_irq_first_line_jitter", "double_irq")).toBe(true);

    const r = await f.roQuery(
      `MATCH (p:Pitfall {name: "raster_irq_first_line_jitter"})-[:MITIGATED_BY]->(t:Technique) RETURN t.name`,
    );
    expect(r.data).toHaveLength(1);
    expect((r.data[0] as any)["t.name"]).toBe("double_irq");
  });

  it("linkMitigatedBy MATCHes both ends: a missing technique drops the edge and creates no stub", async () => {
    expect(await f.linkMitigatedBy("raster_irq_first_line_jitter", "no_such_technique")).toBe(false);
    const stub = await f.roQuery(`MATCH (t:Technique {name: "no_such_technique"}) RETURN count(t) AS n`);
    expect((stub.data[0] as { n: number }).n).toBe(0);
    const edges = await f.roQuery(
      `MATCH (p:Pitfall {name: "raster_irq_first_line_jitter"})-[:MITIGATED_BY]->(t) RETURN count(t) AS n`,
    );
    expect((edges.data[0] as { n: number }).n).toBe(1);
  });

  it("addCrashPattern stores likely_causes as JSON-encoded string", async () => {
    await f.addCrashPattern({
      symptom: "black_screen",
      description: "Display goes blank",
      likely_causes: ["vic_bank_misconfigured", "screen_pointer_outside_bank"],
      diagnosis_steps: "Check $D018; verify $DD00.",
    });

    const r = await f.roQuery(`MATCH (c:CrashPattern {symptom: "black_screen"}) RETURN c.likely_causes`);
    const stored = (r.data[0] as any)["c.likely_causes"];
    expect(JSON.parse(stored)).toEqual(["vic_bank_misconfigured", "screen_pointer_outside_bank"]);
  });

  it("linkCausedBy creates CAUSED_BY edge to existing Technique", async () => {
    await f.addTechnique({
      name: "vic_bank_switch",
      title: "VIC Bank Switching",
      category: "banking",
      complexity: "medium",
    });
    await f.linkCausedBy("black_screen", "vic_bank_switch", "Technique");

    const r = await f.roQuery(
      `MATCH (c:CrashPattern {symptom: "black_screen"})-[:CAUSED_BY]->(t:Technique) RETURN t.name`,
    );
    expect(r.data).toHaveLength(1);
    expect((r.data[0] as any)["t.name"]).toBe("vic_bank_switch");
  });

  it("linkCausedBy logs and skips when target absent", async () => {
    await f.linkCausedBy("black_screen", "NONEXISTENT_TECHNIQUE", "Technique");

    const r = await f.roQuery(
      `MATCH (c:CrashPattern {symptom: "black_screen"})-[:CAUSED_BY]->(t) RETURN t.name`,
    );
    // should still only have one edge (to vic_bank_switch), not to NONEXISTENT_TECHNIQUE
    expect(r.data).toHaveLength(1);
  });
});
