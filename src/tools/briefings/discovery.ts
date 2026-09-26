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
  // Adverbs and prepositions of place and time. In the #22 shmup brief
  // "scrolls down", "above a fixed panel" and "on screen at once" matched
  // high_score_table_insert ("shift down"), mouse_1351_read and
  // light_pen_read ("once per frame") (#97).
  "down",
  "over",
  "above",
  "once",
  "also",
  "least",
  // A verb in a brief ("run and gun", "runs at 50 fps"); it matched
  // relocated_code_block's "Code stored at one address and run at another"
  // in the FIREBASE brief (KB-GAPS 2).
  "run",
]);

// Phrases whose nouns do not name a part. "Sprites on screen at once" is not
// about the screen, "a map three screens tall" gives a size and "one pixel
// a frame" a speed; the #22 shmup brief's "screen" and "pixel" matched
// tile_map_render, screen_wipe and hires_plot through them (#97).
const IDIOMS =
  /\b(?:on|off)[- ]screen\b|\bscreens? (?:tall|wide|high|long)\b|\b(?:one|\d+) pixels? (?:a|per) frame\b/gi;

// Acronyms that are also English words. In lower case the brief means the
// word: "enemy cars ram" put screen_ram_relocation, charset_copy_rom_to_ram
// and char_scroll_buffer_h ("screen-RAM") into a road-shooter plan. In
// capitals ("RAM") it means the acronym.
const ACRONYM_HOMOGRAPHS = new Set(["ram"]);

/** A raw word the brief means as the English word, not the acronym. */
function isLowerCaseHomograph(raw: string): boolean {
  return ACRONYM_HOMOGRAPHS.has(raw.toLowerCase()) && raw !== raw.toUpperCase();
}

// Number words count things in a brief ("eight events", "a four-sprite
// player"); matched against names and titles they proposed
// sprite_sine_chain ("Eight sprites ...") for eight events and
// four_player_read for a four-sprite player (#41). A name that starts with
// one is matched as a phrase instead (numberPhraseMissing).
const NUMBER_WORDS = new Set(["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"]);

/**
 * One spelling for the words that have two: the brief's "multicolour
 * bitmap" matched mci_interlace_bitmap's "Multicolour" title and missed
 * multicolor_bitmap (#41).
 */
export function oneSpelling(word: string): string {
  return word.replace(/colour/g, "color");
}

/**
 * A name that starts with a number word (four_player_read,
 * two_player_state_swap, eight_way_scroll_double_buffer) is proposed only
 * when the brief says the phrase: "four player", "four-player", "4-player".
 */
export function numberPhraseMissing(name: string, description: string): boolean {
  const [first = "", second = ""] = name.split("_");
  if (!NUMBER_WORDS.has(first) || second === "") return false;
  const digit = [...NUMBER_WORDS].indexOf(first) + 1;
  return !new RegExp(String.raw`\b(${first}|${digit})[- ]${second}`, "i").test(description);
}

/** Tokenize and add stemmed variants (strip common suffixes like -ing, -er, -ers). */
export function briefTokens(description: string): string[] {
  const rawTokens = description
    .replace(IDIOMS, " ")
    .split(/[\s_,:;!?+\-()]+/)
    .filter((t) => !isLowerCaseHomograph(t))
    .map((t) => oneSpelling(t.toLowerCase().replace(/\.+$/, "")))
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t) && !NUMBER_WORDS.has(t));
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

// Name words that mark a demo effect wherever its page sits:
// mci_interlace_bitmap, sprite_sine_chain and dypp_sprite_sine_scroller sit
// on the bitmap and sprite pages, and game briefs drew them in by "bitmap",
// "sprite" or "eight" (#41).
const EFFECT_NAME_WORDS = new Set([
  "interlace",
  "mci",
  "fli",
  "ifli",
  "afli",
  "vsp",
  "dycp",
  "dypp",
  "dysp",
  "fld",
  "sine",
  "plasma",
  "twister",
  "rotozoom",
  "wobbler",
  "shadebobs",
  "bobs",
  "vector",
  "voxel",
  "plotter",
]);
// Words of an effect page's names too common in game briefs to name the effect.
const GENERIC_NAME_WORDS = new Set([
  "screen",
  "sprite",
  "sprites",
  "text",
  "raster",
  "mode",
  "color",
  "colour",
]);

/**
 * True when a technique is a demo effect the brief does not name: its page
 * is in the effect category, or its name carries an effect word, and no
 * distinctive word of its name is in the brief. The caller applies it to
 * game briefs, for techniques nothing forced (#41: a Knight Games brief was
 * proposed mci_interlace_bitmap, vector_balls_sprites, dot_flag_sine_plotter
 * and hires_plot, and they drove its budget over the frame).
 */
export function unaskedEffect(t: { name: string; category: string }, description: string): boolean {
  const words = t.name.split("_").map(oneSpelling);
  // An effect page's technique is asked for by its head word, the first
  // distinctive word of its name. Any word of the name let "trees and walls
  // block him" propose raycaster_grid_walls for a run-and-gun (KB-GAPS 2).
  const head = words.find((w) => w.length >= 4 && !GENERIC_NAME_WORDS.has(w));
  const marks =
    t.category === "effect" ? (head ? [head] : []) : words.filter((w) => EFFECT_NAME_WORDS.has(w));
  if (marks.length === 0) return false;
  const tokens = new Set(briefTokens(description));
  return !marks.some((w) => tokens.has(w));
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

const INFLECTIONS = new Set(["s", "es", "ing", "er", "ers", "ed"]);

/** The shortest token `t` inflects ("sprites" → "sprite", "characters" → "charact"), or `t`. */
function wordBase(t: string, tokens: readonly string[]): string {
  let base = t;
  for (const u of tokens) {
    if (u.length < base.length && t.startsWith(u) && INFLECTIONS.has(t.slice(u.length))) base = u;
  }
  return base;
}

/** Whether `a` is `b` or an inflection of it, either way round ("draws" and "draw", "block" and "blocking"). */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  return long.startsWith(short) && INFLECTIONS.has(long.slice(short.length));
}

/** The words of a technique's name and title, or of an archetype's title, as the scorer splits them. */
function phraseWords(phrase: string): string[] {
  return oneSpelling(phrase.toLowerCase())
    .split(/[^a-z0-9$.]+|_/)
    .filter((w) => w.length >= 3);
}

/**
 * The brief tokens that the archetype's fingerprint already answers: a word
 * of a fingerprint technique's name or title, inflections included, unless
 * the archetype's title holds it. Such a word says nothing more about the
 * plan, so it proposes nothing beside the fingerprint. The FIREBASE
 * brief's "map" (row_map_redraw) proposed tile_map_render, "block"
 * (char_attribute_flags' "blocking") relocated_code_block, "sprite"
 * (sprite_multiplex_game) multi_sprite_object and "draw" (its "draw-behind")
 * per_frame_hitbox (KB-GAPS 2). Pure.
 */
export function coveredWords(
  tokens: readonly string[],
  phrases: readonly string[],
  archetypeTitle = "",
): Set<string> {
  const words = phrases.flatMap(phraseWords);
  // The archetype's title is added to the search to widen it (seedsFor), so
  // its words stay live: "Vertical" is how vertical_shmup's road-shooter
  // brief reaches vehicle_control.
  const title = phraseWords(archetypeTitle);
  return new Set(
    tokens.filter((t) => !title.some((w) => sameWord(t, w)) && words.some((w) => sameWord(t, w))),
  );
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
  const name = oneSpelling(r.name.toLowerCase());
  const title = oneSpelling((r.title ?? "").toLowerCase());
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
  // One brief word counts once: "sprites" and its stem "sprite" both hit a
  // title with "sprites" and a name with "sprite", which scored
  // mixed_sprite_char_actors and software_sprite_preshifted two hits for
  // the one word in the #22 shmup brief (#97).
  const hits = new Set(tokens.filter((t) => words.has(t)).map((t) => wordBase(t, tokens))).size;

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
async function findTechniquesByKeyword(
  description: string,
  keep: number,
  fingerprint: Fingerprint | undefined,
): Promise<string[]> {
  const f = await getFalkor();
  const result = await f.roQuery(
    `MATCH (t:Technique)
     OPTIONAL MATCH (r:Recipe)-[:IMPLEMENTS]->(t)
     RETURN t.name AS name, t.title AS title, t.category AS category,
            t.complexity AS complexity, count(r) AS recipe_count`,
  );
  const rows = parseRows(TechniqueScoreRow, result.data);
  const allTokens = briefTokens(description);
  const covered = fingerprint
    ? coveredWords(allTokens, fingerprintPhrases(fingerprint, rows), fingerprint.title)
    : new Set<string>();
  const tokens = allTokens.filter((t) => !covered.has(t));
  const descLower = description.toLowerCase();
  const wantsSceneTier = SCENE_TIER_KEYWORDS.some((k) => descLower.includes(k));
  const complexityPenalty = wantsSceneTier ? COMPLEXITY_PENALTY_NONE : COMPLEXITY_PENALTY_NORMAL;

  const scored = rows
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
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return scored.slice(0, keep).map((s) => s.name); // keyword candidates; merging takes what it needs
}

/** An archetype's forced fingerprint and its title, which the brief's words need not find again. */
export type Fingerprint = { names: readonly string[]; title: string };

/** "name title" for each fingerprint technique the graph holds. */
function fingerprintPhrases(fp: Fingerprint, rows: z.infer<typeof TechniqueScoreRow>[]): string[] {
  const names = new Set(fp.names);
  return rows.filter((r) => names.has(r.name)).map((r) => `${r.name} ${r.title ?? ""}`);
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
  /**
   * The resolved archetype's fingerprint. With it, a brief word the
   * fingerprint already answers proposes nothing more (KB-GAPS 2).
   */
  fingerprint?: Fingerprint,
): Promise<string[]> {
  // Run both sources in parallel for speed
  const [searchResult, fromKeyword] = await Promise.all([
    search(description, 20),
    findTechniquesByKeyword(description, Math.max(12, limit), fingerprint),
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
  return merged.filter((n) => !numberPhraseMissing(n, description)).slice(0, limit + 8);
}
