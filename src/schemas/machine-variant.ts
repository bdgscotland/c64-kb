/**
 * One VERIFIED_ON edge as c64_recipe_lookup returns it (schema 29): a
 * machine variant verify:recipes runs the recipe on, with the run's
 * parameters from docs/recipes/runs.json.
 */

import { z } from "zod";

export const VerifiedOnSchema = z.object({
  variant: z.string(),
  vic: z.string(),
  sid: z.string(),
  cia: z.string(),
  region: z.string(),
  model: z.string(),
  cycles: z.number().int(),
  shot: z.string(),
  flags: z.string(),
  pinned: z.boolean(),
});
