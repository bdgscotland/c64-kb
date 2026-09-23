---
recipe: cave-scan
toolchain: oscar64
output_format: PRG
region: both
techniques: [cave_scan_engine, frame_sync_loop]
file_formats: [PRG]
uses_registers: [D012, D019, D01A, D020, D021, DC04, DC05, DC06, DC07, DC0E, DC0F]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 Cave Scan: a Boulder Dash style cave updated by one scan per cave frame

## Synopsis

A 40x22 cave of one-byte cells, updated by a single top-to-bottom,
left-to-right scan once every four display frames. Boulders and diamonds
fall and roll, Rockford digs and collects on a scripted path, and one
firefly follows the wall on its left. An object that moves down or right
gets the scanned bit (bit 7), so the scan skips it when it reaches the
cell it moved into. After 40 cave frames the program folds the cave into
a 16-bit checksum and compares it with the value a Python model of the
same rules produced, then prints PASS or FAIL and the cycle cost of a
scan: the scans of the game and three synthetic fills, one of them 380
falling boulders. The cave layout is original; it is not Boulder Dash
data. Left out: amoeba, magic wall, explosions, pushing boulders, the
exit and the cave timer. It implements `cave_scan_engine`
(`techniques/logic.md`). Build `-dSCAN_FLAG=0` to see the double-move bug.

## Source

```c
// cave-scan.c
// A 40x22 cave updated by one top-to-bottom, left-to-right scan per cave
// frame, with a "scanned" bit so that an object moved down or right is
// not processed a second time in the same scan. Boulders and diamonds
// fall and roll, Rockford digs and collects on a scripted path, one
// firefly follows the wall on its left. Amoeba, magic wall, explosions,
// pushing and the exit are left out. After K_FRAMES cave frames the fold
// of every cave frame is compared with the value a Python model of the
// same rules produced, and the scan's cycle cost is printed.
// SCAN_FLAG=0 builds the same program without the scanned bit.
#include <c64/vic.h>
#include <c64/cia.h>
#include <c64/rasterirq.h>

#ifndef SCAN_FLAG
#define SCAN_FLAG 1                  // 0: show the double-move bug
#endif

#define SCREEN ((char *)0x0400)
#define COLOUR ((char *)0xd800)
#define W 40                         // cave width in cells, steel border included
#define H 22                         // cave height
#define K_FRAMES 40                  // cave frames run before the check
#define SCAN_EVERY 4                 // display frames per cave frame
#define EXPECT 0xe130                // Python model: fold of the cave after 40 frames

// Element codes. Bit 7 is the scanned bit; it is never set on SPACE.
#define SPACE     0
#define DIRT      1
#define WALL      2                  // brick: round, things roll off it
#define STEEL     3                  // not round
#define BOULDER   4
#define BOULDER_F 5                  // falling: the code one above the resting one
#define DIAMOND   6
#define DIAMOND_F 7
#define ROCKFORD  8
#define FIREFLY   12                 // 12..15, low two bits = heading
#define SCANNED   0x80

// Headings in clockwise order: left, up, right, down. Turning left is
// heading + 3, turning right heading + 1, both modulo 4.
static const signed char step[4] = { -1, -W, 1, W };

// Screen code and colour per element code 0..15.
static const char glyph[16] = {
    0x20, 0x66, 0xa0, 0xa0, 0x51, 0x51, 0x5a, 0x5a,
    0x00, 0x20, 0x20, 0x20, 0x57, 0x57, 0x57, 0x57 };
static const char tint[16] = {
    VCOL_BLACK, VCOL_BROWN, VCOL_RED, VCOL_MED_GREY, VCOL_LT_GREY, VCOL_LT_GREY,
    VCOL_CYAN, VCOL_CYAN, VCOL_YELLOW, VCOL_BLACK, VCOL_BLACK, VCOL_BLACK,
    VCOL_ORANGE, VCOL_ORANGE, VCOL_ORANGE, VCOL_ORANGE };

// The cave's 38x20 interior, one string per row, padded with dirt.
// ' ' dirt, '_' space, '#' brick, 'O' boulder, 'd' diamond, 'R' Rockford,
// 'F' firefly heading left. An original layout, not a Boulder Dash cave.
static const char * const rows[20] = {
    "",
    "    OOO      d",
    "    OOO      O",
    "    OdO",
    " R",
    "",
    "          ___O__ O_",
    "          _d_#__ #_",
    "          _###__ #_",
    "",
    "                     ########",
    "                     #______#",
    "                     #_F##__#",
    "                     #__##__#",
    "                     #______#",
    "                     ########",
    "", "", "", ""
};

// Rockford's autopilot: one move per cave frame, L U R D, '-' stands still;
// past the end of the string he stands still.
static const char script[] = "RRRRRRRRRDDDDUUUURRRUD";

static char cave[W * H];
static char move;                    // heading for this cave frame, or 0xff
static char dead, got;

// Cells changed by a scan, for the renderer. On overflow, redraw all.
#define DIRTY_MAX 64
static unsigned dirty[DIRTY_MAX];
static char ndirty, overflow;

static void mark(char *q)
{
    if (ndirty < DIRTY_MAX) dirty[ndirty++] = q - cave;
    else overflow = 1;
}

// Put v at dst for an object leaving src. A move to a later cell in scan
// order sets the scanned bit, so the scan skips the object when it gets there.
static void put(char *dst, char v, char *src)
{
#if SCAN_FLAG
    if (dst > src) v |= SCANNED;
#endif
    *dst = v;
    *src = SPACE;
    mark(dst);
    mark(src);
}

// Roll off a round object: left first, then right. Needs the side cell
// and the cell below it empty. The object leaves falling.
static char roll(char *p, char fall)
{
    if (p[-1] == SPACE && p[W - 1] == SPACE) { put(p - 1, fall, p); return 1; }
    if (p[1] == SPACE && p[W + 1] == SPACE)  { put(p + 1, fall, p); return 1; }
    return 0;
}

static char is_round(char t)
{
    return t == BOULDER || t == DIAMOND || t == WALL;
}

// One object's turn. Called only for codes BOULDER and up.
__noinline void cell(char *p, char v)
{
    if (v & SCANNED) { *p = v & 0x7f; return; }   // moved here this scan
    if (v == BOULDER || v == DIAMOND)
    {
        char b = p[W];
        if (b == SPACE) put(p + W, v + 1, p);        // start falling
        else if (is_round(b & 0x7f)) roll(p, v + 1);
    }
    else if (v == BOULDER_F || v == DIAMOND_F)
    {
        char b = p[W];
        char bt = b & 0x7f;
        if (b == SPACE) put(p + W, v, p);            // keep falling
        else if (bt == ROCKFORD) { p[W] = SPACE; mark(p + W); dead = 1; }
        else if (bt == BOULDER_F || bt == DIAMOND_F) ;   // wait for it to move
        else if (!(is_round(bt) && roll(p, v))) *p = v - 1;  // land
    }
    else if (v == ROCKFORD)
    {
        if (move < 4)
        {
            char *t = p + step[move];
            char tv = *t;
            if (tv == SPACE || tv == DIRT || tv == DIAMOND)
            {
                if (tv == DIAMOND) got++;
                put(t, ROCKFORD, p);
            }
        }
    }
    else                                     // firefly, heading in the low bits
    {
        char d = v & 3, k;
        char hit = 0;
        for (k = 0; k < 4; k++)
        {
            char *n = p + step[k];
            if ((*n & 0x7f) == ROCKFORD) { *n = SPACE; mark(n); hit = 1; }
        }
        if (hit) { dead = 1; return; }
        char dl = (d + 3) & 3;
        if (p[step[dl]] == SPACE)     put(p + step[dl], FIREFLY + dl, p);
        else if (p[step[d]] == SPACE) put(p + step[d], FIREFLY + d, p);
        else *p = FIREFLY + ((d + 1) & 3);
    }
}

// One cave frame: every interior cell once, top to bottom, left to right.
// The loop only reads and compares; space, dirt and walls cost nothing more.
__noinline void cave_scan(void)
{
    ndirty = 0; overflow = 0;
    char *row = cave + W;
    for (char y = 1; y < H - 1; y++, row += W)
        for (char x = 1; x < W - 1; x++)
        {
            char v = row[x];
            if (v >= BOULDER) cell(row + x, v);
        }
}

// --- the demonstration: build, draw, check, time ---------------------------

static void cave_build(void)
{
    for (char y = 0; y < H; y++)
        for (char x = 0; x < W; x++)
        {
            char e = STEEL;
            if (y > 0 && y < H - 1 && x > 0 && x < W - 1)
            {
                const char *r = rows[y - 1];
                char c = ' ', j = 0;
                while (r[j] && j < x - 1) j++;
                if (j == x - 1 && r[j]) c = r[j];
                e = c == '_' ? SPACE : c == '#' ? WALL : c == 'O' ? BOULDER :
                    c == 'd' ? DIAMOND : c == 'R' ? ROCKFORD : c == 'F' ? FIREFLY : DIRT;
            }
            cave[y * W + x] = e;
        }
}

static void draw_cell(unsigned i)
{
    char t = cave[i] & 0x0f;
    SCREEN[i] = glyph[t];
    COLOUR[i] = tint[t];
}

static void draw_all(void)
{
    for (unsigned i = 0; i < W * H; i++) draw_cell(i);
}

static unsigned fold_cave(unsigned chk)
{
    for (unsigned i = 0; i < W * H; i++)
    {
        unsigned t = chk ^ (cave[i] & 0x7f);
        chk = (t << 2) + t + 1;              // (chk ^ v) * 5 + 1, no multiply call
    }
    return chk;
}

static void put_text(char row, char col, const char *s)
{
    char *p = SCREEN + W * row + col;
    char *q = COLOUR + W * row + col;
    while (*s)
    {
        char c = *s++;
        if (c >= 'A' && c <= 'Z') c -= 64;
        *p++ = c; *q++ = VCOL_WHITE;
    }
}

// v as n decimal digits (n = 1..6), leading zeros shown.
static void put_dec(char row, char col, unsigned long v, char n)
{
    static const unsigned long pw[6] = { 100000, 10000, 1000, 100, 10, 1 };
    char *p = SCREEN + W * row + col;
    for (char i = 6 - n; i < 6; i++)
    {
        char d = 0x30;
        while (v >= pw[i]) { v -= pw[i]; d++; }
        *p++ = d;
    }
}

static void put_hex16(char row, char col, unsigned v)
{
    static const char hx[16] = { 0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37,
                                 0x38, 0x39, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06 };
    char *p = SCREEN + W * row + col;
    for (char i = 0; i < 4; i++)
    {
        p[i] = hx[(v >> (12 - 4 * i)) & 15];
        COLOUR[W * row + col + i] = VCOL_WHITE;
    }
}

// CIA1 timer A counts phi2 from $FFFF; timer B counts A's underflows,
// so a scan longer than 65,535 cycles is still read correctly.
static void t_start(void)
{
    cia1.cra = 0; cia1.crb = 0;
    cia1.ta = 0xffff; cia1.tb = 0xffff;
    cia1.crb = 0x51;                     // force load, start, count A underflows
    cia1.cra = 0x11;                     // force load, start, count phi2
}

static unsigned long t_stop(void)
{
    cia1.cra = 0; cia1.crb = 0;          // stop both before reading
    return ((unsigned long)(0xffff - cia1.tb) << 16) + (0xffff - cia1.ta);
}

static unsigned long time_scan(void)
{
    t_start();
    cave_scan();
    return t_stop();
}

// A synthetic fill of the interior for the worst-case timing: a is the
// element on odd interior rows, b on even ones, c on every other cell of
// the odd rows (0xff: same as a).
static void fill(char a, char b, char c)
{
    for (char y = 1; y < H - 1; y++)
        for (char x = 1; x < W - 1; x++)
            cave[y * W + x] = (y & 1) ? ((x & 1) || c == 0xff ? a : c) : b;
}

RIRQCode frame_irq;
volatile char ticks;

__interrupt void on_frame(void) { ticks++; }

int main(void)
{
    __asm { sei }
    vic.color_border = VCOL_BLACK;
    vic.color_back = VCOL_BLACK;
    for (unsigned i = 0; i < 1000; i++) { SCREEN[i] = 0x20; COLOUR[i] = VCOL_WHITE; }

    // Worst-case timing first, interrupts off, display on (badlines in).
    // Each fill is built again before its scan, so every scan has work.
    unsigned long c_idle, c_fall, c_fly, c_null;
    move = 0xff;
    cave_build(); fill(DIRT, DIRT, 0xff);           c_idle = time_scan();
    cave_build(); fill(BOULDER_F, SPACE, 0xff);     c_fall = time_scan();
    cave_build(); fill(FIREFLY, SPACE, SPACE);      c_fly  = time_scan();
    t_start(); c_null = t_stop();

    // The game: one cave frame every SCAN_EVERY display frames.
    cave_build();
    draw_all();
    rirq_init(true);
    rirq_build(&frame_irq, 1);
    rirq_call(&frame_irq, 0, on_frame);
    rirq_set(0, 250, &frame_irq);
    rirq_sort();
    rirq_start();

    unsigned chk = 0;
    unsigned long cmin = 0xffffff, cmax = 0;
    char next = ticks, start = ticks, late = 0;
    for (char f = 0; f < K_FRAMES; f++)
    {
        next += SCAN_EVERY;
        if (!((char)(ticks - next) & 0x80)) late++;   // no wait: the last frame overran
        while ((char)(ticks - next) & 0x80) ;     // wait for the cave frame
        char m = f < sizeof(script) - 1 ? script[f] : '-';
        move = m == 'L' ? 0 : m == 'U' ? 1 : m == 'R' ? 2 : m == 'D' ? 3 : 0xff;
        unsigned long c = time_scan() - c_null;
        if (c < cmin) cmin = c;
        if (c > cmax) cmax = c;
        if (overflow) draw_all();
        else for (char n = 0; n < ndirty; n++) draw_cell(dirty[n]);
    }
    char spent = ticks - start;               // display frames for K_FRAMES cave frames
    chk = fold_cave(0);

    put_text(22, 0, "CAVE 40 TICKS     LATE    GOT   RF     ");
    put_dec(22, 14, spent, 3); put_dec(22, 23, late, 2); put_dec(22, 30, got, 1);
    put_text(22, 35, dead ? "DEAD" : "OK  ");
    put_text(23, 0, "CHK     /      ");
    put_hex16(23, 4, chk); put_hex16(23, 9, EXPECT);
    put_text(23, 14, chk == EXPECT ? "PASS SCAN" : "FAIL SCAN");
    put_dec(23, 24, cmin, 6); put_text(23, 30, "-"); put_dec(23, 31, cmax, 6);
    put_text(24, 0, "IDLE        FALL        FLY");
    put_dec(24, 5, c_idle - c_null, 6); put_dec(24, 17, c_fall - c_null, 6); put_dec(24, 28, c_fly - c_null, 6);
    vic.color_border = chk == EXPECT ? VCOL_GREEN : VCOL_RED;
    for (;;) ;
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=cave-scan.prg cave-scan.c
```

Run headless (PAL; add `-model ntsc` for NTSC):

```bash
timeout 180 x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 -limitcycles 12000000 -exitscreenshot cave-scan.png -autostart cave-scan.prg
```

The report is on screen between 8,000,000 and 9,000,000 cycles on PAL
(measured by bisecting `-limitcycles`); 12,000,000 leaves a margin.

## Expected output

`screenshots/cave-scan.png` (PAL) and `screenshots/cave-scan-ntsc.png`
(NTSC). Black screen, green border. The cave fills rows 0 to 21, one cell
per character: brown checker dirt, red brick, grey steel border, light
grey ball boulders, cyan diamonds, orange ring firefly. Rockford is dead,
so no yellow `@` remains. Rows 22 to 24, PAL:

```text
CAVE 40 TICKS 160 LATE 00 GOT 1 RF DEAD
CHK E130/E130 PASS SCAN 016609-018175
IDLE 014206 FALL 137818 FLY 130451
```

NTSC reads `TICKS 161`, `SCAN 017115-018559` and
`IDLE 014421 FALL 138892 FLY 131531`; the rest is the same.

- `TICKS` is the display frames the 40 cave frames took, counted by a
  raster IRQ on line 250. `LATE` counts cave frames that found their
  frame already gone. 160 and 0 mean the cadence of one scan per four
  frames held.
- `GOT 1 RF DEAD`: one diamond collected, then Rockford killed by the
  boulder he dug out from under, as the script intends.
- `CHK` is the program's fold of the 880 cells after the last cave
  frame, then the model's value.
- `SCAN` is the fewest and most cycles one scan of this cave took in the
  game, CIA1 timer A cascaded into timer B, display on.
- `IDLE`, `FALL` and `FLY` are single scans of synthetic interiors, run
  before the game with interrupts off and the display on: all dirt; odd
  rows of falling boulders over empty rows (380 movers); odd rows of
  fireflies on alternate cells over empty rows (190 movers). The FALL
  scan overflows the 64-entry dirty list, so after the first 32 moves it
  records nothing, which makes it slightly cheaper than a scan that
  records every change.

The model, the rules of the listing written again in Python:

```python
SPACE, DIRT, WALL, STEEL, BOULDER, BOULDER_F, DIAMOND, DIAMOND_F, ROCKFORD = range(9)
FIREFLY, SCANNED, W, H = 12, 0x80, 40, 22
OFF = [-1, -W, 1, W]                     # left, up, right, down
ROWS = ["", "    OOO      d", "    OOO      O", "    OdO", " R", "",
        "          ___O__ O_", "          _d_#__ #_", "          _###__ #_", "",
        "                     ########", "                     #______#",
        "                     #_F##__#", "                     #__##__#",
        "                     #______#", "                     ########",
        "", "", "", ""]
CODE = {' ': DIRT, '_': SPACE, '#': WALL, 'O': BOULDER, 'd': DIAMOND,
        'R': ROCKFORD, 'F': FIREFLY}
SCRIPT = "RRRRRRRRRDDDDUUUURRRUD"

def run(frames=40, flag=True):
    c = [STEEL] * (W * H)
    for y, r in enumerate(ROWS, 1):
        for x, ch in enumerate(r.ljust(38), 1):
            c[y * W + x] = CODE[ch]
    def put(d, v, s):
        c[d] = v | (SCANNED if flag and d > s else 0); c[s] = SPACE
    def roll(i, fall):
        for o in (-1, 1):
            if c[i + o] == SPACE and c[i + W + o] == SPACE:
                put(i + o, fall, i); return True
        return False
    rnd = lambda t: t in (BOULDER, DIAMOND, WALL)
    for f in range(frames):
        m = "LURD".find(SCRIPT[f]) if f < len(SCRIPT) else -1
        for y in range(1, H - 1):
            for x in range(1, W - 1):
                i = y * W + x; v = c[i]
                if v < BOULDER: continue
                if v & SCANNED: c[i] = v & 0x7f; continue
                if v in (BOULDER, DIAMOND):
                    if c[i + W] == SPACE: put(i + W, v + 1, i)
                    elif rnd(c[i + W] & 0x7f): roll(i, v + 1)
                elif v in (BOULDER_F, DIAMOND_F):
                    b = c[i + W]; bt = b & 0x7f
                    if b == SPACE: put(i + W, v, i)
                    elif bt == ROCKFORD: c[i + W] = SPACE
                    elif bt in (BOULDER_F, DIAMOND_F): pass
                    elif not (rnd(bt) and roll(i, v)): c[i] = v - 1
                elif v == ROCKFORD:
                    if m >= 0 and c[i + OFF[m]] in (SPACE, DIRT, DIAMOND):
                        put(i + OFF[m], ROCKFORD, i)
                else:
                    d = v & 3
                    near = [i + o for o in OFF if c[i + o] & 0x7f == ROCKFORD]
                    for n in near: c[n] = SPACE
                    if near: continue
                    dl = (d + 3) & 3
                    if c[i + OFF[dl]] == SPACE: put(i + OFF[dl], FIREFLY + dl, i)
                    elif c[i + OFF[d]] == SPACE: put(i + OFF[d], FIREFLY + d, i)
                    else: c[i] = FIREFLY + ((d + 1) & 3)
        assert not any(v & SCANNED for v in c)
    chk = 0
    for v in c:
        chk = ((chk ^ (v & 0x7f)) * 5 + 1) & 0xffff
    return chk

print(hex(run()), hex(run(flag=False)))   # 0xe130 0x262f
```

## Why this works

`cave_scan` walks the 38x20 interior with a row pointer and a byte
index, so the common case, a cell of space, dirt or wall, costs one
indexed load, one compare and the loop step: 14,206 cycles for 760 cells
of dirt on PAL, about 19 a cell with badline stalls in. Every code from
`BOULDER` up, and every code with bit 7 set, goes to `cell()`. Keeping
the object rules out of the loop body matters in Oscar64: a first
version with the rules inline computed the cell pointer before the test
and took about 48,000 cycles for the same dirt scan (47,731 in a rebuild).

`put()` is the one place an object moves. It sets bit 7 on the
destination when the destination is later in scan order, that is to the
right or below. A move left or up lands on a cell the scan has passed,
so it needs no mark. When the scan reaches a marked cell, `cell()`
clears the bit and does nothing else, so every mark is gone by the end
of the scan without a second pass; the model asserts this after every
frame. Bit 7 is never set on `SPACE`, so the rules can compare a
neighbour with `SPACE` directly.

A resting boulder or diamond with space below starts falling and moves
down at once. One resting on a round object (boulder, diamond, brick)
rolls: left if the left cell and the cell below it are empty, otherwise
right under the same test. A falling one keeps falling into space, kills
Rockford if he is below it, waits if the object below is itself falling,
tries to roll off a round object, and otherwise lands, becoming the
resting code one below. A resting boulder above Rockford stays where it
is; that is why Rockford can stand under one, step away, step back and
be killed by it one cave frame after it starts to fall. The firefly
turns left if it can, goes on if it cannot, and turns right on the spot
if both are blocked. Any firefly next to Rockford kills him.

**The double-move bug, run.** The same listing built with
`-dSCAN_FLAG=0` and run with the pinned PAL command printed
`CHK 262F/E130 FAIL`, `GOT 0 RF OK`, `LATE 01` and a slowest game scan
of 30,620 cycles. 262F is the value the Python model gives with the flag
off, and all 880 cells of the picture match that model. The model shows
what happened in cave frame 1: Rockford, told to step right once, was
processed again in every cell he entered and tunnelled from column 2 to
column 38 in one scan. The
boulder that rolls right off the brick at column 18 fell two more cells
in the same scan, and the firefly moved several times. From there the
script walks a different cave, collects nothing and never meets the
boulder. The unflagged build is not pinned.

The cadence is a raster IRQ on line 250 that counts frames, the
`frame_sync_loop` pattern. The main loop waits for the count to pass the
next multiple of four, scans, then redraws only the cells in the dirty
list. At 16,609 to 18,175 cycles a scan of this cave fits in one PAL
frame of 19,656 cycles (on NTSC, 17,115 to 18,559, it does not fit the
17,095-cycle frame), with little room for anything else in that
frame. That is why the game scans once per four frames. The full-cave
fold that the check needs is about three frames on its own, so it runs
once, after the last cave frame: a first version folded after every cave
frame and ran 178 frames for 40 cave frames, 39 of them late.

The whole cave fits the screen, because a cell is one character. Boulder
Dash drew each object as a 2x2-character block and scrolled a window of
about 19.5 by 11.5 objects over the cave (elmerproductions, below).

## Verification

VICE x64sc 3.10, windowless build, Oscar64 as installed on 2026-09-23.

**Every cell against the model.** A script read each of the 880 cave
cells of both pictures, matched the 8x8 pixels against
`chargen-901225-01.bin` and the foreground colour against VICE's palette
triples for the model (`runtime/vice-reference.md`, "The default
palette"), and compared them with the element the Python model holds
after 40 frames. 0 mismatches on PAL and on NTSC. The same script on the
`SCAN_FLAG=0` picture: 0 mismatches against the model with the flag
off, 47 against the model with it on.

**Text and border.** Rows 22 to 24 were decoded the same way and read
as quoted above; the border pixel is (98, 213, 50) on PAL and
(114, 189, 103) on NTSC, colour 5 on each.

**Reproducibility.** The pinned command was run twice per model; the
PNG bytes were identical each time.

## Sources

- https://www.elmerproductions.com/sp/peterb/rawCaveData.html (Peter
  Broadribb's Boulder Dash I cave format): the 40x22 cave with a steel
  border and a 38x20 play area, the visible area of 19.5 by 11.5
  objects, and object codes with separate "scanned this frame" variants
  for fireflies, boulders, diamonds, butterflies, Rockford and amoeba,
  there to stop an object being scanned twice in one frame. Falling
  boulders kill Rockford; stationary ones do not.
- https://www.boulder-dash.nl/forum/viewtopic.php?t=652 ("Cave Scanning
  Order" thread): the cave is scanned row by row, top to bottom, each
  row left to right; an element that moves or grows gets a delay state
  and is not scanned again in that frame; the states reset at the end of
  the frame. Forum report, not measured here.
- `frame-sync-loop.md`: the raster IRQ tick counter, reused in shape.
- `print-number.md` and `difficulty-tables.md`: the CIA1 timing harness
  and the cascaded timer B, reused in shape.
