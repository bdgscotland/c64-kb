/** Distinctiveness (salience) layer (2026-05-21): re-weight a composer's mined
 * vocabulary by how DISTINCTIVE each pattern is to them vs the whole-corpus
 * background — not by raw frequency. Common-practice patterns (used by many
 * composers) are flattened; signature patterns (used by few) rise. This is what
 * makes "compose like X" foreground X's fingerprint rather than C64 common
 * practice — and why a bigger corpus matters (it sharpens the background model).
 *
 *   salience(p, c) = weight(p, c) · smoothed_idf(df(p), N)
 *   smoothed_idf   = ln((1 + N) / (1 + df)) + 1      (sklearn-style; never zero)
 *
 * df(p) = number of composers who use pattern p; N = total composers. */

export function smoothedIdf(df: number, N: number): number {
  return Math.log((1 + N) / (1 + df)) + 1;
}

export function salienceScore(weight: number, df: number, N: number): number {
  return weight * smoothedIdf(df, N);
}

/** Re-sort a frequency-ranked vocabulary into a distinctiveness-ranked one.
 * Stable: equal salience preserves input order (deterministic). */
export function rerankBySalience<T extends { weight: number; df: number }>(items: T[], N: number): T[] {
  return items
    .map((it, i) => ({ it, i, s: salienceScore(it.weight, it.df, N) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.it);
}

// --- graph-backed saliencizer: re-rank a composer's palette by distinctiveness ---

import { FalkorHvscClient, normalizeName } from "../services/falkor-hvsc.js";
import type { ComposerPalette } from "./auto-compose.js";
import type { PhraseRow, ProgressionRow } from "./palette-mcp.js";
import { degreesToRoman } from "./palette-mcp.js";

const _ints = (s: string): number[] => (s ?? "").split(",").filter((x) => x !== "").map((x) => parseInt(x, 10));
const _beats = (a: number[]): number[] => a.map((x) => x * 0.25);

/** Total composer count (the N for idf). */
async function composerCount(client: FalkorHvscClient): Promise<number> {
  const rows = await client.rawQuery<{ n: number }>(`MATCH (c:Composer) RETURN count(c) AS n`, {});
  return Math.max(1, Number(rows[0]?.n ?? 1));
}

/** Pull a composer's FAVORS_PHRASE pool (top-by-weight) WITH each phrase's df
 * (how many composers favour it), re-rank by salience, return the top `limit`. */
async function salientPhrases(client: FalkorHvscClient, name: string, N: number, limit: number): Promise<PhraseRow[]> {
  const rows = await client.rawQuery<{ intervals: string; iois: string; gates: string; n_notes: number; weight: number; df: number }>(
    `MATCH (c:Composer {name:$name})-[r:FAVORS_PHRASE]->(p:Phrase)
     WITH p, r.weight AS w ORDER BY w DESC LIMIT 60
     MATCH (oc:Composer)-[:FAVORS_PHRASE]->(p)
     WITH p, w, count(DISTINCT oc) AS df
     RETURN p.intervals AS intervals, p.iois AS iois, p.gates AS gates, p.n_notes AS n_notes, w AS weight, df`,
    { name });
  const enriched = rows.map((r) => {
    const iois = _ints(r.iois), gates = _ints(r.gates);
    return {
      row: { intervals: _ints(r.intervals), iois, gates, n_notes: Number(r.n_notes), weight: Number(r.weight),
             beats_hint: { iois_beats: _beats(iois), gates_beats: _beats(gates) } } as PhraseRow,
      weight: Number(r.weight), df: Number(r.df),
    };
  });
  return rerankBySalience(enriched, N).slice(0, limit).map((e) => e.row);
}

/** Same, for FAVORS_PROGRESSION. */
async function salientProgressions(client: FalkorHvscClient, name: string, N: number, limit: number): Promise<ProgressionRow[]> {
  const rows = await client.rawQuery<{ degrees: string; length: number; weight: number; df: number }>(
    `MATCH (c:Composer {name:$name})-[r:FAVORS_PROGRESSION]->(p:Progression)
     WITH p, r.weight AS w ORDER BY w DESC LIMIT 40
     MATCH (oc:Composer)-[:FAVORS_PROGRESSION]->(p)
     WITH p, w, count(DISTINCT oc) AS df
     RETURN p.degrees AS degrees, p.length AS length, w AS weight, df`,
    { name });
  const enriched = rows.map((r) => ({
    row: { degrees: r.degrees, length: Number(r.length), weight: Number(r.weight), roman: degreesToRoman(r.degrees) } as ProgressionRow,
    weight: Number(r.weight), df: Number(r.df),
  }));
  return rerankBySalience(enriched, N).slice(0, limit).map((e) => e.row);
}

/** Return a copy of `palette` with phrases + progressions re-ranked by
 * distinctiveness (signature patterns first), pulling a wider pool from the graph
 * so low-frequency-but-distinctive patterns can surface. */
export async function saliencizePalette(palette: ComposerPalette, graphName?: string): Promise<ComposerPalette> {
  const client = new FalkorHvscClient(graphName ? { graphName } : {});
  await client.connect();
  try {
    const name = normalizeName(palette.composer);
    const N = await composerCount(client);
    const [phrases, progressions] = await Promise.all([
      salientPhrases(client, name, N, 12),
      salientProgressions(client, name, N, 12),
    ]);
    return {
      ...palette,
      phrases: phrases.length ? phrases : palette.phrases,
      progressions: progressions.length ? progressions : palette.progressions,
    };
  } finally {
    await client.disconnect();
  }
}
