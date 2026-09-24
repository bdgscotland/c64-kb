/**
 * Markdown input for the source lints. A knowledge-base page mixes prose
 * and code; the rules are written for code. Linting the whole page made a
 * prose link to `music-sid.md` read as `sid.md`, a read of a SID field
 * (issue #28). A page is linted fence by fence instead: every line outside
 * a fence of the wanted language is blanked, so line numbers still match
 * the page.
 */

import type { LintLanguage } from "./types.ts";

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+-]*)/;

// Info strings the docs use for each language. An unlabelled fence is
// skipped: in these pages it holds tables, diagrams or output, not code.
const FENCE_LANGUAGE: Record<string, LintLanguage> = {
  c: "c",
  h: "c",
  cpp: "c",
  oscar64: "c",
  cc65: "c",
  asm: "asm",
  kick: "asm",
  kickass: "asm",
  kickassembler: "asm",
  acme: "asm",
  ca65: "asm",
  "6502": "asm",
};

/** True when the text has a Markdown code fence; C and assembler source never start a line with ``` or ~~~. */
export function isMarkdown(source: string): boolean {
  return source.split("\n").some((l) => FENCE.test(l));
}

/** One fenced block: its language (undefined when unlabelled or not code) and its body lines, 0-based. */
interface Fence {
  language: LintLanguage | undefined;
  first: number;
  last: number;
}

function findFences(lines: string[]): Fence[] {
  const fences: Fence[] = [];
  let open: { marker: string; language: LintLanguage | undefined; first: number } | null = null;
  lines.forEach((line, i) => {
    const m = FENCE.exec(line);
    if (!m) return;
    const marker = m[1] ?? "";
    if (open === null) {
      open = { marker, language: FENCE_LANGUAGE[(m[2] ?? "").toLowerCase()], first: i + 1 };
    } else if (marker.startsWith(open.marker.charAt(0)) && marker.length >= open.marker.length && !m[2]) {
      fences.push({ language: open.language, first: open.first, last: i - 1 });
      open = null;
    }
  });
  return fences;
}

/** The languages whose fences appear in the page, in a fixed order. */
export function fenceLanguages(source: string): LintLanguage[] {
  const found = new Set(findFences(source.split("\n")).map((f) => f.language));
  return (["c", "asm"] as const).filter((l) => found.has(l));
}

/** The page with every line outside a `language` fence blanked; line count unchanged. */
export function fenceMask(source: string, language: LintLanguage): string {
  const lines = source.split("\n");
  const keep = new Set<number>();
  for (const f of findFences(lines)) {
    if (f.language !== language) continue;
    for (let i = f.first; i <= f.last; i++) keep.add(i);
  }
  return lines.map((l, i) => (keep.has(i) ? l : "")).join("\n");
}
