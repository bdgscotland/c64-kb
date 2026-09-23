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
import { config } from "../config.ts";
import { HARDWARE_UNITS } from "../graph/extract.ts";

const GRAPH_NAME = config.falkor.graphName;

// Node labels we want range-indexed on their primary key property.
// Keep this list aligned with docs/ONTOLOGY.md §4.1.
const NODE_INDEXES: readonly (readonly [string, string])[] = [
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
  ["Archetype", "name"],
  ["HardwareUnit", "name"],
];

// "$D011" -> 0xD011; null when the string is not a 16-bit hex address.
function hexAddr(s: string | undefined): number | null {
  if (!s) return null;
  const m = /^\$?([0-9A-Fa-f]{1,4})$/.exec(s.trim());
  return m ? parseInt(m[1], 16) : null;
}

// Unique constraints on the primary key for every node label. Constraint
// violations fail at write time instead of silently merging duplicates.
// Per docs/ONTOLOGY.md §4.1.
const UNIQUE_CONSTRAINTS: readonly (readonly [string, string])[] = [
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
  ["Archetype", "name"],
  ["HardwareUnit", "name"],
];

// Full-text indexes for "find a thing that does X" queries (Phase 2+).
const FULLTEXT_INDEXES: readonly (readonly [string, string])[] = [
  ["KernalRoutine", "description"],
  // Phase 2+: ["Technique", "description"], ["Pitfall", "description"], ["Recipe", "description"]
];

// Node labels that hold ingested-doc entities. clean() wipes these,
// preserving Chip/Region/HardwareUnit seeds which ensureSchema re-MERGEs.
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
  "Archetype",
];

const CHIPS: readonly { name: string; variants: string; role: string }[] = [
  { name: "VIC-II", variants: "6569 PAL / 6567 NTSC", role: "Graphics + raster" },
  { name: "SID", variants: "6581 / 8580", role: "Audio synthesis" },
  { name: "CIA1", variants: "6526", role: "Keyboard / joystick / timer-A IRQ" },
  { name: "CIA2", variants: "6526", role: "VIC bank / RS-232 / timer-B NMI" },
  { name: "6510", variants: "MOS 6510", role: "CPU (6502-compatible + I/O port at $00/$01)" },
];

const REGIONS: readonly {
  name: string;
  refresh_hz: number;
  lines_per_frame: number;
  cycles_per_line: number;
}[] = [
  { name: "PAL", refresh_hz: 50, lines_per_frame: 312, cycles_per_line: 63 },
  { name: "NTSC", refresh_hz: 60, lines_per_frame: 263, cycles_per_line: 65 },
];

/**
 * ensureSchema is re-run on every connect, so "already there" is expected.
 * Messages measured against FalkorDB graph module 4.18.7: "Attribute 'x' is
 * already indexed", "Constraint already exists". Anything else is rethrown;
 * the bare catch here used to hide every error, not just these.
 */
function ignoreIfExists(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  if (/already indexed|already exists/i.test(msg)) return;
  throw err;
}

export class FalkorService {
  private db: FalkorDB | null = null;
  private graphName = GRAPH_NAME;

  async connect(host: string = config.falkor.host, port: number = config.falkor.port): Promise<void> {
    this.db = await FalkorDB.connect({ socket: { host, port } });
    // The client re-emits socket errors as 'error' events. With no listener
    // Node throws them, so a FalkorDB restart would kill a long-lived MCP
    // server; the client reconnects on its own once the socket returns.
    this.db.on("error", (err: unknown) => {
      console.error("[falkor] connection error:", err instanceof Error ? err.message : err);
    });
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
      } catch (err) {
        ignoreIfExists(err);
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
        } catch (err) {
          ignoreIfExists(err);
        }
      }
    }

    for (const [label, prop] of UNIQUE_CONSTRAINTS) {
      try {
        await g.constraintCreate(ConstraintType.UNIQUE, EntityType.NODE, label, prop);
      } catch (err) {
        ignoreIfExists(err);
      }
    }

    for (const [label, prop] of FULLTEXT_INDEXES) {
      try {
        await g.createNodeFulltextIndex(label, prop);
      } catch (err) {
        ignoreIfExists(err);
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
        },
      );
    }

    // HardwareUnit seeds (schema 25): the pieces of hardware a CLAIMS edge
    // names. Seeded, like Chip and Region, so a Claims line can only point at
    // a unit that exists; BELONGS_TO its chip where it has one.
    for (const u of HARDWARE_UNITS) {
      await g.query(
        `MERGE (h:HardwareUnit {name: $name})
         ON CREATE SET h += $props, h.created_at = timestamp()
         ON MATCH SET h += $props, h.updated_at = timestamp()`,
        {
          params: { name: u.name, props: { kind: u.kind, addresses: u.addresses, chip: u.chip ?? "" } },
        } as Parameters<typeof g.query>[1],
      );
      if (u.chip) {
        await g.query(
          `MATCH (h:HardwareUnit {name: $name}) MATCH (c:Chip {name: $chip}) MERGE (h)-[:BELONGS_TO]->(c)`,
          { params: { name: u.name, chip: u.chip } } as Parameters<typeof g.query>[1],
        );
      }
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
        },
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
    } catch (err) {
      // A graph that was never created: "Invalid graph operation on empty key".
      if (!(err instanceof Error && err.message.includes("empty key"))) throw err;
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
    label;
    throw new Error(
      `findOrphans is not implemented until Phase 7 coverage tooling. ` + `Planned for Phase 7.`,
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
    aliases: string[] = [],
  ): Promise<void> {
    const g = this.graph();
    const props = { address, chip, rw, aliases, addr_n: hexAddr(address) ?? -1 };
    await g.query(
      `MERGE (r:Register {name: $name})
       ON CREATE SET r += $props, r.created_at = timestamp()
       ON MATCH SET r += $props, r.updated_at = timestamp()`,
      { params: { name, props } },
    );
  }

  async addKernalRoutine(name: string, address: string, description: string): Promise<void> {
    const g = this.graph();
    const props = { address, description, addr_n: hexAddr(address) ?? -1 };
    await g.query(
      `MERGE (k:KernalRoutine {name: $name})
       ON CREATE SET k += $props, k.created_at = timestamp()
       ON MATCH SET k += $props, k.updated_at = timestamp()`,
      { params: { name, props } },
    );
  }

  async addMemoryRegion(
    name: string,
    start: string,
    end: string,
    defaultUse: string,
    bankSwitchable: boolean,
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
      { params: { name, props } },
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
       RETURN count(*) AS n`,
    );
    const k = await g.query(
      `MATCH (x:KernalRoutine), (m:MemoryRegion)
       WHERE x.addr_n >= 0 AND m.start_n >= 0 AND x.addr_n >= m.start_n AND x.addr_n <= m.end_n
       MERGE (x)-[:IN_REGION]->(m)
       RETURN count(*) AS n`,
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
      { params: { recipeName, start, end } },
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
      { params: { techniqueName, resource, description } },
    );
  }

  async linkBelongsTo(entityType: string, entityName: string, chip: string): Promise<void> {
    const g = this.graph();
    await g.query(
      `MATCH (e:${entityType} {name: $entityName})
       MATCH (c:Chip {name: $chip})
       MERGE (e)-[:BELONGS_TO]->(c)`,
      { params: { entityName, chip } },
    );
  }

  async linkPairsWith(a: string, b: string): Promise<{ linked: boolean }> {
    const g = this.graph();
    const result = await g.query(
      `MATCH (a:KernalRoutine {name: $a})
       MATCH (b:KernalRoutine {name: $b})
       MERGE (a)-[:PAIRS_WITH]->(b)
       RETURN count(*) AS linked`,
      { params: { a, b } },
    );
    const linkedCount = (result.data?.[0] as { linked: number } | undefined)?.linked ?? 0;
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
    // Schema 24: the version the repo's gates ran with; cleared when the
    // page drops its version_verified key.
    version_verified?: string;
  }): Promise<void> {
    const g = this.graph();
    const props: Record<string, string> = {
      kind: t.kind,
      maintainer: t.maintainer ?? "",
      license: t.license ?? "",
      home_url: t.home_url,
    };
    if (t.version_verified) props.version_verified = t.version_verified;
    await g.query(
      `MERGE (t:Tool {name: $name})
       ON CREATE SET t += $props, t.created_at = timestamp()
       ON MATCH SET t += $props, t.updated_at = timestamp()
       ${t.version_verified ? "" : "SET t.version_verified = NULL"}`,
      { params: { name: t.name, props } },
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
      { params: { name, description } },
    );
  }

  async linkProduces(toolName: string, formatName: string): Promise<void> {
    const g = this.graph();
    await g.query(
      `MATCH (t:Tool {name: $toolName})
       MATCH (f:FileFormat {name: $formatName})
       MERGE (t)-[:PRODUCES]->(f)`,
      { params: { toolName, formatName } },
    );
  }

  async linkConsumes(toolName: string, formatName: string): Promise<void> {
    const g = this.graph();
    await g.query(
      `MATCH (t:Tool {name: $toolName})
       MATCH (f:FileFormat {name: $formatName})
       MERGE (t)-[:CONSUMES]->(f)`,
      { params: { toolName, formatName } },
    );
  }

  async linkTargets(toolName: string, chipName: string): Promise<void> {
    const g = this.graph();
    await g.query(
      `MATCH (t:Tool {name: $toolName})
       MATCH (c:Chip {name: $chipName})
       MERGE (t)-[:TARGETS]->(c)`,
      { params: { toolName, chipName } },
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
      { params: { name: r.name, props } },
    );
  }

  async linkRecipeImplements(recipeName: string, techniqueName: string): Promise<void> {
    const g = this.graph();
    await g.query(
      `MATCH (r:Recipe {name: $recipeName})
       MERGE (t:Technique {name: $techniqueName})
       MERGE (r)-[:IMPLEMENTS]->(t)`,
      { params: { recipeName, techniqueName } },
    );
  }

  /**
   * SCAFFOLDS: the recipe's frontmatter names this archetype as one it is a
   * starting point for. Both ends MATCHed, never MERGEd, so an archetype
   * name the graph does not have drops the edge with a warning instead of
   * creating a stub. Returns whether the edge landed.
   */
  async linkRecipeScaffolds(recipeName: string, archetypeName: string): Promise<boolean> {
    const g = this.graph();
    const result = await g.query(
      `MATCH (r:Recipe {name: $recipeName})
       MATCH (a:Archetype {name: $archetypeName})
       MERGE (r)-[:SCAFFOLDS]->(a)
       RETURN 1`,
      { params: { recipeName, archetypeName } },
    );
    const landed = (result.data?.length ?? 0) > 0;
    if (!landed) {
      console.warn(
        `[falkor] linkRecipeScaffolds: ${recipeName} -> ${archetypeName} (Archetype) — recipe or archetype not found, edge dropped`,
      );
    }
    return landed;
  }

  async linkRecipeProducesFormat(recipeName: string, formatName: string): Promise<void> {
    const g = this.graph();
    await g.query(
      `MATCH (r:Recipe {name: $recipeName})
       MATCH (f:FileFormat {name: $formatName})
       MERGE (r)-[:PRODUCES]->(f)`,
      { params: { recipeName, formatName } },
    );
  }

  async linkRecipeUsesKernal(recipeName: string, kernalName: string): Promise<void> {
    const g = this.graph();
    await g.query(
      `MATCH (r:Recipe {name: $recipeName})
       MATCH (k:KernalRoutine {name: $kernalName})
       MERGE (r)-[:USES]->(k)`,
      { params: { recipeName, kernalName } },
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
      { params: { recipeName, registerName, addr: `$${registerName}` } },
    );
  }

  // The recipe-to-tool link is REQUIRES_TOOL, as the ontology defines it. Until
  // data 713 this wrote USES, which left REQUIRES_TOOL populated by nothing.
  async linkRecipeUsesTool(recipeName: string, toolName: string): Promise<void> {
    const g = this.graph();
    await g.query(
      `MATCH (r:Recipe {name: $recipeName})
       MERGE (t:Tool {name: $toolName})
       MERGE (r)-[:REQUIRES_TOOL]->(t)`,
      { params: { recipeName, toolName } },
    );
  }

  async addTechnique(t: {
    name: string;
    title: string;
    category: string;
    complexity?: string;
    // Cost model (schema 22): each present key lands as cost_<key>; the
    // basis word lands as cost_basis. A technique without a Cost line gets
    // none of these properties, so `IS NOT NULL` finds the costed ones. A
    // re-ingest that drops the line clears them, so a stale figure cannot
    // outlive its page.
    cost?: Partial<Record<string, number>>;
    cost_basis?: string;
    // **Raster band:** (schema 24), canonical form from parseRasterBand:
    // "45-250", "0-50,251-311" or "movable". Cleared when the page drops it.
    raster_band?: string;
    // **Claims:** (schema 25): "stated" or "none"; absent means unknown. The
    // CLAIMS edges themselves land in pass 2 (linkClaims).
    claims_stated?: string;
    claims_basis?: string;
  }): Promise<void> {
    const g = this.graph();
    const props: Record<string, string | number> = {
      title: t.title,
      category: t.category,
      complexity: t.complexity ?? "",
    };
    const costKeys = [
      "cycles_per_line",
      "cycles_per_frame",
      "lines_active",
      "bytes_code",
      "bytes_data",
      "zp_bytes",
      "irq_slots",
      "sprites_per_line",
    ];
    const cleared: string[] = [];
    for (const k of costKeys) {
      const v = t.cost?.[k];
      if (typeof v === "number" && Number.isInteger(v)) props[`cost_${k}`] = v;
      else cleared.push(`t.cost_${k}`);
    }
    if (t.cost && t.cost_basis) props.cost_basis = t.cost_basis;
    else cleared.push("t.cost_basis");
    if (t.raster_band) props.raster_band = t.raster_band;
    else cleared.push("t.raster_band");
    if (t.claims_stated && t.claims_basis) {
      props.claims_stated = t.claims_stated;
      props.claims_basis = t.claims_basis;
    } else cleared.push("t.claims_stated", "t.claims_basis");
    await g.query(
      `MERGE (t:Technique {name: $name})
       ON CREATE SET t += $props, t.created_at = timestamp()
       ON MATCH SET t += $props, t.updated_at = timestamp()
       SET ${cleared.length > 0 ? cleared.map((c) => `${c} = NULL`).join(", ") : "t.name = t.name"}`,
      { params: { name: t.name, props } },
    );
    // The page owns its CLAIMS edges outright: drop the old ones so a claim
    // the page stopped making does not outlive it (pass 2 re-adds the rest).
    await g.query(`MATCH (t:Technique {name: $name})-[c:CLAIMS]->(:HardwareUnit) DELETE c`, {
      params: { name: t.name },
    } as Parameters<typeof g.query>[1]);
  }

  /**
   * CLAIMS (schema 25): a technique holds a HardwareUnit in a mode (owns,
   * shares, reads, init); zero_page carries its byte ranges. Both ends must
   * exist: the unit is a seed and the technique came from pass 1, so a MERGE
   * could only manufacture a stub out of a typo. Returns whether it landed.
   */
  async linkClaims(c: {
    owner: string;
    ownerKind: "Technique";
    unit: string;
    mode: string;
    ranges?: string;
    relocatable?: boolean;
    basis: string;
  }): Promise<boolean> {
    const g = this.graph();
    const ends = await g.roQuery(
      `MATCH (t:${c.ownerKind} {name: $owner}) MATCH (h:HardwareUnit {name: $unit}) RETURN 1`,
      { params: { owner: c.owner, unit: c.unit } } as Parameters<typeof g.roQuery>[1],
    );
    if ((ends.data?.length ?? 0) === 0) {
      console.warn(
        `[falkor] linkClaims: ${c.owner} -> ${c.unit} — ${c.ownerKind} or HardwareUnit not found, edge dropped`,
      );
      return false;
    }
    await g.query(
      `MATCH (t:${c.ownerKind} {name: $owner})
       MATCH (h:HardwareUnit {name: $unit})
       MERGE (t)-[e:CLAIMS]->(h)
       SET e.mode = $mode, e.ranges = $ranges, e.relocatable = $relocatable, e.basis = $basis`,
      {
        params: {
          owner: c.owner,
          unit: c.unit,
          mode: c.mode,
          ranges: c.ranges ?? null,
          relocatable: c.relocatable === true,
          basis: c.basis,
        },
      } as Parameters<typeof g.query>[1],
    );
    return true;
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
      { params: { techniqueName, registerName, addr: `$${registerName}` } },
    );
  }

  async linkTechniqueUsesKernal(techniqueName: string, kernalName: string): Promise<void> {
    const g = this.graph();
    await g.query(
      `MATCH (t:Technique {name: $techniqueName})
       MATCH (k:KernalRoutine {name: $kernalName})
       MERGE (t)-[:USES]->(k)`,
      { params: { techniqueName, kernalName } },
    );
  }

  async linkTechniqueRequiresRegion(techniqueName: string, regionName: string): Promise<void> {
    const g = this.graph();
    await g.query(
      `MATCH (t:Technique {name: $techniqueName})
       MATCH (r:Region {name: $regionName})
       MERGE (t)-[:REQUIRES_REGION]->(r)`,
      { params: { techniqueName, regionName } },
    );
  }

  async linkTechniqueBelongsTo(techniqueName: string, chipName: string): Promise<void> {
    const g = this.graph();
    await g.query(
      `MATCH (t:Technique {name: $techniqueName})
       MATCH (c:Chip {name: $chipName})
       MERGE (t)-[:BELONGS_TO]->(c)`,
      { params: { techniqueName, chipName } },
    );
  }

  /**
   * REQUIRES: a technique presupposes another one being set up before, or
   * running underneath, it (see CONVENTIONS-techniques.md). Both ends must
   * already exist — a MERGE on the target, as linkRecipeImplements does,
   * would manufacture a stub Technique out of a typo. A reference that would
   * close a cycle (the required technique already requires this one, directly
   * or through others) is refused, as is a self-reference. The back-path
   * check walks at most twelve REQUIRES edges, the same bound as
   * techniquesFor's chain filter; a longer chain would not be checked. The
   * longest authored chain is two. Returns whether the edge landed; every
   * refusal is warned about by name.
   */
  async linkTechniqueRequires(techniqueName: string, requiresName: string): Promise<boolean> {
    const g = this.graph();
    if (techniqueName === requiresName) {
      console.warn(`[falkor] linkTechniqueRequires: ${techniqueName} -> itself — refused`);
      return false;
    }
    const ends = await g.roQuery(
      `MATCH (t:Technique {name: $techniqueName})
       MATCH (p:Technique {name: $requiresName})
       RETURN 1`,
      { params: { techniqueName, requiresName } },
    );
    if ((ends.data?.length ?? 0) === 0) {
      console.warn(
        `[falkor] linkTechniqueRequires: ${techniqueName} -> ${requiresName} — one or both techniques not found, edge dropped`,
      );
      return false;
    }
    const back = await g.roQuery(
      `MATCH (p:Technique {name: $requiresName})-[:REQUIRES*1..12]->(t:Technique {name: $techniqueName})
       RETURN 1 LIMIT 1`,
      { params: { techniqueName, requiresName } },
    );
    if ((back.data?.length ?? 0) > 0) {
      console.warn(
        `[falkor] linkTechniqueRequires: ${techniqueName} -> ${requiresName} would close a cycle (${requiresName} already requires ${techniqueName}) — refused`,
      );
      return false;
    }
    await g.query(
      `MATCH (t:Technique {name: $techniqueName})
       MATCH (p:Technique {name: $requiresName})
       MERGE (t)-[:REQUIRES]->(p)`,
      { params: { techniqueName, requiresName } },
    );
    return true;
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
      {
        params: {
          name: p.name,
          title: p.title,
          severity: p.severity,
          region: p.region,
          category: p.category,
        },
      },
    );
  }

  async linkTriggeredBy(
    pitfallName: string,
    targetName: string,
    targetKind: "Register" | "KernalRoutine" | "Technique",
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
      { params: { pitfallName, targetName, addr: `$${targetName}` } },
    );
    // A reference that names no node is a defect in the doc, not a debug
    // detail: say so every time. (It used to be behind INGEST_VERBOSE, and
    // seven such references sat unnoticed.)
    const landed = (result.data?.length ?? 0) > 0;
    if (!landed) {
      console.warn(
        `[falkor] linkTriggeredBy: ${pitfallName} -> ${targetName} (${targetKind}) — target not found, edge dropped`,
      );
    }
    return landed;
  }

  /**
   * MITIGATED_BY: applying this technique is the pitfall's Fix (see
   * CONVENTIONS-pitfalls.md). Technique targets only; both ends are MATCHed,
   * never MERGEd, so a misspelt name drops the edge with a warning instead
   * of creating a stub node. Returns whether the edge landed.
   */
  async linkMitigatedBy(pitfallName: string, techniqueName: string): Promise<boolean> {
    const g = this.graph();
    const result = await g.query(
      `MATCH (p:Pitfall {name: $pitfallName})
       MATCH (t:Technique {name: $techniqueName})
       MERGE (p)-[:MITIGATED_BY]->(t)
       RETURN 1`,
      { params: { pitfallName, techniqueName } },
    );
    const landed = (result.data?.length ?? 0) > 0;
    if (!landed) {
      console.warn(
        `[falkor] linkMitigatedBy: ${pitfallName} -> ${techniqueName} (Technique) — pitfall or technique not found, edge dropped`,
      );
    }
    return landed;
  }

  /**
   * Archetype: a game or demo shape from docs/game-design/c64-game-archetypes.md
   * (docs/CONVENTIONS-archetypes.md). Keyed by snake_case name.
   */
  async addArchetype(a: {
    name: string;
    title: string;
    kind: "game" | "demo";
    source_doc: string;
  }): Promise<void> {
    const g = this.graph();
    await g.query(
      `MERGE (a:Archetype {name: $name})
       SET a.title = $title, a.kind = $kind, a.source_doc = $source_doc`,
      { params: { name: a.name, title: a.title, kind: a.kind, source_doc: a.source_doc } },
    );
  }

  /**
   * FEATURES: the archetype's technique fingerprint names this technique.
   * Both ends MATCHed, never MERGEd, so a name the graph does not have drops
   * the edge with a warning instead of creating a stub. Returns whether it landed.
   */
  async linkArchetypeFeatures(archetypeName: string, techniqueName: string): Promise<boolean> {
    const g = this.graph();
    const result = await g.query(
      `MATCH (a:Archetype {name: $archetypeName})
       MATCH (t:Technique {name: $techniqueName})
       MERGE (a)-[:FEATURES]->(t)
       RETURN 1`,
      { params: { archetypeName, techniqueName } },
    );
    const landed = (result.data?.length ?? 0) > 0;
    if (!landed) {
      console.warn(
        `[falkor] linkArchetypeFeatures: ${archetypeName} -> ${techniqueName} (Technique) — archetype or technique not found, edge dropped`,
      );
    }
    return landed;
  }

  /**
   * RISKS: the archetype's common-pitfalls line names this pitfall. Same
   * MATCH-both discipline as FEATURES. Returns whether the edge landed.
   */
  async linkArchetypeRisks(archetypeName: string, pitfallName: string): Promise<boolean> {
    const g = this.graph();
    const result = await g.query(
      `MATCH (a:Archetype {name: $archetypeName})
       MATCH (p:Pitfall {name: $pitfallName})
       MERGE (a)-[:RISKS]->(p)
       RETURN 1`,
      { params: { archetypeName, pitfallName } },
    );
    const landed = (result.data?.length ?? 0) > 0;
    if (!landed) {
      console.warn(
        `[falkor] linkArchetypeRisks: ${archetypeName} -> ${pitfallName} (Pitfall) — archetype or pitfall not found, edge dropped`,
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
      },
    );
  }

  async linkCausedBy(
    symptom: string,
    targetName: string,
    targetKind: "Register" | "KernalRoutine" | "Technique",
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
      { params: { symptom, targetName, addr: `$${targetName}` } },
    );
    const landed = (result.data?.length ?? 0) > 0;
    if (!landed) {
      console.warn(
        `[falkor] linkCausedBy: ${symptom} -> ${targetName} (${targetKind}) — target not found, edge dropped`,
      );
    }
    return landed;
  }
}
