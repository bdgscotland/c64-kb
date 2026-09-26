// front.h: the front end (front_end_and_attract) as states of main.c's one
// state machine (game_state_machine): the title, the high-score table, the
// attract demo, game over and name entry. Each has an entry routine
// (front_enter) that puts the screen, the slots and YSCROLL in its shape
// before its first frame, and a per-frame routine (front_frame) that may ask
// for the next state in state_next.
//
//   state      entered from                 leaves to
//   ST_TITLE   boot, table, demo, game over  play (fire), table (idle)
//   ST_TABLE   title (idle), entry           demo (idle, from title), title (idle,
//                                            from entry), play (fire)
//   ST_PLAY    title, table (fire); demo     game over (flow.c); demo: title
//   ST_OVER    play (no lives, gate)        entry (score ranks), title
//   ST_ENTRY   game over                    table (three letters, or idle)
//
// The demo is ST_PLAY with demo = 1: the game itself, fed a recorded stick
// instead of the port (attract_mode_input_replay); a real fire press or the
// recording's end returns to the title, and nothing is scored.
#ifndef FRONT_H
#define FRONT_H

#include "game.h"

// Frames, the same on PAL and NTSC (so NTSC's are a sixth shorter in seconds).
#define TITLE_IDLE   500                // title to table
#define TABLE_IDLE   400                // table to demo or title
#define OVER_FRAMES  150                // game over's screen; fire leaves it after OVER_MIN
#define OVER_MIN     50
#define ENTRY_IDLE   1000               // name entry closes after this long untouched
#define REPEAT_DELAY 16                 // the letter wheel's auto-repeat (joystick_autorepeat)
#define REPEAT_RATE  5

void front_init(void);                  // once at boot: the table seeded
void front_enter(char st);              // entry routine of a front-end state
void front_frame(char joy);             // one frame of it; joy is $DC00's byte, active low
char front_play_joy(char joy);          // ST_PLAY's stick: joy, or the demo's recording
void front_play_begun(void);            // after main.c's play_enter

#if AUTOPILOT
// CIA1 timer B, wall time: interrupts that land inside are counted. The
// redraw uses the same timer (main.c do_redraw), never at the same time.
inline void cyc_start(void) { cia1.crb = 0x00; cia1.tb = 0xffff; cia1.crb = 0x11; }
inline unsigned cyc_stop(void) { cia1.crb = 0x00; return 0xffff - cia1.tb; }
#endif

#if AUTOPILOT && defined(FRONTEND)
// make frontend's verdict (main.c): the states entered, in order, as letters
// (T title, P play, D demo, O over, E entry, H table), the frame each began,
// what the panel showed as game over began, and the costs.
#define TRAIL_MAX 12
extern char fe_trail[TRAIL_MAX + 1], fe_trail_len;
extern unsigned fe_trail_at[TRAIL_MAX];
extern char fe_over_panel[7];           // score digits and the lives digit, from screen RAM
extern char fe_rank;
extern unsigned fe_frame_max, fe_enter_max, fe_hs_cyc, fe_flow_max;
#endif

#pragma compile("front.c")

#endif
