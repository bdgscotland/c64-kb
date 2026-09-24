/**
 * Output schema of c64_plan_budget, kept apart from tool-outputs.ts for
 * size; tool-outputs.ts re-exports it.
 */

import { z } from "zod";
import { CostBasisSchema } from "./cost-basis.ts";

// c64_plan_budget (schema 27, tools 2.0.0): an ad-hoc set of techniques,
// each in a phase, budgeted per phase and region by planBudget
// (src/domain/budget.ts). A missing figure is never zero: it is listed in
// unknown and to_measure, and the verdict is "undetermined".
const BudgetVerdictSchema = z.enum(["fits", "over", "undetermined"]);
const PlanPhaseSchema = z.object({
  phase: z.enum(["play", "transition", "init"]),
  region: z.enum(["PAL", "NTSC"]),
  frame: z.number().int(),
  members: z.array(z.string()),
  contributors: z.array(
    z.object({
      name: z.string(),
      low: z.number().int(),
      high: z.number().int(),
      every_frame: z.boolean(),
      basis: CostBasisSchema,
      charge: z.enum(["cycles_per_frame", "per_line", "band", "per_item"]),
      // Present when low and high are one call's figure times this many (#37),
      // or, on a per_item charge (#95), the items counted.
      calls: z.object({ low: z.number().int(), high: z.number().int() }).optional(),
      // per_item only (#95): low = base + calls.low × each, high = base + calls.high × each.
      per_item: z.object({ base: z.number().int(), each: z.number().int() }).optional(),
      measured_on: z.string().nullable(),
      conditions: z.string().nullable(),
    }),
  ),
  excluded: z.array(
    z.object({
      name: z.string(),
      reason: z.enum(["multi_frame", "included_by", "inside_band_of"]),
      by: z.string().optional(),
      cycles: z.number().int().optional(),
      measured_on: z.string().nullable().optional(),
    }),
  ),
  unknown: z.array(z.string()),
  not_found: z.array(z.string()),
  to_measure: z.array(z.object({ technique: z.string(), recipe: z.string().nullable(), why: z.string() })),
  fixed_losses: z.object({
    badlines: z.number().int(),
    sprite_dma: z.number().int(),
    charged_for: z.array(z.string()),
    badlines_in_bands: z.number().int(),
    floor: z.number().int(),
  }),
  worst_only: z.array(z.string()),
  low: z.number().int(),
  high: z.number().int(),
  floor: z.number().int(),
  verdict: BudgetVerdictSchema,
  // The weakest **Cost basis:** among the summed cycle figures; a page's
  // **Cost bytes basis:** never weakens it (#72).
  weakest_basis: CostBasisSchema.nullable(),
  irq_slots: z.number().int(),
  notes: z.array(z.string()),
});
// A GameDesign given as input (schema 28, tools 2.1.0): what it expanded
// to, and each Measured frame beside the prediction for its phase and region.
const DesignMeasuredSchema = z.object({
  phase: z.enum(["play", "transition", "init"]),
  region: z.enum(["PAL", "NTSC"]),
  worst: z.number().int(),
  typical: z.number().int().nullable(),
  basis: CostBasisSchema,
  source: z.string(),
  predicted: z
    .object({
      low: z.number().int(),
      high: z.number().int(),
      fixed: z.number().int(),
      verdict: BudgetVerdictSchema,
      missing: z.array(z.string()),
    })
    .nullable(),
  position: z.enum(["below_low", "within", "within_incomplete", "above_high", "not_predicted"]),
  finding: z.string(),
});
// One COMPOSES edge: a technique in a phase, and, where the page states
// `×N` or `×M-N` (#37, tools 2.x), its calls in the cheapest and worst frame.
const ComposesSchema = z.object({
  technique: z.string(),
  phase: z.enum(["play", "transition", "init"]),
  calls: z.object({ low: z.number().int(), high: z.number().int() }).optional(),
});
const PlanDesignSchema = z.object({
  name: z.string(),
  title: z.string(),
  region: z.enum(["PAL", "NTSC", "both"]).nullable(),
  instance_of: z.array(z.string()),
  realised_by: z.array(z.string()),
  composes: z.array(ComposesSchema),
  source_doc: z.string(),
  measured: z.array(DesignMeasuredSchema),
});
// One GameDesign of the archetype c64_game_briefing resolved: whole games
// built on it, what they compose per phase, and what their frame measured.
export const BriefingDesignSchema = z.object({
  name: z.string(),
  title: z.string(),
  realised_by: z.array(z.string()),
  composes: z.array(ComposesSchema),
  measured: z.array(
    DesignMeasuredSchema.pick({
      phase: true,
      region: true,
      worst: true,
      typical: true,
      basis: true,
      source: true,
    }),
  ),
});

export const PlanBudgetSchema = z.object({
  design: PlanDesignSchema.nullable(),
  design_not_found: z.object({ requested: z.string(), known: z.array(z.string()) }).optional(),
  techniques: z.array(z.string()),
  refused: z.array(z.object({ input: z.string(), why: z.string() })),
  region: z.enum(["PAL", "NTSC", "both"]),
  screen: z.enum(["on", "off"]),
  sprites: z
    .object({ per_line: z.number().int(), lines: z.number().int(), dma_per_frame: z.number().int() })
    .nullable(),
  phases: z.array(PlanPhaseSchema),
  bytes: z.object({
    sum: z.number().int(),
    contributors: z.array(z.object({ name: z.string(), bytes: z.number().int(), basis: CostBasisSchema })),
    excluded: z.array(
      z.object({ name: z.string(), bytes: z.number().int(), reason: z.enum(["whole_program"]) }),
    ),
    inside: z.array(z.object({ name: z.string(), by: z.string() })),
    without_bytes: z.array(z.string()),
    // The weakest byte basis among contributors (#72): a page's **Cost bytes
    // basis:** where it states one, else its **Cost basis:**.
    weakest_basis: CostBasisSchema.nullable(),
  }),
  verdict: BudgetVerdictSchema,
  assumptions: z.array(z.string()),
});
export type PlanBudgetOutput = z.infer<typeof PlanBudgetSchema>;
