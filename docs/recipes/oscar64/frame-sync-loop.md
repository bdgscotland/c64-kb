---
recipe: frame-sync-loop
toolchain: oscar64
output_format: PRG
region: both
techniques: [frame_sync_loop]
file_formats: [PRG]
uses_registers: [D012, D019, D01A, D020, D021]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 raster-synced frame loop with a budget bar

## Synopsis

A main loop that runs once per frame, locked to the raster by one interrupt
at the bottom of the display window, with the three instruments every C64
game loop should carry: a border-colour budget bar (white while the loop is
working, black while it waits), a frame counter and a dropped-frame counter.
The workload is fixed at 8 units, which fits in a frame;
`frame-sync-loop-overrun.md` is the same listing at 24 units, which does
not, and shows what the three instruments look like while frames are being
lost. Use this one as the skeleton of a game loop, or as the instrument you
drop a suspect routine into to see how much of the frame it eats. The
technique is `frame_sync_loop` in `techniques/raster.md`.

## Source

```c
// frame-sync-loop.c
// A raster-synced frame loop with a border-colour budget bar, a frame
// counter and a dropped-frame counter. One raster IRQ at the bottom of the
// display window bumps a tick byte; the main loop waits for the tick to
// change, paints the border while it works, and paints it black when done.
// The white band in the border is the work; where it ends is the budget
// used. The load here is 8 units, which fits a frame; the same listing with
// 24 units, which does not, is recipes/oscar64/frame-sync-loop-overrun.md.
#include <c64/vic.h>
#include <c64/rasterirq.h>

#ifndef WORK_UNITS
#define WORK_UNITS 8                // 8 fits in a frame; 24 does not
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
oscar64 -tm=c64 -O2 -o=frame-sync-loop.prg frame-sync-loop.c
```

Built with Oscar64 (build 2026-05-19); the PRG is 987 bytes. The overrun
variant is its own recipe, `frame-sync-loop-overrun.md`, with its own
listing and build; the two PRGs differ in two bytes (`cmp -l`), the
`WORK_UNITS` constant where it is used.

## Expected output

Black screen, white text in rows 0 to 2 (`FRAMES`, `DROPPED`, `UNITS`, each
followed by a four-digit hex value), a solid cell at row 3 column 0 that is
green until a frame is dropped and red afterwards, and a white band in the
border that begins just below the display window and ends where the loop's
work ends. Every figure below was measured in VICE x64sc 3.10 (rung 1) from
the exit screenshot of the pinned run:

```
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 \
      -limitcycles 8000000 [-model ntsc] -exitscreenshot out.png -autostart frame-sync-loop.prg
```

reading the border colour down PNG column x = 2 (PAL raster line = row + 16;
NTSC raster line = row + 28) and decoding the text cells against the
`chargen-901225-01.bin` glyphs.

**PAL, `WORK_UNITS = 8`** (`screenshots/frame-sync-loop.png`): the border is
white from raster line 254 to the bottom of the picture (line 287), white
again from the top of the picture (line 16) down to line 106, and black from
line 107 to line 253. **The bar ends at raster line 106.** The IRQ is set on
rirq row 250 and lands on line 251; the loop's first `$D020` store follows
three lines later, at 254 (the KERNAL dispatcher, the rirq trampoline, the
call and the loop's own exit from the wait; the three lines were measured,
not broken down). From 254 through the frame's end at 311 and on to 106 is
165 raster lines, 53 % of the 312-line frame. Text reads `FRAMES 00FB`
(251 loops since the program started), `DROPPED 0000`, `UNITS 0008`; the
cell at row 3 is green.

**NTSC (`-model ntsc`), `WORK_UNITS = 8`**
(`screenshots/frame-sync-loop-ntsc.png`): the border is white from PNG row
226 to the bottom of the picture (row 246) and from the top down to row 130,
black from row 131 to row 225. **The bar ends at raster line 158** (row
130 + 28) and begins at line 254 as on PAL. From 254 through the 6567R8's
last line, 262, and on to 158 is 168 lines, 64 % of the 263-line frame: the
same work is a bigger slice of the shorter frame. Text reads `FRAMES 011A`
(282 loops), `DROPPED 0000`, `UNITS 0008`; the cell is green.

The two line counts put the workload at roughly 10,100 to 10,400 CPU cycles
(arithmetic from the settled 63 and 65 cycles per line, less 40 cycles for
each of the 7 badlines the PAL bar crosses and the 14 the NTSC bar crosses;
the two regions' figures differ by 2 %, which is inside that badline
accounting and the one-line resolution of the picture). It was not timed
with a CIA timer here.

What the same instruments show when the loop does not fit, with the load
raised to 24 units, is pinned and measured in `frame-sync-loop-overrun.md`
(`screenshots/frame-sync-loop-overrun.png`): a white border with a
one-line black gap, `DROPPED` counting up and the cell red.

An earlier draft of this page ran 12 units of a 256-byte pass with an
`unsigned` index and read `DROPPED 00AA` with 76 loops: that "small" load
was three frames, which is why the unit was cut to a 64-byte pass with a
`char` index before anything was pinned.

## Why this works

The interrupt owns one byte, `irq_ticks`, and only ever increments it; the
main loop owns `seen` and only ever catches it up. Nothing is cleared across
the interrupt boundary, so there is no window in which a tick can be lost,
and because the byte is one byte the read in `while (irq_ticks == seen)` is
atomic without disabling interrupts. `delta` is computed in eight bits, so
the counter wrapping from 255 to 0 costs nothing; the tick-consumption
arithmetic (`delta = ticks - seen`, add `delta - 1` when `delta > 1`) was
run on the 6502 over all 65,536 (`irq_ticks`, `seen`) pairs in VICE, folded
into a 16-bit checksum that read `0D00 PASS` against the same fold in
Python (rung 1 for that arithmetic; the fold is `chk = (chk ^ inc) * 5 + 1`).
`rirq_wait()` in `rasterirq.c` (lines 606 to 614) is the library's own copy
of the same loop over `rirq_count`, which the dispatcher increments once per
frame after the last slot of the schedule has run; this recipe keeps its own
byte so the counting is visible on the page.

The sync point is the bottom of the display window, not the top of the
frame, on purpose. From line 251 the beam spends the bottom border, the
vertical blank and the top border, 112 lines on PAL and 63 on the 6567R8
(arithmetic from the settled frame lengths), before the first badline at
line 51 of the next frame; anything that writes the screen, the sprite
registers or `$D016`/`$D011` in that window lands before the VIC reads them,
so a loop that does its display writes first never tears. The workload here
is deliberately dumb and runs on past line 51 into the display so the bar
has something to show; the badlines it crosses there are why the same
cycles cover more lines on NTSC than the per-line figures alone predict.

The bar is two stores to `$D020`: one after the wait, one after the work.
Whatever the beam is drawing between them is white, so the band's length is
the loop's time in raster lines and its end is the budget used. When the
work outgrows the frame the band has no end: the wait passes at once and
the only black is the handful of cycles between the two stores, which is
the one-line gap in the picture on `frame-sync-loop-overrun.md`, walking
down the frame because each loop is a non-integer number of frames long. An
overrun in this loop does not halve the frame rate, it runs the game at the
speed of the work (1.65 frames a loop on that page); a loop that instead
spins on `vic_waitLine(251)` after the same 1.65 frames of work would wait
for the next line 251 every time and run at exactly two frames a loop
(arithmetic; that variant was not run here). Which of the two you want is a
design choice; what you do not want is to find out from the player.
