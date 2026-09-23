---
recipe: destructible-terrain
toolchain: oscar64
output_format: PRG
region: both
techniques: [destructible_char_terrain, creature_state_machine]
file_formats: [PRG]
uses_registers: [D011, D012, D016, D018, D020, D021, D022, D023, DC06, DC07, DC0F, DD06, DD07, DD0F]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 destructible terrain: 24 creatures dig, build and block in character terrain with private glyphs, checked against a Python model

## Synopsis

A 40 by 16 cell level in multicolour characters, 160 by 128 pixels.
Almost every cell shows one of three shared glyphs: empty, earth, or a
2-pixel step. When a creature digs or builds, the edited cell gets a
private glyph from a pool of 128 codes ($80 to $FF), copied from its
shared glyph and then changed pixel by pixel. A private glyph that
becomes equal to a shared glyph again goes back to the pool. 24
creatures drop from a hatch, one every 8 ticks, and run a state machine
(walk, fall, dig, build, block, dead) on single-pixel probes of the
glyph bytes. Four roles are given at fixed ticks: a blocker, two
diggers side by side and a builder. After 360 ticks the program folds
the level's glyph bitmap and every creature's position, state and
direction into Fletcher-16 checksums and compares them, the pool counts
and the death count with values from a Python model of the same rules,
compiled in. Then five worst-frame subjects run from a snapshot: the
terrain edits of 24 dig steps alone, the same edits timed one dig step
at a time, a whole tick with all 24 creatures on a dig step, one with
all 24 laying a brick, and the updates alone of all 24 walking into a
2-pixel wall and climbing it. Each is checked against the model too. The snapshot is put back and the screen
shows the scenario. `PASS`, a green border and 01 in `$02FF`; `FAIL`,
red and 02. The techniques are `destructible_char_terrain` in
`techniques/text-mode-render.md` and `creature_state_machine` in
`techniques/logic.md`.

## Source

```c
// destructible-terrain.c -- terrain drawn in multicolour characters that
// creatures dig and build into, pixel by pixel. Most cells use one of
// three shared glyphs; an edited cell gets a private glyph from a pool of
// 128 codes ($80-$FF) and gives it back when it matches a shared glyph
// again. 24 creatures run a small state machine (walk, fall, dig, build,
// block, dead) on per-pixel probes of the glyph bytes, and are drawn as
// merged glyphs (save the code under, copy its glyph, OR the body in).
// Roles are given at fixed ticks. After 360 ticks the terrain pixels and
// the creature states are checked against a Python model, then five
// worst-frame subjects run from a snapshot and are timed and checked.
// $02FF = 01 and a green border on pass, 02 and red on fail.
// Build: oscar64 -tm=c64 -O2 -o=destructible-terrain.prg destructible-terrain.c
#include <c64/vic.h>
#include <c64/cia.h>
#include <c64/memmap.h>
#include <string.h>

// The charset is at $3800-$3FFF; code and data go above it.
#pragma region( main, 0x4000, 0xa000, , , {code, data, bss, heap, stack} )

#define SCREEN   ((char *)0x0400)
#define COLOUR   ((char *)0xd800)
#define CHAR_ROM ((char *)0xd000)
#define FONT     ((char *)0x3800)     // $D018 = $1E: screen $0400, chars $3800
#define RESULT   (*(volatile char *)0x02ff)

#define LW       40                   // level: 40 x 16 cells at screen rows 9-24
#define LH       16
#define LY0      9
#define PW       160                  // 160 x 128 multicolour pixels
#define PH       128

#define G_EMPTY  0x40                 // shared glyphs
#define G_EARTH  0x41
#define G_STEP2  0x42
#define CR_BASE  0x50                 // creature glyphs $50-$7F, two each
#define POOL0    0x80                 // private terrain glyphs $80-$FF
#define POOLN    128

#define NC       24                   // creatures
#define HX       22                   // hatch: feet at (22, 12)
#define HY       12
#define REL      8                    // one released every 8 ticks
#define FATAL    32                   // a fall longer than this kills
#define BRICKS   12
#define TICKS    360

enum { WALK, FALL, DIG, BUILD, BLOCK, DEAD };

// From terrain_model.py (see Build).
#define EXP_TERRAIN   0xcb64
#define EXP_CREATURES 0x92cb
#define EXP_USED      7
#define EXP_PEAK      7
#define EXP_FREED     2
#define EXP_DEAD      5
#define EXP_S_TERRAIN   0x627f
#define EXP_S_CREATURES 0x2a72
#define EXP_S_USED      43
#define EXP_B_TERRAIN   0xaa64
#define EXP_B_CREATURES 0x2a72
#define EXP_B_USED      43
#define EXP_W_TERRAIN   0x7d97
#define EXP_W_CREATURES 0x0012
#define EXP_W_USED      31

static const char level[LH][LW + 1] = {
    "........................................",
    "........................................",
    "........................................",
    "........................................",
    "#...........s...........................",
    "#######################.................",
    "#######################.................",
    "#.......................................",
    "#...............................########",
    "###############################.........",
    "#......................................#",
    "#......................................#",
    "#......................................#",
    "#......................................#",
    "#......................................#",
    "########################################",
};

static const char earth_rows[8] = { 0x56, 0x65, 0x59, 0x95, 0x56, 0x65, 0x59, 0x95 };
static const char step2_rows[8] = { 0, 0, 0, 0, 0, 0, 0xaa, 0xaa };
static const char pmask[4] = { 0xc0, 0x30, 0x0c, 0x03 };   // pixel x & 3

static char * rowp[LH];               // level row start in screen RAM

// Creatures.
static char cx[NC], cy[NC], cst[NC], cfall[NC], ct[NC], cbr[NC];
static signed char cdir[NC];
static char ncr;                      // released so far
static char under[2 * NC];            // screen code under each drawn cell
static char * ucell[2 * NC];          // and where it was
static char ncell[NC];                // cells drawn: 0, 1 or 2

// Private glyph pool: a stack of free codes.
static char freel[POOLN], nfree, used, peak, freed;
static unsigned refused;

static char blk_x[4], blk_y[4], nblk;

// Scripted roles: tick, creature, role.
static const unsigned sc_tick[4] = { 70, 120, 157, 246 };
static const char sc_who[4] = { 0, 3, 8, 4 };
static const char sc_role[4] = { BLOCK, DIG, DIG, BUILD };
static char ignored;

static unsigned tmax[4];              // worst single update per state
static unsigned t_tick, t_erase, t_draw, max_tick, max_erase, max_draw;

static void timer_start(void)
{
    cia1.crb = 0x00;
    cia1.tb  = 0xffff;
    cia1.crb = 0x11;                  // force load, start, count phi2
}

static unsigned timer_stop(void)
{
    cia1.crb = 0x00;
    return 0xffff - cia1.tb;
}

static void put_str(char * dst, const char * s)
{
    while (*s) {
        char c = *s++;
        if (c >= 'A' && c <= 'Z') c -= 64;   // ASCII letter to screen code
        *dst++ = c;
    }
}

static void put_dec(char * dst, unsigned v, char n)
{
    for (char i = n; i > 0; i--) {
        dst[i - 1] = '0' + (char)(v % 10);
        v /= 10;
    }
}

static void put_hex(char * dst, unsigned v)
{
    for (char i = 4; i > 0; i--) {
        char d = v & 15;
        dst[i - 1] = d < 10 ? '0' + d : d - 9;
        v >>= 4;
    }
}

// Is the pixel at (x, y) terrain? Outside the level counts as solid;
// x - 1 at 0 and y - 1 at 0 wrap to 255 and land here too.
static inline char solid(char x, char y)
{
    if (x >= PW || y >= PH) return 1;
    char code = rowp[y >> 3][x >> 2];
    return FONT[(unsigned)code * 8 + (y & 7)] & pmask[x & 3];
}

// Timing subjects for the probe. Written inline as a loop storing to a
// local volatile, it left the timer window empty in the -O2 listing;
// these write a global and are kept out of line.
static char probe_out[PW];
__noinline void probe_row(char y)
{
    for (char x = 0; x < PW; x++) probe_out[x] = solid(x, y);
}

__noinline void empty_row(char y)
{
    for (char x = 0; x < PW; x++) probe_out[x] = x + y;
}

static bool same8(const char * a, const char * b)
{
    for (char i = 0; i < 8; i++)
        if (a[i] != b[i]) return false;
    return true;
}

// Set the pixel at (x, y) to pair v (0 = empty, 2 = brick). A shared
// cell first gets a private copy of its glyph; a private glyph that ends
// up equal to a shared one is given back.
static void setpix(char x, char y, char v)
{
    if (x >= PW || y >= PH) return;
    char * cell = rowp[y >> 3] + (x >> 2);
    char code = *cell;
    char m = pmask[x & 3];
    char want = v ? (0xaa & m) : 0;
    char * g = FONT + (unsigned)code * 8;
    char r = y & 7;
    if ((g[r] & m) == want) return;
    if (code < POOL0) {
        if (nfree == 0) { refused++; return; }
        char p = freel[--nfree];
        char * n = FONT + (unsigned)p * 8;
        n[0] = g[0]; n[1] = g[1]; n[2] = g[2]; n[3] = g[3];
        n[4] = g[4]; n[5] = g[5]; n[6] = g[6]; n[7] = g[7];
        *cell = p; code = p; g = n;
        used++;
        if (used > peak) peak = used;
    }
    g[r] = (g[r] & ~m) | want;
    for (char s = G_EMPTY; s <= G_STEP2; s++) {
        if (same8(g, FONT + (unsigned)s * 8)) {
            *cell = s;
            freel[nfree++] = code;
            used--;
            freed++;
            return;
        }
    }
}

static bool blocked(char nx, char y)
{
    for (char k = 0; k < nblk; k++) {
        char d = blk_y[k] > y ? blk_y[k] - y : y - blk_y[k];
        if (blk_x[k] == nx && d < 4) return true;
    }
    return false;
}

static void update(char i)
{
    char x = cx[i], y = cy[i];
    switch (cst[i]) {
    case WALK: {
        char nx = x + cdir[i];
        if (nx >= PW || blocked(nx, y)) { cdir[i] = -cdir[i]; return; }
        char ny = y;
        if (solid(nx, ny)) {
            if (!solid(nx, ny - 1)) ny--;
            else if (!solid(nx, ny - 2)) ny -= 2;
            else { cdir[i] = -cdir[i]; return; }
        }
        cx[i] = nx; cy[i] = ny;
        if (!solid(nx, ny + 1)) { cst[i] = FALL; cfall[i] = 0; }
        break;
    }
    case FALL:
        if (solid(x, y + 1)) cst[i] = cfall[i] > FATAL ? DEAD : WALK;
        else if (y + 1 >= PH - 1) cst[i] = DEAD;
        else { cy[i] = y + 1; cfall[i]++; }
        break;
    case DIG:
        if (++ct[i] < 2) return;
        ct[i] = 0;
        if (!(solid(x - 1, y + 1) || solid(x, y + 1) || solid(x + 1, y + 1))) {
            cst[i] = FALL; cfall[i] = 0; return;
        }
        setpix(x - 1, y + 1, 0);
        setpix(x, y + 1, 0);
        setpix(x + 1, y + 1, 0);
        cy[i] = y + 1;
        break;
    case BUILD: {
        if (++ct[i] < 4) return;
        ct[i] = 0;
        char d = cdir[i];
        if (cbr[i] == 0 || solid(x + d, y - 1)) { cst[i] = WALK; return; }
        setpix(x + d, y, 2);
        setpix(x + 2 * d, y, 2);
        cx[i] = x + d; cy[i] = y - 1;
        cbr[i]--;
        break;
    }
    default:                          // BLOCK and DEAD do nothing
        break;
    }
}

// Merge one cell of creature i's body: rows y0..y1 (same cell) at x.
static inline void draw_cell(char k, char x, char y0, char y1)
{
    char * cell = rowp[y0 >> 3] + (x >> 2);
    char u = *cell;
    under[k] = u;
    ucell[k] = cell;
    const char * s = FONT + (unsigned)u * 8;
    char * d = FONT + (unsigned)(CR_BASE + k) * 8;
    d[0] = s[0]; d[1] = s[1]; d[2] = s[2]; d[3] = s[3];
    d[4] = s[4]; d[5] = s[5]; d[6] = s[6]; d[7] = s[7];
    char m = pmask[x & 3];
    for (char r = y0 & 7; r <= (y1 & 7); r++) d[r] |= m;   // pair 11: colour RAM
    *cell = CR_BASE + k;
}

static void draw_all(void)
{
    for (char i = 0; i < ncr; i++) {
        if (cst[i] == DEAD) { ncell[i] = 0; continue; }
        char x = cx[i], y = cy[i], top = y - 3;
        if ((top >> 3) == (y >> 3)) {
            draw_cell(2 * i, x, top, y);
            ncell[i] = 1;
        } else {
            draw_cell(2 * i, x, top, top | 7);
            draw_cell(2 * i + 1, x, y & 0xf8, y);
            ncell[i] = 2;
        }
    }
}

// Restore in reverse draw order, so stacked creatures unwind.
static void erase_all(void)
{
    char i = ncr;
    while (i) {
        i--;
        if (ncell[i] == 2) *ucell[2 * i + 1] = under[2 * i + 1];
        if (ncell[i]) *ucell[2 * i] = under[2 * i];
    }
}

static void tick(unsigned t)
{
    if ((t & (REL - 1)) == 0 && ncr < NC) {
        char i = ncr++;
        cx[i] = HX; cy[i] = HY; cdir[i] = 1; cst[i] = FALL;
        cfall[i] = 0; ct[i] = 0; cbr[i] = 0; ncell[i] = 0;
    }
    for (char k = 0; k < 4; k++) {
        if (sc_tick[k] == t) {
            char i = sc_who[k];
            if (i < ncr && cst[i] == WALK) {
                cst[i] = sc_role[k]; ct[i] = 0;
                if (sc_role[k] == BUILD) cbr[i] = BRICKS;
                if (sc_role[k] == BLOCK) { blk_x[nblk] = cx[i]; blk_y[nblk] = cy[i]; nblk++; }
            } else ignored++;
        }
    }
    for (char i = 0; i < ncr; i++) {
        char s = cst[i];
        timer_start();
        update(i);
        unsigned c = timer_stop();
        if (s < BLOCK && c > tmax[s]) tmax[s] = c;
    }
}

static char fa, fb;                   // Fletcher-16 sums
static void fl_add(char v)
{
    unsigned a = fa + v;
    if (a >= 255) a -= 255;
    fa = a;
    unsigned b = fb + fa;
    if (b >= 255) b -= 255;
    fb = b;
}

static unsigned terrain_cs(void)
{
    fa = fb = 0;
    for (char r = 0; r < LH; r++)
        for (char c = 0; c < LW; c++) {
            const char * g = FONT + (unsigned)rowp[r][c] * 8;
            for (char k = 0; k < 8; k++) fl_add(g[k]);
        }
    return (unsigned)fb << 8 | fa;
}

static unsigned creature_cs(void)
{
    fa = fb = 0;
    for (char i = 0; i < ncr; i++) {
        fl_add(cx[i]); fl_add(cy[i]); fl_add(cst[i]); fl_add((char)cdir[i]);
    }
    return (unsigned)fb << 8 | fa;
}

// Snapshot for the stress tick, so the screen shows the scenario after it.
static char save_scr[LH * LW], save_pool[POOLN * 8];
static char save_x[NC], save_y[NC], save_st[NC], save_nf, save_used;
static char save_free[POOLN];

static void snapshot(void)
{
    for (char r = 0; r < LH; r++) memcpy(save_scr + r * LW, rowp[r], LW);
    memcpy(save_pool, FONT + POOL0 * 8, POOLN * 8);
    memcpy(save_free, freel, POOLN);
    memcpy(save_x, cx, NC); memcpy(save_y, cy, NC); memcpy(save_st, cst, NC);
    save_nf = nfree; save_used = used;
}

static void restore(void)
{
    for (char r = 0; r < LH; r++) memcpy(rowp[r], save_scr + r * LW, LW);
    memcpy(FONT + POOL0 * 8, save_pool, POOLN * 8);
    memcpy(freel, save_free, POOLN);
    memcpy(cx, save_x, NC); memcpy(cy, save_y, NC); memcpy(cst, save_st, NC);
    nfree = save_nf; used = save_used;
}

static unsigned s_tick, s_erase, s_upd, s_draw;

// One whole tick with every creature about to act in state st.
static void stress(char st)
{
    for (char i = 0; i < NC; i++) {
        cx[i] = 4 + 6 * i; cy[i] = 119; cdir[i] = 1; cst[i] = st;
        ct[i] = st == DIG ? 1 : 3; cfall[i] = 0; cbr[i] = BRICKS;
    }
    draw_all();
    vic_waitFrame();
    cia2.crb = 0x00;
    cia2.tb  = 0xffff;
    cia2.crb = 0x11;
    timer_start();
    erase_all();
    s_erase = timer_stop();
    timer_start();
    for (char i = 0; i < NC; i++) update(i);
    s_upd = timer_stop();
    timer_start();
    draw_all();
    s_draw = timer_stop();
    cia2.crb = 0x00;
    s_tick = 0xffff - cia2.tb;
    erase_all();
}

// The creatures' own logic at its worst: every creature walks into a
// 2-pixel brick wall and climbs it (four probes and a blocker check).
// The bricks are laid before the timer starts; only the updates are timed.
static unsigned w_upd;
static void stress_walk(void)
{
    for (char i = 0; i < NC; i++) {
        cx[i] = 4 + 6 * i; cy[i] = 119; cdir[i] = 1; cst[i] = WALK;
        ct[i] = 0; cfall[i] = 0;
    }
    for (char i = 0; i < NC; i++) {
        setpix(5 + 6 * i, 119, 2); setpix(5 + 6 * i, 118, 2);
    }
    vic_waitFrame();
    timer_start();
    for (char i = 0; i < NC; i++) update(i);
    w_upd = timer_stop();
}

int main(void)
{
    __asm { sei }

    mmap_set(MMAP_CHAR_ROM);
    memcpy(FONT, CHAR_ROM, 512);      // codes $00-$3F for the HUD
    mmap_set(MMAP_ROM);
    memset(FONT + G_EMPTY * 8, 0, 8);
    memcpy(FONT + G_EARTH * 8, earth_rows, 8);
    memcpy(FONT + G_STEP2 * 8, step2_rows, 8);
    for (char i = 0; i < POOLN; i++) freel[i] = 0xff - i;
    nfree = POOLN;

    memset(SCREEN, 0x20, 1000);
    memset(COLOUR, VCOL_WHITE, 1000);
    for (char r = 0; r < LH; r++) {
        char * p = SCREEN + 40 * (LY0 + r);
        rowp[r] = p;
        for (char c = 0; c < LW; c++) {
            char ch = level[r][c];
            p[c] = ch == '#' ? G_EARTH : ch == 's' ? G_STEP2 : G_EMPTY;
            p[c + 0xd400] = 8 | VCOL_WHITE;   // multicolour cell, pair 11 white
        }
    }
    vic.color_back = VCOL_BLACK;
    vic.color_back1 = VCOL_BROWN;     // pair 01
    vic.color_back2 = VCOL_ORANGE;    // pair 10: earth texture and bricks
    vic.color_border = VCOL_BLACK;
    vic.ctrl2 |= 0x10;                // multicolour text
    vic.memptr = 0x1e;

    // Probes: 160 along one pixel row, and the same loop with no probe,
    // timed with the display off so no badline steals cycles.
    vic.ctrl1 &= ~0x10;
    vic_waitFrame(); vic_waitFrame();
    timer_start();
    probe_row(40);
    unsigned t_probe = timer_stop();
    timer_start();
    empty_row(40);
    unsigned t_empty = timer_stop();
    vic.ctrl1 |= 0x10;

    for (unsigned t = 0; t < TICKS; t++) {
        vic_waitFrame();
        cia2.crb = 0x00;              // whole tick, CIA2 timer B
        cia2.tb  = 0xffff;
        cia2.crb = 0x11;
        timer_start();
        erase_all();
        t_erase = timer_stop();
        tick(t);
        timer_start();
        draw_all();
        t_draw = timer_stop();
        cia2.crb = 0x00;
        t_tick = 0xffff - cia2.tb;
        if (t_tick > max_tick) max_tick = t_tick;
        if (t_erase > max_erase) max_erase = t_erase;
        if (t_draw > max_draw) max_draw = t_draw;
    }

    erase_all();
    unsigned tcs = terrain_cs(), ccs = creature_cs();
    char dead = 0;
    for (char i = 0; i < ncr; i++) if (cst[i] == DEAD) dead++;
    char fault = 0;
    if (tcs != EXP_TERRAIN) fault |= 1;
    if (ccs != EXP_CREATURES) fault |= 2;
    if (used != EXP_USED || peak != EXP_PEAK || freed != EXP_FREED) fault |= 4;
    char was_freed = freed;
    if (dead != EXP_DEAD || ignored || refused) fault |= 8;

    // Worst frames, each from a snapshot of the scenario: the terrain
    // edits of 24 dig steps alone, then a whole tick with every creature
    // on a dig step, then one with every creature laying a brick, then
    // the updates alone of every creature climbing a 2-pixel wall. Each
    // creature stands on the floor in its own column on shared earth.
    snapshot();
    char was_peak = peak;
    timer_start();
    for (char i = 0; i < NC; i++) {
        char x = 4 + 6 * i;
        setpix(x - 1, 120, 0); setpix(x, 120, 0); setpix(x + 1, 120, 0);
    }
    unsigned s_edit = timer_stop();
    if (terrain_cs() != EXP_S_TERRAIN || used != EXP_S_USED) fault |= 16;
    restore();
    unsigned s_step = 0;              // the same edits, one dig step at a time
    for (char i = 0; i < NC; i++) {
        char x = 4 + 6 * i;
        timer_start();
        setpix(x - 1, 120, 0); setpix(x, 120, 0); setpix(x + 1, 120, 0);
        unsigned c = timer_stop();
        if (c > s_step) s_step = c;
    }
    if (terrain_cs() != EXP_S_TERRAIN || used != EXP_S_USED) fault |= 16;
    restore();
    stress(DIG);
    if (terrain_cs() != EXP_S_TERRAIN || creature_cs() != EXP_S_CREATURES
        || used != EXP_S_USED) fault |= 16;
    unsigned d_tick = s_tick, d_erase = s_erase, d_upd = s_upd, d_draw = s_draw;
    char d_used = used;
    unsigned d_cs = terrain_cs();
    restore();
    stress(BUILD);
    if (terrain_cs() != EXP_B_TERRAIN || creature_cs() != EXP_B_CREATURES
        || used != EXP_B_USED) fault |= 32;
    char b_used = used;
    restore();
    stress_walk();
    if (terrain_cs() != EXP_W_TERRAIN || creature_cs() != EXP_W_CREATURES
        || used != EXP_W_USED) fault |= 64;
    restore();
    draw_all();                       // the scenario, as the model left it

    put_str(SCREEN,       "TICK 00000 PASS  POOL 000 PEAK 000");
    put_str(SCREEN + 40,  "ALIVE 00 DEAD 00 REFUSED 000 CODE 00");
    put_str(SCREEN + 80,  "TERRAIN 0000 CREATURES 0000 FREED 000");
    put_str(SCREEN + 120, "WALK 00000 FALL 00000 PROBE 00000");
    put_str(SCREEN + 160, "DIG  00000 BUILD 00000 EMPTY 00000");
    put_str(SCREEN + 200, "TICK MAX 00000 ERASE 00000 DRAW 00000");
    put_str(SCREEN + 240, "DIGS 00000 E 00000 U 00000 D 00000");
    put_str(SCREEN + 280, "BRICKS 00000 U 00000 EDIT 00000 W 00000");
    put_str(SCREEN + 320, "POOL D 000 B 000 TERRAIN 0000 STEP 00000");
    put_dec(SCREEN + 5, TICKS, 5);
    if (fault) put_str(SCREEN + 11, "FAIL");
    put_dec(SCREEN + 22, used, 3);
    put_dec(SCREEN + 31, was_peak, 3);
    put_dec(SCREEN + 46, NC - dead, 2);
    put_dec(SCREEN + 54, dead, 2);
    put_dec(SCREEN + 65, refused, 3);
    put_dec(SCREEN + 74, fault, 2);
    put_hex(SCREEN + 88, tcs);
    put_hex(SCREEN + 103, ccs);
    put_dec(SCREEN + 114, was_freed, 3);
    put_dec(SCREEN + 125, tmax[WALK], 5);
    put_dec(SCREEN + 136, tmax[FALL], 5);
    put_dec(SCREEN + 148, t_probe, 5);
    put_dec(SCREEN + 165, tmax[DIG], 5);
    put_dec(SCREEN + 177, tmax[BUILD], 5);
    put_dec(SCREEN + 189, t_empty, 5);
    put_dec(SCREEN + 209, max_tick, 5);
    put_dec(SCREEN + 221, max_erase, 5);
    put_dec(SCREEN + 232, max_draw, 5);
    put_dec(SCREEN + 245, d_tick, 5);
    put_dec(SCREEN + 253, d_erase, 5);
    put_dec(SCREEN + 261, d_upd, 5);
    put_dec(SCREEN + 269, d_draw, 5);
    put_dec(SCREEN + 287, s_tick, 5);
    put_dec(SCREEN + 295, s_upd, 5);
    put_dec(SCREEN + 306, s_edit, 5);
    put_dec(SCREEN + 314, w_upd, 5);
    put_dec(SCREEN + 327, d_used, 3);
    put_dec(SCREEN + 333, b_used, 3);
    put_hex(SCREEN + 345, d_cs);
    put_dec(SCREEN + 355, s_step, 5);

    RESULT = fault ? 2 : 1;
    vic.color_border = fault ? VCOL_RED : VCOL_GREEN;
    for (;;) ;
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=destructible-terrain.prg destructible-terrain.c
```

Oscar64 1.32.271 builds it with no warnings; the PRG is 20,540 bytes.
Most of that is the gap between the BASIC start and $4000: the
`#pragma region` puts code and data above the charset at $3800, so
nothing can grow into it (`charset_blit_overruns_grown_code`).

The `EXP_` constants come from this script (Python 3). It keeps the
level as a 160 by 128 array of pixel pairs and the creatures as
objects, with no glyphs, codes or pool. A cell counts as holding a
private glyph when its pixels match none of the three shared glyphs;
that is the pool count the C must reach by allocating and freeing. It
prints the `#define` block in the listing.

```python
# terrain_model.py: the reference for destructible-terrain.c. Same level,
# same rules, same order of work per tick, kept as a pixel array and
# objects rather than glyphs and screen codes. Prints the checksums and
# counts the listing compiles in.
W, H = 160, 128                  # multicolour pixels: 40 x 16 cells of 4 x 8
EMPTY, EARTH, STEP2 = 0, 1, 2
EARTH_ROWS = [0x56, 0x65, 0x59, 0x95, 0x56, 0x65, 0x59, 0x95]
STEP2_ROWS = [0, 0, 0, 0, 0, 0, 0xAA, 0xAA]
GLYPHS = {EMPTY: [0] * 8, EARTH: EARTH_ROWS, STEP2: STEP2_ROWS}
LEVEL = [
    "........................................",
    "........................................",
    "........................................",
    "........................................",
    "#...........s...........................",
    "#######################.................",
    "#######################.................",
    "#.......................................",
    "#...............................########",
    "###############################.........",
    "#......................................#",
    "#......................................#",
    "#......................................#",
    "#......................................#",
    "#......................................#",
    "########################################",
]
N, HX, HY, REL_EVERY = 24, 22, 12, 8
FATAL, BRICKS, TICKS = 32, 12, 360
WALK, FALL, DIG, BUILD, BLOCK, DEAD = 0, 1, 2, 3, 4, 5
SCRIPT = [(70, 0, BLOCK), (120, 3, DIG), (157, 8, DIG), (246, 4, BUILD)]
POOL = 128


def pair(byte, i):
    return (byte >> (6 - 2 * i)) & 3


class World:
    def __init__(self):
        self.px = [[0] * W for _ in range(H)]
        for cy, row in enumerate(LEVEL):
            for cx, ch in enumerate(row):
                g = GLYPHS[{'.': EMPTY, '#': EARTH, 's': STEP2}[ch]]
                for r in range(8):
                    for i in range(4):
                        self.px[cy * 8 + r][cx * 4 + i] = pair(g[r], i)
        self.cr = []
        self.refused = 0
        self.ignored = 0
        self.peak = 0
        self.freed = 0

    def solid(self, x, y):
        if x < 0 or x >= W or y < 0 or y >= H:
            return True
        return self.px[y][x] != 0

    def cell_private(self, cx, cy):
        rows = []
        for r in range(8):
            b = 0
            for i in range(4):
                b = (b << 2) | self.px[cy * 8 + r][cx * 4 + i]
            rows.append(b)
        return rows not in GLYPHS.values()

    def used(self):
        return sum(self.cell_private(cx, cy) for cy in range(16) for cx in range(40))

    def setpix(self, x, y, v):
        if x < 0 or x >= W or y < 0 or y >= H or self.px[y][x] == v:
            return
        cx, cy = x >> 2, y >> 3
        if not self.cell_private(cx, cy) and self.used() >= POOL:
            self.refused += 1
            return
        was = self.cell_private(cx, cy)
        self.px[y][x] = v
        if was and not self.cell_private(cx, cy):
            self.freed += 1
        self.peak = max(self.peak, self.used())


class Cr:
    def __init__(self):
        self.x, self.y, self.dir, self.st = HX, HY, 1, FALL
        self.fall, self.t, self.bricks = 0, 0, 0


def blocked(w, me, nx, y):
    for c in w.cr:
        if c is not me and c.st == BLOCK and c.x == nx and abs(c.y - y) < 4:
            return True
    return False


def update(w, c):
    if c.st == WALK:
        nx = c.x + c.dir
        if nx < 0 or nx >= W or blocked(w, c, nx, c.y):
            c.dir = -c.dir
            return
        ny = c.y
        if w.solid(nx, ny):
            if not w.solid(nx, ny - 1):
                ny -= 1
            elif not w.solid(nx, ny - 2):
                ny -= 2
            else:
                c.dir = -c.dir
                return
        c.x, c.y = nx, ny
        if not w.solid(c.x, c.y + 1):
            c.st, c.fall = FALL, 0
    elif c.st == FALL:
        if w.solid(c.x, c.y + 1):
            c.st = DEAD if c.fall > FATAL else WALK
        elif c.y + 1 >= H - 1:
            c.st = DEAD
        else:
            c.y += 1
            c.fall += 1
    elif c.st == DIG:
        c.t += 1
        if c.t < 2:
            return
        c.t = 0
        if not (w.solid(c.x - 1, c.y + 1) or w.solid(c.x, c.y + 1)
                or w.solid(c.x + 1, c.y + 1)):
            c.st, c.fall = FALL, 0
            return
        for dx in (-1, 0, 1):
            w.setpix(c.x + dx, c.y + 1, 0)
        c.y += 1
    elif c.st == BUILD:
        c.t += 1
        if c.t < 4:
            return
        c.t = 0
        if c.bricks == 0 or w.solid(c.x + c.dir, c.y - 1):
            c.st = WALK
            return
        w.setpix(c.x + c.dir, c.y, 2)
        w.setpix(c.x + 2 * c.dir, c.y, 2)
        c.x += c.dir
        c.y -= 1
        c.bricks -= 1


class Fletcher:
    # Fletcher-16: two running sums modulo 255, so order counts.
    def __init__(self):
        self.a = self.b = 0

    def add(self, v):
        self.a = (self.a + v) % 255
        self.b = (self.b + self.a) % 255

    def value(self):
        return self.b << 8 | self.a


def terrain_cs(w):
    cs = Fletcher()
    for cy in range(16):
        for cx in range(40):
            for r in range(8):
                b = 0
                for i in range(4):
                    b = (b << 2) | w.px[cy * 8 + r][cx * 4 + i]
                cs.add(b)
    return cs.value()


def creature_cs(w):
    cs = Fletcher()
    for c in w.cr:
        for v in (c.x, c.y, c.st, c.dir & 0xFF):
            cs.add(v)
    return cs.value()


def tick(w, t):
    if t % REL_EVERY == 0 and len(w.cr) < N:
        w.cr.append(Cr())
    for (st, i, role) in SCRIPT:
        if st == t:
            if i < len(w.cr) and w.cr[i].st == WALK:
                w.cr[i].st, w.cr[i].t = role, 0
                if role == BUILD:
                    w.cr[i].bricks = BRICKS
            else:
                w.ignored += 1
    for c in w.cr:
        update(w, c)


def run():
    w = World()
    for t in range(TICKS):
        tick(w, t)
    return w


def stress(w, st):
    # Worst frame: every creature on the floor in its own column, about
    # to take a dig step (st = DIG) or lay a brick (st = BUILD).
    for i, c in enumerate(w.cr):
        c.x, c.y, c.dir, c.st, c.fall = 4 + 6 * i, 119, 1, st, 0
        c.t, c.bricks = (1 if st == DIG else 3), BRICKS
    for c in w.cr:
        update(w, c)
    return terrain_cs(w), creature_cs(w), w.used()


def stress_walk(w):
    # Worst walk: every creature walking into a 2-pixel brick wall it can
    # climb, each in its own column. The bricks are laid before the tick.
    for i, c in enumerate(w.cr):
        c.x, c.y, c.dir, c.st, c.fall, c.t = 4 + 6 * i, 119, 1, WALK, 0, 0
    for i in range(len(w.cr)):
        w.setpix(5 + 6 * i, 119, 2)
        w.setpix(5 + 6 * i, 118, 2)
    for c in w.cr:
        update(w, c)
    return terrain_cs(w), creature_cs(w), w.used()


if __name__ == '__main__':
    import copy
    w = run()
    st = [c.st for c in w.cr]
    print("// walk %d fall %d dig %d build %d block %d dead %d" %
          tuple(st.count(s) for s in range(6)))
    print("// refused %d ignored %d" % (w.refused, w.ignored))
    print("#define EXP_TERRAIN   0x%04x" % terrain_cs(w))
    print("#define EXP_CREATURES 0x%04x" % creature_cs(w))
    print("#define EXP_USED      %d" % w.used())
    print("#define EXP_PEAK      %d" % w.peak)
    print("#define EXP_FREED     %d" % w.freed)
    print("#define EXP_DEAD      %d" % st.count(DEAD))
    for tag, st in (("S", DIG), ("B", BUILD)):
        t, c, u = stress(copy.deepcopy(w), st)
        print("#define EXP_%s_TERRAIN   0x%04x" % (tag, t))
        print("#define EXP_%s_CREATURES 0x%04x" % (tag, c))
        print("#define EXP_%s_USED      %d" % (tag, u))
    t, c, u = stress_walk(copy.deepcopy(w))
    print("#define EXP_W_TERRAIN   0x%04x" % t)
    print("#define EXP_W_CREATURES 0x%04x" % c)
    print("#define EXP_W_USED      %d" % u)
```

## Expected output

Black background, green border. Rows 0 to 8 are a white HUD. Below it
the level in brown and orange: a left wall, the upper platform (cell
rows 5 and 6) with a 2-pixel step on it and a 6-pixel-wide shaft dug
through it, the lower floor (cell row 9) ending at pixel 123, a
twelve-brick orange staircase rising right from it to the ledge on the
right (cell row 8), a right wall and the bottom floor. Creatures are
white columns 1 multicolour pixel wide and 4 tall: the blocker on the
upper platform at pixel 61, two on the staircase and sixteen on the
ledge. The five dead are not drawn.

HUD at 20,000,000 cycles (measured in VICE x64sc 3.10, decoded with PIL
against the character ROM):

| Row | PAL | NTSC |
|---|---|---|
| 0 | `TICK 00360 PASS  POOL 007 PEAK 007` | same |
| 1 | `ALIVE 19 DEAD 05 REFUSED 000 CODE 00` | same |
| 2 | `TERRAIN CB64 CREATURES 92CB FREED 002` | same |
| 3 | `WALK 00562 FALL 00241 PROBE 10912` | `WALK 00648 FALL 00241 PROBE 10912` |
| 4 | `DIG  01403 BUILD 01577 EMPTY 02580` | `DIG  01532 BUILD 01706 EMPTY 02580` |
| 5 | `TICK MAX 27280 ERASE 02033 DRAW 15024` | `TICK MAX 27802 ERASE 02033 DRAW 15234` |
| 6 | `DIGS 57299 E 01633 U 36431 D 19104` | `DIGS 57606 E 01633 U 36523 D 19319` |
| 7 | `BRICKS 56357 U 42071 EDIT 32037 W 14209` | `BRICKS 56701 U 42631 EDIT 32555 W 14465` |
| 8 | `POOL D 043 B 043 TERRAIN 627F STEP 01450` | same |

Every figure is in CPU cycles from a CIA timer, and every checked value
matches the model on both models.

| Field | What it is |
|---|---|
| POOL, PEAK, FREED | private glyphs in use after 360 ticks, the most in use at once, and how many went back to the pool |
| REFUSED, CODE | pool-full refusals (0); the fault bits, 0 on pass |
| TERRAIN, CREATURES | the two checksums after 360 ticks, equal to the model's |
| WALK, FALL, DIG, BUILD | the slowest single creature update seen in that state over the 360 ticks |
| PROBE, EMPTY | 160 probes along one pixel row, and the same loop with no probe, display off: (10,912 − 2,580) / 160 = 52 cycles a probe |
| TICK MAX, ERASE, DRAW | the slowest whole tick (restore, release, roles, 24 updates, draw), and the slowest restore and draw. TICK MAX includes the per-creature timer reads |
| DIGS | a whole tick with all 24 creatures on a dig step: restore (E), updates (U) and draw (D). Each digger clears 3 pixels and lands in two cells |
| BRICKS | a whole tick with all 24 laying a brick, and its updates (U) |
| EDIT | the 72 pixel edits of 24 dig steps alone, 36 of which take a new private glyph |
| W | the 24 updates alone, every creature walking into a 2-pixel brick wall and climbing it: four probes and a blocker check each, the most any walk makes. The bricks are laid before the timer starts. Without the per-creature timer reads it is 603 a creature on NTSC, under the 648 of WALK, which includes them |
| POOL D, B | glyphs in use after the dig and brick subjects; the terrain checksum after the digs |
| STEP | the dearest single dig step's terrain work, the same 72 edits timed one step (3 edits) at a time, including the timer calls. Half the steps span two cells and allocate twice, half allocate once |

The scenario ran as the model predicts. The blocker stands from tick 70.
The first digger goes through the upper platform in 16 steps and falls
16 pixels; the second, beside it from tick 157, widens the shaft so two
cells become empty again and are freed (FREED 002). The builder lays
its twelve bricks from tick 246. Before it finishes, three creatures
walk off the end of the lower floor and two off the top of the
unfinished staircase; they fall 48 to 57 pixels, more than the fatal
32, and die.

Two pinned runs per model gave byte-identical PNGs,
`screenshots/destructible-terrain.png` (PAL) and
`screenshots/destructible-terrain-ntsc.png` (NTSC). Measured on both with
this script: all 40,960 screen pixels of the level (160 by 128
multicolour pixels, two screen pixels each) equal the model's terrain
after tick 360 with the creature bodies drawn in white; 0 wrong. The
border is (98, 213, 50) on PAL and (114, 189, 103) on NTSC. The same
script run against the model at 359 ticks reports 56 wrong pixels, so
it can fail.

```python
# Every level pixel on the exit screenshot against the model after 360
# ticks: terrain pairs 00/01/10 as black/brown/orange, creature bodies
# (4 pixels tall, pair 11) white. One multicolour pixel is 2 screen pixels.
from PIL import Image
import terrain_model as m
COL = {'pal': {0: (0, 0, 0), 1: (119, 83, 0), 2: (183, 99, 30), 3: (255, 255, 255)},
       'ntsc': {0: (0, 0, 0), 1: (151, 64, 0), 2: (196, 98, 65), 3: (255, 255, 255)}}
w = m.run()
exp = [row[:] for row in w.px]
for c in w.cr:
    if c.st != m.DEAD:
        for k in range(4):
            exp[c.y - k][c.x] = 3
def check(png, model):
    px = Image.open(png).convert('RGB').load()
    top = (23 if model == 'ntsc' else 35) + 8 * 9
    bad = 0
    for y in range(m.H):
        for x in range(m.W):
            want = COL[model][exp[y][x]]
            for i in (0, 1):
                if px[32 + 2 * x + i, top + y] != want:
                    bad += 1
    border = px[2, 100]
    return bad, border
for png, model in (('pal1.png', 'pal'), ('ntsc1.png', 'ntsc')):
    bad, border = check(png, model)
    print(png, 'wrong pixels %d of %d, border %s' % (bad, 2 * m.W * m.H, border))
```

The listing can fail too. A copy with `EXP_TERRAIN` changed by one bit
printed `FAIL`, `CODE 01` and a red border (175, 60, 88) on PAL.

**Pool exhaustion.** A copy built with a 32-code pool (`POOLN 32`) ran
the scenario unchanged (it needs at most 7) and refused edits once the
pool filled at 32: `REFUSED 083`, which is 23 in each of the EDIT, STEP
and dig subjects and 14 in the brick subject, the counts the model
gives with `POOL = 32`. Its terrain checksum after the digs, `E71F`,
equals the model's, so the refusal rule matches. The climb subject
needs 31 codes and passes. That copy prints `FAIL` with `CODE 48`
(fault bits 16 and 32), because its compiled-in constants are the
128-code ones.

## Why this works

**Private glyphs.** The VIC-II draws a cell from the 8 bytes of its
code's glyph, so changing a glyph byte changes every cell that shows
that code. Earth is shared by hundreds of cells, so an edit to it must
not touch the shared glyph. `setpix()` first checks whether the pixel
already has the wanted value; if it does, nothing is allocated. If the
cell shows a shared code, it pops a free code, copies the 8 bytes and
writes the new code into the cell, and only then edits the byte. After
every edit it compares the private glyph with the three shared glyphs;
on a match the cell gets the shared code back and the private code goes
back on the free stack. One cell owns each private glyph, so no
reference count is needed.

**Probes.** `solid(x, y)` turns a pixel into a cell (`x >> 2`,
`y >> 3`), reads the screen code there, and tests the pixel pair at row
`y & 7` of that code's glyph with a mask from `x & 3`. Any non-zero pair
is terrain. It reads the terrain as the VIC shows it, so a creature
never walks through a pixel that is drawn. Outside the level counts as
solid; with `char` coordinates, `x - 1` at 0 is 255, which the same
test catches. Creatures are not in the glyphs when probes run: every
tick restores all creature cells first, updates, then draws.

**Creatures as merged glyphs.** Each creature owns two codes, $50 + 2i
and $51 + 2i, for the one or two cells its 4-pixel body covers. The draw
saves the code under each cell, copies that glyph into the creature's
code and ORs pair 11 into the body rows. Pair 11 takes the colour from
colour RAM, white here, so the body keeps its colour over any terrain.
The restore runs in reverse order so that stacked creatures unwind, as
in `char_bullets`. Hardware sprites would not do: the sixteen creatures
on the ledge share the same raster lines.

**The state machine.** A walker moves one pixel; if the pixel ahead at
foot level is solid it climbs 1 or 2 pixels when there is room, and
otherwise turns. A walker that would step onto a blocker's column
within 3 pixels of its height turns. With no ground under it, it starts
to fall. A faller counts pixels and dies on landing after more than 32.
A digger clears 3 pixels below its feet every second tick and moves
down one; with nothing left under it, it falls. A builder lays a
2-pixel brick level with its feet every fourth tick, steps up one
pixel onto it, and stops after 12 bricks or when the pixel ahead of it,
one above its feet, is solid. The model is written from this list, not from the C.

**Checks.** The terrain checksum reads the glyph bytes through the
screen codes, so it checks the pool bookkeeping as well as the pixels:
a cell left on a stale code, or a private glyph freed while still on
screen, changes it. A position checksum over the creatures, the pool
counts and the death count complete the verdict. The screenshot
comparison checks what the VIC shows. `EXP_S_CREATURES` and
`EXP_B_CREATURES` are both `0x2a72` by a coincidence of the checksum.
The diggers end at (x, 120) in state dig (2), the builders at
(x + 1, 118) in state build (3): x up 1, y down 2, state up 1. Fletcher-16
weights consecutive bytes w, w − 1, w − 2, and
w − 2(w − 1) + (w − 2) = 0, so neither sum moves (arithmetic). Each
subject is also checked with its own terrain checksum, and those
differ.

**Cost.** In this C, on NTSC, a creature update costs 241 cycles
falling, up to 648 walking, up to 1,532 on a dig step and up to 1,706
on a brick, and drawing one costs about 805 (19,319 / 24, two cells
each). The dig subject, 57,606 cycles, is more than three NTSC frames
of 17,095 (3.4). The scenario's slowest tick, 27,802, is more than one.
The timed loop starts on line 256, so the run is not one tick per
frame; the checks do not depend on that. `techniques/logic.md`, `creature_state_machine`,
works out how many creatures fit a frame.
