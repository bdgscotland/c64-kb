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
#define SPR_BLOCKS   33
#endif
