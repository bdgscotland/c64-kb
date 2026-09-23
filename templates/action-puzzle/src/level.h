// level.h: the caves, stored as RLE row streams and decoded between caves
// (c64-kb technique tile_map_render, the decode half; the format and the
// decoder are oscar64/level-rle-decoder's).
#ifndef LEVEL_H
#define LEVEL_H

typedef struct {
    const char *rle;            // 22 row streams: 0x80+n then a byte = n copies; 1..127 = that many literals; 0 = end of row
    const char *name;           // 16 screen codes
    char need;                  // gems that open the exit
    char time;                  // time counter at the start
    unsigned fold;              // tools/gen.py's fold of the decoded cave
} CaveInfo;

extern char level_count;
extern unsigned level_cycles;   // CIA1 timer B: cycles the last decode took (65,535 = more)
extern bool level_ok;           // false once any decode missed its fold or length

void level_load(char index);    // decode cave `index` into cave[], then cave_start
const char *level_name(char index);

#pragma compile("level.c")

#endif
