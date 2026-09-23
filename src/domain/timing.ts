/**
 * VIC-II frame and line timing: the constants every cycle budget in the
 * tools is built from. Pure data and arithmetic, no services.
 */

export type VideoRegion = "PAL" | "NTSC";

export interface RegionTiming {
  cycles_per_line: number;
  lines_per_frame: number;
  cycles_per_frame: number;
}

// PAL 6569: 63 cycles x 312 lines = 19656. NTSC 6567R8: 65 x 263 = 17095.
export const REGION_TIMING: Readonly<Record<VideoRegion, RegionTiming>> = {
  PAL: { cycles_per_line: 63, lines_per_frame: 312, cycles_per_frame: 63 * 312 },
  NTSC: { cycles_per_line: 65, lines_per_frame: 263, cycles_per_frame: 65 * 263 },
};

/** "pal", "NTSC" and so on to a region key; anything else is PAL. */
export function videoRegion(name: string): VideoRegion {
  return name.toUpperCase() === "NTSC" ? "NTSC" : "PAL";
}

// A badline takes the bus for 40 cycles (15-54) and pulls BA low three cycles
// earlier; the CPU can spend those three only on write cycles, so 43 is the
// figure to plan on (20 of 63 left on PAL, 22 of 65 on NTSC).
export const BADLINE_CYCLES_LOST = 43;

// Badlines in a frame with the display on and the default YSCROLL of 3:
// lines 51, 59, ..., 243, one every eighth line, 25 in all
// (docs/hardware/vic-ii-reference.md, "Badlines").
export const BADLINE_ROWS: readonly number[] = Array.from({ length: 25 }, (_, i) => 51 + 8 * i);
export const BADLINES_PER_FRAME = BADLINE_ROWS.length;

// Through the KERNAL vector: 7 cycles of interrupt sequence + 29 for the
// dispatcher at $FF48 before the handler's first instruction. A handler on
// $FFFE with the KERNAL out pays 7 plus its own register saves.
export const DEFAULT_IRQ_OVERHEAD = 36;

// Sprite DMA on a line where n sprites are displayed: BA drops three cycles
// before the first sprite's slot (usable only by write cycles), then two
// bus cycles per sprite; the p-access costs the CPU nothing. Measured in
// VICE x64sc (docs/hardware/vic-ii-reference.md, "Sprite DMA"): 5 for one
// sprite, 19 for eight, and the CPU resumes where 3 + 2n predicts for
// sprites 0..k with k = 0, 2, 3, 6, 7. Sprites numbered with a gap pay the
// three lead-in cycles again per group: sprites 0 and 7 measured 10, not 7.
export const SPRITE_BA_LEAD_IN = 3;
export const SPRITE_CYCLES_EACH = 2;

export function spriteDmaCycles(sprites: number): number {
  return sprites > 0 ? SPRITE_BA_LEAD_IN + SPRITE_CYCLES_EACH * sprites : 0;
}
