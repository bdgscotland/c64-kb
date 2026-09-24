---
recipe: screen-dissolve
toolchain: kickassembler
output_format: PRG
region: both
techniques: [screen_dissolve_lfsr]
file_formats: [PRG]
uses_registers: [D012, D020, D021, DC04, DC05, DC0D, DC0E]
uses_kernal: []
claims: [cia1_timer_b (init), cia1_tod (init), zero_page $F3-$FE (owns)]
harness: [cia1_timer_a, $02FF]
ram: [colour=$D800-$DBE7]
---

<!-- doc-type: recipe -->

# KickAssembler: Screen Dissolve by LFSR

## Synopsis

Two text screens are built at start-up: screen A, a light blue checker of
two glyphs captioned `SCREEN A`, on the visible screen, and screen B, yellow
diagonal stripes captioned `SCREEN B`, in RAM. Each frame a 10-bit Galois
LFSR pulls 20 cell indices and each cell is copied from B to the visible
screen, screen byte and colour byte, so B appears through A in a random
order over 50 frames: a dissolve, with no palette work. Indices 1000 to
1023 are pulled again, cell 0 is copied by hand at the end, and CIA1 timer
A times every frame. When cell 0 lands the program grades itself: `$02FF`
is `$01` with a green border if that was frame 50 and no frame took more
than 4,000 cycles, else `$02` with a red border. The picture is static from
then on, which is what the pin shows. Build with `-define SEQ` for the
control that copies the cells in order at the same rate, which is a wipe,
and with `-define STOP25` to freeze either after frame 25 for a mid-way
picture.

## Source

```asm
// screen-dissolve.asm
// Two text screens are built at start-up. Screen A, a checker of two glyphs
// in light blue with the caption "SCREEN A", is the visible screen at $0400.
// Screen B, diagonal stripes in yellow with the caption "SCREEN B", is kept
// in RAM at $2800 (screen bytes) and $2C00 (colour bytes). Each frame, from
// the first line of the lower border, a 10-bit Galois LFSR (taps $240, the
// polynomial x^10 + x^7 + 1) produces 20 cell indices and each cell is copied
// from B to the visible screen, screen byte and colour byte. Indices 1000 to
// 1023 are skipped, and cell 0, which an LFSR never produces, is copied by
// hand once the register has come back to its seed. CIA1 timer A times each
// frame's copy; the cost of every frame is logged as a word at COSTLOG and
// the largest is kept. When cell 0 lands the program grades itself: $02FF is
// $01 with a green border if that happened on frame EXPECT_FRAME and no frame
// cost more than BUDGET cycles, else $02 with a red border. The picture is
// static from then on.
// Build variants: -define SEQ gives the control that copies cells 0, 1, 2 ..
// 999 in order at the same rate, which is a wipe and not a dissolve;
// -define STOP25 freezes the picture after frame 25 for a mid-way screenshot.

.const SCREEN          = $0400
.const COLOUR          = $d800
.const SCREEN_B        = $2800       // screen B, screen bytes, 1000 used
.const COLOUR_B        = $2c00       // screen B, colour bytes, 1000 used
.const COSTLOG         = $3000       // word per frame, indexed by frame * 2
.const SYNC_LINE       = 251         // first line of the lower border, both models
.const CELLS_PER_FRAME = 20
.const CELLS           = 1000
.const SEED            = 1           // any value 1 to 1023; 1 is a valid cell
.const TAP_LO          = $40         // $240: x^10 + x^7 + 1, bits 9 and 6
.const TAP_HI          = $02
.const EXPECT_FRAME    = 50          // 1000 cells at 20 a frame
.const BUDGET          = 4000        // cycles one frame's copies may take
.const RESULT          = $02ff       // verdict byte read by a harness
.const GLYPH_A0        = $66         // hatched square
.const GLYPH_A1        = $e6         // the same, reversed
.const GLYPH_B0        = $a0         // reverse space: a solid block
.const GLYPH_B1        = $2e         // full stop
.const COLOUR_A        = 14          // light blue
.const COLOUR_B_INK    = 7           // yellow
.const CAPTION_ROW     = 12
.const CAPTION_COL     = 16

#if STOP25
.const STOP_FRAME      = 25          // freeze after frame 25
#else
.const STOP_FRAME      = 0           // never freeze
#endif

// Variables at a fixed address so a monitor dump can name them.
.const VARS    = $0c00
.const frame   = VARS + 0            // frames since start, 8 bits
.const done    = VARS + 1            // 1 once cell 0 has landed
.const wrapped = VARS + 2            // 1 once the LFSR has come back to SEED
.const slots   = VARS + 3            // cells left in this frame
.const idx     = VARS + 4            // cell index, low then high
.const cost    = VARS + 6            // last frame's cycles
.const maxcost = VARS + 8            // largest frame cost
.const donef   = VARS + 10           // the frame cell 0 landed on

// Zero-page pointers, low bytes always 0, indexed by Y = low byte of idx.
.const srcs = $fb                    // screen B, screen byte
.const srcc = $fd                    // screen B, colour byte
.const dsts = $f7                    // visible screen
.const dstc = $f9                    // colour RAM
.const row_a = $f3                   // build pointers
.const row_b = $f5

BasicUpstart2(start)

// CIA1 timer A as a stopwatch, phi2 clock, counting down from $FFFF.
.macro t_start() {
    lda #$00
    sta $dc0e
    lda #$ff
    sta $dc04
    sta $dc05
    lda #$11                         // force load, start, count phi2
    sta $dc0e
}
.macro t_stop(addr) {
    lda #$00
    sta $dc0e
    sec
    lda #$ff
    sbc $dc04
    sta addr
    lda #$ff
    sbc $dc05
    sta addr + 1
}

* = $0900
start:
    sei                              // no KERNAL IRQ: a copy must not be interrupted
    lda #$7f
    sta $dc0d                        // no CIA1 interrupts: timer A is the stopwatch
    lda $dc0d
    lda #$00
    sta $d020
    sta $d021

    ldx #$0f                         // clear the variables
!:  sta VARS, x
    dex
    bpl !-
    sta srcs
    sta srcc
    sta dsts
    sta dstc
    lda #<SEED
    sta idx
    lda #>SEED
    sta idx + 1

    jsr build_screens

#if SEQ
    lda #$00                         // the control starts at cell 0
    sta idx
    sta idx + 1
#endif

mainloop:
    lda #SYNC_LINE                   // leave the sync line, then reach it again
!:  cmp $d012
    beq !-
!:  cmp $d012
    bne !-

    lda done
    bne mainloop                     // static: nothing more to do
    .if (STOP_FRAME != 0) {
        lda frame
        cmp #STOP_FRAME
        bcs mainloop                 // frozen after frame STOP for the mid-way picture
    }
    inc frame

    t_start()
    ldx #CELLS_PER_FRAME
slot:
    stx slots
#if SEQ
    jsr copy_cell                    // the control: cell idx, then idx + 1
    inc idx
    bne !+
    inc idx + 1
!:  lda idx + 1
    cmp #>CELLS
    bne next
    lda idx
    cmp #<CELLS
    bne next
    inc done                         // cell 999 was the last
    jmp endframe
#else
    lda wrapped
    bne lastcell
pull:
    jsr lfsr_step                    // next state of the register
    lda idx + 1
    cmp #>CELLS                      // 1000 to 1023 are not cells: pull again
    bne valid
    lda idx
    cmp #<CELLS
    bcs pull
valid:
    lda idx                          // back at the seed: every state has been seen
    cmp #<SEED
    bne !+
    lda idx + 1
    cmp #>SEED
    bne !+
    inc wrapped
!:  jsr copy_cell
    jmp next
lastcell:
    lda #$00                         // cell 0, which the register never produces
    sta idx
    sta idx + 1
    jsr copy_cell
    inc done
    jmp endframe
#endif
next:
    ldx slots
    dex
    bne slot

endframe:
    t_stop(cost)
    lda frame                        // log this frame's cost
    asl
    tax
    lda cost
    sta COSTLOG, x
    lda cost + 1
    sta COSTLOG + 1, x
    lda cost + 1                     // keep the largest cost seen
    cmp maxcost + 1
    bcc after
    bne newmax
    lda cost
    cmp maxcost
    bcc after
newmax:
    lda cost
    sta maxcost
    lda cost + 1
    sta maxcost + 1
after:
    lda done
    beq back
    lda frame                        // the last cell has landed: grade the run
    sta donef
    cmp #EXPECT_FRAME
    bne fail
    lda maxcost + 1
    cmp #>BUDGET
    bcc pass
    bne fail
    lda maxcost
    cmp #<BUDGET
    bcs fail
pass:
    lda #$01
    sta RESULT
    lda #$05
    sta $d020
back:
    jmp mainloop
fail:
    lda #$02
    sta RESULT
    lda #$02
    sta $d020
    jmp mainloop

// One step of the 10-bit Galois LFSR held in idx: shift right, and if the
// bit that fell out was 1 XOR the taps in. From SEED the states 1 to 1023
// each come once before SEED comes round again; 0 never comes.
lfsr_step:
    lsr idx + 1
    ror idx
    bcc !+
    lda idx + 1
    eor #TAP_HI
    sta idx + 1
    lda idx
    eor #TAP_LO
    sta idx
!:  rts

// Copy cell idx (0 to 999) from screen B to the visible screen: screen byte
// and colour byte. The four pointers keep a zero low byte; their high bytes
// are the buffer's page plus the index's high byte, and Y is the low byte.
// No sum carries, so one CLC serves all four.
copy_cell:
    ldy idx
    lda idx + 1
    clc
    adc #>SCREEN_B
    sta srcs + 1
    adc #>(COLOUR_B - SCREEN_B)
    sta srcc + 1
    lda idx + 1
    adc #>SCREEN
    sta dsts + 1
    lda idx + 1
    adc #>COLOUR
    sta dstc + 1
    lda (srcs), y
    sta (dsts), y
    lda (srcc), y
    sta (dstc), y
    rts

// Build both screens. Cell (row, col) of A is GLYPH_A0 when row + col is
// even and GLYPH_A1 when odd, all light blue. Cell (row, col) of B is
// GLYPH_B0 when row + col is a multiple of four and GLYPH_B1 otherwise, all
// yellow. Then each gets its caption on row CAPTION_ROW.
build_screens:
    lda #<SCREEN
    sta row_a
    lda #>SCREEN
    sta row_a + 1
    lda #<SCREEN_B
    sta row_b
    lda #>SCREEN_B
    sta row_b + 1
    ldx #$00                         // row
rowloop:
    ldy #$00                         // col
colloop:
    tya
    stx slots                        // slots is free until the first frame
    clc
    adc slots                        // A = row + col
    lsr
    lda #GLYPH_A0
    bcc !+
    lda #GLYPH_A1
!:  sta (row_a), y
    tya
    clc
    adc slots
    and #$03
    beq stripe
    lda #GLYPH_B1
    bne !+
stripe:
    lda #GLYPH_B0
!:  sta (row_b), y
    iny
    cpy #40
    bne colloop
    lda row_a
    clc
    adc #40
    sta row_a
    bcc !+
    inc row_a + 1
!:  lda row_b
    clc
    adc #40
    sta row_b
    bcc !+
    inc row_b + 1
!:  inx
    cpx #25
    bne rowloop

    ldx #$00                         // colour: A light blue, B yellow, 1,024 each
!:  lda #COLOUR_A
    sta COLOUR, x
    sta COLOUR + $100, x
    sta COLOUR + $200, x
    sta COLOUR + $300 - 24, x        // the last page stops at cell 999
    lda #COLOUR_B_INK
    sta COLOUR_B, x
    sta COLOUR_B + $100, x
    sta COLOUR_B + $200, x
    sta COLOUR_B + $300, x
    inx
    bne !-

    ldx #7                           // captions
!:  lda caption_a, x
    sta SCREEN + CAPTION_ROW * 40 + CAPTION_COL, x
    lda caption_b, x
    sta SCREEN_B + CAPTION_ROW * 40 + CAPTION_COL, x
    dex
    bpl !-
    rts

caption_a: .text "screen a"
caption_b: .text "screen b"
```

## Build

```bash
java -jar KickAss.jar screen-dissolve.asm -o screen-dissolve.prg
java -jar KickAss.jar screen-dissolve.asm -define STOP25 -o screen-dissolve-stop25.prg
java -jar KickAss.jar screen-dissolve.asm -define SEQ -o screen-dissolve-seq.prg
java -jar KickAss.jar screen-dissolve.asm -define SEQ -define STOP25 -o screen-dissolve-seq-stop25.prg
```

`-showmem` reports one block at $0900-$0AF2 for the first build: 499
bytes, of which 16 are the two captions and the rest code. The PRG is 756
bytes. Screen B's 2,048 bytes at $2800 and the 128-byte cost log at $3000
are written at run time and are not in the file. A note on the variants:
KickAssembler 5.25 takes `-define NAME` as a preprocessor symbol only; an
earlier draft used `-define STOP=25` and read `STOP` as a value, and the
assembler accepted it while `#if !STOP` stayed true, so the build never
froze. The freeze frame is a constant behind a plain symbol for that
reason.

## Expected output

Black border and background. Screen A is a checker of the hatched glyph
`$66` and its reverse `$E6`, cell `(row, col)` holding `$66` when
`row + col` is even, all light blue, with `SCREEN A` on row 12 from column
16. Screen B has the solid block `$A0` where `row + col` is a multiple of
four and a full stop `$2E` elsewhere, all yellow, with `SCREEN B` in the
same place. From the first frame after start, 20 cells a frame go from A
to B in the LFSR's order, scattered over the whole screen; on frame 50 the
last of them, cell 0 at the top left, lands and the border goes green.
The dissolve takes 50 frames, 1.0 s on PAL and 0.83 s on NTSC (arithmetic
from 19,656 and 17,095 cycles a frame).

The pinned run is 5,000,000 cycles on both models. The picture is static
by then: the verdict store `STA $02FF` is at cycle 4,028,615 on PAL and
4,002,432 on NTSC in the `-moncommands` trace (route 2 of
`runtime/vice-reference.md`, "Verifying a run without a human"), so the
beam position at the limit does not matter and the shot is a complete
screen B under a green border on both models. Measured with PIL over the
1,000 cells of each pinned PNG, a cell counted as yellow if any of its 64
pixels is the model's yellow and light blue likewise: 999 yellow, 0 light
blue, 1 neither, on both models; the one is the space in `SCREEN B`.
`$0C0A` (the frame cell 0 landed on) reads `$32`, 50, and `$0C08` (the
largest frame cost) reads `$0C83`, 3,203, on both models.

The per-frame cost, CIA1 timer A around the 20 copies including every
LFSR pull and skip, logged as a word per frame at `$3000`: worst 3,203
cycles on frame 12, least 2,846 on frame 50 (its twentieth slot is the
hand-copied cell 0, with no pull), median 3,032, mode 2,978, mean 3,034.
The fifty figures are identical on PAL and NTSC, which is expected: the
work starts on line 251 in the lower border on both, there is no badline
there, and nothing in it depends on the model. The sequential control
(`-define SEQ`) also lands its last cell on frame 50 and its largest frame
costs 2,226, the difference being the LFSR pulls and the two compares.

Mid-way, from the `STOP25` builds at the same 5,000,000 cycles (both are
frozen after frame 25 and so static): the dissolve shows 499 yellow, 500
light blue and 1 neither, which is 500 cells of B landed in 25 frames at 20
a frame, the odd one being the caption space; the sequential control at
the same frame shows 500 yellow, 499 light blue and 1 neither, cells 0 to
499, which is rows 0 to 11 and half of row 12: a straight front, not a
dissolve. Both are PAL pictures under `docs/figures/`:

- `figures/screen-dissolve-mid-frame25.png`: the dissolve after frame 25.
- `figures/screen-dissolve-wipe-frame25.png`: the sequential control after
  frame 25.

Verified: assembled with KickAssembler 5.25, run in VICE x64sc 3.10 with
the pinned command twice on each model with byte-identical PNGs, the
verdict, the frame and the cost log read from a `-moncommands` trace, and
the PNGs counted cell by cell with PIL.

Screenshots from the VICE runs this page describes:
`screenshots/screen-dissolve.png` (PAL) and
`screenshots/screen-dissolve-ntsc.png` (NTSC).

## Why this works

### The order

A maximal-length LFSR is a permutation of its non-zero states: from any
seed it visits every value from 1 to 2^n - 1 exactly once before coming
back to the seed. The register here is ten bits with taps `$240`, the
polynomial x^10 + x^7 + 1, in the right-shifting Galois form
`lfsr_random` in `techniques/maths.md` uses for its 8- and 16-bit
registers; the bit that falls out of `ROR idx` decides whether the taps
are XORed in. That it is maximal was checked by stepping it 1,023 times in
Python before the listing was written (1,023 distinct values, least 1,
greatest 1,023, back at the seed), and the run confirms it: the register
comes back to the seed on the 1,023rd pull, by which time 999 cells have
been copied, and the verdict counts frames from that.

Ten bits and not sixteen because the screen has 1,000 cells and 2^10 is
the first power of two above it. A 16-bit register would produce 65,535
values of which only 1,000 are cells, so on average sixty-four pulls
would go to waste for every cell copied. Ten bits wastes 24 pulls in
1,023, and they fall wherever the sequence puts them: the frame that
meets most of them is the worst frame, and at 3,203 against a median of
3,032 the spread is small.

### The two cells the register cannot give

An LFSR never produces zero; from zero it would stay there, which is the
pitfall `lfsr_zero_state_lockup` in `pitfalls/cpu.md`. So cell 0 is not in
the permutation and is copied by hand as the last slot of the frame after
the register returns to its seed. It is also why the seed must not be
zero; here it is 1, which is itself a cell, and its cell is copied on the
return pull, not the first. At the other end, states 1000 to 1023 are not
cells. They sit inside the 1,024-byte page but past the last cell: on the
screen side `$07E8` to `$07FF`, whose last eight bytes are the sprite
pointers, and on the colour side the 24 bytes `$DBE8` to `$DBFF`, which is
the bound `colour_ram_index_past_last_cell_hits_cia1` in
`pitfalls/text-mode-render.md` describes, the one past which an index
reaches `$DC00` and CIA1. The skip is a 16-bit compare against 1,000
before the copy, and a state that fails it costs one more pull.

### The copy

Four zero-page pointers keep a zero low byte; their high bytes are the
buffer's page plus the index's high byte and Y is the index's low byte,
so `LDA (srcs),Y` reads B's screen byte and the same Y reaches all four
buffers. None of the four sums carries, since the high byte of an index
below 1,000 is at most 3, so one `CLC` serves all four. With the pull,
the two compares and the loop that is about 150 cycles a cell, 3,000 a
frame at N = 20 (the measured figures above), and the copies start on
line 251 so they are over about 50 lines later: line 302 on PAL, and on
NTSC, whose frame wraps at 263, about line 37 of the next frame, still
in the upper border above the display's line 51 on both. The blank they
have to fit is about 7,000 cycles on PAL and about 4,100 on NTSC
(arithmetic), which is why the technique entry's scaling limit differs
by model. The frame is paced by the two-loop wait on line 251 that the screen-wipe recipe describes: leave the line, then reach it.

### The stopwatch and the verdict

CIA1 timer A is loaded with $FFFF and started on the phi2 clock before
the first slot and stopped after the last; $FFFF less the count is the
cost, logged at `$3000 + 2 * frame` and kept if largest. CIA1 interrupts
are masked so the timer is only a counter. The verdict is taken once,
when cell 0 has landed: the frame must be 50, which is 1,000 cells at 20
a frame, and the largest cost must be under 4,000.

## What it does not establish

Nothing here was run on hardware; VICE x64sc 3.10 is the instrument. The
costs are for this listing's shape, one subroutine call and four pointer
writes a cell; an unrolled copy or a self-modified absolute address would
be cheaper and was not built. A bitmap dissolve by byte, a dissolve of
colour RAM alone and a 2 by 2 block dissolve are variations on the
technique page and were not built or timed. Whether the dissolve reads as
smooth to a viewer, and at what N it stops reading as a fade and starts
reading as a scatter, is a perceptual question this page does not answer.
