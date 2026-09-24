---
recipe: sprite-mirror-at-load
toolchain: oscar64
output_format: PRG
region: both
techniques: [sprite_cache_flip, multi_sprite_object]
file_formats: [PRG]
uses_registers: [D000, D001, D002, D003, D004, D005, D006, D007, D008, D009, D00A, D00B, D010, D011, D015, D01C, D020, D021, D025, D026, D027, D028, D029, D02A, D02B, D02C, DC06, DC07, DC0F]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 sprite mirror at load: a multicolour frame set mirrored once, a three-sprite object that turns

## Synopsis

A multicolour frame set, two animation frames of a three-sprite object,
is stored facing right only. At load the program builds a 256-byte mirror
table that reverses the four bit pairs of a byte and keeps each pair
whole (`%aabbccdd` becomes `%ddccbbaa`), and mirrors all six blocks into
a resident left-facing set. The three sprite colours stay on the same
pixels; a plain 8-bit reverse would swap pairs 01 and 10. Each mirrored
block is checked pair by pair against its source read backwards. The
object turns round by choosing the other set and placing each part at
`-dx - width` from its anchor, the middle of the object, so it turns in
place. Object A turns every 16 frames on autopilot and its registers
are checked against a model each frame; then it holds facing right,
beside object B facing left across X 255. The screen prints the checks
and CIA1 timer B cycles for the table, one block, the whole set and one
placement each way. `$02FF` = `01` and a green border on a pass, `02` and
red otherwise (`headless-verify.md`). This is the "Mirror once at load"
variation of `sprite_cache_flip` and the "Facing" part of
`multi_sprite_object`, both in `docs/techniques/sprite.md`.

## Source

```c
// sprite-mirror-at-load.c
//
// A multicolour frame set stored facing right only, mirrored once at
// load into a resident left-facing set, and a three-sprite object that
// turns round by choosing the other set and mirrored part offsets.
// The mirror table keeps each bit pair whole (%aabbccdd -> %ddccbbaa),
// so the three sprite colours stay where they were. Every mirrored
// block is checked pixel by pixel against the source read backwards,
// and the drawn pairs a plain 8-bit reverse would recolour (01 and 10)
// are counted. Object A (sprites 0-2) turns every 16 frames on
// autopilot, its registers checked against a model each frame, then
// holds facing right; object B (sprites 3-5) faces left across X 255.
// Rows 2-8:
// counts and CIA1 timer B cycles. $02FF = 01 and a green border on a
// pass, 02 and red otherwise.
//
#include <c64/vic.h>
#include <c64/cia.h>

#define Screen  ((char *)0x0400)
#define Color   ((char *)0xd800)
#define SprData ((char *)0x3000)            // blocks 192..203
#define MFLIP   ((char *)0x3400)            // page-aligned mirror table
#define SPR_BLK 192
#define VR      ((volatile char *)0xd000)
#define PTR     ((volatile char *)0x07f8)
#define RESULT  (*(volatile char *)0x02ff)

#define PARTS   3
#define FRAMES  2
#define BLOCKS  (PARTS * FRAMES)            // right-facing blocks 0..5
#define LEFT    BLOCKS                      // left-facing set starts here

// Part offsets from the anchor, the middle of the object, facing right.
const signed char part_dx[PARTS] = { -36, -12, 12 };
#define PART_W 24

// --- the mirror table: bit pairs reversed, each pair kept whole ----------
void mflip_build(void)
{
    char i = 0;
    do {
        MFLIP[i] = (i << 6) | ((i << 2) & 0x30) | ((i >> 2) & 0x0c) | (i >> 6);
        i++;
    } while (i != 0);
}

// One 63-byte block, right to left: bytes swapped, each through the table.
void mirror_block(const char *s, char *d)
{
    for (char r = 0; r < 63; r += 3) {
        d[r]     = MFLIP[s[r + 2]];
        d[r + 1] = MFLIP[s[r + 1]];
        d[r + 2] = MFLIP[s[r]];
    }
}

void mirror_set(void)
{
    for (char b = 0; b < BLOCKS; b++)
        mirror_block(SprData + b * 64, SprData + (LEFT + b) * 64);
}

// --- placing the object ---------------------------------------------------
// Facing left, part i sits at -dx - width from the anchor and shows the
// mirrored block, so the object turns in place about its anchor.
void place(char s0, int ax, char ay, char left, char frame)
{
    char msb = VR[0x10] & ~(7 << s0), bit = 1 << s0;
    for (char i = 0; i < PARTS; i++) {
        int x = left ? ax - part_dx[i] - PART_W : ax + part_dx[i];
        char s = s0 + i;
        VR[s * 2] = (char)x;
        VR[s * 2 + 1] = ay;
        if (x & 0x100)
            msb |= bit;
        PTR[s] = SPR_BLK + (left ? LEFT : 0) + frame * PARTS + i;
        bit <<= 1;
    }
    VR[0x10] = msb;
}

// --- the frame set: asymmetric shapes using all three colours -------------
char pair_at(const char *blk, char r, char c)      // c = 0..11, left to right
{
    char b = blk[r * 3 + (c >> 2)];
    return (b >> (6 - 2 * (c & 3))) & 3;
}

void make_frames(void)
{
    for (char f = 0; f < FRAMES; f++)
        for (char p = 0; p < PARTS; p++) {
            char *blk = SprData + (f * PARTS + p) * 64;
            for (char r = 0; r < 21; r++)
                for (char k = 0; k < 3; k++) {
                    char v = 0;
                    for (char q = 0; q < 4; q++) {
                        char c = k * 4 + q, pr = 0;
                        if (c <= (r + f * 3 + p * 2) % 12)      // a ramp: wide on one side
                            pr = 1 + (c + r / 4 + p) % 3;
                        v = (v << 2) | pr;
                    }
                    blk[r * 3 + k] = v;
                }
        }
}

// --- checks -------------------------------------------------------------------
unsigned mirror_errors, recoloured, drawn;

void check_set(void)
{
    mirror_errors = 0;
    recoloured = 0;
    drawn = 0;
    for (char b = 0; b < BLOCKS; b++) {
        const char *s = SprData + b * 64, *d = SprData + (LEFT + b) * 64;
        for (char r = 0; r < 21; r++)
            for (char c = 0; c < 12; c++) {
                char a = pair_at(s, r, c);
                if (pair_at(d, r, 11 - c) != a)
                    mirror_errors++;
                if (a)
                    drawn++;
                if (a == 1 || a == 2)       // a plain bit reverse swaps these
                    recoloured++;
            }
    }
}

// Every register of object at s0 against the model.
char check_obj(char s0, int ax, char ay, char left, char frame)
{
    char bad = 0, d010 = VR[0x10];
    for (char i = 0; i < PARTS; i++) {
        char s = s0 + i;
        int want = left ? ax - (part_dx[i] + PART_W) : ax + part_dx[i];
        int got = VR[s * 2] + ((d010 & (1 << s)) ? 256 : 0);
        if (got != want || VR[s * 2 + 1] != ay)
            bad = 1;
        if (PTR[s] != SPR_BLK + frame * PARTS + i + (left ? BLOCKS : 0))
            bad = 1;
    }
    return bad;
}

// --- CIA1 timer B -----------------------------------------------------------
static inline void timer_start(void)
{
    cia1.crb = 0x00;
    cia1.tb = 0xffff;
    cia1.crb = 0x11;
}

static inline unsigned timer_stop(void)
{
    cia1.crb = 0x00;
    return 0xffff - cia1.tb;
}

__noinline void nothing(void) { }
__noinline void one_block(void) { mirror_block(SprData, SprData + LEFT * 64); }
__noinline void place_right(void) { place(0, 100, 150, 0, 0); }
__noinline void place_left(void) { place(0, 100, 150, 1, 0); }

unsigned time1(void (*fn)(void))
{
    __asm { sei }
    timer_start();
    fn();
    unsigned t = timer_stop();
    __asm { cli }
    return t;
}

// --- text (screen codes) -----------------------------------------------------
void put_str(char *p, const char *s)
{
    while (*s)
        *p++ = *s++;
}

void put_dec(char *p, unsigned v, char digits)
{
    for (char i = digits; i > 0; i--) {
        p[i - 1] = 0x30 + v % 10;
        v /= 10;
    }
}

#define AX_A 100
#define AX_B 280
#define AY   150
#define TURN_EVERY 16
#define TURN_FRAMES 128

int main(void)
{
    vic.color_border = 0;
    vic.color_back = 0;
    for (unsigned i = 0; i < 1000; i++) {
        Screen[i] = 0x20;
        Color[i] = 1;
    }
    make_frames();

    // At load, screen blanked: build the table, mirror the set, time both.
    vic.ctrl1 &= ~VIC_CTRL1_DEN;
    vic_waitFrame();
    unsigned t_none = time1(nothing);
    unsigned t_table = time1(mflip_build) - t_none;
    unsigned t_set = time1(mirror_set) - t_none;
    unsigned t_block = time1(one_block) - t_none;
    unsigned t_pr = time1(place_right) - t_none;
    unsigned t_pl = time1(place_left) - t_none;
    vic.ctrl1 |= VIC_CTRL1_DEN;
    check_set();

    vic.spr_multi = 0x3f;
    vic.spr_mcolor0 = VCOL_WHITE;           // pair 01
    vic.spr_mcolor1 = VCOL_YELLOW;          // pair 11
    for (char s = 0; s < 6; s++)
        vic.spr_color[s] = VCOL_RED;        // pair 10
    vic.spr_enable = 0x3f;
    VR[0x10] = 0;

    put_str(Screen + 0,      s"sprite mirror at load");
    put_str(Screen + 2 * 40, s"blocks mirrored     errors");
    put_dec(Screen + 2 * 40 + 16, BLOCKS, 2);
    put_dec(Screen + 2 * 40 + 27, mirror_errors, 5);
    put_str(Screen + 3 * 40, s"drawn pairs       01 or 10");
    put_dec(Screen + 3 * 40 + 12, drawn, 4);
    put_dec(Screen + 3 * 40 + 27, recoloured, 4);
    put_str(Screen + 4 * 40, s"table build");
    put_dec(Screen + 4 * 40 + 22, t_table, 5);
    put_str(Screen + 5 * 40, s"mirror one block");
    put_dec(Screen + 5 * 40 + 22, t_block, 5);
    put_str(Screen + 6 * 40, s"mirror the set");
    put_dec(Screen + 6 * 40 + 22, t_set, 5);
    put_str(Screen + 7 * 40, s"place right       left");
    put_dec(Screen + 7 * 40 + 12, t_pr, 3);
    put_dec(Screen + 7 * 40 + 23, t_pl, 3);
    put_str(Screen + 8 * 40, s"turns       mismatches");

    // Object A turns every 16 frames; B faces left throughout.
    char left = 0, fault = 0;
    unsigned turns = 0, mism = 0;
    for (unsigned t = 0; t < TURN_FRAMES; t++) {
        vic_waitFrame();
        char frame = (t >> 3) & 1;
        if (t && (t % TURN_EVERY) == 0) {
            left ^= 1;
            turns++;
        }
        place(0, AX_A, AY, left, frame);
        place(3, AX_B, AY, 1, frame);
        if (check_obj(0, AX_A, AY, left, frame) || check_obj(3, AX_B, AY, 1, frame))
            mism++;
    }
    vic_waitFrame();                        // hold: A right, B left, frame 0
    place(0, AX_A, AY, 0, 0);
    place(3, AX_B, AY, 1, 0);
    if (check_obj(0, AX_A, AY, 0, 0) || check_obj(3, AX_B, AY, 1, 0))
        mism++;
    put_dec(Screen + 8 * 40 + 6, turns, 3);
    put_dec(Screen + 8 * 40 + 23, mism, 5);

    if (mirror_errors) fault = 1;
    if (mism) fault = 2;
    if (turns != TURN_FRAMES / TURN_EVERY - 1) fault = 3;
    RESULT = fault ? 2 : 1;
    vic.color_border = fault ? 2 : 5;
    put_str(Screen + 40, fault ? s"result fail" : s"result pass");
    Screen[40 + 12] = 0x30 + fault;

    for (;;)
        ;
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=sprite-mirror-at-load.prg sprite-mirror-at-load.c
```

Produces `sprite-mirror-at-load.prg`, 2,641 bytes. The frames are built
at run time at `$3000` (blocks 192 to 197, right-facing), the mirrored
set follows (blocks 198 to 203), and the table is at `$3400`, page
aligned. Then run headless in VICE (PAL):

```bash
GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas x64sc -default -warp +sound \
  +autostart-delay-random -autostartprgmode 1 -limitcycles 8000000 \
  -exitscreenshot sprite-mirror-at-load.png -autostart sprite-mirror-at-load.prg
```

Add `-model ntsc` for the NTSC picture.

## Expected output

Measured in VICE x64sc 3.10 with the pinned command, text decoded
against the character ROM (rows 0 to 8, PAL):

```text
SPRITE MIRROR AT LOAD
RESULT PASS 0
BLOCKS MIRRORED 06  ERRORS 00000
DRAWN PAIRS 0843  01 OR 10 0562
TABLE BUILD           15624
MIRROR ONE BLOCK      01575
MIRROR THE SET        09658
PLACE RIGHT 417   LEFT 460
TURNS 007   MISMATCHES 00000
```

NTSC reads the same. The border is palette index 5, (98, 213, 50) on
PAL and (114, 189, 103) on NTSC.

What the numbers say:

- `ERRORS 00000`: every one of the 6 x 21 x 12 bit pairs of the
  left-facing set equals the pair at the mirrored column of its source.
- `DRAWN PAIRS 0843  01 OR 10 0562`: of the 843 drawn pairs, 562 are
  01 or 10. A plain bit-reverse table reverses the two bits inside each
  pair too, so it would have swapped the white and red of those 562 and
  left the 281 yellow ones alone: the shape mirrored and two thirds of
  its colour wrong (arithmetic from the bit patterns;
  `kickassembler/sprite-cache-flip` measured the same fault with the
  hires table forced).
- `TURNS 007   MISMATCHES 00000`: in 128 frames object A turned seven
  times and stepped its animation every 8 frames, and each frame every
  part's X, `$D010` bit, Y and pointer matched the model, for A and B.
- The cycle figures are CIA1 timer B, interrupts masked, screen blanked,
  one call each less an empty call, the same on PAL and NTSC. Building
  the table is 15,624 cycles, once. Mirroring one 63-byte block is 1,575
  and the whole six-block set 9,658, once, at load; after that a turn
  costs no mirroring at all. Placing the three parts is 417 cycles facing
  right and 460 facing left (the subtraction in `-dx - width`), compiled
  C. The block figure moved by 20 cycles between two builds of this
  listing as the code shifted: the table is page aligned, the frames
  are not tied to the code, so the figure depends on where the compiler
  puts the loop.

The picture: `screenshots/sprite-mirror-at-load.png` (PAL) and
`screenshots/sprite-mirror-at-load-ntsc.png` (NTSC), the hold. Object A
(anchor X 100) covers columns 72 to 143, object B (anchor X 280, parts at
X 244, 268 and 292) columns 252 to 323, both lines 151 to 171. Measured
with PIL on both models: every one of A's 1,512 pixels has the colour a
Python model of frame 0 gives it (pair 01 white, 10 red, 11 yellow, 00
background), and every pixel of B equals A's pixel at the mirrored
column (column 323 − k against 72 + k), 0 mismatches of 1,512. Each
object has 274 pixels of each colour. The columns either side of both
objects and the lines above and below are background, 372 of 372.

## Why this works

A multicolour sprite pixel is a bit pair, four to a byte, leftmost in
bits 7 and 6. Mirroring a row reverses the order of its twelve pairs:
the three bytes in reverse order, and inside each byte the four pairs in
reverse order with each pair's own two bits kept. `mflip_build` computes
that for every byte value once, so a row is three table lookups. A table
that reverses all eight bits would also turn each pair round, and 01
(`$D025`) and 10 (the sprite's own colour) change places; 00 and 11 do
not, which is why that mistake shows as a recolour, not a broken shape.

Mirroring at load trades RAM for time. The left-facing set costs one
more 64-byte block per frame, 384 bytes here, inside the VIC bank; in
return a turn is only a change of pointers and offsets. A cache that
mirrors on demand (`sprite_cache_flip`) stores one set and pays a fill
of 2,100 to 2,700 cycles per part on each miss, as measured in
`kickassembler/sprite-cache-flip`; a three-sprite object that turns
needs three fills in one frame. Mirror at load when the frame set fits
the bank twice; cache when it does not.

The parts turn about the anchor. Facing right, part i is at
`ax + dx[i]`; facing left, at `ax - dx[i] - 24`. With offsets -36, -12
and 12 the three parts cover `ax - 36` to `ax + 36` either way, so the
object turns in place, and the part that was on the left moves to the
right with its image mirrored. Part 2 of object B is at X 244 while its
anchor is at 280: each part's ninth X bit comes from its own sum, as
`multi_sprite_object` requires.

Verified: compiled with Oscar64, run headless in VICE x64sc 3.10 with
the pinned command on PAL and NTSC; the text was decoded against the
character ROM and both objects measured pixel by pixel with PIL, not by
eye.
