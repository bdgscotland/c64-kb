// level.c: the river map and the downward scroll.
//
// The playfield is rows 0-20 of a 24-row ($D011 RSEL = 0) multicolour
// screen. It moves down one line a frame: YSCROLL counts 0 to 7, and at the
// carry the rows must move down one. Moving 800 bytes down from the bottom
// up cannot stay ahead of the beam, so there are two screens
// (screen_double_buffer_d018): the hidden one is drawn from the map, three
// rows a frame on YSCROLL 0-6, already one row further on, and the frame IRQ
// shows it with YSCROLL 0 in the same frame (it writes $D011 and $D018
// together on line 252). Colour RAM cannot be double-buffered, so every
// playfield cell has the same colour RAM value and the map is characters
// only.
#include "level.h"
#include "display.h"
#include <string.h>

char cur_y, cur_front;
unsigned cur_pos;
static char next_y, next_front;
static unsigned next_pos;
char cur_row;
static char next_row;                   // cur_pos and next_pos modulo LEVEL_ROWS
static char *map_row[LEVEL_ROWS];       // where each map row's 40 codes are
static char *scr_row[2][21];            // where each playfield row is, per screen

// The river's banks, as (left, right) widths in cells every 4 map rows; the
// rows between are interpolated. The last pair leads back into the first, so
// the level loops without a seam. Edit this to change the level.
#define KEYS (LEVEL_ROWS / 4)
static const char bank[KEYS][2] = {
    {  8,  8 }, {  9,  8 }, { 10,  7 }, { 12,  6 }, { 13,  6 }, { 12,  7 },
    { 10,  9 }, {  8, 11 }, {  6, 13 }, {  5, 14 }, {  5, 13 }, {  6, 11 },
    {  8,  9 }, { 10,  8 }, { 12,  7 }, { 14,  6 }, { 15,  6 }, { 14,  7 },
    { 12,  9 }, { 10, 10 }, {  9, 10 }, {  8,  9 }, {  8,  8 }, {  8,  8 },
};

static char land(char r, char c)
{
    char h = (char)(r * 37 + c * 11) & 31;
    if (h < 3) return G_TREE;
    if (h == 3) return G_ROCK;
    if (h < 16) return G_GRASS;
    return G_LAND;
}

void level_init(void)
{
    for (char m = 0; m < LEVEL_ROWS; m++) {
        char k = m >> 2, f = m & 3;
        char k1 = k + 1 == KEYS ? 0 : k + 1;
        char left  = (bank[k][0] * (4 - f) + bank[k1][0] * f) >> 2;
        char right = (bank[k][1] * (4 - f) + bank[k1][1] * f) >> 2;
        char *d = LEVEL_RAM + 40 * (LEVEL_ROWS - 1 - m);
        map_row[m] = d;
        for (char c = 0; c < 40; c++) {
            char g;
            if (c + 1 < left)       g = land(m, c);
            else if (c + 1 == left) g = G_EDGE_L;
            else if (c + right < 39) g = ((char)(m * 13 + c * 7) & 63) == 5 ? G_SPARKLE : G_WATER;
            else if (c + right == 39) g = G_EDGE_R;
            else                    g = land(m, c);
            d[c] = g;
        }
    }
    memcpy(LEVEL_RAM + 40 * LEVEL_ROWS, LEVEL_RAM, 80);    // map rows 95 and 94 again
    for (char r = 0; r < 21; r++) {
        scr_row[0][r] = PF0 + 40 * r;
        scr_row[1][r] = PF1 + 40 * r;
    }
}

// Screen rows r to r + 2 of a screen whose position is at map row `row`
// show map rows row + 20 - r, one less, and one less again. The map is
// stored last row first, with rows 95 and 94 repeated after row 0, so those
// three rows are always 120 bytes in a line: one copy.
static void draw_rows3(char front, char row, char r)
{
    char m = row + 20 - r;
    if (m >= LEVEL_ROWS)
        m -= LEVEL_ROWS;
    K_WORD(ASM_ROW_SRC) = (unsigned)map_row[m];
    K_WORD(ASM_ROW_DST) = (unsigned)scr_row[front][r];
    K_BYTE(ASM_ROW_N) = 120;
    __asm { jsr ASM_COPY_ROWS }
}

static char row_after(char row)
{
    return row + 1 == LEVEL_ROWS ? 0 : row + 1;
}

static void apply_next(void)
{
    K_PF_D011 = 0x10 | next_y;                      // DEN, 24 rows, YSCROLL
    K_PF_D018 = next_front ? D018_PF1 : D018_PF0;
}

void level_show(unsigned pos, char y)
{
    char row = (char)(pos % LEVEL_ROWS);
    for (char r = 0; r < 21; r += 3) {
        draw_rows3(0, row, r);
        draw_rows3(1, row_after(row), r);
    }
    cur_pos = next_pos = pos;
    cur_row = next_row = row;
    cur_y = next_y = y;
    cur_front = next_front = 0;
    apply_next();
}

void level_frame(void)
{
    cur_y = next_y;
    cur_front = next_front;
    cur_pos = next_pos;
    cur_row = next_row;
}

// On YSCROLL k (0-6) draw rows 3k to 3k+2 of the hidden screen for the next
// position; on 7 it is complete and the next frame shows it.
void level_render(void)
{
    if (cur_y == 7)
        return;
    draw_rows3(cur_front ^ 1, row_after(cur_row), cur_y * 3);
}

void level_advance(void)
{
    if (cur_y == 7) {
        next_y = 0;
        next_front = cur_front ^ 1;
        next_pos = cur_pos + 1;
        next_row = row_after(cur_row);
    } else {
        next_y = cur_y + 1;
        next_front = cur_front;
        next_pos = cur_pos;
        next_row = cur_row;
    }
    apply_next();
}

char *level_screen(void)
{
    return cur_front ? PF1 : PF0;
}

bool level_intact(void)
{
    for (char r = 0; r < 21; r++) {
        char m = cur_row + 20 - r;
        if (m >= LEVEL_ROWS)
            m -= LEVEL_ROWS;
        if (memcmp(scr_row[cur_front][r], map_row[m], 40) != 0)
            return false;
    }
    return true;
}
