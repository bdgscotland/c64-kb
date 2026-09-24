---
recipe: nmi-sample-player
toolchain: kickassembler
output_format: PRG
region: both
techniques: [nmi_sample_player]
file_formats: [PRG]
uses_registers: [D011, D012, D019, D01A, D400, D401, D404, D405, D406, D418, D020, DC0D, DD04, DD05, DD06, DD07, DD0D, DD0E, DD0F]
uses_kernal: [CHROUT]
claims: [irq_vector_fffe (owns), nmi_vector_fffa (owns), cia1_timer_a (init), cia1_timer_b (init), cia1_tod (init), cia2_timer_a (owns), cia2_tod (init), vic_raster_irq (owns), sid_voice_1 (owns), sid_filter_volume (owns), zero_page $FB-$FD (owns)]
harness: [cia2_timer_b, $02FF]
---

<!-- doc-type: recipe -->

# KickAssembler NMI sample player beside a raster-IRQ music player

## Synopsis

A 4-bit `$D418` sample player driven by CIA 2 timer A through the NMI,
running under a raster-IRQ music player that plays notes on voice 1. The
NMI plays one sample every 128 cycles, 7,697 a second on PAL, and the
IRQ runs once a frame on line 250 and changes the note every 25 frames.
Neither can mask the other: an NMI lands inside the IRQ handler whenever
its time comes. The program counts both, checks that no sample was lost
and no frame missed, and records how late after each timer underflow
the NMI handler started. A WAV of the run shows the sample tone, the
notes on time, and the cost of sharing `$D418`: the digi modulates the
music's volume. The technique is `nmi_sample_player` in
`techniques/music-sid.md`. The sound figures are reSID's model in VICE
3.10, not a SID chip.

## Source

```asm
// nmi-sample-player.asm
// A 4-bit $D418 sample player on the CIA 2 timer A NMI, beside a raster
// IRQ music player. KERNAL and BASIC banked out; both vectors in RAM at
// $FFFA and $FFFE.
//   NMI: every 128 cycles, one sample into $D418, count it, acknowledge.
//        It also keeps the lowest and highest timer A value seen at
//        entry, which is how late after the underflow it started.
//   IRQ: once a frame on raster line 250, the music: voice 1 triangle,
//        a new note every 25 frames (440 Hz and 660 Hz on PAL), and a
//        frame count. It never writes $D418.
// CIA 2 timer B counts timer A underflows. After 32,768 samples the main
// program stops the timers and checks that every underflow produced one
// sample and that the IRQ ran once a frame. Verdict at $02FF (01 pass,
// 02 fail), border green or red, and lines of text.
BasicUpstart2(start)

.const CHROUT   = $ffd2
.const RESULT   = $02ff
.const BORDER   = $d020
.label ptr      = $fb            // zero-page pointer for print
.label idx      = $fd            // sample index

.const PERIOD   = 128            // cycles per sample
.const SAMPLES  = 32768          // run length
.const LINE     = 250            // music IRQ line

.const CODE_PASS = $01
.const CODE_FAIL = $02

start:
    sei
    lda #$7f
    sta $dc0d                    // CIA 1: no interrupts
    sta $dd0d                    // CIA 2: no NMIs yet
    lda $dc0d
    lda $dd0d
    lda #$35                     // I/O on, KERNAL and BASIC off
    sta $01
    lda #<nmi
    sta $fffa
    lda #>nmi
    sta $fffb
    lda #<irq
    sta $fffe
    lda #>irq
    sta $ffff

    // voice 1: triangle, attack 0, sustain 15, first note
    lda #$00
    sta $d405
    lda #$f0
    sta $d406
    ldx #0
    stx note
    lda notelo
    sta $d400
    lda notehi
    sta $d401
    lda #$11
    sta $d404
    lda #$08
    sta $d418
    lda #0
    sta idx
    sta cnt
    sta cnt + 1
    sta frames
    sta frames + 1
    sta tick
    lda #$ff
    sta tmin
    lda #$00
    sta tmax

    // raster IRQ on line LINE
    lda $d011
    and #$7f
    sta $d011
    lda #LINE
    sta $d012
    lda #$01
    sta $d01a
    sta $d019

    // CIA 2: timer B counts timer A underflows; timer A every PERIOD
    lda #$ff
    sta $dd06
    sta $dd07
    lda #<(PERIOD - 1)
    sta $dd04
    lda #>(PERIOD - 1)
    sta $dd05
    lda #$51                     // B: start, force load, count A underflows
    sta $dd0f
    lda #$81                     // A underflow raises NMI
    sta $dd0d
    lda #$11                     // A: start, force load, continuous
    sta $dd0e
    cli

wait:                            // main program: wait for SAMPLES
    lda cnt + 1
    cmp #>SAMPLES
    bne wait

    lda #$00
    sta $dd0e                    // stop timer A (and so timer B's input)
    ldx #40                      // let a pending NMI finish
!:  dex
    bne !-
    lda #$7f
    sta $dd0d                    // no more NMIs
    lda $dd0d
    sei
    lda #$00
    sta $d01a                    // no more raster IRQs
    lda #$ff
    sta $d019
    lda #$10                     // gate off
    sta $d404
    lda $dd06
    sta tb
    lda $dd07
    sta tb + 1
    lda #$37                     // KERNAL and BASIC back
    sta $01
    lda #$81
    sta $dc0d                    // CIA 1 timer A IRQ back for the KERNAL
    cli

    // pass: underflows = samples, and the frame count is one PAL or one
    // NTSC run's worth (32,768 * 128 cycles is 213.4 PAL frames of
    // 19,656 cycles and 245.4 NTSC frames of 17,095)
    ldy #CODE_FAIL
    lda tb                       // TB + samples counted must be $FFFF
    clc
    adc cnt
    tax
    lda tb + 1
    adc cnt + 1
    cpx #$ff
    bne verdict
    cmp #$ff
    bne verdict
    lda frames + 1
    bne verdict
    lda frames
    cmp #213
    beq ok
    cmp #214
    beq ok
    cmp #245
    beq ok
    cmp #246
    bne verdict
ok: ldy #CODE_PASS
verdict:
    sty RESULT
    lda #2
    cpy #CODE_PASS
    bne !+
    lda #5
!:  sta BORDER

    ldx #<t_head
    ldy #>t_head
    jsr print
    ldx #<t_cnt
    ldy #>t_cnt
    jsr print
    lda cnt + 1
    jsr hexbyte
    lda cnt
    jsr hexbyte
    ldx #<t_tb
    ldy #>t_tb
    jsr print
    lda tb + 1
    jsr hexbyte
    lda tb
    jsr hexbyte
    ldx #<t_frames
    ldy #>t_frames
    jsr print
    lda frames + 1
    jsr hexbyte
    lda frames
    jsr hexbyte
    ldx #<t_ta
    ldy #>t_ta
    jsr print
    lda tmax
    jsr hexbyte
    ldx #<t_to
    ldy #>t_to
    jsr print
    lda tmin
    jsr hexbyte
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

// ---- NMI: one sample ----
nmi:
    sta nmi_a + 1                // 4  save A and X without the stack
    lda $dd04                    // 4  timer A low: counts down from 127
    cmp tmin                     //    after each underflow
    bcs !+
    sta tmin
!:  cmp tmax
    bcc !+
    sta tmax
!:  stx nmi_x + 1
    ldx idx
    lda sample,x                 // 4-bit sample, 0 to 15
    sta $d418                    // filter bits 7-4 stay 0: this player
    inc idx                      // owns $D418
    inc cnt
    bne !+
    inc cnt + 1
!:  lda $dd0d                    // acknowledge, or /NMI stays low
nmi_a:
    lda #0
nmi_x:
    ldx #0
    rti

// ---- IRQ: the music, once a frame ----
irq:
    pha
    txa
    pha
    inc frames
    bne !+
    inc frames + 1
!:  inc tick
    lda tick
    cmp #25
    bne done
    lda #0
    sta tick
    lda note
    eor #1
    sta note
    tax
    lda notelo,x
    sta $d400
    lda notehi,x
    sta $d401
done:
    lda #$01
    sta $d019
    pla
    tax
    pla
    rti

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

// 440 Hz and 660 Hz on PAL: F = Hz * 16,777,216 / 985,248
notelo: .byte <7493, <11239
notehi: .byte >7493, >11239
note:   .byte 0
tick:   .byte 0
cnt:    .word 0
frames: .word 0
tb:     .word 0
tmin:   .byte 0
tmax:   .byte 0

.encoding "petscii_upper"
t_head:   .text "NMI 4-BIT DIGI EVERY 128 CYCLES,"
          .byte $0d
          .text "RASTER IRQ MUSIC ON VOICE 1"
          .byte $0d, 0
t_cnt:    .text "SAMPLES $"
          .byte 0
t_tb:     .text " TIMER B $"
          .byte 0
t_frames: .byte $0d
          .text "MUSIC FRAMES $"
          .byte 0
t_ta:     .byte $0d
          .text "TIMER A AT NMI ENTRY $"
          .byte 0
t_to:     .text " TO $"
          .byte 0
t_res:    .byte $0d
          .text "RESULT "
          .byte 0
t_pass:   .text " PASS"
          .byte $0d, 0
t_fail:   .text " FAIL"
          .byte $0d, 0

.align $100
// 256 samples, 8 sine periods, 4-bit (0 to 15): tone = rate / 32
sample:
    .fill 256, round(7.5 + 7.5 * sin(2 * PI * 8 * i / 256))
```

## Build

```bash
java -jar KickAss.jar nmi-sample-player.asm -o nmi-sample-player.prg -showmem
```

Produces `nmi-sample-player.prg`, `$080e` to `$0bff` (KickAssembler 5.25,
`-showmem`), with the sample table page-aligned at `$0B00`.

## Expected output

Border green. On PAL, screen rows 7 to 12:

```
NMI 4-BIT DIGI EVERY 128 CYCLES,
RASTER IRQ MUSIC ON VOICE 1
SAMPLES $8001 TIMER B $7FFE
MUSIC FRAMES $00D5
TIMER A AT NMI ENTRY $70 TO $42
RESULT 01 PASS
```

On NTSC the third to fifth rows read `SAMPLES $8000 TIMER B $7FFF`,
`MUSIC FRAMES $00F5` and `TIMER A AT NMI ENTRY $74 TO $40`. Pinned at
9,000,000 cycles: `screenshots/nmi-sample-player.png` and
`screenshots/nmi-sample-player-ntsc.png`, decoded with the char ROM,
border pixel (2, 100) palette index 5 on both.

- **Samples.** Timer B counts down from `$FFFF` once per timer A
  underflow, so timer B plus the samples counted is `$FFFF` when every
  underflow produced exactly one sample: `$7FFE + $8001` and `$7FFF +
  $8000`. The main loop stops the timer once the count reaches `$8000`;
  on PAL one more NMI came between its check and the stop.
- **Frames.** 32,768 samples of 128 cycles are 4,194,304 cycles: 213.4
  PAL frames of 19,656 cycles and 245.4 NTSC frames of 17,095. The IRQ
  counted 213 (`$D5`) and 245 (`$F5`), so it ran once a frame
  throughout.
- **Lateness.** Timer A counts down from 127 after each underflow. The
  handler reads it 15 cycles after the interrupt sequence begins (7 for
  the sequence, 4 for the `sta abs`, 4 to the load's read cycle). The
  highest value seen, `$70` = 112, is the earliest entry; the lowest,
  `$42` = 66, the latest: the entries spread over 46 cycles on PAL, and
  over 52 on NTSC (`$74` to `$40`). The sample store follows the read by
  29 to 35 cycles by the instruction table, 29 unless the read set a new
  lowest or highest value. The figures depend on where the run starts:
  `-model c64` read `$72` to `$40`. A variant with the display blanked
  (`$0B` into `$D011`, then a wait for line 0, since the frame's badlines
  are decided at line `$30`) read `$75` to `$6A` on PAL, `$73` to `$69`
  on NTSC and `$74` to `$69` under `-model c64`: 10 or 11 cycles, left by
  the instruction in progress when the timer fires (not broken down
  here). The rest of the spread with the screen on is the badline, which
  holds the CPU for 40 to 43 cycles.

## The sound, measured without ears

Nobody listened to this. The PAL build was run without warp with
`-sound -sounddev wav -soundarg out.wav -soundrate 48000 -soundoutput 1
-limitcycles 8000000`, with `-model c64` (reSID 6581) and with the
default model (reSID 8580). A script found each note's stretch by the
power at 440.03 and 660.02 Hz (the notes' frequencies by arithmetic,
`F × 985,248 ÷ 16,777,216` for `F` = 7,493 and 11,239), in 40 ms windows
stepped by 10 ms, then took a Hann-windowed spectrum of the longest
stretch of each note, 50 ms in from both ends.

| Measurement | reSID 6581 | reSID 8580 |
|---|---|---|
| Note changes, from the WAV | every 0.500 s, eight changes | every 0.500 s, eight changes |
| Sample tone, 240.54 Hz, against the 440 Hz note | +10.2 dB | −2.1 dB |
| Sidebands at 440 ± 240.5 Hz, against the note | −6.3 dB, −6.2 dB | −6.1 dB, −6.1 dB |
| Sidebands at 660 ± 240.5 Hz, against the note | −6.3 dB, −6.2 dB | −6.1 dB, −6.1 dB |
| The other note inside a note's stretch | −59 dB and −53 dB | −67 dB and −60 dB |

- The notes change every 25 frames, `25 × 19,656 ÷ 985,248 = 0.4988 s`;
  the 10 ms step of the search cannot tell that from 0.500. The music
  kept time under 7,697 NMIs a second.
- The sample tone is there on both models: 10 dB above the music on the
  6581 model, 2 dB below it on the 8580 model, whose plain `$D418` digi is
  weak (`sid_8580_digi_bias_and_filter_bypass`).
- The sidebands are the cost of a `$D418` digi beside music. The nibble
  is the master volume, so the sample multiplies every voice. The sample
  swings the volume from 0 to 15 around 7.5, full depth, and full-depth
  amplitude modulation puts each sideband at half the carrier, −6.0 dB by
  arithmetic; the WAV has −6.1 to −6.3. A player that keeps the digi's
  swing small, or plays the sample another way (`pwm_digi`), keeps the
  music cleaner.

## Why this works

The NMI is edge-triggered and cannot be masked by `sei`, so the sample
arrives on time whatever the rest of the program is doing, including the
music IRQ. The handler saves A and X by storing them into its own
`lda #`/`ldx #` operands and leaves the stack alone. It must read `$DD0D`
before `rti`: CIA 2 holds `/NMI` low until its interrupt register is read,
and a held line makes no new edge, so a handler that forgets the read
gets one NMI and no more (`nmi_handler_and_restore_key`, measured by the
nmi-timer-tick recipe).

The IRQ handler is interrupted by NMIs and needs nothing for it: the NMI
saves what it uses. It pushes A and X itself, because an IRQ can arrive
while the main program uses them, and it acknowledges `$D019`. It never
writes `$D418`; the sample player owns the register. A music routine that
does write it would have to write through a shadow of the filter bits and
leave the volume nibble to the digi, as `digi_4bit` describes.

Both vectors are the hardware ones at `$FFFA` and `$FFFE`, with the KERNAL
banked out (`$35` in `$01`), so the NMI costs 7 cycles to enter and no
KERNAL dispatch. RESTORE raises an NMI too and would land in this handler
as a spurious sample; this listing does not guard against it. At the end
the program stops timer A, waits 200 cycles for a pending NMI, masks both
interrupt sources, and gives the KERNAL back its ROM and its CIA 1 timer
interrupt before it prints.

Verified: assembled with KickAssembler 5.25, run headless in the
windowless VICE x64sc 3.10 with the pinned command on PAL and NTSC,
screenshots decoded with the char ROM. The sound figures are from the WAVs
the same build wrote, analysed in Python and not heard; they are reSID's,
and no SID chip was measured.
