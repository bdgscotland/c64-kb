/**
 * game-design pages (docs/CONVENTIONS-game-designs.md, schema 28). Each H2
 * is one GameDesign: a whole game named by its archetype, the recipe that
 * builds it, the techniques it composes in each phase, and, when the built
 * game was timed, what its frame measured.
 */

import { BUDGET_PHASES, type BudgetPhase } from "../../domain/budget.ts";
import { COST_BASIS_WORDS, isCostBasis, type CostBasis } from "./vocabulary.ts";
import { group, matchField, splitH2Sections, warn, type Section } from "./common.ts";
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
  basis: CostBasis;
  source: string;
}

const NAME_LINE = /^\*\*Game design:\*\*\s+`?([a-z][a-z0-9_]*)`?\s*$/m;
const INSTANCE_OF_LINE = /^\*\*Instance of:\*\*\s+(.+)$/m;
const REALISED_BY_LINE = /^\*\*Realised by:\*\*\s+(.+)$/m;
const COMPOSES_LINE = /^\*\*Composes:\*\*\s+(.+)$/m;
const REGION_LINE = /^\*\*Region:\*\*\s+(PAL|NTSC|both)\s*$/im;
const MEASURED_LINE = /^\*\*Measured frame:\*\*\s+(.+)$/gm;
// A canonical recipe name: <toolchain>-<recipe>, lower case with hyphens.
const RECIPE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;
const COMPOSES_ITEM = /^([a-z][a-z0-9_]*)(?:\s*\(\s*([a-z]+)\s*\))?$/;
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

/**
 * `a, b (init), c (transition)`: each technique in a phase, play when no
 * phase is given. The same technique may be listed once per phase; a bad
 * item is warned about and skipped.
 */
export function parseComposes(line: string, where: string): { technique: string; phase: GameDesignPhase }[] {
  const out: { technique: string; phase: GameDesignPhase }[] = [];
  for (const item of items(line)) {
    const m = COMPOSES_ITEM.exec(item);
    const technique = m ? group(m, 1) : "";
    const phase = m ? group(m, 2) || "play" : "";
    if (!m || !TECHNIQUE_NAME.test(technique)) {
      warn(`${where}: **Composes:** item "${item}" is not "technique" or "technique (phase)" — skipped`);
      continue;
    }
    if (!isPhase(phase)) {
      warn(
        `${where}: **Composes:** phase "${phase}" is not one of ${GAME_DESIGN_PHASES.join(", ")} — skipped`,
      );
      continue;
    }
    if (out.some((c) => c.technique === technique && c.phase === phase)) continue;
    out.push({ technique, phase });
  }
  return out;
}

/**
 * `play pal worst=8693 typical=4966; play ntsc worst=10287 (measured-vice, <source>)`.
 * The parenthetical at the end is required: its first word is the basis,
 * the rest names where the figures are. Any malformed part refuses the
 * whole line, as a partial line would read as the whole measurement.
 */
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

export function parseMeasuredFrame(line: string): MeasuredFrame[] | { error: string } {
  const m = /^(.*?)\(\s*([a-z-]+)\s*,\s*(.+)\)\s*$/.exec(line.trim());
  if (!m) return { error: `no "(basis, source)" at the end` };
  const basis = group(m, 2);
  const source = group(m, 3).trim();
  if (!isCostBasis(basis)) return { error: `basis "${basis}" is not one of ${COST_BASIS_WORDS.join(", ")}` };
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

function measuredFrames(body: string, where: string): MeasuredFrame[] {
  const out: MeasuredFrame[] = [];
  for (const m of body.matchAll(MEASURED_LINE)) {
    const parsed = parseMeasuredFrame(group(m, 1));
    if ("error" in parsed) {
      warn(`${where}: **Measured frame:** line refused: ${parsed.error}`);
      continue;
    }
    for (const f of parsed) {
      if (out.some((o) => o.phase === f.phase && o.region === f.region)) {
        warn(
          `${where}: **Measured frame:** ${f.phase} ${f.region} is given on two lines — second one skipped`,
        );
        continue;
      }
      out.push(f);
    }
  }
  return out;
}

function designRegion(word: string | undefined): "PAL" | "NTSC" | "both" | undefined {
  const w = word?.toUpperCase();
  if (w === "PAL" || w === "NTSC") return w;
  return w === "BOTH" ? "both" : undefined;
}

function sectionEntities(section: Section, sourcePath: string, seen: Set<string>): GraphEntity[] {
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
  if (!composesLine) warn(`${where} has no **Composes:** line; it budgets nothing`);
  const composes = composesLine ? parseComposes(composesLine, where) : [];
  const region = designRegion(matchField(section.body, REGION_LINE));
  return [
    {
      type: "game_design",
      name,
      title,
      ...(region ? { region } : {}),
      measured: measuredFrames(section.body, where),
      source_doc: sourcePath,
    },
    ...composes.map((c): GraphEntity => ({ type: "composes", design: name, ...c })),
    ...names(matchField(section.body, INSTANCE_OF_LINE), TECHNIQUE_NAME, where, "**Instance of:**").map(
      (archetype): GraphEntity => ({ type: "instance_of", design: name, archetype }),
    ),
    ...names(matchField(section.body, REALISED_BY_LINE), RECIPE_NAME, where, "**Realised by:**").map(
      (recipe): GraphEntity => ({ type: "realised_by", design: name, recipe }),
    ),
  ];
}

export function parseGameDesignDoc(content: string, sourcePath: string): GraphEntity[] {
  const seen = new Set<string>();
  return splitH2Sections(content).flatMap((s) => sectionEntities(s, sourcePath, seen));
}
