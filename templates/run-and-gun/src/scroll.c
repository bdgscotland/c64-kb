// scroll.c: see scroll.h.
#include "scroll.h"

char scroll_top, scroll_ys, scroll_redraw_due;
unsigned scroll_wy, scroll_steps;

// Map row addresses: one table lookup instead of a multiply by 40.
static const char *row_addr[MAP_ROWS];

void scroll_init(char top, char ys)
{
    for (char r = 0; r < MAP_ROWS; r++)
        row_addr[r] = MAP + 40 * r;
    scroll_top = top;
    scroll_ys = ys;
    scroll_wy = scroll_top * 8 + 7 - scroll_ys;
    scroll_steps = 0;
    scroll_redraw_due = 0;
    K_PEND_YS = scroll_ys;
    K_CUR_YS = scroll_ys;
    scroll_redraw();
}

// Content moves down one line: YSCROLL up by one, and at the wrap a new map row
// at the top and a redraw. The redraw must reach the same frame as YSCROLL 0
// (recipe row-map-redraw, "Why this works"): main.c commits K_PEND_YS with this
// frame's sprites and then, after the band IRQ has passed the last playfield
// badline, calls scroll_redraw.
void scroll_step(void)
{
    if (scroll_ys == 7) {
        scroll_ys = 0;
        scroll_top--;
        scroll_redraw_due = 1;
    } else
        scroll_ys++;
    scroll_wy--;
    scroll_steps++;
    K_PEND_YS = scroll_ys;
}

void scroll_redraw(void)
{
    K_REDRAW_TOP = scroll_top;
    __asm { jsr ASM_REDRAW }
}

char code_at(unsigned mx, unsigned my)
{
    if (mx >= 320 || my >= 8 * MAP_ROWS)
        return 0;
    return row_addr[my >> 3][mx >> 3];
}

char attr_at(unsigned mx, unsigned my)
{
    if (mx >= 320 || my >= 8 * MAP_ROWS)
        return A_BLOCK;
    return ATTR[row_addr[my >> 3][mx >> 3]];
}
