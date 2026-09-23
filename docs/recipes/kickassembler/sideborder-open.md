---
recipe: sideborder-open
toolchain: kickassembler
output_format: PRG
region: pal
techniques: [sideborder_open, stable_raster_irq, double_irq]
file_formats: [PRG]
uses_registers: [D011, D012, D016, D019, D01A, D000, D001, D010, D015, D017, D027]
uses_kernal: []
---

<!-- doc-type: recipe -->

# KickAssembler — Open the Side Borders

## Synopsis

Opens the left and right side borders over a 42-line loop region (41 lines
of open border in the measured picture, see Expected output) and stands
sprites in them. The mechanism is one register write per line: the VIC-II
sets its border flip-flop when the beam reaches X=344 with CSEL=1, or X=335
with CSEL=0; switch CSEL from 1 to 0 between the two, on cycle 56 of the
line (PAL), and neither comparison fires, so the flip-flop stays clear and
neither this line's right border nor the next line's left border is drawn.
There is no separate "left border" write; the earlier version of this
recipe claimed one and never opened anything.

The write has to land on one cycle, so the region runs from a stable
raster interrupt (`stable-raster-irq.md`) and through a per-line loop whose
timing is fixed by two things the text explains: all eight sprites are
active on every line of the region, and no line in the region is a badline.
KickAssembler-only because the loop is counted in cycles; no C compiler
places a store on cycle 56.

Verified in VICE x64sc: inside the region the pixels at the far left and
far right of the frame are the background colour, not the border colour,
and the two border sprites are visible there.

## Source

```asm
// sideborder-open.asm
// Opens both side borders over a 42-line region with all eight sprites
// active in it, two of them standing in the borders. One write per line
// does it: the border flip-flop is set when the beam reaches X=344 with
// CSEL=1, or X=335 with CSEL=0. Switch CSEL from 1 to 0 between the two,
// on cycle 56 of the line (PAL), and neither comparison fires; the
// flip-flop stays clear, so the right border of this line and the left
// border of the next are not drawn.
//
// The write has to land on one specific cycle, so the region runs from a
// stable raster (double IRQ, see stable-raster-irq.asm). Two things make
// the per-line timing work out (see text):
//   - every line in the region has all eight sprites active, so the VIC
//     takes the bus from cycle 55 to cycle 10 of the next line on every
//     line alike. DEC $D016's two write cycles fall on 55 and 56, which
//     the CPU is still allowed; its next read stalls until cycle 11.
//   - YSCROLL is rewritten every line so no line in the region is a
//     badline; the character display idles and shows the background.

.const REGION_TOP   = 101    // sprites' Y; 101 & 7 = 5 keeps the sync line clean
.const REGION_LINES = 42     // Y-expanded sprites: 42 lines of sprite DMA
.const SYNC_PAD     = 11     // measured in VICE, as in stable-raster-irq
.const ENTRY_PAD    = 43     // cycles from the end of the sync to the first DEC

BasicUpstart2(start)

.macro Delay(n) {
    .if (n < 2) .error "Delay needs >= 2 cycles"
    .if ((n & 1) != 0) { bit $ea }
    .for (var i = 0; i < ((n & 1) != 0 ? n - 3 : n) / 2; i++) { nop }
}

// $D011 written on line REGION_TOP+i, after the sprite DMA: DEN=1, RSEL=1,
// YSCROLL = (line+4)&7, which never equals line&7.
* = $0c00
d011_table:
    .fill REGION_LINES, $18 | ((REGION_TOP + i + 4) & 7)
// X positions: one sprite in each side border, six across the screen.
// Sprites 0, 6 and 7 are past X=255, so bits 0, 6 and 7 of $D010 are set
// (an earlier version set only bits 0 and 7 and put sprite 6 at X=24).
spr_x:      .byte <500, <40, <88, <136, <184, <232, <280, <344
spr_x_msb:  .byte %11000001
// Colours: none of them 6 (blue), which is the background and invisible on it.
spr_col:    .byte 1, 2, 3, 4, 5, 13, 7, 8

// A solid 24x21 sprite.
* = $0e00
sprite_block:
    .fill 63, $ff
    .byte 0

* = $0900
start:
    sei
    lda #$7f
    sta $dc0d
    lda $dc0d

    .for (var s = 0; s < 8; s++) {
        lda spr_x + s
        sta $d000 + s * 2
        lda #REGION_TOP
        sta $d001 + s * 2    // all eight on the same lines
        lda #sprite_block / 64
        sta $07f8 + s
        lda spr_col + s      // white, red, cyan, purple, green, light green, yellow, orange
        sta $d027 + s
    }
    lda spr_x_msb
    sta $d010
    lda #$ff
    sta $d017                // Y-expanded: 42 lines of DMA per sprite
    sta $d015                // all eight on

    lda #<irq1
    sta $0314
    lda #>irq1
    sta $0315
    lda #$1b
    sta $d011
    lda #$c8
    sta $d016                // CSEL=1, MCM=0, XSCROLL=0
    lda #REGION_TOP - 3
    sta $d012
    lda #$01
    sta $d01a
    sta $d019
    cli
    jmp *

// Double IRQ, as in stable-raster-irq.asm.
irq1:
    lda #<irq2
    sta $0314
    lda #>irq2
    sta $0315
    lda #REGION_TOP - 1
    sta $d012
    lda #$01
    sta $d019
    tsx
    stx saved_sp
    cli
    .for (var i = 0; i < 40; i++) { nop }

irq2:
    ldx saved_sp
    txs
    Delay(SYNC_PAD)
    lda $d012
    cmp $d012
    beq !+
!:
    // A known cycle of REGION_TOP. Reach the first DEC on cycle 51.
    ldx #0
    Delay(ENTRY_PAD)
line:
    dec $d016                // 51-56: reads 51-54, writes $C8 on 55 and $C7 on 56.
                             // BA went low on 55 for sprite 0; the writes go
                             // through, the next read waits for cycle 11.
    inc $d016                // 11-16: back to $C8
    lda d011_table, x        // 17-20
    sta $d011                // 21-24: this line's YSCROLL, no badline
    inx                      // 25-26
    cpx #REGION_LINES        // 27-28
    beq done                 // 29-30 when not taken
    Delay(17)                // 31-47
    jmp line                 // 48-50
done:
    lda #$1b
    sta $d011                // normal display again
    lda #REGION_TOP - 3
    sta $d012
    lda #<irq1
    sta $0314
    lda #>irq1
    sta $0315
    lda #$01
    sta $d019
    pla
    tay
    pla
    tax
    pla
    rti

saved_sp: .byte 0
```

## Build

```bash
java -jar KickAss.jar sideborder-open.asm -o sideborder-open.prg
```

## Expected output

The normal BASIC screen, with a band in which the light-blue side borders
are gone: the blue background runs from the left edge of the frame to the
right edge. Measured in the VICE PNG (PAL, screenshot row = raster line
minus 16): the right border is open on raster lines 102-142 and the left
border on lines 103-143, 41 lines each, the left lagging by one line because
each write opens this line's right border and the next line's left. The
earlier text said a 42-line band from line 102; the loop does run 42 lines
(101-142), but the first line's `DEC` does not open line 101 in any pad
tried (see the paddings section). In that band, eight solid sprites stand
on the same lines, Y-expanded to 42 lines (102-143): a white one in the
left border (visible from 103, where the left border first opens), an
orange one in the right border, and six more (red, cyan, purple, green,
light green, yellow) across the screen at X=40, 88, 136, 184, 232, 280. An
earlier version of the listing put the yellow sprite at X=24 (missing $D010
bit 6) and coloured the sixth sprite blue, which is the background colour
and therefore invisible; both are fixed. Inside the band the character
display is idle (see below), so the text rows the band crosses are blank;
above and below it the screen is untouched.

If the borders stay closed, the `DEC $D016` is not writing on cycle 56. If
the band opens for a few lines and then stops, something changed the
per-line cycle count: a badline that got through, or a sprite that is not
active on every line of the region.

Screenshot from the VICE run this page describes: `screenshots/sideborder-open.png`.

## Why this works

### The border flip-flop

The VIC-II's main border flip-flop is *set* at a fixed horizontal
position — X=344 when CSEL=1 (40 columns), X=335 when CSEL=0 (38
columns) — and *reset* at X=24 or X=31 respectively, both only while the
vertical border flip-flop is clear. Set means "draw border colour". On PAL
the beam is at X=335 during cycle 55 and at X=344 during cycle 56.

If CSEL is 1 when the beam passes 335, that comparison does nothing; if it
is 0 when the beam passes 344, that comparison does nothing either. So a
1-to-0 transition landing between the two leaves the flip-flop clear for
the rest of the line, and since the reset comparison at X=24/31 on the next
line has nothing to reset, the next line's left border is not drawn either.
That is the whole trick, and it is one write per line: `DEC $D016` on $C8
gives $C7 (CSEL=0, and XSCROLL=7 as a side effect, which does not matter on
an idle display), `INC $D016` afterwards restores $C8 in time for the next
line's comparisons. The restore has the whole of the next line up to cycle
55: measured in VICE x64sc 3.10 for this page, a variant of the loop that
puts the `INC $D016` on cycles 42-47 of the following line gives a picture
identical to the shipped one. The earlier recipe's separate "left border
toggle at cycle 1" does not correspond to anything in the chip.

### Why the write can land on cycle 56 with sprites active

`DEC abs` is six cycles: opcode, address low, address high, read, write
old, write new. Started on cycle 51, its writes are on 55 and 56, and the
new value goes out on 56. Sprite 0's DMA begins with a p-access on cycle
58, and the VIC pulls BA low three cycles earlier, on 55. The 6510 stops on
its next *read* while BA is low, but completes write cycles, up to three of
them. The two writes on 55 and 56 therefore go through; the opcode fetch on
57 waits.

With all eight sprites active the VIC holds the bus through sprite 7's
accesses, which end on cycle 10 of the next line, and the CPU resumes on
cycle 11. That is the second half of the timing: from cycle 11 to the next
`DEC` on cycle 51 is 40 cycles of code, every line, with no need to count
the stall, because the stall always ends on the same cycle. It ends on the
same cycle only if the same sprites are active on every line, which is why
all eight sit on the same Y and are Y-expanded to cover the region. Stagger
them, as the first draft of this rewrite did, and the stall length changes
from line to line; the border opened for six lines and then the loop lost
its phase.

Without sprites, the loop has to be exactly 63 cycles by itself and the
`INC` follows the `DEC` immediately. Either way the constraint is the same:
one write on one cycle, every line.

### Why the region has no badlines

A badline (`(line & 7) == YSCROLL`, lines $30-$F7, DEN set) takes the bus
from cycle 12 (BA low) to cycle 54. The 6510 stops on its first read at or
after cycle 12 and that read completes on cycle 55, so a fresh instruction
cannot start before 55 and this loop's `DEC $D016`, whose new value is
written on its sixth cycle, cannot reach cycle 56 on a badline; that is why
the region is kept badline-free. The earlier text went further and said
there is "no way to place a write on cycle 56" on a badline, with the
earliest write on 58. That is not established: by the same cycle budget, a
`STA $D016` whose high address byte is the read stalled on cycle 12
completes that read on 55 and writes on 56 (arithmetic from the stated
cycles, not measured here; `docs/techniques/raster.md` still states the
absolute form). The loop
writes $D011 on every line with YSCROLL = (line+4)&7, which never matches,
so no badline condition arises during the region. Line 101 itself, the
first, has YSCROLL 3 and 101&7 = 5, and is safe without help.

The cost is the display: with no badlines the VIC has no new character row
to fetch and goes to its idle state, showing the byte at $3FFF (zero on a
stock machine) in the background colour. The band is blank. Opening the
side border *with* a live character display on badline rows is a different
and much harder problem; the recipes that appear to do it either cover the
badline rows or use the tricks catalogued under `fld_flexible_line_distance` and `vsp_glitch` in
`docs/techniques/raster.md`.

### The stable entry and the two paddings

`SYNC_PAD` is the double-IRQ sync padding from `stable-raster-irq.md`,
unchanged because the code path before the sync is identical. `ENTRY_PAD`
is meant to put the first `DEC` on cycle 51 of line 101; it was set by
trying 41-45 in VICE and all five open the region, because a `DEC` that
starts a cycle or two off still gets its writes into the BA-low window on
the first line and the sprite stall re-phases everything from the second
line on. That tolerance is a property of this code path with sprites, not
of the trick. Re-measured for this page with pads 41, 42, 43 and 44: all
four give a pixel-identical picture, and in none of them does line 101's
own right border open (the band starts on 102), so which pad, if any, lands
the first `DEC` on cycle 51 of line 101 has not been identified; the
"cycle 51" in the source comments is the loop's steady state from line 102
on, inferred from the stall ending on cycle 11, not a measured cycle on
line 101.

`REGION_TOP = 101` because the sync line 100 must not be a badline
(100&7 = 4) while the badline 99 falls inside irq1's NOP slide, where a
stall is harmless; see the line-selection note in `stable-raster-irq.md`.

### Sprite positions

X coordinates run 0-503 on PAL, wrapping inside the left border: the
visible left border is X 480-503 then 0-23, the right border 344-375 on a
typical display. X=500 puts a sprite across the wrap in the left border;
X=344 puts one at the start of the right border. Both need bit 8 of X, as
does the yellow sprite at X=280, hence `%11000001` in $D010 (the earlier
`%10000001` left sprite 6 at X=24). A sprite with Y=101 has its DMA turned on at
cycle 55 of line 101 and is drawn from line 102, which is why the region
loop starts its `DEC` on line 101 and the opened band is seen from 102.

### NTSC

`region: pal`. The 6567R8 has 65 cycles per line and the sprite DMA
cycles differ; the border positions in X are the same, so the write still
has to land between X=335 and X=344, but the cycle number and the
post-stall budget both change. Re-derive from the 6567 timing table before
trying this on NTSC.
