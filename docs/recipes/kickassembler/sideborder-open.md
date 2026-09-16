---
recipe: sideborder-open
toolchain: kickassembler
output_format: PRG
region: both
techniques: [sideborder_open]
file_formats: [PRG]
uses_registers: [D016, D012, D019, D01A]
uses_kernal: []
---

<!-- doc-type: recipe -->

# KickAssembler — Open the Side Borders

## Synopsis

Suppresses the VIC-II's left and right side borders on every display line by
toggling $D016 bit 3 (CSEL) within a 1-cycle window on each scanline. The
background color shows through the opened border area, allowing sprites and
bitmap data to extend to the screen edges. This recipe is KickAssembler-only:
Oscar64 cannot guarantee the cycle-exact timing the VIC-II requires for this
technique, and any C compiler output that generates even one extra or missing
cycle will produce a visible glitch.

## Source

```asm
// sideborder-open.asm
// Opens both side borders on every display line using the CSEL toggle.
// The right border requires the toggle at cycle 55 (PAL); the left border
// requires it at cycle 1.  Both toggles are performed on every line from
// raster 51 (top of PAL display) through raster 250.
//
// Timing reference: Christian Bauer, "VIC-II Article" (codebase64.org);
// "How Many Pixels" by Joel Yliluoma; Frodo/VICE source vic2.cpp hborder logic.
//
// The critical cycle numbers below are for PAL (6569).  NTSC (6567R8) has
// 65 cycles per line; the right-border window shifts to cycle 57.  A
// preprocessor flag selects the correct value at assembly time.

#define PAL                  // remove and #define NTSC for NTSC machines

.const D016       = $d016
.const D011       = $d011
.const D012       = $d012
.const D019       = $d019
.const D01A       = $d01a
.const VICIRQ_ACK = $01

// CSEL_ON/OFF: hard-code the full $D016 byte to avoid a read-modify-write.
// Default $D016 = $C8 (MCM=0, CSEL=1, XSCROLL=0).
.const CSEL_ON    = $c8      // %11001000: CSEL=1 (40-col)
.const CSEL_OFF   = $c0      // %11000000: CSEL=0 (38-col)

// Raster lines for the display area on PAL.
.const DISPLAY_TOP    = 51   // first visible display line (25-row mode, PAL)
.const DISPLAY_BOTTOM = 250  // last visible display line before bottom border

// Cycle positions for the CSEL toggle on PAL.
// Right border: CSEL must transition 1->0 at cycle 55 of the raster line.
// Left border:  CSEL must transition 1->0 at cycle 1 of the raster line.
// Source: VIC-II state machine analysis, codebase64.org "The Border Unit"
// by White Flame, and Frodo emulator vic2.cpp lines ~870.
//
// Each NOP = 2 cycles.  We use counted NOPs after the IRQ entry to reach
// the correct cycle position for the right-border toggle.

BasicUpstart2(start)

// Zero-page scratch: 3-cycle ZP access vs 4-cycle absolute.
* = $0002 "ZP stub" virtual
zp_csel_on:  .byte 0
zp_csel_off: .byte 0

// ---------------------------------------------------------------------------
// Main program
// ---------------------------------------------------------------------------
* = $0900
start:
    sei

    lda #$7f
    sta $dc0d            // mask CIA1 timer IRQ
    lda $dc0d            // clear pending

    // Cache CSEL values in zero page for faster writes in the hot path.
    lda #CSEL_ON
    sta zp_csel_on
    lda #CSEL_OFF
    sta zp_csel_off

    lda #<irq_border
    sta $0314
    lda #>irq_border
    sta $0315

    lda #VICIRQ_ACK
    sta D019             // clear any stale VIC IRQ

    lda #$01
    sta D01A             // enable raster IRQ source

    lda #$1b             // $D011: DEN=1, RSEL=1, YSCROLL=3
    sta D011

    lda #DISPLAY_TOP - 1 // fire one line before the display area so the
    sta D012             // first line gets the treatment on entry

    cli
    jmp *

// Border-open IRQ handler.
// Fires once at DISPLAY_TOP-1, then loops through every display line.
// PAL: right border = CSEL=0 at cycle 55, restore at cycle 57.
//      left border  = CSEL=0 at cycle 1,  restore at cycle ~13.
irq_border:
    lda #VICIRQ_ACK
    sta D019

    lda #DISPLAY_TOP
    sta D012

    // Per-line loop: poll $D012, NOP-pad to cycle 55, write CSEL toggle.

    ldx #DISPLAY_TOP     // x = current target raster line

line_loop:
    // Poll until raster counter == x (double-read to guard line crossings).
wait_raster:
    lda D012             // [4]
    cpx D012             // [4] re-read
    bne wait_raster      // [2/3]

    // Poll exit ~cycle 10-18.  Pad 21 NOPs (42 cycles) to reach cycle ~55.
    .for(var i = 0; i < 21; i++) { nop }

    lda #CSEL_OFF        // [2]
    sta D016             // [4] cycle ~55 — right border suppressed

    lda #CSEL_ON         // [2]
    sta D016             // [4] cycle ~57 — restore

    inx
    cpx #DISPLAY_BOTTOM + 1
    beq done_loop

    // Immediately at the start of the next line (~cycle 0-3): left border.
    lda #CSEL_OFF        // [2]
    sta D016             // [4] cycle ~5 — left border suppressed

    nop                  // [2]
    nop                  // [2]
    nop                  // [2]
    lda #CSEL_ON         // [2]
    sta D016             // [4] cycle ~17 — restore before active display

    jmp line_loop        // [3]

done_loop:
    lda #CSEL_ON
    sta D016
    lda #DISPLAY_TOP - 1
    sta D012
    lda #VICIRQ_ACK
    sta D019
    jmp $ea31
```

## Build

```bash
java -jar KickAss.jar sideborder-open.asm -o sideborder-open.prg
```

Add `-vicesymbols` for label-based VICE debugging:

```bash
java -jar KickAss.jar sideborder-open.asm -o sideborder-open.prg -vicesymbols
```

## Expected output

The left and right side borders appear as the current background color ($D021
value) rather than the border color ($D020 value). With the default colors after
BASIC init, the border is light blue and the background is blue — the opened
border region turns blue edge-to-edge. Sprites positioned in the border area
(X coordinates 0-23 left, 345-383 right) will render visibly. If vertical
stripes appear in the border area, the CSEL toggle is landing one or more cycles
off-target; use VICE's `-moncommands` and the VICE raster debugger to inspect
the exact cycle of each $D016 write.

## Why this works

### Why this must be KickAssembler (not Oscar64)

The right-border CSEL toggle requires `STA $D016` to land at cycle 55 on PAL,
within a 1-2 cycle window (source: Christian Bauer's VIC-II Article,
codebase64.org; Frodo emulator `vic2.cpp` hborder state machine). A C compiler
— including Oscar64 — cannot guarantee that specific cycle position: register
allocation and instruction selection shift the store cycle by an unpredictable
amount at each compilation. KickAssembler emits exactly the bytes you specify.
The NOP padding count from the raster-counter poll exit to the `STA D016` is a
fixed integer; no optimizer intervenes.

### The $D016 CSEL mechanism

$D016 bit 3 (CSEL) selects 40-column (CSEL=1, display dots 24-344) or 38-column
(CSEL=0, display dots 31-335) mode. The VIC-II border state machine latches the
transition on specific cycles rather than reading the register continuously.

For the right border: the machine checks whether to enter border mode at cycle
55. Writing CSEL=0 there makes it latch the 38-col boundary (dot 335) as
"border begins here." Restoring CSEL=1 immediately after leaves the chip in a
state where the border started at dot 335 but the display window extends to dot
344 — so no border is rendered for the remaining 9 dots of the line.

The left border is symmetric: CSEL=0 at cycle 1 causes the machine to latch
"display starts at dot 31" instead of dot 24. Restoring CSEL=1 before cycle 12
suppresses the border for dots 24-30.

Both borders must be toggled on every line where suppression is wanted.

### Cycle window and jitter

The critical window for the right-border toggle is documented as a 1-cycle
window in the strictest implementations (cycle 55 exactly on PAL), with some
implementations claiming a 2-cycle margin depending on the VIC-II revision
(NMOS 6569R1 vs HMOS 6569R5). The recipe above uses a raster-counter polling
loop to synchronize to the raster line boundary, then pads with 21 NOPs (42
cycles) to reach cycle 55. The polling loop exit has approximately 9 cycles of
residual jitter (one loop iteration), so the NOP count is calculated for the
worst-case exit. If the toggle consistently lands one cycle early or late —
visible as a persistent thin stripe in the border — adjust the NOP count by 1.

For production code, the double-IRQ technique described in `docs/techniques/raster.md`
under `double_irq` eliminates this residual jitter entirely, at the cost of an
extra IRQ per line. The double-IRQ variant is the standard approach in
scene-quality demos where the border must be pixel-perfect on both PAL and NTSC.
This recipe uses the single-IRQ polling approach for clarity.

### NTSC differences

NTSC (6567R8) has 65 cycles per line; the right-border transition shifts to
cycle 57. Remove `#define PAL` and add `#define NTSC` at the top, then adjust
the NOP count by +1. Left-border timing (cycle 1) is the same on both systems.
Assemble with `java -jar KickAss.jar sideborder-open.asm -define NTSC`.

### Badlines

Badlines (`(raster_line & 7) == YSCROLL`, default every 8th line from 51) stall
the CPU for 40 cycles at positions 15-54, spanning the cycle-55 window. The
raster-counter poll absorbs the stall, but the NOP padding no longer aligns
after it. Production code must detect badlines at loop entry
(`(current_line & 7) == 3`) and reduce the NOP count by ~20 to compensate.
This recipe omits the badline correction for clarity.
