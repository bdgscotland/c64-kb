// level.c: the level as text, its 2 x 2 metatiles, and the cell lookups
// every other module asks. After c64-kb tile_map_render (metatiles) and
// slope_collision (one attribute byte per glyph, a height table per slope).
#include "game.h"

// One character per metatile, ten rows of 128. The keys are in tile_key
// below; P, w and h are an empty tile plus the player's start, a walker or
// a hopper standing on the tile below. Edit freely: the program decodes
// this at every start, and tools/tearcheck.py renders the same text.
// LEVEL-BEGIN
static const char level_text[LEVEL_TH][LEVEL_TW + 1] = {
    "................................................................................................................................",
    "................................................................................................................................",
    "..w.............................................................................................................................",
    ".BBB............................................................................................................................",
    "................................................................................................................................",
    "..............................oo.......................o..............oo......................oo................................",
    "........o....................---..............B......./=\\........--..........................----...............................",
    ".P..oo./=\\......w......ab=cd........h........BB...w../###=\\..w..........h...abcd....w.B...........h..../=\\..w.......oo.w....F...",
    "=======###========..===#####=============..==========######=====....========####========...============###=====..===============",
    "##################..#####################..#####################....####################...####################..###############",
};
// LEVEL-END

#if STAGE_CROWD
// make stage: row 7 with ten enemies in the first view, so every live slot
// is full from the first frame. It measures the worst frame; it is not a
// level to play (the comparator's staging, 2026-09-23).
static const char stage_row7[LEVEL_TW + 1] =
    ".Phwhwh/=\\hwhwhww......ab=cd........h........BB...w../###=\\..w..........h...abcd....w.B...........h..../=\\..w.......oo.w....F...";
#endif

// Metatiles: key, then the glyphs top-left, top-right, bottom-left,
// bottom-right. A tile sits on character rows 2ty and 2ty + 1.
// TILES-BEGIN
static const char tile_key[] = ".#=B-/\\abcdoF";
static const char tile_glyph[][4] = {
    { CH_SKY,     CH_SKY,     CH_SKY,     CH_SKY     },   // .  air
    { CH_DIRT,    CH_DIRT,    CH_DIRT,    CH_DIRT    },   // #  earth
    { CH_GRASS,   CH_GRASS,   CH_DIRT,    CH_DIRT    },   // =  ground with grass
    { CH_BRICK,   CH_BRICK,   CH_BRICK,   CH_BRICK   },   // B  block: a wall you can stand on
    { CH_LEDGE,   CH_LEDGE,   CH_SKY,     CH_SKY     },   // -  one-way ledge
    { CH_SKY,     CH_SLOPE1,  CH_SLOPE1,  CH_DIRT    },   // /  45 degrees up, one tile high
    { CH_SLOPE2,  CH_SKY,     CH_DIRT,    CH_SLOPE2  },   // \  45 degrees down
    { CH_SKY,     CH_SKY,     CH_SLOPE3,  CH_SLOPE4  },   // a  1-in-2 up, lower tile
    { CH_SLOPE3,  CH_SLOPE4,  CH_DIRT,    CH_DIRT    },   // b  1-in-2 up, upper tile
    { CH_SLOPE5,  CH_SLOPE6,  CH_DIRT,    CH_DIRT    },   // c  1-in-2 down, upper tile
    { CH_SKY,     CH_SKY,     CH_SLOPE5,  CH_SLOPE6  },   // d  1-in-2 down, lower tile
    { CH_COIN_TL, CH_COIN_TR, CH_COIN_BL, CH_COIN_BR },   // o  coin
    { CH_FLAG,    CH_SKY,     CH_POLE,    CH_SKY     },   // F  goal
};
// TILES-END
#define T_AIR  0
#define T_COIN 11

// Attribute per glyph from CH_FIRST (the sky, a ROM space, is 0).
static const char glyph_attr[CH_COUNT] = {
    A_GROUND | A_WALL,                  // dirt
    A_GROUND | A_WALL,                  // grass
    A_GROUND | A_WALL,                  // brick
    A_GROUND | A_DROP,                  // ledge
    A_GROUND | 0x10, A_GROUND | 0x20, A_GROUND | 0x30,   // slopes 1-6
    A_GROUND | 0x40, A_GROUND | 0x50, A_GROUND | 0x60,
    A_COIN, A_COIN, A_COIN, A_COIN,
    A_GOAL, A_GOAL,
};

// The same per tile quarter, built once, so a lookup is two indexings:
// the physics asks a dozen times a frame per body.
static char tile_attr[sizeof(tile_key) - 1][4];
static char *const level_row[LEVEL_TH] = {
    level[0], level[1], level[2], level[3], level[4],
    level[5], level[6], level[7], level[8], level[9]
};

// Ground row inside a cell for pixel column 0-7, per slope type; 0 is the
// cell's top row. From the slope-collision recipe. Types 3 and 4 are the
// lower and upper halves of one 1-in-2 rise, 5 and 6 of a fall. The slope
// glyphs are drawn from this table (art.c), so picture and collision agree.
const char heights[64] = {
    0, 0, 0, 0, 0, 0, 0, 0,             // 0 flat
    7, 6, 5, 4, 3, 2, 1, 0,             // 1 up 45
    0, 1, 2, 3, 4, 5, 6, 7,             // 2 down 45
    7, 7, 6, 6, 5, 5, 4, 4,             // 3 up 1-in-2, first half
    3, 3, 2, 2, 1, 1, 0, 0,             // 4 up 1-in-2, second half
    0, 0, 1, 1, 2, 2, 3, 3,             // 5 down 1-in-2, first half
    4, 4, 5, 5, 6, 6, 7, 7,             // 6 down 1-in-2, second half
    0, 0, 0, 0, 0, 0, 0, 0              // 7 unused
};

char level[LEVEL_TH][LEVEL_TW];
unsigned start_x;
char start_y;

// Text to tiles, and the actor letters into the actor table (actors.c).
void level_reset(void)
{
    for (char t = 0; t < sizeof(tile_key) - 1; t++)
    {
        for (char q = 0; q < 4; q++)
        {
            char g = tile_glyph[t][q];
            tile_attr[t][q] = g >= CH_FIRST ? glyph_attr[g - CH_FIRST] : 0;
        }
    }
    lvl_count = 0;
    for (char ty = 0; ty < LEVEL_TH; ty++)
    {
        for (char tx = 0; tx < LEVEL_TW; tx++)
        {
            char k = level_text[ty][tx], t = T_AIR;
#if STAGE_CROWD
            if (ty == 7)
                k = stage_row7[tx];
#endif
            for (char i = 0; i < sizeof(tile_key) - 1; i++)
                if (tile_key[i] == k)
                    t = i;
            level[ty][tx] = t;
            if (k == 'P')
            {
                start_x = tx * 16 + 8;          // foot column: the tile's middle
                start_y = (ty + 1) * 16;        // on the tile below
            }
            else if ((k == 'w' || k == 'h') && lvl_count < NLVL)
            {
                char i = lvl_count++;
                lvl_col[i] = tx * 2;
                lvl_ty[i] = ty;
                lvl_type[i] = k == 'w' ? T_WALKER : T_HOPPER;
                lvl_flags[i] = LF_LEFT;
            }
        }
    }
}

char cell_char(unsigned col, char row)
{
    if (col >= LEVEL_CW || row >= PF_ROWS)
        return CH_SKY;
    char t = level_row[row >> 1][(char)col >> 1];
    return tile_glyph[t][((row & 1) << 1) | (col & 1)];
}

char cell_attr(unsigned col, char row)
{
    if (col >= LEVEL_CW || row >= PF_ROWS)
        return 0;
    char t = level_row[row >> 1][(char)col >> 1];
    return tile_attr[t][((row & 1) << 1) | (col & 1)];
}

// The ground row at world column x inside the cell on `row` whose attribute is a.
// __noinline: inlined into surface_walk, Oscar64 v1.32.273 and upstream
// 9a902f6 emit `ORA heights,x` with X as cell_attr left it and never compute
// the index (issue #30); the local build is right either way.
__noinline char surface_at(unsigned x, char row, char a)
{
    return (row << 3) + heights[((a & A_SLOPE) >> 1) | (x & 7)];
}

// Twenty glyphs down one column of a page (stride 40): a new column after a
// coarse shift, or one of forty at a cut.
void level_column(char *dst, unsigned col)
{
    char tx = col >> 1, half = col & 1;
    for (char ty = 0; ty < LEVEL_TH; ty++)
    {
        const char *g = tile_glyph[level_row[ty][tx]];
        dst[0] = g[half];
        dst[40] = g[2 + half];
        dst += 80;
    }
}

// A coin tile covers four cells; taking any of them removes the tile.
bool take_coin(unsigned col, char row)
{
    char *t = &level[row >> 1][col >> 1];
    if (*t != T_COIN)
        return false;
    *t = T_AIR;
    return true;
}
