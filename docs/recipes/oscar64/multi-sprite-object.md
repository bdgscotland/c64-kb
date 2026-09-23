---
recipe: multi-sprite-object
toolchain: oscar64
output_format: PRG
region: both
techniques: [multi_sprite_object]
file_formats: [PRG]
uses_registers: [D000, D001, D010, D011, D015, D017, D01D, D020, D021, D027, DC06, DC07, DC0F]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 multi-sprite object: a six-sprite boss placed from a part table across the X 255 seam

## Synopsis

A boss made of six hardware sprites, each placed at a fixed offset from
one origin. A part table holds each part's offset, frame, colour and
expand flags: three unexpanded parts on top, and below them an
X-expanded wing, a Y-expanded core and a second X-expanded wing. The
middle top part is animated, two frames eight frames apart. On
autopilot the origin sweeps right from X 60 to X 340, so parts cross
X 255 one at a time and then pass X 344 under the right border and are
switched off; it sweeps back, then comes right again and holds at
X 264. There the left wing sits at X 240, left of the seam, and the right
wing is half under the right border. Every frame a model recomputes every
part from the table and compares it with the VIC registers: the X low
byte, the part's `$D010` bit, Y, the `$D015` bit, the pointer, the colour
and both expand bits. Sprite 6 stands for another object; its `$D010` and
`$D015` bits must survive every update. The screen shows the verdict,
the frames in which visible parts sat on both sides of X 256, the frames
in which a part was clipped, and CIA1 timer B cycles per update and per
part. `$02FF` = `01` and a green border on a pass, `02` and red
otherwise (`headless-verify.md`). This is the `multi_sprite_object`
technique from `docs/techniques/sprite.md`.

## Source

```c
// multi-sprite-object.c
//
// A boss built from six hardware sprites placed at fixed offsets from
// one origin. Each part has its own offset, frame, colour and expand
// flags in a table; the middle top part is animated. On autopilot the
// origin sweeps right across X 255 until parts leave the window at the
// right, back, then right again to a hold at X 264, where one part sits
// left of the seam and one is half under the right border.
// Every frame a model recomputes each part from the table and compares
// it with what the VIC registers hold: X low byte, the $D010 bit, Y,
// the $D015 bit, the pointer, the colour and both expand bits. Sprite 6
// is another object; its $D010 and $D015 bits must survive the update.
// Row 1: verdict. Rows 3-6: frames checked, mismatches, seam and clip
// frames, CIA1 timer B cycles. Rows 8-13: each part as the registers
// hold it. $02FF = 01 and a green border on a pass, 02 and red if not.
//
#include <c64/vic.h>
#include <c64/cia.h>

#define Screen  ((char *)0x0400)
#define Color   ((char *)0xd800)
#define SprData ((char *)0x3000)            // blocks 192..194
#define SPR_BLK 192
#define VR      ((volatile char *)0xd000)
#define PTR     ((volatile char *)0x07f8)   // sprite pointers
#define RESULT  (*(volatile char *)0x02ff)

// --- the part table ---------------------------------------------------
// Offsets from the origin in sprite pixels. The object uses hardware
// sprites 0 to 5, part i in sprite i.
#define F_BLOCK 0
#define F_EYE   1                           // two frames: 1 and 2
#define XEXP    0x01
#define YEXP    0x02
#define PARTS   6
#define OBJ_MASK 0x3f
#define ANIM_RATE 8                         // frames per animation step

const signed char part_dx[PARTS] = { 0, 24, 48, -24, 24, 48 };
const char part_dy[PARTS]        = { 0,  0,  0,  21, 21, 21 };
const char part_frame[PARTS]     = { F_BLOCK, F_EYE, F_BLOCK, F_BLOCK, F_BLOCK, F_BLOCK };
const char part_len[PARTS]       = { 1, 2, 1, 1, 1, 1 };  // animation frames
const char part_color[PARTS]     = { 2, 7, 14, 3, 4, 8 };
const char part_flags[PARTS]     = { 0, 0, 0, XEXP, YEXP, XEXP };

// The visible window in sprite coordinates. A part wholly outside it is
// switched off, not written: X 344 and beyond is under the right border.
// A negative X is hidden too: the register value that means "left of 0"
// differs by model (504 + x on PAL, 512 + x on NTSC, measured in VICE).
#define WIN_L 24
#define WIN_R 344
#define WIN_T 50
#define WIN_B 250

int  ox;                                    // origin, 9-bit sprite X
char oy;
char nparts = PARTS;
char anim_cur[PARTS], anim_cnt[PARTS];

// --- the technique: place every part, one $D010 and $D015 write --------
void object_update(void)
{
    char msb = 0, en = 0, bit = 1;
    for (char i = 0; i < nparts; i++) {
        char f = part_frame[i];
        if (part_len[i] > 1) {              // per-part animation
            if (--anim_cnt[i] == 0) {
                anim_cnt[i] = ANIM_RATE;
                if (++anim_cur[i] == part_len[i])
                    anim_cur[i] = 0;
            }
            f += anim_cur[i];
        }
        int x = ox + part_dx[i];            // 9 bits per part, not per object
        int y = oy + part_dy[i];
        char fl = part_flags[i];
        char w = (fl & XEXP) ? 48 : 24;
        char h = (fl & YEXP) ? 42 : 21;
        if (x >= 0 && x < WIN_R && x + w > WIN_L && y < WIN_B && y + h > WIN_T) {
            char s2 = i * 2;
            VR[s2] = (char)x;
            VR[s2 + 1] = (char)y;
            if (x & 0x100)
                msb |= bit;
            en |= bit;
            PTR[i] = SPR_BLK + f;
        }
        bit <<= 1;
    }
    // Other objects own the other bits of these registers.
    VR[0x10] = (VR[0x10] & ~OBJ_MASK) | msb;
    VR[0x15] = (VR[0x15] & ~OBJ_MASK) | en;
}

// Colour and expand bits do not change while the object lives.
void object_spawn(void)
{
    char xe = 0, ye = 0;
    for (char i = 0; i < PARTS; i++) {
        VR[0x27 + i] = part_color[i];
        if (part_flags[i] & XEXP) xe |= 1 << i;
        if (part_flags[i] & YEXP) ye |= 1 << i;
        anim_cur[i] = 0;
        anim_cnt[i] = ANIM_RATE;
    }
    VR[0x1d] = (VR[0x1d] & ~OBJ_MASK) | xe;
    VR[0x17] = (VR[0x17] & ~OBJ_MASK) | ye;
}

// --- the model: what every register should hold after n updates ---------
unsigned ticks;                             // updates since spawn
char seam_now, clip_now;

char check(void)
{
    char bad = 0;
    char d010 = VR[0x10], d015 = VR[0x15];
    char dx = VR[0x1d], dy = VR[0x17];
    if ((d010 & 0x40) == 0 || (d015 & 0x40) == 0)
        bad = 1;                            // sprite 6's bits were cleared
    char vis = 0, hi = 0;
    for (char i = 0; i < PARTS; i++) {
        char b = 1 << i;
        int x = ox + part_dx[i];
        int y = oy + part_dy[i];
        int w = (part_flags[i] & XEXP) ? 48 : 24;
        int h = (part_flags[i] & YEXP) ? 42 : 21;
        bool show = x >= 0 && x < WIN_R && x + w > WIN_L && y < WIN_B && y + h > WIN_T;
        if (((dx & b) != 0) != ((part_flags[i] & XEXP) != 0)) bad = 1;
        if (((dy & b) != 0) != ((part_flags[i] & YEXP) != 0)) bad = 1;
        if ((VR[0x27 + i] & 15) != part_color[i]) bad = 1;
        if (!show) {
            if (d015 & b) bad = 1;
            continue;
        }
        vis |= b;
        if (!(d015 & b)) bad = 1;
        int rx = VR[i * 2] + ((d010 & b) ? 256 : 0);
        if (rx != x || VR[i * 2 + 1] != (char)y) bad = 1;
        if (x >= 256) hi |= b;
        char f = part_frame[i] + (char)((ticks / ANIM_RATE) % part_len[i]);
        if (PTR[i] != SPR_BLK + f) bad = 1;
    }
    seam_now = hi != 0 && hi != vis;        // visible parts on both sides of 256
    clip_now = vis != OBJ_MASK;
    return bad;
}

// --- CIA1 timer B -----------------------------------------------------------
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

__noinline void nothing(void) { }

unsigned time1(void (*fn)(void))
{
    __asm { sei }
    timer_start();
    fn();
    unsigned t = timer_stop();
    __asm { cli }
    return t;
}

// --- images: a solid block, and an eye open and shut ----------------------
void make_images(void)
{
    for (char i = 0; i < 3 * 64; i++)
        SprData[i] = 0xff;
    for (char r = 6; r < 15; r++)
        SprData[64 + r * 3 + 1] = 0x00;     // frame 1: 8 x 9 hole
    for (char r = 10; r < 12; r++)
        SprData[128 + r * 3 + 1] = 0x00;    // frame 2: 8 x 2 slit
}

// --- text (screen codes) ----------------------------------------------------
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

void put_sdec(char *p, int v, char digits)
{
    p[0] = v < 0 ? 0x2d : 0x2b;
    put_dec(p + 1, v < 0 ? -v : v, digits);
}

// --- autopilot ----------------------------------------------------------------
#define X_MIN 60
#define X_MAX 340
#define X_HOLD 264
#define Y_HOLD 172
#define HOLD_FRAMES 30

int main(void)
{
    vic.color_border = 0;
    vic.color_back = 0;
    for (unsigned i = 0; i < 1000; i++) {
        Screen[i] = 0x20;
        Color[i] = 1;
    }
    make_images();

    // Sprite 6 belongs to another object, at X 330: its $D010 bit is set.
    VR[12] = 330 & 255;
    VR[13] = 230;
    VR[0x10] = 0x40;
    VR[0x15] = 0x40;
    VR[0x2d] = 15;
    PTR[6] = SPR_BLK + F_BLOCK;
    object_spawn();

    put_str(Screen + 0,       s"multi-sprite object  frame");
    put_str(Screen + 2 * 40,  s"origin x     y");
    put_str(Screen + 3 * 40,  s"checked       mismatches");
    put_str(Screen + 4 * 40,  s"seam frames     clip frames");
    put_str(Screen + 5 * 40,  s"update max      min");
    put_str(Screen + 6 * 40,  s"part shown     hidden     fixed");
    put_str(Screen + 7 * 40,  s"part  dx   dy  x   hi en w  h  frm");

    // Cost per part, display blanked: the update with 6 parts shown, 1
    // part shown, and 6 parts all past the right edge, less an empty call.
    vic.ctrl1 &= ~VIC_CTRL1_DEN;
    vic_waitFrame();
    vic_waitFrame();
    unsigned t_none = time1(nothing);
    ox = 200; oy = Y_HOLD;
    unsigned t6 = time1(object_update) - t_none;
    nparts = 1;
    unsigned t1 = time1(object_update) - t_none;
    nparts = PARTS;
    ox = 400;
    unsigned th = time1(object_update) - t_none;
    vic.ctrl1 |= VIC_CTRL1_DEN;
    unsigned c_part = (t6 - t1) / 5;
    unsigned c_fixed = t1 - c_part;
    put_dec(Screen + 6 * 40 + 11, c_part, 3);
    put_dec(Screen + 6 * 40 + 22, (th - c_fixed) / 6, 3);
    put_dec(Screen + 6 * 40 + 32, c_fixed, 3);

    object_spawn();                         // restart the animation
    ox = X_MIN; oy = Y_HOLD;
    ticks = 0;
    char phase = 0, fault = 0, hold = 0, pr = 0;
    unsigned frame = 0, checked = 0, mism = 0, seams = 0, clips = 0;
    unsigned u_max = 0, u_min = 0xffff;

    for (;;) {
        vic_waitFrame();
        __asm { sei }
        timer_start();
        object_update();
        unsigned tu = timer_stop();
        __asm { cli }
        ticks++;
        if (tu > u_max) u_max = tu;
        if (tu < u_min) u_min = tu;

        checked++;
        if (check()) mism++;
        if (seam_now) seams++;
        if (clip_now) clips++;

        // Printing is slow in C: one line of it a frame keeps the loop
        // inside one frame.
        switch (frame & 3) {
        case 0:
            put_dec(Screen + 27, frame, 5);
            put_dec(Screen + 2 * 40 + 9, ox, 3);
            put_dec(Screen + 2 * 40 + 15, oy, 3);
            break;
        case 1:
            put_dec(Screen + 3 * 40 + 8, checked, 5);
            put_dec(Screen + 3 * 40 + 25, mism, 5);
            break;
        case 2:
            put_dec(Screen + 4 * 40 + 12, seams, 3);
            put_dec(Screen + 4 * 40 + 28, clips, 3);
            put_dec(Screen + 5 * 40 + 11, u_max, 4);
            put_dec(Screen + 5 * 40 + 20, u_min, 4);
            break;
        case 3: {                           // one part's row, as the registers hold it
            char d010 = VR[0x10], d015 = VR[0x15];
            char *row = Screen + (8 + pr) * 40;
            char b = 1 << pr;
            row[0] = 0x30 + pr;
            put_sdec(row + 5, part_dx[pr], 2);
            put_sdec(row + 10, part_dy[pr], 2);
            put_dec(row + 14, VR[pr * 2] + ((d010 & b) ? 256 : 0), 3);
            row[19] = (d010 & b) ? 0x31 : 0x30;
            row[22] = (d015 & b) ? 0x31 : 0x30;
            put_dec(row + 24, (VR[0x1d] & b) ? 48 : 24, 2);
            put_dec(row + 27, (VR[0x17] & b) ? 42 : 21, 2);
            put_dec(row + 30, PTR[pr], 3);
            if (++pr == PARTS)
                pr = 0;
            break;
        }
        }
        frame++;

        // Next frame's origin: right, left, right to the hold.
        if (phase == 0) {
            ox += 2;
            if (ox == X_MAX) phase = 1;
        } else if (phase == 1) {
            ox -= 2;
            if (ox == X_MIN) phase = 2;
        } else if (phase == 2) {
            ox += 2;
            if (ox == X_HOLD) phase = 3;
        } else if (++hold == HOLD_FRAMES) {
            phase = 4;
            if (seams == 0) fault = 2;
            if (clips == 0) fault = 3;
            if (mism) fault = 1;
            RESULT = fault ? 2 : 1;
            vic.color_border = fault ? 2 : 5;
            put_str(Screen + 40, fault ? s"result fail" : s"result pass");
            Screen[40 + 12] = 0x30 + fault;
        }
        if (phase < 3) {
            char k = frame & 31;            // bob 16 lines while moving
            oy = Y_HOLD - 8 + (k < 16 ? k : 31 - k);
        } else
            oy = Y_HOLD;
    }
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=multi-sprite-object.prg multi-sprite-object.c
```

Produces `multi-sprite-object.prg`, 3,129 bytes. The three sprite images
are built at run time at `$3000`, blocks 192 to 194, above the program.
Then run headless in VICE (PAL):

```bash
GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas x64sc -default -warp +sound \
  +autostart-delay-random -autostartprgmode 1 -limitcycles 12000000 \
  -exitscreenshot multi-sprite-object.png -autostart multi-sprite-object.prg
```

Add `-model ntsc` for the NTSC picture. The sweep and the hold take 412
frames; at 12,000,000 cycles the verdict is posted on both models.

## Expected output

The part table, offsets from the origin in sprite pixels:

| Part | Sprite | dx | dy | Size | Colour | Frame |
|---|---|---|---|---|---|---|
| 0 | 0 | 0 | 0 | 24 x 21 | red (2) | block |
| 1 | 1 | 24 | 0 | 24 x 21 | yellow (7) | eye, 2 frames |
| 2 | 2 | 48 | 0 | 24 x 21 | light blue (14) | block |
| 3 | 3 | -24 | 21 | 48 x 21, X-expanded | cyan (3) | block |
| 4 | 4 | 24 | 21 | 24 x 42, Y-expanded | purple (4) | block |
| 5 | 5 | 48 | 21 | 48 x 21, X-expanded | orange (8) | block |

Sprite 6, light grey, is fixed at X 330, Y 230, with its `$D010` bit set.

Measured in VICE x64sc 3.10 with the pinned command, text decoded
against the character ROM (rows 0 to 13, PAL):

```text
MULTI-SPRITE OBJECT  FRAME 00452
RESULT PASS 0
ORIGIN X 264 Y 172
CHECKED 00454 MISMATCHES 00000
SEAM FRAMES 169 CLIP FRAMES 045
UPDATE MAX 1342 MIN 0808
PART SHOWN 197 HIDDEN 078 FIXED 067
PART  DX   DY  X   HI EN W  H  FRM
0    +00  +00 264  1  1 24 21 192
1    +24  +00 288  1  1 24 21 194
2    +48  +00 312  1  1 24 21 192
3    -24  +21 240  0  1 48 21 192
4    +24  +21 288  1  1 24 42 192
5    +48  +21 312  1  1 48 21 192
```

NTSC reads the same except `FRAME 00512`, `CHECKED 00514`, `SEAM FRAMES
233` and part 1's `FRM 193`: the run is 60 frames longer at the same
cycle count, and the hold keeps counting. One status line is printed
each frame and one part row every fourth frame, so `FRAME` trails
`CHECKED` and `FRM` can trail the picture. The border is palette index
5, (98, 213, 50) on PAL and (114, 189, 103) on NTSC.

What the numbers say:

- `MISMATCHES 00000`: in every frame of the run every part's registers
  matched the model, sprite 6 kept its bits, and every part the model
  called hidden had its `$D015` bit clear.
- `SEAM FRAMES`: frames in which visible parts had different `$D010`
  bits. One `$D010` bit for the whole object would have put some part
  256 pixels off in each of them. The hold at X 264 is one such state:
  part 3's X is 240 (bit 0) while the origin and the other parts are at
  264 and above (bit 1), a negative offset that borrows across the seam.
- `CLIP FRAMES 045`: frames in which at least one part was at X 344 or
  beyond and was switched off. Part 2 (dx 48) leaves first, at origin
  296; 23 frames going right and 22 coming back.
- `UPDATE MAX 1342 MIN 0808`: the whole object update, CIA1 timer B,
  interrupts masked, at the top of the vertical blank, worst and best
  frame of the run, the same on both models. A probe build that also
  logged the origin found the worst at origin 282: all six parts shown,
  all six setting their `$D010` bit, and part 1 stepping its animation.
  The best was at origin 320, with four parts hidden.
- `PART SHOWN 197 HIDDEN 078 FIXED 067`: one update call each, less an
  empty call, screen blanked: six parts shown (origin 200), one part
  shown, and six parts hidden (origin 400). Shown per part is the
  difference of the first two divided by 5; fixed is the rest of the
  one-part call; hidden per part is the third less fixed, divided by 6.

The pictures: `screenshots/multi-sprite-object.png` (PAL) and
`screenshots/multi-sprite-object-ntsc.png` (NTSC), the hold at origin
X 264, Y 172. Measured with PIL on both: each part's colour covers
exactly the box the model gives it, left edge X + 8 and top row
Y + 1 − 16 on PAL (− 28 on NTSC), 24 or 48 wide and 21 or 42 tall.

| Part | X | `$D010` | PAL box x, y | NTSC box x, y | Pixels |
|---|---|---|---|---|---|
| 0 | 264 | 1 | 272-295, 157-177 | 272-295, 145-165 | 504 of 504 |
| 1 | 288 | 1 | 296-319, 157-177 | 296-319, 145-165 | 432 of 504 |
| 2 | 312 | 1 | 320-343, 157-177 | 320-343, 145-165 | 504 of 504 |
| 3 | 240 | 0 | 248-295, 178-198 | 248-295, 166-186 | 1008 of 1008 |
| 4 | 288 | 1 | 296-319, 178-219 | 296-319, 166-207 | 1008 of 1008 |
| 5 | 312 | 1 | 320-351, 178-198 | 320-351, 166-186 | 672 of 672 |

Part 3 is one sprite across the seam: its register X is 240 with its
`$D010` bit clear, and its pixels run from X 240 to 287. Part 5's box
stops at column 351, the last before the right border: 32 of its 48
columns show, 16 are under the border. Part 1 shows the open eye in
both shots, 72 pixels short, the 8 x 9 hole of frame 193. Sprite 6 is at
columns 338 to 351 and 20 rows, cut by the right and bottom borders.
Each model run twice gives byte-identical PNGs.

## Why this works

The object is one origin and a table. `object_update` adds each part's
signed offset to the origin as a 16-bit sum, so a part's ninth bit comes
from its own X, not from the origin's: at origin 264 part 3's
`264 - 24 = 240` has bit 8 clear. The low byte goes to `$D000 + 2i`, the
bit is collected into `msb`, and after the loop the object's six bits
are merged into `$D010` and `$D015` under `OBJ_MASK`. Sprite 6's bits
are outside the mask and are never touched; a plain `$D010 = msb` would
clear them, and the check would count a mismatch in every frame.

A part is written only when some of it is inside the window, X 24 to 343
and Y 50 to 249. Otherwise its enable bit stays clear. Under the right
border a part is harmless to the picture but still costs its hardware
sprite and its DMA; past 511 the sum would wrap, and on PAL X 504 to 511
is a hole the chip never draws (`sprite_x_range_hidden_and_seam` in
`docs/pitfalls/sprite.md`). A part left of X 0 needs a model-dependent
register value: a probe for this page put an X-expanded sprite at X 500
and found its left edge at -4 on PAL and -12 on NTSC (VICE x64sc,
exit screenshot), so wrapping is at 504 on PAL and 512 on NTSC. The
recipe hides such a part rather than branch on the model.

Colour and the expand bits do not change while the object lives, so
`object_spawn` writes them once, under the same mask. The animation
runs per part: only parts with more than one frame keep a countdown, and
the frame is added to the part's base frame, so a boss can blink an eye
without re-sending the rest. The model in `check` works the frame out
independently from the update count, `ticks / 8 % 2`.

Verified: compiled with Oscar64, run headless in VICE x64sc 3.10 with the
pinned command on PAL and NTSC, each twice with byte-identical PNGs; the
text was decoded against the character ROM and each part's box located
by colour with PIL, not by eye.
