// flow.h: the game's rules outside the actors: score, lives, grenades, and
// how a game ends. The front end (title, attract, game over, name entry,
// high-score table) is front.h; main.c's loop runs one state a frame
// (game_state_machine) and enters the state a module asks for in state_next.
//
// Hooks for the next wave (they do the minimum now):
//   flow_player_died   collide.c calls it when the soldier is hit. Now: one
//                      life off; at none left, game over. Next: death and
//                      checkpoint_respawn (recipe kickassembler/checkpoint-
//                      respawn): restart at the nearest checkpoint row behind
//                      through scroll_init(row, 0), objects_reset,
//                      objects_rows; grenades topped up.
//   flow_area_cleared  the gate reached. Now: the game ends (game over, the
//                      score filed). Next: area_end_gate_wave (recipe
//                      kickassembler/area-end-gate-wave): when scroll_can_step()
//                      goes 0 the counted last wave comes out; when it is
//                      cleared a script walks the soldier into the gate
//                      (G_GATE, map rows 1-2, columns 18-21), then the next area.
#ifndef FLOW_H
#define FLOW_H

#include "game.h"

#define START_LIVES    3
#define START_GRENADES 5

void flow_new_game(void);               // score 0, lives, grenades
void flow_frame(void);                  // one play frame, after collide(): the panel's changed fields
void flow_add_score(unsigned bcd);      // add 0-9999 points, BCD ($0250 is 250); saturates at 999999
void flow_player_died(void);            // hook: a life off; game over at none
void flow_area_cleared(void);           // hook: the game ends

#pragma compile("flow.c")

#endif
