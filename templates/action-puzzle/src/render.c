// render.c: character set, cave drawing, text and the glyph animation.
#include "render.h"
#include "cave.h"
#include <c64/vic.h>

// Screen colour per element code. Original palette choices.
static const char tint[CODES] = {
    VCOL_BLACK, VCOL_BROWN, VCOL_RED, VCOL_MED_GREY,            // space dirt brick steel
    VCOL_LT_GREY, VCOL_LT_GREY, VCOL_CYAN, VCOL_CYAN,            // boulder, gem
    VCOL_MED_GREY, VCOL_LT_GREEN, VCOL_YELLOW, VCOL_BLACK,       // exit shut/open, player, unused
    VCOL_ORANGE, VCOL_ORANGE, VCOL_ORANGE, VCOL_ORANGE,          // spark, four headings
    VCOL_PURPLE, VCOL_PURPLE, VCOL_PURPLE, VCOL_PURPLE,          // moth
    VCOL_WHITE, VCOL_WHITE, VCOL_WHITE,                          // blast stages
    VCOL_LT_BLUE, VCOL_LT_BLUE, VCOL_LT_BLUE                     // burst stages
};

// Original 8 x 8 glyphs, one per element code. Every glyph a check may
// sample has ink at pixel (4, 4), the centre check.py reads for a cell.
static const char glyphs[CODES][8] = {
    { 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00 },  // space
    { 0xa2, 0x08, 0x51, 0x04, 0x8a, 0x20, 0x45, 0x10 },  // dirt: speckle
    { 0xfe, 0xfe, 0xfe, 0x00, 0xef, 0xef, 0xef, 0x00 },  // brick
    { 0xff, 0x81, 0xbd, 0xbd, 0xbd, 0xbd, 0x81, 0xff },  // steel plate
    { 0x3c, 0x7e, 0xdf, 0xff, 0xfb, 0xff, 0x7e, 0x3c },  // boulder
    { 0x3c, 0x7e, 0xdf, 0xff, 0xfb, 0xff, 0x7e, 0x3c },  // boulder, falling
    { 0x18, 0x3c, 0x7e, 0xff, 0x7e, 0x3c, 0x18, 0x00 },  // gem (animated)
    { 0x18, 0x3c, 0x7e, 0xff, 0x7e, 0x3c, 0x18, 0x00 },  // gem, falling
    { 0xff, 0x81, 0xbd, 0xbd, 0xbd, 0xbd, 0x81, 0xff },  // exit, shut: looks like steel
    { 0xff, 0x81, 0x81, 0x89, 0x8d, 0x81, 0x81, 0xff },  // exit, open (animated)
    { 0x18, 0x18, 0x3c, 0x5a, 0x18, 0x24, 0x24, 0x66 },  // player
    { 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00 },  // unused
    { 0x08, 0x08, 0x2a, 0x1c, 0x7f, 0x1c, 0x2a, 0x08 },  // spark (animated), x4
    { 0x08, 0x08, 0x2a, 0x1c, 0x7f, 0x1c, 0x2a, 0x08 },
    { 0x08, 0x08, 0x2a, 0x1c, 0x7f, 0x1c, 0x2a, 0x08 },
    { 0x08, 0x08, 0x2a, 0x1c, 0x7f, 0x1c, 0x2a, 0x08 },
    { 0x00, 0x66, 0xff, 0xff, 0x7e, 0x3c, 0x5a, 0x81 },  // moth (animated), x4
    { 0x00, 0x66, 0xff, 0xff, 0x7e, 0x3c, 0x5a, 0x81 },
    { 0x00, 0x66, 0xff, 0xff, 0x7e, 0x3c, 0x5a, 0x81 },
    { 0x00, 0x66, 0xff, 0xff, 0x7e, 0x3c, 0x5a, 0x81 },
    { 0x91, 0x52, 0x3c, 0xff, 0x3c, 0x52, 0x91, 0x10 },  // blast 1..3
    { 0x00, 0x52, 0x24, 0x18, 0x18, 0x24, 0x52, 0x00 },
    { 0x00, 0x00, 0x24, 0x18, 0x18, 0x24, 0x00, 0x00 },
    { 0x91, 0x52, 0x3c, 0xff, 0x3c, 0x52, 0x91, 0x10 },  // burst 1..3
    { 0x00, 0x52, 0x24, 0x18, 0x18, 0x24, 0x52, 0x00 },
    { 0x00, 0x00, 0x24, 0x18, 0x18, 0x24, 0x00, 0x00 }
};

// Animation frames: four for the gem's sparkle, two each for the enemies
// and the open exit. Pixel (4, 4) stays inked in every frame.
static const char gem_anim[4][8] = {
    { 0x18, 0x3c, 0x7e, 0xff, 0x7e, 0x3c, 0x18, 0x00 },
    { 0x18, 0x24, 0x5a, 0xbd, 0x5a, 0x24, 0x18, 0x00 },
    { 0x18, 0x3c, 0x7e, 0xdb, 0x7e, 0x3c, 0x18, 0x00 },
    { 0x18, 0x3c, 0x76, 0xff, 0x6e, 0x3c, 0x18, 0x00 }
};
static const char spark_anim[2][8] = {
    { 0x08, 0x08, 0x2a, 0x1c, 0x7f, 0x1c, 0x2a, 0x08 },
    { 0x00, 0x41, 0x22, 0x14, 0x08, 0x14, 0x22, 0x41 }
};
static const char moth_anim[2][8] = {
    { 0x00, 0x66, 0xff, 0xff, 0x7e, 0x3c, 0x5a, 0x81 },
    { 0x00, 0x00, 0x24, 0x7e, 0xff, 0x3c, 0x24, 0x00 }
};
static const char exit_anim[2][8] = {
    { 0xff, 0x81, 0x81, 0x89, 0x8d, 0x81, 0x81, 0xff },
    { 0x00, 0x7e, 0x7e, 0x76, 0x7a, 0x7e, 0x7e, 0x00 }
};

void render_init(void)
{
    // Copy the ROM glyphs of screen codes 0-63 (letters, digits,
    // punctuation) so text, the HUD and the harness meter read as usual.
    // The character ROM is visible to the CPU at $D000 with $01 = $33; the
    // KERNAL IRQ is off, so nothing can run while I/O is banked out.
    char *rom = (char *)0xd000;
    char port = *(volatile char *)0x01;
    *(volatile char *)0x01 = 0x33;
    for (unsigned i = 0; i < 512; i++)
        CHARSET[i] = rom[i];
    *(volatile char *)0x01 = port;
    for (char c = 0; c < CODES; c++)
        for (char k = 0; k < 8; k++)
            CHARSET[(GLYPH_BASE + c) * 8 + k] = glyphs[c][k];
    vic.memptr = 0x18;                          // screen $0400, characters $2000
    vic.color_border = VCOL_BLACK;
    vic.color_back = VCOL_BLACK;
}

void render_clear(void)
{
    for (unsigned i = 0; i < 1000; i++)
    {
        SCREEN[i] = 0x20;
        COLOUR[i] = VCOL_WHITE;
    }
}

void draw_cell(unsigned i)
{
    char t = cave[i] & 0x1f;
    SCREEN[CW * CAVE_ROW0 + i] = GLYPH_BASE + t;
    COLOUR[CW * CAVE_ROW0 + i] = tint[t];
}

// Rows waiting for a redraw after a dirty-list overflow.
static bool pending[CH];
char render_npending;

// One cave row, with three row pointers and an 8-bit index.
void draw_row(char y)
{
    const char *src = cave + CW * y;
    char *scr = SCREEN + CW * (CAVE_ROW0 + y);
    char *col = COLOUR + CW * (CAVE_ROW0 + y);
    for (char x = 0; x < CW; x++)
    {
        char t = src[x] & 0x1f;
        scr[x] = GLYPH_BASE + t;
        col[x] = tint[t];
    }
}

void draw_cave(void)
{
    for (char y = 0; y < CH; y++)
        draw_row(y);
    render_npending = 0;
    for (char y = 0; y < CH; y++)
        pending[y] = false;
}

// A slice's changes: the dirty list. On overflow the list is incomplete, so
// every row the slice's moves and explosions can reach (one above to one
// below) is queued instead, and draw_pending redraws them two a frame. That
// bounds the frame: redrawing all seven rows at once in the first version
// cost 55,305 cycles, almost three PAL frames (measured in review).
void draw_dirty(char y0, char y1)
{
    if (cave_overflow)
    {
        if (y1 > CH - 1)
            y1 = CH - 1;
        for (char y = y0 - 1; y <= y1; y++)
            if (!pending[y])
            {
                pending[y] = true;
                render_npending++;
            }
    }
    else
        for (char n = 0; n < cave_ndirty; n++)
            draw_cell(cave_dirty[n]);
}

void draw_pending(void)
{
    char budget = ROWS_PER_FRAME;
    for (char y = 0; y < CH && budget && render_npending; y++)
        if (pending[y])
        {
            draw_row(y);
            pending[y] = false;
            render_npending--;
            budget--;
        }
}

static void set_glyph(char code, const char *src)
{
    char *dst = CHARSET + (GLYPH_BASE + code) * 8;
    for (char k = 0; k < 8; k++)
        dst[k] = src[k];
}

void render_animate(char frame)
{
    if (frame & 3)
        return;
    char phase = (frame >> 2) & 3;
    set_glyph(GEM, gem_anim[phase]);
    set_glyph(GEM_F, gem_anim[phase]);
    for (char h = 0; h < 4; h++)
    {
        set_glyph(SPARK + h, spark_anim[phase & 1]);
        set_glyph(MOTH + h, moth_anim[phase & 1]);
    }
    set_glyph(EXIT_OPEN, exit_anim[phase >> 1]);
}

// Text in upper case, digits and punctuation, written as screen codes.
void put_text(char row, char col, const char *s, char colour)
{
    char *p = SCREEN + 40 * row + col;
    char *q = COLOUR + 40 * row + col;
    while (*s)
    {
        char c = *s++;
        if (c >= 'A' && c <= 'Z')
            c = c - 'A' + 1;
        *p++ = c;
        *q++ = colour;
    }
}

void put_codes(char row, char col, const char *codes, char n, char colour)
{
    char *p = SCREEN + 40 * row + col;
    char *q = COLOUR + 40 * row + col;
    for (char i = 0; i < n; i++)
    {
        p[i] = codes[i];
        q[i] = colour;
    }
}

// v as `digits` decimal digits (1 to 6), leading zeros shown.
void put_num(char row, char col, unsigned long v, char digits, char colour)
{
    static const unsigned long pw[6] = { 100000, 10000, 1000, 100, 10, 1 };
    char *p = SCREEN + 40 * row + col;
    char *q = COLOUR + 40 * row + col;
    for (char i = 6 - digits; i < 6; i++)
    {
        char d = 0x30;
        while (v >= pw[i]) { v -= pw[i]; d++; }
        *p++ = d;
        *q++ = colour;
    }
}

void fill_box(char row0, char col0, char row1, char col1, char colour)
{
    for (char r = row0; r <= row1; r++)
        for (char c = col0; c <= col1; c++)
        {
            SCREEN[40 * r + c] = 0x20;
            COLOUR[40 * r + c] = colour;
        }
}
