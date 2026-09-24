---
recipe: fixed-point-jump
toolchain: oscar64
output_format: PRG
region: both
techniques: [fixed_point_8_8, jump_arc_table]
file_formats: [PRG]
uses_registers: [D000, D001, D010, D015, D017, D01C, D01D, D020, D021, D027]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 fixed-point jump arc

## Synopsis

One hardware sprite jumps and lands, over and over, with its position
held in 8.8 fixed point: velocity gains gravity, position gains velocity,
the high byte goes to the sprite Y register. The same arc is also held
as a 63-byte table, `arc_y[]`, generated off-line from the same two
adds. Row 0 of the screen shows the frame counter, the frame within the
jump, the sprite Y register and the table value, so a screenshot at a
pinned frame can be checked against the table by reading the picture.
If the live value ever differs from the table the border turns red. Use
it as the starting point for any platformer jump.

## Source

```c
// fixed-point-jump.c -- a sprite jumps in an 8.8 fixed-point arc.
// Frame counter, jump frame, sprite Y register and the precomputed table
// value are shown on row 0 so a screenshot can be checked against the table.
// Build: oscar64 -tm=c64 -O2 -o=fixed-point-jump.prg fixed-point-jump.c
#include <c64/vic.h>
#include <c64/sprites.h>

#define SCREEN  ((char *)0x0400)
#define COLOUR  ((char *)0xd800)
#define SPRDATA ((char *)0x0340)      // block 13, the cassette buffer

#define GROUND_Y 229                  // sprite Y register when standing
#define SPRITE_X 172
#define JUMP_V0  (-0x0400)            // -4.0 px/frame in 8.8
#define GRAVITY  0x0020               // +0.125 px/frame^2 in 8.8
#define PERIOD   63                   // frames from launch to landing

// Precomputed arc: sprite Y at jump frame n, from gen.py with the same
// V0, gravity and update order as the loop below.
static const char arc_y[PERIOD] = {
    229, 225, 221, 217, 214, 210, 207, 204, 201, 198, 195, 193, 190,
    188, 186, 184, 182, 180, 178, 176, 175, 173, 172, 171, 170, 169,
    168, 168, 167, 167, 167, 167, 167, 167, 167, 167, 168, 168, 169,
    170, 171, 172, 173, 175, 176, 178, 180, 182, 184, 186, 188, 190,
    193, 195, 198, 201, 204, 207, 210, 214, 217, 221, 225
};

static void put_dec(char col, unsigned v, char width)
{
    char *p = SCREEN + col;
    for (signed char k = width - 1; k >= 0; k--) { p[k] = 0x30 + v % 10; v /= 10; }
}

static void put_str(char col, const char *s)
{
    char *p = SCREEN + col;
    while (*s) { char c = *s++; *p++ = (c == ' ') ? 0x20 : c - 'a' + 1; }
}

int main(void)
{
    for (unsigned i = 0; i < 1000; i++) { SCREEN[i] = 0x20; COLOUR[i] = 1; }
    for (char i = 0; i < 63; i++) SPRDATA[i] = 0xff;     // solid 24x21 block
    vic.color_back = 0;
    vic.color_border = 5;

    spr_init(SCREEN);
    spr_set(0, true, SPRITE_X, GROUND_Y, 13, VCOL_YELLOW, false, false, false);

    put_str(0, "f");  put_str(9, "j");  put_str(15, "y");  put_str(22, "t");
    put_str(29, "apex");

    int      y_fp  = GROUND_Y << 8;   // 8.8 position
    int      vy_fp = 0;               // 8.8 velocity, + is down
    unsigned frame = 0;               // frames since start
    char     n     = 0;               // frame within the jump, 0 = on ground
    char     apex  = 255;

    for (;;)
    {
        vic_waitFrame();

        // Row 0 shows the state that produced the sprite now on screen.
        put_dec(2, frame, 5);
        put_dec(11, n, 2);
        put_dec(17, vic.spr_pos[0].y, 3);
        put_dec(24, arc_y[n], 3);
        put_dec(34, apex, 3);

        if (n == 0)
            vy_fp = JUMP_V0;          // launch
        vy_fp += GRAVITY;             // gravity first, then position
        y_fp  += vy_fp;
        n++;
        if (y_fp >= (GROUND_Y << 8)) { y_fp = GROUND_Y << 8; n = 0; }

        char y = y_fp >> 8;           // pixel byte for the sprite register
        if (y < apex) apex = y;
        if (y != arc_y[n]) vic.color_border = 2;   // live and table disagree
        spr_move(0, SPRITE_X, y);
        frame++;
    }
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=fixed-point-jump.prg fixed-point-jump.c
```

Produces `fixed-point-jump.prg` (868 bytes including the BASIC stub).
The compiler prints `warning 2017: Invalid value range` for the
`arc_y[n]` read after `n++`; `n` is reset to 0 on the landing frame
before that read, so the index never reaches 63. Load with
`LOAD"FIXED-POINT-JUMP",8,1 : RUN` or via VICE autostart.

## Expected output

Black screen, green border, a solid yellow 24x21 sprite at X 172 rising
and falling over the bottom third of the screen, and a white status line
on row 0: `F` frames since start, `J` frame within the jump, `Y` the
sprite Y register, `T` the table value for that jump frame, `APEX` the
lowest register value seen so far. The border goes red only if the live
8.8 value and the table ever disagree; it did not in either pinned run.

Pinned runs (VICE x64sc 3.10, `-warp +sound +autostart-delay-random
-autostartprgmode 1 -limitcycles 8000000`), pictures in
`screenshots/fixed-point-jump.png` and
`screenshots/fixed-point-jump-ntsc.png`, decoded with the character ROM
and measured with PIL:

| | PAL | NTSC (`-model ntsc`) |
|---|---|---|
| Row 0 text | `f 00252  j 00  y 229  t 229  apex 167` | `f 00283  j 31  y 167  t 167  apex 167` |
| Frame the sprite is drawn in | jump frame 1 | jump frame 32 |
| `arc_y[]` for that frame | 225 | 167 |
| Sprite rows in the PNG | 210 to 230 | 140 to 160 |
| Sprite Y from the PNG | 225 | 167 |
| Border pixel (2,100) | green | green |

The status line describes the frame that has just finished, because it
is written after `vic_waitFrame()` and before the update that moves the
sprite for the next one. The picture is the next frame. So `J 00, Y 229`
on PAL is a picture of jump frame 1, whose table value is 225, and the
sprite measured from the PNG is at register 225. On NTSC `J 31` is a
picture of frame 32; the table holds 167 for both, the flat apex. The
sprite's first row appears in the PNG one line below its Y register
(PAL row 210 is raster line 226 with the formula row = line - 16; NTSC
row 140 is line 168 with row = line - 28); both pictures agree on that
offset, as `hardware/vic-ii-reference.md` states (the first sprite row
is on the line after the Y register value). An earlier draft of this table read the register straight off
the status line and disagreed with the picture by one frame; the
one-frame lag above is why.

A cleaner listing would print the values after the update, so that the
text and the sprite in one picture describe the same frame, and would
keep `y_fp` in an `unsigned` (in an `int`, `229 << 8` wraps negative;
the arithmetic still holds because every value in the arc wraps the
same way, but it reads badly). Neither change has been run, so neither
is in the listing.

## Why this works

The whole jump is two adds a frame on 16-bit values: `vy_fp += GRAVITY`
and `y_fp += vy_fp`. With `JUMP_V0 = -$0400` and `GRAVITY = $0020` the
velocity reaches zero after 32 updates and the sprite is back on the
ground after 63; the 63 velocity steps sum to exactly zero, so the
landing is exact and the clamp is only there for constants where it is
not. The textbook 16-bit add is the `clc / lda / adc / sta / lda /
adc / sta` shape that `techniques/maths.md` measures at 26 cycles with
absolute operands. Oscar64 1.32.271 at `-O2` does better here (read from
the `.asm` file the build writes): both values live in zero-page
temporaries, the gravity add is `clc / lda / adc #$20 / sta / bcc` with an
`inc` of the high byte only when the low byte carries, and the position
add continues from the accumulator (`adc / sta / lda / adc`), keeping the
high byte in A for the ground clamp. By the instruction table that is
13 + 12 = 25 cycles on a frame with no carry into the velocity's high
byte and 31 on a frame with one (rung 3, not measured in this recipe).
An earlier version said the compiler emitted `adc #$00` for the high byte
and that the adds took 20 cycles. The pixel byte is `y_fp >> 8`, one byte move,
and it goes through `spr_move` from `<c64/sprites.h>` into `$D001`.

`arc_y[]` was generated by the same two adds in Python, and the loop
compares its own result against the table every frame. Gravity is added
before the position (semi-implicit Euler). Adding position first moves
the full launch speed on the first step, lands after 65 updates and
gives a table that differs from jump frame 4 onward (rung 3, from the
same Python integration), so the generator and the loop must agree on
the order.

The sprite image is 63 bytes of `$FF` at `$0340`, block 13, which is the
cassette buffer and free once the program is running; `spr_init(SCREEN)`
points the sprite pointer table at `$07F8` and `spr_set` writes pointer,
colour, position and enable in one call. The frame is paced by
`vic_waitFrame()`, so on PAL the arc takes 63/50 of a second and on NTSC
63/60; the table is in frames, not time, which is why the two pictures
show different frame counts for the same cycle budget.

`arc_y[]` is absolute Y from `GROUND_Y`, so it only plays from that one
ground. A jump that has to start from a platform stores the per-frame
velocity instead and adds it to whatever `y` it starts from;
`fixed-point-jump-velocity.md` is that variant, with two sprites on
floors 64 pixels apart driven by one table.
