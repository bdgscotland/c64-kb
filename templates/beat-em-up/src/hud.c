// hud.c: the HUD page (rows 21-24 on screen), the health bars and the
// score. The score is six decimal digits added digit by digit, so printing
// it is six stores and no division (c64-kb decimal_print). Text is screen
// codes, not PETSCII (petscii_written_to_screen_ram).
//
//   row 21   [face] PLAYER               [face] THUG
//   row 22   [face] ############         [face] ####
//   row 23   [face] SCORE 000000         [face] STAGE 1  LIVES 3
//   row 24   HI 000000            (AUTOPILOT builds: the meter, columns 20-39)
#include "game.h"

char score[6], hiscore[6];
char lives;
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

// What the HUD shows now, so hud_draw rewrites only what changed: a hit
// moves one bar, not the whole HUD (a full redraw was 4,157 cycles at
// worst, metered with PROF=4). 0xff: not drawn yet.
static char shown_hp0, shown_hpe, shown_enemy, shown_stage, shown_lives;
static bool shown_score;

void hud_clear(void)
{
    for (unsigned i = HUD_ROW * 40; i < 1000; i++)
        HUDPAGE[i] = CH_SPACE;
    shown_hp0 = shown_hpe = shown_enemy = shown_stage = shown_lives = 0xff;
    shown_score = false;
}

static void put_digits(char row, char col, const char *d, char n)
{
    char *p = HUDPAGE + row * 40 + col;
    for (char i = 0; i < n; i++)
        p[i] = '0' + d[i];
}

// A bar of `cells` cells for `hp` points: full, half, then empty cells.
static void put_bar(char col, char hp, char cells)
{
    char *p = HUDPAGE + 22 * 40 + col;
    for (char i = 0; i < 12; i++)
    {
        char left = hp > i * 2 ? hp - i * 2 : 0;
        p[i] = i >= cells ? CH_SPACE : left >= 2 ? CH_BAR_FULL : left ? CH_BAR_HALF : CH_BAR_EMPTY;
    }
}

// Only when something changed: most frames it costs one test, and then
// only the figures that differ from what is on the page.
void hud_draw(void)
{
    if (!hud_dirty)
        return;
    hud_dirty = false;
    if (shown_lives == 0xff)
    {
        put_text(21, 3, "player");
        put_text(23, 3, "score");
        put_text(23, 23, "stage");
        put_text(23, 32, "lives");
        hud_hiscore();
    }
    if (fhp[0] != shown_hp0)
    {
        shown_hp0 = fhp[0];
        put_bar(3, fhp[0], HP_HERO / 2);
    }
    if (!shown_score)
    {
        shown_score = true;
        put_digits(23, 9, score, 6);
    }
    if (stage != shown_stage)
    {
        shown_stage = stage;
        HUDPAGE[23 * 40 + 29] = '1' + stage;
    }
    if (lives != shown_lives)
    {
        shown_lives = lives;
        HUDPAGE[23 * 40 + 38] = '0' + lives;
    }
    char f = face_enemy;
    if (f >= NFIGHT || fmode[f] == M_OFF)
        f = 0xfe;                                   // no enemy shown
    char hp = f < NFIGHT ? fhp[f] : 0;
    if (f != shown_enemy)
    {
        shown_enemy = f;
        shown_hpe = 0xff;
        put_text(21, 23, f >= NFIGHT ? "     " : fkind[f] == K_THUG ? "thug " : "brute");
    }
    if (hp != shown_hpe)
    {
        shown_hpe = hp;
        put_bar(23, hp, f >= NFIGHT ? 0 : (fkind[f] == K_THUG ? HP_THUG : HP_BRUTE) / 2);
    }
}

void hud_hiscore(void)
{
    put_text(24, 0, "hi");
    put_digits(24, 3, hiscore, 6);
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
    shown_score = false;
    hud_dirty = true;
}
