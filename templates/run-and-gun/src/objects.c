// objects.c: see objects.h. The spawn list, the three enemy kinds, their
// shots and grenades, and the slot writes.
#include "objects.h"
#include "scroll.h"
#include "soldier.h"

char obj_kind[N_POOL];
int obj_x4[N_POOL], obj_y4[N_POOL];
static signed char obj_vx[N_POOL], obj_vy[N_POOL];     // quarter pixels a frame
static char obj_age[N_POOL];            // frames alive (shots, grenades, blasts, dust); pose timer
static char obj_timer[N_POOL];          // frames to the next shot or throw
static char obj_param[N_POOL];          // the event's parameter: fire or throw period
static char obj_face[N_POOL];           // 0-7, 0 up, clockwise
static char obj_anim[N_POOL];
static char obj_pri[N_POOL];            // 1: behind the canopy
static char obj_want[N_POOL];           // an enemy's decision, renewed every 4th frame (W_ bits)
#define W_RIGHT 0x01
#define W_LEFT  0x02
#define W_DOWN  0x04
#define W_SHOWN 0x80                    // fully in view: may fire
static unsigned drawn_wy;               // scroll_wy when the slots were last written

#if AUTOPILOT
unsigned ost_spawned, ost_at_row, ost_lost, ost_shots, ost_nades, ost_wall, ost_nwall;
unsigned ost_park_bad, ost_shown_bad, ost_lag_bad, ost_fixes, ost_lag_skip, ost_frames;
char ost_peak;
#define STAT(x) (x)
#else
#define STAT(x)
#endif
#ifndef ENEMY_FAULT
#define ENEMY_FAULT 0                   // make enemies: 1 fires spawns a row late and leaves freed slots unparked
#endif

// ---- the kinds ------------------------------------------------------------------------
//                                   x0  x1  y0  y1 (sprite pixels, inclusive)
const char kind_box[N_KINDS][4] = {
    {  0,  0,  0,  0 },             // free
    {  6, 17,  3, 19 },             // rifleman: body and legs
    {  6, 17,  4, 16 },             // runner
    {  6, 17,  3, 19 },             // grenadier
    { 10, 13,  9, 11 },             // shot: the ball (SPR_SHOT)
    {  8, 15,  6, 14 },             // grenade (its largest size)
    {  2, 21,  1, 19 },             // blast
    {  0,  0,  0,  0 },             // dust
};
const char kind_flags[N_KINDS] = {
    0, KF_SHOOTABLE | KF_HURTS, KF_SHOOTABLE | KF_HURTS, KF_SHOOTABLE | KF_HURTS,
    KF_HURTS, 0, KF_HURTS, 0
};
static const char kind_col[N_KINDS] = {
    0, VCOL_CYAN, VCOL_ORANGE, VCOL_PURPLE, VCOL_YELLOW, VCOL_MED_GREY, VCOL_YELLOW, VCOL_LT_GREY
};

// ---- the spawn list (wave_director keyed to map rows) ------------------------------------
// One event per enemy, rows descending: the view's top row counts down as the
// soldier advances, and an event fires when the top row is at or above its row
// (>=, never ==). Its enemy stands with its feet on the row's bottom line, so it
// comes into view from under the top border. X is sprite X / 2 (a runner from
// the left starts at 0, from the right at 344, under the borders). The
// parameter is the fire period (rifleman), throw period (grenadier) or the
// direction (runner: 0 right, 1 left). Rows 75-95 are in view at the start.
#define EV(row, x2, kind, param) row
static const char ev_row[] = {
#include "spawns.h"
};
#undef EV
#define EV(row, x2, kind, param) x2
static const char ev_x2[] = {
#include "spawns.h"
};
#undef EV
#define EV(row, x2, kind, param) kind
static const char ev_kind[] = {
#include "spawns.h"
};
#undef EV
#define EV(row, x2, kind, param) param
static const char ev_param[] = {
#include "spawns.h"
};
#undef EV
#define N_EVENTS sizeof(ev_row)
static char ev_next;

// ---- aim ------------------------------------------------------------------------------
// Eight directions from a signed offset (atan2_8bit, "Variations": the octant
// from the signs, split at 22.5 degrees by min * 2.5 < max). 0 up, clockwise.
static char dir8(int dx, int dy)
{
    unsigned ax = dx < 0 ? -dx : dx;
    unsigned ay = dy < 0 ? -dy : dy;
    if (ay * 2 + (ay >> 1) < ax)
        return dx < 0 ? 6 : 2;
    if (ax * 2 + (ax >> 1) < ay)
        return dy < 0 ? 0 : 4;
    if (dx < 0)
        return dy < 0 ? 7 : 5;
    return dy < 0 ? 1 : 3;
}

// A slow shot: 1.5 pixels a frame on an axis, 1 + 1 on a diagonal (1.41).
static const signed char shot_vx[8] = { 0, 4, 6, 4, 0, -4, -6, -4 };
static const signed char shot_vy[8] = { -6, -4, 0, 4, 6, 4, 0, -4 };

// ---- the pool ---------------------------------------------------------------------------
void slot_show(char slot, unsigned x, char y, char ptr, char col, char pri)
{
    SLOT_XL[slot] = (char)x;
    SLOT_XH[slot] = x >> 8;
    SLOT_PTR[slot] = ptr;
    SLOT_COL[slot] = col;
    SLOT_PRI[slot] = pri;
    SLOT_Y[slot] = y;
}

void slot_park(char slot)
{
    slot_show(slot, PARK_X, PARK_Y, SPR_BLOCK + SPR_BLANK, 0, 0);
}

void slots_park_all(void)
{
    for (char s = 0; s < N_SLOTS; s++)
        slot_park(s);
}

char obj_alloc(char kind)
{
    for (char i = 0; i < N_POOL; i++)
        if (obj_kind[i] == OBJ_FREE) {
            obj_kind[i] = kind;
            obj_age[i] = 0;
            obj_anim[i] = 0;
            obj_pri[i] = 0;
            return i;
        }
    return 0xff;
}

void obj_free(char i)
{
    obj_kind[i] = OBJ_FREE;
#if ENEMY_FAULT
    if (0)
#endif
    slot_park(SLOT_POOL + i);
}

char obj_kill(char slot)
{
    char i = slot - SLOT_POOL;
    if (i >= N_POOL)
        return 0;
    char k = obj_kind[i];
    if (!(kind_flags[k] & KF_SHOOTABLE))
        return 0;
    obj_kind[i] = K_DOWN;
    obj_age[i] = 0;
    char s = SLOT_POOL + i;
    if (SLOT_Y[s] != PARK_Y) {
        SLOT_PTR[s] = SPR_BLOCK + SPR_DOWN;     // this frame: collide() runs after objects_update
        SLOT_COL[s] = kind_col[K_DOWN];
    }
    return k;
}

// ---- spawns -----------------------------------------------------------------------------
static void spawn(char e, char top)
{
    char k = ev_kind[e];
    char i = obj_alloc(k);
    if (i == 0xff) {
        STAT(ost_lost++);
        return;
    }
    STAT(ost_spawned++);
#if AUTOPILOT
    // At its row: fired the frame the top row reached it, or pre-spawned in view.
    if (ev_row[e] == top || ost_frames == 0)
        ost_at_row++;
#endif
    obj_x4[i] = ev_x2[e] * 8;
    obj_y4[i] = (ev_row[e] * 8 - 13) * 4;      // feet (sprite row 20) on the row's last line
    obj_param[i] = ev_param[e];
    obj_timer[i] = ev_param[e] >> 1;           // the first shot or throw after half a period
    obj_face[i] = 4;
    obj_want[i] = 0;
    obj_vx[i] = 0;
    obj_vy[i] = 0;
    if (k == K_RUNNER) {
        obj_vx[i] = ev_param[e] ? -8 : 8;
        obj_face[i] = ev_param[e] ? 1 : 0;
    }
}

void objects_rows(char top)
{
#ifdef MAPEND
    return;                                    // make mapend grades the scroll's end alone: its
                                               // verdict text sits where rows 4-16's enemies walk
#endif
    while (ev_next < N_EVENTS && ev_row[ev_next] >= top + ENEMY_FAULT) {
        char e = ev_next++;
        if (ev_row[e] < top + PF_ROWS)         // below the view: its moment has passed
            spawn(e, top);
    }
}

void objects_reset(void)
{
    for (char i = 0; i < N_POOL; i++)
        obj_free(i);
    ev_next = 0;
    drawn_wy = scroll_wy;
    objects_rows(scroll_top);
}

// ---- movement ---------------------------------------------------------------------------
// Each object thinks on every second frame, pool index and frame count
// alternating, and moves two frames' worth then; on the other frame only its
// slot's Y follows the ground (one add). The aim, the priority probe and the
// walk's goal are renewed on every second tick (every fourth frame).
// Measured in make enemies (PLAN.md, "Enemies"): this halved the objects'
// cycles against thinking every frame.
static char ofc;

static char blocked(int x4, int y4, char dx, char dy)
{
    return attr_at((unsigned)((x4 >> 2) + dx - 24), (unsigned)((y4 >> 2) + dy)) & A_BLOCK;
}

static char fire(char i, char kind)
{
    char j = obj_alloc(kind);
    if (j == 0xff)
        return 0xff;
    obj_x4[j] = obj_x4[i];
    obj_y4[j] = obj_y4[i];
    return j;
}

// A timer counted in frames, two a tick: 1 when it ran out (and it restarts).
static char timer_out(char i)
{
    signed char t = (signed char)obj_timer[i] - 2;
    if (t <= 0) {
        obj_timer[i] = obj_param[i];
        return 1;
    }
    obj_timer[i] = (char)t;
    return 0;
}

// The rifleman: toward the soldier's column, down toward him until 56 pixels
// above, a pixel a tick on each axis (half a pixel a frame), stopped by
// A_BLOCK at his feet; fires along his facing on a timer.
static void rifle_tick(char i)
{
    char w = obj_want[i];
    char moved = 0;
    int x4 = obj_x4[i], y4 = obj_y4[i];
    if (w & (W_LEFT | W_RIGHT)) {
        signed char vx = (w & W_RIGHT) ? 4 : -4;
        if (!blocked(x4 + vx, y4, (w & W_RIGHT) ? 17 : 6, 17)) {
            x4 += vx;
            obj_x4[i] = x4;
            moved = 1;
        }
    }
    if ((w & W_DOWN) && !blocked(x4, y4 + 4, 12, 21)) {
        obj_y4[i] = y4 + 4;
        moved = 1;
    }
    if (moved && !(++obj_age[i] & 1))
        obj_anim[i] ^= 1;
    if (timer_out(i) && (w & W_SHOWN)) {
        char j = fire(i, K_SHOT);
        if (j != 0xff) {
            char d = obj_face[i];
            obj_vx[j] = shot_vx[d];
            obj_vy[j] = shot_vy[d];
            STAT(ost_shots++);
        }
    }
}

// The grenadier: stands, faces the soldier, and throws when his timer runs
// out. grenade_lob, enemy form: vx = trunc(dx / 64), vy = trunc(dy / 64) - 2,
// vy up by 1 every 16 frames, a blast at age 80 (techniques/logic.md).
static void gren_tick(char i, int dx, int dy)
{
    if (obj_age[i])
        obj_age[i]--;                          // the throwing pose, 6 ticks (12 frames)
    if (timer_out(i) && (obj_want[i] & W_SHOWN)) {
        char j = fire(i, K_GRENADE);
        if (j != 0xff) {
            obj_vx[j] = (signed char)(dx / 64) * 4;
            obj_vy[j] = (signed char)(dy / 64 - 2) * 4;
            obj_age[i] = 6;
            STAT(ost_nades++);
        }
    }
}

// A shot flies straight, two frames a tick (3 pixels at most, a cell is 8);
// from age 4 (clear of the rifleman) it ends on an A_BLOCK cell under its
// ball, and at age 120 wherever it is.
static char shot_tick(char i)
{
    obj_x4[i] += obj_vx[i] * 2;
    obj_y4[i] += obj_vy[i] * 2;
    char a = obj_age[i] + 2;
    obj_age[i] = a;
    if (a >= 4 && blocked(obj_x4[i], obj_y4[i], 12, 10)) {
        STAT(ost_wall++);
        return 1;
    }
    return a >= 120;
}

// The grenade's arc, two frames a tick (vy's stage from the age at each
// frame, 16 frames a stage); from age 16 it bursts on an A_BLOCK cell
// (tested every second tick), and at age 80 wherever it is.
static void nade_tick(char i, char tp)
{
    char a = obj_age[i];
    obj_x4[i] += obj_vx[i] * 2;
    obj_y4[i] += obj_vy[i] * 2 + ((a >> 4) << 2) + (((a + 1) >> 4) << 2);
    a += 2;
    obj_age[i] = a;
    char wall = a >= 16 && !tp && blocked(obj_x4[i], obj_y4[i], 12, 10);
    if (a >= 80 || wall) {
#if AUTOPILOT
        if (wall)
            ost_nwall++;
#endif
        obj_kind[i] = K_BLAST;
        obj_age[i] = 0;
    }
}

// One pass: think for half the pool and write those slots (every field in
// the same frame, slot_show's rule); move the other half's Y with the
// ground. An object fired during the pass is drawn from its first tick.
void objects_update(void)
{
    int target_x = soldier_x;
    int target_my = scroll_wy + soldier_y - 54;  // map y of the soldier's sprite row 0
    int top_my = scroll_wy - 54;                // map y at sprite Y 0
    char d = (char)(drawn_wy - scroll_wy);      // lines the ground moved since the last pass
    drawn_wy = scroll_wy;
    ofc++;
#if AUTOPILOT
    char live = 0;
#endif
    for (char i = 0; i < N_POOL; i++) {
        char k = obj_kind[i];
        if (k == OBJ_FREE)
            continue;
        char s = SLOT_POOL + i;
#if AUTOPILOT
        live++;
#endif
        if ((i ^ ofc) & 1) {
            // Not this object's tick: its slot follows the ground.
            char y = SLOT_Y[s];
            if (d && y != PARK_Y) {
                y += d;
                if (y > MAX_SY)
                    obj_free(i);                // the view has left it behind
                else
                    SLOT_Y[s] = y;
            }
            continue;
        }
        char tp = ((i + ofc) >> 1) & 1;         // 0: this tick renews aim and priority
        char gone = 0;
        char p;
        switch (k) {
        case K_RIFLE:
        case K_GRENADIER: {
            int dx = 0, dy = 0;
            if (!tp || (k == K_GRENADIER && obj_timer[i] <= 2)) {
                int x = obj_x4[i] >> 2;
                int my = obj_y4[i] >> 2;
                int sy = my - top_my;
                dx = target_x - x;
                dy = target_my - my;
                obj_face[i] = dir8(dx, dy);
                obj_pri[i] = (attr_at((unsigned)(x - 12), (unsigned)(my + 10)) & A_BEHIND) ? 1 : 0;
                char w = sy >= 50 && sy <= 180 ? W_SHOWN : 0;
                if (dx > 3)
                    w |= W_RIGHT;
                else if (dx < -3)
                    w |= W_LEFT;
                if (dy > 56)
                    w |= W_DOWN;
                obj_want[i] = w;
            }
            if (k == K_RIFLE) {
                rifle_tick(i);
                p = SPR_BLOCK + SPR_RIFLE + obj_face[i] * 2 + obj_anim[i];
            } else {
                gren_tick(i, dx, dy);
                p = SPR_BLOCK + SPR_GREN + obj_face[i] * 2 + (obj_age[i] ? 1 : 0);
            }
            break;
        }
        case K_RUNNER:
            obj_x4[i] += obj_vx[i] * 2;
            obj_anim[i] ^= 1;
            if (!tp)
                obj_pri[i] = (attr_at((unsigned)((obj_x4[i] >> 2) - 12), (unsigned)((obj_y4[i] >> 2) + 10)) & A_BEHIND) ? 1 : 0;
            gone = obj_x4[i] <= 0 || obj_x4[i] >= 344 * 4;
            p = SPR_BLOCK + SPR_RUNNER + obj_face[i] * 2 + obj_anim[i];
            break;
        case K_SHOT:
            gone = shot_tick(i);
            p = SPR_BLOCK + SPR_SHOT;
            break;
        case K_GRENADE: {
            nade_tick(i, tp);
            gone = obj_y4[i] < 0;
            char z = obj_age[i] >> 4;           // 16 frames a size: small, middle, large, middle, small
            p = SPR_BLOCK + SPR_NADE + (z > 2 ? 4 - z : z);
            if (obj_kind[i] == K_BLAST)
                p = SPR_BLOCK + SPR_BLAST;
            break;
        }
        case K_BLAST:
            obj_age[i] += 2;
            gone = obj_age[i] >= 20;
            p = SPR_BLOCK + SPR_BLAST + ((obj_age[i] >> 2) & 1);
            break;
        default:                                // K_DOWN
            obj_age[i] += 2;
            gone = obj_age[i] >= 24;
            p = SPR_BLOCK + SPR_DOWN;
            break;
        }
        int sy = (obj_y4[i] >> 2) - top_my;
        // Below the lowest sprite Y (the view has left it behind), or done;
        // a shot that left the top.
        if (gone || sy > MAX_SY || (k == K_SHOT && sy < 24)) {
            obj_free(i);
            continue;
        }
        if (sy < 8) {
            slot_park(s);                       // above the view (a grenade's arc): parked until it comes down
            continue;
        }
        unsigned x = (unsigned)obj_x4[i] >> 2;
        SLOT_XL[s] = (char)x;
        SLOT_XH[s] = x >> 8;
        SLOT_PTR[s] = p;
        SLOT_COL[s] = kind_col[obj_kind[i]];
        SLOT_PRI[s] = obj_pri[i];
        SLOT_Y[s] = (char)sy;
    }
#if AUTOPILOT
    if (live > ost_peak)
        ost_peak = live;
    ost_frames++;
#endif
}

// objects_update wrote every live slot as it moved it; obj_kill and obj_free
// write theirs at once. Nothing is left to do here; main.c keeps the call in
// its place after collide().
void objects_draw(void)
{
}

// row_map_redraw's next frame runs no logic, but the soldier's repeated step
// moves the ground a line: move every shown pool slot with it, so objects stay
// on their cells (the slice left them a line behind for that frame).
// The redraw pair (main.c play_frame and light_frame): no object thinks,
// every shown slot follows the scroll step taken since the last draw, and a
// slot pushed below the cut is parked (objects_update frees its object on
// its next tick). The combined build lost frames on NTSC when objects_update
// ran on the redraw frame (PLAN.md, "Combined budget").
void objects_hold(void)
{
#if ENEMY_FAULT
    return;                                    // make enemies' fault: the slots keep last frame's lines
#endif
    char d = (char)(drawn_wy - scroll_wy);
    if (!d)
        return;
    drawn_wy = scroll_wy;
    char moved = 0;
    for (char s = SLOT_POOL; s < SLOT_POOL + N_POOL; s++) {
        char y = SLOT_Y[s];
        if (y == PARK_Y)
            continue;
        y += d;
        if (y > MAX_SY)
            slot_park(s);
        else
            SLOT_Y[s] = y;
        moved = 1;
    }
#if AUTOPILOT
    ost_fixes += moved;
#endif
}

#if AUTOPILOT
void objects_audit(void)
{
    char vis = 0;
    int top_my = scroll_wy - 54;
    char lagging = drawn_wy != scroll_wy;      // the ground moved and the slots did not follow
    ost_lag_skip += lagging;
    for (char s = 0; s < N_SLOTS; s++) {
        char y = SLOT_Y[s];
        if (y <= MAX_SY)
            vis++;
        if (s < SLOT_POOL)
            continue;
        char i = s - SLOT_POOL;
        if (obj_kind[i] == OBJ_FREE) {
            if (y != PARK_Y || SLOT_PTR[s] != SPR_BLOCK + SPR_BLANK || SLOT_XL[s] != (char)PARK_X || SLOT_XH[s] != PARK_X >> 8)
                ost_park_bad++;
        } else if (!lagging && y != PARK_Y && (int)y != (obj_y4[i] >> 2) - top_my)
            ost_lag_bad++;                     // shown off its map cell
    }
    if (vis != K_MUX_SHOWN)
        ost_shown_bad++;
}
#endif
