---
recipe: stable-raster-irq
toolchain: kickassembler
output_format: PRG
region: both
techniques: [stable_raster_irq]
file_formats: [PRG]
uses_registers: [D011, D012, D019, D01A]
uses_kernal: []
---

<!-- doc-type: recipe -->

# KickAssembler — Stable Raster IRQ

## Synopsis

Demonstrates the canonical KickAssembler pattern for hooking the VIC-II's raster
interrupt and verifying the timing visually: a border color change on $D020 that
fires at a fixed scanline. The recipe covers the mandatory CIA1 disable, KERNAL
vector patching, $D019 acknowledgment, and the $EA31 KERNAL return. It is the
prerequisite for every cycle-exact raster technique in this knowledge base.

## Source

```asm
// stable-raster-irq.asm
// Hooks the KERNAL IRQ vector ($0314/$0315), fires a raster interrupt at
// raster line 100, toggles the border color to prove the IRQ is landing.

.const RASTER_LINE = 100     // target scanline (0-311 PAL, 0-262 NTSC)

BasicUpstart2(start)

* = $0900
start:
    sei                      // disable interrupts while we set up vectors

    // Disable CIA1 timer-A interrupt.
    // Without this, the KERNAL CIA1 handler fires at 1/60 s (NTSC) or
    // 1/50 s (PAL) and competes with our raster IRQ on the same vector.
    lda #$7f
    sta $dc0d                // CIA1 ICR: writing %01111111 masks all sources
    lda $dc0d                // read ICR once to clear any pending CIA1 IRQ

    // Point the KERNAL IRQ vector at our handler.
    // $0314/$0315 is the indirect vector the KERNAL dispatcher at $EA31
    // jumps through after it has done its own bookkeeping. Patching here
    // keeps KERNAL ROM enabled so we can still use SID, BASIC, and the
    // tape routines.
    lda #<irq
    sta $0314
    lda #>irq
    sta $0315

    // Enable the raster interrupt source in the VIC-II interrupt mask register.
    // $D01A bit 0 = raster interrupt enable. Writing $01 enables raster IRQ
    // only; other VIC sources (sprite collision, lightpen) remain masked.
    lda #$01
    sta $d01a

    // Set up VIC-II display and raster compare registers.
    // $D011 = $1B:
    //   bits 2-0 = YSCROLL 3 (default), bit 3 = RSEL (25 rows), bit 4 = DEN
    //   (display enable), bit 5 = BMM=0 (char mode), bit 6 = ECM=0,
    //   bit 7 = RST8 (9th bit of raster compare) = 0 because line 100 < 256.
    lda #$1b
    sta $d011

    // Write the low 8 bits of the raster compare value.
    // IRQ fires when the VIC's internal raster counter equals this value
    // (combined with RST8 in $D011 bit 7 for lines >= 256).
    lda #RASTER_LINE
    sta $d012

    cli                      // re-enable interrupts — handler is now live
    jmp *                    // spin forever; all work happens in IRQ

// ---------------------------------------------------------------------------
// IRQ handler
// Entry: the KERNAL dispatcher at $EA31 has already pushed A/X/Y and the
// status register; we arrive with the CPU in interrupt mode (I flag set).
// ---------------------------------------------------------------------------
irq:
    // Visual proof: toggle the border color register.
    // INC $D020 costs 6 cycles (absolute RMW). It raises the border color
    // by 1 each frame, cycling through all 16 C64 colors.
    inc $d020

    // Acknowledge the raster interrupt.
    // $D019 uses write-1-to-clear semantics. Bit 0 = raster IRQ flag.
    // If we skip this, the VIC holds /IRQ low and the CPU re-enters the
    // handler immediately after RTI — an infinite tight loop.
    lda #$01
    sta $d019

    // Return through the KERNAL IRQ dispatcher.
    // $EA31 is the KERNAL's standard IRQ exit: it pulls A/X/Y from the
    // stack (which the dispatcher pushed on entry) and executes RTI.
    // This keeps CIA1 timekeeping and the BASIC run-stop poll working.
    jmp $ea31
```

## Build

```bash
java -jar KickAss.jar stable-raster-irq.asm -o stable-raster-irq.prg
```

Produces `stable-raster-irq.prg`. Add `-vicesymbols` to generate a `.vs`
label file for VICE breakpointing:

```bash
java -jar KickAss.jar stable-raster-irq.asm -o stable-raster-irq.prg -vicesymbols
```

## Expected output

The screen border cycles through all 16 C64 colors, changing once per video
frame. The change line is horizontal — it appears as a clean color boundary at
approximately one-third of the way down the screen (raster line 100 out of 312
PAL lines). If the boundary is ragged or diagonal, the IRQ handler is not
landing cycle-stably; see the `stable_raster_irq` technique doc for the
double-IRQ variant that eliminates jitter entirely.

## Why this works

### BasicUpstart2

`BasicUpstart2(start)` is a KickAssembler built-in macro that emits a two-line
BASIC program (`10 SYS <addr>`) at `$0801`, pads to the calculated SYS target,
and sets the program counter so `start:` follows immediately. Running the PRG in
VICE or a real C64 via `LOAD + RUN` executes the BASIC stub, which calls SYS
into `start`. Writing the BASIC stub by hand is the most common LLM antipattern
in C64 assembly; always use `BasicUpstart2`.

### CIA1 disable

The C64 KERNAL initializes CIA1's timer A to generate a 1/60 s (NTSC) or 1/50 s
(PAL) interrupt for the jiffy clock and keyboard scan. That timer interrupt
shares the same hardware /IRQ line as the VIC-II raster interrupt. Without
masking CIA1, both sources fire through $0314/$0315, and unless the handler
explicitly checks $D019 and $DC0D to identify which source triggered, the code
runs at an unpredictable mix of the two rates. Masking CIA1 ICR with `$7F` (all
zeros in the enable-bits field, bit 7 = 0 to write the mask rather than set it)
silences the CIA1 contribution without disabling the CIA chip itself. The
subsequent read of $DC0D clears any CIA1 IRQ that was already pending before the
mask took effect.

### Vector patching via $0314/$0315

The hardware /IRQ vector lives at $FFFE/$FFFF in the 6510's memory map. On a
stock C64 with KERNAL ROM enabled, those bytes contain $EA/$31, pointing to the
KERNAL's IRQ dispatcher. The dispatcher saves A, X, Y, checks whether the IRQ
is a BREAK instruction (for BASIC error handling), and then jumps through
$0314/$0315 — the user-settable IRQ vector. Patching $0314/$0315 rather than
$FFFE/$FFFF means KERNAL ROM stays enabled (SID routines, tape, BASIC still
work) and our handler receives registers already saved by the dispatcher.

The alternative — patching $FFFE/$FFFF by bank-switching ROM out — saves
approximately 15 cycles of dispatcher overhead but requires the handler to push
and pull A/X/Y manually, manage CIA1 explicitly, and forgo any KERNAL services.
That approach is used in scene-quality code where every cycle on the raster line
matters. For most effects, $0314/$0315 patching is the correct tradeoff.

### $D019 acknowledgment

$D019 is the VIC-II's interrupt request register. Bit 0 is the raster interrupt
flag, set by the VIC when the raster counter matches $D012. The register uses
write-1-to-clear (W1C) semantics: writing a 1 to a bit clears it; writing a 0
has no effect. Writing `$01` to $D019 clears the raster flag without disturbing
the sprite-collision and lightpen flags in bits 1-3.

If the flag is not cleared before RTI, the VIC holds /IRQ asserted and the CPU
re-enters the handler the instant RTI completes — a tight infinite loop that
freezes the machine. This bug manifests as a solid locked color in the border
with no frame progression. Always acknowledge $D019 before returning.

### Cycle accounting at handler entry

On PAL (63 cycles per raster line):

| Step | Cycles |
|------|--------|
| VIC raises /IRQ at line boundary | 0 |
| CPU completes current instruction (jitter) | 0-6 |
| CPU interrupt sequence: push PC hi/lo, push SR, fetch vector lo/hi | 7 |
| KERNAL dispatcher overhead ($EA31 entry, push A/X/Y) | ~13 |
| Handler entry (`inc $d020`) | 6 |
| Acknowledge (`lda #$01 / sta $d019`) | 6 |
| **Total before `jmp $ea31`** | ~32-38 |

Approximately 25-30 cycles remain in the target line after handler overhead.
To land a write at a specific cycle within the line, use the double-IRQ variant
documented in `docs/techniques/raster.md` under `double_irq`.

### $EA31 KERNAL return

Jumping to `$EA31` restores A, X, and Y from the stack (pushed by the KERNAL
dispatcher at entry) and executes RTI. This is not a `JMP` to a subroutine — it
is a transfer to the KERNAL's standard IRQ epilogue. The alternative `pla / tay
/ pla / tax / pla / rti` sequence does the same work in 12 cycles without ROM
dependency, which matters only if you have disabled the KERNAL bank. With the
KERNAL enabled, `jmp $ea31` is the idiomatic and correct return.
