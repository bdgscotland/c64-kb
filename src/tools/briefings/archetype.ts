/**
 * Archetype resolution against the graph, and the techniques a brief or an
 * archetype forces into the proposal.
 */

import { getFalkor } from "../../context.ts";
import { normaliseBriefText } from "../../graph/extract/archetype.ts";
import { ArchetypeRow, BriefWordsRow, NameRow, parseRows } from "./rows.ts";

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
  | { mode: "fallback" };

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
 * or no match routes nowhere and the plan is built from the description, as
 * before. The words are data on the page, so no genre or title is spelled
 * in this code.
 */
export async function routeArchetypeFromBrief(description: string): Promise<ArchetypeResolution | undefined> {
  const fk = await getFalkor();
  const result = await fk.roQuery(
    `MATCH (a:Archetype {kind: "game"}) RETURN a.name AS name, a.title AS title, a.kind AS kind, a.starter AS starter, a.brief_words AS brief_words ORDER BY name`,
  );
  const brief = normaliseBriefText(description);
  const scored = parseRows(BriefWordsRow, result.data).flatMap((r) => {
    if (!r.name) return [];
    const matched = wordsInBrief(brief, r.brief_words ?? []);
    return matched.length > 0
      ? [{ row: { name: r.name, title: r.title, kind: r.kind, starter: r.starter }, matched }]
      : [];
  });
  scored.sort((a, b) => b.matched.length - a.matched.length);
  const [first, second] = scored;
  if (!first || second?.matched.length === first.matched.length) return undefined;
  return { ...(await graphResolution(first.row)), inferred_from: first.matched };
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
const FORCED_BY_DESCRIPTION_PATTERN: { pattern: RegExp; techniques: string[] }[] = [
  {
    pattern:
      /\b(text[- ]mode|petscii|playfield|tetris|tetromino|sokoban|boulder dash|board game|falling (block|piece))\b/i,
    techniques: ["text_mode_overlay_render"],
  },
];

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
  } else if (resolved?.mode === "fallback" && archetype && isGame) {
    // The built-in tables are game genres; a demo form has no fallback.
    const key = archetype.toLowerCase();
    const terms = FALLBACK_ARCHETYPE_TERMS.get(key);
    if (terms) searchDescription = `${description} ${terms}`;
    forced.push(...(FALLBACK_FORCED_TECHNIQUES.get(key) ?? []));
  }
  for (const rule of FORCED_BY_DESCRIPTION_PATTERN) {
    if (!rule.pattern.test(description)) continue;
    for (const t of rule.techniques) if (!forced.includes(t)) forced.push(t);
  }
  const archetypeForced = new Set(resolved?.mode === "graph" ? resolved.features : []);
  return { searchDescription, forced, archetypeForced };
}
