// waves.c: attack waves triggered by scroll distance, after c64-kb's
// oscar64/wave-director recipe (techniques wave_director, object_pool).
// A list of wave records sorted by map row is read through a cursor; each
// names a path, an enemy type, a count, a spawn spacing in frames and a
// formation (first half X and step). Enemies live in a fixed pool of twelve.
// Each runs a path written as bytecode: MOVE n steps of (dx, dy), LOOP, END.
// Because the waves wait for the scroll, not a frame count, a level that
// stops or slows keeps its waves where the map put them.
#include "waves.h"
#include "display.h"
#include "level.h"

char e_state[NE];
static char e_path[NE], e_pc[NE], e_n[NE], e_lc[NE], e_type[NE], e_timer[NE];
static signed char e_dx[NE], e_dy[NE];
char waves_started;
char kills_by_type[3];

// ---- paths -----------------------------------------------------------------
// A byte below $80 is MOVE: that many steps of signed dx (half X) and dy
// (lines). P_LOOP count, target jumps back count - 1 times. P_END frees the
// enemy. Nothing else takes a frame.
#define P_END  0x80
#define P_LOOP 0x81
#define S(n) ((char)(signed char)(n))

static const char path_dive[]   = { 127, 0, 3, P_END };
static const char path_weave[]  = { 8, 1, 2,  16, S(-1), 2,  8, 1, 2,   // one sway, 32 steps
                                    P_LOOP, 3, 0,
                                    127, 0, 3, P_END };
static const char path_swoop[]  = { 16, 0, 3,  10, 1, 2,  12, 2, 1,  80, 2, 0, P_END };
static const char path_swoopl[] = { 16, 0, 3,  10, S(-1), 2,  12, S(-2), 1,  80, S(-2), 0, P_END };
// The parade: down to a row, hold there, then dive. Row A stops at Y 72, row
// B at Y 102: 30 lines apart, so the multiplexer can reuse all five slots.
static const char path_parade_a[] = { 16, 0, 3,  127, 0, 0,  60, 0, 0,  127, 0, 3, P_END };
static const char path_parade_b[] = { 26, 0, 3,  127, 0, 0,  50, 0, 0,  127, 0, 3, P_END };

enum { PA_DIVE, PA_WEAVE, PA_SWOOP, PA_SWOOPL, PA_PARADE_A, PA_PARADE_B };
static const char * const paths[6] = {
    path_dive, path_weave, path_swoop, path_swoopl, path_parade_a, path_parade_b
};

// ---- enemy types -----------------------------------------------------------
enum { T_DART, T_SAUCER, T_BUG };
static const char type_frame[3]  = { F_DART, F_SAUCER, F_BUG };
static const char type_colour[3] = { VCOL_RED, VCOL_CYAN, VCOL_PURPLE };
static const char type_points[3] = { 5, 10, 15 };      // tens of points

// ---- the wave list, sorted by map row ------------------------------------------
// Row: the map row (cur_pos modulo LEVEL_ROWS) that starts the wave.
// Spawn line Y_ENTRY is in the top border; enemy k appears at hx0 + k * step.
#define Y_ENTRY 24
struct Wave { char row, path, type, count, spacing, hx0; signed char step; };
#define NWAVES 11
static const struct Wave wave[NWAVES] = {
    {  1, PA_DIVE,     T_DART,   5,  8,  40,  20 },
    {  6, PA_WEAVE,    T_SAUCER, 5, 10,  86,   0 },
    { 20, PA_PARADE_A, T_BUG,    5,  2,  30,  24 },
    { 22, PA_PARADE_B, T_BUG,    5,  2,  30,  24 },
    { 32, PA_SWOOP,    T_DART,   4,  6,  30,   6 },
    { 40, PA_SWOOPL,   T_DART,   5,  6, 140,  -6 },
    { 48, PA_WEAVE,    T_SAUCER, 6,  8,  50,   0 },
    { 56, PA_DIVE,     T_DART,   6,  4,  30,  24 },
    { 64, PA_SWOOP,    T_BUG,    5,  8,  30,   8 },
    { 72, PA_WEAVE,    T_SAUCER, 6,  8, 120,   0 },
    { 84, PA_DIVE,     T_DART,   6,  6, 150, -22 },
};

static char cursor, loop, last_row;
static char sp_wave, sp_left, sp_timer;       // the one active spawner

static void enemy_free(char e)
{
    e_state[e] = E_FREE;
    e_y[e] = OFF_Y;
}

void waves_reset(void)
{
    for (char e = 0; e < NE; e++)
        enemy_free(e);
    cursor = loop = last_row = 0;
    sp_left = 0;
    waves_started = 0;
    kills_by_type[0] = kills_by_type[1] = kills_by_type[2] = 0;
}

unsigned waves_due(unsigned pos)
{
    unsigned n = 0;
    for (char w = 0; w < NWAVES; w++)
        if (wave[w].row <= pos)
            n++;
    return n;
}

static void spawn(char w, char k)
{
    for (char e = 0; e < NE; e++) {
        if (e_state[e] == E_FREE) {
            char t = wave[w].type;
            e_state[e] = E_FLYING;
            e_hx[e] = wave[w].hx0 + k * wave[w].step;
            e_y[e] = Y_ENTRY;
            e_path[e] = wave[w].path;
            e_pc[e] = e_n[e] = e_lc[e] = 0;
            e_type[e] = t;
            e_ptr[e] = SPR_BLOCK + type_frame[t];
            e_colour[e] = type_colour[t];
            return;
        }
    }                                           // pool full: this one is dropped
}

// Enemy e has no steps left: read opcodes until a MOVE. Returns 0 when its
// path has ended. Most frames never come here: a MOVE lasts many steps.
static char path_fetch(char e)
{
    const char *p = paths[e_path[e]];
    while (e_n[e] == 0) {
        char pc = e_pc[e];
        char op = p[pc];
        if (op == P_END)
            return 0;
        if (op == P_LOOP) {
            if (e_lc[e] == 0)
                e_lc[e] = p[pc + 1];
            e_pc[e] = --e_lc[e] ? p[pc + 2] : pc + 3;
        } else {
            e_n[e]  = op;
            e_dx[e] = p[pc + 1];
            e_dy[e] = p[pc + 2];
            e_pc[e] = pc + 3;
        }
    }
    return 1;
}

// Start every wave whose row the scroll has reached: >= and not ==, so a
// scroll that moves more than one row a frame cannot skip one.
static void director(char row)
{
    if (row < last_row) {                       // the level looped
        cursor = 0;
        loop++;
    }
    last_row = row;
    while (cursor < NWAVES && row >= wave[cursor].row) {
        sp_wave = cursor;
        sp_left = wave[cursor].count;
        sp_timer = 0;
        waves_started++;
        cursor++;
    }
}

static void spawner(void)
{
    if (sp_left == 0)
        return;
    if (sp_timer) {
        sp_timer--;
        return;
    }
    char w = sp_wave;
    spawn(w, wave[w].count - sp_left);
    sp_left--;
    char gap = wave[w].spacing >> (loop > 2 ? 2 : loop);    // later loops: closer together
    sp_timer = gap ? gap - 1 : 0;
}

void enemy_explode(char e)
{
    e_state[e] = E_BOOM;
    e_timer[e] = 16;
    e_ptr[e] = SPR_BLOCK + F_BOOM1;
    e_colour[e] = VCOL_YELLOW;
}

char enemy_points(char e)
{
    char t = e_type[e];
    kills_by_type[t]++;
    return type_points[t];
}

void waves_update(char row)
{
    director(row);
    spawner();
    for (char e = 0; e < NE; e++) {
        char s = e_state[e];
        if (s == E_FLYING) {
            if (!e_n[e] && !path_fetch(e)) {
                enemy_free(e);                  // the path ended
                continue;
            }
            e_n[e]--;
            char x = e_hx[e] + e_dx[e], y = e_y[e] + e_dy[e];
            e_hx[e] = x;
            e_y[e] = y;
            if (y > MAX_SY || x < 4 || x > 170)
                enemy_free(e);                  // left the screen: no score
        } else if (s == E_BOOM) {
            char t = --e_timer[e];
            if (t == 8)
                e_ptr[e] = SPR_BLOCK + F_BOOM2;
            else if (t == 0)
                enemy_free(e);
        }
    }
}
