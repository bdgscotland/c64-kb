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
import { REGION_TIMING } from "../../domain/timing.ts";

const PRIMARY_TOOLCHAIN = "oscar64";

// A quarter of a PAL frame (19,656 / 4 = 4,914 cycles). Policy, not a
// measurement: work that heavy, whose only figure is another toolchain's
// code, has no evidence it fits a frame in C.
const HEAVY_CYCLES = REGION_TIMING.PAL.cycles_per_frame / 4;

const hasPrimaryRecipe = (t: TechniqueLookupOutput) =>
  t.recipes.some((r) => r.toolchain === PRIMARY_TOOLCHAIN || r.name.startsWith(`${PRIMARY_TOOLCHAIN}-`));

/**
 * True when a technique's Cost is a quarter of a PAL frame or more, was
 * measured on a recipe in another toolchain, and no Oscar64 recipe
 * implements it. Its figure stands for that code: row_map_redraw's 13,304
 * cycles are a patched `LDA abs,Y` / `STA abs,Y` loop at 14 cycles a byte,
 * and the split kept it in Oscar64 because it demands nothing cycle-exact
 * (KB-GAPS 8, FIREBASE build).
 */
export function heavyOffPrimary(t: TechniqueLookupOutput): boolean {
  const on = t.cost?.measured_on;
  if (on === undefined || on.startsWith(`${PRIMARY_TOOLCHAIN}-`) || hasPrimaryRecipe(t)) return false;
  return (t.cost?.cycles_per_frame ?? 0) >= HEAVY_CYCLES;
}

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

function rationaleFor(handoff: string[], keptInPrimary: string[], heavy: string[]): string {
  const handoffPart =
    handoff.length > 0
      ? `KickAssembler handles cycle-tight work for: ${handoff.join(", ")} ` +
        `(each needs every cycle of the line or is scene-tier, or takes raster interrupts inside the display, interrupts all frame, a badline-free region or a changing sprite set and has no Oscar64 recipe).`
      : "No technique in this set demands cycle-exact timing of the machine that Oscar64 has no recipe for — Oscar64 can handle all components.";
  const keptPart =
    keptInPrimary.length > 0
      ? ` Cycle-tight but kept in Oscar64 because a recipe exists: ${keptInPrimary.join(", ")}.`
      : "";
  const heavyPart =
    heavy.length > 0
      ? ` KickAssembler also takes ${heavy.join(", ")}: each costs a quarter of a PAL frame or more, measured only on a recipe in another toolchain, and has no Oscar64 recipe.`
      : "";
  return (
    "Oscar64 is the primary toolchain per c64-kb policy (modern C/C++ → 6502, idiomatic patterns). " +
    handoffPart +
    keptPart +
    heavyPart
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
  const mustHandOff = (t: TechniqueLookupOutput) =>
    demandList(t).includes("cpu_every_line") || t.complexity === "scene-tier";
  const handedOff = cycleTight.filter((t) => mustHandOff(t) || !hasPrimaryRecipe(t));
  const keptInPrimary = cycleTight.filter((t) => !handedOff.includes(t)).map((t) => t.name);
  const heavy = techs.filter((t) => !handedOff.includes(t) && heavyOffPrimary(t)).map((t) => t.name);
  const tight = handedOff.map((t) => t.name);
  return {
    primary: PRIMARY_TOOLCHAIN,
    cycle_tight_handoff: [...tight, ...heavy],
    rationale: rationaleFor(tight, keptInPrimary, heavy),
  };
}
