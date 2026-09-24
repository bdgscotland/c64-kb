---
recipe: hires-plot-line
toolchain: kickassembler
output_format: PRG
region: both
techniques: [hires_plot, bresenham_line, standard_bitmap]
file_formats: [PRG]
uses_registers: [D011, D012, D016, D018, D020, D021, DC04, DC05, DC0E]
uses_kernal: []
harness: [cia1_timer_a]
---

<!-- doc-type: recipe -->

# KickAssembler — Plot a pixel and draw a Bresenham line in a hires bitmap, timed, and count the result

## Synopsis

Puts a standard bitmap at `$2000` with screen RAM at `$0400` set to white
ink on black paper, plots single pixels through a 200-entry row address
table and an 8-entry bit mask table, and draws eleven lines with
Bresenham's algorithm: the two axes, two 45-degree diagonals, three
shallow lines and four steep ones, one steep line in each sign quadrant.
The shallow loop's +x -y case is taken by the second diagonal, which has
equal deltas and so goes the shallow way. Every line
stays on the screen and no two share a pixel. It times one plot, a
one-pixel line and the 320-pixel axis with CIA1 timer A while the display
is blanked, then counts the set bits in the 8000 bitmap bytes and
compares the count with the total the assembler worked out from the
endpoints. `$02FF` is `$01` and the border green when they match, `$02`
and red otherwise. The techniques are `hires_plot` and `bresenham_line`
in `techniques/bitmap-modes.md`.

## Source

```asm
// hires-plot-line.asm
// Sets up a standard (hires) bitmap at $2000 with screen RAM at $0400,
// plots single pixels through a 200-entry row address table and an 8-entry
// mask table, draws a compiled-in set of lines with Bresenham's algorithm in
// every direction, times one plot and the longest line with CIA1 timer A,
// then counts the set bits in the bitmap and compares the count with the
// total the assembler worked out from the endpoints. Verdict at $02FF ($01
// pass, $02 fail) and in the border colour (green or red). The program
// never returns to BASIC, so the colour cells stay as it left them.

.const BITMAP    = $2000
.const SCREEN    = $0400
.const RESULT    = $02ff
.const REC_OVER  = $02f0        // timer overhead of an empty measurement
.const REC_PLOT  = $02f2        // one jsr plot, overhead removed
.const REC_LINE  = $02f4        // one jsr line for the 320-pixel axis, overhead removed
.const REC_BITS  = $02f6        // set bits counted in the bitmap
.const REC_TEAR  = $02f8        // timer reads retried because the high byte moved
.const REC_WANT  = $02fa        // the compiled-in total, for a monitor read
.const REC_ONE   = $02fc        // one jsr line for a one-pixel line, overhead removed

// zero page: BASIC's numeric work area, free because the program never
// returns to BASIC
.const zp_ptr    = $57          // bitmap byte pointer
.const px        = $59          // current x, 16-bit
.const py        = $5b          // current y
.const x1        = $5c          // end x, 16-bit
.const y1        = $5e          // end y
.const dx        = $5f          // |x1 - px|, 16-bit
.const dy        = $61          // |y1 - py|, 16-bit
.const dx2       = $63          // 2 * dx
.const dy2       = $65          // 2 * dy
.const err       = $67          // Bresenham error term, 16-bit signed
.const n         = $69          // steps left on the major axis
.const sx        = $6b          // $01 or $ff
.const sy        = $6c          // $01 or $ff
.const t_hi      = $6d          // timer read scratch
.const t_lo      = $6e

// The line set. Every line lies in its own region of the screen, so no two
// share a pixel and the set-bit count of the finished bitmap is the sum of
// max(|dx|, |dy|) + 1 over the set, which the assembler works out here.
// Directions covered: +x flat, +y vertical, two equal-delta diagonals,
// three shallow lines and a steep line in each of the four sign quadrants.
.var lines = List()
.eval lines.add(List().add(0, 199, 319, 199))     // x axis, bottom row, left to right
.eval lines.add(List().add(0, 0, 0, 198))         // y axis, left column, top to bottom
.eval lines.add(List().add(2, 0, 159, 157))       // 45 degrees, +x +y
.eval lines.add(List().add(160, 157, 317, 0))     // 45 degrees, +x -y
.eval lines.add(List().add(20, 170, 300, 190))    // shallow, +x +y
.eval lines.add(List().add(310, 160, 20, 168))    // shallow, -x +y
.eval lines.add(List().add(150, 197, 40, 192))    // shallow, -x -y
.eval lines.add(List().add(318, 20, 319, 198))    // steep, +x +y
.eval lines.add(List().add(100, 60, 112, 0))      // steep, +x -y
.eval lines.add(List().add(300, 30, 290, 150))    // steep, -x +y
.eval lines.add(List().add(10, 196, 4, 20))       // steep, -x -y
.var NLINES = lines.size()
.var EXPECT = 0
.for (var i = 0; i < NLINES; i++) {
    .var l = lines.get(i)
    .eval EXPECT = EXPECT + max(abs(l.get(2) - l.get(0)), abs(l.get(3) - l.get(1))) + 1
}

BasicUpstart2(start)

* = $0900 "code"

start:
    sei
    lda #$00
    sta $d020
    sta $d021

// screen RAM: every cell white ink on black paper
    lda #$10
    ldx #0
fill_screen:
    sta SCREEN,x
    sta SCREEN + $100,x
    sta SCREEN + $200,x
    sta SCREEN + $2e8,x
    inx
    bne fill_screen

// clear the bitmap, $2000 to $3F3F
    lda #<BITMAP
    sta zp_ptr
    lda #>BITMAP
    sta zp_ptr + 1
    lda #0
    tay
    ldx #32                     // 32 pages: $2000-$3FFF, the 192 bytes past the bitmap included
clear_page:
    sta (zp_ptr),y
    iny
    bne clear_page
    inc zp_ptr + 1
    dex
    bne clear_page

// VIC: screen at $0400, bitmap at $2000, hires, bitmap mode on but the
// display blanked (DEN clear) while the timings run, so no badline stalls
// the CPU under the CIA's count. DEN is sampled once per frame, on line
// $30, so two sightings of line 64 pass before the first measurement.
    lda #$18
    sta $d018
    lda #$08
    sta $d016
    lda #$2b
    sta $d011
    jsr wait_line_64
    jsr wait_line_64

// --- timing: the empty measurement ---------------------------------------
    jsr timer_start
    jsr timer_read
    lda t_lo
    sta REC_OVER
    lda t_hi
    sta REC_OVER + 1

// --- timing: one plot, at the first pixel of the x axis ------------------
    lda #0
    sta px
    sta px + 1
    lda #199
    sta py
    jsr timer_start
    jsr plot
    jsr timer_read
    lda t_lo
    sec
    sbc REC_OVER
    sta REC_PLOT
    lda t_hi
    sbc REC_OVER + 1
    sta REC_PLOT + 1

// --- timing: a one-pixel line, the line routine's fixed cost -------------
// Start and end are both (0, 199), the pixel the plot above already set.
    lda #0
    sta px
    sta px + 1
    sta x1
    sta x1 + 1
    lda #199
    sta py
    sta y1
    jsr timer_start
    jsr line
    jsr timer_read
    lda t_lo
    sec
    sbc REC_OVER
    sta REC_ONE
    lda t_hi
    sbc REC_OVER + 1
    sta REC_ONE + 1

// --- timing: the longest line, the 320-pixel x axis ----------------------
    ldx #0
    jsr load_line
    jsr timer_start
    jsr line
    jsr timer_read
    lda t_lo
    sec
    sbc REC_OVER
    sta REC_LINE
    lda t_hi
    sbc REC_OVER + 1
    sta REC_LINE + 1

// --- the rest of the set --------------------------------------------------
    ldx #1
draw_all:
    txa
    pha
    jsr load_line
    jsr line
    pla
    tax
    inx
    cpx #NLINES
    bne draw_all

// display on
    lda #$3b
    sta $d011

// --- count the set bits in the 8000 bitmap bytes -------------------------
    lda #0
    sta REC_BITS
    sta REC_BITS + 1
    lda #<BITMAP
    sta zp_ptr
    lda #>BITMAP
    sta zp_ptr + 1
    lda #<8000
    sta n
    lda #>8000
    sta n + 1
count_byte:
    ldy #0
    lda (zp_ptr),y
    beq count_next
    ldx #8
count_bit:
    asl
    bcc count_skip
    inc REC_BITS
    bne count_skip
    inc REC_BITS + 1
count_skip:
    dex
    bne count_bit
count_next:
    inc zp_ptr
    bne !+
    inc zp_ptr + 1
!:  lda n
    bne !+
    dec n + 1
!:  dec n
    lda n
    ora n + 1
    bne count_byte

// --- verdict ----------------------------------------------------------------
    lda #<EXPECT
    sta REC_WANT
    lda #>EXPECT
    sta REC_WANT + 1
    lda REC_BITS
    cmp #<EXPECT
    bne fail
    lda REC_BITS + 1
    cmp #>EXPECT
    bne fail
    lda #$01
    sta RESULT
    lda #$05
    sta $d020
    jmp halt
fail:
    lda #$02
    sta RESULT
    sta $d020
halt:
    jmp halt

// --- wait_line_64: return during raster line 64, after it was not 64 -----
wait_line_64:
    lda $d012
    cmp #$40
    beq wait_line_64
wait_64:
    lda $d011
    bmi wait_64                 // lines 256 and up read $40 too on PAL
    lda $d012
    cmp #$40
    bne wait_64
    rts

// --- load_line: copy line X of the table into px, py, x1, y1 --------------
load_line:
    lda line_x0_lo,x
    sta px
    lda line_x0_hi,x
    sta px + 1
    lda line_y0,x
    sta py
    lda line_x1_lo,x
    sta x1
    lda line_x1_hi,x
    sta x1 + 1
    lda line_y1,x
    sta y1
    rts

// --- plot: set pixel (px, py) -----------------------------------------------
// Address = row_lo/row_hi[py] + (px & $F8), carrying px's high byte in;
// the bit is mask[px & 7].
plot:
    ldy py
    lda px
    and #$f8
    clc
    adc row_lo,y
    sta zp_ptr
    lda row_hi,y
    adc px + 1
    sta zp_ptr + 1
    lda px
    and #$07
    tax
    lda mask,x
    ldy #0
    ora (zp_ptr),y
    sta (zp_ptr),y
    rts

// --- line: draw from (px, py) to (x1, y1) inclusive -------------------------
// Bresenham with the error term held in 16 bits. The major axis is the one
// with the larger delta; the loop steps it every pixel and steps the other
// axis when the error term is zero or positive. Both loops step in either
// direction through sx and sy, so all eight octants are covered by two loops.
line:
    lda #$01
    sta sx
    sta sy
    sec
    lda x1
    sbc px
    sta dx
    lda x1 + 1
    sbc px + 1
    sta dx + 1
    bpl dx_done
    lda #$ff
    sta sx
    sec
    lda #0
    sbc dx
    sta dx
    lda #0
    sbc dx + 1
    sta dx + 1
dx_done:
    sec
    lda y1
    sbc py
    sta dy
    lda #0
    sbc #0
    sta dy + 1
    bpl dy_done
    lda #$ff
    sta sy
    sec
    lda #0
    sbc dy
    sta dy
    lda #0
    sbc dy + 1
    sta dy + 1
dy_done:
    lda dx
    asl
    sta dx2
    lda dx + 1
    rol
    sta dx2 + 1
    lda dy
    asl
    sta dy2
    lda dy + 1
    rol
    sta dy2 + 1
// steep if dy > dx
    lda dx
    cmp dy
    lda dx + 1
    sbc dy + 1
    bcc steep

// shallow: x is the major axis. err = 2*dy - dx, n = dx
    lda dx
    sta n
    lda dx + 1
    sta n + 1
    sec
    lda dy2
    sbc dx
    sta err
    lda dy2 + 1
    sbc dx + 1
    sta err + 1
shallow_loop:
    jsr plot
    lda n
    ora n + 1
    beq shallow_done
    lda n
    bne !+
    dec n + 1
!:  dec n
    lda err + 1
    bmi shallow_no_y
    lda py
    clc
    adc sy
    sta py
    sec
    lda err
    sbc dx2
    sta err
    lda err + 1
    sbc dx2 + 1
    sta err + 1
shallow_no_y:
    clc
    lda err
    adc dy2
    sta err
    lda err + 1
    adc dy2 + 1
    sta err + 1
    jsr step_x
    jmp shallow_loop
shallow_done:
    rts

// steep: y is the major axis. err = 2*dx - dy, n = dy
steep:
    lda dy
    sta n
    lda dy + 1
    sta n + 1
    sec
    lda dx2
    sbc dy
    sta err
    lda dx2 + 1
    sbc dy + 1
    sta err + 1
steep_loop:
    jsr plot
    lda n
    ora n + 1
    beq line_done
    lda n
    bne !+
    dec n + 1
!:  dec n
    lda err + 1
    bmi steep_no_x
    jsr step_x
    sec
    lda err
    sbc dy2
    sta err
    lda err + 1
    sbc dy2 + 1
    sta err + 1
steep_no_x:
    clc
    lda err
    adc dx2
    sta err
    lda err + 1
    adc dx2 + 1
    sta err + 1
    lda py
    clc
    adc sy
    sta py
    jmp steep_loop
line_done:
    rts

// px += sx, 16-bit, sx is $01 or $ff
step_x:
    lda sx
    bmi step_x_left
    inc px
    bne !+
    inc px + 1
!:  rts
step_x_left:
    lda px
    bne !+
    dec px + 1
!:  dec px
    rts

// --- CIA1 timer A as a stopwatch ------------------------------------------
// timer_start loads $FFFF and starts the timer counting down at one count
// per cycle. timer_read stores $FFFF - timer in t_lo/t_hi: the cycles from
// the start to the read, including the two calls' own overhead, which the
// empty measurement records and the figures subtract.
timer_start:
    lda #$00
    sta $dc0e
    lda #$ff
    sta $dc04
    sta $dc05
    lda #$11                    // force load, continuous, start
    sta $dc0e
    rts

timer_read:
    lda $dc05
    sta t_hi
    lda $dc04
    sta t_lo
    lda $dc05
    cmp t_hi
    beq read_ok
    inc REC_TEAR
    jmp timer_read
read_ok:
    lda #$ff
    sec
    sbc t_lo
    sta t_lo
    lda #$ff
    sbc t_hi
    sta t_hi
    rts

// --- tables -------------------------------------------------------------------
// Row address table: the byte holding pixel (0, y) is
// BITMAP + (y / 8) * 320 + (y & 7): 320 bytes per cell row, one byte per
// scanline inside the cell.
// Each table sits inside one page, so the indexed reads in plot never pay
// the page-crossing cycle (unaligned, plot measured 65 cycles at y = 199
// instead of 63).
.align $100
row_lo:
    .fill 200, <(BITMAP + floor(i / 8) * 320 + mod(i, 8))
.align $100
row_hi:
    .fill 200, >(BITMAP + floor(i / 8) * 320 + mod(i, 8))
mask:
    .byte $80, $40, $20, $10, $08, $04, $02, $01

line_x0_lo:
    .fill NLINES, <lines.get(i).get(0)
line_x0_hi:
    .fill NLINES, >lines.get(i).get(0)
line_y0:
    .fill NLINES, lines.get(i).get(1)
line_x1_lo:
    .fill NLINES, <lines.get(i).get(2)
line_x1_hi:
    .fill NLINES, >lines.get(i).get(2)
line_y1:
    .fill NLINES, lines.get(i).get(3)
```

## Build

```bash
java -jar $KICKASS_JAR hires-plot-line.asm -o hires-plot-line.prg
```

KickAssembler 5.25 produces a 1,555-byte PRG; the code segment runs
`$0900` to `$0E11`, with the two row tables page-aligned at `$0C00` and
`$0D00` and the mask and line tables after them.

Pinned VICE run (both models, `docs/recipes/runs.json`):

```bash
GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas \
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 \
      -limitcycles 8000000 -exitscreenshot hires-plot-line.png \
      -autostart hires-plot-line.prg
```

Add `-model ntsc` for the second picture. To read the figures back, add
`-moncommands verdict.mon` with a file that traces the verdict store and
dumps the record bytes when it happens (the route is in
`runtime/vice-reference.md`, "Verifying a run without a human"):

```text
logname "/tmp/verdict.log"
log on
trace store 02ff
command 1 "m 02f0 02ff"
```

## Expected output

Green border, black paper, white lines. The picture is the drawing
itself: the x axis along the bottom row, the y axis down the left column,
two diagonals meeting near the middle of row 157, a shallow line each way
across the lower part of the screen, a short shallow line above the axis,
and four steep lines, one near each side. Nothing is printed.

`recipes/kickassembler/screenshots/hires-plot-line.png` (PAL, 384 by 272)
and `hires-plot-line-ntsc.png` (NTSC, 384 by 247) were each produced twice
by the pinned command with identical bytes. Counted with PIL, the display
window (x 32 to 351, screenshot rows 35 to 234 on PAL, 23 to 222 on NTSC)
holds 2,056 pure white pixels on both models, and the border pixel at
(2, 100) is VICE's green (measured in VICE x64sc 3.10, rung 1).

The monitor dump on the verdict store reads the same on both models:

```text
>C:02f0  14 00 3f 00
>C:02f4  56 aa 08 08
>C:02f8  00 00 08 08
>C:02fc  d6 00 00 01
```

- `$02F0`: 20 cycles, the empty measurement (the `rts` of `timer_start`,
  the call into `timer_read` and its first two reads).
- `$02F2`: 63 cycles for `jsr plot` with the overhead removed. The
  instruction table gives the same 63 (rung 3). Before the row tables
  were page-aligned the same plot at y = 199 measured 65: both indexed
  reads crossed a page.
- `$02F4`: 43,606 cycles for `jsr line` on the 320-pixel axis.
- `$02F6`: 2,056 set bits counted in the bitmap; `$02FA` the compiled-in
  total, also 2,056. A Python Bresenham over the same eleven endpoint
  pairs, in the same form as the listing, gives 2,056 pixels with no two
  lines sharing one, so the two counts agree because nothing overlaps,
  not by accident.
- `$02F8`: 0 timer reads retried because the high byte moved between
  reads.
- `$02FC`: 214 cycles for a one-pixel line, the routine's fixed cost
  (setup, the first plot, the exit test).
- `$02FF`: `01`, pass.

From the one-pixel and the 320-pixel figures, each further pixel of a
flat line costs (43,606 - 214) / 319 = 136 cycles (rung 3 from two rung 1
figures). The instruction table for the shallow loop gives 63 for the
plot and 73 for the step, also 136. A sweep of flat lines of 2, 3, 256,
257, 258, 301, 319 and 320 pixels with the same listing is described
under "Why this works".

Before the display was blanked for the timing, the 320-pixel line
measured 47,028 cycles on PAL and 47,119 on NTSC, both wrong as a cost of
the routine: the CIA counts while a badline holds the CPU, and the two
models put a different number of badlines under a 44,000-cycle window.

## Why this works

**The plot.** Pixel (x, y) lives in the cell at column x / 8 and row
y / 8; cells are stored row by row, eight bytes per cell, so the cell row
starts at `$2000 + (y / 8) * 320` and the byte for scanline y inside it is
`+ (y & 7)`. The row table holds that sum for each of the 200 values of y,
low bytes in one page and high bytes in another. Adding `x & $F8` to the
low byte, with x's high byte carried into the high byte, reaches the cell:
`x & $F8` is the column times eight, which is the byte offset of
that column's cell within the row. The bit inside the byte is the mask
table entry for `x & 7`, `$80` for the leftmost pixel, and an `ORA` sets
it without disturbing its neighbours. Each table sits in one page because
`LDA abs,Y` costs a cycle more when the index carries into the next page,
and y = 199 did.

**The line.** The routine takes the two deltas, remembers a sign for
each as `$01` or `$FF`, and works on their magnitudes. The axis with the
larger delta is the major axis: the loop steps it on every pixel and
steps the other axis only when the error term is zero or positive. The
error term starts at `2 * minor - major` and gains `2 * minor` each
step, less `2 * major` whenever the minor axis stepped; it is the
distance from the true line, scaled by two so no half appears. The
deltas reach 319, so the term and the doubled deltas are 16-bit and the
sign test is one `BMI` on the high byte; the values stay within about
-640 to 640, so the high byte's bit 7 is the true sign. Two loops, one
for each major axis, cover all eight octants because each steps its
major axis by `sx` or `sy`. The loop counts `major` steps after the
first pixel, so the last pixel is the end point in every octant, which
the Python model asserts for the eleven lines here.

**Why the sweep matters.** Flat lines of 2, 3, 256, 257, 258, 301, 319
and 320 pixels were timed with the same listing, changing only the first
endpoint pair (measured in VICE x64sc, PAL). Every figure fits 214 + 136
per further pixel, plus 4 cycles once the step count's low byte passes
zero and 4 once x crosses 255: 350, 34,894, 35,038, 35,174, 41,022,
43,470 and 43,606. The 3-pixel line read 518, 32 over the model, and its
`$02F8` read 1: the timer's high byte moved between the two reads, the
read was retried, and the retry is 32 cycles with the timer running. A
figure from this harness is only clean when `$02F8` is 0. The committed
layout keeps `shallow_loop`, `step_x` and every branch target in
`$0B00`-`$0BFF`. The same listing without the one-pixel measurement in
front of the loop measured 43,925 for the 320-pixel line, 319 more: its
`bne` that skips the high-byte decrement sat at `$0AFC` with its target
at `$0B00`, so the taken branch crossed a page on every step
(`pitfalls/cpu.md`, `branch_page_cross_extra_cycle`). A cost quoted for a
line routine is a cost of one layout.

**Blanking for the count.** DEN (`$D011` bit 4) is sampled once per
frame, on line `$30`, so clearing it stops badlines from the next frame
on, not from the next line. The program clears it and waits for two
sightings of raster line 64 before the first measurement; that crosses
one line `$30` with DEN clear. It sets DEN again before counting bits,
so the exit screenshot shows the drawing.

**Why the verdict is a count.** The set-bit count is a property of the
finished bitmap, not of the plot calls: a plot that hit the wrong byte,
or a line that ran a pixel long or short, changes it. It equals the sum
of `max(|dx|, |dy|) + 1` over the set only if no two lines share a pixel,
so the endpoints were chosen in separate regions and the Python model
checks the overlap as well as the count. The program never returns to
BASIC: `READY.` and the cursor would land in screen RAM, which is the
colour matrix here, and the picture would change with the cursor's phase.
