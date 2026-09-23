/**
 * Extract graph entities from knowledge-base markdown documents.
 *
 * A page declares its type with a `<!-- doc-type: … -->` marker; each type
 * has one parser under src/graph/extract/, following the matching
 * docs/CONVENTIONS-*.md. This file dispatches on the marker and re-exports
 * the parsers' public names so importers keep one path.
 */

import { parseArchetypeDoc } from "./extract/archetype.ts";
import { parseFailureDoc } from "./extract/failure.ts";
import { parseHardwareDoc } from "./extract/hardware.ts";
import { parsePitfallDoc } from "./extract/pitfall.ts";
import { parseRecipeDoc } from "./extract/recipe.ts";
import { parseTechniqueDoc } from "./extract/technique.ts";
import { parseFormatDoc, parseToolchainDoc } from "./extract/toolchain.ts";
import type { DocParser, GraphEntity } from "./extract/types.ts";

export type { GraphEntity } from "./extract/types.ts";
export { COST_BASIS_WORDS, COST_VOCABULARY, DEMAND_VOCABULARY } from "./extract/vocabulary.ts";
export { parseRasterBand, rasterBandsOverlap } from "./extract/raster-band.ts";

/**
 * Marker -> parser, in the order the markers are tested. A page carrying
 * more than one marker is parsed by the first that matches.
 */
const PARSERS: readonly (readonly [marker: string, parse: DocParser])[] = [
  ["<!-- doc-type: hardware-reference -->", parseHardwareDoc],
  ["<!-- doc-type: toolchain-reference -->", parseToolchainDoc],
  ["<!-- doc-type: format-reference -->", parseFormatDoc],
  ["<!-- doc-type: recipe -->", parseRecipeDoc],
  ["<!-- doc-type: technique-reference -->", parseTechniqueDoc],
  ["<!-- doc-type: pitfall-reference -->", parsePitfallDoc],
  ["<!-- doc-type: archetype-reference -->", parseArchetypeDoc],
  ["<!-- doc-type: failure-reference -->", parseFailureDoc],
];

export function extractGraphEntities(content: string, sourcePath: string): GraphEntity[] {
  // CONVENTIONS-*.md docs intentionally carry doc-type markers to explain them,
  // but their example headings should not become graph entities. Skip by basename.
  const basename = sourcePath.replace(/^.*\//, "");
  if (basename.startsWith("CONVENTIONS-")) return [];
  const entry = PARSERS.find(([marker]) => content.includes(marker));
  return entry ? entry[1](content, sourcePath) : [];
}
