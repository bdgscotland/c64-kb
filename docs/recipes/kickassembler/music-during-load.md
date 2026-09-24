---
recipe: music-during-load
toolchain: kickassembler
output_format: PRG
region: both
techniques: [music_during_kernal_load, kernal_load_to_address]
file_formats: [PRG]
uses_registers: [D011, D012, D019, D01A, D020, D400, D401, D404, D405, D406, D418, DC04, DC05, DC0D, DC0E, DD04, DD05, DD06, DD07, DD0E, DD0F]
uses_kernal: [SETLFS, SETNAM, SAVE, LOAD, CHROUT, PLOT]
devices: [disk_1541_ii]
claims: [irq_vector_0314 (owns), cia1_timer_a (owns), cia1_timer_b (init), cia1_tod (init), vic_raster_irq (owns), sid_voice_1 (owns), sid_filter_volume (init), zero_page $FB-$FC (owns)]
harness: [$02FF]
ram: [data=$4000-$4FFF, buf=$5000-$5FFF]
kernal_services: [IRQ]
---

<!-- doc-type: recipe -->

# KickAssembler — Music during a KERNAL LOAD: steps lost to the serial code, and a catch-up from a CIA2 frame clock

## Synopsis

Saves a 4,096-byte file to drive 8, then LOADs it back three times while
a one-voice player runs from an interrupt, and counts player steps
against frames for the length of each LOAD. The player is driven three
ways: once per CIA1 timer A interrupt at the frame rate, once per raster
interrupt on line 250, and from the same raster interrupt with a
catch-up that steps the player until its step count equals a frame
count kept by CIA2 timers A and B. The first two lose steps while the
KERNAL talks to the drive; the catch-up loses none. Use it when a game
must load a level with its music playing through the KERNAL. The
technique is `music_during_kernal_load` in `techniques/music-sid.md`.

## Source

```asm
// music-during-load.asm
// Saves a 4,096-byte file to drive 8, then LOADs it three times with a
// one-voice player driven three ways, and counts player steps against
// frames while the KERNAL talks to the drive:
//   CIA1 TIMER  - CIA1 timer A interrupt at the frame rate, one step each
//   RASTER      - raster interrupt on line 250, one step each
//   CATCH-UP    - raster interrupt, steps until the step count equals
//                 a frame count kept by CIA2 timers A and B
// CIA2 timer A underflows once a frame and timer B counts the
// underflows; the KERNAL's serial code masks interrupts but never
// touches CIA2's timers, so the count keeps going. $02FF = $01 and a
// green border when the three loads match what was saved and the
// catch-up mode lost no step; $02FF = $02 and a red border otherwise.

BasicUpstart2(start)
.encoding "petscii_upper"

.const SETLFS = $ffba
.const SETNAM = $ffbd
.const LOAD   = $ffd5
.const SAVE   = $ffd8
.const CHROUT = $ffd2
.const PLOT   = $fff0
.const RESULT = $02ff
.const DATA   = $4000            // the 4,096 bytes saved
.const BUF    = $5000            // where each LOAD puts them
.const LEN    = 4096
.const LINE   = 250              // raster line of the music interrupt
.const EARLY  = 1000             // CIA2 frame clock runs this far ahead

start:
    lda $02a6                    // KERNAL PAL/NTSC flag: 1 PAL, 0 NTSC
    beq ntsc
    lda #<(19656-1)              // PAL: 312 lines x 63 cycles
    ldx #>(19656-1)
    bne setfr
ntsc:
    lda #<(17095-1)              // NTSC 6567R8: 263 lines x 65 cycles
    ldx #>(17095-1)
setfr:
    sta fr
    stx fr+1
    sec
    sbc #<EARLY
    sta early
    txa
    sbc #>EARLY
    sta early+1

    lda #$93
    jsr CHROUT
    ldx #<title
    ldy #>title
    jsr print_z

    lda #$09                     // voice 1: triangle, fast attack, full sustain
    sta $d405
    lda #$f0
    sta $d406
    lda #$11
    sta $d404
    lda #$0f
    sta $d418

    lda #$5a                     // DATA = 4,096 bytes of an 8-bit LFSR
    ldx #0
    ldy #>DATA
    sty fill+2
fill_lp:
    lsr
    bcc !+
    eor #$b8
!:
fill:
    sta DATA,x
    inx
    bne fill_lp
    inc fill+2
    ldy fill+2
    cpy #>(DATA+LEN)
    bne fill_lp

    lda #1                       // SAVE "DATA",8
    ldx #8
    ldy #0
    jsr SETLFS
    lda #4
    ldx #<fname
    ldy #>fname
    jsr SETNAM
    lda #<DATA
    sta $fb
    lda #>DATA
    sta $fc
    lda #$fb
    ldx #<(DATA+LEN)
    ldy #>(DATA+LEN)
    jsr SAVE
    lda #0
    rol                          // carry = SAVE failed
    sta allok

    sei
    lda #<irq
    sta $0314
    lda #>irq
    sta $0315

    lda #0
    sta curmode
mode_lp:
    lda #0
    sta thisok
    jsr clear_buf
    lda curmode
    jsr arm
    lda #1                       // LOAD "DATA",8,0 to BUF
    ldx #8
    ldy #0
    jsr SETLFS
    lda #4
    ldx #<fname
    ldy #>fname
    jsr SETNAM
    lda #0
    ldx #<BUF
    ldy #>BUF
    jsr LOAD
    bcs bad_load
    cpx #<(BUF+LEN)              // LOAD returns the end address
    bne bad_load
    cpy #>(BUF+LEN)
    bne bad_load
    jsr compare
    beq load_ok
bad_load:
    lda #1
    sta thisok
    sta allok
load_ok:
    lda #1
    sta stop                     // the next interrupt takes the snapshot
!:  lda done
    beq !-
    sei
    jsr report
    inc curmode
    lda curmode
    cmp #3
    bne mode_lp

    lda allok                    // verdict: loads matched, catch-up lost 0
    bne fail
    lda lost2
    ora lost2+1
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
    jmp *

// ---------------------------------------------------------------- set-up
// arm: A = mode. Masks both interrupt sources, clears the counters, then
// enables CIA1 timer A at the frame rate (mode 0) or the raster
// interrupt on LINE (modes 1 and 2).
arm:
    sta mode
    lda #0
    sta started
    sta stop
    sta done
    sta steps
    sta steps+1
    sta maxgap
    sta lastf
    sta lastf+1
    lda #$7f
    sta $dc0d
    lda $dc0d
    lda #0
    sta $d01a
    lda #$0f
    sta $d019
    lda mode
    bne arm_raster
    lda fr
    sta $dc04
    lda fr+1
    sta $dc05
    lda #$11                     // start, continuous, force load
    sta $dc0e
    lda #$81
    sta $dc0d
    cli
    rts
arm_raster:
    lda #LINE
    sta $d012
    lda $d011
    and #$7f
    sta $d011
    lda #1
    sta $d01a
    cli
    rts

// ---------------------------------------------------------------- interrupt
// Entered from the KERNAL's $FF48 dispatcher through $0314.
irq:
    lda mode
    bne irq_r
    lda $dc0d                    // acknowledge CIA1
    jmp irq_common
irq_r:
    lda #$01
    sta $d019                    // acknowledge the raster interrupt
irq_common:
    lda started
    bne running
    // First interrupt: start the frame clock. Timer A's first period is
    // EARLY cycles short, so every later underflow lands that far ahead
    // of the interrupt it pairs with.
    lda early
    sta $dd04
    lda early+1
    sta $dd05
    lda #$ff
    sta $dd06
    sta $dd07
    lda #$51                     // B: count A's underflows, force load, start
    sta $dd0f
    lda #$11                     // A: continuous, force load, start
    sta $dd0e
    lda fr                       // later reloads: one frame
    sta $dd04
    lda fr+1
    sta $dd05
    inc started
    jmp $ea81

running:
    jsr elapsed                  // el = frames since the first interrupt
    sec                          // gap since the last interrupt, frames
    lda el
    sbc lastf
    tax
    lda el+1
    sbc lastf+1
    beq !+
    ldx #$ff                     // 255 or more: saturate
!:  cpx maxgap
    bcc !+
    stx maxgap
!:  lda el
    sta lastf
    lda el+1
    sta lastf+1

    lda mode
    cmp #2
    bne play_once
catch_up:                        // step until steps = el
    lda steps
    cmp el
    bne !+
    lda steps+1
    cmp el+1
    beq played
!:  jsr play
    jmp catch_up
play_once:
    jsr play
played:
    lda stop
    beq irq_out
    lda el                       // snapshot, then silence both sources
    sta snapf
    lda el+1
    sta snapf+1
    lda steps
    sta snaps
    lda steps+1
    sta snaps+1
    lda #$7f
    sta $dc0d
    lda #0
    sta $d01a
    inc done
irq_out:
    jmp $ea81

// elapsed: el = $FFFF - CIA2 timer B, read so that a borrow between the
// two byte reads cannot mix two counts.
elapsed:
    lda $dd07
    ldx $dd06
    cmp $dd07
    bne elapsed
    eor #$ff
    sta el+1
    txa
    eor #$ff
    sta el
    rts

// ---------------------------------------------------------------- player
// One step: count it, and every eighth step set voice 1 to the next of
// sixteen notes.
play:
    inc steps
    bne !+
    inc steps+1
!:  lda steps
    and #7
    bne !+
    lda steps
    lsr
    lsr
    lsr
    and #15
    tax
    lda note_lo,x
    sta $d400
    lda note_hi,x
    sta $d401
!:  rts

// ---------------------------------------------------------------- checks
clear_buf:
    lda #0
    tax
    ldy #>BUF
    sty cb+2
cb: sta BUF,x
    inx
    bne cb
    inc cb+2
    ldy cb+2
    cpy #>(BUF+LEN)
    bne cb
    rts

// compare: Z set when BUF matches DATA for all LEN bytes.
compare:
    lda #>DATA
    sta cm1+2
    lda #>BUF
    sta cm2+2
    ldx #0
cm1:
    lda DATA,x
cm2:
    cmp BUF,x
    bne cm_out
    inx
    bne cm1
    inc cm1+2
    inc cm2+2
    lda cm2+2
    cmp #>(BUF+LEN)
    bne cm1
    lda #0
cm_out:
    rts

// ---------------------------------------------------------------- report
// Row 4 + mode: name, frames, steps, lost, longest gap, load check.
report:
    lda curmode
    clc
    adc #3
    sta row
    ldy #0
    jsr at                       // PLOT changes X and Y: position first
    lda curmode
    asl
    tax
    ldy names+1,x
    lda names,x
    tax
    jsr print_z
    sec                          // lost = frames - steps
    lda snapf
    sbc snaps
    sta lost
    lda snapf+1
    sbc snaps+1
    sta lost+1
    ldy #12
    jsr at
    lda snapf+1
    ldx snapf
    jsr print_dec
    ldy #19
    jsr at
    lda snaps+1
    ldx snaps
    jsr print_dec
    ldy #26
    jsr at
    lda lost+1
    ldx lost
    jsr print_dec
    ldy #31
    jsr at
    lda #0
    ldx maxgap
    jsr print_dec
    ldy #35
    jsr at
    ldx #<ok_s
    ldy #>ok_s
    lda thisok
    beq !+
    ldx #<bad_s
    ldy #>bad_s
!:  jsr print_z
    lda curmode
    cmp #2
    bne !+
    lda lost
    sta lost2
    lda lost+1
    sta lost2+1
!:  rts

// print_dec: print X (low) / A (high) in decimal, no leading zeros.
print_dec:
    stx num
    sta num+1
    lda #0
    sta lead
    ldy #4                       // 10000, 1000, 100, 10, 1
pd_digit:
    ldx #0
pd_sub:
    lda num
    sec
    sbc p10_lo,y
    sta tmp
    lda num+1
    sbc p10_hi,y
    bcc pd_out
    sta num+1
    lda tmp
    sta num
    inx
    bne pd_sub
pd_out:
    txa
    bne pd_print
    lda lead
    bne pd_print
    cpy #0                       // the units digit always prints
    bne pd_next
pd_print:
    inc lead
    txa
    ora #$30
    jsr CHROUT
pd_next:
    dey
    bpl pd_digit
    rts

at:                              // cursor to row, column Y
    ldx row
    clc
    jmp PLOT

print_z:                         // print the zero-terminated string at X/Y
    stx $fb
    sty $fc
    ldy #0
!:  lda ($fb),y
    beq !+
    jsr CHROUT
    iny
    bne !-
!:  rts

// ---------------------------------------------------------------- data
title:
    .text "MUSIC DURING A KERNAL LOAD, 4096 BYTES"
    .byte 13, 13
    .text "DRIVER      FRAMES STEPS  LOST GAP LOAD"
    .byte 13, 0
n0: .text "CIA1 TIMER"
    .byte 0
n1: .text "RASTER"
    .byte 0
n2: .text "CATCH-UP"
    .byte 0
names:
    .word n0, n1, n2
ok_s:
    .text "OK"
    .byte 0
bad_s:
    .text "NO"
    .byte 0
fname:
    .text "DATA"
note_lo:
    .byte $0c, $1c, $2d, $3e, $51, $66, $7b, $91
    .byte $a9, $c3, $dd, $fa, $18, $38, $5a, $7d
note_hi:
    .byte $11, $12, $13, $14, $15, $16, $17, $18
    .byte $19, $1a, $1b, $1c, $1e, $1f, $20, $21

p10_lo: .byte <1, <10, <100, <1000, <10000
p10_hi: .byte >1, >10, >100, >1000, >10000

fr:     .word 0
num:    .word 0
tmp:    .byte 0
lead:   .byte 0
early:  .word 0
el:     .word 0
lastf:  .word 0
steps:  .word 0
snapf:  .word 0
snaps:  .word 0
lost:   .word 0
lost2:  .word 0
maxgap: .byte 0
mode:   .byte 0
curmode: .byte 0
started: .byte 0
stop:   .byte 0
done:   .byte 0
allok:  .byte 0
thisok: .byte 0
row:    .byte 0
```

## Build

```bash
java -jar KickAss.jar music-during-load.asm -o music-during-load.prg
```

Run it with a freshly formatted D64 in drive 8 and true drive
emulation, which `x64sc -default` has on. `runs.json` pins the run at
60,000,000 cycles with a blank `TEST,01` disk; a run stopped at
45,000,000 had not finished the third LOAD.

## Expected output

Border green, `$02FF` = `$01`. PAL (`screenshots/music-during-load.png`):

```
MUSIC DURING A KERNAL LOAD, 4096 BYTES

DRIVER      FRAMES STEPS  LOST GAP LOAD
CIA1 TIMER  514    332    182  9   OK
RASTER      515    450    65   8   OK
CATCH-UP    547    547    0    33  OK
```

NTSC 6567R8 (`screenshots/music-during-load-ntsc.png`):

```
MUSIC DURING A KERNAL LOAD, 4096 BYTES

DRIVER      FRAMES STEPS  LOST GAP LOAD
CIA1 TIMER  605    434    171  11  OK
RASTER      650    535    115  36  OK
CATCH-UP    614    614    0    11  OK
```

Both pictures were decoded cell by cell against the character ROM
(rung 1, VICE x64sc 3.10, PAL C64C and `-model ntsc`, 1541-II true drive
on a fresh D64). The border pixel (2, 100) is (98, 213, 50) on PAL and
(114, 189, 103) on NTSC, index 5 in both palettes of
`runtime/vice-reference.md`. Two PAL runs gave byte-identical
screenshots.

The columns:

- `FRAMES`: CIA2 timer B's count of timer A underflows, one per frame,
  from the first interrupt after the mode was armed to the first
  interrupt after LOAD returned.
- `STEPS`: player calls over the same span.
- `LOST`: `FRAMES` minus `STEPS`.
- `GAP`: the most frames between two interrupts that were serviced.
  With the catch-up, it is also the most steps played in one interrupt
  and so how far the music fell behind before catching up.
- `LOAD`: `OK` when LOAD returned carry clear, the end address
  `$6000`, and all 4,096 bytes equal the saved ones.

Over nine loads per model (the three above and six from an experiment
build of this listing that runs the drivers in the order raster, CIA1
timer, catch-up, raster, catch-up, CIA1 timer; rung 1, not pinned):

| Driver | Loads | PAL frames | PAL lost | NTSC frames | NTSC lost |
|---|---|---|---|---|---|
| CIA1 timer | 3 | 514 each | 164 to 182 (32 to 35 %) | 605 to 612 | 171 to 187 (28 to 31 %) |
| Raster | 3 | 515 to 549 | 65 to 94 (13 to 17 %) | 606 to 650 | 72 to 115 (12 to 18 %) |
| Catch-up | 3 | 547 to 548 | 0 | 614 to 654 | 0 |

### Why FRAMES differs from load to load

An earlier version of this section said the same file took up to 35 PAL
and 49 NTSC frames longer from one load to the next, with the raster and
catch-up drivers only, and left the cause open (#112). The loads did not
take that much longer. `FRAMES` started late.

`FRAMES` counts from the first interrupt after the mode is armed. Soon
after it is called, LOAD masks interrupts and keeps them masked until the
first byte arrives, while the drive finds the file: 21 to 44 frames over
all the runs below. Interrupts were still taken 0.4 PAL and 0.7 NTSC
frames into the call. If the first interrupt comes before
that stretch, `FRAMES` includes it and `GAP` shows it. If it comes after,
`FRAMES` misses it. The page's short loads are the ones that missed it.

Traced in the two pinned runs (trace on stores to `$AE`, LOAD's store
pointer, and on execution at `$FFD5` and at the handler; the exit
screenshots stayed pixel-identical to the committed ones; rung 1):

| Run | Driver | LOAD call to return | Masked opening | First interrupt | `FRAMES` |
|---|---|---|---|---|---|
| PAL | CIA1 timer | 538.6 | 24.6 | +25.0 | 514 |
| PAL | Raster | 548.3 | 34.2 | +33.8 | 515 |
| PAL | Catch-up | 548.3 | 34.2 | +0.4 | 547 |
| NTSC | CIA1 timer | 634.9 | 29.4 | +30.0 | 605 |
| NTSC | Raster | 650.8 | 37.3 | +0.7 | 650 |
| NTSC | Catch-up | 654.2 | 40.6 | +40.1 | 614 |

All figures are frames. "First interrupt" is counted from the LOAD
call. When the first interrupt falls after the opening, `LOST` misses
the opening too. In the PAL CIA1 and raster loads and the NTSC CIA1 load,
about 25, 34 and 29 frames passed with no step before `FRAMES` started.
`LOST` does not count them.

What really moves the load time is where the disk is in its turn when
LOAD is called. An experiment build of this listing waited 0 to 19
steps of about 10,300 cycles before each LOAD, which moves the call
through one revolution. The masked opening then formed a sawtooth over
one revolution:

| Model | Opening, after a LOAD | Opening, after the SAVE | Byte transfer (first byte to last) |
|---|---|---|---|
| PAL | 26.8 to 36.3 | 21.2 to 30.7 | 510.2 to 510.3 (some 507.1) |
| NTSC | 32.1 to 44.0 | 25.5 to 36.8 | 601.0 to 609.1 |

A revolution at 300 rpm is 10.0 PAL or 12.0 NTSC frames. The jump at the
sawtooth's edge is 9.5 PAL and 11.3 NTSC frames, about one revolution.
That fits the drive just missing the sector it wants and waiting a full
turn for it; the drive's side was not traced (rung 3). These runs were in
VICE x64sc 3.10 with the true-drive 1541 and the drive's speed wobble off,
as `verify:recipes` runs it (rung 1). That is VICE's drive model, not a
bench 1541.

At nearly the same rotational position the raster and catch-up drivers
gave the same opening, within 0.05 frames, so the driver makes no
difference.
Handler length does, but only to the byte transfer. Padding the handler
by about 3,850 cycles, a fifth of a PAL frame, lengthened the transfer
from 510 to 613 to 625 frames. The KERNAL's handshake waits for the C64,
so every cycle spent in the handler between bytes delays the load. With
the recipe's short handlers the PAL byte transfer was the same for all
three drivers, within 0.1 frame.

## Why this works

### Where the steps go

The KERNAL's serial byte routines run with interrupts masked. ACPTR,
the receive routine LOAD calls for every byte, starts with `SEI` at
`$EE13`, waits at `$EE1B` for the drive to raise CLK, and ends with
`CLI` at `$EE82` (ROM `kernal-901227-03.bin`, rung 1). While the drive
reads the next sector, the C64 sits in that wait with the I flag set.
Only between bytes, in LOAD's own loop, can an interrupt be taken.

That costs the two interrupt sources differently:

- **Raster interrupt.** The VIC-II holds one pending match in `$D019`.
  A match during a masked stretch is taken at the next `CLI`; a second
  match in the same stretch is not recorded. Frames are lost only when
  a masked stretch is longer than a frame, which is what `GAP` shows.
- **CIA1 timer A interrupt.** Worse. ACPTR arms CIA1 timer B as its
  EOI timeout and polls for it by reading `$DC0D`, at `$EE2D` and in
  the loop at `$EE30`. Reading `$DC0D` clears every flag in it, timer
  A's too, and releases the IRQ line (`hardware/cia-reference.md`,
  `$DC06` and `$DC0D`). A timer A underflow that falls
  inside ACPTR before those reads is acknowledged by the KERNAL and
  never reaches the handler. That is why the CIA1 driver loses about
  twice what the raster driver loses in the same load.

The pitfall is `raster_irq_during_serial_io` in
`pitfalls/kernal-and-io.md`, which measures the raster case for
sequential files.

### Why the catch-up holds

CIA2's timers are not touched by the serial code: ACPTR and the send
routine use `$DD00` for the bus lines and CIA1 timer B for timeouts.
So CIA2 timer A, running continuously with a one-frame latch, underflows
once per frame through every masked stretch, and timer B, set to count
those underflows (`$DD0F` = `$51`), keeps the frame count. Each
interrupt reads timer B, turns it into frames elapsed, and calls the
player until the step count matches. A stretch of 33 masked frames
becomes 33 steps played in one interrupt, late but in order, and the
tune keeps its place.

The frame clock is started inside the first interrupt, with timer A's
first period 1,000 cycles short. Every later underflow therefore lands
about 1,000 cycles before the interrupt it pairs with, so an interrupt
that enters a few cycles early never reads the previous frame's count.

### What the catch-up does not fix

The music still stops for the length of each gap and then runs the
missed steps at once. With this listing's player a step is a few dozen
cycles. The full player of `music-player.md` costs up to 1,198 cycles a
call (its Cost line), so 33 steps in one interrupt would be about
39,500 cycles, two PAL frames (rung 3, arithmetic, not measured here).
A game that cannot afford that can cap the steps per interrupt and let
the rest follow over the next frames, or skip the missed rows without
sounding them.

`$02A6`, the KERNAL's PAL/NTSC flag, picks the frame length: 19,656
cycles (312 lines of 63) or 17,095 (263 lines of 65). The old NTSC
6567R56A, 262 lines of 64 cycles, would need 16,768 and reads as NTSC
here; this listing was not run on it.

The agent in the #22 game test paced its tune from a TOD clock instead
and reported 546 steps in a 549-frame LOAD on PAL and 643 in 642 on
NTSC (issue #108; the agent's figures, not measured here). TOD also
keeps counting while interrupts are masked, but it counts tenths of a
second, five PAL or six NTSC frames each, so a count paced from TOD
alone moves five or six steps at a time.
