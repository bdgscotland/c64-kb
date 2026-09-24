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

  beforeAll(async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    f = new FalkorService();
    await f.connect();
    await f.clean();
    await f.ensureSchema();
    await loadTechniques(f);
    for (const abs of markdownUnder(path.join(DOCS, "recipes"))) {
      const key = path.relative(DOCS, abs);
      const techniques = extract(abs).flatMap((e) => (e.type === "implements" ? [e.technique] : []));
      if (techniques.length > 0) recipeSets.set(key, techniques);
    }
    warn.mockRestore();
  }, 120000);
  afterAll(async () => f.close());

  it("the graph holds the claims the check needs", async () => {
    const rows = await f.roQuery(
      `MATCH (t:Technique {name: 'fli_image'})-[:CLAIMS]->(h:HardwareUnit) RETURN h.name AS unit ORDER BY unit`,
    );
    expect(rows.data.map((r) => (r as { unit: string }).unit)).toEqual(["cia2_vic_bank", "vic_raster_irq"]);
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

  it("no recipe's technique set has a hard conflict of any kind", async () => {
    const failures: string[] = [];
    for (const [recipe, techniques] of [...recipeSets].sort()) {
      if (techniques.length < 2) continue;
      const { conflicts } = (await checkCompatibility(techniques)).structured;
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
