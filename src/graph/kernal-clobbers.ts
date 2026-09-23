// The `**Clobbers zero page:**` line under a KERNAL routine H3 (schema 26):
// the zero-page bytes the routine may or must write, and where the set came
// from. Written by scripts/kernal-zp-walk.ts (bound `may`, a static ROM
// walk); a `must` line records what a VICE store trace saw. The extractor
// turns each line into a CLOBBERS_ZP edge to the zero_page HardwareUnit.
//
//   **Clobbers zero page:** $B8-$BA (may; ROM walk from $FFBA, power-on vectors)
//   **Clobbers zero page:** none (may; ROM walk from $FFED, power-on vectors)
//   **Clobbers zero page:** $B8-$BA (must; VICE x64sc store trace, SETLFS 2,8,2)

import { group } from "./extract/common.ts";

export type ClobberBound = "may" | "must";

export interface KernalClobbers {
  /** Byte ranges $00-$FF, merged and sorted; empty for `none`. */
  ranges: [number, number][];
  bound: ClobberBound;
  /** The text after the bound: what the set was measured or walked from. */
  basis: string;
}

export const CLOBBERS_LABEL = "**Clobbers zero page:**";
export const CLOBBERS_LINE = /^\*\*Clobbers zero page:\*\*\s*(.+?)\s*$/gm;

const hex2 = (n: number): string => n.toString(16).toUpperCase().padStart(2, "0");

/** `$90-$9A, $B7` from merged ranges; `none` for an empty set. */
export function formatClobberRanges(ranges: readonly [number, number][]): string {
  if (ranges.length === 0) return "none";
  return ranges.map(([a, b]) => (a === b ? `$${hex2(a)}` : `$${hex2(a)}-$${hex2(b)}`)).join(", ");
}

/** The whole line value, as the walk script writes it. */
export function formatClobbers(c: KernalClobbers): string {
  return `${formatClobberRanges(c.ranges)} (${c.bound}; ${c.basis})`;
}

/** Merge and sort [first, last] pairs. */
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

/**
 * Parse a line value. Zero page here is $00-$FF: the KERNAL writes the 6510
 * port at $00-$01 too (IOINIT, the tape motor), and a reader of the line
 * should see it, though no Claims line can name those two bytes.
 */
export function parseClobbers(value: string): KernalClobbers | { error: string } {
  const m = /^(.*?)\s*\((may|must);\s*(.+)\)$/.exec(value.trim());
  if (!m) return { error: `"${value}" is not "<bytes> (may|must; <basis>)"` };
  const set = group(m, 1).trim();
  const bound = group(m, 2) as ClobberBound;
  const basis = group(m, 3).trim();
  if (set === "none") return { ranges: [], bound, basis };
  const ranges: [number, number][] = [];
  for (const part of set.split(",").map((s) => s.trim())) {
    const r = /^\$([0-9A-Fa-f]{2})(?:-\$([0-9A-Fa-f]{2}))?$/.exec(part);
    if (!r) return { error: `"${part}" is not a zero-page byte $XX or range $XX-$YY` };
    const first = parseInt(group(r, 1), 16);
    const last = r[2] ? parseInt(r[2], 16) : first;
    if (first > last) return { error: `range ${part} runs backwards` };
    ranges.push([first, last]);
  }
  return { ranges: merge(ranges), bound, basis };
}
