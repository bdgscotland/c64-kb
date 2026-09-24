---
recipe: fastloader-2bit
toolchain: kickassembler
output_format: PRG
region: both
techniques: [fastloader_2bit_protocol]
file_formats: [PRG, D64]
uses_registers: [D011, D020, DC06, DC07, DC0F, DD00]
uses_kernal: [SETLFS, SETNAM, OPEN, CHKOUT, CHROUT, CLRCHN, CLOSE]
devices: [disk_1541_ii]
claims: [vic_raster_irq (init), zero_page $FB-$FC (owns)]
harness: [cia1_timer_b, $02FF]
---

<!-- doc-type: recipe -->

# KickAssembler Two-Bit Fast Transfer from the 1541

## Synopsis

Against a freshly formatted disk in drive 8: upload a 158-byte routine
into the 1541's buffer 3 (`$0600`) with five `M-W` commands and start it with `M-E`,
as `drive-job-queue.md` does. The routine reads track 18 sector 0 (the
BAM) through the job queue and then sends its 256 bytes to the C64 two
bits at a time. The C64 is the clock: for every bit pair it flips ATN,
the drive answers the edge by putting the pair on CLK and DATA, and the
C64 reads `$DD00` a fixed 18 cycles after its own store. The drive keeps
its ATNA bit equal to the ATN level in the same store, so the 1541's
ATN gate does not pull DATA. A transfer of 256 bytes takes 42,758
cycles, 167 a byte: 5,900 bytes a second on PAL and 6,124 on NTSC
(measured, VICE 3.10). The verdict at `$02FF` is `01` and the border
turns green when all 256 bytes equal a compiled-in copy of the BAM. The
technique is `fastloader_2bit_protocol` on
`../../techniques/loaders-packers.md`.

## Source

```asm
// fastloader-2bit.asm
// Upload a drive routine with M-W, start it with M-E. It reads track 18
// sector 0 through the job queue and sends the 256 bytes two bits at a time:
// the C64 flips ATN for every bit pair and samples CLK and DATA a fixed
// number of cycles later. Verdict: all 256 bytes equal the BAM of a fresh
// "TEST,01" disk.
BasicUpstart2(start)

.const DELAY = 14            // cycles of waiting between the ATN store and the $DD00 read

.const SETLFS = $ffba
.const SETNAM = $ffbd
.const OPEN   = $ffc0
.const CLOSE  = $ffc3
.const CHKOUT = $ffc9
.const CLRCHN = $ffcc
.const CHROUT = $ffd2

.const VERDICT = $02ff
.const CODE    = $0600       // buffer 3 in the drive
.const BUF     = $0400       // buffer 1: the job reads the sector here
.const res     = $fb         // byte being assembled
.const cnt     = $fc
.const ATN_ON  = $0f         // VIC bank 0 bits, TXD high, ATN asserted, CLK and DATA released
.const ATN_OFF = $07         // the same with ATN released

// wait n cycles, n >= 2
.macro Wait(n) {
    .if (mod(n, 2) == 1) {
        bit $ea
        .for (var i = 0; i < (n - 3) / 2; i++) { nop }
    } else {
        .for (var i = 0; i < n / 2; i++) { nop }
    }
}
// one bit pair: the edge store, the wait, the read, two bits into res
.macro Pair(edge) {
    lda #edge
    sta $dd00
    Wait(DELAY)
    lda $dd00
    asl
    ror res                  // DATA IN, the pair's low bit
    asl
    ror res                  // CLK IN, the pair's high bit
}

start:
    lda #$93
    jsr CHROUT
    ldx #<title
    ldy #>title
    jsr print_z

    lda #15
    ldx #8
    ldy #15
    jsr SETLFS
    lda #0
    jsr SETNAM
    jsr OPEN
    bcc upload
    jmp no_drive

    // upload the drive routine in 32-byte chunks, then M-E it
upload:
    lda #0
    sta off
up_chunk:
    lda off
    cmp #drive_end-drive_code
    bcs up_done
    jsr send_chunk
    lda off
    clc
    adc #32
    sta off
    jmp up_chunk
up_done:
    ldx #15
    jsr CHKOUT
    ldy #0
me_1:
    lda me_cmd,y
    jsr CHROUT
    iny
    cpy #5
    bne me_1
    jsr CLRCHN               // the UNLISTEN here makes the drive run M-E

    // take the machine: no interrupts, no badlines
    sei
    lda $d011
    and #$ef                 // DEN off: no badlines once the next frame starts
    sta $d011
wf1:
    bit $d011
    bpl wf1
wf2:
    bit $d011
    bmi wf2                  // line 0 of a frame that has no badlines
    lda #ATN_OFF
    sta $dd00                // release CLK and DATA; the KERNAL left CLK held
wr_hi:
    bit $dd00
    bpl wr_hi                // DATA released: the DOS has let go of the bus
wr_lo:
    bit $dd00
    bmi wr_lo                // DATA low: the drive has the sector and is ready

    lda #$ff                 // harness: CIA1 timer B counts the transfer
    sta $dc06
    sta $dc07
    lda #$11
    sta $dc0f

    ldy #0
rx_byte:
    Pair(ATN_ON)
    Pair(ATN_OFF)
    Pair(ATN_ON)
    Pair(ATN_OFF)
    lda res
    eor #$ff                 // a drive output bit of 1 pulls the line low
    sta rbuf,y
    iny
    bne rx_byte

    lda #$00
    sta $dc0f                // stop the timer
    lda #ATN_ON              // one more edge pair: the drive lets go of the bus
    sta $dd00
    Wait(40)
    lda #ATN_OFF
    sta $dd00
    Wait(40)
    lda #$17                 // the KERNAL's idle $DD00: CLK held
    sta $dd00
    lda $dc06
    eor #$ff
    sta cyc
    lda $dc07
    eor #$ff
    sta cyc+1
    lda $d011
    ora #$10
    sta $d011
    cli

    ldx #<lbl_cyc
    ldy #>lbl_cyc
    jsr print_z
    lda cyc+1
    jsr print_hex
    lda cyc
    jsr print_hex
    lda #$0d
    jsr CHROUT
    ldy #0
show:
    lda rbuf,y
    jsr print_hex
    iny
    cpy #8
    bne show
    lda #$0d
    jsr CHROUT

    ldy #0
cmp_loop:
    lda rbuf,y
    cmp bam,y
    bne mismatch
    iny
    bne cmp_loop
    lda #1
    sta VERDICT
    lda #5
    sta $d020
    ldx #<lbl_ok
    ldy #>lbl_ok
    jsr print_z
    jmp finish
mismatch:
    sty cnt
    lda #2
    sta $d020
    ldx #<lbl_bad
    ldy #>lbl_bad
    jsr print_z
    lda cnt
    jsr print_hex
    lda #' '
    jsr CHROUT
    ldy cnt
    lda rbuf,y
    jsr print_hex
    lda #' '
    jsr CHROUT
    ldy cnt
    lda bam,y
    jsr print_hex
    lda #$0d
    jsr CHROUT
finish:
    lda #15
    jsr CLOSE
    ldx #<lbl_done
    ldy #>lbl_done
    jsr print_z
    rts

no_drive:
    ldx #<lbl_nodrive
    ldy #>lbl_nodrive
    jsr print_z
    rts

// --- M-W one chunk of the routine: off = offset into drive_code ---------
send_chunk:
    lda #drive_end-drive_code
    sec
    sbc off
    cmp #32
    bcc sc_len_ok
    lda #32
sc_len_ok:
    sta clen
    ldx #15
    jsr CHKOUT
    lda #'M'
    jsr CHROUT
    lda #'-'
    jsr CHROUT
    lda #'W'
    jsr CHROUT
    lda off
    clc
    adc #<CODE
    jsr CHROUT
    lda #>CODE
    adc #0
    jsr CHROUT
    lda clen
    jsr CHROUT
    ldx off
    ldy #0
sc_data:
    lda drive_code,x
    jsr CHROUT
    inx
    iny
    cpy clen
    bne sc_data
    jmp CLRCHN

print_hex:
    pha
    lsr
    lsr
    lsr
    lsr
    jsr ph_digit
    pla
    and #15
ph_digit:
    cmp #10
    bcc ph_num
    adc #6
ph_num:
    adc #'0'
    jmp CHROUT

print_z:                         // X/Y = zero-terminated PETSCII string
    stx pz+1
    sty pz+2
pz: lda $ffff
    beq pz_done
    jsr CHROUT
    inc pz+1
    bne pz
    inc pz+2
    bne pz
pz_done:
    rts

// --- the routine that runs on the drive's 6502, assembled for $0600 ------
.encoding "petscii_upper"
drive_code:
.pseudopc CODE {
    lda #18
    sta $08                  // buffer 1's track and sector
    lda #0
    sta $09
    lda #$b0                 // seek: the controller learns the disk ID
    sta $01
d_w1:
    lda $01
    bmi d_w1
    lda #$80                 // read track 18 sector 0 into $0400
    sta $01
d_w2:
    lda $01
    bmi d_w2
    sei                      // from here on the DOS does not see ATN
    lda #$02                 // DATA low: ready
    sta $1800
    ldy #0
d_byte:
    lda BUF,y
    sta d_tmp
    and #3
    tax
    lda tab_on,x             // pair 0, sent while ATN is asserted
d_w3:
    bit $1800
    bpl d_w3                 // wait for ATN asserted (bit 7 = 1)
    sta $1800
    lsr d_tmp
    lsr d_tmp
    lda d_tmp
    and #3
    tax
    lda tab_off,x            // pair 1, sent while ATN is released
d_w4:
    bit $1800
    bmi d_w4
    sta $1800
    lsr d_tmp
    lsr d_tmp
    lda d_tmp
    and #3
    tax
    lda tab_on,x             // pair 2
d_w5:
    bit $1800
    bpl d_w5
    sta $1800
    lsr d_tmp
    lsr d_tmp
    lda d_tmp
    and #3
    tax
    lda tab_off,x            // pair 3
d_w6:
    bit $1800
    bmi d_w6
    sta $1800
    iny
    bne d_byte
d_w7:
    bit $1800
    bpl d_w7
    lda #$10                 // lines released, ATNA matching ATN
    sta $1800
d_w8:
    bit $1800
    bmi d_w8
    lda #$00
    sta $1800
    lda $1801                // clear the ATN edge the VIA latched
    cli
    rts
// value for bits n: bit 0 -> DATA OUT (bit 1), bit 1 -> CLK OUT (bit 3);
// ATNA (bit 4) equal to the ATN level of the phase
tab_on:  .byte $10, $12, $18, $1a
tab_off: .byte $00, $02, $08, $0a
d_tmp:   .byte 0
}
drive_end:

me_cmd: .text "M-E"
        .byte <CODE, >CODE

bam:
    .byte $12, $01, $41, $00, $15, $ff, $ff, $1f, $15, $ff, $ff, $1f, $15, $ff, $ff, $1f
    .byte $15, $ff, $ff, $1f, $15, $ff, $ff, $1f, $15, $ff, $ff, $1f, $15, $ff, $ff, $1f
    .byte $15, $ff, $ff, $1f, $15, $ff, $ff, $1f, $15, $ff, $ff, $1f, $15, $ff, $ff, $1f
    .byte $15, $ff, $ff, $1f, $15, $ff, $ff, $1f, $15, $ff, $ff, $1f, $15, $ff, $ff, $1f
    .byte $15, $ff, $ff, $1f, $15, $ff, $ff, $1f, $11, $fc, $ff, $07, $13, $ff, $ff, $07
    .byte $13, $ff, $ff, $07, $13, $ff, $ff, $07, $13, $ff, $ff, $07, $13, $ff, $ff, $07
    .byte $13, $ff, $ff, $07, $12, $ff, $ff, $03, $12, $ff, $ff, $03, $12, $ff, $ff, $03
    .byte $12, $ff, $ff, $03, $12, $ff, $ff, $03, $12, $ff, $ff, $03, $11, $ff, $ff, $01
    .byte $11, $ff, $ff, $01, $11, $ff, $ff, $01, $11, $ff, $ff, $01, $11, $ff, $ff, $01
    .byte $d4, $c5, $d3, $d4, $a0, $a0, $a0, $a0, $a0, $a0, $a0, $a0, $a0, $a0, $a0, $a0
    .byte $a0, $a0, $30, $31, $a0, $32, $41, $a0, $a0, $a0, $a0, $00, $00, $00, $00, $00
    .byte $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
    .byte $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
    .byte $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
    .byte $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
    .byte $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00

title:      .text "TWO-BIT TRANSFER, DELAY " + toIntString(DELAY)
            .byte $0d, 0
lbl_cyc:    .text "256 BYTES, CYCLES $"
            .byte 0
lbl_ok:     .text "ALL 256 MATCH THE BAM"
            .byte $0d, 0
lbl_bad:    .text "DIFFERS AT "
            .byte 0
lbl_done:   .text "DONE"
            .byte $0d, 0
lbl_nodrive: .text "NO DRIVE"
            .byte $0d, 0

off:    .byte 0
clen:   .byte 0
cyc:    .word 0
        .align $100
rbuf:   .fill 256, 0
```

## Build

```bash
java -jar $KICKASS_JAR fastloader-2bit.asm -o fastloader-2bit.prg
c1541 -format "TEST,01" d64 test.d64
GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas x64sc -default -warp +sound \
  +autostart-delay-random -autostartprgmode 1 -limitcycles 8000000 \
  -8 test.d64 -drive8wobbleamplitude 0 -drive8wobblefrequency 0 \
  -exitscreenshot fastloader-2bit.png -autostart fastloader-2bit.prg
```

Add `-model ntsc` for the NTSC run. `-default` turns true drive
emulation on, which the routine needs: it runs on the emulated drive's
6502. The disk must be a `TEST,01` format, because the compiled-in 256
bytes are that disk's BAM as `c1541` writes it (offset 91,392 of the
`.d64`). Nothing is written to the disk.

## Expected output

```
TWO-BIT TRANSFER, DELAY 14
256 BYTES, CYCLES $A706
1201410015FFFF1F
ALL 256 MATCH THE BAM
DONE
```

and a green border. The second line is CIA1 timer B's count from the
store that starts it to the store that stops it: 42,758 cycles, the
same on PAL and NTSC, because every cycle of the C64's loop is fixed.
The third line is the first eight bytes received. On a failure the
fourth line reads `DIFFERS AT` with the offset, the byte received and
the byte expected, and the border is red.

Measured in VICE x64sc 3.10 with the pinned command at 8,000,000
cycles, PAL and NTSC, on a disk formatted by `c1541 -format "TEST,01"`
(rung 1). Two runs per model gave byte-identical screenshots, and
every character cell was decoded against the character ROM.
The screenshots are `screenshots/fastloader-2bit.png` and
`screenshots/fastloader-2bit-ntsc.png`.

### The delay, swept

`DELAY` is the number of cycles the C64 waits between its ATN store and
its `$DD00` read. The read's own sample is on the fourth cycle of `LDA
$DD00`, so the C64 samples `DELAY + 4` cycles after the store's write.
Each value was built and run once per model, on a fresh disk each run
(rung 1):

| `DELAY` | Store to sample | PAL | NTSC |
|---|---|---|---|
| 2 to 8 | 6 to 12 cycles | fails at byte 0 (`$5D`, `$5E` or `$52` for `$12`) | fails at byte 0 |
| 9 | 13 | fails at byte 1 (`$55` for `$01`) | fails at byte 0 (`$52`) |
| 10 | 14 | all 256 match | fails at byte 4 (`$55` for `$15`) |
| 11 to 18 | 15 to 22 | all 256 match | all 256 match |

The pinned value, 14, leaves four cycles of margin on PAL and three on
NTSC. The failures have one shape. When the C64 samples too early, the
drive has not yet stored the new pair, so CLK still carries the
previous pair's bit, and DATA is low because ATN has changed while ATNA
has not: the 1541's ATN gate pulls it (`../../pitfalls/loader.md`,
`atn_assert_drives_data_low_via_atna`). A low DATA inverts to a 1, so
the wrong bytes lean towards `$55`: a 1 in the low bit of most pairs.

Each `DELAY` step adds 4 cycles to a byte, one per pair: the timer read
`$7706` at 2 and `$B706` at 18. At 10 on PAL the transfer takes 38,662
cycles, 151 a byte, 6,525 bytes a second; at 11 on NTSC 39,686, 155 a
byte, 6,598 bytes a second.

### Alignment

| Event, one bit pair | When | How it was established |
|---|---|---|
| C64 `STA $DD00` writes the ATN edge | cycle 0 | host trace, `trace store dd00` |
| C64 `LDA $DD00` samples CLK and DATA | cycle `DELAY + 4`: 18 at the pinned value | host trace, `trace load dd00`: 18 in all 1,001 pairs the PAL trace kept and all 1,000 the NTSC trace kept; 14 at `DELAY` 10, 13 at 9, 15 at 11 |
| next edge | 38 cycles after this one within a byte (`DELAY + 24`), 53 across a byte boundary | host trace; 3 × 38 + 53 = 167 cycles a byte |
| drive `BIT $1800` sees ATN | 0 to 7 drive cycles after the edge: the wait loop is `BIT` (4) and a taken `BPL` (3) | instruction table (rung 3) |
| drive `STA $1800` puts the pair on the bus | 6 cycles after that read: `BPL` not taken (2), then the store's write on its fourth cycle; so 6 to 13 µs after the edge | instruction table (rung 3) |
| drive ready for the next edge | 24 cycles after its store (21 after the fourth pair of a byte): two `LSR` absolute, `LDA`, `AND`, `TAX`, `LDA` absolute,X | instruction table (rung 3) |

The sweep puts the drive's worst case between 13 and 14 C64 cycles on
PAL (13.2 and 14.2 µs at 985,248 Hz) and between 14 and 15 on NTSC
(13.7 and 14.7 µs at 1,022,727 Hz). Both brackets hold the 13 µs the
instruction table gives the drive's slowest answer, so the arithmetic
and the measurement agree: the threshold is the same time on both
models, and NTSC needs one more cycle only because its cycles are
shorter.

The drive's side of the table is arithmetic, not a trace reading. A
`-moncommands` file with `trace store 8:1800` beside the two host
traces logs every drive store, but the cycle VICE prints on a drive
line is the host clock at the moment the emulator brought the drive up
to date, not the drive instruction's own time: two `BIT $1800` passes
seven drive cycles apart print one stamp, and the drive's store for a
pair is printed with the stamp of the host's `$DD00` read that caused
the catch-up. The drive trace gives the order of events around each
host access, not their cycles. The trace also drops lines: about 2% of
the edges are missing from it (edge-to-edge gaps of 76 and 91, twice
38 and 38 + 53). Measured with `trace store dd00`, `trace load dd00`
and `trace store 8:1800` in one `-moncommands` file, `DELAY` 9, 10 and
14 on PAL and 10, 11 and 14 on NTSC; the pictures were the same as the
untraced runs.

### With the screen on

The pinned listing blanks the screen and sets the I flag during the
transfer, as fast loaders usually do. A variant that does neither,
leaving the KERNAL's interrupt running and the display on, also
received all 256 bytes on both models: 45,853 cycles on PAL and 46,245
on NTSC at `DELAY` 14, and the same thresholds (fails at 9, passes at
10 on PAL; fails at 10, passes at 11 on NTSC). In this form a badline or
an interrupt only makes the C64 later, and the drive waits: it holds
each pair until the next edge. Measured, VICE 3.10, rung 1.

## Why this works

The C64 is the only clock. The drive never sends on its own schedule:
it waits for ATN to change, stores the pair, and then holds it. So the
only timing the C64 must honour is a minimum, the drive's worst answer
time, and anything that makes the C64 slower (a badline, an interrupt,
a slower loop) is harmless. The two bits of a pair go out on the two
lines the drive can pull, CLK OUT (bit 3 of `$1800`) and DATA OUT
(bit 1), and arrive on the C64's CLK IN and DATA IN (bits 6 and 7 of
`$DD00`), inverted: a 1 in a drive output bit pulls the line low, and a
low line reads 0. `ASL` puts bit 7, then bit 6, into the carry, and two
`ROR`s rotate them into the byte being built, low pair first; after
four pairs `EOR #$FF` undoes the inversion.

ATN is the edge because the C64 must leave CLK and DATA to the drive,
and ATN is the one line left. Using it costs one thing: the 1541 pulls
DATA low in hardware whenever the ATN level differs from its ATNA bit.
The drive's two tables carry ATNA with the data: `tab_on` has bit 4 set
for pairs sent while ATN is asserted, `tab_off` has it clear, so each
store both puts the pair out and removes the gate's pull. Between the
edge and that store the gate does pull DATA, and a sample in that
window reads it (the sweep's `$55` bytes). The drive's `SEI` keeps the
DOS's ATN interrupt from taking the bus; at the end the drive waits for
one more pair of edges, releases the lines, reads `$1801` to clear the
ATN edge VIA1 latched, and returns to the DOS with `CLI`.

The start and the end are handshakes too. The seek and the read take
about a third of a second (`drive-job-queue.md` traced them), and the C64 cannot know when it is done, so the
drive pulls DATA low once it holds the sector with interrupts off. The
C64 first waits for DATA to be released (the DOS lets go after the
`M-E` command's UNLISTEN) and then for it to go low, and only then
sends the first edge. The job queue part is `drive-job-queue.md`'s: a
seek job first, so the controller knows the disk ID, then the read.
