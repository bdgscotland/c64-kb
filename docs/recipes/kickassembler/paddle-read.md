---
recipe: paddle-read
toolchain: kickassembler
output_format: PRG
region: both
techniques: [paddle_read]
file_formats: [PRG]
uses_registers: [D419, D41A, DC00, DC01, DC02, D020, D021]
uses_kernal: []
claims: [zero_page $F7-$FF (owns)]
harness: [$02FF]
kernal_services: [IRQ]
---

<!-- doc-type: recipe -->

# KickAssembler — Read the paddles on both ports, time the settle, and catch the keyboard scan

## Synopsis

Selects each control port in turn through CIA1 port A bits 6 and 7,
reads the SID's POTX and POTY registers after a long wait and prints the
four results; then switches from port 2 to port 1 and reads `$D419`
every 8 cycles across the switch, at eight different phases, to show how
long the value takes to settle; then runs 2,000 select-wait-read passes
with the KERNAL jiffy IRQ live and again under `SEI`, counting the reads
that did not return port 2's value. It writes `$01` to `$02FF` and turns
the border green when every phase's settle is inside the page's window
and ten further reads of port 2 agree, `$02` and red otherwise. The
technique is `paddle_read` in `techniques/input.md`.

A headless VICE run has no host mouse to move, so its paddles sit at
one value, and that value is `$FF`, the same as an empty port. The run
therefore attaches a 1351 mouse to port 1 as a pot source that reads
something other than `$FF`, and paddles to port 2. The code is the same
code a paddle game runs; only the source of the voltage differs.

## Source

```asm
// paddle-read.asm
// Reads the SID paddle registers POTX/POTY ($D419/$D41A) for both control
// ports through the CIA1 port A select bits, measures how many cycles the
// value takes to settle after the select changes, shows what the KERNAL
// keyboard scan does to a read taken with the jiffy IRQ live, and reports
// a verdict at $02FF and in the border colour.
//
// The select: $DC00 bit 6 set = control port 1, bit 7 set = control port 2.
// DDR A must be $FF for the write to reach the pins (IOINIT leaves it so).
.encoding "screencode_upper"

.const SCREEN     = $0400
.const RESULT     = $02ff
.const SEL_NONE   = $00
.const SEL_PORT1  = $40
.const SEL_PORT2  = $80
.const SEL_BOTH   = $c0
.const NSAMPLES   = 140         // unrolled reads, 8 cycles apart: 1,116 cycles of window
.const NPHASES    = 8           // the switch is repeated at eight phases, 65 cycles apart
.const SETTLE_LO  = 448         // pass window for the rounded settle, in cycles
.const SETTLE_HI  = 544
.const IRQ_LOOPS  = 2000        // select-wait-read passes with the IRQ live

.const zp_ptr     = $fb         // 16-bit scratch: cycles, then the decimal printer's value
.const zp_tmp     = $fd
.const zp_row     = $f7         // screen pointer for the printers
.const zp_saved_y = $f9
.const idx        = $fa
.const zp_lbl     = $fe         // pointer into the label table ($FE-$FF; it was $F5-$F6, which the KERNAL IRQ's scan may write)

BasicUpstart2(start)

* = $0900 "code"

start:
    sei
    lda #$ff
    sta $dc02                   // port A all output: keyboard columns and the paddle select
    lda #$00
    sta $d020
    sta $d021
    jsr clear_screen
    jsr draw_labels

// --- part A: the settled value for each of the four select patterns -----
    ldx #0
partA:
    lda sel_table,x
    sta $dc00
    jsr wait_2k                 // far longer than the settle
    lda $d419
    and #$fe                    // a 1351's pot line flickers bit 0 in VICE; mask it so two runs match
    sta potx_val,x
    lda $d41a
    and #$fe
    sta poty_val,x
    inx
    cpx #4
    bne partA

    ldx #0
showA:
    stx idx
    lda potx_val,x
    ldy row_a,x
    ldx #16
    jsr print_hex
    ldx idx
    lda poty_val,x
    ldy row_a,x
    ldx #21
    jsr print_hex
    ldx idx
    inx
    cpx #4
    bne showA

// buttons: the paddle buttons are the LEFT and RIGHT lines of each port
    lda #SEL_PORT2
    sta $dc00
    lda $dc00
    ldy #7
    ldx #13
    jsr print_hex
    lda $dc01
    ldy #7
    ldx #21
    jsr print_hex

// --- part B: the settle, sampled every 8 cycles across the switch ------
// Port 2 is left selected for a while, then port 1 is selected and $D419 is
// read every 8 cycles. The whole thing is repeated at eight phases, each 65
// cycles later than the last, because the SID's conversion runs on its own
// clock and the settle depends on where in that cycle the select lands.
    ldx #0
phase_loop:
    stx idx
    lda #SEL_PORT2
    sta $dc00
    jsr wait_2k
    ldx idx
    jsr delay_phase             // idx * 65 cycles
    jsr sample_switch           // selects port 1, fills buf
    lda #<buf
    sta zp_ptr
    lda #>buf
    sta zp_ptr + 1
    jsr find_settle
    ldx idx
    sta settle_k,x
    jsr settle_to_cycles
    lda idx
    asl
    asl
    adc idx                     // column = 5 * idx
    tax
    ldy #10
    jsr print_dec4
    ldx idx
    inx
    cpx #NPHASES
    bne phase_loop

// --- part C: the jiffy IRQ's SCNKEY versus a select-then-read --------------
// Unguarded: select port 2, wait about 530 cycles, read. The IRQ can land in
// the wait and leave $DC00 at $7F, which is port 1. Guarded: the same under SEI.
    lda #0
    sta bad_free
    sta bad_free + 1
    sta bad_sei
    sta bad_sei + 1
    lda #$ff
    sta $dc00                   // every column high before the KERNAL scan runs again
    cli

    lda #<IRQ_LOOPS
    sta loops
    lda #>IRQ_LOOPS
    sta loops + 1
loopC1:
    lda #SEL_PORT2
    sta $dc00
    jsr wait_530
    lda $d419
    and #$fe
    cmp potx_val + 2            // the settled port 2 value from part A
    beq !+
    inc bad_free
    bne !+
    inc bad_free + 1
!:  jsr dec_loops
    bne loopC1

    lda #<IRQ_LOOPS
    sta loops
    lda #>IRQ_LOOPS
    sta loops + 1
loopC2:
    sei
    lda #SEL_PORT2
    sta $dc00
    jsr wait_530
    lda $d419
    cli
    and #$fe
    cmp potx_val + 2
    beq !+
    inc bad_sei
    bne !+
    inc bad_sei + 1
!:  jsr dec_loops
    bne loopC2
    sei

    lda bad_free                // exact; it depends on VICE's random seed (see the page)
    sta zp_ptr
    lda bad_free + 1
    sta zp_ptr + 1
    ldy #14
    ldx #31
    jsr print_dec
    lda bad_sei
    sta zp_ptr
    lda bad_sei + 1
    sta zp_ptr + 1
    ldy #15
    ldx #31
    jsr print_dec

// --- stability: ten reads of port 2, each after a fresh select and wait ---
    lda #0
    sta unstable
    ldx #10
!:  lda #SEL_PORT2
    sta $dc00
    jsr wait_2k
    lda $d419
    and #$fe
    cmp potx_val + 2
    beq !+
    inc unstable
!:  dex
    bne !--

// --- verdict ---------------------------------------------------------------
    lda #2                      // assume FAIL
    sta verdict
    lda unstable
    bne decide
    lda bad_sei
    ora bad_sei + 1
    bne decide
    ldx #0
check_phase:
    stx idx
    lda settle_k,x
    jsr settle_to_cycles
    jsr in_window
    bcc decide
    ldx idx
    inx
    cpx #NPHASES
    bne check_phase
    lda #1
    sta verdict
decide:
    lda verdict
    sta RESULT
    cmp #1
    beq pass
    lda #2                      // red border
    sta $d020
    ldy #18
    ldx #8
    jsr print_fail
    jmp halt
pass:
    lda #5                      // green border
    sta $d020
    ldy #18
    ldx #8
    jsr print_pass
halt:
    jmp halt

// --- subroutines -----------------------------------------------------------

// sample_switch: select control port 1 and read $D419 every 8 cycles into buf.
// Sample i is read 4 + 8 * i cycles after the write cycle of the select store.
sample_switch:
    lda #SEL_PORT1
    sta $dc00                   // cycle 0 is the write cycle of this store
    .for (var i = 0; i < NSAMPLES; i++) {
        lda $d419               // the read is on this instruction's 4th cycle
        sta buf + i
    }
    rts

// delay_phase: X * 65 cycles (arithmetic: ldy 2 + 11 * 5 - 1 + dex 2 + jmp 3 +
// cpx 2 + beq 2 per step). X = 0 costs the compare and branch only.
delay_phase:
    cpx #0
    beq delay_done
    ldy #11
delay_inner:
    dey
    bne delay_inner
    dex
    jmp delay_phase
delay_done:
    rts

// find_settle: zp_ptr -> NSAMPLES bytes. Returns in A the lowest index i such
// that every sample from i to the last equals the last sample.
find_settle:
    ldy #NSAMPLES - 1
    lda (zp_ptr),y
    sta zp_tmp                  // the final value
!:  dey
    cpy #$ff                    // ran off the front (NSAMPLES may exceed 128, so no bmi)
    beq settled_from_zero
    lda (zp_ptr),y
    sec
    sbc zp_tmp
    beq !-
    cmp #1                      // within one of the final value counts as settled:
    beq !-                      // a 1351's pot line flickers bit 0 (measured in VICE)
    cmp #$ff
    beq !-
    iny                         // sample y differed, so y+1 is the first that holds
    tya
    rts
settled_from_zero:
    lda #0
    rts

// settle_to_cycles: A = sample index; zp_ptr = 4 + 8 * A rounded up to a
// multiple of 32 (16-bit). The rounding hides a chance hit by a noise byte
// on the final value one sample early, which would otherwise move the digits.
settle_to_cycles:
    sta zp_ptr
    lda #0
    sta zp_ptr + 1
    asl zp_ptr
    rol zp_ptr + 1
    asl zp_ptr
    rol zp_ptr + 1
    asl zp_ptr
    rol zp_ptr + 1
    lda zp_ptr
    clc
    adc #4 + 31                 // + 4 for the read cycle, then round up to a multiple of 32
    sta zp_ptr
    bcc !+
    inc zp_ptr + 1
!:  lda zp_ptr
    and #$e0
    sta zp_ptr
    rts

// in_window: carry set when SETTLE_LO <= zp_ptr <= SETTLE_HI.
in_window:
    lda zp_ptr + 1
    cmp #>SETTLE_LO
    bcc no
    bne !+
    lda zp_ptr
    cmp #<SETTLE_LO
    bcc no
!:  lda zp_ptr + 1
    cmp #>SETTLE_HI
    bcc yes
    bne no
    lda zp_ptr
    cmp #<SETTLE_HI
    bcc yes
    beq yes
no: clc
    rts
yes:
    sec
    rts

// print_hex: A = byte, row Y, column X. Y is preserved.
print_hex:
    pha
    jsr row_ptr
    pla
    pha
    lsr
    lsr
    lsr
    lsr
    tax
    lda hex_digits,x
    ldy #0
    sta (zp_row),y
    pla
    and #$0f
    tax
    lda hex_digits,x
    iny
    sta (zp_row),y
    ldy zp_saved_y
    rts

// print_dec: zp_ptr = 16-bit value, row Y, column X: five digits, leading zeros.
// print_dec4: the same without the ten-thousands digit.
print_dec4:
    jsr row_ptr
    ldy #0
    ldx #1
    bne dec_digit
print_dec:
    jsr row_ptr
    ldy #0
    ldx #0
dec_digit:
    lda #$30
    sta digit
dec_sub:
    lda zp_ptr
    sec
    sbc pow10_lo,x
    pha
    lda zp_ptr + 1
    sbc pow10_hi,x
    bcc dec_done
    sta zp_ptr + 1
    pla
    sta zp_ptr
    inc digit
    jmp dec_sub
dec_done:
    pla
    lda digit
    sta (zp_row),y
    iny
    inx
    cpx #5
    bne dec_digit
    ldy zp_saved_y
    rts

// row_ptr: zp_row = SCREEN + 40 * Y + X. Saves Y in zp_saved_y.
row_ptr:
    sty zp_saved_y
    txa
    clc
    adc row_lo,y
    sta zp_row
    lda row_hi,y
    adc #0
    sta zp_row + 1
    rts

print_pass:
    jsr row_ptr
    ldy #0
!:  lda t_pass,y
    sta (zp_row),y
    iny
    cpy #4
    bne !-
    rts

print_fail:
    jsr row_ptr
    ldy #0
!:  lda t_fail,y
    sta (zp_row),y
    iny
    cpy #4
    bne !-
    rts

// dec_loops: 16-bit decrement of loops; Z clear while it is non-zero.
dec_loops:
    lda loops
    bne !+
    dec loops + 1
!:  dec loops
    lda loops
    ora loops + 1
    rts

// wait_2k: about 2,000 cycles (arithmetic: 256 * 5 + 146 * 5, less the two
// fall-through branches, plus the call and the X save). X is preserved.
wait_2k:
    txa
    pha
    ldx #0
!:  dex
    bne !-
    ldx #146
!:  dex
    bne !-
    pla
    tax
    rts

// wait_530: 104 * 5 - 1 + 2 + 12 = 533 cycles including the jsr/rts (arithmetic).
wait_530:
    ldy #104
!:  dey
    bne !-
    rts

clear_screen:
    ldx #0
    lda #$20
!:  sta SCREEN,x
    sta SCREEN + 250,x
    sta SCREEN + 500,x
    sta SCREEN + 750,x
    inx
    cpx #250
    bne !-
    rts

// draw_labels: entries of row, column, text, 0; the list ends with row $FF.
// The table is longer than 256 bytes, so it is walked with a pointer, not X.
draw_labels:
    lda #<labels
    sta zp_lbl
    lda #>labels
    sta zp_lbl + 1
next_label:
    ldy #0
    lda (zp_lbl),y
    cmp #$ff
    beq done_labels
    tax                         // row
    iny
    lda (zp_lbl),y              // column
    clc
    adc row_lo,x
    sta zp_row
    lda row_hi,x
    adc #0
    sta zp_row + 1
    lda zp_lbl
    clc
    adc #2
    sta zp_lbl
    bcc !+
    inc zp_lbl + 1
!:  ldy #0
copy_label:
    lda (zp_lbl),y
    beq end_label
    sta (zp_row),y
    iny
    bne copy_label
end_label:
    iny                         // past the terminator
    tya
    clc
    adc zp_lbl
    sta zp_lbl
    bcc next_label
    inc zp_lbl + 1
    jmp next_label
done_labels:
    rts

// --- data ---------------------------------------------------------------------

sel_table:   .byte SEL_NONE, SEL_PORT1, SEL_PORT2, SEL_BOTH
row_a:       .byte 2, 3, 4, 5
hex_digits:  .text "0123456789ABCDEF"
pow10_lo:    .byte <10000, <1000, <100, <10, <1
pow10_hi:    .byte >10000, >1000, >100, >10, >1
row_lo:      .fill 25, <(SCREEN + 40 * i)
row_hi:      .fill 25, >(SCREEN + 40 * i)
t_pass:      .text "PASS"
t_fail:      .text "FAIL"

labels:
    .byte 0, 0
    .text "PADDLE READ  POTX/POTY VIA CIA1 PA6/PA7"
    .byte 0
    .byte 2, 0
    .text "SEL 00 NONE : X=   Y=    (BIT 0 OFF)"
    .byte 0
    .byte 3, 0
    .text "SEL 40 PORT1: X=   Y="
    .byte 0
    .byte 4, 0
    .text "SEL 80 PORT2: X=   Y="
    .byte 0
    .byte 5, 0
    .text "SEL C0 BOTH : X=   Y="
    .byte 0
    .byte 7, 0
    .text "BUTTONS DC00=   DC01=   (BITS 2,3)"
    .byte 0
    .byte 9, 0
    .text "SETTLE P2>P1 (UP TO 32) 8 PHASES X 65:"
    .byte 0
    .byte 14, 0
    .text "IRQ LIVE 2000, BAD:"
    .byte 0
    .byte 15, 0
    .text "SEI GUARDED 2000, BAD:"
    .byte 0
    .byte 18, 0
    .text "RESULT: "
    .byte 0
    .byte $ff

potx_val:    .fill 4, 0
poty_val:    .fill 4, 0
settle_k:    .fill NPHASES, 0
bad_free:    .word 0
bad_sei:     .word 0
loops:       .word 0
unstable:    .byte 0
verdict:     .byte 0
digit:       .byte 0

buf:         .fill NSAMPLES, 0
```

## Build

```bash
java -jar $KICKASS_JAR paddle-read.asm -o paddle-read.prg
```

KickAssembler 5.25 produces a 2,463-byte PRG; the code segment runs
`$0900` to `$119D`, most of it the two unrolled samplers.

Pinned VICE run (both models, `docs/recipes/runs.json`):

```bash
GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas \
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 \
      -limitcycles 8000000 -controlport1device 3 -controlport2device 2 \
      -seed 1 -exitscreenshot paddle-read.png -autostart paddle-read.prg
```

Add `-model ntsc` for the second picture. `-controlport1device 3` is
VICE's 1351 mouse on port 1, `-controlport2device 2` its paddles on
port 2 (the numbers are from `x64sc -help`, VICE 3.10). With paddles on
both ports, or on one, every select reads `$FF` and nothing can be
measured; that run was made and is why the 1351 is there.

`-seed 1` fixes VICE's random number generator. VICE adds random noise
to every pot read (`makepotval` and `makebadpotval` in `src/sid/sid.c`,
VICE 3.10 source) and seeds the generator from the wall clock in whole
seconds (`lib_init` in `src/lib.c`). Without `-seed`, row 14 changes from
run to run: 44 to 60 over 36 seeds on the two models (measured). Runs
started in the same second share a seed and agree, which is why
parallel runs looked stable and serial ones did not. With `-seed 1` eight
runs per model, four in parallel and four in series, gave identical
bytes (measured in VICE x64sc 3.10). A run without `-seed` still passes;
only the row 14 figure moves.

## Expected output

Green border, black background, light blue text. The screen is:

```text
row  0  PADDLE READ  POTX/POTY VIA CIA1 PA6/PA7
row  2  SEL 00 NONE : X=FE Y=FE  (BIT 0 OFF)
row  3  SEL 40 PORT1: X=40 Y=40
row  4  SEL 80 PORT2: X=FE Y=FE
row  5  SEL C0 BOTH : X=40 Y=40
row  7  BUTTONS DC00=80 DC01=FF (BITS 2,3)
row  9  SETTLE P2>P1 (UP TO 32) 8 PHASES X 65:
row 10  0480 0480 0544 0480 0480 0544 0480 0480
row 14  IRQ LIVE 2000, BAD:            00056
row 15  SEI GUARDED 2000, BAD:         00000
row 18  RESULT: PASS
```

`recipes/kickassembler/screenshots/paddle-read.png` (PAL, 384 by 272)
and `paddle-read-ntsc.png` (NTSC, 384 by 247) were each produced twice
by the pinned command with identical bytes, and decoded by matching
every 8 by 8 cell against `chargen-901225-01.bin` (measured in VICE
x64sc 3.10, rung 1). On NTSC row 10 reads
`0480 0480 0480 0544 0480 0480 0544 0480` and row 14 reads `00052`;
every other row is the same.

What each line shows:

- Rows 2 to 5: the four select patterns. `$40` (bit 6) reads port 1, the
  1351, as `$40`/`$40`; `$80` (bit 7) reads port 2, the paddles at rest,
  as `$FE`; no port selected reads `$FE`; both bits set reads the 1351
  again. All four values are shown with bit 0 cleared: VICE adds a
  random 0 or 1 to a 1351's pot value (`makepotval`, see Build), so
  `$41` and `$40` are the same reading, and the display masks it so the
  picture does not depend on the seed. `$FE`
  on the screen is `$FF` on the bus. The both-bits case is VICE's
  arbitration and says nothing about the hardware.
- Row 7: with port 2 selected, `$DC00` reads back `$80` (the select bits
  are outputs and read back; bits 0 to 4 high, no button) and `$DC01`
  reads `$FF`. The paddle buttons are read on the port's LEFT and RIGHT
  lines, bits 2 and 3, on `$DC00` for port 2 and `$DC01` for port 1;
  that they ride those lines is not measured here (VICE has no headless
  way to press one) and `hardware/cia-reference.md` places the paddle
  switches only somewhere in PA0-PA4.
- Row 10: eight settle times, one per phase. Each pass leaves port 2
  selected for about 2,000 cycles, waits a further 65 cycles times the
  phase number, selects port 1, and reads `$D419` every 8 cycles for
  140 reads. The settle is the first read from which every later read is
  within one of the final value, counted in cycles from the write cycle
  of the select store (read `i` is at `4 + 8 i`), rounded up to a
  multiple of 32. Six of eight phases settle by 480, two need more than
  512 and settle by 544; which two depends on the model because the
  phases fall differently against the SID's conversion clock. The raw
  reads at the transition are not shown because VICE fills the window
  with values that differ from run to run (`$C8 $FF $63`, then `$4B
  $87 $46`, then `$D2 $FB $6A` at the same three cycles in three runs).
  In the runs that did print them, the settled value was present from
  read 59, cycle 476, at phase 0 on both models.
- Rows 14 and 15: 2,000 passes of select port 2, wait about 530 cycles,
  read, with the KERNAL IRQ enabled: 56 reads on PAL and 52 on NTSC
  returned something other than port 2's value (44 to 60 across seeds).
  An earlier version printed the count rounded down to 16, on the
  belief that it moved by one between runs; it moved by up to 16, so
  the rounded figure still changed (48 or 32 in eight runs) and flaked
  the pinned picture. The count is now exact and the seed is pinned. The loop takes about 1.1 million cycles,
  56 PAL frames, so that is about one bad read per jiffy interrupt: the
  scan leaves `$DC00` at `$7F`, port 1 selected. The same 2,000 passes
  under `SEI` return port 2's value every time.

The pass window for row 10 is 448 to 544 inclusive. The pass also needs
the guarded count to be zero and ten more reads of port 2, each after
its own select and a 2,000-cycle wait, to agree with row 4.

Two earlier versions of this listing did not run: the label table grew
past 256 bytes and an indexed walk wrapped, and the 2,000-cycle wait
used X and reset a loop counter. Both were found from the screen, not
the source.

## Why this works

The select is a plain write to `$DC00` with the direction register at
`$FF`: bits 6 and 7 are output pins on the CIA that feed the SID's
analogue multiplexer, and bits 0 to 5 double as keyboard columns, so
`$40` and `$80` also leave every column line high. The SID does not
sample the pot line at the moment of the write. It runs its own
conversion, one every 512 cycles, and the value in `$D419` becomes the
new port's only after a conversion that started after the switch has
finished. The phase sweep exists to show that the wait depends on where
the write lands in that cycle; a program that reads a fixed number of
cycles after the select must use the longest case, and the cheapest
correct schedule is to select on one frame and read on the next.

The unrolled sampler is what makes the count exact: `lda $d419` reads
on its fourth cycle and `sta buf+i` takes four, so read `i` is at
`4 + 8 i` with no loop overhead to account for. `find_settle` walks the
buffer from the end so that a stray match inside the noise cannot end
the search early. The tolerance of one and the rounding to 32 are
concessions to VICE, not to the SID: its 1351 wobbles bit 0, and its
noise bytes are random, so an unrounded figure could move by 8 between
two runs of the same PRG.

The IRQ loop shows the other half of the technique. SCNKEY runs inside
the jiffy interrupt, drives the columns, and leaves `$7F` in `$DC00`,
which is bit 6 set: port 1. A read taken after that, but within a
conversion of it, gets either port 1's value or a byte from the middle
of a conversion; the runs here saw both. Bracketing the select, the
wait and the read with `SEI` and `CLI` removes every miss, at the cost
of holding the interrupt off for the wait. A game that already owns the
IRQ, or that reads on a raster line it chooses, has the same guarantee
without the bracket.
