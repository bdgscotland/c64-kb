// hitbox.c: boxes from the animation frame, pairs from group bits, after
// c64-kb's oscar64/per-frame-hitbox recipe. Every box is in half X (one byte
// across the whole screen, 2-pixel precision) and raster lines, so the test
// is four one-byte compares and $D010 never enters it.
//
// The ship's and the bullets' boxes are emitted where they are drawn. An
// enemy's box comes from the multiplexer's actor table, which is what the
// display showed this frame, and its sprite frame: an explosion's frame has
// no box. Enemies are tested only against the groups they can hurt (the ship
// and the bullets), never against each other, and only when their lines
// overlap the band those boxes cover.
#include "hitbox.h"
#include "display.h"
#include "waves.h"

// Each frame's box, by frame (display.h F_*): offset and size in half X and
// lines from the sprite's first pixel pair and first line. w = 0: no box.
static const char fb_x[SPR_FRAMES] = { 3, 3, 1, 2, 0, 0 };
static const char fb_y[SPR_FRAMES] = { 4, 2, 1, 2, 0, 0 };
static const char fb_w[SPR_FRAMES] = { 6, 6, 10, 8, 0, 0 };   // ship: hull only
static const char fb_h[SPR_FRAMES] = { 10, 8, 7, 9, 0, 0 };

// Boxes of the groups enemies can hurt: slot 0 the ship, 1-4 the bullets.
static char bx_on[BOX_ENEMY], bx_l[BOX_ENEMY], bx_r[BOX_ENEMY], bx_t[BOX_ENEMY], bx_b[BOX_ENEMY];

void box_off(char slot)
{
    bx_on[slot] = 0;
}

void box_ship(char hx, char sy)
{
    char l = hx + fb_x[F_SHIP], t = sy + 1 + fb_y[F_SHIP];
    bx_l[BOX_PLAYER] = l;
    bx_r[BOX_PLAYER] = l + fb_w[F_SHIP];
    bx_t[BOX_PLAYER] = t;
    bx_b[BOX_PLAYER] = t + fb_h[F_SHIP];
    bx_on[BOX_PLAYER] = 1;
}

// A bolt: one pixel pair wide, four lines tall.
void box_bullet(char i, char hx, char line)
{
    char s = BOX_SHOT + i;
    bx_l[s] = hx;
    bx_r[s] = hx + 1;
    bx_t[s] = line;
    bx_b[s] = line + 4;
    bx_on[s] = 1;
}

void collide(void)
{
    char att[BOX_ENEMY], na = 0, top = 255, bot = 0;
    for (char a = 0; a < BOX_ENEMY; a++) {
        if (bx_on[a]) {
            att[na++] = a;
            if (bx_t[a] < top) top = bx_t[a];
            if (bx_b[a] > bot) bot = bx_b[a];
        }
    }
    if (!na)
        return;
    for (char e = 0; e < NE; e++) {
        if (e_state[e] != E_FLYING)
            continue;
        char f = e_ptr[e] - SPR_BLOCK;
        char t = e_y[e] + 1 + fb_y[f], b = t + fb_h[f];
        if (b <= top || t >= bot)
            continue;                           // outside the band: no pair can hit
        char l = e_hx[e] + fb_x[f], r = l + fb_w[f];
        for (char k = 0; k < na; k++) {
            char a = att[k];
            if (bx_on[a] && t < bx_b[a] && bx_t[a] < b && l < bx_r[a] && bx_l[a] < r) {
                if (a == BOX_PLAYER)
                    on_player_hit(e);
                else
                    on_enemy_shot(e, a - BOX_SHOT);
                break;
            }
        }
    }
}
