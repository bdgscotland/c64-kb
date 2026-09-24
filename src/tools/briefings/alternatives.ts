/**
 * One technique per job (#17 ONTO-07). When the proposal holds both ends of
 * an ALTERNATIVE_TO pair, keep one and report the other as its
 * alternative, with the tradeoff the page states. Two forced ones (the
 * archetype's fingerprint or the brief's own words) both stay, since the
 * page or the brief asked for each. Otherwise, in this order:
 *
 * 1. A count the brief states decides (#91). Each "N noun" in the brief
 *    ("24 sprites") is matched against both techniques: a technique's
 *    title states the same count of the same thing ("Up to 24+ sprites",
 *    "8-sprite multiplexer"), or the tradeoff's "more than M noun" clause,
 *    which describes the technique whose page states it, is met (N > M).
 *    Only a count that matches one side decides; one that matches both or
 *    neither passes to the next rule.
 * 2. A forced technique beats a found one.
 * 3. The one with more realising recipes stays, and on a tie the one
 *    ranked first.
 *
 * Until #91 the brief was not read here, so "sprite multiplexer demo with
 * 24 sprites on screen via raster reuse" kept sprite_multiplex_8 on its
 * recipe count. Neither technique was forced; the issue's first guess, a
 * wording rule forcing sprite_multiplex_8, was wrong.
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

interface Count {
  n: number;
  noun: string;
}

/** "sprites" → "sprite": enough to match a plural brief against a singular title. */
function stem(word: string): string {
  const w = word.toLowerCase();
  return w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w;
}

/** Every "N noun" in the text: "24 sprites", "24+ sprites", "8-sprite". */
function countsIn(text: string): Count[] {
  return [...text.matchAll(/\b(\d+)\+?[-\s]+([a-z]+)/gi)].map((m) => ({
    n: Number(m[1]),
    noun: stem(m[2] ?? ""),
  }));
}

/** Every "more than M noun" or "over M noun" in a tradeoff; "the" may stand before M. */
function thresholdsIn(text: string): Count[] {
  return [...text.matchAll(/\b(?:more than|over)\s+(?:the\s+)?(\d+)\s+([a-z]+)/gi)].map((m) => ({
    n: Number(m[1]),
    noun: stem(m[2] ?? ""),
  }));
}

/** Whether a count the brief states points at `t`, given the edge that pairs it with the other technique. */
function briefCountFavours(t: TechniqueLookupOutput, edge: LeftOut, brief: readonly Count[]): boolean {
  const titled = countsIn(t.title);
  if (brief.some((b) => titled.some((c) => c.n === b.n && c.noun === b.noun))) return true;
  if (edge.stated_on !== t.name) return false;
  const floors = thresholdsIn(edge.tradeoff);
  return brief.some((b) => floors.some((f) => f.noun === b.noun && b.n > f.n));
}

function edgeBetween(a: TechniqueLookupOutput, b: string): LeftOut | undefined {
  const e = (a.alternatives ?? []).find((x) => x.name === b);
  return e ? { name: b, tradeoff: e.tradeoff, stated_on: e.stated_on } : undefined;
}

interface Contest {
  forced: ReadonlySet<string>;
  brief: readonly Count[];
}

/** Whether `challenger` should replace `holder`: the brief's count, then forced, then recipe count; ties keep the holder. */
function replaces(
  challenger: TechniqueLookupOutput,
  holder: TechniqueLookupOutput,
  edge: LeftOut,
  { forced, brief }: Contest,
): boolean {
  const cc = briefCountFavours(challenger, edge, brief);
  const hc = briefCountFavours(holder, edge, brief);
  if (cc !== hc) return cc;
  const cf = forced.has(challenger.name);
  const hf = forced.has(holder.name);
  if (cf !== hf) return cf;
  return challenger.recipes.length > holder.recipes.length;
}

export function oneOfEachAlternative(
  techs: TechniqueLookupOutput[],
  forced: ReadonlySet<string>,
  briefText = "",
): AlternativesResult {
  const contest: Contest = { forced, brief: countsIn(briefText) };
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
    } else if (replaces(t, holder, edge, contest)) {
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
