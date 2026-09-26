// display.h: the VIC set-up, the character set's text half, colour RAM, text
// on the screen and the score panel (rows 21-23, under the band).
#ifndef DISPLAY_H
#define DISPLAY_H

#include "game.h"

#define TEXT_CRAM   VCOL_WHITE          // below 8: a hires cell, readable text
#define PANEL_ROW   21                  // first panel row on the screen

void display_init(void);                // bank 2, the ROM letters into $8800, colour RAM
void put_text(char *screen, char row, char col, const char *t);   // ASCII upper case
void put_dec(char *at, unsigned long v, char digits);
void put_dec8(char *at, char v, char digits);          // a byte: 1 or 2 digits (values to 99)
void put_bcd(char *at, const char *bcd, char nbytes);  // 2 digits a byte, most significant first
void text_colour(char row, char col, char n, char c);
void playfield_colour(void);            // rows 0-20 back to PF_CRAM (after text)
void panel_draw(void);                  // the labels and the numbers
void panel_update(void);                // the numbers (score, lives, grenades)
void panel_score(void);                 // one field each (flow.c redraws what changed)
void panel_lives(void);
void panel_grenades(void);
void panel_front(void);                 // the front end's panel: FIREBASE, no digits

#pragma compile("display.c")

#endif
