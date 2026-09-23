/**
 * A GameDesign's measured frame beside the budget planBudget predicts for
 * the same phase and region (schema 28). Pure: the caller fetches the
 * design and the plan.
 */

import type { BudgetBasis, BudgetPhase, PhaseBudget } from "./budget.ts";

/** One entry of a design's `**Measured frame:**` line, as the node stores it. */
export interface DesignMeasurement {
  phase: BudgetPhase;
  region: "PAL" | "NTSC";
  worst: number;
  typical?: number | undefined;
  basis: BudgetBasis;
  source: string;
}

export interface MeasuredComparison {
  phase: BudgetPhase;
  region: "PAL" | "NTSC";
  worst: number;
  typical: number | null;
  basis: BudgetBasis;
  source: string;
  /** The prediction for the same phase and region; null when none was made. */
  predicted: {
    low: number;
    high: number;
    fixed: number;
    verdict: PhaseBudget["verdict"];
    /** Members the prediction could not count: no figure, or above one frame. */
    missing: string[];
  } | null;
  /** Where the measured worst falls against [low, high + fixed]. */
  position: "below_low" | "within" | "above_high" | "not_predicted";
  finding: string;
}

function missingOf(p: PhaseBudget): string[] {
  const multi = p.excluded.filter((e) => e.reason === "multi_frame").map((e) => e.name);
  return [...p.unknown, ...p.not_found, ...multi];
}

function positionOf(worst: number, low: number, top: number): MeasuredComparison["position"] {
  if (worst < low) return "below_low";
  return worst > top ? "above_high" : "within";
}

/** `label` names the figure and its value, e.g. "measured worst 8693 (measured-vice)". */
function placeText(label: string, value: number, range: { low: number; top: number; worst: number }): string {
  const { low, top, worst } = range;
  const where = positionOf(value, low, top);
  if (where === "within") return `${label} lies within the predicted ${low}-${top}`;
  if (where === "above_high")
    return `${label} is above the predicted ${low}-${top} by ${value - top} (${Math.round((100 * (value - top)) / worst)} % of the measured worst)`;
  return `${label} is below the predicted ${low}-${top} by ${low - value}`;
}

function findingText(m: DesignMeasurement, p: PhaseBudget, missing: string[]): string {
  const top = p.high + p.fixed_losses.badlines + p.fixed_losses.sprite_dma;
  const range = { low: p.low, top, worst: m.worst };
  let out = placeText(`measured worst ${m.worst} (${m.basis})`, m.worst, range);
  if (m.typical !== undefined) out += `; ${placeText(`typical ${m.typical}`, m.typical, range)}`;
  if (missing.length === 0) return out;
  const n = missing.length;
  return `${out}. ${n} member${n === 1 ? " has" : "s have"} no figure (${missing.join(", ")}), so the prediction is incomplete and any agreement is partial`;
}

/** Each measurement beside the plan's phase for the same phase and region, if the plan has one. */
export function compareMeasured(measured: DesignMeasurement[], phases: PhaseBudget[]): MeasuredComparison[] {
  return measured.map((m) => {
    const base = {
      phase: m.phase,
      region: m.region,
      worst: m.worst,
      typical: m.typical ?? null,
      basis: m.basis,
      source: m.source,
    };
    const p = phases.find((x) => x.phase === m.phase && x.region === m.region);
    if (!p) {
      return {
        ...base,
        predicted: null,
        position: "not_predicted",
        finding: `no ${m.phase} budget for ${m.region}: the region was not asked for, or the design composes nothing in that phase`,
      };
    }
    const fixed = p.fixed_losses.badlines + p.fixed_losses.sprite_dma;
    const missing = missingOf(p);
    return {
      ...base,
      predicted: { low: p.low, high: p.high, fixed, verdict: p.verdict, missing },
      position: positionOf(m.worst, p.low, p.high + fixed),
      finding: findingText(m, p, missing),
    };
  });
}
