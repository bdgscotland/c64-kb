---
recipe: lane-pursuit
toolchain: oscar64
output_format: PRG
region: both
techniques: [lane_pursuit_ai]
file_formats: [PRG]
uses_registers: [D000, D001, D002, D003, D004, D005, D006, D007, D008, D009, D010, D011, D015, D020, D021, D022, D023, D027, D028, D029, D02A, D02B, DC06, DC07, DC0F]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 Lane Pursuit: road cars that pull alongside, ram and avoid the edges, checked against a model

## Synopsis

A road-game pursuit AI on an original scrolling road. The road narrows
from the left, widens again, and is then split in two by a water island,
the fork-like obstacle. The player car (yellow, sprite 0) drives on
autopilot, weaving, and takes the left channel at the island. Four
pursuit cars (sprites 1 to 4) enter from behind and ahead on a spawn
table and run one state machine: approach a slot beside the player, hold
it, ram with a lead on the player's sideways velocity, back off, and
leave when shot. Each car steers with a capped proportional rule in 8.8
fixed point, keeps a spacing box from the other pursuers, and probes the
map ahead of its nose so it never drives onto the verge or the water.
A "frame" on this page is one logic step. Pass 1 runs 780 of them on
screen, one every second video frame (measured below), and folds every
car's state and x into a checksum each step; every 78 steps it is
compared with a Python model of the same rules, compiled in. Then, with
the display off, pass 2 reruns the 780 steps under CIA1 timer B, and a
built worst frame is timed.
`$02FF` = `01` and a green border on pass, `02` and red on fail. This is
`lane_pursuit_ai` in `docs/techniques/logic.md`; the result-byte contract
is `headless-verify.md`.

## Source

```c
// lane-pursuit.c
//
// Lane-pursuit AI for a vertical road game. A "frame" below is one logic
// step. A road scrolls down the screen at 2 pixels a step: a wide
// stretch, a narrowing from the left, and a water island that splits the
// road in two. The player car (sprite 0) is on autopilot: it steers
// toward the centre of the leftmost road run 32 pixels ahead, plus a
// triangle weave. Four pursuit cars (sprites 1 to 4)
// enter from behind or ahead on a spawn table and run one state machine:
// APPROACH to a slot 24 pixels beside the player (one car per side),
// ALONG for 40 frames, RAM toward the player's position led by 8 frames of
// its lateral velocity, BACK off 40 pixels behind, and LEAVE when shot
// (car 3 at frame 330), freeing the slot 150 pixels behind. Steering is a
// proportional rule in 8.8 with a speed cap and an acceleration cap;
// forward speed is held relative to the player's the same way. Each car
// keeps a spacing box from the other pursuers, probes the map row 32
// pixels ahead of its nose across the span it will sweep, and when that is
// blocked steers 32 pixels toward the side with more road; otherwise a side
// probe 12 pixels beyond its body stops it steering into an edge.
// Pass 1 runs 780 frames on screen, one every second video frame because a
// step and its redraw overrun one; each frame every car's state and x are
// folded into a checksum, checked every 78 frames against a Python model of
// the same rules compiled in below. Then, with the display and sprites
// off, pass 2 reruns the 780 frames under CIA1 timer B, and a built worst
// frame is timed.
// Row 0: frame, checksum, checkpoints matched, result, leaves. Row 1:
// contacts, rams, avoid frames, hold frames, spacing frames. Row 23: CIA1
// cycles per car update, mean and worst of pass 2, built worst car, the
// edge probes on their own. Row 24: worst frame of pass 2, built worst
// frame, empty timer pair.
// $02FF = 01 and a green border on pass, 02 and red on fail.
// Build: oscar64 -tm=c64 -O2 -o=lane-pursuit.prg lane-pursuit.c

#include <c64/vic.h>
#include <c64/cia.h>
#include <string.h>

#define SCREEN ((char *)0x0400)
#define COLOUR ((char *)0xd800)
#define SPRPTR ((char *)0x07f8)
#define SPRDATA ((char *)0x0340)           // blocks 13 and 14, cassette buffer
#define RESULT (*(volatile char *)0x02ff)
#define CODE_PASS 0x01
#define CODE_FAIL 0x02

#define NCAR 4
#define FRAMES 780
#define CKSTEP 78
#define NCK 10
#define MW 32                              // map tiles across
#define MH 64                              // map rows per loop
#define ROAD 0x20                          // ECM: space on background 0
#define VERGE 0x60                         // space on background 1
#define WATER 0xa0                         // space on background 2
#define PSPD 32                            // player speed, 1/16 px a frame
#define CW 12                              // car body, pixels
#define CH 16
#define LOOK 32                            // look-ahead beyond the nose, px
#define MARGIN 12                          // side probe beyond the body, px
#define SEP_X 20                           // spacing box between pursuers, px
#define SEP_Y 32
#define SIDE_DX 24
#define BACK_DX 40
#define BACK_DY 40
#define LEAD 8                             // frames of player velocity led
#define T_ALONG 40
#define T_RAM 24
#define T_BACK 50
#define VAVOID 512                         // lateral caps while avoiding, 8.8
#define AAVOID 128
#define RSMAX 24                           // relative forward caps, 1/16 px
#define RSLEAVE 48
#define FACC 2
#define NONE 0xff

#define APPROACH 1
#define ALONG 2
#define RAM 3
#define BACK 4
#define LEAVE 5

#define COL0 4                             // playfield: text columns 4 to 35
#define PROW 14                            // text row the player's tile is on

// The Python model's checksum every 78 frames and its event counts.
const unsigned exp_ck[NCK] = {
    0xf84d, 0x45ab, 0x6a75, 0xd437, 0x8f47, 0xebe2, 0x37fc, 0x8460, 0xd465, 0xba59
};
#define EXP_CONTACTS 3
#define EXP_RAMS 7
#define EXP_AVOIDS 60
#define EXP_HOLDS 318
#define EXP_SEPS 865
#define EXP_LEAVES 1

const int vmax_t[6] = {0, 256, 256, 768, 256, 256};  // lateral speed cap
const int acc_t[6] = {0, 32, 32, 96, 32, 32};        // lateral accel cap

// Spawn table: frame, slot, x, offset in px (+ ahead, - behind), shot frame.
#define NSPAWN 5
const unsigned sp_f[NSPAWN] = {8, 8, 40, 90, 420};
const char sp_k[NSPAWN] = {0, 1, 2, 3, 3};
const char sp_x[NSPAWN] = {56, 184, 176, 64, 176};
const signed char sp_dy[NSPAWN] = {-72, 104, -72, 104, -72};
const unsigned sp_shot[NSPAWN] = {0, 0, 0, 330, 0};

char map[MH][MW];
char cen[MH];                              // centre of leftmost road run, px

// Player and cars. y is world position in 1/16 px (up is +), x is 8.8.
unsigned P;
int ppx;
signed char pvx;
char st[NCAR], tm[NCAR], owner[2];
signed char side[NCAR], rs[NCAR];
unsigned x[NCAR], y[NCAR], shot[NCAR];
int vx[NCAR];
char sp;
unsigned contacts, rams, avoids, holds, seps, leaves;

static inline int iabs(int v) { return v < 0 ? -v : v; }
static inline int clampi(int v, int a, int b) { return v < a ? a : (v > b ? b : v); }
static inline int sm(int e, char s) { return e >= 0 ? e >> s : -((-e) >> s); }
static inline char tile(unsigned y16, int px) { return map[(y16 >> 7) & 63][(px >> 3) & 31]; }

void build_map(void)
{
    for (char r = 0; r < MH; r++) {
        char L = 6, R = 26, i0 = 0, i1 = 0;
        if (r >= 16 && r <= 23) L = 6 + (r - 15);
        else if (r >= 24 && r <= 31) L = 14;
        else if (r >= 32 && r <= 35) L = 14 - 2 * (r - 31);
        if (r >= 38 && r <= 49) { i0 = 14; i1 = 18; }
        for (char c = 0; c < MW; c++) {
            char t = ROAD;
            if (c < L || c >= R) t = VERGE;
            else if (c >= i0 && c < i1) t = WATER;
            map[r][c] = t;
        }
        char e = L;
        while (e < MW && map[r][e] == ROAD)
            e++;
        cen[r] = (L + e) * 4;
    }
}

void init(void)
{
    P = 1024 * 16;
    ppx = cen[(P >> 7) & 63] - 6;
    pvx = 0;
    for (char i = 0; i < NCAR; i++) {
        st[i] = 0; x[i] = 0; vx[i] = 0; y[i] = 0; rs[i] = 0;
        side[i] = 1; tm[i] = 0; shot[i] = 0;
    }
    contacts = rams = avoids = holds = seps = leaves = 0;
    sp = 0;
    owner[0] = owner[1] = NONE;
}

static inline int tri(unsigned f)
{
    char t = f & 63;
    return t < 32 ? (int)t - 16 : 48 - (int)t;
}

// The autopilot stands in for the joystick; it is not the technique.
void player_step(unsigned f)
{
    P += PSPD;
    int tp = cen[((P + 32 * 16) >> 7) & 63] + tri(f) - 6;
    pvx = clampi(tp - ppx, -2, 2);
    ppx += pvx;
}

void spawn(unsigned f)
{
    while (sp < NSPAWN && sp_f[sp] == f) {
        char k = sp_k[sp];
        st[k] = APPROACH;
        x[k] = (unsigned)sp_x[sp] << 8;
        vx[k] = 0;
        y[k] = P + sp_dy[sp] * 16;
        rs[k] = 0;
        shot[k] = sp_shot[sp];
        sp++;
    }
}

// True when any tile from pixel a to pixel b on the row of y16 is not road,
// probing every 8 pixels and at b, so no tile between is skipped.
bool blocked(unsigned y16, int a, int b)
{
    const char *row = map[(y16 >> 7) & 63];
    while (a < b) {
        if (row[(a >> 3) & 31] != ROAD)
            return true;
        a += 8;
    }
    return row[(b >> 3) & 31] != ROAD;
}

char room(char r, signed char c, signed char d)
{
    char n = 0;
    for (char i = 1; i <= 8; i++) {
        c += d;
        if (c >= 0 && c < MW && map[r][c] == ROAD)
            n++;
    }
    return n;
}

static inline void release(char i)
{
    if (owner[0] == i) owner[0] = NONE;
    if (owner[1] == i) owner[1] = NONE;
}

// One pursuit car's update for frame f: state, spacing, edge probes,
// lateral and forward controllers.
void car_step(char i, unsigned f)
{
    char s = st[i];
    if (!s)
        return;
    if (shot[i] == f && s != LEAVE) {
        s = LEAVE;
        leaves++;
        release(i);
    }
    int px = x[i] >> 8;
    int rel = (int)(y[i] - P);
    int dx = px - ppx;
    int tx, rt = 0;

    switch (s) {
    case APPROACH: {
        char sd = dx >= 0 ? 1 : 0;
        if (owner[sd] != NONE && owner[sd] != i)
            sd ^= 1;
        if (owner[sd] == NONE || owner[sd] == i) {
            owner[sd] = i;
            side[i] = sd ? 1 : -1;
            tx = side[i] > 0 ? ppx + SIDE_DX : ppx - SIDE_DX;
            if (iabs(rel) < 8 * 16 && iabs(px - tx) < 6) {
                s = ALONG;
                tm[i] = T_ALONG;
            }
        } else {                           // both sides taken: queue behind
            tx = px;
            rt = -BACK_DY * 16;
        }
        break;
    }
    case ALONG:
        tx = side[i] > 0 ? ppx + SIDE_DX : ppx - SIDE_DX;
        if (--tm[i] == 0) {
            s = RAM;
            tm[i] = T_RAM;
            rams++;
        }
        break;
    case RAM:
        tx = ppx + (pvx << 3);            // LEAD = 8 frames
        tm[i]--;
        if (iabs(dx) < 14 && iabs(rel) < 16 * 16) {
            contacts++;
            s = BACK;
            tm[i] = T_BACK;
        } else if (tm[i] == 0) {
            s = BACK;
            tm[i] = T_BACK;
        }
        if (s == BACK)
            release(i);
        break;
    case BACK:
        tx = side[i] > 0 ? ppx + BACK_DX : ppx - BACK_DX;
        rt = -BACK_DY * 16;
        if (--tm[i] == 0)
            s = APPROACH;
        break;
    default:
        tx = px;
        rt = -200 * 16;
    }

    // Spacing: steer and hold back from the first pursuer too close.
    for (char j = 0; j < NCAR; j++) {
        if (j == i || !st[j])
            continue;
        int ddx = (int)(x[j] >> 8) - px;
        int ddy = (int)(y[j] - y[i]);
        if (iabs(ddx) < SEP_X && iabs(ddy) < SEP_Y * 16) {
            tx = (ddx > 0 || (ddx == 0 && i < j)) ? px - SEP_X : px + SEP_X;
            if (ddy > 0)
                rt = rel + ddy - SEP_Y * 16;
            seps++;
            break;
        }
    }

    // Edges: probe the row LOOK pixels past the nose across the swept span.
    int vmax = vmax_t[s], acc = acc_t[s];
    unsigned ahead = y[i] + (CH - 1 + LOOK) * 16;
    int qx = clampi(px + sm(vx[i], 4), 0, 255 - CW);
    int a = px < qx ? px : qx, b = (px > qx ? px : qx) + CW - 1;
    if (blocked(ahead, a, b)) {
        char r = (ahead >> 7) & 63;
        signed char c = (qx + 6) >> 3;
        tx = room(r, c, -1) > room(r, c, 1) ? px - 32 : px + 32;
        vmax = VAVOID;
        acc = AAVOID;
        avoids++;
    } else {                               // side probe toward the target
        int sx = px;
        if (tx > px) sx = px + CW - 1 + MARGIN;
        else if (tx < px) sx = px - MARGIN;
        if (sx >= 0 && sx <= 255 &&
            (tile(y[i] + (CH - 1 + 8) * 16, sx) != ROAD || tile(y[i], sx) != ROAD)) {
            tx = px;
            acc = AAVOID;
            holds++;
        }
    }
    tx = clampi(tx, 8, 236);

    // Lateral: proportional, speed cap, acceleration cap, all 8.8.
    int want = clampi((tx - px) << 4, -vmax, vmax);
    int v = vx[i];
    if (want > v + acc) v += acc;
    else if (want < v - acc) v -= acc;
    else v = want;
    vx[i] = v;
    x[i] += v;

    // Forward: speed relative to the player's, toward the wanted offset.
    int cap = s == LEAVE ? RSLEAVE : RSMAX;
    want = clampi(sm(rt - rel, 3), -cap, cap);
    int r = rs[i];
    if (want > r + FACC) r += FACC;
    else if (want < r - FACC) r -= FACC;
    else r = want;
    rs[i] = r;
    y[i] += PSPD + r;
    if (s == LEAVE && (int)(y[i] - P) < -150 * 16)
        s = 0;
    st[i] = s;
}

// --- CIA1 timer B ------------------------------------------------------------
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

// Built worst frame: the table's two frame-8 spawns land, then all four cars
// are in RAM with the timer running out (car 0 in contact with the player),
// a full spacing scan, moving right at the RAM speed cap so the ahead probe
// sweeps 60 pixels and finds the verge only at its last point, and both
// room scans run. Set-up is outside the timer.
unsigned worst_frame(void)
{
    init();
    timer_start();
    spawn(sp_f[0]);
    unsigned t = timer_stop();
    P = 0x4000;
    ppx = 145; pvx = 2;
    for (char i = 0; i < NCAR; i++) {
        st[i] = RAM; tm[i] = 1; side[i] = 1;
        x[i] = 150 << 8; vx[i] = 768; rs[i] = 0;
        y[i] = P + 128 + i * (SEP_Y * 16 + 64);
        shot[i] = 0;
    }
    owner[1] = 0;
    timer_start();
    for (char i = 0; i < NCAR; i++)
        car_step(i, 1);
    return t + timer_stop();
}

// --- screen ------------------------------------------------------------------
void put_str(char *p, const char *s)
{
    while (*s)
        *p++ = *s++;
}

void put_dec(char *p, unsigned v, char digits)
{
    for (char i = digits; i > 0; i--) {
        p[i - 1] = 0x30 + (char)(v % 10);
        v /= 10;
    }
}

void put_hex(char *p, unsigned v)
{
    for (char i = 4; i > 0; i--) {
        char n = v & 15;
        p[i - 1] = n < 10 ? 0x30 + n : n - 9;
        v >>= 4;
    }
}

// Text row r (2 to 22) shows map row prow + PROW - r.
void draw_road(void)
{
    char prow = (P >> 7) & 63;
    for (char r = 2; r <= 22; r++)
        memcpy(SCREEN + r * 40 + COL0, map[(prow + PROW - r) & 63], MW);
}

// A world y shows at sprite Y 42 + 8 PROW - (y - P floored to a tile), px,
// so a car's rear row sits on the text row of its tile.
void place(char n, int px, unsigned wy)
{
    int d = (int)(((wy - (P & 0xff80)) + 0x4000) >> 4) - 0x400;
    int sy = 42 + 8 * PROW - d;
    unsigned sx = 24 + 8 * COL0 + px;
    char bit = 1 << n;
    if (sy < 50 || sy > 220) {
        vic.spr_enable &= ~bit;
        return;
    }
    vic.spr_pos[n].x = sx;
    vic.spr_pos[n].y = sy;
    if (sx & 0x100) vic.spr_msbx |= bit;
    else vic.spr_msbx &= ~bit;
    vic.spr_enable |= bit;
}

void place_all(void)
{
    place(0, ppx, P);
    for (char i = 0; i < NCAR; i++)
        if (st[i]) place(i + 1, x[i] >> 8, y[i]);
        else vic.spr_enable &= ~(2 << i);
}

int main(void)
{
    __asm { sei }
    vic.color_border = VCOL_BLACK;
    vic.color_back = VCOL_DARK_GREY;       // road
    vic.color_back1 = VCOL_GREEN;          // verge
    vic.color_back2 = VCOL_BLUE;           // water
    vic.ctrl1 |= VIC_CTRL1_ECM;
    memset(SCREEN, ROAD, 1000);
    memset(COLOUR, VCOL_WHITE, 1000);
    build_map();

    // Sprite shapes: block 13 a 12 x 16 outline (a car), block 14 the same.
    memset(SPRDATA, 0, 128);
    for (char b = 0; b < 2; b++) {
        char *d = SPRDATA + 64 * b;
        d[0] = 0xff; d[1] = 0xf0;
        d[45] = 0xff; d[46] = 0xf0;
        for (char r = 1; r < 15; r++) {
            d[r * 3] = 0x80;
            d[r * 3 + 1] = 0x10;
        }
    }
    SPRPTR[0] = 14;
    for (char s = 1; s <= NCAR; s++)
        SPRPTR[s] = 13;
    vic.spr_color[0] = VCOL_YELLOW;
    vic.spr_color[1] = VCOL_RED;
    vic.spr_color[2] = VCOL_PURPLE;
    vic.spr_color[3] = VCOL_CYAN;
    vic.spr_color[4] = VCOL_ORANGE;
    vic.spr_msbx = 0;
    vic.spr_enable = 0;

    // Pass 1, on screen: state and x of every car into the checksum each
    // frame, checked every 78 frames.
    init();
    put_str(SCREEN, s"f      ck       ok    r");
    unsigned ck = 0;
    char ok = 0;
    for (unsigned f = 1; f <= FRAMES; f++) {
        vic_waitFrame();
        player_step(f);
        spawn(f);
        for (char i = 0; i < NCAR; i++)
            car_step(i, f);
        for (char i = 0; i < NCAR; i++) {  // the per-frame log
            ck = ck * 33 + st[i];
            ck = ck * 33 + (char)(x[i] >> 8);
        }
        if (f % CKSTEP == 0 && ck == exp_ck[f / CKSTEP - 1])
            ok++;
        draw_road();
        place_all();
        put_dec(SCREEN + 2, f, 4);
        put_hex(SCREEN + 10, ck);
    }
    unsigned c1 = contacts, r1 = rams, a1 = avoids, h1 = holds, s1 = seps, l1 = leaves;
    unsigned end_x[NCAR], end_y[NCAR];
    for (char i = 0; i < NCAR; i++) {
        end_x[i] = x[i];
        end_y[i] = y[i];
    }
    int end_p = ppx;

    // Display off (no badlines) and sprites off (no sprite DMA).
    char en = vic.spr_enable;
    vic.spr_enable = 0;
    vic.ctrl1 &= ~VIC_CTRL1_DEN;
    vic_waitFrame();

    unsigned t_empty;
    timer_start();
    t_empty = timer_stop();

    unsigned t_built = worst_frame();
    // One car of the built frame on its own: car 0, in contact, with the
    // others far off.
    init();
    P = 0x4000; ppx = 145; pvx = 2;
    st[0] = RAM; tm[0] = 1; x[0] = 150 << 8; vx[0] = 768;
    y[0] = P + 128;
    for (char i = 1; i < NCAR; i++) {      // three distant cars: full scan
        st[i] = BACK; tm[i] = 9; x[i] = 60 << 8; y[i] = P - 64 * 16 * i;
    }
    timer_start();
    car_step(0, 1);
    unsigned t_bcar = timer_stop();
    // The edge probes alone: a 52-pixel span on a clear row, so every
    // probe runs and none hits, then both room scans.
    timer_start();
    blocked(0, 150, 209 - 8);
    room(0, 20, -1);
    room(0, 20, 1);
    unsigned t_probe = timer_stop();

    // Pass 2, timed: the same 780 frames back to back, each car update
    // timed on its own. The frame figure is the spawn and the four cars.
    init();
    unsigned t_car = 0, t_frame = 0, n_upd = 0;
    unsigned long t_sum = 0;
    for (unsigned f = 1; f <= FRAMES; f++) {
        player_step(f);
        timer_start();
        spawn(f);
        unsigned tf = timer_stop();
        for (char i = 0; i < NCAR; i++) {
            char live = st[i];
            timer_start();
            car_step(i, f);
            unsigned t = timer_stop();
            tf += t;
            if (live) {
                t_sum += t;
                n_upd++;
                if (t > t_car) t_car = t;
            }
        }
        if (tf > t_frame) t_frame = tf;
    }
    char same = contacts == c1 && rams == r1 && avoids == a1 && ppx == end_p;
    for (char i = 0; i < NCAR; i++)
        if (x[i] != end_x[i] || y[i] != end_y[i])
            same = 0;
    unsigned t_mean = (unsigned)(t_sum / n_upd);

    // Pass 2 ends where pass 1 ended: that is the picture.
    draw_road();
    vic.ctrl1 |= VIC_CTRL1_DEN;
    vic.spr_enable = en;
    place_all();

    put_str(SCREEN + 40, s"con    ram    avd     hld     sep");
    put_dec(SCREEN + 44, c1, 2);
    put_dec(SCREEN + 51, r1, 2);
    put_dec(SCREEN + 58, a1, 3);
    put_dec(SCREEN + 66, h1, 3);
    put_dec(SCREEN + 74, s1, 3);
    put_str(SCREEN + 28, s"lv");
    put_dec(SCREEN + 31, l1, 1);
    put_str(SCREEN + 920, s"car mean      wst      blt            ");
    put_dec(SCREEN + 929, t_mean, 4);
    put_dec(SCREEN + 938, t_car, 4);
    put_dec(SCREEN + 947, t_bcar, 4);
    put_str(SCREEN + 952, s"prb");
    put_dec(SCREEN + 956, t_probe, 4);
    put_str(SCREEN + 960, s"frame wst       blt       tmr         ");
    put_dec(SCREEN + 970, t_frame, 5);
    put_dec(SCREEN + 980, t_built, 5);
    put_dec(SCREEN + 990, t_empty, 2);

    char fault = 0;
    if (ok != NCK) fault = 1;
    else if (c1 != EXP_CONTACTS || r1 != EXP_RAMS || a1 != EXP_AVOIDS ||
             h1 != EXP_HOLDS || s1 != EXP_SEPS || l1 != EXP_LEAVES) fault = 2;
    else if (!same) fault = 3;
    put_dec(SCREEN + 19, ok, 2);
    char code = fault ? CODE_FAIL : CODE_PASS;
    RESULT = code;
    vic.color_border = fault ? VCOL_RED : VCOL_GREEN;
    SCREEN[24] = 0x30 + code;
    SCREEN[25] = 0x30 + fault;
    for (;;)
        ;
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=lane-pursuit.prg lane-pursuit.c
```

Oscar64 1.32.271 builds it with no warnings; the PRG is 6,009 bytes.

The checksums and the event counts come from this script (Python 3). It
restates the rules independently of the C: the same road, autopilot,
spawn table, states, spacing, probes and controllers, in the same integer
arithmetic. It prints the ten `exp_ck` values and
`contacts 3 rams 7 avoids 60 leaves 1 freed 1 offroad 0 holds 318 seps 865`.
`offroad` counts car-frames with any tile under a car's 12 x 16 body not
road; the listing does not compute it, and the model's 0 is the claim
that the probes keep every car on the road.

```python
# lane_model.py: the reference for lane-pursuit.c. Same road, autopilot,
# spawn table and pursuit rules, written again in Python with the same
# integer arithmetic. Prints the checkpoint checksums and the event
# counts the listing compiles in.

NCAR, FRAMES, CKSTEP = 4, 780, 78
MW, MH = 32, 64                        # map tiles across, rows per loop
ROAD, VERGE, WATER = 0x20, 0x60, 0xA0  # ECM screen codes: bg0, bg1, bg2
PSPD = 32                              # player speed, 1/16 px a frame (2 px)
CW, CH = 12, 16                        # car body in pixels
LOOK = 32                              # look-ahead in pixels
APPROACH, ALONG, RAM, BACK, LEAVE = 1, 2, 3, 4, 5
VMAX = [0, 256, 256, 768, 256, 256]    # lateral speed cap per state, 8.8
ACC = [0, 32, 32, 96, 32, 32]          # lateral acceleration cap, 8.8
VAVOID, AAVOID = 512, 128               # caps while avoiding
RSMAX, RSLEAVE, FACC = 24, 48, 2       # relative forward speed caps, 1/16 px
SIDE_DX, BACK_DX, BACK_DY = 24, 40, 40
LEAD = 8                               # frames of player velocity to lead
T_ALONG, T_RAM, T_BACK = 40, 24, 50
SEP_X, SEP_Y = 20, 32                  # spacing box between pursuers, px
MARGIN = 12                            # side probe beyond the body, px

def build_map():
    m = []
    for r in range(MH):
        L, R, i0, i1 = 6, 26, 0, 0
        if 16 <= r <= 23: L = 6 + (r - 15)
        elif 24 <= r <= 31: L = 14
        elif 32 <= r <= 35: L = 14 - 2 * (r - 31)
        if 38 <= r <= 49: i0, i1 = 14, 18
        row = []
        for c in range(MW):
            if c < L or c >= R: row.append(VERGE)
            elif i0 <= c < i1: row.append(WATER)
            else: row.append(ROAD)
        m.append(row)
    cen = []
    for r in range(MH):
        L = min(c for c in range(MW) if m[r][c] == ROAD)
        R = L
        while R < MW and m[r][R] == ROAD: R += 1
        cen.append((L + R) * 4)        # centre of the leftmost road run, px
    return m, cen

MAP, CEN = build_map()
# spawn table: frame, slot, x px, offset px (+ ahead, - behind), shot frame
SPAWNS = [(8, 0, 56, -72, 0), (8, 1, 184, 104, 0), (40, 2, 176, -72, 0),
          (90, 3, 64, 104, 330), (420, 3, 176, -72, 0)]

def s16(v): return ((v + 0x8000) & 0xFFFF) - 0x8000
def sm(e, s): return e >> s if e >= 0 else -((-e) >> s)
def clamp(v, a, b): return a if v < a else b if v > b else v
def tile(y16, px): return MAP[(y16 >> 7) & 63][(px >> 3) & 31]

class S: pass

def init():
    s = S()
    s.P = 1024 * 16; s.ppx = CEN[(s.P >> 7) & 63] - 6; s.pvx = 0
    s.st = [0] * NCAR; s.x = [0] * NCAR; s.vx = [0] * NCAR; s.y = [0] * NCAR
    s.rs = [0] * NCAR; s.side = [1] * NCAR; s.tm = [0] * NCAR; s.shot = [0] * NCAR
    s.contacts = s.rams = s.avoids = s.leaves = s.offroad = s.freed = s.holds = s.seps = 0
    s.sp = 0; s.owner = [0xFF, 0xFF]
    return s

def tri(f):
    t = f & 63
    return t - 16 if t < 32 else 48 - t

def player_step(s, f):
    s.P = (s.P + PSPD) & 0xFFFF
    tp = CEN[((s.P + 32 * 16) >> 7) & 63] + tri(f) - 6
    s.pvx = clamp(tp - s.ppx, -2, 2)
    s.ppx += s.pvx

def spawn(s, f):
    while s.sp < len(SPAWNS) and SPAWNS[s.sp][0] == f:
        _, k, x, dy, shot = SPAWNS[s.sp]
        s.st[k] = APPROACH; s.x[k] = x << 8; s.vx[k] = 0
        s.y[k] = (s.P + dy * 16) & 0xFFFF; s.rs[k] = 0; s.shot[k] = shot
        s.sp += 1

def room(row, c, d):
    n = 0
    for i in range(1, 9):
        cc = c + d * i
        if 0 <= cc < MW and MAP[row][cc] == ROAD: n += 1
    return n

def blocked(y16, a, b):               # probe a..b every 8 px and at b
    while a < b:
        if tile(y16, a) != ROAD: return True
        a += 8
    return tile(y16, b) != ROAD

def release(s, i):
    for k in (0, 1):
        if s.owner[k] == i: s.owner[k] = 0xFF

def car_step(s, i, f):
    st = s.st[i]
    if st == 0: return
    if s.shot[i] == f and st != LEAVE:
        st = LEAVE; s.leaves += 1; release(s, i)
    px = s.x[i] >> 8
    rel = s16(s.y[i] - s.P)
    dx = px - s.ppx
    # --- state transitions and pursuit targets ---
    if st == APPROACH:
        sd = 1 if dx >= 0 else 0
        if s.owner[sd] != 0xFF and s.owner[sd] != i: sd ^= 1
        if s.owner[sd] == 0xFF or s.owner[sd] == i:
            s.owner[sd] = i; s.side[i] = 2 * sd - 1
            tx = s.ppx + s.side[i] * SIDE_DX; rt = 0
            if abs(rel) < 8 * 16 and abs(px - tx) < 6:
                st = ALONG; s.tm[i] = T_ALONG
        else:                          # both sides taken: queue behind
            tx = px; rt = -BACK_DY * 16
    elif st == ALONG:
        tx = s.ppx + s.side[i] * SIDE_DX; rt = 0
        s.tm[i] -= 1
        if s.tm[i] == 0:
            st = RAM; s.tm[i] = T_RAM; s.rams += 1
    elif st == RAM:
        tx = s.ppx + s.pvx * LEAD; rt = 0
        s.tm[i] -= 1
        if abs(dx) < 14 and abs(rel) < 16 * 16:
            s.contacts += 1; st = BACK; s.tm[i] = T_BACK
        elif s.tm[i] == 0:
            st = BACK; s.tm[i] = T_BACK
        if st == BACK: release(s, i)
    elif st == BACK:
        tx = s.ppx + s.side[i] * BACK_DX; rt = -BACK_DY * 16
        s.tm[i] -= 1
        if s.tm[i] == 0: st = APPROACH
    else:
        tx = px; rt = -200 * 16
    # --- spacing: steer and hold back from the first pursuer too close ---
    for j in range(NCAR):
        if j == i or s.st[j] == 0: continue
        ddx = (s.x[j] >> 8) - px
        ddy = s16(s.y[j] - s.y[i])
        if abs(ddx) < SEP_X and abs(ddy) < SEP_Y * 16:
            tx = px - SEP_X if ddx > 0 or (ddx == 0 and i < j) else px + SEP_X
            if ddy > 0: rt = rel + ddy - SEP_Y * 16
            s.seps += 1
            break
    # --- edge avoidance: probe the row LOOK pixels ahead ---
    vmax, acc = VMAX[st], ACC[st]
    ahead = (s.y[i] + (CH - 1 + LOOK) * 16) & 0xFFFF
    qx = clamp(px + sm(s.vx[i], 4), 0, 255 - CW)  # where the car will be
    if blocked(ahead, min(px, qx), max(px, qx) + CW - 1):
        row = (ahead >> 7) & 63; c = (qx + 6) >> 3
        tx = px - 32 if room(row, c, -1) > room(row, c, 1) else px + 32
        vmax, acc = VAVOID, AAVOID; s.avoids += 1
    else:                              # side probe: next row, toward tx
        near = (s.y[i] + (CH - 1 + 8) * 16) & 0xFFFF
        if tx > px: sx = px + CW - 1 + MARGIN
        elif tx < px: sx = px - MARGIN
        else: sx = px
        if 0 <= sx <= 255 and (tile(near, sx) != ROAD or tile(s.y[i], sx) != ROAD):
            tx = px; acc = AAVOID; s.holds += 1
    tx = clamp(tx, 8, 236)
    # --- lateral: proportional with a speed cap and an acceleration cap ---
    want = clamp((tx - px) * 16, -vmax, vmax)
    v = s.vx[i]
    if want > v + acc: v += acc
    elif want < v - acc: v -= acc
    else: v = want
    s.vx[i] = v; s.x[i] = (s.x[i] + v) & 0xFFFF
    # --- forward: relative speed toward the wanted offset ---
    cap = RSLEAVE if st == LEAVE else RSMAX
    want = clamp(sm(rt - rel, 3), -cap, cap)
    r = s.rs[i]
    if want > r + FACC: r += FACC
    elif want < r - FACC: r -= FACC
    else: r = want
    s.rs[i] = r; s.y[i] = (s.y[i] + PSPD + r) & 0xFFFF
    if st == LEAVE and s16(s.y[i] - s.P) < -150 * 16:
        st = 0; s.freed += 1
    s.st[i] = st
    if st:
        px = s.x[i] >> 8
        top = (s.y[i] + (CH - 1) * 16) & 0xFFFF
        if blocked(s.y[i], px, px + CW - 1) or blocked(top, px, px + CW - 1):
            s.offroad += 1

def run(trace=False):
    s = init(); ck = 0; cks = []; hist = set()
    for f in range(1, FRAMES + 1):
        player_step(s, f)
        spawn(s, f)
        for i in range(NCAR): car_step(s, i, f)
        for i in range(NCAR):
            ck = (ck * 33 + s.st[i]) & 0xFFFF
            ck = (ck * 33 + (s.x[i] >> 8)) & 0xFFFF
            hist.add((i, s.st[i]))
        if f % CKSTEP == 0: cks.append(ck)
        if trace and f % 10 == 0:
            print(f, s.ppx, s.pvx, [(s.st[i], s.x[i] >> 8, s16(s.y[i] - s.P) // 16) for i in range(NCAR)])
    return s, cks, hist

if __name__ == '__main__':
    import sys
    s, cks, hist = run('-t' in sys.argv)
    print('exp_ck', ', '.join('0x%04x' % c for c in cks))
    print('contacts', s.contacts, 'rams', s.rams, 'avoids', s.avoids,
          'leaves', s.leaves, 'freed', s.freed, 'offroad', s.offroad, 'holds', s.holds, 'seps', s.seps)
    print('end', s.ppx, [(s.st[i], s.x[i] >> 8, s16(s.y[i] - s.P)) for i in range(NCAR)])
    print('states seen', sorted(hist))
```

## Expected output

A grey road on green verges, with the HUD in white on the grey. Five
12 x 16 outline sprites: the player in yellow, cars 0 to 3 in red,
purple, cyan and orange. The border is green: (98, 213, 50) on PAL,
(114, 189, 103) on NTSC.

HUD at 45,000,000 cycles (measured in VICE x64sc 3.10, decoded against
the character ROM), identical on PAL and NTSC:

| Row | Text |
|---|---|
| 0 | `F 0780 CK BA59  OK 10 R 10  LV 1` |
| 1 | `CON 03 RAM 07 AVD 060 HLD 318 SEP 865` |
| 23 | `CAR MEAN 1981 WST 3162 BLT 3361 PRB 1649` |
| 24 | `FRAME WST 09871 BLT 14204 TMR 05` |

`F` is the frame, `CK` the final checksum, `OK 10` the checkpoints that
matched, `R 10` result code 1 and fault 0, `LV 1` the cars that left when
shot. Row 1 is pass 1's event counts, each equal to the model's: `CON`
rams that made contact, `RAM` rams started, `AVD` car-frames steering
away from a blocked probe, `HLD` car-frames held by the side probe, `SEP`
car-frames steered by the spacing box. Rows 23 and 24 are CIA1 cycles:
`CAR MEAN` the mean of pass 2's live car updates, `WST` the worst one,
`BLT` one car on the built worst path (in contact with the player) with
three others to scan, `PRB` the edge probes alone (a 52-pixel span of
eight probes and both 8-tile room scans); `FRAME WST` pass 2's worst
frame (spawn and four car updates), `BLT` the built worst frame (the
table's two frame-8 spawns, then four cars on the built path, car 0 in
contact), `TMR` the empty timer pair. Fault
1 is a checkpoint mismatch, 2 an event count that is not the model's, 3
pass 2 ending in another state than pass 1.

The timed figures are the same on both models because the display and
sprites are off while they run: no badlines, no sprite DMA. With the
display on, pass 1 does not keep one step per video frame. The frame
counter reads `0433` at 20,000,000 cycles and `0687` at 30,000,000 on
PAL: 254 steps in 10,000,000 cycles, 39,370 cycles a step, 2.00 PAL
frames. NTSC reads `0197` at 10,000,000 and `0490` at 20,000,000: 293
steps, 34,130 cycles a step, 2.00 NTSC frames (VICE x64sc 3.10). The
step, the redraw of 21 text rows and the sprite placement overrun one
frame, so each step waits for the next one. On screen the road
therefore moves 1 pixel a video frame, not 2. This is the AI plus a
naive redraw not fitting a frame with badlines and sprite DMA.

What the run exercises, from the model: seven rams, at frames 98, 144,
248, 414, 558, 667 and 770; three of them make contact (cars 0, 2 and 1,
at frames 109, 263 and 572). Car 0, spawned behind on the left, is the
first to meet an edge: at frame 66 the road starts to narrow from the
left under its look-ahead, and it steers right. Every car avoids at
least once (28, 15, 6 and 11 car-frames). Car 3 is shot at frame 330,
drops back and frees its slot at frame 392; the table respawns slot 3
behind the player at frame 420. No car-frame has a car off the road.

At the island the pursuers usually end in the other channel from the
player. Counting car-frames with the player's and a pursuer's rear rows
both beside the island, 375 of 452 have the pursuer across the water.
Cars 1 and 2 are on the player's right when the autopilot dives into the
left channel, 75 pixels or more from it. The technique page's "Why it
works" gives the cause and the fixes that were tried in the model.

Screenshots at 45,000,000 cycles, both after the verdict and each
identical over two runs (PAL is still in pass 2 at 40,000,000 and shows the verdict at 42,000,000):
`screenshots/lane-pursuit.png` (PAL) and
`screenshots/lane-pursuit-ntsc.png` (NTSC). Measured on both with PIL:
each sprite is a 12 x 16 outline of 52 pixels at the position the model
ends on (the player at x 118, car 3 in RAM at 132 one pixel ahead of it,
cars 0 to 2 approaching 38 to 40 pixels behind at 185, 164 and 143); the
140 pixels inside every outline are road grey; and the centre pixel of
each of the 672 playfield tiles has the colour of the model's map row
(no water is in view at the end). The script, with the model saved as
`lane_model.py`:

```python
# Measures the exit screenshots of lane-pursuit.prg against lane_model.py.
from PIL import Image
import lane_model as m
PAL = {'row': 16, 'road': (98, 98, 98), 'verge': (98, 213, 50),
       'cars': [(255, 255, 70), (175, 60, 88), (170, 64, 245), (126, 243, 214), (183, 99, 30)]}
NTSC = {'row': 28, 'road': (98, 98, 98), 'verge': (114, 189, 103),
        'cars': [(255, 248, 141), (169, 71, 100), (154, 88, 185), (138, 230, 203), (196, 98, 65)]}
s, _, _ = m.run()
base = s.P & 0xFF80
def spot(wy, px):                       # screenshot x, first row of a sprite
    d = ((wy - base + 0x4000) & 0xFFFF) // 16 - 0x400
    return px + 64, 42 + 8 * 14 - d + 1
want = [spot(s.P, s.ppx)] + [spot(s.y[i], s.x[i] >> 8) for i in range(4)]
def check(png, g):
    im = Image.open(png).convert('RGB'); px = im.load(); W, H = im.size
    for k, c in enumerate(g['cars']):
        pts = [(x, y) for y in range(H) for x in range(W) if px[x, y] == c]
        x0, y0 = min(p[0] for p in pts), min(p[1] for p in pts)
        x1, y1 = max(p[0] for p in pts), max(p[1] for p in pts)
        wx, wy = want[k]
        assert (x0, y0 + g['row']) == (wx, wy), (png, k, x0, y0, want[k])
        assert (x1 - x0, y1 - y0, len(pts)) == (11, 15, 52), (png, k)
        inner = {px[x, y] for x in range(x0 + 1, x1) for y in range(y0 + 1, y1)}
        assert inner == {g['road']}, (png, k, inner)
    # road rows 2..22: the centre pixel of every tile against the model map
    prow = (s.P >> 7) & 63; bad = n = 0
    for r in range(2, 23):
        for c in range(32):
            p = px[64 + 8 * c + 3, 51 + 8 * r + 3 - g['row']]
            if p in g['cars']: continue
            t = m.MAP[(prow + 14 - r) & 63][c]
            n += 1
            bad += p != (g['road'] if t == m.ROAD else g['verge'])
    print(png, 'tiles sampled', n)
    return bad
for png, g in (('pal1.png', PAL), ('ntsc1.png', NTSC)):
    print(png, 'tile mismatches', check(png, g))
print('model end: player', s.ppx, 'cars', [(s.st[i], s.x[i] >> 8) for i in range(4)])
```

## Why this works

Every quantity the controllers touch is an integer: lateral position in
8.8, lateral speed in 8.8, world y and forward speed in 1/16 pixel. The
one rounding the rules need, `sm`, shifts the magnitude and restores the
sign, so C and Python agree on negative values without relying on how
either shifts a negative number. That is why the model can be exact and
the checksum can hold for 780 frames of four interacting cars.

The swept probe is what keeps a car off the island. A car probes the row
32 pixels past its nose, not at the x it has now but across the span
from now to where its lateral speed puts it 16 frames later, one probe
every 8 pixels so no tile between two probes is skipped. An early draft
of the model, which probed at the car's current x only, 24 pixels ahead
and with no side probe, counted 226 off-road car-frames: ramming cars
slid onto the island. A later draft that measured the look-ahead from
the car's rear rather than its nose counted 10. The side probe covers the other
case: a target beside the player that lies on the verge or the water.
It holds the lateral target rather than steering away, so a car beside
a narrowing edge waits instead of weaving.

What the listing leaves out: contact between cars and between a car and
the player is a count, not a push (`car_contact_response` is the page
for that); there is no shooting, only a scripted shot; the scroll is
coarse, one text row every four steps (eight video frames in pass 1). The pursuit code does not change
when those are added.
