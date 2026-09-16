---
recipe: raster-bars
toolchain: kickassembler
output_format: PRG
region: both
techniques: [raster_bars, stable_raster_irq]
file_formats: [PRG]
uses_registers: [D012, D019, D020, D021]
uses_kernal: []
---

<!-- doc-type: recipe -->

# KickAssembler — Raster Color Bars

## Synopsis

Ten horizontal color bars spanning the display area, implemented as a ring of
chained raster IRQs: each IRQ writes its bar's border and background colors,
advances $D012 to the next bar boundary, acknowledges $D019, and returns. A
frame counter cycles the color palette by one entry per frame, producing a
smooth waterfall animation. This recipe builds directly on the stable-raster-irq
pattern and demonstrates the IRQ-chaining technique that underlies all
multi-split raster effects on the C64.

## Source

```asm
// raster-bars.asm
// Ten raster bars, color-cycled each frame via a rotating palette index.
// Each bar is 16 raster lines tall. IRQs are chained in a ring: bar N's
// handler sets $D012 to bar N+1's start line, the last handler resets to
// the first bar's line for the next frame.

.const NUM_BARS  = 10         // number of bars
.const BAR_H     = 16         // height of each bar in raster lines
.const BAR_START = 56         // raster line of the first bar (top of display area)

BasicUpstart2(start)

// ---------------------------------------------------------------------------
// Palette: 16-entry table of (border, background) color pairs.
// The C64 has 16 colors; we cycle through them for the gradient effect.
// Stored interleaved: pair 0 = border0, bg0; pair 1 = border1, bg1; ...
// ---------------------------------------------------------------------------
* = $0a00
palette:
    .byte $06, $0e   // blue,   light blue
    .byte $0e, $03   // light blue, cyan
    .byte $03, $05   // cyan,   green
    .byte $05, $0d   // green,  light green
    .byte $0d, $07   // light green, yellow
    .byte $07, $08   // yellow, orange
    .byte $08, $02   // orange, red
    .byte $02, $0a   // red,    light red
    .byte $0a, $04   // light red, purple
    .byte $04, $06   // purple, blue
    .byte $06, $0e   // (cycle wraps — mirror of entry 0 for smooth ring)
    .byte $0e, $03
    .byte $03, $05
    .byte $05, $0d
    .byte $0d, $07
    .byte $07, $08

// Per-bar raster line table.  barlines[i] = first raster line of bar i.
barlines:
    .fill NUM_BARS, BAR_START + i * BAR_H

// Current palette rotation index (0-15).  Incremented once per frame by
// the last bar's IRQ.
frame_offset: .byte 0

// ---------------------------------------------------------------------------
// Main: set up the IRQ chain and spin.
// ---------------------------------------------------------------------------
* = $0900
start:
    sei

    // Disable CIA1 timer-A IRQ (see stable-raster-irq.md for rationale).
    lda #$7f
    sta $dc0d
    lda $dc0d

    // Install the first bar's IRQ handler.
    lda #<irq0
    sta $0314
    lda #>irq0
    sta $0315

    // Enable VIC raster IRQ, clear any pending VIC interrupt.
    lda #$01
    sta $d01a
    asl $d019            // ASL on $D019: shifts the register left, writing
                         // back a value with bit 0 = 1 (W1C), clearing any
                         // stale VIC IRQ flag without an LDA/STA pair.

    // Set up VIC display registers.
    lda #$1b             // $D011: 25-row, display on, char mode, RST8=0
    sta $d011
    lda #barlines        // bar 0 start line (low 8 bits; all bars < 256)
    sta $d012

    cli
    jmp *

// Macro: emits one bar IRQ handler inline (no call overhead).
// bar_idx=0..9, next_handler=label of next handler, is_last=0|1.
.macro BarIRQ(bar_idx, next_handler, is_last) {
    ldx frame_offset         // palette base index
    .if(bar_idx > 0) {
        txa
        clc
        adc #bar_idx
        and #$0f             // mod 16
        tax
    }
    lda palette,x            // border color (interleaved pair, even byte)
    sta $d020
    lda palette+1,x          // background color (odd byte)
    sta $d021

    .if(is_last) {
        inc frame_offset     // rotate palette each frame
        lda frame_offset
        and #$0f
        sta frame_offset
        lda #barlines        // wrap back to bar 0
        sta $d012
        lda #<irq0
        sta $0314
        lda #>irq0
        sta $0315
    } else {
        lda #BAR_START + (bar_idx + 1) * BAR_H
        sta $d012
        lda #<next_handler
        sta $0314
        lda #>next_handler
        sta $0315
    }

    lda #$01
    sta $d019                // acknowledge raster IRQ (W1C)
    jmp $ea31
}

// Emit 10 handlers: irq0..irq9 form a ring.
// palette is interleaved byte pairs: [border0, bg0, border1, bg1, ...]

* = $0b00
irq0:  BarIRQ(0,  irq1,  0)
irq1:  BarIRQ(1,  irq2,  0)
irq2:  BarIRQ(2,  irq3,  0)
irq3:  BarIRQ(3,  irq4,  0)
irq4:  BarIRQ(4,  irq5,  0)
irq5:  BarIRQ(5,  irq6,  0)
irq6:  BarIRQ(6,  irq7,  0)
irq7:  BarIRQ(7,  irq8,  0)
irq8:  BarIRQ(8,  irq9,  0)
irq9:  BarIRQ(9,  irq0,  1)
```

## Build

```bash
java -jar KickAss.jar raster-bars.asm -o raster-bars.prg
```

Produces `raster-bars.prg`. Add `-vicesymbols` for label symbols:

```bash
java -jar KickAss.jar raster-bars.asm -o raster-bars.prg -vicesymbols
```

## Expected output

Ten horizontal bands of color, each 16 raster lines tall, filling the upper
portion of the display area. The palette rotates smoothly by one step per frame,
creating a waterfall cascade from blue/cyan at the top through yellow/orange to
purple and back. The frame rate is the native 50 Hz (PAL) or 60 Hz (NTSC). If
the bars bleed across their boundaries, a handler is arriving late on its target
line — most likely due to a badline stall on that scanline; move the bar
boundary one line down to avoid it.

## Why this works

### IRQ chaining

The standard mechanism for multiple raster splits is the IRQ ring: each handler
programs $D012 to the next split line and patches $0314/$0315 to the next
handler before acknowledging $D019 and returning. Because the VIC-II holds
/IRQ asserted until $D019 is cleared and $D012 has been updated to a future
line, the CPU does not re-enter the current handler; it returns to the main loop
and waits for the next VIC assertion. The ring closes when the last handler
resets $D012 and $0314/$0315 back to bar 0's values.

Patching $0314/$0315 inside each IRQ costs 10 cycles (two `LDA #imm / STA abs`
pairs). An alternative is a single shared handler that dispatches on a bar index
variable, avoiding the patch overhead but adding a table-lookup branch. For 10
bars the per-handler approach is simpler and the cycle totals are equivalent.

### KickAssembler macro expansion

The `BarIRQ` macro is a KickAssembler assembly-time construct, not a subroutine.
Each `BarIRQ(n, ...)` call emits a completely separate block of bytes at the
current program counter. There is no call overhead — the generated code for each
bar is identical in structure to what you would write by hand, with the loop
variable `bar_idx` resolved to a literal at assembly time. The `.if(is_last)`
block produces either the "advance to next bar" bytes or the "wrap to frame start"
bytes, but not both. The assembler script language handles all of this before a
single byte is emitted to the `.prg`.

The `.fill NUM_BARS, BAR_START + i * BAR_H` directive generates the `barlines`
table using KickAssembler's `i` loop variable: it emits 10 bytes with values
`56, 72, 88, 104, 120, 136, 152, 168, 184, 200`. This is the idiomatic way to
generate arithmetic tables in KickAssembler source without a separate Python or
Perl script.

### Cycle budget per bar

On PAL (63 cycles per non-badline):

| Operation | Cycles |
|-----------|--------|
| IRQ entry + KERNAL dispatcher | ~13 |
| Palette index calculation (bar 0) | 3 (LDX abs) |
| Palette index calculation (bar N>0) | 11 (TXA, CLC, ADC #n, AND #$0f, TAX) |
| Write $D020 border color (LDA abs,X + STA abs) | 4+4 = 8 |
| Write $D021 background color (LDA abs,X + STA abs) | 4+4 = 8 |
| Update $D012 next line (LDA #imm + STA abs) | 2+4 = 6 |
| Patch $0314/$0315 (two LDA #imm / STA abs pairs) | 10 |
| Acknowledge $D019 (LDA #$01 + STA abs) | 2+4 = 6 |
| `jmp $ea31` dispatch return | 3 |
| **Total** | ~57-65 cycles |

The budget is tight on non-badlines and over budget on badlines (only 23
cycles available on PAL). For badline-safe bars, avoid placing a bar boundary
on a badline row (lines whose `(line & 7) == YSCROLL`, default YSCROLL=3 means
lines 51, 59, 67, ... 243 are bad). The `BAR_START = 56` value in this recipe
avoids line 51 (the first PAL display badline). Adjusting `BAR_START` or
`BAR_H` to skip badlines is the standard mitigation; see the
`badline_synchronization` technique entry in `docs/techniques/raster.md`.

### `asl $d019` for IRQ clear

`asl $d019` at setup time is a read-modify-write that shifts the register left,
writing a non-zero value back that trips the W1C logic on at least one bit —
clearing any stale pending VIC IRQ without a dedicated `LDA #$01 / STA $d019`
pair. In the per-bar handlers the explicit form is used instead, which is
preferred for readability.
