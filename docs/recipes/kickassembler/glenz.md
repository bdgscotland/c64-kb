---
recipe: glenz
toolchain: kickassembler
output_format: PRG
region: both
techniques: [glenz_eor_filled_vectors, rotozoomer_charset, mcm_text]
file_formats: [PRG]
uses_registers: [D011, D012, D016, D018, D020, D021, D022, D023, DC0D]
uses_kernal: []
claims: [cia1_timer_a (init), cia1_timer_b (init), cia1_tod (init), zero_page $02-$14 (owns)]
harness: [$02F0-$02F1]
ram: [colour=$D800-$DBFF]
---

<!-- doc-type: recipe -->

# KickAssembler recipe: a see-through cube filled by EOR in a character-set framebuffer

## Synopsis

A rotating cube drawn with all six faces, front and back, each in a
two-bit colour code, so the back shows through the front in other
colours: a glenz cube. Each face is drawn as points only, one per pixel
column along each of its four edges, EORed into a 64 × 64 multicolour
buffer; then every pixel column is filled top to bottom with a running
EOR, which sets the pixels between each pair of points. Where faces
overlap, their codes combine by EOR. The buffer is a double-buffered
character set laid out column by column, as in `rotozoomer`, so a column
fill is a run down 64 consecutive bytes. The projected geometry is
worked out by the assembler for 64 steps of the rotation. Built
`:closed=1` every edge also plots its right-hand end. The technique is
`glenz_eor_filled_vectors` in `techniques/effects-vector-3d.md`.

## Source

```asm
// glenz.asm
// A see-through (glenz) cube filled by EOR: every face, front and back,
// is drawn as outline points into a two-bit-per-pixel buffer with EOR,
// then each pixel column is filled from top to bottom with a running EOR.
// Where faces overlap their colour codes combine by EOR, so the back of
// the cube shows through the front in other colours.
//
// The buffer is a character set used as a framebuffer, as in the
// rotozoomer recipe: a 16 x 8 character window (columns 12-27, rows 8-15)
// holds codes 8col + row, so window column group col is the 64 bytes at
// charset + 64col, one per pixel line, four multicolour pixels a byte. A
// column fill is a run down 64 consecutive bytes. Two charsets, $2000 and
// $2800, take turns.
//
// The geometry is worked out by the assembler for 64 steps of the
// rotation: for each of the cube's 12 edges, its left end x0, its width
// x1 - x0 (0 for a vertical edge), its y at x0 in 8.8 (with 0.5 added) and
// its slope dy/dx in 8.8. Each face EORs its code into the points of its
// four edges: for x from x0 to x1 - 1, the pixel (x, y >> 8), then
// y += slope. Each column then has an even number of points per face, and
// the running EOR sets the pixels between each pair. Face codes: +x 1,
// -x 2, +y 2, -y 3, +z 3, -z 1 (multicolour bit pairs: 1 = $D022,
// 2 = $D023, 3 = colour RAM).
//
// $02F0 holds the step on screen, $02F1 counts frames drawn. Built
// :closed=1 every edge also plots its right-hand end, x1.

.const STEPS  = 64
.var CLOSED = cmdLineVars.containsKey("closed") ? cmdLineVars.get("closed").asNumber() : 0
.const SHOWN  = $02f0
.const DRAWN  = $02f1

.const ptr    = $02             // $02/$03 store pointer
.const yf     = $04             // $04 frac, $05 int
.const slope  = $06             // $06/$07
.const x      = $08
.const n      = $09             // pixels left on the edge
.const code   = $0a
.const face   = $0b
.const k      = $0c
.const step   = $0d
.const which  = $0e             // 0: $2000 shown, draw into $2800
.const base   = $0f             // charset high byte being drawn
.const eix    = $10
.const tp     = $12             // $12/$13 edge table pointer
.const code4  = $14             // 4 x code

BasicUpstart2(start)

* = $0900
start:
    sei
    lda #$7f
    sta $dc0d
    lda $dc0d
    // Screen: character 128 (blank) everywhere, window codes 8col + row,
    // colour RAM 8 + 7 in the window (multicolour, bit pair 3 = yellow).
    ldx #0
!:  lda #128
    sta $0400, x
    sta $0500, x
    sta $0600, x
    sta $06e8, x
    lda #0
    sta $d800, x
    sta $d900, x
    sta $da00, x
    sta $dae8, x
    inx
    bne !-
    ldy #0                      // row
!r: lda rowlo, y
    sta ptr
    lda rowhi, y
    sta ptr + 1
    ldx #0
!c: txa
    asl
    asl
    asl
    sty k
    ora k
    stx x
    ldy x
    sta (ptr), y
    lda ptr + 1
    pha
    clc
    adc #($d800 - $0400) >> 8
    sta ptr + 1
    lda #8 | 7
    sta (ptr), y
    pla
    sta ptr + 1
    ldy k
    inx
    cpx #16
    bne !c-
    iny
    cpy #8
    bne !r-
    lda #0
    tax
!:  sta $2400, x               // character 128 in both charsets: blank
    sta $2c00, x
    inx
    bne !-
    lda #0
    sta $d020
    sta $d021
    lda #2                      // bit pair 1: red
    sta $d022
    lda #5                      // bit pair 2: green
    sta $d023
    lda #$d8
    sta $d016
    lda #$18
    sta $d018
    lda #0
    sta which
    sta step
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
    lda #$1a                    // show $2800
    jmp !set+
!:  lda #$18                    // show $2000
!set:
    ldx #250                    // switch below the window
!:  cpx $d012
    bne !-
    sta $d018
    lda step
    sta SHOWN
    inc DRAWN
    lda step
    clc
    adc #1
    and #STEPS - 1
    sta step
    jmp frame

// draw: step `step` into the charset not shown.
draw:
    lda which
    beq !+
    lda #$20
    jmp !h+
!:  lda #$28
!h: sta base
    // clear the window's 1K (codes 0-127)
    sta ptr + 1
    lda #0
    sta ptr
    ldx #4
    ldy #0
!:  sta (ptr), y
    iny
    bne !-
    inc ptr + 1
    dex
    bne !-
    // faces: 6 x 4 edges
    lda #0
    sta face
!face:
    ldx face
    lda fcode, x
    sta code
    asl
    asl
    sta code4
    lda #0
    sta k
!edge:
    lda face                    // 6 * edge index, from fedges[4 face + k]
    asl
    asl
    ora k
    tax
    lda fedges, x
    sta eix
    jsr edge
    inc k
    lda k
    cmp #4
    bne !edge-
    inc face
    lda face
    cmp #6
    bne !face-
    jsr fill
    rts

// edge: plot the edge eix of step `step` with `code`.
edge:
    // tp = the step's table (sbl/sbh) + 6 x edge
    ldx step
    lda sbl, x
    clc
    adc eix
    sta tp
    lda sbh, x
    adc #0
    sta tp + 1
    ldy #0
    lda (tp), y                 // x0
    sta x
    iny
    lda (tp), y                 // width
    beq !done+
    sta n
    iny
    lda (tp), y                 // y lo
    sta yf
    iny
    lda (tp), y                 // y hi
    sta yf + 1
    iny
    lda (tp), y                 // slope lo
    sta slope
    iny
    lda (tp), y                 // slope hi
    sta slope + 1
!px:
    lda x                       // column group: base + x >> 2 (64 bytes each)
    lsr
    lsr
    tax
    lda colhi, x
    ora base
    sta ptr + 1
    lda collo, x
    sta ptr
    lda x
    and #3
    ora code4                   // mask[4 code + (x & 3)]
    tax
    lda mask, x
    ldy yf + 1
    eor (ptr), y
    sta (ptr), y
    clc
    lda yf
    adc slope
    sta yf
    lda yf + 1
    adc slope + 1
    sta yf + 1
    inc x
    dec n
    bne !px-
!done:
    rts

// fill: a running EOR down each of the 16 columns of 64 bytes.
fill:
    lda base
    sta ptr + 1
    lda #0
    sta ptr
    ldx #16
!col:
    ldy #0
    lda #0
!:  eor (ptr), y
    sta (ptr), y
    iny
    cpy #64
    bne !-
    lda ptr
    clc
    adc #64
    sta ptr
    bcc !+
    inc ptr + 1
!:  dex
    bne !col-
    rts

rowlo: .fill 8, <($0400 + 40 * (8 + i) + 12)
rowhi: .fill 8, >($0400 + 40 * (8 + i) + 12)
collo: .fill 16, <(64 * i)
colhi: .fill 16, >(64 * i)
// mask[4 code + p]: bit pair code at multicolour pixel p (0 = left).
mask: .fill 16, (floor(i / 4)) << (2 * (3 - mod(i, 4)))

// Cube: vertices (+-1, +-1, +-1), index bit 0 = x, bit 1 = y, bit 2 = z.
.var vx = List().add(-1, 1, -1, 1, -1, 1, -1, 1)
.var vy = List().add(-1, -1, 1, 1, -1, -1, 1, 1)
.var vz = List().add(-1, -1, -1, -1, 1, 1, 1, 1)
// The 12 edges as vertex pairs.
.var ea = List().add(0, 2, 4, 6, 0, 1, 4, 5, 0, 1, 2, 3)
.var eb = List().add(1, 3, 5, 7, 2, 3, 6, 7, 4, 5, 6, 7)
// Faces: +x, -x, +y, -y, +z, -z as four edge indices each.
// Stored as 6 x edge: the offset of the edge's six bytes in a step.
fedges:
    .byte 6*5, 6*7, 6*9, 6*11   // +x (x = 1): edges 1-3, 5-7, 1-5, 3-7
    .byte 6*4, 6*6, 6*8, 6*10   // -x
    .byte 6*1, 6*3, 6*10, 6*11  // +y
    .byte 6*0, 6*2, 6*8, 6*9    // -y
    .byte 6*2, 6*3, 6*6, 6*7    // +z
    .byte 6*0, 6*1, 6*4, 6*5    // -z
fcode:
    .byte 1, 2, 2, 3, 3, 1

// Projected x and y (window pixels) of vertex v at step s: rotate by a
// about y and 2a about x, scale 17, orthographic, centre (32, 32).
.function PX(s, v) {
    .var a = toRadians(s * 360 / STEPS)
    .var x1 = vx.get(v) * cos(a) + vz.get(v) * sin(a)
    .return round(32 + 17 * x1)
}
.function PY(s, v) {
    .var a = toRadians(s * 360 / STEPS)
    .var b = 2 * a
    .var z1 = -vx.get(v) * sin(a) + vz.get(v) * cos(a)
    .var y2 = vy.get(v) * cos(b) - z1 * sin(b)
    .return round(32 + 17 * y2)
}
sbl: .fill STEPS, <(etab + 6 * 12 * i)
sbh: .fill STEPS, >(etab + 6 * 12 * i)
// etab[step][edge] = x0, width, y lo, y hi, slope lo, slope hi
etab:
.for (var s = 0; s < STEPS; s++) {
    .for (var e = 0; e < 12; e++) {
        .var a = ea.get(e)
        .var b = eb.get(e)
        .var x0 = PX(s, a)
        .var y0 = PY(s, a)
        .var x1 = PX(s, b)
        .var y1 = PY(s, b)
        .if (x1 < x0) {
            .var t = x0
            .eval x0 = x1
            .eval x1 = t
            .eval t = y0
            .eval y0 = y1
            .eval y1 = t
        }
        .var w = x1 - x0 + CLOSED   // :closed=1 plots both ends
        .var sl = x1 == x0 ? 0 : round(256 * (y1 - y0) / (x1 - x0))
        .var yy = y0 * 256 + 128
        .byte x0, w, <yy, >yy, <(sl & $ffff), >(sl & $ffff)
    }
}
```

## Build

```bash
java -jar KickAss.jar glenz.asm -o glenz.prg
java -jar KickAss.jar glenz.asm :closed=1 -o closed.prg   # both ends of every edge plotted
```

`-showmem` reports `$0900` to `$1D89`: code and the 64 steps of edge
tables (4,608 bytes); the PRG is 5,515 bytes.

## Expected output

A black screen with a 128 × 64 window in the middle (columns 12-27, rows
8-15) holding a turning cube: faces in red, green and yellow, and where a
back face lies behind a front face the pair's codes combined, black when
they are equal. Multicolour pixels are two hires pixels wide, so the cube
is drawn twice as wide as it is high.

Measured in VICE x64sc 3.10, PAL c64c (8565/8580/8521) and NTSC
(`-model ntsc`, 6567R8). Two checks, both with PIL decoding each window
pixel (the left of each two-pixel pair) to its bit pair with the palette
triples in `runtime/vice-reference.md`:

1. Against a model that runs the listing's own algorithm in Python on the
   edge tables read out of the assembled PRG, for all 64 steps:

   | Run | Model | Best step | Pixels equal, of 4,096 | `$02F0` at exit |
   |---|---|---|---|---|
   | 8,000,000 cycles | PAL | 62 | 4,096 | 62 |
   | 8,000,000 cycles | NTSC | 63 | 4,096 | 63 |
   | `@later`, 12,000,000 cycles | PAL | 49 | 4,096 | 49 |
   | `@later`, 12,000,000 cycles | NTSC | 52 | 4,096 | 52 |

   Also exact at 9, 10 and 11 million cycles on PAL and at 9 and 10
   million on NTSC; at 11 million on NTSC 4,090 pixels match, the exit
   screenshot taken with the beam inside the window.

2. Against geometry that does not use the EOR fill: each face as the
   polygon of its four projected corners, a pixel inside when an odd
   number of the face's edges cross its column at or above it (edge y
   computed exactly, then rounded), faces combined by EOR. Over all 64
   steps, 84 of 262,144 pixels differ, at most 4 in one step: the 8.8
   slope's rounding moving an edge point by one line. Built `:closed=1`,
   7,082 differ, up to 154 in one step.

Screenshots: `screenshots/glenz.png`, `screenshots/glenz-ntsc.png`,
`screenshots/glenz-later.png` and `screenshots/glenz-later-ntsc.png`.

### The draw time

A store trace of `$02F1` over 12,000,000 cycles: one frame drawn every
78,619 to 78,630 cycles on PAL, four frames, the wait for line 250
included; 68,376 to 85,480 on NTSC, four or five frames.

### Both ends plotted

With `:closed=1` each edge puts a point in column x1 as well. At a
corner where one edge of a face ends and the next begins, the corner's
column then gets a point from each edge on the same line; the two
cancel, the column is left with an odd number of points for that face,
and the running EOR does not stop: a one-pixel column of colour runs
from the face's other edge to the bottom of the window, visible in the
PAL screenshot of the `:closed=1` build. The pinned build's half-open
edges (columns x0 to x1 − 1) give that column one point.

## Why this works

### EOR filling

A convex polygon crosses each pixel column in two edges, top and bottom.
Mark the top and bottom crossing in each column with EOR, then walk down
the column keeping a running EOR of the bytes: the running value turns
the code on at the first mark and off at the second, and each of the
four pixel pairs in a byte is its own column. Because points are EORed,
an edge drawn twice with the same code cancels, and two faces overlapping
leave the EOR of their codes: every face can be drawn with no sorting and
no visibility test.

### Edges by column

Each edge is stepped one pixel column at a time from its left end x0 to
x1 − 1, y in 8.8 starting at y0 + 0.5, adding the slope (y1 − y0) / (x1 −
x0). A vertical edge has no columns and draws nothing, which is right:
the edges beside it mark those columns. Half-open ranges make the two
edges at a corner cover the corner's column once between them.

### Colours

The six face codes are +x 1, −x 2, +y 2, −y 3, +z 3, −z 1; bit pair 1
shows `$D022` (red), 2 shows `$D023` (green), 3 the colour RAM (yellow). A
pixel behind a front face with code a and a back face with code b shows
a EOR b: opposite faces never share a code, so a face-on view is never
black, while two adjacent faces with one code (−x and +y, −y and +z, −z
and +x) leave black where one is in front of the other.

### Sources

- None beyond the geometry and the EOR property above; written here and
  measured against two models. No third-party listing was used.
