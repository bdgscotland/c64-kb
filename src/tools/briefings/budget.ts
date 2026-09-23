/**
 * The plan added up (schema 22, tools 1.25.0): the proposed set's cycles
 * and bytes against a frame and a RAM budget, and the text that shows it.
 */

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
type BriefingCostBasis = NonNullable<Budget["weakest_basis"]>;
// Strongest first. The weakest contributor sets the confidence of the sum.
const BASIS_STRENGTH: readonly BriefingCostBasis[] = [
  "measured-vice",
  "derived-listing",
  "arithmetic",
  "estimated",
];

export type BudgetInput = {
  name: string;
  requires_region?: string | undefined;
  cost?:
    | {
        cycles_per_frame?: number | undefined;
        bytes_code?: number | undefined;
        bytes_data?: number | undefined;
        basis: BriefingCostBasis;
      }
    | undefined;
};

/** Region-locked techniques in the set, as "PAL" / "NTSC". */
function lockedRegions(techs: BudgetInput[]): string[] {
  return techs.map((t) => (t.requires_region ?? "").toUpperCase()).filter((r) => r === "PAL" || r === "NTSC");
}

function contributorOf(name: string, cost: NonNullable<BudgetInput["cost"]>): Contributor {
  const hasBytes = cost.bytes_code !== undefined || cost.bytes_data !== undefined;
  const bytes = hasBytes ? (cost.bytes_code ?? 0) + (cost.bytes_data ?? 0) : undefined;
  return {
    name,
    ...(typeof cost.cycles_per_frame === "number" ? { cycles_per_frame: cost.cycles_per_frame } : {}),
    ...(typeof bytes === "number" ? { bytes } : {}),
    basis: cost.basis,
  };
}

function weakestBasis(contributors: Contributor[]): BriefingCostBasis | null {
  let weakest: BriefingCostBasis | null = null;
  for (const c of contributors) {
    if (weakest === null || BASIS_STRENGTH.indexOf(c.basis) > BASIS_STRENGTH.indexOf(weakest)) {
      weakest = c.basis;
    }
  }
  return weakest;
}

/** Sum a figure over the contributors that have it; `seen` is false when none do. */
function sumOf(contributors: Contributor[], pick: (c: Contributor) => number | undefined) {
  let sum = 0;
  let seen = false;
  for (const c of contributors) {
    const v = pick(c);
    if (typeof v === "number") {
      sum += v;
      seen = true;
    }
  }
  return { sum, seen };
}

function verdict(seen: boolean, sum: number, limit: number): Budget["cycles_verdict"] {
  if (!seen) return "no_data";
  return sum > limit ? "over" : "under";
}

function regionNote(regionHint: Region | undefined, lockedCount: number): string {
  if (regionHint) return "";
  if (lockedCount > 0) return " (chosen from the set's REQUIRES_REGION edges)";
  return " (no technique in the set is region-locked; PAL assumed)";
}

function assumptionsFor(region: Region, note: string, withoutCostCount: number): string[] {
  return [
    `Region ${region}: ${FRAME_CYCLES[region]} cycles per frame${note}.`,
    `RAM budget ${RAM_BUDGET_BYTES} bytes: the BASIC program area $0801-$9FFF with the ROMs in place. Re-judge the byte sum against your own memory map if you bank BASIC out or load under the KERNAL.`,
    "Each technique's figures are what its own page states; cycles_per_frame is per PAL frame unless that page says otherwise, and bytes are the built recipe's segments, not a minimal implementation.",
    ...(withoutCostCount > 0
      ? [`${withoutCostCount} proposed technique(s) have no Cost line, so both sums are floors.`]
      : []),
  ];
}

/**
 * Add a proposed set up against a frame and a RAM budget. Pure, so a test
 * can hand it a fixture. The region is PAL unless every region-locked
 * technique in the set is NTSC-locked; the choice is written into
 * `assumptions`. Both sums are floors when any technique lacks a Cost line.
 */
export function computeBudget(techs: BudgetInput[], regionHint?: Region): Budget {
  const locked = lockedRegions(techs);
  const region: Region =
    regionHint ?? (locked.length > 0 && locked.every((r) => r === "NTSC") ? "NTSC" : "PAL");
  const frame_cycles = FRAME_CYCLES[region];

  const contributors: Contributor[] = [];
  const without_cost: string[] = [];
  for (const t of techs) {
    if (t.cost) contributors.push(contributorOf(t.name, t.cost));
    else without_cost.push(t.name);
  }
  const cycles = sumOf(contributors, (c) => c.cycles_per_frame);
  const bytes = sumOf(contributors, (c) => c.bytes);
  return {
    region,
    frame_cycles,
    cycles_per_frame_sum: cycles.sum,
    cycles_verdict: verdict(cycles.seen, cycles.sum, frame_cycles),
    ram_budget_bytes: RAM_BUDGET_BYTES,
    bytes_sum: bytes.sum,
    bytes_verdict: verdict(bytes.seen, bytes.sum, RAM_BUDGET_BYTES),
    contributors,
    without_cost,
    weakest_basis: weakestBasis(contributors),
    is_floor: without_cost.length > 0,
    assumptions: assumptionsFor(region, regionNote(regionHint, locked.length), without_cost.length),
  };
}

function verdictCell(v: Budget["cycles_verdict"]): string {
  return v === "no_data" ? "no data" : `${v} budget`;
}

export function renderBudgetText(g: Budget): string {
  let out = `\n## Budget (${g.region})\n\n`;
  out += `| Sum | Value | Limit | Verdict |\n|-----|-------|-------|---------|\n`;
  out += `| Cycles per frame | ${g.cycles_per_frame_sum} | ${g.frame_cycles} | ${verdictCell(g.cycles_verdict)} |\n`;
  out += `| Bytes (code + data) | ${g.bytes_sum} | ${g.ram_budget_bytes} | ${verdictCell(g.bytes_verdict)} |\n`;
  if (g.contributors.length > 0) {
    out += `\nContributors:\n`;
    for (const c of g.contributors) {
      const parts: string[] = [];
      if (c.cycles_per_frame !== undefined) parts.push(`${c.cycles_per_frame} cycles/frame`);
      if (c.bytes !== undefined) parts.push(`${c.bytes} bytes`);
      out += `- ${c.name}: ${parts.join(", ") || "(no summable figure)"} (${c.basis})\n`;
    }
  }
  out += `\nWeakest basis: ${g.weakest_basis ?? "(nothing contributed)"}.\n`;
  if (g.without_cost.length > 0) {
    out += `No Cost line, so the sums are a floor: ${g.without_cost.join(", ")}.\n`;
  }
  for (const a of g.assumptions) out += `- ${a}\n`;
  return out;
}
