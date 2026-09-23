// kernal_clobbers_zp (schema 26): one technique calls a KERNAL routine (its
// **Uses kernal:** line) whose CLOBBERS_ZP may set overlaps zero-page bytes
// the other technique claims. Soft: the may set is a static walk of the ROM,
// an upper bound, and a given call need not reach every store. Pure, like
// unit-rules.ts: the caller passes the claims and the routines' sets.

import { formatZeroPageRanges, zeroPageRangesFromCanonical, type Claim } from "../../../graph/claims.ts";
import type { UnitHit } from "./unit-rules.ts";

export type KernalZpHit = Omit<UnitHit, "kind"> & { kind: "kernal_clobbers_zp" };

export interface KernalSide {
  name: string;
  /** KERNAL routines the technique USES. */
  kernal: readonly string[];
  claims: readonly Claim[];
}

type Range = [number, number];

function overlap(a: readonly Range[], b: readonly Range[]): Range[] {
  const out: Range[] = [];
  for (const [a0, a1] of a) {
    for (const [b0, b1] of b) {
      const lo = Math.max(a0, b0);
      const hi = Math.min(a1, b1);
      if (lo <= hi) out.push([lo, hi]);
    }
  }
  return out.sort((x, y) => x[0] - y[0]);
}

/** "$E0-$EF, $F2" from canonical-style ranges. */
function dollar(ranges: Range[]): string {
  return formatZeroPageRanges(ranges)
    .split(",")
    .map((r) => `$${r.replace("-", "-$")}`)
    .join(", ");
}

/** The finding for `user`'s KERNAL calls against `holder`'s zero-page claims, or null. */
function oneWay(
  user: KernalSide,
  holder: KernalSide,
  mayWrites: ReadonlyMap<string, string>,
): KernalZpHit | null {
  const held = holder.claims.filter((c) => c.unit === "zero_page" && c.ranges);
  if (held.length === 0) return null;
  const heldRanges = held.flatMap((c) => zeroPageRangesFromCanonical(c.ranges ?? ""));
  const relocatable = held.some((c) => c.relocatable === true);
  const hits: { routine: string; bytes: Range[] }[] = [];
  for (const routine of [...user.kernal].sort()) {
    const may = mayWrites.get(routine);
    if (may === undefined) continue;
    const bytes = overlap(zeroPageRangesFromCanonical(may), heldRanges);
    if (bytes.length > 0) hits.push({ routine, bytes });
  }
  if (hits.length === 0) return null;
  const merged: Range[] = [];
  for (const r of hits.flatMap((h) => h.bytes).sort((x, y) => x[0] - y[0])) {
    const prev = merged.at(-1);
    if (prev && r[0] <= prev[1] + 1) prev[1] = Math.max(prev[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  const each = hits.map((h) => `${h.routine} may write ${dollar(h.bytes)}`).join("; ");
  const routines = hits.map((h) => h.routine).join(", ");
  return {
    kind: "kernal_clobbers_zp",
    severity: "soft",
    shared: [`zero_page ${dollar(merged)}`, ...hits.map((h) => h.routine)],
    rationale: `${user.name} calls the KERNAL, and ${each}, bytes ${holder.name} claims. "May": the set is a static walk of the ROM, an upper bound; a given call need not reach every store (the KERNAL reference page lists each routine's set, and what a traced call wrote).`,
    resolution: relocatable
      ? `Rebuild ${holder.name} with its zero-page base moved off these bytes (its page names the build option), or save and restore them around each call to ${routines}.`
      : `Move ${holder.name}'s zero-page variables off these bytes, or save and restore them around each call to ${routines}, or make no such call while ${holder.name}'s bytes are live.`,
  };
}

/** kernal_clobbers_zp in both directions between two techniques. */
export function kernalClobberRules(
  a: KernalSide,
  b: KernalSide,
  mayWrites: ReadonlyMap<string, string>,
): KernalZpHit[] {
  return [oneWay(a, b, mayWrites), oneWay(b, a, mayWrites)].filter((h): h is KernalZpHit => h !== null);
}
