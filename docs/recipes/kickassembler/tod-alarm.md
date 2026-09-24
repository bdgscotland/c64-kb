---
recipe: tod-alarm
toolchain: kickassembler
output_format: PRG
region: both
techniques: [tod_alarm_interrupt]
file_formats: [PRG]
uses_registers: [D011, D012, D020, D021, DC04, DC05, DC08, DC09, DC0A, DC0B, DC0D, DC0E, DC0F]
uses_kernal: []
claims: [irq_vector_0314 (owns), zero_page $F7-$F8+$FB-$FE (owns)]
harness: [$02F8-$02FF]
ram: [colour=$D800-$DBFF]
kernal_services: [IRQ]
---

<!-- doc-type: recipe -->

# KickAssembler — Set the TOD clock, arm its alarm three seconds on, and take the alarm as a CIA1 interrupt

## Synopsis

Sets CIA1's time-of-day clock to 01:02:03.0, programs the TOD alarm for
01:02:06.0, enables the alarm interrupt in `$DC0D` and chains a handler
under the KERNAL's jiffy IRQ through `$0314`. The main loop counts frames.
The handler reads `$DC0D` once, and on the alarm bit records the raster
line, Timer A, the TOD time (hours first, tenths last), the frame count
and its own cost in Timer A cycles. The screen shows the set time, the
alarm time, the time read in the handler and the frames elapsed against
the expected figure for the model. Verdict: `$01` at `$02FF` and a green
border when the alarm came within one tenth of the programmed time and
the handler's TOD read equals the alarm time; `$02` and red otherwise.
The technique is `tod_alarm_interrupt` in `techniques/cpu-cycle-tricks.md`.

The 50/60 Hz bit (`$DC0E` bit 7) is set from the model detected at run
time, so one PRG passes on PAL and NTSC. Built with `-define WRONGHZ` the
bit is set the wrong way round, which is the drift the page quotes.

CIA1 rather than CIA2: CIA1's alarm arrives as an IRQ, which the KERNAL
dispatches through `$0314` with A, X and Y already saved, which `SEI` can
hold off around a main-loop TOD read, and which leaves the jiffy clock and
the keyboard scan running. CIA2's alarm would be an NMI: unmaskable,
sharing a vector with RESTORE, and needing its own `$DD0D` acknowledge
(`nmi_handler_and_restore_key`).

## Source

```asm
// tod-alarm.asm
// Sets CIA1's time-of-day clock to a known time, programs the TOD alarm three
// seconds ahead, enables the alarm interrupt and chains it under the KERNAL's
// jiffy IRQ. The handler records the raster line, Timer A, the TOD time (read
// hours first, tenths last) and the frame count, and measures its own cost
// with Timer A. The main loop counts frames. Verdict at $02FF and in the
// border: $01 green when the alarm fired within one tenth of the programmed
// time and the TOD read in the handler equals the alarm time, else $02 red.
//
// Build with -define WRONGHZ to set the 50/60 Hz bit the wrong way round for
// the model, which makes the clock run 5/6 (PAL) or 6/5 (NTSC) of true speed.
.encoding "screencode_upper"

.const SCREEN    = $0400
.const COLRAM    = $d800
.const RESULT    = $02ff
.const REC_RASTER = $02f8       // $D012, $D011 as read in the handler (varies run to run)
.const REC_TIMER  = $02fa       // Timer A low, high as read in the handler
.const SET_H     = $01          // clock set to 01:02:03.0 AM
.const SET_M     = $02
.const SET_S     = $03
.const SET_T     = $00
.const ALM_H     = $01          // alarm at 01:02:06.0 AM, three seconds on
.const ALM_M     = $02
.const ALM_S     = $06
.const ALM_T     = $00
.const EXP_PAL   = 150          // three seconds of 50 Hz frames
.const EXP_NTSC  = 180          // three seconds of 60 Hz frames
.const TOL_PAL   = 5            // one tenth of a second in frames
.const TOL_NTSC  = 6

.const zp_ptr    = $fb          // string pointer
.const zp_val    = $fd          // 16-bit value for the decimal printer
.const zp_scr    = $f7          // screen pointer for the printers

BasicUpstart2(start)

* = $0900 "code"

start:
    sei
    lda #$00
    sta $d020
    sta $d021
    jsr clear_screen
    jsr draw_labels
    jsr detect_model

// --- TODIN: bit 7 of $DC0E must say what the mains pin carries ----------
// Read-modify-write: a plain store would clear bit 0 and stop Timer A, and
// with it the KERNAL's jiffy IRQ and keyboard scan.
    lda $dc0e
    and #$7f
    ldx is_pal
    beq todin_done
    ora #$80                    // PAL: 50 Hz
todin_done:
#if WRONGHZ
    eor #$80                    // deliberately wrong for the drift run
#endif
    sta $dc0e
    and #$80
    sta todin_val

// --- the alarm: ALARM = 1 routes the four TOD writes to the alarm -------
    lda $dc0f
    ora #$80
    sta $dc0f
    lda #ALM_H
    sta $dc0b
    lda #ALM_M
    sta $dc0a
    lda #ALM_S
    sta $dc09
    lda #ALM_T
    sta $dc08
    lda $dc0f
    and #$7f                    // back to the clock
    sta $dc0f

// --- the handler and the interrupt enable -------------------------------
    lda #<irq
    sta $0314
    lda #>irq
    sta $0315
    lda #$00
    sta fired
    sta frames
    sta frames + 1
    lda $dc0d                   // drop anything pending
    lda #$84                    // set bit 2: alarm IRQ on; Timer A's bit is untouched
    sta $dc0d

// --- the clock: hours stops it, tenths starts it ------------------------
    lda #SET_H
    sta $dc0b
    lda #SET_M
    sta $dc0a
    lda #SET_S
    sta $dc09
    lda #SET_T
    sta $dc08                   // running from here; frame 0 starts now
    cli

// --- count frames until the handler says the alarm fired ----------------
frame_loop:
    lda $d012
    bpl frame_loop              // wait for a line in 128-255
wait_low:
    lda $d012
    bmi wait_low                // wait for the wrap to the next frame's 0-127
    inc frames
    bne no_carry
    inc frames + 1
no_carry:
    lda fired
    beq frame_loop
    sei                         // the run is over; nothing more should chain

// --- show the figures ---------------------------------------------------
    lda #2
    jsr set_row
    lda is_pal
    beq show_ntsc
    ldx #<txt_pal
    ldy #>txt_pal
    jmp show_model
show_ntsc:
    ldx #<txt_ntsc
    ldy #>txt_ntsc
show_model:
    lda #6
    jsr print_str
    lda todin_val
    asl
    rol                         // bit 7 to bit 0
    ora #$30                    // '0' or '1'
    sta SCREEN + 2 * 40 + 34

    lda #4
    jsr set_row
    ldx #<set_time
    ldy #>set_time
    jsr print_time
    lda #5
    jsr set_row
    ldx #<alarm_time
    ldy #>alarm_time
    jsr print_time
    lda #8
    jsr set_row
    ldx #<got_h
    ldy #>got_h
    jsr print_time

    lda #11
    jsr set_row
    lda got_icr
    ldx #14
    jsr print_hex

    lda #12
    jsr set_row
    lda got_flo
    sta zp_val
    lda got_fhi
    sta zp_val + 1
    ldx #12
    jsr print_dec
    jsr expected                // A = expected frames, X = tolerance
    sta exp_val
    stx tol_val
    sta zp_val
    lda #$00
    sta zp_val + 1
    ldx #25
    jsr print_dec
    lda tol_val
    ora #$30
    sta SCREEN + 12 * 40 + 33

    lda #14
    jsr set_row
    lda cost_lo
    sta zp_val
    lda cost_hi
    sta zp_val + 1
    ldx #16
    jsr print_dec

// --- verdict ------------------------------------------------------------
    lda got_fhi
    bne fail
    lda got_flo
    sec
    sbc exp_val
    bcs diff_pos
    eor #$ff                    // negate
    clc
    adc #$01
diff_pos:
    cmp tol_val
    beq diff_ok
    bcs fail
diff_ok:
    lda got_h
    cmp #ALM_H
    bne fail
    lda got_m
    cmp #ALM_M
    bne fail
    lda got_s
    cmp #ALM_S
    bne fail
    lda got_t
    cmp #ALM_T
    bne fail
    lda #$01
    sta RESULT
    lda #$05                    // green
    sta $d020
    lda #16
    jsr set_row
    ldx #<txt_pass
    ldy #>txt_pass
    lda #0
    jsr print_str
    jmp halt
fail:
    lda #$02
    sta RESULT
    lda #$02                    // red
    sta $d020
    lda #16
    jsr set_row
    ldx #<txt_fail
    ldy #>txt_fail
    lda #0
    jsr print_str
halt:
    jmp halt

// --- the interrupt handler ----------------------------------------------
// Entered through $0314 with A, X and Y already pushed by the KERNAL.
irq:
    lda $dc04                   // Timer A at entry, for the cost figure
    sta t0_lo
    lda $dc05
    sta t0_hi
    cld                         // the handler subtracts; D is whatever was interrupted
    lda $dc0d                   // one read acknowledges every CIA1 source
    sta icr_seen
    and #$04
    beq not_alarm
    lda fired
    bne not_alarm               // record the first alarm only
    lda $d011
    sta REC_RASTER + 1          // bit 7 is raster bit 8
    lda $d012
    sta REC_RASTER
    lda $dc04
    sta REC_TIMER
    lda $dc05
    sta REC_TIMER + 1
    lda $dc0b                   // hours first: latches the four registers
    sta got_h
    lda $dc0a
    sta got_m
    lda $dc09
    sta got_s
    lda $dc08                   // tenths last: releases the latch
    sta got_t
    lda frames
    sta got_flo
    lda frames + 1
    sta got_fhi
    lda icr_seen
    sta got_icr
    lda #$01
    sta fired
    lda $dc04                   // Timer A at exit; it counts down, so cost = t0 - t1
    sta t1_lo
    lda $dc05
    sta t1_hi
    lda t0_lo
    sec
    sbc t1_lo
    sta cost_lo
    lda t0_hi
    sbc t1_hi
    sta cost_hi
not_alarm:
    lda icr_seen
    and #$01
    beq no_jiffy
    jmp $ea31                   // Timer A too: let the KERNAL run its tick
no_jiffy:
    jmp $ea81                   // alarm alone: restore A, X, Y and RTI

// --- model detection: PAL has raster lines past 262 ---------------------
detect_model:
    lda #$00
    sta is_pal
wait_high:
    lda $d011
    bpl wait_high               // line >= 256
scan_high:
    lda $d012
    cmp #$10                    // line >= 272: PAL
    bcc still_high
    lda #$01
    sta is_pal
still_high:
    lda $d011
    bmi scan_high
    rts

// A = expected frames, X = tolerance for the detected model
expected:
    lda is_pal
    beq exp_ntsc
    ldx #TOL_PAL
    lda #EXP_PAL
    rts
exp_ntsc:
    ldx #TOL_NTSC
    lda #EXP_NTSC
    rts

// --- screen helpers -----------------------------------------------------
clear_screen:
    ldx #$00
clr:
    lda #$20
    sta SCREEN,x
    sta SCREEN + $100,x
    sta SCREEN + $200,x
    sta SCREEN + $300,x
    lda #$0e                    // light blue
    sta COLRAM,x
    sta COLRAM + $100,x
    sta COLRAM + $200,x
    sta COLRAM + $300,x
    inx
    bne clr
    rts

// A = row: zp_scr = SCREEN + row * 40
set_row:
    tax
    lda row_lo,x
    sta zp_scr
    lda row_hi,x
    sta zp_scr + 1
    rts

// X/Y = string address, A = column: prints on zp_scr's row from that column
print_str:
    stx zp_ptr
    sty zp_ptr + 1
    clc
    adc zp_scr
    sta zp_scr
    bcc ps_nc
    inc zp_scr + 1
ps_nc:
    ldy #$00
ps_loop:
    lda (zp_ptr),y
    beq ps_done
    sta (zp_scr),y
    iny
    bne ps_loop
ps_done:
    rts

// X/Y = address of four bytes h, m, s, t; prints HH:MM:SS.T from column 12
print_time:
    stx zp_ptr
    sty zp_ptr + 1
    ldy #$00
    lda (zp_ptr),y
    and #$7f                    // AM/PM bit off the hours digit
    ldx #12
    jsr print_hex
    ldy #$01
    lda (zp_ptr),y
    ldx #15
    jsr print_hex
    ldy #$02
    lda (zp_ptr),y
    ldx #18
    jsr print_hex
    ldy #$03
    lda (zp_ptr),y
    and #$0f
    ora #$30
    ldy #21
    sta (zp_scr),y
    lda #$3a                    // ':'
    ldy #14
    sta (zp_scr),y
    ldy #17
    sta (zp_scr),y
    lda #$2e                    // '.'
    ldy #20
    sta (zp_scr),y
    rts

// A = byte, X = column: two hex digits on zp_scr's row
print_hex:
    sta hx_tmp
    txa
    tay
    lda hx_tmp
    lsr
    lsr
    lsr
    lsr
    jsr hex_digit
    sta (zp_scr),y
    iny
    lda hx_tmp
    and #$0f
    jsr hex_digit
    sta (zp_scr),y
    rts

hex_digit:
    cmp #$0a
    bcc hd_num
    sbc #$09                    // A-F are screen codes 1-6
    rts
hd_num:
    ora #$30
    rts

// zp_val = 16-bit value, X = column: five decimal digits
print_dec:
    txa
    tay
    ldx #$00
pd_digit:
    lda #$2f                    // '0' - 1
pd_sub:
    clc
    adc #$01
    pha
    lda zp_val
    sec
    sbc pow_lo,x
    sta zp_val
    lda zp_val + 1
    sbc pow_hi,x
    sta zp_val + 1
    pla
    bcs pd_sub
    pha
    lda zp_val
    clc
    adc pow_lo,x
    sta zp_val
    lda zp_val + 1
    adc pow_hi,x
    sta zp_val + 1
    pla
    sta (zp_scr),y
    iny
    inx
    cpx #$05
    bne pd_digit
    rts

draw_labels:
    ldx #$00
dl_loop:
    lda label_rows,x
    bmi dl_done
    stx dl_idx
    jsr set_row
    ldx dl_idx
    lda label_lo,x
    sta zp_ptr
    lda label_hi,x
    sta zp_ptr + 1
    ldy #$00
dl_chr:
    lda (zp_ptr),y
    beq dl_next
    sta (zp_scr),y
    iny
    bne dl_chr
dl_next:
    ldx dl_idx
    inx
    bne dl_loop
dl_done:
    rts

// --- data ---------------------------------------------------------------
set_time:   .byte SET_H, SET_M, SET_S, SET_T
alarm_time: .byte ALM_H, ALM_M, ALM_S, ALM_T

is_pal:     .byte 0
todin_val:  .byte 0
fired:      .byte 0
frames:     .word 0
icr_seen:   .byte 0
t0_lo:      .byte 0
t0_hi:      .byte 0
t1_lo:      .byte 0
t1_hi:      .byte 0
cost_lo:    .byte 0
cost_hi:    .byte 0
exp_val:    .byte 0
tol_val:    .byte 0
dl_idx:     .byte 0
hx_tmp:     .byte 0
got_h:      .byte 0
got_m:      .byte 0
got_s:      .byte 0
got_t:      .byte 0
got_flo:    .byte 0
got_fhi:    .byte 0
got_icr:    .byte 0

pow_lo:     .byte <10000, <1000, <100, <10, <1
pow_hi:     .byte >10000, >1000, >100, >10, >1

row_lo:     .fill 25, <(SCREEN + i * 40)
row_hi:     .fill 25, >(SCREEN + i * 40)

label_rows: .byte 0, 2, 4, 5, 7, 8, 9, 11, 12, 14, $ff
label_lo:   .byte <l0, <l2, <l4, <l5, <l7, <l8, <l9, <l11, <l12, <l14
label_hi:   .byte >l0, >l2, >l4, >l5, >l7, >l8, >l9, >l11, >l12, >l14

l0:   .text "TOD ALARM IRQ  CIA1 $DC08-$DC0F"
      .byte 0
l2:   .text "MODEL                 TODIN BIT7  "
      .byte 0
l4:   .text "SET TIME"
      .byte 0
l5:   .text "ALARM TIME"
      .byte 0
l7:   .text "IN THE HANDLER:"
      .byte 0
l8:   .text "TOD READ"
      .byte 0
l9:   .text "RASTER, TIMER A AT $02F8-$02FB"
      .byte 0
l11:  .text "ICR          $"
      .byte 0
l12:  .text "FRAMES            EXPECT       +-"
      .byte 0
l14:  .text "HANDLER CYCLES"
      .byte 0
txt_pal:  .text "PAL"
          .byte 0
txt_ntsc: .text "NTSC"
          .byte 0
txt_pass: .text "RESULT: PASS"
          .byte 0
txt_fail: .text "RESULT: FAIL"
          .byte 0
```

## Build

```bash
java -jar $KICKASS_JAR tod-alarm.asm -o tod-alarm.prg
```

KickAssembler 5.25 produces a 1,486-byte PRG; the code segment runs
`$0900` to `$0DCC`.

Pinned VICE run (both models, `docs/recipes/runs.json`):

```bash
GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas \
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 \
      -limitcycles 8000000 -exitscreenshot tod-alarm.png -autostart tod-alarm.prg
```

Add `-model ntsc` for the second picture. The drift build is not pinned:

```bash
java -jar $KICKASS_JAR tod-alarm.asm -define WRONGHZ -o tod-alarm-wronghz.prg
```

## Expected output

Green border, black background, light blue text. The PAL screen is:

```text
row  0  TOD ALARM IRQ  CIA1 $DC08-$DC0F
row  2  MODEL PAL             TODIN BIT7  1
row  4  SET TIME    01:02:03.0
row  5  ALARM TIME  01:02:06.0
row  7  IN THE HANDLER:
row  8  TOD READ    01:02:06.0
row  9  RASTER, TIMER A AT $02F8-$02FB
row 11  ICR          $84
row 12  FRAMES      00149 EXPECT 00150 +-5
row 14  HANDLER CYCLES  00130
row 16  RESULT: PASS
```

On NTSC row 2 reads `MODEL NTSC            TODIN BIT7  0` and row 12
reads `FRAMES      00179 EXPECT 00180 +-6`; every other row is the same.
`recipes/kickassembler/screenshots/tod-alarm.png` (PAL, 384 by 272) and
`tod-alarm-ntsc.png` (NTSC, 384 by 247) were each produced twice by the
pinned command with identical bytes, and decoded by matching every 8 by
8 cell against `chargen-901225-01.bin` (measured in VICE x64sc 3.10,
rung 1).

What each line shows:

- Rows 4, 5 and 8: the clock was set to 01:02:03.0, the alarm to
  01:02:06.0, and the four registers read in the handler, hours first
  and tenths last, are 01:02:06.0 on both models. The alarm interrupt
  is raised at the match, and the handler is inside it well before the
  next tenth.
- Row 11: `$DC0D` read `$84` in the handler: bit 7 (an enabled source
  fired) and bit 2 (the alarm), and no bit 0, so the jiffy timer had
  not also underflowed and the handler left through `$EA81` rather than
  `$EA31`. A run in which the two coincide would read `$85` and take
  the `$EA31` path; that did not happen in any of the runs made.
- Row 12: frames counted from the tenths write that started the clock
  to the alarm. Three seconds is 150 PAL frames or 180 NTSC frames; the
  count was 149 and 179, one frame inside the tolerance of one tenth
  (5 PAL frames, 6 NTSC). The alarm can only be early, never late: the
  clock starts on the tenths write, but the mains tick that advances it
  keeps its own phase, so the first tick arrives anywhere from 0 to one
  tick later and the 150th (or 180th) tick lands up to one tick short
  of 3.000 s. One tick is 19,705 PAL cycles or 17,045 NTSC cycles, one
  frame within one per cent, and the frame counter rounds down, hence
  149 and 179 (arithmetic; the counts are measured). That one-tick bound
  assumes the five-or-six-tick divider behind the tenths digit restarts
  when the clock does. If it keeps its count across the stop, the first
  tenth can take from one to five ticks and the alarm can land up to
  four ticks early, still inside the tolerance. The runs here cannot
  tell the two apart; a build that delays the clock set by a varying
  number of frames and reads the count would.
- Row 14: 130 cycles from the handler's first read of Timer A, at its
  entry, to the read at its exit, with `CLD`, the `$DC0D` read, the
  recording and the frame copy inside the span (measured in VICE x64sc
  3.10, the same on both models). The whole alarm entry adds the IRQ
  sequence (7), the KERNAL dispatcher at `$FF48` (29), the cost
  bookkeeping after the exit read (about 38), the exit test (12) and
  `$EA81` (22): about 240 cycles once, on the frame the alarm fires
  (arithmetic from the instruction table). A build of this listing with
  only the technique page's handler body between the two Timer A reads
  (`CLD`, the `$DC0D` read, the four TOD reads and a count) read 68 on
  both models, the same harness; that is the figure behind the
  technique's `Cost` line, not this row's 130.
- Row 9: the raster line and Timer A seen in the handler are stored at
  `$02F8`-`$02F9` (`$D012`, then `$D011` with the raster's bit 8 in bit
  7) and `$02FA`-`$02FB` (Timer A low, high), for the monitor, and are
  not printed. An earlier build printed them, and the PAL picture then
  differed between identical runs: Timer A read `$048C` in one run and
  `$045E` or `$045B` in five others, the raster line 240 or 241, while
  two NTSC runs agreed to the byte. The alarm's arrival moves by up to
  about 50 cycles between runs on PAL in VICE, and a pinned screenshot
  cannot carry a figure that moves. Why it moves was not established
  here.

With `-define WRONGHZ` (not pinned; both runs made once from this
listing, measured in VICE x64sc 3.10):

- PAL with TODIN = 0 (the bit the KERNAL leaves): row 12 reads `FRAMES
  00180 EXPECT 00150 +-5`, red border, `RESULT: FAIL`. The clock divided
  a 50 Hz tick by 6, so three clock seconds took 3.6 s of real time.
- NTSC with TODIN = 1: `FRAMES 00149 EXPECT 00180 +-6`, red, FAIL. The
  clock divided 60 Hz by 5 and ran three seconds in 2.5 s.
- In both the handler's TOD read is still 01:02:06.0 and the ICR still
  `$84`: the alarm compares clock digits, so a clock running at the
  wrong rate still fires the alarm at the right digits, at the wrong
  wall time. Nothing on the screen but the frame count reveals it.

## Why this works

The four writes with `$DC0F` bit 7 set land in the alarm registers and
leave the clock alone; the compare against the running clock is always
live, so there is no arming step beyond bit 2 of `$DC0D`. The four
writes with bit 7 clear set the clock: the hours write stops it and the
tenths write restarts it, which is why the clock is set last and the
frame count starts at that store (`pitfalls/cia.md`,
`tod_read_order_latch`, which measured both orders). The handler's read
order matters for the same reason in reverse: the hours read latches
the four registers, the tenths read releases them, so the time it
records is one coherent instant and the latch is not left standing for
the main loop to trip over.

One read of `$DC0D` clears every CIA1 flag and drops the IRQ line, so
the handler reads it once, keeps the value, and decides from the copy:
bit 2 is the alarm, bit 0 is the KERNAL's Timer A, and the two can
arrive together. The alarm alone leaves through `$EA81`, which pops A,
X and Y and returns; a Timer A bit sends the copy on to `$EA31` so the
jiffy clock and the keyboard scan are not lost. Writing `$84` to `$DC0D`
sets bit 2 without touching bit 0 (bit 7 set means "set the bits that
are 1"), which is what keeps the KERNAL's interrupt alive underneath.
Bit 7 of `$DC0E` is set read-modify-write for the same reason: a plain
store would clear bit 0 and stop Timer A.

The model test reads `$D011` bit 7 and `$D012` while the raster is past
line 255 and calls the machine PAL if it sees a line at or above 272;
NTSC's last line is 262. That is what chooses the TODIN value. The
KERNAL never sets that bit on either model (`hardware/cia-reference.md`,
`$DC0E`, read from the ROM bytes), so a program that wants the clock to
keep time on a PAL machine sets it itself, and the drift figures above
are what it costs not to.
