/**
 * Output schema of c64_check_compatibility, kept apart from tool-outputs.ts
 * for size; tool-outputs.ts re-exports it.
 */

import { z } from "zod";

// Whether a technique page states unit claims (schema 25).
export const ClaimsStatedSchema = z.enum(["stated", "none", "unknown"]);

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
  // Schema 34, from recipes' claims: frontmatter:
  "recipe_zero_page_overlap", // a recipe of one and a recipe of the other own zero-page bytes in common (info)
  // Schema 36, from recipes' devices: frontmatter and docs/hardware/devices.md:
  "recipe_device_conflict", // a recipe of one and a recipe of the other need devices that own one unit or share a one-socket port (info)
] as const;

const DesignPhaseSchema = z.enum(["play", "transition", "init"]);

export const CompatibilityConflictSchema = z.object({
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
  // A design check only (#37): the phase whose members were checked together.
  phase: DesignPhaseSchema.optional(),
});

export const SharedInfrastructureSchema = z.object({
  name: z.string(),
  kind: z.enum(["Register", "KernalRoutine", "discipline", "missing_prerequisite"]),
  via_recipes: z.array(z.string()),
  // missing_prerequisite only: the input techniques whose REQUIRES closure
  // contains this technique, which was not itself in the input set.
  required_by: z.array(z.string()).optional(),
  phase: DesignPhaseSchema.optional(),
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
  phase: DesignPhaseSchema.optional(),
});

export const CompatibilityCheckSchema = z.object({
  techniques: z.array(z.string()),
  conflicts: z.array(CompatibilityConflictSchema),
  // Pairs a line-sharing rule would have caught, cleared because both pages
  // state **Raster band:** line ranges that share no raster line (schema 24).
  band_separated: z.array(BandSeparatedSchema),
  shared_infrastructure: z.array(SharedInfrastructureSchema),
  data_coverage: z.array(CompatibilityCoverageSchema),
  // Input names with no Technique node; any makes the verdict unknown_technique.
  not_found: z.array(z.string()),
  verdict: z.enum(["compatible", "warnings", "incompatible", "unknown_technique"]),
  // A GameDesign given as input (#37): its phases were checked one at a
  // time, since init and transition members do not run beside play. The
  // lists above are every phase's, each entry tagged with its phase; the
  // verdict is the worst phase's.
  design: z.object({ name: z.string(), title: z.string(), source_doc: z.string() }).optional(),
  phases: z
    .array(
      z.object({
        phase: DesignPhaseSchema,
        techniques: z.array(z.string()),
        verdict: z.enum(["compatible", "warnings", "incompatible", "unknown_technique"]),
      }),
    )
    .optional(),
});
