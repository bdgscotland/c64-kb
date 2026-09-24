// autopilot.h: AUTOPILOT builds only. A driver bot, not a timeline: it reads
// the game and steers. Fire on the title, the throttle held from the
// lights, then per frame a target across the road: the centre, away from
// an opponent close ahead, and twice on purpose somewhere else, so the run
// sees every event the verdict wants:
//   - for its first 500 race frames it does not avoid the car ahead in its
//     lane: it runs into it (contact);
//   - in segments 17-19 of the first lap it aims for the right-hand grass
//     (the verge).
// It also keeps its own count of each lap's frames, for the verdict.
//
// METER_WINDOW=n picks the 255 race frames the meter records: 0 (default)
// from race frame 200, the pack; 1 from race frame 1,200, alone on the
// second half of lap 1; 2 every race frame (the verdict prints RUN, the
// worst of all of them).

#ifndef METER_WINDOW
#define METER_WINDOW 0
#endif

static void grade(void);            // verdict.h

static unsigned ap_count;           // race frames in this lap, counted here
static unsigned ap_lap[LAPS];
static char ap_laps_seen;
static unsigned ap_title;

static bool ap_recording(void)
{
#if METER_WINDOW == 1
    return race_frames >= 1200;
#elif METER_WINDOW == 2
    return true;
#else
    return race_frames >= 200;
#endif
}

static char autopilot_port(void)
{
    char joy = 0xff;
    if (state == ST_TITLE)
    {
        if (++ap_title == 60)
            joy &= ~JOY_FIRE;           // one press
        return joy;
    }
    if (state != ST_GRID && state != ST_RACE)
        return joy;
    joy &= ~JOY_FIRE;                   // the throttle

    int me = car_x[0] >> 4;             // pixels at line 202
    int target = 0;
    char seg = road_segment(car_pos[0]);
    if (race_frames < 500)
        target = car_x[1] >> 4;         // on purpose: into car 1, nothing avoided
    else for (char c = 1; c < NCARS; c++)
    {
        int dz = (int)((car_pos[c] - car_pos[0]) & LAP_MASK);
        if (dz >= 8192)
            dz -= 16384;
        if (dz <= -CAR_LEN || dz > 300)
            continue;
        int them = car_x[c] >> 4;
        int dx = them - me;
        if (dx < 44 && dx > -44)
            target = them >= 0 ? them - 64 : them + 64;
    }
    if (car_lap[0] == 0 && seg >= 17 && seg <= 19)
        target = W0 + 24;               // on purpose: onto the grass
    if (me < target - 3)
        joy &= ~JOY_RIGHT;
    else if (me > target + 3)
        joy &= ~JOY_LEFT;
    return joy;
}

// After the frame's work: the lap count, for the verdict's check of the clock.
static unsigned ap_race_frames;

static void autopilot_frame(void)
{
    if (race_frames != ap_race_frames)  // the cars stepped this frame
    {
        ap_race_frames = race_frames;
        ap_count++;
        if (car_lap[0] != ap_laps_seen)
        {
            if (ap_laps_seen < LAPS)
                ap_lap[ap_laps_seen] = ap_count - 1;
            ap_laps_seen = car_lap[0];
            ap_count = 1;
        }
    }
    if (state == ST_FINISH && timer == 100)
        grade();
}
