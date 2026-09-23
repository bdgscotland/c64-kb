/**
 * c64_plan_budget: read the named techniques' Cost lines, bands, REQUIRES
 * closures and implementing recipes from the graph, hand them to the pure
 * planBudget (src/domain/budget.ts), and render the result.
 */

import { z } from "zod";
import { getFalkor, getAnalytics } from "../../context.ts";
import {
  BUDGET_PHASES,
  followIncludes,
  planBudget,
  type BudgetMember,
  type BudgetOptions,
  type BudgetPhase,
  type PhaseBudget,
} from "../../domain/budget.ts";
import { CostBasisSchema, type PlanBudgetOutput } from "../../schemas/tool-outputs.ts";
import { parseRows } from "./shared.ts";

export interface PlanBudgetResult {
  structured: PlanBudgetOutput;
  text: string;
}

const OptNumber = z.unknown().transform((v) => (typeof v === "number" ? v : undefined));
const OptString = z.unknown().transform((v) => (typeof v === "string" && v !== "" ? v : undefined));
const StringList = z
  .unknown()
  .transform((v) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : [],
  );

const MemberRow = z.object({
  name: z.string(),
  requires_region: OptString,
  raster_band: OptString,
  cycles_per_frame: OptNumber,
  cycles_per_frame_typical: OptNumber,
  cycles_per_line: OptNumber,
  lines_active: OptNumber,
  bytes_code: OptNumber,
  bytes_data: OptNumber,
  irq_slots: OptNumber,
  basis: CostBasisSchema.nullable(),
  measured_on: OptString,
  conditions: OptString,
  includes: StringList,
  closure: StringList,
  recipes: StringList,
});
type MemberRow = z.infer<typeof MemberRow>;

const MEMBERS_QUERY = `MATCH (t:Technique) WHERE t.name IN $names
  OPTIONAL MATCH (t)-[:REQUIRES_REGION]->(rr:Region)
  OPTIONAL MATCH (t)-[:REQUIRES*1..12]->(p:Technique)
  WITH t, rr, collect(DISTINCT p.name) AS closure
  OPTIONAL MATCH (r:Recipe)-[:IMPLEMENTS]->(t)
  RETURN t.name AS name, toLower(rr.name) AS requires_region, t.raster_band AS raster_band,
         t.cost_cycles_per_frame AS cycles_per_frame, t.cost_cycles_per_frame_typical AS cycles_per_frame_typical,
         t.cost_cycles_per_line AS cycles_per_line, t.cost_lines_active AS lines_active,
         t.cost_bytes_code AS bytes_code, t.cost_bytes_data AS bytes_data, t.cost_irq_slots AS irq_slots,
         t.cost_basis AS basis, t.cost_recipe AS measured_on, t.cost_conditions AS conditions,
         t.cost_includes AS includes, closure, collect(DISTINCT r.name) AS recipes`;

// Every Cost includes line in the graph, so an include is followed through
// a technique that is not in the set (a includes b, b includes c: a holds c).
const INCLUDES_QUERY = `MATCH (t:Technique) WHERE t.cost_includes IS NOT NULL
  RETURN t.name AS name, t.cost_includes AS includes`;
const IncludesRow = z.object({ name: z.string(), includes: StringList });

/** "name" or "name:phase"; a phase outside play, transition, init is refused. */
export function parseMemberSpec(spec: string): { name: string; phase: BudgetPhase } | { error: string } {
  const [rawName = "", rawPhase, ...rest] = spec.trim().split(":");
  const name = rawName.trim();
  if (name === "" || rest.length > 0) return { error: `"${spec}" is not "name" or "name:phase"` };
  if (rawPhase === undefined) return { name, phase: "play" };
  const phase = BUDGET_PHASES.find((p) => p === rawPhase.trim().toLowerCase());
  return phase ? { name, phase } : { error: `phase "${rawPhase}" is not one of ${BUDGET_PHASES.join(", ")}` };
}

function memberOf(name: string, phase: BudgetPhase, row: MemberRow | undefined): BudgetMember {
  if (!row) return { name, phase, found: false };
  return {
    name,
    phase,
    found: true,
    requires_region: row.requires_region,
    raster_band: row.raster_band,
    requires_closure: row.closure,
    recipes: [...row.recipes].sort(),
    ...(row.basis
      ? {
          cost: {
            cycles_per_frame: row.cycles_per_frame,
            cycles_per_frame_typical: row.cycles_per_frame_typical,
            cycles_per_line: row.cycles_per_line,
            lines_active: row.lines_active,
            bytes_code: row.bytes_code,
            bytes_data: row.bytes_data,
            irq_slots: row.irq_slots,
            basis: row.basis,
            measured_on: row.measured_on,
            conditions: row.conditions,
            includes: row.includes,
          },
        }
      : {}),
  };
}

/** Graph rows for the named techniques, as planBudget members in the order asked. */
export async function fetchBudgetMembers(
  specs: { name: string; phase: BudgetPhase }[],
): Promise<BudgetMember[]> {
  const f = await getFalkor();
  const names = [...new Set(specs.map((s) => s.name))];
  const rows = parseRows(MemberRow, await f.roQuery(MEMBERS_QUERY, { names }));
  const direct = new Map(
    parseRows(IncludesRow, await f.roQuery(INCLUDES_QUERY, {})).map((r) => [r.name, r.includes]),
  );
  const byName = new Map(
    rows.map((r) => [r.name, { ...r, includes: followIncludes(r.name, (n) => direct.get(n) ?? []) }]),
  );
  return specs.map((s) => memberOf(s.name, s.phase, byName.get(s.name)));
}

function rangeText(p: PhaseBudget): string {
  const fixed = p.fixed_losses.badlines + p.fixed_losses.sprite_dma;
  const range = p.low === p.high ? `${p.high}` : `${p.low}-${p.high}`;
  return `${fixed > 0 ? `${range} + ${fixed} fixed` : range} cycles; floor ${p.floor}`;
}

function contributorLine(c: PhaseBudget["contributors"][number]): string {
  const figure = c.low === c.high ? `${c.high}` : `${c.low}-${c.high}`;
  const on = c.measured_on
    ? `, on ${c.measured_on}${c.conditions ? ` (${c.conditions})` : ""}`
    : ", recipe not stated";
  const how =
    c.charge === "band" ? ", band lines × line" : c.charge === "per_line" ? ", per line × lines" : "";
  return `- ${c.name}: ${figure} (${c.basis}${on}${how})\n`;
}

function excludedLine(e: PhaseBudget["excluded"][number]): string {
  if (e.reason === "multi_frame")
    return `- ${e.name}: ${e.cycles} cycles, above one frame: a multi-frame operation, not summed${e.measured_on ? ` (measured on ${e.measured_on})` : ""}\n`;
  const why =
    e.reason === "included_by"
      ? `inside ${e.by}'s figure (Cost includes)`
      : `runs inside ${e.by}'s raster band`;
  return `- ${e.name}: not added, ${why}\n`;
}

function renderPhase(p: PhaseBudget): string {
  let out = `\n## ${p.phase} (${p.region}, ${p.frame} cycles a frame): ${p.verdict}\n\n`;
  out += `Range ${rangeText(p)}; weakest basis ${p.weakest_basis ?? "(nothing summed)"}; IRQ slots ${p.irq_slots}.\n`;
  if (p.contributors.length > 0) out += `\nSummed:\n${p.contributors.map(contributorLine).join("")}`;
  if (p.excluded.length > 0) out += `\nLeft out:\n${p.excluded.map(excludedLine).join("")}`;
  if (p.to_measure.length > 0) {
    out += `\nTo measure:\n`;
    for (const m of p.to_measure)
      out += `- ${m.technique}: ${m.why}; ${m.recipe ? `measure it on ${m.recipe}` : "no recipe yet"}\n`;
  }
  if (p.not_found.length > 0) out += `\nNo such technique: ${p.not_found.join(", ")}.\n`;
  if (p.notes.length > 0) out += `\nNotes:\n${p.notes.map((n) => `- ${n}\n`).join("")}`;
  return out;
}

function bytesLine(bytes: PlanBudgetOutput["bytes"]): string {
  const inside =
    bytes.inside.length > 0
      ? ` Not added, inside another member's code: ${bytes.inside.map((i) => `${i.name} (${i.by})`).join(", ")}.`
      : "";
  if (bytes.contributors.length === 0) return `No member states a byte figure that can be summed.${inside}`;
  const floor =
    bytes.without_bytes.length > 0 ? `; a floor, since ${bytes.without_bytes.join(", ")} state no bytes` : "";
  return `Sum ${bytes.sum} over ${bytes.contributors.map((c) => c.name).join(", ")}${floor}.${inside}`;
}

function renderPlan(b: PlanBudgetOutput): string {
  let out = `# Budget plan: ${b.verdict}\n\nTechniques: ${b.techniques.join(", ") || "(none)"}\n`;
  for (const r of b.refused) out += `- Refused "${r.input}": ${r.why}\n`;
  for (const p of b.phases) out += renderPhase(p);
  out += `\n## Bytes\n\n${bytesLine(b.bytes)}\n`;
  for (const e of b.bytes.excluded)
    out += `- ${e.name}: ${e.bytes} bytes left out, the whole program, not the technique\n`;
  out += `\n## Assumptions\n\n`;
  for (const a of b.assumptions) out += `- ${a}\n`;
  return out;
}

/** The region words the tool accepts, any case. */
export const BUDGET_REGION = /^\s*(pal|ntsc|both)\s*$/i;

/** 'pal', 'NTSC', 'both' to the planner's words; none is the planner's default; anything else is refused. */
export function budgetRegion(region: string | undefined): "PAL" | "NTSC" | "both" | undefined {
  if (region === undefined) return undefined;
  const r = region.trim().toUpperCase();
  if (r === "PAL" || r === "NTSC") return r;
  if (r === "BOTH") return "both";
  throw new Error(`region "${region}" is not pal, ntsc or both`);
}

/** Parse every spec; a malformed one, or a name already listed in the same phase, is refused with the reason. */
export function parseMemberSpecs(inputs: string[]): {
  specs: { name: string; phase: BudgetPhase }[];
  refused: PlanBudgetOutput["refused"];
} {
  const refused: PlanBudgetOutput["refused"] = [];
  const specs: { name: string; phase: BudgetPhase }[] = [];
  const listed = new Set<string>();
  for (const t of inputs) {
    const parsed = parseMemberSpec(t);
    if ("error" in parsed) {
      refused.push({ input: t, why: parsed.error });
      continue;
    }
    const key = `${parsed.name}:${parsed.phase}`;
    if (listed.has(key)) {
      refused.push({ input: t, why: `${parsed.name} is already listed in ${parsed.phase}; counted once` });
      continue;
    }
    listed.add(key);
    specs.push(parsed);
  }
  return { specs, refused };
}

export interface PlanBudgetRequest extends BudgetOptions {
  techniques: string[];
}

export async function planBudgetTool(req: PlanBudgetRequest): Promise<PlanBudgetResult> {
  const { specs, refused } = parseMemberSpecs(req.techniques);
  const members = await fetchBudgetMembers(specs);
  const plan = planBudget(members, req);
  const structured: PlanBudgetOutput = {
    techniques: specs.map((s) => (s.phase === "play" ? s.name : `${s.name}:${s.phase}`)),
    refused,
    ...plan,
  };
  getAnalytics().logQuery({
    tool: "c64_plan_budget",
    query: req.techniques.join(","),
    resultCount: members.length,
  });
  return { structured, text: renderPlan(structured) };
}
