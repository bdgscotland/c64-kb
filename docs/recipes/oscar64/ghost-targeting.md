---
recipe: ghost-targeting
toolchain: oscar64
output_format: PRG
region: both
techniques: [ghost_target_tile_ai]
file_formats: [PRG]
uses_registers: [D000, D001, D010, D011, D015, D020, D021, D027, D028, D029, D02A, D02B, DC06, DC07, DC0F]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 Ghost Targeting: maze-chase ghosts steered by target tiles, checked against a model

## Synopsis

Four ghosts (sprites) chase a Pac-Man stand-in through an original
27 x 22 character maze by the arcade's target-tile rule: at each
junction, one tile ahead, a ghost takes the non-reversing exit whose
next tile is nearest its target, ties going up, left, down, right. Each
ghost has its own chase target, fixed scatter corners outside the maze,
and a PRNG in frightened mode. A mode timer runs the level-1
scatter/chase table with each arcade second shortened to 16 frames, and
one frightened spell starts at frame 400. The stand-in runs a scripted
loop, so no joystick is needed, and faces up on one leg of it, so the
up-direction bug that the listing reproduces is exercised. Pass 1 runs
1,600 frames on screen and folds the four ghost tiles into a checksum
every frame; every 100 frames the checksum is compared with a Python
model of the same rules, compiled in. Then, with the display off, a
bench times one decision and two built worst frames, and pass 2 reruns
the 1,600 frames under the CIA1 timer. `$02FF` = `01` and a green
border on pass, `02` and red on fail. This is `ghost_target_tile_ai` in
`docs/techniques/logic.md`; the result-byte contract is
`headless-verify.md`.

## Source

```c
// ghost-targeting.c
//
// Maze-chase ghost AI by target tiles. Four ghosts and a Pac-Man stand-in
// move one tile every 4 frames through a character maze. On entering a
// tile a ghost looks one tile ahead along its heading and picks the exit
// it will take there: of the exits that do not reverse, the one whose next
// tile is nearest its target tile by squared straight-line distance, ties
// going up, left, down, right. A tile with one such exit costs no distance
// sums. Chase targets: Blinky the stand-in's tile; Pinky 4 tiles ahead of
// it; Inky the tile 2 ahead, doubled from Blinky; Clyde the stand-in's
// tile when more than 8 tiles away, else his corner. Scatter targets are
// fixed tiles outside the maze. A mode timer runs the level-1 scatter and
// chase table with each arcade second shortened to 16 frames; every
// scatter/chase switch and the start of frightened mode reverse every
// ghost; frightened ghosts try a pseudo-random exit first and the timer
// pauses. The "up" offset bug of Pinky and Inky is reproduced (UP_BUG).
// Pass 1 runs 1600 frames on screen: each frame the four ghost tiles are
// folded into a checksum, compared every 100 frames with the Python
// model's value compiled in below. Then, with the display and sprites off,
// a bench times single decisions and two built worst frames, and pass 2
// reruns the 1600 frames back to back under the CIA1 timer.
// Row 0: frame, phase, decisions, empty timer pair, worst frame with
// frightened. Row 1: CIA1 cycles for one 3-way decision, one 1-exit tile,
// the built worst frame, the worst frame of the run. Row 2: checksum,
// checkpoints matched, result. $02FF = 01 and a green border on pass, 02
// and red on fail.
// Build: oscar64 -tm=c64 -O2 -o=ghost-targeting.prg ghost-targeting.c
#include <c64/vic.h>
#include <c64/cia.h>
#include <string.h>

#define SCREEN ((char *)0x0400)
#define COLOUR ((char *)0xd800)
#define SPRPTR ((char *)0x07f8)
#define SPRDATA ((char *)0x0340)          // blocks 13 and 14, cassette buffer
#define RESULT (*(volatile char *)0x02ff)
#define CODE_PASS 0x01
#define CODE_FAIL 0x02

// The maze: '#' wall, '.' path. No dead ends, so a ghost that may not
// reverse always has an exit. Tile (x, y) is screen column x + 1, row y + 3.
#define MW 27
#define MH 22
#define COL0 1
#define ROW0 3
const char maze[MH][MW + 1] = {
    "###########################",
    "#............#............#",
    "#.####.#####.#.#####.####.#",
    "#.####.#####.#.#####.####.#",
    "#.........................#",
    "#.####.#.#########.#.####.#",
    "#......#.....#.....#......#",
    "######.#####.#.#####.######",
    "######.#...........#.######",
    "######.#.#########.#.######",
    "######...#########...######",
    "######.#.#########.#.######",
    "######.#...........#.######",
    "######.#.#########.#.######",
    "#............#............#",
    "#.####.#####.#.#####.####.#",
    "#...##...............##...#",
    "###.##.#.#########.#.##.###",
    "#......#.....#.....#......#",
    "#.##########.#.##########.#",
    "#.........................#",
    "###########################",
};

// Directions in tie order: the lowest number wins a tie.
#define UP 0
#define LEFT 1
#define DOWN 2
#define RIGHT 3
const signed char dx[4] = { 0, -1, 0, 1 };
const signed char dy[4] = { -1, 0, 1, 0 };
const char bit[4] = { 1, 2, 4, 8 };
// Lowest set bit of a 4-bit exit mask, as a direction.
const char first_dir[16] = { 0, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0 };

char exits[MH][32];                        // bit d set: the tile in direction d is open;
                                           // a row stride of 32 makes the index a shift
unsigned sq[64];                           // sq[n] = n * n; |d| < 58 in this maze

#define UP_BUG 1                           // 1 reproduces the arcade's up offset bug
#define SEC 16                             // frames per arcade second
#define NPHASE 7                           // phase 7 is chase for good
const unsigned phase_len[NPHASE] = {
    7 * SEC, 20 * SEC, 7 * SEC, 20 * SEC, 5 * SEC, 20 * SEC, 5 * SEC
};
#define ENERGIZER_FRAME 400
#define FRIGHT_LEN (6 * SEC)
#define STEP 4
#define FRAMES 1600

// Ghost 0 Blinky, 1 Pinky, 2 Inky, 3 Clyde.
const signed char corner_x[4] = { 24, 2, 26, 0 };
const signed char corner_y[4] = { -3, -3, 24, 24 };
const signed char start_x[4] = { 13, 13, 1, 25 };
const signed char start_y[4] = { 8, 12, 20, 20 };
const char start_d[4] = { LEFT, RIGHT, RIGHT, LEFT };

// The stand-in's loop: straight runs between these tiles.
#define NWP 8
const signed char wp_x[NWP] = { 6, 6, 12, 12, 25, 25, 20, 20 };
const signed char wp_y[NWP] = { 16, 1, 1, 4, 4, 6, 6, 16 };

// From ghost_model.py: the checksum after frames 100, 200, ... 1600.
#define NCK 16
const unsigned exp_ck[NCK] = {
    0x5870, 0x4080, 0xdece, 0x11aa, 0xf808, 0x2f38, 0xc4d2, 0xf482,
    0xa896, 0x57fc, 0x9cce, 0x6be2, 0x03cc, 0x9a8c, 0x7050, 0xe89a
};
#define EXP_DECISIONS 382

signed char gx[4], gy[4];
char gcur[4], gplan[4], gcame[4];          // heading, exit planned at the next tile, last move
signed char tx[4], ty[4];                  // target tiles
signed char px, py;
char pdir, pwk;
char phase, fright;
unsigned mode_t, fright_left, rng = 0xace1;
unsigned decisions;

static inline unsigned sqd(signed char v)
{
    if (v < 0)
        v = -v;
    return sq[v];
}

static inline char chasing(void)
{
    return (phase & 1) || phase == NPHASE;
}

unsigned rand16(void)
{
    rng ^= rng << 7;
    rng ^= rng >> 9;
    rng ^= rng << 8;
    return rng;
}

void set_target(char g)
{
    if (!chasing()) {
        tx[g] = corner_x[g];
        ty[g] = corner_y[g];
        return;
    }
    signed char ax, ay;
    switch (g) {
    case 0:
        tx[0] = px; ty[0] = py;
        break;
    case 1:
    case 2: {
        signed char n = g == 1 ? 4 : 2;
        ax = px + n * dx[pdir];
        ay = py + n * dy[pdir];
        if (UP_BUG && pdir == UP)
            ax -= n;
        if (g == 1) {
            tx[1] = ax; ty[1] = ay;
        } else {
            tx[2] = 2 * ax - gx[0];
            ty[2] = 2 * ay - gy[0];
        }
        break;
    }
    default:
        if (sqd(gx[3] - px) + sqd(gy[3] - py) > 64) {
            tx[3] = px; ty[3] = py;
        } else {
            tx[3] = corner_x[3]; ty[3] = corner_y[3];
        }
    }
}

// The exit ghost g takes at tile (x, y), arriving with heading d.
char choose(signed char x, signed char y, char d, char g)
{
    char m = exits[y][x] & ~bit[d ^ 2];
    if (!(m & (m - 1)))                    // one exit: no decision
        return first_dir[m];
    decisions++;
    if (fright) {
        char r = rand16() & 3;
        return (m & bit[r]) ? r : first_dir[m];
    }
    signed char ex = x - tx[g], ey = y - ty[g];
    unsigned best = 0xffff;
    char bd = 0;
    for (char k = 0; k < 4; k++)
        if (m & bit[k]) {
            unsigned dd = sqd(ex + dx[k]) + sqd(ey + dy[k]);
            if (dd < best) {
                best = dd;
                bd = k;
            }
        }
    return bd;
}

void reverse_all(void)
{
    for (char g = 0; g < 4; g++) {
        char d = gcame[g] ^ 2;             // back the way it came
        gcur[g] = d;
        set_target(g);
        gplan[g] = choose(gx[g] + dx[d], gy[g] + dy[d], d, g);
    }
}

void ghost_step(char g)
{
    char d = gcur[g];
    gx[g] += dx[d];
    gy[g] += dy[d];
    gcame[g] = d;
    d = gplan[g];
    gcur[g] = d;
    set_target(g);
    gplan[g] = choose(gx[g] + dx[d], gy[g] + dy[d], d, g);
}

char toward(char k)
{
    if (wp_x[k] > px) return RIGHT;
    if (wp_x[k] < px) return LEFT;
    if (wp_y[k] > py) return DOWN;
    return UP;
}

void pac_step(void)
{
    px += dx[pdir];
    py += dy[pdir];
    if (px == wp_x[pwk] && py == wp_y[pwk]) {
        pwk++;
        if (pwk == NWP)
            pwk = 0;
        pdir = toward(pwk);
    }
}

// The technique's work for one frame, in two parts: the mode timer, then
// on a step frame every ghost's move, target and look-ahead decision. The
// stand-in moves between the two.
void mode_tick(unsigned f)
{
    if (fright) {
        if (--fright_left == 0)
            fright = 0;                    // no reversal leaving frightened
    } else if (phase < NPHASE) {
        if (++mode_t == phase_len[phase]) {
            phase++;
            mode_t = 0;
            reverse_all();
        }
    }
    if (f == ENERGIZER_FRAME) {
        fright = 1;
        fright_left = FRIGHT_LEN;
        reverse_all();
    }
}

void init_actors(void)
{
    phase = 0; mode_t = 0; fright = 0; rng = 0xace1;
    px = wp_x[0]; py = wp_y[0]; pwk = 1;
    pdir = toward(1);
    for (char g = 0; g < 4; g++) {
        gx[g] = start_x[g];
        gy[g] = start_y[g];
        gcur[g] = gcame[g] = start_d[g];
    }
    for (char g = 0; g < 4; g++) {
        set_target(g);
        char d = gcur[g];
        gplan[g] = choose(gx[g] + dx[d], gy[g] + dy[d], d, g);
    }
    decisions = 0;
}

// --- CIA1 timer B ----------------------------------------------------------
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

// A built worst frame: scatter ends this frame, so every ghost reverses
// and makes a 3-way decision at the 4-way junction (6, 14) it just left;
// then it steps, and its look-ahead lands on the same junction heading up,
// another 3-way decision, with chase targets (the stand-in faces up, the
// bug path). Given f = ENERGIZER_FRAME, frightened mode starts in the same
// frame: a second reversal, and the step's decisions go to the PRNG. The
// state set-up between the two timed parts is outside the timer.
unsigned worst_frame(unsigned f)
{
    init_actors();
    phase = 0;
    mode_t = phase_len[0] - 1;
    px = 13; py = 16; pdir = UP;
    for (char g = 0; g < 4; g++) {
        gx[g] = 6; gy[g] = 13; gcame[g] = UP;
    }
    timer_start();
    mode_tick(f);
    unsigned t = timer_stop();
    for (char g = 0; g < 4; g++) {
        gx[g] = 6; gy[g] = 16; gcur[g] = UP; gplan[g] = UP;
    }
    timer_start();
    for (char g = 0; g < 4; g++)
        ghost_step(g);
    return t + timer_stop();
}

// --- screen ------------------------------------------------------------------
void put_str(char *p, const char *s)
{
    while (*s)
        *p++ = *s++;
}

void put_dec(char *p, unsigned v, char digits)
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
        p[i - 1] = n < 10 ? 0x30 + n : n - 9;
        v >>= 4;
    }
}

// Ghost g is a 4 x 4 block in quadrant g of its tile, so no two ghosts
// hide each other; the stand-in is an 8 x 8 ring under them.
void place_sprites(void)
{
    for (char g = 0; g < 4; g++) {
        vic.spr_pos[g].x = 24 + 8 * (COL0 + gx[g]) + 4 * (g & 1);
        vic.spr_pos[g].y = 50 + 8 * (ROW0 + gy[g]) + 4 * (g >> 1);
    }
    vic.spr_pos[4].x = 24 + 8 * (COL0 + px);
    vic.spr_pos[4].y = 50 + 8 * (ROW0 + py);
}

int main(void)
{
    __asm { sei }
    vic.color_border = VCOL_BLACK;
    vic.color_back = VCOL_BLACK;
    memset(SCREEN, 0x20, 1000);
    memset(COLOUR, VCOL_LT_GREY, 1000);

    for (char i = 0; i < 64; i++)
        sq[i] = (unsigned)i * i;
    for (char y = 0; y < MH; y++)
        for (char x = 0; x < MW; x++) {
            unsigned o = (y + ROW0) * 40 + x + COL0;
            char e = 0;
            if (maze[y][x] == '#') {
                SCREEN[o] = 0xa0;
                COLOUR[o] = VCOL_BLUE;
            } else {
                SCREEN[o] = 0x2e;
                COLOUR[o] = VCOL_DARK_GREY;
                for (char k = 0; k < 4; k++) {
                    signed char nx = x + dx[k], ny = y + dy[k];
                    if (nx >= 0 && nx < MW && ny >= 0 && ny < MH && maze[ny][nx] != '#')
                        e |= bit[k];
                }
            }
            exits[y][x] = e;
        }

    // Sprite shapes: block 13 a 4 x 4 block, block 14 an 8 x 8 ring.
    memset(SPRDATA, 0, 128);
    for (char r = 0; r < 4; r++)
        SPRDATA[r * 3] = 0xf0;
    SPRDATA[64] = 0xff;
    SPRDATA[64 + 21] = 0xff;
    for (char r = 1; r < 7; r++)
        SPRDATA[64 + r * 3] = 0x81;
    for (char s = 0; s < 4; s++)
        SPRPTR[s] = 13;
    SPRPTR[4] = 14;
    vic.spr_color[0] = VCOL_RED;
    vic.spr_color[1] = VCOL_LT_RED;
    vic.spr_color[2] = VCOL_CYAN;
    vic.spr_color[3] = VCOL_ORANGE;
    vic.spr_color[4] = VCOL_YELLOW;
    vic.spr_msbx = 0;
    vic.spr_enable = 0x1f;

    // Pass 1, on screen: one frame per frame, the ghost tiles folded into
    // the checksum every frame and checked every 100 frames.
    init_actors();
    place_sprites();
    put_str(SCREEN,      s"f      ph   dec       tmr    bnf");
    put_str(SCREEN + 40, s"dec      one      bnd       wst");
    put_str(SCREEN + 80, s"ck       ok    r");
    unsigned ck = 0;
    char ok = 0;
    for (unsigned f = 1; f <= FRAMES; f++) {
        vic_waitFrame();
        mode_tick(f);
        if ((f & (STEP - 1)) == 0) {
            pac_step();
            for (char g = 0; g < 4; g++)
                ghost_step(g);
        }
        place_sprites();
        for (char g = 0; g < 4; g++) {     // the per-frame log
            ck = ck * 33 + (char)gx[g];
            ck = ck * 33 + (char)gy[g];
        }
        if (f % 100 == 0 && ck == exp_ck[f / 100 - 1])
            ok++;
        put_dec(SCREEN + 2, f, 4);
        put_dec(SCREEN + 10, phase, 1);
        put_dec(SCREEN + 16, decisions, 4);
        put_hex(SCREEN + 83, ck);
    }
    unsigned dec1 = decisions;
    signed char end_x[4], end_y[4];
    for (char g = 0; g < 4; g++) {
        end_x[g] = gx[g];
        end_y[g] = gy[g];
    }

    // Display off (no badlines) and sprites off (no sprite DMA) from the
    // next frame, so the CIA counts only the CPU's own cycles.
    vic.spr_enable = 0;
    vic.ctrl1 &= ~VIC_CTRL1_DEN;
    vic_waitFrame();

    // Bench: one 3-way decision (a 4-way junction entered from below,
    // chase targets) and one 1-exit tile, worst of the four ghosts.
    init_actors();
    phase = 1;
    px = 13; py = 16; pdir = UP;
    unsigned t_empty, t_dec = 0, t_one = 0;
    timer_start();
    t_empty = timer_stop();
    for (char g = 0; g < 4; g++) {
        set_target(g);
        timer_start();
        choose(6, 14, UP, g);
        unsigned t = timer_stop();
        if (t > t_dec) t_dec = t;
        timer_start();
        choose(3, 17, DOWN, g);
        t = timer_stop();
        if (t > t_one) t_one = t;
    }
    unsigned t_bound = worst_frame(1);
    unsigned t_bound_fr = worst_frame(ENERGIZER_FRAME);

    // Pass 2, timed: the same 1600 frames of logic back to back, the worst
    // frame of the technique's own work (the stand-in's move is outside
    // the timer). Its end tiles must equal pass 1's.
    init_actors();
    unsigned t_worst = 0;
    for (unsigned f = 1; f <= FRAMES; f++) {
        timer_start();
        mode_tick(f);
        unsigned t = timer_stop();
        if ((f & (STEP - 1)) == 0) {
            pac_step();
            timer_start();
            for (char g = 0; g < 4; g++)
                ghost_step(g);
            t += timer_stop();
        }
        if (t > t_worst) t_worst = t;
    }
    char same = decisions == dec1;
    for (char g = 0; g < 4; g++)
        if (gx[g] != end_x[g] || gy[g] != end_y[g])
            same = 0;

    vic.ctrl1 |= VIC_CTRL1_DEN;
    vic.spr_enable = 0x1f;
    put_dec(SCREEN + 26, t_empty, 2);
    put_dec(SCREEN + 44, t_dec, 4);
    put_dec(SCREEN + 53, t_one, 4);
    put_dec(SCREEN + 62, t_bound, 5);
    put_dec(SCREEN + 72, t_worst, 5);
    put_dec(SCREEN + 33, t_bound_fr, 5);

    char fault = 0;
    if (ok != NCK) fault = 1;
    else if (dec1 != EXP_DECISIONS) fault = 2;
    else if (!same) fault = 3;
    put_dec(SCREEN + 92, ok, 2);
    char code = fault ? CODE_FAIL : CODE_PASS;
    RESULT = code;
    vic.color_border = fault ? VCOL_RED : VCOL_GREEN;
    SCREEN[80 + 16] = 0x30 + code;
    SCREEN[80 + 17] = 0x30 + fault;
    for (;;)
        ;
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=ghost-targeting.prg ghost-targeting.c
```

Oscar64 1.32.271 builds it with no warnings; the PRG is 4,247 bytes.

The checksums, the decision count and the end tiles come from this
script (Python 3). It restates the rules independently of the C: the
same maze, targets, tie order, look-ahead, reversals, timer and PRNG.
It prints the sixteen `exp_ck` values, `decisions 382 phase 7`, and
the end tiles `ghosts [(19, 16), (17, 14), (20, 9), (9, 18)] pac (14, 16)`.

```python
# ghost_model.py: the reference for ghost-targeting.c. Same maze and
# rules, written again in Python; prints the checkpoint checksums, the
# decision count and the final tiles the listing compiles in.
MAZE = [
    "###########################",
    "#............#............#",
    "#.####.#####.#.#####.####.#",
    "#.####.#####.#.#####.####.#",
    "#.........................#",
    "#.####.#.#########.#.####.#",
    "#......#.....#.....#......#",
    "######.#####.#.#####.######",
    "######.#...........#.######",
    "######.#.#########.#.######",
    "######...#########...######",
    "######.#.#########.#.######",
    "######.#...........#.######",
    "######.#.#########.#.######",
    "#............#............#",
    "#.####.#####.#.#####.####.#",
    "#...##...............##...#",
    "###.##.#.#########.#.##.###",
    "#......#.....#.....#......#",
    "#.##########.#.##########.#",
    "#.........................#",
    "###########################",
]
MW, MH = 27, 22
DX, DY = (0, -1, 0, 1), (-1, 0, 1, 0)          # up, left, down, right
UP = 0
UP_BUG = True
SEC = 16                                        # frames per arcade second
PHASES = [7, 20, 7, 20, 5, 20, 5]               # level 1: S C S C S C S, then C
ENERGIZER_FRAME, FRIGHT_LEN = 400, 6 * SEC
FRAMES, STEP = 1600, 4
CORNER = [(24, -3), (2, -3), (26, 24), (0, 24)]
START = [(13, 8, 1), (13, 12, 3), (1, 20, 3), (25, 20, 1)]   # x, y, heading
WP = [(6, 16), (6, 1), (12, 1), (12, 4), (25, 4), (25, 6), (20, 6), (20, 16)]

def open_(x, y):
    return 0 <= x < MW and 0 <= y < MH and MAZE[y][x] != '#'

EXITS = [[sum(1 << d for d in range(4) if open_(x + DX[d], y + DY[d]))
          if open_(x, y) else 0 for x in range(MW)] for y in range(MH)]

def check_maze():
    for y in range(MH):
        assert len(MAZE[y]) == MW
        for x in range(MW):
            if open_(x, y):
                assert bin(EXITS[y][x]).count('1') >= 2, ('dead end', x, y)

class Sim:
    def __init__(s):
        s.rng = 0xACE1
        s.phase, s.mode_t, s.fright, s.fright_left = 0, 0, False, 0
        s.g = [[x, y, d, 0, d] for x, y, d in START]   # x, y, cur, plan, came
        s.t = [(0, 0)] * 4
        s.px, s.py = WP[0]; s.wk = 1; s.pdir = s.toward(WP[1])
        s.decisions = 0
        for i in range(4):
            s.target(i)
            x, y, d, _, _ = s.g[i]
            s.g[i][3] = s.choose(x + DX[d], y + DY[d], d, i)
        s.decisions = 0                         # the listing counts from here

    def toward(s, w):
        if w[0] > s.px: return 3
        if w[0] < s.px: return 1
        if w[1] > s.py: return 2
        return 0

    def chase(s):
        return s.phase & 1 or s.phase == 7

    def rand(s):
        x = s.rng
        x ^= (x << 7) & 0xFFFF
        x ^= x >> 9
        x ^= (x << 8) & 0xFFFF
        s.rng = x
        return x

    def target(s, i):
        if not s.chase():
            s.t[i] = CORNER[i]; return
        px, py, d = s.px, s.py, s.pdir
        if i == 0:
            s.t[i] = (px, py)
        elif i in (1, 2):
            n = 4 if i == 1 else 2
            ax, ay = px + n * DX[d], py + n * DY[d]
            if UP_BUG and d == UP:
                ax -= n
            if i == 1:
                s.t[i] = (ax, ay)
            else:
                bx, by = s.g[0][0], s.g[0][1]
                s.t[i] = (2 * ax - bx, 2 * ay - by)
        else:
            cx, cy = s.g[3][0], s.g[3][1]
            s.t[i] = (px, py) if (cx - px) ** 2 + (cy - py) ** 2 > 64 else CORNER[3]

    def choose(s, x, y, d, i):
        m = EXITS[y][x] & ~(1 << (d ^ 2))
        first = next(k for k in range(4) if m >> k & 1)
        if m & (m - 1) == 0:
            return first
        s.decisions += 1
        if s.fright:
            r = s.rand() & 3
            return r if m >> r & 1 else first
        tx, ty = s.t[i]
        best, bd = None, 0
        for k in range(4):
            if m >> k & 1:
                dd = (x + DX[k] - tx) ** 2 + (y + DY[k] - ty) ** 2
                if best is None or dd < best:
                    best, bd = dd, k
        return bd

    def reverse_all(s):
        for i in range(4):
            g = s.g[i]
            g[2] = g[4] ^ 2                     # back the way it came
            s.target(i)
            g[3] = s.choose(g[0] + DX[g[2]], g[1] + DY[g[2]], g[2], i)

    def ghost_step(s, i):
        g = s.g[i]
        g[0] += DX[g[2]]; g[1] += DY[g[2]]
        assert open_(g[0], g[1])
        g[4] = g[2]
        g[2] = g[3]
        s.target(i)
        g[3] = s.choose(g[0] + DX[g[2]], g[1] + DY[g[2]], g[2], i)

    def pac_step(s):
        s.px += DX[s.pdir]; s.py += DY[s.pdir]
        assert open_(s.px, s.py)
        if (s.px, s.py) == WP[s.wk]:
            s.wk = (s.wk + 1) % len(WP)
            s.pdir = s.toward(WP[s.wk])

    def tick(s, f):
        if s.fright:
            s.fright_left -= 1
            if s.fright_left == 0:
                s.fright = False
        elif s.phase < 7:
            s.mode_t += 1
            if s.mode_t == PHASES[s.phase] * SEC:
                s.phase += 1; s.mode_t = 0
                s.reverse_all()
        if f == ENERGIZER_FRAME:
            s.fright, s.fright_left = True, FRIGHT_LEN
            s.reverse_all()
        if f % STEP == 0:
            s.pac_step()
            for i in range(4):
                s.ghost_step(i)

def run():
    check_maze()
    s = Sim()
    ck, cks = 0, []
    for f in range(1, FRAMES + 1):
        s.tick(f)
        for g in s.g:
            for b in (g[0], g[1]):
                ck = (ck * 33 + (b & 0xFF)) & 0xFFFF
        if f % 100 == 0:
            cks.append(ck)
    return s, cks

if __name__ == '__main__':
    s, cks = run()
    print('exp_ck', ', '.join('0x%04x' % c for c in cks))
    print('decisions', s.decisions, 'phase', s.phase)
    print('ghosts', [(g[0], g[1]) for g in s.g], 'pac', (s.px, s.py))
```

## Expected output

Black background, a blue maze with grey dots on the paths, and five
sprites: four 4 x 4 blocks, red (Blinky), light red (Pinky), cyan
(Inky) and orange (Clyde), each in its own quadrant of its tile so none
hides another, and a yellow 8 x 8 ring (the stand-in) under them. The
border is green: (98, 213, 50) on PAL, (114, 189, 103) on NTSC.

HUD at 38,000,000 cycles (measured in VICE x64sc 3.10, decoded against
the character ROM), identical on PAL and NTSC:

| Row | Text |
|---|---|
| 0 | `F 1600 PH 7 DEC 0382  TMR 05 BNF 07227` |
| 1 | `DEC 0578 ONE 0089 BND 06943 WST 04171` |
| 2 | `CK E89A  OK 16 R10` |

`F` is the frame, `PH 7` the last phase (chase for good), `DEC` on row
0 the decisions made in pass 1, equal to the model's 382. `TMR` is the
empty timer pair. Row 1 is CIA1 cycles: `DEC` one 3-way decision, `ONE`
a 1-exit tile, `BND` the built worst frame (scatter ends: every ghost
reverses onto a 4-way junction, then steps onto another 3-way decision)
and `WST` the worst frame of pass 2. `BNF` on row 0 is the built worst
frame with frightened mode starting in it as well. `CK` is the final
checksum, `OK 16` the checkpoints that matched, `R 10` result code 1,
fault 0. Fault 1 is a checkpoint mismatch, 2 a decision count that is
not the model's, 3 pass 2 ending on other tiles than pass 1.

The timed figures are the same on both models because the display and
sprites are off while they run: no badlines, no sprite DMA.

Screenshots at 38,000,000 cycles, both after the verdict and each
identical over two runs: `screenshots/ghost-targeting.png` (PAL) and
`screenshots/ghost-targeting-ntsc.png` (NTSC). Measured on both with
PIL: each ghost's colour covers exactly one 4 x 4 block, in the
quadrant of the tile the model ends on, (19, 16), (17, 14), (20, 9) and
(9, 18), and the whole 28-pixel yellow ring is at (14, 16). A sprite
at Y = 50 + 8r first shows on raster line 51 + 8r, the top line of text
row r, so sprites and characters line up. The script, with the model
saved as `ghost_model.py`:

```python
from PIL import Image
import ghost_model
PAL = {'top': 35, 'ghosts': [(175, 60, 88), (238, 123, 149), (126, 243, 214), (183, 99, 30)],
       'pac': (255, 255, 70)}
NTSC = {'top': 23, 'ghosts': [(169, 71, 100), (230, 134, 163), (138, 230, 203), (196, 98, 65)],
        'pac': (255, 248, 141)}
def tiles(png, m):
    im = Image.open(png).convert('RGB'); px = im.load()
    def box(c):
        pts = [(x, y) for y in range(im.size[1]) for x in range(im.size[0]) if px[x, y] == c]
        return min(p[0] for p in pts), min(p[1] for p in pts), len(pts)
    y0 = m['top'] + 8 * 3                     # tile row 0 is text row 3
    out = []
    for g, c in enumerate(m['ghosts']):       # ghost g sits in quadrant g
        x, y, n = box(c)
        assert n == 16                        # a whole 4 x 4 block
        out.append(((x - 4 * (g & 1) - 40) // 8, (y - 4 * (g >> 1) - y0) // 8))
    x, y, n = box(m['pac'])
    return out, ((x - 40) // 8, (y - y0) // 8), n
s, _ = ghost_model.run()
want = [(g[0], g[1]) for g in s.g], (s.px, s.py)
for png, m in (('ghost-targeting.png', PAL), ('ghost-targeting-ntsc.png', NTSC)):
    g, p, n = tiles(png, m)
    assert (g, p) == want and n == 28
```

The run exercises every rule. The model counts 90 chase-mode target
computations for Pinky and Inky with the stand-in facing up, the bug
path; Clyde's target takes both values, the stand-in and his corner;
23 of the 382 decisions are frightened ones; and 612 of the 1,632
target computations lie outside the maze (counted by wrapping the model's
`target` and `choose` in counters; the wrapper is not shown).

## Why this works

The exit mask per tile turns the junction test into one AND and one
test: clear the reverse bit, and if one bit is left, the ghost follows
it without arithmetic (89 cycles). Only real junctions pay for distance
sums, one pair of table lookups per candidate, and there are never more
than three candidates (578 cycles). The squares table has 64 entries
because no coordinate difference in this maze reaches 64: the farthest
target, Inky's, is at most 57 tiles from any tile along either axis
(arithmetic from the maze size and the offsets). A larger maze needs a larger table or a
clamp.

The look-ahead follows the arcade's rule. A
ghost decides its turn at tile N+1 as it enters tile N, using the
targets of that moment, and stores it in `gplan`. A forced reversal
turns the ghost back toward the tile it came from (`gcame`), not
against its planned turn, which may point into a wall at a corner, and
plans afresh from there.

The mode timer counts frames, which is right only because the whole
program counts frames: a game that shows the arcade's seconds on both
models must scale the table on NTSC, as `difficulty_ramp_tables` does.
The timer does not advance during frightened mode, and leaving
frightened mode does not reverse the ghosts; both follow the Dossier.

What the listing leaves out: the ghost house and its release rules,
the side tunnels, speeds, the no-up zones, and collisions between ghost
and stand-in. The ghosts start in the maze already moving. Each is a
separate addition to the same loop and does not change the choice
code.
