/**
 * The briefing's build order: an optional game scaffold step, one step per
 * dependency tier of the proposed techniques, and the headless harness.
 */

import { getFalkor } from "../../context.ts";
import type { BriefingOutput, TechniqueLookupOutput } from "../../schemas/tool-outputs.ts";
import type { ArchetypeResolution } from "./archetype.ts";
import { parseRows, ScaffoldRow } from "./rows.ts";

type Step = BriefingOutput["build_order"][number];

// Group techniques by category and assign steps in dependency order:
// 1. Foundation (raster/IRQ prerequisites)
// 2. Hardware setup (banking, memory layout)
// 3. Visual effects (sprites, scroll, bitmap, effects)
// 4. Audio (music, SID)
// 5. Loader/compression (last — wrap everything)
const STEP_PRIORITY = new Map<string, number>([
  ["raster", 1],
  ["banking", 2],
  ["cpu", 2],
  ["input", 2],
  ["maths", 2],
  ["sprite", 3],
  ["scroll", 3],
  ["bitmap", 3],
  ["effect", 3],
  ["render", 3],
  ["logic", 3],
  ["text", 3],
  ["music", 4],
  ["loader", 5],
  ["io", 5],
]);

const STEP_LABELS = new Map<number, string>([
  [1, "Raster IRQ foundation"],
  [2, "Memory layout, banking, input and maths"],
  [3, "Visual / text-mode rendering and game logic"],
  [4, "SID audio"],
  [5, "Loader, compression and file I/O"],
]);

/** Recipe name -> source page, for the scaffold recipes only. */
export type ScaffoldPages = Map<string, string>;

async function scaffoldRecipes(
  resolved: ArchetypeResolution | undefined,
  archetypeKey: string,
  pages: ScaffoldPages,
) {
  // With the archetype resolved in the graph, the scaffold recipes are the
  // ones whose frontmatter says scaffolds: [<archetype>] (a Recipe
  // SCAFFOLDS Archetype edge, docs/ONTOLOGY.md). The fallback tables know
  // no edges, so a fallback shmup key still offers the seed shmup recipe
  // by name when its node exists.
  let cypher: string;
  let params: Record<string, unknown> | undefined;
  if (resolved?.mode === "graph") {
    cypher = `MATCH (r:Recipe)-[:SCAFFOLDS]->(a:Archetype {name: $name}) RETURN r.name AS name, r.source_doc AS source_doc ORDER BY name`;
    params = { name: resolved.archetype.name };
  } else if (resolved?.mode === "fallback" && archetypeKey.includes("shmup")) {
    cypher = `MATCH (r:Recipe {name: "oscar64-simple-shmup"}) RETURN r.name AS name, r.source_doc AS source_doc`;
  } else {
    return [];
  }
  const fk = await getFalkor();
  const result = await fk.roQuery(cypher, params);
  let rows = parseRows(ScaffoldRow, result.data);
  // The fallback lookup reads its first row only.
  if (resolved.mode === "fallback") rows = rows.slice(0, 1);
  const recipes: string[] = [];
  for (const row of rows) {
    if (!row.name) continue;
    recipes.push(row.name);
    if (row.source_doc) pages.set(row.name, row.source_doc);
  }
  return recipes;
}

/**
 * The scaffold step for a game brief. In the not-found case the label says
 * "generic": the graph did not recognise the name, so the scaffold must not
 * be labelled with it, and nothing is offered.
 */
async function scaffoldStep(
  resolved: ArchetypeResolution | undefined,
  archetype: string | undefined,
  pages: ScaffoldPages,
): Promise<Omit<Step, "step">> {
  let archetypeKey = (archetype ?? "").toLowerCase();
  if (resolved?.mode === "graph") archetypeKey = resolved.archetype.name;
  else if (resolved?.mode === "not_found") archetypeKey = "";
  return {
    label: `Game scaffold (${archetypeKey || "generic"} archetype)`,
    recipes: await scaffoldRecipes(resolved, archetypeKey, pages),
  };
}

function techniqueSteps(techs: TechniqueLookupOutput[]): Omit<Step, "step">[] {
  const grouped = new Map<number, TechniqueLookupOutput[]>();
  for (const tech of techs) {
    const priority = STEP_PRIORITY.get(tech.category) ?? 3;
    const group = grouped.get(priority) ?? [];
    group.push(tech);
    grouped.set(priority, group);
  }
  return Array.from(grouped.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([priority, group]) => ({
      label: STEP_LABELS.get(priority) ?? `${group[0]?.category ?? ""} techniques`,
      recipes: [...new Set(group.flatMap((t) => t.recipes.map((r) => r.name)))],
    }));
}

/**
 * Every plan ends with the harness: the exit code from the $02FF byte and
 * the border is how a build proves itself without a human, and a brief
 * that asks for a "headless harness" has no technique node to reach it
 * through. Offered when the primary toolchain's recipe is in the graph.
 */
async function harnessStep(): Promise<Omit<Step, "step"> | undefined> {
  const fk = await getFalkor();
  const harness = await fk.roQuery(
    `MATCH (r:Recipe {name: "oscar64-headless-verify"}) RETURN r.name AS name`,
  );
  if (harness.data.length === 0) return undefined;
  return {
    label: "Headless verification (exit code from the $02FF byte and the border)",
    recipes: ["oscar64-headless-verify"],
  };
}

export async function buildOrder(opts: {
  techs: TechniqueLookupOutput[];
  isGame: boolean;
  resolved: ArchetypeResolution | undefined;
  archetype: string | undefined;
}): Promise<{ build_order: Step[]; scaffoldPages: ScaffoldPages }> {
  // The text renderer prints each scaffold recipe's page so the agent knows
  // which file to copy. It rides outside the structured output, whose shape
  // does not change.
  const scaffoldPages: ScaffoldPages = new Map();
  const steps: Omit<Step, "step">[] = [];
  // A game brief that named no archetype and was routed to none has no
  // scaffold to offer, so it gets no scaffold step.
  if (opts.isGame && opts.resolved !== undefined) {
    steps.push(await scaffoldStep(opts.resolved, opts.archetype, scaffoldPages));
  }
  steps.push(...techniqueSteps(opts.techs));
  const harness = await harnessStep();
  if (harness) steps.push(harness);
  return { build_order: steps.map((s, i) => ({ step: i + 1, ...s })), scaffoldPages };
}
