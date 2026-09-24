/**
 * The words c64_plan_budget and the briefing print beside the numbers
 * planBudget (budget.ts) works out: why a loss was charged, why a low end
 * past the frame is not `over`, and what the plan assumed.
 */

import { BADLINE_CYCLES_LOST, BADLINES_PER_FRAME, REGION_TIMING, type VideoRegion } from "./timing.ts";
import type { BudgetContributor, BudgetMember, BudgetOptions, PhaseBudget, SpriteLoad } from "./budget.ts";

const BLANKED = /\bblank/i;
const SCREEN_ON = /\b(?:screen|display) on\b/i;

export function measuredScreenOn(c: BudgetContributor): boolean {
  const cond = c.conditions ?? "";
  return c.charge !== "band" && c.basis === "measured-vice" && SCREEN_ON.test(cond) && !BLANKED.test(cond);
}

export function lockedTo(members: BudgetMember[], region: VideoRegion): string[] {
  return [
    ...new Set(members.filter((m) => (m.requires_region ?? "").toUpperCase() === region).map((m) => m.name)),
  ];
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);
const article = (word: string): string => (/^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`);

function bandNames(p: PhaseBudget): string {
  return p.contributors
    .filter((c) => c.charge === "band")
    .map((c) => c.name)
    .join(", ");
}

/** Why the over test counts less loss than the charge. */
function floorWhy(p: PhaseBudget): string {
  const onScreen = p.contributors.filter(measuredScreenOn).map((c) => c.name);
  if (onScreen.length > 0)
    return `${onScreen.join(", ")} ${plural(onScreen.length, "was", "were")} measured with the screen on and already ${plural(onScreen.length, "holds", "hold")} the stalls that fell inside ${plural(onScreen.length, "it", "them")}, so the charge is too high by that much and the over test counts ${p.fixed_losses.floor}`;
  return `whole-line charges or unstated sprite lines may already hold part of it, so the over test counts ${p.fixed_losses.floor}`;
}

function chargedLossNote(p: PhaseBudget): string {
  const { badlines, sprite_dma, charged_for, badlines_in_bands, floor } = p.fixed_losses;
  const outside = BADLINES_PER_FRAME - badlines_in_bands;
  const inBand =
    badlines_in_bands > 0 ? `; the ${badlines_in_bands} inside ${bandNames(p)}'s band are in its charge` : "";
  const dma = sprite_dma > 0 ? `, sprite DMA ${sprite_dma}` : "";
  const exact =
    floor === badlines + sprite_dma
      ? "A stall takes its cycles wherever the code runs, so the charge is exact: no summed figure already holds a stall."
      : `A stall takes its cycles wherever the code runs, so the charge is exact unless a figure already holds stalls: ${floorWhy(p)}.`;
  return `Fixed losses ${badlines + sprite_dma} cycles (badlines ${outside} × ${BADLINE_CYCLES_LOST} = ${badlines}, lines 51-243 every eighth with YSCROLL 3${inBand}${dma}; arithmetic) charged because ${charged_for.join(", ")} ${plural(charged_for.length, "is", "are")} not stated as measured with the screen on. ${exact}`;
}

function uncharged(p: PhaseBudget): string {
  const bands = p.contributors.some((c) => c.charge === "band");
  const onScreen = p.contributors.some(measuredScreenOn);
  if (p.fixed_losses.charged_for.length > 0)
    return `No badline loss charged: all ${BADLINES_PER_FRAME} badlines fall inside ${bandNames(p)}'s band, whose charge counts whole raster lines, stalls included.`;
  if (bands && onScreen)
    return "No fixed losses charged: every summed figure is a band charge (whole raster lines, stalls included) or was measured with the screen on (its stalls inside it).";
  if (bands)
    return "No fixed losses charged: every summed figure is a band charge, whole raster lines with their stalls included.";
  return "No fixed losses charged: every figure was measured with the screen on, so its badline and sprite stalls are inside it.";
}

function lossNote(p: PhaseBudget, screen: "on" | "off"): string[] {
  const { badlines, sprite_dma } = p.fixed_losses;
  if (badlines + sprite_dma > 0) return [chargedLossNote(p)];
  if (screen === "on" && p.contributors.length > 0) return [uncharged(p)];
  return [];
}

/** The low end is over the frame and the floor is not: say which members make it so. */
function notFloorNote(p: PhaseBudget, fixed: number): string {
  const loose = p.contributors.filter((c) => !c.every_frame).map((c) => c.name);
  const worst =
    p.worst_only.length > 0
      ? ` ${p.worst_only.join(", ")} ${plural(p.worst_only.length, "has", "have")} no typical frame, so ${plural(p.worst_only.length, "its", "their")} low end is a worst frame.`
      : "";
  // "passes the frame" read as "fits it" to the #39 builders (#41); say over, with the sum.
  const sum = p.low + fixed;
  const terms = fixed > 0 ? `${p.low} + ${fixed} = ${sum}` : `${sum}`;
  return `The low end, ${terms}, is over the ${p.frame}-cycle frame by ${sum - p.frame}, but it is not a floor: the figures of ${loose.join(", ")} are a common frame or a real run's worst, and those frames need not fall together.${worst} The floor, work every frame plus the loss no figure can hold, is ${p.floor} and fits. A frame measured whole, with every member running, would settle it.`;
}

export function phaseNotes(p: PhaseBudget, screen: "on" | "off"): string[] {
  const notes = lossNote(p, screen);
  const fixed = p.fixed_losses.badlines + p.fixed_losses.sprite_dma;
  if (p.low + fixed > p.frame && p.floor <= p.frame) notes.push(notFloorNote(p, fixed));
  if (p.unknown.length > 0)
    notes.push(
      `Unknown is not zero: ${p.unknown.join(", ")} ${plural(p.unknown.length, "has", "have")} no cycles figure, so the verdict cannot be fits.`,
    );
  const multi = p.excluded.filter((e) => e.reason === "multi_frame");
  if (multi.length > 0)
    notes.push(
      `Multi-frame: ${multi.map((e) => `${e.name} (${e.cycles})`).join(", ")} ${plural(multi.length, "is", "are")} above the longest frame (PAL, ${REGION_TIMING.PAL.cycles_per_frame}) and not summed on either model; spread the work over frames or budget it as its own phase.`,
    );
  if (p.phase !== "play")
    notes.push(
      `The ${p.phase} phase is judged against one frame too; ${article(p.phase)} that takes several frames drops frames, which may be acceptable there.`,
    );
  if (p.region === "NTSC")
    notes.push(
      "Cycles per frame are the pages' figures, most measured on PAL; the same code takes about the same cycles on NTSC, against a 17,095-cycle frame.",
    );
  return notes;
}

export function assumptionsFor(
  opts: BudgetOptions,
  members: BudgetMember[],
  regions: VideoRegion[],
  sprites: SpriteLoad | null,
): string[] {
  const screenOn = (opts.screen ?? "on") === "on";
  const out = [
    `Region ${regions.join(" and ")}${opts.region ? "" : " (no region asked; NTSC only when every region-locked member is NTSC-locked)"}: ${regions.map((r) => `${r} ${REGION_TIMING[r].cycles_per_frame}`).join(", ")} cycles a frame.`,
    `Screen ${opts.screen ?? "on"}${screenOn ? `: unless every summed figure says it was measured with the screen on, the ${BADLINES_PER_FRAME} badlines × ${BADLINE_CYCLES_LOST} cycles outside any band charge are charged` : ": no badline or sprite DMA losses; figures measured with the screen on overstate the work"}.`,
    "Low end: each member's cycles_per_frame_typical where the page states one (a common frame, or a real run's worst frame), else its worst frame. It is not a floor. Over is judged on the floor: band and per-line charges, which run every frame, plus the badline loss no summed figure can already hold.",
    "Each figure is the technique's own Cost line, measured on the recipe it names: another implementation can cost more or less.",
    "Claims, zero page and memory are not judged here; c64_check_compatibility judges claims and zero page.",
  ];
  const pal = lockedTo(members, "PAL");
  const ntsc = lockedTo(members, "NTSC");
  if (pal.length > 0 && ntsc.length > 0)
    out.push(
      `Mixed regions: ${pal.join(", ")} ${plural(pal.length, "is", "are")} PAL-locked and ${ntsc.join(", ")} ${plural(ntsc.length, "is", "are")} NTSC-locked, so no one machine runs the set as its pages build it.`,
    );
  if (sprites) {
    out.push(
      `Sprites: ${sprites.per_line} a line on ${sprites.lines} lines${sprites.lines_stated ? "" : " (not stated: the whole display, a ceiling, and none of it in the floor)"}, (3 + 2 × ${sprites.per_line}) × ${sprites.lines} = ${sprites.dma_per_frame} cycles of DMA a frame (3 + 2n measured in VICE x64sc for sprites numbered without gaps).`,
    );
  }
  return out;
}
