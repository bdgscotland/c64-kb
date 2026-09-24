---
recipe: dycp-scroller
toolchain: kickassembler
output_format: PRG
region: both
techniques: [dycp_scroller, soft_scroll_h, char_scroll_buffer_h]
file_formats: [PRG]
uses_registers: [D011, D012, D016, D018, D019, D01A, D020, DD04, DD05, DD0E]
uses_kernal: []
claims: [irq_vector_0314 (owns), cia1_timer_a (init), cia1_timer_b (init), cia1_tod (init), vic_raster_irq (owns), zero_page $FB-$FE (owns)]
harness: [cia2_timer_a, $02FF]
ram: [colour=$D800-$DBFF]
kernal_services: [IRQ]
---

<!-- doc-type: recipe -->

# KickAssembler — DYCP Scroller

## Synopsis

A DYCP scroller (Different Y Character Position): a message scrolls left
across the full width while every column sits at its own pixel height on
a sine wave. The screen is written once. Each of the thirty-nine visible
columns is a fixed vertical strip of six characters in a custom charset,
and every frame the column's glyph is copied into that strip at its new
pixel row, so only charset bytes change. The copy runs in the vertical
blank from raster line 250, is timed with CIA2 timer A, and prints its
cycle count and the highest raster line it ever finished on along the top
row. After 250 frames the program leaves a verdict at `$02FF` and in the
border: `$01` and green if the copy always finished before line 122, the
first raster line of the strips; `$02` and red otherwise. The effect keeps
running so the exit screenshot shows the wave.

Verified in VICE x64sc 3.10 on both models: the verdict byte is `01`,
the border is green, and the top row reads `CYCLES 05317 MAX LINE 035`
on PAL and `CYCLES 05459 MAX LINE 084` on NTSC.

## Source

```asm
// dycp-scroller.asm
// A DYCP scroller: Different Y Character Position. Thirty-nine text
// columns each sit at their own pixel Y on a sine wave. The screen never
// changes after setup: each column is a fixed vertical strip of six
// characters in a custom charset, and every frame the column's glyph is
// copied into that strip at its new pixel row. Only charset bytes move.
// The whole picture fine-scrolls left with $D016 XSCROLL, and every
// eighth frame the forty-entry ring buffer shifts and takes the next
// message character.
//
// Region: both. The copy runs in the vertical blank from raster line 250
// and is timed with CIA2 timer A; the cycle count and the highest raster
// line the copy ever finished on are printed on the top row. After
// FRAMES frames the program leaves a verdict: $02FF = $01 and a green
// border if the copy always finished before BUDGET_LINE, the first raster
// line of the strips, else $02 and red. The effect keeps running.

.const COLS        = 39          // columns with a strip; column 39 is under the border
.const STRIP_CELLS = 6           // cells per strip: 48 pixels, 40 of travel
.const BAND_TOP    = 9           // first screen row of the strips
.const HUD_CHARS   = 22          // charset slots 0-21: blank, digits, letters
.const AMPLITUDE   = 20          // pixels either side of centre; centre = 20
.const STEP        = 6           // sine-table steps between adjacent columns
.const SPEED       = 2           // sine-table steps per frame
.const IRQ_LINE    = 250         // last visible PAL line: the copy runs in the blank
.const BUDGET_LINE = 50 + BAND_TOP * 8   // 122: first raster line of the strips
.const FRAMES      = 250         // frames before the verdict is written
.const TEXT_COLOUR = 1           // white

.const SCREEN  = $0400
.const COLOUR  = $d800
.const CHARSET = $3000           // $D018 = $1C: screen $0400, charset $3000
.const RESULT  = $02ff

.const zp_dst  = $fb             // pointer used by the glyph copier at setup
.const msg_ptr = $fd             // pointer into the message

.encoding "screencode_upper"

// Map a message character to a glyph slot 0-31, so slot * 8 fits a byte.
.function slot(c) {
    .if (c == ' ') .return 0
    .if (c >= 1 && c <= 26) .return c
    .if (c == '.') .return 27
    .if (c == '!') .return 28
    .if (c == ',') .return 29
    .if (c == '-') .return 30
    .if (c == '?') .return 31
    .error "character not in the glyph set"
}

.var msg = "   DIFFERENT Y CHARACTER POSITION. THE SCREEN NEVER CHANGES, ONLY THE CHARSET DOES. THIRTY-NINE STRIPS, SIX CELLS EACH, FORTY PIXELS OF TRAVEL ...    "

BasicUpstart2(start)

// ---------------------------------------------------------------------------
// Tables, built by the assembler.
// ---------------------------------------------------------------------------
* = $2000
sine:       .fill 512, AMPLITUDE + round(sin(toRadians(i * 360 / 256)) * AMPLITUDE)
            // two periods, so sine + c*STEP + phase never wraps
font:       .fill 256, 0         // 32 glyphs x 8 rows, copied from the ROM; page-aligned
                                 // so lda font+r,y never crosses a page
glyph_codes:                     // ROM screen code for each of the 32 glyph slots
            .byte ' '
            .for (var c = 1; c <= 26; c++) { .byte c }
            .byte '.', '!', ',', '-', '?'
hud_codes:                       // ROM screen code for each HUD charset slot
            .text " 0123456789CYLESMAXIN"   // 21 slots; slot 21 stays blank
message:    .fill msg.size(), slot(msg.charAt(i)) * 8
            .byte $ff            // end marker (never a slot * 8)
digit_pow_lo: .byte <10000, <1000, <100, <10, <1
digit_pow_hi: .byte >10000, >1000, >100, >10, >1

// The HUD text as charset slots: space 0, digits 1-10, letters 11-20.
.function hud(c) {
    .if (c == ' ') .return 0
    .if (c >= '0' && c <= '9') .return c - '0' + 1
    .if (c == 'C') .return 11
    .if (c == 'Y') .return 12
    .if (c == 'L') .return 13
    .if (c == 'E') .return 14
    .if (c == 'S') .return 15
    .if (c == 'M') .return 16
    .if (c == 'A') .return 17
    .if (c == 'X') .return 18
    .if (c == 'I') .return 19
    .if (c == 'N') .return 20
    .error "character not in the HUD set"
}
.var hud_str = "CYCLES       MAX LINE"
hud_slots:  .fill hud_str.size(), hud(hud_str.charAt(i))

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
scroll_buf: .fill 40, 0          // glyph slot * 8 per column, left to right
old_y:      .fill COLS, 0        // pixel row each column's glyph was drawn at
xscroll:    .byte 7
phase:      .byte 0
frame_lo:   .byte 0
frame_hi:   .byte 0
max_line:   .byte 0              // highest end-of-copy raster line seen
cycles_lo:  .byte 0
cycles_hi:  .byte 0
verdict:    .byte 0

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
* = $0900
start:
    sei
    lda #$7f
    sta $dc0d                    // mask CIA1 interrupts
    lda $dc0d

    // Clear the screen to slot 0 (blank) and colour the strips.
    lda #0
    ldx #0
!:  sta SCREEN, x
    sta SCREEN + $100, x
    sta SCREEN + $200, x
    sta SCREEN + $2e8, x
    inx
    bne !-
    lda #TEXT_COLOUR
    ldx #0
!:  sta COLOUR, x                // row 0: the HUD
    .for (var r = BAND_TOP; r < BAND_TOP + STRIP_CELLS; r++) {
        sta COLOUR + r * 40, x
    }
    inx
    cpx #40
    bne !-

    // Lay the strips: column c, cell k is charset slot HUD_CHARS + c*STRIP_CELLS + k.
    ldx #0
    lda #HUD_CHARS
lay:
    .for (var k = 0; k < STRIP_CELLS; k++) {
        sta SCREEN + (BAND_TOP + k) * 40, x
        clc
        adc #1
    }
    inx
    cpx #COLS
    bne lay

    // HUD labels on row 0.
    ldx #0
!:  lda hud_slots, x
    sta SCREEN, x
    inx
    cpx #hud_str.size()
    bne !-

    // Clear the charset, then copy the ROM glyphs: 32 into the font table
    // (the copy source), 21 into charset slots 0-20 (the HUD).
    lda #0
    tax
!:  .for (var p = 0; p < 8; p++) { sta CHARSET + p * $100, x }
    inx
    bne !-

    lda #$33                     // character ROM in at $D000, I/O out
    sta $01
    lda #<font
    sta zp_dst
    lda #>font
    sta zp_dst + 1
    ldx #0
!:  lda glyph_codes, x
    jsr copy_glyph
    inx
    cpx #32
    bne !-
    lda #<CHARSET
    sta zp_dst
    lda #>CHARSET
    sta zp_dst + 1
    ldx #0
!:  lda hud_codes, x
    jsr copy_glyph
    inx
    cpx #21
    bne !-
    lda #$37                     // I/O back in
    sta $01

    lda #<message
    sta msg_ptr
    lda #>message
    sta msg_ptr + 1

    lda #$1b
    sta $d011
    lda #$c7                     // CSEL=0: 38 columns; XSCROLL=7
    sta $d016
    lda #$1c                     // screen $0400, charset $3000
    sta $d018
    lda #<irq
    sta $0314
    lda #>irq
    sta $0315
    lda #IRQ_LINE
    sta $d012
    lda #$01
    sta $d01a
    sta $d019
    lda #$ff                     // CIA2 timer A latch = $FFFF
    sta $dd04
    sta $dd05
    cli
    jmp *

// Copy the 8 rows of ROM glyph A (upper-case set) to (zp_dst); advance it.
copy_glyph:
    sta copy_src + 1
    lda #0
    asl copy_src + 1
    rol
    asl copy_src + 1
    rol
    asl copy_src + 1
    rol
    clc
    adc #$d0
    sta copy_src + 2
    ldy #7
copy_src:
    lda $d000, y
    sta (zp_dst), y
    dey
    bpl copy_src
    lda zp_dst
    clc
    adc #8
    sta zp_dst
    bcc !+
    inc zp_dst + 1
!:  rts

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

    // 3. The copy, timed. For each column: blank the 8 rows the glyph was
    //    on last frame, then write its 8 new rows at the new pixel Y.
    //    Strip c is 48 consecutive charset bytes, so row y of the strip is
    //    strip + y and a glyph at pixel Y is 8 bytes from strip + Y.
    lda #%00010001               // force-load $FFFF and start, continuous
    sta $dd0e
    .for (var c = 0; c < COLS; c++) {
        .const strip = CHARSET + (HUD_CHARS + c * STRIP_CELLS) * 8
        lda #0
        ldx old_y + c
        .for (var r = 0; r < 8; r++) { sta strip + r, x }
        ldx phase
        lda sine + c * STEP, x
        sta old_y + c
        tax
        ldy scroll_buf + c
        .for (var r = 0; r < 8; r++) {
            lda font + r, y
            sta strip + r, x
        }
    }
    lda $dd04                    // timer low, then high: elapsed = $FFFF - value
    eor #$ff
    sta cycles_lo
    lda $dd05
    eor #$ff
    sta cycles_hi
    lda #0
    sta $dd0e                    // stop the timer

    // 4. Where did the copy end? Lines at or after IRQ_LINE are still this
    //    frame's blank and count as 0; anything else is lines into the next.
    lda $d012
    ldx $d011
    bpl !+                       // bit 7 = raster bit 8: line >= 256
    lda #0
    beq got_line
!:  cmp #IRQ_LINE
    bcc got_line
    lda #0
got_line:
    cmp max_line
    bcc !+
    sta max_line
!:

    // 5. HUD: cycles in decimal at columns 7-11, max line at columns 22-24.
    lda cycles_lo
    sta num_lo
    lda cycles_hi
    sta num_hi
    jsr to_decimal               // writes 5 digits at digits+0..4
    .for (var d = 0; d < 5; d++) {
        lda digits + d
        sta SCREEN + 7 + d
    }
    lda max_line
    sta num_lo
    lda #0
    sta num_hi
    jsr to_decimal
    .for (var d = 2; d < 5; d++) {
        lda digits + d
        sta SCREEN + 20 + d
    }

    // 6. After FRAMES frames, the verdict. Once.
    lda verdict
    bne done
    inc frame_lo
    bne !+
    inc frame_hi
!:  lda frame_lo
    cmp #<FRAMES
    bne done
    lda frame_hi
    cmp #>FRAMES
    bne done
    lda max_line
    cmp #BUDGET_LINE
    bcs fail
    lda #$01
    ldy #5                       // green
    bne set_verdict
fail:
    lda #$02
    ldy #2                       // red
set_verdict:
    sta RESULT
    sta verdict
    sty $d020
done:
    lda #$01
    sta $d019
    jmp $ea31                    // KERNAL housekeeping once a frame; CIA1 is masked

// 16-bit num -> five HUD digit slots (1-10) at digits+0..4.
num_lo:  .byte 0
num_hi:  .byte 0
digits:  .fill 5, 0
to_decimal:
    ldx #0
next_digit:
    lda #1                       // slot 1 = '0'
    sta digits, x
sub_again:
    lda num_lo
    sec
    sbc digit_pow_lo, x
    tay
    lda num_hi
    sbc digit_pow_hi, x
    bcc digit_done
    sta num_hi
    sty num_lo
    inc digits, x
    bne sub_again
digit_done:
    inx
    cpx #5
    bne next_digit
    rts

// Shift the ring left and append the next message glyph.
shift_buffer:
    ldx #0
!:  lda scroll_buf + 1, x
    sta scroll_buf, x
    inx
    cpx #39
    bne !-
    ldy #0
    lda (msg_ptr), y
    cmp #$ff
    bne !+
    lda #<message                // end of message: wrap
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
java -jar KickAss.jar dycp-scroller.asm -o dycp-scroller.prg
```

KickAssembler 5.25 reports code at `$0900-$1914` and tables at
`$2000-$2441`; the PRG is 7,235 bytes. The 2 KB charset at `$3000` is
not in the file: the program clears it and copies the glyphs it needs
out of the character ROM at start.

## Expected output

A blue screen with a green border. On the top row, in white,
`CYCLES nnnnn MAX LINE nnn`. Across the middle, the message in white with
each column at a different height, forming just under one period of a
sine wave (39 columns × STEP 6 = 234 of the 256 table steps) and 40
pixels tall from trough to crest. The text moves left one pixel per frame
(50 px/s on PAL, 60 px/s on NTSC) and the wave rolls under it two table
steps per frame; a column's height changes by at most one pixel a frame
at that speed. The 38-column mode hides column 39, so characters slide in
from under the right border and out under the left one a pixel at a time.

Screenshots from the runs this page describes, pinned at 9,000,000
cycles: `screenshots/dycp-scroller.png` (PAL) and
`screenshots/dycp-scroller-ntsc.png` (6567R8). Both runs were made twice
and the two PNGs were byte-identical each time. The verdict store,
watched with a `trace store 02ff` as `docs/runtime/vice-reference.md`
"Verifying a run without a human" route 2 shows, was `01` on both models
(at cycle 7,924,349 on PAL and 7,391,660 on NTSC). The top row shows the
count from the frame before the screenshot's, because the exit frame's
own top row is drawn a few thousand cycles after its interrupt has
written it: the last NTSC store was 5,543 and the picture says 5,459.

## Why this works

### The strips

The band is screen rows 9 to 14. Column `c`, cell `k` of the band holds
charset slot `22 + c*6 + k`, so the six cells of one column are six
consecutive slots and, since a slot is 8 bytes, one strip is 48
consecutive bytes of the charset: `$3000 + (22 + c*6) * 8`. Pixel row `y`
of the strip is byte `strip + y`. Putting a glyph at pixel `Y` is
therefore eight stores to `strip + Y + 0 .. 7`, and the cell split the
technique description talks about (row offset `Y & 7` into cell `Y >> 3`
and the rest into the cell below) falls out of the address arithmetic
without being computed. Six cells give 48 pixels, of which a glyph can
start on 0 to 40: the 40 pixels of travel. The screen and colour RAM are
never written again after setup. This is `dycp_scroller` in
`docs/techniques/scroll.md`.

Thirty-nine strips of six cells is 234 slots; slots 0 to 21 are left for
the blank the rest of the screen shows and for the digits and letters of
the top row. Column 39 gets no strip because CSEL=0 hides it at every
XSCROLL (measured for `sine-scroller.md`).

### The copy

Per column, fully unrolled by the assembler: eight stores of zero at the
column's previous `Y` (kept in `old_y`), then the new `Y` from the sine
table, then eight `lda font+r,y` / `sta strip+r,x` pairs with `X = Y` and
`Y = glyph * 8`. The glyph source is a 256-byte copy of 32 ROM glyphs, so
`glyph * 8` fits a byte and one indexed load reaches any row of any
glyph; the message is mapped onto those 32 slots by the assembler
(`slot()`), because screen codes for space and punctuation lie above 31.
The sine table is two periods long so `lda sine + c*STEP, x` with
`X = phase` never needs a wrap. Clearing the old eight rows rather than
the two rows a one-pixel move vacates costs six stores a column and makes
the copy correct for any per-frame move up to eight pixels, which is what
lets SPEED or AMPLITUDE be changed without touching the copy.

Measured with CIA2 timer A over 304 PAL frames (a `trace store` on the
two count bytes): 5,305 to 5,343 cycles, 136 a column. The 38-cycle
spread is the page crossing of `lda sine + c*STEP, x`, one cycle in the
columns where it happens. An earlier build of this page kept `font`
where the tables happened to end, straddling `$2300`, and the same
measurement read 5,376 to 5,522: `lda font+r,y` crossing a page on most
rows. Aligning `font` to a page took 71 to 179 cycles off the copy and
narrowed the spread to the sine crossing alone.

### Where the work runs

The interrupt is at line 250. The copy starts after the KERNAL's 36-cycle
entry, the `$D016` write, the wave step and, every eighth frame, the
buffer shift (that lead-in is not measured here), and it ends, by the `$D012` read at its tail, no later than line
35 on PAL and line 84 on NTSC. The strips' first raster line is 122
(`50 + 9*8`), so the VIC never fetches a strip byte the copy is still
writing and a single charset is enough; a second charset and a `$D018`
flip are not needed here. The verdict is that inequality held for
every one of the first 250 frames.

On NTSC the same 5,305-cycle copy is stretched to 5,433 to 5,556 cycles
of CIA time: the NTSC frame is 263 lines, so line 250 is only 13 lines
from the end, and the copy runs over rows 0 to 4 of the next display,
crossing three to five badlines (lines 51, 59, 67, 75, 83), each of
which stops the CPU for 40 to 43 cycles (`badline_cycle_loss` in
`docs/pitfalls/raster-and-badline.md`). The count on the top row
shows that pitfall: the CPU work is identical on both
models and the timer says it is not.

### The verdict line

`$D012` at the end of the copy is a nine-bit value read through two
registers. A line at or after 250 is still this frame's blank and counts
as 0; a line at or above 256 (bit 7 of `$D011` set) is also the blank on
PAL and is folded to 0 as well, which is right for a copy that ends
within one frame and would misreport one that ran a whole frame late.
The maximum is kept, printed, and compared with BUDGET_LINE once, at
frame 250. `$02FF` and `$D020` are then written exactly once; the
handler keeps running afterwards so the picture at the pinned cycle count
is a live frame, not a frozen one.

### Region

`region: both`. Nothing in the copy depends on the model. What differs is
the room after line 250: about 7,100 cycles to the first badline on PAL
and about 4,200 on NTSC, so the NTSC copy runs some 33 lines into the
display and pays the badlines above. Both finish 38 or more lines before
the strips. A taller band, more columns or a lower IRQ line uses up that
margin on NTSC first; the top row's `MAX LINE` is the number to watch.
