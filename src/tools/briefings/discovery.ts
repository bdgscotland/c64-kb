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
 *   "Logic Techniques > vehicle_control — Top-down driving ... > How"
 * extract the snake_case technique name ("stable_raster_irq").
 *
 * The name is in the H2 segment. That is the last segment only for text
 * directly under the H2; an H3 chunk ends in its own heading ("How",
 * "Recipes"). Until 2026-09-23 only the last segment was read, so no H3
 * chunk, which is most of a modern technique page, contributed a name: a
 * road-shooter brief whose best vector hits were vehicle_control's H3s
 * got none of them.
 *
 * Coupling: this reads the chunker's output format (src/services/chunker.ts
 * joins `{H1} > {H2} > {H3}`), not a field of the payload. The technique-doc
 * H2 format is `## snake_name — Title`. If either changes, vector hits stop
 * contributing technique names here and briefings silently fall back to
 * keyword scoring alone. A technique-name field on the chunk payload would
 * remove this parse.
 */
export function extractTechniqueNameFromSection(section: string): string | null {
  for (const segment of section.split(" > ")) {
    const dashIdx = segment.indexOf(" — ");
    if (dashIdx === -1) continue;
    const candidate = segment.slice(0, dashIdx).trim();
    // Must be lowercase with underscores only (technique snake_case)
    if (/^[a-z][a-z0-9_]*$/.test(candidate)) return candidate;
  }
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

// Words that say nothing about a technique. "and" matched the name words of
// drive_code_upload_and_job_queue, compare_16bit_and_signed and
// text_window_and_menu, so every brief with an "and" in it proposed them;
// "game" matched sprite_multiplex_game in every game brief; "through" put
// colour_fade, dycp_scroller and hires_plot into a Boulder Dash plan.
const STOP_WORDS = new Set([
  "and",
  "the",
  "with",
  "without",
  "for",
  "from",
  "into",
  "onto",
  "through",
  "like",
  "style",
  "game",
  "games",
  "that",
  "this",
  "its",
  "their",
  "them",
  "then",
  "than",
  "when",
  "where",
  "which",
  "while",
  "via",
  "per",
  "any",
  "all",
  "each",
  "every",
  "some",
  "many",
  "more",
  "most",
  "are",
  "has",
]);

// Acronyms that are also English words. In lower case the brief means the
// word: "enemy cars ram" put screen_ram_relocation, charset_copy_rom_to_ram
// and char_scroll_buffer_h ("screen-RAM") into a road-shooter plan. In
// capitals ("RAM") it means the acronym.
const ACRONYM_HOMOGRAPHS = new Set(["ram"]);

/** A raw word the brief means as the English word, not the acronym. */
function isLowerCaseHomograph(raw: string): boolean {
  return ACRONYM_HOMOGRAPHS.has(raw.toLowerCase()) && raw !== raw.toUpperCase();
}

/** Tokenize and add stemmed variants (strip common suffixes like -ing, -er, -ers). */
export function briefTokens(description: string): string[] {
  const rawTokens = description
    .split(/[\s_,:;!?+\-()]+/)
    .filter((t) => !isLowerCaseHomograph(t))
    .map((t) => t.toLowerCase())
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
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

const AXIS_WORDS = { vertical: ["vertical", "vertically"], horizontal: ["horizontal", "horizontally"] };

/**
 * True when a technique scrolls along the axis the brief did not ask for:
 * the brief names one axis and not the other, and the technique, or one it
 * requires, has a name ending in the other axis letter (`_h`, `_v`) or a
 * title naming the other axis. "scroll" alone is a whole-word hit on every
 * scroll technique, so a vertically scrolling road shooter was proposed
 * char_scroll_buffer_h, soft_scroll_h and charset_parallax (which requires
 * infinite_scroll_h).
 */
export function contradictsBriefAxis(
  tech: { name: string; title: string; requires?: { name: string; title?: string }[] | undefined },
  description: string,
): boolean {
  const words = new Set(description.toLowerCase().split(/[^a-z]+/));
  const saysV = AXIS_WORDS.vertical.some((w) => words.has(w));
  const saysH = AXIS_WORDS.horizontal.some((w) => words.has(w));
  if (saysV === saysH) return false;
  const [letter, other] = saysV ? ["h", AXIS_WORDS.horizontal] : ["v", AXIS_WORDS.vertical];
  return [tech, ...(tech.requires ?? [])].some((t) => {
    const titleWords = new Set((t.title ?? "").toLowerCase().split(/[^a-z]+/));
    return t.name.endsWith(`_${letter}`) || other.some((w) => titleWords.has(w));
  });
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
): { name: string; hits: number; score: number } {
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

  return { name: r.name, hits, score: hits + categoryBonus + nameBonus + recipeBonus - penalty };
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
      // A technique must share a word with the brief. The recipe bonus is
      // positive on its own, so until 2026-09-23 every technique with a
      // recipe and no matching word scored 0.75 or 1.5 and filled a short
      // brief's empty slots in alphabetical order (char_rom_under_vic,
      // compare_16bit_and_signed, cpu_io_port_bank, decimal_print, ...).
      .filter((s) => s.hits > 0 && s.score > 0)
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
export async function resolveProposedTechniques(
  description: string,
  limit = 8,
  /** Techniques the caller already forces (an archetype's fingerprint); they count as found. */
  forcedCount = 0,
): Promise<string[]> {
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
  // that named neither). A vague brief still gets the full supplement. An
  // archetype's forced fingerprint counts as found: a short brief routed to
  // an archetype is not vague.
  const merged: string[] = [...fromKeyword];
  const supplementCap = fromKeyword.length + forcedCount >= 6 ? 4 : Infinity;
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
