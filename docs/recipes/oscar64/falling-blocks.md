---
recipe: falling-blocks
toolchain: oscar64
output_format: PRG
region: both
techniques: [falling_block_rules, joystick_edge_detect, joystick_autorepeat, lfsr_random, text_mode_overlay_render, frame_sync_loop, pal_ntsc_detection]
file_formats: [PRG]
uses_registers: [D011, D012, D020, D021, DC00, DC04, DC05, DC0E]
uses_kernal: []
scaffolds: [action_puzzle]
---

<!-- doc-type: recipe -->

# Oscar64 Falling Blocks: a playable game with its rules checked against a model

## Synopsis

A falling-block game in character mode, written in C: seven pieces,
clockwise rotation with a three-try kick, gravity and delayed auto-shift
from the NES Tetris tables for the region the program finds, soft drop,
lock on landing, line clear with collapse, scoring by lines at once, a
level every 10 lines, a 7-bag randomiser on a 16-bit LFSR, and game over
when a piece cannot spawn. The rules are `falling_block_rules` in
`techniques/logic.md`. The default build (`AUTOPILOT=1`) starts from a
fixed garbage board and plays five scripted pieces through the same
input path a joystick uses: a single, a double, a triple, a four-line
clear that takes the level to 1, DAS moves to both walls, and a J that
kicks one cell left when rotated against the right wall. It then checks
the board, score, lines, level, clear counts, kick count, ten bags and a
blocked spawn against values from the Python model below, checks every
well cell on screen against the board, runs a probe that moves a piece
on the frame it locks, prints PASS or FAIL, and prints the cycles of its
dearest frames and of a worst-frame subject, rules and render timed
apart. `-dAUTOPILOT=0` builds the game for a player: joystick in port
2, fire rotates, down soft-drops, fire starts and restarts. Use it as
the starting point for any Tetris-like game; the autopilot pattern is
`headless-verify.md`.

## Source

```c
// falling-blocks.c
// A falling-block game in character mode: seven pieces, a clockwise
// rotation with a three-try kick, gravity from a frames-per-row table
// chosen by region, delayed auto-shift, soft drop, lock on landing, line
// clear and collapse, scoring by lines at once, a level every 10 lines,
// and a 7-bag randomiser on a 16-bit LFSR.
// AUTOPILOT=1 (default) starts from a fixed garbage board, plays five
// scripted pieces through the same input path a joystick uses, and
// checks the board, score, lines, level, clears, kick, bag and spawn
// test against a Python model, and the screen against the board.
// AUTOPILOT=0 is the game: joystick port 2, fire rotates, down
// soft-drops, fire starts and restarts.
// Every game frame is timed with CIA1 timer A (KERNAL IRQ off).
#include <c64/vic.h>
#include <c64/cia.h>

#ifndef AUTOPILOT
#define AUTOPILOT 1
#endif

#define W   10
#define H   20
#define BX  15                        // board's left column on screen
#define BY  2                         // board's top row on screen
#define SCR ((char *)0x0400)
#define CRAM ((char *)0xd800)
#define RESULT (*(volatile char *)0x02ff)

#define J_DOWN  0x02
#define J_LEFT  0x04
#define J_RIGHT 0x08
#define J_FIRE  0x10

// --- rules data ---------------------------------------------------------
// Cells of each piece in a 4x4 box, clockwise rotations 0-3.
// Order I O T S Z J L; I, S, Z repeat their two states, O its one.
static const char cx[7][4][4] = {
    {{0,1,2,3},{2,2,2,2},{0,1,2,3},{2,2,2,2}},
    {{1,2,1,2},{1,2,1,2},{1,2,1,2},{1,2,1,2}},
    {{0,1,2,1},{1,0,1,1},{1,0,1,2},{1,1,2,1}},
    {{1,2,0,1},{1,1,2,2},{1,2,0,1},{1,1,2,2}},
    {{0,1,1,2},{2,1,2,1},{0,1,1,2},{2,1,2,1}},
    {{0,1,2,2},{1,1,0,1},{0,0,1,2},{1,2,1,1}},
    {{0,1,2,0},{0,1,1,1},{2,0,1,2},{1,1,1,2}}
};
static const char cy[7][4][4] = {
    {{1,1,1,1},{0,1,2,3},{1,1,1,1},{0,1,2,3}},
    {{0,0,1,1},{0,0,1,1},{0,0,1,1},{0,0,1,1}},
    {{1,1,1,2},{0,1,1,2},{0,1,1,1},{0,1,1,2}},
    {{1,1,2,2},{0,1,1,2},{1,1,2,2},{0,1,1,2}},
    {{1,1,2,2},{0,1,1,2},{1,1,2,2},{0,1,1,2}},
    {{1,1,1,2},{0,1,2,2},{0,1,1,1},{0,0,1,2}},
    {{1,1,1,2},{0,0,1,2},{0,1,1,1},{0,1,2,2}}
};
static const signed char kick[3] = { 0, 1, -1 };
static const unsigned points[4] = { 40, 100, 300, 1200 };
// NES Tetris frames per row by level, 0-29 (tetris.wiki); 29+ holds.
static const char grav_ntsc[30] = { 48,43,38,33,28,23,18,13,8,6, 5,5,5,4,4,4,3,3,3,
                                    2,2,2,2,2,2,2,2,2,2, 1 };
static const char grav_pal[30]  = { 36,32,29,25,22,18,15,11,7,5, 4,4,4,3,3,3,2,2,2,
                                    1,1,1,1,1,1,1,1,1,1, 1 };
static const char colours[9] = { 0, 3, 7, 4, 5, 2, 14, 8, 11 };

// --- state --------------------------------------------------------------
static char board[H * W];             // 0 empty, 1-7 piece, 8 garbage
static char rowfill[H];               // filled cells per row
static char rowoff[H];                // y * 10
static unsigned scroff[H];            // screen offset of board row y
static char piece, rot, nextp;
static signed char px, py, ox, oy;
static char orot;
static char fall, das_l, das_r, prev_joy = 0xff;
static char level, lines, next_at, pal;
static const char *grav;
static char das_delay, das_rate;
static unsigned long score;
static char clears[4], kicks, dirty;
static char ev_lines;                 // lines cleared this frame, 0 if none
static char locked;                   // a piece locked this frame
static char lk_p, lk_r;               // where it locked
static signed char lk_x, lk_y;
static char top;                      // highest row holding a cell, H if none
static char redraw_a, redraw_b;       // board rows to redraw when dirty

// --- 7-bag on a 16-bit Galois LFSR, taps $B400 ------------------------
static unsigned lfsr = 0xace1;
static char bag[7], bag_n;

static unsigned rnd(void)
{
    char lsb = lfsr & 1;
    lfsr >>= 1;
    if (lsb) lfsr ^= 0xb400;
    return lfsr;
}

static char bag_next(void)
{
    if (bag_n == 0) {
        for (char i = 0; i < 7; i++) bag[i] = i;
        for (char i = 6; i > 0; i--) {         // Fisher-Yates
            char j = rnd() % (i + 1);
            char t = bag[i]; bag[i] = bag[j]; bag[j] = t;
        }
        bag_n = 7;
    }
    return bag[7 - bag_n--];
}

static void draw_piece(char p, char r, signed char x, signed char y, char v);

// --- the rules ----------------------------------------------------------
static char fits(char p, char r, signed char x, signed char y)
{
    const char *xs = cx[p][r], *ys = cy[p][r];
    for (char i = 0; i < 4; i++) {
        char bx = (char)(x + xs[i]), by = (char)(y + ys[i]);
        if (bx >= W || by >= H) return 0;      // unsigned: catches < 0
        if (board[rowoff[by] + bx]) return 0;
    }
    return 1;
}

static char spawn(char p)
{
    piece = p; rot = 0; px = 3; py = 0; fall = 0;
    return fits(piece, rot, px, py);
}

static void rotate(void)
{
    char nr = (rot + 1) & 3;
    for (char k = 0; k < 3; k++)
        if (fits(piece, nr, px + kick[k], py)) {
            rot = nr; px += kick[k];
            if (k) kicks++;
            return;
        }
}

static void clear_lines(void)
{
    char n = 0;
    signed char low = -1;
    for (char i = 0; i < 4; i++) {             // only the rows the piece touched
        char y = py + cy[piece][rot][i];
        if (rowfill[y] == W) {
            if ((signed char)y > low) low = y;
        }
    }
    if (low < 0) return;
    signed char dst = low, t = top;            // rows above top are empty
    for (signed char src = low; src >= t; src--) {   // collapse, lowest full row up
        if (rowfill[src] == W) { n++; continue; }
        if (dst != src) {
            char *d = board + rowoff[dst], *s = board + rowoff[src];
#pragma unroll(full)
            for (char x = 0; x < W; x++) d[x] = s[x];
            rowfill[dst] = rowfill[src];
        }
        dst--;
    }
    for (; dst >= t; dst--) {                  // the n rows vacated at the top
        char *d = board + rowoff[dst];
#pragma unroll(full)
        for (char x = 0; x < W; x++) d[x] = 0;
        rowfill[dst] = 0;
    }
    redraw_a = top; redraw_b = low;            // only these rows changed
    top += n;
    clears[n - 1]++;
    lines += n;
    if (lines >= next_at) { level++; next_at += 10; }
    for (char l = 0; l <= level; l++) score += points[n - 1];   // level after the clear, as NES
    ev_lines = n;
    dirty = 1;
}

static void lock_piece(void)
{
    for (char i = 0; i < 4; i++) {
        char y = py + cy[piece][rot][i];
        char x = px + cx[piece][rot][i];        // in a char first: px can be -2
        board[rowoff[y] + x] = piece + 1;
        rowfill[y]++;
        if (y < top) top = y;
    }
    lk_p = piece; lk_r = rot; lk_x = px; lk_y = py;   // for render: spawn moves piece
    clear_lines();
    locked = 1;
}

// DAS: first step on the press, the second DELAY frames later, then every RATE.
static char das(char *age, char held)
{
    if (!held) { *age = 0; return 0; }
    char a = *age + 1;
    if (a == das_delay + 1 + das_rate) a = das_delay + 1;
    *age = a;
    return a == 1 || a == das_delay + 1;
}

// One game frame. joy is active low, as $DC00 reads it.
static void game_step(char joy)
{
    char pressed = ~joy;
    ev_lines = 0; locked = 0;
    if ((pressed & J_FIRE) && (prev_joy & J_FIRE)) rotate();
    prev_joy = joy;
    if (das(&das_l, pressed & J_LEFT) && fits(piece, rot, px - 1, py)) px--;
    if (das(&das_r, pressed & J_RIGHT) && fits(piece, rot, px + 1, py)) px++;
    char lim = grav[level < 29 ? level : 29];
    if ((pressed & J_DOWN) && lim > 2) lim = 2;     // soft drop, 1/2 G
    if (++fall >= lim) {
        fall = 0;
        if (fits(piece, rot, px, py + 1)) py++;
        else lock_piece();                          // no lock delay
    }
}

// --- drawing ------------------------------------------------------------
static void cell(char x, char y, char v)
{
    unsigned o = scroff[y] + x;
    SCR[o] = v ? 160 : 32;
    CRAM[o] = colours[v];
}

static void draw_piece(char p, char r, signed char x, signed char y, char v)
{
    for (char i = 0; i < 4; i++)
        cell(x + cx[p][r][i], y + cy[p][r][i], v);
}

static const char glyph[9] = { 32, 160, 160, 160, 160, 160, 160, 160, 160 };

static void redraw_rows(char a, char b)
{
    for (char y = a; y <= b; y++) {
        char *s = SCR + scroff[y], *c = CRAM + scroff[y];
        const char *bp = board + rowoff[y];
#pragma unroll(full)
        for (char x = 0; x < W; x++) {
            char v = bp[x];
            s[x] = glyph[v];
            c[x] = colours[v];
        }
    }
}

// Erase the piece where it was drawn and draw it where it is. On a lock
// frame that is the locked piece, which may have moved or rotated in the
// same frame; then redraw the rows a clear changed, then the new piece.
static void render(void)
{
    if (locked) {
        draw_piece(lk_p, orot, ox, oy, 0);
        draw_piece(lk_p, lk_r, lk_x, lk_y, lk_p + 1);
    } else draw_piece(piece, orot, ox, oy, 0);
    if (dirty) { redraw_rows(redraw_a, redraw_b); dirty = 0; }
    draw_piece(piece, rot, px, py, piece + 1);
    ox = px; oy = py; orot = rot;
}

// --- text, timing, frame --------------------------------------------------
static void put_text(char col, char row, const char *s)
{
    char *d = SCR + 40 * row + col;
    char *c = CRAM + 40 * row + col;
    while (*s) {
        char ch = *s++;
        *d++ = (ch >= 'A' && ch <= 'Z') ? ch - 64 : ch;
        *c++ = 1;
    }
}

static void put_num(char col, char row, unsigned long v, char digits)
{
    char *d = SCR + 40 * row + col + digits;
    char *c = CRAM + 40 * row + col;
    for (char i = 0; i < digits; i++) { *--d = '0' + (char)(v % 10); v /= 10; c[i] = 1; }
}

static void put_hex(char col, char row, unsigned v)
{
    static const char hx[] = "0123456789ABCDEF";
    char s[5];
    for (char i = 0; i < 4; i++) { s[3 - i] = hx[v & 15]; v >>= 4; }
    s[4] = 0;
    put_text(col, row, s);
}

static void t_start(void) { cia1.cra = 0x00; cia1.ta = 0xffff; cia1.cra = 0x11; }
static unsigned t_stop(void) { cia1.cra = 0x00; return 0xffff - cia1.ta; }

static void wait_frame(void)
{
    while (vic.raster == 250) ;
    while (vic.raster != 250) ;
}

static char detect_pal(void)                   // does raster line 280 exist?
{
    for (unsigned n = 0; n < 20000; n++)
        if ((vic.ctrl1 & 0x80) && vic.raster == 280 - 256) return 1;
    return 0;
}

static void hud(void)
{
    put_text(27, 3, "SCORE"); put_num(27, 4, score, 6);
    put_text(27, 6, "LINES"); put_num(27, 7, lines, 3);
    put_text(27, 9, "LEVEL"); put_num(27, 10, level, 2);
}

static void setup_screen(void)
{
    vic.color_border = 12; vic.color_back = 0;
    for (unsigned i = 0; i < 1000; i++) { SCR[i] = 32; CRAM[i] = 1; }
    for (char y = 0; y < H; y++) {
        rowoff[y] = y * W;
        scroff[y] = (BY + y) * 40 + BX;
        SCR[scroff[y] - 1] = 160; CRAM[scroff[y] - 1] = 12;   // walls
        SCR[scroff[y] + W] = 160; CRAM[scroff[y] + W] = 12;
    }
    for (char x = 0; x < W + 2; x++) {
        SCR[(BY + H) * 40 + BX - 1 + x] = 160; CRAM[(BY + H) * 40 + BX - 1 + x] = 12;
    }
}

static void new_game(void)
{
    for (char i = 0; i < H * W; i++) board[i] = 0;
    for (char y = 0; y < H; y++) rowfill[y] = 0;
    score = 0; lines = 0; level = 0; next_at = 10; kicks = 0;
    for (char i = 0; i < 4; i++) clears[i] = 0;
    grav = pal ? grav_pal : grav_ntsc;
    das_delay = pal ? 12 : 16;                 // NES PAL / NTSC (tetris.wiki)
    das_rate  = pal ? 4 : 6;
    das_l = das_r = 0; bag_n = 0; dirty = 0; top = H;
}

// --- autopilot: a planner that presses the same bits a player would ------
#if AUTOPILOT
struct Plan { char p, r1; signed char x; char r2; };
static const struct Plan plan[5] = {
    { 0, 0,  6, 0 },     // I flat, three right: single
    { 1, 0,  1, 0 },     // O, two left: double
    { 0, 1, -2, 1 },     // I upright, five left to the wall: triple
    { 0, 1,  7, 1 },     // I upright, four right into the well: four lines, level 1
    { 5, 1,  8, 2 },     // J, five right to the wall, rotate: kicked one left
};
static const char *const garbage[11] = {       // rows 9-19
    "######....", "##..######", "##..######", ".#########", ".#########",
    ".#########", "#########.", "#########.", "#########.", "#########.",
    "#########."
};
#define EXPECT_BOARD 0xecb5    // from the Python model on the page
#define EXPECT_SCORE 2840
#define EXPECT_BAG   0x808a
static char ap_n, ap_phase, ap_tog;

static char autopilot(void)
{
    const struct Plan *p = plan + ap_n;
    char out = 0xff;
    if (ap_phase == 0 || ap_phase == 2) {
        char want = ap_phase ? p->r2 : p->r1;
        if (rot != want) { ap_tog ^= 1; if (ap_tog) out &= ~J_FIRE; }
        else { ap_phase++; ap_tog = 0; }
    }
    if (ap_phase == 1) {
        if (px < p->x) out &= ~J_RIGHT;
        else if (px > p->x) out &= ~J_LEFT;
        else ap_phase = 2;
    }
    if (ap_phase == 3) out &= ~J_DOWN;
    return out;
}

static void load_garbage(void)
{
    for (char r = 0; r < 11; r++)
        for (char x = 0; x < W; x++)
            if (garbage[r][x] == '#') { board[rowoff[9 + r] + x] = 8; rowfill[9 + r]++; }
    top = 9;
}

static unsigned fold(unsigned c, char v) { return (c ^ v) * 5 + 1; }

// Well cells on screen that differ from the board, glyph or colour, with
// the live piece written into the board for the comparison when live.
static char screen_bad(char live)
{
    char bad = 0;
    if (live) for (char i = 0; i < 4; i++) {
        char y = py + cy[piece][rot][i], x = px + cx[piece][rot][i];
        board[rowoff[y] + x] = piece + 1;
    }
    for (char y = 0; y < H; y++) {
        const char *s = SCR + scroff[y], *c = CRAM + scroff[y];
        const char *bp = board + rowoff[y];
        for (char x = 0; x < W; x++) {
            char v = bp[x];
            if (s[x] != glyph[v] || (c[x] & 15) != colours[v]) bad++;
        }
    }
    if (live) for (char i = 0; i < 4; i++) {
        char y = py + cy[piece][rot][i], x = px + cx[piece][rot][i];
        board[rowoff[y] + x] = 0;
    }
    return bad;
}

// Worst-frame subject: a full-height stack, every row open in column 9,
// an upright I locking into the bottom four with fire, left and right
// held, so the three rotation tries and both moves are tested and fail.
// Lock, four-line clear, collapse of sixteen rows and spawn are timed as
// the rules; the redraw of all twenty rows is timed apart as the render.
static unsigned subj_rules, subj_render;
static char worst_subject(void)
{
    new_game();
    for (char y = 0; y < H; y++) {
        for (char x = 0; x < W - 1; x++) board[rowoff[y] + x] = 8;
        rowfill[y] = W - 1;
    }
    top = 0;
    piece = 0; rot = 1; px = 7; py = 16; ox = px; oy = py; orot = rot;
    fall = grav[0] - 1;                        // gravity runs out this frame
    prev_joy = 0xff;
    wait_frame();
    t_start();
    game_step(0xff & ~(J_FIRE | J_LEFT | J_RIGHT));   // all refused, then lock
    spawn(0);
    subj_rules = t_stop();
    t_start();
    render();
    subj_render = t_stop();
    return ev_lines == 4 && top == 4 && screen_bad(1) == 0;
}

// Lock-frame move: an upright I in column 8 is held right on the frame
// gravity locks it, so it moves to column 9 and locks there, completing
// row 16. Rows 17-19 are below the cleared row and are not redrawn; the
// cells drawn in column 8 must still be erased.
static char lock_move_probe(void)
{
    new_game();
    for (char y = 16; y < H; y++) {
        char n = y == 16 ? 9 : 8;
        for (char x = 0; x < n; x++) board[rowoff[y] + x] = 8;
        rowfill[y] = n;
    }
    top = 16;
    redraw_rows(0, H - 1);
    piece = 0; rot = 1; px = 6; py = 16; ox = px; oy = py; orot = rot;
    locked = 0;
    render();                                  // drawn in column 8
    fall = grav[0] - 1; prev_joy = 0xff;
    game_step(0xff & ~J_RIGHT);                // moves to column 9, then locks
    spawn(0);
    render();
    return locked && ev_lines == 1 && screen_bad(1) == 0;
}
#endif

int main(void)
{
    __asm { sei }                              // KERNAL IRQ off: timer A is ours
    pal = detect_pal();
    setup_screen();
    unsigned worst_lock = 0, worst_move = 0, four = 0;

#if AUTOPILOT
    // Randomiser check: ten bags from seed $ACE1, each a permutation.
    unsigned bchk = 0; char bag_ok = 1;
    for (char b = 0; b < 10; b++) {
        char seen = 0;
        for (char i = 0; i < 7; i++) { char v = bag_next(); seen |= 1 << v; bchk = fold(bchk, v); }
        if (seen != 0x7f) bag_ok = 0;
    }
    char subject_ok = worst_subject();
    char probe_ok = lock_move_probe();
    new_game();
    load_garbage();
    spawn(plan[0].p);
#else
    for (;;) {
    new_game();
    put_text(1, 12, "FIRE TO PLAY");
    for (;;) {                                 // seed from the frames the player took
        wait_frame(); rnd();
        cia1.pra = 0xff;
        if (!(cia1.pra & J_FIRE)) break;
    }
    put_text(1, 12, "            ");
    prev_joy = 0;                              // the start press is not a rotate
    spawn(bag_next()); nextp = bag_next();
#endif
    redraw_rows(0, H - 1); hud();
    for (;;) {
        wait_frame();
#if AUTOPILOT
        char joy = autopilot();
#else
        cia1.pra = 0xff;
        char joy = cia1.pra;
#endif
        t_start();
        game_step(joy);
        char next_ok = 1;
        if (locked) {
#if AUTOPILOT
            ap_n++; ap_phase = 0; ap_tog = 0;
            if (ap_n < 5) next_ok = spawn(plan[ap_n].p);
#else
            next_ok = spawn(nextp); nextp = bag_next();
#endif
        }
        render();
        unsigned t = t_stop();
        if (locked) { if (t > worst_lock) worst_lock = t; }
        else if (t > worst_move) worst_move = t;
        if (ev_lines == 4) four = t;
        if (locked) hud();
        if (ev_lines) {
            static const char *const names[4] = { "SINGLE", "DOUBLE", "TRIPLE", "FOUR  " };
            put_text(1, 3 + ev_lines, names[ev_lines - 1]);
        }
        if (kicks) put_text(1, 9, "KICK");
        if (level) put_text(1, 10, "LEVEL UP");
#if AUTOPILOT
        if (ap_n == 5) break;
#endif
        if (!next_ok) break;
    }
#if AUTOPILOT
    // Spawn test: a cell under the spawn box refuses the next piece.
    board[rowoff[1] + 4] = 8;
    char spawn_ok = !spawn(0);
    board[rowoff[1] + 4] = 0;
    unsigned chk = 0;
    for (char i = 0; i < H * W; i++) chk = fold(chk, board[i]);
    char pass = chk == EXPECT_BOARD && score == EXPECT_SCORE && lines == 10
             && level == 1 && clears[0] == 1 && clears[1] == 1 && clears[2] == 1
             && clears[3] == 1 && kicks == 1 && bchk == EXPECT_BAG && bag_ok
             && spawn_ok && subject_ok && probe_ok && screen_bad(0) == 0;
    put_text(1, 13, "BOARD"); put_hex(7, 13, chk);
    put_text(1, 14, "BAG");   put_hex(7, 14, bchk);
    put_text(27, 13, pal ? "PAL" : "NTSC");
    put_text(27, 15, "LOCK MAX"); put_num(27, 16, worst_lock, 5);
    put_text(27, 17, "FOUR");     put_num(27, 18, four, 5);
    put_text(27, 19, "MOVE MAX"); put_num(27, 20, worst_move, 5);
    put_text(27, 21, "RULES");    put_num(27, 22, subj_rules, 5);
    put_text(27, 23, "RENDER");   put_num(27, 24, subj_render, 5);
    put_text(1, 16, pass ? "PASS" : "FAIL");
    RESULT = pass ? 1 : 2;
    vic.color_border = pass ? 5 : 2;
    for (;;) ;
#else
    put_text(1, 12, "GAME OVER");
    for (char f = 0; f < 100; f++) wait_frame();
    put_text(1, 12, "         ");
    for (char i = 1; i < 11; i++) put_text(1, i, "        ");
    }
#endif
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -n -o=falling-blocks.prg falling-blocks.c                   # 5,348 bytes, autopilot
oscar64 -tm=c64 -O2 -dAUTOPILOT=0 -o=falling-blocks-play.prg falling-blocks.c   # 3,697 bytes, the game
```

The expected values in the listing come from this model of the same
rules at the level of placements (rotate, move, rotate, drop). The
autopilot aims at a rotation and a column, so the result does not
depend on how many frames gravity or DAS take, and the same values hold
on PAL and NTSC.

```python
W, H = 10, 20
# Cells of each piece in a 4x4 box, (x, y), per rotation 0-3, clockwise.
# Order I O T S Z J L; I, S, Z repeat their two states, O its one.
P = {
 0: [[(0,1),(1,1),(2,1),(3,1)], [(2,0),(2,1),(2,2),(2,3)]] * 2,
 1: [[(1,0),(2,0),(1,1),(2,1)]] * 4,
 2: [[(0,1),(1,1),(2,1),(1,2)], [(1,0),(0,1),(1,1),(1,2)],
     [(1,0),(0,1),(1,1),(2,1)], [(1,0),(1,1),(2,1),(1,2)]],
 3: [[(1,1),(2,1),(0,2),(1,2)], [(1,0),(1,1),(2,1),(2,2)]] * 2,
 4: [[(0,1),(1,1),(1,2),(2,2)], [(2,0),(1,1),(2,1),(1,2)]] * 2,
 5: [[(0,1),(1,1),(2,1),(2,2)], [(1,0),(1,1),(0,2),(1,2)],
     [(0,0),(0,1),(1,1),(2,1)], [(1,0),(2,0),(1,1),(1,2)]],
 6: [[(0,1),(1,1),(2,1),(0,2)], [(0,0),(1,0),(1,1),(1,2)],
     [(2,0),(0,1),(1,1),(2,1)], [(1,0),(1,1),(1,2),(2,2)]],
}
KICKS = (0, 1, -1)
POINTS = (40, 100, 300, 1200)
GARBAGE = {9: "######....", 10: "##..######", 11: "##..######",
           12: ".#########", 13: ".#########", 14: ".#########",
           15: "#########.", 16: "#########.", 17: "#########.",
           18: "#########.", 19: "#########."}
PLAN = [(0, 0, 6, 0), (1, 0, 1, 0), (0, 1, -2, 1), (0, 1, 7, 1), (5, 1, 8, 2)]

board = [[8 if GARBAGE.get(y, "." * W)[x] == "#" else 0 for x in range(W)]
         for y in range(H)]

def fits(p, r, x, y):
    for cx, cy in P[p][r]:
        if not (0 <= x + cx < W and 0 <= y + cy < H) or board[y + cy][x + cx]:
            return False
    return True

score = lines = level = kicks = 0
clears = [0, 0, 0, 0]
for p, r1, tx, r2 in PLAN:
    r, x, y = 0, 3, 0
    assert fits(p, r, x, y), "game over"
    def rotate_to(want):
        global r, x, kicks
        while r != want:
            nr = (r + 1) & 3
            for k in KICKS:
                if fits(p, nr, x + k, y):
                    r, x = nr, x + k
                    kicks += k != 0
                    break
            else:
                raise SystemExit("rotation refused")
    rotate_to(r1)
    while x != tx:
        step = 1 if tx > x else -1
        assert fits(p, r, x + step, y), "move blocked"
        x += step
    rotate_to(r2)
    while fits(p, r, x, y + 1):
        y += 1
    for cx, cy in P[p][r]:
        board[y + cy][x + cx] = p + 1
    full = [row for row in board if all(row)]
    n = len(full)
    if n:
        board = [[0] * W for _ in range(n)] + [row for row in board if not all(row)]
        lines += n
        clears[n - 1] += 1
        if lines >= (level + 1) * 10:
            level += 1
        score += POINTS[n - 1] * (level + 1)    # level after the clear, as NES

chk = 0
for row in board:
    for v in row:
        chk = ((chk ^ v) * 5 + 1) & 0xFFFF
print("BOARD %04X SCORE %d LINES %d LEVEL %d CLEARS %s KICKS %d"
      % (chk, score, lines, level, clears, kicks))
for row in board[15:]:
    print("".join(".IOTSZJLG"[v] for v in row))

# 7-bag from a 16-bit Galois LFSR, taps $B400, seed $ACE1: ten bags.
s = 0xACE1
def rnd():
    global s
    lsb = s & 1
    s >>= 1
    if lsb:
        s ^= 0xB400
    return s
seq, bchk = [], 0
for _ in range(10):
    bag = list(range(7))
    for i in range(6, 0, -1):
        j = rnd() % (i + 1)
        bag[i], bag[j] = bag[j], bag[i]
    seq += bag
for v in seq:
    bchk = ((bchk ^ v) * 5 + 1) & 0xFFFF
print("BAG %04X" % bchk, "".join("IOTSZJL"[v] for v in seq[:14]))
```

It prints:

```text
BOARD ECB5 SCORE 2840 LINES 10 LEVEL 1 CLEARS [1, 1, 1, 1] KICKS 1
..........
..........
.......J..
I......JJJ
GGGGGGGGG.
BAG 808A ILSJTZOSZTOJLI
```

## Expected output

Pinned run: `x64sc -default -warp +sound +autostart-delay-random
-autostartprgmode 1 -limitcycles 12500000 [-model ntsc] -exitscreenshot
out.png -autostart falling-blocks.prg`. Screenshots
`screenshots/falling-blocks.png` (PAL) and
`screenshots/falling-blocks-ntsc.png` (NTSC). The exit screenshot is
already the final one at 8,250,000 cycles on PAL and 8,750,000 on NTSC,
and differs at 8,000,000 and 8,500,000; after that the program holds the
result screen.

Border green (PAL RGB 98, 213, 50; NTSC 114, 189, 103), background
black. Screen rows 2-24 of the PAL shot, decoded cell by cell against
the character ROM (`#` is a reverse-space cell: walls, garbage and
pieces):

```text
              #          #
              #          # SCORE
 SINGLE       #          # 002840
 DOUBLE       #          #
 TRIPLE       #          # LINES
 FOUR         #          # 010
              #          #
 KICK         #          # LEVEL
 LEVEL UP     #          # 01
              #          #
              #          #
 BOARD ECB5   #          # PAL
 BAG   808A   #          #
              #          # LOCK MAX
 PASS         #          # 06276
              #          # FOUR
              #          # 06276
              #       #  # MOVE MAX
              ##      #### 02113
              ########## # RULES
              ############ 05717
                           RENDER
                           09311
```

On NTSC the same, with `NTSC` on row 13 and 06491, 06491, 02113, 05888
and 09394 in the five figures.

The well is screen columns 15-24, rows 2-21, with medium grey (colour
12) walls in columns 14 and 25 and a floor on row 22. All 200 board
cells were measured with PIL on both shots against the model's board,
each 8x8 cell required to be one colour: empty cells black, row 19
columns 0-8 dark grey (colour 11, garbage) with column 9 black, row 18
column 0 cyan (colour 3, the I left by the triple), row 18 columns 7-9
and row 17 column 7 light blue (colour 14, the J). No cell differed on
either model. Each model was run twice and gave byte-identical PNGs.

## Why this works

`game_step` is the whole rule set and takes one joystick byte, active
low as `$DC00` reads it. The autopilot builds that byte from a plan of
(piece, first rotation, column, second rotation): it taps fire every
other frame until the rotation matches, holds left or right until the
column matches, taps fire again, then holds down until the piece locks.
Holding a direction is what drives `das`, so the moves across the board
exercise the delay and repeat exactly as a held stick would. The J is
moved to the right wall in its upright state and rotated there; its flat
state does not fit in place or one cell right, so the kick table's third
entry moves it one left, and the program counts that kick.

The board rows start at 9 with garbage built so that each piece clears
the rows above the next well first: the flat I completes row 9, the O
rows 10-11, the upright I at the left wall rows 12-14, and the upright I
in column 9 rows 16-19, with row 15 dropping into row 19 afterwards. The
four clears total 10 lines, so the level goes to 1 on the four-line
clear. As on the NES, a clear is scored at the level after it:
40 + 100 + 300 at level 0 and 1200 x 2 at level 1, 2840.

Every game frame is timed with CIA1 timer A from `t_start` to `t_stop`,
the method of `print-number.md`, with the KERNAL IRQ off (`sei`) so the
jiffy handler neither runs inside the timed code nor reloads the timer.
The screen stays on and each frame starts at raster line 250, so badline
stalls are in the figures. HUD printing runs after `t_stop` and is not
counted. `worst_subject` builds a stack the game cannot reach, twenty
rows high with column 9 open, and times the frame in which an upright I
locks into the bottom four with fire, left and right all held: three
rotation tries and both moves are tested and refused, then the lock, a
four-line clear, sixteen rows collapsed and a spawn. Holding left and
right together cannot happen on a real stick, so this is an upper bound.
That rules part took 5,717 cycles on PAL and 5,888 on NTSC. The render
of the same frame, timed apart, erases and redraws the locked piece,
redraws all twenty rows and draws the new piece: 9,311 on PAL and 9,394
on NTSC. That is `text_mode_overlay_render`'s work, not the rules'. The
scripted game's own four-line clear, rules and render together with six
rows to redraw, took 6,276 on PAL and 6,491 on NTSC and was its dearest
frame. The whole subject frame, 15,028 cycles on PAL and 15,282 on NTSC,
runs about 240 and 235 raster lines from line 250 (divided by 63 and 65,
arithmetic), well past the start of the next frame's display, so the
collapse frame can tear the field once (`full_field_redraw_exceeds_vblank`
in `pitfalls/text-mode-render.md`). A game that cares redraws only the
rows that moved over two frames, or builds the next field in a second
screen (`screen_double_buffer_d018`).

`render` erases the piece where it was last drawn and draws it where it
is on every frame, including the frame it locks. A lock frame can also
carry a move or a rotation, and a clear redraws only the rows from the
old stack top down to the lowest cleared row, so rows below that row
keep whatever the erase left. `lock_piece` records where the piece
locked (`lk_p`, `lk_r`, `lk_x`, `lk_y`) because the spawn that follows
overwrites `piece` and `px`. `lock_move_probe` builds that case: an
upright I drawn in column 8, held right on the frame gravity locks it,
completing row 16 while its lower three cells sit in rows 17-19. It then
requires every well cell on screen, glyph and colour, to match the board
with the new piece on it (`screen_bad`). With the erase skipped on a
lock that clears lines, the probe fails and the program prints FAIL
(measured in VICE). The same screen check runs on the worst-frame
subject and on the final board.

`detect_pal` polls for raster line 280, which exists only on PAL, and
selects the NES PAL gravity and DAS tables there. The rules then run at
the speed the NES tables intend on both regions; the scripted result is
the same on both because the autopilot aims at positions, not frames.

The lock writes `char x = px + cx[...]` before indexing the board.
Summing `rowoff[y] + px + cx[...]` inline instead loses a cell locked at
column 0 with `px` = -2 (board fold `04AC` instead of `ECB5`, the
model's board less that cell). Oscar64 1.32.271 at `-O2` hoists
`board + px` out of the loop as a 16-bit pointer and zero-extends the
signed `px` (`CLC`, `LDA #<board`, `ADC px`, `LDA #>board`, `ADC #$00`),
so `px` = -2 (`$FE`) lands 256 bytes above the cell. A 20-line test
reproduces it (border red, none of the four cells in the board);
there is no diagnostic. Computing the column in a `char` first, as the
listing does, compiles correctly.

The 7-bag check deals ten bags from seed `$ACE1`, requires each to hold
all seven pieces, and folds the 70 pieces into `808A`, the model's
value. The spawn check puts one cell under the spawn box, requires
`spawn` to refuse, and removes it. In the joystick build the bag is
seeded by stepping the LFSR once per frame until fire is pressed, the
player-input seed of `lfsr_random`.
