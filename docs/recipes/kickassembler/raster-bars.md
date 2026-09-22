---
recipe: raster-bars
toolchain: kickassembler
output_format: PRG
region: both
techniques: [raster_bars]
file_formats: [PRG]
uses_registers: [D011, D012, D019, D01A, D020, D021]
uses_kernal: []
---

<!-- doc-type: recipe -->

# KickAssembler — Raster Color Bars

## Synopsis

Ten horizontal colour bars, sixteen raster lines each, from a ring of
chained raster IRQs: handler N writes bar N's border and background colours,
arms $D012 for bar N+1, re-points $0314/$0315 at handler N+1, acknowledges
$D019 and returns. The last handler rotates the palette by one entry and
wraps to handler 0, so the bars cascade downward at one step per frame. Each
IRQ is armed one line early and spins on $D012 until its bar's first line
begins, which puts the colour write in the horizontal blank rather than in
the middle of the line. This is the plain chained-IRQ pattern; it does not
need the stable entry of `stable-raster-irq` and the text says what that
costs.

## Source

```asm
// raster-bars.asm
// Ten raster bars, 16 lines each, from a ring of chained raster IRQs.
// Handler N sets the colours for bar N, arms the IRQ for bar N+1 and
// re-points the vector at handler N+1; the last handler rotates the
// palette and wraps to handler 0. Each IRQ is armed one line early and
// spins on $D012 until its bar's first line begins, so the colour write
// lands in the horizontal blank instead of in the middle of the line.

.const NUM_BARS  = 10
.const BAR_H     = 16
.const BAR_START = 56        // 56 & 7 = 0: no bar starts on a badline (see text)

BasicUpstart2(start)

* = $0a00
// 16 (border, background) pairs. Entry i is read as palette[2i], palette[2i+1].
palette:
    .byte $06, $0e, $0e, $03, $03, $05, $05, $0d
    .byte $0d, $07, $07, $08, $08, $02, $02, $0a
    .byte $0a, $04, $04, $06, $06, $0e, $0e, $03
    .byte $03, $05, $05, $0d, $0d, $07, $07, $08

frame_offset: .byte 0        // palette rotation, 0-15, +1 per frame

* = $0900
start:
    sei
    lda #$7f
    sta $dc0d                // mask every CIA1 source
    lda $dc0d                // and drop a pending one

    lda #<irq0
    sta $0314
    lda #>irq0
    sta $0315

    lda #$1b
    sta $d011                // DEN=1, RSEL=1, YSCROLL=3, RST8=0
    lda #BAR_START - 1
    sta $d012
    lda #$01
    sta $d01a                // raster source on
    sta $d019                // stale flag off
    cli
    jmp *

// One handler per bar. bar = 0..9; next = the following handler's label.
.macro BarIRQ(bar, next) {
    // Palette entry (frame_offset + bar) & 15, doubled for the pair table.
    lda frame_offset
    .if (bar > 0) {
        clc
        adc #bar
        and #$0f
    }
    asl
    tax
    ldy palette + 1, x       // background colour
    lda palette, x           // border colour
    tax
    // Spin until the bar's first line. The loop is 7 cycles, so this exits
    // between cycle 1 and cycle 7 of the line, and the two stores below
    // are complete by cycle 15 at the latest: still inside the left
    // border on a real display, and in VICE's left margin.
    lda #BAR_START + bar * BAR_H
!:  cmp $d012
    bne !-
    stx $d020
    sty $d021

    .if (bar == NUM_BARS - 1) {
        // Last bar: rotate the palette, wrap to bar 0, and let the KERNAL
        // do its once-per-frame housekeeping (jiffy clock, keyboard scan)
        // on the way out. CIA1 is masked, so $EA31 sees no CIA source.
        inc frame_offset
        lda frame_offset
        and #$0f
        sta frame_offset
        lda #BAR_START - 1
        sta $d012
        lda #<irq0
        sta $0314
        lda #>irq0
        sta $0315
        lda #$01
        sta $d019
        jmp $ea31
    } else {
        lda #BAR_START + (bar + 1) * BAR_H - 1
        sta $d012
        lda #<next
        sta $0314
        lda #>next
        sta $0315
        lda #$01
        sta $d019
        jmp $ea81            // pla/tay/pla/tax/pla/rti: 300 cycles cheaper than $EA31
    }
}

* = $0b00
irq0: BarIRQ(0, irq1)
irq1: BarIRQ(1, irq2)
irq2: BarIRQ(2, irq3)
irq3: BarIRQ(3, irq4)
irq4: BarIRQ(4, irq5)
irq5: BarIRQ(5, irq6)
irq6: BarIRQ(6, irq7)
irq7: BarIRQ(7, irq8)
irq8: BarIRQ(8, irq9)
irq9: BarIRQ(9, irq0)
```

## Build

```bash
java -jar KickAss.jar raster-bars.asm -o raster-bars.prg
```

Add `-vicesymbols` for a `.vs` label file.

## Expected output

Ten bands, each sixteen lines tall, from line 56 to line 215, spanning the
full width including the side borders. Border and background carry the two
colours of the current palette pair, so the BASIC text at the top sits on
the first two bars. The palette advances one entry per frame: 50 steps per
second on PAL, 60 on NTSC. The boundaries between bars are straight across
the whole line.

Verified: assembled with KickAssembler 5.25, run in VICE x64sc, and the
screenshot measured: the colour changes on the same row at the left border,
the middle of the screen and the right border for all ten boundaries. A
screenshot taken mid-frame shows one extra boundary where the beam was when
the capture happened, because the palette moved between the two halves;
that boundary moves with the capture time and is not in the program.

Screenshot from the VICE run this page describes: `screenshots/raster-bars.png`.

## Why this works

### The IRQ ring

Each handler ends by telling the VIC where to interrupt next and telling the
KERNAL vector who should handle it. Ten handlers in a ring means no handler
needs a bar counter or a dispatch table; the cost is ten copies of about
sixty bytes, which the `BarIRQ` macro emits with `bar` resolved to a literal
in each. `.if (bar == NUM_BARS - 1)` picks the wrap-around code for the last
copy at assembly time; the other nine get the advance code.

Two KickAssembler traps in the earlier version of this recipe, both of which
stopped it assembling: `.if(is_last)` on a numeric argument is an error
("Can't get a boolean representation from a value of type number"), so the
comparison is written out; and `lda #barlines`, where `barlines` was a
table label, loads the low byte of the table's *address*, not the first
line number. The same mistake with `.var` versus a table is why the
palette index is now computed from constants rather than read from a
second table.

### Where the colour write lands

A raster IRQ's handler begins on cycle 37 to 43 of the line (7 cycles of
interrupt sequence, 29 of KERNAL dispatcher, 0-6 of instruction completion;
see `stable-raster-irq.md`). A colour write from there lands two-thirds of
the way across the visible line and the top edge of the bar has a visible
step in it. Arming the IRQ on the line above and spinning on `CMP $D012`
moves the write to the start of the target line: the spin loop is 7 cycles,
so it exits on cycles 1-7, and the two 4-cycle stores complete by cycle 15.
Cycles 1-13 are horizontal blank and cycle 14-15 is the first eight pixels
of the left border on a real display, so in the worst case an eight-pixel
notch shows in the far left border on the bar's first line. For a
notch-free edge, use the double-IRQ entry from `stable-raster-irq.md`; this
recipe trades that for one line of busy-waiting per bar and about forty
fewer bytes per handler.

The colours are loaded into X and Y *before* the spin so that only the two
stores stand between the loop exit and the register writes.

### Badlines

A badline steals 40 cycles from the CPU starting at cycle 12. If the spin
loop exits on a badline the stores are pushed to cycle 55 or later and the
notch becomes a two-thirds-line step. `BAR_START = 56` with `BAR_H = 16`
puts every bar's first line on `line & 7 == 0`; badlines with the default
YSCROLL are `line & 7 == 3`. If you change either constant, keep
`(BAR_START + n * BAR_H) & 7 != 3` for every bar, or move YSCROLL.

### $EA31 versus $EA81

Nine of the ten handlers exit through `JMP $EA81`, which is the KERNAL's
register-restore exit: `PLA, TAY, PLA, TAX, PLA, RTI`. The tenth exits
through `JMP $EA31`, the full KERNAL interrupt service: jiffy clock, cursor
blink, keyboard scan, then the same exit. That keeps `TI$` and the keyboard
alive at one call per frame, which is what the KERNAL expects, and costs
about a thousand cycles once per frame instead of ten times. $EA31 reads
$DC0D near its end; with CIA1 masked that read returns nothing pending and
is harmless. Calling $EA31 from every bar handler, as the earlier version
did, would have spent more than a bar's worth of raster time in the keyboard
scan on every bar.

### Acknowledge before you leave

$D019 is write-1-to-clear. `LDA #$01 / STA $D019` clears the raster flag and
leaves the sprite-collision and light-pen bits alone. Without it the VIC
holds /IRQ low and the CPU re-enters the handler as soon as RTI completes.
The setup code also clears it once before `CLI`, so a flag left over from
before the program started does not fire the first handler early.

### Region

`region: both`: nothing here depends on the 63-versus-65 cycle line. The
bars are at the same raster lines on NTSC, the palette runs 20 % faster,
and the notch budget is two cycles looser.
