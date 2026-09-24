---
recipe: pinball-ball
toolchain: oscar64
output_format: PRG
region: both
techniques: [pinball_ball_physics]
file_formats: [PRG]
uses_registers: [D020, D021, DC04, DC05, DC06, DC07, DC0E, DC0F]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 pinball ball: gravity, reflection about a cell normal, and substeps against tunnelling

## Synopsis

A ball moves over a collision map of one kind byte per text cell. Each
solid kind has a unit normal. Position and velocity are 12.4 fixed-point
pixels. Every frame adds gravity and then moves the ball in 1, 2, 4 or 8
substeps, as many as keep each substep to 4 pixels or less. A substep
that would enter a solid cell leaves the ball where it was and reflects
its velocity about that cell's normal with restitution 0.75. Three tests
run on one screen and leave trails: a drop onto a floor (three bounce
apexes), a drop onto a 45-degree slope (the ball leaves to the right),
and a 12 px/frame shot at a wall one cell thick, once with one step per
frame and once with substeps. CIA1 timers A and B time every frame of
the update. `$02FF` holds `01` and the border is green when each apex is
40 to 70 per cent of the one before, the slope turns at least 80 per
cent of the fall into sideways speed, the one-step shot crosses the wall
and the substepped one does not; else `02` and red. It implements
`pinball_ball_physics` (`techniques/logic.md`) and measures
`ball_tunnels_thin_wall` (`pitfalls/logic.md`).

## Source

```c
// pinball-ball.c
// A pinball ball on a collision map. The map is one kind byte per text
// cell; each solid kind has a unit normal (64 = 1.0). Position and
// velocity are 12.4 fixed point pixels. Each frame adds gravity, then
// moves the ball in 1, 2, 4 or 8 substeps chosen so that no substep is
// longer than 4 pixels. A substep that would enter a solid cell leaves
// the ball where it was and reflects the velocity about that cell's
// normal: v -= (1 + e) (v.n) n, e = 0.75, tangential part kept.
// Three tests run on one screen, each leaving a trail of cells:
//   A (cyan)   a drop onto a floor: three bounce apexes, each lower
//   B (yellow) a drop onto a 45-degree slope: the ball leaves to the right
//   C          a 12 px/frame shot at a wall one cell (8 px) thick, twice:
//              red lane in one step per frame, green lane with substeps.
// CIA1 timers A and B time every frame of the update: one at 1 and one
// at 4 substeps without contact, and the worst frame of tests A and C. $02FF holds 01 and the border is green when the apexes fall
// by a ratio near e*e, the slope sends the ball right, the one-step lane
// crosses the wall and the substepped lane does not; else 02 and red.
#include <c64/vic.h>
#include <c64/cia.h>

#define SCREEN ((char *)0x0400)
#define COLOUR ((char *)0xd800)
#define RESULT (*(volatile char *)0x02ff)

enum Kind { K_EMPTY, K_FLOOR, K_CEIL, K_LWALL, K_RWALL, K_SLOPE_DR, K_SLOPE_DL };

// Unit normals, x then y, screen y downward, 64 = 1.0.
static const signed char norm_x[7] = { 0, 0, 0, 64, -64, 45, -45 };
static const signed char norm_y[7] = { 0, -64, 64, 0, 0, -45, -45 };
static const char kind_char[7] = { 0x20, 0xa0, 0xa0, 0xa0, 0xa0, 0x4d, 0x4e };

#define E256 192            // restitution e = 0.75, as a fraction of 256
#define GRAVITY 4           // 0.25 px per frame per frame, in 1/16 px

char map[25][40];

struct Ball
{
    int x, y;               // 1/16 px
    int vx, vy;             // 1/16 px per frame
    char gravity;
    char force1;            // 1: one step per frame whatever the speed
};

static char cell_kind(int x, int y)
{
    if (x < 0 || y < 0)
        return K_FLOOR;
    char cx = (char)((unsigned)x >> 7), cy = (char)((unsigned)y >> 7);
    if (cx >= 40 || cy >= 25)
        return K_FLOOR;
    return map[cy][cx];
}

static void reflect(struct Ball *b, char k)
{
    int nx = norm_x[k], ny = norm_y[k];
    // v.n with n scaled by 64: 32-bit products, shifts in place of divides.
    int vn = (int)(((long)b->vx * nx + (long)b->vy * ny) >> 6);
    if (vn >= 0)
        return;                           // already leaving the surface
    int j = (int)(((long)vn * (256 + E256)) >> 8);   // (1 + e) (v.n)
    b->vx -= (int)(((long)j * nx) >> 6);
    b->vy -= (int)(((long)j * ny) >> 6);
}

static int iabs(int v) { return v < 0 ? -v : v; }

// One frame: gravity, then substeps of at most 4 px (64 units).
__noinline char step_frame(struct Ball *b)
{
    if (b->gravity)
        b->vy += GRAVITY;
    int m = iabs(b->vx) > iabs(b->vy) ? iabs(b->vx) : iabs(b->vy);
    char shift = 0;
    if (!b->force1)
        while ((m >> shift) > 64 && shift < 3)
            shift++;
    char n = 1 << shift;
    int dx = b->vx >> shift, dy = b->vy >> shift;
    for (char i = 0; i < n; i++)
    {
        int nx = b->x + dx;
        int ny = b->y + dy;
        char k = cell_kind(nx, ny);
        if (k != K_EMPTY)
        {
            reflect(b, k);                // the rest of the frame uses the new velocity
            dx = b->vx >> shift;
            dy = b->vy >> shift;
        }
        else
        {
            b->x = nx;
            b->y = ny;
        }
    }
    return n;
}

static void box(char c0, char c1, char r0, char r1)
{
    for (char c = c0; c <= c1; c++)
    {
        map[r0][c] = K_CEIL;
        map[r1][c] = K_FLOOR;
    }
    for (char r = r0 + 1; r < r1; r++)
    {
        map[r][c0] = K_LWALL;
        map[r][c1] = K_RWALL;
    }
}

static void mark(const struct Ball *b, char colour)
{
    unsigned o = (unsigned)(b->y >> 7) * 40 + (b->x >> 7);
    if (o < 1000 && SCREEN[o] == 0x20)
    {
        SCREEN[o] = 0x2e;
        COLOUR[o] = colour;
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

static void put_dec(char row, char col, unsigned long v, char width)
{
    char *p = SCREEN + 40 * row + col + width;
    do
    {
        *--p = '0' + (char)(v % 10);
        v /= 10;
    } while (--width);
}

static void timer_start(void)
{
    cia1.cra = 0x00;
    cia1.crb = 0x00;
    cia1.ta = 0xffff;
    cia1.tb = 0xffff;
    cia1.crb = 0x51;
    cia1.cra = 0x11;
}

static unsigned long timer_stop(void)
{
    cia1.cra = 0x00;
    cia1.crb = 0x00;
    return ((unsigned long)(0xffff - cia1.tb) << 16) + (0xffff - cia1.ta);
}

// One frame of one ball under CIA1 timers A and B, interrupts off.
static unsigned long timed_step(struct Ball *b)
{
    timer_start();
    step_frame(b);
    return timer_stop();
}

int main(void)
{
    __asm { sei }
    vic.color_back = VCOL_BLACK;
    vic.color_border = VCOL_BLACK;

    // The map: three boxes, a slope in B, a one-cell wall across C.
    for (char r = 0; r < 25; r++)
        for (char c = 0; c < 40; c++)
            map[r][c] = K_EMPTY;
    box(0, 12, 0, 19);
    box(13, 26, 0, 19);
    box(27, 39, 0, 19);
    for (char i = 0; i < 7; i++)
        map[9 + i][15 + i] = K_SLOPE_DR;   // falls to the right
    for (char r = 1; r < 19; r++)
        map[r][35] = K_RWALL;              // the thin wall, x 280-287, faces left
    map[9][27] = K_FLOOR;                  // split C into two lanes
    for (char c = 28; c < 39; c++)
        map[9][c] = K_FLOOR;
    for (unsigned i = 0; i < 1000; i++)
    {
        char k = (&map[0][0])[i];
        SCREEN[i] = kind_char[k];
        COLOUR[i] = VCOL_MED_GREY;
    }

    // A: drop from y = 16 onto the floor at y = 152 (row 19).
    struct Ball a = { 6 * 128 + 64, 16 * 16, 0, 0, 1, 0 };
    unsigned apex[3];
    char na = 0;
    int prev_vy = 0;
    int top = a.y;
    unsigned long cyc1 = 0, worst_a = 0;
    for (unsigned f = 0; f < 400; f++)
    {
        unsigned long t = timed_step(&a);
        if (f == 20)
            cyc1 = t;                       // one substep, no contact
        if (t > worst_a)
            worst_a = t;
        mark(&a, VCOL_CYAN);
        if (a.y < top)
            top = a.y;
        if (prev_vy < 0 && a.vy >= 0 && f > 1 && na < 3)
            apex[na++] = (unsigned)(152 * 16 - top) / 16;
        if (a.vy > 0)
            top = 0x7fff;
        prev_vy = a.vy;
    }

    // B: drop onto the slope, starting above its third cell.
    struct Ball b = { 17 * 128 + 64, 16 * 16, 0, 0, 1, 0 };
    int vx_after = 0, vy_after = 0, vy_in = 0;
    for (unsigned f = 0; f < 150; f++)
    {
        int before = b.vx, before_vy = b.vy;
        step_frame(&b);
        if (before == 0 && b.vx != 0 && vx_after == 0)
        {
            vy_in = before_vy + GRAVITY;
            vx_after = b.vx;
            vy_after = b.vy;
        }
        mark(&b, VCOL_YELLOW);
    }

    // C: two shots at 12 px per frame from x = 228, no gravity.
    struct Ball c1 = { 228 * 16, 4 * 128 + 64, 12 * 16, 0, 0, 1 };
    struct Ball c2 = { 228 * 16, 14 * 128 + 64, 12 * 16, 0, 0, 0 };
    bool crossed1 = false, crossed2 = false;
    unsigned long cyc4 = 0, worst_c = 0;
    for (char f = 0; f < 12; f++)
    {
        step_frame(&c1);
        unsigned long t = timed_step(&c2);
        if (f == 2)
            cyc4 = t;                       // four substeps, no contact
        if (t > worst_c)
            worst_c = t;
        mark(&c1, VCOL_RED);
        mark(&c2, VCOL_GREEN);
        if ((c1.x >> 4) >= 288) crossed1 = true;
        if ((c2.x >> 4) >= 288) crossed2 = true;
    }

    bool apex_ok = na == 3 && apex[1] < apex[0] && apex[2] < apex[1]
                && apex[1] * 10 > apex[0] * 4 && apex[1] * 10 < apex[0] * 7
                && apex[2] * 10 > apex[1] * 4 && apex[2] * 10 < apex[1] * 7;
    // 45-degree slope, e = 0.75: out vx = 0.875 vy_in, out vy = 0.125 vy_in.
    bool slope_ok = vy_in > 0 && vx_after > 0 && vy_after >= 0
                 && vx_after * 10 > vy_in * 8 && vy_after * 10 < vy_in * 2;
    bool ok = apex_ok && slope_ok && crossed1 && !crossed2;

    put_str(20, 0, "a apex px");
    put_dec(20, 10, apex[0], 3);
    put_dec(20, 14, apex[1], 3);
    put_dec(20, 18, apex[2], 3);
    put_str(20, 22, "from 136");
    put_str(21, 0, "b slope in vy     out vx     vy");
    put_dec(21, 14, vy_in < 0 ? 0 : vy_in, 3);
    put_dec(21, 25, vx_after < 0 ? 0 : vx_after, 3);
    put_dec(21, 32, vy_after < 0 ? 0 : vy_after, 3);
    put_str(22, 0, "c crossed 1 step:");
    put_str(22, 18, crossed1 ? "yes" : "no ");
    put_str(22, 22, "substeps:");
    put_str(22, 32, crossed2 ? "yes" : "no ");
    put_str(23, 0, "cyc 1 step       4 steps");
    put_dec(23, 11, cyc1, 5);
    put_dec(23, 25, cyc4, 5);
    put_str(24, 10, "worst a       c");
    put_dec(24, 18, worst_a, 5);
    put_dec(24, 26, worst_c, 5);
    put_str(24, 0, ok ? "pass" : "fail");
    RESULT = ok ? 0x01 : 0x02;
    vic.color_border = ok ? VCOL_GREEN : VCOL_RED;
    for (;;)
        ;
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=pinball-ball.prg pinball-ball.c
```

Run headless (the tests finish in well under 8,000,000 cycles and the
screen holds):

```bash
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 -limitcycles 8000000 -exitscreenshot pinball-ball.png -autostart pinball-ball.prg
```

Add `-model ntsc` for the NTSC picture. The PRG is 3,897 bytes.

## Expected output

Three grey boxes fill rows 0 to 19. In the left box a cyan column of
dots marks the drop at column 6, rows 2 to 18. In the middle box a
diagonal of seven `\` cells runs from column 15 row 9 to column 21 row
15; a yellow trail falls down column 17 to row 10, leaves the slope to
the right and bounces about the lower right of the box. The right box
is split into two lanes by a floor at row 9, and a wall at column 35
crosses both. The red dots in the upper lane (row 4) are at columns 30,
31, 33, 34, 36 and 37: past the wall. The green dots in the lower lane
(row 14) are at columns 28 to 34: the ball reached the wall and came
back. Rows 20 to 24 are white on black, with a green border. PAL, `screenshots/pinball-ball.png`:

```
a apex px 079 048 028 from 136
b slope in vy 096 out vx 084 vy 013
c crossed 1 step: yes substeps: no
cyc 1 step 01131 4 steps 01553
pass      worst a 04650 c 04616
```

NTSC, `screenshots/pinball-ball-ntsc.png`: the same first three rows,
then `cyc 1 step 01131 4 steps 01682` and `worst a 04563 c 04615`. The
text was read with a PIL decoder against the character ROM and the trail
cells were listed by colour from both screenshots (VICE x64sc 3.10).

## Why this works

The reflection is `v -= (1 + e)(v.n) n`, applied only when `v.n` is
negative, that is when the ball is moving into the surface. The normal
part of the velocity is reversed and scaled by `e`; the part along the
surface is kept, which is what makes a slope turn a fall into a roll.
The slope figures check the arithmetic: a fall at 96/16 px per frame
onto a normal of (45, -45)/64 gives `v.n` = -68 after the shift,
`(1 + e)(v.n)` = -119, and so 84 sideways and 13 down, the numbers on
the screen. Ideal values with an exact normal are 0.875 and 0.125 of
the fall, 84 and 12. The apexes, 79, 48 and 28 pixels from a drop of
136, fall by 0.58, 0.61 and 0.58 against `e*e` = 0.5625. The ball
reflects up to one substep above the floor and the velocity is rounded
to 1/16 pixel; which of the two gives the excess was not isolated.

The one-step shot moves 12 pixels a frame from x = 228: 228, 240, 252,
264, 276, then 288. The wall is x = 280 to 287. No position the ball
stands on is inside it, so no test ever sees it and the ball is past it.
With substeps the speed of 192/16 needs four steps of 3 pixels, and the
step that would reach x = 279 + 3 = 282 lands in the wall and reflects.
A step no longer than the thinnest wall is the rule; this listing keeps
it to 4 pixels against 8-pixel walls.

Each solid kind has one normal, so a wall faces one way. The thin wall
is a right-hand wall, facing left, toward the shots. The tunnelled ball
bounces off the box's right side and meets the thin wall from behind,
where `v.n` is positive: no reflection, and the substep is refused, so
it stops against the wall's back face, at column 36 or 37. A wall that
can be hit from both sides needs a kind per face, or a normal chosen
from the side the ball came from.

The update is Oscar64 C with 32-bit products in the reflection. One
frame at one substep with no contact takes 1,131 cycles; at four
substeps 1,553 on PAL and 1,682 on NTSC (badline stalls differ, screen
on). The worst frame of the drop test is 4,650 on PAL
and 4,563 on NTSC, and of the substepped shot 4,616 and 4,615. An
earlier build of this listing divided the 32-bit products by 64 and 256
instead of shifting them and measured 10,856 cycles for its worst
frame; the shift is the change. An assembler update with 8-bit normals
and a multiply table would be several times cheaper (not measured
here).
