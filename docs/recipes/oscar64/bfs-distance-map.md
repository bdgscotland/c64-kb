---
recipe: bfs-distance-map
toolchain: oscar64
output_format: PRG
region: both
techniques: [bfs_distance_map]
file_formats: [PRG]
uses_registers: [D011, D020, D021, DC04, DC05, DC06, DC07, DC0E, DC0F]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 BFS Distance Map: one time-sliced flood from the player, four chasers stepping downhill

## Synopsis

A 40 by 22 tile maze, a player that follows a scripted route, and four
chasers that never search. A breadth-first flood from the player's cell
gives every open cell its distance in one byte (255 for a wall or an
unvisited cell). The flood runs from a ring queue, 32 cells per frame,
into a second map; when the queue empties the two maps swap, so the
chasers always read a complete map. A new flood starts when the player
has changed cell since the last one began. Each chaser steps to the
neighbour with the lowest distance every fourth frame, ties broken up,
left, down, right. With `SHOW_DIST 1` every cell shows its distance's
units digit in a colour band as the flood reaches it. The verdict
compares the live map byte for byte with a map computed in Python and
compiled in, then requires all four chasers to reach the player's cell
within a bounded number of frames with no step onto a wall. `$02FF` =
`01` and a green border on pass, `02` and red on fail. This is the
`bfs_distance_map` technique in `docs/techniques/logic.md`; the
result-byte contract is `headless-verify.md`.

## Source

```c
// bfs-distance-map.c
//
// A breadth-first flood over a 40 by 22 tile maze gives every open cell
// its distance from the player, one byte per cell, 255 for a wall or an
// unvisited cell. The flood runs from a ring queue, SLICE cells per
// frame, into a work map; when the queue empties the work map becomes
// the live map the chasers read. A new flood starts when the player has
// changed cell since the last one began. Four chasers step to the
// neighbour with the lowest distance every CHASE_EVERY frames, ties
// broken up, left, down, right. The player follows a scripted route,
// one cell every PLAYER_EVERY frames, then stops.
// Verdict: after the player stops and the next flood completes, the
// live map is compared byte for byte with a map computed in Python and
// compiled in, and its checksum shown; then all four chasers must reach
// the player's cell within MAX_WAIT frames, and no chaser may ever stand
// on a wall. $02FF = 01 and a green border on pass, 02 and red on fail.
// Row 0: worst slice, last full flood, frames per flood, worst chaser
// pass, all CIA1 cycles. Row 1: checksum, mismatches, wall steps,
// frames from the stop to the last arrival, result. Row 2: floods run
// and the worst whole iteration (must stay under one frame).
// SHOW_DIST 1 draws each cell's distance as a digit (units) in a colour
// band as the flood reaches it; 0 leaves the floor as dots.
// Build: oscar64 -tm=c64 -O2 -o=bfs-distance-map.prg bfs-distance-map.c
#include <c64/vic.h>
#include <c64/cia.h>
#include <string.h>

#define SCREEN ((char *)0x0400)
#define COLOUR ((char *)0xd800)
#define RESULT (*(volatile char *)0x02ff)
#define CODE_PASS 0x01
#define CODE_FAIL 0x02

#define SHOW_DIST    1
#define SLICE        32       // cells expanded per frame
#define PLAYER_EVERY 2        // frames per player cell
#define CHASE_EVERY  4        // frames per chaser cell
#define MAX_WAIT     400      // frames allowed after the player stops
#define NCHASE       4

// Map rows 0-21 are screen rows 3-24. '#' wall, '.' open.
#define MAP_ROW0 3
#define MW 40
#define MH 22
#define UNSEEN 255
const char maze[MH][MW + 1] = {
    "########################################",   //  0
    "#........#........#..........#........##",   //  1
    "#.######.#.######.#.########.#.######.##",   //  2
    "#.#......#.#....#.#........#.#.#......##",   //  3
    "#.#.########.##.#.########.#.#.#.###.###",   //  4
    "#.#..........#..#..........#...#...#...#",   //  5
    "#.##########.#.###########.#####.#.#####",   //  6
    "#............#.............#.....#.....#",   //  7
    "######.#######.###########.#.#####.###.#",   //  8
    "#......#.......#...........#.#.......#.#",   //  9
    "#.######.#####.#.#########.#.#.#####.#.#",   // 10
    "#........#.....#.#.......#...#.#...#...#",   // 11
    "#.########.#####.#.#####.#####.#.#.###.#",   // 12
    "#.#........#.....#.#...#.......#.#.....#",   // 13
    "#.#.########.#####.#.#.#########.#####.#",   // 14
    "#.#........#.......#.#...........#.....#",   // 15
    "#.########.#########.#.#########.#.###.#",   // 16
    "#..........#.........#.........#.#...#.#",   // 17
    "#.#########.#########...#######.#.....##",   // 18
    "#.........#...........#.......#...#.#..#",   // 19
    "#.#######.#.#########.#######.#####.####",   // 20
    "########################################",   // 21
};

// The player's route: one letter per cell moved.
#define START_X 1
#define START_Y 1
const char route[] = "DDDDDDRRRRRRRRRRRUUUURRRDDLDDRRRRRRRRRRRRDDLLLLLLLLLL";

// Chaser start cells.
const char start_cx[NCHASE] = { 37,  1, 38, 14 };
const char start_cy[NCHASE] = {  1, 20, 19, 11 };

// Expected distance map from the player's final cell (16, 9), computed
// by bfs_model.py (Python, plain BFS). Checksum $C077.
#define EXP_SUM 0xc077
const char exp_map[MH * MW] = {
    255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
    255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
    255,  53,  54,  55,  56,  55,  54,  53,  52, 255,  34,  33,  32,  31,  30,  29,  28,  27, 255,  25,
     26,  27,  28,  29,  30,  31,  32,  33,  34, 255,  40,  39,  38,  37,  36,  35,  34,  33, 255, 255,
    255,  52, 255, 255, 255, 255, 255, 255,  51, 255,  35, 255, 255, 255, 255, 255, 255,  26, 255,  24,
    255, 255, 255, 255, 255, 255, 255, 255,  35, 255,  41, 255, 255, 255, 255, 255, 255,  32, 255, 255,
    255,  51, 255,  45,  46,  47,  48,  49,  50, 255,  36, 255,  32,  31,  30,  29, 255,  25, 255,  23,
     22,  21,  20,  19,  18,  17,  16, 255,  36, 255,  42, 255,  26,  27,  28,  29,  30,  31, 255, 255,
    255,  50, 255,  44, 255, 255, 255, 255, 255, 255, 255, 255,  33, 255, 255,  28, 255,  24, 255, 255,
    255, 255, 255, 255, 255, 255,  15, 255,  37, 255,  41, 255,  25, 255, 255, 255,  31, 255, 255, 255,
    255,  49, 255,  43,  42,  41,  40,  39,  38,  37,  36,  35,  34, 255,  26,  27, 255,  23,  22,  21,
     20,  19,  18,  17,  16,  15,  14, 255,  38,  39,  40, 255,  24,  25,  26, 255,  32,  33,  34, 255,
    255,  48, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,  35, 255,  25, 255, 255, 255, 255, 255,
    255, 255, 255, 255, 255, 255,  13, 255, 255, 255, 255, 255,  23, 255,  27, 255, 255, 255, 255, 255,
    255,  47,  46,  45,  44,  43,  42,  41,  40,  39,  38,  37,  36, 255,  24,  23,  22,  21,  20,  19,
     18,  17,  16,  15,  14,  13,  12, 255,  18,  19,  20,  21,  22, 255,  28,  29,  30,  31,  32, 255,
    255, 255, 255, 255, 255, 255,  43, 255, 255, 255, 255, 255, 255, 255,  25, 255, 255, 255, 255, 255,
    255, 255, 255, 255, 255, 255,  11, 255,  17, 255, 255, 255, 255, 255,  29, 255, 255, 255,  33, 255,
    255,  43,  44,  45,  46,  45,  44, 255,  32,  31,  30,  29,  28,  27,  26, 255,   0,   1,   2,   3,
      4,   5,   6,   7,   8,   9,  10, 255,  16, 255,  34,  33,  32,  31,  30,  31,  32, 255,  34, 255,
    255,  42, 255, 255, 255, 255, 255, 255,  33, 255, 255, 255, 255, 255,  27, 255,   1, 255, 255, 255,
    255, 255, 255, 255, 255, 255,  11, 255,  15, 255,  35, 255, 255, 255, 255, 255,  33, 255,  35, 255,
    255,  41,  40,  39,  38,  37,  36,  35,  34, 255,  32,  31,  30,  29,  28, 255,   2, 255,  20,  21,
     22,  23,  24,  25,  26, 255,  12,  13,  14, 255,  36, 255,  46,  45,  44, 255,  34,  35,  36, 255,
    255,  42, 255, 255, 255, 255, 255, 255, 255, 255,  33, 255, 255, 255, 255, 255,   3, 255,  19, 255,
    255, 255, 255, 255,  27, 255, 255, 255, 255, 255,  35, 255,  47, 255,  43, 255, 255, 255,  37, 255,
    255,  43, 255,  41,  40,  39,  38,  37,  36,  35,  34, 255,   8,   7,   6,   5,   4, 255,  18, 255,
     64,  63,  62, 255,  28,  29,  30,  31,  32,  33,  34, 255,  48, 255,  42,  41,  40,  39,  38, 255,
    255,  44, 255,  42, 255, 255, 255, 255, 255, 255, 255, 255,   9, 255, 255, 255, 255, 255,  17, 255,
     65, 255,  61, 255, 255, 255, 255, 255, 255, 255, 255, 255,  49, 255, 255, 255, 255, 255,  39, 255,
    255,  45, 255,  43,  44,  45,  46,  47,  48,  49,  50, 255,  10,  11,  12,  13,  14,  15,  16, 255,
     66, 255,  60,  59,  58,  57,  56,  55,  54,  53,  52,  51,  50, 255,  44,  43,  42,  41,  40, 255,
    255,  46, 255, 255, 255, 255, 255, 255, 255, 255,  51, 255, 255, 255, 255, 255, 255, 255, 255, 255,
     67, 255,  61, 255, 255, 255, 255, 255, 255, 255, 255, 255,  51, 255,  45, 255, 255, 255,  41, 255,
    255,  47,  48,  49,  50,  51,  52,  53,  54,  53,  52, 255,  76,  75,  74,  73,  72,  71,  70,  69,
     68, 255,  62,  63,  64,  65,  66,  67,  68,  69,  70, 255,  52, 255,  46,  47,  48, 255,  42, 255,
    255,  48, 255, 255, 255, 255, 255, 255, 255, 255, 255,  76, 255, 255, 255, 255, 255, 255, 255, 255,
    255,  64,  63,  64, 255, 255, 255, 255, 255, 255, 255,  52, 255,  48,  47,  48,  49,  50, 255, 255,
    255,  49,  50,  51,  52,  53,  54,  55,  56,  57, 255,  75,  74,  73,  72,  71,  70,  69,  68,  67,
     66,  65, 255,  65,  66,  67,  68,  69,  70,  71, 255,  51,  50,  49, 255,  49, 255,  51,  52, 255,
    255,  50, 255, 255, 255, 255, 255, 255, 255,  58, 255,  76, 255, 255, 255, 255, 255, 255, 255, 255,
    255,  66, 255, 255, 255, 255, 255, 255, 255,  72, 255, 255, 255, 255, 255,  50, 255, 255, 255, 255,
    255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
    255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
};

// --- distance maps and the ring queue ---------------------------------------
char solid[MH * MW];                       // 1 where the maze has a wall
char map_a[MH * MW], map_b[MH * MW];
char *live = map_a;                        // complete map the chasers read
char *work = map_b;                        // map the flood is writing
unsigned row_off[MH];

char qx[256], qy[256];                     // ring queue; byte indices wrap
char qhead, qtail;
bool flood_on;
char flood_px, flood_py;                   // player cell the flood started from
char flood_frames;
unsigned long flood_cycles;

unsigned clear_pos;                        // bytes of work cleared so far
#define CLEAR_CHUNK 440                    // per frame; two frames for the map

// A flood starts with the clear of its work map, CLEAR_CHUNK bytes per
// frame, so the 880-byte clear never shares a frame with a full slice.
// The seed cell is written when the clear is complete.
void flood_begin(char px, char py)
{
    clear_pos = 0;
    flood_px = px; flood_py = py;
    flood_on = true;
    flood_frames = 0;
    flood_cycles = 0;
}

// Digit and colour per distance, built at start: units digit, colour by
// band of eight, 255 shown as a dot in dark grey.
char dig_ch[256], dig_col[256];
const char band_col[8] = { VCOL_WHITE, VCOL_YELLOW, VCOL_LT_GREEN, VCOL_CYAN,
                           VCOL_LT_BLUE, VCOL_PURPLE, VCOL_LT_RED, VCOL_ORANGE };

static inline void try_cell(char x, char y, unsigned o, char d)
{
    if (!solid[o] && work[o] == UNSEEN) {
        work[o] = d;
        qx[qtail] = x; qy[qtail] = y;
        qtail++;
    }
}

// Expand up to SLICE queued cells. Returns true when the flood finished.
bool flood_slice(void)
{
    if (clear_pos < MH * MW) {
        memset(work + clear_pos, UNSEEN, CLEAR_CHUNK);
        clear_pos += CLEAR_CHUNK;
        if (clear_pos == MH * MW) {
            work[row_off[flood_py] + flood_px] = 0;
            qx[0] = flood_px; qy[0] = flood_py;
            qhead = 0; qtail = 1;
        }
        return false;
    }
    char n = 0;
    while (qhead != qtail && n < SLICE) {
        char x = qx[qhead], y = qy[qhead];
        qhead++;
        unsigned o = row_off[y] + x;
        char d = work[o] + 1;
        try_cell(x, y - 1, o - MW, d);
        try_cell(x - 1, y, o - 1, d);
        try_cell(x, y + 1, o + MW, d);
        try_cell(x + 1, y, o + 1, d);
#if SHOW_DIST
        SCREEN[o + MAP_ROW0 * 40] = dig_ch[d - 1];
        COLOUR[o + MAP_ROW0 * 40] = dig_col[d - 1];
#endif
        n++;
    }
    if (qhead != qtail)
        return false;
    char *t = live; live = work; work = t;
    flood_on = false;
    return true;
}

// --- CIA1 timer B: cycles between start and stop ------------------------------
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

// --- actors -------------------------------------------------------------------
char px, py;
char cx[NCHASE], cy[NCHASE];
char under_ch[NCHASE + 1], under_col[NCHASE + 1];
const char actor_col[NCHASE + 1] = { VCOL_WHITE, VCOL_CYAN, VCOL_LT_RED, VCOL_LT_GREEN, VCOL_YELLOW };
unsigned wall_steps;

// One downhill step: the neighbour with the lowest live distance, only
// if lower than the chaser's own; ties go up, left, down, right.
void chaser_step(char i)
{
    char x = cx[i], y = cy[i];
    unsigned o = row_off[y] + x;
    char best = live[o], bx = x, by = y, d;
    d = live[o - MW]; if (d < best) { best = d; bx = x; by = y - 1; }
    d = live[o - 1];  if (d < best) { best = d; bx = x - 1; by = y; }
    d = live[o + MW]; if (d < best) { best = d; bx = x; by = y + 1; }
    d = live[o + 1];  if (d < best) { best = d; bx = x + 1; by = y; }
    cx[i] = bx; cy[i] = by;
    if (solid[row_off[by] + bx])
        wall_steps++;
}

static inline unsigned cell_off(char x, char y)
{
    return row_off[y] + x + MAP_ROW0 * 40;
}

void actors_lift(void)
{
    for (char i = 0; i < NCHASE; i++) {
        unsigned o = cell_off(cx[i], cy[i]);
        SCREEN[o] = under_ch[i]; COLOUR[o] = under_col[i];
    }
    unsigned o = cell_off(px, py);
    SCREEN[o] = under_ch[NCHASE]; COLOUR[o] = under_col[NCHASE];
}

void actors_draw(void)
{
    unsigned o = cell_off(px, py);
    under_ch[NCHASE] = SCREEN[o]; under_col[NCHASE] = COLOUR[o];
    SCREEN[o] = 0x53; COLOUR[o] = actor_col[NCHASE];        // heart
    for (char i = 0; i < NCHASE; i++) {
        o = cell_off(cx[i], cy[i]);
        under_ch[i] = SCREEN[o]; under_col[i] = COLOUR[o];
        SCREEN[o] = 0x51; COLOUR[o] = actor_col[i];         // ball
    }
}

// --- HUD ----------------------------------------------------------------------
// Indexed on purpose: with the pointer-walking form (*p++ = *s++) Oscar64
// 1.32.271 at -O2 inlined the first call of this program without
// clearing Y, so its label landed 40-odd cells away (seen in the listing:
// no LDY #0 before the first STA (zp),y loop; the second call had one).
void put_str(char *p, const char *s)
{
    for (char i = 0; s[i]; i++)
        p[i] = s[i];
}

void put_dec(char *p, unsigned long v, char digits)
{
    for (char i = digits; i > 0; i--) {
        p[i - 1] = 0x30 + (char)(v % 10);
        v /= 10;
    }
}

void put_hex(char *p, unsigned v)
{
    for (char i = 4; i > 0; i--) {
        char n = v & 15;
        p[i - 1] = n < 10 ? 0x30 + n : 0x01 + n - 10;
        v >>= 4;
    }
}

unsigned checksum(const char *m)
{
    char a = 0, c = 0;
    for (unsigned i = 0; i < MH * MW; i++) {
        a += m[i];
        c += a;
    }
    return ((unsigned)c << 8) | a;
}

int main(void)
{
    __asm { sei }
    vic.color_border = VCOL_BLACK;
    vic.color_back = VCOL_BLACK;
    memset(SCREEN, 0x20, 1000);
    memset(COLOUR, VCOL_LT_GREY, 1000);
    for (char y = 0; y < MH; y++)
        row_off[y] = (unsigned)y * MW;
    for (unsigned i = 0; i < 256; i++) {
        dig_ch[i] = 0x30 + (char)(i % 10);
        dig_col[i] = band_col[(i >> 3) & 7];
    }
    dig_ch[UNSEEN] = 0x2e; dig_col[UNSEEN] = VCOL_DARK_GREY;
    memset(map_a, UNSEEN, MH * MW);
    for (char y = 0; y < MH; y++)
        for (char x = 0; x < MW; x++) {
            unsigned o = cell_off(x, y);
            bool wall = maze[y][x] == '#';
            solid[row_off[y] + x] = wall;
            if (wall) { SCREEN[o] = 0xa0; COLOUR[o] = VCOL_BLUE; }
            else { SCREEN[o] = 0x2e; COLOUR[o] = VCOL_DARK_GREY; }
        }

    put_str(SCREEN,      s"sl       fl         fr    ch");
    put_str(SCREEN + 40, s"sum      mis     wall     t      r");
    put_str(SCREEN + 80, s"floods     it");

    px = START_X; py = START_Y;
    for (char i = 0; i < NCHASE; i++) { cx[i] = start_cx[i]; cy[i] = start_cy[i]; }
    actors_draw();

    unsigned frame = 0, t_slice = 0, t_chase = 0, floods = 0, wait = 0, t_it = 0;
    unsigned long t_flood = 0;
    char fr_flood = 0, ri = 0, fault = 0;
    unsigned mismatch = 0, sum = 0;
    bool stopped = false, checked = false, done = false, hud = false;

    for (;;) {
        vic_waitFrame();
        if (done)
            continue;
        frame++;
        cia1.cra = 0x00; cia1.ta = 0xffff; cia1.cra = 0x11;   // timer A: whole iteration
        actors_lift();

        // Flood: continue the slice in progress, or start one if the
        // player has moved since the last began.
        if (!flood_on && (px != flood_px || py != flood_py || floods == 0)) {
            flood_begin(px, py);
            floods++;
        }
        if (flood_on) {
            flood_frames++;
            timer_start();
            bool fin = flood_slice();
            unsigned t = timer_stop();
            if (t > t_slice) t_slice = t;
            flood_cycles += t;
            if (fin) {
                t_flood = flood_cycles;
                fr_flood = flood_frames;
                hud = true;
            }
        }

        // Player along the route, then stop.
        if (!stopped && (frame % PLAYER_EVERY) == 0) {
            char c = route[ri];
            if (c == 0)
                stopped = true;
            else {
                if (c == 'U') py--;
                else if (c == 'D') py++;
                else if (c == 'L') px--;
                else px++;
                ri++;
            }
        }

        // Chasers downhill on the live map.
        if ((frame % CHASE_EVERY) == 0) {
            timer_start();
            for (char i = 0; i < NCHASE; i++)
                chaser_step(i);
            unsigned t = timer_stop();
            if (t > t_chase) t_chase = t;
        }
        actors_draw();
        cia1.cra = 0x00;
        unsigned t_this = 0xffff - cia1.ta;
        if (t_this > t_it) t_it = t_this;

        // HUD, outside the timed work; the 32-bit decimal print is slow.
        if (hud) {
            hud = false;
            put_dec(SCREEN + 3, t_slice, 5);
            put_dec(SCREEN + 12, t_flood, 7);
            put_dec(SCREEN + 23, fr_flood, 2);
            put_dec(SCREEN + 29, t_chase, 4);
            put_dec(SCREEN + 87, floods, 3);
            put_dec(SCREEN + 94, t_it, 5);
        }

        // Verdict.
        if (stopped) {
            wait++;
            if (!checked && !flood_on && flood_px == px && flood_py == py) {
                checked = true;
                for (unsigned i = 0; i < MH * MW; i++)
                    if (live[i] != exp_map[i]) mismatch++;
                sum = checksum(live);
                put_hex(SCREEN + 44, sum);
                put_dec(SCREEN + 53, mismatch, 3);
            }
            char here = 0;
            for (char i = 0; i < NCHASE; i++)
                if (cx[i] == px && cy[i] == py) here++;
            if (checked && (here == NCHASE || wait > MAX_WAIT)) {
                done = true;
                if (mismatch || sum != EXP_SUM) fault = 1;
                else if (wall_steps) fault = 2;
                else if (here != NCHASE) fault = 3;
                put_dec(SCREEN + 62, wall_steps, 3);
                put_dec(SCREEN + 68, wait, 4);
                char code = fault ? CODE_FAIL : CODE_PASS;
                RESULT = code;
                vic.color_border = fault ? VCOL_RED : VCOL_GREEN;
                SCREEN[75] = 0x30 + code;
                SCREEN[76] = 0x30 + fault;
            }
        }
    }
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=bfs-distance-map.prg bfs-distance-map.c
```

Oscar64 1.32.271 builds it with no warnings; the PRG is 4,952 bytes.

The expected map and its checksum come from this script (Python 3),
which floods the same maze from the route's last cell with a plain
queue. It prints `route 53 steps, ends at (16, 9); open cells 404,
popped 404`, `max distance 76; checksum $C077`, the four chasers' start
distances (33, 50, 52, 28) and the `exp_map` initialiser the listing
compiles in.

```text
# bfs_model.py: the reference for bfs-distance-map.c. Same maze, same
# route, a plain breadth-first flood from the player's final cell. Prints
# the expected distance map as C initialisers and its checksum.
from collections import deque

MAZE = [
    "########################################",  #  0
    "#........#........#..........#........##",  #  1
    "#.######.#.######.#.########.#.######.##",  #  2
    "#.#......#.#....#.#........#.#.#......##",  #  3
    "#.#.########.##.#.########.#.#.#.###.###",  #  4
    "#.#..........#..#..........#...#...#...#",  #  5
    "#.##########.#.###########.#####.#.#####",  #  6
    "#............#.............#.....#.....#",  #  7
    "######.#######.###########.#.#####.###.#",  #  8
    "#......#.......#...........#.#.......#.#",  #  9
    "#.######.#####.#.#########.#.#.#####.#.#",  # 10
    "#........#.....#.#.......#...#.#...#...#",  # 11
    "#.########.#####.#.#####.#####.#.#.###.#",  # 12
    "#.#........#.....#.#...#.......#.#.....#",  # 13
    "#.#.########.#####.#.#.#########.#####.#",  # 14
    "#.#........#.......#.#...........#.....#",  # 15
    "#.########.#########.#.#########.#.###.#",  # 16
    "#..........#.........#.........#.#...#.#",  # 17
    "#.#########.#########...#######.#.....##",  # 18
    "#.........#...........#.......#...#.#..#",  # 19
    "#.#######.#.#########.#######.#####.####",  # 20
    "########################################",  # 21
]
W, H = 40, 22
UNSEEN = 255

# The player's scripted route: start cell, then one letter per cell moved.
START = (1, 1)
ROUTE = "DDDDDDRRRRRRRRRRRUUUURRRDDLDDRRRRRRRRRRRRDDLLLLLLLLLL"
CHASERS = [(37, 1), (1, 20), (38, 19), (14, 11)]
DIRS = [(0, -1), (-1, 0), (0, 1), (1, 0)]     # up, left, down, right (tie order)


def check_maze():
    assert len(MAZE) == H
    for r in MAZE:
        assert len(r) == W, (len(r), r)
        assert set(r) <= {"#", "."}
        assert r[0] == "#" and r[-1] == "#"
    assert MAZE[0] == "#" * W and MAZE[-1] == "#" * W


def walk(start, route):
    x, y = start
    cells = [(x, y)]
    for c in route:
        dx, dy = {"U": (0, -1), "L": (-1, 0), "D": (0, 1), "R": (1, 0)}[c]
        x, y = x + dx, y + dy
        assert MAZE[y][x] == ".", ("route hits wall at", x, y)
        cells.append((x, y))
    return cells


def flood(px, py):
    d = [[UNSEEN] * W for _ in range(H)]
    d[py][px] = 0
    q = deque([(px, py)])
    popped = 0
    while q:
        x, y = q.popleft()
        popped += 1
        for dx, dy in DIRS:
            nx, ny = x + dx, y + dy
            if MAZE[ny][nx] == "." and d[ny][nx] == UNSEEN:
                d[ny][nx] = d[y][x] + 1
                q.append((nx, ny))
    return d, popped


def checksum(d):
    # two running byte sums: a += byte, c += a, both mod 256; result c:a
    a = c = 0
    for y in range(H):
        for x in range(W):
            a = (a + d[y][x]) & 0xFF
            c = (c + a) & 0xFF
    return (c << 8) | a


def main():
    check_maze()
    cells = walk(START, ROUTE)
    px, py = cells[-1]
    d, popped = flood(px, py)
    open_cells = sum(r.count(".") for r in MAZE)
    print(f"route {len(ROUTE)} steps, ends at ({px}, {py}); open cells {open_cells}, popped {popped}")
    print(f"max distance {max(v for r in d for v in r if v != UNSEEN)}; checksum ${checksum(d):04X}")
    for cx, cy in CHASERS:
        assert MAZE[cy][cx] == "."
        print(f"chaser ({cx}, {cy}) distance {d[cy][cx]}")
    print("const char exp_map[MH * MW] = {")
    for y in range(H):
        for half in (0, 20):
            print("    " + ", ".join(f"{v:3d}" for v in d[y][half:half + 20]) + ",")
    print("};")


if __name__ == "__main__":
    main()
```

One Oscar64 fault shaped the listing. With `put_str` written as
`while (*s) *p++ = *s++;`, Oscar64 1.32.271 at `-O2` inlined the first
call in `main` without an `LDY #0` before its `STA (zp),y` loop, so the
first HUD label landed wherever the maze loop had left Y; the second and
third calls got the `LDY`. The listing's indexed form
(`p[i] = s[i]`) compiles correctly. Seen in the `.asm` listing and on
screen; not reduced to a minimal case here.

## Expected output

Black background, blue wall blocks, and after the first flood every open
cell shows a digit, the units digit of its distance from the player,
coloured by band of eight: white 0 to 7, yellow 8 to 15, light green,
cyan, light blue, purple, light red, orange, then white again from 64.
The player is a yellow heart, the chasers are balls in white, cyan,
light red and light green. Rows 0 to 2 are the HUD.

At the pinned 6,500,000 cycles the player has finished its route and
stands at (16, 9) (screen row 12, column 16); the last flood is complete
and the chasers are closing in, one of them already on the player's
cell on NTSC. The HUD reads (measured in VICE x64sc 3.10, decoded
against the character ROM):

| Row | PAL | NTSC |
|---|---|---|
| 0 | `SL 10655 FL 0140341 FR 15 CH 1220` | `SL 10915 FL 0144026 FR 15 CH 1220` |
| 1 | `SUM C077 MIS 000 WALL     T      R` | same |
| 2 | `FLOODS 009 IT 13196` | `FLOODS 009 IT 13456` |

`SL` is the worst flood slice in CIA1 cycles (32 cells expanded and
drawn), `FL` the last complete flood (the sum of its slices), `FR` the
frames it took (two clearing the work map, thirteen expanding), `CH` the
worst pass of four chaser steps, `IT` the worst whole iteration (lift
actors, flood slice, player, chasers, draw; the HUD prints are outside
it). `SUM` is the live map's checksum, equal to the model's `$C077`, and
`MIS 000` says no byte of the 880 differs from `exp_map`. `WALL`, `T`
and `R` are filled in at the verdict.

Screenshots at 6,500,000 cycles, each identical over two runs:
`screenshots/bfs-distance-map.png` (PAL) and
`screenshots/bfs-distance-map-ntsc.png` (NTSC). Measured with PIL
against the character ROM: every open cell not under an actor shows the
units digit of the model's distance (399 cells on PAL, 400 on NTSC,
none wrong), the actor glyphs cover the rest (five cells on PAL, four on
NTSC where one chaser has arrived), and all 476 wall cells are reverse
blocks. The script:

```text
from PIL import Image
import bfs_model as m
rom = open('chargen-901225-01.bin', 'rb').read()
G = {tuple(rom[c*8:c*8+8]): c for c in range(128)}
def check(png, ntsc):
    top = 23 if ntsc else 35                 # PNG row of text row 0
    px = Image.open(png).convert('RGB').load()
    d, _ = m.flood(*m.walk(m.START, m.ROUTE)[-1])
    ok = bad = 0
    for y in range(22):
        for x in range(40):
            bits = tuple(sum((px[32+8*x+i, top+8*(y+3)+j] != (0, 0, 0)) << (7-i)
                             for i in range(8)) for j in range(8))
            c = G.get(bits)
            if d[y][x] == 255 or c in (0x51, 0x53):
                continue                     # wall, or an actor on top
            if c == 0x30 + d[y][x] % 10: ok += 1
            else: bad += 1
    return ok, bad
assert check('bfs-distance-map.png', False) == (399, 0)
```

The verdict comes 145 frames after the player stops, at about
8,200,000 cycles on PAL. At 9,000,000 cycles both models show
`WALL 000 T 0145 R 10` and a green border, (98, 213, 50) on PAL and
(114, 189, 103) on NTSC, with `$02FF` = `01`: the map matched, no chaser
ever stood on a wall, and all four reached the player's cell.

A build with `SHOW_DIST 0` (no digit drawing) reads `SL 08710 FL
0115912 IT 11246` on PAL and `SL 09010 FL 0119513 IT 11503` on NTSC,
with the same verdict. The NTSC slice is higher on both builds because
the iteration runs past the vertical blank into the badlines, and the
CIA counts the stolen cycles (arithmetic, rung 3; the two models'
figures differ by 260 on the digit build).

## Why this works

One flood serves every chaser. Breadth-first order visits cells in
non-decreasing distance, so the first time a cell is reached its
distance is final and it never needs revisiting: 404 open cells cost
404 pops and at most four neighbour tests each. Every chaser then makes
one decision from four byte reads, 1,220 cycles for all four including
the timer. A per-enemy search would cost the flood again for each one.

Two maps make the slicing safe. The flood writes the work map over
fifteen frames while the chasers read the live map from the previous
flood; the swap is one pointer exchange in the frame the queue empties.
The player moves one cell every two frames, so the live map is at most
about eight cells stale, and a chaser stepping downhill on a slightly
old map still moves toward where the player was, then corrects when the
next map lands. The 880-byte clear of the work map is the first two
frames of each flood, 440 bytes each, so it never shares a frame with
a full 32-cell slice; when it did, the worst iteration was 19,226
cycles, over an NTSC frame.

The ring queue is 256 entries of x and y with byte indices that wrap
on their own. A breadth-first frontier on a 40 by 22 grid stays far
below 256 cells (the whole open set is 404 and the frontier is one or
two rings of it), so no overflow test is needed. Walls are never queued
because `solid` is tested before `work`; walls stay 255 in the map, and
a chaser only moves to a strictly lower value, so it can never pick a
wall or dither between equal cells. The tie order up, left, down, right
is fixed, so two runs make the same picture.

Distances are drawn as the flood pops each cell, one character and one
colour byte per cell, spread over the same frames as the flood; the
field is never redrawn whole.
