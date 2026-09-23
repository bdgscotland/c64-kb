// fighter.c: what every fighter shares, player or enemy. A fighter is an
// origin (foot column fx, ground line fy, height fh), a mode, and an
// animation; view.c turns the pose into two sprites. Hits follow c64-kb
// lane_depth_engine: the ground lines within WIN first (one byte compare,
// fails for most pairs), then the attack frame's hit box against the
// target's hurt box (per_frame_hitbox), with x mirrored by facing.
#include "game.h"

char fmode[NFIGHT], fkind[NFIGHT], fface[NFIGHT], fhp[NFIGHT], ftimer[NFIGHT];
unsigned fx[NFIGHT];
char fy[NFIGHT], fh[NFIGHT], farc[NFIGHT];
signed char fvx[NFIGHT];
char fcombo[NFIGHT];
bool flanded[NFIGHT];
struct Anim fanim[NFIGHT];
char finvuln[NFIGHT];
static char fstep[NFIGHT];          // walk frames, for the half-speed depth move
static bool fjkicked[NFIGHT];       // this jump has already kicked

// Heights by frame (jump_arc_table): a jump from ARC_JUMP, 24 frames, 18
// pixels at the top; a knock-down flight from ARC_FLY, 12 frames. $FF ends
// an arc: the fighter is on the ground again. 18 is the most a top part
// may rise: from ground line 150 its first line is 91, after the fighter
// band's IRQ at line 76 has finished (engine.asm).
const char arc[] = {
    0, 3, 6, 8, 10, 12, 14, 15, 16, 17, 18, 18, 18, 18, 17, 16, 15, 14, 12, 10, 8, 6, 3, 0xff,
    0, 0,
    0, 3, 5, 7, 8, 9, 9, 8, 7, 5, 3, 0xff,
};

// Damage by hit box, and the knock-down rule: a kick, a jump kick, the third
// punch in a row, or the last hit point.
static const char damage[HB_COUNT] = { 0, 2, 3, 4 };

void fighter_spawn(char f, char kind, unsigned x, char y, char face)
{
    fkind[f] = kind;
    fx[f] = x;
    fy[f] = y;
    fh[f] = 0;
    fface[f] = face;
    fmode[f] = M_FREE;
    fhp[f] = kind == K_HERO ? 24 : kind == K_THUG ? 8 : 12;
    fcombo[f] = 0;
    finvuln[f] = 0;
    flanded[f] = false;
    anim_start(&fanim[f], an_stand);
}

bool fighter_can_act(char f)
{
    return fmode[f] == M_FREE;
}

// A step in x (a pixel) and in depth (a line every other step): the depth
// move is slower, as a street seen from the side is foreshortened.
void fighter_walk(char f, signed char dx, signed char dy)
{
    if (fmode[f] != M_FREE)
        return;
    if (dx || dy)
    {
        fx[f] += dx;
        if (dx)
            fface[f] = dx < 0 ? FACE_LEFT : FACE_RIGHT;
        if (dy && (++fstep[f] & 1))
        {
            char y = fy[f] + dy;
            if (y >= PLANE_TOP && y <= PLANE_BOT)
            {
                fy[f] = y;
                events |= EV_DEPTH;
            }
        }
        anim_set(&fanim[f], an_walk);
    }
    else
        anim_set(&fanim[f], an_stand);
}

void fighter_attack(char f, char move)
{
    if (fmode[f] == M_JUMP)
    {
        if (!fjkicked[f])                   // one kick a jump
        {
            fjkicked[f] = true;
            flanded[f] = false;
            anim_start(&fanim[f], an_jkick);
            sfx_play(SFX_SWING);
        }
        return;
    }
    if (fmode[f] != M_FREE)
        return;
    flanded[f] = false;
    if (move == A_JUMP)
    {
        fmode[f] = M_JUMP;
        farc[f] = ARC_JUMP;
        fjkicked[f] = false;
        anim_start(&fanim[f], an_jump);
        sfx_play(SFX_JUMP);
        return;
    }
    fmode[f] = M_ATTACK;
    anim_start(&fanim[f], move == A_PUNCH ? an_punch : an_kick);
    sfx_play(SFX_SWING);
}

// Keep a fighter on the screen while he flies or is pushed.
static void keep_on_screen(char f)
{
    if (fx[f] < camx + 12)
        fx[f] = camx + 12;
    else if (fx[f] > camx + 300)
        fx[f] = camx + 300;
}

// One step along an arc; true when it has landed.
static bool arc_step(char f)
{
    char h = arc[++farc[f]];
    if (h == 0xff)
    {
        fh[f] = 0;
        return true;
    }
    fh[f] = h;
    fx[f] += fvx[f];
    return false;
}

static void step_one(char f)
{
    anim_step(&fanim[f]);
    if (finvuln[f])
        finvuln[f]--;
    switch (fmode[f])
    {
    case M_ATTACK:
        if (anim_done(&fanim[f]))
        {
            fmode[f] = M_FREE;
            anim_start(&fanim[f], an_stand);
        }
        break;
    case M_JUMP:
        if (arc_step(f))
        {
            fmode[f] = M_FREE;
            anim_start(&fanim[f], an_stand);
        }
        break;
    case M_HURT:
        if (ftimer[f])
        {
            ftimer[f]--;
            fx[f] += fvx[f];
            keep_on_screen(f);
        }
        if (anim_done(&fanim[f]))
        {
            fmode[f] = M_FREE;
            anim_start(&fanim[f], an_stand);
        }
        break;
    case M_FLY:
        if (arc_step(f))
        {
            anim_start(&fanim[f], an_down);
            if (fhp[f] == 0)
            {
                fmode[f] = M_KO;
                ftimer[f] = 60;
                sfx_play(SFX_KO);
            }
            else
            {
                fmode[f] = M_DOWN;
                ftimer[f] = 40;
            }
        }
        keep_on_screen(f);
        break;
    case M_DOWN:
        if (--ftimer[f] == 0)
        {
            fmode[f] = M_KNEEL;
            anim_start(&fanim[f], an_kneel);
        }
        break;
    case M_KNEEL:
        if (anim_done(&fanim[f]))
        {
            fmode[f] = M_FREE;
            anim_start(&fanim[f], an_stand);
            if (f)
                events |= EV_GETUP;
        }
        break;
    case M_KO:
        if (--ftimer[f] == 0)
        {
            if (f)
                enemy_ko(f);
            else
                hero_hurt();
        }
        break;
    }
}

void fighters_step(void)
{
    for (char f = 0; f < NFIGHT; f++)
        if (fmode[f] != M_OFF)
            step_one(f);
}

// A box in world x for fighter f facing his way: [*l, *r].
static void box_x(char f, const struct Box *b, int *l, int *r)
{
    int x = fx[f];
    if (fface[f] == FACE_RIGHT)
    {
        *l = x + b->x0;
        *r = x + b->x1;
    }
    else
    {
        *l = x - b->x1;
        *r = x - b->x0;
    }
}

static bool can_be_hit(char t)
{
    char m = fmode[t];
    return (m == M_FREE || m == M_ATTACK || m == M_JUMP || m == M_HURT) && !finvuln[t];
}

static void land_hit(char a, char t, char hb)
{
    char d = damage[hb];
    fhp[t] = fhp[t] > d ? fhp[t] - d : 0;
    bool knock = hb != HB_PUNCH || ++fcombo[t] >= 3 || fhp[t] == 0 || fh[t] > 0;
    fface[t] = fx[a] < fx[t] ? FACE_LEFT : FACE_RIGHT;          // turn to the blow
    signed char away = fx[a] < fx[t] ? 1 : -1;
    if (a == 0)
    {
        if (hb == HB_PUNCH)
        {
            hits_punch++;
            events |= EV_PUNCH_HIT;
            score_add(0, FORCE_FAULT ? 2 : 1);                 // FORCE_FAULT: a punch scores 20
        }
        else if (hb == HB_KICK)
        {
            hits_kick++;
            events |= EV_KICK_HIT;
            score_add(0, 2);
        }
        else
        {
            hits_jkick++;
            events |= EV_JKICK_HIT;
            score_add(0, 3);
        }
        face_enemy = t;
        ai_state[t] = AI_RETREAT;           // a hit enemy backs off once he is up
        ai_timer[t] = 20;
    }
    else
        events |= EV_HERO_HIT;
    hud_dirty = true;
    if (knock)
    {
        fcombo[t] = 0;
        fmode[t] = M_FLY;
        farc[t] = ARC_FLY;
        fvx[t] = away * 2;
        anim_start(&fanim[t], an_fly);
        sfx_play(SFX_DOWN);
        events |= t ? EV_KNOCKDOWN : EV_HERO_DOWN;
    }
    else
    {
        fmode[t] = M_HURT;
        ftimer[t] = 4;                      // pushed a pixel a frame for 4 frames
        fvx[t] = away;
        anim_start(&fanim[t], an_hurt);
        sfx_play(SFX_HIT);
    }
}

// Every attacker on an active frame against the other side: the hero
// against the enemies, an enemy against the hero. One hit an attack.
void hits_resolve(void)
{
    for (char a = 0; a < NFIGHT; a++)
    {
        char m = fmode[a];
        if ((m != M_ATTACK && m != M_JUMP) || flanded[a])
            continue;
        char hb = anim_hit(&fanim[a]);
        if (hb == HB_NONE)
            continue;
        const struct Box *h = &hit_box[hb];
        int hl, hr;
        box_x(a, h, &hl, &hr);
        char hy0 = fh[a] + h->y0, hy1 = fh[a] + h->y1;
        char t0 = a ? 0 : 1, t1 = a ? 1 : NFIGHT;
        for (char t = t0; t < t1; t++)
        {
            if (!can_be_hit(t))
                continue;
            char dy = fy[a] > fy[t] ? fy[a] - fy[t] : fy[t] - fy[a];
            if (dy > WIN)
                continue;                   // another lane
            const struct Box *u = &hurt_box[anim_pose(&fanim[t])];
            if (u->y1 == 0)
                continue;
            int ul, ur;
            box_x(t, u, &ul, &ur);
            char uy0 = fh[t] + u->y0, uy1 = fh[t] + u->y1;
            if (hl <= ur && ul <= hr && hy0 <= uy1 && uy0 <= hy1)
            {
                land_hit(a, t, hb);
                flanded[a] = true;
                break;
            }
        }
    }
}

// The joystick: left and right walk, up and down change lane. Fire alone
// punches; fire with left or right kicks that way; fire with up jumps
// (with left or right, forward); fire in the air kicks.
void player_control(char joy, char pressed)
{
    signed char dx = !(joy & JOY_RIGHT) ? 1 : !(joy & JOY_LEFT) ? -1 : 0;
    signed char dy = !(joy & JOY_DOWN) ? 1 : !(joy & JOY_UP) ? -1 : 0;
    if (pressed & JOY_FIRE)
    {
        if (fmode[0] == M_JUMP)
            fighter_attack(0, A_KICK);
        else if (fmode[0] == M_FREE)
        {
            fcombo[0] = 0;
            if (dy < 0)
            {
                fvx[0] = dx;
                fighter_attack(0, A_JUMP);
            }
            else if (dx)
            {
                fface[0] = dx < 0 ? FACE_LEFT : FACE_RIGHT;
                fighter_attack(0, A_KICK);
            }
            else
                fighter_attack(0, A_PUNCH);
        }
    }
    else
        fighter_walk(0, dx, dy);
    if (fx[0] < camx + 16)                  // the hero stays on the screen
        fx[0] = camx + 16;
    else if (fx[0] > camx + 296)
        fx[0] = camx + 296;
}
