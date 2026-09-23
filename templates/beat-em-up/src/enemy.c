// enemy.c: the enemies' state machine and the waves that bring them.
//
// The AI after c64-kb lane_pursuit_ai's states (approach, pull alongside,
// attack, back off), on a street instead of a road: an enemy comes in from
// a screen edge, walks to a stand-off point beside the hero in his lane,
// attacks, backs off, and comes again. Two turns at most: an enemy without
// one waits further out, a lane off, so the hero is never boxed in by three
// at once (Double Dragon's crowd rule, written here from the rule, not from
// any game's code).
//
// The waves after c64-kb wave_director: a stage's first wave starts when
// the camera reaches the stage's lock (a scroll position, compared with
// >=); each next wave when the last is beaten; the stage is clear when its
// list ends. The enemies are three slots of the fighter pool (object_pool).
#include "game.h"

char ai_state[NFIGHT], ai_timer[NFIGHT];
static bool ai_turn[NFIGHT];        // holds one of the two turns
static char ai_moves[NFIGHT];       // attacks made: punch, punch, kick, ...
static char turns;
char stage, wave;
bool stage_clear;
static char wave_timer;

#define TURNS     2
#define CLOSE     14                // stand-off with a turn: in punch and kick reach
#define FAR       56                // stand-off while waiting
#define WAIT_LANE 12                // lines off the hero's lane while waiting

// A wave: up to three enemies, each a kind, a side (0 left, 1 right) and a
// ground line. kind 0 ends the list.
struct Spawn { char kind, side, y; };
struct Wave { struct Spawn e[NENEMY]; };

// WAVES-BEGIN
static const struct Wave stage0[] = {
    { { { K_THUG, 1, 170 }, { K_THUG, 0, 192 }, { 0 } } },
    { { { K_BRUTE, 1, 180 }, { 0 } } },
};
static const struct Wave stage1[] = {
    { { { K_THUG, 1, 160 }, { K_BRUTE, 1, 186 }, { K_THUG, 0, 174 } } },
    { { { K_THUG, 1, 190 }, { K_THUG, 0, 164 }, { 0 } } },
};
static const struct Wave stage2[] = {
    { { { K_BRUTE, 1, 172 }, { K_THUG, 0, 160 }, { K_THUG, 1, 196 } } },
    { { { K_BRUTE, 0, 180 }, { K_BRUTE, 1, 164 }, { 0 } } },
};
// WAVES-END
static const struct Wave *const stage_waves[NSTAGE] = { stage0, stage1, stage2 };
static const char stage_count[NSTAGE] = { 2, 2, 2 };

void waves_reset(void)
{
    stage = 0;
    wave = 0;
    stage_clear = false;
    wave_timer = 50;
    turns = 0;
    for (char f = 1; f < NFIGHT; f++)
    {
        fmode[f] = M_OFF;
        ai_turn[f] = false;
    }
}

static bool enemies_left(void)
{
    for (char f = 1; f < NFIGHT; f++)
        if (fmode[f] != M_OFF)
            return true;
    return false;
}

static void spawn_wave(const struct Wave *w)
{
    for (char i = 0; i < NENEMY; i++)
    {
        const struct Spawn *s = &w->e[i];
        if (!s->kind)
            break;
        char f = i + 1;
        // Just off the screen; on the left never below world x 0: the
        // positions are unsigned, and Oscar64 compared an int made from
        // x 65512 (-24) as unsigned, so that enemy walked the wrong way.
        unsigned x = s->side ? camx + 336 : camx >= 24 ? camx - 24 : 0;
        fighter_spawn(f, s->kind, x, s->y, s->side ? FACE_LEFT : FACE_RIGHT);
        ai_state[f] = AI_ENTER;
        ai_timer[f] = 0;
        ai_turn[f] = false;
        ai_moves[f] = f;
    }
}

void waves_update(void)
{
    if (stage_clear)
    {
        // The camera moves on to the next lock; reaching it starts that stage.
        if (stage + 1 < NSTAGE && camx >= stage_lock[stage + 1])
        {
            stage++;
            wave = 0;
            stage_clear = false;
            wave_timer = 30;
            go_sign = false;
            locks++;
            events |= EV_LOCK;
            hud_dirty = true;
        }
        return;
    }
    if (camx < stage_lock[stage] || enemies_left())
        return;
    if (wave_timer)
    {
        wave_timer--;
        return;
    }
    if (wave < stage_count[stage])
    {
        if (stage == 0 && wave == 0)
        {
            locks++;                        // the first lock is the street's start
            events |= EV_LOCK;
        }
        spawn_wave(&stage_waves[stage][wave]);
        wave++;
        wave_timer = 40;
        return;
    }
    stage_clear = true;
    go_sign = stage + 1 < NSTAGE;
    events |= EV_UNLOCK;
}

void enemy_ko(char f)
{
    if (fkind[f] == K_THUG)
    {
        kos_thug++;
        score_add(1, 0);
    }
    else
    {
        kos_brute++;
        score_add(2, 0);
    }
    events |= EV_KO;
    if (ai_turn[f])
        turns--;
    ai_turn[f] = false;
    fmode[f] = M_OFF;
    if (face_enemy == f)
        face_enemy = 0xff;
    hud_dirty = true;
}

static signed char toward(int from, int to)
{
    return from < to - 1 ? 1 : from > to + 1 ? -1 : 0;
}

static void give_turn_back(char f)
{
    if (ai_turn[f])
    {
        ai_turn[f] = false;
        turns--;
    }
}

static void think(char f)
{
    int ex = fx[f], hx = fx[0];
    bool left_of_hero = ex < hx;
    bool hero_up = fmode[0] != M_KO && fmode[0] != M_OFF && !finvuln[0];
    signed char dx = 0, dy = 0;
    if (ai_timer[f])
        ai_timer[f]--;

    switch (ai_state[f])
    {
    case AI_ENTER:
        dx = left_of_hero ? 1 : -1;
        if (ex > (int)camx + 24 && ex < (int)camx + 290)
            ai_state[f] = AI_APPROACH;
        break;
    case AI_APPROACH:
    case AI_WAIT:
        if (!ai_turn[f] && turns < TURNS && hero_up)
        {
            ai_turn[f] = true;
            turns++;
        }
        {
            bool close = ai_turn[f] && hero_up;
            int tx = hx + (left_of_hero ? -(close ? CLOSE : FAR) : (close ? CLOSE : FAR));
            int ty = fy[0];
            if (!close)
                ty += fy[0] < (PLANE_TOP + PLANE_BOT) / 2 ? WAIT_LANE : -WAIT_LANE;
            dx = toward(ex, tx);
            dy = toward(fy[f], ty);
            ai_state[f] = close ? AI_APPROACH : AI_WAIT;
            char ldy = fy[f] > fy[0] ? fy[f] - fy[0] : fy[0] - fy[f];
            if (close && !dx && ldy <= 2 && !ai_timer[f])
            {
                fface[f] = left_of_hero ? FACE_RIGHT : FACE_LEFT;
                fighter_attack(f, (++ai_moves[f] % 3) ? A_PUNCH : A_KICK);
                ai_state[f] = AI_ATTACK;
                return;
            }
        }
        break;
    case AI_ATTACK:
        ai_state[f] = AI_RETREAT;           // the move has finished: fighter_can_act
        ai_timer[f] = 24 + f * 6;
        give_turn_back(f);
        break;
    case AI_RETREAT:
        give_turn_back(f);
        dx = left_of_hero ? -1 : 1;
        if ((dx < 0 && ex < (int)camx + 20) || (dx > 0 && ex > (int)camx + 292))
            dx = 0;
        if (!ai_timer[f])
        {
            ai_state[f] = AI_APPROACH;
            ai_timer[f] = 16;               // a pause before the next attack
        }
        break;
    }
    fighter_walk(f, dx, dy);
    if (ai_state[f] != AI_ENTER)
        fface[f] = left_of_hero ? FACE_RIGHT : FACE_LEFT;   // always facing the hero
}

void enemies_update(void)
{
    for (char f = 1; f < NFIGHT; f++)
    {
        if (fmode[f] == M_OFF)
            continue;
        if (fmode[f] != M_FREE)
        {
            if (fmode[f] != M_ATTACK)
                give_turn_back(f);          // hurt or down: the turn goes to another
            continue;
        }
        think(f);
    }
}
