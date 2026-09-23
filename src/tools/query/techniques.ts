/**
 * Technique tools: one technique with its graph neighbourhood, and the
 * technique index by category, chip, region, register, recipe or
 * prerequisite.
 */

import { z } from "zod";
import { getFalkor, getAnalytics } from "../../context.ts";
import {
  CostBasisSchema,
  type TechniqueCostOutput,
  type TechniqueLookupOutput,
  type TechniquesForOutput,
} from "../../schemas/tool-outputs.ts";
import {
  describeFilter,
  names,
  parseRows,
  searchChunks,
  suggestNames,
  toDocChunk,
  type Chunk,
} from "./shared.ts";
import { CLAIM_MODES } from "../../graph/claims.ts";
import { compressUnits } from "./compatibility/unit-rules.ts";
import type { TechniqueLookupResult, TechniquesForResult } from "./types.ts";

/** A number property, or null when the node has none (or a non-number). */
const OptNumber = z.unknown().transform((v) => (typeof v === "number" ? v : null));

const TechniqueRow = z.object({
  name: z.string(),
  title: z.string().nullable(),
  category: z.string().nullable(),
  complexity: z.string().nullable(),
  chip: z.string().nullable(),
  requires_region: z.string().nullable(),
  cost_cycles_per_line: OptNumber,
  cost_cycles_per_frame: OptNumber,
  cost_lines_active: OptNumber,
  cost_bytes_code: OptNumber,
  cost_bytes_data: OptNumber,
  cost_zp_bytes: OptNumber,
  cost_irq_slots: OptNumber,
  cost_sprites_per_line: OptNumber,
  cost_basis: CostBasisSchema.nullable(),
  raster_band: z.string().nullable(),
  claims_stated: z.string().nullable(),
  claims_basis: z.string().nullable(),
});
type TechniqueRow = z.infer<typeof TechniqueRow>;

const TECHNIQUE_QUERY = `MATCH (t:Technique {name: $name})
     OPTIONAL MATCH (t)-[:BELONGS_TO]->(c:Chip)
     OPTIONAL MATCH (t)-[:REQUIRES_REGION]->(rr:Region)
     RETURN t.name AS name, t.title AS title, t.category AS category,
            t.complexity AS complexity, c.name AS chip, toLower(rr.name) AS requires_region,
            t.cost_cycles_per_line AS cost_cycles_per_line, t.cost_cycles_per_frame AS cost_cycles_per_frame,
            t.cost_lines_active AS cost_lines_active, t.cost_bytes_code AS cost_bytes_code,
            t.cost_bytes_data AS cost_bytes_data, t.cost_zp_bytes AS cost_zp_bytes,
            t.cost_irq_slots AS cost_irq_slots, t.cost_sprites_per_line AS cost_sprites_per_line, t.cost_basis AS cost_basis,
            t.raster_band AS raster_band, t.claims_stated AS claims_stated, t.claims_basis AS claims_basis
     LIMIT 1`;

// Cost figure keys in output order, with the row column each comes from.
const COST_FIGURES = [
  ["cycles_per_line", "cost_cycles_per_line"],
  ["cycles_per_frame", "cost_cycles_per_frame"],
  ["lines_active", "cost_lines_active"],
  ["bytes_code", "cost_bytes_code"],
  ["bytes_data", "cost_bytes_data"],
  ["zp_bytes", "cost_zp_bytes"],
  ["irq_slots", "cost_irq_slots"],
  ["sprites_per_line", "cost_sprites_per_line"],
] as const;

/**
 * Cost model (schema 22): only the keys the page's **Cost:** line carried
 * are present, and the object is absent when the page has no line.
 */
function costOf(row: TechniqueRow): TechniqueCostOutput | undefined {
  if (!row.cost_basis) return undefined;
  const figures: Omit<TechniqueCostOutput, "basis"> = {};
  for (const [key, column] of COST_FIGURES) {
    const v = row[column];
    if (v !== null) figures[key] = v;
  }
  // basis last, as the output has always ordered it.
  return { ...figures, basis: row.cost_basis };
}

async function techniqueNotFound(name: string): Promise<TechniqueLookupResult> {
  const f = await getFalkor();
  const all = names(await f.roQuery(`MATCH (t:Technique) RETURN t.name AS name ORDER BY t.name`));
  const suggestions = suggestNames(name, all, "_");

  getAnalytics().logQuery({ tool: "c64_technique_lookup", query: name, resultCount: 0 });

  const empty: TechniqueLookupOutput = {
    name: "",
    title: "",
    category: "",
    complexity: "",
    uses_registers: [],
    uses_kernal: [],
    recipes: [],
    requires: [],
    required_by: [],
    mitigates: [],
    documentation: [],
  };
  const text =
    `Technique \`${name}\` not found.` +
    (suggestions.length > 0 ? `\n\nDid you mean: ${suggestions.join(", ")}?` : "") +
    `\n\nList all techniques with \`c64-kb techniques-for\` (no filter).`;
  return { structured: empty, text };
}

const AddressedRow = z.object({ name: z.string(), address: z.string().nullable() });
const RecipeRefRow = z.object({ name: z.string(), toolchain: z.string() });
const TechniqueRefRow = z.object({ name: z.string(), title: z.string().nullable() });
const PitfallRefRow = z.object({
  name: z.string(),
  title: z.string().nullable(),
  severity: z.string().nullable(),
});

type Neighbourhood = Pick<
  TechniqueLookupOutput,
  "uses_registers" | "uses_kernal" | "recipes" | "requires" | "required_by" | "mitigates"
>;

/** The technique's edges: USES, IMPLEMENTS (reverse), REQUIRES both ways, MITIGATED_BY (reverse). */
async function neighbourhoodOf(name: string): Promise<Neighbourhood> {
  const f = await getFalkor();
  const q = (cypher: string) => f.roQuery(cypher, { name });
  const [regs, kernal, recipes, requires, requiredBy, mitigates] = await Promise.all([
    q(`MATCH (t:Technique {name: $name})-[:USES]->(r:Register)
       RETURN r.name AS name, r.address AS address`),
    q(`MATCH (t:Technique {name: $name})-[:USES]->(k:KernalRoutine)
       RETURN k.name AS name, k.address AS address`),
    q(`MATCH (t:Technique {name: $name})<-[:IMPLEMENTS]-(r:Recipe)
       RETURN r.name AS name, r.toolchain AS toolchain`),
    // REQUIRES → techniques that must be set up before, or run underneath, this one
    q(`MATCH (t:Technique {name: $name})-[:REQUIRES]->(p:Technique)
       RETURN p.name AS name, p.title AS title ORDER BY p.name`),
    // REQUIRES (reverse) → techniques that presuppose this one
    q(`MATCH (t:Technique {name: $name})<-[:REQUIRES]-(d:Technique)
       RETURN d.name AS name, d.title AS title ORDER BY d.name`),
    // MITIGATED_BY (reverse) → pitfalls whose Fix is this technique
    q(`MATCH (t:Technique {name: $name})<-[:MITIGATED_BY]-(p:Pitfall)
       RETURN p.name AS name, p.title AS title, p.severity AS severity ORDER BY p.name`),
  ]);
  const addressed = (r: z.infer<typeof AddressedRow>) => ({ name: r.name, address: r.address ?? "" });
  const ref = (r: z.infer<typeof TechniqueRefRow>) => ({ name: r.name, title: r.title ?? "" });
  return {
    uses_registers: parseRows(AddressedRow, regs).map(addressed),
    uses_kernal: parseRows(AddressedRow, kernal).map(addressed),
    recipes: parseRows(RecipeRefRow, recipes),
    requires: parseRows(TechniqueRefRow, requires).map(ref),
    required_by: parseRows(TechniqueRefRow, requiredBy).map(ref),
    mitigates: parseRows(PitfallRefRow, mitigates).map((p) => ({
      name: p.name,
      title: p.title ?? "",
      severity: p.severity ?? "",
    })),
  };
}

const ClaimRow = z.object({
  unit: z.string(),
  mode: z.enum(CLAIM_MODES),
  ranges: z.string().nullable(),
  relocatable: z.boolean().nullable(),
});

type ClaimsPart = Pick<TechniqueLookupOutput, "claims" | "claims_stated" | "claims_basis">;

/** CLAIMS → HardwareUnits (schema 25). No Claims line reads as "unknown", never as "none". */
async function claimsOf(row: TechniqueRow): Promise<ClaimsPart> {
  const f = await getFalkor();
  const rows = parseRows(
    ClaimRow,
    await f.roQuery(
      `MATCH (t:Technique {name: $name})-[c:CLAIMS]->(h:HardwareUnit)
       RETURN h.name AS unit, c.mode AS mode, c.ranges AS ranges, c.relocatable AS relocatable ORDER BY h.name`,
      { name: row.name },
    ),
  );
  const claims = rows.map((c) => ({
    unit: c.unit,
    mode: c.mode,
    ...(c.ranges ? { ranges: c.ranges } : {}),
    ...(c.relocatable ? { relocatable: true } : {}),
  }));
  const stated =
    row.claims_stated === "stated" || row.claims_stated === "none" ? row.claims_stated : "unknown";
  return { claims, claims_stated: stated, ...(row.claims_basis ? { claims_basis: row.claims_basis } : {}) };
}

/** The Claims line as the page would write it, runs of units compressed (sprite_0-7). */
function renderClaims(t: TechniqueLookupOutput): string {
  if (t.claims_stated === undefined || t.claims_stated === "unknown") {
    return `**Claims:** unknown (the page states no unit claims; a unit conflict with it cannot be ruled out)\n`;
  }
  if (t.claims_stated === "none") return `**Claims:** none\n**Claims basis:** ${t.claims_basis ?? ""}\n`;
  const byMode = new Map<string, string[]>();
  const items: string[] = [];
  for (const c of t.claims ?? []) {
    if (c.ranges) {
      const bytes = `$${c.ranges.replace(/,/g, "+$").replace(/-/g, "-$")}`;
      items.push(`${c.unit} ${bytes} (${c.mode}${c.relocatable ? ", relocatable" : ""})`);
    } else byMode.set(c.mode, [...(byMode.get(c.mode) ?? []), c.unit]);
  }
  for (const [mode, units] of byMode) for (const u of compressUnits(units)) items.push(`${u} (${mode})`);
  return `**Claims:** ${items.join(", ")}\n**Claims basis:** ${t.claims_basis ?? ""}\n`;
}

export async function techniqueLookup(name: string): Promise<TechniqueLookupResult> {
  const f = await getFalkor();
  const row = parseRows(TechniqueRow, await f.roQuery(TECHNIQUE_QUERY, { name })).at(0);
  if (!row) return techniqueNotFound(name);

  const cost = costOf(row);
  const edges = await neighbourhoodOf(name);
  const claims = await claimsOf(row);

  // Documentation chunks from Qdrant
  const { chunks: ctx } = await searchChunks({ query: `${name} ${row.title ?? ""}`.trim(), limit: 3 });
  const documentation = ctx.map(toDocChunk);

  getAnalytics().logQuery({ tool: "c64_technique_lookup", query: name, resultCount: 1 });

  const structured: TechniqueLookupOutput = {
    name: row.name,
    title: row.title ?? "",
    category: row.category ?? "",
    complexity: row.complexity ?? "",
    chip: row.chip ?? undefined,
    requires_region: row.requires_region ?? undefined,
    ...(row.raster_band ? { raster_band: row.raster_band } : {}),
    ...edges,
    documentation,
    ...(cost ? { cost } : {}),
    ...claims,
  };
  return { structured, text: renderTechnique(structured, cost, documentation) };
}

function renderTechniqueHeader(t: TechniqueLookupOutput, cost: TechniqueCostOutput | undefined): string {
  let out = `# Technique: ${t.name} — ${t.title}\n\n`;
  out += `**Category:** ${t.category}\n`;
  out += `**Complexity:** ${t.complexity || "(not set)"}\n`;
  if (t.chip) out += `**Chip:** ${t.chip}\n`;
  if (t.requires_region) out += `**Requires region:** ${t.requires_region}\n`;
  if (t.raster_band) out += `**Raster band:** ${t.raster_band}\n`;
  if (cost) {
    const { basis, ...figures } = cost;
    out += `**Cost:** ${Object.entries(figures)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ")}\n`;
    out += `**Cost basis:** ${basis}\n`;
  }
  return out + renderClaims(t) + `\n`;
}

function renderTechnique(
  t: TechniqueLookupOutput,
  cost: TechniqueCostOutput | undefined,
  documentation: Chunk[],
): string {
  let out = renderTechniqueHeader(t, cost);
  const line = (label: string, items: string[]) => {
    if (items.length > 0) out += `**${label}:** ${items.join(", ")}\n`;
  };
  line(
    "Uses registers",
    t.uses_registers.map((r) => r.name),
  );
  line(
    "Uses KERNAL",
    t.uses_kernal.map((k) => k.name),
  );
  line(
    "Requires",
    (t.requires ?? []).map((r) => r.name),
  );
  line(
    "Required by",
    (t.required_by ?? []).map((r) => r.name),
  );
  line(
    "Mitigates",
    (t.mitigates ?? []).map((m) => `${m.name} (${m.severity})`),
  );
  if (t.recipes.length > 0) {
    out += `\n## Recipes\n\n`;
    for (const r of t.recipes) out += `- \`${r.name}\` (${r.toolchain})\n`;
  }
  if (documentation.length > 0) {
    out += `\n## Documentation\n\n`;
    for (const d of documentation) out += `### ${d.source} > ${d.section}\n${d.text}\n\n---\n\n`;
  }
  return out;
}

export interface TechniquesFilter {
  category?: string | undefined;
  chip?: string | undefined;
  region?: string | undefined;
  register?: string | undefined;
  recipe?: string | undefined;
  requires?: string | undefined;
  claims?: string | undefined;
}

// Pattern fragment each filter key adds after `MATCH (t:Technique)`, in order.
const TECHNIQUE_FILTER_PATTERNS: readonly [keyof TechniquesFilter, string][] = [
  ["chip", ` -[:BELONGS_TO]-> (ch:Chip {name: $chip})`],
  // "What builds on X": techniques whose REQUIRES chain reaches X, directly
  // or through other techniques (ifli_image -> fli_image -> stable_raster_irq),
  // up to twelve edges deep (the longest authored chain is two). Variants
  // are not unified: double_irq has no edge to stable_raster_irq.
  ["requires", ` , (t)-[:REQUIRES*1..12]->(req:Technique {name: $requires})`],
  ["region", ` , (t)-[:REQUIRES_REGION]->(reg:Region {name: $region})`],
  ["register", ` , (t)-[:USES]->(rg:Register {name: $register})`],
  ["recipe", ` , (rec:Recipe {name: $recipe})-[:IMPLEMENTS]->(t)`],
  // "Who claims sid_voice_3": a CLAIMS edge to that HardwareUnit, any mode.
  ["claims", ` , (t)-[:CLAIMS]->(hu:HardwareUnit {name: $claims})`],
];

function techniquesForCypher(filter: TechniquesFilter): { cypher: string; params: Record<string, string> } {
  const params: Record<string, string> = {};
  let cypher = `MATCH (t:Technique)`;
  for (const [key, pattern] of TECHNIQUE_FILTER_PATTERNS) {
    const value = filter[key];
    if (!value) continue;
    cypher += pattern;
    params[key] = value;
  }
  if (filter.category) {
    cypher += ` WHERE t.category = $category`;
    params.category = filter.category;
  }
  cypher += ` RETURN DISTINCT t.name AS name, t.title AS title, t.category AS category, t.complexity AS complexity ORDER BY t.category, t.name`;
  return { cypher, params };
}

const TechniqueListRow = TechniqueRow.pick({ name: true, title: true, category: true, complexity: true });

export async function techniquesFor(filter: TechniquesFilter): Promise<TechniquesForResult> {
  const f = await getFalkor();
  const { cypher, params } = techniquesForCypher(filter);
  const techniques = parseRows(TechniqueListRow, await f.roQuery(cypher, params)).map((r) => ({
    name: r.name,
    title: r.title ?? "",
    category: r.category ?? "",
    complexity: r.complexity ?? "",
  }));

  getAnalytics().logQuery({
    tool: "c64_techniques_for",
    query: JSON.stringify(filter),
    resultCount: techniques.length,
  });

  const structured: TechniquesForOutput = { filter, techniques };

  let out = `# Techniques`;
  const flt = describeFilter({ ...filter });
  if (flt) out += ` (filter: ${flt})`;
  out += `\n\n`;
  if (techniques.length === 0) {
    out += `No techniques match. Try a broader filter or no filter at all.`;
  } else {
    out += `| Name | Title | Category | Complexity |\n|------|-------|----------|------------|\n`;
    for (const t of techniques) {
      out += `| ${t.name} | ${t.title} | ${t.category} | ${t.complexity} |\n`;
    }
  }
  return { structured, text: out };
}
