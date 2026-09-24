/**
 * Fetches what the compatibility rules need from the graph, a fixed number
 * of queries per check (one per REQUIRES level, then one each for facts,
 * shared registers, shared KERNAL routines and recipe infrastructure)
 * instead of several per technique and per pair.
 */

import { z } from "zod";
import { getFalkor } from "../../../context.ts";
import type { FalkorService } from "../../../services/falkor.ts";
import { CLAIM_MODES, type Claim } from "../../../graph/claims.ts";
import { parseRows } from "../shared.ts";
import { inputPairs, pairKey, type CompatibilityFacts, type TechniqueFacts } from "./facts.ts";

const EdgeRow = z.object({ name: z.string(), target: z.string().nullable() });

/**
 * Direct REQUIRES edges for every technique reachable from the inputs,
 * one query per level of the walk. Targets are sorted per technique.
 */
async function fetchRequires(f: FalkorService, inputs: readonly string[]): Promise<Map<string, string[]>> {
  const requires = new Map<string, string[]>();
  let frontier = [...new Set(inputs)];
  while (frontier.length > 0) {
    for (const n of frontier) requires.set(n, []);
    const rows = parseRows(
      EdgeRow,
      await f.roQuery(
        `UNWIND $names AS name
         MATCH (t:Technique {name: name})-[:REQUIRES]->(p:Technique)
         RETURN name, p.name AS target ORDER BY name, target`,
        { names: frontier },
      ),
    );
    for (const { name, target } of rows) {
      if (target) requires.get(name)?.push(target);
    }
    frontier = [...new Set(rows.map((r) => r.target))].filter(
      (t): t is string => t !== null && !requires.has(t),
    );
  }
  return requires;
}

const FactsRow = z.object({
  name: z.string(),
  demands: z.array(z.string().nullable()),
  registers: z.coerce.number(),
  kernal: z.array(z.string().nullable()),
  band: z.string().nullable(),
  regions: z.array(z.string().nullable()),
  category: z.string().nullable(),
  raster_registers: z.coerce.number(),
  claims_stated: z.string().nullable(),
});

const present = (xs: readonly (string | null)[]): string[] => xs.filter((x): x is string => Boolean(x));

async function fetchFacts(f: FalkorService, names: readonly string[]): Promise<Map<string, TechniqueFacts>> {
  const rows = parseRows(
    FactsRow,
    await f.roQuery(
      `UNWIND $names AS name
       MATCH (t:Technique {name: name})
       OPTIONAL MATCH (t)-[:DEMANDS]->(res:Resource)
       WITH name, t, collect(DISTINCT res.name) AS demands
       OPTIONAL MATCH (t)-[:USES]->(reg:Register)
       WITH name, t, demands, count(DISTINCT reg) AS registers
       OPTIONAL MATCH (t)-[:USES]->(k:KernalRoutine)
       WITH name, t, demands, registers, collect(DISTINCT k.name) AS kernal
       OPTIONAL MATCH (t)-[:REQUIRES_REGION]->(rg:Region)
       WITH name, t, demands, registers, kernal, collect(toLower(rg.name)) AS regions
       OPTIONAL MATCH (t)-[:USES]->(rr:Register)
       WHERE rr.name IN ['D011', 'D012', 'SCROLY', 'RASTER']
       RETURN name, demands, registers, kernal, t.raster_band AS band, regions,
              t.category AS category, count(rr) AS raster_registers, t.claims_stated AS claims_stated`,
      { names: [...new Set(names)] },
    ),
  );
  return new Map(
    rows.map((r) => [
      r.name,
      {
        found: true,
        demands: new Set(present(r.demands)),
        registers: r.registers,
        kernal: present(r.kernal),
        band: r.band,
        region: present(r.regions)[0] ?? null,
        category: r.category,
        rasterRegisters: r.raster_registers,
        claims: [],
        claimsStated:
          r.claims_stated === "stated" || r.claims_stated === "none" ? r.claims_stated : "unknown",
      },
    ]),
  );
}

const ClaimRow = z.object({
  name: z.string(),
  unit: z.string(),
  mode: z.enum(CLAIM_MODES),
  ranges: z.string().nullable(),
  relocatable: z.boolean().nullable(),
});

/** CLAIMS edges (schema 25) for every technique in the check, onto the facts already fetched. */
async function fetchClaims(f: FalkorService, facts: Map<string, TechniqueFacts>): Promise<void> {
  const rows = parseRows(
    ClaimRow,
    await f.roQuery(
      `UNWIND $names AS name
       MATCH (t:Technique {name: name})-[c:CLAIMS]->(h:HardwareUnit)
       RETURN name, h.name AS unit, c.mode AS mode, c.ranges AS ranges, c.relocatable AS relocatable
       ORDER BY name, unit`,
      { names: [...facts.keys()] },
    ),
  );
  const byName = new Map<string, Claim[]>();
  for (const r of rows) {
    const claim: Claim = {
      unit: r.unit,
      mode: r.mode,
      ...(r.ranges ? { ranges: r.ranges } : {}),
      ...(r.relocatable ? { relocatable: true } : {}),
    };
    byName.set(r.name, [...(byName.get(r.name) ?? []), claim]);
  }
  for (const [name, claims] of byName) {
    const F = facts.get(name);
    if (F) facts.set(name, { ...F, claims });
  }
}

const SharedRow = z.object({ pair: z.string(), shared: z.string().nullable() });

/** Nodes of `label` that both techniques of each input pair USE, keyed by pairKey. */
async function fetchShared(
  f: FalkorService,
  techniques: readonly string[],
  label: "Register" | "KernalRoutine",
): Promise<Map<string, string[]>> {
  const pairs = inputPairs(techniques).map(({ i, j, a, b }) => ({ key: pairKey(i, j), a, b }));
  const shared = new Map<string, string[]>();
  if (pairs.length === 0) return shared;
  const rows = parseRows(
    SharedRow,
    await f.roQuery(
      `UNWIND $pairs AS pair
       MATCH (a:Technique {name: pair.a})-[:USES]->(n:${label})<-[:USES]-(b:Technique {name: pair.b})
       RETURN pair.key AS pair, n.name AS shared`,
      { pairs },
    ),
  );
  for (const { pair, shared: name } of rows) {
    if (!name) continue;
    shared.set(pair, [...(shared.get(pair) ?? []), name]);
  }
  return shared;
}

const RecipeUseRow = z.object({
  name: z.string().nullable(),
  kind: z.string().nullable(),
  recipe: z.string(),
});

/** Register and KERNAL nodes USEd by recipes that implement two or more of the inputs. */
async function fetchRecipeUses(f: FalkorService, techniques: readonly string[]) {
  if (techniques.length < 2) return [];
  const rows = parseRows(
    RecipeUseRow,
    await f.roQuery(
      `MATCH (r:Recipe)-[:IMPLEMENTS]->(t:Technique)
       WHERE t.name IN $techs
       WITH r, collect(DISTINCT t.name) AS implements
       WHERE size(implements) >= 2
       MATCH (r)-[:USES]->(shared)
       RETURN DISTINCT shared.name AS name, labels(shared)[0] AS kind, r.name AS recipe`,
      { techs: techniques },
    ),
  );
  return rows.flatMap((r) => (r.name && r.kind ? [{ name: r.name, kind: r.kind, recipe: r.recipe }] : []));
}

const RecipeZpRow = z.object({ recipe: z.string(), implements: z.array(z.string()), ranges: z.string() });

/** Owned zero page of every recipe that IMPLEMENTS an input, from its claims: key (schema 34). */
async function fetchRecipeZeroPage(f: FalkorService, techniques: readonly string[]) {
  if (techniques.length < 2) return [];
  return parseRows(
    RecipeZpRow,
    await f.roQuery(
      `MATCH (r:Recipe)-[:IMPLEMENTS]->(t:Technique)
       WHERE t.name IN $techs
       WITH r, collect(DISTINCT t.name) AS implements
       MATCH (r)-[c:CLAIMS {mode: 'owns'}]->(:HardwareUnit {name: 'zero_page'})
       WHERE c.ranges IS NOT NULL
       RETURN r.name AS recipe, implements, c.ranges AS ranges ORDER BY recipe`,
      { techs: techniques },
    ),
  );
}

const ClobberRow = z.object({ routine: z.string(), ranges: z.string().nullable() });

/** The may set of every KERNAL routine the checked techniques USE (schema 26). */
async function fetchKernalClobbers(
  f: FalkorService,
  facts: ReadonlyMap<string, TechniqueFacts>,
): Promise<Map<string, string>> {
  const routines = [...new Set([...facts.values()].flatMap((F) => F.kernal))];
  if (routines.length === 0) return new Map();
  const rows = parseRows(
    ClobberRow,
    await f.roQuery(
      `MATCH (k:KernalRoutine)-[e:CLOBBERS_ZP {bound: 'may'}]->(:HardwareUnit {name: 'zero_page'})
       WHERE k.name IN $routines
       RETURN k.name AS routine, e.ranges AS ranges`,
      { routines },
    ),
  );
  return new Map(rows.map((r) => [r.routine, r.ranges ?? ""]));
}

export async function fetchCompatibilityFacts(techniques: readonly string[]): Promise<CompatibilityFacts> {
  const f = await getFalkor();
  const requires = await fetchRequires(f, techniques);
  const [facts, sharedRegisters, sharedKernal, recipeUses, recipeZeroPage] = await Promise.all([
    fetchFacts(f, [...requires.keys()]),
    fetchShared(f, techniques, "Register"),
    fetchShared(f, techniques, "KernalRoutine"),
    fetchRecipeUses(f, techniques),
    fetchRecipeZeroPage(f, techniques),
  ]);
  await fetchClaims(f, facts);
  const kernalClobbers = await fetchKernalClobbers(f, facts);
  return {
    techniques,
    requires,
    facts,
    sharedRegisters,
    sharedKernal,
    recipeUses,
    kernalClobbers,
    recipeZeroPage,
  };
}
