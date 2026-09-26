// weapons.c: see weapons.h. Stub: the slots stay parked.
#include "weapons.h"
#include "objects.h"

void weapons_reset(void)
{
    for (char s = 0; s < N_BULLETS; s++)
        slot_park(SLOT_BULLET + s);
    slot_park(SLOT_GRENADE);
}

void weapons_update(char joy)
{
}
