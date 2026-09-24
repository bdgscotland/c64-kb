---
recipe: unit-test-driver
toolchain: kickassembler
output_format: PRG
region: both
techniques: [compare_16bit_and_signed]
file_formats: [PRG]
uses_registers: [D020]
uses_kernal: [CHROUT]
---

<!-- doc-type: recipe -->

# KickAssembler Unit Test Driver: one routine, a table of cases, a verdict

## Synopsis

A test driver for a single routine, the signed 16-bit compare from
`compare_16bit_and_signed`. The cases live in a table of five-byte
records (both operands and the flag the routine should leave); the driver
loads each one, calls the routine, captures the N flag, counts passes and
failures and remembers the index of the first failure. It clears the
screen, prints the four figures, and leaves the verdict the way the
`headless-verify` recipes do: `$02FF` = `$01` and a green border when
nothing failed, `$02FF` = `$02` and red otherwise. Assembling with
`-define BAD_CASE` appends a case whose expectation is wrong, so the red
path can be exercised without touching the routine. The workflow around
it, including running the same table in a simulator and in 64spec, is
[unit-testing-6502](../../toolchains/unit-testing-6502.md).

## Source

```asm
// unit-test-driver.asm
// A table-driven unit test for one routine: the signed 16-bit compare
// from the compare_16bit_and_signed technique. Each case is five bytes
// (a lo, a hi, b lo, b hi, expected N flag). The driver loads a case,
// calls the routine, captures N, compares it with the expectation,
// counts passes and failures, remembers the first failing case, clears
// the screen and prints the counts, then leaves the verdict where a
// harness can read it: $02FF = $01 and a green border when nothing
// failed, $02FF = $02 and a red border otherwise. Assemble with
// -define BAD_CASE to append a case whose expectation is wrong.
BasicUpstart2(start)

.const CHROUT    = $ffd2
.const RESULT    = $02ff         // verdict byte read by the harness
.const BORDER    = $d020
.const CODE_PASS = $01
.const CODE_FAIL = $02
.const CASE_SIZE = 5
.const NO_FAIL   = $ff           // "first failing case" when none failed

.const a_lo = $fb                // operands the routine under test reads
.const a_hi = $fc
.const b_lo = $fd
.const b_hi = $fe
.const ptr  = $f9                // zero page: the case pointer must be there

// ------------------------------------------------- routine under test
// Signed 16-bit compare of a against b. Exit: N set means a < b.
s16_less:
    lda a_lo
    cmp b_lo                     // borrow for the high-byte subtract
    lda a_hi
    sbc b_hi
    bvc !+                       // no overflow: N is the sign of a - b
    eor #$80                     // overflow: the sign came out inverted
!:  rts

// ------------------------------------------------------------- driver
start:
    jsr run_cases
    jmp report

// Runs every case in the table. A simulator can call this on its own
// and read passes, fails and first_fail without the KERNAL being there.
run_cases:
    lda #0
    sta passes
    sta fails
    sta index
    lda #NO_FAIL
    sta first_fail
    lda #<cases
    sta ptr
    lda #>cases
    sta ptr+1

next_case:
    lda index
    cmp #NUM_CASES
    bne !+
    rts
!:
    ldy #0                       // load the case into the operands
    lda (ptr),y
    sta a_lo
    iny
    lda (ptr),y
    sta a_hi
    iny
    lda (ptr),y
    sta b_lo
    iny
    lda (ptr),y
    sta b_hi
    iny
    lda (ptr),y
    sta expect

    jsr s16_less                 // the call under test
    php
    pla
    and #$80                     // keep only N
    cmp expect
    beq passed
    inc fails
    lda first_fail
    cmp #NO_FAIL
    bne advance                  // already have the first one
    lda index
    sta first_fail
    jmp advance
passed:
    inc passes

advance:
    clc                          // ptr += CASE_SIZE
    lda ptr
    adc #CASE_SIZE
    sta ptr
    bcc !+
    inc ptr+1
!:  inc index
    jmp next_case

// ------------------------------------------------------------- report
report:
    lda #$93                     // clear the screen so row 0 is ours
    jsr CHROUT
    ldx #0
!:  lda text,x
    beq !+
    jsr CHROUT
    inx
    bne !-
!:  lda #NUM_CASES
    jsr hexbyte
    jsr space
    lda passes
    jsr hexbyte
    jsr space
    lda fails
    jsr hexbyte
    jsr space
    lda first_fail
    jsr hexbyte
    lda #$0d
    jsr CHROUT

    lda fails
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
    rts

space:
    lda #' '
    jmp CHROUT

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
!:  adc #'0'
    jmp CHROUT

.encoding "petscii_upper"
text:   .text "CASES PASS FAIL FIRST"
        .byte $0d, 0

passes:     .byte 0
fails:      .byte 0
index:      .byte 0
first_fail: .byte 0
expect:     .byte 0

// ---------------------------------------------------------- case table
// a lo, a hi, b lo, b hi, expected N ($80 = a < b, $00 = a >= b)
.macro Case(a, b, less) {
    .byte <a, >a, <b, >b, less
}
cases:
    Case($0000, $0000, $00)      // equal
    Case($0001, $0000, $00)      // 1 > 0
    Case($0000, $0001, $80)      // 0 < 1
    Case($ffff, $0000, $80)      // -1 < 0
    Case($0000, $ffff, $00)      // 0 > -1
    Case($8000, $7fff, $80)      // -32768 < 32767: overflow case
    Case($7fff, $8000, $00)      // 32767 > -32768: overflow case
    Case($8000, $8000, $00)      // most negative equals itself
    Case($0100, $00ff, $00)      // low byte borrows, high decides
    Case($00ff, $0100, $80)
    Case($ff00, $ff01, $80)      // -256 < -255
    Case($ffff, $fffe, $00)      // -1 > -2
    Case($0064, $ff9c, $00)      // 100 > -100
    Case($8000, $8001, $80)      // -32768 < -32767
#if BAD_CASE
    Case($0005, $0005, $80)      // wrong on purpose: 5 is not below 5
#endif
cases_end:
.label NUM_CASES = (cases_end - cases) / CASE_SIZE
```

## Build

```bash
java -jar KickAss.jar unit-test-driver.asm -o unit-test-driver.prg -symbolfile
java -jar KickAss.jar unit-test-driver.asm -o unit-test-driver-bad.prg -define BAD_CASE
```

The first line is the pinned build: 346 bytes, code at `$080e` to `$0958`
(KickAssembler 5.25, `-showmem`). `-symbolfile` writes
`unit-test-driver.sym`, which the simulator route on the workflow page
reads for `s16_less`, `run_cases`, `passes`, `fails` and `first_fail`.
The second line is the red build, 351 bytes, one case longer.

## Expected output

Border green. Screen cleared, then rows 0 to 3:

```
CASES PASS FAIL FIRST
0E 0E 00 FF

READY.
```

Fourteen cases, fourteen passes, no failures, no first failing case
(`FF` is the "none" value). Screenshots from the pinned run, 8,000,000
cycles: `screenshots/unit-test-driver.png` (PAL) and
`screenshots/unit-test-driver-ntsc.png` (NTSC). Measured on both: the two
rows above decoded from the PNG with the char ROM, border pixel (2, 100)
= (98, 213, 50) on PAL and (114, 189, 103) on NTSC, index 5 in both
palettes of `runtime/vice-reference.md`. Two runs per model gave
byte-identical PNGs.

The red build was run on both models and not pinned: rows 0 and 1 read
`CASES PASS FAIL FIRST` and `0F 0E 01 0E`, fifteen cases, one failure,
and the first failing case is index `$0E`, the appended one. Border
(175, 60, 88) on PAL and (169, 71, 100) on NTSC, index 2. Over
`-moncommands` with the trace file from the vice-reference section
"Verifying a run without a human", the green build logged `>C:02ff  00`
at the KERNAL's page-2 clear and then `>C:02ff  01` from `STA $02FF` at
`$08D5`, cycle 3,023,721; the red build's last line was `>C:02ff  02`.

## Why this works

The case record is the whole interface. A record holds every input the
routine reads and the one output the test judges, so a new case is one
`Case(...)` line and the count follows from the table's length:
`NUM_CASES` is a `.label`, not a `.const`, because it is defined after
`cases_end` and only a `.label` may reference a symbol assembled later.
The routine leaves its answer in N, so the driver captures the flags
with `php`/`pla` straight after the `jsr`, masks everything but bit 7,
and compares that byte with the record's fifth byte; a routine that
returned a value in A or in memory would store that instead and the rest
of the driver would not change. The cases are the ones a signed compare
gets wrong when written naively: the two overflow pairs at `$8000` and
`$7FFF`, the most negative value against itself, and pairs whose low
bytes borrow. `BAD_CASE` guards a case with a wrong expectation rather
than a wrong routine, so the red build shows the driver reports a
failure, its count and its index, without anyone editing the code under
test.

`run_cases` is a subroutine and `report` is separate so a CPU simulator
with no KERNAL loaded can call `run_cases` and read `passes`, `fails` and
`first_fail` from memory; the printing and the verdict happen only in
the VICE run. The verdict itself follows `headless-verify`: `sta RESULT`
first, `sty BORDER` second, codes starting at `$01` because the reset
leaves `$02FF` at `00`. The screen is cleared with `$93` before the
figures so they land on row 0 whatever BASIC printed before, which is
what makes the decoded rows stable across models and runs.

The first version of this listing declared `ptr` as a `.word` in the
data area and every case failed, `first_fail` = `00`. KickAssembler
assembled `lda (ptr),y` as `B1 11`, the low byte of `$0911`, with no
error, because indirect-indexed addressing has no absolute form and the
assembler truncated the operand; the pitfall `illegal_opcode_portability`
in `docs/pitfalls/cpu.md` records the same silent truncation in a
`.byte` escape. The pointer moved to `$F9`/`$FA` in zero page and the
table read correctly. Measured with `-bytedump`, which is the quickest
way to see what an operand became.

Verified: assembled with KickAssembler 5.25, run headless in VICE x64sc
3.10 (the windowless build) with the pinned command on PAL and NTSC; the
screenshots were decoded with the char ROM, not read by eye.
