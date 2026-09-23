---
recipe: compare-16bit-signed
toolchain: kickassembler
output_format: PRG
region: both
techniques: [compare_16bit_and_signed]
file_formats: [PRG]
uses_registers: [D011, D020, DD04, DD05, DD06, DD07, DD0E, DD0F]
uses_kernal: [CHROUT]
---

<!-- doc-type: recipe -->

# KickAssembler — 16-bit and signed compares, proved and timed

## Synopsis

Five compare idioms run against boundary pairs and full sweeps: unsigned
16-bit (high byte first), signed 8-bit and signed 16-bit (`SBC` then
`BVC` / `EOR #$80`), an unsigned range test (`x` in `[lo, lo + w)`), and
the wrong one, a signed compare that trusts `BMI` after the subtract.
The program prints the processor flags each idiom leaves on eight 8-bit
and seven 16-bit boundary pairs, folds every sweep result into a
checksum and compares it with the value a Python model computed, counts
how many pairs the `BMI` version gets wrong, times one call of each
idiom with the CIA2 timers, and leaves a verdict where a harness can
read it: `$02FF` = `$01` and a green border when the four correct
idioms match their checksums and the `BMI` version misses exactly the
16,384 pairs the model predicts, `$02FF` = `$02` and a red border
otherwise.

## Source

```asm
// compare-16bit-signed.asm
// Runs five compare idioms over boundary pairs and full sweeps, prints
// the processor flags each idiom leaves on the boundary pairs, checks
// every sweep against a checksum computed in Python, times one call of
// each idiom with the CIA2 timers, and leaves a verdict where a harness
// can read it: $02FF = $01 and a green border when the four correct
// idioms match their checksums and the naive BMI compare misses exactly
// the 16,384 pairs it is expected to miss; $02FF = $02 and a red border
// otherwise.

BasicUpstart2(start)
.encoding "screencode_upper"

.const SCREEN    = $0400
.const RESULT    = $02ff         // verdict byte read by the harness
.const BORDER    = $d020
.const CODE_PASS = $01
.const CODE_FAIL = $02

// expected checksums, from the Python model on the recipe page
.const EXP_U16 = $6182
.const EXP_S8  = $73fa
.const EXP_S16 = $27b8
.const EXP_RNG = $a021
.const EXP_BMI = $a3cd
.const EXP_MISS = 16384

.const src = $fb                 // zero-page pointer: string source
.const dst = $fd                 // zero-page pointer: screen destination

// ---------------------------------------------------------------- idioms
// Operands are absolute variables so the timed cost is the common case.

// Unsigned 16-bit: a_hi:a_lo against b_hi:b_lo.
// Exit: C clear means a < b, C set means a >= b, Z set means a == b.
u16:
    lda a_hi
    cmp b_hi
    bne !+                       // high bytes differ: they decide
    lda a_lo
    cmp b_lo                     // high bytes equal: the low bytes decide
!:  rts

// Signed 8-bit: a8 against b8.  Exit: N set means a < b.
s8:
    lda a8
    sec
    sbc b8
    bvc !+                       // no overflow: N is the sign of a - b
    eor #$80                     // overflow: the sign came out inverted
!:  rts

// Signed 16-bit.  Exit: N set means a < b.
s16:
    lda a_lo
    cmp b_lo                     // sets C for the high-byte subtract
    lda a_hi
    sbc b_hi
    bvc !+
    eor #$80
!:  rts

// The wrong way: signed compare by the sign of the difference alone.
bmi8:
    lda a8
    sec
    sbc b8
    rts                          // N is wrong whenever a - b overflowed

// Unsigned range: x8 in [lo8, lo8 + w8).  Exit: C clear means inside.
rng:
    lda x8
    sec
    sbc lo8
    cmp w8
    rts

// ---------------------------------------------------------------- probes
// Same instructions with PHP after the points the page tabulates.

probe8:
    lda a8
    sec
    sbc b8
    php                          // P after SBC
    bvc !+
    eor #$80
!:  php                          // P after the fix-up
    pla
    sta p_fix
    pla
    sta p_sbc
    rts

probe16:
    clv                          // CMP never touches V; clear it so the
    lda a_hi                     // table shows what CMP alone leaves
    cmp b_hi
    php                          // P after the high-byte CMP alone
    pla
    sta p_cmph
    jsr u16
    php
    pla
    sta p_u16
    jsr s16
    php
    pla
    sta p_s16
    rts

// ---------------------------------------------------------------- timing
// Time(routine, slot): CIA2 timer A counts phi2, timer B counts A
// underflows; the 24-bit count lands in slot.
.macro Time(routine, slot) {
    lda #$51
    sta $dd0f
    lda #$11
    sta $dd0e
    jsr routine
    lda #$00
    sta $dd0e
    sta $dd0f
    sec                          // the routine left C in either state
    lda #$ff
    sbc $dd04
    sta slot
    lda #$ff
    sbc $dd05
    sta slot+1
    lda #$ff
    sbc $dd06
    sta slot+2
}

.macro Net(slot) {
    sec
    lda slot
    sbc empty
    sta slot
}

nothing:
    rts

// ---------------------------------------------------------------- sweeps
// sweep: for ii in 0..255, for jj in 0..255: jsr pair; fold the 0/1
// result into cs together with the pair.  cs is not reset here.
sweep:
    lda #0
    sta ii
!outer:
    lda #0
    sta jj
!inner:
pair_jsr:
    jsr $0000                    // patched by RunSweep
    jsr fold
    inc jj
    bne !inner-
    inc ii
    bne !outer-
    rts

// fold: A = 0 or 1.  cs = rol16(cs) ^ (A ? ii:jj : 0) + 13
fold:
    tax
    asl cs
    rol cs+1
    bcc !+
    inc cs
!:  txa
    beq !+
    lda cs
    eor jj
    sta cs
    lda cs+1
    eor ii
    sta cs+1
!:  clc
    lda cs
    adc #13
    sta cs
    bcc !+
    inc cs+1
!:  rts

// The pair routines set the operands from ii, jj and return A = 1 for
// "less" (or "inside"), else 0.
pair_s8:
    lda ii
    sta a8
    lda jj
    sta b8
    jsr s8
    jmp n_to_a

pair_bmi:                        // also counts disagreements with s8
    lda ii
    sta a8
    lda jj
    sta b8
    jsr s8
    jsr n_to_a
    sta tmp
    jsr bmi8
    jsr n_to_a
    cmp tmp
    beq !+
    inc miss
    bne !+
    inc miss+1
!:  rts

pair_u16a:                       // a = ii:jj, b = jj:ii
    lda ii
    sta a_hi
    sta b_lo
    lda jj
    sta a_lo
    sta b_hi
    jsr u16
    jmp c_to_a

pair_u16b:                       // a = ii:jj, b = ii:(7*jj+3)
    jsr set_b
    jsr u16
    jmp c_to_a

pair_s16a:
    lda ii
    sta a_hi
    sta b_lo
    lda jj
    sta a_lo
    sta b_hi
    jsr s16
    jmp n_to_a

pair_s16b:
    jsr set_b
    jsr s16
    jmp n_to_a

pair_rng:                        // lo = ii, w = min(32, 256 - lo), x = jj
    lda ii
    sta lo8
    cmp #224
    bcc !+
    lda #0
    sec
    sbc ii
    jmp !++
!:  lda #32
!:  sta w8
    lda jj
    sta x8
    jsr rng
    jmp c_to_a

set_b:
    lda ii
    sta a_hi
    sta b_hi
    lda jj
    sta a_lo
    asl
    asl
    asl
    sec
    sbc jj
    clc
    adc #3
    sta b_lo
    rts

n_to_a:                          // N set -> A = 1, else 0; flags from the compare
    bmi !+
    lda #0
    rts
!:  lda #1
    rts

c_to_a:                          // C clear -> A = 1, else 0
    lda #0
    rol
    eor #1
    rts

// ---------------------------------------------------------------- printing
.macro PutStr(addr, str) {
    lda #<addr
    sta dst
    lda #>addr
    sta dst+1
    lda #<text
    sta src
    lda #>text
    sta src+1
    jsr puts
    jmp done
text:
    .text str
    .byte 0
done:
}

puts:
    ldy #0
!:  lda (src),y
    beq !+
    sta (dst),y
    iny
    bne !-
!:  rts

.macro At(addr) {
    lda #<addr
    sta dst
    lda #>addr
    sta dst+1
}

// hex2: A = byte, written at (dst); two screen-code digits
hex2:
    pha
    lsr
    lsr
    lsr
    lsr
    jsr hexdigit
    ldy #0
    sta (dst),y
    pla
    and #$0f
    jsr hexdigit
    ldy #1
    sta (dst),y
    rts

hexdigit:
    cmp #10
    bcc !+
    sbc #9                       // 10..15 -> screen codes 1..6, "A".."F"
    rts
!:  ora #$30                     // 0..9 -> "0".."9"
    rts

// flags4: A = P; writes N V Z C or "." for a clear bit
flags4:
    sta tmp
    ldy #0
    ldx #'N'
    asl tmp                      // bit 7
    jsr flagchar
    ldx #'V'
    asl tmp                      // bit 6
    jsr flagchar
    asl tmp                      // bit 5, unused
    asl tmp                      // bit 4, B
    asl tmp                      // bit 3, D
    asl tmp                      // bit 2, I
    ldx #'Z'
    asl tmp                      // bit 1
    jsr flagchar
    ldx #'C'
    asl tmp                      // bit 0
flagchar:
    bcs !+
    ldx #'.'
!:  txa
    sta (dst),y
    iny
    rts

// lg: A = 0 or 1; writes "L" for 1 (less), "G" for 0 (not less)
lg:
    tax
    lda #'G'
    cpx #0
    beq !+
    lda #'L'
!:  ldy #0
    sta (dst),y
    rts

// dec3: A = byte; three decimal digits at (dst), leading zeros as spaces
dec3:
    ldy #0
    ldx #'0'-1
!:  inx
    sec
    sbc #100
    bcs !-
    adc #100
    jsr decchar
    ldx #'0'-1
!:  inx
    sec
    sbc #10
    bcs !-
    adc #10
    jsr decchar
    ora #$30
    sta (dst),y
    rts
decchar:                         // X = digit char; blank while leading
    pha
    cpx #'0'
    bne !+
    cpy #2                       // the units digit is never blanked
    beq !+
    lda tmp2                     // still leading?
    beq !++
!:  stx tmp2                     // a non-zero digit ends the leading run
    txa
    sta (dst),y
    iny
    pla
    rts
!:  lda #' '
    sta (dst),y
    iny
    pla
    rts

// dec5: 16-bit value in num, five digits at (dst)
dec5:
    ldy #0
    sty tmp
    lda #<10000
    sta sub
    lda #>10000
    sta sub+1
    jsr decdiv
    lda #<1000
    sta sub
    lda #>1000
    sta sub+1
    jsr decdiv
    lda #100
    sta sub
    lda #0
    sta sub+1
    jsr decdiv
    lda #10
    sta sub
    jsr decdiv
    lda num
    ora #$30
    sta (dst),y
    rts
decdiv:                          // count how often sub goes into num
!:  lda num
    sec
    sbc sub
    tax
    lda num+1
    sbc sub+1
    bcc !+
    sta num+1
    stx num
    inc tmp
    jmp !-
!:  lda tmp
    ora #$30
    sta (dst),y
    iny
    lda #0
    sta tmp
    rts

// ---------------------------------------------------------------- tables
.macro Probe8(a, b, exp, row) {
    lda #a
    sta a8
    lda #b
    sta b8
    jsr probe8
    At(SCREEN + row*40 + 6)
    lda #a
    jsr hex2
    At(SCREEN + row*40 + 9)
    lda #b
    jsr hex2
    At(SCREEN + row*40 + 12)
    lda p_sbc
    jsr flags4
    At(SCREEN + row*40 + 17)
    lda p_fix
    jsr flags4
    At(SCREEN + row*40 + 23)
    jsr s8
    jsr n_to_a
    jsr lg
    At(SCREEN + row*40 + 27)
    jsr bmi8
    jsr n_to_a
    jsr lg
    At(SCREEN + row*40 + 31)
    lda #exp
    jsr lg
}

.macro Probe16(a, b, expu, exps, row) {
    lda #<a
    sta a_lo
    lda #>a
    sta a_hi
    lda #<b
    sta b_lo
    lda #>b
    sta b_hi
    jsr probe16
    At(SCREEN + row*40 + 6)
    lda #>a
    jsr hex2
    At(SCREEN + row*40 + 8)
    lda #<a
    jsr hex2
    At(SCREEN + row*40 + 11)
    lda #>b
    jsr hex2
    At(SCREEN + row*40 + 13)
    lda #<b
    jsr hex2
    At(SCREEN + row*40 + 16)
    lda p_cmph
    jsr flags4
    At(SCREEN + row*40 + 21)
    lda p_u16
    jsr flags4
    At(SCREEN + row*40 + 26)
    lda p_s16
    jsr flags4
    At(SCREEN + row*40 + 31)
    jsr u16
    jsr c_to_a
    jsr lg
    At(SCREEN + row*40 + 33)
    jsr s16
    jsr n_to_a
    jsr lg
    At(SCREEN + row*40 + 35)
    lda #expu
    jsr lg
    At(SCREEN + row*40 + 38)
    lda #exps
    jsr lg
}

// RunSweep(routine): patch the driver and run one 65,536-pair sweep
.macro RunSweep(routine) {
    lda #<routine
    sta pair_jsr+1
    lda #>routine
    sta pair_jsr+2
    jsr sweep
}

// Report(row, label, expect): print cs against expect, PASS or FAIL,
// and clear ok if they differ
.macro Report(row, label, expect) {
    PutStr(SCREEN + row*40, label)
    At(SCREEN + row*40 + 7)
    lda cs+1
    jsr hex2
    At(SCREEN + row*40 + 9)
    lda cs
    jsr hex2
    PutStr(SCREEN + row*40 + 12, "EXP")
    At(SCREEN + row*40 + 16)
    lda #>expect
    jsr hex2
    At(SCREEN + row*40 + 18)
    lda #<expect
    jsr hex2
    lda cs
    cmp #<expect
    bne !+
    lda cs+1
    cmp #>expect
    bne !+
    PutStr(SCREEN + row*40 + 21, "PASS")
    jmp !++
!:  PutStr(SCREEN + row*40 + 21, "FAIL")
    lda #0
    sta ok
!:
}

.macro ClearCs() {
    lda #0
    sta cs
    sta cs+1
}

// ---------------------------------------------------------------- main
start:
    lda #$93                     // clear screen through CHROUT
    jsr $ffd2
    lda #1
    sta ok
    lda #0
    sta miss
    sta miss+1
    sta tmp

    // -------- timing, interrupts off and screen blanked (no badlines)
    sei
    lda #$00
    sta $dd0e
    sta $dd0f
    lda #$ff
    sta $dd04
    sta $dd05
    sta $dd06
    sta $dd07
    lda $d011
    and #$ef
    sta $d011
!:  lda $d011
    bpl !-
!:  lda $d011
    bmi !-

    Time(nothing, empty)
    lda #$ff                     // u16, high bytes differ: $7FFF vs $8000
    sta a_lo
    lda #$7f
    sta a_hi
    lda #$00
    sta b_lo
    lda #$80
    sta b_hi
    Time(u16, t_u16d)
    Time(s16, t_s16)             // s16 on the same pair
    lda #$34                     // u16, high bytes equal: $1234 vs $1234
    sta a_lo
    sta b_lo
    lda #$12
    sta a_hi
    sta b_hi
    Time(u16, t_u16e)
    lda #$80                     // s8: -128 against 127
    sta a8
    lda #$7f
    sta b8
    Time(s8, t_s8)
    lda #100                     // rng: 100 in [90, 122)
    sta x8
    lda #90
    sta lo8
    lda #32
    sta w8
    Time(rng, t_rng)

    lda $d011
    ora #$10
    sta $d011
    cli

    Net(t_u16d)
    Net(t_u16e)
    Net(t_s8)
    Net(t_s16)
    Net(t_rng)

    // -------- boundary tables
    PutStr(SCREEN, "COMPARE 16BIT AND SIGNED")
    PutStr(SCREEN + 1*40, "8BIT  A  B  SBC  FIX  IDM NAI EXP")
    Probe8($80, $7f, 1, 2)
    Probe8($7f, $80, 0, 3)
    Probe8($00, $00, 0, 4)
    Probe8($ff, $00, 1, 5)
    Probe8($00, $ff, 0, 6)
    Probe8($80, $80, 0, 7)
    Probe8($7f, $7f, 0, 8)
    Probe8($9c, $64, 1, 9)
    PutStr(SCREEN + 10*40, "16BIT A    B    CMPH U16  S16  U S EU ES")
    Probe16($7fff, $8000, 1, 0, 11)
    Probe16($8000, $7fff, 0, 1, 12)
    Probe16($1234, $1234, 0, 0, 13)
    Probe16($0000, $ffff, 1, 0, 14)
    Probe16($ffff, $0000, 0, 1, 15)
    Probe16($0100, $00ff, 0, 0, 16)
    Probe16($00ff, $0100, 1, 1, 17)

    // -------- sweeps
    ClearCs()
    RunSweep(pair_u16a)
    RunSweep(pair_u16b)
    Report(18, "U16 CS", EXP_U16)
    ClearCs()
    RunSweep(pair_s8)
    Report(19, "S8  CS", EXP_S8)
    ClearCs()
    RunSweep(pair_s16a)
    RunSweep(pair_s16b)
    Report(20, "S16 CS", EXP_S16)
    ClearCs()
    RunSweep(pair_rng)
    Report(21, "RNG CS", EXP_RNG)
    ClearCs()
    RunSweep(pair_bmi)
    Report(22, "BMI CS", EXP_BMI)
    PutStr(SCREEN + 22*40 + 26, "WRONG")
    At(SCREEN + 22*40 + 32)
    lda miss
    sta num
    lda miss+1
    sta num+1
    jsr dec5
    lda miss
    cmp #<EXP_MISS
    bne fail_miss
    lda miss+1
    cmp #>EXP_MISS
    beq miss_ok
fail_miss:
    lda #0
    sta ok
miss_ok:

    // -------- cycle line
    PutStr(SCREEN + 23*40, "CYC U16")
    lda #0
    sta tmp2
    At(SCREEN + 23*40 + 8)
    lda t_u16d
    jsr dec3
    lda #0
    sta tmp2
    At(SCREEN + 23*40 + 12)
    lda t_u16e
    jsr dec3
    PutStr(SCREEN + 23*40 + 16, "S8")
    lda #0
    sta tmp2
    At(SCREEN + 23*40 + 19)
    lda t_s8
    jsr dec3
    PutStr(SCREEN + 23*40 + 23, "S16")
    lda #0
    sta tmp2
    At(SCREEN + 23*40 + 27)
    lda t_s16
    jsr dec3
    PutStr(SCREEN + 23*40 + 31, "RNG")
    lda #0
    sta tmp2
    At(SCREEN + 23*40 + 35)
    lda t_rng
    jsr dec3

    // -------- verdict
    lda ok
    beq fail
    lda #CODE_PASS
    sta RESULT
    lda #5
    sta BORDER
    PutStr(SCREEN + 24*40, "RESULT 01 PASS")
halt:
    jmp halt                     // stay here so BASIC's READY. does not scroll the table
fail:
    lda #CODE_FAIL
    sta RESULT
    lda #2
    sta BORDER
    PutStr(SCREEN + 24*40, "RESULT 02 FAIL")
    jmp halt

// ---------------------------------------------------------------- data
a_lo:   .byte 0
a_hi:   .byte 0
b_lo:   .byte 0
b_hi:   .byte 0
a8:     .byte 0
b8:     .byte 0
x8:     .byte 0
lo8:    .byte 0
w8:     .byte 0
p_sbc:  .byte 0
p_fix:  .byte 0
p_cmph: .byte 0
p_u16:  .byte 0
p_s16:  .byte 0
ii:     .byte 0
jj:     .byte 0
cs:     .word 0
miss:   .word 0
num:    .word 0
sub:    .word 0
tmp:    .byte 0
tmp2:   .byte 0
ok:     .byte 0
empty:  .byte 0, 0, 0
t_u16d: .byte 0, 0, 0
t_u16e: .byte 0, 0, 0
t_s8:   .byte 0, 0, 0
t_s16:  .byte 0, 0, 0
t_rng:  .byte 0, 0, 0
```

## Build

```bash
java -jar KickAss.jar compare-16bit-signed.asm -o compare-16bit-signed.prg
```

Produces `compare-16bit-signed.prg`, `$0801` to `$1B4B`.

## Expected output

Border green, text area the power-on blue, the whole screen ours (the
program ends in a loop, so BASIC never prints `READY.` over the table):

```
COMPARE 16BIT AND SIGNED
8BIT  A  B  SBC  FIX  IDM NAI EXP
      80 7F .V.C NV.C  L   G   L
      7F 80 NV.. .V..  G   L   G
      00 00 ..ZC ..ZC  G   G   G
      FF 00 N..C N..C  L   L   L
      00 FF .... ....  G   G   G
      80 80 ..ZC ..ZC  G   G   G
      7F 7F ..ZC ..ZC  G   G   G
      9C 64 .V.C NV.C  L   G   L
16BIT A    B    CMPH U16  S16  U S EU ES
      7FFF 8000 N... N... .V.. L G L  G
      8000 7FFF ...C ...C NV.C G L G  L
      1234 1234 ..ZC ..ZC ..ZC G G G  G
      0000 FFFF .... .... ..Z. L G L  G
      FFFF 0000 N..C N..C N..C G L G  L
      0100 00FF ...C ...C ..ZC G G G  G
      00FF 0100 N... N... N... L L L  L
U16 CS 6182 EXP 6182 PASS
S8  CS 73FA EXP 73FA PASS
S16 CS 27B8 EXP 27B8 PASS
RNG CS A021 EXP A021 PASS
BMI CS A3CD EXP A3CD PASS WRONG 16384
CYC U16  11  18 S8  14 S16  20 RNG  14
RESULT 01 PASS
```

Screenshots from the pinned run, 100,000,000 cycles:
`screenshots/compare-16bit-signed.png` (PAL) and
`screenshots/compare-16bit-signed-ntsc.png` (NTSC). Both decoded
against the character ROM give the text above; border pixel (2, 100)
= (98, 213, 50) on PAL and (114, 189, 103) on NTSC, index 5 in both
palettes of `runtime/vice-reference.md`. The pinned command was run
twice per model and the two PNGs were identical bytes. The sweeps take
about 90,000,000 cycles; a run limited to 64,000,000 stopped after the
`S16` line.

The columns, rows 2 to 9: `A` and `B` in hex, `P` after `SEC / SBC`
(`SBC`), `P` after the `BVC` / `EOR #$80` fix-up (`FIX`), then `L` for
"A is less than B" or `G` for "not less" from the idiom (`IDM`), from
the bare `BMI` version (`NAI`) and from the Python model (`EXP`). Rows
11 to 17: `P` after `CMP` of the high bytes alone (`CMPH`, with `V`
cleared first because `CMP` never writes it), `P` at the end of the
unsigned idiom (`U16`) and of the signed one (`S16`), then the unsigned
and signed verdicts (`U`, `S`) beside the model's (`EU`, `ES`). A flag
prints as its letter when set and `.` when clear; the order is `N V Z C`.

Every `IDM`, `U` and `S` letter matches its `EXP` column. `NAI` is
wrong on three of the eight rows: `80 7F` (-128 against 127 says "not
less"), `7F 80` (127 against -128 says "less") and `9C 64` (-100
against 100 says "not less"). Those are the rows where `SBC` set `V`.

The sweep lines: `U16` and `S16` cover 131,072 pairs each (`a = i:j`
against `b = j:i` for every `i, j`, which meets every high-byte pair
and every equal value, then `a = i:j` against `b = i:(7j + 3)` so the
low bytes decide with the high bytes equal); `S8` and `BMI` cover all
65,536 signed byte pairs; `RNG` tests every `x` against every `lo`
with a width of 32 (clamped to `256 - lo` near the top). `WRONG 16384`
is the number of pairs on which the `BMI` version and the `SBC / BVC /
EOR` idiom disagree; the model counts the same 16,384, one quarter of
all pairs, which is every pair whose difference overflows.

The `CYC` line is the cost of one call of each idiom with absolute
operands, net of an empty `JSR` / `RTS`, measured in VICE x64sc 3.10 on
both models:

| Idiom | Pair timed | Cycles | Instruction table |
|---|---|---|---|
| `U16`, high bytes differ | `$7FFF` against `$8000` | 11 | 4 + 4 + 3 (branch taken) |
| `U16`, high bytes equal | `$1234` against `$1234` | 18 | 4 + 4 + 2 + 4 + 4 |
| `S8` | `$80` against `$7F` | 14 | 4 + 2 + 4 + 2 + 2 |
| `S16` | `$7FFF` against `$8000` | 20 | 4 + 4 + 4 + 4 + 2 + 2 |
| `RNG` | 100 in `[90, 122)` | 14 | 4 + 2 + 4 + 4 |

The branch that acts on the result is not included: add 2 when it
falls through, 3 when taken, 4 taken across a page. With the operands
in zero page each absolute access is one cycle less (rung 3, not
measured here).

The first version of this program printed 19, 15 and 20 for the
second, third and fourth rows. The timer readout `LDA #$FF / SBC $DD04`
ran with whatever carry the timed routine had left, so a routine that
ended with `C` set read one cycle more than one that ended with `C`
clear. A `SEC` before the readout fixed it and the five figures now
equal the instruction-table sums.

## Why this works

### The unsigned 16-bit compare

`CMP` sets `C` when `A >= operand` and `Z` when they are equal. The
high bytes are compared first; if they differ (`BNE` taken) they decide
the order and the flags `CMP` left are the answer. If they are equal the
low bytes are compared and their flags are the answer. At the label
after the branch `C` clear means `a < b`, `C` set means `a >= b`, and
`Z` set means the two words are equal, because `Z` can only be set
there by the low-byte `CMP` after the high bytes matched. Rows 16 and
17 show the high byte deciding against the low: `$0100` against `$00FF`
leaves `C` set from the first `CMP` alone.

### The signed compares

`SBC` produces `a - b` and sets `N` from bit 7 of the result and `V`
when the true result is outside -128 to 127. When `V` is clear `N` is
the sign of `a - b`, so `N` set means `a < b`. When `V` is set the
result wrapped and `N` is the opposite of the true sign; `EOR #$80`
flips bit 7 of `A`, and since `EOR` sets `N` from its result, `N` is
the true sign again. Row 2 is the case: `$80 - $7F` is `$01`, `N`
clear, `V` set; after the fix-up `A` is `$81` and `N` is set, so -128
is less than 127. The 16-bit form does the same on the high byte with
the borrow from a `CMP` of the low bytes carried in. `Z` at the end of
the signed 16-bit idiom is the high byte's alone (row 14: `$0000`
against `$FFFF` shows `Z` set with the values unequal); test equality
with the unsigned form or a separate compare.

The bare `BMI` version is the same subtract without the fix-up. It is
right whenever `V` is clear, which is every pair whose difference fits
in a byte, and wrong on the 16,384 that do not: positives against
negatives and negatives against positives far enough apart. A game
that compares a signed velocity against a small limit will pass every
test until a value crosses the boundary, which is why the sweep counts
the misses rather than trusting a few pairs.

### The range test

`x - lo` modulo 256 is below `w` exactly when `lo <= x < lo + w`,
provided `lo + w` does not pass 256: an `x` below `lo` wraps to at
least `256 - lo`, which is at least `w`. So `SEC / SBC lo / CMP w`
leaves `C` clear for inside and set for outside, and one branch acts
on it. The two-compare form (`CMP lo / BCC out / CMP hi / BCS out`)
needs no width and no wrap condition; it is what Oscar64 emits for
`x >= lo && x < hi`, and costs 4 + 4 + 2 + 4 + 2 = 16 on the inside path
(rung 3, not measured here).

### The checksum

Each sweep result (0 or 1) is folded as `cs = rol16(cs) ^ (r ? i:j : 0)
+ 13`. A plain rotate, exclusive-or of the bit and add, as
`techniques/maths.md` uses for its add sweep, was tried first and is
weak here: with `r = 0` the map has a period of 16 from the states
these sweeps reach, and a run of 65,536 identical results, or 256
repeats of one 256-pair block, returns to its starting state. Folding
the pair in makes a single flipped result change the final value (the
model shows `RNG` moving from `$A021` to `$4389` for one flip).

### Timing

Same CIA2 cascade as `speedcode-generator.md`: timer A counts phi2,
timer B counts A underflows, the count is `$FFFFFF` less the timer
bytes. The timed calls run under `SEI` with `DEN` clear and after a
wait for the raster to wrap, so no badline lands inside a measurement
and the figures are the same on PAL and NTSC. The `SEC` before the
readout matters, see above; the same macro without it reads one cycle
high for any routine that exits with `C` set.
