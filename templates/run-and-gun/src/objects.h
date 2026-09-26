// objects.h: the sprite slot policy (sprite_slot_parking) and the object pool
// for enemies, their shots and grenades (object_pool, wave_director).
//
// Slots: game.h. This file owns SLOT_POOL..SLOT_POOL+N_POOL-1 and gives every
// module the two slot writes. objects.c holds the level's spawn list (one
// event per enemy: map row, X, kind, parameter, rows descending), fired as
// each row reaches the view's top (objects_rows), and three enemy kinds:
//   rifleman   walks toward the soldier, stops 56 pixels above him, turns to
//              face him (8 directions) and fires a slow aimed shot on a timer
//   runner     crosses the screen at 2 pixels a frame and leaves
//   grenadier  stands and lobs a grenade at him on a timer: grenade_lob's
//              enemy form, velocity from the offset / 64, an arc folded into Y,
//              a blast at age 80
// Shots and grenades end on A_BLOCK cells (char_attribute_flags): a shot
// vanishes, a grenade bursts there. Every object keeps map coordinates and is
// drawn at Y = my - scroll_wy + 54, so the ground carries it as the view
// scrolls; a free slot is parked, and a live object above the view's top edge
// is parked too until it comes down into view.
#ifndef OBJECTS_H
#define OBJECTS_H

#include "game.h"

// Every field of a slot, in the same frame (techniques/sprite.md: a slot whose
// Y is copied a frame after its X shows for one frame at the parking Y).
void slot_show(char slot, unsigned x, char y, char ptr, char col, char pri);
void slot_park(char slot);              // blank block, X 356, Y PARK_Y
void slots_park_all(void);

// ---- the pool --------------------------------------------------------------------
// A kind of 0 is a free slot; a slot's index is pool index + SLOT_POOL.
#define OBJ_FREE    0
#define K_RIFLE     1                   // enemies: shootable, hurt by touch
#define K_RUNNER    2
#define K_GRENADIER 3
#define K_SHOT      4                   // an enemy bullet: hurts
#define K_GRENADE   5                   // an enemy grenade in flight: harmless (Commando's rule)
#define K_BLAST     6                   // its blast, 20 frames: hurts
#define K_DOWN      7                   // a killed enemy's dust, 24 frames: harmless
#define N_KINDS     8

extern char obj_kind[N_POOL];
extern int obj_x[N_POOL];               // sprite X, pixels
extern int obj_y[N_POOL];               // map y of sprite row 0, pixels

char obj_alloc(char kind);              // a pool index, or 0xff when full
void obj_free(char i);                  // parks its slot

// ---- what the collision module needs ----------------------------------------------
// Boxes are sprite pixels from the slot's own registers (SLOT_XL/XH, SLOT_Y):
// an object in slot s covers X + box[0] .. X + box[1] and sprite row box[2] ..
// box[3] (line Y + 1 + row), inclusive. A slot whose Y is PARK_Y is not on
// screen: skip it. A box left of VIC X 24 or right of 343 is under a border
// (a runner entering or leaving; pitfall sprite_x_range_hidden_and_seam):
// skip it too. kind_flags says what each kind does.
#define KF_SHOOTABLE 0x01               // dies to the soldier's bullets and grenade blast
#define KF_HURTS     0x02               // kills the soldier by touch
extern const char kind_box[N_KINDS][4];
extern const char kind_flags[N_KINDS];
char obj_kill(char slot);               // slot 5-15: a KF_SHOOTABLE object turns to dust and
                                        // is freed 24 frames later; returns its kind, or 0 if
                                        // the slot held nothing killable (the caller scores)

// ---- once a frame (main.c play_frame) -----------------------------------------------
void objects_reset(void);               // all free; the spawn cursor at the level start, then
                                        // objects_rows(scroll_top): the events already in view
                                        // are spawned (checkpoint_respawn's pre-spawn)
void objects_rows(char top);            // the view's top map row changed: fire due spawns
char objects_spawn(char kind, char x2, char row, char param);
                                        // one enemy outside the spawn list (the gate wave,
                                        // area.c): feet on map row `row`, sprite X x2 * 2;
                                        // the pool index, or 0xff when the pool is full
char objects_alive(void);               // enemies alive (riflemen, runners, grenadiers), recounted
                                        // from the pool (area_end_gate_wave's `alive`)
char objects_free(void);                // free pool slots
char objects_count(char *free);         // both in one pass: enemies alive, *free the free slots
extern char objects_on_time;            // main.c: 1 when this frame's logic began on time (the
                                        // deadline, OBJ_LATE, only acts then)
void objects_update(void);              // one frame: half the pool thinks (moves, fires, animates)
                                        // and writes its slots, the other half's Y follows the
                                        // ground; cull what left the view
void objects_draw(void);                // empty: objects_update, obj_kill and obj_free write the
                                        // slots (kept so main.c's order stays as documented)
void objects_hold(void);                // the redraw frame and the frame after it, instead of
                                        // objects_update: nothing thinks, every shown slot
                                        // follows the ground (main.c sorts and commits)

#if AUTOPILOT
// Test counters (the verdict of make enemies prints them).
extern unsigned ost_spawned, ost_at_row, ost_lost, ost_shots, ost_nades, ost_wall, ost_nwall;
extern unsigned ost_park_bad, ost_shown_bad, ost_lag_bad, ost_fixes, ost_lag_skip, ost_frames;
extern char ost_peak;
extern unsigned ost_skipped;            // thinking ticks skipped for time (OBJ_LATE)
void objects_audit(void);               // after each commit: free slots parked, the multiplexer
                                        // shows every slot above its cut, shown slots on their cells
#endif

#pragma compile("objects.c")

#endif
