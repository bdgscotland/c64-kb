/**
 * Frame numbering from VIC-II raster line 0 cycle 0, not from a trace's
 * start clock. `analyseIrqChain` and `analyseRegion` used to number frame N
 * as `floor((clock - startClock) / cycles_per_frame)`: frame 0 began the
 * instant the trace started, wherever the raster happened to be. A program
 * almost never starts on line 0, so that boundary falls mid-frame; two
 * entries in the same real frame, one before the boundary and one after,
 * were reported as frames 0 and 1 (measured on Commando's five-IRQ chain:
 * entry lines rotated '178,213,222,30,50' when numbered this way, splitting
 * one raster frame's chain across two frame numbers).
 *
 * The fix needs one known (clock, line, cycle) triple to anchor frame 0: the
 * clock of that hit's own line 0 cycle 0 is `clock - (line * cycles_per_line
 * + cycle)`, and every other clock is numbered from there. `findFrameRef`
 * picks that triple as the first hit at or after the start clock whose line
 * and cycle were both logged; VICE marks an unlogged one -1, and such a hit
 * is never picked. A trace with none (every checkpoint fired off-raster)
 * has no anchor; the caller falls back to the start clock itself, which
 * reproduces the old numbering, and records why in `unknowns`.
 */
import type { RegionTiming } from "../domain/timing.ts";
import type { Hit } from "./monlog.ts";

export interface FrameRef {
  clock: number;
  line: number;
  cycle: number;
}

/** The frame number of `clock`, counting the reference hit's own frame as 0. */
export function frameOf(clock: number, ref: FrameRef, timing: RegionTiming): number {
  const frameZeroClock = ref.clock - (ref.line * timing.cycles_per_line + ref.cycle);
  return Math.floor((clock - frameZeroClock) / timing.cycles_per_frame);
}

/**
 * The first hit at or after `startClock` with a known line and cycle: the
 * anchor `frameOf` needs. A hit logged -1 for either (VICE's mark for "not
 * on a raster line") is skipped, never picked. Null when no hit qualifies.
 */
export function findFrameRef(hits: Iterable<Hit>, startClock: number): FrameRef | null {
  for (const h of hits) {
    if (h.clock < startClock || h.line === -1 || h.cycle === -1) continue;
    return { clock: h.clock, line: h.line, cycle: h.cycle };
  }
  return null;
}
