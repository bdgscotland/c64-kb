/**
 * The byte half of the honest budget (budget.ts), and the basis ranking
 * both halves use: bytes over the members, once each, never a whole
 * program's size once per technique.
 */

import type { BudgetBasis, BudgetCost, BudgetMember, PhaseBudget } from "./budget.ts";

// Strongest first; the weakest basis in a sum is named beside it.
const BASIS_STRENGTH: readonly BudgetBasis[] = [
  "measured-vice",
  "derived-listing",
  "arithmetic",
  "estimated",
];

export interface BytesBudget {
  sum: number;
  contributors: { name: string; bytes: number; basis: BudgetBasis }[];
  excluded: { name: string; bytes: number; reason: "whole_program" }[];
  /** Members whose work, and so code, is inside another member's figure that states bytes. */
  inside: { name: string; by: string }[];
  without_bytes: string[];
  /** The weakest byte basis among the contributors, beside the sum (#72). */
  weakest_basis: BudgetBasis | null;
}

const WHOLE_PROGRAM = /\bwhole\s+(?:prg|program)\b/i;

export function weakestOf(bases: BudgetBasis[]): BudgetBasis | null {
  let weakest: BudgetBasis | null = null;
  for (const b of bases) {
    if (weakest === null || BASIS_STRENGTH.indexOf(b) > BASIS_STRENGTH.indexOf(weakest)) weakest = b;
  }
  return weakest;
}

/** Members absorbed in every phase they are budgeted in, with the member that holds them. */
export function heldEverywhere(phases: PhaseBudget[]): Map<string, string> {
  const held = new Map<string, string>();
  const free = new Set<string>();
  for (const p of phases) {
    const inside = new Map(
      p.excluded.filter((e) => e.reason !== "multi_frame" && e.by).map((e) => [e.name, e.by ?? ""]),
    );
    for (const name of p.members) {
      const by = inside.get(name);
      if (by === undefined) free.add(name);
      else if (!held.has(name)) held.set(name, by);
    }
  }
  for (const name of free) held.delete(name);
  return held;
}

/** The byte figures' basis: their own line where the page states one (#72), else the Cost basis. */
function bytesBasisOf(c: BudgetCost): BudgetBasis {
  return c.bytes_basis ?? c.basis;
}

function hasBytes(c: BudgetCost | undefined): c is BudgetCost {
  return c?.bytes_code !== undefined || c?.bytes_data !== undefined;
}

/**
 * Bytes over the members, once each. A member whose work is inside another
 * member's figure is inside its code too when that member states bytes
 * measured on its recipe; it is listed, not summed, and does not make the
 * sum a floor.
 */
export function bytesOf(members: BudgetMember[], held: Map<string, string>): BytesBudget {
  const out: BytesBudget = {
    sum: 0,
    contributors: [],
    excluded: [],
    inside: [],
    without_bytes: [],
    weakest_basis: null,
  };
  const byName = new Map(members.map((m) => [m.name, m]));
  const seen = new Set<string>();
  for (const m of members) {
    if (seen.has(m.name) || !m.found) continue;
    seen.add(m.name);
    const by = held.get(m.name);
    const holder = by === undefined ? undefined : byName.get(by)?.cost;
    if (by !== undefined && hasBytes(holder) && !WHOLE_PROGRAM.test(holder.conditions ?? "")) {
      out.inside.push({ name: m.name, by });
      continue;
    }
    const c = m.cost;
    if (!hasBytes(c)) {
      out.without_bytes.push(m.name);
      continue;
    }
    const bytes = (c.bytes_code ?? 0) + (c.bytes_data ?? 0);
    if (c.conditions && WHOLE_PROGRAM.test(c.conditions)) {
      out.excluded.push({ name: m.name, bytes, reason: "whole_program" });
      continue;
    }
    out.sum += bytes;
    out.contributors.push({ name: m.name, bytes, basis: bytesBasisOf(c) });
  }
  out.weakest_basis = weakestOf(out.contributors.map((c) => c.basis));
  return out;
}
