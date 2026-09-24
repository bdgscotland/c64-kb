---
recipe: crt-banked
toolchain: kickassembler
output_format: CRT
region: both
techniques: []
file_formats: [CRT]
uses_registers: [DE00, D020, D021]
uses_kernal: [IOINIT, RAMTAS, RESTOR, CINT, CHROUT]
---

<!-- doc-type: recipe -->

# KickAssembler — Two-bank Magic Desk cartridge that reports which bank it read

## Synopsis

A complete Magic Desk cartridge (`.CRT` hardware type 19) with two 8 KB
banks, emitted whole by the listing: the 64-byte header and one `CHIP`
packet per bank, so there is no cartconv step. Bank 0 boots through the
`CBM80` signature, prints the marker byte it sees at `$9FFF`, copies a
short routine to RAM, and that routine writes 1 to the bank register at
`$DE00`, calls code in bank 1, reads bank 1's marker and switches back.
Bank 1's own code turns the border green. The screen shows `BANK 0 BYTE
B0` and `BANK 1 BYTE B1`; the verdict byte `$02FF` is 1 when the byte
read back changed. Use it as the skeleton for any cartridge larger than
16 KB that does not need EasyFlash: swap the marker for code and data.

## Source

```asm
// crt-banked.asm: a two-bank Magic Desk cartridge (.crt hardware type 19)
// emitted whole by this file: 64-byte header plus one CHIP packet per bank.
// Bank 0 boots through CBM80, prints the marker byte it sees at $9FFF, then
// a routine copied to RAM writes 1 to the bank register at $DE00, calls a
// routine in bank 1, reads bank 1's marker and writes 0 to return. Bank 1's
// own code turns the border green. Verdict byte $02FF is 1 on success.
// Build: java -jar KickAss.jar crt-banked.asm -o crt-banked.prg
//        (writes crt-banked.crt beside the source; the .prg is empty)
// Run:   x64sc -cartcrt crt-banked.crt

.const BANKREG = $de00            // Magic Desk bank register (write only)
.const RAMCODE = $0334            // the switch routine runs from here
.const VERDICT = $02ff

.segmentdef Bank0 [start=$8000, min=$8000, max=$9fff, fill, fillByte=$ff]
.segmentdef Bank1 [start=$8000, min=$8000, max=$9fff, fill, fillByte=$ff]
.segmentdef Crt   [start=0, outBin="crt-banked.crt"]

// ---- the .crt file: header, then a CHIP packet per bank ----
.segment Crt
.encoding "ascii"
        .text "C64 CARTRIDGE   "         // signature, 16 bytes
        .byte 0,0,0,$40                  // header length, big-endian
        .byte 1,0                        // version 1.00
        .byte 0,19                       // hardware type 19 = Magic Desk
        .byte 0                          // EXROM low
        .byte 1                          // GAME high: 8 KB at $8000
        .fill 6,0                        // reserved
        .text "TWO BANKS"
        .fill 32-9,0                     // name padded to 32 bytes

        .text "CHIP"
        .byte 0,0,$20,$10                // packet length $2010
        .byte 0,0                        // chip type 0 = ROM
        .byte 0,0                        // bank 0
        .byte $80,$00                    // load address $8000
        .byte $20,$00                    // 8192 bytes
        .segmentout [segments="Bank0"]

        .text "CHIP"
        .byte 0,0,$20,$10
        .byte 0,0
        .byte 0,1                        // bank 1
        .byte $80,$00
        .byte $20,$00
        .segmentout [segments="Bank1"]

// ---------------------------------------------------------------- bank 0
.segment Bank0
        .word cold, warm
        .byte $c3, $c2, $cd, $38, $30    // CBM80: the KERNAL jumps to cold

warm:   jmp cold

cold:   sei
        ldx #$ff
        txs
        cld
        jsr $ff84                        // IOINIT
        jsr $ff87                        // RAMTAS
        jsr $ff8a                        // RESTOR
        jsr $ff81                        // CINT
        cli
        lda #147
        jsr $ffd2                        // clear screen
        lda #5
        jsr $ffd2                        // white text
        lda #0
        sta $d020
        sta $d021

        // line 1: bank 0 read directly, no register write
        jsr $9ff0                        // bank 0's identify routine
        lda #0
        sta $02fc
        lda $9fff
        sta $02fd
        jsr report

        // copy the switch routine to RAM and run it
        ldx #0
!:      lda switch,x
        sta RAMCODE,x
        inx
        cpx #switch_end-switch
        bne !-
        lda #1
        sta $02fc
        jsr RAMCODE                      // sets $02fd and $02fe from bank 1

        // line 2: what came back from bank 1
        jsr report

        // verdict: bank 1's code ran, and its marker differs from bank 0's
        lda $02fe
        cmp #1
        bne fail
        lda $02fd
        cmp #$b1
        bne fail
        lda #1
        sta VERDICT                      // border is green: bank 1 set it
        jmp *
fail:   lda #2
        sta $d020                        // red: the switch did not happen
        lda #0
        sta VERDICT
        jmp *

// print "BANK n BYTE xx" from $02fc and $02fd
report: ldx #0
!:      lda text,x
        beq !+
        jsr $ffd2
        inx
        bne !-
!:      lda $02fc
        ora #$30
        jsr $ffd2
        ldx #0
!:      lda text2,x
        beq !+
        jsr $ffd2
        inx
        bne !-
!:      lda $02fd
        lsr
        lsr
        lsr
        lsr
        jsr hexdig
        lda $02fd
        and #$0f
        jsr hexdig
        lda #13
        jmp $ffd2

hexdig: cmp #10
        bcc !+
        adc #6
!:      adc #$30
        jmp $ffd2

.encoding "petscii_upper"
text:   .text "BANK "
        .byte 0
text2:  .text " BYTE "
        .byte 0

// Runs from RAM: while bank 1 is in, nothing at $8000-$9FFF is bank 0's.
switch: .pseudopc RAMCODE {
        lda #1
        sta BANKREG                      // bank 1 appears at $8000
        jsr $9ff0                        // bank 1's identify routine
        lda $9fff                        // bank 1's marker
        sta $02fd
        lda #0
        sta BANKREG                      // bank 0 back
        rts
}
switch_end:

* = $9ff0 "bank0 id"
        lda #0
        sta $02fe
        rts
* = $9fff "bank0 marker"
        .byte $b0

// ---------------------------------------------------------------- bank 1
.segment Bank1
* = $9ff0 "bank1 id"
        lda #1
        sta $02fe
        lda #5
        sta $d020                        // green border: bank 1's code ran
        rts
* = $9fff "bank1 marker"
        .byte $b1
```

## Build

```bash
java -jar $KICKASS_JAR crt-banked.asm -o crt-banked.prg
# writes crt-banked.crt (16,480 bytes) beside the source: 64 + 2 x 8,208.
# The .prg named by -o is not written: the default segment is empty.
cartconv -c crt-banked.crt     # exit 0; -f prints "Hardware ID: 19 (Magic Desk)"
```

## Expected output

```bash
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 \
  -limitcycles 4000000 -exitscreenshot crt-banked.png -cartcrt crt-banked.crt
```

Text decoded from the PNG against the character ROM with PIL, white on
black:

```text
BANK 0 BYTE B0
BANK 1 BYTE B1
```

The border is green: `(98, 213, 50)` in the PAL PNG
(`screenshots/crt-banked.png`), `(114, 189, 103)` in the NTSC one
(`screenshots/crt-banked-ntsc.png`, same command with `-model ntsc`
after `-default`). `$02FF` is 1 on that path and 0 on the red one.
Measured in VICE x64sc 3.10; each model was run twice from a fresh copy
of the built `.crt` and the PNGs were byte-identical.

The control: the same two banks packaged by cartconv as a generic 8 KB
type 0 cartridge (bank 0 alone) print `BANK 1 BYTE B0` on the second
line and go red, because there is no bank register to write. That run
is in [cartconv-reference](../../toolchains/cartconv-reference.md),
"Boot results".

## Why this works

The KERNAL's reset code looks for `CBM80` at `$8004` and, when it finds
it, jumps through the cold-start vector at `$8000` before it has
initialised anything, so the cartridge calls IOINIT, RAMTAS, RESTOR and
CINT itself and then has CHROUT and a cleared screen. GAME high with
EXROM low is 8 KB mode: the bank occupies `$8000` to `$9FFF` and BASIC
stays at `$A000`. Measured here through `$BFFF`, which still read the
BASIC ROM byte `$E0` after the switch (that line is printed by the
measurement variant on the tool page, not by this listing).

A write to `$DE00` replaces the whole 8 KB at once, including the
instruction after the store, so the switch has to run from somewhere
that does not move. `switch` is assembled with `.pseudopc RAMCODE` and
copied to `$0334`, the cassette buffer, which nothing else here uses.
While bank 1 is in, `$9FF0` is bank 1's routine and `$9FFF` is bank 1's
marker; the routine puts 0 back before returning, because the return
address is in bank 0. Bank 1 sets the border itself so that the green
is evidence bank 1's code ran, not only that its byte was read.

The container is written by the assembler because every number in it
is fixed: `$2010` is 16 bytes of packet header plus `$2000` of data, and
`.segmentout` pastes each bank's padded 8 KB in place. The `fill` and
`fillByte=$ff` on the bank segments are required: without them a bank would be
as long as its last byte, the packet length would be wrong, and the second
`CHIP` signature would land in the wrong place. `cartconv -c` catches
exactly that.
