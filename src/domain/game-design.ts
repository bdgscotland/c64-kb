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
  /**
   * Where the measured worst falls against [low, high + fixed].
   * "within_incomplete" is inside the range while `predicted.missing` is
   * non-empty: the uncounted members could move the range past it, so it
   * is not agreement.
   */
  position: "below_low" | "within" | "within_incomplete" | "above_high" | "not_predicted";
  finding: string;
}

function missingOf(p: PhaseBudget): string[] {
  const multi = p.excluded.filter((e) => e.reason === "multi_frame").map((e) => e.name);
  return [...p.unknown, ...p.not_found, ...multi];
}

function positionOf(
  worst: number,
  low: number,
  top: number,
  incomplete: boolean,
): Exclude<MeasuredComparison["position"], "not_predicted"> {
  if (worst < low) return "below_low";
  if (worst > top) return "above_high";
  return incomplete ? "within_incomplete" : "within";
}

/**
 * `label` names the figure and its value, e.g. "measured worst 8693
 * (measured-vice)"; `of` names it in the percentage ("the measured worst").
 * An excess is given as a share of the figure placed, so a typical frame's
 * excess is not divided by the worst frame.
 */
function placeText(label: string, of: string, value: number, range: { low: number; top: number }): string {
  const { low, top } = range;
  if (value >= low && value <= top) return `${label} lies within the predicted ${low}-${top}`;
  if (value > top)
    return `${label} is above the predicted ${low}-${top} by ${value - top} (${Math.round((100 * (value - top)) / value)} % of ${of})`;
  return `${label} is below the predicted ${low}-${top} by ${low - value}`;
}

function findingText(m: DesignMeasurement, p: PhaseBudget, missing: string[]): string {
  const top = p.high + p.fixed_losses.badlines + p.fixed_losses.sprite_dma;
  const range = { low: p.low, top };
  let out = placeText(`measured worst ${m.worst} (${m.basis})`, "the measured worst", m.worst, range);
  if (m.typical !== undefined)
    out += `; ${placeText(`typical ${m.typical}`, "the typical", m.typical, range)}`;
  if (missing.length === 0) return out;
  const n = missing.length;
  const consequence =
    m.worst > top
      ? "the uncounted cycles may account for the excess"
      : m.worst < p.low
        ? "a missing member can only raise the range, so the measured worst stays below it"
        : "any agreement is partial";
  return `${out}. ${n} member${n === 1 ? " has" : "s have"} no figure (${missing.join(", ")}), so the prediction is incomplete: ${consequence}`;
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
      position: positionOf(m.worst, p.low, p.high + fixed, missing.length > 0),
      finding: findingText(m, p, missing),
    };
  });
}
