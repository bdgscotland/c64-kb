---
recipe: sine-table-runtime
toolchain: kickassembler
output_format: PRG
region: both
techniques: [sine_table_generation]
file_formats: [PRG]
uses_registers: [D000, D001, D002, D003, D004, D005, D006, D007, D008, D009, D00A, D00B, D00C, D00D, D00E, D00F, D010, D011, D012, D015, D017, D01C, D01D, D020, D027, D028, D029, D02A, D02B, D02C, D02D, D02E, DD04, DD05, DD06, DD07, DD0E, DD0F]
uses_kernal: [CHROUT]
---

<!-- doc-type: recipe -->

# KickAssembler — Sine Table Built at Run Time

## Synopsis

Builds a 256-entry sine table on the C64 itself, three ways, with no
table from the assembler: a parabola by its exact second difference, a
fixed-point second-difference recurrence run for a whole turn, and the
same recurrence run for a quarter turn and unfolded by symmetry. Every
generated entry is compared with a reference the assembler computed
(`128 + round(127 * sin)`), each generation is timed with the CIA2 timers,
and the screen shows the cycles, the worst error and the sum of errors per
method in decimal. Eight sprites then ride the quarter-wave table so the
picture shows the shape. This is the `sine_table_generation` technique;
use it when the table has to be made in RAM by a program that cannot
carry it as data, such as an Oscar64 build with no floating point or a
routine that needs a different amplitude each time it runs.

Verified in VICE x64sc 3.10: the figures on screen are identical on PAL
and NTSC, the recurrence table dumped from the machine is byte-identical
to a Python model of the same integer arithmetic, and the eight sprite
tops in the pinned picture match the table at one phase.

## Source

```asm
// sine-table-runtime.asm
// Builds a 256-entry sine table on the C64 three ways, with no table from
// the assembler: an exact second-difference parabola (PARAB), a 8.16
// fixed-point second-difference recurrence run for a whole turn (RECUR),
// and the same recurrence run for a quarter turn and unfolded by symmetry
// (QUART). Each table is compared entry by entry with a reference the
// assembler computed, 128 + round(127 * sin), and the generation is timed
// with the CIA2 timers. A fourth line (DRIFT) continues the recurrence for
// a second turn and compares that too. The screen shows, per method, the
// cycles, the worst error and the sum of errors, all in decimal. Eight
// sprites then ride the QUART table so the picture shows the shape.
// Verdict: $02FF = $01 and a green border when RECUR and QUART are within
// one unit everywhere, $02FF = $02 and a red border otherwise.

BasicUpstart2(start)

.const CHROUT   = $ffd2
.const RESULT   = $02ff          // verdict byte read by the harness
.const BORDER   = $d020
.const CODE_PASS = $01
.const CODE_FAIL = $02

.const SCREEN   = $0400
.const SPRDATA  = $2000          // 64-byte aligned; pointer = $2000/64 = $80
.const T_PARAB  = $3000          // the four generated tables, page-aligned
.const T_RECUR  = $3100
.const T_QUART  = $3200
.const T_DRIFT  = $3300

.const AMP      = 127
.const FRAC     = 16             // fraction bits of the recurrence state
// First difference of the recurrence: y[1] - y[0] = AMP * sin(2 pi / 256),
// the one constant the assembler supplies. It is a number, not a table.
.const V0       = round(AMP * sin(toRadians(360 / 256)) * pow(2, FRAC))

.const ptr      = $fb            // zero-page pointer for puts
.const y        = $02            // recurrence state, 24-bit signed 8.16
.const v        = $05            // first difference, 24-bit signed
.const a        = $08            // y >> 11 and its further shifts, 16-bit
.const t        = $0a            // sum of the shifted terms, 16-bit
.const i        = $0c            // loop index
.const p        = $0d            // parabola value, 16-bit
.const dlt      = $0f            // parabola first difference, 16-bit
.const o        = $11            // the byte step returns

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
    sec                          // the routine's carry must not leak in
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

// Check(table, slot): worst and summed |table - ref| into slot (max at
// slot, 16-bit sum at slot+1), then print a line "MAX n SUM s".
.macro Check(table, slot) {
    lda #<table
    sta chk_lo
    lda #>table
    sta chk_hi
    jsr check
    lda err_max
    sta slot
    lda err_sum
    sta slot+1
    lda err_sum+1
    sta slot+2
}

// Report(label, cycles, errs): one screen line.
.macro Report(label, cycles, errs) {
    ldx #<label
    ldy #>label
    jsr puts
    PutDec(cycles)
    ldx #<maxtext
    ldy #>maxtext
    jsr puts
    lda errs
    sta num
    lda #0
    sta num+1
    sta num+2
    jsr putdec
    ldx #<sumtext
    ldy #>sumtext
    jsr puts
    lda errs+1
    sta num
    lda errs+2
    sta num+1
    lda #0
    sta num+2
    jsr putdec
    lda #$0d
    jsr CHROUT
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
    Time(gen_parab, t_parab)
    Time(gen_recur, t_recur)
    Time(gen_drift, t_drift)     // the turn after it, same state
    Time(gen_quart, t_quart)

    lda $d011                    // screen back on
    ora #$10
    sta $d011
    cli

    Net(t_parab)
    Net(t_recur)
    Net(t_quart)
    Net(t_drift)

    Check(T_PARAB, e_parab)
    Check(T_RECUR, e_recur)
    Check(T_QUART, e_quart)
    Check(T_DRIFT, e_drift)

    lda e_recur                  // verdict: RECUR and QUART within 1 unit
    cmp #2
    bcs fail
    lda e_quart
    cmp #2
    bcs fail
    lda #CODE_PASS
    ldy #5                       // green
    bne checkpoint
fail:
    lda #CODE_FAIL
    ldy #2                       // red
checkpoint:
    sta RESULT                   // the harness watches this store
    sty BORDER

    lda #$93                     // clear the screen, cursor home
    jsr CHROUT
    Report(parabtext, t_parab, e_parab)
    Report(recurtext, t_recur, e_recur)
    Report(quarttext, t_quart, e_quart)
    Report(drifttext, t_drift, e_drift)
    ldx #<restext
    ldy #>restext
    jsr puts
    lda RESULT
    jsr hexbyte
    lda #$0d
    jsr CHROUT

    // eight sprites, 32 table steps apart, ride the QUART table
    ldx #7
setup:
    lda #SPRDATA/64
    sta SCREEN+$3f8,x
    lda #1                       // white
    sta $d027,x
    dex
    bpl setup
    lda #0
    sta $d017
    sta $d01d
    sta $d01c
    sta $d010
    sta frame
    lda #$ff
    sta $d015

loop:
    lda #255                     // wait for raster line 255
!:  cmp $d012
    bne !-
    inc frame
    lda frame                    // base index = frame * 2 (mod 256)
    asl
    sta idx
    ldx #0                       // sprite number
next:
    ldy idx
    lda T_QUART,y                // 1..255
    lsr                          // 0..127
    clc
    adc #100                     // Y = 100..227, inside the display
    ldy pairs,x
    sta $d001,y
    lda xpos,x
    sta $d000,y
    lda idx
    clc
    adc #32
    sta idx
    inx
    cpx #8
    bne next
!:  lda $d012                    // leave line 255 before waiting again
    cmp #255
    beq !-
    jmp loop

nothing:
    rts

// ---------------------------------------------------------------------------
// gen_parab: half a wave as the parabola p(i) = i * (128 - i), built by its
// exact second difference (dlt starts at 127 and falls by 2), scaled to
// amplitude 127 by v = (p - p/128 + 16) / 32, and mirrored: entry 128 + i
// is 256 - entry i.
// ---------------------------------------------------------------------------
gen_parab:
    lda #0
    sta p
    sta p+1
    sta dlt+1
    sta i
    lda #127
    sta dlt
!:  lda p                        // t = p >> 7, at most 32
    asl
    lda p+1
    rol
    sta t
    sec
    lda p                        // a = p - t + 16
    sbc t
    sta a
    lda p+1
    sbc #0
    sta a+1
    clc
    lda a
    adc #16
    sta a
    bcc !+
    inc a+1
!:  ldx #5                       // a >>= 5
!:  lsr a+1
    ror a
    dex
    bne !-
    ldx i
    lda #128
    clc
    adc a
    sta T_PARAB,x
    lda #128
    sec
    sbc a
    sta T_PARAB+128,x
    clc                          // p += dlt
    lda p
    adc dlt
    sta p
    lda p+1
    adc dlt+1
    sta p+1
    sec                          // dlt -= 2
    lda dlt
    sbc #2
    sta dlt
    lda dlt+1
    sbc #0
    sta dlt+1
    inc i
    lda i
    bpl !---                     // i = 0..127
    rts

// ---------------------------------------------------------------------------
// The recurrence. State y (8.16 signed) and first difference v (signed).
// step: y += v ; v -= d * y, with d = 2 - 2 cos(2 pi / 256) approximated
// by y/2^11 + y/2^14 + y/2^15 + y/2^16 + y/2^17, each an arithmetic shift
// of the one before. Returns A = 128 + round(y) as it was on entry, the
// table byte for this step.
// ---------------------------------------------------------------------------
reset:
    lda #0
    sta y
    sta y+1
    sta y+2
    lda #<V0
    sta v
    lda #>V0
    sta v+1
    lda #(V0 >> 16)
    sta v+2
    rts

step:
    lda y+1                      // the byte for this entry, 128 + round(y):
    asl                          // carry = bit 15 of the fraction
    lda y+2
    adc #0
    eor #$80
    sta o
    clc                          // then advance: y += v
    lda y
    adc v
    sta y
    lda y+1
    adc v+1
    sta y+1
    lda y+2
    adc v+2
    sta y+2
    lda y+1                      // a = y >> 11: drop the low byte, then 3
    sta a
    lda y+2
    sta a+1
    jsr asr3
    lda a                        // t = a
    sta t
    lda a+1
    sta t+1
    jsr asr3                     // a = y >> 14
    jsr addt
    jsr asr1                     // y >> 15
    jsr addt
    jsr asr1                     // y >> 16
    jsr addt
    jsr asr1                     // y >> 17
    jsr addt
    sec                          // v -= t, t sign-extended to 24 bits
    lda v
    sbc t
    sta v
    lda v+1
    sbc t+1
    sta v+1
    ldy #0                       // Y = sign extension of t
    lda t+1
    bpl !+
    dey
!:  sty t+1
    lda v+2
    sbc t+1
    sta v+2
    lda o
    rts

asr3:
    jsr asr1
    jsr asr1
asr1:                            // 16-bit arithmetic shift right of a
    lda a+1
    cmp #$80
    ror a+1
    ror a
    rts

addt:                            // t += a
    clc
    lda t
    adc a
    sta t
    lda t+1
    adc a+1
    sta t+1
    rts

gen_recur:                       // one whole turn, 256 steps
    jsr reset
    ldx #0
!:  jsr step
    sta T_RECUR,x
    inx
    bne !-
    rts

gen_drift:                       // the turn after it, same state
    ldx #0
!:  jsr step
    sta T_DRIFT,x
    inx
    bne !-
    rts

gen_quart:                       // 65 steps, then four writes per step
    jsr reset
    lda #0
    sta i
!:  jsr step
    ldx i
    sta T_QUART,x                // entry i
    ldy #128
    sty t
    sec
    lda t
    sbc i
    tay
    txa
    pha
    lda T_QUART,x
    sta T_QUART,y                // entry 128 - i, same value
    eor #$ff                     // 256 - value: negate about 128
    clc
    adc #1
    tay
    pla
    clc
    adc #128
    tax
    tya
    sta T_QUART,x                // entry 128 + i
    lda #0
    sec
    sbc i
    tax
    tya
    sta T_QUART,x                // entry 256 - i (entry 0 when i = 0)
    inc i
    lda i
    cmp #65
    bne !-
    rts

// ---------------------------------------------------------------------------
// check: err_max = max |table[i] - ref[i]|, err_sum = the sum, 16-bit.
// ---------------------------------------------------------------------------
check:
    lda #0
    sta err_max
    sta err_sum
    sta err_sum+1
    ldx #0
chk_loop:
    sec
.label chk_lo = * + 1
.label chk_hi = * + 2
    lda $ffff,x
    sbc ref,x
    bcs !+
    eor #$ff                     // negative: negate
    adc #1
!:  cmp err_max
    bcc !+
    sta err_max
!:  clc
    adc err_sum
    sta err_sum
    bcc !+
    inc err_sum+1
!:  inx
    bne chk_loop
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
    beq next_digit               // suppress a leading zero
    lda #'0'
show:
    jsr CHROUT
    inc lead
next_digit:
    inx
    inx
    inx
    cpx #7 * 3
    bne digit
    rts

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

empty:   .byte 0, 0, 0
t_parab: .byte 0, 0, 0
t_recur: .byte 0, 0, 0
t_quart: .byte 0, 0, 0
t_drift: .byte 0, 0, 0
e_parab: .byte 0, 0, 0           // max, sum lo, sum hi
e_recur: .byte 0, 0, 0
e_quart: .byte 0, 0, 0
e_drift: .byte 0, 0, 0
err_max: .byte 0
err_sum: .word 0
num:     .byte 0, 0, 0
dig:     .byte 0
lead:    .byte 0
frame:   .byte 0
idx:     .byte 0

pairs:   .byte 0, 2, 4, 6, 8, 10, 12, 14
xpos:    .byte 24, 56, 88, 120, 152, 184, 216, 248

.encoding "petscii_upper"
parabtext: .text "PARAB "
           .byte 0
recurtext: .text "RECUR "
           .byte 0
quarttext: .text "QUART "
           .byte 0
drifttext: .text "DRIFT "
           .byte 0
maxtext:   .text " MAX "
           .byte 0
sumtext:   .text " SUM "
           .byte 0
restext:   .text "RESULT "
           .byte 0

// The reference the tables are checked against: the assembler's own
// 128 + round(127 * sin), the sin_r127 scaling of table_generation.
.align $100
ref:    .fill 256, 128 + round(AMP * sin(toRadians(i * 360 / 256)))

.pc = SPRDATA "sprite"
.fill 63, $ff                    // a solid 24x21 block
```

## Build

```bash
java -jar KickAss.jar sine-table-runtime.asm -o sine-table-runtime.prg
```

Run headless (either model; PAL shown):

```bash
GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas x64sc -default -minimized -warp +sound \
  +autostart-delay-random -autostartprgmode 1 -limitcycles 8000000 \
  -exitscreenshot sine-table-runtime.png -autostart sine-table-runtime.prg
```

## Expected output

Blue screen, green border. Five lines of light-blue text at the top, then
eight white 24 by 21 blocks in a row 32 pixels apart, X 24 to 248, each
riding the quarter-wave table one eighth of a turn behind the one to its
left, so the row is one whole sine wave and it rolls left two table steps
a frame. The text, measured by decoding the exit screenshot against the
character ROM, is the same on PAL and NTSC:

```text
PARAB 25266 MAX 8 SUM 980
RECUR 129190 MAX 1 SUM 21
QUART 38067 MAX 1 SUM 4
DRIFT 129153 MAX 1 SUM 48
RESULT 01
```

The first number on each line is the cycles the generator took, less the
17 cycles of an empty timed call (the `JSR`, the `RTS` and the
instructions that stop timer A). `MAX` is the largest difference in
units between a generated entry and the reference, `SUM` the sum of the
absolute differences over 256 entries, so the mean error is `SUM / 256`.
`RESULT 01` and the green border say RECUR and QUART are within one unit
everywhere; `02` and a red border say one of them is not.

Screenshots from the pinned run, 8,000,000 cycles, both models:
`screenshots/sine-table-runtime.png` and
`screenshots/sine-table-runtime-ntsc.png`.

| Line | Method | Cycles for 256 entries | Per entry | PAL frames | Worst error | Mean error |
|---|---|---|---|---|---|---|
| PARAB | parabola, exact second difference, mirrored | 25,266 | 99 | 1.3 | 8 | 3.83 |
| RECUR | 8.16 recurrence, 256 steps | 129,190 | 505 | 6.6 | 1 | 0.08 |
| QUART | 8.16 recurrence, 65 steps, unfolded | 38,067 | 149 | 1.9 | 1 | 0.02 |
| DRIFT | RECUR continued for a second turn | 129,153 | 505 | 6.6 | 1 | 0.19 |

Cycles and errors are the screen's figures; the per-entry, frame and mean
columns are arithmetic from them (PAL frame 19,656 cycles). DRIFT differs
from RECUR by 37 cycles because the one branch in `step`, on the sign of
the correction term, is taken a different number of times.

### Reading the sprites off the picture

A sprite's first row is drawn on the line after the one in its Y register
(`sprite-sine-chain.md` measures the same), and the picture's row is the
line minus 16 on PAL and minus 28 on NTSC. Sprite n's Y is
`100 + (table[(2 * frame + 32 * n) mod 256] >> 1)`. Measured with PIL as
the first white pixel in column X + 20 of each sprite:

| Model | Top rows (raster lines) of sprites 0 to 7 | Table phase that predicts every one |
|---|---|---|
| PAL | 103, 132, 180, 219, 226, 197, 149, 110 | index 202, entries 5, 63, 159, 237, 251, 193, 97, 19 |
| NTSC | 177, 218, 227, 200, 152, 112, 102, 129 | index 8, entries 153, 234, 253, 199, 103, 22, 3, 57 |

Each set matches exactly one even phase, and the eight Y values in the
VIC registers at the last frame of the PAL run, read through a
`trace store d00f` tracepoint, are the top rows less one.

## Why this works

**The parabola.** `p(i) = i * (128 - i)` has a constant second difference,
so it is built with two 16-bit additions per entry and no multiply: the
first difference starts at 127 and falls by 2 each step. Scaling by
`127 / 4096` is done as `p - p / 128`, then `+ 16` and a shift right by 5
to round. The half wave is mirrored, entry `128 + i` is `256 - entry i`,
which is exact because the reference scaling is symmetric about 128. It
is the cheapest generator and the roughest: a parabola is 8 units from
the sine at its worst, near the zero crossings, and 3.8 units off on
average. It is enough for a bounce or a wobble, not for a smooth scroller.

**The recurrence.** A sine satisfies `y[n+1] = 2 y[n] - y[n-1] - d y[n]`
with `d = 2 - 2 cos(2 pi / 256)`, about `0.000602`. The listing keeps
the state as `y` and its first difference `v` in 8.16 fixed point, and
each step does `y += v` then `v -= d * y`. The multiply by `d` is five
arithmetic shifts, `y / 2^11 + y / 2^14 + y / 2^15 + y / 2^16 + y / 2^17`,
each a shift of the one before, which sums to `0.00060272` against the
true `0.00060236`, a frequency error of 0.03 %. The amplitude is set by
the first difference alone: `V0 = round(127 * sin(2 pi / 256) * 65536)`,
the one constant the assembler supplies and the only place a sine is
evaluated; an Oscar64 build folds the same expression at compile time,
and `127 * 2 pi / 256 * 65536` (204,279, arithmetic) is within 0.1 % of
it for a build with no `sin` at all. The byte for entry n is taken before
the step advances the state; an earlier draft took it after and every
entry was the next one's, which read as a worst error of 4.

**Why 16 fraction bits.** The shifts floor, so each step under-corrects
`v` by a fraction of its last bit, and an error in `v` grows into `y` as
the square of the step count: with 16 fraction bits the bound over one
turn is about a unit (arithmetic, `2.5 / 65536` a step over 256 steps),
with 8 it would be hundreds. Measured, the table is within one unit of
the reference everywhere and off by one in 21 places after one turn, and
in 48 places after a second turn, still no worse than one unit.
The same integer algorithm run on the host for eight turns reaches a
worst error of 2 units on the fifth turn (Python, not run on the
machine). A generator that runs once and stops has no drift problem; a
generator that keeps stepping frame after frame, as an oscillator rather
than a table, should reset its state every turn.

**The quarter wave.** A rounded sine of amplitude 127 about 128 is even
about entry 64 and odd about entry 128, so 65 values fix all 256. QUART
runs the same recurrence for 65 steps and writes four entries per step,
`i`, `128 - i`, `128 + i` and `256 - i`, the last two as `256 - value`.
It costs 3.4 times less than the full turn and is more accurate, because
the recurrence has only 64 steps to drift in: four entries off by one
against 21. The unfold's own cost, about 5,250 cycles of the 38,067
(arithmetic: 65 steps at RECUR's 505 a step, subtracted), is the same job
`table_generation` in `techniques/cpu-cycle-tricks.md` measures at 5,190
cycles in Oscar64 from a 65-byte host table.

**The measurement.** CIA2 timer A counts phi2 and timer B counts A's
underflows, the cascade `speedcode-generator.md` describes; the four
timed calls run under `SEI` with the screen blanked, so no badline steals
cycles from the count, and DEN is dropped a frame early because the VIC
samples it once, on line $30. The read of the count sets the carry
before its first `SBC`, because the timed routine returns with the carry
in either state and a borrow there reads one cycle high or low. The
check subtracts the reference from each
entry, negates a negative difference, and keeps the largest and a 16-bit
sum. The sprites read the QUART table shifted right once and add 100, so
the wave spans Y 100 to 227 and stays inside the display.

## What this recipe does not show

Scaling the table to another amplitude after it is built. The recurrence
takes its amplitude from `V0`, so a different amplitude is a different
`V0`, and an offset is an add at read time or a different constant in the
`eor #$80` step; the technique page covers both. Bhaskara's rational
approximation, which the technique page quotes from host arithmetic only,
is not implemented here.
