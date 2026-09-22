---
recipe: speedcode-generator
toolchain: kickassembler
output_format: PRG
region: both
techniques: [speedcode_generation]
file_formats: [PRG]
uses_registers: [D011, D020, DD04, DD05, DD06, DD07, DD0E, DD0F]
uses_kernal: [CHROUT]
---

<!-- doc-type: recipe -->

# KickAssembler — Speedcode Generator

## Synopsis

A generator that writes an unrolled copy routine into RAM at start-up,
from two tables of row addresses, and then proves it. The job is a
1,000-byte block, 25 rows of 40 bytes: the generator emits one
`LDA abs / STA abs` pair per byte (6,000 bytes of code) and an `RTS`, the
program runs it, compares the destination with the source byte for byte,
and times three things with the CIA2 timers: the generation, the
generated code, and a plain indexed loop doing the same copy. The three
counts are printed and the verdict is left where a harness can read it:
`$02FF` = `$01` and a green border when every byte matches and the
generated code beat the loop by at least `MARGIN` (2,000) cycles, `$02FF`
= `$02` and a red border otherwise. The harness side is
`runtime/vice-reference.md`, section "Verifying a run without a human".

## Source

```asm
// speedcode-generator.asm
// Generates an unrolled copy of a 1,000-byte block (25 rows of 40) into
// RAM at CODE from two row-address tables, runs it, checks the destination
// against the source, and times it against a plain indexed loop with the
// CIA2 timers. Prints the three cycle counts (generation, generated code,
// loop) and the verdict: $02FF = $01 and a green border when the copy
// matches and the generated code beat the loop by at least MARGIN cycles,
// $02FF = $02 and a red border otherwise.

BasicUpstart2(start)

.const CHROUT   = $ffd2
.const RESULT   = $02ff          // verdict byte read by the harness
.const BORDER   = $d020
.const CODE_PASS = $01
.const CODE_FAIL = $02

.const ROWS     = 25
.const COLS     = 40             // 25 * 40 = 1,000 bytes
.const DST      = $4000          // destination block
.const CODE     = $5000          // generated code: 1,000 * 6 + 1 = 6,001 bytes
.const MARGIN   = 2000           // generated code must beat the loop by this
.const FORCE_FAULT = 0           // 1: corrupt one generated opcode (red case)

.const OP_LDA_ABS = $ad
.const OP_STA_ABS = $8d
.const OP_RTS     = $60

.const out      = $fb            // zero-page pointer to the emitted code
.const ptr      = $fd            // zero-page pointer for puts

// Time(routine, slot): run routine with CIA2 timer A counting phi2 and
// timer B counting A underflows; leave the 24-bit count in slot.
.macro Time(routine, slot) {
    lda #$51                     // CRB: start, force load, count A underflows
    sta $dd0f
    lda #$11                     // CRA: start, force load, count phi2
    sta $dd0e
    jsr routine
    lda #$00
    sta $dd0e                    // stop A
    sta $dd0f                    // stop B
    lda #$ff                     // count = $FFFFFF - (TB:TA), no borrows
    sbc $dd04
    sta slot
    lda #$ff
    sbc $dd05
    sta slot+1
    lda #$ff
    sbc $dd06
    sta slot+2
}

// PutDec(slot): print the 24-bit value in slot in decimal
.macro PutDec(slot) {
    lda slot
    sta num
    lda slot+1
    sta num+1
    lda slot+2
    sta num+2
    jsr putdec
}

// Net(slot): slot -= empty, the cost of the harness itself
.macro Net(slot) {
    sec
    lda slot
    sbc empty
    sta slot
    lda slot+1
    sbc empty+1
    sta slot+1
    lda slot+2
    sbc empty+2
    sta slot+2
}

start:
    sei
    lda #$00                     // stop both CIA2 timers and set both
    sta $dd0e                    // latches to $FFFF
    sta $dd0f
    lda #$ff
    sta $dd04
    sta $dd05
    sta $dd06
    sta $dd07

    // clear the destination so a missed byte shows
    ldx #$00
    txa
!:  sta DST,x
    sta DST+250,x
    sta DST+500,x
    sta DST+750,x
    inx
    cpx #250
    bne !-

    // screen off, so no badline steals cycles from the timed regions.
    // DEN is sampled on line $30; wait for the next frame so it applies.
    lda $d011
    and #$ef
    sta $d011
!:  lda $d011                    // wait until raster line >= 256
    bpl !-
!:  lda $d011                    // then until it wraps to line 0
    bmi !-

    Time(nothing, empty)
    Time(generate, t_gen)
.if (FORCE_FAULT != 0) {
    lda #OP_LDA_ABS              // turn the first STA into an LDA:
    sta CODE + 3                 // DST+0 is never written
}
    Time(CODE, t_fast)

    // check the destination now: the loop below would repair it
    ldx #$00
    stx match
!:  lda src,x
    cmp DST,x
    bne compared
    lda src+250,x
    cmp DST+250,x
    bne compared
    lda src+500,x
    cmp DST+500,x
    bne compared
    lda src+750,x
    cmp DST+750,x
    bne compared
    inx
    cpx #250
    bne !-
    inc match                    // every byte equal
compared:
    Time(loopcopy, t_loop)

    lda $d011                    // screen back on
    ora #$10
    sta $d011
    cli

    Net(t_gen)
    Net(t_fast)
    Net(t_loop)

    lda match
    beq fail                     // the generated copy missed a byte

    // verdict 2: t_loop - t_fast >= MARGIN
    sec
    lda t_loop
    sbc t_fast
    sta diff
    lda t_loop+1
    sbc t_fast+1
    sta diff+1
    lda t_loop+2
    sbc t_fast+2
    bcc fail                     // loop was faster
    bne pass                     // difference of 65,536 or more
    lda diff
    cmp #<MARGIN
    lda diff+1
    sbc #>MARGIN
    bcc fail
pass:
    lda #CODE_PASS
    ldy #5                       // green
    bne checkpoint
fail:
    lda #CODE_FAIL
    ldy #2                       // red
checkpoint:
    sta RESULT                   // the harness watches this store
    sty BORDER

    // print the three counts and the verdict line
    ldx #<gentext
    ldy #>gentext
    jsr puts
    PutDec(t_gen)
    ldx #<fasttext
    ldy #>fasttext
    jsr puts
    PutDec(t_fast)
    ldx #<looptext
    ldy #>looptext
    jsr puts
    PutDec(t_loop)
    ldx #<restext
    ldy #>restext
    jsr puts
    lda RESULT
    jsr hexbyte
    lda RESULT
    cmp #CODE_PASS
    beq !+
    ldx #<failtext
    ldy #>failtext
    jmp puts
!:  ldx #<passtext
    ldy #>passtext
    jmp puts

nothing:
    rts

// ---------------------------------------------------------------------------
// generate: for each of ROWS rows, take the source and destination row
// addresses from the tables and emit COLS pairs of
//     LDA abs  ($AD lo hi)
//     STA abs  ($8D lo hi)
// with the addresses stepping by one, then an RTS after the last row.
// Each row is COLS * 6 = 240 bytes of code, so Y indexes one row's worth.
// ---------------------------------------------------------------------------
generate:
    lda #<CODE
    sta out
    lda #>CODE
    sta out+1
    ldx #$00                     // row
row:
    lda src_lo,x
    sta cur_src
    lda src_hi,x
    sta cur_src+1
    lda dst_lo,x
    sta cur_dst
    lda dst_hi,x
    sta cur_dst+1
    ldy #$00
pair:
    lda #OP_LDA_ABS
    sta (out),y
    iny
    lda cur_src
    sta (out),y
    iny
    lda cur_src+1
    sta (out),y
    iny
    lda #OP_STA_ABS
    sta (out),y
    iny
    lda cur_dst
    sta (out),y
    iny
    lda cur_dst+1
    sta (out),y
    iny
    inc cur_src
    bne !+
    inc cur_src+1
!:  inc cur_dst
    bne !+
    inc cur_dst+1
!:  cpy #COLS * 6
    bne pair
    tya                          // out += 240
    clc
    adc out
    sta out
    bcc !+
    inc out+1
!:  inx
    cpx #ROWS
    bne row
    lda #OP_RTS
    ldy #$00
    sta (out),y
    rts

// ---------------------------------------------------------------------------
// loopcopy: the plain version of the same job. Four 250-byte strides,
// one index register, LDA abs,X / STA abs,X.
// ---------------------------------------------------------------------------
loopcopy:
    ldx #$00
!:  lda src,x
    sta DST,x
    lda src+250,x
    sta DST+250,x
    lda src+500,x
    sta DST+500,x
    lda src+750,x
    sta DST+750,x
    inx
    cpx #250
    bne !-
    rts

// ---------------------------------------------------------------------------
// output helpers
// ---------------------------------------------------------------------------
puts:                            // print the zero-terminated string at Y:X
    stx ptr
    sty ptr+1
    ldy #$00
!:  lda (ptr),y
    beq !+
    jsr CHROUT
    iny
    bne !-
!:  rts

putdec:                          // print the 24-bit value in num, decimal
    ldx #$00                     // power-of-ten index, 0 = 1,000,000
    stx lead
digit:
    lda #'0' - 1
    sta dig
!:  inc dig
    sec
    lda num
    sbc pow10,x
    sta num
    lda num+1
    sbc pow10+1,x
    sta num+1
    lda num+2
    sbc pow10+2,x
    sta num+2
    bcs !-
    lda num                      // undo the last subtraction
    adc pow10,x
    sta num
    lda num+1
    adc pow10+1,x
    sta num+1
    lda num+2
    adc pow10+2,x
    sta num+2
    lda dig
    cmp #'0'
    bne show
    cpx #6 * 3                   // last digit always prints
    beq show
    lda lead
    beq next                     // suppress a leading zero
    lda #'0'
show:
    jsr CHROUT
    inc lead
next:
    inx
    inx
    inx
    cpx #7 * 3
    bne digit
    lda #$0d
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

pow10:  .byte <1000000, >1000000, 1000000 >> 16
        .byte <100000, >100000, 100000 >> 16
        .byte <10000, >10000, 0
        .byte <1000, >1000, 0
        .byte <100, >100, 0
        .byte <10, >10, 0
        .byte <1, >1, 0

cur_src: .word 0
cur_dst: .word 0
diff:    .word 0
match:   .byte 0
num:     .byte 0, 0, 0
dig:     .byte 0
lead:    .byte 0

.encoding "petscii_upper"
gentext:  .text "GEN  "
          .byte 0
fasttext: .text "FAST "
          .byte 0
looptext: .text "LOOP "
          .byte 0
restext:  .text "RESULT "
          .byte 0
passtext: .text " PASS"
          .byte $0d, 0
failtext: .text " FAIL"
          .byte $0d, 0

// the row-address tables the generator reads
src_lo:  .fill ROWS, <(src + i * COLS)
src_hi:  .fill ROWS, >(src + i * COLS)
dst_lo:  .fill ROWS, <(DST + i * COLS)
dst_hi:  .fill ROWS, >(DST + i * COLS)

// the 24-bit timer slots: three bytes each, measured then net of empty
empty:   .byte 0, 0, 0
t_gen:   .byte 0, 0, 0
t_fast:  .byte 0, 0, 0
t_loop:  .byte 0, 0, 0

// the source block: 1,000 bytes, no two neighbouring rows alike
src:     .fill ROWS * COLS, (i * 7 + 13) & $ff
```

## Build

```bash
java -jar KickAss.jar speedcode-generator.asm -o speedcode-generator.prg -symbolfile
```

Produces `speedcode-generator.prg`, 2,049 bytes, `$080e` to `$0fff`
(KickAssembler 5.25, `-showmem`). 1,185 of those bytes are data, from
`pow10` at `$0b5f` to the end: the 1,000-byte source block at `$0c18`,
the four 25-entry row tables, the powers of ten, the timer slots and
the text. The generated code is not in the PRG; it
occupies `$5000` to `$6770` in RAM once `generate` has run.

## Expected output

Border green. Text area still the power-on blue. Screen rows 5 to 12:

```
READY.
RUN
GEN  92485
FAST 8000
LOOP 10787
RESULT 01 PASS

READY.
```

Screenshots from the pinned run, 8,000,000 cycles:
`screenshots/speedcode-generator.png` (PAL) and
`screenshots/speedcode-generator-ntsc.png` (NTSC). Measured on both:
the three counts above on rows 7 to 9 and `RESULT 01 PASS` on row 10,
decoded from the screenshots against the character ROM; border pixel
(2, 100) = (98, 213, 50) on PAL and (114, 189, 103) on NTSC, index 5 in
both palettes of `runtime/vice-reference.md`. The pinned command was run
twice per model and the two PNGs were identical bytes. The counts are
the same on both models because the timed regions run with the screen
blanked, so they are CPU cycles with nothing stolen, and the 6510 takes
the same number of them for the same code on either machine.

The three numbers, net of the harness (an empty `JSR`/`RTS` is timed
first and subtracted), measured in VICE x64sc 3.10:

| Line | What was timed | Cycles | Per byte |
|---|---|---|---|
| `GEN` | `generate`: 1,000 pairs and the `RTS` written to RAM | 92,485 | 92.5 emitted, about 4.7 PAL frames once |
| `FAST` | the generated code: 1,000 × `LDA abs` (4) + `STA abs` (4) | 8,000 | 8.0 |
| `LOOP` | the indexed loop, four 250-byte strides | 10,787 | 10.8 |

`FAST` is exactly the arithmetic, which is also the check that the
empty-call subtraction removes the `JSR`, the `RTS` and the timer stores
and nothing else. `LOOP` is exactly the arithmetic too: `LDX` (2) plus
250 iterations of 43 cycles less 1 for the final untaken branch is
10,749, plus 36 page-crossing cycles on `LDA abs,X`, from the source
block starting at `$0c18` (the strides at `$0c18`, `$0d12` and `$0e0c`
cross a page for 18, 12 and 6 values of X; the one at `$0f06` never
does). Move the source and `LOOP` moves by
a few dozen cycles; the generated code has no indexed reads and does
not. The generated code wins by 2,787 cycles, 1.35 times the speed;
`MARGIN` is 2,000 so that a relocation of the source cannot flip the
verdict.

The red case, `.const FORCE_FAULT = 1`, was run once on PAL and not
pinned: it overwrites the first emitted `STA` opcode with `LDA` after
generation, so the first destination byte stays zero, and the screen
shows `RESULT 02 FAIL` on row 10 with the border at (175, 60, 88),
index 2; the `-moncommands` trace of `$02FF` logged `02`. Its `GEN` and
`LOOP` read 92,490 and 10,807, five and twenty cycles more, because the
five extra bytes of the fault move every loop and the source block and
change which branches and indexed reads cross a page.

An earlier draft of this program compared the destination after the
timed loop had run, and the red case passed: the loop had repaired the
byte the broken speedcode missed. The comparison now sits between the
two timed runs.

## Why this works

### What the generator emits

`LDA abs` is `$AD lo hi` and `STA abs` is `$8D lo hi`, so a copy of one
byte is six bytes of code and eight cycles. The generator keeps a
16-bit output pointer in zero page (`out`, at `$FB`) and writes each
pair through `STA (out),Y`. Y runs 0 to 239 within a row, one row of 40
pairs being exactly 240 bytes, and the pointer advances by 240 per row;
25 rows give 6,000 bytes, and the `RTS` (`$60`) lands at `$5000 + 6000 =
$6770`. Both were read back over the monitor at the checkpoint: `$5000`
holds `AD 18 0C 8D 00 40 AD 19 0C 8D 01 40`, that is `LDA $0C18 / STA
$4000 / LDA $0C19 / STA $4001`, the last pair at `$676A` is `AD FF 0F 8D
E7 43`, and `$6770` is `60`.

The source and destination addresses come from four tables the
assembler builds with `.fill`, one low and one high byte per row. The
generator never computes a row address; it reads two and then
increments them 40 times. That is what makes it more than a `memcpy`:
the same generator, given a source table with a stride of 64 and a
destination table with a stride of 40, emits code that copies a 40-wide
window out of a wider map buffer with no per-row arithmetic at run
time. The block here has both strides at 40 so that the four-stride
loop and the byte compare stay simple.

### Timing with CIA2

CIA1's timer A drives the KERNAL's jiffy interrupt, so the harness uses
CIA2, whose timers nothing in the KERNAL touches after reset. Both
latches are set to `$FFFF` once. `Time` starts B first with `$51` (start,
force load, count timer A underflows) and then A with `$11` (start, force
load, count phi2), calls the routine, stops A then B, and reads the
count as `$FFFFFF` minus `TB:TA`; the per-byte subtraction needs no
borrow because each timer byte is at most `$FF`. `table_generation` in
`techniques/cpu-cycle-tricks.md` uses the same cascade on CIA1 with
interrupts off.

The four timed calls run under `SEI` and with the screen blanked. A CIA
timer counts phi2 whether or not the CPU is running, so a badline inside
a timed region would add its 40 to 43 stolen cycles to the count and
the result would depend on where in the frame the run started, and
differ between PAL and NTSC. DEN (`$D011` bit 4) is sampled once per
frame on line `$30`, so the code clears it and then waits for the raster
to pass line 255 and wrap to 0 before starting the first timer; from
that frame on there are no badlines until DEN is set again. The whole
timed sequence is about 120,000 cycles, six PAL frames, and the screen
is back on long before the exit screenshot.

### Where the code goes

`$5000` to `$6770` is inside VIC bank 1 (`$4000` to `$7FFF`), which the
VIC does not display on a stock machine, so 6 KB of generated code
costs no screen, charset or sprite space. It is also always RAM: no
ROM or I/O is ever mapped there, so the emitted bytes are the bytes
the CPU fetches. Generating under BASIC ROM at `$A000` or the KERNAL at
`$E000` writes fine and executes the ROM instead unless `$01` banks it
out first; `ram_under_rom_traps` in `pitfalls/banking.md` is that
failure.

### The verdict

The result byte, the border and the printed line follow the contract in
`runtime/vice-reference.md`: `$02FF` is written first, then `$D020`, then
the text. The margin test is a 24-bit subtraction: a borrow out of the
top byte means the loop was faster (fail), a non-zero top byte means a
difference of 65,536 or more (pass), and otherwise the 16-bit difference
is compared with `MARGIN`. The decimal printer subtracts powers of ten
from a 24-bit copy of the count and suppresses leading zeros, so a
count up to 9,999,999 prints without padding.

## What this recipe does not show

It generates once and runs the code once. The technique's other two
schedules, generation per part and per frame, are described under
`speedcode_generation` in `techniques/cpu-cycle-tricks.md` and not
measured here. The 8,000-cycle copy is longer than the PAL vertical
blank of about 7,100 cycles (`sine-scroller.md`), so used per frame on
the visible screen it has to be placed against the raster, which this
program does not do.
