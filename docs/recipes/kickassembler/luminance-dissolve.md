---
recipe: luminance-dissolve
toolchain: kickassembler
output_format: PRG
region: both
techniques: [luminance_dissolve]
file_formats: [PRG]
uses_registers: [D011, D012, D020, D021, DC04, DC05, DC0D, DC0E]
uses_kernal: []
claims: [cia1_timer_b (init), cia1_tod (init), zero_page $FB-$FC (owns)]
harness: [cia1_timer_a, $02FF, $0340-$034B]
ram: [colour=$D800-$DBFF]
---

<!-- doc-type: recipe -->

# KickAssembler: Luminance dissolve

## Synopsis

A colour-RAM picture fades to black one cell at a time, in an order that
looks random, each visited cell dropping three places down the luminance
order of the sixteen colours. Screen RAM holds the reverse space (screen
code 160) in every cell, so the picture is colour RAM alone: here a
checkerboard of white and yellow blocks, eight cells wide and five tall.
After 50 frames of hold the listing pulls N states a frame from a
maximal 10-bit Galois LFSR (x^10 + x^7 + 1, period 1,023), skips states
of 1,000 and above, and for each cell named replaces its colour nibble
with the entry of a sixteen-byte step table: `colour_fade`'s luminance
order 0 6 9 2 11 8 4 14 12 5 10 3 15 13 7 1, three places down, black
for the three darkest. N is 60 on PAL and 50 on NTSC, chosen from the
highest raster line. A white cell is black after five visits, so five
sweeps of the register end the fade: 84 frames on PAL and 100 on NTSC,
measured. Use it when a transition should look like grain rather than a
dimmer: it needs no second picture, no black frame and no work in screen
RAM.

Verified in VICE x64sc 3.10 (the windowless build; its run log reads
`*** VICE Version 3.10 ***`): the checkerboard stands for a second, then
breaks up into light grey and cyan with green and grey grains, darkens
through purple and orange, red and brown, to black, and the border turns
green at frame 200 when the listing's own check passes.

## Source

```asm
// luminance-dissolve.asm
// A colour-RAM picture fades to black cell by cell. Screen RAM holds the
// reverse space (screen code 160) in every cell, so each cell shows its
// colour-RAM nibble and the picture is colour RAM alone: a checkerboard of
// white and yellow blocks, eight cells wide and five tall, 1,000 lit cells.
//
// After HOLD frames the dissolve starts. Each frame pulls N states from a
// maximal 10-bit Galois LFSR (x^10 + x^7 + 1, taps $240 in the
// right-shifting form, period 1,023), skips states of 1,000 and above, and
// for each cell named replaces its colour with the one three places down
// colour_fade's luminance order (0 6 9 2 11 8 4 14 12 5 10 3 15 13 7 1),
// black for the three darkest. Cell 0, which no state names, is visited
// whenever the state returns to the seed. N is 60 on PAL and 50 on NTSC,
// told apart by the highest raster line seen. A white cell is black after
// five visits, so five sweeps of 1,023 pulls end the fade: 86 frames at 60
// and 103 at 50 by arithmetic; the listing records the frame the last lit
// cell went out.
//
// Self-check from real state: the LFSR period is counted once at start-up
// (must be 1,023); at frame MID the cells whose colour is neither black nor
// a picture colour are counted (at least MID_MIN); at frame 200 the black
// cells are counted (must be 1,000). Border green ($02FF = 1) when all
// three hold, red ($02FF = 2) otherwise. The FORCE_FAULT build writes black
// on every visit instead of the next colour down, so the picture goes
// straight to black, the mid count is zero and the verdict is red.
//
// Region: both. Costs measured with CIA1 timer A (see the recipe page).

.const SCREEN  = $0400
.const COLOUR  = $d800
.const VERDICT = $02ff       // 1 green, 2 red
.const TIMES   = $0340       // bytes for the monitor, see below
.const SEED    = $0155       // any non-zero 10-bit state
.const HOLD    = 50          // frames the picture is shown before the fade
.const MID     = 80          // frame of the mid-dissolve count
.const VERDICT_FRAME = 200
.const N_PAL   = 60
.const N_NTSC  = 50
.const MID_MIN = 200         // intermediate-colour cells wanted at MID
.const PIC_A   = 1           // the picture's two colours
.const PIC_B   = 7
.label ptr     = $fb         // zero page: the cell under visit
#if AUTOPILOT
// The harness's frame meter prints on row 24, columns 20 to 39, in white
// colour RAM. Those twenty cells are left out of the dissolve and the
// counts in the autopilot build, so the picture there is 980 cells.
.const CELLS   = 980
#else
.const CELLS   = 1000
#endif

// TIMES + 0: LFSR period (word)        TIMES + 6: fade frames (byte)
// TIMES + 2: worst fade frame (word)   TIMES + 7: 1 once the verdict is stored
// TIMES + 4: last fade frame (word)    TIMES + 8: mid count, + 10: black count

BasicUpstart2(start)

// The sixteen VIC colours in rising luminance order (colour_fade's ranking)
// and, indexed by colour, the colour three places down it.
.var order = List().add(0, 6, 9, 2, 11, 8, 4, 14, 12, 5, 10, 3, 15, 13, 7, 1)
.var down = List()
.for (var c = 0; c < 16; c++) {
    .var at = 0
    .for (var i = 0; i < 16; i++) { .if (order.get(i) == c) { .eval at = i } }
    .if (at < 3) { .eval down.add(0) } else { .eval down.add(order.get(at - 3)) }
}
* = $3000
step3:  .fill 16, down.get(i)
.errorif (down.get(1) != 15 || down.get(7) != 3 || down.get(14) != 11 || down.get(2) != 0), "step table is not three places down the order"

* = $3100
// The picture: white and yellow blocks, 8 cells wide and 5 tall.
pic:    .fill 1000, (mod(floor(mod(i, 40) / 8) + floor(floor(i / 40) / 5), 2) == 0) ? PIC_A : PIC_B

vars:
ds_lo:  .byte 0              // LFSR state, low byte
ds_hi:  .byte 0              // LFSR state, bits 8 and 9
tcyc:   .word 0              // this frame's bracket, cycles
was_lit:.byte 0              // non-zero when the frame began with lit cells
vleft:  .byte 0              // visits left in this frame
ncell:  .byte 0              // visits a frame: N_PAL or N_NTSC
frame:  .byte 0
lit:    .word 0              // cells not yet black
cnt:    .word 0              // scratch for the cell counts
done:   .byte 0
vars_end:

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

// One step of the LFSR: shift right; when a one fell out, fold the taps
// (bits 9 and 6 of the ten-bit state) back in.
.macro LfsrStep() {
    lsr ds_hi
    ror ds_lo
    bcc !+
    lda ds_hi
    eor #$02
    sta ds_hi
    lda ds_lo
    eor #$40
    sta ds_lo
!:
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
    ldx #vars_end - vars - 1
!:  sta vars, x              // state, counters and flags all zero
    dex
    bpl !-
    ldx #0
!:  lda #160                 // reverse space: every pixel takes the cell colour
    sta SCREEN, x
    sta SCREEN + $100, x
    sta SCREEN + $200, x
    sta SCREEN + $300, x
    lda pic, x               // the picture into colour RAM, 1,000 cells
    sta COLOUR, x
    lda pic + $100, x
    sta COLOUR + $100, x
    lda pic + $200, x
    sta COLOUR + $200, x
    cpx #232                 // 1000 - 768: the fourth page stops at $DBE7
    bcs !+
    lda pic + $300, x
    sta COLOUR + $300, x
!:  inx
    bne !--

    jsr lfsr_period          // TIMES + 0 reads 1,023 when the register is maximal
    jsr count_lit            // lit = CELLS for this picture
    lda cnt
    sta lit
    lda cnt + 1
    sta lit + 1
    jsr pick_n               // ncell from the line count
    lda #<SEED
    sta ds_lo
    lda #>SEED
    sta ds_hi
#if AUTOPILOT
    FrameMeterInit()
#endif

main:
    jsr wait_frame
    lda frame
    cmp #HOLD
    bcc !hold+               // the picture stands for HOLD frames
#if AUTOPILOT
    WorkBegin()
    FrameMeterStart()
#endif
    TimerStart()
    jsr dissolve_frame
    TimerStop(tcyc)
#if AUTOPILOT
    FrameMeterStop()
    WorkEnd()
    jsr meter_colour
#endif
    jsr record_frame
!hold:
    jsr selfcheck
#if AUTOPILOT
    FrameMeterPrint()
#endif
    inc frame
    jmp main

// Wait for a fresh crossing of raster line 256 ($D011 bit 7 clear, then set).
wait_frame:
!:  bit $d011
    bmi !-
!:  bit $d011
    bpl !-
    rts

// Step the register from the seed until the seed recurs, counting steps.
lfsr_period:
    lda #<SEED
    sta ds_lo
    lda #>SEED
    sta ds_hi
    lda #0
    sta TIMES
    sta TIMES + 1
lp_step:
    LfsrStep()
    inc TIMES
    bne !+
    inc TIMES + 1
!:  lda ds_lo
    cmp #<SEED
    bne lp_step
    lda ds_hi
    cmp #>SEED
    bne lp_step
    rts

// PAL or NTSC from the highest raster line: after line 256 the low byte of
// $D012 climbs to 55 on PAL (312 lines) and to 5 or 6 on NTSC (262 or 263).
pick_n:
    jsr wait_frame           // bit 7 of $D011 has just set: line 256
    lda #0
    sta cnt
!:  lda $d012
    cmp cnt
    bcc !+
    sta cnt                  // the highest low byte seen while bit 7 is set
!:  bit $d011
    bmi !--
    lda #N_NTSC
    ldx cnt
    cpx #32
    bcc !+
    lda #N_PAL
!:  sta ncell
    rts

// Keep the worst and the last fade frame at TIMES + 2 and + 4, and the
// number of fade frames at TIMES + 6 once the last lit cell has gone.
record_frame:
    lda was_lit
    beq !out+                // the fade is over: not a fade frame
    lda tcyc
    sta TIMES + 4
    lda tcyc + 1
    sta TIMES + 5
    cmp TIMES + 3
    bcc !fade+
    bne !worse+
    lda tcyc
    cmp TIMES + 2
    bcc !fade+
!worse:
    lda tcyc
    sta TIMES + 2
    lda tcyc + 1
    sta TIMES + 3
!fade:
    lda lit
    ora lit + 1
    bne !out+
    lda frame                // the last lit cell went out this frame
    sec
    sbc #HOLD - 1
    sta TIMES + 6
!out:
    rts

// One fade frame: ncell visits in LFSR order, plus cell 0 whenever the
// state comes back to the seed.
dissolve_frame:
    lda lit
    ora lit + 1
    sta was_lit
    lda ncell
    sta vleft
!pull:
    LfsrStep()
    lda ds_hi
    cmp #$03
    bne !cell+
    lda ds_lo
    cmp #$e8                 // 1000 = $03E8: states 1000..1023 are not cells
    bcs !pull-
!cell:
    lda ds_lo
    sta ptr
    lda ds_hi
    ora #>COLOUR
    sta ptr + 1
    jsr visit
    lda ds_lo
    cmp #<SEED
    bne !next+
    lda ds_hi
    cmp #>SEED
    bne !next+
    lda #<COLOUR             // the seed recurred: visit cell 0 as well
    sta ptr
    lda #>COLOUR
    sta ptr + 1
    jsr visit
!next:
    dec vleft
    bne !pull-
    rts

// The cell at ptr: its colour goes three places down the order. When a
// lit cell reaches black, one fewer is lit.
visit:
#if AUTOPILOT
    lda ptr + 1              // the meter's twenty cells are not visited
    cmp #>(COLOUR + CELLS)
    bne !go+
    lda ptr
    cmp #<(COLOUR + CELLS)
    bcs !out+
!go:
#endif
    ldy #0
    lda (ptr), y
    and #$0f                 // the high nibble of a colour-RAM read is open bus
    beq !out+                // already black: nothing to do
    tax
#if FORCE_FAULT
    lda #0                   // control: straight to black, no luminance step
#else
    lda step3, x
#endif
    sta (ptr), y
    bne !out+
    lda lit                  // it went black now
    bne !+
    dec lit + 1
!:  dec lit
!out:
    rts

// At MID count the cells that are neither black nor a picture colour; at
// VERDICT_FRAME count the black cells and store the verdict once.
selfcheck:
    lda done
    beq !+
    rts
!:  lda frame
    cmp #MID
    bne !notmid+
    jsr count_mid
    lda cnt
    sta TIMES + 8
    lda cnt + 1
    sta TIMES + 9
!notmid:
    lda frame
    cmp #VERDICT_FRAME
    beq !+
    rts
!:  jsr count_black
    lda cnt
    sta TIMES + 10
    lda cnt + 1
    sta TIMES + 11
    lda TIMES                // period 1,023 = $03FF
    cmp #<1023
    bne !red+
    lda TIMES + 1
    cmp #>1023
    bne !red+
    lda TIMES + 10           // every cell black
    cmp #<CELLS
    bne !red+
    lda TIMES + 11
    cmp #>CELLS
    bne !red+
    lda TIMES + 9            // mid count at least MID_MIN (MID_MIN < 256, so
    bne !green+              // a non-zero high byte is enough)
    lda TIMES + 8
    cmp #MID_MIN
    bcc !red+
!green:
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
    lda #1
    sta done
    sta TIMES + 7
    rts

// Scan the CELLS cells of colour RAM; cnt = how many pass the test whose
// address is patched into sc_jsr. A test gets the nibble in A with the
// flags of the AND and returns carry set when the cell counts.
count_lit:
    lda #<test_lit
    ldx #>test_lit
    bne scan                 // always: the tests sit above $0900
count_black:
    lda #<test_black
    ldx #>test_black
    bne scan
count_mid:
    lda #<test_mid
    ldx #>test_mid
scan:
    sta sc_jsr + 1
    stx sc_jsr + 2
    lda #0
    sta cnt
    sta cnt + 1
    sta ptr
    lda #>COLOUR
    sta ptr + 1
!page:
    ldy #0
!cell:
    lda ptr + 1
    cmp #>(COLOUR + CELLS)
    bne !test+
    cpy #<(COLOUR + CELLS)   // the last page stops at the last cell
    beq !done+
!test:
    lda (ptr), y
    and #$0f
sc_jsr:
    jsr test_lit
    bcc !+
    inc cnt
    bne !+
    inc cnt + 1
!:  iny
    bne !cell-
    inc ptr + 1
    bne !page-               // always
!done:
    rts

test_lit:                    // carry set: not black
    cmp #1
    rts
test_black:                  // carry set: black
    cmp #1
    bcs !+
    sec
    rts
!:  clc
    rts
test_mid:                    // carry set: neither black nor a picture colour
    beq !no+
    cmp #PIC_A
    beq !no+
    cmp #PIC_B
    beq !no+
    sec
    rts
!no:
    clc
    rts
code_end:

#if AUTOPILOT
// The harness's frame meter sits on row 24, columns 20 to 39; its cells are
// not visited (see visit), and their colour is put back to white after each
// frame's work, outside the bracket, in case a build changes that.
meter_colour:
    ldx #19
    lda #1
!:  sta COLOUR + 24 * 40 + 20, x
    dex
    bpl !-
    rts
frame_meter:
    FrameMeterCode(SCREEN, 24, 20, 1, 150)
#endif

.print "code bytes: " + (code_end - start)
.print "table bytes: " + (vars_end - step3)
.print "step table: " + down
```

## Build

```bash
java -jar KickAss.jar luminance-dissolve.asm -o luminance-dissolve.prg
```

The control on this page is the same file with `-define FORCE_FAULT`. The
`#if AUTOPILOT` blocks are the harness's frame meter and exist so the
listing can be measured under it; a plain build carries none of them,
and a build with `-define AUTOPILOT` needs `-libdir` pointing at the
harness's `meter` directory for the import. That build also leaves the
meter's twenty cells on row 24 out of the dissolve and the counts, so
its picture is 980 cells.

## Expected output

Black border and background. For 50 frames, one second on PAL, the
checkerboard stands: white and yellow blocks, five columns of eight cells
by five rows of five. Then the blocks break up: white cells go light grey
and yellow cells cyan in scattered grains, then green and grey, purple
and orange, red and brown, and black. The whole screen is black after 84
frames on PAL and 100 on NTSC (the listing's own count of fade frames,
`TIMES + 6`, read by the monitor at the verdict), 1.7 s on both. At frame
200 the border turns green: the listing's own check passed.

Screenshots from the VICE runs this page describes, taken mid-dissolve:
`screenshots/luminance-dissolve.png` (PAL) and
`screenshots/luminance-dissolve-ntsc.png` (NTSC), both at cycle limit
4,500,000 with verify-recipes' flags. Two runs per model gave the same
file (md5 `7fc48dbb85c0816a7a1c4c3d4b56b2fe` PAL, 1,878 bytes;
`de1944613cfb8f69cece6a7218913130` NTSC, 1,829 bytes); the border is
black on both, the verdict being more than a hundred frames away.
Sampling the centre pixel of every cell against VICE's palette, the PAL
picture has 386 cyan, 107 green, 94 grey and 413 light grey cells and no
white or yellow; the NTSC picture 385 cyan, 108 green, 95 grey and 412
light grey. Every cell has been visited at least once (a sweep is 1,023
pulls, and 1,140 had been made on PAL, 1,150 on NTSC) and about a fifth
twice.

Both pictures are the listing's arithmetic at a known frame. A model of
the tables and the loop (`tools/sim.py` in the harness project, the same
expressions) reproduces the PAL picture exactly as the state after frame
69's visits, the twentieth fade frame counting frame 50 as the first. A
monitor trace on the frame counter's increments puts the increment to 71
at cycle 4,484,308: frame 70's visits were complete, and the exit at
4,500,000 fell about line 48 of the following raster frame, above the
display, so every row of the frame buffer is the previous field, which
shows frame 69's state (frame 70's visits ran in the blank after it was
drawn). The NTSC picture is frame 73's state in all but six cells: two
still hold frame 72's colour and four already hold frame 74's, because
on NTSC the visits run into the display (see "A frame's visits and the
beam" below) and a cell can be drawn before or after its own visit.

Control: the same listing built with `-define FORCE_FAULT`, run to the
same cycle limit. Every visit writes black, so a cell is black after its
first visit, and at 4,500,000 cycles all 1,000 cells are black on both
models (md5 `e7e70b082a4a6ec247e66bfa8e0c128a` PAL,
`96701dd08127fbe623fede6079c937e2` NTSC). At frame 80 the count of
intermediate-colour cells is zero against the 200 the check wants, so
the verdict is red at frame 200; the same control under the harness
fails its verdict check on both models (`shots/fault-check.txt`).

## Why this works

### Colour RAM is the picture

In standard text mode colour RAM sets the colour of a cell's set pixels
and `$D021` its clear pixels. The reverse space has every pixel set, so
with `$D021` black a cell shows its colour-RAM nibble and nothing else,
and a visit is one 4-bit read and one 4-bit write. `luminance_dissolve`
in `../../techniques/transitions.md` describes the technique;
`plasma.md` beside this page uses the same fill.

### The order and the step table

The assembler builds the step table from `colour_fade`'s luminance order
(`../../techniques/transitions.md`): for each colour, find its place in
the order and take the colour three places down, or black when it is
within three of the bottom. That gives 0 15 0 12 2 4 0 3 9 0 14 6 8 10
11 5, indexed by colour, and an `.errorif` holds four of its entries.
White (place 15) goes light grey, green, purple, red, black; yellow
(place 13) goes cyan, grey, orange, brown, black; every colour reaches
black in at most five visits and none gets brighter on the way. Three
places rather than one because sixteen visits a cell would take sixteen
sweeps, about 270 frames on PAL (arithmetic); five sweeps read as a fade.

### The register

The LFSR is `lfsr_random`'s ten-bit right-shifting form with taps `$240`
(bits 9 and 6), as `screen_dissolve_lfsr` uses it: shift right, and when
a one fell out XOR the taps back in. A maximal register visits each of
its 1,023 non-zero states once before repeating, so a sweep names every
cell from 1 to 999 exactly once and wastes 24 pulls on 1,000 to 1,023.
The listing does not take that on trust: at start-up it steps the
register from the seed until the seed recurs and stores the count at
`TIMES`, which read 1,023 on both models, and the verdict requires it.
Cell 0 is the state a shift register cannot produce, so it is visited
whenever the seed recurs, once a sweep, like any other cell.

### A frame's visits and the beam

Measured with CIA1 timer A (one-shot from `$FFFF`, `$DC0E = $19`, stopped
and read after each frame's visits, the bytes at `$0340` dumped by a
monitor trace on the verdict store at `$02FF`), with the screen on so
badline stealing is included, every frame started on a fresh crossing
of line 256:

| | PAL (N = 60) | NTSC (N = 50) |
|---|---|---|
| Worst fade frame | 7,490 | 6,544 |
| Last fade frame | 6,185 | 6,176 |
| Fade frames, from the hold to the last lit cell | 84 | 100 |
| Verdict store, cycles from power-on | 7,170,831 | 6,758,961 |

That is 125 cycles a visit in the worst PAL frame and 103 in the last,
131 and 124 on NTSC. Arithmetic from the listing gives a visit of a lit
cell about 96 cycles when the register step drops a zero and 115 when it
folds the taps in (step 15 or 34, skip test 9, pointer 16, call and
return 12, the visit 26, seed test 9, loop 9), before the skips and the
badlines; a visit that finds a black cell leaves after 12. The frames
differ because the 24 wasted pulls fall where the sequence puts them and
because more and more visits find black, so the last fade frames are the
cheapest. The harness's own frame meter (CIA2 timer A around the same
bracket, autopilot build, 150 frames from the hold) reads worst 8,133
and median 6,994 on PAL, worst 7,135 and median 6,098 on NTSC; the
autopilot build's visit carries the test that spares the meter's twenty
cells, about ten cycles a visit, which is most of the difference from
the CIA1 figures.

The visits start at line 256 and a worst PAL frame runs about 119 lines
(7,490 / 63), into line 63 of the next frame, so its last writes land
while rows 0 and 1 are drawn; on NTSC, whose frame wraps at 263, a worst
frame runs about 101 lines (6,544 / 65), into line 94, and the last
third of the visits race the beam over rows 0 to 5. A cell drawn before
its visit shows its old colour for one more frame, which is why the NTSC
pin is a mixture of three frames' states in six cells and the PAL pin a
single state. Nothing tears inside a cell: a visit is one write of one
nibble.

### The self-check

Three facts of real state, none of them a screenshot. The period,
counted at start-up, must be 1,023. At frame 80, the thirty-first fade
frame, the cells whose colour is neither black nor white nor yellow are
counted over colour RAM (the low nibble; the high nibble of a colour-RAM
read is open bus) and must number at least 200: they were 1,000 on both
models, every cell having been visited at least once by then (1,800
pulls on PAL and 1,500 on NTSC against a sweep of 1,023). At frame 200
the black cells are counted and must be all 1,000 (980 in the autopilot
build). Each count scans a thousand cells at about 37 cycles a cell,
longer than a frame, so the two frames that count run past the next
line-256 crossing and the frame counter falls two behind the raster from
frame 80 on; nothing after that depends on the counter but the verdict
frame. With every visit writing black the picture is black by frame 69,
the mid count is zero and the verdict is red whatever the end state
looks like: a check on the end state alone would pass the fault.

### Region

`region: both`. The mechanism is the same on NTSC; N is chosen from the
highest raster line (a low byte of 55 after the wrap on PAL, 5 or 6 on
NTSC, the threshold 32) so that the fade takes about the same time, 84
frames of 20 ms against 100 of 16.7 ms (arithmetic), and the NTSC frame
costs 6,544 at most against 7,490 because it makes ten fewer visits. On
NTSC the visits run into the display, so a pin is a mixture of frames as
described above.

## Pitfalls

`lfsr_zero_state_lockup` (`../../pitfalls/cpu.md`): the seed is `$0155`,
never zero, and cell 0 is visited by hand.
`colour_ram_index_past_last_cell_hits_cia1`
(`../../pitfalls/text-mode-render.md`): the skip of states 1,000 to
1,023 keeps every write inside colour RAM; this listing has CIA1's
interrupt mask cleared and its timer in use, so a stray store there
would change the figures. `badline_cycle_loss`
(`../../pitfalls/raster-and-badline.md`): the visits start in the blank
and only a worst frame reaches the first badlines, which is part of why
the worst and the last frame differ. And the fault this listing had
before it was measured, worth a line because it is common: the lit-cell
census was never copied into the counter, so the counter wrapped from
zero on the first black cell, the worst and last frames were recorded
and the fade's end never was; a monitor trace on the store of `TIMES +
6` found it, firing once at boot and never again.

## What it does not establish

Nothing here was run on hardware; VICE x64sc 3.10 is the instrument, and
nobody has watched the fade animate: the pins are one frame each and the
model says what the others hold. The costs are for this listing's shape,
an indirect read and write through a zero-page pointer at `$FB`, not a
floor: a self-modified absolute address, or an unrolled visit, was not
built or timed. The step of three places and the order are
`colour_fade`'s ranking, not measured on a display; a one-place step and
a dissolve towards a second palette are described in the technique and
not built. The two-colour picture makes the histograms easy to read;
with sixteen colours in the picture the mid count's floor of 200 would
need re-deriving. The two counting frames overrun the raster frame; a
listing that must keep its frame counter equal to the raster's would
spread each count over several frames.
