/**
 * Gap replay (#19): run every open gap a tool logged through that tool
 * again and resolve the ones that now answer, so the residue is the true
 * gap list. Run after an ingest and by `c64-kb gaps-replay`.
 *
 * "Answers" is the tool's own test: the result count it would log. The
 * replay captures that count instead of logging it, so replaying a gap
 * never logs it again. Gaps an agent reported with c64_report_gap are
 * statements, not calls, and are left alone.
 */

import { z } from "zod";
import { getAnalytics } from "../context.ts";
import { demoBriefing, gameBriefing } from "./briefings.ts";
import { failureDiagnose, pitfallsFor } from "./pitfalls.ts";
import {
  checkCompatibility,
  lookupKernal,
  lookupOpcode,
  lookupRegister,
  memoryMap,
  palNtscDiff,
  recipeLookup,
  recipesFor,
  search,
  techniqueLookup,
  techniquesFor,
} from "./query.ts";

type Replayer = (query: string) => Promise<unknown>;

const Filter = z.record(z.string(), z.string());

/** The tools whose logged query string is enough to repeat the call. */
const REPLAYERS: Readonly<Record<string, Replayer>> = {
  c64_check_compatibility: (q) => checkCompatibility(q.split("+")),
  c64_demo_briefing: (q) => demoBriefing(q),
  c64_failure_diagnose: failureDiagnose,
  c64_game_briefing: (q) => gameBriefing(q),
  c64_lookup_kernal: lookupKernal,
  c64_lookup_opcode: lookupOpcode,
  c64_lookup_register: lookupRegister,
  c64_memory_map: memoryMap,
  c64_pal_ntsc_diff: (q) => palNtscDiff(q),
  c64_pitfalls_for: pitfallsFor,
  c64_recipe_lookup: recipeLookup,
  c64_recipes_for: (q) => recipesFor(Filter.parse(JSON.parse(q))),
  c64_search: (q) => search(q),
  c64_technique_lookup: techniqueLookup,
  c64_techniques_for: (q) => techniquesFor(Filter.parse(JSON.parse(q))),
};

export interface GapReplayReport {
  /** Open logged gaps replayed. */
  replayed: number;
  /** "tool: query" for each gap that now answers and was resolved. */
  resolved: string[];
  /** Replayed and still empty. */
  still_open: number;
  /** Open gaps of tools the replay cannot repeat from the log, per tool. */
  skipped: Record<string, number>;
  /** "tool: query: message" for each replay that threw; the gap stays open. */
  failed: string[];
}

type Outcome =
  { kind: "resolved" } | { kind: "open" } | { kind: "skipped" } | { kind: "failed"; message: string };

async function replayOne(tool: string, query: string): Promise<Outcome> {
  const replay = REPLAYERS[tool];
  if (!replay) return { kind: "skipped" };
  const an = getAnalytics();
  try {
    const counts = await an.captureCounts(() => replay(query));
    if ((counts.at(-1) ?? 0) === 0) return { kind: "open" };
  } catch (err) {
    return { kind: "failed", message: err instanceof Error ? err.message : String(err) };
  }
  an.resolveGap(query, tool);
  return { kind: "resolved" };
}

export async function replayGaps(): Promise<GapReplayReport> {
  const report: GapReplayReport = { replayed: 0, resolved: [], still_open: 0, skipped: {}, failed: [] };
  for (const { tool, query } of getAnalytics().getLoggedOpenGaps()) {
    const outcome = await replayOne(tool, query);
    if (outcome.kind === "skipped") {
      report.skipped[tool] = (report.skipped[tool] ?? 0) + 1;
      continue;
    }
    report.replayed++;
    if (outcome.kind === "resolved") report.resolved.push(`${tool}: ${query}`);
    else if (outcome.kind === "open") report.still_open++;
    else report.failed.push(`${tool}: ${query}: ${outcome.message}`);
  }
  return report;
}

/** One summary line, then the resolved gaps and failures, for the ingest log and the CLI. */
export function formatGapReplay(r: GapReplayReport, detail = false): string {
  const skipped = Object.entries(r.skipped)
    .map(([tool, n]) => `${tool} ${n}`)
    .join(", ");
  let out = `gap replay: ${r.replayed} replayed, ${r.resolved.length} resolved, ${r.still_open} still open, ${r.failed.length} failed${skipped ? `; not replayable: ${skipped}` : ""}\n`;
  if (detail) for (const g of r.resolved) out += `  resolved  ${g}\n`;
  for (const g of r.failed) out += `  failed    ${g}\n`;
  return out;
}
