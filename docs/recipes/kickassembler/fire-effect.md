---
recipe: fire-effect
toolchain: kickassembler
output_format: PRG
region: both
techniques: [fire_effect, lfsr_random]
file_formats: [PRG]
uses_registers: [D011, D020, D021, DC04, DC05, DC0D, DC0E]
uses_kernal: []
---

<!-- doc-type: recipe -->

# KickAssembler — Fire Effect

## Synopsis

A character-mode fire. Screen RAM holds the reverse space (screen code
160) in every cell, so every pixel of a cell takes its colour-RAM colour
and the picture is colour RAM alone. A 40 by 25 heat map in RAM holds
values 0 to 63; each update seeds the bottom row from an 8-bit LFSR,
then works up the screen making each cell the mean of the three cells
below it and the cell two below, less one, and writes a 64-entry palette
entry for the new heat into colour RAM. The whole screen costs more than
a frame, so the update runs in two halves on alternate line-256
crossings. Use it when a demo part or a title screen wants a flame that
costs no character data and no bitmap.

Verified in VICE x64sc: a flame in brown, red, orange, light red and
yellow rises from a white and yellow base at the bottom of a black
screen, moving every other frame.

## Source

```asm
// fire-effect.asm
// A character-mode fire. Screen RAM holds one solid glyph (screen code 160,
// the reverse space) in every cell, so the picture is colour RAM alone. A
// 40 by 25 heat map (values 0..63) lives in RAM; every update seeds the
// bottom row from an 8-bit LFSR, then for rows 23 down to 0 each cell
// becomes the mean of the three cells below it and the cell two below,
// less DECAY, floored at 0, and the cell's colour is a 64-entry palette
// indexed by its heat.
//
// The whole screen costs more than a frame, so the update runs in two
// halves: the seed row and rows 23..12 after one frame's line-256
// crossing, rows 11..0 after the next. Nothing is cycle-exact.
//
// Region: both. Costs measured with CIA1 timer A (see the recipe page).

.const DECAY   = 1           // heat lost per row; 0 is the control build
.const SEED    = $5a         // LFSR seed, never zero
.const HOT     = 63          // heat of a lit seed cell
.const SCREEN  = $0400
.const COLOUR  = $d800
.const HEAT    = $3000       // 25 rows of 40 bytes
.const TIMES   = $0340       // six timer bytes and a done byte, for the monitor

BasicUpstart2(start)

// ---------------------------------------------------------------------------
// Tables, built by the assembler.
// ---------------------------------------------------------------------------
* = $3400
// Heat 0..63 to a VIC colour. Seven colours in rising luminance order:
// black, brown, red, orange, light red, yellow, white. The first five
// take eight steps each, yellow and white twelve, so the top of the
// flame stays bright for longer than the base darkens.
palette:
    .fill 8, 0
    .fill 8, 9
    .fill 8, 2
    .fill 8, 8
    .fill 8, 10
    .fill 12, 7
    .fill 12, 1
lfsr:   .byte SEED

// ---------------------------------------------------------------------------
// One row of the heat map: row r from rows r+1 and r+2 (row 23 reads row
// 24 twice). Columns 1..38 run in a loop indexed by X; columns 0 and 39
// are written out separately with their own cell used in place of the
// missing neighbour. The sum of four values of at most 63 is at most 252,
// so it fits one byte; two shifts divide by four.
// ---------------------------------------------------------------------------
// Edge cell: absolute operands.
.macro CellEdge(dst, a, b, c, d, cdst) {
    clc
    lda a
    adc b
    adc c
    adc d
    lsr
    lsr
    beq !+
    sec
    sbc #DECAY
!:  sta dst
    tay
    lda palette, y
    sta cdst
}

// Inner cell: X is the column, 1..38.
.macro CellX(r0, r1, r2, cr) {
    clc
    lda r1 - 1, x
    adc r1, x
    adc r1 + 1, x
    adc r2, x
    lsr
    lsr
    beq !+
    sec
    sbc #DECAY
!:  sta r0, x
    tay
    lda palette, y
    sta cr, x
}

.macro FireRow(r) {
    .const r0 = HEAT + r * 40
    .const r1 = HEAT + (r + 1) * 40
    .const r2 = HEAT + min(r + 2, 24) * 40
    .const cr = COLOUR + r * 40
    CellEdge(r0, r1, r1, r1 + 1, r2, cr)
    ldx #1
!loop:
    CellX(r0, r1, r2, cr)
    inx
    cpx #39
    bne !loop-
    CellEdge(r0 + 39, r1 + 38, r1 + 39, r1 + 39, r2 + 39, cr + 39)
}

.macro TimerStart() {
    lda #$ff
    sta $dc04
    sta $dc05
    lda #$19                 // start, one-shot, force load from $FFFF
    sta $dc0e
}

.macro TimerStop(dst) {
    lda $dc04
    sta dst
    lda $dc05
    sta dst + 1
}

// ---------------------------------------------------------------------------
// Code
// ---------------------------------------------------------------------------
* = $0900
start:
    sei
    lda #$7f
    sta $dc0d                // CIA1 interrupts off: timer A is ours now
    lda $dc0d
    lda #0
    sta $d020
    sta $d021
    ldx #0
!:  lda #160                 // reverse space: every pixel takes the cell colour
    sta SCREEN, x
    sta SCREEN + $100, x
    sta SCREEN + $200, x
    sta SCREEN + $300, x
    lda #0
    sta COLOUR, x
    sta COLOUR + $100, x
    sta COLOUR + $200, x
    sta COLOUR + $300, x
    sta HEAT, x
    sta HEAT + $100, x
    sta HEAT + $200, x
    sta HEAT + $300, x
    inx
    bne !-

    // Three timed updates for the monitor, before the free-running loop:
    // whole screen, bottom half, top half.
    TimerStart()
    jsr bottom_half
    jsr top_half
    TimerStop(TIMES)
    TimerStart()
    jsr bottom_half
    TimerStop(TIMES + 2)
    TimerStart()
    jsr top_half
    TimerStop(TIMES + 4)
    lda #1
    sta TIMES + 6

main:
    jsr wait_frame
    jsr bottom_half
    jsr wait_frame
    jsr top_half
    jmp main

// Wait for a fresh crossing of raster line 256 ($D011 bit 7 clear, then set).
wait_frame:
!:  bit $d011
    bmi !-
!:  bit $d011
    bpl !-
    rts

// Seed row 24: one LFSR step per column, bit 0 of the state lights the cell.
seed_row:
    ldx #0
!seed:
    lda lfsr
    lsr
    bcc !+
    eor #$b8
!:  sta lfsr
    and #1
    beq !+
    lda #HOT
!:  sta HEAT + 24 * 40, x
    tay
    lda palette, y
    sta COLOUR + 24 * 40, x
    inx
    cpx #40
    bne !seed-
    rts

bottom_half:
    jsr seed_row
    .for (var r = 23; r >= 12; r--) {
        FireRow(r)
    }
    rts

top_half:
    .for (var r = 11; r >= 0; r--) {
        FireRow(r)
    }
    rts
```

## Build

```bash
java -jar KickAss.jar fire-effect.asm -o fire-effect.prg
```

## Expected output

Black border and background. The bottom row is white in the cells the
LFSR lit and black in the rest (20 of each in the pinned picture). The
row above is yellow and orange, and the colours cool going up through
light red, red and brown; the flame rises higher than the screen with
`DECAY = 1`, so the top row is about half black and half brown rather
than all black. The picture changes every other frame and repeats
exactly from one run to the next, because the LFSR starts from the
constant `SEED`.

Screenshots from the VICE runs this page describes:
`screenshots/fire-effect.png` (PAL) and `screenshots/fire-effect-ntsc.png`
(NTSC), both at cycle limit 6,565,800. That limit puts the beam in the
vertical blank on both models, roughly 2,000 cycles inside a window in
which the picture does not change: the same PNG came out at 6,564,000,
6,565,800 twice and 6,567,600 on each model (md5
`9cf5a7244f8ecd4a7b143e94401f05f4` PAL, `5b9cff8f31439dafa11fdd511400b8fb`
NTSC). Sampling the centre pixel of every cell of the PAL picture and
matching it against VICE's default palette gives, over the 1,000 cells:
212 black, 216 brown, 256 red, 171 orange, 76 light red, 44 yellow and
25 white. Row 0 is 20 black, 18 brown and 2 red; row 23 is 12 yellow,
13 orange, 10 brown, 3 black and 2 white; row 24 is 20 white and 20
black. On NTSC the same census is 418 black, 236 brown, 145 red, 79
orange, 47 light red, 42 yellow and 33 white: the NTSC frame is shorter,
so the fire has had fewer updates at the same cycle count and stands
lower.

Control: the same listing with `DECAY = 0`, run to the same cycle limit
on PAL, gives 60 black, 91 brown, 171 red, 271 orange, 285 light red, 94
yellow and 28 white, with one black cell in each of rows 0 to 14. The
fire fills the screen but does not saturate to white: the divide by four
throws away up to three quarters of a unit per cell per row, which is a
decay of its own, so the top rows settle on orange and light red.

## Why this works

### Colour RAM is the picture

In standard text mode, colour RAM sets the colour of a cell's set
pixels and `$D021` its clear pixels. The reverse space has every pixel
set, so with `$D021` black a cell shows its colour-RAM nibble and
nothing else, and the fire is one 4-bit store per cell with no
character data at all. `plasma` in `../../techniques/effects-vector-3d.md`
uses the same fill; an all-`$FF` custom glyph would do as well.

### The heat rule

For row `r` and column `c` the new heat is

```
heat[r][c] = (heat[r+1][c-1] + heat[r+1][c] + heat[r+1][c+1] + heat[r+2][c]) / 4 - DECAY
```

floored at zero. Three edge rules complete it: column 0 uses itself
where `c-1` would be, column 39 uses itself where `c+1` would be, and
row 23 reads row 24 twice because there is no row 25. The `FireRow`
macro writes columns 0 and 39 out as straight absolute code with their
own cell in place of the missing neighbour, and runs columns 1 to 38 in
a loop indexed by X; `min(r + 2, 24)` picks row 24 as the "two below"
row for row 23. Rows go 23 down to 0, so each row reads the rows below
it as already updated this pass, which is what carries heat upward.

Four values of at most 63 sum to at most 252, so the sum fits one byte
and no 16-bit temporary is needed; that is why heat runs 0 to 63 and
not 0 to 255. Two `lsr` divide by four, `beq` skips the subtract when
the quotient is already zero, and `sec` / `sbc #DECAY` takes the decay
off otherwise, so the floor at zero costs one branch. `DECAY = 0` is the
control on this page; the `beq` still runs, so the two builds have the
same cycle cost.

### The seed row

Row 24 is the source. For each of its forty cells the LFSR steps once
(Galois form, shift right, XOR `$B8` when a 1 falls out: `lfsr_random`
in `../../techniques/maths.md`) and bit 0 of the new state decides the
cell: 63 if set, 0 if clear. The seed is the constant `$5A`. It is not
zero, and a Galois LFSR never reaches zero from a non-zero state, so
`lfsr_zero_state_lockup` (`../../pitfalls/cpu.md`) cannot arise unless
the constant is changed; the same constant is why the picture is
identical from run to run and can be pinned.

### The palette

Sixty-four bytes map heat to a VIC colour:

```
heat  0- 7: 0  black
heat  8-15: 9  brown
heat 16-23: 2  red
heat 24-31: 8  orange
heat 32-39: 10 light red
heat 40-51: 7  yellow
heat 52-63: 1  white
```

The seven colours are in rising luminance order. `colour_fade` in
`../../techniques/transitions.md` ranks all sixteen VICE PAL colours by
Y as 0, 6, 9, 2, 11, 8, 4, 14, 12, 5, 10, 3, 15, 13, 7, 1; these seven
are that order with the blues, greens, purple and greys left out, so
the flame goes from black through brown, red and orange to yellow and
white without a hue that reads as something other than fire. Giving
yellow and white twelve steps each and the others eight is a design
choice, not a measurement: it keeps the base bright for longer than the
tip stays dark. Any monotone table works; a non-monotone one puts a
bright band inside a darker region and the flame stops reading as heat.

### Two halves, four frames

Measured with CIA1 timer A (one-shot from `$FFFF`, `$DC0E = $19`, read
`$DC04`/`$DC05` after; the six bytes at `$0340` dumped through the
monitor on a trace of the done byte at `$0346`), with the screen on so
badline stealing is included:

| | PAL | NTSC |
|---|---|---|
| Whole screen (seed row and rows 23 to 0) | 53,479 | 53,695 |
| Bottom half (seed row and rows 23 to 12) | 27,301 | 27,773 |
| Top half (rows 11 to 0) | 26,115 | 26,329 |

A PAL frame is 19,656 cycles and an NTSC frame 17,095 (arithmetic), so
the whole screen is 2.7 PAL frames and each half is still 1.3 to 1.6
frames. The `main` loop waits for a fresh crossing of raster line 256
(`$D011` bit 7 clear, then set) before each half, so a half that
overruns lands in the middle of the next frame and the next half starts
on the crossing after that: each half occupies two frames and the whole
screen updates every four, 12.5 times a second on PAL and 15 on NTSC
(arithmetic from the measured costs). The colour-RAM writes to rows 23
to 12 start in the vertical blank and continue through the next
frame's display, so the picture tears within an update; between
updates it is whole, which is where the pin lands. On PAL the top
half's last store to `$D800` falls on raster line 0 (read from the
same monitor trace), before the display starts at line 51, so the field
after it is a clean picture; on NTSC it falls on line 95, so the first
five rows of that field were drawn while the update was still writing
them. Both pictures are what the display showed.

### Colour RAM by row, indexed inside the row

Every colour-RAM store is `sta COLOUR + r * 40, x` with X between 0 and
39, or an absolute store to a named cell. The index never reaches 1,024,
which is where a store would land on CIA1's registers instead of colour
RAM (`colour_ram_index_past_last_cell_hits_cia1` in
`../../pitfalls/text-mode-render.md`); this listing has CIA1's
interrupt mask cleared and its timer in use for the measurement, so a
stray store there would change the figures. The full rewrite of colour
RAM through an index is also what
`full_field_redraw_exceeds_vblank` on the same page describes, and here
it does overrun, which is why the update is split in two halves.

### Region

`region: both`. The mechanism is the same on NTSC; the half costs are
216 to 472 cycles higher there because more badlines fall inside a
longer update, the update rate is 15 a second rather than 12.5, and the
fire stands lower at the same cycle count because fewer updates have
run. The pinned NTSC picture is a complete field with the caveat above
about its first five rows.

## What it does not establish

Nothing here was run on hardware; VICE x64sc 3.10 is the instrument.
The costs are for this listing's loop shape, not a floor for the
technique: a fully unrolled version with absolute stores and a decay
table was not built or timed. A bitmap fire, a 2x2 cell fire with a
half-height glyph pair, and any sound are not covered. The palette
order is a design choice checked against `colour_fade`'s luminance
ranking, not measured on a display.
