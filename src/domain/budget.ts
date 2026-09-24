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
 * - The low end is not a floor. A typical figure may be a common frame or
 *   a real run's worst frame (CONVENTIONS-techniques.md allows both), and
 *   such frames of different members need not fall together. `over` is
 *   judged on the floor alone: band and per-line charges, which run every
 *   frame, plus the badline loss no summed figure can already hold.
 * - Work counted in one figure is not counted again: `**Cost includes:**`
 *   (transitive, and never from a member left out as multi-frame) drops the
 *   included members, and a technique that holds the CPU on every line of a
 *   stated raster band is charged band lines × line length, with its
 *   REQUIRES closure inside that band not added.
 * - Phases (play, transition, init) are budgeted alone.
 * - With the screen on, unless every summed figure says it was measured
 *   with the screen on, the badlines outside any band charge and any stated
 *   sprite DMA are charged as fixed losses. A stall takes its cycles
 *   wherever the code runs, so the charge is exact when no summed figure
 *   already holds stalls and too high by what a screen-on figure holds.
 * - Bytes flagged as a whole program (`(whole PRG)` in the measured-on
 *   conditions) are not summed; they count the runtime once per technique.
 */

import { parseRasterBand } from "../graph/extract/raster-band.ts";
import {
  BADLINE_CYCLES_LOST,
  BADLINE_ROWS,
  BADLINES_PER_FRAME,
  REGION_TIMING,
  spriteDmaCycles,
  type VideoRegion,
} from "./timing.ts";
import { assumptionsFor, lockedTo, measuredScreenOn, phaseNotes } from "./budget-notes.ts";
import type { CallCount } from "./calls.ts";

export const BUDGET_PHASES = ["play", "transition", "init"] as const;
export type BudgetPhase = (typeof BUDGET_PHASES)[number];
export type BudgetBasis = "measured-vice" | "derived-listing" | "arithmetic" | "estimated";
type BudgetVerdict = "fits" | "over" | "undetermined";

// Strongest first; the weakest basis in a sum is named beside it.
const BASIS_STRENGTH: readonly BudgetBasis[] = [
  "measured-vice",
  "derived-listing",
  "arithmetic",
  "estimated",
];

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
  /** The cycle figures' basis, and the byte figures' too when bytes_basis is absent. */
  basis: BudgetBasis;
  /** **Cost bytes basis:** (#72): the byte figures' own basis. */
  bytes_basis?: BudgetBasis | undefined;
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
  /**
   * Calls per frame (#37): a Cost figure is one call, so a cycles_per_frame
   * charge is multiplied, low by calls.low and high by calls.high. Absent is
   * one call. A band or per-line charge is lines, not calls, and is not
   * multiplied.
   */
  calls?: CallCount | undefined;
}

export interface BudgetOptions {
  region?: "PAL" | "NTSC" | "both" | undefined;
  screen?: "on" | "off" | undefined;
  sprites_per_line?: number | undefined;
  sprite_lines?: number | undefined;
}

export interface BudgetContributor {
  name: string;
  low: number;
  high: number;
  /** True when the figure is work done every frame (a band or per-line charge): part of the floor. */
  every_frame: boolean;
  basis: BudgetBasis;
  /** How the figure was charged: the Cost line's cycles_per_frame, per-line × lines, or a raster band. */
  charge: "cycles_per_frame" | "per_line" | "band";
  /** The calls low and high are multiplied by, when the member states more than one (#37). */
  calls?: CallCount | undefined;
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
  fixed_losses: FixedLosses;
  /** Summed members whose low end is a worst frame: no typical figure is measured. */
  worst_only: string[];
  low: number;
  high: number;
  /** Every-frame charges plus fixed_losses.floor: the only sum `over` is judged on. */
  floor: number;
  verdict: BudgetVerdict;
  weakest_basis: BudgetBasis | null;
  irq_slots: number;
  notes: string[];
}

interface FixedLosses {
  /** Badlines outside every band charge × 43: the charge beside the high end. */
  badlines: number;
  sprite_dma: number;
  charged_for: string[];
  /** Badlines inside a band contributor's lines: in its charge, not charged again. */
  badlines_in_bands: number;
  /** The part of the charge no summed figure can already hold: what `over` counts. */
  floor: number;
}

interface BytesBudget {
  sum: number;
  contributors: { name: string; bytes: number; basis: BudgetBasis }[];
  excluded: { name: string; bytes: number; reason: "whole_program" }[];
  /** Members whose work, and so code, is inside another member's figure that states bytes. */
  inside: { name: string; by: string }[];
  without_bytes: string[];
  /** The weakest byte basis among the contributors, beside the sum (#72). */
  weakest_basis: BudgetBasis | null;
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

const WHOLE_PROGRAM = /\bwhole\s+(?:prg|program)\b/i;

function weakestOf(bases: BudgetBasis[]): BudgetBasis | null {
  let weakest: BudgetBasis | null = null;
  for (const b of bases) {
    if (weakest === null || BASIS_STRENGTH.indexOf(b) > BASIS_STRENGTH.indexOf(weakest)) weakest = b;
  }
  return weakest;
}

/** The line ranges of a band that occur on this machine (NTSC has 263 lines), or null for none. */
function bandRanges(band: string, region: VideoRegion): [number, number][] | null {
  const parsed = parseRasterBand(band);
  if ("error" in parsed || parsed.kind !== "lines") return null;
  const last = REGION_TIMING[region].lines_per_frame - 1;
  return parsed.ranges.filter(([a]) => a <= last).map(([a, b]): [number, number] => [a, Math.min(b, last)]);
}

/** Raster lines of a band that occur on this machine. */
function bandLines(band: string, region: VideoRegion): number | null {
  const ranges = bandRanges(band, region);
  return ranges === null ? null : ranges.reduce((n, [a, b]) => n + b - a + 1, 0);
}

/** A technique that takes a whole raster line on every line it is active: cycles_per_line at or above PAL's 63. */
function holdsWholeLines(cost: BudgetCost | undefined): boolean {
  return (cost?.cycles_per_line ?? 0) >= REGION_TIMING.PAL.cycles_per_line;
}

/**
 * A figure measured wall-clock with the screen on already holds the
 * badline and sprite stalls that fell inside it. Only a measured figure
 * whose conditions say the screen was on counts: one that says nothing is
 * charged. A band charge is whole lines, stalls and all.
 */
// A figure of zero cycles holds no work for a badline to stretch (#35: ram_under_kernal).
function includesDisplayStalls(c: BudgetContributor): boolean {
  if (c.charge === "band" || c.high === 0) return true;
  return measuredScreenOn(c);
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
/**
 * A technique's recipes, the one that realises it most directly first: the
 * recipe named after it, then the one sharing most words with its name,
 * then alphabetical. technique_lookup lists them in this order and
 * plan_budget's "measure it on" takes the first, so the two name the same
 * recipe. An earlier version took the alphabetical first, and
 * joystick_edge_detect was to be measured on oscar64-attract-replay while
 * its card led with oscar64-joystick-input (#41).
 */
export function rankRecipesFor(technique: string, recipes: readonly string[]): string[] {
  const stem = technique.replace(/_/g, "-");
  const words = new Set(technique.split("_"));
  const shared = (r: string) => r.split("-").filter((w) => words.has(w)).length;
  const exact = (r: string) => (r.endsWith(`-${stem}`) ? 1 : 0);
  return [...recipes].sort((a, b) => exact(b) - exact(a) || shared(b) - shared(a) || a.localeCompare(b));
}

function recipeToMeasure(m: BudgetMember): string | null {
  return rankRecipesFor(m.name, m.recipes ?? []).at(0) ?? null;
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

/** Everything `start` includes, followed through `includesOf`; a cycle stops where it closes. */
export function followIncludes(start: string, includesOf: (name: string) => readonly string[]): string[] {
  const seen = new Set<string>([start]);
  const out: string[] = [];
  const queue = [...includesOf(start)];
  for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
    queue.push(...includesOf(name));
  }
  return out;
}

/**
 * Members whose work another member's figure already holds: Cost includes,
 * then raster bands. A member left out as multi-frame holds nothing in this
 * frame, and a member already absorbed absorbs nothing, so two pages that
 * include each other keep the first one listed.
 */
function absorbed(members: BudgetMember[], region: VideoRegion): Map<string, BudgetExcluded> {
  const names = new Set(members.map((m) => m.name));
  const byName = new Map(members.map((m) => [m.name, m]));
  const frame = REGION_TIMING[region].cycles_per_frame;
  const multi = new Set(members.filter((m) => (chargeOf(m, region)?.high ?? 0) > frame).map((m) => m.name));
  const out = new Map<string, BudgetExcluded>();
  const holds = (m: BudgetMember): boolean => !multi.has(m.name) && !out.has(m.name);
  for (const m of members) {
    if (!holds(m)) continue;
    for (const inc of followIncludes(m.name, (n) => byName.get(n)?.cost?.includes ?? []))
      absorb(out, names, { name: inc, reason: "included_by", by: m.name });
  }
  for (const m of members.filter((x) => chargesBand(x, region))) {
    if (!holds(m)) continue;
    for (const p of m.requires_closure ?? [])
      absorb(out, names, { name: p, reason: "inside_band_of", by: m.name });
  }
  return out;
}

/**
 * `over` is judged on the floor alone: work that runs every frame plus the
 * losses no figure can already hold. The low end is not a floor (see the
 * header), so a low end past the frame with the floor inside it is open.
 */
function verdictOf(p: {
  floor: number;
  high: number;
  fixed: number;
  frame: number;
  open: boolean;
}): BudgetVerdict {
  if (p.floor > p.frame) return "over";
  if (!p.open && p.high + p.fixed <= p.frame) return "fits";
  return "undetermined";
}

export interface SpriteLoad {
  per_line: number;
  lines: number;
  dma_per_frame: number;
  /** False when the caller gave no sprite_lines and the 200-line ceiling stands in. */
  lines_stated: boolean;
}

interface PhaseInputs {
  phase: BudgetPhase;
  region: VideoRegion;
  members: BudgetMember[];
  screen: "on" | "off";
  sprites: SpriteLoad | null;
}

const NO_LOSSES: FixedLosses = {
  badlines: 0,
  sprite_dma: 0,
  charged_for: [],
  badlines_in_bands: 0,
  floor: 0,
};

/** Lines a set of whole-line per-line charges holds; their lines may carry badlines and sprite DMA. */
function wholePerLineLines(contributors: BudgetContributor[], byName: Map<string, BudgetMember>): number {
  let n = 0;
  for (const c of contributors) {
    const cost = byName.get(c.name)?.cost;
    if (c.charge === "per_line" && holdsWholeLines(cost)) n += cost?.lines_active ?? 0;
  }
  return n;
}

function fixedLossesFor(
  contributors: BudgetContributor[],
  inp: PhaseInputs,
  byName: Map<string, BudgetMember>,
): FixedLosses {
  const bands: [number, number][] = [];
  let bandLineCount = 0;
  for (const c of contributors.filter((x) => x.charge === "band")) {
    const ranges = bandRanges(byName.get(c.name)?.raster_band ?? "", inp.region) ?? [];
    bands.push(...ranges);
    bandLineCount += ranges.reduce((n, [a, b]) => n + b - a + 1, 0);
  }
  const inBands = BADLINE_ROWS.filter((l) => bands.some(([a, b]) => l >= a && l <= b)).length;
  const needing = contributors.filter((c) => !includesDisplayStalls(c)).map((c) => c.name);
  if (inp.screen === "off") return NO_LOSSES;
  if (needing.length === 0) return { ...NO_LOSSES, badlines_in_bands: inBands };
  const outside = BADLINES_PER_FRAME - inBands;
  const sprites = inp.sprites;
  // The floor: nothing when a summed figure measured with the screen on may
  // already hold the stalls; else the badlines no whole-line charge can
  // hold, and sprite DMA only on stated lines outside those charges.
  const wholeLines = wholePerLineLines(contributors, byName);
  const heldSomewhere = contributors.some(measuredScreenOn);
  const floorBadlines = heldSomewhere ? 0 : Math.max(0, outside - wholeLines) * BADLINE_CYCLES_LOST;
  const floorSprites =
    heldSomewhere || !sprites?.lines_stated
      ? 0
      : spriteDmaCycles(sprites.per_line) * Math.max(0, sprites.lines - bandLineCount - wholeLines);
  return {
    badlines: outside * BADLINE_CYCLES_LOST,
    sprite_dma: sprites?.dma_per_frame ?? 0,
    charged_for: needing,
    badlines_in_bands: inBands,
    floor: floorBadlines + floorSprites,
  };
}

interface Sorted {
  contributors: BudgetContributor[];
  excluded: BudgetExcluded[];
  unknown: string[];
  not_found: string[];
  to_measure: BudgetToMeasure[];
  irq_slots: number;
}

/**
 * A figure above this is multi-frame work on every model: the longest frame,
 * PAL's 19,656. One threshold for both, so a member is summed or left out
 * the same way on PAL and NTSC; a figure between the two frames is summed
 * on NTSC and shows as over that frame. An earlier version used each
 * region's own frame, and cave_scan_engine's 18,559 was summed on PAL and
 * silently left out on NTSC (#41).
 */
const MULTI_FRAME_ABOVE = Math.max(...Object.values(REGION_TIMING).map((t) => t.cycles_per_frame));

/** A call count other than exactly one, or undefined. */
function multiCalls(calls: CallCount | undefined): CallCount | undefined {
  return calls && (calls.low !== 1 || calls.high !== 1) ? calls : undefined;
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
  if (charge.high > MULTI_FRAME_ABOVE) {
    into.excluded.push({ name: m.name, reason: "multi_frame", cycles: charge.high, measured_on });
    return;
  }
  // The multi-frame test above is on one call; the sum takes every call.
  const calls = charge.charge === "cycles_per_frame" ? multiCalls(m.calls) : undefined;
  into.contributors.push({
    name: m.name,
    ...charge,
    ...(calls ? { low: charge.low * calls.low, high: charge.high * calls.high, calls } : {}),
    every_frame: charge.charge !== "cycles_per_frame",
    basis: m.cost?.basis ?? "estimated",
    measured_on,
    conditions: m.cost?.conditions ?? null,
  });
}

function budgetPhase(inp: PhaseInputs): PhaseBudget {
  const { phase, region, members, screen } = inp;
  const frame = REGION_TIMING[region].cycles_per_frame;
  const byName = new Map(members.map((m) => [m.name, m]));
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
    .filter(
      (c) =>
        c.charge === "cycles_per_frame" &&
        c.high > 0 &&
        byName.get(c.name)?.cost?.cycles_per_frame_typical === undefined,
    )
    .map((c) => c.name);
  const low = contributors.reduce((s, c) => s + c.low, 0);
  const high = contributors.reduce((s, c) => s + c.high, 0);
  const fixed_losses = fixedLossesFor(contributors, inp, byName);
  const floor = contributors.filter((c) => c.every_frame).reduce((s, c) => s + c.low, 0) + fixed_losses.floor;
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
    floor,
    worst_only,
    verdict: verdictOf({ floor, high, fixed: fixed_losses.badlines + fixed_losses.sprite_dma, frame, open }),
    weakest_basis: weakestOf(contributors.map((c) => c.basis)),
    irq_slots,
    notes: [],
  };
  result.notes = phaseNotes(result, screen);
  return result;
}

/** Members absorbed in every phase they are budgeted in, with the member that holds them. */
function heldEverywhere(phases: PhaseBudget[]): Map<string, string> {
  const held = new Map<string, string>();
  const free = new Set<string>();
  for (const p of phases) {
    const inside = new Map(
      p.excluded.filter((e) => e.reason !== "multi_frame" && e.by).map((e) => [e.name, e.by ?? ""]),
    );
    for (const name of p.members) {
      const by = inside.get(name);
      if (by === undefined) free.add(name);
      else if (!held.has(name)) held.set(name, by);
    }
  }
  for (const name of free) held.delete(name);
  return held;
}

/** The byte figures' basis: their own line where the page states one (#72), else the Cost basis. */
function bytesBasisOf(c: BudgetCost): BudgetBasis {
  return c.bytes_basis ?? c.basis;
}

function hasBytes(c: BudgetCost | undefined): c is BudgetCost {
  return c?.bytes_code !== undefined || c?.bytes_data !== undefined;
}

/**
 * Bytes over the members, once each. A member whose work is inside another
 * member's figure is inside its code too when that member states bytes
 * measured on its recipe; it is listed, not summed, and does not make the
 * sum a floor.
 */
function bytesOf(members: BudgetMember[], held: Map<string, string>): BytesBudget {
  const out: BytesBudget = {
    sum: 0,
    contributors: [],
    excluded: [],
    inside: [],
    without_bytes: [],
    weakest_basis: null,
  };
  const byName = new Map(members.map((m) => [m.name, m]));
  const seen = new Set<string>();
  for (const m of members) {
    if (seen.has(m.name) || !m.found) continue;
    seen.add(m.name);
    const by = held.get(m.name);
    const holder = by === undefined ? undefined : byName.get(by)?.cost;
    if (by !== undefined && hasBytes(holder) && !WHOLE_PROGRAM.test(holder.conditions ?? "")) {
      out.inside.push({ name: m.name, by });
      continue;
    }
    const c = m.cost;
    if (!hasBytes(c)) {
      out.without_bytes.push(m.name);
      continue;
    }
    const bytes = (c.bytes_code ?? 0) + (c.bytes_data ?? 0);
    if (c.conditions && WHOLE_PROGRAM.test(c.conditions)) {
      out.excluded.push({ name: m.name, bytes, reason: "whole_program" });
      continue;
    }
    out.sum += bytes;
    out.contributors.push({ name: m.name, bytes, basis: bytesBasisOf(c) });
  }
  out.weakest_basis = weakestOf(out.contributors.map((c) => c.basis));
  return out;
}

function regionsFor(members: BudgetMember[], asked: BudgetOptions["region"]): VideoRegion[] {
  if (asked === "both") return ["PAL", "NTSC"];
  if (asked) return [asked];
  const pal = lockedTo(members, "PAL");
  const ntsc = lockedTo(members, "NTSC");
  return [ntsc.length > 0 && pal.length === 0 ? "NTSC" : "PAL"];
}

function overall(phases: PhaseBudget[]): BudgetVerdict {
  if (phases.some((p) => p.verdict === "over")) return "over";
  if (phases.length === 0 || phases.some((p) => p.verdict === "undetermined")) return "undetermined";
  return "fits";
}

function spriteLoad(opts: BudgetOptions): SpriteLoad | null {
  const perLine =
    opts.sprites_per_line !== undefined ? Math.max(0, Math.min(8, Math.trunc(opts.sprites_per_line))) : 0;
  if (perLine === 0) return null;
  const stated = opts.sprite_lines !== undefined;
  const lines = stated ? Math.max(0, Math.trunc(opts.sprite_lines ?? 0)) : DEFAULT_SPRITE_LINES;
  return { per_line: perLine, lines, dma_per_frame: spriteDmaCycles(perLine) * lines, lines_stated: stated };
}

/**
 * Budget a set of techniques, each in a phase, on one region or both. The
 * verdict per phase: `fits` when nothing is unknown, missing or multi-frame
 * and high + fixed losses fit the frame; `over` when the floor (every-frame
 * charges plus the loss no figure can hold) does not; otherwise
 * `undetermined`. The overall verdict is the worst phase's.
 */
export function planBudget(members: BudgetMember[], opts: BudgetOptions = {}): PlanBudget {
  const screen = opts.screen ?? "on";
  const regions = regionsFor(members, opts.region);
  const sprites = spriteLoad(opts);
  const phases: PhaseBudget[] = [];
  for (const phase of BUDGET_PHASES) {
    const inPhase = members.filter((m) => m.phase === phase);
    if (inPhase.length === 0) continue;
    for (const region of regions)
      phases.push(budgetPhase({ phase, region, members: inPhase, screen, sprites }));
  }
  return {
    region: opts.region ?? regions[0] ?? "PAL",
    screen,
    sprites: sprites
      ? { per_line: sprites.per_line, lines: sprites.lines, dma_per_frame: sprites.dma_per_frame }
      : null,
    phases,
    bytes: bytesOf(members, heldEverywhere(phases)),
    verdict: overall(phases),
    assumptions: assumptionsFor(opts, members, regions, sprites),
  };
}
