---
recipe: palette-cells
toolchain: kickassembler
output_format: PRG
region: both
techniques: []
file_formats: [PRG]
uses_registers: [D020, D021]
uses_kernal: []
---

<!-- doc-type: recipe -->

# KickAssembler Palette Cells

## Synopsis

Paints each of the 16 VIC-II colours into a known band of screen cells,
labels each band with its hex index, and sets the border to colour 9. The
exit screenshot is then a picture of the emulator's palette: sample one
pixel per band and you have the RGB triple VICE emits for that colour
index on that machine model. Use it to calibrate a screenshot decoder, or
to check which palette an unfamiliar VICE build or configuration is using.

## Source

```asm
// palette-cells.asm
// Paints the 16 VIC-II colours as reverse-space swatches, one per row,
// labels each row with its hex index, and sets the border to colour 9.
BasicUpstart2(start)

.const SCREEN = $0400
.const COLRAM = $d800
.const FIRST_ROW = 4           // swatch for colour c is on row FIRST_ROW + c
.const SWATCH_LEFT = 4         // columns 4..35 inclusive
.const SWATCH_RIGHT = 35
.const BORDER_COLOUR = 9       // brown, so the picture shows the program set it
.const REVERSE_SPACE = $a0

.const scr = $fb               // zero-page pointer to the row in screen RAM
.const col = $fd               // zero-page pointer to the row in colour RAM
.const idx = $02               // colour index being painted

start:
    lda #0
    sta $d021                  // background black
    lda #BORDER_COLOUR
    sta $d020

    // clear screen RAM to spaces and colour RAM to black
    ldx #0
clear:
    lda #$20
    sta SCREEN,x
    sta SCREEN+$100,x
    sta SCREEN+$200,x
    sta SCREEN+$300,x
    lda #0
    sta COLRAM,x
    sta COLRAM+$100,x
    sta COLRAM+$200,x
    sta COLRAM+$300,x
    inx
    bne clear

    // title on row 1, column 2, in white
    ldx #0
title_loop:
    lda title,x
    beq title_done
    sta SCREEN+1*40+2,x
    lda #1
    sta COLRAM+1*40+2,x
    inx
    bne title_loop
title_done:

    ldx #0
rows:
    stx idx
    lda rowlo,x
    sta scr
    sta col
    lda rowhi,x
    sta scr+1
    clc
    adc #>(COLRAM-SCREEN)     // $04xx -> $D8xx
    sta col+1

    // hex digit at column 2, white
    ldy #2
    lda hexdigit,x
    sta (scr),y
    lda #1
    sta (col),y

    // the swatch: reverse spaces in colour idx
    ldy #SWATCH_RIGHT
swatch:
    lda #REVERSE_SPACE
    sta (scr),y
    lda idx
    sta (col),y
    dey
    cpy #SWATCH_LEFT
    bcs swatch

    ldx idx
    inx
    cpx #16
    bne rows

forever:
    jmp forever                // never return: BASIC's READY. would land on a swatch

rowlo:
    .fill 16, <(SCREEN + (FIRST_ROW + i) * 40)
rowhi:
    .fill 16, >(SCREEN + (FIRST_ROW + i) * 40)

.encoding "screencode_upper"   // letters as screen codes $01-$1A for the default charset
hexdigit:
    .text "0123456789ABCDEF"
title:
    .text "VIC-II PALETTE, BORDER = 9"
    .byte 0
```

## Build

```bash
java -jar KickAss.jar palette-cells.asm -o palette-cells.prg
```

Produces `palette-cells.prg` (208 bytes, KickAssembler 5.25). Run it
headless with the pinned command from `docs/runtime/vice-reference.md`
(`-autostartprgmode 1 -limitcycles 8000000`, once as PAL and once with
`-model ntsc`).

## Expected output

Black background, brown border. Row 1 reads `VIC-II PALETTE, BORDER = 9`
in white. Rows 4 to 19 each carry a white hex digit `0`..`F` at column 2
and a solid bar of that colour across columns 4 to 35. Row 4 (colour 0)
is black on black, so only its digit shows.

Screenshots from the VICE x64sc 3.10 runs this page describes:
`screenshots/palette-cells.png` (PAL, 384x272) and
`screenshots/palette-cells-ntsc.png` (`-model ntsc`, 384x247). Both runs
used `-default`, so the palette is whatever VICE 3.10 generates when no
external palette file is selected. It matches none of the 27 `.vpl`
files installed in `/opt/homebrew/opt/vice/share/vice/C64/`, checked by
comparing all 16 triples against each file.

Measured with PIL from those two PNGs: every one of the 2048 pixels in
each band (32 cells of 8x8) is the same triple, and the border pixel at
(2, 100) equals the colour 9 triple on both models.

| Index | Name | PAL RGB | NTSC RGB |
|---|---|---|---|
| 0 | black | (0, 0, 0) | (0, 0, 0) |
| 1 | white | (255, 255, 255) | (255, 255, 255) |
| 2 | red | (175, 60, 88) | (169, 71, 100) |
| 3 | cyan | (126, 243, 214) | (138, 230, 203) |
| 4 | purple | (170, 64, 245) | (154, 88, 185) |
| 5 | green | (98, 213, 50) | (114, 189, 103) |
| 6 | blue | (44, 61, 236) | (25, 73, 180) |
| 7 | yellow | (255, 255, 70) | (255, 248, 141) |
| 8 | orange | (183, 99, 30) | (196, 98, 65) |
| 9 | brown | (119, 83, 0) | (151, 64, 0) |
| 10 | light red | (238, 123, 149) | (230, 134, 163) |
| 11 | dark grey | (98, 98, 98) | (98, 98, 98) |
| 12 | grey | (148, 148, 148) | (148, 148, 148) |
| 13 | light green | (183, 255, 134) | (198, 255, 186) |
| 14 | light blue | (115, 133, 255) | (98, 145, 251) |
| 15 | light grey | (205, 205, 205) | (205, 205, 205) |

The five greys (0, 1, 11, 12, 15) are identical on both models. Every
other index has a different triple under `-model ntsc`, so a decoder
that matches colours by exact value must carry one table per model, or
sample the picture it is decoding.

To read the table back from a PNG: colour `c` is at
`(32 + 8*20 + 4, y0 + 8*(4 + c) + 4)` with `y0 = 35` for PAL and
`y0 = 23` for NTSC (the display area's first row on each model, measured
as the first row whose pixel at x = 100 is not the border colour).

## Why this works

A reverse space (screen code `$A0`) is the inverse of space: all 64
pixels of the cell take the foreground colour from colour RAM, so a cell
holding `$A0` is a solid 8x8 block of whatever value sits in `$D800` at
the same offset. Filling 32 such cells per row gives a band wide enough
to sample anywhere without touching a glyph edge. The background is set
to 0 so colour 0's band is deliberately invisible; its digit still marks
the row.

The digits and title are written as screen codes, not PETSCII, because
they are stored straight into screen RAM. KickAssembler's default
encoding (`screencode_mixed`) maps `A`..`Z` to `$41`..`$5A`, which in
the power-on upper-case/graphics character set are graphics symbols;
`.encoding "screencode_upper"` maps them to `$01`..`$1A`, the codes that
draw capital letters in that set. Digits are `$30`..`$39` under both.
The KERNAL's screen editor knows nothing of these writes, so the cursor
stays where `RUN` left it; that is why the program ends in `jmp forever`
rather than `rts`. Returning to BASIC would print `READY.` at the old
cursor position, which is inside the swatch band.

`$FB`..`$FE` and `$02` are zero-page bytes the memory maps list as free
for user programs (from the published maps, not measured here; the
program ran correctly under the KERNAL and BASIC of the run above). The
row-address tables are built by the assembler with `.fill`, so no
run-time multiply is needed.

Verified: assembled with KickAssembler 5.25 and run in VICE x64sc 3.10
under the pinned command on PAL and NTSC; the two PNGs named above are
the pictures those runs produced, and the RGB table was measured from
them, not from a palette file.
