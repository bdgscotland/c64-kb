// bullets.c: the ship's bolts and the enemies' bullets as characters, from
// c64-kb's oscar64/char-bullets recipe (technique char_bullets). Each bullet
// owns one reserved glyph. To draw it: save the screen code under it, copy
// that code's glyph into the reserved glyph, OR the shot into it, write the
// reserved code. Every bullet drawn in a frame goes on one list, bolts
// first; restoring walks the list backwards, so bullets sharing a cell
// unwind. The list, the moves and the draws are glyph.asm's (bb_run for the
// bolts, eb_run for the dots, cb_draw, cb_erase, cb_check); this file fires
// the bullets and holds the rules.
//
// Bolts: 1 pixel pair wide, rows 2-5 of their cell. A bolt moves up 7 lines
// a frame while the playfield moves down 1, so it stays on rows 2-5 of
// whatever cell it is in: b_line - 50 - YSCROLL = 8 * row every frame, the
// carry frame included (YSCROLL 7 to 0, same row). b_line is the raster line
// of the bolt's top row (row 2 of the cell, whose top is 48 + YSCROLL + 8 *
// row). A bolt never straddles two cells.
//
// Enemy bullets: a 2 x 2 dot that falls 2 lines a frame and drifts one
// pixel pair a frame towards where the ship was, snapped to an even glyph
// row so it never crosses a cell edge. An enemy fires only between sprite Y 72 and
// 140, so a bullet starts on line 84 or lower, in a cell that starts on line
// 77 or lower. Bolts are drawn first; the draw must end before the beam
// reaches the first cell it changes (the measured end is in PLAN.md).
//
// Colour: every playfield cell is multicolour with colour RAM $0F, so the
// shots' pairs %11 draw in yellow and colour RAM is never touched.
#include "bullets.h"
#include "level.h"
#include "display.h"
#include "hitbox.h"

#define EB_TOP    72            // enemies fire from sprite Y 72 ...
#define EB_BOTTOM 140           // ... to 140
#define eb_dx ((signed char *)ASM_EB_DX)

unsigned eb_fired;

#ifdef DRAWEND
// Measuring only (-dDRAWEND=1): the smallest number of lines between the
// raster just after a cell was written and the first line of that cell, at
// the word it is given ($0364 bolts, $0366 dots; starts at $7FFF when main
// sets it). Negative: the beam had reached the cell first. The raster is 0
// while it is still in the lower border or has not reached line 0.
char drawend_on;                                // main.c: 1 in a frame that starts on time

static void drawend_margin(unsigned at, char top)
{
    if (!drawend_on)
        return;
    char l = vic.raster;
    if ((vic.ctrl1 & 0x80) || l >= 250)
        return;                                 // not yet past line 0: no risk
    int m = (int)top - l;
    volatile int *d = (volatile int *)at;
    if (m < *d)
        *d = m;
}
#endif

void bullets_reset(void)
{
    for (char i = 0; i < NB; i++) {
        b_live[i] = 0;
        box_off(BOX_SHOT + i);
    }
    for (char j = 0; j < NEB; j++)
        eb_live[j] = 0;
    __asm { jsr ASM_CB_BEGIN }                  // an empty draw list
    K_BYTE(ASM_CB_KEEP) = AUTOPILOT;            // bullets_restored needs the map's codes
}

// The bolt starts in the cell row above the ship's nose, placed as if drawn
// this frame: the next frame's move keeps the invariant. Returns false when
// every bolt is in flight or the ship is too high.
bool bullet_fire(char hx, char ship_y)
{
    if (ship_y < 52 + 16 + cur_y)
        return false;
    char r = ((char)(ship_y - 52 - cur_y) >> 3) - 1;
    for (char i = 0; i < NB; i++) {
        if (!b_live[i]) {
            b_live[i] = 1;
            b_hx[i] = hx;
            b_line[i] = 50 + cur_y + 8 * r;
            return true;
        }
    }
    return false;
}

// A dot from the middle of an enemy sprite at (hx, sy), drifting towards
// target_hx. Outside the fire window, or with every slot in flight, nothing.
void enemy_bullet_fire(char hx, char sy, char target_hx)
{
    if (sy < EB_TOP || sy > EB_BOTTOM)
        return;
    char x = hx + 6;
    for (char j = 0; j < NEB; j++) {
        if (!eb_live[j]) {
            eb_live[j] = 1;
            eb_hx[j] = x;
            eb_line[j] = sy + 12;
            eb_dx[j] = target_hx + 2 < x ? -1 : target_hx > x + 2 ? 1 : 0;
            eb_fired++;
            return;
        }
    }
}

void bullet_kill(char i)
{
    b_live[i] = 0;
    box_off(BOX_SHOT + i);
}

void enemy_bullet_kill(char j)
{
    eb_live[j] = 0;
}

void bullets_erase(void)
{
    __asm { jsr ASM_CB_ERASE }
}

// Every cell the last draw changed holds the map's code again. Reads the
// screen back, so an erase that skipped a cell, or ran in the wrong order,
// leaves a reserved code there and fails.
bool bullets_restored(void)
{
    __asm { jsr ASM_CB_CHECK }
    return !K_BYTE(ASM_CB_FAULT);
}

void bullets_move_draw(void)
{
    K_BYTE(ASM_CB_FRONT) = cur_front;
    K_BYTE(ASM_CB_TOP) = cur_row + 20;
    K_BYTE(ASM_CB_Y) = cur_y;                   // the YSCROLL showing
    __asm {
        jsr ASM_CB_BEGIN
        jsr ASM_BB_RUN                          // the bolts first
    }
#ifdef DRAWEND
    // Read after all the bolts (then all the dots), so a margin here is
    // smaller than the one just after its own cell was written: a lower
    // bound.
    for (char i = 0; i < NB; i++)
        if (b_live[i])
            drawend_margin(0x0364, b_line[i] - 2);  // the bolt's cell starts 2 lines up
#endif
    __asm { jsr ASM_EB_RUN }                    // then the enemies' dots
#ifdef DRAWEND
    for (char j = 0; j < NEB; j++)
        if (eb_live[j])
            drawend_margin(0x0366, eb_line[j] - ((char)(eb_line[j] - 48 - cur_y) & 7));
#endif
}
