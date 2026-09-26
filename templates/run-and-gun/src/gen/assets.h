// assets.h: written by tools/mkassets.py. Do not edit; change the tool and re-run it.
#ifndef ASSETS_H
#define ASSETS_H
#define MAP_ROWS     96
#define A_BLOCK      0x01   // attr bit 0: stops a walker
#define A_BEHIND     0x02   // attr bit 1: the sprite goes behind
#define A_DEADLY     0x04   // attr bit 2: kills (reserved)
#define G_FLOOR      64
#define G_CANOPY     72   // 12 codes, 4 x 3
#define G_TRUNK      84
#define G_GATE       108  // the fort's gate opening, 4 x 2, map rows 1-2, columns 18-21
#define START_COL    19   // the soldier's feet at the start, map cells
#define START_ROW    91
#define SPR_SOLDIER  0    // block offset: direction * 4 + walk frame
#define SPR_BLANK    32   // the parking block (all zero)
#define SPR_RIFLE    33   // rifleman: direction (0 up, clockwise) * 2 + step frame
#define SPR_RUNNER   49   // runner: (0 right, 1 left) * 2 + step frame
#define SPR_GREN     53   // grenadier: direction * 2 + (0 carry, 1 throw)
#define SPR_SHOT     69   // enemy bullet, centred on sprite pixel (12, 10)
#define SPR_NADE     70   // enemy grenade: small, middle, large
#define SPR_BLAST    73   // grenade blast, 2 frames
#define SPR_DOWN     75   // a hit enemy's dust
#define SPR_BLOCKS   76
#endif
