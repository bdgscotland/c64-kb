// collide.h: boxes between the soldier, his shots and grenade blasts, and the
// pool's objects. A stub in this slice. The collision module fills in
// collide.c with per_frame_hitbox-style boxes in map or screen coordinates;
// scenery collisions are char_attribute_flags (scroll.h attr_at).
#ifndef COLLIDE_H
#define COLLIDE_H

#include "game.h"

void collide(void);                     // one frame, after objects and weapons moved

#pragma compile("collide.c")

#endif
