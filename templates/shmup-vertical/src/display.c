// display.c: the character set, sprite shapes, text and the score panel.
// All art is original. Glyphs and sprites are written as strings of
// multicolour pixel pairs, one digit per pair: 0 background, 1 $D022 or
// $D025, 2 $D023 or the sprite's own colour, 3 colour RAM or $D026.
#include "display.h"
#include <c64/memmap.h>
#include <string.h>

// ---- playfield glyphs: 8 rows of 4 pairs each ------------------------------
static const char * const glyph_art[7] = {
    "11111121111111112111111111121111",    // G_LAND: earth, green specks
    "22222212222222222122222222212222",    // G_GRASS
    "23323322223223222322222122112112",    // G_TREE: canopy, trunk
    "11111331331331311311111111111111",    // G_ROCK
    "11301130111311131130113013001130",    // G_EDGE_L: land left, sand, water
    "03110311311131110311031100310311",    // G_EDGE_R: water, sand, land right
    "00000000000000000000000300300000",    // G_SPARKLE: light on the water
};

static const char life_glyph[8] = { 0x18, 0x3c, 0x3c, 0x7e, 0xff, 0xdb, 0x18, 0x00 };
static const char rule_glyph[8] = { 0x00, 0x00, 0x00, 0xff, 0xff, 0x00, 0x00, 0x00 };

// ---- sprites: 21 rows of 12 pairs -----------------------------------------
static const char * const sprite_art[SPR_FRAMES][21] = {
    {   // F_SHIP
        "............", ".....33.....", ".....33.....", "....3223....",
        "....2332....", "....2222....", "...122221...", "...122221...",
        "..11222211..", ".1122332211.", "112223322211", "112222222211",
        "11.222222.11", "1..122221..1", "...12..21...", "...3....3...",
        "............", "............", "............", "............",
        "............" },
    {   // F_DART
        "............", "..2......2..", "..22....22..", "..222..222..",
        "...222222...", "...233332...", "....2332....", "....2112....",
        ".....22.....", ".....22.....", ".....11.....", "............",
        "............", "............", "............", "............",
        "............", "............", "............", "............",
        "............" },
    {   // F_SAUCER
        "............", "....3333....", "...322223...", "..22222222..",
        ".2212121212.", "222222222222", ".1111111111.", "..1.1..1.1..",
        "............", "............", "............", "............",
        "............", "............", "............", "............",
        "............", "............", "............", "............",
        "............" },
    {   // F_BUG
        "............", "...1....1...", "....1..1....", "...222222...",
        "..22322322..", "..22222222..", ".1222112221.", "1.22211222.1",
        "..22222222..", ".1.222222.1.", "1...2222...1", ".....22.....",
        "............", "............", "............", "............",
        "............", "............", "............", "............",
        "............" },
    {   // F_BOOM1
        "............", "............", ".....3......", "...3.2.3....",
        "....222.....", "..32232223..", "....222.....", "...3.2.3....",
        ".....3......", "............", "............", "............",
        "............", "............", "............", "............",
        "............", "............", "............", "............",
        "............" },
    {   // F_BOOM2
        "............", "..3...3...3.", "...2..2..2..", "....1.1.1...",
        ".3..22222..3", "..2.2.3.2.2.", "321.23332.12", "..2.2.3.2.2.",
        ".3..22222..3", "....1.1.1...", "...2..2..2..", "..3...3...3.",
        "............", "............", "............", "............",
        "............", "............", "............", "............",
        "............" },
};

// Four pair digits to one byte.
static char pairs(const char *s)
{
    char b = 0;
    for (char i = 0; i < 4; i++) {
        char d = s[i];
        b = (b << 2) | (d == '.' ? 0 : d - '0');
    }
    return b;
}

static void make_charset(void)
{
    __asm { sei }
    mmap_set(MMAP_CHAR_ROM);
    memcpy(CHARSET, (char *)0xd000, 64 * 8);        // letters, digits, punctuation
    mmap_set(MMAP_NO_ROM);                          // I/O back; the kernel keeps $01 = $35
    memset(CHARSET + 64 * 8, 0, 2048 - 64 * 8);
    for (char g = 0; g < 7; g++) {
        char *d = CHARSET + (G_LAND + g) * 8;
        for (char r = 0; r < 8; r++)
            d[r] = pairs(glyph_art[g] + 4 * r);
    }
    memcpy(CHARSET + G_LIFE * 8, life_glyph, 8);
    memcpy(CHARSET + G_RULE * 8, rule_glyph, 8);
    // Shots over open water need no merge (glyph.asm): a dot in each pixel
    // pair on each even row pair, a bolt in each pair on rows 2-5, in %11.
    for (char p = 0; p < 4; p++) {
        char m = 0xc0 >> (2 * p);
        for (char r = 0; r < 4; r++) {
            char *d = CHARSET + (G_DOTS + 4 * p + r) * 8;
            d[2 * r] = d[2 * r + 1] = m;
        }
        char *b = CHARSET + (G_BOLTS + p) * 8;
        b[2] = b[3] = b[4] = b[5] = m;
    }
}

static void make_sprites(void)
{
    for (char f = 0; f < SPR_FRAMES; f++) {
        char *d = SPRITES + 64 * f;
        for (char r = 0; r < 21; r++) {
            const char *s = sprite_art[f][r];
            d[0] = pairs(s);
            d[1] = pairs(s + 4);
            d[2] = pairs(s + 8);
            d += 3;
        }
    }
}

void display_init(void)
{
    make_charset();
    make_sprites();
    cia2.pra = (cia2.pra & 0xfc) | 0x01;            // VIC bank 2: $8000-$BFFF
    vic.color_border = VCOL_BLACK;
    vic.color_back = PF_BG_COL;
    vic.color_back1 = PF_MC1;
    vic.color_back2 = PF_MC2;
    vic.spr_multi = 0xff;
    vic.spr_expand_x = 0;
    vic.spr_expand_y = 0;
    vic.spr_priority = 0;
    vic.spr_mcolor0 = VCOL_DARK_GREY;
    vic.spr_mcolor1 = VCOL_WHITE;
    memset(PF0, G_WATER, 1000);
    memset(PF1, G_WATER, 1000);
    memset(COLOUR, PF_CRAM, 21 * 40);               // playfield rows 0-20
    memset(COLOUR + 21 * 40, VCOL_WHITE, 4 * 40);   // panel rows 21-24
    panel_draw();
}

// ASCII upper case, digits and punctuation to screen codes.
void put_text(char *screen, char row, char col, const char *s)
{
    char *p = screen + 40 * row + col;
    while (*s) {
        char c = *s++;
        *p++ = (c >= 'A' && c <= 'Z') ? c - 64 : c;
    }
}

void text_colour(char row, char col, char n, char colour)
{
    memset(COLOUR + 40 * row + col, colour, n);
}

static const unsigned pow10[5] = { 1, 10, 100, 1000, 10000 };

// Digits by repeated subtraction: no 16-bit division, a few hundred cycles.
void put_dec(char *p, unsigned v, char digits)
{
    for (char i = digits; i > 0; i--) {
        unsigned q = pow10[i - 1];
        char d = '0';
        while (v >= q) {
            v -= q;
            d++;
        }
        *p++ = d;
    }
}

// ---- the panel: rows 20-24 of the screen at $8800 ------------------------------
// Row 20 is a rule, drawn in colour RAM row 20's colour, which the playfield
// shares (pitfall-free only because the playfield's value, $0F, reads as
// light grey in hires). Rows 21-23 hold text; row 24 is cut by the border.
#define SCORE_AT (PANEL + 21 * 40 + 8)          // five digits; the sixth is always 0
#define HI_AT    (PANEL + 21 * 40 + 26)
static char shown_lives = 0xff;
// The score's digits change once a frame, in panel_update, however many
// kills the frame had: the frames with most kills are the heaviest.
static char score_due;

void panel_draw(void)
{
    memset(PANEL, G_WATER, 1000);
    memset(PANEL + 20 * 40, G_RULE, 40);
    put_text(PANEL, 21, 2, "SCORE 000000         HI 000000");
    put_text(PANEL, 23, 2, "LIVES");
    put_dec(SCORE_AT, score, 5);
    put_dec(HI_AT, hiscore, 5);
    score_due = 0;
    shown_lives = 0xff;
    panel_update();
}

// Adds to the score's digits on the panel one digit at a time, so a kill
// costs a few dozen cycles, not a 16-bit conversion. Call after score and
// hiscore have been updated.
static void add_digits(char tens)
{
    char *p = SCORE_AT + 4;
    char c = tens;
    for (;;) {
        char d = *p - '0' + c;
        c = 0;
        while (d >= 10) {
            d -= 10;
            c++;
        }
        *p = '0' + d;
        if (!c || p == SCORE_AT)
            break;
        p--;
    }
    if (score == hiscore)
        memcpy(HI_AT, SCORE_AT, 5);
}

void panel_add(char tens)
{
    score_due += tens;
}

void panel_update(void)
{
    if (score_due) {
        add_digits(score_due);
        score_due = 0;
    }
    if (lives != shown_lives) {
        for (char i = 0; i < 5; i++) {
            PANEL[23 * 40 + 8 + i] = i < lives ? G_LIFE : G_WATER;
            COLOUR[23 * 40 + 8 + i] = VCOL_CYAN;
        }
        shown_lives = lives;
    }
}
