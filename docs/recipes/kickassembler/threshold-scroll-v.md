---
recipe: threshold-scroll-v
toolchain: kickassembler
output_format: PRG
region: both
techniques: [threshold_scroll_v, soft_scroll_v]
file_formats: [PRG]
uses_registers: [D000, D001, D002, D003, D004, D005, D006, D007, D010, D011, D012, D015, D020, D021, D027, D028, D029, D02A, DD04, DD05, DD0E]
uses_kernal: []
claims: [sprite_0-3 (owns), vic_raster_irq (init), zero_page $02-$08+$0E (owns)]
harness: [cia2_timer_a, $09-$0D]
ram: [colour=$D800-$DBFF]
---

<!-- doc-type: recipe -->

# KickAssembler — Player-driven one-way vertical scroll past a threshold line

## Synopsis

A player sprite walks up a character playfield under a scripted "up"
held for 132 frames, so no joystick is needed. The field does not move
while the player is below a threshold line. When the player reaches it,
the player stops and the field scrolls down one pixel a frame instead.
Three ground objects, each a sprite framing one marker cell of the map,
get the same step added to their Y, so they stay on their cells. One
object scrolls out below the display and is switched off. The scroll
stops when the map's top row reaches the top of the screen, and the
player walks on. At the end, row 1 of the screen shows the frame the
scroll started and ended on, the player's Y, the map row and fine scroll,
the raster line the last redraw ended on, and the most cycles one frame's
tick took. The technique is `threshold_scroll_v` in
`techniques/scroll.md`.

## Source

```asm
// threshold-scroll-v.asm: player-driven one-way vertical scroll.
// A scripted "up" is held for HOLD frames. The player sprite walks up
// until its Y reaches THRESH; from then on the player stands still and
// the playfield scrolls down one pixel a frame instead. The scroll step
// (0 or 1) is added to every ground object's Y, so each object stays on
// its map cell. Scrolling stops when the map's top row reaches the top of
// the screen; the player may then walk on up to TOPY. An object that
// scrolls below the display is switched off. The screen matrix is redrawn
// from a raw 40-byte-per-row map on each eighth scroll frame. When the
// script ends, row 1 shows what the program measured.
// Build: java -jar KickAss.jar threshold-scroll-v.asm -o threshold-scroll-v.prg

BasicUpstart2(start)

.const SCREEN  = $0400
.const COLRAM  = $D800
.const LINE    = 251        // work line, below the display on PAL and NTSC
.const EXTRA   = 6          // map rows above the first screen
.const MROWS   = 25 + EXTRA // map height
.const START_Y = 208        // player sprite Y at start
.const THRESH  = 144        // the player walks while Y > THRESH
.const TOPY    = 100        // the player's upper limit once the map ends
.const HOLD    = 132        // frames with "up" held
.const OFFY    = 248        // an object at or below this Y is switched off
.const NOBJ    = 3          // ground objects, sprites 1-3

// zero-page variables ($09-$0D are the measurement harness)
.const fine    = $02        // YSCROLL 0-7
.const row     = $03        // map row shown on screen row 0
.const step    = $04        // this frame's scroll step, 0 or 1
.const frame   = $05        // frames since start
.const pY      = $06        // player Y
.const sframe  = $07        // frame on which step first became 1
.const eframe  = $08        // frame on which row reached 0
.const rline   = $09        // raster line at the end of the last redraw
.const tmax    = $0A        // most cycles one tick took (2 bytes)
.const tcal    = $0C        // timer reading for an empty call (2 bytes)
.const dirty   = $0E        // 1 when the screen must be redrawn

start:
    sei
    lda #0
    sta $d020
    lda #11
    sta $d021
    ldx #0                  // colour RAM: one colour, never scrolled
!:  lda #7
    sta COLRAM,x
    sta COLRAM+$100,x
    sta COLRAM+$200,x
    sta COLRAM+$2e8,x
    inx
    bne !-
    lda #EXTRA
    sta row
    lda #0
    sta fine
    sta step
    sta frame
    sta sframe
    sta eframe
    sta tmax
    sta tmax+1
    sta dirty
    lda #START_Y
    sta pY
    jsr redraw
    lda #$10                // DEN on, 24 rows, YSCROLL 0
    sta $d011
    // sprites: 0 player, 1-3 ground objects
    lda #(sprP/64)
    sta SCREEN+$3f8
    lda #(sprO/64)
    sta SCREEN+$3f9
    sta SCREEN+$3fa
    sta SCREEN+$3fb
    lda #10
    sta $d027
    lda #1
    sta $d028
    sta $d029
    sta $d02a
    lda #136
    sta $d000
    ldx #0
    ldy #0
!:  lda objx,x
    sta $d002,y
    iny
    iny
    inx
    cpx #NOBJ
    bne !-
    lda #0
    sta $d010
    lda #%00001111
    sta $d015
    jsr writespr
    // calibrate the timer harness with an empty call
    jsr tstart
    jsr empty
    jsr tstop
    lda $dd04
    sta tcal
    lda $dd05
    sta tcal+1

loop:
    lda #LINE
!:  cmp $d012
    bne !-
    jsr tstart
    jsr tick
    jsr tstop
    jsr tkeep
    lda dirty
    beq !+
    jsr redraw
    lda $d012
    sta rline
    lda #0
    sta dirty
!:  lda frame
    cmp #HOLD
    bne !+
    jsr report
!:  inc frame
    bne !+
    dec frame               // hold at 255
!:  lda #LINE
!:  cmp $d012
    beq !-
    jmp loop

// ---- one frame of the technique ------------------------------------
tick:
    // 1. apply the step decided last frame
    lda step
    beq nostep
    lda fine
    clc
    adc #1
    and #7
    sta fine
    bne !+
    dec row                 // coarse step: new map row at the top
    lda #1
    sta dirty
!:  ldx #0                  // ground objects follow the field
objl:
    lda objon,x
    beq objn
    lda objy,x
    clc
    adc step
    sta objy,x
    cmp #OFFY
    bcc objn
    lda #0                  // scrolled out below: switch it off
    sta objon,x
objn:
    inx
    cpx #NOBJ
    bne objl
nostep:
    lda #$10
    ora fine
    sta $d011
    jsr writespr
    // 2. decide this frame's step from the input
    lda #0
    sta step
    lda frame               // scripted input: "up" while frame < HOLD
    cmp #HOLD
    bcs tdone
    lda pY
    cmp #THRESH+1
    bcs walk                // above the line: walk
    lda row
    beq atend               // map ended: walk on
    lda #1
    sta step
    lda sframe
    bne tdone
    lda frame
    sta sframe
    rts
atend:
    lda eframe
    bne !+
    lda frame
    sta eframe
!:  lda pY
    cmp #TOPY+1
    bcc tdone
walk:
    dec pY
tdone:
    rts

writespr:
    lda pY
    sta $d001
    ldx #0
    ldy #0
!:  lda objy,x
    sta $d003,y
    iny
    iny
    inx
    cpx #NOBJ
    bne !-
    lda #0                  // enable bits: player plus live objects
    ldx #NOBJ-1
!:  asl
    ora objon,x
    dex
    bpl !-
    asl
    ora #1
    sta $d015
    rts

// ---- screen redraw from the raw row map ----------------------------
redraw:
    ldx row
    lda maplo,x
    sta rs0+1
    lda maphi,x
    sta rs0+2
    lda #<SCREEN
    sta rd0+1
    lda #>SCREEN
    sta rd0+2
    ldx #25
rrow:
    lda rs0+1               // second half of the row: +20
    clc
    adc #20
    sta rs1+1
    lda rs0+2
    adc #0
    sta rs1+2
    lda rd0+1
    clc
    adc #20
    sta rd1+1
    lda rd0+2
    adc #0
    sta rd1+2
    ldy #19
rs0:
    lda $ffff,y
rd0:
    sta $ffff,y
rs1:
    lda $ffff,y
rd1:
    sta $ffff,y
    dey
    bpl rs0
    lda rs1+1               // next row starts 40 on: the half + 20
    clc
    adc #20
    sta rs0+1
    lda rs1+2
    adc #0
    sta rs0+2
    lda rd1+1
    clc
    adc #20
    sta rd0+1
    lda rd1+2
    adc #0
    sta rd0+2
    dex
    bne rrow
    rts

// ---- measurement harness: CIA 2 timer A around tick ----------------
tstart:
    lda #$ff
    sta $dd04
    sta $dd05
    lda #%00011001          // force load, one-shot, start
    sta $dd0e
    rts
tstop:
    lda #%00001000          // stop
    sta $dd0e
    rts
tkeep:                      // diff = tcal - reading; keep the largest
    sec
    lda tcal
    sbc $dd04
    tax
    lda tcal+1
    sbc $dd05
    cmp tmax+1
    bcc !+
    bne keep
    cpx tmax
    bcc !+
keep:
    stx tmax
    sta tmax+1
!:  rts
empty:
    rts

// ---- row 1: the measured values ------------------------------------
report:
    ldx #37
    lda #$20
!:  sta SCREEN+40+2,x
    dex
    bpl !-
    ldx #0
!:  lda labels,x
    sta SCREEN+40+3,x
    inx
    cpx #labels_end-labels
    bne !-
    lda sframe
    ldx #4
    jsr puthex
    lda eframe
    ldx #8
    jsr puthex
    lda pY
    ldx #12
    jsr puthex
    lda row
    ldx #16
    jsr puthex
    lda fine
    ldx #20
    jsr puthex
    lda rline
    ldx #24
    jsr puthex
    lda tmax                // + 12 for the empty call's jsr and rts
    clc
    adc #12
    sta tmax
    bcc !+
    inc tmax+1
!:  lda tmax+1
    ldx #28
    jsr puthex
    lda tmax
    ldx #30
    jsr puthex
    rts

puthex:                     // A as two hex digits at row 1, column X
    pha
    lsr
    lsr
    lsr
    lsr
    tay
    lda hexd,y
    sta SCREEN+40,x
    pla
    and #$0f
    tay
    lda hexd,y
    sta SCREEN+41,x
    rts

.encoding "screencode_upper"
hexd:   .text "0123456789ABCDEF"
labels: .text "S   E   Y   R   F   L   C"
labels_end:

// ---- ground objects: sprite X, sprite Y, on ------------------------
// Each starts one pixel up and left of its marker cell, so its 10x10
// outline frames the cell: X = 24 + 8*col - 1, Y = 46 + 8*screen row.
objx:   .byte 23+8*8, 23+8*20, 23+8*28
objy:   .byte 46+8*(12-EXTRA), 46+8*(22-EXTRA), 46+8*(27-EXTRA)
objon:  .byte 1, 1, 1

// ---- the map: 40 screen codes per row, row 0 at the top ------------
.function hx(n) {
    .if (n < 10) {
        .return $30 + n
    } else {
        .return n - 9
    }
}
.function cell(r, c) {
    .if (c == 0) .return hx(floor(r / 16))
    .if (c == 1) .return hx(mod(r, 16))
    .if (r == 12 && c == 8) .return $a0
    .if (r == 22 && c == 20) .return $a0
    .if (r == 27 && c == 28) .return $a0
    .if (mod(c + 3 * r, 8) == 0) .return $2e
    .return $20
}
map:
.for (var r = 0; r < MROWS; r++) {
    .for (var c = 0; c < 40; c++) {
        .byte cell(r, c)
    }
}
maplo:  .fill MROWS, <(map + i * 40)
maphi:  .fill MROWS, >(map + i * 40)

* = $2000 "Sprites"   // $1000-$1FFF is the char ROM to the VIC
sprP:                       // player: 16x16 solid
.for (var y = 0; y < 21; y++) {
    .if (y < 16) { .byte $ff, $ff, $00 } else { .byte 0, 0, 0 }
}
.byte 0
sprO:                       // ground object: 10x10 outline
.for (var y = 0; y < 21; y++) {
    .if (y == 0 || y == 9) { .byte $ff, $c0, $00 }
    else .if (y < 9) { .byte $80, $40, $00 }
    else { .byte 0, 0, 0 }
}
.byte 0
```

## Build

```bash
java -jar "$KICKASS_JAR" threshold-scroll-v.asm -o threshold-scroll-v.prg
```

## Expected output

`screenshots/threshold-scroll-v.png` (PAL) and
`screenshots/threshold-scroll-v-ntsc.png` (NTSC), pinned at 8,000,000
cycles in `recipes/runs.json`. Verified in VICE x64sc 3.10 (PAL c64c:
8565/8580/8521, and ntsc: 6567R8), measured with PIL; text was read by
matching each 8x8 cell against the character ROM. Raster line = PNG row
+ 16 on PAL, + 28 on NTSC; VIC X = PNG x − 8.

| What | PAL | NTSC |
|---|---|---|
| Row 1 text | `S40 E70 Y7C R00 F00 LB4 C0154` | `S40 E70 Y7C R00 F00 LE2 C014E` |
| Display window (24 rows) | lines 55-246 | lines 55-246 |
| Screen rows 1-24, first two columns | map row labels `01`-`18` in order | same |
| Player, light red 16x16 | VIC X 136-151, lines 125-140 | same |
| Object 1 outline / marker | X 87-96, lines 143-152 / X 88-95, lines 144-151 | same |
| Object 2 outline / marker | X 183-192, lines 223-232 / X 184-191, lines 224-231 | same |
| Object 3 | not drawn (freed below the display) | same |

The row 1 fields, all hex: `S` the frame the step first became 1 (64),
`E` the frame the map row reached 0 (112), `Y` the player's sprite Y
(124), `R` the map row and `F` the fine scroll at the end (0 and 0), `L`
the `$D012` value when the last redraw ended (line 180 on PAL, 226 on
NTSC, in the frame after the one it started in), `C` the most cycles one
tick took, including its `jsr` and `rts` (340 on PAL, 334 on NTSC).

The numbers agree with the constants. The player walks from Y 208 to the
threshold 144 in 64 frames (frames 0-63); on frame 64 the step is set,
and the field moves on frames 65-112: 48 frames, 8 per map row for
`EXTRA` = 6 rows. From frame 112 to the end of the script at frame 131
the player walks 20 more pixels, to Y 124. The objects started one pixel
above and left of markers on screen rows 6 and 16 and ended at rows 12
and 22, 48 lines lower, still one pixel off each marker. A sprite's
first line is its Y + 1 (Y 124 on line 125, Y 142 on line 143).

The final frame does not show the motion, so the run was also shot at
19 cycle limits across it on PAL, 90,000 cycles apart, and 13 on NTSC,
110,000 apart. In every shot object 1's outline began one line above
its marker, and while the field moved the player stayed on lines 145-160
(Y 144). Before the threshold the marker did not move and the player
did; after the map's end, the same.

Off by one: with the threshold compare written `cmp #THRESH` instead of
`cmp #THRESH+1`, row 1 read `S41 E71 Y7C` on PAL. The player walks one
pixel further, to Y 143, so the scroll starts and ends a frame later;
the final Y is the same because the walk after the map's end is a frame
shorter.

## Why this works

The step is decided after the display has been written and applied on
the next frame, before anything is written. So the fine scroll, the map
row and every object's Y change together, in the lower border, and the
VIC shows them together from line 55 of the next frame. Colour RAM is one
colour and never moves, so the coarse step touches only the screen
matrix.

The coarse step redraws all 25 screen rows from the map at
`map + row × 40`. Screen row k starts on line 48 + YSCROLL + 8k (row 1
on line 56 at YSCROLL 0, measured), and the 24-row window is lines
55-246. Row 0 shows at least its last line at every YSCROLL and row 24
shows at YSCROLL 0-6, so all 25 are needed. The copy is unrolled two ways, 20 passes of two
`lda abs,y`/`sta abs,y` pairs per row, and starts after the tick on line
251. It ends on line 180 (PAL) and 226 (NTSC) of the next frame, before
row 24's first line, 240. A one-byte loop ended on NTSC line 246 in an
earlier draft, behind the beam for the last rows.

The third object's marker leaves the screen at the bottom before the
scroll ends. Its sprite is switched off at Y 248, below the window.
Without that its Y would wrap past 255: 214 + 48 = 262 is 6, in the top
border here, and in a longer scroll it would come down into view from
the top (arithmetic). The interrupts stay
masked (`sei`) and the program polls `$D012`, so nothing else runs.
