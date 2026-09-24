// street.c: the street as text, its 2 x 2 metatiles, the cell lookups the
// scroll asks, and the three stage locks (c64-kb tile_map_render).
#include "game.h"

// One character per metatile, ten rows of 64: rooftops, four rows of
// facades (brick, lit windows, doors, signs; the gaps are dark alleys
// with lamps), then pavement, the kerb and the road. The fighters stand
// on tile rows 6-9 (ground lines 150-204). Edit freely: a tile key must
// be in tile_key below.
static const char level_text[LEVEL_TH][LEVEL_TW + 1] = {
    "rrrrrr.rrrrrrrr.rrrrr.rrrrrrr.rrrrrr.rrrrrrrr.rrrrr.rrrrrrr.rrrr",
    "BWWWWBaBWBWBWBWaBBBBBaBWWWWWBaBWBWBWaBBBBBBBBaBWWWBaBWBWBWBaBBBB",
    "BBBBBBLBWBWBWBWLBWBBWLBBBBBBBLBWBWBWLBWBBWBBWLBBBBBLBWBWBWBLBWBB",
    "BWWWWBlBSSSSSSBlBBBBBlBWWWWWBlBSSSSBlBBBBBBBBlBWWWBlBSSSSSBlBBBB",
    "BWWDWBlWDWWWWDWlBDBWBlBWWDWWBlWDWWDWlBDBWBWBWlBWDWBlWDWWWDWlBDBW",
    "PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP",
    "PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP",
    "KKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKK",
    "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
    "================================================================",
};

// Metatiles: key, then the glyphs top-left, top-right, bottom-left,
// bottom-right. A tile sits on character rows 2ty and 2ty + 1.
static const char tile_key[] = ".rBWDSLlPKR=a";
static const char tile_glyph[][4] = {
    { CH_SKY,   CH_SKY,   CH_SKY,   CH_SKY   },   // .  sky (tile row 0 only: 'k' is blue there)
    { CH_SKY,   CH_SKY,   CH_ROOF,  CH_ROOF  },   // r  a roof edge
    { CH_BRICK, CH_BRICK, CH_BRICK, CH_BRICK },   // B  brick
    { CH_WIN_T, CH_WIN_T, CH_WIN_B, CH_WIN_B },   // W  a lit window
    { CH_DOOR,  CH_DOOR,  CH_DOOR,  CH_DOOR  },   // D  a door
    { CH_SIGN,  CH_SIGN,  CH_BRICK, CH_BRICK },   // S  a shop sign over brick
    { CH_LAMP,  CH_ALLEY, CH_POLE,  CH_ALLEY },   // L  an alley lamp
    { CH_POLE,  CH_ALLEY, CH_POLE,  CH_ALLEY },   // l  its post
    { CH_PAVE,  CH_PAVE,  CH_PAVE,  CH_PAVE  },   // P  pavement
    { CH_PAVE,  CH_PAVE,  CH_KERB,  CH_KERB  },   // K  pavement over the kerb
    { CH_ROAD,  CH_ROAD,  CH_ROAD,  CH_ROAD  },   // R  road
    { CH_ROAD,  CH_ROAD,  CH_DASH,  CH_ROAD  },   // =  road with the centre line
    { CH_ALLEY, CH_ALLEY, CH_ALLEY, CH_ALLEY },   // a  a dark alley between buildings
};

// The camera stops at each lock until that stage's waves are beaten. The
// last is the end of the street (CAM_MAX).
const unsigned stage_lock[NSTAGE] = { 0, 352, CAM_MAX };

static char level[LEVEL_TH][LEVEL_TW];         // tile index per cell

void street_init(void)
{
    for (char ty = 0; ty < LEVEL_TH; ty++)
    {
        for (char tx = 0; tx < LEVEL_TW; tx++)
        {
            char t = 0;
            for (char i = 0; i < sizeof(tile_key) - 1; i++)
                if (tile_key[i] == level_text[ty][tx])
                    t = i;
            level[ty][tx] = t;
        }
    }
}

char cell_char(unsigned col, char row)
{
    char t = level[row >> 1][col >> 1];
    return tile_glyph[t][((row & 1) << 1) | (col & 1)];
}

// The street's glyphs under a block 5 cells wide and 6 high whose top left
// is world cell (wcol, row), row by row: what the brute covers (brute.c).
void street_block(char *dst, char wcol, char row)
{
    for (char r = row; r < row + 6; r++)
    {
        const char *lv = level[r >> 1];
        char b = (r & 1) << 1;
        for (char c = wcol; c < wcol + 5; c++)
            *dst++ = tile_glyph[lv[c >> 1]][b | (c & 1)];
    }
}

// One page column: the 20 street glyphs of world column col, 40 apart.
void level_column(char *dst, unsigned col)
{
    char tx = col >> 1, half = col & 1;
    for (char ty = 0; ty < LEVEL_TH; ty++)
    {
        const char *g = tile_glyph[level[ty][tx]];
        dst[0] = g[half];
        dst[40] = g[2 + half];
        dst += 80;
    }
}
