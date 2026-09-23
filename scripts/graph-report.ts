/**
 * graph-report: measure the knowledge graph's shape, because a sparse graph
 * is the published reason a graph adds nothing over the text it points at.
 *
 *   node scripts/graph-report.ts          # plain text
 *   node scripts/graph-report.ts --json
 *
 * Reads the live graph (FALKOR_GRAPH, default c64). Report only; exit 0.
 */
import { getFalkor } from "../src/context.ts";

type Row = Record<string, unknown>;
const f = await getFalkor();
const q = async (cypher: string): Promise<Row[]> => ((await f.roQuery(cypher)).data ?? []) as Row[];
const n = (v: unknown) => Number(v ?? 0);

const labels = await q(`MATCH (x) RETURN labels(x)[0] AS label, count(*) AS c ORDER BY c DESC`);
const rels = await q(`MATCH ()-[r]->() RETURN type(r) AS rel, count(*) AS c ORDER BY c DESC`);
const techDeg = await q(
  `MATCH (t:Technique) OPTIONAL MATCH (t)-[r]-() RETURN t.name AS name, count(r) AS deg ORDER BY deg`,
);
const techNoRecipe = await q(
  `MATCH (t:Technique) WHERE NOT (:Recipe)-[:IMPLEMENTS]->(t) RETURN t.name AS name ORDER BY name`,
);
const techNoPitDirect = await q(
  `MATCH (t:Technique) WHERE NOT (:Pitfall)-[:TRIGGERED_BY|MITIGATED_BY]->(t) RETURN t.name AS name ORDER BY name`,
);
const techNoPitAny = await q(
  `MATCH (t:Technique) WHERE NOT (:Pitfall)-[:TRIGGERED_BY|MITIGATED_BY]->(t) AND NOT (:Pitfall)-[:TRIGGERED_BY]->()<-[:USES]-(t) RETURN t.name AS name ORDER BY name`,
);
const pitNoTech = await q(
  `MATCH (p:Pitfall) WHERE NOT (p)-[:TRIGGERED_BY]->(:Technique) RETURN p.name AS name ORDER BY name`,
);
const isolated = await q(
  `MATCH (x) WHERE NOT (x)--() RETURN labels(x)[0] AS label, x.name AS name ORDER BY label, name`,
);
const arch = await q(
  `MATCH (a:Archetype) OPTIONAL MATCH (a)-[:FEATURES]->(t) OPTIONAL MATCH (a)-[:RISKS]->(p) OPTIONAL MATCH (r:Recipe)-[:SCAFFOLDS]->(a) RETURN a.name AS name, count(DISTINCT t) AS features, count(DISTINCT p) AS risks, count(DISTINCT r) AS scaffolds ORDER BY name`,
);
// Unit claims (schema 25): which units are claimed, and how many techniques
// state claims, say none, or leave them unknown.
const unitsClaimed = await q(
  `MATCH (h:HardwareUnit) OPTIONAL MATCH (t:Technique)-[:CLAIMS]->(h) RETURN h.name AS name, count(t) AS c ORDER BY c DESC, name`,
);
const claimsStated = await q(
  `MATCH (t:Technique) RETURN coalesce(t.claims_stated, 'unknown') AS s, count(*) AS c`,
);

// Connected components over the undirected edge list, in TypeScript.
const edges = await q(`MATCH (a)-[r]->(b) RETURN id(a) AS a, id(b) AS b`);
const nodes = await q(`MATCH (x) RETURN id(x) AS id`);
const parent = new Map<number, number>();
const find = (x: number): number => {
  let r = x;
  while (parent.get(r) !== r) r = parent.get(r)!;
  while (parent.get(x) !== r) {
    const nx = parent.get(x)!;
    parent.set(x, r);
    x = nx;
  }
  return r;
};
for (const r of nodes) parent.set(n(r.id), n(r.id));
for (const e of edges) {
  const a = find(n(e.a)),
    b = find(n(e.b));
  if (a !== b) parent.set(a, b);
}
const compSize = new Map<number, number>();
for (const r of nodes) {
  const root = find(n(r.id));
  compSize.set(root, (compSize.get(root) ?? 0) + 1);
}
const sizes = [...compSize.values()].sort((a, b) => b - a);

const degs = techDeg.map((r) => n(r.deg)).sort((a, b) => a - b);
const median = degs.length ? degs[Math.floor(degs.length / 2)] : 0;
const report = {
  nodes: Object.fromEntries(labels.map((r) => [String(r.label), n(r.c)])),
  edges: Object.fromEntries(rels.map((r) => [String(r.rel), n(r.c)])),
  technique_degree: {
    min: degs[0] ?? 0,
    median,
    max: degs[degs.length - 1] ?? 0,
    count: degs.length,
    lowest: techDeg.slice(0, 8).map((r) => `${r.name}:${n(r.deg)}`),
  },
  components: {
    count: sizes.length,
    largest: sizes[0] ?? 0,
    largest_share: nodes.length ? +((100 * (sizes[0] ?? 0)) / nodes.length).toFixed(1) : 0,
    singletons: sizes.filter((s) => s === 1).length,
  },
  isolated_nodes: isolated.map((r) => `${r.label}:${r.name}`),
  techniques_without_recipe: techNoRecipe.map((r) => String(r.name)),
  techniques_without_direct_pitfall: techNoPitDirect.map((r) => String(r.name)),
  techniques_without_any_pitfall_even_via_registers: techNoPitAny.map((r) => String(r.name)),
  pitfalls_without_technique_trigger: pitNoTech.map((r) => String(r.name)),
  claims: {
    techniques: Object.fromEntries(claimsStated.map((r) => [String(r.s), n(r.c)])),
    units_claimed: unitsClaimed.filter((r) => n(r.c) > 0).map((r) => `${r.name}:${n(r.c)}`),
    units_unclaimed: unitsClaimed.filter((r) => n(r.c) === 0).map((r) => String(r.name)),
  },
  archetypes: arch.map((r) => ({
    name: String(r.name),
    features: n(r.features),
    risks: n(r.risks),
    scaffolds: n(r.scaffolds),
  })),
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const line = (k: string, v: unknown) => {
    console.log(
      `${k}: ${Array.isArray(v) ? `${v.length}${v.length ? " (" + v.slice(0, 12).join(", ") + (v.length > 12 ? ", ..." : "") + ")" : ""}` : JSON.stringify(v)}`,
    );
  };
  console.log("nodes:", JSON.stringify(report.nodes));
  console.log("edges:", JSON.stringify(report.edges));
  console.log("technique degree:", JSON.stringify(report.technique_degree));
  console.log("components:", JSON.stringify(report.components));
  line("isolated nodes", report.isolated_nodes);
  line("techniques without a recipe", report.techniques_without_recipe);
  line("techniques without a direct pitfall", report.techniques_without_direct_pitfall);
  line(
    "techniques without any pitfall, even through their registers",
    report.techniques_without_any_pitfall_even_via_registers,
  );
  line("pitfalls with no technique trigger", report.pitfalls_without_technique_trigger);
  console.log("claims (techniques):", JSON.stringify(report.claims.techniques));
  line("units claimed", report.claims.units_claimed);
  line("units no technique claims", report.claims.units_unclaimed);
  console.log(
    "archetypes:",
    report.archetypes.map((a) => `${a.name} f${a.features} r${a.risks} s${a.scaffolds}`).join("; "),
  );
}
process.exit(0);
