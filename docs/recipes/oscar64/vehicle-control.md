---
recipe: vehicle-control
toolchain: oscar64
output_format: PRG
region: both
techniques: [vehicle_control, fixed_point_8_8, tile_grid_collision, soft_scroll_v, screen_double_buffer_d018, ecm_mode]
file_formats: [PRG]
uses_registers: [D000, D001, D010, D011, D015, D018, D020, D021, D022, D023, D024, D027, DC06, DC07, DC0F, DD04, DD05, DD0E]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 Vehicle Control: a Spy Hunter style car on a scrolling road

## Synopsis

A car sprite at a fixed screen height drives up a road that scrolls down
the screen. The throttle sets the forward speed in 8.8 pixels a frame,
and that speed is the scroll speed: up to 4 pixels a frame on the road.
Steering changes a lateral velocity that grip bleeds away when the stick
is centred. Four wheel probes read the tile map every frame: road, verge
(slows the car to 1.5 pixels a frame), water (boat handling, less grip)
and rock (a crash, a 50-frame stop, a restart on the road's centre line).
A 508-frame script drives it on autopilot: accelerate, onto the left
verge and back, a slide left and a brake into rock at the narrowing, a
restart, a coast, then across a water stretch.
Every frame folds the car's x, speed, distance and surface into a
checksum that the Python model below computes on the host. Rows 1 to 3
show the verdict and the CIA1 timer B cost of the control update and of
the redraw. `$02FF` = `01` and a green border when the checksum, the end
state, the surfaces seen and the single crash all match; `02` and red
otherwise. This is `vehicle_control` in `docs/techniques/logic.md`; the
result-byte contract is `headless-verify.md`.

## Source

```c
// vehicle-control.c
// A Spy Hunter style car on a vertically scrolling road. The throttle sets
// the forward speed in 8.8 pixels a frame, and that speed is the scroll
// speed; steering changes a lateral velocity that grip bleeds away; four
// wheel probes read the tile map for road, verge, water and rock. A script
// drives it: accelerate, onto the verge and back, a slide left and a brake
// into rock at the narrowing (one crash), coast, across a water stretch as
// a boat. Every frame folds x, speed, distance and surface into a checksum
// that a Python model of the same rules computed on the host. Rows 1 to 3 show the
// verdict and the CIA1 timer B cost of car_update and of the redraw.
#include <c64/vic.h>
#include <c64/cia.h>

#define Screen0 ((char *)0x0400)
#define Screen1 ((char *)0x3c00)
#define Color   ((char *)0xd800)
#define SprData ((char *)0x0340)          // sprite block 13
#define Map     ((char *)0x5000)          // MAP_H x 40 tile codes, 8,800 bytes
#define RESULT  (*(volatile char *)0x02ff)

#define CODE_PASS 0x01
#define CODE_FAIL 0x02

#define MAP_H   220
#define BASE    (MAP_H - 25)              // top map row at distance 0
#define CAR_Y   150                       // car top, pixels below line 48
#define WHEEL_L 1                         // wheel columns in the 16-px body
#define WHEEL_R 14
#define WHEEL_F 3                         // wheel rows below the car top
#define WHEEL_B 17

// Tile code bits 7-6 are the surface class and, in ECM, the background
// register: road $D021, verge $D022, water $D023, rock $D024.
#define C_ROAD  0
#define C_VERGE 1
#define C_WATER 2
#define C_CRASH 3

#define IN_UP    0x01
#define IN_DOWN  0x02
#define IN_LEFT  0x04
#define IN_RIGHT 0x08

// 8.8 constants, pixels a frame
#define ACCEL     0x000c
#define BRAKE     0x0020
#define COAST     0x0002
#define OVERDRAG  0x0010
#define STEER_MIN 0x0040
#define VXMAX     0x0180
#define CRASH_FRAMES 50

static const unsigned vmax[4]  = {0x0400, 0x0180, 0x0300, 0};
static const int      steer[4] = {0x0014, 0x0014, 0x0008, 0};
static const int      grip[4]  = {0x0010, 0x0010, 0x0003, 0};

// Python model (the page's "Model"): the fold after the whole script,
// and the state at the end.
#define EXPECT_CHK   0x2b51
#define EXPECT_X     0x91fe
#define EXPECT_SPEED 0x0300
#define EXPECT_DPIX  1210
#define EXPECT_SEEN  0x17                  // road, verge, water, crash

// Road segments in driving order, from the bottom of the map up.
struct Seg { char rows, left, right, verge, water; };
static const struct Seg segs[] = {
    {60, 12, 28, 3, 0},                    // wide road
    { 6, 13, 27, 3, 0},
    { 6, 14, 26, 3, 0},
    {30, 16, 24, 2, 0},                    // the narrowing
    { 8, 13, 27, 3, 0},
    {50, 10, 30, 0, 1},                    // water between rock banks
    {60, 12, 28, 3, 0},
};
#define NSEGS (sizeof(segs) / sizeof(segs[0]))

struct Step { char frames, input; };
static const struct Step script[] = {
    {60, IN_UP}, {40, IN_UP | IN_LEFT}, {40, IN_UP}, {40, IN_UP | IN_RIGHT},
    {30, IN_UP}, {30, IN_UP | IN_LEFT}, {60, IN_DOWN}, {60, IN_UP},
    {20, 0}, {60, IN_UP}, {14, IN_UP | IN_LEFT}, {30, IN_UP},
    {14, IN_UP | IN_RIGHT}, {10, IN_UP},
};
#define STEPS (sizeof(script) / sizeof(script[0]))

static unsigned rowoff[MAP_H];             // row * 40
static char centre[MAP_H];                 // road centre column per row

// --- the car ---------------------------------------------------------------
unsigned x_fp;                             // left edge, 8.8 pixels
int      vx;                               // lateral velocity, 8.8
unsigned speed;                            // forward = scroll speed, 8.8
char     dfrac;                            // distance, fraction byte
unsigned dpix;                             // distance, whole pixels
char     surface;                          // class under the wheels last frame
char     crash_t;                          // frames left in a crash
char     crashes;

static char tile_class(const char *row, char px)
{
    return row[px >> 3] >> 6;
}

void car_update(char in)
{
    if (crash_t) {                         // crashed: no input, no motion
        if (--crash_t == 0) {
            unsigned w = BASE * 8 + CAR_Y + WHEEL_F - dpix;
            x_fp = (unsigned)(centre[w >> 3] * 8 - 8) << 8;
            surface = C_ROAD;
        }
        return;
    }

    // 1. speed from the throttle, limited by the surface; no throttle at or
    // over the limit, so the over-limit drag slows a car with up held
    unsigned vm = vmax[surface];
    if (in & IN_UP) {
        if (speed < vm)
            speed += ACCEL;
    } else if (in & IN_DOWN)
        speed = speed > BRAKE ? speed - BRAKE : 0;
    else
        speed = speed > COAST ? speed - COAST : 0;
    if (speed > vm)
        speed = speed - OVERDRAG > vm ? speed - OVERDRAG : vm;

    // 2. scroll accumulator: distance += speed (16.8)
    unsigned t = dfrac + (speed & 0xff);
    dfrac = (char)t;
    dpix += (speed >> 8) + (t >> 8);

    // 3. lateral velocity with grip, then position
    int g = grip[surface];
    if (speed >= STEER_MIN && (in & IN_LEFT))
        vx -= steer[surface];
    else if (speed >= STEER_MIN && (in & IN_RIGHT))
        vx += steer[surface];
    else if (vx > 0)
        vx = vx > g ? vx - g : 0;
    else if (vx < 0)
        vx = -vx > g ? vx + g : 0;
    if (vx > VXMAX)
        vx = VXMAX;
    else if (vx < -VXMAX)
        vx = -VXMAX;
    x_fp += vx;

    // 4. surface probe: four wheels, the worst class wins
    char px = x_fp >> 8;
    unsigned w = BASE * 8 + CAR_Y - dpix;
    const char *rf = Map + rowoff[(w + WHEEL_F) >> 3];
    const char *rb = Map + rowoff[(w + WHEEL_B) >> 3];
    char c = tile_class(rf, px + WHEEL_L), k;
    k = tile_class(rf, px + WHEEL_R); if (k > c) c = k;
    k = tile_class(rb, px + WHEEL_L); if (k > c) c = k;
    k = tile_class(rb, px + WHEEL_R); if (k > c) c = k;

    // 5. response
    if (c == C_CRASH) {
        crash_t = CRASH_FRAMES;
        speed = 0;
        vx = 0;
        crashes++;
    } else
        surface = c;
}

// --- the redraw (belongs to the scroll, not to the car) ---------------------
// Copies 250 * blocks bytes: the whole matrix is 4 blocks, half is 2.
static void draw(char *dst, const char *src, char blocks)
{
    for (char b = 0; b < blocks; b++) {
        for (char i = 0; i < 250; i++)
            dst[i] = src[i];
        dst += 250;
        src += 250;
    }
}

static void build_map(void)
{
    char r = MAP_H - 1;
    for (char s = 0; s < NSEGS; s++) {
        const struct Seg *g = segs + s;
        char mid = (g->left + g->right) >> 1;
        for (char n = 0; n < g->rows; n++) {
            char *m = Map + (unsigned)r * 40;
            for (char c = 0; c < 40; c++) {
                char t;
                if (g->water)
                    t = (c >= g->left && c < g->right) ? 0xa0 : 0xe0;
                else if (c + g->verge < g->left || c >= g->right + g->verge)
                    t = 0xe0;
                else if (c < g->left || c >= g->right)
                    t = 0x60;
                else if (c == mid && (r & 3) < 2)
                    t = 0x3a;                  // ':' lane mark, road class
                else
                    t = 0x20;
                m[c] = t;
            }
            centre[r] = mid;
            r--;
        }
    }
    for (char i = 0; i < MAP_H; i++)
        rowoff[i] = (unsigned)i * 40;
}

// --- CIA1 timer B harness (as tile-grid-collision.md) -----------------------
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

static unsigned fold(unsigned chk, unsigned v)
{
    chk = (chk << 1) | (chk >> 15);
    return (chk ^ v) + 13;
}

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

void put_hex4(char *p, unsigned v)
{
    for (char i = 4; i > 0; i--) {
        char d = v & 15;
        p[i - 1] = d < 10 ? 0x30 + d : d - 9;
        v >>= 4;
    }
}

static char car_colour(void)
{
    return crash_t ? VCOL_WHITE : surface == C_WATER ? VCOL_YELLOW : VCOL_RED;
}

int main(void)
{
    __asm { sei }
    vic.color_border = VCOL_BLACK;
    vic.color_back  = VCOL_DARK_GREY;          // road
    vic.color_back1 = VCOL_GREEN;              // verge
    vic.color_back2 = VCOL_BLUE;               // water
    vic.color_back3 = VCOL_BROWN;              // rock
    for (unsigned i = 0; i < 1000; i++)
        Color[i] = VCOL_WHITE;
    build_map();

    for (char i = 0; i < 63; i++)
        SprData[i] = (i % 3 == 2) ? 0x00 : 0xff; // 16 x 21 block
    Screen0[0x3f8] = 13;
    Screen1[0x3f8] = 13;
    vic.spr_enable = 0x01;
    vic.spr_pos[0].y = 47 + CAR_Y;             // drawn from line 48 + CAR_Y

    x_fp = (unsigned)(centre[MAP_H - 1] * 8 - 8) << 8;
    char top = BASE, shown = BASE, target = BASE - 1, half = 0, refused = 0;
    draw(Screen0, Map + rowoff[BASE], 4);
    char *back = Screen1;
    char d018 = 0x14, d011 = 0x50;            // screen $0400, chars $1000; ECM, DEN, RSEL 0
    unsigned sx = (x_fp >> 8) + 24;
    char scol = car_colour();

    unsigned chk = 0, t_max = 0, t_at = 0, n_drive = 0, c_max = 0, f_max = 0;
    unsigned long t_sum = 0;
    char seen = 0;
    unsigned frames = 0;
    cia2.cra = 0x00;

    for (char s = 0; s < STEPS; s++) {
        for (char n = 0; n < script[s].frames; n++) {
            vic_waitFrame();                   // line 256: below the display
            cia2.ta = 0xffff;
            cia2.cra = 0x11;                   // whole-frame work timer
            vic.memptr = d018;
            vic.ctrl1 = d011;
            vic.spr_pos[0].x = (char)sx;
            vic.spr_msbx = sx >> 8;
            vic.spr_color[0] = scol;

            timer_start();
            car_update(script[s].input);
            unsigned t = timer_stop();
            if (t > t_max) {
                t_max = t;
                t_at = frames;
            }
            if (!crash_t) {                    // typical: frames the car drives
                t_sum += t;
                n_drive++;
            }

            char st = surface | (crash_t ? 0x10 : 0);
            seen |= crash_t ? 0x10 : 1 << surface;
            chk = fold(chk, x_fp);
            chk = fold(chk, speed);
            chk = fold(chk, dpix);
            chk = fold(chk, st);

            // Scroll: the top row and YSCROLL follow the distance. The
            // hidden matrix is drawn for the next top row (one map row
            // further ahead), half a matrix a frame, and flipped in when
            // the top row reaches it.
            top = BASE - (dpix >> 3);
            if (top != shown) {
                if (top == target && half == 2) {
                    d018 = (back == Screen1) ? 0xf4 : 0x14;
                    back = (back == Screen1) ? Screen0 : Screen1;
                    shown = top;
                    target = top - 1;
                    half = 0;
                } else
                    refused++;                 // would show a wrong row
            }
            if (half < 2) {
                timer_start();
                draw(back + half * 500, Map + rowoff[target] + half * 500, 2);
                unsigned tc = timer_stop();
                if (tc > c_max) c_max = tc;
                half++;
            }
            d011 = 0x50 | (dpix & 7);
            sx = (x_fp >> 8) + 24;
            scol = car_colour();
            frames++;

            cia2.cra = 0x00;
            unsigned tf = 0xffff - cia2.ta;
            if (tf > f_max) f_max = tf;
        }
    }

    vic_waitFrame();                           // show the last state
    vic.memptr = d018;
    vic.ctrl1 = d011;
    vic.spr_pos[0].x = (char)sx;
    vic.spr_msbx = sx >> 8;
    vic.spr_color[0] = scol;

    bool ok = chk == EXPECT_CHK && x_fp == EXPECT_X && speed == EXPECT_SPEED &&
              dpix == EXPECT_DPIX && seen == EXPECT_SEEN && crashes == 1 &&
              refused == 0;
    char *scr = (d018 == 0x14) ? Screen0 : Screen1;
    put_str(scr + 40, ok ? s"pass chk " : s"fail chk ");
    put_hex4(scr + 49, chk);
    put_str(scr + 54, s"frames ");
    put_dec(scr + 61, frames, 3);
    put_str(scr + 80, s"ctl max       avg");
    put_dec(scr + 88, t_max, 5);
    put_dec(scr + 98, (unsigned)(t_sum / n_drive), 5);
    put_str(scr + 104, s"at");
    put_dec(scr + 107, t_at, 3);
    put_str(scr + 120, s"cpy max       frm");
    put_dec(scr + 128, c_max, 5);
    put_dec(scr + 138, f_max, 5);
    RESULT = ok ? CODE_PASS : CODE_FAIL;
    vic.color_border = ok ? VCOL_GREEN : VCOL_RED;
    for (;;)
        ;
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=vehicle-control.prg vehicle-control.c
```

Produces `vehicle-control.prg`, 3,165 bytes (Oscar64 as installed on
2026-09-23). Then run headless in VICE (PAL):

```bash
GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas x64sc -default -warp +sound \
  +autostart-delay-random -autostartprgmode 1 -limitcycles 16000000 \
  -exitscreenshot vehicle-control.png -autostart vehicle-control.prg
```

Add `-model ntsc` for the NTSC picture. The script is 508 frames on both
models; at 16,000,000 cycles the run is over on both and the picture is
the last frame.

## Expected output

The screen is in extended colour mode (ECM), so bits 7 and 6 of each
tile code pick the cell's background register and are also the surface
class the probes read. Colour RAM is white everywhere and never changes.

| Tile code | Class | Background | Colour |
|---|---|---|---|
| `$20`, `$3A` (`:` lane mark) | road | `$D021` | dark grey, 11 |
| `$60` | verge | `$D022` | green, 5 |
| `$A0` | water | `$D023` | blue, 6 |
| `$E0` | rock | `$D024` | brown, 9 |

The map is 220 rows of 40 tiles, built at start from seven segments and
driven from the bottom up: 60 rows of road 16 tiles wide with 3-tile
verges, two 6-row steps in, 30 rows 8 tiles wide with 2-tile verges (the
narrowing), 8 rows at 14 wide, 50 rows of water 20 tiles wide between
rock banks, and 60 rows of road. The car is a 16 x 21 block: red on the
road and verge, yellow on water, white while crashed.

The script, as the model and the program both run it:

| Frames | Input | What happens |
|---|---|---|
| 0 to 59 | up | accelerates from 0 to 2.81 pixels a frame (`$02D0`), straight |
| 60 to 99 | up, left | reaches the road limit, 4.0 (`$0400`); slides left |
| 100 to 139 | up | onto the left verge at frame 108, x 94. Up adds nothing at or over the limit, so the over-limit drag takes 0.06 (`$0010`) a frame off: 4.0 at frame 108, 1.5 (`$0180`) at frame 148 |
| 140 to 179 | up, right | back onto the road at frame 152, x 95, and across it |
| 180 to 209 | up | grip takes the slide out; back to 4.0 at x 152 |
| 210 to 239 | up, left | slides left at 4.0; lateral speed at its cap, 1.5, from frame 229; onto the narrowing's left verge at frame 235, x 126 |
| 240 to 246 | down | brake: 0.13 (`$0020`) plus the over-limit drag a frame; the stick is centred, so grip slows the slide left |
| 247 | down | the left wheels reach rock at x 110 with the speed still over the verge limit: crash, speed 0, the one crash of the run |
| 248 to 297 | (ignored) | crashed; the road stands still; at frame 297 the timer ends and the car restarts at x 152, on the narrowing's centre line |
| 298 to 299 | down | brake at speed 0: the speed stays 0 |
| 300 to 359 | up | accelerates to 2.81 (`$02D0`) |
| 360 to 379 | none | coast: 0.008 (`$0002`) a frame off, to `$02A8` |
| 380 to 507 | up, then left, up, right, up | the front wheels reach water at frame 382; boat: limit 3.0 (`$0300`), steering 0.03 a frame, grip 0.01 a frame, so the drift outlasts the input |

The end state, from the model: x `$91FE` (pixel 145), speed `$0300`,
distance 1,210 pixels, so the top row is map row 44 and YSCROLL is 2,
and the checksum is `$2B51`.

Measured in VICE x64sc 3.10 at 16,000,000 cycles, decoded against the
char ROM: rows 1 to 3 read

```text
PASS CHK 2B51 FRAMES 508
CTL MAX 00655 AVG 00557 AT 247
CPY MAX 10110 FRM 11393
```

on PAL; NTSC is the same except `CPY MAX 10368 FRM 11640`. The border
is colour 5 on both. `CTL MAX` is the worst frame of `car_update`, 655
cycles, at frame 247: the crash frame, which runs the brake, the verge
over-limit drag, the grip step on a slide to the left, the four probes
and the crash response. The script puts that frame there on purpose: it
is the longest path through `car_update`. `AVG` is the mean over the 458
frames the car was not crashed, 557. Both are the same on the two
models because the update runs from line 256, before the first badline,
on both. A build whose code is laid out differently can move them by a
cycle (656 and 558 in a variant with a different redraw call). `CPY MAX`
is the worst half-matrix redraw, which runs with the display on, and
`FRM` the worst frame's whole work from line 256 to the end of the loop
body; 11,640 is 68% of an NTSC frame (17,095 cycles), so no frame
overran.

`screenshots/vehicle-control.png` (PAL) and
`screenshots/vehicle-control-ntsc.png` (NTSC) are the exit screenshots
at 16,000,000 cycles. Measured on the PNGs: the car's 336 yellow pixels
are a 16 x 21 block at PNG x 177 to 192, which is car x 145, from raster
line 198 (PNG row 182 on PAL, 170 on NTSC). Every other pixel of the
display window outside rows 1 to 3, 53,424 of them, matches the colour
predicted from the model's map at distance 1,210 and YSCROLL 2, with the
`:` glyphs taken from `chargen-901225-01.bin`: 0 mismatches on each
model. The picture shows the end of the water stretch: road with its
lane mark and verges above, the rock bank, and the boat in the water.

### Model

The Python the checksum came from. It builds the same map and runs the
same rules; `run()` returns the end state and the fold.

```python
# Model of vehicle-control.c: same map, same rules, same fold.
import sys

MAP_H, W = 220, 40
BASE = MAP_H - 25
CAR_Y = 150                 # car top, text-area pixel row (line 48 + CAR_Y)
WHEEL_L, WHEEL_R = 1, 14    # wheel columns in the 16-px body
WHEEL_F, WHEEL_B = 3, 17    # wheel rows below the car top
C_ROAD, C_VERGE, C_WATER, C_CRASH = 0, 1, 2, 3
UP, DOWN, LEFT, RIGHT = 1, 2, 4, 8

ACCEL, BRAKE, COAST, OVERDRAG = 0x000C, 0x0020, 0x0002, 0x0010
STEER_MIN, VXMAX = 0x0040, 0x0180
VMAX  = [0x0400, 0x0180, 0x0300, 0]
STEER = [0x0014, 0x0014, 0x0008, 0]
GRIP  = [0x0010, 0x0010, 0x0003, 0]
CRASH_FRAMES = 50

# Segments in driving order from the bottom of the map:
# rows, road left col, road right col (exclusive), verge width, kind (0 road, 1 water)
SEGS = [
    (60, 12, 28, 3, 0),
    (6, 13, 27, 3, 0),
    (6, 14, 26, 3, 0),
    (30, 16, 24, 2, 0),
    (8, 13, 27, 3, 0),
    (50, 10, 30, 0, 1),
    (60, 12, 28, 3, 0),
]

SCRIPT = [
    (60, UP),
    (40, UP | LEFT),
    (40, UP),
    (40, UP | RIGHT),
    (30, UP),
    (30, UP | LEFT),
    (60, DOWN),
    (60, UP),
    (20, 0),
    (60, UP),
    (14, UP | LEFT),
    (30, UP),
    (14, UP | RIGHT),
    (10, UP),
]


def build():
    m = bytearray(MAP_H * W)
    centre = bytearray(MAP_H)
    r = MAP_H - 1
    for rows, rl, rr, v, kind in SEGS:
        for _ in range(rows):
            for c in range(W):
                if kind:
                    t = 0xA0 if rl <= c < rr else 0xE0
                elif c < rl - v or c >= rr + v:
                    t = 0xE0
                elif c < rl or c >= rr:
                    t = 0x60
                elif c == (rl + rr) >> 1 and (r & 3) < 2:
                    t = 0x3A
                else:
                    t = 0x20
                m[r * W + c] = t
            centre[r] = (rl + rr) >> 1
            r -= 1
    assert r == -1
    return m, centre


MAP, CENTRE = build()


class Car:
    def __init__(s):
        s.x = (CENTRE[MAP_H - 1] * 8 - 8) << 8
        s.vx = 0
        s.speed = 0
        s.dfrac = 0
        s.dpix = 0
        s.surface = C_ROAD
        s.crash_t = 0
        s.crashes = 0

    def cls(s, px, yy):
        w = BASE * 8 + yy - s.dpix
        return MAP[(w >> 3) * W + (px >> 3)] >> 6

    def update(s, inp):
        if s.crash_t:
            s.crash_t -= 1
            if s.crash_t == 0:
                row = (BASE * 8 + CAR_Y + WHEEL_F - s.dpix) >> 3
                s.x = (CENTRE[row] * 8 - 8) << 8
                s.surface = C_ROAD
            return
        # speed
        vm = VMAX[s.surface]
        if inp & UP:
            if s.speed < vm:
                s.speed += ACCEL
        elif inp & DOWN:
            s.speed = s.speed - BRAKE if s.speed > BRAKE else 0
        else:
            s.speed = s.speed - COAST if s.speed > COAST else 0
        if s.speed > vm:
            s.speed = s.speed - OVERDRAG if s.speed - OVERDRAG > vm else vm
        # scroll accumulator
        t = s.dfrac + (s.speed & 0xFF)
        s.dfrac = t & 0xFF
        s.dpix += (s.speed >> 8) + (t >> 8)
        # lateral
        su = s.surface
        if s.speed >= STEER_MIN and inp & LEFT:
            s.vx -= STEER[su]
        elif s.speed >= STEER_MIN and inp & RIGHT:
            s.vx += STEER[su]
        elif s.vx > 0:
            s.vx = s.vx - GRIP[su] if s.vx > GRIP[su] else 0
        elif s.vx < 0:
            s.vx = s.vx + GRIP[su] if -s.vx > GRIP[su] else 0
        if s.vx > VXMAX:
            s.vx = VXMAX
        if s.vx < -VXMAX:
            s.vx = -VXMAX
        s.x = (s.x + s.vx) & 0xFFFF
        # surface probe: four wheels, worst class wins
        px = s.x >> 8
        c = max(s.cls(px + WHEEL_L, CAR_Y + WHEEL_F), s.cls(px + WHEEL_R, CAR_Y + WHEEL_F),
                s.cls(px + WHEEL_L, CAR_Y + WHEEL_B), s.cls(px + WHEEL_R, CAR_Y + WHEEL_B))
        # response
        if c == C_CRASH:
            s.crash_t = CRASH_FRAMES
            s.speed = 0
            s.vx = 0
            s.crashes += 1
        else:
            s.surface = c


def rol_fold(chk, v):
    chk = ((chk << 1) | (chk >> 15)) & 0xFFFF
    return ((chk ^ v) + 13) & 0xFFFF


def run(verbose=False):
    car = Car()
    chk = 0
    f = 0
    seen = 0
    for n, inp in SCRIPT:
        for _ in range(n):
            car.update(inp)
            st = car.surface | (0x10 if car.crash_t else 0)
            seen |= 1 << (4 if car.crash_t else car.surface)
            for v in (car.x, car.speed, car.dpix, st):
                chk = rol_fold(chk, v)
            if verbose:
                print(f, hex(inp), 'x', car.x >> 8, hex(car.x & 255), 'sp', hex(car.speed), 'vx', car.vx,
                      'd', car.dpix, 'surf', car.surface, 'crash', car.crash_t)
            f += 1
    return car, chk, f, seen


if __name__ == '__main__':
    car, chk, f, seen = run('-v' in sys.argv)
    top = BASE - (car.dpix >> 3)
    print('frames', f, 'chk %04X' % chk, 'x %04X' % car.x, 'speed %04X' % car.speed, 'dpix', car.dpix,
          'top', top, 'yscroll', car.dpix & 7, 'crashes', car.crashes, 'seen %02X' % seen)
```

## Why this works

The distance is a 16.8 number: a whole-pixel word `dpix` and a fraction
byte. Each frame adds the speed, and the carry out of the fraction byte
moves into the pixel word, so 2.81 pixels a frame advances 2 or 3 pixels
and never drifts. The scroll follows from the distance and nothing else:
the top map row on screen is `BASE - (dpix >> 3)` and YSCROLL is
`dpix & 7`, so the probes and the picture cannot disagree. The screen
pixel `yy` lines below line 48 shows map pixel row
`BASE * 8 + yy - dpix`, which is what the probes index. With RSEL 0 the
25-row matrix covers the 24-row window at every YSCROLL.

The probes are two map rows, looked up once through a row-offset table,
and two columns in each, the wheel points of a 16-pixel body. The worst
class of the four wins (rock over water over verge over road), so one
wheel on the verge slows the car and one wheel on rock crashes it. The
class is the tile code shifted right six times; in ECM the same two bits
pick the background colour, so the drawing and the rule come from one
byte. A lateral speed of at most 1.5 pixels a frame and a forward speed
of at most 4 are both under a tile, so no probe steps over a tile
between frames.

Up adds the acceleration only below the surface's limit. Over it, the
over-limit drag is the only change, so a car that runs onto the verge
with the throttle held slows by 0.06 a frame, from 4.0 to 1.5 in 40
frames. If up still added its 0.05 the net fall would be 0.016 a frame,
160 frames to reach 1.5 (arithmetic), and the verge would barely slow a
car at full throttle.

The sprite's Y register is set to `47 + CAR_Y` because a sprite at Y
register n is drawn from raster line n + 1: the first build used
`48 + CAR_Y` and the PNG check found the car one line below the model's
probe rows, 16 mismatched pixels on each model.

The redraw is the scroll's work, not the car's. A crossing needs the
whole matrix rewritten one row lower. At up to 4 pixels a frame
crossings are at least two frames apart, so the hidden matrix is drawn
for the next top row half a matrix a frame, 10,110 cycles on PAL and
10,368 on NTSC, and `$D018` flips to it on the first frame the top row
equals it. A variant of this listing that copies the whole matrix in
one frame measured 20,330 cycles on PAL and 20,414 on NTSC, more than a
frame on either (19,656 and 17,095). `refused`
counts crossings that arrive before the hidden matrix is ready; it is 0,
and the verdict requires that. Colour RAM needs no move because ECM
takes the colour from the tile code.

The speed is per frame, so on NTSC the road passes 20% faster in real
time for the same script; the checksum is the same on both models
because the logic runs once per frame on both.

## Verification

VICE x64sc 3.10, windowless build, Oscar64 as installed on 2026-09-23.

**Every pixel against the model.** A script predicted each pixel of the
display window (lines 55 to 246, 320 columns) from the model's map, the
end distance and YSCROLL, and the char ROM for the lane-mark glyph,
skipping the HUD rows and the sprite's box: 53,424 pixels, 0 mismatches
on PAL and on NTSC. The sprite's yellow pixels were located separately
and give car x 145, the model's value.

**Text and border.** Rows 1 to 3 were decoded against
`chargen-901225-01.bin` and read as quoted above; the border pixel is
colour 5 on each model.

**Reproducibility.** The pinned command was run twice per model; the
PNG bytes were identical each time.

## Sources

None. The map, the rules, the constants and the code are original; the
game style is named only as the brief for the design.
