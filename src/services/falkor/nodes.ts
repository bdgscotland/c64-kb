/**
 * Node writes: one method per node type. Each is an upsert keyed on the
 * label's primary key (see schema.ts).
 */

import { FalkorBase } from "./base.ts";
import { hexAddr } from "./params.ts";

export interface RegisterNode {
  name: string;
  address: string;
  chip: string;
  rw: string;
  aliases?: string[] | undefined;
}

export interface MemoryRegionNode {
  name: string;
  start: string;
  end: string;
  defaultUse: string;
  bankSwitchable: boolean;
}

// The positional forms stay for existing callers (src/ingest.ts,
// src/tools/hydrate.ts and many tests); new code should pass an object.
type RegisterArgs =
  [RegisterNode] | [name: string, address: string, chip: string, rw: string, aliases?: string[] | undefined];
type MemoryRegionArgs =
  | [MemoryRegionNode]
  | [name: string, start: string, end: string, defaultUse: string, bankSwitchable: boolean];

const COST_KEYS = [
  "cycles_per_line",
  "cycles_per_frame",
  "cycles_per_frame_typical",
  "lines_active",
  "bytes_code",
  "bytes_data",
  "zp_bytes",
  "irq_slots",
  "sprites_per_line",
] as const;

export interface TechniqueNode {
  name: string;
  title: string;
  category: string;
  complexity?: string | undefined;
  // Cost model (schema 22): each present key lands as cost_<key>; the
  // basis word lands as cost_basis. A technique without a Cost line gets
  // none of these properties, so `IS NOT NULL` finds the costed ones. A
  // re-ingest that drops the line clears them, so a stale figure cannot
  // outlive its page.
  cost?: Partial<Record<string, number>> | undefined;
  cost_basis?: string | undefined;
  // **Cost bytes basis:** (#72): the byte figures' own basis, absent when
  // cost_basis covers them. Cleared with the Cost line.
  cost_bytes_basis?: string | undefined;
  // **Cost measured on:** and **Cost includes:** (schema 27): the recipe the
  // figures came from, its conditions, and the techniques whose work is
  // inside the figure. Cleared with the Cost line.
  cost_recipe?: string | undefined;
  cost_conditions?: string | undefined;
  cost_includes?: string[] | undefined;
  // **Raster band:** (schema 24), canonical form from parseRasterBand:
  // "45-250", "0-50,251-311" or "movable". Cleared when the page drops it.
  raster_band?: string | undefined;
  // **Claims:** (schema 25): "stated" or "none"; absent means unknown. The
  // CLAIMS edges themselves land in pass 2 (linkClaims).
  claims_stated?: string | undefined;
  claims_basis?: string | undefined;
}

type NodeProps = Record<string, string | number | string[]>;

/** Set `key` to `value` when it is present, or mark it to clear. */
function setOrClear(
  props: NodeProps,
  clear: string[],
  key: string,
  value: string | number | string[] | undefined,
): void {
  const empty = value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
  if (empty) clear.push(key);
  else props[key] = value;
}

/** The Cost line's properties (schema 22, provenance schema 27); all of them clear when the line is gone. */
function costProps(t: TechniqueNode, props: NodeProps, clear: string[]): void {
  for (const k of COST_KEYS) {
    const v = t.cost?.[k];
    setOrClear(props, clear, `cost_${k}`, typeof v === "number" && Number.isInteger(v) ? v : undefined);
  }
  const costed = Boolean(t.cost && t.cost_basis);
  setOrClear(props, clear, "cost_basis", costed ? t.cost_basis : undefined);
  setOrClear(props, clear, "cost_bytes_basis", costed ? t.cost_bytes_basis : undefined);
  setOrClear(props, clear, "cost_recipe", costed ? t.cost_recipe : undefined);
  setOrClear(props, clear, "cost_conditions", costed ? t.cost_conditions : undefined);
  setOrClear(props, clear, "cost_includes", costed ? t.cost_includes : undefined);
}

/** The technique's stored properties, and the ones to clear because the page no longer sets them. */
function techniqueProps(t: TechniqueNode): { props: NodeProps; clear: string[] } {
  const props: NodeProps = {
    title: t.title,
    category: t.category,
    complexity: t.complexity ?? "",
  };
  const clear: string[] = [];
  costProps(t, props, clear);
  setOrClear(props, clear, "raster_band", t.raster_band);
  if (t.claims_stated && t.claims_basis) {
    props.claims_stated = t.claims_stated;
    props.claims_basis = t.claims_basis;
  } else clear.push("claims_stated", "claims_basis");
  return { props, clear };
}

export class FalkorNodes extends FalkorBase {
  addRegister(r: RegisterNode): Promise<void>;
  addRegister(name: string, address: string, chip: string, rw: string, aliases?: string[]): Promise<void>;
  async addRegister(...args: RegisterArgs): Promise<void> {
    const [name, address, chip, rw, aliases = []] =
      args.length === 1 ? [args[0].name, args[0].address, args[0].chip, args[0].rw, args[0].aliases] : args;
    await this.upsertNode({
      label: "Register",
      name,
      props: { address, chip, rw, aliases, addr_n: hexAddr(address) },
    });
  }

  async addKernalRoutine(name: string, address: string, description: string): Promise<void> {
    await this.upsertNode({
      label: "KernalRoutine",
      name,
      props: { address, description, addr_n: hexAddr(address) },
    });
    // The page owns the routine's CLOBBERS_ZP edges (schema 26): drop the
    // old ones so a line the page no longer carries leaves no edge behind.
    await this.write(`MATCH (k:KernalRoutine {name: $name})-[e:CLOBBERS_ZP]->(:HardwareUnit) DELETE e`, {
      name,
    });
  }

  addMemoryRegion(m: MemoryRegionNode): Promise<void>;
  addMemoryRegion(
    name: string,
    start: string,
    end: string,
    defaultUse: string,
    bankSwitchable: boolean,
  ): Promise<void>;
  async addMemoryRegion(...args: MemoryRegionArgs): Promise<void> {
    const m =
      args.length === 1
        ? args[0]
        : { name: args[0], start: args[1], end: args[2], defaultUse: args[3], bankSwitchable: args[4] };
    await this.upsertNode({
      label: "MemoryRegion",
      name: m.name,
      props: {
        start: m.start,
        end: m.end,
        default_use: m.defaultUse,
        bank_switchable: m.bankSwitchable,
        start_n: hexAddr(m.start),
        end_n: hexAddr(m.end),
      },
    });
  }

  async addTool(t: {
    name: string;
    kind: string;
    maintainer?: string | undefined;
    license?: string | undefined;
    home_url: string;
    // Schema 24: the version the repo's gates ran with; cleared when the
    // page drops its version_verified key.
    version_verified?: string | undefined;
  }): Promise<void> {
    const props: Record<string, string> = {
      kind: t.kind,
      maintainer: t.maintainer ?? "",
      license: t.license ?? "",
      home_url: t.home_url,
    };
    if (t.version_verified) props.version_verified = t.version_verified;
    await this.upsertNode({
      label: "Tool",
      name: t.name,
      props,
      clear: t.version_verified ? [] : ["version_verified"],
    });
  }

  async addFileFormat(name: string, description: string): Promise<void> {
    // Description is SET only on first creation. The ingest walk priority
    // puts docs/formats/c64-file-formats.md first, so the catalog's
    // authoritative description wins over the shorter blurbs in per-toolchain
    // docs that subsequently reference the same FileFormat.
    await this.write(
      `MERGE (f:FileFormat {name: $name})
       ON CREATE SET f.description = $description, f.created_at = timestamp()
       ON MATCH SET f.updated_at = timestamp()`,
      { name, description },
    );
  }

  async addRecipe(r: {
    name: string;
    toolchain: string;
    output_format: string;
    region: string;
    source_doc: string;
    claims_stated?: "stated" | "none" | undefined;
    claims_basis?: string | undefined;
  }): Promise<void> {
    // Named field by field: callers pass whole extracted entities, whose other fields must not land.
    const props: NodeProps = {
      toolchain: r.toolchain,
      output_format: r.output_format,
      region: r.region,
      source_doc: r.source_doc,
    };
    const clear: string[] = [];
    if (r.claims_stated && r.claims_basis) {
      props.claims_stated = r.claims_stated;
      props.claims_basis = r.claims_basis;
    } else clear.push("claims_stated", "claims_basis");
    await this.upsertNode({ label: "Recipe", name: r.name, props, clear });
    // As for a technique (schema 34): the page owns its CLAIMS edges outright.
    await this.write(`MATCH (r:Recipe {name: $name})-[c:CLAIMS]->(:HardwareUnit) DELETE c`, {
      name: r.name,
    });
  }

  async addTechnique(t: TechniqueNode): Promise<void> {
    const { props, clear } = techniqueProps(t);
    await this.upsertNode({ label: "Technique", name: t.name, props, clear });
    // The page owns its CLAIMS edges outright: drop the old ones so a claim
    // the page stopped making does not outlive it (pass 2 re-adds the rest).
    await this.write(`MATCH (t:Technique {name: $name})-[c:CLAIMS]->(:HardwareUnit) DELETE c`, {
      name: t.name,
    });
  }

  async addPitfall(p: {
    name: string;
    title: string;
    severity: string;
    region: string;
    category: string;
  }): Promise<void> {
    const props = { title: p.title, severity: p.severity, region: p.region, category: p.category };
    await this.setNode("Pitfall", { name: p.name }, props);
  }

  /**
   * Archetype: a game or demo shape from docs/game-design/c64-game-archetypes.md
   * (docs/CONVENTIONS-archetypes.md). Keyed by snake_case name.
   * brief_words is always written, empty when the page has no line, so a
   * page that drops its line stops routing briefs.
   */
  async addArchetype(a: {
    name: string;
    title: string;
    kind: "game" | "demo";
    source_doc: string;
    brief_words?: readonly string[];
    starter?: string;
  }): Promise<void> {
    const props = {
      title: a.title,
      kind: a.kind,
      source_doc: a.source_doc,
      brief_words: [...(a.brief_words ?? [])],
      // null clears a starter line a page stopped carrying.
      starter: a.starter ?? null,
    };
    await this.setNode("Archetype", { name: a.name }, props);
  }

  /**
   * GameDesign (schema 28): a whole game from docs/game-design/designs
   * (docs/CONVENTIONS-game-designs.md). `measured` is the page's Measured
   * frame lines as JSON; a page that drops its region or its measurements
   * clears them.
   */
  async addGameDesign(g: {
    name: string;
    title: string;
    region?: string | undefined;
    measured: readonly object[];
    source_doc: string;
  }): Promise<void> {
    const props = {
      title: g.title,
      source_doc: g.source_doc,
      ...(g.region ? { region: g.region } : {}),
      ...(g.measured.length > 0 ? { measured: JSON.stringify(g.measured) } : {}),
    };
    const clear = [...(g.region ? [] : ["region"]), ...(g.measured.length > 0 ? [] : ["measured"])];
    await this.upsertNode({ label: "GameDesign", name: g.name, props, clear });
  }

  async addCrashPattern(c: {
    symptom: string;
    description: string;
    likely_causes: string[];
    diagnosis_steps: string;
  }): Promise<void> {
    await this.setNode(
      "CrashPattern",
      { symptom: c.symptom },
      {
        description: c.description,
        likely_causes: JSON.stringify(c.likely_causes),
        diagnosis_steps: c.diagnosis_steps,
      },
    );
  }
}
