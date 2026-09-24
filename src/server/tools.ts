/**
 * Every MCP tool, in the order tools/list has always returned them. The
 * definitions live in one file per tool family; this list is the only place
 * the order is decided.
 */

import type { RegistrableTool } from "./define-tool.ts";
import {
  healthTool,
  searchTool,
  lookupRegisterTool,
  lookupKernalTool,
  memoryMapTool,
  lookupOpcodeTool,
  palNtscDiffTool,
} from "./tools-lookup.ts";
import {
  toolchainHintTool,
  recipeLookupTool,
  recipesForTool,
  techniqueLookupTool,
  techniquesForTool,
  checkCompatibilityTool,
  timingBudgetTool,
  planBudgetTool,
} from "./tools-recipes.ts";
import { pitfallsForTool, lintSourceTool, failureDiagnoseTool } from "./tools-pitfalls.ts";
import { demoBriefingTool, gameBriefingTool } from "./tools-briefings.ts";
import { ingestDocTool, coverageTool, suggestLinksTool, reportGapTool } from "./tools-maintenance.ts";
import { runGameTool } from "./tools-runtime.ts";
import { reIrqChainTool, reFrameProfileTool } from "./tools-re.ts";
import { memorizationTool } from "../tools/memorization-mcp.ts";

export const TOOLS: readonly RegistrableTool[] = [
  healthTool,
  searchTool,
  ingestDocTool,
  lookupRegisterTool,
  lookupKernalTool,
  memoryMapTool,
  lookupOpcodeTool,
  palNtscDiffTool,
  toolchainHintTool,
  recipeLookupTool,
  recipesForTool,
  techniqueLookupTool,
  techniquesForTool,
  checkCompatibilityTool,
  timingBudgetTool,
  planBudgetTool,
  pitfallsForTool,
  lintSourceTool,
  failureDiagnoseTool,
  demoBriefingTool,
  gameBriefingTool,
  coverageTool,
  suggestLinksTool,
  reportGapTool,
  // Runtime tools (Layer 1: eval substrate)
  runGameTool,
  // Reverse engineering: observations from a PRG run headless in VICE
  reIrqChainTool,
  reFrameProfileTool,
  // SID Phase A: memorization detection. Absent where the Python analyzer is not installed.
  ...(memorizationTool ? [memorizationTool] : []),
];
