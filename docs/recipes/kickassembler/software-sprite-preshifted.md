---
recipe: software-sprite-preshifted
toolchain: kickassembler
output_format: PRG
region: both
techniques: [software_sprite_preshifted]
file_formats: [PRG]
uses_registers: [D011, D012, D018, D020, DD04, DD05, DD0E]
uses_kernal: [CHROUT]
---

<!-- doc-type: recipe -->

# KickAssembler — Pre-shifted Software Sprites in a Character Back Buffer

## Synopsis

Two 24x21 objects, a ring and a diamond, are drawn into a 16x4 cell
character canvas over a tiled background with an AND mask and OR data,
pre-shifted for the eight pixel positions so a draw is a copy and never
a shift. At start-up, with the display blanked, one masked blit is timed
with CIA2 timer A at each of the eight shifts, the canvas is checksummed
after the draw and after the erase, the erase is timed, and one more
blit is timed with the display on so the badline cost shows. Every
figure is printed in decimal. Then the two objects cross the canvas in
opposite directions, one pixel a frame, drawn after the VIC has passed
the canvas rows. This is the `software_sprite_preshifted` technique;
use it when hardware sprites have run out on a row and the objects sit
on a background that can be repainted.

Verified in VICE x64sc 3.10: the blit costs 1,428 cycles at every shift
on PAL and on NTSC, the canvas checksum returns to the background value
after every erase, and the pinned pictures show the two objects
overlapping mid-canvas.

## Source

```asm
// software-sprite-preshifted.asm
// Two 24x21 software sprites drawn into a character-mode back buffer with
// an AND mask and OR data, pre-shifted for the eight pixel positions so a
// draw is a straight copy with no shifting at run time. The buffer is a
// 16x4 cell canvas made of characters 192..255 of a copied ROM font, so a
// pixel row of the canvas is one byte per cell, eight bytes apart. The
// background is an 8x8 tile repeated over the canvas; erase writes the
// tile rows back over the object's footprint.
// Start-up, screen blanked: one masked blit of the ring is timed with CIA2
// timer A at each of the eight shifts, the canvas is checksummed after the
// draw and again after the erase, and the erase is timed. Then, with the
// display on, one blit is timed starting at raster line 100 so the badline
// cost shows. The screen prints every figure in decimal. After that the
// ring and the diamond cross the canvas in opposite directions, one pixel
// a frame, drawn after the VIC has passed the canvas rows.
// Verdict: $02FF = $01 and a green border when every drawn checksum
// differs from the background's and every erased checksum equals it;
// $02FF = $02 and a red border otherwise.

BasicUpstart2(start)
.encoding "petscii_upper"

.const CHROUT    = $ffd2
.const RESULT    = $02ff         // verdict byte read by the harness
.const BORDER    = $d020
.const CODE_PASS = $01
.const CODE_FAIL = $02

.const SCREEN    = $0400
.const COLRAM    = $d800
.const FONT      = $3000         // 2 KB copy of the ROM upper-case font
.const CANVAS    = FONT + 192 * 8 // glyphs 192..255: 16 cells x 4 rows
.const CW        = 16            // canvas width in cells
.const CROW      = 2             // screen row of the canvas's top cell row
.const CCOL      = 12            // screen column of its left cell column
.const XMAX      = CW * 8 - 32   // last x that keeps a 4-cell footprint inside
.const YA        = 3             // ring's top pixel row inside the canvas
.const YB        = 8             // diamond's top pixel row
.const TIMELINE  = 100           // raster line the in-display timing starts on
.const DRAWLINE  = 128           // raster line the frame loop draws from

// zero page
.const val       = $fb           // 16-bit number for the decimal printer
.const chk       = $fd           // 16-bit canvas checksum
.const ptr       = $f7           // copy pointer
.const ax        = $02           // ring x, 0..XMAX
.const bx        = $03           // diamond x
.const adir      = $04           // +1 or -1
.const bdir      = $05

// Background tile, 8 rows: diagonal stripes.
.var TILE = List().add($11, $22, $44, $88, $11, $22, $44, $88)

// Shapes: 21 rows of 24 pixels. data = pixels the object sets, mask =
// pixels it leaves alone (1 = transparent).
.var ringData = List()
.var ringMask = List()
.for (var r = 0; r < 21; r++) {
    .var d = 0
    .var m = 0
    .for (var x = 0; x < 24; x++) {
        .var dx = x - 11.5
        .var dy = r - 10
        .var dd = dx * dx + dy * dy
        .var solid = (dd <= 110) && (dd > 22)
        .if (solid) { .eval d = d | (1 << (23 - x)) }
        .if (!solid) { .eval m = m | (1 << (23 - x)) }
    }
    .eval ringData.add(d)
    .eval ringMask.add(m)
}
.var diaData = List()
.var diaMask = List()
.for (var r = 0; r < 21; r++) {
    .var d = 0
    .var m = 0
    .for (var x = 0; x < 24; x++) {
        .var man = abs(x - 11.5) + abs(r - 10)  // diamond: L1 distance
        .var inside = man <= 11.5
        .var edge = inside && (man > 9.5)
        .if (edge) { .eval d = d | (1 << (23 - x)) }
        .if (!inside) { .eval m = m | (1 << (23 - x)) }
    }
    .eval diaData.add(d)
    .eval diaMask.add(m)
}

// One pre-shifted table: for each of the 84 byte positions (21 rows x 4
// cells) the eight shifts in a row, so the shift is a Y index and the
// position is a constant in the unrolled code. Page-aligned, so no
// abs,y read crosses a page.
.function shifted(word, s, c, fillbit) {
    .var b = 0
    .for (var i = 0; i < 8; i++) {
        .var o = c * 8 + i           // output bit, counted from the left
        .var k = o - s               // the 24-bit word's bit that lands there
        .var bit = fillbit
        .if (k >= 0 && k < 24) { .eval bit = (word >> (23 - k)) & 1 }
        .eval b = b | (bit << (7 - i))
    }
    .return b
}
.macro ShiftTable(rows, fillbit) {
    .for (var p = 0; p < 84; p++) {
        .var r = floor(p / 4)
        .var c = mod(p, 4)
        .for (var s = 0; s < 8; s++) {
            .byte shifted(rows.get(r), s, c, fillbit)
        }
    }
}

// Blit(y0, data, mask): masked draw of a 24x21 object whose top row is
// canvas pixel row y0. X = x & $F8 (the cell column times 8), Y = x & 7
// (the shift). 84 byte positions, each load, AND, OR, store.
.macro Blit(y0, data, mask) {
    .for (var r = 0; r < 21; r++) {
        .var y = y0 + r
        .var base = CANVAS + floor(y / 8) * CW * 8 + mod(y, 8)
        .for (var c = 0; c < 4; c++) {
            .var p = r * 4 + c
            lda base + c * 8,x
            and mask + p * 8,y
            ora data + p * 8,y
            sta base + c * 8,x
        }
    }
    rts
}

// Erase(y0): write the tile rows back over the 4-cell footprint. X as
// for Blit; Y unused.
.macro Erase(y0) {
    .for (var r = 0; r < 21; r++) {
        .var y = y0 + r
        .var base = CANVAS + floor(y / 8) * CW * 8 + mod(y, 8)
        lda #TILE.get(mod(y, 8))
        .for (var c = 0; c < 4; c++) {
            sta base + c * 8,x
        }
    }
    rts
}

// Time(routine, slot): run routine with CIA2 timer A counting phi2 from
// $FFFF; leave $FFFF - TA, the cycles taken, in slot (16-bit).
.macro Time(routine, slot) {
    lda #$11                     // CRA: start, force load, count phi2
    sta $dd0e
    jsr routine
    lda #$00
    sta $dd0e                    // stop A
    sec
    lda #$ff
    sbc $dd04
    sta slot
    lda #$ff
    sbc $dd05
    sta slot + 1
}

// Net(slot): slot -= empty, the cost of the harness itself
.macro Net(slot) {
    sec
    lda slot
    sbc t_empty
    sta slot
    lda slot + 1
    sbc t_empty + 1
    sta slot + 1
}

start:
    sei
    cld
    lda #$00
    sta $dd0e                    // stop timer A, latch $FFFF
    lda #$ff
    sta $dd04
    sta $dd05

    // screen off, so no badline steals cycles from the timed blits.
    // DEN is sampled on line $30; wait for the next frame so it applies.
    lda $d011
    and #$ef
    sta $d011
    jsr waitframe
    jsr waitframe

    // copy the ROM upper-case font to FONT, then point the VIC at it
    lda #$33
    sta $01
    ldx #$00
!:  .for (var i = 0; i < 8; i++) {
        lda $d000 + i * 256,x
        sta FONT + i * 256,x
    }
    inx
    bne !-
    lda #$37
    sta $01
    lda #$1c                     // screen $0400, font $3000
    sta $d018

    // fill the canvas glyphs with the tile
    ldx #$00
!:  .for (var i = 0; i < 2; i++) {
        lda tilepat, x           // x & 7 selects the row, see tilepat
        sta CANVAS + i * 256,x
    }
    inx
    bne !-

    // background checksum, then the eight timed draws and erases
    jsr checksum
    lda chk
    sta chk0
    lda chk + 1
    sta chk0 + 1
    lda #CODE_PASS
    sta RESULT

    Time(empty, t_empty)
    ldy #$00
measure:
    sty shift
    ldx #$08                     // cell column 1
    Time(blita, t_shift)
    lda shift
    asl
    tay
    lda t_shift
    sta t_shifts, y
    lda t_shift + 1
    sta t_shifts + 1, y
    jsr checksum                 // drawn: must differ from background
    lda chk
    cmp chk0
    bne !+
    lda chk + 1
    cmp chk0 + 1
    bne !+
    jsr fail
!:  ldx #$08
    ldy shift
    Time(erasea, t_erase)
    jsr checksum                 // erased: must equal background
    lda chk
    cmp chk0
    bne bad
    lda chk + 1
    cmp chk0 + 1
    beq !+
bad: jsr fail
!:  ldy shift
    iny
    cpy #$08
    beq !+
    jmp measure
!:

    // display on, then one blit timed from raster line TIMELINE
    lda $d011
    ora #$10
    sta $d011
    jsr waitframe
    jsr waitframe
!:  lda $d012
    cmp #TIMELINE
    bne !-
    ldx #$08
    ldy #$03
    Time(blita, t_disp)
    ldx #$08
    jsr erasea

    // print the figures. The screen CHROUT returns with interrupts
    // enabled after every character, so every print goes through out,
    // which does sei again; a KERNAL IRQ would otherwise jitter the
    // frame loop below.
    lda #$93                     // clear, cursor home
    jsr out
    ldx #$08
!:  lda #$11                     // cursor down
    jsr out
    dex
    bne !-
    ldx #$00
    stx shift
!:  ldy #$00
    jsr print                    // "SHIFT "
    lda shift
    clc
    adc #'0'
    jsr out
    lda #' '
    jsr out
    lda shift
    asl
    tax
    lda t_shifts, x
    sta val
    lda t_shifts + 1, x
    sta val + 1
    Net(val)
    jsr decimal
    lda #$0d
    jsr out
    inc shift
    ldx shift
    cpx #$08
    bne !-
    ldy #erasetext - texts
    jsr print
    lda t_erase
    sta val
    lda t_erase + 1
    sta val + 1
    Net(val)
    jsr decimal
    lda #$0d
    jsr out
    ldy #disptext - texts
    jsr print
    lda t_disp
    sta val
    lda t_disp + 1
    sta val + 1
    Net(val)
    jsr decimal
    lda #$0d
    jsr out
    ldy #tabletext - texts
    jsr print
    lda #<(tables_end - tables)
    sta val
    lda #>(tables_end - tables)
    sta val + 1
    jsr decimal
    ldy #bytestext - texts
    jsr print
    lda #$0d
    jsr out
    ldy #restext - texts
    jsr print
    lda RESULT
    jsr hexbyte
    lda #$0d
    jsr out

    lda RESULT
    cmp #CODE_PASS
    bne !+
    lda #$05                     // green
    .byte $2c                    // BIT abs: skip the red
!:  lda #$02                     // red
    sta BORDER

    // lay the canvas on screen (after the clear, which wiped the cells)
    .for (var cy = 0; cy < 4; cy++) {
        .for (var cx = 0; cx < CW; cx++) {
            lda #192 + cy * CW + cx
            sta SCREEN + (CROW + cy) * 40 + CCOL + cx
            lda #$01
            sta COLRAM + (CROW + cy) * 40 + CCOL + cx
        }
    }

    // the frame loop: erase both at their old x, step, draw both
    lda #$00
    sta ax
    lda #XMAX
    sta bx
    lda #$01
    sta adir
    lda #$ff
    sta bdir
frame:
    lda $d012
    cmp #DRAWLINE
    bne frame
    lda ax
    and #$f8
    tax
    jsr erasea
    lda bx
    and #$f8
    tax
    jsr eraseb
    lda ax
    clc
    adc adir
    sta ax
    beq !+
    cmp #XMAX
    bne !++
!:  lda adir
    eor #$fe                     // +1 <-> -1
    sta adir
!:  lda bx
    clc
    adc bdir
    sta bx
    beq !+
    cmp #XMAX
    bne !++
!:  lda bdir
    eor #$fe
    sta bdir
!:  lda ax
    and #$f8
    tax
    lda ax
    and #$07
    tay
    jsr blita
    lda bx
    and #$f8
    tax
    lda bx
    and #$07
    tay
    jsr blitb
    jmp frame

fail:
    lda #CODE_FAIL
    sta RESULT
    rts

empty:
    rts

out:                             // CHROUT, then interrupts off again
    jsr CHROUT
    sei
    rts

waitframe:                       // RST8 clear, then set: one frame edge
    bit $d011
    bmi waitframe
!:  bit $d011
    bpl !-
    rts

checksum:                        // 16-bit sum of the 512 canvas bytes
    lda #$00
    sta chk
    sta chk + 1
    ldx #$00
chkloop:
    .for (var i = 0; i < 2; i++) {
        clc
        lda CANVAS + i * 256,x
        adc chk
        sta chk
        lda chk + 1
        adc #$00
        sta chk + 1
    }
    inx
    bne chkloop
    rts

blita:  Blit(YA, dataA, maskA)
blitb:  Blit(YB, dataB, maskB)
erasea: Erase(YA)
eraseb: Erase(YB)

print:                           // texts,y up to a zero
    lda texts, y
    beq !+
    jsr out
    iny
    bne print
!:  rts

decimal:                         // print val (16-bit) in decimal, no leading zeros
    ldx #$00                     // x indexes pow10, 2 bytes an entry
    stx lead
digit:
    ldy #'0' - 1
!:  iny
    sec
    lda val
    sbc pow10, x
    pha
    lda val + 1
    sbc pow10 + 1, x
    bcc !+
    sta val + 1
    pla
    sta val
    jmp !-
!:  pla
    cpy #'0'
    bne !+
    lda lead
    beq !++                      // leading zero: skip
!:  tya
    jsr out
    inc lead
!:  inx
    inx
    cpx #2 * 4
    bne digit
    lda val                      // last digit always printed
    clc
    adc #'0'
    jmp out

hexbyte:                         // print A as two hex digits
    pha
    lsr
    lsr
    lsr
    lsr
    jsr hexdigit
    pla
    and #$0f
hexdigit:
    cmp #10
    bcc !+
    adc #6                       // carry set: +7 lands on 'A'..'F'
!:  adc #'0'
    jmp out

pow10:  .word 10000, 1000, 100, 10

tilepat: .fill 256, TILE.get(mod(i, 8))

texts:
shifttext: .text "SHIFT "
           .byte 0
erasetext: .text "ERASE   "
           .byte 0
disptext:  .text "DISPLAY "
           .byte 0
tabletext: .text "TABLES  "
           .byte 0
bytestext: .text " BYTES"
           .byte 0
restext:   .text "RESULT "
           .byte 0

shift:    .byte 0
lead:     .byte 0
chk0:     .word 0
t_empty:  .word 0
t_shift:  .word 0
t_erase:  .word 0
t_disp:   .word 0
t_shifts: .fill 16, 0

.align $100
tables:
dataA: ShiftTable(ringData, 0)  // data: vacated bits clear
maskA: ShiftTable(ringMask, 1)  // mask: vacated bits transparent
dataB: ShiftTable(diaData, 0)
maskB: ShiftTable(diaMask, 1)
tables_end:

.print "blit bytes " + (blitb - blita)
.print "erase bytes " + (eraseb - erasea)
.print "tables bytes " + (tables_end - tables)
.print "end " + toHexString(tables_end)
```

## Build

```bash
java -jar $KICKASS_JAR software-sprite-preshifted.asm -o software-sprite-preshifted.prg
```

The assembler prints `blit bytes 1009`, `erase bytes 295` and
`tables bytes 2688`. The PRG loads at $0801 and ends at $247F; the font
copy sits at $3000-$37FF.

## Expected output

Screen rows 2 to 5, columns 12 to 27, show the canvas: diagonal stripes
with a white ring and a white-edged diamond moving across it, the
diamond drawn over the ring where they overlap. Rows 8 to 19 read:

```text
SHIFT 0 1428
SHIFT 1 1428
SHIFT 2 1428
SHIFT 3 1428
SHIFT 4 1428
SHIFT 5 1428
SHIFT 6 1428
SHIFT 7 1428
ERASE   462
DISPLAY 1557
TABLES  2688 BYTES
RESULT 01
```

Each `SHIFT` figure is the cycles of one masked blit of the ring at that
pixel offset, display blanked, less the cycles of an empty timed call
(the `JSR`, the `RTS` and the two instructions that stop the timer; 18
by arithmetic from the instruction table, the value itself is not
printed). `ERASE` is the tile restore over the same footprint. `DISPLAY` is
the shift-3 blit started at raster line 100 with the display on: 1,557
on PAL and on NTSC, the difference from 1,428 being the three badlines
the blit crosses. `TABLES` is the size of the four pre-shift
tables, two objects' data and mask. `RESULT 01` and a green border say
that at every shift the drawn canvas differed from the background and
the erased canvas equalled it; `02` and a red border say one did not.

Pinned run, 4,160,000 cycles, both models:
`screenshots/software-sprite-preshifted.png` and
`screenshots/software-sprite-preshifted-ntsc.png`, each identical over
two runs. Positions measured with PIL from the ring's top row (a six
pixel run at canvas row 3; the stripe pixel at x = 48 on that row
resolves which side of the run it joins): the ring's left edge is at
canvas x = 38 on PAL and 40 on NTSC, so the diamond, which starts at
x = 96 and moves the other way, is at 58 and 56. The two overlap by four
pixels on PAL and eight on NTSC, and the diamond's blank interior cuts
the ring where it covers it. The NTSC run is two frames further on; the
start-up path differs by model and the offset is not analysed here.

## Why this works

**The canvas.** The screen cells hold codes 192 to 255 of a font copied
from ROM to $3000, so cell `(cx, cy)` of the canvas is code
`192 + cy * 16 + cx` and pixel row `y` of cell column `cx` is byte
`$3600 + (y / 8) * 128 + cx * 8 + (y & 7)`. A pixel row across the
canvas is one byte per cell, eight apart, and a horizontal move by one
cell is a change of 8 in the X register. The 24 pixel object needs four
cells once it is shifted, and `XMAX = 96` keeps the fourth cell inside
the 16 cell row. Each character row of the canvas is 128 bytes and
starts on a half page, so no `abs,x` store crosses a page.

**The tables.** For each of the 84 byte positions (21 rows by 4 cells)
the eight shifts are stored together, so the unrolled `and` and `ora`
name a constant position and take the shift from Y. The tables are
page-aligned and each group of eight is aligned, so no `abs,y` read
crosses a page, and every byte of the blit costs 4 + 4 + 4 + 5 = 17
cycles: `84 * 17 = 1,428`, which is what the timer reads at every
shift. The mask's vacated bits are 1 and the data's are 0, so the
fourth byte at shift 0 leaves the background alone.

**The measurement.** CIA2 timer A counts phi2 from $FFFF and the count
is `$FFFF - TA` after the stop, with the carry set before the first
`SBC` because the timed routine returns with it in either state. The
eight blits and the erase run under `SEI` with DEN off, dropped a frame
early because the VIC samples DEN once, on line $30, so no badline
steals from the count. The `DISPLAY` figure is the same blit with DEN
on, started at line 100: it spans about 23 lines and crosses the
badlines at 107, 115 and 123, and the 129 extra cycles are three
badlines at 43, the same on both models.

**The frame loop.** The canvas occupies screen rows 2 to 5, raster lines
67 to 98, and the VIC fetches its font bytes on every one of those
lines. The loop waits for `$D012 = 128`, erases both objects at their
old x, steps them, and draws both; the work is about 3,780 cycles, 60
lines, done long before the canvas rows come round again. A canvas that
filled the screen would leave only the blank for this, and would need
two fonts and a `$D018` flip (`screen_double_buffer_d018` applied to the
font bits). The erase comes before either draw so that neither erase
wipes the other object's fresh pixels; the draws go ring then diamond,
so the diamond is on top.

**Interrupts.** The KERNAL's screen `CHROUT` returns with interrupts
enabled for every character it writes, not only on a clear or a scroll:
the screen editor's common exit ends `CLC`, `CLI`, `RTS`, the `CLI` at
$E6B4 in the 901227-03 KERNAL (read from the ROM image), and in VICE the
I flag was clear after `CHROUT` with a plain `A` and after $93 (measured
by storing the status register to the screen). An earlier draft cleared
the screen before copying the font with I/O banked out under `$01 = $33`,
and the CIA IRQ that then fired could not be acknowledged, so the
machine sat in the KERNAL handler for ever. The listing routes every
print through `out`, which does `SEI` again, and clears the screen only
after the copy and the timed runs. That is the mechanism of the
`kernal_assumes_sei_cleared` pitfall, reached through a routine its
entry does not list; the harness meets it, the blit itself calls no
KERNAL routine.

## What this recipe does not show

A save-under erase for a background that is not a tile, a bitmap-mode
destination, vertical movement (the row is baked into the unrolled
addresses, so a moving row needs a routine per row or a slower indexed
one), and the run-time shifting draw this technique replaces, so there
is no measured figure here for what pre-shifting saves.
