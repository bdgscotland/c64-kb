---
recipe: mixed-fighters
toolchain: oscar64
output_format: PRG
region: both
techniques: [mixed_sprite_char_actors, mob_priority]
file_formats: [PRG]
uses_registers: [D000, D001, D002, D003, D004, D005, D006, D007, D010, D011, D015, D016, D017, D018, D01B, D01C, D01D, D020, D021, D022, D023, D025, D026, D027, D028, D029, D02A, DC06, DC07, DC0F]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 mixed fighters: one fighter in four sprites, one in pre-shifted character cells, crossing with $D01B priority

## Synopsis

Two fighters on a plain backdrop, drawn two different ways. Fighter A
is four multicolour hardware sprites in a 2 x 2 block, 48 x 42 pixels.
Fighter B is a 5 x 6 block of multicolour character cells whose 30
glyphs, codes 128 to 157, belong to B alone. B's picture is 16
multicolour pixels (32 screen pixels) by 48 rows, stored pre-shifted
at the four multicolour-pixel offsets inside a cell, so B moves in
2-pixel steps while its block of codes moves in whole cells. A script
runs on autopilot: the two walk in and overlap with A in front, A
strikes, they walk through each other with B in front (A's `$D01B`
bits set), come back and hold overlapped. At 17 checkpoint ticks the
program hashes the arena's 240 screen codes, B's 240 glyph bytes and
A's sprite registers and compares them with the table the Python
model below prints. CIA1 timer B times the actor update every tick
and each part of it once with the screen blank. `$02FF` = `01` and a
green border on a pass, `02` and red otherwise (`headless-verify.md`).
This is the `mixed_sprite_char_actors` technique from
`docs/techniques/sprite.md`, with `mob_priority` deciding who is in
front.

## Source

```c
// mixed-fighters.c
//
// Two fighters drawn two ways. Fighter A is four multicolour hardware
// sprites, 2 x 2, 48 x 42 pixels. Fighter B is a 5 x 6 block of
// multicolour character cells whose 30 glyphs (codes 128 to 157) are
// rewritten from a pre-shifted table, so B moves in 2-pixel steps
// although its cells move in 8-pixel steps. A scripted fight runs on
// autopilot: they walk in and overlap with A in front, A strikes, they
// cross with B in front ($D01B), come back and hold overlapped.
// At checkpoint ticks the program hashes the arena's screen codes, the
// 240 glyph bytes and the sprite registers and compares them with a
// table printed by the page's Python model. CIA1 timer B times the
// actor update each tick and each part of it once with the screen blank.
// $02FF = 01 and a green border on a pass, 02 and red if not.
//
#include <c64/vic.h>
#include <c64/cia.h>

#define Screen  ((char *)0x0400)
#define Color   ((char *)0xd800)
#define Chars   ((char *)0x3000)            // $D018 = $1C
#define SprData ((char *)0x3800)            // blocks 224..231
#define SPR_BLK 224
#define VR      ((volatile char *)0xd000)
#define PTR     ((volatile char *)0x07f8)
#define PORT    (*(volatile char *)0x0001)
#define RESULT  (*(volatile char *)0x02ff)

#define ROW0    13                          // top row of the arena
#define ROWS    6
#define BASE    128                         // B's glyph range, 30 codes
#define SPACE   32
#define FLOOR   160
#define SPR_Y   154                         // A's top sprite Y register
#define A_MASK  0x0f                        // A owns sprites 0 to 3

// --- art: rectangles in multicolour pixels (x0, y0, x1, y1, bit pair) ----
struct Rect { char x0, y0, x1, y1, v; };

const struct Rect char_body[5] = {
    {6, 0, 9, 9, 2}, {4, 10, 11, 25, 3}, {4, 26, 11, 29, 1},
    {4, 30, 6, 47, 3}, {9, 30, 11, 47, 3}};
const struct Rect char_arms[2][2] = {
    {{2, 12, 3, 25, 2}, {12, 12, 13, 25, 2}},
    {{1, 4, 3, 11, 2}, {12, 4, 14, 11, 2}}};
const struct Rect spr_body[5] = {
    {10, 0, 13, 9, 1}, {8, 10, 15, 25, 2}, {8, 26, 15, 28, 3},
    {8, 29, 10, 41, 2}, {13, 29, 15, 41, 2}};
const struct Rect spr_arms[2][2] = {
    {{6, 12, 7, 25, 1}, {16, 12, 17, 25, 1}},
    {{5, 4, 7, 11, 1}, {16, 4, 18, 11, 1}}};

// B's canvas, 16 multicolour pixels (4 bytes) by 48 rows, one pose
char bcanvas[48 * 4];
// the pre-shifted glyphs: pose * 4 + shift, 240 bytes each in glyph order
char preshift[8][240];

void canvas_rect(char *c, char stride, const struct Rect *r)
{
    for (char y = r->y0; y <= r->y1; y++)
        for (char x = r->x0; x <= r->x1; x++) {
            char *p = c + y * stride + (x >> 2);
            char sh = 6 - 2 * (x & 3);
            *p = (*p & ~(3 << sh)) | (r->v << sh);
        }
}

void build_char_fighter(void)
{
    for (char pose = 0; pose < 2; pose++) {
        for (char i = 0; i < 192; i++)
            bcanvas[i] = 0;
        for (char i = 0; i < 5; i++)
            canvas_rect(bcanvas, 4, char_body + i);
        for (char i = 0; i < 2; i++)
            canvas_rect(bcanvas, 4, char_arms[pose] + i);
        for (char s = 0; s < 4; s++) {
            char *g = preshift[pose * 4 + s];
            for (char r = 0; r < 48; r++) {
                char w[5];
                w[0] = bcanvas[r * 4]; w[1] = bcanvas[r * 4 + 1];
                w[2] = bcanvas[r * 4 + 2]; w[3] = bcanvas[r * 4 + 3];
                w[4] = 0;
                for (char k = 0; k < 2 * s; k++) {     // shift right 2s bits
                    char c = 0;
                    for (char j = 0; j < 5; j++) {
                        char n = w[j] & 1;
                        w[j] = (w[j] >> 1) | (c << 7);
                        c = n;
                    }
                }
                for (char cx = 0; cx < 5; cx++)
                    g[((r >> 3) * 5 + cx) * 8 + (r & 7)] = w[cx];
            }
        }
    }
}

// A's canvas is 24 x 42 multicolour pixels, cut into four sprites
char acanvas[42 * 6];

void build_sprite_fighter(void)
{
    for (char pose = 0; pose < 2; pose++) {
        for (char i = 0; i < 252; i++)
            acanvas[i] = 0;
        for (char i = 0; i < 5; i++)
            canvas_rect(acanvas, 6, spr_body + i);
        for (char i = 0; i < 2; i++)
            canvas_rect(acanvas, 6, spr_arms[pose] + i);
        for (char part = 0; part < 4; part++) {
            char *d = SprData + (pose * 4 + part) * 64;
            char y0 = (part >> 1) * 21, b0 = (part & 1) * 3;
            for (char r = 0; r < 21; r++)
                for (char b = 0; b < 3; b++)
                    d[r * 3 + b] = acanvas[(y0 + r) * 6 + b0 + b];
            d[63] = 0;
        }
    }
}

// --- fighter state ------------------------------------------------------
int  ax, bx;                                // screen pixels, left edges
char apose, bpose, afront;
char cur_pose = 0xff, cur_shift = 0xff, cur_col = 0xff;
char *const arow[ROWS] = {
    Screen + (ROW0 + 0) * 40, Screen + (ROW0 + 1) * 40, Screen + (ROW0 + 2) * 40,
    Screen + (ROW0 + 3) * 40, Screen + (ROW0 + 4) * 40, Screen + (ROW0 + 5) * 40};
const char *gsrc;
char mcol_old, mcol_new;

// --- the technique --------------------------------------------------------
// Rewrite B's 30 glyphs from the pre-shifted table: 240 bytes.
__noinline void glyph_copy(void)
{
    char *d = Chars + BASE * 8;
    for (char i = 0; i < 120; i++) {
        d[i] = gsrc[i];
        d[i + 120] = gsrc[i + 120];
    }
}

// Move B's 5 x 6 block of codes when its cell column changes.
__noinline void cells_move(void)
{
    for (char r = 0; r < ROWS; r++) {
        char *p = arow[r];
        if (mcol_old != 0xff)
            for (char x = 0; x < 5; x++)
                p[mcol_old + x] = SPACE;
        char c = BASE + r * 5;
        for (char x = 0; x < 5; x++)
            p[mcol_new + x] = c + x;
    }
}

// Place A's four sprites, merge the 9th X bits, set pointers and priority.
__noinline void sprite_update(void)
{
    char msb = 0;
    int x = ax + 24;
    char f = SPR_BLK + apose * 4;
    for (char i = 0; i < 4; i++) {
        int xi = (i & 1) ? x + 24 : x;
        VR[i * 2] = (char)xi;
        VR[i * 2 + 1] = SPR_Y + (i >> 1) * 21;
        if (xi & 0x100)
            msb |= 1 << i;
        PTR[i] = f + i;
    }
    VR[0x10] = (VR[0x10] & ~A_MASK) | msb;
    VR[0x1b] = (VR[0x1b] & ~A_MASK) | (afront ? 0 : A_MASK);
}

void actors_update(void)
{
    char col = (char)(bx >> 3), sh = ((char)bx & 7) >> 1;
    if (bpose != cur_pose || sh != cur_shift) {
        gsrc = preshift[bpose * 4 + sh];
        glyph_copy();
        cur_pose = bpose;
        cur_shift = sh;
    }
    if (col != cur_col) {
        mcol_old = cur_col;
        mcol_new = col;
        cells_move();
        cur_col = col;
    }
    sprite_update();
}

// --- the script (the Python model runs the same table) ---------------------
struct Seg { char n; signed char da, db; char pa, pb, afront; };
#define NSEG 5
const struct Seg script[NSEG] = {
    {50, 2, -2, 0, 0, 1}, {16, 0, 0, 1, 0, 1}, {30, 2, -2, 0, 0, 0},
    {25, -2, 2, 0, 1, 0}, {8, 0, 2, 0, 1, 0}};
char seg, segleft;

void script_step(void)
{
    while (seg < NSEG && segleft == 0) {
        seg++;
        if (seg < NSEG)
            segleft = script[seg].n;
    }
    if (seg >= NSEG)
        return;                             // hold the last state
    const struct Seg *s = script + seg;
    ax += s->da;
    bx += s->db;
    apose = s->pa;
    bpose = s->pb;
    afront = s->afront;
    segleft--;
}

// --- the check: hashes against the model's table --------------------------
#define NCHK 17
const unsigned check_tick[NCHK] = {1, 2, 3, 4, 5, 25, 50, 58, 66, 67, 80, 96, 110, 121, 125, 129, 150};
const unsigned check_scr[NCHK] = {0x5fb9, 0x5fb9, 0x5fb9, 0x5fb9, 0xbf72, 0xee57, 0x95fb, 0x95fb, 0x95fb, 0x95fb, 0xafdc, 0xfdca, 0x5fb9, 0x2bf7, 0x95fb, 0xcafd, 0xcafd};
const unsigned check_gly[NCHK] = {0x7e6f, 0xf9bd, 0xe6f7, 0x9bdf, 0x7e6f, 0x7e6f, 0xf9bd, 0xf9bd, 0xf9bd, 0xe6f7, 0x9bdf, 0x9bdf, 0x9823, 0x608e, 0x608e, 0x608e, 0x608e};
const unsigned check_spr[NCHK] = {0x7062, 0x8f62, 0xda62, 0xe962, 0xbc62, 0xf862, 0x3f78, 0x3f44, 0x3f44, 0x6a88, 0x6587, 0x3582, 0xcf87, 0x868a, 0x868a, 0x868a, 0x868a};

unsigned hash;
void rx(char v)
{
    hash = (hash << 1) | (hash >> 15);
    hash ^= v;
}

char check(char k)
{
    char bad = 0;
    hash = 0;
    for (char r = 0; r < ROWS; r++)
        for (char x = 0; x < 40; x++)
            rx(arow[r][x]);
    if (hash != check_scr[k]) bad |= 1;
    hash = 0;
    for (char i = 0; i < 240; i++)
        rx(Chars[BASE * 8 + i]);
    if (hash != check_gly[k]) bad |= 2;
    hash = 0;
    for (char i = 0; i < 8; i++)
        rx(VR[i]);
    rx(VR[0x10] & A_MASK);
    rx(VR[0x1b] & A_MASK);
    for (char i = 0; i < 4; i++)
        rx(PTR[i]);
    if (hash != check_spr[k]) bad |= 4;
    return bad;
}

// --- CIA1 timer B -------------------------------------------------------------
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

__noinline void nothing(void) { }

unsigned time1(void (*fn)(void))
{
    __asm { sei }
    timer_start();
    fn();
    unsigned t = timer_stop();
    __asm { cli }
    return t;
}

// --- text (screen codes) ----------------------------------------------------------
void put_str(char *p, const char *s)
{
    while (*s)
        *p++ = *s++;
}

void put_dec(char *p, unsigned v, char digits)
{
    for (char i = digits; i > 0; i--) {
        p[i - 1] = 0x30 + v % 10;
        v /= 10;
    }
}

#define VERDICT_TICK 160

int main(void)
{
    // Copy the ROM font's first 64 glyphs (letters, digits) to $3000.
    __asm { sei }
    PORT = 0x33;
    for (unsigned i = 0; i < 512; i++)
        Chars[i] = ((volatile char *)0xd000)[i];
    PORT = 0x37;
    __asm { cli }
    for (char i = 0; i < 8; i++) {
        Chars[SPACE * 8 + i] = 0;
        Chars[FLOOR * 8 + i] = (i & 1) ? 0xaa : 0xff;
    }
    build_char_fighter();
    build_sprite_fighter();

    vic.color_border = 0;
    vic.color_back = 11;                    // 00: dark grey
    vic.color_back1 = 14;                   // 01: light blue, B's belt
    vic.color_back2 = 7;                    // 10: yellow, B's head and arms
    vic.memptr = 0x1c;
    vic.ctrl2 |= VIC_CTRL2_MCM;
    for (unsigned i = 0; i < 1000; i++) {
        Screen[i] = SPACE;
        Color[i] = 1;                       // hires white text
    }
    for (char i = 0; i < ROWS * 40; i++)
        Color[ROW0 * 40 + i] = 8 | 2;       // 11: red, B's body
    for (char i = 0; i < 40; i++) {
        Screen[(ROW0 + ROWS) * 40 + i] = FLOOR;
        Color[(ROW0 + ROWS) * 40 + i] = 4;  // hires purple floor
    }

    vic.spr_mcolor0 = 15;                   // 01: light grey, A's head and arms
    vic.spr_mcolor1 = 6;                    // 11: blue, A's belt
    for (char i = 0; i < 4; i++)
        VR[0x27 + i] = 5;                   // 10: green, A's body and legs
    vic.spr_multi = A_MASK;
    vic.spr_expand_x = 0;
    vic.spr_expand_y = 0;

    put_str(Screen + 0,      s"mixed fighters   tick");
    put_str(Screen + 2 * 40, s"a x     pose   b x      pose   front");
    put_str(Screen + 3 * 40, s"checks      mismatches");
    put_str(Screen + 4 * 40, s"update max       min");
    put_str(Screen + 5 * 40, s"glyphs       cells       sprites");
    put_str(Screen + 6 * 40, s"overlap ticks     front swaps");

    // Cost of each part, screen blanked, less an empty call.
    vic.ctrl1 &= ~VIC_CTRL1_DEN;
    vic_waitFrame();
    vic_waitFrame();
    unsigned t_none = time1(nothing);
    gsrc = preshift[0];
    unsigned t_copy = time1(glyph_copy) - t_none;
    mcol_old = 20; mcol_new = 21;
    unsigned t_move = time1(cells_move) - t_none;
    ax = 250;                               // two sprites past X 255
    unsigned t_spr = time1(sprite_update) - t_none;
    for (char r = 0; r < ROWS; r++)
        for (char x = 0; x < 40; x++)
            arow[r][x] = SPACE;
    vic.ctrl1 |= VIC_CTRL1_DEN;
    put_dec(Screen + 5 * 40 + 7, t_copy, 4);
    put_dec(Screen + 5 * 40 + 19, t_move, 4);
    put_dec(Screen + 5 * 40 + 33, t_spr, 4);

    ax = 40; bx = 248;
    seg = 0; segleft = script[0].n;
    vic.spr_enable = A_MASK;

    unsigned tick = 0, mism = 0, checks = 0, overlap = 0, swaps = 0;
    unsigned u_max = 0, u_min = 0xffff;
    char k = 0, fault = 0, done = 0, lastfront = 1;

    for (;;) {
        vic_waitFrame();                    // raster line 256
        script_step();
        __asm { sei }
        timer_start();
        actors_update();
        unsigned tu = timer_stop();
        __asm { cli }
        tick++;
        if (tu > u_max) u_max = tu;
        if (tu < u_min) u_min = tu;
        if (afront != lastfront) swaps++;
        lastfront = afront;
        // The figures' pixel spans: A 48 wide, B's 32-pixel canvas.
        if (ax < bx + 32 && bx < ax + 48) overlap++;

        if (k < NCHK && tick == check_tick[k]) {
            if (check(k)) mism++;
            checks++;
            k++;
        }

        switch (tick & 3) {                 // one line of text a tick
        case 0:
            put_dec(Screen + 22, tick, 4);
            put_dec(Screen + 2 * 40 + 4, ax, 3);
            Screen[2 * 40 + 13] = 0x30 + apose;
            put_dec(Screen + 2 * 40 + 19, bx, 3);
            Screen[2 * 40 + 29] = 0x30 + bpose;
            put_str(Screen + 2 * 40 + 37, afront ? s"a" : s"b");
            break;
        case 1:
            put_dec(Screen + 3 * 40 + 7, checks, 3);
            put_dec(Screen + 3 * 40 + 23, mism, 3);
            break;
        case 2:
            put_dec(Screen + 4 * 40 + 11, u_max, 4);
            put_dec(Screen + 4 * 40 + 21, u_min, 4);
            break;
        case 3:
            put_dec(Screen + 6 * 40 + 14, overlap, 3);
            put_dec(Screen + 6 * 40 + 30, swaps, 2);
            break;
        }

        if (!done && tick == VERDICT_TICK) {
            done = 1;
            if (checks != NCHK) fault = 2;
            if (mism) fault = 1;
            RESULT = fault ? 2 : 1;
            vic.color_border = fault ? 2 : 5;
            put_str(Screen + 40, fault ? s"result fail" : s"result pass");
            Screen[40 + 12] = 0x30 + fault;
        }
    }
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=mixed-fighters.prg mixed-fighters.c
```

Produces `mixed-fighters.prg`, 3,743 bytes, with no warnings. The map
puts the end of BSS at `$20FC`; the font at `$3000` and the sprite
images at `$3800` (blocks 224 to 231) sit above it and are built at
run time. Code or data that grows past `$3000` would be overwritten by
the font copy, so check the map after a change.

The `check_*` tables in the listing come from this model (Python 3).
It draws both fighters from the same rectangles, runs the same script,
and hashes what the arena's codes, B's glyph range and A's registers
must hold after each checkpoint tick. It shares no code with the C.

```python
# model.py: the mixed-fighters model. What the screen block, the glyph range and the
# sprite registers must hold after each checkpoint tick.
ROW0, ROWS, BASE, SPACE, SPR_BLK, SPR_Y = 13, 6, 128, 32, 224, 154

# rectangles (x0, y0, x1, y1, bit pair), multicolour pixels, inclusive
CHAR_BODY = [(6, 0, 9, 9, 2), (4, 10, 11, 25, 3), (4, 26, 11, 29, 1),
             (4, 30, 6, 47, 3), (9, 30, 11, 47, 3)]
CHAR_ARMS = [[(2, 12, 3, 25, 2), (12, 12, 13, 25, 2)],
             [(1, 4, 3, 11, 2), (12, 4, 14, 11, 2)]]
SPR_BODY = [(10, 0, 13, 9, 1), (8, 10, 15, 25, 2), (8, 26, 15, 28, 3),
            (8, 29, 10, 41, 2), (13, 29, 15, 41, 2)]
SPR_ARMS = [[(6, 12, 7, 25, 1), (16, 12, 17, 25, 1)],
            [(5, 4, 7, 11, 1), (16, 4, 18, 11, 1)]]

# (ticks, da, db, pose a, pose b, sprite fighter in front); the last
# segment's poses hold after the script ends
SCRIPT = [(50, 2, -2, 0, 0, 1), (16, 0, 0, 1, 0, 1), (30, 2, -2, 0, 0, 0),
          (25, -2, 2, 0, 1, 0), (8, 0, 2, 0, 1, 0)]
CHECKS = [1, 2, 3, 4, 5, 25, 50, 58, 66, 67, 80, 96, 110, 121, 125, 129, 150]


def canvas(w, h, rects):
    c = [[0] * w for _ in range(h)]
    for x0, y0, x1, y1, v in rects:
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                c[y][x] = v
    return c


def glyphs(pose, shift):
    c = canvas(16, 48, CHAR_BODY + CHAR_ARMS[pose])
    g = [0] * 240
    for r in range(48):
        w = 0
        for x in range(16):
            w = (w << 2) | c[r][x]
        w = (w << 8) >> (2 * shift)          # 40 bits, five cells
        for cx in range(5):
            g[((r >> 3) * 5 + cx) * 8 + (r & 7)] = (w >> (8 * (4 - cx))) & 255
    return g


def rotxor(bs):
    h = 0
    for v in bs:
        h = (((h << 1) | (h >> 15)) & 0xFFFF) ^ v
    return h


def state_after(t):
    a, b, pa, pb, fr = 40, 248, 0, 0, 1
    left = t
    for n, da, db, qa, qb, f in SCRIPT:
        k = min(n, left)
        if k:
            a += da * k
            b += db * k
            pa, pb, fr = qa, qb, f
        left -= k
    return a, b, pa, pb, fr


def expect(t):
    a, b, pa, pb, fr = state_after(t)
    col = b >> 3
    scr = []
    for r in range(ROWS):
        for x in range(40):
            scr.append(BASE + r * 5 + (x - col) if col <= x < col + 5 else SPACE)
    regs, msb = [], 0
    for i in range(4):
        x = a + 24 + (i & 1) * 24
        regs += [x & 255, SPR_Y + (i >> 1) * 21]
        if x & 256:
            msb |= 1 << i
    regs += [msb, 0 if fr else 15] + [SPR_BLK + pa * 4 + i for i in range(4)]
    return rotxor(scr), rotxor(glyphs(pb, (b & 7) >> 1)), rotxor(regs), (a, b, pa, pb, fr)


if __name__ == "__main__":
    rows = [expect(t) for t in CHECKS]
    print("const unsigned check_tick[NCHK] = {%s};" % ", ".join(map(str, CHECKS)))
    for k, name in enumerate(["check_scr", "check_gly", "check_spr"]):
        print("const unsigned %s[NCHK] = {%s};" % (
            name, ", ".join("0x%04x" % r[k] for r in rows)))
    for t, r in zip(CHECKS, rows):
        print("# tick %3d  a %3d b %3d pose %d %d front %s" % (
            t, *r[3][:4], "sprite" if r[3][4] else "char"))
```

Then run headless in VICE (PAL):

```bash
GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas x64sc -default -warp +sound \
  +autostart-delay-random -autostartprgmode 1 -limitcycles 8000000 \
  -exitscreenshot mixed-fighters.png -autostart mixed-fighters.prg
```

Add `-model ntsc` for the NTSC picture. The script is 129 ticks and the
verdict is posted at tick 160; at 8,000,000 cycles that has happened on
both models.

## Expected output

The script, one tick per loop pass. Positions are the left edges in
screen pixels: A's 48-pixel block, and B's 32-pixel picture.

| Ticks | A x | B x | A pose | B pose | In front |
|---|---|---|---|---|---|
| 1-50 | 42 to 140, +2 a tick | 246 to 148, -2 a tick | stand | stand | A |
| 51-66 | 140 | 148 | strike | stand | A |
| 67-96 | 142 to 200 | 146 to 88 | stand | stand | B |
| 97-121 | 198 to 150 | 90 to 138 | stand | arms up | B |
| 122-129 | 150 | 140 to 154 | stand | arms up | B |
| 130 on | 150 | 154 | stand | arms up | B |

Colours: A is green (5) from `$D027`-`$D02A`, light grey (15) from
`$D025` for the head and arms, blue (6) from `$D026` for the belt. B is
red (2) from colour RAM for body and legs, yellow (7) from `$D023` for
head and arms, light blue (14) from `$D022` for the belt. The backdrop
is dark grey (11) and the floor purple (4).

Measured in VICE x64sc 3.10 with the pinned command, text decoded
against the character ROM (rows 0 to 6, PAL):

```text
MIXED FIGHTERS   TICK 0172
RESULT PASS 0
A X 150 POSE 0 B X 154  POSE 1 FRONT B
CHECKS 017  MISMATCHES 000
UPDATE MAX 6108  MIN 0508
GLYPHS 3323  CELLS 1899  SPRITES 0448
OVERLAP TICKS 090 FRONT SWAPS 01
```

NTSC reads the same except `TICK 0180`, `UPDATE MAX 6366` and `OVERLAP
TICKS 098`. The tick counter and the overlap count keep running in the
hold, so both depend on the cycle count; the NTSC run fits more ticks
into the same cycles. The tick is printed every fourth tick. The border
is palette index 5, (98, 213, 50) on PAL and (114, 189, 103) on NTSC.

What the numbers say:

- `CHECKS 017 MISMATCHES 000`: at every checkpoint the arena's screen
  codes, B's glyph bytes and A's X, Y, `$D010`, `$D01B` bits and
  pointers hashed to the model's values. The checkpoints include ticks
  1 to 5, which step B through all four shifts, the strike, the tick the
  priority swaps, and the hold.
- `UPDATE MAX 6108 MIN 0508`: the whole actor update, CIA1 timer B,
  interrupts masked, started at raster line 256, worst and best tick of
  the run. The worst tick is one that rewrites B's glyphs, moves B's
  block of codes one cell and places A, which every walking tick on
  which B crosses a cell boundary does: the three parts measured below
  sum to 5,670 of the 6,108. The best is a hold tick, A's registers only. On NTSC the
  worst is 6,366: the NTSC frame has 263 lines, so an update of about
  94 lines from line 256 runs into the badlines at the top of the text
  area; on PAL it ends by line 41, before the first badline at 51
  (arithmetic from 63 and 65 cycles a line; the stall was not traced).
- `GLYPHS 3323 CELLS 1899 SPRITES 0448`: each part once, screen
  blanked, less an empty call: the 240-byte glyph copy, the 5 x 6 block
  cleared and rewritten one cell over (60 stores), and A's four sprites
  placed with two of them past X 255. The rest of the worst tick, 438
  cycles, is `actors_update` itself, the call and the timer.
- `FRONT SWAPS 01`: the one priority change, at tick 67.

The pictures: `screenshots/mixed-fighters.png` (PAL) and
`screenshots/mixed-fighters-ntsc.png` (NTSC), the hold at A x 150,
B x 154, B in front. The script below decodes the arena, raster lines
155 to 202 by 320 pixels, to palette indices and compares every pixel
with the model's picture of the two fighters under the `$D01B` rule.

| Shot | Pixels wrong | B over A | A through B's `$D022` belt | A only | B only |
|---|---|---|---|---|---|
| PAL, 8,000,000 cycles | 0 of 15,360 | 344 | 44 | 264 | 324 |
| NTSC, 8,000,000 cycles | 0 of 15,360 | 344 | 44 | 264 | 324 |

A's colours cover x 198 to 217 and B's x 188 to 215 in both shots,
A on rows 139 to 180 and B on 139 to 186 on PAL (127 to 168 and 127 to
174 on NTSC; line − 16 and − 28):
B's first line is raster 155, text row 13, and so is A's with sprite
Y register 154. Where B's red, yellow body covers A, B shows; where
B's light blue belt covers A, A shows, though A is behind. In
multicolour text mode bit pair 01 counts as background for sprite
priority, like 00 (measured here; Bauer's VIC-II article, section 3.8.2,
says the same: with MCM set, 00 and 01 are background and 10 and 11
foreground, http://www.zimmers.net/cbmpics/cbm/c64/vic-ii.txt).

A probe at 5,450,000 cycles, not pinned, caught the strike (tick 60 on
PAL, 56 on NTSC; A x 140, B x 148, A in front). The same script found
0 of 15,360 pixels wrong on both models, with 540 pixels of A over B,
belt included. Each pinned shot run twice gives byte-identical PNGs.

```python
# measure.py: python3 measure.py shot.png pal|ntsc tick. Needs model.py
# (above) beside it and Pillow.
import sys
from PIL import Image
from model import canvas, CHAR_BODY, CHAR_ARMS, SPR_BODY, SPR_ARMS, state_after

PAL = {0: (0, 0, 0), 1: (255, 255, 255), 2: (175, 60, 88), 3: (126, 243, 214), 4: (170, 64, 245),
       5: (98, 213, 50), 6: (44, 61, 236), 7: (255, 255, 70), 8: (183, 99, 30), 9: (119, 83, 0),
       10: (238, 123, 149), 11: (98, 98, 98), 12: (148, 148, 148), 13: (183, 255, 134),
       14: (115, 133, 255), 15: (205, 205, 205)}
NTSC = {0: (0, 0, 0), 1: (255, 255, 255), 2: (169, 71, 100), 3: (138, 230, 203), 4: (154, 88, 185),
        5: (114, 189, 103), 6: (25, 73, 180), 7: (255, 248, 141), 8: (196, 98, 65), 9: (151, 64, 0),
        10: (230, 134, 163), 11: (98, 98, 98), 12: (148, 148, 148), 13: (198, 255, 186),
        14: (98, 145, 251), 15: (205, 205, 205)}
B_COL = {1: 14, 2: 7, 3: 2}       # D022, D023, colour RAM
A_COL = {1: 15, 2: 5, 3: 6}       # D025, D027, D026

path, model, tick = sys.argv[1], sys.argv[2], int(sys.argv[3])
pal, off = (PAL, 16) if model == 'pal' else (NTSC, 28)
inv = {v: k for k, v in pal.items()}
im = Image.open(path).convert('RGB')
a, b, pa, pb, afront = state_after(tick)
bc = canvas(16, 48, CHAR_BODY + CHAR_ARMS[pb])
ac = canvas(24, 42, SPR_BODY + SPR_ARMS[pa])
LINE0 = 51 + 13 * 8                          # first raster line of the arena
stats = dict(bad=0, total=0, a_only=0, b_only=0, a_over_b=0, b_over_a=0, a_through_belt=0)
first_bad = None
for line in range(LINE0, LINE0 + 48):
    for px in range(320):
        r = line - LINE0
        bv = bc[r][(px - b) // 2] if b <= px < b + 32 else 0
        av = ac[r][(px - a) // 2] if a <= px < a + 48 and r < 42 else 0
        if av and bv:
            if afront or bv == 1:
                want = A_COL[av]
                stats['a_through_belt' if bv == 1 and not afront else 'a_over_b'] += 1
            else:
                want = B_COL[bv]
                stats['b_over_a'] += 1
        elif av:
            want = A_COL[av]; stats['a_only'] += 1
        elif bv:
            want = B_COL[bv]; stats['b_only'] += 1
        else:
            want = 11
        got = inv.get(im.getpixel((32 + px, line - off)), -1)
        stats['total'] += 1
        if got != want:
            stats['bad'] += 1
            if first_bad is None:
                first_bad = (px, line, want, got)
print(path, model, 'tick', tick, 'a', a, 'b', b, 'poses', pa, pb, 'front', 'A' if afront else 'B')
print(stats, 'first mismatch', first_bad)
# bounding boxes of each fighter's own colours, screenshot coordinates
for name, cols in (('A', {15, 5, 6}), ('B', {14, 7, 2})):
    xs, ys = [], []
    for y in range(LINE0 - off, LINE0 - off + 48):
        for x in range(32, 352):
            if inv.get(im.getpixel((x, y)), -1) in cols:
                xs.append(x); ys.append(y)
    print(name, 'box x', min(xs), '-', max(xs), 'y', min(ys), '-', max(ys))
```

## Why this works

**B is a picture in its own glyphs.** Codes 128 to 157 are used by no
other cell, so rewriting their 240 bytes redraws B and nothing else.
The block of codes on screen is laid out once per cell position:
code `128 + row * 5 + column`. `glyph_copy` runs only when B's pose or
its shift inside the cell changes, and `cells_move` only when its cell
column changes. `cells_move` clears the old block before writing the
new one; without that the column B walked out of would keep its codes
and show a stale strip of B (`dirty_cell_skip_leaves_overlay_trail`;
from the mechanism, not run here).

**Pre-shifted by multicolour pixel.** A multicolour pixel is two screen
pixels wide, so four shifts cover every position inside a cell. Each
pose is stored four times, each copy 5 cells wide so the shifted
picture has room, 240 bytes each, 1,920 bytes for two poses (the
array's size in the map). A draw is then a straight copy at every
shift. Moving in whole cells would need no table and no copy on a
move, but B would step 8 pixels while A glides in 2.

**Priority is A's four `$D01B` bits.** With them clear A is in front of
everything B draws. With them set B's foreground pixels, bit pairs 10
and 11, cover A; pairs 00 and 01 do not. Sprite-to-sprite order does not
enter, as B is not a sprite. The script flips the bits in the same
update as the positions, before the raster reaches the fighters.

**The update runs in the vertical blank.** `vic_waitFrame` returns at
line 256. The worst update ends by line 41 on PAL and before line 91 on
NTSC (arithmetic from the measured cycles), both above B's first line,
155, so B's glyphs never change while the VIC is drawing them.

Verified: compiled with Oscar64, run headless in VICE x64sc 3.10 with the
pinned command on PAL and NTSC, each twice with byte-identical PNGs; the
text was decoded against the character ROM and every arena pixel
compared with the model's picture with PIL, not by eye.
