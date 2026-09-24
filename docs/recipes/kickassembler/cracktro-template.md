---
recipe: cracktro-template
toolchain: kickassembler
output_format: PRG
region: pal
techniques: [raster_bars, soft_scroll_h, char_scroll_buffer_h, sid_play_routine_pattern]
file_formats: [PRG]
uses_registers: [D011, D012, D016, D018, D019, D01A, D020, D021, D418, DC00, DC0D]
uses_kernal: []
claims: [irq_vector_0314 (owns), cia1_timer_a (init), cia1_timer_b (init), cia1_tod (init), zero_page $FB-$FE (owns)]
ram: [colour=$D800-$DBFF]
kernal_services: [IRQ]
---

<!-- doc-type: recipe -->

# KickAssembler — Cracktro Template

## Synopsis

A cracktro skeleton assembled from parts that are each verified on their own
in this set: a text logo with per-row colours, ten raster bars from a chained
IRQ ring (`raster-bars.md`; the table-driven form of such a ring is
`irq_chain_table` in `../../techniques/raster.md`), a sine scroller redrawn in the vertical blank
(`sine-scroller.md`), a SID play call once a frame against a stub player at
$1000, and a fire-button exit that silences the SID, restores the VIC and the
KERNAL interrupt, and jumps to a configurable entry address. Everything runs
from one IRQ ring of twelve handlers per frame.

Two things the earlier version of this recipe promised and this one does not:
open side borders and a sprite layer. The side-border trick needs the whole
CPU for every line it covers and a badline-free, sprite-constant region
(`sideborder-open.md` explains both); it does not drop into a bar handler as
"two writes, timing approximate", which is what the old text said and what
its listing did, to no visible effect. Add it as its own raster region.

Verified in VICE x64sc: logo, bars with the greetings text on top, the wave,
the prompt. The fire exit was not exercised (no joystick in the headless run).

## Source

```asm
// cracktro-template.asm
// A cracktro skeleton built from the parts verified elsewhere in this set:
// a text logo, ten raster bars (raster-bars.asm), a sine scroller
// (sine-scroller.asm), a SID play call once a frame, and a fire-button
// exit that hands the machine back in a clean state.
//
// IRQ ring, one frame:
//   line 250  irq_vbl     SID play, scroller state and redraw, fire check,
//                         XSCROLL back to 0 for the top of the next frame
//   line  87  irq_bar0    first of ten chained bar handlers (6 lines each);
//                         bars 1-9 and the end are armed two lines ahead of
//                         their line, because line 99, 123 and 147 are badlines
//   line 193  irq_scroll  XSCROLL for the scroller rows
//
// Memory:
//   $0900  code            $1000  SID (init at $1000, play at $1003)
//   $2000  tables, text    $3000  screen image copied to $0400 at start

.const GAME_ENTRY  = $a474   // BASIC warm start; replace with the real entry
.const SID_INIT    = $1000
.const SID_PLAY    = $1003

.const BAR_START   = 88      // 88 & 7 = 0; with BAR_H = 6 no bar starts on a badline,
                             // but the line BEFORE bars 2 and 6 and the end is one
.const BAR_H       = 6
.const NUM_BARS    = 10

.const BAND_TOP    = 18      // scroller: screen rows 18-22
.const CENTER      = 20
.const AMPLITUDE   = 2
.const STEP        = 8
.const SPEED       = 3
.const SCROLL_LINE = 51 + BAND_TOP * 8   // 195, first raster line of the band

.const SCREEN = $0400
.const COLOUR = $d800
.const zp_row  = $fb
.const msg_ptr = $fd

BasicUpstart2(start)

// ---------------------------------------------------------------------------
// SID stub: replace with a real player, e.g.
//   * = $1000 "music"
//   .import binary "tune.bin"   // the .sid body without its header
// or LoadSid() as in kickassembler-reference.md.
// ---------------------------------------------------------------------------
* = $1000 "sid"
    rts                      // $1000 init
    nop
    nop
    rts                      // $1003 play

// ---------------------------------------------------------------------------
// Tables and text
// ---------------------------------------------------------------------------
* = $2000 "tables"
palette:
    .byte $06, $0e, $0e, $03, $03, $05, $05, $0d
    .byte $0d, $07, $07, $08, $08, $02, $02, $0a
    .byte $0a, $04, $04, $06, $06, $0e, $0e, $03
    .byte $03, $05, $05, $0d, $0d, $07, $07, $08
frame_offset: .byte 0

sine:       .fill 256, round(sin(toRadians(i * 360 / 256)) * AMPLITUDE)
row_lo:     .fill 25, <(SCREEN + i * 40)
row_hi:     .fill 25, >(SCREEN + i * 40)
row_colour: .byte 6, 14, 1, 14, 0,  0, 0, 1, 1, 1,  1, 1, 0, 0, 0,  0, 0, 0, 1, 1,  1, 1, 1, 0, 11

scroll_buf: .fill 40, $20
xscroll:    .byte 0
phase:      .byte 0
col_phase:  .byte 0
col:        .byte 0

.encoding "screencode_upper"
message:
    .text "   CRACKED BY YOUR FAVOURITE GROUP   GREETINGS TO EVERYONE WHO "
    .text "ASSEMBLES A LISTING BEFORE PUBLISHING IT   PRESS FIRE ...      "
    .byte 0

// Screen image: 25 rows of 40. Copied to $0400 at start (a PRG that loads
// straight over the screen is overwritten by the KERNAL's READY.).
* = $3000 "screen"
screen_image:
    .fill 40, $a0                                 // row 0: solid bar (reverse space)
    .text "          C64 KNOWLEDGE BASE            "   // row 1
    .text "     KICKASSEMBLER CRACKTRO TEMPLATE    "   // row 2
    .fill 40, $a0                                 // row 3
    .fill 3 * 40, $20                             // rows 4-6
    .text "        GREETINGS TO: GENESIS PROJECT   "   // row 7
    .text "        FAIRLIGHT * TRIAD * REMEMBER    "   // row 8
    .text "        ALPHA FLIGHT * IKARI + TALENT   "   // row 9
    .text "        AND EVERYONE WHO READS SOURCE   "   // row 10
    .fill 7 * 40, $20                             // rows 11-17
    .fill 5 * 40, $20                             // rows 18-22: scroller band
    .fill 40, $20                                 // row 23
    .text "        PRESS FIRE TO CONTINUE          "   // row 24

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
* = $0900 "code"
start:
    sei
    lda #$7f
    sta $dc0d
    lda $dc0d

    // Screen image and per-row colours.
    ldx #0
!:  lda screen_image, x
    sta SCREEN, x
    lda screen_image + $100, x
    sta SCREEN + $100, x
    lda screen_image + $200, x
    sta SCREEN + $200, x
    lda screen_image + $2e8, x
    sta SCREEN + $2e8, x
    inx
    bne !-
    ldx #39
colour_loop:
    .for (var r = 0; r < 25; r++) {
        lda row_colour + r
        sta COLOUR + r * 40, x
    }
    dex
    bmi !+
    jmp colour_loop          // the unrolled body is too long for a branch
!:

    lda #<message
    sta msg_ptr
    lda #>message
    sta msg_ptr + 1

    lda #0                   // song 0
    jsr SID_INIT

    lda #$1b
    sta $d011
    lda #$c0                 // 38 columns, XSCROLL 0
    sta $d016
    lda #$15
    sta $d018                // screen $0400, ROM upper-case charset
    lda #0
    sta $d020
    sta $d021

    lda #<irq_vbl
    sta $0314
    lda #>irq_vbl
    sta $0315
    lda #250
    sta $d012
    lda #$01
    sta $d01a
    sta $d019
    cli
    jmp *

// ---------------------------------------------------------------------------
// Line 250: everything that is not a raster split.
// ---------------------------------------------------------------------------
irq_vbl:
    lda #$01
    sta $d019

    jsr SID_PLAY

    // Fire on joystick port 2: $DC00 bit 4 low.
    lda $dc00
    and #$10
    bne !+
    jmp exit
!:

    // Scroller: fine scroll, buffer shift every eighth frame, wave, redraw.
    dec xscroll
    bpl !+
    lda #7
    sta xscroll
    jsr shift_buffer
!:  lda phase
    clc
    adc #SPEED
    sta phase
    jsr redraw_band

    // The top of the next frame is not scrolled.
    lda #$c0
    sta $d016

    // Palette rotation for the bars.
    inc frame_offset
    lda frame_offset
    and #$0f
    sta frame_offset

    lda #BAR_START - 1
    sta $d012
    lda #<irq_bar0
    sta $0314
    lda #>irq_bar0
    sta $0315
    jmp $ea31                // KERNAL housekeeping once a frame

// ---------------------------------------------------------------------------
// Bars: ten chained handlers, see raster-bars.asm.
// ---------------------------------------------------------------------------
.macro BarIRQ(bar, next, next_line) {
    lda frame_offset
    .if (bar > 0) {
        clc
        adc #bar
        and #$0f
    }
    asl
    tax
    ldy palette + 1, x
    lda palette, x
    tax
    lda #BAR_START + bar * BAR_H
!:  cmp $d012
    bne !-
    stx $d020
    sty $d021
    lda #next_line
    sta $d012
    lda #<next
    sta $0314
    lda #>next
    sta $0315
    lda #$01
    sta $d019
    jmp $ea81
}

irq_bar0: BarIRQ(0, irq_bar1, BAR_START + 1 * BAR_H - 2)
irq_bar1: BarIRQ(1, irq_bar2, BAR_START + 2 * BAR_H - 2)
irq_bar2: BarIRQ(2, irq_bar3, BAR_START + 3 * BAR_H - 2)
irq_bar3: BarIRQ(3, irq_bar4, BAR_START + 4 * BAR_H - 2)
irq_bar4: BarIRQ(4, irq_bar5, BAR_START + 5 * BAR_H - 2)
irq_bar5: BarIRQ(5, irq_bar6, BAR_START + 6 * BAR_H - 2)
irq_bar6: BarIRQ(6, irq_bar7, BAR_START + 7 * BAR_H - 2)
irq_bar7: BarIRQ(7, irq_bar8, BAR_START + 8 * BAR_H - 2)
irq_bar8: BarIRQ(8, irq_bar9, BAR_START + 9 * BAR_H - 2)
irq_bar9: BarIRQ(9, irq_bar_end, BAR_START + 10 * BAR_H - 2)

// After the last bar: back to black, then on to the scroller split.
irq_bar_end:
    lda #BAR_START + NUM_BARS * BAR_H
!:  cmp $d012
    bne !-
    lda #0
    sta $d020
    sta $d021
    lda #SCROLL_LINE - 2
    sta $d012
    lda #<irq_scroll
    sta $0314
    lda #>irq_scroll
    sta $0315
    lda #$01
    sta $d019
    jmp $ea81

// ---------------------------------------------------------------------------
// Line 193: XSCROLL for the scroller rows only. The write lands during the
// last line of row 17, which is blank.
// ---------------------------------------------------------------------------
irq_scroll:
    lda xscroll
    ora #$c0
    tax
    lda #SCROLL_LINE - 1
!:  cmp $d012
    bne !-
    stx $d016
    lda #250
    sta $d012
    lda #<irq_vbl
    sta $0314
    lda #>irq_vbl
    sta $0315
    lda #$01
    sta $d019
    jmp $ea81

// ---------------------------------------------------------------------------
// Scroller, see sine-scroller.asm.
// ---------------------------------------------------------------------------
redraw_band:
    lda #$20
    ldx #39
!:  .for (var r = BAND_TOP; r <= BAND_TOP + 2 * AMPLITUDE; r++) {
        sta SCREEN + r * 40, x
    }
    dex
    bpl !-
    lda phase
    sta col_phase
    ldx #0
place:
    stx col
    ldy col_phase
    lda sine, y
    clc
    adc #CENTER
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
    rts

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
    lda #<message
    sta msg_ptr
    lda #>message
    sta msg_ptr + 1
    lda (msg_ptr), y
!:  sta scroll_buf + 39
    inc msg_ptr
    bne !+
    inc msg_ptr + 1
!:  rts

// ---------------------------------------------------------------------------
// Fire pressed: silence the SID, put the VIC and the interrupt system back
// the way the KERNAL left them, and go.
// ---------------------------------------------------------------------------
exit:
    lda #0
    ldx #$18
!:  sta $d400, x
    dex
    bpl !-
    lda #$1b
    sta $d011
    lda #$c8
    sta $d016
    lda #$15
    sta $d018
    lda #$0e
    sta $d020
    lda #$06
    sta $d021
    lda #0
    sta $d01a                // VIC interrupts off
    lda #$01
    sta $d019
    lda #$31
    sta $0314
    lda #$ea
    sta $0315                // KERNAL IRQ service back in place
    lda #$81
    sta $dc0d                // CIA1 timer A interrupt on again
    lda $dc0d
    jmp GAME_ENTRY           // from inside the IRQ: GAME_ENTRY must not RTI
```

## Build

```bash
java -jar KickAss.jar cracktro-template.asm -o cracktro-template.prg
```

About 11 KB, most of it the 1,000-byte screen image and the tables.

## Expected output

Top four rows: a blue/light-blue/white/light-blue banner with the two title
lines. Lines 88-147: ten six-line raster bars cycling through the palette one
step per frame (border and screen background take adjacent palette entries,
so each bar is two-tone), with the four greetings rows in white on top of
them. Every colour change lands in the left border, measured at x=0..1 of the
VICE screenshot (an earlier build of this listing tore three of them
mid-line; see "Bar lines and badlines"). Below that, black. Rows 18-22: the scroll text in white on a two-row sine wave,
moving left a pixel a frame. Row 24: `PRESS FIRE TO CONTINUE` in dark grey.
Fire on joystick port 2 silences the SID, restores the default colours and
the KERNAL interrupt, and jumps to `GAME_ENTRY` (BASIC's warm start, `$A474`,
until you change it).

Screenshot from the VICE run this page describes: `screenshots/cracktro-template.png`.

## Why this works

### One ring, three kinds of handler

The frame is a ring: `irq_vbl` at line 250 does all the work that is not a
raster split (SID play, the scroller's state and redraw, the fire check, the
palette step), because from line 250 to line 51 of the next frame there are
about 7,000 cycles and nothing to look at. It arms `irq_bar0` for line 87.
The ten bar handlers are the `BarIRQ` macro from `raster-bars.md`, each
spinning on `$D012` to put its two colour writes in the horizontal blank,
then handing on. `irq_bar_end` returns the colours to black and arms
`irq_scroll` for line 193, which sets `$D016` for the scroller rows only;
`irq_vbl` sets it back to zero at the end of the frame so the logo and the
greetings do not scroll. Then the ring closes.

Only `irq_vbl` exits through `$EA31`, the KERNAL's full interrupt service,
so the jiffy clock and keyboard scan run once a frame; the others exit
through `$EA81`, the bare register restore. CIA1 is masked, so `$EA31`'s
read of `$DC0D` finds nothing.

### Bar lines and badlines

`BAR_START = 88` and `BAR_H = 6`: the bar starts fall on 88, 94, 100, ... 142,
which are 0, 6, 4, 2 (mod 8) in rotation and never 3, so no bar's first line
is a badline with the default YSCROLL. The old layout started at line 91,
which is a badline, and its own text noticed and left it as a TODO.

The version of this listing before 2026-09-22 had a second fault. Each handler is armed for the line *before* its bar and
spins on `$D012` from there, and the lines before bars 2, 6 and the end (99,
123 and 147) are badlines (3 mod 8). An IRQ raised on a badline is not taken
until the VIC gives the bus back around cycle 55, so the handler reached its
spin loop late and its colour write landed part-way across line 100, 124 and
148: measured in the VICE screenshot, the new border colour on line 100 began
at x=343 and the black on line 148 at x=176, both well inside the picture.
The fix is two characters: bars 1-9 and `irq_bar_end` are now armed at
`start - 2` instead of `start - 1`, so the badline is spent inside the spin
loop, which catches `start` in its first cycles as usual. After the change
all eleven colour changes are in the left border (screenshot x=0..1).
`irq_vbl` still arms `irq_bar0` at 87, which is not a badline.

### The scroller region

The band is rows 18-22 (lines 195-234). `$D016` is written with the current
XSCROLL at line 194 (the last line of row 17, which is blank) and cleared
at line 250. Because 38-column mode is on for the whole screen, the logo and
greetings lose their edge columns too; that is why the text rows of the
screen image keep columns 0 and 39 empty (the earlier text said the whole
image did; rows 0 and 3 are solid reverse-space bars and are clipped
by the wider border). The redraw and the buffer shift are the routines from
`sine-scroller.md` with a two-row amplitude.

### The SID hook

`$1000` init / `$1003` play is the convention most trackers export, and the
stub here honours it with two `RTS`. `JSR SID_INIT` with the subtune in A at
start, `JSR SID_PLAY` once a frame from `irq_vbl`. Replace the four bytes at
`$1000` with a real player (`.import binary` of a header-stripped `.sid`, or
`LoadSid()`), check the header's init and play addresses, and keep the play
call in the blank so a player that touches `$D418` does not click mid-frame.

### The exit

Called from inside the interrupt, so it must never return: it zeroes the 25
SID registers, restores `$D011`/`$D016`/`$D018` and the two colours, turns
the VIC's interrupt source off and acknowledges it, puts `$EA31` back in
`$0314/$0315`, re-enables CIA1 timer A with `$81` (bit 7 set means "set these
bits"), drops any pending CIA flag, and jumps. Interrupts are still disabled
at that point, which is what a game entry expects; the BASIC warm start
placeholder re-enables them itself (checked in VICE: `SEI`, jiffy clock
zeroed, `JMP $A474`, then `PRINT TI` gives a non-zero count; the `READY.`
print goes out through CHROUT, whose screen path ends in `CLI` at `$E6B4`
in the 901227-03 KERNAL). The earlier version jumped to `$xxxx`,
which is not a number and did not assemble.

### Region

`region: pal` for the line numbers (250 is inside PAL's 312 lines and NTSC's
263, but the blank is shorter on NTSC) and because the bars are laid out on
PAL badline arithmetic. Nothing is cycle-counted.
