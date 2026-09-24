/**
 * GameDesign reads (schema 28): one design with its phases, archetypes,
 * recipes and measured frames, the designs of an archetype, and every
 * design name for a not-found reply.
 */

import { z } from "zod";
import { getFalkor } from "../../context.ts";
import { BUDGET_PHASES, type BudgetPhase } from "../../domain/budget.ts";
import type { CallCount } from "../../domain/calls.ts";
import type { DesignMeasurement } from "../../domain/game-design.ts";
import { CostBasisSchema } from "../../schemas/cost-basis.ts";
import { parseRows } from "./shared.ts";

export interface GameDesignRecord {
  name: string;
  title: string;
  region: "PAL" | "NTSC" | "both" | null;
  instance_of: string[];
  realised_by: string[];
  composes: { technique: string; phase: BudgetPhase; calls?: CallCount }[];
  measured: DesignMeasurement[];
  source_doc: string;
}

const StringList = z
  .unknown()
  .transform((v) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : [],
  );

const MeasuredSchema = z.array(
  z.object({
    phase: z.enum(BUDGET_PHASES),
    region: z.enum(["PAL", "NTSC"]),
    worst: z.number().int(),
    typical: z.number().int().optional(),
    basis: CostBasisSchema,
    source: z.string(),
  }),
);

const DesignRow = z.object({
  name: z.string(),
  title: z.string().nullable(),
  region: z.enum(["PAL", "NTSC", "both"]).nullable(),
  measured: z.string().nullable(),
  source_doc: z.string().nullable(),
  archetypes: StringList,
  recipes: StringList,
  composes: z.array(
    z.object({
      technique: z.string().nullable(),
      phase: z.string().nullable(),
      calls_low: z.number().int().nullable().optional(),
      calls_high: z.number().int().nullable().optional(),
    }),
  ),
});

const DESIGN_QUERY = `MATCH (g:GameDesign) WHERE g.name IN $names
  OPTIONAL MATCH (g)-[:INSTANCE_OF]->(a:Archetype)
  WITH g, collect(DISTINCT a.name) AS archetypes
  OPTIONAL MATCH (g)-[:REALISED_BY]->(r:Recipe)
  WITH g, archetypes, collect(DISTINCT r.name) AS recipes
  OPTIONAL MATCH (g)-[c:COMPOSES]->(t:Technique)
  RETURN g.name AS name, g.title AS title, g.region AS region, g.measured AS measured,
         g.source_doc AS source_doc, archetypes, recipes,
         collect({technique: t.name, phase: c.phase, calls_low: c.calls_low, calls_high: c.calls_high}) AS composes`;

function isPhase(p: string | null): p is BudgetPhase {
  return BUDGET_PHASES.some((x) => x === p);
}

function recordOf(row: z.infer<typeof DesignRow>): GameDesignRecord {
  const composes = row.composes.flatMap((c) => {
    if (!c.technique || !isPhase(c.phase)) return [];
    const calls =
      typeof c.calls_high === "number" ? { low: c.calls_low ?? c.calls_high, high: c.calls_high } : undefined;
    return [{ technique: c.technique, phase: c.phase, ...(calls ? { calls } : {}) }];
  });
  // Phase order, then technique name, so the expansion does not depend on edge order.
  composes.sort(
    (a, b) =>
      BUDGET_PHASES.indexOf(a.phase) - BUDGET_PHASES.indexOf(b.phase) ||
      a.technique.localeCompare(b.technique),
  );
  const measured = row.measured ? MeasuredSchema.parse(JSON.parse(row.measured)) : [];
  return {
    name: row.name,
    title: row.title ?? row.name,
    region: row.region,
    instance_of: [...row.archetypes].sort(),
    realised_by: [...row.recipes].sort(),
    composes,
    measured,
    source_doc: row.source_doc ?? "",
  };
}

async function designsNamed(names: string[]): Promise<GameDesignRecord[]> {
  if (names.length === 0) return [];
  const f = await getFalkor();
  return parseRows(DesignRow, await f.roQuery(DESIGN_QUERY, { names })).map(recordOf);
}

/** One design by exact name, or null. */
export async function fetchGameDesign(name: string): Promise<GameDesignRecord | null> {
  return (await designsNamed([name.trim()])).at(0) ?? null;
}

/** Every GameDesign name, sorted: the known list of a not-found reply. */
export async function knownGameDesigns(): Promise<string[]> {
  const f = await getFalkor();
  const rows = parseRows(
    z.object({ name: z.string() }),
    await f.roQuery(`MATCH (g:GameDesign) RETURN g.name AS name ORDER BY name`),
  );
  return rows.map((r) => r.name);
}

/** The designs INSTANCE_OF an archetype, by name. */
export async function designsOfArchetype(archetype: string): Promise<GameDesignRecord[]> {
  const f = await getFalkor();
  const rows = parseRows(
    z.object({ name: z.string() }),
    await f.roQuery(
      `MATCH (g:GameDesign)-[:INSTANCE_OF]->(:Archetype {name: $archetype}) RETURN g.name AS name ORDER BY name`,
      { archetype },
    ),
  );
  return designsNamed(rows.map((r) => r.name));
}
