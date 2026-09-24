---
recipe: sprite-expand
toolchain: oscar64
output_format: PRG
region: both
techniques: [sprite_expand, per_frame_hitbox]
file_formats: [PRG]
uses_registers: [D000, D001, D002, D003, D004, D005, D006, D007, D008, D009, D00A, D00B, D00C, D00D, D00E, D00F, D010, D011, D015, D017, D01C, D01D, D020, D021, D027, D028, D029, D02A, D02B, D02C, D02D, D02E, DC06, DC07, DC0F]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 sprite expand: X, Y and both, and a collision box scaled with the sprite

## Synopsis

One sprite image shown four times: unexpanded, X-expanded (`$D01D`),
Y-expanded (`$D017`) and both. Each case is two hardware sprites at the
same position with the same expand bits: a white outline of the whole
image, and in front of it a yellow 8 x 5 block at pixel 6, 8 of the
image. The block is a collision box drawn. The program computes each
case's box by one rule, offset and size doubled on each expanded axis
and the origin (the X and Y registers) unchanged, and prints it; the
screenshot shows the yellow block covers exactly that box. It also times
one `spr_expand()` call, both expand registers written as whole bytes,
and one scaled box, with CIA1 timer B. `$02FF` = `01` and a green border
when both expand registers read back as written (`headless-verify.md`).
This is the `sprite_expand` technique from `docs/techniques/sprite.md`,
and the "Expanded sprites" rule of `per_frame_hitbox`.

## Source

```c
// sprite-expand.c
//
// The same sprite four times: unexpanded, X-expanded, Y-expanded and
// both. Each case is two hardware sprites at one position with the same
// expand bits: an outline of the whole 24 x 21 image (white) and, in
// front of it, a solid 8 x 5 block at pixel 6, 8 of the image (yellow),
// which is a collision box drawn. Each case's box is scaled by the rule
// for an expanded sprite: offset and size doubled on the expanded axis,
// the origin (the X and Y registers) unchanged. Rows 3-6 print each
// box; the screenshot shows whether the yellow block covers exactly it.
// Rows 8-10: CIA1 timer B cycles for one spr_expand() call, for both
// expand registers written as whole bytes, and for one scaled box.
// $02FF = 01 and a green border when both expand registers read back
// as set; 02 and red if not.
//
#include <c64/vic.h>
#include <c64/cia.h>
#include <c64/sprites.h>

#define Screen  ((char *)0x0400)
#define Color   ((char *)0xd800)
#define SprData ((char *)0x3000)            // blocks 192 and 193
#define SPR_BLK 192
#define RESULT  (*(volatile char *)0x02ff)

// The box on the unexpanded image, in sprite pixels.
#define BOX_DX 6
#define BOX_DY 8
#define BOX_W  8
#define BOX_H  5

#define CASES 4
const int  case_x[CASES]  = { 40, 100, 180, 240 };
const char case_y          = 150;
const char case_xe[CASES] = { 0, 1, 0, 1 };
const char case_ye[CASES] = { 0, 0, 1, 1 };

// --- the rule: a box on an expanded sprite ------------------------------
struct Box { int l, r; char t, b; };
struct Box box[CASES];

void box_emit(char i, int x, char y, char xe, char ye)
{
    // Offset and size double on an expanded axis; the origin does not move.
    int  l = x + (BOX_DX << xe);
    char t = y + (BOX_DY << ye);
    box[i].l = l;
    box[i].r = l + (BOX_W << xe);           // exclusive
    box[i].t = t;
    box[i].b = t + (BOX_H << ye);           // exclusive
}

// --- images ----------------------------------------------------------------
void make_images(void)
{
    for (char i = 0; i < 128; i++)
        SprData[i] = 0;
    for (char r = 0; r < 21; r++) {         // block 192: outline
        char *p = SprData + r * 3;
        if (r == 0 || r == 20) {
            p[0] = p[1] = p[2] = 0xff;
        } else {
            p[0] = 0x80;
            p[2] = 0x01;
        }
    }
    for (char r = BOX_DY; r < BOX_DY + BOX_H; r++) {   // block 193: the box
        SprData[64 + r * 3 + 0] = 0x03;     // columns 6, 7
        SprData[64 + r * 3 + 1] = 0xfc;     // columns 8 to 13
    }
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

// Arguments the compiler cannot fold: a volatile global that nothing
// writes is folded to its initial value, so they live at a fixed address.
#define ARGS    ((volatile char *)0x02f0)   // sprite, xexpand, yexpand

__noinline void nothing(void) { }
__noinline void one_expand(void) { spr_expand(ARGS[0], ARGS[1], ARGS[2]); }
__noinline void both_bytes(void)
{
    vic.spr_expand_x = 0x0f;
    vic.spr_expand_y = 0x3c;
}
__noinline void one_box(void) { box_emit(3, case_x[3], case_y, ARGS[1], ARGS[2]); }

unsigned time1(void (*fn)(void))
{
    __asm { sei }
    timer_start();
    fn();
    unsigned t = timer_stop();
    __asm { cli }
    return t;
}

// --- text (screen codes) -----------------------------------------------------
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

    // Case i: sprite 2i the box (in front), sprite 2i + 1 the outline.
    for (char i = 0; i < CASES; i++) {
        spr_set(2 * i, true, case_x[i], case_y, SPR_BLK + 1, VCOL_YELLOW,
                false, case_xe[i], case_ye[i]);
        spr_set(2 * i + 1, true, case_x[i], case_y, SPR_BLK, VCOL_WHITE,
                false, case_xe[i], case_ye[i]);
        box_emit(i, case_x[i], case_y, case_xe[i], case_ye[i]);
    }

    put_str(Screen + 0,      s"sprite expand");
    put_str(Screen + 2 * 40, s"case xe ye  x   y   box l   r   t   b");
    for (char i = 0; i < CASES; i++) {
        char *row = Screen + (3 + i) * 40;
        row[0] = 0x30 + i;
        row[5] = 0x30 + case_xe[i];
        row[8] = 0x30 + case_ye[i];
        put_dec(row + 11, case_x[i], 3);
        put_dec(row + 15, case_y, 3);
        put_dec(row + 23, box[i].l, 3);
        put_dec(row + 27, box[i].r, 3);
        put_dec(row + 31, box[i].t, 3);
        put_dec(row + 35, box[i].b, 3);
    }

    // Cycles, screen blanked, less an empty call. The timed calls write
    // the expand registers; the cases' bits are restored after.
    vic.ctrl1 &= ~VIC_CTRL1_DEN;
    vic_waitFrame();
    vic_waitFrame();
    ARGS[0] = 3;
    ARGS[1] = 1;
    ARGS[2] = 1;
    unsigned t_none = time1(nothing);
    unsigned t_exp  = time1(one_expand) - t_none;
    unsigned t_byte = time1(both_bytes) - t_none;
    unsigned t_box  = time1(one_box) - t_none;
    vic.spr_expand_x = 0xcc;                // cases 1 and 3: sprites 2-3, 6-7
    vic.spr_expand_y = 0xf0;                // cases 2 and 3: sprites 4-7
    vic.ctrl1 |= VIC_CTRL1_DEN;

    put_str(Screen + 8 * 40,  s"spr expand one call");
    put_dec(Screen + 8 * 40 + 22, t_exp, 3);
    put_str(Screen + 9 * 40,  s"d01d d017 as bytes");
    put_dec(Screen + 9 * 40 + 22, t_byte, 3);
    put_str(Screen + 10 * 40, s"one scaled box");
    put_dec(Screen + 10 * 40 + 22, t_box, 3);

    char fault = (vic.spr_expand_x != 0xcc || vic.spr_expand_y != 0xf0) ? 1 : 0;
    RESULT = fault ? 2 : 1;
    vic.color_border = fault ? 2 : 5;
    put_str(Screen + 40, fault ? s"result fail" : s"result pass");

    for (;;)
        ;
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=sprite-expand.prg sprite-expand.c
```

Produces `sprite-expand.prg`, 1,853 bytes. The two sprite images are
built at run time at `$3000`, blocks 192 and 193. Then run headless in
VICE (PAL):

```bash
GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas x64sc -default -warp +sound \
  +autostart-delay-random -autostartprgmode 1 -limitcycles 4000000 \
  -exitscreenshot sprite-expand.png -autostart sprite-expand.prg
```

Add `-model ntsc` for the NTSC picture.

## Expected output

Measured in VICE x64sc 3.10 with the pinned command, text decoded
against the character ROM (rows 0 to 10, PAL):

```text
SPRITE EXPAND
RESULT PASS
CASE XE YE  X   Y   BOX L   R   T   B
0    0  0  040 150     046 054 158 163
1    1  0  100 150     112 128 158 163
2    0  1  180 150     186 194 166 176
3    1  1  240 150     252 268 166 176

SPR EXPAND ONE CALL   048
D01D D017 AS BYTES    012
ONE SCALED BOX        158
```

NTSC reads the same. The border is palette index 5, (98, 213, 50) on
PAL and (114, 189, 103) on NTSC.

The cycle figures are CIA1 timer B, interrupts masked, screen blanked,
one call each less an empty call:

- `SPR EXPAND ONE CALL 048`: `spr_expand(sp, xexpand, yexpand)` with
  arguments the compiler cannot fold: a read-modify-write of `$D01D` and
  of `$D017` under a mask built from the sprite number.
- `D01D D017 AS BYTES 012`: `lda #` / `sta` into each register, the
  whole byte for all eight sprites. A game that knows every sprite's
  expand bits writes them this way.
- `ONE SCALED BOX 158`: `box_emit` for the expanded case, compiled C with
  variable shifts. Hand-written assembly with a table of doubled offsets
  would be cheaper; not measured here.

The pictures: `screenshots/sprite-expand.png` (PAL) and
`screenshots/sprite-expand-ntsc.png` (NTSC). Measured with PIL on both,
converting a column to sprite X as column − 8 and a row to a raster line
as row + 16 on PAL (+ 28 on NTSC):

| Case | Outline X | Outline lines | Yellow X | Yellow lines | Yellow pixels | Box l to r, t to b |
|---|---|---|---|---|---|---|
| 0, none | 40-63 | 151-171 | 46-53 | 159-163 | 40 | 46-54, 158-163 |
| 1, X | 100-147 | 151-171 | 112-127 | 159-163 | 80 | 112-128, 158-163 |
| 2, Y | 180-203 | 151-192 | 186-193 | 167-176 | 80 | 186-194, 166-176 |
| 3, X and Y | 240-287 | 151-192 | 252-267 | 167-176 | 160 | 252-268, 166-176 |

Every yellow block is solid (8 x 5 pixels times the scale) and its X
span is the printed box's left edge to its right edge less one (right is
exclusive). Its lines are the box's top plus one to its bottom: a
sprite's first line is one raster line below its Y register (as
`sprite_sine_chain` measured), and that holds for the box, so a box in
register coordinates tests correctly against another box in the same
coordinates. The outline starts at the X and Y registers in every case:
expansion grows the sprite right and down from the origin and never
moves it. The same numbers on NTSC.

## Why this works

`$D01D` and `$D017` hold one bit per sprite. With a bit set the VIC
draws each pixel of that sprite twice as wide, or each row on two lines,
from the same 63 bytes (`sprite_expand` in `docs/techniques/sprite.md`).
The position registers still name the top-left corner, so every pixel at
offset `dx`, `dy` in the image lands at `x + 2 * dx` or `y + 2 * dy` on
an expanded axis. A collision box is a rectangle of image pixels, so it
scales by the same rule: offset and size doubled on the expanded axis,
the origin untouched. `box_emit` shifts by the expand flag, 0 or 1.

`spr_expand()` is an inline function in Oscar64's `c64/sprites.h`: it
sets or clears one bit of each register. Given constants, Oscar64 folds
it to an `ORA #` per register; given run-time values it builds the mask
and branches, 48 cycles. The timed call reads its arguments from
`$02F0`: a first build that passed them in `volatile` globals which
nothing wrote had them folded to their initial values, and the timed
function compiled to two `ORA #$08`s (read from the `.asm` listing).

Verified: compiled with Oscar64, run headless in VICE x64sc 3.10 with
the pinned command on PAL and NTSC; the text was decoded against the
character ROM and each block and outline located by colour with PIL,
not by eye.
