// cars.c: the player's car, the three opponents, contact between them, laps
// and the clock. One step a frame (the game runs 6/5 as fast on NTSC, as
// the other starters do: c64-kb pal_ntsc_tempo_mismatch).
//
// Along the road a car has a position (world units, 256 a segment, 16,384 a
// lap) and a speed (8.8 units a frame). Across it, car_x is 1/16 pixel at
// line 202, 0 on the centre line; the kerbs are at +-W0. The player's throttle, brake
// and steering follow c64-kb vehicle_control (speed from the throttle, a
// surface limit, steering that needs speed); a bend pushes the car outwards
// by its curvature times the speed. Contact follows car_contact_response
// in a reduced form: cars that overlap are pushed apart across the road,
// the one behind loses its speed to the one ahead, and a pair cools for 25
// frames before it counts again.
#include "game.h"

unsigned car_pos[NCARS];
char     car_lap[NCARS];
unsigned car_speed[NCARS];
int      car_x[NCARS];
char     car_colour[NCARS] = { VCOL_WHITE, VCOL_RED, VCOL_YELLOW, VCOL_CYAN };
static char     car_frac[NCARS];
static int      car_lane[NCARS];        // where an opponent drives, 1/16 pixel
char     place;
unsigned lap_frames;
unsigned lap_time[LAPS];
unsigned race_frames;
unsigned bumps, verge_frames, overtakes;
char     bump_cool;
bool     on_verge;
char     finished;

// The grid: the player last, behind car 1 in the left lane; the opponents
// ahead, lanes alternating. Their top speeds are below the player's, the
// farthest the fastest, so the player catches them one at a time.
static const unsigned grid_pos[NCARS] = { 0, 70, 140, 210 };
static const int grid_x[NCARS] = { -48 * 16, -48 * 16, 48 * 16, -48 * 16 };
static const unsigned opp_max[NCARS] = { 0, 0x0880, 0x0900, 0x0980 };

#define ACCEL      0x0010
#define OPP_ACCEL  0x000c
#define BRAKE      0x0040
#define COAST      0x0008
#define DRAG       0x0030               // on the grass, over VERGE_MAX
#define STEER      5                    // 1/16 pixel a frame per unit of speed
#define ROAD_EDGE  ((W0 - CAR_HALF) * 16)
#define X_LIMIT    ((W0 + 64) * 16)     // the grass ends here: a wall
#define OVERLAP    (2 * CAR_HALF * 16)  // closer than this across the road: contact

void cars_reset(void)
{
    for (char c = 0; c < NCARS; c++)
    {
        car_pos[c] = grid_pos[c];
        car_lap[c] = 0;
        car_speed[c] = 0;
        car_frac[c] = 0;
        car_x[c] = grid_x[c];
        car_lane[c] = grid_x[c];
    }
    place = NCARS;
    lap_frames = 0;
    for (char l = 0; l < LAPS; l++)
        lap_time[l] = 0;
    race_frames = 0;
    bumps = verge_frames = overtakes = 0;
    bump_cool = 0;
    on_verge = false;
    finished = 0;
}

// Car c is ahead of the player: more laps, or the same and further round.
static bool ahead(char c)
{
    if (car_lap[c] != car_lap[0])
        return car_lap[c] > car_lap[0];
    return car_pos[c] > car_pos[0];
}

// Along the road: position += speed, a lap on each wrap.
static void advance(char c)
{
    unsigned t = car_frac[c] + (car_speed[c] & 0xff);
    car_frac[c] = (char)t;
    unsigned p = car_pos[c] + (car_speed[c] >> 8) + (t >> 8);
    if (p >= LAP_UNITS)
    {
        p -= LAP_UNITS;
        car_lap[c]++;
        if (c == 0)
        {
            char l = car_lap[0] - 1;
            if (l < LAPS)
                lap_time[l] = lap_frames + (l == 0 ? FORCE_FAULT : 0);  // the fault: lap 1 a frame long
            lap_frames = 0;
        }
    }
    car_pos[c] = p;
}

static void player(char joy)
{
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
    signed char k = (signed char)B(ASM_CURV_LO + road_segment(car_pos[0]));
    x -= k * v;
    if (x > X_LIMIT)
        x = X_LIMIT;
    else if (x < -X_LIMIT)
        x = -X_LIMIT;
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
        int dz = (int)((car_pos[c] - car_pos[0]) & LAP_MASK);
        if (dz >= 8192)
            dz -= 16384;
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
        if (dz >= 0)                    // the opponent is ahead: the player hit it
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
#if MUTANT == 5
    lap_frames += race_frames & 1;
#else
    lap_frames++;
#endif
    if (car_lap[0] >= LAPS && !finished)
        finished = place;
}
