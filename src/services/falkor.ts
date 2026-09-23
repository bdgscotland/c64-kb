/**
 * FalkorDB client for the C64 knowledge graph.
 *
 * The class is layered so no file carries all of it: falkor/base.ts holds the
 * connection and the read/write helpers, falkor/nodes.ts the node upserts,
 * falkor/links.ts the edge writes, falkor/schema.ts the label table. This
 * file adds schema setup, cleaning and stats, and stays the import path.
 */

import { firstCount } from "./falkor/params.ts";
import { FalkorLinks } from "./falkor/links.ts";
import { CHIPS, CLEANABLE_LABELS, REGIONS, createIndexes } from "./falkor/schema.ts";

export type { CauseKind, ChipMemberLabel } from "./falkor/links.ts";
export type { RegisterNode, MemoryRegionNode, TechniqueNode } from "./falkor/nodes.ts";
export type { NodeLabel } from "./falkor/schema.ts";

export class FalkorService extends FalkorLinks {
  /** Indexes, constraints and the Chip and Region seed nodes. Safe to re-run. */
  async ensureSchema(): Promise<void> {
    await createIndexes(this.graph());
    for (const chip of CHIPS) {
      await this.upsertNode({
        label: "Chip",
        name: chip.name,
        props: { variants: chip.variants, role: chip.role },
      });
    }
    for (const region of REGIONS) {
      const { name, ...props } = region;
      await this.upsertNode({ label: "Region", name, props });
    }
  }

  /**
   * Per-label DETACH DELETE for all C64 entity nodes. Preserves the
   * graph itself + indexes + constraints + Chip/Region seeds (which
   * are re-MERGED by ensureSchema on next connect).
   */
  async clean(): Promise<void> {
    for (const label of CLEANABLE_LABELS) {
      await this.write(`MATCH (n:${label}) DETACH DELETE n`);
    }
  }

  /**
   * Drop the entire graph (GRAPH.DELETE). Removes all nodes, edges,
   * indexes, and constraints. Use in tests that need to verify schema
   * from a pristine state; NOT safe to call during normal ingest.
   */
  async dropGraph(): Promise<void> {
    try {
      await this.graph().delete();
    } catch (err) {
      // A graph that was never created: "Invalid graph operation on empty key".
      if (!(err instanceof Error && err.message.includes("empty key"))) throw err;
    }
  }

  /**
   * Node and edge totals. A failed query throws: this used to return zeros,
   * and health then reported an unreachable graph as a healthy empty one.
   */
  async getStats(): Promise<{ nodes: number; edges: number }> {
    const nodes = await this.roQuery("MATCH (n) RETURN count(n) AS cnt");
    const edges = await this.roQuery("MATCH ()-[r]->() RETURN count(r) AS cnt");
    return { nodes: firstCount(nodes.data, "cnt"), edges: firstCount(edges.data, "cnt") };
  }

  /**
   * Phase 7 coverage tooling will implement per-label orphan queries
   * (Register without BELONGS_TO any Chip, Technique without USES any
   * Register, and so on). Until then the gap is explicit rather than a
   * silent [].
   */
  findOrphans(label: string): Promise<string[]> {
    return Promise.reject(
      new Error(
        `findOrphans(${label}) is not implemented until Phase 7 coverage tooling. Planned for Phase 7.`,
      ),
    );
  }
}
