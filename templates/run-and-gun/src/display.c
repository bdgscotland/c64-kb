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

void text_colour(char row, char col, char n, char c)
{
    memset(COLOUR + row * 40 + col, c, n);
}

void playfield_colour(void)
{
    memset(COLOUR, PF_CRAM, PF_ROWS * 40);
}

void panel_draw(void)
{
    memset(PANEL, ' ', 3 * 40);
    put_text(SCREEN, PANEL_ROW, 2, "SCORE 000000");
    put_text(SCREEN, PANEL_ROW, 28, "FIREBASE");
    put_text(SCREEN, PANEL_ROW + 2, 2, "LIVES 0");
    put_text(SCREEN, PANEL_ROW + 2, 24, "GRENADES 00");
    text_colour(PANEL_ROW, 28, 8, VCOL_YELLOW);
    panel_update();
}

void panel_update(void)
{
    put_dec(SCREEN + PANEL_ROW * 40 + 8, score, 6);
    put_dec(SCREEN + (PANEL_ROW + 2) * 40 + 8, lives, 1);
    put_dec(SCREEN + (PANEL_ROW + 2) * 40 + 33, grenades, 2);
}
