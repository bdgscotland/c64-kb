---
recipe: slope-collision
toolchain: oscar64
output_format: PRG
region: both
techniques: [slope_collision]
file_formats: [PRG]
uses_registers: [D000, D001, D010, D011, D015, D018, D020, D021, D027, DC06, DC07, DC0F]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 Slope Collision: 45-degree and 1-in-2 hills and a drop-through platform

## Synopsis

A sprite walks a character-map terrain under a scripted joystick byte:
flat ground, a 45-degree hill, a 1-in-2 hill (26.6 degrees) built from
two-cell halves, and a one-way platform it drops through with down + fire. Each
map cell is one attribute byte (ground, wall, drop-through, slope type in
bits 4 to 6), and a 64-byte height table gives the ground row inside a
cell for each of its eight pixel columns. The slope glyphs are generated
from the same table, so the picture and the collision cannot disagree.
Every grounded frame the program logs the foot row per foot column. At
the end it compares the log with a profile found a second way, by
scanning each map column from the top, and prints the largest error in
pixels, the sample counts and the CIA1 timer B cost of the update.
`$02FF` = `01` and a green border when the error is 0, every event was
seen and every phase ended at its scripted x; `02` and red otherwise.
This is the `slope_collision` technique in `docs/techniques/logic.md`;
the result-byte contract is `headless-verify.md`.

## Source

```c
// slope-collision.c
//
// Slope collision on a character map. Each map cell holds one attribute
// byte: ground, wall, drop-through and a slope type in bits 4-6. A
// height table gives the ground row inside the cell for each of its eight
// pixel columns. The terrain has flat ground, a 45-degree hill, a
// 1-in-2 hill built from two-cell halves and a drop-through
// platform, drawn with glyphs generated from the same table.
// One sprite walks right, then left, on a scripted joystick byte. It
// starts on the platform and drops through it with down + fire.
// Every grounded frame its foot row is logged per foot column; at the end
// the log is compared with a profile found by scanning each map column
// from the top, a second use of the tables by a different path.
// Row 0: foot x and y, slope type, state. Row 1: CIA1 timer B cycles of
// the update, worst and best frame. Row 2: samples per pass, largest
// error in pixels, result. $02FF = 01 and a green border on pass,
// 02 and red on fail.
// Build: oscar64 -tm=c64 -O2 -o=slope-collision.prg slope-collision.c
#include <c64/vic.h>
#include <c64/cia.h>
#include <c64/sprites.h>
#include <c64/memmap.h>
#include <string.h>

// Code and data below $3800; the charset copy sits at $3800-$3FFF.
#pragma region( main, 0x0a00, 0x3800, , , {code, data, bss, heap, stack} )

#define SCREEN   ((char *)0x0400)
#define COLOUR   ((char *)0xd800)
#define CHAR_ROM ((char *)0xd000)
#define FONT     ((char *)0x3800)          // $D018 = $1E: screen $0400, chars $3800
#define SPRDATA  ((char *)0x0340)          // sprite block 13, cassette buffer
#define RESULT   (*(volatile char *)0x02ff)

#define CODE_PASS 0x01
#define CODE_FAIL 0x02

// --- the attribute byte ---------------------------------------------------
#define A_GROUND 0x01                      // has a ground surface
#define A_WALL   0x02                      // blocks a sideways move
#define A_DROP   0x04                      // one-way: down + fire falls through
#define A_SLOPE  0x70                      // slope type 0-7, bits 4-6
#define SLOPE(t) ((t) << 4)

// Ground row inside a cell for pixel column 0-7, per slope type. 0 is
// the cell's top row, 7 its bottom row. Types 3 and 4 are the lower and
// upper halves of one 1-in-2 rise across two cells; 6 and 5 the
// same falling. Type 7 is unused.
const char heights[64] = {
    0, 0, 0, 0, 0, 0, 0, 0,                // 0 flat
    7, 6, 5, 4, 3, 2, 1, 0,                // 1 up 45, rising to the right
    0, 1, 2, 3, 4, 5, 6, 7,                // 2 down 45
    7, 7, 6, 6, 5, 5, 4, 4,                // 3 up 1-in-2, lower cell
    3, 3, 2, 2, 1, 1, 0, 0,                // 4 up 1-in-2, upper cell
    0, 0, 1, 1, 2, 2, 3, 3,                // 5 down 1-in-2, upper cell
    4, 4, 5, 5, 6, 6, 7, 7,                // 6 down 1-in-2, lower cell
    0, 0, 0, 0, 0, 0, 0, 0                 // 7 unused
};
#define HIDX(a, x) ((((a) & A_SLOPE) >> 1) | ((x) & 7))

// Screen rows 3-24. '.' air, '#' ground, 'W' wall, '=' drop-through
// platform, '/' and '\' 45-degree cells, 'a' 'b' a 1-in-2 rise
// (lower, upper), 'c' 'd' a 1-in-2 fall (upper, lower).
#define MAP_ROW0 3
const char map_text[22][41] = {
    "........................................",   //  3
    "........................................",   //  4
    "........................................",   //  5
    "........................................",   //  6
    "........................................",   //  7
    "WW...................................WWW",   //  8
    "WW...................................WWW",   //  9
    "WW...................................WWW",   // 10
    "WW...................................WWW",   // 11
    "WW...................................WWW",   // 12
    "WW...................................WWW",   // 13
    "WW...................................WWW",   // 14
    "WW...................................WWW",   // 15
    "WW========...........................WWW",   // 16
    "WW...................................WWW",   // 17
    "WW............/##\\...................WWW",   // 18
    "WW.........../####\\......ab#cd.......WWW",   // 19
    "WW........../######\\...ab#####cd.....WWW",   // 20
    "WW###################################WWW",   // 21
    "WW###################################WWW",   // 22
    "WW###################################WWW",   // 23
    "WW###################################WWW",   // 24
};

char map[25 * 40];                         // attribute bytes, screen layout
char *rowp[25];

// Glyphs: codes $80-$87 are the slope types, drawn from the height table;
// $88 is the wall and $89 the platform.
#define G_SLOPE 0x80
#define G_WALL  0x88
#define G_PLAT  0x89

// --- joystick bits (active low) and events ---------------------------------
#define JOY_UP    0x01
#define JOY_DOWN  0x02
#define JOY_LEFT  0x04
#define JOY_RIGHT 0x08
#define JOY_FIRE  0x10
#define JOY_MASK  0x1f

#define EV_DROP   0x01
#define EV_LAND   0x02
#define EV_WALLR  0x04
#define EV_WALLL  0x08
#define EV_ALL    0x0f

// --- the script ------------------------------------------------------------
struct Step { unsigned frames; char port; char pass; int exp_fx; };
const struct Step script[] = {
    { 10, 0xff,                        0,  24 },   // stand on the platform
    { 16, 0xff ^ JOY_RIGHT,            0,  40 },   // walk along it
    {  1, 0xff ^ JOY_DOWN ^ JOY_FIRE,  0,  40 },   // down + fire: drop
    { 30, 0xff,                        0,  40 },   // fall, land on the ground
    {265, 0xff ^ JOY_RIGHT,            0, 293 },   // both hills, to the wall
    {290, 0xff ^ JOY_LEFT,             1,  18 },   // back, under the platform
    { 20, 0xff,                        1,  18 },   // stand; verdict
};
#define STEPS (sizeof(script) / sizeof(script[0]))

// --- the actor ---------------------------------------------------------------
// fx is the foot column in world pixels (the sprite's column 12); the
// foot row fy is the ground row under the feet, one below the sprite's
// last row. Body: sprite columns 10-14, rows 0-20.
#define FOOT_COL  12
#define BODY_HALF 2
#define BODY_H    21
#define GRAVITY   0x0040                   // 8.8 pixels per frame per frame
#define MAX_FALL  0x0400                   // 4 px a frame, under one cell
#define MAX_RISE  2                        // steeper than this is a wall
#define MAX_SNAP  2                        // deeper than this is a fall

int      fx;
unsigned fy_fp;                            // 8.8
unsigned vy;                               // 8.8, down only
bool     grounded;
char     ground_attr;                      // attribute of the cell stood on
char     events;
char     state;                            // 0 stand, 1 walk, 2 fall, 3 wall

char logy[2][320];                         // foot row per foot column, per pass
int  drop_x;

// Ground row for foot column x, starting from the cell that holds the
// feet now (fy). One cell up if the cell above is also ground (walking
// up into the next slope cell), one cell down if the feet are in air
// (walking down). 0xff: no ground within a cell.
char surface_walk(int x, char fy)
{
    char col = x >> 3, row = fy >> 3;
    char a = rowp[row][col];
    if (a & A_GROUND) {
        char b = rowp[row - 1][col];
        if (b & A_GROUND) {
            a = b;
            row--;
        }
    } else {
        row++;
        a = rowp[row][col];
        if (!(a & A_GROUND))
            return 0xff;
    }
    ground_attr = a;
    return (row << 3) + heights[HIDX(a, x)];
}

// One frame. cur is the port byte, newp the lines that went low this frame.
void actor_update(char cur, char newp)
{
    char fy = fy_fp >> 8;

    if (grounded) {
        // Drop-through: only from a one-way cell. Start one row below its
        // surface so the landing test cannot catch it again.
        if (!(cur & JOY_DOWN) && (newp & JOY_FIRE) && (ground_attr & A_DROP)) {
            fy_fp += 0x100;
            vy = 0;
            grounded = false;
            drop_x = fx;
            events |= EV_DROP;
            state = 2;
            return;
        }
        state = 0;
        signed char dx = 0;
        if (!(cur & JOY_RIGHT)) dx = 1;
        else if (!(cur & JOY_LEFT)) dx = -1;
        if (!dx)
            return;
        int nx = fx + dx;
        int edge = dx > 0 ? nx + BODY_HALF : nx - BODY_HALF;
        char probe = rowp[(fy - 11) >> 3][edge >> 3];
        char s = 0xff;
        if (!(probe & A_WALL))
            s = surface_walk(nx, fy);
        if (probe & A_WALL || (s != 0xff && s < fy && fy - s > MAX_RISE)) {
            events |= dx > 0 ? EV_WALLR : EV_WALLL;
            state = 3;
            return;
        }
        fx = nx;
        state = 1;
        if (s != 0xff && (s <= fy || s - fy <= MAX_SNAP)) {
            fy_fp = (unsigned)s << 8;      // ground snap, up or down
            return;
        }
        grounded = false;                  // off an edge: fall from here
        vy = 0;
        state = 2;
        return;
    }

    // Airborne: fall, then look for a surface crossed on the way down, in
    // the cell the feet left and the cell they reached.
    vy += GRAVITY;
    if (vy > MAX_FALL) vy = MAX_FALL;
    fy_fp += vy;
    char ny = fy_fp >> 8;
    char col = fx >> 3;
    for (char row = fy >> 3; row <= (ny >> 3); row++) {
        char a = rowp[row][col];
        if (a & A_GROUND) {
            char s = (row << 3) + heights[HIDX(a, fx)];
            if (s >= fy && s <= ny) {
                fy_fp = (unsigned)s << 8;
                vy = 0;
                grounded = true;
                ground_attr = a;
                events |= EV_LAND;
                state = 0;
                return;
            }
        }
    }
    state = 2;
}

// Reference profile: scan the column from the top for the first ground
// cell that is not one-way, and read the table there.
char terrain(int x)
{
    char col = x >> 3;
    for (char row = MAP_ROW0; row < 25; row++) {
        char a = rowp[row][col];
        if ((a & A_GROUND) && !(a & A_DROP))
            return (row << 3) + heights[HIDX(a, x)];
    }
    return 0xff;
}

// --- CIA1 timer B harness ---------------------------------------------------
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

// --- text helpers (screen codes) ---------------------------------------------
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

const char *state_name[4] = { s"stand", s"walk ", s"fall ", s"wall " };

int main(void)
{
    __asm { sei }
    mmap_set(MMAP_CHAR_ROM);
    memcpy(FONT, CHAR_ROM, 2048);
    mmap_set(MMAP_ROM);

    // Slope glyphs from the height table: a pixel is set when its row is
    // at or below the ground row of its column.
    for (char t = 0; t < 8; t++) {
        char *g = FONT + (G_SLOPE + t) * 8;
        for (char r = 0; r < 8; r++) {
            char bits = 0;
            for (char x = 0; x < 8; x++)
                if (r >= heights[t * 8 + x])
                    bits |= 0x80 >> x;
            g[r] = bits;
        }
    }
    static const char wall[8] = { 0xff, 0x81, 0x81, 0xff, 0xff, 0x18, 0x18, 0xff };
    for (char r = 0; r < 8; r++) {
        FONT[G_WALL * 8 + r] = wall[r];
        FONT[G_PLAT * 8 + r] = r < 3 ? 0xff : 0x00;
    }

    vic.color_border = 0;
    vic.color_back = 0;
    vic.memptr = 0x1e;
    memset(SCREEN, 0x20, 1000);
    memset(COLOUR, VCOL_WHITE, 1000);
    memset(map, 0, sizeof(map));
    for (char r = 0; r < 25; r++)
        rowp[r] = map + r * 40;

    for (char y = 0; y < 22; y++) {
        char row = MAP_ROW0 + y;
        for (char x = 0; x < 40; x++) {
            char c = map_text[y][x], a = 0, g = 0x20, k = VCOL_GREEN;
            switch (c) {
            case '#':  a = A_GROUND;                    break;
            case 'W':  a = A_GROUND | A_WALL; g = G_WALL; k = VCOL_LT_GREY; break;
            case '=':  a = A_GROUND | A_DROP; g = G_PLAT; k = VCOL_YELLOW;  break;
            case '/':  a = A_GROUND | SLOPE(1);         break;
            case '\\': a = A_GROUND | SLOPE(2);         break;
            case 'a':  a = A_GROUND | SLOPE(3);         break;
            case 'b':  a = A_GROUND | SLOPE(4);         break;
            case 'c':  a = A_GROUND | SLOPE(5);         break;
            case 'd':  a = A_GROUND | SLOPE(6);         break;
            }
            if (a && g == 0x20)
                g = G_SLOPE + ((a & A_SLOPE) >> 4);
            rowp[row][x] = a;
            SCREEN[row * 40 + x] = g;
            COLOUR[row * 40 + x] = k;
        }
    }

    // Sprite 0: a bar 5 px wide (columns 10-14) and 21 tall.
    for (char i = 0; i < 63; i++)
        SPRDATA[i] = (i % 3 == 1) ? 0x3e : 0x00;
    memset(logy, 0xff, sizeof(logy));
    fx = 24;
    fy_fp = (unsigned)(16 * 8) << 8;       // on the platform
    grounded = true;
    ground_attr = A_GROUND | A_DROP;
    spr_init(SCREEN);
    spr_set(0, true, fx - FOOT_COL + 24, (fy_fp >> 8) - BODY_H + 50, 13, VCOL_WHITE, false, false, false);

    put_str(SCREEN,      s"x");
    put_str(SCREEN + 6,  s"y");
    put_str(SCREEN + 12, s"slope");
    put_str(SCREEN + 20, s"state");
    put_str(SCREEN + 33, s"f");
    put_str(SCREEN + 40, s"update max       min");
    put_str(SCREEN + 80, s"samples         err     result");

    char prev = 0xff, step = 0, fault = 0;
    unsigned left = script[0].frames, t_max = 0, t_min = 0xffff, frame = 0;
    bool done = false;

    for (;;) {
        vic_waitFrame();

        char cur = done ? 0xff : script[step].port;
        char newp = (cur ^ prev) & prev & JOY_MASK;   // low now, high last frame
        prev = cur;

        timer_start();
        actor_update(cur, newp);
        unsigned t = timer_stop();
        if (t > t_max) t_max = t;
        if (t < t_min) t_min = t;

        char fy = fy_fp >> 8;
        if (grounded && !done)
            logy[script[step].pass][fx] = fy;
        spr_move(0, fx - FOOT_COL + 24, fy - BODY_H + 50);

        put_dec(SCREEN + 2, fx, 3);
        put_dec(SCREEN + 8, fy, 3);
        SCREEN[18] = grounded ? 0x30 + ((ground_attr & A_SLOPE) >> 4) : 0x2d;
        put_str(SCREEN + 26, state_name[state]);
        put_dec(SCREEN + 35, frame, 5);
        frame++;
        put_dec(SCREEN + 40 + 11, t_max, 5);
        put_dec(SCREEN + 40 + 21, t_min, 5);

        if (!done && --left == 0) {
            if (script[step].exp_fx != fx && !fault)
                fault = 1;
            step++;
            if (step < STEPS) {
                left = script[step].frames;
                continue;
            }
            done = true;

            // Compare the log with the reference profile.
            unsigned n0 = 0, n1 = 0;
            char maxerr = 0;
            for (int x = 0; x < 320; x++) {
                for (char p = 0; p < 2; p++) {
                    char y = logy[p][x];
                    if (y == 0xff)
                        continue;
                    char e = (p == 0 && x < drop_x) ? 16 * 8 : terrain(x);
                    char d = y > e ? y - e : e - y;
                    if (d > maxerr) maxerr = d;
                    if (p) n1++; else n0++;
                }
            }
            if (maxerr && !fault) fault = 2;
            if (events != EV_ALL && !fault) fault = 3;
            if ((n0 != 270 || n1 != 275) && !fault) fault = 4;

            put_dec(SCREEN + 80 + 8, n0, 3);
            put_dec(SCREEN + 80 + 12, n1, 3);
            put_dec(SCREEN + 80 + 20, maxerr, 3);
            char code = fault ? CODE_FAIL : CODE_PASS;
            RESULT = code;
            vic.color_border = fault ? VCOL_RED : VCOL_GREEN;
            SCREEN[80 + 31] = 0x30;
            SCREEN[80 + 32] = 0x30 + code;
            SCREEN[80 + 34] = 0x30 + fault;
        }
    }
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=slope-collision.prg slope-collision.c
```

Produces `slope-collision.prg`, 4,299 bytes (Oscar64 build 2026-05-19).
The `#pragma region` line keeps code and data below $3800, where the
program copies the character ROM and writes its glyphs; without it
nothing stops the code growing into the charset
(`charset_blit_overruns_grown_code`). The copy runs with `$01` = `$31`,
because the CPU sees the character ROM only while I/O is switched out
(`charset_under_io_invisible_to_cpu`). Then run headless in VICE (PAL):

```bash
GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas x64sc -default -warp +sound \
  +autostart-delay-random -autostartprgmode 1 -limitcycles 20000000 \
  -exitscreenshot slope-collision.png -autostart slope-collision.prg
```

Add `-model ntsc` for the NTSC picture. The script takes 632 frames; at
20,000,000 cycles the verdict is on screen on both models (frame counter
823 on PAL, 940 on NTSC).

## Expected output

Black background. Rows 0 to 2 are the HUD. Below them: a light grey
brick wall at columns 0 to 1 and 37 to 39 from row 8 down, a yellow
plank (the drop-through platform) on row 16 at columns 2 to 9, green
ground on rows 21 to 24, a green 45-degree hill on columns 12 to 19
(three cells up, a two-cell top, three cells down, top surface on row
18), and a green 1-in-2 hill on columns 23 to 31 (two two-cell
rises, a one-cell top on row 19, two two-cell falls). The sprite is a
white bar 5 pixels wide and 21 tall; its foot column is its middle.

The script, frame by frame:

| Frames | Port | What happens | Event |
|---|---|---|---|
| 0 to 9 | none | stands on the platform at foot x 24, foot row 128 | |
| 10 to 25 | right | walks along the platform to x 40 | |
| 26 | down + fire | drops through the platform | DROP |
| 27 to 56 | none | falls and lands on the ground, foot row 168 | LAND |
| 57 to 321 | right | over the 45-degree hill and the 1-in-2 hill; stopped by the right wall at x 293 for the last 12 frames | WALL R |
| 322 to 611 | left | back over both hills and under the platform; stopped by the left wall at x 18 for the last 15 frames | WALL L |
| 612 to 631 | none | stands; the verdict is posted | |

The verdict on both models (measured in VICE x64sc 3.10 at 20,000,000
cycles, HUD decoded against the character ROM): row 0 reads
`X 018 Y 168 SLOPE 0 STATE STAND F 00823` on PAL (`F 00940` on NTSC), row 1 `UPDATE MAX 00455 MIN 00087`,
row 2 `SAMPLES 270 275 ERR 000 RESULT 01 0`, and the border is palette
index 5, (98, 213, 50) on PAL and (114, 189, 103) on NTSC. The pass
covers foot x 24 to 293 going right (270 samples, 16 of them on the
platform) and 18 to 292 going left (275), and every sample matches the
reference profile exactly.

Screenshots at 20,000,000 cycles, both after the verdict:
`screenshots/slope-collision.png` (PAL) and
`screenshots/slope-collision-ntsc.png` (NTSC). Measured on the PNGs with
PIL, identically on both: the sprite is 105 white pixels, a 5 x 21 block
at world x 16 to 20 and y 147 to 167, so the foot column is 18 and its
bottom row is 167; the first pixel below it in that column is at y 168,
green, the flat ground on row 21. Text row 0 starts at PNG row 35 on PAL
and 23 on NTSC, which fixes world y 0. Scanning each column x 16 to 295
of both PNGs for the first green pixel reproduces the reference profile
in all 275 columns the sprite does not cover.

The two cycle figures are what `actor_update` costs for one actor: the
timer starts before the call and stops after it, with interrupts masked
for the whole program. The update runs just after `vic_waitFrame()`
returns at raster line 256, inside the vertical blank, so no badline
falls in it and the figures agree on the two models. A build that timed
each state separately (not the listing) put the worst frames at 455
cycles walking, 370 landing, 329 falling and 250 against a wall; standing
still costs 87.

## Why this works

The attribute byte is the whole collision model. Bit 0 says the cell
has a ground surface, bit 1 that it stops a sideways move, bit 2 that it
is one-way, and bits 4 to 6 pick a row of the height table. `(a & $70)
>> 1` is the slope type times 8, so `| (x & 7)` indexes the table with
no multiply. The filled cells under a hill are flat ground (type 0, full
glyph); only the surface cells carry a slope type.

The foot is one point, the middle column of the body, and the foot row
`fy` is the ground row under it, one below the sprite's last row. A
walking step looks only at the cell that holds `fy` and one neighbour.
If that cell is ground and the cell above is ground too, the feet have
walked into the fill under the next slope cell, so the surface is in the
cell above. If the cell is air, the feet have walked off the end of a
slope cell and the surface, if any, is in the cell below. The result is
the new foot row; the actor is put on it every step (ground snap), so
walking down a slope never leaves it floating. A rise of more than 2
pixels in one step is refused as a wall; a drop of more than 2 pixels
starts a fall. At 1 pixel a frame the steepest slope here, 45 degrees,
changes the foot row by 1, so neither limit trips on the hills. By the
same rule the 8-pixel step at the foot of a wall is refused even
without its wall bit (rung 3, read from the code, not run).

The 1-in-2 hill (8 pixels of rise over 16, 26.6 degrees) needs two
cell types per step of height: the lower cell's ground runs from row 7
to row 4, the upper cell's from 3 to 0, in steps of 1 every 2 pixels, so
a rise of 4 pixels per cell continues across the cell boundary without a
jump. Slope to flat and flat to slope
need no code: a 45-degree cell ends at row 0 or row 7, and the next cell
along, at the same height or one row up or down, starts one pixel away.

A fall looks at the cell the feet left and the cell they reached, and
lands on a surface that lies between the old and new foot rows. The
platform is one-way because a drop moves the feet one row below its
surface before the fall starts, so the platform's ground row is above
the old foot row on the first falling frame and is never caught; walking
under it later, the actor never tests it at all, because the foot cell
is on the ground below. That holds only while the platform is at least
two cells above the ground cell: `surface_walk` also reads the cell
directly above the foot cell, so a one-way cell there would be taken as
the next surface, a rise of 8 pixels, and refused as a wall (rung 3,
read from the code, not run). The recipe's platform is on row 16, five
cells above the ground on row 21. The fall speed is capped at 4 pixels a frame,
under a cell, so two cells are always enough.

The reference profile is built a different way: scan the column from
row 3 down to the first ground cell that is not one-way and read its
table entry. It shares the table with the walker but not the
neighbour rules, so a wrong rule shows as an error. Three edits of the
listing were run to prove the check can fail: without the cell-above
rule the largest error is 24 pixels; with the snap limit at 0 the
phases end at the wrong x (x 59 at the end, not 18); without the
one-row offset on the drop the error is 40 pixels, the platform's
height above the ground. Each posted `02`.

Verified: compiled with Oscar64 (build 2026-05-19), run headless in VICE
x64sc 3.10 with the pinned command on PAL and NTSC, each pinned run
twice with byte-identical PNGs; the HUD was decoded against the
character ROM and the sprite and the ground located by pixel colour with
PIL, not by eye.
