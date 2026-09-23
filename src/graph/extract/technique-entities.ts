/**
 * Turn one finished technique section (its H2 plus the metadata lines read
 * under it) into the Technique entity and its edges, refusing any word
 * outside the vocabularies with a warning.
 */

import { CLAIMS_BASIS_WORDS, isClaimsBasis, type Claim, type ClaimsBasis } from "../claims.ts";
import { warn } from "./common.ts";
import type { GraphEntity } from "./types.ts";
import {
  COST_BASIS_WORDS,
  DEMAND_VOCABULARY,
  isCostBasis,
  vocabularyEntry,
  type CostBasis,
  type TechniqueCost,
} from "./vocabulary.ts";

export const TECHNIQUE_NAME = /^[a-z][a-z0-9_]*$/;

export interface TechniqueHead {
  name: string;
  title: string;
  category: string;
  complexity?: string;
  chip?: string;
}

export interface TechniqueMeta {
  region?: string;
  usesReg?: string[];
  usesKernal?: string[];
  demands?: string[];
  requires?: string[];
  cost?: TechniqueCost;
  costBasis?: string;
  costMeasuredOn?: string;
  costIncludes?: string[];
  rasterBand?: string;
  claims?: Claim[];
  claimsRefused?: boolean;
  claimsBasis?: string;
}

interface Section {
  head: TechniqueHead;
  meta: TechniqueMeta;
  sourcePath: string;
}

// `<toolchain>-<recipe>` with an optional trailing `(conditions)`.
const MEASURED_ON = /^`?([a-z0-9]+-[a-z0-9][a-z0-9-]*)`?(?:\s+\(([^()]+)\))?\s*$/;

interface SettledCost {
  cost: TechniqueCost;
  cost_basis: CostBasis;
  cost_recipe?: string;
  cost_conditions?: string;
  cost_includes?: string[];
}

/** A typical figure is only meaningful beside the worst one, and never above it. */
function checkedTypical(cost: TechniqueCost, where: string): TechniqueCost {
  const typical = cost.cycles_per_frame_typical;
  if (typical === undefined) return cost;
  const worst = cost.cycles_per_frame;
  if (worst !== undefined && typical <= worst) return cost;
  warn(
    worst === undefined
      ? `${where} has cycles_per_frame_typical without cycles_per_frame — typical figure skipped (see CONVENTIONS-techniques.md)`
      : `${where} has cycles_per_frame_typical=${typical} above cycles_per_frame=${worst} — typical figure skipped`,
  );
  const rest = { ...cost };
  delete rest.cycles_per_frame_typical;
  return rest;
}

/** The recipe and conditions of a **Cost measured on:** line, or {} (with a warning) when refused. */
function measuredOn(
  value: string | undefined,
  where: string,
): Pick<SettledCost, "cost_recipe" | "cost_conditions"> {
  if (value === undefined) return {};
  const m = MEASURED_ON.exec(value);
  const recipe = m?.at(1);
  if (!recipe) {
    warn(
      `${where} has **Cost measured on:** ${JSON.stringify(value)}, which is not a recipe name (toolchain-recipe) with optional (conditions) — not ingested (see CONVENTIONS-techniques.md)`,
    );
    return {};
  }
  const conditions = m?.at(2)?.trim();
  return { cost_recipe: recipe, ...(conditions ? { cost_conditions: conditions } : {}) };
}

/** Technique names from a **Cost includes:** line; a malformed name or the technique itself is refused. */
function includedTechniques(names: string[] | undefined, head: TechniqueHead, where: string): string[] {
  const out: string[] = [];
  for (const n of names ?? []) {
    if (!TECHNIQUE_NAME.test(n)) {
      warn(`${where} has **Cost includes:** "${n}", which is not a snake_case technique name — not ingested`);
    } else if (n === head.name) {
      warn(`${where} lists itself under **Cost includes:** — not ingested`);
    } else if (!out.includes(n)) out.push(n);
  }
  return out;
}

/**
 * Cost rides the technique entity itself, not an edge, so it is settled
 * before the push. A Cost line without an honest basis is dropped whole,
 * and its measured-on and includes lines with it.
 */
function settledCost({ head, meta, sourcePath }: Section): SettledCost | null {
  const where = `${sourcePath}: technique ${head.name}`;
  if (meta.cost === undefined) {
    if (meta.costBasis !== undefined)
      warn(`${where} has a **Cost basis:** line but no **Cost:** line — ignored`);
    if (meta.costMeasuredOn !== undefined || meta.costIncludes !== undefined)
      warn(`${where} has a **Cost measured on:** or **Cost includes:** line but no **Cost:** line — ignored`);
    return null;
  }
  const basis = meta.costBasis;
  if (basis === undefined) {
    warn(
      `${where} has a **Cost:** line but no **Cost basis:** line — Cost not ingested (see CONVENTIONS-techniques.md)`,
    );
    return null;
  }
  if (!isCostBasis(basis)) {
    warn(
      `${where} has cost basis "${basis}", which is not one of ${COST_BASIS_WORDS.join(", ")} — Cost not ingested (see CONVENTIONS-techniques.md)`,
    );
    return null;
  }
  const cost = checkedTypical(meta.cost, where);
  if (Object.keys(cost).length === 0) {
    warn(`${where} has a **Cost:** line with no usable pair — Cost not ingested`);
    return null;
  }
  const includes = includedTechniques(meta.costIncludes, head, where);
  return {
    cost,
    cost_basis: basis,
    ...measuredOn(meta.costMeasuredOn, where),
    ...(includes.length > 0 ? { cost_includes: includes } : {}),
  };
}

/**
 * Claims ride edges, but whether the page states them rides the node:
 * "stated", "none", or absent (unknown). A line refused for its grammar, or
 * with no usable basis, leaves the technique unknown.
 */
function settledClaims({ head, meta, sourcePath }: Section): { claims: Claim[]; basis: ClaimsBasis } | null {
  const where = `${sourcePath}: technique ${head.name}`;
  if (meta.claims === undefined) {
    if (meta.claimsBasis !== undefined && !meta.claimsRefused)
      warn(`${where} has a **Claims basis:** line but no **Claims:** line — ignored`);
    return null;
  }
  const basis = meta.claimsBasis;
  if (basis === undefined) {
    warn(
      `${where} has a **Claims:** line but no **Claims basis:** line — Claims not ingested, so its claims read as unknown (see CONVENTIONS-techniques.md)`,
    );
    return null;
  }
  if (!isClaimsBasis(basis)) {
    warn(
      `${where} has claims basis "${basis}", which is not one of ${CLAIMS_BASIS_WORDS.join(", ")} — Claims not ingested (see CONVENTIONS-techniques.md)`,
    );
    return null;
  }
  return { claims: meta.claims, basis };
}

function demandEntities({ head, meta, sourcePath }: Section): GraphEntity[] {
  const out: GraphEntity[] = [];
  for (const d of meta.demands ?? []) {
    const description = vocabularyEntry(DEMAND_VOCABULARY, d);
    if (description === undefined) {
      warn(
        `${sourcePath}: technique ${head.name} demands unknown resource "${d}" — not ingested (see CONVENTIONS-techniques.md)`,
      );
      continue;
    }
    out.push({ type: "technique_demands", technique: head.name, resource: d, description });
  }
  return out;
}

function requiresEntities({ head, meta, sourcePath }: Section): GraphEntity[] {
  const out: GraphEntity[] = [];
  const seen = new Set<string>();
  for (const r of meta.requires ?? []) {
    if (!TECHNIQUE_NAME.test(r)) {
      warn(
        `${sourcePath}: technique ${head.name} requires "${r}", which is not a snake_case technique name — not ingested (see CONVENTIONS-techniques.md)`,
      );
      continue;
    }
    if (r === head.name) {
      warn(`${sourcePath}: technique ${head.name} lists itself under **Requires:** — not ingested`);
      continue;
    }
    if (seen.has(r)) continue;
    seen.add(r);
    out.push({ type: "technique_requires", technique: head.name, requires: r });
  }
  return out;
}

export function techniqueEntities(
  head: TechniqueHead,
  meta: TechniqueMeta,
  sourcePath: string,
): GraphEntity[] {
  const section: Section = { head, meta, sourcePath };
  const technique = head.name;
  const cost = settledCost(section);
  const claims = settledClaims(section);
  const out: GraphEntity[] = [
    {
      type: "technique",
      ...head,
      ...(cost ?? {}),
      ...(meta.rasterBand !== undefined ? { raster_band: meta.rasterBand } : {}),
      ...(claims
        ? {
            claims_stated: claims.claims.length > 0 ? ("stated" as const) : ("none" as const),
            claims_basis: claims.basis,
          }
        : {}),
    },
  ];
  if (claims) {
    for (const c of claims.claims)
      out.push({ type: "claims", owner: technique, ownerKind: "Technique", ...c, basis: claims.basis });
  }
  if (head.chip) out.push({ type: "technique_belongs_to", technique, chip: head.chip });
  out.push(...demandEntities(section), ...requiresEntities(section));
  if (meta.region && meta.region !== "both") {
    out.push({ type: "technique_requires_region", technique, region: meta.region });
  }
  for (const register of meta.usesReg ?? [])
    out.push({ type: "technique_uses_register", technique, register });
  for (const kernal of meta.usesKernal ?? []) out.push({ type: "technique_uses_kernal", technique, kernal });
  return out;
}
