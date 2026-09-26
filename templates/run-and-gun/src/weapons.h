// weapons.h: the soldier's gun and grenades, and the hit boxes the collision
// module tests them with.
//
// Gun (facing_turn_step, char_attribute_flags "Projectiles"): one shot per
// press of fire (joy bit 4 goes low; holding it fires nothing more). Up to
// N_BULLETS in SLOT_BULLET..+2; a press with all three flying is lost. A
// shot leaves the body centre along soldier_facing, taken from a 16-entry
// velocity table at the press, BULLET_SPEED4 quarter pixels a frame, and
// lives BULLET_LIFE frames. It ends early on an A_BLOCK cell (trees, rocks,
// sandbags, outside the map) or when it leaves the playfield; under an
// A_BEHIND cell it goes behind the canopy.
//
// Grenade (grenade_lob): one throw per press of JOY_THROW (SPACE or port-1
// fire; main.c folds it into joy bit 5) when `grenades` > 0 and SLOT_GRENADE
// is free. It flies straight up the map GREN_VY pixels a frame for
// GREN_FLIGHT frames over everything, drawn small, medium, large, medium,
// small; then it is a still blast for GREN_BLAST frames. `grenades` counts
// down on the throw and the panel shows it; at 0 a press does nothing.
//
// Coordinates are map pixels (game.h): bullets and the blast stay on the
// ground as the view scrolls. Like every object, they do not move on the
// frame after a redraw (main.c light_frame runs no logic).
#ifndef WEAPONS_H
#define WEAPONS_H

#include "game.h"
#include "gen/weapon_sprites.h" // written by tools/mkweapons.py

#define JOY_THROW      0x20     // joy bit 5, active low: not a $DC00 line (main.c port_read)

#define BULLET_SPEED4  20       // quarter pixels a frame: 5 pixels
#define BULLET_LIFE    20       // frames: a range of 100 pixels
#define BULLET_COLOUR  VCOL_YELLOW
#define GREN_VY        2        // pixels a frame, up the map
#define GREN_FLIGHT    30       // frames: lands 60 pixels above the throw
#define GREN_BLAST     16       // frames the blast stays
#define GREN_L         12       // blast box: -GREN_L < dx <= +GREN_L around the landing point,
#define GREN_M         10       //            -GREN_M < dy <= +GREN_M (24 x 20, the burst's size)
#define GREN_COLOUR    VCOL_LT_GREY

// ---- hit boxes ------------------------------------------------------------------
// A box covers map pixels x..x+w-1, y..y+h-1 (w, h 1-255). The tests are the
// corner form of grenade_lob ("Why it works"): per axis one 16-bit
// subtraction and one unsigned compare, so a box across map x 256 or one
// whose corner is left of x 0 (x wrapped past 65535) tests right. The KB's
// grenade_lob page measures what 8-bit bounds miss there; this never
// splits X into bytes.
typedef struct { unsigned x, y; char w, h; } Box;

// Do a and b share a pixel?
inline char box_hit(const Box *a, const Box *b)
{
    return (unsigned)(b->x - a->x + (b->w - 1)) < (unsigned)(a->w + b->w - 1) &&
           (unsigned)(b->y - a->y + (b->h - 1)) < (unsigned)(a->h + b->h - 1);
}

// Is map pixel (x, y) inside b?
inline char box_has(const Box *b, unsigned x, unsigned y)
{
    return (unsigned)(x - b->x) < b->w && (unsigned)(y - b->y) < b->h;
}

// The blast box around map point (x, y): -GREN_L < dx <= +GREN_L,
// -GREN_M < dy <= +GREN_M. Its corner may wrap below 0; the tests above
// still hold.
void box_blast(Box *b, unsigned x, unsigned y);

// Bullet i (0 to N_BULLETS-1): its 4 x 4 dot. 0 when bullet i is not flying.
char weapons_bullet_box(char i, Box *b);
// A hit: bullet i ends now, its slot parked in the same frame.
void weapons_bullet_spent(char i);
// The blast box while a blast is live (1), else 0. Test it every blast
// frame and mark what dies, so a target dies once (grenade_lob pitfalls).
char weapons_blast_box(Box *b);

void weapons_reset(void);               // nothing flying; fire and throw count as held
void weapons_update(char joy);          // one frame: fire (bit 4), throw (bit 5), move, write slots 1-4

// Counters the checks read (the WEAPONS autopilot build).
extern unsigned shots_fired, shots_lost, throws, throws_empty, throws_busy;

#pragma compile("weapons.c")

#endif
