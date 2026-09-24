/**
 * One technique per job (#17 ONTO-07). When the proposal holds both ends of
 * an ALTERNATIVE_TO pair, keep one and report the other as its
 * alternative, with the tradeoff the page states. A forced technique (the
 * archetype's fingerprint or the brief's own words) beats a found one; two
 * forced ones both stay, since the page or the brief asked for each. Between
 * two found ones the technique with more realising recipes stays, and on a
 * tie the one ranked first.
 */

import type { TechniqueLookupOutput } from "../../schemas/tool-outputs.ts";

export interface LeftOut {
  name: string;
  tradeoff: string;
  stated_on: string;
}

export interface AlternativesResult {
  kept: TechniqueLookupOutput[];
  /** Kept technique name → the alternatives dropped in its favour. */
  leftOut: Map<string, LeftOut[]>;
}

function edgeBetween(a: TechniqueLookupOutput, b: string): LeftOut | undefined {
  const e = (a.alternatives ?? []).find((x) => x.name === b);
  return e ? { name: b, tradeoff: e.tradeoff, stated_on: e.stated_on } : undefined;
}

/** Whether `challenger` should replace `holder`: forced first, then recipe count; ties keep the holder. */
function replaces(
  challenger: TechniqueLookupOutput,
  holder: TechniqueLookupOutput,
  forced: ReadonlySet<string>,
): boolean {
  const cf = forced.has(challenger.name);
  const hf = forced.has(holder.name);
  if (cf !== hf) return cf;
  return challenger.recipes.length > holder.recipes.length;
}

export function oneOfEachAlternative(
  techs: TechniqueLookupOutput[],
  forced: ReadonlySet<string>,
): AlternativesResult {
  const kept: TechniqueLookupOutput[] = [];
  const leftOut = new Map<string, LeftOut[]>();
  const note = (winner: string, entry: LeftOut) =>
    leftOut.set(winner, [...(leftOut.get(winner) ?? []), entry]);
  for (const t of techs) {
    const i = kept.findIndex((k) => edgeBetween(k, t.name) !== undefined);
    const holder = i >= 0 ? kept[i] : undefined;
    const edge = holder ? edgeBetween(holder, t.name) : undefined;
    if (!holder || !edge || (forced.has(t.name) && forced.has(holder.name))) {
      kept.push(t);
    } else if (replaces(t, holder, forced)) {
      kept[i] = t;
      note(t.name, { ...edge, name: holder.name });
      for (const e of leftOut.get(holder.name) ?? []) note(t.name, e);
      leftOut.delete(holder.name);
    } else {
      note(holder.name, edge);
    }
  }
  return { kept, leftOut };
}
