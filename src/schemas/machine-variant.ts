/**
 * One VERIFIED_ON edge as c64_recipe_lookup returns it (schema 29): a
 * machine variant verify:recipes runs the recipe on, with the run's
 * parameters from docs/recipes/runs.json. vic, sid and cia are the chips
 * the run had: a chip flag in `flags` replaces the variant's.
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
  /**
   * Chips the run's flags replaced ("CIA 8521 -> 6526 (-ciamodel 0)"); vic,
   * sid and cia are already the replaced values. Empty when none.
   */
  overrides: z.array(z.string()),
});
