---
recipe: tape-turbo-loader
toolchain: kickassembler
output_format: PRG
region: both
techniques: [tape_turbo_loader]
file_formats: [PRG, TAP]
uses_registers: [D011, D012, D020, DC06, DC07, DC0D, DC0F, DD04, DD05, DD06, DD07, DD0E, DD0F]
uses_kernal: [CHROUT]
claims: [vic_raster_irq (init), zero_page $02-$15+$FB-$FE (owns)]
harness: [cia2_timer_a, cia2_timer_b, $02FF]
ram: [buf=$4000-$41F3]
---

<!-- doc-type: recipe -->

# KickAssembler Tape Turbo Loader

## Synopsis

Read a block from tape at one pulse per bit, without the KERNAL's tape
routines. A Python script writes a TAP file whose stream is a lead-in of
1 bits, a sync byte, a two-byte length, 500 bytes of known data and an
XOR checksum, with a 256-cycle pulse for a 0 and a 512-cycle pulse for
a 1. The loader turns the motor on through `$01`, polls the FLAG bit of
`$DC0D` for each falling edge of the cassette read line, times the gap
between edges with a free-running CIA 1 Timer B, sorts each gap against
a threshold of 384 cycles, waits for sixty-four 1 bits and the 0 that
opens the sync byte, and then assembles the bytes. It prints the lead-in
pulses it saw, the length, its own checksum beside the tape's, the CIA 2
cycle count over the timed span and the bytes per second that gives on
the detected model, and the shortest and longest pulse it measured for
each bit value. The verdict at `$02FF` is `01` and the border turns
green when the length, both checksums and every byte match the
compiled-in expectation, else `02` and red. The technique is
`tape_turbo_loader` on `../../techniques/file-io.md`; the KERNAL's own
pulse-pair encoding, which this deliberately is not, is measured in
`../../formats/c64-file-formats.md` under "KERNAL bit encoding".

## Source

```asm
// tape-turbo-loader.asm
// Read a one-pulse-per-bit turbo block from tape without the KERNAL's tape
// routines: motor on through $01, FLAG edges polled in $DC0D, each pulse
// timed by a free-running CIA 1 Timer B, bits sorted by a threshold.
// Prints the lead-in count, the block's checksum, the cycles and bytes per
// second over the block and the pulse lengths seen for each bit value.
BasicUpstart2(start)

.const CHROUT  = $ffd2
.const VERDICT = $02ff
.const PORT    = $01          // 6510 port: bit 4 sense (0 = PLAY down), bit 5 motor (0 = on)
.const ICR     = $dc0d        // CIA 1 interrupt control: bit 4 is the FLAG edge
.const TBLO    = $dc06
.const TBHI    = $dc07
.const CRB     = $dc0f
.const C2TALO  = $dd04        // CIA 2 timers cascaded as a 32-bit stopwatch
.const C2TAHI  = $dd05
.const C2TBLO  = $dd06
.const C2TBHI  = $dd07
.const C2CRA   = $dd0e
.const C2CRB   = $dd0f
.const BORDER  = $d020
.const SCRCTL  = $d011
.const RASTER  = $d012

.const THRESH     = 384       // cycles: a 0 is 256 cycles, a 1 is 512, on the tape written by make_tap.py
.const SYNC       = $5a       // first bit 0, so it also ends the lead-in of 1 bits
.const LEADIN_MIN = 64        // consecutive 1 bits before a 0 counts as sync
.const EXPECT_LEN = 500
.const EXPECT_CHK = $40       // XOR of the 500 bytes (i*7+3)&255, printed by make_tap.py
.const BUF        = $4000
.const PAL_CLOCK  = 985248
.const NTSC_CLOCK = 1022727

// zero page
.const last   = $fb           // Timer B at the previous edge
.const now    = $fd
.const pulse  = $02           // length of the last pulse, cycles
.const byte   = $04
.const ptr    = $05           // 2 bytes
.const remain = $07           // 2 bytes: bytes still to read
.const chk    = $09
.const n      = $0a           // 4 bytes: dividend / value to print
.const d      = $0e           // 2 bytes: divisor
.const rem    = $10           // 3 bytes
.const cnt    = $13
.const tmp    = $14           // 2 bytes

start:
    lda #$93
    jsr CHROUT
    ldx #0
!:  lda title,x
    beq !+
    jsr CHROUT
    inx
    bne !-
!:
    sei
    lda #$7f
    sta ICR                   // no CIA 1 interrupts while we poll the ICR
    lda ICR                   // clear anything pending
    lda #$00
    sta CRB                   // Timer B stopped
    lda #$ff
    sta TBLO
    sta TBHI                  // latch $FFFF
    lda #$11                  // force load and run continuously from the system clock
    sta CRB

wait_play:
    lda PORT
    and #$10
    bne wait_play             // bit 4 low: PLAY is down
    lda PORT
    and #$df
    sta PORT                  // bit 5 low: motor on
    lda SCRCTL
    and #$ef
    sta SCRCTL                // screen off: no badline steals the poll

    lda #0
    sta leadin
    sta leadin+1
    sta ones
    jsr read_pulse            // prime 'last'

// lead-in: wait for LEADIN_MIN consecutive 1 bits, then the first 0 is bit 7 of SYNC
sync_loop:
    jsr read_bit
    inc leadin
    bne !+
    inc leadin+1
!:  bcc got_zero
    lda ones
    cmp #LEADIN_MIN
    bcs sync_loop
    inc ones
    bne sync_loop
got_zero:
    lda ones
    cmp #LEADIN_MIN
    bcc reset_ones            // a 0 too early: start counting again
    lda #0
    sta byte
    lda #7
    sta cnt
!:  jsr read_bit              // read_bit leaves X as the stats slot, so count in memory
    rol byte
    dec cnt
    bne !-
    lda byte
    cmp #SYNC
    beq synced
reset_ones:
    lda #0
    sta ones
    beq sync_loop

synced:
    jsr stats_reset           // set up now: a 0 pulse is short and the next edge will not wait
    jsr stopwatch_start
    jsr read_byte
    sta remain
    sta length
    jsr read_byte
    sta remain+1
    sta length+1
    lda #<BUF
    sta ptr
    lda #>BUF
    sta ptr+1
    lda #0
    sta chk
    ldy #0
block_loop:
    lda remain
    ora remain+1
    beq block_done
    jsr read_byte
    sta (ptr),y
    eor chk
    sta chk
    inc ptr
    bne !+
    inc ptr+1
!:  lda remain
    bne !+
    dec remain+1
!:  dec remain
    jmp block_loop
block_done:
    jsr read_byte
    sta tapechk
    jsr stopwatch_stop        // timed: length, block and checksum, EXPECT_LEN + 3 bytes

    lda PORT
    ora #$20
    sta PORT                  // motor off
    lda SCRCTL
    ora #$10
    sta SCRCTL
    lda #$81
    sta ICR                   // Timer A interrupt back on for the KERNAL
    cli

// verdict: length, checksum and every byte against the generating formula
    lda #2
    sta verdict
    lda length
    cmp #<EXPECT_LEN
    bne judged
    lda length+1
    cmp #>EXPECT_LEN
    bne judged
    lda chk
    cmp #EXPECT_CHK
    bne judged
    cmp tapechk
    bne judged
    jsr check_bytes
    bcs judged
    lda #1
    sta verdict
judged:

// report
    jsr detect_model
    lda #<t_leadin
    ldy #>t_leadin
    jsr print
    lda leadin
    sta n
    lda leadin+1
    sta n+1
    lda #0
    sta n+2
    sta n+3
    jsr print_dec
    lda #<t_len
    ldy #>t_len
    jsr print
    lda length
    sta n
    lda length+1
    sta n+1
    jsr print_dec
    lda #<t_chk
    ldy #>t_chk
    jsr print
    lda chk
    jsr print_hex
    lda #<t_tapechk
    ldy #>t_tapechk
    jsr print
    lda tapechk
    jsr print_hex
    lda #13
    jsr CHROUT

    lda #<t_cycles
    ldy #>t_cycles
    jsr print
    ldx #3
!:  lda cycles,x
    sta n,x
    dex
    bpl !-
    jsr print_dec
    lda #<t_bps
    ldy #>t_bps
    jsr print
    // bytes per second = clock / (cycles / length)
    ldx #3
!:  lda cycles,x
    sta n,x
    dex
    bpl !-
    lda #<[EXPECT_LEN + 3]
    sta d
    lda #>[EXPECT_LEN + 3]
    sta d+1
    jsr div32                 // n = cycles per byte
    lda n
    sta d
    lda n+1
    sta d+1
    lda model
    bne !+
    lda #<PAL_CLOCK
    sta n
    lda #>PAL_CLOCK
    sta n+1
    lda #[PAL_CLOCK >> 16]
    sta n+2
    bne !++
!:  lda #<NTSC_CLOCK
    sta n
    lda #>NTSC_CLOCK
    sta n+1
    lda #[NTSC_CLOCK >> 16]
    sta n+2
!:  lda #0
    sta n+3
    jsr div32
    jsr print_dec
    lda #<t_model
    ldy #>t_model
    jsr print
    lda model
    beq !+
    lda #<t_ntsc
    ldy #>t_ntsc
    bne !++
!:  lda #<t_pal
    ldy #>t_pal
!:  jsr print

    lda #<t_bit0
    ldy #>t_bit0
    jsr print
    ldx #0
    jsr print_range
    lda #<t_bit1
    ldy #>t_bit1
    jsr print
    ldx #4
    jsr print_range
    lda #13
    jsr CHROUT

    lda verdict
    sta VERDICT
    cmp #1
    beq good
    lda #2
    sta BORDER
    lda #<t_bad
    ldy #>t_bad
    jmp print
good:
    lda #5
    sta BORDER
    lda #<t_ok
    ldy #>t_ok
    jmp print

// ---------------------------------------------------------------- tape input

// Wait for a FLAG edge and measure the time since the previous one.
// Timer B free-runs down from $FFFF, so the length is last - now.
read_pulse:
    lda ICR
    and #$10
    beq read_pulse
    lda TBHI
    sta now+1
    lda TBLO
    sta now
    lda TBHI
    cmp now+1                 // the low byte wrapped between the reads: take both again
    beq !+
    sta now+1
    lda TBLO
    sta now
!:  sec
    lda last
    sbc now
    sta pulse
    lda last+1
    sbc now+1
    sta pulse+1
    lda now
    sta last
    lda now+1
    sta last+1
    rts

// One bit into the carry: 0 below THRESH cycles, 1 at or above it.
read_bit:
    jsr read_pulse
    lda pulse+1
    cmp #>THRESH
    bne !+
    lda pulse
    cmp #<THRESH
!:  php
    bcc !+
    ldx #4                    // stats slot for a 1
    bne !++
!:  ldx #0
!:  jsr stats_update
    plp
    rts

// Eight bits, most significant first.
read_byte:
    lda #8
    sta cnt
!:  jsr read_bit
    rol byte
    dec cnt
    bne !-
    lda byte
    rts

// min and max pulse length per bit value: min0, max0 at stats+0..3, min1, max1 at +4..7
stats_reset:
    ldx #1
!:  lda #$ff
    sta stats,x               // minima start at $FFFF
    sta stats+4,x
    lda #0
    sta stats+2,x             // maxima at 0
    sta stats+6,x
    dex
    bpl !-
    rts

stats_update:
    lda pulse+1
    cmp stats+1,x
    bne !+
    lda pulse
    cmp stats,x
!:  bcs !+
    lda pulse
    sta stats,x
    lda pulse+1
    sta stats+1,x
!:  lda stats+3,x
    cmp pulse+1
    bne !+
    lda stats+2,x
    cmp pulse
!:  bcs !+
    lda pulse
    sta stats+2,x
    lda pulse+1
    sta stats+3,x
!:  rts

// ---------------------------------------------------------------- stopwatch

stopwatch_start:
    lda #0
    sta C2CRA
    sta C2CRB
    lda #$ff
    sta C2TALO
    sta C2TAHI
    sta C2TBLO
    sta C2TBHI
    lda #$51                  // B counts A underflows, force load, start
    sta C2CRB
    lda #$11                  // A counts the clock, force load, start
    sta C2CRA
    rts

stopwatch_stop:
    lda #0
    sta C2CRA
    sta C2CRB
    sec
    lda #$ff
    sbc C2TALO
    sta cycles
    lda #$ff
    sbc C2TAHI
    sta cycles+1
    sec
    lda #$ff
    sbc C2TBLO
    sta cycles+2
    lda #$ff
    sbc C2TBHI
    sta cycles+3
    rts

// ---------------------------------------------------------------- checks

// C=0 when every byte of the block is (i*7+3)&255.
check_bytes:
    lda #<BUF
    sta ptr
    lda #>BUF
    sta ptr+1
    lda #3
    sta byte
    lda #<EXPECT_LEN
    sta remain
    lda #>EXPECT_LEN
    sta remain+1
    ldy #0
!:  lda (ptr),y
    cmp byte
    bne bad_byte
    lda byte
    clc
    adc #7
    sta byte
    inc ptr
    bne !+
    inc ptr+1
!:  lda remain
    bne !+
    dec remain+1
!:  dec remain
    lda remain
    ora remain+1
    bne !--
    clc
    rts
bad_byte:
    sec
    rts

// model = 0 for PAL, 1 for NTSC: a raster line at or past 288 exists only on PAL.
// 4096 reads of about 20 cycles cover four frames on either model.
detect_model:
    lda #1
    sta model
    ldx #0
    ldy #16
dm_loop:
    lda SCRCTL
    bpl dm_next
    lda RASTER
    cmp #$20
    bcc dm_next
    lda #0
    sta model
    rts
dm_next:
    dex
    bne dm_loop
    dey
    bne dm_loop
    rts

// ---------------------------------------------------------------- output

print:
    sta ptr
    sty ptr+1
    ldy #0
!:  lda (ptr),y
    beq !+
    jsr CHROUT
    iny
    bne !-
!:  rts

print_hex:
    pha
    lsr
    lsr
    lsr
    lsr
    jsr print_nibble
    pla
    and #$0f
print_nibble:
    ora #$30
    cmp #$3a
    bcc !+
    adc #6
!:  jmp CHROUT

// print stats slot X as "min-max"
print_range:
    lda stats,x
    sta n
    lda stats+1,x
    sta n+1
    lda #0
    sta n+2
    sta n+3
    lda stats+2,x
    sta tmp
    lda stats+3,x
    sta tmp+1
    jsr print_dec
    lda #'-'
    jsr CHROUT
    lda tmp
    sta n
    lda tmp+1
    sta n+1
    jmp print_dec

// n (32-bit) in decimal, by repeated division by ten
print_dec:
    lda #0
    sta cnt
!:  lda #10
    sta d
    lda #0
    sta d+1
    jsr div32
    lda rem
    pha
    inc cnt
    lda n
    ora n+1
    ora n+2
    ora n+3
    bne !-
!:  pla
    ora #$30
    jsr CHROUT
    dec cnt
    bne !-
    rts

// n = n / d, rem = n mod d; shift-and-subtract, 32 steps
div32:
    lda #0
    sta rem
    sta rem+1
    sta rem+2
    ldx #32
!:  asl n
    rol n+1
    rol n+2
    rol n+3
    rol rem
    rol rem+1
    rol rem+2
    sec
    lda rem
    sbc d
    tay
    lda rem+1
    sbc d+1
    pha
    lda rem+2
    sbc #0
    bcc !+
    sta rem+2
    pla
    sta rem+1
    sty rem
    inc n
    bne !++
!:  pla
!:  dex
    bne !---
    rts

// ---------------------------------------------------------------- data

title:     .text "TAPE TURBO LOADER"
           .byte 13, 0
t_leadin:  .text "LEADIN "
           .byte 0
t_len:     .text " LEN "
           .byte 0
t_chk:     .text " CHK "
           .byte 0
t_tapechk: .text "/"
           .byte 0
t_cycles:  .text "CYCLES "
           .byte 0
t_bps:     .text " B/S "
           .byte 0
t_model:   .text " "
           .byte 0
t_pal:     .text "PAL"
           .byte 13, 0
t_ntsc:    .text "NTSC"
           .byte 13, 0
t_bit0:    .text "BIT0 "
           .byte 0
t_bit1:    .text " BIT1 "
           .byte 0
t_ok:      .text "OK"
           .byte 13, 0
t_bad:     .text "BAD"
           .byte 13, 0

leadin:    .word 0
ones:      .byte 0
length:    .word 0
tapechk:   .byte 0
verdict:   .byte 0
model:     .byte 0
cycles:    .byte 0, 0, 0, 0
stats:     .fill 8, 0
```

## Build

The tape first. This script is not part of the listing; save it as
`make_tap.py` beside the source and run it once:

```text
#!/usr/bin/env python3
"""Write a TAP v1 file for the tape-turbo-loader recipe.

One pulse per bit: a short pulse is a 0, a long pulse is a 1. The
stream is a lead-in of 1 bits, a sync byte, a two-byte length, the data
block and an XOR checksum, most significant bit first inside each byte.
"""
import struct
import sys

SHORT = 0x20        # 0 bit: 32 TAP units = 256 cycles
LONG = 0x40         # 1 bit: 64 TAP units = 512 cycles
LEADIN = 12000      # 1 bits before the sync byte: about 6 s, the tape runs from power-on
SYNC = 0x5A
LENGTH = 500


def data_byte(i):
    return (i * 7 + 3) & 0xFF


def bits_of(byte):
    return [(byte >> (7 - k)) & 1 for k in range(8)]


def main(path):
    pulses = []
    pulses += [LONG] * LEADIN
    data = bytes(data_byte(i) for i in range(LENGTH))
    check = 0
    for b in data:
        check ^= b
    stream = bytes([SYNC, LENGTH & 0xFF, LENGTH >> 8]) + data + bytes([check])
    for byte in stream:
        for bit in bits_of(byte):
            pulses.append(LONG if bit else SHORT)
    # a trailer of long pulses so the last data edge is followed by another
    pulses += [LONG] * 3000
    body = bytes(pulses)
    header = b"C64-TAPE-RAW" + bytes([1, 0, 0, 0]) + struct.pack("<I", len(body))
    with open(path, "wb") as f:
        f.write(header + body)
    cycles = sum(p * 8 for p in pulses[LEADIN + 8:LEADIN + 8 * (3 + LENGTH + 1)])
    print(f"wrote {path}: {len(body)} pulses, checksum ${check:02X}, "
          f"timed span {cycles} cycles")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "turbo.tap")
```

It prints `wrote turbo.tap: 19032 pulses, checksum $40, timed span
1540608 cycles`. Every TAP entry is one pulse of `value * 8` cycles, so
the file is 20 bytes of header and 19,032 bytes of pulses. The checksum
`$40` is the `EXPECT_CHK` constant in the listing; change `LENGTH` or
`data_byte` and the constant must follow. Then:

```bash
java -jar $KICKASS_JAR tape-turbo-loader.asm -o tape-turbo-loader.prg
printf 'tapectrl 1\n' > play.mon
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 \
  -limitcycles 12000000 +dsresetwithcpu \
  -dstapewobbleamp 0 -dstapewobblefreq 0 -dsspeedtuning 0 -dstapeerror 0 \
  -1 turbo.tap -moncommands play.mon \
  -exitscreenshot tape-turbo-loader.png -autostart tape-turbo-loader.prg
```

Add `-model ntsc` for the NTSC run. Three of those options matter and
were found by running without them. `-1` attaches the TAP, and
`tapectrl 1` in the monitor command file presses PLAY at power-on
(`help tapectrl` lists 0 stop, 1 start, 2 forward, 3 rewind, 4 record,
5 reset, 6 reset counter). `+dsresetwithcpu` keeps that press through
the reset autostart performs after the monitor commands have run;
without it the loader sat at its PLAY wait for the whole run. The four
`-ds` options turn off VICE's tape speed error and wobble so that two
runs give the same picture; with them at their defaults the block still
loaded and verified, but the pulse ranges widened (see below). The
program presses nothing itself: it waits for bit 4 of `$01` to go low,
then drives bit 5 low for the motor.

## Expected output

```
TAPE TURBO LOADER
LEADIN 10195 LEN 500 CHK 40/40
CYCLES 1540498 B/S 321 PAL
BIT0 248-264 BIT1 506-520
OK
```

Line by line: the number of lead-in pulses the loader saw before the
sync byte (the tape has been running since the KERNAL saw PLAY at
power-on, so the loader joins the lead-in part way through); the length
read from the tape; the loader's XOR of the block beside the checksum
byte from the tape; the CIA 2 cycle count from the end of the sync byte
to the end of the checksum byte, the 503 bytes of length, data and
checksum, and the bytes per second that count gives on the detected
model; and the shortest and longest pulse measured for a 0 and for a 1,
in cycles. `OK` and a green border mean `$02FF` holds `01`.

Measured on the windowless x64sc build of VICE 3.10 with the command
above (rung 1); two runs per model gave byte-identical screenshots, and
every character cell was decoded against the character ROM. The
pictures are `../../figures/tape-turbo-loader-pal.png` and
`../../figures/tape-turbo-loader-ntsc.png`. The NTSC picture reads
`LEADIN 9957`, `CYCLES 1540502 B/S 334 NTSC` and the same `BIT0 248-264
BIT1 506-520`: the TAP stores pulses in cycles, so the block costs the
same cycles on either model and the faster NTSC clock turns them into
more bytes per second. The 1,540,498 cycles the loader timed are 110
less than the 1,540,608 the script summed for the same span, which is
the poll's position inside the first and last pulse. The measured pulses
sit within 8 cycles of the 256 and 512 the file holds: that is the
polling loop's own granularity, `LDA`, `AND`, `BEQ`, nine cycles round.

The frontmatter's `claims:`, `harness:` and `ram:` come from a
`claims-watch` trace of that PAL run. `npm run claims:recipes` skips
this page (runs.json has no tape keys), so the trace was taken by hand:
the watch's four trace lines plus `tapectrl 1` in the command file,
the options above, `-monlog`, and `claims-watch --recipe ... --log`.
It passed with 0 violations; the picture matched the committed one.

With the four `-ds` options left out, so VICE's default tape speed
error and wobble apply, the PAL run read `LEADIN 10201`, `CYCLES
1547961 B/S 320`, `BIT0 231-283 BIT1 487-542` and still `OK`; NTSC gave
`CYCLES 1547864 B/S 332`, `BIT0 231-283 BIT1 490-539`. The spread grew
from 16 cycles to 52 on either bit and the block took 0.5 % longer. The
threshold of 384 had at least 101 cycles to spare on either side (101
below, 103 and 106 above), which is why the checksum survived; a real
Datasette's speed error is not measured here.

**Not pinned.** The listing gate assembles the source, but the
verifier's run cannot be pinned in `runs.json`: it formats a blank disk
and attaches nothing else, and this program needs the TAP on `-1`, the
`tapectrl 1` command file and `+dsresetwithcpu`. The pictures therefore
live under `docs/figures/` rather than `screenshots/`, and the command
above is the one that made them. A verifier run without the TAP leaves
the loader at its PLAY wait, so `--update` must not be run on this page:
the picture it would freeze shows nothing but that wait.

## Why this works

A Datasette turbo is a different stream from the KERNAL's, not a faster
reading of it. The KERNAL writes a bit as a pair of pulses drawn from
three lengths, twenty pulses to a byte and every block twice; this
stream has one pulse per bit and two lengths, eight pulses to a byte and
one copy. The C64 sees each pulse as one falling edge on the cassette
read line, which is wired to CIA 1's FLAG input, so `read_pulse` waits
for bit 4 of `$DC0D` and then reads Timer B, which was started once with
`$11` in `$DC0F` and runs down from `$FFFF` continuously. The length of
a pulse is the previous reading less this one, in cycles, with no timer
restart and nothing lost between pulses. Reading the timer takes two
instructions, and the low byte can wrap between them, so the high byte
is read again and both bytes taken afresh if it moved; a first version
that only re-read when the low byte was `$FF` mismeasured one pulse in
about sixty by 256 cycles, because the two reads are seven cycles apart
and any wrap inside that window is missed. `read_bit` compares the
16-bit length against 384 and returns the bit in the carry.

The sync scheme is what lets the loader start anywhere. The lead-in is
all 1 bits, so a run of sixty-four of them proves the loader is inside
it, and the first 0 after that run is, by construction, bit 7 of `$5A`.
Seven more bits are rotated in behind it; if the byte is not `$5A` the
count starts again. Because the tape has been running since the
KERNAL's interrupt saw PLAY at power-on, the loader joins the lead-in
late and the count printed is what was left. Everything after the sync
byte is plain: two length bytes, the block into `BUF`, one checksum.
The loader runs with interrupts off and CIA 1's interrupt sources
masked (`$7F` to `$DC0D`, then a read to clear what was pending),
because reading `$DC0D` clears every bit in it, and a KERNAL interrupt
that read it first would steal FLAG edges; the KERNAL's own tape code
uses the same register and is left out for the same reason. Timer A's
interrupt is re-enabled afterwards so the KERNAL's clock and keyboard
scan resume.

The 256-cycle 0 pulse replaced a shorter one. An earlier build of this recipe
used 208 and 416 cycles with the threshold at 312, and its checksum
came out `C0` against the tape's `40`: the first data byte read `83`
for `03`, a 0 read as 376 cycles. The loader had spent about 170
cycles between the last length bit and the first data bit resetting its
statistics and starting the stopwatch, so it polled that edge late, and
its per-bit path (the poll, the double timer read, the subtraction, the
compare and the minimum and maximum bookkeeping) is about 175 cycles,
which leaves a 208-cycle pulse no room to absorb the debt. Moving the
setup ahead of the length bytes and widening the pulses to 256 and 512
cured it. A loader without the statistics can run shorter pulses; how
short, on this build, is not measured here.
