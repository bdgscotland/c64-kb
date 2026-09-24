/** Pitfall, lint and failure-diagnosis tools. */

import { z } from "zod";
import { pitfallsFor, failureDiagnose } from "../tools/pitfalls.ts";
import { lintSourceResult } from "../tools/lint.ts";
import { PitfallsForSchema, FailureDiagnoseSchema, LintSourceSchema } from "../schemas/tool-outputs.ts";
import { defineTool, READ_ONLY } from "./define-tool.ts";
import { definedOnly } from "./defined-only.ts";

export const pitfallsForTool = defineTool({
  name: "c64_pitfalls_for",
  title: "Pitfalls for a register, routine or technique",
  description: `Look up C64 coding pitfalls connected to a specific Register, KERNAL routine, or Technique. Returns all Pitfall nodes that have a TRIGGERED_BY edge to the named entity — and, for a Technique, those with a MITIGATED_BY edge to it, i.e. pitfalls whose Fix is that technique — ordered by severity (critical → high → medium → low).

Purpose: Surfaces the gotchas a developer will hit when using a particular register, routine, or technique, and the pitfalls a technique exists to cure. Intended as a proactive "what can go wrong?" check before implementing a technique.

Inputs: 'topic' is the entity name to look up. The tool tries three interpretations in order: (1) Register — matched by canonical name, hex address, or alias (e.g. "D012", "$D012"); (2) KernalRoutine — matched by canonical name (e.g. "CHROUT"); (3) Technique — matched by snake_case name (e.g. "stable_raster_irq"). The first interpretation that returns at least one Pitfall wins.

Output: {topic, topic_kind, pitfalls[{name, title, severity, region, category, triggered_by[], mitigated_by[]}]}. topic_kind is the winning interpretation (Register | KernalRoutine | Technique) or "search" if no direct match was found. pitfalls is ordered severity-descending. Each pitfall's triggered_by list contains all entities that trigger it, not just the queried entity; mitigated_by lists the techniques whose application is its Fix (CONVENTIONS-pitfalls.md **Mitigated by techniques:**). Read the two lists separately: sprite_dma_overflow is triggered by a naive multiplexer and mitigated by a correct one.

When no direct match is found, topic_kind is "search" and pitfalls is empty. Use c64_search or c64_technique_lookup to explore related content.

Examples: {"topic": "D012"} → pitfalls triggered by $D012 (raster line register). {"topic": "stable_raster_irq"} → pitfalls triggered by, or fixed by, the stable-raster-IRQ technique. {"topic": "pal_ntsc_detection"} → the three region-timing pitfalls it is the remedy for. {"topic": "CHROUT"} → pitfalls triggered by the KERNAL CHROUT routine.

See also: c64_failure_diagnose to match symptoms to known failure patterns. c64_technique_lookup for a technique's full profile (registers, KERNAL calls, recipes).

Limitations: Returns only pitfalls indexed in Phase 5 (28 nodes across 8 categories). Topics with no direct graph match fall back to "search" — run c64_search for fuzzy queries.`,
  inputSchema: {
    topic: z
      .string()
      .describe(
        "Register name (D012, $D012), KERNAL routine (CHROUT), or technique name (stable_raster_irq)",
      ),
  },
  outputSchema: PitfallsForSchema.shape,
  annotations: READ_ONLY,
  run: ({ topic }) => pitfallsFor(topic),
});

export const lintSourceTool = defineTool({
  name: "c64_lint_source",
  title: "Lint C or 6502 source against pitfall rules",
  description: `Run the knowledge base's pitfall rules over a piece of your own C (Oscar64) or 6502 assembly source. Each rule is compiled from one pitfall or recipe page and points back at it: sid_write_only_registers (a read or read-modify-write of $D400-$D418), cia1_ddr_cleared_kills_keyboard (a store of 0 to $DC02 with no later $FF), empty_name_open_15_hangs_on_read (an empty-name OPEN of channel 15 followed by a read; from the high-score recipe's warning, and the two pages that speak to it disagree, so the finding is heuristic and says so), raster_poll_with_kernal_irq_live (a $D012 busy-wait in a file that never installs an interrupt), lfsr_zero_state_lockup (a zero seed the file shifts or XORs), decimal_mode_in_irq_handler (assembly only: an installed handler that reaches ADC or SBC before any CLD), d016_unmasked_rmw_clobbers_csel_mcm (a $D016 store not derived from a masked read), jmp_indirect_page_boundary_bug (JMP ($xxFF)) and d015_merged_across_states (a constant ORed or ANDed into $D015 in a file that also writes it elsewhere; heuristic, from sprite_registers_persist_across_state_change).

Purpose: a self-check an agent runs on the code it just wrote, before building it. No graph or vector store is needed; the rules are text patterns.

Inputs: 'source' is the file text. 'language' is "c", "asm" or "auto" (default; detected from preprocessor lines and statement shape). 'toolchain' is optional and only recorded in the output. A Markdown page (any line opening a \`\`\` or ~~~ fence) is linted fence by fence: prose is skipped, c/h/cpp fences get the C rules and asm/kick/kickassembler/acme/ca65 fences the assembly rules, unlabelled and other fences are skipped, and line numbers are the page's; 'language' then narrows to one fence language, and the output's 'language' is the first found.

Output: {language, toolchain?, findings[{rule, pitfall, line, excerpt, message, page, certainty}], summary}. 'certainty' is "definite" (the pattern is the pitfall by construction), "likely" (it is the pitfall unless something outside the file excuses it, such as an earlier named OPEN) or "heuristic" (the pattern often accompanies the pitfall; read the page and decide). 'page' is the repo path of the pitfall or recipe the rule was compiled from, with the pitfall's H2 as the anchor when the source is a pitfall page; 'pitfall' is the pitfall node the rule stands for, or for empty_name_open_15_hangs_on_read the name of the recipe warning it compiles, which is not a pitfall node. 'summary' is one line. Read the message: each uses the page's own words for the mechanism and the fix.

Limitations: one file at a time, so an interrupt installed in another file makes the raster-poll rule fire as a heuristic; a shadow variable the lint cannot recognise makes the $D016 rule fire as a heuristic. Symbolic operands (JMP (vector)) are not resolved. Silence is not a pass: the rules cover the pitfalls listed above and no others.

See also: c64_pitfalls_for for every pitfall a register, routine or technique triggers, most of which have no text pattern to lint.`,
  inputSchema: {
    source: z.string().describe("The source text to lint (one file)"),
    language: z
      .enum(["c", "asm", "auto"])
      .default("auto")
      .describe("c (Oscar64/cc65 C), asm (6502 assembly), or auto"),
    toolchain: z
      .string()
      .optional()
      .describe("Toolchain name, recorded in the output (e.g. oscar64, kickassembler)"),
  },
  outputSchema: LintSourceSchema.shape,
  annotations: READ_ONLY,
  readsGraph: false,
  run: ({ source, language, toolchain }) =>
    lintSourceResult(source, { language, ...definedOnly({ toolchain }) }),
});

export const failureDiagnoseTool = defineTool({
  name: "c64_failure_diagnose",
  title: "Diagnose a failure from its symptom",
  description: `Given a symptom description (e.g. "black screen", "sprites flicker every other frame"), find matching CrashPattern nodes from the Phase 5 failure-pattern catalog. Returns up to 5 patterns ranked by keyword overlap, each with its description, likely causes, diagnosis steps, and CAUSED_BY graph edges.

Purpose: Lets an agent or developer describe what they observe and get back structured failure-pattern data: what is probably broken, what graph entities cause it, and how to diagnose it.

Inputs: 'symptom' is a free-form description of the observed failure. Short keyword phrases work well ("black screen", "music wrong tempo", "sprites disappear"). The tool tokenizes the query and scores each CrashPattern's symptom slug + description + likely_causes field by token overlap. Tokens shorter than 3 characters are ignored.

Output: {query, matches[{symptom, description, likely_causes[], diagnosis_steps, caused_by[], relevance}]}. matches is ordered by relevance score (0-1). An empty matches array means no patterns scored above zero — try rephrasing with different keywords.

Examples: {"symptom": "black screen"} → matches black_screen pattern (relevance ~1.0). {"symptom": "sprites flicker every other frame"} → matches sprite_flicker_periodic and/or sprite_flicker_random. {"symptom": "music plays too fast"} → matches wrong_music_tempo.

See also: c64_pitfalls_for to look up pitfalls proactively before they occur. c64_search for broad documentation queries.

Limitations: Scoring is token-overlap only — no semantic similarity. Uncommon symptom phrasings may score poorly. Phase 5 covers 15 CrashPattern nodes. Future phases add more patterns.`,
  inputSchema: {
    symptom: z
      .string()
      .describe(
        "Description of the observed failure (e.g. 'black screen', 'sprites flicker every other frame', 'music wrong tempo')",
      ),
  },
  outputSchema: FailureDiagnoseSchema.shape,
  annotations: READ_ONLY,
  run: ({ symptom }) => failureDiagnose(symptom),
});
