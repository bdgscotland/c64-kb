// display.h: the character set, sprite shapes, text and the score panel.
#ifndef DISPLAY_H
#define DISPLAY_H

#include "game.h"

// Character codes. 0-63 are the ROM's letters, digits and punctuation, copied
// so the panel, the title and check.py read them; 64 up are this game's.
enum {
    G_WATER = 32,               // the ROM space: all background colour
    G_LAND = 64, G_GRASS, G_TREE, G_ROCK, G_EDGE_L, G_EDGE_R, G_SPARKLE,
    G_LIFE = 96,                // hires: a ship, for the panel's lives
    G_RULE,                     // hires: the panel's top rule
    G_DOTS = 0xc0,              // $C0-$CF: an enemy dot over open water, pair * 4 + row / 2
    G_BOLTS = 0xd0,             // $D0-$D3: a bolt over open water, by pair
    G_BULLET = 0xf8             // $F8-$FB: one reserved glyph per bolt ($F2-$F7 the
};                              // dots'); $FF stays blank ($BFFF is the idle byte)

// Sprite frames: block SPR_BLOCK + frame.
enum { F_SHIP, F_DART, F_SAUCER, F_BUG, F_BOOM1, F_BOOM2, SPR_FRAMES };

// Playfield colours: background, $D022 (01), $D023 (10); colour RAM (11)
// is yellow for every playfield cell, and bullets draw in it.
#define PF_BG_COL   VCOL_BLUE
#define PF_MC1      VCOL_BROWN
#define PF_MC2      VCOL_GREEN
#define PF_CRAM     0x0f        // multicolour + yellow
#define TEXT_CRAM   VCOL_WHITE  // below 8: a hires cell inside the playfield

void display_init(void);                                // VIC bank 2, charset, sprites
void put_text(char *screen, char row, char col, const char *s);
void text_colour(char row, char col, char n, char colour);
void put_dec(char *p, unsigned v, char digits);
void panel_draw(void);                                  // the whole panel
void panel_add(char tens);                              // score digits, after add_score
void panel_update(void);                                // lives, when changed

#pragma compile("display.c")

#endif
