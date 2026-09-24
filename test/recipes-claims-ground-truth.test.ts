import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { FalkorService } from "../src/services/falkor.ts";
import { checkCompatibility } from "../src/tools/query.ts";
import { extractGraphEntities } from "../src/graph/extract.ts";
import { applyEdge, applyNode, isNodeEntity } from "../src/graph/apply.ts";

// Ground truth for the compatibility rules (#22, every hard kind since
// #29). Every recipe in docs/recipes was built and run in VICE, so the
// techniques one recipe implements do coexist on the machine.
// check_compatibility over a recipe's technique set must therefore report
// no hard conflict of any kind, directly or through a prerequisite. The
// graph is built here from the real pages (Technique and KernalRoutine
// nodes; REQUIRES, CLAIMS, DEMANDS, REQUIRES_REGION and KERNAL USES edges),
// so a Demands or Claims line that sets two cooperating techniques against
// each other fails this test by name.
const DOCS = path.resolve(__dirname, "../docs");

function markdownUnder(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((d) => d.isFile() && d.name.endsWith(".md"))
    .map((d) => path.join(d.parentPath, d.name));
}

const extract = (abs: string) => extractGraphEntities(fs.readFileSync(abs, "utf8"), path.relative(DOCS, abs));

const NODES = new Set(["technique", "kernal_routine"]);
const EDGES = new Set([
  "technique_requires",
  "claims",
  "technique_demands",
  "technique_requires_region",
  "technique_uses_kernal",
]);

// Nodes first, then the edges the hard rules read, as ingest's two passes do.
async function loadTechniques(f: FalkorService): Promise<void> {
  const ents = [
    ...markdownUnder(path.join(DOCS, "techniques")),
    ...markdownUnder(path.join(DOCS, "hardware")),
  ].flatMap(extract);
  for (const e of ents) if (isNodeEntity(e) && NODES.has(e.type)) await applyNode(f, e);
  for (const e of ents) if (!isNodeEntity(e) && EDGES.has(e.type)) await applyEdge(f, e);
}

describe("recipes against their own technique sets", () => {
  let f: FalkorService;
  const recipeSets = new Map<string, string[]>();
  const recipeBands = new Map<string, Map<string, string>>();

  beforeAll(async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    f = new FalkorService();
    await f.connect();
    await f.clean();
    await f.ensureSchema();
    await loadTechniques(f);
    for (const abs of markdownUnder(path.join(DOCS, "recipes"))) {
      const key = path.relative(DOCS, abs);
      const implemented = extract(abs).flatMap((e) => (e.type === "implements" ? [e] : []));
      const techniques = implemented.map((e) => e.technique);
      if (techniques.length > 0) recipeSets.set(key, techniques);
      const bands = implemented.flatMap((e) => (e.band ? [[e.technique, e.band] as const] : []));
      if (bands.length > 0) recipeBands.set(key, new Map(bands));
    }
    warn.mockRestore();
  }, 120000);
  afterAll(async () => f.close());

  it("the graph holds the claims the check needs", async () => {
    const rows = await f.roQuery(
      `MATCH (t:Technique {name: 'fli_image'})-[:CLAIMS]->(h:HardwareUnit) RETURN h.name AS unit ORDER BY unit`,
    );
    expect(rows.data.map((r) => (r as { unit: string }).unit)).toEqual([
      "cia2_vic_bank",
      "vic_char_base",
      "vic_matrix_base",
      "vic_raster_irq",
      "vic_yscroll",
    ]);
    expect([...recipeSets.values()].filter((t) => t.length > 1).length).toBeGreaterThan(10);
  });

  it("the graph holds the demands and KERNAL uses the hard rules read", async () => {
    const rows = await f.roQuery(
      `MATCH (t:Technique {name: 'fli_image'})-[:DEMANDS]->(r:Resource) RETURN r.name AS name ORDER BY name`,
    );
    expect(rows.data.map((r) => (r as { name: string }).name)).toEqual([
      "constant_sprite_set",
      "cpu_every_line",
    ]);
    const kernal = await f.roQuery(`MATCH (:Technique)-[u:USES]->(:KernalRoutine) RETURN count(u) AS n`);
    expect((kernal.data[0] as { n: number }).n).toBeGreaterThan(0);
  });

  // #35: the claims watch found these gaps in VICE store traces.
  it("states the claims the claims watch measured (#35)", async () => {
    const named = [
      "soft_scroll_v",
      "char_scroll_buffer_v",
      "sid_voice_setup",
      "kernal_file_write_seq",
      "kernal_file_read_seq",
      "kernal_load_to_address",
    ];
    const rows = await f.roQuery(
      `MATCH (t:Technique) WHERE t.name IN $named RETURN t.name AS name, t.claims_stated AS stated ORDER BY name`,
      { named },
    );
    const stated = rows.data as { name: string; stated: string | null }[];
    expect(stated.filter((r) => r.stated == null).map((r) => r.name)).toEqual([]);
    expect(stated.length).toBe(named.length);
    for (const recipe of [
      "recipes/kickassembler/sprite-multiplex-game.md",
      "recipes/kickassembler/scroll-panel-split.md",
    ])
      expect(recipeSets.get(recipe)).toContain("ram_under_kernal");
  });

  it("reports a KERNAL disk call against a technique that owns CIA1 timer B (#35)", async () => {
    await f.addTechnique({
      name: "timer_b_owner_35",
      title: "timer_b_owner_35",
      category: "cpu",
      complexity: "low",
      claims_stated: "stated",
      claims_basis: "derived-listing",
    });
    await f.linkClaims({
      owner: "timer_b_owner_35",
      ownerKind: "Technique",
      unit: "cia1_timer_b",
      mode: "owns",
      basis: "derived-listing",
    });
    for (const disk of ["kernal_file_write_seq", "kernal_file_read_seq", "kernal_load_to_address"]) {
      const { conflicts } = (await checkCompatibility([disk, "timer_b_owner_35"])).structured;
      const hit = conflicts.find((c) => c.shared.includes("cia1_timer_b"));
      expect(hit?.kind, disk).toBe("unit_shared");
    }
  });

  // #71: YSCROLL is a HardwareUnit, read from the real pages.
  it("sets soft_scroll_v against FLD on vic_yscroll, and not against its panel split (#71)", async () => {
    const fld = (await checkCompatibility(["soft_scroll_v", "fld_flexible_line_distance"])).structured;
    expect(fld.verdict).toBe("incompatible");
    const hit = fld.conflicts.find((c) => c.kind === "unit_contention");
    expect(hit?.shared).toEqual(["vic_yscroll"]);
    expect(hit?.severity).toBe("hard");
    const panel = (await checkCompatibility(["soft_scroll_v", "char_scroll_buffer_v", "scroll_panel_split"]))
      .structured;
    expect(panel.conflicts.filter((c) => c.severity === "hard")).toEqual([]);
    expect(panel.conflicts.some((c) => c.kind === "unit_shared" && c.shared.includes("vic_yscroll"))).toBe(
      true,
    );
  });

  // #90, from the real pages: the scroller's sprites are the side-border
  // loop's constant set; unplaced, the movable band still keeps cpu_vs_irq.
  it("sets no sprite contention between sideborder_open and sprite_border_scroller (#90)", async () => {
    const pair = (await checkCompatibility(["sideborder_open", "sprite_border_scroller"])).structured;
    expect(
      pair.conflicts.filter((c) => c.shared.some((u) => u.startsWith("sprite_") && c.severity === "hard")),
    ).toEqual([]);
    expect(pair.conflicts.some((c) => c.kind === "sprite_set" && c.severity === "soft")).toBe(true);
    expect(pair.conflicts.find((c) => c.kind === "cpu_vs_irq")?.severity).toBe("hard");
    const placed = (
      await checkCompatibility(["sideborder_open@248-272", "sprite_border_scroller@273-311,0-1"])
    ).structured;
    expect(placed.conflicts.filter((c) => c.severity === "hard")).toEqual([]);
    expect(placed.band_separated.map((b) => b.rules)).toEqual([["cpu_vs_irq"]]);
  });

  it("no recipe's technique set has a hard conflict of any kind", async () => {
    const failures: string[] = [];
    for (const [recipe, techniques] of [...recipeSets].sort()) {
      if (techniques.length < 2) continue;
      // A recipe's raster_bands: place its movable techniques where its trace ran them (#90).
      const specs = techniques.map((t) => {
        const band = recipeBands.get(recipe)?.get(t);
        return band ? `${t}@${band}` : t;
      });
      const { conflicts, placements_refused } = (await checkCompatibility(specs)).structured;
      for (const p of placements_refused ?? [])
        failures.push(`${recipe}: placement refused ${p.input}: ${p.why}`);
      for (const c of conflicts) {
        const kind = c.underlying_kind ?? c.kind;
        if (c.severity !== "hard") continue;
        const via = c.via?.length ? ` via ${c.via.join(", ")}` : "";
        failures.push(`${recipe}: ${kind} ${c.a} × ${c.b}${via} on ${c.shared.join(", ")}`);
      }
    }
    expect(failures).toEqual([]);
  }, 120000);
});
