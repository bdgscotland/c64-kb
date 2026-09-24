/**
 * checkCompatibility: fetch the facts, evaluate the rules, render.
 */

import { getAnalytics } from "../../../context.ts";
import type { CompatibilityCheckOutput } from "../../../schemas/tool-outputs.ts";
import type { CompatibilityCheckResult } from "../types.ts";
import { fetchCompatibilityFacts } from "./fetch.ts";
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
    resultCount: evaluation.conflicts.length,
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
  return { structured, text: renderCompatibility(structured, closureOnly) };
}
