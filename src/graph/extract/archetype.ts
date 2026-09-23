/**
 * archetype-reference pages (docs/CONVENTIONS-archetypes.md). The H2 is the
 * free-form title and an **Archetype:** line under it carries the
 * snake_case name. The fingerprint and pitfall lines are the edge sources.
 */

import { group, matchField, parseFrontmatter, splitH2Sections, warn, type Section } from "./common.ts";
import { TECHNIQUE_NAME } from "./technique-entities.ts";
import type { GraphEntity } from "./types.ts";

const ARCHETYPE_NAME_LINE = /^\*\*Archetype:\*\*\s+`?([a-z][a-z0-9_]*)`?\s*$/m;
const ARCHETYPE_FINGERPRINT = /^\*\*Technique fingerprint:\*\*\s+(.+)$/m;
const ARCHETYPE_PITFALLS = /^\*\*Common pitfalls:\*\*\s+(.+)$/m;
const ARCHETYPE_BRIEF_WORDS = /^\*\*Brief words:\*\*\s+(.+)$/m;

/**
 * The **Brief words:** line: comma-separated words or phrases, backticks
 * optional, that route a game brief naming no archetype to this one. Lower
 * case; an apostrophe is dropped and any other run of characters that are
 * not letters or digits reads as one space, so "beat-em-up" and "beat 'em
 * up" are one phrase. The briefing normalises the brief the same way.
 */
export function normaliseBriefText(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function briefWordList(line: string | undefined): string[] {
  if (!line) return [];
  const words = line.split(",").map((w) => normaliseBriefText(w));
  return [...new Set(words.filter((w) => w !== ""))];
}

type ArchetypeKind = "game" | "demo";

function isArchetypeKind(kind: string): kind is ArchetypeKind {
  return kind === "game" || kind === "demo";
}

interface Context {
  kind: ArchetypeKind;
  sourcePath: string;
  seenNames: Set<string>;
}

/**
 * Split a backticked, comma-separated name list; refuse anything that is
 * not a snake_case name here. Whether a name exists in the graph is settled
 * at link time, where a miss is warned about and counted.
 */
function nameList(line: string | undefined, where: string, label: string): string[] {
  if (!line) return [];
  const out: string[] = [];
  for (const raw of line.split(",")) {
    const n = raw.trim().replace(/`/g, "");
    if (!n) continue;
    if (!TECHNIQUE_NAME.test(n)) {
      warn(
        `${where} lists "${n}" under ${label}, which is not a snake_case name — not ingested (see CONVENTIONS-archetypes.md)`,
      );
      continue;
    }
    if (out.includes(n)) continue;
    out.push(n);
  }
  return out;
}

/** The archetype name a section declares, or null (warning when the section looks like a botched archetype). */
function sectionName(section: Section, title: string, ctx: Context): string | null {
  const nameM = ARCHETYPE_NAME_LINE.exec(section.body);
  if (!nameM) {
    // A prose H2 on an archetype page (history, cross-references, a
    // buildable-reference table) is allowed and silent. Only a section that
    // carries a fingerprint or pitfall line without naming its archetype is
    // a mistake worth a warning.
    if (ARCHETYPE_FINGERPRINT.test(section.body) || ARCHETYPE_PITFALLS.test(section.body)) {
      warn(
        `${ctx.sourcePath}: H2 "${title}" has a fingerprint or pitfall line but no **Archetype:** line — not ingested (see CONVENTIONS-archetypes.md)`,
      );
    }
    return null;
  }
  const name = group(nameM, 1);
  if (ctx.seenNames.has(name)) {
    warn(`${ctx.sourcePath}: archetype name "${name}" appears under two H2s — second one not ingested`);
    return null;
  }
  ctx.seenNames.add(name);
  return name;
}

function sectionEntities(section: Section, ctx: Context): GraphEntity[] {
  const title = section.heading.replace(/^##\s+/, "").trim();
  const name = sectionName(section, title, ctx);
  if (name === null) return [];
  const where = `${ctx.sourcePath}: archetype ${name}`;
  const features = nameList(
    matchField(section.body, ARCHETYPE_FINGERPRINT),
    where,
    "**Technique fingerprint:**",
  );
  const risks = nameList(matchField(section.body, ARCHETYPE_PITFALLS), where, "**Common pitfalls:**");
  const briefWords = briefWordList(matchField(section.body, ARCHETYPE_BRIEF_WORDS));
  return [
    { type: "archetype", name, title, kind: ctx.kind, source_doc: ctx.sourcePath, brief_words: briefWords },
    ...features.map((technique): GraphEntity => ({ type: "archetype_features", archetype: name, technique })),
    ...risks.map((pitfall): GraphEntity => ({ type: "archetype_risks", archetype: name, pitfall })),
  ];
}

export function parseArchetypeDoc(content: string, sourcePath: string): GraphEntity[] {
  const { fm, rest } = parseFrontmatter(content);
  const kind = fm.kind ?? "game";
  if (!isArchetypeKind(kind)) {
    warn(
      `${sourcePath}: archetype doc kind "${kind}" is not game or demo — no archetypes ingested from this file (see CONVENTIONS-archetypes.md)`,
    );
    return [];
  }
  const ctx: Context = { kind, sourcePath, seenNames: new Set() };
  return splitH2Sections(rest).flatMap((section) => sectionEntities(section, ctx));
}
