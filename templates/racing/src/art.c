// art.c: the pictures C draws: the hills in the sky, the car at six sizes
// made from one picture, and the ROM font copied for the panel (bank 3 has no
// ROM font: c64-kb vic_bank_visibility_collision).
#include "game.h"

// The road's characters are engine.asm's (glyphs.asm): four sets made by
// glyph_init. The sky rows use set 3, which holds the hills at ids 2-4.
#define CH_HILL    2                    // 2 solid, 3 rising, 4 falling (11: colour RAM)

// The car from behind, 12 multicolour pixels by 16 rows: . clear,
// a black ($D025), x the car's colour ($D027 + s), b light red ($D026).
static const char car_art[16][13] = {
    "....xxxx....",
    "...xaaaax...",
    "..xaaaaaax..",
    "..xaaaaaax..",
    ".xxxxxxxxxx.",
    "xxxxxxxxxxxx",
    "xbbxxxxxxbbx",
    "xbbxxxxxxbbx",
    "xxxxxxxxxxxx",
    "xxxxaaaaxxxx",
    "xxxxxxxxxxxx",
    "aaax....xaaa",
    "aaa......aaa",
    "aaa......aaa",
    "aaa......aaa",
    "aaa......aaa",
};

const char size_w[NSIZES] = { 4, 8, 12, 16, 20, 24 };   // pixels (even: multicolour)
const char size_h[NSIZES] = { 3, 5, 8, 10, 13, 16 };

static char pair_of(char ch)
{
    return ch == 'a' ? 1 : ch == 'x' ? 2 : ch == 'b' ? 3 : 0;
}

// Picture k: car_art scaled to size_w[k] x size_h[k] (nearest pixel), in
// rows 0-h (the small ones) or rows 21-h to 20 (the big ones): road.c's
// top_aligned.
static void car_picture(char k)
{
    char *d = SPRITES + k * 64;
    memset(d, 0, 64);
    char pw = size_w[k] >> 1, h = size_h[k];
    char first = k < 3 ? 0 : 21 - h;
    for (char r = 0; r < h; r++)
    {
        const char *src = car_art[(unsigned)r * 16 / h];
        char left = (12 - pw) >> 1;     // centred in the 12 pairs
        for (char p = 0; p < pw; p++)
        {
            char q = left + p;
            char v = pair_of(src[(unsigned)p * 12 / pw]);
            d[(first + r) * 3 + (q >> 2)] |= v << (6 - 2 * (q & 3));
        }
    }
}

void art_init(void)
{
    // The ROM's upper-case set, 256 characters with the reversed half, for
    // the panel and the meter.
    *(volatile char *)1 = 0x33;         // character ROM in at $D000
    for (unsigned i = 0; i < 2048; i++)
        HUDFONT[i] = ((char *)0xd000)[i];
    *(volatile char *)1 = 0x35;         // I/O back; BASIC and KERNAL stay out

    for (char k = 0; k < NSIZES; k++)
        car_picture(k);
}

// The sky rows of a road screen: blank, then hills on rows 5 and 6.
void art_sky(char *screen)
{
    static const char hills[20] = {
        0, 0, 3, 2, 4, 0, 0, 0, 3, 2, 2, 4, 0, 0, 0, 0, 3, 4, 0, 0
    };
    memset(screen, 0, 7 * 40);
    for (char c = 0; c < 40; c++)
    {
        char k = c % 20;
        screen[6 * 40 + c] = hills[k];
        screen[5 * 40 + c] = k == 9 ? CH_HILL + 1 : k == 10 ? CH_HILL + 2 : 0;
    }
}
