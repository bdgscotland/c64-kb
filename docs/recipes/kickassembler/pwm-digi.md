---
recipe: pwm-digi
toolchain: kickassembler
output_format: PRG
region: both
techniques: [pwm_digi]
file_formats: [PRG]
uses_registers: [D400, D401, D402, D403, D404, D405, D406, D418, D020, DD04, DD05, DD06, DD07, DD0D, DD0E, DD0F]
uses_kernal: [CHROUT]
---

<!-- doc-type: recipe -->

# KickAssembler PWM Digi: an 8-bit sample through voice 1's pulse width

## Synopsis

A sample player that never touches the volume register after setup. Voice 1
runs the pulse waveform at the highest SID frequency, `$FFFF`, and the
program rewrites the pulse width from an 8-bit sample every 128 cycles,
paced by CIA 2 timer A. The duty cycle of the pulse carries the sample and
the SID's output stage averages it into audio. The sample is 256 bytes
holding eight periods of a sine, so the tone is the sample rate over 32:
240.5 Hz on PAL, 249.7 Hz on NTSC. CIA 2 timer B counts timer A underflows,
and the verdict compares that count with the number of samples written: a
code at `$02FF` (01 pass, 02 fail), the border colour, and a line of text.
The technique is `pwm_digi` in `techniques/music-sid.md`.

## Source

```asm
// pwm-digi.asm
// Pulse-width-modulation digi on voice 1: the pulse waveform runs at the
// highest SID frequency ($FFFF) and its pulse width is rewritten from an
// 8-bit sample every 128 cycles, paced by CIA 2 timer A. CIA 2 timer B
// counts timer A underflows, so after the last sample the program can
// check that it wrote exactly one sample per timer period. Verdict at
// $02FF (01 pass, 02 fail), border green or red, and a line of text.
BasicUpstart2(start)

.const CHROUT   = $ffd2
.const RESULT   = $02ff
.const BORDER   = $d020

.const PERIOD   = 128            // cycles per sample; timer latch is PERIOD-1
.const REPS     = 64             // table passes; samples = 256 * REPS = 16384
.const EXPECT_TB = $ffff - 256 * REPS   // timer B after that many underflows

.const CODE_PASS = $01
.const CODE_FAIL = $02

start:
    // print the header lines before any timing-critical work
    ldx #0
!:
    lda header,x
    beq !+
    jsr CHROUT
    inx
    bne !-
!:
    // split the 8-bit sample into the two pulse-width bytes:
    // PWLO = sample << 4 (bits 7-4), PWHI = sample >> 4 (bits 3-0)
    ldx #0
split:
    lda sample,x
    lsr
    lsr
    lsr
    lsr
    sta pwhi,x
    lda sample,x
    asl
    asl
    asl
    asl
    sta pwlo,x
    inx
    bne split

    sei
    // silence CIA 2 as an NMI source and clear anything pending
    lda #$7f
    sta $dd0d
    lda $dd0d

    // voice 1: highest frequency, attack 0 / decay 0, sustain 15 / release 0,
    // pulse waveform gated on; master volume 15, no filter
    lda #$ff
    sta $d400
    sta $d401
    lda #$00
    sta $d405
    lda #$f0
    sta $d406
    lda #$0f
    sta $d418
    lda pwlo
    sta $d402
    lda pwhi
    sta $d403
    lda #$41
    sta $d404

    // timer B: count timer A underflows from $FFFF, started first so that
    // it sees every underflow; timer A: continuous, PERIOD cycles
    lda #$ff
    sta $dd06
    sta $dd07
    lda #$51                     // start, force load, input = timer A underflow
    sta $dd0f
    lda #<(PERIOD - 1)
    sta $dd04
    lda #>(PERIOD - 1)
    sta $dd05
    lda #$11                     // start, force load, continuous, phi2 clock
    sta $dd0e

    ldx #0
    ldy #REPS
play:
    lda $dd0d                    // 4  bit 0 set = timer A underflowed
    and #$01                     // 2
    beq play                     // 2  (3 when looping)
    lda pwlo,x                   // 4, 5 when x crosses a page (x >= 2 here)
    sta $d402                    // 4
    lda pwhi,x                   // 4, 5 when x crosses a page (x >= 2 here)
    sta $d403                    // 4
    inx                          // 2
    bne play                     // 3  one table pass = 256 samples
    dey                          // 2
    bne play                     // 3

    // the last flag was consumed a few cycles ago; timer B now holds
    // $FFFF minus the number of underflows, if the loop never fell behind
    lda $dd06
    sta tb_lo
    lda $dd07
    sta tb_hi
    lda #$00
    sta $dd0e                    // stop both timers
    sta $dd0f
    lda #$40                     // pulse, gate off: release 0 ends the tone
    sta $d404
    cli

    lda tb_lo
    cmp #<EXPECT_TB
    bne fail
    lda tb_hi
    cmp #>EXPECT_TB
    bne fail
    lda #CODE_PASS
    ldy #5                       // green
    bne checkpoint
fail:
    lda #CODE_FAIL
    ldy #2                       // red
checkpoint:
    sta RESULT
    sty BORDER

    // "RESULT hh PASS" / "RESULT hh FAIL", then the timer B reading
    ldx #0
!:
    lda text,x
    beq !+
    jsr CHROUT
    inx
    bne !-
!:
    lda RESULT
    jsr hexbyte
    lda RESULT
    cmp #CODE_PASS
    beq pass
    ldx #0
!:
    lda failtext,x
    beq tbline
    jsr CHROUT
    inx
    bne !-
pass:
    ldx #0
!:
    lda passtext,x
    beq tbline
    jsr CHROUT
    inx
    bne !-
tbline:
    ldx #0
!:
    lda tbtext,x
    beq !+
    jsr CHROUT
    inx
    bne !-
!:
    lda tb_hi
    jsr hexbyte
    lda tb_lo
    jsr hexbyte
    lda #$0d
    jsr CHROUT
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
!:
    adc #'0'
    jmp CHROUT

tb_lo: .byte 0
tb_hi: .byte 0

.encoding "petscii_upper"
header:
    .text "PWM DIGI, VOICE 1, PULSE AT FN=$FFFF"
    .byte $0d
    .text "CARRIER 3849 HZ PAL / 3995 HZ NTSC"
    .byte $0d
    .text "128 CYCLES PER SAMPLE"
    .byte $0d
    .text "RATE 7697 HZ PAL / 7990 HZ NTSC"
    .byte $0d
    .text "TONE 240 HZ PAL / 250 HZ NTSC"
    .byte $0d, 0
text:     .text "RESULT "
          .byte 0
passtext: .text " PASS"
          .byte $0d, 0
failtext: .text " FAIL"
          .byte $0d, 0
tbtext:   .text "TIMER B $"
          .byte 0

// 256 unsigned 8-bit samples, 8 sine periods per table (gen_sample.py)
sample:
    .byte $80, $98, $b0, $c6, $da, $ea, $f5, $fd, $ff, $fd, $f5, $ea, $da, $c6, $b0, $98
    .byte $80, $67, $4f, $39, $25, $15, $0a, $02, $00, $02, $0a, $15, $25, $39, $4f, $67
    .byte $7f, $98, $b0, $c6, $da, $ea, $f5, $fd, $ff, $fd, $f5, $ea, $da, $c6, $b0, $98
    .byte $80, $67, $4f, $39, $25, $15, $0a, $02, $00, $02, $0a, $15, $25, $39, $4f, $67
    .byte $7f, $98, $b0, $c6, $da, $ea, $f5, $fd, $ff, $fd, $f5, $ea, $da, $c6, $b0, $98
    .byte $80, $67, $4f, $39, $25, $15, $0a, $02, $00, $02, $0a, $15, $25, $39, $4f, $67
    .byte $7f, $98, $b0, $c6, $da, $ea, $f5, $fd, $ff, $fd, $f5, $ea, $da, $c6, $b0, $98
    .byte $80, $67, $4f, $39, $25, $15, $0a, $02, $00, $02, $0a, $15, $25, $39, $4f, $67
    .byte $7f, $98, $b0, $c6, $da, $ea, $f5, $fd, $ff, $fd, $f5, $ea, $da, $c6, $b0, $98
    .byte $80, $67, $4f, $39, $25, $15, $0a, $02, $00, $02, $0a, $15, $25, $39, $4f, $67
    .byte $7f, $98, $b0, $c6, $da, $ea, $f5, $fd, $ff, $fd, $f5, $ea, $da, $c6, $b0, $98
    .byte $80, $67, $4f, $39, $25, $15, $0a, $02, $00, $02, $0a, $15, $25, $39, $4f, $67
    .byte $7f, $98, $b0, $c6, $da, $ea, $f5, $fd, $ff, $fd, $f5, $ea, $da, $c6, $b0, $98
    .byte $7f, $67, $4f, $39, $25, $15, $0a, $02, $00, $02, $0a, $15, $25, $39, $4f, $67
    .byte $7f, $98, $b0, $c6, $da, $ea, $f5, $fd, $ff, $fd, $f5, $ea, $da, $c6, $b0, $98
    .byte $80, $67, $4f, $39, $25, $15, $0a, $02, $00, $02, $0a, $15, $25, $39, $4f, $67

pwlo: .fill 256, 0
pwhi: .fill 256, 0
```

The sample table was produced by this script and pasted in; the listing
does not depend on it at build time:

```text
#!/usr/bin/env python3
# gen_sample.py: 256 unsigned 8-bit samples holding 8 periods of a sine,
# printed as KickAssembler .byte lines.
import math
CYCLES = 8
vals = [round(127.5 + 127.5 * math.sin(2 * math.pi * CYCLES * i / 256))
        for i in range(256)]
vals = [max(0, min(255, v)) for v in vals]
for row in range(0, 256, 16):
    print("    .byte " + ", ".join("$%02x" % v for v in vals[row:row + 16]))
```

## Build

```bash
java -jar KickAss.jar pwm-digi.asm -o pwm-digi.prg -showmem
```

Produces `pwm-digi.prg`, code and data from `$080e` to `$0cfd`
(KickAssembler 5.25, `-showmem`): 256 bytes of sample, two 256-byte
pulse-width tables filled at start, and the rest code and text.

## Expected output

Border green. Text area still the power-on blue. Screen rows 7 to 13:

```
PWM DIGI, VOICE 1, PULSE AT FN=$FFFF
CARRIER 3849 HZ PAL / 3995 HZ NTSC
128 CYCLES PER SAMPLE
RATE 7697 HZ PAL / 7990 HZ NTSC
TONE 240 HZ PAL / 250 HZ NTSC
RESULT 01 PASS
TIMER B $BFFF
```

`TIMER B $BFFF` is `$FFFF` less 16,384, the number of samples: one timer A
underflow per sample and none missed. Screenshots from the pinned run,
8,000,000 cycles: `screenshots/pwm-digi.png` (PAL) and
`screenshots/pwm-digi-ntsc.png` (NTSC), decoded with the char ROM: the
seven lines above on rows 7 to 13 on both models, border pixel (2, 100) =
(98, 213, 50) on PAL and (114, 189, 103) on NTSC, palette index 5. Each
model was run twice and the two PNGs were byte-identical.

The numbers on screen are arithmetic from the constants in the listing and
the two clocks (985,248 Hz PAL, 1,022,727 Hz NTSC): carrier
`65535 × clock ÷ 16,777,216`, sample rate `clock ÷ 128`, tone `rate ÷ 32`.
The tone was measured, see below.

## The sound, measured without ears

Nobody listened to this. The PAL build was run without `-warp` with
`-sound -sounddev wav -soundarg out.wav -limitcycles 5500000`, once with
`-sidmodel 0` (reSID 6581) and once with `-sidmodel 1` (reSID 8580); the
windowless build has the `wav` driver (its log lists
`coreaudio dummy dump fs wav voc iff aiff soundmovie`). VICE wrote a 48,000 Hz
mono 16-bit file of 2.582 s, and reported `resampling, pass to 21600Hz`.
A Python script (`wave` and `numpy`) found the tone by RMS, from 0.060 s to
2.220 s of the file, 2.160 s, against 16,384 × 128 ÷ 985,248 = 2.129 s by
arithmetic.

| Measurement | reSID 6581 | reSID 8580 |
|---|---|---|
| Strongest raw component above 1 kHz | 3,848.6 Hz | 3,848.6 Hz |
| Dominant component after a 12-sample (250 µs) moving average, 20 Hz to 1 kHz | 240.5 Hz | 240.5 Hz |
| Rising zero crossings of the averaged signal | 240.3 Hz | 238.5 Hz |
| Carrier line relative to the tone line | −7 dB | −7 dB |
| Carrier sidebands at ±240.5 Hz, relative to the carrier line | −8 dB, −8 dB | −8 dB, −8 dB |
| Second harmonic of the tone, 481.1 Hz | −42 dB | −42 dB |
| RMS of the averaged signal, 16-bit units | 3,358 | 2,494 |

The dB rows are from a second script (`analyse_db.py` beside the first):
the raw file from 0.2 s to 2.1 s, a Hann window, eight times zero padding,
the peak magnitude within 3 Hz of each arithmetic frequency, ratios of
those peaks. They are given to the whole decibel because the choice of
window and segment moves them by up to a decibel (an earlier version of
this table gave them to a tenth, from a script that was not kept).

The carrier is `65535 × 985,248 ÷ 16,777,216 = 3,848.6 Hz` by arithmetic
and the measured raw peak agrees to the tenth. The recovered tone is
240.5 Hz, which is `985,248 ÷ 128 ÷ 32 = 240.54 Hz`; a 127-cycle period
would have given 242.4 Hz, so the measurement also settles that a CIA
latch of 127 is a 128-cycle period. The carrier is not above the audible
band (the SID cannot go higher than `$FFFF`), and at about 7 dB below the
tone it is audible as a whistle in this recording; that is a property of the
method, not of this listing. The 8580 model is quieter by the ratio
2,494 ÷ 3,358 = 0.74, about 2.6 dB, with the same spectrum; reSID's two
models differ in level here, not in shape. A real 6581 or 8580 was not
measured.

## Why this works

The pulse comparator turns the top twelve bits of the 24-bit phase
accumulator into a one-bit output: high while they are at or above the
pulse width. At `$FFFF` the accumulator advances by 65,535 every cycle, so
one pulse period is 16,777,216 ÷ 65,535 = 256.004 cycles. Within that
period the output is high for a fraction the pulse width sets, and the
mean of the voice output over a period is that fraction times full scale.
The envelope is held at sustain 15 (attack 0, sustain 15, gate on and left
on), so the voice output is the waveform at full amplitude and the mean
follows the pulse width alone. Everything downstream of the voice, the
mixer, the output amplifier and the coupling to the speaker, averages a
3.85 kHz square wave the way any low-pass does; the moving average in the
analysis script stands in for that.

The sample is written as two bytes: bits 7 to 4 into `$D402` bits 7 to 4
and bits 3 to 0 into `$D403` bits 3 to 0, so 256 sample levels map on to
the 12-bit pulse width in steps of 16. Nothing is lost by that: at `$FFFF`
the top twelve bits of the accumulator step by 16 each cycle (65,535 ÷
4,096 = 15.99), so the low four bits of the pulse width are below the
phase step, and the 8-bit sample in bits 11 to 4 already uses every duty
level the carrier can resolve in one period, 4,096 ÷ 16 = 256 of them.

Two tables are built at start so that the loop is two loads and two
stores per sample. On the passing path the body is 31 cycles by the
instruction table: the poll `lda $DD0D` / `and #1` / `beq` is 8, the two
loads, two stores, `inx` and taken `bne` are 21, and both `lda abs,x`
cross a page for one more cycle each, because KickAssembler places
`pwlo` at `$0AFE` and `pwhi` at `$0BFE`, so every index from 2 upward
reads into the next page (an earlier version of this page said 32, which
was neither the 29 the annotations then summed to nor the 31 the
placement gives; a `.align $100` before `pwlo` would make it 29). The
loads and stores without the poll were timed on their own: a variant with
the three poll instructions removed, timer A free-running from `$FFFF`
and the screen blanked took 43,220 cycles over 2,048 samples, 21.1 per
sample, which is the 21 of the table plus the `dey` / `bne` once per 256.
Against a 128-cycle period the verdict shows the loop never fell behind
on either model. The remaining 97 cycles per sample are the budget a real
program has for everything else, less what the VIC-II takes: with the
screen on, a badline stalls the CPU for 40 to 43 cycles once every eight
raster lines, and any IRQ or NMI adds jitter to the write times. This
listing runs under `sei` with the screen on.

The floor is well above 31 with the screen on, and the reason is the
badline. `PERIOD` was swept on PAL with everything else unchanged,
6,000,000 cycles per run, and the screen read with the char ROM; two rows
were then repeated with `$D011 = $0B` written before the loop and `$1B`
after it, which blanks the display and stops badline DMA:

| `PERIOD` | Screen | Verdict | Timer B | Underflows against 16,384 samples |
|---|---|---|---|---|
| 28 | on | 02 FAIL | `$B506` | 19,193 |
| 30 | on | 02 FAIL | `$BA02` | 17,917 |
| 31 | on | 02 FAIL | `$BC43` | 17,340 |
| 32 | on | 02 FAIL | `$BD42` | 17,085 |
| 33 | on | 02 FAIL | `$BD2A` | 17,109 |
| 34 | on | 02 FAIL | `$BD10` | 17,135 |
| 36 | on | 02 FAIL | `$BCE6` | 17,177 |
| 32 | blanked | 02 FAIL | `$BFFE` | 16,385 |
| 36 | blanked | 01 PASS | `$BFFF` | 16,384 |
| 128 | on | 01 PASS | `$BFFF` | 16,384 |

Below 31 the loop is too slow and the excess is large. From 32
upward the excess grows with the period instead of shrinking, which a
loop that is merely too slow cannot produce. It is the badline: the poll
reads and clears the flag, so two underflows between one poll and the
next count as one sample, and a badline puts 40 to 43 cycles between two
polls that are otherwise 31 apart. At any period below about 31 + 43 =
74 cycles a badline can swallow an underflow, and a longer period means a
longer run, 16,384 × `PERIOD` cycles, which crosses more badlines: at
`PERIOD` 32 the run is 524,288 cycles, 26.7 PAL frames of 19,656, about
667 badlines at 25 a frame, and the excess was 701; at 36 it is 750
badlines against an excess of 793. With the screen blanked `PERIOD` 36
keeps exact pace. `PERIOD` 32 blanked reads one underflow too many, and
that one is the readout, not a lost sample: timer B is read 34 cycles
after the last poll's read of `$DD0D` by the instruction table, and the
poll itself can be up to nine cycles late in seeing the flag, so at a
period of 32 the next underflow lands before the read, while at 36 it
does not. Periods between 36 and 128 were not tried, and the CIA model is
not the variable (`PERIOD` 32 with `-ciamodel 1` gave the same `$BD42`).
A program that needs a rate near the loop's floor should measure its own
period the way this listing does, with timer B, with the display it will
run under.

CIA 2 is used rather than CIA 1 so that the KERNAL's jiffy timer keeps
running and nothing has to be restored on exit. Writing `$7F` to `$DD0D`
and reading it once masks and clears CIA 2 as an NMI source; the RESTORE
key is not a CIA source and would still fire, which this listing does not
guard against. Timer B is started before timer A with input mode 10
(count timer A underflows), so it sees the first underflow; the pass
condition is timer B = `$FFFF` − 16,384 exactly, read a few cycles after
the last flag was consumed and before the next underflow.

Verified: assembled with KickAssembler 5.25, run headless in the
windowless VICE x64sc 3.10 build with the pinned command on PAL and NTSC,
screenshots decoded with the char ROM; the sound figures are from the WAV
the same build wrote, analysed in Python, not heard.
