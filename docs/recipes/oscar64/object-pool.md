---
recipe: object-pool
toolchain: oscar64
output_format: PRG
region: both
techniques: []
file_formats: [PRG]
uses_registers: [DC04, DC05, DC0E, D011, D020, D021]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 object pool: scan allocator, wave table and per-frame tick, with a self-check

## Synopsis

A pool of eight game objects held as parallel arrays, allocated by
scanning for state 0, filled from a five-byte-per-entry wave table,
ticked once a frame (move, off-screen test, countdown timer) and freed by
writing state 0. The program runs a scripted scenario on the 6510:
sixteen spawns into eight slots, three despawns and three respawns that
must land in the freed slots, a hit that expires by timer, an object that
leaves the screen. It folds the final slot table into a checksum that
must match the value computed in Python and compiled in, prints PASS or
FAIL, and prints the cycle cost of the allocator (best, middle and full
cases), a free-list pop and push, the update pass with eight and with no
active slots, and a spawn, all timed with CIA1 timer A. The pattern is
described under "Object pool" in `../../game-design/game-design-patterns.md`.

## Source

```c
// object-pool.c
// A fixed pool of MAX_OBJ game objects held as parallel arrays. Slots are
// allocated by scanning for state 0, filled from a wave table, ticked once
// per frame (movement, off-screen check, countdown timer) and freed by
// writing state 0. The program runs a scripted scenario on the 6510, folds
// the final slot bytes into a checksum that must match the value computed
// in Python and compiled in below, and times the allocator and the update
// pass with CIA1 timer A.
#include <c64/vic.h>
#include <c64/cia.h>

#define SCREEN ((char *)0x0400)
#define COLOUR ((char *)0xd800)

#define MAX_OBJ     8
#define NO_SLOT     0xff
#define OFF_BOTTOM  250        // y at or past this is below the visible window

#define OBJ_FREE    0
#define OBJ_ALIVE   1
#define OBJ_DYING   2

#define EXPECT_CHK  0x0A95     // Python fold over the 48 final slot bytes

// The slot table: one byte per slot per attribute. Index = slot number.
char obj_state[MAX_OBJ];       // 0 = free, otherwise the object's state
char obj_type[MAX_OBJ];        // indexes the per-type tables below
char obj_x[MAX_OBJ];
char obj_y[MAX_OBJ];
char obj_dy[MAX_OBJ];          // signed pixels per frame
char obj_timer[MAX_OBJ];       // frames to live; 0 = no timer

// Per-type data.
static const char type_life[4] = { 0, 12, 12, 40 };
static const char type_dy[4]   = { 0,  1,  1,  2 };

// Wave table: frame, type, x, y, count; a frame byte of $ff ends it.
// Entries are in frame order. count objects are placed 16 pixels apart.
static const char wave_table[] = {
    0, 1,  24, 50, 8,
    0, 2,  24, 60, 8,
    1, 3, 100, 70, 3,
    0xff };
static char wave_pos;

// Counters the scenario reads back.
char spawn_ok, spawn_refused, expired, went_off;
char spawn_log[16];            // slot taken by each successful spawn
char spawn_log_n;

// Find a free slot: the first slot whose state is 0.
__noinline char pool_alloc(void)
{
    for (char i = 0; i < MAX_OBJ; i++)
        if (obj_state[i] == OBJ_FREE)
            return i;
    return NO_SLOT;
}

// Free-list alternative: a stack of free slot numbers.
char free_stack[MAX_OBJ];
char free_top;

__noinline char fl_alloc(void)
{
    if (free_top == 0)
        return NO_SLOT;
    return free_stack[--free_top];
}

__noinline void fl_free(char slot)
{
    free_stack[free_top++] = slot;
}

__noinline char spawn(char type, char x, char y)
{
    char s = pool_alloc();
    if (s == NO_SLOT)
    {
        spawn_refused++;
        return NO_SLOT;
    }
    obj_type[s]  = type;
    obj_x[s]     = x;
    obj_y[s]     = y;
    obj_dy[s]    = type_dy[type];
    obj_timer[s] = type_life[type];
    obj_state[s] = OBJ_ALIVE;
    spawn_ok++;
    spawn_log[spawn_log_n++] = s;
    return s;
}

__noinline void despawn(char slot)
{
    obj_state[slot] = OBJ_FREE;
}

// A hit starts the dying state: five frames of explosion, then the slot
// is freed by the timer.
static void hit(char slot)
{
    obj_state[slot] = OBJ_DYING;
    obj_timer[slot] = 5;
}

// Spawn every wave entry due on this frame.
static void wave_step(char frame)
{
    while (wave_table[wave_pos] == frame)
    {
        char type  = wave_table[wave_pos + 1];
        char x     = wave_table[wave_pos + 2];
        char y     = wave_table[wave_pos + 3];
        char count = wave_table[wave_pos + 4];
        for (char k = 0; k < count; k++)
            spawn(type, x + (k << 4), y);
        wave_pos += 5;
    }
}

// One frame for every active slot: move, drop what left the screen,
// count the timer down and free the slot when it reaches zero.
__noinline void update_all(void)
{
    for (char i = 0; i < MAX_OBJ; i++)
    {
        if (obj_state[i] == OBJ_FREE)
            continue;
        char y = obj_y[i] + obj_dy[i];
        obj_y[i] = y;
        if (y >= OFF_BOTTOM)
        {
            obj_state[i] = OBJ_FREE;
            went_off++;
        }
        else if (obj_timer[i] != 0 && --obj_timer[i] == 0)
        {
            obj_state[i] = OBJ_FREE;
            expired++;
        }
    }
}

static char frame;

static void game_frame(void)
{
    wave_step(frame);
    update_all();
    frame++;
}

// ---- timing subjects -----------------------------------------------------

__noinline void nothing(void)
{
}

__noinline void fl_pop_push(void)
{
    fl_free(fl_alloc());
}

__noinline void spawn_despawn(void)
{
    despawn(spawn(1, 0, 0));
}

// CIA1 timer A: force-load $FFFF, count phi2 while fn runs 100 times, read.
// 100 and not 256: eight active slots for 256 calls would pass 65,535
// cycles and the 16-bit timer would wrap (it did, in the first build).
static unsigned time_loop(void (*fn)(void))
{
    cia1.cra = 0x00;
    cia1.ta = 0xffff;
    cia1.cra = 0x11;
    char i = 100;
    do
    {
        fn();
    } while (--i);
    cia1.cra = 0x00;
    return 0xffff - cia1.ta;
}

// pool_alloc through a void(*)(void) pointer: the result is discarded.
volatile char sink;
__noinline void alloc_call(void)
{
    sink = pool_alloc();
}

// ---- screen --------------------------------------------------------------

static void put_str(char row, char col, const char *s)
{
    char *p = SCREEN + 40 * row + col;
    while (*s)
    {
        char c = *s++;
        *p++ = (c >= 'a' && c <= 'z') ? c - 'a' + 1 : c;
    }
}

static void put_dec(char row, char col, unsigned v, char width)
{
    char *p = SCREEN + 40 * row + col + width;
    do
    {
        *--p = '0' + v % 10;
        v /= 10;
    } while (--width);
}

static const char hex_glyph[16] = {
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 1, 2, 3, 4, 5, 6 };

static void put_hex16(char row, char col, unsigned v)
{
    char *p = SCREEN + 40 * row + col;
    p[0] = hex_glyph[(v >> 12) & 15];
    p[1] = hex_glyph[(v >> 8) & 15];
    p[2] = hex_glyph[(v >> 4) & 15];
    p[3] = hex_glyph[v & 15];
}

// Net cycles per call to two decimals: (t - t0) / 100 calls.
static void put_per_call(char row, char col, unsigned t, unsigned t0)
{
    unsigned n = t - t0;                // hundredths of a cycle per call
    put_dec(row, col, n / 100, 3);
    SCREEN[40 * row + col + 3] = '.';
    put_dec(row, col + 4, n % 100, 2);
}

static unsigned fold(unsigned cs, unsigned v)
{
    return (cs ^ v) * 5 + 1;
}

static char count_active(void)
{
    char n = 0;
    for (char i = 0; i < MAX_OBJ; i++)
        if (obj_state[i] != OBJ_FREE)
            n++;
    return n;
}

int main(void)
{
    for (unsigned i = 0; i < 1000; i++)
    {
        SCREEN[i] = 0x20;
        COLOUR[i] = VCOL_WHITE;
    }
    vic.color_back = VCOL_BLACK;
    vic.color_border = VCOL_BLACK;

    put_str(0, 0, "object pool  8 slots  scan alloc");

    // Frame 0: the wave table asks for 16 objects; 8 fit.
    game_frame();
    char ok0 = spawn_ok, ref0 = spawn_refused;
    put_str(1, 0, "spawn 16   ok      refused");
    put_dec(1, 14, ok0, 2);
    put_dec(1, 27, ref0, 2);

    // The player shoots slots 1, 4 and 6; frame 1's wave entry refills them.
    despawn(1);
    despawn(4);
    despawn(6);
    game_frame();
    put_str(2, 0, "despawn 1 4 6   respawn 3 ->");
    put_dec(2, 29, spawn_log[8], 1);
    put_dec(2, 31, spawn_log[9], 1);
    put_dec(2, 33, spawn_log[10], 1);

    // Slot 3 is hit: five dying frames, then the timer frees it.
    hit(3);
    for (char f = 0; f < 5; f++)
        game_frame();
    char exp1 = expired, act1 = count_active();
    put_str(3, 0, "hit slot 3  expired    active");
    put_dec(3, 20, exp1, 1);
    put_dec(3, 30, act1, 2);

    // A new object just above the bottom edge leaves the screen next frame.
    char s_off = spawn(1, 0, OFF_BOTTOM - 1);
    game_frame();
    char off1 = went_off, act2 = count_active();
    put_str(4, 0, "spawn y249 -> slot    off    active");
    put_dec(4, 19, s_off, 1);
    put_dec(4, 26, off1, 1);
    put_dec(4, 36, act2, 2);
    put_str(5, 0, "frame");
    put_dec(5, 6, frame, 2);

    // Checksum over every byte of the final slot table.
    unsigned chk = 0;
    for (char i = 0; i < MAX_OBJ; i++)
    {
        chk = fold(chk, obj_state[i]);
        chk = fold(chk, obj_type[i]);
        chk = fold(chk, obj_x[i]);
        chk = fold(chk, obj_y[i]);
        chk = fold(chk, obj_dy[i]);
        chk = fold(chk, obj_timer[i]);
    }
    put_str(6, 0, "chk      exp");
    put_hex16(6, 4, chk);
    put_hex16(6, 13, EXPECT_CHK);

    bool pass = ok0 == 8 && ref0 == 8 &&
                spawn_log[8] == 1 && spawn_log[9] == 4 && spawn_log[10] == 6 &&
                exp1 == 1 && act1 == 7 && s_off == 3 && off1 == 1 &&
                act2 == 7 && frame == 8 && chk == EXPECT_CHK;

    // Cycle costs. Interrupts off and DEN off so nothing steals cycles.
    __asm { sei }
    vic.ctrl1 = 0x0b;
    vic_waitFrame();
    unsigned t0 = time_loop(nothing);

    // Scan with slot 0 free (best case) and with every slot taken.
    unsigned t_scan0 = time_loop(alloc_call);          // slot 3 is free
    obj_state[3] = OBJ_ALIVE;
    unsigned t_full = time_loop(alloc_call);           // refused, 8 compares
    obj_state[0] = OBJ_FREE;
    unsigned t_best = time_loop(alloc_call);           // slot 0 free

    // Free list: pop then push, one entry on the stack.
    free_stack[0] = 0;
    free_top = 1;
    unsigned t_fl = time_loop(fl_pop_push);

    // Update pass with 8 active slots that neither move nor expire, and
    // with none active.
    for (char i = 0; i < MAX_OBJ; i++)
    {
        obj_state[i] = OBJ_ALIVE;
        obj_dy[i] = 0;
        obj_y[i] = 100;
        obj_timer[i] = 250;
    }
    unsigned t_it8 = time_loop(update_all);
    for (char i = 0; i < MAX_OBJ; i++)
        obj_state[i] = OBJ_FREE;
    unsigned t_it0 = time_loop(update_all);

    // Spawn into slot 0 then free it again.
    unsigned t_sp = time_loop(spawn_despawn);
    vic.ctrl1 = 0x1b;

    put_str(8, 0,  "cycles x100          total  per call");
    put_str(9, 0,  "empty call");
    put_dec(9, 21, t0, 5);
    put_str(10, 0, "scan, slot 0 free");
    put_dec(10, 21, t_best, 5);
    put_per_call(10, 29, t_best, t0);
    put_str(11, 0, "scan, slot 3 free");
    put_dec(11, 21, t_scan0, 5);
    put_per_call(11, 29, t_scan0, t0);
    put_str(12, 0, "scan, pool full");
    put_dec(12, 21, t_full, 5);
    put_per_call(12, 29, t_full, t0);
    put_str(13, 0, "free list pop+push");
    put_dec(13, 21, t_fl, 5);
    put_per_call(13, 29, t_fl, t0);
    put_str(14, 0, "update, 8 active");
    put_dec(14, 21, t_it8, 5);
    put_per_call(14, 29, t_it8, t0);
    put_str(15, 0, "update, 0 active");
    put_dec(15, 21, t_it0, 5);
    put_per_call(15, 29, t_it0, t0);
    put_str(16, 0, "spawn+despawn");
    put_dec(16, 21, t_sp, 5);
    put_per_call(16, 29, t_sp, t0);

    put_str(18, 0, pass ? "pass" : "fail");
    vic.color_border = pass ? VCOL_GREEN : VCOL_RED;
    for (;;)
        ;
    return 0;
}
```

## Build

```
oscar64 -tm=c64 -O2 -o=object-pool.prg object-pool.c
GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas timeout 180 x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 -limitcycles 8000000 -exitscreenshot object-pool.png -autostart object-pool.prg
```

Add `-model ntsc` for the NTSC picture. 8,000,000 cycles is the pinned
run; the timed loops total about 108,000 cycles (the sum of the TOTAL
column) and the scenario is a few thousand more, so the screen is
complete long before the limit.

## Expected output

Black screen, green border. Decoded from `screenshots/object-pool.png`
(PAL) with the character ROM; rows 7, 17 and 19 to 24 are blank:

```
OBJECT POOL  8 SLOTS  SCAN ALLOC
SPAWN 16   OK 08   REFUSED 08
DESPAWN 1 4 6   RESPAWN 3 -> 1 4 6
HIT SLOT 3  EXPIRED 1  ACTIVE 07
SPAWN Y249 -> SLOT 3  OFF 1  ACTIVE 07
FRAME 08
CHK 0A95 EXP 0A95

CYCLES X100          TOTAL  PER CALL
EMPTY CALL           03709
SCAN, SLOT 0 FREE    06409   027.00
SCAN, SLOT 3 FREE    10109   064.00
SCAN, POOL FULL      16109   124.00
FREE LIST POP+PUSH   08109   044.00
UPDATE, 8 ACTIVE     41709   380.00
UPDATE, 0 ACTIVE     14309   106.00
SPAWN+DESPAWN        18309   146.00

PASS
```

`screenshots/object-pool-ntsc.png` (`-model ntsc`) has the same text in
every cell: the 320 by 200 ink mask of the two pictures compared equal
cell for cell, and both borders read green (measured in VICE x64sc 3.10).
Nothing in the program depends on the frame rate; the CIA counts phi2
cycles with the screen blanked, and the counts are identical on both
models.

What each row states, and what the Python model gives for it:

- Row 1: frame 0's two wave entries ask for 16 objects; 8 are placed and
  8 refused with `NO_SLOT`.
- Row 2: slots 1, 4 and 6 are freed; frame 1's entry spawns 3, and the
  scan hands out exactly 1, 4 and 6, in that order.
- Row 3: slot 3 is hit (state 2, timer 5); after five frames the timer
  frees it, the only expiry so far, leaving 7 active.
- Row 4: a spawn at y 249 takes slot 3, the lowest free; the next tick
  moves it to 250 and the off-screen test frees it, so 7 are active again.
- Row 5: eight frames ran.
- Row 6: the fold over the 48 bytes of the six arrays is $0A95 on the 6510
  and in Python.
- Rows 9 to 16: CIA1 timer A over 100 calls, total and net per call. The
  per-call column subtracts the empty-call row and divides by 100.

The Python side of the scenario:

```python
life = {0: 0, 1: 12, 2: 12, 3: 40}
dyt  = {0: 0, 1: 1, 2: 1, 3: 2}
st, ty, x, y, dy, tm = ([0] * 8 for _ in range(6))
wave = [(0, 1, 24, 50, 8), (0, 2, 24, 60, 8), (1, 3, 100, 70, 3)]
log, frame = [], 0

def spawn(t, xx, yy):
    for s in range(8):
        if st[s] == 0:
            ty[s], x[s], y[s], dy[s], tm[s], st[s] = t, xx & 255, yy, dyt[t], life[t], 1
            log.append(s)
            return s
    return None

def game_frame():
    global frame
    for f, t, xx, yy, c in wave:
        if f == frame:
            for k in range(c):
                spawn(t, xx + (k << 4), yy)
    for i in range(8):
        if st[i] == 0:
            continue
        y[i] = (y[i] + dy[i]) & 255
        if y[i] >= 250:
            st[i] = 0
        elif tm[i] != 0:
            tm[i] -= 1
            if tm[i] == 0:
                st[i] = 0
    frame += 1

game_frame()                       # 16 asked, 8 placed
for s in (1, 4, 6):
    st[s] = 0
game_frame()                       # log[8:11] == [1, 4, 6]
st[3], tm[3] = 2, 5
for _ in range(5):
    game_frame()                   # slot 3 expires on the fifth
spawn(1, 0, 249)                   # takes slot 3
game_frame()                       # slot 3 leaves the screen

def fold(c, v):
    return ((c ^ v) * 5 + 1) & 0xFFFF

chk = 0
for i in range(8):
    for v in (st[i], ty[i], x[i], y[i], dy[i], tm[i]):
        chk = fold(chk, v)
print(log[8:11], frame, hex(chk))  # [1, 4, 6] 8 0xa95
```

## Why this works

The allocator is a linear scan and its cost says so: 27 cycles with slot
0 free, 64 with slot 3 the first free, 124 for a full pool, about 12
cycles per slot examined. The free-list pop and push pair at 44 is the
alternative when the pool is large; here its only advantage is the
constant cost, and it needs every free to go through `fl_free`. The
update pass costs 380 cycles for eight active slots and 106 for eight
free ones, so skipping a free slot is 13.25 cycles and ticking a live one
47.5. Oscar64 -O2 compiles `update_all` to one absolute-indexed loop and
folds the timer decrement into an `sbc #0` that borrows the clear carry
left by the off-screen compare.

The scenario checks the two properties a pool must have. The scan hands
out the lowest free slot, so the three respawns after freeing 1, 4 and 6
must land there in that order; and a slot is freed by exactly one write
of state 0, from whichever of the three paths (despawn, timer, off
screen) reaches it first. The checksum covers every byte of every array,
including the stale fields of the freed slot, so the Python model has to
reproduce the order of the tick's writes and not just the live objects.

Timing: `time_loop` stops CIA1 timer A, writes $FFFF to its latch,
force-loads and starts it counting phi2 (`cra = $11`), calls the subject
100 times through a pointer, stops the timer and reads it. The first
build called each subject 200 times and the eight-active update read
52.32 cycles per call: 200 calls at 380 cycles pass 65,535 and the 16-bit timer reloads from its latch and carries on,
so the reading was the count modulo 65,536. A per-call figure with a
fraction in it, from a loop whose body does the same work every time, is
the sign of that wrap. 100 calls keep the largest subject under 42,000.
`sei` and DEN off keep the KERNAL interrupt and badlines out of the count;
the subjects for the update pass have `dy` 0 and timers of 250 so that no
slot moves or expires during the 100 calls, and the scan subjects do not
write the table at all.
