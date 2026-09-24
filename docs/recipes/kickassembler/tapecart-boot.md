---
recipe: tapecart-boot
toolchain: kickassembler
output_format: PRG
region: both
techniques: []
file_formats: [PRG, TCRT]
uses_registers: [D020]
uses_kernal: [CHROUT]
---

<!-- doc-type: recipe -->

# KickAssembler Tapecart Boot: a TCRT Image from the Listing

## Synopsis

One listing builds a program and the tapecart image that carries it. The
program sums a 16 KB payload with a Fletcher-style check and compares the
result with the value computed at assembly time; the `Tcrt` segment wraps
the program, as a PRG, in a version 1 TCRT file with the default loader.
Attached to VICE's emulated tapecart, a plain `LOAD` at power-on reads
the pod's loader from its endless KERNAL-format tape, the loader
fast-loads the program and jumps to it, and the check passes. Use it as
the build step for a tapecart release, and as the proof that the image
loads before anything is flashed. The format is described under `.TCRT`
on `../../formats/c64-file-formats.md`.

## Source

```asm
// tapecart-boot.asm
// A program and the tapecart image that carries it, from one listing.
// The Default segment is the program: a BASIC stub, code that folds a
// 16 KB payload into a Fletcher-style check (an 8-bit running sum and a
// 16-bit sum of those sums, so a reordering changes it) and compares it
// with the value computed here at assembly time. The Tcrt segment is a TCRT file (version 1) whose flash
// holds that program as a PRG, with the fastload block and call address
// pointing at it, and the default initial loader (flag bit 0 clear).
.const PAYLOAD_LEN = 16384
.const VERDICT     = $02ff
.const CHROUT      = $ffd2

.segmentdef Tcrt [start=0, outBin="tapecart-boot.tcrt"]

.function payloadByte(i) { .return (i * 7 + (i >> 8) * 13) & $ff }
.var f1 = 0
.var f2 = 0
.for (var i = 0; i < PAYLOAD_LEN; i++) {
    .eval f1 = (f1 + payloadByte(i)) & $ff
    .eval f2 = (f2 + f1) & $ffff
}
.const expected = f2

// --- the program -----------------------------------------------------------
BasicUpstart2(start)
start:
    lda #$93
    jsr CHROUT
    ldx #0
title_loop:
    lda title,x
    beq title_done
    jsr CHROUT
    inx
    bne title_loop
title_done:
    // s1 = 8-bit running sum of the bytes, sum = 16-bit sum of every s1
    lda #<payload
    sta $fb
    lda #>payload
    sta $fc
    lda #0
    sta s1
    sta sum
    sta sum+1
    ldx #>PAYLOAD_LEN            // whole pages
    ldy #0
sum_loop:
    lda ($fb),y
    clc
    adc s1
    sta s1
    clc
    adc sum
    sta sum
    bcc sum_next
    inc sum+1
sum_next:
    iny
    bne sum_loop
    inc $fc
    dex
    bne sum_loop

    lda sum+1
    jsr print_hex
    lda sum
    jsr print_hex
    lda #'/'
    jsr CHROUT
    lda #>expected
    jsr print_hex
    lda #<expected
    jsr print_hex
    lda #$0d
    jsr CHROUT

    lda sum
    cmp #<expected
    bne done
    lda sum+1
    cmp #>expected
    bne done
    lda #1
    sta VERDICT
    lda #5
    sta $d020
    ldx #0
ok_loop:
    lda ok_text,x
    beq done
    jsr CHROUT
    inx
    bne ok_loop
done:
    jmp ($a002)                  // BASIC warm start: the loader JMPed here, so an RTS has no caller

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

.encoding "petscii_upper"
title:   .text "TAPECART BOOT, 16384-BYTE PAYLOAD"
         .byte $0d
         .text "CHECK "
         .byte 0
ok_text: .text "OK"
         .byte $0d, 0
sum:     .word 0
s1:      .byte 0

.align $100
payload:
.for (var i = 0; i < PAYLOAD_LEN; i++) {
    .byte payloadByte(i)
}
prog_end:

// --- the TCRT file ---------------------------------------------------------
.const PRG_LEN = prog_end - $0801 + 2      // flash holds a PRG: load address + data

.segment Tcrt
        .encoding "ascii"
        .text "tapecartImage"               // signature, 16 bytes
        .byte $0d, $0a, $1a
        .word 1                             // offset 16: version
        .word 0                             // offset 18: fastload block offset in flash
        .word PRG_LEN                       // offset 20: fastload block length
        .word start                         // offset 22: call address
        .encoding "petscii_upper"
        .text "TAPECART BOOT   "            // offset 24: file name, 16 bytes
        .byte 0                             // offset 40: flags, bit 0 clear = default loader
        .fill 171, 0                        // offset 41: loader, zeros when bit 0 is clear
        .dword PRG_LEN                      // offset 212: flash content length
        .word $0801                         // offset 216: the flash, a PRG
        .segmentout [segments="Default"]
```

## Build

```bash
java -jar $KICKASS_JAR tapecart-boot.asm -o tapecart-boot.prg
# writes tapecart-boot.prg and, from the Tcrt segment, tapecart-boot.tcrt
x64sc -default -warp +sound -limitcycles 30000000 \
  -tapeport1device 6 -tcrt tapecart-boot.tcrt -keybuf 'load\n' \
  -exitscreenshot tapecart-boot.png
```

Add `-model ntsc` and `-limitcycles 32000000` for the NTSC run.
`-tapeport1device 6` replaces the datasette with the tapecart and `-tcrt`
attaches the image; VICE does not write the image back unless
`-tapecartupdatetcrt` is given, and after these runs the file was
byte-identical to the build's. No PLAY press is needed: the pod's sense
line reads as a pressed button. Nothing is autostarted; the program
arrives only through the tapecart.

## Expected output

```
TAPECART BOOT, 16384-BYTE PAYLOAD
CHECK C800/C800
OK

READY.
```

The first value is the check the program computed over the 16,384 bytes
it received, the second the one assembled in. `OK` and a green border
mean `$02FF` holds `01`. The build writes a 16,641-byte PRG and a
16,857-byte TCRT (216 bytes of header, then the PRG); the TCRT's flash
content compares equal to the PRG byte for byte.

Measured with VICE x64sc 3.10 and the command above (rung 1). Two runs
per model gave byte-identical screenshots, every character cell decoded
against the character ROM. The pictures are
`../../figures/tapecart-boot-pal.png` and
`../../figures/tapecart-boot-ntsc.png`. A `trace exec` on `$F49E`
(LOAD), `$F84A` (`TRD`), `$FC93` (`TNIF`), `$0351` (the loader) and
`$080E` (the program) gave the stage times tabulated under `.TCRT` on the
formats page: 19.5 million cycles from LOAD to the program on PAL, of
which the KERNAL's pause after `FOUND` is 12.5 million and the fast load
1.85 million. The same boot with one payload byte flipped in the image's
flash printed `CHECK C988/C800`, no `OK`, and a blue border, so the check
sees the bytes the tapecart delivered.

**Not pinned.** The listing gate assembles the source, but the
verifier's run cannot be pinned in `runs.json`: it autostarts the PRG,
which would put the program in memory without the tapecart, and it has no
key that attaches a TCRT. The pictures therefore live under
`docs/figures/`, and the command above is the one that made them.

## Why this works

The `Tcrt` segment is a plain byte layout: KickAssembler's `outBin`
writes it to its own file, and `.segmentout` pastes the Default segment
(the program, from the BASIC stub at `$0801` to the end of the payload)
after a two-byte load address, so the flash holds exactly the PRG that
`-o` writes. The header's fastload length is that PRG's length,
`prog_end - $0801 + 2`, and its call address is `start`, the first
instruction after the BASIC stub: the default loader jumps there instead
of typing RUN, so the stub's `SYS` is never used. Flag bit 0 is clear and
the loader field is zeros, which tells VICE to use its own copy of the
default loader.

The program ends with `JMP ($A002)`, BASIC's warm start, not with RTS.
The loader enters the program with a JMP, so there is no return address
of the program's own on the stack. An earlier build ended with RTS: 48
cycles after it the CPU was in `$FE66`, the KERNAL's BRK and warm-start
handler, which re-initialised the screen, erased the program's output and
reset the border before BASIC printed `READY.` (traced, PAL).
