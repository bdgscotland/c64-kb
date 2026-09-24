---
recipe: plasma
toolchain: kickassembler
output_format: PRG
region: both
techniques: [plasma]
file_formats: [PRG]
uses_registers: [D011, D020, D021, DC04, DC05, DC0D, DC0E]
uses_kernal: []
claims: [cia1_timer_b (init), cia1_tod (init)]
harness: [cia1_timer_a, $02FF, $0340-$034B]
ram: [colour=$D800-$DBFF]
---

<!-- doc-type: recipe -->

# KickAssembler: Plasma

## Synopsis

A character-mode plasma over the whole 40 by 25 screen. Screen RAM holds
the reverse space (screen code 160) in every cell, so every pixel of a
cell takes its colour-RAM colour and the picture is colour RAM alone. Each
cell's colour is `cmap[colv[x] + rt[y]]`: `colv[x] = sinP[8x + t]` is
rebuilt for the forty columns every frame, `rt[y] = (sinP[10y + t2] +
sinP[5y + t3]) / 2` is worked out once per row, and the three phases step
+1, -1 and +2 a frame. The sine holds 0 to 119, so the sum is at most 238,
and `cmap` has 239 entries mapping the sum onto all sixteen VIC colours in
luminance order. A frame repaints a quarter of the rows, four apart, so
the screen turns over every four frames and the per-frame work is about a
third of a frame. The row loop is 18 cycles a cell. Use it when a part
wants a full-screen colour wash that costs no character data and leaves
most of the frame free.

Verified in VICE x64sc 3.10 (the windowless build's `-version` reports
`x64sc-headless (VICE 3.10)`): soft diagonal bands of colour drift across
a black-bordered screen, running through blue, brown, red, purple, orange,
grey, green, cyan and yellow, and the border turns green at frame 200
when the listing's own check passes.

## Source

```asm
// plasma.asm
// A colour-RAM plasma. Screen RAM holds one solid glyph (screen code 160,
// the reverse space) in every cell, so the picture is colour RAM alone.
// Each cell's colour is cmap[colv[x] + rt[y]]: colv[x] = sinP[8x + t] is
// rebuilt for the 40 columns every frame, rt[y] = (sinP[10y + t2] +
// sinP[5y + t3]) / 2 is worked out once per row, and the three phases
// step +1, -1 and +2 a frame. sinP holds 0..119, so colv + rt is at most
// 238 and cmap has 239 entries, each a VIC colour from a luminance-ordered
// ramp of all sixteen.
//
// A frame repaints a quarter of the rows: frame f repaints rows f mod 4,
// f mod 4 + 4, and so on, so the whole screen turns over every four frames
// and the per-frame work fits the vertical blank on PAL. The row loop is
// 18 cycles a cell: the row term is folded into the low byte of the cmap
// operand and the row's colour-RAM address into the store operand, both
// self-modified once per row. Nothing is cycle-exact.
//
// Self-check: two cells in one column (rows 4 and 16 of column 20) are
// read back from colour RAM every frame. A frame is good when both are
// neither black nor white and they differ. Every sixteenth frame the pair
// is compared with the pair sixteen frames earlier. At frame 200 the border
// turns green ($02FF = 1) if at least 96 frames were good and the pair
// moved in at least 5 of the 11 comparisons, red ($02FF = 2) otherwise.
// The FORCE_FAULT build drops the row term (rt = 0), so every row is the
// same, the two cells are always equal, and the verdict is red.
//
// Region: both. Costs measured with CIA1 timer A (see the recipe page).

.const SCREEN  = $0400
.const COLOUR  = $d800
.const VERDICT = $02ff       // 1 green, 2 red
.const TIMES   = $0340       // timer bytes for the monitor, see below
.const CX      = 8           // column phase step: colv[x] = sinP[8x + t]
.const RY1     = 10          // first row term: sinP[10y + t2]
.const RY2     = 5           // second row term: sinP[5y + t3]
.const CELL_A  = COLOUR + 4 * 40 + 20
.const CELL_B  = COLOUR + 16 * 40 + 20
.const VERDICT_FRAME = 200
.const GOOD_MIN = 96
.const MOVE_MIN = 5

// TIMES + 0: whole screen once (colv and 25 rows)   TIMES + 6: worst loop frame
// TIMES + 2: a seven-row frame once (colv, rows 0, 4, .. 24)   TIMES + 8: last loop frame
// TIMES + 4: a six-row frame once (colv, rows 1, 5, .. 21)    TIMES + 10: frame at verdict
// TIMES + 11: 1 once the verdict is stored

BasicUpstart2(start)

// ---------------------------------------------------------------------------
// Tables, built by the assembler.
// ---------------------------------------------------------------------------
// The sixteen VIC colours in rising luminance order (colour_fade's ranking).
.var ramp = List().add(0, 6, 9, 2, 11, 8, 4, 14, 12, 5, 10, 3, 15, 13, 7, 1)

* = $3000
// Sum 0..238 to a colour: about fifteen sums per step of the ramp. The map
// starts on a page boundary so that cmap + rt + x never crosses a page.
cmap:   .fill 239, ramp.get(floor(i * 16 / 239))
.assert "cmap starts a page", <cmap, 0

* = $3100
// 256-entry sine, 0..119, one period.
sinP:   .fill 256, round(59.5 + 59.5 * sin(toRadians(i * 360 / 256)))

* = $3200
rowlo:  .fill 25, <(COLOUR + i * 40)
rowhi:  .fill 25, >(COLOUR + i * 40)
rph1:   .fill 25, (RY1 * i) & 255
rph2:   .fill 25, (RY2 * i) & 255
colv:   .fill 40, 0          // this frame's column term, one byte a column
t:      .byte 0              // column phase, +1 a frame
t2:     .byte 0              // first row phase, -1 a frame
t3:     .byte 0              // second row phase, +2 a frame
frame:  .byte 0
step:   .byte 4              // rows painted are rowidx, rowidx + step, ..
rowidx: .byte 0
rt_tmp: .byte 0
good:   .byte 0              // frames in which the two cells were good
move:   .byte 0              // sixteen-frame comparisons in which they moved
olda:   .byte 0
oldb:   .byte 0
newa:   .byte 0
newb:   .byte 0
done:   .byte 0
tables_end:

.macro TimerStart() {
    lda #$ff
    sta $dc04
    sta $dc05
    lda #$19                 // start, one-shot, force load from $FFFF
    sta $dc0e
}

// Stops the timer, then stores $FFFF - count: the cycles since TimerStart.
.macro TimerStop(dst) {
    lda #$00
    sta $dc0e
    lda $dc04
    eor #$ff
    sta dst
    lda $dc05
    eor #$ff
    sta dst + 1
}

#if AUTOPILOT
#import "frame_meter.asm"
#endif

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
    inx
    bne !-
    ldx #done - t
!:  sta t, x                 // phases, counters and flags all zero
    dex
    bpl !-

    // Three timed passes for the monitor, each from a fresh crossing of
    // line 256 like the loop's frames: the whole screen, a seven-row frame
    // and a six-row frame.
    lda #1
    sta step
    jsr wait_frame
    TimerStart()
    jsr build_colv
    ldx #0
    jsr paint_rows
    TimerStop(TIMES)
    lda #4
    sta step
    jsr wait_frame
    TimerStart()
    jsr build_colv
    ldx #0
    jsr paint_rows
    TimerStop(TIMES + 2)
    jsr wait_frame
    TimerStart()
    jsr build_colv
    ldx #1
    jsr paint_rows
    TimerStop(TIMES + 4)
#if AUTOPILOT
    FrameMeterInit()
#endif

main:
    jsr wait_frame
#if AUTOPILOT
    WorkBegin()
    FrameMeterStart()
#endif
    TimerStart()
    jsr plasma_frame
    TimerStop(TIMES + 8)
#if AUTOPILOT
    FrameMeterStop()
    WorkEnd()
#endif
    jsr record_worst
    jsr selfcheck
#if AUTOPILOT
    jsr meter_colour
    FrameMeterPrint()
#endif
    jmp main

// Wait for a fresh crossing of raster line 256 ($D011 bit 7 clear, then set).
wait_frame:
!:  bit $d011
    bmi !-
!:  bit $d011
    bpl !-
    rts

// One frame: step the phases, rebuild colv, paint this frame's quarter.
plasma_frame:
    inc t
    dec t2
    inc t3
    inc t3
    jsr build_colv
    lda frame
    and #3
    tax
    jsr paint_rows
    inc frame
    rts

// colv[x] = sinP[(8x + t) & 255] for x = 0..39.
build_colv:
    ldy t
    ldx #0
!:  lda sinP, y
    sta colv, x
    tya
    clc
    adc #CX
    tay
    inx
    cpx #40
    bne !-
    rts

// Paint rows X, X + step, .. while below 25. Per row: rt = (sinP[10y + t2]
// + sinP[5y + t3]) / 2 becomes the low byte of the row loop's cmap operand
// and the row's colour-RAM address its store operand.
paint_rows:
    stx rowidx
!row:
    ldx rowidx
    lda rowlo, x
    sta pr_st + 1
    lda rowhi, x
    sta pr_st + 2
    lda rph1, x
    clc
    adc t2
    tay
    lda sinP, y
    sta rt_tmp
    lda rph2, x
    clc
    adc t3
    tay
    lda sinP, y
    clc
    adc rt_tmp               // at most 238: no carry
    lsr                      // at most 119
#if FORCE_FAULT
    lda #0                   // control: no row term, every row the same
#endif
    sta pr_cm + 1
    jsr paint_row
    lda rowidx
    clc
    adc step
    sta rowidx
    cmp #25
    bcc !row-
    rts

// 40 cells of one row, 18 cycles a cell: colv and cmap + rt stay in their
// pages, so neither indexed read crosses one.
paint_row:
    ldy #39
!:  ldx colv, y
pr_cm:
    lda cmap, x
pr_st:
    sta COLOUR, y
    dey
    bpl !-
    rts

// Keep the largest loop frame at TIMES + 6.
record_worst:
    lda TIMES + 9
    cmp TIMES + 7
    bcc !keep+
    bne !worse+
    lda TIMES + 8
    cmp TIMES + 6
    bcc !keep+
!worse:
    lda TIMES + 8
    sta TIMES + 6
    lda TIMES + 9
    sta TIMES + 7
!keep:
    rts

// Read the two cells back from colour RAM (low nibble; the high nibble is
// open bus), count good frames and moved pairs, store the verdict once.
selfcheck:
    lda done
    beq !+
    rts
!:  lda CELL_A
    and #$0f
    sta newa
    lda CELL_B
    and #$0f
    sta newb
    cmp newa
    beq !counted+            // equal: not good
    cmp #2
    bcc !counted+            // b black or white
    lda newa
    cmp #2
    bcc !counted+            // a black or white
    inc good
    bne !counted+
    dec good                 // saturate at 255
!counted:
    lda frame
    and #15
    bne !nosnap+
    lda frame
    cmp #16
    beq !store+              // the first snapshot has nothing to compare with
    lda newa
    cmp olda
    bne !moved+
    lda newb
    cmp oldb
    beq !store+
!moved:
    inc move
!store:
    lda newa
    sta olda
    lda newb
    sta oldb
!nosnap:
    lda frame
    cmp #VERDICT_FRAME
    bne !out+
    lda good
    cmp #GOOD_MIN
    bcc !red+
    lda move
    cmp #MOVE_MIN
    bcc !red+
    lda #1
    sta VERDICT
    lda #5
    sta $d020
    bne !mark+
!red:
    lda #2
    sta VERDICT
    sta $d020
!mark:
    lda frame
    sta TIMES + 10
    lda #1
    sta done
    sta TIMES + 11
!out:
    rts
code_end:

#if AUTOPILOT
// The harness's frame meter sits on row 24, columns 20 to 39; the plasma
// repaints that row's colour every fourth frame, so its cells are put back
// to white after each frame's work, outside the bracket.
meter_colour:
    ldx #19
    lda #1
!:  sta COLOUR + 24 * 40 + 20, x
    dex
    bpl !-
    rts
frame_meter:
    FrameMeterCode(SCREEN, 24, 20, 1, VERDICT_FRAME)
#endif

.print "code bytes: " + (code_end - start)
.print "table bytes: " + (tables_end - cmap)
.print "table bytes without alignment padding: " + (239 + 256 + (tables_end - rowlo))
```

## Build

```bash
java -jar KickAss.jar plasma.asm -o plasma.prg
```

The control on this page is the same file with `-define FORCE_FAULT`. The
`#if AUTOPILOT` blocks are the harness's frame meter and exist so the
listing can be measured under it; a plain build carries none of them,
and a build with `-define AUTOPILOT` needs `-libdir` pointing at the
harness's `meter` directory for the import.

## Expected output

Black background and, until frame 200, black border. Soft bands of
colour run diagonally across the screen and drift. The ends of the ramp
are the rarest colours: the PAL pin below has fifteen colours and no
white, the NTSC pin twelve, and over the 256-frame period of the phases
the model (`tools/sim.py`) puts white in 9.8 cells a frame on average
and in 99 frames of the 256, black in 19.3 cells a frame. At frame 200,
about four seconds in, the border turns green: the listing's own check
passed.

Screenshots from the VICE runs this page describes:
`screenshots/plasma.png` (PAL) and `screenshots/plasma-ntsc.png` (NTSC),
both at cycle limit 10,000,000 with verify-recipes' flags. Two runs per
model gave the same file (md5 `27ac0920aaefb159b6d882458c197d60` PAL,
2,101 bytes; `b3d62596aa3e79d15e9b9db558530fa9` NTSC, 1,854 bytes), and
the border pixel at (2, 100) is green on both. Sampling the centre pixel
of every cell and matching it exactly against VICE's palette gives, over
the 1,000 cells of the PAL picture: 37 black, 44 red, 68 cyan, 114
purple, 77 green, 38 blue, 39 yellow, 73 orange, 44 brown, 67 light red,
55 dark grey, 105 grey, 61 light green, 111 light blue and 67 light grey,
fifteen colours and no white. The NTSC picture: 4 red, 95 cyan, 149
purple, 67 green, 4 yellow, 154 orange, 76 light red, 115 dark grey, 76
grey, 64 light green, 100 light blue and 96 light grey, twelve colours.
No column is one colour from row 0 to row 23 in either.

Both pictures are the arithmetic above at a known frame. A model of the
listing's tables, phases and quarter interleave (`tools/sim.py` in the
harness project, table for table the same expressions) reproduces the
NTSC picture exactly as the state after frame 399's repaint, and the PAL
picture as rows 0 to 20 of frame 353 over rows 21 to 24 of frame 352:
the PAL screenshot was taken while frame 353's field was being drawn and
the beam had reached row 21. The frame numbers are the ones the cycle
counts predict: a monitor trace on the verdict store puts frame 200 at
cycle 6,980,494 on PAL and 6,587,476 on NTSC, and the remaining cycles
to the limit are 153.6 PAL frames of 19,656 and 199.6 NTSC frames of
17,095 (arithmetic).

Control: the same listing built with `-define FORCE_FAULT`, run to the
same cycle limit. The row term is zero, so the sum runs only 0 to 119
and the picture has eight colours: on PAL 176 black, 99 red, 147 purple,
122 blue, 78 orange, 78 brown, 123 dark grey and 177 light blue; on
NTSC 313 black, 62 red, 74 purple, 111 blue, 76 orange, 114 brown, 62
dark grey and 188 light blue. Vertical stripes: 37 of the 40 columns are
one colour from row 0 to row 23 on PAL and 33 on NTSC (the rest sit on a
step of the ramp, and rows four apart were repainted on different frames
with `t` one apart). The check's two cells, rows 4 and 16 of column 20,
are both dark grey on PAL and both light blue on NTSC, the good count
never leaves zero, and the border is red on both models. The same
control under the harness fails its verdict check on both models
(`shots/fault-check.txt`).

## Why this works

### Colour RAM is the picture

In standard text mode, colour RAM sets the colour of a cell's set pixels
and `$D021` its clear pixels. The reverse space has every pixel set, so
with `$D021` black a cell shows its colour-RAM nibble and nothing else,
and the plasma is one 4-bit store per cell. `plasma` in
`../../techniques/effects-vector-3d.md` describes the family;
`fire-effect.md` beside this page uses the same fill.

### The arithmetic

The sine is 256 entries of `round(59.5 + 59.5 sin)`, 0 to 119, and every
term is one indexed read of it. The column term is `sinP[(8x + t) & 255]`
for the forty columns, rebuilt into `colv` each frame with Y stepping by
eight. The row term is the mean of two sines with different spatial
frequencies, ten and five entries a row, on separate phases moving in
opposite directions: `(sinP[(10y + t2) & 255] + sinP[(5y + t3) & 255]) >>
1`. Two values of at most 119 sum to at most 238, so the sum fits a byte
without a carry and the halved row term is at most 119; `colv + rt` is at
most 238, which is why `cmap` has 239 entries and why the sine stops at
119 rather than 127 or 255.

The colour map is `ramp[floor(16 s / 239)]` for `s` from 0 to 238, so
each of the sixteen colours takes fourteen or fifteen consecutive sums.
The ramp is the sixteen VIC colours by rising luminance as `colour_fade`
in `../../techniques/transitions.md` ranks them, 0, 6, 9, 2, 11, 8, 4,
14, 12, 5, 10, 3, 15, 13, 7, 1, so a rising sum reads as a rising
brightness and the bands have no hard edge between adjacent colours.
Any other monotone ramp works; a non-monotone one puts a bright band
inside a dark one and the wash breaks into rings.

### The row loop

The per-row constants are folded into the row loop's operands before it
runs: the row term becomes the low byte of `lda cmap, x`, which is why
`cmap` starts a page, and the row's colour-RAM address becomes the store
operand from the `rowlo` and `rowhi` tables. The loop is then

```
ldx colv, y      4    the column term
lda cmap + rt, x 4    the colour; cmap + rt + x is at most cmap + 238, one page
sta row, y       5    colour RAM
dey              2
bpl              3
```

18 cycles a cell, 40 cells a row, with no addition in the loop at all:
the addition of the two terms is the indexed read. Neither indexed read
crosses a page (`colv` is forty bytes inside `$3200`, the map is 239 bytes
from `$3000`), so the 4-cycle figures hold for every cell.

### A quarter of the rows a frame

Measured with CIA1 timer A (one-shot from `$FFFF`, `$DC0E = $19`, stopped
and read after, the twelve bytes at `$0340` dumped by a monitor trace on
the verdict store at `$02FF`), with the screen on so badline stealing is
included, every pass started on a fresh crossing of line 256:

| | PAL | NTSC |
|---|---|---|
| Whole screen once (`colv` and 25 rows) | 22,574 | 22,743 |
| Seven-row frame once (`colv`, rows 0, 4, .. 24) | 6,782 | 7,039 |
| Six-row frame once (`colv`, rows 1, 5, .. 21) | 5,919 | 6,133 |
| Worst loop frame of the 200 to the verdict | 6,830 | 7,088 |
| Last loop frame before the verdict (six rows) | 5,967 | 6,182 |

A PAL frame is 19,656 cycles and an NTSC frame 17,095 (arithmetic). The
whole screen in one pass is 1.15 PAL frames and 1.33 NTSC frames, so a
full-screen update cannot run every frame. A quarter of the rows, four
apart, is at most 7 rows and 280 cells: the worst frame is 35 % of a PAL
frame and 41 % of an NTSC frame, and three frames in four are six-row
frames of 240 cells that cost 5,967 and 6,182. The screen turns over
every four frames, 12.5 times a second on PAL and 15 on NTSC
(arithmetic). The loop frames cost about 48 cycles more than the
one-off passes of the same shape, which is the `plasma_frame` call, the
three phase steps and the frame count inside the bracket.

The harness's own frame meter (CIA2 timer A, around the same bracket,
autopilot build, the first 200 frames) reads worst 6,867 and median 6,004
on PAL, worst 7,125 and median 6,219 on NTSC (`shots/pal.png` and
`shots/ntsc.png` graded by `check.py`); the 37 cycles above the CIA1
figures are the meter's own start and stop. The `FORCE_FAULT` build
meters 14 cycles more, the two-cycle `lda #0` on each of seven rows.

The loop waits for a fresh crossing of raster line 256 before each frame.
On PAL the vertical blank from line 256 round to line 50 is 107 lines,
6,741 cycles (arithmetic), so the six-row frames finish inside it and the
seven-row frames run 41 to 89 cycles into line 51; every colour-RAM write
of a six-row frame lands before the display starts, which is why the PAL
picture has no tear inside a row. On NTSC the same blank is 58 lines,
3,770 cycles, so about half of each frame's writes land in the display;
the rows being written are four apart and the beam passes each once, so
what a viewer sees is a row changing a frame early or late, not a split
row, and the NTSC pin matched the model's frame state whole.

### The self-check

Two cells in one column, rows 4 and 16 of column 20, are read back from
colour RAM after every frame (low nibble only: the high nibble of a
colour-RAM read is open bus). A frame is good when both are neither black
nor white and they differ; every sixteenth frame the pair is compared
with the pair sixteen frames earlier and a change counts as a move. At
frame 200 the border goes green if at least 96 frames were good and at
least 5 of the 11 comparisons moved. The state dumped at the verdict is
the same on both models: 188 good frames and 11 moves, which is what the
Python model predicts for these tables. With the row term dropped the two
cells share a column, a `colv` and a zero row term, so they are always
equal, the good count stays at zero and the verdict is red whatever the
picture does; the model gives 0 good and 5 moves for the fault build. Two
cells in different columns would not catch this fault, because the
column term still animates.

### Region

`region: both`. The mechanism is the same on NTSC; the frame costs are
214 to 258 cycles higher because more of each frame runs under badlines,
and the turnover is 15 a second rather than 12.5. The pinned NTSC picture
is a whole frame state; the PAL one is split between two frames at row 21
as described above, and both were the same file on two runs.

## Pitfalls

`full_field_redraw_exceeds_vblank` (`../../pitfalls/text-mode-render.md`):
the whole screen costs more than a frame and more than the blank; the
quarter interleave and the line-256 wait are the answer here, and on NTSC
half the writes still land in the display.
`colour_ram_index_past_last_cell_hits_cia1` (same page): every store is `sta row, y` with Y at most
39 and the row address from a table, so the index cannot reach 1,024; this
listing has CIA1's interrupt mask cleared and its timer in use, so a
stray store there would change the figures. `badline_cycle_loss`
(`../../pitfalls/raster-and-badline.md`): the difference between the PAL
and NTSC columns of the table, and between the six-row and seven-row
frames beyond one row's 18 by 40, is badlines inside the bracket; a
budget worked from the loop alone is 5,040 cycles for 280 cells and the
frame costs 6,830.

## What it does not establish

Nothing here was run on hardware; VICE x64sc 3.10 is the instrument, and
nobody has watched it animate: the pins are two frames and the model
says what the others hold. The costs are for this listing's loop shape,
not a floor: an unrolled column build, a doubled sine so the column term
can be read with an absolute-indexed operand per column, and a
speedcoded row were not built or timed. A four-colour ECM plasma, a
character-textured one and any sound are not covered. The ramp order is
`colour_fade`'s luminance ranking, not measured on a display. The
self-check reads two cells and counts frames; it cannot tell a plasma
from any other animation in which those two cells differ and move.
