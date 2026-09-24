---
recipe: soft-scroll-v
toolchain: oscar64
output_format: PRG
region: both
techniques: [soft_scroll_v, char_scroll_buffer_v, charset_copy_rom_to_ram]
file_formats: [PRG]
uses_registers: [D011, D012, D018, D020, D021, DD00]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 Hardware Vertical Soft-Scroll

## Synopsis

The whole text screen moves up one raster line a frame with `$D011` bits
2-0 (YSCROLL). On seven frames out of eight the only work is the YSCROLL
write; on the eighth, YSCROLL wraps from 0 to 7 and the screen RAM moves up
one row, top row first, faster than the beam. The write goes on line 247,
the first line below the 24-row window, because YSCROLL decides which lines
are badlines and so where each character row starts: a build with
`-dLATE_WRITE=1` makes the same write on line 150 and shows one row drawn
twice in every frame. This is `soft_scroll_v` with the coarse move of
`char_scroll_buffer_v` (`docs/techniques/scroll.md`). A ruler glyph and a
binary row number on every row let a script read, from a screenshot, which
row and which pixel line of it every raster line shows.

## Source

```c
// soft-scroll-v.c
//
// Hardware vertical soft-scroll: the text screen moves up one raster line a
// frame. $D011 bits 2-0 (YSCROLL) pick which lines are badlines, and so
// where every character row starts. Decrement once per frame; when it wraps
// from 0 to 7, move the screen RAM up one row, top row first, and put a new
// row in at the bottom.
//
// Build with -dLATE_WRITE=1 for the trap: the same YSCROLL write made on
// line 150, inside the display, moves the badlines under the beam.
//
#include <c64/vic.h>
#include <c64/memmap.h>
#include <string.h>

#define Screen ((char *)0x0400)
#define Color  ((char *)0xd800)
#define Font   ((char *)0x3800)

#define COLS  40
#define ROWS  25          // 24 shown with RSEL=0, plus the one scrolling in

// A ruler glyph: pixel line r has its r+1 leftmost pixels set, so a
// screenshot tells which line of its row every raster line shows.
#define RULER 0x60

#ifndef LATE_WRITE
#define LATE_WRITE 0
#endif

// The line the frame loop waits for: the first below the 24-row window (55-246)
// on both PAL and NTSC, or line 150 for the trap build.
#define SYNC_LINE (LATE_WRITE ? 150 : 247)

static unsigned next_row;       // sequence number of the next row to enter
static char ys;                 // YSCROLL, 0-7

// Row n: rulers in columns 0-1, "row nnn" in 3-9, n's low byte in binary
// in columns 30-37 (reverse space for 1, space for 0).
static void fill_row(char * dst, unsigned n)
{
    memset(dst, 0x20, COLS);
    dst[0] = RULER;
    dst[1] = RULER;
    dst[3] = 0x12;              // screen codes for "row "
    dst[4] = 0x0f;
    dst[5] = 0x17;
    dst[7] = 0x30 + (char)(n / 100 % 10);
    dst[8] = 0x30 + (char)(n / 10 % 10);
    dst[9] = 0x30 + (char)(n % 10);
    for (char b = 0; b < 8; b++)
        if (n & (0x80 >> b))
            dst[30 + b] = 0xa0;
}

// Move rows 1-24 up to rows 0-23. Fully unrolled: each byte is one
// LDA abs / STA abs pair, top row first, so every row is done before the
// beam fetches it (measured on the recipe page).
static void shift_rows_up(void)
{
#pragma unroll(full)
    for (char row = 0; row < ROWS - 1; row++) {
#pragma unroll(full)
        for (char x = 0; x < COLS; x++)
            Screen[row * COLS + x] = Screen[(row + 1) * COLS + x];
    }
}

int main(void)
{
    // A RAM copy of the upper-case character set, with the ruler added.
    __asm { sei }
    mmap_set(MMAP_CHAR_ROM);
    memcpy(Font, (char *)0xd000, 2048);
    mmap_set(MMAP_ROM);
    __asm { cli }
    for (char r = 0; r < 8; r++)
        Font[RULER * 8 + r] = (char)(0xff00 >> (r + 1));

    vic_setmode(VICM_TEXT, Screen, Font);
    vic.color_border = VCOL_BLACK;
    vic.color_back = VCOL_BLACK;
    memset(Color, VCOL_WHITE, 1000);
    for (char r = 0; r < ROWS; r++)
        fill_row(Screen + r * COLS, r);
    next_row = ROWS;

    // No KERNAL timer IRQ from here on. At 60 Hz it beats with the frame
    // and can sit on SYNC_LINE for several frames running; the exact-line
    // wait then misses those frames (measured on NTSC: four in a row).
    __asm { sei }

    ys = 7;
    vic_waitLine(SYNC_LINE);
    vic.ctrl1 = VIC_CTRL1_DEN | ys;         // RSEL=0: 24 rows, window 55-246

    for (;;) {
        // One pass per frame: wait for the line (the loop below makes sure
        // the previous pass has left it).
        vic_waitLine(SYNC_LINE);

        bool carry = (ys == 0);
        ys = (ys - 1) & 7;

        // The YSCROLL write. Below the window it moves the next frame's
        // badlines; at line 150 it moves this frame's, under the beam.
        vic.ctrl1 = VIC_CTRL1_DEN | ys;

        // On the wrap, the coarse move and the new bottom row.
        if (carry) {
            shift_rows_up();
            fill_row(Screen + (ROWS - 1) * COLS, next_row++);
        }

        while (vic.raster == (char)SYNC_LINE)
            ;
    }

    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=soft-scroll-v.prg soft-scroll-v.c
oscar64 -tm=c64 -O2 -dLATE_WRITE=1 -o=soft-scroll-v-late.prg soft-scroll-v.c   # the trap
```

`#pragma unroll(full)` on both loops of `shift_rows_up` makes Oscar64 emit
960 absolute load and store pairs with no loop, 8 cycles a byte.

## Expected output

Black screen and border, white text. Every row reads `ROW nnn` with its
number, a two-cell ruler at the left edge and the number's low byte in
binary (reverse-space cells) in columns 30 to 37. The rows climb one pixel
a frame, 50 px/s on PAL and about 60 px/s on NTSC, and new numbered rows
enter at the bottom.

Measured in VICE x64sc 3.10, PAL c64c (8565/8580/8521) and NTSC 6567R8,
with PIL: every raster line of the window (55 to 246) was decoded into
(row number, pixel line). In the committed shots
(`screenshots/soft-scroll-v.png`, `screenshots/soft-scroll-v-ntsc.png`)
row × 8 + line rises by exactly one per raster line from 55 to 246: no
row is cut, repeated or skipped. In 18 exit shots one frame apart (19,656
cycles PAL, 17,095 NTSC) from 8,000,000 cycles, crossing two wraps, the
same held in every shot, and the value on line 55 rose by one per frame,
17 steps of 17 on each model.

### The coarse move against the beam

A store trace on the last byte of each screen row, over six wraps:

| | PAL | NTSC |
|---|---|---|
| Row 0 done | line 253 | line 252 |
| Row 23 done | line 58 of the next frame | line 107 of the next frame |
| Row 0 to row 23 | 7,403 cycles | 7,659 cycles |
| Least lead over the VIC's fetch of a row | 114 lines (row 0) | 66 lines (row 0) |

The move does not fit in the lines below and above the window: from line
247 to line 55 is 7,560 cycles on PAL and 4,615 on NTSC. It does not need
to. The VIC fetches row k on line 55 + 8k after a wrap, 8 lines a row, and
the move finishes a row every 5 lines, so a move that starts ahead of the
beam stays ahead. NTSC takes longer because more of its move runs during
display lines, where badlines stop the CPU.

### The trap: YSCROLL written inside the window

Built with `-dLATE_WRITE=1`, the write lands on line 150. Eight shots one
frame apart, both models: in every one, the row under the beam at line
150 stops after 7 of its 8 lines and starts again from its first line on
the next badline, so it shows 15 lines, and everything below it sits 7
lines lower than above. The seam walks up one line a frame (PAL: lines
155, 154, ... 151), and on the wrap frame the picture has two seams. The
top of each frame still moves one line a frame: the write made on line 150
of one frame is what the top of the next frame uses.

YSCROLL is compared with the raster line on every line, not once a frame.
Lowering it by one under the beam makes the current line, or the next,
match the badline condition while the row in progress has not reached its
last line; the VIC starts the row again from its first line. The fix is
where the write goes: below the window, before line 55 of the next frame.

### Why the KERNAL interrupt is off

The frame loop waits for one exact line with `vic_waitLine`. With the
KERNAL's 60 Hz timer interrupt running, a build without the `sei` lost
frames: on NTSC (59.8 Hz frames) the interrupt fell across line 247 in
consecutive frames and the loop missed three in a row (store trace on
`$D011`: two stores 68,198 cycles apart, four frames). A
loop that keeps the KERNAL interrupt needs a wait that cannot miss a line,
such as `vic_waitFrame` (`oscar64/soft-scroll-h.md`).

## Why this works

### The order in the frame

On line 247 the loop writes the new YSCROLL first, then, on a wrap, moves
the rows and fills row 24. Both changes are for the next frame: the window
has closed, and the VIC reads neither `$D011`'s YSCROLL nor screen RAM for
display again until line 55. The new row 24 is below the window at
YSCROLL 7 and scrolls into view over the next frames.

### 24 rows and a 25th

RSEL = 0 shrinks the window to 24 rows, lines 55 to 246, and hides the
partial rows at the top and bottom as YSCROLL changes. The screen RAM still
holds 25 rows: the 25th is the one scrolling in.

### The ruler

Character `$60` of the RAM font is replaced by a glyph whose pixel line r
has r + 1 pixels set from the left. On any raster line, the number of lit
pixels in column 0 is the line of the row being shown, plus one. With the
row number in binary on the same line, one screenshot gives the whole
frame's row map, which is how the tables above were measured.
