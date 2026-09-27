// flow.c: see flow.h.
#include "flow.h"
#include "display.h"
#include "front.h"
#include "scroll.h"
#include "soldier.h"
#include "objects.h"
#include "weapons.h"
#include "area.h"
#include "sound.h"

char score[3];                          // BCD, score[0] most significant: 6 digits
char lives, grenades;
char flow_restart_due;
char flow_cause;

// checkpoint_respawn's table: the level's checkpoint rows, ascending, the
// area's start row last (tools/mkassets.py CHECKPOINTS, src/gen/assets.h).
static const char checkpoints[N_CHECKPOINTS] = { CHECKPOINT_ROWS };

#if AUTOPILOT
char fl_deaths, fl_cause[FL_LOG], fl_top[FL_LOG], fl_row[FL_LOG], fl_gren[FL_LOG],
    fl_gren_after[FL_LOG], fl_lives[FL_LOG];
unsigned fl_die_at[FL_LOG], fl_restart_at[FL_LOG], fl_restart_cyc;
char fl_restarts;
char fl_alive_after[FL_LOG];
#endif

#ifdef FORCE_OVER
// -dFORCE_OVER=1 (and every FRONTEND build): a death every FORCE_EVERY play
// frames alive, each worth 8,500 points, so three lives end the game at
// 25,500: fourth in the seeded table. Each goes through the death animation
// and the restart; the soldier takes no other harm in these builds
// (collide.c), so the score is exact.
#define FORCE_EVERY 40
static unsigned force_count;
#endif

// What the panel shows now: flow_frame redraws a field only when its value
// differs from these (decimal_print's changed-field redraw).
static char shown_score[3], shown_lives, shown_grenades;

void flow_new_game(void)
{
    score[0] = score[1] = score[2] = 0;
    lives = START_LIVES;
    grenades = START_GRENADES;
    shown_score[0] = shown_score[1] = shown_score[2] = 0;
    shown_lives = lives;
    shown_grenades = grenades;          // main.c's play_enter draws the whole panel next
    flow_restart_due = RS_NONE;
    area_begin(0);
#ifdef FORCE_OVER
    force_count = 0;
#endif
}

// One BCD byte plus another and a carry, nibble by nibble in binary: no SED,
// so no interrupt can meet the decimal flag (pitfall decimal_mode_in_irq_handler).
static char bcd_carry;

static char bcd_add8(char x, char y)
{
    char lo = (x & 15) + (y & 15) + bcd_carry;
    char hi = (x >> 4) + (y >> 4);
    if (lo > 9) { lo -= 10; hi++; }
    bcd_carry = 0;
    if (hi > 9) { hi -= 10; bcd_carry = 1; }
    return (hi << 4) | lo;
}

void flow_add_score(unsigned bcd)
{
    bcd_carry = 0;
    score[2] = bcd_add8(score[2], (char)bcd);
    score[1] = bcd_add8(score[1], (char)(bcd >> 8));
    score[0] = bcd_add8(score[0], 0);
    if (bcd_carry)
        score[0] = score[1] = score[2] = 0x99;
}

void flow_player_died(char cause)
{
    if (soldier_state != SS_ALIVE)
        return;
    soldier_state = SS_DEAD;
    soldier_t = 0;
    flow_cause = cause;
    sfx(SFX_DEATH);
#if AUTOPILOT
    if (fl_deaths < FL_LOG) {
        fl_cause[fl_deaths] = cause;
        fl_top[fl_deaths] = scroll_top;
        fl_gren[fl_deaths] = grenades;
        fl_die_at[fl_deaths] = play_frames;
    }
    fl_deaths++;
#endif
}

void flow_area_cleared(void)
{
    flow_restart_due = RS_AREA;
}

char flow_checkpoint(char top)
{
    for (char i = 0; i < N_CHECKPOINTS; i++)
        if (checkpoints[i] >= top)      // the row counts down as he advances: behind is larger
            return checkpoints[i];
    return checkpoints[N_CHECKPOINTS - 1];
}

// The death's end: a life off, then game over or a restart.
static void death_over(void)
{
    if (lives)
        lives--;
#if AUTOPILOT
    if (fl_deaths && fl_deaths <= FL_LOG)
        fl_lives[fl_deaths - 1] = lives;
#endif
    if (demo)
        state_next = ST_TITLE;          // the attract demo ends; nothing is scored
    else if (!lives)
        state_next = ST_OVER;
    else
        flow_restart_due = RS_RESPAWN;
}

void flow_restart(void)
{
#if AUTOPILOT
    cyc_start();
    char k = fl_deaths - 1;
    char was = flow_restart_due;
#endif
    char row;
    if (flow_restart_due == RS_AREA) {
        area_clear_beat();              // the beat's text off, before the beam shows the old view
        area_begin(area + 1);
        row = SCROLL_START_TOP;
    } else {
        row = flow_checkpoint(scroll_top);
        area_restart();
    }
    flow_restart_due = RS_NONE;
    scroll_restart(row);
    soldier_reset();
    weapons_reset();
    objects_reset();                    // the pool cleared, the window re-spawned from the list
    if (grenades < START_GRENADES)
        grenades = START_GRENADES;      // topped up, never lowered
#if AUTOPILOT
    fl_restarts++;
    unsigned c = cyc_stop();
    if (c > fl_restart_cyc)
        fl_restart_cyc = c;
    if (was == RS_RESPAWN && k < FL_LOG) {
        fl_alive_after[k] = objects_alive();
        fl_row[k] = row;
        fl_gren_after[k] = grenades;
        fl_restart_at[k] = play_frames;
    }
#endif
}

void flow_frame(void)
{
#if AUTOPILOT && defined(FRONTEND)
    cyc_start();
#endif
#ifdef FORCE_OVER
    if (!demo && soldier_state == SS_ALIVE && ++force_count == FORCE_EVERY) {
        force_count = 0;
        flow_add_score(0x8500);
        flow_player_died(DC_FORCED);
    }
#endif
    if (soldier_state == SS_DEAD && !flow_restart_due && soldier_t < DEATH_FRAMES)
        if (++soldier_t == DEATH_FRAMES)
            death_over();
    if (score[0] != shown_score[0] || score[1] != shown_score[1] || score[2] != shown_score[2]) {
        shown_score[0] = score[0];
        shown_score[1] = score[1];
        shown_score[2] = score[2];
        panel_score();
    }
    if (lives != shown_lives) {
        shown_lives = lives;
        panel_lives();
    }
    if (grenades != shown_grenades) {
        shown_grenades = grenades;
        panel_grenades();
    }
#if AUTOPILOT && defined(FRONTEND)
    unsigned c = cyc_stop();
    if (c > fe_flow_max)
        fe_flow_max = c;
#endif
}
