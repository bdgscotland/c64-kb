/**
 * FalkorDB rows come back as `unknown[]`. Each query in the briefing reads
 * its rows through one of these schemas, so a property the graph lacks
 * (FalkorDB returns null for it) is typed as possibly missing and the
 * fallbacks that handle it are real guards, not decoration.
 */

import { z } from "zod";

/** Parse every row of a query result; a row of the wrong shape throws. */
export function parseRows<T extends z.ZodType>(schema: T, data: unknown[]): z.infer<T>[] {
  return z.array(schema).parse(data);
}

const nullableString = z.string().nullish();
const nameList = z.array(z.string().nullish()).nullish();

export const TechniqueScoreRow = z.object({
  name: z.string(),
  title: nullableString,
  category: nullableString,
  complexity: nullableString,
  recipe_count: z.union([z.number(), z.string()]).nullish(),
});

export const ArchetypeRow = z.object({
  name: nullableString,
  title: nullableString,
  kind: nullableString,
  starter: nullableString,
});

export const BriefWordsRow = ArchetypeRow.extend({ brief_words: z.array(z.string()).nullish() });

export const NameRow = z.object({ name: nullableString });

export const RiskPitfallRow = z.object({
  name: z.string(),
  title: nullableString,
  severity: nullableString,
  triggers: nameList,
});

export const DemandsRow = z.object({ name: z.string(), demands: nameList });

export const ScaffoldRow = z.object({ name: nullableString, source_doc: nullableString });

/** Drop null and empty entries from a collect() list. */
export function presentNames(list: (string | null | undefined)[] | null | undefined): string[] {
  return (list ?? []).filter((x): x is string => typeof x === "string" && x !== "");
}
