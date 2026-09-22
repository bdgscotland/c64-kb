---
recipe: fixed-point-jump-velocity
toolchain: oscar64
output_format: PRG
region: both
techniques: [fixed_point_8_8, jump_arc_table]
file_formats: [PRG]
uses_registers: [D000, D001, D002, D003, D010, D015, D017, D01C, D01D, D020, D021, D027, D028]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 fixed-point jump from any height

## Synopsis

Two hardware sprites jump from floors of different height, both driven
by one table of per-frame velocities in 8.8 fixed point. The table is
independent of where the jump starts: each frame `y += vy_tab[n]`, and
the caller decides what a landing is. That is the form a platformer
needs, because `fixed-point-jump.md` holds absolute Y from one fixed
ground and cannot be used from a platform. Row 24 shows the frame
counter and each jumper's `y` and `vy`; `$02FF` holds `01` once both
have landed and every landing was exact, `02` if any landing overshot
its floor, and the border turns green or red to match.

## Source

```c
// fixed-point-jump-velocity.c -- two sprites jump from floors of different
// height using one per-frame velocity table in 8.8. Row 24 shows the frame
// counter and each jumper's y and vy; $02FF and the border report whether
// every landing was exact.
// Build: oscar64 -tm=c64 -O2 -o=fixed-point-jump-velocity.prg fixed-point-jump-velocity.c
#include <c64/vic.h>
#include <c64/sprites.h>

#define SCREEN  ((char *)0x0400)
#define COLOUR  ((char *)0xd800)
#define SPRDATA ((char *)0x0340)      // block 13, the cassette buffer
#define HUD     (SCREEN + 24 * 40)    // bottom row: written after the beam has drawn it
#define RESULT  (*(volatile char *)0x02ff)

#define PERIOD  52                    // updates from launch to landing, from gen.py

// Per-frame velocity in 8.8, + is down, from gen.py with V0 = -$0380,
// G = +$0024 and VTERM = +$0210. Entry n is added to y on update n + 1.
static const int vy_tab[PERIOD] = {
      -860,   -824,   -788,   -752,   -716,   -680,   -644,   -608,
      -572,   -536,   -500,   -464,   -428,   -392,   -356,   -320,
      -284,   -248,   -212,   -176,   -140,   -104,    -68,    -32,
         4,     40,     76,    112,    148,    184,    220,    256,
       292,    328,    364,    400,    436,    472,    508,    528,
       528,    528,    528,    528,    528,    528,    528,    528,
       528,    528,    528,    528
};

struct Jumper
{
    char     x;          // sprite X register
    char     floor;      // sprite Y register when standing on its floor
    char     n;          // next table entry; 0 = standing, about to launch
    unsigned y_fp;       // 8.8 position, high byte is the sprite Y register
    int      vy;         // velocity used on the last update, for the HUD
    char     landings;   // landings so far
    char     wait;       // frames to hold on the floor before the first launch
};

static struct Jumper jumper[2] = {
    { 100, 213, 0, 213 << 8, 0, 0, 0 },   // A: the ground, char row 23
    { 220, 149, 0, 149 << 8, 0, 0, 26 }   // B: a platform on char row 15, launched half a period later
};

static void put_dec(char col, unsigned v, char width)
{
    char *p = HUD + col;
    for (signed char k = width - 1; k >= 0; k--) { p[k] = 0x30 + v % 10; v /= 10; }
}

// 8.8 value as integer.fraction, the fraction being the raw low byte 0..255.
static void put_fp(char col, unsigned v)
{
    put_dec(col, v >> 8, 3);
    HUD[col + 3] = 0x2e;
    put_dec(col + 4, v & 0xff, 3);
}

// Signed 8.8 velocity as sign, integer, fraction byte.
static void put_vel(char col, int v)
{
    unsigned m = v < 0 ? -v : v;
    HUD[col] = v < 0 ? 0x2d : 0x2b;
    HUD[col + 1] = 0x30 + (m >> 8);
    HUD[col + 2] = 0x2e;
    put_dec(col + 3, m & 0xff, 3);
}

static void put_floor(char row, char col0, char col1)
{
    for (char c = col0; c <= col1; c++) { SCREEN[row * 40 + c] = 0xa0; COLOUR[row * 40 + c] = 12; }
}

int main(void)
{
    for (unsigned i = 0; i < 1000; i++) { SCREEN[i] = 0x20; COLOUR[i] = 1; }
    for (char i = 0; i < 63; i++) SPRDATA[i] = 0xff;     // solid 24x21 block
    vic.color_back = 0;
    vic.color_border = 0;
    put_floor(23, 0, 39);          // ground under A
    put_floor(15, 22, 29);         // platform under B

    spr_init(SCREEN);
    spr_set(0, true, jumper[0].x, jumper[0].floor, 13, VCOL_YELLOW, false, false, false);
    spr_set(1, true, jumper[1].x, jumper[1].floor, 13, VCOL_LT_BLUE, false, false, false);

    HUD[0] = 6; HUD[7] = 1; HUD[24] = 2;                 // f, a, b labels

    unsigned frame = 0;
    char     failed = 0;

    // Landing is the caller's job: the table only supplies vy.
    for (;;)
    {
        vic_waitFrame();

        for (char j = 0; j < 2; j++)
        {
            struct Jumper *p = &jumper[j];
            unsigned floor_fp = (unsigned)p->floor << 8;

            if (p->wait) { p->wait--; continue; }
            p->vy    = vy_tab[p->n];
            p->y_fp += p->vy;
            p->n++;
            if (p->y_fp >= floor_fp)                 // reached or passed the floor
            {
                if (p->y_fp != floor_fp) failed = 1; // overshoot: the table's sum is not zero
                p->y_fp = floor_fp;
                p->n = 0;
                if (p->landings < 255) p->landings++;
                if (failed)
                    { RESULT = 2; vic.color_border = 2; }
                else if (jumper[0].landings && jumper[1].landings)
                    { RESULT = 1; vic.color_border = 5; }
            }
            spr_move(j, p->x, p->y_fp >> 8);
        }

        put_dec(2, frame, 4);
        put_fp(9, jumper[0].y_fp);  put_vel(17, jumper[0].vy);
        put_fp(26, jumper[1].y_fp); put_vel(34, jumper[1].vy);
        frame++;
    }
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=fixed-point-jump-velocity.prg fixed-point-jump-velocity.c
```

Produces `fixed-point-jump-velocity.prg` (1,232 bytes including the
BASIC stub), with no warnings. Load with
`LOAD"FIXED-POINT-JUMP-VELOCITY",8,1 : RUN` or via VICE autostart.

`vy_tab[]` is generated off-line by `gen.py`, which runs the same update
the loop runs and stops at the first update whose position sum reaches
the floor. It prints the period, the landing remainder and the table:

```text
# gen.py -- per-frame velocity table for fixed-point-jump-velocity.c
# 8.8 fixed point: 256 units = 1 pixel. + is down. Semi-implicit Euler:
# each frame v += G, clamp to VTERM, then y += v. Entry n is the v used
# on update n+1 (the first update after launch reads entry 0).
V0    = -0x0380     # -3.5 px/frame        = -896
G     =  0x0024     # +0.140625 px/frame^2 =   36
VTERM =  0x0210     # +2.0625 px/frame     =  528
v, y, tab = V0, 0, []
while True:
    v = min(v + G, VTERM)
    tab.append(v)
    y += v
    if y >= 0:
        break
print("PERIOD", len(tab), "landing remainder", y, "(0 = exact)")
for i in range(0, len(tab), 8):
    print("    " + ", ".join("%6d" % x for x in tab[i:i+8]) + ",")
```

Output: `PERIOD 52 landing remainder 0 (0 = exact)` and the 52 entries in
the listing. The arithmetic: entry `n` is `V0 + (n + 1) * G` until that
passes `VTERM`, so entry 0 is `-896 + 36 = -860` and entry 23 is
`-896 + 24 * 36 = -32`; entry 38 would be `-896 + 39 * 36 = 508` and
entry 39 would be 544, above 528, so entries 39 to 51 are the terminal
528. The position sum of the 39 ramp entries is `39 * (-860 + 508) / 2 =
-6864`, and 13 terminal entries add `13 * 528 = 6864`, so the sum is 0
at update 52 and the landing is exact. The apex is the most negative
running sum, after entry 23: `24 * (-860 - 32) / 2 = -10704`, which is
41.81 pixels above the floor.

The constants were chosen for that zero. The pair the issue suggested,
`-3.5` and `+0.15625` (`$28`), passes the floor by 8 to 744 units
(1/32 to 2.9 pixels) for every terminal velocity from 1.5 to 4.0 in
steps of 1/32 (checked in Python, not on the 6510); a landing that is
not exact needs the clamp, and then the result byte would never read
`01`. Change any of the three constants
and rerun `gen.py` until the remainder is 0, or accept the clamp and
drop the exactness check.

## Expected output

Black screen, black border until the first landing after both have
jumped, then green. A grey ground across char row 23 and a grey
platform on char row 15, columns 22 to 29. A yellow 24x21 sprite at
X 100 jumps from the ground (standing Y register 213) and a light blue
one at X 220 jumps from the platform (standing Y 149); the blue one
launches 26 frames later, so the two are half a period apart. Row 24
reads `F nnnn A yyy.fff svy.fff B yyy.fff svy.fff`: the frame counter,
then for each jumper the position as integer and raw fraction byte (0
to 255, so `.128` is one half) and the velocity as sign, integer and
fraction byte. The border goes red and `$02FF` reads `02` only if a
landing overshoots its floor; neither pinned run did that.

Pinned runs (VICE x64sc 3.10, `-warp +sound +autostart-delay-random
-autostartprgmode 1 -limitcycles 8000000`), pictures in
`screenshots/fixed-point-jump-velocity.png` and
`screenshots/fixed-point-jump-velocity-ntsc.png`, decoded with the
character ROM and measured with PIL. Each command was run twice and the
two PNGs were byte-identical.

| | PAL | NTSC (`-model ntsc`) |
|---|---|---|
| Row 24 text | `F 0251 A 196.128 +2.016 B 110.012 -0.248` | `F 0283 A 171.048 -0.032 B 144.224 +2.016` |
| A: updates since launch, entry just added | 44, 528 (terminal) | 24, -32 |
| B: updates since launch, entry just added | 18, -248 | 50, 528 (terminal) |
| Sprite A rows in the PNG | 181 to 201 | 144 to 164 |
| Sprite B rows in the PNG | 95 to 115 | 117 to 137 |
| Sprite Y from the PNG (first row is line Y + 1) | A 196, B 110 | A 171, B 144 |
| Landings before the picture | A 4, B 4 | A 5, B 4 |
| Border pixel (2,100) | (98, 213, 50), green | (114, 189, 103), green |

The text and the sprites describe the same frame in both pictures: the
row is written after the update that moved the sprites, and the row is
the last one the beam draws. Running the loop in Python for 252 updates
(PAL, `F 0251`) and 284 (NTSC) gives the same four position and
velocity values as the pictures.

Verdict trace (`-moncommands` with `trace store 02ff` and
`command 1 "m 02ff 02ff"`, the route in `runtime/vice-reference.md`):
PAL logged `00` from the KERNAL reset and then `01` seven times, NTSC
`00` and then `01` eight times, one per landing after the first one
that had both jumpers down. No `02` in either log.

## Why this works

The table holds velocity, not position, so the origin is the caller's:
`y_fp += vy_tab[n]` from any starting `y_fp`, and the apex, the period
and the landing speed are the same from the ground and from the
platform. The sum of the table is zero, so a sprite that starts on a
floor is back on it exactly after `PERIOD` updates. The loop checks
that with `y_fp != floor_fp` on the landing update and reports through
`$02FF` and the border; with these constants the clamp that follows
never changes the value. A game keeps the check out and the clamp in,
because a moving platform or a floor under a falling sprite will not be
where the sum lands. The terminal velocity is in the table as a run of
equal entries; a longer fall than the table just holds the last entry,
which is the one thing this recipe does not exercise.

`y_fp` is `unsigned` so that `213 << 8` does not wrap negative as it
would in an `int`; adding the signed `vy` to it is a two's-complement
add and the compare against `floor_fp` stays unsigned. Oscar64 keeps
both in 16 bits; the update is one indexed 16-bit load from `vy_tab[]`
and one 16-bit add, every operand indexed through the `jumper[]` array,
so the `fixed_point_8_8` figure in `techniques/maths.md` (two adds on
absolute operands) is a floor, not this loop's cost (not measured here).

The HUD is on row 24, not row 0. The mismatch was measured and the
reason is inferred. A first build wrote the same text to row 0; on PAL
the picture agreed with itself, but on NTSC sprite B was one update
ahead of the text (the row said `150.208`, the PNG put the sprite at
152). `vic_waitFrame()` returns at raster line 256, and the 24 digits
on the row (22 of them through a divide-by-ten loop) take longer than
the 7 lines to the end of an NTSC frame plus the 51 to the top of the
text area, so the beam drew row 0 before the new text was in it. The
bottom row is drawn last, so the text there always describes the frame
that is on screen.
