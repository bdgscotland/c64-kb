// waves.h: enemies in a fixed pool, attack waves keyed to scroll distance,
// and the path bytecode each enemy runs (wave_director, object_pool).
#ifndef WAVES_H
#define WAVES_H

#include "game.h"

#define NE 12                   // enemy slots: actors 1-12 of the multiplexer

enum { E_FREE, E_FLYING, E_BOOM };

#define e_state ((char *)ASM_EN_STATE)  // E_*; step.asm reads it

// An enemy's position, sprite and colour live in the multiplexer's actor
// table, as actor e + 1: the kernel sorts them where waves.c writes them,
// with no copy. A free enemy's Y is OFF_Y, which the multiplexer skips.
#define e_hx     (ACT_HX + 1)   // half X
#define e_y      (ACT_Y + 1)    // sprite Y
#define e_ptr    (ACT_PTR + 1)  // sprite block: SPR_BLOCK + frame (display.h F_*)
#define e_colour (ACT_COL + 1)
extern char waves_started;      // triggers since waves_reset (for the verdict)
extern char kills_by_type[3];   // enemies shot, by type: dart, saucer, bug

void waves_reset(void);
void waves_update(char row);           // map row now showing: director, spawner, paths, explosions
void enemy_explode(char e);            // shot or rammed: explode, then free
char enemy_points(char e);             // score, in tens of points
unsigned waves_due(unsigned pos);      // wave records whose position pos has reached
void on_enemy_fire(char e);            // a path said FIRE; main.c decides what that does

#pragma compile("waves.c")

#endif
