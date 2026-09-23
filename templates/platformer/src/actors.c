// actors.c: enemies placed in the level wake when they come within a
// window around the view, and go back to the level table when they leave
// it, so a patrol survives off screen and a stomped enemy stays dead
// (c64-kb actor_activation_window). The live ones sit in six slots, one
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
char slot_type[NSLOT], slot_jump[NSLOT], slot_timer[NSLOT], slot_sub[NSLOT];
bool slot_left[NSLOT], slot_squashed[NSLOT];
struct Anim slot_anim[NSLOT];

static char scan_pos, win_lo, win_top, drop_lo, drop_top;

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
            return;                         // all six live: it wakes on a later scan
    slot_lvl[s] = i;
    slot_type[s] = lvl_type[i];
    slot_x[s] = lvl_col[i] * 8 + 8;
    slot_y[s] = (unsigned)((lvl_ty[i] + 1) * 16) << 8;
    slot_jump[s] = JUMP_APEX;               // it drops onto whatever is under it
    slot_left[s] = lvl_flags[i] & LF_LEFT;
    slot_timer[s] = HOP_WAIT / 2 + (i & 15);
    slot_squashed[s] = false;
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

static void walker(char s)
{
    if (++slot_sub[s] & 1)
        return;                             // half a pixel a frame
    signed char dx = slot_left[s] ? -1 : 1;
    char fy = slot_y[s] >> 8;
    char ahead = surface_walk(slot_x[s] + dx * 6, fy);
    if (ahead == 0xff || (ahead > fy && ahead - fy > MAX_SNAP) || ground_step(&slot_x[s], &slot_y[s], dx, ENEMY_H) != 0)
        slot_left[s] = !slot_left[s];       // an edge or a wall ahead: turn
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

// Player box against each live enemy box, in world pixels (16-bit X: a
// low-byte test would hit an enemy 256 pixels away). Falling onto the top
// of an enemy is a stomp; any other touch hurts.
void actors_collide(void)
{
    if (pinvuln)
        return;
    char ps = panim.shape + (pleft && panim.shape < SH_MIRROR ? SH_MIRROR : 0);
    const struct Box *pb = &shape_box[ps];
    if (pb->x0 > pb->x1)
        return;
    int pl = px - 8 + pb->x0, pr = px - 8 + pb->x1;
    int pt = (int)(py >> 8) - 21 + pb->y0, pbot = (int)(py >> 8) - 21 + pb->y1;
    for (char s = 0; s < NSLOT; s++)
    {
        if (slot_lvl[s] == NO_SLOT || slot_squashed[s])
            continue;
        const struct Box *eb = &shape_box[slot_anim[s].shape];
        if (eb->x0 > eb->x1)
            continue;
        int el = slot_x[s] - 8 + eb->x0, er = slot_x[s] - 8 + eb->x1;
        int et = (int)(slot_y[s] >> 8) - 16 + eb->y0, ebot = (int)(slot_y[s] >> 8) - 16 + eb->y1;
        if (pl > er || el > pr || pt > ebot || et > pbot)
            continue;
        if (!pground && pjump >= JUMP_APEX && pbot <= et + 6)
        {
            slot_squashed[s] = true;
            anim_set(&slot_anim[s], an_squash);
            lvl_flags[slot_lvl[s]] = (lvl_flags[slot_lvl[s]] & ~LF_LIVE) | LF_DEAD;
            pjump = JUMP_BOUNCE;
            stomps++;
            score_add(1, 0);
            events |= EV_STOMP;
            sfx_play(SFX_STOMP);
        }
        else
        {
            player_hurt();
            return;
        }
    }
}
