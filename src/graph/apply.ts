/**
 * Apply extracted graph entities to FalkorDB. One place maps each entity
 * type to its FalkorService call, for both batch ingest (src/ingest.ts,
 * nodes in pass 1 and edges in pass 2) and single-file ingest
 * (src/tools/hydrate.ts, one pass). Both used to carry their own ~30-case
 * switch; batch ingest's had no exhaustiveness check, so a new entity type
 * would have been skipped there without a word.
 */

import type { FalkorService } from "../services/falkor.ts";
import type { GraphEntity } from "./extract.ts";

const NODE_TYPES = [
  "register",
  "kernal_routine",
  "memory_region",
  "tool",
  "file_format",
  "recipe",
  "technique",
  "pitfall",
  "crash_pattern",
  "archetype",
  "game_design",
] as const;

export type NodeEntity = Extract<GraphEntity, { type: (typeof NODE_TYPES)[number] }>;
type RecipeEntity = Extract<GraphEntity, { type: "recipe" }>;

/** Edges a Recipe node implies from its own properties; the extractor does not emit these. */
export type RecipeEdge =
  | { type: "recipe_uses_tool"; recipe: string; tool: string }
  | { type: "recipe_uses_register"; recipe: string; register: string }
  | { type: "recipe_uses_kernal"; recipe: string; kernal: string };

export type EdgeEntity = Exclude<GraphEntity, NodeEntity> | RecipeEdge;

/** Nodes must exist before the edges that reference them, so batch ingest creates them first. */
export function isNodeEntity(e: GraphEntity): e is NodeEntity {
  return NODE_TYPES.some((t) => t === e.type);
}

export function recipeEdges(r: RecipeEntity): RecipeEdge[] {
  return [
    { type: "recipe_uses_tool", recipe: r.name, tool: r.toolchain },
    ...r.uses_registers.map((register): RecipeEdge => ({
      type: "recipe_uses_register",
      recipe: r.name,
      register,
    })),
    ...r.uses_kernal.map((kernal): RecipeEdge => ({ type: "recipe_uses_kernal", recipe: r.name, kernal })),
  ];
}

export async function applyNode(f: FalkorService, e: NodeEntity): Promise<void> {
  switch (e.type) {
    case "register":
      return f.addRegister(e.name, e.address, e.chip, e.rw, e.aliases);
    case "kernal_routine":
      return f.addKernalRoutine(e.name, e.address, e.description);
    case "memory_region":
      return f.addMemoryRegion(e.name, e.start, e.end, e.default_use ?? "", e.bank_switchable ?? false);
    case "tool":
      return f.addTool(e);
    case "file_format":
      return f.addFileFormat(e.name, e.description);
    case "recipe":
      return f.addRecipe(e);
    case "technique":
      return f.addTechnique(e);
    case "pitfall":
      return f.addPitfall(e);
    case "crash_pattern":
      return f.addCrashPattern(e);
    case "archetype":
      return f.addArchetype(e);
    case "game_design":
      return f.addGameDesign(e);
    default: {
      // A node type added to NODE_TYPES without a case here is a tsc error.
      const unhandled: never = e;
      throw new Error(`no graph applier for node ${JSON.stringify(unhandled)}`);
    }
  }
}

type EdgeByType = { [E in EdgeEntity as E["type"]]: E };
type Linker<E> = (f: FalkorService, e: E) => Promise<boolean>;

/** A link call whose result says nothing about whether the edge landed. */
function always<E>(link: (f: FalkorService, e: E) => Promise<unknown>): Linker<E> {
  return async (f, e) => {
    await link(f, e);
    return true;
  };
}

// One entry per edge type: a type missing here is a tsc error, the table
// form of a `never` guard. Each returns false when the link reports that
// the edge did not land (a target name that matches no node, or a
// REQUIRES that would close a cycle).
const LINKERS: { [K in keyof EdgeByType]: Linker<EdgeByType[K]> } = {
  belongs_to: always((f, e) => f.linkBelongsTo(e.entityType, e.entityName, e.chip)),
  pairs_with: async (f, e) => (await f.linkPairsWith(e.a, e.b)).linked,
  produces: always((f, e) => f.linkProduces(e.tool, e.format)),
  consumes: always((f, e) => f.linkConsumes(e.tool, e.format)),
  targets: always((f, e) => f.linkTargets(e.tool, e.chip)),
  implements: always((f, e) => f.linkRecipeImplements(e.recipe, e.technique)),
  produces_format: always((f, e) => f.linkRecipeProducesFormat(e.recipe, e.format)),
  scaffolds: (f, e) => f.linkRecipeScaffolds(e.recipe, e.archetype),
  recipe_occupies: always((f, e) => f.linkRecipeOccupies(e.recipe, e.start, e.end)),
  recipe_uses_tool: always((f, e) => f.linkRecipeUsesTool(e.recipe, e.tool)),
  recipe_uses_register: always((f, e) => f.linkRecipeUsesRegister(e.recipe, e.register)),
  recipe_uses_kernal: always((f, e) => f.linkRecipeUsesKernal(e.recipe, e.kernal)),
  technique_uses_register: always((f, e) => f.linkTechniqueUsesRegister(e.technique, e.register)),
  technique_uses_kernal: always((f, e) => f.linkTechniqueUsesKernal(e.technique, e.kernal)),
  technique_requires_region: always((f, e) => f.linkTechniqueRequiresRegion(e.technique, e.region)),
  technique_belongs_to: always((f, e) => f.linkTechniqueBelongsTo(e.technique, e.chip)),
  technique_demands: always((f, e) => f.linkTechniqueDemands(e.technique, e.resource, e.description)),
  technique_requires: (f, e) => f.linkTechniqueRequires(e.technique, e.requires),
  triggered_by: (f, e) => f.linkTriggeredBy(e.pitfall, e.target, e.targetKind),
  mitigated_by: (f, e) => f.linkMitigatedBy(e.pitfall, e.target),
  caused_by: (f, e) => f.linkCausedBy(e.symptom, e.target, e.targetKind),
  archetype_features: (f, e) => f.linkArchetypeFeatures(e.archetype, e.technique),
  archetype_risks: (f, e) => f.linkArchetypeRisks(e.archetype, e.pitfall),
  claims: (f, e) => f.linkClaims(e),
  kernal_clobbers_zp: (f, e) => f.linkKernalClobbersZp(e),
  composes: (f, e) => f.linkComposes(e.design, e.technique, e.phase),
  instance_of: (f, e) => f.linkInstanceOf(e.design, e.archetype),
  realised_by: (f, e) => f.linkRealisedBy(e.design, e.recipe),
};

/** Create one edge. Resolves false when the link reports the edge did not land. */
export function applyEdge(f: FalkorService, e: EdgeEntity): Promise<boolean> {
  // LINKERS[e.type] takes exactly the entity whose type is e.type; the
  // checker cannot correlate the key with the union member, so say so.
  const link = LINKERS[e.type] as Linker<EdgeEntity>;
  return link(f, e);
}

/**
 * Apply one entity in a single pass (single-file ingest): a node, then for
 * a Recipe the edges its properties imply; or an edge. Returns true for a
 * node, so callers can count nodes.
 */
export async function applyEntity(f: FalkorService, e: GraphEntity): Promise<boolean> {
  if (!isNodeEntity(e)) {
    await applyEdge(f, e);
    return false;
  }
  await applyNode(f, e);
  if (e.type === "recipe") for (const edge of recipeEdges(e)) await applyEdge(f, edge);
  return true;
}
