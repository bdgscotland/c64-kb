// player.c: the physics every body shares (walk, fall, land) and the
// player on top of it. After c64-kb slope_collision (surface_walk, the
// ground snap, the landing scan) and fixed-point-jump-velocity (one table
// of 8.8 velocities, entered at 0 for a jump and at the apex for a fall).
#include "game.h"

// vy_tab[n] = min(-$380 + $24 * (n + 1), $210): launch at 3.5 pixels a
// frame, gravity $24 a frame, falls capped at 2.06 pixels a frame, under
// one cell. Arithmetic: a jump rises 42 pixels in 24 frames.
const int vy_tab[JUMP_LEN] = {
    -860, -824, -788, -752, -716, -680, -644, -608, -572, -536, -500,
    -464, -428, -392, -356, -320, -284, -248, -212, -176, -140, -104,
     -68,  -32,    4,   40,   76,  112,  148,  184,  220,  256,  292,
     328,  364,  400,  436,  472,  508,  528,  528,  528,  528,  528
};

#define RUN_SUB 0x80                // 1.5 pixels a frame: 1, then 2, then 1 ...

unsigned px, py;
char pjump, psub, pdrop, pinvuln;
bool pground, pleft;
struct Anim panim;
unsigned safe_x;
char safe_y;

// Ground row for a body whose feet were on fy, moved to column x: the cell
// the feet are in, one up if that is ground too (walking up into the next
// slope cell), one down if it is air (walking down). 0xff: no ground.
char surface_walk(unsigned x, char fy)
{
    unsigned col = x >> 3;
    char row = fy >> 3;
    char a = cell_attr(col, row);
    if (a & A_GROUND)
    {
        char b = cell_attr(col, row - 1);
        if (b & A_GROUND)
        {
            a = b;
            row--;
        }
    }
    else
    {
        row++;
        a = cell_attr(col, row);
        if (!(a & A_GROUND))
            return 0xff;
    }
    return surface_at(x, row, a);
}

// A wall cell in column x beside a body standing on fy: probed at the
// feet, the middle and the head.
bool wall_at(unsigned x, char fy, char height)
{
    unsigned col = x >> 3;
    return ((cell_attr(col, (char)(fy - 4) >> 3) |
             cell_attr(col, (char)(fy - (height >> 1)) >> 3) |
             cell_attr(col, (char)(fy - height + 1) >> 3)) & A_WALL) != 0;
}

// One pixel sideways on the ground.
char ground_step(unsigned *x, unsigned *y, signed char dx, char height)
{
    unsigned nx = *x + dx;
    char fy = *y >> 8;
    if (wall_at(dx > 0 ? nx + BODY_HALF : nx - BODY_HALF, fy, height))
        return 1;
    char s = surface_walk(nx, fy);
    if (s != 0xff && s < fy && fy - s > MAX_RISE)
        return 1;                           // too steep: a wall
    *x = nx;
    if (s != 0xff && (s <= fy || s - fy <= MAX_SNAP))
    {
        *y = (unsigned)s << 8;              // ground snap, up or down
        return 0;
    }
    return 2;                               // off an edge
}

// One frame in the air. Rising, a wall cell over the head ends the rise;
// falling, the first ground surface crossed in this column is a landing.
// `drop` ignores one-way ledges (dropping through one).
bool air_step(unsigned x, unsigned *y, char *jump, char height, bool drop)
{
    int vy = vy_tab[*jump];
    if (*jump < JUMP_LEN - 1)
        (*jump)++;
    char fy = *y >> 8;
    unsigned ny_fp = *y + vy;
    char ny = ny_fp >> 8;
    unsigned col = x >> 3;
    if (vy < 0)
    {
        char head = (char)(ny - height) >> 3;
        if ((cell_attr((x - BODY_HALF) >> 3, head) | cell_attr((x + BODY_HALF) >> 3, head)) & A_WALL)
        {
            *jump = JUMP_APEX;              // head bump: start falling
            return false;
        }
        *y = ny_fp;
        return false;
    }
    for (char row = fy >> 3; row <= (ny >> 3); row++)
    {
        char a = cell_attr(col, row);
        if ((a & A_GROUND) && !(drop && (a & A_DROP)))
        {
            char s = surface_at(x, row, a);
            if (s >= fy && s <= ny)
            {
                *y = (unsigned)s << 8;
                return true;
            }
        }
    }
    *y = ny_fp;
    return false;
}

void player_reset(unsigned x, char y)
{
    px = x;
    py = (unsigned)y << 8;
    psub = 0;
    pjump = JUMP_APEX;
    pground = false;
    pleft = false;
    pdrop = 0;
    safe_x = x;
    safe_y = y;
    panim.seq = nullptr;
    anim_set(&panim, an_jump);
}

// A coin or the goal in the cell at (x, y).
static void touch(unsigned x, char y)
{
    unsigned col = x >> 3;
    char row = y >> 3;
    char a = cell_attr(col, row);
    if ((a & A_COIN) && take_coin(col, row))
    {
        view_erase_tile(col, row);
#if FORCE_FAULT
        score_add(0, 2);                    // the fault: a coin counts 20, not 10
#else
        score_add(0, 1);
#endif
        coins++;                            // score_add marked the HUD dirty
        events |= EV_COIN;
        sfx_play(SFX_COIN);
    }
    if (a & A_GOAL)
        goal_reached = true;
}

// One frame. joy is the port byte (active low); pressed the lines that went
// low this frame (c64-kb joystick_edge_detect).
void player_update(char joy, char pressed)
{
    signed char dir = 0;
    if (!(joy & JOY_RIGHT))
        dir = 1;
    else if (!(joy & JOY_LEFT))
        dir = -1;
    if (dir)
        pleft = dir < 0;

    char fy = py >> 8;
    if (pground && (pressed & JOY_FIRE))
    {
        if (!(joy & JOY_DOWN) && (cell_attr(px >> 3, fy >> 3) & A_DROP))
        {
            pdrop = 8;                      // down + fire on a ledge: drop through it
            py += 0x100;
        }
        else
        {
            pjump = 0;
            events |= EV_JUMP;
            sfx_play(SFX_JUMP);
        }
        pground = false;
        if (pdrop)
            pjump = JUMP_APEX;
    }

    // Sideways, one pixel at a time, so no step skips a wall or a slope cell.
    char steps = 0;
    if (dir)
    {
        unsigned s = psub + RUN_SUB;
        psub = s & 0xff;
        steps = 1 + (s >> 8);
    }
    bool moved = false;
    while (steps--)
    {
        if (pground)
        {
            char r = ground_step(&px, &py, dir, BODY_H);
            if (r == 1)
            {
                events |= EV_BLOCKED;
                break;
            }
            moved = true;
            if (r == 2)
            {
                pground = false;            // walked off an edge: fall from the apex
                pjump = JUMP_APEX;
            }
        }
        else
        {
            unsigned nx = px + dir;
            if (wall_at(dir > 0 ? nx + BODY_HALF : nx - BODY_HALF, py >> 8, BODY_H))
                break;
            px = nx;
        }
    }
    if (px < 8)
        px = 8;
    else if (px > LEVEL_CW * 8 - 8)
        px = LEVEL_CW * 8 - 8;

    if (!pground && air_step(px, &py, &pjump, BODY_H, pdrop != 0))
    {
        pground = true;
        events |= EV_LAND;
        if (cell_attr(px >> 3, (char)(py >> 8) >> 3) & A_DROP)
            events |= EV_LEDGE;
    }
    if (pdrop)
        pdrop--;
    if (pinvuln)
        pinvuln--;

    fy = py >> 8;
    if (pground)
    {
        char a = cell_attr(px >> 3, fy >> 3);
        if (a & A_SLOPE)
            events |= EV_SLOPE;
        else if (!(a & A_DROP) && !(cell_attr((px - 8) >> 3, fy >> 3) & A_SLOPE) &&
                 (cell_attr((px - 8) >> 3, fy >> 3) & A_GROUND) && (cell_attr((px + 8) >> 3, fy >> 3) & A_GROUND) &&
                 !enemy_near(px, 64))
        {
            safe_x = px;                    // flat ground both sides, no enemy near: a respawn point
            safe_y = fy;
        }
    }
    touch(px, fy - 6);
    touch(px, fy - 14);

    if (!pground)
        anim_set(&panim, an_jump);
    else if (moved)
        anim_set(&panim, an_run);
    else
        anim_set(&panim, an_stand);
    anim_step(&panim);

    if (fy > 200 && fy < 240)
        player_hurt();                      // fell into a pit
}
