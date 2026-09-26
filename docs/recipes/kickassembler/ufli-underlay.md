---
recipe: ufli-underlay
toolchain: kickassembler
output_format: PRG
region: both
techniques: [ufli_sprite_underlay, stable_raster_irq, double_irq, pal_ntsc_detection, vic_bank_select]
file_formats: [PRG]
uses_registers: [D000, D001, D010, D011, D012, D015, D017, D018, D019, D01A, D01B, D01C, D01D, D020, D021, D027, DC0D, DD00]
uses_kernal: []
claims: [irq_vector_0314 (owns), cia1_timer_a (init), cia1_timer_b (init), cia1_tod (init), cia2_vic_bank (owns), vic_char_base (owns), zero_page $03-$07 (owns)]
ram: [state=$02E0, vic=$4000-$7FFF, scratch=$C000-$C1FF]
---

<!-- doc-type: recipe -->

# KickAssembler recipe: hires FLI every second line under a layer of seven sprites (UFLI)

## Synopsis

A full-height hires bitmap whose colours change every second line, with
seven sprites on every line: sprite 0 in front of the leftmost three
cells, where the FLI bug is, and sprites 1 to 6, x-expanded, behind the
bitmap across the next 36 cells, so a cell's 0 pixels show a sprite's
colour where the sprite has pixels. This is the arrangement codebase64
describes as UFLI. Each character row's badline is ordinary; on the
row's third, fifth and seventh lines a `$D011` write on cycle 14 forces a
badline that fetches colours from the next of four screens without
resetting the row counter. With seven sprites on, the VIC holds the CPU
from cycle 55 of every line to about cycle 9 of the next, so the listing
is one block of code per raster line, each restarted by that halt. The
sprites are y-expanded, five rows of 42 lines, and moved down between
rows. Built `:nospr0=1` sprite 0 sits in the left border and the FLI bug
shows. The technique is `ufli_sprite_underlay` in
`techniques/bitmap-modes.md`.

## Source

```asm
// ufli-underlay.asm
// Hires FLI every second line with a sprite underlay, the scheme codebase64
// calls UFLI: seven sprites on every line of the display, sprite 0 in front
// of the leftmost three cells to hide the FLI bug, sprites 1-6 x-expanded
// behind the bitmap across the next 36 cells. A hires cell's 0 pixels show
// the sprite where it has pixels, so a cell gets a third colour.
//
// Every character row: its badline (line 51 + 8r, screen A) is ordinary;
// on its lines 2, 4 and 6 a $D011 write on cycle 14 forces a badline that
// fetches colours from screen B, C or D without resetting the row counter.
// With seven sprites on, the VIC holds the CPU from cycle 55 of every line
// to the start of the next (it runs again from cycle 9 on PAL, 7 on NTSC,
// by the stores' cycles), and every forced badline from cycle 15 to 54. So
// the CPU runs in two windows: most of each row's lines 1, 3, 5 and 7 (the
// next $D018 and YSCROLL, sprite Y moves) and the first cycles of lines
// 2, 4 and 6, where `nop; stx $d011` puts the write on 14. Each halt
// restarts the CPU at the same point, so each line's block is timed from
// there, not from the top of the frame.
//
// The sprites are y-expanded, 42 lines a row, five rows from line 51.
//
// Test picture: every bitmap byte is %11110000. The left half of each cell
// is its screen byte's high nibble, (4r + p + c) mod 15 + 1 for character
// row r, line pair p (0-3) and column c; the low nibble is 0 (black). The
// right half shows the sprite over it, or black in column 39.

.const SCRA   = $4000           // screens A-D for line pairs 0-3 of a row
.const BITMAP = $6000
.const SPR    = $5000           // sprite data: pointer 64
.const FLAG   = $02e0
.const saved  = $03
.const ptr    = $04
.const tmp    = $06

.var SPP = cmdLineVars.containsKey("spp") ? cmdLineVars.get("spp").asNumber() : 12
.var SPN = cmdLineVars.containsKey("spn") ? cmdLineVars.get("spn").asNumber() : 14
.var EP = cmdLineVars.containsKey("ep") ? cmdLineVars.get("ep").asNumber() : 114
.var EN = cmdLineVars.containsKey("en") ? cmdLineVars.get("en").asNumber() : 118
.var PADP = cmdLineVars.containsKey("padp") ? cmdLineVars.get("padp").asNumber() : 0
.var PADN = cmdLineVars.containsKey("padn") ? cmdLineVars.get("padn").asNumber() : 4
.var NOSPR0 = cmdLineVars.containsKey("nospr0") ? cmdLineVars.get("nospr0").asNumber() : 0

BasicUpstart2(start)

.macro Delay(c) {
    .if (c == 1) .error "Delay cannot make 1 cycle"
    .if (c > 0) {
        .if ((c & 1) != 0) { bit $ea }
        .for (var i = 0; i < ((c & 1) != 0 ? c - 3 : c) / 2; i++) { nop }
    }
}

.function D18(p) { .return ((p * $400) >> 6) | $08 }   // screen p, bitmap $2000 in bank
.const YROW = List().add(50, 92, 134, 176, 218)       // sprite Y per row (display from Y + 1)

// The display: code for lines 51 to 250, each block running from the
// CPU's restart early in its line.
.macro Display(PADO) {
    .for (var L = 51; L <= 250; L++) {
        .var rel = mod(L - 51, 8)
        .if (rel == 0) {
            nop                              // a natural badline: 3 free cycles
            nop
        } else .if (rel == 2 || rel == 4 || rel == 6) {
            nop                              // cycles 9-10
            stx $d011                        // cycles 11-14: the forced badline
        } else {
            // odd line: the next pair's screen and YSCROLL, sprite moves
            .var used = 0
            .if (rel == 7) {
                lda #D18(0)
                sta $d018
                lda #$3b                     // YSCROLL 3: line L + 1 is the row's badline
                sta $d011
                .eval used = 12
            } else {
                .var p = (rel + 1) / 2       // 1, 2, 3
                lda #D18(p)
                sta $d018
                ldx #$38 | mod(L + 1, 8)     // YSCROLL for line L + 1
                .eval used = 8
            }
            // Move the sprites to the next row: 4 on the first odd-pair
            // line from the row's third line on, 3 on the next one.
            .for (var r = 0; r < 4; r++) {
                .var y0 = YROW.get(r) + 1
                .var f = y0 + 2 + (mod(y0 + 2 - 51, 2) == 1 ? 0 : 1)
                .if (L == f || L == f + 2) {
                    .var first = L == f ? 0 : 4
                    .var last = L == f ? 3 : 6
                    lda #YROW.get(r + 1)
                    .for (var s = first; s <= last; s++) {
                        sta $d001 + 2 * s
                    }
                    .eval used = used + 2 + 4 * (last - first + 1)
                }
            }
            // Pad so the next fetch is the first the sprites' halt stops;
            // a pair after a row's badline starts a cycle later.
            Delay(46 - used + PADO - (rel == 1 ? 1 : 0))
        }
    }
}

* = $0900
start:
    sei
    lda #$7f
    sta $dc0d
    lda $dc0d
    jsr detect_region
    // bitmap: %11110000 everywhere
    lda #<BITMAP
    sta ptr
    lda #>BITMAP
    sta ptr + 1
    ldy #0
    lda #%11110000
!:  sta (ptr), y
    iny
    bne !-
    inc ptr + 1
    ldx ptr + 1
    cpx #$80
    bne !-
    // screens: A-D, row r, column c: ((4r + p + c) mod 15 + 1) << 4
    ldx #0                      // p
!p: txa
    asl
    asl
    clc
    adc #>SCRA
    sta ptr + 1
    lda #0
    sta ptr
    stx tmp + 1
    lda #0
    sta tmp                     // r
!r: ldy #0                      // c
!c: lda tmp
    asl
    asl
    clc
    adc tmp + 1
    sta saved
    tya
    clc
    adc saved
!m: cmp #15
    bcc !+
    sbc #15
    jmp !m-
!:  clc
    adc #1
    asl
    asl
    asl
    asl
    sta (ptr), y
    iny
    cpy #40
    bne !c-
    lda ptr
    clc
    adc #40
    sta ptr
    bcc !+
    inc ptr + 1
!:  inc tmp
    lda tmp
    cmp #25
    bne !r-
    // sprite pointers (64) in all four screens
    ldy #7
    lda #(SPR - $4000) / 64
!:  sta SCRA + $3f8, y
    sta SCRA + $400 + $3f8, y
    sta SCRA + $800 + $3f8, y
    sta SCRA + $c00 + $3f8, y
    dey
    bpl !-
    ldx tmp + 1
    inx
    cpx #4
    beq !+
    jmp !p-
!:  // sprite data: solid
    ldx #62
    lda #$ff
!:  sta SPR, x
    dex
    bpl !-
    // sprites 0-6: 0 at X 24 in front; 1-6 x-expanded at 48 + 48(i - 1), behind
    lda #24
    .if (NOSPR0 != 0) { lda #0 }  // :nospr0=1: sprite 0 moved into the left border
    sta $d000
    ldx #0
!:  lda sprx, x
    sta $d002, x
    inx
    inx
    cpx #12
    bne !-
    lda #YROW.get(0)
    .for (var s = 0; s < 7; s++) { sta $d001 + 2 * s }
    lda #%01111111              // sprites 0-6
    sta $d015
    lda #%01111110              // 1-6 x-expanded
    sta $d01d
    lda #%01111111              // all y-expanded
    sta $d017
    lda #%01111110              // 1-6 behind the bitmap
    sta $d01b
    lda #0
    sta $d01c                   // hires sprites
    lda #%01000000              // sprite 6 at X 288
    sta $d010
    ldx #6
!:  lda sprcol, x
    sta $d027, x
    dex
    bpl !-
    lda $dd00
    and #$fc
    ora #$02                    // VIC bank 1
    sta $dd00
    lda #D18(0)
    sta $d018
    lda #0
    sta $d020
    sta $d021
    lda #<irq1
    sta $0314
    lda #>irq1
    sta $0315
    lda #$3b
    sta $d011
    lda #46
    sta $d012
    lda #1
    sta $d01a
    sta $d019
    cli
main:
    inc $c000, x
    inc $c100, x
    inx
    jmp main

sprx: .byte 48, 0, 96, 0, 144, 0, 192, 0, 240, 0, 32, 0
sprcol: .byte 1, 2, 3, 4, 5, 7, 8

detect_region:
!wlo:
    bit $d011
    bmi !wlo-
!whi:
    bit $d011
    bpl !whi-
!track:
    lda $d012
    bit $d011
    bpl !over+
    tax
    jmp !track-
!over:
    lda #0
    cpx #$10
    bcs !+
    lda #1
!:  sta FLAG
    rts

irq1:
    lda #$3b
    sta $d011
    lda #YROW.get(0)
    .for (var s = 0; s < 7; s++) { sta $d001 + 2 * s }
    ldx #<irq2p
    ldy #>irq2p
    lda FLAG
    beq !+
    ldx #<irq2n
    ldy #>irq2n
!:  stx $0314
    sty $0315
    lda #48
    sta $d012
    lda #1
    sta $d019
    tsx
    stx saved
    cli
    .for (var i = 0; i < 40; i++) { nop }

irq2p:
    ldx saved
    txs
    Delay(SPP)
    lda $d012
    cmp $d012
    beq !+
!:  Delay(EP)                   // to line 50, into the sprites' halt
    Display(PADP)
    jmp done
irq2n:
    ldx saved
    txs
    Delay(SPN)
    lda $d012
    cmp $d012
    beq !+
!:  Delay(EN)
    Display(PADN)
done:
    lda #<irq1
    sta $0314
    lda #>irq1
    sta $0315
    lda #46
    sta $d012
    lda #1
    sta $d019
    jmp $ea81
```

## Build

```bash
java -jar KickAss.jar ufli-underlay.asm -o ufli-underlay.prg
java -jar KickAss.jar ufli-underlay.asm :nospr0=1 -o nospr0.prg   # sprite 0 in the border
java -jar KickAss.jar ufli-underlay.asm :padp=N -o s.prg          # PAL forced write moved, N -1 to 1 [0]
java -jar KickAss.jar ufli-underlay.asm :padn=N -o s.prg          # NTSC, N 3 to 5 [4]
```

`-showmem` reports `$0900` to `$23C2`, most of it the 200 unrolled line
blocks; the PRG is 7,108 bytes. The bitmap, the four screens and the
sprite are built at start-up in VIC bank 1.

## Expected output

A black border. Down the left edge a white strip three cells wide.
Across the rest, in every cell, a left half in the cell's colour for that
line pair, changing every two lines and every cell, and a right half in
the colour of the sprite behind it: red, cyan, purple, green, yellow and
orange bands six cells wide; the last cell's right half is black.

Measured in VICE x64sc 3.10 with the pinned command at 8,000,000 cycles,
PAL c64c (8565/8580/8521) and NTSC (`-model ntsc`, 6567R8). Each half
cell of every line from 51 to 250 was decoded with PIL (four pixels, one
colour, to a palette index with the triples in
`runtime/vice-reference.md`) and compared with the model: left half
(4r + p + c) mod 15 + 1 for row r, line pair p and column c, right half
the sprite's colour, cells 0-2 white:

| Build | Model | Half-cells matching, of 16,000 (8,000 cells) |
|---|---|---|
| default | PAL | all |
| default | NTSC | all |
| `:nospr0=1` | PAL | all, with cells 0-2 light grey on every forced pair (the FLI bug, `$FF`) |
| `:nospr0=1` | NTSC | all, the same |

Lines 249 and 250, the last pair, keep the colours of line pair 2:
badlines exist only on lines 48 to 247 (`$30`-`$F7`, Bauer §3.5), so
the write on line 249 forces nothing. A store trace of `$D011` over each
8,000,000-cycle run put every forced write on cycle 14: 17,250 on PAL
(230 frames, 75 a frame) and 19,350 on NTSC (258 frames); the other
writes are the row-start YSCROLL on each row's last line and, once a
frame, the unforced write on line 249. Screenshots:
`screenshots/ufli-underlay.png` and `screenshots/ufli-underlay-ntsc.png`.

### The forced write cycle

`:padp` and `:padn` lengthen every odd line's block by one cycle a step;
the stall after each forced badline brings every row back to the same
point, so all forced writes move together:

| Forced writes land on | Half-cells wrong, of 16,000 |
|---|---|
| 12 and 13 (`:padp=-1`, `:padn=3`) | 6,808: RC is reset, the rows stop moving on |
| 14 (defaults) | 0 |
| 15 and 16 (`:padp=1`, `:padn=5`) | 184: cell 3, just right of sprite 0, shows the FLI bug's grey |

Measured on both models. In the store traces the rows after a row's
badline land one cycle apart from the others when the pad is off (12
and 13, or 15 and 16); at the default every forced write is on 14.

## Why this works

### Two windows a line

On a line with sprites 0 to 6 on, the VIC fetches their pointers and
data from cycle 58 of the line to cycle 8 of the next and pulls BA low
three cycles before, so the CPU stops at its first read from cycle 55;
it starts again about cycle 9 (measured by the `$D018` writes: cycle 14
for a store five cycles into an odd-line block on PAL, 12 on NTSC). A
forced badline stops it again from cycle 15 to 54, straight into the
sprites' halt. So every line's code begins at the restart, and the
listing is 200 blocks: on a forced line `nop; stx $d011`, the store on
cycle 14; on the line before it, the next screen into `$D018` and the
next YSCROLL into X, padded so that the following fetch is the first one
the halt stops. The row's own badline leaves three cycles, taken by
`nop; nop`, which delays the next block by one cycle; that block is one
cycle shorter.

### Colour in four screens, the bug under a sprite

The forced badline fetches the screen `$D018` names, so each line pair
of a row takes its colours from its own screen: A, B, C, D. The forced
write on cycle 14 leaves RC alone, as `chunky_4x4_fli_mode` measured, and
the three cells fetched before the VIC has the bus read `$FF`. Sprite 0,
unexpanded at X 24 and in front of the bitmap, covers exactly those
cells. Sprites 1 to 6 have their priority bit set in `$D01B`, so they
show only where the bitmap has 0 pixels.

### Sprites for 200 lines

Each sprite row is 42 lines (y-expanded). A sprite's Y is compared on
every line, so writing the next row's Y while a row is being shown does
not disturb it; the listing writes four Y registers on one odd line and
three on the next, early in each row. The pointers are the same in all
four screens.

### Sources

- Codebase64, "UFLI" (seven sprites, one over the FLI bug, six expanded
  behind the picture, FLI every second line; the NUFLI successor as a
  converter-generated rendering format):
  https://codebase64.c64.org/doku.php?id=base:ufli
- Christian Bauer, "The MOS 6567/6569 video controller (VIC-II) and its
  application in the Commodore 64" (1996), §3.5, §3.7.2, §3.8, §3.14.3,
  §3.14.6: https://www.zimmers.net/cbmpics/cbm/c64/vic-ii.txt
- No converter output or third-party display code is used or reproduced.
