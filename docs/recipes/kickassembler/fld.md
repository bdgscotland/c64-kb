---
recipe: fld
toolchain: kickassembler
output_format: PRG
region: both
techniques: [fld_flexible_line_distance, stable_raster_irq, double_irq, badline_synchronization]
file_formats: [PRG]
uses_registers: [D011, D012, D019, D01A, DC0D, DD04, DD05, DD0E]
uses_kernal: []
---

<!-- doc-type: recipe -->

# KickAssembler — FLD: push the display down N lines and read back where the first badline lands

## Synopsis

Delays the first badline of every frame by N raster lines, N taken from a
sine table, so the whole text screen bounces up and down by up to 40 lines.
A double IRQ enters on line 47, resets YSCROLL to 3, and from line 50 on
rewrites `$D011` once per line with a YSCROLL that never matches the line,
so the VIC takes no badline and stays in idle state. `$3FFF` holds
`%10101010`, so the gap the display leaves behind is a band of vertical
black stripes rather than plain background. After the gap the handler
counts loop iterations per raster line, finds the first line with fewer
than three (the badline stall), and compares it with 51 + N. Row 1 of the
screen shows N, 51 + N, the measured line and the gap's cycle count from
CIA2 timer A; `$02FF` is `$01` while every frame has matched and `$02`
from the first that did not. PAL and NTSC.

## Source

```asm
// fld.asm
// Flexible Line Distance: the text display is pushed down N raster lines
// each frame by rewriting YSCROLL ($D011 bits 0-2) on every line from 50
// on, so that no line in the gap satisfies (line & 7) == YSCROLL and the
// VIC never takes a badline there. With no row fetched the chip stays in
// its idle state and draws the byte at $3FFF across the gap; $3FFF holds
// %10101010 so the gap is visibly striped. N comes from a sine table
// indexed by a frame counter, so the screen bounces.
//
// After the gap the handler counts CPU loop iterations per raster line and
// records the first line with fewer than three: that is the first badline
// of the frame, read back from the machine rather than assumed. CIA2
// timer A times the gap loop. Text row 1 shows this frame's N, the
// expected first badline (51+N), the measured one and the gap's cycles;
// row 0 carries the labels, and its top pixel line is the shifted
// display's first line. $02FF is $01 while every frame's measurement has
// matched and $02 from the first frame that did not.

.const FLD_START  = 50       // first line whose YSCROLL is rewritten
.const SYNC_PAD   = 11       // measured in VICE, as in stable-raster-irq
.const RESULT     = $02ff
.const IDLE_BYTE  = $3fff    // VIC bank 0: the idle-state fetch address

.const fld_n      = $02      // zero page: this frame's N
.const first_bad  = $03      // first badline line, measured
.const expect_bad = $04      // 51 + N
.const cur_line   = $05
.const frame      = $06
.const tmp        = $07
.const gap_lo     = $08
.const gap_hi     = $09

.encoding "screencode_upper"

BasicUpstart2(start)

.macro Delay(n) {
    .if (n < 2) .error "Delay needs >= 2 cycles"
    .if ((n & 1) != 0) { bit $ea }
    .for (var i = 0; i < ((n & 1) != 0 ? n - 3 : n) / 2; i++) { nop }
}

* = $0c00
// 64 entries, 0..40 lines: a full bounce every 64 frames.
sine:
    .fill 64, round(20 + 20 * sin(toRadians(i * 360 / 64)))
hex:
    .text "0123456789ABCDEF"
banner:
    .text "FLD  N   NEXTBAD  MEASURED  GAPCYCLES   "  // 40 columns

* = $0900
start:
    sei
    lda #$7f
    sta $dc0d
    lda $dc0d

    lda #%10101010
    sta IDLE_BYTE            // the stripe the idle fetch will show
    lda #1
    sta RESULT               // pass until a frame proves otherwise
    lda #0
    sta frame

    ldx #0
!:  lda banner, x
    sta $0400, x             // row 0: labels
    lda #$20
    sta $0428, x             // row 1: cleared, the readout goes here
    inx
    cpx #40
    bne !-

    lda #<irq1
    sta $0314
    lda #>irq1
    sta $0315
    lda #$1b
    sta $d011
    lda #FLD_START - 5
    sta $d012
    lda #$01
    sta $d01a
    sta $d019
    cli

    jmp *

// X = byte, Y = screen column on row 1; two hex digits at Y and Y+1.
put_hex:
    stx tmp
    txa
    lsr
    lsr
    lsr
    lsr
    tax
    lda hex, x
    sta $0428, y
    lda tmp
    and #15
    tax
    lda hex, x
    sta $0429, y
    rts

// Double IRQ, as in stable-raster-irq.asm.
irq1:
    lda #<irq2
    sta $0314
    lda #>irq2
    sta $0315
    lda #FLD_START - 3
    sta $d012
    lda #$01
    sta $d019
    tsx
    stx saved_sp
    cli
    .for (var i = 0; i < 40; i++) { nop }

irq2:
    ldx saved_sp
    txs
    Delay(SYNC_PAD)
    lda $d012
    cmp $d012
    beq !+
!:
    cld                      // the handler adds; D is not cleared on entry
    // A known cycle of line FLD_START-3. Default YSCROLL back on, so the
    // frame's first natural badline is 51; DEN stays set through line $30.
    lda #$1b
    sta $d011

    // This frame's N from the sine table.
    ldx frame
    inx
    stx frame
    txa
    and #63
    tax
    lda sine, x
    sta fld_n
    clc
    adc #51
    sta expect_bad

    // Wait for line FLD_START, then start CIA2 timer A from $FFFF.
    lda #FLD_START
!:  cmp $d012
    bne !-
    lda #$ff
    sta $dd04
    sta $dd05
    lda #%00010001
    sta $dd0e                // force load, start, count phi2

    // The gap: on line L write YSCROLL = (L + 2) & 7. The value differs
    // from L & 7 (no badline now) and from (L + 1) & 7 (none before the
    // next write). The write may land anywhere in the line; the loop
    // polls $D012 for the line change, so it lands around cycle 10-20.
    ldx fld_n
    beq gap_done
    lda #FLD_START
    sta cur_line
gap:
    lda cur_line
    clc
    adc #2
    and #7
    ora #$18
    sta $d011
    inc cur_line
    lda cur_line
!:  cmp $d012
    bne !-
    dex
    bne gap
gap_done:
    lda #0
    sta $dd0e                // stop the timer; it is read after the measurement

    // Read back where the first badline lands: count 12-cycle iterations
    // per line; a line with a 40-43 cycle stall completes fewer than
    // three. Counting starts at a line boundary so that the first line
    // examined is a whole one. Up to 16 lines are examined.
    lda #0
    sta first_bad
    lda $d012
!:  cmp $d012
    beq !-
    lda $d012
    sta cur_line
    ldy #16
measure:
    ldx #0
!:  inx
    lda $d012
    cmp cur_line
    beq !-
    sta cur_line             // now on the next line; X counted the last one
    cpx #3
    bcs !+
    lda cur_line
    sec
    sbc #1
    sta first_bad            // the line just left was the badline
    jmp measured
!:  dey
    bne measure
measured:
    lda first_bad
    cmp expect_bad
    beq !+
    lda #2
    sta RESULT
!:
    // Elapsed = $FFFF - timer = timer EOR $FFFF; the timer is stopped, so
    // the two bytes are consistent.
    lda $dd04
    eor #$ff
    sta gap_lo
    lda $dd05
    eor #$ff
    sta gap_hi

    // The readout, on row 1: drawn from line 59+N, after these stores.
    ldx fld_n
    ldy #5
    jsr put_hex
    ldx expect_bad
    ldy #9
    jsr put_hex
    ldx first_bad
    ldy #18
    jsr put_hex
    ldx gap_hi
    ldy #28
    jsr put_hex
    ldx gap_lo
    ldy #30
    jsr put_hex

    lda #FLD_START - 5
    sta $d012
    lda #<irq1
    sta $0314
    lda #>irq1
    sta $0315
    lda #$01
    sta $d019
    pla
    tay
    pla
    tax
    pla
    rti

saved_sp: .byte 0
```

## Build

```bash
java -jar KickAss.jar fld.asm -o fld.prg
```

## Expected output

The BASIC screen, pushed down N lines, with a striped band above it where
the top of the screen used to be. Row 0 reads `FLD  N   NEXTBAD  MEASURED
GAPCYCLES` and row 1 holds the four hex values under those labels. The
BASIC banner rows below are the stock ones, moved down with everything
else; the last N lines of the screen are under the lower border, which
does not move.

Measured in the exit screenshots at 8,000,000 cycles (screenshot row =
raster line minus 16 on PAL, minus 28 on NTSC; the unshifted top text row
is screenshot row 35 on PAL and 23 on NTSC):

| Model | N shown | 51 + N | Measured first badline | Gap cycles shown | First text row | Shift |
|---|---|---|---|---|---|---|
| PAL | `$12` = 18 | `$45` = 69 | `$45` = 69 | `$046B` = 1,131 | 53 | 18 lines |
| NTSC | `$16` = 22 | `$49` = 73 | `$49` = 73 | `$058F` = 1,423 | 45 | 22 lines |

The shift in the picture equals the N on the readout row on both models,
and every gap row from the unshifted top (row 35 PAL, 23 NTSC) to the row
before the text is 160 black and 160 background pixels across x 32-351,
alternating from x = 32: the idle fetch of `%10101010`. `$02FF` read `01`
on both models over the whole run (traced with the `-moncommands` route in
`runtime/vice-reference.md`; two stores, the reset's clear and the
program's `01`, and no `02`). The two runs are mid-bounce because 8,000,000
cycles is a different frame count on the two models; the frame counter
runs at the frame rate, so any cycle count picks a deterministic N. Both
pictures are byte-identical across two runs.

1,131 cycles over 18 lines is 62.8 a line on PAL and 1,423 over 22 is
64.7 on NTSC: the loop holds the CPU for the whole of every gap line,
and the timer's start and stop land a few cycles apart in their lines,
because each follows a `$D012` poll whose exit cycle depends on the phase
it entered with. A build of this listing without the `cld` read 1,133 and
1,427 for the same N.

If the readout's MEASURED is eight more than NEXTBAD, the sync poll before
the count missed line 51 + N: something between the last YSCROLL write and
the poll ran past the end of line 50 + N. An earlier draft of this listing
read the CIA timer there, 46 cycles, and failed on 237 of 407 frames; it
now stops the timer with one store and reads it after the count. If the
screen does not move at all, or moves one line instead of N, while
MEASURED disagrees with NEXTBAD, the YSCROLL value written on line L
matched line L + 1 (see "Why this works").

Screenshots from the VICE runs this page describes: `screenshots/fld.png`
(PAL) and `screenshots/fld-ntsc.png`.

## Why this works

### The write and its value

A badline is a line in 48-247 whose low three bits equal YSCROLL, with DEN
seen set on line 48. The VIC tests that on every cycle of the line, and
a match that is still in force when the row fetch is due starts it; a
value that matches at the line's first cycle and is changed early enough
does not. The cycle at which the decision falls is not measured here;
`badline_synchronization` puts BA low at cycle 12 and the c-accesses at
15-54. The listing does not depend on it. On line L the loop writes
`(L + 2) & 7`: not `L & 7`, so this line does not become a badline after
the write, and not `(L + 1) & 7`, so the next line begins clean and its
own write can land anywhere in it. The loop polls `$D012` for the line
change and writes ten to twenty cycles into the line; no cycle counting
is needed, which is also why the same listing runs on the 65-cycle NTSC
line.

Measured for this page with the listing above rebuilt with `adc #1` in
place of `adc #2` (the value written on line L matches line L + 1 at its
first cycle), pinned PAL command, picture byte-identical across two
builds: the display did not move. Line 51 begins with YSCROLL 3 from the
default `$1B`, the loop's write on it lands too late to cancel the match,
and every later write makes the following line a badline, so no gap line
was skipped and the stripe never appeared. MEASURED disagreed with
NEXTBAD and `$02FF` went to `$02` within the first frames. An earlier
build of the same variant, without the `cld` and so writing two cycles
earlier in each line, moved the display one line: there the write on
line 51 landed in time and line 52 was the first badline. The shift is 0
or 1 by the cycle the line-51 write lands on, never N, and the readout
row was legible in the build that did not move. The double IRQ is kept
so that the loop starts on a known line; the per-line placement is
tolerant, the entry line is not.

After the last write, on line 49 + N, YSCROLL is `(51 + N) & 7`. Line
50 + N does not match, line 51 + N does, and the VIC fetches row 0 there.
The handler leaves YSCROLL alone for the rest of the frame so the
following rows keep their eight-line spacing; the next frame's entry on
line 47 writes `$1B` back before line 50. DEN is set in every value
written, so line 48's sample is never missed.

### The stripes

With no row fetched the VIC is in idle state and every g-access reads
`$3FFF` (bank 0). The byte is drawn as pixels, bit 1 in colour 0, across
the 320-pixel window on every gap line. `%10101010` gives alternating
black and background columns, which the measurement above counts. A stock
machine has zero there, and the gap would be plain blue and indistinguishable
from a blank row; the stripes show that the lines were badline-free. Clear the byte, or set it on purpose, in anything that opens
a gap or a border (`pitfalls/raster-and-badline.md`,
`idle_fetch_byte_shows_in_gaps`).

### Reading the first badline back

The count loop is twelve cycles an iteration (`inx`, `lda $D012`, `cmp`,
`beq`), so a 63-cycle line gives five or six and a 65-cycle line the
same, while a badline, with the CPU held from cycle 12 to 54, gives one
or two. Counting starts at a line boundary so that the first line
examined is a whole one. The first line under three is the first badline;
its number is stored, shown and compared with 51 + N. The gap timer is
CIA2 timer A, started from `$FFFF` on line 50 just before the first write
and stopped with one store when the loop ends; it is read after the count
so the reads cannot push the sync poll past line 50 + N.
