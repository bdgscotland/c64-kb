// stage.c: the stages. Each is a point-to-point run (track.asm) with three
// checkpoints and a finish; a countdown starts each stage and every
// checkpoint adds to it; the clock reaching zero ends the game. Here also
// the track ring the road reads (curvf, eased curvature) and each stage's
// colours.
#include "game.h"

char     stage;                         // 0 "Hill country", 1 "Canyon run"
unsigned stage_frames;                  // frames into this stage
unsigned stage_time[STAGES];            // each finished stage's frames
char     cps;                           // checkpoints passed this stage (the fourth is the finish)
char     cps_total;                     // over the race
char     timer_s;                       // the countdown, whole seconds
static char timer_f;                    // frames left in this second
bool     time_up;
bool     stage_done;
static int fill_e;                      // the next ring entry to fill (64 units each, from the stage's start)
static unsigned cp_pos[4];

// The countdown: seconds at the start, seconds a checkpoint adds. Stage 2
// gives less: it is meant to beat a player's first try (#110).
static const char t_start[STAGES] = { 28, 24 };
static const char t_bonus[STAGES] = { 18, 15 };

#define ST(t, i) B(ASM_ST_##t + (i))

// A stage's segment s's curvature (straight before its start and past the tables).
static int seg_curv(int s)
{
#if MUTANT == 2
    return 0;                           // no curve
#endif
    if (s < 0)
        s = 0;
    unsigned i = ST(BASE, stage) + (unsigned)s;
    if (i >= ST(SEGS, 0))
        return 0;
    return (signed char)ST(CURV, i);
}

// Ring entry e (units of 64 from the stage's start): the eased curvature,
// round(2a + (b - a) q / 2) rounding halves to even, as track.asm's
// assembly-time table for the circuit did (curvF), so the circuit's
// segments draw as before.
static signed char eased(int e)
{
    int i = e < 2 ? -1 : (e - 2) >> 2;
    int a = seg_curv(i), b = seg_curv(i + 1);
    int q = e - (4 * i + 2);
    int v2 = 4 * a + (b - a) * q;       // twice the value
    int h = v2 >= 0 ? v2 >> 1 : -((1 - v2) >> 1);   // floor(v2 / 2)
    if ((v2 & 1) && (h & 1))
        h++;                            // a half: to the even neighbour
    return (signed char)h;
}

// The ring from 4 entries behind position p to 36 ahead (2,304 units: the
// builder reads 2,040 ahead of the camera).
void track_ring(unsigned p)
{
    fill_e = (int)(p >> 6) - 4;
    track_fill();
}

void track_fill(void)
{
    int to = (int)(car_pos[0] >> 6) + 36;
    while (fill_e <= to)
    {
        B(ASM_CURVF + (fill_e & 255)) = eased(fill_e);
        fill_e++;
    }
}

char stage_hill(unsigned p)
{
    unsigned i = ST(BASE, stage) + (p >> 8);
    return i < ST(SEGS, 0) ? ST(HILL, i) : HOFF_LEVEL;
}

// Each stage's colours: grass, road bands, kerb, and the hills in the sky.
static const char c_grass[STAGES][2] = { { VCOL_GREEN, VCOL_LT_GREEN }, { VCOL_ORANGE, VCOL_BROWN } };
static const char c_kerb[STAGES][2] = { { VCOL_RED, VCOL_WHITE }, { VCOL_YELLOW, VCOL_WHITE } };
static const char c_hill[STAGES] = { VCOL_BLUE, VCOL_RED };

void stage_colours(void)
{
    char *g = (char *)ASM_GRASS_COL, *k = (char *)ASM_KERB_COL;
    char ga = c_grass[stage][0], gb = c_grass[stage][1];
    char ka = c_kerb[stage][0], kb = c_kerb[stage][1];
    for (unsigned i = 0; i < 256; i += 2)   // odd entries are sky
    {
        g[i] = i & 0x80 ? gb : ga;
        k[i] = i & 0x40 ? kb : ka;
    }
    for (unsigned i = 0; i < 7 * 40; i++)
        COLOUR[i] = 0x08 | c_hill[stage];
}

void stage_start(void)
{
    char len = ST(LEN, stage);
    for (char k = 0; k < 3; k++)
        cp_pos[k] = (unsigned)(len * (k + 1) / 4) << 8;
    cp_pos[3] = (unsigned)len << 8;
    cps = 0;
    stage_frames = 0;
    timer_s = t_start[stage];
    timer_f = fps;
    time_up = false;
    stage_done = false;
    stage_colours();
    track_ring(car_pos[0]);
}

// A race frame: the stage's clock, its checkpoints, the countdown.
void stage_step(void)
{
#if MUTANT == 5
    stage_frames += race_frames & 1;    // the clock counts every other frame
#else
    stage_frames++;
#endif
    track_fill();
    if (car_pos[0] >= cp_pos[cps])
    {
        cps++;
        cps_total++;
        if (cps < 4)
        {
            timer_s += t_bonus[stage];
            hud_message("checkpoint", 2 * fps);
            sound_beep(1);
        }
        else
        {
            stage_time[stage] = stage_frames + (stage == 0 ? FORCE_FAULT : 0);  // the fault: stage 1 a frame long
            stage_done = true;
            return;
        }
    }
    if (--timer_f == 0)
    {
        timer_f = fps;
        if (timer_s)
            timer_s--;
        if (!timer_s)
            time_up = true;
    }
}
