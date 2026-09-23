/**
 * Every query tool returns `{ structured, text }`:
 *   - `structured`: a typed JSON payload matching a Zod outputSchema.
 *     The MCP layer attaches this to `structuredContent` so consuming
 *     agents can parse the result without re-tokenizing markdown.
 *   - `text`: a rendered human-readable markdown blob. The CLI prints
 *     this directly; the MCP layer includes it as `content[0].text`
 *     for backward compat.
 */

import type {
  RegisterLookupOutput,
  KernalLookupOutput,
  MemoryMapOutput,
  OpcodeLookupOutput,
  PalNtscDiffOutput,
  SearchOutput,
  ToolchainHintOutput,
  RecipeLookupOutput,
  RecipesForOutput,
  TechniqueLookupOutput,
  TechniquesForOutput,
  CompatibilityCheckOutput,
  TimingBudgetOutput,
} from "../../schemas/tool-outputs.ts";

export interface SearchResult {
  structured: SearchOutput;
  text: string;
}

export interface RegisterLookupResult {
  structured: RegisterLookupOutput;
  text: string;
}

export interface KernalLookupResult {
  structured: KernalLookupOutput;
  text: string;
}

export interface MemoryMapResult {
  structured: MemoryMapOutput;
  text: string;
}

export interface OpcodeLookupResult {
  structured: OpcodeLookupOutput;
  text: string;
}

export interface PalNtscDiffResult {
  structured: PalNtscDiffOutput;
  text: string;
}

export type TechniqueLookupResult = { structured: TechniqueLookupOutput; text: string };
export type TechniquesForResult = { structured: TechniquesForOutput; text: string };
export type CompatibilityCheckResult = { structured: CompatibilityCheckOutput; text: string };
export type TimingBudgetResult = { structured: TimingBudgetOutput; text: string };
export type ToolchainHintResult = { structured: ToolchainHintOutput; text: string };
export type RecipeLookupResult = { structured: RecipeLookupOutput; text: string };
export type RecipesForResult = { structured: RecipesForOutput; text: string };

export type PalNtscRegion = "pal" | "ntsc" | "both";
