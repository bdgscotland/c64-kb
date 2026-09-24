/**
 * Archetype resolution against the graph, and the techniques a brief or an
 * archetype forces into the proposal.
 */

import { getFalkor } from "../../context.ts";
import { normaliseBriefText } from "../../graph/extract/archetype.ts";
import { ArchetypeRow, BriefWordsRow, NameRow, parseRows } from "./rows.ts";
import { pickByGenreHeads } from "./route-heads.ts";

type Archetype = { name: string; title: string; kind: string; starter?: string };
export type ArchetypeResolution =
  | {
      mode: "graph";
      archetype: Archetype;
      features: string[];
      risks: string[];
      resolved_from?: string;
      /** Set when no archetype was named and the brief's words chose this one. */
      inferred_from?: string[];
    }
  | { mode: "not_found"; requested: string; known: string[]; candidates?: string[] }
  | { mode: "fallback" }
  /**
   * A game brief whose brief words tie, or whose genre noun ("platformer")
   * fits several archetypes (#19). None is chosen; the FEATURES and RISKS every candidate holds are
   * planned with, as a named archetype's are.
   */
  | {
      mode: "ambiguous";
      candidates: string[];
      from: string[];
      shared_features: string[];
      shared_risks: string[];
    };

type KnownArchetype = {
  name: string;
  title: string | null | undefined;
  kind: string | null | undefined;
  starter?: string | null | undefined;
};

/** "Vertical Shmup" / "vertical-shmup" / "Vertical_Shmup" all read as vertical_shmup. */
function normaliseArchetypeName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

async function knownArchetypes(): Promise<KnownArchetype[]> {
  const fk = await getFalkor();
  const all = await fk.roQuery(
    `MATCH (a:Archetype) RETURN a.name AS name, a.title AS title, a.kind AS kind, a.starter AS starter ORDER BY name`,
  );
  return parseRows(ArchetypeRow, all.data).flatMap((r) =>
    r.name ? [{ name: r.name, title: r.title, kind: r.kind, starter: r.starter }] : [],
  );
}

async function namesOf(cypher: string, name: string): Promise<string[]> {
  const fk = await getFalkor();
  const result = await fk.roQuery(cypher, { name });
  // t.name / p.name is set on every ingested node; a null would print as "".
  return parseRows(NameRow, result.data).map((x) => x.name ?? "");
}

type Match = { hits: KnownArchetype[]; resolvedFrom?: string } | { candidates: string[] };

/**
 * Exact name first. A partial name ("platformer", "shmup") resolves when
 * exactly one archetype contains every word of it; several matches are
 * reported as candidates rather than guessed between. The first blind build
 * spent a call learning that "platformer" is not a name.
 */
function matchArchetype(rows: KnownArchetype[], wanted: string, raw: string): Match {
  // Names are unique across every archetype page (the ingest MERGEs on
  // name alone), so at most one row matches exactly.
  const exact = rows.filter((r) => r.name === wanted);
  if (exact.length > 0 || !wanted) return { hits: exact };
  const words = wanted.split("_").filter(Boolean);
  const partial = rows.filter((r) => {
    const parts = r.name.split("_");
    return words.every((w) => parts.includes(w) || r.name.includes(w));
  });
  const distinct = [...new Set(partial.map((r) => r.name))];
  if (distinct.length === 1) return { hits: partial, resolvedFrom: raw };
  if (distinct.length > 1) return { candidates: distinct };
  return { hits: [] };
}

/**
 * Look the archetype up. When the graph holds no Archetype nodes at all
 * (fixture graphs, a store ingested before schema 21) the result is
 * "fallback" and the caller uses the built-in tables; a graph with
 * archetypes never falls back, so an unknown name is reported, not guessed.
 */
export async function resolveArchetype(
  raw: string,
  preferKind: "game" | "demo",
): Promise<ArchetypeResolution> {
  const rows = await knownArchetypes();
  if (rows.length === 0) return { mode: "fallback" };
  const known = () => [...new Set(rows.map((r) => r.name))];
  const match = matchArchetype(rows, normaliseArchetypeName(raw), raw);
  if ("candidates" in match) {
    return { mode: "not_found", requested: raw, known: known(), candidates: match.candidates };
  }
  // preferKind is a guard only: names are unique.
  const hit = match.hits.find((r) => r.kind === preferKind) ?? match.hits.at(0);
  if (!hit) return { mode: "not_found", requested: raw, known: known() };
  return {
    ...(await graphResolution(hit)),
    ...(match.resolvedFrom ? { resolved_from: match.resolvedFrom } : {}),
  };
}

async function graphResolution(hit: KnownArchetype) {
  const features = await namesOf(
    `MATCH (a:Archetype {name: $name})-[:FEATURES]->(t:Technique) RETURN t.name AS name ORDER BY name`,
    hit.name,
  );
  const risks = await namesOf(
    `MATCH (a:Archetype {name: $name})-[:RISKS]->(p:Pitfall) RETURN p.name AS name ORDER BY name`,
    hit.name,
  );
  return {
    mode: "graph" as const,
    archetype: {
      name: hit.name,
      title: hit.title ?? hit.name,
      kind: hit.kind ?? "game",
      ...(hit.starter ? { starter: hit.starter } : {}),
    },
    features,
    risks,
  };
}

/** The brief words of `words` that the normalised brief contains, a plural "s" or "es" allowed. */
function wordsInBrief(brief: string, words: readonly string[]): string[] {
  return words.filter((w) => new RegExp(`(^| )${w}(s|es)?( |$)`).test(brief));
}

/**
 * Route a game brief that names no archetype. Each game Archetype's
 * **Brief words:** line (docs/CONVENTIONS-archetypes.md) is matched against
 * the brief; the archetype with the most distinct words present wins. A tie
 * is returned as "ambiguous" with the tied archetypes as candidates. With no
 * phrase present, the brief's genre noun is read (route-heads.ts): "a
 * platformer" offers both platformers (#19). Until then a tie or no match
 * routed nowhere and said nothing. The words are data on the page, so no
 * genre or title is spelled in this code.
 */
export async function routeArchetypeFromBrief(description: string): Promise<ArchetypeResolution | undefined> {
  const fk = await getFalkor();
  const result = await fk.roQuery(
    `MATCH (a:Archetype {kind: "game"}) RETURN a.name AS name, a.title AS title, a.kind AS kind, a.starter AS starter, a.brief_words AS brief_words ORDER BY name`,
  );
  const rows = parseRows(BriefWordsRow, result.data).flatMap((r) =>
    r.name
      ? [
          {
            row: { name: r.name, title: r.title, kind: r.kind, starter: r.starter },
            words: r.brief_words ?? [],
          },
        ]
      : [],
  );
  const top = topByBriefWords(description, rows);
  const [pick] = top;
  if (pick && top.length === 1)
    return { ...(await graphResolution(pick.row.row)), inferred_from: pick.matched };
  // A tie is offered, not guessed between.
  if (pick) {
    const from = [...new Set(top.flatMap((t) => t.matched))].sort();
    return ambiguousResolution(
      top.map((t) => t.row.row),
      from,
    );
  }
  // No phrase matched: the brief's genre noun (route-heads.ts).
  const heads = pickByGenreHeads(
    description,
    rows.map((r) => ({ ...r, name: r.row.name })),
  );
  if (!heads) return undefined;
  if ("row" in heads) return { ...(await graphResolution(heads.row.row)), inferred_from: heads.matched };
  return ambiguousResolution(
    heads.candidates.map((c) => c.row),
    heads.matched,
  );
}

/** The FEATURES a plan is built on: the archetype's, or those every candidate shares. */
function archetypeFeatures(resolved: ArchetypeResolution | undefined): string[] {
  if (resolved?.mode === "graph") return resolved.features;
  if (resolved?.mode === "ambiguous") return resolved.shared_features;
  return [];
}

/** The RISKS a plan's pitfalls include: the archetype's, or those every candidate shares. */
export function archetypeRisks(resolved: ArchetypeResolution | undefined): string[] {
  if (resolved?.mode === "graph") return resolved.risks;
  if (resolved?.mode === "ambiguous") return resolved.shared_risks;
  return [];
}

/** Several archetypes fit: the features and risks all of them hold. */
async function ambiguousResolution(
  rows: readonly KnownArchetype[],
  from: string[],
): Promise<ArchetypeResolution> {
  const all = await Promise.all(rows.map((r) => graphResolution(r)));
  const inAll = (lists: string[][]) => (lists[0] ?? []).filter((x) => lists.every((l) => l.includes(x)));
  return {
    mode: "ambiguous",
    candidates: rows.map((r) => r.name).sort(),
    from,
    shared_features: inAll(all.map((a) => a.features)),
    shared_risks: inAll(all.map((a) => a.risks)),
  };
}

/** The archetype whose brief words the brief holds most of; undefined on a tie or no match. Pure. */
export function pickByBriefWords<R extends { words: readonly string[] }>(
  description: string,
  rows: readonly R[],
): { row: R; matched: string[] } | undefined {
  const top = topByBriefWords(description, rows);
  return top.length === 1 ? top[0] : undefined;
}

/** Every archetype tied at the highest count of brief words present; empty when none matched. Pure. */
export function topByBriefWords<R extends { words: readonly string[] }>(
  description: string,
  rows: readonly R[],
): { row: R; matched: string[] }[] {
  const brief = normaliseBriefText(description);
  const scored = rows.flatMap((row) => {
    const matched = wordsInBrief(brief, row.words);
    return matched.length > 0 ? [{ row, matched }] : [];
  });
  const best = Math.max(0, ...scored.map((s) => s.matched.length));
  return scored.filter((s) => s.matched.length === best);
}

// Built-in tables, used ONLY when the graph has no Archetype nodes. With the
// archetype page ingested (schema 21) the page is the source of truth and
// these are never read.
const FALLBACK_ARCHETYPE_TERMS = new Map<string, string>([
  ["shmup", "sprite multiplex scroll raster SID music shoot enemy"],
  ["platformer", "sprite scroll character collision SID music jump"],
  ["puzzle", "text mode overlay render playfield piece field character SID music logic"],
  ["adventure", "text mode overlay render character scroll SID music KERNAL"],
]);
const FALLBACK_FORCED_TECHNIQUES = new Map<string, string[]>([
  ["puzzle", ["text_mode_overlay_render"]],
  ["adventure", ["text_mode_overlay_render"]],
]);

// Description-level signals that force specific techniques regardless of
// archetype (e.g. a demo brief mentioning "text-mode playfield" should
// still get the rendering pitfall surfaced).
// The rules after the first came from the #39 starter builds (#41): each is
// a technique a builder needed that the keyword scorer never proposed.
const FORCED_BY_DESCRIPTION_PATTERN: { pattern: RegExp; techniques: string[]; reason?: string }[] = [
  {
    // "playfield" alone forced it until #97: every scrolling game has a
    // playfield, and the #22 shmup brief ("the playfield scrolls down") got
    // a falling-piece renderer.
    pattern:
      /\b(text[- ]mode|petscii|tetris|tetromino|sokoban|boulder dash|board game|falling (block|piece))\b/i,
    techniques: ["text_mode_overlay_render"],
  },
  {
    // A text adventure that saves and loads; a high score saved to disk.
    pattern: /^(?=[\s\S]*\bsav(?:e|ed|es|ing)\b)(?=[\s\S]*\b(?:disk|disc|drive|file)s?\b)/i,
    techniques: ["kernal_file_write_seq", "kernal_file_read_seq", "error_channel_check"],
    reason: "The brief saves to disk: a sequential file written and read back, and the drive's status read",
  },
  {
    // Level data, a map or an asset LOADed while the game runs (#97: the
    // #22 shmup brief loads level 2's map and got no LOAD technique).
    pattern: /\bload(?:s|ed|ing)?\b[^.]{0,40}\bfrom (?:the )?(?:disk|disc|drive)\b/i,
    techniques: ["kernal_load_to_address"],
    reason: "The brief loads data from disk while it runs: LOAD a file to an address the program chooses",
  },
  {
    // "Enemy variation is random" matched lfsr_random's title with one word
    // and lost to generic hits (#97).
    pattern: /\b(?:random(?:ly|ness|i[sz]ed?)?|pseudo-?random|rng)\b/i,
    techniques: ["lfsr_random"],
    reason: "The brief asks for random numbers: a linear-feedback shift register",
  },
  {
    pattern: /^(?=[\s\S]*\bPAL\b)(?=[\s\S]*\bNTSC\b)/i,
    techniques: ["pal_ntsc_detection"],
    reason: "The brief names PAL and NTSC: detect the machine at start",
  },
  {
    pattern: /\banimat\w* (?:characters?|chars?|tiles?|glyphs?)\b|\b(?:character|charset|tile) animation\b/i,
    techniques: ["charset_animation"],
    reason: "The brief animates characters: change the glyph, not the cells",
  },
  {
    pattern: /\banimat\w* sprites?\b|\bsprite animation\b|\banimation frames?\b/i,
    techniques: ["sprite_animation_table"],
    reason: "The brief animates sprites: frames and durations from a table",
  },
];

// Every game runs on a frame loop; the keyword scorer found it only when
// the brief said "frame" (#41: a fighter brief got none).
const GAME_FRAME_LOOP = "frame_sync_loop";
const GAME_FRAME_LOOP_REASON = "Every game needs a frame loop: one tick a frame for the rest to run on";

/** The techniques the description rules force, and the frame loop for a game, in rule order. */
function describedTechniques(description: string, isGame: boolean): string[] {
  const out = FORCED_BY_DESCRIPTION_PATTERN.filter((r) => r.pattern.test(description)).flatMap(
    (r) => r.techniques,
  );
  return isGame ? [...out, GAME_FRAME_LOOP] : out;
}

/** The reason a description rule, or the game frame loop, put this technique in the plan; undefined when none did. */
export function describedReason(name: string, description: string, isGame: boolean): string | undefined {
  if (isGame && name === GAME_FRAME_LOOP) return GAME_FRAME_LOOP_REASON;
  return FORCED_BY_DESCRIPTION_PATTERN.find((r) => r.techniques.includes(name) && r.pattern.test(description))
    ?.reason;
}

export type Seeds = {
  /** The text the technique search runs on. */
  searchDescription: string;
  /** Techniques prepended to the proposal, in order. */
  forced: string[];
  /** The archetype's FEATURES: these survive the per-category cap. */
  archetypeForced: Set<string>;
};

/**
 * For game briefs the archetype comes from the graph: its title widens the
 * search, its FEATURES are forced into the proposal (they survive the
 * per-category cap: the page authored them, the keyword scorer did not
 * guess them), its RISKS join the pitfalls. Only a graph with no Archetype
 * nodes reads the built-in tables.
 */
export function seedsFor(opts: {
  description: string;
  archetype: string | undefined;
  resolved: ArchetypeResolution | undefined;
  isGame: boolean;
}): Seeds {
  const { description, archetype, resolved, isGame } = opts;
  let searchDescription = description;
  const forced: string[] = [];
  if (resolved?.mode === "graph") {
    searchDescription = `${description} ${resolved.archetype.title}`;
    forced.push(...resolved.features);
  } else if (resolved?.mode === "ambiguous") {
    forced.push(...resolved.shared_features);
  } else if (resolved?.mode === "fallback" && archetype && isGame) {
    // The built-in tables are game genres; a demo form has no fallback.
    const key = archetype.toLowerCase();
    const terms = FALLBACK_ARCHETYPE_TERMS.get(key);
    if (terms) searchDescription = `${description} ${terms}`;
    forced.push(...(FALLBACK_FORCED_TECHNIQUES.get(key) ?? []));
  }
  for (const t of describedTechniques(description, isGame)) if (!forced.includes(t)) forced.push(t);
  const archetypeForced = new Set(archetypeFeatures(resolved));
  return { searchDescription, forced, archetypeForced };
}
