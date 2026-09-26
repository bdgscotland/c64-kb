// area.h: the area end (area_end_gate_wave) and the area counter.
//
// When the view reaches the map's top (scroll_can_step() goes 0) the scroll
// stops and a counted wave comes out of the fort's gate: WAVE_N(area)
// soldiers, each free pool slot rolling a seeded 8-bit LFSR every frame and
// spawning when the roll passes WAVE_MASK (the recipe's rule, so a full pool
// slows the wave). When every one has come out and none is alive (`tospawn`
// 0 and objects_alive() 0, recounted from the pool each frame), the stick is
// taken away and the soldier walks to the gate's column, then up into it;
// no hit test runs on him from then on. On arrival: AREA_BONUS points, he is
// gone, "AREA CLEARED" for BEAT_FRAMES frames, then flow_area_cleared() and
// the next area: the map again from its start, in the next area's colours,
// with the enemies' fire periods halved (objects.c place). A death during
// the wave restarts at a checkpoint and the wave comes out again whole
// (Commando resets its count at every respawn).
#ifndef AREA_H
#define AREA_H

#include "game.h"

enum { AP_SCROLL, AP_WAVE, AP_WALK, AP_BEAT };

#define WAVE_BASE    6                  // soldiers in area 0's wave; 2 more an area, to 12
#define WAVE_MASK    0x1f               // a free slot spawns when (roll & mask) == 0: 7 rolls in 255
#define WAVE_SEED    0xa5               // the recipe's LFSR: 8 bits, taps $B8, period 255
#define WAVE_ROW     4                  // spawned with their feet on map row 4, under the gate
#define GATE_X       168                // the walk's target: sprite X (body centre on the gate's middle,
#define GATE_Y       52                 // map x 156), then sprite Y 52 (SOLDIER_TOP_Y), in the opening
#define AREA_BONUS   0x2000             // BCD: 2,000 points on arrival
#define BEAT_FRAMES  100                // the AREA CLEARED beat

extern char area_phase;
extern char wave_tospawn, wave_n;

void area_begin(char n);                // area n: its colours and difficulty; area_restart
void area_clear_beat(void);             // the beat's text cells back to floor, multicolour
void area_restart(void);                // a restart (checkpoint or next area): the scroll phase
char area_has_stick(void);              // 1 during the walk and the beat: no stick, no hit test
void area_frame(void);                  // one play frame (never on the redraw pair: the scroll
                                        // has stopped whenever this does more than one test)

#if AUTOPILOT
extern unsigned ar_wave_at, ar_walk_at, ar_arrive_at, ar_beat_end, ar_spawned, ar_peak_alive;
extern char ar_first_x2[4];
#endif

#pragma compile("area.c")

#endif
