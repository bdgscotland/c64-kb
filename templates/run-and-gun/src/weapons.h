// weapons.h: the soldier's shots and grenade. A stub in this slice.
// The weapons module fills in weapons.c:
//   bullets: SLOT_BULLET..+N_BULLETS-1, fired along soldier_facing (a 16-entry
//            velocity table, facing_turn_step), stopped by A_BLOCK cells
//            (attr_at, char_attribute_flags "Projectiles")
//   grenade: SLOT_GRENADE, grenade_lob (recipe kickassembler/grenade-lob): a
//            fixed flight straight up the screen, a height animation, then a box
//            blast around the landing point; `grenades` counts down
// Collisions with enemies go through collide.h.
#ifndef WEAPONS_H
#define WEAPONS_H

#include "game.h"

void weapons_reset(void);               // bullets and grenade parked
void weapons_update(char joy);          // one frame: fire (joy bit 4 low) and move

#pragma compile("weapons.c")

#endif
