---
recipe: difficulty-tables
toolchain: oscar64
output_format: PRG
region: both
techniques: [difficulty_ramp_tables, pal_ntsc_detection, object_pool, lfsr_random]
file_formats: [PRG]
uses_registers: [D011, D012, D020, D021, DC04, DC05, DC06, DC07, DC0D, DC0E, DC0F]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 difficulty tables: a level ramp read from data, region-compensated, timed on both models

## Synopsis

A six-row level table (enemy speed in 8.8 pixels per frame, spawn
interval in frames, active count, coin quota, a hazard flag) drives a
small falling-enemy game from data. Enemies come out of an eight-slot
object pool at the row's interval, no more than the row's count alive at
once; each one that lands leaves a coin, and an autopilot player collects
the coins. The level advances when the row's quota is collected, which is
something the player does, not a timer. From level 3 the flag column
turns on a second hazard, a spike that falls half again as fast. Past the
last row the last row is held.

The table is written for 50 frames a second. `COMPENSATE=1` (the
default) asks `pal_ntsc_detection` which chip this is and rescales the
interval by 6/5 and the speed by 5/6 on NTSC, so the ramp takes the same
real time on both machines. The program counts frames and runs CIA1
timers A and B as a 32-bit φ2 clock, prints the frame and the millisecond
at which level 3 began, and grades that millisecond against a compiled-in
PAL reference: `$02FF` holds `01` and the border goes green if it is
within `TOL_MS`, else `02` and red. Built with `-dCOMPENSATE=0` the same
program shows the raw table: the same frame count on both models and an
NTSC time about five sixths of the PAL one. It implements
`difficulty_ramp_tables` (`techniques/logic.md`); the pattern is
`difficulty_ramp` in `../../game-design/enemy-behaviour-and-difficulty.md`.

## Source

```c
// difficulty-tables.c
// A level table read from data: enemy speed (8.8 pixels per frame), spawn
// interval (frames), active count and a hazard flag, one row per level, the
// last row held. Enemies fall from an object pool; each one that reaches
// the ground drops a coin, and the level advances when the player has
// collected the row's coin quota. The table is written for PAL frames;
// COMPENSATE=1 rescales interval and speed on NTSC so the ramp takes the
// same real time on both. The frame count and CIA-timed elapsed time at
// which level 3 begins are printed and graded at $02FF.
#include <c64/vic.h>
#include <c64/cia.h>

#ifndef COMPENSATE
#define COMPENSATE 1            // 1: rescale the table on NTSC, 0: run raw
#endif
#ifndef REF_MS
#define REF_MS   22493          // ms to level 3 measured on PAL, compensated build
#endif
#ifndef TOL_MS
#define TOL_MS   500            // tolerance on REF_MS, both regions
#endif

#define SCREEN ((char *)0x0400)
#define COLOUR ((char *)0xd800)
#define RESULT (*(volatile char *)0x02ff)

#define CODE_PASS 0x01
#define CODE_FAIL 0x02

// --- The level table -----------------------------------------------------
// Columns: speed in 8.8 pixels per frame, spawn interval in frames, most
// enemies alive at once, coins to collect, flags. Written for 50 frames a
// second. FLAG_SPIKE turns on the second hazard type from level 3.
#define FLAG_SPIKE 0x01

struct LevelRow { unsigned speed; char interval; char active; char quota; char flags; };

#define LEVELS 6
static const struct LevelRow level_table[LEVELS] = {
    { 0x0080, 60, 3, 6, 0 },            // 1: 0.50 px/frame
    { 0x00c0, 45, 3, 6, 0 },            // 2: 0.75
    { 0x0100, 40, 4, 6, FLAG_SPIKE },   // 3: 1.00, spikes appear
    { 0x0140, 32, 4, 6, FLAG_SPIKE },   // 4: 1.25
    { 0x0180, 28, 5, 6, FLAG_SPIKE },   // 5: 1.50
    { 0x01c0, 24, 5, 6, FLAG_SPIKE },   // 6: 1.75, held for ever after
};

// The row in use, copied at level start with the region scaler applied.
static unsigned cur_speed;
static char cur_interval, cur_active, cur_quota, cur_flags;
static char level;                      // 1-based
static char coins;                      // collected this level

// --- Region ----------------------------------------------------------------
static char is_ntsc;

// Highest $D012 value seen inside one RST8 band: $37 on a 6569, $06 or $05
// on a 6567. Interrupts are already off when this runs.
static char last_raster_line(void)
{
    char top = 0;
    while (vic.ctrl1 & 0x80) ;
    while (!(vic.ctrl1 & 0x80)) ;
    while (vic.ctrl1 & 0x80) {
        char r = vic.raster;
        if (r > top) top = r;
    }
    return top;
}

// Frames written for 50 Hz become frames at 60 Hz: v * 6 / 5.
static char scale_frames(char v)
{
    if (COMPENSATE && is_ntsc)
        return (char)(((unsigned)v * 6 + 2) / 5);
    return v;
}

// Pixels per frame written for 50 Hz become pixels per frame at 60 Hz:
// v * 5 / 6, in 8.8 so the fraction survives.
static unsigned scale_speed(unsigned v)
{
    if (COMPENSATE && is_ntsc)
        return (v * 5 + 3) / 6;
    return v;
}

static void level_start(char n)
{
    char i = n - 1;
    if (i >= LEVELS) i = LEVELS - 1;    // hold the last row, never read past
    level = n;
    coins = 0;
    cur_speed    = scale_speed(level_table[i].speed);
    cur_interval = scale_frames(level_table[i].interval);
    cur_active   = level_table[i].active;
    cur_quota    = level_table[i].quota;
    cur_flags    = level_table[i].flags;
}

// --- Random ----------------------------------------------------------------
// 16-bit Galois LFSR. The seed must not be zero or it stays zero for ever.
#define LFSR_SEED 0xace1
static unsigned lfsr = LFSR_SEED;
static char rnd(void)
{
    char bit = lfsr & 1;
    lfsr >>= 1;
    if (bit) lfsr ^= 0xb400;
    return (char)lfsr;
}

// --- Object pool -----------------------------------------------------------
#define MAX_OBJ 8
#define OBJ_FREE  0
#define OBJ_ENEMY 1
#define OBJ_SPIKE 2
#define OBJ_COIN  3

#define TOP_Y     40
#define GROUND_Y  176                   // row 22 of the text screen
#define PLAYER_Y  192                   // row 24, the last row
#define COIN_DY   0x0200                // coins fall at 2 px/frame (scaled)

static char     obj_state[MAX_OBJ];
static char     obj_x[MAX_OBJ];         // 0..159, playfield pixels
static unsigned obj_y[MAX_OBJ];         // 8.8
static unsigned obj_dy[MAX_OBJ];        // 8.8 per frame

static char pool_alloc(void)
{
    for (char i = 0; i < MAX_OBJ; i++)
        if (obj_state[i] == OBJ_FREE) return i;
    return 0xff;
}

static char count_state(char lo, char hi)
{
    char n = 0;
    for (char i = 0; i < MAX_OBJ; i++)
        if (obj_state[i] >= lo && obj_state[i] <= hi) n++;
    return n;
}

static void spawn(char kind, char x, unsigned y, unsigned dy)
{
    char s = pool_alloc();
    if (s == 0xff) return;
    obj_state[s] = kind;
    obj_x[s] = x;
    obj_y[s] = y;
    obj_dy[s] = dy;
}

// --- Player and spawner ------------------------------------------------------
static char player_x = 80;
static char spawn_timer;
static char coins_total;

static void spawner(void)
{
    if (spawn_timer) { spawn_timer--; return; }
    if (count_state(OBJ_ENEMY, OBJ_SPIKE) >= cur_active) return;
    spawn_timer = cur_interval;
    char x = (rnd() & 0x7f) + 16;       // 16..143 of the 160-wide field
    // Every fourth spawn is a spike once the row's flag allows it: it
    // falls half again as fast and is the level's new problem.
    char kind = OBJ_ENEMY;
    unsigned dy = cur_speed;
    if ((cur_flags & FLAG_SPIKE) && (rnd() & 3) == 0) {
        kind = OBJ_SPIKE;
        dy = cur_speed + (cur_speed >> 1);
    }
    spawn(kind, x, (unsigned)TOP_Y << 8, dy);
}

// The autopilot: walk towards the lowest object at two pixels a frame,
// since every enemy becomes a coin where it lands, and collect the coin
// when it reaches the player's row within eight pixels.
static void player(void)
{
    char best = 0xff;
    unsigned besty = 0;
    for (char i = 0; i < MAX_OBJ; i++)
        if (obj_state[i] != OBJ_FREE && obj_y[i] >= besty) { besty = obj_y[i]; best = i; }
    if (best == 0xff) return;
    char tx = obj_x[best];
    if (player_x + 2 <= tx) player_x += 2;
    else if (player_x >= tx + 2) player_x -= 2;
    else player_x = tx;
}

static void tick_objects(void)
{
    for (char i = 0; i < MAX_OBJ; i++) {
        char st = obj_state[i];
        if (st == OBJ_FREE) continue;
        obj_y[i] += obj_dy[i];
        char y = obj_y[i] >> 8;
        if (st == OBJ_COIN) {
            if (y >= PLAYER_Y) {
                char dx = obj_x[i] > player_x ? obj_x[i] - player_x : player_x - obj_x[i];
                if (dx <= 8) { coins++; coins_total++; }
                obj_state[i] = OBJ_FREE;
            }
        } else if (y >= GROUND_Y) {
            // The enemy lands and leaves a coin behind.
            obj_state[i] = OBJ_COIN;
            obj_dy[i] = scale_speed(COIN_DY);
        }
    }
}

// --- Screen ------------------------------------------------------------------
static const char hex_glyph[16] = {
    0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37,
    0x38, 0x39, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06
};

static void put_str(char row, char col, const char *s)
{
    char *p = SCREEN + row * 40 + col;
    while (*s) { char c = *s++; *p++ = (c >= 0x40) ? c & 0x3f : c; }
}

// Right-aligned unsigned long in a field of width w, space padded.
static void put_num(char row, char col, unsigned long v, char w)
{
    char *p = SCREEN + row * 40 + col + w;
    do { *--p = 0x30 + (char)(v % 10); v /= 10; } while (v && p > SCREEN + row * 40 + col);
    while (p > SCREEN + row * 40 + col) *--p = 0x20;
}

static void draw_field(void)
{
    // Playfield rows 5..24: row = y / 8, column = x / 4. Clamp y so the
    // write can never leave the screen (past 1000 lies the program and,
    // in colour RAM's mirror, the CIA registers).
    for (unsigned i = 5 * 40; i < 1000; i++) SCREEN[i] = 0x20;
    for (char i = 0; i < MAX_OBJ; i++) {
        char st = obj_state[i];
        if (st == OBJ_FREE) continue;
        char y = obj_y[i] >> 8;
        if (y > 199) y = 199;
        unsigned pos = (unsigned)(y >> 3) * 40 + (obj_x[i] >> 2);
        SCREEN[pos] = (st == OBJ_ENEMY) ? 0x57 : (st == OBJ_SPIKE) ? 0x5e : 0x51;
        COLOUR[pos] = (st == OBJ_ENEMY) ? VCOL_LT_RED : (st == OBJ_SPIKE) ? VCOL_YELLOW : VCOL_LT_GREEN;
    }
    unsigned pp = 24 * 40 + (player_x >> 2);
    SCREEN[pp] = 0x5a; COLOUR[pp] = VCOL_WHITE;
}

// --- Time --------------------------------------------------------------------
// CIA1 timer A counts phi2 from $FFFF; timer B counts A's underflows.
static void clock_start(void)
{
    cia1.cra = 0x00; cia1.crb = 0x00;
    cia1.ta = 0xffff; cia1.tb = 0xffff;
    cia1.crb = 0x51;                    // count timer A underflows
    cia1.cra = 0x11;                    // count phi2
}

static unsigned long clock_read(void)
{
    cia1.cra = 0x00; cia1.crb = 0x00;
    char alo = ((volatile char *)0xdc04)[0], ahi = ((volatile char *)0xdc04)[1];
    char blo = ((volatile char *)0xdc06)[0], bhi = ((volatile char *)0xdc06)[1];
    unsigned a = 0xffff - ((unsigned)ahi << 8 | alo);
    unsigned b = 0xffff - ((unsigned)bhi << 8 | blo);
    cia1.cra = 0x01; cia1.crb = 0x41;   // restart with LOAD (bit 4) clear: the count continues
    return ((unsigned long)b << 16) | a;
}

// phi2 cycles to milliseconds: 985,248 Hz PAL, 1,022,727 Hz NTSC.
static unsigned long cycles_to_ms(unsigned long c)
{
    return c / (is_ntsc ? 1023 : 985);
}

// Cost of one level-start row read with the scaler, CIA1 timer A over
// 100 calls, before the game clock starts. __noinline keeps the call real.
__noinline static void row_read_call(void) { level_start(3); }
__noinline static void spawner_call(void) { spawner(); }
// The spawner's worst frame: the interval has run out, a slot is free and
// the count is under the cap, so it counts the pool, rolls the LFSR,
// allocates and spawns. Slot 0 is freed before each call so every call
// is a spawning one.
__noinline static void spawn_frame_call(void)
{
    spawn_timer = 0; obj_state[0] = OBJ_FREE; cur_active = MAX_OBJ;
    spawner();
}
static unsigned cost_of(void (*fn)(void))
{
    cia1.cra = 0x00;
    cia1.ta = 0xffff;
    cia1.cra = 0x11;
    for (char i = 0; i < 100; i++) fn();
    cia1.cra = 0x00;
    return (0xffff - cia1.ta) / 100;
}

static void wait_frame(void)
{
    while (vic.raster == 250) ;
    while (vic.raster != 250) ;
}

int main(void)
{
    __asm { sei }
    cia1.icr = 0x7f;                    // no CIA interrupts, timer A is ours
    is_ntsc = last_raster_line() != 0x37;

    for (unsigned i = 0; i < 1000; i++) { SCREEN[i] = 0x20; COLOUR[i] = VCOL_WHITE; }
    vic.color_back = VCOL_BLACK;
    vic.color_border = VCOL_BLACK;
    put_str(0, 0, is_ntsc ? "NTSC" : "PAL ");
    put_str(0, 5, COMPENSATE ? "COMPENSATED  " : "UNCOMPENSATED");
    put_str(1, 0, "LEVEL");
    put_str(1, 9, "COINS");
    put_str(1, 18, "FRAMES");
    put_str(2, 0, "L3 AT FRAME");
    put_str(2, 18, "MS");
    put_str(2, 28, "SPAWN");

    unsigned row_cost = cost_of(row_read_call);
    spawn_timer = 200;                  // the ordinary frame: count down, return
    unsigned tick_cost = cost_of(spawner_call);
    level_start(3);                     // spikes on, so the spike branch is in the figure
    unsigned spawn_cost = cost_of(spawn_frame_call);
    for (char i = 0; i < MAX_OBJ; i++) obj_state[i] = OBJ_FREE;
    lfsr = LFSR_SEED;                   // the harness rolled it; the game starts from the seed
    spawn_timer = 0;
    put_str(4, 24, "ROW READ");
    put_num(4, 33, row_cost, 4);
    put_str(3, 27, "TICK");
    put_num(3, 32, tick_cost, 4);

    unsigned frames = 0, l3_frames = 0;
    unsigned long l3_ms = 0, l3_cyc = 0;
    char stop = 0;                      // frames left to run after level 3

    level_start(1);
    clock_start();
    for (;;) {
        wait_frame();
        frames++;
        spawner();
        player();
        tick_objects();
        if (coins >= cur_quota) {
            level_start(level + 1);
            if (level == 3) {
                l3_frames = frames;
                l3_cyc = clock_read();
                l3_ms = cycles_to_ms(l3_cyc);
                stop = 200;
            }
        }
        if (stop && --stop == 0) break;
        if ((frames & 3) == 0) {
            draw_field();
            put_num(1, 6, level, 2);
            put_num(1, 15, coins, 2);
            put_num(1, 25, frames, 5);
        }
    }

    // Verdict: the compensated time to level 3 must sit within TOL_MS of
    // REF_MS on either region; uncompensated NTSC is expected 5/6 of it.
    unsigned long want = REF_MS;
    if (!COMPENSATE && is_ntsc) want = (unsigned long)REF_MS * 5 / 6;
    unsigned long diff = l3_ms > want ? l3_ms - want : want - l3_ms;
    char code = diff <= TOL_MS ? CODE_PASS : CODE_FAIL;

    draw_field();
    put_num(1, 6, level, 2);
    put_num(1, 15, coins, 2);
    put_num(1, 25, frames, 5);
    put_num(2, 12, l3_frames, 5);
    put_num(2, 20, l3_ms, 6);
    put_num(2, 34, spawn_cost, 4);
    put_str(4, 0, "L3 AT CYCLE");
    put_num(4, 12, l3_cyc, 9);
    put_str(3, 0, "WANT");
    put_num(3, 5, want, 6);
    put_str(3, 12, "RESULT");
    SCREEN[3 * 40 + 19] = hex_glyph[code >> 4];
    SCREEN[3 * 40 + 20] = hex_glyph[code & 15];
    put_str(3, 22, code == CODE_PASS ? "PASS" : "FAIL");
    RESULT = code;
    vic.color_border = code == CODE_PASS ? VCOL_GREEN : VCOL_RED;
    for (;;) ;
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=difficulty-tables.prg difficulty-tables.c
```

Produces `difficulty-tables.prg`, 2,931 bytes including the BASIC stub
(Oscar64 build 2026-05-19). That is the invocation the pinned run used;
`npm run check:listings` builds the listing the same way. The other
build this page measures:

```bash
oscar64 -tm=c64 -O2 -dCOMPENSATE=0 -o=difficulty-tables-raw.prg difficulty-tables.c   # 2,805 bytes
```

The pinned run, on each model:

```bash
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 -limitcycles 40000000 -exitscreenshot difficulty-tables.png -autostart difficulty-tables.prg
```

Add `-model ntsc` for the NTSC picture. The game reaches level 3 at
about 22 million cycles on either model and stops 200 frames later, so
the screen is final well inside the limit. `REF_MS` is the PAL figure
measured below; change the table and it must be measured again.

## Expected output

Black screen, green border. Rows 0 to 4 are text; rows 5 to 24 are the
playfield, enemies as red circles, spikes as yellow chevrons, coins as
green circles and the player as a white diamond on the bottom row.
Decoded from the pinned pictures with the character ROM:

PAL, `screenshots/difficulty-tables.png`:

```
PAL  COMPENSATED
LEVEL  3 COINS  3 FRAMES  1327
L3 AT FRAME  1128 MS  22497  SPAWN   409
WANT  22493 RESULT 01 PASS TICK   51
L3 AT CYCLE  22159699   ROW READ  181
```

NTSC, `screenshots/difficulty-tables-ntsc.png`:

```
NTSC COMPENSATED
LEVEL  3 COINS  2 FRAMES  1551
L3 AT FRAME  1352 MS  22577  SPAWN   412
WANT  22493 RESULT 01 PASS TICK   53
L3 AT CYCLE  23097254   ROW READ  267
```

The `-dCOMPENSATE=0` build was run on both models and not pinned:

| Build | Model | Level 3 at frame | Level 3 at φ2 cycle | Milliseconds | WANT | Verdict |
|---|---|---|---|---|---|---|
| compensated | PAL | 1128 | 22,159,699 | 22,497 | 22,493 | 01 PASS |
| compensated | NTSC | 1352 | 23,097,254 | 22,577 | 22,493 | 01 PASS |
| uncompensated | PAL | 1128 | 22,166,254 | 22,503 | 22,493 | 01 PASS |
| uncompensated | NTSC | 1128 | 19,281,170 | 18,847 | 18,744 | 01 PASS |

Read across the rows. Uncompensated, the frame count is the same on both
models, because the simulation is deterministic and counts frames, and
the NTSC run reaches level 3 in 18,847 ms against 22,503 ms on PAL: a
ratio of 0.838. Compensated, the frame counts differ by the rescaling
(1352 / 1128 = 1.199) and the printed times agree within 80 ms, 0.4 %
of the run; with the exact clock rates applied to the cycle column
(see "The clock" below) the gap is 93 ms. `TOL_MS` is 500, so the
verdict has room for a different table row rounding and none for the
uncompensated 3.7 second gap. The cycle figures move by a few thousand
between builds of this program because the clock starts part way
through a frame and the first `wait_frame` absorbs the rest of it; the
frame counts do not move.

Three smaller figures are on the screen because the technique page
quotes them. `ROW READ` is the cost of one `level_start` call, the
table read plus the scaler: 181 cycles on PAL and 267 on NTSC in the
compensated build, where the NTSC path runs the multiply and divide;
113 and 118 uncompensated. `TICK` is the spawner's cost on an ordinary
frame, when the interval timer is counting and no spawn happens: 51
cycles on PAL, 53 on NTSC. `SPAWN` is the spawner's worst frame, when
the interval has run out and it counts the pool, rolls the LFSR once or
twice, allocates a slot and fills it: 409 cycles on PAL and 412 on
NTSC in the compensated build, 410 and 415 uncompensated. All three are
averages of one hundred calls timed by CIA1 timer A with the screen on,
so badline stalls are inside them and they wander by a cycle or two
between runs and models; the `SPAWN` average includes the spike branch
as often as the LFSR takes it, and about fifteen cycles of the wrapper
that resets the timer and frees a slot before each call.

## Why this works

**The table is the ramp.** `level_table` is the only place a speed, an
interval, a count or a flag is written. `level_start` copies one row
into `cur_*` at the start of each level, and the spawner and the movers
read those. Changing the game's difficulty is editing a row; adding a
level is adding a row and raising `LEVELS`. The index is clamped to
`LEVELS - 1` before the read, so level 7 and level 200 play row 6 rather
than the bytes after it.

**Level 3 adds a hazard.** Levels 1 and 2 differ in
speed and interval. Level 3 is the first row with `FLAG_SPIKE`, and the
spawner then makes every fourth spawn a spike at one and a half times
the row's speed. The autopilot cannot tell them apart; a player can.
That is the pattern page's rule of a type or
hazard column, not only a speed column.

**Coins, not seconds.** The level advances when `coins >= cur_quota`,
and a coin is only counted if the player is within eight pixels of it
when it reaches the bottom row. A slower player reaches level 3 later.
The time to level 3 that this page measures is therefore a property of
the table and the autopilot together, and it is repeatable because the
LFSR is seeded with a constant.

**Two knobs, two scalers.** Frames at 60 Hz must be more numerous to
last as long: `scale_frames` multiplies by 6/5, with `+2` so the divide
rounds to nearest. Pixels per frame at 60 Hz must be fewer to cover the
same distance in the same time: `scale_speed` multiplies by 5/6 in 8.8,
so a level-1 speed of `$0080` becomes `$006B` rather than zero. Both
scalers run at level start; the only other call is the coin's fall speed
when an enemy lands, and the frame loop never reads the table. The
6/5 is an approximation: a PAL frame is 19.950 ms and a 6567R8 frame is
16.715 ms, a ratio of 0.838, which is why the uncompensated NTSC run
came out at 0.838 of PAL rather than exactly 5/6, and why the
compensated runs differ by 80 ms rather than zero.

**The clock.** `sei` and `icr = $7F` take CIA1 away from the KERNAL,
which leaves timer A running in continuous mode and raising an IRQ about
sixty times a second. The timer reloads itself from its latch; the KERNAL
ROM has no store to `$DC04`/`$DC05` in its IRQ path (the only ones are at
`$F907` and `$FDE4`–`$FDEE`). An earlier version said the KERNAL's
interrupt reloaded the timer. Timer A then counts φ2 from `$FFFF` and timer B, in mode `$51`, counts timer A's
underflows, which makes a 32-bit cycle counter. `clock_read` stops both
before reading so the two halves belong to the same instant, reads the
four bytes low first, and restarts with `$01` and `$41`, which set START
and leave bit 4 clear. Bit 4 of either control register is LOAD, a
strobe that copies the `$FFFF` latch into the counter, so restarting
with the `$11` and `$51` that `clock_start` uses would zero the clock
on every read; a first draft of this page did exactly that and called
it a continuation, and it was caught by reading the clock a second time
200 frames later and getting 200 frames rather than the whole run.
Milliseconds come from dividing by the region's clock in kHz (985 or
1023); that is 0.025 % low on PAL and 0.027 % high on NTSC against the
true 985.248 and 1022.727, about six milliseconds each way at this
length, and because the two errors run in opposite directions they
close the gap between the printed times: divided exactly, the pinned
cycle counts are 22,491.5 ms and 22,584.0 ms, 93 ms apart, where the
screen says 80. Both are far inside `TOL_MS`. This is what
`cia_timer_phi2_difference` in `pitfalls/region-timing.md` is about: a
CIA count is not a time until the region's clock is applied to it.

**Why the frame count also tells the time.** Independently of the CIA,
1128 PAL frames of 19,656 cycles is 22,171,968 cycles, and the CIA read
22,159,699: the difference, 12,269 cycles, is the part of a frame
between the clock's start and the first `wait_frame`. The two
instruments agree to within one frame, under 0.07 %, on every row of
the table above, which is the check that the CIA path is reading the
right registers.

**A bug this page had.** The first build drew the coins on text rows up
to 28, past the 1,000 cells of the screen. The screen writes landed in
the program at `$0800` and the colour writes, at `$D800 + 1120` and up,
landed in the CIA1 register mirror at `$DC60`, where they stopped and
reloaded the timers. The cycle figures were wrong and the frame
counts right: the symptom of a colour RAM index past 1,000 reaching
the I/O area. The playfield now ends at row 24 and
the draw clamps `y` before it indexes.

## Verification

Three instruments, run against the committed PNGs (VICE x64sc 3.10,
windowless build, Oscar64 build 2026-05-19).

**Text and border.** A script matched every cell of rows 0 to 4 against
the glyphs of `chargen-901225-01.bin` and read the border pixel at
(2, 100). Both pictures give the five lines quoted above and the border
RGB VICE emits for colour 5 on each model, (98, 213, 50) on PAL and
(114, 189, 103) on NTSC.

**The four figures.** The frame and millisecond at level 3 were read
from the exit screenshots of four runs, two builds on two models, and
are the table above. The cycle column was checked against frames times
the region's frame length in cycles (19,656 PAL, 17,095 NTSC) and agreed
to within one frame on all four.

**Reproducibility.** The pinned command was run twice per model and the
PNG bytes were identical each time.

**The clock continues across a read.** A test build of this listing
with a second `clock_read` after the 200-frame run-out printed
26,070,834 cycles on PAL against 22,159,660 at level 3, a gap of
3,911,174, which is 200 frames of 19,656 less the fraction of a frame
between the read and the loop's exit. The same build with the restart
changed to `$11` and `$51` printed 3,911,173 for the second read: the
LOAD strobe had reset the clock at the first one. Neither test build is
pinned; the figures on the pinned pictures come from one read.

The CIA cascade was also checked in isolation before the bug above was
found: a 30-line program that starts the two timers, waits 100 PAL
frames and dumps the sixteen CIA1 registers read 29 underflows and a
timer A remainder of `$E4A5`, 1,959,077 cycles against the 1,965,600 of
100 frames; the gap is the start-up before the first `wait_frame`.

## Sources

- `../../game-design/enemy-behaviour-and-difficulty.md`, `difficulty_ramp`:
  the table shape, the held last row and the 50/60 coupling this page
  measures.
- `pal-ntsc-detect.md`: the region read, reused as one function.
- `object-pool.md`: the parallel-array pool and the CIA1 timer A cost
  loop, both reused in shape.
- `headless-verify.md`: the `$02FF` result byte and the border verdict.
- `../../hardware/pal-ntsc-reference.md`: 985,248 Hz and 1,022,727 Hz,
  312 lines of 63 cycles and 263 of 65 (read for the figures; the frame
  lengths above are arithmetic from them).
