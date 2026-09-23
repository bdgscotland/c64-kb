// level.c: decode a cave from its RLE row streams (tools/gen.py packs them).
#include "level.h"
#include "cave.h"
#include <c64/cia.h>

#include "gen_caves.h"

char level_count = CAVE_COUNT;
unsigned level_cycles;
bool level_ok = true;

// The level-rle-decoder recipe's C decoder with the row loop folded in.
// Returns the number of cells written, which must be CW * CH.
static unsigned rle_decode(const char *src, char *dst)
{
    unsigned n = 0;
    for (char y = 0; y < CH; y++)
    {
        for (;;)
        {
            char c = *src++;
            if (c == 0)
                break;
            if (c & 0x80)
            {
                char v = *src++;
                c &= 0x7f;
                for (char k = 0; k < c; k++)
                    dst[n++] = v;
            }
            else
            {
                for (char k = 0; k < c; k++)
                    dst[n++] = *src++;
            }
        }
    }
    return n;
}

void level_load(char index)
{
    const CaveInfo *ci = cave_info + index;
    // CIA1 timer B times the decode. The KERNAL IRQ is off while the game
    // runs, so nothing else uses the timer here.
    cia1.crb = 0x00;
    cia1.tb = 0xffff;
    char flags = cia1.icr;                          // reading clears a stale underflow
    cia1.crb = 0x11;                                // force load, start, count phi2
    unsigned n = rle_decode(ci->rle, cave);
    cia1.crb = 0x00;                                // stop before reading
    level_cycles = 0xffff - cia1.tb;
    flags = cia1.icr;
    if (flags & 0x02)
        level_cycles = 0xffff;                      // timer B passed zero: more than 65,535
    if (n != CW * CH || cave_fold(0) != ci->fold)
        level_ok = false;
    cave_start(ci->need, ci->time);
}

const char *level_name(char index)
{
    return cave_info[index].name;
}
