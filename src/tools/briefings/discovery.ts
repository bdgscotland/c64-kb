/**
 * Technique discovery for a briefing: keyword scoring against the graph
 * (primary) merged with vector search (supplementary).
 */

import { search } from "../query.ts";
import { getFalkor } from "../../context.ts";
import { parseRows, TechniqueScoreRow } from "./rows.ts";
import type { z } from "zod";

/**
 * Given a Qdrant chunk section string like
 *   "Raster Techniques > stable_raster_irq — Stable raster IRQ"
 * extract the snake_case technique name ("stable_raster_irq").
 *
 * Coupling: this reads the chunker's output format, not a field of the
 * payload. The technique-doc H2 format is `## snake_name — Title`, and the
 * chunker writes a chunk's section as `{H1} > {H2}` or just `{H2}`. If
 * either the H2 convention (docs/CONVENTIONS-*.md) or the chunker's section
 * joiner changes, vector hits stop contributing technique names here and
 * briefings silently fall back to keyword scoring alone. A technique-name
 * field on the chunk payload would remove this parse.
 */
export function extractTechniqueNameFromSection(section: string): string | null {
  // Take the last " > " segment (the H2 part)
  const leaf = (section.split(" > ").at(-1) ?? "").trim();
  // The leaf should be: "snake_name — Title" or "snake_name — Title ..."
  const dashIdx = leaf.indexOf(" — ");
  if (dashIdx === -1) return null;
  const candidate = leaf.slice(0, dashIdx).trim();
  // Validate: must be lowercase with underscores only (technique snake_case)
  if (/^[a-z][a-z0-9_]*$/.test(candidate)) return candidate;
  return null;
}

// Scene-tier signal words: when the brief explicitly mentions one of these,
// don't penalize high / scene-tier techniques (the user wants the exotic stuff).
const SCENE_TIER_KEYWORDS = [
  "sideborder",
  "open border",
  "open the border",
  "fli",
  "vsp",
  "dycp",
  "interlace",
  "twister",
  "rotozoom",
  "8580 vs",
  "6581 vs",
  "cycle-exact",
  "cycle exact",
  "scene tier",
  "advanced effect",
];

// Per-complexity penalty applied unless scene-tier signals appear.
// Reason: hybrid search ranks rare/scene-tier techniques higher (fewer chunks
// = less score dilution), so foundations like stable_raster_irq lose to
// exotic siblings like topbottom_border_open. The penalty rebalances.
const COMPLEXITY_PENALTY_NORMAL: Record<string, number> = {
  low: 0,
  medium: 0,
  high: 1.0,
  "scene-tier": 2.0,
};
const COMPLEXITY_PENALTY_NONE: Record<string, number> = { low: 0, medium: 0, high: 0, "scene-tier": 0 };

/** Tokenize and add stemmed variants (strip common suffixes like -ing, -er, -ers). */
function briefTokens(description: string): string[] {
  const rawTokens = description
    .toLowerCase()
    .split(/[\s_,+\-()]+/)
    .filter((t) => t.length >= 3);
  return Array.from(
    new Set([
      ...rawTokens,
      ...rawTokens.map((t) => (t.endsWith("ing") && t.length > 5 ? t.slice(0, -3) : t)),
      ...rawTokens.map((t) => (t.endsWith("ers") && t.length > 5 ? t.slice(0, -3) : t)),
      ...rawTokens.map((t) => (t.endsWith("er") && t.length > 5 ? t.slice(0, -2) : t)),
      ...rawTokens.map((t) => (t.endsWith("s") && t.length > 4 ? t.slice(0, -1) : t)),
    ]),
  ).filter((t) => t.length >= 3);
}

function recipeBonusFor(recipeCount: number): number {
  if (recipeCount >= 2) return 1.5;
  if (recipeCount >= 1) return 0.75;
  return 0;
}

function scoreTechnique(
  r: z.infer<typeof TechniqueScoreRow>,
  tokens: string[],
  complexityPenalty: Record<string, number>,
): { name: string; score: number } {
  const name = r.name.toLowerCase();
  const title = (r.title ?? "").toLowerCase();
  const category = (r.category ?? "").toLowerCase();
  const complexity = (r.complexity ?? "medium").toLowerCase();
  // Whole words only. Substring matching let "budget bar" propose
  // raster_bars and "tile map" reach every bitmap technique through the
  // category word, so a long brief filled its slots with misses
  // (three-arm build test, 2026-09-22).
  const nameWords = new Set(name.split("_").filter(Boolean));
  const words = new Set([
    ...nameWords,
    ...title.split(/[^a-z0-9$.]+/).filter((w) => w.length >= 3),
    category,
  ]);
  const hits = tokens.filter((t) => words.has(t)).length;

  // Bonus: if a token is the technique's category word
  const categoryBonus = tokens.some((t) => category === t) ? 0.5 : 0;
  // Bonus: if a token is one of the words of the snake_case name (strong match)
  const nameBonus = tokens.some((t) => nameWords.has(t)) ? 0.5 : 0;
  // Recipe-evidence bonus: techniques with implementing recipes are more
  // idiomatic and should outrank exotic siblings with no worked example.
  const recipeBonus = recipeBonusFor(Number(r.recipe_count ?? 0));
  // Complexity penalty: rebalance against vector-search's rare-page bias.
  const penalty = complexityPenalty[complexity] ?? 0;

  return { name: r.name, score: hits + categoryBonus + nameBonus + recipeBonus - penalty };
}

/**
 * Query FalkorDB for all techniques and score them by keyword overlap
 * with the description PLUS implementation-evidence (recipe count) and
 * complexity. This is the primary technique-discovery source.
 *
 * Scoring (sum):
 *   - hits          : token overlap with name/title/category
 *   - categoryBonus : +0.5 if a token equals the category
 *   - nameBonus     : +0.5 if a token is a word of the snake_case name
 *   - recipeBonus   : +1.5 if 2+ recipes implement; +0.75 if exactly 1
 *   - complexityPen : -1.0 (high), -2.0 (scene-tier) unless the brief
 *                     explicitly asks for scene-tier work
 *
 * The recipe bonus encodes "this technique is idiomatic enough that the KB
 * has multiple worked examples for it"; the complexity penalty counters the
 * vector-search bias toward rare-but-dense exotic technique pages.
 */
async function findTechniquesByKeyword(description: string, keep = 12): Promise<string[]> {
  const f = await getFalkor();
  const result = await f.roQuery(
    `MATCH (t:Technique)
     OPTIONAL MATCH (r:Recipe)-[:IMPLEMENTS]->(t)
     RETURN t.name AS name, t.title AS title, t.category AS category,
            t.complexity AS complexity, count(r) AS recipe_count`,
  );
  const tokens = briefTokens(description);
  const descLower = description.toLowerCase();
  const wantsSceneTier = SCENE_TIER_KEYWORDS.some((k) => descLower.includes(k));
  const complexityPenalty = wantsSceneTier ? COMPLEXITY_PENALTY_NONE : COMPLEXITY_PENALTY_NORMAL;

  return (
    parseRows(TechniqueScoreRow, result.data)
      .map((row) => scoreTechnique(row, tokens, complexityPenalty))
      .filter((s) => s.score > 0)
      // Score descending; alphabetical tiebreak so equal-score ranks are
      // stable across runs (Array.sort is now stable in V8 but the input
      // order from the graph query is not guaranteed).
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, keep) // keyword candidates; merging takes what it needs
      .map((s) => s.name)
  );
}

/**
 * Resolve technique names from keyword scoring (primary) + vector search
 * (supplementary). Returns up to `limit` + 8 unique technique names ordered
 * by relevance.
 *
 * Strategy: keyword scoring includes recipe-count and complexity signals
 * (see findTechniquesByKeyword), so it picks idiomatic foundations over
 * exotic siblings — exactly the bias we want. Vector search fills in
 * semantically-related techniques the keyword scorer might miss.
 *
 * Prior to 2026-05-18 the order was reversed (vector-first, keyword-fills),
 * which produced briefings dominated by rare/scene-tier techniques because
 * vector similarity scores higher for rare technique pages.
 */
export async function resolveProposedTechniques(description: string, limit = 8): Promise<string[]> {
  // Run both sources in parallel for speed
  const [searchResult, fromKeyword] = await Promise.all([
    search(description, 20),
    findTechniquesByKeyword(description, Math.max(12, limit)),
  ]);

  // 1. Collect technique names from vector search (technique-doc chunks only)
  const fromSearch: string[] = [];
  for (const hit of searchResult.structured.hits) {
    if (!hit.source.startsWith("techniques/")) continue;
    const name = extractTechniqueNameFromSection(hit.section);
    if (name && !fromSearch.includes(name)) fromSearch.push(name);
  }

  // 2. Merge: keyword names first (recipe + complexity weighted), then
  // vector names that aren't already included as a semantic supplement.
  // When the brief's own words already found most of the plan, the vector
  // side adds at most four: on a long brief it was filling the remaining
  // slots with guesses (a colour fade and a scroll buffer for a platformer
  // that named neither). A vague brief still gets the full supplement.
  const merged: string[] = [...fromKeyword];
  const supplementCap = fromKeyword.length >= 6 ? 4 : Infinity;
  let supplemented = 0;
  for (const name of fromSearch) {
    if (merged.length >= limit || supplemented >= supplementCap) break;
    if (!merged.includes(name)) {
      merged.push(name);
      supplemented++;
    }
  }

  // Hand back a few more than the limit: the caller caps per category, and
  // a slice taken here before that cap let sixteen raster and sprite hits
  // crowd out the brief's one maths noun.
  return merged.slice(0, limit + 8);
}
