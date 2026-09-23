/**
 * Query tools, split by job under src/tools/query/:
 *   - retrieval.ts: search, lookupOpcode, palNtscDiff, toolchainHint
 *   - lookups.ts: lookupRegister, lookupKernal, memoryMap
 *   - recipes.ts: recipeLookup, recipesFor
 *   - techniques.ts: techniqueLookup, techniquesFor
 *   - compatibility/: checkCompatibility (fetch, pure rules, render)
 *   - timing.ts: timingBudget (constants in src/domain/timing.ts)
 *
 * This file is the stable import path; every tool is re-exported here.
 */

export { search, lookupOpcode, palNtscDiff, toolchainHint } from "./query/retrieval.ts";
export { lookupRegister, lookupKernal, memoryMap } from "./query/lookups.ts";
export { recipeLookup, recipesFor } from "./query/recipes.ts";
export { techniqueLookup, techniquesFor } from "./query/techniques.ts";
export { checkCompatibility } from "./query/compatibility/index.ts";
export { timingBudget } from "./query/timing.ts";
export { spriteDmaCycles } from "../domain/timing.ts";
export type {
  SearchResult,
  RegisterLookupResult,
  KernalLookupResult,
  MemoryMapResult,
  OpcodeLookupResult,
  PalNtscDiffResult,
  PalNtscRegion,
  TechniqueLookupResult,
  TechniquesForResult,
  CompatibilityCheckResult,
  TimingBudgetResult,
  ToolchainHintResult,
  RecipeLookupResult,
  RecipesForResult,
} from "./query/types.ts";
