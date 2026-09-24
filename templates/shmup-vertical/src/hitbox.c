// hitbox.c: boxes from the animation frame, pairs from group bits, after
// c64-kb's oscar64/per-frame-hitbox recipe. Every box is in half X (one byte
// across the whole screen, 2-pixel precision) and raster lines, so the test
// is four one-byte compares and $D010 never enters it.
//
// The ship's box is emitted where it is drawn (actors_draw), the bolts' by
// glyph.asm's bb_run, into hit.asm's tables. An enemy's box comes from the
// multiplexer's actor table, which is what the display showed this frame,
// and its sprite frame's box (hit.asm fb_*): an explosion's frame has none.
// Enemies are tested only against the groups they can hurt (the ship and
// the bolts), never against each other; the enemies' dots only against the
// ship. hit.asm's dot_scan and hit_scan do the tests; this file turns their
// hits into events.
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

void collide(void)
{
    __asm { jsr ASM_DOT_SCAN }                  // the enemies' dots against the ship
    char j = K_BYTE(ASM_DOT_HIT);
    if (j != 0xff)
        on_ship_shot(j);                        // its box goes off before the enemies' test
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
