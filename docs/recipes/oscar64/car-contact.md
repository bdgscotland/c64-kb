---
recipe: car-contact
toolchain: oscar64
output_format: PRG
region: both
techniques: [car_contact_response]
file_formats: [PRG]
uses_registers: [D000, D001, D010, D011, D012, D015, D017, D01B, D01C, D01D, D020, D021, D027, DC06, DC07, DC0F]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 car contact: push apart on the shallow axis, trade velocity by mass, crash off the road

## Synopsis

A top-down road strip, grass on the left and water on the right, with six
cars on scripts: the player (white), three light cars and two trucks.
Every frame each pair of cars is tested; a pair that overlaps is pushed
apart along the axis where the overlap is smaller, and its velocities on
that axis are exchanged as an elastic collision between masses 1 and 7,
using shifts, not multiplies. After a hit both cars cool for eight frames,
during which that pair is still pushed apart but gets no second kick.
Then each car's centre is looked up in a tile map; a car on grass or water
has crashed and stops. One 256-frame pass holds five scenes: the player
side-swipes a light car into the water; a light car bumps another from
behind and hands over its speed; the player hits a truck that moves
5 pixels; a truck hits two light cars in the same frame and both go onto
the grass; and the player steers hard into the stopped truck, stays in
contact for nine frames with overlaps of 4 and 5 pixels, and shoves it
onto the grass. Every frame the cars' positions, velocities and crash
flags are folded into a checksum; the Python model on this page predicts
`$01E9` for the pass. At the end of each pass the program checks the
checksum, the hit count and the crash flags: `$02FF` = `01` and a green
border on a pass, `02` and red otherwise (`headless-verify.md`). The HUD
shows the cycles per pair, for two light cars and for a truck, and per
frame. This is the `car_contact_response` technique from
`docs/techniques/logic.md`.

## Source

```c
// car-contact.c
//
// Top-down road: grass left, water right, road between. Six cars on
// scripts: the player (white) and five enemies, three light and two heavy
// trucks. Each frame: scripts, move, then contact response for every pair
// (separate along the axis of least overlap, exchange velocity on that
// axis scaled by mass, no impulse while both cars are cooling), then a
// tile probe that crashes a car whose centre is off the road.
// Scenes in one 256-frame pass: the player side-swipes a light car into
// the water; a light car bumps another from behind; the player hits a
// truck that barely moves; a truck hits two light cars in one frame and
// both go onto the grass; the player holds its steering into a truck for
// nine frames of contact and shoves it onto the grass. Every frame the positions, velocities and crash
// flags are folded into a checksum that a Python model of the same rules
// predicts. At the end of a pass: $02FF = 01 and a green border on a pass,
// 02 and red on a fail.
//
#include <c64/vic.h>
#include <c64/cia.h>

#define Screen  ((char *)0x0400)
#define Color   ((char *)0xd800)
#define SprData ((char *)0x3000)            // blocks 192, 193
#define SPR_BLK 192
#define VR      ((volatile char *)0xd000)
#define PTR     ((volatile char *)0x07f8)
#define RESULT  (*(volatile char *)0x02ff)

// --- the road as a tile map: 0 road, 1 grass, 2 water -------------------
#define ROAD_L  9                           // first road column
#define ROAD_R  26                          // last road column
#define TOP_ROW 7                           // rows 0-6 are the HUD
char tmap[25 * 40];
unsigned rowoff[25];

// --- cars, parallel arrays; x and y are 8.8, the centre of the body -----
#define MAXC 8
#define N_GAME 6
#define COOL 8                              // frames without impulse after one
#define FR   4                              // coasting drag, 1/256 px per frame

unsigned cx[MAXC], cy[MAXC];
int  vx[MAXC], vy[MAXC];
char crash[MAXC], cool[MAXC], drv[MAXC];
char heavy[MAXC], hw[MAXC], hh[MAXC];       // mass class, half width, half height
char ncars;
char hits, contacts;

// --- scripts: vx, vy, frames, drive (1 holds the velocity, 0 coasts) ------
struct Step { int vx, vy; char n, drive; };

const struct Step s0[] = { {0,0,1,1}, {384,0,10,1}, {0,0,50,0}, {-383,0,16,1},
                           {0,0,93,0}, {-1536,0,12,1}, {0,0,0,0} };
const struct Step s1[] = { {0,0,1,1}, {0,0,0,0} };
const struct Step s3[] = { {0,0,1,1}, {0,0,0,0} };
const struct Step s4[] = { {0,0,1,1}, {0,-192,33,1}, {0,0,30,0}, {0,-128,28,1},
                           {0,0,1,1}, {0,0,0,0} };
const struct Step s5[] = { {0,0,120,1}, {-384,0,1,1}, {0,0,0,0} };
const struct Step *const scripts[N_GAME] = { s0, s1, s1, s3, s4, s5 };
char sstep[N_GAME], sleft[N_GAME];

const unsigned start_x[N_GAME] = { 160 << 8, 185 << 8, 140 << 8, 120 << 8, 120 << 8, 165 << 8 };
const unsigned start_y[N_GAME] = { 200 << 8, 196 << 8, 200 << 8, 150 << 8, 190 << 8, 142 << 8 };
const char kind[N_GAME]    = { 0, 0, 1, 0, 0, 1 };      // 1 truck
const char col[N_GAME]     = { 1, 7, 8, 3, 13, 4 };

void set_kind(char c, char k)
{
    heavy[c] = k;
    hw[c] = k ? 7 : 5;
    hh[c] = k ? 10 : 8;
}

// --- mass: who takes how much of a push and of an impulse -----------------
// Light and heavy are masses 1 and 7. A push of pen pixels is split
// equally between equal masses; otherwise the heavy car takes pen >> 2.
// The velocity change on the contact axis is the elastic one for those
// masses: j gains g, i loses 2rv - g, with g = rv (equal), rv >> 2 (j
// heavy) or 2rv - (rv >> 2) (i heavy). No multiply.

void pair(char i, char j)
{
    char yi = cy[i] >> 8, yj = cy[j] >> 8;
    char ady = yj >= yi ? yj - yi : yi - yj;
    char sy = hh[i] + hh[j];
    if (ady >= sy)
        return;                             // apart in Y: most pairs end here
    char xi = cx[i] >> 8, xj = cx[j] >> 8;
    char adx = xj >= xi ? xj - xi : xi - xj;
    char sx = hw[i] + hw[j];
    if (adx >= sx)
        return;
    contacts++;
    char ox = sx - adx, oy = sy - ady;
    bool xaxis = ox < oy;
    char pen = xaxis ? ox : oy;
    char ai, aj;
    if (heavy[i] == heavy[j]) {
        ai = pen >> 1; aj = pen - ai;
    } else if (heavy[i]) {
        ai = pen >> 2; aj = pen - ai;
    } else {
        aj = pen >> 2; ai = pen - aj;
    }
    bool jpos = xaxis ? xj >= xi : yj >= yi;  // j lies on the + side of i
    unsigned *p = xaxis ? cx : cy;
    int *v = xaxis ? vx : vy;
    if (jpos) {
        p[i] -= (unsigned)ai << 8; p[j] += (unsigned)aj << 8;
    } else {
        p[i] += (unsigned)ai << 8; p[j] -= (unsigned)aj << 8;
    }
    int rv = v[i] - v[j];
    bool closing = jpos ? rv > 0 : rv < 0;
    if (!closing || (cool[i] && cool[j]))
        return;                             // separating, or this pair just hit
    int g;
    if (heavy[i] == heavy[j])
        g = rv;
    else if (heavy[j])
        g = rv >> 2;
    else
        g = 2 * rv - (rv >> 2);
    v[j] += g;
    v[i] -= 2 * rv - g;
    cool[i] = COOL;
    cool[j] = COOL;
    hits++;
}

void contact_pass(void)
{
    for (char i = 0; i + 1 < ncars; i++) {
        if (crash[i])
            continue;
        for (char j = i + 1; j < ncars; j++) {
            if (!crash[j])
                pair(i, j);
        }
    }
}

// A car whose centre is on a grass or water tile has crashed.
void probe(void)
{
    for (char c = 0; c < ncars; c++) {
        if (crash[c])
            continue;
        char tc = ((char)(cx[c] >> 8) - 24) >> 3;
        char tr = ((char)(cy[c] >> 8) - 50) >> 3;
        char k = tmap[rowoff[tr] + tc];
        if (k) {
            crash[c] = k;
            vx[c] = 0;
            vy[c] = 0;
        }
    }
}

// --- scripts and movement (fixed_point_8_8), not part of the timed step ---
int drag(int v)
{
    if (v > 0) {
        v -= FR;
        if (v < 0) v = 0;
    } else if (v < 0) {
        v += FR;
        if (v > 0) v = 0;
    }
    return v;
}

void drive_and_move(void)
{
    for (char c = 0; c < N_GAME; c++) {
        if (cool[c]) cool[c]--;
        if (crash[c])
            continue;
        const struct Step *s = scripts[c] + sstep[c];
        if (sleft[c] == 0 && s->n)
            sleft[c] = s->n;
        drv[c] = 0;
        if (s->n) {
            if (s->drive) {
                vx[c] = s->vx;
                vy[c] = s->vy;
                drv[c] = 1;
            }
            if (--sleft[c] == 0)
                sstep[c]++;
        }
    }
    for (char c = 0; c < N_GAME; c++) {
        if (crash[c])
            continue;
        if (!drv[c]) {
            vx[c] = drag(vx[c]);
            vy[c] = drag(vy[c]);
        }
        cx[c] += vx[c];
        cy[c] += vy[c];
    }
}

void reset_cars(void)
{
    ncars = N_GAME;
    for (char c = 0; c < N_GAME; c++) {
        cx[c] = start_x[c];
        cy[c] = start_y[c];
        vx[c] = 0; vy[c] = 0;
        crash[c] = 0; cool[c] = 0; drv[c] = 0;
        sstep[c] = 0; sleft[c] = 0;
        set_kind(c, kind[c]);
    }
    hits = 0;
    contacts = 0;
}

// --- checksum: the same fold as the Python model ------------------------
unsigned cs;

void fold(unsigned v)
{
    cs = (cs << 1) | (cs >> 15);
    cs ^= v;
    cs += 13;
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

char pi, pj;
__noinline void nothing(void) { }
__noinline void one_pair(void) { pair(pi, pj); }
__noinline void one_step(void) { contact_pass(); probe(); }

unsigned time1(void (*fn)(void))
{
    __asm { sei }
    timer_start();
    fn();
    unsigned t = timer_stop();
    __asm { cli }
    return t;
}

// Two cars in slots 6 and 7 at given centres and velocities.
void stage2(char x0, char y0, int v0, char x1, char y1, int v1, char cl, char k0, char k1)
{
    ncars = MAXC;
    set_kind(6, k0); set_kind(7, k1);
    cx[6] = (unsigned)x0 << 8; cy[6] = (unsigned)y0 << 8; vx[6] = v0; vy[6] = 0;
    cx[7] = (unsigned)x1 << 8; cy[7] = (unsigned)y1 << 8; vx[7] = v1; vy[7] = 0;
    crash[6] = 0; crash[7] = 0;
    cool[6] = cl; cool[7] = cl;
    pi = 6; pj = 7;
}

// Eight cars in a pile-up: slot k at a column and row of a grid, every
// car closing on its neighbours. dx, dy are the grid steps.

void stage8(char dx, char dy)
{
    ncars = MAXC;
    for (char k = 0; k < MAXC; k++) {
        set_kind(k, k == 2 || k == 5);
        cx[k] = (unsigned)(150 + (k & 1) * dx) << 8;
        cy[k] = (unsigned)(120 + (k >> 1) * dy) << 8;
        vx[k] = (k & 1) ? -256 : 256;
        vy[k] = 192 - (k >> 1) * 128;
        crash[k] = 0;
        cool[k] = 0;
    }
    hits = 0;
    contacts = 0;
}

// Eight cars packed so that all 28 pairs are still in contact when their
// turn comes and 7 get an impulse, the most one pass allows (each impulse
// needs a car that is not yet cooling). Found by search on the Python model.
const unsigned pile_x[MAXC] = { 150 << 8, 150 << 8, 151 << 8, 150 << 8, 150 << 8, 151 << 8, 150 << 8, 151 << 8 };
const unsigned pile_y[MAXC] = { 120 << 8, 122 << 8, 120 << 8, 122 << 8, 122 << 8, 121 << 8, 120 << 8, 120 << 8 };
const int pile_vx[MAXC] = { 256, 256, -256, -256, 256, -256, -256, -256 };
const int pile_vy[MAXC] = { 256, -256, 256, -256, -256, 256, 256, 256 };
const char pile_k[MAXC] = { 1, 1, 0, 0, 0, 0, 0, 0 };

void stage_pile(void)
{
    ncars = MAXC;
    for (char k = 0; k < MAXC; k++) {
        set_kind(k, pile_k[k]);
        cx[k] = pile_x[k];
        cy[k] = pile_y[k];
        vx[k] = pile_vx[k];
        vy[k] = pile_vy[k];
        crash[k] = 0;
        cool[k] = 0;
    }
    hits = 0;
    contacts = 0;
}

// --- sprite images: a light car and a truck -----------------------------
void make_images(void)
{
    for (char i = 0; i < 128; i++)
        SprData[i] = 0;
    // car: columns 7-16, rows 2-17 (10 x 16), centred on column 12, row 10
    for (char r = 2; r < 18; r++) {
        SprData[r * 3 + 0] = 0x01;
        SprData[r * 3 + 1] = 0xff;
        SprData[r * 3 + 2] = 0x80;
    }
    // truck: columns 5-18, rows 0-19 (14 x 20)
    for (char r = 0; r < 20; r++) {
        SprData[64 + r * 3 + 0] = 0x07;
        SprData[64 + r * 3 + 1] = 0xff;
        SprData[64 + r * 3 + 2] = 0xe0;
    }
}

void draw_cars(void)
{
    for (char c = 0; c < N_GAME; c++) {
        VR[c * 2] = (char)(cx[c] >> 8) - 12;     // every car stays below X 256
        VR[c * 2 + 1] = (char)(cy[c] >> 8) - 10;
        PTR[c] = SPR_BLK + heavy[c];
        VR[0x27 + c] = col[c];
    }
    VR[0x10] = 0;
}

void draw_road(void)
{
    for (char r = 0; r < 25; r++) {
        rowoff[r] = r * 40;
        for (char c = 0; c < 40; c++) {
            char k = c < ROAD_L ? 1 : (c > ROAD_R ? 2 : 0);
            tmap[rowoff[r] + c] = k;
            if (r >= TOP_ROW) {
                unsigned o = rowoff[r] + c;
                Screen[o] = 0xa0;
                Color[o] = k == 1 ? 5 : (k == 2 ? 6 : 11);
                if (k == 0 && (c == 17 || c == 18) && (r & 1))
                    Color[o] = 15;          // centre dashes
            }
        }
    }
}

// --- text (screen codes) ------------------------------------------------------
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

void put_hex(char *p, unsigned v)
{
    for (char i = 4; i > 0; i--) {
        char d = v & 15;
        p[i - 1] = d < 10 ? 0x30 + d : d - 9;
        v >>= 4;
    }
}

// --- expected results of one pass, from the Python model --------------------
#define EXP_CS    0x01e9
#define EXP_HITS  7
const char exp_crash[N_GAME] = { 0, 2, 1, 1, 1, 0 };

int main(void)
{
    vic.color_border = 0;
    vic.color_back = 0;
    for (unsigned i = 0; i < 1000; i++) {
        Screen[i] = 0x20;
        Color[i] = 1;
    }
    make_images();
    draw_road();

    put_str(Screen + 0,      s"car contact response  frame       pass");
    put_str(Screen + 1 * 40, s"result        cs      expect");
    put_str(Screen + 2 * 40, s"hits    expect 7  contacts    cr");
    put_str(Screen + 3 * 40, s"pair far     xmiss     hit     cool");
    put_str(Screen + 4 * 40, s"step max      min       mean");
    put_str(Screen + 5 * 40, s"grid       h   c    pile       h   c");
    put_str(Screen + 6 * 40, s"truck hit i     j     cool i     j");

    // Per-pair and staged worst-frame costs, display blanked, less an
    // empty call.
    vic.ctrl1 &= ~VIC_CTRL1_DEN;
    vic_waitFrame();
    vic_waitFrame();
    for (char c = 0; c < N_GAME; c++)
        crash[c] = 1;                       // the game slots sit out
    unsigned t_none = time1(nothing);
    stage2(150, 100, 0, 150, 200, 0, 0, 0, 0);
    unsigned t_far = time1(one_pair) - t_none;
    stage2(150, 100, 0, 180, 104, 0, 0, 0, 0);
    unsigned t_xmiss = time1(one_pair) - t_none;
    stage2(150, 100, 256, 158, 102, -256, 0, 0, 0);
    unsigned t_hit = time1(one_pair) - t_none;
    stage2(150, 100, 256, 158, 102, -256, COOL, 0, 0);
    unsigned t_cool = time1(one_pair) - t_none;
    stage2(150, 100, 256, 158, 102, -256, 0, 1, 0);
    unsigned t_hit_i = time1(one_pair) - t_none;   // i is the truck
    stage2(150, 100, 256, 158, 102, -256, 0, 0, 1);
    unsigned t_hit_j = time1(one_pair) - t_none;   // j is the truck
    stage2(150, 100, 256, 158, 102, -256, COOL, 1, 0);
    unsigned t_cool_i = time1(one_pair) - t_none;
    stage2(150, 100, 256, 158, 102, -256, COOL, 0, 1);
    unsigned t_cool_j = time1(one_pair) - t_none;
    stage8(8, 14);                          // a 2 x 4 grid, neighbours touching
    unsigned t_grid = time1(one_step) - t_none;
    char grid_hits = hits, grid_contacts = contacts;
    stage_pile();                           // all 28 pairs in contact
    unsigned t_pile = time1(one_step) - t_none;
    char pile_hits = hits, pile_contacts = contacts;
    vic.ctrl1 |= VIC_CTRL1_DEN;
    put_dec(Screen + 3 * 40 + 9, t_far, 3);
    put_dec(Screen + 3 * 40 + 19, t_xmiss, 3);
    put_dec(Screen + 3 * 40 + 27, t_hit, 3);
    put_dec(Screen + 3 * 40 + 36, t_cool, 3);
    put_dec(Screen + 6 * 40 + 12, t_hit_i, 3);
    put_dec(Screen + 6 * 40 + 18, t_hit_j, 3);
    put_dec(Screen + 6 * 40 + 29, t_cool_i, 3);
    put_dec(Screen + 6 * 40 + 35, t_cool_j, 3);
    put_dec(Screen + 5 * 40 + 5, t_grid, 5);
    put_dec(Screen + 5 * 40 + 12, grid_hits, 2);
    put_dec(Screen + 5 * 40 + 16, grid_contacts, 2);
    put_dec(Screen + 5 * 40 + 25, t_pile, 5);
    put_dec(Screen + 5 * 40 + 32, pile_hits, 2);
    put_dec(Screen + 5 * 40 + 36, pile_contacts, 2);
    put_hex(Screen + 1 * 40 + 29, EXP_CS);

    reset_cars();
    cs = 0;
    VR[0x15] = (1 << N_GAME) - 1;
    VR[0x1b] = 0;
    VR[0x1c] = 0;
    VR[0x17] = 0;
    VR[0x1d] = 0;
    char frame = 0, pass = 0, fault = 0;
    unsigned total = 0, s_max = 0, s_min = 0xffff, s_mean = 0;
    unsigned long s_sum = 0;                // over one pass, for the mean

    for (;;) {
        vic_waitFrame();
        drive_and_move();
        __asm { sei }
        timer_start();
        contact_pass();
        probe();
        unsigned ts = timer_stop();
        __asm { cli }
        if (ts > s_max) s_max = ts;
        if (ts < s_min) s_min = ts;
        s_sum += ts;
        draw_cars();
        for (char c = 0; c < N_GAME; c++) {
            fold(cx[c]);
            fold(cy[c]);
            fold(vx[c]);
            fold(vy[c]);
            fold(crash[c]);
        }
        vic_waitBelow(112);                 // write the HUD after the beam has passed it

        put_dec(Screen + 28, total, 5);
        put_dec(Screen + 39, pass, 1);
        put_hex(Screen + 1 * 40 + 17, cs);
        put_dec(Screen + 2 * 40 + 5, hits, 2);
        put_dec(Screen + 2 * 40 + 27, contacts, 2);
        for (char c = 0; c < N_GAME; c++)
            Screen[2 * 40 + 33 + c] = 0x30 + crash[c];
        put_dec(Screen + 4 * 40 + 9, s_max, 4);
        put_dec(Screen + 4 * 40 + 18, s_min, 4);
        put_dec(Screen + 4 * 40 + 29, s_mean, 4);

        total++;
        if (++frame == 0) {                 // end of a 256-frame pass
            if (cs != EXP_CS) fault = 1;
            if (hits != EXP_HITS) fault = 2;
            for (char c = 0; c < N_GAME; c++)
                if (crash[c] != exp_crash[c]) fault = 3;
            RESULT = fault ? 2 : 1;
            vic.color_border = fault ? 2 : 5;
            put_str(Screen + 40 + 7, fault ? s"fail" : s"pass");
            Screen[40 + 12] = 0x30 + fault;
            pass++;
            s_mean = s_sum >> 8;            // 256 frames
            s_sum = 0;
            reset_cars();
            cs = 0;
        }
    }
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=car-contact.prg car-contact.c
```

Produces `car-contact.prg`, 4,442 bytes. The two sprite images are built
at run time at `$3000`, blocks 192 and 193. Then run headless in VICE
(PAL):

```bash
GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas x64sc -default -warp +sound \
  +autostart-delay-random -autostartprgmode 1 -limitcycles 11880000 \
  -exitscreenshot car-contact.png -autostart car-contact.prg
```

Add `-model ntsc` for the NTSC picture. A pass is 256 frames; the verdict
is posted at the end of the first pass. The pinned cycle count lands in
the second pass: PAL at pass frame 181, in the middle of the shove, and
NTSC at pass frame 237, after every scene has ended.

## Expected output

The cars, their masses and boxes, and the scenes. X and Y are the centre
of the body in sprite coordinates; a light car's body is 10 x 16 pixels,
a truck's 14 x 20. The road is tile columns 9 to 26, VIC X 96 to 239;
columns below 9 are grass, above 26 water. Velocities are 8.8 fixed point
in 1/256 pixel per frame; drag while coasting is 4 per frame on each axis.

| Car | Kind, colour | Start | Script |
|---|---|---|---|
| 0 | light, white (player) | 160, 200 | steer right at 384 for frames 1-10; coast; steer left at -383 for frames 61-76; coast; steer left at -1536 for frames 170-181; coast |
| 1 | light, yellow | 185, 196 | coast |
| 2 | truck, orange | 140, 200 | coast |
| 3 | light, cyan | 120, 150 | coast |
| 4 | light, light green | 120, 190 | drive up at -192 for frames 1-33; coast; drive up at -128 for frames 64-91; stop; coast |
| 5 | truck, purple | 165, 142 | wait; at frame 120 launched left at -384; coast |

The events of one pass, from the Python model below; the checksum makes
the C run agree with it on every frame:

| Pass frame | Event |
|---|---|
| 11 | Side-swipe. The player (vx 380) touches car 1 from the left; equal masses swap, so the player's vx is 0 and car 1's is 380, 1.48 pixels a frame. |
| 33 | Bump from behind. Car 4 (vy -192) runs into car 3; car 3 takes vy -192 and car 4 stops. |
| 61 | Car 1's centre reaches X 240, a water tile: crashed. |
| 77 | Heavy truck. The player (vx -379 after drag) hits truck 2. The truck gets -95, the player bounces to +284. The truck coasts from X 140 to 135 and stops. |
| 145 | Two contacts in one frame. Truck 5 (vx -284) reaches cars 3 and 4. Car 3 gets -497; the truck slows to -213; car 4 then gets -373 and the truck -160. |
| 158, 163 | Cars 3 and 4 reach X 95, a grass tile: crashed. |
| 177 | Shove. The player (vx -1536) reaches truck 2 with a 5-pixel overlap. The truck is pushed 1 pixel (`5 >> 2`) and the player 4; the truck gets -384 and the player +1152. |
| 178-184 | Both cars cooling. The player's steering sets vx back to -1536 each frame to 181, then it coasts. Each frame the pair overlaps by 4 or 5 pixels, the truck is pushed 1 pixel and the player the rest, and no impulse is given. |
| 185 | Cooling over. A second impulse: the truck gets -644, the player +524. |
| 193 | Truck 2 reaches X 95, a grass tile: crashed. |

At the end of the pass: 7 impulses, 14 overlapping pair-frames, crash
flags `0 2 1 1 1 0` (0 on the road, 1 grass, 2 water), checksum `$01E9`.

Measured in VICE x64sc 3.10 with the pinned command, text decoded against
the character ROM (rows 0 to 6). PAL, frame 437, pass 1 frame 181:

```text
CAR CONTACT RESPONSE  FRAME 00437 PASS 1
RESULT PASS 0 CS 455B EXPECT 01E9
HITS 06 EXPECT 7  CONTACTS 10 CR 020110
PAIR FAR 087 XMISS 147 HIT 634 COOL 505
STEP MAX 3695 MIN 0828  MEAN 2081
GRID 10949 H07 C12  PILE 17549 H07 C28
TRUCK HIT I 701 J 666 COOL I 513 J 513
```

NTSC, frame 493, pass 1 frame 237:

```text
CAR CONTACT RESPONSE  FRAME 00493 PASS 1
RESULT PASS 0 CS B052 EXPECT 01E9
HITS 07 EXPECT 7  CONTACTS 14 CR 021110
PAIR FAR 087 XMISS 147 HIT 634 COOL 505
STEP MAX 3910 MIN 0828  MEAN 2152
GRID 10949 H07 C12  PILE 17549 H07 C28
TRUCK HIT I 701 J 666 COOL I 513 J 513
```

`RESULT PASS 0` is the first pass's verdict. `CS` is the running checksum
of the pass so far, and both values equal the Python model's at the same
frame (`$455B` at 181, `$B052` at 237). `CR` is the six crash flags.
`MEAN` is the mean of the timed step over the 256 frames of the previous
pass. A run to 16,000,000 cycles shows pass 2 green on both models, with
`MEAN` 2,079 on PAL and 2,152 on NTSC for pass 1. Border green, `$02FF` =
`01`.

The picture, measured with PIL: every pixel of each car's colour below
the HUD, as a bounding box, with VIC X = PNG x - 8 and sprite Y = raster
line - 1 (a sprite at Y first shows on raster line Y + 1,
`hardware/vic-ii-reference.md`). All six boxes have the body size of
their kind, and every centre equals the model's.

| Car | PAL (model frame 181) | NTSC (model frame 238) |
|---|---|---|
| 0 | 136, 200, against the truck | 213, 200 |
| 1 | 240, 196, in the water | 240, 196, in the water |
| 2 | 124, 200, being shoved left | 95, 200, on the grass |
| 3 | 95, 132, on the grass | 95, 132, on the grass |
| 4 | 95, 152, on the grass | 95, 152, on the grass |
| 5 | 118, 142 | 118, 142 |

On PAL the player's left edge (136 - 5) meets the truck's right edge
(124 + 7) at X 131: the push leaves the pair just touching. The HUD is
written after the beam has passed row 6 (`vic_waitBelow(112)`), so all
seven rows come from one frame. The PAL shot shows frame 181's cars under
frame 181's HUD; the NTSC shot lands after frame 238 has written the
sprite registers and before it has written the text. The road edges
measured on the PAL picture: grass to VIC X 95, road from 96, water from
240. The screenshots are `screenshots/car-contact.png` and
`screenshots/car-contact-ntsc.png`.

The cycle figures, CIA1 timer B, interrupts masked, Oscar64 `-O2`:

| Figure | Cycles | Conditions |
|---|---|---|
| One pair, apart in Y | 87 | screen blanked, one call through a wrapper, less an empty call |
| One pair, overlapping in Y, apart in X | 147 | as above |
| One pair of light cars in contact, pushed apart and given an impulse | 634 | as above |
| The same pair while both cool, pushed apart only | 505 | as above |
| A truck and a light car in contact with an impulse, the truck as `i` | 701 | as above; `g = 2 * rv - (rv >> 2)` |
| The same, the truck as `j` | 666 | as above; `g = rv >> 2` |
| A truck and a light car while both cool, the truck as `i` or as `j` | 513 | as above |
| Contact step, 8 cars in a 2 x 4 grid, neighbours overlapping by 2 pixels | 10,949 | screen blanked; 28 pairs tested, 12 contacts, 7 impulses; includes the tile probe |
| Contact step, 8 cars packed so that all 28 pairs are in contact | 17,549 | screen blanked; 28 contacts, 7 impulses; includes the probe |
| Contact step in the game, worst and best frame over two passes | 3,695 PAL, 3,910 NTSC, and 828 | screen on, six cars, up to 15 pairs and the probe |
| Contact step in the game, mean over one 256-frame pass | 2,081 PAL (2,079 for the second pass), 2,152 NTSC | as above |

The packed pile is the most a contact step can do with eight cars: all 28
pairs are in contact when their turn comes, and 7 impulses is the most one
pass allows, because an impulse needs a car that is not yet cooling and
the first one uses two. Its start positions and velocities were found by
a search over the Python model. It is a built frame, not a bound: its
contacts are a mix of light and truck pairs. The bound by arithmetic
(rung 3) takes the same counts with every impulse at the dearest measured
pair, 701, and every other contact at 513: 17,549 + 7 x (701 - 634) +
21 x (513 - 505) = 18,186 cycles, on the assumption that no contact in
the pile costs less than the light-car figures. That bound was not
measured. The best game frame, 828, comes after the crashes: a crashed
car leaves the pair loop. The in-game peak differs between PAL and NTSC because different badlines and
sprite DMA land inside the timed region.

The Python side of the checksum:

```python
# The rules of car-contact.c in Python, same integers, same order.
# Prints the checksum of one 256-frame pass: 0x1e9.

N = 6
COOL = 8
FR = 4
ROAD_L, ROAD_R = 9, 26          # road columns inclusive; <9 grass (1), >26 water (2)

def cls(col):
    if col < ROAD_L: return 1
    if col > ROAD_R: return 2
    return 0

# light 0, heavy 1
MASS = [0, 0, 1, 0, 0, 1]
HW   = [5, 5, 7, 5, 5, 7]
HH   = [8, 8, 10, 8, 8, 10]
START = [(160,200),(185,196),(140,200),(120,150),(120,190),(165,142)]
# script steps: (vx, vy, n, drive); n == 0 ends: coast for ever
SCR = [
    [(0,0,1,1),(384,0,10,1),(0,0,50,0),(-383,0,16,1),(0,0,93,0),(-1536,0,12,1),(0,0,0,0)],
    [(0,0,1,1),(0,0,0,0)],
    [(0,0,1,1),(0,0,0,0)],
    [(0,0,1,1),(0,0,0,0)],
    [(0,0,1,1),(0,-192,33,1),(0,0,30,0),(0,-128,28,1),(0,0,1,1),(0,0,0,0)],
    [(0,0,120,1),(-384,0,1,1),(0,0,0,0)],
]

class W: pass

def reset():
    w = W()
    w.x = [s[0] << 8 for s in START]
    w.y = [s[1] << 8 for s in START]
    w.vx = [0]*N; w.vy = [0]*N; w.crash = [0]*N; w.cool = [0]*N
    w.step = [0]*N; w.left = [0]*N; w.drive = [0]*N
    w.hits = 0; w.contacts = 0
    return w

def drive(w):
    for c in range(N):
        if w.cool[c]: w.cool[c] -= 1
        if w.crash[c]: continue
        if w.left[c] == 0:
            s = SCR[c][w.step[c]]
            if s[2] == 0:
                w.drive[c] = 0
            else:
                w.left[c] = s[2]
        s = SCR[c][w.step[c]]
        if s[2] and s[3]:
            w.vx[c] = s[0]; w.vy[c] = s[1]; w.drive[c] = 1
        else:
            w.drive[c] = 0
        if s[2]:
            w.left[c] -= 1
            if w.left[c] == 0: w.step[c] += 1

def fric(v):
    if v > 0:
        v -= FR
        if v < 0: v = 0
    elif v < 0:
        v += FR
        if v > 0: v = 0
    return v

def move(w):
    for c in range(N):
        if w.crash[c]: continue
        if not w.drive[c]:
            w.vx[c] = fric(w.vx[c]); w.vy[c] = fric(w.vy[c])
        w.x[c] = (w.x[c] + w.vx[c]) & 0xffff
        w.y[c] = (w.y[c] + w.vy[c]) & 0xffff

def share(pen, mi, mj):
    if mi == mj:
        ai = pen >> 1; aj = pen - ai
    elif mi:
        ai = pen >> 2; aj = pen - ai
    else:
        aj = pen >> 2; ai = pen - aj
    return ai, aj

def impulse(rv, mi, mj):
    if mi == mj: g = rv
    elif mj: g = rv >> 2
    else: g = 2*rv - (rv >> 2)
    return g, 2*rv - g        # dv_j = +g, dv_i = -(2rv - g)

def pair(w, i, j):
    dy = (w.y[j] >> 8) - (w.y[i] >> 8)
    oy = HH[i] + HH[j] - abs(dy)
    if oy <= 0: return
    dx = (w.x[j] >> 8) - (w.x[i] >> 8)
    ox = HW[i] + HW[j] - abs(dx)
    if ox <= 0: return
    w.contacts += 1
    mi, mj = MASS[i], MASS[j]
    both = w.cool[i] and w.cool[j]
    if ox < oy:
        ai, aj = share(ox, mi, mj)
        if dx >= 0:
            w.x[i] -= ai << 8; w.x[j] += aj << 8
        else:
            w.x[i] += ai << 8; w.x[j] -= aj << 8
        rv = w.vx[i] - w.vx[j]
        app = rv > 0 if dx >= 0 else rv < 0
        if app and not both:
            g, h = impulse(rv, mi, mj)
            w.vx[j] += g; w.vx[i] -= h
            w.cool[i] = w.cool[j] = COOL; w.hits += 1
    else:
        ai, aj = share(oy, mi, mj)
        if dy >= 0:
            w.y[i] -= ai << 8; w.y[j] += aj << 8
        else:
            w.y[i] += ai << 8; w.y[j] -= aj << 8
        rv = w.vy[i] - w.vy[j]
        app = rv > 0 if dy >= 0 else rv < 0
        if app and not both:
            g, h = impulse(rv, mi, mj)
            w.vy[j] += g; w.vy[i] -= h
            w.cool[i] = w.cool[j] = COOL; w.hits += 1
    w.x[i] &= 0xffff; w.x[j] &= 0xffff; w.y[i] &= 0xffff; w.y[j] &= 0xffff

def contacts(w):
    for i in range(N - 1):
        if w.crash[i]: continue
        for j in range(i + 1, N):
            if w.crash[j]: continue
            pair(w, i, j)

def probe(w):
    for c in range(N):
        if w.crash[c]: continue
        col = ((w.x[c] >> 8) - 24) >> 3
        k = cls(col)
        if k:
            w.crash[c] = k; w.vx[c] = 0; w.vy[c] = 0

def fold(cs, v):
    cs = ((cs << 1) | (cs >> 15)) & 0xffff
    cs ^= v & 0xffff
    return (cs + 13) & 0xffff

def run(frames=256, stop=None):
    w = reset(); cs = 0
    for f in range(frames):
        drive(w); move(w); contacts(w); probe(w)
        for c in range(N):
            cs = fold(cs, w.x[c]); cs = fold(cs, w.y[c])
            cs = fold(cs, w.vx[c]); cs = fold(cs, w.vy[c])
            cs = fold(cs, w.crash[c])
        if stop is not None and f == stop:
            return w, cs
    return w, cs

w, cs = run()
print(hex(cs), w.hits, w.crash)
```

## Why this works

The pair test is ordered so most pairs cost one compare. Cars on a road
are spread along it, so the Y distance is taken first from the high bytes
of the 8.8 centres and compared with the two half heights; 87 cycles end
a pair there. Only a pair that overlaps in both axes computes the two
overlaps, and the smaller one is the axis to resolve: two cars side by
side overlap a little in X and a lot in Y, so they are pushed sideways,
and a nose-to-tail pair the other way. A tie goes to Y.

Mass is two numbers, both from shifts. The push that removes the overlap
is split in half between equal cars; a truck takes `pen >> 2` of it and
the light car the rest. That share is a chosen value that keeps a truck
nearly still, not the mass ratio (1/8). The velocity change on the
contact axis is the elastic one for masses 1 and 7 (arithmetic, rung 3):
with `rv` the closing velocity, the car on the far side gains `g` and the
near one loses `2 * rv - g`, where `g` is `rv` for equal masses, `rv >> 2`
when the far car is the truck (2/8 of `2 * rv`) and `2 * rv - (rv >> 2)`
when the near one is. Momentum is kept to the rounding of one shift.
Equal cars therefore swap their velocities on that axis, which is the
side-swipe and the bump from behind; a light car hitting a truck bounces
off and the truck moves by a quarter of the closing speed, which is why
truck 2 coasts 5 pixels.

The shift must be arithmetic: `rv >> 2` of -379 is -95, where a divide
that truncates gives -94. The player's -383 steer was chosen so that this
case occurs in the pass. Built with `rv / 4` in place of `rv >> 2`, the
program fails on the checksum alone (fault 1), everything else equal;
built with `rv >> 1`, car 4 stays on the road and the crash check fails
(fault 3). In assembly, halving a signed value is `cmp #$80 / ror` on the
high byte, then `ror` on the low byte (`asr1` in `sine_table_generation`),
not `lsr`, which would turn -2 into +127 in a byte.

An impulse needs the pair to be closing, and not both cars cooling. The
closing test compares the sign of `rv` with the side the other car is on,
a signed compare. Positions are still separated during the cooling time,
so a car held against a truck by its driver stays against it instead of
passing through, but cannot kick it again every frame: in the shove the
pair is in contact for nine frames and gets two impulses, eight frames
apart. The shove is also what the checksum uses to check both rules.
Built with no cooling test, the shove gives an impulse on every closing
frame, 10 impulses in the pass, the player follows the truck onto the grass
and the crash check fails (fault 3). Built with the truck taking
`pen >> 1` of the push, the checksum fails (fault 1). Each result was
run in VICE and matches the Python model with the same change.

The cooling counter is per car, not per pair. A car that is cooling can
still be hit by a third car that is not: the truck in the double contact
gives an impulse to car 3 and then to car 4 in the same frame, because
car 4 was not cooling. The other side of this: two cars that have each
just hit something else get no impulse on their first touch with each
other, only the push.

The tile probe runs after the pair loop, because a push can move a car
onto a verge. It reads the class of the tile under the car's centre from
a map in RAM (`tile_grid_collision`), never screen RAM, so the HUD or a
redraw cannot change what counts as road. The probe does not check its
row: a centre above sprite Y 50, or at 250 or below, gives a tile row
outside 0 to 24 and reads past `rowoff`. The cars here stay between
Y 132 and 200; a car that can leave the screen needs the row clamped.
Every car stays below X 256 on this road, so `$D010` is always 0; a
wider road needs the ninth bit.

The checksum is a second computation, not the first repeated: the Python
model on this page runs the same rules on its own integers and predicts
the pass's value, and the HUD's running value matches the model's at the
frame each screenshot shows. An earlier build stored the start positions
as bytes and shifted them left by 8 in `reset_cars`; the Oscar64 build on
this machine compiled that loop as `LDA start_x,Y / TAY / LDA start_y,Y`,
so each Y came from the wrong entry and the checksum failed. The fault
reduces to a short program: two `const char` tables read with one index,
each shifted left by 8 into an `unsigned` array, in a loop that also calls
a `__noinline` function. Run in VICE, it is wrong at `-O1`, `-O2`, `-O3`
and `-Os` and right at `-O0`; it is recorded in issue #30. The listing
stores the start positions, and the pile's, as 8.8 words.
