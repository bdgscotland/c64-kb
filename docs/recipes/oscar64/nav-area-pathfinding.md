---
recipe: nav-area-pathfinding
toolchain: oscar64
output_format: PRG
region: both
techniques: [nav_area_pathfinding]
file_formats: [PRG]
uses_registers: [D011, D020, D021, DC04, DC05, DC06, DC07, DC0E, DC0F]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 Nav-Area Pathfinding: a chaser routed over platforms, ladders, drops and jumps

## Synopsis

A chaser crosses a character-map level of twelve platform areas to reach
a player marker, which moves to the next of eight waypoints each time it
is caught. At start the program finds the areas (runs of cells an actor
can stand in), joins them with 43 links (walk, drop, jump, ladder, each
with a cost), runs one Dijkstra search per destination and keeps a
next-hop table: for every pair of areas, the link to take first. Each
move is then one table read. Odd frames spend the chaser's budget on one
step of a line-of-sight ray to the player instead. Every hop taken is
checked against a table computed in Python by a different method
(Floyd-Warshall) and compiled in, and the whole table is compared too.
The screen shows the build time, the worst search, query and ray step in
CIA1 cycles, and PASS or FAIL. `$02FF` = `01` and a green border on
pass, `02` and red on fail. This is the `nav_area_pathfinding` technique
in `docs/techniques/logic.md`; the result-byte contract is
`headless-verify.md`.

## Source

```c
// nav-area-pathfinding.c
//
// Platform-graph pathfinding on a character map. At start the program
// finds the walkable areas (runs of cells an actor can stand in), links
// them by walk, drop, jump and ladder moves with a cost each, runs one
// Dijkstra search per destination and keeps a next-hop table: for each
// (from, to) pair of areas, the link to take first. A chaser then follows
// a player marker that moves to the next waypoint each time it is caught.
// Even frames the chaser moves one cell and makes one table query; odd
// frames it takes one step of a line-of-sight ray to the player.
// Each hop taken is checked against a next-hop table computed in Python
// by a different method (Floyd-Warshall) and compiled in.
// Row 0: build cycles, worst single search, areas and links. Row 1:
// worst query, worst LOS step, area and link pass, next-hop pass, all
// CIA1 cycles. Row 2: steps, queries, bad hops, table mismatches, LOS
// pairs right, result. $02FF = 01 and a green border on
// pass, 02 and red on fail. The chaser leaves a cyan trail.
// Build: oscar64 -tm=c64 -O2 -o=nav-area-pathfinding.prg nav-area-pathfinding.c
#include <c64/vic.h>
#include <c64/cia.h>
#include <string.h>

#define SCREEN ((char *)0x0400)
#define COLOUR ((char *)0xd800)
#define RESULT (*(volatile char *)0x02ff)
#define CODE_PASS 0x01
#define CODE_FAIL 0x02

// Map rows 0-21 are screen rows 3-24. '#' solid, 'H' ladder, '.' air.
#define MAP_ROW0 3
#define MW 40
#define MH 22
const char map_text[MH][MW + 1] = {
    "........................................",   //  0
    "........................................",   //  1
    "........................................",   //  2
    "..######H#####..........######H######...",   //  3
    "........H.....................H.........",   //  4
    "........H.....................H.........",   //  5
    "........H.....................H.........",   //  6
    "....#H######...##H####..####H###........",   //  7
    ".....H...........H..........H...........",   //  8
    ".....H...........H..........H...........",   //  9
    ".....H...........H..........H...........",   // 10
    "..#H#####H#.########......#########H##..",   // 11
    "...H.....H.........................H....",   // 12
    "...H.....H.........................H....",   // 13
    "...H.....H.........................H....",   // 14
    "...H..#########.....####H#####.....H....",   // 15
    "...H....................H.....#####H....",   // 16
    "...H....................H..........H....",   // 17
    "...H....................H..........H....",   // 18
    "...H....................H..........H....",   // 19
    "...H....................H..........H....",   // 20
    "########################################",   // 21
};

// Next area on a shortest route, from the Python model (Floyd-Warshall,
// first hop = lowest-numbered link on a shortest route). 255 on the
// diagonal.
#define EXP_N 12
const char exp_next[EXP_N * EXP_N] = {
    255,   6,   2,   6,   6,   2,   6,   6,   2,   6,   6,   2,
      4, 255,   4,   4,   4,   4,   4,   4,   4,   9,   9,   4,
      0,   6, 255,   6,   6,   5,   6,   6,   5,   6,   6,   5,
      6,   4,   6, 255,   4,   6,   6,   4,   6,   9,   9,   9,
      3,   1,   3,   3, 255,   3,   3,   7,   3,   9,   9,   7,
      2,   6,   2,   6,   6, 255,   6,   6,   8,   6,   6,  11,
      5,   3,   5,   3,   3,   5, 255,   3,   8,   9,   9,   9,
      4,   4,   4,   4,   4,   4,   4, 255,   4,   9,   9,  11,
      5,   5,   5,   5,   5,   5,   5,  11, 255,   5,   5,  11,
     11,  11,  11,  11,  11,  11,  11,  11,  11, 255,  10,  11,
      9,   9,   9,   9,   9,   9,   9,   9,   9,   9, 255,   9,
      5,   7,   5,   5,   7,   5,   5,   7,   5,   9,   9, 255,
};
#define EXP_STEPS   299
#define EXP_QUERIES 160

// Waypoints the player marker visits, (x, map row); each is a standing cell.
#define NWP 8
const char wp_x[NWP] = { 34,  4, 32, 10, 13,  7, 26, 38 };
const char wp_y[NWP] = {  2, 20, 15,  2, 10, 14,  6, 20 };
#define START_X 1
#define START_Y 20

// LOS test pairs: straight rows and columns, so any line algorithm gives
// the same answer. 1 clear, 2 blocked.
#define NLOS 4
const char los_x0[NLOS] = {  0, 10, 14,  0 };
const char los_y0[NLOS] = { 20, 10, 10,  7 };
const char los_x1[NLOS] = { 39, 10, 14, 20 };
const char los_y1[NLOS] = { 20, 14,  2,  7 };
const char los_exp[NLOS] = { 1,  2,  1,  2 };

// --- tiles ---------------------------------------------------------------
static inline char tile(signed char y, signed char x)
{
    if (x < 0 || x >= MW || y < 0)
        return '.';
    if (y >= MH)
        return '#';
    return map_text[y][x];
}

bool standable(signed char y, signed char x)
{
    if (y < 0 || y >= MH - 1 || x < 0 || x >= MW)
        return false;
    char c = map_text[y][x];
    if (c == '#')
        return false;
    char b = map_text[y + 1][x];
    return b == '#' || (b == 'H' && c != 'H');
}

// --- areas and links -------------------------------------------------------
#define MAXA 16                            // table stride; N <= 16
#define MAXL 64
#define NONE 255
enum { L_WALK, L_DROP, L_JUMP, L_LADDER };

char n_areas, n_links;
char ay[MAXA], ax0[MAXA], ax1[MAXA];
char area_at[MH][MW];                      // area per standing cell, NONE elsewhere
char lf[MAXL], lt[MAXL], lty[MAXL], lsx[MAXL], lex[MAXL], ley[MAXL], lc[MAXL];
char dist[MAXA * MAXA];                    // dist[from * MAXA + to]
char nextl[MAXA * MAXA];                   // link to take first, NONE if none

void add_link(char f, char t, char ty, char sx, char ex, char ey, char c)
{
    char i = n_links++;
    lf[i] = f; lt[i] = t; lty[i] = ty;
    lsx[i] = sx; lex[i] = ex; ley[i] = ey; lc[i] = c;
}

// Step sideways into (y, x) and fall: the landing row, or NONE.
char fall_from(char y, signed char x)
{
    if (x < 0 || x >= MW || map_text[y][x] != '.')
        return NONE;
    for (;;) {
        if (standable(y, x))
            return y;
        y++;
        if (y >= MH - 1 || map_text[y][x] != '.')
            return NONE;
    }
}

void build_areas(void)
{
    memset(area_at, NONE, sizeof(area_at));
    n_areas = 0;
    for (char y = 0; y < MH; y++) {
        char x = 0;
        while (x < MW) {
            if (standable(y, x)) {
                char a = n_areas++;
                ay[a] = y; ax0[a] = x;
                while (x < MW && standable(y, x))
                    area_at[y][x++] = a;
                ax1[a] = x - 1;
            } else
                x++;
        }
    }
}

void build_links(void)
{
    n_links = 0;
    for (char a = 0; a < n_areas; a++) {
        char y = ay[a], x0 = ax0[a], x1 = ax1[a];
        // Right end, then left end: a one-row step down is a walk both
        // ways, a longer fall is a one-way drop.
        for (char e = 0; e < 2; e++) {
            char sx = e ? x0 : x1;
            signed char x = e ? (signed char)x0 - 1 : x1 + 1;
            char land = fall_from(y, x);
            if (land != NONE && land > y) {
                char b = area_at[land][x];
                if (land == y + 1) {
                    add_link(a, b, L_WALK, sx, x, land, 1);
                    add_link(b, a, L_WALK, x, sx, y, 1);
                } else
                    add_link(a, b, L_DROP, sx, x, land, land - y + 1);
            }
            if (e == 0) {
                // Jump right over a gap of 1 or 2 cells to the same row.
                for (char gap = 1; gap <= 2; gap++) {
                    char bx = x1 + gap + 1;
                    if (bx >= MW || area_at[y][bx] == NONE)
                        continue;
                    bool clear = true;
                    for (char xx = x1; xx <= bx; xx++)
                        if (tile(y - 1, xx) != '.') clear = false;
                    for (char xx = x1 + 1; xx < bx; xx++)
                        if (map_text[y][xx] != '.') clear = false;
                    if (clear) {
                        char b = area_at[y][bx];
                        add_link(a, b, L_JUMP, x1, bx, y, gap + 2);
                        add_link(b, a, L_JUMP, bx, x1, y, gap + 2);
                        break;
                    }
                }
            }
        }
        // Ladders going down from this area.
        for (char x = x0; x <= x1; x++) {
            if (tile(y + 1, x) != 'H')
                continue;
            char yb = y + 1;
            while (tile(yb + 1, x) == 'H')
                yb++;
            char b = area_at[yb][x];
            if (b != NONE) {
                add_link(a, b, L_LADDER, x, x, yb, yb - y);
                add_link(b, a, L_LADDER, x, x, y, yb - y);
            }
        }
    }
}

// One search: cheapest cost from every area to area j, Dijkstra over the
// links read backwards. Writes column j of dist.
void search_to(char j)
{
    char d[MAXA];
    bool done[MAXA];
    char n = n_areas;
    for (char i = 0; i < n; i++) {
        d[i] = NONE;
        done[i] = false;
    }
    d[j] = 0;
    for (char k = 0; k < n; k++) {
        char best = NONE, u = NONE;
        for (char i = 0; i < n; i++)
            if (!done[i] && d[i] < best) {
                best = d[i];
                u = i;
            }
        if (u == NONE)
            break;
        done[u] = true;
        for (char l = 0; l < n_links; l++)
            if (lt[l] == u) {
                unsigned c = best + lc[l];
                char v = lf[l];
                if (c < d[v])
                    d[v] = c;
            }
    }
    for (char i = 0; i < n; i++)
        dist[i * MAXA + j] = d[i];
}

// First link on a shortest route from i to j: the lowest-numbered link
// out of i whose cost plus the rest of the route equals the route cost.
void build_next(void)
{
    for (char i = 0; i < n_areas; i++)
        for (char j = 0; j < n_areas; j++) {
            char r = NONE, dij = dist[i * MAXA + j];
            if (i != j && dij != NONE)
                for (char l = 0; l < n_links; l++) {
                    char dt = dist[lt[l] * MAXA + j];
                    if (lf[l] == i && dt != NONE && lc[l] + dt == dij) {
                        r = l;
                        break;
                    }
                }
            nextl[i * MAXA + j] = r;
        }
}

// --- CIA1 timers -------------------------------------------------------------
// Timer B alone for short work; timer B counting timer A underflows for
// the build, which runs past 65,535 cycles.
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

void long_start(void)
{
    cia1.cra = 0x00;
    cia1.crb = 0x00;
    cia1.ta = 0xffff;
    cia1.tb = 0xffff;
    cia1.crb = 0x51;                       // load, start, count TA underflows
    cia1.cra = 0x11;                       // load, start, count cycles
}

unsigned long long_stop(void)
{
    cia1.cra = 0x00;
    cia1.crb = 0x00;
    return ((unsigned long)(0xffff - cia1.tb) << 16) + (0xffff - cia1.ta);
}

// --- actors ------------------------------------------------------------------
char cx, cy, px, py;                       // chaser and player, (x, map row)
char tr_ty = NONE, tr_sx, tr_ex, tr_ey;    // link in progress, NONE when standing

// The query: which link to take first from the chaser's area to the
// player's. Two cell lookups and one table read.
char nav_query(void)
{
    char a = area_at[cy][cx];
    char p = area_at[py][px];
    if (a == p)
        return NONE;
    return nextl[a * MAXA + p];
}

void transit_step(void)
{
    signed char d = tr_ex > tr_sx ? 1 : (tr_ex < tr_sx ? -1 : 0);
    switch (tr_ty) {
    case L_WALK:
        cx = tr_ex; cy = tr_ey;
        break;
    case L_LADDER:
        if (tr_ey > cy) cy++; else cy--;
        break;
    case L_DROP:
        if (cx != tr_ex) cx = tr_ex; else cy++;
        break;
    case L_JUMP:                           // up and over, across, down
        if (cy == tr_ey && cx == tr_sx) { cx += d; cy--; }
        else if (cx != tr_ex) cx += d;
        else cy++;
        break;
    }
    if (cx == tr_ex && cy == tr_ey)
        tr_ty = NONE;
}

// --- line of sight, one cell per call ------------------------------------------
signed char lx, ly, ltx, lty2, lsxs, lsys;
int ldx, ldy, lerr;
char los_state;                            // 0 idle, 1 running

void los_begin(char x0, char y0, char x1, char y1)
{
    lx = x0; ly = y0; ltx = x1; lty2 = y1;
    ldx = x1 > x0 ? x1 - x0 : x0 - x1;
    ldy = -(int)(y1 > y0 ? y1 - y0 : y0 - y1);
    lsxs = x0 < x1 ? 1 : -1;
    lsys = y0 < y1 ? 1 : -1;
    lerr = ldx + ldy;
    los_state = 1;
}

// 0 still running, 1 clear, 2 blocked.
char los_step(void)
{
    if (lx == ltx && ly == lty2) {
        los_state = 0;
        return 1;
    }
    int e2 = 2 * lerr;
    if (e2 >= ldy) { lerr += ldy; lx += lsxs; }
    if (e2 <= ldx) { lerr += ldx; ly += lsys; }
    if (map_text[ly][lx] == '#') {
        los_state = 0;
        return 2;
    }
    return 0;
}

// --- drawing -------------------------------------------------------------------
#define C_FLOOR  VCOL_GREEN
#define C_LADDER VCOL_ORANGE
#define C_TRAIL  VCOL_CYAN
#define C_CHASER VCOL_WHITE
#define C_PLAYER VCOL_YELLOW

void draw_trail(char x, char y)
{
    unsigned o = (y + MAP_ROW0) * 40 + x;
    if (map_text[y][x] == '.')
        SCREEN[o] = 0x2e;                  // '.'
    COLOUR[o] = C_TRAIL;
}

void draw_at(char x, char y, char ch, char col)
{
    unsigned o = (y + MAP_ROW0) * 40 + x;
    SCREEN[o] = ch;
    COLOUR[o] = col;
}

void put_str(char *p, const char *s)
{
    while (*s)
        *p++ = *s++;
}

void put_dec(char *p, unsigned long v, char digits)
{
    for (char i = digits; i > 0; i--) {
        p[i - 1] = 0x30 + (char)(v % 10);
        v /= 10;
    }
}

int main(void)
{
    __asm { sei }
    vic.color_border = VCOL_BLACK;
    vic.color_back = VCOL_BLACK;
    memset(SCREEN, 0x20, 1000);
    memset(COLOUR, VCOL_LT_GREY, 1000);
    for (char y = 0; y < MH; y++)
        for (char x = 0; x < MW; x++) {
            char c = map_text[y][x];
            if (c == '#') draw_at(x, y, 0xa0, C_FLOOR);
            else if (c == 'H') draw_at(x, y, 0x08, C_LADDER);
        }

    // Build: areas, links, one search per destination, next-hop table.
    unsigned long t_search_max = 0;
    long_start();
    build_areas();
    build_links();
    unsigned long t_graph = long_stop();
    for (char j = 0; j < n_areas; j++) {
        long_start();
        search_to(j);
        unsigned long t = long_stop();
        if (t > t_search_max) t_search_max = t;
    }
    long_start();
    build_next();
    unsigned long t_next = long_stop();
    // Full build timed once more in one piece.
    long_start();
    build_areas();
    build_links();
    for (char j = 0; j < n_areas; j++)
        search_to(j);
    build_next();
    unsigned long t_build = long_stop();

    // Whole table against the model.
    char mismatch = 0;
    if (n_areas != EXP_N)
        mismatch = 255;
    else
        for (char i = 0; i < EXP_N; i++)
            for (char j = 0; j < EXP_N; j++) {
                char l = nextl[i * MAXA + j];
                // Not a ternary: Oscar64 1.32.271 at -O1 to -O3 drops the l == NONE
                // test when lt has fewer than 256 entries and reads lt[255].
                char h = NONE;
                if (l != NONE)
                    h = lt[l];
                if (h != exp_next[i * EXP_N + j]) mismatch++;
            }

    put_str(SCREEN,       s"build");
    put_dec(SCREEN + 6, t_build, 7);
    put_str(SCREEN + 15,  s"search");
    put_dec(SCREEN + 22, t_search_max, 6);
    put_str(SCREEN + 30,  s"n");
    put_dec(SCREEN + 32, n_areas, 2);
    put_dec(SCREEN + 35, n_links, 2);
    put_str(SCREEN + 40,  s"qry");
    put_str(SCREEN + 50,  s"los");
    put_str(SCREEN + 60,  s"ar");
    put_dec(SCREEN + 63, t_graph, 6);
    put_str(SCREEN + 70,  s"nx");
    put_dec(SCREEN + 73, t_next, 6);
    put_str(SCREEN + 80,  s"st     q     bad     mis     los   r");

    cx = START_X; cy = START_Y;
    char wp = 0;
    px = wp_x[0]; py = wp_y[0];
    draw_trail(cx, cy);
    draw_at(px, py, 0x53, C_PLAYER);
    draw_at(cx, cy, 0x51, C_CHASER);

    unsigned steps = 0, queries = 0, t_q = 0, t_los = 0;
    char bad = 0, frame = 0;
    bool done = false;

    for (;;) {
        vic_waitFrame();
        if (done)
            continue;
        frame++;
        if (frame & 1) {
            // Odd frame: one line-of-sight step toward the player.
            timer_start();
            if (los_state == 0)
                los_begin(cx, cy, px, py);
            else
                los_step();
            unsigned t = timer_stop();
            if (t > t_los) t_los = t;
            continue;
        }

        // Even frame: the chaser moves one cell.
        draw_trail(cx, cy);
        if (tr_ty != NONE)
            transit_step();
        else {
            timer_start();
            char l = nav_query();
            unsigned t = timer_stop();
            if (t > t_q) t_q = t;
            if (l == NONE) {
                if (px > cx) cx++;
                else if (px < cx) cx--;
            } else {
                queries++;
                char a = area_at[cy][cx], p = area_at[py][px];
                if (lt[l] != exp_next[a * EXP_N + p]) bad++;
                if (cx != lsx[l])
                    cx += cx < lsx[l] ? 1 : -1;
                else {
                    tr_ty = lty[l]; tr_sx = lsx[l];
                    tr_ex = lex[l]; tr_ey = ley[l];
                    transit_step();
                }
            }
        }
        steps++;
        if (tr_ty == NONE && cx == px && cy == py) {
            wp++;
            if (wp == NWP)
                done = true;
            else {
                px = wp_x[wp]; py = wp_y[wp];
                draw_at(px, py, 0x53, C_PLAYER);
            }
        }
        draw_at(cx, cy, 0x51, C_CHASER);
        put_dec(SCREEN + 44, t_q, 5);
        put_dec(SCREEN + 54, t_los, 5);
        put_dec(SCREEN + 80 + 3, steps, 3);
        put_dec(SCREEN + 80 + 9, queries, 3);

        if (done) {
            char los_ok = 0;
            for (char i = 0; i < NLOS; i++) {
                los_begin(los_x0[i], los_y0[i], los_x1[i], los_y1[i]);
                char r;
                while ((r = los_step()) == 0)
                    ;
                if (r == los_exp[i]) los_ok++;
            }
            char fault = 0;
            if (mismatch) fault = 1;
            else if (bad) fault = 2;
            else if (steps != EXP_STEPS || queries != EXP_QUERIES) fault = 3;
            else if (los_ok != NLOS) fault = 4;
            put_dec(SCREEN + 80 + 17, bad, 3);
            put_dec(SCREEN + 80 + 25, mismatch, 3);
            put_dec(SCREEN + 80 + 33, los_ok, 1);
            char code = fault ? CODE_FAIL : CODE_PASS;
            RESULT = code;
            vic.color_border = fault ? VCOL_RED : VCOL_GREEN;
            SCREEN[80 + 37] = 0x30 + code;
            SCREEN[80 + 38] = 0x30 + fault;
        }
    }
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=nav-area-pathfinding.prg nav-area-pathfinding.c
```

Oscar64 1.32.271 builds it with no warnings; the PRG is 5,521 bytes.

The reference table and the step and query counts come from this
script (Python 3). It reads the same map with the same link rules but
finds route costs by Floyd-Warshall, so a fault in the listing's
Dijkstra search shows as a table mismatch. It prints `12 areas, 43
links`, the twelve rows of `exp_next` and `steps 299 queries 160 end
(38, 20) trail cells 156`.

```python
# nav_model.py: the reference for nav-area-pathfinding.c. Same map and
# link rules; route costs by Floyd-Warshall instead of Dijkstra. Prints
# the exp_next table and the step and query counts the listing compiles in.
MAP = [
    "........................................",
    "........................................",
    "........................................",
    "..######H#####..........######H######...",
    "........H.....................H.........",
    "........H.....................H.........",
    "........H.....................H.........",
    "....#H######...##H####..####H###........",
    ".....H...........H..........H...........",
    ".....H...........H..........H...........",
    ".....H...........H..........H...........",
    "..#H#####H#.########......#########H##..",
    "...H.....H.........................H....",
    "...H.....H.........................H....",
    "...H.....H.........................H....",
    "...H..#########.....####H#####.....H....",
    "...H....................H.....#####H....",
    "...H....................H..........H....",
    "...H....................H..........H....",
    "...H....................H..........H....",
    "...H....................H..........H....",
    "########################################",
]
W, H = 40, len(MAP)
WALK, DROP, JUMP, LADDER = range(4)

def t(y, x):
    if x < 0 or x >= W or y < 0:
        return '.'
    return '#' if y >= H else MAP[y][x]

def standable(y, x):
    if not (0 <= y < H - 1 and 0 <= x < W) or t(y, x) == '#':
        return False
    return t(y + 1, x) == '#' or (t(y + 1, x) == 'H' and t(y, x) != 'H')

areas, area_at = [], {}
for y in range(H):
    x = 0
    while x < W:
        if not standable(y, x):
            x += 1
            continue
        x0 = x
        while x < W and standable(y, x):
            area_at[(y, x)] = len(areas)
            x += 1
        areas.append((y, x0, x - 1))

def fall_from(y, x):
    if not 0 <= x < W or t(y, x) != '.':
        return None
    while not standable(y, x):
        y += 1
        if y >= H - 1 or t(y, x) != '.':
            return None
    return y

links = []                                # (from, to, type, sx, ex, ey, cost)
for a, (y, x0, x1) in enumerate(areas):
    for sx, d in ((x1, 1), (x0, -1)):
        x = sx + d
        land = fall_from(y, x)
        if land is not None and land > y:
            b = area_at[(land, x)]
            if land == y + 1:
                links += [(a, b, WALK, sx, x, land, 1), (b, a, WALK, x, sx, y, 1)]
            else:
                links.append((a, b, DROP, sx, x, land, land - y + 1))
        if d == 1:
            for gap in (1, 2):
                bx = x1 + gap + 1
                if (y, bx) in area_at and all(t(y - 1, i) == '.' for i in range(x1, bx + 1)) \
                        and all(t(y, i) == '.' for i in range(x1 + 1, bx)):
                    b = area_at[(y, bx)]
                    links += [(a, b, JUMP, x1, bx, y, gap + 2), (b, a, JUMP, bx, x1, y, gap + 2)]
                    break
    for x in range(x0, x1 + 1):
        if t(y + 1, x) == 'H':
            yb = y + 1
            while t(yb + 1, x) == 'H':
                yb += 1
            if (yb, x) in area_at:
                b = area_at[(yb, x)]
                links += [(a, b, LADDER, x, x, yb, yb - y), (b, a, LADDER, x, x, y, yb - y)]

N, INF = len(areas), 255
dist = [[0 if i == j else INF for j in range(N)] for i in range(N)]
for f, to, *_, c in links:
    dist[f][to] = min(dist[f][to], c)
for k in range(N):
    for i in range(N):
        for j in range(N):
            dist[i][j] = min(dist[i][j], dist[i][k] + dist[k][j])
nextlink = [[next((li for li, l in enumerate(links) if l[0] == i and dist[l[1]][j] < INF
                   and l[6] + dist[l[1]][j] == dist[i][j]), 255) if i != j else 255
             for j in range(N)] for i in range(N)]

def step(tr, cx, cy):
    ty, sx, ex, ey = tr
    d = (ex > sx) - (ex < sx)
    if ty == WALK:
        return ex, ey
    if ty == LADDER:
        return cx, cy + (1 if ey > cy else -1)
    if ty == DROP:
        return (ex, cy) if cx != ex else (cx, cy + 1)
    if cy == ey and cx == sx:              # jump: up and over, across, down
        return cx + d, cy - 1
    return (cx + d, cy) if cx != ex else (cx, cy + 1)

def sim(start=(1, 20), wps=((34, 2), (4, 20), (32, 15), (10, 2), (13, 10), (7, 14), (26, 6), (38, 20))):
    (cx, cy), wp, tr = start, 0, None
    trail, steps, queries = {start}, 0, 0
    while True:
        px, py = wps[wp]
        if tr:
            cx, cy = step(tr, cx, cy)
        elif area_at[(cy, cx)] == area_at[(py, px)]:
            cx += (px > cx) - (px < cx)
        else:
            queries += 1
            _, _, ty, sx, ex, ey, _ = links[nextlink[area_at[(cy, cx)]][area_at[(py, px)]]]
            if cx != sx:
                cx += (sx > cx) - (sx < cx)
            else:
                tr = (ty, sx, ex, ey)
                cx, cy = step(tr, cx, cy)
        if tr and (cx, cy) == tr[2:]:
            tr = None
        steps += 1
        trail.add((cx, cy))
        if not tr and (cx, cy) == (px, py):
            wp += 1
            if wp == len(wps):
                return trail, steps, queries, (cx, cy)

if __name__ == '__main__':
    print(N, 'areas,', len(links), 'links')
    for i in range(N):
        print(', '.join('%3d' % (links[nextlink[i][j]][1] if nextlink[i][j] != 255 else 255)
                        for j in range(N)) + ',')
    trail, steps, queries, end = sim()
    print('steps', steps, 'queries', queries, 'end', end, 'trail cells', len(trail))
```

## Expected output

Black background. Rows 0 to 2 are the HUD. Below them the level: green
platforms, orange ladders (`H`), a cyan trail of dots over every cell
the chaser passed through (ladder cells it climbed turn cyan), and the
chaser, a white ball, at the bottom right on column 38 of screen row 23.
The player marker (a yellow heart) is under the chaser at the end, so it
does not show.

The route uses all four link types: 138 of the 160 queries chose a
ladder, 9 a walk (the one-row step between the platform at map row 14
and the one at row 15), 7 a jump and 6 a drop (counted by the model).

HUD at 26,000,000 cycles (measured in VICE x64sc 3.10, decoded against
the character ROM):

| Row | PAL | NTSC |
|---|---|---|
| 0 | `BUILD 0703502  SEARCH 016061  N 12 43` | `BUILD 0709939  SEARCH 016134  N 12 43` |
| 1 | `QRY 00154 LOS 00369 AR 407948 NX 105602` | `QRY 00154 LOS 00369 AR 411726 NX 106063` |
| 2 | `ST 299 Q 160 BAD 000 MIS 000 LOS 4 R 10` | same |

`BUILD` is the whole start-up in cycles; `SEARCH` the worst of the
twelve single-destination searches; `AR` the area and link pass; `NX`
the next-hop pass. `QRY` and `LOS` are the worst query and the worst
ray step over the run. `ST` and `Q` are chaser steps and table queries,
equal to the model's 299 and 160. `BAD` counts hops that differed from
the compiled table, `MIS` table entries that differed, `LOS 4` the four
ray tests that gave the expected answer, `R 10` result code 1, fault 0.
The border is green: (98, 213, 50) on PAL, (114, 189, 103) on NTSC.

The build differs between models because the screen is on while it
runs. The 25 badlines of a frame steal the same cycles on both models,
a larger share of NTSC's 17,095-cycle frame than of PAL's 19,656, and
the CIA counts the stolen cycles (arithmetic, rung 3; not separated by
measurement here). The per-frame figures are identical because
they run after `vic_waitFrame()` returns, in the vertical blank. The
empty timer pair reads 5 cycles and the chained pair 17 (measured in a
separate build); the figures include them.

Screenshots at 26,000,000 cycles, both after the verdict and each
identical over two runs: `screenshots/nav-area-pathfinding.png` (PAL)
and `screenshots/nav-area-pathfinding-ntsc.png` (NTSC). Measured on both
with PIL: every map cell holding a cyan pixel, plus the one holding
white, is the set of cells the model's chaser visited, 156 cells with
none missing and none extra, and the white cell is (38, 20) in map
coordinates, the model's end position. The script:

```python
from PIL import Image
import nav_model
def visited(png, ntsc):
    cyan = (138, 230, 203) if ntsc else (126, 243, 214)
    top = 23 if ntsc else 35                 # PNG row of text row 0
    px = Image.open(png).convert('RGB').load()
    cells = set()
    for y in range(22):                      # map row y is screen row y + 3
        for x in range(40):
            cols = {px[32 + 8 * x + i, top + 8 * (y + 3) + j]
                    for i in range(8) for j in range(8)}
            if cyan in cols or (255, 255, 255) in cols:
                cells.add((x, y))
    return cells
assert visited('nav-area-pathfinding.png', False) == nav_model.sim()[0]
```

## Why this works

The area graph is small because a platform game's walkable space is
mostly runs of floor. Twelve areas replace 880 map cells, so a search
touches twelve nodes and 43 links instead of hundreds of cells, and a
table of every answer is 144 bytes (the listing pads the stride to 16,
256 bytes, so the index is one table multiply). A standing actor then needs two
cell lookups and one table read per decision, 154 cycles here, where
one run-time search costs about 16,000. The build runs once at level
load, about 36 PAL frames here, most of it the cell-by-cell area pass.

The link rules carry the movement model. An area's end cell leads to a
fall; a one-row fall is a walk both ways, a longer one a one-way drop.
A gap of one or two cells to an area on the same row is a jump both
ways. A ladder joins the area over its top rung to the area at its
foot. The actor walks inside its area to the link's start cell and then
plays the link cell by cell, so the route chosen at the area level is
the route drawn on screen.

Link costs count cells moved during the link only; walking inside an
area is free to the search. That keeps the table exact for the graph
but lets a route cross a wide platform to save one cell of ladder. A
game that cares adds the walk from entry to exit, which needs areas
split at link points. The lowest-numbered link on a shortest route
breaks ties, the same rule in C and Python, so the two tables agree
byte for byte.

The line-of-sight ray steps one cell per call through the map and stops
at the first solid cell or the target. Spread over frames, one ray step
costs at most 369 cycles; the test pairs are straight rows and columns,
whose answer does not depend on the line algorithm.
