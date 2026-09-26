// collide.h: who hit whom, once a logic frame, after the objects and the
// weapons moved (main.c play_frame and light_frame; never on the redraw
// frame, which runs no collisions: PLAN.md "Combined budget").
//
//   soldier's bullets  vs KF_SHOOTABLE objects: the object dies (obj_kill),
//                      the bullet is spent, kill_score[kind] is added (BCD),
//                      SFX_KILL. A bullet kills one object.
//   his grenade blast  vs KF_SHOOTABLE objects: every one inside dies, each
//                      scored; tested every blast frame, and a killed object
//                      is dust (no longer shootable), so it dies once
//                      (grenade_lob pitfalls).
//   KF_HURTS objects   (enemies by touch, enemy shots, enemy blasts) vs the
//                      soldier, and an A_DEADLY cell under his body centre:
//                      flow_player_died. Not while he is dead or walking
//                      into the gate (area_end_gate_wave: the hit test is off
//                      for the walk), and never in NO_HARM builds (game.h).
//
// Boxes (per_frame_hitbox, one box per kind): objects.h kind_box, sprite
// pixels of the slot's own registers, so a box is what the last draw showed.
// Each pair is first rejected on Y in sprite-line coordinates (Y + row, one
// byte: every shown slot is at Y 0-187 and a box is at most 21 high), then
// tested with weapons.h box_hit on 16-bit map boxes: the corner form, so a
// box across map x 256 or one left of x 0 tests right. A box under the side
// borders (left of VIC X 24 or right of 343) is skipped.
#ifndef COLLIDE_H
#define COLLIDE_H

#include "game.h"

// The soldier's body box, sprite pixels, inclusive: narrower than his sprite
// (arms and rifle do not count).
#define SB_X0 8
#define SB_X1 15
#define SB_Y0 3
#define SB_Y1 19

void collide_init(void);                // once at boot: the kinds' boxes from objects.h kind_box
void collide(void);                     // one frame, after objects and weapons moved

#if AUTOPILOT
extern unsigned col_kills[4];           // by kind: [K_RIFLE], [K_RUNNER], [K_GRENADIER]
extern unsigned col_blast;              // of those, killed by his grenade's blast
extern char col_killer;                 // the kind that last killed the soldier
extern unsigned col_kill_at[4];         // play frame of the last kill of each kind
extern unsigned col_hits, col_terrain;  // soldier deaths by an object, by terrain
extern unsigned col_deferred;           // passes deferred to the next frame (COLLIDE_LATE)
extern unsigned col_worst;              // most CIA1 timer B cycles of one collide(), wall time: IRQs
                                        // that land inside count (COLLIDE_TIMED builds)
#endif

#pragma compile("collide.c")

#endif
