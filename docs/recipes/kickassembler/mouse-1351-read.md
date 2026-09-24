---
recipe: mouse-1351-read
toolchain: kickassembler
output_format: PRG
region: both
techniques: [mouse_1351_read]
file_formats: [PRG]
uses_registers: [D419, D41A, DC00, DC01, DC02, D012, D020, D021, DD04, DD05, DD0E]
uses_kernal: []
---

<!-- doc-type: recipe -->

# KickAssembler — Read a 1351 mouse once per frame, decode the 6-bit counter, and check the delta arithmetic

## Synopsis

Selects control port 1's pot lines through CIA1 port A bit 6, then for
250 frames waits for raster line 250 and reads the SID's POTX and POTY
registers once, shifting each right by one and keeping six bits, which
is the 1351's position counter with its noise bit dropped. It prints
the smallest and largest counter seen on each axis, reads the two mouse
buttons on the port's FIRE and UP lines, runs the signed modulo-64
delta arithmetic over a compiled-in table of ten counter pairs that
includes both wrap directions and both half-turn cases, and times one
call of the read routine with CIA2 timer A. It writes `$01` to `$02FF`
and turns the border green when every table row matches and the masked
counter never moved during the 250 frames, `$02` and red otherwise. The
technique is `mouse_1351_read` in `techniques/input.md`.

A headless VICE run cannot move the host mouse, so the counter sits at
one value and no movement delta is measured here. The delta arithmetic
is exercised on the synthetic table instead, and the page says which
numbers came from the run and which from the table.

## Source

```asm
// mouse-1351-read.asm
// Reads a Commodore 1351 mouse in proportional mode through the SID's
// POTX/POTY registers ($D419/$D41A) once per frame at a fixed raster line,
// decodes the 6-bit position counter in bits 1 to 6, tracks the smallest
// and largest counter seen over NFRAMES frames, reads the two buttons on
// the port's FIRE and UP lines, runs the signed modulo-64 delta arithmetic
// over a compiled-in table of synthetic counter pairs, times the per-frame
// read with a CIA2 timer, and reports a verdict at $02FF and in the border.
//
// The 1351 is on control port 1: CIA1 port A bit 6 selects that port's
// pots, and its switch lines are read on CIA1 port B ($DC01).
.encoding "screencode_upper"

.const SCREEN     = $0400
.const COLOUR     = $d800
.const RESULT     = $02ff
.const SEL_PORT1  = $40
.const NFRAMES    = 250         // frames sampled at rest
.const READ_LINE  = $fa         // raster line 250: below the text area, inside the frame
.const NTESTS     = 10          // rows in the synthetic delta table

.const zp_val     = $fb         // decimal printer's value
.const zp_row     = $fd         // screen pointer for the printers
.const zp_lbl     = $f7         // pointer into the label table
.const zp_min_x   = $f9
.const zp_max_x   = $fa
.const zp_min_y   = $f5
.const zp_max_y   = $f6
.const zp_frames  = $f4
.const zp_fail    = $f3

BasicUpstart2(start)

* = $0900 "code"

start:
    sei
    lda #$ff
    sta $dc02                   // port A all output: the pot select bits must reach the pins
    lda #SEL_PORT1
    sta $dc00                   // bit 6: control port 1's pots reach the SID
    lda #$00
    sta $d020
    sta $d021
    sta zp_fail
    jsr clear_screen
    jsr draw_labels

// --- part A: NFRAMES reads at rest, one per frame at READ_LINE ------------
// The select was written above; the first frame boundary is more than 512
// cycles away, so the first read already sees port 1's conversion.
    lda #$3f
    sta zp_min_x
    sta zp_min_y
    lda #$00
    sta zp_max_x
    sta zp_max_y
    lda #NFRAMES
    sta zp_frames
frameloop:
    jsr wait_read_line
    jsr read_mouse              // cur_x/cur_y = counters, dx/dy = deltas
    lda cur_x
    cmp zp_min_x
    bcs !+
    sta zp_min_x
!:  lda cur_x
    cmp zp_max_x
    bcc !+
    sta zp_max_x
!:  lda cur_y
    cmp zp_min_y
    bcs !+
    sta zp_min_y
!:  lda cur_y
    cmp zp_max_y
    bcc !+
    sta zp_max_y
!:  dec zp_frames
    bne frameloop

    lda zp_min_x
    ldy #5
    ldx #14
    jsr print_dec2
    lda zp_max_x
    ldy #5
    ldx #21
    jsr print_dec2
    lda zp_min_y
    ldy #6
    ldx #14
    jsr print_dec2
    lda zp_max_y
    ldy #6
    ldx #21
    jsr print_dec2

    lda zp_min_x
    cmp zp_max_x
    bne restfail
    lda zp_min_y
    cmp zp_max_y
    beq restok
restfail:
    inc zp_fail
restok:

// --- part B: the buttons, on port 1's switch lines ----------------------
    lda $dc00
    ldy #9
    ldx #5
    jsr print_hex
    lda $dc01
    sta btn
    ldy #9
    ldx #13
    jsr print_hex
    lda btn
    and #$10                    // bit 4, FIRE: the left button
    ldx #21
    jsr print_updown
    lda btn
    and #$01                    // bit 0, UP: the right button
    ldx #32
    jsr print_updown

// --- part C: the delta arithmetic on synthetic counter pairs -------------
    ldx #0
testloop:
    stx tidx
    lda test_prev,x
    sta prev_x
    lda test_cur,x
    sta cur_x
    jsr delta_x                 // A = signed delta of cur_x against prev_x
    sta got
    ldx tidx
    lda test_prev,x
    jsr test_row_y
    ldx #2
    jsr print_dec2
    ldx tidx
    lda test_cur,x
    jsr test_row_y
    ldx #5
    jsr print_dec2
    ldx tidx
    lda test_exp,x
    jsr test_row_y
    ldx #9
    jsr print_signed
    lda got
    jsr test_row_y
    ldx #14
    jsr print_signed
    ldx tidx
    lda got
    cmp test_exp,x
    beq testok
    inc zp_fail
    lda #<txt_bad
    ldy #>txt_bad
    bne testshow
testok:
    lda #<txt_ok
    ldy #>txt_ok
testshow:
    sta zp_lbl
    sty zp_lbl+1
    jsr test_row_y
    ldx #19
    jsr print_str
    ldx tidx
    inx
    cpx #NTESTS
    bne testloop

// --- part D: the cost of one read, measured with CIA2 timer A -----------
// Two timings: an empty section, then read_mouse. The difference is the
// routine's own cycles, with the start and stop stores cancelled out. Both
// run from READ_LINE, below the text area, so no badline steals cycles
// from the measurement; an earlier build that did not wait read 146.
// The routine costs 102 to 104 cycles by the sign of each axis's delta:
// a negative delta skips a branch and runs the sign-extend, one cycle
// more per axis. prev_x and prev_y are set to 40 against the resting 32
// before the timed call so both axes take the longer path; this is the
// worst case.
    lda #$00
    sta $dd0e                   // stop the timer while the latch is loaded
    lda #$ff
    sta $dd04
    sta $dd05
    jsr wait_read_line
    lda #$11                    // start, force load, continuous
    sta $dd0e
    lda #$00                    // stop: the timer read is the raw baseline
    sta $dd0e
    sec
    lda #$ff
    sbc $dd04
    sta base_lo
    lda #$ff
    sbc $dd05
    sta base_hi

    lda #$ff
    sta $dd04
    sta $dd05
    lda #40                     // force both deltas negative: worst path
    sta prev_x
    sta prev_y
    jsr wait_read_line
    lda #$11
    sta $dd0e
    jsr read_mouse
    lda #$00
    sta $dd0e
    sec
    lda #$ff
    sbc $dd04
    sta cost_lo
    lda #$ff
    sbc $dd05
    sta cost_hi

    sec
    lda cost_lo
    sbc base_lo
    sta zp_val
    lda cost_hi
    sbc base_hi
    sta zp_val+1
    ldy #23
    ldx #10
    jsr print_dec3

// --- verdict --------------------------------------------------------------
    lda zp_fail
    bne fail
    lda #$01
    sta RESULT
    lda #$05
    sta $d020
    lda #<txt_pass
    ldy #>txt_pass
    jmp verdict
fail:
    lda #$02
    sta RESULT
    lda #$02
    sta $d020
    lda #<txt_fail
    ldy #>txt_fail
verdict:
    sta zp_lbl
    sty zp_lbl+1
    ldy #23
    ldx #32
    jsr print_str
forever:
    jmp forever

// --- the read -------------------------------------------------------------
// read_mouse: one frame's read of both pots. The counter is bits 1 to 6 of
// the pot byte, so shift right once and keep six bits; bit 0 is noise and
// falls off the end. The delta is the difference modulo 64, read as signed:
// 0 to 31 is a move up, 32 to 63 is a move down (32 itself reads as -32).
read_mouse:
    lda $d419
    lsr
    and #$3f
    sta cur_x
    jsr delta_x
    sta dx
    lda cur_x
    sta prev_x
    lda $d41a
    lsr
    and #$3f
    sta cur_y
    sec
    sbc prev_y
    and #$3f
    cmp #$20
    bcc !+
    ora #$c0                    // sign-extend a 6-bit negative to 8 bits
!:  sta dy
    lda cur_y
    sta prev_y
    rts

// delta_x: A = (cur_x - prev_x) as a signed modulo-64 delta. X, Y preserved.
delta_x:
    lda cur_x
    sec
    sbc prev_x
    and #$3f
    cmp #$20
    bcc !+
    ora #$c0
!:  rts

// test_row_y: Y = 12 + tidx, the screen row of the current table entry.
// A and X are preserved.
test_row_y:
    pha
    lda tidx
    clc
    adc #12
    tay
    pla
    rts

// wait_read_line: spin until the raster reaches READ_LINE, having first
// left it, so consecutive calls land in consecutive frames.
wait_read_line:
    lda #READ_LINE
!:  cmp $d012
    beq !-
!:  cmp $d012
    bne !-
    rts

// --- printers -------------------------------------------------------------
// set_row: Y = row, X = column; zp_row = SCREEN + row * 40 + column.
set_row:
    lda #<SCREEN
    sta zp_row
    lda #>SCREEN
    sta zp_row+1
    tya
    beq set_row_col
set_row_next:
    lda zp_row
    clc
    adc #40
    sta zp_row
    bcc set_row_dey
    inc zp_row+1
set_row_dey:
    dey
    bne set_row_next
set_row_col:
    txa
    clc
    adc zp_row
    sta zp_row
    bcc set_row_done
    inc zp_row+1
set_row_done:
    rts

// print_hex: A = byte, row Y, column X.
print_hex:
    pha
    jsr set_row
    pla
    pha
    lsr
    lsr
    lsr
    lsr
    tax
    lda hexdigits,x
    ldy #0
    sta (zp_row),y
    pla
    and #$0f
    tax
    lda hexdigits,x
    iny
    sta (zp_row),y
    rts

// print_dec2: A = 0..99, row Y, column X: two digits, leading zero.
print_dec2:
    pha
    jsr set_row
    pla
    ldx #0
!:  cmp #10
    bcc !+
    sbc #10
    inx
    bne !-
!:  pha
    txa
    ora #$30
    ldy #0
    sta (zp_row),y
    pla
    ora #$30
    iny
    sta (zp_row),y
    rts

// print_signed: A = signed byte -99..99, row Y, column X: sign then two digits.
print_signed:
    pha
    jsr set_row
    pla
    bmi !+
    ldy #0
    pha
    lda #$2b                    // '+'
    sta (zp_row),y
    pla
    jmp !++
!:  eor #$ff
    clc
    adc #1
    pha
    lda #$2d                    // '-'
    ldy #0
    sta (zp_row),y
    pla
!:  inc zp_row
    bne !+
    inc zp_row+1
!:  ldx #0
!:  cmp #10
    bcc !+
    sbc #10
    inx
    bne !-
!:  pha
    txa
    ora #$30
    ldy #0
    sta (zp_row),y
    pla
    ora #$30
    iny
    sta (zp_row),y
    rts

// print_dec3: zp_val = 16-bit value 0..999, row Y, column X: three digits.
print_dec3:
    jsr set_row
    ldy #0
    ldx #0
!:  lda zp_val
    sec
    sbc #100
    sta zp_val
    lda zp_val+1
    sbc #0
    sta zp_val+1
    bmi !+
    inx
    bne !-
!:  lda zp_val
    clc
    adc #100
    sta zp_val
    txa
    ora #$30
    sta (zp_row),y
    iny
    lda zp_val
    ldx #0
!:  cmp #10
    bcc !+
    sbc #10
    inx
    bne !-
!:  pha
    txa
    ora #$30
    sta (zp_row),y
    iny
    pla
    ora #$30
    sta (zp_row),y
    rts

// print_updown: A = masked switch bit, column X, on row 9: "UP" if the
// line reads high (not pressed), "DOWN" if it reads low.
print_updown:
    cmp #0
    beq updown_low
    lda #<txt_up
    ldy #>txt_up
    bne updown_show
updown_low:
    lda #<txt_down
    ldy #>txt_down
updown_show:
    sta zp_lbl
    sty zp_lbl+1
    ldy #9
    // falls into print_str

// print_str: zp_lbl -> zero-terminated screen-code text, row Y, column X.
print_str:
    jsr set_row
    ldy #0
!:  lda (zp_lbl),y
    beq !+
    sta (zp_row),y
    iny
    bne !-
!:  rts

clear_screen:
    ldx #0
    lda #$20
!:  sta SCREEN,x
    sta SCREEN+$100,x
    sta SCREEN+$200,x
    sta SCREEN+$300,x
    inx
    bne !-
    ldx #0
    lda #$0e                    // light blue ink
!:  sta COLOUR,x
    sta COLOUR+$100,x
    sta COLOUR+$200,x
    sta COLOUR+$300,x
    inx
    bne !-
    rts

// draw_labels: entries of row, column, text, 0; the list ends with row $FF.
draw_labels:
    lda #<labels
    sta zp_lbl
    lda #>labels
    sta zp_lbl+1
labels_next:
    ldy #0
    lda (zp_lbl),y
    cmp #$ff
    beq labels_done
    pha
    iny
    lda (zp_lbl),y
    tax
    pla
    tay
    jsr set_row
    lda zp_lbl
    clc
    adc #2
    sta zp_lbl
    bcc labels_text
    inc zp_lbl+1
labels_text:
    ldy #0
labels_char:
    lda (zp_lbl),y
    beq labels_skip
    sta (zp_row),y
    iny
    bne labels_char
labels_skip:
    tya                         // Y = text length; step past it and its zero
    sec
    adc zp_lbl
    sta zp_lbl
    bcc labels_next
    inc zp_lbl+1
    jmp labels_next
labels_done:
    rts

// --- data -----------------------------------------------------------------
hexdigits:  .text "0123456789ABCDEF"
txt_ok:     .text "OK"
            .byte 0
txt_bad:    .text "BAD"
            .byte 0
txt_up:     .text "UP  "
            .byte 0
txt_down:   .text "DOWN"
            .byte 0
txt_pass:   .text "PASS"
            .byte 0
txt_fail:   .text "FAIL"
            .byte 0

// The synthetic table: previous counter, current counter, expected delta.
// Rows 2 and 3 cross the 63/0 wrap; rows 7 and 8 are the two ambiguous
// half-turn cases, which this convention reads as -32.
test_prev:  .byte 32, 32, 63,  0, 32, 32, 10, 10, 40, 50
test_cur:   .byte 33, 31,  0, 63, 40, 25, 41, 42,  8, 20
test_exp:   .byte  1, -1,  1, -1,  8, -7, 31, -32, -32, -30

labels:
    .byte 0, 0
    .text "1351 MOUSE READ  POTX/POTY 6-BIT COUNTER"
    .byte 0
    .byte 2, 0
    .text "PORT 1 SELECTED (DC00 BIT 6), IRQ OFF"
    .byte 0
    .byte 3, 0
    .text "250 FRAMES, ONE READ AT RASTER LINE 250"
    .byte 0
    .byte 5, 0
    .text "X COUNTER MIN=   MAX=    (D419 >> 1)"
    .byte 0
    .byte 6, 0
    .text "Y COUNTER MIN=   MAX=    (D41A >> 1)"
    .byte 0
    .byte 7, 0
    .text "BITS 1-6 ONLY; BIT 0 IS NOISE, DROPPED"
    .byte 0
    .byte 9, 0
    .text "DC00=   DC01=   LEFT=     RIGHT="
    .byte 0
    .byte 11, 0
    .text "  PREV CUR EXP  GOT  (SIGNED MOD 64)"
    .byte 0
    .byte 23, 0
    .text "READ COST     CYCLES    RESULT:"
    .byte 0
    .byte $ff

btn:        .byte 0
tidx:       .byte 0
got:        .byte 0
cur_x:      .byte 0
cur_y:      .byte 0
prev_x:     .byte 0
prev_y:     .byte 0
dx:         .byte 0
dy:         .byte 0
base_lo:    .byte 0
base_hi:    .byte 0
cost_lo:    .byte 0
cost_hi:    .byte 0
```

## Build

```bash
java -jar $KICKASS_JAR mouse-1351-read.asm -o mouse-1351-read.prg
```

KickAssembler 5.25 produces a 1,604-byte PRG; the code segment runs
`$0900` to `$0E42`.

Pinned VICE run (both models, `docs/recipes/runs.json`):

```bash
GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas \
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 \
      -limitcycles 8000000 -controlport1device 3 -seed 1 \
      -exitscreenshot mouse-1351-read.png -autostart mouse-1351-read.prg
```

Add `-model ntsc` for the second picture. `-controlport1device 3` is
VICE's 1351 mouse on control port 1 (the number is from `x64sc -help`,
VICE 3.10). Nothing is attached to port 2. `-seed 1` fixes VICE's
random number generator, which adds the bit-0 noise to every pot read
(`makepotval` in `src/sid/sid.c`) and is otherwise seeded from the wall
clock. The listing drops bit 0, so the picture was the same without it;
the seed was added after the same noise flaked `paddle-read`'s pin, and
the pinned picture is unchanged with it (measured in VICE x64sc 3.10).

## Expected output

Green border, black background, light blue text. The screen is:

```text
row  0  1351 MOUSE READ  POTX/POTY 6-BIT COUNTER
row  2  PORT 1 SELECTED (DC00 BIT 6), IRQ OFF
row  3  250 FRAMES, ONE READ AT RASTER LINE 250
row  5  X COUNTER MIN=32 MAX=32  (D419 >> 1)
row  6  Y COUNTER MIN=32 MAX=32  (D41A >> 1)
row  7  BITS 1-6 ONLY; BIT 0 IS NOISE, DROPPED
row  9  DC00=40 DC01=FF LEFT=UP   RIGHT=UP
row 11    PREV CUR EXP  GOT  (SIGNED MOD 64)
row 12    32 33  +01  +01  OK
row 13    32 31  -01  -01  OK
row 14    63 00  +01  +01  OK
row 15    00 63  -01  -01  OK
row 16    32 40  +08  +08  OK
row 17    32 25  -07  -07  OK
row 18    10 41  +31  +31  OK
row 19    10 42  -32  -32  OK
row 20    40 08  -32  -32  OK
row 21    50 20  -30  -30  OK
row 23  READ COST 104 CYCLES    RESULT: PASS
```

`recipes/kickassembler/screenshots/mouse-1351-read.png` (PAL, 384 by
272) and `mouse-1351-read-ntsc.png` (NTSC, 384 by 247) were each
produced twice by the pinned command with identical bytes, and decoded
by matching every 8 by 8 cell against `chargen-901225-01.bin` (measured
in VICE x64sc 3.10, rung 1). Every row is the same on both models.

What each line shows:

- Rows 5 and 6: over 250 frames the masked counter on each axis was 32
  on every read, on both models. The raw byte is `$40` or `$41`: a
  diagnostic build of this listing that also counted the raw bit 0 saw
  it set in 128, 112 and 112 of the 250 frames across three PAL runs,
  and the raw X byte change between one frame and the next 112 and 134
  times. Bit 0 is noise, and it is noise from frame to frame within a
  run, not just between runs; the shift drops it, and the picture never
  shows it, which is why two runs match. The value 32 is VICE's resting
  counter and says nothing about where a real mouse's counter starts.
- Row 9: `$DC00` reads back `$40`, the select bit on an output pin.
  `$DC01` is port 1's switch byte and reads `$FF`: bit 4 (FIRE) is the
  left button and bit 0 (UP) is the right button, both high, neither
  pressed. That the buttons ride those two lines is from the 1351's
  documentation and is not measured here, since a headless run cannot
  press one.
- Rows 12 to 21: the delta table. Each row is a previous counter, a
  current counter, the expected delta and the delta `delta_x` computed;
  `OK` when they match. Rows 14 and 15 cross the 63 to 0 wrap in each
  direction and come out as one step. Rows 19 and 20 are the two
  half-turn cases, a difference of exactly 32 modulo 64, which this
  convention reads as -32; a program that wants +32 there changes the
  compare from `#$20` to `#$21`. The table is compiled in, so these
  rows would be the same with no mouse attached.
- Row 23: one call of `read_mouse`, both axes with their deltas,
  measured as the difference between two CIA2 timer A readings, one
  around an empty section and one around the call, both started on
  raster line 250. 104 cycles including the `jsr` and `rts`. The cost
  depends on the sign of each axis's delta: a delta of 0 to +31 takes
  the `bcc` (3 cycles) and a negative delta falls through it and runs
  the `ora` (2 plus 2), one cycle more per axis. The instruction count
  is 102 with both deltas non-negative, 103 with one negative and 104
  with both negative; the listing sets `prev_x` and `prev_y` to 40
  against the resting counter of 32 just before the timed call, so the
  figure is the worst case. An earlier build did not wait for line 250
  before timing and read 146: the extra 42 were a badline inside the
  measurement.

The pass needs all ten table rows to match and the minimum and maximum
counter on each axis to be equal.

## Why this works

The select is a plain write of `$40` to `$DC00` with the direction
register at `$FF`, the same select `paddle-read.md` uses for port 1,
and after it the SID converts port 1's pot voltages every 512 cycles
(measured in `paddle-read.md`). `$40` also drives keyboard columns 0
to 5 and 7 low, which is harmless here with interrupts off and no key
held; a game that reads the keyboard too selects with `$7F`, as the
technique page explains. The 1351 in proportional mode drives the
port's two pot lines itself: each pot register, once settled, holds the
mouse's own 6-bit position counter in bits 1 to 6, with bit 0 carrying
no information. `lsr` then `and #$3f` is the whole decode.

Position is only useful as a difference. `cur - prev` modulo 64 is a
number 0 to 63; the routine reads 0 to 31 as a move in the positive
direction and 32 to 63 as a move in the negative direction, and turns
the second half into a signed byte by setting the top two bits, which
is what `ora #$c0` does after `and #$3f`. That reading is correct as
long as the counter moves fewer than 32 steps between two reads, and
the frame is chosen as the read interval on that ground; how far a real
mouse moves in one frame is not measured here.

The read is taken at a fixed raster line with interrupts off. The SID
holds the last finished conversion, so the read itself can fall
anywhere; what must not happen is a change of the select bits in the
512 cycles before it. The KERNAL's SCNKEY writes column patterns to
`$DC00` from the jiffy IRQ and changes bit 6 as it goes, so a program
that keeps the KERNAL IRQ either brackets its read with `SEI` and `CLI`
far enough after the scan, or reads on a raster line the scan never
reaches; `paddle-read.md` measures what happens otherwise. The cost
measurement is gated to the same line for a different reason, which
row 23's history shows: a badline in the window adds its stolen cycles
to the figure.
