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
// The labels once per level (hud_labels); the figures only when one
// changed, at fixed cells, with no division: a dirty frame costs a few
// hundred cycles (an earlier version redrew the labels and divided, and
// its dirty frame was the HUD's 2,000-cycle worst).
#define HUD22 (HUDPAGE + 22 * 40)

void hud_labels(void)
{
    put_text(22, 0, "score");
    put_text(22, 14, "coins");
    put_text(22, 24, "lives");
    hud_hiscore();
    hud_dirty = true;
}

void hud_draw(void)
{
    if (!hud_dirty)
        return;
    hud_dirty = false;
    put_digits(22, 6, score, 6);    // a loop storing to HUD22[6 + i] kept only the first digit on Oscar64 v1.32.273
    char c = coins, t = '0';
    while (c >= 10)
    {
        c -= 10;
        t++;
    }
    HUD22[20] = t;
    HUD22[21] = '0' + c;
    HUD22[30] = '0' + lives;
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
