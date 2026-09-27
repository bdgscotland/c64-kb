// weapons.c: see weapons.h.
#include "weapons.h"
#include "objects.h"
#include "scroll.h"
#include "soldier.h"
#include "display.h"

unsigned shots_fired, shots_lost, throws, throws_empty, throws_busy;

// A sprite's point (sprite pixel 12, 10: the bullet's dot, the grenade's and
// the blast's centre) at map (x, y) is drawn at sprite X = x + 24 - 12 and
// sprite Y = y - scroll_wy + 54 - 10 (game.h, coordinates).
#define PT_SX 12
#define PT_SY 44
#define MIN_SY 30               // above this the dot (lines Y+9 to Y+12) is in the top border

// facing_turn_step: 0 up, 4 right, 8 down, 12 left, 22.5 degrees a step.
// round(20 sin a) and -round(20 cos a), quarter pixels a frame: 5 pixels
// straight, 4.9 on the in-between facings (arithmetic).
static const signed char vel_x[16] = {
    0, 8, 14, 18, 20, 18, 14, 8, 0, -8, -14, -18, -20, -18, -14, -8
};
static const signed char vel_y[16] = {
    -20, -18, -14, -8, 0, 8, 14, 18, 20, 18, 14, 8, 0, -8, -14, -18
};

// Bullets: map position in quarter pixels, velocity, age; live 0 is free.
static unsigned b_x4[N_BULLETS], b_y4[N_BULLETS];
static int b_vx[N_BULLETS], b_vy[N_BULLETS];
static char b_age[N_BULLETS], b_live[N_BULLETS];

// The grenade: G_NONE, flying, or a blast; its map position (the centre).
enum { G_NONE, G_FLY, G_BLAST };
static char g_state, g_age;
static unsigned g_x, g_y;
static char g_pri;
// Height from the age: small, medium, large, medium, small (grenade_lob "Flight").
static const char g_size[GREN_FLIGHT] = {
    0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2,
    2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0
};

static char prev_joy;           // last frame's joy: an edge is a 1 that became 0

#ifdef WEAPONS
// The WEAPONS autopilot build's evidence (-dWEAPONS=1, make weapons): the
// first shots fired, the first grenade's timeline, and the cost of a frame
// (weapons_test.h grades them).
#define SHOT_LOG 10
char log_facing[SHOT_LOG], log_end[SHOT_LOG], log_age[SHOT_LOG];
signed char log_vx[SHOT_LOG], log_vy[SHOT_LOG];
static char b_log[N_BULLETS];   // log index of each bullet, 0xff past SHOT_LOG
unsigned gl_throw_y, gl_land_y, gl_throw_f, gl_land_f, gl_end_f;
char gl_blast_frames;
unsigned wpn_worst;             // most CIA1 timer B cycles of one weapons_update
char wpn_worst_b, wpn_worst_g;  // bullets flying and the grenade state in that frame
#endif
enum { END_RANGE = 1, END_BLOCK = 2, END_OFF = 3, END_HIT = 4 };

static char b_why[N_BULLETS];    // how each bullet last ended (END_*)

char weapons_live;
Box weapons_bbox[N_BULLETS];
char weapons_bline[N_BULLETS];

static const char bit_of[N_BULLETS] = { 1, 2, 4 };

static void bullet_end(char i, char why)
{
    b_live[i] = 0;
    weapons_live &= ~bit_of[i];
    b_why[i] = why;
    slot_park(SLOT_BULLET + i);
#ifdef WEAPONS
    char k = b_log[i];
    if (k < SHOT_LOG) {
        log_end[k] = why;
        log_age[k] = b_age[i];
    }
#endif
}

// Test the bullet's cell and draw it, or end it (char_attribute_flags
// "Projectiles": bit 0 ends the shot, bit 1 gives it the canopy's priority).
static void bullet_place(char i)
{
    unsigned x = b_x4[i] >> 2, y = b_y4[i] >> 2;
    char a = attr_at(x, y);                         // A_BLOCK outside the map too
    if (a & A_BLOCK) {
        bullet_end(i, END_BLOCK);
        return;
    }
    int sy = (int)(y - scroll_wy) + PT_SY;
    if (sy < MIN_SY || sy > MAX_SY) {
        bullet_end(i, END_OFF);
        return;
    }
    weapons_bbox[i].x = x - 2;                      // the dot's 4 x 4 box (w, h set by weapons_reset)
    weapons_bbox[i].y = y - 2;
    weapons_bline[i] = (char)sy + (10 - 2);         // sprite pixel row 10 is the dot's centre
    slot_show(SLOT_BULLET + i, x + PT_SX, (char)sy, SPR_BLOCK + SPR_W_BULLET, BULLET_COLOUR,
              (a & A_BEHIND) ? 1 : 0);
}

static void fire(void)
{
    char i = 0;
    while (b_live[i]) {
        if (++i == N_BULLETS) {
            shots_lost++;                            // all three flying: the press is lost
            return;
        }
    }
    char f = soldier_facing;
    int vx = vel_x[f], vy = vel_y[f];
    // From the body centre, two frames' travel ahead (10 pixels): the muzzle.
    b_x4[i] = map_x(soldier_x, BODY_CX) * 4 + 2 * vx;
    b_y4[i] = map_y(soldier_y, BODY_CY) * 4 + 2 * vy;
    b_vx[i] = vx;
    b_vy[i] = vy;
    b_age[i] = 0;
    b_live[i] = 1;
    weapons_live |= bit_of[i];
#ifdef WEAPONS
    char k = shots_fired < SHOT_LOG ? (char)shots_fired : 0xff;
    b_log[i] = k;
    if (k < SHOT_LOG) {
        log_facing[k] = f;
        log_vx[k] = vx;
        log_vy[k] = vy;
        log_end[k] = 0;
    }
#endif
    shots_fired++;
    bullet_place(i);
}

static void throw_grenade(void)
{
    if (!grenades) {
        throws_empty++;                              // none left: nothing happens
        return;
    }
    if (g_state != G_NONE) {
        throws_busy++;                               // one in the air or bursting
        return;
    }
    g_x = map_x(soldier_x, BODY_CX);
    g_y = map_y(soldier_y, BODY_CY);
    g_state = G_FLY;
    g_age = 0;
    grenades--;
    throws++;
    panel_grenades();
#ifdef WEAPONS
    if (throws == 1) {                               // the first throw's timeline
        gl_throw_y = g_y;
        gl_throw_f = play_frames;
    }
#endif
}

static void grenade_step(void)
{
    if (g_state == G_FLY) {
        g_y -= GREN_VY;
        if (++g_age == GREN_FLIGHT) {                // lands: a still blast from here
            g_state = G_BLAST;
            g_age = 0;
            g_pri = (attr_at(g_x, g_y) & A_BEHIND) ? 1 : 0;
#ifdef WEAPONS
            if (throws == 1) {
                gl_land_y = g_y;
                gl_land_f = play_frames;
            }
#endif
        }
    } else if (g_state == G_BLAST) {
        if (++g_age == GREN_BLAST) {
            g_state = G_NONE;
            slot_park(SLOT_GRENADE);
#ifdef WEAPONS
            if (throws == 1)
                gl_end_f = play_frames;
#endif
        }
    }
}

static void grenade_draw(void)
{
    if (g_state == G_NONE)
        return;
#ifdef WEAPONS
    if (g_state == G_BLAST && throws == 1)
        gl_blast_frames++;                           // blast frames drawn (or parked off screen)
#endif
    int sy = (int)(g_y - scroll_wy) + PT_SY;
    if (sy < MIN_SY || sy > MAX_SY) {                // off the playfield: still live, not drawn
        slot_park(SLOT_GRENADE);
        return;
    }
    if (g_state == G_FLY)
        slot_show(SLOT_GRENADE, g_x + PT_SX, (char)sy, SPR_BLOCK + SPR_W_GRENADE + g_size[g_age],
                  GREN_COLOUR, 0);                   // in the air: over the canopy
    else {
        char ph = (g_age >> 1) & 1;
        slot_show(SLOT_GRENADE, g_x + PT_SX, (char)sy, SPR_BLOCK + SPR_W_BLAST + ph,
                  ph ? VCOL_WHITE : VCOL_YELLOW, g_pri);
    }
}

char weapons_bullet_box(char i, Box *b)
{
    if (!b_live[i])
        return 0;
    *b = weapons_bbox[i];
    return 1;
}

void weapons_bullet_spent(char i)
{
    if (b_live[i])
        bullet_end(i, END_HIT);
}

void box_blast(Box *b, unsigned x, unsigned y)
{
    b->x = x - (GREN_L - 1);                         // the corner (grenade_lob "Land")
    b->y = y - (GREN_M - 1);
    b->w = 2 * GREN_L;
    b->h = 2 * GREN_M;
}

char weapons_blast_box(Box *b)
{
    if (g_state != G_BLAST)
        return 0;
    box_blast(b, g_x, g_y);
    return 1;
}

void weapons_reset(void)
{
    for (char s = 0; s < N_BULLETS; s++) {
        b_live[s] = 0;
        weapons_bbox[s].w = 4;
        weapons_bbox[s].h = 4;
        slot_park(SLOT_BULLET + s);
    }
    weapons_live = 0;
    g_state = G_NONE;
    slot_park(SLOT_GRENADE);
    prev_joy = 0;                                    // held: the title's fire press fires nothing
}

void weapons_update(char joy)
{
#ifdef WEAPONS
    cia1.crb = 0x00;
    cia1.tb = 0xffff;
    cia1.crb = 0x11;                                 // force load, start, count phi2
#endif
    char pressed = prev_joy & ~joy;                  // released last frame, pressed now
#ifdef WEAPONS_FAULT
    pressed |= ~joy & JOY_FIRE;                      // make weaponsfault: fire on the level (autofire)
#endif
    prev_joy = joy;

    for (char i = 0; i < N_BULLETS; i++) {
        if (b_live[i]) {
            b_x4[i] += b_vx[i];
            b_y4[i] += b_vy[i];
            if (++b_age[i] == BULLET_LIFE)
                bullet_end(i, END_RANGE);
            else
                bullet_place(i);
        }
    }
    if (pressed & JOY_FIRE)
        fire();

    grenade_step();
    if (pressed & JOY_THROW)
        throw_grenade();
    grenade_draw();
#ifdef WEAPONS
    cia1.crb = 0x00;
    unsigned c = 0xffff - cia1.tb;
    if (c > wpn_worst) {
        wpn_worst = c;
        wpn_worst_b = b_live[0] + b_live[1] + b_live[2];
        wpn_worst_g = g_state;
    }
#endif
}
