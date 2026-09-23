// cave.c: the rules. Built from c64-kb's oscar64/cave-scan recipe, with
// pushing, a second enemy, explosions, gems collected for points, the exit
// and the time counter added. Every rule here is written again in Python in
// tools/gen.py (class Cave); change both together.
#include "cave.h"

#ifndef FORCE_FAULT
#define FORCE_FAULT 0
#endif

char cave[CW * CH];
char cave_move;
char cave_got, cave_need, cave_time, cave_tick;
unsigned cave_points;
unsigned cave_player, cave_exit_at;
bool cave_dead, cave_exited, cave_exit_open;
char cave_events;

unsigned cave_dirty[DIRTY_MAX];
char cave_ndirty;
bool cave_overflow;

// Headings in clockwise order: left, up, right, down. Turning left is
// heading + 3, turning right heading + 1, both modulo 4.
static const signed char step[4] = { -1, -CW, 1, CW };

static void mark(char *q)
{
    if (cave_ndirty < DIRTY_MAX)
        cave_dirty[cave_ndirty++] = q - cave;
    else
        cave_overflow = true;
}

// The one place an object moves. A move to a later cell in scan order sets
// the scanned bit, so the scan skips the object when it gets there.
static void put(char *dst, char v, char *src)
{
    if (dst > src)
        v |= SCANNED;
    *dst = v;
    *src = SPACE;
    if (v == PLAYER || v == (PLAYER | SCANNED))
        cave_player = dst - cave;
    mark(dst);
    mark(src);
}

// A 3 x 3 explosion. Steel and the exit survive. Cells after `at` in scan
// order get the scanned bit, so the explosion starts on the next cave frame
// everywhere. `at` = 0xffff (from cave_end_frame) marks none.
static void explode(unsigned centre, char kind, unsigned at)
{
    for (signed char dy = -CW; dy <= CW; dy += CW)
        for (signed char dx = -1; dx <= 1; dx++)
        {
            unsigned n = centre + dy + dx;
            char t = cave[n] & 0x7f;
            if (t == STEEL || t == EXIT_SHUT || t == EXIT_OPEN)
                continue;
            if (t == PLAYER)
                cave_dead = true;
            cave[n] = n > at ? kind | SCANNED : kind;
            mark(cave + n);
        }
    cave_events |= EV_BOOM;
}

static bool is_round(char t)
{
    return t == BOULDER || t == GEM || t == BRICK;
}

// Roll off a round object: left first, then right. Needs the side cell and
// the cell below it empty. The object leaves falling.
static bool roll(char *p, char fall)
{
    if (p[-1] == SPACE && p[CW - 1] == SPACE) { put(p - 1, fall, p); return true; }
    if (p[1] == SPACE && p[CW + 1] == SPACE)  { put(p + 1, fall, p); return true; }
    return false;
}

static void fall_rules(char *p, char v)
{
    char b = p[CW];
    char bt = b & 0x7f;
    if (b == SPACE)
        put(p + CW, v, p);                            // keep falling
    else if (bt == PLAYER || (bt >= SPARK && bt < MOTH))
        explode(p + CW - cave, BLAST, p - cave);
    else if (bt >= MOTH && bt < BLAST)
        explode(p + CW - cave, BURST, p - cave);      // a moth dies into gems
    else if (bt == BOULDER_F || bt == GEM_F)
        ;                                             // wait for it to move
    else if (!(is_round(bt) && roll(p, v)))
    {
        *p = v - 1;                                   // land
        mark(p);
        cave_events |= EV_LAND;
    }
}

static void player_rules(char *p)
{
    if (cave_move >= 4)
        return;
    signed char s = step[cave_move];
    char *t = p + s;
    char tv = *t;
    if (tv == SPACE || tv == DIRT)
    {
        if (tv == DIRT)
            cave_events |= EV_DIG;
        put(t, PLAYER, p);
    }
    else if (tv == GEM)
    {
        cave_got++;
        cave_points += GEM_POINTS + FORCE_FAULT;      // the fault build miscounts
        cave_events |= EV_GEM;
        put(t, PLAYER, p);
    }
    else if (tv == EXIT_OPEN)
    {
        *p = SPACE;
        mark(p);
        cave_exited = true;
    }
    else if (tv == BOULDER && (cave_move == 0 || cave_move == 2) && t[s] == SPACE)
    {
        put(t + s, BOULDER, t);                       // push: the boulder first
        put(t, PLAYER, p);
        cave_events |= EV_PUSH;
    }
}

// Sparks turn left when they can, moths turn right; either goes on when it
// cannot turn, and turns the other way on the spot when both are blocked.
// Either explodes when the player is next to it.
static void enemy_rules(char *p, char v)
{
    char base = v < MOTH ? SPARK : MOTH;
    char kind = v < MOTH ? BLAST : BURST;
    for (char k = 0; k < 4; k++)
        if ((p[step[k]] & 0x7f) == PLAYER)
        {
            explode(p - cave, kind, p - cave);
            return;
        }
    char d = v & 3;
    char first = base == SPARK ? (d + 3) & 3 : (d + 1) & 3;
    char spin  = base == SPARK ? (d + 1) & 3 : (d + 3) & 3;
    if (p[step[first]] == SPACE)
        put(p + step[first], base + first, p);
    else if (p[step[d]] == SPACE)
        put(p + step[d], base + d, p);
    else
    {
        *p = base + spin;
        mark(p);
    }
}

// One object's turn. Called only for codes BOULDER and up. It takes the row
// and the column, not a cell pointer: with a pointer argument Oscar64 -O2
// computed row + x for every cell before the test, and the loop took 42
// cycles a cell instead of 17 (counted from the generated code; an earlier
// comment said 41 and 14, a miscount). The frame meter read a typical play
// frame of 11,812 cycles before and 7,004 after, on the build whose HUD still
// rewrote every field each cave frame (6,340 with today's update_hud).
static __noinline void cell(char *row, char x)
{
    char *p = row + x;
    char v = *p;
    if (v & SCANNED)
    {
        *p = v & 0x7f;                                // moved here this scan
        return;
    }
    if (v == BOULDER || v == GEM)
    {
        char b = p[CW];
        if (b == SPACE)
            put(p + CW, v + 1, p);                    // start falling
        else if (is_round(b & 0x7f))
            roll(p, v + 1);
    }
    else if (v == BOULDER_F || v == GEM_F)
        fall_rules(p, v);
    else if (v == PLAYER)
        player_rules(p);
    else if (v >= BLAST)
    {
        if (v == BLAST + 2)
            *p = SPACE;
        else if (v == BURST + 2)
            *p = GEM;
        else
            *p = v + 1;
        mark(p);
    }
    else if (v >= SPARK)
        enemy_rules(p, v);
}

// Interior rows y0 .. y1 - 1. The loop only reads and compares: LDA (row),Y,
// CMP, BCC, INY, CPY, BCC: 5 + 2 + 3 + 2 + 2 + 3 = 17 cycles a cell of space,
// dirt, brick or steel (from the generated code, both branches taken, no page
// crossed; an earlier comment said 14, which was wrong). The dirty list starts
// empty for each slice.
__noinline void cave_scan_rows(char y0, char y1)
{
    cave_ndirty = 0;
    cave_overflow = false;
    char *row = cave + CW * y0;
    for (char y = y0; y < y1; y++, row += CW)
        for (char x = 1; x < CW - 1; x++)
            if (row[x] >= BOULDER)
                cell(row, x);
}

void cave_start(char need, char time)
{
    cave_need = need;
    cave_time = time;
    cave_got = 0;
    cave_tick = 0;
    cave_points = 0;
    cave_dead = cave_exited = cave_exit_open = false;
    cave_move = NO_MOVE;
    for (unsigned i = 0; i < CW * CH; i++)
    {
        if (cave[i] == PLAYER)
            cave_player = i;
        else if (cave[i] == EXIT_SHUT)
            cave_exit_at = i;
    }
}

// After the last slice of a cave frame: open the exit when the quota is met,
// then run the clock. Time out explodes the player.
void cave_end_frame(void)
{
    if (!cave_exit_open && cave_got >= cave_need)
    {
        cave[cave_exit_at] = EXIT_OPEN;
        mark(cave + cave_exit_at);
        cave_exit_open = true;
        cave_events |= EV_OPEN;
    }
    if (cave_exited || cave_dead)
        return;
    if (++cave_tick == TICK_CAVE_FRAMES)
    {
        cave_tick = 0;
        if (cave_time)
            cave_time--;
        if (cave_time == 0)
            explode(cave_player, BLAST, 0xffff);
    }
}

unsigned cave_fold(void)
{
    unsigned chk = 0;
    for (unsigned i = 0; i < CW * CH; i++)
    {
        unsigned t = chk ^ (cave[i] & 0x7f);
        chk = (t << 2) + t + 1;                       // (chk ^ v) * 5 + 1
    }
    return chk;
}
