/**
 * recipe_zero_page_overlap (schema 34): the recipes that build two input
 * techniques own zero-page bytes in common. Recipe claims are choices of
 * one listing, not properties of the technique, so this is info: it never
 * changes the verdict, and says which listings collide if both are copied
 * into one program (the demo starter found sine_scroller's and
 * sfx_in_player's $FB-$FE by reading, #22).
 */

import { zeroPageRangesFromCanonical } from "../../../graph/claims.ts";
import type { CompatibilityCheckOutput } from "../../../schemas/tool-outputs.ts";
import { inputPairs, type CompatibilityFacts } from "./facts.ts";

type Conflict = CompatibilityCheckOutput["conflicts"][number];

export interface RecipeZeroPage {
  recipe: string;
  /** The input techniques this recipe IMPLEMENTS. */
  implements: readonly string[];
  /** Canonical owned bytes, "FB-FE". */
  ranges: string;
}

const hex2 = (n: number) => `$${n.toString(16).toUpperCase().padStart(2, "0")}`;
const rangeText = ([a, b]: [number, number]) => (a === b ? hex2(a) : `${hex2(a)}-${hex2(b)}`);

function overlap(a: string, b: string): [number, number][] {
  const out: [number, number][] = [];
  for (const [a0, a1] of zeroPageRangesFromCanonical(a))
    for (const [b0, b1] of zeroPageRangesFromCanonical(b)) {
      const lo = Math.max(a0, b0);
      const hi = Math.min(a1, b1);
      if (lo <= hi) out.push([lo, hi]);
    }
  return out;
}

/** Union of byte ranges, merged and sorted. */
function merge(ranges: [number, number][]): [number, number][] {
  const sorted = [...ranges].sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (const r of sorted) {
    const prev = out.at(-1);
    if (prev && r[0] <= prev[1] + 1) prev[1] = Math.max(prev[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

const MAX_PAIRS = 4;

/** One info conflict per input pair whose recipes, one for each side and not both, share owned zero page. */
export function recipeZeroPageRules(all: CompatibilityFacts): Conflict[] {
  const recipes = all.recipeZeroPage ?? [];
  const only = (t: string, other: string) =>
    recipes.filter((r) => r.implements.includes(t) && !r.implements.includes(other));
  const out: Conflict[] = [];
  for (const { a, b } of inputPairs(all.techniques)) {
    const hits: { text: string; bytes: [number, number][] }[] = [];
    for (const ra of only(a, b))
      for (const rb of only(b, a)) {
        const bytes = overlap(ra.ranges, rb.ranges);
        if (bytes.length > 0)
          hits.push({ text: `${ra.recipe} and ${rb.recipe} (${bytes.map(rangeText).join(", ")})`, bytes });
      }
    if (hits.length === 0) continue;
    const shown = hits.slice(0, MAX_PAIRS).map((h) => h.text);
    const more = hits.length > MAX_PAIRS ? `, and ${hits.length - MAX_PAIRS} more pair(s)` : "";
    out.push({
      a,
      b,
      kind: "recipe_zero_page_overlap",
      severity: "info",
      shared: merge(hits.flatMap((h) => h.bytes)).map(rangeText),
      rationale: `Recipes that build them own the same zero-page bytes: ${shown.join("; ")}${more}. The techniques do not conflict; two of these listings copied into one program would overwrite each other's variables.`,
      resolution: `Move one listing's zero-page variables to bytes the other does not use; c64_recipe_lookup lists each recipe's bytes under claims.`,
    });
  }
  return out;
}
