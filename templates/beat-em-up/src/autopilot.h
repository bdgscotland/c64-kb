// autopilot.h: the joystick for AUTOPILOT builds, a bot that reads the
// game's state (c64-kb headless-verify's synthetic port byte, computed
// instead of scripted: a changed wave or AI still gets played through).
// Active low, as $DC00 reads it. Included by main.c only.
//
// On the title it presses fire. In play it picks the nearest enemy on the
// screen that can be hit, lines up in his lane, closes to punch range and
// attacks in a fixed pattern: punch, punch, punch (the third knocks down),
// kick, jump kick. When the stage is clear it walks right. In stage 2,
// from its first wave until a life is lost, it stands still and takes the
// blows, so the knock-down, the KO and the respawn run.
#define AP_IDLE  0xff
#ifndef AP_GIVE_UP
#define AP_GIVE_UP 0                // 1 (make gameover): never fight; three lives go, GAME OVER shows
#endif

static const char ap_pattern[] = { A_PUNCH, A_PUNCH, A_PUNCH, A_KICK, A_JUMP };
static char ap_move, ap_last;
static bool ap_cross;               // the one cross-lane punch has been thrown
static unsigned ap_frames;

// Which 255 play frames the meter records (-dMETER_WINDOW=n), each from a
// point the run reaches, so every window is 255 play frames of the run:
// 0, the default: from the second stage's lock: the brute in characters,
//    two thugs, the hero's KO (the run's worst window, measured: README.md);
// 1: from the third stage's lock: three thugs, eight sprites in the band;
// 2: from the first stage clear, the walk: every frame scrolls;
// 3: from the first stage's lock: two thugs, then the brute;
// 4: every play frame, for the whole run's worst (main.c, run_worst; the
//    meter itself still records only the first 255).
#ifndef METER_WINDOW
#define METER_WINDOW 0
#endif
static bool ap_recording(void)
{
    switch (METER_WINDOW)
    {
    case 1:  return locks >= 3;
    case 2:  return (events & EV_UNLOCK) != 0;
    case 3:  return locks >= 1;
    case 4:  return true;
    default: return locks >= 2;
    }
}

static bool ap_target_ok(char f)
{
    char m = fmode[f];
    return (m == M_FREE || m == M_ATTACK || m == M_HURT || m == M_JUMP) &&
           fx[f] > camx + 8 && fx[f] < camx + 312;
}

static char ap_nearest(void)
{
    char best = 0;
    unsigned bd = 0xffff;
    for (char f = 1; f < NFIGHT; f++)
    {
        if (!ap_target_ok(f))
            continue;
        int d = (int)fx[f] - (int)fx[0];
        unsigned a = (d < 0 ? -d : d) + (fy[f] > fy[0] ? fy[f] - fy[0] : fy[0] - fy[f]) * 2;
        if (a < bd)
        {
            bd = a;
            best = f;
        }
    }
    return best;
}

static char ap_fight(void)
{
    char out = AP_IDLE;
    if (fmode[0] == M_JUMP)
        return farc[0] == ARC_JUMP + 5 ? AP_IDLE ^ JOY_FIRE : AP_IDLE;   // the kick, early in the arc
    if (fmode[0] != M_FREE)
        return AP_IDLE;
    char t = ap_nearest();
    if (!t)
        return stage_clear ? AP_IDLE ^ JOY_RIGHT : AP_IDLE;
    // Once, the lane gate on purpose: a punch at an enemy 9 to 17 lines
    // away, close enough in x that the boxes touch on the screen. fighter.c
    // must call it a miss (EV_LANE_MISS); the verdict wants that event.
    if (!ap_cross)
    {
        for (char f = 1; f < NFIGHT; f++)
        {
            char d = fy[f] > fy[0] ? fy[f] - fy[0] : fy[0] - fy[f];
            if (ap_target_ok(f) && d > WIN + 2 && d < 3 * WIN)
            {
                int cx = (int)fx[f] - (int)fx[0];
                int acx = cx < 0 ? -cx : cx;
                bool fc = (cx < 0) == (fface[0] == FACE_LEFT);
                if (acx > 16)
                    return AP_IDLE ^ (cx < 0 ? JOY_LEFT : JOY_RIGHT);
                if (acx < 10)
                    return AP_IDLE ^ (cx < 0 ? JOY_RIGHT : JOY_LEFT);
                if (!fc)
                    return AP_IDLE ^ (cx < 0 ? JOY_LEFT : JOY_RIGHT);
                if (!(ap_last & JOY_FIRE))
                    return AP_IDLE;
                ap_cross = true;
                return AP_IDLE ^ JOY_FIRE;
            }
        }
    }
    int dx = (int)fx[t] - (int)fx[0];
    int ady = fy[t] > fy[0] ? fy[t] - fy[0] : fy[0] - fy[t];
    int adx = dx < 0 ? -dx : dx;
    char toward = dx < 0 ? JOY_LEFT : JOY_RIGHT;
    char away = dx < 0 ? JOY_RIGHT : JOY_LEFT;
    bool facing = (dx < 0) == (fface[0] == FACE_LEFT);

    if (ady > 2)
    {
        out ^= fy[t] > fy[0] ? JOY_DOWN : JOY_UP;
        if (adx < 12)
            out ^= away;                    // not in reach while crossing lanes
    }
    else if (adx > 18)
        out ^= toward;
    else if (adx < 8)
        out ^= away;
    else if (!facing)
        out ^= toward;
    else if (ap_last & JOY_FIRE)            // released last frame: press now
    {
        char m = ap_pattern[ap_move];
        ap_move = ap_move + 1 < sizeof(ap_pattern) ? ap_move + 1 : 0;
        out ^= JOY_FIRE;
        if (m == A_KICK)
            out ^= toward;
        else if (m == A_JUMP)
            out ^= JOY_UP ^ toward;
    }
    return out;
}

static char autopilot_port(void)
{
    char out = AP_IDLE;
    ap_frames++;
    if (state == ST_TITLE)
        out = ap_frames == 20 ? AP_IDLE ^ JOY_FIRE : AP_IDLE;
    else if (state == ST_PLAY && !AP_GIVE_UP)
    {
        bool take_blows = stage == 1 && wave >= 1 && !(events & EV_LIFE_LOST);
        if (!take_blows)
            out = ap_fight();
    }
    ap_last = out;
    return out;
}
