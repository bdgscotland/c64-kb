// hiscore.c: see hiscore.h. The recipe's rank, shift and write, in C.
#include "hiscore.h"
#include <string.h>

char hs_table[HS_TABLEN];

// The default table: original initials, scores 50,000 down to 10,000.
static const char seed[HS_TABLEN] = {
    'F' - 64, 'B' - 64, 'S' - 64, 0x05, 0x00, 0x00,
    'K' - 64, 'B' - 64, 'A' - 64, 0x04, 0x00, 0x00,
    'C' - 64, '6', '4',           0x03, 0x00, 0x00,
    'S' - 64, 'I' - 64, 'D' - 64, 0x02, 0x00, 0x00,
    'V' - 64, 'I' - 64, 'C' - 64, 0x01, 0x00, 0x00,
};

void hs_seed(void)
{
    memcpy(hs_table, seed, HS_TABLEN);
}

// Rank: the first row the new score is strictly higher than. A BCD byte
// orders like its binary value, so a plain compare ranks it; the first byte
// that differs decides. Tie rule (the recipe's): equal on all three bytes is
// not a win, so the new score goes below the row it equals and the holder
// keeps the place.
char hs_rank(const char *bcd)
{
    for (char r = 0; r < HS_ROWS; r++) {
        const char *row = hs_table + r * HS_ROWLEN + 3;
        for (char b = 0; b < 3; b++) {
            if (bcd[b] != row[b]) {
                if (bcd[b] > row[b]) {
#if FORCE_FAULT && defined(FRONTEND)
                    return 0;           // the fault the technique names: every entry into row 0
#else
                    return r;
#endif
                }
                break;
            }
        }
    }
    return HS_ROWS;
}

// Shift from the last row up to the rank, copying the row above down; the
// test is "stop on equal or below", so no rank can run it past the top. The
// last row is never read as a source: that is how it is dropped. Then write.
void hs_place(char rank, const char *bcd, const char *name)
{
    if (rank >= HS_ROWS)
        return;
    for (signed char r = HS_ROWS - 1; r > (signed char)rank; r--)
        memcpy(hs_table + r * HS_ROWLEN, hs_table + (r - 1) * HS_ROWLEN, HS_ROWLEN);
    char *row = hs_table + rank * HS_ROWLEN;
    memcpy(row, name, 3);
    memcpy(row + 3, bcd, 3);
}
