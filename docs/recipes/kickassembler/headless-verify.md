---
recipe: headless-verify
toolchain: kickassembler
output_format: PRG
region: both
techniques: []
file_formats: [PRG]
uses_registers: [D020]
uses_kernal: [CHROUT]
---

<!-- doc-type: recipe -->

# KickAssembler Headless Verify: a self-checking program a script can grade

## Synopsis

A program that does a checkable computation and reports the verdict three
ways a harness can read without a human: a result code at `$02FF`, the
border colour (green for pass, red for fail), and a line of text. The
computation is a 16-bit fold of the first page of the KERNAL ROM
(`$E000` to `$E0FF`), compared against the value computed on the host
from the ROM image. Use it as the template for any test program that
must be graded by the exit screenshot or over the monitor; the harness
side is in `runtime/vice-reference.md`, section "Verifying a run without
a human".

## Source

```asm
// headless-verify.asm
// Folds the first page of the KERNAL ROM ($E000-$E0FF) into a 16-bit
// checksum, compares it with the value computed from the ROM image on
// the host, and reports the verdict three ways: a code at $02FF, the
// border colour, and a line of text.
BasicUpstart2(start)

.const CHROUT   = $ffd2
.const RESULT   = $02ff          // verdict byte read by the harness
.const BORDER   = $d020
.const EXPECTED = $c96f          // fold of kernal-901227-03.bin bytes 0..255
.const FORCE_FAIL = 0            // set to 1 to demonstrate the red case

.const CODE_PASS = $01
.const CODE_FAIL = $02

start:
    lda #0
    sta chk
    sta chk+1
    ldx #0
fold:
    // chk = ((chk ^ byte) * 5 + 1) & $ffff
    lda $e000,x
    eor chk
    sta chk                      // chk ^= byte (low only; byte is 8-bit)
    lda chk                      // t = chk
    sta tmp
    lda chk+1
    sta tmp+1
    asl chk                      // chk <<= 2
    rol chk+1
    asl chk
    rol chk+1
    clc                          // chk += t
    lda chk
    adc tmp
    sta chk
    lda chk+1
    adc tmp+1
    sta chk+1
    inc chk                      // chk += 1
    bne !+
    inc chk+1
!:
    inx
    bne fold

    // compare with the host's value
    lda chk
    cmp #<(EXPECTED ^ FORCE_FAIL)
    bne fail
    lda chk+1
    cmp #>(EXPECTED ^ FORCE_FAIL)
    bne fail
    lda #CODE_PASS
    ldy #5                       // green
    bne checkpoint
fail:
    lda #CODE_FAIL
    ldy #2                       // red
checkpoint:
    sta RESULT                   // the harness watches this store
    sty BORDER

    // print "RESULT hh PASS" or "RESULT hh FAIL"
    ldx #0
!:
    lda text,x
    beq !+
    jsr CHROUT
    inx
    bne !-
!:
    lda RESULT
    jsr hexbyte
    lda RESULT
    cmp #CODE_PASS
    beq pass
    ldx #0
!:
    lda failtext,x
    beq done
    jsr CHROUT
    inx
    bne !-
pass:
    ldx #0
!:
    lda passtext,x
    beq done
    jsr CHROUT
    inx
    bne !-
done:
    rts

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
    adc #6                       // carry set: +7 lands on 'A'..'F'
!:
    adc #'0'
    jmp CHROUT

chk: .word 0
tmp: .word 0

.encoding "petscii_upper"
text:     .text "RESULT "
          .byte 0
passtext: .text " PASS"
          .byte $0d, 0
failtext: .text " FAIL"
          .byte $0d, 0
```

## Build

```bash
java -jar KickAss.jar headless-verify.asm -o headless-verify.prg -symbolfile
```

Produces `headless-verify.prg`, 219 bytes, code at `$080e` to `$08d9`
(KickAssembler 5.25, `-showmem`). `EXPECTED` comes from the host:

```bash
python3 -c "
rom = open('/opt/homebrew/opt/vice/share/vice/C64/kernal-901227-03.bin', 'rb').read()
chk = 0
for v in rom[:256]:
    chk = ((chk ^ v) * 5 + 1) & 0xffff
print('%04X' % chk)"        # C96F
```

## Expected output

Border green. Text area still the power-on blue. Screen rows 5 to 9:

```
READY.
RUN
RESULT 01 PASS

READY.
```

Screenshots from the pinned run, 8,000,000 cycles: `screenshots/headless-verify.png`
(PAL) and `screenshots/headless-verify-ntsc.png` (NTSC). Measured on both:
`RESULT 01 PASS` on screen row 7, border pixel (2, 100) = (98, 213, 50) on
PAL and (114, 189, 103) on NTSC, which is index 5 in both palettes of
`runtime/vice-reference.md`.

The red case, `.const FORCE_FAIL = 1`, was run once on PAL and not pinned:
the same screen with `RESULT 02 FAIL` on row 7 and the border at
(175, 60, 88), index 2. The text area does not change colour. The
`-moncommands` log of that run shows `$02FF` holding `02` after the store.

## Why this works

The verdict is written before anything else happens, and in the order the
harness relies on: `sta RESULT` first, `sty BORDER` second. A store
watchpoint on `$02FF` fires once the byte is in memory (measured in VICE
3.10: the monitor's `m 02ff 02ff` on the trace hit already read `01`, and
the binary monitor's stop event reported the PC as `$0872`, the
instruction after the `sta`). Two stores reach `$02FF` in a run, not one:
the KERNAL reset clears page 2 (`STA $0200,Y` at `$FD56` with `A = 0`, at
cycle 5305 in the log), so a harness must ignore a value of `00` and wait
for the next hit. That is also why the code values start at `01`: a `00`
means "never got here", which is a different failure from `02`.

The fold is `chk = ((chk ^ byte) * 5 + 1) & $ffff`, the checksum shape the
KB's self-checking programs share. Multiply by five is two `asl`/`rol`
pairs plus an add of the saved value; the `& $ffff` is free on a 16-bit
accumulator. `EXPECTED ^ FORCE_FAIL` flips the low bit of the expected
value when `FORCE_FAIL` is 1, so the red build differs from the green one
by one constant and the program's own computation is unchanged.

`ldy #5` sets the Z flag from Y, so the `bne checkpoint` after it is an
unconditional branch that skips the fail path without a `jmp`. In
`hexdigit`, `cmp #10` leaves carry set for 10 to 15, and `adc #6` then
adds 7, landing `adc #'0'` on `'A'` to `'F'`. `.encoding "petscii_upper"`
is set before the strings because CHROUT wants PETSCII; the default
`screencode_mixed` would coincide for these upper-case letters but not on
principle (see `hello-world.md`).

Verified: assembled with KickAssembler 5.25, run headless in VICE x64sc
3.10 with the pinned command on PAL and NTSC; the screenshots were decoded
with the char ROM, not read by eye.
