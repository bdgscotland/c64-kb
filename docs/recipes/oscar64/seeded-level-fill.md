---
recipe: seeded-level-fill
toolchain: oscar64
output_format: PRG
region: both
techniques: [seeded_level_fill, lfsr_random]
file_formats: [PRG]
uses_registers: [D011, D012, D020, D021, DC04, DC05, DC06, DC07, DC0E, DC0F]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 seeded level fill: a 40 by 22 tile field from a two-byte seed, regenerated and compared

## Synopsis

A level table holds, per level, a 16-bit seed, three cumulative
thresholds (wall, dirt, gem) and a five-entry object list (player start,
exit, three guaranteed gems). One generation walks the 880 cells of a
40 by 22 field, steps a 16-bit Galois LFSR once per cell, classifies the
low byte of the state against the thresholds, closes the frame with
wall, then writes the object list over the result. The program generates
level 1 twice into two buffers, compares them byte for byte, prints a
checksum of each, prints level 2's checksum beside them, checks that
every listed object sits in its cell on all three levels, and times one
generation with CIA1 timers A and B as a 32-bit clock. `$02FF` holds
`01` and the border is green when the two buffers match, the two seeds
differ in checksum and every object is placed; else `02` and red. The
three levels are then drawn as characters in turn, 200 frames each. It
implements `seeded_level_fill` (`techniques/logic.md`) on top of
`lfsr_random` (`techniques/maths.md`).

## Source

```c
// seeded-level-fill.c
// A 40 by 22 tile field filled from a 16-bit seed. One step of a Galois
// LFSR per cell; the low byte of the state is compared against three
// thresholds (wall, dirt, gem) read from a per-level table; a short object
// list then places the cells that must be exact (player start, exit, three
// fixed gems). The same seed is generated twice into two buffers and
// compared byte for byte; a checksum of each field is printed; CIA1 timers
// A and B time one generation. Levels 1 to 3 are drawn in turn, 200 frames
// each, and the last is held. $02FF holds 01 and the border is green when
// the regeneration matches, every listed object sits in its cell and the
// two seeds give different checksums; else 02 and red.
#include <c64/vic.h>
#include <c64/cia.h>

#define SCREEN ((char *)0x0400)
#define COLOUR ((char *)0xd800)
#define RESULT (*(volatile char *)0x02ff)

#define FW 40
#define FH 22
#define FIELD_BYTES (FW * FH)
#define HOLD_FRAMES 200

enum Tile { T_EMPTY, T_WALL, T_DIRT, T_GEM, T_PLAYER, T_EXIT };

struct Obj { char x, y, tile; };

struct Level
{
    unsigned   seed;          // the whole level in two bytes
    char       wall, dirt, gem; // cumulative thresholds on the LFSR low byte
    struct Obj objs[5];       // player start, exit, three guaranteed gems
};

// Thresholds are cumulative: r < wall is wall, r < dirt is dirt,
// r < gem is gem, anything else is empty. Higher rows are denser.
static const struct Level levels[3] = {
    { 0x2D5A,  40, 160, 176, { { 1, 1, T_PLAYER }, { 38, 20, T_EXIT },
                               { 20, 10, T_GEM }, { 5, 18, T_GEM }, { 34, 3, T_GEM } } },
    { 0x7C21,  64, 192, 204, { { 1, 20, T_PLAYER }, { 38, 1, T_EXIT },
                               { 19, 11, T_GEM }, { 8, 4, T_GEM }, { 30, 17, T_GEM } } },
    { 0xB3E7,  80, 216, 224, { { 20, 1, T_PLAYER }, { 20, 20, T_EXIT },
                               { 2, 11, T_GEM }, { 37, 11, T_GEM }, { 20, 11, T_GEM } } },
};
#define LAST_LEVEL 2

static const char tile_char[6]   = { 0x20, 0xa0, 0x66, 0x5a, 0x51, 0x5b };
static const char tile_colour[6] = { VCOL_BLACK, VCOL_MED_GREY, VCOL_ORANGE,
                                     VCOL_YELLOW, VCOL_WHITE, VCOL_LT_GREEN };

static const char hex_glyph[16] = {
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 1, 2, 3, 4, 5, 6 };

volatile unsigned s16;      // LFSR state; global so the assembler can name it
char field_a[FIELD_BYTES];
char field_b[FIELD_BYTES];

// 16-bit Galois LFSR, one step, right shift, taps $B400.
__noinline void step16(void)
{
    __asm volatile {
        lsr s16 + 1
        ror s16
        bcc l1
        lda s16 + 1
        eor #$b4
        sta s16 + 1
    l1:
    }
}

// Fill one field from the level's seed and thresholds, then place the
// object list. The level index is clamped to the last row; a zero seed
// is replaced, because the LFSR never leaves state zero.
__noinline void generate(char level, char *field)
{
    if (level > LAST_LEVEL)
        level = LAST_LEVEL;
    const struct Level *lv = &levels[level];
    unsigned seed = lv->seed;
    if (seed == 0)
        seed = 0xACE1;
    s16 = seed;
    char wall = lv->wall, dirt = lv->dirt, gem = lv->gem;
    char *p = field;
    for (char y = 0; y < FH; y++)
    {
        for (char x = 0; x < FW; x++)
        {
            step16();
            char r = (char)s16;
            char t;
            if (r < wall)      t = T_WALL;
            else if (r < dirt) t = T_DIRT;
            else if (r < gem)  t = T_GEM;
            else               t = T_EMPTY;
            if (x == 0 || x == FW - 1 || y == 0 || y == FH - 1)
                t = T_WALL;     // a closed frame round the field
            *p++ = t;
        }
    }
    for (char i = 0; i < 5; i++)
    {
        const struct Obj *o = &lv->objs[i];
        field[o->y * FW + o->x] = o->tile;
    }
}

static unsigned checksum(const char *field)
{
    unsigned cs = 0;
    for (unsigned i = 0; i < FIELD_BYTES; i++)
        cs = (cs ^ field[i]) * 5 + 1;
    return cs;
}

static unsigned compare(const char *a, const char *b)
{
    unsigned diff = 0;
    for (unsigned i = 0; i < FIELD_BYTES; i++)
        if (a[i] != b[i])
            diff++;
    return diff;
}

// Every object in the level's list sits in its cell after generation.
static bool objects_placed(char level, const char *field)
{
    const struct Level *lv = &levels[level];
    for (char i = 0; i < 5; i++)
    {
        const struct Obj *o = &lv->objs[i];
        if (field[o->y * FW + o->x] != o->tile)
            return false;
    }
    return true;
}

static void draw(const char *field)
{
    for (unsigned i = 0; i < FIELD_BYTES; i++)
    {
        char t = field[i];
        SCREEN[i] = tile_char[t];
        COLOUR[i] = tile_colour[t];
    }
}

static void put_str(char row, char col, const char *s)
{
    char *p = SCREEN + 40 * row + col;
    while (*s)
    {
        char c = *s++;
        *p++ = (c >= 'a' && c <= 'z') ? c - 'a' + 1 : c;
    }
}

static void put_hex16(char row, char col, unsigned v)
{
    char *p = SCREEN + 40 * row + col;
    p[0] = hex_glyph[v >> 12];
    p[1] = hex_glyph[(v >> 8) & 15];
    p[2] = hex_glyph[(v >> 4) & 15];
    p[3] = hex_glyph[v & 15];
}

static void put_dec(char row, char col, unsigned long v, char width)
{
    char *p = SCREEN + 40 * row + col + width;
    do
    {
        *--p = '0' + (char)(v % 10);
        v /= 10;
    } while (--width);
}

// CIA1 timer B counts timer A underflows: a 32-bit phi2 clock round one
// call of generate(), interrupts off, screen on so badlines are inside it.
static unsigned long time_generate(char level, char *field)
{
    cia1.cra = 0x00;
    cia1.crb = 0x00;
    cia1.ta = 0xffff;
    cia1.tb = 0xffff;
    cia1.crb = 0x51;
    cia1.cra = 0x11;
    generate(level, field);
    cia1.cra = 0x00;
    cia1.crb = 0x00;
    unsigned lo = 0xffff - cia1.ta;
    unsigned hi = 0xffff - cia1.tb;
    return ((unsigned long)hi << 16) + lo;
}

int main(void)
{
    __asm { sei }
    for (unsigned i = 0; i < 1000; i++)
    {
        SCREEN[i] = 0x20;
        COLOUR[i] = VCOL_WHITE;
    }
    vic.color_back = VCOL_BLACK;
    vic.color_border = VCOL_BLACK;

    // Level 1 twice, level 2 once, checksums and the byte compare.
    unsigned long cycles = time_generate(0, field_a);
    unsigned cs1 = checksum(field_a);
    generate(0, field_b);
    unsigned cs1b = checksum(field_b);
    unsigned diff = compare(field_a, field_b);
    bool objs = objects_placed(0, field_a) && objects_placed(0, field_b);
    generate(1, field_b);
    unsigned cs2 = checksum(field_b);
    objs = objs && objects_placed(1, field_b);
    generate(2, field_b);
    objs = objs && objects_placed(2, field_b);

    bool ok = diff == 0 && cs1 == cs1b && cs1 != cs2 && objs;

    put_str(22, 0, "level    cs1      regen      cs2");
    put_hex16(22, 13, cs1);
    put_hex16(22, 24, cs1b);
    put_hex16(22, 33, cs2);
    put_str(23, 0, "diff      objs      gen cyc");
    put_dec(23, 5, diff, 3);
    put_str(23, 15, objs ? "ok " : "bad");
    put_dec(23, 28, cycles, 6);
    put_str(24, 0, ok ? "pass" : "fail");
    RESULT = ok ? 0x01 : 0x02;
    vic.color_border = ok ? VCOL_GREEN : VCOL_RED;

    // Show levels 1, 2 and 3 in turn; the last stays up.
    for (char lv = 0; lv <= LAST_LEVEL; lv++)
    {
        generate(lv, field_a);
        draw(field_a);
        SCREEN[22 * 40 + 6] = '1' + lv;
        if (lv == LAST_LEVEL)
            break;
        for (char f = 0; f < HOLD_FRAMES; f++)
            vic_waitFrame();
    }
    for (;;)
        ;
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=seeded-level-fill.prg seeded-level-fill.c
```

Run headless, pinned at 9,500,000 cycles so the exit lands while level 2
is on the screen on both models (level 2 begins between 7.0 and 8.0
million cycles on PAL and between 7.5 and 8.0 million on NTSC, from
probe runs at those counts, and stays up for 200 frames):

```bash
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 -limitcycles 9500000 -exitscreenshot seeded-level-fill.png -autostart seeded-level-fill.prg
```

Add `-model ntsc` for the NTSC picture. The PRG is 1,983 bytes.

## Expected output

Rows 0 to 21 are level 2's field: a grey wall frame, grey wall cells,
orange dirt, yellow diamonds, a white disc for the player start at
column 1 row 20 and a light green cross for the exit at column 38 row 1.
Rows 22 to 24 read, in white on black, with a green border:

PAL, `screenshots/seeded-level-fill.png`:

```
level 2  cs1 1731 regen 1731 cs2 d622
diff 000  objs ok    gen cyc 097643
pass
```

NTSC, `screenshots/seeded-level-fill-ntsc.png`: the same three rows with
`gen cyc 098417`.

Measured from those two screenshots with PIL (VICE x64sc 3.10): the
cell at column 1 row 20 is half white, the cell at column 38 row 1 is
light green on black, the cell at column 19 row 11 is yellow on black,
and the 880 field cells count 400 dirt-dominant, 290 wall-dominant and
190 black-dominant (empty cells and the sparse glyphs). The pinned
command gave byte-identical PNGs on two runs per model.

The verdict is `$02FF = 01` when level 1's two buffers differ in no
byte, its checksum equals its regenerated checksum, level 2's checksum
differs from it, and the fifteen listed objects sit in their cells; the
byte itself was not read out here, the border colour it is paired with
was.

## Why this works

The whole level is the table row. `generate()` sets the LFSR state from
the row's seed and steps it once per cell in a fixed order, so the
sequence of low bytes, and the tile each maps to, depend on nothing but
the seed. Running it twice into two buffers and comparing all 880 bytes
is the determinism test; the checksum on the screen is the same fact as
one number a test can read across runs. Level 2's seed and thresholds
give `D622` against level 1's `1731`, so a change of two bytes changes
the whole field. A seed of zero would leave the state at zero for ever
(`lfsr_zero_state_lockup`, `pitfalls/cpu.md`); the guard replaces it
before the first step. The level index is clamped to the last row rather
than read past the table.

The thresholds are cumulative on the low byte: with `wall = 40` about
40 in 256 cells are wall, `dirt = 160` makes the next 120 in 256 dirt,
`gem = 176` the next 16 gems, and the rest empty. Level 2's 64, 192 and
204 raise wall and dirt density and thin the gems, which is the
difficulty table moving; the census of the level 2 picture above is the
result, with the frame's 120 cells inside the wall count. The object
list runs last and writes over whatever the fill produced, so the start,
the exit and the guaranteed gems are exact and the check for them is a
five-cell compare per level.

The generation figure is one call of `generate()` under CIA1 timers A
and B chained (timer B counting timer A underflows), interrupts off,
screen on, so badline stalls are inside it: 97,643 cycles on PAL and
98,417 on NTSC, about 111 cycles per cell including the loop, the
compare chain and the frame test. That is about five PAL frames, a
level-start cost and not a per-frame one.
