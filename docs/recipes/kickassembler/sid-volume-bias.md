---
recipe: sid-volume-bias
toolchain: kickassembler
output_format: PRG
region: both
techniques: [sid_8580_digi_bias_and_filter_bypass]
file_formats: [PRG]
uses_registers: [D404, D405, D406, D40B, D40C, D40D, D412, D413, D414, D417, D418, D020, DD04, DD05, DD06, DD07, DD0D, DD0E, DD0F]
uses_kernal: [CHROUT]
claims: [cia2_timer_a (owns), cia2_tod (init), sid_voice_1 (owns), sid_voice_2 (owns), sid_voice_3 (owns), sid_filter_volume (owns)]
harness: [cia2_timer_b, $02FF]
---

<!-- doc-type: recipe -->

# KickAssembler SID volume bias: how big a $D418 step is, with and without bias voices

## Synopsis

A `$D418` digi plays through the volume nibble, and a volume step is only
as loud as the signal it scales. This program measures that step in five
voice setups: every voice routed to the filter with no filter mode, no
voice sounding, one bias voice, and three bias voices. A bias voice is
pulse + TEST + gate (`$49`) at sustain 15, a constant full-scale level.
For each setup it writes the sixteen volumes as a square wave against
`$00`, so a WAV of the run holds every step. Run once per SID model, it
shows why a plain `$D418` digi is quiet on the 8580 and what the bias
voices give back. The technique is `sid_8580_digi_bias_and_filter_bypass`
in `techniques/music-sid.md`. Every sound figure here is reSID's model in
VICE 3.10, not a SID chip.

## Source

```asm
// sid-volume-bias.asm
// How loud is a $D418 volume step? Five voice setups, each followed by
// the sixteen volume values written as a square wave against $00
// (32 half-periods of 492 cycles per value), so a WAV of the run holds
// the level of every volume step in every setup:
//   0  three bias voices, all routed to the filter, no filter mode
//   1  no voice sounding, all routed to the filter, no filter mode
//   2  no voice sounding, no routing (a plain $D418 digi)
//   3  one bias voice (voice 3), no routing
//   4  three bias voices, no routing
// A bias voice is pulse + TEST + gate ($49) at sustain 15: a constant
// full-scale level. Each setup starts with one block of $00 while the
// envelopes settle. CIA 2 timer A paces the writes, timer B counts its
// underflows, and the verdict checks the count: $02FF (01 pass, 02 fail),
// border green or red, a line of text.
BasicUpstart2(start)

.const CHROUT   = $ffd2
.const RESULT   = $02ff
.const BORDER   = $d020

.const H        = 492            // half-period, cycles
.const HALVES   = 32             // half-periods per block
.const SETUPS   = 5
.const BLOCKS   = SETUPS * 17    // a settle block and 16 volumes each
.const EXPECT_TB = $ffff - BLOCKS * HALVES

.const CODE_PASS = $01
.const CODE_FAIL = $02

start:
    ldx #0
!:  lda header,x
    beq !+
    jsr CHROUT
    inx
    bne !-
!:
    sei
    lda #$7f                     // CIA 2 is no NMI source; clear pending
    sta $dd0d
    lda $dd0d

    lda #$0f                     // attack 0, decay 15; sustain 15,
    sta $d405                    // release 0 (a voice switched off is
    sta $d40c                    // silent 6 ms later)
    sta $d413
    lda #$f0
    sta $d406
    sta $d40d
    sta $d414
    lda #$00
    sta $d418

    lda #<(H - 1)
    sta $dd04
    lda #>(H - 1)
    sta $dd05
    lda #$ff
    sta $dd06
    sta $dd07
    lda #$11                     // timer A: start, force load, continuous
    sta $dd0e
    jsr tick                     // just after an underflow: start B
    lda #$51                     // counting timer A underflows
    sta $dd0f

    ldy #0                       // setup index
setup:
    lda ctl1,y                   // voice controls and routing for setup y
    sta $d404
    lda ctl2,y
    sta $d40b
    lda ctl3,y
    sta $d412
    lda route,y
    sta $d417
    ldx #HALVES                  // settle block: $00 throughout
!:  jsr tick
    dex
    bne !-
    lda #0
    sta vol
vloop:
    ldx #HALVES / 2
half:
    jsr tick
    lda vol
    sta $d418
    jsr tick
    lda #$00
    sta $d418
    dex
    bne half
    inc vol
    lda vol
    cmp #16
    bne vloop
    iny
    cpy #SETUPS
    bne setup

    lda $dd06                    // timer B: underflows so far
    sta tb
    lda $dd07
    sta tb + 1
    lda #$00
    sta $dd0e
    sta $dd0f
    sta $d404
    sta $d40b
    sta $d412
    sta $d417
    cli

    lda tb
    cmp #<EXPECT_TB
    bne fail
    lda tb + 1
    cmp #>EXPECT_TB
    bne fail
    lda #CODE_PASS
    ldy #5                       // green
    bne verdict
fail:
    lda #CODE_FAIL
    ldy #2                       // red
verdict:
    sta RESULT
    sty BORDER
    ldx #0
!:  lda restext,x
    beq !+
    jsr CHROUT
    inx
    bne !-
!:  lda RESULT
    jsr hexbyte
    ldx #0
    lda RESULT
    cmp #CODE_PASS
    beq pass
!:  lda failtext,x
    beq tbline
    jsr CHROUT
    inx
    bne !-
pass:
!:  lda passtext,x
    beq tbline
    jsr CHROUT
    inx
    bne !-
tbline:
    ldx #0
!:  lda tbtext,x
    beq !+
    jsr CHROUT
    inx
    bne !-
!:  lda tb + 1
    jsr hexbyte
    lda tb
    jsr hexbyte
    lda #$0d
    jmp CHROUT

tick:                            // wait for the next timer A underflow
    lda $dd0d
    and #$01
    beq tick
    rts

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
    adc #6
!:  adc #'0'
    jmp CHROUT

//            setup:  0     1     2     3     4
ctl1:   .byte        $49,  $00,  $00,  $00,  $49
ctl2:   .byte        $49,  $00,  $00,  $00,  $49
ctl3:   .byte        $49,  $00,  $00,  $49,  $49
route:  .byte        $07,  $07,  $00,  $00,  $00
vol:    .byte 0
tb:     .word 0

.encoding "petscii_upper"
header:   .text "D418 VOLUME STEPS, FIVE VOICE SETUPS"
          .byte $0d
          .text "16 VOLUMES X 32 HALF-PERIODS OF 492"
          .byte $0d, 0
restext:  .text "RESULT "
          .byte 0
passtext: .text " PASS"
          .byte $0d, 0
failtext: .text " FAIL"
          .byte $0d, 0
tbtext:   .text "TIMER B $"
          .byte 0
```

## Build

```bash
java -jar KickAss.jar sid-volume-bias.asm -o sid-volume-bias.prg -showmem
```

Produces `sid-volume-bias.prg`, `$080e` to `$09d7` (KickAssembler 5.25,
`-showmem`).

## Expected output

Border green. Screen rows 7 to 10:

```
D418 VOLUME STEPS, FIVE VOICE SETUPS
16 VOLUMES X 32 HALF-PERIODS OF 492
RESULT 01 PASS
TIMER B $F55F
```

`$F55F` is `$FFFF` less 2,720, the number of half-periods (5 setups × 17
blocks × 32): every write landed on its own timer A underflow. Pinned at
5,000,000 cycles on PAL and NTSC: `screenshots/sid-volume-bias.png` and
`screenshots/sid-volume-bias-ntsc.png`, decoded with the char ROM, the
four lines above on rows 7 to 10 on both, border pixel (2, 100) palette
index 5. The screen is the same on every SID model; the result is in the
sound.

## The sound, measured without ears

Nobody listened to this. The PAL build was run without warp with
`-sound -sounddev wav -soundarg out.wav -soundrate 48000 -soundoutput 1
-limitcycles 5000000`, three times: `-model c64` (reSID 6581), the
default model (reSID 8580), and the default with `-sidenginemodel 258`,
which VICE's log names "MOS8580 + digi boost". Each WAV is 2.07 s. Levels
were found with `levels.py` from `d418-8bit-digi.md` (block count 85)
and are in 16-bit WAV units, relative to volume 0.

| Setup | reSID 6581: step per volume unit | reSID 8580 | reSID 8580 + digi boost |
|---|---|---|---|
| 0: three bias voices, all routed to the filter, no mode bit | 0 | 0 | 725.7 |
| 1: no voice sounding, all routed to the filter, no mode bit | 0 | 0 | 725.9 |
| 2: no voice sounding, no routing: a plain `$D418` digi | −640.4 | 93.5 | 777.1 |
| 3: one bias voice (voice 3), no routing | −1,142.4 | −91.8 | 612.9 |
| 4: three bias voices, no routing | −2,036.3 | −482.3 | 267.2 |

The step is the level at volume 15 over 15. The sign says which way the
output moves; loudness is the size. The single steps are not equal: on
the 6581 model the plain digi's steps run from 537 to 748 (the sixteen
levels lie up to 0.71 of a step off a straight line), on the 8580 model
from 88 to 102 (0.11 of a step). Each setup's settle block, `$00` against
`$00`, reads within 5 units of zero, and one value's level varies by at
most 29.6 units within its block.

What the rows say:

- A plain digi (setup 2) on the 8580 model steps 93.5 against 640.4 on
  the 6581 model: 6.8 times smaller, 16.7 dB quieter. That is the "near
  silent" 8580 digi, in reSID. What a real 8580 gives is not measured
  here.
- One bias voice (setup 3) does not help the 8580 model: the step keeps
  its size and flips sign (−91.8). The voice's level and the silent
  chip's own level oppose each other.
- Three bias voices (setup 4) make the 8580 model's step 482.3, 5.2 times
  the plain digi and 0.75 of the 6581 model's plain digi (2.5 dB below
  it). On the 6581 model they make the step 3.2 times its plain digi.
- Routing every voice to the filter with no mode bit set (setups 0 and 1)
  silences the volume step completely on both models, bias voices or
  not: the voices and whatever idle level they carry reach the output
  only through a mode bit. A player that sets `$D417` routing bits while
  it clears the mode bits kills a `$D418` digi playing beside it.
- VICE's "digi boost" engine turns the 8580 model into one with a large
  plain-digi step, 777.1, larger than the 6581 model's. Bias voices then
  work against it: three of them cut the step to 267.2. It is an emulator
  switch; this page does not say what hardware it stands for.

## Why this works

`$D418`'s low nibble scales the sum of what reaches the output: the voices
not routed to the filter, the filter's output, and any idle level the
chip carries. A digi moves that nibble, so the step it makes is
proportional to that sum. With no voice sounding the sum is only the
idle level. In reSID the 6581 model's idle level is several times larger
than the 8580 model's, so a plain digi is loud on one and quiet on the
other. A bias voice adds a constant: with TEST set the pulse output is
high whatever the pulse width (`hardware/sid-reference.md`, TEST), and at
sustain 15 its envelope holds it at full scale. Three of them outweigh
the idle level; one, on the 8580 model, only cancels it.

The routing result is the filter's: a voice with its `$D417` bit set goes
to the filter input and not to the output, and with LP, BP and HP all
clear the filter passes nothing (the `$D418` mode-bit entry in
`hardware/sid-reference.md`). Setup 1 shows the idle level takes the
same path: in reSID it belongs to the voices, since routing them all
away removes it.

The timing proves only that each value held for its 492 cycles.
Timer A is continuous at 492 cycles; `tick` polls its flag, and timer B
counts underflows from `$FFFF`, started straight after one. Two
underflows between two polls would count once in the loop and twice in
timer B, and the count would not match. The screen stays on under `sei`; a badline's 43 cycles are far
inside 492.

Verified: assembled with KickAssembler 5.25, run headless in the
windowless VICE x64sc 3.10 with the pinned command on PAL and NTSC,
screenshots decoded with the char ROM. The sound figures are from the WAVs
the same build wrote, analysed in Python and not heard; they are reSID's,
and no SID chip was measured.
