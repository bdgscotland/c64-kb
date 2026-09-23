---
recipe: game-tree-search
toolchain: oscar64
output_format: PRG
region: both
techniques: [game_tree_search]
file_formats: [PRG]
uses_registers: [D011, D012, D019, D01A, D020, D021, DC04, DC05, DC06, DC07, DC0E, DC0F]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 Game Tree Search: Connect Four by negamax with alpha-beta

## Synopsis

The machine plays Connect Four (7 columns, 6 rows) against itself: a
negamax search with alpha-beta pruning, five plies deep, columns tried
centre first, leaves scored by an incremental cell-weight sum. The search
is a loop over an explicit per-ply record, not a recursive function, so
it can stop after any node and go on in a later frame. The game runs to a
full board (a draw at this depth) three times: blocking, with each search
in one call; one node a call, to time the worst single node; and sliced,
four nodes a frame while a per-frame counter keeps running. Every column
chosen and the node count of every one of the 42 searches in each game is
compared with a Python model of the same search, compiled in. The program
prints PASS or FAIL, nodes per second and cycles per node from a CIA1
timer, frames per move from a raster IRQ counter, the worst single call
and the worst slice. It implements `game_tree_search`
(`techniques/logic.md`). Build `-dRECURSIVE=1` for the blocking game with
the search written as a recursive function.

## Source

```c
// game-tree-search.c
// Connect Four (7 columns, 6 rows) played by the machine against itself:
// negamax with alpha-beta to a fixed depth, centre-first move order and an
// incremental cell-weight evaluation. The search is iterative, with one
// record per ply in static arrays, so it can stop after any node and go on
// later: search_step(n) runs at most n nodes. The game is played three
// times: blocking (each search in one call), one node a call (to time the
// worst single node), and sliced (SLICE nodes a frame while a per-frame
// counter keeps running). Every chosen column and node count of each game
// is checked against a Python model of the same search.
// Build -dRECURSIVE=1 for the blocking game with a recursive search.
#include <c64/vic.h>
#include <c64/cia.h>
#include <c64/rasterirq.h>

#ifndef DEPTH
#define DEPTH 5                      // plies searched from each position
#endif
#ifndef SLICE
#define SLICE 4                      // nodes a frame in the sliced game
#endif
#ifndef RECURSIVE
#define RECURSIVE 0                  // 1: blocking game only, recursive search
#endif

#define SCREEN ((char *)0x0400)
#define COLOUR ((char *)0xd800)
#define EMPTY 0
#define EDGE  3                      // sentinel: never equal to a player
#define WIN   1000                   // a win found at ply p scores WIN - p
#define INF   30000
#define MAXMOVES 42

// The Python model's game at DEPTH 5, a draw on a full board: the column
// chosen and the nodes searched for each of the 42 moves.
#define NEXP 42
static const char exp_col[NEXP] = {3, 3, 2, 4, 3, 3, 3, 3, 2, 2, 2, 4, 2, 1,
    1, 4, 4, 4, 2, 4, 5, 1, 1, 1, 1, 0, 0, 0, 5, 5, 0, 0, 0, 6, 5, 5, 5, 6, 6,
    6, 6, 6};
static const unsigned exp_nodes[NEXP] = {755, 563, 1484, 941, 2283, 702, 2360,
    908, 1342, 341, 1177, 746, 1024, 637, 658, 525, 347, 494, 415, 177, 124,
    164, 80, 172, 142, 72, 119, 72, 105, 53, 107, 64, 58, 27, 23, 9, 7, 5, 4,
    3, 2, 1};

// Board: 8 rows of 8 bytes. Rows 1..6 are the play rows (row 1 at the
// bottom), columns 0..6. Row 0, row 7 and column 7 hold EDGE, so a run
// along any of the four directions stops at the edge without a bounds test.
static char board[64];
static char height[7];               // pieces in each column
static int  score;                   // sum of weights: player 1 plus, player 2 minus
static char nmoves;                  // pieces on the board
static unsigned nodes;               // positions made by the current search

// Number of four-in-a-row windows through each cell, row 1 first.
static const char weight[64] = {
    0, 0, 0, 0, 0, 0, 0, 0,
    3, 4, 5, 7, 5, 4, 3, 0,
    4, 6, 8,10, 8, 6, 4, 0,
    5, 8,11,13,11, 8, 5, 0,
    5, 8,11,13,11, 8, 5, 0,
    4, 6, 8,10, 8, 6, 4, 0,
    3, 4, 5, 7, 5, 4, 3, 0,
    0, 0, 0, 0, 0, 0, 0, 0 };
static const char order[7] = { 3, 2, 4, 1, 5, 0, 6 };   // centre first
static const char dirs[4] = { 1, 8, 9, 7 };

// Does the piece just placed at cell i complete four for player p?
static char wins(char i, char p)
{
    for (char k = 0; k < 4; k++)
    {
        char d = dirs[k], n = 1, j = i + d;
        while (board[j] == p) { n++; j += d; }
        j = i - d;
        while (board[j] == p) { n++; j -= d; }
        if (n >= 4) return 1;
    }
    return 0;
}

// Returns the cell index. The new height goes through a variable: written
// as i = ((height[c] + 1) << 3) + c; board[i] = side; height[c]++;
// Oscar64 1.32.271 stores side + 1 into height[c] (see "Why this works").
static char make(char c, char side)
{
    char h = height[c] + 1;
    height[c] = h;
    char i = (h << 3) + c;
    board[i] = side; nmoves++;
    if (side == 1) score += weight[i]; else score -= weight[i];
    return i;
}

static void unmake(char c, char i, char side)
{
    board[i] = EMPTY; height[c]--; nmoves--;
    if (side == 1) score -= weight[i]; else score += weight[i];
}

// The value of the move just made, for the side that made it, when the
// search stops here: a win, a full board, or the depth limit. Otherwise
// returns 1 in *go and the caller searches below.
static int leaf(char i, char side, char ply, char *go)
{
    *go = 0;
    if (wins(i, side)) return WIN - ply;
    if (nmoves == MAXMOVES) return 0;
    if (ply + 1 == DEPTH) return side == 1 ? score : -score;
    *go = 1;
    return 0;
}

static char bestcol;                  // the root's choice

#if RECURSIVE
static int negamax(char ply, int alpha, int beta, char side)
{
    int best = -INF;
    for (char k = 0; k < 7; k++)
    {
        char c = order[k];
        if (height[c] == 6) continue;
        char i = make(c, side), go;
        nodes++;
        int v = leaf(i, side, ply, &go);
        if (go) v = -negamax(ply + 1, -beta, -alpha, 3 - side);
        unmake(c, i, side);
        if (v > best)
        {
            best = v;
            if (ply == 0) bestcol = c;
            if (v > alpha) { alpha = v; if (alpha >= beta) break; }
        }
    }
    return best;
}
static void search_begin(char side) { nodes = 0; negamax(0, -INF, INF, side); }
static char search_step(unsigned budget) { return 1; }
#else
// One record per ply: the window, the best value so far, the next entry
// of order[] to try, and the move made from this ply (column and cell).
// With the ply and side to move, this is the whole state of a search.
static int  p_alpha[DEPTH], p_beta[DEPTH], p_best[DEPTH];
static char p_next[DEPTH], p_col[DEPTH], p_cell[DEPTH];
static char s_ply, s_side;

static void search_begin(char side)
{
    nodes = 0; s_ply = 0; s_side = side;
    p_alpha[0] = -INF; p_beta[0] = INF; p_best[0] = -INF; p_next[0] = 0;
}

// Runs the search for at most budget nodes. Returns 1 when it has
// finished (bestcol holds the move), 0 when it stopped to go on later.
static char search_step(unsigned budget)
{
    char ply = s_ply, side = s_side;
    for (;;)
    {
        int v;
        if (p_next[ply] == 7)
        {
            // Every child of this ply is done: return its value to the parent.
            if (ply == 0) return 1;
            v = -p_best[ply];
            ply--; side = 3 - side;
            unmake(p_col[ply], p_cell[ply], side);
        }
        else
        {
            char c = order[p_next[ply]];
            if (height[c] == 6) { p_next[ply]++; continue; }
            if (budget == 0) { s_ply = ply; s_side = side; return 0; }
            budget--;
            p_next[ply]++;
            char i = make(c, side), go;
            p_col[ply] = c; p_cell[ply] = i;
            nodes++;
            v = leaf(i, side, ply, &go);
            if (go)
            {
                // Descend: the child's window is the parent's, negated and swapped.
                ply++; side = 3 - side;
                p_alpha[ply] = -p_beta[ply - 1]; p_beta[ply] = -p_alpha[ply - 1];
                p_best[ply] = -INF; p_next[ply] = 0;
                continue;
            }
            unmake(c, i, side);
        }
        // v is the value of the move p_col[ply] for the side to move at ply.
        if (v > p_best[ply])
        {
            p_best[ply] = v;
            if (ply == 0) bestcol = p_col[0];
            if (v > p_alpha[ply])
            {
                p_alpha[ply] = v;
                if (v >= p_beta[ply]) p_next[ply] = 7;   // cut: skip the rest
            }
        }
    }
}
#endif

// --- the demonstration: play, check, time, draw ---------------------------
static void put_text(char row, char col, const char *s)
{
    char *p = SCREEN + 40 * row + col;
    while (*s)
    {
        char c = *s++;
        if (c >= 'A' && c <= 'Z') c -= 64;
        *p++ = c;
    }
}
// v as n decimal digits (n = 1..8), leading zeros shown.
static void put_dec(char row, char col, unsigned long v, char n)
{
    static const unsigned long pw[8] = { 10000000, 1000000, 100000, 10000, 1000, 100, 10, 1 };
    char *p = SCREEN + 40 * row + col;
    for (char i = 8 - n; i < 8; i++)
    {
        char d = 0x30;
        while (v >= pw[i]) { v -= pw[i]; d++; }
        *p++ = d;
    }
}
// CIA1 timer A counts phi2 from $FFFF; timer B counts A's underflows.
static void t_start(void)
{
    cia1.cra = 0; cia1.crb = 0;
    cia1.ta = 0xffff; cia1.tb = 0xffff;
    cia1.crb = 0x51;                     // force load, start, count A underflows
    cia1.cra = 0x11;                     // force load, start, count phi2
}
static unsigned long t_stop(void)
{
    cia1.cra = 0; cia1.crb = 0;
    return ((unsigned long)(0xffff - cia1.tb) << 16) + (0xffff - cia1.ta);
}
static unsigned long c_null;             // t_start plus t_stop with nothing between

static void put_cell(char i)             // board cell i to the screen
{
    char r = (i >> 3) - 1, c = i & 7, b = board[i];
    unsigned o = 40 * (6 - r) + 2 * c + 1;               // row 1 at screen row 6
    SCREEN[o] = b == EMPTY ? 0x2e : 0x51;
    COLOUR[o] = b == 1 ? VCOL_YELLOW : b == 2 ? VCOL_RED : VCOL_MED_GREY;
}
static void reset(void)
{
    for (char i = 0; i < 64; i++) board[i] = EDGE;
    for (char r = 1; r < 7; r++)
        for (char c = 0; c < 7; c++) board[(r << 3) + c] = EMPTY;
    for (char c = 0; c < 7; c++) height[c] = 0;
    score = 0; nmoves = 0;
}

RIRQCode frame_irq;
volatile unsigned ticks;
__interrupt void on_frame(void) { ticks++; }

// The result of one game.
static char played, winner, okcol, oknodes;
// Called when the search for move 'played' has finished: check it against
// the model, play it, and say whether the game is over.
static char finish_move(char side, char draw)
{
    if (played < NEXP)
    {
        if (bestcol == exp_col[played]) okcol++;
        if (nodes == exp_nodes[played]) oknodes++;
    }
    char i = make(bestcol, side);
    if (draw)
    {
        put_cell(i);
        // the columns played, 21 to a row, on rows 9 and 10
        SCREEN[40 * (9 + played / 21) + 4 + played % 21] = 0x30 + bestcol;
    }
    played++;
    if (wins(i, side)) { winner = side; return 1; }
    return played == MAXMOVES;
}
static void new_game(void) { reset(); played = 0; winner = 0; okcol = 0; oknodes = 0; }
static void put_check(char row)
{
    put_text(row, 0, "   COLS   /   NODES   /");
    put_dec(row, 8, okcol, 2); put_dec(row, 11, NEXP, 2);
    put_dec(row, 20, oknodes, 2); put_dec(row, 23, NEXP, 2);
}
static char game_ok(void)
{
    return played == NEXP && okcol == NEXP && oknodes == NEXP && winner == 0;
}

int main(void)
{
    __asm { sei }
    vic.color_border = VCOL_BLACK;
    vic.color_back = VCOL_BLACK;
    for (unsigned i = 0; i < 1000; i++) { SCREEN[i] = 0x20; COLOUR[i] = VCOL_WHITE; }

    // PAL or NTSC: the highest raster line reached past 255.
    while (!(vic.ctrl1 & 0x80)) ;
    char top = 0;
    while (vic.ctrl1 & 0x80) { char r = vic.raster; if (r > top) top = r; }
    char pal = top > 0x20;               // PAL reaches $137, NTSC $106

    t_start(); c_null = t_stop();

    rirq_init(true);
    rirq_build(&frame_irq, 1);
    rirq_call(&frame_irq, 0, on_frame);
    rirq_set(0, 250, &frame_irq);
    rirq_sort();
    rirq_start();

    // Game 1, blocking: each search runs to the end in one call.
    unsigned long allnodes = 0, allcyc = 0, cmax = 0;
    unsigned fmin = 0xffff, fmax = 0, total = 0;
    char side = 1, pass;
    new_game();
    for (;;)
    {
        unsigned f0 = ticks;
        t_start();
        search_begin(side);
        search_step(0xffff);
        unsigned long cyc = t_stop() - c_null;
        unsigned fr = ticks - f0;
        allnodes += nodes; allcyc += cyc; total += fr;
        if (cyc > cmax) cmax = cyc;
        if (fr < fmin) fmin = fr;
        if (fr > fmax) fmax = fr;
        if (finish_move(side, RECURSIVE)) break;
        side = 3 - side;
    }
    pass = game_ok();
    put_text(11, 0, "BLOCKING"); put_check(12);
    put_text(13, 0, "   NODES        CYCLES");
    put_dec(13, 9, allnodes, 6); put_dec(13, 24, allcyc, 8);
    // nodes per second = nodes * clock / cycles, scaled to stay in 32 bits
    unsigned long clk100 = pal ? 9852 : 10227;     // phi2 / 100: PAL 985,248 Hz, NTSC 1,022,727 Hz
    unsigned long nps = allnodes * clk100 / (allcyc / 100);
    put_text(14, 0, "   NODES/S       CYC/NODE");
    put_dec(14, 11, nps, 5); put_dec(14, 26, allcyc / allnodes, 5);
    put_text(15, 0, "   FRAMES/MOVE MIN     MAX     ALL");
    put_dec(15, 19, fmin, 3); put_dec(15, 27, fmax, 3); put_dec(15, 35, total, 4);
    put_text(16, 0, "   SLOWEST MOVE         CYCLES");
    put_dec(16, 16, cmax, 7);

#if !RECURSIVE
    // Game 2: one node a call, each call timed: the worst single step is
    // one node plus any returns up the plies before it.
    unsigned long worst1 = 0;
    side = 1;
    new_game();
    for (;;)
    {
        search_begin(side);
        char done;
        do
        {
            t_start();
            done = search_step(1);
            unsigned long c = t_stop() - c_null;
            if (c > worst1) worst1 = c;
        } while (!done);
        if (finish_move(side, 0)) break;
        side = 3 - side;
    }
    pass &= game_ok();
    put_text(17, 0, "ONE NODE A CALL"); put_check(18);
    put_text(19, 0, "   WORST CALL       CYCLES");
    put_dec(19, 14, worst1, 5);

    // Game 3, sliced: SLICE nodes a frame. Each frame the loop waits for
    // the raster IRQ, advances a spinner and frame count, and runs one
    // slice; the frame that follows a finished search plays the move.
    static const char spin[4] = { 0x2d, 0x4e, 0x5d, 0x4d };   // - / | \ in screen codes
    unsigned long worstn = 0;
    unsigned frames = 0, missed = 0, mf = 0, mfmax = 0;
    for (char i = 0; i < 64; i++) if (board[i] != EDGE) { board[i] = EMPTY; put_cell(i); }
    side = 1;
    new_game();
    search_begin(side);
    char searching = 1;
    put_text(22, 0, "FRAME");
    unsigned last = ticks;
    for (;;)
    {
        while (ticks == last) ;
        unsigned now = ticks;
        missed += now - last - 1;
        last = now;
        frames++; mf++;
        SCREEN[40 * 22 + 12] = spin[frames & 3];
        put_dec(22, 6, frames, 5);
        if (searching)
        {
            t_start();
            char done = search_step(SLICE);
            unsigned long c = t_stop() - c_null;
            if (c > worstn) worstn = c;
            if (done) searching = 0;
        }
        else
        {
            if (mf > mfmax) mfmax = mf;
            mf = 0;
            if (finish_move(side, 1)) break;
            side = 3 - side;
            search_begin(side);
            searching = 1;
        }
    }
    pass &= game_ok();
    put_text(20, 0, "SLICED   NODES A FRAME"); put_dec(20, 7, SLICE, 1);
    put_check(21);
    put_text(22, 14, "MISSED       MOST/MOVE");
    put_dec(22, 21, missed, 5); put_dec(22, 37, mfmax, 3);
    put_text(23, 0, "   WORST SLICE       CYCLES");
    put_dec(23, 15, worstn, 5);
#endif

    put_text(8, 0, "DEPTH   MOVES    WINNER");
    put_dec(8, 6, DEPTH, 1); put_dec(8, 14, played, 2);
    put_text(8, 24, winner == 1 ? "YELLOW" : winner == 2 ? "RED" : "NONE");
    put_text(9, 0, "SEQ");
    put_text(24, 0, pal ? "PAL" : "NTSC");
    put_text(24, 5, RECURSIVE ? "RECURSIVE" : "ITERATIVE");
    put_text(24, 16, pass ? "PASS" : "FAIL");
    vic.color_border = pass ? VCOL_GREEN : VCOL_RED;
    for (;;) ;
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=game-tree-search.prg game-tree-search.c
```

Run headless (PAL; add `-model ntsc` for NTSC):

```bash
timeout 180 x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 -limitcycles 160000000 -exitscreenshot game-tree-search.png -autostart game-tree-search.prg
```

The report is on screen between 135,000,000 and 140,000,000 cycles on
PAL and between 125,000,000 and 130,000,000 on NTSC (measured by
bisecting `-limitcycles`); 160,000,000 leaves a margin. The sliced game
takes most of that: 4,880 frames.

## Expected output

`screenshots/game-tree-search.png` (PAL) and
`screenshots/game-tree-search-ntsc.png` (NTSC). Black screen, green
border. Screen rows 1 to 6 hold the full board, top row first, one
filled circle (screen code $51) every second column: yellow for the side
that moved first, red for the other. Top row first, the board reads:

```text
YYYRRYR
RRYYRRY
YYYRYYR
RRRYRRY
YYYRRYR
RRYYRYR
```

Rows 8 to 24, PAL:

```text
DEPTH 5 MOVES 42 WINNER NONE
SEQ 332433332224211444245
    111100055000655566666
BLOCKING
   COLS 42/42 NODES 42/42
   NODES 019292 CYCLES  17397672
   NODES/S 01092 CYC/NODE 00901
   FRAMES/MOVE MIN 000 MAX 103 ALL 0885
   SLOWEST MOVE 2019814 CYCLES
ONE NODE A CALL
   COLS 42/42 NODES 42/42
   WORST CALL 02301 CYCLES
SLICED 4 NODES A FRAME
   COLS 42/42 NODES 42/42
FRAME 04880 - MISSED 00000 MOST/MOVE 591
   WORST SLICE 05024 CYCLES
PAL  ITERATIVE  PASS
```

NTSC reads `CYCLES  17601946`, `NODES/S 01120 CYC/NODE 00912`,
`FRAMES/MOVE MIN 000 MAX 120 ALL 1028`, `SLOWEST MOVE 2043608`,
`WORST CALL 02329`, `WORST SLICE 05325` and `NTSC`; the rest is the same.

- `SEQ` is the column (0 to 6, left to right) of each of the 42 moves of
  the sliced game.
- `COLS` and `NODES` count the moves whose column, and whose node count,
  equal the model's, once per game. A node is one position made by the
  search, the root's children included.
- `CYCLES` is the sum over the 42 blocking searches, CIA1 timer A
  cascaded into timer B, display on, with the frame counter's raster IRQ
  running (one interrupt a frame, inside the figure). `NODES/S` is nodes
  times the phi2 clock (985,248 Hz PAL, 1,022,727 Hz NTSC) over cycles;
  NTSC has the faster clock, so it searches more nodes a second while
  spending more cycles on each (a shorter frame and so a larger share of
  badlines and interrupts, not separated here).
- `FRAMES/MOVE` is the fewest and most display frames one blocking
  search took and the total, from the raster IRQ counter on line 250.
- `SLOWEST MOVE` is the most cycles one blocking search took: move 7,
  2,360 nodes, about two seconds on either model.
- `WORST CALL` is the most cycles one `search_step(1)` call took over the
  whole game: one node, any returns up the plies before it, and the
  call itself, timed like `CYCLES`, so it can include badlines and the
  frame interrupt.
- `FRAME` is the frame count of the sliced game and the character after
  it a spinner, both advanced by the main loop once a frame. `MISSED`
  counts frames in which the loop did not run: the IRQ counter moved on by
  more than one while the loop was busy. `MOST/MOVE` is the most frames
  one sliced move took, the frame that plays it included. `WORST SLICE`
  is the most cycles one `search_step(4)` call took.

The model: the same search in Python. Its column list, node list and
final board are the values compiled into the listing and quoted above.

```python
EMPTY, EDGE, WIN, INF, DEPTH = 0, 3, 1000, 30000, 5
ROW = [[3, 4, 5, 7, 5, 4, 3], [4, 6, 8, 10, 8, 6, 4], [5, 8, 11, 13, 11, 8, 5]]
WEIGHT = [0] * 64                        # windows of four through each cell
for r, w in enumerate(ROW + ROW[::-1]):
    WEIGHT[(r + 1) * 8:(r + 1) * 8 + 7] = w
ORDER, DIRS = [3, 2, 4, 1, 5, 0, 6], [1, 8, 9, 7]
board = [EDGE] * 64
for r in range(1, 7):
    board[r * 8:r * 8 + 7] = [EMPTY] * 7
height, st = [0] * 7, {'score': 0, 'moves': 0, 'nodes': 0}

def wins(i, p):
    for d in DIRS:
        n, j = 1, i + d
        while board[j] == p: n, j = n + 1, j + d
        j = i - d
        while board[j] == p: n, j = n + 1, j - d
        if n >= 4: return True
    return False

def make(c, side):
    i = (height[c] + 1) * 8 + c
    board[i] = side; height[c] += 1; st['moves'] += 1
    st['score'] += WEIGHT[i] if side == 1 else -WEIGHT[i]
    return i

def unmake(c, i, side):
    board[i] = EMPTY; height[c] -= 1; st['moves'] -= 1
    st['score'] -= WEIGHT[i] if side == 1 else -WEIGHT[i]

def negamax(ply, alpha, beta, side):
    best, bestcol = -INF, None
    for c in ORDER:
        if height[c] == 6: continue
        i = make(c, side); st['nodes'] += 1
        if wins(i, side): v = WIN - ply
        elif st['moves'] == 42: v = 0
        elif ply + 1 == DEPTH: v = st['score'] if side == 1 else -st['score']
        else: v = -negamax(ply + 1, -beta, -alpha, 3 - side)[0]
        unmake(c, i, side)
        if v > best:                     # strictly better: the first best column stays
            best, bestcol = v, c
            if v > alpha:
                alpha = v
                if alpha >= beta: break
    return best, bestcol

side, cols, nodes = 1, [], []
while st['moves'] < 42:
    st['nodes'] = 0
    col = negamax(0, -INF, INF, side)[1]
    cols.append(col); nodes.append(st['nodes'])
    if wins(make(col, side), side): break
    side = 3 - side
print(''.join(map(str, cols)), sum(nodes))
print(nodes)
for r in range(6, 0, -1):                # top row first, as on screen
    print(''.join('.YR'[board[r * 8 + c]] for c in range(7)))
```

## Why this works

The board is 64 bytes: eight rows of eight, the six play rows in the
middle and a sentinel byte (`EDGE`) in row 0, row 7 and column 7. A cell
is `(row << 3) + column`, and the four line directions are +1, +8, +9
and +7. `wins()` counts equal pieces outwards from the new piece both
ways along each direction; a run stops at the first byte that is not the
player's, and a sentinel never is, so no bounds test is needed. Column 7
serves both edges of a row: stepping left from column 0 lands on
column 7 of the row below. A move is a column: `height[c]` gives the
cell, so move generation is seven tests of `height[c] == 6`.

The evaluation is a sum kept up to date by `make()` and `unmake()`: each
cell's weight is the number of four-in-a-row windows through it (3 at a
corner, 13 at the centre of the middle rows), added for the first player
and subtracted for the second. A leaf then costs one load and a negate,
not a scan of the board. A win scores `WIN - ply`, so a quicker win
scores higher; a full board scores 0.

`search_step()` is negamax: every value is from the view of the side to
move, and a child's value is negated on the way up. Each ply keeps its
window (`p_alpha`, `p_beta`), its best value, the index of the next
column to try and the move it made. Descending sets the child's window to
the parent's negated and swapped; returning unmakes the parent's move
and hands up the child's best, negated. A value at least `p_beta` ends
the ply at once (`p_next = 7`): the opponent above already has a better
choice and will not allow this line. Ties keep the first column
(strictly greater replaces), which is why the model must try columns in
the same order to match node for node.

**Time slicing.** `search_step(n)` makes at most `n` nodes. When the
budget runs out it stores the ply and the side to move in `s_ply` and
`s_side` and returns 0; the per-ply records already hold the rest of the
search, so the next call goes on from the same place. The budget is
tested only before a node is made, so the returns up the plies after a
slice's last node run at the start of the next slice. The sliced game
made the same 42 moves with the same node counts as the blocking game and
the model. Its 4,880 frames match the model exactly: a search of `n`
nodes takes ceil(n / 4) slices, 4,838 over the game, and each move one
more frame to play; the slowest move is ceil(2,360 / 4) + 1 = 591.
`MISSED 00000` on both models shows the main loop ran in every frame, so
the spinner and the counter never stopped. The cost is time: the slowest
move takes 591 frames, about 11.8 s on PAL and 9.9 s on NTSC
(arithmetic), against 103 and 120 frames blocking.

**Why four nodes a frame.** The worst single call was 2,301 cycles on
PAL and 2,329 on NTSC. Four of the NTSC figure, 9,316 cycles, fit in
half a PAL frame of 9,828 (arithmetic), leaving the other half for the
game. The bound is loose: the worst slice measured was 5,024 cycles on
PAL and 5,325 on NTSC, because a slice of four rarely meets four worst
nodes, and it counts the call overhead four times. A game that needs a
guarantee plans on the bound.

**Iterative or recursive.** The `-dRECURSIVE=1` build plays the same 42
blocking moves with the same node counts. Oscar64 gives `negamax()` an
18-byte frame in its software stack region at $9000-$9FFF (the `.asm`
listing's `SBC #$12` on `SP`), because its static frame allocation cannot
cover a function that calls itself. Measured with the pinned command
(not pinned itself), it took 18,941,070 cycles on PAL (981 a node, 109
frames for the slowest move) against 17,397,672 (901) for the loop, and
19,164,989 (993) against 17,601,946 (912) on NTSC: about 9 % slower. A
recursive search also cannot be sliced without keeping its whole call
chain alive between frames.

**Optimisation level.** The whole program, all three games, passes at
`-O0`, `-O1`, `-O2`, `-O3` and `-Os`. The blocking game's cycles a node
on PAL were 1,125 at `-O0`, 918 at `-O1`, 901 at `-O2`, 836 at `-Os` and
780 at `-O3`, the last with a PRG of 10,073 bytes against 4,985 at `-O2`.

**An Oscar64 fault met on the way.** A first `make()` wrote
`char i = ((height[c] + 1) << 3) + c; board[i] = side; height[c]++;` and
returned `i`. Oscar64 1.32.271 (local build c1270bc, see #25) compiled
the increment as `LDA side; STA board,y; ADC #$01; STA height,x`: the
6502 back-end drops the reload of `height[c]` and the `CLC`, so
`height[c]` gets `side + 1` plus the carry. The intermediate code is
correct. The full listing with that `make()` played `242424...` and
matched 10 of 42 columns and no node counts at `-O0`, `-O1`, `-O2` and
`-Os`; at `-O3` it passed, only because inlining changed the code. A
short test, `make(3, 2)` through volatile arguments with the returned
cell stored and then a check that `height[3]` is 1, turns the border red
at every level from `-O0` to `-Os`. Reading the height into a variable
first, as the listing does, gives the right result at every level. There
is no diagnostic. Upstream Oscar64 has later optimiser fixes; this recipe
was not built with upstream HEAD, and `toolchains/oscar64-reference.md`
records how HEAD handles the pattern (#30).

**Why five plies.** The model's node totals for the whole self-play game
are 4,670 at depth 4, 19,292 at 5, 59,145 at 6 and 132,100 at 7. At the
measured 901 cycles a node, depth 5 costs about 17.6 PAL seconds for 42
blocking moves (arithmetic), and the slowest move two seconds. Depth 7's
first move alone is 6,062 nodes, about 5.5 s blocking (arithmetic).

## Verification

VICE x64sc 3.10, windowless build, Oscar64 1.32.271 (local build
c1270bc), 2026-09-23.

**Board and text against the model.** A script read the 42 board cells
of both pictures, matched each 8x8 cell against `chargen-901225-01.bin`
and its colour against VICE's palette triples for the model
(`runtime/vice-reference.md`, "The default palette"): yellow (255, 255,
70) PAL and (255, 248, 141) NTSC, red (175, 60, 88) and (169, 71, 100).
0 mismatches with the model's final board on PAL and on NTSC. The `SEQ`
rows decoded to the model's 42 columns. The text rows were decoded the
same way and read as quoted above; the border is (98, 213, 50) on PAL
and (114, 189, 103) on NTSC, colour 5 on each.

**Reproducibility.** The pinned command was run twice per model; the PNG
bytes were identical each time.

## Sources

- `cave-scan.md` and `print-number.md`: the CIA1 cascaded timer and the
  raster IRQ frame counter, reused in shape.
- `toolchains/oscar64-reference.md`, "Avoid recursion and function
  pointers": the static call graph and recursion; the cost of the
  recursive form was measured here.
