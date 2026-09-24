---
recipe: drive-via-probe
toolchain: kickassembler
output_format: PRG
region: both
techniques: [drive_code_upload_and_job_queue]
file_formats: [PRG, D64]
uses_registers: []
uses_kernal: [SETLFS, SETNAM, OPEN, CHKOUT, CHROUT, CHKIN, CHRIN, CLRCHN, CLOSE]
claims: [zero_page $A1-$A2 (shares)]
harness: [$02FF]
kernal_services: [IRQ]
---

<!-- doc-type: recipe -->

# KickAssembler 1541 VIA Probe

## Synopsis

Against a freshly formatted disk in drive 8: read all sixteen registers
of each 1541 VIA and the first 32 bytes of the drive's zero page with
`M-R` while the drive is at rest, then upload a routine into buffer 3
that runs a seek job and, the moment the controller reports it done,
copies `$1800`, `$1C00`, the current-track byte `$22` and the status
byte `$20` into the buffer and reads four bytes off the head through
`$1C01`. The host runs it five times (tracks 18, 18, 1, 25, 31), reads
each snapshot back, and reads the same ports again itself. Five seconds
later it reads `$1C00` once more, then opens and closes a direct-access
channel and reads it around that. The verdict at `$02FF` is `01` and
the border turns green when the stepper bits of the second track 18
snapshot differ from the track 1 snapshot, the density bits are 2, 2,
3, 1 and 0 for the five seeks, the motor bit is set in every snapshot
and clear at rest and after the wait. The values are tabulated in
`../../formats/iec-disk-reference.md`, sections "1541 VIA registers,
measured" and "1541 memory map".

## Source

```asm
// drive-via-probe.asm
// Read the 1541's two VIAs through M-R with the drive at rest, then upload a
// routine that runs a seek job and photographs $1800, $1C00, the current
// track and four head bytes while the motor is still turning. Seeks to
// tracks 1, 18, 25 and 31 show the stepper bits and the density bits move.
BasicUpstart2(start)

.const SETLFS = $ffba
.const SETNAM = $ffbd
.const OPEN   = $ffc0
.const CLOSE  = $ffc3
.const CHKIN  = $ffc6
.const CHKOUT = $ffc9
.const CLRCHN = $ffcc
.const CHRIN  = $ffcf
.const CHROUT = $ffd2

.const VERDICT = $02ff
.const CODE    = $0600       // buffer 3 in the drive: where the routine goes
.const RESULT  = $06f0       // the seek job's result code
.const SNAP    = $06f1       // $1800, $1C00, $22, $20 taken right after the job
.const HEAD    = $06f5       // four bytes read from $1C01 with byte-ready
.const P_TRACK = $06f9       // the track to seek, set by the host with M-W

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
    bcc rest
    jmp no_drive

    // R. both VIAs and the first 32 zero-page bytes with the drive at rest
rest:
    lda #$00
    ldx #$18
    jsr dump16
    lda #$00
    ldx #$1c
    jsr dump16
    lda rbuf                  // $1C00 at rest, for the verdict
    sta rest_1c00
    lda #$00
    ldx #$00
    jsr dump16
    lda #$10
    ldx #$00
    jsr dump16

    // upload the drive routine in 32-byte chunks
    lda #0
    sta off
up_chunk:
    lda off
    cmp #drive_end-drive_code
    bcs seeks
    jsr send_chunk
    lda off
    clc
    adc #32
    sta off
    jmp up_chunk

    // S. four seeks; each line is the drive's own snapshot, then the host's
seeks:
    lda #0
    sta sidx
seek_loop:
    ldx sidx
    lda tracks,x
    jsr run_seek
    lda #'T'
    jsr CHROUT
    ldx sidx
    lda tracks,x
    jsr print_hex
    lda #<lbl_j
    ldx #>lbl_j
    jsr print_zax
    lda #<RESULT
    ldx #>RESULT
    ldy #9
    jsr mem_read              // RESULT, SNAP x4, HEAD x4
    lda rbuf
    jsr print_hex
    lda #<lbl_b
    ldx #>lbl_b
    jsr print_zax
    lda rbuf+1
    jsr print_hex
    lda #<lbl_c
    ldx #>lbl_c
    jsr print_zax
    lda rbuf+2
    jsr print_hex
    ldx sidx
    lda rbuf+2                // print_hex returns with a digit in A
    sta snap_1c00,x
    lda #<lbl_tk
    ldx #>lbl_tk
    jsr print_zax
    lda rbuf+3
    jsr print_hex
    lda #<lbl_hd
    ldx #>lbl_hd
    jsr print_zax
    ldy #5
hd_print:
    lda rbuf,y
    jsr print_hex
    iny
    cpy #9
    bne hd_print
    lda #$0d
    jsr CHROUT
    lda #<lbl_host
    ldx #>lbl_host
    jsr print_zax
    lda #$00
    ldx #$18
    ldy #1
    jsr mem_read
    lda rbuf
    jsr print_hex
    lda #' '
    jsr CHROUT
    lda #$00
    ldx #$1c
    ldy #1
    jsr mem_read
    lda rbuf
    jsr print_hex
    lda #<lbl_zp
    ldx #>lbl_zp
    jsr print_zax
    lda #$22
    ldx #$00
    ldy #1
    jsr mem_read
    lda rbuf
    jsr print_hex
    lda #<lbl_hdr
    ldx #>lbl_hdr
    jsr print_zax
    lda #$16
    ldx #$00
    ldy #5
    jsr mem_read
    ldy #0
hdr_print:
    lda #' '
    jsr CHROUT
    lda rbuf,y
    jsr print_hex
    iny
    cpy #5
    bne hdr_print
    lda #$0d
    jsr CHROUT
    inc sidx
    lda sidx
    cmp #5
    beq idle
    jmp seek_loop
idle:

    // I. five seconds of C64 time later, the motor timer has run out
    lda #<lbl_idle
    ldx #>lbl_idle
    jsr print_zax
    lda #0
    sta $a1
    sta $a2
wait5:
    lda $a2
    cmp #250
    bcc wait5
    lda #$00
    ldx #$1c
    ldy #1
    jsr mem_read
    lda rbuf
    sta idle_1c00
    jsr print_hex
    lda #$0d
    jsr CHROUT

    // L. the LED: bit 3 of $1C00 with a direct-access channel open, then closed
    lda #<lbl_led
    ldx #>lbl_led
    jsr print_zax
    lda #2
    ldx #8
    ldy #2
    jsr SETLFS
    lda #1
    ldx #<name_hash
    ldy #>name_hash
    jsr SETNAM
    jsr OPEN
    lda #$00
    ldx #$1c
    ldy #1
    jsr mem_read
    lda rbuf
    sta led_open
    jsr print_hex
    lda #2
    jsr CLOSE
    lda #<lbl_closed
    ldx #>lbl_closed
    jsr print_zax
    lda #$00
    ldx #$1c
    ldy #1
    jsr mem_read
    lda rbuf
    sta led_closed
    jsr print_hex
    lda #$0d
    jsr CHROUT

    // V. stepper bits differ between the second track 18 snapshot and the
    // track 1 one, the density bits are 2,2,3,1,0 for tracks 18,18,1,25,31,
    // the motor bit is set in every snapshot and clear at rest and after the
    // wait
    lda snap_1c00+1
    eor snap_1c00+2
    and #$03
    beq v_done
    ldx #0
v_dens:
    lda snap_1c00,x
    and #$64                  // density bits and motor bit
    cmp dens_expect,x
    bne v_done
    inx
    cpx #5
    bne v_dens
    lda rest_1c00
    ora idle_1c00
    and #$04
    bne v_done
    lda #1
    sta VERDICT
    lda #5
    sta $d020
    lda led_open              // LED bit: set while open, clear after close
    and #$08
    beq v_led
    lda led_closed
    and #$08
    bne v_led
    lda #<lbl_ledok
    ldx #>lbl_ledok
    jsr print_zax
v_led:
    lda #<lbl_ok
    ldx #>lbl_ok
    jsr print_zax
v_done:
    lda #15
    jsr CLOSE
    ldx #<lbl_done
    ldy #>lbl_done
    jmp print_z

no_drive:
    ldx #<lbl_nodrive
    ldy #>lbl_nodrive
    jmp print_z

// --- M-R sixteen bytes at A/X and print them as one line ----------------
dump16:
    pha
    txa
    jsr print_hex
    pla
    pha
    jsr print_hex
    lda #' '
    jsr CHROUT
    pla
    ldy #16
    jsr mem_read
    ldy #0
d16:
    lda rbuf,y
    jsr print_hex
    iny
    cpy #16
    beq d16_done
    tya
    and #7
    bne d16
    lda #' '
    jsr CHROUT
    jmp d16
d16_done:
    lda #$0d
    jmp CHROUT

// --- set the track with M-W, then M-E the routine ------------------------
run_seek:
    sta mw_tk+6
    ldx #15
    jsr CHKOUT
    ldy #0
rs_1:
    lda mw_tk,y
    jsr CHROUT
    iny
    cpy #7
    bne rs_1
    jsr CLRCHN
    ldx #15
    jsr CHKOUT
    ldy #0
rs_2:
    lda me_cmd,y
    jsr CHROUT
    iny
    cpy #5
    bne rs_2
    jmp CLRCHN

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

// --- M-R: A/X = address, Y = count (1..127); bytes land in rbuf ---------
mem_read:
    sta mr_cmd+3
    stx mr_cmd+4
    sty mr_cmd+5
    sty clen
    ldx #15
    jsr CHKOUT
    ldy #0
mr_1:
    lda mr_cmd,y
    jsr CHROUT
    iny
    cpy #6
    bne mr_1
    jsr CLRCHN
    ldx #15
    jsr CHKIN
    ldy #0
mr_2:
    jsr CHRIN
    sta rbuf,y
    iny
    cpy clen
    bne mr_2
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

print_zax:                       // A/X = the same, low byte in A
    sta pz+1
    stx pz+2
    jmp pz
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

// --- the routine that runs on the drive's 6502 ---------------------------
// Assembled for $0600. A seek job on buffer 1 for the host's track; when
// the controller has replaced the job code, photograph both port B bytes,
// the current track and the drive status, then read four bytes off the
// head, each one after byte-ready sets V. A byte that does not arrive
// within 256 polls is recorded as $00, which no GCR byte can be.
.encoding "petscii_upper"
drive_code:
.pseudopc CODE {
    lda P_TRACK
    sta $08                   // track for buffer 1
    lda #0
    sta $09                   // sector for buffer 1
    lda #$b0                  // seek
    sta $01                   // slot 1 = buffer 1 at $0400
wait:
    lda $01
    bmi wait                  // bit 7 set while the job is pending
    sta RESULT
    lda $1800
    sta SNAP
    lda $1c00
    sta SNAP+1
    lda $22                   // DRVTRK: the track the head is on
    sta SNAP+2
    lda $20                   // DRVST: drive status
    sta SNAP+3
    lda $1c0c
    ora #$0e                  // CA2 high: SOE, lets byte-ready reach SO
    sta $1c0c
    ldx #0
hd_loop:
    ldy #0
    lda $1c01                 // clears the CA1 flag in $1C0D
    clv
hd_wait:
    bvs hd_got                // byte-ready on the CPU's SO pin
    lda $1c0d
    and #$02                  // byte-ready on VIA2 CA1
    bne hd_got
    dey
    bne hd_wait
    lda #0
    beq hd_store
hd_got:
    lda $1c01
hd_store:
    sta HEAD,x
    inx
    cpx #4
    bne hd_loop
    lda $1c0c
    and #$f1                  // put CA2 back to low, as the DOS leaves it
    ora #$0c
    sta $1c0c
    rts
}
drive_end:

mw_tk:  .text "M-W"
        .byte <P_TRACK, >P_TRACK, 1, 0
me_cmd: .text "M-E"
        .byte <CODE, >CODE
mr_cmd: .text "M-R"
        .byte 0, 0, 0

tracks:      .byte 18, 18, 1, 25, 31
dens_expect: .byte $44, $44, $64, $24, $04

title:      .text "DRIVE VIA PROBE"
            .byte $0d, 0
lbl_j:      .text " J="
            .byte 0
lbl_b:      .text " B="
            .byte 0
lbl_c:      .text " C="
            .byte 0
lbl_tk:     .text " TK="
            .byte 0
lbl_hd:     .text " HD="
            .byte 0
lbl_host:   .text "  HOST "
            .byte 0
lbl_zp:     .text " 22="
            .byte 0
lbl_hdr:    .text " HDR"
            .byte 0
lbl_idle:   .text "IDLE 5S 1C00="
            .byte 0
lbl_led:    .text "LED: OPEN 2,8,2,# 1C00="
            .byte 0
lbl_closed: .text " CLOSED="
            .byte 0
lbl_ledok:  .text "LED OK; "
            .byte 0
name_hash:  .text "#"
lbl_ok:     .text "STEPPER, DENSITY, MOTOR OK"
            .byte $0d, 0
lbl_done:   .text "DONE"
            .byte $0d, 0
lbl_nodrive: .text "NO DRIVE"
            .byte $0d, 0

off:       .byte 0
clen:      .byte 0
sidx:      .byte 0
rest_1c00: .byte 0
idle_1c00: .byte 0
led_open:  .byte 0
led_closed: .byte 0
snap_1c00: .byte 0, 0, 0, 0, 0
rbuf:      .fill 128, 0
```

## Build

```bash
java -jar $KICKASS_JAR drive-via-probe.asm -o drive-via-probe.prg
c1541 -format "TEST,01" d64 test.d64
GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas x64sc -default -warp +sound \
  +autostart-delay-random -autostartprgmode 1 -limitcycles 30000000 \
  -8 test.d64 -drive8wobbleamplitude 0 -drive8wobblefrequency 0 \
  -exitscreenshot drive-via-probe.png -autostart drive-via-probe.prg
```

Add `-model ntsc` for the NTSC run. `-default` turns true drive
emulation on with a 1541, and the program needs it: `M-E` runs the
routine on the emulated drive's own 6502. Nothing is written to the
disk. Adding `-drive8truedrive -drive8type 1541` to the command changes
nothing on the screen except the free-running timer bytes in the two
register dumps, because the drive is reset again when they are parsed
and the timeline shifts; the pinned pictures are from the command above.

## Expected output

PAL:

```
DRIVE VIA PROBE
1800 85001AFFA100FF01 4CAA000001008200
1C00 F0546F008518003A 669B0041EC00C054
0000 0000000000000000 0000000000000000
0010 0000000000000000 0000000001011000
T12 J=01 B=81 C=D4 TK=13 HD=A54A9429
  HOST 85 D4 22=13 HDR 30 31 13 02 10
T12 J=01 B=81 C=D6 TK=12 HD=A54A9429
  HOST 85 D6 22=12 HDR 30 31 12 03 10
T01 J=01 B=81 C=F4 TK=01 HD=52A54A94
  HOST 85 F4 22=01 HDR 30 31 01 02 02
T19 J=01 B=81 C=B4 TK=19 HD=52942952
  HOST 85 B4 22=19 HDR 30 31 19 0E 16
T1F J=01 B=81 C=94 TK=1F HD=A54A9429
  HOST 85 94 22=1F HDR 30 31 1F 01 1F
IDLE 5S 1C00=90
LED: OPEN 2,8,2,# 1C00=D6 CLOSED=D6
STEPPER, DENSITY, MOTOR OK
DONE
```

The first two lines are `$1800`-`$180F` and `$1C00`-`$1C0F`; the next
two are drive zero page `$00`-`$1F`. Each `T` line is the drive's own
snapshot after the seek job for that track: `J` the result code, `B`
`$1800`, `C` `$1C00`, `TK` the current-track byte `$22`, `HD` four
bytes from `$1C01`. The `HOST` line below it is what the host's own
`M-R` then read from `$1800`, `$1C00`, `$22` and the five header bytes
at `$16`-`$1A` (ID, ID, track, sector, checksum).

NTSC differs in the timer bytes of the two dumps (`5400FF01 F7B3` and
`D820003A 70A8` in place of the PAL values), in `$1800` at rest (`81`,
not `85`: bit 2, CLK IN, was the other way when the drive got to the
`M-R`), in the sector numbers of the `HDR` fields (the disk was at a
different angle each time), and in one host read: after the track 1
seek the host read `$1C00` as `74`, not `F4`, because bit 7 was low as
a sync mark passed under the head. The two `T12` lines show why the
first seek is repeated: the drive's zero page held `$22 = 00` at
rest, the first job found a header on track 19 without stepping and
recorded `13`, and only the second request for track 18 moved the head
(`C` goes from `D4` to `D6`: two half-steps). Track 1 then differs from
track 18 in the stepper bits by 34 half-steps, which is 2 modulo 4.

Measured in VICE x64sc 3.10 with the pinned command at 30,000,000
cycles, PAL and NTSC, on a disk formatted by `c1541 -format "TEST,01"`
(rung 1). Two runs per model gave byte-identical screenshots; every
character cell was decoded against the character ROM. The screenshots
are `screenshots/drive-via-probe.png` and
`screenshots/drive-via-probe-ntsc.png`.

## Why this works

The host side is the job-queue recipe's: channel 15, `M-W` in 32-byte
chunks, `M-R` for readback, `M-E` to start. The drive routine differs
in two ways. It copies the ports itself, right after `bmi wait`
falls through, which is the only way to see `$1C00` with the motor
running and the stepper where the job left it, since a host `M-R` can
only be answered once the routine has returned. And before it reads
`$1C01` it raises CA2 of VIA2 (`ora #$0e` into `$1C0C`): CA2 is the
SOE line that gates byte-ready onto the CPU's SO pin and VIA2's CA1,
and it read low at rest (`$1C0C` = `EC`, CA2 control bits `110`). The first version
of this routine waited on `bvs` without that and read four `00`s on
every track, which is the timeout marker, because no byte-ready ever
arrived. With SOE up, a byte arrives every 26 to 32 microseconds and
the loop reads GCR (`52 A5 4A 94`, `A5 4A 94 29`: the images of `55`
and `00` runs in a gap or a data block).

A `-moncommands` file with `trace store 8:1c00` and a log, no command
attached, listed every write to `$1C00` over the whole PAL run: 856
runs of distinct site and value, from seven ROM addresses. `$EB2A`
wrote `F7` once at reset, `$F260` wrote `60` once, `$F35C` wrote the
density bytes `D4 D6 F4 B4 94` in the order of the seeks, `$F987` wrote
the motor on (`F4`, later `94`), `$FA75` wrote the stepper phases
(`D7 D6 D5 D4 ...` cycling downward) 122 times, `$F9ED` wrote the
motor off (`90`, later `D2`), and `$EC98` in the idle loop rewrote the
current value on every pass. The only writes with bit 3 set were two
`DE`s from `$EC98`, 1,108 cycles apart, during the automatic
initialise the `OPEN 2,8,2,"#"` caused: the LED was on for that long
and off again before the host's `M-R`, which is why the `LED:` line
shows `D6` both times. The motor-off write came 3.9 million drive
cycles after that initialise's density write; the delay from the end
of the job itself was not isolated.
