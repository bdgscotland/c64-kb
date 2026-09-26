// flow.c: see flow.h.
#include "flow.h"
#include "display.h"
#include "front.h"

char score[3];                          // BCD, score[0] most significant: 6 digits
char lives, grenades;

#ifdef FORCE_OVER
// -dFORCE_OVER=1 (and every FRONTEND build): a death every FORCE_EVERY play
// frames, each worth 8,500 points, so three lives end the game at 25,500:
// fourth in the seeded table. The next wave's collisions replace this.
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

void flow_player_died(void)
{
    if (demo) {                         // the attract demo ends; nothing is scored
        state_next = ST_TITLE;
        return;
    }
    if (lives)
        lives--;
    if (!lives)
        state_next = ST_OVER;
}

void flow_area_cleared(void)
{
    if (!demo)
        state_next = ST_OVER;
}

void flow_frame(void)
{
#if AUTOPILOT && defined(FRONTEND)
    cyc_start();
#endif
#ifdef FORCE_OVER
    if (!demo && ++force_count == FORCE_EVERY) {
        force_count = 0;
        flow_add_score(0x8500);
        flow_player_died();
    }
#endif
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
