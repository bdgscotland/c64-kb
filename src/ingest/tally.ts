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
}

export type TrackedEdge =
  | "triggered_by"
  | "caused_by"
  | "technique_requires"
  | "mitigated_by"
  | "archetype_features"
  | "archetype_risks"
  | "scaffolds"
  | "claims";

/**
 * A key per distinct (source, target, kind) reference, so a doc naming the
 * same trigger twice is not reported as a dropped edge after MERGE folds
 * them. Null for an edge type that is not tracked.
 */
function referenceKey(e: EdgeEntity): [TrackedEdge, string] | null {
  switch (e.type) {
    case "triggered_by":
      return [e.type, `${e.pitfall}|${e.targetKind}|${e.target}`];
    case "caused_by":
      return [e.type, `${e.symptom}|${e.targetKind}|${e.target}`];
    case "technique_requires":
      return [e.type, `${e.technique}|${e.requires}`];
    case "mitigated_by":
      return [e.type, `${e.pitfall}|${e.target}`];
    case "archetype_features":
      return [e.type, `${e.archetype}|${e.technique}`];
    case "archetype_risks":
      return [e.type, `${e.archetype}|${e.pitfall}`];
    case "scaffolds":
      return [e.type, `${e.recipe}|${e.archetype}`];
    case "claims":
      return [e.type, `${e.owner}|${e.unit}`];
    default:
      return null;
  }
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
