---
recipe: lfsr-seed-cia
toolchain: kickassembler
output_format: PRG
region: both
techniques: [lfsr_random]
file_formats: [PRG]
uses_registers: [D011, D012, D020, DC00, DC01, DC04]
uses_kernal: [CHROUT]
claims: [cia1_port_a (owns)]
harness: [$02FF]
ram: [cand=$4000-$41FF]
---

<!-- doc-type: recipe -->

# KickAssembler — LFSR seed from CIA1 timer A and the frame count, no SID

## Synopsis

Seeds the 16-bit Galois LFSR of `lfsr_random` without touching the SID.
A title loop waits for a key or fire, counting frames; when the player
presses, the seed is the frame count's low byte on top and CIA1 timer
A's low byte below. The KERNAL starts timer A at reset and never stops
it, so its low byte holds the sub-frame moment of the press. The
listing also keeps, for the first 256 frames, the seed a press on that
frame would have given, and counts how many differ. Use it where a SID
read is unwanted: a music player owns voice 3, or the machine may have
a SID replacement that cannot read `$D41B` back
(`sid_replacement_d41b_unreadable` in `pitfalls/sid.md`).

## Source

```asm
// lfsr-seed-cia.asm
// Seeds a 16-bit Galois LFSR (taps $B400) without the SID. The seed's
// low byte is CIA1 timer A's low byte, which the KERNAL leaves running
// from reset; its high byte is the low byte of the count of frames the
// title screen waited. The wait ends on a key, on fire in either
// control port, or after TIMEOUT frames. For the first 256 frames the
// listing also keeps the seed a press on that frame would have given,
// and counts how many differ. It shows the seed, the first eight output
// bytes and that count. $02FF = $01 and a green border when the seed is
// not zero and all 256 differ; $02FF = $02 and a red border otherwise.

BasicUpstart2(start)
.encoding "screencode_upper"

.const SCREEN  = $0400
.const RESULT  = $02ff
.const TIMEOUT = 300             // frames before the title gives up waiting
.const LINE    = 251             // the frame point: a line PAL and NTSC share
.const CAND    = $4000           // 256 candidate seeds, low bytes then high

start:
    sei                          // no KERNAL interrupt: the wait below polls
    lda #0
    sta frames
    sta frames+1
    lda #$93
    jsr $ffd2                    // clear the screen (KERNAL still banked in)

frame_lp:
!:  lda $d012                    // leave LINE if this frame's work was short
    cmp #LINE
    beq !-
!:  lda $d012                    // wait for LINE with bit 8 clear
    cmp #LINE
    bne !-
    bit $d011
    bmi !-
    jsr read_ta                  // ta = CIA1 timer A, low byte
    lda ta                       // candidate: timer A's low byte, and
    sta cand                     // the frame count's low byte on top
    lda frames
    sta cand+1
    lda frames+1                 // keep the first 256 candidates
    bne !+
    ldx frames
    lda cand
    sta CAND,x
    lda cand+1
    sta CAND+256,x
!:  jsr pressed                  // C set: a key or fire is down
    bcs take
    lda frames                   // or the title has waited long enough
    cmp #<TIMEOUT
    bne !+
    lda frames+1
    cmp #>TIMEOUT
    beq timed_out
!:  inc frames
    bne !+
    inc frames+1
!:  jmp frame_lp
timed_out:
    lda frames
    sta waited
    lda frames+1
    sta waited+1

take:
    lda cand                     // the seed is this frame's candidate
    sta seed
    lda cand+1
    sta seed+1
    ora seed
    bne !+
    lda #<$ace1                  // an all-zero state never leaves zero
    sta seed
    lda #>$ace1
    sta seed+1
!:  inc frames
    bne fill_lp
    inc frames+1
    // A press before frame 255 leaves the table short; run the frame
    // loop on, without taking a new seed, until 256 candidates are kept.
fill_lp:
    lda frames+1
    bne filled
!:  lda $d012
    cmp #LINE
    beq !-
!:  lda $d012
    cmp #LINE
    bne !-
    bit $d011
    bmi !-
    jsr read_ta
    ldx frames
    lda ta
    sta CAND,x
    txa
    sta CAND+256,x
    inc frames
    bne fill_lp
    inc frames+1
filled:
    jsr count_distinct           // distinct = how many of 256 differ

    lda seed                     // the LFSR state starts at the seed
    sta s_lo
    lda seed+1
    sta s_hi

    ldx #0                       // row 0: title
!:  lda t_title,x
    beq !+
    sta SCREEN,x
    inx
    bne !-
!:  ldx #0                       // row 2: SEED hhhh
!:  lda t_seed,x
    beq !+
    sta SCREEN+80,x
    inx
    bne !-
!:  lda seed+1
    ldy #5
    jsr hex_at_row2
    lda seed
    ldy #7
    jsr hex_at_row2
    ldx #0                       // row 3: WAITED nnnn FRAMES (hex)
!:  lda t_wait,x
    beq !+
    sta SCREEN+120,x
    inx
    bne !-
!:  lda waited+1
    ldy #8
    jsr hex_at_row3
    lda waited
    ldy #10
    jsr hex_at_row3
    ldx #0                       // row 5: BYTES and eight LFSR outputs
!:  lda t_bytes,x
    beq !+
    sta SCREEN+200,x
    inx
    bne !-
!:  lda #6
    sta col
    lda #8
    sta n
!:  jsr lfsr
    ldy col
    jsr hex_at_row5
    inc col
    inc col
    inc col
    dec n
    bne !-
    ldx #0                       // row 6: DISTINCT nnn OF 256
!:  lda t_dist,x
    beq !+
    sta SCREEN+240,x
    inx
    bne !-
!:  lda distinct+1
    ldy #10
    jsr hex_at_row6
    lda distinct
    ldy #12
    jsr hex_at_row6

    lda seed                     // verdict
    ora seed+1
    beq fail
    lda distinct+1
    cmp #1
    bne fail
    lda distinct
    bne fail
    lda #$01
    ldx #5
    bne verdict
fail:
    lda #$02
    ldx #2
verdict:
    sta RESULT
    stx $d020
    ldx #3                       // row 8: PASS or FAIL
    cmp #$01
    bne show_fail
!:  lda t_pass,x
    sta SCREEN+320,x
    dex
    bpl !-
    bmi done
show_fail:
!:  lda t_fail,x
    sta SCREEN+320,x
    dex
    bpl !-
done:
    jmp done

// ---------------------------------------------------------------- inputs
// read_ta: ta = CIA1 timer A's low byte. It steps once a cycle, so it
// holds the sub-frame phase of the moment it is read.
read_ta:
    lda $dc04
    sta ta
    rts

// pressed: C set when fire in port 2, or any key or port-1 input, is down.
pressed:
    lda #$ff
    sta $dc00                    // columns high: port A reads the joystick
    lda $dc00
    and #$10                     // port 2 fire, low when pressed
    beq yes
    lda #$00
    sta $dc00                    // every column low: any key pulls a row
    lda $dc01
    cmp #$ff
    bne yes
    clc
    rts
yes:
    lda frames
    sta waited
    lda frames+1
    sta waited+1
    sec
    rts

// count_distinct: distinct = the number of CAND entries equal to no
// earlier entry.
count_distinct:
    lda #0
    sta distinct
    sta distinct+1
    ldx #0
cd_outer:
    txa
    beq cd_new                   // entry 0 is always new
    ldy #0
cd_inner:
    lda CAND,y
    cmp CAND,x
    bne cd_next
    lda CAND+256,y
    cmp CAND+256,x
    beq cd_dup
cd_next:
    iny
    sty tmp
    cpx tmp
    bne cd_inner
cd_new:
    inc distinct
    bne cd_dup
    inc distinct+1
cd_dup:
    inx
    bne cd_outer
    rts

// ---------------------------------------------------------------- generator
// lfsr: one step, shift right, taps $B400; A = the low byte.
lfsr:
    lsr s_hi
    ror s_lo
    bcc !+
    lda s_hi
    eor #$b4
    sta s_hi
!:  lda s_lo
    rts

// ---------------------------------------------------------------- output
hex_at_row2:
    ldx #80
    bne hex_at
hex_at_row3:
    ldx #120
    bne hex_at
hex_at_row5:
    ldx #200
    bne hex_at
hex_at_row6:
    ldx #240
// hex_at: A as two hex digits at SCREEN + X + Y.
hex_at:
    stx base
    pha
    tya
    clc
    adc base
    tax
    pla
    pha
    lsr
    lsr
    lsr
    lsr
    tay
    lda hexd,y
    sta SCREEN,x
    pla
    and #$0f
    tay
    lda hexd,y
    sta SCREEN+1,x
    rts

hexd:    .text "0123456789ABCDEF"
t_title: .text "LFSR SEED FROM CIA1 TIMER A AND FRAMES"
         .byte 0
t_seed:  .text "SEED "
         .byte 0
t_wait:  .text "WAITED $     FRAMES"
         .byte 0
t_bytes: .text "BYTES"
         .byte 0
t_dist:  .text "DISTINCT $     OF 256"
         .byte 0
t_pass:  .text "PASS"
t_fail:  .text "FAIL"

frames:   .word 0
waited:   .word 0
ta:       .byte 0
cand:     .word 0
seed:     .word 0
s_lo:     .byte 0
s_hi:     .byte 0
distinct: .word 0
col:      .byte 0
n:        .byte 0
tmp:      .byte 0
base:     .byte 0
```

## Build

```bash
java -jar KickAss.jar lfsr-seed-cia.asm -o lfsr-seed-cia.prg
```

## Expected output

Border green, `$02FF` = `$01`. PAL (`screenshots/lfsr-seed-cia.png`):

```
LFSR SEED FROM CIA1 TIMER A AND FRAMES

SEED 2CA0
WAITED $012C FRAMES

BYTES 50 28 94 CA 65 B2 59 2C
DISTINCT $0100 OF 256

PASS
```

NTSC 6567R8 (`screenshots/lfsr-seed-cia-ntsc.png`): the same, with
`SEED 2C5C` and `BYTES 2E 17 8B C5 62 31 98 4C`.

Pinned at 12,000,000 cycles; both pictures were decoded against the
character ROM (rung 1, VICE x64sc 3.10, PAL C64C and `-model ntsc`).
The border pixel (2, 100) is (98, 213, 50) on PAL and (114, 189, 103)
on NTSC, index 5 on both. The eight bytes are the first eight states'
low bytes from each seed in a Python model of the same register (taps
`$B400`, shift right).

A headless run has no player, so the title always times out at frame
300 (`$012C`), and the high byte is `$2C`, 300's low byte. The low byte
is the timer:

- With the pinned start (`+autostart-delay-random`, the same number of
  cycles from reset to the read every run) the seed is the same every
  run, `$2CA0` PAL and `$2C5C` NTSC.
- With VICE's random autostart delay (`-autostart-delay-random`), ten
  runs per model gave low bytes `1A BB 1A 59 00 19 99 1F 1A A4` on PAL
  (8 different) and `0A F8 71 F8 04 3C 04 5F 91 3C` on NTSC (7
  different), rung 1. The delay moves the moment the program starts
  against the timer, as a disk load or a human does on a real machine
  (that it varies there is rung 4).

`DISTINCT $0100` says all 256 candidate seeds for frames 0 to 255
differ, which the layout guarantees: the frame count alone fills the
high byte.

## Why this works

The KERNAL's IOINIT sets CIA1 timer A running continuously with the
latch `$4025` on PAL and `$4295` on NTSC (`$FDDD`, chosen by the
`$02A6` flag; ROM bytes, rung 1), for its 60 Hz interrupt. Masking the
interrupt, as this listing does with `SEI`, does not stop the timer.
Its low byte therefore changes every cycle, and a read at an input
event lands on a value set by how many cycles have passed since reset.

Two plays that press on the same frame get the same high byte, and
differ only if the timer's low byte does. Two plays that press on
different frames within 256 frames of each other always differ. Two
earlier builds of this listing combined the frame count with the whole
16-bit timer value instead: adding it gave 254 different candidates of
256 on PAL, XORing it 255 of 256 on NTSC (rung 1; the colliding pairs
were not traced to a cause). Keeping the two sources in separate bytes
rules collisions out within 256 frames.

A zero seed is replaced by `$ACE1`: a Galois LFSR in state zero stays
there (`lfsr_zero_state_lockup` in `pitfalls/cpu.md`). Here that needs
a press on a frame whose count ends in `$00` with the timer's low byte
also `$00`.

The recipe claims `cia1_port_a` for its keyboard and joystick reads at
`$DC00`. It writes no SID register (a claims-watch trace of the run).
`lfsr_random`'s Claims line still names the SID units, which its SID
seed needs; a game that seeds this way instead does not hold them.
