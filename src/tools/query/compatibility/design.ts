/**
 * checkCompatibility by phase: a GameDesign (#37), or a technique list
 * whose names carry ":phase" (#94), each phase checked alone.
 *
 * A design's init and transition members do not run beside its play
 * members: the platformer reads its high score before the raster IRQ
 * starts and stops the IRQ before it writes at game over. Expanding the
 * design into one flat list would report conflicts between techniques that
 * never run together, so each phase's members are checked as one set and
 * the results are merged, each finding tagged with its phase.
 *
 * What one phase leaves running is checked across phases (#94,
 * state-rules.ts): a raster IRQ still armed, sprites still on, the KERNAL
 * still banked out when another phase calls KERNAL disk I/O. Each such
 * finding carries `across`. Other state one phase leaves for the next (a
 * unit an init member configures and play then owns) is not checked.
 */

import { BUDGET_PHASES, type BudgetPhase } from "../../../domain/budget.ts";
import type { CompatibilityCheckOutput } from "../../../schemas/tool-outputs.ts";
import type { CompatibilityCheckResult } from "../types.ts";
import { fetchGameDesign, knownGameDesigns } from "../game-design.ts";
import { parseMemberSpec } from "../plan-budget.ts";
import { factsOf } from "./facts.ts";
import { fetchCompatibilityFacts } from "./fetch.ts";
import { renderCompatibility } from "./render.ts";
import { evaluateCompatibility } from "./rules.ts";
import { stateRules } from "./state-rules.ts";

type Output = CompatibilityCheckOutput;
type Verdict = Output["verdict"];
type Conflict = Output["conflicts"][number];

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

/** Members per phase: the design's, then each "name" / "name:phase" given; a bad spec is an error. */
export function membersByPhase(
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
function merge(
  results: readonly PhaseResult[],
  cross: readonly Conflict[],
): Omit<Output, "design" | "phases"> {
  const unique = <T>(xs: T[]) => [...new Set(xs)];
  const coverage = new Map<string, Output["data_coverage"][number]>();
  for (const r of results) for (const d of r.structured.data_coverage) coverage.set(d.technique, d);
  const crossVerdict: Verdict = cross.some((c) => c.severity === "soft") ? "warnings" : "compatible";
  return {
    techniques: unique(results.flatMap((r) => r.structured.techniques)),
    conflicts: [
      ...results.flatMap((r) => r.structured.conflicts.map((c) => ({ ...c, phase: r.phase }))),
      ...cross,
    ],
    band_separated: results.flatMap((r) =>
      r.structured.band_separated.map((b) => ({ ...b, phase: r.phase })),
    ),
    shared_infrastructure: results.flatMap((r) =>
      r.structured.shared_infrastructure.map((s) => ({ ...s, phase: r.phase })),
    ),
    data_coverage: [...coverage.values()],
    not_found: unique(results.flatMap((r) => r.structured.not_found)),
    verdict: worstVerdict([...results.map((r) => r.structured.verdict), crossVerdict]),
  };
}

/** Findings between members of two different phases (#94): what one phase leaves running. */
async function crossPhase(by: ReadonlyMap<BudgetPhase, readonly string[]>): Promise<Conflict[]> {
  const members = BUDGET_PHASES.flatMap((phase) => (by.get(phase) ?? []).map((name) => ({ name, phase })));
  const phases = new Set(members.map((m) => m.phase));
  if (phases.size < 2) return [];
  const all = await fetchCompatibilityFacts([...new Set(members.map((m) => m.name))]);
  const out: Conflict[] = [];
  members.forEach((x, i) => {
    for (const y of members.slice(i + 1)) {
      if (x.phase === y.phase || x.name === y.name) continue;
      out.push(
        ...stateRules({ ...x, facts: factsOf(all, x.name) }, { ...y, facts: factsOf(all, y.name) }, all),
      );
    }
  });
  return out;
}

/**
 * The cross-phase findings, one heading per technique, kind and pair of
 * phases, naming every technique on the other side; the rationale and
 * resolution are the first pair's. The structured list keeps every pair.
 */
function renderCross(cross: readonly Conflict[]): string {
  if (cross.length === 0) return "";
  const groups = new Map<string, Conflict[]>();
  for (const c of cross) {
    const key = [c.a, c.kind, c.across?.a_phase, c.across?.b_phase].join("|");
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  let out = `\n---\n\n## Across phases\n\nWhat one phase leaves running when another calls the KERNAL; each finding is listed once per pair in conflicts[].\n\n`;
  for (const [first, ...rest] of groups.values()) {
    if (!first) continue;
    const others = [first.b, ...rest.map((c) => c.b)].join(", ");
    const where = first.across ? ` (${first.across.a_phase} × ${first.across.b_phase})` : "";
    out += `### ${first.kind} (${first.severity}): ${first.a} × ${others}${where}\n`;
    out += `${first.rationale}\n`;
    if (rest.length > 0)
      out += `The same for ${rest.map((c) => `${c.b} (${c.shared.join(", ")})`).join("; ")}.\n`;
    if (first.resolution) out += `**Resolution:** ${first.resolution}\n`;
    out += `\n`;
  }
  return out;
}

interface PhasedHead {
  design?: Output["design"];
  title: string;
}

/** c64_check_compatibility by phase: each phase alone, then across phases, merged. */
export async function checkPhasedCompatibility(
  by: ReadonlyMap<BudgetPhase, string[]>,
  head: PhasedHead,
): Promise<CompatibilityCheckResult> {
  const results: PhaseResult[] = [];
  for (const phase of BUDGET_PHASES) {
    const techniques = by.get(phase);
    if (techniques && techniques.length > 0) results.push(await checkPhase(phase, techniques));
  }
  const cross = await crossPhase(by);
  const structured: Output = {
    ...merge(results, cross),
    ...(head.design ? { design: head.design } : {}),
    phases: results.map((r) => ({
      phase: r.phase,
      techniques: r.structured.techniques,
      verdict: r.structured.verdict,
    })),
  };
  const intro =
    `# Compatibility by phase: ${head.title}\n\n` +
    `**Verdict:** ${structured.verdict.toUpperCase()}, the worst phase's or of what crosses phases. Each phase is checked alone: ` +
    `init and transition members do not run beside play. Across phases only what one leaves running against another's KERNAL calls is checked.\n`;
  const body = results.map((r) => `\n---\n\n## Phase: ${r.phase}\n\n${r.text.replace(/^# /, "### ")}`);
  return { structured, text: intro + body.join("") + renderCross(cross) };
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
  return checkPhasedCompatibility(membersByPhase(design.composes, extra), {
    design: { name: design.name, title: design.title, source_doc: design.source_doc },
    title: `${design.title} (\`${design.name}\`)`,
  });
}
