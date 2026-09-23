/**
 * technique-reference pages (docs/CONVENTIONS-techniques.md). Each
 * `## name — Title` H2 is one Technique; the bold metadata lines under it
 * become its properties and edges.
 */

import { group, parseFrontmatter, warn } from "./common.ts";
import { parseRasterBand } from "./raster-band.ts";
import { techniqueEntities, type TechniqueHead, type TechniqueMeta } from "./technique-entities.ts";
import type { GraphEntity } from "./types.ts";
import { COST_MAXIMUM, COST_VOCABULARY, TECHNIQUE_CATEGORIES, type TechniqueCost } from "./vocabulary.ts";

export const ENTITY_H2 = /^##\s+([a-z][a-z0-9_]*)\s+(?:—|--)\s+(.+)$/;
const COMPLEXITY_LINE = /^\*\*Complexity:\*\*\s+(low|medium|high|scene-tier)\s*$/;
export const REGION_LINE = /^\*\*Region:\*\*\s+(PAL|NTSC|both)\s*$/im;
const USES_REGISTERS = /^\*\*Uses registers:\*\*\s+(.+)$/;
const USES_KERNAL = /^\*\*Uses kernal:\*\*\s+(.+)$/;
const DEMANDS_LINE = /^\*\*Demands:\*\*\s+(.+)$/;
// **Requires:** names other Technique H2s that must be set up before, or run
// underneath, this one. Each word must be a snake_case technique name;
// whether it names an existing node is settled at link time, where a miss is
// warned about and counted.
const REQUIRES_LINE = /^\*\*Requires:\*\*\s+(.+)$/;
const RASTER_BAND_LINE = /^\*\*Raster band:\*\*\s+(.+)$/;
// **Cost:** carries key=value pairs from COST_VOCABULARY and **Cost basis:**
// one word from COST_BASIS_WORDS. A pair with an unknown key or a
// non-integer value is warned about and skipped; a basis word outside the
// set, or a Cost line with no basis line at all, drops the whole Cost line,
// because a number without an honest basis is worse than no number.
const COST_LINE = /^\*\*Cost:\*\*\s+(.+)$/;
const COST_BASIS_LINE = /^\*\*Cost basis:\*\*\s+(.+)$/;
const COST_PAIR = /^([a-z_]+)\s*=\s*(-?\d+)$/;
const INTEGER = /^-?\d+$/;

interface Current {
  head: TechniqueHead;
  meta: TechniqueMeta;
  sourcePath: string;
}

// Treat "(none)" / "none" / "[]" / "-" as empty so docs can author
// explicit-empty without leaking sentinel names into the graph.
function isEmptySentinel(v: string): boolean {
  const t = v.trim().toLowerCase();
  return t === "" || t === "(none)" || t === "none" || t === "[]" || t === "-";
}

function nameList(value: string, stripBackticks = false): string[] {
  if (isEmptySentinel(value)) return [];
  return value
    .split(",")
    .map((s) => (stripBackticks ? s.trim().replace(/`/g, "") : s.trim()))
    .filter((s) => s !== "" && !isEmptySentinel(s));
}

/** One `key=value` Cost pair, or null (with a warning) when it is refused. */
function costPair(pair: string, where: string): [string, number] | null {
  const eq = pair.indexOf("=");
  const key = (eq >= 0 ? pair.slice(0, eq) : pair).trim();
  const val = eq >= 0 ? pair.slice(eq + 1).trim() : "";
  if (!Object.hasOwn(COST_VOCABULARY, key)) {
    warn(
      `${where} has cost key "${key}", which is not in the cost vocabulary — pair skipped (see CONVENTIONS-techniques.md)`,
    );
    return null;
  }
  if (!COST_PAIR.test(pair) || !INTEGER.test(val) || Number(val) < 0) {
    warn(
      `${where} has cost ${key}=${JSON.stringify(val)}, which is not a non-negative integer — pair skipped (see CONVENTIONS-techniques.md)`,
    );
    return null;
  }
  const ceiling = COST_MAXIMUM[key];
  if (ceiling !== undefined && Number(val) > ceiling) {
    warn(
      `${where} has cost ${key}=${val}, above the hardware maximum of ${ceiling} — pair skipped (see CONVENTIONS-techniques.md)`,
    );
    return null;
  }
  return [key, Number(val)];
}

function parseCost(value: string, where: string): TechniqueCost {
  const cost: TechniqueCost = {};
  const pairs = isEmptySentinel(value)
    ? []
    : value
        .split(",")
        .map((s) => s.trim().replace(/`/g, ""))
        .filter((s) => s !== "");
  for (const pair of pairs) {
    const parsed = costPair(pair, where);
    if (parsed) cost[parsed[0]] = parsed[1];
  }
  return cost;
}

function applyRasterBand(value: string, c: Current): void {
  const band = parseRasterBand(value);
  if ("error" in band) {
    warn(
      `${c.sourcePath}: technique ${c.head.name} has **Raster band:** ${JSON.stringify(value.trim())}: ${band.error} — band not ingested, so the technique conflicts as if it had none (see CONVENTIONS-techniques.md)`,
    );
  } else {
    c.meta.rasterBand = band.canonical;
  }
}

/** Metadata lines under a technique H2, tried in order; the first whose pattern matches handles the line. */
const LINE_RULES: readonly { re: RegExp; apply: (value: string, c: Current) => void }[] = [
  { re: COMPLEXITY_LINE, apply: (v, c) => (c.head.complexity = v) },
  { re: REGION_LINE, apply: (v, c) => (c.meta.region = v) },
  { re: USES_REGISTERS, apply: (v, c) => (c.meta.usesReg = nameList(v)) },
  { re: USES_KERNAL, apply: (v, c) => (c.meta.usesKernal = nameList(v)) },
  { re: DEMANDS_LINE, apply: (v, c) => (c.meta.demands = nameList(v)) },
  { re: REQUIRES_LINE, apply: (v, c) => (c.meta.requires = nameList(v, true)) },
  { re: RASTER_BAND_LINE, apply: applyRasterBand },
  { re: COST_BASIS_LINE, apply: (v, c) => (c.meta.costBasis = v.trim().replace(/`/g, "")) },
  {
    re: COST_LINE,
    apply: (v, c) => (c.meta.cost = parseCost(v, `${c.sourcePath}: technique ${c.head.name}`)),
  },
];

function applyLine(line: string, c: Current): void {
  for (const { re, apply } of LINE_RULES) {
    const m = re.exec(line);
    if (m) {
      apply(group(m, 1), c);
      return;
    }
  }
}

/** The category from frontmatter, or null (with a warning when it is outside the ontology). */
function checkedCategory(category: string | undefined, sourcePath: string): string | null {
  if (!category) return null;
  if (TECHNIQUE_CATEGORIES.has(category)) return category;
  warn(
    `${sourcePath}: technique doc category "${category}" is not in the ontology's category set — no techniques ingested from this file (see CONVENTIONS-techniques.md)`,
  );
  return null;
}

export function parseTechniqueDoc(content: string, sourcePath: string): GraphEntity[] {
  const { fm, rest } = parseFrontmatter(content);
  const category = checkedCategory(fm.category, sourcePath);
  if (category === null) return [];
  const docChip = fm.chip;
  const entities: GraphEntity[] = [];
  let current: Current | null = null;
  const flush = (): void => {
    if (current) entities.push(...techniqueEntities(current.head, current.meta, sourcePath));
    current = null;
  };
  for (const line of rest.split("\n")) {
    const h2 = ENTITY_H2.exec(line);
    if (h2) {
      flush();
      const head: TechniqueHead = { name: group(h2, 1), title: group(h2, 2).trim(), category };
      if (docChip !== undefined) head.chip = docChip;
      current = { head, meta: {}, sourcePath };
    } else if (current) {
      applyLine(line, current);
    }
  }
  flush();
  return entities;
}
