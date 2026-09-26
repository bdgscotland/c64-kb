---
recipe: double-buffer-nomirror
toolchain: oscar64
output_format: PRG
region: both
techniques: [screen_double_buffer_d018, screen_ram_relocation]
file_formats: [PRG]
uses_registers: [D018, D011, D000, D001, D010, D015, D027, D020, D021, DC06, DC07, DC0F]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 Double Buffer without the sprite pointer mirror: the sprite the fill leaves behind

## Synopsis

The `double-buffer` recipe with one change: `MIRROR_SPRITE_POINTERS` is 0,
so the line that restores sprite 0's pointer after the whole-page fill is
compiled out. Everything else is identical, including the fill that
writes bytes 1000 to 1023 of the page. The picture shows what the sprite
becomes when the pointer block is not kept in step with the page on
display. Run it next to the main recipe to see the fault, then keep the
mirror.

## Source

```c
// double-buffer-nomirror.c -- two text screens in VIC bank 0, flipped by one $D018
// write per frame. Build: oscar64 -tm=c64 -O2 -o=double-buffer-nomirror.prg double-buffer-nomirror.c
#include <c64/vic.h>
#include <c64/cia.h>
#include <string.h>

// 1 = keep both pages' sprite pointer blocks in step (correct).
// 0 = the companion recipe: page B's pointer block is never written.
#define MIRROR_SPRITE_POINTERS 0

// Code and data below the pages; pages at $2800 (VM 10) and $2C00 (VM 11),
// clear of the character ROM the VIC sees at $1000-$1FFF in bank 0.
#pragma region( lower, 0x0a00, 0x2800, , , {code, data} )
#pragma region( main, 0x3000, 0xa000, , , {code, data, bss, heap, stack} )

#define PAGE_A   ((char *)0x2800)
#define PAGE_B   ((char *)0x2c00)
#define COLOUR   ((char *)0xd800)
#define SPR_DATA ((char *)0x0340)     // block 13, the cassette buffer
#define SPR_BLOCK 13
#define CHARSET_CB 0x04               // ROM font at $1000: CB bits = 010

static char * const page[2] = { PAGE_A, PAGE_B };
static const char  vm[2]    = { 10, 11 };

// One 256-byte template per page, written four times to cover the whole
// 1 KB page. Page A: diagonal stripes. Page B: horizontal bands.
static char tpl[2][256];

static unsigned draw_cycles;          // cost of the previous draw

// Measurement builds only (-dREDRAW_ROWS=n): the draw copies n 40-byte
// rows from a 1,000-byte map per page instead of the template fill, and
// the timer stops before the caption. Not defined, the program is the one
// the pictures below come from.
#ifdef REDRAW_ROWS
static char map[2][1000];

static void copy_rows(char * s, const char * m, char n)
{
    for (char r = 0; r < n; r++) {
        for (char c = 0; c < 40; c++) s[c] = m[c];
        s += 40;
        m += 40;
    }
}
#endif

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

// Draw one whole 1 KB page: the template goes to +0, +256, +512 and +768,
// so bytes 1000-1023 are written too. That is what overwrites the sprite
// pointer block at +$3F8, on every frame, on both pages.
static void draw_page(char p, unsigned frame)
{
    char * s = page[p];
    const char * t = tpl[p];
    char i = 0;

    cia1.crb = 0x00;
    cia1.tb  = 0xffff;
    cia1.crb = 0x11;                  // force load, start, count phi2

#ifdef REDRAW_ROWS
    copy_rows(s, map[p], REDRAW_ROWS);
#if MIRROR_SPRITE_POINTERS
    s[0x3f8] = SPR_BLOCK;
#endif
    cia1.crb = 0x00;
    draw_cycles = 0xffff - cia1.tb;
    put_str(s,       "FRAME 00000 PAGE A  DRAW 00000");
    put_dec5(s + 6,  frame);
    s[17] = 1 + p;
    put_dec5(s + 25, draw_cycles);
    return;
#endif
    if (p == 0) {
        do {
            char v = t[i];
            PAGE_A[i] = v; PAGE_A[i + 256] = v;
            PAGE_A[i + 512] = v; PAGE_A[i + 768] = v;
        } while (++i);
    } else {
        do {
            char v = t[i];
            PAGE_B[i] = v; PAGE_B[i + 256] = v;
            PAGE_B[i + 512] = v; PAGE_B[i + 768] = v;
        } while (++i);
    }

#if MIRROR_SPRITE_POINTERS
    s[0x3f8] = SPR_BLOCK;             // pointer block moves with the page
#endif

    put_str(s,       "FRAME 00000 PAGE A  DRAW 00000");
    put_dec5(s + 6,  frame);
    s[17] = 1 + p;                    // screen code 1 = 'A', 2 = 'B'
    put_dec5(s + 25, draw_cycles);

    cia1.crb = 0x00;
    draw_cycles = 0xffff - cia1.tb;
}

int main(void)
{
    __asm { sei }

    for (unsigned k = 0; k < 256; k++) {
        char r = (char)(k / 40), c = (char)(k % 40);
        tpl[0][k] = (((r + c) & 7) < 4) ? 0x66 : 0x20;   // diagonals
        tpl[1][k] = (r & 2) ? 0xa0 : 0x20;               // bands
    }
#ifdef REDRAW_ROWS
    for (unsigned k = 0; k < 1000; k++) {
        map[0][k] = tpl[0][k & 255];
        map[1][k] = tpl[1][k & 255];
    }
#endif

    memset(COLOUR, 1, 1000);          // one colour RAM, white, set once
    vic.color_border = 0;
    vic.color_back   = 0;

    // One sprite: a hollow box, 21 rows.
    for (char r = 0; r < 21; r++) {
        char edge = (r == 0 || r == 20) ? 0xff : 0x80;
        SPR_DATA[r * 3]     = edge;
        SPR_DATA[r * 3 + 1] = (r == 0 || r == 20) ? 0xff : 0x00;
        SPR_DATA[r * 3 + 2] = (r == 0 || r == 20) ? 0xff : 0x01;
    }
    vic.spr_pos[0].x  = 172;
    vic.spr_pos[0].y  = 130;
    vic.spr_msbx      = 0;
    vic.spr_color[0]  = 7;            // yellow
    vic.spr_enable    = 1;

    unsigned frame = 0;
    char     hidden = 0;

    for (;;) {
        frame++;
        draw_page(hidden, frame);             // hidden page only
        vic_waitFrame();                      // line 256: below the display
        vic.memptr = (vm[hidden] << 4) | CHARSET_CB;   // the flip
        hidden ^= 1;
    }
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=double-buffer-nomirror.prg double-buffer-nomirror.c
```

Run headless with the same command as the main recipe, PRG and PNG names
changed. Only the PAL picture is pinned.

## Expected output

**PAL, 8,000,000 cycles** (`screenshots/double-buffer-nomirror.png`):
the same black screen, the same diagonal stripes, and row 0 reads
`FRAME 00251 PAGE A  DRAW 12572`. The frame number and page match the
main recipe at the same cycle count; the draw is 26 cycles cheaper
because one store is gone.

The sprite is not a box. In the same 24 by 21 pixel area (PNG columns 180
to 203, rows 115 to 135) there are 190 yellow pixels of noise. Measured
with PIL, the noise is exactly the 63 bytes at $0800-$083E of the loaded
program, rendered as a sprite: the byte before the BASIC stub, the stub
itself and the first bytes of Oscar64's start-up code. Every one of the
21 rows matches the PRG's bytes bit for bit.

The reason is arithmetic from the listing and confirmed by that match:
the fill writes template byte 248 at page offset $3F8. On page A that is
row 6, column 8 of the diagonal pattern, a space, screen code $20 = 32,
and sprite block 32 is $0800. On page B the same offset takes the band
value $A0 = 160, and block 160 is $2800, page A itself, so on B frames the
sprite is a picture of page A's first 63 screen bytes; that frame is not
pinned. The image changes on every flip, which on a running machine reads
as a flickering smear where the box should be.

## Why this works

Nothing in the flip is different. The VIC fetches sprite 0's pointer from
`visible_page + $3F8` on every raster line, and the fill puts a pattern
byte there on every frame. With the mirror, the next line of the listing
puts 13 back and the pointer the VIC reads is always 13. Without it, the
pointer is whatever the pattern left, on both pages, so the fault shows
on every frame and not only after a flip.

The fix is the one line the main recipe keeps, and the general rule is on
the technique page: whatever writes the hidden page must leave bytes
+$3F8 to +$3FF holding the same eight pointers the visible page holds,
before the flip. A whole-page clear is the usual way to break that, and a
sprite library that stores a single screen pointer (`vspr_init` keeps one)
is the other.
