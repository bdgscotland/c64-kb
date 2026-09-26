---
recipe: char-zoomer
toolchain: kickassembler
output_format: PRG
region: both
techniques: [char_zoomer_d018, fpp_flexible_pixel_position, stable_raster_irq, double_irq, badline_synchronization, pal_ntsc_detection]
file_formats: [PRG]
uses_registers: [D011, D012, D018, D019, D01A, D020, D021, DC0D, DD00]
uses_kernal: []
claims: [irq_vector_0314 (owns), cia1_timer_a (init), cia1_timer_b (init), cia1_tod (init), cia2_vic_bank (owns), vic_matrix_base (owns), zero_page $02-$06 (owns)]
ram: [state=$02E0, vic=$4000-$7FFF, scratch=$C000-$C1FF, colour=$D800-$DBFF]
---

<!-- doc-type: recipe -->

# KickAssembler recipe: a vertical zoomer, any of 24 source lines on every raster line from one `$D018` write

## Synopsis

A 24-line logo zoomed vertically between 1 and 5.33 times its height on a
128-line band, the zoom following a sine. Every band line is a badline,
as in the badline form of `fpp`, so the VIC fetches the character codes
again on every line and shows their pixel row 0. One `$D018` write per
line picks both the screen, and so the codes, and the charset, and so
their bytes: three screens and eight charsets give 24 source lines,
where `fpp`'s single screen gave 8. A table per zoom step says which
source line each raster line shows; the border code copies one step per
frame. The byte in cell i of source line L is 8L + (i & 7), so each line
of the picture says which source line it is. The technique is
`char_zoomer_d018` in `techniques/raster.md`.

## Source

```asm
// char-zoomer.asm
// A vertical zoomer by line selection: a 24-line logo shown from 1 to
// 5.33 times its height on a 128-line band (lines 59 to 186), the zoom
// following a sine, with one $D018 write per raster line.
//
// Every band line is made a badline (YSCROLL = line & 7 before cycle 12),
// so the VIC fetches the character codes again on every line and shows
// pixel row 0 of them, as in the badline form of fpp. The $D018 write
// picks both the screen (the codes) and the charset (their pixel row 0),
// so one write picks any of 24 source lines. VIC bank 1 holds eight 2K
// blocks; block b has charset b (codes 0-127, only pixel row 0 used) and
// a screen in its unused upper half. Screen g (g = 0, 1, 2, in blocks 0-2)
// holds codes 40g to 40g + 39 in every row; the screen in block 3 holds
// codes 120-127, which are blank. Source line L = 3b + g is charset b
// through screen g, and its byte in cell i is 8L + (i & 7), so every line
// of the picture says which source line it is.
//
// zoom[z] holds the $D018 value for each band line at zoom step z
// (scale 1 + 4.33z/31, centred on line 122.5): line y shows source line
// floor((y - 63.5) / scale) + 12, or blank outside 0-23. Each frame the
// border code copies step sine[frame] into the table the band reads.

.const H      = 128             // band lines 59 .. 186
.const NZ     = 32              // zoom steps
.const FLAG   = $02e0           // 0 = PAL, 1 = NTSC
.const frame  = $02
.const saved  = $03
.const ptr    = $04             // $04/$05
.const cnt    = $06
.const WAIT   = 43              // 5-cycle loop from line 48 past line 51's stall
.const BLANK  = $70             // screen $5C00 (codes 120-127), charset 0

.const SPP    = 12              // double-IRQ pads, as in fpp
.const SPN    = 14
.const EP     = 40              // entry delays, found with a store trace
.const EN     = 48
.const EBP    = 0
.const EBN    = 2
.const PADP   = 6               // band block: 14 cycles + pad = 20 (PAL)
.const PADN   = 8               // 22 (NTSC)

BasicUpstart2(start)

.macro Delay(c) {
    .if (c == 1) .error "Delay cannot make 1 cycle"
    .if (c > 0) {
        .if ((c & 1) != 0) { bit $ea }
        .for (var i = 0; i < ((c & 1) != 0 ? c - 3 : c) / 2; i++) { nop }
    }
}

// Lines 53 .. 58, one iteration per line: $D011, then $D018 for the next
// line. Entered at a fixed cycle of line 48.
.macro Lines(LINE, ENTRY) {
    ldy #WAIT                        // past line 51's badline
!:  dey
    bne !-
    ldx #0
    Delay(ENTRY)
!loop:
    lda #$1b            // 2
    sta $d011           // 4
    lda d18, x          // 4
    sta $d018           // 4
    inx                 // 2
    cpx #6              // 2
    beq !done+          // 2 (3 taken)
    Delay(LINE - 23)
    jmp !loop-          // 3
!done:
}

// One 20-cycle block (22 on NTSC) per band line from line 60: the
// charset and screen for line 60 + k, then YSCROLL to make it a badline.
.macro Blocks(pad, eb) {
    ldx #$18 | (60 & 7)
    Delay(eb)                        // straddles line 59's stall
    .for (var k = 0; k < H - 1; k++) {
        lda d18 + 6 + k
        sta $d018
        stx $d011
        ldx #$18 | ((61 + k) & 7)
        Delay(pad)
    }
    stx $d011                        // YSCROLL 3 again: line 187 on
    lda #BLANK
    sta $d018
}

* = $0900
start:
    sei
    lda #$7f
    sta $dc0d
    lda $dc0d
    jsr detect_region
    // Clear $4000-$7FFF.
    lda #0
    sta ptr
    lda #$40
    sta ptr + 1
    ldy #0
    tya
!:  sta (ptr), y
    iny
    bne !-
    inc ptr + 1
    ldx ptr + 1
    cpx #$80
    bne !-
    // Charset b (b = 0..7): code 40g + i, pixel row 0 = 8(3b + g) + (i & 7).
    ldx #0                      // b
!b: txa
    asl
    asl
    asl
    clc
    adc #$40
    sta ptr + 1
    lda #0
    sta ptr
    txa                         // 8 * 3b = 24b
    asl
    asl
    asl
    sta cnt
    asl
    clc
    adc cnt
    sta cnt                     // 24b: line 3b, times 8
    ldy #0                      // code c, 0..119: g = c / 40, i = c mod 40
!c: lda cnt
    sta saved                   // 8 * L for this g
    tya
    sec
!g: cmp #40
    bcc !+
    sbc #40
    pha
    lda saved
    clc
    adc #8
    sta saved
    pla
    sec
    jmp !g-
!:  and #7                      // i & 7
    ora saved
    pha
    tya                         // offset 8c: ptr + 8c (c < 128: 16-bit)
    asl
    asl
    asl
    sta ptr
    tya
    lsr
    lsr
    lsr
    lsr
    lsr
    sta frame                   // (8c) >> 8, scratch
    txa
    asl
    asl
    asl
    clc
    adc #$40
    adc frame
    sta ptr + 1
    pla
    sty frame
    ldy #0
    sta (ptr), y
    ldy frame
    iny
    cpy #120
    bne !c-
    inx
    cpx #8
    bne !b-
    // Screens: block g's upper half ($4400 + $800g), g = 0..3; byte j is
    // 40g + (j mod 40) for g < 3, and 120 + (j & 7) for g = 3.
    ldx #0
!s: txa
    asl
    asl
    asl
    clc
    adc #$44
    sta ptr + 1
    lda #0
    sta ptr
    stx cnt
    txa                         // 40g
    asl
    asl
    asl
    sta saved
    asl
    asl
    clc
    adc saved
    sta saved
    ldx #0                      // j mod 40
    ldy #0
!j: lda cnt
    cmp #3
    bne !+
    tya
    and #7
    ora #120
    jmp !put+
!:  txa
    clc
    adc saved
!put:
    sta (ptr), y
    inx
    cpx #40
    bne !+
    ldx #0
!:  iny
    bne !j-
    inc ptr + 1
    lda ptr + 1
    and #$03
    cmp #$00                    // four pages done when the high byte wraps to $x8
    bne !j-
    ldx cnt
    inx
    cpx #4
    bne !s-
    ldx #0
    lda #1
!:  sta $d800, x
    sta $d900, x
    sta $da00, x
    sta $db00, x
    inx
    bne !-
    lda $dd00
    and #$fc
    ora #$02                    // VIC bank 1, $4000-$7FFF
    sta $dd00
    lda #BLANK
    sta $d018
    lda #6
    sta $d021
    lda #14
    sta $d020
    lda #0
    sta frame
    jsr fill
    lda #<irq1
    sta $0314
    lda #>irq1
    sta $0315
    lda #$1b
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

// irq1 (line 46) and irq2p/irq2n (line 48): the double IRQ of
// stable-raster-irq.
irq1:
    lda #$1b
    sta $d011
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
!:  Lines(63, EP)
    Blocks(PADP, EBP)
    jmp done
irq2n:
    ldx saved
    txs
    Delay(SPN)
    lda $d012
    cmp $d012
    beq !+
!:  Lines(65, EN)
    Blocks(PADN, EBN)
done:
    inc frame
    jsr fill
    lda #<irq1
    sta $0314
    lda #>irq1
    sta $0315
    lda #46
    sta $d012
    lda #1
    sta $d019
    jmp $ea81

// fill: d18[5 + y] = zoom[sine[frame & 63]][y], y = 0 .. H-1.
fill:
    lda frame
    and #63
    tax
    lda sine, x
    tax
    lda zlo, x
    sta ptr
    lda zhi, x
    sta ptr + 1
    ldy #0
!:  lda (ptr), y
    sta d18 + 5, y
    iny
    cpy #H
    bne !-
    rts

.function D18(l) {
    .return l < 0 || l > 23 ? BLANK : ((2 * mod(l, 3) + 1) << 4) | (floor(l / 3) << 1)
}

.align $100
// d18[i]: written on line 53 + i, for line 54 + i.
d18:
    .fill 5, BLANK
    .fill H, BLANK
    .fill 16, BLANK
sine:
    .fill 64, round((NZ - 1) * (0.5 - 0.5 * cos(toRadians(i * 360 / 64))))
zlo:
    .fill NZ, <(zoom + H * i)
zhi:
    .fill NZ, >(zoom + H * i)
zoom:
.for (var z = 0; z < NZ; z++) {
    .var s = 1 + 4.33 * z / (NZ - 1)
    .fill H, D18(floor((i - 63.5) / s + 12))
}
```

## Build

```bash
java -jar KickAss.jar char-zoomer.asm -o char-zoomer.prg
```

`-showmem` reports `$0900` to `$2C14`: code, the frame table and the 32
zoom steps of 128 bytes (4,096 bytes), made by the assembler. The eight
charsets and four screens are built at start-up in `$4000`-`$7FFF`. The
PRG is 9,238 bytes.

## Expected output

A light blue border, a blue background, lines 51 to 58 blank, and on
lines 59 to 186 a band of white stripes, each line one source line, the
24 lines stretched about the band's middle: at zoom step 0 they fill
lines 111 to 134 once each; at step 31 each is shown five or six times
and together they fill the band.

Measured in VICE x64sc 3.10 with the pinned command, PAL c64c
(8565/8580/8521) and NTSC (`-model ntsc`, 6567R8). Each band line was
decoded with PIL (all 40 cells, white pixels to a byte; a line is source
line L if every cell i holds 8L + (i & 7), blank if every cell is 0) and
compared with the 32 tables the listing's `.for` builds, computed again
in Python:

| Run | Model | Zoom step matched | Band lines matching it | Source lines shown | Blank lines | Lines 51-58 blank |
|---|---|---|---|---|---|---|
| 8,000,000 cycles | PAL | 28 | 128 of 128 | all 24 | 10 | yes |
| 8,000,000 cycles | NTSC | 0 | 128 of 128 | all 24 | 104 | yes |
| `@later`, 8,200,000 cycles | PAL | 16 | 128 of 128 | all 24 | 50 | yes |
| `@later`, 8,200,000 cycles | NTSC | 12 | 128 of 128 | all 24 | 64 | yes |

At 8,300,000 cycles on NTSC only 119 lines match one step: the exit
screenshot was taken while the beam was inside the band, so the lines
above it belong to the next frame. A store trace over each 8,000,000-cycle
run put every band block's `$D018` write on cycle 0 of its line in the
store trace's numbering (the last cycle of the line before) on PAL and on
cycle 63 of the line before on NTSC, and every `$D011` write on cycle 4
(PAL) or 2 (NTSC) of its own line: 29,337 of each on PAL (231 frames)
and 32,893 `$D011` writes on NTSC (259 frames). Screenshots:
`screenshots/char-zoomer.png`, `screenshots/char-zoomer-ntsc.png`,
`screenshots/char-zoomer-later.png` and
`screenshots/char-zoomer-later-ntsc.png`.

## Why this works

### One write, two choices

A badline fetches 40 character codes from the screen `$D018`'s high
nibble names, and the line then shows, for each, the byte at the
charset's base + 8 × code + RC (Bauer §3.7.2). With a badline on every
line RC is 0 on every line, so each line is row 0 of 40 codes, and both
the codes and the charset come from the `$D018` value in force on that
line. The write timing is the badline form of `fpp`, measured there:
`$D018` by cycle 15 of the line, `$D011` by cycle 11.

### Fitting 24 lines into one bank

A charset occupies 2K, but only pixel row 0 of codes 0 to 119 is ever
drawn: bytes 0 to `$3B8` of the 2K. A screen is 1K and can start on any
1K boundary, so each charset's upper 1K holds a screen. Screen g (g = 0,
1, 2) holds codes 40g to 40g + 39 in every row, so charset b through
screen g is a line of 40 bytes of its own: source line 3b + g. A fourth
screen of codes 120 to 127, whose row 0 is zero, is the blank line.
Every screen row holds the same codes because the VIC's row base stays
where line 58 left it: RC never reaches 7 inside the band.

### The zoom

Step z has scale s = 1 + 4.33z / 31, and raster line y of the band shows
source line floor((y − 63.5) / s + 12), or blank outside 0 to 23. The
tables are computed by the assembler; the CPU copies 128 bytes a frame
in the border. Horizontal zoom is not done here: it would need the logo
drawn again at each width, and the eight charsets are taken by the lines.

### Sources

- Christian Bauer, "The MOS 6567/6569 video controller (VIC-II) and its
  application in the Commodore 64" (1996), §3.7.2, §3.14.3:
  https://www.zimmers.net/cbmpics/cbm/c64/vic-ii.txt
- Codebase64, "Flexible Pixel Position (FPP)" and "Introduction to
  Vertical Tweaks" (the line-selection forms this recipe uses):
  https://codebase64.c64.org/doku.php?id=base:fpp,
  https://codebase64.c64.org/doku.php?id=base:introduction_to_vertical_tweaks
