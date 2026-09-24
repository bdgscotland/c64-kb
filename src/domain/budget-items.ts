/**
 * Counts on a budget member (#37, #95). A Cost figure is one call, so a
 * cycles_per_frame charge is multiplied by the calls a frame. On a member
 * whose Cost states cycles_per_item the count is items instead: the
 * charge is cycles_item_base + N × item, low with the fewest and high with
 * the most. Without a count the member keeps its cycles_per_frame, the
 * recipe's own count.
 */

import type { BudgetContributor, BudgetMember } from "./budget.ts";
import type { CallCount } from "./calls.ts";

interface Counted {
  low: number;
  high: number;
  charge: BudgetContributor["charge"];
}

/** The per_item charge of a counted member whose Cost states cycles_per_item, or null. */
export function perItemCharge(m: BudgetMember): Counted | null {
  const each = m.cost?.cycles_per_item;
  if (!m.calls || each === undefined) return null;
  const base = m.cost?.cycles_item_base ?? 0;
  return { low: base + m.calls.low * each, high: base + m.calls.high * each, charge: "per_item" };
}

/** A call count other than exactly one, or undefined. */
function multiCalls(calls: CallCount | undefined): CallCount | undefined {
  return calls && (calls.low !== 1 || calls.high !== 1) ? calls : undefined;
}

/**
 * What a count adds to a contributor: a cycles_per_frame charge times its
 * calls, or a per_item charge's count and figures; nothing otherwise.
 */
export function countedFigures(m: BudgetMember, charge: Counted): Partial<BudgetContributor> {
  if (charge.charge === "per_item" && m.calls) {
    return {
      calls: m.calls,
      per_item: { base: m.cost?.cycles_item_base ?? 0, each: m.cost?.cycles_per_item ?? 0 },
    };
  }
  const calls = charge.charge === "cycles_per_frame" ? multiCalls(m.calls) : undefined;
  return calls ? { low: charge.low * calls.low, high: charge.high * calls.high, calls } : {};
}
