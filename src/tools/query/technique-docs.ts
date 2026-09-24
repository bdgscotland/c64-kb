/**
 * The Documentation section of a technique card: the hybrid search's
 * chunks, kept only when they are about the technique.
 *
 * Until #41 the card printed the search's best three, whatever they were:
 * `mob_priority` got an `iecbus.h` section, `sprite_expand` got `mouse.h`,
 * `stable_raster_irq` got vice-reference.md's ROM-licensing pitfall, and
 * `raster_split_modes` said no recipe was written and then printed fld.md's
 * Expected output. Hybrid scores are rank-fused, not a relevance measure,
 * so the floor is what the chunk says, not its score.
 */

import { z } from "zod";
import { getFalkor } from "../../context.ts";
import { parseRows, searchChunks, type Chunk } from "./shared.ts";

/** Chunks the search is asked for; the floor keeps at most DOC_LIMIT of them. */
const DOC_CANDIDATES = 10;
const DOC_LIMIT = 3;

const SourceRow = z.object({ source: z.string().nullable() });

/** The source pages of the recipes that realise the technique. */
async function recipeSources(name: string): Promise<Set<string>> {
  const f = await getFalkor();
  const rows = parseRows(
    SourceRow,
    await f.roQuery(
      `MATCH (t:Technique {name: $name})<-[:IMPLEMENTS]-(r:Recipe) RETURN r.source_doc AS source`,
      { name },
    ),
  );
  return new Set(rows.map((r) => r.source).filter((s): s is string => Boolean(s)));
}

/**
 * A chunk is about the technique when it is under the technique's own
 * heading (`## name — Title`), comes from a recipe that realises it, or
 * names it. Anything else is below the floor and is not printed.
 */
export function isAboutTechnique(chunk: Chunk, name: string, recipePages: ReadonlySet<string>): boolean {
  if (chunk.section.split(" > ").some((h) => h === name || h.startsWith(`${name} — `))) return true;
  if (recipePages.has(chunk.source)) return true;
  return new RegExp(`\\b${name}\\b`).test(chunk.text);
}

/** Up to three chunks about the technique, in the search's order; none when nothing clears the floor. */
export async function techniqueDocumentation(name: string, title: string): Promise<Chunk[]> {
  const [{ chunks }, pages] = await Promise.all([
    searchChunks({ query: `${name} ${title}`.trim(), limit: DOC_CANDIDATES }),
    recipeSources(name),
  ]);
  return chunks.filter((c) => isAboutTechnique(c, name, pages)).slice(0, DOC_LIMIT);
}
