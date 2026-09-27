/**
 * Game-design patterns: the `## name — Title` entries on the game-design
 * pages that carry an `**Applies to:**` line of archetype names
 * (game-structure.md: the state machine, the front end, level ends and
 * transitions; enemy-behaviour-and-difficulty.md). They are not graph
 * nodes, so no briefing reached them and no lookup found them by name:
 * `game-briefing --archetype vertical_run_and_gun` proposed no front end,
 * and `technique-lookup front_end_and_attract` said "not found" (KB-GAPS
 * 28, FIREBASE build). Read from the pages on disk, as a recipe's listing
 * is.
 */

import fs from "node:fs";
import path from "node:path";

export interface DesignPattern {
  name: string;
  title: string;
  /** Relative to the docs directory. */
  source: string;
  applies_to: string[];
  realised_by: string[];
}

const H2 = /^##\s+([a-z][a-z0-9_]*)\s+(?:—|--)\s+(.+)$/;
const APPLIES = /^\*\*Applies to:\*\*\s+(.+)$/;
const REALISED = /^\*\*Realised by:\*\*\s+(.+)$/;

const list = (v: string) =>
  v
    .split(",")
    .map((s) => s.trim().replace(/`/g, ""))
    .filter(Boolean);

/** Every pattern on one page; an H2 with no Applies to line is not one. Pure. */
export function parseDesignPatterns(markdown: string, source: string): DesignPattern[] {
  const out: DesignPattern[] = [];
  let current: DesignPattern | null = null;
  let applies = false;
  const flush = () => {
    if (current && applies) out.push(current);
  };
  for (const line of markdown.split(/\r?\n/)) {
    if (/^##\s/.test(line)) {
      flush();
      const m = H2.exec(line);
      current = m
        ? { name: m[1] ?? "", title: (m[2] ?? "").trim(), source, applies_to: [], realised_by: [] }
        : null;
      applies = false;
      continue;
    }
    if (!current) continue;
    const a = APPLIES.exec(line);
    if (a) {
      current.applies_to = list(a[1] ?? "");
      applies = true;
    }
    const r = REALISED.exec(line);
    if (r) current.realised_by = list(r[1] ?? "");
  }
  flush();
  return out;
}

/** Every pattern on the game-design pages, in page then heading order. */
function allPatterns(docsDir: string): DesignPattern[] {
  const dir = path.join(docsDir, "game-design");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .flatMap((f) => parseDesignPatterns(fs.readFileSync(path.join(dir, f), "utf-8"), `game-design/${f}`));
}

/** The patterns whose Applies to line names every one of the archetypes; none for none. */
export function designPatternsFor(docsDir: string, archetypes: readonly string[]): DesignPattern[] {
  if (archetypes.length === 0) return [];
  return allPatterns(docsDir).filter((p) => archetypes.every((a) => p.applies_to.includes(a)));
}

/** One pattern by name, or null. */
export function designPattern(docsDir: string, name: string): DesignPattern | null {
  return allPatterns(docsDir).find((p) => p.name === name) ?? null;
}
