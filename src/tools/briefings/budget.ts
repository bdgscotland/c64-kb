/**
 * The plan added up (schema 22, tools 1.25.0): the proposed set's cycles
 * and bytes against a frame and a RAM budget, and the text that shows it.
 *
 * Since schema 27 (tools 1.32.0) the arithmetic is planBudget
 * (src/domain/budget.ts), the same rules c64_plan_budget applies, with every
 * proposed technique in one play frame. Before, this summed every
 * cycles_per_frame: a 74,041-cycle full-screen shift counted as a per-frame
 * cost, a missing figure counted as zero, and work one figure already held
 * counted twice (design 2.1 measured errors from -96 % to about 10× over).
 */

import { planBudget, type BudgetCost, type BudgetMember, type PhaseBudget } from "../../domain/budget.ts";
import type { BriefingOutput } from "../../schemas/tool-outputs.ts";

type Budget = BriefingOutput["budget"];
type Contributor = Budget["contributors"][number];
type Region = "PAL" | "NTSC";

// PAL: 63 cycles × 312 lines; NTSC: 65 × 263. The same constants
// c64_timing_budget uses.
export const FRAME_CYCLES = { PAL: 19656, NTSC: 17095 } as const;
// The RAM budget the byte sum is judged against: $0801 to $9FFF, the BASIC
// program area a PRG loads into with the ROMs in place (0x9FFF - 0x0801 + 1
// = 38,911 bytes, the figure the boot banner prints). It is an assumption,
// stated in the output; a program that banks BASIC out or loads under the
// KERNAL has more, and the caller can re-judge the sum against its own map.
export const RAM_BUDGET_BYTES = 38911;

/** One proposed technique as the briefing knows it; the planner's member without a phase. */
export type BudgetInput = Omit<BudgetMember, "phase" | "found" | "cost"> & {
  found?: boolean | undefined;
  cost?: BudgetCost | undefined;
};

function regionNote(regionHint: Region | undefined, members: BudgetInput[]): string {
  if (regionHint) return "";
  const locked = members.some((m) => /^(pal|ntsc)$/i.test(m.requires_region ?? ""));
  return locked
    ? " (chosen from the set's REQUIRES_REGION edges)"
    : " (no technique in the set is region-locked; PAL assumed)";
}

function contributorsOf(
  members: BudgetInput[],
  phase: PhaseBudget,
  bytes: Map<string, number>,
): Contributor[] {
  const summed = new Map(phase.contributors.map((c) => [c.name, c]));
  const out: Contributor[] = [];
  for (const m of members) {
    if (!m.cost) continue;
    const c = summed.get(m.name);
    const b = bytes.get(m.name);
    out.push({
      name: m.name,
      ...(c ? { cycles_per_frame: c.high } : {}),
      ...(c && c.low !== c.high ? { cycles_per_frame_typical: c.low } : {}),
      ...(b !== undefined ? { bytes: b } : {}),
      basis: m.cost.basis,
      ...(m.cost.measured_on ? { measured_on: m.cost.measured_on } : {}),
    });
  }
  return out;
}

function cyclesVerdict(p: PhaseBudget): Budget["cycles_verdict"] {
  if (p.contributors.length === 0 && p.excluded.length === 0 && p.unknown.length === 0) return "no_data";
  if (p.verdict === "fits") return "under";
  return p.verdict;
}

function assumptionsFor(region: Region, note: string, p: PhaseBudget, withoutCost: number): string[] {
  const out = [
    `Region ${region}: ${FRAME_CYCLES[region]} cycles per frame${note}.`,
    `RAM budget ${RAM_BUDGET_BYTES} bytes: the BASIC program area $0801-$9FFF with the ROMs in place. Re-judge the byte sum against your own memory map if you bank BASIC out or load under the KERNAL.`,
    "This adds up a proposal, every technique in one play frame. c64_plan_budget takes your own list with phases (play, transition, init) and shows each rule it applied.",
    "Each technique's figures are what its own page states, measured on the recipe it names; bytes are that recipe's segments, not a minimal implementation.",
    ...p.notes,
  ];
  if (withoutCost > 0) out.push(`${withoutCost} proposed technique(s) have no Cost line.`);
  return out;
}

/**
 * Add a proposed set up against a frame and a RAM budget. Pure, so a test
 * can hand it a fixture. The region is PAL unless every region-locked
 * technique in the set is NTSC-locked; the choice is written into
 * `assumptions`.
 */
export function computeBudget(techs: BudgetInput[], regionHint?: Region): Budget {
  const members: BudgetMember[] = techs.map((t) => ({ ...t, found: t.found ?? true, phase: "play" }));
  const plan = planBudget(members, regionHint ? { region: regionHint } : {});
  const phase = plan.phases.at(0);
  const region: Region = phase?.region ?? regionHint ?? "PAL";
  const frame_cycles = FRAME_CYCLES[region];
  const bytes = new Map(plan.bytes.contributors.map((c) => [c.name, c.bytes]));
  const without_cost = techs.filter((t) => !t.cost).map((t) => t.name);
  const empty: PhaseBudget = {
    phase: "play",
    region,
    frame: frame_cycles,
    members: [],
    contributors: [],
    excluded: [],
    unknown: [],
    not_found: [],
    to_measure: [],
    fixed_losses: { badlines: 0, sprite_dma: 0, charged_for: [] },
    worst_only: [],
    low: 0,
    high: 0,
    verdict: "undetermined",
    weakest_basis: null,
    irq_slots: 0,
    notes: [],
  };
  const p = phase ?? empty;
  return {
    region,
    frame_cycles,
    cycles_per_frame_sum: p.high,
    cycles_low: p.low,
    fixed_loss_cycles: p.fixed_losses.badlines + p.fixed_losses.sprite_dma,
    cycles_verdict: cyclesVerdict(p),
    ram_budget_bytes: RAM_BUDGET_BYTES,
    bytes_sum: plan.bytes.sum,
    bytes_verdict:
      plan.bytes.contributors.length === 0 ? "no_data" : plan.bytes.sum > RAM_BUDGET_BYTES ? "over" : "under",
    contributors: contributorsOf(techs, p, bytes),
    excluded: [
      ...p.excluded.map((e) => ({ name: e.name, reason: e.reason, ...(e.by ? { by: e.by } : {}) })),
      ...plan.bytes.excluded.map((e) => ({ name: e.name, reason: "whole_program_bytes" as const })),
    ],
    unknown: p.unknown,
    to_measure: p.to_measure.map((m) => ({ technique: m.technique, recipe: m.recipe })),
    without_cost,
    weakest_basis: p.weakest_basis,
    is_floor: p.unknown.length > 0,
    assumptions: assumptionsFor(region, regionNote(regionHint, techs), p, without_cost.length),
  };
}

function verdictCell(v: Budget["cycles_verdict"]): string {
  if (v === "no_data") return "no data";
  return v === "undetermined" ? "undetermined" : `${v} budget`;
}

function cyclesCell(g: Budget): string {
  const range =
    g.cycles_low === g.cycles_per_frame_sum
      ? `${g.cycles_per_frame_sum}`
      : `${g.cycles_low}-${g.cycles_per_frame_sum}`;
  return g.fixed_loss_cycles > 0 ? `${range} + ${g.fixed_loss_cycles} badlines` : range;
}

function excludedText(e: Budget["excluded"][number]): string {
  if (e.reason === "multi_frame") return `${e.name} (above one frame: a multi-frame operation)`;
  if (e.reason === "whole_program_bytes") return `${e.name} bytes (the whole program, not the technique)`;
  return `${e.name} (${e.reason === "included_by" ? "inside" : "in the raster band of"} ${e.by ?? "?"})`;
}

function contributorText(c: Contributor): string {
  const parts: string[] = [];
  if (c.cycles_per_frame !== undefined) {
    const typical = c.cycles_per_frame_typical !== undefined ? `${c.cycles_per_frame_typical}-` : "";
    parts.push(`${typical}${c.cycles_per_frame} cycles/frame`);
  }
  if (c.bytes !== undefined) parts.push(`${c.bytes} bytes`);
  const on = c.measured_on ? `, on ${c.measured_on}` : "";
  return `- ${c.name}: ${parts.join(", ") || "(no summable figure)"} (${c.basis}${on})\n`;
}

export function renderBudgetText(g: Budget): string {
  let out = `\n## Budget (${g.region})\n\n`;
  out += `| Sum | Value | Limit | Verdict |\n|-----|-------|-------|---------|\n`;
  out += `| Cycles per frame | ${cyclesCell(g)} | ${g.frame_cycles} | ${verdictCell(g.cycles_verdict)} |\n`;
  out += `| Bytes (code + data) | ${g.bytes_sum} | ${g.ram_budget_bytes} | ${verdictCell(g.bytes_verdict)} |\n`;
  if (g.contributors.length > 0) {
    out += `\nContributors:\n`;
    for (const c of g.contributors) out += contributorText(c);
  }
  if (g.excluded.length > 0) out += `\nLeft out: ${g.excluded.map(excludedText).join("; ")}.\n`;
  out += `\nWeakest basis: ${g.weakest_basis ?? "(nothing contributed)"}.\n`;
  if (g.unknown.length > 0) {
    out += `Unknown, not zero, so the verdict cannot be under: ${g.unknown.join(", ")}.\n`;
  }
  if (g.without_cost.length > 0) out += `No Cost line: ${g.without_cost.join(", ")}.\n`;
  for (const a of g.assumptions) out += `- ${a}\n`;
  return out;
}
