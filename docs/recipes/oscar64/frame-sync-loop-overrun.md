---
recipe: frame-sync-loop-overrun
toolchain: oscar64
output_format: PRG
region: pal
techniques: [frame_sync_loop]
file_formats: [PRG]
uses_registers: [D012, D019, D01A, D020, D021]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 raster-synced frame loop, deliberately overrun

## Synopsis

The same raster-synced loop as `frame-sync-loop.md`, with the fixed
workload raised from 8 units to 24 so that it no longer fits in a frame.
It shows what the budget bar, the frame counter and the
dropped-frame counter look like when a loop is losing frames. Only the `WORK_UNITS`
constant differs; the two PRGs are the same size and differ in two bytes.
The technique is `frame_sync_loop` in `techniques/raster.md`.

## Source

```c
// frame-sync-loop-overrun.c
// A raster-synced frame loop with a border-colour budget bar, a frame
// counter and a dropped-frame counter. One raster IRQ at the bottom of the
// display window bumps a tick byte; the main loop waits for the tick to
// change, paints the border while it works, and paints it black when done.
// The white band in the border is the work; where it ends is the budget
// used. The load here is 24 units, which does not fit a frame; the same
// listing with 8 units, which does, is recipes/oscar64/frame-sync-loop.md.
#include <c64/vic.h>
#include <c64/rasterirq.h>

#ifndef WORK_UNITS
#define WORK_UNITS 24               // 8 fits in a frame; 24 does not
#endif

#define SCREEN ((char *)0x0400)     // default text screen
#define COLOUR ((char *)0xd800)     // colour RAM
#define SYNC_ROW 250                // rirq row; the IRQ lands on line 251

// Screen codes for "0".."9" and "A".."F".
static const char hex_glyph[16] = {
    0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37,
    0x38, 0x39, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06
};

RIRQCode frame_irq;

// Written by the IRQ, read by the main loop. One byte, so a read is atomic.
volatile char irq_ticks;

__interrupt void on_frame(void)
{
    irq_ticks++;
}

static char scratch[64];

// The fixed per-frame workload: WORK_UNITS passes over a 64-byte buffer.
static void do_work(void)
{
    for (char n = 0; n < WORK_UNITS; n++)
        for (char i = 0; i < 64; i++)
            scratch[i] += n;
}

static void put_text(char row, const char *s)
{
    char *p = SCREEN + 40 * row;
    while (*s)
    {
        char c = *s++;
        *p++ = (c >= 'a' && c <= 'z') ? c - 'a' + 1 : c;
    }
}

static void put_hex16(char row, char col, unsigned v)
{
    char *p = SCREEN + 40 * row + col;
    p[0] = hex_glyph[(v >> 12) & 15];
    p[1] = hex_glyph[(v >> 8) & 15];
    p[2] = hex_glyph[(v >> 4) & 15];
    p[3] = hex_glyph[v & 15];
}

int main(void)
{
    for (unsigned i = 0; i < 1000; i++)
    {
        SCREEN[i] = 0x20;
        COLOUR[i] = VCOL_WHITE;
    }
    vic.color_back = VCOL_BLACK;
    vic.color_border = VCOL_BLACK;
    put_text(0, "frames  ");
    put_text(1, "dropped ");
    put_text(2, "units   ");
    put_hex16(2, 8, WORK_UNITS);

    // One raster IRQ slot, bottom of the display window, that calls on_frame.
    rirq_init(true);
    rirq_build(&frame_irq, 1);
    rirq_call(&frame_irq, 0, on_frame);
    rirq_set(0, SYNC_ROW, &frame_irq);
    rirq_sort();
    rirq_start();

    unsigned frames = 0;            // loop iterations completed
    unsigned dropped = 0;           // ticks that went by while we were busy
    char seen = irq_ticks;          // the tick value this loop last consumed

    for (;;)
    {
        // Wait for the IRQ to move the tick. A tick that has already moved
        // passes straight through: this is where a late frame is not lost.
        while (irq_ticks == seen)
            ;
        char delta = irq_ticks - seen;
        seen += delta;              // consume every tick we saw
        if (delta > 1)
            dropped += delta - 1;   // each extra tick is a frame we missed
        frames++;

        vic.color_border = VCOL_WHITE;      // budget bar on
        do_work();
        put_hex16(0, 8, frames);
        put_hex16(1, 8, dropped);
        // Cell (0, 3): green while no frame has been dropped, red after.
        SCREEN[120] = 0xa0;
        COLOUR[120] = dropped ? VCOL_RED : VCOL_GREEN;
        vic.color_border = VCOL_BLACK;      // budget bar off
    }
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=frame-sync-loop-overrun.prg frame-sync-loop-overrun.c
```

Built with Oscar64 (build 2026-05-19). The PRG is 987 bytes, the same as
`frame-sync-loop.prg` from the 8-unit listing, and `cmp -l` between the two
reports two differing bytes, the `WORK_UNITS` constant where it is used.

## Expected output

Every figure below was measured in VICE x64sc 3.10 (rung 1) from the exit
screenshot of the pinned run, PAL only:

```
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 \
      -limitcycles 8050000 -exitscreenshot out.png -autostart frame-sync-loop-overrun.prg
```

reading the border colour down PNG column x = 2 (PAL raster line = row + 16)
and decoding the text cells against the `chargen-901225-01.bin` glyphs.

**PAL, pinned at 8,050,000 cycles** (`screenshots/frame-sync-loop-overrun.png`):
the border is white on every visible line except one, line 273, which is
black. That one-line gap is the whole of the loop's idle time: the work runs
past the next line 251, the tick has already moved when the loop reaches its
wait, so the border goes black and white again within a line and the loop
starts the next frame at once. Text reads `FRAMES 0099` (153 loops),
`DROPPED 0064` (100 frames missed), `UNITS 0018`; the cell at row 3 column 0
is red. 153 + 100 = 253 ticks, the frames elapsed, so each loop is taking
1.65 frames on average and the gap walks about two thirds of a frame down
the picture each loop.

The pin is 8,050,000 cycles rather than the 8,000,000 used by the 8-unit
recipe because at 8,000,000 the same build read `FRAMES 0097`,
`DROPPED 0063`, red cell, and the gap lay inside the vertical blank, so the
border was white on every visible line. That picture is also an overrun,
and an all-white border with the red cell is what an overrun usually looks
like; the pin was moved by 50,000 cycles so the gap is in view. No NTSC
shot is pinned for this recipe.

Two other loads were run once each, unpinned, to place the boundary between
the two recipes: `WORK_UNITS = 16` read `FRAMES 00E1`, `DROPPED 0019`, gap
at line 68 (1.11 frames a loop, so it overruns on about one loop in nine);
`WORK_UNITS = 20` read `FRAMES 00B5`, `DROPPED 0045` (1.38 frames a loop).

## Why this works

The loop is the one in `frame-sync-loop.md` and the tick counting is
explained there. This page adds the failure case. The bar is
two stores to `$D020`: one after the wait, one after the work. When the work
outgrows the frame the band has no end: the wait passes at once because the
IRQ has already moved `irq_ticks`, and the only black is the handful of
cycles between the second store of one loop and the first store of the
next, which is the one-line gap in the picture. The gap walks down the
frame because each loop is a non-integer number of frames long.

The dropped counter is what makes the picture readable as a number. Each
loop reads `delta = irq_ticks - seen`; when the work has taken more than a
frame, `delta` is 2 or more and `delta - 1` is added to `dropped`. The
counter therefore says how many frames went by unserved, not how many loops
were slow, and `frames + dropped` is the number of ticks since the program
started. That sum is how the 1.65 frames a loop above was derived.

An overrun in this loop does not halve the frame rate; it runs the game at
the speed of the work. A loop that instead spun on `vic_waitLine(251)` after
the same 1.65 frames of work would wait for the next line 251 every time and
run at exactly two frames a loop (arithmetic; that variant was not run
here). Which of the two to use is a design choice.
