---
recipe: light-pen-read
toolchain: kickassembler
output_format: PRG
region: both
techniques: [light_pen_read]
file_formats: [PRG]
uses_registers: [D013, D014, D019, D01A, D011, D012, DC00, DC01, DC0D, DD04, DD05, DD0E, D020, D021]
uses_kernal: []
---

<!-- doc-type: recipe -->

# KickAssembler — Read the light pen latch on control port 1, count its interrupts, and convert the latch to a text cell

## Synopsis

Enables the VIC's light pen interrupt (`$D01A` bit 3), reads the latched
`$D013` and `$D014` once per frame for 300 frames, counts the pen
interrupts and how often the latch moved, and prints the port's switch
byte and the interrupt flag register at the end. It then runs eight
synthetic latch values through the pen-delay correction and the
two-pixel-unit conversion to a text column and row, and times the
interrupt handler with a CIA2 timer. It writes `$01` to `$02FF` and turns
the border green when every synthetic row matches and the register
readings are consistent, `$02` and red otherwise. The technique is
`light_pen_read` in `techniques/input.md`.

A headless VICE run has no host mouse, and VICE's light pen follows the
host mouse, so the pen never triggers here: the run measures the resting
registers, the count of zero and the flag, and says so. The handler's
cost is measured by entering the same handler from a raster interrupt,
because nothing in software can pull the pen line low.

## Source

```asm
// light-pen-read.asm
// Enables the VIC's light pen interrupt, records the latched LPX/LPY
// ($D013/$D014) once per frame over NFRAMES frames, counts the pen
// interrupts, runs a table of synthetic latch values through the
// pen-delay correction and the two-pixel-unit conversion to a text cell,
// times the interrupt handler with a CIA2 timer, and reports a verdict at
// $02FF and in the border colour.
//
// The pen is on control port 1: its trigger is the port's FIRE line, CIA1
// PB4, which is also the VIC's LP input. The KERNAL IRQ is turned off so
// the keyboard scan cannot drive $DC00 while the port is read.
.encoding "screencode_upper"

.const SCREEN     = $0400
.const RESULT     = $02ff
.const NFRAMES    = 300         // frames sampled at rest
.const READ_LINE  = $fa         // raster line 250: below the text area, inside both models' frames
.const PEN_DELAY  = 0           // the pen's own latch delay in LPX units; per pen, 0 here
.const NTESTS     = 8           // rows in the synthetic table
.const COST_LINE  = 25          // the raster line that drives the handler for the cost measurement
.const OFF        = $ff         // "outside the text area" in the expected columns

.const zp_val     = $fb         // 16-bit value for the decimal printer
.const zp_row     = $fd         // screen pointer for the printers
.const zp_lbl     = $f7         // pointer into the label table
.const zp_fail    = $f9
.const zp_tmp     = $fa

BasicUpstart2(start)

* = $0900 "code"

start:
    sei
    lda #$7f
    sta $dc0d                   // CIA1 interrupts off: no keyboard scan on $DC00
    lda $dc0d                   // drop a pending one
    lda #$00
    sta $d020
    sta $d021
    sta zp_fail
    jsr clear_screen
    jsr draw_labels

    lda #<irq
    sta $0314
    lda #>irq
    sta $0315
    lda #$ff
    sta $d019                   // acknowledge anything pending
    lda #$08
    sta $d01a                   // ELP only: the light pen is the one VIC source
    cli

// --- part A: NFRAMES frames at rest, the latch read once per frame ------
    lda $d013
    sta first_x
    sta min_x
    sta max_x
    sta last_x
    lda $d014
    sta first_y
    sta min_y
    sta max_y
    sta last_y
    lda #0
    sta chg_x
    sta chg_y
    sta frames
    sta frames+1
frameloop:
    jsr wait_read_line
    lda $d013
    cmp last_x
    beq !+
    inc chg_x
!:  sta last_x
    cmp min_x
    bcs !+
    sta min_x
!:  lda last_x
    cmp max_x
    bcc !+
    sta max_x
!:  lda $d014
    cmp last_y
    beq !+
    inc chg_y
!:  sta last_y
    cmp min_y
    bcs !+
    sta min_y
!:  lda last_y
    cmp max_y
    bcc !+
    sta max_y
!:  inc frames
    bne !+
    inc frames+1
!:  lda frames
    cmp #<NFRAMES
    bne frameloop
    lda frames+1
    cmp #>NFRAMES
    bne frameloop

    sei
    lda #$00
    sta $d01a                   // pen IRQ off; the count is final
    lda irq_count
    sta pen_irqs
    lda irq_count+1
    sta pen_irqs+1
    lda $d019
    sta d019_end                // bit 3 set here means a trigger since the last acknowledge

    lda #<NFRAMES
    sta zp_val
    lda #>NFRAMES
    sta zp_val+1
    ldy #2
    ldx #19
    jsr print_dec5
    lda pen_irqs
    sta zp_val
    lda pen_irqs+1
    sta zp_val+1
    ldy #3
    ldx #19
    jsr print_dec5
    lda first_x
    ldy #4
    ldx #19
    jsr print_hex
    lda min_x
    ldy #4
    ldx #23
    jsr print_hex
    lda max_x
    ldy #4
    ldx #27
    jsr print_hex
    lda first_y
    ldy #5
    ldx #19
    jsr print_hex
    lda min_y
    ldy #5
    ldx #23
    jsr print_hex
    lda max_y
    ldy #5
    ldx #27
    jsr print_hex
    lda chg_x
    ldy #6
    ldx #19
    jsr print_hex
    lda chg_y
    ldy #6
    ldx #27
    jsr print_hex
    lda d019_end
    ldy #7
    ldx #6
    jsr print_hex
    lda $dc01
    ldy #7
    ldx #19
    jsr print_hex
    lda $dc00
    ldy #7
    ldx #32
    jsr print_hex

// the consistency rule: the latch does not move at rest, and the pen
// interrupt count is either the frame count (one trigger a frame, within
// one) or zero with the flag clear (no trigger at all). Anything between
// is a pen that triggers on some frames only, and the rule fails.
    lda min_x
    cmp max_x
    bne rest_bad
    lda min_y
    cmp max_y
    bne rest_bad
    lda pen_irqs+1
    ora pen_irqs
    bne count_some
    lda d019_end
    and #$08
    beq rest_ok                 // zero triggers and no flag: consistent
    bne rest_bad
count_some:
    sec
    lda #<NFRAMES
    sbc pen_irqs
    sta zp_tmp
    lda #>NFRAMES
    sbc pen_irqs+1
    bne rest_bad                // more than 255 apart, or the count exceeds the frames
    lda zp_tmp
    cmp #2
    bcc rest_ok                 // 0 or 1 frames short: one trigger a frame
rest_bad:
    inc zp_fail
rest_ok:

// --- part B: synthetic latch values through the conversion ---------------
    ldx #0
testloop:
    stx tidx
    lda test_lpx,x
    jsr test_row_y
    ldx #2
    jsr print_hex
    ldx tidx
    lda test_lpy,x
    jsr test_row_y
    ldx #7
    jsr print_hex
    ldx tidx
    lda test_lpx,x
    jsr lpx_to_col              // A = column or OFF
    sta got_col
    jsr test_row_y
    ldx #12
    jsr print_cell
    ldx tidx
    lda test_lpy,x
    jsr lpy_to_row              // A = row or OFF
    sta got_row
    jsr test_row_y
    ldx #16
    jsr print_cell
    ldx tidx
    lda exp_col,x
    jsr test_row_y
    ldx #21
    jsr print_cell
    ldx tidx
    lda exp_row,x
    jsr test_row_y
    ldx #25
    jsr print_cell
    ldx tidx
    lda got_col
    cmp exp_col,x
    bne test_bad
    lda got_row
    cmp exp_row,x
    bne test_bad
    lda #<txt_ok
    ldy #>txt_ok
    bne test_show
test_bad:
    inc zp_fail
    lda #<txt_bad
    ldy #>txt_bad
test_show:
    sta zp_lbl
    sty zp_lbl+1
    jsr test_row_y
    ldx #29
    jsr print_str
    ldx tidx
    inx
    cpx #NTESTS
    beq tests_done
    jmp testloop
tests_done:

// --- part C: the handler's cost, measured with CIA2 timer A --------------
// The pen line cannot be pulsed from software, so the same handler is
// entered from a raster interrupt on COST_LINE instead: the entry, the
// KERNAL dispatch, the handler's reads and stores and the exit through
// $EA81 are the same instructions whichever $D019 bit set. A fixed loop is
// timed twice from raster line 5 in the top border, where no badline can
// stretch it: once with no interrupt armed, once with the raster interrupt
// armed inside the loop's span. The difference is the interrupt's cost.
    lda #$00
    sta $dd0e
    lda #$ff
    sta $dd04
    sta $dd05
    lda #5
    jsr wait_line
    lda #$11                    // start, force load, continuous
    sta $dd0e
    jsr fixed_loop
    lda #$00
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
    lda #COST_LINE
    sta $d012
    lda $d011
    and #$7f
    sta $d011
    lda #$ff
    sta $d019
    lda #$01
    sta $d01a                   // ERST: the raster interrupt drives the handler once
    lda #5
    jsr wait_line
    cli
    lda #$11
    sta $dd0e
    jsr fixed_loop
    lda #$00
    sta $dd0e
    sei
    lda #$00
    sta $d01a
    sec
    lda #$ff
    sbc $dd04
    sta cost_lo
    lda #$ff
    sbc $dd05
    sta cost_hi

    lda base_lo
    sta zp_val
    lda base_hi
    sta zp_val+1
    ldy #21
    ldx #9
    jsr print_dec5
    lda cost_lo
    sta zp_val
    lda cost_hi
    sta zp_val+1
    ldy #21
    ldx #24
    jsr print_dec5
    sec
    lda cost_lo
    sbc base_lo
    sta zp_val
    lda cost_hi
    sbc base_hi
    sta zp_val+1
    ldy #20
    ldx #13
    jsr print_dec5

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
    ldx #8
    jsr print_str
forever:
    jmp forever

// --- the handler ------------------------------------------------------------
// Entered through $0314 after the KERNAL's $FF48 has pushed A, X and Y.
// Acknowledge every set bit by writing $D019's own value back, copy the
// latch, count, and leave through the KERNAL's bare exit.
irq:
    lda $d019
    sta $d019
    lda $d013
    sta pen_x
    lda $d014
    sta pen_y
    inc irq_count
    bne !+
    inc irq_count+1
!:  jmp $ea81

// --- the conversion ---------------------------------------------------------
// lpx_to_col: A = LPX. Subtract the pen's delay, then the latch is X/2 and
// the text area starts at X = 24, so column = (LPX - 12) / 4. Below 12 or
// at 40 or more the point is outside the text area and OFF comes back.
lpx_to_col:
    sec
    sbc #PEN_DELAY
    bcc lpx_off
    sec
    sbc #12
    bcc lpx_off
    lsr
    lsr
    cmp #40
    bcs lpx_off
    rts
lpx_off:
    lda #OFF
    rts

// lpy_to_row: A = LPY, the raster line. The text area is lines 51 to 250,
// so row = (LPY - 51) / 8; outside that range OFF comes back.
lpy_to_row:
    sec
    sbc #51
    bcc lpy_off
    cmp #200
    bcs lpy_off
    lsr
    lsr
    lsr
    rts
lpy_off:
    lda #OFF
    rts

// fixed_loop: a loop of fixed length, long enough to span COST_LINE from
// line 5 on both models. Its own length cancels out of the measurement.
fixed_loop:
    ldx #2
    ldy #0
!:  dey
    bne !-
    dex
    bne !-
    rts

// test_row_y: Y = 11 + tidx, the screen row of the current table entry.
test_row_y:
    pha
    lda tidx
    clc
    adc #11
    tay
    pla
    rts

// wait_read_line: spin until the raster reaches READ_LINE, having first
// left it, so consecutive calls land in consecutive frames.
wait_read_line:
    lda #READ_LINE
wait_line:
!:  cmp $d012
    beq !-
!:  cmp $d012
    bne !-
    rts

// --- printers -------------------------------------------------------------
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

// print_cell: A = 0..99 or OFF, row Y, column X: two digits, or "--".
print_cell:
    cmp #OFF
    bne print_dec2
    jsr set_row
    lda #$2d
    ldy #0
    sta (zp_row),y
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

// print_dec5: zp_val = 16-bit value, row Y, column X: five digits.
print_dec5:
    jsr set_row
    ldy #0
    ldx #0
dec5_digit:
    lda #$30
    sta digit
dec5_sub:
    sec
    lda zp_val
    sbc pow10_lo,x
    pha
    lda zp_val+1
    sbc pow10_hi,x
    bcc dec5_next
    sta zp_val+1
    pla
    sta zp_val
    inc digit
    jmp dec5_sub
dec5_next:
    pla
    lda digit
    sta (zp_row),y
    iny
    inx
    cpx #5
    bne dec5_digit
    rts

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

// draw_labels: walk the label table: row, column, text, 0; a row of $ff ends it.
draw_labels:
    lda #<labels
    sta zp_lbl
    lda #>labels
    sta zp_lbl+1
label_next:
    ldy #0
    lda (zp_lbl),y
    cmp #$ff
    beq label_done
    iny
    lda (zp_lbl),y
    tax                         // X = column
    dey
    lda (zp_lbl),y
    tay                         // Y = row
    lda zp_lbl
    clc
    adc #2
    sta zp_lbl
    bcc !+
    inc zp_lbl+1
!:  jsr print_str
    ldy #0
!:  lda (zp_lbl),y
    beq !+
    iny
    bne !-
!:  iny
    tya
    clc
    adc zp_lbl
    sta zp_lbl
    bcc label_next
    inc zp_lbl+1
    jmp label_next
label_done:
    rts

clear_screen:
    ldx #0
    lda #$20
!:  sta SCREEN,x
    sta SCREEN+$100,x
    sta SCREEN+$200,x
    sta SCREEN+$300,x
    inx
    bne !-
    rts

// --- data -----------------------------------------------------------------
labels:
    .byte 0, 0
    .text "LIGHT PEN READ, CONTROL PORT 1"
    .byte 0
    .byte 2, 0
    .text "FRAMES SAMPLED"
    .byte 0
    .byte 3, 0
    .text "PEN IRQS COUNTED"
    .byte 0
    .byte 4, 0
    .text "LPX FIRST MIN MAX"
    .byte 0
    .byte 5, 0
    .text "LPY FIRST MIN MAX"
    .byte 0
    .byte 6, 0
    .text "FRAMES LPX MOVED"
    .byte 0
    .byte 6, 23
    .text "LPY"
    .byte 0
    .byte 7, 0
    .text "$D019"
    .byte 0
    .byte 7, 13
    .text "$DC01"
    .byte 0
    .byte 7, 26
    .text "$DC00"
    .byte 0
    .byte 9, 0
    .text "SYNTHETIC LATCH TO TEXT CELL"
    .byte 0
    .byte 10, 0
    .text "  LPX  LPY  COL ROW  EXPECTED"
    .byte 0
    .byte 20, 0
    .text "IRQ COST"
    .byte 0
    .byte 20, 19
    .text "CYCLES VIA RASTER"
    .byte 0
    .byte 21, 0
    .text "BASELINE"
    .byte 0
    .byte 21, 15
    .text "WITH IRQ"
    .byte 0
    .byte 23, 0
    .text "RESULT"
    .byte 0
    .byte $ff

txt_ok:    .text "OK"
           .byte 0
txt_bad:   .text "BAD"
           .byte 0
txt_pass:  .text "PASS"
           .byte 0
txt_fail:  .text "FAIL"
           .byte 0
hexdigits: .text "0123456789ABCDEF"
pow10_lo:  .byte <10000, <1000, <100, <10, <1
pow10_hi:  .byte >10000, >1000, >100, >10, >1

// the synthetic table: latch values and the cell each should land in.
// $0C,$33 is the top-left corner of the text area; $AB,$FA the bottom-right;
// $AC,$FB one step past it; $0B,$32 one step before it; $00,$00 the value a
// pen that never triggered leaves in the registers.
test_lpx:  .byte $0c, $0f, $10, $5c, $ab, $ac, $0b, $00
test_lpy:  .byte $33, $3a, $3b, $95, $fa, $fb, $32, $00
exp_col:   .byte   0,   0,   1,  20,  39, OFF, OFF, OFF
exp_row:   .byte   0,   0,   1,  12,  24, OFF, OFF, OFF

digit:     .byte 0
tidx:      .byte 0
got_col:   .byte 0
got_row:   .byte 0
irq_count: .word 0
pen_irqs:  .word 0
frames:    .word 0
pen_x:     .byte 0
pen_y:     .byte 0
first_x:   .byte 0
min_x:     .byte 0
max_x:     .byte 0
last_x:    .byte 0
first_y:   .byte 0
min_y:     .byte 0
max_y:     .byte 0
last_y:    .byte 0
chg_x:     .byte 0
chg_y:     .byte 0
d019_end:  .byte 0
base_lo:   .byte 0
base_hi:   .byte 0
cost_lo:   .byte 0
cost_hi:   .byte 0
```

## Build

```bash
java -jar $KICKASS_JAR light-pen-read.asm -o light-pen-read.prg
```

KickAssembler 5.25 produces a 1,785-byte PRG; the code segment runs
`$0900` to `$0EF7`.

Pinned VICE run (both models, `docs/recipes/runs.json`):

```bash
GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas \
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 \
      -limitcycles 12000000 -controlport1device 11 \
      -exitscreenshot light-pen-read.png -autostart light-pen-read.prg
```

Add `-model ntsc` for the second picture. `-controlport1device 11` is
VICE's "Light Pen (up trigger)" on control port 1; `x64sc -help` (VICE
3.10) lists six pen and gun devices for port 1, numbers 11 to 16, and
none for port 2. Nothing is attached to port 2.

## Expected output

Green border, black background, light blue text. The screen is:

```text
row  0  LIGHT PEN READ, CONTROL PORT 1
row  2  FRAMES SAMPLED     00300
row  3  PEN IRQS COUNTED   00000
row  4  LPX FIRST MIN MAX  00  00  00
row  5  LPY FIRST MIN MAX  00  00  00
row  6  FRAMES LPX MOVED   00  LPY 00
row  7  $D019 71     $DC01 FF     $DC00 7F
row  9  SYNTHETIC LATCH TO TEXT CELL
row 10    LPX  LPY  COL ROW  EXPECTED
row 11    0C   33   00  00   00  00  OK
row 12    0F   3A   00  00   00  00  OK
row 13    10   3B   01  01   01  01  OK
row 14    5C   95   20  12   20  12  OK
row 15    AB   FA   39  24   39  24  OK
row 16    AC   FB   --  --   --  --  OK
row 17    0B   32   --  --   --  --  OK
row 18    00   00   --  --   --  --  OK
row 20  IRQ COST     00094 CYCLES VIA RASTER
row 21  BASELINE 02588 WITH IRQ 02682
row 23  RESULT  PASS
```

`recipes/kickassembler/screenshots/light-pen-read.png` (PAL, 384 by
272) and `light-pen-read-ntsc.png` (NTSC, 384 by 247) were each produced
twice by the pinned command with identical bytes, and decoded by
matching every 8 by 8 cell against `chargen-901225-01.bin` (measured in
VICE x64sc 3.10, rung 1). Every row is the same on both models except
row 7, where NTSC reads `$D019 70`.

What each line shows:

- Rows 3 to 6: over 300 frames the pen interrupt fired zero times and
  `$D013` and `$D014` read `$00` on every frame, first, lowest and
  highest, on both models. VICE's light pen takes its position from the
  host mouse, and a headless run has none to move, so the emulated pen
  never triggers. The same zeros came from device 11, the Datel pen
  (13), the Magnum Light Phaser (14) and the Inkwell pen (16) in a
  diagnostic build, PAL and NTSC. What a triggering pen latches, and the
  spread of the latch from frame to frame, is not measured here.
- Row 7: `$D019` reads `$71` on PAL and `$70` on NTSC after the pen
  interrupt was disabled. Bit 3, the pen flag, is clear on both: no
  trigger happened since the handler's last acknowledge, which agrees
  with the count. Bit 0 is the raster flag; it reads set on PAL and
  clear on NTSC in these runs, nothing in this program arms it before
  that read, and why the two models differ is not established here.
  Bits 4 to 6 are unused and read as ones. `$DC01` is port 1's
  switch byte and reads `$FF`: bit 4, FIRE, is the pen's trigger line
  and is high, not pressed. `$DC00` reads `$7F`, the column pattern the
  KERNAL's last scan left before the CIA1 interrupt was turned off.
- Rows 11 to 18: the synthetic table, compiled in, so these rows would
  be the same with no pen attached. Each row is an LPX and LPY value,
  the column and row `lpx_to_col` and `lpy_to_row` computed, the
  expected pair, and `OK` when they match. `--` is outside the text
  area. Rows 11 and 15 are the two corners of the 40 by 25 area; rows 16
  and 17 are one step outside each; row 18 is what a pen that never
  triggered leaves, and it lands outside, so a program that converts
  blindly still draws nothing.
- Rows 20 and 21: the interrupt's whole cost, 94 cycles on both models,
  as the difference between two CIA2 timer A readings around the same
  fixed loop started on raster line 5, once with no interrupt armed
  (2,588) and once with a raster interrupt on line 25 entering the same
  handler (2,682). The figure matches the instruction arithmetic: 7 for
  the interrupt sequence, 29 for the KERNAL's dispatcher from `$FF48`
  to the `$0314` vector, 36 for the handler's nine instructions and 22
  for the exit through `$EA81` (rung 3, agreeing with the rung 1
  measurement). The loop runs in the top border, so no badline is inside
  either window.

The pass needs all eight table rows to match and the consistency rule to
hold: the lowest and highest latch on each axis are equal, and the pen
interrupt count is either the frame count within one, or zero with bit 3
of `$D019` clear. A count between those, a pen that triggers on some
frames only, fails it, and so does a latch that moved.

The trigger could not be driven by another route. VICE's joystick
autofire on port 1 (`-joystick1autofire -joystick1autofiremode 1`) pulls
the same FIRE line, but it starts at power-up: the KERNAL's keyboard scan
reads PB4 low as a key in matrix row 4, the autostart's typed `RUN` never
arrives, and the screen fills with `>` characters at 50 presses a second
and shows one at 1 per second. The program did not run in either case,
so whether VICE latches the beam position for a joystick fire press is
not measured here.

## Why this works

The VIC latches its horizontal counter, divided by two, into `$D013` and
the low eight bits of its raster counter into `$D014` when the LP pin
goes low, and sets bit 3 of `$D019`; with bit 3 of `$D01A` set that
raises an interrupt. The LP pin is CIA1 PB4, control port 1's FIRE line,
which is why the pen goes in port 1 and why a joystick fire press there
latches a position too. The latch takes the first edge of a frame only
and is reset in the vertical blank, so one read per frame sees
everything there is (`hardware/vic-ii-reference.md`, "Light pen
latch"). The handler here acknowledges by writing `$D019`'s own value
back, which clears every bit that was set and nothing else, copies the
two registers and counts.

The conversion is arithmetic on the hardware page's statements. LPX is
X/2, the text area starts at X = 24 (sprite coordinates), and a column
is eight pixels wide, so the column is (LPX - 12) / 4 once the pen's own
delay has been subtracted; the text area's 200 lines start at raster
line 51, so the row is (LPY - 51) / 8. A pen reports the beam a little
after the beam lit the phosphor under it, which shows as a constant
added to LPX; `PEN_DELAY` is that constant in LPX units, set per pen by
asking the user to touch a known cell, and left at zero here because no
pen was available to calibrate. Both routines return `$FF` for a point
outside the area, and the row-18 case shows why that matters.

The CIA1 interrupt is turned off first, so the KERNAL's keyboard scan
never drives `$DC00` while the port is read: a held key in a driven
column pulls a row line low on `$DC01`, and the pen's trigger is one of
those row lines (`pitfalls/input.md`, `joystick2_scan_phantom_press`,
for the port-1 form of the hazard). The cost measurement uses a raster
interrupt because the pen line cannot be pulled low by software; the
entry, the dispatcher, the handler and the exit are the same
instructions whichever bit of `$D019` set, so the 94 cycles are the
pen interrupt's cost too.
