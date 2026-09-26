// flow.c: see flow.h. Stub: a new game's numbers only.
#include "flow.h"

unsigned long score;
char lives, grenades;

void flow_new_game(void)
{
    score = 0;
    lives = START_LIVES;
    grenades = START_GRENADES;
}

void flow_frame(void)
{
}
