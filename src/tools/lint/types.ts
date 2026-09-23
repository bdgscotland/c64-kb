/** Types, page links and shared wording for the source lints (src/tools/lint.ts). */

import type { LintSourceOutput } from "../../schemas/tool-outputs.ts";

export type LintLanguage = "c" | "asm";
export type LintCertainty = "definite" | "likely" | "heuristic";

// Type aliases rather than interfaces: the MCP SDK's structuredContent
// needs an index-signature-compatible type, which an interface is not.
export type LintFinding = {
  rule: string;
  pitfall: string;
  line: number;
  excerpt: string;
  message: string;
  page: string;
  certainty: LintCertainty;
};

export type LintOptions = {
  language: LintLanguage | "auto";
  toolchain?: string | undefined;
};

/** The structured reply is exactly the c64_lint_source output schema. */
type LintOutput = LintSourceOutput;

export type LintResult = { structured: LintOutput; text: string };

export const PAGES = {
  sid: "docs/pitfalls/sid.md#sid_write_only_registers",
  ddr: "docs/pitfalls/input.md#cia1_ddr_cleared_kills_keyboard",
  open15: "docs/recipes/oscar64/high-score-persist.md",
  rasterPoll: "docs/recipes/oscar64/frame-sync-loop.md",
  lfsr: "docs/pitfalls/cpu.md#lfsr_zero_state_lockup",
  decimal: "docs/pitfalls/kernal-and-io.md#decimal_mode_in_irq_handler",
  d016: "docs/pitfalls/scroll.md#d016_unmasked_rmw_clobbers_csel_mcm",
  jmp: "docs/pitfalls/cpu.md#jmp_indirect_page_boundary_bug",
} as const;

// The two pages that speak to a bare OPEN of channel 15 disagree, and
// the rule says so rather than pick one. high-score-persist.md measured
// the OPEN returning success with no drive present; techniques/file-io.md
// tests the carry after it and expects C=1, A=5. Which is right is not
// measured by this lint.
export const OPEN15_MECHANISM =
  "high-score-persist.md: the KERNAL sends nothing on the bus when the filename length is zero, so that OPEN returned success with no drive present, and the CHKIN inside the read then hangs with no timeout. techniques/file-io.md opens the status channel bare on purpose and tests the carry after OPEN (bcs no_drive, C=1 A=5). The two pages disagree on what a bare OPEN returns with no drive; this lint does not settle it. Safe either way: read the status channel only after a named OPEN (a file, or a DOS command such as I0) has succeeded.";

// SID fields with a read path ($D419-$D41C). Every other field is write-only.
export const SID_READABLE = new Set(["potx", "poty", "random", "env3"]);

/** What every rule reads: the stripped text, its lines, the raw lines for excerpts, and where findings go. */
export interface LintContext {
  src: string;
  lines: string[];
  rawLines: string[];
  findings: LintFinding[];
}

/** Push one finding for 0-based line `idx`, with the excerpt taken from the raw text. */
export function report(ctx: LintContext, idx: number, f: Omit<LintFinding, "line" | "excerpt">): void {
  ctx.findings.push({
    rule: f.rule,
    pitfall: f.pitfall,
    line: idx + 1,
    excerpt: lineAt(ctx.rawLines, idx).trim().slice(0, 120),
    message: f.message,
    page: f.page,
    certainty: f.certainty,
  });
}

/** Line `i`, or "" past either end. */
export function lineAt(lines: readonly (string | undefined)[], i: number): string {
  return lines[i] ?? "";
}

/** Capture group `n` of a match, or "" when the group did not take part. */
export function group(m: readonly (string | undefined)[], n: number): string {
  return m[n] ?? "";
}
