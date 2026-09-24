---
recipe: shadebobs
toolchain: kickassembler
output_format: PRG
region: both
techniques: [shadebobs, bobs_effect]
file_formats: [PRG]
uses_registers: [D011, D020, D021, DC04, DC05, DC0D, DC0E]
uses_kernal: []
claims: [cia1_timer_b (init), cia1_tod (init), zero_page $FB-$FE (owns)]
harness: [cia1_timer_a, $0340-$03FF]
ram: [colour=$D800-$DBFF]
---

<!-- doc-type: recipe -->

# KickAssembler: Shade Bobs

## Synopsis

A character-mode shade bob. Screen RAM holds the reverse space (screen
code 160) in every cell, so every pixel of a cell takes its colour-RAM
colour and the picture is colour RAM alone. A 40 by 25 shade buffer in
RAM holds values 0 to 15, all zero at the start. One blob of four by
three cells moves on two sines, and every frame each cell under a set
entry of its mask gains one shade step, saturating at 15, and has its
colour rewritten from a sixteen-entry palette in luminance order. Every
fourth frame the whole buffer loses one step, floored at zero, and all
1,000 colour cells are rewritten. The loop runs 300 iterations and
stops, so the picture is static for the pin. Use it where a demo part
wants a bob that leaves a glowing trail rather than a clean erase, at
the cost of one store per covered cell and a periodic full rewrite.

Verified in VICE x64sc: a short tail of grey, red, orange and brown
cells in the lower right of a black screen where the blob stopped; the
no-decay control draws the whole figure of eight in the palette's
sixteen colours with white where the path crosses itself.

## Source

```asm
// shadebobs.asm
// A character-mode shade bob. Screen RAM holds one solid glyph (screen code
// 160, the reverse space) in every cell, so the picture is colour RAM alone.
// A 40 by 25 shade buffer (values 0..15) lives in RAM, all zero at start.
// One 4 by 3 cell blob moves on two sines; every frame each cell under a set
// mask entry gains one shade step, saturating at 15, and its colour-RAM cell
// takes palette[shade]. Every fourth frame the whole buffer loses one step
// (floor 0) and all 1,000 colour cells are rewritten from it. The loop runs
// FRAMES iterations and stops, so the picture is static for the pin.
//
// Build with -define NODECAY for the control: the decay pass is left out
// and the trail only ever brightens.
//
// Region: both. Costs measured with CIA1 timer A (see the recipe page).

.const FRAMES  = 300         // loop iterations before the program stops
.const MAX     = 15          // top shade; also the last palette index
.const SCREEN  = $0400
.const COLOUR  = $d800
.const SHADE   = $3000       // 25 rows of 40 bytes
.const TIMES   = $0340       // timer bytes, first-15 frame and a done byte
.const sp      = $fb         // zero page: shade row pointer
.const cp      = $fd         // zero page: colour row pointer

BasicUpstart2(start)

// ---------------------------------------------------------------------------
// Tables, built by the assembler.
// ---------------------------------------------------------------------------
* = $3400
// Shade 0..15 to a VIC colour: all sixteen colours in rising luminance
// order (colour_fade's PAL ranking), black first and white last.
palette:
    .byte 0, 6, 9, 2, 11, 8, 4, 14, 12, 5, 10, 3, 15, 13, 7, 1

// The blob: four columns by three rows, 1 where a cell is shaded.
mask:
    .byte 0, 1, 1, 0
    .byte 1, 1, 1, 1
    .byte 0, 1, 1, 0

// Signed sines of amplitude 16 and 9, one period over 256 entries. The
// amplitude is far below 128, so the peak cannot carry out of the byte.
sin16:  .fill 256, round(16 * sin(i * 2 * PI / 256))
sin9:   .fill 256, round(9 * sin(i * 2 * PI / 256))

// Row start addresses for the shade buffer and for colour RAM.
srow_lo: .fill 25, <(SHADE + i * 40)
srow_hi: .fill 25, >(SHADE + i * 40)
crow_lo: .fill 25, <(COLOUR + i * 40)
crow_hi: .fill 25, >(COLOUR + i * 40)

t:        .byte 0            // sine phase, one step per iteration
frame_lo: .byte 0
frame_hi: .byte 0
cx:       .byte 0            // top-left column of the blob, 2..34
cy:       .byte 0            // top-left row of the blob, 2..20
tmp:      .byte 0, 0

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

// One row of the blob. Y runs 3 down to 0 along the row; the pointers were
// set to the row start plus cx, so the colour-RAM address is at most
// COLOUR + 22 * 40 + 37 and never reaches CIA1 at COLOUR + 1,024.
.macro BobRow(dy) {
    ldy #3
!cell:
    lda mask + dy * 4, y
    beq !skip+
    lda (sp), y
    cmp #MAX
    beq !skip+               // saturate: a full cell stays full
    clc
    adc #1
    sta (sp), y
    cmp #MAX
    bne !+
    jsr note_full            // first time any cell reaches MAX
!:  tax
    lda palette, x
    sta (cp), y
!skip:
    dey
    bpl !cell-
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
    sta SHADE, x
    sta SHADE + $100, x
    sta SHADE + $200, x
    sta SHADE + $300, x
    sta TIMES, x
    inx
    bne !-

main:
    jsr wait_frame

    // Blob position from the two sines: cx = 18 + 16 sin t, cy = 11 + 9 sin 2t.
    ldx t
    lda #18
    clc
    adc sin16, x
    sta cx
    txa
    asl
    tax
    lda #11
    clc
    adc sin9, x
    sta cy

    TimerStart()
    jsr draw_bob
    TimerStop(tmp)
    lda frame_lo
    ora frame_hi
    bne !+
    lda tmp                  // keep the first iteration's figure: every
    sta TIMES                // cell under the blob is added to, none is full
    lda tmp + 1
    sta TIMES + 1
!:
#if !NODECAY
    lda frame_lo
    and #3
    cmp #3
    bne !+                   // decay on iterations 3, 7, 11, ...
    TimerStart()
    jsr decay
    TimerStop(tmp)
    lda frame_hi
    bne !+
    lda frame_lo
    cmp #3
    bne !+
    lda tmp                  // the first decay pass
    sta TIMES + 2
    lda tmp + 1
    sta TIMES + 3
!:
#endif
    inc t
    inc frame_lo
    bne !+
    inc frame_hi
!:  lda frame_lo
    cmp #<FRAMES
    lda frame_hi
    sbc #>FRAMES
    bcs !+
    jmp main
!:
    lda #1
    sta TIMES + 6            // done: the monitor dumps on this store
    jmp *

// Wait for a fresh crossing of raster line 256 ($D011 bit 7 clear, then set).
wait_frame:
!:  bit $d011
    bmi !-
!:  bit $d011
    bpl !-
    rts

// Record the iteration on which a cell first reached MAX; later calls do
// nothing. Iteration 0 cannot reach it, so 0 in TIMES + 4 means never.
note_full:
    pha
    lda TIMES + 4
    ora TIMES + 5
    bne !+
    lda frame_lo
    sta TIMES + 4
    lda frame_hi
    sta TIMES + 5
!:  pla
    rts

// Point sp and cp at row cy + dy, column cx, and add one to each masked cell.
draw_bob:
    .for (var dy = 0; dy < 3; dy++) {
        ldy cy
        .if (dy > 0) {
            .fill dy, $c8    // iny
        }
        lda srow_lo, y
        clc
        adc cx
        sta sp
        lda srow_hi, y
        adc #0
        sta sp + 1
        lda crow_lo, y
        clc
        adc cx
        sta cp
        lda crow_hi, y
        adc #0
        sta cp + 1
        BobRow(dy)
    }
    rts

// Every cell loses one step, floored at 0, and every colour cell is
// rewritten. Row by row with X at most 39, so no index reaches 1,024.
decay:
    .for (var r = 0; r < 25; r++) {
        ldx #0
    !loop:
        lda SHADE + r * 40, x
        beq !zero+
        sec
        sbc #1
        sta SHADE + r * 40, x
    !zero:
        tay
        lda palette, y
        sta COLOUR + r * 40, x
        inx
        cpx #40
        bne !loop-
    }
    rts
```

## Build

```bash
java -jar KickAss.jar shadebobs.asm -o shadebobs.prg
```

Control build, no decay pass:

```bash
java -jar KickAss.jar shadebobs.asm -define NODECAY -o shadebobs-nodecay.prg
```

## Expected output

Black border and background. After the 300 iterations the program
halts, and what is left is the blob's last position and the trail that
the decay has not yet taken back to zero: 21 lit cells in rows 19 to
22, columns 27 to 35, the brightest at shade 8 (grey), the rest of the
screen black. The picture does not change after the halt and repeats
exactly from one run to the next, because the sines are tables and
nothing reads a timer or a key.

Screenshots from the VICE runs this page describes:
`screenshots/shadebobs.png` (PAL) and `screenshots/shadebobs-ntsc.png`
(NTSC), both at cycle limit 11,000,000. The program's done-byte store
lands at cycle 10,362,897 on PAL (raster line 66) and 9,515,159 on NTSC
(raster line 159), read from a monitor trace of the store, so at the
limit the picture is static and the beam position does not matter;
two runs per model gave the same PNG (md5
`4254e90a022d46d6489d2f4240ab2bb3` PAL,
`384ec1f77a7b9891f64d8e9d1bb38a96` NTSC).

Sampling the centre pixel of every cell of the PAL picture and matching
it to the cell's colour-RAM nibble from the same run's monitor dump
(every nibble value maps to one RGB and every RGB to one nibble, so the
pixel census is the nibble census) gives, over the 1,000 cells: 979
black, 7 red, 3 brown, 3 grey, 2 blue, 2 dark grey, 2 orange, 1 purple
and 1 light blue. By shade that is 979 at 0, 2 at 1, 3 at 2, 7 at 3, 2
at 4, 2 at 5, 1 at 6, 1 at 7 and 3 at 8. The NTSC run has the identical
census and the identical 1,000-byte buffer: the iteration count is the
same on both models, only the cycle at which it finishes differs.

No cell reaches 15 in this build. The blob covers a cell for a few
frames per pass and the decay takes a step every four frames, so a cell
left at shade 8 is back to black 32 frames after the blob leaves it
(arithmetic), and the trail is 21 cells long rather than the whole path.

Control: the same listing with `-define NODECAY`, run to the same cycle
limit on PAL, gives 640 black, 19 blue, 37 brown, 20 red, 34 dark grey,
51 orange, 38 purple, 44 light blue, 23 grey, 15 green, 28 light red,
12 cyan, 14 light grey, 4 light green, 8 yellow and 13 white: the whole
figure of eight, 360 lit cells, brightest where the path crosses itself
in the middle and where the second pass (iterations 256 to 299 repeat
the phase of 0 to 43) runs over the first. The first cell to reach 15
did so on iteration 280 (the count is zero-based; the value is recorded
by the program at `$0344`). The NTSC control has the same census and
the same first-15 iteration. Its done store lands at 8,881,626 PAL and
8,222,883 NTSC.

## Why this works

### Colour RAM is the picture

In standard text mode, colour RAM sets the colour of a cell's set
pixels and `$D021` its clear pixels. The reverse space has every pixel
set, so with `$D021` black a cell shows its colour-RAM nibble and
nothing else. `fire_effect` and `plasma` in
`../../techniques/effects-vector-3d.md` use the same fill. A shade bob is
therefore never drawn and never erased: it only adds to a number per
cell, and the number is shown by one store.

### The saturating add

For each of the twelve mask entries under the blob, a set entry means
`shade = min(shade + 1, 15)` and `colour = palette[shade]`. The
`BobRow` macro runs Y from 3 down to 0 along a row through two
zero-page pointers, `sp` into the buffer and `cp` into colour RAM, both
set to the row start plus `cx` from the `srow` and `crow` tables. A
cell already at 15 is skipped before the add, so it is never written
and never wraps. Saturating rather than wrapping is what keeps the
brightest cell brightest: a wrap would take a full cell to
`palette[0]`, black, and the hottest point of the trail would become a
hole; with saturation the top of the range is a plateau the decay
brings down one step at a time. The mask has eight set entries out of
twelve, the four corners clear, so the blob reads as rounded rather
than as a brick.

### The decay

Every iteration whose count is 3 modulo 4 runs `decay`: 25 unrolled
row loops, each with X from 0 to 39, subtracting one from every
non-zero shade and rewriting the colour of every cell, including the
cells that were and stay zero. It rewrites all 1,000 colour cells
rather than only the changed ones because it has no record of which
cells changed; a dirty list is the variation on the technique page.

### The palette

Sixteen bytes map shade to a VIC colour in rising luminance order,
`colour_fade`'s PAL ranking from `../../techniques/transitions.md`:

```
shade  0: 0  black        shade  8: 12 grey
shade  1: 6  blue         shade  9: 5  green
shade  2: 9  brown        shade 10: 10 light red
shade  3: 2  red          shade 11: 3  cyan
shade  4: 11 dark grey    shade 12: 15 light grey
shade  5: 8  orange       shade 13: 13 light green
shade  6: 4  purple       shade 14: 7  yellow
shade  7: 14 light blue   shade 15: 1  white
```

All sixteen are used, so the trail changes hue as it fades, blue and
purple among the browns and reds; the ranking is monotone in
brightness, which is what makes it read as a glow that cools. A subset
in the same order, as the fire recipe uses, gives a single hue at the
cost of fewer steps.

### The two sines

`sin16` and `sin9` are 256-entry signed tables of `round(16 * sin)` and
`round(9 * sin)`, and the blob's top-left cell is `cx = 18 + sin16[t]`,
`cy = 11 + sin9[2t]`, with `t` stepping once per iteration, so the
path is a figure of eight 33 columns wide and 19 rows tall. `cx` runs
2 to 34 and `cy` 2 to 20, so the four-by-three blob stays inside
columns 2 to 37 and rows 2 to 22 and no clipping is needed. The
amplitudes are far below 128, so the peak of neither table can carry
out of a byte, which is the fault
`sine_table_peak_wraps_to_zero` (`../../pitfalls/maths.md`) describes
for amplitude-128 tables; the largest step between neighbours in
`sin16` is 1 (arithmetic: 16 times 2 pi over 256 is 0.39).

### Measured costs

Measured with CIA1 timer A (one-shot from `$FFFF`, `$DC0E = $19`, read
`$DC04`/`$DC05` after; the bytes at `$0340` dumped through the monitor
on a trace of the done byte at `$0346`), with the screen on so badline
stealing is included. The add is timed on iteration 0, when every
covered cell is zero and none is skipped as full; the decay on its
first pass, iteration 3, when 12 of the 1,000 cells are non-zero.

| | PAL | NTSC |
|---|---|---|
| Blob add, 8 set mask entries of 12 | 590 | 590 |
| Decay pass, first, all 1,000 cells | 26,514 | 27,028 |

Two more builds of the same listing with the mask changed, PAL only:
all twelve entries set, 730; none set, 310. So a set entry costs 35
cycles and a clear one 12, with about 166 cycles of row set-up, `jsr`
and timer reads around them (arithmetic from the three measurements;
the instruction table gives 47 for the set path and 12 for the clear
path, and 35 is their difference). The control build measures the
same add at 595; the five-cycle difference was not examined.

A PAL frame is 19,656 cycles and an NTSC frame 17,095 (arithmetic).
The add is about nine raster lines (arithmetic, 63 cycles a line). The
decay pass is 1.35 PAL frames and 1.58 NTSC frames, and it does not fit the vertical blank or the
frame: per cell the zero path is `lda abs,x`, `beq`, `tay`, `lda
abs,y`, `sta abs,x`, `inx`, `cpx`, `bne`, 25 cycles by the instruction
table, and the non-zero path 33, so 1,000 cells are at least 25,000
before badlines. The `main` loop waits for a fresh crossing of raster
line 256 before each iteration, so an iteration with a decay pass
overruns into the next frame and the following iteration starts on the
crossing after that: 75 of the 300 iterations take two raster frames,
and the run from the program's first instruction to its halt is 376
PAL frames (arithmetic from the measured done cycle and the cycle of
the first store into `$0346`, which is the start-up clearing loop at
2,970,920). The colour-RAM rewrite of a decay iteration starts in the
blank and runs through the next field's display, so a frame with a
decay pass tears; a viewer sees a hitch every fourth frame.

### Colour RAM by row, indexed inside the row

The decay's stores are `sta COLOUR + r * 40, x` with X at most 39, and
the add's are `sta (cp), y` with Y at most 3 and `cp` at most `COLOUR
+ 22 * 40 + 34`. Neither can reach `COLOUR + 1,024`, which is where a
store lands on CIA1's registers instead of colour RAM
(`colour_ram_index_past_last_cell_hits_cia1` in
`../../pitfalls/text-mode-render.md`); this listing has CIA1's interrupt
mask cleared and its timer in use for the measurement, so a stray store
there would change the figures. The full rewrite through an index is
what `full_field_redraw_exceeds_vblank` on the same page describes,
and here it overruns; running it every fourth frame is what keeps the
average under a frame, not a fit.

### The buffer is the picture

At the halt the monitor dumped the 1,000-byte buffer at `$3000` and
colour RAM at `$D800` to `$DBE7` from the same trace. Passing each
buffer byte through the palette and comparing with the colour-RAM low
nibble gives 0 mismatches in 1,000, on both models and in both builds.
The comparison masks the upper nibble: the monitor's read of colour RAM
returned 0 there in the decay runs, 15 in the PAL control and 10 in the
NTSC control, which is not stored data. The program itself never reads
colour RAM back.

As a second check, a Python model of the design as written above (the
two rounded sine tables, the eight-entry mask, the saturating add and
the decay on every iteration that is 3 modulo 4, 300 iterations)
produces the same 1,000 bytes as the dumped buffer, in both builds: 0
differences. The 6502 listing does what the description says, cell for
cell.

### Region

`region: both`. The mechanism is the same on NTSC; the decay pass is
514 cycles dearer there because more badlines fall inside it, and the
same 300 iterations finish 847,738 cycles earlier because the frames
are shorter. The buffer, the census and the first-15 iteration are the
same on both models.

## What it does not establish

Nothing here was run on hardware; VICE x64sc 3.10 is the instrument.
One blob only: a second bob, a bitmap shade bob that adds per pixel
rather than per cell, and a decay split across alternate halves of the
screen were not built or timed. The decay rate of one step every four
frames is the design as fixed, and with this blob speed it leaves a
trail of 21 cells; a slower decay was not run. The costs are for this
listing's loop shape, not a floor for the technique. The palette order
is `colour_fade`'s luminance ranking, not measured on a display, and
the five-cycle difference in the control build's add was not examined.
