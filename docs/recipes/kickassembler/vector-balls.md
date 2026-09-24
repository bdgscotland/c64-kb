---
recipe: vector-balls
toolchain: kickassembler
output_format: PRG
region: both
techniques: [vector_balls_sprites]
file_formats: [PRG]
uses_registers: [D000, D001, D002, D003, D004, D005, D006, D007, D008, D009, D00A, D00B, D00C, D00D, D00E, D00F, D012, D015, D017, D01B, D01C, D01D, D020, D021, D027, D028, D029, D02A, D02B, D02C, D02D, D02E, DC04, DC05, DC0E]
uses_kernal: []
harness: [cia1_timer_a]
ram: [colour=$D800-$DBFF]
---

<!-- doc-type: recipe -->

# KickAssembler: Vector Balls on Sprites

## Synopsis

Eight sprite balls run round a tilted ring in 3D. Every frame the eight
are sorted by depth with one bubble pass and the nearest is given
hardware sprite 0, the farthest sprite 7, so the VIC's fixed
sprite-to-sprite priority draws a near ball over a far one with no
masking. Screen x, screen y and a depth byte are three assembler-built
tables indexed by the ball's angle; the near half of the ring uses a
24 by 21 ball image, the far half a 16 by 14 one, and colour steps from
white through light grey to grey with distance. The frame's work is
CIA-timed and the loop stops after 300 frames so the exit screenshot is
static. This is the `vector_balls_sprites` technique; build with
`-define NOSORT` for the control with the sort left out.

Verified in VICE x64sc: at the pinned cycle count the sixteen position
registers hold the table's values for the depth order the sort
predicts, the ball drawn over each overlap is the nearer one by the
table, and the control build draws a farther ball on top.

## Source

```asm
// vector-balls.asm
// Eight sprite balls on a tilted ring, turned one table step a frame,
// depth-sorted every frame and drawn with the VIC's fixed sprite-to-sprite
// priority: the nearest ball gets hardware sprite 0, the farthest sprite 7,
// so a near ball covers a far one without any masking. Ball k at frame t
// sits at angle a = (t + 32k) & 255 on a ring of radius 40 in the XZ plane,
// lifted by 12 * sin(a) so the ring reads as tilted. Screen x, screen y
// and a depth byte zd = 128 + z are three assembler-built tables indexed
// by a; the CPU never multiplies or divides. The camera is on the -z side,
// so a LARGER zd is FARTHER away.
//
// The sort is one bubble pass a frame over the previous frame's order,
// which is enough because the order changes by adjacent swaps; a check
// after the pass counts the frames it left unsorted. The lookup, the pass
// and the sixteen position, eight pointer and eight colour writes are
// timed with CIA1 timer A; the frame count, the unsorted count, the worst
// frame and the last frame are printed in hex on row 0 and kept at $0C00.
// The loop stops after 300 frames so the exit screenshot is static.
//
// Region: both. The frame's work runs from raster line 255, below the
// display on PAL and NTSC. Build with -define NOSORT for the control:
// the sort pass is left out and hardware sprite k always shows ball k.

.const SCREEN  = $0400
.const BIGBALL = $2000            // pointer $80: 24 by 21 ball, near half
.const SMLBALL = $2040            // pointer $81: 16 by 14 ball, far half
.const RESULTS = $0c00            // frame, unsorted, worst, last, done
.const FRAMES  = 300
.const RADIUS  = 40               // ring radius in the XZ plane
.const TILT    = 12               // y = TILT * sin(a)
.const EYE     = 200              // z of the projection plane behind the ring
.const XMID    = 172              // sprite X of the ring's centre
.const YMID    = 130              // sprite Y of the ring's centre
.const NEAR    = 120              // zd below this: white
.const MID     = 136              // zd below this: light grey, else grey

// Perspective: screen = centre + coordinate * 256 / (z + EYE).
.function proj(a, amp, centre) {
    .var rad = toRadians(a * 360 / 256)
    .var z3 = RADIUS * cos(rad)
    .return round(centre + amp * sin(rad) * 256 / (z3 + EYE))
}
.function depth(a) {
    .return round(128 + RADIUS * cos(toRadians(a * 360 / 256)))
}
// One byte of a filled ellipse rx by ry pixels, centred in a 24 by 21 sprite.
.function ballByte(row, col8, rx, ry) {
    .var v = 0
    .for (var c = 0; c < 8; c++) {
        .var x = col8 * 8 + c
        .if (pow((x - 11.5) / (rx / 2), 2) + pow((row - 10) / (ry / 2), 2) <= 1) {
            .eval v = v | (128 >> c)
        }
    }
    .return v
}

.pc = $0801 "basic"
:BasicUpstart(start)

.pc = $0810 "code"
start:
    sei
    lda #0
    sta $d020
    sta $d021
    sta frame
    sta frame+1
    sta unsorted
    sta unsorted+1
    sta worst
    sta worst+1
    sta done

    ldx #0                        // clear the screen
    lda #$20
clr:
    sta SCREEN,x
    sta SCREEN+$100,x
    sta SCREEN+$200,x
    sta SCREEN+$300,x
    inx
    bne clr

    ldx #39                       // row 0: labels in dark grey, no ball colour
lbl:
    lda #11
    sta $d800,x
    lda label,x
    sta SCREEN,x
    dex
    bpl lbl

    ldx #7                        // all eight sprites on, no expansion,
setup:                            // in front of the background
    lda sprn,x                    // order[i] = 7 - i, so before any sort
    sta order,x                   // hardware sprite k shows ball k
    lda #BIGBALL/64
    sta SCREEN+$3f8,x
    lda #1
    sta $d027,x
    ldy pairs,x                   // park every sprite inside the display:
    lda #YMID                     // from reset Y is 0, which the VIC also
    sta $d001,y                   // matches at line 256, in the timed window
    dex
    bpl setup
    lda #0
    sta $d017
    sta $d01d
    sta $d01c
    sta $d01b
    lda #$ff
    sta $d015

loop:
    lda #255                      // wait for raster line 255
!:  cmp $d012
    bne !-

    inc frame                     // t advances by 1
    bne !+
    inc frame+1
!:
    lda #$ff                      // CIA1 timer A: one shot from $FFFF
    sta $dc04
    sta $dc05
    lda #$19
    sta $dc0e

    // Lookup: ball k reads px, py, zd at a = t + 32k.
    lda frame
    ldx #0
look:
    sta atmp
    tay
    lda px,y
    sta bx,x
    lda py,y
    sta by,x
    lda zd,y
    sta bz,x
    lda atmp
    clc
    adc #32
    inx
    cpx #8
    bne look

#if !NOSORT
    // One bubble pass, zd descending: order[0] is the farthest ball.
    ldx #0
pass:
    ldy order,x
    lda bz,y
    ldy order+1,x
    cmp bz,y
    bcs !+                        // zd[i] >= zd[i+1]: in order
    lda order,x                   // else swap the pair
    sta order+1,x
    tya
    sta order,x
!:  inx
    cpx #7
    bne pass
#endif

    // Assign: order[i] goes to hardware sprite 7 - i.
    ldx #0
assign:
    ldy order,x
    lda bz,y
    sta ztmp
    lda by,y
    sta ytmp
    lda bx,y
    ldy pairs,x                   // 2 * (7 - i)
    sta $d000,y
    lda ytmp
    sta $d001,y
    ldy sprn,x                    // 7 - i
    lda ztmp
    cmp #128
    bcs !+                        // zd >= 128: far, small ball
    lda #BIGBALL/64
    bne ptr
!:  lda #SMLBALL/64
ptr:
    sta SCREEN+$3f8,y
    lda ztmp
    cmp #NEAR
    bcs !+
    lda #1                        // white
    bne col
!:  cmp #MID
    bcs !+
    lda #15                       // light grey
    bne col
!:  lda #12                       // grey
col:
    sta $d027,y
    inx
    cpx #8
    bne assign

    lda #0                        // stop the timer; elapsed = $FFFF - count
    sta $dc0e
    lda $dc04
    eor #$ff
    sta last
    lda $dc05
    eor #$ff
    sta last+1

    lda worst+1                   // worst = max(worst, last)
    cmp last+1
    bcc newmax
    bne nomax
    lda worst
    cmp last
    bcs nomax
newmax:
    lda last
    sta worst
    lda last+1
    sta worst+1
    lda frame
    sta worstat
    lda frame+1
    sta worstat+1
nomax:

    // Did the one pass leave the order sorted? Count the frames it did not.
    ldx #0
check:
    ldy order,x
    lda bz,y
    ldy order+1,x
    cmp bz,y
    bcs !+
    inc unsorted
    bne shown
    inc unsorted+1
    jmp shown
!:  inx
    cpx #7
    bne check
shown:

    ldy #6                        // row 0: frame, unsorted, worst, last
    lda frame+1
    jsr phex
    lda frame
    jsr phex
    ldy #16
    lda unsorted+1
    jsr phex
    lda unsorted
    jsr phex
    ldy #26
    lda worst+1
    jsr phex
    lda worst
    jsr phex
    ldy #36
    lda last+1
    jsr phex
    lda last
    jsr phex

    lda frame                     // stop after FRAMES frames
    cmp #<FRAMES
    bne again
    lda frame+1
    cmp #>FRAMES
    bne again
    lda #1
    sta done
    jmp *
again:
    jmp loop

phex:                             // A as two hex digits at SCREEN,Y; Y += 2
    pha
    lsr
    lsr
    lsr
    lsr
    tax
    lda hex,x
    sta SCREEN,y
    iny
    pla
    and #$0f
    tax
    lda hex,x
    sta SCREEN,y
    iny
    rts

atmp:   .byte 0
ytmp:   .byte 0
ztmp:   .byte 0
order:  .fill 8, 0                // ball index per depth rank, farthest first
bx:     .fill 8, 0                // this frame's screen x per ball
by:     .fill 8, 0
bz:     .fill 8, 0
pairs:  .byte 14, 12, 10, 8, 6, 4, 2, 0
sprn:   .byte 7, 6, 5, 4, 3, 2, 1, 0
hex:    .text "0123456789abcdef"  // lowercase: .text is screen codes
label:  .text "frame ....  bad ....  max ....  cyc ...."

.pc = RESULTS "results"
frame:    .word 0                 // t; the frame count after the run
unsorted: .word 0                 // frames the one pass left unsorted
worst:    .word 0                 // most cycles a frame's work took
last:     .word 0                 // the last frame's cycles
done:     .byte 0                 // 1 after the last frame
worstat:  .word 0                 // the frame the worst was measured on

.align $100
px: .fill 256, proj(i, RADIUS, XMID)
py: .fill 256, proj(i, TILT, YMID)
zd: .fill 256, depth(i)
.for (var i = 0; i < 256; i++) {
    .errorif proj(i, RADIUS, XMID) > 255 - 23, "a ball would cross X 255"
}

.pc = BIGBALL "big ball"
.for (var r = 0; r < 21; r++) { .byte ballByte(r, 0, 24, 21), ballByte(r, 1, 24, 21), ballByte(r, 2, 24, 21) }
.byte 0
.pc = SMLBALL "small ball"
.for (var r = 0; r < 21; r++) { .byte ballByte(r, 0, 16, 14), ballByte(r, 1, 16, 14), ballByte(r, 2, 16, 14) }
.byte 0
```

## Build

```bash
java -jar KickAss.jar vector-balls.asm -o vector-balls.prg
java -jar KickAss.jar vector-balls.asm -define NOSORT -o vector-balls-nosort.prg   # the control
```

## Expected output

Black screen and border. Row 0 reads `FRAME 012C  BAD 0006  MAX 056D
CYC 0526` in dark grey once the loop has stopped: 300 frames drawn, six
frames on which one bubble pass left the order unsorted, a worst frame
of 1,389 cycles and a last frame of 1,318. Below it eight balls sit on a
band running from upper left to lower right: white 24 by 21 balls for
the near half of the ring, grey 16 by 14 balls for the far half, the far
balls partly or wholly behind the near ones. The run halts on
`jmp *` with the picture static, so any cycle count past the halt gives
the same picture.

### The tables

`px[a]` is `172 + 40 sin(a) * 256 / (40 cos(a) + 200)` rounded, `py[a]`
the same with amplitude 12 and centre 130, and `zd[a] = 128 + 40 cos(a)`,
for `a` in 0 to 255 steps of a 256-step turn. Computed in Python from the
same formulas: px runs 120 to 224, py 114 to 146, zd 88 to 168. The
widest ball is 24 pixels, so no sprite's X reaches 255 (224 + 23 is 247)
and `$D010` is never written; the `.errorif` in the listing refuses to
assemble a table that would. The camera is on the negative z side, so a
larger zd is farther away: the ball image is the small one for `zd >=
128` and the colour is white below 120, light grey from 120 to 135 and
grey from 136 up. Over the table 111 entries are white, 32 light grey and
113 grey (arithmetic). At frame 300 no ball's zd falls in the light
grey band, so the pinned picture shows only white and grey.

### Frame 300, both models

Ball k is at angle `(300 + 32k) & 255`. The bubble pass, simulated from
the start order 7..0 over 300 frames, ends with the order (farthest
first) 7, 6, 0, 5, 1, 4, 2, 3, so sprite 7 shows ball 7 and sprite 0
shows ball 3. The VIC's registers at the halt, dumped by the monitor on
the PAL run, agree with the table for all eight:

| Sprite | Ball | Angle | zd | Image | Colour | X, Y from the table | $D000 pair read |
|---|---|---|---|---|---|---|---|
| 0 | 3 | 140 | 90 | big | white | 154, 124 | $9A, $7C |
| 1 | 2 | 108 | 93 | big | white | 201, 139 | $C9, $8B |
| 2 | 4 | 172 | 109 | big | white | 122, 115 | $7A, $73 |
| 3 | 1 | 76 | 116 | big | white | 224, 146 | $E0, $92 |
| 4 | 5 | 204 | 140 | small | grey | 126, 116 | $7E, $74 |
| 5 | 0 | 44 | 147 | small | grey | 213, 142 | $D5, $8E |
| 6 | 6 | 236 | 163 | small | grey | 151, 124 | $97, $7C |
| 7 | 7 | 12 | 166 | small | grey | 184, 134 | $B8, $86 |

`$07F8` to `$07FF` read `80 80 80 80 81 81 81 81`, `$D027` to `$D02E`
read `01 01 01 01 0C 0C 0C 0C`, and `$D010` is 0.

### Which ball covers which

Screenshot column is VIC X plus 8; the row is VIC Y less 15 on PAL and
less 27 on NTSC (`sprite-sine-chain.md`, "Reading a sprite's position
off the picture"). The small image occupies columns 4 to 19 and rows 3
to 16 of its sprite. Pixel colours were counted with PIL inside the
rectangle where two balls' images overlap; VICE's palette gives white as
(255, 255, 255) and grey as (148, 148, 148).

| Pair | zd | Nearer by the table | Overlap, PAL columns and rows | Sorted build | NOSORT control |
|---|---|---|---|---|---|
| ball 0 over ball 1 | 147 against 116 | ball 1 | 232 to 240, 131 to 143 | 96 white, 18 grey | 13 white, 101 grey |
| ball 0 over ball 2 | 147 against 93 | ball 2 | 225 to 232, 130 to 143 | 97 white, 12 grey | 21 white, 88 grey |
| ball 5 inside ball 4 | 140 against 109 | ball 4 | 138 to 153, 104 to 117 | 211 white, 1 grey | 211 white, 1 grey |

In the sorted build the white near ball is on top in both crossing
pairs, and the far grey pixels that remain are the small ball's edge
outside the big ball's ellipse. In the control, ball 0 is hardware
sprite 0 and beats sprites 1 and 2 whatever its depth, so the far grey
ball is drawn on top of both white ones: the same rectangles turn
mostly grey. Ball 5's small image lies wholly inside ball 4's big one;
the sort hides it, and the control happens to as well because sprite 4
outranks sprite 5. The NTSC pictures give the same counts twelve rows
higher. The two control pictures are `docs/figures/vector-balls-nosort.png`
and `docs/figures/vector-balls-nosort-ntsc.png`, from the same command with
`vector-balls-nosort.prg`.

### One pass a frame

The listing checks the order after every pass and counts the frames it
left unsorted: 6 of 300 on PAL and on NTSC, and a Python replay of the
pass from the start order says they are frames 1 to 6, the frames the
reversed start order takes to settle. From frame 7 on, one pass a frame
kept the eight sorted, because two balls only ever change depth order by
crossing each other, which is an adjacent swap. The control counts 300:
the fixed order 7..0 was never the depth order on any frame.

### Cycles

CIA1 timer A, one shot from $FFFF, started before the lookup and stopped
after the last colour write, so the figure includes the eight lookups,
the sort pass, the sixteen position writes, eight pointer writes and
eight colour writes, and about eight cycles of the timer's own start and
stop instructions (arithmetic, not removed).

| Build | Model | Last frame (frame 300) | Worst frame | Worst on frame |
|---|---|---|---|---|
| sorted | PAL | 1,318 | 1,389 | 1 |
| sorted | NTSC | 1,318 | 1,389 | 1 |
| NOSORT | PAL | 1,129 | 1,137 | 1 |

The pass with no swap therefore costs 1,318 less 1,129, 189 cycles, and
the six swaps of frame 1 another 71 (arithmetic from the measured
frames). The whole frame is about 21 raster lines, well inside the
blank below line 255 on either model.

An earlier build of this page read a worst frame of 1,769. That was not
the routine: from reset every sprite's Y is 0, which the VIC also
matches at raster line 256, so the reset-state sprites took DMA from the
timed window on the first frame. The listing now parks every Y at 130
in the setup. A first repair wrote `sta $d001,x` with X counting 0 to 7,
which lands on $D001 to $D008: the Y registers of sprites 0 to 3 and
the X registers of sprites 1 to 4, leaving sprites 4 to 7 at Y 0 (an
earlier version said sprites 5 to 7); that
build read 1,608, and the pair table fixed it.

### Frame count and cycles

The `done` store lands at cycle 8,863,351 on PAL and 8,207,167 on NTSC
(monitor trace), both inside the 12,000,000 pinned. The pin is static:
two runs per model gave byte-identical pictures.

Screenshots from the VICE runs this page describes:
`screenshots/vector-balls.png` (PAL) and
`screenshots/vector-balls-ntsc.png`.

## Why this works

### Priority by assignment

The VIC draws sprite 0 over sprite 1, 1 over 2 and so on, and nothing
in a register changes that (`hardware/vic-ii-reference.md`, "Priority").
A depth sort cannot move the balls between priorities, so it moves the
priorities between the balls: the program keeps `order`, the ball index
per depth rank, and writes rank i's position, image and colour into
hardware sprite 7 - i. The eight sprites never change what they are,
only which ball they are showing this frame, and the overlap comes out
right without a mask or a second image.

### Three tables and no arithmetic

The projection divides by depth, and the ring's depth at angle a is
known at assembly time, so `px`, `py` and `zd` are built by KickAssembler
script from the perspective formula and the frame loop only indexes
them. The angle is a byte, so `t + 32k` wraps on its own; the tables are
page-aligned so no indexed read crosses a page. The `.errorif` loop is
the range check that keeps `$D010` out of the picture: it fails the
build if a change to the radius, centre or eye distance would push a
ball past X 255.

### One bubble pass

A full sort every frame would be safe but costs more. The
balls move a step of one 256th of a turn a frame, and two of them only
change depth order by crossing, so the previous frame's order is at
most a few adjacent swaps from the new one, and a single pass performs
them. The check after the pass measures this: six settling frames and
then none.

## What it does not establish

Nothing here was run on real hardware; VICE x64sc 3.10 is the
instrument. The perspective is only as right as the table: the ball
images do not scale with depth beyond the two sizes, and the tilt is a
sine term, not a rotated ring. Eight balls is the hardware's sprite
count; more needs a multiplexer and the sort then has to cooperate with
the raster order, which this page does not attempt. The one-pass claim
is measured for this ring, speed and start order only; a faster turn or
balls that cross three at a time could need a second pass.
