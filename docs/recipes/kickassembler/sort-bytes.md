---
recipe: sort-bytes
toolchain: kickassembler
output_format: PRG
region: both
techniques: [byte_list_sort]
file_formats: [PRG]
uses_registers: [D011, D020, DD04, DD05, DD06, DD07, DD0E, DD0F]
uses_kernal: [CHROUT]
claims: [vic_raster_irq (init), zero_page $FB-$FE (owns)]
harness: [cia2_timer_a, cia2_timer_b, $02FF]
ram: [lists=$4000-$45FF]
---

<!-- doc-type: recipe -->

# KickAssembler — Sort a list of byte keys: insertion sort and counting sort, cost against list length

## Synopsis

Sorts a list of byte keys, each carrying an index, two ways: insertion
sort in place, and a counting sort through 256 buckets. Lists of 8,
16, 32, 64, 128 and 255 keys, in random order, already sorted and
reversed, are timed with the CIA2 timer A / B cascade. Every sorted
list is folded into a checksum that a Python model of a stable sort
computed, so a match proves the order, the indexes and the stability.
A list of signed keys is sorted with an `EOR #$80` compare and with
`SBC` / `BMI`, and the neighbours left out of order counted. `$02FF` =
`$01` and a green border when every check passes; `$02FF` = `$02` and
a red border otherwise.

## Source

```asm
// sort-bytes.asm
// Sort a list of byte keys, each carrying an index, two ways: insertion
// sort in place, and a counting sort through 256 buckets. Lists of 8 to
// 255 keys, random, already sorted and reversed, are timed with the
// CIA2 timer A / B cascade; every result is folded into a checksum a
// Python model computed, which also proves each sort stable. A signed
// list is sorted with an EOR #$80 compare and with SBC / BMI, and the
// pairs left out of order counted. $02FF = $01 and a green border when
// every check passes, $02FF = $02 and a red border otherwise.

BasicUpstart2(start)
.encoding "screencode_upper"

.const SCREEN    = $0400
.const RESULT    = $02ff         // verdict byte read by the harness
.const BORDER    = $d020
.const CODE_PASS = $01
.const CODE_FAIL = $02

.const p1 = $fb                  // zero-page pointer: string source
.const p2 = $fd                  // zero-page pointer: screen destination

// KEY and IDX start one byte into a page, so KEY-1,Y and KEY,Y stay in
// one page for Y = 1..254 and no indexed read pays a page crossing.
.const KEY  = $4001              // the list: keys
.const IDX  = $4101              // the list: indexes, 0..n-1 before the sort
.const OUTK = $4200              // counting sort output: keys
.const OUTI = $4300              // counting sort output: indexes
.const CNT  = $4400              // 256 bucket counts
.const POS  = $4500              // 256 bucket positions
.const SEED = $ace1

// expected checksums, from the Python model on the recipe page
.const EXP_RAND   = $f7c0
.const EXP_SORTED = $a2b4
.const EXP_REV    = $5d03
.const EXP_BAD    = 7            // SBC / BMI: adjacent pairs out of order

// ---------------------------------------------------------------- sorts
// isort: insertion sort of KEY / IDX, n = nn (2..255), ascending,
// unsigned. Stable: a key moves only past strictly greater ones.
isort:
    ldx #1
is_outer:
    lda KEY,x
    sta kt
    lda IDX,x
    sta it
    txa
    tay                          // Y = j = i
is_inner:
    lda KEY-1,y
    cmp kt
    bcc is_place                 // key[j-1] < kt
    beq is_place                 // key[j-1] = kt: keep the order
    sta KEY,y                    // key[j-1] > kt: move it up one
    lda IDX-1,y
    sta IDX,y
    dey
    bne is_inner
is_place:
    lda kt
    sta KEY,y
    lda it
    sta IDX,y
    inx
    cpx nn
    bne is_outer
    rts

// csort: counting sort of KEY / IDX into OUTK / OUTI, n = nn (1..255).
// Count each key, turn the counts into first positions, then place the
// entries in list order, so equal keys keep their order.
csort:
    ldx #0
    txa
!:  sta CNT,x
    inx
    bne !-
    ldy #0
!:  ldx KEY,y                    // count
    inc CNT,x
    iny
    cpy nn
    bne !-
    ldx #0                       // POS[v] = number of keys below v
    lda #0
!:  sta POS,x
    clc
    adc CNT,x
    inx
    bne !-
    ldy #0
!:  lda KEY,y                    // place
    sta kt
    tax
    lda POS,x
    inc POS,x
    tax
    lda kt
    sta OUTK,x
    lda IDX,y
    sta OUTI,x
    iny
    cpy nn
    bne !-
    rts

// Signed keys, two compares in the same insertion sort.
// ssort_eor: flip bit 7 of both sides, then compare unsigned.
ssort_eor:
    ldx #1
se_outer:
    lda KEY,x
    sta kt
    eor #$80
    sta kt80
    lda IDX,x
    sta it
    txa
    tay
se_inner:
    lda KEY-1,y
    eor #$80
    cmp kt80
    bcc se_place
    beq se_place
    lda KEY-1,y
    sta KEY,y
    lda IDX-1,y
    sta IDX,y
    dey
    bne se_inner
se_place:
    lda kt
    sta KEY,y
    lda it
    sta IDX,y
    inx
    cpx nn
    bne se_outer
    rts

// ssort_bmi: the pitfall. key[j-1] - kt with BMI as "less than" is wrong
// whenever the subtraction overflows.
ssort_bmi:
    ldx #1
sb_outer:
    lda KEY,x
    sta kt
    lda IDX,x
    sta it
    txa
    tay
sb_inner:
    lda KEY-1,y
    sec
    sbc kt
    beq sb_place
    bmi sb_place
    lda KEY-1,y
    sta KEY,y
    lda IDX-1,y
    sta IDX,y
    dey
    bne sb_inner
sb_place:
    lda kt
    sta KEY,y
    lda it
    sta IDX,y
    inx
    cpx nn
    bne sb_outer
    rts

// ---------------------------------------------------------------- lists
// fill_rand: KEY = n low bytes of a 16-bit LFSR from SEED; IDX = 0..n-1
fill_rand:
    lda #<SEED
    sta s_lo
    lda #>SEED
    sta s_hi
    ldx #0
!:  lsr s_hi
    ror s_lo
    bcc !+
    lda s_hi
    eor #$b4
    sta s_hi
!:  lda s_lo
    sta KEY,x
    txa
    sta IDX,x
    inx
    cpx nn
    bne !--
    rts

fill_sorted:                     // KEY = 0..n-1
    ldx #0
!:  txa
    sta KEY,x
    sta IDX,x
    inx
    cpx nn
    bne !-
    rts

fill_rev:                        // KEY = n-1..0
    ldx #0
    ldy nn
!:  dey
    tya
    sta KEY,x
    txa
    sta IDX,x
    inx
    cpx nn
    bne !-
    rts

out_back:                        // OUTK / OUTI -> KEY / IDX
    ldx #0
!:  lda OUTK,x
    sta KEY,x
    lda OUTI,x
    sta IDX,x
    inx
    cpx nn
    bne !-
    rts

// fold_list: cs = fold over (key | idx << 8) for the n entries
fold_list:
    ldx #0
!:  lda KEY,x
    sta fr
    lda IDX,x
    sta fr+1
    jsr fold
    inx
    cpx nn
    bne !-
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

// inversions: bad = adjacent pairs with key[i] > key[i+1], signed
inversions:
    lda #0
    sta bad
    ldx #0
!:  lda KEY+1,x
    eor #$80
    sta tmp
    lda KEY,x
    eor #$80
    cmp tmp
    beq !+
    bcc !+
    inc bad
!:  inx
    txa
    clc
    adc #1
    cmp nn
    bne !--
    rts

// ---------------------------------------------------------------- timing
// Time(routine): CIA2 timer A counts phi2, timer B counts A underflows;
// the 24-bit count, net of an empty call, lands in tcyc.
.macro Time(routine) {
    lda #$51
    sta $dd0f
    lda #$11
    sta $dd0e
    jsr routine
    lda #$00
    sta $dd0e
    sta $dd0f
    sec
    lda #$ff
    sbc $dd04
    sta tcyc
    lda #$ff
    sbc $dd05
    sta tcyc+1
    lda #$ff
    sbc $dd06
    sta tcyc+2
    sec
    lda tcyc
    sbc empty
    sta tcyc
    lda tcyc+1
    sbc empty+1
    sta tcyc+1
    lda tcyc+2
    sbc #0
    sta tcyc+2
}

nothing:
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

// dec7: 24-bit num, seven digits at (p2), leading zeros as spaces
dec7:
    ldy #0
    sty lead
    ldx #0
!:  lda pw0,x
    sta sub
    lda pw1,x
    sta sub+1
    lda pw2,x
    sta sub+2
    txa
    pha
    jsr decdiv
    pla
    tax
    inx
    cpx #6
    bne !-
    lda num
    ora #$30
    sta (p2),y
    rts
.var powers = List().add(1000000, 100000, 10000, 1000, 100, 10)
pw0: .fill 6, <powers.get(i)
pw1: .fill 6, >powers.get(i)
pw2: .fill 6, powers.get(i) >> 16
decdiv:                          // count how often sub goes into num
    lda #0
    sta tmp
!:  sec
    lda num
    sbc sub
    sta dtry
    lda num+1
    sbc sub+1
    sta dtry+1
    lda num+2
    sbc sub+2
    bcc !+
    sta num+2
    lda dtry
    sta num
    lda dtry+1
    sta num+1
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

.macro Dec7At(addr, from) {
    lda from
    sta num
    lda from+1
    sta num+1
    lda from+2
    sta num+2
    At(addr)
    jsr dec7
}

// Run(row, col, n, fill, sort, back, slot): fill a list of n, time the
// sort, print the cycles at (row, col), fold the result into slot's
// checksum (back = 1: the result is in OUTK / OUTI, copy it first).
.macro Run(row, col, n, fill, sort, back, slot) {
    lda #n
    sta nn
    jsr fill
    Time(sort)
    Dec7At(SCREEN + row*40 + col, tcyc)
.if (back != 0) {
    jsr out_back
}
    lda slot
    sta cs
    lda slot+1
    sta cs+1
    jsr fold_list
    lda cs
    sta slot
    lda cs+1
    sta slot+1
}

.macro Line(row, n) {
    PutStr(SCREEN + row*40, toIntString(n, 3))
    Run(row, 4,  n, fill_rand,   isort, 0, cs_rand)
    Run(row, 12, n, fill_sorted, isort, 0, cs_sorted)
    Run(row, 20, n, fill_rev,    isort, 0, cs_rev)
    Run(row, 28, n, fill_rand,   csort, 1, cs_count)
}

// Sum(row, label, slot, expect): checksum and OK or BAD
.macro Sum(row, col, label, slot, expect) {
    PutStr(SCREEN + row*40 + col, label)
    At(SCREEN + row*40 + col + 7)
    lda slot+1
    jsr hex2
    At(SCREEN + row*40 + col + 9)
    lda slot
    jsr hex2
    lda slot
    cmp #<expect
    bne !+
    lda slot+1
    cmp #>expect
    bne !+
    PutStr(SCREEN + row*40 + col + 12, "OK")
    jmp !++
!:  PutStr(SCREEN + row*40 + col + 12, "BAD")
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
    lda #0
    ldx #7
!:  sta cs_rand,x
    dex
    bpl !-

    // interrupts off and screen blanked: no badline inside a timed call
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

    lda #0
    sta empty
    sta empty+1
    Time(nothing)
    lda tcyc
    sta empty
    lda tcyc+1
    sta empty+1

    PutStr(SCREEN, "SORT N KEYS WITH AN INDEX, CYCLES")
    PutStr(SCREEN + 1*40, "     INSERTION SORT, LIST         COUNT")
    PutStr(SCREEN + 2*40, "  N  RANDOM  SORTED REVERSE  RANDOM")
    Line(3, 8)
    Line(4, 16)
    Line(5, 32)
    Line(6, 64)
    Line(7, 128)
    Line(8, 255)

    PutStr(SCREEN + 10*40, "CHECKSUMS")
    Sum(11, 0,  "RANDOM", cs_rand,   EXP_RAND)
    Sum(11, 20, "SORTED", cs_sorted, EXP_SORTED)
    Sum(12, 0,  "REVERS", cs_rev,    EXP_REV)
    Sum(12, 20, "COUNT",  cs_count,  EXP_RAND)

    // signed keys, n = 64 random bytes read as -128..127
    PutStr(SCREEN + 14*40, "SIGNED, N=64, PAIRS OUT OF ORDER")
    lda #64
    sta nn
    jsr fill_rand
    jsr ssort_eor
    jsr inversions
    PutStr(SCREEN + 15*40, "EOR #$80 COMPARE")
    At(SCREEN + 15*40 + 20)
    lda bad
    jsr hex2
    lda bad
    beq !+
    lda #0
    sta ok
!:  jsr fill_rand
    jsr ssort_bmi
    jsr inversions
    PutStr(SCREEN + 16*40, "SBC / BMI COMPARE")
    At(SCREEN + 16*40 + 20)
    lda bad
    jsr hex2
    lda bad
    cmp #EXP_BAD
    beq !+
    lda #0
    sta ok
!:

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
nn:     .byte 0
kt:     .byte 0
kt80:   .byte 0
it:     .byte 0
s_lo:   .byte 0
s_hi:   .byte 0
cs:     .word 0
fr:     .word 0
cs_rand:   .word 0
cs_sorted: .word 0
cs_rev:    .word 0
cs_count:  .word 0
bad:    .byte 0
tcyc:   .fill 3, 0
empty:  .word 0
num:    .fill 3, 0
sub:    .fill 3, 0
dtry:   .word 0
tmp:    .byte 0
lead:   .byte 0
ok:     .byte 0
```

## Build

```bash
java -jar KickAss.jar sort-bytes.asm -o sort-bytes.prg
```

## Expected output

Border green, text area the power-on blue:

```
SORT N KEYS WITH AN INDEX, CYCLES
     INSERTION SORT, LIST         COUNT
  N  RANDOM  SORTED REVERSE  RANDOM
  8     774     407    1191    7224
 16    2511     871    4411    7784
 32    9042    1799   16803    8904
 64   23837    3655   65395   11144
128  136121    7367  257811   15624
255  526186   14733 1015620   24514

CHECKSUMS
RANDOM F7C0 OK      SORTED A2B4 OK
REVERS 5D03 OK      COUNT  F7C0 OK

SIGNED, N=64, PAIRS OUT OF ORDER
EOR #$80 COMPARE    00
SBC / BMI COMPARE   07

RESULT 01 PASS
```

Screenshots from the pinned run, 8,000,000 cycles:
`screenshots/sort-bytes.png` (PAL) and `screenshots/sort-bytes-ntsc.png`
(NTSC). Both decode against the character ROM to the text above,
identical on the two models; border pixel (2, 100) = (98, 213, 50) on
PAL and (114, 189, 103) on NTSC, index 5 in both palettes of
`runtime/vice-reference.md`. A run stopped at 4,000,000 cycles had not
finished.

Cycles are one call of the sort, net of an empty `JSR` / `RTS`, with
interrupts off and the display blanked (rung 1, VICE x64sc 3.10, PAL
and NTSC alike). Every figure equals the instruction-table count for
its list (rung 3 agreeing with rung 1):

| Sort | Cycles |
|---|---|
| insertion, already sorted | 58(n − 1) + 1 |
| insertion, reversed | 31 · n(n − 1)/2 + 46(n − 1) + 1 |
| insertion, random | 20 per key, 31 per place a key moves, 11 or 13 to stop, 27 to place |
| counting, any order | 70n + 6,664 |

The random lists are the low bytes of the 16-bit LFSR of
`random-range.md` from seed `$ACE1`, one step per key. Consecutive
bytes share seven bits, so the lists are partly in order already and
insertion sort does less work on them than on shuffled keys; the
255-key list has 96 repeated keys. The sorted list is `0..n-1`, the
reversed one `n-1..0`, and every index starts as the key's position.

The checksums fold each sorted list, key in the low byte and index in
the high, over all six lengths in order. `COUNT` is the counting sort
on the random lists; it must equal `RANDOM`, since both sorts are
stable. The model:

```python
M = 0xffff
def fold(cs, r):                  # cs = rol16(cs) ^ r + 13
    cs = ((cs << 1) | (cs >> 15)) & M
    return ((cs ^ r) + 13) & M
def lfsr_bytes(s, n):             # Galois, shift right, taps $B400
    out = []
    for _ in range(n):
        c, s = s & 1, s >> 1
        if c:
            s ^= 0xB400
        out.append(s & 255)
    return out
def keys(kind, n):
    return {'rand': lfsr_bytes(0xACE1, n), 'sorted': list(range(n)),
            'rev': list(range(n - 1, -1, -1))}[kind]
for kind in ('rand', 'sorted', 'rev'):
    cs = 0
    for n in [8, 16, 32, 64, 128, 255]:
        ks = keys(kind, n)            # sorted() is stable: equal keys keep index order
        for k, i in sorted(zip(ks, range(n)), key=lambda p: p[0]):
            cs = fold(cs, k | (i << 8))
    print(kind, hex(cs))             # rand 0xf7c0, sorted 0xa2b4, rev 0x5d03

def s8(v):
    return v - 256 if v > 127 else v
def isort(ks, moves_up):          # the listing's insertion sort
    ks = list(ks)
    for i in range(1, len(ks)):
        kt, j = ks[i], i
        while j > 0 and moves_up(ks[j - 1], kt):
            ks[j] = ks[j - 1]
            j -= 1
        ks[j] = kt
    return ks
rk = lfsr_bytes(0xACE1, 64)
bmi = isort(rk, lambda a, kt: (a - kt) & 255 != 0 and (a - kt) & 128 == 0)
print(sum(s8(bmi[i]) > s8(bmi[i + 1]) for i in range(63)))   # 7
```

`SIGNED` sorts 64 random bytes read as -128 to 127 and counts
neighbours out of signed order (in hex). With `EOR #$80` on both sides
before an unsigned compare, none. With `SEC / SBC / BMI` as the test,
seven: the subtraction overflows whenever the two keys are far apart
with opposite signs, and `N` then gives the wrong order
(`pitfalls/cpu.md`, `signed_compare_bmi_overflow`).

## Why this works

### Insertion sort

Each key is taken out, the larger keys before it are moved up one
place, and the key goes into the gap. A key moves past only strictly
greater keys, so equal keys keep their order: the sort is stable, and
the index travelling with each key says where it came from. The cost is
31 cycles for every place a key moves, so it grows with the square of
the list in the worst case: 1,015,620 cycles, about 52 PAL frames, for 255
reversed keys. On a list that is almost in order it is close to linear:
58 cycles a key when nothing moves. That is the common case in a game
that sorts the same objects every frame, since they move only a little
between frames.

`KEY` is at `$4001`, so `KEY-1,Y` and `KEY,Y` both stay inside page
`$40` for `Y` from 1 to 254. With `KEY` at `$4000`, `KEY-1,Y` would
start in page `$3F` and cross into `$40` for every `Y` from 1 up: one
cycle more on every compare and every move.

### Counting sort

For byte keys, a counting sort needs no compares. It counts each key
into one of 256 buckets, turns the counts into each bucket's first
position, then walks the list in order and puts each entry at its
bucket's next position. Walking in list order keeps equal keys in
order, so it is stable too. It costs 70 cycles a key plus 6,664 for
the two passes over the 256 buckets, whatever the order, and needs
1,024 bytes for the buckets and the output. It beat insertion sort on
the random and the reversed lists from 32 keys up.
