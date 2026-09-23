---
recipe: charset-parallax
toolchain: oscar64
output_format: PRG
region: both
techniques: [charset_parallax, infinite_scroll_h]
file_formats: [PRG]
uses_registers: [D011, D016, D018, D020, D021, DC06, DC07, DC0F]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 character parallax: a background tile rolled at half the foreground's speed, checked against a model

## Synopsis

A foreground of brick tiles scrolls left at 1 px a frame: `$D016`
XSCROLL every frame and a one-column shift of screen RAM every eighth.
Behind it, a 16x16 hill pattern lives in four reserved glyphs (2x2
cells); every second frame their 32 bytes are rotated right one pixel,
so the hills move left at 1/2 px a frame. The same frame also copies the
pre-shifted phase from a table into four spare glyphs, so the two
methods are timed side by side and checked against each other. After
203 frames the program stops, checks the glyph bytes against a model
built by 16-bit shifts in C, checks `$D016` and every one of the 920
scrolled cells against the tile map, and prints PASS or FAIL with the
cycle figures. `$02FF` is 01 on pass, 02 on fail; the border is green or
red. The technique is `charset_parallax` in `techniques/scroll.md`.

## Source

```c
// charset-parallax.c -- parallax inside the character layer.
// The foreground (brick tiles) scrolls left 1 px a frame: $D016 XSCROLL
// every frame, a one-column shift of screen RAM every eighth. The
// background is a 16x16 pattern held in four reserved glyphs (2x2 cells);
// every second frame the glyph bytes are rotated right one pixel, so the
// pattern moves left at 1 - 1/2 = 1/2 px a frame. After FRAMES frames the
// program stops, checks the glyph bytes against a model built a different
// way and every cell against the tile map, and prints PASS or FAIL and
// the cycle cost of the glyph update: $02FF = 01 pass, 02 fail.
// Build: oscar64 -tm=c64 -O2 -o=charset-parallax.prg charset-parallax.c
#include <c64/vic.h>
#include <c64/cia.h>
#include <c64/memmap.h>
#include <string.h>

// Code and data below $3000; the charset is at $3000 ($D018 = $1C).
#pragma region( main, 0x0a00, 0x3000, , , {code, data, bss, heap, stack} )

#define SCREEN   ((char *)0x0400)
#define COLOUR   ((char *)0xd800)
#define CHAR_ROM ((char *)0xd000)
#define FONT     ((char *)0x3000)
#define RESULT   (*(volatile char *)0x02ff)

#define BG       0x60        // background glyphs $60-$63: A B on even rows, C D on odd
#define FG       0x64        // foreground brick; never shares a cell with BG
#define SPARE    0x68        // $68-$6B: target of the pre-shifted copy, shown nowhere
#define GLYPHS   ((char *)0x3300)   // FONT + BG * 8: A, B, C, D, 32 bytes in a row
#define SPAREG   ((char *)0x3340)   // FONT + SPARE * 8
#define TOP      2           // rows 0-1 are the HUD, rows 2-24 scroll
#define MAPW     64          // map width in cells; the map wraps
#define FRAMES   203         // stop after this many frames
#define D016     0x00        // $D016 without XSCROLL: CSEL 0 (38 columns), hires

// The background tile, one 16-bit word per pixel row, bit 15 = leftmost
// pixel: a hill, pixels with 2 * |x - 7| <= r from row 2 down. The
// rightmost column is never set, so all 16 rotations differ.
static const unsigned pat[16] = {
    0x0000, 0x0000, 0x0380, 0x0380, 0x07c0, 0x07c0, 0x0fe0, 0x0fe0,
    0x1ff0, 0x1ff0, 0x3ff8, 0x3ff8, 0x7ffc, 0x7ffc, 0xfffe, 0xfffe
};

// Model: pre[s] is the tile rotated right s pixels, laid out as the four
// glyphs are (A rows 0-7, B rows 0-7, C rows 8-15, D rows 8-15). Built
// with 16-bit shifts in C, not with the byte roll it checks.
static char pre[16][32];

static char map[23][MAPW];   // FG or 0 (background) per cell of the world

static unsigned t_roll, t_copy, t_shift;   // worst frame of each, CIA1 timer B

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

// The technique: rotate the 2x2 background tile right one pixel.
// Per pixel row, the pair (left, right) is a 16-bit word; LSR of the right
// byte puts its rightmost pixel in carry, ROR of the left byte takes it in
// at the left edge and drops its own rightmost pixel into carry, and ROR
// of the right byte takes that in: 20 cycles a pixel row. A, B, C, D are
// $3300, $3308, $3310, $3318 (GLYPHS); the asm names them by address.
static void roll_right(void)
{
    __asm volatile
    {
        ldx #7
    rl: lda $3308,x          // B
        lsr
        ror $3300,x          // A
        ror $3308,x          // B
        lda $3318,x          // D
        lsr
        ror $3310,x          // C
        ror $3318,x          // D
        dex
        bpl rl
    }
}

// The alternative: copy the pre-shifted phase in, 32 bytes. Here it goes
// to the spare glyphs so the two methods can be compared byte for byte.
__zeropage char * src;           // (zp),y needs a zero-page pointer
static void copy_phase(void)
{
    __asm volatile
    {
        ldy #31
    cl: lda (src),y
        sta $3340,y
        dey
        bpl cl
    }
}

// Screen code for world cell (row r of the scrolled field, world column w).
static char cell(char r, char w)
{
    char m = map[r][w];
    if (m) return m;
    return BG + (w & 1) + (((r + TOP) & 1) << 1);
}

// One column left, rows 2-24, top to bottom so it stays ahead of the beam.
// Each row is its own loop on a constant address (LDA abs,X / STA abs,X),
// three bytes an iteration; the new column comes from colbuf, filled on
// the frame before, so no map lookup runs inside the race.
static char colbuf[23];
#define ROW(r) { for (char i = 0; i < 39; i += 3) {                 \
                     SCREEN[40 * (r) + i]     = SCREEN[40 * (r) + i + 1]; \
                     SCREEN[40 * (r) + i + 1] = SCREEN[40 * (r) + i + 2]; \
                     SCREEN[40 * (r) + i + 2] = SCREEN[40 * (r) + i + 3]; } \
                 SCREEN[40 * (r) + 39] = colbuf[(r) - TOP]; }
static void shift_left(void)
{
    ROW(2)  ROW(3)  ROW(4)  ROW(5)  ROW(6)  ROW(7)  ROW(8)  ROW(9)
    ROW(10) ROW(11) ROW(12) ROW(13) ROW(14) ROW(15) ROW(16) ROW(17)
    ROW(18) ROW(19) ROW(20) ROW(21) ROW(22) ROW(23) ROW(24)
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

int main(void)
{
    __asm { sei }

    mmap_set(MMAP_CHAR_ROM);
    memcpy(FONT, CHAR_ROM, 2048);
    mmap_set(MMAP_ROM);

    // The model: the tile's sixteen rotations.
    for (char s = 0; s < 16; s++)
        for (char r = 0; r < 16; r++) {
            unsigned w = s ? (pat[r] >> s) | (pat[r] << (16 - s)) : pat[r];
            char k = r < 8 ? r : r + 8;       // A/B for rows 0-7, C/D for 8-15
            pre[s][k]     = (char)(w >> 8);   // left glyph
            pre[s][k + 8] = (char)w;          // right glyph
        }
    memcpy(GLYPHS, pre[0], 32);

    // Foreground brick.
    static const char brick[8] = { 0xff, 0x81, 0x81, 0xff, 0xff, 0x18, 0x18, 0xff };
    memcpy(FONT + FG * 8, brick, 8);

    // The map: ground on rows 20-22 (screen 22-24), a platform every 16
    // columns on row 10, a pillar every 32 columns on rows 14-19.
    for (char r = 0; r < 23; r++)
        for (char w = 0; w < MAPW; w++) {
            char m = 0;
            if (r >= 20) m = FG;
            if (r == 10 && (w & 15) >= 3 && (w & 15) <= 7) m = FG;
            if (r >= 14 && (w & 31) >= 20 && (w & 31) <= 21) m = FG;
            map[r][w] = m;
        }

    memset(SCREEN, 0x20, 1000);
    memset(COLOUR, VCOL_LT_BLUE, 1000);
    memset(COLOUR, VCOL_WHITE, 80);
    for (char r = 0; r < 23; r++)
        for (char c = 0; c < 40; c++)
            SCREEN[40 * (r + TOP) + c] = cell(r, c);

    vic.color_back = VCOL_BLUE;
    vic.color_border = VCOL_BLACK;
    vic.memptr = 0x1c;                // screen $0400, charset $3000

    char xs = 7;                      // XSCROLL, 38-column mode
    char coarse = 0;                  // columns shifted so far, mod MAPW
    char fault = 0;
    vic.ctrl2 = D016 | xs;

    for (unsigned frame = 1; frame <= FRAMES; frame++)
    {
        vic_waitFrame();              // line 256, below the display

        // Background first: it must land before the first row is fetched.
        if (!(frame & 1)) {
            timer_start();
            roll_right();
            unsigned t = timer_stop();
            if (t > t_roll) t_roll = t;
        }

        // The alternative, timed on the same frame: copy this frame's
        // pre-shifted phase into the spare glyphs.
        char phase = (char)(frame >> 1) & 15;
        src = pre[phase];
        timer_start();
        copy_phase();
        unsigned t = timer_stop();
        if (t > t_copy) t_copy = t;

        // Foreground: one pixel left, a column every eighth frame.
        if (xs == 0) {
            xs = 7;
            vic.ctrl2 = D016 | xs;
            timer_start();
            shift_left();
            t = timer_stop();
            if (t > t_shift) t_shift = t;
        } else {
            xs--;
            vic.ctrl2 = D016 | xs;
            if (xs == 0) {            // next frame shifts: fetch its column now
                coarse = (coarse + 1) & (MAPW - 1);
                char w = (coarse + 39) & (MAPW - 1);
                for (char r = 0; r < 23; r++) colbuf[r] = cell(r, w);
            }
        }

        // Per-frame check: the rolled glyphs equal the model's phase for
        // this frame count, and so does the copy.
        if (memcmp(GLYPHS, pre[phase], 32) != 0) fault = 1;
        if (memcmp(SPAREG, GLYPHS, 32) != 0) fault = 1;
    }

    // Stopped. Check the foreground: fine scroll and every cell.
    if ((vic.ctrl2 & 7) != 7 - (FRAMES & 7)) fault = 1;
    char c0 = (char)(FRAMES / 8) & (MAPW - 1);
    for (char r = 0; r < 23; r++)
        for (char c = 0; c < 40; c++)
            if (SCREEN[40 * (r + TOP) + c] != cell(r, (c0 + c) & (MAPW - 1)))
                fault = 1;

    RESULT = fault ? 2 : 1;
    vic.color_border = fault ? VCOL_RED : VCOL_GREEN;
    put_str(SCREEN + 1, fault ? "FAIL  FRAME" : "PASS  FRAME");
    put_dec5(SCREEN + 13, FRAMES);
    put_str(SCREEN + 20, "SHIFT");
    put_dec5(SCREEN + 26, t_shift);
    put_str(SCREEN + 41, "ROLL");
    put_dec5(SCREEN + 46, t_roll);
    put_str(SCREEN + 53, "COPY");
    put_dec5(SCREEN + 58, t_copy);
    put_str(SCREEN + 65, "CYCLES");

    for (;;) ;
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=charset-parallax.prg charset-parallax.c
```

Built with Oscar64 at `-O2`; the PRG is 2,936 bytes. The `#pragma
region` line keeps code and data below $3000, where the charset is
copied (see `charset_blit_overruns_grown_code`). From the map:
`roll_right` is 26 bytes at `$0E8D`, `copy_phase` 11 bytes,
`shift_left` 806 bytes, the phase table `pre` 512 bytes.

## Expected output

Blue screen, light-blue hills and bricks, green border. Two white HUD
lines at the top:

```
PASS  FRAME 00203  SHIFT 12321
ROLL 00378  COPY 00560  CYCLES
```

Below them, rows of filled hills 16 px wide; a five-cell brick platform
on screen row 12 every 16 cells; a two-cell brick pillar on rows 16 to
21 every 32 cells; three rows of ground bricks on rows 22 to 24. Every
figure below is from VICE x64sc 3.10 (rung 1), from the exit screenshot
of the pinned run

```
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 \
      -limitcycles 10000000 [-model ntsc] -exitscreenshot out.png -autostart charset-parallax.prg
```

measured with PIL against a model written separately in Python: the
same tile, rotated 203 / 2 = 101 pixels right (phase 5 of 16), fine
scroll 7 - (203 mod 8) = 4, and screen column `c` showing world column
(203 / 8 + c) mod 64 = 25 + c.

**PAL** (`screenshots/charset-parallax.png`): 0 pixels of 55,936 differ
from the model over rows 2 to 24 and x 39 to 342, the whole visible
scrolled field. The HUD decodes against `chargen-901225-01.bin` as
above. The hills' 3-pixel peaks (tile row 2) start at x = 55, 71, 87 and
on, x mod 16 = 7. At frame 0 they were at x = 32 + 7 + 6 = 45, mod 16 =
13 (arithmetic from the initial fill), so the pattern has moved 102 px
(mod 16) left while the foreground moved 203.
The brick platforms start at x = 116 and 244: world column 3 began at
x = 63, and (63 - 203) mod 128 = 116. Border (98, 213, 50), VICE's PAL
green. The verdict store to `$02FF` was traced with a monitor `watch
store 02ff`: value 01, at cycle 7,379,073.

**NTSC** (`-model ntsc`, `screenshots/charset-parallax-ntsc.png`): 0 of
55,936 pixels differ; peaks at x mod 16 = 7, platforms at 116 and 244;
`SHIFT 12537`, the other figures as on PAL. Border (114, 189, 103).
Verdict 01 at cycle 7,392,923.

Two pinned runs per model gave byte-identical PNGs.

| HUD figure | Cycles | What the window holds (from the `.asm` listing) |
|---|---|---|
| ROLL | 378 | `JSR`, `LDX #7`, eight passes of two `LDA abs,X / LSR / ROR abs,X / ROR abs,X` (40) with `DEX / BPL`, `RTS`, the timer's stop store |
| COPY | 560 | the pointer set-up for `pre[phase]`, which the compiler placed inside the timer window, then `JSR`, 32 passes of `LDA (zp),Y / STA abs,Y / DEY / BPL`, `RTS` |
| SHIFT | 12,321 PAL, 12,537 NTSC | 23 rows of 13 three-byte `LDA abs,X / STA abs,X` iterations and the new column's store, plus the cycles badlines steal once the shift runs into the display |

ROLL and COPY are the worst over all 203 frames; they run in the blank
from line 256, where nothing is stolen, so they are the same on both
models. SHIFT runs into the next frame's display, and NTSC's shorter
blank puts more badlines inside it.

## Why this works

The roll works because the VIC-II has no copy of a glyph: it reads the
eight bytes for each cell's code on every line of the row, so changing
32 bytes moves the pattern in all background cells at once. Each pixel
row of the tile is a 16-bit word across the left and right glyph;
`LSR` of the right byte puts its last pixel in carry, `ROR` of the left
byte takes it in at the left edge and passes its own last pixel on, and
`ROR` of the right byte takes that. The scroll carries the cells left
one pixel a frame and the roll carries the pattern right one pixel every
second frame; the sum is the half-speed background. Background cells
get their code from world column and row parity, so the one-column shift
brings in the right glyph at the right edge and the pattern stays
seamless. Foreground bricks are whole cells with their own code, so the
roll never touches them.

The order in the frame is the budget. `vic_waitFrame()` returns at line
256; the roll and the copy go first, under 1,000 cycles, about 16 lines.
On the carry frame the shift then races the beam, top row first. A
monitor trace of the last store of each row over all 25 carry frames
shows every row finished before the VIC fetched it: at least 86 lines
early on PAL and 41 on NTSC. Per-row loops on constant addresses,
three bytes an iteration, with the new column fetched from the map on the
frame before the carry, bring the shift to 12,321 cycles.

The self-check does not trust the code it checks. The model table `pre`
is built from the 16-bit pattern words with C shifts, not with the
`ROR` chain, and each frame the four live glyphs are compared with the
phase the frame count predicts, and the copied spare glyphs with the
live ones. At the end `$D016` is read back and compared with 7 - (203
mod 8), and every scrolled cell with the map at the column the frame
count predicts. A roll in the wrong direction, a skipped roll, a lost
carry bit or a missed column shift sets the fault byte, the border goes
red and `$02FF` reads 02 for the harness in `runtime/vice-reference.md`,
"Verifying a run without a human". The pattern table is constant, checked against the
Python model above.
