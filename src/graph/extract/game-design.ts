/**
 * game-design pages (docs/CONVENTIONS-game-designs.md, schema 28). Each H2
 * is one GameDesign: a whole game named by its archetype, the recipe that
 * builds it, the techniques it composes in each phase, and, when the built
 * game was timed, what its frame measured. Since schema 40 a page with
 * frontmatter `kind: studied` describes a released game the RE tools
 * measured; its extra lines are read in game-study.ts.
 */

import { BUDGET_PHASES, type BudgetPhase } from "../../domain/budget.ts";
import { splitCalls, type CallCount } from "../../domain/calls.ts";
import { MEASURED_FRAME_BASIS_WORDS, isMeasuredFrameBasis, type MeasuredFrameBasis } from "./vocabulary.ts";
import { group, matchField, parseFrontmatter, splitH2Sections, warn, type Section } from "./common.ts";
import {
  parseDivergence,
  parseIrqChain,
  parseMemoryMap,
  parseStudiedFrom,
  type IrqChain,
  type MemoryMap,
  type StudiedFrom,
} from "./game-study.ts";
import { TECHNIQUE_NAME } from "./technique-entities.ts";
import type { GraphEntity } from "./types.ts";

// The phases c64_plan_budget budgets apart; a design names the same three.
const GAME_DESIGN_PHASES = BUDGET_PHASES;
export type GameDesignPhase = BudgetPhase;

/** One `<phase> <region> worst=N [typical=N]` entry of a **Measured frame:** line. */
export interface MeasuredFrame {
  phase: GameDesignPhase;
  region: "PAL" | "NTSC";
  worst: number;
  typical?: number;
  basis: MeasuredFrameBasis;
  source: string;
}

type DesignKind = "built" | "studied";

const NAME_LINE = /^\*\*Game design:\*\*\s+`?([a-z][a-z0-9_]*)`?\s*$/m;
const INSTANCE_OF_LINE = /^\*\*Instance of:\*\*\s+(.+)$/m;
const REALISED_BY_LINE = /^\*\*Realised by:\*\*\s+(.+)$/m;
const COMPOSES_LINE = /^\*\*Composes:\*\*\s+(.+)$/m;
const REGION_LINE = /^\*\*Region:\*\*\s+(PAL|NTSC|both)\s*$/im;
const MEASURED_LINE = /^\*\*Measured frame:\*\*\s+(.+)$/gm;
const STUDIED_FROM_LINE = /^\*\*Studied from:\*\*\s+(.+)$/gm;
const IRQ_CHAIN_LINE = /^\*\*IRQ chain:\*\*\s+(.+)$/gm;
const MEMORY_MAP_LINE = /^\*\*Memory map:\*\*\s+(.+)$/gm;
const DIVERGES_LINE = /^\*\*Diverges from archetype:\*\*\s+(.+)$/gm;
// The basis a studied game's frame takes, refused on a built design.
const STUDY_BASIS = "measured-vice-study";
// A canonical recipe name: <toolchain>-<recipe>, lower case with hyphens.
const RECIPE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;
// An optional phase in parentheses at the end of a Composes item.
const PHASE_SUFFIX = /^(.*?)\s*\(\s*([a-z]+)\s*\)$/;
const MEASURED_ENTRY = /^([a-z]+)\s+(pal|ntsc)\s+(.+)$/i;
const MEASURED_PAIR = /^(worst|typical)=(\d+)$/;

function isPhase(word: string): word is GameDesignPhase {
  return GAME_DESIGN_PHASES.some((p) => p === word);
}

/** Backticks off, trimmed, empty items dropped. */
function items(line: string): string[] {
  return line
    .split(",")
    .map((s) => s.trim().replace(/`/g, ""))
    .filter(Boolean);
}

/** Names that pass `re`; any other is warned about and skipped. Repeats are folded. */
function names(line: string | undefined, re: RegExp, where: string, label: string): string[] {
  if (!line) return [];
  const out: string[] = [];
  for (const n of items(line)) {
    if (!re.test(n)) {
      warn(`${where} lists "${n}" under ${label}, which is not a valid name — not ingested`);
      continue;
    }
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

/** One Composes item's parts: technique, phase word, call count; or why it is refused. */
function composesItem(
  item: string,
): { technique: string; phase: string; calls?: CallCount } | { error: string } {
  const p = PHASE_SUFFIX.exec(item);
  const split = splitCalls(p ? group(p, 1) : item);
  if ("error" in split) return split;
  if (!TECHNIQUE_NAME.test(split.name))
    return { error: `"${item}" is not "technique", "technique ×N" or "technique (phase)"` };
  const phase = p ? group(p, 2) : "play";
  return { technique: split.name, phase, ...(split.calls ? { calls: split.calls } : {}) };
}

export interface ComposesItem {
  technique: string;
  phase: GameDesignPhase;
  /** Calls per frame, when the item states `×N` or `×M-N` (#37); absent is one. */
  calls?: CallCount;
}

/**
 * `a, b ×2-7, c (init), d (transition)`: each technique in a phase, play
 * when no phase is given, with an optional call count. The same technique
 * may be listed once per phase; a bad item is warned about and skipped.
 */
export function parseComposes(line: string, where: string): ComposesItem[] {
  const out: ComposesItem[] = [];
  for (const item of items(line)) {
    const parsed = composesItem(item);
    if ("error" in parsed) {
      warn(`${where}: **Composes:** item ${parsed.error} — skipped`);
      continue;
    }
    const { technique, phase } = parsed;
    if (!isPhase(phase)) {
      warn(
        `${where}: **Composes:** phase "${phase}" is not one of ${GAME_DESIGN_PHASES.join(", ")} — skipped`,
      );
      continue;
    }
    if (out.some((c) => c.technique === technique && c.phase === phase)) continue;
    out.push({ technique, phase, ...(parsed.calls ? { calls: parsed.calls } : {}) });
  }
  return out;
}

/** One `<phase> <pal|ntsc> worst=N [typical=N]` entry, or why it is refused. */
function parseMeasuredEntry(entry: string): Omit<MeasuredFrame, "basis" | "source"> | { error: string } {
  const e = MEASURED_ENTRY.exec(entry);
  if (!e) return { error: `"${entry}" is not "<phase> <pal|ntsc> worst=N [typical=N]"` };
  const phase = group(e, 1).toLowerCase();
  if (!isPhase(phase)) return { error: `phase "${phase}" is not one of ${GAME_DESIGN_PHASES.join(", ")}` };
  const region = group(e, 2).toUpperCase() === "PAL" ? "PAL" : "NTSC";
  const figures = new Map<string, number>();
  for (const pair of group(e, 3).trim().split(/\s+/)) {
    const p = MEASURED_PAIR.exec(pair);
    if (!p) return { error: `"${pair}" is not worst=N or typical=N` };
    figures.set(group(p, 1), Number(group(p, 2)));
  }
  const worst = figures.get("worst");
  if (worst === undefined) return { error: `"${entry}" has no worst=` };
  const typical = figures.get("typical");
  return { phase, region, worst, ...(typical !== undefined ? { typical } : {}) };
}

/**
 * `play pal worst=8693 typical=4966; play ntsc worst=10287 (measured-vice, <source>)`.
 * The parenthetical at the end is required: its first word is the basis,
 * the rest names where the figures are. Any malformed part refuses the
 * whole line, as a partial line would read as the whole measurement.
 */
export function parseMeasuredFrame(line: string): MeasuredFrame[] | { error: string } {
  const m = /^(.*?)\(\s*([a-z-]+)\s*,\s*(.+)\)\s*$/.exec(line.trim());
  if (!m) return { error: `no "(basis, source)" at the end` };
  const basis = group(m, 2);
  const source = group(m, 3).trim();
  if (!isMeasuredFrameBasis(basis))
    return { error: `basis "${basis}" is not one of ${MEASURED_FRAME_BASIS_WORDS.join(", ")}` };
  const out: MeasuredFrame[] = [];
  const entries = group(m, 1)
    .split(";")
    .map((x) => x.trim())
    .filter(Boolean);
  for (const entry of entries) {
    const parsed = parseMeasuredEntry(entry);
    if ("error" in parsed) return parsed;
    if (out.some((f) => f.phase === parsed.phase && f.region === parsed.region))
      return { error: `${parsed.phase} ${parsed.region} is given twice` };
    out.push({ ...parsed, basis, source });
  }
  if (out.length === 0) return { error: "no measured entries" };
  return out;
}

/**
 * Every line's entries, in page order. Two lines may give the same phase
 * and region: each line is its own measurement (a build, an instrument, a
 * run) with its own basis and source. Before #107 the second was skipped
 * with a warning, while the conventions allowed it.
 */
function measuredFrames(body: string, where: string, kind: DesignKind): MeasuredFrame[] {
  const out: MeasuredFrame[] = [];
  for (const m of body.matchAll(MEASURED_LINE)) {
    const parsed = parseMeasuredFrame(group(m, 1));
    if ("error" in parsed) {
      warn(`${where}: **Measured frame:** line refused: ${parsed.error}`);
      continue;
    }
    if (kind === "built" && parsed.some((f) => f.basis === STUDY_BASIS)) {
      warn(
        `${where}: **Measured frame:** line refused: basis ${STUDY_BASIS} is a studied game's, and this page is not kind: studied`,
      );
      continue;
    }
    out.push(...parsed);
  }
  return out;
}

/** Every line `re` matches, each parsed; a refused line is warned about and left out. */
function everyLine<T>(
  body: string,
  re: RegExp,
  at: { label: string; where: string },
  parse: (l: string) => T[] | { error: string },
): T[] {
  const { label, where } = at;
  const out: T[] = [];
  for (const m of body.matchAll(re)) {
    const parsed = parse(group(m, 1));
    if (!Array.isArray(parsed)) {
      warn(`${where}: **${label}:** line refused: ${parsed.error}`);
      continue;
    }
    out.push(...parsed);
  }
  return out;
}

/** A one-value line parser as a list parser, for everyLine. */
function asList<T extends object>(
  parse: (l: string) => T | { error: string },
): (l: string) => T[] | { error: string } {
  return (l) => {
    const r = parse(l);
    return "error" in r ? r : [r];
  };
}

interface StudyFields {
  studied_from?: StudiedFrom;
  irq_chain: IrqChain[];
  memory_map: MemoryMap[];
  edges: GraphEntity[];
}

// The four study lines by label; a built page carrying one is warned about.
const STUDY_LABELS = ["Studied from", "IRQ chain", "Memory map", "Diverges from archetype"] as const;

function hasLine(body: string, label: string): boolean {
  return body.split("\n").some((l) => l.startsWith(`**${label}:**`));
}

/** The study lines of a studied design, or nothing (with a warning per line) on a built one. */
function studyFields(body: string, name: string, where: string, kind: DesignKind): StudyFields {
  if (kind === "built") {
    for (const label of STUDY_LABELS)
      if (hasLine(body, label))
        warn(`${where}: **${label}:** is only read on a kind: studied page — ignored`);
    return { irq_chain: [], memory_map: [], edges: [] };
  }
  if (!hasLine(body, "Studied from")) warn(`${where} is kind: studied but has no **Studied from:** line`);
  // One Studied from line is read; a second is the same study twice, or two studies on one page.
  const froms = everyLine(
    body,
    STUDIED_FROM_LINE,
    { label: "Studied from", where },
    asList(parseStudiedFrom),
  );
  if (froms.length > 1)
    warn(
      `${where}: more than one **Studied from:** line parses — only the first (${froms[0]?.title}) is read`,
    );
  const from = froms.at(0);
  const diverges = everyLine(
    body,
    DIVERGES_LINE,
    { label: "Diverges from archetype", where },
    parseDivergence,
  );
  return {
    ...(from ? { studied_from: from } : {}),
    irq_chain: everyLine(body, IRQ_CHAIN_LINE, { label: "IRQ chain", where }, parseIrqChain),
    memory_map: everyLine(body, MEMORY_MAP_LINE, { label: "Memory map", where }, asList(parseMemoryMap)),
    edges: [
      ...(from ? [{ type: "studies" as const, design: name, production: from.title }] : []),
      ...diverges.map((d): GraphEntity => ({ type: "diverges_from", design: name, ...d })),
    ],
  };
}

function designRegion(word: string | undefined): "PAL" | "NTSC" | "both" | undefined {
  const w = word?.toUpperCase();
  if (w === "PAL" || w === "NTSC") return w;
  return w === "BOTH" ? "both" : undefined;
}

function sectionEntities(
  section: Section,
  sourcePath: string,
  seen: Set<string>,
  kind: DesignKind,
): GraphEntity[] {
  const title = section.heading.replace(/^##\s+/, "").trim();
  const nameM = NAME_LINE.exec(section.body);
  if (!nameM) {
    if (COMPOSES_LINE.test(section.body))
      warn(
        `${sourcePath}: H2 "${title}" has a **Composes:** line but no **Game design:** line — not ingested`,
      );
    return [];
  }
  const name = group(nameM, 1);
  if (seen.has(name)) {
    warn(`${sourcePath}: game design "${name}" appears under two H2s — second one not ingested`);
    return [];
  }
  seen.add(name);
  const where = `${sourcePath}: game design ${name}`;
  const composesLine = matchField(section.body, COMPOSES_LINE);
  // A study states what it measured; the techniques it departs by are on its Diverges line.
  if (!composesLine && kind === "built") warn(`${where} has no **Composes:** line; it budgets nothing`);
  const composes = composesLine ? parseComposes(composesLine, where) : [];
  const region = designRegion(matchField(section.body, REGION_LINE));
  const { edges, ...study } = studyFields(section.body, name, where, kind);
  return [
    {
      type: "game_design",
      name,
      title,
      ...(region ? { region } : {}),
      measured: measuredFrames(section.body, where, kind),
      source_doc: sourcePath,
      kind,
      ...study,
    },
    ...edges,
    ...composes.map((c): GraphEntity => ({ type: "composes", design: name, ...c })),
    ...names(matchField(section.body, INSTANCE_OF_LINE), TECHNIQUE_NAME, where, "**Instance of:**").map(
      (archetype): GraphEntity => ({ type: "instance_of", design: name, archetype }),
    ),
    ...names(matchField(section.body, REALISED_BY_LINE), RECIPE_NAME, where, "**Realised by:**").map(
      (recipe): GraphEntity => ({ type: "realised_by", design: name, recipe }),
    ),
  ];
}

/** Frontmatter `kind`: built when absent; any other word is warned about and read as built. */
function designKind(content: string, sourcePath: string): DesignKind {
  const kind = parseFrontmatter(content).fm.kind;
  if (kind === undefined || kind === "built") return "built";
  if (kind === "studied") return "studied";
  warn(`${sourcePath}: frontmatter kind "${kind}" is not built or studied — read as built`);
  return "built";
}

export function parseGameDesignDoc(content: string, sourcePath: string): GraphEntity[] {
  const seen = new Set<string>();
  const kind = designKind(content, sourcePath);
  return splitH2Sections(content).flatMap((s) => sectionEntities(s, sourcePath, seen, kind));
}
