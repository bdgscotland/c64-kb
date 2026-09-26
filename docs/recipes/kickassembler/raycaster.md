---
recipe: raycaster
toolchain: kickassembler
output_format: PRG
region: both
techniques: [raycaster_grid_walls, ecm_mode]
file_formats: [PRG]
uses_registers: [D011, D012, D018, D020, D021, D022, D023, D024, DC0D]
uses_kernal: []
claims: [cia1_timer_a (init), cia1_timer_b (init), cia1_tod (init), vic_raster_irq (init), vic_matrix_base (owns), zero_page $02-$1B (owns)]
harness: [$02F0-$02F1]
ram: [screen=$0400-$07FF, back=$3C00-$3FFF]
---

<!-- doc-type: recipe -->

# KickAssembler recipe: a column raycaster on a grid map, drawn in extended-colour text

## Synopsis

A first-person view of a 16 × 16 grid map from its middle, the camera
turning through 64 directions. For each of the 40 screen columns a ray
is marched from the camera in fixed steps of 1/8 of a cell along the view
direction until it enters a wall cell; the step count is the
perpendicular distance, so the walls are straight, and a table turns it
into a height in character rows. The column is drawn as ceiling, wall
and floor in extended-colour mode using the blank character only, so each
cell's colour comes from its code and the whole picture is in screen RAM:
two screens take turns, switched with `$D018` below the display. The
march uses only additions; the assembler works out each direction's ray
steps. The technique is `raycaster_grid_walls` in
`techniques/effects-vector-3d.md`.

## Source

```asm
// raycaster.asm
// A column raycaster on a 16 x 16 grid map: 40 rays a frame, one per
// screen column, each marched in fixed steps until it enters a wall cell;
// the step count is the wall's distance and picks its height. Drawn in
// extended-colour text mode with blank characters only, so each cell's
// colour is in its code, and two screens take turns.
//
// Camera: at map (8.5, 8.5), turning through 64 directions, one per frame
// drawn. The ray for column c (0-39) has direction dir + plane x cx, with
// cx = (2c + 1) / 40 - 1 and plane = 0.66 x dir turned 90 degrees, and is
// marched in steps of (dir + plane x cx) / 8. Every step moves the ray 1/8
// of a cell along the view direction, whatever the column, so the count k
// is 8 x the perpendicular distance and the walls are not bent (no
// fish-eye). The assembler works out each direction's column-0 step and
// the change from column to column in 8.16 fixed point (8.8 loses up to
// half of the change per column); the CPU only adds.
//
// Height: h = min(25, round(200 / k)) rows, centred. Codes (ECM, glyph 32,
// blank): 32 ceiling ($D021), 96 wall entered through an x side ($D022),
// 160 wall entered through a y side ($D023), 224 floor ($D024).
// $02F0 holds the direction on screen, $02F1 counts frames drawn.

.const DIRS   = 64
.const N      = 8               // steps per cell of distance
.const SHOWN  = $02f0
.const DRAWN  = $02f1
.const SCRA   = $0400
.const SCRB   = $3c00

.const px     = $02             // ray position x, 8.8: $02 frac, $03 cell
.const py     = $04             // $04/$05
.const sx     = $06             // ray step x, $06/$07
.const sy     = $08             // $08/$09
.const cx     = $0a             // column step change, $0a/$0b
.const cy     = $0c             // $0c/$0d
.const k      = $0e             // steps taken
.const side   = $0f             // 96 or 160
.const col    = $10
.const dir    = $11
.const which  = $12             // 0: SCRA shown, draw into SCRB
.const ptr    = $13             // $13/$14
.const top    = $15
.const h      = $16
.const oldx   = $17
.const sxf    = $18             // a third, lower byte of each column step:
.const syf    = $19             // steps are kept in 8.16 between columns
.const cxf    = $1a
.const cyf    = $1b

BasicUpstart2(start)

* = $0900
start:
    sei
    lda #$7f
    sta $dc0d
    lda $dc0d
    lda #0
    sta $d020
    lda #6                      // ceiling: blue
    sta $d021
    lda #7                      // x-side walls: yellow
    sta $d022
    lda #8                      // y-side walls: orange
    sta $d023
    lda #11                     // floor: dark grey
    sta $d024
    lda #$5b                    // ECM on, DEN, 25 rows, YSCROLL 3
    sta $d011
    lda #$14                    // screen $0400, character ROM $1000
    sta $d018
    lda #0
    sta which
    sta dir
    sta DRAWN
    lda #$ff
    sta SHOWN
    cli                         // CIA1 masked above: no interrupt runs
frame:
    jsr draw
    lda which
    eor #1
    sta which
    beq !+
    lda #$f4                    // screen $3C00
    jmp !set+
!:  lda #$14                    // screen $0400
!set:
    ldx #252                    // switch below the display
!:  cpx $d012
    bne !-
    sta $d018
    lda dir
    sta SHOWN
    inc DRAWN
    lda dir
    clc
    adc #1
    and #DIRS - 1
    sta dir
    jmp frame

// draw: direction `dir` into the screen not shown.
draw:
    ldx dir
    lda s0xf, x
    sta sxf
    lda s0xl, x
    sta sx
    lda s0xh, x
    sta sx + 1
    lda s0yf, x
    sta syf
    lda s0yl, x
    sta sy
    lda s0yh, x
    sta sy + 1
    lda dcxf, x
    sta cxf
    lda dcxl, x
    sta cx
    lda dcxh, x
    sta cx + 1
    lda dcyf, x
    sta cyf
    lda dcyl, x
    sta cy
    lda dcyh, x
    sta cy + 1
    lda #0
    sta col
!col:
    // march from (8.5, 8.5)
    lda #$80
    sta px
    sta py
    lda #8
    sta px + 1
    sta py + 1
    lda #0
    sta k
!step:
    lda px + 1
    sta oldx
    clc
    lda px
    adc sx
    sta px
    lda px + 1
    adc sx + 1
    sta px + 1
    clc
    lda py
    adc sy
    sta py
    lda py + 1
    adc sy + 1
    sta py + 1
    inc k
    beq !far+                   // 256 steps: give up
    ldx py + 1
    lda px + 1
    and #15
    ora shl4, x
    tax
    lda map, x
    beq !step-
    lda #96                     // x side if the cell column changed
    ldx px + 1
    cpx oldx
    bne !+
    lda #160
!:  sta side
    ldx k
    lda htab, x
    jmp !have+
!far:
    lda #0
!have:
    sta h
    lda #25
    sec
    sbc h
    lsr
    sta top
    // draw column col: rows 0 .. top-1 ceiling, top .. top+h-1 wall, rest floor
    lda which
    beq !+
    lda #>SCRA
    jmp !hi+
!:  lda #>SCRB
!hi:
    sta ptr + 1
    lda col
    sta ptr
    ldx #0                      // row
!row:
    lda #32
    cpx top
    bcc !put+
    txa
    sec
    sbc top
    cmp h
    lda side
    bcc !put+
    lda #224
!put:
    ldy #0
    sta (ptr), y
    lda ptr
    clc
    adc #40
    sta ptr
    bcc !+
    inc ptr + 1
!:  inx
    cpx #25
    bne !row-
    // next column: step += change, 24 bits
    clc
    lda sxf
    adc cxf
    sta sxf
    lda sx
    adc cx
    sta sx
    lda sx + 1
    adc cx + 1
    sta sx + 1
    clc
    lda syf
    adc cyf
    sta syf
    lda sy
    adc cy
    sta sy
    lda sy + 1
    adc cy + 1
    sta sy + 1
    inc col
    lda col
    cmp #40
    beq !+
    jmp !col-
!:  rts

.align $100
shl4: .fill 256, (i & 15) << 4
// htab[k] = min(25, round(200 / k)); htab[0] unused.
htab: .fill 256, i == 0 ? 25 : min(25, round(200 / i))
// The map: 1 = wall. A border, and blocks inside.
map:
    .byte 1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1
    .byte 1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1
    .byte 1,0,1,1,0,0,0,0,0,0,0,1,1,0,0,1
    .byte 1,0,1,0,0,0,0,0,0,0,0,0,1,0,0,1
    .byte 1,0,0,0,0,0,1,0,0,1,0,0,0,0,0,1
    .byte 1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1
    .byte 1,0,0,0,1,0,0,0,0,0,0,1,0,0,0,1
    .byte 1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1
    .byte 1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1
    .byte 1,0,0,1,0,0,0,0,0,0,0,0,1,0,0,1
    .byte 1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1
    .byte 1,0,0,0,0,0,1,1,1,0,0,0,0,0,0,1
    .byte 1,0,1,0,0,0,0,0,0,0,0,0,0,1,0,1
    .byte 1,0,1,1,0,0,0,0,0,0,0,0,1,1,0,1
    .byte 1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1
    .byte 1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1

// Per direction d: column-0 step and the change per column, 8.16 fixed
// point in three bytes (f, l, h); the march uses the top two (8.8).
.function A(d) { .return toRadians(d * 360 / DIRS) }
.function S0X(d) { .return round(65536 * (cos(A(d)) + 0.66 * sin(A(d)) * (1 - 1 / 40)) / N) & $ffffff }
.function S0Y(d) { .return round(65536 * (sin(A(d)) - 0.66 * cos(A(d)) * (1 - 1 / 40)) / N) & $ffffff }
.function DCX(d) { .return round(65536 * (-0.66 * sin(A(d)) * 2 / 40) / N) & $ffffff }
.function DCY(d) { .return round(65536 * (0.66 * cos(A(d)) * 2 / 40) / N) & $ffffff }
s0xf: .fill DIRS, S0X(i) & $ff
s0xl: .fill DIRS, (S0X(i) >> 8) & $ff
s0xh: .fill DIRS, (S0X(i) >> 16) & $ff
s0yf: .fill DIRS, S0Y(i) & $ff
s0yl: .fill DIRS, (S0Y(i) >> 8) & $ff
s0yh: .fill DIRS, (S0Y(i) >> 16) & $ff
dcxf: .fill DIRS, DCX(i) & $ff
dcxl: .fill DIRS, (DCX(i) >> 8) & $ff
dcxh: .fill DIRS, (DCX(i) >> 16) & $ff
dcyf: .fill DIRS, DCY(i) & $ff
dcyl: .fill DIRS, (DCY(i) >> 8) & $ff
dcyh: .fill DIRS, (DCY(i) >> 16) & $ff
```

## Build

```bash
java -jar KickAss.jar raycaster.asm -o raycaster.prg
```

`-showmem` reports `$0900` to `$10FF`; the PRG is 2,305 bytes. The
second screen is `$3C00`.

## Expected output

A black border; a blue ceiling and dark grey floor; walls in yellow where
the ray entered a cell through its left or right side and orange where it
came through the top or bottom, taller for nearer walls, from 25 rows at
one cell away.

Measured in VICE x64sc 3.10, PAL c64c (8565/8580/8521) and NTSC
(`-model ntsc`, 6567R8). A Python model runs the listing's march on the
tables read out of the assembled PRG for all 64 directions; each of the
1,000 character cells of the exit screenshot was decoded with PIL (one
colour per cell, palette triples from `runtime/vice-reference.md`, colour
to code) and compared:

| Run | Model | Best direction | Cells equal, of 1,000 | `$02F0` at exit |
|---|---|---|---|---|
| 8,000,000 cycles | PAL | 25 | 1,000 | 25 |
| 8,000,000 cycles | NTSC | 25 | 1,000 | 25 |
| `@later`, 12,000,000 cycles | PAL | 44 | 1,000 | 44 |
| `@later`, 12,000,000 cycles | NTSC | 44 | 1,000 | 44 |

Also exact at 9, 10 and 11 million cycles on PAL and at 10 and 11
million on NTSC; at 9 million on NTSC 998 cells match, the exit
screenshot taken with the beam inside the display. Screenshots:
`screenshots/raycaster.png`, `screenshots/raycaster-ntsc.png`,
`screenshots/raycaster-later.png` and `screenshots/raycaster-later-ntsc.png`.

### Against an exact raycast

The same camera and map raycast in floating point by stepping from cell
boundary to cell boundary (the DDA method), height min(25, round(25 /
distance)), over all 64 directions and 40 columns (2,560 columns):

| Height, march minus exact | Columns |
|---|---|
| 0 | 2,115 |
| −1 | 264 |
| +1 | 74 |
| 2 to 6 either way | 107 |

The march stops up to 1/8 of a cell inside the wall, so it errs low.
The larger errors were not traced one by one; a fixed step can pass a
wall's corner between two samples, which the boundary-to-boundary method
cannot. The side agrees in 2,337 columns.

An earlier build of this listing kept the ray step and its change from
column to column in 8.8 fixed point. The change is 0.6 to 0.9 of the last
place, so rounding it lost up to half of it, the error grew by that much
at every column, and only 930 of the 2,560 heights matched the exact
raycast (errors up to 10 rows). The listing keeps them in 8.16.

### The draw time

A store trace of `$02F1` over 12,000,000 cycles: one view drawn every
157,246 to 216,221 cycles on PAL (8 to 11 frames) and 153,851 to 222,240
on NTSC; a long view takes more steps.

## Why this works

### Straight walls without division

The ray for column c has direction d + p·cx, where d is the view
direction, p the view plane (d turned 90 degrees and scaled by 0.66, the
field of view) and cx runs from −1 to 1 across the screen. Every such
ray advances by exactly d along the view direction per unit of its own
length, so a step of (d + p·cx) / 8 moves every ray 1/8 of a cell towards
the view plane's far side, and the step count is 8 times the
perpendicular distance. A height table indexed by the count replaces the
division, and there is no fish-eye to correct.

### No multiplication either

The column-0 step and the change per column, p·(2/40)/8, are computed by
the assembler for each of the 64 directions; the CPU adds the change
after each column and adds the step to the ray position each step. The
position is 8.8, its high bytes are the map cell, and a table turns the
row into the map index. The side is the axis whose cell number changed
on the last step (x first if both did).

### One screen per view

In extended-colour mode the top two bits of a screen code pick one of
four background colours; with the blank character (code 32, 96, 160 or
224) a cell is a block of that colour, and colour RAM is not used. A
whole view is 1,000 bytes of screen RAM, drawn into the hidden screen
and switched on line 252.

### Sources

- The view-plane ray and grid DDA formulation (used here for the exact
  comparison) are standard and written out above; no third-party data
  or listing was used.
