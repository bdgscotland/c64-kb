---
recipe: sprite-animation-table
toolchain: oscar64
output_format: PRG
region: both
techniques: [sprite_animation_table]
file_formats: [PRG]
uses_registers: [D000, D001, D010, D011, D015, D020, D021, D027, DC06, DC07, DC0F]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 Sprite Animation Tables: frames and durations in data, events on entry, priority on request

## Synopsis

Six actors animate from tables. An animation is a list of (frame,
duration) entries ending in an action: loop to entry N, hold the last
frame, or return to another animation. Bit 7 of a frame byte marks an
event fired when the entry is entered. Each actor keeps its animation,
its entry and a countdown, and a step is one decrement on most frames.
Facing adds 8 to the sprite block number. A script of requests runs
121 frames: a looping walk, an idle, a rise that plays entry 0 once and
loops from entry 1, an attack that fires on its third entry and returns
to idle, a hurt that cuts an attack off before it fires, a death that
holds its last frame, two requests refused by priority and two ignored
because the animation is already running. The engine logs every event
with its frame number. A second model walks the tables from each
animation's start instead of counting down; it computes the expected
log and the final sprite pointers, and the program compares both. The
screen shows the pointers read back from `$07F8` beside the model's, the
log, and CIA1 timer B cycles per step. `$02FF` = `01` and a green border
on a pass, `02` and red otherwise (`headless-verify.md`). This is the
`sprite_animation_table` technique from `docs/techniques/sprite.md`.

## Source

```c
// sprite-animation-table.c
//
// Sprite animation driven by tables. An animation is a list of
// (frame, duration) entries ending in an action: loop to entry N, hold
// the last frame, or return to another animation. Bit 7 of a frame byte
// marks an event that fires when the entry is entered. Each actor keeps
// its animation, its entry and a countdown; a step is one decrement on
// most frames. Facing is an offset of 8 into the sprite block numbers.
// Six actors run a script of requests, two of them refused by priority.
// The engine logs events with frame numbers; a second model, which walks
// the tables from the start of each animation instead of counting down,
// computes the expected log and the final sprite pointers.
// Rows 0-1: title and verdict. Rows 3-8: per actor, the animation, the
// pointer the VIC reads at $07F8 + n and the one the model predicts.
// Sprites 0-5 stand below them. Rows 13-15: events and CIA1 timer B
// cycles. Row 16 on: the event log. $02FF = 01 and a green border when
// the log and every pointer match; 02 and red otherwise.
//
#include <c64/vic.h>
#include <c64/cia.h>

#define Screen  ((char *)0x0400)
#define SprPtr  ((volatile char *)0x07f8)  // screen + $3F8: the VIC's pointers
#define SprData ((char *)0x3000)          // block 192 = $3000 / 64 in bank 0
#define SPR_BLK 192                       // blocks 192-199 face right
#define FACE_L  8                         // blocks 200-207 face left
#define RESULT  (*(volatile char *)0x02ff)

// --- the tables ---------------------------------------------------------
// One flat pair of arrays holds every animation; anim_first[] is where
// each starts. A frame byte 0-7 is an image, | EV_FIRE marks an event.
// An end entry's frame byte is an action and its duration byte the
// argument: END_LOOP (entry index to loop to), END_HOLD (unused),
// END_RETURN (animation to return to).
#define EV_FIRE    0x80
#define END_LOOP   0xf0
#define END_HOLD   0xf1
#define END_RETURN 0xf2

#define AN_IDLE   0
#define AN_WALK   1
#define AN_ATTACK 2
#define AN_HURT   3
#define AN_DEATH  4
#define AN_RISE   5
#define AN_TFAST  6                       // timing only: advances every step
#define AN_TSLOW  7                       // timing only: never advances
#define ANIMS     8
#define AN_NONE   0xff

const char afrm[] = {
    0, 1, END_LOOP,                             // 0 idle
    2, 3, 4, 3, END_LOOP,                       // 3 walk
    5, 6, 7 | EV_FIRE, 6, END_RETURN,           // 8 attack: fires on entry 3
    1, 0, 1, 0, END_RETURN,                     // 13 hurt
    4, 5, 6, 7, END_HOLD,                       // 18 death: holds frame 7
    0, 2, 3, END_LOOP,                          // 23 rise: entry 0 once
    0, 1, END_LOOP,                             // 27 timing, fast
    0, END_LOOP                                 // 30 timing, slow
};
const char adur[] = {
    20, 20, 0,
    6, 6, 6, 6, 0,
    4, 4, 8, 4, AN_IDLE,
    3, 3, 3, 3, AN_IDLE,
    5, 5, 5, 5, 0,
    10, 8, 8, 1,                                // rise loops to entry 1
    1, 1, 0,
    255, 0
};
const char anim_first[ANIMS] = { 0, 3, 8, 13, 18, 23, 27, 30 };
// A request is refused while the running animation has a higher
// priority. Death holds forever at the top priority.
const char anim_prio[ANIMS]  = { 0, 0, 1, 2, 3, 0, 0, 0 };

// --- per-actor state ----------------------------------------------------
#define ACTORS 6
char cur[ACTORS];                         // running animation
char pos[ACTORS];                         // entry, an index into afrm/adur
char count[ACTORS];                       // frames left on this entry
char held[ACTORS];                        // 1 after END_HOLD, or no animation
char base[ACTORS];                        // SPR_BLK, + FACE_L when facing left

// --- the event log ------------------------------------------------------
#define LG_FIRE    1
#define LG_DONE    2
#define LG_REFUSED 3
#define MAXLOG 16
unsigned frame;
char nlog;
unsigned lf[MAXLOG];
char la[MAXLOG], le[MAXLOG];

void log_ev(char a, char ev)
{
    if (nlog < MAXLOG) {
        lf[nlog] = frame;
        la[nlog] = a;
        le[nlog] = ev;
    }
    nlog++;
}

// Actor a has moved to entry pos[a]: run end actions until a real entry,
// load its countdown, fire its event, set the sprite pointer.
void enter(char a)
{
    char p = pos[a];
    char f = afrm[p];
    while (f >= END_LOOP) {
        if (f == END_LOOP)
            p = anim_first[cur[a]] + adur[p];
        else if (f == END_RETURN) {
            log_ev(a, LG_DONE);
            cur[a] = adur[p];
            p = anim_first[cur[a]];
        } else {                            // END_HOLD: stay on the last entry
            log_ev(a, LG_DONE);
            held[a] = 1;
            pos[a] = p - 1;
            return;
        }
        f = afrm[p];
    }
    pos[a] = p;
    count[a] = adur[p];
    if (f & EV_FIRE)
        log_ev(a, LG_FIRE);
    SprPtr[a] = base[a] + (f & 7);
}

// The per-frame step. On most frames it is one decrement.
void step(char a)
{
    if (held[a])
        return;
    if (--count[a] == 0) {
        pos[a]++;
        enter(a);
    }
}

// A request: the same animation again is ignored, not restarted; a lower
// priority than the running one is refused and logged.
void request(char a, char an)
{
    if (an == cur[a])
        return;
    if (cur[a] != AN_NONE && anim_prio[an] < anim_prio[cur[a]]) {
        log_ev(a, LG_REFUSED);
        return;
    }
    cur[a] = an;
    held[a] = 0;
    pos[a] = anim_first[an];
    enter(a);
}

// Facing picks the other half of the block numbers; the entry is kept.
void set_face(char a, char left)
{
    base[a] = left ? SPR_BLK + FACE_L : SPR_BLK;
    if (cur[a] != AN_NONE)
        SprPtr[a] = base[a] + (afrm[pos[a]] & 7);
}

// --- the script ---------------------------------------------------------
#define C_FACE_L 0x40
#define C_FACE_R 0x41
struct Cmd { char f, a, c; };
const struct Cmd script[] = {
    {  0, 0, AN_RISE },   {  0, 1, AN_WALK },   {  0, 1, C_FACE_L },
    {  0, 2, AN_IDLE },   {  0, 3, AN_IDLE },   {  0, 4, AN_IDLE },
    {  0, 5, AN_WALK },
    { 10, 2, AN_ATTACK },                       // fires at 18, done at 30
    { 14, 2, AN_WALK },                         // refused: attack outranks walk
    { 20, 3, AN_ATTACK },
    { 24, 3, AN_HURT },                         // accepted: the fire at 28 never happens
    { 30, 4, AN_DEATH },                        // done at 50, then held
    { 40, 2, AN_WALK },                         // accepted: back to idle at 30
    { 50, 1, C_FACE_R },
    { 60, 4, AN_ATTACK },                       // refused: dead
    { 70, 0, AN_RISE },                         // ignored: already rising
    { 80, 5, AN_ATTACK },                       // fires at 88, done at 100
    { 90, 5, AN_ATTACK },                       // ignored: same animation
    { 99, 1, C_FACE_L },
    { 255, 0, 0 }
};
#define END_FRAME 120                     // the scenario stops stepping here

char sp;                                  // next script entry

void run_script(void)
{
    while (script[sp].f == frame) {
        char a = script[sp].a, c = script[sp].c;
        if (c == C_FACE_L || c == C_FACE_R)
            set_face(a, c == C_FACE_L);
        else
            request(a, c);
        sp++;
    }
}

// --- the model: walk the tables from the animation's start --------------
// Different arithmetic from the engine: no countdown, the elapsed time is
// spent entry by entry. w_* describe the state t frames after the start.
char w_anim, w_img, w_fire, w_done, w_held;

void walk(char an, unsigned t)
{
    char p = anim_first[an];
    w_done = 0;
    w_held = 0;
    for (;;) {
        char f = afrm[p];
        if (f == END_LOOP) {
            p = anim_first[an] + adur[p];
        } else if (f == END_RETURN) {
            if (t == 0) w_done = 1;
            an = adur[p];
            p = anim_first[an];
        } else if (f == END_HOLD) {
            if (t == 0) w_done = 1;
            w_held = 1;
            p--;
            break;
        } else if (t < adur[p]) {
            break;
        } else {
            t -= adur[p];
            p++;
        }
    }
    w_anim = an;
    w_img = afrm[p] & 7;
    w_fire = !w_held && t == 0 && (afrm[p] & EV_FIRE);
}

char ef_n;
unsigned ef[MAXLOG];
char ea[MAXLOG], ee[MAXLOG];
char m_anim[ACTORS], m_base[ACTORS], m_ptr[ACTORS];
unsigned m_start[ACTORS];

void expect(char a, char ev, unsigned f)
{
    if (ef_n < MAXLOG) {
        ef[ef_n] = f;
        ea[ef_n] = a;
        ee[ef_n] = ev;
    }
    ef_n++;
}

void model(void)
{
    char s = 0;
    for (char a = 0; a < ACTORS; a++) {
        m_anim[a] = AN_NONE;
        m_base[a] = SPR_BLK;
    }
    for (unsigned f = 0; f <= END_FRAME; f++) {
        // Steps first, as the engine does: an animation started at f
        // shows its first entry from f on.
        for (char a = 0; a < ACTORS; a++) {
            if (m_anim[a] == AN_NONE)
                continue;
            walk(m_anim[a], f - m_start[a]);
            if (w_done) expect(a, LG_DONE, f);
            if (w_fire) expect(a, LG_FIRE, f);
        }
        while (script[s].f == f) {
            char a = script[s].a, c = script[s].c;
            s++;
            if (c == C_FACE_L || c == C_FACE_R) {
                m_base[a] = c == C_FACE_L ? SPR_BLK + FACE_L : SPR_BLK;
                continue;
            }
            char now = AN_NONE;
            if (m_anim[a] != AN_NONE) {
                walk(m_anim[a], f - m_start[a]);
                now = w_anim;                   // after any return
            }
            if (c == now)
                continue;
            if (now != AN_NONE && anim_prio[c] < anim_prio[now]) {
                expect(a, LG_REFUSED, f);
                continue;
            }
            m_anim[a] = c;
            m_start[a] = f;
            walk(c, 0);
            if (w_fire) expect(a, LG_FIRE, f);
        }
    }
    for (char a = 0; a < ACTORS; a++) {
        walk(m_anim[a], END_FRAME - m_start[a]);
        m_ptr[a] = m_base[a] + w_img;
    }
}

// --- CIA1 timer B ---------------------------------------------------------
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

// 100 steps of actor 0 on a given animation, less 100 empty calls.
__noinline void nothing(char a) { }

unsigned time100(void (*fn)(char))
{
    __asm { sei }
    timer_start();
    for (char n = 0; n < 100; n++)
        fn(0);
    unsigned t = timer_stop();
    __asm { cli }
    return t;
}

// --- images: frame f is a bar 2f+3 rows tall, right or left half ---------
void make_images(void)
{
    for (unsigned i = 0; i < 16 * 64; i++)
        SprData[i] = 0;
    for (char f = 0; f < 8; f++) {
        char *r = SprData + f * 64;             // right: pixels 12-23
        char *l = SprData + (f + 8) * 64;       // left: pixels 0-11
        for (char y = 0; y < 2 * f + 3; y++) {
            r[y * 3 + 1] = 0x0f;
            r[y * 3 + 2] = 0xff;
            l[y * 3 + 0] = 0xff;
            l[y * 3 + 1] = 0xf0;
        }
    }
}

// --- text (screen codes) --------------------------------------------------
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

const char hexd[] = s"0123456789abcdef";

void put_hex2(char *p, char v)
{
    p[0] = hexd[v >> 4];
    p[1] = hexd[v & 15];
}

const char *const an_name[ANIMS] = {
    s"idle", s"walk", s"attack", s"hurt", s"death", s"rise", s"", s""
};
const char *const ev_name[4] = { s"", s"fire", s"done", s"refused" };

int main(void)
{
    for (unsigned i = 0; i < 1000; i++)
        Screen[i] = 0x20;
    vic.color_border = 0;
    vic.color_back = 6;
    make_images();
    model();

    // Step cost, screen blanked so no badline steals a cycle: the
    // countdown-only path, and the path that moves to the next entry
    // and writes the pointer (an entry of duration 1, looping).
    vic.ctrl1 &= ~VIC_CTRL1_DEN;
    vic_waitFrame();
    unsigned t0 = time100(nothing);
    base[0] = SPR_BLK;
    cur[0] = AN_TSLOW; pos[0] = anim_first[AN_TSLOW]; count[0] = 255; held[0] = 0;
    unsigned c_count = (time100(step) - t0) / 100;
    cur[0] = AN_TFAST; pos[0] = anim_first[AN_TFAST]; count[0] = 1;
    unsigned c_adv = (time100(step) - t0) / 100;
    vic.ctrl1 |= VIC_CTRL1_DEN;

    for (char a = 0; a < ACTORS; a++) {
        cur[a] = AN_NONE;
        held[a] = 1;
        base[a] = SPR_BLK;
        SprPtr[a] = SPR_BLK;
        vic.spr_pos[a].x = 40 + a * 40;
        vic.spr_pos[a].y = 134;
        vic.spr_color[a] = 7;
    }
    vic.spr_msbx = 0;

    put_str(Screen + 0,       s"sprite animation table   frame");
    put_str(Screen + 2 * 40,  s"n anim    entry ptr model");
    put_str(Screen + 13 * 40, s"events got    expected");
    put_str(Screen + 14 * 40, s"step cycles: count     advance");
    put_str(Screen + 15 * 40, s"6 actors max      at     counting");
    put_str(Screen + 16 * 40, s"log: frame actor event");

    unsigned c_max = 0, c_max_f = 0, c_cnt = 0;
    frame = 0;
    vic_waitFrame();
    vic.spr_enable = (1 << ACTORS) - 1;

    for (;;) {
        vic_waitFrame();
        if (frame <= END_FRAME) {
            __asm { sei }
            timer_start();
            for (char a = 0; a < ACTORS; a++)
                step(a);
            unsigned t = timer_stop();
            __asm { cli }
            run_script();
            if (t > c_max) {
                c_max = t;
                c_max_f = frame;
            }
            if (frame == 5)                 // every actor only counts down
                c_cnt = t;
            if (frame == END_FRAME) {
                char fault = 0;
                if (nlog != ef_n) fault = 1;
                for (char i = 0; i < nlog && i < MAXLOG; i++)
                    if (lf[i] != ef[i] || la[i] != ea[i] || le[i] != ee[i])
                        fault = 1;
                for (char a = 0; a < ACTORS; a++) {
                    char *row = Screen + (3 + a) * 40;
                    put_dec(row, a, 1);
                    put_str(row + 2, an_name[cur[a]]);
                    put_dec(row + 10, pos[a] - anim_first[cur[a]], 1);
                    put_dec(row + 16, SprPtr[a], 3);
                    put_dec(row + 21, m_ptr[a], 3);
                    if (SprPtr[a] != m_ptr[a]) fault = 2;
                }
                put_dec(Screen + 13 * 40 + 11, nlog, 2);
                put_dec(Screen + 13 * 40 + 23, ef_n, 2);
                put_dec(Screen + 14 * 40 + 19, c_count, 3);
                put_dec(Screen + 14 * 40 + 31, c_adv, 3);
                put_dec(Screen + 15 * 40 + 13, c_max, 4);
                put_dec(Screen + 15 * 40 + 21, c_max_f, 3);
                put_dec(Screen + 15 * 40 + 34, c_cnt, 4);
                for (char i = 0; i < nlog && i < 8; i++) {
                    char *row = Screen + (17 + i) * 40;
                    put_dec(row + 5, lf[i], 3);
                    put_dec(row + 11, la[i], 1);
                    put_str(row + 17, ev_name[le[i]]);
                }
                RESULT = fault ? 2 : 1;
                vic.color_border = fault ? 2 : 5;
                put_str(Screen + 40, fault ? s"result fail" : s"result pass");
            }
            put_dec(Screen + 31, frame, 3);
            frame++;
        }
    }
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=sprite-animation-table.prg sprite-animation-table.c
```

Produces `sprite-animation-table.prg`, 3,165 bytes. The sixteen sprite
images are built at run time at `$3000` to `$33FF`, blocks 192 to 207 of
VIC bank 0, above the program. Then run headless in VICE (PAL):

```bash
GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas x64sc -default -warp +sound \
  +autostart-delay-random -autostartprgmode 1 -limitcycles 8000000 \
  -exitscreenshot sprite-animation-table.png -autostart sprite-animation-table.prg
```

Add `-model ntsc` for the NTSC picture. The scenario stops stepping at
frame 120 and the screen holds, so any cycle count past the verdict
gives the same picture; 8,000,000 is pinned.

## Expected output

The tables, as the source states them (durations in frames):

| Animation | Entries (image, frames) | End | Priority |
|---|---|---|---|
| idle | (0, 20) (1, 20) | loop to entry 0 | 0 |
| walk | (2, 6) (3, 6) (4, 6) (3, 6) | loop to entry 0 | 0 |
| attack | (5, 4) (6, 4) (7 + fire, 8) (6, 4) | return to idle | 1 |
| hurt | (1, 3) (0, 3) (1, 3) (0, 3) | return to idle | 2 |
| death | (4, 5) (5, 5) (6, 5) (7, 5) | hold | 3 |
| rise | (0, 10) (2, 8) (3, 8) | loop to entry 1 | 0 |

Image `f` is a bar 2f + 3 rows tall, in the right half of the sprite
(pixels 12 to 23) in blocks 192 to 199 and the left half (pixels 0 to 11)
in blocks 200 to 207, so a screenshot shows which pointer each sprite
has.

Measured in VICE x64sc 3.10 with the pinned command, text decoded
against the character ROM with PIL (rows 0 to 8 and 13 to 24, PAL):

```text
SPRITE ANIMATION TABLE   FRAME 120
RESULT PASS
N ANIM    ENTRY PTR  MODEL
0 RISE    2     195  195
1 WALK    0     202  202
2 WALK    1     195  195
3 IDLE    0     192  192
4 DEATH   3     199  199
5 IDLE    1     193  193

EVENTS GOT 08 EXPECTED 08
STEP CYCLES: COUNT 025 ADVANCE 124
6 ACTORS MAX 0799 AT 030 COUNTING 0357
LOG: FRAME ACTOR EVENT
     014   2     REFUSED
     018   2     FIRE
     030   2     DONE
     036   3     DONE
     050   4     DONE
     060   4     REFUSED
     088   5     FIRE
     100   5     DONE
```

NTSC reads the same, every row. The border is palette index 5, (98,
213, 50) on PAL and (114, 189, 103) on NTSC.

What the log says, against the script:

- Actor 2's attack starts at 10; its entries last 4 and 4, so the fire
  entry is entered at 18 and the animation ends at 10 + 20 = 30 and
  returns to idle. The walk requested at 14 is refused (priority 0
  under 1); the walk requested at 40 is accepted, because idle runs by
  then.
- Actor 3's attack starts at 20 and would fire at 28. The hurt at 24
  outranks it (2 over 1), so the attack never fires; the hurt ends at
  24 + 12 = 36.
- Actor 4 dies at 30, holds from 50 on, and refuses the attack at 60.
- Actor 5's second attack request at 90 is the running animation, so it
  is ignored: no restart, no log entry. The attack fires at 88 and ends
  at 100. Actor 0's rise request at 70 is ignored the same way.
- Actor 0's rise shows entry 0 for frames 0 to 9, then loops over
  entries 1 and 2 (16 frames): at 120 it is 110 frames past entry 1's
  first start, 6 loops and 14 frames, so entry 2, image 3.
- Actor 1 turned right at 50 and left again at 99, keeping its entry;
  its pointer is 202, image 2 plus the facing offset of 8.

The sprites, measured with PIL on both pictures: each of the six yellow
sprites ((255, 255, 70) on PAL, (255, 248, 141) on NTSC) starts on line
135, one below its Y register of 134. Their heights are 9, 7, 9, 3, 17
and 5 rows, images 3, 2, 3, 0, 7 and 1; sprite 1's bar covers sprite
pixels 0 to 11 and the others 12 to 23. That gives pointers 195, 202,
195, 192, 199 and 193: the values printed, the model's, and the values
a separate Python model of the tables and script (scratch, not shipped)
predicts. Each model
run twice gives byte-identical PNGs:
`screenshots/sprite-animation-table.png` (PAL) and
`screenshots/sprite-animation-table-ntsc.png` (NTSC).

Cycle figures, CIA1 timer B, interrupts masked, the same on both models.
`COUNT` and `ADVANCE` are 100 calls of `step` through a function
pointer, less 100 empty calls, divided by 100, with the screen blanked.
`COUNT` runs an entry 255 frames long, so every call only decrements.
`ADVANCE` runs a two-entry loop with durations of 1, so every call moves
to the next entry, half of them through the loop action, and writes the
pointer. `MAX` is the worst frame of the scenario for all six actors,
the loop and calls included: frame 30, when actor 2 returns to idle with
a log entry and actors 1, 3 and 5 change entry. `COUNTING` is frame 5,
where every actor only decrements: 357 cycles, about 60 an actor with
the loop and call. These run straight after `vic_waitFrame()` returns at
line 256, before the next badline.

A negative run, with the engine's countdown loaded one frame too long
(`count[a] = adur[p] + 1`), prints `RESULT FAIL` with a red border: the
events move to 20, 34, 40, 54, 90 and 104, and four pointers differ from
the model's.

The program's own check compares the engine with the tables, not the
tables with intent. With rise's loop target changed from entry 1 to
entry 0 it still prints `RESULT PASS`, because the model reads the same
wrong table; sprite 0 then shows image 2 (pointer 194), and the pinned
PNG comparison is what catches it.

## Why this works

The animation is data, so the state code never picks a sprite block. It
asks for an animation; `request` refuses it when the running animation
has a higher priority, ignores it when it is the running one, and
otherwise points the actor at entry 0. `enter` resolves end actions
(loop, return, hold) until it reaches a real entry, loads the countdown,
fires the entry's event and writes the sprite pointer. `step` is the only
per-frame work: a decrement, and a call to `enter` when it reaches zero.
The pointer is written only when the entry changes.

Events belong to entries, not to time. The attack fires when its third
entry is entered, so changing a duration moves the shot with the
picture, and an animation cut off before that entry never fires. A game
reads the log (or a flag) after the steps and spawns the bullet there.

The check is independent because the model uses different arithmetic: it
spends the elapsed frames entry by entry from the animation's start, and
reports an event only when the time runs out exactly on an entry's
first frame. An off-by-one in the countdown moves every event, as the
negative run shows.

Pointers are block numbers in the VIC bank: `$3000` is block 192 of bank
0 and the pointers live at screen + `$3F8`. Moving the screen or the
bank moves both (`vic_bank_visibility_collision` in
`pitfalls/banking.md`).

Verified: compiled with Oscar64, run headless in VICE x64sc 3.10 with the
pinned command on PAL and NTSC, each twice with byte-identical PNGs; the
text was decoded against the character ROM and the sprite bars measured
with PIL, not by eye.
