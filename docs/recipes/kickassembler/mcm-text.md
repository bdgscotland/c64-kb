---
recipe: mcm-text
toolchain: kickassembler
output_format: PRG
region: both
techniques: [mcm_text]
file_formats: [PRG]
uses_registers: [D016, D018, D020, D021, D022, D023, D025, D026]
uses_kernal: []
claims: [vic_char_base (owns)]
ram: [colour=$D800-$DBFF]
---

<!-- doc-type: recipe -->

# KickAssembler — Multicolour character mode: one glyph in multicolour and hires cells

## Synopsis

Sets the MCM bit in `$D016` and shows one custom glyph, byte `%00011011`
on all eight rows, in two rows of eight cells. The upper cells have colour
RAM 8 to 15 (bit 3 set) and draw multicolour: four double-wide pixels in
`$D021`, `$D022`, `$D023` and the colour RAM's low three bits. The lower
cells hold the same glyph with colour RAM 0 to 7 (bit 3 clear) and draw
hires, eight pixels in `$D021` and the colour RAM colour, although MCM is
on. `$D025` and `$D026`, the sprite multicolour registers, are set to two
colours that must not appear. Use it as the smallest check of the
bit-pair-to-register map and the per-cell opt-in.

## Source

```asm
// mcm-text.asm
// Multicolour character mode: one glyph, %00 %01 %10 %11 in its four
// double-wide pixels, shown in eight multicolour cells (colour RAM 8-15)
// and in eight hires cells (colour RAM 0-7) on the same screen. The MCM
// bit in $D016 is global; bit 3 of each cell's colour RAM nibble decides
// whether that cell is drawn multicolour.
//
// Colours: $D021 dark grey (%00), $D022 red (%01), $D023 green (%10), and
// %11 from colour RAM bits 0-2. $D025/$D026 (sprite multicolour) are set
// to light blue and light green as a control: neither colour may appear.

BasicUpstart2(start)

.const SCREEN  = $0400
.const COLRAM  = $d800
.const CHARSET = $3000           // $D018 = $1C: screen $0400, charset $3000
.const GLYPH   = %00011011       // pairs %00 %01 %10 %11, left to right
.const ROW_MC  = 4               // screen row of the multicolour cells
.const ROW_HI  = 6               // screen row of the hires cells

* = $0810
start:
    sei
    lda #0
    sta $d020                    // border black
    lda #11
    sta $d021                    // %00: dark grey
    lda #2
    sta $d022                    // %01: red
    lda #5
    sta $d023                    // %10: green
    lda #14
    sta $d025                    // control: light blue, must not appear
    lda #13
    sta $d026                    // control: light green, must not appear

    // Charset: 2 KB of zeros (code 0 is blank), then code 1 = GLYPH on all
    // eight rows.
    lda #0
    tax
!:  .for (var p = 0; p < 8; p++) { sta CHARSET + p * $100, x }
    inx
    bne !-
    lda #GLYPH
    ldx #7
!:  sta CHARSET + 1 * 8, x
    dex
    bpl !-

    // Screen: code 0 everywhere, colour RAM 8 (multicolour, %11 black).
    ldx #0
!:  lda #0
    sta SCREEN, x
    sta SCREEN + $100, x
    sta SCREEN + $200, x
    sta SCREEN + $2e8, x
    lda #8
    sta COLRAM, x
    sta COLRAM + $100, x
    sta COLRAM + $200, x
    sta COLRAM + $2e8, x
    inx
    bne !-

    // Row ROW_MC, columns 0-7: code 1, colour RAM 8..15 (bit 3 set).
    // Row ROW_HI, columns 0-7: code 1, colour RAM 0..7 (bit 3 clear).
    ldx #7
!:  lda #1
    sta SCREEN + ROW_MC * 40, x
    sta SCREEN + ROW_HI * 40, x
    txa
    sta COLRAM + ROW_HI * 40, x
    ora #8
    sta COLRAM + ROW_MC * 40, x
    dex
    bpl !-

    lda #$1c                     // screen $0400, charset $3000
    sta $d018
    lda #$d8                     // MCM on, 40 columns, XSCROLL 0
    sta $d016
    jmp *
```

## Build

```bash
java -jar KickAss.jar mcm-text.asm -o mcm-text.prg
```

Produces `mcm-text.prg`, `$0801` to `$089A`, 156 bytes on disk.

## Expected output

Black border, dark grey screen. Screen row 4, columns 0 to 7: eight cells,
each four double-wide pixels dark grey, red, green, then colour 0 to 7
(black, white, red, cyan, purple, green, blue, yellow). Screen row 6,
columns 0 to 7: eight hires cells, pixels grey grey grey C C grey C C in
colour C = 0 to 7. Nothing else on the screen.

Measured with PIL on `screenshots/mcm-text.png` (PAL c64c, VICE x64sc
3.10, 8,000,000 cycles) and `screenshots/mcm-text-ntsc.png` (`-model
ntsc`, 6567R8): all 64,000 pixels of the display window match that
description exactly on both models, the border is black on every row,
and no display pixel is light blue or light green, the `$D025`/`$D026`
colours.

Row 4, cell 7, pixel row 3, left to right: dark grey, dark grey, red, red,
green, green, yellow, yellow. The colour RAM value there is 15; the `%11`
pixels are yellow (7), not light grey (15), because only bits 0 to 2 reach
the `%11` pixel.

Control: the same listing with `$D016` = `$C8` (MCM off) differs from the
expectation in 384 pixels on each model, all in row 4: the upper cells
draw hires in colours 8 to 15, and colour RAM 13 and 14 put 64 light green
and light blue pixels on the screen.

## Why this works

**The mode is global, the opt-in is per cell.** `$D016` bit 4 makes the
VIC read each character's colour RAM nibble with its bit 3 as a switch.
With bit 3 set the eight bits of a glyph row are read as four pairs, each
pixel two dots wide: `%00` is `$D021`, `%01` `$D022`, `%10` `$D023`, `%11`
the nibble's bits 0 to 2. With bit 3 clear the cell is ordinary hires even
though MCM is on. So hires text and multicolour tiles can share one
screen and one charset, and the price is eight colours instead of sixteen
for the hires text and for the `%11` pixel.

**The charset.** The ROM font is drawn for hires; shown multicolour its
single-pixel strokes turn into mismatched pairs. A multicolour screen
needs its own glyphs in RAM, so the listing clears 2 KB at `$3000`, writes
one glyph as code 1 and points `$D018` there (`$1C`: matrix `$0400`,
character base `$3000`, VIC bank 0). Code 0 is left blank, all `%00`,
which is `$D021` in either kind of cell.

**No interrupt runs.** The program sets `SEI` and ends in `JMP *`, so the
KERNAL's cursor blink never writes the screen and the exit picture is the
same on every frame.
