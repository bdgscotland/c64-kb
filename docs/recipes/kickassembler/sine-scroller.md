---
recipe: sine-scroller
toolchain: kickassembler
output_format: PRG
region: both
techniques: [soft_scroll_h, char_scroll_buffer_h]
file_formats: [PRG]
uses_registers: [D011, D012, D016, D019, D01A]
uses_kernal: []
---

<!-- doc-type: recipe -->

# KickAssembler — Sine-Wave Scroller

## Synopsis

A text scroller whose forty character columns ride a sine wave. The whole
screen is fine-scrolled a pixel per frame with $D016 XSCROLL; every eighth
frame the forty-character ring buffer shifts left by one and takes the next
character of the message. Each frame the nine-row band is cleared and every
column's character is placed on the row the sine table gives for that
column. The sine table, the row-address table and the screen-code text are
all built by the assembler. Nothing is cycle-exact: the redraw runs in the
vertical blank.

Verified in VICE x64sc: the message appears in white on a wave across the
middle of the screen and moves left.

## Source

```asm
// sine-scroller.asm
// A text scroller whose 40 columns ride a sine wave. The whole screen is
// fine-scrolled with $D016 XSCROLL; every eighth frame the 40-character
// ring buffer shifts left by one and takes the next character of the
// message. Each frame the nine-row band is cleared and every column's
// character is placed on the row the sine table gives for that column.
//
// Region: both. Nothing here is cycle-exact; the redraw runs in the
// vertical blank and takes about 4,500 cycles of the 7,000 available
// between raster line 250 and the top of the next frame on PAL.

.const BAND_TOP   = 8        // first screen row of the band
.const CENTER     = 12       // row the wave is centred on
.const AMPLITUDE  = 4        // rows above and below CENTER
.const STEP       = 6        // sine-table steps between adjacent columns
.const SPEED      = 2        // sine-table steps per frame
.const IRQ_LINE   = 250      // last visible PAL line: the redraw runs in the blank
.const TEXT_COLOUR = 1       // white

.const SCREEN = $0400
.const COLOUR = $d800

BasicUpstart2(start)

// ---------------------------------------------------------------------------
// Tables, built by the assembler.
// ---------------------------------------------------------------------------
* = $0c00
sine:       .fill 256, round(sin(toRadians(i * 360 / 256)) * AMPLITUDE)
row_lo:     .fill 25, <(SCREEN + i * 40)
row_hi:     .fill 25, >(SCREEN + i * 40)

.encoding "screencode_upper"  // .text emits screen codes for the upper-case charset
message:
    .text "   GREETINGS FROM A SINE SCROLLER THAT WAS ASSEMBLED, RUN AND "
    .text "PHOTOGRAPHED BEFORE IT WAS WRITTEN UP ...    "
    .byte 0

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
* = $0b00
scroll_buf: .fill 40, $20    // the 40 visible characters, left to right
xscroll:    .byte 0          // 0-7, written to $D016
phase:      .byte 0          // sine-table index of column 0
col_phase:  .byte 0
col:        .byte 0
.const zp_row  = $fb         // zero-page pointer to the current row
.const msg_ptr = $fd         // zero-page pointer into the message: (zp),y needs zero page

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
* = $0900
start:
    sei
    lda #$7f
    sta $dc0d
    lda $dc0d

    // Clear the screen and colour the band.
    lda #$20
    ldx #0
!:  sta SCREEN, x
    sta SCREEN + $100, x
    sta SCREEN + $200, x
    sta SCREEN + $2e8, x
    inx
    bne !-
    lda #TEXT_COLOUR
    ldx #0
!:  .for (var r = BAND_TOP; r <= BAND_TOP + 2 * AMPLITUDE; r++) {
        sta COLOUR + r * 40, x
    }
    inx
    cpx #40
    bne !-

    lda #<message
    sta msg_ptr
    lda #>message
    sta msg_ptr + 1

    lda #$1b
    sta $d011
    lda #$c0                 // CSEL=0: 38 columns, the edge columns are hidden
    sta $d016
    lda #<irq
    sta $0314
    lda #>irq
    sta $0315
    lda #IRQ_LINE
    sta $d012
    lda #$01
    sta $d01a
    sta $d019
    cli
    jmp *

// ---------------------------------------------------------------------------
// Once per frame, in the vertical blank.
// ---------------------------------------------------------------------------
irq:
    // 1. Fine scroll one pixel left; every eighth frame shift the buffer.
    dec xscroll
    bpl set_d016
    lda #7
    sta xscroll
    jsr shift_buffer
set_d016:
    lda xscroll
    ora #$c0
    sta $d016

    // 2. Advance the wave.
    lda phase
    clc
    adc #SPEED
    sta phase

    // 3. Clear the band.
    lda #$20
    ldx #39
!:  .for (var r = BAND_TOP; r <= BAND_TOP + 2 * AMPLITUDE; r++) {
        sta SCREEN + r * 40, x
    }
    dex
    bpl !-

    // 4. Place each column's character on its row.
    lda phase
    sta col_phase
    ldx #0
place:
    stx col
    ldy col_phase
    lda sine, y
    clc
    adc #CENTER              // row = CENTER + sine[col_phase], 8..16
    tay
    lda row_lo, y
    sta zp_row
    lda row_hi, y
    sta zp_row + 1
    lda scroll_buf, x
    ldy col
    sta (zp_row), y
    lda col_phase
    clc
    adc #STEP
    sta col_phase
    inx
    cpx #40
    bne place

    lda #$01
    sta $d019
    jmp $ea31                // KERNAL housekeeping once a frame; CIA1 is masked

// Shift the ring left and append the next message character.
shift_buffer:
    ldx #0
!:  lda scroll_buf + 1, x
    sta scroll_buf, x
    inx
    cpx #39
    bne !-
    ldy #0
    lda (msg_ptr), y
    bne !+
    lda #<message            // end of message: wrap
    sta msg_ptr
    lda #>message
    sta msg_ptr + 1
    lda (msg_ptr), y
!:  sta scroll_buf + 39
    inc msg_ptr
    bne !+
    inc msg_ptr + 1
!:  rts
```

## Build

```bash
java -jar KickAss.jar sine-scroller.asm -o sine-scroller.prg
```

## Expected output

A blue screen with the message in white, one character per column, each
column on a row between 8 and 16 so the text forms a sine wave about 1.7
periods wide. The text moves left one pixel per frame (50 px/s PAL,
60 px/s NTSC) and the wave rolls with it, two table steps per frame. The
leftmost and rightmost columns are hidden by the 38-column mode, so
characters enter and leave under the border rather than popping.

Screenshot from the VICE run this page describes: `screenshots/sine-scroller.png`.

## Why this works

### Fine scroll plus buffer shift

$D016 bits 0-2 (XSCROLL) shift the whole character display right by 0-7
pixels. Counting XSCROLL down from 7 to 0 moves the picture left a pixel per
frame; when it would go below 0 it is reset to 7 and the character data is
moved left one column instead, which puts the picture back where the
viewer's eye expects it. Here the data being moved is the forty-byte ring
buffer, not screen RAM: the screen is redrawn from the buffer every frame
anyway, so shifting the buffer is the whole carry step. This is the
`soft_scroll_h` and `char_scroll_buffer_h` pair from
`docs/techniques/scroll.md`.

Bit 3 of $D016 (CSEL) is cleared, giving 38 columns. Columns 0 and 39 are
still written but fall under the border, so a new character appears fully
formed as it scrolls in from under the right border instead of appearing at
XSCROLL=7 with a visible jump.

### The wave

For column `c` the row is `CENTER + sine[(phase + c*STEP) & 255]`, with
`sine` a 256-entry table of `round(sin(θ) * AMPLITUDE)`. `phase` advances by
`SPEED` per frame. `STEP = 6` across forty columns spans 240 table entries,
just under a full period. Rows are reached through a 25-entry table of row
start addresses, loaded into a zero-page pointer and indexed by the column
in Y. No multiplies at run time; nothing but table lookups.

The band is cleared before the columns are placed, because a column's
character moves to a different row every frame and the old one would
otherwise stay behind. The clear is 360 stores unrolled nine rows wide,
about 2,000 cycles.

### Where the work runs

The interrupt is at line 250, the last visible line on PAL. Everything —
the shift, the clear and the forty placements — happens between there and
the next frame's first badline at line 51, roughly 7,000 cycles on PAL and
6,000 on NTSC, of which this code uses about 4,500. Because all screen
writes finish before the VIC begins fetching the band, there is no tearing
without any further raster work. The handler exits through `$EA31` so the
KERNAL still scans the keyboard and runs the jiffy clock once a frame; CIA1
is masked so that routine's `$DC0D` read is harmless.

### Three things that were wrong in the earlier version

1. Its memory map overlapped: code at $0900 ran into the sine table at
   $0A00, and KickAssembler refused to assemble it.
2. It kept the message pointer in ordinary RAM and used it with `(ptr),y`.
   That addressing mode only exists for zero page; the assembler truncated
   the operand to a zero-page address silently, and the scroller printed
   BASIC's workspace bytes instead of the message (a screen full of `3`s in
   the first run of this rewrite, since it used $2B/$2C). The pointer now
   lives at $FD/$FE. Check every `(zp),y` operand is below $100.
3. It commented the message as "PETSCII $41-$5A". Screen RAM holds screen
   codes, in which upper-case letters are $01-$1A; `.encoding
   "screencode_upper"` makes `.text` emit those. The default encoding,
   `screencode_mixed`, emits upper-case source letters as $41-$5A, which
   the default upper/graphics character set displays as graphics symbols.

### Region

`region: both`. The mechanism is the same on NTSC; the animation runs 20 %
faster and the blank is about 1,000 cycles shorter, still ample.
