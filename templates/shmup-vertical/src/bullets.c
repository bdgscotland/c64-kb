// bullets.c: the player's bullets as characters, from c64-kb's
// oscar64/char-bullets recipe (technique char_bullets). Each bullet owns one
// reserved glyph. To draw it: save the screen code under it, copy that code's
// glyph into the reserved glyph, OR a bolt into it, write the reserved code.
// Restoring runs in reverse order, so two bullets in one cell unwind.
//
// What this adds: the playfield scrolls. A bolt is 1 pixel pair wide and
// rows 2-5 of its cell tall. It moves up 7 lines a frame while the playfield
// moves down 1, so it stays on rows 2-5 of whatever cell it is in: the
// invariant b_line - 50 - YSCROLL = 8 * row holds every frame, the carry
// frame included (YSCROLL 7 to 0, same row). A bolt never straddles two
// cells and needs one glyph.
//
// Colour: every playfield cell is multicolour with colour RAM $0F, so the
// bolt's pair %11 draws in yellow and colour RAM is never touched.
#include "bullets.h"
#include "level.h"
#include "display.h"
#include "hitbox.h"

char b_live[NB], b_hx[NB], b_line[NB];
static char *b_cell[NB];                // where it was drawn; 0 = not drawn
static char b_under[NB];                // the code it replaced

static const char pair_mask[4] = { 0xc0, 0x30, 0x0c, 0x03 };

void bullets_reset(void)
{
    for (char i = 0; i < NB; i++) {
        b_live[i] = 0;
        b_cell[i] = nullptr;
        box_off(BOX_SHOT + i);
    }
}

// The bolt starts in the cell row above the ship's nose, placed as if drawn
// this frame: the next frame's move keeps the invariant. Returns false when
// every bullet is in flight or the ship is too high.
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

void bullet_kill(char i)
{
    b_live[i] = 0;
    box_off(BOX_SHOT + i);
}

void bullets_erase(void)
{
    char i = NB;
    do {
        i--;
        char *p = b_cell[i];
        if (p) {
            *p = b_under[i];
            b_cell[i] = nullptr;
        }
    } while (i);
}

void bullets_move_draw(void)
{
    char *screen = level_screen();
    for (char i = 0; i < NB; i++) {
        if (!b_live[i])
            continue;
        char line = b_line[i] - 7;
        b_line[i] = line;
        char r = (char)(line - 50 - cur_y) >> 3;
        if (line < 50 + 8 + cur_y || r > 19) {       // row 0 is half hidden: gone
            bullet_kill(i);
            continue;
        }
        char x = b_hx[i] - 12;                      // multicolour pixel on the screen
        char *p = screen + 40 * r + (x >> 2);
        char u = *p;
        b_cell[i] = p;
        b_under[i] = u;
        const char *src = CHARSET + (unsigned)u * 8;
        char *dst = CHARSET + (unsigned)(G_BULLET + i) * 8;
        char m = pair_mask[x & 3];
        dst[0] = src[0];     dst[1] = src[1];
        dst[2] = src[2] | m; dst[3] = src[3] | m;
        dst[4] = src[4] | m; dst[5] = src[5] | m;
        dst[6] = src[6];     dst[7] = src[7];
        *p = G_BULLET + i;
        box_bullet(i, b_hx[i], line);
    }
}
