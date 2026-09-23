/**
 * The briefing as text: the one-paragraph brief summary and the markdown
 * report the CLI and MCP text channel print.
 */

import type { BriefingOutput } from "../../schemas/tool-outputs.ts";
import type { ArchetypeResolution } from "./archetype.ts";
import { renderBudgetText } from "./budget.ts";

function archetypeLabel(
  resolved: ArchetypeResolution | undefined,
  archetype: string | undefined,
  kindWord: string,
): string {
  if (resolved?.mode === "graph")
    return ` (${kindWord}: ${resolved.archetype.name}, ${resolved.archetype.title})`;
  if (resolved?.mode === "not_found")
    return ` (${kindWord} "${archetype ?? ""}" is not an archetype the graph knows)`;
  return archetype ? ` (${kindWord}: ${archetype})` : "";
}

function budgetPhrase(budget: BriefingOutput["budget"]): string {
  if (budget.cycles_verdict === "no_data") return "no cycle figures";
  const range =
    budget.cycles_low === budget.cycles_per_frame_sum
      ? `${budget.cycles_per_frame_sum}`
      : `${budget.cycles_low}-${budget.cycles_per_frame_sum}`;
  const fixed = budget.fixed_loss_cycles > 0 ? ` + ${budget.fixed_loss_cycles} badlines` : "";
  const unknown =
    budget.unknown.length > 0 ? `; ${budget.unknown.length} member(s) with no cycles figure` : "";
  return `${range}${fixed} of ${budget.frame_cycles} ${budget.region} cycles per frame, ${budget.cycles_verdict}${unknown}`;
}

export function briefSummary(opts: {
  description: string;
  isGame: boolean;
  resolved: ArchetypeResolution | undefined;
  archetype: string | undefined;
  plan: Pick<BriefingOutput, "proposed_techniques" | "pitfalls" | "toolchain_split" | "budget">;
  verdict: string;
}): string {
  const { description, isGame, plan } = opts;
  const label = archetypeLabel(opts.resolved, opts.archetype, isGame ? "genre" : "form");
  const categories = new Set(plan.proposed_techniques.map((t) => t.category)).size;
  const handoff = plan.toolchain_split.cycle_tight_handoff.length;
  return (
    `C64 ${isGame ? "game" : "demo"} plan for: "${description}"${label}. ` +
    `Proposed ${plan.proposed_techniques.length} technique(s) across ${categories} categories. ` +
    `Compatibility: ${opts.verdict}. ` +
    `Pitfalls to watch: ${plan.pitfalls.length}. ` +
    `Toolchain: Oscar64 primary${handoff > 0 ? `, KickAssembler for ${handoff} cycle-tight component(s)` : ""}. ` +
    `Budget: ${budgetPhrase(plan.budget)}.`
  );
}

function renderArchetype(b: BriefingOutput): string {
  let out = "";
  const missing = b.archetype_not_found;
  if (missing) {
    out +=
      `**Archetype not found:** "${missing.requested}".` +
      (missing.candidates?.length ? ` Did you mean one of: ${missing.candidates.join(", ")}?` : "") +
      ` Known archetypes: ${missing.known.join(", ")}\n\n`;
  }
  if (b.archetype) {
    out += `**Archetype:** ${b.archetype.name} (${b.archetype.title}, ${b.archetype.kind})\n`;
    if (b.archetype.inferred_from) {
      out += `Routed from the brief's words: ${b.archetype.inferred_from.join(", ")} (pass archetype to choose another)\n`;
    }
    out += `Fingerprint: ${b.archetype.features.join(", ") || "(none)"}\n`;
    out += `Common pitfalls: ${b.archetype.risks.join(", ") || "(none)"}\n\n`;
  }
  for (const d of b.designs ?? []) {
    const measured = d.measured
      .map(
        (m) => `${m.phase} ${m.region} worst ${m.worst}${m.typical !== null ? `, typical ${m.typical}` : ""}`,
      )
      .join("; ");
    out +=
      `**Game design:** ${d.name} (${d.title}), realised by ${d.realised_by.join(", ") || "(no recipe)"}; ` +
      `${measured ? `measured ${measured} cycles` : "no measured frame"}. ` +
      `Budget it with c64_plan_budget {"design": "${d.name}"}.\n`;
  }
  if ((b.designs ?? []).length > 0) out += "\n";
  return out;
}

const orNone = (xs: string[]) => (xs.length > 0 ? xs.join(", ") : "(none)");

function renderTechniques(b: BriefingOutput): string {
  let out = `## Proposed Techniques (${b.proposed_techniques.length})\n\n`;
  out += `| Name | Category | Complexity | Why |\n|------|----------|------------|-----|\n`;
  for (const t of b.proposed_techniques) {
    out += `| ${t.name} | ${t.category} | ${t.complexity ?? "-"} | ${t.why_proposed} |\n`;
  }
  if (b.proposed_techniques.length > 0) {
    out += `\n### Register + KERNAL dependencies\n\n`;
    for (const t of b.proposed_techniques) {
      out += `- **${t.name}**: registers [${orNone(t.uses_registers)}], KERNAL [${orNone(t.uses_kernal)}]\n`;
    }
  }
  return out;
}

function renderCompatibility(b: BriefingOutput): string {
  let out = `\n## Compatibility\n\n`;
  const allConflicts = [...b.compatibility.conflicts, ...b.compatibility.warnings];
  if (allConflicts.length === 0) out += `No conflicts detected.\n`;
  for (const c of allConflicts) out += `- **${c.kind}**: ${c.a} × ${c.b} — ${c.rationale}\n`;
  if (b.compatibility.shared_infrastructure.length > 0) {
    out += `\n**Shared infrastructure:** `;
    out += b.compatibility.shared_infrastructure.map((s) => s.name).join(", ") + "\n";
  }
  return out;
}

function renderPitfalls(b: BriefingOutput): string {
  let out = `\n## Pitfalls to Avoid (${b.pitfalls.length})\n\n`;
  if (b.pitfalls.length === 0) out += `No specific pitfalls identified.\n`;
  for (const p of b.pitfalls) {
    const triggers =
      p.triggered_by_proposed.length > 0
        ? p.triggered_by_proposed.join(", ")
        : "(archetype risk; no proposed technique triggers it)";
    out += `- **[${p.severity.toUpperCase()}]** ${p.name}: ${p.title}\n`;
    out += `  Triggered by: ${triggers}\n`;
  }
  return out;
}

function renderToolchain(b: BriefingOutput): string {
  let out = `\n## Toolchain Split\n\n`;
  out += `**Primary:** ${b.toolchain_split.primary}\n`;
  out += `${b.toolchain_split.rationale}\n`;
  if (b.toolchain_split.cycle_tight_handoff.length > 0) {
    out += `**KickAssembler handoff:** ${b.toolchain_split.cycle_tight_handoff.join(", ")}\n`;
  }
  return out;
}

function renderBuildOrder(b: BriefingOutput, scaffoldPages: Map<string, string>): string {
  let out = `\n## Build Order\n\n`;
  for (const step of b.build_order) {
    out += `${step.step}. **${step.label}**`;
    if (step.recipes.length > 0) out += ` → recipes: ${step.recipes.join(", ")}`;
    out += `\n`;
    // The scaffold step names the page to copy, not just the recipe. Only
    // that step: a scaffold recipe also implements techniques, so its name
    // recurs in later steps, where the page line would be noise.
    if (!step.label.startsWith("Game scaffold")) continue;
    for (const name of step.recipes) {
      const page = scaffoldPages.get(name);
      if (page) out += `   copy the scaffold from docs/${page.replace(/^docs\//, "")} (recipe ${name})\n`;
    }
  }
  return out;
}

export function renderBriefingText(
  b: BriefingOutput,
  isGame: boolean,
  scaffoldPages = new Map<string, string>(),
): string {
  return (
    `# C64 ${isGame ? "Game" : "Demo"} Briefing\n\n` +
    `**Brief:** ${b.brief}\n\n` +
    renderArchetype(b) +
    renderTechniques(b) +
    renderCompatibility(b) +
    renderPitfalls(b) +
    renderToolchain(b) +
    renderBuildOrder(b, scaffoldPages) +
    renderBudgetText(b.budget)
  );
}
