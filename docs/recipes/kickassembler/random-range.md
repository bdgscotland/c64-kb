---
recipe: random-range
toolchain: kickassembler
output_format: PRG
region: both
techniques: [random_in_range, lfsr_random]
file_formats: [PRG]
uses_registers: [D011, D020, DD04, DD05, DD0E]
uses_kernal: [CHROUT]
claims: [vic_raster_irq (init), zero_page $FB-$FE (owns)]
harness: [cia2_timer_a, $02FF]
ram: [hist=$4000-$41FF]
---

<!-- doc-type: recipe -->

# KickAssembler — Random numbers in a range: modulo, multiply-high and rejection, bias counted over a whole LFSR period

## Synopsis

Turns the low byte `r` of a 16-bit LFSR into a value in `0..n-1` three
ways: `r mod n`, the high byte of `r × n`, and rejection (`r AND mask`,
drawn again while it is `n` or more). Each way runs over the LFSR's
whole period, 65,535 steps, for `n = 6` and `n = 100`. The outputs are
counted per value; the fewest and most hits per value show the bias,
and the counts are folded into a checksum that a Python model computed.
One call of each way is timed with CIA2 timer A over 4,096 calls.
`$02FF` = `$01` and a green border when every check passes; `$02FF` =
`$02` and a red border otherwise.

## Source

```asm
// random-range.asm
// Random numbers in 0..n-1 from the low byte of a 16-bit LFSR, three
// ways: r mod n, the high byte of r * n, and rejection (r AND mask,
// drawn again while it is n or more). Each method is run over the
// LFSR's whole period, 65,535 steps, for n = 6 and n = 100; the outputs
// are counted per value and the counts folded into a checksum a Python
// model computed. The fewest and most hits per value show the bias.
// One call of each method is timed with CIA2 timer A over 4,096 calls.
// $02FF = $01 and a green border when every check passes, $02FF = $02
// and a red border otherwise.

BasicUpstart2(start)
.encoding "screencode_upper"

.const SCREEN    = $0400
.const RESULT    = $02ff         // verdict byte read by the harness
.const BORDER    = $d020
.const CODE_PASS = $01
.const CODE_FAIL = $02

.const p1 = $fb                  // zero-page pointer: string source
.const p2 = $fd                  // zero-page pointer: screen destination

.const HIST_LO = $4000           // 256 16-bit counters, low and high bytes
.const HIST_HI = $4100
.const SEED    = $ace1

// ---------------------------------------------------------------- generator
// lfsr: 16-bit Galois LFSR, shifting right, taps $B400; A = low byte.
lfsr:
    lsr s_hi
    ror s_lo
    bcc !+
    lda s_hi
    eor #$b4
    sta s_hi
!:  lda s_lo
    rts

// ---------------------------------------------------------------- mapping
// Each takes r in A and returns the value in A with C clear, or C set
// when the draw is rejected.

map_mod:                         // r mod n by subtraction
    sec
!:  sbc nval
    bcs !-
    adc nval                     // one subtraction too many: add n back
    clc
    rts

map_mul:                         // (r * n) >> 8, shift and add
    sta t
    lda #0
    ldx #8
    lsr t
!:  bcc !+
    clc
    adc nval
!:  ror
    ror t
    dex
    bne !--
    clc
    rts

map_rej:                         // r AND mask; C set when it is n or more
    and mask
    cmp nval
    rts

// What a game calls: one value in 0..n-1 in A.
rnd_mod:
    jsr lfsr
    jmp map_mod

rnd_mul:
    jsr lfsr
    jmp map_mul

rnd_rej:
!:  jsr lfsr
    and mask
    cmp nval
    bcs !-                       // rejected: draw again
    rts

// ---------------------------------------------------------------- sweep
// Run the LFSR from SEED for 65,535 steps, map each low byte with the
// routine patched into sw_map, count accepted values in the histogram.
// outs = values produced, runmax = longest run of rejections.
sweep:
    lda #<SEED
    sta s_lo
    lda #>SEED
    sta s_hi
    ldx #0
    txa
!:  sta HIST_LO,x
    sta HIST_HI,x
    inx
    bne !-
    sta outs
    sta outs+1
    sta run
    sta runmax
    lda #<65535
    sta left
    lda #>65535
    sta left+1
sw_loop:
    jsr lfsr
sw_map:
    jsr $0000                    // patched: map_mod, map_mul or map_rej
    bcs sw_rej
    tax
    inc HIST_LO,x
    bne !+
    inc HIST_HI,x
!:  inc outs
    bne !+
    inc outs+1
!:  lda #0
    sta run
    jmp sw_next
sw_rej:
    inc run
    lda run
    cmp runmax
    bcc sw_next
    sta runmax
sw_next:
    lda left
    bne !+
    dec left+1
!:  dec left
    lda left
    ora left+1
    bne sw_loop
    rts

// stats: over values 0..n-1: hmin, hmax and the checksum cs of the counts
stats:
    lda #$ff
    sta hmin
    sta hmin+1
    lda #0
    sta hmax
    sta hmax+1
    sta cs
    sta cs+1
    ldx #0
st_loop:
    lda HIST_LO,x
    sta fr
    lda HIST_HI,x
    sta fr+1
    lda fr                       // hmin = min(hmin, count)
    cmp hmin
    lda fr+1
    sbc hmin+1
    bcs !+
    lda fr
    sta hmin
    lda fr+1
    sta hmin+1
!:  lda hmax                     // hmax = max(hmax, count)
    cmp fr
    lda hmax+1
    sbc fr+1
    bcs !+
    lda fr
    sta hmax
    lda fr+1
    sta hmax+1
!:  jsr fold
    inx
    cpx nval
    bne st_loop
    rts

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

// TimeMany(routine): 4,096 calls from SEED; tmin, tmax and tavg (the
// mean, rounded down) net of the empty call
.macro TimeMany(routine) {
    lda #<SEED
    sta s_lo
    lda #>SEED
    sta s_hi
    lda #$ff
    sta tmin
    sta tmin+1
    lda #0
    sta tmax
    sta tmax+1
    sta tsum
    sta tsum+1
    sta tsum+2
    sta left
    lda #$10
    sta left+1
loop:
    Time16(routine)
    jsr minmax
    clc
    lda tsum
    adc tcyc
    sta tsum
    lda tsum+1
    adc tcyc+1
    sta tsum+1
    bcc !+
    inc tsum+2
!:
    lda left
    bne !+
    dec left+1
!:  dec left
    lda left
    ora left+1
    bne loop
    sec
    lda tmin
    sbc empty
    sta tmin
    lda tmin+1
    sbc empty+1
    sta tmin+1
    sec
    lda tmax
    sbc empty
    sta tmax
    lda tmax+1
    sbc empty+1
    sta tmax+1
    ldx #4                       // tavg = tsum / 4096 - empty
!:  lsr tsum+2
    ror tsum+1
    dex
    bne !-
    sec
    lda tsum+1
    sbc empty
    sta tavg
    lda tsum+2
    sbc empty+1
    sta tavg+1
}

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

.macro Check16(from, expect) {   // clears rowok when from != expect
    lda from
    cmp #<expect
    bne !+
    lda from+1
    cmp #>expect
    beq !++
!:  lda #0
    sta rowok
!:
}

// Hist(row, label, nn, mk, map, eouts, emin, emax, ecs, erun): one
// histogram run and its line: values produced, fewest and most hits,
// checksum; every figure checked against the model.
.macro Hist(row, label, nn, mk, map, eouts, emin, emax, ecs, erun) {
    lda #nn
    sta nval
    lda #mk
    sta mask
    lda #<map
    sta sw_map+1
    lda #>map
    sta sw_map+2
    jsr sweep
    jsr stats
    PutStr(SCREEN + row*40, label)
    Dec5At(SCREEN + row*40 + 11, outs)
    Dec5At(SCREEN + row*40 + 17, hmin)
    Dec5At(SCREEN + row*40 + 23, hmax)
    At(SCREEN + row*40 + 29)
    lda cs+1
    jsr hex2
    At(SCREEN + row*40 + 31)
    lda cs
    jsr hex2
    lda #1
    sta rowok
    Check16(outs, eouts)
    Check16(hmin, emin)
    Check16(hmax, emax)
    Check16(cs, ecs)
    lda runmax
    cmp #erun
    beq !+
    lda #0
    sta rowok
!:  lda rowok
    bne !+
    PutStr(SCREEN + row*40 + 34, "BAD")
    lda #0
    sta ok
    jmp !++
!:  PutStr(SCREEN + row*40 + 34, "OK")
!:
}

// Cyc(row, label, n, mask, routine): min and max cycles of one call
.macro Cyc(row, label, nn, mk, routine) {
    lda #nn
    sta nval
    lda #mk
    sta mask
    TimeMany(routine)
    PutStr(SCREEN + row*40, label)
    Dec5At(SCREEN + row*40 + 17, tmin)
    Dec5At(SCREEN + row*40 + 23, tmax)
    Dec5At(SCREEN + row*40 + 29, tavg)
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

    PutStr(SCREEN, "RANDOM 0..N-1, 65535 LFSR STEPS")
    PutStr(SCREEN + 1*40, "N     WAY  OUTS  FEWEST MOST SUM")
    Hist(2, "N=6   MOD",   6,   7,   map_mod, 65535, 10752, 11008, $5919, 0)
    Hist(3, "N=6   MUL",   6,   7,   map_mul, 65535, 10752, 11008, $5319, 0)
    Hist(4, "N=6   REJ",   6,   7,   map_rej, 49151, 8191,  8192,  $e31a, 15)
    Hist(5, "N=100 MOD",   100, 127, map_mod, 65535, 512,   768,   $dc3c, 0)
    Hist(6, "N=100 MUL",   100, 127, map_mul, 65535, 512,   768,   $e237, 0)
    Hist(7, "N=100 REJ",   100, 127, map_rej, 51199, 511,   512,   $7e93, 15)
    PutStr(SCREEN + 8*40, "N=100 REJ, MOST REJECTED IN A ROW")
    lda runmax
    sta num
    lda #0
    sta num+1
    At(SCREEN + 8*40 + 34)
    jsr dec5

    PutStr(SCREEN + 10*40, "CYCLES, 4096 CALLS MIN   MAX   AVG")
    lda #<SEED
    sta s_lo
    lda #>SEED
    sta s_hi
    Time16(lfsr)
    sec
    lda tcyc
    sbc empty
    sta tmin
    lda tcyc+1
    sbc empty+1
    sta tmin+1
    PutStr(SCREEN + 11*40, "LFSR STEP")
    Dec5At(SCREEN + 11*40 + 17, tmin)
    Cyc(12, "N=6   MOD", 6,   7,   rnd_mod)
    Cyc(13, "N=6   MUL", 6,   7,   rnd_mul)
    Cyc(14, "N=6   REJ", 6,   7,   rnd_rej)
    Cyc(15, "N=100 MOD", 100, 127, rnd_mod)
    Cyc(16, "N=100 MUL", 100, 127, rnd_mul)
    Cyc(17, "N=100 REJ", 100, 127, rnd_rej)

    lda $d011
    ora #$10
    sta $d011
    cli

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
s_lo:   .byte 0
s_hi:   .byte 0
nval:   .byte 0
mask:   .byte 0
t:      .byte 0
outs:   .word 0
left:   .word 0
run:    .byte 0
runmax: .byte 0
hmin:   .word 0
hmax:   .word 0
cs:     .word 0
fr:     .word 0
tcyc:   .word 0
tmin:   .word 0
tmax:   .word 0
tsum:   .fill 3, 0
tavg:   .word 0
empty:  .word 0
num:    .word 0
sub:    .word 0
tmp:    .byte 0
lead:   .byte 0
ok:     .byte 0
rowok:  .byte 0
```

## Build

```bash
java -jar KickAss.jar random-range.asm -o random-range.prg
```

## Expected output

Border green, text area the power-on blue:

```
RANDOM 0..N-1, 65535 LFSR STEPS
N     WAY  OUTS  FEWEST MOST SUM
N=6   MOD  65535 10752 11008 5919 OK
N=6   MUL  65535 10752 11008 5319 OK
N=6   REJ  49151  8191  8192 E31A OK
N=100 MOD  65535   512   768 DC3C OK
N=100 MUL  65535   512   768 E237 OK
N=100 REJ  51199   511   512 7E93 OK
N=100 REJ, MOST REJECTED IN A ROW    15

CYCLES, 4096 CALLS MIN   MAX   AVG
LFSR STEP           28
N=6   MOD           48   351   198
N=6   MUL          177   226   201
N=6   REJ           41   644    60
N=100 MOD           48    71    58
N=100 MUL          177   226   201
N=100 REJ           41   575    58

RESULT 01 PASS
```

Screenshots from the pinned run, 100,000,000 cycles:
`screenshots/random-range.png` (PAL) and
`screenshots/random-range-ntsc.png` (NTSC). Both decode against the
character ROM to the text above, identical on the two models; border
pixel (2, 100) = (98, 213, 50) on PAL and (114, 189, 103) on NTSC,
index 5 in both palettes of `runtime/vice-reference.md`. The display is
blanked while the sweeps run; a run stopped at 70,000,000 cycles had
not finished them.

`OUTS` is how many values the 65,535 steps produced, `FEWEST` and
`MOST` the smallest and largest count over the `n` values, `SUM` the
counts folded into the checksum of `base-routines.md`. Every figure on
the six lines, and the 15 rejections in a row (checked for both `REJ`
lines), matches this model:

```python
M = 0xffff
def fold(cs, r):                  # cs = rol16(cs) ^ r + 13
    cs = ((cs << 1) | (cs >> 15)) & M
    return ((cs ^ r) + 13) & M
def lfsr_bytes(s, steps):         # Galois, shift right, taps $B400
    for _ in range(steps):
        c, s = s & 1, s >> 1
        if c:
            s ^= 0xB400
        yield s & 255
def run(n, way, mask):
    hist, outs, row, rowmax = [0] * n, 0, 0, 0
    for r in lfsr_bytes(0xACE1, 65535):
        if way == 'rej':
            v = r & mask
            if v >= n:
                row += 1
                rowmax = max(rowmax, row)
                continue
            row = 0
        else:
            v = r % n if way == 'mod' else (r * n) >> 8
        hist[v] += 1
        outs += 1
    cs = 0
    for h in hist:
        cs = fold(cs, h)
    return outs, min(hist), max(hist), hex(cs), rowmax
for n, mask in [(6, 7), (100, 127)]:
    for way in ('mod', 'mul', 'rej'):
        print(n, way, run(n, way, mask))
# 6 mod (65535, 10752, 11008, '0x5919', 0)
# 6 mul (65535, 10752, 11008, '0x5319', 0)
# 6 rej (49151, 8191, 8192, '0xe31a', 15)
# 100 mod (65535, 512, 768, '0xdc3c', 0)
# 100 mul (65535, 512, 768, '0xe237', 0)
# 100 rej (51199, 511, 512, '0x7e93', 15)
```

The cycle lines are one call of `rnd_mod`, `rnd_mul` or `rnd_rej`
(generator step included), net of an empty `JSR` / `RTS`, over 4,096
calls from the same seed, with interrupts off and the display blanked
(rung 1, VICE x64sc 3.10, PAL and NTSC alike). `AVG` is the mean,
rounded down. All nineteen figures equal a count of the instruction
table over the same 4,096 draws: the LFSR step is 19 or 28 cycles,
`r mod n` adds 7 per subtraction, the multiply 5 per one bit of `r`,
and each rejection one more step and 11 cycles.

## Why this works

### Why `mod` and `MUL` are uneven

A byte has 256 values. When `n` does not divide 256, the 256 cannot be
shared out evenly: `256 = 42 × 6 + 4`, so four of the six results get
43 byte values and two get 42. Any method that maps each byte to one
result has that split. `r mod n` gives the extra byte values to the
lowest results; `(r × n) >> 8` spreads them across the range. Both
lines show the same fewest and most for each `n`, 10,752 and 11,008 for
a die (the most-hit face 2.4 % more likely) and 512 and 768 for
`n = 100` (the most-hit values 50 % more likely). Only the order
differs, which is why the checksums differ.

### Rejection

`AND` with `mask = 2^k - 1`, the smallest such at least `n - 1`, keeps
`k` bits, and every `k`-bit value is equally likely. Throwing away the
values `n` and over leaves `n` equally likely ones. The counts above
differ by one only because the LFSR never produces the state 0, so
the byte 0 appears 255 times in the period instead of 256.

Each draw is accepted with probability `n / 2^k`: 6 in 8 and 100 in 128
here, so a call averages 1.33 and 1.28 steps (rung 3). The mean cost
is 60 and 58 cycles, about the same as `r mod 100` and far less than
the loop multiply; the worst is bounded only by the generator.

### The generator's runs

The worst case was 15 rejections in a row, 644 cycles for `n = 6`.
That run is the LFSR, not bad luck: one step shifts the state right by
one bit, so consecutive low bytes share seven bits, and a rejected
byte tends to be followed by another. Stepping the LFSR eight times per
byte gives bytes that share no bits, at eight times the cost (rung 3,
not measured here). For a die roll once a frame the
single step is enough; for a table filled with many draws in a row,
step more or use another generator.
