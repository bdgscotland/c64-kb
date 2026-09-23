// picture.c: see picture.h.
#include "picture.h"
#include "text.h"
#include "gen_world.h"
#include <c64/vic.h>

// charset_copy_rom_to_ram: codes 0-63 (letters, digits, punctuation) and
// 128-255 (their reverse) from the character ROM at $D000; codes 64-127 are
// the picture glyphs from gen_world.h. The ROM is seen by the CPU only with
// the I/O area switched out ($01 bit 2 clear), so no interrupt may run then
// (pitfall irq_during_charen_window); the caller has interrupts off.
static void charset_build(void)
{
    volatile char *port = (volatile char *)0x01;
    const char *rom = (const char *)0xd000;
    char save = *port;
    *port = save & ~0x04;
    for (unsigned i = 0; i < 512; i++)
        CHARSET[i] = rom[i];
    for (unsigned i = 1024; i < 2048; i++)
        CHARSET[i] = rom[i];
    *port = save;
    for (unsigned i = 0; i < NGLYPH * 8; i++)
        CHARSET[512 + i] = glyph_bytes[i];
}

void video_init(void)
{
    charset_build();
    vic.color_border = VCOL_BLACK;
    vic.color_back = VCOL_BLACK;                // %00 and the hires text background
    vic.color_back1 = VCOL_MED_GREY;            // %01: stone
    vic.color_back2 = VCOL_BROWN;               // %10: wood and earth
    vic.memptr = 0x1e;                          // screen $0400, characters $3800
    vic.ctrl2 = 0x18;                           // MCM on, 40 columns, XSCROLL 0: a whole value
}

// A picture is coded row by row, and nothing crosses the end of a row, so
// the column and the offset in the row's bytes are single bytes. A byte n
// below $80 is a run: n cells of the tile that follows. $80 + n is a literal:
// n tiles follow, one a cell. A tile is a character code and its colour RAM
// value (8 + a colour: multicolour). The first version coded runs only,
// across rows, with a 16-bit count: the library, whose book rows are runs of
// one cell, took 20,240 cycles, over the frame on PAL and NTSC (found in
// review; the autopilot never entered the library, see the picture pass in
// main.c).
void picture_draw(char p)
{
    const char *s = pic_bytes + pic_at[p];
    char *d = SCREEN;
    char *t = COLOUR;
    for (char r = 0; r < PIC_ROWS; r++)
    {
        char x = 0, i = 0;
        do
        {
            char c = s[i++];
            if (c & 0x80)
            {
                char e = x + (c & 0x7f);
                do
                {
                    char tile = s[i++];
                    d[x] = tile_char[tile];
                    t[x] = tile_colour[tile];
                } while (++x != e);
            }
            else
            {
                char tile = s[i++], e = x + c;
                char ch = tile_char[tile], co = tile_colour[tile];
                do
                {
                    d[x] = ch;
                    t[x] = co;
                } while (++x != e);
            }
        } while (x < 40);
        s += i;
        d += 40;
        t += 40;
    }
}
