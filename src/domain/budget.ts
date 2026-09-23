/**
 * The honest budget (#22 step 3, schema 27): add a set of techniques up
 * against a frame without pretending. Pure, so a test can hand it fixtures.
 *
 * The rules, each from a composition that summing Cost lines got wrong
 * (design 2.1):
 * - A missing figure is never zero. A member with no cycles figure is
 *   unknown, the verdict becomes `undetermined`, and the output says what
 *   to measure and on which recipe.
 * - A figure above one frame is a multi-frame operation. It is never summed,
 *   and the verdict cannot be `fits` while one is in the phase.
 * - A worst frame is a ceiling. Where a page states a measured typical
 *   frame, the result is a range: low sums typical figures (worst where
 *   there is none), high sums worst figures.
 * - Work counted in one figure is not counted again: `**Cost includes:**`
 *   drops the included members, and a technique that holds the CPU on every
 *   line of a stated raster band is charged band lines × line length, with
 *   its REQUIRES closure inside that band not added.
 * - Phases (play, transition, init) are budgeted alone.
 * - With the screen on, unless every summed figure says it was measured
 *   with the screen on, the frame's badline stalls and any stated sprite
 *   DMA are charged as fixed losses (a ceiling).
 * - Bytes flagged as a whole program (`(whole PRG)` in the measured-on
 *   conditions) are not summed; they count the runtime once per technique.
 */

import { parseRasterBand } from "../graph/extract/raster-band.ts";
import { BADLINE_CYCLES_LOST, REGION_TIMING, spriteDmaCycles, type VideoRegion } from "./timing.ts";

export const BUDGET_PHASES = ["play", "transition", "init"] as const;
export type BudgetPhase = (typeof BUDGET_PHASES)[number];
type BudgetBasis = "measured-vice" | "derived-listing" | "arithmetic" | "estimated";
type BudgetVerdict = "fits" | "over" | "undetermined";

// Strongest first; the weakest basis in a sum is named beside it.
const BASIS_STRENGTH: readonly BudgetBasis[] = [
  "measured-vice",
  "derived-listing",
  "arithmetic",
  "estimated",
];

// Badlines in a frame with the display on: one every eighth line of the 200
// display lines, 25, each taking 43 cycles from code that is not writing
// (40 from code that is). Arithmetic from the constants in timing.ts.
const BADLINES_PER_FRAME = 25;
// Display lines a sprite set is assumed to cover when the caller states
// sprites per line but not the lines: the whole 200-line display, a ceiling.
const DEFAULT_SPRITE_LINES = 200;

export interface BudgetCost {
  cycles_per_frame?: number | undefined;
  cycles_per_frame_typical?: number | undefined;
  cycles_per_line?: number | undefined;
  lines_active?: number | undefined;
  bytes_code?: number | undefined;
  bytes_data?: number | undefined;
  irq_slots?: number | undefined;
  basis: BudgetBasis;
  measured_on?: string | undefined;
  conditions?: string | undefined;
  includes?: string[] | undefined;
}

export interface BudgetMember {
  name: string;
  phase: BudgetPhase;
  /** False when no Technique node has this name. */
  found: boolean;
  requires_region?: string | undefined;
  /** Canonical **Raster band:** value, when the page states one. */
  raster_band?: string | undefined;
  /** Every technique reachable over REQUIRES from this one. */
  requires_closure?: string[] | undefined;
  /** Recipes that IMPLEMENT the technique: where a missing figure could be measured. */
  recipes?: string[] | undefined;
  cost?: BudgetCost | undefined;
}

export interface BudgetOptions {
  region?: "PAL" | "NTSC" | "both" | undefined;
  screen?: "on" | "off" | undefined;
  sprites_per_line?: number | undefined;
  sprite_lines?: number | undefined;
}

interface BudgetContributor {
  name: string;
  low: number;
  high: number;
  basis: BudgetBasis;
  /** How the figure was charged: the Cost line's cycles_per_frame, per-line × lines, or a raster band. */
  charge: "cycles_per_frame" | "per_line" | "band";
  measured_on: string | null;
  conditions: string | null;
}

interface BudgetExcluded {
  name: string;
  reason: "multi_frame" | "included_by" | "inside_band_of";
  /** The member whose figure already holds this one's work. */
  by?: string | undefined;
  /** The figure left out, when there is one. */
  cycles?: number | undefined;
  measured_on?: string | null | undefined;
}

interface BudgetToMeasure {
  technique: string;
  recipe: string | null;
  why: string;
}

export interface PhaseBudget {
  phase: BudgetPhase;
  region: VideoRegion;
  frame: number;
  members: string[];
  contributors: BudgetContributor[];
  excluded: BudgetExcluded[];
  unknown: string[];
  not_found: string[];
  to_measure: BudgetToMeasure[];
  fixed_losses: { badlines: number; sprite_dma: number; charged_for: string[] };
  /** Summed members whose low end is a worst frame: no typical figure is measured. */
  worst_only: string[];
  low: number;
  high: number;
  verdict: BudgetVerdict;
  weakest_basis: BudgetBasis | null;
  irq_slots: number;
  notes: string[];
}

interface BytesBudget {
  sum: number;
  contributors: { name: string; bytes: number; basis: BudgetBasis }[];
  excluded: { name: string; bytes: number; reason: "whole_program" }[];
  without_bytes: string[];
}

export interface PlanBudget {
  region: "PAL" | "NTSC" | "both";
  screen: "on" | "off";
  sprites: { per_line: number; lines: number; dma_per_frame: number } | null;
  phases: PhaseBudget[];
  bytes: BytesBudget;
  verdict: BudgetVerdict;
  assumptions: string[];
}

const BLANKED = /\bblank/i;
const SCREEN_ON = /\b(?:screen|display) on\b/i;
const WHOLE_PROGRAM = /\bwhole\s+(?:prg|program)\b/i;

function weakestOf(bases: BudgetBasis[]): BudgetBasis | null {
  let weakest: BudgetBasis | null = null;
  for (const b of bases) {
    if (weakest === null || BASIS_STRENGTH.indexOf(b) > BASIS_STRENGTH.indexOf(weakest)) weakest = b;
  }
  return weakest;
}

/** Raster lines of a band that occur on this machine (NTSC has 263). */
function bandLines(band: string, region: VideoRegion): number | null {
  const parsed = parseRasterBand(band);
  if ("error" in parsed || parsed.kind !== "lines") return null;
  const last = REGION_TIMING[region].lines_per_frame - 1;
  let n = 0;
  for (const [a, b] of parsed.ranges) if (a <= last) n += Math.min(b, last) - a + 1;
  return n;
}

/** A technique that takes a whole raster line on every line it is active: cycles_per_line at or above PAL's 63. */
function holdsWholeLines(cost: BudgetCost | undefined): boolean {
  return (cost?.cycles_per_line ?? 0) >= REGION_TIMING.PAL.cycles_per_line;
}

/**
 * A figure measured wall-clock with the screen on already holds its badline
 * and sprite stalls. Only a measured figure whose conditions say the screen
 * was on counts: one that says nothing is charged, since a ceiling is
 * honest and a guess is not. A band charge is whole lines, stalls and all.
 */
function includesDisplayStalls(c: BudgetContributor): boolean {
  if (c.charge === "band") return true;
  const cond = c.conditions ?? "";
  return c.basis === "measured-vice" && SCREEN_ON.test(cond) && !BLANKED.test(cond);
}

type Charge = { low: number; high: number; charge: BudgetContributor["charge"] } | null;

function chargeOf(m: BudgetMember, region: VideoRegion): Charge {
  const cost = m.cost;
  if (!cost) return null;
  const line = REGION_TIMING[region].cycles_per_line;
  if (holdsWholeLines(cost) && m.raster_band) {
    const lines = bandLines(m.raster_band, region);
    if (lines !== null) return { low: lines * line, high: lines * line, charge: "band" };
  }
  if (cost.cycles_per_frame !== undefined) {
    return {
      low: cost.cycles_per_frame_typical ?? cost.cycles_per_frame,
      high: cost.cycles_per_frame,
      charge: "cycles_per_frame",
    };
  }
  if (cost.cycles_per_line !== undefined && cost.lines_active !== undefined) {
    const perLine = holdsWholeLines(cost) ? line : cost.cycles_per_line;
    return { low: perLine * cost.lines_active, high: perLine * cost.lines_active, charge: "per_line" };
  }
  return null;
}

/** The recipe to measure a missing figure on: the one named after the technique first, else the first implementing one. */
function recipeToMeasure(m: BudgetMember): string | null {
  const recipes = m.recipes ?? [];
  const stem = m.name.replace(/_/g, "-");
  return recipes.find((r) => r.endsWith(`-${stem}`)) ?? recipes.at(0) ?? null;
}

function missingWhy(m: BudgetMember): string {
  if (!m.cost) return "no **Cost:** line";
  return "the Cost line has no cycles_per_frame (nor cycles_per_line with lines_active)";
}

/** Set `name` as absorbed by `by` unless it is not in the set, is `by` itself, or is already absorbed. */
function absorb(
  out: Map<string, BudgetExcluded>,
  names: Set<string>,
  e: { name: string; reason: "included_by" | "inside_band_of"; by: string },
): void {
  if (names.has(e.name) && e.name !== e.by && !out.has(e.name)) out.set(e.name, e);
}

/** A member charged by its raster band: its REQUIRES closure runs inside that band. */
function chargesBand(m: BudgetMember, region: VideoRegion): boolean {
  return holdsWholeLines(m.cost) && m.raster_band !== undefined && bandLines(m.raster_band, region) !== null;
}

/** Members whose work another member's figure already holds: Cost includes, then raster bands. */
function absorbed(members: BudgetMember[], region: VideoRegion): Map<string, BudgetExcluded> {
  const names = new Set(members.map((m) => m.name));
  const out = new Map<string, BudgetExcluded>();
  for (const m of members)
    for (const inc of m.cost?.includes ?? [])
      absorb(out, names, { name: inc, reason: "included_by", by: m.name });
  for (const m of members.filter((x) => chargesBand(x, region)))
    for (const p of m.requires_closure ?? [])
      absorb(out, names, { name: p, reason: "inside_band_of", by: m.name });
  return out;
}

/**
 * `over` needs a low end that is a floor: a worst-frame figure with no
 * typical beside it may be a frame that play never reaches, so while one is
 * in the low end, a low end past the frame leaves the verdict open.
 */
function verdictOf(p: {
  low: number;
  high: number;
  fixed: number;
  frame: number;
  open: boolean;
  worstOnly: boolean;
}): BudgetVerdict {
  if (p.low + p.fixed > p.frame) return p.worstOnly ? "undetermined" : "over";
  if (!p.open && p.high + p.fixed <= p.frame) return "fits";
  return "undetermined";
}

interface PhaseInputs {
  phase: BudgetPhase;
  region: VideoRegion;
  members: BudgetMember[];
  screen: "on" | "off";
  spriteDma: number;
}

function fixedLossesFor(
  contributors: BudgetContributor[],
  screen: "on" | "off",
  spriteDma: number,
): PhaseBudget["fixed_losses"] {
  const needing = contributors.filter((c) => !includesDisplayStalls(c)).map((c) => c.name);
  if (screen === "off" || needing.length === 0) return { badlines: 0, sprite_dma: 0, charged_for: [] };
  return { badlines: BADLINES_PER_FRAME * BADLINE_CYCLES_LOST, sprite_dma: spriteDma, charged_for: needing };
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

function lossNote(p: PhaseBudget, screen: "on" | "off"): string[] {
  const { badlines, sprite_dma, charged_for } = p.fixed_losses;
  if (badlines + sprite_dma > 0) {
    const dma = sprite_dma > 0 ? `, sprite DMA ${sprite_dma}` : "";
    return [
      `Fixed losses ${badlines + sprite_dma} cycles (badlines ${BADLINES_PER_FRAME} × ${BADLINE_CYCLES_LOST} = ${badlines}${dma}; arithmetic) charged because ${charged_for.join(", ")} ${plural(charged_for.length, "is", "are")} not stated as measured with the screen on. It is a ceiling: code that runs in the border meets no badline.`,
    ];
  }
  if (screen === "on" && p.contributors.length > 0)
    return [
      "No fixed losses charged: every figure was measured with the screen on, so its badline and sprite stalls are inside it.",
    ];
  return [];
}

function phaseNotes(p: PhaseBudget, screen: "on" | "off"): string[] {
  const notes = lossNote(p, screen);
  const fixed = p.fixed_losses.badlines + p.fixed_losses.sprite_dma;
  if (p.low + fixed > p.frame && p.worst_only.length > 0)
    notes.push(
      `The low end, ${p.low} + ${fixed}, passes the ${p.frame}-cycle frame, but it holds worst frames with no measured typical frame (${p.worst_only.join(", ")}): those worst frames together overrun, and a measured typical frame would settle whether play does.`,
    );
  if (p.unknown.length > 0)
    notes.push(
      `Unknown is not zero: ${p.unknown.join(", ")} ${plural(p.unknown.length, "has", "have")} no cycles figure, so the verdict cannot be fits.`,
    );
  const multi = p.excluded.filter((e) => e.reason === "multi_frame");
  if (multi.length > 0)
    notes.push(
      `Multi-frame: ${multi.map((e) => `${e.name} (${e.cycles})`).join(", ")} ${plural(multi.length, "is", "are")} above one ${p.region} frame of ${p.frame} and not summed; spread the work over frames or budget it as its own phase.`,
    );
  if (p.phase !== "play")
    notes.push(
      `The ${p.phase} phase is judged against one frame too; a ${p.phase} that takes several frames drops frames, which may be acceptable there.`,
    );
  if (p.region === "NTSC")
    notes.push(
      "Cycles per frame are the pages' figures, most measured on PAL; the same code takes about the same cycles on NTSC, against a 17,095-cycle frame.",
    );
  return notes;
}

interface Sorted {
  contributors: BudgetContributor[];
  excluded: BudgetExcluded[];
  unknown: string[];
  not_found: string[];
  to_measure: BudgetToMeasure[];
  irq_slots: number;
}

/** Put one member where it belongs: summed, left out as multi-frame, unknown, or not found. */
function sortMember(m: BudgetMember, region: VideoRegion, into: Sorted): void {
  if (!m.found) {
    into.not_found.push(m.name);
    return;
  }
  into.irq_slots += m.cost?.irq_slots ?? 0;
  const charge = chargeOf(m, region);
  if (charge === null) {
    into.unknown.push(m.name);
    into.to_measure.push({ technique: m.name, recipe: recipeToMeasure(m), why: missingWhy(m) });
    return;
  }
  const measured_on = m.cost?.measured_on ?? null;
  if (charge.high > REGION_TIMING[region].cycles_per_frame) {
    into.excluded.push({ name: m.name, reason: "multi_frame", cycles: charge.high, measured_on });
    return;
  }
  into.contributors.push({
    name: m.name,
    ...charge,
    basis: m.cost?.basis ?? "estimated",
    measured_on,
    conditions: m.cost?.conditions ?? null,
  });
}

function hasTypical(members: BudgetMember[], name: string): boolean {
  return members.some((m) => m.name === name && m.cost?.cycles_per_frame_typical !== undefined);
}

function budgetPhase(inp: PhaseInputs): PhaseBudget {
  const { phase, region, members, screen, spriteDma } = inp;
  const frame = REGION_TIMING[region].cycles_per_frame;
  const skip = absorbed(members, region);
  const sorted: Sorted = {
    contributors: [],
    excluded: [...skip.values()],
    unknown: [],
    not_found: [],
    to_measure: [],
    irq_slots: 0,
  };
  for (const m of members) if (!skip.has(m.name)) sortMember(m, region, sorted);
  const { contributors, excluded, unknown, not_found, to_measure, irq_slots } = sorted;
  const worst_only = contributors
    .filter((c) => c.charge === "cycles_per_frame" && c.low === c.high && !hasTypical(members, c.name))
    .map((c) => c.name);
  const low = contributors.reduce((s, c) => s + c.low, 0);
  const high = contributors.reduce((s, c) => s + c.high, 0);
  const fixed_losses = fixedLossesFor(contributors, screen, spriteDma);
  const open = unknown.length > 0 || not_found.length > 0 || excluded.some((e) => e.reason === "multi_frame");
  const result: PhaseBudget = {
    phase,
    region,
    frame,
    members: members.map((m) => m.name),
    contributors,
    excluded,
    unknown,
    not_found,
    to_measure,
    fixed_losses,
    low,
    high,
    worst_only,
    verdict: verdictOf({
      low,
      high,
      fixed: fixed_losses.badlines + fixed_losses.sprite_dma,
      frame,
      open,
      worstOnly: worst_only.length > 0,
    }),
    weakest_basis: weakestOf(contributors.map((c) => c.basis)),
    irq_slots,
    notes: [],
  };
  result.notes = phaseNotes(result, screen);
  return result;
}

function bytesOf(members: BudgetMember[]): BytesBudget {
  const out: BytesBudget = { sum: 0, contributors: [], excluded: [], without_bytes: [] };
  const seen = new Set<string>();
  for (const m of members) {
    if (seen.has(m.name) || !m.found) continue;
    seen.add(m.name);
    const c = m.cost;
    if (c?.bytes_code === undefined && c?.bytes_data === undefined) {
      out.without_bytes.push(m.name);
      continue;
    }
    const bytes = (c.bytes_code ?? 0) + (c.bytes_data ?? 0);
    if (c.conditions && WHOLE_PROGRAM.test(c.conditions)) {
      out.excluded.push({ name: m.name, bytes, reason: "whole_program" });
      continue;
    }
    out.sum += bytes;
    out.contributors.push({ name: m.name, bytes, basis: c.basis });
  }
  return out;
}

function regionsFor(members: BudgetMember[], asked: BudgetOptions["region"]): VideoRegion[] {
  if (asked === "both") return ["PAL", "NTSC"];
  if (asked) return [asked];
  const locked = members
    .map((m) => (m.requires_region ?? "").toUpperCase())
    .filter((r) => r === "PAL" || r === "NTSC");
  return [locked.length > 0 && locked.every((r) => r === "NTSC") ? "NTSC" : "PAL"];
}

function overall(phases: PhaseBudget[]): BudgetVerdict {
  if (phases.some((p) => p.verdict === "over")) return "over";
  if (phases.length === 0 || phases.some((p) => p.verdict === "undetermined")) return "undetermined";
  return "fits";
}

function assumptionsFor(
  opts: BudgetOptions,
  regions: VideoRegion[],
  sprites: PlanBudget["sprites"],
): string[] {
  const out = [
    `Region ${regions.join(" and ")}${opts.region ? "" : " (no region asked; NTSC only when every region-locked member is NTSC-locked)"}: ${regions.map((r) => `${r} ${REGION_TIMING[r].cycles_per_frame}`).join(", ")} cycles a frame.`,
    `Screen ${opts.screen ?? "on"}${(opts.screen ?? "on") === "on" ? `: unless every summed figure says it was measured with the screen on, ${BADLINES_PER_FRAME} badlines × ${BADLINE_CYCLES_LOST} cycles are charged` : ": no badline or sprite DMA losses; figures measured with the screen on overstate the work"}.`,
    "Each figure is the technique's own Cost line, measured on the recipe it names: another implementation can cost more or less.",
    "Claims, zero page and memory are not judged here; c64_check_compatibility judges claims and zero page.",
  ];
  if (sprites) {
    out.push(
      `Sprites: ${sprites.per_line} a line on ${sprites.lines} lines, (3 + 2 × ${sprites.per_line}) × ${sprites.lines} = ${sprites.dma_per_frame} cycles of DMA a frame (3 + 2n measured in VICE x64sc for sprites numbered without gaps).`,
    );
  }
  return out;
}

/**
 * Budget a set of techniques, each in a phase, on one region or both. The
 * verdict per phase: `fits` when nothing is unknown, missing or multi-frame
 * and high + fixed losses fit the frame; `over` when low + fixed losses do
 * not and the low end is a floor; otherwise `undetermined`. The overall verdict is the worst phase's.
 */
export function planBudget(members: BudgetMember[], opts: BudgetOptions = {}): PlanBudget {
  const screen = opts.screen ?? "on";
  const regions = regionsFor(members, opts.region);
  const perLine =
    opts.sprites_per_line !== undefined ? Math.max(0, Math.min(8, Math.trunc(opts.sprites_per_line))) : 0;
  const lines =
    opts.sprite_lines !== undefined ? Math.max(0, Math.trunc(opts.sprite_lines)) : DEFAULT_SPRITE_LINES;
  const sprites =
    perLine > 0 ? { per_line: perLine, lines, dma_per_frame: spriteDmaCycles(perLine) * lines } : null;
  const phases: PhaseBudget[] = [];
  for (const phase of BUDGET_PHASES) {
    const inPhase = members.filter((m) => m.phase === phase);
    if (inPhase.length === 0) continue;
    for (const region of regions) {
      phases.push(
        budgetPhase({ phase, region, members: inPhase, screen, spriteDma: sprites?.dma_per_frame ?? 0 }),
      );
    }
  }
  return {
    region: opts.region ?? regions[0] ?? "PAL",
    screen,
    sprites,
    phases,
    bytes: bytesOf(members),
    verdict: overall(phases),
    assumptions: assumptionsFor(opts, regions, sprites),
  };
}
