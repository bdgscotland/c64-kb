// area.c: see area.h.
#include "area.h"
#include "objects.h"
#include "scroll.h"
#include "soldier.h"
#include "flow.h"
#include "display.h"
#include "sound.h"
#include <string.h>

char area;
char area_phase;
char wave_tospawn, wave_n;
static char seed;
static char beat_t;

#if AUTOPILOT
unsigned ar_wave_at, ar_walk_at, ar_arrive_at, ar_beat_end, ar_spawned, ar_peak_alive;
char ar_first_x2[4];
#define AR(x) (x)
#else
#define AR(x)
#endif

// The playfield's colours per area, applied by the frame IRQ (kernel.asm
// pf_bg, pf_mc1, pf_mc2): the jungle, then the same map burnt to ash
// (grey earth, light-grey highlights), then the jungle again. Colour RAM
// (green) is the same in every area.
static const char area_bg[2]  = { VCOL_BROWN, VCOL_MED_GREY };
static const char area_mc1[2] = { VCOL_LT_GREEN, VCOL_LT_GREY };

void area_begin(char n)
{
    area = n;
    K_BYTE(ASM_PF_BG) = area_bg[n & 1];
    K_BYTE(ASM_PF_MC1) = area_mc1[n & 1];
    area_restart();
}

void area_restart(void)
{
    area_phase = AP_SCROLL;
}

char area_has_stick(void)
{
    return area_phase >= AP_WALK;
}

// The recipe's 8-bit Galois LFSR (taps $B8, period 255).
static char roll(void)
{
    char s = seed;
    seed = (s & 1) ? (s >> 1) ^ 0xb8 : s >> 1;
    return seed;
}

// Each free slot rolls once a frame while soldiers are still to come.
static void spawner(char free)
{
    while (free-- && wave_tospawn) {
        if (roll() & WAVE_MASK)
            continue;
        char r = roll();
        char x2 = 66 + (r & 31);                // sprite X 132-194: out of the gate
        char k = (r & 0xc0) == 0xc0 ? K_GRENADIER : K_RIFLE;
        if (objects_spawn(k, x2, WAVE_ROW, k == K_RIFLE ? 64 : 96) == 0xff)
            break;
#if AUTOPILOT
        if (ar_spawned < 4)
            ar_first_x2[ar_spawned] = x2;
        ar_spawned++;
#endif
        wave_tospawn--;
    }
}

static void beat_text(void)
{
    put_text(SCREEN, 9, 14, "AREA CLEARED");
    put_text(SCREEN, 11, 15, "BONUS 2000");
    text_colour(9, 14, 12, VCOL_WHITE);
    text_colour(11, 15, 10, VCOL_WHITE);
}

void area_clear_beat(void)
{
    memset(SCREEN + 9 * 40 + 14, G_FLOOR, 12);
    memset(SCREEN + 11 * 40 + 15, G_FLOOR, 10);
    text_colour(9, 14, 12, PF_CRAM);
    text_colour(11, 15, 10, PF_CRAM);
}

void area_frame(void)
{
#ifdef MAPEND
    return;                                     // make mapend grades the scroll's stop alone
#endif
    switch (area_phase) {
    case AP_SCROLL:
        if (!scroll_can_step() && soldier_state == SS_ALIVE) {
            area_phase = AP_WAVE;
            wave_n = WAVE_BASE + 2 * (area < 3 ? area : 3);
#ifdef FULLPOOL
            wave_n = WAVE_BASE + 2 * 3;         // make fullpool: area 3's wave, 12, more than the pool
#endif
            wave_tospawn = wave_n;
            seed = WAVE_SEED;
            AR(ar_wave_at = play_frames);
        }
        break;
    case AP_WAVE: {
        if (soldier_state != SS_ALIVE)
            break;                              // dying: the restart brings the wave back whole
        char free;
        char alive = objects_count(&free);
        if (wave_tospawn) {
            spawner(free);
            alive = objects_alive();            // the spawns count (the rare frame that has any)
        }
#if AUTOPILOT
        if (alive > ar_peak_alive)
            ar_peak_alive = alive;
#endif
        if (!wave_tospawn && !alive) {          // all three: the map ended, none to come, none alive
            area_phase = AP_WALK;
            AR(ar_walk_at = play_frames);
        }
        break;
    }
    case AP_WALK:
        if (soldier_walk(GATE_X, GATE_Y)) {
            flow_add_score(AREA_BONUS);
            soldier_state = SS_GONE;
            area_phase = AP_BEAT;
            beat_t = 0;
            beat_text();
            sfx(SFX_BLAST);
            AR(ar_arrive_at = play_frames);
        }
        break;
    default:                                    // AP_BEAT
        if (++beat_t == BEAT_FRAMES) {
            AR(ar_beat_end = play_frames);
            flow_area_cleared();
        }
        break;
    }
}
