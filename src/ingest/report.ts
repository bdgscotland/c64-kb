/**
 * The end of a batch ingest: the address-derived IN_REGION edges, the stub
 * Technique scan, and the summary line plus the matching DONE log record.
 */

import { z } from "zod";
import type { FalkorService } from "../services/falkor.ts";
import type { QdrantService } from "../services/qdrant.ts";
import { log } from "./files.ts";
import type { EdgeTally, NodeTally, TrackedEdge } from "./tally.ts";

/**
 * Address-derived edges: every Register and KERNAL routine into the
 * memory-map region that contains it. Needs all nodes to exist first.
 */
export async function linkRegions(falkor: FalkorService, print: (line: string) => void): Promise<void> {
  const inRegion = await falkor.linkAddressesToRegions();
  print(
    `IN_REGION: ${inRegion.registers} registers, ${inRegion.kernal} KERNAL routines placed in memory regions`,
  );
}

/**
 * Technique nodes created by linkRecipeImplements MERGE stubs have no title
 * or category: they indicate a typo in a recipe's techniques: array.
 */
export async function findStubTechniques(falkor: FalkorService): Promise<string[]> {
  const stubResult = await falkor.roQuery(
    `MATCH (t:Technique)
     WHERE t.title IS NULL OR t.title = ""
     RETURN t.name AS name
     ORDER BY name`,
  );
  const stubs = z
    .array(z.object({ name: z.string() }))
    .parse(stubResult.data)
    .map((r) => r.name);
  if (stubs.length > 0) {
    console.warn(`[ingest] stub Technique nodes (typo in recipe.techniques array?): ${stubs.join(", ")}`);
    log(`STUB_TECHNIQUES ${stubs.join(", ")}`);
  }
  return stubs;
}

/**
 * **Cost measured on:** and **Cost includes:** (schema 27) are properties,
 * not edges, so no MERGE can drop a bad one: check them against the nodes
 * here. A recipe that is no Recipe, a recipe that does not realise the
 * technique (no IMPLEMENTS edge to it), or an included name that is no
 * Technique, is warned about and counted, the same as a dropped edge. The
 * realise check is #41's: a pal_ntsc_detection card once carried the fire
 * effect's frame cost, measured on kickassembler-fire-effect.
 */
export async function findCostReferenceMisses(falkor: FalkorService): Promise<string[]> {
  const Row = z.object({
    name: z.string(),
    recipe: z.string().nullable(),
    includes: z.array(z.string()).nullable(),
    realisers: z.array(z.string()),
  });
  const rows = z.array(Row).parse(
    (
      await falkor.roQuery(
        `MATCH (t:Technique) WHERE t.cost_recipe IS NOT NULL OR t.cost_includes IS NOT NULL
         OPTIONAL MATCH (r:Recipe)-[:IMPLEMENTS]->(t)
         RETURN t.name AS name, t.cost_recipe AS recipe, t.cost_includes AS includes,
                collect(r.name) AS realisers`,
      )
    ).data,
  );
  const recipes = new Set(
    z
      .array(z.object({ name: z.string() }))
      .parse((await falkor.roQuery(`MATCH (r:Recipe) RETURN r.name AS name`)).data)
      .map((r) => r.name),
  );
  const techniques = new Set(
    z
      .array(z.object({ name: z.string() }))
      .parse((await falkor.roQuery(`MATCH (t:Technique) WHERE t.title <> "" RETURN t.name AS name`)).data)
      .map((r) => r.name),
  );
  const misses: string[] = [];
  for (const r of rows) {
    if (r.recipe && !recipes.has(r.recipe))
      misses.push(`${r.name}: Cost measured on ${r.recipe} (no such recipe)`);
    else if (r.recipe && !r.realisers.includes(r.recipe))
      misses.push(`${r.name}: Cost measured on ${r.recipe} (a recipe that does not realise it)`);
    for (const inc of r.includes ?? [])
      if (!techniques.has(inc)) misses.push(`${r.name}: Cost includes ${inc} (no such technique)`);
  }
  if (misses.length > 0) {
    console.warn(`[ingest] WARNING: ${misses.length} Cost reference(s) name no node: ${misses.join("; ")}`);
    log(`COST_REFERENCE_MISSES ${misses.join("; ")}`);
  }
  return misses;
}

/** Report label, edge label in the graph, and tally kind, in report order. */
const EDGE_LINES: readonly [label: string, rel: string, kind: TrackedEdge][] = [
  ["triggered_by", "TRIGGERED_BY", "triggered_by"],
  ["caused_by", "CAUSED_BY", "caused_by"],
  ["requires", "REQUIRES", "technique_requires"],
  ["mitigated_by", "MITIGATED_BY", "mitigated_by"],
  ["archetype_features", "FEATURES", "archetype_features"],
  ["archetype_risks", "RISKS", "archetype_risks"],
  ["scaffolds", "SCAFFOLDS", "scaffolds"],
  ["claims", "CLAIMS", "claims"],
  ["clobbers_zp", "CLOBBERS_ZP", "kernal_clobbers_zp"],
  ["composes", "COMPOSES", "composes"],
  ["instance_of", "INSTANCE_OF", "instance_of"],
  ["realised_by", "REALISED_BY", "realised_by"],
];

interface EdgeCount {
  label: string;
  landed: number;
  distinct: number;
  dropped: number;
}

/**
 * Count what actually landed: an edge whose target name matches no node is
 * dropped by the MERGE, and the request counters cannot see that.
 */
async function countEdges(falkor: FalkorService, rel: string): Promise<number> {
  const r = await falkor.roQuery(`MATCH ()-[e:${rel}]->() RETURN count(e) AS n`);
  const row = z.object({ n: z.number() }).safeParse(r.data[0]);
  return row.success ? row.data.n : 0;
}

export async function reportSummary(opts: {
  qdrant: QdrantService;
  falkor: FalkorService;
  nodes: NodeTally;
  edges: EdgeTally;
  stubTechniques: string[];
  print: (line: string) => void;
}): Promise<void> {
  const { qdrant, falkor, nodes, edges, stubTechniques, print } = opts;
  const costMisses = await findCostReferenceMisses(falkor);
  const qStats = await qdrant.getStats();
  const gStats = await falkor.getStats();
  const counts: EdgeCount[] = [];
  for (const [label, rel, kind] of EDGE_LINES) {
    counts.push({
      label,
      landed: await countEdges(falkor, rel),
      distinct: edges.distinct(kind),
      dropped: edges.dropped(kind),
    });
  }
  const sentence = (c: EdgeCount): string =>
    `${c.label}: ${c.landed} edges in graph, ${c.distinct} distinct references, ${c.dropped} dropped.`;
  const record = (c: EdgeCount): string => `${c.label}=${c.landed}/${c.distinct}/dropped=${c.dropped}`;
  // The first four follow the pitfall and crash-pattern counts, the next
  // five the archetype count, the last three the game-design count.
  const pitfallEdges = counts.slice(0, 4);
  const archetypeEdges = counts.slice(4, 9);
  const designEdges = counts.slice(9);

  print(`\nQdrant: ${qStats.total_points} vectors`);
  print(`FalkorDB: ${gStats.nodes} nodes, ${gStats.edges} edges`);
  print(
    [
      `Ingested ${nodes.chunks} new chunks. Skipped ${nodes.skipped} unchanged files. stub Techniques: ${stubTechniques.length}. pairs_with skipped: ${edges.pairsWithSkipped} (missing KERNAL targets). Pitfalls: ${nodes.pitfalls}. CrashPatterns: ${nodes.crashPatterns}.`,
      ...pitfallEdges.map(sentence),
      `Archetypes: ${nodes.archetypes}.`,
      ...archetypeEdges.map(sentence),
      `GameDesigns: ${nodes.gameDesigns}.`,
      ...designEdges.map(sentence),
      `Cost references unresolved: ${costMisses.length}.`,
    ].join(" "),
  );
  const droppedRefs = edges.totalDropped();
  if (droppedRefs > 0) {
    console.warn(
      `[ingest] WARNING: ${droppedRefs} trigger/cause/requires/mitigated-by/archetype/scaffolds/claims/clobbers-zp/game-design references named no existing node (or would have closed a REQUIRES cycle) and were dropped; see the [falkor] lines above.`,
    );
  }
  log(
    [
      `DONE chunks=${nodes.chunks} skipped=${nodes.skipped} stub_techniques=${stubTechniques.length} pairs_with_skipped=${edges.pairsWithSkipped} pitfalls=${nodes.pitfalls} crash_patterns=${nodes.crashPatterns}`,
      ...pitfallEdges.map(record),
      `archetypes=${nodes.archetypes}`,
      ...archetypeEdges.map(record),
      `game_designs=${nodes.gameDesigns}`,
      ...designEdges.map(record),
      `cost_reference_misses=${costMisses.length}`,
    ].join(" "),
  );
}
