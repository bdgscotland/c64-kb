---
recipe: double-buffer
toolchain: oscar64
output_format: PRG
region: both
techniques: [screen_double_buffer_d018, screen_ram_relocation]
file_formats: [PRG]
uses_registers: [D018, D011, D000, D001, D010, D015, D027, D020, D021, DC06, DC07, DC0F]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 Double Buffer: two text pages flipped by one $D018 write per frame

## Synopsis

Two 1 KB screen pages at $2800 and $2C00 in VIC bank 0. Each frame the
program fills the hidden page with that page's pattern (diagonal stripes
on page A, horizontal bands on page B), writes a caption with the frame
number and the page letter, restores the sprite pointer block the fill has
just overwritten, waits for the vertical blank and flips $D018. One yellow
hollow-box sprite stays on screen through every flip. The caption also
shows what the previous draw cost in cycles, from CIA1 timer B. Use this
as the skeleton for any text-mode game that redraws the whole screen each
frame.

## Source

```c
// double-buffer.c -- two text screens in VIC bank 0, flipped by one $D018
// write per frame. Build: oscar64 -tm=c64 -O2 -o=double-buffer.prg double-buffer.c
#include <c64/vic.h>
#include <c64/cia.h>
#include <string.h>

// 1 = keep both pages' sprite pointer blocks in step (correct).
// 0 = the companion recipe: page B's pointer block is never written.
#define MIRROR_SPRITE_POINTERS 1

// Code and data below the pages; pages at $2800 (VM 10) and $2C00 (VM 11),
// clear of the character ROM the VIC sees at $1000-$1FFF in bank 0.
#pragma region( lower, 0x0a00, 0x2800, , , {code, data} )
#pragma region( main, 0x3000, 0xa000, , , {code, data, bss, heap, stack} )

#define PAGE_A   ((char *)0x2800)
#define PAGE_B   ((char *)0x2c00)
#define COLOUR   ((char *)0xd800)
#define SPR_DATA ((char *)0x0340)     // block 13, the cassette buffer
#define SPR_BLOCK 13
#define CHARSET_CB 0x04               // ROM font at $1000: CB bits = 010

static char * const page[2] = { PAGE_A, PAGE_B };
static const char  vm[2]    = { 10, 11 };

// One 256-byte template per page, written four times to cover the whole
// 1 KB page. Page A: diagonal stripes. Page B: horizontal bands.
static char tpl[2][256];

static unsigned draw_cycles;          // cost of the previous draw

// Measurement builds only (-dREDRAW_ROWS=n): the draw copies n 40-byte
// rows from a 1,000-byte map per page instead of the template fill, and
// the timer stops before the caption. Not defined, the program is the one
// the pictures below come from.
#ifdef REDRAW_ROWS
static char map[2][1000];

static void copy_rows(char * s, const char * m, char n)
{
    for (char r = 0; r < n; r++) {
        for (char c = 0; c < 40; c++) s[c] = m[c];
        s += 40;
        m += 40;
    }
}
#endif

static void put_str(char * dst, const char * s)
{
    while (*s) {
        char c = *s++;
        if (c >= 'A' && c <= 'Z') c -= 64;   // ASCII letter to screen code
        *dst++ = c;
    }
}

static void put_dec5(char * dst, unsigned v)
{
    for (char i = 5; i > 0; i--) {
        dst[i - 1] = '0' + (char)(v % 10);
        v /= 10;
    }
}

// Draw one whole 1 KB page: the template goes to +0, +256, +512 and +768,
// so bytes 1000-1023 are written too. That is what overwrites the sprite
// pointer block at +$3F8, on every frame, on both pages.
static void draw_page(char p, unsigned frame)
{
    char * s = page[p];
    const char * t = tpl[p];
    char i = 0;

    cia1.crb = 0x00;
    cia1.tb  = 0xffff;
    cia1.crb = 0x11;                  // force load, start, count phi2

#ifdef REDRAW_ROWS
    copy_rows(s, map[p], REDRAW_ROWS);
#if MIRROR_SPRITE_POINTERS
    s[0x3f8] = SPR_BLOCK;
#endif
    cia1.crb = 0x00;
    draw_cycles = 0xffff - cia1.tb;
    put_str(s,       "FRAME 00000 PAGE A  DRAW 00000");
    put_dec5(s + 6,  frame);
    s[17] = 1 + p;
    put_dec5(s + 25, draw_cycles);
    return;
#endif
    if (p == 0) {
        do {
            char v = t[i];
            PAGE_A[i] = v; PAGE_A[i + 256] = v;
            PAGE_A[i + 512] = v; PAGE_A[i + 768] = v;
        } while (++i);
    } else {
        do {
            char v = t[i];
            PAGE_B[i] = v; PAGE_B[i + 256] = v;
            PAGE_B[i + 512] = v; PAGE_B[i + 768] = v;
        } while (++i);
    }

#if MIRROR_SPRITE_POINTERS
    s[0x3f8] = SPR_BLOCK;             // pointer block moves with the page
#endif

    put_str(s,       "FRAME 00000 PAGE A  DRAW 00000");
    put_dec5(s + 6,  frame);
    s[17] = 1 + p;                    // screen code 1 = 'A', 2 = 'B'
    put_dec5(s + 25, draw_cycles);

    cia1.crb = 0x00;
    draw_cycles = 0xffff - cia1.tb;
}

int main(void)
{
    __asm { sei }

    for (unsigned k = 0; k < 256; k++) {
        char r = (char)(k / 40), c = (char)(k % 40);
        tpl[0][k] = (((r + c) & 7) < 4) ? 0x66 : 0x20;   // diagonals
        tpl[1][k] = (r & 2) ? 0xa0 : 0x20;               // bands
    }
#ifdef REDRAW_ROWS
    for (unsigned k = 0; k < 1000; k++) {
        map[0][k] = tpl[0][k & 255];
        map[1][k] = tpl[1][k & 255];
    }
#endif

    memset(COLOUR, 1, 1000);          // one colour RAM, white, set once
    vic.color_border = 0;
    vic.color_back   = 0;

    // One sprite: a hollow box, 21 rows.
    for (char r = 0; r < 21; r++) {
        char edge = (r == 0 || r == 20) ? 0xff : 0x80;
        SPR_DATA[r * 3]     = edge;
        SPR_DATA[r * 3 + 1] = (r == 0 || r == 20) ? 0xff : 0x00;
        SPR_DATA[r * 3 + 2] = (r == 0 || r == 20) ? 0xff : 0x01;
    }
    vic.spr_pos[0].x  = 172;
    vic.spr_pos[0].y  = 130;
    vic.spr_msbx      = 0;
    vic.spr_color[0]  = 7;            // yellow
    vic.spr_enable    = 1;

    unsigned frame = 0;
    char     hidden = 0;

    for (;;) {
        frame++;
        draw_page(hidden, frame);             // hidden page only
        vic_waitFrame();                      // line 256: below the display
        vic.memptr = (vm[hidden] << 4) | CHARSET_CB;   // the flip
        hidden ^= 1;
    }
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=double-buffer.prg double-buffer.c
```

Oscar64 build 2026-05-19. The PRG is 1,212 bytes; code and data sit at
$0A00-$0CBB, below the pages, and the two templates and the counter go
to BSS at $3000 (514 bytes, from the linker map).

Run headless:

```bash
GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas x64sc -default -warp +sound \
  +autostart-delay-random -autostartprgmode 1 -limitcycles 8000000 \
  -exitscreenshot double-buffer.png -autostart double-buffer.prg
```

Add `-model ntsc` for the NTSC picture.

### Row redraw builds

`-dREDRAW_ROWS=n` builds the measurement the technique's per-row Cost
comes from (#106). The draw then copies n 40-byte rows of a 1,000-byte
map into the hidden page with a byte loop, restores the pointer block,
and stops the timer before the caption, so DRAW is the rows alone. The
default build is byte-identical to one without the `#ifdef` blocks.

```bash
oscar64 -tm=c64 -O2 -dREDRAW_ROWS=3 -o=rows3.prg double-buffer.c
```

DRAW read from the exit screenshot's caption, the largest of four runs
at 8,000,000, 8,019,656, 8,039,312 and 8,058,968 cycles, VICE x64sc 3.10:

| Rows | PAL | NTSC | 57 + 814 × rows |
|---|---|---|---|
| 0 | 15 | 15 | 57 |
| 1 | 786 | 786 | 871 |
| 2 | 1,576 | 1,576 | 1,685 |
| 3 | 2,326 | 2,326 | 2,499 |
| 4 | 3,076 | 3,076 | 3,313 |
| 8 | 6,090 | 6,348 | 6,569 |
| 12 | 9,348 | 9,671 | 9,825 |
| 16 | 12,768 | 12,998 | 13,081 |
| 20 | 16,071 | 16,328 | 16,337 |
| 25 | 20,077 | 20,077 | 20,407 |

From 16 rows on NTSC and 20 on PAL the draw and the wait take more than
a frame, and the frame number advances every other frame.

## Expected output

Black border and background. Row 0 is a white caption; rows 1 to 24 are
the visible page's pattern; a yellow hollow box, 24 by 21 pixels, sits
over the pattern at the centre. Which page is visible depends on the exact
cycle the run stops at, so the caption is what the pinned run pins.

**PAL, 8,000,000 cycles** (`screenshots/double-buffer.png`): row 0 reads
`FRAME 00251 PAGE A  DRAW 12598`. Page A is diagonal stripes of the
checkerboard glyph (screen code $66), four cells wide, each row one cell
left of the row above, with a one-cell jog where the 256-byte template
restarts: row 6 at column 16, row 12 at column 32, row 19 at column 8
(256 bytes is six rows and sixteen cells). Row 1 decodes as
`XXX....XXXX....XXXX....XXXX....XXXX....X` with X the glyph and `.` a
space.

**PAL, 8,019,656 cycles** (one PAL frame later; not a committed picture):
row 0 reads `FRAME 00252 PAGE B  DRAW 12592`. The frame number advanced
by one and the page letter changed, so the flip runs once per frame.

**NTSC, 8,000,000 cycles** (`screenshots/double-buffer-ntsc.png`): row 0
reads `FRAME 00282 PAGE B  DRAW 13165`. Page B is horizontal bands of
reverse space (screen code $A0): rows 2 and 3 full width, row 6 columns
0 to 15, row 8 columns 16 to 39, and so on where the template's rows 2
and 3 fall after each 256-byte restart.

**The sprite** is the same in all three pictures: exactly 86 yellow
pixels forming a 24 by 21 hollow box, top and bottom rows solid, one
pixel at each end of the nineteen rows between, and nothing else yellow
anywhere in the picture. PNG columns 180 to 203; PNG rows 115 to 135 on
PAL and 103 to 123 on NTSC. Measured with PIL against the box the sprite
data describes; a scripted match, not an eye.

The DRAW figure is the cost of the previous frame's draw in CPU cycles,
CIA1 timer B counting phi2, and it includes the cycles the VIC stole for
badlines and the sprite while the draw ran. It varies by a few cycles
from frame to frame on PAL and reads about 570 higher on NTSC. Both are
under one frame (19,656 PAL, 17,095 NTSC), which is the condition for the
counter to advance once per frame.

All figures measured in VICE x64sc 3.10, Oscar64 build 2026-05-19, at
`-O2`.

## Why this works

The two pages sit at $2800 and $2C00 so that neither touches the ROM font
the VIC reads at $1000-$1FFF in bank 0 or the program below $2800. The
flip is `vic.memptr = (vm[hidden] << 4) | CHARSET_CB`: the VM nibble
selects the page, the constant $04 keeps the character base at $1000.
`vic_waitFrame()` polls bit 7 of $D011 until it is clear and then set,
which is line 256, below the last display line; the video matrix is
fetched on badlines only, so the new page is complete before the first
badline of the next frame. Waiting for clear-then-set rather than set
alone stops a short draw flipping twice in one bottom border.

`draw_page` writes the whole 1 KB page, not the 1,000 visible cells: the
256-byte template goes to +0, +256, +512 and +768 as four `STA abs,y`
per byte read, which makes the draw fit in a frame. The price is
that bytes 1000 to 1023 are overwritten too, and +$3F8 is sprite 0's
pointer on whichever page is visible. `s[0x3f8] = SPR_BLOCK` after the
fill is the mirror: both pages carry pointer 13 at the moment they become
visible, so the sprite never changes image on a flip. Delete that line
(the companion recipe sets the `#define` to 0) and the sprite shows
program bytes.

Colour RAM is written once, all white. There is only one colour map and
$D018 does not select it, so a per-page colour scheme would need the
colours rewritten in the blank after each flip. Keeping the colours fixed
is the simplest of the three options the technique page lists.

The first draft of this listing drew each page as 25 `memcpy` or `memset`
calls of 40 bytes. That cost 17,437 cycles for the bands and 22,760 for
the stripes, and on NTSC two runs one frame apart both read
`FRAME 00143`: the draws were longer than a 17,095-cycle frame, so the
flip waited a frame every other time. The template fill brought the draw
to 12,598 cycles and the counter to one per frame on both models.
