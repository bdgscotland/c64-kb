/**
 * FalkorDB client for the C64 knowledge graph.
 *
 * The class is layered so no file carries all of it: falkor/base.ts holds the
 * connection and the read/write helpers, falkor/nodes.ts the node upserts,
 * falkor/links.ts the edge writes, falkor/schema.ts the label table. This
 * file adds schema setup, cleaning and stats, and stays the import path.
 */

import { HARDWARE_UNITS } from "../graph/claims.ts";
import { MACHINE_VARIANTS } from "../graph/machine-variants.ts";
import { firstCount } from "./falkor/params.ts";
import { FalkorLinks } from "./falkor/links.ts";
import { CHIPS, CLEANABLE_LABELS, REGIONS, createIndexes } from "./falkor/schema.ts";

export class FalkorService extends FalkorLinks {
  /** Indexes, constraints and the seed nodes (Chip, Region, HardwareUnit, MachineVariant). Safe to re-run. */
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
    await this.seedHardwareUnits();
    for (const v of MACHINE_VARIANTS) {
      const { name, ...props } = v;
      await this.upsertNode({
        label: "MachineVariant",
        name,
        props: { ...props, vice_flag: `-model ${name}` },
      });
    }
  }

  /**
   * HardwareUnit seeds (schema 25): the pieces of hardware a CLAIMS edge
   * names. Seeded, like Chip and Region, so a Claims line can only point at
   * a unit that exists; BELONGS_TO its chip where it has one.
   */
  private async seedHardwareUnits(): Promise<void> {
    for (const u of HARDWARE_UNITS) {
      await this.upsertNode({
        label: "HardwareUnit",
        name: u.name,
        props: { kind: u.kind, addresses: u.addresses, chip: u.chip ?? "" },
      });
      if (u.chip) {
        await this.write(
          `MATCH (h:HardwareUnit {name: $name}) MATCH (c:Chip {name: $chip}) MERGE (h)-[:BELONGS_TO]->(c)`,
          { name: u.name, chip: u.chip },
        );
      }
    }
  }

  /**
   * Per-label DETACH DELETE for all C64 entity nodes. Preserves the
   * graph itself + indexes + constraints + Chip/Region/HardwareUnit/MachineVariant seeds (which
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
   * The rebuild marker (src/services/rebuild-marker.ts): one IngestRun node
   * a batch ingest writes before its clean and deletes after its report.
   * Not a cleanable label, so clean() leaves it.
   */
  async markRebuildStarted(flags: string): Promise<void> {
    await this.write(
      `MERGE (m:IngestRun {name: 'rebuild'}) SET m.started_at = $started_at, m.flags = $flags`,
      { started_at: new Date().toISOString(), flags },
    );
  }

  async markRebuildFinished(): Promise<void> {
    await this.write(`MATCH (m:IngestRun {name: 'rebuild'}) DELETE m`);
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
