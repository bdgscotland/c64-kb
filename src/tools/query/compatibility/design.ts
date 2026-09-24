/**
 * checkCompatibility on a GameDesign (#37): each phase checked alone.
 *
 * A design's init and transition members do not run beside its play
 * members: the platformer reads its high score before the raster IRQ
 * starts and stops the IRQ before it writes at game over. Expanding the
 * design into one flat list would report conflicts between techniques that
 * never run together, so each phase's members are checked as one set and
 * the results are merged, each finding tagged with its phase.
 *
 * Not checked: state one phase leaves for the next (a unit an init member
 * configures and play then owns). The phases say when code runs, not what
 * it leaves behind.
 */

import { BUDGET_PHASES, type BudgetPhase } from "../../../domain/budget.ts";
import type { CompatibilityCheckOutput } from "../../../schemas/tool-outputs.ts";
import type { CompatibilityCheckResult } from "../types.ts";
import { fetchGameDesign, knownGameDesigns } from "../game-design.ts";
import { parseMemberSpec } from "../plan-budget.ts";
import { fetchCompatibilityFacts } from "./fetch.ts";
import { renderCompatibility } from "./render.ts";
import { evaluateCompatibility } from "./rules.ts";

type Output = CompatibilityCheckOutput;
type Verdict = Output["verdict"];

// Worst first: the merged verdict is the worst phase's.
const VERDICT_ORDER: readonly Verdict[] = ["unknown_technique", "incompatible", "warnings", "compatible"];

interface PhaseResult {
  phase: BudgetPhase;
  structured: Output;
  text: string;
}

async function checkPhase(phase: BudgetPhase, techniques: string[]): Promise<PhaseResult> {
  const { closureOnly, ...evaluation } = evaluateCompatibility(await fetchCompatibilityFacts(techniques));
  const structured: Output = { techniques, ...evaluation };
  return { phase, structured, text: renderCompatibility(structured, closureOnly) };
}

/** The design's members per phase, then any extra "name" / "name:phase" given; a bad spec is an error. */
function membersByPhase(
  composes: readonly { technique: string; phase: BudgetPhase }[],
  extra: readonly string[],
): Map<BudgetPhase, string[]> {
  const by = new Map<BudgetPhase, string[]>();
  const add = (name: string, phase: BudgetPhase): void => {
    const list = by.get(phase) ?? [];
    if (!list.includes(name)) list.push(name);
    by.set(phase, list);
  };
  for (const c of composes) add(c.technique, c.phase);
  for (const spec of extra) {
    const parsed = parseMemberSpec(spec);
    if ("error" in parsed) throw new Error(parsed.error);
    add(parsed.name, parsed.phase);
  }
  return by;
}

function worstVerdict(verdicts: readonly Verdict[]): Verdict {
  return VERDICT_ORDER.find((v) => verdicts.includes(v)) ?? "compatible";
}

/** One output over every phase: lists concatenated, each entry tagged with its phase. */
function merge(results: readonly PhaseResult[]): Omit<Output, "design" | "phases"> {
  const unique = <T>(xs: T[]) => [...new Set(xs)];
  const coverage = new Map<string, Output["data_coverage"][number]>();
  for (const r of results) for (const d of r.structured.data_coverage) coverage.set(d.technique, d);
  return {
    techniques: unique(results.flatMap((r) => r.structured.techniques)),
    conflicts: results.flatMap((r) => r.structured.conflicts.map((c) => ({ ...c, phase: r.phase }))),
    band_separated: results.flatMap((r) =>
      r.structured.band_separated.map((b) => ({ ...b, phase: r.phase })),
    ),
    shared_infrastructure: results.flatMap((r) =>
      r.structured.shared_infrastructure.map((s) => ({ ...s, phase: r.phase })),
    ),
    data_coverage: [...coverage.values()],
    not_found: unique(results.flatMap((r) => r.structured.not_found)),
    verdict: worstVerdict(results.map((r) => r.structured.verdict)),
  };
}

/** c64_check_compatibility with a design: each phase alone, merged. */
export async function checkDesignCompatibility(
  designName: string,
  extra: readonly string[] = [],
): Promise<CompatibilityCheckResult> {
  const design = await fetchGameDesign(designName);
  if (!design) {
    const known = (await knownGameDesigns()).join(", ") || "(none in this graph)";
    throw new Error(`no GameDesign is named "${designName.trim()}"; known: ${known}`);
  }
  const by = membersByPhase(design.composes, extra);
  const results: PhaseResult[] = [];
  for (const phase of BUDGET_PHASES) {
    const techniques = by.get(phase);
    if (techniques && techniques.length > 0) results.push(await checkPhase(phase, techniques));
  }
  const structured: Output = {
    ...merge(results),
    design: { name: design.name, title: design.title, source_doc: design.source_doc },
    phases: results.map((r) => ({
      phase: r.phase,
      techniques: r.structured.techniques,
      verdict: r.structured.verdict,
    })),
  };
  const head =
    `# Compatibility by phase: ${design.title} (\`${design.name}\`)\n\n` +
    `**Verdict:** ${structured.verdict.toUpperCase()}, the worst phase's. Each phase is checked alone: ` +
    `init and transition members do not run beside play. State one phase leaves for the next is not checked.\n`;
  const body = results.map((r) => `\n---\n\n## Phase: ${r.phase}\n\n${r.text.replace(/^# /, "### ")}`);
  return { structured, text: head + body.join("") };
}
