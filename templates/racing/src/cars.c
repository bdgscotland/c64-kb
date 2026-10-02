// cars.c: the player's car, the four opponents, contact between them,
// crashes. One step a frame (the game runs 6/5 as fast on NTSC, as
// the other starters do: c64-kb pal_ntsc_tempo_mismatch).
//
// Along the road a car has a position (world units from the stage's start,
// 256 a segment) and a speed (8.8 units a frame). Across it, car_x is 1/16 pixel at
// line 202, 0 on the centre line; the kerbs are at +-W0. The player's throttle, brake
// and steering follow c64-kb vehicle_control (speed from the throttle, a
// surface limit, steering that needs speed); a bend pushes the car outwards
// by its curvature times the speed. Contact follows car_contact_response
// in a reduced form: cars that overlap are pushed apart across the road,
// the one behind loses its speed to the one ahead, and a pair cools for 25
// frames before it counts again. A crash, into the wall past the grass or
// into a car's back much faster than it, stops the car for 1.5 seconds: the
// time comes off the countdown (stage.c).
#include "game.h"

unsigned car_pos[NCARS];                // along the stage, from its start
unsigned car_speed[NCARS];
int      car_x[NCARS];
char     car_colour[NCARS] = { VCOL_WHITE, VCOL_RED, VCOL_YELLOW, VCOL_CYAN, VCOL_PURPLE };
static char     car_frac[NCARS];
static int      car_lane[NCARS];        // where an opponent drives, 1/16 pixel
char     place;
unsigned race_frames;
unsigned bumps, verge_frames, overtakes, crashes;
char     bump_cool;
char     crash_t;
bool     on_verge;
char     finished;

// The grid: the player last, behind car 1 in the left lane; the opponents
// ahead, lanes alternating. Their top speeds are below the player's, the
// farthest the fastest, so the player catches them one at a time.
static const unsigned grid_pos[NCARS] = { 0, 70, 140, 210, 280 };
static const int grid_x[NCARS] = { -48 * 16, -48 * 16, 48 * 16, -48 * 16, 48 * 16 };
static const unsigned opp_max[NCARS] = { 0, 0x0880, 0x0900, 0x0980, 0x09c0 };

#define ACCEL      0x0010
#define OPP_ACCEL  0x000c
#define BRAKE      0x0040
#define COAST      0x0008
#define DRAG       0x0030               // on the grass, over VERGE_MAX
#define STEER      5                    // 1/16 pixel a frame per unit of speed
#define ROAD_EDGE  ((W0 - CAR_HALF) * 16)
#define X_LIMIT    ((W0 + 64) * 16)     // the grass ends here: a wall
#define OVERLAP    (2 * CAR_HALF * 16)  // closer than this across the road: contact
#define CRASH_SPEED   VERGE_MAX         // into the wall at grass speed or more: a crash
#define CRASH_CLOSING 0x0300            // into a car's back this much faster: a crash

// A stage's grid. A new race also clears the race's counts.
void cars_reset(bool race)
{
    for (char c = 0; c < NCARS; c++)
    {
        car_pos[c] = grid_pos[c];
        car_speed[c] = 0;
        car_frac[c] = 0;
        car_x[c] = grid_x[c];
        car_lane[c] = grid_x[c];
    }
    crash_t = 0;
    place = NCARS;
    finished = 0;
    if (!race)
        return;
    race_frames = 0;
    bumps = verge_frames = overtakes = crashes = 0;
    bump_cool = 0;
    on_verge = false;
}

// Car c is ahead of the player.
static bool ahead(char c)
{
    return car_pos[c] > car_pos[0];
}

// Along the road: position += speed, a lap on each wrap.
static void advance(char c)
{
    unsigned t = car_frac[c] + (car_speed[c] & 0xff);
    car_frac[c] = (char)t;
    car_pos[c] += (car_speed[c] >> 8) + (t >> 8);
}

// A crash: stopped for 1.5 seconds, the time lost on the countdown.
static void crash(void)
{
    car_speed[0] = 0;
    crash_t = fps + fps / 2;
    crashes++;
    hud_message("crash", fps + fps / 2);
    sound_bump();
}

static void player(char joy)
{
    if (crash_t)
    {
        crash_t--;
        return;
    }
    unsigned s = car_speed[0];
    unsigned limit = on_verge ? VERGE_MAX : SPEED_MAX;
    if ((joy & (JOY_FIRE | JOY_UP)) != (JOY_FIRE | JOY_UP))     // either pressed (active low)
    {
        if (s < limit)
            s += ACCEL;
    }
    else if (!(joy & JOY_DOWN))
        s = s > BRAKE ? s - BRAKE : 0;
    else
        s = s > COAST ? s - COAST : 0;
    if (s > limit)
        s = s - DRAG > limit ? s - DRAG : limit;
    car_speed[0] = s;

    // steering needs speed; a bend pushes outwards
    char v = s >> 8;
    int x = car_x[0];
    if (!(joy & JOY_LEFT))
        x -= STEER * v;
    else if (!(joy & JOY_RIGHT))
        x += STEER * v;
    // the eased curvature under the car, quarter units (track.asm curvf)
    int k4 = (signed char)B(ASM_CURVF + ((car_pos[0] >> 6) & 255));
    x -= (k4 * v) / 4;
    if (x > X_LIMIT || x < -X_LIMIT)
    {
        x = x > 0 ? X_LIMIT : -X_LIMIT;
        if (s >= CRASH_SPEED)
        {
            car_x[0] = x;
            crash();                    // into the wall beyond the grass
            return;
        }
    }
    car_x[0] = x;
    on_verge = x > ROAD_EDGE || x < -ROAD_EDGE;
    if (on_verge)
        verge_frames++;
}

static void opponent(char c)
{
    if (car_speed[c] < opp_max[c])
        car_speed[c] += OPP_ACCEL;
    else
        car_speed[c] = opp_max[c];
    int d = car_lane[c] - car_x[c];     // back to the lane after a push
    if (d > 8)
        car_x[c] += 8;
    else if (d < -8)
        car_x[c] -= 8;
    else
        car_x[c] = car_lane[c];
}

// Contact between the player and each opponent: overlap along the road
// (CAR_LEN) and across it (OVERLAP).
static void contact(void)
{
#if MUTANT != 6
    for (char c = 1; c < NCARS; c++)
    {
        int dz = (int)(car_pos[c] - car_pos[0]);
        if (dz >= CAR_LEN || dz <= -CAR_LEN)
            continue;
        int dx = car_x[c] - car_x[0];
        if (dx >= OVERLAP || dx <= -OVERLAP)
            continue;
        if (!bump_cool)
        {
            bumps++;
            sound_bump();
        }
        bump_cool = 25;
        if (dz >= 0 && car_speed[0] > car_speed[c] + CRASH_CLOSING)
        {
            crash();                    // into its back, fast: a crash
            car_speed[c] += 0x0100;
        }
        else if (dz >= 0)               // the opponent is ahead: the player hit it
        {
            if (car_speed[0] > car_speed[c])
            {
                car_speed[0] = car_speed[c] > 0x0100 ? car_speed[c] - 0x0100 : 0;
                car_speed[c] += 0x0040;
            }
        }
        else if (car_speed[c] > car_speed[0])
            car_speed[c] = car_speed[0] > 0x0100 ? car_speed[0] - 0x0100 : 0;
        int push = (OVERLAP - (dx < 0 ? -dx : dx)) >> 1;
        if (dx >= 0)
        {
            car_x[0] -= push;
            car_x[c] += push;
        }
        else
        {
            car_x[0] += push;
            car_x[c] -= push;
        }
    }
#endif
}

void cars_step(char joy)
{
    player(joy);
    for (char c = 1; c < NCARS; c++)
        opponent(c);
    for (char c = 0; c < NCARS; c++)
        advance(c);
    if (bump_cool)
        bump_cool--;
    contact();

    char p = 1;
    for (char c = 1; c < NCARS; c++)
        if (ahead(c))
            p++;
    if (p < place)
        overtakes++;
    place = p;

    race_frames++;
#if MUTANT == 7
    if (race_frames == 1000)            // one step waits for the next tick: one lost frame
    {
        char t = B(ASM_TICK);
        while (B(ASM_TICK) == t)
            ;
    }
#endif
}
