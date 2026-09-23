/**
 * Briefing tools — Phase 5 anchor tools.
 *
 * demoBriefing(description, archetype?): one-shot structured demo plan — orchestrates
 *   search → techniqueLookup → checkCompatibility → pitfallsFor → build order.
 *   The optional archetype is a demo form from
 *   docs/demo-design/intro-cracktro-patterns.md (cracktro, demo_intro, ...).
 *
 * gameBriefing(description, archetype?): same but game-framed. The archetype
 *   is looked up as an Archetype node (docs/game-design/c64-game-archetypes.md,
 *   docs/CONVENTIONS-archetypes.md): its FEATURES targets are forced into the
 *   proposal, its RISKS targets into the pitfalls, and its title into the
 *   search. A name the graph does not have is reported as archetype_not_found
 *   with the known names. A graph with no Archetype nodes at all (the test
 *   fixtures) falls back to a small built-in table.
 *
 * Both tools share one archetype path. Archetype names are unique across
 * every archetype page: the ingest MERGEs the node on name alone, so a name
 * reused on a second page overwrites the first page's node rather than
 * adding a second. The known-names list in archetype_not_found spans both
 * kinds.
 *
 * These replace the manual 9-tool composition that a consuming agent had to
 * perform when using the c64_demo_brief / c64_game_brief MCP Prompts. One
 * tool call returns the full structured plan.
 */

export { whyProposed } from "./briefings/why-proposed.ts";
export { FRAME_CYCLES, RAM_BUDGET_BYTES, computeBudget, renderBudgetText } from "./briefings/budget.ts";
import { buildBriefing, type BriefingResult } from "./briefings/build.ts";
export type { BriefingResult };

// The implementation lives in src/tools/briefings/: discovery.ts (keyword and
// vector technique discovery), archetype.ts, why-proposed.ts,
// plan-pitfalls.ts, toolchain.ts, build-order.ts, budget.ts, render.ts, and
// build.ts, which runs the pipeline. This file keeps the import path.

export async function demoBriefing(description: string, archetype?: string): Promise<BriefingResult> {
  return buildBriefing(description, archetype, false);
}

export async function gameBriefing(description: string, archetype?: string): Promise<BriefingResult> {
  // gameBriefing without an archetype has always framed itself as a demo
  // plan (no scaffold step); that is kept so its callers see no change.
  return buildBriefing(description, archetype, archetype !== undefined);
}
