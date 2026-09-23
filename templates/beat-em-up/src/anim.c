// anim.c: fighter moves as tables (c64-kb sprite_animation_table). A
// sequence is (pose, frames, hit box) triples, then AN_LOOP n (go to
// triple n), AN_HOLD (stay on the last triple) or AN_END (the move is
// over: anim_done). A hit box other than HB_NONE marks an attack frame;
// only those frames can land (c64-kb per_frame_hitbox, lane_depth_engine's
// active-frame table). Facing is not in the tables: view.c mirrors.
#include "game.h"

#define AN_LOOP 0xff
#define AN_HOLD 0xfe
#define AN_END  0xfd

const char an_stand[] = { P_STAND, 1, HB_NONE, AN_HOLD };
const char an_walk[]  = { P_WALK1, 8, HB_NONE, P_STAND, 4, HB_NONE, P_WALK2, 8, HB_NONE,
                          P_STAND, 4, HB_NONE, AN_LOOP, 0 };
// Punch: 4 frames wind-up, 6 with the fist out (active), 4 back: 14.
const char an_punch[] = { P_WIND, 4, HB_NONE, P_PUNCH, 6, HB_PUNCH, P_WIND, 4, HB_NONE, AN_END };
// Kick: 5 frames chamber, 8 with the leg out (active), 5 back: 18.
const char an_kick[]  = { P_CHAMBER, 5, HB_NONE, P_KICK, 8, HB_KICK, P_CHAMBER, 5, HB_NONE, AN_END };
const char an_jump[]  = { P_JUMP, 1, HB_NONE, AN_HOLD };
const char an_jkick[] = { P_JKICK, 1, HB_JKICK, AN_HOLD };      // active until landing
const char an_hurt[]  = { P_HURT, 12, HB_NONE, AN_END };
const char an_fly[]   = { P_HURT, 1, HB_NONE, AN_HOLD };        // knocked off the feet
const char an_down[]  = { P_DOWN, 1, HB_NONE, AN_HOLD };
const char an_kneel[] = { P_KNEEL, 16, HB_NONE, AN_END };

void anim_start(struct Anim *a, const char *seq)
{
    a->seq = seq;
    a->pos = 0;
    a->count = seq[1];
}

void anim_set(struct Anim *a, const char *seq)
{
    if (a->seq != seq)
        anim_start(a, seq);
}

void anim_step(struct Anim *a)
{
    if (a->count == 0 || --a->count)
        return;                         // held or done (0), or the triple is not over
    char p = a->pos + 3;
    char op = a->seq[p];
    if (op == AN_LOOP)
        p = a->seq[p + 1] * 3;
    else if (op == AN_HOLD || op == AN_END)
    {
        a->count = 0;                   // stays on the last triple
        return;
    }
    a->pos = p;
    a->count = a->seq[p + 1];
}

char anim_pose(const struct Anim *a)
{
    return a->seq[a->pos];
}

char anim_hit(const struct Anim *a)
{
    return a->seq[a->pos + 2];
}

bool anim_done(const struct Anim *a)
{
    return a->count == 0 && a->seq[a->pos + 3] == AN_END;
}
