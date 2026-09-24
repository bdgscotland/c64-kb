/**
 * State one technique keeps up against another's KERNAL disk I/O (#94):
 * a raster IRQ left armed, sprites left on, the KERNAL ROM left banked
 * out. They hold within one phase, and across phases too, because a
 * phase boundary changes when code runs, not what the machine is left
 * doing: the #22 game test's play phase ran with $01 = $35, its IRQ at
 * $FFFE and 17 sprites, and its transition loaded level 2 through the
 * KERNAL. Every check within one phase said nothing.
 *
 * - raster_irq_during_serial_io, sprites_over_badlines_hang_serial_io
 *   (soft): the pitfalls of those names (pitfalls/kernal-and-io.md), with
 *   the KERNAL routines their **Triggered by kernal:** lines name, read
 *   from the graph. The other side keeps a raster IRQ (it demands
 *   midframe_raster_irqs or claims vic_raster_irq) or shows sprites (it
 *   demands changes_sprite_set or claims a sprite).
 *   Across phases the state goes forward only: init runs first, so what
 *   play or a transition leaves running never reaches an init member.
 * - kernal_banked_out across phases (soft): one phase runs with the
 *   KERNAL out, another calls it. Within one phase the hard rule in
 *   hard-rules.ts holds.
 * - recipe_kernal_out (info): every recipe that builds one technique also
 *   implements a technique that runs with the KERNAL out, or owns
 *   irq_vector_fffe, while the other technique calls the KERNAL. It is the
 *   recipe's choice, not the technique's, so it never changes a verdict;
 *   list ram_under_kernal to have the check hold the design to it.
 */

import type { BudgetPhase } from "../../../domain/budget.ts";
import type { CompatibilityCheckOutput } from "../../../schemas/tool-outputs.ts";
import type { TechniqueFacts } from "./facts.ts";

type Conflict = CompatibilityCheckOutput["conflicts"][number];

/** A pitfall and the KERNAL routines that trigger it (TRIGGERED_BY → KernalRoutine). */
export interface SerialPitfall {
  name: string;
  routines: readonly string[];
}

/** A recipe that builds an input, and what makes it run with the KERNAL out. */
export interface RecipeKernalOut {
  recipe: string;
  /** The input techniques it IMPLEMENTS. */
  implements: readonly string[];
  /** The KERNAL-out techniques it also implements, and "irq_vector_fffe" when it owns that vector; empty when it keeps the KERNAL in. */
  via: readonly string[];
}

export interface StateSide {
  name: string;
  facts: TechniqueFacts;
  /** Set in a phased check; two sides in different phases make a cross-phase finding. */
  phase?: BudgetPhase | undefined;
}

export interface StateData {
  serialPitfalls?: readonly SerialPitfall[] | undefined;
  recipeKernalOut?: readonly RecipeKernalOut[] | undefined;
}

export const RASTER_IRQ_PITFALL = "raster_irq_during_serial_io";
export const SPRITE_PITFALL = "sprites_over_badlines_hang_serial_io";

const holds = (f: TechniqueFacts, units: (u: string) => boolean): boolean =>
  f.claims.some((c) => units(c.unit) && (c.mode === "owns" || c.mode === "shares"));

function keepsRasterIrq(f: TechniqueFacts): boolean {
  return f.demands.has("midframe_raster_irqs") || holds(f, (u) => u === "vic_raster_irq");
}

function showsSprites(f: TechniqueFacts): boolean {
  return f.demands.has("changes_sprite_set") || holds(f, (u) => /^sprite_[0-7]$/.test(u));
}

function across(x: StateSide, y: StateSide): boolean {
  return x.phase !== undefined && y.phase !== undefined && x.phase !== y.phase;
}

/** "(play)" / "", for naming a side in a rationale. */
const at = (s: StateSide): string => (s.phase ? ` (${s.phase})` : "");

function tagged(x: StateSide, y: StateSide, c: Omit<Conflict, "a" | "b">): Conflict {
  const phases = across(x, y) && x.phase && y.phase ? { across: { a_phase: x.phase, b_phase: y.phase } } : {};
  return { a: x.name, b: y.name, ...c, ...phases };
}

const WHY_RASTER =
  "a raster IRQ left armed across KERNAL disk I/O misses most frames, and Oscar64's rirq_stop() does not stop it";
const WHY_SPRITES =
  "sprites on badline rows during a KERNAL disk read can make the C64 miss a clock pulse and wait for ever";

function pitfallFinding(x: StateSide, y: StateSide, p: SerialPitfall): Conflict | null {
  const calls = y.facts.kernal.filter((k) => p.routines.includes(k)).sort();
  if (calls.length === 0) return null;
  const raster = p.name === RASTER_IRQ_PITFALL;
  if (raster ? !keepsRasterIrq(x.facts) : !showsSprites(x.facts)) return null;
  const what = raster ? "keeps a raster IRQ armed" : "shows sprites";
  const where = across(x, y)
    ? `unless the phase boundary undoes that, it still does when ${y.name}${at(y)} calls`
    : `${y.name} calls`;
  const fix = raster
    ? `Before ${y.name}'s calls clear $D01A (no raster IRQ source) and set the screen to the state to hold; re-arm after.`
    : `Write 0 to $D015 (or blank the screen, $D011 bit 4) around every disk call, and stop the IRQ that rewrites $D015 too.`;
  return tagged(x, y, {
    kind: raster ? "raster_irq_during_serial_io" : "sprites_over_badlines_hang_serial_io",
    severity: "soft",
    shared: calls,
    rationale: `${x.name}${at(x)} ${what}; ${where} ${calls.join(", ")}: ${raster ? WHY_RASTER : WHY_SPRITES} (pitfall ${p.name}).`,
    resolution: `${fix} c64_pitfalls_for ${p.name} has the measurement.`,
  });
}

/** One phase runs with the KERNAL out, another calls it: soft, since the boundary can bank it in. */
function kernalOutAcrossPhases(x: StateSide, y: StateSide): Conflict | null {
  if (!across(x, y) || !x.facts.demands.has("kernal_rom_out") || y.facts.kernal.length === 0) return null;
  return tagged(x, y, {
    kind: "kernal_banked_out",
    severity: "soft",
    shared: [...y.facts.kernal],
    rationale: `${x.name}'s phase (${x.phase}) runs with the KERNAL ROM banked out; ${y.name}'s phase (${y.phase}) calls ${y.facts.kernal.join(", ")}, which are not there unless the boundary banks it back in.`,
    resolution: `Between the phases: SEI, stop the raster IRQ, set $01 back to $37 (or $36) so the KERNAL and its $FFFE handler are in, then make the calls; bank it out and re-arm after.`,
  });
}

/**
 * Every recipe that builds x (and not y) runs KERNAL-out, while y calls the
 * KERNAL: info. One KERNAL-in recipe of x is a way to build it that keeps
 * the KERNAL, and then there is nothing to say.
 */
function recipeKernalOut(x: StateSide, y: StateSide, data: StateData): Conflict | null {
  if (y.facts.kernal.length === 0 || x.facts.demands.has("kernal_rom_out")) return null;
  const recipes = (data.recipeKernalOut ?? []).filter(
    (r) => r.implements.includes(x.name) && !r.implements.includes(y.name),
  );
  if (recipes.length === 0 || recipes.some((r) => r.via.length === 0)) return null;
  const how = recipes.map((r) => `${r.recipe} (${r.via.join(", ")})`).join("; ");
  const every = recipes.length === 1 ? "The one recipe that builds" : "Every recipe that builds";
  return tagged(x, y, {
    kind: "recipe_kernal_out",
    severity: "info",
    shared: [...y.facts.kernal],
    rationale: `${every} ${x.name} runs with the KERNAL ROM banked out: ${how}. ${y.name} calls ${y.facts.kernal.join(", ")}. The techniques do not conflict; a program built on that listing does, unless it banks the KERNAL in around the calls.`,
    resolution: `If the program keeps that listing's banking, list ram_under_kernal with ${x.name} so the check holds the design to it (kernal_banked_out), and bank the KERNAL in ($01 = $37, IRQ stopped) around ${y.name}'s calls.`,
  });
}

/**
 * Whether x's state can still be up when y runs. Init runs first, once, so
 * nothing a later phase leaves running reaches it; every other order can
 * happen (play, transition, play again).
 */
function reaches(x: StateSide, y: StateSide): boolean {
  return !(across(x, y) && y.phase === "init");
}

/** Every state finding between x and y, both directions. */
export function stateRules(a: StateSide, b: StateSide, data: StateData): Conflict[] {
  const out: Conflict[] = [];
  for (const [x, y] of [
    [a, b],
    [b, a],
  ] as const) {
    if (!reaches(x, y)) continue;
    for (const p of data.serialPitfalls ?? []) {
      const hit = pitfallFinding(x, y, p);
      if (hit) out.push(hit);
    }
    for (const hit of [kernalOutAcrossPhases(x, y), recipeKernalOut(x, y, data)]) if (hit) out.push(hit);
  }
  return out;
}
