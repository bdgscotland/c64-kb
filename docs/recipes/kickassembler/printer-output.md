---
recipe: printer-output
toolchain: kickassembler
output_format: PRG
region: both
techniques: [kernal_file_write_seq]
file_formats: [PRG]
uses_registers: [DD04, DD05, DD06, DD07, DD0E, DD0F]
uses_kernal: [SETLFS, SETNAM, OPEN, CHKOUT, CHROUT, CLRCHN, CLOSE, READST]
devices: [printer_device_4]
harness: [cia2_timer_a, cia2_timer_b, $02FF]
---

<!-- doc-type: recipe -->

# KickAssembler Printer Output Through the KERNAL

## Synopsis

Print two lines on a printer at device 4 with the same seven KERNAL
calls that write a disk file: SETLFS, SETNAM with no name, OPEN, CHKOUT,
CHROUT per byte, CLRCHN and CLOSE. Before that it makes the same calls
against device 5, where nothing is attached, to show where the KERNAL
reports a missing printer: OPEN succeeds, CHKOUT fails with error 5 and
status `$80`. It times the 55 bytes with CIA 2 and checks the status
after sending and after CLOSE. In VICE the printer is the file printer
with its ASCII driver, so what was printed can be read on the host and
compared byte for byte. Use it as the skeleton for a "print high
scores" or "print listing" option.

## Source

```asm
// printer-output.asm
// Print through the KERNAL: OPEN a logical file on device 4 with secondary
// address 7, redirect CHROUT to it with CHKOUT, send two lines, CLRCHN and
// CLOSE. First the same calls against device 5, where nothing is attached,
// to show where the KERNAL reports a missing printer: at CHKOUT, not OPEN.
BasicUpstart2(start)

.const SETLFS = $ffba
.const SETNAM = $ffbd
.const OPEN   = $ffc0
.const CLOSE  = $ffc3
.const CHKOUT = $ffc9
.const CLRCHN = $ffcc
.const CHROUT = $ffd2
.const READST = $ffb7

.const VERDICT = $02ff

start:
    lda #$93
    jsr CHROUT
    ldx #<title
    ldy #>title
    jsr print_z

    // device 5: nothing is attached there
    lda #<lbl_dev5
    ldx #>lbl_dev5
    jsr print_zax
    lda #5
    ldx #5
    ldy #0
    jsr try_open
    lda #5
    jsr CLOSE

    // device 4: the printer
    lda #<lbl_dev4
    ldx #>lbl_dev4
    jsr print_zax
    lda #4
    ldx #4
    ldy #7                       // secondary address 7: lower case on Commodore printers
    jsr try_open
    bcc printer_ok
    rts                          // CHKOUT failed: nothing to print to
printer_ok:

    jsr timer_start
    ldx #4
    jsr CHKOUT
    ldy #0
send:
    lda page,y
    beq sent
    jsr CHROUT
    iny
    bne send
sent:
    sty count
    jsr CLRCHN                   // UNLISTEN: the printer may act on the line now
    jsr timer_stop
    jsr READST
    sta st_send
    lda #4
    jsr CLOSE
    jsr READST
    sta st_close

    ldx #<lbl_sent
    ldy #>lbl_sent
    jsr print_z
    lda count
    jsr print_hex
    lda #<lbl_in
    ldx #>lbl_in
    jsr print_zax
    lda cyc+2
    jsr print_hex
    lda cyc+1
    jsr print_hex
    lda cyc
    jsr print_hex
    lda #<lbl_st
    ldx #>lbl_st
    jsr print_zax
    lda st_send
    jsr print_hex
    lda #<lbl_close
    ldx #>lbl_close
    jsr print_zax
    lda st_close
    jsr print_hex
    lda #$0d
    jsr CHROUT

    // verdict: device 5 refused at CHKOUT with error 5, device 4 took everything
    lda res5_c
    beq finish
    lda res5_a
    cmp #5
    bne finish
    lda res4_c
    bne finish
    lda st_send
    ora st_close
    bne finish
    lda count
    cmp #page_end-page
    bne finish
    lda #1
    sta VERDICT
    lda #5
    sta $d020
    ldx #<lbl_ok
    ldy #>lbl_ok
    jsr print_z
finish:
    rts

// --- OPEN a = logical file = device (x), y = secondary address, then CHKOUT.
// Prints " OPEN C=c CHKOUT C=c A=aa ST=ss". Returns C from CHKOUT.
try_open:
    sta lfn
    jsr SETLFS
    lda #0
    jsr SETNAM
    jsr OPEN
    php
    lda #<lbl_open
    ldx #>lbl_open
    jsr print_zax
    pla
    and #1
    jsr print_digit
    ldx lfn
    jsr CHKOUT
    php
    sta res_a
    jsr READST
    sta res_st
    jsr CLRCHN
    lda #<lbl_chkout
    ldx #>lbl_chkout
    jsr print_zax
    pla
    and #1
    sta res_c
    jsr print_digit
    lda #<lbl_a
    ldx #>lbl_a
    jsr print_zax
    lda res_a
    jsr print_hex
    lda #<lbl_st
    ldx #>lbl_st
    jsr print_zax
    lda res_st
    jsr print_hex
    lda #$0d
    jsr CHROUT
    ldx lfn
    lda res_c
    ldy res_a
    cpx #5
    bne to_4
    sta res5_c
    sty res5_a
    jmp to_ret
to_4:
    sta res4_c
to_ret:
    lda res_c
    lsr                          // C = the CHKOUT carry
    rts

// --- CIA2 timer A counts cycles, timer B counts A's underflows ----------
timer_start:
    lda #$ff
    sta $dd04
    sta $dd05
    sta $dd06
    sta $dd07
    lda #%01010001               // B: count A underflows, force load, start
    sta $dd0f
    lda #%00010001               // A: continuous, force load, start
    sta $dd0e
    rts
timer_stop:
    lda #0
    sta $dd0e                    // stop A first, then read B:A
    sta $dd0f
    lda $dd04
    eor #$ff
    sta cyc
    lda $dd05
    eor #$ff
    sta cyc+1
    lda $dd06
    eor #$ff
    sta cyc+2
    rts

print_digit:
    ora #'0'
    jmp CHROUT

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

print_zax:                       // A/X = zero-terminated PETSCII string
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

.encoding "petscii_mixed"
page:       .text "Hello from the KERNAL, device 4."
            .byte $0d
            .text "Line two: 0123456789."
            .byte $0d
page_end:   .byte 0

.encoding "petscii_upper"
title:      .text "PRINTER VIA KERNAL"
            .byte $0d, 0
lbl_dev5:   .text "DEV 5"
            .byte 0
lbl_dev4:   .text "DEV 4"
            .byte 0
lbl_open:   .text " OPEN C="
            .byte 0
lbl_chkout: .text " CHKOUT C="
            .byte 0
lbl_a:      .text " A="
            .byte 0
lbl_st:     .text " ST="
            .byte 0
lbl_sent:   .text "SENT $"
            .byte 0
lbl_in:     .text " IN $"
            .byte 0
lbl_close:  .text " CLOSE ST="
            .byte 0
lbl_ok:     .text "OK"
            .byte $0d, 0

lfn:      .byte 0
res_a:    .byte 0
res_c:    .byte 0
res_st:   .byte 0
res5_c:   .byte 0
res5_a:   .byte 0
res4_c:   .byte 1
count:    .byte 0
st_send:  .byte 0
st_close: .byte 0
cyc:      .byte 0, 0, 0
```

## Build

```bash
java -jar $KICKASS_JAR printer-output.asm -o printer-output.prg
GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas x64sc -default -warp +sound \
  +autostart-delay-random -autostartprgmode 1 -limitcycles 8000000 \
  -busdevice4 -devicebackend4 1 -pr4drv ascii -pr4output text \
  -exitscreenshot printer-output.png -autostart printer-output.prg
```

Add `-model ntsc` for the NTSC run. The four printer options are all
needed, and each was found by leaving it out. `-busdevice4` puts device 4
on the serial bus and `-devicebackend4 1` makes it VICE's file printer;
`-pr4drv ascii -pr4output text` turn what it receives into ASCII text.
The text goes to `print.dump` in the directory x64sc runs in, which is
VICE's default `PrinterTextDevice1`. The run is pinned in
`../runs.json` with these flags.

## Expected output

```
PRINTER VIA KERNAL
DEV 5 OPEN C=0 CHKOUT C=1 A=05 ST=80
DEV 4 OPEN C=0 CHKOUT C=0 A=04 ST=00
SENT $37 IN $010388 ST=00 CLOSE ST=00
OK
```

Line by line: device 5's OPEN returns carry clear, its CHKOUT returns
carry set with A = 5 (`DEVICE NOT PRESENT`) and READST `$80`; device 4's
OPEN and CHKOUT both return carry clear (A after a good CHKOUT is not a
code; it read `$04`); `$37` = 55 bytes went out in `$010388` = 66,440
cycles, with status `00` after CLRCHN and after CLOSE. `OK` and a green
border mean `$02FF` holds `01`. The NTSC picture is the same except
`IN $010627`, 67,111 cycles.

`print.dump` holds 55 bytes, the same on both models and on two runs of
each:

```text
Hello from the KERNAL, device 4.
Line two: 0123456789.
```

Each `$0D` arrived as a line feed, `$0A`. Measured with VICE x64sc 3.10
and the pinned command (rung 1). Two runs per model gave byte-identical
screenshots and printer files; every character cell of the screenshots
was decoded against the character ROM. The screenshots are
`screenshots/printer-output.png` and `screenshots/printer-output-ntsc.png`.

## Why this works

A printer is a listener on the serial bus, so printing is writing a file
with no name. OPEN with no name to a serial device sends nothing on the
bus: it only enters the logical file in the KERNAL's tables (the ROM's
serial OPEN tests the name length at `$F3D9` and returns before LISTEN
when it is zero), which is why it succeeds for device 5 with nothing
there. CHKOUT sends LISTEN and the
secondary address, and a missing device shows there, as error 5 with the
carry set and bit 7 of the status. Each CHROUT then sends one byte, and
CLRCHN sends UNLISTEN. The 66,440 cycles are about 1,208 per byte on PAL
(1,220 on NTSC), LISTEN and UNLISTEN included; that is the KERNAL's
serial byte time, the same bus a disk write uses.

The secondary address selects the printer's character set. With 7 the
file came out in mixed case, as above. The same program with secondary
address 0 printed `.ELLO FROM THE ......, DEVICE 4.` and `.INE TWO:
0123456789.`: under 0, PETSCII `$41`-`$5A` print as capitals and the
shifted `$C1`-`$DA` have no ASCII form in VICE's driver, so they came out
as full stops (measured, VICE's `ascii` driver; a real MPS printer
prints graphics characters there, not measured here).

Check the status after sending, not only CHKOUT's carry. With
`-busdevice4` but without `-devicebackend4 1`, VICE's device 4 answered
the LISTEN: CHKOUT returned carry clear and status `00`, and the
failure showed only afterwards, as status `$83` after the bytes and
after CLOSE. With `-devicebackend4 1` but no `-busdevice4`, device 4
behaved like device 5. The listing therefore reads READST after CLRCHN
and after CLOSE and fails the verdict on anything but zero.
