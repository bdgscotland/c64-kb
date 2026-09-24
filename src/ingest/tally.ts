/**
 * Counters batch ingest reports at the end: nodes by kind in pass 1, and
 * for the edge types whose target may name no node, the distinct
 * references requested and how many were dropped in pass 2.
 */

import type { EdgeEntity } from "../graph/apply.ts";

export interface NodeTally {
  chunks: number;
  skipped: number;
  pitfalls: number;
  crashPatterns: number;
  archetypes: number;
  gameDesigns: number;
}

export type TrackedEdge =
  | "triggered_by"
  | "caused_by"
  | "technique_requires"
  | "technique_alternative"
  | "mitigated_by"
  | "archetype_features"
  | "archetype_risks"
  | "scaffolds"
  | "claims"
  | "kernal_clobbers_zp"
  | "composes"
  | "instance_of"
  | "realised_by"
  | "exemplified_by"
  | "requires_device";

type EdgeOf<K extends TrackedEdge> = Extract<EdgeEntity, { type: K }>;

// One key function per tracked edge type: a type missing here is a tsc
// error. The table replaced a switch that had outgrown the complexity budget.
const REFERENCE_KEYS: { [K in TrackedEdge]: (e: EdgeOf<K>) => string } = {
  triggered_by: (e) => `${e.pitfall}|${e.targetKind}|${e.target}`,
  caused_by: (e) => `${e.symptom}|${e.targetKind}|${e.target}`,
  technique_requires: (e) => `${e.technique}|${e.requires}`,
  technique_alternative: (e) => `${e.technique}|${e.alternative}`,
  mitigated_by: (e) => `${e.pitfall}|${e.target}`,
  archetype_features: (e) => `${e.archetype}|${e.technique}`,
  archetype_risks: (e) => `${e.archetype}|${e.pitfall}`,
  scaffolds: (e) => `${e.recipe}|${e.archetype}`,
  claims: (e) => `${e.owner}|${e.unit}`,
  kernal_clobbers_zp: (e) => `${e.routine}|${e.bound}|${e.basis}`,
  composes: (e) => `${e.design}|${e.technique}|${e.phase}`,
  instance_of: (e) => `${e.design}|${e.archetype}`,
  realised_by: (e) => `${e.design}|${e.recipe}`,
  exemplified_by: (e) => `${e.archetype}|${e.production}`,
  requires_device: (e) => `${e.recipe}|${e.device}`,
};

function isTracked(type: string): type is TrackedEdge {
  return Object.hasOwn(REFERENCE_KEYS, type);
}

/**
 * A key per distinct (source, target, kind) reference, so a doc naming the
 * same trigger twice is not reported as a dropped edge after MERGE folds
 * them. Null for an edge type that is not tracked.
 */
function referenceKey(e: EdgeEntity): [TrackedEdge, string] | null {
  if (!isTracked(e.type)) return null;
  // REFERENCE_KEYS[e.type] takes exactly the entity whose type is e.type;
  // the checker cannot correlate the key with the union member.
  const key = REFERENCE_KEYS[e.type] as (e: EdgeEntity) => string;
  return [e.type, key(e)];
}

export class EdgeTally {
  private readonly requested = new Map<TrackedEdge, Set<string>>();
  private readonly droppedBy = new Map<TrackedEdge, number>();
  /** PAIRS_WITH links whose KERNAL target does not exist. */
  pairsWithSkipped = 0;

  /** Record one applied edge and whether it landed. */
  record(e: EdgeEntity, landed: boolean): void {
    if (e.type === "pairs_with") {
      if (!landed) this.pairsWithSkipped++;
      return;
    }
    const ref = referenceKey(e);
    if (ref === null) return;
    const [kind, key] = ref;
    // A drop is a reference whose target name matched no node. Requests can
    // exceed edges legitimately (two spellings of one register), so this is
    // the real signal. For REQUIRES a drop is a missing technique OR a
    // refused cycle; the [falkor] line above it says which.
    if (!landed) this.droppedBy.set(kind, this.dropped(kind) + 1);
    const keys = this.requested.get(kind) ?? new Set<string>();
    keys.add(key);
    this.requested.set(kind, keys);
  }

  /** Distinct references requested for an edge type. */
  distinct(kind: TrackedEdge): number {
    return this.requested.get(kind)?.size ?? 0;
  }

  dropped(kind: TrackedEdge): number {
    return this.droppedBy.get(kind) ?? 0;
  }

  totalDropped(): number {
    let n = 0;
    for (const v of this.droppedBy.values()) n += v;
    return n;
  }
}
