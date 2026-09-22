---
recipe: tile-map-render
toolchain: oscar64
output_format: PRG
region: both
techniques: [tile_map_render]
file_formats: [PRG]
uses_registers: [D011, D020, D021, DC06, DC07, DC0F]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 Tile Map Render: RLE metatile map to screen and colour RAM

## Synopsis

Decodes a hand-written, RLE-compressed map of 2x2 metatiles onto the text
screen, writing screen RAM and colour RAM, and prints what it cost. The map
is 20 x 11 metatiles (40 x 22 characters) built from six metatiles defined
in the source; no external art. Row 0 prints the map size and two cycle
counts measured by CIA1 timer B: the RLE decode of all eleven row streams,
and the metatile expansion to screen and colour RAM. Row 1 prints three
RLE self-checks, each a 16-bit checksum of the decoded bytes with PASS or
FAIL against a value computed in Python from the same source arrays. Row
24 draws a sixteen-cell colour key that the verification script uses to
read colours from the picture without assuming a palette. This is the
`tile_map_render` technique from `docs/techniques/scroll.md`.

## Source

```c
// tile-map-render.c
//
// Decode an RLE-compressed metatile map onto the text screen.
// Each metatile is 2x2 screen codes and one colour; the map is
// 20 x 11 metatiles (40 x 22 characters) drawn on rows 2-23.
// Row 0 prints the map size and the measured cycle costs.
// Row 1 prints three RLE self-checks (checksum + PASS/FAIL).
//
#include <c64/vic.h>
#include <c64/cia.h>

#define Screen ((char *)0x0400)
#define Color  ((char *)0xd800)

#define MAP_W   20          // metatiles per row
#define MAP_H   11          // metatile rows
#define MAP_ROW 2           // first character row of the map

// --- metatiles -------------------------------------------------------
// Four screen codes (top-left, top-right, bottom-left, bottom-right)
// and one colour. Screen codes are written straight to screen RAM.
struct Metatile { char c[4]; char col; };

const struct Metatile tiles[] = {
    { { 0x2e, 0x2c, 0x2c, 0x2e }, 5  },   // 0 grass  . , , .
    { { 0x66, 0x66, 0x66, 0x66 }, 6  },   // 1 water  checkerboard
    { { 0xa0, 0xa0, 0xa0, 0xa0 }, 12 },   // 2 wall   solid block
    { { 0x51, 0x51, 0x58, 0x58 }, 13 },   // 3 tree   two balls over two clubs
    { { 0xe6, 0xe6, 0xe6, 0xe6 }, 9  },   // 4 path   inverted checkerboard
    { { 0x4f, 0x50, 0x4c, 0x7a }, 15 },   // 5 rock   rounded corners
};

// --- RLE map rows ----------------------------------------------------
// Each row is its own stream. Control byte c:
//   c & 0x80  : run    -- the next byte is repeated (c & 0x7f) times
//   c < 0x80  : literal-- the next c bytes are copied as they are
//   0x00      : end of row
// A stream never produces more than 128 bytes per control byte.
const char map_rows[] = {
    0x94, 2, 0,                                                         // row 0
    0x81, 2, 0x88, 0, 0x81, 4, 0x89, 0, 0x81, 2, 0,                     // row 1
    0x04, 2, 0, 3, 3, 0x85, 0, 0x81, 4, 0x84, 0, 0x83, 1, 0x82, 0, 0x81, 2, 0, // row 2
    0x81, 2, 0x82, 0, 0x81, 3, 0x85, 0, 0x81, 4, 0x83, 0, 0x85, 1, 0x81, 0, 0x81, 2, 0, // row 3
    0x81, 2, 0x88, 0, 0x86, 4, 0x83, 1, 0x81, 0, 0x81, 2, 0,           // row 4
    0x81, 2, 0x82, 5, 0x8b, 0, 0x81, 4, 0x84, 0, 0x81, 2, 0,           // row 5
    0x81, 2, 0x83, 0, 0x84, 3, 0x86, 0, 0x81, 4, 0x84, 0, 0x81, 2, 0,  // row 6
    0x81, 2, 0x84, 0, 0x82, 3, 0x87, 0, 0x05, 4, 3, 0, 5, 0, 0x81, 2, 0, // row 7
    0x81, 2, 0x8d, 0, 0x81, 4, 0x84, 0, 0x81, 2, 0,                     // row 8
    0x02, 2, 5, 0x8c, 0, 0x81, 4, 0x84, 0, 0x81, 2, 0,                  // row 9
    0x94, 2, 0,                                                         // row 10
};

// Two extra streams for the self-check: a long run pair and pure literals.
const char rle_b[] = { 0xff, 7, 0x81, 3, 0 };
const char rle_c[] = { 0x08, 1, 2, 3, 4, 5, 6, 7, 8, 0 };

// Expected checksums, computed by rle_check.py from the arrays above.
#define EXPECT_A 0xaba2
#define EXPECT_B 0x8ee5
#define EXPECT_C 0xd1d9

// Decoded map, one byte per metatile.
char map[MAP_W * MAP_H];

// Scratch buffer for the self-check streams (rle_b expands to 128 bytes).
char scratch[128];

// --- RLE row decoder -------------------------------------------------
// Expands one stream into dst. Returns the address of the next stream
// (the byte after the terminator) and the decoded length in *len.
const char *rle_row(const char *src, char *dst, char *len)
{
    char n = 0;
    for (;;) {
        char c = *src++;
        if (c == 0)
            break;
        if (c & 0x80) {
            char v = *src++;
            char k = c & 0x7f;
            do { dst[n++] = v; } while (--k);
        } else {
            do { dst[n++] = *src++; } while (--c);
        }
    }
    *len = n;
    return src;
}

// --- metatile expansion ----------------------------------------------
// Draws map row my (0..MAP_H-1) as two character rows of screen and
// colour RAM.
void expand_row(char my)
{
    const char *m = map + my * MAP_W;
    char *s0 = Screen + (MAP_ROW + 2 * my) * 40;
    char *s1 = s0 + 40;
    char *k0 = Color + (MAP_ROW + 2 * my) * 40;
    char *k1 = k0 + 40;
    for (char x = 0; x < MAP_W; x++) {
        const struct Metatile *t = tiles + m[x];
        char col = t->col;
        char sx = 2 * x;
        s0[sx] = t->c[0]; s0[sx + 1] = t->c[1];
        s1[sx] = t->c[2]; s1[sx + 1] = t->c[3];
        k0[sx] = col; k0[sx + 1] = col;
        k1[sx] = col; k1[sx + 1] = col;
    }
}

// --- CIA1 timer B harness --------------------------------------------
// Timer B counts system clocks down from 0xffff. It is stopped before
// the read so the two-byte read cannot straddle a decrement.
static inline void timer_start(void)
{
    cia1.crb = 0x00;
    cia1.tb = 0xffff;
    cia1.crb = 0x11;          // force load, start, count phi2
}

static inline unsigned timer_stop(void)
{
    cia1.crb = 0x00;
    return 0xffff - cia1.tb;
}

// --- checksum fold ---------------------------------------------------
static inline unsigned fold(unsigned chk, unsigned v)
{
    return (chk ^ v) * 5 + 1;
}

unsigned rle_check(const char *src)
{
    char len;
    rle_row(src, scratch, &len);
    unsigned chk = 0;
    for (char i = 0; i < len; i++)
        chk = fold(chk, scratch[i]);
    return fold(chk, len);
}

// --- text helpers (screen codes) -------------------------------------
void put_str(char *p, const char *s)
{
    while (*s)
        *p++ = *s++;
}

void put_hex(char *p, unsigned v)
{
    for (char i = 0; i < 4; i++) {
        char d = (v >> 12) & 15;
        p[i] = d < 10 ? 0x30 + d : d - 9;   // 0-9, then screen codes 1-6 = A-F
        v <<= 4;
    }
}

void put_dec(char *p, unsigned v)
{
    for (char i = 5; i > 0; i--) {
        p[i - 1] = 0x30 + v % 10;
        v /= 10;
    }
}

void put_check(char *p, char name, unsigned got, unsigned want)
{
    p[0] = name;
    put_hex(p + 2, got);
    put_str(p + 7, got == want ? s"pass" : s"fail");
}

int main(void)
{
    vic.color_border = 0;
    vic.color_back = 0;
    for (unsigned i = 0; i < 1000; i++) {
        Screen[i] = 0x20;
        Color[i] = 1;
    }

    // Blank the display so no badline steals cycles from the timed
    // region, and wait for the blank to take effect (DEN is sampled on
    // line $30, so wait for the next frame).
    vic.ctrl1 = 0x0b;
    vic_waitFrame();
    vic_waitFrame();

    __asm { sei }

    // Harness overhead: start and stop with nothing between.
    timer_start();
    unsigned overhead = timer_stop();

    // Cost 1: decode all MAP_H row streams into the map buffer.
    timer_start();
    const char *src = map_rows;
    char len;
    for (char y = 0; y < MAP_H; y++)
        src = rle_row(src, map + y * MAP_W, &len);
    unsigned t_rle = timer_stop() - overhead;

    // Cost 2: expand every metatile row to screen and colour RAM.
    timer_start();
    for (char y = 0; y < MAP_H; y++)
        expand_row(y);
    unsigned t_exp = timer_stop() - overhead;

    __asm { cli }

    // Self-check: three streams, checksums against the values Python computed.
    unsigned a = rle_check(map_rows + 3 + 11);    // row 2's stream
    unsigned b = rle_check(rle_b);
    unsigned c = rle_check(rle_c);

    put_str(Screen, s"map 20x11  rle       expand");
    put_dec(Screen + 15, t_rle);
    put_dec(Screen + 28, t_exp);
    put_check(Screen + 40, 0x01, a, EXPECT_A);
    put_check(Screen + 53, 0x02, b, EXPECT_B);
    put_check(Screen + 66, 0x03, c, EXPECT_C);

    // Colour key on row 24: cell i is a solid block in colour i. The
    // verification script learns each colour's RGB from this row instead
    // of assuming a palette file.
    for (char i = 0; i < 16; i++) {
        Screen[24 * 40 + i] = 0xa0;
        Color[24 * 40 + i] = i;
    }

    vic.ctrl1 = 0x1b;

    for (;;)
        ;
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=tile-map-render.prg tile-map-render.c
```

Then run headless in VICE (PAL):

```bash
GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas x64sc -default -warp +sound \
  +autostart-delay-random -autostartprgmode 1 -limitcycles 8000000 \
  -exitscreenshot tile-map-render.png -autostart tile-map-render.prg
```

Add `-model ntsc` for the NTSC picture.

## Expected output

Black border and background. Row 0 reads `MAP 20X11  RLE 08828 EXPAND 10731`
and row 1 reads `A ABA2 PASS  B 8EE5 PASS  C D1D9 PASS`, both in white.
Rows 2 to 23 hold the map: a grey wall one metatile thick around the
edge, green grass inside it, a brown path entering at the top, turning
right and running down to the bottom wall, a blue pool at the upper right,
four groups of light-green trees and three light-grey rocks. Row 24 holds
the colour key, sixteen solid cells in colours 0 to 15 (cell 0 is black on
black and invisible).

The same text, and the same two cycle counts, appear on PAL and NTSC
(measured in VICE x64sc 3.10, both models; the timed region runs with
interrupts masked and the display blanked, so it counts CPU cycles only
and the two regions' different clock rates do not enter into it).

Screenshots at 8,000,000 cycles: `screenshots/tile-map-render.png` (PAL)
and `screenshots/tile-map-render-ntsc.png` (NTSC).

The two numbers on row 0 mean:

| Figure | Cycles | Per unit |
|---|---|---|
| RLE decode, 135 stream bytes to 220 map bytes | 8,828 | 40.1 per decoded byte |
| Expand 220 metatiles (880 screen + 880 colour writes) | 10,731 | 48.8 per metatile, 6.1 per byte written |

Both are net of the harness's own start/stop cost, which the program
measures once with an empty timed region and subtracts. The figures are
for this listing at `-O2`; a different decoder shape or an unrolled
expand gives a different number.

## Why this works

`rle_row` reads one control byte at a time. Bit 7 set means a run: the
next byte is repeated `c & 0x7f` times. Bit 7 clear means `c` literal
bytes follow. Zero ends the row. Each row is its own stream and the
decoder returns the address just past the terminator, so a caller walks
the rows by calling it eleven times in a row; there is no offset table.
A `do { } while (--k)` loop is used for both cases because the count is
never zero, which saves the compare Oscar64 would otherwise emit for a
`for` loop.

`expand_row` turns one map row into two character rows. For each
metatile it writes four screen codes and four copies of the colour to
the two rows, using two screen pointers and two colour pointers that are
40 bytes apart. Colour RAM at `$D800` only holds the low nibble, so a
single colour per metatile is the cheapest form; a per-character colour
variant stores four colour bytes in the `Metatile` struct and costs the
same number of writes. The screen codes go straight into screen RAM, so
the tile table holds screen codes and the `s""` string prefix is used for
the row 0 and row 1 text.

The timing harness stops timer B before reading it, so the two-byte
read cannot straddle a decrement. Interrupts are masked with `sei`
around the timed region so the KERNAL's jiffy interrupt does not land
inside it, and the display is blanked (`$D011` = `$0B`) two frames earlier
so no badline steals cycles. DEN is sampled once per frame on line `$30`
(`docs/hardware/vic-ii-reference.md`), which is why the program waits for
two frames after blanking rather than one. The checksum fold
`(chk ^ v) * 5 + 1` in 16 bits does not cancel on a symmetric input, so a
decoder that emitted the right bytes in the wrong order would fail.

## Verification

Three instruments, all run against the committed PNGs (VICE x64sc 3.10,
build 2026-05-19 of Oscar64):

**Cell-by-cell render comparison.** `rle_check.py` parses the `tiles`,
`map_rows`, `rle_b` and `rle_c` arrays out of this listing, decodes the
eleven row streams with the same rules, and produces the expected screen
code and colour of every one of the 880 cells in rows 2 to 23.
`render_compare.py` decodes each cell of the PNG: the screen code by
matching the 8x8 ink pattern against all 256 glyphs of the upper-case
bank of `chargen-901225-01.bin`, and the colour by exact RGB match against
the sixteen key cells the program draws on row 24. Result on both
pictures: 880 cells compared, 0 differing, worst glyph mismatch 0 bits,
and every ink colour matched a key cell exactly (the smallest squared RGB
distance to the second-nearest key colour was 5,252 on PAL and 2,910 on
NTSC). The key row exists because VICE's default palette is an internally
calculated one: nearest-colour matching against its `.vpl` files
misclassified grey 12 as light grey 15 on the first attempt, and the
picture's own key removes the assumption. The scripts are in the page's
scratch (`/tmp/c64kb-write/GAME-04/rle_check.py`, `render_compare.py`).

**RLE decoder self-check.** Stream A is map row 2 (a literal group, four
runs, 20 bytes out), stream B is `rle_b` (a run of 127 then a run of 1,
128 bytes out, the longest a control byte allows), stream C is `rle_c`
(eight literals, no runs). For each the 6502 folds every decoded byte
and then the decoded length with `chk = (chk ^ v) * 5 + 1`, and prints
the result next to PASS or FAIL against the value compiled in. Python
computed `A ABA2`, `B 8EE5`, `C D1D9` from the same arrays; the screen
shows the same three values and PASS three times, on both models. This is
rung 1 for those three streams and says nothing about streams the format
allows but these do not exercise (a run count of zero is undefined by the
format and is not tested).

**Cycle counts.** Read off the picture: `RLE 08828`, `EXPAND 10731`,
identical on PAL and NTSC. The harness is the CIA1 timer B code in the
listing; the display was blanked and interrupts masked for the timed
region.

The first PAL picture had no colour key and the compare script matched
colours against `pepto-pal.vpl`; that scored 348 differing cells, all of
them colour, none glyph. The key row was added and the script rewritten to
learn the palette from the picture. The first NTSC comparison after that
change still failed because the NTSC run had not produced a new PNG and
the stale one was measured; the run was repeated alone and the file's
timestamp checked before the figure above was taken.
