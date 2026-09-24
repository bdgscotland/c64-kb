---
recipe: multiply-constant
toolchain: kickassembler
output_format: PRG
region: both
techniques: [multiply_by_constant]
file_formats: [PRG]
uses_registers: [D011, D020, DD04, DD05, DD0E]
uses_kernal: [CHROUT]
claims: [vic_raster_irq (init), zero_page $FB-$FE (owns)]
harness: [cia2_timer_a, $02FF]
---

<!-- doc-type: recipe -->

# KickAssembler — Multiply by a constant with shifts and adds, every input checked and timed

## Synopsis

Five shift-and-add chains: `x × 10` of an unsigned byte and of a signed
byte, `row × 40` for a screen-row offset, `y × 320` for a bitmap-row
offset, and `x × 7` of a 16-bit word as `8x - x`. Every input each
routine accepts is run, each call timed with CIA2 timer A, and the
results folded into a checksum that a Python model computed. A signed
`× 10` that leaves the high byte at zero is run on all 256 bytes and
its wrong results counted. `$02FF` = `$01` and a green border when
every check passes; `$02FF` = `$02` and a red border otherwise.

## Source

```asm
// multiply-constant.asm
// Multiply by a constant with shifts and adds: x*10 of an unsigned and
// of a signed byte, row*40, y*320 and x*7 of a 16-bit word. Every input
// of each routine is run, each call timed with CIA2 timer A, and the
// results folded into a checksum a Python model computed. A signed x*10
// that forgets to sign-extend is run on all 256 bytes and its wrong
// results counted. $02FF = $01 and a green border when every check
// passes, $02FF = $02 and a red border otherwise.

BasicUpstart2(start)
.encoding "screencode_upper"

.const SCREEN    = $0400
.const RESULT    = $02ff         // verdict byte read by the harness
.const BORDER    = $d020
.const CODE_PASS = $01
.const CODE_FAIL = $02

.const p1 = $fb                  // zero-page pointer: string source
.const p2 = $fd                  // zero-page pointer: screen destination

// expected checksums, from the Python model on the recipe page
.const EXP_U10  = $2aad
.const EXP_S10  = $fe9e
.const EXP_R40  = $2f4d
.const EXP_Y320 = $3522
.const EXP_W7   = $41a8
.const EXP_ZX   = 128

// ---------------------------------------------------------------- routines
// Input in x_lo (and x_hi), result in m_hi:m_lo.

u10:                             // 10x = (4x + x) * 2, x unsigned
    lda #0
    sta m_hi
    lda x_lo
    asl
    rol m_hi
    asl
    rol m_hi                     // 4x; C clear, m_hi was below $80
    adc x_lo
    bcc !+
    inc m_hi                     // 5x
!:  asl
    rol m_hi                     // 10x
    sta m_lo
    rts

s10:                             // 10x, x signed: extend the sign first
    ldx #0
    lda x_lo
    bpl !+
    dex                          // X = $FF for a negative x
!:  stx m_hi
    stx sx                       // x as 16 bits: sx:x_lo
    asl
    rol m_hi
    asl
    rol m_hi                     // 4x
    clc
    adc x_lo
    sta m_lo
    lda m_hi
    adc sx
    sta m_hi                     // 5x
    asl m_lo
    rol m_hi                     // 10x
    rts

s10_zx:                          // the pitfall: the high byte left at 0
    ldx #0
    lda x_lo
    stx m_hi
    stx sx
    asl
    rol m_hi
    asl
    rol m_hi
    clc
    adc x_lo
    sta m_lo
    lda m_hi
    adc sx
    sta m_hi
    asl m_lo
    rol m_hi
    rts

r40:                             // row*40 = (4 row + row) * 8, row < 52
    lda #0
    sta m_hi
    lda x_lo
    asl
    asl                          // C clear: row < 64
    adc x_lo                     // 5 row fits a byte
    asl
    rol m_hi
    asl
    rol m_hi
    asl
    rol m_hi
    sta m_lo
    rts

y320:                            // y*320 = y*256 + y*64, y < 205
    lda #0
    sta m_lo
    lda x_lo
    lsr
    ror m_lo
    lsr
    ror m_lo                     // A = y >> 2, m_lo = (y & 3) << 6: y*64
    clc
    adc x_lo                     // + y*256
    sta m_hi
    rts

w7:                              // 7x = 8x - x, 16 bits, modulo 65536
    lda x_lo
    asl
    sta m_lo
    lda x_hi
    rol
    asl m_lo
    rol
    asl m_lo
    rol
    sta m_hi                     // 8x
    sec
    lda m_lo
    sbc x_lo
    sta m_lo
    lda m_hi
    sbc x_hi
    sta m_hi                     // 8x - x
    rts

// ---------------------------------------------------------------- timing
// Time16(routine): CIA2 timer A counts phi2 from $FFFF; tcyc = cycles
// from the start store to the stop store, the JSR / RTS included.
.macro Time16(routine) {
    lda #$11
    sta $dd0e
    jsr routine
    lda #$00
    sta $dd0e
    sec
    lda #$ff
    sbc $dd04
    sta tcyc
    lda #$ff
    sbc $dd05
    sta tcyc+1
}

nothing:
    rts

// minmax: tmin = min(tmin, tcyc), tmax = max(tmax, tcyc)
minmax:
    lda tcyc
    cmp tmin
    lda tcyc+1
    sbc tmin+1
    bcs !+
    lda tcyc
    sta tmin
    lda tcyc+1
    sta tmin+1
!:  lda tmax
    cmp tcyc
    lda tmax+1
    sbc tcyc+1
    bcs !+
    lda tcyc
    sta tmax
    lda tcyc+1
    sta tmax+1
!:  rts

// fold: cs = rol16(cs) ^ m + 13
fold:
    asl cs
    rol cs+1
    bcc !+
    inc cs
!:  lda cs
    eor m_lo
    sta cs
    lda cs+1
    eor m_hi
    sta cs+1
    clc
    lda cs
    adc #13
    sta cs
    bcc !+
    inc cs+1
!:  rts

reset:                           // cs = 0, tmin = $FFFF, tmax = 0, x = 0
    lda #0
    sta cs
    sta cs+1
    sta tmax
    sta tmax+1
    sta x_lo
    sta x_hi
    lda #$ff
    sta tmin
    sta tmin+1
    rts

// Sweep8(routine, n, slot): x_lo = 0 .. n-1 (n = 0 runs 256); each
// call timed and folded; slot gets cs, min, max.
.macro Sweep8(routine, n, slot) {
    jsr reset
loop:
    Time16(routine)
    jsr minmax
    jsr fold
    inc x_lo
    lda x_lo
    cmp #[n & $ff]
    bne loop
    jsr keep
    .for (var k = 0; k < 6; k++) {
        lda kept + k
        sta slot + k
    }
}

keep:                            // kept = cs, tmin - empty, tmax - empty
    lda cs
    sta kept
    lda cs+1
    sta kept+1
    sec
    lda tmin
    sbc empty
    sta kept+2
    lda tmin+1
    sbc empty+1
    sta kept+3
    sec
    lda tmax
    sbc empty
    sta kept+4
    lda tmax+1
    sbc empty+1
    sta kept+5
    rts

// ---------------------------------------------------------------- printing
.macro PutStr(addr, str) {
    lda #<addr
    sta p2
    lda #>addr
    sta p2+1
    lda #<text
    sta p1
    lda #>text
    sta p1+1
    jsr puts
    jmp done
text:
    .text str
    .byte 0
done:
}

puts:
    ldy #0
!:  lda (p1),y
    beq !+
    sta (p2),y
    iny
    bne !-
!:  rts

.macro At(addr) {
    lda #<addr
    sta p2
    lda #>addr
    sta p2+1
}

hex2:                            // A = byte, two hex digits at (p2)
    pha
    lsr
    lsr
    lsr
    lsr
    jsr hexdigit
    ldy #0
    sta (p2),y
    pla
    and #$0f
    jsr hexdigit
    ldy #1
    sta (p2),y
    rts

hexdigit:
    cmp #10
    bcc !+
    sbc #9                       // 10..15 -> screen codes 1..6, "A".."F"
    rts
!:  ora #$30
    rts

// dec5: 16-bit num, five digits at (p2), leading zeros as spaces
dec5:
    ldy #0
    sty lead
    lda #<10000
    ldx #>10000
    jsr decdiv
    lda #<1000
    ldx #>1000
    jsr decdiv
    lda #100
    ldx #0
    jsr decdiv
    lda #10
    ldx #0
    jsr decdiv
    lda num
    ora #$30
    sta (p2),y
    rts
decdiv:                          // count how often X:A goes into num
    sta sub
    stx sub+1
    lda #0
    sta tmp
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
    ora lead
    bne !+
    lda #' '
    sta (p2),y
    iny
    rts
!:  lda tmp
    ora #$30
    sta (p2),y
    sta lead
    iny
    rts

.macro Dec5At(addr, from) {
    lda from
    sta num
    lda from+1
    sta num+1
    At(addr)
    jsr dec5
}

// Row(row, label, slot, expect): label, checksum, min and max cycles,
// OK or BAD against the model's checksum; a mismatch clears ok.
.macro Row(row, label, slot, expect) {
    PutStr(SCREEN + row*40, label)
    At(SCREEN + row*40 + 16)
    lda slot+1
    jsr hex2
    At(SCREEN + row*40 + 18)
    lda slot
    jsr hex2
    Dec5At(SCREEN + row*40 + 21, slot+2)
    Dec5At(SCREEN + row*40 + 27, slot+4)
    lda slot
    cmp #<expect
    bne !+
    lda slot+1
    cmp #>expect
    bne !+
    PutStr(SCREEN + row*40 + 34, "OK")
    jmp !++
!:  PutStr(SCREEN + row*40 + 34, "BAD")
    lda #0
    sta ok
!:
}

// ---------------------------------------------------------------- main
start:
    lda #$93                     // clear screen through CHROUT
    jsr $ffd2
    lda #1
    sta ok

    // interrupts off and screen blanked: no badline inside a timed call
    sei
    lda #$00
    sta $dd0e
    lda #$ff
    sta $dd04
    sta $dd05
    lda $d011
    and #$ef
    sta $d011
!:  lda $d011
    bpl !-
!:  lda $d011
    bmi !-

    Time16(nothing)
    lda tcyc
    sta empty
    lda tcyc+1
    sta empty+1

    Sweep8(u10, 256, k_u10)
    Sweep8(s10, 256, k_s10)
    Sweep8(r40, 25, k_r40)
    Sweep8(y320, 200, k_y320)

    // x*7 over every 16-bit word
    jsr reset
!loop:
    Time16(w7)
    jsr minmax
    jsr fold
    inc x_lo
    bne !loop-
    inc x_hi
    bne !loop-
    jsr keep
    .for (var k = 0; k < 6; k++) {
        lda kept + k
        sta k_w7 + k
    }

    // the pitfall: zero-extended signed x*10 against the right one
    lda #0
    sta x_lo
    sta bad
    sta bad+1
!loop:
    jsr s10
    lda m_lo
    sta good
    lda m_hi
    sta good+1
    jsr s10_zx
    lda m_lo
    cmp good
    bne !miss+
    lda m_hi
    cmp good+1
    beq !next+
!miss:
    inc bad
    bne !next+
    inc bad+1
!next:
    inc x_lo
    bne !loop-

    lda $d011
    ora #$10
    sta $d011
    cli

    PutStr(SCREEN, "MULTIPLY BY A CONSTANT, SHIFT AND ADD")
    PutStr(SCREEN + 2*40, "ROUTINE  INPUTS  SUM    MIN   MAX")
    Row(3, "X10 U8   0-255",  k_u10,  EXP_U10)
    Row(4, "X10 S8   0-255",  k_s10,  EXP_S10)
    Row(5, "X40      0-24",   k_r40,  EXP_R40)
    Row(6, "X320     0-199",  k_y320, EXP_Y320)
    Row(7, "X7 U16   0-FFFF", k_w7,   EXP_W7)

    PutStr(SCREEN + 9*40, "X10 S8 NOT EXTENDED, WRONG")
    Dec5At(SCREEN + 9*40 + 27, bad)
    lda bad
    cmp #<EXP_ZX
    bne !+
    lda bad+1
    cmp #>EXP_ZX
    bne !+
    PutStr(SCREEN + 9*40 + 34, "OK")
    jmp !++
!:  PutStr(SCREEN + 9*40 + 34, "BAD")
    lda #0
    sta ok
!:

    // -------- verdict
    lda ok
    beq fail
    lda #CODE_PASS
    sta RESULT
    lda #5
    sta BORDER
    PutStr(SCREEN + 24*40, "RESULT 01 PASS")
halt:
    jmp halt
fail:
    lda #CODE_FAIL
    sta RESULT
    lda #2
    sta BORDER
    PutStr(SCREEN + 24*40, "RESULT 02 FAIL")
    jmp halt

// ---------------------------------------------------------------- data
x_lo:   .byte 0
x_hi:   .byte 0
sx:     .byte 0
m_lo:   .byte 0
m_hi:   .byte 0
cs:     .word 0
tcyc:   .word 0
tmin:   .word 0
tmax:   .word 0
empty:  .word 0
kept:   .fill 6, 0
k_u10:  .fill 6, 0
k_s10:  .fill 6, 0
k_r40:  .fill 6, 0
k_y320: .fill 6, 0
k_w7:   .fill 6, 0
good:   .word 0
bad:    .word 0
num:    .word 0
sub:    .word 0
tmp:    .byte 0
lead:   .byte 0
ok:     .byte 0
```

## Build

```bash
java -jar KickAss.jar multiply-constant.asm -o multiply-constant.prg
```

## Expected output

Border green, text area the power-on blue:

```
MULTIPLY BY A CONSTANT, SHIFT AND ADD

ROUTINE  INPUTS  SUM    MIN   MAX
X10 U8   0-255  2AAD    45    50  OK
X10 S8   0-255  FE9E    67    68  OK
X40      0-24   2F4D    46    46  OK
X320     0-199  3522    36    36  OK
X7 U16   0-FFFF 41A8    62    62  OK

X10 S8 NOT EXTENDED, WRONG   128  OK

RESULT 01 PASS
```

Screenshots from the pinned run, 20,000,000 cycles:
`screenshots/multiply-constant.png` (PAL) and
`screenshots/multiply-constant-ntsc.png` (NTSC). Both decode against
the character ROM to the text above, identical on the two models;
border pixel (2, 100) = (98, 213, 50) on PAL and (114, 189, 103) on
NTSC, index 5 in both palettes of `runtime/vice-reference.md`. A run
stopped at 8,000,000 cycles was still in the sweeps.

`MIN` and `MAX` are one call, net of an empty `JSR` / `RTS`, with
interrupts off and the display blanked (rung 1, VICE x64sc 3.10, PAL and
NTSC alike). Each equals its instruction-table sum:

| Routine | Cycles | Where they vary |
|---|---|---|
| `x × 10`, unsigned | 45, 50 | 50 when the low byte of `4x`, plus `x`, passes 255 and the `INC` runs |
| `x × 10`, signed | 67, 68 | 68 when `x` is negative and the `DEX` runs |
| `row × 40` | 46 | no branch |
| `y × 320` | 36 | no branch |
| `x × 7`, 16-bit | 62 | no branch |

`SUM` is each routine's results, in input order, folded into the
checksum of `base-routines.md`. The model:

```python
M = 0xffff
def fold(cs, r):                  # cs = rol16(cs) ^ r + 13
    cs = ((cs << 1) | (cs >> 15)) & M
    return ((cs ^ r) + 13) & M
def run(inputs, f):
    cs = 0
    for x in inputs:
        cs = fold(cs, f(x) & M)
    return cs
s8 = lambda x: x - 256 if x > 127 else x
print(hex(run(range(256), lambda x: 10 * x)))       # 0x2aad
print(hex(run(range(256), lambda x: 10 * s8(x))))   # 0xfe9e
print(hex(run(range(25), lambda x: 40 * x)))        # 0x2f4d
print(hex(run(range(200), lambda x: 320 * x)))      # 0x3522
print(hex(run(range(65536), lambda x: 7 * x)))      # 0x41a8
print(sum((10 * x) & M != (10 * s8(x)) & M for x in range(256)))  # 128
```

`NOT EXTENDED` runs the signed routine with its high byte started at
zero, the unsigned form, on every byte and compares it with the right
one. It is wrong on all 128 negative inputs, each by 2,560 (`10 × 256`),
and right on all 128 others (`pitfalls/maths.md`,
`constant_multiply_signed_not_extended`).

## Why this works

A constant is a sum of powers of two, so `x × k` is a sum of shifted
copies of `x`: `10 = 8 + 2`, taken here as `(4 + 1) × 2` so that the
one add is of `x` itself, a byte, and no copy of `2x` is kept. `7 = 8 - 1` is one subtract where `4 + 2 + 1`
would be two adds. Every left shift of a result wider than a byte is
`ASL` on the low byte and `ROL` on the high, so the bit leaving the low
byte enters the high one.

Where the result of a step fits in a byte, the high byte can wait.
`row × 5` is at most 120 for 25 rows, so `row × 40` does its first two
shifts and the add in `A` alone and starts the `ROL`s only for the last
three, 46 cycles. `y × 320 = y × 256 + y × 64`: the `× 256` is free (it
is `y` in the high byte), and `y × 64` is `y × 256` shifted right twice,
two `LSR` / `ROR` pairs instead of six left shifts. At 36 cycles it is
the cheapest of the five.

A carry left by a shift is part of the next add. After `ASL` / `ROL`,
`C` is the bit that left the high byte; in `x × 10` unsigned that is 0,
because the high byte was below `$80`, so the `ADC` needs no `CLC`. In
the signed routine the high byte is `$FF` for a negative `x`, `C` comes
out set, and the `CLC` is needed.

A signed input must be widened by its sign before the first shift: the
high byte starts at `$FF` when bit 7 of `x` is set. Left at zero, `x`
is read as `x + 256` and the product is `256 × 10` too large, modulo
65,536.
