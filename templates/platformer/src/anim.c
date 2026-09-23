// anim.c: sprite animation from tables (c64-kb sprite_animation_table).
// A sequence is (shape, frames) pairs ending in AN_LOOP n (go to pair n)
// or AN_HOLD (stay on the last pair). Facing is not in the tables: the
// player adds SH_MIRROR to the shape when it faces left.
#include "game.h"

#define AN_LOOP 0xff
#define AN_HOLD 0xfe

const char an_stand[]   = { SH_STAND, 1, AN_HOLD };
const char an_run[]     = { SH_RUN1, 6, SH_STAND, 4, SH_RUN2, 6, SH_STAND, 4, AN_LOOP, 0 };
const char an_jump[]    = { SH_JUMP, 1, AN_HOLD };            // rising
const char an_fall[]    = { SH_FALL, 1, AN_HOLD };            // falling: the stomp box
const char an_hurt[]    = { SH_HURT, 1, AN_HOLD };
const char an_walk[]    = { SH_WALK1, 8, SH_WALK2, 8, AN_LOOP, 0 };
const char an_squash[]  = { SH_SQUASH, 24, AN_HOLD };
const char an_hop_sit[] = { SH_HOP_SIT, 1, AN_HOLD };
const char an_hop_up[]  = { SH_HOP_UP, 1, AN_HOLD };

void anim_set(struct Anim *a, const char *seq)
{
    if (a->seq == seq)
        return;
    a->seq = seq;
    a->pos = 0;
    a->shape = seq[0];
    a->count = seq[1];
}

void anim_step(struct Anim *a)
{
    if (a->count == 0 || --a->count)
        return;                         // held (0), or the pair is not over
    char p = a->pos + 2;
    char op = a->seq[p];
    if (op == AN_LOOP)
        p = a->seq[p + 1] * 2;
    else if (op == AN_HOLD)
    {
        a->count = 0;                   // stays on the last pair
        return;
    }
    a->pos = p;
    a->shape = a->seq[p];
    a->count = a->seq[p + 1];
}

bool anim_done(struct Anim *a)
{
    return a->count == 0;
}
