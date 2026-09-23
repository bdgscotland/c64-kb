/**
 * Source lints compiled from the pitfall pages.
 *
 * lintSource(source, opts) runs the knowledge base's own rules over a
 * piece of C (Oscar64) or 6502 assembly and returns one finding per
 * site. Each rule is named after the pitfall it compiles and points at
 * the page that states it, so a finding can be read back against the
 * page. No graph or vector store is needed; the rules are text
 * patterns, and each carries a certainty:
 *
 *   definite   the pattern is the pitfall by construction
 *   likely     the pattern is the pitfall unless something the lint
 *              cannot see (an earlier call, a shadow variable) excuses it
 *   heuristic  the pattern often accompanies the pitfall; read the page
 *              and decide
 *
 * The messages use the pages' own words. The rules are deliberately
 * narrow: a lint that is quiet on correct code is worth more to an
 * agent than one that is loud on everything.
 *
 * The rules live in src/tools/lint/ (c-rules.ts, asm-rules.ts,
 * asm-decimal.ts); this file is the entry point.
 */

import { lintAsm } from "./lint/asm-rules.ts";
import { lintC } from "./lint/c-rules.ts";
import { detectLanguage } from "./lint/text.ts";
import type { LintCertainty, LintFinding, LintLanguage, LintOptions, LintResult } from "./lint/types.ts";

export { detectLanguage };
export type { LintFinding, LintOptions, LintResult };

export function lintSource(source: string, opts: LintOptions = { language: "auto" }): LintFinding[] {
  const language: LintLanguage = opts.language === "auto" ? detectLanguage(source) : opts.language;
  const findings: LintFinding[] = [];
  if (language === "c") lintC(source, findings);
  else lintAsm(source, findings);
  findings.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
  return findings;
}

const CERTAINTY_ORDER: LintCertainty[] = ["definite", "likely", "heuristic"];

function summarise(findings: LintFinding[]): string {
  if (findings.length === 0) return "No findings.";
  const counts = CERTAINTY_ORDER.map((c) => [c, findings.filter((f) => f.certainty === c).length] as const)
    .filter(([, n]) => n > 0)
    .map(([c, n]) => `${n} ${c}`)
    .join(", ");
  const rules = [...new Set(findings.map((f) => f.rule))];
  return `${findings.length} finding${findings.length === 1 ? "" : "s"} (${counts}) across ${rules.length} rule${rules.length === 1 ? "" : "s"}: ${rules.join(", ")}.`;
}

export function lintSourceResult(
  source: string,
  opts: LintOptions = { language: "auto" },
  label?: string,
): LintResult {
  const language: LintLanguage = opts.language === "auto" ? detectLanguage(source) : opts.language;
  const findings = lintSource(source, { ...opts, language });
  const summary = summarise(findings);
  const lines: string[] = [];
  lines.push(`# Lint${label ? `: ${label}` : ""} (${language})`);
  lines.push("");
  lines.push(summary);
  for (const f of findings) {
    lines.push("");
    lines.push(`## line ${f.line}: ${f.rule} [${f.certainty}]`);
    lines.push("");
    lines.push("    " + f.excerpt);
    lines.push("");
    lines.push(f.message);
    lines.push(`Page: ${f.page}`);
  }
  return {
    structured: {
      language,
      ...(opts.toolchain === undefined ? {} : { toolchain: opts.toolchain }),
      findings,
      summary,
    },
    text: lines.join("\n"),
  };
}
