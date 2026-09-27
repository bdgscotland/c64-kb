// collide.c: see collide.h.
#include "collide.h"
#include "objects.h"
#include "weapons.h"
#include "soldier.h"
#include "scroll.h"
#include "flow.h"
#include "area.h"
#include "sound.h"
#include "front.h"

// Points per kill, in tens: 100, 150, 200 (the kinds' values are this game's
// own). A frame's kills are summed and added once, in BCD, with one effect
// request: a blast in a crowd kills several at once, and a BCD add and a
// request for each ran collide() 90 lines long (make fullpool, PAL).
static const char kill_tens[N_KINDS] = { 0, 10, 15, 20, 0, 0, 0, 0 };
static unsigned frame_tens;             // this frame's kills, in tens of points

#if AUTOPILOT
unsigned col_kills[4], col_blast;
char col_killer;
unsigned col_kill_at[4];
unsigned col_hits, col_terrain;
unsigned col_worst;
char col_worst_n;
#endif

// Pool slot s's box in map pixels; 0 when it is under a side border.
// Each kind's box as collide() uses it, built once from objects.h kind_box:
// its top row, height, left column and width in sprite pixels.
static char kt[N_KINDS], kh[N_KINDS], kl[N_KINDS], kw[N_KINDS];

void collide_init(void)
{
    for (char k = 0; k < N_KINDS; k++) {
        kt[k] = kind_box[k][2];
        kh[k] = kind_box[k][3] - kind_box[k][2] + 1;
        kl[k] = kind_box[k][0];
        kw[k] = kind_box[k][1] - kind_box[k][0] + 1;
    }
}

// Pool slot s's box in map pixels; 0 when it is under a side border.
static char obj_box(char s, char k, Box *b)
{
    unsigned x = SLOT_XL[s] | ((unsigned)(SLOT_XH[s]) << 8);
    unsigned l = x + kl[k];
    if (l + kw[k] <= 24 || l > 343)
        return 0;
    b->x = l - 24;
    b->y = scroll_wy + SLOT_Y[s] + kt[k] - 54;
    b->w = kw[k];
    b->h = kh[k];
    return 1;
}

static void kill(char s, char by_blast)
{
    char k = obj_kill(s);
#if AUTOPILOT
    col_blast += by_blast;
#endif
    frame_tens += kill_tens[k];
#if AUTOPILOT
    col_kills[k < 4 ? k : 0]++;
    if (k < 4)
        col_kill_at[k] = play_frames;
#else
    (void)by_blast;
#endif
}

// Half the pool each frame, by pool index against a frame count, as the
// objects think (objects.c): an object is tested every second frame. A
// bullet moves 10 pixels in two frames and the smallest shootable box is 13
// high, an enemy shot 3 pixels against the soldier's 17: nothing passes
// through (arithmetic from weapons.h, objects.c kind_box and the speeds).
static char cfc;

// The deadline. A frame whose collision pass would start after line
// COLLIDE_LATE (the flow, the draws, the sort and the band IRQ still to
// come before line 250) skips it and keeps the half it was due to test for
// the next frame: every object then waits three frames instead of two, 15
// pixels of a bullet's travel against the 17 lines a bullet and the smallest
// shootable box share (arithmetic). Never two skips in a row. The redraw
// frame's HOLD_LINES (main.c) is the same idea.
#define COLLIDE_LATE 100
static char deferred;
#if AUTOPILOT
unsigned col_deferred;
#endif

static char late(void)
{
    char hi, lo;
    do { hi = vic.ctrl1; lo = vic.raster; } while (hi != vic.ctrl1);
    return !(hi & 0x80) && lo > COLLIDE_LATE && lo < 250;
}

void collide(void)
{
    if (deferred)
        deferred = 0;
    else if (late()) {
        deferred = 1;
#if AUTOPILOT
        col_deferred++;
#endif
        return;
    }
#if AUTOPILOT && defined(COLLIDE_TIMED)
    cyc_start();
#endif
    // The live bullets, packed: their boxes (weapons.h weapons_bbox, map
    // pixels) and tops in sprite-line coordinates (Y + row: one byte for
    // anything on the playfield).
    const Box *bb[N_BULLETS];
    char bv[N_BULLETS], bi[N_BULLETS];
    char nb = 0;
    char lo = 255, hi = 0;                      // the lines anything that hits covers
    char lm = weapons_live;
    for (char i = 0; lm; i++, lm >>= 1) {
        if (lm & 1) {
            char v = weapons_bline[i];
            bb[nb] = &weapons_bbox[i];
            bv[nb] = v;
            bi[nb] = i;
            if (v < lo) lo = v;
            if (v + 3 > hi) hi = v + 3;
            nb++;
        }
    }
    // The blast, while its box has a line on the playfield (sprite lines
    // 0-230): its top then fits a byte too, clamped at 0.
    Box blast;
    char has_blast = weapons_blast_box(&blast);
    char blv = 0;
    if (has_blast) {
        int v = (int)(blast.y - scroll_wy) + 54;
        if (v < -(2 * GREN_M) || v > 230)
            has_blast = 0;
        else {
            blv = (char)v;                      // a top above line 0 wraps; the compare below still holds
            char t = v < 0 ? 0 : (char)v;
            if (t < lo) lo = t;
            if ((char)(v + 2 * GREN_M - 1) > hi) hi = (char)(v + 2 * GREN_M - 1);
        }
    }

    char harm = soldier_state == SS_ALIVE && !area_has_stick();
#ifdef NO_HARM
    harm = 0;                                   // game.h: test builds whose soldier must live
#endif
    if (harm && soldier_deadly) {
        flow_player_died(DC_TERRAIN);
#if AUTOPILOT
        col_terrain++;
#endif
        harm = 0;
    }
    Box sb;
    char sv = soldier_y + SB_Y0;
    if (harm) {
        sb.x = soldier_x + SB_X0 - 24;
        sb.y = scroll_wy + sv - 54;
        sb.w = SB_X1 - SB_X0 + 1;
        sb.h = SB_Y1 - SB_Y0 + 1;
        if (sv < lo) lo = sv;
        if (sv + (SB_Y1 - SB_Y0) > hi) hi = sv + (SB_Y1 - SB_Y0);
    }

    cfc++;
    char first = lo <= hi ? (cfc & 1) : N_POOL; // nothing that hits: no pass
    for (char i = first; i < N_POOL; i += 2) {
        char k = obj_kind[i];
        char f = kind_flags[k];
        if (!f)
            continue;
        char s = SLOT_POOL + i;
        char y = SLOT_Y[s];
        if (y == PARK_Y)
            continue;
        char ov = y + kt[k];                    // the box's top, sprite-line coordinates
        char oh = kh[k];
        if (ov > hi || (char)(ov + oh) <= lo)
            continue;                           // no line with anything that hits
        Box ob;
        char have = 0;                          // 1: ob built; 2: under a side border
        if (f & KF_SHOOTABLE) {
            char dead = 0;
            for (char j = 0; j < nb; j++) {
                if ((char)(bv[j] - ov + 3) >= (char)(oh + 3))
                    continue;                   // no line in common (the bullet's box is 4 high)
                if (!have)
                    have = obj_box(s, k, &ob) ? 1 : 2;
                if (have == 2)
                    break;
                if ((unsigned)(bb[j]->x - ob.x + 3) >= (unsigned)(ob.w + 3))
                    continue;                   // no column in common
                if (box_hit(bb[j], &ob)) {      // weapons.h: the wrap-safe test
                    weapons_bullet_spent(bi[j]);
                    nb--;                       // the spent bullet out of the list
                    bb[j] = bb[nb];
                    bv[j] = bv[nb];
                    bi[j] = bi[nb];
                    kill(s, 0);
                    dead = 1;
                    break;
                }
            }
            if (!dead && has_blast && (char)(blv - ov + (2 * GREN_M - 1)) < (char)(oh + (2 * GREN_M - 1))) {
                if (!have)
                    have = obj_box(s, k, &ob) ? 1 : 2;
                if (have == 1 && box_hit(&blast, &ob)) {
                    kill(s, 1);
                    dead = 1;
                }
            }
            if (dead)
                continue;
        }
        if ((f & KF_HURTS) && harm && (char)(sv - ov + (SB_Y1 - SB_Y0)) < (char)(oh + (SB_Y1 - SB_Y0))) {
            if (!have)
                have = obj_box(s, k, &ob) ? 1 : 2;
            if (have == 1 && box_hit(&sb, &ob)) {
                flow_player_died(DC_HIT);
#if AUTOPILOT
                col_hits++;
                col_killer = k;
#endif
                harm = 0;
            }
        }
    }
    if (frame_tens) {
        // tens to BCD hundreds and tens (at most 11 kills of 200: 2,200 points)
        unsigned t = frame_tens;
        frame_tens = 0;
        char th = 0, h = 0;
        while (t >= 100) { t -= 100; th++; }
        while (t >= 10) { t -= 10; h++; }
        if (!demo)
            flow_add_score(((unsigned)th << 12) | ((unsigned)h << 8) | ((unsigned)t << 4));
        sfx(SFX_KILL);
    }
#if AUTOPILOT && defined(COLLIDE_TIMED)
    unsigned c = cyc_stop();
    if (c > col_worst)
        col_worst = c;
#endif
}
