// scroll.h: the map and the vertical scroll (threshold_scroll_v, soft_scroll_v,
// row_map_redraw). The map is raw screen codes, 40 a row, row 0 at the top;
// the view moves up the map only, one pixel a step, and only when the soldier
// pushes past the threshold (soldier.c decides, scroll_step does it).
#ifndef SCROLL_H
#define SCROLL_H

#include "game.h"

extern char scroll_top;          // map row shown in screen row 0
extern char scroll_ys;           // YSCROLL 0-7 C has committed (the IRQ applies it)
extern unsigned scroll_wy;       // map y shown on raster line 55 = top * 8 + 7 - ys
extern char scroll_redraw_due;   // 1: YSCROLL wrapped this frame; main.c redraws after the band
extern unsigned scroll_steps;    // steps taken since scroll_init

#define SCROLL_START_TOP (MAP_ROWS - PF_ROWS)
#define SCROLL_START_YS  0

void scroll_init(char top, char ys);      // that view (SCROLL_START_*: the map's bottom), drawn at once
inline char scroll_can_step(void) { return scroll_wy != 0; }   // 0 at the map's top: stop
void scroll_step(void);                   // the view one pixel up the map (content moves down)
void scroll_redraw(void);                 // the 21 rows from scroll_top (kernel.asm redraw)

// A sprite pixel (dx, dy) of a sprite at (X, Y) on the map (game.h, coordinates).
inline unsigned map_x(unsigned sx, char dx) { return sx + dx - 24; }
inline unsigned map_y(char sy, char dy) { return scroll_wy + sy + dy - 54; }

// char_attribute_flags: the attribute byte of the map cell under map pixel (mx, my).
// Outside the map (mx >= 320 or my >= 768) it says A_BLOCK.
char attr_at(unsigned mx, unsigned my);
char code_at(unsigned mx, unsigned my);   // the screen code there

#pragma compile("scroll.c")

#endif
