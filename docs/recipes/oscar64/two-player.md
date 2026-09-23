---
recipe: two-player
toolchain: oscar64
output_format: PRG
region: both
techniques: [two_player_state_swap, joystick_edge_detect, keyboard_matrix_scan]
file_formats: [PRG]
uses_registers: [DC00, DC01, DD04, DD05, DD0E, D000, D001, D012, D015, D020, D027, D028]
uses_kernal: [CHROUT]
---

<!-- doc-type: recipe -->

# Oscar64 two-player: alternating play by state-block swap, and simultaneous play from both control ports

## Synopsis

Two player sprites and one listing that plays two ways. In alternating
play one game runs at a time: each player owns an eight-byte state block
(score, lives, level, cell, random seed) in a two-entry array, and a
death stores the block in play and loads the other player's, so each
player resumes their own game with their own score and their own random
sequence. In simultaneous play both blocks are live and both control
ports are read every frame with the KERNAL IRQ still running. Port 1
shares `$DC01` with the keyboard rows, and the KERNAL leaves `$DC00` at
`$7F` between scans, so a key held in column 7 (1, left-arrow, CTRL, 2,
SPACE) would read as a direction on port 1. The listing writes `$FF` to
`$DC00` right before each `$DC01` read, with the IRQ held off across the
pair so the scan cannot run between them, and counts how many reads it
took with a column selected; the same build with `MITIGATE=0` counts one
per frame and goes red. The mode is a byte written at start from the
`MODE` define; both paths are compiled in. The verdict is the pattern of
`headless-verify.md`: a code at `$02FF`, the border colour, and a line of
text. The technique is `two_player_state_swap` in `techniques/logic.md`.

## Source

```c
// two-player.c
// Two players, two sprites, two ways to share one machine.
// ALTERNATING: one game runs at a time. Each player owns a state block
// (score, lives, level, cell, random seed); on death the block in play is
// stored and the other player's block is loaded, so each resumes their
// own game. SIMULTANEOUS: both control ports are read every frame with
// the KERNAL IRQ live. Port 1 shares $DC01 with the keyboard rows, and
// the KERNAL leaves $DC00 at $7F between scans, so a key in column 7
// would read as a direction; $DC00 is set to $FF right before the $DC01
// read, with the IRQ held off across the pair so the scan cannot run in
// between. The autopilot scripts both ports; the
// program checks the outcome and reports at $02FF, in the border colour
// and on screen.
#include <stdio.h>
#include <c64/vic.h>
#include <c64/cia.h>

#ifndef AUTOPILOT
#define AUTOPILOT 1          // 1: scripted port bytes instead of the ports
#endif
#ifndef MODE
#define MODE      1          // byte written at start: 0 alternating, 1 simultaneous
#endif
#ifndef MITIGATE
#define MITIGATE  1          // 1: set $DC00 to $FF before every $DC01 read
#endif

#define CODE_PASS  0x01
#define CODE_FAIL  0x02
#define RESULT     (*(volatile char *)0x02ff)
#define JOY_MASK   0x1f      // bits 0-4: up, down, left, right, fire
#define FRAMES     40
#define SCREEN     ((char *)0x0400)
#define SPR_DATA   ((char *)0x0340)     // cassette buffer, pointer 13
#define SPR_PTR    ((char *)0x07f8)
#define START_X    2
#define PIT_COL    14        // stepping onto this column is a death
#define MAX_X      28        // keeps sprite x below 256

struct PlayerState {
    unsigned score;          // 10 per cell moved
    char     lives, level;
    char     cx, cy;         // cell, 8 px each
    unsigned rng;            // 16-bit xorshift, stepped once per own frame
};

static struct PlayerState players[2];   // one block per player
static struct PlayerState g;            // the block in play (alternating)
static char cur;                        // whose turn (alternating)
static char mode;                       // 0 alternating, 1 simultaneous
static char raw2, raw1;                 // last port reads, active low
static char colsel, phantom;            // port-1 hazard counters

// ---- per-player step ------------------------------------------------------

static void step(struct PlayerState *p, char port)
{
    char pressed = ~port & JOY_MASK;
    p->rng ^= p->rng << 7;
    p->rng ^= p->rng >> 9;
    p->rng ^= p->rng << 8;
    if ((pressed & 0x01) && p->cy > 0)     { p->cy--; p->score += 10; }
    if ((pressed & 0x02) && p->cy < 24)    { p->cy++; p->score += 10; }
    if ((pressed & 0x04) && p->cx > 0)     { p->cx--; p->score += 10; }
    if ((pressed & 0x08) && p->cx < MAX_X) { p->cx++; p->score += 10; }
}

// Death in alternating play: the block in play goes back to its slot,
// the other player's block comes out, if that player still has lives.
static void swap_on_death(void)
{
    g.lives--;
    g.cx = START_X;
    players[cur] = g;
    if (players[cur ^ 1].lives)
        cur ^= 1;
    g = players[cur];
}

// ---- ports ----------------------------------------------------------------

// Reads both ports from the real registers every frame. With MITIGATE the
// $FF store to $DC00 and the two reads run with the IRQ held off, so the
// KERNAL scan cannot land between them and leave $7F behind; the flags
// are restored, so a caller that already has the IRQ off keeps it off.
// colsel counts reads that found a column line among bits 5-7 of $DC00
// low, the state the scan leaves; phantom counts $DC01 reads with any
// direction bit low.
static char port_a, port_b;             // raw $DC00 and $DC01
static void read_ports(void)
{
#if MITIGATE
    __asm {
        php
        sei
        lda #$ff                        // no keyboard column selected
        sta $dc00
        lda $dc00
        sta port_a
        lda $dc01
        sta port_b
        plp
    }
#else
    port_a = cia1.pra;
    port_b = cia1.prb;
#endif
    raw2 = port_a | ~JOY_MASK;              // port 2 sits on bits 0-4
    if ((port_a | JOY_MASK) != 0xff) colsel++;
    raw1 = port_b | ~JOY_MASK;              // port 1 on the row lines
    if ((raw1 & JOY_MASK) != JOY_MASK) phantom++;
}

#if AUTOPILOT
// { frames, port byte } for port 2 (alternating: the active player).
static const char script2[7][2] = {
    { 12, 0xf7 }, { 3, 0xfd }, { 12, 0xf7 }, { 2, 0xfe }, { 3, 0xf7 },
    { 8, 0xff }, { 0, 0xff }
};
// Port 2 and port 1 in simultaneous play.
static const char sim2[3][2] = { { 8, 0xf7 }, { 4, 0xfd }, { 0, 0xff } };
static const char sim1[3][2] = { { 6, 0xf7 }, { 3, 0xfd }, { 0, 0xff } };

struct Cursor { char idx, used; };
static struct Cursor c2, c1;

static char script_byte(const char (*s)[2], struct Cursor *c)
{
    char out = 0xff;
    if (s[c->idx][0]) {
        out = s[c->idx][1];
        if (++c->used == s[c->idx][0]) { c->used = 0; c->idx++; }
    }
    return out;
}
#endif

// ---- timing: CIA2 timer A, KERNAL IRQ held off for the measured span ---

static unsigned cost, base, swap_cost, read_cost;

static void time_begin(void)
{
    __asm { sei }
    cia2.cra = 0x00;
    cia2.ta  = 0xffff;
    cia2.cra = 0x11;
}

static void time_end(void)
{
    cia2.cra = 0x00;
    cost = 0xffff - cia2.ta;
    __asm { cli }
}

// ---- screen ---------------------------------------------------------------

static void put_str(char pos, const char *s)
{
    char *p = SCREEN + pos;
    while (*s) { char c = *s++; *p++ = (c >= 'A' && c <= 'Z') ? c - 64 : c; }
}

static void put_num(char pos, unsigned v, char digits)
{
    char *p = SCREEN + pos + digits;
    while (digits--) { *--p = '0' + v % 10; v /= 10; }
}

static void hud(void)
{
    put_str(0, "P1 SC");  put_num(6, players[0].score, 5);
    put_str(12, "L");     put_num(13, players[0].lives, 1);
    put_str(20, "P2 SC"); put_num(26, players[1].score, 5);
    put_str(32, "L");     put_num(33, players[1].lives, 1);
    put_str(40, "TURN P"); put_num(46, cur + 1, 1);
    if (mode) put_str(40, "BOTH   ");
}

static void place(char i, const struct PlayerState *p)
{
    vic.spr_pos[i].x = 24 + p->cx * 8;
    vic.spr_pos[i].y = 50 + p->cy * 8;
}

static void wait_frame(void)
{
    while (vic.raster == 250) ;
    while (vic.raster != 250) ;
}

// ---- expected blocks after the alternating script (host model) ----------

static const struct PlayerState exp_alt[2] = {
    { 170, 2, 1, 5, 3, 0xb717 }, { 150, 2, 1, 2, 18, 0x5b98 }
};

static char same(const struct PlayerState *a, const struct PlayerState *b)
{
    return a->score == b->score && a->lives == b->lives && a->level == b->level
        && a->cx == b->cx && a->cy == b->cy && a->rng == b->rng;
}

int main(void)
{
    mode = MODE;                              // the byte the autopilot writes

    for (char i = 0; i < 63; i++)
        SPR_DATA[i] = (i < 3 || i >= 60) ? 0xff : (i % 3 == 0 ? 0x80 : (i % 3 == 2 ? 0x01 : 0x00));
    SPR_PTR[0] = SPR_PTR[1] = 13;
    vic.spr_color[0] = 7; vic.spr_color[1] = 3;
    vic.spr_enable = 0x03;

    for (char i = 0; i < 2; i++) {
        players[i].score = 0; players[i].lives = 3; players[i].level = 1;
        players[i].cx = START_X; players[i].cy = i ? 15 : 5;
        players[i].rng = i ? 0xbeef : 0xace1;
    }
    cur = 0;
    g = players[0];

    for (char f = 0; f < FRAMES; f++) {
        wait_frame();
        read_ports();
#if AUTOPILOT
        char b2 = script_byte(mode ? sim2 : script2, &c2);
        char b1 = script_byte(sim1, &c1);
#else
        char b2 = raw2, b1 = raw1;
#endif
        if (mode) {
            step(&players[0], b2);
            step(&players[1], b1);
        } else {
            step(&g, b2);
            if (g.cx == PIT_COL) swap_on_death();
            players[cur] = g;
        }
        place(0, &players[0]);
        place(1, &players[1]);
        hud();
    }

    char code = CODE_FAIL;
    if (mode) {
        if (players[0].cx == 10 && players[0].cy == 9 && players[1].cx == 8
            && players[1].cy == 18 && phantom == 0 && colsel == 0)
            code = CODE_PASS;
    } else if (same(&players[0], &exp_alt[0]) && same(&players[1], &exp_alt[1])) {
        code = CODE_PASS;
    }

    // Timing, after the verdict, on a copy of everything it touches, in
    // the lower border where no badline or sprite fetch stalls the CPU.
    struct PlayerState keep_g = g;
    char keep_cur = cur, keep_colsel = colsel, keep_phantom = phantom;
    wait_frame(); time_begin(); time_end();                 base = cost;
    wait_frame(); time_begin(); swap_on_death(); time_end(); swap_cost = cost - base;
    wait_frame(); time_begin(); read_ports(); time_end();   read_cost = cost - base;
    g = keep_g; cur = keep_cur; colsel = keep_colsel; phantom = keep_phantom;
    players[cur] = g;

    RESULT = code;
    vic.color_border = (code == CODE_PASS) ? 5 : 2;

    if (mode)
        printf("SIM COLSEL %d PHANTOM %d\n", colsel, phantom);
    else
        printf("ALT P1 %d/%d/%d/%d/%04X P2 %d/%d/%d/%d/%04X\n",
               players[0].score, players[0].lives, players[0].cx, players[0].cy, players[0].rng,
               players[1].score, players[1].lives, players[1].cx, players[1].cy, players[1].rng);
    printf("SWAP %d READ %d RESULT %02X %s\n", swap_cost, read_cost, code,
           code == CODE_PASS ? "PASS" : "FAIL");
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -n -o=two-player.prg two-player.c
```

Produces `two-player.prg`, 5,952 bytes (Oscar64 build 2026-05-19), the
pinned simultaneous build: `AUTOPILOT=1`, `MODE=1`, `MITIGATE=1` are the
defaults behind `#ifndef`. `-n` asks for native code for every
function, which this Oscar64 does by default; it stays on the line
because the screenshots were made with it. Every build writes a map
file. In `two-player.map` the size of `players` is `0010` and the size
of `g` is `0008`: eight bytes per block, sixteen for the pair, one more
block for the copy in play. The addresses move with any edit and are
not quoted. The two other builds this page measures:

```bash
oscar64 -tm=c64 -O2 -dMODE=0 -o=two-player-alt.prg two-player.c        # 6,211 bytes, alternating
oscar64 -tm=c64 -O2 -dMITIGATE=0 -o=two-player-nomit.prg two-player.c  # 5,932 bytes, the red case
```

`exp_alt` comes from a host model of `step()` and `swap_on_death()` run
over the alternating script:

```python
JOY, PIT, MAXX, STARTX = 0x1f, 14, 28, 2
def step(p, port):
    pressed = ~port & JOY
    r = p['rng']
    r ^= (r << 7) & 0xffff; r ^= r >> 9; r ^= (r << 8) & 0xffff
    p['rng'] = r
    if pressed & 1 and p['cy'] > 0: p['cy'] -= 1; p['score'] += 10
    if pressed & 2 and p['cy'] < 24: p['cy'] += 1; p['score'] += 10
    if pressed & 4 and p['cx'] > 0: p['cx'] -= 1; p['score'] += 10
    if pressed & 8 and p['cx'] < MAXX: p['cx'] += 1; p['score'] += 10
players = [dict(score=0, lives=3, level=1, cx=STARTX, cy=5, rng=0xace1),
           dict(score=0, lives=3, level=1, cx=STARTX, cy=15, rng=0xbeef)]
script2 = [(12, 0xf7), (3, 0xfd), (12, 0xf7), (2, 0xfe), (3, 0xf7), (8, 0xff)]
stream = [b for n, b in script2 for _ in range(n)]
cur, g = 0, dict(players[0])
for f in range(40):
    step(g, stream[f] if f < len(stream) else 0xff)
    if g['cx'] == PIT:
        g['lives'] -= 1; g['cx'] = STARTX
        players[cur] = dict(g)
        if players[cur ^ 1]['lives']: cur ^= 1
        g = dict(players[cur])
    players[cur] = dict(g)
for p in players:
    print("{ %d, %d, %d, %d, %d, 0x%04x }" % (p['score'], p['lives'], p['level'], p['cx'], p['cy'], p['rng']))
# { 170, 2, 1, 5, 3, 0xb717 }
# { 150, 2, 1, 2, 18, 0x5b98 }
```

## Expected output

Border green. Row 0 is the HUD, `P1 SC 00120 L3      P2 SC 00090 L3`,
with `BOTH` at the start of row 1 over the BASIC banner. Two hollow
sprites, yellow at cell (10, 9) and cyan at cell (8, 18). Rows 7 and 8:

```
SIM COLSEL 0 PHANTOM 0
SWAP 206 READ 65 RESULT 01 PASS
```

Screenshots from the pinned run, 8,000,000 cycles:
`screenshots/two-player.png` (PAL) and `screenshots/two-player-ntsc.png`
(NTSC). Measured on both with the char ROM decoder and PIL: the two rows
above on screen rows 7 and 8; border pixel (2, 100) = (98, 213, 50) on
PAL and (114, 189, 103) on NTSC, index 5 in both palettes of
`runtime/vice-reference.md`; the top row of sprite 0 at pixel
(114, 107) on PAL reads (255, 255, 70), index 7, and the top row of
sprite 1 at (98, 179) reads (126, 243, 214), index 3, which are the
pixels of cells (10, 9) and (8, 18) with the text area's origin at
(32, 35); on NTSC the same cells with the origin at (32, 23). Each
picture was produced twice by the pinned command and the two files were
identical bytes.

The alternating build, `-dMODE=0`, was run on PAL and NTSC and not
pinned. The HUD reads `P1 SC 00170 L2      P2 SC 00150 L2`, `TURN P1`
at the start of row 1, the sprites at cells (5, 3) and (2, 18), and rows
7 to 9:

```
ALT P1 170/2/5/3/B717 P2 150/2/2/18/5B98

SWAP 206 READ 65 RESULT 01 PASS
```

The fields are score, lives, cx, cy and rng for each block, and they
match `exp_alt` on both models. Player 1 walked twelve cells right into
the pit at column 14, lost a life and went back to column 2; player 2
then played fifteen frames (three down, twelve right) into the same pit;
player 1 resumed at their own cell (2, 5) with their own seed and moved
two up and three right. The script is forty frames and the loop runs
forty. Player 1's seed advanced 25 times (12 + 2 + 3 + 8 frames),
player 2's 15 times (3 + 12), and the blocks hold different seeds
because neither stepped while the other played.

The red case, `-dMITIGATE=0`, was run on PAL and NTSC and not pinned:
the same simultaneous screen with `SIM COLSEL 40 PHANTOM 0` on row 7,
`SWAP 206 READ 39 RESULT 02 FAIL` on row 8 and the border at
(175, 60, 88) on PAL, (169, 71, 100) on NTSC, index 2. Forty frames,
forty reads taken with column 7 selected. The mitigation costs 26
cycles a frame against this build, 39 to 65: the `php`, `sei` and
`plp`, the store, and the two reads going through memory. `PHANTOM` is 0 in both builds
because a headless run holds no key; see "What the counters can and
cannot show".

## Why this works

**The block.** `struct PlayerState` is eight bytes: `score` and `rng`
are `unsigned` (16 bits in Oscar64), the other four are `char`. The map
file confirms it: `players` has size `0010`, sixteen bytes for two, and
`g` has size `0008`. Everything that makes a player's
game theirs is in the block, including the random seed, so a swap
cannot leak one player's random sequence into the other's game. Nothing
outside the block is per player; the sprite positions are recomputed
from the blocks every frame by `place()`, and the HUD is redrawn from
both blocks.

**The swap.** `swap_on_death()` is three assignments and a compare: take
the life, reset the cell, store `g` into `players[cur]`, flip `cur` if
the other player still has lives, load `g` from `players[cur]`. Oscar64
compiles the two struct assignments as eight-byte copies. Measured with
CIA2 timer A, KERNAL IRQ held off with `sei` and the span started in the
lower border after a `wait_frame()`, net of an empty start-stop span:
206 cycles on PAL and on NTSC. The first measurement, taken wherever the
raster happened to be, gave 206 on one run and 249 on another; the
difference was a badline or the sprite fetch stalling the CPU inside the
span, which is why the timed spans wait for line 250 first. The game
loop keeps the block in play in `g` and writes it back to `players[cur]`
each frame, so the array is always current and the end-of-run check
reads the array alone.

**Port 1 with the KERNAL live.** The KERNAL's jiffy IRQ calls SCNKEY,
which drives `$DC00` and reads `$DC01`, and leaves `$DC00` at `$7F` on
its way out, column 7 selected. A main-loop read cannot land inside the
scan (`pitfalls/input.md`, joystick2_scan_phantom_press, measured
there), so a read between scans sees what the scan left: with column 7
selected, a held 1, left-arrow, CTRL, 2 or SPACE grounds a row line and
reads as up, down, left, right or fire on `$DC01`. `read_ports()`
therefore writes `$FF` to `$DC00` first, selecting no column, and reads
`$DC01` after.

The store alone is not enough, and an earlier draft of this page said
it was. The jiffy IRQ comes from CIA1 timer A every 16,422 cycles on
PAL and 17,046 on NTSC (`hardware/cia-reference.md`), the game loop is
locked to the raster, so the interrupt drifts through the loop and can
be taken between the store and the read. When it is, SCNKEY runs, puts
`$7F` back, and the read that follows is taken with column 7 selected
after all. Measured, PAL, windowless VICE: the bare store-then-read
shape called 50,000 times in a tight loop with the IRQ live found `$7F`
on the read right after the store 9 times, and finished the `$DC01`
read with `$DC00` back at `$7F` 63 times; the reviewer's run of the
same shape gave 14 and 92. Per frame the odds are the window over the
timer period. The compiled window from the store to the `$DC01` read
was 19 cycles, so about one frame in 860 on PAL and one in 900 on NTSC,
a few times a minute in a real game; the 0 of 40 frames this page
first reported was a small sample of that, not proof. The listing now
holds the interrupt off across the pair: `php`, `sei`, the store, the
two reads, `plp`. The interrupt waits 22 cycles and is taken right
after, so no scan is lost, and the flags are restored rather than
cleared, so the timed spans, which already run under `sei`, keep it
off. The same 50,000-iteration loop with the held-off shape found `$7F`
after the store 0 times. The direction registers are left as IOINIT set
them; a program that clears `$DC02` kills the keyboard
(`pitfalls/input.md`, cia1_ddr_cleared_kills_keyboard). `$DC00` is read
for port 2 inside the same held-off span, before `$DC01`; with `$FF` in
the latch the low five bits are the stick and nothing else.

**What the counters can and cannot show.** `colsel` counts reads taken
while any of bits 5 to 7 of `$DC00` was low, which is what the KERNAL's
`$7F` looks like from the main loop. With the held-off store it is 0 in
40 frames; without it, 40 in 40, on both models: every unmitigated read
happens in the state where a held column-7 key would be a phantom
direction. `phantom` counts `$DC01` reads with any direction bit low.
It is 0 in both builds here because the harness cannot hold a key:
VICE's keyboard feed and `-keybuf` write the KERNAL buffer at `$0277`,
not the matrix, so nothing grounds a row line in a headless run. The
phantom itself, a held SPACE reading as fire on port 1 with `$DC00` at
`$7F`, follows from the matrix wiring in `hardware/cia-reference.md`
and is stated by both input pages; it was not measured here. What was
measured is the precondition, and that the mitigation removes it on
every frame.

**The mode byte.** `mode` is one variable set at the top of `main()`
from the `MODE` define; both paths are always compiled, and the loop
branches on the byte each frame. A real front end would set it from a
menu; the autopilot sets it so one listing pins both.

**The autopilot.** `script_byte()` walks a `{ frames, port byte }`
table per port, active low as the ports read it, and `read_ports()` is
still called every frame so the counters measure the real registers.
Without `AUTOPILOT` the two `raw` bytes drive the game and the
mode-specific checks fail on an idle machine, which is the expected red
in that build.

Verified: compiled with Oscar64 (build 2026-05-19), run headless in VICE
x64sc 3.10 with the pinned command on PAL and NTSC; the screenshots were
decoded with the char ROM and the sprite cells read with PIL, not by
eye.

## Sources

- `pitfalls/input.md`, joystick2_scan_phantom_press and
  cia1_ddr_cleared_kills_keyboard: the main-loop measurement, the `$7F`
  the KERNAL leaves, and the column-7 keys.
- `techniques/input.md`, keyboard_matrix_scan: the port-1 paragraph and
  the ordering rule, read port 1 only with `$DC00` at `$FF`.
- `hardware/cia-reference.md`: the shared-pin table for `$DC00` and
  `$DC01`, the `$DC02` entry, and the jiffy timer periods.
