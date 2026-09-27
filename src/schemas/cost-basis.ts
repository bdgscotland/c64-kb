import { z } from "zod";

// How a Cost line's figures were obtained, strongest first (schema 22):
// measured-vice, derived-listing, arithmetic, estimated.
export const CostBasisSchema = z.enum(["measured-vice", "derived-listing", "arithmetic", "estimated"]);

// A game design's Measured frame takes one more word (schema 40): a studied
// game's frame, read by the RE tools in VICE.
export const MeasuredFrameBasisSchema = z.enum([...CostBasisSchema.options, "measured-vice-study"]);

// Where a studied design came from (schema 40): the **Studied from:** line.
export const StudiedFromSchema = z.object({
  title: z.string(),
  year: z.number().int(),
  authors: z.array(z.string()),
  image_sha1: z.string(),
  session: z.string(),
});
