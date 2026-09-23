// hud.c: the HUD page (rows 21-24 on screen) and the score. The score is
// six decimal digits added digit by digit, so printing it is six stores
// and no division (c64-kb decimal_print). Text is screen codes, not
// PETSCII (petscii_written_to_screen_ram).
#include "game.h"

char score[6], hiscore[6];
char lives, coins;
bool hud_dirty;                     // set by whatever changes a figure the HUD shows

// Lower-case letters in the source become the ROM's upper-case glyphs.
void put_text(char row, char col, const char *s)
{
    char *p = HUDPAGE + row * 40 + col;
    while (*s)
    {
        char c = *s++;
        *p++ = (c >= 'a' && c <= 'z') ? c - 'a' + 1 : c;
    }
}

void hud_clear(void)
{
    for (unsigned i = HUD_ROW * 40; i < 1000; i++)
        HUDPAGE[i] = CH_SKY;
}

static void put_digits(char row, char col, const char *d, char n)
{
    char *p = HUDPAGE + row * 40 + col;
    for (char i = 0; i < n; i++)
        p[i] = '0' + d[i];
}

// Row 22: "SCORE 000000  COINS 00  LIVES 3". Row 23: "HI 000000".
// Only when something changed: most frames it costs one test.
void hud_draw(void)
{
    if (!hud_dirty)
        return;
    hud_dirty = false;
    put_text(22, 0, "score");
    put_digits(22, 6, score, 6);
    put_text(22, 14, "coins");
    char *p = HUDPAGE + 22 * 40 + 20;
    p[0] = '0' + coins / 10;
    p[1] = '0' + coins % 10;
    put_text(22, 24, "lives");
    HUDPAGE[22 * 40 + 30] = '0' + lives;
    hud_hiscore();
}

void hud_hiscore(void)
{
    put_text(23, 0, "hi");
    put_digits(23, 3, hiscore, 6);
}

// score += hundreds * 100 + tens * 10, carried up the digits.
void score_add(char hundreds, char tens)
{
    char carry = 0;
    for (signed char i = 5; i >= 0; i--)
    {
        char d = score[i] + carry + (i == 4 ? tens : i == 3 ? hundreds : 0);
        carry = 0;
        while (d >= 10)
        {
            d -= 10;
            carry++;
        }
        score[i] = d;
    }
    hud_dirty = true;
}
