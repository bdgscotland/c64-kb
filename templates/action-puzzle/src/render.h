// render.h: the screen. Text mode, one character per cave cell, a RAM
// character set at $2000 whose codes $40 + element hold the cave's glyphs
// (animated by rewriting glyph bytes: c64-kb technique charset_animation).
#ifndef RENDER_H
#define RENDER_H

#define SCREEN      ((char *)0x0400)
#define COLOUR      ((char *)0xd800)
#define CHARSET     ((char *)0x2000)
#define CAVE_ROW0   1           // screen row of cave row 0
#define GLYPH_BASE  0x40        // screen code of element 0

void render_init(void);                         // charset, $D018, colours
void render_clear(void);                        // blank the whole screen
void draw_cell(unsigned i);                     // cave cell i to the screen
void draw_cave(void);                           // all 880 cells
void draw_row(char y);                          // one cave row
void draw_dirty(char y0, char y1);              // the cells the last slice changed, or queue its rows
void draw_pending(void);                        // redraw up to ROWS_PER_FRAME queued rows
extern char render_npending;                    // rows still queued

#define ROWS_PER_FRAME 2                        // queued rows redrawn a frame after an overflow
void render_animate(char frame);                // glyph animation, one phase in four frames
void put_text(char row, char col, const char *s, char colour);
void put_codes(char row, char col, const char *codes, char n, char colour);
void put_num(char row, char col, unsigned long v, char digits, char colour);
void fill_box(char row0, char col0, char row1, char col1, char colour);

#pragma compile("render.c")

#endif
