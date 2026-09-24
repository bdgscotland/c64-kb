/**
 * The second routing pass for a game brief that names no archetype (#19).
 *
 * The first pass (pickByBriefWords) needs a whole brief-word phrase:
 * "single screen platformer" routes, "a platformer" does not, and "a
 * puzzle game" ties between puzzle and action_puzzle. This pass reads the
 * genre noun instead: a word that ends two or more multi-word brief-word
 * phrases across the page ("platformer", "shooter", "adventure",
 * "scrolling"), or the last part of an archetype's name. A head used once
 * ("run and gun", "match three") is a title or a feature, not a genre, and
 * is not read. One archetype holding the brief's nouns routes; several are
 * returned as candidates, never guessed between. Pure.
 */

import { normaliseBriefText } from "../../graph/extract/archetype.ts";

// Heads that name no genre: "fighting game", "summer games", "beat em up",
// "single screen" end in one of these, and briefs use them for everything
// ("title screen", "power up").
const NOT_A_GENRE = new Set(["game", "games", "screen", "up"]);

const headOf = (phrase: string): string | undefined => {
  const parts = phrase.split(" ");
  return parts.length > 1 ? parts.at(-1) : undefined;
};

/** Phrase heads that end two or more phrases across all the rows. */
function sharedHeads(rows: readonly { words: readonly string[] }[]): Set<string> {
  const count = new Map<string, number>();
  for (const row of rows)
    for (const phrase of row.words) {
      const head = headOf(phrase);
      if (head) count.set(head, (count.get(head) ?? 0) + 1);
    }
  return new Set([...count].filter(([, n]) => n >= 2).map(([h]) => h));
}

/** The genre nouns of one archetype: its shared phrase heads and its name's last part. */
function genreHeads(name: string, words: readonly string[], shared: ReadonlySet<string>): Set<string> {
  const heads = new Set<string>();
  for (const phrase of words) {
    const head = headOf(phrase);
    if (head && shared.has(head)) heads.add(head);
  }
  const last = name.split("_").at(-1);
  if (last) heads.add(last);
  for (const w of NOT_A_GENRE) heads.delete(w);
  return heads;
}

/** Whether a brief token is this head, a plural "s" or "es" allowed. */
const isHead = (token: string, head: string) =>
  token === head || token === `${head}s` || token === `${head}es`;

export type HeadPick<R> = { row: R; matched: string[] } | { candidates: R[]; matched: string[] } | undefined;

/** The archetype whose genre nouns the brief holds most of; the tied ones as candidates. */
export function pickByGenreHeads<R extends { name: string; words: readonly string[] }>(
  description: string,
  rows: readonly R[],
): HeadPick<R> {
  const tokens = normaliseBriefText(description).split(" ");
  const shared = sharedHeads(rows);
  const scored = rows.flatMap((row) => {
    const heads = [...genreHeads(row.name, row.words, shared)];
    const matched = heads.filter((h) => tokens.some((t) => isHead(t, h)));
    return matched.length > 0 ? [{ row, matched }] : [];
  });
  const best = Math.max(0, ...scored.map((s) => s.matched.length));
  const top = scored.filter((s) => s.matched.length === best);
  const [first] = top;
  if (!first) return undefined;
  if (top.length === 1) return first;
  const matched = [...new Set(top.flatMap((s) => s.matched))].sort();
  return { candidates: top.map((s) => s.row), matched };
}
