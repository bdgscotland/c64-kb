---
recipe: hires-circle
toolchain: kickassembler
output_format: PRG
region: both
techniques: [midpoint_circle, hires_plot, standard_bitmap]
file_formats: [PRG]
uses_registers: [D011, D016, D018, D020, D021, DD04, DD05, DD06, DD07, DD0E, DD0F]
uses_kernal: []
claims: [vic_raster_irq (init), zero_page $F9-$FE (owns)]
harness: [cia2_timer_a, cia2_timer_b, $02FF]
ram: [text=$4000-$4077]
---

<!-- doc-type: recipe -->

# KickAssembler — Midpoint circles in a hires bitmap, timed, pixel-checked against a model

## Synopsis

Draws twelve circles into a standard bitmap at `$2000` with the
midpoint algorithm and eight-way symmetry, plotting through the row and
mask tables of `hires-plot-line.md`: eight concentric circles of radius
10 to 80 and four small ones, radius 25, 3, 1 and 0. It counts the
plots and the set bits, folds the bitmap into a checksum that a Python
model computed, and times three circles with the CIA2 timer A / B
cascade while the display is blanked. It then runs the same octant with
the decision variable held in one byte, for radii 1 to 99, and counts
the radii where it goes wrong. The results are drawn into the bottom
three text rows of the bitmap from the character ROM. `$02FF` = `$01`
and a green border when every check passes; `$02FF` = `$02` and a red
border otherwise.

## Source

```asm
// hires-circle.asm
// Midpoint circles in a hires bitmap at $2000, plotted through the row
// and mask tables of hires-plot-line: eight concentric circles and four
// small ones, drawn with eight-way symmetry. The set bits are counted and
// the bitmap folded into a checksum a Python model computed; three
// circles are timed with the CIA2 timer A / B cascade. The same octant
// is also generated with the decision variable in one byte, for radii 1
// to 99, and the radii where it goes wrong counted. Results are drawn
// into the bottom three text rows of the bitmap from the character ROM.
// Verdict at $02FF ($01 pass, $02 fail) and in the border (green, red).

BasicUpstart2(start)
.encoding "screencode_upper"

.const BITMAP    = $2000
.const SCREEN    = $0400         // colour cells in bitmap mode
.const TEXT      = $4000         // 3 x 40 screen codes, drawn into rows 22-24
.const RESULT    = $02ff
.const BORDER    = $d020
.const CODE_PASS = $01
.const CODE_FAIL = $02

.const zp_ptr = $f9              // bitmap byte pointer
.const p1     = $fb              // text source, glyph source
.const p2     = $fd              // text destination

// expected results, from the Python model on the recipe page
.const EXP_PLOTS  = 2264
.const EXP_PIXELS = 2197
.const EXP_CS     = $e3c8
.const EXP_WRONG  = 21
.const EXP_FIRST  = 77

// the circles: centre x, centre y, radius
.var circles = List()
.for (var r = 10; r <= 80; r = r + 10) { .eval circles.add(List().add(160, 88, r)) }
.eval circles.add(List().add(290, 40, 25))
.eval circles.add(List().add(24, 24, 3))
.eval circles.add(List().add(20, 160, 1))
.eval circles.add(List().add(40, 160, 0))
.var NCIRC = circles.size()

// ---------------------------------------------------------------- plot
// plot: set pixel (px, py) through the row table and the mask table
plot:
    ldy py
    lda px
    and #$f8
    clc
    adc row_lo,y
    sta zp_ptr
    lda row_hi,y
    adc px+1
    sta zp_ptr+1
    lda px
    and #$07
    tax
    lda mask,x
    ldy #0
    ora (zp_ptr),y
    sta (zp_ptr),y
    rts

// ---------------------------------------------------------------- circle
// P(xv, yv): plot (xv, yv); counting = 1 adds one to plots
.macro P(xv, yv, counting) {
    lda xv
    sta px
    lda xv+1
    sta px+1
    lda yv
    sta py
    jsr plot
.if (counting != 0) {
    inc plots
    bne !+
    inc plots+1
!:
}
}

// Plot8: the eight points (cx +- x, cy +- y) and (cx +- y, cy +- x)
.macro Plot8(counting) {
    clc
    lda cx
    adc xx
    sta xa
    lda cx+1
    adc #0
    sta xa+1
    sec
    lda cx
    sbc xx
    sta xb
    lda cx+1
    sbc #0
    sta xb+1
    clc
    lda cx
    adc yy
    sta xc
    lda cx+1
    adc #0
    sta xc+1
    sec
    lda cx
    sbc yy
    sta xd
    lda cx+1
    sbc #0
    sta xd+1
    clc
    lda cy
    adc yy
    sta ya
    sec
    lda cy
    sbc yy
    sta yb
    clc
    lda cy
    adc xx
    sta yc
    sec
    lda cy
    sbc xx
    sta yd
    P(xa, ya, counting)
    P(xb, ya, counting)
    P(xa, yb, counting)
    P(xb, yb, counting)
    P(xc, yc, counting)
    P(xd, yc, counting)
    P(xc, yd, counting)
    P(xd, yd, counting)
    rts
}

plot8:   Plot8(0)
plot8c:  Plot8(1)

// Circle: centre (cx, cy), radius rad. x = r, y = 0, d = 1 - r; while
// x >= y: plot the eight points, y += 1, then d += 2y + 1 if d < 0,
// else x -= 1 and d += 2(y - x) + 1. d is 16 bits. x is unsigned, so
// r = 0 is taken apart: its step would take x below zero, to 255.
.macro Circle(p8) {
    lda rad
    bne !+
    sta xx
    sta yy
    jmp p8                       // r = 0: one pass, the centre
!:  sta xx
    lda #0
    sta yy
    sec
    lda #1
    sbc rad
    sta d
    lda #0
    sbc #0
    sta d+1
loop:
    lda xx
    cmp yy
    bcc done
    jsr p8
    inc yy
    lda d+1
    bmi neg
    dec xx                       // d >= 0: step x in
    sec
    lda yy
    sbc xx                       // y - x, -99..1
    tax
    lda #0
    sbc #0                       // its high byte, $FF when negative
    sta t
    txa
    asl
    rol t
    ora #1                       // 2(y - x) + 1
    clc
    adc d
    sta d
    lda t
    adc d+1
    sta d+1
    jmp loop
neg:
    lda yy                       // d < 0: 2y + 1, below 256 for y < 128
    asl
    ora #1
    clc
    adc d
    sta d
    lda d+1
    adc #0
    sta d+1
    jmp loop
done:
    rts
}

// The timed copy starts a page so that none of its branches crosses
// one: a taken branch into the next page costs a cycle more
// (pitfalls/cpu.md, branch_page_cross_extra_cycle).
.align $100
circle:  Circle(plot8)
circle_end:
.errorif (circle >> 8) != ((circle_end - 1) >> 8), "circle crosses a page"
circlec: Circle(plot8c)

// ---------------------------------------------------------------- octants
// Oct(bits): the same octant, (x, y) of each step folded into cs, with d
// in 16 bits or in one byte.
.macro Oct(bits) {
    lda rad
    sta xx
    lda #0
    sta yy
    sta cs
    sta cs+1
    sec
    lda #1
    sbc rad
    sta d
    lda #0
    sbc #0
    sta d+1
loop:
    lda xx
    cmp yy
    bcc done
    sta fr
    lda yy
    sta fr+1
    jsr fold
    inc yy
.if (bits == 16) {
    lda d+1
} else {
    lda d
}
    bmi neg
    dec xx
    sec
    lda yy
    sbc xx
    tax
    lda #0
    sbc #0
    sta t
    txa
    asl
    rol t
    ora #1
    clc
    adc d
    sta d
    lda t
    adc d+1
    sta d+1
    jmp loop
neg:
    lda yy
    asl
    ora #1
    clc
    adc d
    sta d
    lda d+1
    adc #0
    sta d+1
    jmp loop
done:
    rts
}

oct16:  Oct(16)
oct8:   Oct(8)                   // only the low byte of d is tested

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
// Time(routine, slot): CIA2 timer A counts phi2, timer B counts its
// underflows; the 24-bit count, net of an empty call, lands in slot.
.macro Time(routine, slot) {
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
    sta slot
    lda #$ff
    sbc $dd05
    sta slot+1
    lda #$ff
    sbc $dd06
    sta slot+2
    sec
    lda slot
    sbc empty
    sta slot
    lda slot+1
    sbc empty+1
    sta slot+1
    lda slot+2
    sbc #0
    sta slot+2
}

nothing:
    rts

.macro SetCircle(x, y, r) {
    lda #<x
    sta cx
    lda #>x
    sta cx+1
    lda #y
    sta cy
    lda #r
    sta rad
}

// ---------------------------------------------------------------- text
.macro PutStr(row, col, str) {
    lda #<[TEXT + row*40 + col]
    sta p2
    lda #>[TEXT + row*40 + col]
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

.macro At(row, col) {
    lda #<[TEXT + row*40 + col]
    sta p2
    lda #>[TEXT + row*40 + col]
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

// Num(row, col, from, bytes): a 1-, 2- or 3-byte value in decimal,
// seven characters wide, leading zeros as spaces
.macro Num(row, col, from, bytes) {
    lda from
    sta num
    lda #0
    sta num+1
    sta num+2
.if (bytes > 1) {
    lda from+1
    sta num+1
}
.if (bytes > 2) {
    lda from+2
    sta num+2
}
    At(row, col)
    jsr dec7
}

// render: TEXT's 120 screen codes into bitmap rows 22-24, eight bytes
// from the character ROM each. The ROM is read with I/O switched out.
render:
    lda $01
    pha
    and #$fb                     // CHAREN = 0: character ROM at $D000
    sta $01
    lda #<[BITMAP + 22*320]
    sta zp_ptr
    lda #>[BITMAP + 22*320]
    sta zp_ptr+1
    ldx #0
rn_cell:
    lda TEXT,x
    sta p1
    lda #0
    sta p1+1
    asl p1
    rol p1+1
    asl p1
    rol p1+1
    asl p1
    rol p1+1                     // code * 8
    lda p1+1
    ora #$d0
    sta p1+1
    ldy #7
!:  lda (p1),y
    sta (zp_ptr),y
    dey
    bpl !-
    clc
    lda zp_ptr
    adc #8
    sta zp_ptr
    bcc !+
    inc zp_ptr+1
!:  inx
    cpx #120
    bne rn_cell
    pla
    sta $01
    rts

// ---------------------------------------------------------------- main
start:
    sei
    lda #$00
    sta BORDER
    sta $d021
    lda #$10                     // every cell white ink on black paper
    ldx #0
!:  sta SCREEN,x
    sta SCREEN + $100,x
    sta SCREEN + $200,x
    sta SCREEN + $2e8,x
    inx
    bne !-
    lda #<BITMAP                 // clear $2000-$3FFF
    sta zp_ptr
    lda #>BITMAP
    sta zp_ptr+1
    lda #0
    tay
    ldx #32
!:  sta (zp_ptr),y
    iny
    bne !-
    inc zp_ptr+1
    dex
    bne !-
    lda #' '                     // text buffer: spaces
    ldx #119
!:  sta TEXT,x
    dex
    bpl !-
    lda #1
    sta ok

    // bitmap at $2000, screen at $0400, hires, display blanked (DEN
    // clear) while the timings run: no badline inside a timed call
    lda #$18
    sta $d018
    lda #$08
    sta $d016
    lda #$2b
    sta $d011
    lda #$00
    sta $dd0e
    sta $dd0f
    lda #$ff
    sta $dd04
    sta $dd05
    sta $dd06
    sta $dd07
!:  lda $d011                    // two frame tops: DEN is sampled on line $30
    bpl !-
!:  lda $d011
    bmi !-
!:  lda $d011
    bpl !-
!:  lda $d011
    bmi !-

    lda #0
    sta empty
    sta empty+1
    Time(nothing, t_empty)
    lda t_empty
    sta empty
    lda t_empty+1
    sta empty+1

    // -------- draw every circle, counting the plots
    lda #0
    sta plots
    sta plots+1
.for (var i = 0; i < NCIRC; i++) {
    .var c = circles.get(i)
    SetCircle(c.get(0), c.get(1), c.get(2))
    jsr circlec
}

    // -------- time three of them again (ORA leaves the bitmap as it is)
    SetCircle(160, 88, 80)
    Time(circle, t_r80)
    SetCircle(160, 88, 10)
    Time(circle, t_r10)
    SetCircle(40, 160, 0)
    Time(circle, t_r0)

    // -------- count the set bits and fold the bitmap, two bytes a word
    lda #0
    sta bits
    sta bits+1
    sta cs
    sta cs+1
    lda #<BITMAP
    sta zp_ptr
    lda #>BITMAP
    sta zp_ptr+1
    lda #<4000
    sta left
    lda #>4000
    sta left+1
cnt_word:
    ldy #0
    lda (zp_ptr),y
    sta fr
    jsr popcount
    iny
    lda (zp_ptr),y
    sta fr+1
    jsr popcount
    jsr fold
    clc
    lda zp_ptr
    adc #2
    sta zp_ptr
    bcc !+
    inc zp_ptr+1
!:  lda left
    bne !+
    dec left+1
!:  dec left
    lda left
    ora left+1
    bne cnt_word
    lda cs
    sta bmcs
    lda cs+1
    sta bmcs+1

    // -------- the octant with d in one byte against d in 16 bits
    lda #0
    sta wrong
    sta first
    lda #1
    sta rad
oct_loop:
    jsr oct16
    lda cs
    sta cs16
    lda cs+1
    sta cs16+1
    jsr oct8
    lda cs
    cmp cs16
    bne oct_bad
    lda cs+1
    cmp cs16+1
    beq oct_next
oct_bad:
    inc wrong
    lda first
    bne oct_next
    lda rad
    sta first
oct_next:
    inc rad
    lda rad
    cmp #100
    bne oct_loop

    // -------- checks
    lda plots
    cmp #<EXP_PLOTS
    bne bad
    lda plots+1
    cmp #>EXP_PLOTS
    bne bad
    lda bits
    cmp #<EXP_PIXELS
    bne bad
    lda bits+1
    cmp #>EXP_PIXELS
    bne bad
    lda bmcs
    cmp #<EXP_CS
    bne bad
    lda bmcs+1
    cmp #>EXP_CS
    bne bad
    lda wrong
    cmp #EXP_WRONG
    bne bad
    lda first
    cmp #EXP_FIRST
    beq checked
bad:
    lda #0
    sta ok
checked:

    // -------- results into the text rows
    PutStr(0, 0, "CYC R80")
    Num(0, 7, t_r80, 3)
    PutStr(0, 15, "R10")
    Num(0, 18, t_r10, 3)
    PutStr(0, 26, "R0")
    Num(0, 28, t_r0, 3)
    PutStr(1, 0, "PLOTS")
    Num(1, 5, plots, 2)
    PutStr(1, 13, "PIXELS")
    Num(1, 19, bits, 2)
    PutStr(1, 27, "SUM")
    At(1, 31)
    lda bmcs+1
    jsr hex2
    At(1, 33)
    lda bmcs
    jsr hex2
    PutStr(2, 0, "D IN 8 BITS")
    Num(2, 11, wrong, 1)
    PutStr(2, 19, "RADII FIRST")
    Num(2, 30, first, 1)
    lda ok
    beq !+
    PutStr(0, 36, "PASS")
    jmp !++
!:  PutStr(0, 36, "FAIL")
!:
    jsr render
    lda #$3b                     // display on
    sta $d011

    // -------- verdict
    lda ok
    beq fail
    lda #CODE_PASS
    sta RESULT
    lda #5
    sta BORDER
halt:
    jmp halt
fail:
    lda #CODE_FAIL
    sta RESULT
    lda #2
    sta BORDER
    jmp halt

// popcount: bits += set bits of A; keeps Y
popcount:
    ldx #8
!:  asl
    bcc !+
    inc bits
    bne !+
    inc bits+1
!:  dex
    bne !--
    rts

// ---------------------------------------------------------------- data
cx:     .word 0
cy:     .byte 0
rad:    .byte 0
xx:     .byte 0
yy:     .byte 0
d:      .word 0
t:      .byte 0
xa:     .word 0
xb:     .word 0
xc:     .word 0
xd:     .word 0
ya:     .byte 0
yb:     .byte 0
yc:     .byte 0
yd:     .byte 0
px:     .word 0
py:     .byte 0
plots:  .word 0
bits:   .word 0
cs:     .word 0
bmcs:   .word 0
cs16:   .fill 3, 0
fr:     .word 0
left:   .word 0
wrong:  .byte 0
first:  .byte 0
empty:  .word 0
t_empty: .fill 3, 0
t_r80:  .fill 3, 0
t_r10:  .fill 3, 0
t_r0:   .fill 3, 0
num:    .fill 3, 0
sub:    .fill 3, 0
dtry:   .word 0
tmp:    .byte 0
lead:   .byte 0
ok:     .byte 0

// Row address table: pixel (0, y) is in BITMAP + (y / 8) * 320 + (y & 7).
// Each table sits inside one page, so plot's indexed reads never cross.
.align $100
row_lo:
    .fill 200, <(BITMAP + floor(i / 8) * 320 + mod(i, 8))
.align $100
row_hi:
    .fill 200, >(BITMAP + floor(i / 8) * 320 + mod(i, 8))
mask:
    .byte $80, $40, $20, $10, $08, $04, $02, $01
```

## Build

```bash
java -jar KickAss.jar hires-circle.asm -o hires-circle.prg
```

## Expected output

Border green; twelve white circles on black; the bottom three text rows
read:

```
CYC R80  54714 R10   7740 R0    897 PASS
PLOTS   2264 PIXELS   2197 SUM E3C8
D IN 8 BITS     21 RADII FIRST     77
```

Screenshots from the pinned run, 8,000,000 cycles:
`screenshots/hires-circle.png` (PAL) and
`screenshots/hires-circle-ntsc.png` (NTSC). The three text rows decode
against the character ROM to the lines above on both. Border pixel
(2, 100) = (98, 213, 50) on PAL and (114, 189, 103) on NTSC, index 5 in
both palettes of `runtime/vice-reference.md`.

The circles were measured in both screenshots with a script: every
pixel of bitmap lines 0 to 175 that differs from the paper colour was
collected and compared with the model's pixel set. Both pictures have
2,197 lit pixels, all white (255, 255, 255) on black, and the set is
the model's exactly.

The model draws the same circles with the same integer steps:

```python
M = 0xffff
def fold(cs, r):                  # cs = rol16(cs) ^ r + 13
    cs = ((cs << 1) | (cs >> 15)) & M
    return ((cs ^ r) + 13) & M
def octant(r, bits=16):
    x, y, d, pts = r, 0, 1 - r, []
    while x >= y:
        pts.append((x, y))
        y += 1
        neg = d < 0 if bits == 16 else (d & 0x80) != 0
        if neg:
            d += 2 * y + 1
        else:
            x -= 1
            d += 2 * (y - x) + 1
        if bits == 8:
            d &= 0xff
    return pts
CIRCLES = [(160, 88, r) for r in range(10, 81, 10)] + \
          [(290, 40, 25), (24, 24, 3), (20, 160, 1), (40, 160, 0)]
bitmap, plots, pix = bytearray(8000), 0, set()
for cx, cy, r in CIRCLES:
    for x, y in octant(r):
        for px, py in [(cx + x, cy + y), (cx - x, cy + y), (cx + x, cy - y),
                       (cx - x, cy - y), (cx + y, cy + x), (cx - y, cy + x),
                       (cx + y, cy - x), (cx - y, cy - x)]:
            plots += 1
            pix.add((px, py))
            bitmap[(py // 8) * 320 + (py & 7) + (px & ~7)] |= 0x80 >> (px & 7)
cs = 0
for k in range(0, 8000, 2):
    cs = fold(cs, bitmap[k] | (bitmap[k + 1] << 8))
wrong = [r for r in range(1, 100) if octant(r, 8) != octant(r, 16)]
print(plots, len(pix), hex(cs), len(wrong), wrong[0])   # 2264 2197 0xe3c8 21 77
```

`PLOTS` is 2,264 and `PIXELS` 2,197: 67 points were plotted twice.
Where an octant ends at `x = y`, and where it starts at `y = 0`, two of
the eight mirror images are the same pixel (all eight, for radius 0). `ORA` sets a bit twice
harmlessly; a plot that draws with `EOR`, to erase by drawing again,
would clear those 67 pixels on the first pass (rung 3, not run here).

`CYC` is one call of the timed copy, net of an empty `JSR` / `RTS`,
with interrupts off and the display blanked (rung 1, VICE x64sc 3.10,
PAL and NTSC alike). Each equals the instruction-table count:

| Part | Cycles |
|---|---|
| one step's eight points: 152 to form them, 91 for each plot and its operand copy, 6 for the `RTS` | 886 |
| one step, `d` negative (`y` only) | 946 |
| one step, `d` not negative (`x` and `y`) | 977 |
| set-up and the last test | 48 |
| radius 10: 4 steps of each kind | 7,740 |
| radius 80: 33 of the first, 24 of the second | 54,714 |
| radius 0: one pass of the eight points | 897 |

A first build of the listing had the timed routine at `$0AA6`, across
the page boundary at `$0B00`, and measured 7,745 and 54,748: 5 and 34
above the counts, one cycle for each negative step and one more, which
is what a taken `BMI` to the negative case and the final `BCC` cost
when each crosses the page (`pitfalls/cpu.md`,
`branch_page_cross_extra_cycle`). The listing now aligns that routine
to a page, and an `.errorif` fails the build if it grows across one.

`D IN 8 BITS` is the octant with only the low byte of `d` tested for
its sign. It matches the 16-bit form for every radius up to 76 and
differs on 21 of the 23 radii from 77 to 99 (82 and 83 come out right
by chance). From radius 77, `d` falls below -128 on some step, to -129
at 77 and -174 at 99; the byte then has bit 7 clear, `BMI` reads it as
not negative, and `x` steps in too early (`pitfalls/cpu.md`,
`signed_compare_bmi_overflow`).

## Why this works

### The midpoint step

Walk one eighth of the circle, from `(r, 0)` up to the diagonal, one
pixel of `y` per step. At each step the next pixel is either straight
up or up and one to the left. `d` is the value of `x² + y² - r²` at the
midpoint between the two candidates, scaled to stay an integer: below
zero the midpoint is inside the circle and `x` stays, otherwise `x`
steps in. Both updates are additions of `2y + 1` or `2(y - x) + 1`, so
the loop needs no multiply. Mirroring the point across both axes and
the diagonal gives the other seven eighths.

### Ranges and widths

`x` and `y` stay between 0 and `r`, so they fit a byte for any circle
on the screen. `d` does not: it starts at `1 - r` and dips lower, to
-129 for radius 77 and -174 for 99, while its largest value stays
below 128 up to radius 99 (from the model). Two bytes cover any
radius the screen holds. The centre's `x` needs two bytes on a
320-pixel bitmap.
`x` is unsigned, so the listing takes radius 0 apart: its first step
would take `x` from 0 to 255 instead of -1, and the loop would run on.

### Cost

Nearly all the time is in the eight plots of each step, 728 of the 886
cycles. A circle of radius `r` takes about `r / √2` steps (57 for
radius 80), so about 680 cycles per unit of radius with this plot
routine. Putting the plot in line instead of calling it saves the
`JSR` / `RTS`, 12 cycles a point and 96 a step (rung 3).

### Text in a bitmap

The bottom three character rows are drawn by copying eight bytes per
character from the character ROM into the bitmap cell, since a bitmap
has no text mode. The ROM is read at `$D000` with `CHAREN` (bit 2 of
`$01`) cleared, which swaps it in place of the I/O chips, so the copy
runs with interrupts off.
