---
recipe: tile-grid-collision
toolchain: oscar64
output_format: PRG
region: both
techniques: [tile_grid_collision]
file_formats: [PRG]
uses_registers: [D000, D001, D010, D011, D015, D020, D021, D027, DC06, DC07, DC0F]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 Tile Grid Collision: a scripted sprite against a decoded map

## Synopsis

One sprite walks a 40 x 23 tile map under a script instead of a joystick,
and every frame its body is tested against the map: a wall stops the walk,
a fall ends on a tile top, a jump ends on a ceiling, a ladder switches
gravity off, and a pit is no solid tile under the feet. The map is text in
the source, decoded once into a one-byte-per-tile array and onto the
screen. Row 0 is a HUD (the feet's tile row and column, a state word, the
frame number and an event mask); row 1 shows the CIA1 timer B cost of the
update, worst and best frame. A check after every frame asserts that no
probe point on the body is inside a solid tile, and the script carries the
tile row and x position the sprite must have at the end of each phase.
`$02FF` = `01` and a green border when the script completed with all five
events seen and no failed check; `02` and red otherwise. This is the
`tile_grid_collision` technique from `docs/techniques/logic.md`; the
result-byte contract is `headless-verify.md`.

## Source

```c
// tile-grid-collision.c
//
// Tile-grid collision for a platformer. One sprite is driven by a
// scripted walk over a 40 x 23 tile map decoded once from text. Every
// frame the body's edges are tested against the map: a wall stops the
// walk, a landing snaps to the tile top, a ceiling stops a jump, a
// ladder disables gravity, a pit is no solid tile under the feet.
// Row 0 is a HUD (feet tile row and column, state, frame, events).
// Row 1 shows the CIA1 timer B cost of the update, worst and best frame.
// $02FF = 01 and a green border when the script completed with every
// event seen and no assert failure; 02 and red otherwise.
//
#include <c64/vic.h>
#include <c64/cia.h>
#include <c64/sprites.h>

#define Screen  ((char *)0x0400)
#define Color   ((char *)0xd800)
#define SprData ((char *)0x0340)          // sprite block 13, cassette buffer
#define RESULT  (*(volatile char *)0x02ff)

#define CODE_PASS 0x01
#define CODE_FAIL 0x02

#define MAP_W   40
#define MAP_H   23
#define MAP_ROW 2                         // first screen row of the map

// Tile classes. The map below is text, one character per 8 x 8 tile.
#define T_EMPTY  0                        // '.'
#define T_BRICK  1                        // '#'
#define T_PLAT   2                        // '='
#define T_LADDER 3                        // 'H'

// Body inside the 24 x 21 sprite: columns 8..15, rows 0..20 (the image
// is a filled bar over exactly these pixels). Side probes go every 8 px.
#define BODY_L   8
#define BODY_R   15
#define BODY_T   0
#define BODY_B   20
#define BODY_CX  12                       // ladder test column

// Physics, 8.8 fixed point, positive is down.
#define GRAVITY  0x0028
#define MAX_FALL 0x0400                   // 4 px a frame, under one tile
#define JUMP_V   (-0x0300)                // 3 px a frame upwards

// Joystick bits, active low on the port.
#define JOY_UP    0x01
#define JOY_DOWN  0x02
#define JOY_LEFT  0x04
#define JOY_RIGHT 0x08
#define JOY_FIRE  0x10
#define JOY_MASK  0x1f

// Events the script must produce before it may pass.
#define EV_LAND   0x01
#define EV_WALL   0x02
#define EV_BUMP   0x04
#define EV_LADDER 0x08
#define EV_PIT    0x10
#define EV_ALL    0x1f

// --- map ---------------------------------------------------------------
// Screen rows 2..24. Column 0 and 39 are wall. A platform on screen row
// 17 with a ladder through it at column 6 down to the floor; a one-tile
// overhang at column 11 row 19; a pillar at columns 12..17 rows 20..22;
// a two-row floor with a pit at columns 1..2.
const char map_text[MAP_H][MAP_W + 1] = {
    "#......................................#",   // screen row 2
    "#......................................#",
    "#......................................#",
    "#......................................#",
    "#......................................#",
    "#......................................#",
    "#......................................#",
    "#......................................#",
    "#......................................#",   // 10
    "#......................................#",
    "#......................................#",
    "#......................................#",
    "#......................................#",
    "#......................................#",
    "#......................................#",   // 16
    "#..===H===..............................#",  // 17 platform
    "#.....H................................#",
    "#.....H....#...........................#",   // 19 overhang
    "#.....H.....######.....................#",   // 20 pillar
    "#.....H.....######.....................#",
    "#.....H.....######.....................#",   // 22
    "#..#####################################",   // 23 floor, pit at 1..2
    "#..#####################################",   // 24
};

char map[MAP_H * MAP_W];                  // decoded, one byte per tile

const char tile_code[4] = { 0x20, 0xa0, 0xa0, 0x08 };   // space, block, block, H
const char tile_col[4]  = { 0, 12, 5, 7 };               // -, grey, green, yellow

// --- scripted walk -----------------------------------------------------
// One entry per phase: frames to hold the port byte, then what must be
// true at the end of the phase. exp_row is the feet's screen row, 0xff
// for any; exp_px is the world x of the sprite's left edge, -1 for any.
struct Step { char frames; char port; char exp_row; int exp_px; };

const struct Step script[] = {
    { 10, 0xff,                 22, 32 },   // stand on the floor
    { 60, 0xff ^ JOY_RIGHT,     22, 80 },   // walk right, stopped by the pillar
    {  1, 0xff ^ JOY_FIRE,    0xff, 80 },   // one-frame fire pulse: jump
    { 39, 0xff,                 22, 80 },   // head hits the overhang, fall back
    { 40, 0xff ^ JOY_LEFT,      22, 40 },   // walk left to the ladder
    { 70, 0xff ^ JOY_UP,        16, 40 },   // climb to the platform top
    { 40, 0xff ^ JOY_RIGHT,   0xff, 80 },   // walk off the platform end
    { 30, 0xff,                 18, 80 },   // land on the overhang
    { 130, 0xff ^ JOY_LEFT,     24,  0 },   // off the overhang, into the pit
    { 20, 0xff,                 24,  0 },   // stand in the pit
};
#define STEPS (sizeof(script) / sizeof(script[0]))

// --- player state ------------------------------------------------------
int      px;                               // world x of sprite left edge
unsigned py_fp;                            // 8.8 world y of sprite top
int      vy;                               // 8.8
bool     on_ground, on_ladder;
char     state;                            // index into state_name
char     events;
char     fault;                            // first failed assert, 0 = none

const char *state_name[6] = {
    s"stand", s"walk ", s"jump ", s"fall ", s"climb", s"wall "
};

// --- tile lookup -------------------------------------------------------
// World pixel to tile: column = x >> 3, screen row = y >> 3, and the map
// starts at screen row MAP_ROW. Outside the map is empty above and solid
// below and to the sides.
char tile_at(int wx, int wy)
{
    if (wx < 0 || wx >= 320) return T_BRICK;
    int ty = (wy >> 3) - MAP_ROW;
    if (ty < 0) return T_EMPTY;
    if (ty >= MAP_H) return T_BRICK;
    return map[ty * MAP_W + (wx >> 3)];
}

bool solid_at(int wx, int wy)
{
    char t = tile_at(wx, wy);
    return t == T_BRICK || t == T_PLAT;
}

// The tile under a foot holds the player if it is solid, or if it is the
// top rung of a ladder (a ladder tile with no ladder above it).
bool stands_on(int wx, int wy)
{
    char t = tile_at(wx, wy);
    if (t == T_BRICK || t == T_PLAT) return true;
    return t == T_LADDER && tile_at(wx, wy - 8) != T_LADDER;
}

void check(bool ok, char n)
{
    if (!ok && fault == 0) fault = n;
}

// --- one frame of movement and collision --------------------------------
// cur is the port byte (active low), newp the lines that went low this
// frame. Order: horizontal, ladder, vertical, events.
void player_update(char cur, char newp)
{
    int py = (int)(py_fp >> 8);
    bool moving = false, blocked = false;
    bool was_ground = on_ground;

    // 1. Horizontal. Probe the leading edge every 8 px from head to
    //    feet: a 21 px edge crosses up to four tile rows, and probes
    //    further apart than a tile let a one-tile ledge slip between.
    if (!(cur & JOY_LEFT) || !(cur & JOY_RIGHT)) {
        int nx = (cur & JOY_LEFT) ? px + 1 : px - 1;
        int edge = (nx > px) ? nx + BODY_R : nx + BODY_L;
        if (solid_at(edge, py + BODY_T) || solid_at(edge, py + BODY_T + 8) ||
            solid_at(edge, py + BODY_T + 16) || solid_at(edge, py + BODY_B))
            blocked = true;
        else {
            px = nx;
            moving = true;
        }
    }

    // 2. Ladder: the centre column at the feet, or the tile just below.
    int cx = px + BODY_CX;
    on_ladder = tile_at(cx, py + BODY_B) == T_LADDER ||
                tile_at(cx, py + BODY_B + 1) == T_LADDER;
    bool climbing = false;
    if (on_ladder && (!(cur & JOY_UP) || !(cur & JOY_DOWN))) {
        vy = 0;
        if (!(cur & JOY_UP)) {
            // Climb while the feet are on a ladder tile; the last pixel
            // leaves the feet one row above the top rung, standing on it.
            if (tile_at(cx, py + BODY_B) == T_LADDER) {
                py--;
                climbing = true;
            }
        } else if (!solid_at(cx, py + BODY_B + 1)) {
            py++;
            climbing = true;
        }
        py_fp = (unsigned)py << 8;
        on_ground = true;
    }

    // 3. Vertical. Ground is a standable tile under either foot corner;
    //    none under both is a pit or a platform end, and gravity applies.
    if (!climbing) {
        on_ground = stands_on(px + BODY_L, py + BODY_B + 1) ||
                    stands_on(px + BODY_R, py + BODY_B + 1);
        if (on_ground && (newp & JOY_FIRE))
            vy = JUMP_V;
        else if (on_ground)
            vy = 0;
        else {
            vy += GRAVITY;
            if (vy > MAX_FALL) vy = MAX_FALL;
        }
        if (vy) {
            py_fp += (unsigned)vy;
            int ny = (int)(py_fp >> 8);
            if (vy > 0) {
                // Landing: the feet crossed into a standable tile, so
                // put them on the pixel row above its top.
                if (stands_on(px + BODY_L, ny + BODY_B) ||
                    stands_on(px + BODY_R, ny + BODY_B)) {
                    ny = ((ny + BODY_B) & ~7) - BODY_B - 1;
                    py_fp = (unsigned)ny << 8;
                    vy = 0;
                    on_ground = true;
                }
            } else {
                // Ceiling: the head crossed into a solid tile, so put it
                // on the pixel row below its bottom and fall from there.
                if (solid_at(px + BODY_L, ny + BODY_T) ||
                    solid_at(px + BODY_R, ny + BODY_T)) {
                    ny = ((ny + BODY_T) | 7) + 1 - BODY_T;
                    py_fp = (unsigned)ny << 8;
                    vy = 0;
                    events |= EV_BUMP;
                }
            }
            py = ny;
        }
    }

    // 4. Events and state word. A landing is the ground test turning
    //    true, not the snap: a fall can end exactly on the tile top.
    if (blocked) events |= EV_WALL;
    if (climbing) events |= EV_LADDER;
    if (on_ground && !was_ground && !climbing) events |= EV_LAND;
    if (on_ground && py + BODY_B == 199) events |= EV_PIT;
    if (climbing) state = 4;
    else if (!on_ground) state = (vy < 0) ? 2 : 3;
    else if (blocked) state = 5;
    else state = moving ? 1 : 0;

}

// Assert, outside the timed region: no probe point on the body's outline
// is inside a solid tile after the update.
void player_assert(void)
{
    int py = (int)(py_fp >> 8);
    check(!solid_at(px + BODY_L, py + BODY_T) && !solid_at(px + BODY_R, py + BODY_T), 1);
    check(!solid_at(px + BODY_L, py + BODY_T + 8) && !solid_at(px + BODY_R, py + BODY_T + 8), 2);
    check(!solid_at(px + BODY_L, py + BODY_T + 16) && !solid_at(px + BODY_R, py + BODY_T + 16), 2);
    check(!solid_at(px + BODY_L, py + BODY_B) && !solid_at(px + BODY_R, py + BODY_B), 3);
    check(py >= 0 && py + BODY_B < 200, 4);
}

// --- CIA1 timer B harness (as tile-map-render.md) ------------------------
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

// --- text helpers (screen codes) ------------------------------------------
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

void put_hex2(char *p, char v)
{
    char d = v >> 4;
    p[0] = d < 10 ? 0x30 + d : d - 9;
    d = v & 15;
    p[1] = d < 10 ? 0x30 + d : d - 9;
}

int main(void)
{
    vic.color_border = 0;
    vic.color_back = 0;
    for (unsigned i = 0; i < 1000; i++) {
        Screen[i] = 0x20;
        Color[i] = 1;
    }

    // Decode the text map once, into the map array and onto the screen.
    for (char y = 0; y < MAP_H; y++) {
        char *s = Screen + (MAP_ROW + y) * 40;
        char *k = Color + (MAP_ROW + y) * 40;
        char *m = map + y * MAP_W;
        for (char x = 0; x < MAP_W; x++) {
            char c = map_text[y][x];
            char t = (c == '#') ? T_BRICK : (c == '=') ? T_PLAT : (c == 'H') ? T_LADDER : T_EMPTY;
            m[x] = t;
            s[x] = tile_code[t];
            k[x] = tile_col[t];
        }
    }

    // Sprite 0: a filled bar 8 px wide, 21 tall, in body columns 8..15.
    for (char i = 0; i < 63; i++)
        SprData[i] = (i % 3 == 1) ? 0xff : 0x00;
    px = 32;
    py_fp = (unsigned)(184 - 21) << 8;             // feet on the floor's top
    spr_init(Screen);
    spr_set(0, true, px + 24, (int)(py_fp >> 8) + 50, 13, VCOL_WHITE, false, false, false);

    put_str(Screen, s"row    col    state        f       ev");
    put_str(Screen + 40, s"update max       min");

    char prev = 0xff, step = 0, left = script[0].frames;
    unsigned frame = 0, t_max = 0, t_min = 0xffff;
    bool done = false;

    for (;;) {
        vic_waitFrame();

        // Script: a table of frames and an active-low port byte, through
        // the same edge detector a real stick would go through.
        char cur = done ? 0xff : script[step].port;
        char newp = (cur ^ prev) & prev & JOY_MASK;   // low now, high last frame
        prev = cur;

        __asm { sei }
        timer_start();
        player_update(cur, newp);
        unsigned t = timer_stop();
        __asm { cli }
        player_assert();
        if (t > t_max) t_max = t;
        if (t < t_min) t_min = t;

        int py = (int)(py_fp >> 8);
        spr_move(0, px + 24, py + 50);

        // HUD
        char frow = (py + BODY_B) >> 3;
        char fcol = (px + BODY_L) >> 3;
        put_dec(Screen + 4, frow, 2);
        put_dec(Screen + 11, fcol, 2);
        put_str(Screen + 20, state_name[state]);
        put_dec(Screen + 27, frame, 5);
        put_hex2(Screen + 37, events);
        put_dec(Screen + 40 + 11, t_max, 5);
        put_dec(Screen + 40 + 21, t_min, 5);
        frame++;

        if (!done && --left == 0) {
            const struct Step *st = script + step;
            check(st->exp_row == 0xff || st->exp_row == frow, 5);
            check(st->exp_px < 0 || st->exp_px == px, 6);
            step++;
            if (step == STEPS) {
                done = true;
                check(events == EV_ALL, 7);
                char code = fault ? CODE_FAIL : CODE_PASS;
                RESULT = code;
                vic.color_border = fault ? 2 : 5;
                put_str(Screen + 40 + 30, s"result 0");
                Screen[40 + 38] = 0x30 + code;
                Screen[40 + 39] = 0x30 + fault;
            } else
                left = script[step].frames;
        }
    }
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=tile-grid-collision.prg tile-grid-collision.c
```

Produces `tile-grid-collision.prg`, 3,918 bytes (Oscar64 build
2026-05-19). Then run headless in VICE (PAL):

```bash
GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas x64sc -default -warp +sound \
  +autostart-delay-random -autostartprgmode 1 -limitcycles 7200000 \
  -exitscreenshot tile-grid-collision.png -autostart tile-grid-collision.prg
```

Add `-model ntsc` for the NTSC picture. The script takes 440 frames; at
12,000,000 cycles the run is over on both models and the border carries
the verdict.

## Expected output

Black border and background while the script runs. Rows 2 to 24 hold the
map: a grey wall down each side, a green platform on row 17 with a yellow
`H` ladder through it at column 6 down to the floor, a one-tile grey
overhang at column 11 row 19, a grey pillar at columns 12 to 17 on rows
20 to 22, and a two-row grey floor with a gap at columns 1 and 2. The
sprite is a white bar 8 pixels wide and 21 tall.

The script, frame by frame:

| Frames | Port | What happens | Event |
|---|---|---|---|
| 0 to 9 | none | stands on the floor at x 32 | |
| 10 to 69 | right | walks to x 80 and is stopped by the pillar for the last 12 frames | WALL |
| 70 | fire | jumps; the head meets the overhang on the second frame and stops under it | BUMP |
| 71 to 109 | none | falls back to the floor | LAND |
| 110 to 149 | left | walks to x 40, centred on the ladder | |
| 150 to 219 | up | climbs 48 pixels and stands on the ladder top, feet on row 16 | LADDER |
| 220 to 259 | right | walks along the platform, off its end at x 72, and falls | |
| 260 to 289 | none | lands on the overhang, feet on row 18 | |
| 290 to 419 | left | walks off the overhang, is held by the platform end while its head passes it, lands on the floor, walks to the gap, falls in and is stopped by the left wall at x 0 | PIT |
| 420 to 439 | none | stands in the pit, feet on row 24; the verdict is posted | |

The verdict on both models (measured in VICE x64sc 3.10 at 12,000,000
cycles, HUD decoded against the char ROM): row 0 reads
`ROW 24 COL 01 STATE STAND  00450   EV1F` on PAL (`00509` on NTSC, more
frames in the same cycles), row 1 reads `UPDATE MAX 02345 MIN 00604`
followed by `RESULT 010` (code `01`, fault `0`), and the border is
palette index 5, (98, 213, 50) on PAL and (114, 189, 103) on NTSC. The
HUD's frame counter shows how many frames ran, and the two cycle
figures are identical on the two models.

Screenshots at 7,200,000 cycles, mid-script:
`screenshots/tile-grid-collision.png` (PAL, frame 206) and
`screenshots/tile-grid-collision-ntsc.png` (NTSC, frame 228). Measured
on the PNGs: the sprite's white pixels are exactly 168, an 8 x 21 block
at world x 48 to 55, y 115 to 135 on PAL (standing on the ladder top,
HUD `ROW 16 COL 06 STATE STAND`) and x 58 to 65, y 115 to 135 on NTSC
(walking along the platform, HUD `ROW 16 COL 07 STATE WALK`); the pixel
under the right foot on NTSC is the platform's green, index 5. The row 1
maxima differ at this point (`01594` PAL, `01787` NTSC) because the NTSC
run is 22 frames further into the script; both reach 2,345 by the end.

The two cycle figures are what `player_update` costs, net of nothing:
the timer starts before the call and stops after it, interrupts masked.
The update runs straight after `vic_waitFrame()` returns at raster line
256, inside the vertical blank, so no badline falls in it on either
model, which is why the figures agree. An earlier build timed the
asserts too and read 3,820 on PAL and 3,863 on NTSC: that region ran
past the end of the NTSC blank into the badlines.

## Why this works

A tile is 8 x 8 pixels, so a world pixel `(x, y)` is in tile column
`x >> 3` and screen row `y >> 3`, where world x is the sprite's X minus 24
and world y its Y minus 50 (sprite 24, 50 is the top-left visible pixel).
`tile_at` subtracts the map's first screen row and reads the decoded
array; outside the map it answers empty above and solid to the sides and
below, so the sprite can never leave. The body is the sprite's columns 8
to 15 and rows 0 to 20, and every test is on points of that box, never
on the 24 x 21 sprite.

The horizontal step probes the leading edge at the head, 8 and 16 pixels
below it, and the feet. Probes further apart than a tile miss a one-tile
ledge: the first version probed at 0, 10 and 20 and the sprite, falling
past the platform's end with its head at 135 and its middle at 145, was
allowed to step left under the platform's row 17 (pixels 136 to 143),
and the next frame's fall put its head inside it. The check that failed
was the head assert, at frame 304.

The vertical step first asks whether either foot corner has a standable
tile one pixel below it. If not, gravity applies and the body falls at up
to 4 pixels a frame, less than a tile, so the feet cannot cross a tile
without ending inside it; when they do, the new y is the tile top less
the body height less one, `((y + 20) & ~7) - 21`. A rising head that
crosses into a solid tile is put on the row below it, `(y | 7) + 1`, and
the velocity zeroed. A fall can also end exactly on the boundary, feet on
the last pixel row above the tile, with no penetration and no snap; the
first version set its landing event inside the snap and missed the fall
after the head bump for that reason, so the event is now the ground test
turning true.

A ladder is a tile class: the body is on a ladder when the centre column
at the feet, or one pixel below them, reads one. Up and down then move
one pixel a frame with the velocity held at zero, and the climb stops
when the feet leave the last ladder tile, which leaves them one pixel
above it. The top rung is standable from above (`stands_on`: a ladder
tile with no ladder over it), so the sprite can stand on it, walk off it
and climb down into it. A pit needs no code of its own: with no standable
tile under either foot the ground test fails and the fall begins.

The script is a table of a frame count and an active-low port byte, run
through the previous-frame XOR of `joystick_edge_detect`, so the fire
pulse becomes one press event exactly as a stick would deliver it, and a
real port read can replace `script[step].port` without touching the
update.

Verified: compiled with Oscar64 (build 2026-05-19), run headless in VICE
x64sc 3.10 with the pinned command on PAL and NTSC, each run twice with
byte-identical PNGs; the HUD was decoded against the char ROM and the
sprite located by counting white pixels, not by eye.
