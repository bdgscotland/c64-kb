// soldier.c: see soldier.h.
#include "soldier.h"
#include "scroll.h"
#include "objects.h"

unsigned soldier_x;
char soldier_y, soldier_facing, soldier_behind, soldier_stepped, soldier_deadly;
char soldier_state, soldier_t;
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
    soldier_deadly = 0;
    soldier_state = SS_ALIVE;
    soldier_t = 0;
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

    // Draw-behind and deadly terrain from the body centre (char_attribute_flags
    // "How" step 5: bits 1 and 2 from one probe under the body).
    char a = attr_at(map_x(soldier_x, BODY_CX), map_y(soldier_y, BODY_CY));
    soldier_behind = (a & A_BEHIND) ? 1 : 0;
    soldier_deadly = (a & A_DEADLY) ? 1 : 0;
    soldier_behind_frames += soldier_behind;
}

char soldier_walk(unsigned x, char y)
{
    char target;
    if (soldier_x != x) {
        target = soldier_x < x ? 4 : 12;
        soldier_x += soldier_x < x ? 1 : -1;
    } else if (soldier_y > y) {
        target = 0;
        soldier_y--;
    } else
        return 1;
    char d = (target - soldier_facing) & 15;
    if (d != 0)
        soldier_facing = (soldier_facing + (d <= 8 ? 1 : 15)) & 15;
    if (++anim_count == 6) {
        anim_count = 0;
        anim = (anim + 1) & 3;
    }
    soldier_behind = (attr_at(map_x(soldier_x, BODY_CX), map_y(soldier_y, BODY_CY)) & A_BEHIND) ? 1 : 0;
    return 0;
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

// The death: he spins, one body frame every 2 frames, red and white by turns
// every 4, for DEATH_SPIN frames; then the dust sprite until flow.c ends it.
#define DEATH_SPIN 40

void soldier_draw(void)
{
    char ptr, col = SOLDIER_COLOUR;
    if (soldier_state == SS_GONE) {
        slot_park(SLOT_SOLDIER);
        return;
    }
    if (soldier_state == SS_DEAD) {
        char t = soldier_t;
        if (t < DEATH_SPIN) {
            ptr = SPR_BLOCK + SPR_SOLDIER + ((((soldier_facing + 1) >> 1) + (t >> 1)) & 7) * 4;
            if (t & 4)
                col = VCOL_RED;
        } else {
            ptr = SPR_BLOCK + SPR_DOWN;
            col = VCOL_LT_GREY;
        }
    } else
        ptr = SPR_BLOCK + SPR_SOLDIER + (((soldier_facing + 1) >> 1) & 7) * 4 + anim;
    SLOT_Y[SLOT_SOLDIER] = soldier_y;
    SLOT_XL[SLOT_SOLDIER] = (char)soldier_x;
    SLOT_XH[SLOT_SOLDIER] = soldier_x >> 8;
    SLOT_PTR[SLOT_SOLDIER] = ptr;
    SLOT_COL[SLOT_SOLDIER] = col;
    SLOT_PRI[SLOT_SOLDIER] = soldier_behind;
}
