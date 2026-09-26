// objects.h: the sprite slot policy (sprite_slot_parking) and the object pool
// for enemies, their shots and explosions (object_pool, wave_director).
//
// Slots: game.h. This file owns SLOT_POOL..SLOT_POOL+N_POOL-1 and gives every
// module the two slot writes. The enemies module fills in objects.c: a spawn
// list sorted by map row, fired when the view's top row reaches it
// (objects_rows), each enemy kept in map coordinates and drawn with
// map_to_sprite_y. In this slice the pool is empty: every pool slot is parked.
#ifndef OBJECTS_H
#define OBJECTS_H

#include "game.h"

// Every field of a slot, in the same frame (techniques/sprite.md: a slot whose
// Y is copied a frame after its X shows for one frame at the parking Y).
void slot_show(char slot, unsigned x, char y, char ptr, char col, char pri);
void slot_park(char slot);              // blank block, X 356, Y PARK_Y
void slots_park_all(void);

// The pool. A kind of 0 is a free slot; a slot's index is pool index + SLOT_POOL.
#define OBJ_FREE 0
extern char obj_kind[N_POOL];
char obj_alloc(char kind);              // a pool index, or 0xff when full
void obj_free(char i);                  // parks its slot

void objects_reset(void);               // all free, spawn cursor at the level start
void objects_rows(char top);            // the view's top map row changed: fire due spawns
void objects_update(void);              // one frame: move, animate, cull what left the view
void objects_draw(void);                // write every live object's slot
void objects_scroll(void);              // the frame after a redraw (no logic runs): keep
                                        // objects on their map cells if that fits

#pragma compile("objects.c")

#endif
