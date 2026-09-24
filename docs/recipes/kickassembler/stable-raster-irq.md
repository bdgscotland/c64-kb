---
recipe: stable-raster-irq
toolchain: kickassembler
output_format: PRG
region: pal
techniques: [stable_raster_irq, double_irq]
file_formats: [PRG]
uses_registers: [D011, D012, D019, D01A, D020, D021, DC0D]
uses_kernal: []
---

<!-- doc-type: recipe -->

# KickAssembler — Stable Raster IRQ

## Synopsis

A raster interrupt that begins executing on the same cycle of the same line
every time, through the KERNAL vector at $0314, using the double-IRQ method.
The stability is shown on screen: ten independent
interrupts per frame each draw a six-line bar whose left edge is written on
one fixed cycle, and the ten edges line up in one column. A `STABLE = 0`
build of the same source draws the bars from a plain raster IRQ and shows
what the jitter looks like.

The sync padding was measured in VICE x64sc (3.9, PAL, default model), not
on hardware, and re-run in 3.10 on 2026-09-22 with a pixel-identical result;
3.10's default model is the C64C (8565, 8580, 8521), and 3.9's was not
checked (an earlier version said the run was a 6569);
the numbers below say so where it matters.

## Source

```asm
// stable-raster-irq.asm
// A cycle-stable raster interrupt through the KERNAL vector, using the
// double-IRQ method, with the stability made visible: ten independent
// stable entries per frame each draw a six-line bar whose left edge is
// written at the same cycle of the line. If entry were jittery, the ten
// bars would not line up.
//
// Set STABLE to 0 to build the control: the same bars drawn from a plain
// raster IRQ. Their left edges then land 0-4 cycles apart from one
// another, and the picture shows it.

.const STABLE    = 1
.const SYNC_PAD  = 11        // cycles of padding before the sync reads (see text)

.const BLOCKS    = 10
.const FIRST     = 61        // first bar's top line; 61 & 7 = 5, see text
.const SPACING   = 16
.const BAR_LINES = 6

BasicUpstart2(start)

// Delay(n): emit exactly n cycles of straight-line code, n >= 2.
.macro Delay(n) {
    .if (n < 2) .error "Delay needs >= 2 cycles"
    .if ((n & 1) != 0) { bit $ea }          // 3 cycles, reads zero page, no side effect
    .for (var i = 0; i < ((n & 1) != 0 ? n - 3 : n) / 2; i++) { nop }
}

* = $0900
start:
    sei
    lda #$7f
    sta $dc0d                // CIA1 ICR: mask every CIA1 source
    lda $dc0d                // reading ICR drops any pending CIA1 request

    lda #<irq1
    sta $0314
    lda #>irq1
    sta $0315

    lda #$1b                 // DEN=1, RSEL=1, YSCROLL=3, RST8=0
    sta $d011
    lda block_line           // first IRQ: three lines above the first bar
    sta $d012                // (or on it, for the control build)
    lda #$01
    sta $d01a                // enable the raster source
    sta $d019                // and clear a stale raster flag (W1C)
    cli

// Main loop: long instructions, so an IRQ that arrives mid-instruction has
// to wait for it to finish and the entry delay differs from block to block.
// A jmp * loop would hide the jitter this recipe is about: every IRQ would
// land at the same point of the same 3-cycle instruction.
main:
    inc $c000,x              // 7-cycle read-modify-writes: an IRQ that
    inc $c100,x              // arrives during one waits up to 6 cycles
    inc $c200,x              // for it to finish
    inx
    jmp main

// ---------------------------------------------------------------------------
// irq1: first half of the double IRQ. Arrives with up to 4 cycles of
// jitter from the main loop plus the fixed 36 cycles of interrupt
// sequence and KERNAL dispatch. It re-arms the raster IRQ for two lines
// later, re-points the vector at irq2, and slides through NOPs with
// interrupts enabled so irq2 is taken from inside a 2-cycle instruction.
// ---------------------------------------------------------------------------
irq1:
.if (STABLE != 0) {
    lda #<irq2
    sta $0314
    lda #>irq2
    sta $0315
    lda irq2_line            // fire again two lines further down (see text)
    sta $d012
    lda #$01
    sta $d019                // acknowledge this one
    tsx                      // remember the stack depth for irq2. The KERNAL
    stx saved_sp             // dispatcher clobbers X (it does TSX itself),
    cli                      // so it has to go through memory.
    .for (var i = 0; i < 40; i++) { nop }
    // irq2 is always taken before this point is reached
}

// ---------------------------------------------------------------------------
// irq2: entered from inside a NOP, so the jitter is now 0 or 1 cycle.
// The two reads of $D012 straddle the line boundary in one case and not
// in the other; BEQ costs 3 cycles taken and 2 not taken, which absorbs
// the last cycle. From here on every instruction starts on a known cycle.
// ---------------------------------------------------------------------------
irq2:
.if (STABLE != 0) {
    ldx saved_sp             // discard irq2's own stack frame
    txs
    Delay(SYNC_PAD)
    lda $d012
    cmp $d012
    beq !+                   // taken (3) if both reads saw the same line
!:
}
    // Draw BAR_LINES lines, 63 cycles each, with the white edge written on
    // the same cycle of every line.
.if (STABLE == 0) {
    Delay(29)                // control only: put the bars where the stable
}                            // build puts them, one line lower
    ldy #BAR_LINES
    Delay(8)
bar_line:
    lda #$01                 // 2
    sta $d020                // 4   white, border
    sta $d021                // 4   white, background
    lda #$0e                 // 2
    sta $d020                // 4   light blue border back
    lda #$06                 // 2
    sta $d021                // 4   blue background back
    ldx #7                   // 2
!:  dex                      // 2 \  7 * 5 - 1 = 34
    bne !-                   // 3 /
    dey                      // 2
    bne bar_line             // 3   -> 63 per line

    // Schedule the next block. Ten blocks per frame; the last one wraps.
    ldx block
    inx
    cpx #BLOCKS
    bne !+
    ldx #0
!:  stx block
    lda block_line,x
    sta $d012
    clc
    adc #2
    sta irq2_line
    lda #<irq1
    sta $0314
    lda #>irq1
    sta $0315
    lda #$01
    sta $d019
    pla                      // KERNAL pushed A, X, Y on entry to irq1;
    tay                      // with irq1's frame restored by TXS this
    pla                      // returns straight to the main loop.
    tax
    pla
    rti

block:      .byte 0
saved_sp:   .byte 0
irq2_line:  .byte FIRST - 1
block_line: .fill BLOCKS, FIRST - (STABLE != 0 ? 3 : 0) + i * SPACING
```

## Build

```bash
java -jar KickAss.jar stable-raster-irq.asm -o stable-raster-irq.prg
```

For the control build, change `STABLE` to 0, or pass it on the command line:

```bash
java -jar KickAss.jar stable-raster-irq.asm -o control.prg -define CONTROL
```

(with `.const STABLE = 1` replaced by `#if CONTROL .const STABLE = 0 #else
.const STABLE = 1 #endif` for a command-line switch).

## Expected output

Ten white bars, six raster lines tall, sixteen lines apart, starting on line
61. Every bar's left edge is in the same pixel column, and its right edge
too. The main loop increments memory at $C000, so the BASIC text at the top
of the screen is left alone.

In the control build the bars are the same width but sit one line lower
(62 to 67), and their left edges are staggered by up to four 8-pixel steps
from bar to bar (measured in one VICE frame: leftmost edges from x=89 to
x=121 in the 384-pixel screenshot; an earlier version of this paragraph
said "one or two" steps and "the same height"). Because the control's
sixth line is the badline 67, its white edge write slips by the badline
stall and lands in the border of the next line, so each control bar shows
five clean lines and a stray white strip at the far left one line below.
That the stagger changes from frame to frame was not re-checked here; the
main loop is 26 cycles and a PAL frame is 19,656 = 756 × 26
cycles, so the pattern may repeat exactly. The stagger itself is the
interrupt entry jitter: the 7-cycle `INC abs,X` instructions in the main
loop delay the interrupt by up to six cycles depending on where in the
instruction it arrives.

Measured in VICE x64sc 3.10 (2026-09-22): with `SYNC_PAD = 11` all ten
left edges fall on one column; with 12 they split into two columns eight
pixels apart, alternating from block to block, and 9 splits the same way.
But 10 gives the same single column as 11, and 13 gives a single column
two cycles (16 pixels) to the right. An earlier version of this paragraph
said 10 and 12 both split and called the result a one-cycle notch; it is
not that clean, because the length of irq2 feeds back into where the next
irq1 lands in the main loop, so which jitter phase each block sees depends
on the padding under test. Read the single column at 11 together with the
alternating split at 12: the split shows the blocks do arrive in both
phases, and the single column shows the sync absorbs them.

Screenshot from the VICE run this page describes: `screenshots/stable-raster-irq.png` and the `STABLE = 0` control is `screenshots/stable-raster-irq-control.png`.

## Why this works

### The problem

The VIC-II raises /IRQ at the start of the raster line whose number matches
$D012. The 6510 finishes the instruction it is executing before it takes the
interrupt, so the handler begins between 0 and 6 cycles late depending on
which instruction was running (7 for the slowest documented instructions).
Then comes a fixed cost: 7 cycles for the interrupt sequence (push PC high,
PC low, status; fetch the vector), and 29 cycles for the KERNAL's dispatcher
at $FF48, which pushes A, X and Y, checks the pushed status for the BRK flag
and jumps through ($0314). The handler's first instruction therefore starts
on cycle 37 to 43 of the line. Anything that has to happen on a specific
cycle (a $D016 write for the side border, a $D018 write for FLI) cannot be
placed from an entry that wobbles by six cycles.

### The double IRQ

The first handler does nothing time-critical. It arms a second raster
interrupt two lines down, points the vector at the second handler, clears
the I flag, and executes a run of NOPs. When the second interrupt arrives it
is guaranteed to interrupt a NOP, and a NOP is two cycles long, so the
second handler's entry jitter is 0 or 1 cycle instead of 0 to 6.

Two lines rather than one, because the first handler's own late entry plus
its setup (34 cycles from the first `LDA` to the `CLI`, counted from the
listing; an earlier version said 30) ends on the next line. With the KERNAL dispatcher in
the path there is not enough room in one line for the setup to finish and
the NOP slide to be under way before the next interrupt is raised. Code that
patches $FFFE/$FFFF directly and skips the dispatcher can use one line.

### Killing the last cycle

Two consecutive reads of $D012 are four cycles apart. If the padding is
chosen so that in the zero-jitter case the first read lands on, say, cycle
59 and the second on cycle 63 of the same line (illustrative cycle numbers,
not measured here), both reads return the same line
number. In the one-cycle-late case the second read lands on cycle 64, which
is cycle 1 of the next line, and the values differ. `BEQ` then costs 3
cycles when they matched and 2 when they did not, so both cases leave the
branch on the same cycle. From there on every instruction starts on a known
cycle of a known line.

The padding is the one number that has to be found rather than derived,
because it depends on exactly which cycle the interrupt sequence starts on
relative to the raster compare. 11 is the value measured in VICE for this
code path (KERNAL dispatcher, NOP slide). Change anything before the sync
reads (the dispatcher, the instruction interrupted, the position of the
`TXS`) and the number moves. A wrong value shows in the picture as two
columns instead of one.

### The stack

The KERNAL dispatcher pushes six bytes per interrupt: PC and status from the
CPU, then A, X, Y. irq2 interrupts irq1, so when irq2 runs there are two
frames on the stack. irq2 discards its own by restoring the stack pointer
irq1 saved, then returns with `PLA/TAY/PLA/TAX/PLA/RTI` through irq1's frame,
straight back to the main loop. Without this the stack grows by six bytes
per block and wraps within a few frames.

One trap here cost this recipe a rewrite: the dispatcher executes `TSX`
itself (to read the pushed status byte), so X does not survive from irq1's
`TSX` into irq2. The saved stack pointer has to go through memory. With a
bare `TSX ... TXS` pair the `TXS` is a no-op, irq2 returns into irq1's NOP
slide, irq1 falls through into irq2's code a second time, and every block is
drawn twice.

### Which lines

A badline (`(line & 7) == YSCROLL`, so lines 51, 59, 67, ... with the
default YSCROLL of 3) stalls the CPU for 40 to 43 cycles. Plan on 43; the
CPU keeps 20 of the 63 (an earlier version said a flat 40). The sync line
and the six drawn lines must not be badlines, or the 63-cycle loop slips by
that much; the control build's sixth line shows exactly this. The
two-line gap between irq1 and irq2 can contain one: the NOP slide just
stalls and resumes. `FIRST = 61` puts irq1 on line 58, the badline 59 inside
the slide, the sync on 60, and the bars on 61 to 66, with the next badline on
67. Every block is 16 lines later, so the same holds for all ten.

### CIA1 and the KERNAL

CIA1's timer A interrupt is masked ($7F to $DC0D) so the only IRQ source is
the VIC. This handler never calls the KERNAL's service routine, so the jiffy
clock stops and the keyboard is not scanned while the program runs; that is
the usual trade in a demo part. To keep them, end one handler per frame
with `JMP $EA31`: $EA31 runs the clock, the cursor, the keyboard scan and
then reads $DC0D, and with CIA1 masked that read is harmless.

Three addresses that are easy to confuse, read from the 901227-03 KERNAL
ROM image:

| Address | What is there |
|---|---|
| $FFFE/$FFFF | $48 $FF: the hardware IRQ vector points at $FF48 |
| $FF48 | the dispatcher: PHA, TXA, PHA, TYA, PHA, TSX, LDA $0104,X, AND #$10, BEQ, JMP ($0314) — 29 cycles to reach your handler |
| $EA31 | the default target of $0314: the full service routine (JSR $FFEA first) |
| $EA81 | PLA, TAY, PLA, TAX, PLA, RTI: the bare exit, 22 cycles (25 with the `JMP $EA81` that reaches it; an earlier version said "about 12") |

`JMP $EA31` at the end of a handler is not "restore registers and RTI"; it
is the whole KERNAL interrupt: about 190 cycles when no key is held and
about 1,600 with a key held, as measured for the 6510 CPU reference in this
knowledge base (an earlier version said "roughly a thousand"). `JMP $EA81`
is the cheap exit.

### $D019

$D019 is write-1-to-clear. Writing $01 clears the raster flag and leaves the
sprite-collision and light-pen flags alone. Both handlers acknowledge before
they leave; an unacknowledged raster flag holds /IRQ low and the CPU
re-enters the handler the instant RTI completes.

### NTSC

`region: pal`. On a 6567R8 the line is 65 cycles, the per-line loop needs
two more cycles of delay, and the sync padding has to be re-measured; the
method is the same.

## What this recipe does not show

It does not put the stable entry to use; `sideborder-open` and
`fli-image` do. The cycle numbers for entry and padding are VICE
measurements; a 6569 on a bench may differ by a cycle in the padding, and
the picture is the check.
