---
recipe: d418-8bit-digi
toolchain: kickassembler
output_format: PRG
region: both
techniques: [mahoney_d418_8bit_digi]
file_formats: [PRG]
uses_registers: [D404, D405, D406, D40B, D40C, D40D, D40E, D40F, D412, D413, D414, D415, D416, D417, D418, D41B, D020, DD04, DD05, DD06, DD07, DD0D, DD0E, DD0F]
uses_kernal: [CHROUT]
claims: [cia2_timer_a (owns), cia2_tod (init), sid_voice_1 (owns), sid_voice_2 (owns), sid_voice_3 (owns), sid_filter_volume (owns), zero_page $FB-$FC (owns)]
harness: [cia2_timer_b, $02FF]
---

<!-- doc-type: recipe -->

# KickAssembler $D418 8-bit digi: Mahoney's lookup table, measured and played

## Synopsis

Mahoney's method for "Musik Run/Stop" (2014) in one program. The three
voices are parked at a constant full-scale level (pulse + TEST + gate,
sustain 15), voices 1 and 2 go through the filter, and then every one of
the 256 values of `$D418` gives its own output level, not just the 16 of
the volume nibble. The program first sweeps all 256 values as a square
wave against `$00`, so a WAV of the run holds each value's level. A table
built from that WAV maps an 8-bit sample to the `$D418` value whose level
is nearest. The program then plays an 8-bit sine through the table, one
`$D418` write every 128 cycles, and the same sine as a plain volume
nibble for comparison. The technique is `mahoney_d418_8bit_digi` in
`techniques/music-sid.md`. Every sound figure on this page is reSID's
model in VICE 3.10, not a SID chip.

## Source

```asm
// d418-8bit-digi.asm
// Mahoney's $D418 digi measured and played in one program.
// Setup (Mahoney's): all three voices pulse + TEST + gate ($49), sustain
// 15, so each voice is a constant full-scale level through its envelope;
// voices 1 and 2 routed to the filter, cutoff at the top. Then every one
// of the 256 values of $D418 (mode bits, 3OFF and volume) gives its own
// output level.
// Phase 1: sweep. Each value v is written as a square wave against $00,
//   32 half-periods of 492 cycles, so a WAV of the run holds the level of
//   every value (the table below came from such a WAV).
// Phase 2: an 8-bit sine through the lookup table for the detected SID
//   model, one $D418 write per 128 cycles, 16,384 samples.
// Phase 3: the same sine as a plain 4-bit volume nibble ($00-$0F), for
//   comparison.
// CIA 2 timer A paces every write; timer B counts its underflows and the
// verdict checks the count. Verdict at $02FF (01 pass, 02 fail), border
// green or red, and lines of text.
BasicUpstart2(start)

.const CHROUT   = $ffd2
.const RESULT   = $02ff
.const BORDER   = $d020
.label ptr      = $fb           // zero-page pointer for print

.const H        = 492            // sweep half-period, cycles
.const HALVES   = 32             // half-periods per swept value
.const PERIOD   = 128            // play: cycles per sample
.const REPS     = 64             // play: table passes, 256 * REPS samples
.const EXPECT_TB = $ffff - 256 * REPS
.const GAP      = 8              // gaps between phases: GAP * 256 periods

.const CODE_PASS = $01
.const CODE_FAIL = $02

start:
    sei
    lda #$7f                     // CIA 2 is no NMI source; clear pending
    sta $dd0d
    lda $dd0d

    // model detection: sawtooth read straight after a TEST release;
    // reSID gives 3 for the 6581 model and 2 for the 8580 model
    lda #$ff
    sta $d412
    sta $d40e
    sta $d40f
    lda #$20
    sta $d412
    lda $d41b
    sta model
    ldx #>dac6581
    cmp #3
    beq !+
    ldx #>dac8580
    cmp #2
    beq !+
    lda #1
    sta bad                      // unknown model: 8580 table, verdict fail
!:  stx dacsel + 2

    // Mahoney's setup
    lda #$0f                     // attack 0, decay 15
    sta $d405
    sta $d40c
    sta $d413
    lda #$ff                     // sustain 15, release 15
    sta $d406
    sta $d40d
    sta $d414
    lda #$49                     // pulse + TEST + gate
    sta $d404
    sta $d40b
    sta $d412
    lda #$ff                     // cutoff at the top
    sta $d415
    sta $d416
    lda #$03                     // voices 1 and 2 through the filter
    sta $d417
    lda #$00
    sta $d418

    // ---- phase 1: sweep ----
    lda #<(H - 1)
    sta $dd04
    lda #>(H - 1)
    sta $dd05
    lda #$11                     // start, force load, continuous
    sta $dd0e
    ldx #100                     // settle: envelopes reach 15 in ~2 ms
!:  jsr tick
    dex
    bne !-
    lda #0
    sta val
vloop:
    ldx #HALVES / 2
half:
    jsr tick
    lda val
    sta $d418
    jsr tick
    lda #$00
    sta $d418
    dex
    bne half
    inc val
    bne vloop

    // ---- phase 2: 8-bit through the table; phase 3: 4-bit nibble ----
    lda #<(PERIOD - 1)
    sta $dd04
    lda #>(PERIOD - 1)
    sta $dd05
    lda #$11
    sta $dd0e
    jsr gap
    jsr play                     // uses the detected model's table
    lda $dd06
    sta tb8
    lda $dd07
    sta tb8 + 1
    jsr gap
    lda #>nib
    sta dacsel + 2
    jsr play
    lda $dd06
    sta tb4
    lda $dd07
    sta tb4 + 1
    jsr gap
    lda #$00
    sta $dd0e                    // stop both timers
    sta $dd0f
    sta $d418
    cli
    jmp report

tick:                            // wait for the next timer A underflow
    lda $dd0d
    and #$01
    beq tick
    rts

gap:                             // GAP * 256 periods at the mid level
    ldx model
    lda dac8580 + $80
    cpx #3
    bne !+
    lda dac6581 + $80
!:  sta $d418
    ldy #GAP
    ldx #0
!:  jsr tick
    inx
    bne !-
    dey
    bne !-
    rts

play:
    lda #$ff                     // timer B counts timer A underflows
    sta $dd06
    sta $dd07
    jsr tick                     // just after an underflow: the flag is
    lda #$51                     // clear and the next one is 128 away;
    sta $dd0f                    // start B, input = timer A underflow
    ldx #0
    ldy #REPS
    sty reps
ploop:
    lda $dd0d                    // 4
    and #$01                     // 2
    beq ploop                    // 2
    ldy sample,x                 // 4  page-aligned: no crossing
dacsel:
    lda dac6581,y                // 4  high byte patched: which table
    sta $d418                    // 4
    inx                          // 2
    bne ploop                    // 3
    dec reps
    bne ploop
    rts

report:
    lda bad                      // pass: model known, both counts exact
    bne fail
    lda tb8
    cmp #<EXPECT_TB
    bne fail
    lda tb8 + 1
    cmp #>EXPECT_TB
    bne fail
    lda tb4
    cmp #<EXPECT_TB
    bne fail
    lda tb4 + 1
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

    ldx #<t_head
    ldy #>t_head
    jsr print
    ldx #<t_model
    ldy #>t_model
    jsr print
    lda model
    jsr hexbyte
    ldx #<t_6581
    ldy #>t_6581
    lda model
    cmp #3
    beq !+
    ldx #<t_8580
    ldy #>t_8580
    cmp #2
    beq !+
    ldx #<t_unk
    ldy #>t_unk
!:  jsr print
    ldx #<t_tb8
    ldy #>t_tb8
    jsr print
    lda tb8 + 1
    jsr hexbyte
    lda tb8
    jsr hexbyte
    ldx #<t_tb4
    ldy #>t_tb4
    jsr print
    lda tb4 + 1
    jsr hexbyte
    lda tb4
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
!:  jsr print
    rts

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

model: .byte 0
bad:   .byte 0
val:   .byte 0
reps:  .byte 0
tb8:   .word 0
tb4:   .word 0

.encoding "petscii_upper"
t_head:  .text "D418 DIGI: SWEEP, 8-BIT TABLE, 4-BIT"
         .byte $0d
         .text "128 CYCLES PER SAMPLE, TONE RATE/32"
         .byte $0d, 0
t_model: .text "D41B AFTER TEST $"
         .byte 0
t_6581:  .text " = 6581 TABLE"
         .byte $0d, 0
t_8580:  .text " = 8580 TABLE"
         .byte $0d, 0
t_unk:   .text " = UNKNOWN MODEL"
         .byte $0d, 0
t_tb8:   .text "8-BIT TIMER B $"
         .byte 0
t_tb4:   .byte $0d
         .text "4-BIT TIMER B $"
         .byte 0
t_res:   .byte $0d
         .text "RESULT "
         .byte 0
t_pass:  .text " PASS"
         .byte $0d, 0
t_fail:  .text " FAIL"
         .byte $0d, 0

.align $100
// 256 unsigned 8-bit samples, 8 sine periods per table (the generator
// is the one in the pwm-digi recipe)
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

// $D418 value for sample i, reSID 6581 model: the value whose level in
// the sweep lies nearest the i-th of 256 evenly spaced targets
dac6581:
    .byte $2f, $2f, $2f, $2e, $2e, $2e, $2e, $2e, $2e, $2e, $2d, $2d, $2d, $2d, $2d, $2d
    .byte $2d, $2c, $2c, $2c, $2c, $0f, $0f, $0f, $0e, $0e, $0e, $0e, $4f, $6f, $6f, $0d
    .byte $0d, $4e, $6e, $2a, $2a, $4d, $4d, $6d, $6d, $29, $29, $4c, $0b, $6c, $6c, $4b
    .byte $4b, $4b, $0a, $28, $28, $4a, $4a, $6a, $09, $09, $27, $27, $49, $69, $08, $08
    .byte $08, $48, $48, $68, $07, $07, $07, $47, $47, $67, $25, $25, $06, $46, $46, $66
    .byte $66, $05, $05, $24, $45, $65, $af, $af, $ae, $04, $ad, $44, $ac, $ac, $ab, $ab
    .byte $aa, $03, $43, $a9, $a8, $22, $a7, $a7, $02, $62, $a5, $a5, $a4, $a4, $ee, $01
    .byte $eb, $e9, $a2, $e6, $e4, $e3, $e1, $30, $31, $31, $51, $32, $72, $52, $34, $f1
    .byte $35, $36, $91, $75, $15, $76, $39, $3a, $77, $17, $78, $18, $79, $92, $3f, $b3
    .byte $1a, $58, $1b, $59, $1c, $7d, $1d, $b4, $1e, $5b, $1f, $5c, $5c, $f5, $5d, $b5
    .byte $5e, $5e, $94, $5f, $f6, $b6, $d5, $d5, $d5, $f7, $f7, $f7, $95, $b7, $d6, $d6
    .byte $f8, $f8, $f8, $b8, $b8, $96, $96, $d7, $f9, $b9, $b9, $b9, $fa, $fa, $97, $d8
    .byte $ba, $ba, $fb, $fb, $fb, $bb, $bb, $98, $98, $fc, $fc, $bc, $bc, $bc, $da, $fd
    .byte $99, $bd, $bd, $bd, $fe, $fe, $db, $be, $9a, $9a, $ff, $ff, $dc, $bf, $bf, $9b
    .byte $9b, $9b, $9b, $dd, $dd, $dd, $dd, $9c, $9c, $9c, $de, $de, $de, $de, $9d, $9d
    .byte $9d, $df, $df, $df, $df, $9e, $9e, $9e, $9e, $9e, $9e, $9e, $9f, $9f, $9f, $9f
// the same from the reSID 8580 model sweep
dac8580:
    .byte $4f, $4f, $4f, $6e, $6e, $6e, $4e, $4e, $4e, $2d, $2d, $2d, $4d, $4d, $4d, $2c
    .byte $2c, $4c, $4c, $4c, $6b, $6b, $6b, $4b, $4b, $4b, $2a, $2a, $2a, $0a, $0a, $0a
    .byte $29, $29, $29, $49, $49, $49, $68, $68, $68, $08, $08, $08, $27, $27, $07, $67
    .byte $67, $26, $26, $26, $46, $46, $46, $65, $65, $65, $45, $45, $45, $64, $64, $64
    .byte $44, $44, $44, $63, $63, $63, $03, $03, $22, $22, $22, $02, $02, $02, $21, $21
    .byte $21, $01, $01, $01, $ab, $ab, $a2, $50, $50, $71, $71, $71, $11, $11, $11, $32
    .byte $32, $32, $91, $91, $91, $73, $73, $13, $53, $53, $74, $74, $74, $d2, $92, $92
    .byte $35, $35, $35, $15, $15, $15, $76, $76, $16, $93, $93, $93, $77, $77, $17, $17
    .byte $17, $78, $78, $38, $b4, $94, $94, $79, $79, $19, $19, $19, $7a, $7a, $3a, $b5
    .byte $95, $95, $7b, $7b, $1b, $1b, $1b, $7c, $7c, $7c, $b6, $96, $96, $7d, $7d, $5d
    .byte $1d, $1d, $7e, $7e, $7e, $f7, $d7, $97, $97, $7f, $5f, $1f, $1f, $1f, $f8, $f8
    .byte $f8, $d8, $98, $98, $98, $98, $98, $f9, $f9, $f9, $f9, $f9, $d9, $99, $99, $99
    .byte $99, $99, $fa, $fa, $fa, $fa, $fa, $da, $9a, $9a, $9a, $9a, $9a, $fb, $fb, $fb
    .byte $fb, $fb, $db, $9b, $9b, $9b, $9b, $9b, $fc, $fc, $fc, $fc, $fc, $dc, $9c, $9c
    .byte $9c, $9c, $9c, $fd, $fd, $fd, $fd, $bd, $dd, $9d, $9d, $9d, $9d, $9d, $fe, $fe
    .byte $fe, $fe, $be, $de, $9e, $9e, $9e, $9e, $9e, $ff, $ff, $ff, $ff, $bf, $df, $9f
// plain 4-bit: the volume nibble alone, sample >> 4
nib:
    .fill 256, i >> 4
```

## Build

```bash
java -jar KickAss.jar d418-8bit-digi.asm -o d418-8bit-digi.prg -showmem
```

Produces `d418-8bit-digi.prg`, `$080e` to `$0eff` (KickAssembler 5.25,
`-showmem`): code and text to `$0aff`, then four page-aligned 256-byte
tables: the sine at `$0B00`, the 6581 table at `$0C00`, the 8580 table
at `$0D00` and the nibble table at `$0E00`.

## Expected output

Border green. Screen rows 7 to 12 on PAL:

```
D418 DIGI: SWEEP, 8-BIT TABLE, 4-BIT
128 CYCLES PER SAMPLE, TONE RATE/32
D41B AFTER TEST $02 = 8580 TABLE
8-BIT TIMER B $BFFF
4-BIT TIMER B $BFFF
RESULT 01 PASS
```

`TIMER B $BFFF` is `$FFFF` less 16,384: one timer A underflow per sample
and none missed, in each play phase. The pinned runs are 13,000,000
cycles with the dump sound sink (`-sound -sounddev dump -soundarg
/dev/null`), because `$D41B` returns meaningless values under `+sound`
(`runtime/vice-reference.md`) and the model check would then fail.
`screenshots/d418-8bit-digi.png` (PAL, VICE's default C64C, SID 8580)
reads as above. `screenshots/d418-8bit-digi-ntsc.png` (`-model ntsc`)
reads `D41B AFTER TEST $03 = 6581 TABLE` on row 9 and the same other
rows: VICE's NTSC C64 has a 6581. Border pixel (2, 100) is palette
index 5 on both. Decoded with the char ROM.

With `-model c64` (PAL, SID 6581) row 9 reads `$03 = 6581 TABLE`; that
model is not pinned, since the verifier runs `pal` and `ntsc`.

## The sound, measured without ears

Nobody listened to this. The program was run without warp with
`-sound -sounddev wav -soundarg out.wav -soundrate 48000 -soundoutput 1
-limitcycles 12500000`, once with `-model c64` (reSID 6581) and once
with the default model (reSID 8580). Each WAV is 9.69 s, 48,000 Hz,
mono, 16-bit. `levels.py` (below) finds each value's level; the table
and tone figures are arithmetic on those levels and on the WAV.

**The 256 levels.** Levels are in 16-bit WAV units, relative to `$00`,
at volume 15 for each setting of the upper four bits. Within each row
the level grows with the volume nibble in the same sign.

| `$D418` values | Upper bits | reSID 6581 | reSID 8580 |
|---|---|---|---|
| `$00`-`$0F` | none | −12,234 | −2,338 |
| `$10`-`$1F` | LP | 4,410 | 2,277 |
| `$20`-`$2F` | BP | −14,959 | −2,345 |
| `$30`-`$3F` | LP+BP | 2,902 | 2,268 |
| `$40`-`$4F` | HP | −11,436 | −2,336 |
| `$50`-`$5F` | LP+HP | 5,565 | 2,267 |
| `$60`-`$6F` | BP+HP | −11,331 | −2,342 |
| `$70`-`$7F` | LP+BP+HP | 4,176 | 2,258 |
| `$80`-`$8F` | 3OFF | 0 | 0 |
| `$90`-`$9F` | 3OFF, LP | 17,145 | 4,583 |
| `$A0`-`$AF` | 3OFF, BP | −4,021 | −7 |
| `$B0`-`$BF` | 3OFF, LP+BP | 12,839 | 4,509 |
| `$C0`-`$CF` | 3OFF, HP | −21 | 0 |
| `$D0`-`$DF` | 3OFF, LP+HP | 15,354 | 4,537 |
| `$E0`-`$EF` | 3OFF, BP+HP | −1,145 | 0 |
| `$F0`-`$FF` | 3OFF, LP+BP+HP | 12,438 | 4,491 |

| Measurement | reSID 6581 | reSID 8580 |
|---|---|---|
| Range of the 256 levels | −14,959 to 17,145 (32,104) | −2,345 to 4,583 (6,928) |
| Distinct levels (neighbours more than a quarter of an 8-bit step apart) | 167 | 84 |
| Largest gap between neighbouring levels | 958, 3.0 % of the range | 243, 3.5 % |
| Effective bits of the level set | 6.15 | 5.50 |
| Table: worst error against a straight line | 439, 3.5 steps of 256 | 115, 4.3 steps |
| Different `$D418` values the table uses | 151 | 102 |
| Worst spread of one value's level within its block | 27.5 | 5.7 |
| 8-bit phase: tone, SINAD | 240.53 Hz, 34.8 dB (5.5 bits) | 240.53 Hz, 34.7 dB (5.5 bits) |
| 8-bit phase: SINAD of the table on the levels alone | 37.0 dB (5.8 bits) | 36.6 dB (5.8 bits) |
| 4-bit phase: tone, SINAD | 240.53 Hz, 24.2 dB (3.7 bits) | 240.53 Hz, 27.1 dB (4.2 bits) |
| 4-bit phase: SINAD on the levels alone | 23.9 dB (3.7 bits) | 26.6 dB (4.1 bits) |
| RMS, 8-bit phase against 4-bit phase | 11,357 against 4,533 (2.5 times) | 2,441 against 867 (2.8 times) |

How each row was found:

- A level is the median of the middle half of a plateau of value v,
  less the mean of the medians of the `$00` plateaus either side (that
  cancels the drift of the output's high-pass), averaged over the block's
  last fifteen pairs. Plateaus are placed by arithmetic from the sweep's
  last edge, 492 cycles each at 985,248 Hz; the small spreads in the
  table say the placement holds over 4.03 s.
- Effective bits: for an input spread evenly over the range and rounded
  to the nearest level, the RMS error is `sqrt(Σ gap³ ÷ (12 × range))`;
  the bits are `log2(range ÷ (RMS × √12))`, which is 7.99 for 256 even
  steps.
- The table maps sample i to the value whose level is nearest the i-th of
  256 targets spaced evenly over the range.
- SINAD: from 0.1 s after the phase starts to 0.1 s before it ends, a Hann
  window, the power within 3 Hz of 240.54 Hz against all other power from
  20 Hz to 3,800 Hz (below half the 7,697 Hz sample rate); bits =
  (SINAD − 1.76) ÷ 6.02. "On the levels alone" is the same sum on the
  sample table mapped through the table and the measured levels, with no
  emulator in the way.

What the table says:

- In reSID the method gives about 5.5 effective bits on both models, not
  8. The 6581 model has twice as many distinct levels, but its levels bunch
  up, so the playback comes out the same. Mahoney's paper says every SID
  emulation "falls back to approximately 5-bit audio output resolution";
  the measurement agrees with it (that sentence is his, the 5.5 is
  measured here). His own tables came from real chips and are not
  reproduced or checked here.
- Against the plain nibble on the same setup, the table gains 1.8 bits on
  the 6581 model and 1.3 on the 8580 model, and plays 2.5 to 2.8 times
  louder, because it uses the whole range and not the `$00`-`$0F` row.
- The 8580 model's levels fall on three slopes: about −155 per volume
  step with 3OFF clear, +152 with LP, +307 with 3OFF and LP. BP and HP
  alone give nothing once 3OFF is set. So the 8580 table is mostly
  volume steps at three gains.
- The tables in the listing came from a first run of the same sweep. This
  run's levels agree with that one within 14 units (6581) and 2 units
  (8580). Where two values' levels lie that close, a table rebuilt from
  this run picks the other value: 11 of 256 entries on the 6581 table and
  21 on the 8580 table. Either table plays the same.

`levels.py`, the level finder:

```text
#!/usr/bin/env python3
"""levels.py: per-$D418-value output level from a sweep WAV.

The sweep writes, for each value v = 0..255, HALVES half-periods of H
cycles alternating v and $00 (v first). Each block is HALVES*H cycles.
The last write of the sweep ($00, end of block 255) is the first large
edge followed by a second without one; every other half-period is placed from it by arithmetic.
Level(v) = median of the middle half of each v plateau minus the median
of the middle halves of the $00 plateaus before and after it, averaged over the
block. Output: one line per value, 'v level'.
"""
import sys, wave, json
import numpy as np

CLOCK = 985248.0
H = int(sys.argv[3]) if len(sys.argv) > 3 else 492
HALVES = int(sys.argv[4]) if len(sys.argv) > 4 else 32
NV = int(sys.argv[5]) if len(sys.argv) > 5 else 256

w = wave.open(sys.argv[1])
sr = w.getframerate()
x = np.frombuffer(w.readframes(w.getnframes()), dtype='<i2').astype(float)

d = np.abs(np.diff(x))
# last edge: last derivative sample above a fraction of the largest late step
tail = d[-int(1.0 * sr):]
thr = 0.25 * d.max()
idx = np.nonzero(d > thr)[0]
# the sweep's last edge is the first edge followed by a second of none:
# inside the sweep no quiet stretch is longer than 16 blocks (0.26 s)
quiet = np.nonzero(np.diff(np.append(idx, len(d) + sr)) > sr)[0]
t_end = idx[quiet[0]] + 1  # sample index just after the last sweep edge
spc = sr / CLOCK      # samples per cycle
half = H * spc
block = HALVES * half
t0 = t_end - NV * block

levels = []
for v in range(NV):
    diffs = []
    for k in range(HALVES // 2):
        a = t0 + v * block + 2 * k * half      # v plateau start
        b = a + half                            # $00 plateau start
        c = b + half
        def med(s):
            return np.median(x[int(s + half * 0.3):int(s + half * 0.8)])
        # the $00 plateaus either side cancel the linear part of the
        # output high-pass drift (reSID's external filter, ~16 Hz)
        diffs.append(med(a) - (med(a - half) + med(b)) / 2)
    diffs = np.array(diffs[1:])  # drop the first pair (block transition)
    levels.append((float(np.mean(diffs)), float(np.std(diffs))))

out = sys.argv[2]
json.dump({'wav': sys.argv[1], 'sr': sr, 't_end_s': t_end / sr, 'levels': levels}, open(out, 'w'))
arr = np.array([l[0] for l in levels])
print('t_end %.4f s, block %.1f samples' % (t_end / sr, block))
print('levels: min %.0f max %.0f, worst in-block std %.1f' % (arr.min(), arr.max(), max(l[1] for l in levels)))
```

## Why this works

With TEST held, the pulse output is forced high whatever the pulse width
(`hardware/sid-reference.md`, TEST), so each voice is a constant level
set by its envelope, parked at sustain 15. Voice 3 goes straight to the
mixer. Voices 1 and 2 go through the filter: their sum reaches the output
only through the mode bits that are set, and each mode passes the constant
level at its own gain and sign. The measured LP rows have the opposite
sign to the direct voice. Mahoney measured a filter gain of about −1 on
real chips; reSID's filter inverts too. 3OFF removes the direct voice 3.
The volume nibble then scales the whole sum. So each of the 256 values
selects one of 16 sums at one of 16 volumes, and the level set is richer
than 16 steps. It is not evenly spaced, so the table picks, for each
sample value, the `$D418` value that comes nearest.

One `$D418` write carries the sample. The loop is a poll of the CIA flag
and `ldy sample,x` / `lda table,y` / `sta $D418` / `inx` / `bne`, 25
cycles by the instruction table: 8 for the poll, 17 for the rest. The
sine and the three tables are page-aligned, so no indexed load crosses a
page. The table is chosen at start by the `$D41B` model check
(`sid_8580_vs_6581_differences`): a table measured on one model plays
wrongly on the other. On real chips it also plays wrongly on another chip
of the same model, by how far that chip strays; Mahoney measured a
stack of chips and built one table per model from them for that reason.
How well such a table fits a given chip is his measurement and is not
repeated here. The sweep phase is the tool for measuring one chip.

The timing is the verdict's to check, not the tone's. CIA 2 timer A sets
the rate, 128 cycles a sample, 7,697 samples a second on PAL. Timer B
counts its underflows. `play` waits for an underflow before starting
timer B, so the flag is clear and the next underflow is counted. Its
count after 16,384 samples shows that no underflow went by unsampled.
The screen stays on, under `sei`: a badline's 40 to 43 cycles plus the
25-cycle loop fit inside 128. Mahoney's demo ran at 22 cycles a sample,
about 44.8 kHz; this listing does not try that rate.

Verified: assembled with KickAssembler 5.25, run headless in the
windowless VICE x64sc 3.10 with the pinned command on PAL and NTSC,
screenshots decoded with the char ROM. The sound figures are from the WAVs
the same build wrote, analysed in Python and not heard; they are reSID's,
and no SID chip was measured.
