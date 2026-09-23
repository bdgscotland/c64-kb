---
recipe: dig-and-guards
toolchain: oscar64
output_format: PRG
region: both
techniques: [dig_and_refill]
file_formats: [PRG]
uses_registers: [D011, D020, D021, DC06, DC07, DC0F]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 Dig and Guards: holes that refill, a guard that falls in, climbs out and dies

## Synopsis

A 28 x 16 cell level with a brick floor, two ladders and a solid bottom.
A scripted player (autopilot) digs a hole beside it, waits for the guard
to fall in, walks over the trapped guard's head, runs on and digs a
second hole. The guard climbs out of the first hole before it refills,
falls into the second, and is still inside when it refills: it dies and
respawns on the top row, lands on the brick floor, walks to the nearest
ladder and climbs down after the player. Every tick folds the map and
all actor states into a 16-bit checksum, and every 16th tick compares it
with a value from a Python model of the same rules, compiled in. After
the script one stress tick runs the technique's worst frame on purpose.
The screen shows event counts, CIA1 timer B cycles and PASS or FAIL.
`$02FF` = `01` and a green border on pass, `02` and red on fail. This is
the `dig_and_refill` technique in `docs/techniques/logic.md`; the
result-byte contract is `headless-verify.md`.

## Source

```c
// dig-and-guards.c
//
// Dig-and-refill bricks and a chasing guard on a 28 x 16 cell map. The
// player digs a brick diagonally below-left or below-right when the cell
// above it is empty. The hole goes into an eight-slot timer list: it
// shows a refill glyph for its last 16 ticks and is brick again at 0.
// A guard that falls into a hole is trapped for 30 guard ticks, then
// climbs out and steps sideways. Anyone standing over a trapped guard is
// held up by it. A hole that refills on a guard kills it, and the guard
// respawns on the top row. Guards move on even ticks by a greedy rule:
// straight at the player along a clear row, up or down a ladder they
// stand on, else to the nearest column on their row that offers a move
// toward the player's row, else toward the player's column.
// The player follows a script (autopilot). A checksum of the map and all
// actor states is folded every tick and compared every 16 ticks with the
// values from a Python model of the same rules, compiled in.
// After the script, one stress tick: four free guards scan their whole
// row, eight live holes on the ledge (one expires, one starts refilling),
// and the player tries a dig with the hole list full.
// Row 0: tick, digs, traps, escapes, kills, walk-over ticks. Row 1: CIA1
// timer B cycles, worst hole-list update, worst single guard update,
// worst tick. Row 2: stress tick total, its hole-list update and its
// worst guard, checkpoint misses, result. Row 3: final checksum, worst
// player update (move or dig).
// The screen keeps the scenario's last tick; the stress tick is not drawn.
// $02FF = 01 and a green border on pass, 02 and red on fail.
// Build: oscar64 -tm=c64 -O2 -o=dig-and-guards.prg dig-and-guards.c
#include <c64/vic.h>
#include <c64/cia.h>
#include <string.h>

#define SCREEN ((char *)0x0400)
#define COLOUR ((char *)0xd800)
#define RESULT (*(volatile char *)0x02ff)
#define CODE_PASS 0x01
#define CODE_FAIL 0x02

#define W 28
#define H 16
#define ROW0 5                              // screen row of map row 0
#define COL0 6                              // screen column of map column 0

enum { T_E, T_B, T_S, T_L, T_HOLE, T_FILL };

#define HOLE_T   80                         // ticks from dig to brick
#define REFILL_T 16                         // refill glyph from this count
#define T_TRAP   30                         // guard ticks spent in a hole
#define NH 8
#define NG 4
#define RESPAWN_X 13

static const char level[H][W + 1] = {
    "............................",
    "............................",
    "............................",
    "###########.................",
    "............................",
    "............................",
    "............................",
    "SS#H######################HS",
    "...H......................H.",
    "...H......................H.",
    "...H......................H.",
    "...H......................H.",
    "...H......................H.",
    "...H......................H.",
    "...H......................H.",
    "SSSSSSSSSSSSSSSSSSSSSSSSSSSS",
};

// Autopilot: action, ticks. Z digs left, X digs right, W waits.
struct Step { char act, n; };
static const struct Step script[] = {
    {'X', 1}, {'W', 12}, {'R', 16}, {'Z', 1}, {'W', 82},
    {'R', 2}, {'D', 8}, {'L', 10}, {'W', 36},
};
#define NSTEPS (sizeof(script) / sizeof(script[0]))

// From dig_model.py (see the page): checksum after every 16th tick,
// after the last tick (168), and after the stress tick.
static const unsigned exp_check[] = {
    0xbfa0, 0x2b2a, 0x8f96, 0x94c2, 0x3c57,
    0x859c, 0x585a, 0xb6b3, 0x1f4b, 0x3dfa,
};
#define NCHECK 10
#define EXP_TICKS  168
#define EXP_FINAL  0xefbe
#define EXP_STRESS 0x9760

char map[H][W];
char *rowp[H];                              // row pointers: no multiply by 28
char hx[NH], hy[NH], ht[NH];                // hole list: cell and timer
char gx[NG], gy[NG], gst[NG], gcnt[NG], gon[NG];   // st 0 free, 1 trapped, 2 escaping
char px, py, alive;
char digs, traps, escs, kills, walk;

char dirty_x[24], dirty_y[24], ndirty;

static inline void set_tile(char x, char y, char t)
{
    rowp[y][x] = t;
    dirty_x[ndirty] = x;
    dirty_y[ndirty] = y;
    ndirty++;
}

static inline bool blocked(char t)
{
    return t == T_B || t == T_S;
}

signed char guard_at(char x, char y)
{
    for (char i = 0; i < NG; i++)
        if (gon[i] && gx[i] == x && gy[i] == y)
            return i;
    return -1;
}

bool trapped_at(char x, char y)
{
    signed char i = guard_at(x, y);
    return i >= 0 && gst[i] == 1;
}

bool supported(char x, char y)
{
    if (rowp[y][x] == T_L)
        return true;
    char b = rowp[y + 1][x];
    if (b == T_B || b == T_S || b == T_L)
        return true;
    return (b == T_HOLE || b == T_FILL) && trapped_at(x, y + 1);
}

// --- digging and the hole list -------------------------------------------
void dig(signed char dx)
{
    signed char tx = (signed char)px + dx;
    char ty = py + 1;
    if (tx < 0 || tx >= W)
        return;
    if (rowp[ty][tx] != T_B || rowp[py][tx] != T_E || guard_at(tx, py) >= 0)
        return;
    for (char i = 0; i < NH; i++) {
        if (ht[i] == 0) {
            hx[i] = tx; hy[i] = ty; ht[i] = HOLE_T;
            set_tile(tx, ty, T_HOLE);
            digs++;
            return;
        }
    }
}

void holes_update(void)
{
    for (char i = 0; i < NH; i++) {
        if (ht[i] == 0)
            continue;
        char t = --ht[i];
        char x = hx[i], y = hy[i];
        if (t == REFILL_T) {
            set_tile(x, y, T_FILL);
        } else if (t == 0) {
            set_tile(x, y, T_B);
            for (char g = 0; g < NG; g++) {
                if (gon[g] && gx[g] == x && gy[g] == y) {
                    gx[g] = RESPAWN_X; gy[g] = 0; gst[g] = 0; gcnt[g] = 0;
                    kills++;
                }
            }
            if (px == x && py == y)
                alive = 0;
        }
    }
}

// --- player --------------------------------------------------------------
void player_update(char a)
{
    char x = px, y = py;
    if (!supported(x, y))
        py++;
    else if (a == 'L' && x > 0 && !blocked(rowp[y][x - 1]))
        px--;
    else if (a == 'R' && x < W - 1 && !blocked(rowp[y][x + 1]))
        px++;
    else if (a == 'U' && rowp[y][x] == T_L && !blocked(rowp[y - 1][x]))
        py--;
    else if (a == 'D' && !blocked(rowp[y + 1][x]) && guard_at(x, y + 1) < 0)
        py++;
    else if (a == 'Z')
        dig(-1);
    else if (a == 'X')
        dig(1);
    char b = rowp[py + 1][px];
    if ((b == T_HOLE || b == T_FILL) && trapped_at(px, py + 1))
        walk++;
}

// --- guards --------------------------------------------------------------
signed char mdx, mdy;

// The guard's row and the rows above and below it, fetched once per
// decision so the scan does no row arithmetic.
const char *r_up, *r_at, *r_dn;
char s_y;

static inline bool held(signed char c)          // can stand at column c
{
    if (r_at[c] == T_L)
        return true;
    char b = r_dn[c];
    if (b == T_B || b == T_S || b == T_L)
        return true;
    return (b == T_HOLE || b == T_FILL) && trapped_at(c, s_y + 1);
}

// One cell of the row scan: 0 the scan stops here, 1 this column offers
// a move toward the player's row, 2 walk on past it.
char probe(signed char c)
{
    if (c < 0 || c >= W || blocked(r_at[c]))
        return 0;
    if (py < s_y) {
        if (r_at[c] == T_L && !blocked(r_up[c]))
            return 1;
    } else {
        char b = r_dn[c];
        if (b == T_L || b == T_E)
            return 1;
    }
    return held(c) ? 2 : 0;
}

void decide(char g)
{
    char x = gx[g], y = gy[g];
    s_y = y;
    r_at = rowp[y];
    r_dn = rowp[y + 1];
    r_up = y ? rowp[y - 1] : r_at;
    mdx = 0; mdy = 0;
    if (y == py && x != px) {
        signed char d = px > x ? 1 : -1;
        signed char c = x;
        for (;;) {
            c += d;
            if (blocked(r_at[c]) || !held(c))
                break;
            if (c == px) { mdx = d; return; }
        }
    }
    if (py < y && r_at[x] == T_L && !blocked(r_up[x])) { mdy = -1; return; }
    if (py > y) {
        char b = r_dn[x];
        if (b == T_L || b == T_E) { mdy = 1; return; }
    }
    if (py != y) {
        signed char cl = x, cr = x;
        bool open_l = true, open_r = true;
        while (open_l || open_r) {
            if (open_l) {
                char r = probe(--cl);
                if (r == 1) { mdx = -1; return; }
                if (r == 0) open_l = false;
            }
            if (open_r) {
                char r = probe(++cr);
                if (r == 1) { mdx = 1; return; }
                if (r == 0) open_r = false;
            }
        }
    }
    if (px != x)
        mdx = px > x ? 1 : -1;
}

bool guard_step(char g, signed char dx, signed char dy)
{
    signed char nx = (signed char)gx[g] + dx;
    char ny = gy[g] + dy;
    if (nx < 0 || nx >= W || blocked(rowp[ny][nx]) || guard_at(nx, ny) >= 0)
        return false;
    gx[g] = nx; gy[g] = ny;
    return true;
}

void guard_update(char g)
{
    if (!gon[g])
        return;
    if (gst[g] == 1) {
        if (--gcnt[g] == 0) {
            if (guard_step(g, 0, -1)) { gst[g] = 2; escs++; }
            else gcnt[g] = 1;
        }
    } else if (gst[g] == 2) {
        signed char d = px >= gx[g] ? 1 : -1;
        if (!guard_step(g, d, 0))
            guard_step(g, -d, 0);
        gst[g] = 0;
    } else if (!supported(gx[g], gy[g])) {
        gy[g]++;
        char t = rowp[gy[g]][gx[g]];
        if (t == T_HOLE || t == T_FILL) {
            gst[g] = 1; gcnt[g] = T_TRAP;
            traps++;
        }
    } else {
        decide(g);
        if (mdx || mdy)
            guard_step(g, mdx, mdy);
    }
    if (gx[g] == px && gy[g] == py)
        alive = 0;
}

// --- checksum (outside the timed work) --------------------------------------
unsigned digest(void)
{
    unsigned v = 0;
    const char *p = &map[0][0];
    for (unsigned i = 0; i < W * H; i++)
        v += p[i];
    for (char g = 0; g < NG; g++)
        v += gx[g] + (unsigned)gy[g] * 32 + (unsigned)gst[g] * 1024 + gcnt[g]
           + (unsigned)gon[g] * 4096;
    v += px + (unsigned)py * 32 + (unsigned)alive * 1024;
    return v;
}

static inline unsigned rol16(unsigned c)
{
    return (c << 1) | (c >> 15);
}

// --- CIA1 timer B harness ----------------------------------------------------
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

// --- drawing ----------------------------------------------------------------
static const char tile_char[6] = { 0x20, 0x66, 0xa0, 0x08, 0x20, 0x62 };
static const char tile_col[6]  = { VCOL_BLACK, VCOL_RED, VCOL_LT_GREY,
                                   VCOL_YELLOW, VCOL_BLACK, VCOL_ORANGE };

void draw_cell(char x, char y)
{
    unsigned o = (unsigned)(ROW0 + y) * 40 + COL0 + x;
    char t = rowp[y][x];
    SCREEN[o] = tile_char[t];
    COLOUR[o] = tile_col[t];
}

void draw_actor(char x, char y, char ch, char col)
{
    unsigned o = (unsigned)(ROW0 + y) * 40 + COL0 + x;
    SCREEN[o] = ch;
    COLOUR[o] = col;
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

void put_hex(char *p, unsigned v)
{
    for (char i = 4; i > 0; i--) {
        char n = v & 15;
        p[i - 1] = n < 10 ? 0x30 + n : n - 9;
        v >>= 4;
    }
}

char ogx[NG], ogy[NG], opx, opy;

void redraw(void)
{
    for (char i = 0; i < ndirty; i++)
        draw_cell(dirty_x[i], dirty_y[i]);
    ndirty = 0;
    draw_cell(opx, opy);
    for (char g = 0; g < NG; g++)
        draw_cell(ogx[g], ogy[g]);
    draw_actor(px, py, 0x53, VCOL_CYAN);          // heart: the player
    for (char g = 0; g < NG; g++) {
        if (gon[g])
            draw_actor(gx[g], gy[g], 0x51, gst[g] == 1 ? VCOL_PURPLE : VCOL_WHITE);
        ogx[g] = gx[g]; ogy[g] = gy[g];
    }
    opx = px; opy = py;
}

int main(void)
{
    __asm { sei }
    vic.color_border = VCOL_BLACK;
    vic.color_back = VCOL_BLACK;
    memset(SCREEN, 0x20, 1000);
    memset(COLOUR, VCOL_WHITE, 1000);

    for (char y = 0; y < H; y++)
        rowp[y] = map[y];
    for (char y = 0; y < H; y++) {
        for (char x = 0; x < W; x++) {
            char c = level[y][x], t = T_E;
            if (c == '#') t = T_B;
            else if (c == 'S') t = T_S;
            else if (c == 'H') t = T_L;
            rowp[y][x] = t;
            draw_cell(x, y);
        }
    }
    gon[0] = 1; gx[0] = 14; gy[0] = 6;
    px = 8; py = 6; alive = 1;
    opx = px; opy = py;
    redraw();

    put_str(SCREEN,       s"t     dig   trap  esc   kill  walk");
    put_str(SCREEN + 40,  s"holes       guard       tick");
    put_str(SCREEN + 80,  s"st       sh       sg       m    r");
    put_str(SCREEN + 120, s"cs       pl");

    unsigned cs = 0, tick = 0, t_hole = 0, t_guard = 0, t_tick = 0, t_play = 0;
    char step = 0, left = script[0].n, miss = 0, ci = 0;

    while (step < NSTEPS) {
        vic_waitFrame();
        char a = script[step].act;

        unsigned tt = 0;
        timer_start();
        player_update(a);
        tt = timer_stop();
        if (tt > t_play) t_play = tt;
        timer_start();
        holes_update();
        unsigned t = timer_stop();
        tt += t;
        if (t > t_hole) t_hole = t;
        if ((tick & 1) == 0) {
            for (char g = 0; g < NG; g++) {
                timer_start();
                guard_update(g);
                t = timer_stop();
                tt += t;
                if (t > t_guard) t_guard = t;
            }
        }
        if (tt > t_tick) t_tick = tt;

        cs = rol16(cs) ^ digest();
        tick++;
        if ((tick & 15) == 0) {
            if (ci >= NCHECK || cs != exp_check[ci])
                miss++;
            ci++;
        }
        redraw();

        put_dec(SCREEN + 2, tick, 3);
        put_dec(SCREEN + 10, digs, 1);
        put_dec(SCREEN + 16, traps, 1);
        put_dec(SCREEN + 22, escs, 1);
        put_dec(SCREEN + 28, kills, 1);
        put_dec(SCREEN + 34, walk, 3);
        put_dec(SCREEN + 40 + 6, t_hole, 5);
        put_dec(SCREEN + 40 + 18, t_guard, 5);
        put_dec(SCREEN + 40 + 29, t_tick, 5);

        if (--left == 0) {
            step++;
            if (step < NSTEPS)
                left = script[step].n;
        }
    }

    char fault = 0;
    if (ci != NCHECK || miss) fault = 1;
    else if (tick != EXP_TICKS || cs != EXP_FINAL) fault = 2;
    else if (digs != 2 || traps != 2 || escs != 1 || kills != 1 || !walk || !alive) fault = 3;

    // Stress tick: the technique's worst frame, built on purpose. One dig
    // a tick and a fixed HOLE_T mean at most one hole expires and one
    // starts refilling per tick. The holes sit on the ledge, off row 7,
    // so they do not cut the guards' scans short.
    static const char st_t[NH] = { 1, 17, 30, 40, 50, 60, 70, 79 };
    for (char i = 0; i < NH; i++) {
        hx[i] = 3 + i; hy[i] = 3; ht[i] = st_t[i];
        set_tile(3 + i, 3, st_t[i] <= REFILL_T ? T_FILL : T_HOLE);
    }
    for (char g = 0; g < NG; g++) {
        gon[g] = 1; gx[g] = 7 + 5 * g; gy[g] = 6; gst[g] = 0; gcnt[g] = 0;
    }
    px = 1; py = 2;                 // on the ledge; the dig finds the list full
    vic_waitFrame();
    timer_start();
    player_update('X');
    unsigned s_play = timer_stop();
    timer_start();
    holes_update();
    unsigned s_hole = timer_stop(), s_guard = 0, t_stress = s_play + s_hole;
    for (char g = 0; g < NG; g++) {
        timer_start();
        guard_update(g);
        unsigned t = timer_stop();
        t_stress += t;
        if (t > s_guard) s_guard = t;
    }
    cs = rol16(cs) ^ digest();
    if (!fault && cs != EXP_STRESS) fault = 4;
    ndirty = 0;                     // the screen keeps the scenario's last tick

    put_dec(SCREEN + 80 + 3, t_stress, 5);
    put_dec(SCREEN + 80 + 12, s_hole, 5);
    put_dec(SCREEN + 80 + 21, s_guard, 5);
    put_dec(SCREEN + 80 + 29, miss, 2);
    put_hex(SCREEN + 120 + 3, cs);
    put_dec(SCREEN + 120 + 12, t_play, 5);
    char code = fault ? CODE_FAIL : CODE_PASS;
    RESULT = code;
    vic.color_border = fault ? VCOL_RED : VCOL_GREEN;
    SCREEN[80 + 34] = 0x30 + code;
    SCREEN[80 + 35] = 0x30 + fault;
    for (;;)
        ;
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=dig-and-guards.prg dig-and-guards.c
```

Oscar64 1.32.271 builds it with no warnings; the PRG is 4,629 bytes.

The checkpoint checksums, the final checksum and the stress checksum
come from this script (Python 3). It keeps the same map and rules as
objects and lists, not the C's arrays, and prints `ticks 168 digs 2
traps 2 escs 1 kills 1 walk 1 alive 1`, the ten checkpoints, `final
0xefbe` and `stress 0x9760`.

```python
# dig_model.py: the reference for dig-and-guards.c. Same map, same rules,
# same order of work per tick, written from the page's rule list, not
# from the C. Prints the checkpoint checksums, the event counts and the
# final positions the listing compiles in.
W, H = 28, 16
E, B, S, L, HO, F = 0, 1, 2, 3, 4, 5
HOLE_T, REFILL_T, T_TRAP, NH, NG = 80, 16, 30, 8, 4
RESPAWN_X = 13
LEVEL = [
    "............................",
    "............................",
    "............................",
    "###########.................",
    "............................",
    "............................",
    "............................",
    "SS#H######################HS",
    "...H......................H.",
    "...H......................H.",
    "...H......................H.",
    "...H......................H.",
    "...H......................H.",
    "...H......................H.",
    "...H......................H.",
    "SSSSSSSSSSSSSSSSSSSSSSSSSSSS",
]
SCRIPT = [("X", 1), ("W", 12), ("R", 16), ("Z", 1), ("W", 82),
          ("R", 2), ("D", 8), ("L", 10), ("W", 36)]
CHECK_EVERY = 16

class G:
    def __init__(s, x, y, on):
        s.x, s.y, s.st, s.cnt, s.on = x, y, 0, 0, on

def blocked(t):
    return t == B or t == S

class World:
    def __init__(s):
        code = {'.': E, '#': B, 'S': S, 'H': L}
        s.m = [[code[c] for c in row] for row in LEVEL]
        s.hx, s.hy, s.ht = [0] * NH, [0] * NH, [0] * NH
        s.g = [G(14, 6, 1), G(0, 0, 0), G(0, 0, 0), G(0, 0, 0)]
        s.px, s.py, s.alive = 8, 6, 1
        s.digs = s.traps = s.escs = s.kills = s.walk = 0

    def guard_at(s, x, y):
        for i, g in enumerate(s.g):
            if g.on and g.x == x and g.y == y:
                return i
        return -1

    def trapped_at(s, x, y):
        i = s.guard_at(x, y)
        return i >= 0 and s.g[i].st == 1

    def supported(s, x, y):
        if s.m[y][x] == L:
            return True
        b = s.m[y + 1][x]
        if b in (B, S, L):
            return True
        return b in (HO, F) and s.trapped_at(x, y + 1)

    def dig(s, dx):
        tx, ty = s.px + dx, s.py + 1
        if tx < 0 or tx >= W:
            return
        if s.m[ty][tx] != B or s.m[s.py][tx] != E or s.guard_at(tx, s.py) >= 0:
            return
        for i in range(NH):
            if s.ht[i] == 0:
                s.hx[i], s.hy[i], s.ht[i] = tx, ty, HOLE_T
                s.m[ty][tx] = HO
                s.digs += 1
                return

    def player(s, a):
        x, y = s.px, s.py
        if not s.supported(x, y):
            s.py += 1
        elif a == 'L' and x > 0 and not blocked(s.m[y][x - 1]):
            s.px -= 1
        elif a == 'R' and x < W - 1 and not blocked(s.m[y][x + 1]):
            s.px += 1
        elif a == 'U' and s.m[y][x] == L and not blocked(s.m[y - 1][x]):
            s.py -= 1
        elif a == 'D' and not blocked(s.m[y + 1][x]) and s.guard_at(x, y + 1) < 0:
            s.py += 1
        elif a == 'Z':
            s.dig(-1)
        elif a == 'X':
            s.dig(1)
        b = s.m[s.py + 1][s.px]
        if b in (HO, F) and s.trapped_at(s.px, s.py + 1):
            s.walk += 1

    def holes(s):
        for i in range(NH):
            if s.ht[i] == 0:
                continue
            s.ht[i] -= 1
            x, y = s.hx[i], s.hy[i]
            if s.ht[i] == REFILL_T:
                s.m[y][x] = F
            elif s.ht[i] == 0:
                s.m[y][x] = B
                for g in s.g:
                    if g.on and g.x == x and g.y == y:
                        g.x, g.y, g.st, g.cnt = RESPAWN_X, 0, 0, 0
                        s.kills += 1
                if s.px == x and s.py == y:
                    s.alive = 0

    def decide(s, g):
        x, y, m = g.x, g.y, s.m
        if y == s.py and x != s.px:
            d = 1 if s.px > x else -1
            c = x
            while True:
                c += d
                if blocked(m[y][c]) or not s.supported(c, y):
                    break
                if c == s.px:
                    return d, 0
        if s.py < y and m[y][x] == L and not blocked(m[y - 1][x]):
            return 0, -1
        if s.py > y and m[y + 1][x] in (L, E):
            return 0, 1
        if s.py != y:
            open_l = open_r = True
            for dist in range(1, W):
                for d in (-1, 1):
                    if (open_l if d < 0 else open_r) is False:
                        continue
                    c = x + d * dist
                    if c < 0 or c >= W or blocked(m[y][c]):
                        if d < 0: open_l = False
                        else: open_r = False
                        continue
                    if s.py < y and m[y][c] == L and not blocked(m[y - 1][c]):
                        return d, 0
                    if s.py > y and m[y + 1][c] in (L, E):
                        return d, 0
                    if not s.supported(c, y):
                        if d < 0: open_l = False
                        else: open_r = False
        if s.px != x:
            return (1 if s.px > x else -1), 0
        return 0, 0

    def step(s, g, dx, dy):
        nx, ny = g.x + dx, g.y + dy
        if nx < 0 or nx >= W or blocked(s.m[ny][nx]) or s.guard_at(nx, ny) >= 0:
            return False
        g.x, g.y = nx, ny
        return True

    def guard(s, g):
        if not g.on:
            return
        if g.st == 1:
            g.cnt -= 1
            if g.cnt == 0:
                if s.step(g, 0, -1):
                    g.st = 2
                    s.escs += 1
                else:
                    g.cnt = 1
        elif g.st == 2:
            d = 1 if s.px >= g.x else -1
            if not s.step(g, d, 0):
                s.step(g, -d, 0)
            g.st = 0
        elif not s.supported(g.x, g.y):
            g.y += 1
            if s.m[g.y][g.x] in (HO, F):
                g.st, g.cnt = 1, T_TRAP
                s.traps += 1
        else:
            dx, dy = s.decide(g)
            if dx or dy:
                s.step(g, dx, dy)
        if g.x == s.px and g.y == s.py:
            s.alive = 0

    def digest(s):
        v = sum(sum(r) for r in s.m)
        for g in s.g:
            v += g.x + g.y * 32 + g.st * 1024 + g.cnt + g.on * 4096
        v += s.px + s.py * 32 + s.alive * 1024
        return v & 0xffff

def rol(c):
    return ((c << 1) | (c >> 15)) & 0xffff

def run():
    w, cs, tick, checks = World(), 0, 0, []
    for a, n in SCRIPT:
        for _ in range(n):
            w.player(a)
            w.holes()
            if tick & 1 == 0:
                for g in w.g:
                    w.guard(g)
            cs = rol(cs) ^ w.digest()
            tick += 1
            if tick % CHECK_EVERY == 0:
                checks.append(cs)
    return w, cs, tick, checks

def stress(w, cs):
    # Worst frame: four free guards on row 6 each scan the whole row (the
    # player is above and no column offers a climb); eight live holes on
    # the ledge, off the guards' row, one expiring and one turning to the
    # refill glyph; the player, on the ledge, tries a dig with the list full.
    for i, t in enumerate((1, 17, 30, 40, 50, 60, 70, 79)):
        x, y = 3 + i, 3
        w.m[y][x] = F if t <= REFILL_T else HO
        w.hx[i], w.hy[i], w.ht[i] = x, y, t
    for i, gx in enumerate((7, 12, 17, 22)):
        g = w.g[i]
        g.on, g.x, g.y, g.st, g.cnt = 1, gx, 6, 0, 0
    w.px, w.py = 1, 2
    w.player('X')
    w.holes()
    for g in w.g:
        w.guard(g)
    return rol(cs) ^ w.digest()

if __name__ == "__main__":
    w, cs, tick, checks = run()
    print("ticks", tick, "digs", w.digs, "traps", w.traps, "escs", w.escs,
          "kills", w.kills, "walk", w.walk, "alive", w.alive)
    print("player", w.px, w.py, "guard", w.g[0].x, w.g[0].y, w.g[0].st)
    print("checks", ", ".join("0x%04x" % c for c in checks))
    print("final 0x%04x" % cs)
    print("stress 0x%04x" % stress(w, cs))
```

## Expected output

Black background, green border. Rows 0 to 3 are the HUD. Below them the
level: an eleven-cell red brick ledge at the top left (used only by the
stress tick), a red brick floor with grey solid ends, two yellow `H`
ladders at map columns 3 and 26, and a grey solid bottom. The player, a
cyan heart, stands on the bottom row at map column 16; the guard, a white
ball, is on the same row at column 9, walking toward it. Both holes have
refilled, so the brick floor is whole again. The stress tick is not
drawn.

HUD at 16,000,000 cycles (measured in VICE x64sc 3.10, decoded against
the character ROM with PIL):

| Row | PAL | NTSC |
|---|---|---|
| 0 | `T 168 DIG 2 TRAP2 ESC 1 KILL1 WALK001` | same |
| 1 | `HOLES 00366 GUARD 03516 TICK 04075` | `HOLES 00366 GUARD 03559 TICK 04118` |
| 2 | `ST 19759 SH 00659 SG 04780 M 00 R 10` | `ST 19716 SH 00659 SG 04761 M 00 R 10` |
| 3 | `CS 9760  PL 00505` | same |

Row 0: 168 ticks, two digs, two traps, one escape, one kill, one tick
with the player held up by a trapped guard. Row 1, worst over the
scenario in CIA1 cycles: the hole-list update, one guard's update, and a
whole tick (player, holes and every guard). Row 2: the stress tick
(`ST`), its hole-list update (`SH`) and its slowest guard (`SG`), then
checkpoint misses (`M 00`) and the result, code 1 and fault 0. Row 3:
the final checksum, equal to the model's stress value `0x9760`, and the
worst player update (`PL`, a dig). The border is (98, 213, 50) on PAL
and (114, 189, 103) on NTSC.

A copy of the listing with one checkpoint constant changed by one bit
printed `M 01 R 21` and a red border (175, 60, 88) on PAL, so the
comparison can fail.

The two models differ only where the timed work reaches the visible
screen. `vic_waitFrame()` returns when the raster reaches line 256, so
the work starts in the vertical blank: about 104 lines, 6,552 cycles,
before the first badline on PAL and about 55 lines, 3,575 cycles, on
NTSC (arithmetic from 63 and 65 cycles a line; rung 3). The 4,075-cycle
tick fits the PAL gap and not the NTSC one. The stress tick is longer
than a whole frame on both models, so each run crosses every badline
once and the two figures end up 43 cycles apart; the CIA counts the
stolen cycles.

Screenshots at 16,000,000 cycles, both after the verdict and each
identical over two runs: `screenshots/dig-and-guards.png` (PAL) and
`screenshots/dig-and-guards-ntsc.png` (NTSC). Measured on both with PIL:
every one of the 448 map cells matches the model's last tick, glyph from
the character ROM and ink from the palette, with 0 wrong pixels. The
script:

```python
# Every map cell on the exit screenshot against the model's last tick:
# glyph from the character ROM, ink colour from the palette per model.
from PIL import Image
import dig_model
ROM = open('/opt/homebrew/opt/vice/share/vice/C64/chargen-901225-01.bin', 'rb').read()[:2048]
PAL = {0: (0, 0, 0), 1: (255, 255, 255), 2: (175, 60, 88), 3: (126, 243, 214),
       4: (170, 64, 245), 7: (255, 255, 70), 8: (183, 99, 30), 15: (205, 205, 205)}
NTSC = {0: (0, 0, 0), 1: (255, 255, 255), 2: (169, 71, 100), 3: (138, 230, 203),
        4: (154, 88, 185), 7: (255, 248, 141), 8: (196, 98, 65), 15: (205, 205, 205)}
GLYPH = {0: 0x20, 1: 0x66, 2: 0xa0, 3: 0x08, 4: 0x20, 5: 0x62}
INK = {0: 0, 1: 2, 2: 15, 3: 7, 4: 0, 5: 8}
def check(png, ntsc):
    px = Image.open(png).convert('RGB').load()
    top, pal = (23, NTSC) if ntsc else (35, PAL)
    w, cs, tick, _ = dig_model.run()
    exp = {}
    for y in range(16):
        for x in range(28):
            t = w.m[y][x]
            exp[(x, y)] = (GLYPH[t], INK[t])
    exp[(w.px, w.py)] = (0x53, 3)
    for g in w.g:
        if g.on:
            exp[(g.x, g.y)] = (0x51, 4 if g.st == 1 else 1)
    bad = 0
    for (x, y), (ch, ink) in exp.items():
        X, Y = 32 + 8 * (6 + x), top + 8 * (5 + y)
        want = ROM[(ch & 0x7f) * 8:(ch & 0x7f) * 8 + 8]
        for j in range(8):
            for i in range(8):
                on = (want[j] >> (7 - i)) & 1
                if ch & 0x80: on ^= 1
                c = px[X + i, Y + j]
                if c != (pal[ink] if on else (0, 0, 0)):
                    bad += 1
    return bad, len(exp)
for png, n in (('dig-and-guards.png', 0), ('dig-and-guards-ntsc.png', 1)):
    print(png, 'wrong pixels %d over %d cells' % check(png, n))
```

## Why this works

The hole list is the whole refill mechanism. A dig writes the hole into
the map and puts its cell and a timer into a free slot of eight; one
loop per tick counts every live slot down, swaps the glyph at 16 and
writes brick back at 0. At 0 it asks which actor stands in the cell: a
guard there is killed and moved to the top row, the player there dies.
Nothing else in the program tracks holes, so the map cell and the slot
can never disagree. The player digs at most once a tick and every hole
lives 80 ticks, so at most one slot expires and one turns to the refill
glyph in any tick. Eight live slots with one of each cost 659 cycles in
the stress tick; two live holes cost at most 366 in the scenario.

Standing is one function for everyone. `supported()` says an actor at a
cell is held up when the cell is a ladder, when the cell below is
brick, solid or ladder, or when the cell below is a hole holding a
trapped guard. The last clause is the walk-over rule, and it also keeps
a second guard from falling into an occupied hole. A guard that is not
held up falls one cell a guard tick; landing in a hole traps it for 30
guard ticks, after which it climbs one cell and steps sideways on the
next guard tick without the fall test, so it does not drop straight
back in.

The guard's rule is greedy and costs a row scan at most. On the player's
row it walks straight at the player if every cell between can be stood
on. On a ladder with the player above it climbs; with a ladder or empty
cell below and the player below it descends. Otherwise it scans its row
outward, left before right at each distance, for the nearest column
that offers a move toward the player's row, and stops a side at a wall,
a map edge or a cell it would fall from. Failing all of that it steps
toward the player's column. The stress tick puts four free guards on a
row with no such column and the player above, so each scans all 27
other columns: 4,780 cycles for the slowest on PAL, about 165 cycles a
probe (arithmetic over 29 probes). That is the cost of an Oscar64 `-O2`
function call per cell, not of the rule. With eight live holes and the
failed dig, the tick takes 19,759 cycles on PAL and 19,716 on NTSC:
101% of a PAL frame (19,656 cycles) and 115% of an NTSC one (17,095).
Four guards scanning full rows overrun a frame in this C. A copy of the
listing with the fourth guard switched off took 15,085 cycles on PAL
(77%) and 15,299 on NTSC (89%), so three fit. More guards need their
decisions staggered over frames; the technique page lists that and
other ways to bound the scan.
