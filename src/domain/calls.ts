/**
 * Calls per frame (#37): a GameDesign runs some techniques more than once a
 * frame (a HUD prints several numbers), and a Cost figure is one call. A
 * **Composes:** item or a c64_plan_budget member may carry `×N` (N calls
 * every frame) or `×M-N` (M in the cheapest frame, N in the worst). `*N`,
 * and `xN` after a space, are accepted for keyboards without `×`.
 */

export interface CallCount {
  /** Calls in the frame the low end sums. */
  low: number;
  /** Calls in the worst frame. */
  high: number;
}

// The most calls one item may state; a larger count is a typo, not a design.
const MAX_CALLS = 255;
const CALLS_SUFFIX = /^(.*?)(?:\s*[×*]|\s+x)\s*(\d+)(?:\s*-\s*(\d+))?\s*$/;

/** A name with an optional call count; a malformed or out-of-range count is an error. */
export function splitCalls(item: string): { name: string; calls?: CallCount } | { error: string } {
  const m = CALLS_SUFFIX.exec(item.trim());
  if (!m) return { name: item.trim() };
  const name = (m[1] ?? "").trim();
  const first = Number(m[2]);
  const second = m[3] === undefined ? first : Number(m[3]);
  if (second < 1 || second > MAX_CALLS)
    return { error: `"${item}": the call count must be 1 to ${MAX_CALLS} in the worst frame` };
  if (first > second) return { error: `"${item}": ×M-N needs M no larger than N` };
  return { name, calls: { low: first, high: second } };
}

/** `×7`, `×2-7`, or "" for one call. */
export function callsText(calls: CallCount | undefined): string {
  if (!calls || (calls.low === 1 && calls.high === 1)) return "";
  return calls.low === calls.high ? ` ×${calls.high}` : ` ×${calls.low}-${calls.high}`;
}
