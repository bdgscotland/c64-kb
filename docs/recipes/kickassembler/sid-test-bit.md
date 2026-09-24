---
recipe: sid-test-bit
toolchain: kickassembler
output_format: PRG
region: both
techniques: [sid_test_bit_and_osc_reset_tricks]
file_formats: [PRG]
uses_registers: [D011, D012, D40E, D40F, D411, D412, D413, D414, D418, D41B, D020]
uses_kernal: [CHROUT]
claims: [sid_voice_3 (owns), sid_filter_volume (owns), vic_raster_irq (init), zero_page $FB-$FC (owns)]
harness: [$02FF]
---

<!-- doc-type: recipe -->

# KickAssembler SID TEST bit: oscillator reset and the noise lock, read back through OSC3

## Synopsis

Two things the TEST bit (`$D412` bit 3 for voice 3) does, measured by
reading `$D41B` (OSC3). First, TEST resets the phase accumulator: after
TEST is set and cleared, OSC3 reads the same values at the same cycle
offsets whatever phase the oscillator had before, so a note started this
way starts at a known phase. Second, noise combined with another waveform
locks the noise generator at zero, and only TEST unlocks it: turning the
waveform off does not. The program runs both, prints what it read, and
grades itself. The technique is `sid_test_bit_and_osc_reset_tricks` in
`techniques/music-sid.md`. The figures are reSID's model in VICE 3.10,
not a SID chip.

## Source

```asm
// sid-test-bit.asm
// What the TEST bit ($D412 bit 3) does to voice 3's oscillator, read
// back through $D41B (OSC3):
// 1. Oscillator reset. Sawtooth at F = $FFFF. Eight trials, each after
//    a different delay: set TEST, clear it, read OSC3 four times 69
//    cycles apart. Then the same eight trials without TEST. The screen
//    is off for all of it, so no badline moves a read.
// 2. Noise lock. Noise at F = $2000, gated, sustain 15: 32 reads of
//    OSC3. Then noise + pulse ($C1) for 400 cycles and noise alone
//    again: 32 reads. Then no waveform for 51,000 cycles and noise
//    again: 32 reads. Then a TEST pulse and noise: 32 reads.
// Verdict at $02FF (01 pass, 02 fail), border green or red, text.
BasicUpstart2(start)

.const CHROUT   = $ffd2
.const RESULT   = $02ff
.const BORDER   = $d020
.label ptr      = $fb            // zero-page pointer for print

.const CODE_PASS = $01
.const CODE_FAIL = $02

start:
    sei
    lda #$0b                     // screen off: no badline stalls between
    sta $d011                    // the timed reads. DEN counts from the
!:  lda $d012                    // next line $30, so wait for line 0
    bne !-                       // first (bit 8 is clear: $0B)
    lda #$0f
    sta $d418                    // volume 15, no filter
    lda #$00
    sta $d413                    // voice 3: attack 0, decay 0,
    lda #$f0                     // sustain 15, release 0
    sta $d414

    // ---- 1. oscillator reset ----
    lda #$ff
    sta $d40e
    sta $d40f                    // F = $FFFF: one saw period ~256 cycles
    lda #$20
    sta $d412                    // sawtooth running
    ldy #0
t1: jsr vdelay                   // 23 + 7 * y cycles: a different phase
    lda #$28                     // sawtooth + TEST: accumulator to 0
    sta $d412
    lda #$20                     // TEST cleared
    sta $d412
    lda $d41b                    // 4 cycles after the release
    sta rst,y
    jsr wait69
    lda $d41b
    sta rst + 8,y
    jsr wait69
    lda $d41b
    sta rst + 16,y
    jsr wait69
    lda $d41b
    sta rst + 24,y
    iny
    cpy #8
    bne t1
    ldy #0
t2: jsr vdelay                   // the same trials, no TEST
    lda #$20
    sta $d412
    lda #$20
    sta $d412
    lda $d41b
    sta free,y
    iny
    cpy #8
    bne t2

    // ---- 2. noise lock ----
    lda #$00
    sta $d40e
    lda #$20
    sta $d40f                    // F = $2000: an LFSR step every 128 cycles
    lda #$08
    sta $d411                    // pulse width $800
    lda #$89                     // TEST pulse, then noise + gate
    sta $d412
    lda #$81
    sta $d412
    jsr halfsec
    jsr reads32
    stx n_free
    sta o_free
    lda #$c1                     // noise + pulse + gate
    sta $d412
    ldx #80                      // 80 * 5 cycles
!:  dex
    bne !-
    lda #$81                     // noise alone again
    sta $d412
    jsr halfsec
    jsr reads32
    stx n_lock
    sta o_lock
    lda #$01                     // gate on, no waveform: 51,000 cycles
    sta $d412
    ldy #40
!:  ldx #0
!:  dex
    bne !-
    dey
    bne !--
    lda #$81
    sta $d412
    jsr halfsec
    jsr reads32
    stx n_off
    sta o_off
    lda #$89                     // TEST pulse
    sta $d412
    lda #$81
    sta $d412
    lda $d41b                    // 4 cycles after the release
    sta first
    jsr halfsec
    jsr reads32
    stx n_back
    sta o_back
    lda #$80                     // gate off
    sta $d412
    lda #$1b                     // screen on
    sta $d011
    cli

    // ---- verdict ----
    ldy #CODE_FAIL
    ldx #7
!:  lda rst,x                    // TEST trials: all eight rows equal
    cmp rst
    bne verdict
    lda rst + 8,x
    cmp rst + 8
    bne verdict
    lda rst + 16,x
    cmp rst + 16
    bne verdict
    lda rst + 24,x
    cmp rst + 24
    bne verdict
    dex
    bne !-
    ldx #7                       // free trials: not all equal
!:  lda free,x
    cmp free
    bne !+
    dex
    bne !-
    beq verdict
!:  lda o_lock                   // locked twice: every read $00
    ora o_off
    bne verdict
    lda n_free                   // noise before and after: 16 or more
    cmp #16                      // distinct values of 32
    bcc verdict
    lda n_back
    cmp #16
    bcc verdict
    ldy #CODE_PASS
verdict:
    sty RESULT
    lda #2                       // red
    cpy #CODE_PASS
    bne !+
    lda #5                       // green
!:  sta BORDER

    ldx #<t_rst
    ldy #>t_rst
    jsr print
    lda #0
    sta row
!:  ldx #<t_trial
    ldy #>t_trial
    jsr print
    lda row
    jsr hexbyte
    lda #':'
    jsr CHROUT
    ldx row
    ldy #4
!:  lda #' '
    jsr CHROUT
    lda rst,x
    jsr hexbyte
    txa
    clc
    adc #8
    tax
    dey
    bne !-
    lda #$0d
    jsr CHROUT
    inc row
    lda row
    cmp #8
    bne !--
    ldx #<t_free
    ldy #>t_free
    jsr print
    ldx #0
!:  lda #' '
    jsr CHROUT
    lda free,x
    jsr hexbyte
    inx
    cpx #8
    bne !-
    ldx #<t_noise
    ldy #>t_noise
    jsr print
    lda n_free
    ldx o_free
    jsr stat
    ldx #<t_lock
    ldy #>t_lock
    jsr print
    lda n_lock
    ldx o_lock
    jsr stat
    ldx #<t_off
    ldy #>t_off
    jsr print
    lda n_off
    ldx o_off
    jsr stat
    ldx #<t_back
    ldy #>t_back
    jsr print
    lda first
    jsr hexbyte
    ldx #<t_then
    ldy #>t_then
    jsr print
    lda n_back
    ldx o_back
    jsr stat
    ldx #<t_res
    ldy #>t_res
    jsr print
    lda RESULT
    jsr hexbyte
    ldx #<t_pass
    ldy #>t_pass
    lda RESULT
    cmp #CODE_PASS
    beq !+
    ldx #<t_fail
    ldy #>t_fail
!:  jmp print

vdelay:                          // 23 + 7 * y cycles with the jsr
    tya
    tax
    inx
!:  dex                          // 2
    beq !+                       // 2 (3 on exit)
    bne !-                       // 3
!:  rts

wait69:                          // 69 cycles from one $D41B read to the
    ldx #9                       // next, with the sta, jsr and rts
!:  dex
    bne !-
    nop
    rts

halfsec:                         // about 492,000 cycles
    lda #192
    sta cnt
!:  ldx #0
!:  dex
    bne !-
    dex
!:  dex
    bne !-
    dec cnt
    bne !---
    rts

reads32:                         // 32 reads ~650 cycles apart; X = distinct
    lda #0                       // values among them, A = their OR
    ldx #31
!:  sta seen,x                   // clear the 256-bit "seen" map
    dex
    bpl !-
    sta orv
    sta ndist
    lda #32
    sta cnt
rloop:
    lda $d41b
    tay
    ora orv
    sta orv
    tya
    lsr
    lsr
    lsr
    tax                          // byte index = value / 8
    tya
    and #7
    tay
    lda bits,y
    and seen,x
    bne !+                       // seen before
    lda bits,y
    ora seen,x
    sta seen,x
    inc ndist
!:  ldx #120
!:  dex
    bne !-
    dec cnt
    bne rloop
    ldx ndist
    lda orv
    rts

stat:                            // print "N DISTINCT, OR $hh"
    stx orv
    jsr hexbyte
    ldx #<t_dist
    ldy #>t_dist
    jsr print
    lda orv
    jsr hexbyte
    lda #$0d
    jmp CHROUT

print:                           // print the zero-terminated text at Y:X
    stx ptr
    sty ptr + 1
    ldy #0
!:  lda (ptr),y
    beq !+
    jsr CHROUT
    iny
    bne !-
!:  rts

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

bits:   .byte $01, $02, $04, $08, $10, $20, $40, $80
rst:    .fill 32, 0              // four reads per TEST trial, by read
free:   .fill 8, 0
seen:   .fill 32, 0
first:  .byte 0
cnt:    .byte 0
orv:    .byte 0
ndist:  .byte 0
row:    .byte 0
n_free: .byte 0
o_free: .byte 0
n_lock: .byte 0
o_lock: .byte 0
n_off:  .byte 0
o_off:  .byte 0
n_back: .byte 0
o_back: .byte 0

.encoding "petscii_upper"
t_rst:   .text "SAW $FFFF, TEST SET THEN CLEARED,"
         .byte $0d
         .text "OSC3 READ 4, 73, 142, 211 CYCLES LATER"
         .byte $0d, 0
t_trial: .text "TRIAL "
         .byte 0
t_free:  .text "NO TEST: "
         .byte 0
t_noise: .byte $0d
         .text "NOISE:       $"
         .byte 0
t_lock:  .text "AFTER N+P:   $"
         .byte 0
t_off:   .text "AFTER OFF:   $"
         .byte 0
t_back:  .text "TEST PULSE: FIRST $"
         .byte 0
t_then:  .byte $0d
         .text "  THEN       $"
         .byte 0
t_dist:  .text " DISTINCT, OR $"
         .byte 0
t_res:   .text "RESULT "
         .byte 0
t_pass:  .text " PASS"
         .byte $0d, 0
t_fail:  .text " FAIL"
         .byte $0d, 0
```

## Build

```bash
java -jar KickAss.jar sid-test-bit.asm -o sid-test-bit.prg -showmem
```

Produces `sid-test-bit.prg`, `$080e` to `$0c0b` (KickAssembler 5.25,
`-showmem`).

## Expected output

Border green. On PAL (VICE's default C64C, SID 8580) screen rows 5 to 21:

```
SAW $FFFF, TEST SET THEN CLEARED,
OSC3 READ 4, 73, 142, 211 CYCLES LATER
TRIAL 00: 02 47 8C D1
TRIAL 01: 02 47 8C D1
TRIAL 02: 02 47 8C D1
TRIAL 03: 02 47 8C D1
TRIAL 04: 02 47 8C D1
TRIAL 05: 02 47 8C D1
TRIAL 06: 02 47 8C D1
TRIAL 07: 02 47 8C D1
NO TEST:  05 3F 80 C8 17 6D CA 2E
NOISE:       $1F DISTINCT, OR $FF
AFTER N+P:   $01 DISTINCT, OR $00
AFTER OFF:   $01 DISTINCT, OR $00
TEST PULSE: FIRST $01
  THEN       $1E DISTINCT, OR $FF
RESULT 01 PASS
```

With `-model c64` (PAL, SID 6581) the eight trial rows read
`03 48 8D D2`, the no-TEST row `06 40 81 C9 18 6E CB 2F`, and the other
rows are the same. `$D41B` returns meaningless values under `+sound`
(`runtime/vice-reference.md`), so the pinned runs use the dump sink
(`-sound -sounddev dump -soundarg /dev/null`), 10,000,000 cycles.
`screenshots/sid-test-bit.png` (PAL) reads as above.
`screenshots/sid-test-bit-ntsc.png` (`-model ntsc`, whose SID is a 6581)
reads the same rows as the 6581 model. Border pixel (2, 100) is palette index 5 on
both. Decoded with the char ROM.

What the rows say:

- **The reset.** Every trial reads the same four values, while the eight
  trials without TEST read eight different ones. At `F = $FFFF` the
  accumulator's top byte gains one a cycle, so OSC3 counts the cycles
  since the release: the reads 4, 73, 142 and 211 cycles after the store
  that cleared TEST give 3, 72, 141 and 210 on the 6581 model and one
  less on the 8580 model. The 69-cycle spacing is the instruction count
  between reads (`sta abs,y` 5, `jsr` 6, the wait 48, `rts` 6, the load
  to its read cycle 4). The one-cycle difference between the models is
  the value the `$D41B` model check reads (`sid_8580_vs_6581_differences`).
  A first version with the screen on read other values in three of the
  eight trials: a badline had stalled the CPU between two reads. A second
  version wrote `$0B` to `$D011` and started at once; it passed on PAL
  and failed on NTSC in four trials, because DEN is sampled once a frame,
  on line `$30`, and that frame's badlines had already been decided. The
  listing waits for line 0 after blanking.
- **The lock.** Noise at `F = $2000` gives 31 different values in 32
  reads. After 400 cycles of noise + pulse (`$C1`) and a return to noise
  alone, all 32 reads, taken from half a second later, are `$00`. After 51,000
  cycles with no waveform selected and a return to noise, still `$00`.
- **The unlock.** A TEST pulse (`$89` then `$81`) makes the next read
  `$01`, and noise runs again: 30 different values in 32 reads.

## The sound, measured without ears

Nobody listened to this. The PAL build was run without warp with
`-sound -sounddev wav -soundarg out.wav -soundrate 48000 -soundoutput 1
-limitcycles 6500000`, with `-model c64` (reSID 6581) and with the
default model (reSID 8580); each WAV is 3.60 s. The RMS of each 50 ms
window, mean removed, in 16-bit units, over the windows wholly inside
each stretch:

| Stretch | reSID 6581 | reSID 8580 |
|---|---|---|
| Noise, 0.6 s | 2,423 to 2,598, median 2,487 | 1,880 to 2,004, median 1,915 |
| Locked, then no waveform, then locked, 1.05 s | 2 | 3 |
| Noise after the TEST pulse, 0.55 s | 2,292 to 2,597, median 2,465 | 1,780 to 2,011, median 1,907 |
| After the gate is cleared | 19 to 20 | 6 |

The locked noise voice is silent, with its gate on and its envelope at
sustain 15: the waveform it scales is zero. After the TEST pulse the
level is back to the free-running level. The window that straddles the
pulse is lower, and is left out of the table, since the register fills
from the single 1 that the pulse shifted in.

## Why this works

TEST holds the 24-bit phase accumulator at zero while it is set. When it
clears, the accumulator counts up from zero again, adding F every cycle,
so the phase at any later cycle depends only on the time since the
release. A sawtooth, triangle or pulse note started with a TEST pulse
therefore starts at the same point of its wave every time, which is what
a drum or a phase-locked pair of voices needs (`hardware/sid-reference.md`,
TEST and hard restart). Without TEST, the phase at the note's start is
wherever the free-running accumulator happens to be.

Noise comes from a 23-bit shift register that steps when bit 19 of the
accumulator rises: every 2^20 ÷ F cycles, 128 at `F = $2000`. reSID's
source in VICE 3.10 (`src/resid/wave.h`, read on this machine) says the
rest. Its feedback is `bit0 = (bit22 OR TEST) XOR bit17`. While noise
and another waveform are both selected, and TEST is clear, every cycle
ANDs the combined output back into the eight register bits that feed
the noise output (`write_shift_register`), so those bits can only fall
to zero, and the zeros shift on through the register. From all zeros
the feedback is zero, so the register stays there: that is the lock.
Deselecting the waveform, or waiting, changes nothing. A step taken with
TEST set feeds `1 XOR bit17` into bit 0, a 1 from all zeros; that is the
`$01` read after the pulse, and the register runs again from it. The
source's comment on that write-back says its effect on real chips still
wants a test program; this page is that test in reSID, not on silicon.

The shorter holds were tried in a variant of this listing with the hold
varied: 60 cycles of noise + pulse left the noise running and 80 cycles
locked it, on both models. That fits one register step with the combined
waveform selected being enough, but the step times were not traced.
Noise + pulse at pulse widths `$000`, `$800` and `$FFF`, noise + saw,
noise + triangle, all four waveforms, and noise + pulse with the gate
off locked it in 400 cycles as well.

Verified: assembled with KickAssembler 5.25, run headless in the
windowless VICE x64sc 3.10 with the pinned command on PAL and NTSC and
with `-model c64`, screenshots decoded with the char ROM; the sound
figures are from the WAVs the same build wrote, analysed in Python and
not heard. All of it is reSID's model; no SID chip was measured.
