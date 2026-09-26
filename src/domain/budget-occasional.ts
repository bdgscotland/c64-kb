/**
 * Work spent on one frame in N (run-and-gun gap 1): a Cost line's
 * `every_n_frames`, as on row_map_redraw, whose redraw falls on the frame
 * YSCROLL wraps. planBudget (budget.ts) does not add such a member to every
 * frame; it budgets its own frame as its figure plus the every-frame
 * charges and the fixed losses, and assumes the other members skip that
 * frame, which the page stating the key must say.
 */

import type { BudgetContributor, BudgetMember } from "./budget.ts";

/** A member spent on one frame in N, budgeted on that frame alone. */
export interface BudgetOccasional extends BudgetContributor {
  every_n_frames: number;
  /** Its high figure plus the every-frame charges and the fixed losses charged beside it: the frame it runs on. */
  frame_high: number;
  /** Summed members that take interrupts every frame: their interrupt work lands on this frame too, uncounted. */
  irq_members: string[];
}

/** The N of a member charged by a frame figure whose Cost states every_n_frames of 2 or more, else null. */
export function everyNFrames(m: BudgetMember, charge: BudgetContributor["charge"]): number | null {
  const n = m.cost?.every_n_frames;
  const frameFigure = charge === "cycles_per_frame" || charge === "per_item";
  return n !== undefined && n >= 2 && frameFigure ? n : null;
}

/**
 * Each one-in-N member on its own frame; `holdsStalls` says whether its
 * figure already holds the display stalls, `irqMembers` names the summed
 * members that take interrupts every frame.
 */
export function occasionalFrames(
  occasional: readonly Omit<BudgetOccasional, "frame_high" | "irq_members">[],
  on: { everyFrame: number; losses: number; irqMembers: string[] },
  holdsStalls: (c: BudgetContributor) => boolean,
): BudgetOccasional[] {
  return occasional.map((o) => ({
    ...o,
    frame_high: o.high + on.everyFrame + (holdsStalls(o) ? 0 : on.losses),
    irq_members: on.irqMembers.filter((n) => n !== o.name),
  }));
}
