/**
 * Turn one finished technique section (its H2 plus the metadata lines read
 * under it) into the Technique entity and its edges, refusing any word
 * outside the vocabularies with a warning.
 */

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
  rasterBand?: string;
}

interface Section {
  head: TechniqueHead;
  meta: TechniqueMeta;
  sourcePath: string;
}

/**
 * Cost rides the technique entity itself, not an edge, so it is settled
 * before the push. A Cost line without an honest basis is dropped whole.
 */
function settledCost({ head, meta, sourcePath }: Section): { cost: TechniqueCost; cost_basis: CostBasis } | null {
  const where = `${sourcePath}: technique ${head.name}`;
  if (meta.cost === undefined) {
    if (meta.costBasis !== undefined) warn(`${where} has a **Cost basis:** line but no **Cost:** line — ignored`);
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
  if (Object.keys(meta.cost).length === 0) {
    warn(`${where} has a **Cost:** line with no usable pair — Cost not ingested`);
    return null;
  }
  return { cost: meta.cost, cost_basis: basis };
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

export function techniqueEntities(head: TechniqueHead, meta: TechniqueMeta, sourcePath: string): GraphEntity[] {
  const section: Section = { head, meta, sourcePath };
  const technique = head.name;
  const cost = settledCost(section);
  const out: GraphEntity[] = [
    {
      type: "technique",
      ...head,
      ...(cost ?? {}),
      ...(meta.rasterBand !== undefined ? { raster_band: meta.rasterBand } : {}),
    },
  ];
  if (head.chip) out.push({ type: "technique_belongs_to", technique, chip: head.chip });
  out.push(...demandEntities(section), ...requiresEntities(section));
  if (meta.region && meta.region !== "both") {
    out.push({ type: "technique_requires_region", technique, region: meta.region });
  }
  for (const register of meta.usesReg ?? []) out.push({ type: "technique_uses_register", technique, register });
  for (const kernal of meta.usesKernal ?? []) out.push({ type: "technique_uses_kernal", technique, kernal });
  return out;
}
