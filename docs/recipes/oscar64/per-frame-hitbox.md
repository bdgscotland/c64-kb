---
recipe: per-frame-hitbox
toolchain: oscar64
output_format: PRG
region: both
techniques: [per_frame_hitbox]
file_formats: [PRG]
uses_registers: [D000, D001, D010, D011, D015, D01C, D01E, D020, D021, D025, D026, D027, DC06, DC07, DC0F]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 Per-Frame Hitboxes: boxes from the animation frame, pairs from group bits

## Synopsis

A player sprite takes three poses, stand, crouch and attack, and each
pose's animation frame carries its own collision box. The attack frame
carries two: a body in the player group and a blade in the player-bullet
group. Every frame the draw appends each actor's boxes to one list at the
position the sprite is drawn at, and the collision pass tests only the
pairs whose groups can hurt each other. Two enemies and four bullets from
both sides run a scripted scenario of three 64-frame stages, one per
pose. The same enemy bullet hits the standing player and passes over the
crouching one at the same position; enemy bullets fly through enemies
without an event; the blade hits an enemy the body does not touch; a
player bullet 256 pixels to the left of an enemy is a miss that a
low-byte X test reports as a hit. The screen prints expected and actual
events per stage, the `$D01E` value the hardware latched, and CIA1 timer B
cycles per pair and per frame. The last stage holds with every box drawn
as a yellow outline inside its sprite. `$02FF` = `01` and a green border
on a pass, `02` and red otherwise (`headless-verify.md`). This is the
`per_frame_hitbox` technique from `docs/techniques/sprite.md`.

## Source

```c
// per-frame-hitbox.c
//
// Collision boxes per animation frame, emitted at draw time, tested in
// pairs chosen by group bits. A player sprite takes three poses (stand,
// crouch, attack), each with its own box table entry; the attack pose
// emits two boxes, a body and a blade in the player-bullet group. Two
// enemies and four bullets from both sides move through a scripted
// scenario of three 64-frame stages, one per pose. Each stage's hit
// events are compared with the expected set. The last stage then holds
// with the boxes drawn as yellow outlines inside the sprites.
// Row 0: stage and frame. Row 1: the verdict. Rows 2-5: expected and
// actual events per stage and the $D01E value the hardware latched.
// Rows 7-12: pairs, CIA1 timer B cycles, the false hits of a low-byte X
// test, and the player's first box. $02FF = 01 and a green border when
// every stage matched and the low-byte test was caught; 02 and red
// otherwise.
//
#include <c64/vic.h>
#include <c64/cia.h>
#include <c64/sprites.h>

#define Screen  ((char *)0x0400)
#define Color   ((char *)0xd800)
#define SprData ((char *)0x3000)          // blocks 192..197
#define SPR_BLK 192
#define RESULT  (*(volatile char *)0x02ff)

// Groups, one bit each. box_mask (below) holds, for each box, the
// groups it is tested against; the relation is symmetric: player with
// enemy and enemy bullet, player bullet with enemy, and nothing else.
#define G_PLAYER  0x01
#define G_PSHOT   0x02
#define G_ENEMY   0x04
#define G_ESHOT   0x08

// --- animation frames and their boxes --------------------------------
// Offsets from the sprite's top-left, in pixels, even so they fit the
// 2-pixel columns of a multicolour sprite. A frame owns box_count boxes
// from box_first on.
#define F_STAND  0
#define F_CROUCH 1
#define F_ATTACK 2
#define F_ENEMY  3
#define F_ESHOT  4
#define F_PSHOT  5
#define FRAMES   6

struct Rect { char x, y, w, h; };

const struct Rect figure[FRAMES] = {        // drawn pixels, sprite colour
    { 6, 0, 12, 21 }, { 6, 10, 12, 11 }, { 4, 0, 12, 21 },
    { 0, 0, 24, 21 }, { 6, 6, 12, 8 },   { 6, 6, 12, 8 }
};
const char box_first[FRAMES] = { 0, 1, 2, 4, 5, 6 };
const char box_count[FRAMES] = { 1, 1, 2, 1, 1, 1 };

const struct Rect box_rect[7] = {
    { 8, 2, 8, 19 },                        // stand: body
    { 8, 12, 8, 9 },                        // crouch: lower half
    { 6, 2, 8, 19 }, { 14, 6, 10, 4 },      // attack: body, blade
    { 4, 2, 16, 18 },                       // enemy
    { 8, 8, 8, 4 },                         // enemy bullet
    { 8, 8, 8, 4 }                          // player bullet
};
const char box_group[7] = {
    G_PLAYER, G_PLAYER, G_PLAYER, G_PSHOT, G_ENEMY, G_ESHOT, G_PSHOT
};

// The groups each box is tested against.
const char box_mask[7] = {
    G_ENEMY | G_ESHOT, G_ENEMY | G_ESHOT, G_ENEMY | G_ESHOT, G_ENEMY,
    G_PLAYER | G_PSHOT, G_PLAYER, G_ENEMY
};

// --- actors ------------------------------------------------------------
// One hardware sprite each. X is the 9-bit sprite X, Y the sprite Y.
// Bullets take the low sprite numbers so they are drawn in front.
#define A_EB1  0
#define A_EB2  1
#define A_PB1  2
#define A_PB2  3
#define A_P    4
#define A_E1   5
#define A_E2   6
#define ACTORS 7

int  ax[ACTORS];
char ay[ACTORS];
char aframe[ACTORS];
const char acol[ACTORS] = { 10, 10, 3, 3, 1, 2, 2 };

// Event bits: which actor's box hit which. Bits 1, 4 and 5 must never
// be set: body contact that is not an overlap, an enemy bullet in an
// enemy, and a player bullet whose X differs from the enemy's by 256.
#define EV_EB1_P   0x01
#define EV_E1_P    0x02
#define EV_BLADE_E1 0x04
#define EV_PB1_E2  0x08
#define EV_EB2_E2  0x10
#define EV_PB2_E2  0x20

#define PAIR(a, b) ((1 << (a)) | (1 << (b)))

char event_bit(char a, char b)
{
    switch (PAIR(a, b)) {
    case PAIR(A_P, A_EB1):  return EV_EB1_P;
    case PAIR(A_P, A_E1):   return EV_E1_P;    // body or blade, split below
    case PAIR(A_E2, A_PB1): return EV_PB1_E2;
    case PAIR(A_E2, A_EB2): return EV_EB2_E2;
    case PAIR(A_E2, A_PB2): return EV_PB2_E2;
    default:                return 0;
    }
}

// --- the box list, refilled every frame by the draw ---------------------
#define MAXB 8
char nbox;
char bll[MAXB], blh[MAXB];               // left X, 9 bits as low and high byte
char brl[MAXB], brh[MAXB];               // right X, exclusive
char bt[MAXB], bb[MAXB];                 // Y, bottom edge exclusive
char bhl[MAXB], bhr[MAXB];               // X / 2, for the 8-bit variant
char bg[MAXB], bm[MAXB], bo[MAXB];       // group bit, pair mask, owner

// Draw one actor's boxes: append its current frame's boxes to the list
// at the position the sprite is drawn at.
void emit_boxes(char a)
{
    unsigned x = ax[a];
    char y = ay[a], f = aframe[a];
    char k = box_first[f], e = k + box_count[f];
    char i = nbox;
    do {
        unsigned l = x + box_rect[k].x, rr = l + box_rect[k].w;
        bll[i] = (char)l;
        blh[i] = l >> 8;
        brl[i] = (char)rr;
        brh[i] = rr >> 8;
        bhl[i] = l >> 1;
        bhr[i] = rr >> 1;
        char t = y + box_rect[k].y;
        bt[i] = t;
        bb[i] = t + box_rect[k].h;
        bg[i] = box_group[k];
        bm[i] = box_mask[k];
        bo[i] = a;
        i++;
        k++;
    } while (k != e);
    nbox = i;
}

// The sprite half of the draw: X is 9 bits, spr_move sets the $D010 bit.
void draw_sprite(char a)
{
    spr_move(a, ax[a], ay[a]);
    spr_image(a, SPR_BLK + aframe[a]);
}

// 9-bit "left of i is left of right of j": high bytes first.
static inline bool xlt(char i, char j)
{
    return blh[i] < brh[j] || (blh[i] == brh[j] && bll[i] < brl[j]);
}

// The AABB test. Y first: it is one byte and in a side-scrolling
// scene most pairs are apart in Y. Each compare can end the test.
static inline bool overlap9(char i, char j)
{
    return bt[i] < bb[j] && bt[j] < bb[i] && xlt(i, j) && xlt(j, i);
}

// The same test on X / 2: every coordinate one byte, 2-pixel precision.
static inline bool overlap8(char i, char j)
{
    return bt[i] < bb[j] && bt[j] < bb[i] && bhl[i] < bhr[j] && bhl[j] < bhr[i];
}

// The broken variant: only the low byte of X, as when $D010's bit is
// ignored. Used only to count its false hits.
static inline bool overlap_lo(char i, char j)
{
    return bt[i] < bb[j] && bt[j] < bb[i] && bll[i] < brl[j] && bll[j] < brl[i];
}

char pairs_all, pairs_tested, frame_events;

void collide(void)
{
    pairs_all = 0;
    pairs_tested = 0;
    for (char i = 0; i + 1 < nbox; i++) {
        char m = bm[i];
        for (char j = i + 1; j < nbox; j++) {
            pairs_all++;
            if (!(m & bg[j]))
                continue;                   // friendly or irrelevant pair
            pairs_tested++;
            if (overlap9(i, j)) {
                char e = event_bit(bo[i], bo[j]);
                if (e == EV_E1_P && (bg[i] == G_PSHOT || bg[j] == G_PSHOT))
                    e = EV_BLADE_E1;
                frame_events |= e;
            }
        }
    }
}

// --- CIA1 timer B harness (as tile-grid-collision.md) --------------------
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

// Per-pair timing: each is called 100 times through a pointer and the
// empty call is subtracted, so the figure is the test alone.
char gi, gj, gk;
volatile bool sink;
__noinline void nothing(void)   { }
__noinline void pair_hit(void)  { sink = overlap9(gi, gj); }
__noinline void pair_miss(void) { sink = overlap9(gi, gk); }
__noinline void pair_hit8(void) { sink = overlap8(gi, gj); }
__noinline void pair_miss8(void) { sink = overlap8(gi, gk); }

unsigned time100(void (*fn)(void))
{
    __asm { sei }
    timer_start();
    for (char n = 0; n < 100; n++)
        fn();
    unsigned t = timer_stop();
    __asm { cli }
    return t;
}

// --- sprite images: figure in the sprite colour, boxes outlined in MC1 --
void mc_px(char *img, char cx, char row, char v)
{
    char *p = img + row * 3 + (cx >> 2);
    char s = (3 - (cx & 3)) * 2;
    *p = (*p & ~(3 << s)) | (v << s);
}

void make_images(void)
{
    for (unsigned i = 0; i < FRAMES * 64; i++)
        SprData[i] = 0;
    for (char f = 0; f < FRAMES; f++) {
        char *img = SprData + f * 64;
        const struct Rect *r = figure + f;
        for (char y = r->y; y < r->y + r->h; y++)
            for (char x = r->x >> 1; x < (r->x + r->w) >> 1; x++)
                mc_px(img, x, y, 2);
        if (f == F_ATTACK)                   // the blade is drawn too
            for (char y = 6; y < 10; y++)
                for (char x = 7; x < 12; x++)
                    mc_px(img, x, y, 2);
        for (char k = box_first[f]; k < box_first[f] + box_count[f]; k++) {
            const struct Rect *b = box_rect + k;
            char x0 = b->x >> 1, x1 = ((b->x + b->w) >> 1) - 1;
            char y0 = b->y, y1 = b->y + b->h - 1;
            for (char x = x0; x <= x1; x++) {
                mc_px(img, x, y0, 3);
                mc_px(img, x, y1, 3);
            }
            for (char y = y0; y <= y1; y++) {
                mc_px(img, x0, y, 3);
                mc_px(img, x1, y, 3);
            }
        }
    }
}

// --- text helpers (screen codes) ------------------------------------------
void put_str(char *p, const char *s)
{
    while (*s)
        *p++ = *s++;
}

void put_dec(char *p, unsigned v, char digits)
{
    for (char i = digits; i > 0; i--) {
        p[i - 1] = 0x30 + v % 10;
        v /= 10;
    }
}

void put_hex2(char *p, char v)
{
    char d = v >> 4;
    p[0] = d < 10 ? 0x30 + d : d - 9;
    d = v & 15;
    p[1] = d < 10 ? 0x30 + d : d - 9;
}

// --- scenario --------------------------------------------------------------
#define STAGE_FRAMES 64
#define HOLD_T 36

const char stage_pose[3] = { F_STAND, F_CROUCH, F_ATTACK };
const char stage_expect[3] = {
    EV_EB1_P | EV_PB1_E2,                   // stand: shot in the head
    EV_PB1_E2,                              // crouch: the shot passes over
    EV_EB1_P | EV_BLADE_E1 | EV_PB1_E2      // attack: body hit, blade hits E1
};
const char *stage_name[3] = { s"stand ", s"crouch", s"attack" };

// Positions at frame t of a stage: bullets move 2 pixels a frame.
void place(char pose, char t)
{
    ax[A_P] = 100;   ay[A_P] = 200;  aframe[A_P] = pose;
    ax[A_E1] = 116;  ay[A_E1] = 200; aframe[A_E1] = F_ENEMY;
    ax[A_E2] = 300;  ay[A_E2] = 160; aframe[A_E2] = F_ENEMY;
    ax[A_EB1] = 164 - 2 * t; ay[A_EB1] = 196; aframe[A_EB1] = F_ESHOT;
    ax[A_EB2] = 380 - 2 * t; ay[A_EB2] = 164; aframe[A_EB2] = F_ESHOT;
    ax[A_PB1] = 220 + 2 * t; ay[A_PB1] = 156; aframe[A_PB1] = F_PSHOT;
    ax[A_PB2] = 20 + 2 * t;  ay[A_PB2] = 160; aframe[A_PB2] = F_PSHOT;
}

int main(void)
{
    vic.color_border = 0;
    vic.color_back = 0;
    for (unsigned i = 0; i < 1000; i++) {
        Screen[i] = 0x20;
        Color[i] = 1;
    }
    make_images();

    spr_init(Screen);
    for (char a = 0; a < ACTORS; a++)
        spr_set(a, false, 0, 0, SPR_BLK, acol[a], true, false, false);
    vic.spr_mcolor0 = 0;
    vic.spr_mcolor1 = 7;                     // box outlines: yellow

    put_str(Screen + 0,       s"per-frame hitbox  stage   frame");
    put_str(Screen + 2 * 40,  s"pose    exp got d01e");
    put_str(Screen + 7 * 40,  s"pairs    tested    boxes");
    put_str(Screen + 8 * 40,  s"emit max       collide max");
    put_str(Screen + 9 * 40,  s"pair 9-bit hit      miss");
    put_str(Screen + 10 * 40, s"pair 8-bit hit      miss");
    put_str(Screen + 11 * 40, s"low-byte-x false hits");
    put_str(Screen + 12 * 40, s"p box l    r    t    b");

    // Per-pair cost, before the scenario: box 0 and 1 overlap, box 0 and
    // 2 fail the first compare. 100 calls each, less 100 empty calls,
    // with the screen blanked so no badline steals a cycle.
    nbox = 0;
    place(F_STAND, 32);
    emit_boxes(A_P);                         // box 0
    emit_boxes(A_EB1);                       // box 1: overlaps it
    emit_boxes(A_E2);                        // box 2: apart in Y
    gi = 0; gj = 1; gk = 2;
    vic.ctrl1 &= ~VIC_CTRL1_DEN;
    vic_waitFrame();
    vic_waitFrame();
    unsigned t_none = time100(nothing);
    unsigned c_hit = (time100(pair_hit) - t_none) / 100;
    unsigned c_miss = (time100(pair_miss) - t_none) / 100;
    unsigned c_hit8 = (time100(pair_hit8) - t_none) / 100;
    unsigned c_miss8 = (time100(pair_miss8) - t_none) / 100;
    vic.ctrl1 |= VIC_CTRL1_DEN;
    put_dec(Screen + 9 * 40 + 15, c_hit, 3);
    put_dec(Screen + 9 * 40 + 25, c_miss, 3);
    put_dec(Screen + 10 * 40 + 15, c_hit8, 3);
    put_dec(Screen + 10 * 40 + 25, c_miss8, 3);

    // Put every sprite at its first position before enabling them, or
    // they meet at 0, 0 for a frame and $D01E latches that.
    place(stage_pose[0], 0);
    for (char a = 0; a < ACTORS; a++)
        draw_sprite(a);
    nbox = 0;                                // nothing drawn yet
    vic.spr_enable = (1 << ACTORS) - 1;
    char stage = 0, t = 0, fault = 0, lo_false = 0;
    bool done = false;
    unsigned frame = 0, d_max = 0, c_max = 0;
    char stage_events = 0;
    vic_waitFrame();
    vic.spr_sprcol;                          // clear the latch

    for (;;) {
        vic_waitFrame();

        // Collide first, on the boxes the last frame's draw emitted, so
        // the test runs at the top of the blank on both models.
        __asm { sei }
        frame_events = 0;
        timer_start();
        collide();
        unsigned tc = timer_stop();
        place(stage_pose[stage], done ? HOLD_T : t);
        timer_start();
        nbox = 0;
        for (char a = 0; a < ACTORS; a++)
            emit_boxes(a);
        unsigned td = timer_stop();
        __asm { cli }
        for (char a = 0; a < ACTORS; a++)
            draw_sprite(a);
        if (td > d_max) d_max = td;
        if (tc > c_max) c_max = tc;
        stage_events |= frame_events;

        // The low-byte test on the pair that differs by 256 in X.
        for (char i = 0; i < nbox; i++)
            for (char j = 0; j < nbox; j++)
                if (bo[i] == A_E2 && bo[j] == A_PB2 && overlap_lo(i, j))
                    lo_false++;

        put_dec(Screen + 24, stage + 1, 1);
        put_dec(Screen + 32, frame, 5);
        put_dec(Screen + 7 * 40 + 6, pairs_all, 2);
        put_dec(Screen + 7 * 40 + 16, pairs_tested, 2);
        put_dec(Screen + 7 * 40 + 25, nbox, 1);
        put_dec(Screen + 8 * 40 + 9, d_max, 5);
        put_dec(Screen + 8 * 40 + 27, c_max, 5);
        put_dec(Screen + 11 * 40 + 22, lo_false, 3);
        char p = 0;
        while (bo[p] != A_P)
            p++;                             // the player's first box
        put_dec(Screen + 12 * 40 + 8, bll[p] + 256 * blh[p], 3);
        put_dec(Screen + 12 * 40 + 13, brl[p] + 256 * brh[p], 3);
        put_dec(Screen + 12 * 40 + 18, bt[p], 3);
        put_dec(Screen + 12 * 40 + 23, bb[p], 3);
        frame++;

        if (!done && ++t == STAGE_FRAMES) {
            char hw = vic.spr_sprcol;        // read once per stage, clears it
            char *row = Screen + (3 + stage) * 40;
            put_str(row, stage_name[stage]);
            put_hex2(row + 8, stage_expect[stage]);
            put_hex2(row + 12, stage_events);
            put_hex2(row + 16, hw);
            bool ok = stage_events == stage_expect[stage];
            put_str(row + 20, ok ? s"pass" : s"fail");
            if (!ok) fault = stage + 1;
            stage_events = 0;
            t = 0;
            if (stage == 2) {
                done = true;
                if (lo_false == 0) fault = 4;   // the 8-bit trap must fire
                RESULT = fault ? 2 : 1;
                vic.color_border = fault ? 2 : 5;
                put_str(Screen + 40, fault ? s"result fail" : s"result pass");
                Screen[40 + 12] = 0x30 + fault;
            } else
                stage++;
        }
    }
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=per-frame-hitbox.prg per-frame-hitbox.c
```

Produces `per-frame-hitbox.prg`, 3,711 bytes. The sprite images are
built at run time at `$3000`, blocks 192 to 197, above the program. Then
run headless in VICE (PAL):

```bash
GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas x64sc -default -warp +sound \
  +autostart-delay-random -autostartprgmode 1 -limitcycles 8000000 \
  -exitscreenshot per-frame-hitbox.png -autostart per-frame-hitbox.prg
```

Add `-model ntsc` for the NTSC picture. The three stages take 192 frames;
at 8,000,000 cycles the verdict is posted on both models.

## Expected output

The scene, in sprite coordinates (Y is the sprite Y register):

| Actor | Sprite | Position | Moves | Group of its box |
|---|---|---|---|---|
| enemy bullet EB1 | 0 | Y 196, X 164 at stage frame 0 | left 2 px a frame | enemy bullet |
| enemy bullet EB2 | 1 | Y 164, X 380 | left 2 px a frame | enemy bullet |
| player bullet PB1 | 2 | Y 156, X 220 | right 2 px a frame | player bullet |
| player bullet PB2 | 3 | Y 160, X 20 | right 2 px a frame | player bullet |
| player P | 4 | X 100, Y 200 | pose per stage | player (and blade: player bullet) |
| enemy E1 | 5 | X 116, Y 200 | still | enemy |
| enemy E2 | 6 | X 300, Y 160 | still | enemy |

Event bits, set when a tested pair overlaps: `01` EB1 hits the player,
`02` E1 touches the player's body, `04` the blade hits E1, `08` PB1 hits
E2, `10` EB2 hits E2, `20` PB2 hits E2. Bits `02`, `10` and `20` must
never be set: E1's box never reaches the body, enemy bullet against enemy
is not a tested pair, and PB2's X differs from E2's by 256.

Measured in VICE x64sc 3.10 with the pinned command, text decoded
against the character ROM (rows 0 to 12, PAL):

```text
PER-FRAME HITBOX  STAGE 3 FRAME 00237
RESULT PASS 0
POSE    EXP GOT D01E
STAND   09  09  77  PASS
CROUCH  08  08  77  PASS
ATTACK  0D  0D  77  PASS

PAIRS 28 TESTED 10 BOXES 8
EMIT MAX 02148 COLLIDE MAX 02037
PAIR 9-BIT HIT 096  MISS 028
PAIR 8-BIT HIT 059  MISS 025
LOW-BYTE-X FALSE HITS 033
P BOX L 106R 114T 202B 221
```

NTSC reads the same except `FRAME 00266` and `EMIT MAX 02234`. The
border is palette index 5, (98, 213, 50) on PAL and (114, 189, 103) on
NTSC.

What the numbers say:

- Stand and crouch differ only in the player's frame. EB1 crosses the
  player at the same X and Y in both; its box (Y 204 to 207) meets the
  stand box (Y 202 to 220) and passes over the crouch box (Y 212 to 220).
- In the attack stage the blade's box (X 114 to 123) reaches E1's box
  (X 120 to 135); the body's box (X 106 to 113) does not, so the event is
  `04`, never `02`.
- `D01E` is `77` in every stage: sprites 0, 1, 2, 4, 5 and 6 touched
  something, and sprite 3, PB2, touched nothing. In the crouch stage the
  player's bit is set by its pixels touching E1's (the figures share X
  116 to 117), though no box of the player's overlaps anything; EB2's bit
  is set by E2, a pair the game ignores. The register gives no pair and
  no group.
- The low-byte test found 33 frames in which PB2 and E2 "overlap": PB2's
  X low byte passes E2's (304 to 319, low bytes 48 to 63). The 9-bit test
  found none.
- `PAIRS 28 TESTED 10`: eight boxes make 28 pairs, and the group masks
  leave 10 to test.

Cycle figures, CIA1 timer B, interrupts masked. The per-pair figures are
100 calls of a test through a function pointer, less 100 calls of an
empty function, divided by 100 and rounded down, with the screen blanked
(`$D011` bit 4 clear) so no badline steals a cycle. A hit runs all four
compares; a miss fails the first one. `COLLIDE MAX` is the worst frame of
the whole pass over the list and `EMIT MAX` the worst frame of filling it,
eight boxes. Both run straight after `vic_waitFrame()` returns at line
256. The collide pass fits the vertical blank on both models and reads
2,037 on both. The emit runs after it and on NTSC crosses into the first
badlines of the next frame, which is why NTSC reads 86 cycles more; the
PAL figure is the cost.

The pictures: `screenshots/per-frame-hitbox.png` (PAL) and
`screenshots/per-frame-hitbox-ntsc.png` (NTSC), the hold state at stage
frame 36 in the attack pose. Measured with PIL on both: every one of the
eight boxes has its outline in yellow (MC1, (255, 255, 70) on PAL,
(255, 248, 141) on NTSC) at exactly the pixels its box list entry names,
X + 8 across and Y + 1 − 16 down on PAL (− 28 on NTSC). Four pixels
sampled one step outside each box are not yellow, except the one left of
the blade, which is the body's right edge.
The four bullet outlines are complete (20 of 20 pixels each). Pixels
missing from the others are covered by a sprite in front: 7 of the
body's 50 by EB1 (light red), 2 of E1's 64 by the player's blade
(white), 17 of E2's 64 by PB1 (cyan) and EB2 (light red). The + 1 is the
sprite's first line, which is one raster line below its Y register, as
`sprite_sine_chain` measured. Each model run twice gives byte-identical
PNGs.

## Why this works

The box belongs to the animation frame, not to the actor.
`box_first[f]` and `box_count[f]` pick a frame's entries in `box_rect`,
each an offset from the sprite's top-left corner plus a width and a
height, and a group bit in `box_group`. Changing the pose changes the
sprite pointer and the boxes together, so the collision shape can never
disagree with the picture: crouching lowers the box's top by 10 pixels,
and the attack frame adds a second box in another group.

`emit_boxes` runs where the sprite is positioned and writes screen-space
edges into parallel byte arrays: left and right X as a low and a high
byte (9 bits, right edge exclusive), top and bottom Y (one byte; a box
must end above Y 256), the group bit, the mask of groups it is tested
against and the owning actor. An actor that is not drawn emits nothing
and costs nothing in the collision pass. `collide` walks the pairs
`i < j` once; `bm[i] & bg[j]` is zero for friendly and irrelevant pairs,
which is how enemy bullets pass through enemies and a player's blade
cannot hit the player. The masks are symmetric, so each pair is tested
once.

`overlap9` tests Y first because it is one byte, then the two X
conditions, each with the high bytes compared first. `xlt(i, j)` is
"i's left edge is left of j's right edge". The broken variant that
compares only the low bytes wraps at 256: 304 has low byte 48, so a
bullet at X 52 lands "inside" an enemy at 304. That is the mechanism of
`sprite_x_high_bit_wrong_register` moved from the VIC to the game's own
arithmetic. `overlap8` halves every X at emit time, so all four compares
are one byte, at 2-pixel precision; it is 37 cycles cheaper per hit
here.

The per-pose events come out right because the draw that emits the boxes
is the draw that sets the sprite pointer. The collision pass runs at the
top of the next frame on the list the last draw left, so it tests what
was on screen.

Verified: compiled with Oscar64, run headless in VICE x64sc 3.10 with the
pinned command on PAL and NTSC, each twice with byte-identical PNGs; the
text was decoded against the character ROM and the box outlines located
by colour with PIL, not by eye.
