// art.c: every picture. The road's multicolour characters (engine.asm draws
// with them), the hills in the sky, the car at six sizes made from one
// picture, and the ROM font copied for the panel (bank 3 has no ROM font:
// c64-kb vic_bank_visibility_collision).
#include "game.h"

// Road characters, one byte a row (the same on all eight rows). Multicolour
// pairs, left to right: 00 grass ($D021, a colour a line), 01 road ($D022),
// 10 kerb ($D023), 11 the dash (colour RAM). engine.asm's CH_ constants.
static const char road_glyph[11] = {
    0x00,                               // 0 grass
    0x55,                               // 1 road
    0x95, 0x25, 0x09, 0x02,             // 2-5 left kerb in pair 0-3: grass | kerb | road
    0x80, 0x60, 0x58, 0x56,             // 6-9 right kerb in pair 0-3: road | kerb | grass
    0x7d                                // 10 the dash: road, dash, dash, road
};

#define CH_HILL    16                   // 16 solid, 17 rising, 18 falling (11: colour RAM)

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

    memset(CHARSET, 0, 2048);
    for (char g = 0; g < 11; g++)
        for (char r = 0; r < 8; r++)
            CHARSET[g * 8 + r] = road_glyph[g];
    for (char r = 0; r < 8; r++)
    {
        char n = (r >> 1) + 1;          // pairs filled on this row, 1-4
        char rise = 0, fall = 0;
        for (char p = 0; p < n; p++)
        {
            rise |= 3 << (2 * p);       // filled from the right
            fall |= 3 << (6 - 2 * p);   // filled from the left
        }
        CHARSET[CH_HILL * 8 + r] = 0xff;
        CHARSET[(CH_HILL + 1) * 8 + r] = rise;
        CHARSET[(CH_HILL + 2) * 8 + r] = fall;
    }
    for (char k = 0; k < NSIZES; k++)
        car_picture(k);
}

// The sky rows of a road screen: blank, then hills on rows 5 and 6.
void art_sky(char *screen)
{
    static const char hills[20] = {
        0, 0, 17, 16, 18, 0, 0, 0, 17, 16, 16, 18, 0, 0, 0, 0, 17, 18, 0, 0
    };
    memset(screen, 0, 7 * 40);
    for (char c = 0; c < 40; c++)
    {
        char k = c % 20;
        screen[6 * 40 + c] = hills[k];
        screen[5 * 40 + c] = k == 9 ? CH_HILL + 1 : k == 10 ? CH_HILL + 2 : 0;
    }
}
