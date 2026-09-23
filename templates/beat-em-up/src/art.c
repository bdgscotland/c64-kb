// art.c: every picture in the game, as text, turned into glyphs and sprite
// blocks at start-up; the pose table that puts two blocks together into a
// fighter (c64-kb multi_sprite_object); the hurt and hit boxes
// (per_frame_hitbox). Original art. tools/flickercheck.py reads the
// SPRITE-ART block and the mirror rule from this file.
#include "game.h"
#include <string.h>

// Street glyphs, multicolour: four double-width pixels a row.
// '.' $D021 grey, 'b' $D022 brown, 'y' $D023 yellow, 'k' colour RAM
// (blue on rows 0-1, black below).
static const char glyph_code[] = {
    CH_SKY, CH_ROOF, CH_BRICK, CH_WIN_T, CH_WIN_B, CH_DOOR, CH_SIGN,
    CH_PAVE, CH_KERB, CH_ROAD, CH_DASH, CH_LAMP, CH_POLE
};
static const char glyph_art[][8][5] = {
    { "kkkk", "kkkk", "kkkk", "kkkk", "kkkk", "kkkk", "kkkk", "kkkk" },   // sky; an alley
    { "kkkk", "kkkk", "kkkk", "kkkk", "kkkk", "bbbb", "....", "bbbb" },   // roof edge
    { "bbb.", "bbb.", "....", "b.bb", "b.bb", "....", "bbb.", "bbb." },   // brick
    { "kkkk", "kyyk", "kyyk", "kyyk", "kyyk", "kyyk", "kkkk", "kyyk" },   // window, top
    { "kyyk", "kyyk", "kyyk", "kkkk", "bbbb", "....", "bb.b", "bbbb" },   // window, bottom
    { "bkkb", "bkkb", "bkkb", "bkkb", "bkyb", "bkkb", "bkkb", "bkkb" },   // door
    { "yyyy", "ykyk", "ykky", "yyky", "ykyk", "yyyy", "bbbb", "...." },   // shop sign
    { "....", "....", "....", "k...", "....", "....", "....", "..k." },   // pavement
    { "....", "....", "....", "yyyy", "bbbb", "bbbb", "....", "...." },   // kerb
    { "....", "....", "..k.", "....", "....", "k...", "....", "...." },   // road
    { "....", "....", "....", "yyyy", "yyyy", "....", "....", "...." },   // centre line
    { "kkkk", "kyyk", "yyyy", "yyyy", "kyyk", "k.kk", "k.kk", "k.kk" },   // lamp
    { "k.kk", "k.kk", "k.kk", "k.kk", "k.kk", "k.kk", "k.kk", "k.kk" },   // lamp post
};

// HUD bar glyphs, hires ('x' set): a full cell is two hit points.
static const char bar_art[3][8][9] = {
    { "........", "xxxxxxx.", "xxxxxxx.", "xxxxxxx.", "xxxxxxx.", "xxxxxxx.", "xxxxxxx.", "........" },
    { "........", "xxx.....", "xxx.....", "xxx.....", "xxx.....", "xxx.....", "xxx.....", "........" },
    { "........", "x.......", "........", "........", "........", "........", "x.......", "........" },
};

// Sprite blocks: 12 double-width pixels a row, 21 rows, facing right.
// '.' transparent, 'a' $D025 skin, 'x' the sprite's own colour (a shirt
// on a top part, trousers on legs), 'b' $D026 black. A fighter's origin
// is 8 pixels in from a part's left edge (between columns 3 and 4); the
// body is columns 0-6 and a fist or a foot reaches to column 11.
// Mirroring reverses the twelve pixels of every row.
// SPRITE-ART-BEGIN
static const char sprite_art[][21][13] = {
    {   // B_T_STAND: head and fists up
        "..bbbb......", ".bbbbbb.....", ".bbaaab.....", ".baaaba.....", "..aaaaa.....",
        "..aaaa......", "...aa.......", ".xxxxxx.....", "xxxxxxxaa...", "xxxxxxxaa...",
        "xxxxxxx.....", "axxxxx......", "aaxxxx......", ".xxxxx......", ".xxxxx......",
        ".xxxxx......", ".xxxxx......", ".xxxxx......", ".xxxxx......", ".bbbbb......",
        ".bbbbb......",
    },
    {   // B_T_WIND: the fist drawn back
        "..bbbb......", ".bbbbbb.....", ".bbaaab.....", ".baaaba.....", "..aaaaa.....",
        "..aaaa......", "...aa.......", ".xxxxxx.....", "xxxxxaa.....", "xxxxxaa.....",
        "xxxxxxx.....", "axxxxx......", "aaxxxx......", ".xxxxx......", ".xxxxx......",
        ".xxxxx......", ".xxxxx......", ".xxxxx......", ".xxxxx......", ".bbbbb......",
        ".bbbbb......",
    },
    {   // B_T_PUNCH: the arm out, the fist at columns 10-11
        "..bbbb......", ".bbbbbb.....", ".bbaaab.....", ".baaaba.....", "..aaaaa.....",
        "..aaaa......", "...aa.......", ".xxxxxx.....", "xxxxxxxxxxaa", "xxxxxxxxxxaa",
        "xxxxxx......", "axxxxx......", "aaxxxx......", ".xxxxx......", ".xxxxx......",
        ".xxxxx......", ".xxxxx......", ".xxxxx......", ".xxxxx......", ".bbbbb......",
        ".bbbbb......",
    },
    {   // B_T_LEAN: leaning back for a kick
        ".bbbb.......", "bbbbbb......", "bbaaab......", "baaaba......", ".aaaaa......",
        ".aaaa.......", "..aa........", "xxxxxx......", "xxxxxxaa....", "xxxxxxaa....",
        "axxxxx......", "aaxxxx......", ".xxxxx......", ".xxxxx......", ".xxxxx......",
        ".xxxxx......", ".xxxxx......", ".xxxxx......", ".xxxxx......", ".bbbbb......",
        ".bbbbb......",
    },
    {   // B_T_HURT: the head snapped back
        "bbbb........", "bbbbbb......", "bbaaab......", "baaabaa.....", ".aaaaaa.....",
        "..aaaa......", "...aa.......", ".xxxxxx.....", "axxxxxxxa...", "axxxxxxxaa..",
        "..xxxxx..a..", ".xxxxxx.....", ".xxxxxx.....", ".xxxxx......", ".xxxxx......",
        ".xxxxx......", ".xxxxx......", ".xxxxx......", ".xxxxx......", ".bbbbb......",
        ".bbbbb......",
    },
    {   // B_T_JUMP: arms up
        "..bbbb..aa..", ".bbbbbb.aa..", ".bbaaabxx...", ".baaabaxx...", "..aaaaaxx...",
        "..aaaaxx....", "...aaxxx....", "aaxxxxxx....", "aaxxxxx.....", ".xxxxxx.....",
        ".xxxxxx.....", ".xxxxx......", ".xxxxx......", ".xxxxx......", ".xxxxx......",
        ".xxxxx......", ".xxxxx......", ".xxxxx......", ".xxxxx......", ".bbbbb......",
        ".bbbbb......",
    },
    {   // B_L_STAND: feet apart
        ".xxxxx......", ".xxxxx......", ".xxxxxx.....", "xxx.xxx.....", "xx...xx.....",
        "xx...xx.....", "xx....xx....", "xx....xx....", "xx....xx....", "xx.....xx...",
        "xx.....xx...", "xx.....xx...", "xx.....xx...", "xx.....xx...", "xx.....xx...",
        "xx.....xx...", "xx.....xx...", "xx.....xx...", "xx.....xx...", "bbb....bbb..",
        "bbb....bbbb.",
    },
    {   // B_L_WALK1: a long stride
        ".xxxxx......", ".xxxxx......", ".xxxxxx.....", ".xx..xxx....", ".xx...xxx...",
        ".xx....xx...", ".xx.....xx..", ".xx.....xx..", ".xx.....xx..", ".xx......xx.",
        ".xx......xx.", ".xx......xx.", ".xx......xx.", ".xx......xx.", ".xx......xx.",
        ".xx......xx.", ".xx......xx.", ".xx......xx.", ".xx......xx.", "bbb......bbb",
        "bbb......bbb",
    },
    {   // B_L_WALK2: the legs passing
        ".xxxxx......", ".xxxxx......", ".xxxxx......", ".xx.xx......", ".xx.xx......",
        ".xx.xx......", ".xx.xx......", ".xx.xx......", ".xx.xx......", ".xx.xx......",
        ".xx.xx......", ".xx.xx......", ".xx.xx......", ".xx.xx......", ".xx.xx......",
        ".xx.xx......", ".xx.xx......", ".xx.xx......", ".xx.xx......", "bbb.bbbb....",
        "bbb.bbbb....",
    },
    {   // B_L_CHAMBER: the knee up
        ".xxxxx......", ".xxxxxxxx...", ".xxxxxxxxx..", ".xx...xxxx..", ".xx....xxx..",
        ".xx....xx...", ".xx...bbb...", ".xx...bb....", ".xx.........", ".xx.........",
        ".xx.........", ".xx.........", ".xx.........", ".xx.........", ".xx.........",
        ".xx.........", ".xx.........", ".xx.........", ".xx.........", "bbb.........",
        "bbb.........",
    },
    {   // B_L_KICK: the leg out, the foot at column 11
        ".xxxxx......", ".xxxxxxxxxxb", ".xxxxxxxxxxb", ".xxxxxxxxxxb", ".xx.........",
        ".xx.........", ".xx.........", ".xx.........", ".xx.........", ".xx.........",
        ".xx.........", ".xx.........", ".xx.........", ".xx.........", ".xx.........",
        ".xx.........", ".xx.........", ".xx.........", ".xx.........", "bbb.........",
        "bbb.........",
    },
    {   // B_L_TUCK: knees up in a jump
        ".xxxxx......", ".xxxxxx.....", ".xxxxxxx....", ".xx..xxx....", "xx....xx....",
        "xx...bbb....", "xx...bb.....", "bbb.........", "bbb.........", "............",
        "............", "............", "............", "............", "............",
        "............", "............", "............", "............", "............",
        "............",
    },
    {   // B_L_KNEEL: one knee down
        "............", "............", "............", "............", "............",
        "............", "............", "............", "............", "............",
        ".xxxxx......", ".xxxxx......", ".xxxxxxxx...", ".xx...xxxx..", ".xx....xx...",
        ".xx....xx...", ".xx....xx...", ".xx....xx...", "xxx...bbbb..", "xxxxxx......",
        "bbbbbb......",
    },
    {   // B_D_HEAD: lying, the head half
        "............", "............", "............", "............", "............",
        "............", "............", "............", "............", "............",
        "............", "............", "............", "............", "..bbb.......",
        ".bbaab......", ".baaaaxxxxxx", ".baaaxxxxxxx", "..aa.xxxxxxx", ".....aaxxxxx",
        "............",
    },
    {   // B_D_FEET: lying, the feet half
        "............", "............", "............", "............", "............",
        "............", "............", "............", "............", "............",
        "............", "............", "............", "............", "............",
        "............", "xbbxxxxxx...", "xbbxxxxxxxb.", "xxxxxxxxxxbb", "xxxx.....xbb",
        "............",
    },
    {   // B_GO: the sign that says the stage is clear
        "............", ".xxx..xxx...", "x....x...x..", "x.xx.x...x..", "x..x.x...x..",
        ".xx...xxx...", "............", "......x.....", "......xx....", "xxxxxxxxx...",
        "xxxxxxxxxx..", "xxxxxxxxx...", "......xx....", "......x.....", "............",
        "............", "............", "............", "............", "............",
        "............",
    },
    {   // B_FACE_HERO
        "............", "...bbbbbb...", "..bbbbbbbb..", ".bbbbbbbbbb.", ".xxxxxxxxxx.",
        ".baaaaaaaab.", ".aaaaaaaaaa.", ".aabbaabbaa.", ".aaaaaaaaaa.", ".aaaaaaaaaa.",
        "..aaabbaaa..", "..aaaaaaaa..", "...abbbba...", "...aaaaaa...", "....aaaa....",
        "..xxxxxxxx..", ".xxxxxxxxxx.", "xxxxxxxxxxxx", "xxxxxxxxxxxx", "xxxxxxxxxxxx",
        "............",
    },
    {   // B_FACE_THUG
        "............", "............", "...aaaaaa...", "..aaaaaaaa..", ".aaaaaaaaaa.",
        ".abbbaabbba.", ".aaaaaaaaaa.", ".aabaaaabaa.", ".aaaaaaaaaa.", ".aaaabbaaaa.",
        "..aaaaaaaa..", "..abbbbbba..", "...aaaaaa...", "....aaaa....", "...xxxxxx...",
        "..xxxxxxxx..", ".xxxxxxxxxx.", "xxxxxxxxxxxx", "xxxxxxxxxxxx", "xxxxxxxxxxxx",
        "............",
    },
    {   // B_FACE_BRUTE
        ".....bb.....", "....bbbb....", "...abbbba...", "..aaabbaaa..", ".aaaaaaaaaa.",
        ".abbaaaabba.", ".aaaaaaaaaa.", ".aaaaaaaaaa.", ".aaaabbaaaa.", ".abbbbbbbba.",
        ".abbaaaabba.", "..bbbbbbbb..", "...bbbbbb...", "....aaaa....", "...xxxxxx...",
        "..xxxxxxxx..", ".xxxxxxxxxx.", "xxxxxxxxxxxx", "xxxxxxxxxxxx", "xxxxxxxxxxxx",
        "............",
    },
};
// SPRITE-ART-END
// sprite_art[i] is block i for i < B_FIGHTER_COUNT, then B_GO and the faces.

// POSES-BEGIN
const struct Part pose_part[P_COUNT][2] = {
    { { B_T_STAND, -8, -42 }, { B_L_STAND,   -8, -21 } },    // P_STAND
    { { B_T_STAND, -8, -42 }, { B_L_WALK1,   -8, -21 } },    // P_WALK1
    { { B_T_STAND, -8, -42 }, { B_L_WALK2,   -8, -21 } },    // P_WALK2
    { { B_T_WIND,  -8, -42 }, { B_L_STAND,   -8, -21 } },    // P_WIND
    { { B_T_PUNCH, -8, -42 }, { B_L_STAND,   -8, -21 } },    // P_PUNCH
    { { B_T_LEAN,  -8, -42 }, { B_L_CHAMBER, -8, -21 } },    // P_CHAMBER
    { { B_T_LEAN,  -8, -42 }, { B_L_KICK,    -8, -21 } },    // P_KICK
    { { B_T_JUMP,  -8, -42 }, { B_L_TUCK,    -8, -21 } },    // P_JUMP
    { { B_T_LEAN,  -8, -42 }, { B_L_KICK,    -8, -21 } },    // P_JKICK
    { { B_T_HURT,  -8, -42 }, { B_L_STAND,   -8, -21 } },    // P_HURT
    { { B_D_HEAD, -32, -21 }, { B_D_FEET,    -8, -21 } },    // P_DOWN
    { { B_T_STAND, -8, -32 }, { B_L_KNEEL,   -8, -21 } },    // P_KNEEL
};
// POSES-END

// Hurt boxes: the body, columns 0-6 of a part (x -8 to +5), feet to the
// top of the head. Lying down has none: a fighter on the ground cannot be
// hit. Kneeling is 10 pixels lower.
const struct Box hurt_box[P_COUNT] = {
    { -7, 5, 0, 40 }, { -7, 5, 0, 40 }, { -7, 5, 0, 40 }, { -7, 5, 0, 40 },
    { -7, 5, 0, 40 }, { -7, 5, 0, 40 }, { -7, 5, 0, 40 }, { -7, 5, 0, 40 },
    { -7, 5, 0, 40 }, { -7, 5, 0, 40 }, {  0, 0, 0,  0 }, { -7, 5, 0, 30 },
};

// Hit boxes, on attack frames only (anim.c): the fist at columns 10-11 of
// the top part (heights 32-33), the foot at column 11 of the legs
// (heights 17-19), with a margin of 2.
const struct Box hit_box[HB_COUNT] = {
    { 0, 0, 0, 0 },                 // HB_NONE
    { 6, 16, 30, 35 },              // HB_PUNCH
    { 6, 16, 15, 21 },              // HB_KICK
    { 6, 16, 15, 21 },              // HB_JKICK: plus the jumper's height
};

static char mc_glyph(char c)
{
    return c == 'b' ? 1 : c == 'y' ? 2 : c == 'k' ? 3 : 0;
}

static char mc_sprite(char c)
{
    return c == 'a' ? 1 : c == 'x' ? 2 : c == 'b' ? 3 : 0;
}

// One block from its text; mirrored: the twelve pixels in reverse order.
static void sprite_block(char *d, const char (*art)[13], bool mirror)
{
    for (char r = 0; r < 21; r++)
    {
        const char *row = art[r];
        for (char k = 0; k < 3; k++)
        {
            char b = 0;
            for (char p = 0; p < 4; p++)
            {
                char c = k * 4 + p;
                b = (b << 2) | mc_sprite(row[mirror ? 11 - c : c]);
            }
            d[r * 3 + k] = b;
        }
    }
    d[63] = 0;
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
            g[r] = (mc_glyph(row[0]) << 6) | (mc_glyph(row[1]) << 4) | (mc_glyph(row[2]) << 2) | mc_glyph(row[3]);
        }
    }
    for (char i = 0; i < 3; i++)
    {
        char *g = CHARSET + (CH_BAR_FULL + i) * 8;
        for (char r = 0; r < 8; r++)
        {
            char b = 0;
            for (char c = 0; c < 8; c++)
                b = (b << 1) | (bar_art[i][r][c] == 'x');
            g[r] = b;
        }
    }

    // Fighter blocks and their mirrored twins, then the sign and the faces.
    for (char i = 0; i < B_FIGHTER_COUNT; i++)
    {
        sprite_block(SPRMEM + i * 64, sprite_art[i], false);
        sprite_block(SPRMEM + (i + B_MIRROR) * 64, sprite_art[i], true);
    }
    for (char i = 0; i < B_COUNT - B_GO; i++)
        sprite_block(SPRMEM + (B_GO + i) * 64, sprite_art[B_FIGHTER_COUNT + i], false);
}
