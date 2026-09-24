---
recipe: multiply-16x16
toolchain: kickassembler
output_format: PRG
region: both
techniques: [multiply_16x16, table_multiply_8x8]
file_formats: [PRG]
uses_registers: [D011, D020, DD04, DD05, DD0E]
uses_kernal: [CHROUT]
claims: [vic_raster_irq (init), zero_page $FB-$FE (owns)]
harness: [cia2_timer_a, $02FF]
---

<!-- doc-type: recipe -->

# KickAssembler — 16 × 16 multiply to a 32-bit product, from four table multiplies, timed

## Synopsis

A 16 × 16 unsigned multiply with a 32-bit product, built from four
quarter-square table multiplies (`table_multiply_8x8`) and three adds.
Five products are printed beside the values the assembler computed.
Then 65,536 operand pairs are multiplied, each call timed with CIA2
timer A, and every product folded into a checksum that a Python model
computed. The same sweep runs a copy of the routine with no carry into
the top byte and counts the pairs it gets wrong. `$02FF` = `$01` and a
green border when every check passes; `$02FF` = `$02` and a red border
otherwise.

## Source

```asm
// multiply-16x16.asm
// 16 x 16 -> 32-bit unsigned multiply from four quarter-square table
// multiplies. Five products are printed beside the values the assembler
// computed; 65,536 operand pairs are multiplied, each call timed with
// CIA2 timer A, and the products folded into a checksum a Python model
// computed. The same sweep runs a copy without the carry into the top
// byte and counts the pairs it gets wrong. $02FF = $01 and a green
// border when every check passes, $02FF = $02 and a red border otherwise.

BasicUpstart2(start)
.encoding "screencode_upper"

.const SCREEN    = $0400
.const RESULT    = $02ff         // verdict byte read by the harness
.const BORDER    = $d020
.const CODE_PASS = $01
.const CODE_FAIL = $02

.const p1 = $fb                  // zero-page pointer: string source
.const p2 = $fd                  // zero-page pointer: screen destination

// expected sweep results, from the Python model on the recipe page
.const EXP_CS   = $c275
.const EXP_LOST = 36069

// ---------------------------------------------------------------- tables
// q(n) = floor(n*n/4). sqr[i] = q(i), nsq[i] = q(|i - 255|), i = 0..511,
// each split into a low and a high table on a page boundary.
* = $2000 "tables"
sqr_lo: .fill 512, <floor(i*i/4)
sqr_hi: .fill 512, >floor(i*i/4)
nsq_lo: .fill 512, <floor((i-255)*(i-255)/4)
nsq_hi: .fill 512, >floor((i-255)*(i-255)/4)

* = $0810 "code"

// ---------------------------------------------------------------- multiply
// r0..r3 = (a_hi:a_lo) * (b_hi:b_lo). The four products share two patch
// sets: a_lo is patched into the reads of products 1 and 3, a_hi into
// products 2 and 4, then Y = b_lo and Y = b_hi index them.
//
//            a_lo*b_lo              bytes 0-1
//      a_hi*b_lo + a_lo*b_hi        bytes 1-3
//   a_hi*b_hi                       bytes 2-3
.macro Mul16(carry) {
    lda a_lo
    sta s1+1
    sta s2+1
    sta s5+1
    sta s6+1
    eor #$ff
    sta d1+1
    sta d2+1
    sta d5+1
    sta d6+1
    lda a_hi
    sta s3+1
    sta s4+1
    sta s7+1
    sta s8+1
    eor #$ff
    sta d3+1
    sta d4+1
    sta d7+1
    sta d8+1

    ldy b_lo
    sec
s1: lda sqr_lo,y                 // a_lo * b_lo
d1: sbc nsq_lo,y
    sta r0
s2: lda sqr_hi,y
d2: sbc nsq_hi,y
    sta r1
    sec
s3: lda sqr_lo,y                 // a_hi * b_lo
d3: sbc nsq_lo,y
    sta m0
s4: lda sqr_hi,y
d4: sbc nsq_hi,y
    sta m1
    ldy b_hi
    sec
s5: lda sqr_lo,y                 // a_lo * b_hi
d5: sbc nsq_lo,y
    sta n0
s6: lda sqr_hi,y
d6: sbc nsq_hi,y
    sta n1
    sec
s7: lda sqr_lo,y                 // a_hi * b_hi
d7: sbc nsq_lo,y
    sta r2
s8: lda sqr_hi,y
d8: sbc nsq_hi,y
    sta r3

    clc                          // bytes 1-3 += a_hi * b_lo
    lda r1
    adc m0
    sta r1
    lda r2
    adc m1
    sta r2
.if (carry != 0) {
    bcc !+
    inc r3
!:
}
    clc                          // bytes 1-3 += a_lo * b_hi
    lda r1
    adc n0
    sta r1
    lda r2
    adc n1
    sta r2
.if (carry != 0) {
    bcc !+
    inc r3
!:
}
    rts
}

mul16:      Mul16(1)
mul16_nc:   Mul16(0)             // the pitfall: no carry into byte 3

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

.macro SetAB(a, b) {
    lda #<a
    sta a_lo
    lda #>a
    sta a_hi
    lda #<b
    sta b_lo
    lda #>b
    sta b_hi
}

// ---------------------------------------------------------------- sweep
// For ii, jj in 0..255: a = ii:jj, b = jj:(7*ii + 3) mod 256. Each call
// is timed; min and max keep the extremes. The product is folded into
// cs; the carry-less copy runs on the same pair and bad counts the
// pairs whose byte 3 differs.
sweep:
    lda #0
    sta ii
!outer:
    lda #0
    sta jj
!inner:
    lda ii
    sta a_hi
    lda jj
    sta a_lo
    sta b_hi
    lda ii
    asl
    asl
    asl
    sec
    sbc ii
    clc
    adc #3
    sta b_lo
    Time16(mul16)
    lda tcyc                     // min = min(min, tcyc)
    cmp tmin
    lda tcyc+1
    sbc tmin+1
    bcs !+
    lda tcyc
    sta tmin
    lda tcyc+1
    sta tmin+1
!:  lda tmax                     // max = max(max, tcyc)
    cmp tcyc
    lda tmax+1
    sbc tcyc+1
    bcs !+
    lda tcyc
    sta tmax
    lda tcyc+1
    sta tmax+1
!:  lda r0
    sta fr
    lda r1
    sta fr+1
    jsr fold
    lda r2
    sta fr
    lda r3
    sta fr+1
    jsr fold
    lda r3
    pha
    jsr mul16_nc
    pla
    cmp r3
    beq !+
    inc bad
    bne !+
    inc bad+1
!:  inc jj
    beq !+
    jmp !inner-
!:  inc ii
    beq !+
    jmp !outer-
!:  rts

// fold: cs = rol16(cs) ^ fr + 13
fold:
    asl cs
    rol cs+1
    bcc !+
    inc cs
!:  lda cs
    eor fr
    sta cs
    lda cs+1
    eor fr+1
    sta cs+1
    clc
    lda cs
    adc #13
    sta cs
    bcc !+
    inc cs+1
!:  rts

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

// Hex8(addr, from): four bytes, high first, as eight hex digits at addr
.macro Hex8(addr, from) {
.for (var k = 0; k < 4; k++) {
    At(addr + k*2)
    lda from + 3 - k
    jsr hex2
}
}

// Product(row, a, b): print a, b, the routine's product and the
// assembler's; a mismatch clears ok.
.macro Product(row, a, b) {
    .var p = a * b
    SetAB(a, b)
    jsr mul16
    At(SCREEN + row*40)
    lda #>a
    jsr hex2
    At(SCREEN + row*40 + 2)
    lda #<a
    jsr hex2
    PutStr(SCREEN + row*40 + 5, "X")
    At(SCREEN + row*40 + 7)
    lda #>b
    jsr hex2
    At(SCREEN + row*40 + 9)
    lda #<b
    jsr hex2
    Hex8(SCREEN + row*40 + 13, r0)
    lda r0
    cmp #[p & $ff]
    bne !+
    lda r1
    cmp #[[p >> 8] & $ff]
    bne !+
    lda r2
    cmp #[[p >> 16] & $ff]
    bne !+
    lda r3
    cmp #[[p >> 24] & $ff]
    bne !+
    PutStr(SCREEN + row*40 + 23, "OK")
    jmp !++
!:  PutStr(SCREEN + row*40 + 23, "BAD")
    lda #0
    sta ok
!:
}

// Cycles(row, label, from): label and the 16-bit count net of the
// empty call, in decimal at column 20
.macro Cycles(row, label, from) {
    PutStr(SCREEN + row*40, label)
    sec
    lda from
    sbc empty
    sta num
    lda from+1
    sbc empty+1
    sta num+1
    At(SCREEN + row*40 + 20)
    jsr dec5
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
    SetAB(0, 0)                  // no page crossed, no carry
    Time16(mul16)
    lda tcyc
    sta t_zero
    lda tcyc+1
    sta t_zero+1
    SetAB($8a80, $f3ff)          // 16 page crossings, both carries
    Time16(mul16)
    lda tcyc
    sta t_worst
    lda tcyc+1
    sta t_worst+1

    lda #$ff
    sta tmin
    sta tmin+1
    lda #0
    sta tmax
    sta tmax+1
    sta cs
    sta cs+1
    sta bad
    sta bad+1
    jsr sweep

    lda $d011
    ora #$10
    sta $d011
    cli

    PutStr(SCREEN, "MUL16 16X16=32, QUARTER SQUARES")
    PutStr(SCREEN + 1*40, "A    X B       PRODUCT")
    Product(2, $1234, $5678)
    Product(3, $ffff, $ffff)
    Product(4, $8000, $8000)
    Product(5, $8a80, $f3ff)
    Product(6, $00ff, $0101)

    PutStr(SCREEN + 8*40, "CYCLES, NET OF JSR/RTS")
    Cycles(9,  "0 X 0", t_zero)
    Cycles(10, "8A80 X F3FF", t_worst)
    Cycles(11, "SWEEP MIN", tmin)
    Cycles(12, "SWEEP MAX", tmax)

    PutStr(SCREEN + 14*40, "SWEEP 65536 PAIRS")
    PutStr(SCREEN + 15*40, "CHECKSUM")
    At(SCREEN + 15*40 + 20)
    lda cs+1
    jsr hex2
    At(SCREEN + 15*40 + 22)
    lda cs
    jsr hex2
    lda cs
    cmp #<EXP_CS
    bne !+
    lda cs+1
    cmp #>EXP_CS
    bne !+
    PutStr(SCREEN + 15*40 + 26, "OK")
    jmp !++
!:  PutStr(SCREEN + 15*40 + 26, "BAD")
    lda #0
    sta ok
!:
    PutStr(SCREEN + 16*40, "NO TOP CARRY, WRONG")
    lda bad
    sta num
    lda bad+1
    sta num+1
    At(SCREEN + 16*40 + 20)
    jsr dec5
    lda bad
    cmp #<EXP_LOST
    bne !+
    lda bad+1
    cmp #>EXP_LOST
    bne !+
    PutStr(SCREEN + 16*40 + 26, "OK")
    jmp !++
!:  PutStr(SCREEN + 16*40 + 26, "BAD")
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
a_lo:   .byte 0
a_hi:   .byte 0
b_lo:   .byte 0
b_hi:   .byte 0
r0:     .byte 0
r1:     .byte 0
r2:     .byte 0
r3:     .byte 0
m0:     .byte 0
m1:     .byte 0
n0:     .byte 0
n1:     .byte 0
ii:     .byte 0
jj:     .byte 0
cs:     .word 0
fr:     .word 0
bad:    .word 0
tcyc:   .word 0
tmin:   .word 0
tmax:   .word 0
empty:  .word 0
t_zero: .word 0
t_worst: .word 0
num:    .word 0
sub:    .word 0
tmp:    .byte 0
lead:   .byte 0
ok:     .byte 0
```

## Build

```bash
java -jar KickAss.jar multiply-16x16.asm -o multiply-16x16.prg
```

Produces `multiply-16x16.prg`, `$0801` to `$27FF`: the program at
`$0810` to `$1400` and the four 512-byte tables at `$2000` to `$27FF`.

## Expected output

Border green, text area the power-on blue:

```
MUL16 16X16=32, QUARTER SQUARES
A    X B       PRODUCT
1234 X 5678  06260060  OK
FFFF X FFFF  FFFE0001  OK
8000 X 8000  40000000  OK
8A80 X F3FF  84017580  OK
00FF X 0101  0000FFFF  OK

CYCLES, NET OF JSR/RTS
0 X 0                 246
8A80 X F3FF           272
SWEEP MIN             246
SWEEP MAX             270

SWEEP 65536 PAIRS
CHECKSUM            C275  OK
NO TOP CARRY, WRONG 36069 OK

RESULT 01 PASS
```

Screenshots from the pinned run, 60,000,000 cycles:
`screenshots/multiply-16x16.png` (PAL) and
`screenshots/multiply-16x16-ntsc.png` (NTSC). Both decode against the
character ROM to the text above, identical on the two models; border
pixel (2, 100) = (98, 213, 50) on PAL and (114, 189, 103) on NTSC,
index 5 in both palettes of `runtime/vice-reference.md`. The sweep runs
with the display blanked; a run stopped at 40,000,000 cycles had not
finished it.

Cycles are one call, net of an empty `JSR` / `RTS`, with interrupts off
and the display blanked, so no badline lands inside a call (rung 1,
VICE x64sc 3.10, PAL and NTSC alike). The 246 for `0 × 0` is the
instruction-table sum:

| Part | Cycles |
|---|---|
| patch `a_lo` and `a_hi` into 16 operand bytes: 2 loads, 2 `EOR #`, 16 stores | 76 |
| `LDY` twice, `SEC` four times, 16 indexed reads, 8 stores | 112 |
| two 16-bit adds of the middle products, each with its `BCC` taken | 58 |
| total | 246 |

Each indexed read costs one more cycle when it crosses a page: a read
of `sqr` when `a + Y` passes 255, a read of `nsq` when `Y` is greater
than `a`. Each carry into the top byte costs 5 more (`BCC` not taken
and `INC`). The largest is 246 + 16 + 10 = 272: `8A80 × F3FF` crosses
on all sixteen reads and carries twice, and measures 272. The sweep's
pairs spread from 246 to 270.

The sweep: `a = i:j`, `b = j:(7i + 3)` for every `i, j`, as in
`base-routines.md`. Each 32-bit product is folded into the checksum as
its low word, then its high word. The carry-less copy is run on each
pair after the checked one and its top byte compared; it is wrong on
36,069 of the 65,536 pairs (`pitfalls/maths.md`,
`multiply_16x16_middle_carry_dropped`). The model:

```python
M = 0xffff
def fold(cs, r):                  # cs = rol16(cs) ^ r + 13
    cs = ((cs << 1) | (cs >> 15)) & M
    return ((cs ^ r) + 13) & M
cs = lost = 0
for i in range(256):
    for j in range(256):
        a, b = (i << 8) | j, (j << 8) | ((i * 7 + 3) & 255)
        p = a * b
        cs = fold(fold(cs, p & M), p >> 16)
        al, ah, bl, bh = a & 255, a >> 8, b & 255, b >> 8
        ll, hl, lh = al * bl, ah * bl, al * bh
        s = (ll >> 8) + (hl & 255) + ((hl >> 8) + (ah * bh & 255)) * 256
        s2 = (s & M) + lh
        lost += (s >> 16) | (s2 >> 16) > 0   # a carry out of byte 2
print(hex(cs), lost)                         # 0xc275 36069
```

## Why this works

Split each operand into bytes: `a = 256·ah + al`, `b = 256·bh + bl`.
Then `a·b = al·bl + 256·(ah·bl + al·bh) + 65536·ah·bh`. Each of the
four byte products is one quarter-square lookup, `q(x + y) - q(|x - y|)`
with `q(n) = floor(n²/4)` (`techniques/maths.md`, `table_multiply_8x8`).
`al·bl` fills bytes 0 and 1 and `ah·bh` bytes 2 and 3 directly; the two
middle products are added in at byte 1.

Patching is shared. `a_lo` goes into the low address byte of the reads
for `al·bl` and `al·bh`, `a_hi` into those for `ah·bl` and `ah·bh`, then
`Y = bl` indexes the first pair and `Y = bh` the second. The four
products then cost 76 + 112 = 188 cycles. Four calls of the 52-cycle
8 × 8 routine would cost 208, and 48 more for their `JSR` and `RTS`
(rung 3). The tables start on page
boundaries so the patch is one byte; `.fill` builds them at assembly
time here, 2,048 bytes.

Each middle add runs over bytes 1 and 2 and its carry out of byte 2
belongs in byte 3. The two middle products sum to at most
2 × 255 × 255, which does not fit in 16 bits, so the carry is real.
Leave out the `INC r3` and the product is short by 2²⁴ for each carry:
wrong on 36,069 of the sweep's pairs, and right on the small operands a
first test tends to use (`00FF × 0101` carries nothing).
