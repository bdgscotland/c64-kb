import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { FalkorService } from "../src/services/falkor.ts";
import { checkCompatibility, techniqueLookup, techniquesFor } from "../src/tools/query.ts";
import { HARDWARE_UNITS, parseClaims, type Claim } from "../src/graph/extract.ts";

// HardwareUnit seeds, CLAIMS edges and the unit rules in checkCompatibility
// (schema 25). The graph name comes from vitest.config.ts (c64_test).
describe("resource claims", () => {
  let f: FalkorService;
  const claim = async (tech: string, line: string) => {
    const parsed = parseClaims(line);
    if ("error" in parsed) throw new Error(parsed.error);
    for (const c of parsed as Claim[]) {
      await f.linkClaims({ owner: tech, ownerKind: "Technique", ...c, basis: "derived-listing" });
    }
  };
  const tech = (name: string, category: string, claims_stated?: "stated" | "none") =>
    f.addTechnique({ name, title: name, category, complexity: "medium", ...(claims_stated ? { claims_stated, claims_basis: "derived-listing" } : {}) });

  beforeAll(async () => {
    f = new FalkorService();
    await f.connect();
    await f.clean();
    await f.ensureSchema();
    // The design's examples (design 1.3) plus the pairs the rules need.
    await tech("sid_play_routine_pattern", "music", "stated");
    await tech("sfx_engine_beside_music", "music", "stated");
    await tech("second_player", "music", "stated");
    await tech("lfsr_random", "maths", "stated");
    await tech("sprite_multiplex_game", "sprite", "stated");
    await tech("scroll_panel_split", "scroll", "stated");
    await tech("krill_loader_integration", "loader", "stated");
    await tech("zp_fixed_a", "cpu", "stated");
    await tech("zp_fixed_b", "cpu", "stated");
    await tech("keyboard_matrix_scan", "input", "stated");
    await tech("joystick_edge_detect", "input", "stated");
    await tech("pure_maths", "maths", "none");
    await tech("unknown_claims", "effect");
    await tech("stable_raster_irq", "raster", "stated");
    await tech("uses_stable", "raster", "stated");
    await claim("sid_play_routine_pattern", "sid_voice_1-3 (owns), sid_filter_volume (owns)");
    await claim("second_player", "sid_voice_1-3 (owns), sid_filter_volume (owns)");
    await claim("sfx_engine_beside_music", "sid_voice_2 (shares)");
    await claim("lfsr_random", "sid_voice_3 (init), sid_voice_3_readback (init), cia1_timer_a (reads)");
    await claim("sprite_multiplex_game", "sprite_0-7 (owns), vic_raster_irq (owns)");
    await claim("scroll_panel_split", "vic_raster_irq (owns)");
    await claim("krill_loader_integration", "serial_bus (owns), zero_page $E0-$EF (owns, relocatable), cia2_vic_bank (shares)");
    await claim("zp_fixed_a", "zero_page $E8-$F3 (owns)");
    await claim("zp_fixed_b", "zero_page $F0-$F7 (owns)");
    await claim("keyboard_matrix_scan", "cia1_port_a (owns), cia1_port_b (reads)");
    await claim("joystick_edge_detect", "cia1_port_a (reads), cia1_port_b (reads)");
    await claim("stable_raster_irq", "vic_raster_irq (owns)");
    await claim("uses_stable", "vic_raster_irq (owns)");
    await f.linkTechniqueRequires("uses_stable", "stable_raster_irq");
  });
  afterAll(async () => f.close());

  it("seeds every HardwareUnit, each on its chip", async () => {
    const rows = await f.roQuery(`MATCH (h:HardwareUnit) RETURN h.name AS name, h.kind AS kind`);
    expect((rows.data ?? []).length).toBe(HARDWARE_UNITS.length);
    const onChip = await f.roQuery(`MATCH (h:HardwareUnit {name: 'sid_voice_2'})-[:BELONGS_TO]->(c:Chip) RETURN c.name AS chip`);
    expect((onChip.data?.[0] as { chip: string }).chip).toBe("SID");
    const noChip = await f.roQuery(`MATCH (h:HardwareUnit {name: 'expansion_io1'})-[:BELONGS_TO]->(c:Chip) RETURN c.name AS chip`);
    expect(noChip.data ?? []).toEqual([]);
  });

  it("linkClaims matches both ends and never creates a unit or a technique", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await f.linkClaims({ owner: "sfx_engine_beside_music", ownerKind: "Technique", unit: "sid_voice_9", mode: "owns", basis: "estimated" })).toBe(false);
    expect(await f.linkClaims({ owner: "no_such_technique", ownerKind: "Technique", unit: "sid_voice_1", mode: "owns", basis: "estimated" })).toBe(false);
    const stray = await f.roQuery(`MATCH (h:HardwareUnit {name: 'sid_voice_9'}) RETURN h`);
    expect(stray.data ?? []).toEqual([]);
    const ghost = await f.roQuery(`MATCH (t:Technique {name: 'no_such_technique'}) RETURN t`);
    expect(ghost.data ?? []).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it("a re-ingested technique loses the claims its page stopped making", async () => {
    await tech("rewritten", "effect", "stated");
    await claim("rewritten", "sid_voice_1");
    await tech("rewritten", "effect", "none");
    const rows = await f.roQuery(`MATCH (:Technique {name: 'rewritten'})-[c:CLAIMS]->() RETURN count(c) AS n`);
    expect(Number((rows.data?.[0] as { n: number }).n)).toBe(0);
  });

  it("two players owning the same voices: unit_contention, hard", async () => {
    const r = (await checkCompatibility(["sid_play_routine_pattern", "second_player"])).structured;
    expect(r.verdict).toBe("incompatible");
    const c = r.conflicts.find((x) => x.kind === "unit_contention");
    expect(c?.severity).toBe("hard");
    expect(c?.shared).toEqual(["sid_filter_volume", "sid_voice_1-3"]);
  });

  it("SFX sharing voice 2 beside the player that owns it: unit_shared, soft", async () => {
    const r = (await checkCompatibility(["sid_play_routine_pattern", "sfx_engine_beside_music"])).structured;
    expect(r.verdict).toBe("warnings");
    const c = r.conflicts.find((x) => x.kind === "unit_shared");
    expect(c?.severity).toBe("soft");
    expect(c?.shared).toEqual(["sid_voice_2"]);
    expect(c?.resolution).toMatch(/sfx_engine_beside_music must follow sid_play_routine_pattern's protocol/);
  });

  it("the multiplexer and the panel split both own the raster IRQ", async () => {
    const res = await checkCompatibility(["sprite_multiplex_game", "scroll_panel_split"]);
    const c = res.structured.conflicts.find((x) => x.kind === "unit_contention");
    expect(c?.severity).toBe("hard");
    expect(c?.shared).toEqual(["vic_raster_irq"]);
    expect(c?.resolution).toMatch(/one raster compare/);
    expect(c?.resolution).toMatch(/irq_chain_table/);
  });

  it("zero-page overlap lists the bytes; hard when fixed, soft when one side relocates", async () => {
    const hard = (await checkCompatibility(["zp_fixed_a", "zp_fixed_b"])).structured;
    const h = hard.conflicts.find((x) => x.kind === "zero_page_overlap");
    expect(h?.severity).toBe("hard");
    expect(h?.shared).toEqual(["zero_page $F0-$F3"]);
    const soft = (await checkCompatibility(["krill_loader_integration", "zp_fixed_a"])).structured;
    const s = soft.conflicts.find((x) => x.kind === "zero_page_overlap");
    expect(s?.severity).toBe("soft");
    expect(s?.shared).toEqual(["zero_page $E8-$EF"]);
    expect(s?.resolution).toMatch(/Rebuild krill_loader_integration/);
    const none = (await checkCompatibility(["krill_loader_integration", "zp_fixed_b"])).structured;
    expect(none.conflicts.filter((x) => x.kind === "zero_page_overlap")).toEqual([]);
  });

  it("a port read while another technique drives it: unit_read_while_driven, soft", async () => {
    const r = (await checkCompatibility(["keyboard_matrix_scan", "joystick_edge_detect"])).structured;
    const c = r.conflicts.find((x) => x.kind === "unit_read_while_driven");
    expect(c?.severity).toBe("soft");
    expect(c?.shared).toEqual(["cia1_port_a"]);
    expect(c?.resolution).toMatch(/\$DC00/);
  });

  it("a start-up use of a unit another owns is info and leaves the verdict alone", async () => {
    const r = (await checkCompatibility(["lfsr_random", "sid_play_routine_pattern"])).structured;
    const c = r.conflicts.find((x) => x.kind === "init_order");
    expect(c?.severity).toBe("info");
    expect(c?.a === "lfsr_random" || c?.b === "lfsr_random").toBe(true);
    expect(c?.resolution).toMatch(/Run lfsr_random's use before sid_play_routine_pattern starts/);
    expect(r.verdict).toBe("compatible");
  });

  it("a technique and its own prerequisite are not set against each other", async () => {
    const r = (await checkCompatibility(["uses_stable", "stable_raster_irq"])).structured;
    expect(r.conflicts.filter((x) => x.kind === "unit_contention")).toEqual([]);
  });

  it("a prerequisite's claim conflicts with another input through the closure", async () => {
    // uses_stable requires stable_raster_irq; scroll_panel_split owns the raster IRQ too.
    const r = (await checkCompatibility(["uses_stable", "scroll_panel_split"])).structured;
    expect(r.conflicts.some((x) => x.kind === "unit_contention")).toBe(true);
    const p = r.conflicts.find((x) => x.kind === "prerequisite_conflict");
    expect(p?.severity).toBe("hard");
    expect(p?.via).toEqual(["stable_raster_irq"]);
  });

  it("unknown claims are never read as none: coverage and text say so", async () => {
    const res = await checkCompatibility(["unknown_claims", "pure_maths", "sfx_engine_beside_music"]);
    const cov = Object.fromEntries(res.structured.data_coverage.map((d) => [d.technique, d.claims]));
    expect(cov).toEqual({ unknown_claims: "unknown", pure_maths: "none", sfx_engine_beside_music: "stated" });
    expect(res.text).toMatch(/Unit claims are stated for 2 of 3 techniques; a unit conflict cannot be ruled out for: unknown_claims\./);
    const all = await checkCompatibility(["pure_maths", "sfx_engine_beside_music"]);
    expect(all.text).toMatch(/Unit claims are stated for 2 of 2 techniques\./);
  });

  it("technique lookup returns claims and says unknown when the page states none", async () => {
    const lfsr = await techniqueLookup("lfsr_random");
    expect(lfsr.structured.claims_stated).toBe("stated");
    expect(lfsr.structured.claims).toEqual([
      { unit: "cia1_timer_a", mode: "reads" },
      { unit: "sid_voice_3", mode: "init" },
      { unit: "sid_voice_3_readback", mode: "init" },
    ]);
    const krill = await techniqueLookup("krill_loader_integration");
    expect(krill.structured.claims).toContainEqual({ unit: "zero_page", mode: "owns", ranges: "E0-EF", relocatable: true });
    expect(krill.text).toMatch(/zero_page \$E0-\$EF \(owns, relocatable\)/);
    const unknown = await techniqueLookup("unknown_claims");
    expect(unknown.structured.claims_stated).toBe("unknown");
    expect(unknown.text).toMatch(/\*\*Claims:\*\* unknown/);
    const none = await techniqueLookup("pure_maths");
    expect(none.structured.claims_stated).toBe("none");
  });

  it("techniques_for filters on a claimed unit", async () => {
    const r = await techniquesFor({ claims: "sid_voice_3" });
    expect(r.structured.techniques.map((t) => t.name).sort()).toEqual(["lfsr_random", "second_player", "sid_play_routine_pattern"]);
  });
});
