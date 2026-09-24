---
recipe: beat-em-up-lanes
toolchain: oscar64
output_format: PRG
region: both
techniques: [lane_depth_engine]
file_formats: [PRG]
uses_registers: [D000, D001, D010, D011, D015, D01B, D020, D021, D027, DC06, DC07, DC0F]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 beat-em-up lanes: a four-lane ground plane, a Y-sort that sets sprite priority, and hits gated by a Y window and an active-frame table

## Synopsis

A player and three enemies move on a ground plane drawn as tile rows in
four lane colours. Each actor has a plane Y, the line its feet stand on;
a higher plane Y is nearer the viewer. Every frame a persistent
insertion sort orders the four actors by plane Y and the draw gives the
nearest actor hardware sprite 0 and the farthest sprite 3, so a nearer
actor is drawn over a farther one by the VIC-II's own index priority.
Attacks are tested in the same order. A hit connects only when the
target's plane Y is within six lines of the attacker's, the target is
14 to 34 pixels away on the side the attacker faces, and the attack is
on one of the two active frames of its six-frame animation, read from
a per-frame table. All four actors run scripts that repeat every 256
frames: eight attacks, three of them out of the lane. At the end of
each pass the program checks the attack count, the hit count, the hit
log against the window and the sort order; `$02FF` = `01` and a green
border on a pass, `02` and red otherwise (`headless-verify.md`). The
HUD shows the sort order, each actor's lane, the counts and the CIA1
timer B cycles of the sort and of the whole engine step. This is the
`lane_depth_engine` technique from `docs/techniques/logic.md`.

## Source

```c
// beat-em-up-lanes.c
//
// A ground plane of four lanes drawn as tile rows. A player and three
// enemies move on it under a script; a higher plane Y is nearer the
// viewer. Every frame a persistent insertion sort orders the actors by
// plane Y, the nearest actor is given hardware sprite 0 and the farthest
// sprite 3, so nearer actors are drawn over farther ones. Attacks are
// tested in the same order. A hit connects only when the target is
// within WIN lines of the attacker in plane Y, within reach in X on the
// side the attacker faces, and the attack is on one of its active
// animation frames from a per-frame table.
// Rows 0-6: HUD. Rows 8-9: wall. Rows 10-22: the plane, one colour per
// lane. Scripts repeat every 256 frames; at the end of each pass the
// counts are checked: $02FF = 01 and a green border on a pass, 02 and
// red if not. A fail is sticky.
//
#include <c64/vic.h>
#include <c64/cia.h>

#define Screen  ((char *)0x0400)
#define Color   ((char *)0xd800)
#define SprData ((char *)0x3000)            // blocks 192..195
#define SPR_BLK 192
#define VR      ((volatile char *)0xd000)
#define PTR     ((volatile char *)0x07f8)
#define RESULT  (*(volatile char *)0x02ff)

// --- the plane --------------------------------------------------------------
#define N_ACT     4
#define PLANE_TOP 130                       // plane Y of the far edge, feet line
#define LANE_H    25
#define N_LANES   4
#define WIN       6                         // hit window in plane Y, either side
#define REACH_MIN 14                        // target X minus attacker X, facing right
#define REACH_MAX 34
#define ANIM_RATE 4                         // display frames per animation frame
#define ATT_LEN   6                         // animation frames in an attack
#define STUN      8                         // frames the target flashes

// --- the active-frame table: image per attack frame, and whether it hits --
const char att_image[ATT_LEN]  = { 1, 1, 2, 2, 1, 0 };
const char att_active[ATT_LEN] = { 0, 0, 1, 1, 0, 0 };

// --- actors, parallel arrays ------------------------------------------------
int  ax[N_ACT];                             // sprite X of the left edge
char ay[N_ACT];                             // plane Y: the feet line
char aface[N_ACT];                          // 0 right, 1 left
char acol[N_ACT];
char aatt[N_ACT];                           // 0 idle, else attack frame + 1
char aanim[N_ACT];                          // display frames left on this frame
char alanded[N_ACT];                        // a hit was already scored this attack
char astun[N_ACT];

// --- the scripts: dx, dy, frames, kind (0 walk, 1 attack, 2 wait) --------
struct Step { signed char dx, dy; char n, kind; };

const struct Step scr_p[]  = { {2,0,36,0}, {0,0,30,1}, {0,1,20,0}, {0,0,30,1},
                               {0,1,15,0}, {0,0,30,1}, {0,0,95,2}, {0,0,0,2} };
const struct Step scr_e0[] = { {0,0,60,2}, {0,1,50,0}, {0,0,10,2}, {0,0,30,1},
                               {0,-1,16,0}, {0,0,4,2}, {0,0,30,1}, {0,0,56,2}, {0,0,0,2} };
const struct Step scr_e1[] = { {0,0,140,2}, {0,0,30,1}, {0,-1,40,0}, {0,0,46,2}, {0,0,0,2} };
const struct Step scr_e2[] = { {0,0,100,2}, {2,0,40,0}, {0,0,30,1}, {0,2,31,0},
                               {0,0,30,1}, {0,0,25,2}, {0,0,0,2} };
const struct Step *const scripts[N_ACT] = { scr_p, scr_e0, scr_e1, scr_e2 };
char sstep[N_ACT], sleft[N_ACT];

// --- the sort -----------------------------------------------------------------
char order[N_ACT];                          // actor indices, far to near; persistent

void sort_depth(void)
{
    for (char i = 1; i < N_ACT; i++) {
        char a = order[i];
        char y = ay[a];
        char j = i;
        while (j > 0 && ay[order[j - 1]] > y) {
            order[j] = order[j - 1];
            j--;
        }
        order[j] = a;
    }
}

// --- the draw: nearest actor into sprite 0 ------------------------------------
void draw_actors(void)
{
    char msb = 0;
    for (char s = 0; s < N_ACT; s++) {
        char a = order[N_ACT - 1 - s];
        int x = ax[a];
        VR[s * 2] = (char)x;
        VR[s * 2 + 1] = ay[a] - 21;
        if (x & 0x100)
            msb |= 1 << s;
        char img = 0;
        if (aatt[a]) {
            img = att_image[aatt[a] - 1];
            if (img == 2 && aface[a])
                img = 3;                    // the left-facing punch
        }
        PTR[s] = SPR_BLK + img;
        VR[0x27 + s] = astun[a] ? 1 : acol[a];
    }
    VR[0x10] = msb;
}

// --- the hit test, in sort order ------------------------------------------------
char hits, attacks, outwin, maxdy;
char hit_ya[16], hit_yt[16];                // the hit log: both plane Ys at the hit

void hit_test(void)
{
    for (char k = 0; k < N_ACT; k++) {
        char a = order[k];
        if (!aatt[a] || !att_active[aatt[a] - 1] || alanded[a])
            continue;
        for (char t = 0; t < N_ACT; t++) {
            if (t == a)
                continue;
            char dy = ay[t] > ay[a] ? ay[t] - ay[a] : ay[a] - ay[t];
            if (dy > WIN)
                continue;                   // not in the lane
            int dx = aface[a] ? ax[a] - ax[t] : ax[t] - ax[a];
            if (dx < REACH_MIN || dx > REACH_MAX)
                continue;                   // out of reach, or behind
            if (hits < 16) {
                hit_ya[hits] = ay[a];
                hit_yt[hits] = ay[t];
            }
            hits++;
            alanded[a] = 1;
            astun[t] = STUN;
        }
    }
}

// --- the monitor: every logged hit re-checked against the window -------------
void monitor_hits(void)
{
    maxdy = 0;
    outwin = 0;
    for (char i = 0; i < hits && i < 16; i++) {
        int d = (int)hit_yt[i] - (int)hit_ya[i];
        if (d < 0) d = -d;
        if (d > maxdy) maxdy = d;
        if (d > WIN) outwin++;
    }
}

// --- the script and animation step --------------------------------------------
void step_actors(void)
{
    for (char a = 0; a < N_ACT; a++) {
        if (astun[a]) astun[a]--;
        if (aatt[a]) {
            if (--aanim[a] == 0) {
                aanim[a] = ANIM_RATE;
                if (++aatt[a] > ATT_LEN)
                    aatt[a] = 0;
            }
        }
        if (sleft[a] == 0) {
            const struct Step *s = scripts[a] + sstep[a];
            if (s->n == 0) {                // end: restart the script
                sstep[a] = 0;
                s = scripts[a];
            }
            sleft[a] = s->n;
            if (s->kind == 1) {
                aatt[a] = 1;
                aanim[a] = ANIM_RATE;
                alanded[a] = 0;
                attacks++;
            }
        }
        const struct Step *s = scripts[a] + sstep[a];
        if (s->kind == 0) {
            ax[a] += s->dx;
            ay[a] += s->dy;
        }
        if (--sleft[a] == 0)
            sstep[a]++;
    }
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

unsigned time1(void (*fn)(void))
{
    __asm { sei }
    timer_start();
    fn();
    unsigned t = timer_stop();
    __asm { cli }
    return t;
}

// --- images: a body, a wind-up, a punch right, a punch left ---------------
void make_images(void)
{
    for (unsigned i = 0; i < 4 * 64; i++)
        SprData[i] = 0;
    for (char f = 0; f < 4; f++) {
        char *p = SprData + f * 64;
        p[0 * 3 + 1] = 0x3c; p[1 * 3 + 1] = 0x3c;   // head
        for (char r = 3; r < 21; r++)
            p[r * 3 + 1] = 0xff;                    // body
        if (f == 1) {
            for (char r = 8; r < 11; r++)
                p[r * 3 + 1] = 0x7e;                // wind-up
        } else if (f == 2) {
            for (char r = 8; r < 11; r++)
                p[r * 3 + 2] = 0xff;                // arm to the right
        } else if (f == 3) {
            for (char r = 8; r < 11; r++)
                p[r * 3 + 0] = 0xff;                // arm to the left
        }
    }
}

// --- text (screen codes) ----------------------------------------------------
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

// --- the plane as tile rows ----------------------------------------------------
const char lane_col[N_LANES] = { 9, 8, 11, 12 };

void draw_plane(void)
{
    for (char c = 0; c < 80; c++) {          // rows 8 and 9: a wall
        Screen[8 * 40 + c] = 0xa0;
        Color[8 * 40 + c] = 6;
    }
    for (char r = 10; r < 23; r++) {
        char py = r * 8 + 57;                // plane Y of the row's last line
        char lane = (py - PLANE_TOP) / LANE_H;
        if (lane >= N_LANES) lane = N_LANES - 1;
        for (char c = 0; c < 40; c++) {
            Screen[r * 40 + c] = ((r + c) & 1) ? 0x66 : 0xa0;
            Color[r * 40 + c] = lane_col[lane];
        }
    }
}

// Start of a pass: positions, facing and scripts. order[] is not reset;
// the persistent sort repairs it on the next frame.
void reset_actors(void)
{
    ax[0] = 100; ay[0] = 165; aface[0] = 0; acol[0] = 7;
    ax[1] = 200; ay[1] = 165; aface[1] = 1; acol[1] = 2;
    ax[2] = 200; ay[2] = 200; aface[2] = 1; acol[2] = 5;
    ax[3] =  60; ay[3] = 140; aface[3] = 0; acol[3] = 14;
    for (char a = 0; a < N_ACT; a++) {
        aatt[a] = 0; aanim[a] = 0; alanded[a] = 0; astun[a] = 0;
        sstep[a] = 0; sleft[a] = 0;
    }
}

// --- expected results per pass ---------------------------------------------------
#define EXP_ATTACKS 8
#define EXP_HITS    5
const char exp_order[N_ACT] = { 2, 1, 0, 3 };

int main(void)
{
    vic.color_border = 0;
    vic.color_back = 0;
    for (unsigned i = 0; i < 1000; i++) {
        Screen[i] = 0x20;
        Color[i] = 1;
    }
    make_images();
    draw_plane();
    for (char a = 0; a < N_ACT; a++)
        order[a] = a;
    reset_actors();

    put_str(Screen + 0,      s"lane depth engine   frame       pass");
    put_str(Screen + 1 * 40, s"result");
    put_str(Screen + 2 * 40, s"order far>near          expect 2 1 0 3");
    put_str(Screen + 3 * 40, s"lane  p0   e1   e2   e3    win 6");
    put_str(Screen + 4 * 40, s"attacks    hits    expect 5  outwin");
    put_str(Screen + 5 * 40, s"sort max      min      rev      fwd");
    put_str(Screen + 6 * 40, s"dy max    engine max      min");

    // The sort's cost, display blanked: a reversed order (worst case) and
    // an already sorted one (best case), less an empty call.
    vic.ctrl1 &= ~VIC_CTRL1_DEN;
    vic_waitFrame();
    vic_waitFrame();
    unsigned t_none = time1(nothing);
    ay[0] = 200; ay[1] = 180; ay[2] = 160; ay[3] = 140;
    order[0] = 0; order[1] = 1; order[2] = 2; order[3] = 3;
    unsigned t_rev = time1(sort_depth) - t_none;
    unsigned t_fwd = time1(sort_depth) - t_none;
    vic.ctrl1 |= VIC_CTRL1_DEN;
    put_dec(Screen + 5 * 40 + 27, t_rev, 3);
    put_dec(Screen + 5 * 40 + 36, t_fwd, 3);
    reset_actors();

    VR[0x15] = 0x0f;
    VR[0x1b] = 0;
    char frame = 0, pass = 0, fault = 0;
    unsigned total = 0, s_max = 0, s_min = 0xffff, e_max = 0, e_min = 0xffff;

    for (;;) {
        vic_waitFrame();
        step_actors();
        __asm { sei }
        timer_start();
        sort_depth();
        unsigned ts = timer_stop();
        timer_start();
        draw_actors();
        char before = hits;
        hit_test();
        unsigned te = timer_stop() + ts;    // the engine step: sort, draw, hit test
        __asm { cli }
        if (ts > s_max) s_max = ts;
        if (ts < s_min) s_min = ts;
        if (te > e_max) e_max = te;
        if (te < e_min) e_min = te;
        if (hits != before)
            monitor_hits();                 // re-check the whole log on each new hit

        put_dec(Screen + 26, total, 5);
        put_dec(Screen + 37, pass, 2);
        for (char k = 0; k < N_ACT; k++)
            Screen[2 * 40 + 15 + k * 2] = 0x30 + order[k];
        for (char a = 0; a < N_ACT; a++)
            Screen[3 * 40 + 8 + a * 5] = 0x30 + (ay[a] - PLANE_TOP) / LANE_H;
        put_dec(Screen + 4 * 40 + 8, attacks, 2);
        put_dec(Screen + 4 * 40 + 16, hits, 2);
        put_dec(Screen + 4 * 40 + 36, outwin, 2);
        put_dec(Screen + 5 * 40 + 9, s_max, 4);
        put_dec(Screen + 5 * 40 + 18, s_min, 4);
        put_dec(Screen + 6 * 40 + 7, maxdy, 2);
        put_dec(Screen + 6 * 40 + 21, e_max, 4);
        put_dec(Screen + 6 * 40 + 30, e_min, 4);

        total++;
        if (++frame == 0) {                 // end of a 256-frame pass
            if (attacks != EXP_ATTACKS) fault = 1;
            if (hits != EXP_HITS) fault = 2;
            if (outwin || maxdy > WIN) fault = 3;
            for (char k = 0; k < N_ACT; k++)
                if (order[k] != exp_order[k]) fault = 4;
            RESULT = fault ? 2 : 1;
            vic.color_border = fault ? 2 : 5;
            put_str(Screen + 40 + 7, fault ? s"fail" : s"pass");
            Screen[40 + 12] = 0x30 + fault;
            pass++;
            attacks = 0; hits = 0; outwin = 0; maxdy = 0;
            reset_actors();                 // the next pass replays the fight
        }
    }
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=beat-em-up-lanes.prg beat-em-up-lanes.c
```

Produces `beat-em-up-lanes.prg`, 3,226 bytes. The four sprite images
are built at run time at `$3000`, blocks 192 to 195. Then run headless
in VICE (PAL):

```bash
GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas x64sc -default -warp +sound \
  +autostart-delay-random -autostartprgmode 1 -limitcycles 11200000 \
  -exitscreenshot beat-em-up-lanes.png -autostart beat-em-up-lanes.prg
```

Add `-model ntsc` for the NTSC picture. A pass is 256 frames; the
verdict is posted at the end of the first pass, and the pinned cycle
count lands in the second pass, PAL at pass frame 154 and NTSC at pass
frame 209, both with a punch on screen.

## Expected output

The actors, their start positions and their scripts. Actor 0 is the
player (yellow, faces right); 1, 2 and 3 are enemies (red and green
facing left, light blue facing right). Plane Y 130 to 229 is four lanes
of 25 lines; lane = (plane Y - 130) / 25.

| Actor | Start X, plane Y | Script (frames of the pass) |
|---|---|---|
| 0 | 100, 165 | walk right to X 172 (0-35); attack (36-65); walk down to Y 185 (66-85); attack (86-115); walk down to Y 200 (116-130); attack (131-160); wait |
| 1 | 200, 165 | wait; walk down to Y 215 (60-109); wait; attack (120-149); walk up to Y 199 (150-165); wait; attack (170-199); wait |
| 2 | 200, 200 | wait; attack (140-169); walk up to Y 160 (170-209); wait |
| 3 | 60, 140 | wait; walk right to X 140 (100-139); attack (140-169); walk down to Y 202 (170-200); attack (201-230); wait |

An attack is six animation frames of four display frames each; frames
3 and 4 (display frames 8 to 15 of the attack) are active. Worked from
the table: eight attacks, five hits (0 on 1 at Y 165; 0 on 2 and 2 on 0
at Y 200; 1 on 0 with Y 199 against 200; 3 on 0 with Y 202 against
200), three attacks that miss because the only target in reach is 15
or more lines away in plane Y, the largest Y difference at a hit 2, and
the order far to near at the end of the pass 2 1 0 3 (plane Y 160, 199,
200, 202).

Measured in VICE x64sc 3.10 with the pinned command, text decoded
against the character ROM (rows 0 to 6). PAL, frame 410, pass 1 frame
154, mid-fight: actor 2 punching actor 0 (flashing white from the
hit) and actor 3 punching into an empty lane:

```text
LANE DEPTH ENGINE   FRAME 00410 PASS 01
RESULT PASS 0
ORDER FAR>NEAR 3 0 2 1  EXPECT 2 1 0 3
LANE  P02  E13  E22  E30   WIN 6
ATTACKS 06 HITS 03 EXPECT 5  OUTWIN 00
SORT MAX 0269 MIN 0174 REV 262  FWD 157
DY MAX 00 ENGINE MAX 1413 MIN 0784
```

NTSC, frame 465, pass 1 frame 209: actor 3 punching actor 0 from two
lines nearer:

```text
LANE DEPTH ENGINE   FRAME 00465 PASS 01
RESULT PASS 0
ORDER FAR>NEAR 2 1 0 3  EXPECT 2 1 0 3
LANE  P02  E12  E21  E32   WIN 6
ATTACKS 08 HITS 05 EXPECT 5  OUTWIN 00
SORT MAX 0279 MIN 0174 REV 262  FWD 157
DY MAX 01 ENGINE MAX 1413 MIN 0784
```

`RESULT PASS 0` is the first pass's verdict: 8 attacks, 5 hits, no hit
outside the window, order 2 1 0 3. A run to 16,000,000 cycles shows
pass 2 green on both models with the same figures, so the pass reset
replays the fight exactly. Border green, `$02FF` = `01`.

The priority assignment, measured on the PAL picture: at pass frame 154
actor 1 (red, plane Y 210, walking up) and actor 2 (green, plane Y 200)
stand at the same X 200; on the lines both bodies cover the pixel is
red (175, 60, 88), the nearer actor, and above the overlap it is green
(98, 213, 50).

The cycle figures, CIA1 timer B, interrupts masked, Oscar64 `-O2`:

| Figure | Cycles | Conditions |
|---|---|---|
| Sort, four actors in reverse order | 262 | screen blanked, less an empty call |
| Sort, four actors already in order | 157 | screen blanked, less an empty call |
| Sort per frame, worst and best over the run | 269 PAL, 279 NTSC, and 174 | screen on, sprites on; the peak is the sort with badline stalls inside it, and where they land moves with the code |
| Engine step (sort, draw, hit test), worst and best | 1,413 and 784 | screen on; the worst frame is one with an active attack and badline stalls inside it |

The best engine step is 784: the sort plus the four-sprite draw on a
frame with no active attack, which does no pair tests. An earlier
version of this page gave it as 84; the HUD printed the figure with two
digits and the leading 7 was cut, which a four-digit field now shows.
The NTSC sort peak of 279 is not a different sort: the same code on
the PAL run peaks at 269, and a build eight bytes longer read 269 on
NTSC at the pinned frame and 279 later in the run. The screenshots are
`screenshots/beat-em-up-lanes.png` and
`screenshots/beat-em-up-lanes-ntsc.png`.

## Why this works

The sort is the whole engine. `order[]` holds actor indices far to near
and is never reset: each frame the insertion sort repairs it, so an
actor that has not passed a neighbour costs one compare and the whole
pass over four actors is 157 to 279 cycles. The draw walks `order[]`
from the near end and writes actor `order[3 - s]` into hardware sprite
`s`: position, `$D010` bit, pointer and colour all move with the actor,
because the VIC-II draws a lower-numbered sprite over a higher one and
that is the only priority it has between sprites. A tie in plane Y is
left in its previous order, which is what a stable insertion sort does
by itself. `hit_test` walks the same order, so with more actors the
pair loop can stop early on the Y compare.

A hit passes three gates, cheapest first. The Y window first: the
absolute difference of two plane Ys against `WIN`, one byte compare,
which fails for most pairs. Then reach, a signed 16-bit difference with
the sign chosen by the attacker's facing, so an attack cannot connect
behind the attacker. Then the frame gate, which is not a compare at all:
`att_active[]` is indexed by the attack's animation frame, the same
index that picks the image in `att_image[]`, so the frames on which the
punch image shows are the frames on which it can land, and `alanded`
stops one attack scoring twice on its second active frame. Actor 0's
second attack and one attack each from actors 1 and 3 have the only
target in reach 15 or more lines away, and those are the three misses
the count expects.

The monitor checks the window independently. Each
hit logs both plane Ys at the moment it connects; `monitor_hits`
recomputes the difference as a signed int over the whole log and counts
any above the window. It re-checks the log at the moment of each new
hit rather than against the actors' later positions, which an earlier
version of this listing did and which reported six violations on a
correct fight. The pass reset restores positions and scripts but leaves
`order[]` alone, which is the point of a persistent sort; the second
pass then reproduces the first's counts, and a run to 16,000,000
cycles confirms it.
