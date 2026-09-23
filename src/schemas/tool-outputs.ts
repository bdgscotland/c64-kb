/**
 * Zod output schemas for c64-kb MCP tools. Each tool that returns
 * structured data registers one of these as its `outputSchema` so
 * consuming agents can parse typed JSON via `structuredContent` rather
 * than re-tokenize the human-readable markdown blob in `content[0].text`.
 *
 * Per MCP spec 2025-06-18: tools with structuredContent SHOULD also
 * return a serialized text block for backward compat.
 */

import { z } from "zod";
import { VerifiedOnSchema } from "./machine-variant.ts";
import { BriefingDesignSchema } from "./plan-budget.ts";

const DocChunkSchema = z.object({
  source: z.string(),
  section: z.string(),
  text: z.string(),
  score: z.number(),
});

export const RegisterLookupSchema = z.object({
  found: z.boolean(),
  name: z.string(),
  address: z.string(),
  chip: z.string(),
  rw: z.enum(["R", "W", "RW"]),
  aliases: z.array(z.string()),
  documentation: z.array(DocChunkSchema),
});

export const KernalLookupSchema = z.object({
  name: z.string(),
  address: z.string(),
  description: z.string(),
  pairs_with: z.array(z.string()),
  documentation: z.array(DocChunkSchema),
});

export const MemoryMapSchema = z.object({
  address: z.string(),
  regions: z.array(
    z.object({
      name: z.string(),
      start: z.string(),
      end: z.string(),
      default_use: z.string(),
      bank_switchable: z.boolean(),
    }),
  ),
});

export const OpcodeLookupSchema = z.object({
  query: z.string(),
  results: z.array(DocChunkSchema),
});

export const PalNtscDiffSchema = z.object({
  topic: z.string(),
  regions: z.array(
    z.object({
      name: z.string(),
      refresh_hz: z.number(),
      lines_per_frame: z.number(),
      cycles_per_line: z.number(),
    }),
  ),
  documentation: z.array(DocChunkSchema),
});

export const SearchSchema = z.object({
  query: z.string(),
  hits: z.array(
    z.object({
      source: z.string(),
      section: z.string(),
      text: z.string(),
      score: z.number(),
      confidence: z.enum(["HIGH", "MEDIUM", "LOW", "UNSCORED"]),
    }),
  ),
});

export type RegisterLookupOutput = z.infer<typeof RegisterLookupSchema>;
export type KernalLookupOutput = z.infer<typeof KernalLookupSchema>;
export type MemoryMapOutput = z.infer<typeof MemoryMapSchema>;
export type OpcodeLookupOutput = z.infer<typeof OpcodeLookupSchema>;
export type PalNtscDiffOutput = z.infer<typeof PalNtscDiffSchema>;
export type SearchOutput = z.infer<typeof SearchSchema>;

const RecipeSchema = z.object({
  name: z.string(),
  toolchain: z.string(),
  output_format: z.string(),
  region: z.string(),
  source_doc: z.string(),
});

export const ToolchainHintSchema = z.object({
  toolchain: z.string(),
  intent: z.string(),
  snippet: z.string(),
  rationale: z.string(),
  sources: z.array(DocChunkSchema),
});

export const RecipeLookupSchema = z.object({
  name: z.string(),
  toolchain: z.string(),
  output_format: z.string(),
  region: z.string(),
  source_doc: z.string(),
  // The toolchain version the repo's gates built this recipe with, from the
  // Tool node's version_verified (schema 24); absent when the page states none.
  toolchain_version_verified: z.string().optional(),
  documentation: z.array(DocChunkSchema),
  // The page's Source listing, the fence the listing gate builds; absent
  // only when the page is not on disk beside the server.
  source_code: z.object({ language: z.string(), text: z.string() }).optional(),
  // The machine variants verify:recipes runs this recipe on and compares
  // with a committed screenshot (schema 29, from docs/recipes/runs.json).
  // Empty when none; pinned false means runs.json has no entry and the
  // run uses its defaults (PAL, 8,000,000 cycles).
  verified_on: z.array(VerifiedOnSchema).optional(),
});

export const RecipesForSchema = z.object({
  filter: z.object({
    toolchain: z.string().optional(),
    region: z.string().optional(),
    technique: z.string().optional(),
    file_format: z.string().optional(),
    verified_on: z.string().optional(),
  }),
  recipes: z.array(RecipeSchema),
});

export type ToolchainHintOutput = z.infer<typeof ToolchainHintSchema>;
export type RecipeLookupOutput = z.infer<typeof RecipeLookupSchema>;
export type RecipesForOutput = z.infer<typeof RecipesForSchema>;

const TechniqueRefSchema = z.object({ name: z.string(), title: z.string() });

// Cost model (schema 22): the technique page's **Cost:** and **Cost basis:**
// lines. Only the keys the page carried are present. `basis` says how the
// figures were obtained, strongest first: measured-vice (run in VICE),
// derived-listing (read off a built listing or map), arithmetic (worked
// from settled constants), estimated (a judgement, not a measurement).
import { CostBasisSchema } from "./cost-basis.ts";
export { CostBasisSchema };
const TechniqueCostSchema = z.object({
  cycles_per_line: z.number().int().optional(),
  cycles_per_frame: z.number().int().optional(),
  lines_active: z.number().int().optional(),
  bytes_code: z.number().int().optional(),
  bytes_data: z.number().int().optional(),
  zp_bytes: z.number().int().optional(),
  irq_slots: z.number().int().optional(),
  sprites_per_line: z.number().int().optional(),
  // Schema 27: a measured typical frame beside a worst-frame cycles_per_frame.
  cycles_per_frame_typical: z.number().int().optional(),
  basis: CostBasisSchema,
  // **Cost measured on:** the recipe the figures came from, and its
  // conditions ("screen blanked", "whole PRG"); **Cost includes:** the
  // techniques whose work is inside this figure (schema 27).
  measured_on: z.string().optional(),
  conditions: z.string().optional(),
  includes: z.array(z.string()).optional(),
});
export type TechniqueCostOutput = z.infer<typeof TechniqueCostSchema>;

// A CLAIMS edge (schema 25): the HardwareUnit, the mode, and for zero_page
// the canonical byte ranges ("02-0D,24-2F") and whether they relocate.
const ClaimSchema = z.object({
  unit: z.string(),
  mode: z.enum(["owns", "shares", "reads", "init"]),
  ranges: z.string().optional(),
  relocatable: z.boolean().optional(),
});
const ClaimsStatedSchema = z.enum(["stated", "none", "unknown"]);

export const TechniqueLookupSchema = z.object({
  name: z.string(),
  title: z.string(),
  category: z.string(),
  complexity: z.string(),
  chip: z.string().optional(),
  requires_region: z.string().optional(),
  raster_band: z.string().optional(),
  uses_registers: z.array(z.object({ name: z.string(), address: z.string() })),
  uses_kernal: z.array(z.object({ name: z.string(), address: z.string() })),
  recipes: z.array(z.object({ name: z.string(), toolchain: z.string() })),
  // REQUIRES edges: techniques that must be set up before, or run underneath,
  // this one (requires) and techniques that presuppose this one (required_by).
  requires: z.array(TechniqueRefSchema).optional(),
  required_by: z.array(TechniqueRefSchema).optional(),
  // MITIGATED_BY edges pointing here: pitfalls whose Fix is this technique.
  mitigates: z.array(z.object({ name: z.string(), title: z.string(), severity: z.string() })).optional(),
  documentation: z.array(DocChunkSchema),
  // Absent when the technique's page has no **Cost:** line.
  cost: TechniqueCostSchema.optional(),
  // **Claims:** (schema 25). claims_stated is "unknown" when the page has no
  // usable Claims line, which is not the same as "none" (claims no unit).
  claims: z.array(ClaimSchema).optional(),
  claims_stated: ClaimsStatedSchema.optional(),
  claims_basis: z.string().optional(),
});

export const TechniquesForSchema = z.object({
  filter: z.object({
    category: z.string().optional(),
    chip: z.string().optional(),
    region: z.string().optional(),
    register: z.string().optional(),
    recipe: z.string().optional(),
    requires: z.string().optional(),
    // A HardwareUnit name: techniques with a CLAIMS edge to it (any mode).
    claims: z.string().optional(),
  }),
  techniques: z.array(
    z.object({
      name: z.string(),
      title: z.string(),
      category: z.string(),
      complexity: z.string(),
    }),
  ),
});

const CONFLICT_KINDS = [
  "region_mismatch", // one needs PAL, the other NTSC
  "cpu_exclusive", // both need every CPU cycle on the lines they cover
  "cpu_vs_irq", // one needs every CPU cycle; the other takes interrupts mid-frame
  "sprite_set", // one needs a constant sprite set; the other changes it mid-frame
  "kernal_banked_out", // one runs with the KERNAL ROM out; the other calls KERNAL routines
  "serial_bus_busy", // one owns the drive's serial bus while resident; the other does KERNAL disk I/O
  "prerequisite_conflict", // a rule fires between a technique and a REQUIRES prerequisite of another; underlying_kind names the rule
  "shared_register", // both touch the same register (soft)
  "shared_kernal", // both call the same KERNAL routine (soft)
  // Resource claims (schema 25), from **Claims:** lines:
  "unit_contention", // both own the same HardwareUnit (hard)
  "zero_page_overlap", // both own zero-page bytes in common (hard; soft if either side relocates)
  "unit_shared", // one owns a unit the other shares, or both share it (soft)
  "unit_read_while_driven", // one owns a unit the other only reads (soft)
  "init_order", // one uses a unit once at start-up that the other then owns (info)
  // Schema 26, from **Clobbers zero page:** lines on the KERNAL page:
  "kernal_clobbers_zp", // one calls a KERNAL routine that may write zero-page bytes the other claims (soft)
] as const;

const CompatibilityConflictSchema = z.object({
  a: z.string(),
  b: z.string(),
  kind: z.enum(CONFLICT_KINDS),
  // hard: cannot coexist as combined; the resolution says how to separate them.
  // soft: combinable with coordination.
  // info: combinable; the text says what order or protocol keeps it so. It
  // does not change the verdict.
  severity: z.enum(["hard", "soft", "info"]),
  shared: z.array(z.string()),
  rationale: z.string(),
  resolution: z.string().optional(),
  // prerequisite_conflict only: the closure members the rule actually fired
  // between, when they differ from a and b (which name the input techniques).
  via: z.array(z.string()).optional(),
  // prerequisite_conflict only: the rule that fired between them
  // (unit_contention, cpu_vs_irq, ...), since the closure can carry any rule
  // at any severity.
  underlying_kind: z.enum(CONFLICT_KINDS).optional(),
});

const SharedInfrastructureSchema = z.object({
  name: z.string(),
  kind: z.enum(["Register", "KernalRoutine", "discipline", "missing_prerequisite"]),
  via_recipes: z.array(z.string()),
  // missing_prerequisite only: the input techniques whose REQUIRES closure
  // contains this technique, which was not itself in the input set.
  required_by: z.array(z.string()).optional(),
});

// What the graph actually knows about each technique named in the check.
// A technique with no registers, no KERNAL routines and no demands cannot
// conflict with anything by construction; `known: false` says the verdict
// is silent about it, not that it is safe.
const CompatibilityCoverageSchema = z.object({
  technique: z.string(),
  found: z.boolean(),
  registers: z.number(),
  kernal_routines: z.number(),
  demands: z.array(z.string()),
  // The page's **Raster band:** in canonical form ("45-250", "movable").
  raster_band: z.string().optional(),
  known: z.boolean(),
  // Whether the page states unit claims: "unknown" when it has no Claims
  // line, so a unit conflict involving it cannot be ruled out.
  claims: ClaimsStatedSchema,
  // Present when the technique was not in the input set but entered the
  // check through another technique's REQUIRES closure.
  implied_by: z.array(z.string()).optional(),
});

const BandSeparatedSchema = z.object({
  a: z.string(),
  b: z.string(),
  a_band: z.string(),
  b_band: z.string(),
  rules: z.array(z.string()), // the conflict kinds the bands cleared
});

export const CompatibilityCheckSchema = z.object({
  techniques: z.array(z.string()),
  conflicts: z.array(CompatibilityConflictSchema),
  // Pairs a line-sharing rule would have caught, cleared because both pages
  // state **Raster band:** line ranges that share no raster line (schema 24).
  band_separated: z.array(BandSeparatedSchema),
  shared_infrastructure: z.array(SharedInfrastructureSchema),
  data_coverage: z.array(CompatibilityCoverageSchema),
  verdict: z.enum(["compatible", "warnings", "incompatible"]),
});

export const TimingBudgetSchema = z.object({
  technique: z.string(),
  region: z.enum(["PAL", "NTSC"]),
  cycles_per_line: z.number(),
  cycles_per_frame: z.number(),
  badline_cycles_lost: z.number(),
  irq_overhead_cycles: z.number(),
  // Sprite DMA (schema 24): the sprites assumed on the line, where that
  // number came from, and the cycles their DMA takes (3 + 2 per sprite for
  // sprites numbered without gaps, measured in VICE; see vic-ii-reference.md).
  sprites_per_line: z.number(),
  sprites_source: z.enum(["input", "technique", "none"]),
  sprite_dma_cycles: z.number(),
  user_cycles_per_line_normal: z.number(),
  user_cycles_per_line_badline: z.number(),
  notes: z.array(z.string()),
});

export { PlanBudgetSchema, type PlanBudgetOutput } from "./plan-budget.ts";

export type TechniqueLookupOutput = z.infer<typeof TechniqueLookupSchema>;
export type TechniquesForOutput = z.infer<typeof TechniquesForSchema>;
export type CompatibilityCheckOutput = z.infer<typeof CompatibilityCheckSchema>;
export type TimingBudgetOutput = z.infer<typeof TimingBudgetSchema>;

const TriggeredBySchema = z.object({
  name: z.string(),
  kind: z.enum(["Register", "KernalRoutine", "Technique"]),
});

export const PitfallsForSchema = z.object({
  topic: z.string(),
  topic_kind: z.enum(["Register", "KernalRoutine", "Technique", "search"]),
  pitfalls: z.array(
    z.object({
      name: z.string(),
      title: z.string(),
      severity: z.enum(["critical", "high", "medium", "low"]),
      region: z.enum(["pal", "ntsc", "both"]),
      category: z.string(),
      triggered_by: z.array(TriggeredBySchema),
      // Techniques whose application is this pitfall's Fix (MITIGATED_BY).
      mitigated_by: z.array(TriggeredBySchema),
      // Present when the pitfall was reached through a register or KERNAL
      // routine the technique declares, not through a direct edge.
      via: z
        .array(
          z.object({
            name: z.string(),
            kind: z.enum(["Register", "KernalRoutine"]),
            address: z.string().optional(),
          }),
        )
        .optional(),
    }),
  ),
  search_results: z
    .array(
      z.object({
        source: z.string(),
        section: z.string(),
        text: z.string(),
        score: z.number(),
      }),
    )
    .optional(),
});

export const FailureDiagnoseSchema = z.object({
  query: z.string(),
  matches: z.array(
    z.object({
      symptom: z.string(),
      description: z.string(),
      likely_causes: z.array(z.string()),
      diagnosis_steps: z.string(),
      caused_by: z.array(TriggeredBySchema),
      relevance: z.number().min(0).max(1),
    }),
  ),
});

export type PitfallsForOutput = z.infer<typeof PitfallsForSchema>;
export type FailureDiagnoseOutput = z.infer<typeof FailureDiagnoseSchema>;

// c64_lint_source: the pitfall pages compiled into source rules
// (src/tools/lint.ts). One finding per site; certainty says how far the
// text pattern is from the pitfall itself.
const LintFindingSchema = z.object({
  rule: z.string(),
  pitfall: z.string(),
  line: z.number().int().min(1),
  excerpt: z.string(),
  message: z.string(),
  page: z.string(),
  certainty: z.enum(["definite", "likely", "heuristic"]),
});

export const LintSourceSchema = z.object({
  language: z.enum(["c", "asm"]),
  toolchain: z.string().optional(),
  findings: z.array(LintFindingSchema),
  summary: z.string(),
});

export type LintSourceOutput = z.infer<typeof LintSourceSchema>;

export const BriefingSchema = z.object({
  brief: z.string(),
  proposed_techniques: z.array(
    z.object({
      name: z.string(),
      title: z.string(),
      category: z.string(),
      complexity: z.enum(["low", "medium", "high", "scene-tier"]).optional(),
      why_proposed: z.string(),
      uses_registers: z.array(z.string()),
      uses_kernal: z.array(z.string()),
      region: z.enum(["pal", "ntsc", "both"]).optional(),
      implementing_recipes: z.array(z.string()),
    }),
  ),
  compatibility: z.object({
    conflicts: z.array(CompatibilityConflictSchema),
    warnings: z.array(CompatibilityConflictSchema),
    shared_infrastructure: z.array(SharedInfrastructureSchema),
  }),
  pitfalls: z.array(
    z.object({
      name: z.string(),
      title: z.string(),
      severity: z.string(),
      triggered_by_proposed: z.array(z.string()),
    }),
  ),
  toolchain_split: z.object({
    primary: z.string(),
    cycle_tight_handoff: z.array(z.string()),
    rationale: z.string(),
  }),
  build_order: z.array(
    z.object({
      step: z.number(),
      label: z.string(),
      recipes: z.array(z.string()),
    }),
  ),
  // The plan added up (schema 22, tools 1.25.0; the rules of c64_plan_budget
  // since schema 27, tools 2.0.0, all members in one play frame).
  // cycles_per_frame_sum is the high end: worst-frame figures summed, with
  // multi-frame figures and work another figure includes left out (listed
  // in excluded). cycles_low sums measured typical frames where a page
  // states one. fixed_loss_cycles is the badline charge for figures not
  // measured wall-clock with the screen on. unknown names the members with
  // no cycles figure; the verdict is then "undetermined", never a sum that
  // counts them as zero. bytes_sum leaves out figures flagged as a whole
  // program. without_cost names the members with no Cost line at all.
  budget: z.object({
    region: z.enum(["PAL", "NTSC"]),
    frame_cycles: z.number().int(),
    cycles_per_frame_sum: z.number().int(),
    cycles_low: z.number().int(),
    fixed_loss_cycles: z.number().int(),
    cycles_verdict: z.enum(["over", "under", "undetermined", "no_data"]),
    ram_budget_bytes: z.number().int(),
    bytes_sum: z.number().int(),
    bytes_verdict: z.enum(["over", "under", "no_data"]),
    contributors: z.array(
      z.object({
        name: z.string(),
        cycles_per_frame: z.number().int().optional(),
        cycles_per_frame_typical: z.number().int().optional(),
        bytes: z.number().int().optional(),
        basis: CostBasisSchema,
        measured_on: z.string().optional(),
      }),
    ),
    excluded: z.array(
      z.object({
        name: z.string(),
        reason: z.enum(["multi_frame", "included_by", "inside_band_of", "whole_program_bytes"]),
        by: z.string().optional(),
      }),
    ),
    unknown: z.array(z.string()),
    to_measure: z.array(z.object({ technique: z.string(), recipe: z.string().nullable() })),
    without_cost: z.array(z.string()),
    weakest_basis: CostBasisSchema.nullable(),
    is_floor: z.boolean(),
    assumptions: z.array(z.string()),
  }),
  // Present when an archetype was asked for (game genre or demo form).
  // When the archetype names an Archetype node, its FEATURES targets were
  // forced into proposed_techniques and its RISKS targets added to
  // pitfalls; both lists are repeated here as the graph holds them. When
  // it names none, archetype_not_found lists the names the graph does
  // have, across both kinds.
  archetype: z
    .object({
      name: z.string(),
      title: z.string(),
      kind: z.string(),
      features: z.array(z.string()),
      risks: z.array(z.string()),
      resolved_from: z.string().optional(),
    })
    .optional(),
  archetype_not_found: z
    .object({
      requested: z.string(),
      known: z.array(z.string()),
      candidates: z.array(z.string()).optional(),
    })
    .optional(),
  // The GameDesigns INSTANCE_OF the resolved archetype (schema 28, tools
  // 2.1.0); c64_plan_budget takes a name as 'design'.
  designs: z.array(BriefingDesignSchema).optional(),
});
export type BriefingOutput = z.infer<typeof BriefingSchema>;

export const CoverageSchema = z.object({
  dimensions: z.object({
    technique_categories: z.array(
      z.object({
        category: z.string(),
        count: z.number().int().min(0),
      }),
    ),
    pitfall_categories: z.array(
      z.object({
        category: z.string(),
        count: z.number().int().min(0),
      }),
    ),
    recipe_toolchains: z.array(
      z.object({
        toolchain: z.string(),
        count: z.number().int().min(0),
      }),
    ),
    kernal_coverage: z.object({
      total_routines: z.number().int().min(0),
      with_doc_chunks: z.number().int().min(0),
      with_pairs_with_edge: z.number().int().min(0),
    }),
  }),
  totals: z.object({
    qdrant_chunks: z.number().int().min(0),
    falkor_nodes: z.number().int().min(0),
    falkor_edges: z.number().int().min(0),
  }),
  recent_gaps: z.array(
    z.object({
      query: z.string(),
      tool: z.string(),
      hit_count: z.number().int().min(1),
      last_seen: z.string(),
      user_reported: z.number().int(),
    }),
  ),
  generated_at: z.string(),
});

export type CoverageOutput = z.infer<typeof CoverageSchema>;

export const SuggestLinksSchema = z.object({
  suggestions: z.array(
    z.object({
      kind: z.enum([
        "technique_uses_register",
        "recipe_implements_technique",
        "pitfall_triggered_by_technique",
        "pitfall_mitigated_by_technique",
      ]),
      from: z.object({
        kind: z.string(),
        name: z.string(),
      }),
      to: z.object({
        kind: z.string(),
        name: z.string(),
      }),
      evidence: z.string(),
      confidence: z.enum(["high", "medium", "low"]),
    }),
  ),
  generated_at: z.string(),
});

export type SuggestLinksOutput = z.infer<typeof SuggestLinksSchema>;

export const ReportGapSchema = z.object({
  gap_id: z.number().int().min(1),
  hit_count: z.number().int().min(1),
  status: z.enum(["new", "incremented"]),
  message: z.string(),
});

export type ReportGapOutput = z.infer<typeof ReportGapSchema>;
