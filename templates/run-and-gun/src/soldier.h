// soldier.h: the player on foot. Eight-way movement at one pixel a frame,
// facing_turn_step (a 16-step facing that turns one step a frame toward the
// stick), char_attribute_flags blocking (trees, rocks, walls stop him) and
// draw-behind (the canopy covers him), and the threshold: pushing up at
// SOLDIER_THRESH scrolls the map instead of moving him (threshold_scroll_v).
#ifndef SOLDIER_H
#define SOLDIER_H

#include "game.h"

#define SOLDIER_THRESH  110     // sprite Y: at or above it, up scrolls the map
#define SOLDIER_TOP_Y   52      // highest sprite Y once the map has ended
#define SOLDIER_MAX_Y   MAX_SY  // lowest sprite Y (last line 208, over the band IRQ)
#define SOLDIER_MIN_X   24
#define SOLDIER_MAX_X   320
#define SOLDIER_COLOUR  VCOL_WHITE

// The feet box, in sprite pixels: what blocks is tested here (map cells under
// its edges). The body centre decides the priority bit.
#define FEET_X0 7
#define FEET_X1 16
#define FEET_Y0 14
#define FEET_Y1 20
#define BODY_CX 12
#define BODY_CY 10

extern unsigned soldier_x;      // sprite X, 9 bits
extern char soldier_y;          // sprite Y
extern char soldier_facing;     // 0-15, 22.5 degrees a step: 0 up, 4 right, 8 down, 12 left
extern char soldier_behind;     // 1: the body centre is on an A_BEHIND cell
extern char soldier_stepped;    // 1: this frame's up push scrolled the map
extern unsigned soldier_blocked;   // frames a move was refused by an A_BLOCK cell (AUTOPILOT verdict)
extern unsigned soldier_behind_frames;

void soldier_reset(void);               // at the start position, facing up
void soldier_update(char joy);          // one frame: joy is $DC00, active low
char soldier_repeat_step(void);         // the frame after a redraw: repeat last frame's scroll step if still free
void soldier_draw(void);                // writes SLOT_SOLDIER, every field

#pragma compile("soldier.c")

#endif
