/** Toolchain, recipe and technique tools. */

import { z } from "zod";
import {
  toolchainHint,
  recipeLookup,
  recipesFor,
  techniqueLookup,
  techniquesFor,
  checkCompatibility,
  timingBudget,
  planBudgetTool as planBudgetRun,
  budgetRegion,
  BUDGET_REGION,
} from "../tools/query.ts";
import {
  ToolchainHintSchema,
  RecipeLookupSchema,
  RecipesForSchema,
  TechniqueLookupSchema,
  TechniquesForSchema,
  CompatibilityCheckSchema,
  TimingBudgetSchema,
  PlanBudgetSchema,
} from "../schemas/tool-outputs.ts";
import { defineTool, READ_ONLY } from "./define-tool.ts";
import { definedOnly } from "./defined-only.ts";

export const toolchainHintTool = defineTool({
  name: "c64_toolchain_hint",
  title: "Toolchain-idiomatic snippet",
  description: `Surface an idiomatic code snippet for a (toolchain, intent) pair. Defaults to Oscar64 when no toolchain is specified — c64-kb's primary-toolchain bias enforcer.

Purpose: Returns a ranked set of documentation chunks most relevant to the intent, scoped to the requested toolchain. The structured output carries the snippet text plus the bias-rationale string so the consuming agent can surface it to the user.

Inputs: 'toolchain' is optional (oscar64 | kickassembler | cc65). Omitting it triggers the Oscar64 default and annotates the rationale. 'intent' is a free-form description of what you want to do (e.g. "raster irq", "sprite multiplex", "disk load").

Output: {toolchain, intent, snippet, rationale, sources[]}. 'snippet' is the text of the top-matching chunk. 'rationale' explains the toolchain choice. 'sources' carries up to 3 ranked chunks.

When to use: When you need toolchain-idiomatic code patterns rather than hardware-register semantics. For register/opcode/kernal questions use the dedicated lookup tools.

Examples: {"intent": "raster irq"} → Oscar64 rasterirq.h snippet. {"toolchain": "kickassembler", "intent": "raster irq"} → KickAssembler raster setup.

See also: c64_recipe_lookup for complete buildable examples. c64_search for broad topic queries.

Limitations: Snippet quality depends on corpus coverage. If a pattern doc is missing, the rationale will note a coverage gap. Does not execute or validate code.`,
  inputSchema: {
    toolchain: z
      .enum(["oscar64", "kickassembler", "cc65"])
      .optional()
      .describe("Target toolchain (default: oscar64)"),
    intent: z.string().describe("What you want to do (e.g. 'raster irq', 'sprite multiplex', 'disk load')"),
  },
  outputSchema: ToolchainHintSchema.shape,
  annotations: READ_ONLY,
  run: ({ toolchain, intent }) => toolchainHint(toolchain, intent),
});

export const recipeLookupTool = defineTool({
  name: "c64_recipe_lookup",
  title: "Look up a buildable recipe",
  description: `Look up a complete, buildable C64 recipe by canonical name (e.g. 'oscar64-hello-world'). Returns structured metadata plus the recipe doc body (synopsis, source, build command, expected output, rationale).

Purpose: Gives the agent a ready-to-use, verified example with build instructions rather than requiring it to synthesize code from raw documentation chunks.

Inputs: 'name' is the canonical recipe identifier — toolchain prefix + hyphen + recipe slug (e.g. 'oscar64-hello-world', 'kickassembler-hello-world', 'cc65-hello-world-conio'). Case-sensitive.

Output: {name, toolchain, output_format, region, source_doc, toolchain_version_verified?, documentation[], source_code?, verified_on[{variant, vic, sid, cia, region, model, cycles, shot, flags, pinned, overrides[]}]}. toolchain_version_verified is the toolchain version this repo's gates built the recipe with (e.g. '5.25' for KickAssembler); a different version may or may not build it. verified_on lists the VICE machine variants verify:recipes runs the recipe on and compares with a committed screenshot pixel for pixel (from docs/recipes/runs.json): a runs.json "pal" run is VICE's default machine, which is the c64c variant (VIC-II 8565, SID 8580, CIA 8521), not a 6569; "ntsc" is the 6567R8 with a 6581 and 6526. vic, sid and cia are the chips the run had: a chip flag in 'flags' (-ciamodel, -cia1model, -cia2model, -sidmodel, -VICIImodel) replaces the variant's chip, and 'overrides' names each one replaced (cia-revision-detect runs the c64c with -ciamodel 0, so its CIA is the 6526). pinned false means the run uses verify:recipes' defaults. An empty list means no run is compared. On not-found, 'name' is empty and 'text' lists near-match suggestions.

When to use: When you know the specific recipe name or have already identified the toolchain + intent from c64_toolchain_hint and want a complete worked example.

Examples: {"name": "oscar64-hello-world"} returns the Oscar64 hello-world recipe metadata + doc. {"name": "oscar64-hello"} returns not-found with 'oscar64-hello-world' as a suggestion.

See also: c64_recipes_for to enumerate available recipes. c64_toolchain_hint for pattern snippets.

Limitations: Only recipes explicitly ingested into the KB are available. Partial name matches trigger suggestions but do not auto-resolve.`,
  inputSchema: {
    name: z
      .string()
      .describe("Canonical recipe name (e.g. 'oscar64-hello-world', 'kickassembler-hello-world')"),
  },
  outputSchema: RecipeLookupSchema.shape,
  annotations: READ_ONLY,
  run: ({ name }) => recipeLookup(name),
});

export const recipesForTool = defineTool({
  name: "c64_recipes_for",
  title: "List recipes by filter",
  description: `List all recipes matching an optional set of filters: toolchain, region, technique, or file format. Returns a structured table of matching Recipe nodes from FalkorDB.

Purpose: Lets the agent discover what buildable examples are available before committing to a specific recipe. All filters are optional — omitting all returns the full recipe catalog.

Inputs: All optional. 'toolchain' is one of oscar64 | kickassembler | cc65. 'region' is pal | ntsc | both (note: recipes with region='both' appear for any region filter). 'verified_on' is a MachineVariant name (c64c, ntsc, oldntsc, ...) or a region word (PAL, NTSC): only recipes verify:recipes runs on that variant, or on any variant of that region. 'technique' is an exact Technique name (e.g. 'stable_raster_irq'): recipes that IMPLEMENT it. 'file_format' is an exact FileFormat.name match (e.g. 'PRG').

Output: {filter, recipes[{name, toolchain, output_format, region, source_doc}]}. Empty recipes array means no matches — try a broader filter.

When to use: Before calling c64_recipe_lookup, use this to discover what names exist. Also useful to audit coverage gaps.

Examples: {"toolchain": "oscar64"} → table of all Oscar64 recipes. {} → full catalog. {"region": "pal"} → PAL-compatible recipes. {"verified_on": "oldntsc"} → the recipes run on the 6567R56A.

See also: c64_recipe_lookup to fetch a specific recipe's full content. c64_toolchain_hint for pattern snippets without a complete recipe.

Limitations: Returns graph metadata only — use c64_recipe_lookup to get the actual source code.`,
  inputSchema: {
    toolchain: z.enum(["oscar64", "kickassembler", "cc65"]).optional().describe("Filter by toolchain"),
    region: z
      .enum(["pal", "ntsc", "both"])
      .optional()
      .describe("Filter by region (recipes with region='both' match any value)"),
    technique: z.string().optional().describe("Filter by Technique title (exact match)"),
    file_format: z.string().optional().describe("Filter by FileFormat name (e.g. 'PRG')"),
    verified_on: z
      .string()
      .optional()
      .describe(
        "MachineVariant name (c64c, ntsc, oldntsc) or region word (PAL, NTSC): recipes run in VICE on it",
      ),
  },
  outputSchema: RecipesForSchema.shape,
  annotations: READ_ONLY,
  run: (args) => recipesFor(definedOnly(args)),
});

export const techniqueLookupTool = defineTool({
  name: "c64_technique_lookup",
  title: "Look up a technique",
  description: `Look up a Commodore 64 programming technique by canonical snake_case name (e.g. 'stable_raster_irq'). Returns technique metadata, chip, region requirements, all USES edges to Registers and KERNAL routines, the techniques it REQUIRES (must be set up before, or run underneath, it) and those that require it, the pitfalls it is the Fix for (MITIGATED_BY), the list of recipes that implement it, and the top documentation chunks.

Guidelines: Use when you know a specific technique name and want its full profile — registers it touches, KERNAL calls it makes, what it presupposes (text_zoom requires stable_raster_irq on every scanline of its zone), and buildable recipe examples. For discovery ("what raster techniques exist?", "what builds on stable_raster_irq?"), use c64_techniques_for instead.

Limitations: Returns structured data from FalkorDB; documentation chunks from Qdrant. Technique must be indexed (ingested from docs/techniques/). Partial or hyphenated names trigger a suggestion list.

Param notes: 'name' is the exact snake_case Technique.name (e.g. 'stable_raster_irq', 'sprite_multiplex_8'). Case-sensitive.

Expected length: 1 technique header + register/kernal/recipe lists + up to 3 doc chunks (~200-600 words total).

Example: {"name": "stable_raster_irq"} returns the stable raster IRQ technique with its register list (D011, D012, D019), recipes, and documentation.

Returns structured: {name, title, category, complexity, chip?, requires_region?, uses_registers[], uses_kernal[], recipes[], requires[{name,title}], required_by[{name,title}], mitigates[{name,title,severity}], documentation[], cost?}. requires/required_by are direct REQUIRES edges authored from **Requires:** lines (CONVENTIONS-techniques.md); a variant of a technique (double_irq of stable_raster_irq) is not a prerequisite and does not appear here. 'cost' is present only when the page carries a **Cost:** line: {cycles_per_line?, cycles_per_frame?, lines_active?, bytes_code?, bytes_data?, zp_bytes?, irq_slots?, basis}, integers, with only the keys the page stated; 'basis' is one of measured-vice, derived-listing, arithmetic, estimated and says how the figures were obtained (measured-vice means run in VICE; estimated means a judgement). Cycles are per PAL frame of 19,656 unless the page says otherwise; bytes are the built recipe's segments. 'claims' [{unit, mode, ranges?, relocatable?}] lists the HardwareUnits the technique holds (**Claims:** line; units such as sid_voice_2, sprite_0..7, vic_raster_irq, irq_vector_0314, zero_page with ranges like "E0-EF"); mode is owns, shares (writes under the owner's protocol), reads or init (once, before the frame loop). 'claims_stated' is stated, none (claims no unit) or unknown (the page states nothing: never read unknown as none); 'claims_basis' is measured-vice, derived-listing or estimated.`,
  inputSchema: {
    name: z
      .string()
      .describe("Canonical snake_case technique name (e.g. 'stable_raster_irq', 'sprite_multiplex_8')"),
  },
  outputSchema: TechniqueLookupSchema.shape,
  annotations: READ_ONLY,
  run: ({ name }) => techniqueLookup(name),
});

export const techniquesForTool = defineTool({
  name: "c64_techniques_for",
  title: "List techniques by filter",
  description: `List C64 techniques matching an optional set of filters: category, chip, region, register, recipe, requires, or claims. All filters are optional — omitting all returns the full technique catalog.

Purpose: Lets the agent discover what techniques are documented before committing to a specific one. Use before c64_technique_lookup to find the right technique name.

Inputs: All optional. 'category' is one of raster | sprite | scroll | bitmap | effect | music | cpu | banking | loader. 'chip' is a chip name (e.g. 'VIC-II', 'SID'). 'region' is PAL or NTSC (techniques locked to that region by a REQUIRES_REGION edge). 'register' is a register name (e.g. 'D011') to find techniques that USE it. 'recipe' is a recipe canonical name to find what techniques it implements. 'requires' is a technique name to find what builds on it — techniques whose REQUIRES chain reaches it directly or through other techniques. 'claims' is a HardwareUnit name (e.g. 'sid_voice_3', 'vic_raster_irq', 'zero_page') to find the techniques that claim it in any mode; a technique whose page states no claims is not listed, which does not mean it leaves the unit alone.

Output: {filter, techniques[{name, title, category, complexity}]}. Empty array means no matches.

Examples: {"category": "raster"} → all raster techniques. {"chip": "VIC-II"} → ~30+ rows. {"register": "D011"} → techniques that use SCROLY. {"requires": "stable_raster_irq"} → every technique that presupposes a stable raster IRQ.

See also: c64_technique_lookup for full profile of a specific technique.

Limitations: region filter matches only techniques with an explicit REQUIRES_REGION edge (PAL/NTSC-locked). Most techniques work on both regions and won't appear in a region filter. The requires filter follows REQUIRES edges only and does not unify variants: double_irq is a variant of stable_raster_irq with no edge between them, so {"requires": "stable_raster_irq"} does not list sideborder_open (which requires double_irq) — ask for double_irq as well. Chains longer than twelve edges are not followed.`,
  inputSchema: {
    category: z
      .string()
      .optional()
      .describe(
        "Technique category (raster | sprite | scroll | bitmap | effect | music | cpu | banking | loader)",
      ),
    chip: z.string().optional().describe("Chip name (e.g. 'VIC-II', 'SID', '6510')"),
    region: z
      .string()
      .optional()
      .describe("Region requirement filter: PAL or NTSC (matches REQUIRES_REGION edge)"),
    register: z
      .string()
      .optional()
      .describe("Register name (e.g. 'D011') — returns techniques that USE this register"),
    recipe: z
      .string()
      .optional()
      .describe("Recipe canonical name — returns techniques that this recipe implements"),
    requires: z
      .string()
      .optional()
      .describe("Technique name — returns techniques whose REQUIRES chain reaches it (what builds on it)"),

    claims: z
      .string()
      .optional()
      .describe(
        "HardwareUnit name (e.g. 'sid_voice_3', 'vic_raster_irq') — returns techniques with a CLAIMS edge to it",
      ),
  },
  outputSchema: TechniquesForSchema.shape,
  annotations: READ_ONLY,
  run: (args) => techniquesFor(definedOnly(args)),
});

export const checkCompatibilityTool = defineTool({
  name: "c64_check_compatibility",
  title: "Check technique compatibility",
  description: `Check whether two or more C64 techniques can be combined. Hard conflicts come from authored resource demands on the techniques (DEMANDS edges): two techniques that each need every CPU cycle on their lines, a cycle-exact technique against one that takes interrupts mid-frame, a constant-sprite-set technique against a multiplexer, a KERNAL-out technique against KERNAL calls, and PAL-vs-NTSC requirements. Soft conflicts come from shared registers and shared KERNAL routines. The check also takes each technique's REQUIRES closure — the techniques it must have set up underneath it — and runs the demand and unit rules between one technique's prerequisites and the other technique, reporting a hit as prerequisite_conflict with the rule that fired in underlying_kind and its own severity (hard, soft or info); a technique is never reported against a prerequisite it declared itself (kernal_clobbers_zp excepted, below), and no technique's own demand set is changed by this.

Inputs: 'techniques' is an array of 2+ canonical technique names (snake_case). Order doesn't matter — all pairwise combinations are checked.

Output: {techniques[], conflicts[], band_separated[], shared_infrastructure[], data_coverage[], verdict}. verdict is 'incompatible' if any hard conflict exists (each carries a 'resolution' saying how to separate the two, usually by raster region), 'warnings' if only soft conflicts exist, 'compatible' otherwise. A prerequisite_conflict names the input techniques in a/b, the implied ones in 'via', and the rule in 'underlying_kind'. shared_infrastructure gains a 'missing_prerequisite' entry (with required_by[]) for every technique the set leans on through REQUIRES without naming it. data_coverage says, per technique, how many registers, KERNAL routines and demands the graph holds for it — implied techniques appear with implied_by[]; a technique with known=false cannot conflict with anything by construction, and the verdict is silent about it rather than a clearance.

Conflict kinds: cpu_exclusive, cpu_vs_irq, sprite_set, kernal_banked_out, serial_bus_busy (a resident fast loader against KERNAL disk I/O), region_mismatch (hard); shared_register, shared_kernal (soft); prerequisite_conflict (the severity of its underlying_kind).

Unit claims (**Claims:** lines, CLAIMS edges to HardwareUnit nodes): unit_contention (hard: both own the same unit, e.g. two raster-IRQ owners, since there is one raster compare, or two owners of sprite_0..7); zero_page_overlap (hard, soft when either side is relocatable; 'shared' lists the bytes); unit_shared (soft: one owns and the other shares, e.g. SFX on voice 2 beside a music player, or stable_raster_irq, a way into a handler, beside a raster effect that owns the compare; a resident loader beside a VIC bank owner says not to write $DD00 raw); unit_read_while_driven (soft: one reads a port the other drives); init_order (info: one uses the unit once at start-up; info does not change the verdict). Between a technique and its own prerequisite, unit_contention and zero_page_overlap do not run, and unit_shared runs only when the sharer is the one that requires the owner. A prerequisite's claims on units its input holds are the input's and are not reported again. kernal_clobbers_zp (soft): one technique calls a KERNAL routine (**Uses kernal:**) whose zero-page may set (CLOBBERS_ZP, a static walk of the ROM through the power-on vectors, an upper bound) overlaps bytes the other claims; 'shared' lists the bytes and the routines. It also runs inside one input's own chain, the technique against itself and against its own prerequisites, since a KERNAL call clobbers the bytes whoever declared them; such a finding has a = b = that input (a prerequisite_conflict with the prerequisites in 'via' when they are involved). A routine hit already reported for the same inputs, routine and bytes is not repeated through a prerequisite. Only technique claims are checked: the zero-page bytes and vectors a recipe chooses are not yet (issue #22, step 8). data_coverage carries claims: stated | none | unknown per technique, and the text says for how many inputs claims are stated; an unknown claim set is never treated as "claims nothing", so a unit conflict with it cannot be ruled out.

Examples: {"techniques": ["fli_image", "sprite_multiplex_24"]} → incompatible (cpu_vs_irq, sprite_set and unit_contention on vic_raster_irq; resolution: multiplex outside the FLI region, in one interrupt chain). {"techniques": ["stable_raster_irq", "raster_bars"]} → warnings (unit_shared on vic_raster_irq: the stable entry runs inside raster_bars' handler; shared registers). {"techniques": ["fli_image", "digi_4bit"]} → incompatible (cpu_vs_irq: continuous interrupts inside the FLI region).

Raster bands: a technique page may state the raster lines it holds the CPU on (**Raster band:**, e.g. fli_image 45-250). When both techniques state line bands and they share no line, the line-sharing rules (cpu_exclusive, cpu_vs_irq through mid-frame IRQs or sprite-set changes, sprite_set) do not fire; the pair is listed in band_separated[] {a, b, a_band, b_band, rules[]} instead. A missing band, or one the program chooses ('movable'), keeps the conflict, and its rationale names the unknown side. data_coverage carries each technique's raster_band.

Limitations: demands and prerequisites are authored per technique in docs/techniques (see CONVENTIONS-techniques.md); a technique without them only participates in the soft checks. Named techniques are checked as named even when one requires the other. Where bands are not stated, 'incompatible' means 'not on the same raster lines', and the resolution says so.`,
  inputSchema: {
    techniques: z
      .array(z.string())
      .min(2)
      .describe("Array of 2+ canonical technique names to check (e.g. ['stable_raster_irq', 'raster_bars'])"),
  },
  outputSchema: CompatibilityCheckSchema.shape,
  annotations: READ_ONLY,
  run: ({ techniques }) => checkCompatibility(techniques),
});

export const timingBudgetTool = defineTool({
  name: "c64_timing_budget",
  title: "Per-scanline cycle budget",
  description: `Compute the per-scanline cycle budget for a C64 technique on a given region (PAL or NTSC). Returns the canonical cycle constants plus IRQ overhead and net user-available cycles.

Purpose: Gives the agent the authoritative cycle math for raster-critical technique implementations. Use before writing or evaluating cycle-tight C64 raster code.

Inputs: 'technique' is the canonical technique name (e.g. 'stable_raster_irq'). 'region' is 'pal' or 'ntsc' (case-insensitive). 'sprites_per_line' (optional, 0-8) is the number of sprites displayed on the line; without it the technique's own Cost sprites_per_line is used, and without that sprite DMA is not counted and a note says so.

Output: {technique, region, cycles_per_line, cycles_per_frame, badline_cycles_lost, irq_overhead_cycles, sprites_per_line, sprites_source ('input' | 'technique' | 'none'), sprite_dma_cycles, user_cycles_per_line_normal, user_cycles_per_line_badline, notes[]}.

Constants: PAL: 63 cycles/line × 312 lines = 19656 cycles/frame. NTSC: 65 cycles/line × 263 lines = 17095 cycles/frame. Badline: 43 cycles to plan on (the VIC holds the bus for cycles 15-54 and BA drops on cycle 12; only writes fit in 12-14). Default IRQ overhead: 36 cycles (7 interrupt sequence + 29 KERNAL dispatcher at $FF48 via $0314). Sprite DMA: 3 + 2 per sprite for sprites numbered without gaps (5 for one, 19 for eight, measured in VICE x64sc); each gap adds up to 3.

Examples: {"technique": "stable_raster_irq", "region": "pal"} → cycles_per_line=63, user_cycles_per_line_normal=27, user_cycles_per_line_badline=0 (a handler entered on a badline through the KERNAL vector has nothing left on that line). {"technique": "stable_raster_irq", "region": "pal", "sprites_per_line": 8} → sprite_dma_cycles=19, user_cycles_per_line_normal=8.

Limitations: irq_overhead is the default 36 cycles for every technique (an earlier version of this line said it was read from a Technique irq_overhead property; nothing writes one, and the read was removed in tools 1.25.0); a handler on $FFFE with the KERNAL banked out pays 7 plus its own register saves. An earlier version of this description said 23 badline cycles and 14 overhead, which was not what the tool computed. An earlier version did not subtract sprite DMA at all.`,
  inputSchema: {
    technique: z.string().describe("Canonical technique name (e.g. 'stable_raster_irq')"),
    region: z
      .string()
      .optional()
      .default("pal")
      .describe("Region: 'pal' or 'ntsc' (case-insensitive, default: 'pal')"),
    sprites_per_line: z
      .number()
      .int()
      .min(0)
      .max(8)
      .optional()
      .describe("Sprites displayed on the line (0-8). Overrides the technique's Cost sprites_per_line."),
  },
  outputSchema: TimingBudgetSchema.shape,
  annotations: READ_ONLY,
  run: ({ technique, region, sprites_per_line }) =>
    timingBudget({ technique, region, ...definedOnly({ sprites_per_line }) }),
});

export const planBudgetTool = defineTool({
  name: "c64_plan_budget",
  title: "Frame budget for a set of techniques",
  description: `Add a set of techniques up against a frame, honestly: per phase and region, a cycle range, what was left out and why, what is unknown, and a verdict.

Purpose: Answers "does this combination fit a frame?" before code is written. It does not sum blindly: a missing figure is never counted as zero, a figure above one frame is never summed, work one figure already includes is not counted twice, and every figure names the recipe it was measured on.

Inputs: 'techniques' is a list of canonical technique names, each optionally with a phase: "name" (play), "name:play", "name:transition" (level decode, wipe) or "name:init" (one-off setup). Each phase is budgeted alone. 'design' is a GameDesign name (a whole game from docs/game-design/designs, e.g. "platformer_scaffold_oscar64"): its COMPOSES edges, each in its phase, are budgeted first, then any 'techniques' given; its region is the default. Give 'techniques', 'design' or both. 'region' is 'pal', 'ntsc' or 'both' (default: PAL unless every region-locked member is NTSC-locked). 'screen' is 'on' (default) or 'off'. 'sprites_per_line' (0-8) and 'sprite_lines' (default 200) charge sprite DMA, 3 + 2n cycles a line.

Output: {design{name, title, region, instance_of[], realised_by[], composes[{technique, phase}], source_doc, measured[{phase, region, worst, typical, basis, source, predicted{low, high, fixed, verdict, missing[]}, position: below_low | within | within_incomplete | above_high | not_predicted, finding}]} | null, design_not_found?{requested, known[]}, techniques, refused[], region, screen, sprites, phases[{phase, region, frame, contributors[{name, low, high, every_frame, basis, charge, measured_on, conditions}], excluded[{name, reason: multi_frame | included_by | inside_band_of, by?, cycles?}], unknown[], not_found[], to_measure[{technique, recipe, why}], fixed_losses{badlines, sprite_dma, charged_for[], badlines_in_bands, floor}, worst_only[], low, high, floor, verdict, weakest_basis, irq_slots, notes[]}], bytes{sum, contributors, excluded (whole_program), inside[{name, by}], without_bytes}, verdict, assumptions[]}. A design's position places its measured worst against [low, high + fixed]: within_incomplete is inside that range while predicted.missing is non-empty, so the uncounted members could move the range past it and it is not agreement; above_high with members missing may be explained by them; below_low stands, since a missing member can only raise the range.

Rules: low sums each member's cycles_per_frame_typical where the page states a measured one, else its cycles_per_frame; high sums cycles_per_frame (worst frames). A member with no cycles figure goes to unknown and to_measure, with the recipe to measure it on. A figure above the frame (19,656 PAL, 17,095 NTSC) is excluded as multi_frame. A member named in another's **Cost includes:**, followed through the graph (a includes b, b includes c), is excluded as included_by, unless the including member is itself multi-frame; of two members that include each other the first listed is kept. A name listed twice in one phase is counted once and the repeat is listed in refused. A technique that holds every cycle of a stated raster band (cycles_per_line 63 and a line band) is charged band lines × line length, and its REQUIRES closure in the set is excluded as inside_band_of. With the screen on, the badlines (lines 51-243, every eighth, 25 × 43 = 1,075 cycles) outside any band charge, and the stated sprite DMA, are charged as fixed losses unless every summed figure is a band charge or is measured with measured-on conditions that say the screen was on; a figure measured blanked, one that does not say, and an arithmetic, derived-listing or estimated one are all charged. A stall takes its cycles wherever the code runs, so the charge is exact when no summed figure already holds stalls and too high by what a screen-on figure holds; fixed_losses.floor is the part no figure can hold. The low end is not a floor: a typical figure is a common frame or a real run's worst, and worst_only lists members with no typical at all. floor is the band and per-line charges, which run every frame, plus fixed_losses.floor. Verdict per phase: fits when nothing is unknown, missing or multi-frame and high + fixed losses fit the frame; over when floor passes the frame; otherwise undetermined. The overall verdict is the worst phase's. Bytes flagged "(whole PRG)" on their measured-on line are not summed; a member whose work is inside another's figure that states bytes is listed in inside, not summed. 'region' other than pal, ntsc or both is refused.

Examples: {"techniques": ["wave_director", "object_pool"]} → object_pool excluded (included_by wave_director); 1,170-3,188 plus 1,075 fixed, floor 1,075; fits. {"techniques": ["fli_image", "stable_raster_irq", "double_irq"]} → fli_image charged 207 lines × 63 = 13,041; the two prerequisites inside its band; all 25 badlines are inside the band, so no fixed loss. {"techniques": ["soft_scroll_h", "sid_play_routine_pattern"]} → 7,938 + 1,198 = 9,136 plus 1,075 fixed; fits (soft_scroll_h's carry frame; before issue #18 it was a 74,041-cycle move, excluded as multi_frame). {"design": "falling_blocks_oscar64", "region": "pal"} → init and play phases; play undetermined (text_mode_overlay_render and others unknown); the design's measured PAL worst frame, 6,276 cycles, is set beside the predicted range with where it falls.

See also: c64_timing_budget for the cycles left on one raster line; c64_check_compatibility for hardware claims, zero page and raster-line conflicts; c64_game_briefing, whose budget block uses the same rules on a proposed set in one play phase.

Limitations: the figures are the pages' own, each measured on one recipe; a different implementation costs differently. Figures are mostly PAL measurements, judged against the NTSC frame unchanged. Claims, zero page and memory are not judged here. Most compositions give undetermined rather than over: only work that runs every frame is a floor.`,
  inputSchema: {
    techniques: z
      .array(z.string())
      .min(1)
      .optional()
      .describe('Technique names, each "name" or "name:phase" (phase: play, transition, init)'),
    design: z
      .string()
      .min(1)
      .optional()
      .describe(
        "GameDesign name (e.g. 'platformer_scaffold_oscar64'): budgets its composed techniques by phase",
      ),
    region: z
      .string()
      .regex(BUDGET_REGION, "region is pal, ntsc or both")
      .optional()
      .describe(
        "Region: 'pal', 'ntsc' or 'both' (case-insensitive; default PAL unless every region-locked member is NTSC)",
      ),
    screen: z.enum(["on", "off"]).optional().describe("Display on (default) or blanked"),
    sprites_per_line: z
      .number()
      .int()
      .min(0)
      .max(8)
      .optional()
      .describe("Sprites displayed on each sprite line (0-8)"),
    sprite_lines: z
      .number()
      .int()
      .min(0)
      .max(312)
      .optional()
      .describe("Raster lines with sprites on them (default 200)"),
  },
  outputSchema: PlanBudgetSchema.shape,
  annotations: READ_ONLY,
  run: ({ techniques, design, region, screen, sprites_per_line, sprite_lines }) =>
    planBudgetRun({
      ...definedOnly({
        techniques,
        design,
        region: budgetRegion(region),
        screen,
        sprites_per_line,
        sprite_lines,
      }),
    }),
});
