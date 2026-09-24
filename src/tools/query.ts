/**
 * Query tools, split by job under src/tools/query/:
 *   - retrieval.ts: search, lookupOpcode, palNtscDiff, toolchainHint
 *   - lookups.ts: lookupRegister, lookupKernal, memoryMap
 *   - recipes.ts: recipeLookup, recipesFor
 *   - techniques.ts: techniqueLookup, techniquesFor
 *   - compatibility/: checkCompatibility (fetch, pure rules, render)
 *   - timing.ts: timingBudget (constants in src/domain/timing.ts)
 *   - plan-budget.ts: planBudgetTool (rules in src/domain/budget.ts)
 *
 * This file is the stable import path; every tool is re-exported here.
 */

export { search, lookupOpcode, palNtscDiff, toolchainHint } from "./query/retrieval.ts";
export { lookupRegister, lookupKernal, memoryMap } from "./query/lookups.ts";
export { recipeLookup, recipesFor } from "./query/recipes.ts";
export { techniqueLookup, techniquesFor } from "./query/techniques.ts";
export { checkCompatibility, checkDesignCompatibility } from "./query/compatibility/index.ts";
export { timingBudget } from "./query/timing.ts";
export { planBudgetTool, budgetRegion, BUDGET_REGION } from "./query/plan-budget.ts";
export { spriteDmaCycles } from "../domain/timing.ts";
