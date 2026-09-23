---
recipe: basic-float-calls
toolchain: kickassembler
output_format: PRG
region: both
techniques: [basic_rom_float_calls]
file_formats: [PRG]
uses_registers: [DC04, DC05, DC0D, DC0E, D011, D012, D020]
uses_kernal: [CHROUT]
---

<!-- doc-type: recipe -->

# KickAssembler: BASIC ROM floating point from machine code, four sums printed and checked, four calls timed

## Synopsis

The BASIC ROM at $A000 holds a complete 40-bit floating-point library,
and with `$01 = $37`, which is how a `SYS` finds the machine, any
program can call it. This recipe calls ten of its routines by address:
`GIVAYF` (signed 16-bit to FAC), `MOVFM` and `MOVMF` (load and store a
five-byte float), `FADD`, `FDIV`, `FMULT`, `FSQR`, `FOUT` (FAC to a
PETSCII string at $0100) and `LINPRT` (print a 16-bit integer), with
`CONUPK` reached through the arithmetic entries. It prints four sums
through `CHROUT`, one a line: `sqrt(2)`, `355 / 113`, `0.1 + 0.2` from
two five-byte constants written in the listing, and `2^24 + 1` by 23
multiplies and an add. After each `FOUT` the string at $0100 is compared
with expected text held in the listing; the five bytes BASIC itself
produces for `1 / 10` are printed in hex and compared with the listing's
`0.1` constant. One `FMULT`, `FDIV`, `FSQR` and `FOUT` call are timed
with CIA1 timer A, net of an empty call, with the display off so no
badline stalls the count, and the four costs are printed with `LINPRT`.
The verdict goes to `$02FF` (`$01` pass, `$02` fail) and the border
(green or red). Every entry address was checked against the ROM with the
VICE monitor's `d` command before it was used; the listing is on the
technique `basic_rom_float_calls` in `techniques/maths.md`, and the
dump is quoted under "Expected output" below.

Built with `-define BASICOUT` the same program writes `$36` to `$01`
first, so the calls land in the RAM under the ROM. That build is the
control; what it did is recorded below and it is not pinned.

## Source

```asm
// basic-float-calls.asm
// Calls the BASIC ROM's floating-point routines from machine code with the
// ROM banked in ($01 = $37, as it is at SYS). Four sums, each printed through
// CHROUT on its own line: sqrt(2), 355/113, 0.1 + 0.2 and 2^24 + 1. The FOUT
// string at $0100 is compared with expected text held in this listing; the
// five bytes BASIC itself makes for 1/10 are compared with the constant below.
// One FMULT, FDIV, FSQR and FOUT call are each timed with CIA1 timer A, net of
// an empty call, and the four costs are printed with LINPRT.
// Verdict: $02FF = $01 and a green border when every compare matched, $02 and
// red otherwise. Zero page $57 to $70 is copied to $0340 before the first call
// and to $0360 after the last FOUT, for a monitor dump.
// Build with -define BASICOUT to run the same calls with BASIC banked out.
.encoding "petscii_upper"

.const CHROUT    = $ffd2
.const MOVFM     = $bba2        // FAC = five bytes at (A = low, Y = high)
.const MOVMF     = $bbd4        // five bytes at (X = low, Y = high) = FAC
.const FADD      = $b867        // FAC = mem(A/Y) + FAC
.const FSUB      = $b850        // FAC = mem(A/Y) - FAC
.const FMULT     = $ba28        // FAC = mem(A/Y) * FAC
.const FDIV      = $bb0f        // FAC = mem(A/Y) / FAC
.const FSQR      = $bf71        // FAC = sqrt(FAC)
.const FOUT      = $bddd        // string of FAC at $0100, A/Y = $0100
.const GIVAYF    = $b391        // FAC = signed 16-bit, A = high, Y = low
.const LINPRT    = $bdcd        // print unsigned 16-bit, A = high, X = low

.const RESULT    = $02ff
.const CYC       = $02f0        // four net costs, then the raw empty call
.const SAVE_PRE  = $0340        // zero page $57..$70 before the first call
.const SAVE_POST = $0360        // the same span after the last FOUT
.const STRBUF    = $0100
.const msg       = $fb          // string pointer for print_msg (2 bytes)

.macro timed(routine, ptr, slot) {
        lda #$ff
        sta $dc04
        sta $dc05
        lda #$19                // force load, one-shot, start
        sta $dc0e
        lda #<ptr
        ldy #>ptr
        jsr routine
        lda #$08                // stop
        sta $dc0e
        sec
        lda #$ff
        sbc $dc04
        sta CYC + slot * 2
        lda #$ff
        sbc $dc05
        sta CYC + slot * 2 + 1
    .if (slot != 4) {
        sec
        lda CYC + slot * 2
        sbc CYC + 8
        sta CYC + slot * 2
        lda CYC + slot * 2 + 1
        sbc CYC + 9
        sta CYC + slot * 2 + 1
    }
}

BasicUpstart2(start)

start:
        sei
        lda #$7f
        sta $dc0d               // no CIA1 interrupts
        lda $dc0d
#if BASICOUT
        lda #$36                // control build: BASIC ROM out, RAM at $A000
        sta $01
#endif
        lda #0
        sta fail
        ldx #$19
!:      lda $57,x
        sta SAVE_PRE,x
        dex
        bpl !-
        lda #$93
        jsr CHROUT
        lda $d011
        and #%11101111          // DEN off: no badline stalls in the timings.
        sta $d011               // The VIC samples DEN on line $30, so wait
        jsr wait_line255        // for the next frame before timing anything.
        jsr wait_line255
        ldx #<txt_hdr
        ldy #>txt_hdr
        jsr print_msg

        timed(empty_rts, c_two, 4)      // jsr, rts, loads and timer stores

        // (a) sqrt(2)
        ldx #<txt_a
        ldy #>txt_a
        jsr print_msg
        lda #0
        ldy #2
        jsr GIVAYF
        timed(FSQR, c_two, 2)
        timed(FOUT, c_two, 3)
        ldx #<exp_a
        ldy #>exp_a
        jsr show_and_check

        // (b) 355 / 113
        ldx #<txt_b
        ldy #>txt_b
        jsr print_msg
        lda #>355
        ldy #<355
        jsr GIVAYF
        ldx #<tmp
        ldy #>tmp
        jsr MOVMF
        lda #0
        ldy #113
        jsr GIVAYF
        timed(FDIV, tmp, 1)
        jsr FOUT
        ldx #<exp_b
        ldy #>exp_b
        jsr show_and_check

        // (c) 0.1 + 0.2 from the two constants below
        ldx #<txt_c
        ldy #>txt_c
        jsr print_msg
        lda #<c_tenth
        ldy #>c_tenth
        jsr MOVFM
        lda #<c_fifth
        ldy #>c_fifth
        jsr FADD
        jsr FOUT
        ldx #<exp_c
        ldy #>exp_c
        jsr show_and_check

        // (c2) BASIC's own 1/10, five bytes, against c_tenth
        ldx #<txt_c2
        ldy #>txt_c2
        jsr print_msg
        lda #0
        ldy #1
        jsr GIVAYF
        ldx #<tmp
        ldy #>tmp
        jsr MOVMF
        lda #0
        ldy #10
        jsr GIVAYF
        lda #<tmp
        ldy #>tmp
        jsr FDIV
        ldx #<tmp2
        ldy #>tmp2
        jsr MOVMF
        ldx #0
!:      stx idx
        lda tmp2,x
        jsr print_hex
        lda #$20
        jsr CHROUT
        ldx idx
        lda tmp2,x
        cmp c_tenth,x
        beq !+
        inc fail
!:      inx
        cpx #5
        bne !--
        lda #13
        jsr CHROUT

        // (d) 2^24 + 1 by 23 multiplies and one add
        ldx #<txt_d
        ldy #>txt_d
        jsr print_msg
        lda #<c_two
        ldy #>c_two
        jsr MOVFM
        timed(FMULT, c_two, 0)          // 2 * 2
        lda #22
        sta idx
!:      lda #<c_two
        ldy #>c_two
        jsr FMULT
        dec idx
        bne !-
        lda #<c_one
        ldy #>c_one
        jsr FADD
        jsr FOUT
        ldx #$19
!:      lda $57,x
        sta SAVE_POST,x
        dex
        bpl !-
        ldx #<exp_d
        ldy #>exp_d
        jsr show_and_check

        // measured costs, net of the empty call
        ldx #<txt_mult
        ldy #>txt_mult
        jsr print_msg
        lda CYC + 1
        ldx CYC + 0
        jsr LINPRT
        ldx #<txt_div
        ldy #>txt_div
        jsr print_msg
        lda CYC + 3
        ldx CYC + 2
        jsr LINPRT
        ldx #<txt_sqr
        ldy #>txt_sqr
        jsr print_msg
        lda CYC + 5
        ldx CYC + 4
        jsr LINPRT
        ldx #<txt_out
        ldy #>txt_out
        jsr print_msg
        lda CYC + 7
        ldx CYC + 6
        jsr LINPRT

        lda $d011
        ora #%00010000          // DEN back on for the picture
        sta $d011
        lda fail
        bne bad
        ldx #<txt_pass
        ldy #>txt_pass
        jsr print_msg
        lda #5
        sta $d020
        lda #1
        sta RESULT
        jmp *
bad:
        ldx #<txt_fail
        ldy #>txt_fail
        jsr print_msg
        lda #2
        sta $d020
        sta RESULT
        jmp *

empty_rts:
        rts

wait_line255:
        lda #255
!:      cmp $d012
        beq !-
!:      cmp $d012
        bne !-
        rts

// print the FOUT string at $0100, then compare it with the text at X/Y
show_and_check:
        stx msg
        sty msg + 1
        ldx #0
!:      lda STRBUF,x
        beq !+
        jsr CHROUT
        inx
        bne !-
!:      lda #13
        jsr CHROUT
        ldy #0
!:      lda STRBUF,y
        cmp (msg),y
        bne !+
        tax
        beq done
        iny
        bne !-
!:      inc fail
done:   rts

print_msg:
        stx msg
        sty msg + 1
        ldy #0
!:      lda (msg),y
        beq done
        jsr CHROUT
        iny
        bne !-
        rts

print_hex:
        pha
        lsr
        lsr
        lsr
        lsr
        jsr hex_digit
        pla
        and #$0f
hex_digit:
        cmp #10
        bcc !+
        adc #6                  // carry set: +7, into A..F
!:      adc #$30
        jmp CHROUT

// Five-byte floats: exponent excess 128, then a 32-bit mantissa with its top
// bit set in the value and used for the sign in the byte (0 = positive).
// 0.1 = 0.8 * 2^-3: exponent $7D; 0.8 * 2^32 = 3435973836.8, rounded up to
// $CCCCCCCD, sign bit cleared: $4C $CC $CC $CD. 0.2 is the same mantissa one
// exponent up. 1 = 0.5 * 2^1: $81 $00.. ; 2 = 0.5 * 2^2: $82 $00..
c_tenth:  .byte $7d, $4c, $cc, $cc, $cd
c_fifth:  .byte $7e, $4c, $cc, $cc, $cd
c_one:    .byte $81, $00, $00, $00, $00
c_two:    .byte $82, $00, $00, $00, $00
tmp:      .fill 5, 0
tmp2:     .fill 5, 0
fail:     .byte 0
idx:      .byte 0

txt_hdr:  .text "BASIC ROM FLOAT CALLS"
          .byte 13, 0
txt_a:    .text "SQR(2)     ="
          .byte 0
txt_b:    .text "355/113    ="
          .byte 0
txt_c:    .text "0.1+0.2    ="
          .byte 0
txt_c2:   .text "1/10 BYTES = "
          .byte 0
txt_d:    .text "2^24+1     ="
          .byte 0
txt_mult: .text "FMULT CYCLES "
          .byte 0
txt_div:  .byte 13
          .text "FDIV  CYCLES "
          .byte 0
txt_sqr:  .byte 13
          .text "FSQR  CYCLES "
          .byte 0
txt_out:  .byte 13
          .text "FOUT  CYCLES "
          .byte 0
txt_pass: .byte 13
          .text "RESULT: PASS"
          .byte 0
txt_fail: .byte 13
          .text "RESULT: FAIL"
          .byte 0

// expected FOUT text: a leading space for a positive value, no trailing space
exp_a:    .text " 1.41421356"
          .byte 0
exp_b:    .text " 3.14159292"
          .byte 0
exp_c:    .text " .3"
          .byte 0
exp_d:    .text " 16777217"
          .byte 0
```

## Build

```bash
java -jar $KICKASS_JAR basic-float-calls.asm -o basic-float-calls.prg
```

The control build, not pinned:

```bash
java -jar $KICKASS_JAR basic-float-calls.asm -define BASICOUT -o basic-float-calls-ctl.prg
```

## Expected output

Border green, text light blue on blue as `CHROUT` leaves it, decoded
from the PNG with the character ROM:

```
BASIC ROM FLOAT CALLS
SQR(2)     = 1.41421356
355/113    = 3.14159292
0.1+0.2    = .3
1/10 BYTES = 7D 4C CC CC CD
2^24+1     = 16777217
FMULT CYCLES 1079
FDIV  CYCLES 2409
FSQR  CYCLES 43752
FOUT  CYCLES 7412
RESULT: PASS
```

The `^` on the sixth line is PETSCII `$5E`, drawn as an up arrow.
Screenshots from the pinned run, 6,000,000 cycles:
`screenshots/basic-float-calls.png` (PAL) and
`screenshots/basic-float-calls-ntsc.png` (NTSC). Both decode to the text
above; border pixel (2, 100) is (98, 213, 50) on PAL and (114, 189, 103)
on NTSC, palette index 5 in `runtime/vice-reference.md`. The pinned
command was run twice per model and the two PNGs were identical bytes
each time (md5 `c44daf48c5569e770dbeb4d0f27a0b75` PAL,
`eb616ee612267b2d015d0f563d919d5c` NTSC). The program stores its
verdict at PAL cycle 3,237,550 and then loops with interrupts off, so
the picture is static from there and the beam position at the limit
does not matter.

The monitor dump at the verdict store (`trace store 02ff` with `m`
commands, VICE x64sc 3.10), identical on PAL and NTSC:

```
>C:02f0  37 04 69 09   FMULT 1079, FDIV 2409 (net, low byte first)
>C:02f4  e8 aa f4 1c   FSQR 43752, FOUT 7412
>C:02f8  15 00         the empty call, 21 cycles raw, subtracted above
>C:02ff  01            verdict
```

Net means the raw timer count less the 21 cycles of the empty call,
which covers the `LDA`/`LDY` of the pointer, `JSR`, `RTS`, the stop
store and the timer's start latency. An earlier build of this program
timed with the display on and read `FSQR` 45,975 and `FOUT` 7,969 on
PAL, 2,223 and 557 more, while `FMULT` and `FDIV` read the same 1,079
and 2,409: the CIA counts the cycles a badline steals, and the two
short calls happened to fall where no badline was (the position in the
frame was not read). The listing now clears DEN before the first timing
and waits for two passes of line 255, because the VIC samples DEN once
a frame on line `$30`.

The ROM at each entry, from the monitor's `d` command with `$01 = $37`
(BASIC ROM 901226-01 as shipped with VICE, md5
`57af4ae21d4b705c2991d98ed5c1f7b8`; `$E097` is in the KERNAL image
901227-03):

```
GIVAYF  .C:b391  A2 00     LDX #$00   ; then STX $0D, STA $62, STY $63: A/Y into the FAC mantissa
MOVFM   .C:bba2  85 22     STA $22    ; STY $23, LDY #$04, LDA ($22),Y: pointer, then 5 bytes
MOVMF   .C:bbd4  20 1B BC  JSR $BC1B  ; round FAC, then STX $22, STY $23: pointer, then 5 bytes
FADD    .C:b867  20 8C BA  JSR $BA8C  ; CONUPK first: mem(A/Y) into ARG
FSUB    .C:b850  20 8C BA  JSR $BA8C  ; CONUPK, then LDA $66 / EOR #$FF / STA $66: negate FAC, add
FMULT   .C:ba28  20 8C BA  JSR $BA8C  ; CONUPK, BNE past a JMP $BA8B (zero FAC)
FDIV    .C:bb0f  20 8C BA  JSR $BA8C  ; CONUPK, BEQ $BB8A (division by zero), JSR $BC1B
FSQR    .C:bf71  20 0C BC  JSR $BC0C  ; FAC to ARG, LDA #$11 / LDY #$BF: 0.5 at $BF11, JSR $BBA2: power
FOUT    .C:bddd  A0 01     LDY #$01   ; LDA #$20, BIT $66, BPL, LDA #$2D: space or minus at $0100
CONUPK  .C:ba8c  85 22     STA $22    ; STY $23, LDY #$04, LDA ($22),Y, STA $6D: 5 bytes into ARG
LINPRT  .C:bdcd  85 62     STA $62    ; STX $63, LDX #$90, SEC, JSR $BC49: A/X as an unsigned float
RND     .C:e097  20 2B BC  JSR $BC2B  ; sign of FAC, BMI / BNE / JSR $FFF3: RND(<0), RND(>0), RND(0)
```

Every first instruction fits the role its name claims: the four
arithmetic entries begin by unpacking the operand at A/Y into ARG, the
two movers begin with the pointer stores, `FSQR` is `FAC ^ 0.5`, and
`FOUT` decides the sign character. None was rejected. The lines after
the first instruction in each comment are the next lines of the same
dump, paraphrased.

Zero page `$57` to `$70`, copied before the first call and after the
last `FOUT` (before the `LINPRT` lines), same on both models:

```
before  $57: 00 00 00 00 00 00 00 00 00 00 8c 00 00 08 0e 00 00 00 8c 80 c0 00 00 00 00 00
after   $57: 7e af b0 cc c0 80 ff 00 00 00 9c ff ff ff ff 20 00 00 80 00 00 00 08 00 20 00
```

Changed: `$57` to `$5D`, `$61` to `$66`, `$69` to `$6B`, `$6D` and
`$6F`. Unchanged: `$5E` to `$60`, `$67`, `$68`, `$6C`, `$6E` and `$70`.
The before copy is what `SYS` left: `$61` to `$65` hold `8C 00 00 08
0E`, which is 2062, the program's start address as BASIC evaluated it
(arithmetic: exponent `$8C` is 2^12, mantissa `$0000080E`).

The control, `-define BASICOUT`, run once on PAL with `trace exec` on
`$B391`, `$FE66` and `$E37B`: the first `JSR GIVAYF` fetched opcode
`00` from the RAM at `$B391` (`$01` read `36` at that moment) and
executed `BRK` at cycle 3,053,082; the `BRK` vector reached the KERNAL
at `$FE66`, whose `JSR $FDA3` (IOINIT) wrote `$E7` to `$01` at `$FDD7`,
banking BASIC back in, and whose `JSR $E518` cleared the screen; then
`JMP ($A002)` went to the warm start at `$E37B` with `$01` reading
`37`. The screenshot shows a cleared screen, `READY.` on row 1, a
glyph the decoder did not match on row 2 at the cursor's position (the
warm start re-enables interrupts, so the cursor flashes), the border
its default light blue, and `$02FF` still `00`. The program's header
line, printed before the first call, was wiped by the screen clear. So
the failure mode with BASIC out is not garbage arithmetic but a `BRK`
into the KERNAL and a warm start that quietly re-banks the ROM.

## Why this works

BASIC's arithmetic works on two five-byte accumulators in zero page,
FAC at `$61` to `$66` and ARG at `$69` to `$6E`, each an exponent in
excess-128 form, a 32-bit mantissa with its top bit implied set, and a
separate sign byte; in memory the sign is folded into bit 7 of the
first mantissa byte. `MOVFM` unpacks a memory float into FAC, `CONUPK`
unpacks one into ARG, and the arithmetic entries take a pointer in A
(low) and Y (high) to the memory operand and leave the result in FAC,
so `FDIV` computes `mem / FAC` and the divisor has to be in FAC first:
that is why the listing converts 355, stores it to `tmp` with `MOVMF`,
converts 113 and then calls `FDIV` with `tmp`. `GIVAYF` stores A and Y
straight into the top of the mantissa and normalises from an exponent
of `$90`, which is the 16-bit integer path.

The constants: 0.1 is `0.8 * 2^-3`, so the exponent byte is 128 - 3 =
`$7D` and the mantissa is `0.8 * 2^32 = 3435973836.8`, rounded to
`$CCCCCCCD`; the sign bit is cleared for a positive value, giving
`7D 4C CC CC CD`. BASIC's own `1 / 10` came out as those five bytes, so
the derivation and the ROM's rounding agree. 0.2 is the same mantissa
with exponent `$7E`. Their sum prints as `.3` because `FOUT` rounds to
nine significant digits and the 32-bit sum is within half a unit of
0.3 at that precision. `2^24 + 1` prints exactly as 16777217: a 32-bit
mantissa holds every integer below 2^32, so the value that a 24-bit
single-precision format loses survives here. `FOUT` writes a leading
space for a positive value, drops the leading zero and terminates the
string with a zero byte, which is what the expected strings assert.

`FSQR` is not a root routine: its first instruction copies FAC to ARG
and the next two point at the constant 0.5 at `$BF11`, and the power
routine computes `exp(0.5 * log(x))`. That is why it costs 43,752
cycles, more than two PAL frames, against 1,079 for a multiply. `FOUT`
at 7,412 is a digit loop with a divide by ten per digit. All four
figures are one input each, not worst cases.

## What it does not establish

Any address on a BASIC ROM other than 901226-01: the entries were
checked against the image VICE ships and no other. Accuracy beyond the
four printed cases and the one constant compared: no sweep over inputs
was run, and the timings are for the inputs shown, not a worst case.
The ownership of the individual bytes in `$57` to `$60` is not
attributed to routines; only which bytes changed over the whole
sequence was measured. The control was run once and on PAL only.
