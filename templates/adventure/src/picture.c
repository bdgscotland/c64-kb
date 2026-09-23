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

// A picture is (run, tile) byte pairs over 7 x 40 cells, row by row; a tile
// is a character code and its colour RAM value (8 + a colour: multicolour).
void picture_draw(char p)
{
    const char *s = pic_bytes + pic_at[p];
    char *d = SCREEN;
    char *t = COLOUR;
    unsigned left = 40 * PIC_ROWS;
    while (left)
    {
        char n = s[0], ch = tile_char[s[1]], co = tile_colour[s[1]];
        s += 2;
        left -= n;
        for (char k = 0; k < n; k++)
        {
            d[k] = ch;
            t[k] = co;
        }
        d += n;
        t += n;
    }
}
