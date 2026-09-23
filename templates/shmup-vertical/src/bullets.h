// bullets.h: the player's bullets, drawn as characters (char_bullets).
#ifndef BULLETS_H
#define BULLETS_H

#include "game.h"

// Bullets, one reserved glyph each ($F8-$FB). At most 3 fly at once: one
// shot per 7 frames (P_COOL 6), and a bolt from the lowest ship (Y 180)
// lives 16 frames (arithmetic). The fourth is room for a faster gun.
#define NB 4

extern char b_live[NB];
extern char b_hx[NB];           // half X of the bolt's pixel pair
extern char b_line[NB];         // raster line of the bolt's top row

void bullets_reset(void);
bool bullet_fire(char hx, char ship_y);  // from a ship whose sprite Y is ship_y
void bullets_erase(void);                // restore every drawn cell, reverse order
void bullets_move_draw(void);            // move up, draw into the showing screen
void bullet_kill(char i);

#pragma compile("bullets.c")

#endif
