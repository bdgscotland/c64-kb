---
recipe: charset-animation
toolchain: oscar64
output_format: PRG
region: both
techniques: [charset_animation]
file_formats: [PRG]
uses_registers: [D018, D020, D021, DC06, DC07, DC0F, DD06, DD07, DD0F]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 charset animation: one glyph rewritten in place, one charset flipped by $D018, timed against a redraw

## Synopsis

Three bands of tiles animate three different ways, each timed on a CIA
timer and shown in a HUD. Rows 6 to 11 are 240 cells of one screen code
whose 8 glyph bytes are rewritten every frame from an eight-phase table
(method (a) of `charset_animation`). Rows 13 to 18 are 240 cells of a
second code that differs between two 2 KB charsets at $3000 and $3800;
the loop flips `$D018` between them every four frames (method (b)).
Rows 20 to 24 are the comparison: 200 cells given a new screen code
every frame. A self-check reads the glyph and `$D018` back and compares
them with what the frame count predicts, then writes `$02FF` (01 pass,
02 fail) and the border colour (green or red). The technique is
`charset_animation` in `techniques/text-mode-render.md`.

## Source

```c
// charset-animation.c -- two ways to animate text-mode tiles, timed.
// Rows 6-11 are one glyph (WATER) whose 8 bytes are rewritten in place
// each frame from a table; rows 13-18 are one glyph (BELT) that differs
// between two 2 KB charsets, and the frame loop flips $D018 between them;
// rows 20-24 are the comparison, 200 cells redrawn every frame with a new
// screen code. Each method is timed on CIA1 timer B and the figures go in
// a HUD. A self-check compares the glyph and $D018 with what the frame
// count predicts: $02FF = 01 and a green border on pass, 02 and red on fail.
// Build: oscar64 -tm=c64 -O2 -o=charset-animation.prg charset-animation.c
#include <c64/vic.h>
#include <c64/cia.h>
#include <c64/memmap.h>
#include <string.h>

// Code and data below $3000; the two charsets sit at $3000 and $3800,
// the last two 2 KB slots of VIC bank 0.
#pragma region( main, 0x0a00, 0x3000, , , {code, data, bss, heap, stack} )

#define SCREEN   ((char *)0x0400)
#define COLOUR   ((char *)0xd800)
#define CHAR_ROM ((char *)0xd000)
#define SET_A    ((char *)0x3000)     // $D018 = $1C: VM 1 ($0400), CB 6
#define SET_B    ((char *)0x3800)     // $D018 = $1E: VM 1 ($0400), CB 7
#define RESULT   (*(volatile char *)0x02ff)

#define WATER    0x5b                 // rewritten in place every frame
#define BELT     0x5c                 // differs between the two sets
#define WATER_ROW 6                   // rows 6-11, 240 cells
#define BELT_ROW  13                  // rows 13-18, 240 cells
#define DRAW_ROW  20                  // rows 20-24, 200 cells, redrawn
#define FLIP_EVERY 4                  // frames per charset

static char * const set[2] = { SET_A, SET_B };
static const char  d018[2] = { 0x1c, 0x1e };

// Eight phases of a wave, one 8-byte glyph each: a ripple that moves
// down one pixel row per frame. Phase 0 is row 0 dark, and so on.
static const char water_tab[8][8] = {
    { 0x00, 0x66, 0xff, 0x00, 0x00, 0x00, 0x66, 0xff },
    { 0xff, 0x00, 0x66, 0xff, 0x00, 0x00, 0x00, 0x66 },
    { 0x66, 0xff, 0x00, 0x66, 0xff, 0x00, 0x00, 0x00 },
    { 0x00, 0x66, 0xff, 0x00, 0x66, 0xff, 0x00, 0x00 },
    { 0x00, 0x00, 0x66, 0xff, 0x00, 0x66, 0xff, 0x00 },
    { 0x00, 0x00, 0x00, 0x66, 0xff, 0x00, 0x66, 0xff },
    { 0xff, 0x00, 0x00, 0x00, 0x66, 0xff, 0x00, 0x66 },
    { 0x66, 0xff, 0x00, 0x00, 0x00, 0x66, 0xff, 0x00 },
};

// Two phases of a belt: 4-pixel treads, shifted half a tread between sets.
static const char belt_tab[2][8] = {
    { 0xf0, 0xf0, 0xf0, 0xf0, 0x0f, 0x0f, 0x0f, 0x0f },
    { 0x0f, 0x0f, 0x0f, 0x0f, 0xf0, 0xf0, 0xf0, 0xf0 },
};

// Four ROM glyphs the redraw region cycles through: . * + -
static const char spin_tab[4] = { 0x2e, 0x2a, 0x2b, 0x2d };

static unsigned t_rewrite, t_flip, t_redraw;   // cycles, CIA1 timer B
static unsigned t_loop;                        // whole iteration, CIA2 timer B

static void timer_start(void)
{
    cia1.crb = 0x00;
    cia1.tb  = 0xffff;
    cia1.crb = 0x11;                  // force load, start, count phi2
}

static unsigned timer_stop(void)
{
    cia1.crb = 0x00;
    return 0xffff - cia1.tb;
}

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

// Add one to a five-digit decimal already on screen: no division.
static void bump_dec5(char * dst)
{
    for (char i = 5; i > 0; i--) {
        if (dst[i - 1] < '9') { dst[i - 1]++; return; }
        dst[i - 1] = '0';
    }
}

// Print a figure only when it differs from the one on screen.
static void show_if_changed(char * dst, unsigned * shown, unsigned v)
{
    if (v != *shown) { put_dec5(dst, v); *shown = v; }
}

// Method (a): the glyph's 8 bytes, written into the set about to be shown.
static void rewrite_glyph(char * font, const char * src)
{
    char * g = font + WATER * 8;
    g[0] = src[0]; g[1] = src[1]; g[2] = src[2]; g[3] = src[3];
    g[4] = src[4]; g[5] = src[5]; g[6] = src[6]; g[7] = src[7];
}

// The comparison: 200 cells given a new screen code, five rows of 40.
static void redraw_cells(char code)
{
    char * p = SCREEN + 40 * DRAW_ROW;
    for (char i = 0; i < 200; i++)
        p[i] = code;
}

int main(void)
{
    __asm { sei }

    // Both sets start as the ROM font, so the HUD text still reads.
    mmap_set(MMAP_CHAR_ROM);
    memcpy(SET_A, CHAR_ROM, 2048);
    mmap_set(MMAP_ROM);
    memcpy(SET_B, SET_A, 2048);
    memcpy(SET_A + BELT * 8, belt_tab[0], 8);
    memcpy(SET_B + BELT * 8, belt_tab[1], 8);

    memset(SCREEN, 0x20, 1000);
    memset(COLOUR, VCOL_WHITE, 1000);
    memset(SCREEN + 40 * WATER_ROW, WATER, 240);
    memset(COLOUR + 40 * WATER_ROW, VCOL_LT_BLUE, 240);
    memset(SCREEN + 40 * BELT_ROW, BELT, 240);
    memset(COLOUR + 40 * BELT_ROW, VCOL_YELLOW, 240);
    memset(COLOUR + 40 * DRAW_ROW, VCOL_LT_GREEN, 200);
    vic.color_back = VCOL_BLACK;
    vic.color_border = VCOL_BLACK;

    put_str(SCREEN,       "FRAME   00000  SET A  PASS");
    put_str(SCREEN + 40,  "REWRITE 00000  8 BYTES IN PLACE");
    put_str(SCREEN + 80,  "FLIP    00000  ONE $D018 WRITE");
    put_str(SCREEN + 120, "REDRAW  00000  200 CELLS");
    put_str(SCREEN + 160, "LOOP    00000  ALL THREE + CHECK");
    put_str(SCREEN + 40 * (WATER_ROW - 1), "IN PLACE:");
    put_str(SCREEN + 40 * (BELT_ROW - 1),  "CHARSET FLIP:");
    put_str(SCREEN + 40 * (DRAW_ROW - 1),  "REDRAW:");

    unsigned frame = 0;
    char fault = 0;
    unsigned shown[4] = { 0, 0, 0, 0 };

    for (;;)
    {
        vic_waitFrame();              // line 256, below the display

        char phase = (char)(frame & 7);
        char which = (char)((frame / FLIP_EVERY) & 1);

        cia2.crb = 0x00;              // whole-iteration clock, CIA2 timer B
        cia2.tb  = 0xffff;
        cia2.crb = 0x11;

        // Method (a) first: it has to land while the VIC is not fetching.
        timer_start();
        rewrite_glyph(set[which], water_tab[phase]);
        t_rewrite = timer_stop();

        // Method (b): one store. It takes effect at the next glyph fetch.
        timer_start();
        vic.memptr = d018[which];
        t_flip = timer_stop();

        // The comparison: 200 cells rewritten with a new screen code.
        timer_start();
        redraw_cells(spin_tab[frame & 3]);
        t_redraw = timer_stop();

        // Self-check against what the frame count predicts. Bit 0 of
        // $D018 is unused and reads back as 1, so it is masked.
        if (memcmp(set[which] + WATER * 8, water_tab[phase], 8) != 0)
            fault = 1;
        if ((vic.memptr & 0xfe) != d018[which])
            fault = 1;

        RESULT = fault ? 2 : 1;
        vic.color_border = fault ? VCOL_RED : VCOL_GREEN;

        cia2.crb = 0x00;              // the loop figure stops here
        t_loop = 0xffff - cia2.tb;

        // HUD last, outside the loop figure. The cycle figures are the
        // previous iteration's; they do not change after the first frame,
        // so each costs a compare and nothing else.
        if (frame) bump_dec5(SCREEN + 8);
        SCREEN[19] = 1 + which;       // screen code 1 = 'A', 2 = 'B'
        if (fault) put_str(SCREEN + 22, "FAIL");
        show_if_changed(SCREEN + 48,  &shown[0], t_rewrite);
        show_if_changed(SCREEN + 88,  &shown[1], t_flip);
        show_if_changed(SCREEN + 128, &shown[2], t_redraw);
        show_if_changed(SCREEN + 168, &shown[3], t_loop);

        frame++;
    }
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=charset-animation.prg charset-animation.c
```

Built with Oscar64 at `-O2`; the PRG is 2,049 bytes. The `#pragma region`
line caps code and data at $3000 so the two charsets the program blits
there cannot land on live code; without it the linker's default main
region runs to $A000 and nothing would refuse a build that had grown past
$3000 (see `charset_blit_overruns_grown_code`).

## Expected output

Black screen, green border. A five-line white HUD at the top:

```
FRAME   00249  SET A  PASS
REWRITE 00196  8 BYTES IN PLACE
FLIP    00014  ONE $D018 WRITE
REDRAW  02429  200 CELLS
LOOP    03368  ALL THREE + CHECK
```

Below it three captioned bands: `IN PLACE:` over six rows of light-blue
ripple (rows 6 to 11), `CHARSET FLIP:` over six rows of yellow 4-pixel
treads (rows 13 to 18), `REDRAW:` over five rows of light-green ROM
glyphs (rows 20 to 24) that cycle `.` `*` `+` `-`. Every figure below is
from VICE x64sc 3.10 (rung 1), from the exit screenshot of the pinned
run

```
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 \
      -limitcycles 8000000 [-model ntsc] -exitscreenshot out.png -autostart charset-animation.prg
```

decoded against the `chargen-901225-01.bin` glyphs for the HUD and
against the program's own tables for the three bands, and from a
`-moncommands` store trace on `$02FF` that dumps `$32D8-$32DF`,
`$3AD8-$3ADF` and `$D018` at each verdict store. Those are the WATER
glyph (code $5B, offset $5B * 8 = $2D8) in set A at $3000 and set B at
$3800; the first draft of this page named `$38D8`, which is glyph $1B
of set B and never changes, so a trace on it shows set B as never
written. The first store in the log is the KERNAL's own, at boot; the
stores after it are loop iterations 0 upwards.

**PAL** (`screenshots/charset-animation.png`): `FRAME 00249`, `SET A`,
`PASS`. Frame 249 is phase 1 of the ripple (249 mod 8) and set A
(249 / 4 = 62, even). All 240 water cells match `water_tab[1]`
(`FF 00 66 FF 00 00 00 66`), all 240 belt cells match set A's tread
(`F0 F0 F0 F0 0F 0F 0F 0F`) and none match set B's, and all 200 redraw
cells are the ROM `*` (code $2A, `spin_tab[249 & 3]`). The dump for
iteration 249 reads `$32D8: FF 00 66 FF 00 00 00 66`, `$D018: 1D` and
`$02FF: 01`. It is not the last: the verdict store fired 252 times, the
last on raster line 309 of iteration 250, inside the vertical blank,
and that dump reads `$32D8: 66 FF 00 66 FF 00 00 00` (phase 2). The
cycle limit fires after iteration 250's rewrite but before the next
frame's display, so memory is one iteration ahead of the screenshot.
Set B's glyph is written only on its turn: the dump for iteration 4
reads `$3AD8: 00 00 66 FF 00 66 FF 00` (phase 4) with `$D018: 1F`.
Before that `$3AD8` holds the ROM's cross glyph for code $5B
(`18 18 18 FF FF 18 18 18`), and after each of set B's four-frame
turns it keeps that turn's last phase until the next one: the last dump
reads `$3AD8: 66 FF 00 00 00 66 FF 00`, phase 7 from iteration 247.
`$D018` reads `1F` on every odd four-frame block and `1D` on every even
one, all 251 iterations. Border (98, 213, 50), VICE's PAL green.

**NTSC** (`-model ntsc`, `screenshots/charset-animation-ntsc.png`):
`FRAME 00280`, `SET A`, `PASS`; phase 0, set A, redraw glyph `.` (code
$2E). 240 of 240, 240 of 240 and 200 of 200 cells match the tables as
on PAL. The monitor reads `$32D8: 00 66 FF 00 00 00 66 FF`, `$D018: 1D`
and `$02FF: 01`, 282 verdict stores, the last on line 44, above the
first badline. Border (114, 189, 103).

The four cycle figures are the same on both models because the whole
loop runs in the blank, where nothing is stolen:

| HUD line | Cycles | What the window holds (from the `.asm` listing) |
|---|---|---|
| REWRITE | 196 | pointer set-up for `set[which]` and `water_tab[phase]`, `JSR`, two `INC`, then eight `LDY # / LDA (zp),Y / LDY # / STA (zp),Y` at 15 cycles each (120), `RTS` |
| FLIP | 14 | `LDY zp` (3), `LDA abs,Y` (4), `STA $D018` (4), and the timer's stop store |
| REDRAW | 2,429 | 200 iterations of `STA abs,X / INX / CPX / BNE`, 12 cycles a cell, plus entry and exit |
| LOOP | 3,368 | the three above with their timer starts and stops, the 8-byte `memcmp`, the `$D018` read-back, the `$02FF` and `$D020` stores |

The HUD is written after LOOP stops and is not in any figure: the frame
counter is bumped in place as decimal digits and the four cycle values
are reprinted only when they change, which after the first frame is
never. An earlier build printed all five values with `put_dec5` every
frame inside the loop timer; that cost about 7,900 cycles, and on NTSC,
where the blank from line 256 to the first badline is 58 lines (about
3,770 cycles), the HUD writes landed after the beam had passed rows 0 to
4, so the screenshot showed the previous frame's count over the current
frame's bands. A build that then timed the HUD inside LOOP read 5,282
one run and 5,468 the next: `show_if_changed` was printing LOOP because
LOOP had changed because it was printing. Neither figure is on the page
for that reason.

Two pinned runs per model gave byte-identical PNGs. One NTSC run made
while two other x64sc processes were running on the same host produced
the BASIC start screen instead: the program had not started by the time
the cycle limit fired. Run the pinned command on its own.

## Why this works

Method (a) works because the VIC has no copy of the glyph. Every raster
line of every text row it fetches the 8-byte glyph for each cell's code
from the character base, so writing those 8 bytes changes every cell
that shows the code at the next fetch. The rewrite is placed first in
the loop, right after `vic_waitFrame()` returns at line 256, because a
rewrite that straddles a fetch shows old rows above the write and new
rows below it for that frame. Only the set about to be shown is
rewritten; the other set keeps a stale glyph until its turn comes, when
the same eight stores bring it up to date before `$D018` selects it.

Method (b) works because `$D018` bits 1 to 3 are the character base in
2 KB steps within the VIC bank, and the VIC reads the register at each
fetch, so one 4-cycle store moves the whole screen's glyph source and
there is no partial state to display. The two sets are copies of the
character ROM with one glyph replaced, so the HUD text reads the same
from either. Reading `$D018` back for the check masks bit 0: it is not
implemented and returns 1 (the monitor dump shows `1D` for a stored
`1C`).

The comparison is what the technique page's cost figures rest on. The
in-place rewrite is 196 cycles for 240 animated cells, and would be 196
for 1,000; redrawing the same 240 cells at the measured 12 cycles each
would be 2,880 (arithmetic from the 200-cell figure), and the redraw's
cost grows with the field. The redraw here changes only screen codes;
an animation done that way also needs one glyph per phase in the
charset, eight codes for this ripple, where method (a) needs one.

The self-check is what makes the verdict mean something. It does not
trust the value it just wrote: it reads the eight bytes back through the
same `set[which]` pointer with `memcmp`, reads `$D018` back from the
chip, and compares both with tables indexed by the frame count, so a
rewrite to the wrong set, a wrong phase or a `$D018` value that did not
stick would latch `fault`, turn the border red and put 02 in `$02FF` for
the harness in `runtime/vice-reference.md`, "Verifying a run without a
human", to read.
