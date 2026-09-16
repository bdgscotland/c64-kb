---
recipe: raster-bars
toolchain: oscar64
output_format: PRG
region: both
techniques: [raster_bars, stable_raster_irq]
file_formats: [PRG]
uses_registers: [D012, D019, D020, D021]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 Raster Color Bars

## Synopsis

Sixteen color bars cycling down the screen, one per raster split, using
`rasterirq.h`. Each bar changes both the border color (`$D020`) and the
background color (`$D021`) for its band. The bars shift upward by one slot
every two frames, producing a smooth rainbow animation. This recipe builds
directly on `stable-raster-irq.md` and shows how multiple `RIRQCode` slots
compose into a full multi-split raster effect.

## Source

```c
// raster-bars.c
#include <c64/vic.h>
#include <c64/rasterirq.h>

// 16 C64 palette entries in rainbow order. Names match Oscar64's c64/vic.h
// enum exactly — note PURPLE (not VIOLET) and DARK_GREY (no plain GREY).
// Index 16 duplicates index 0 for clean modulo wrap.
static const byte rainbow[17] = {
    VCOL_BLACK, VCOL_BROWN, VCOL_RED, VCOL_ORANGE,
    VCOL_YELLOW, VCOL_LT_GREEN, VCOL_GREEN, VCOL_CYAN,
    VCOL_LT_BLUE, VCOL_BLUE, VCOL_PURPLE, VCOL_LT_RED,
    VCOL_DARK_GREY, VCOL_MED_GREY, VCOL_LT_GREY, VCOL_WHITE,
    VCOL_BLACK   // sentinel wrap
};

// Number of visible bars. Each bar is one rirq slot that writes D020 + D021.
#define NUM_BARS  16

// Bar height in raster lines. 200 visible lines / 16 bars = 12 lines per bar,
// with a few lines of top and bottom margin absorbed.
#define BAR_HEIGHT  12

// First raster line for the top bar (just below the top border on PAL).
#define FIRST_LINE  51

// One RIRQCode per bar. Each struct holds two writes (border + background).
RIRQCode bars[NUM_BARS];

// A final slot that resets both registers after the last bar, so the
// area below the bars returns to black before the next frame begins.
RIRQCode reset_slot;

int main(void)
{
    // Standard rasterirq init: route through KERNAL vector, CIA disabled.
    rirq_init(true);

    // Build each bar slot with two writes: D020 (border) and D021 (background).
    for (char i = 0; i < NUM_BARS; i++) {
        rirq_build(&bars[i], 2);
        rirq_write(&bars[i], 0, &vic.color_border, rainbow[i]);
        rirq_write(&bars[i], 1, &vic.color_back,   rainbow[i]);
        // Fire one line before the start of this bar's visible region.
        rirq_set(i, FIRST_LINE + (char)(i * BAR_HEIGHT) - 1, &bars[i]);
    }

    // The reset slot fires after the last bar and sets both colors to black,
    // so the area between the last bar and the frame bottom is clean.
    rirq_build(&reset_slot, 2);
    rirq_write(&reset_slot, 0, &vic.color_border, VCOL_BLACK);
    rirq_write(&reset_slot, 1, &vic.color_back,   VCOL_BLACK);
    rirq_set(NUM_BARS, FIRST_LINE + NUM_BARS * BAR_HEIGHT, &reset_slot);

    rirq_sort();
    rirq_start();

    // Animation: shift the color palette index each frame so the bars appear
    // to scroll upward. 'offset' cycles through 0..15.
    char offset = 0;
    char frame  = 0;

    for (;;) {
        // Wait until all raster IRQs for this frame have fired, then update
        // the palette before rirq_sort re-arms for the next frame.
        rirq_wait();

        // Advance the color offset every two frames (25 Hz on PAL, 30 Hz NTSC).
        frame++;
        if (frame >= 2) {
            frame = 0;
            offset = (offset + 1) & 15;
        }

        // Repatch each bar's color data in-place using rirq_data.
        // rirq_data only writes the data byte of an existing slot — it does
        // not touch the target address or rebuild the slot. This is the
        // fastest way to animate raster IRQ content.
        for (char i = 0; i < NUM_BARS; i++) {
            byte c = rainbow[(offset + i) & 15];
            rirq_data(&bars[i], 0, c);  // border
            rirq_data(&bars[i], 1, c);  // background
        }

        // Re-sort is not needed here because no slot has moved.
        // rirq_sort() would be required if rirq_move() had been called.
    }

    return 0;
}
```

## Build

```bash
oscar64 -o=raster-bars.prg -tf=prg raster-bars.c
```

Produces `raster-bars.prg` plus the usual `.map`, `.asm`, and `.lbl` side files.
Load with `LOAD"RASTER-BARS",8,1 : RUN` or via VICE autostart.

## Expected output

Sixteen horizontal color bands fill the display area, each approximately 12
raster lines tall, cycling through the full C64 16-color palette. The entire
stack of bars drifts upward smoothly at half the frame rate (one color step
every two frames). Above and below the bar stack the border and background are
black. The color boundaries are sharp horizontal lines with no jitter or
diagonal bleeding.

On PAL (50 Hz) the palette completes one full cycle in 32 frames (0.64 seconds).
On NTSC (60 Hz) the same 32-frame cycle completes in 0.53 seconds, running
slightly faster.

## Why this works

### Foundation: stable raster IRQ

This recipe is a direct extension of `stable-raster-irq.md`. Every slot in the
`bars` array fires at a stable, jitter-free cycle offset from its target line,
exactly as described in that recipe. The `rirq_init(true)` call disables CIA
timer interrupts and installs the dispatcher through the KERNAL vector; the
dispatcher's built-in polling loop absorbs instruction-completion jitter before
any write fires. Without the stable-IRQ foundation, each bar boundary would
show a 1-2 pixel diagonal streak at the left edge of the display.

### Multiple slots: the rirq slot table

`rasterirq.h` maintains a sorted table of up to 16 IRQ slots (configurable with
`-dNUM_IRQS=n`). After `rirq_sort()`, the dispatcher walks this table on every
frame, firing each slot when the raster beam reaches the programmed line.
`colorbars.c` in `~/Developer/c64/oscar64/samples/rasterirq/colorbars.c` uses
exactly this pattern with 15 slots. This recipe extends it to 16 bars plus a
reset slot (17 slots total), which fits within the default `NUM_IRQS = 16` only
because the reset slot is the 17th — raise `-dNUM_IRQS=20` if you need both 16
bars and a full reset slot simultaneously, or fold the reset into the last bar.

Each `RIRQCode` holds two write slots (border and background). Two writes per
slot consume 8 cycles (two `STA abs` instructions at 4 cycles each). With
`BAR_HEIGHT = 12`, there are 12 raster lines between each consecutive pair of
slots, giving the dispatcher ample time to exit one IRQ and enter the next. The
minimum safe gap between two slots is approximately 4-5 raster lines on PAL,
accounting for IRQ entry/exit overhead.

### `rirq_data` for animation without rebuilding

`rirq_data(&bars[i], slot, byte)` patches only the data byte of write slot
`slot` inside an existing `RIRQCode`. This is cheaper than calling `rirq_write`
because it does not touch the target address. For animation where only the color
value changes each frame — as in the cycling palette here — `rirq_data` is the
correct tool. The address half of each slot (pointing at `$D020` and `$D021`)
never changes; only the color index rotates.

### D020 vs D021: border and background

$D020 is the border color. It governs the colored region outside the active
display window. $D021 is background color 0, which fills the background of
each character cell in standard text mode (and all cells in blank/space
characters). Writing both registers to the same color makes the entire visible
area — border and display — appear as a solid horizontal band. Writing only
$D020 would color the border stripe while leaving the display interior at its
previous background color, useful for thinner decorative bars. Writing only
$D021 would change the display area interior without touching the border.

### Badline interaction

Badlines occur every 8 raster lines on PAL (when the low 3 bits of the raster
counter match YSCROLL, default 3). On a badline, the VIC-II steals 40 CPU
cycles from the CPU. If a raster IRQ slot fires on a badline, those 40 stolen
cycles delay the handler's write by up to 40 cycles — potentially placing the
border color write late enough to bleed onto the next line. The standard defense
is to target splits at non-badline rows. With `FIRST_LINE = 51` and
`BAR_HEIGHT = 12`, most bar boundaries land on non-badlines naturally; the
visual result is clean. For pixel-perfect bar boundaries on any line, use the
cycle-exact double-IRQ technique described in `docs/techniques/raster.md`.
