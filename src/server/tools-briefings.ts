/** The two briefing tools that plan a whole program in one call. */

import { z } from "zod";
import { demoBriefing, gameBriefing } from "../tools/briefings.ts";
import { BriefingSchema } from "../schemas/tool-outputs.ts";
import { defineTool, READ_ONLY } from "./define-tool.ts";

export const demoBriefingTool = defineTool({
  name: "c64_demo_briefing",
  title: "Plan a C64 demo",
  description: `**Phase 5 anchor tool.** Generate a complete, structured C64 demo plan from a natural-language brief in a single call. Internally orchestrates: vector search → technique lookup (graph enrichment per technique) → compatibility check (cross-technique conflict detection) → pitfall surfacing → toolchain split → build order with recipes.

Purpose: Replaces the 9-tool manual composition that the c64_demo_brief Prompt requires from the agent. One call returns the full structured plan as typed JSON plus a human-readable markdown summary.

Inputs: 'description' is a free-form demo brief (e.g. "sprite scroller with raster bars and SID music"). The tool extracts implied techniques via hybrid vector + keyword search, enriches each from the graph, and synthesises the plan. 'archetype' (optional) is the snake_case name of a demo form from docs/demo-design/intro-cracktro-patterns.md (cracktro, demo_intro, pack_intro, dentro, party_intro_4k); "Demo Intro" and "demo-intro" are read as demo_intro. Its technique fingerprint is forced into the proposal past the three-per-category cap and its common pitfalls are added to the pitfalls, exactly as c64_game_briefing does for a game archetype.

Output: {brief, proposed_techniques[], compatibility{conflicts, warnings, shared_infrastructure}, pitfalls[], toolchain_split{primary, cycle_tight_handoff[], rationale}, build_order[{step, label, recipes[]}], budget{region, frame_cycles, cycles_per_frame_sum, cycles_low, fixed_loss_cycles, cycles_verdict, ram_budget_bytes, bytes_sum, bytes_verdict, contributors[{name, cycles_per_frame?, cycles_per_frame_typical?, bytes?, basis, bytes_basis?, measured_on?}], excluded[{name, reason, by?}], unknown[], to_measure[{technique, recipe}], without_cost[], weakest_basis, is_floor, assumptions[]}}. 'brief' is a one-sentence summary. 'proposed_techniques' carry register/KERNAL sets and implementing recipe names. The plan keeps one technique per ALTERNATIVE_TO pair (schema 37): the other goes into the kept one's 'alternatives_left_out' [{name, tradeoff, stated_on}], where tradeoff describes stated_on against the other as its page states it. Two forced techniques (archetype fingerprint, the brief's own words) both stay. Otherwise a count the brief states decides first: "24 sprites" keeps the technique whose title states that count ("Up to 24+ sprites") or whose tradeoff's "more than 16 sprites" it meets (since #91; before, the count was not read and sprite_multiplex_8 stayed on its recipe count); then a forced one beats a found one; then the one with more realising recipes stays, then the higher-ranked. 'toolchain_split.primary' is always "oscar64"; 'cycle_tight_handoff' names the raster/effect techniques handed to KickAssembler. 'budget' applies c64_plan_budget's rules to the proposed set, every technique in one play frame (PAL 19,656 cycles; NTSC 17,095; PAL unless every region-locked technique is NTSC): cycles_per_frame_sum is the high end (worst frames), cycles_low the low end (typical frames where a page states one), fixed_loss_cycles the badline and sprite DMA charge; excluded names members left out (multi_frame, included_by, inside_band_of, whole_program_bytes) and unknown the members with no cycles figure, each with a recipe to measure it on in to_measure. cycles_verdict is "over" when the work that runs every frame plus the loss no figure can hold is more than the frame, "under" when nothing is unknown or multi-frame and the high end plus losses fit, "no_data" when nothing contributed, and "undetermined" otherwise (since tools 2.0.0; before, a missing figure counted as zero and the verdict said "under"). bytes_code + bytes_data are summed against a stated RAM budget of 38,911 bytes ($0801-$9FFF); bytes_verdict is "over", "under" or "no_data". 'without_cost' names the proposed techniques with no Cost line; when a cycles figure is unknown 'is_floor' is true and both sums are floors. 'weakest_basis' is the least trustworthy basis word among the contributors' cycle figures (measured-vice > derived-listing > arithmetic > estimated); a contributor's 'bytes_basis', when present, is its byte figures' own basis. With 'archetype' given, 'archetype' {name, title, kind, features[], risks[]} repeats what the graph holds, or 'archetype_not_found' {requested, known[]} lists every Archetype name the graph has (game and demo) when the name matches none; no plan is then made: every list is empty and the brief starts "Refused" (an earlier version built a plan from the description alone under the unknown name).

When to use: Start every new C64 demo design session with this tool. The structured output guides all follow-up tool calls (c64_technique_lookup, c64_check_compatibility, c64_pitfalls_for, c64_recipe_lookup) if deeper drill-down is needed.

Examples: {"description": "sprite scroller with raster bars"} → plan with scroll + raster + stable_raster_irq techniques, compatibility check, pitfalls, build order. {"description": "FLI image viewer with music"} → bitmap + SID techniques, fli_image recipe in build order. {"description": "a small cracktro", "archetype": "cracktro"} → the cracktro page's fingerprint (stable raster, side border, sprite chain, scroller, raster bars, SID play) forced in, with its pitfalls.

See also: c64_game_briefing for game-framed plans. c64_demo_brief Prompt as an alternate entry point (agent-composed, less structured).

Limitations: Technique selection is heuristic (vector search + keyword overlap). For exotic briefs, the proposed set may miss niche techniques — follow up with c64_techniques_for to discover them. Compatibility check is structural (shared registers/KERNAL), not semantic.`,
  inputSchema: {
    description: z
      .string()
      .describe("Natural-language demo brief (e.g. 'sprite scroller with raster bars and SID music')"),
    archetype: z
      .string()
      .optional()
      .describe(
        "Optional demo form: snake_case name of an Archetype node of kind demo from docs/demo-design/intro-cracktro-patterns.md (cracktro, demo_intro, pack_intro, dentro, party_intro_4k)",
      ),
  },
  outputSchema: BriefingSchema.shape,
  annotations: READ_ONLY,
  run: ({ description, archetype }) => demoBriefing(description, archetype),
});

export const gameBriefingTool = defineTool({
  name: "c64_game_briefing",
  title: "Plan a C64 game",
  description: `**Phase 5 anchor tool.** Generate a complete, structured C64 game plan from a natural-language brief and an archetype name in a single call. Internally orchestrates: archetype lookup → vector search → technique lookup → compatibility check → pitfall surfacing → toolchain split → build order.

Purpose: Replaces the 9-tool manual composition that the c64_game_brief Prompt requires from the agent. One call returns the full structured plan: proposed techniques for the game mechanic, register/KERNAL sets, pitfalls to avoid, Oscar64-primary + KickAssembler-for-hot-paths toolchain split, and a step-by-step build order.

Inputs: 'description' is a free-form game brief (e.g. "vertical scrolling shoot-em-up with enemy sprites"). 'archetype' is the snake_case name of an Archetype node from docs/game-design/c64-game-archetypes.md (vertical_shmup, horizontal_shmup, single_screen_platformer, scrolling_platformer, top_down_adventure, puzzle, text_adventure, action_puzzle, sports, racing, beat_em_up); "Vertical Shmup" and "vertical-shmup" are read as vertical_shmup. Optional; without it the brief is routed to the game archetype whose **Brief words:** line it matches most (a road, a car or Spy Hunter reach vertical_shmup; pseudo-3D or racing reach racing), 'archetype.inferred_from' lists the words. A tie, or a brief that holds only a genre noun several archetypes share ('a platformer', 'a shooter'), chooses none: 'archetype_candidates' {candidates[], from[], shared_features[], shared_risks[]} names them, the plan forces the features and includes the risks every candidate holds, and there is no scaffold step (an earlier version said nothing on a tie). No match at all leaves the plan without an archetype. It is always a game plan (before 2026-09-23 a call without an archetype was framed as a demo).

What the archetype does: its FEATURES edges (the page's technique fingerprint) are forced into proposed_techniques regardless of the keyword scorer and exempt from the per-category cap; its RISKS edges (the page's common pitfalls) are added to pitfalls[]; its title is appended to the search text. The page is the source of truth, not a table in this tool. Its GameDesigns (whole games INSTANCE_OF it, from docs/game-design/designs) are listed in 'designs[]' {name, title, realised_by[], composes[{technique, phase, calls?{low, high}}], measured[{phase, region, worst, typical, basis, source}]}; pass a name to c64_plan_budget as 'design' to budget it by phase against its measured frame.

Output: the briefing schema, including 'budget' (the plan added up from each technique's **Cost:** line: cycles_per_frame against the region's frame, bytes against a stated 38,911-byte RAM budget, 'without_cost' naming the techniques with no line so the sums read as floors, and 'weakest_basis'); 'archetype' {name, title, kind, features[], risks[], inferred_from?[]} repeating what the graph holds, or 'archetype_not_found' {requested, known[]} when the name matches no Archetype node, as for c64_demo_briefing, plus the game scaffold step when an archetype was named or routed. In the not-found case no plan is made: every list is empty and the brief starts "Refused" (an earlier version planned from the description alone). The build order's step 1 lists the recipes that SCAFFOLD the resolved archetype (Recipe -[:SCAFFOLDS]-> Archetype, authored by the recipe's scaffolds: key); the text names each recipe's page to copy. A graph with no Archetype nodes still offers oscar64-simple-shmup for a shmup key.

When to use: Start every new C64 game design session with this tool. Read 'archetype_not_found.known' if the name you tried was not accepted.

Examples: {"description": "vertical shoot-em-up", "archetype": "vertical_shmup"} → the ten fingerprint techniques (soft_scroll_v, scroll_panel_split, sprite_multiplex_game, per_frame_hitbox, wave_director, stable_raster_irq, double_irq, sid_voice_setup, sid_play_routine_pattern, sprite_collision_detect) plus the four named pitfalls, oscar64-simple-shmup in step 1. {"description": "Spy Hunter style road shooter"} → routed to vertical_shmup; the fingerprint plus vehicle_control, car_contact_response and lane_pursuit_ai from the brief's words. {"description": "a tetris clone", "archetype": "shmup"} → archetype_not_found with the known names.

See also: c64_demo_briefing for demo (non-game) plans. c64_game_brief Prompt as an alternate entry point (agent-composed, less structured).

Limitations: Technique discovery beyond the fingerprint is the same heuristic as c64_demo_briefing. A graph ingested before schema 21 has no Archetype nodes; the tool then falls back to a four-word keyword table and reports neither field.`,
  inputSchema: {
    description: z
      .string()
      .describe("Natural-language game brief (e.g. 'vertical scrolling shoot-em-up with enemy sprites')"),
    archetype: z
      .string()
      .optional()
      .describe(
        "Archetype node name from docs/game-design/c64-game-archetypes.md: vertical_shmup | horizontal_shmup | single_screen_platformer | scrolling_platformer | top_down_adventure | puzzle | text_adventure | action_puzzle | sports | racing | beat_em_up",
      ),
  },
  outputSchema: BriefingSchema.shape,
  annotations: READ_ONLY,
  run: ({ description, archetype }) => gameBriefing(description, archetype),
});
