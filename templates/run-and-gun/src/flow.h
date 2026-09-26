// flow.h: the game's states beyond the slice. A stub in this slice.
// The flow module fills in flow.c and the ST_ states in main.c:
//   title, game over and a high score;
//   death and checkpoint_respawn (recipe kickassembler/checkpoint-respawn):
//     restart at the nearest checkpoint row behind, pool cleared, visible
//     spawns re-fired, grenades topped up; the redraw at the restart row is
//     scroll_init's with another top row;
//   area_end_gate_wave (recipe kickassembler/area-end-gate-wave): when
//     scroll_can_step() goes 0 the counted last wave comes out; when it is
//     cleared a script walks the soldier into the gate (G_GATE, map rows 1-2,
//     columns 18-21).
#ifndef FLOW_H
#define FLOW_H

#include "game.h"

#define START_LIVES    3
#define START_GRENADES 5

void flow_new_game(void);               // score, lives, grenades
void flow_frame(void);                  // one play frame, after collide()

#pragma compile("flow.c")

#endif
