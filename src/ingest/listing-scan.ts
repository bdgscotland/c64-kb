/**
 * After pass 2: scan every recipe page's listing for stores to a
 * HardwareUnit its claims do not declare (src/graph/listing-stores.ts).
 * The techniques' claims and REQUIRES come from the graph, so a recipe
 * this run skipped as unchanged is still scanned against today's pages.
 * Warnings only: the scan creates no edge.
 */

import { z } from "zod";
import { CLAIM_MODES } from "../graph/claims.ts";
import { scanRecipePage, type TechniqueClaimSet } from "../graph/listing-stores.ts";
import type { FalkorService } from "../services/falkor.ts";
import { log } from "./files.ts";

const TechniqueRow = z.object({
  name: z.string(),
  stated: z.string().nullable(),
  claims: z.array(z.object({ unit: z.string().nullable(), mode: z.enum(CLAIM_MODES).nullable() })),
  requires: z.array(z.string().nullable()),
});

/** Every technique's CLAIMS (null when the page states none) and REQUIRES, from the graph. */
async function techniqueClaimSets(falkor: FalkorService): Promise<Map<string, TechniqueClaimSet>> {
  const rows = z.array(TechniqueRow).parse(
    (
      await falkor.roQuery(
        `MATCH (t:Technique)
         OPTIONAL MATCH (t)-[c:CLAIMS]->(h:HardwareUnit)
         WITH t, collect({unit: h.name, mode: c.mode}) AS claims
         OPTIONAL MATCH (t)-[:REQUIRES]->(p:Technique)
         RETURN t.name AS name, t.claims_stated AS stated, claims, collect(p.name) AS requires`,
      )
    ).data,
  );
  return new Map(
    rows.map((r) => [
      r.name,
      {
        claims:
          r.stated === "stated" || r.stated === "none"
            ? r.claims.flatMap((c) => (c.unit && c.mode ? [{ unit: c.unit, mode: c.mode }] : []))
            : null,
        requires: r.requires.filter((p): p is string => p !== null),
      },
    ]),
  );
}

/** Warn for each recipe store no claim covers; returns the warning count. */
export async function scanRecipeListings(
  falkor: FalkorService,
  contents: ReadonlyMap<string, string>,
  print: (line: string) => void,
): Promise<number> {
  const techniques = await techniqueClaimSets(falkor);
  const recipes = new Set<string>();
  let warnings = 0;
  for (const [file, content] of contents) {
    if (!file.startsWith("recipes/")) continue;
    for (const w of scanRecipePage(content, file, techniques)) {
      console.warn(`[ingest] listing scan: ${w}`);
      log(`LISTING_SCAN ${w}`);
      recipes.add(file);
      warnings++;
    }
  }
  print(
    `Listing scan: ${warnings} store(s) to undeclared units in ${recipes.size} recipe(s)${warnings > 0 ? "; see the [ingest] listing scan lines above" : ""}`,
  );
  return warnings;
}
