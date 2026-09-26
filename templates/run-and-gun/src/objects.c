// objects.c: see objects.h. The pool is empty in this slice; the enemies module
// adds the spawn list (wave_director, keyed to map rows), the enemy kinds and
// their movement here.
#include "objects.h"
#include "scroll.h"

char obj_kind[N_POOL];

void slot_show(char slot, unsigned x, char y, char ptr, char col, char pri)
{
    SLOT_XL[slot] = (char)x;
    SLOT_XH[slot] = x >> 8;
    SLOT_PTR[slot] = ptr;
    SLOT_COL[slot] = col;
    SLOT_PRI[slot] = pri;
    SLOT_Y[slot] = y;
}

void slot_park(char slot)
{
    slot_show(slot, PARK_X, PARK_Y, SPR_BLOCK + SPR_BLANK, 0, 0);
}

void slots_park_all(void)
{
    for (char s = 0; s < N_SLOTS; s++)
        slot_park(s);
}

char obj_alloc(char kind)
{
    for (char i = 0; i < N_POOL; i++)
        if (obj_kind[i] == OBJ_FREE) {
            obj_kind[i] = kind;
            return i;
        }
    return 0xff;
}

void obj_free(char i)
{
    obj_kind[i] = OBJ_FREE;
    slot_park(SLOT_POOL + i);
}

void objects_reset(void)
{
    for (char i = 0; i < N_POOL; i++)
        obj_free(i);
}

void objects_rows(char top)
{
}

void objects_update(void)
{
}

void objects_draw(void)
{
}

void objects_scroll(void)
{
}
