/**
 * Raster bands the caller places (#90). A technique whose page says
 * `movable`, or states no band, has lines the program chooses; the check
 * cannot know them, so the line rules keep their conflict. "name@lines"
 * (the **Raster band:** grammar, e.g. "sideborder_open@248-272") says
 * where this program puts it, and the rules then read those lines as if
 * the page stated them. A recipe's `raster_bands:` frontmatter is the same
 * statement, measured in its VICE trace. A page that states lines keeps
 * them: a placement cannot move a band the page fixes.
 */

import { parseRasterBand } from "../../../graph/extract.ts";
import { parseMemberSpec } from "../plan-budget.ts";
import type { TechniqueFacts } from "./facts.ts";

interface PlacementRefusal {
  input: string;
  why: string;
}

/** "name@lines" or "name@lines:phase" -> the spec without the band, and the band. */
export function splitPlacement(spec: string): { spec: string; band?: string } {
  const m = /^([^@]*)@([^:]*)(:.*)?$/.exec(spec);
  if (!m) return { spec };
  return { spec: `${m[1] ?? ""}${m[3] ?? ""}`, band: (m[2] ?? "").trim() };
}

/**
 * The specs with their bands taken off, and the bands by technique name.
 * A technique placed twice keeps its first band.
 */
export function readPlacements(given: readonly string[]): {
  specs: string[];
  placements: Map<string, string>;
} {
  const placements = new Map<string, string>();
  const specs = given.map((raw) => {
    const { spec, band } = splitPlacement(raw);
    if (band !== undefined) {
      const head = spec.split(":")[0] ?? spec;
      const parsed = parseMemberSpec(head);
      const name = "error" in parsed ? head.trim() : parsed.name;
      if (!placements.has(name)) placements.set(name, band);
    }
    return spec;
  });
  return { specs, placements };
}

export interface Placed {
  facts: Map<string, TechniqueFacts>;
  refused: PlacementRefusal[];
}

/** Why a placement cannot be used on a technique with these facts, or null when it can. */
function refusal(band: string, F: TechniqueFacts | undefined): string | null {
  const parsed = parseRasterBand(band);
  if ("error" in parsed) return `"${band}" is not a raster band: ${parsed.error}`;
  if (parsed.kind !== "lines") return `a placement names lines; "movable" places nothing`;
  if (F?.band && F.band !== "movable")
    return `its page states lines ${F.band}; a placement moves only a movable band or an unstated one`;
  return null;
}

/**
 * The facts with each accepted placement as the technique's band
 * (bandPlaced set), and the placements refused. A refused placement leaves
 * the page's band, so a refusal can only keep a conflict, never clear one.
 * A name the graph does not hold is left to not_found.
 */
export function placeBands(
  facts: ReadonlyMap<string, TechniqueFacts>,
  placements: ReadonlyMap<string, string>,
): Placed {
  const out = new Map(facts);
  const refused: PlacementRefusal[] = [];
  for (const [name, band] of placements) {
    const F = facts.get(name);
    if (!F?.found) continue;
    const why = refusal(band, F);
    if (why) {
      refused.push({ input: `${name}@${band}`, why });
      continue;
    }
    const parsed = parseRasterBand(band);
    if ("error" in parsed) continue;
    out.set(name, { ...F, band: parsed.canonical, bandPlaced: true });
  }
  return { facts: out, refused };
}
