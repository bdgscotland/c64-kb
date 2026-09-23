import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { FalkorService } from "../src/services/falkor.ts";
import { checkCompatibility } from "../src/tools/query.ts";
import { extractGraphEntities } from "../src/graph/extract.ts";

// Ground truth for the unit rules (#22). Every recipe in docs/recipes was
// built and run in VICE, so the techniques one recipe implements do coexist
// on the machine. check_compatibility over a recipe's technique set must
// therefore report no hard unit_contention or zero_page_overlap, directly
// or through a prerequisite. The graph is built here from the real
// technique pages (nodes, REQUIRES, CLAIMS), so a Claims line that sets two
// cooperating techniques against each other fails this test by name.
const DOCS = path.resolve(__dirname, "../docs");
const UNIT_KINDS = new Set(["unit_contention", "zero_page_overlap"]);

function markdownUnder(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((d) => d.isFile() && d.name.endsWith(".md"))
    .map((d) => path.join(d.parentPath, d.name));
}

const extract = (abs: string) => extractGraphEntities(fs.readFileSync(abs, "utf8"), path.relative(DOCS, abs));

// Technique nodes first, then their REQUIRES and CLAIMS edges, as ingest's two passes do.
async function loadTechniques(f: FalkorService): Promise<void> {
  const ents = markdownUnder(path.join(DOCS, "techniques")).flatMap(extract);
  for (const e of ents) if (e.type === "technique") await f.addTechnique(e);
  for (const e of ents) {
    if (e.type === "technique_requires") await f.linkTechniqueRequires(e.technique, e.requires);
    if (e.type === "claims") await f.linkClaims(e);
  }
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

  it("no recipe's technique set has a hard unit conflict", async () => {
    const failures: string[] = [];
    for (const [recipe, techniques] of [...recipeSets].sort()) {
      if (techniques.length < 2) continue;
      const { conflicts } = (await checkCompatibility(techniques)).structured;
      for (const c of conflicts) {
        const kind = c.underlying_kind ?? c.kind;
        if (c.severity !== "hard" || !UNIT_KINDS.has(kind)) continue;
        const via = c.via?.length ? ` via ${c.via.join(", ")}` : "";
        failures.push(`${recipe}: ${kind} ${c.a} × ${c.b}${via} on ${c.shared.join(", ")}`);
      }
    }
    expect(failures).toEqual([]);
  }, 120000);
});
