// game.c -- "Rung": a single-screen platformer for the stock C64, Oscar64.
//
// Built blind against the c64-kb knowledge base; every technique below is
// named after the KB page it came from (see KB-USAGE.md / README.md).
//
//   tile map        recipes/oscar64/tile-map-render.md   (RLE rows, no offset table)
//   jump / 8.8      recipes/oscar64/fixed-point-jump.md  (gravity first, then position)
//   joystick        recipes/oscar64/joystick-input.md    (joy_edge, repeat_step)
//   object pool     recipes/oscar64/object-pool.md       (parallel arrays, scan alloc)
//   LFSR            recipes/oscar64/lfsr-random.md       (16-bit Galois, taps $B400)
//   frame loop      recipes/oscar64/frame-sync-loop.md   (rirq at row 250, tick byte, budget bar)
//   sfx + tune stub recipes/oscar64/sfx-engine.md        (voice 2 borrowed from the tune)
//   high score      recipes/oscar64/high-score-persist.md (kernalio.h, scratch then write)
//   result byte     recipes/oscar64/headless-verify.md   ($02FF, border 5/2)
//
// Build: oscar64 -tm=c64 -O2 -o=game.prg game.c
// Defines: AUTOPILOT=1 (default) drives the joystick from the LFSR;
//          BUDGET_BAR=1 (default) paints the border while the loop works.

#include <c64/vic.h>
#include <c64/cia.h>
#include <c64/sid.h>
#include <c64/sprites.h>
#include <c64/rasterirq.h>
#include <c64/kernalio.h>

#include "map.h"

#ifndef AUTOPILOT
#define AUTOPILOT 1
#endif
#ifndef BUDGET_BAR
#define BUDGET_BAR 1
#endif

#define SCREEN   ((char *)0x0400)
#define COLOUR   ((char *)0xd800)
#define SPR_PLAYER  ((char *)0x0340)      // block 13, cassette buffer
#define SPR_ENEMY_A ((char *)0x0380)      // block 14
#define SPR_ENEMY_B ((char *)0x03c0)      // block 15
#define RESULT   (*(volatile char *)0x02ff)

#define CODE_PASS 0x01
#define CODE_FAIL 0x02

#define MAP_ROW   2                        // first screen row of the map
#define HUD_ROW   0
#define CYC_ROW   1
#define DRIVE_ROW 24

#define SYNC_ROW  250                      // rirq row; IRQ lands on line 251

#define PASS_FRAME   600                   // autopilot: frames without fault
#define FORCE_OVER   800                   // autopilot: force game over here

// Tiles
#define T_EMPTY  0
#define T_BRICK  1
#define T_PLAT   2
#define T_LADDER 3

// Joystick bits (active low on the port)
#define JOY_UP    0x01
#define JOY_DOWN  0x02
#define JOY_LEFT  0x04
#define JOY_RIGHT 0x08
#define JOY_FIRE  0x10
#define JOY_MASK  0x1f
#define REPEAT_DELAY 20
#define REPEAT_RATE   4

// Physics (8.8)
#define WALK_SPEED  0x0140                 // 1.25 px/frame
#define GRAVITY     0x0028                 // matches gen.py
#define MAX_FALL    0x0400                 // 4 px/frame
#define CLIMB_SPEED 1                      // px/frame on a ladder

// Player body inside the 24x21 sprite: x 8..15, y 5..20
#define BODY_L 8
#define BODY_R 15
#define BODY_T 5
#define BODY_B 20
#define PLAYER_START_X 32                  // world px (sprite x - 24)
#define PLAYER_START_Y (21*8 - 21)         // feet on the floor row (tile row 21)

// Object pool
#define MAX_OBJ 6
#define OBJ_FREE 0
#define OBJ_ALIVE 1
#define NO_SLOT 0xff

// ---------------------------------------------------------------------------
// Fault reporting: the result-byte contract from headless-verify.md
static char fault_code;                    // 0 none, else a fault number

static void fault(char n)
{
    if (fault_code == 0)
    {
        fault_code = n;
        RESULT = CODE_FAIL;
        vic.color_border = 2;
    }
}
#define ASSERT(c, n) do { if (!(c)) fault(n); } while (0)

// ---------------------------------------------------------------------------
// Text (screen codes, no KERNAL)
static void put_str(char row, char col, const char *s)
{
    char *p = SCREEN + 40 * row + col;
    while (*s)
    {
        char c = *s++;
        *p++ = (c >= 'a' && c <= 'z') ? c - 'a' + 1 : c;
    }
}

// Decimal without division: subtract powers of ten. Worst case 45
// 16-bit compare-and-subtracts for five digits, far cheaper than five
// 16-bit divisions (the first build divided and the HUD ate the frame:
// the budget bar was white end to end while the timed region said 4,000).
static const unsigned pow10[4] = { 10000, 1000, 100, 10 };
static void put_dec(char row, char col, unsigned v, char width)
{
    char *p = SCREEN + 40 * row + col;
    char k = 4 - (width - 1);                 // first power for this width
    for (; k < 4; k++)
    {
        unsigned d = pow10[k];
        char n = '0';
        while (v >= d) { v -= d; n++; }
        *p++ = n;
    }
    *p = '0' + (char)v;
}

// PETSCII from the drive to screen codes: digits and punctuation map to
// themselves, upper-case letters $41..$5A become 1..26.
static void put_petscii(char row, char col, const char *s, char max)
{
    char *p = SCREEN + 40 * row + col;
    char i = 0;
    bool ended = false;
    while (i < max)
    {
        char c = ended ? 0 : s[i];
        if (c == 0) { ended = true; c = ' '; }
        else if (c >= 0x41 && c <= 0x5a) c -= 0x40;
        else if (c >= 0x61 && c <= 0x7a) c -= 0x60;
        else if (c < 0x20 || c > 0x5f) c = '?';
        p[i++] = c;
    }
}

// ---------------------------------------------------------------------------
// LFSR (lfsr-random.md): 16-bit Galois, right shift, taps $B400.
static unsigned rng;

static char rnd(void)
{
    unsigned s = rng;
    char carry = s & 1;
    s >>= 1;
    if (carry) s ^= 0xb400;
    rng = s;
    return (char)s;
}

// ---------------------------------------------------------------------------
// Tile map (tile-map-render.md RLE, one stream per row)
static char map[MAP_W * MAP_H];
static const char tile_code[4]   = { 0x20, 0xa0, 0xa0, 0x08 };   // ' ', block, block, 'H'
static const char tile_colour[4] = { 0,    9,    12,   7    };   // -, brown, grey, yellow

static const char *rle_row(const char *src, char *dst, char *len)
{
    char n = 0;
    for (;;)
    {
        char c = *src++;
        if (c == 0)
            break;
        if (c & 0x80)
        {
            char v = *src++;
            char k = c & 0x7f;
            do { dst[n++] = v; } while (--k);
        }
        else
        {
            do { dst[n++] = *src++; } while (--c);
        }
    }
    *len = n;
    return src;
}

static unsigned fold(unsigned chk, unsigned v)
{
    return (chk ^ v) * 5 + 1;
}

static void map_decode_and_draw(void)
{
    const char *src = map_rle;
    for (char y = 0; y < MAP_H; y++)
    {
        char len;
        char *row = map + y * MAP_W;
        src = rle_row(src, row, &len);
        ASSERT(len == MAP_W, 1);
        unsigned chk = 0;
        for (char x = 0; x < MAP_W; x++)
            chk = fold(chk, row[x]);
        ASSERT(chk == map_row_chk[y], 2);
        char *s = SCREEN + (MAP_ROW + y) * 40;
        char *k = COLOUR + (MAP_ROW + y) * 40;
        for (char x = 0; x < MAP_W; x++)
        {
            char t = row[x];
            s[x] = tile_code[t];
            k[x] = tile_colour[t];
        }
    }
    ASSERT(src == map_rle + MAP_STREAM_LEN, 3);
}

// Tile at world pixel (wx 0..319, wy 0..199). Outside the map is empty
// above and solid below/sideways so nothing escapes.
static char tile_at(int wx, int wy)
{
    if (wx < 0 || wx >= 320) return T_BRICK;
    int ty = (wy >> 3) - MAP_ROW;
    if (ty < 0) return T_EMPTY;
    if (ty >= MAP_H) return T_BRICK;
    return map[ty * MAP_W + (wx >> 3)];
}

static bool solid_at(int wx, int wy)
{
    char t = tile_at(wx, wy);
    return t == T_BRICK || t == T_PLAT;
}

// ---------------------------------------------------------------------------
// Player
// Position: Y is 8.8 in an UNSIGNED 16-bit word (max 200*256 = 51200; a
// signed int wraps at 128 px, which the fixed-point-jump page warns about).
// X needs 9 bits of pixel, so it is an int of pixels plus an 8-bit fraction:
// the walk adds WALK_SPEED to the fraction and carries into the pixel.
static int      px_i;                      // world px of the sprite's left edge
static char     px_sub;                    // fraction of a pixel (1/256)
static unsigned py_fp;                     // 8.8 world py of the sprite's top
static int      vy_fp;                     // 8.8, + is down
static char jump_n;                        // 0 = not in the table part of a jump
static bool on_ground, on_ladder;
static char facing;                        // 0 right, 1 left
static char invuln;                        // frames of invulnerability left
static char lives;
static unsigned score, hiscore;
static bool game_over;
static char blocked_x;                     // set when a wall stopped the walk

static void player_reset(void)
{
    px_i = PLAYER_START_X;
    px_sub = 0;
    py_fp = (unsigned)PLAYER_START_Y << 8;
    vy_fp = 0;
    jump_n = 0;
    on_ground = true;
    on_ladder = false;
    facing = 0;
}

// ---------------------------------------------------------------------------
// Sound (sfx-engine.md): the tune stub writes all three voices every frame;
// the jump effect borrows voice 2 and re-pokes it after the tune each frame.
// Nobody has listened to this; it is register-level only.
struct SfxFrame { unsigned freq; char ctrl; };
#define SFX_END 0xff
static const struct SfxFrame jump_frames[] = {
    { 0x1000, SID_CTRL_TEST | SID_CTRL_GATE },
    { 0x1200, SID_CTRL_TRI | SID_CTRL_GATE },
    { 0x1600, SID_CTRL_TRI | SID_CTRL_GATE },
    { 0x1c00, SID_CTRL_TRI | SID_CTRL_GATE },
    { 0x2400, SID_CTRL_TRI | SID_CTRL_GATE },
    { 0x2c00, SID_CTRL_TRI | SID_CTRL_GATE },
    { 0x3000, SID_CTRL_TRI },
    { 0x2800, SID_CTRL_TRI },
    { 0x0000, SFX_END }
};
static const struct SfxFrame *sfx_pos;     // 0 = voice 2 belongs to the tune
static unsigned sfx_started;
static unsigned tune_frame;
static const unsigned tune_base[3] = { 0x0800, 0x0c00, 0x1200 };

static void tune_play(void)
{
    char step = tune_frame & 31;
    char gate = (tune_frame & 8) ? SID_CTRL_GATE : 0;
    volatile char *r = (volatile char *)0xd400;
    for (char v = 0; v < 3; v++)
    {
        unsigned f = tune_base[v] + (unsigned)step * 16;
        r[0] = (char)f;
        r[1] = f >> 8;
        r[2] = 0x00;
        r[3] = 0x04;
        r[4] = SID_CTRL_TRI | gate;
        r[5] = SID_ATK_8 | SID_DKY_168;
        r[6] = 0x80 | SID_DKY_300;
        r += 7;
    }
    sid.fmodevol = 0x0f;
    tune_frame++;
}

static void sfx_jump(void)
{
    sfx_pos = jump_frames;
    sfx_started++;
}

static void sfx_update(void)
{
    if (!sfx_pos) return;
    if (sfx_pos->ctrl == SFX_END) { sfx_pos = nullptr; return; }
    volatile char *r = (volatile char *)0xd407;      // voice 2
    r[5] = SID_ATK_2 | SID_DKY_48;
    r[6] = 0xa0 | SID_DKY_204;
    r[0] = (char)sfx_pos->freq;
    r[1] = sfx_pos->freq >> 8;
    r[2] = 0x00;
    r[3] = 0x08;
    r[4] = sfx_pos->ctrl;
    sfx_pos++;
}

// ---------------------------------------------------------------------------
// Object pool (object-pool.md): parallel arrays, scan allocator.
static char obj_state[MAX_OBJ];
static char obj_type[MAX_OBJ];
static int  obj_x[MAX_OBJ];                // world px, may run past either edge
static char obj_y[MAX_OBJ];                // world py (sprite top)
static signed char obj_dx[MAX_OBJ];
static char obj_anim[MAX_OBJ];
static unsigned spawned, despawned, spawn_refused;

// Wave table: frame offset within a cycle, type (1 slow, 2 fast), count.
// Rows and directions come from the LFSR so no two cycles look alike.
struct Wave { unsigned frame; char type; char count; };
static const struct Wave wave_table[] = {
    {  30, 1, 1 },
    {  90, 1, 2 },
    { 150, 2, 1 },
    { 210, 1, 2 },
    { 270, 2, 2 },
    { 330, 1, 3 },
    { 390, 2, 2 },
    { 0xffff, 0, 0 }
};
#define WAVE_CYCLE 450
static char wave_pos;
static unsigned wave_base;

static char pool_alloc(void)
{
    for (char i = 0; i < MAX_OBJ; i++)
        if (obj_state[i] == OBJ_FREE)
            return i;
    return NO_SLOT;
}

static void spawn_enemy(char type)
{
    char s = pool_alloc();
    if (s == NO_SLOT) { spawn_refused++; return; }
    char r = rnd();
    char row = platform_rows[r % N_PLATFORM_ROWS];
    char speed = (type == 2) ? 2 : 1;
    obj_type[s] = type;
    obj_y[s] = (MAP_ROW + row) * 8 - 21;               // feet on the tile top
    if (r & 0x80) { obj_x[s] = -24; obj_dx[s] = speed; }
    else          { obj_x[s] = 320; obj_dx[s] = -speed; }
    obj_anim[s] = 0;
    obj_state[s] = OBJ_ALIVE;
    spawned++;
}

static void wave_step(unsigned frame)
{
    unsigned rel = frame - wave_base;
    if (rel >= WAVE_CYCLE)
    {
        wave_base = frame;
        wave_pos = 0;
        rel = 0;
    }
    while (wave_table[wave_pos].frame == rel)
    {
        char n = wave_table[wave_pos].count;
        for (char k = 0; k < n; k++)
            spawn_enemy(wave_table[wave_pos].type);
        wave_pos++;
        ASSERT(wave_pos < 8, 4);
    }
}

static void update_enemies(void)
{
    for (char i = 0; i < MAX_OBJ; i++)
    {
        if (obj_state[i] == OBJ_FREE)
        {
            spr_show(1 + i, false);
            continue;
        }
        ASSERT(obj_state[i] == OBJ_ALIVE, 5);
        int x = obj_x[i] + obj_dx[i];
        obj_x[i] = x;
        if (x <= -24 || x >= 320)
        {
            obj_state[i] = OBJ_FREE;       // left the screen: despawn
            despawned++;
            score += 10;                   // dodged
            spr_show(1 + i, false);
            continue;
        }
        obj_anim[i]++;
        spr_image(1 + i, (obj_anim[i] & 8) ? 14 : 15);
        spr_color(1 + i, obj_type[i] == 2 ? VCOL_LT_RED : VCOL_CYAN);
        spr_move(1 + i, x + 24, obj_y[i] + 50);
        spr_show(1 + i, true);
    }
}

// ---------------------------------------------------------------------------
// Input (joystick-input.md): press events by previous-frame comparison,
// delayed auto-repeat on the horizontal lines.
struct JoyEvents { char newp, held, released; };

static void joy_edge(char prev, char cur, struct JoyEvents *e)
{
    char pressed = ~cur & JOY_MASK;
    e->newp     = pressed & prev;
    e->held     = pressed & ~prev & JOY_MASK;
    e->released = cur & ~prev & JOY_MASK;
}

// Auto-repeat rule: fires on the first frame of a press, again after
// REPEAT_DELAY frames, then every REPEAT_RATE frames while held. It is
// used for the ladder step so a held UP climbs one tile per repeat burst
// rather than sliding; left/right are level-driven (held moves).
static char repeat_step(char *age, bool pressed)
{
    if (!pressed) { *age = 0; return 0; }
    char a = *age + 1;
    if (a == REPEAT_DELAY + REPEAT_RATE) a = REPEAT_DELAY;
    *age = a;
    return (a == 1 || a == REPEAT_DELAY) ? 1 : 0;
}

#if AUTOPILOT
// The autopilot: a synthetic active-low port byte from the game's LFSR.
// It walks in one direction for a random spell, turns round at walls,
// jumps at random and when an enemy is near on its own row, and climbs
// when standing at a ladder. Fire is a one-frame pulse so the edge
// detector sees a press event exactly as a real stick would give one.
static char ap_dir;                        // JOY_LEFT or JOY_RIGHT
static char ap_spell;                      // frames left in this spell
static char ap_climb;                      // frames left climbing

static char autopilot_port(void)
{
    char out = 0xff;
    if (ap_spell == 0 || blocked_x)
    {
        char r = rnd();
        ap_dir = (r & 1) ? JOY_LEFT : JOY_RIGHT;
        if (blocked_x) ap_dir = (ap_dir == JOY_LEFT) ? JOY_RIGHT : JOY_LEFT;
        ap_spell = 30 + (r >> 2);
    }
    ap_spell--;
    int px = px_i;
    int py = (int)(py_fp >> 8);
    bool near = false;
    for (char i = 0; i < MAX_OBJ; i++)
    {
        if (obj_state[i] != OBJ_ALIVE) continue;
        if (obj_y[i] != py) continue;
        int d = obj_x[i] - px;
        if (d < 0) d = -d;
        if (d < 48 && d > 12) near = true;
    }
    char r = rnd();
    if (on_ladder || ap_climb)
    {
        if (ap_climb == 0) ap_climb = 40 + (r & 31);
        ap_climb--;
        out &= ~JOY_UP;
        return out;
    }
    if (tile_at(px + 12, py + BODY_B + 1) == T_LADDER && (r & 3) == 0)
    {
        ap_climb = 40;
        out &= ~JOY_UP;
        return out;
    }
    out &= ~ap_dir;
    if (on_ground && (near || (r & 31) == 0))
        out &= ~JOY_FIRE;
    return out;
}
#endif

// ---------------------------------------------------------------------------
// Player physics with tile-grid collision. The KB has prose for this and no
// listing (GAPS.md G3): probe points are the body's corners in world pixels.
static void player_update(char cur, struct JoyEvents *ev, char repeat_fire)
{
    int px = px_i;
    int py = (int)(py_fp >> 8);
    blocked_x = 0;

    // Horizontal: level-driven, blocked by a solid at either body corner.
    // Step = WALK_SPEED>>8 whole pixels plus a carry out of the fraction.
    if (!(cur & JOY_LEFT) || !(cur & JOY_RIGHT))
    {
        unsigned t = px_sub + (WALK_SPEED & 0xff);
        int step = (WALK_SPEED >> 8) + (t >> 8);
        int nx = px;
        if (!(cur & JOY_LEFT))  { nx = px - step; facing = 1; }
        else                    { nx = px + step; facing = 0; }
        int probe = (nx > px) ? nx + BODY_R : nx + BODY_L;
        if (solid_at(probe, py + BODY_T) || solid_at(probe, py + BODY_B))
            blocked_x = 1;
        else
        {
            px_sub = (char)t;
            px_i = nx;
            px = nx;
        }
    }

    // Ladder: centre column over a ladder tile at mid-body or under the feet.
    int cx = px + 12;
    char mid = tile_at(cx, py + 13);
    char below = tile_at(cx, py + BODY_B + 1);
    on_ladder = (mid == T_LADDER) || (below == T_LADDER && !(cur & JOY_DOWN));

    if (on_ladder && (!(cur & JOY_UP) || !(cur & JOY_DOWN)))
    {
        vy_fp = 0;
        jump_n = 0;
        if (!(cur & JOY_UP))
        {
            if (tile_at(cx, py + 13 - CLIMB_SPEED) == T_LADDER ||
                tile_at(cx, py + BODY_B) == T_LADDER)
                py_fp -= CLIMB_SPEED << 8;
        }
        else
        {
            if (!solid_at(cx, py + BODY_B + 1 + CLIMB_SPEED))
                py_fp += CLIMB_SPEED << 8;
        }
        py = (int)(py_fp >> 8);
    }
    else
    {
        on_ground = solid_at(px + BODY_L, py + BODY_B + 1) ||
                    solid_at(px + BODY_R, py + BODY_B + 1);
        if (on_ladder && mid == T_LADDER) on_ground = true;   // hanging still

        if (on_ground && jump_n == 0 && (ev->newp & JOY_FIRE))
        {
            jump_n = 1;
            vy_fp = jump_vy[0];
            sfx_jump();
        }
        else if (jump_n)
        {
            if (jump_n < JUMP_FRAMES) vy_fp = jump_vy[jump_n++];
            else { vy_fp += GRAVITY; if (vy_fp > MAX_FALL) vy_fp = MAX_FALL; }
        }
        else if (!on_ground)
        {
            vy_fp += GRAVITY;
            if (vy_fp > MAX_FALL) vy_fp = MAX_FALL;
        }
        else
            vy_fp = 0;

        if (vy_fp)
        {
            py_fp += (unsigned)vy_fp;
            int ny = (int)(py_fp >> 8);
            if (vy_fp > 0)
            {
                // landing: feet crossed into a solid tile -> snap to its top
                if (solid_at(px + BODY_L, ny + BODY_B) || solid_at(px + BODY_R, ny + BODY_B))
                {
                    int top = ((ny + BODY_B) & ~7);
                    ny = top - BODY_B - 1;
                    py_fp = (unsigned)ny << 8;
                    vy_fp = 0;
                    jump_n = 0;
                    on_ground = true;
                }
            }
            else
            {
                // head bump
                if (solid_at(px + BODY_L, ny + BODY_T) || solid_at(px + BODY_R, ny + BODY_T))
                {
                    int bottom = ((ny + BODY_T) | 7) + 1;
                    ny = bottom - BODY_T;
                    py_fp = (unsigned)ny << 8;
                    vy_fp = 0;
                    jump_n = JUMP_FRAMES;          // fall from here
                }
            }
            py = ny;
        }
    }

    ASSERT(py >= 0 && py < 200, 6);
    ASSERT(px >= 0 && px < 320, 7);

    (void)repeat_fire;
}

static void player_draw(unsigned frame)
{
    int px = px_i;
    int py = (int)(py_fp >> 8);
    bool show = true;
    if (invuln && (frame & 4)) show = false;
    spr_move(0, px + 24, py + 50);
    spr_color(0, facing ? VCOL_YELLOW : VCOL_WHITE);
    spr_show(0, show);
}

static bool hit_enemy(void)
{
    int px = px_i;
    int py = (int)(py_fp >> 8);
    for (char i = 0; i < MAX_OBJ; i++)
    {
        if (obj_state[i] != OBJ_ALIVE) continue;
        int dx = obj_x[i] - px; if (dx < 0) dx = -dx;
        int dy = (int)obj_y[i] - py; if (dy < 0) dy = -dy;
        if (dx < 8 && dy < 16) return true;
    }
    return false;
}

// ---------------------------------------------------------------------------
// High score on disk (high-score-persist.md): 5-byte SEQ record, first run
// gets 62 FILE NOT FOUND and writes; later runs load; replace = scratch+write.
#define DRIVE 8
static char  hs_rec[5];
static char  hs_back[16];
static char  reply[40];
static char  drive_code;
static bool  drive_ok;
static bool  io_frame;                     // disk I/O ran this frame: timer B is not ours
static char  disk_state;                   // screen letter: L loaded, F first, W written, X off

static void drive_reply(const char *cmd)
{
    reply[0] = 0;
    drive_code = 99;
    krnio_setnam(cmd);
    if (krnio_open(15, DRIVE, 15))
    {
            int n = krnio_gets(15, reply, sizeof(reply));
            if (n > 0 && reply[n - 1] == 13) reply[n - 1] = 0;
        if (n >= 2) drive_code = (reply[0] - '0') * 10 + (reply[1] - '0');
        krnio_close(15);
    }
    put_str(DRIVE_ROW, 0, "drive:");
    put_petscii(DRIVE_ROW, 7, reply, 33);
}

static int hs_load(void)
{
    krnio_setnam("HISCORE,S,R");
    bool ok = krnio_open(2, DRIVE, 2);
    if (!ok && (krnio_status() & KRNIO_NODEVICE))
    {
        krnio_close(2);
        put_str(DRIVE_ROW, 0, "drive: no device");
        drive_code = 99;
        drive_ok = false;
        return 0;
    }
    int n = 0;
    if (ok) n = krnio_read(2, hs_back, sizeof(hs_back));
    krnio_close(2);
    drive_reply("");
    return n;
}

static bool hs_save(void)
{
    hs_rec[0] = 'K'; hs_rec[1] = 'B'; hs_rec[2] = 1;
    hs_rec[3] = (char)hiscore; hs_rec[4] = hiscore >> 8;
    krnio_setnam("HISCORE,S,W");
    bool ok = krnio_open(2, DRIVE, 2);
    if (ok) krnio_write(2, hs_rec, 5);
    krnio_close(2);
    drive_reply("");
    return ok && drive_code == 0;
}

static void hs_start(void)
{
    drive_ok = true;
    hiscore = 0;
    int n = hs_load();
    if (drive_code == 0 && n == 5 && hs_back[0] == 'K' && hs_back[1] == 'B' && hs_back[2] == 1)
    {
        hiscore = hs_back[3] | ((unsigned)hs_back[4] << 8);
        disk_state = 'l' - 'a' + 1;                     // L: loaded
    }
    else if (drive_code == 62)
    {
        disk_state = 'f' - 'a' + 1;                     // F: first run
    }
    else
    {
        drive_ok = false;
        disk_state = 'x' - 'a' + 1;                     // X: saving off
    }
}

// Game over: replace the file (scratch, then write), read it back, show it.
static unsigned hs_readback;
static void hs_game_over(void)
{
    if (!drive_ok) return;
    drive_reply("S0:HISCORE");
    if (hs_save())
    {
        int n = hs_load();
        if (n == 5) hs_readback = hs_back[3] | ((unsigned)hs_back[4] << 8);
        disk_state = 'w' - 'a' + 1;                     // W: written and read back
        put_str(CYC_ROW, 27, "back");
        put_dec(CYC_ROW, 32, hs_readback, 5);
    }
    else
        disk_state = 'e' - 'a' + 1;                     // E: write failed
}

// ---------------------------------------------------------------------------
// Sprites: a small figure for the player, two enemy frames.
static void make_sprites(void)
{
    for (char i = 0; i < 64; i++) { SPR_PLAYER[i] = 0; SPR_ENEMY_A[i] = 0; SPR_ENEMY_B[i] = 0; }
    // Player: rows 5..20, byte 1 of each row (x 8..15)
    static const char body[16] = {
        0x3c, 0x7e, 0x5a, 0x7e, 0x3c, 0x18, 0x7e, 0xdb,
        0x99, 0x18, 0x18, 0x3c, 0x24, 0x24, 0x66, 0x66 };
    for (char r = 0; r < 16; r++) SPR_PLAYER[(BODY_T + r) * 3 + 1] = body[r];
    // Enemy A / B: a crab-ish blob, two frames
    static const char ea[16] = {
        0x18, 0x3c, 0x7e, 0xff, 0xdb, 0xff, 0x7e, 0x3c,
        0x5a, 0x99, 0x18, 0x24, 0x42, 0x81, 0x00, 0x00 };
    static const char eb[16] = {
        0x18, 0x3c, 0x7e, 0xff, 0xdb, 0xff, 0x7e, 0x3c,
        0x5a, 0x24, 0x24, 0x42, 0x42, 0x00, 0x00, 0x00 };
    for (char r = 0; r < 16; r++)
    {
        SPR_ENEMY_A[(BODY_T + r) * 3 + 1] = ea[r];
        SPR_ENEMY_B[(BODY_T + r) * 3 + 1] = eb[r];
    }
}

// ---------------------------------------------------------------------------
// Frame sync (frame-sync-loop.md)
RIRQCode frame_irq;
volatile char irq_ticks;

__interrupt void on_frame(void)
{
    irq_ticks++;
}

// CIA1 timer B harness (tile-map-render.md): the KERNAL owns timer A.
static inline void timer_start(void)
{
    cia1.crb = 0x00;
    cia1.tb = 0xffff;
    cia1.crb = 0x11;
}
static inline unsigned timer_stop(void)
{
    cia1.crb = 0x00;
    return 0xffff - cia1.tb;
}

// Only fields that changed are rewritten; frame and cyc change every frame.
static unsigned hud_score = 0xffff, hud_hi = 0xffff, hud_max = 0xffff, hud_drop = 0xffff;
static char hud_lives = 0xff;
static void hud_draw(unsigned frame, unsigned cyc, unsigned cyc_max, unsigned dropped)
{
    if (score != hud_score)   { hud_score = score;   put_dec(HUD_ROW, 6, score, 5); }
    if (lives != hud_lives)   { hud_lives = lives;   put_dec(HUD_ROW, 18, lives, 1); }
    if (hiscore != hud_hi)    { hud_hi = hiscore;    put_dec(HUD_ROW, 23, hiscore, 5); }
    put_dec(HUD_ROW, 31, frame, 5);
    SCREEN[HUD_ROW * 40 + 38] = disk_state;
    put_dec(CYC_ROW, 4, cyc, 5);
    if (cyc_max != hud_max)   { hud_max = cyc_max;   put_dec(CYC_ROW, 14, cyc_max, 5); }
    if (dropped != hud_drop)  { hud_drop = dropped;  put_dec(CYC_ROW, 25, dropped, 2); }
    SCREEN[CYC_ROW * 40 + 32] = '0' + fault_code;
}

static void game_reset(void)
{
    lives = 3;
    score = 0;
    invuln = 60;
    game_over = false;
    for (char i = 0; i < MAX_OBJ; i++) obj_state[i] = OBJ_FREE;
    player_reset();
}

int main(void)
{
    for (unsigned i = 0; i < 1000; i++) { SCREEN[i] = 0x20; COLOUR[i] = VCOL_WHITE; }
    vic.color_back = VCOL_BLACK;
    vic.color_border = VCOL_BLACK;

    put_str(HUD_ROW, 0, "score 00000 lives 3 hi 00000 f 00000 d");
    put_str(CYC_ROW, 0, "cyc 00000 max 00000 drop 00 err 0");

    map_decode_and_draw();
    make_sprites();

    // Seed the LFSR from SID voice 3 noise (lfsr-random.md); voice 3 is
    // muted by bit 7 of $D418 so the tune's volume nibble is unaffected.
    sid.voices[2].freq = 0xffff;
    sid.voices[2].ctrl = SID_CTRL_NOISE | SID_CTRL_GATE;
    sid.fmodevol = SID_FMODE_3_OFF | 15;
    rng = sid.random;
    for (char i = 0; i < 50; i++) rnd();
    rng = (rng << 8) | sid.random;
    if (rng == 0) rng = 0xace1;

    // High score from disk, before the raster IRQ owns the frame. The wait
    // is deliberate: a build of this program with no wait hung in the first
    // OPEN on PAL (never on NTSC), and a build with seven extra stores did
    // not; giving the autostart a second to let go of the drive removed it
    // for the hanging layout as well (see NOTES.md).
#ifndef DISK_WAIT_FRAMES
#define DISK_WAIT_FRAMES 50
#endif
    for (char i = 0; i < DISK_WAIT_FRAMES; i++) vic_waitFrame();
    hs_start();

    spr_init(SCREEN);
    spr_set(0, true, PLAYER_START_X + 24, PLAYER_START_Y + 50, 13, VCOL_WHITE, false, false, false);
    for (char i = 0; i < MAX_OBJ; i++)
        spr_set(1 + i, false, 0, 0, 14, VCOL_CYAN, false, false, false);

    game_reset();

    rirq_init(true);
    rirq_build(&frame_irq, 1);
    rirq_call(&frame_irq, 0, on_frame);
    rirq_set(0, SYNC_ROW, &frame_irq);
    rirq_sort();
    rirq_start();

    unsigned frame = 0, dropped = 0;
    unsigned cyc = 0, cyc_max = 0;
    char seen = irq_ticks;
    char prev = 0xff;
    char up_age = 0;
    bool passed = false, halted = false;
    struct JoyEvents ev;

    for (;;)
    {
        while (irq_ticks == seen)
            ;
        char delta = irq_ticks - seen;
        seen += delta;
        if (delta > 1) dropped += delta - 1;

#if BUDGET_BAR
        if (!passed && !fault_code) vic.color_border = VCOL_WHITE;
#endif
        timer_start();

        if (!halted)
        {
            // --- input ---
#if AUTOPILOT
            char cur = autopilot_port();
#else
            cia1.ddra = 0xff; cia1.ddrb = 0x00; cia1.pra = 0xff;
            char cur = cia1.pra;                 // port 2
#endif
            joy_edge(prev, cur, &ev);
            prev = cur;
            char rep = repeat_step(&up_age, !(cur & JOY_UP));

            // --- simulation ---
            wave_step(frame);
            update_enemies();
            player_update(cur, &ev, rep);
            if (invuln) invuln--;
            else if (hit_enemy())
            {
                lives--;
                invuln = 90;
                player_reset();
                if (lives == 0) game_over = true;
            }
            if ((frame & 7) == 0) score++;
            if (score > hiscore) hiscore = score;

            // --- sound: tune first, then the effect re-pokes voice 2 ---
            tune_play();
            sfx_update();

            // --- draw ---
            player_draw(frame);

#if AUTOPILOT
            if (frame == FORCE_OVER && !game_over) { lives = 0; game_over = true; }
#endif
            if (game_over)
            {
                for (char i = 0; i < MAX_OBJ; i++) { obj_state[i] = OBJ_FREE; spr_show(1 + i, false); }
                sid.fmodevol = SID_FMODE_3_OFF;      // silence: the tune stops
                rirq_stop();                         // the KERNAL serial code gets the CPU
                io_frame = true;
                hs_game_over();
                rirq_start();
                seen = irq_ticks;
#if AUTOPILOT
                if (frame >= FORCE_OVER) { halted = true; put_str(DRIVE_ROW - 12, 14, "game over"); }
                else game_reset();
#else
                game_reset();
#endif
            }
            frame++;
        }

        // The HUD is inside the timed region: cyc is the whole loop body,
        // shown one frame late (the value on screen is the previous frame's).
        hud_draw(frame, cyc, cyc_max, dropped);
        cyc = timer_stop();
        if (io_frame) io_frame = false;              // KERNAL used timer B: discard
        else if (cyc > cyc_max && frame > 2) cyc_max = cyc;

#if AUTOPILOT
        if (frame == PASS_FRAME && !passed && !fault_code)
        {
            passed = true;
            RESULT = CODE_PASS;
            vic.color_border = 5;
        }
#endif
#if BUDGET_BAR
        if (!passed && !fault_code) vic.color_border = VCOL_BLACK;
#endif
    }
    return 0;
}
