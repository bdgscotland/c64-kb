import { z } from "zod";

// How a Cost line's figures were obtained, strongest first (schema 22):
// measured-vice, derived-listing, arithmetic, estimated.
export const CostBasisSchema = z.enum(["measured-vice", "derived-listing", "arithmetic", "estimated"]);
