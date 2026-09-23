---
recipe: attract-replay
toolchain: oscar64
output_format: PRG
region: both
techniques: [attract_mode_input_replay, joystick_edge_detect, lfsr_random]
file_formats: [PRG]
uses_registers: [DC00, DC06, DC07, DC0F, D012, D020, D021]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 Attract Replay: the title screen plays the game from a recorded input stream

## Synopsis

A title screen with a small playfield: one player sprite moved by an
input byte, and one hazard sprite that wanders under an 8-bit LFSR and
knocks the player back to the start when it touches. After 100 frames
with nothing on control port 2 the demo starts. The demo is the game
loop unchanged: each frame a compiled-in RLE recording writes the input
byte the joystick would have written, and the LFSR is reseeded to the
state it had when the recording was made, so the demo plays out the
same way every time. Any real press on the port ends it. When the
recording's last frame has run the program compares the player's
position with the two constants stored beside the stream and reports
the verdict the way `headless-verify.md` does: `$02FF` = `01` and a
green border on a match, `02` and red otherwise, with both positions and
the difference on screen. One define, `SEED_RESEED=0`, skips the reseed
so the drift can be measured; another, `ABORT_AT=n`, injects a fire
press on demo frame `n` to test the abort. The technique is
`attract_mode_input_replay` in `techniques/input.md`.

## Source

```c
// attract-replay.c
// A title screen that plays the game itself after an idle timeout. The
// demo is the game: the player sprite reads one input byte, and during
// the demo that byte is written from a compiled-in RLE recording instead
// of control port 2. The LFSR that drives the hazard is reseeded to the
// seed the recording was made with, so the demo replays exactly. Any
// real press ends the demo. After the recording's last frame the sprite
// position is compared with the constants recorded beside the stream:
// $02FF = 01 and a green border on a match, 02 and red otherwise.
// Defines: SEED_RESEED=0 skips the reseed so the drift can be measured;
// ABORT_AT=n injects a real fire press on demo frame n to test the abort.
#include <c64/vic.h>
#include <c64/cia.h>
#include <c64/sprites.h>

#ifndef SEED_RESEED
#define SEED_RESEED 1              // 1: reseed the LFSR when the demo starts
#endif
#ifndef ABORT_AT
#define ABORT_AT    0              // >0: synthetic fire press on that demo frame
#endif

#define SCREEN      ((char *)0x0400)
#define COLOUR      ((char *)0xd800)
#define RESULT      (*(volatile char *)0x02ff)
#define IMG_PLAYER  13             // sprite image at $0340
#define IMG_HAZARD  14             // sprite image at $0380

#define JOY_UP      0x01
#define JOY_DOWN    0x02
#define JOY_LEFT    0x04
#define JOY_RIGHT   0x08
#define JOY_FIRE    0x10
#define JOY_MASK    0x1f

#define IDLE_FRAMES 100            // frames with no input before the demo
#define FIELD_L     24
#define FIELD_R     296
#define FIELD_T     90
#define FIELD_B     208
#define START_X     40
#define START_Y     100
#define HIT_RANGE   12

#define ST_TITLE    0
#define ST_DEMO     1

// ---------------------------------------------------------------------------
// The recording. Byte pairs: port byte as $DC00 gives it (active low,
// bits 0-4), then the number of frames it was held. A count of 0 ends
// the stream. REC_SEED is the LFSR state when it was recorded; REC_END_X
// and REC_END_Y are where the player sprite stood on its last frame.
#define REC_SEED    0xa7
#define REC_END_X   50
#define REC_END_Y   106
static const char rec[] = {
    0xfa, 50,      // up + left
    0xfe, 48,      // up
    0xf5, 43,      // down + right
    0xf6, 44,      // up + right
    0xfe, 53,      // up
    0xf6, 31,      // up + right
    0xfd, 8,       // down
    0xff, 8,       // nothing
    0xff, 0
};

// ---------------------------------------------------------------------------
// 8-bit Galois LFSR, taps $B8, period 255 (lfsr-random.md).
static char lfsr;

static char rnd(void)
{
    char s = lfsr;
    bool low = s & 1;
    s >>= 1;
    if (low) s ^= 0xb8;
    lfsr = s;
    return s;
}

static void reseed(char seed)
{
    lfsr = seed ? seed : 1;        // zero would lock the generator
}

// ---------------------------------------------------------------------------
// Game state. Everything the frame step reads or writes.
static char     joy_in;            // the input byte: port or recording
static char     joy_prev;
static int      px, py;            // player sprite position
static int      hx, hy;            // hazard sprite position
static signed char hvx, hvy;
static char     hits;
static char     state;
static char     idle;
static unsigned frame;             // frames since the demo started
static char     rec_pos, rec_left;
static unsigned replay_cost;       // longest replay step, CIA cycles

static char port_read(void)
{
    cia1.pra = 0xff;
    return cia1.pra & JOY_MASK;    // control port 2, active low
}

// One frame of the replay source: advance the RLE stream and write the
// input byte. Returns false when the stream is exhausted.
static bool replay_step(void)
{
    if (rec_left == 0) {
        rec_left = rec[rec_pos + 1];
        if (rec_left == 0) return false;
        joy_in = rec[rec_pos];
        rec_pos += 2;
    }
    rec_left--;
    return true;
}

static void reset_field(void)
{
    px = START_X; py = START_Y;
    hx = 160;     hy = 150;
    hvx = 2;      hvy = 1;
    hits = 0;
    joy_prev = JOY_MASK;
    spr_move(0, px, py);
    spr_move(1, hx, hy);
}

// The game's frame step. It reads joy_in and nothing else about input.
static void game_step(void)
{
    char pressed = ~joy_in & JOY_MASK;
    if ((pressed & JOY_UP)    && py > FIELD_T) py -= 2;
    if ((pressed & JOY_DOWN)  && py < FIELD_B) py += 2;
    if ((pressed & JOY_LEFT)  && px > FIELD_L) px -= 2;
    if ((pressed & JOY_RIGHT) && px < FIELD_R) px += 2;

    char r = rnd();
    if (r < 24) {                  // a new heading now and then
        hvx = (r & 1) ? 2 : -2;
        hvy = (r & 2) ? 2 : -2;
    }
    hx += hvx; hy += hvy;
    if (hx <= FIELD_L || hx >= FIELD_R) hvx = -hvx;
    if (hy <= FIELD_T || hy >= FIELD_B) hvy = -hvy;

    int dx = px - hx; if (dx < 0) dx = -dx;
    int dy = py - hy; if (dy < 0) dy = -dy;
    if (dx < HIT_RANGE && dy < HIT_RANGE) {
        hits++;
        px = START_X; py = START_Y;
        r = rnd();
        hx = FIELD_L + 2 * (r & 0x7f);        // anywhere across the field
        if (hx > FIELD_R) hx = FIELD_R;
        hy = FIELD_T + (rnd() & 0x3f);
    }
    spr_move(0, px, py);
    spr_move(1, hx, hy);
    joy_prev = joy_in;
}

// ---------------------------------------------------------------------------
// Screen text. Screen codes poked straight in; a-z become 1..26.
static const char hex_glyph[16] = {
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 1, 2, 3, 4, 5, 6 };

static void put_str(char row, char col, const char *s)
{
    char *p = SCREEN + 40 * row + col;
    while (*s) {
        char c = *s++;
        *p++ = (c >= 'a' && c <= 'z') ? c - 'a' + 1 : c;
    }
}

static void put_hex8(char row, char col, char v)
{
    char *p = SCREEN + 40 * row + col;
    p[0] = hex_glyph[v >> 4];
    p[1] = hex_glyph[v & 15];
}

static void put_dec(char row, char col, int v)
{
    char *p = SCREEN + 40 * row + col;
    if (v < 0) { v = -v; *p++ = '-'; } else *p++ = ' ';
    p[0] = '0' + v / 100; v %= 100;
    p[1] = '0' + v / 10;
    p[2] = '0' + v % 10;
}

static void wait_frame(void)
{
    while (vic.raster == 250) ;
    while (vic.raster != 250) ;
}

static void make_sprites(void)
{
    char *pl = (char *)(IMG_PLAYER * 64);
    char *hz = (char *)(IMG_HAZARD * 64);
    for (char i = 0; i < 63; i++) {
        pl[i] = (i % 3 == 1) ? 0xff : 0x00;         // player: an 8x21 bar
        hz[i] = (i % 3 == 1) ? 0x18 : 0x00;         // hazard: a 2-px stalk
    }
    for (char r = 8; r < 13; r++) { hz[r * 3] = 0xff; hz[r * 3 + 1] = 0xff; hz[r * 3 + 2] = 0xff; }
}

static void start_demo(void)
{
    state = ST_DEMO;
    frame = 0;
    rec_pos = 0; rec_left = 0;
#if SEED_RESEED
    reseed(REC_SEED);
#endif
    reset_field();
    put_str(2, 0, "demo                                    ");
}

static void end_demo(bool finished)
{
    state = ST_TITLE;
    idle = 0;
    put_str(2, 0, finished ? "replay end " : "aborted    ");
    put_hex8(2, 11, frame >> 8); put_hex8(2, 13, frame & 0xff);
    if (finished) {
        char code = (px == REC_END_X && py == REC_END_Y) ? 1 : 2;
        put_str(3, 0, "x    y    hits    exp         d");
        put_dec(3, 1, px); put_dec(3, 6, py); put_hex8(3, 15, hits);
        put_dec(3, 21, REC_END_X); put_dec(3, 25, REC_END_Y);
        put_dec(3, 31, px - REC_END_X); put_dec(3, 35, py - REC_END_Y);
        put_str(4, 0, "step cost ");
        put_hex8(4, 10, replay_cost >> 8); put_hex8(4, 12, replay_cost & 0xff);
        put_str(4, 20, code == 1 ? "result 01 pass" : "result 02 fail");
        RESULT = code;
        vic.color_border = (code == 1) ? 5 : 2;
    }
}

int main(void)
{
    for (unsigned i = 0; i < 1000; i++) { SCREEN[i] = 0x20; COLOUR[i] = 1; }
    vic.color_border = 0; vic.color_back = 0;
    put_str(0, 0, "attract replay   push the stick to play");
    make_sprites();
    spr_init(SCREEN);
    spr_set(0, true, START_X, START_Y, IMG_PLAYER, 1, false, false, false);
    spr_set(1, true, 160, 150, IMG_HAZARD, 2, false, false, false);
    reseed(0x5a);                  // the boot seed, not the recording's
    reset_field();
    state = ST_TITLE; idle = 0;

    for (;;) {
        wait_frame();
        char port = port_read();
#if ABORT_AT
        if (state == ST_DEMO && frame == ABORT_AT) port &= ~JOY_FIRE;
#endif
        bool real = (port != JOY_MASK);

        if (state == ST_TITLE) {
            COLOUR[720 + rnd()] = rnd() & 15;   // twinkle in rows 18-24: the LFSR runs on the title too
            joy_in = port;
            if (real) idle = 0;
            else if (++idle >= IDLE_FRAMES) start_demo();
            if (state == ST_TITLE) put_hex8(1, 0, idle);
        }
        if (state == ST_DEMO) {
            if (real) { end_demo(false); continue; }
            __asm { sei }              // keep the KERNAL IRQ out of the timed step
            cia1.crb = 0x00; cia1.tb = 0xffff; cia1.crb = 0x11;
            bool more = replay_step();
            cia1.crb = 0x00;
            __asm { cli }
            unsigned cost = 0xffff - cia1.tb;
            if (cost > replay_cost) replay_cost = cost;
            if (!more) { end_demo(true); continue; }
            game_step();
            frame++;
            put_hex8(1, 0, frame >> 8); put_hex8(1, 2, frame & 0xff);
            put_dec(1, 6, px); put_dec(1, 11, py);
        }
    }
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -n -o=attract-replay.prg attract-replay.c
```

Produces `attract-replay.prg`, 2,361 bytes (Oscar64 build 2026-05-19).
The two other builds this page measures:

```bash
oscar64 -tm=c64 -O2 -dSEED_RESEED=0 -o=attract-replay-noseed.prg attract-replay.c   # 2,361 bytes
oscar64 -tm=c64 -O2 -dABORT_AT=50 -o=attract-replay-abort.prg attract-replay.c       # 2,379 bytes
```

## Expected output

Black screen and border. Row 0 reads `ATTRACT REPLAY   PUSH THE STICK
TO PLAY`. On the title, row 1 counts the idle frames in hex and colour
cells twinkle in rows 18 to 24. During the demo row 2 reads `DEMO` and
row 1 shows the demo frame in hex followed by the player's X and Y in
decimal. When the recording runs out, rows 2 to 4 read:

```
REPLAY END 011D
X 050Y 106HITS 01 EXP 050 106 D 000 000
STEP COST 0044      RESULT 01 PASS
```

and the border turns green. `011D` is 285, the frame count of the
recording. The demo then hands back to the title, which starts the demo
again after another 100 idle frames; the verdict rows stay on screen.

Screenshots from the pinned run, 8,000,000 cycles, which stops both
models in the middle of the first demo: `screenshots/attract-replay.png`
(PAL, demo frame `0097` = 151, player at 130, 156) and
`screenshots/attract-replay-ntsc.png` (NTSC, demo frame `00B8` = 184,
player at 196, 90). Each picture was produced twice by the pinned command
and the two files were identical bytes. The models differ in frame
because an NTSC frame is fewer cycles, not because the demo differs: the
NTSC frame-184 position is what the PAL run reaches at its frame 184.

Measured in VICE x64sc 3.10 (rung 1), stopped at 12,000,000 cycles so
the first demo has finished, on PAL and NTSC:

| Build | X, Y at the last frame | Hits | Delta from the table | Border | `$02FF` |
|---|---|---|---|---|---|
| default (reseeded) | 50, 106 | 1 | 0, 0 | green, (98, 213, 50) PAL, (114, 189, 103) NTSC | `01` |
| `-dSEED_RESEED=0` | 260, 106 | 0 | +210, 0 | red, (175, 60, 88) PAL, (169, 71, 100) NTSC | `02` |

The reseeded run ends where the table says. The unseeded run plays the
same 285 input bytes against an LFSR that is wherever the title screen's
twinkle left it (state `$6A` after 100 title frames from the boot seed
`$5A`; the table's seed is `$A7`). The hazard takes different headings,
never touches the player, and the player ends 210 pixels to the right:
in the reseeded run the hazard hits on demo frame 263 (the model's
figure; the frame was not read off the emulator), the player is sent
back to the start, and the last 21 frames of the recording carry it
from there to 50, 106. That hit is the event the recording was made
against. Same inputs, different world, different ending.

The `$02FF` values were read as the border colour and the text; the byte
itself was not read over the monitor in this run. The abort build,
`-dABORT_AT=50`, was run on PAL and not pinned: row 2 reads
`ABORTED 0032`, the demo ended on frame 50 with no verdict written and
the border black, and the title took over with its idle count at zero.
The abort from a real stick was not measured here; the injected press
goes through the same `real` test as the port byte.

The end position and hit count were cross-checked against a Python
model of `game_step` and the LFSR, run over the same recording: the
model gives 50, 106 with one hit for seed `$A7` and 260, 106 with no
hits for state `$6A`, the emulator's figures on both models. The
recording itself was chosen with that model: a route of eight segments
that crosses the hazard's path under the recorded seed and misses it
under the title's state, so the two builds cannot agree by luck.

## Why this works

The player reads `joy_in` and nothing else about input; `game_step` does
not know whether a stick or a table filled it. On the title the main
loop copies the port into `joy_in`. In the demo `replay_step` fills it
from the recording, one RLE pair at a time: the pair's first byte is the
port value exactly as `$DC00` gives it, active low, so the same
`~joy_in & JOY_MASK` line decodes both sources, and the second byte is
the number of frames to hold it. A count of zero ends the stream. There
is no second code path for the demo, which is the reason to build it
this way: whatever the game does, the demo does too.

Determinism is what makes the recording replay. The game's only source
of variation is the LFSR, and `start_demo` sets it to `REC_SEED` before
the first demo frame. The same seed, the same input bytes, the same
number of frames, and every intermediate state is the one the recording
saw, so the position on the last frame is the one stored in the table.
The title screen deliberately keeps calling `rnd()` for its twinkle, so
the LFSR is somewhere else by the time the demo starts; without the
reseed the demo runs against a different hazard, which is what the
`SEED_RESEED=0` build shows. `reseed` maps a zero seed to 1, because an
LFSR at zero stays at zero for ever (`pitfalls/cpu.md`,
`lfsr_zero_state_lockup`); `REC_SEED` is not zero, and the guard is there
for a recording tool that might store one.

The frame is the unit. `wait_frame` polls `$D012` for line 250 once per
loop, so one recording pair counts frames on both regions and a 285-frame
demo is 285 frames on PAL and on NTSC; it takes less wall time on NTSC,
and that is all. The idle timer is a byte counting frames of nothing on
the port and resetting on anything, so a player who touches the stick
never sees the demo.

The abort is the same port read the title uses. During the demo the loop
still reads `$DC00` every frame; any bit low is `real`, the demo ends
before `replay_step` runs, and the title takes the next frame. The
recording is left where it was and the next demo starts it again from
the top. `ABORT_AT` forces the fire bit low on one frame so the path is
exercised without a stick.

The replay's own cost is measured with CIA1 timer B around
`replay_step`, interrupts held off for the few cycles the timing takes
so the KERNAL's IRQ cannot land inside it; the KERNAL owns timer A. The
longest step in a 285-frame demo was `$44`, 68 cycles, the same on both
models and in all three builds, and that figure includes the two
`cia1.crb` stores that start and stop the timer. Before the `sei` was
added the maximum read 251 cycles in one run and 65 in another, the
difference being an IRQ that landed inside the window once.

## Sources

- This repository: `game-design/game-structure.md`,
  `front_end_and_attract`, which names Lasse Öörni's control-override
  pattern (Rant 18) as the seam this recipe uses; `recipes/oscar64/
  headless-verify.md` for the verdict scheme; `recipes/oscar64/
  lfsr-random.md` for the generator; `recipes/oscar64/joystick-input.md`
  for the port read.
- Oscar64, `include/c64/sprites.h`, `include/c64/vic.h`,
  `include/c64/cia.h`, local build dated 2026-05-19
  (https://github.com/drmortalwombat/oscar64): `spr_init`, `spr_set`,
  `spr_move`, `vic.raster`, `cia1.pra`, `cia1.tb`, `cia1.crb`.
- VICE 3.10, `x64sc`, the instrument. https://vice-emu.sourceforge.io/
