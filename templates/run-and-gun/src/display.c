// display.c: see display.h.
#include "display.h"
#include <string.h>

void display_init(void)
{
    // The ROM's first 64 glyphs (@, A-Z, punctuation, digits) into the RAM set,
    // so text reads as the ROM's letters (tools/mkassets.py leaves 0-63 zero).
    // The character ROM shows at $D000 with $01 = $33; interrupts are off
    // (pitfall irq_during_charen_window).
    __asm { sei }
    *(volatile char *)0x01 = 0x33;
    memcpy(CHARSET, (char *)0xd000, 64 * 8);
    *(volatile char *)0x01 = 0x35;              // KERNAL and BASIC out, I/O in
    cia2.ddra |= 0x03;
    cia2.pra = (cia2.pra & 0xfc) | 0x01;       // VIC bank 2: $8000-$BFFF
    memset(COLOUR, PF_CRAM, PF_ROWS * 40);
    memset(COLOUR + PANEL_ROW * 40, VCOL_WHITE, 3 * 40);
    memset(PANEL, ' ', 3 * 40);
}

void put_text(char *screen, char row, char col, const char *t)
{
    char *p = screen + row * 40 + col;
    for (char i = 0; t[i]; i++) {
        char c = t[i];
        p[i] = c >= 'A' && c <= 'Z' ? c - 'A' + 1 : c;
    }
}

void put_dec(char *at, unsigned long v, char digits)
{
    for (char i = digits; i > 0; i--) {
        at[i - 1] = '0' + (char)(v % 10);
        v /= 10;
    }
}

// decimal_print for a byte: repeated subtraction of ten, no 32-bit divide
// (put_dec's unsigned long % 10 made flow_frame's worst 2,095 cycles in make
// frontend; measured again after this in PLAN.md, "Front end").
void put_dec8(char *at, char v, char digits)
{
    char t = 0;
    while (v >= 10) {                   // t = v / 10, v = v % 10
        v -= 10;
        t++;
    }
    at[digits - 1] = '0' + v;
    if (digits > 1)
        at[digits - 2] = '0' + t;       // values to 99
}

// decimal_print, BCD route: one digit per nibble, a shift and a mask; the
// screen code of a digit is $30 plus its value.
void put_bcd(char *at, const char *bcd, char nbytes)
{
    for (char i = 0; i < nbytes; i++) {
        at[2 * i] = '0' + (bcd[i] >> 4);
        at[2 * i + 1] = '0' + (bcd[i] & 15);
    }
}

void text_colour(char row, char col, char n, char c)
{
    memset(COLOUR + row * 40 + col, c, n);
}

void playfield_colour(void)
{
    memset(COLOUR, PF_CRAM, PF_ROWS * 40);
}

static char panel_is_front;              // 1: panel_front's text is up; nothing to redraw

void panel_draw(void)
{
    panel_is_front = 0;
    memset(PANEL, ' ', 3 * 40);
    put_text(SCREEN, PANEL_ROW, 2, "SCORE 000000");
    put_text(SCREEN, PANEL_ROW, 28, "FIREBASE");
    put_text(SCREEN, PANEL_ROW + 2, 2, "LIVES 0");
    put_text(SCREEN, PANEL_ROW + 2, 24, "GRENADES 00");
    text_colour(PANEL_ROW, 28, 8, VCOL_YELLOW);
    panel_update();
}

// One field each, so flow_frame redraws only what changed.
void panel_score(void)
{
    put_bcd(SCREEN + PANEL_ROW * 40 + 8, score, 3);
}

void panel_lives(void)
{
    put_dec8(SCREEN + (PANEL_ROW + 2) * 40 + 8, lives, 1);
}

void panel_grenades(void)
{
    put_dec8(SCREEN + (PANEL_ROW + 2) * 40 + 33, grenades, 2);
}

void panel_update(void)
{
    panel_score();
    panel_lives();
    panel_grenades();
}

// The front end's panel: the name only. No score, lives or grenade digits
// while the state is a front-end one (game_state_machine, "Checks").
void panel_front(void)
{
    if (panel_is_front)
        return;
    panel_is_front = 1;
    for (char i = 0; i < 40; i++) {
        PANEL[i] = ' ';
        PANEL[i + 40] = ' ';
        PANEL[i + 80] = ' ';
    }
    put_text(SCREEN, PANEL_ROW, 28, "FIREBASE");
    text_colour(PANEL_ROW, 28, 8, VCOL_YELLOW);
}
