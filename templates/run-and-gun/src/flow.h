// flow.h: the game's rules outside the actors: score, lives, grenades, and
// how a game ends. The front end (title, attract, game over, name entry,
// high-score table) is front.h; main.c's loop runs one state a frame
// (game_state_machine) and enters the state a module asks for in state_next.
//
// Death and checkpoint_respawn (techniques/logic.md, recipe kickassembler/
// checkpoint-respawn):
//   flow_player_died   collide.c calls it when the soldier is hit or stands on
//                      deadly terrain. The death animation runs DEATH_FRAMES
//                      logic frames (the world keeps moving); then a life is
//                      taken. At none left: game over (the front end). Else a
//                      restart: the view jumps to the nearest checkpoint row at
//                      or behind the view's top (the first entry of the level's
//                      CHECKPOINT_ROWS at or above scroll_top), the pool is
//                      cleared and the spawn list re-spawns the window, the
//                      soldier stands at his start position, grenades are
//                      topped up to START_GRENADES (never lowered), and the
//                      gate phase starts over. Score and lives stay.
//   flow_area_cleared  area.c, after the AREA CLEARED beat: a restart into the
//                      next area at the map's start (area.h).
// A restart runs on its own frame at the start of the next play frame
// (main.c play_frame, flow_restart), as a redraw frame: the view is committed
// at YSCROLL 0 and drawn from RD_FIRST by the redraw, and no other logic runs.
#ifndef FLOW_H
#define FLOW_H

#include "game.h"

#ifndef START_LIVES
#define START_LIVES    3                // make longplay builds with more (-dSTART_LIVES=)
#endif
#define START_GRENADES 5
#define DEATH_FRAMES   64               // logic frames of the death animation (Commando: 80)

enum { DC_HIT = 1, DC_TERRAIN, DC_FORCED }; // why the soldier died
enum { RS_NONE, RS_RESPAWN, RS_AREA };      // flow_restart_due

extern char flow_restart_due;
extern char flow_cause;                 // why the last death happened (DC_*)

void flow_new_game(void);               // score 0, lives, grenades, area 0
void flow_frame(void);                  // one play frame, after collide(): the death's timer, the
                                        // panel's changed fields
void flow_add_score(unsigned bcd);      // add 0-9999 points, BCD ($0250 is 250); saturates at 999999
void flow_player_died(char cause);      // the soldier dies (DC_*); ignored unless he is alive
void flow_area_cleared(void);           // the gate's beat is over: the next area
void flow_restart(void);                // main.c, on the frame after flow_restart_due was set
char flow_checkpoint(char top);         // the restart row for a view whose top row is top

#if AUTOPILOT
#define FL_LOG 4
extern char fl_deaths, fl_cause[FL_LOG], fl_top[FL_LOG], fl_row[FL_LOG], fl_gren[FL_LOG],
    fl_gren_after[FL_LOG], fl_lives[FL_LOG];
extern unsigned fl_die_at[FL_LOG], fl_restart_at[FL_LOG], fl_restart_cyc;
extern char fl_restarts;                // restarts run (respawns and areas)
extern char fl_alive_after[FL_LOG];     // enemies the restart re-spawned from the list
#endif

#pragma compile("flow.c")

#endif
