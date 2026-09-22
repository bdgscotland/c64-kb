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
    })
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
    })
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
    })
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
  documentation: z.array(DocChunkSchema),
});

export const RecipesForSchema = z.object({
  filter: z.object({
    toolchain: z.string().optional(),
    region: z.string().optional(),
    technique: z.string().optional(),
    file_format: z.string().optional(),
  }),
  recipes: z.array(RecipeSchema),
});

export type ToolchainHintOutput = z.infer<typeof ToolchainHintSchema>;
export type RecipeLookupOutput = z.infer<typeof RecipeLookupSchema>;
export type RecipesForOutput = z.infer<typeof RecipesForSchema>;

const TechniqueRefSchema = z.object({ name: z.string(), title: z.string() });

export const TechniqueLookupSchema = z.object({
  name: z.string(),
  title: z.string(),
  category: z.string(),
  complexity: z.string(),
  chip: z.string().optional(),
  requires_region: z.string().optional(),
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
});

export const TechniquesForSchema = z.object({
  filter: z.object({
    category: z.string().optional(),
    chip: z.string().optional(),
    region: z.string().optional(),
    register: z.string().optional(),
    recipe: z.string().optional(),
    requires: z.string().optional(),
  }),
  techniques: z.array(z.object({
    name: z.string(),
    title: z.string(),
    category: z.string(),
    complexity: z.string(),
  })),
});

export const CompatibilityConflictSchema = z.object({
  a: z.string(),
  b: z.string(),
  kind: z.enum([
    "region_mismatch",   // one needs PAL, the other NTSC
    "cpu_exclusive",     // both need every CPU cycle on the lines they cover
    "cpu_vs_irq",        // one needs every CPU cycle; the other takes interrupts mid-frame
    "sprite_set",        // one needs a constant sprite set; the other changes it mid-frame
    "kernal_banked_out", // one runs with the KERNAL ROM out; the other calls KERNAL routines
    "prerequisite_conflict", // a hard rule fires between a technique and a REQUIRES prerequisite of another
    "shared_register",   // both touch the same register (soft)
    "shared_kernal",     // both call the same KERNAL routine (soft)
  ]),
  // hard: cannot coexist as combined; the resolution says how to separate them.
  // soft: combinable with coordination.
  severity: z.enum(["hard", "soft"]),
  shared: z.array(z.string()),
  rationale: z.string(),
  resolution: z.string().optional(),
  // prerequisite_conflict only: the closure members the rule actually fired
  // between, when they differ from a and b (which name the input techniques).
  via: z.array(z.string()).optional(),
});

export const SharedInfrastructureSchema = z.object({
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
export const CompatibilityCoverageSchema = z.object({
  technique: z.string(),
  found: z.boolean(),
  registers: z.number(),
  kernal_routines: z.number(),
  demands: z.array(z.string()),
  known: z.boolean(),
  // Present when the technique was not in the input set but entered the
  // check through another technique's REQUIRES closure.
  implied_by: z.array(z.string()).optional(),
});

export const CompatibilityCheckSchema = z.object({
  techniques: z.array(z.string()),
  conflicts: z.array(CompatibilityConflictSchema),
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
  user_cycles_per_line_normal: z.number(),
  user_cycles_per_line_badline: z.number(),
  notes: z.array(z.string()),
});

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
  pitfalls: z.array(z.object({
    name: z.string(),
    title: z.string(),
    severity: z.enum(["critical", "high", "medium", "low"]),
    region: z.enum(["pal", "ntsc", "both"]),
    category: z.string(),
    triggered_by: z.array(TriggeredBySchema),
    // Techniques whose application is this pitfall's Fix (MITIGATED_BY).
    mitigated_by: z.array(TriggeredBySchema),
  })),
  search_results: z.array(z.object({
    source: z.string(),
    section: z.string(),
    text: z.string(),
    score: z.number(),
  })).optional(),
});

export const FailureDiagnoseSchema = z.object({
  query: z.string(),
  matches: z.array(z.object({
    symptom: z.string(),
    description: z.string(),
    likely_causes: z.array(z.string()),
    diagnosis_steps: z.string(),
    caused_by: z.array(TriggeredBySchema),
    relevance: z.number().min(0).max(1),
  })),
});

export type PitfallsForOutput = z.infer<typeof PitfallsForSchema>;
export type FailureDiagnoseOutput = z.infer<typeof FailureDiagnoseSchema>;

export const BriefingSchema = z.object({
  brief: z.string(),
  proposed_techniques: z.array(z.object({
    name: z.string(),
    title: z.string(),
    category: z.string(),
    complexity: z.enum(["low", "medium", "high", "scene-tier"]).optional(),
    why_proposed: z.string(),
    uses_registers: z.array(z.string()),
    uses_kernal: z.array(z.string()),
    region: z.enum(["pal", "ntsc", "both"]).optional(),
    implementing_recipes: z.array(z.string()),
  })),
  compatibility: z.object({
    conflicts: z.array(CompatibilityConflictSchema),
    warnings: z.array(CompatibilityConflictSchema),
    shared_infrastructure: z.array(SharedInfrastructureSchema),
  }),
  pitfalls: z.array(z.object({
    name: z.string(),
    title: z.string(),
    severity: z.string(),
    triggered_by_proposed: z.array(z.string()),
  })),
  toolchain_split: z.object({
    primary: z.string(),
    cycle_tight_handoff: z.array(z.string()),
    rationale: z.string(),
  }),
  build_order: z.array(z.object({
    step: z.number(),
    label: z.string(),
    recipes: z.array(z.string()),
  })),
});
export type BriefingOutput = z.infer<typeof BriefingSchema>;

export const CoverageSchema = z.object({
  dimensions: z.object({
    technique_categories: z.array(z.object({
      category: z.string(),
      count: z.number().int().min(0),
    })),
    pitfall_categories: z.array(z.object({
      category: z.string(),
      count: z.number().int().min(0),
    })),
    recipe_toolchains: z.array(z.object({
      toolchain: z.string(),
      count: z.number().int().min(0),
    })),
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
  recent_gaps: z.array(z.object({
    query: z.string(),
    tool: z.string(),
    hit_count: z.number().int().min(1),
    last_seen: z.string(),
    user_reported: z.number().int(),
  })),
  generated_at: z.string(),
});

export type CoverageOutput = z.infer<typeof CoverageSchema>;

export const SuggestLinksSchema = z.object({
  suggestions: z.array(z.object({
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
  })),
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
