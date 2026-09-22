/**
 * MCP Prompt handlers. Prompts surface as slash commands in Claude
 * Code. Each function returns a `GetPromptResult`-shaped object whose
 * templated user message guides the agent through a synthesis flow
 * (identify techniques, look up registers, surface pitfalls, propose
 * build order, recommend toolchain).
 *
 * Phase 3 ships c64_technique_lookup, c64_techniques_for,
 * c64_check_compatibility, and c64_timing_budget — the prompt bodies
 * compose these with the Phase 1/2 lookup tools. Phase 5 will add
 * c64_pitfalls_for and full briefing-synthesis tools.
 */

import { z } from "zod";

export const demoBriefArgs = {
  description: z.string().describe("Natural-language description of the demo to design (e.g. 'sprite scroller with raster bars')"),
};

export const gameBriefArgs = {
  description: z.string().describe("Natural-language description of the game to design"),
  genre: z.string().optional().describe("Optional genre hint (shmup, platformer, puzzle, adventure, etc.)"),
};

type PromptMessage = {
  role: "user";
  content: { type: "text"; text: string };
};

type PromptResult = {
  description: string;
  messages: PromptMessage[];
};

export function demoBriefPrompt({ description }: { description: string }): PromptResult {
  return {
    description: `Design a C64 demo from a brief: "${description}" (NOTE: prefer the c64_demo_briefing TOOL for a structured one-call response)`,
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `I want to design a C64 demo with the following brief:

${description}

Please:

1. Identify which C64 techniques apply (raster effects, sprite multiplexer, scroll, etc.). Use c64_techniques_for or c64_search to find them.
2. For each technique, use c64_technique_lookup to get the structured metadata (registers, kernal routines, recipes, REQUIRES_REGION, requires/required_by prerequisites, pitfalls it mitigates).
3. Use c64_check_compatibility on the technique list to surface known register/region conflicts before designing.
4. Use c64_timing_budget for each raster-critical technique to confirm cycle headroom on the target region.
5. List the registers each technique uses. Use c64_lookup_register for each.
6. Look up KERNAL routines needed for setup/teardown. Use c64_lookup_kernal.
7. Surface any pitfalls relevant to the combination of techniques (Phase 5 tool).
8. Propose a build order based on dependency.
9. Use c64_toolchain_hint per component to surface idiomatic Oscar64 vs KickAssembler snippets.

Return a structured plan with: techniques[], compatibility_check, timing_budgets[], registers[], kernal_routines[], pitfalls[], build_order[], toolchain_hints[].`,
        },
      },
    ],
  };
}

export function gameBriefPrompt({
  description,
  genre,
}: {
  description: string;
  genre?: string;
}): PromptResult {
  return {
    description: `Design a C64 game from a brief: "${description}" (NOTE: prefer the c64_game_briefing TOOL for a structured one-call response)`,
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `I want to design a C64 game (${genre ?? "unspecified genre"}):

${description}

Please:

1. Identify the game archetype (shmup, platformer, puzzle, adventure, etc.) and reference common C64 implementations.
2. Sketch the system architecture (game loop, IRQ structure, memory layout).
3. List required techniques (sprite multiplexer for >8 enemies, soft scroll for parallax, etc.).
4. Identify SID approach (full music, sfx-only, hybrid).
5. List the KERNAL routines needed (or whether to take over from KERNAL entirely).
6. Surface pitfalls relevant to the genre.
7. Recommend Oscar64 for game logic + KickAssembler for hot paths.

Return a structured plan: archetype, architecture, techniques[], sid_approach, kernal_use, pitfalls[], toolchain_split, build_order[].`,
        },
      },
    ],
  };
}
