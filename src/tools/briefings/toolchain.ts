/**
 * Which proposed techniques the primary toolchain (Oscar64) keeps and which
 * are handed to KickAssembler.
 *
 * The handoff is decided by what a technique DEMANDS of the machine (the
 * DEMANDS edges the compatibility checker already reads), not by its
 * category name. Deciding by category handed starfield (effect) to
 * assembly and sprite_multiplex_24 (sprite) to C, which was backwards.
 */

import { getFalkor } from "../../context.ts";
import type { BriefingOutput, TechniqueLookupOutput } from "../../schemas/tool-outputs.ts";
import { DemandsRow, parseRows, presentNames } from "./rows.ts";

const PRIMARY_TOOLCHAIN = "oscar64";

const CYCLE_TIGHT_DEMANDS = new Set([
  "cpu_every_line",
  "midframe_raster_irqs",
  "continuous_interrupts",
  "badline_free_region",
  "changes_sprite_set",
]);

async function demandsOf(names: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (names.length === 0) return out;
  const fk = await getFalkor();
  const result = await fk.roQuery(
    `MATCH (t:Technique)-[:DEMANDS]->(r:Resource) WHERE t.name IN $names
     RETURN t.name AS name, collect(r.name) AS demands`,
    { names },
  );
  for (const row of parseRows(DemandsRow, result.data)) out.set(row.name, presentNames(row.demands));
  return out;
}

function rationaleFor(handoff: string[], keptInPrimary: string[]): string {
  const handoffPart =
    handoff.length > 0
      ? `KickAssembler handles cycle-tight work for: ${handoff.join(", ")} ` +
        `(each needs every cycle of the line or is scene-tier, or takes raster interrupts inside the display, interrupts all frame, a badline-free region or a changing sprite set and has no Oscar64 recipe).`
      : "No technique in this set demands cycle-exact timing of the machine that Oscar64 has no recipe for — Oscar64 can handle all components.";
  const keptPart =
    keptInPrimary.length > 0
      ? ` Cycle-tight but kept in Oscar64 because a recipe exists: ${keptInPrimary.join(", ")}.`
      : "";
  return (
    "Oscar64 is the primary toolchain per c64-kb policy (modern C/C++ → 6502, idiomatic patterns). " +
    handoffPart +
    keptPart
  );
}

export async function toolchainSplit(
  techs: TechniqueLookupOutput[],
): Promise<BriefingOutput["toolchain_split"]> {
  const demands = await demandsOf(techs.map((t) => t.name));
  const demandList = (t: TechniqueLookupOutput) => demands.get(t.name) ?? [];
  const cycleTight = techs.filter(
    (t) => demandList(t).some((d) => CYCLE_TIGHT_DEMANDS.has(d)) || t.complexity === "scene-tier",
  );
  // A cycle-tight technique the primary toolchain already has a recipe for
  // stays in C: the KB's own Oscar64 stable-raster-irq, raster-bars and
  // multiplexer recipes are the evidence that it can be done there. Only a
  // technique that needs every cycle of the line, or is scene-tier, is
  // handed off regardless of recipes.
  const hasPrimaryRecipe = (t: TechniqueLookupOutput) =>
    t.recipes.some((r) => r.toolchain === PRIMARY_TOOLCHAIN || r.name.startsWith(`${PRIMARY_TOOLCHAIN}-`));
  const mustHandOff = (t: TechniqueLookupOutput) =>
    demandList(t).includes("cpu_every_line") || t.complexity === "scene-tier";
  const handedOff = cycleTight.filter((t) => mustHandOff(t) || !hasPrimaryRecipe(t));
  const keptInPrimary = cycleTight.filter((t) => !handedOff.includes(t)).map((t) => t.name);
  const cycle_tight_handoff = handedOff.map((t) => t.name);
  return {
    primary: PRIMARY_TOOLCHAIN,
    cycle_tight_handoff,
    rationale: rationaleFor(cycle_tight_handoff, keptInPrimary),
  };
}
