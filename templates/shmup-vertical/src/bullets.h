// bullets.h: the ship's bolts and the enemies' bullets, all drawn as
// characters (char_bullets).
#ifndef BULLETS_H
#define BULLETS_H

#include "game.h"

// The ship's bolts, glyphs $F8-$FB. At most 3 fly at once: one shot per 7
// frames (P_COOL 6), and a bolt from the lowest ship (Y 180) lives 16 frames
// (arithmetic). The fourth is room for a faster gun.
#define NB 4
// The enemies' bullets, glyphs $F2-$F7.
#define NEB 6

// The bolts and the dots live in glyph.asm, which moves and draws them.
#define b_live  ((char *)ASM_BB_LIVE)
#define b_hx    ((char *)ASM_BB_HX)     // half X of the bolt's pixel pair
#define b_line  ((char *)ASM_BB_LINE)   // raster line of the bolt's top row
#define eb_live ((char *)ASM_EB_LIVE)
#define eb_hx   ((char *)ASM_EB_HX)     // half X of the dot's pixel pair
#define eb_line ((char *)ASM_EB_LINE)   // raster line of the dot's top row
extern unsigned eb_fired;       // enemy bullets fired this game (play_enter clears it)

void bullets_reset(void);
bool bullet_fire(char hx, char ship_y);  // from a ship whose sprite Y is ship_y
void enemy_bullet_fire(char hx, char sy, char target_hx);   // from an enemy sprite
void bullets_erase(void);                // restore every drawn cell, reverse order
void bullets_move_draw(void);            // move, draw into the showing screen
void bullet_kill(char i);
void enemy_bullet_kill(char j);
bool bullets_restored(void);             // after bullets_erase: every cell is the map's

#pragma compile("bullets.c")

#endif
