// soldier.c: see soldier.h.
#include "soldier.h"
#include "scroll.h"

unsigned soldier_x;
char soldier_y, soldier_facing, soldier_behind, soldier_stepped;
unsigned soldier_blocked, soldier_behind_frames;
static char anim, anim_count;

// facing_turn_step: the stick's direction bits (1 = pressed: up, down, left,
// right) to the target facing, $FF for centred or an impossible pair
// (c64-kb recipe kickassembler/facing-turn-step, its tables).
static const char target_of[16] = {
    0xff, 0, 8, 0xff, 12, 14, 10, 0xff, 4, 2, 6, 0xff, 0xff, 0xff, 0xff, 0xff
};

void soldier_reset(void)
{
    soldier_x = 168 + 8 * FORCE_FAULT;
    soldier_y = 160;
    soldier_facing = 0;
    soldier_behind = 0;
    soldier_stepped = 0;
    anim = anim_count = 0;
}

// Any A_BLOCK cell under the two map points?
static char blocked2(unsigned mx0, unsigned my0, unsigned mx1, unsigned my1)
{
    return (attr_at(mx0, my0) | attr_at(mx1, my1)) & A_BLOCK;
}

static char up_free(void)
{
    unsigned my = map_y(soldier_y, FEET_Y0 - 1);
    return !blocked2(map_x(soldier_x, FEET_X0), my, map_x(soldier_x, FEET_X1), my);
}

void soldier_update(char joy)
{
    char held = ~joy & 0x0f;
    char moved = 0;
    soldier_stepped = 0;

    // Facing: one step a frame toward the stick; a tie (8 away) turns clockwise.
    char target = target_of[held];
    if (target != 0xff) {
        char d = (target - soldier_facing) & 15;
        if (d != 0)
            soldier_facing = (soldier_facing + (d <= 8 ? 1 : 15)) & 15;
    }

    // X first, then Y, each against the feet box's leading edge, so a
    // diagonal push slides along a wall.
    if (held & 0x04) {                                  // left
        unsigned mx = map_x(soldier_x, FEET_X0 - 1);
        if (soldier_x > SOLDIER_MIN_X) {
            if (!blocked2(mx, map_y(soldier_y, FEET_Y0), mx, map_y(soldier_y, FEET_Y1))) {
                soldier_x--;
                moved = 1;
            } else
                soldier_blocked++;
        }
    } else if (held & 0x08) {                           // right
        unsigned mx = map_x(soldier_x, FEET_X1 + 1);
        if (soldier_x < SOLDIER_MAX_X) {
            if (!blocked2(mx, map_y(soldier_y, FEET_Y0), mx, map_y(soldier_y, FEET_Y1))) {
                soldier_x++;
                moved = 1;
            } else
                soldier_blocked++;
        }
    }
    if (held & 0x01) {                                  // up: walk, or scroll at the threshold
        if (up_free()) {
            if (soldier_y > SOLDIER_THRESH || (!scroll_can_step() && soldier_y > SOLDIER_TOP_Y)) {
                soldier_y--;
                moved = 1;
            } else if (scroll_can_step()) {
                scroll_step();                          // the map moves under him instead
                soldier_stepped = 1;
                moved = 1;
            }
        } else
            soldier_blocked++;
    } else if (held & 0x02) {                           // down
        if (soldier_y < SOLDIER_MAX_Y) {
            unsigned my = map_y(soldier_y, FEET_Y1 + 1);
            if (!blocked2(map_x(soldier_x, FEET_X0), my, map_x(soldier_x, FEET_X1), my)) {
                soldier_y++;
                moved = 1;
            } else
                soldier_blocked++;
        }
    }

    // Walk cycle: a frame every 6 moved frames; standing shows frame 0.
    if (moved) {
        if (++anim_count == 6) {
            anim_count = 0;
            anim = (anim + 1) & 3;
        }
    } else {
        anim = 0;
        anim_count = 0;
    }

    // Draw-behind from the body centre (char_attribute_flags, bit 1).
    soldier_behind = (attr_at(map_x(soldier_x, BODY_CX), map_y(soldier_y, BODY_CY)) & A_BEHIND) ? 1 : 0;
    soldier_behind_frames += soldier_behind;
}

char soldier_repeat_step(void)
{
    if (soldier_stepped && scroll_can_step() && up_free()) {
        scroll_step();
        return 1;
    }
    soldier_stepped = 0;
    return 0;
}

void soldier_draw(void)
{
    char dir = ((soldier_facing + 1) >> 1) & 7;         // eight body frames, rounded
    SLOT_Y[SLOT_SOLDIER] = soldier_y;
    SLOT_XL[SLOT_SOLDIER] = (char)soldier_x;
    SLOT_XH[SLOT_SOLDIER] = soldier_x >> 8;
    SLOT_PTR[SLOT_SOLDIER] = SPR_BLOCK + SPR_SOLDIER + dir * 4 + anim;
    SLOT_COL[SLOT_SOLDIER] = SOLDIER_COLOUR;
    SLOT_PRI[SLOT_SOLDIER] = soldier_behind;
}
