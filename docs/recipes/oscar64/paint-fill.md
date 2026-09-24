---
recipe: paint-fill
toolchain: oscar64
output_format: PRG
region: both
techniques: [paint_program_brush_and_fill, hires_plot, bresenham_line, midpoint_circle]
file_formats: [PRG]
uses_registers: [D011, D016, D018, D020, DD00, DC04, DC05, DC06, DC07, DC0E, DC0F]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 paint core: brush strokes, a scanline flood fill, and undo on a hires bitmap

## Synopsis

The drawing core of a paint program on a hires bitmap. A 3x3 brush is
stamped along Bresenham strokes. A scanline flood fill uses an explicit
seed stack, 4-connected or 8-connected. A one-level undo copies the
bitmap aside before each operation. The drawing: two brush strokes, a
rectangle outline with a solid block inside it, and a midpoint circle
outline. The rectangle is filled 4-connected round the block. The circle
is filled 8-connected, which escapes through the diagonal steps of its
outline and floods the screen; that fill is undone and the circle is
filled 4-connected. After every stage the set pixels are counted and
compared with a Python model of the same drawing. CIA1 timers A and B
time the strokes, each fill and the undo. The figures are drawn into the
bitmap from the character ROM. `$02FF` holds `01` and the border is
green when every count matches, the undo restores the checksum and the
seed stack never overflowed; else `02` and red. It implements
`paint_program_brush_and_fill` (`techniques/bitmap-modes.md`) and
measures `fill_8_connected_leaks_through_diagonal_outline`
(`pitfalls/logic.md`).

## Source

```c
// paint-fill.c
// The drawing core of a paint program on a hires bitmap: a 3x3 brush
// stamped along Bresenham strokes, a scanline flood fill with an explicit
// seed stack, and a one-level undo that saves the bitmap before each
// operation. VIC bank 1: screen matrix $4000 (white ink on black), bitmap
// $6000; the undo copy lives at $A000 with the BASIC ROM banked out.
// The drawing: two brush strokes, a rectangle outline with a solid block
// inside it, and a midpoint circle outline. The rectangle is filled
// 4-connected round the block. The circle is filled 8-connected, which
// escapes through the diagonal steps of its outline; that fill is undone
// and the circle filled 4-connected. Every stage's set-pixel count is
// compared with a Python model of the same drawing. CIA1 timers A and B
// time the strokes, each fill and the undo. The figures are drawn into
// the bitmap with the character ROM's glyphs. $02FF holds 01 and the
// border is green when every count matches, the undo restores the
// checksum and the 8-connected fill leaked; else 02 and red.
#include <c64/vic.h>
#include <c64/cia.h>

#define BM     ((char *)0x6000)       // bitmap, VIC bank 1
#define MATRIX ((char *)0x4000)       // colours for the bitmap
#define UNDO   ((char *)0xa000)       // RAM under the BASIC ROM
#define RESULT (*(volatile char *)0x02ff)
#define PORT   (*(volatile char *)0x0001)

// Counts from the Python model of this drawing (the recipe page).
#define N_STROKES   1077u
#define N_SHAPES    1921u              // + rectangle outline 444, block 400
#define N_CIRCLE    2149u              // + circle outline, 228 pixels
#define N_RECT_FILL 13593u             // + rectangle interior, 11,444
#define N_LEAK      64000u             // 8-connected fill: every pixel
#define N_FINAL     18510u             // + circle interior, 4,917

static unsigned rowbase[200];
static const char bitmask[8] = { 0x80, 0x40, 0x20, 0x10, 0x08, 0x04, 0x02, 0x01 };

static void make_rows(void)
{
    for (char y = 0; y < 200; y++)
        rowbase[y] = (unsigned)(y >> 3) * 320 + (y & 7);
}

static inline void plot(unsigned x, char y)
{
    BM[rowbase[y] + (x & 0xfff8)] |= bitmask[x & 7];
}

static inline bool test(unsigned x, char y)
{
    return (BM[rowbase[y] + (x & 0xfff8)] & bitmask[x & 7]) != 0;
}

// ---- brush and strokes ----------------------------------------------------

static void brush(int x, int y)
{
    for (int dy = -1; dy <= 1; dy++)
        for (int dx = -1; dx <= 1; dx++)
            plot((unsigned)(x + dx), (char)(y + dy));
}

__noinline void stroke(int x0, int y0, int x1, int y1)
{
    int dx = x1 > x0 ? x1 - x0 : x0 - x1, sx = x0 < x1 ? 1 : -1;
    int dy = y1 > y0 ? y0 - y1 : y1 - y0, sy = y0 < y1 ? 1 : -1;
    int err = dx + dy;
    for (;;)
    {
        brush(x0, y0);
        if (x0 == x1 && y0 == y1)
            break;
        int e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
    }
}

static void hline(unsigned x0, unsigned x1, char y)
{
    for (unsigned x = x0; x <= x1; x++)
        plot(x, y);
}

// Not inlined on purpose: with plot() inlined straight into circle() at
// -O2, this Oscar64 build drew 6 of the circle's 228 pixels.
__noinline void dot(unsigned x, char y)
{
    plot(x, y);
}

static void circle(int cx, int cy, int r)
{
    int x = r, y = 0, err = 1 - r;
    while (x >= y)
    {
        dot(cx + x, cy + y); dot(cx - x, cy + y);
        dot(cx + x, cy - y); dot(cx - x, cy - y);
        dot(cx + y, cy + x); dot(cx - y, cy + x);
        dot(cx + y, cy - x); dot(cx - y, cy - x);
        y++;
        if (err < 0)
            err += 2 * y + 1;
        else
        {
            x--;
            err += 2 * (y - x) + 1;
        }
    }
}

// ---- scanline flood fill ------------------------------------------------------

#define STACK 600
static unsigned stk_x[STACK];
static char stk_y[STACK];
static unsigned sp, sp_max;
static bool overflow;

static void push(unsigned x, char y)
{
    if (sp == STACK)
    {
        overflow = true;
        return;
    }
    stk_x[sp] = x;
    stk_y[sp] = y;
    if (++sp > sp_max)
        sp_max = sp;
}

// Fill the unset region round (x, y). diag = 1 scans one pixel past each
// end of a span on the rows above and below: 8-connected.
__noinline void fill(unsigned sx, char sy, char diag)
{
    sp = sp_max = 0;
    overflow = false;
    push(sx, sy);
    while (sp)
    {
        sp--;
        unsigned x = stk_x[sp];
        char y = stk_y[sp];
        if (test(x, y))
            continue;
        unsigned xl = x, xr = x;
        while (xl > 0 && !test(xl - 1, y))
            xl--;
        while (xr < 319 && !test(xr + 1, y))
            xr++;
        hline(xl, xr, y);
        unsigned a = xl, b = xr;
        if (diag)
        {
            if (a > 0) a--;
            if (b < 319) b++;
        }
        for (char k = 0; k < 2; k++)
        {
            char ny = k ? y + 1 : y - 1;
            if ((k == 0 && y == 0) || (k == 1 && y == 199))
                continue;
            bool run = false;
            for (unsigned xx = a; xx <= b; xx++)
            {
                if (!test(xx, ny))
                {
                    if (!run)
                        push(xx, ny);
                    run = true;
                }
                else
                    run = false;
            }
        }
    }
}

// ---- undo, counts, text -------------------------------------------------------

__noinline void checkpoint(void)
{
    for (unsigned i = 0; i < 8000; i++)
        UNDO[i] = BM[i];
}

__noinline void undo(void)
{
    for (unsigned i = 0; i < 8000; i++)
        BM[i] = UNDO[i];
}

static char popc[256];

static unsigned count_set(void)
{
    unsigned n = 0;
    for (unsigned i = 0; i < 8000; i++)
        n += popc[BM[i]];
    return n;
}

static unsigned checksum(void)
{
    unsigned s = 0;
    for (unsigned i = 0; i < 8000; i++)
        s = (s << 1 | s >> 15) ^ BM[i];
    return s;
}

static char glyphs[512];                  // screen codes 0-63 from the ROM

static void copy_glyphs(void)
{
    PORT = 0x33;                          // character ROM at $D000, no I/O
    for (unsigned i = 0; i < 512; i++)
        glyphs[i] = ((char *)0xd000)[i];
    PORT = 0x36;
}

static void text(char row, char col, const char *s)
{
    char *d = BM + row * 320 + col * 8;
    while (*s)
    {
        char c = *s++;
        if (c >= 'a' && c <= 'z')
            c -= 'a' - 1;
        const char *g = glyphs + (c & 63) * 8;
        for (char i = 0; i < 8; i++)
            d[i] = g[i];
        d += 8;
    }
}

static void num(char row, char col, unsigned long v, char width)
{
    char buf[9];
    buf[width] = 0;
    for (char i = width; i > 0; i--)
    {
        buf[i - 1] = '0' + (char)(v % 10);
        v /= 10;
    }
    text(row, col, buf);
}

static void timer_start(void)
{
    cia1.cra = 0x00;
    cia1.crb = 0x00;
    cia1.ta = 0xffff;
    cia1.tb = 0xffff;
    cia1.crb = 0x51;
    cia1.cra = 0x11;
}

static unsigned long timer_stop(void)
{
    cia1.cra = 0x00;
    cia1.crb = 0x00;
    return ((unsigned long)(0xffff - cia1.tb) << 16) + (0xffff - cia1.ta);
}

int main(void)
{
    __asm { sei }
    PORT = 0x36;                          // BASIC ROM out: $A000 is RAM
    vic.color_border = VCOL_BLACK;
    for (unsigned i = 0; i < 1000; i++)
        MATRIX[i] = 0x10;                 // white ink, black paper
    for (unsigned i = 0; i < 8000; i++)
        BM[i] = 0;
    cia2.pra = (cia2.pra & 0xfc) | 0x02;  // VIC bank 1, $4000-$7FFF
    vic.memptr = 0x08;                    // matrix $4000, bitmap $6000
    vic.ctrl1 = 0x3b;                     // bitmap mode, display on
    vic.ctrl2 = 0x08;
    make_rows();
    for (unsigned i = 0; i < 256; i++)
    {
        char n = 0;
        for (char b = 0; b < 8; b++)
            n += (i >> b) & 1;
        popc[i] = n;
    }
    copy_glyphs();

    timer_start();
    stroke(8, 120, 311, 120);
    stroke(8, 128, 38, 158);
    unsigned long cyc_stroke = timer_stop();
    unsigned n_strokes = count_set();

    hline(8, 135, 8);
    hline(8, 135, 103);
    for (char y = 9; y < 103; y++)
    {
        plot(8, y);
        plot(135, y);
    }
    for (char y = 50; y < 70; y++)
        hline(60, 79, y);
    unsigned n_shapes = count_set();
    circle(220, 56, 40);
    unsigned n_circle = count_set();

    checkpoint();
    timer_start();
    fill(12, 12, 0);
    unsigned long cyc_rect = timer_stop();
    unsigned n_rect = count_set();
    unsigned sp_rect = sp_max;

    checkpoint();
    unsigned sum_before = checksum();
    timer_start();
    fill(220, 56, 1);
    unsigned long cyc_leak = timer_stop();
    unsigned n_leak = count_set();
    bool of_leak = overflow;
    timer_start();
    undo();
    unsigned long cyc_undo = timer_stop();
    bool undone = checksum() == sum_before && count_set() == n_rect;

    timer_start();
    fill(220, 56, 0);
    unsigned long cyc_circle = timer_stop();
    unsigned n_final = count_set();
    unsigned sp_circle = sp_max;

    bool ok = n_strokes == N_STROKES && n_shapes == N_SHAPES && n_circle == N_CIRCLE
           && n_rect == N_RECT_FILL && n_leak == N_LEAK && n_final == N_FINAL
           && undone && !overflow && !of_leak;

    text(21, 0, "px str       rect        leak");
    num(21, 7, n_strokes, 4);
    num(21, 18, n_rect, 5);
    num(21, 30, n_leak, 5);
    text(22, 0, "final        undo    stack");
    num(22, 6, n_final, 5);
    text(22, 18, undone ? "ok" : "no");
    num(22, 27, sp_rect, 3);
    num(22, 31, sp_circle, 3);
    text(23, 0, "cyc str         rect");
    num(23, 8, cyc_stroke, 6);
    num(23, 21, cyc_rect, 7);
    text(23, 30, ok ? "pass" : "fail");
    text(24, 0, "leak          circ          undo");
    num(24, 5, cyc_leak, 7);
    num(24, 19, cyc_circle, 7);
    num(24, 33, cyc_undo, 6);

    RESULT = ok ? 0x01 : 0x02;
    vic.color_border = ok ? VCOL_GREEN : VCOL_RED;
    for (;;)
        ;
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=paint-fill.prg paint-fill.c
```

Run headless, pinned at 40,000,000 cycles: the fills are pixel by pixel
in C, and the figures were not yet on the screen at 30,000,000; they were
at 35,000,000.

```bash
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 -limitcycles 40000000 -exitscreenshot paint-fill.png -autostart paint-fill.prg
```

Add `-model ntsc` for the NTSC picture. The PRG is 3,547 bytes.

## Expected output

A white-on-black hires bitmap with a green border. Top left, a solid
white rectangle, x 8 to 135 and y 8 to 103, with no trace of the block
inside it. Top right, a white disc of radius 40 round (220, 56). Across
y = 120 a three-pixel stroke from x 7 to 312; below its left end a
diagonal stroke to (38, 158). Rows 21 to 24 hold the figures. PAL,
`screenshots/paint-fill.png`:

```
px str 1077  rect 13593  leak 64000
final 18510  undo ok  stack 004 002
cyc str 336946  rect 4072063  pass
leak 7626032  circ 1735510  undo 355663
```

NTSC, `screenshots/paint-fill-ntsc.png`: the same counts, with `cyc str
339963`, `rect 4107350`, `leak 7779820`, `circ 1750634` and `undo
358788`. The text was read with a PIL decoder against the character ROM.
The white pixels of rows 0 to 20 of each screenshot (y 35 to 202 on PAL,
23 to 190 on NTSC, x 32 to 351) number 18,510 on both, the model's final
count (VICE x64sc 3.10).

## Why this works

**Counts.** The Python model below draws the same strokes, outlines
and circle with the same integer arithmetic and fills with a
breadth-first search, not a scanline fill. Run on the host, it prints
1,077 pixels after the strokes, 1,921 with the rectangle outline (444)
and the block (400), 2,149 with the circle outline (228), 13,593 with
the rectangle's interior (11,444), and 18,510 with the circle's
(4,917). The 8-connected fill from the circle's centre
reaches every one of the 64,000 pixels. The program's counts match all
six.

```python
"""Python model of paint-fill.c's drawing: pixel counts after each stage."""
from collections import deque

W, H = 320, 200
bm = [[0] * W for _ in range(H)]


def plot(x, y):
    bm[y][x] = 1


def count():
    return sum(map(sum, bm))


def brush(x, y):
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            plot(x + dx, y + dy)


def stroke(x0, y0, x1, y1):
    dx = abs(x1 - x0); sx = 1 if x0 < x1 else -1
    dy = -abs(y1 - y0); sy = 1 if y0 < y1 else -1
    err = dx + dy
    while True:
        brush(x0, y0)
        if x0 == x1 and y0 == y1:
            break
        e2 = 2 * err
        if e2 >= dy:
            err += dy; x0 += sx
        if e2 <= dx:
            err += dx; y0 += sy


def hline(x0, x1, y):
    for x in range(x0, x1 + 1):
        plot(x, y)


def circle(cx, cy, r):
    x, y, err = r, 0, 1 - r
    while x >= y:
        for px, py in ((cx + x, cy + y), (cx - x, cy + y), (cx + x, cy - y), (cx - x, cy - y),
                       (cx + y, cy + x), (cx - y, cy + x), (cx + y, cy - x), (cx - y, cy - x)):
            plot(px, py)
        y += 1
        if err < 0:
            err += 2 * y + 1
        else:
            x -= 1
            err += 2 * (y - x) + 1


def fill(sx, sy, diag):
    nb = [(1, 0), (-1, 0), (0, 1), (0, -1)]
    if diag:
        nb += [(1, 1), (1, -1), (-1, 1), (-1, -1)]
    if bm[sy][sx]:
        return
    q = deque([(sx, sy)])
    bm[sy][sx] = 1
    while q:
        x, y = q.popleft()
        for dx, dy in nb:
            nx, ny = x + dx, y + dy
            if 0 <= nx < W and 0 <= ny < H and not bm[ny][nx]:
                bm[ny][nx] = 1
                q.append((nx, ny))


stroke(8, 120, 311, 120)
stroke(8, 128, 38, 158)
print('strokes', count())
hline(8, 135, 8)
hline(8, 135, 103)
for y in range(9, 103):
    plot(8, y); plot(135, y)
for y in range(50, 70):
    hline(60, 79, y)
print('shapes', count())
circle(220, 56, 40)
print('circle', count())
fill(12, 12, 0)
print('rect fill', count())
saved = [row[:] for row in bm]
fill(220, 56, 1)
print('leak', count())
bm = saved
fill(220, 56, 0)
print('final', count())
```

**The fill.** Pop a seed; if its pixel is set, drop it. Otherwise run
left and right to the set pixels on each side, set the whole span, then
scan the rows above and below between the span's ends and push one seed
for each run of unset pixels. The 8-connected form scans one pixel past
each end. The stack held at most 4 seeds for the rectangle and 2 for the
circle; a shape with many holes or spikes needs more, and `push` refuses
and flags an overflow past 600.

**The leak.** A midpoint circle is an 8-connected ring: where it steps
diagonally, two outline pixels touch only at a corner. A 4-connected fill
cannot pass between them. An 8-connected fill does, and filled the whole
screen: 64,000 pixels. The undo copy made before it put the bitmap back;
the checksum and the count after the undo equal those before the fill.

**Costs.** The fills set and test one pixel at a time through a row
table: 4,072,063 cycles for the rectangle's 11,444 pixels on PAL, about
356 a pixel, and 1,735,510 for the circle's 4,917. A span fill that sets
whole bytes in the middle of a span would be several times faster (not
built here). The undo is an 8,000-byte copy, 355,663 cycles in C.

**Two Oscar64 notes.** `circle()` calls a non-inlined `dot()` instead
of the inline `plot()`: with `plot()` inlined into it at `-O2`, this
compiler build left the loop after one iteration and the circle had 6 of
its 228 pixels (`-O1` was right; reported with a repro on issue #30).
The bitmap is at `$6000` in VIC bank 1 and the undo copy at `$A000`
under the BASIC ROM, which is banked out: this program's code and data
run from `$0801` to `$2208` (its `.map` file), over the usual `$2000`
bitmap.
