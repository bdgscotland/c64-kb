---
recipe: screen-wipe
toolchain: kickassembler
output_format: PRG
region: both
techniques: [screen_wipe]
file_formats: [PRG]
uses_registers: [D012, D020, D021, DC04, DC05, DC0D, DC0E]
uses_kernal: []
---

<!-- doc-type: recipe -->

# KickAssembler — Screen Wipe by Row

## Synopsis

A text screen of reverse spaces in a diagonal eight-colour pattern is wiped
out from the top, one row every second frame, by writing that row's colour
RAM to black, and then wiped back in row by row from the pattern, over and
over. Each row write is landed in the lower border by a busy-wait on $D012
and timed by CIA1 timer A; the last cost is printed on row 0 in hex with
the row and the direction. When the first wipe out reaches the bottom the
program grades itself: `$02FF` is `$01` with a green border if that
happened on frame 48, the frame two frames a row predicts, and no row
write went over 1,000 cycles, else `$02` with a red border. The wipe
carries on after the verdict, so the pinned screenshot shows a wipe part
way down under a green border. Use it as the out-transition of a part, or
change the step to a column, a diagonal or a table for another shape.

## Source

```asm
// screen-wipe.asm
// A text screen of reverse spaces in a diagonal eight-colour pattern is
// wiped out row by row from the top, one row every second frame, by
// writing that row's colour RAM to black, and then wiped back in row by
// row from a table, over and over. CIA1 timer A times each row write and
// the cost of the last one is printed on row 0 in hex, with the row and
// the direction. When the first wipe out reaches the bottom the program
// grades itself: $02FF is $01 with a green border if that happened on the
// frame the step rate predicts and no row write took more than BUDGET
// cycles, else $02 with a red border. The wipe carries on after the
// verdict, so a late screenshot shows a wipe in progress under the border.

.const SCREEN          = $0400
.const COLOUR          = $d800
.const SYNC_LINE       = 251         // first line of the lower border, both models
.const FRAMES_PER_ROW  = 2
.const FIRST_ROW       = 1           // rows 1 to 24 are wiped; row 0 is the caption
.const ROWS            = 24
.const EXPECT_FRAME    = ROWS * FRAMES_PER_ROW
.const BUDGET          = 1000        // cycles one row write may take
.const RESULT          = $02ff       // verdict byte read by a harness
.const COST_COL        = 18          // "$xxxx" on row 0
.const ROW_COL         = 29          // "nn"
.const DIR_COL         = 32          // "out" or "in "
.const dst             = $fb         // zero-page pointer: colour RAM row
.const src             = $fd         // zero-page pointer: pattern row

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
    sei                              // no KERNAL IRQ: a row write must not be interrupted
    lda #$7f
    sta $dc0d                        // no CIA1 interrupts: timer A is the stopwatch
    lda $dc0d
    lda #$00
    sta $d020
    sta $d021

    ldx #$00
    lda #$a0                         // reverse spaces everywhere: colour RAM is the picture
!:  sta SCREEN, x
    sta SCREEN + $100, x
    sta SCREEN + $200, x
    sta SCREEN + $300, x
    inx
    bne !-

    ldx #39                          // caption on row 0, white
!:  lda caption, x
    sta SCREEN, x
    lda #$01
    sta COLOUR, x
    dex
    bpl !-

    // Paint rows 1 to 24 from the pattern, so the first wipe has a picture to hide.
    lda #ROWS - 1
    sta row
!:  jsr paint_row
    dec row
    bpl !-
    lda #$00
    sta row

mainloop:
    lda #SYNC_LINE                   // first leave the sync line: a short pass
!:  cmp $d012                        // would otherwise fall through twice in it
    beq !-
!:  cmp $d012
    bne !-

    inc frame
    inc sub
    lda sub
    cmp #FRAMES_PER_ROW
    beq step
    jmp mainloop
step:
    lda #$00
    sta sub

    // One step: black out the current row, or paint it back, then advance.
    lda dir
    bne stepin
    t_start()
    jsr black_row
    t_stop(cost)
    jmp advance
stepin:
    t_start()
    jsr paint_row
    t_stop(cost)

advance:
    lda cost + 1                     // keep the largest cost seen
    cmp maxcost + 1
    bcc show
    bne newmax
    lda cost
    cmp maxcost
    bcc show
newmax:
    lda cost
    sta maxcost
    lda cost + 1
    sta maxcost + 1

show:
    lda cost + 1                     // "$xxxx": the last row write in hex
    jsr hex_hi
    sta SCREEN + COST_COL + 1
    lda cost + 1
    jsr hex_lo
    sta SCREEN + COST_COL + 2
    lda cost
    jsr hex_hi
    sta SCREEN + COST_COL + 3
    lda cost
    jsr hex_lo
    sta SCREEN + COST_COL + 4
    lda row                          // "nn": the row just written, 00 to 23
    asl
    tax
    lda rowtxt, x
    sta SCREEN + ROW_COL
    lda rowtxt + 1, x
    sta SCREEN + ROW_COL + 1
    ldx dir                          // "out" or "in "
    lda dirtxt, x
    sta SCREEN + DIR_COL
    lda dirtxt + 2, x
    sta SCREEN + DIR_COL + 1
    lda dirtxt + 4, x
    sta SCREEN + DIR_COL + 2

    inc row
    lda row
    cmp #ROWS
    bne back
    lda #$00                         // bottom reached: turn round
    sta row
    lda dir
    eor #$01
    sta dir
    bne verdict                      // the first wipe out has just finished
back:
    jmp mainloop

verdict:
    lda done
    bne back
    inc done
    lda frame                        // the last row went on frame EXPECT_FRAME
    cmp #EXPECT_FRAME
    bne fail
    lda maxcost + 1                  // and no row write went over budget
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
    jmp mainloop
fail:
    lda #$02
    sta RESULT
    lda #$02
    sta $d020
    jmp mainloop

// dst = COLOUR + (FIRST_ROW + row) * 40, from a table of row addresses.
set_dst:
    ldx row
    lda rowlo, x
    sta dst
    lda rowhi, x
    sta dst + 1
    rts

// Write the current row's forty colour cells to black.
black_row:
    jsr set_dst
    lda #$00
    ldy #39
!:  sta (dst), y
    dey
    bpl !-
    rts

// Write the current row's forty colour cells from the pattern: cell x of
// row r is pattern[(r + x) & 7], read from a table long enough that no
// masking is needed.
paint_row:
    jsr set_dst
    lda row
    and #$07
    clc
    adc #<pattern
    sta src
    lda #>pattern
    adc #$00
    sta src + 1
    ldy #39
!:  lda (src), y
    sta (dst), y
    dey
    bpl !-
    rts

hex_hi:                              // A = byte -> screen code of its high nibble
    lsr
    lsr
    lsr
    lsr
hex_lo:                              // A = byte -> screen code of its low nibble
    and #$0f
    cmp #$0a
    bcc !+
    sbc #$09                         // 10..15 -> screen codes 1..6, "A".."F"
    rts
!:  ora #$30                         // 0..9 -> "0".."9"
    rts

// Eight colours for the diagonal, repeated to cover 7 + 40 cells:
// blue, light blue, cyan, white, yellow, orange, red, purple.
pattern:
.for (var i = 0; i < 48; i++) .byte List().add(6, 14, 3, 1, 7, 8, 2, 4).get(i & 7)

rowlo: .fill ROWS, <(COLOUR + (FIRST_ROW + i) * 40)
rowhi: .fill ROWS, >(COLOUR + (FIRST_ROW + i) * 40)

caption: .text "screen wipe  cost $0000  row 00 out     "
rowtxt:  .text "000102030405060708091011121314151617181920212223"
dirtxt:  .text "oiunt "                  // "out" and "in " interleaved: o,i,u,n,t,space

frame:   .byte 0
sub:     .byte 0
row:     .byte 0
dir:     .byte 0                     // 0 = wiping out, 1 = wiping in
done:    .byte 0
cost:    .word 0
maxcost: .word 0
```

## Build

```bash
java -jar KickAss.jar screen-wipe.asm -o screen-wipe.prg
```

`-showmem` reports one block at $0900-$0B90: code, then the 48-byte
pattern, the two 24-byte row-address tables, the caption strings and the
counters. The PRG is 914 bytes.

## Expected output

Black screen with the caption `SCREEN WIPE  COST $xxxx  ROW nn OUT` or
`... IN` in white on row 0. Rows 1 to 24 start in the pattern: cell
`(row, col)` shows `pattern[(row - 1 + col) & 7]` where the pattern is
blue, light blue, cyan, white, yellow, orange, red, purple, so the colours
run in diagonals down and to the left. Every second frame one more row
goes black from the top; after 24 steps the direction turns and one more
row a step comes back, then out again. A full wipe out is 48 frames,
0.96 s on PAL and 0.8 s on NTSC (arithmetic from 19,656 and 17,095 cycles
a frame). The cost readout is the cycles CIA1 timer A counted for the last
row write: `$01EB`, 491, for a row going black on both models, and `$02C4`,
708, or `$02C5`, 709, for a row coming back, depending on the row: 708 at
row 3 and 709 at row 11, both measured on PAL, and the same 709 at row 11
on NTSC. The reveal cost varies with the row and not with the model; why
one row costs a cycle more than another is not established. The border is
black until the first wipe out completes and green from then on.

The pinned run is 5,300,000 cycles on both models, in the second wipe out.
PAL shows `ROW 09 OUT`: rows 1 to 10 black, rows 11 to 24 in the pattern.
NTSC shows `ROW 15 OUT`: rows 1 to 16 black, rows 17 to 24 in the pattern.
Both borders are green and both costs read `$01EB`. Measured: every pixel
of the 24 rows below the caption is the colour the row count and the
pattern formula give its cell, no mismatches in 61,440 pixels on either
model, and the caption decodes cell by cell against the char ROM. The
verdict store is at cycle 3,928,226 on PAL and 3,914,844 on NTSC in the
`-moncommands` trace (route 2 of `runtime/vice-reference.md`, "Verifying a
run without a human"), 48 frames after a first frame near 2,985,000 and
3,094,000 cycles.

Why that count. A shot lands in a partly drawn frame, and a step frame with
the beam inside the row just written would show that row half black. A row
is eight lines of 312 or 263 and only every second frame writes one, so the
chance is small; the shots at 5,500,000 and 5,300,000 were both clean on
both models and the lower count is pinned because it leaves the NTSC wipe
further from its end.

An earlier draft of this listing waited for line 251 with a single compare
loop. On a frame with no step the work after the wait is under a raster
line, so the loop fell straight through a second time in the same line and
the frame counter went up by two: the wipe ran a row a frame and the
verdict, which counts frames, was taken early. That draft passed its own
verdict, because the frame counter and the step counter both ran fast
together; what gave it away was that the shots did not agree with the
arithmetic on where the wipe should be. The listing now waits to leave
line 251 before waiting to reach it.

Verified: assembled with KickAssembler 5.25, run in VICE x64sc 3.10 with
the pinned command twice on each model with byte-identical PNGs, the
verdict read from a `-moncommands` trace, and the PNGs checked cell by
cell against the pattern formula.

Screenshots from the VICE runs this page describes:
`screenshots/screen-wipe.png` (PAL) and `screenshots/screen-wipe-ntsc.png`
(NTSC).

## Why this works

### Hiding a row

A cell whose colour RAM nibble equals `$D021` draws nothing visible
whatever character it holds, so the wipe never touches screen RAM. Going
out, `black_row` writes forty zeros through a zero-page pointer taken from
a table of the 24 row addresses: `STA (dst),Y`, `DEY`, `BPL` is eleven
cycles a cell and the CIA reads 491 for the row. Coming back, `paint_row`
reads each cell's colour from the pattern through a second pointer set to
`pattern + (row & 7)`, so cell `col` gets `pattern[(row + col) & 7]`
without a mask; the extra indirect load makes it 708 or 709. The pattern
is written six times over so the highest index, 7 + 39, stays inside it.
Both figures are under a dozen raster lines and the write starts on line
251, so it is over long before the top of the next frame.

### The stopwatch and the verdict

CIA1 timer A is loaded with $FFFF and started on the phi2 clock around each
row write; $FFFF less the count is the cost, and the largest is kept. CIA1
interrupts are masked first so the timer is only a counter. The verdict is
taken once, when the direction first turns: the frame counter must read
48, which is 24 rows at two frames each, and the largest cost must be
under 1,000. A frame counter that runs fast fails the first unless the
step counter runs fast with it, which is what the earlier draft did; the
shots, not the verdict, found that fault, and it is why the expected
output above gives the row each model shows at the pinned count.

### Timing

Interrupts are off and the frame is paced by a busy-wait on line 251, the
first line of the lower border on both models. The wait is two loops, leave
the line and then reach it, because the work between waits on a frame with
no step is shorter than a line. The KERNAL IRQ is left off so no interrupt
can land inside a row write. Step timing is in frames, so PAL and NTSC are
at different rows for the same cycle count, and the verdict is on the frame
count so that it holds on both.
