// hitbox.c: boxes from the animation frame, pairs from group bits, after
// c64-kb's oscar64/per-frame-hitbox recipe. Every box is in half X (one byte
// across the whole screen, 2-pixel precision) and raster lines, so the test
// is four one-byte compares and $D010 never enters it.
//
// The ship's and the bolts' boxes are emitted where they are drawn, into
// hit.asm's tables. An enemy's box comes from the multiplexer's actor table,
// which is what the display showed this frame, and its sprite frame's box
// (hit.asm fb_*): an explosion's frame has none. Enemies are tested only
// against the groups they can hurt (the ship and the bolts), never against
// each other; the enemies' dots only against the ship. hit.asm's hit_scan
// does the enemy pairs; this file turns its hits into events.
#include "hitbox.h"
#include "display.h"
#include "waves.h"
#include "bullets.h"

#define hb_on ((char *)ASM_HB_ON)
#define hb_l  ((char *)ASM_HB_L)
#define hb_r  ((char *)ASM_HB_R)
#define hb_t  ((char *)ASM_HB_T)
#define hb_b  ((char *)ASM_HB_B)
#define fb_x  ((const char *)ASM_FB_X)
#define fb_y  ((const char *)ASM_FB_Y)
#define fb_w  ((const char *)ASM_FB_W)
#define fb_h  ((const char *)ASM_FB_H)

void box_off(char slot)
{
    hb_on[slot] = 0;
}

void box_ship(char hx, char sy)
{
    char l = hx + fb_x[F_SHIP], t = sy + 1 + fb_y[F_SHIP];
    hb_l[BOX_PLAYER] = l;
    hb_r[BOX_PLAYER] = l + fb_w[F_SHIP];
    hb_t[BOX_PLAYER] = t;
    hb_b[BOX_PLAYER] = t + fb_h[F_SHIP];
    hb_on[BOX_PLAYER] = 1;
}

// A bolt: one pixel pair wide, four lines tall.
void box_bullet(char i, char hx, char line)
{
    char s = BOX_SHOT + i;
    hb_l[s] = hx;
    hb_r[s] = hx + 1;
    hb_t[s] = line;
    hb_b[s] = line + 4;
    hb_on[s] = 1;
}

// Enemy dots against the ship's box: a dot is one pixel pair wide and two
// lines tall.
static void ship_hit(void)
{
    if (!hb_on[BOX_PLAYER])
        return;
    char t = hb_t[BOX_PLAYER], b = hb_b[BOX_PLAYER], l = hb_l[BOX_PLAYER], r = hb_r[BOX_PLAYER];
    for (char j = 0; j < NEB; j++) {
        if (!eb_live[j])
            continue;
        char y = eb_line[j], x = eb_hx[j];
        if (y < b && t < y + 2 && x < r && l < x + 1) {
            on_ship_shot(j);
            return;
        }
    }
}

void collide(void)
{
    ship_hit();
    __asm { jsr ASM_HIT_SCAN }
    char n = K_BYTE(ASM_HIT_N);
    for (char k = 0; k < n; k++) {
        char e = ((char *)ASM_HIT_E)[k], a = ((char *)ASM_HIT_A)[k];
        if (a == BOX_PLAYER)
            on_player_hit(e);
        else
            on_enemy_shot(e, a - BOX_SHOT);
    }
}
