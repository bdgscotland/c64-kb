/**
 * FalkorDB client for the C64 knowledge graph.
 *
 * The schema seed creates range indexes + unique constraints for all 11
 * node types in the C64 ontology plus hardcoded `Chip` and `Region`
 * seed nodes. Mutation methods exist for every node type that has
 * landed through Phase 3: KernalRoutine, Register, MemoryRegion, Tool,
 * FileFormat, Recipe, Technique. Pitfall + CrashPattern mutations land
 * in Phase 5.
 */

import { FalkorDB, ConstraintType, EntityType } from "falkordb";
import { config } from "../config.js";

const GRAPH_NAME = config.falkor.graphName;

// Node labels we want range-indexed on their primary key property.
// Keep this list aligned with docs/ONTOLOGY.md §4.1.
const NODE_INDEXES: ReadonlyArray<readonly [string, string]> = [
  ["KernalRoutine", "name"],
  ["Register", "name"],
  ["MemoryRegion", "name"],
  ["Chip", "name"],
  ["Region", "name"],
  ["Technique", "name"],
  ["Pitfall", "name"],
  ["CrashPattern", "symptom"],
  ["Tool", "name"],
  ["Recipe", "name"],
  ["FileFormat", "name"],
  ["Resource", "name"],
];

// "$D011" -> 0xD011; null when the string is not a 16-bit hex address.
function hexAddr(s: string | undefined): number | null {
  if (!s) return null;
  const m = s.trim().match(/^\$?([0-9A-Fa-f]{1,4})$/);
  return m ? parseInt(m[1], 16) : null;
}

// Unique constraints on the primary key for every node label. Constraint
// violations fail at write time instead of silently merging duplicates.
// Per docs/ONTOLOGY.md §4.1.
const UNIQUE_CONSTRAINTS: ReadonlyArray<readonly [string, string]> = [
  ["KernalRoutine", "name"],
  ["Register", "name"],
  ["MemoryRegion", "name"],
  ["Chip", "name"],
  ["Region", "name"],
  ["Technique", "name"],
  ["Pitfall", "name"],
  ["CrashPattern", "symptom"],
  ["Tool", "name"],
  ["Recipe", "name"],
  ["FileFormat", "name"],
];

// Full-text indexes for "find a thing that does X" queries (Phase 2+).
const FULLTEXT_INDEXES: ReadonlyArray<readonly [string, string]> = [
  ["KernalRoutine", "description"],
  // Phase 2+: ["Technique", "description"], ["Pitfall", "description"], ["Recipe", "description"]
];

// Node labels that hold ingested-doc entities. clean() wipes these,
// preserving Chip/Region seeds which ensureSchema re-MERGEs.
const CLEANABLE_LABELS: readonly string[] = [
  "KernalRoutine",
  "Register",
  "MemoryRegion",
  "Technique",
  "Pitfall",
  "CrashPattern",
  "Tool",
  "Recipe",
  "FileFormat",
  "Resource",
];

const CHIPS: ReadonlyArray<{ name: string; variants: string; role: string }> = [
  { name: "VIC-II", variants: "6569 PAL / 6567 NTSC", role: "Graphics + raster" },
  { name: "SID", variants: "6581 / 8580", role: "Audio synthesis" },
  { name: "CIA1", variants: "6526", role: "Keyboard / joystick / timer-A IRQ" },
  { name: "CIA2", variants: "6526", role: "VIC bank / RS-232 / timer-B NMI" },
  { name: "6510", variants: "MOS 6510", role: "CPU (6502-compatible + I/O port at $00/$01)" },
];

const REGIONS: ReadonlyArray<{
  name: string;
  refresh_hz: number;
  lines_per_frame: number;
  cycles_per_line: number;
}> = [
  { name: "PAL", refresh_hz: 50, lines_per_frame: 312, cycles_per_line: 63 },
  { name: "NTSC", refresh_hz: 60, lines_per_frame: 263, cycles_per_line: 65 },
];

export class FalkorService {
  private db: FalkorDB | null = null;
  private graphName = GRAPH_NAME;

  async connect(host: string = config.falkor.host, port: number = config.falkor.port): Promise<void> {
    this.db = await FalkorDB.connect({ socket: { host, port } });
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }

  private graph() {
    if (!this.db) throw new Error("Not connected to FalkorDB");
    return this.db.selectGraph(this.graphName);
  }

  async ensureSchema(): Promise<void> {
    const g = this.graph();

    for (const [label, prop] of NODE_INDEXES) {
      try {
        await g.createNodeRangeIndex(label, prop);
      } catch {
        // Index may already exist
      }
    }

    // FalkorDB requires a supporting exact-match (range) index on the
    // constrained property. Most labels are already covered by NODE_INDEXES,
    // but a few constraint properties (e.g. Technique.title) sit on a
    // different attribute than the range index. Pre-create the supporting
    // index for any constraint property not yet covered.
    const indexedPairs = new Set(NODE_INDEXES.map(([l, p]) => `${l}.${p}`));
    for (const [label, prop] of UNIQUE_CONSTRAINTS) {
      if (!indexedPairs.has(`${label}.${prop}`)) {
        try {
          await g.createNodeRangeIndex(label, prop);
        } catch {
          // Index may already exist
        }
      }
    }

    for (const [label, prop] of UNIQUE_CONSTRAINTS) {
      try {
        await g.constraintCreate(ConstraintType.UNIQUE, EntityType.NODE, label, prop);
      } catch {
        // Constraint may already exist or be PENDING
      }
    }

    for (const [label, prop] of FULLTEXT_INDEXES) {
      try {
        await g.createNodeFulltextIndex(label, prop);
      } catch {
        // Index may already exist
      }
    }

    for (const chip of CHIPS) {
      await g.query(
        `MERGE (c:Chip {name: $name})
         ON CREATE SET c += $props, c.created_at = timestamp()
         ON MATCH SET c += $props, c.updated_at = timestamp()`,
        {
          params: {
            name: chip.name,
            props: { variants: chip.variants, role: chip.role },
          },
        } as Parameters<typeof g.query>[1]
      );
    }

    for (const region of REGIONS) {
      await g.query(
        `MERGE (r:Region {name: $name})
         ON CREATE SET r += $props, r.created_at = timestamp()
         ON MATCH SET r += $props, r.updated_at = timestamp()`,
        {
          params: {
            name: region.name,
            props: {
              refresh_hz: region.refresh_hz,
              lines_per_frame: region.lines_per_frame,
              cycles_per_line: region.cycles_per_line,
            },
          },
        } as Parameters<typeof g.query>[1]
      );
    }
  }

  /**
   * Per-label DETACH DELETE for all C64 entity nodes. Preserves the
   * graph itself + indexes + constraints + Chip/Region seeds (which
   * are re-MERGED by ensureSchema on next connect).
   */
  async clean(): Promise<void> {
    const g = this.graph();
    for (const label of CLEANABLE_LABELS) {
      await g.query(`MATCH (n:${label}) DETACH DELETE n`);
    }
  }

  /**
   * Drop the entire graph (GRAPH.DELETE). Removes all nodes, edges,
   * indexes, and constraints. Use in tests that need to verify schema
   * from a pristine state; NOT safe to call during normal ingest.
   */
  async dropGraph(): Promise<void> {
    const g = this.graph();
    try {
      await g.delete();
    } catch {
      // Graph may not exist yet — that's fine.
    }
  }

  async getStats(): Promise<{ nodes: number; edges: number }> {
    const g = this.graph();
    try {
      const nodesResult = await g.roQuery("MATCH (n) RETURN count(n) as cnt");
      const edgesResult = await g.roQuery("MATCH ()-[r]->() RETURN count(r) as cnt");
      const nodes = (nodesResult.data?.[0] as any)?.cnt ?? 0;
      const edges = (edgesResult.data?.[0] as any)?.cnt ?? 0;
      return { nodes, edges };
    } catch {
      return { nodes: 0, edges: 0 };
    }
  }

  async findOrphans(label: string): Promise<string[]> {
    // Phase 7 coverage tooling will implement per-label orphan
    // queries (Register without BELONGS_TO any Chip, Technique without
    // USES any Register, Recipe without IMPLEMENTS any Technique,
    // etc.). Until then the gap is explicit rather than a silent [].
    void label;
    throw new Error(
      `findOrphans is not implemented until Phase 7 coverage tooling. ` +
        `Planned for Phase 7.`
    );
  }

  /**
   * Read-only Cypher passthrough. Used by tools and tests.
   * Wraps FalkorDB's roQuery so callers don't need to import the
   * FalkorDB client type.
   */
  async roQuery(cypher: string, params?: Record<string, unknown>): Promise<{ data: unknown[] }> {
    const g = this.graph();
    const options = params ? ({ params } as Parameters<typeof g.roQuery>[1]) : undefined;
    const result = await g.roQuery(cypher, options);
    return { data: result.data ?? [] };
  }

  async addRegister(
    name: string,
    address: string,
    chip: string,
    rw: string,
    aliases: string[] = []
  ): Promise<void> {
    const g = this.graph();
    const props = { address, chip, rw, aliases, addr_n: hexAddr(address) ?? -1 };
    await g.query(
      `MERGE (r:Register {name: $name})
       ON CREATE SET r += $props, r.created_at = timestamp()
       ON MATCH SET r += $props, r.updated_at = timestamp()`,
      { params: { name, props } } as Parameters<typeof g.query>[1]
    );
  }

  async addKernalRoutine(name: string, address: string, description: string): Promise<void> {
    const g = this.graph();
    const props = { address, description, addr_n: hexAddr(address) ?? -1 };
    await g.query(
      `MERGE (k:KernalRoutine {name: $name})
       ON CREATE SET k += $props, k.created_at = timestamp()
       ON MATCH SET k += $props, k.updated_at = timestamp()`,
      { params: { name, props } } as Parameters<typeof g.query>[1]
    );
  }

  async addMemoryRegion(
    name: string,
    start: string,
    end: string,
    defaultUse: string,
    bankSwitchable: boolean
  ): Promise<void> {
    const g = this.graph();
    const props = {
      start,
      end,
      default_use: defaultUse,
      bank_switchable: bankSwitchable,
      start_n: hexAddr(start) ?? -1,
      end_n: hexAddr(end) ?? -1,
    };
    await g.query(
      `MERGE (m:MemoryRegion {name: $name})
       ON CREATE SET m += $props, m.created_at = timestamp()
       ON MATCH SET m += $props, m.updated_at = timestamp()`,
      { params: { name, props } } as Parameters<typeof g.query>[1]
    );
  }

  /**
   * IN_REGION: every Register and KernalRoutine whose address falls inside a
   * MemoryRegion. Run once after all nodes exist. Without this the 220
   * MemoryRegion nodes had no edges at all.
   */
  async linkAddressesToRegions(): Promise<{ registers: number; kernal: number }> {
    const g = this.graph();
    const r = await g.query(
      `MATCH (x:Register), (m:MemoryRegion)
       WHERE x.addr_n >= 0 AND m.start_n >= 0 AND x.addr_n >= m.start_n AND x.addr_n <= m.end_n
       MERGE (x)-[:IN_REGION]->(m)
       RETURN count(*) AS n`
    );
    const k = await g.query(
      `MATCH (x:KernalRoutine), (m:MemoryRegion)
       WHERE x.addr_n >= 0 AND m.start_n >= 0 AND x.addr_n >= m.start_n AND x.addr_n <= m.end_n
       MERGE (x)-[:IN_REGION]->(m)
       RETURN count(*) AS n`
    );
    const n = (res: typeof r) => Number((res.data?.[0] as { n?: number } | undefined)?.n ?? 0);
    return { registers: n(r), kernal: n(k) };
  }

  /** OCCUPIES: a recipe loads code or data into [start, end]; link every MemoryRegion that overlaps. */
  async linkRecipeOccupies(recipeName: string, start: number, end: number): Promise<number> {
    const g = this.graph();
    const r = await g.query(
      `MATCH (r:Recipe {name: $recipeName})
       MATCH (m:MemoryRegion)
       WHERE m.start_n >= 0 AND m.start_n <= $end AND m.end_n >= $start
       MERGE (r)-[:OCCUPIES]->(m)
       RETURN count(m) AS n`,
      { params: { recipeName, start, end } } as Parameters<typeof g.query>[1]
    );
    return Number((r.data?.[0] as { n?: number } | undefined)?.n ?? 0);
  }

  /** DEMANDS: a technique needs a machine-level resource while active (see CONVENTIONS-techniques.md). */
  async linkTechniqueDemands(techniqueName: string, resource: string, description: string): Promise<void> {
    const g = this.graph();
    await g.query(
      `MATCH (t:Technique {name: $techniqueName})
       MERGE (res:Resource {name: $resource})
       ON CREATE SET res.description = $description, res.created_at = timestamp()
       MERGE (t)-[:DEMANDS]->(res)`,
      { params: { techniqueName, resource, description } } as Parameters<typeof g.query>[1]
    );
  }

  async linkBelongsTo(entityType: string, entityName: string, chip: string): Promise<void> {
    const g = this.graph();
    await g.query(
      `MATCH (e:${entityType} {name: $entityName})
       MATCH (c:Chip {name: $chip})
       MERGE (e)-[:BELONGS_TO]->(c)`,
      { params: { entityName, chip } } as Parameters<typeof g.query>[1]
    );
  }

  async linkPairsWith(a: string, b: string): Promise<{ linked: boolean }> {
    const g = this.graph();
    const result = await g.query(
      `MATCH (a:KernalRoutine {name: $a})
       MATCH (b:KernalRoutine {name: $b})
       MERGE (a)-[:PAIRS_WITH]->(b)
       RETURN count(*) AS linked`,
      { params: { a, b } } as Parameters<typeof g.query>[1]
    );
    const linkedCount = ((result.data?.[0] as { linked: number } | undefined)?.linked ?? 0);
    // Gated behind INGEST_VERBOSE so MCP-host stderr stays clean. Set
    // INGEST_VERBOSE=1 during a clean re-ingest to surface per-pair details
    // in kernal-routines-reference.md.
    if (linkedCount === 0 && process.env.INGEST_VERBOSE) {
      console.warn(`linkPairsWith: ${a} -> ${b} skipped (one or both KernalRoutines not in graph)`);
    }
    return { linked: linkedCount > 0 };
  }

  async addTool(t: {
    name: string;
    kind: string;
    maintainer?: string;
    license?: string;
    home_url: string;
  }): Promise<void> {
    const g = this.graph();
    const props = {
      kind: t.kind,
      maintainer: t.maintainer ?? "",
      license: t.license ?? "",
      home_url: t.home_url,
    };
    await g.query(
      `MERGE (t:Tool {name: $name})
       ON CREATE SET t += $props, t.created_at = timestamp()
       ON MATCH SET t += $props, t.updated_at = timestamp()`,
      { params: { name: t.name, props } } as Parameters<typeof g.query>[1]
    );
  }

  async addFileFormat(name: string, description: string): Promise<void> {
    const g = this.graph();
    // Description is SET only on first creation. The ingest walk priority
    // puts docs/formats/c64-file-formats.md first, so the catalog's
    // authoritative description wins over the shorter blurbs in per-toolchain
    // docs that subsequently reference the same FileFormat.
    await g.query(
      `MERGE (f:FileFormat {name: $name})
       ON CREATE SET f.description = $description, f.created_at = timestamp()
       ON MATCH SET f.updated_at = timestamp()`,
      { params: { name, description } } as Parameters<typeof g.query>[1]
    );
  }

  async linkProduces(toolName: string, formatName: string): Promise<void> {
    const g = this.graph();
    await g.query(
      `MATCH (t:Tool {name: $toolName})
       MATCH (f:FileFormat {name: $formatName})
       MERGE (t)-[:PRODUCES]->(f)`,
      { params: { toolName, formatName } } as Parameters<typeof g.query>[1]
    );
  }

  async linkConsumes(toolName: string, formatName: string): Promise<void> {
    const g = this.graph();
    await g.query(
      `MATCH (t:Tool {name: $toolName})
       MATCH (f:FileFormat {name: $formatName})
       MERGE (t)-[:CONSUMES]->(f)`,
      { params: { toolName, formatName } } as Parameters<typeof g.query>[1]
    );
  }

  async linkTargets(toolName: string, chipName: string): Promise<void> {
    const g = this.graph();
    await g.query(
      `MATCH (t:Tool {name: $toolName})
       MATCH (c:Chip {name: $chipName})
       MERGE (t)-[:TARGETS]->(c)`,
      { params: { toolName, chipName } } as Parameters<typeof g.query>[1]
    );
  }

  async addRecipe(r: {
    name: string;
    toolchain: string;
    output_format: string;
    region: string;
    source_doc: string;
  }): Promise<void> {
    const g = this.graph();
    const props = {
      toolchain: r.toolchain,
      output_format: r.output_format,
      region: r.region,
      source_doc: r.source_doc,
    };
    await g.query(
      `MERGE (r:Recipe {name: $name})
       ON CREATE SET r += $props, r.created_at = timestamp()
       ON MATCH SET r += $props, r.updated_at = timestamp()`,
      { params: { name: r.name, props } } as Parameters<typeof g.query>[1]
    );
  }

  async linkRecipeImplements(recipeName: string, techniqueName: string): Promise<void> {
    const g = this.graph();
    await g.query(
      `MATCH (r:Recipe {name: $recipeName})
       MERGE (t:Technique {name: $techniqueName})
       MERGE (r)-[:IMPLEMENTS]->(t)`,
      { params: { recipeName, techniqueName } } as Parameters<typeof g.query>[1]
    );
  }

  async linkRecipeProducesFormat(recipeName: string, formatName: string): Promise<void> {
    const g = this.graph();
    await g.query(
      `MATCH (r:Recipe {name: $recipeName})
       MATCH (f:FileFormat {name: $formatName})
       MERGE (r)-[:PRODUCES]->(f)`,
      { params: { recipeName, formatName } } as Parameters<typeof g.query>[1]
    );
  }

  async linkRecipeUsesKernal(recipeName: string, kernalName: string): Promise<void> {
    const g = this.graph();
    await g.query(
      `MATCH (r:Recipe {name: $recipeName})
       MATCH (k:KernalRoutine {name: $kernalName})
       MERGE (r)-[:USES]->(k)`,
      { params: { recipeName, kernalName } } as Parameters<typeof g.query>[1]
    );
  }

  async linkRecipeUsesRegister(recipeName: string, registerName: string): Promise<void> {
    const g = this.graph();
    // Match by canonical name OR hex address OR alias so docs can reference
    // a register by mnemonic ("SCROLY") or hex ("D011") interchangeably.
    await g.query(
      `MATCH (r:Recipe {name: $recipeName})
       MATCH (reg:Register)
       WHERE reg.name = $registerName
          OR reg.address = $addr
          OR $registerName IN reg.aliases
       MERGE (r)-[:USES]->(reg)`,
      { params: { recipeName, registerName, addr: `$${registerName}` } } as Parameters<typeof g.query>[1]
    );
  }

  async linkRecipeUsesTool(recipeName: string, toolName: string): Promise<void> {
    const g = this.graph();
    await g.query(
      `MATCH (r:Recipe {name: $recipeName})
       MERGE (t:Tool {name: $toolName})
       MERGE (r)-[:USES]->(t)`,
      { params: { recipeName, toolName } } as Parameters<typeof g.query>[1]
    );
  }

  async addTechnique(t: {
    name: string;
    title: string;
    category: string;
    complexity?: string;
  }): Promise<void> {
    const g = this.graph();
    const props = {
      title: t.title,
      category: t.category,
      complexity: t.complexity ?? "",
    };
    await g.query(
      `MERGE (t:Technique {name: $name})
       ON CREATE SET t += $props, t.created_at = timestamp()
       ON MATCH SET t += $props, t.updated_at = timestamp()`,
      { params: { name: t.name, props } } as Parameters<typeof g.query>[1]
    );
  }

  async linkTechniqueUsesRegister(techniqueName: string, registerName: string): Promise<void> {
    const g = this.graph();
    // Match by canonical name OR hex address OR alias. Many registers are
    // documented under both hex form (D018) and mnemonic (VMCSB); doc
    // authors should be able to reference either.
    await g.query(
      `MATCH (t:Technique {name: $techniqueName})
       MATCH (r:Register)
       WHERE r.name = $registerName
          OR r.address = $addr
          OR $registerName IN r.aliases
       MERGE (t)-[:USES]->(r)`,
      { params: { techniqueName, registerName, addr: `$${registerName}` } } as Parameters<typeof g.query>[1]
    );
  }

  async linkTechniqueUsesKernal(techniqueName: string, kernalName: string): Promise<void> {
    const g = this.graph();
    await g.query(
      `MATCH (t:Technique {name: $techniqueName})
       MATCH (k:KernalRoutine {name: $kernalName})
       MERGE (t)-[:USES]->(k)`,
      { params: { techniqueName, kernalName } } as Parameters<typeof g.query>[1]
    );
  }

  async linkTechniqueRequiresRegion(techniqueName: string, regionName: string): Promise<void> {
    const g = this.graph();
    await g.query(
      `MATCH (t:Technique {name: $techniqueName})
       MATCH (r:Region {name: $regionName})
       MERGE (t)-[:REQUIRES_REGION]->(r)`,
      { params: { techniqueName, regionName } } as Parameters<typeof g.query>[1]
    );
  }

  async linkTechniqueBelongsTo(techniqueName: string, chipName: string): Promise<void> {
    const g = this.graph();
    await g.query(
      `MATCH (t:Technique {name: $techniqueName})
       MATCH (c:Chip {name: $chipName})
       MERGE (t)-[:BELONGS_TO]->(c)`,
      { params: { techniqueName, chipName } } as Parameters<typeof g.query>[1]
    );
  }

  async addPitfall(p: {
    name: string;
    title: string;
    severity: string;
    region: string;
    category: string;
  }): Promise<void> {
    const g = this.graph();
    await g.query(
      `MERGE (p:Pitfall {name: $name})
       SET p.title = $title, p.severity = $severity, p.region = $region, p.category = $category`,
      { params: { name: p.name, title: p.title, severity: p.severity, region: p.region, category: p.category } } as Parameters<typeof g.query>[1]
    );
  }

  async linkTriggeredBy(
    pitfallName: string,
    targetName: string,
    targetKind: "Register" | "KernalRoutine" | "Technique"
  ): Promise<boolean> {
    const g = this.graph();
    // For Register targets, match by canonical name OR hex address OR alias so
    // pitfall docs can reference registers by hex form (D011) or mnemonic (SCROLY).
    const matchClause =
      targetKind === "Register"
        ? `MATCH (t:Register) WHERE t.name = $targetName OR t.address = $addr OR $targetName IN t.aliases`
        : `MATCH (t:${targetKind} {name: $targetName})`;
    const result = await g.query(
      `MATCH (p:Pitfall {name: $pitfallName})
       ${matchClause}
       MERGE (p)-[:TRIGGERED_BY]->(t)
       RETURN 1`,
      { params: { pitfallName, targetName, addr: `$${targetName}` } } as Parameters<typeof g.query>[1]
    );
    // A reference that names no node is a defect in the doc, not a debug
    // detail: say so every time. (It used to be behind INGEST_VERBOSE, and
    // seven such references sat unnoticed.)
    const landed = (result.data?.length ?? 0) > 0;
    if (!landed) {
      console.warn(
        `[falkor] linkTriggeredBy: ${pitfallName} -> ${targetName} (${targetKind}) — target not found, edge dropped`
      );
    }
    return landed;
  }

  async addCrashPattern(c: {
    symptom: string;
    description: string;
    likely_causes: string[];
    diagnosis_steps: string;
  }): Promise<void> {
    const g = this.graph();
    await g.query(
      `MERGE (cp:CrashPattern {symptom: $symptom})
       SET cp.description = $description, cp.likely_causes = $likelyCausesJson, cp.diagnosis_steps = $diagnosis_steps`,
      {
        params: {
          symptom: c.symptom,
          description: c.description,
          likelyCausesJson: JSON.stringify(c.likely_causes),
          diagnosis_steps: c.diagnosis_steps,
        },
      } as Parameters<typeof g.query>[1]
    );
  }

  async linkCausedBy(
    symptom: string,
    targetName: string,
    targetKind: "Register" | "KernalRoutine" | "Technique"
  ): Promise<boolean> {
    const g = this.graph();
    // For Register targets, match by canonical name OR hex address OR alias so
    // failure docs can reference registers by hex form (D018) or mnemonic (VMCSB).
    const matchClause =
      targetKind === "Register"
        ? `MATCH (t:Register) WHERE t.name = $targetName OR t.address = $addr OR $targetName IN t.aliases`
        : `MATCH (t:${targetKind} {name: $targetName})`;
    const result = await g.query(
      `MATCH (c:CrashPattern {symptom: $symptom})
       ${matchClause}
       MERGE (c)-[:CAUSED_BY]->(t)
       RETURN 1`,
      { params: { symptom, targetName, addr: `$${targetName}` } } as Parameters<typeof g.query>[1]
    );
    const landed = (result.data?.length ?? 0) > 0;
    if (!landed) {
      console.warn(
        `[falkor] linkCausedBy: ${symptom} -> ${targetName} (${targetKind}) — target not found, edge dropped`
      );
    }
    return landed;
  }
}
