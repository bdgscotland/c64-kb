---
recipe: base-routines
toolchain: kickassembler
output_format: PRG
region: both
techniques: [add_sub_16bit, memory_fill_copy, delay_loops]
file_formats: [PRG]
uses_registers: [D011, D020, DD04, DD05, DD06, DD07, DD0E, DD0F]
uses_kernal: [CHROUT]
claims: [vic_raster_irq (init), zero_page $FB-$FE (owns)]
harness: [cia2_timer_a, cia2_timer_b, $02FF]
ram: [buf=$4000-$4FFF]
---

<!-- doc-type: recipe -->

# KickAssembler — 16-bit add and subtract, fill, copy and delay loops, timed

## Synopsis

The routines every program has: 16-bit add, subtract, increment and
decrement; filling and copying eight pages through a zero-page pointer
and through unrolled `abs,X` stores; an overlapping move in both
directions; and three delay loops, one of them straddling a page. Each
is called once under the CIA2 timers and its cycle count is printed
beside its instruction-table sum. The arithmetic is also swept over
65,536 operand pairs and folded into checksums a Python model computed,
and the fill and copy results are compared byte by byte. `$02FF` =
`$01` and a green border when every count equals its sum and every
check passes, `$02FF` = `$02` and a red border otherwise.

## Source

```asm
// base-routines.asm
// The everyday routines, each called once under a CIA2 timer and
// checked for its result: 16-bit add, subtract, increment and
// decrement, two ways to fill and copy eight pages, and three delay
// loops. The arithmetic is also swept over 65,536 operand pairs and
// folded into checksums a Python model computed. Every measured cycle
// count is printed beside the instruction-table sum; $02FF = $01 and a
// green border when all of them agree and every check passes, $02FF =
// $02 and a red border otherwise.

BasicUpstart2(start)
.encoding "screencode_upper"

.const SCREEN    = $0400
.const RESULT    = $02ff         // verdict byte read by the harness
.const BORDER    = $d020
.const CODE_PASS = $01
.const CODE_FAIL = $02

.const BUF   = $4000             // 8 pages: fill target, copy source
.const DST   = $4800             // 8 pages: copy destination
.const PAGES = 8

.const p1 = $fb                  // zero-page pointer: fill/copy source, string source
.const p2 = $fd                  // zero-page pointer: copy destination, screen destination

// expected sweep results, from the Python model on the recipe page
.const EXP_ADD = $c64a
.const EXP_SUB = $a253
.const EXP_A8  = $3bce
.const EXP_INC = $2b29
.const EXP_DEC = $5a45
.const EXP_ADDC = 32768
.const EXP_SUBB = 32768
.const EXP_A8C  = 51200         // C is the low byte's carry, not the 17th bit

// ---------------------------------------------------------------- arithmetic
// Operands are absolute variables, the common case in a game.

add16:                           // r = a + b; C out is the 17th bit
    clc
    lda a_lo
    adc b_lo
    sta r_lo
    lda a_hi
    adc b_hi
    sta r_hi
    rts

sub16:                           // r = a - b; C clear means a borrow
    sec
    lda a_lo
    sbc b_lo
    sta r_lo
    lda a_hi
    sbc b_hi
    sta r_hi
    rts

add8:                            // r = r + 200, carry into the high byte
    clc
    lda r_lo
    adc #200
    sta r_lo
    bcc !+
    inc r_hi
!:  rts

inc16:                           // r = r + 1
    inc r_lo
    bne !+
    inc r_hi
!:  rts

dec16:                           // r = r - 1: test the low byte before it wraps
    lda r_lo
    bne !+
    dec r_hi
!:  dec r_lo
    rts

// ---------------------------------------------------------------- fill and copy
// fill_zp: A = value, X = pages, p1 = first page. 11 cycles a byte.
fill_zp:
    ldy #0
!:  sta (p1),y
    iny
    bne !-
    inc p1+1
    dex
    bne !-
    rts

t_fill_zp:                       // the timed call, set-up included
    lda #<BUF
    sta p1
    lda #>BUF
    sta p1+1
    lda #$55
    ldx #PAGES
    jmp fill_zp

// fill_unrolled: one STA abs,X per page. 45 cycles per 8 bytes.
t_fill_un:
    lda #$aa
    ldx #0
!:
.for (var p = 0; p < PAGES; p++) {
    sta BUF + p*256,x
}
    inx
    bne !-
    rts

// copy_zp: p1 = source page, p2 = destination page, X = pages. 16 a byte.
copy_zp:
    ldy #0
!:  lda (p1),y
    sta (p2),y
    iny
    bne !-
    inc p1+1
    inc p2+1
    dex
    bne !-
    rts

t_copy_zp:
    lda #<BUF
    sta p1
    lda #>BUF
    sta p1+1
    lda #<DST
    sta p2
    lda #>DST
    sta p2+1
    ldx #PAGES
    jmp copy_zp

// copy_unrolled: LDA abs,X / STA abs,X per page. 77 cycles per 8 bytes.
t_copy_un:
    ldx #0
!:
.for (var p = 0; p < PAGES; p++) {
    lda BUF + p*256,x
    sta DST + p*256,x
}
    inx
    bne !-
    rts

// Overlapping move up by one byte: BUF..BUF+255 -> BUF+1..BUF+256.
move_fwd:                        // ascending: reads what it just wrote
    ldx #0
!:  lda BUF,x
    sta BUF+1,x
    inx
    bne !-
    rts

move_bwd:                        // descending: every byte read before it is overwritten
    ldx #0
!:  dex
    lda BUF,x
    sta BUF+1,x
    cpx #0
    bne !-
    rts

// ---------------------------------------------------------------- delays
.macro DelayX(n) {               // 5n + 1 cycles (n = 0 counts 256)
    ldx #n
!:  dex
    bne !-
    rts
}
d_x1:   DelayX(1)
d_x100: DelayX(100)
d_x256: DelayX(0)

d_yx:                            // m(5n + 6) + 1 cycles, m = 10, n = 100
    ldy #10
!o: ldx #100
!i: dex
    bne !i-
    dey
    bne !o-
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
    sec                          // the routine may leave C in either state
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

.macro Net(slot) {               // subtract the empty JSR / RTS
    sec
    lda slot
    sbc empty
    sta slot
    lda slot+1
    sbc #0
    sta slot+1
    lda slot+2
    sbc #0
    sta slot+2
}

nothing:
    rts

.macro SetR(v) {
    lda #<v
    sta r_lo
    lda #>v
    sta r_hi
}

// ---------------------------------------------------------------- sweeps
// For ii, jj in 0..255: a = ii:jj, b = jj:(7*ii + 3) mod 256.
// set_ab loads the pair, the patched JSR runs one routine, fold mixes r
// into cs and the carry test counts in cnt.
sweep:
    lda #0
    sta ii
!outer:
    lda #0
    sta jj
!inner:
    jsr set_ab
sw_jsr:
    jsr $0000                    // patched by RunSweep
    lda #0
    rol                          // A = C after the routine
    bit carry_sense              // $80: count nothing
    bmi !+
    eor carry_sense              // non-zero when this pair counts
    beq !+
    inc cnt
    bne !+
    inc cnt+1
!:  jsr fold
    inc jj
    bne !inner-
    inc ii
    bne !outer-
    rts

set_ab:
    lda ii
    sta a_hi
    sta r_hi
    lda jj
    sta a_lo
    sta r_lo
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
    rts

// fold: cs = rol16(cs) ^ r + 13
fold:
    asl cs
    rol cs+1
    bcc !+
    inc cs
!:  lda cs
    eor r_lo
    sta cs
    lda cs+1
    eor r_hi
    sta cs+1
    clc
    lda cs
    adc #13
    sta cs
    bcc !+
    inc cs+1
!:  rts

// ---------------------------------------------------------------- checks
// check_fill: every byte of the 8 pages at p1 equals A. Clears ok if not.
check_fill:
    sta tmp
    ldx #PAGES
    ldy #0
!:  lda (p1),y
    cmp tmp
    bne bad
    iny
    bne !-
    inc p1+1
    dex
    bne !-
    rts
bad:
    lda #0
    sta ok
    rts

// pattern: BUF byte k = (k mod 256) xor page number
pattern:
    lda #<BUF
    sta p1
    lda #>BUF
    sta p1+1
    ldx #PAGES
    ldy #0
!:  tya
    eor p1+1
    sta (p1),y
    iny
    bne !-
    inc p1+1
    dex
    bne !-
    rts

// check_copy: DST equals BUF over 8 pages. Clears ok if not.
check_copy:
    lda #<BUF
    sta p1
    lda #>BUF
    sta p1+1
    lda #<DST
    sta p2
    lda #>DST
    sta p2+1
    ldx #PAGES
    ldy #0
!:  lda (p1),y
    cmp (p2),y
    bne bad
    iny
    bne !-
    inc p1+1
    inc p2+1
    dex
    bne !-
    rts

// clear_dst: zero the 8 destination pages so a copy that did nothing fails
clear_dst:
    lda #<DST
    sta p1
    lda #>DST
    sta p1+1
    lda #0
    ldx #PAGES
    jmp fill_zp

// ramp: BUF..BUF+256 = 0, 1, .., 255, 0
ramp:
    ldx #0
!:  txa
    sta BUF,x
    inx
    bne !-
    stx BUF+256
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

// Row(row, label, slot, expect): label, measured cycles, the table sum,
// OK or BAD; a mismatch clears ok.
.macro Row(row, label, slot, expect) {
    PutStr(SCREEN + row*40, label)
    lda slot
    sta num
    lda slot+1
    sta num+1
    At(SCREEN + row*40 + 20)
    jsr dec5
    lda #<expect
    sta num
    lda #>expect
    sta num+1
    At(SCREEN + row*40 + 27)
    jsr dec5
    lda slot
    cmp #<expect
    bne !+
    lda slot+1
    cmp #>expect
    bne !+
    lda slot+2
    bne !+
    PutStr(SCREEN + row*40 + 34, "OK")
    jmp !++
!:  PutStr(SCREEN + row*40 + 34, "BAD")
    lda #0
    sta ok
!:
}

// RunSweep(routine, sense): cs = cnt = 0, patch, sweep. sense = 0 counts
// pairs that leave C set, 1 counts pairs that leave C clear, $80 none.
.macro RunSweep(routine, sense) {
    lda #0
    sta cs
    sta cs+1
    sta cnt
    sta cnt+1
    lda #sense
    sta carry_sense
    lda #<routine
    sta sw_jsr+1
    lda #>routine
    sta sw_jsr+2
    jsr sweep
}

// Sum(row, col, label, expect, cexp): cs against expect and cnt against
// cexp; OK or BAD.
.macro Sum(row, col, label, expect, cexp) {
    PutStr(SCREEN + row*40 + col, label)
    At(SCREEN + row*40 + col + 4)
    lda cs+1
    jsr hex2
    At(SCREEN + row*40 + col + 6)
    lda cs
    jsr hex2
    lda cnt
    sta num
    lda cnt+1
    sta num+1
    At(SCREEN + row*40 + col + 9)
    jsr dec5
    lda cs
    cmp #<expect
    bne !+
    lda cs+1
    cmp #>expect
    bne !+
    lda cnt
    cmp #<cexp
    bne !+
    lda cnt+1
    cmp #>cexp
    bne !+
    PutStr(SCREEN + row*40 + col + 15, "OK")
    jmp !++
!:  PutStr(SCREEN + row*40 + col + 15, "BAD")
    lda #0
    sta ok
!:
}

.macro Bytes4(addr, from) {      // four bytes from 'from' in hex at addr
.for (var k = 0; k < 4; k++) {
    At(addr + k*3)
    lda from + k
    jsr hex2
}
}

// ---------------------------------------------------------------- main
start:
    lda #$93                     // clear screen through CHROUT
    jsr $ffd2
    lda #1
    sta ok

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
    lda #$34                     // $1234 + $0FCC = $2200, carry out of the low byte
    sta a_lo
    lda #$12
    sta a_hi
    lda #$cc
    sta b_lo
    lda #$0f
    sta b_hi
    Time(add16, t_add)
    lda r_lo
    sta v_add
    lda r_hi
    sta v_add+1
    Time(sub16, t_sub)           // $1234 - $0FCC = $0268
    lda r_lo
    sta v_sub
    lda r_hi
    sta v_sub+1
    SetR($1234)
    Time(add8, t_a8n)            // $1234 + 200 = $12FC
    lda r_lo
    sta v_a8n
    lda r_hi
    sta v_a8n+1
    SetR($12ff)
    Time(add8, t_a8c)            // $12FF + 200 = $13C7
    lda r_lo
    sta v_a8c
    lda r_hi
    sta v_a8c+1
    SetR($1234)
    Time(inc16, t_incn)
    SetR($12ff)
    Time(inc16, t_incc)          // -> $1300
    lda r_lo
    sta v_inc
    lda r_hi
    sta v_inc+1
    SetR($1234)
    Time(dec16, t_decn)
    SetR($1300)
    Time(dec16, t_decb)          // -> $12FF
    lda r_lo
    sta v_dec
    lda r_hi
    sta v_dec+1

    Time(t_fill_zp, t_fz)
    Time(t_fill_un, t_fu)
    jsr pattern
    jsr clear_dst
    Time(t_copy_zp, t_cz)
    jsr clear_dst
    Time(t_copy_un, t_cu)
    Time(d_x1, t_d1)
    Time(d_x100, t_d100)
    Time(d_x256, t_d256)
    Time(d_xpx, t_dpx)
    Time(d_yx, t_dyx)

    lda $d011
    ora #$10
    sta $d011
    cli

    Net(t_add)
    Net(t_sub)
    Net(t_a8n)
    Net(t_a8c)
    Net(t_incn)
    Net(t_incc)
    Net(t_decn)
    Net(t_decb)
    Net(t_fz)
    Net(t_fu)
    Net(t_cz)
    Net(t_cu)
    Net(t_d1)
    Net(t_d100)
    Net(t_d256)
    Net(t_dpx)
    Net(t_dyx)

    // -------- correctness of the fill and copy routines (untimed reruns)
    jsr t_fill_zp
    lda #<BUF
    sta p1
    lda #>BUF
    sta p1+1
    lda #$55
    jsr check_fill
    jsr t_fill_un
    lda #<BUF
    sta p1
    lda #>BUF
    sta p1+1
    lda #$aa
    jsr check_fill
    jsr pattern
    jsr clear_dst
    jsr t_copy_zp
    jsr check_copy
    jsr clear_dst
    jsr t_copy_un
    jsr check_copy
    lda ok
    sta ok_mem

    // -------- screen
    PutStr(SCREEN, "BASE ROUTINES, CIA2-TIMED")
    PutStr(SCREEN + 1*40, "ROUTINE               CYC  TABLE")
    Row(2,  "ADD16",           t_add,  26)
    Row(3,  "SUB16",           t_sub,  26)
    Row(4,  "ADD8 TO 16",      t_a8n,  15)
    Row(5,  "ADD8 TO 16 CARRY", t_a8c, 20)
    Row(6,  "INC16",           t_incn, 9)
    Row(7,  "INC16 CARRY",     t_incc, 14)
    Row(8,  "DEC16",           t_decn, 13)
    Row(9,  "DEC16 BORROW",    t_decb, 18)
    Row(10, "FILL (ZP),Y 8P",  t_fz,   14 + 3 + 2 + PAGES*2825 - 1)
    Row(11, "FILL ABS,X 8P",   t_fu,   2 + 2 + 256*(PAGES*5 + 5) - 1)
    Row(12, "COPY (ZP),Y 8P",  t_cz,   20 + 2 + 3 + 2 + PAGES*4110 - 1)
    Row(13, "COPY ABS,X 8P",   t_cu,   2 + 256*(PAGES*9 + 5) - 1)
    Row(14, "DELAY X=1",       t_d1,   5*1 + 1)
    Row(15, "DELAY X=100",     t_d100, 5*100 + 1)
    Row(16, "DELAY X=0 (256)", t_d256, 5*256 + 1)
    Row(17, "DELAY X=100 PAGEX", t_dpx, 6*100)
    Row(18, "DELAY Y=10 X=100", t_dyx, 10*(5*100 + 6) + 1)

    // results of the timed calls
    PutStr(SCREEN + 19*40, "SUMS")
    At(SCREEN + 19*40 + 5)
    lda v_add+1
    jsr hex2
    At(SCREEN + 19*40 + 7)
    lda v_add
    jsr hex2
    At(SCREEN + 19*40 + 10)
    lda v_sub+1
    jsr hex2
    At(SCREEN + 19*40 + 12)
    lda v_sub
    jsr hex2
    At(SCREEN + 19*40 + 15)
    lda v_a8n+1
    jsr hex2
    At(SCREEN + 19*40 + 17)
    lda v_a8n
    jsr hex2
    At(SCREEN + 19*40 + 20)
    lda v_a8c+1
    jsr hex2
    At(SCREEN + 19*40 + 22)
    lda v_a8c
    jsr hex2
    At(SCREEN + 19*40 + 25)
    lda v_inc+1
    jsr hex2
    At(SCREEN + 19*40 + 27)
    lda v_inc
    jsr hex2
    At(SCREEN + 19*40 + 30)
    lda v_dec+1
    jsr hex2
    At(SCREEN + 19*40 + 32)
    lda v_dec
    jsr hex2
    lda v_add
    cmp #$00
    bne sums_bad
    lda v_add+1
    cmp #$22
    bne sums_bad
    lda v_sub
    cmp #$68
    bne sums_bad
    lda v_sub+1
    cmp #$02
    bne sums_bad
    lda v_a8n
    cmp #$fc
    bne sums_bad
    lda v_a8n+1
    cmp #$12
    bne sums_bad
    lda v_a8c
    cmp #$c7
    bne sums_bad
    lda v_a8c+1
    cmp #$13
    bne sums_bad
    lda v_inc
    cmp #$00
    bne sums_bad
    lda v_inc+1
    cmp #$13
    bne sums_bad
    lda v_dec
    cmp #$ff
    bne sums_bad
    lda v_dec+1
    cmp #$12
    beq sums_ok
sums_bad:
    lda #0
    sta ok
sums_ok:
    lda ok_mem
    bne !+
    PutStr(SCREEN + 19*40 + 35, "MEM?")
    jmp !++
!:  PutStr(SCREEN + 19*40 + 35, "MEM")
!:

    // -------- overlapping move up one byte
    jsr ramp
    jsr move_fwd
    PutStr(SCREEN + 20*40, "MOVE UP FWD")
    Bytes4(SCREEN + 20*40 + 12, BUF)
    lda BUF+4                    // ascending copy smears byte 0 over the page
    bne !+
    lda BUF+256
    beq fwd_ok
!:  lda #0
    sta ok
fwd_ok:
    jsr ramp
    jsr move_bwd
    PutStr(SCREEN + 20*40 + 25, "BWD")
    Bytes4(SCREEN + 20*40 + 29, BUF)
    lda BUF+4                    // descending copy keeps the ramp: byte 4 = 3
    cmp #3
    bne !+
    lda BUF+256
    cmp #255
    beq bwd_ok
!:  lda #0
    sta ok
bwd_ok:

    // -------- sweeps
    RunSweep(add16, 0)
    Sum(21, 0, "ADD", EXP_ADD, EXP_ADDC)
    RunSweep(sub16, 1)
    Sum(21, 20, "SUB", EXP_SUB, EXP_SUBB)
    RunSweep(add8, 0)
    Sum(22, 0, "A8 ", EXP_A8, EXP_A8C)
    RunSweep(inc16, $80)
    Sum(22, 20, "INC", EXP_INC, 0)
    RunSweep(dec16, $80)
    Sum(23, 0, "DEC", EXP_DEC, 0)

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
r_lo:   .byte 0
r_hi:   .byte 0
ii:     .byte 0
jj:     .byte 0
cs:     .word 0
cnt:    .word 0
carry_sense: .byte 0
num:    .word 0
sub:    .word 0
tmp:    .byte 0
lead:   .byte 0
ok:     .byte 0
ok_mem: .byte 0
v_add:  .word 0
v_sub:  .word 0
v_a8n:  .word 0
v_a8c:  .word 0
v_inc:  .word 0
v_dec:  .word 0
empty:  .byte 0, 0, 0
t_add:  .byte 0, 0, 0
t_sub:  .byte 0, 0, 0
t_a8n:  .byte 0, 0, 0
t_a8c:  .byte 0, 0, 0
t_incn: .byte 0, 0, 0
t_incc: .byte 0, 0, 0
t_decn: .byte 0, 0, 0
t_decb: .byte 0, 0, 0
t_fz:   .byte 0, 0, 0
t_fu:   .byte 0, 0, 0
t_cz:   .byte 0, 0, 0
t_cu:   .byte 0, 0, 0
t_d1:   .byte 0, 0, 0
t_d100: .byte 0, 0, 0
t_d256: .byte 0, 0, 0
t_dpx:  .byte 0, 0, 0
t_dyx:  .byte 0, 0, 0

// The same X loop placed so its BNE crosses a page: DEX at $2FFF, the
// instruction after BNE at $3001. A taken branch to another page costs 4.
* = $2ffd "page-crossing delay"
d_xpx:
    ldx #100                     // $2FFD
    dex                          // $2FFF
    bne d_xpx + 2                // $3000, taken to $2FFF: 4 cycles
    rts                          // $3002
```

## Build

```bash
java -jar KickAss.jar base-routines.asm -o base-routines.prg
```

Produces `base-routines.prg`, `$0801` to `$3002`: the program to `$2259`,
a gap, and the six-byte page-crossing delay at `$2FFD`.

## Expected output

Border green, text area the power-on blue:

```
BASE ROUTINES, CIA2-TIMED
ROUTINE               CYC  TABLE
ADD16                  26     26  OK
SUB16                  26     26  OK
ADD8 TO 16             15     15  OK
ADD8 TO 16 CARRY       20     20  OK
INC16                   9      9  OK
INC16 CARRY            14     14  OK
DEC16                  13     13  OK
DEC16 BORROW           18     18  OK
FILL (ZP),Y 8P      22618  22618  OK
FILL ABS,X 8P       11523  11523  OK
COPY (ZP),Y 8P      32906  32906  OK
COPY ABS,X 8P       19713  19713  OK
DELAY X=1               6      6  OK
DELAY X=100           501    501  OK
DELAY X=0 (256)      1281   1281  OK
DELAY X=100 PAGEX     600    600  OK
DELAY Y=10 X=100     5061   5061  OK
SUMS 2200 0268 12FC 13C7 1300 12FF MEM
MOVE UP FWD 00 00 00 00  BWD 00 00 01 02
ADD C64A 32768 OK   SUB A253 32768 OK
A8  3BCE 51200 OK   INC 2B29     0 OK
DEC 5A45     0 OK
RESULT 01 PASS
```

Screenshots from the pinned run, 100,000,000 cycles:
`screenshots/base-routines.png` (PAL) and
`screenshots/base-routines-ntsc.png` (NTSC). Both decode against the
character ROM to the text above, identical on the two models; border
pixel (2, 100) = (98, 213, 50) on PAL and (114, 189, 103) on NTSC,
index 5 in both palettes of `runtime/vice-reference.md`. The pinned
command was run twice per model and the two PNGs were identical bytes.
The five sweeps take about 20,000,000 cycles each; a run stopped at
45,000,000 had printed only the `ADD` and `SUB` sums.

`CYC` is the measured count of one call, net of an empty `JSR` /
`RTS`, with interrupts off and the display blanked (`DEN` clear), so no
badline or sprite fetch lands inside it. `TABLE` is the sum from the
instruction timing table, computed by the assembler from the formula in
the `Row` call. All seventeen agree on both models (rung 1). With the
display on, a badline stops the CPU for 40 to 43 cycles on each of 25
lines a frame (`pitfalls/raster-and-badline.md`,
`badline_cycle_loss`), so any routine longer than a few lines costs
more than its table sum; not measured here.

| Row | Routine | Cycles | Where they go |
|---|---|---|---|
| `ADD16`, `SUB16` | absolute operands | 26 | 2 + 6 × 4 |
| `ADD8 TO 16` | `r += 200`, no carry | 15 | 2 + 4 + 2 + 4 + 3 |
| `ADD8 TO 16 CARRY` | carry into the high byte | 20 | 2 + 4 + 2 + 4 + 2 + 6 |
| `INC16` | no carry | 9 | 6 + 3 |
| `INC16 CARRY` | `$12FF` to `$1300` | 14 | 6 + 2 + 6 |
| `DEC16` | no borrow | 13 | 4 + 3 + 6 |
| `DEC16 BORROW` | `$1300` to `$12FF` | 18 | 4 + 2 + 6 + 6 |
| `FILL (ZP),Y 8P` | 2,048 bytes | 22,618 | 11 a byte, 10 a page, 19 of set-up |
| `FILL ABS,X 8P` | 2,048 bytes | 11,523 | 45 per 8 bytes, 4 of set-up |
| `COPY (ZP),Y 8P` | 2,048 bytes | 32,906 | 16 a byte, 15 a page, 27 of set-up |
| `COPY ABS,X 8P` | 2,048 bytes | 19,713 | 77 per 8 bytes, 2 of set-up |
| `DELAY X=n` | `LDX #n / DEX / BNE` | 5n + 1 | n = 0 counts 256: 1,281 |
| `DELAY X=100 PAGEX` | the same loop across a page | 6n | 600 |
| `DELAY Y=10 X=100` | nested | m(5n + 6) + 1 | 5,061 |

Each total above subtracts one cycle for the last `BNE` of every loop,
which falls through for 2 instead of 3. The fill and copy set-up is
inside the timed call: the pointer stores, `LDX #8`, a `JMP` and
`LDY #0`.

`SUMS` shows the six timed results: `$1234 + $0FCC = $2200`,
`$1234 - $0FCC = $0268`, `$1234 + 200 = $12FC`, `$12FF + 200 = $13C7`,
`$12FF + 1 = $1300`, `$1300 - 1 = $12FF`. `MEM` is printed when both
fills read back as the byte written and both copies equal their source;
`MEM?` when one did not.

`MOVE UP` moves 256 bytes holding 0, 1, 2 … up by one byte in place.
The ascending loop leaves `00 00 00 00`: every read after the first
fetches the byte the loop wrote on the step before, so byte 0 is copied
over the whole page. The descending loop leaves `00 00 01 02`: byte 0
unchanged, then the ramp one place up.

The sweep lines: `a = i:j` and `b = j:(7i + 3)` for every `i, j`. `ADD`
and `SUB` fold each result into a checksum and count the pairs that
carried out of bit 15 (`C` set after the add) or borrowed (`C` clear
after the subtract): 32,768 each. `A8` adds 200 to `a`; its count is
51,200, the pairs whose low byte carried, because `C` after the
add-8-to-16 routine is the low byte's carry and the `INC` of the high
byte does not change it. The whole word wrapped past `$FFFF` on only
200 of them (the model counts both); test `Z` after the `INC` if the
routine must report that. `INC` and `DEC` fold `a + 1` and `a - 1`.
Every checksum matches the model:

```python
M = 0xffff
def fold(cs, r):                  # cs = rol16(cs) ^ r + 13
    cs = ((cs << 1) | (cs >> 15)) & M
    return ((cs ^ r) + 13) & M
def pairs():
    for i in range(256):
        for j in range(256):
            yield (i << 8) | j, (j << 8) | ((i * 7 + 3) & 255)
def run(f):
    cs = 0
    for a, b in pairs():
        cs = fold(cs, f(a, b) & M)
    return cs
print(hex(run(lambda a, b: a + b)))    # 0xc64a
print(hex(run(lambda a, b: a - b)))    # 0xa253
print(hex(run(lambda a, b: a + 200)))  # 0x3bce
print(hex(run(lambda a, b: a + 1)))    # 0x2b29
print(hex(run(lambda a, b: a - 1)))    # 0x5a45
```

The first version of this program expected 200 in the `A8` count, the
number of 16-bit wraps; the machine counted 51,200, and the listing now
expects the low-byte carry the routine actually leaves in `C`.

## Why this works

### Carry and borrow chains

`ADC` adds the carry in and sets it out; `CLC` before the low byte
starts the chain at zero and the high-byte `ADC` picks up the low
byte's carry. `SBC` subtracts the inverted carry, so `SEC` starts a
subtract with no borrow and `C` clear at the end means the whole word
borrowed. Adding a byte to a word needs only an `INC` of the high byte
when the low byte carried, which is cheaper than a second `ADC #0` when
the carry is rare (15 cycles against 22 for the full add with a
constant high byte of zero, rung 3).

`INC` and `DEC` do not touch `C`, so the increment tests `Z` after the
low byte: zero means it wrapped from `$FF`. The decrement must test the
low byte before it changes, since `DEC` from `$00` gives `$FF` with `Z`
clear; `LDA r_lo / BNE` does that for 4 cycles, and the `DEC` of the low
byte follows either way.

### Fill and copy

`STA (zp),Y` costs 6 whatever the page, so a pointer fill is 11 cycles
a byte with its `INY / BNE`, and the pointer's high byte moves once a
page for 10 more. Unrolling one `STA abs,X` per page shares one
`INX / BNE` among eight stores: 45 cycles per eight bytes, 5.6 a byte,
at the cost of fixed addresses assembled into the code. A copy adds a
load: `LDA (zp),Y` is 5 (6 when `Y` crosses a page, which a page-aligned
pointer never does) and `LDA abs,X` is 4 (5 when the base plus `X`
crosses a page, which a page-aligned base never does). An unaligned
source or destination adds one cycle for every read that crosses, up to
255 a page (rung 3). The speedcode recipe unrolls further, one
`LDA / STA` pair per byte and no index at all
(`recipes/kickassembler/speedcode-generator.md`).

### Overlapping moves

When the destination is above the source and the two overlap, an
ascending loop reads bytes it has already overwritten; copy from the
top down. When the destination is below the source, ascending is the
safe order. The descending loop here decrements `X` before its first
access so `X` runs 255 to 0, and tests `CPX #0` after the store.

### Delays

`DEX / BNE` is 5 cycles a pass and 4 on the last, plus 2 for `LDX`:
5n + 1. With `X = 0` the first `DEX` gives `$FF` and the loop runs 256
times. A taken branch to a different page costs one more: the loop at
`$2FFD` has `DEX` at `$2FFF` and its `BNE` at `$3000`, so every taken
branch is 4 and the loop is 6n. An assembler that moves the code moves
the delay; `.align` or an `.assert` on the loop's page keeps it
(`pitfalls/cpu.md`, `branch_page_cross_extra_cycle`). Two nested loops
reach 5,061 cycles with m = 10 and n = 100 and up to 329,217 with
m = n = 0 (rung 3). A delay measured in lines or frames belongs to the
raster or a CIA timer, not a loop: badlines and sprite DMA take cycles
from the loop but not from the clock.
