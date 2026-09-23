---
recipe: char-bullets
toolchain: oscar64
output_format: PRG
region: both
techniques: [char_bullets]
file_formats: [PRG]
uses_registers: [D011, D012, D018, D020, D021, DC06, DC07, DC0F, DD06, DD07, DD0F]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 character bullets: eight bullets merged into reserved glyphs over a patterned background, restored in reverse and checked every frame

## Synopsis

Eight bullets move in 2-pixel steps across a 20 by 10 cell arena of
patterned ROM glyphs without using a sprite. Each bullet owns one
reserved screen code, $F8 to $FF. To draw a bullet the program saves the
screen code and colour under it, copies that code's glyph into the
bullet's reserved glyph, ORs a 2 by 2 pixel dot into it at the bullet's
position inside the cell, and writes the reserved code and white into
the cell. Bullets 0 and 1 share a cell all the time, 4 pixel rows apart.
Bullets bounce off the arena edges and off a column of wall cells, found
by the class of the character they saved. Every frame the program
restores all eight in reverse order and compares all 200 arena cells
(screen code and colour nibble) with a copy of the background taken
before the first bullet was drawn. Then it moves and draws them again.
A failed compare latches `FAIL`, a red border and 02 in `$02FF`; a pass
shows `PASS`, green and 01. CIA timers put the cost of all eight draws
and restores, and of one, in a HUD. The technique is `char_bullets` in
`techniques/text-mode-render.md`.

The compare is exact, a byte-for-byte check against a copy rather than
a checksum: it is stronger and, as a straight compare, cheaper than the
Fletcher sum a first build used (10,855 cycles on PAL against 5,873).

## Source

```c
// char-bullets.c -- eight bullets drawn as characters over a patterned
// background, each one merged into its own reserved glyph ($F8-$FF).
// Every frame: restore all bullets in reverse order, compare the arena
// (screen codes and colour nibbles) with a copy taken before the first
// bullet was drawn, move, then save-under and draw in forward order.
// Bullets 0 and 1 share a cell every frame; bullets bounce off the arena
// edges and off wall cells, found by the class of the saved character.
// HUD: cycles for all eight draws and restores, per bullet, the compare
// verdict. $02FF = 01 and a green border on pass, 02 and red on fail.
// Build: oscar64 -tm=c64 -O2 -o=char-bullets.prg char-bullets.c
#include <c64/vic.h>
#include <c64/cia.h>
#include <c64/memmap.h>
#include <string.h>

// Code and data below $3000; the charset copy sits at $3000-$37FF.
#pragma region( main, 0x0a00, 0x3000, , , {code, data, bss, heap, stack} )

#define SCREEN   ((char *)0x0400)
#define COLOUR   ((char *)0xd800)
#define CHAR_ROM ((char *)0xd000)
#define FONT     ((char *)0x3000)     // $D018 = $1C: screen $0400, chars $3000
#define RESULT   (*(volatile char *)0x02ff)
#define COFS     0xd400u              // colour RAM minus screen RAM

#define NB       8                    // bullets, one reserved glyph each
#define BASE     0xf8                 // reserved codes $F8-$FF
#define AC0      10                   // arena: columns 10-29
#define AR0      15                   //        rows 15-24
#define AW       20
#define AH       10
#define WALL     0x66                 // ROM hatch glyph, class 1 (solid)
#define WHITE    VCOL_WHITE

// Bullet state. x and y are arena pixels, always even, so a 2x2 dot
// never crosses a cell edge.
static char bx[NB] = {  20,  20,  40,  90, 130,  10,  70, 150 };
static char by[NB] = {  40,  44,  10,  70,  24,  60,   2,  50 };
static signed char dx[NB] = { 2, 2, -2,  2, -2,  2,  0, -2 };
static signed char dy[NB] = { 0, 0,  2, -2,  2, -2,  2,  0 };

static char   under[NB];              // screen code under the bullet
static char   ucol[NB];               // colour RAM nibble under it
static char * cell[NB];               // screen address it was drawn at
static char   cls[256];               // 1 = solid, by screen code

static char * rowp[AH];               // arena row start in screen RAM

// Dot pixels for x & 7 = 0, 2, 4, 6.
static const char dot[8] = { 0xc0, 0, 0x30, 0, 0x0c, 0, 0x03, 0 };

static unsigned t_draw, t_erase, t_check;
static unsigned hits, shared;

static void timer_start(void)
{
    cia1.crb = 0x00;
    cia1.tb  = 0xffff;
    cia1.crb = 0x11;                  // force load, start, count phi2
}

static unsigned timer_stop(void)
{
    cia1.crb = 0x00;
    return 0xffff - cia1.tb;
}

static void put_str(char * dst, const char * s)
{
    while (*s) {
        char c = *s++;
        if (c >= 'A' && c <= 'Z') c -= 64;   // ASCII letter to screen code
        *dst++ = c;
    }
}

static void put_dec5(char * dst, unsigned v)
{
    for (char i = 5; i > 0; i--) {
        dst[i - 1] = '0' + (char)(v % 10);
        v /= 10;
    }
}

// Add one to a five-digit decimal already on screen: no division.
static void bump_dec5(char * dst)
{
    for (char i = 5; i > 0; i--) {
        if (dst[i - 1] < '9') { dst[i - 1]++; return; }
        dst[i - 1] = '0';
    }
}

// Print a figure only when it differs from the one on screen.
static void show_if_changed(char * dst, unsigned * shown, unsigned v)
{
    if (v != *shown) { put_dec5(dst, v); *shown = v; }
}

// Background pattern: four ROM glyphs in four colours, walls in brown.
static char bg_code(char r, char c)
{
    if (c == 10 && r >= 2 && r <= 7) return WALL;
    static const char pat[4] = { 0x2e, 0x2b, 0x51, 0x56 };   // . + ball X
    return pat[(r + c) & 3];
}

static char bg_colour(char code)
{
    switch (code) {
    case 0x2e: return VCOL_MED_GREY;
    case 0x2b: return VCOL_CYAN;
    case 0x51: return VCOL_PURPLE;
    case 0x56: return VCOL_LT_BLUE;
    default:   return VCOL_BROWN;
    }
}

// The background as drawn, before any bullet: screen codes and colour
// nibbles for each arena cell. Colour RAM is 4 bits wide and its upper
// nibble reads back as noise, so only the low nibble is kept and compared.
static char shadow_s[AH * AW], shadow_c[AH * AW];

#define ROW_SAME(r)                                                      \
    for (char c = 0; c < AW; c++) {                                      \
        if (SCREEN[40 * (AR0 + r) + AC0 + c] != shadow_s[(r) * AW + c])  \
            return false;                                                \
        if ((COLOUR[40 * (AR0 + r) + AC0 + c] & 0x0f) != shadow_c[(r) * AW + c]) \
            return false;                                                \
    }

// Every arena cell against the copy, row by row at constant addresses.
static bool arena_intact(void)
{
    ROW_SAME(0) ROW_SAME(1) ROW_SAME(2) ROW_SAME(3) ROW_SAME(4)
    ROW_SAME(5) ROW_SAME(6) ROW_SAME(7) ROW_SAME(8) ROW_SAME(9)
    return true;
}

// Restore in reverse draw order: a bullet drawn over another bullet saved
// that bullet's reserved code, so it must be put back first.
static void erase_all(void)
{
    char i = NB;
    do {
        i--;
        char * p = cell[i];
        p[0] = under[i];
        p[COFS] = ucol[i];
    } while (i);
}

static void move_all(void)
{
    for (char i = 0; i < NB; i++) {
        char x = bx[i] + dx[i];
        if (x > 8 * AW - 2)               { dx[i] = -dx[i]; x = bx[i] + dx[i]; }
        char y = by[i] + dy[i];
        if (y > 8 * AH - 2)               { dy[i] = -dy[i]; y = by[i] + dy[i]; }
        bx[i] = x; by[i] = y;
    }
}

// Save under, merge the glyph under the bullet with the dot into the
// bullet's reserved glyph, write the reserved code and white to the cell.
static void draw_all(void)
{
    for (char i = 0; i < NB; i++) {
        char x = bx[i], y = by[i];
        char * p = rowp[y >> 3] + (x >> 3);
        char u = p[0];
        cell[i]  = p;
        under[i] = u;
        ucol[i]  = p[COFS];

        const char * src = FONT + (unsigned)u * 8;
        char * dst = FONT + (unsigned)(BASE + i) * 8;
        dst[0] = src[0]; dst[1] = src[1]; dst[2] = src[2]; dst[3] = src[3];
        dst[4] = src[4]; dst[5] = src[5]; dst[6] = src[6]; dst[7] = src[7];
        char m = dot[x & 7], ry = y & 7;
        dst[ry] |= m; dst[ry + 1] |= m;

        p[0] = BASE + i;
        p[COFS] = WHITE;

        // Collision: follow the chain through bullets drawn earlier this
        // frame to the background code, then read its class. A reserved
        // code left on screen by a wrong restore order makes this loop
        // forever, because the bullet then saves its own code as "under".
        char t = u;
        if (t >= BASE) { shared++; do t = under[t - BASE]; while (t >= BASE); }
        if (cls[t]) { hits++; dx[i] = -dx[i]; dy[i] = -dy[i]; }
    }
}

int main(void)
{
    __asm { sei }

    mmap_set(MMAP_CHAR_ROM);
    memcpy(FONT, CHAR_ROM, 2048);
    mmap_set(MMAP_ROM);
    cls[WALL] = 1;

    memset(SCREEN, 0x20, 1000);
    memset(COLOUR, VCOL_WHITE, 1000);
    for (char r = 0; r < AH; r++) {
        char * p = SCREEN + 40 * (AR0 + r) + AC0;
        rowp[r] = p;
        for (char c = 0; c < AW; c++) {
            char code = bg_code(r, c);
            p[c] = code;
            p[c + COFS] = bg_colour(code);
        }
    }
    vic.color_back = VCOL_BLACK;
    vic.color_border = VCOL_BLACK;
    vic.memptr = 0x1c;

    put_str(SCREEN,       "FRAME  00000  PASS");
    put_str(SCREEN + 40,  "DRAW   00000  EACH 00000  MAX 00000");
    put_str(SCREEN + 80,  "ERASE  00000  EACH 00000  MAX 00000");
    put_str(SCREEN + 120, "CHECK  00000  DONE AT LINE 00000");
    put_str(SCREEN + 160, "SHARED 00000  WALL HITS  00000");
    put_str(SCREEN + 200, "LOOP   00000  WHOLE ITERATION WITH HUD");

    for (char r = 0; r < AH; r++)
        for (char c = 0; c < AW; c++) {
            shadow_s[r * AW + c] = rowp[r][c];
            shadow_c[r * AW + c] = rowp[r][c + COFS] & 0x0f;
        }
    draw_all();

    char fault = 0;
    unsigned max_draw = 0, max_erase = 0;
    unsigned shown[11] = { 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 };

    for (;;)
    {
        vic_waitFrame();              // line 256, below the display

        cia2.crb = 0x00;              // whole-iteration clock, CIA2 timer B
        cia2.tb  = 0xffff;
        cia2.crb = 0x11;

        timer_start();
        erase_all();
        t_erase = timer_stop();

        timer_start();
        if (!arena_intact()) fault = 1;
        t_check = timer_stop();

        move_all();

        timer_start();
        draw_all();
        t_draw = timer_stop();
        unsigned line = ((unsigned)(vic.ctrl1 & 0x80) << 1) | vic.raster;

        RESULT = fault ? 2 : 1;
        vic.color_border = fault ? VCOL_RED : VCOL_GREEN;

        // HUD after the draw, outside every timer.
        if (t_draw > max_draw) max_draw = t_draw;
        if (t_erase > max_erase) max_erase = t_erase;
        bump_dec5(SCREEN + 7);
        if (fault) put_str(SCREEN + 14, "FAIL");
        show_if_changed(SCREEN + 47,  &shown[0], t_draw);
        show_if_changed(SCREEN + 59,  &shown[1], t_draw / NB);
        show_if_changed(SCREEN + 70,  &shown[2], max_draw);
        show_if_changed(SCREEN + 87,  &shown[3], t_erase);
        show_if_changed(SCREEN + 99,  &shown[4], t_erase / NB);
        show_if_changed(SCREEN + 110, &shown[5], max_erase);
        show_if_changed(SCREEN + 127, &shown[6], t_check);
        show_if_changed(SCREEN + 147, &shown[8], line);
        show_if_changed(SCREEN + 167, &shown[7], shared);
        show_if_changed(SCREEN + 185, &shown[9], hits);
        cia2.crb = 0x00;              // shown next iteration
        show_if_changed(SCREEN + 207, &shown[10], 0xffff - cia2.tb);
    }
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=char-bullets.prg char-bullets.c
```

Built with Oscar64 at `-O2`; the PRG is 2,738 bytes. The `#pragma region`
line keeps code and data below $3000, where the program copies the
character ROM. Without it nothing would stop the code growing into the
charset (`charset_blit_overruns_grown_code`). The reserved glyphs are the
last eight of that copy, $37C0 to $37FF. In the ROM those are reverse
graphics glyphs, which the HUD does not use.

## Expected output

Black screen, green border. A six-line white HUD at the top, then empty
rows, then the arena on rows 15 to 24, columns 10 to 29: grey `.`, cyan
`+`, purple balls and light-blue `X` in a diagonal pattern, and a brown
hatched wall at arena column 10, arena rows 2 to 7. Eight bullets show
as white cells: the background glyph plus a 2 by 2 dot, all in white.
One cell holds two dots, bullets 0 and 1, so seven white cells show.

Every figure below is from VICE x64sc 3.10 (rung 1), read with PIL from
the exit screenshot of the pinned run

```
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 \
      -limitcycles 8000000 [-model ntsc] -exitscreenshot out.png -autostart char-bullets.prg
```

The HUD was decoded against the `chargen-901225-01.bin` glyphs. The arena
was compared pixel by pixel with an image rendered in Python from the
same ROM glyphs, the program's pattern and colours, the VICE palette,
and bullet positions from a Python copy of the move, bounce and wall
rules.

**PAL** (`screenshots/char-bullets.png`):

```
FRAME  00241  PASS
DRAW   03259  EACH 00407  MAX 03352
ERASE  00641  EACH 00080  MAX 00641
CHECK  05873  DONE AT LINE 00108
SHARED 00270  WALL HITS  00013
LOOP   12649  WHOLE ITERATION WITH HUD
```

All 12,800 arena pixels match the rendered image for iteration 242.
Iterations 238 to 244 other than 242 differ in 153 to 318 pixels. The
bullets are at arena pixels (24,40), (24,44), (36,70), (58,54), (38,40),
(6,76), (70,18) and (98,50); bullets 0 and 1 share arena cell row 5,
column 3. All 32 dot pixels are white. The 35,840 pixels of display rows
6 to 24 outside the arena are all black. Border (98, 213, 50), VICE's
PAL green.

**NTSC** (`-model ntsc`, `screenshots/char-bullets-ntsc.png`):

```
FRAME  00240  PASS
DRAW   03258  EACH 00407  MAX 03354
ERASE  00641  EACH 00080  MAX 00641
CHECK  06131  DONE AT LINE 00156
SHARED 00269  WALL HITS  00013
LOOP   14716  WHOLE ITERATION WITH HUD
```

All 12,800 arena pixels match iteration 241, with bullets 0 and 1 in
arena cell row 5, column 2. All 32 dot pixels are white, the rest of
rows 6 to 24 is black. Border (114, 189, 103).

On both models the arena is one iteration ahead of the HUD. The HUD is
written after the draw ends, on line 108 (PAL) or 156 (NTSC). Rows 0 to
5 end on line 98, so the beam has already shown them when the new
figures land. The arena starts on line 171, after the new bullets land.

| HUD line | Cycles | What the window holds |
|---|---|---|
| DRAW | 3,258 to 3,354 | `draw_all()`: for each of eight bullets, the cell address from a row table, saving code and colour, an 8-byte glyph copy, two ORs, two stores to the cell, the class chain and test |
| EACH | 407 to 419 | DRAW / 8 |
| ERASE | 641 | `erase_all()`: eight restores of code and colour, in reverse order |
| EACH | 80 | ERASE / 8 |
| CHECK | 5,873 PAL, 6,131 NTSC | `arena_intact()`: 200 screen codes and 200 colour nibbles against the copy. It runs across badlines on NTSC, hence the higher figure |
| DONE AT LINE | 108 PAL, 156 NTSC | the raster line when the draw ends; the arena starts on line 171 |
| LOOP | 12,649 PAL, 14,716 NTSC | the whole iteration with the HUD, printed on the next iteration. It is under a frame (19,656 and 17,095 cycles), so there is one iteration per frame |

DRAW changes from frame to frame. A bullet drawn over another bullet
walks one more link of the class chain, and a wall hit negates two
velocities. `MAX` is the largest figure since the start: 3,352 on PAL
and 3,354 on NTSC, 419 a bullet. The lowest DRAW is not recorded; the
range in the table runs from the last frame's figure to the maximum.
Two pinned runs per model gave byte-identical PNGs.

**The compare can fail.** A test variant restored the bullets in forward
order (0 to 7). It was built and run once on PAL. With the class chain
as listed, it hung before the first HUD update. Forward order restores
bullet 0's cell first and then writes bullet 1's saved code, which is
bullet 0's reserved code $F8, back into the same cell. The draw that
follows moves bullet 0 two pixels, still inside that cell, so it saves
$F8, its own code, as the character under it. The chain loop then never
reaches a code below $F8. With the chain walk removed (a code at or above $F8 is only counted
as shared), the same variant ran and latched
`FAIL`, a red border (175, 60, 88) and `SHARED 00475` at frame 249: the
stray $F8 stayed on screen and every bullet that crossed it counted it
as a shared cell.

## Why this works

A character cell shows the 8 bytes of its code's glyph. A bullet's
reserved glyph starts as a copy of the glyph under it, so the cell looks
the same as before plus the dot. The background glyph itself is never
written: every cell elsewhere with the same code is untouched. Only the
bullet's cell changes its code, and the saved byte puts it back.

The dot's position inside the cell is the pixel position. `x & 7` picks
the bit pair from the `dot` table and `y & 7` the glyph row. Both
coordinates are even here, so a 2 by 2 dot never crosses a cell edge. A
bullet that can straddle an edge needs two or four cells and as many
reserved glyphs.

The reverse restore order is what makes shared cells safe. When bullet 1
is drawn into bullet 0's cell it saves $F8, bullet 0's code, and builds
its glyph from bullet 0's merged glyph, so both dots show. Restoring
bullet 1 first puts $F8 back, and restoring bullet 0 next puts the
background back. Any number of bullets can stack this way. Reverse
order unwinds the stack.

The reserved glyphs are rebuilt while none of their codes is on screen:
the restore runs first, and each glyph is written before its code goes
into a cell. So the glyph cannot tear the way an in-place glyph rewrite
can. The whole erase, compare, move and draw ends on line 108 or 156,
before the arena's first line, 171. The beam never shows the arena with
the bullets erased.

Colour RAM is saved and restored with the code. Writing white makes the
bullet visible on any background colour, and it also turns the
background pixels in that cell white, because a hires cell has one
foreground colour. Colour RAM is 4 bits wide and its upper nibble reads
back as whatever was last on the data bus (`hardware/c64-registers-reference.md`,
Color RAM), so the copy and the compare mask it with `& 0x0f`.

The collision test reads the class of the saved code, not of the code
now in the cell. If the saved code is a reserved code, the bullet landed
on another bullet, and the loop follows that bullet's saved code until
it reaches a background code. That bullet was drawn earlier in the same
frame, so its saved code is current.

The compare reads the screen back, not the variables. A restore that
missed a cell, used the wrong order or wrote the wrong colour leaves a
byte that differs from the copy, and the verdict goes into `$02FF` for
the harness in `runtime/vice-reference.md`, "Verifying a run without a
human".
