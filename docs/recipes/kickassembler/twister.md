---
recipe: twister
toolchain: kickassembler
output_format: PRG
region: both
techniques: [twister, standard_bitmap, table_generation]
file_formats: [PRG]
uses_registers: [D011, D012, D016, D018, D020, D021, DC04, DC05, DC0E]
uses_kernal: []
harness: [cia1_timer_a]
---

<!-- doc-type: recipe -->

# KickAssembler recipe: a twister, a turning square column drawn as 128 lines copied from 64 phase images, timed

## Synopsis

Puts a standard bitmap at `$2000` with screen RAM at `$0400` set to white
ink on black paper, and every frame redraws a 64 pixel wide, 128 line
band as a square column turning about its vertical axis. The column's
four edges come from one sine, its faces from four fixed bit patterns,
and both are evaluated at assembly time into 64 phase images of 8 bytes
each. The frame loop is then a copy: line L of the band takes phase
(t + L) & 63, which is a straight helix, and its 8 bytes go through a
zero page pointer into the bitmap row. t advances by 1 a frame for 300
frames, then the program stops drawing and spins, so the picture is
static for the exit screenshot. Every frame's copy cost is measured with
CIA1 timer A and stored, two bytes a frame, from `$1000`; frame 0 runs
with the display blanked so its figure is the CPU's alone. Built with
`-define STRAIGHT` every line takes phase t, which is the control: a
column that turns but does not twist. The technique is `twister` in
`techniques/effects-vector-3d.md`.

## Source

```asm
// twister.asm
// A square column seen side on, turning about its vertical axis, drawn as a
// 64 pixel wide band of a hires bitmap, 128 lines tall. At rotation angle a
// (0 to 255 for a full turn) the four vertical edges are at
// x_i = 160 + 32 * sin((a + 64 i) & 255), i = 0 to 3, and face i spans x_i to
// x_(i+1) when x_i < x_(i+1); at most two faces are in front. Each face has a
// fixed pattern: face 0 solid, face 1 fifty percent dither ($AA on every
// row), face 2 twenty-five percent ($88), face 3 empty. The 64 phase images
// for a = 0, 4, .. 252 are built at assembly time, 8 bytes each, 512 bytes.
// Every frame, line L of the band (0 to 127) takes phase (t + L) & 63, which
// is a straight helix, and its 8 bytes are copied from the phase image
// through a zero page pointer into bitmap row 36 + L, bytes 16 to 23. The
// copy is unrolled over the 128 lines. t advances by 1 a frame for 300
// frames, then the program stops drawing and spins, so the picture is static
// for the exit screenshot. Each frame's copy cost is CIA1-timed and stored,
// two bytes a frame, at $1000; frame 0 runs with the display blanked (DEN
// clear) so its figure is the CPU's alone.
// Build with -define STRAIGHT for the control in which every line takes
// phase t, a column that does not twist.

.const BITMAP    = $2000
.const SCREEN    = $0400
.const FRAMES    = 300
.const TOP       = 36           // first bitmap row of the band
.const LINES     = 128
.const BAND_BYTE = 16           // first byte column of the band: x 128 to 191
.const TIMES     = $1000        // FRAMES 16-bit CIA counts, overhead removed
.const REC_OVER  = $02f0        // timer overhead of an empty measurement
.const REC_FRAME = $02f2        // frames completed
.const REC_DONE  = $02ff        // $01 when the 300 frames are drawn

// zero page: BASIC's numeric work area, free because the program never
// returns to BASIC
.const ptr       = $57          // bitmap clear pointer
.const src       = $59          // pointer into the phase table
.const t         = $5b          // time, advances by 1 a frame
.const t_lo      = $5c          // timer read scratch
.const t_hi      = $5d
.const tp        = $5e          // pointer into TIMES

// --- the phase images, built in script -----------------------------------
// Face i's edge positions for angle a, then every pixel of the 64 wide band
// tested against the four faces and the face's pattern bit ORed in.
.var facepat = List().add($ff, $aa, $88, $00)
.var phases = List()
.for (var p = 0; p < 64; p++) {
    .var a = p * 4
    .var xe = List()
    .for (var i = 0; i < 4; i++) {
        .eval xe.add(160 + round(32 * sin(toRadians(mod(a + 64 * i, 256) * 360 / 256))))
    }
    .for (var b = 0; b < 8; b++) {
        .var v = 0
        .for (var bit = 0; bit < 8; bit++) {
            .var x = 128 + b * 8 + bit
            .var m = 128 >> bit
            .for (var i = 0; i < 4; i++) {
                .var x0 = xe.get(i)
                .var x1 = xe.get(mod(i + 1, 4))
                .if (x0 < x1 && x >= x0 && x < x1 && (facepat.get(i) & m) != 0) {
                    .eval v = v | m
                }
            }
        }
        .eval phases.add(v)
    }
}

BasicUpstart2(start)

* = $4000 "code"

start:
    sei
    lda #$00
    sta $d020
    sta $d021
    sta t
    sta REC_FRAME
    sta REC_FRAME + 1
    lda #<TIMES
    sta tp
    lda #>TIMES
    sta tp + 1

// screen RAM: every cell white ink on black paper
    lda #$10
    ldx #0
fill_screen:
    sta SCREEN,x
    sta SCREEN + $100,x
    sta SCREEN + $200,x
    sta SCREEN + $2e8,x
    inx
    bne fill_screen

// clear the bitmap, $2000 to $3FFF
    lda #<BITMAP
    sta ptr
    lda #>BITMAP
    sta ptr + 1
    lda #0
    tay
    ldx #32
clear_page:
    sta (ptr),y
    iny
    bne clear_page
    inc ptr + 1
    dex
    bne clear_page

// VIC: screen at $0400, bitmap at $2000, hires, bitmap mode on with the
// display blanked (DEN clear) for frame 0. DEN is sampled once a frame on
// line $30, so two sightings of line 64 pass before the timed frame.
    lda #$18
    sta $d018
    lda #$08
    sta $d016
    lda #$2b
    sta $d011
    jsr wait_line_64
    jsr wait_line_64

// the empty measurement
    jsr timer_start
    jsr timer_read
    lda t_lo
    sta REC_OVER
    lda t_hi
    sta REC_OVER + 1

// --- the frame loop ---------------------------------------------------------
frame:
    jsr wait_line_250
    jsr timer_start
    jsr draw
    jsr timer_read
    lda t_lo
    sec
    sbc REC_OVER
    ldy #0
    sta (tp),y
    lda t_hi
    sbc REC_OVER + 1
    iny
    sta (tp),y
    lda tp
    clc
    adc #2
    sta tp
    bcc !+
    inc tp + 1
!:  lda #$3b                    // display on from frame 1
    sta $d011
    inc t
    inc REC_FRAME
    bne !+
    inc REC_FRAME + 1
!:  lda REC_FRAME
    cmp #<FRAMES
    bne frame
    lda REC_FRAME + 1
    cmp #>FRAMES
    bne frame
    lda #$01
    sta REC_DONE
halt:
    jmp halt

// --- draw: copy 128 phase images into the band ------------------------------
// src starts at phase image (t & 63) and steps 8 bytes a line. The table is
// page aligned and two pages long, so a page crossing toggles the high byte
// between the two pages, which also wraps image 63 back to image 0.
draw:
    lda t
    and #$3f
    asl
    asl
    asl                         // (t & 63) * 8, 0 to 248
    sta src
    lda t
    and #$20                    // bit 5 of t picks the page
    beq !+
    lda #1
!:  clc
    adc #>phase_table
    sta src + 1
    .for (var L = 0; L < LINES; L++) {
        .var y = TOP + L
        .var row = BITMAP + floor(y / 8) * 320 + mod(y, 8) + BAND_BYTE * 8
        .for (var k = 0; k < 8; k++) {
            ldy #k
            lda (src),y
            sta row + 8 * k
        }
#if !STRAIGHT
        lda src
        clc
        adc #8
        sta src
        bcc !+
        lda src + 1
        eor #$01
        sta src + 1
!:
#endif
    }
    rts

// --- wait_line_250: return during raster line 250, after it was not 250 --
wait_line_250:
    lda $d012
    cmp #$fa
    beq wait_line_250
wait_250:
    lda $d011
    bmi wait_250
    lda $d012
    cmp #$fa
    bne wait_250
    rts

// --- wait_line_64: return during raster line 64, after it was not 64 -----
wait_line_64:
    lda $d012
    cmp #$40
    beq wait_line_64
wait_64:
    lda $d011
    bmi wait_64
    lda $d012
    cmp #$40
    bne wait_64
    rts

// --- CIA1 timer A, one-shot from $FFFF; the count is $FFFF - the read ----
timer_start:
    lda #$00
    sta $dc0e
    lda #$ff
    sta $dc04
    sta $dc05
    lda #$19                    // force load, one-shot, start
    sta $dc0e
    rts

timer_read:
    lda $dc05
    sta t_hi
    lda $dc04
    sta t_lo
    lda $dc05
    cmp t_hi
    bne timer_read
    lda #$ff
    sec
    sbc t_lo
    sta t_lo
    lda #$ff
    sbc t_hi
    sta t_hi
    rts

// --- the phase table: 64 images of 8 bytes, page aligned -----------------
* = $1800 "phase table"
phase_table:
    .fill 512, phases.get(i)
```

## Build

```bash
java -jar KickAss.jar twister.asm -o twister.prg
```

For the control in which every line shares one phase:

```bash
java -jar KickAss.jar twister.asm -define STRAIGHT -o twister-straight.prg
```

`-showmem` reports the code segment at `$4000` to `$64A6` (9,383 bytes,
almost all of it the unrolled copy) and the phase table at `$1800` to
`$19FF` (512 bytes). The `STRAIGHT` build's code ends at `$5D26`.

## Expected output

A black screen with a white column 64 pixels wide in the middle, from
bitmap row 36 to row 163. Two faces of it are visible at any height: a
solid face, a fifty percent dithered face, a face of every fourth pixel,
and an empty face take turns as the column turns, and because each line
is 1/64 of a turn further round than the line above, the faces wind down
the column as a helix and appear to rise as it turns. After 300 frames
the program stops drawing and the picture holds still.

Measured in VICE x64sc 3.10 with the pinned command at 12,000,000
cycles, `$02FF` read `01` and `$02F2` read 300 (frames done) on both
models, so the picture is static at the pin; the pictures are
byte-identical across two runs on each model (PAL MD5 `8a682c0f…`, NTSC
`e704abc1…`). In the PAL picture the lit pixels lie in PNG columns 160
to 223 and rows 71 to 198 (bitmap x 128 to 191, rows 36 to 163), 3,236
of them, with 59 distinct row patterns over the 128 lines. The NTSC
picture holds the same rows at PNG rows 59 to 186, because t is a frame
count and both runs finished the same 300 frames.

The last frame drawn used t = 299, so line L of the band shows phase
(299 + L) & 63. Three rows, measured with PIL against the edge table the
listing builds (`x_i = 160 + 32 sin`, rounded):

| Band line | Phase, angle | x0, x1, x2, x3 | Faces in front | First lit pixel | Last lit pixel |
|---|---|---|---|---|---|
| 0 | 43, a = 172 | 132, 145, 188, 175 | 0 (132 to 145), 1 (145 to 188) | 132 | 186 |
| 40 | 19, a = 76 | 191, 151, 129, 169 | 2 (129 to 169), 3 (169 to 191) | 132 | 168 |
| 100 | 15, a = 60 | 192, 163, 128, 157 | 2 (128 to 157), 3 (157 to 192) | 128 | 156 |

The first lit pixel is the left edge of the leftmost visible face where
that face is solid (line 0) and the first pixel of it that the pattern
lights where it is not: face 2 lights every pixel whose x is a multiple
of 4, so at line 40 the span from 129 is first lit at 132. The last lit
pixel is the last one the pattern lights below the exclusive right edge:
186 under 188 for the dither, 168 under 169 and 156 under 157 for every
fourth pixel. Face 3 is empty, so where it is in front the column ends
at face 2's right edge. The same three rows of the NTSC picture give the
same six numbers.

The `STRAIGHT` build at the same pin shows the phase 43 image on every
line: first lit 132, last lit 186 at lines 0, 40 and 100, and one
distinct row pattern over the 128 lines. That is the column at a = 172
without the helix, and it is the difference the per-line phase makes.

Screenshots from the VICE runs this page describes:
`screenshots/twister.png` (PAL) and `screenshots/twister-ntsc.png`.

Two further pictures, not pinned, made with the same command and other
inputs, live under `docs/figures/`:

- `figures/twister-mid-5000000.png`: PAL, `-limitcycles 5000000`, while
  the column is still turning. 3,257 lit pixels in the same 128 rows,
  the helix at another phase. Nothing is torn, for the reason given
  under "Where the work runs".
- `figures/twister-straight-12000000.png`: PAL, the `STRAIGHT` build at
  the pinned cycle count, the one-pattern column of the table above.

The timer figures, read from the running machine with a `-moncommands`
file that traces the store to `$02FF` and dumps `$02F0`-`$02FF` and
`$1000`-`$1257`, overhead of an empty measurement (20 cycles) removed:

| | PAL | NTSC |
|---|---|---|
| Frame 0, display blanked | 13,001 | 13,001 |
| Frames 1 to 299, display on, least | 13,557 | 13,813 |
| Frames 1 to 299, display on, most | 13,561 | 13,819 |
| Frames 1 to 299, display on, mean | 13,560 | 13,816 |
| Frame 0, blanked, `STRAIGHT` build | 11,305 | not measured here |
| Frames 1 to 299, `STRAIGHT`, least to most | 11,725 to 11,736 | not measured here |

Per line, 13,001 / 128 is 101.6 cycles blanked and 13,561 / 128 is 105.9
for the worst PAL frame with the display on (arithmetic from the
measured frames). The blanked frame is the same on both models because
the CPU's work is the same; the display-on frames differ because the
copy runs while the VIC is fetching and the badlines it crosses stall
the CPU under the timer's count.

## Why this works

### The phase images

The listing builds the images in KickAssembler script before any code
is emitted, with nested `.for` loops that fill a `List`, and one
`.fill 512, phases.get(i)` emits it. For phase p (angle a = 4p) the four
edges are `160 + round(32 * sin((a + 64 i) & 255 in turns))`; then for
each of the 64 pixels of the band, and each face i, if `x_i < x_(i+1)`
and the pixel lies in `[x_i, x_(i+1))` and the face's pattern byte has
the pixel's bit set, the bit is ORed into the image byte. The pattern
bytes are `$FF`, `$AA`, `$88` and `$00`: the fifty percent face uses
`$AA` on every row rather than alternating with `$55`, so its dither is
vertical stripes, not a checkerboard; that keeps the image a function of
the phase alone, which is what lets one 8-byte image serve any line.

A square seen side on has at most two faces towards the viewer, and the
test `x_i < x_(i+1)` is exactly that: a face whose right edge has
crossed to the left of its left edge is on the far side. The edges are
never stored as bytes, only compared in script, and the amplitude is 32
about 160, so the values run 128 to 192 and nothing is near a byte's
edge; `sine_table_peak_wraps_to_zero` in `pitfalls/maths.md` is about an
unsigned table of amplitude 128 about 128 whose peak is 256, and does
not arise here.

### The copy

The band is bitmap x 128 to 191, which is byte columns 16 to 23 of each
row, and bitmap rows 36 to 163. The byte holding pixel (0, y) is
`BITMAP + (y / 8) * 320 + (y & 7)`, and byte column c of that row is
`8 c` further on, so line L's eight destination addresses are constants
the assembler works out, and the copy is unrolled over the 128 lines:
per line, eight pairs of `ldy #k`, `lda (src),y`, `sta row + 8 k`, then
the pointer advance. The source pointer starts at image `t & 63`, which
is `phase_table + 8 (t & 63)`: the low byte is `(t & 63) << 3` and the
high byte is the table's page plus bit 5 of t, because the table is page
aligned and images 0 to 31 fill the first page, 32 to 63 the second.
Advancing by 8 with a carry into an `eor #1` on the high byte both steps
to the second page and wraps from image 63 back to image 0, which is the
`& 63` in `(t + L) & 63`; the `STRAIGHT` build leaves the advance out.

Per line that is 8 by (2 + 5 + 4) = 88 cycles for the copy and 13 for
the advance when the carry is clear, 20 when it is set (arithmetic from
the instruction table): 128 lines of 101 plus the setup is 12,960 before
the four or five page crossings, against the measured 13,001. The
`STRAIGHT` build measures 11,305, and the 1,696 between them is the 128
advances at 13.25 each. A version that kept the phase in X and read
eight 64-entry planes with `lda plane_k,x` would drop the per-line cost
to about 70 (arithmetic, not built here), at the price of a table laid
out by plane rather than by image.

### Where the work runs

The frame is: wait for raster line 250, start the timer, copy the 128
lines, read the timer, advance t. The blank after line 250 is about
6,700 cycles on PAL (`full_field_redraw_exceeds_vblank` in
`pitfalls/text-mode-render.md` does the arithmetic) and the copy is
13,001, so it runs on past the top of the next field. It does not tear,
because it stays ahead of the beam: from line 251 to the band's first
raster line (87 of the next field) is 148 lines, 9,324 cycles, in which
the copy has written about 92 of the 128 band lines; the beam then
covers a band line every 63 cycles and the copy one every 102, and the
beam would need 242 lines to catch up, more than the band has
(arithmetic from the measured per-line cost). The mid-motion picture at
5,000,000 cycles shows a whole helix. The margin is the band's height:
at this per-line cost a band of the full 200 rows from row 0 would have
about 69 lines written when the beam reached it and would be caught at
about line 183 (same arithmetic), and would want a second bitmap and a
`$D018` swap.

Both models finish a frame inside a frame: the worst display-on frame is
13,561 on PAL against 19,656 a frame, and 13,819 on NTSC against 17,095
(263 lines of 65), so the loop is back at `wait_line_250` before line 250
comes round again and t advances once per displayed frame. The 300
frames take 6 seconds of PAL machine time and 5 of NTSC (arithmetic, at
50 and 60 frames a second); boot and autostart take about three seconds
more, which is why 8,000,000 cycles was tried first and found the loop
still running on both models (`$02FF` never written) and 12,000,000 was
pinned.

### What the timer measures

CIA1 timer A is loaded with `$FFFF` and started in one-shot mode
(`$DC0E = $19`); the count read back after the copy, subtracted from
`$FFFF`, is the cycles elapsed, and the 20-cycle empty measurement taken
once at the start is subtracted from every frame before it is stored.
The timer counts machine cycles whether or not the CPU is running, so a
display-on frame includes the badline stalls, which is why frame 0 was
run with DEN clear: its 13,001 is what the code costs, the display-on
figures are what the frame costs. The spread of 4 cycles across the
display-on PAL frames is the page crossings of the pointer falling on
different lines as t moves.

### Region

`region: both`. The mechanism is the same on NTSC; the animation runs
20 % faster because t is a frame count, the display-on frame costs about
260 cycles more because the copy crosses more badlines relative to where
it starts, and the frame still fits with about 3,300 cycles to spare.
Both pinned pictures hold the same 128 rows.

### What it does not establish

**Real hardware.** Every figure on this page is from VICE x64sc 3.10; no
C64 was run.

**More than 64 pixels of width.** The 8-byte image and the per-line cost
are for this band; a wider column means more bytes per line and a larger
phase table, and no build with one was made or timed.

**Colour.** The bitmap is one ink on one paper. A coloured face would
write screen RAM pairs, which are one pair per 8 by 8 cell and so cannot
follow an edge that falls inside a cell; nothing of the kind was built.

**The NTSC `STRAIGHT` figures.** The control was timed on PAL only.

**A bending helix.** The phase is `t + L`, a straight helix; a second
sine on L was not built.
