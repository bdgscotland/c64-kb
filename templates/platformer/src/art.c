// art.c: every picture in the game, as text, turned into glyphs and
// sprite shapes at start-up. Original art. tools/tearcheck.py reads the
// glyph art and the slope rule from this file to render the level.
#include "game.h"
#include <string.h>

// Playfield glyphs, multicolour: four double-width pixels a row.
// '.' $D021 sky, 'b' $D022 earth, 'y' $D023 gold, 'g' colour RAM grass.
// GLYPH-ART-BEGIN
static const char glyph_code[] = {
    CH_DIRT, CH_GRASS, CH_BRICK, CH_LEDGE,
    CH_COIN_TL, CH_COIN_TR, CH_COIN_BL, CH_COIN_BR, CH_FLAG, CH_POLE
};
static const char glyph_art[][8][5] = {
    { "bbbb", "bybb", "bbbb", "bbby", "bbbb", "ybbb", "bbbb", "bbyb" },   // dirt
    { "gggg", "gggg", "bgbg", "bbbb", "bbyb", "bbbb", "ybbb", "bbbb" },   // grass
    { "yyyy", "bbyb", "bbyb", "bbyb", "yyyy", "ybbb", "ybbb", "ybbb" },   // brick
    { "gggg", "bbbb", "b.b.", "....", "....", "....", "....", "...." },   // ledge
    { "....", "....", "..by", ".byy", "byyy", "byyb", "byyb", "byyb" },   // coin, top left
    { "....", "....", "yb..", "yyb.", "yyyb", "byyb", "byyb", "byyb" },   // coin, top right
    { "byyb", "byyb", "byyb", "byyy", ".byy", "..by", "....", "...." },   // coin, bottom left
    { "byyb", "byyb", "byyb", "yyyb", "yyb.", "yb..", "....", "...." },   // coin, bottom right
    { "byyy", "byyy", "byyy", "byy.", "by..", "b...", "b...", "b..." },   // flag
    { "b...", "b...", "b...", "b...", "b...", "b...", "b...", "b..." },   // pole
};
// GLYPH-ART-END

// Sprite art, 16 pixels wide, 'x' set. Player art is 21 rows with the feet
// on row 20; enemy art is 16 rows with the feet on row 15.
static const char art_shape[] = {
    SH_STAND, SH_RUN1, SH_RUN2, SH_JUMP, SH_HURT,
    SH_WALK1, SH_WALK2, SH_SQUASH, SH_HOP_SIT, SH_HOP_UP
};
static const char sprite_art[][21][17] = {
    {   // stand
        "......xxxxx.....", ".....xxxxxxx....", ".....xx.xx.x....", ".....xxxxxxx....",
        ".....xxxx..x....", "......xxxxx.....", ".......xxx......", ".....xxxxxxx....",
        "....xxxxxxxxx...", "...xx.xxxxx.xx..", "...xx.xxxxx.xx..", "...xx.xxxxx.xx..",
        "......xxxxx.....", "......xxxxx.....", "......xx.xx.....", "......xx.xx.....",
        "......xx.xx.....", "......xx.xx.....", "......xx.xx.....", ".....xxx.xxx....",
        ".....xxx.xxx....",
    },
    {   // run 1
        "......xxxxx.....", ".....xxxxxxx....", ".....xx.xx.x....", ".....xxxxxxx....",
        ".....xxxx..x....", "......xxxxx.....", ".......xxx......", "....xxxxxxxx....",
        "...xxxxxxxxxx...", "..xx..xxxxx.xx..", ".xx...xxxxx..xx.", "......xxxxx.....",
        "......xxxxx.....", ".....xxxxxx.....", ".....xx...xx....", "....xx.....xx...",
        "....xx.....xx...", "...xx.......xx..", "...xx.......xx..", "..xxx.......xxx.",
        "..xxx.......xxx.",
    },
    {   // run 2
        "................", "......xxxxx.....", ".....xxxxxxx....", ".....xx.xx.x....",
        ".....xxxxxxx....", ".....xxxx..x....", "......xxxxx.....", ".......xxx......",
        ".....xxxxxxx....", "....xxxxxxxxx...", "....xx.xxxx.xx..", "....xx.xxxx.xx..",
        "......xxxxx.....", "......xxxxx.....", "......xxxx......", ".....xx.xx......",
        ".....xx..xx.....", "....xx...xx.....", "....xx....xx....", "...xxx....xxx...",
        "...xxx....xxx...",
    },
    {   // jump
        "..xx..xxxxx..xx.", "..xx.xxxxxxx.xx.", "..xx.xx.xx.x.xx.", "..xx.xxxxxxx.xx.",
        "..xx.xxxx..x.xx.", "...xx.xxxxx.xx..", "....xxxxxxxxx...", ".....xxxxxxx....",
        "......xxxxx.....", "......xxxxx.....", "......xxxxx.....", "......xxxxx.....",
        ".....xxxxxxx....", "....xxx...xxx...", "...xxx.....xxx..", "...xx.......xx..",
        "...xx.......xx..", "..xxx.......xxx.", "..xxx.......xxx.", "................",
        "................",
    },
    {   // hurt
        "................", "..x...xxxxx...x.", "..xx.xxxxxxx.xx.", "...xxx.x.x.xxx..",
        ".....xxxxxxx....", ".....xx...xx....", "......xxxxx.....", "....xxxxxxxxx...",
        "...xx.xxxxx.xx..", "..xx..xxxxx..xx.", ".xx...xxxxx...xx", "......xxxxx.....",
        ".....xx...xx....", "....xx.....xx...", "...xx.......xx..", "..xx.........xx.",
        ".xx...........xx", "................", "................", "................",
        "................",
    },
    {   // walker 1
        "................", ".....xxxxxx.....", "...xxxxxxxxxx...", "..xxxxxxxxxxxx..",
        ".xxx..xxxx..xxx.", ".xxx..xxxx..xxx.", ".xxxxxxxxxxxxxx.", ".xxxxxxxxxxxxxx.",
        ".xxxx......xxxx.", "..xxxxxxxxxxxx..", "...xxxxxxxxxx...", "....xxxxxxxx....",
        "....xx....xx....", "...xxx....xxx...", "...xxx....xxx...", "..xxxx....xxxx..",
    },
    {   // walker 2
        "................", ".....xxxxxx.....", "...xxxxxxxxxx...", "..xxxxxxxxxxxx..",
        ".xxx..xxxx..xxx.", ".xxx..xxxx..xxx.", ".xxxxxxxxxxxxxx.", ".xxxxxxxxxxxxxx.",
        ".xxxx......xxxx.", "..xxxxxxxxxxxx..", "...xxxxxxxxxx...", "....xxxxxxxx....",
        ".....xx..xx.....", "....xxx..xxx....", "....xxx..xxx....", "...xxxx..xxxx...",
    },
    {   // squashed
        "................", "................", "................", "................",
        "................", "................", "................", "................",
        "................", "................", "................", "................",
        "..xxxxxxxxxxxx..", ".xxx..xxxx..xxx.", ".xxxxxxxxxxxxxx.", "..xxxx....xxxx..",
    },
    {   // hopper, sitting
        "................", "................", "................", "................",
        "...xxx....xxx...", "..xx.xx..xx.xx..", "..xxxxxxxxxxxx..", ".xxxxxxxxxxxxxx.",
        ".xxxxxxxxxxxxxx.", ".xx.xxxxxxxx.xx.", ".xxx........xxx.", "..xxxxxxxxxxxx..",
        "...xxxxxxxxxx...", "..xxx......xxx..", ".xxxx......xxxx.", ".xxx........xxx.",
    },
    {   // hopper, in the air
        "...xxx....xxx...", "..xx.xx..xx.xx..", "..xxxxxxxxxxxx..", "..xxxxxxxxxxxx..",
        "..xxxxxxxxxxxx..", "..xx.xxxxxx.xx..", "..xxx......xxx..", "...xxxxxxxxxx...",
        "....xxxxxxxx....", "....xx....xx....", "....xx....xx....", "...xx......xx...",
        "...xx......xx...", "..xx........xx..", "..xx........xx..", ".xxx........xxx.",
    },
};

// Collision box per shape (c64-kb per_frame_hitbox), from the art's
// top-left. The hurt and squashed shapes have none (x0 > x1).
struct Box shape_box[SH_COUNT] = {
    { 5, 1, 11, 20 }, { 4, 1, 12, 20 }, { 4, 1, 12, 20 }, { 4, 0, 12, 18 },   // player, right
    { 0 }, { 0 }, { 0 }, { 0 },                                               // mirrored below
    { 1, 0, 0, 0 },                                                           // hurt: none
    { 2, 1, 13, 15 }, { 2, 1, 13, 15 },                                       // walker
    { 1, 0, 0, 0 },                                                           // squashed: none
    { 2, 4, 13, 15 }, { 3, 0, 12, 15 },                                       // hopper
};

static char mc_pixel(char c)
{
    return c == 'b' ? 1 : c == 'y' ? 2 : c == 'g' ? 3 : 0;
}

// A slope glyph from the height table: grass on the surface row, earth
// below. A double-width pixel takes the higher of its two columns.
static void slope_glyph(char *g, char type)
{
    const char *h = heights + type * 8;
    for (char r = 0; r < 8; r++)
    {
        char b = 0;
        for (char k = 0; k < 4; k++)
        {
            char s = h[2 * k] < h[2 * k + 1] ? h[2 * k] : h[2 * k + 1];
            char v = r < s ? 0 : r == s ? 3 : 1;
            b |= v << (6 - 2 * k);
        }
        g[r] = b;
    }
}

void art_build(void)
{
    // The ROM's upper-case glyphs 0-63, for text and the meter. Bank 3 has
    // no ROM font (c64-kb vic_bank_visibility_collision), so copy it.
    memset(CHARSET, 0, 2048);
    *(volatile char *)1 = 0x33;                 // character ROM in at $D000
    for (unsigned i = 0; i < 512; i++)
        CHARSET[i] = ((char *)0xd000)[i];
    *(volatile char *)1 = 0x35;                 // I/O back; BASIC and KERNAL stay out

    for (char i = 0; i < sizeof(glyph_code); i++)
    {
        char *g = CHARSET + glyph_code[i] * 8;
        for (char r = 0; r < 8; r++)
        {
            const char *row = glyph_art[i][r];
            g[r] = (mc_pixel(row[0]) << 6) | (mc_pixel(row[1]) << 4) | (mc_pixel(row[2]) << 2) | mc_pixel(row[3]);
        }
    }
    for (char t = 1; t <= 6; t++)
        slope_glyph(CHARSET + (CH_SLOPE1 - 1 + t) * 8, t);

    // Sprite shapes; the player's four also mirrored into shapes 4-7.
    memset(SPRMEM, 0, 1024);
    for (char i = 0; i < sizeof(art_shape); i++)
    {
        char s = art_shape[i];
        char *d = SPRMEM + s * 64;
        char *m = SPRMEM + (s + SH_MIRROR) * 64;
        for (char r = 0; r < 21; r++)
        {
            const char *row = sprite_art[i][r];
            unsigned bits = 0, mirror = 0;
            for (char c = 0; c < 16 && row[c]; c++)
            {
                if (row[c] == 'x')
                {
                    bits |= 0x8000u >> c;
                    mirror |= 1u << c;
                }
            }
            d[r * 3] = bits >> 8;
            d[r * 3 + 1] = bits & 0xff;
            if (s < SH_MIRROR)
            {
                m[r * 3] = mirror >> 8;
                m[r * 3 + 1] = mirror & 0xff;
            }
        }
    }
    for (char s = 0; s < SH_MIRROR; s++)
    {
        struct Box *b = shape_box + s, *m = shape_box + s + SH_MIRROR;
        m->x0 = 15 - b->x1;
        m->x1 = 15 - b->x0;
        m->y0 = b->y0;
        m->y1 = b->y1;
    }
}
