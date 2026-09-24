---
recipe: dot-flag
toolchain: kickassembler
output_format: PRG
region: both
techniques: [dot_flag_sine_plotter, hires_plot, standard_bitmap]
file_formats: [PRG]
uses_registers: [D011, D012, D016, D018, D020, D021, DC04, DC05, DC0E]
uses_kernal: []
harness: [cia1_timer_a]
---

<!-- doc-type: recipe -->

# KickAssembler — A dot flag: 128 dots on two sines, plotted and erased every frame in a hires bitmap, timed

## Synopsis

Puts a standard bitmap at `$2000` with screen RAM at `$0400` set to white
ink on black paper, and every frame plots a 16 by 8 grid of dots whose x
follows one sine and whose y another, so the grid ripples like a flag.
Each dot is set through the row address table and mask table of
`hires_plot`, and the 128 bitmap addresses and inverted masks are saved
as they are plotted so the next frame can erase the grid with 128 `AND`s
before it plots again. The time variable advances by 2 a frame for 300
frames, then the program stops drawing and spins, so the picture is
static for the exit screenshot. Every frame's erase-plus-plot cost is
measured with CIA1 timer A and stored, two bytes a frame, from `$1000`;
frame 0 runs with the display blanked so its figure is the CPU's alone.
Built with `-define NOERASE` the erase pass is left out and the dots
leave trails, which is the control for the erase list. The technique is
`dot_flag_sine_plotter` in `techniques/effects-vector-3d.md`.

## Source

```asm
// dot-flag.asm
// A 16 by 8 grid of dots whose x follows one sine and whose y follows
// another, plotted every frame into a hires bitmap at $2000 through a row
// address table and a mask table, erased the next frame from a saved list
// of 128 bitmap addresses and inverted masks. Column i shares one x, so x
// is worked out sixteen times a frame and y one hundred and twenty-eight
// times. t advances by 2 a frame for 300 frames, then the program stops
// drawing and spins, so the picture is static for the exit screenshot.
// Each frame's erase-plus-plot cost is CIA1-timed and stored, two bytes a
// frame, at $1000; frame 0 runs with the display blanked (DEN clear) so its
// figure is the CPU's alone, the rest run with the display on.
// Build with -define NOERASE for the control that never erases.

.const BITMAP    = $2000
.const SCREEN    = $0400
.const FRAMES    = 300
.const TIMES     = $1000        // FRAMES 16-bit CIA counts, overhead removed
.const REC_OVER  = $02f0        // timer overhead of an empty measurement
.const REC_FRAME = $02f2        // frames completed
.const REC_DONE  = $02ff        // $01 when the 300 frames are drawn

// zero page: BASIC's numeric work area, free because the program never
// returns to BASIC
.const ptr       = $57          // bitmap byte pointer
.const t         = $59          // time, advances by 2 a frame
.const phx       = $5a          // x phase of the current column: t + 12 * i
.const phy0      = $5b          // y phase base of the current column: 2 * t + 6 * i
.const c8lo      = $5c          // column * 8, low byte, for the current column
.const c8hi      = $5d          // column * 8, high byte (0 or 1)
.const m         = $5e          // mask of the current column's pixel
.const minv      = $5f          // its inverse, for the erase list
.const ci        = $60          // columns left
.const xl        = $61          // x, 16-bit
.const xh        = $62
.const t_lo      = $63          // timer read scratch
.const t_hi      = $64
.const tp        = $65          // pointer into TIMES

BasicUpstart2(start)

* = $0900 "code"

start:
    sei
    lda #$00
    sta $d020
    sta $d021
    sta t
    sta REC_FRAME
    sta REC_FRAME + 1
    lda #<TIMES
    sta tp
    lda #>TIMES
    sta tp + 1

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

// clear the bitmap, $2000 to $3FFF
    lda #<BITMAP
    sta ptr
    lda #>BITMAP
    sta ptr + 1
    lda #0
    tay
    ldx #32
clear_page:
    sta (ptr),y
    iny
    bne clear_page
    inc ptr + 1
    dex
    bne clear_page

// the erase list before the first frame: 128 harmless entries, the first
// bitmap byte with an all-ones mask, so frame 0's erase costs what every
// other erase costs and changes nothing
    lda #<BITMAP
    ldx #0
init_list:
    sta list_lo,x
    inx
    bpl init_list
    lda #>BITMAP
    ldx #0
!:  sta list_hi,x
    inx
    bpl !-
    lda #$ff
    ldx #0
!:  sta list_inv,x
    inx
    bpl !-

// VIC: screen at $0400, bitmap at $2000, hires, bitmap mode on with the
// display blanked (DEN clear) for frame 0. DEN is sampled once a frame on
// line $30, so two sightings of line 64 pass before the timed frame.
    lda #$18
    sta $d018
    lda #$08
    sta $d016
    lda #$2b
    sta $d011
    jsr wait_line_64
    jsr wait_line_64

// the empty measurement
    jsr timer_start
    jsr timer_read
    lda t_lo
    sta REC_OVER
    lda t_hi
    sta REC_OVER + 1

// --- the frame loop ---------------------------------------------------------
frame:
    jsr wait_line_250
    jsr timer_start
#if !NOERASE
    jsr erase
#endif
    jsr draw
    jsr timer_read
    lda t_lo
    sec
    sbc REC_OVER
    ldy #0
    sta (tp),y
    lda t_hi
    sbc REC_OVER + 1
    iny
    sta (tp),y
    lda tp
    clc
    adc #2
    sta tp
    bcc !+
    inc tp + 1
!:  lda #$3b                    // display on from frame 1
    sta $d011
    lda t
    clc
    adc #2
    sta t
    inc REC_FRAME
    bne !+
    inc REC_FRAME + 1
!:  lda REC_FRAME
    cmp #<FRAMES
    bne frame
    lda REC_FRAME + 1
    cmp #>FRAMES
    bne frame
    lda #$01
    sta REC_DONE
halt:
    jmp halt

// --- erase: AND every listed byte with its saved inverted mask ------------
erase:
    ldy #0
    ldx #0
erase_loop:
    lda list_lo,x
    sta ptr
    lda list_hi,x
    sta ptr + 1
    lda (ptr),y
    and list_inv,x
    sta (ptr),y
    inx
    bpl erase_loop
    rts

// --- draw: compute and plot the 128 dots, saving each in the list ---------
// Column i (0 to 15) has x = 160 + sinx[t + 12 * i]; its eight dots j have
// y = 100 + siny[2 * t + 24 * j + 6 * i]. x is 60 to 260 and y 40 to 160,
// so nothing needs clipping.
draw:
    lda t
    sta phx
    asl
    sta phy0
    lda #16
    sta ci
    ldx #0                      // list index, 0 to 127
column:
// x, in 16 bits because it reaches 260
    ldy phx
    lda sinx,y
    ldy #0
    cmp #$80                    // ldy has just set the flags, so test A again
    bcc !+
    dey                         // sign extend: high byte $FF
!:  clc
    adc #160
    sta xl
    tya
    adc #0
    sta xh
// the pixel's mask and its inverse, from x & 7
    lda xl
    and #$07
    tay
    lda mask,y
    sta m
    lda maskinv,y
    sta minv
// the column's byte offset in a row: (x >> 3) * 8, from the 40-entry table
    lsr xh
    lda xl
    ror
    lsr
    lsr
    tay
    lda col8_lo,y
    sta c8lo
    lda col8_hi,y
    sta c8hi
// the eight dots of the column, unrolled: siny is stored twice over so
// siny + 24 * j indexed by a full byte never runs off the table
    .for (var j = 0; j < 8; j++) {
        ldy phy0
        lda siny + 24 * j,y
        clc
        adc #100
        tay                     // y, 40 to 160
        lda row_lo,y
        clc
        adc c8lo
        sta ptr
        sta list_lo,x
        lda row_hi,y
        adc c8hi
        sta ptr + 1
        sta list_hi,x
        ldy #0
        lda (ptr),y
        ora m
        sta (ptr),y
        lda minv
        sta list_inv,x
        inx
    }
// next column: x phase on by 12, y phase base by 6
    lda phx
    clc
    adc #12
    sta phx
    lda phy0
    clc
    adc #6
    sta phy0
    dec ci
    beq draw_done               // the unrolled block puts column out of a branch's reach
    jmp column
draw_done:
    rts

// --- wait_line_250: return during raster line 250, after it was not 250 --
// Line 250 is the last line of the display window's last cell row; the
// erase runs in the blank that follows.
wait_line_250:
    lda $d012
    cmp #$fa
    beq wait_line_250
wait_250:
    lda $d011
    bmi wait_250
    lda $d012
    cmp #$fa
    bne wait_250
    rts

// --- wait_line_64: return during raster line 64, after it was not 64 -----
wait_line_64:
    lda $d012
    cmp #$40
    beq wait_line_64
wait_64:
    lda $d011
    bmi wait_64
    lda $d012
    cmp #$40
    bne wait_64
    rts

// --- CIA1 timer A, one-shot from $FFFF; the count is $FFFF - the read ----
timer_start:
    lda #$00
    sta $dc0e
    lda #$ff
    sta $dc04
    sta $dc05
    lda #$19                    // force load, one-shot, start
    sta $dc0e
    rts

timer_read:
    lda $dc05
    sta t_hi
    lda $dc04
    sta t_lo
    lda $dc05
    cmp t_hi
    bne timer_read
    lda #$ff
    sec
    sbc t_lo
    sta t_lo
    lda #$ff
    sbc t_hi
    sta t_hi
    rts

// --- tables -------------------------------------------------------------------
// Sines as signed bytes. Amplitudes 100 and 60 are below 128, so no entry
// reaches the byte's edge and nothing wraps (pitfalls/maths.md,
// sine_table_peak_wraps_to_zero, is about amplitude 128).
* = $1800 "tables"
sinx:
    .fill 256, round(100 * sin(toRadians(i * 360 / 256)))
siny:
    .fill 512, round(60 * sin(toRadians(mod(i, 256) * 360 / 256)))
// Row address table: the byte holding pixel (0, y) is
// BITMAP + (y / 8) * 320 + (y & 7). Each table sits inside one page.
row_lo:
    .fill 200, <(BITMAP + floor(i / 8) * 320 + mod(i, 8))
.align $100
row_hi:
    .fill 200, >(BITMAP + floor(i / 8) * 320 + mod(i, 8))
.align $100
mask:
    .byte $80, $40, $20, $10, $08, $04, $02, $01
maskinv:
    .byte $7f, $bf, $df, $ef, $f7, $fb, $fd, $fe
col8_lo:
    .fill 40, <(i * 8)
col8_hi:
    .fill 40, >(i * 8)
// the erase list: where last frame's 128 dots are and which bit each is
.align $100
list_lo:
    .fill 128, 0
list_hi:
    .fill 128, 0
list_inv:
    .fill 128, 0
```

## Build

```bash
java -jar KickAss.jar dot-flag.asm -o dot-flag.prg
```

For the control without the erase pass:

```bash
java -jar KickAss.jar dot-flag.asm -define NOERASE -o dot-flag-noerase.prg
```

## Expected output

A black screen with 128 white single pixels in a 16 by 8 grid that has
been bent twice: the columns lean left and right along one sine, and the
rows rise and fall along another that also runs across the columns, so
the grid ripples like a flag. After 300 frames the
program stops drawing and the picture holds still.

Measured in VICE x64sc 3.10 with the pinned command at 12,000,000 cycles,
`$02FF` read `01` and `$02F2` read 300 (frames done) on both models, so
the picture is static at the pin; the pictures are byte-identical across
two runs on each model (PAL MD5 `d322ed7f…`, NTSC `f8a1c4b7…`). Counting
non-black pixels inside the display window of the PAL picture (PNG
x 32 to 351, y 35 to 234) with PIL gives 128, the whole grid, spanning
bitmap x 60 to 246 and y 40 to 160 at that frame; the NTSC picture gives
the same 128 at the same places, because t is a frame count and both
runs finished the same 300 frames. The x range is 60 to 260 over the
whole run (the mid-motion picture below reaches 260); the pinned frame
does not happen to hold a dot at the right-hand peak.

Screenshots from the VICE runs this page describes:
`screenshots/dot-flag.png` (PAL) and `screenshots/dot-flag-ntsc.png`.

Two further pictures, not pinned, made with the same command and other
cycle counts, live under `docs/figures/`:

- `figures/dot-flag-mid-5000000.png`: PAL, `-limitcycles 5000000`, while
  the flag is still moving. It shows the shape, and it shows 91 lit
  pixels, not 128. The exit screenshot is the draw buffer at the moment
  the limit hits, and at that moment the frame's plot pass had not
  finished: dots in rows the beam had already passed, erased in the blank
  and not yet replotted, are missing from the picture, which is the
  flicker a real display would show at the same instant (see "Where the
  work runs" below).
- `figures/dot-flag-no-erase-12000000.png`: PAL, the `NOERASE` build at
  the pinned cycle count. 3,570 lit pixels: the union of the 300 frames'
  128 positions, with every position a dot ever visited still lit. That
  is the trail the erase list removes.

The timer figures, read from the running machine with a `-moncommands`
file that traces the store to `$02FF` and dumps `$02F0`-`$02FF` and
`$1000`-`$1257`, overhead of an empty measurement (20 cycles) removed:

| | PAL | NTSC |
|---|---|---|
| Frame 0, display blanked (erase + plot) | 15,233 | 15,233 |
| Frames 1 to 299, display on, least | 16,005 | 16,261 |
| Frames 1 to 299, display on, most | 16,098 | 16,356 |
| Frames 1 to 299, display on, mean | 16,049 | 16,307 |
| Frame 0, blanked, `NOERASE` build (plot only) | 10,866 | not measured here |

The blanked frame is the same on both models because the CPU's work is
the same; the display-on frames differ because the plot pass runs while
the VIC is fetching, and the badlines it crosses stall the CPU under the
timer's count (the timer keeps counting while the CPU is stalled). The
frame-to-frame spread of about 90 cycles comes from the sign branch in
the sixteen x computations and from where each frame's plot pass falls
against the badlines.

## Why this works

### The tables

`sinx` is 256 signed bytes of `round(100 * sin)` and `siny` is
`round(60 * sin)`, stored twice over (512 bytes) so that `siny + 24 * j`
indexed by a whole byte never reads past the table. Both amplitudes are
below 128, so no entry can reach the edge of the byte and nothing wraps:
`sine_table_peak_wraps_to_zero` in `pitfalls/maths.md` is about an
unsigned table of amplitude 128 about 128, whose peak is 256 and comes
out as 0 from `.fill`; a signed table of amplitude 100 peaks at 100 and
troughs at -100, both representable. The row table and the mask table are
the ones `hires_plot` describes (`techniques/bitmap-modes.md`): `row_lo`
and `row_hi` hold the address of pixel (0, y) for y from 0 to 199, each
in its own page so the indexed reads never pay the page-crossing cycle,
and `mask` holds `$80` down to `$01` for x & 7. `maskinv` is the same
eight bytes inverted, saved with each dot for the erase. `col8_lo` and
`col8_hi` hold `column * 8` for the forty columns, which is the byte
offset of a column's cell within a row; the high byte is 1 from column
32 on, so the column offset is added to the row address in 16 bits.

### The two sines and the frame order

Dot (i, j), with i the column from 0 to 15 and j the row from 0 to 7, is
at `x = 160 + sinx[(t + 12 * i) & 255]` and
`y = 100 + siny[(2 * t + 24 * j + 6 * i) & 255]`. x depends on i alone,
so the listing works it out once per column: the sine byte is sign
extended to 16 bits (a `cmp #$80` after the `ldy #0`, because `ldy` has
just overwritten the flags the `lda` set; the first build used `bpl`
there and every negative x came out 256 too far right), 160 is added,
the mask pair is looked up from the low three bits, and the 16-bit value
is shifted right three times for the column. The eight dots of the column
are then unrolled with `.for`, each one a `siny` lookup, an add of 100, a
row lookup, the column offset added in, the plot, and three stores into
the erase list. With amplitudes 100 and 60, x lies in 60 to 260 and y in
40 to 160 (arithmetic), so there is no clipping code.

The frame is: wait for raster line 250, start the timer, erase last
frame's 128 dots from the list, plot this frame's 128 and overwrite the
list, read the timer, then advance t by 2. Erasing before plotting means
a dot that lands where another dot was last frame is not wiped by that
dot's erase, and two dots that share a pixel this frame are erased
cleanly next frame because both entries `AND` the same bit off.

### Where the work runs

The blank after line 250 is 107 lines on PAL, about 6,700 cycles
(`full_field_redraw_exceeds_vblank` in `pitfalls/text-mode-render.md`
does the arithmetic). The erase costs 15,233 minus 10,866, which is
4,367 cycles (arithmetic from the two blanked figures), about 69 lines,
so it finishes inside the blank and no dot is ever seen half erased. The
plot costs 10,866 cycles, about 172 lines, and runs from about line 7 to
about line 180, while the beam is in the display window from line 51 and
crosses the dots' rows (raster lines 90 to 210) from line 90. The columns
are plotted in order, so when the beam reaches a row the left-hand
columns are already there and the right-hand ones are not yet; those
dots are absent from that field and present from the next, which a
viewer sees as flicker on the right of the picture and the mid-motion
figure shows as 91 lit pixels of 128. A build that wanted the picture
whole every field would draw into a second bitmap and swap `$D018` in
the blank, at the price of a second 8,000-byte bitmap and a second
erase list; this listing does not, because it demonstrates the plot
and the erase.

Both models finish a frame inside a frame: the worst display-on frame is
16,098 cycles on PAL against 19,656 a frame, and 16,356 on NTSC against
17,095 (263 lines of 65), so the loop is back at `wait_line_250` before
line 250 comes round again and t advances once per displayed frame
(arithmetic from the measured worst frames; the NTSC margin is about 700
cycles, some eleven lines). The 300 frames take 6 seconds of PAL machine
time and 5 of NTSC (arithmetic, at 50 and 60 frames a second), and
12,000,000 cycles is about 12 seconds, so both pinned runs were long
finished; `$02F2` reading 300 in both dumps says the same.

### What the timer measures

CIA1 timer A is loaded with `$FFFF` and started in one-shot mode
(`$DC0E = $19`); the count read back after the work, subtracted from
`$FFFF`, is the cycles elapsed, and the 20-cycle empty measurement taken
once at the start is subtracted from every frame before it is stored.
The timer counts machine cycles whether or not the CPU is running, so a
display-on frame includes the badline stalls the plot pass suffers, which
is why frame 0 was run with DEN clear: its 15,233 is what the code costs,
the display-on figures are what the frame costs. Per dot, 15,233 / 128
is 119.0 cycles for erase plus plot, and the two blanked figures split it
as 34.1 for the erase (4,367 / 128) and 84.9 for the plot (10,866 / 128,
which includes the sixteen per-column x computations and the loop
overhead). All three are arithmetic from the measured frames.

### Region

`region: both`. The mechanism is the same on NTSC; the animation runs 20 %
faster because t is a frame count, the display-on frame costs about 260
cycles more because the plot pass crosses more badlines relative to where
it starts, and the frame still fits with about 700 cycles to spare. Both
pinned pictures hold the same 128 pixels.

### What it does not establish

**Real hardware.** Every figure on this page is from VICE x64sc 3.10; no
C64 was run.

**More than 128 dots.** The arithmetic on the technique page for how many
dots fit a frame is an extrapolation from this listing's per-dot figure;
no build with more dots was made or timed.

**Colour.** The bitmap is one ink on one paper. A coloured dot flag would
write screen RAM cells per dot or use multicolour bitmap mode, and
neither was built.

**The NTSC no-erase figure.** The `NOERASE` control was timed and
photographed on PAL only.
