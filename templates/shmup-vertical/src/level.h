// level.h: the river map and the downward scroll through two screens.
#ifndef LEVEL_H
#define LEVEL_H

#include "game.h"

#define LEVEL_ROWS 96           // map rows; the level loops after the last

// What the frame IRQ applied to the frame now showing.
extern char cur_y;              // YSCROLL 0-7: content moves down one line a frame
extern char cur_front;          // 0: screen $8000, 1: $8400
extern unsigned cur_pos;        // rows scrolled: screen row r shows map row cur_pos + 20 - r
extern char cur_row;            // cur_pos modulo LEVEL_ROWS

void level_init(void);                  // expand the map into LEVEL_RAM
void level_show(unsigned pos, char y);  // draw both screens at pos, hold YSCROLL y
void level_frame(void);                 // after the frame IRQ: next values become current
void level_render(void);                // three rows of the hidden screen
void level_advance(void);               // YSCROLL + 1, or a flip at the carry
char *level_screen(void);               // the screen now showing
char *level_row(char r);                // screen row r of the screen now showing
char level_code(char r, char c);        // the map's code at screen row r, column c
bool level_intact(void);                // the showing screen equals the map

#pragma compile("level.c")

#endif
