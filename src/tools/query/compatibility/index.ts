/**
 * checkCompatibility: fetch the facts, evaluate the rules, render.
 */

import { getAnalytics } from "../../../context.ts";
import type { CompatibilityCheckOutput } from "../../../schemas/tool-outputs.ts";
import type { CompatibilityCheckResult } from "../types.ts";
import { fetchCompatibilityFacts } from "./fetch.ts";
import { identifyNames } from "./identify.ts";
import { renderCompatibility } from "./render.ts";
import { evaluateCompatibility } from "./rules.ts";

export { evaluateCompatibility } from "./rules.ts";
export { checkDesignCompatibility } from "./design.ts";
export type { CompatibilityFacts, TechniqueFacts } from "./facts.ts";

export async function checkCompatibility(techniques: string[]): Promise<CompatibilityCheckResult> {
  const facts = await fetchCompatibilityFacts(techniques);
  const { closureOnly, ...evaluation } = evaluateCompatibility(facts);

  getAnalytics().logQuery({
    tool: "c64_check_compatibility",
    query: techniques.join("+"),
    // The inputs the graph could answer about; 0 (a gap) for a refusal or
    // silence on every input. It was the conflict count, so every clean
    // COMPATIBLE verdict was logged as a gap (#19).
    resultCount:
      evaluation.verdict === "unknown_technique"
        ? 0
        : evaluation.data_coverage.filter((d) => d.implied_by === undefined && d.known).length,
  });

  const structured: CompatibilityCheckOutput = {
    techniques,
    conflicts: evaluation.conflicts,
    band_separated: evaluation.band_separated,
    shared_infrastructure: evaluation.shared_infrastructure,
    data_coverage: evaluation.data_coverage,
    not_found: evaluation.not_found,
    verdict: evaluation.verdict,
  };
  // A refused name may still be a node of another type: say which (#19).
  const identified = await identifyNames(evaluation.not_found);
  return { structured, text: renderCompatibility(structured, closureOnly, identified) };
}
