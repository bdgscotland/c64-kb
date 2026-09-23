// actors.c: enemies placed in the level wake when they come within a
// window around the view, and go back to the level table when they leave
// it, so a patrol survives off screen and a stomped enemy stays dead
// (c64-kb actor_activation_window). The live ones sit in NSLOT slots, one
// sprite each (object_pool). Hits are tested box against box, each box
// from the animation frame on show (per_frame_hitbox).
#include "game.h"

#define MARGIN 4                    // wake window: the view plus 4 columns each side
#define HYST   2                    // live actors are kept 2 columns further out
#define SCAN_K 8                    // level entries examined a frame, round robin
#define HOP_WAIT 70                 // frames a hopper sits between hops
#define HOP_START 8                 // vy_tab entry a hop starts from: a lower arc than a jump
#define ENEMY_H 15                  // enemy feet to head

char lvl_count;
char lvl_col[NLVL], lvl_ty[NLVL], lvl_type[NLVL], lvl_flags[NLVL];

char slot_lvl[NSLOT];
unsigned slot_x[NSLOT], slot_y[NSLOT];
char slot_type[NSLOT], slot_jump[NSLOT], slot_timer[NSLOT];
static char slot_probe[NSLOT];      // the column ahead the walker last judged
static bool slot_turn[NSLOT];       // and whether it turns there
bool slot_left[NSLOT], slot_squashed[NSLOT];
struct Anim slot_anim[NSLOT];

static char scan_pos, win_lo, win_top, tick;
char drop_lo, drop_top;             // this frame's drop window, in columns

void actors_reset(void)
{
    for (char s = 0; s < NSLOT; s++)
        slot_lvl[s] = NO_SLOT;
    scan_pos = 0;
}

static void activate(char i)
{
    char s = 0;
    while (slot_lvl[s] != NO_SLOT)
        if (++s == NSLOT)
            return;                         // every slot live: it wakes on a later scan
    slot_lvl[s] = i;
    slot_type[s] = lvl_type[i];
    slot_x[s] = lvl_col[i] * 8 + 8;
    slot_y[s] = (unsigned)((lvl_ty[i] + 1) * 16) << 8;
    slot_jump[s] = JUMP_APEX;               // it drops onto whatever is under it
    slot_left[s] = lvl_flags[i] & LF_LEFT;
    slot_timer[s] = HOP_WAIT / 2 + (i & 15);
    slot_squashed[s] = false;
    slot_probe[s] = 0xff;
    slot_anim[s].seq = nullptr;
    anim_set(&slot_anim[s], lvl_type[i] == T_WALKER ? an_walk : an_hop_sit);
    lvl_flags[i] |= LF_LIVE;
    events |= EV_WAKE;
}

// Back to the table: where it is now, which way it faces, one tile row up
// so a wake drops it onto the surface again.
static void deactivate(char s)
{
    char i = slot_lvl[s];
    lvl_col[i] = (slot_x[s] - 8) >> 3;
    lvl_ty[i] = (char)((slot_y[s] >> 8) >> 4) - 1;
    lvl_flags[i] = (lvl_flags[i] & ~(LF_LIVE | LF_LEFT)) | (slot_left[s] ? LF_LEFT : 0);
    slot_lvl[s] = NO_SLOT;
    events |= EV_SLEEP;
}

static void kill(char s)
{
    char i = slot_lvl[s];
    lvl_flags[i] = (lvl_flags[i] & ~LF_LIVE) | LF_DEAD;
    slot_lvl[s] = NO_SLOT;
}

// Both windows in columns, clamped to the level, so every compare is a byte.
static void set_window(void)
{
    int cc = camx >> 3;
    int lo = cc - MARGIN, hi = cc + 40 + MARGIN;
    win_lo = lo < 0 ? 0 : lo;
    win_top = hi > 255 ? 255 : hi;
    drop_lo = lo - HYST < 0 ? 0 : lo - HYST;
    drop_top = hi + HYST > 255 ? 255 : hi + HYST;
}

// Half a pixel a frame; odd and even slots take turns, so a crowd costs
// half as much on any one frame. The column WALK_AHEAD pixels in front is
// judged once, when the walker first reaches it: an edge, a step too high
// or low, or a wall there turns the walker. Each step then costs one
// surface_walk for the ground snap (about 300 cycles by the meter's PROF
// runs, against about 1,100 when every step also probed walls and the
// ground ahead; README, "Enemies on screen").
#define WALK_AHEAD 6

static void walker(char s)
{
    if ((tick ^ s) & 1)
        return;
    signed char dx = slot_left[s] ? -1 : 1;
    char fy = slot_y[s] >> 8;
    unsigned nx = slot_x[s] + dx;
    unsigned probe = nx + dx * WALK_AHEAD;
    char pc = probe >> 3;
    if (pc != slot_probe[s])
    {
        slot_probe[s] = pc;
        char ahead = surface_walk(probe, fy);
        slot_turn[s] = ahead == 0xff || (ahead > fy && ahead - fy > MAX_SNAP) ||
                       (ahead < fy && fy - ahead > MAX_RISE) || wall_at(probe, fy, ENEMY_H);
    }
    if (slot_turn[s])
    {
        slot_left[s] = !slot_left[s];
        slot_probe[s] = 0xff;               // judge the other way afresh
        return;
    }
    char sy = surface_walk(nx, fy);
    slot_x[s] = nx;
    if (sy != 0xff)
        slot_y[s] = (unsigned)sy << 8;
}

static void hopper(char s)
{
    slot_left[s] = px < slot_x[s];          // it watches the player
    if (--slot_timer[s] == 0)
    {
        slot_timer[s] = HOP_WAIT;
        slot_jump[s] = HOP_START;
        anim_set(&slot_anim[s], an_hop_up);
    }
}

void actors_update(void)
{
    tick++;
    set_window();
    char i = scan_pos;
    for (char k = 0; k < SCAN_K; k++)
    {
        if (i < lvl_count && !(lvl_flags[i] & (LF_LIVE | LF_DEAD)))
        {
            char c = lvl_col[i];
            if (c >= win_lo && c <= win_top)
                activate(i);
        }
        i = (i + 1) & (NLVL - 1);
    }
    scan_pos = i;

    for (char s = 0; s < NSLOT; s++)
    {
        if (slot_lvl[s] == NO_SLOT)
            continue;
        struct Anim *a = &slot_anim[s];
        anim_step(a);
        if (slot_squashed[s])
        {
            if (anim_done(a))
                slot_lvl[s] = NO_SLOT;      // already dead in the table
            continue;
        }
        if (slot_jump[s] != 0xff)
        {
            if (air_step(slot_x[s], &slot_y[s], &slot_jump[s], ENEMY_H, false))
            {
                slot_jump[s] = 0xff;
                if (slot_type[s] == T_HOPPER)
                    anim_set(a, an_hop_sit);
            }
        }
        else if (slot_type[s] == T_WALKER)
            walker(s);
        else
            hopper(s);

        char fy = slot_y[s] >> 8;
        char c = slot_x[s] >> 3;
        if (fy > 200 && fy < 240)
            kill(s);                        // fell into a pit
        else if (c < drop_lo || c > drop_top)
            deactivate(s);
    }
}

bool enemy_near(unsigned x, char dist)
{
    for (char s = 0; s < NSLOT; s++)
    {
        if (slot_lvl[s] != NO_SLOT && !slot_squashed[s])
        {
            unsigned e = slot_x[s];
            if ((e > x ? e - x : x - e) < dist)
                return true;
        }
    }
    return false;
}

// ---- hits: boxes per animation frame, emitted where the sprites are ----
// Coordinates are bytes relative to the player's foot, placed at (BOX_O,
// BOX_O); an enemy is listed only within NEAR pixels each way, so every
// compare in the pass is one byte (16-bit world X is taken apart once per
// enemy, never per box pair). After c64-kb per_frame_hitbox.
#define BOX_O 64
#define NEAR  40
#define MAXB  (2 + NSLOT)
static char nbox;
static char bl[MAXB], br[MAXB], bt[MAXB], bb[MAXB], bg[MAXB], bm[MAXB], bo[MAXB];

static void emit_boxes(char owner, char shape, char left, char top)
{
    char k = hb_first[shape], e = k + hb_count[shape], i = nbox;
    for (; k != e; k++, i++)
    {
        const struct HBox *h = &hbox[k];
        bl[i] = left + h->x0;
        br[i] = left + h->x1;
        bt[i] = top + h->y0;
        bb[i] = top + h->y1;
        bg[i] = h->group;
        bm[i] = h->mask;
        bo[i] = owner;                      // 0 the player, 1 + slot an enemy
    }
    nbox = i;
}

// The slots the feet hit and the slots the body hit, as bit masks.
char hit_stomp, hit_body;

static void collide(void)
{
    hit_stomp = hit_body = 0;
    for (char i = 0; i + 1 < nbox; i++)
    {
        char m = bm[i];
        for (char j = i + 1; j < nbox; j++)
        {
            if (!(m & bg[j]))
                continue;                   // a pair that cannot hurt each other
            if (bl[i] <= br[j] && bl[j] <= br[i] && bt[i] <= bb[j] && bt[j] <= bb[i])
            {
                char p = bo[i] ? j : i, e = bo[i] ? bo[i] : bo[j];
                char bit = 1 << (e - 1);
                if (bg[p] == G_STOMP)
                    hit_stomp |= bit;
                else
                    hit_body |= bit;
            }
        }
    }
}

// Any enemy the feet reach is stomped; a body touch by any other hurts.
void actors_collide(void)
{
    if (pinvuln)
        return;
    nbox = 0;
    char fy = py >> 8;
    emit_boxes(0, panim.shape + (pleft && panim.shape < SH_MIRROR ? SH_MIRROR : 0), BOX_O - 8, BOX_O - 21);
    for (char s = 0; s < NSLOT; s++)
    {
        if (slot_lvl[s] == NO_SLOT || slot_squashed[s])
            continue;
        int dx = (int)slot_x[s] - (int)px;
        signed char dy = (char)(slot_y[s] >> 8) - fy;
        if (dx > -NEAR && dx < NEAR && dy > -NEAR && dy < NEAR)
            emit_boxes(1 + s, slot_anim[s].shape, (char)dx + (BOX_O - 8), (char)dy + (BOX_O - 16));
    }
    collide();
    for (char s = 0; s < NSLOT; s++)
    {
        if (!(hit_stomp & (1 << s)))
            continue;
        slot_squashed[s] = true;
        anim_set(&slot_anim[s], an_squash);
        lvl_flags[slot_lvl[s]] = (lvl_flags[slot_lvl[s]] & ~LF_LIVE) | LF_DEAD;
        pjump = JUMP_BOUNCE;
        stomps++;
        score_add(1, 0);
        events |= EV_STOMP;
        sfx_play(SFX_STOMP);
    }
    if (hit_body & ~hit_stomp)
        player_hurt();
}
