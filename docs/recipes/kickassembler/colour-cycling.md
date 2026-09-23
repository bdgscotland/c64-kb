---
recipe: colour-cycling
toolchain: kickassembler
output_format: PRG
region: both
techniques: [colour_cycling]
file_formats: [PRG]
uses_registers: [D012, D020, D021, DC04, DC05, DC0D, DC0E]
uses_kernal: []
---

<!-- doc-type: recipe -->

# KickAssembler — Colour Cycling

## Synopsis

Eight text rows of reverse spaces whose colour RAM is rewritten every second
frame from a rotating eight-colour table, so a blue, light blue, cyan and
white band runs down the screen without a screen-RAM write. The rewrite is
320 stores, landed in the lower border by a busy-wait on $D012, and CIA1
timer A times it; the last cost is printed on row 0 in hex beside the
current phase. After 100 frames the program grades itself: `$02FF` is `$01`
with a green border if the phase is the one 100 frames must produce and no
rewrite went over 4,000 cycles, else `$02` with a red border. The cycling
carries on after the verdict, so the pinned screenshot shows the band in
mid-rotation under a green border. Use it as the template for water, a
conveyor or a glow, or to cycle sprite colours or a `$D021` triple instead
of colour RAM.

## Source

```asm
// colour-cycling.asm
// Eight text rows of reverse spaces whose colour RAM is rewritten every
// second frame from a rotating eight-colour table, so a band of colour
// runs down the screen. CIA1 timer A times each rewrite; the cost of the
// last one is printed on row 0 in hex, with the current phase. After
// FRAMES frames the program grades itself: $02FF is $01 with a green
// border if the phase is the one that many frames must produce and no
// rewrite took more than BUDGET cycles, else $02 with a red border. The
// cycling carries on after the verdict, so a late screenshot shows the
// effect in progress under the verdict border.

.const SCREEN          = $0400
.const COLOUR          = $d800
.const SYNC_LINE       = 251         // first line of the lower border, both models
.const FRAMES_PER_STEP = 2
.const BAND_TOP        = 8           // first band row
.const BAND_ROWS       = 8
.const FRAMES          = 100         // verdict after this many frames
.const EXPECT_PHASE    = (FRAMES / FRAMES_PER_STEP) & 7
.const BUDGET          = 4000        // cycles one rewrite may take
.const RESULT          = $02ff       // verdict byte read by a harness
.const COST_COL        = 21          // "$xxxx" on row 0
.const PHASE_COL       = 34

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
    sei                              // no KERNAL IRQ: the rewrite must not be interrupted
    lda #$7f
    sta $dc0d                        // no CIA1 interrupts: timer A is the stopwatch
    lda $dc0d
    lda #$00
    sta $d020
    sta $d021

    ldx #$00
    lda #$20
!:  sta SCREEN, x                    // clear the screen
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

    lda #$a0                         // the band: reverse spaces, colour RAM shows
    .for (var r = 0; r < BAND_ROWS; r++) {
        ldx #39
    !:  sta SCREEN + (BAND_TOP + r) * 40, x
        dex
        bpl !-
    }

mainloop:
    lda #SYNC_LINE                   // first leave the sync line: a short pass
!:  cmp $d012                        // would otherwise fall through twice in it
    beq !-
!:  cmp $d012
    bne !-

    inc frame
    inc sub
    lda sub
    cmp #FRAMES_PER_STEP
    beq step
    jmp check
step:
    lda #$00
    sta sub
    inc phase
    lda phase
    and #$07
    sta phase

    // Rewrite the band: row r takes colour (r + phase) & 7 from the table.
    t_start()
    ldy phase
    .for (var r = 0; r < BAND_ROWS; r++) {
        lda palette, y                   // palette is 16 long, so no masking
        ldx #39
    !:  sta COLOUR + (BAND_TOP + r) * 40, x
        dex
        bpl !-
        iny
    }
    t_stop(cost)

    // Keep the largest cost seen.
    lda cost + 1
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
    lda cost + 1                     // "$xxxx": the last rewrite in hex
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
    lda phase
    ora #$30
    sta SCREEN + PHASE_COL

check:
    lda done
    bne back
    lda frame
    cmp #FRAMES
    bne back
    inc done
    jmp verdict
back:
    jmp mainloop

verdict:

    // Verdict: the phase FRAMES frames must give, and no rewrite over budget.
    lda phase
    cmp #EXPECT_PHASE
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
    jmp mainloop
fail:
    lda #$02
    sta RESULT
    lda #$02
    sta $d020
    jmp mainloop

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

// The eight band colours, written twice so an index of phase + row never
// needs masking: blue, light blue, cyan, white, cyan, light blue, blue, black.
palette: .byte 6, 14, 3, 1, 3, 14, 6, 0
         .byte 6, 14, 3, 1, 3, 14, 6, 0

caption: .text "colour cycling  cost $0000  phase 0     "

frame:   .byte 0
sub:     .byte 0
phase:   .byte 0
done:    .byte 0
cost:    .word 0
maxcost: .word 0
```

## Build

```bash
java -jar KickAss.jar colour-cycling.asm -o colour-cycling.prg
```

`-showmem` reports one block at $0900-$0B0C: code, then the sixteen-byte
palette, the caption and the counters. The PRG is 782 bytes.

## Expected output

Black screen with the caption `COLOUR CYCLING  COST $0CC1  PHASE n` in
white on row 0. Rows 8 to 15 are each one solid colour across all forty
columns: row `8 + r` shows `palette[(r + phase) & 7]` where the palette is
blue, light blue, cyan, white, cyan, light blue, blue, black. Every second
frame the phase goes up by one, so the band slides up a row: on PAL a full
turn of eight steps takes sixteen frames, 0.32 s, on NTSC 0.27 s
(arithmetic from 19,656 and 17,095 cycles a frame). The cost readout is the
cycles CIA1 timer A counted for the last rewrite, 3,265, the same on both
models. The border is black until frame 100 and green from then on.

The pinned run is 6,030,000 cycles on both models. Both show phase 5: rows
8 to 15 are light blue, blue, black, blue, light blue, cyan, white, cyan,
the border is green and the cost reads `$0CC1`. Measured: every pixel of
the 24 rows below the caption is the colour that phase gives its cell, no
mismatches in 61,440 pixels on either model, and the caption decodes cell
by cell against the char ROM. The verdict store is at cycle 4,933,399 on
PAL and 4,806,500 on NTSC in the `-moncommands` trace (route 2 of
`runtime/vice-reference.md`, "Verifying a run without a human"), which put
the program's first frame near 2,968,000 and 3,097,000 cycles, inside the
bracket the `colour-fade` recipe measured for the start of a program this
size.

Why that count. A shot lands in a partly drawn frame, so on a step frame a
count that puts the beam between the caption and the band shows the new
phase in the caption over the previous phase in the band. At 6,000,000 PAL
did exactly that, caption 2 over a band at 1; a sweep in 10,000-cycle
steps found 6,030,000 consistent on both models, and it is what is pinned.
A count that lands on a step frame with the beam inside the band would
tear the band itself; none of the sweep's shots did.

An earlier draft of this listing waited for line 251 with a single
compare loop. On a frame with no step the work after the wait is under a
raster line, so the loop fell straight through a second time in the same
line and the frame counter went up by two: the band stepped every frame,
not every second one, and the verdict, which counts frames, was taken
early. The listing now waits to leave line 251 before waiting to reach
it. That draft's rewrite also read `$0CE8`, 3,304 cycles, against 3,265
now; the two builds run the same store loop and the 39-cycle difference is
not established here.

Verified: assembled with KickAssembler 5.25, run in VICE x64sc 3.10 with
the pinned command twice on each model with byte-identical PNGs, the
verdict read from a `-moncommands` trace, and the PNGs checked cell by
cell against the palette formula.

Screenshots from the VICE runs this page describes:
`screenshots/colour-cycling.png` (PAL) and
`screenshots/colour-cycling-ntsc.png` (NTSC).

## Why this works

### The rewrite

Each band row is one `STA COLOUR + row * 40, X` loop of forty stores, ten
cycles a cell, unrolled over the eight rows by a `.for` at assembly time.
The colour comes from `palette, Y` with `Y` starting at the phase and going
up by one per row; the table is written twice so `phase + 7` never runs off
its end. Eight rows are 3,265 cycles by the CIA, about 52 raster lines.
Started on line 251 the rewrite ends on line 303 on PAL and on line 38 of
the next frame on NTSC, both before the badline that fetches row 8 on line
115, so the VIC never reads a half-written band. The same loop over all
twenty-five rows would take about 10,200 cycles (arithmetic) and cross the
top of the display on both models: that is the case
`full_field_redraw_exceeds_vblank` describes.

### The stopwatch and the verdict

CIA1 timer A is loaded with $FFFF and started on the phi2 clock just before
the rewrite and stopped just after it; $FFFF less the count is the cost.
CIA1 interrupts are masked first so the timer is only a counter. The
verdict has two conditions: the phase after 100 frames must be 50 steps
modulo eight, which is 2, and the largest cost seen must be under the
4,000-cycle budget. A frame counter that runs fast, as the earlier draft's
did, fails the first; a rewrite interrupted or stalled fails the second.

### Timing

Interrupts are off and the frame is paced by a busy-wait on line 251, the
first line of the lower border on both models. The wait is two loops: leave
the line, then reach it, because the work between waits on a frame with no
step is shorter than a line. The KERNAL IRQ is left off so no interrupt
can land inside the rewrite and push its tail into the display. Step
timing is in frames, so PAL and NTSC show the same phase for a given frame
and different phases for a given cycle count; 6,030,000 happens to give
both phase 5.
