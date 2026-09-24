---
recipe: colour-fade
toolchain: kickassembler
output_format: PRG
region: both
techniques: [colour_fade]
file_formats: [PRG]
uses_registers: [D012, D020, D021]
uses_kernal: []
---

<!-- doc-type: recipe -->

# KickAssembler — Colour Fade to Black

## Synopsis

Sixteen raster bars, ten lines each, one per VIC colour, faded to black over
sixteen steps and then held. The fade is a 272-byte table built at assembly
time: row `s` maps each colour to the colour `s` sixteenths of the way down
a luminance order, so the picture dims without a redraw. The step number is
printed on screen row 0 in white and does not fade, so a screenshot of the
held frame still says which step it shows. The bars are drawn by busy-wait
on $D012 with interrupts off; the recipe is about the table, and the bars
are only the thing it fades. Use it as the out-transition between two parts
of a demo, or as a template for fading colour RAM or sprite colours.

## Source

```asm
// colour-fade.asm
// Sixteen raster bars, ten lines each, faded to black over sixteen steps
// through a luminance-ordered colour table, then held. The current step is
// printed on screen row 0 in white; the caption's colour RAM is set once
// and does not fade, so the held frame still says which step it is.

.const FRAMES_PER_STEP = 4
.const NUM_STEPS = 16
.const NUM_BARS  = 16
.const BAR_H     = 10
.const BAR_TOP   = 66        // row 2 starts here; no bar starts on line & 7 == 3
.const BAR_END   = BAR_TOP + NUM_BARS * BAR_H
.const SYNC_LINE = 250       // below the bars on both PAL (312) and NTSC (263)
.const ROW       = $fb       // zero-page pointer to the current fade row

// The sixteen colours from darkest to brightest, ordered by
// Y = 0.299 R + 0.587 G + 0.114 B over VICE's PAL palette triples.
.var order = List().add(0, 6, 9, 2, 11, 8, 4, 14, 12, 5, 10, 3, 15, 13, 7, 1)
.var pos = List()
.for (var i = 0; i < 16; i++) .eval pos.add(0)
.for (var i = 0; i < 16; i++) .eval pos.set(order.get(i), i)

BasicUpstart2(start)

* = $0a00                    // page-aligned: the row pointer's low byte is step * 16
// fade[step * 16 + colour]: the colour to show for `colour` at `step`.
// Step 0 is the colour itself; step 16 is black for every entry; each
// column walks down the luminance order and never goes back up.
fade:
.for (var s = 0; s <= NUM_STEPS; s++) {
    .for (var c = 0; c < 16; c++) {
        .byte order.get(floor((pos.get(c) * (NUM_STEPS - s) + 8) / 16))
    }
}

// Bar i shows order[15 - i] at step 0: white at the top, black at the bottom.
base:
.for (var i = 0; i < NUM_BARS; i++) .byte order.get(15 - i)
// First raster line of each bar.
barline:
.for (var i = 0; i < NUM_BARS; i++) .byte BAR_TOP + i * BAR_H

barcol:  .fill NUM_BARS, 0   // this frame's faded bar colours
steptxt: .text "0001020304050607080910111213141516"
label:   .text "fade step"

frame: .byte 0
step:  .byte 0

* = $0900
start:
    sei                      // no KERNAL IRQ: nothing may delay a colour write
    lda #$00
    sta $d020
    sta $d021
    ldx #$00
    lda #$20
!:  sta $0400, x             // clear the screen
    sta $0500, x
    sta $0600, x
    sta $0700, x
    inx
    bne !-
    ldx #$08
!:  lda label, x             // "fade step" at row 0, column 0
    sta $0400, x
    dex
    bpl !-
    lda #$01                 // caption colour RAM: white, set once, never faded
    ldx #39
!:  sta $d800, x
    dex
    bpl !-

mainloop:
    lda #SYNC_LINE
!:  cmp $d012
    bne !-

    // Advance the frame counter; every FRAMES_PER_STEP frames advance the
    // step, up to and including NUM_STEPS, then hold.
    inc frame
    lda frame
    cmp #FRAMES_PER_STEP
    bne apply
    lda #$00
    sta frame
    lda step
    cmp #NUM_STEPS
    beq apply
    inc step

apply:
    // ROW = fade + step * 16. Step 16 shifts a 1 out into the carry, so
    // the carry is kept and added to the high byte; a CLC here would send
    // the last step back to row 0 and the fade would snap to full colour.
    lda #>fade
    sta ROW + 1
    lda step
    asl
    asl
    asl
    asl
    sta ROW
    bcc !+
    inc ROW + 1
!:

    // Bar colours through the table.
    ldx #NUM_BARS - 1
!:  ldy base, x
    lda (ROW), y
    sta barcol, x
    dex
    bpl !-

    // Step digits at row 0, columns 10 and 11.
    lda step
    asl
    tax
    lda steptxt, x
    sta $0400 + 10
    lda steptxt + 1, x
    sta $0400 + 11

    // Draw the bars: wait for each bar's first line, write both colours.
    ldx #$00
bars:
    lda barline, x
!:  cmp $d012
    bne !-
    lda barcol, x
    sta $d020
    sta $d021
    inx
    cpx #NUM_BARS
    bne bars

    lda #BAR_END
!:  cmp $d012
    bne !-
    lda #$00
    sta $d020
    sta $d021
    jmp mainloop
```

## Build

```bash
java -jar KickAss.jar colour-fade.asm -o colour-fade.prg
```

`-showmem` reports the code at $0900-$09A9 and the tables at $0A00-$0B6C;
the fade table is the first 272 bytes of the second block.

## Expected output

Black screen with the caption `FADE STEP nn` in white on row 0, columns 0 to
11, and sixteen bars of ten raster lines each from line 66 to line 225, the
full width including both side borders. In the PAL PNG the bars occupy rows
50 to 209 and the caption row 35 to 42; on NTSC rows 38 to 197 and 23 to 30.
At step 0 the bars run white, yellow, light green, light grey, cyan, light
red, green, mid grey, light blue, purple, orange, dark grey, red, brown,
blue, black from the top: the luminance order backwards. The step advances
every four frames, 80 ms on PAL and 67 ms on NTSC, so the fade takes 64
frames, 1.28 s on PAL and 1.07 s on NTSC (arithmetic from 19,656 and 17,095
cycles per frame). Step 16 is sixteen black bars under a white
`FADE STEP 16`, held.

The pinned run is 3,725,000 cycles on both models. Both show step 9: the
caption reads `FADE STEP 09` and the bars from the top are colours 14, 4, 4,
8, 8, 11, 11, 11, 2, 2, 9, 9, 6, 6, 0, 0 (light blue, two purple, two
orange, three dark grey, two red, two brown, two blue, two black). Measured:
every pixel of each bar's ten lines is that one colour on both models,
apart from the two artefacts below; nothing outside the bars and the
caption is non-black; the caption's 247 white pixels match the char ROM
glyphs (decoded cell by cell). Eight distinct colours in sixteen bars is
the table's rounding, not a fault: at step 9 rank `p` maps to rank
`floor((7p + 8) / 16)`.

Why that cycle count. The program does not start until the KERNAL reset
and the autostart are done, about 3 M cycles in: a screenshot at 800,000,
1,300,000 or 2,000,000 cycles is black on both models with no caption,
which an earlier session read as the fade having finished. From a PAL
capture at 4,000,000 cycles that showed the frame in which step 13 began,
step 0 began between 2,958,232 and 2,977,888 cycles (arithmetic: 52 steps
of four 19,656-cycle frames back, less up to one frame). On NTSC two
captures bracket the step 5 to 6 change between 3,471,620 and 3,500,000
cycles. 3,725,000 is the count that puts both models at least about one
frame from any step change under those brackets. A count that lands on the
frame in which the step advances gives a torn picture, because the exit
screenshot is taken mid-raster: at 4,000,000 on PAL the earlier build
showed bars 0 to 8 at step 13 and bars 9 to 15 at step 12. That tear is
in the capture, not in the program.

Two artefacts are in the PNGs and are the program's, so a pixel-for-pixel
check must expect them. First, the left edge of a bar's first line can
carry the colour of the bar above for its leftmost pixels: the busy-wait
loop is seven cycles and exits on cycles 1 to 7 of the line, so the $D020
store completes on cycle 9 to 15 and the $D021 store four cycles later,
and when the loop exits late the first pixels of the line are drawn before
the write. In the PAL PNG bars 0, 3 and 14 carry 16 such pixels, bar 12
carries 48 and bar 1 carries 64; on NTSC bar 0 carries 34 and bars 8 and
10 carry 2. Second, the PAL PNG has 23 single light-grey pixels, palette
index 15, at x 0 to 64 on the first line of eleven of the bars and on
row 210 where the bars end; the NTSC PNG has none. VICE draws one at the
pixel where a colour register is written, which `techniques/raster.md`
already notes and leaves unexamined; the count and positions here are
measured, the cause is not established on this page.

An earlier draft of this listing cleared the carry when forming the row
pointer. At step 16 `step * 16` is 256, the shifted accumulator is zero and
the carry held the overflow, so the pointer went back to row 0 and the held
frame showed the step-0 colours under a caption reading step 16. Its
caption also faded with the bars, so the correct held frame would have
been indistinguishable from a machine that had not started. Both are
fixed: the carry is added to the high byte, and the caption's colour RAM
is written once. A run at 8,000,000 PAL cycles on the listing above shows
sixteen black bars and a white `FADE STEP 16` (measured, not pinned).

Verified: assembled with KickAssembler 5.25, run in VICE x64sc 3.10 with
the pinned command on both models, and the PNGs measured with a script
against the table formula, cell by cell.

Screenshots from the VICE runs this page describes:
`screenshots/colour-fade.png` (PAL) and `screenshots/colour-fade-ntsc.png`
(NTSC).

## Why this works

### The table

`order` is the sixteen colours darkest first, from Y = 0.299 R + 0.587 G +
0.114 B over the PAL triples in `runtime/vice-reference.md`; `pos` is its
inverse. Row `s` of `fade` maps colour `c` to
`order[floor((pos[c] * (16 - s) + 8) / 16)]`: at step 0 that is `c` itself,
at step 16 it is `order[0]`, black, and in between the rank falls in
proportion, rounded to nearest. Every column is monotone, so no bar ever
gets brighter during the fade. KickAssembler evaluates the two `.for`
loops at assembly time and emits 272 bytes; `List().add(...)` and
`.eval pos.set(...)` are the script-language side of the assembler, and
nothing of it survives into the PRG but the bytes.

### The row pointer

The table sits at $0A00 so that `fade + step * 16` has a constant high
byte and a low byte of `step * 16`, until step 16, where the four `ASL`s
shift the 1 out into the carry. `STA ROW` then `BCC` / `INC ROW + 1`
carries it into the high byte. The usual `CLC` / `ADC #<fade` sequence
discards that carry, which is the bug recorded above.

### Timing

Interrupts are off and the frame is paced by a busy-wait for line 250, which
exists on both PAL (312 lines) and NTSC (263). The step logic, sixteen
table lookups and the caption update all happen there, well below the last
bar. Each bar's first line is then busy-waited for and both colour
registers written. No bar starts on a line with `line & 7 == 3`, the
badline condition at the default vertical scroll, so a store is never held
back by the badline's 40 to 43 cycle DMA stall (`techniques/raster.md`);
the start lines 66, 76, ... 216 take the values 2, 4, 6, 0 modulo 8. A bar
that did start on a badline would show its colour change at the right edge
of the line, after the stall.

The KERNAL IRQ is left off for the same reason: with it running, the
interrupt would now and then land inside a bar's busy-wait, that bar's
colour would be written after the service routine returned, and its top
edge would step across the line for one frame. Step timing is in frames, so
PAL and NTSC run the same 64-frame fade at different speeds and reach a
different step for a given cycle count; the pinned count is chosen where
both are at step 9. A CIA timer would make the two models share a step
count at the cost of the frame lock.
