---
recipe: stable-raster-irq
toolchain: oscar64
output_format: PRG
region: both
techniques: [stable_raster_irq]
file_formats: [PRG]
uses_registers: [D011, D012, D019, D01A]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 Stable Raster IRQ

## Synopsis

Demonstrates the canonical Oscar64 idiom for raster-synchronized interrupts using
`rasterirq.h`. The program fires a single raster IRQ at line 100, changes the border
color to white on entry, and holds it white for the rest of the frame. This is the
foundational pattern that all other raster effects in this KB build on.

## Source

```c
// stable-raster-irq.c
#include <c64/vic.h>
#include <c64/rasterirq.h>

// RIRQCode is a 31-byte struct that encodes up to five writes.
// Declare it at file scope so it lives in static storage.
RIRQCode rirq;
RIRQCode restore;

int main(void)
{
    // rirq_init(true) installs the raster IRQ system and routes it through
    // the KERNAL IRQ vector at $0314/$0315. Pass false to install directly
    // at the hardware vector $FFFE/$FFFF (faster, but requires KERNAL off).
    // true is safe for cartridge-free PRG programs that load over BASIC.
    rirq_init(true);

    // rirq_build initializes the RIRQCode struct for one write slot.
    // The second argument is the number of writes (1-5). Each write slot
    // will execute a single STA <address> in the IRQ handler at the
    // programmed raster line. No heap allocation; you supply the struct.
    rirq_build(&rirq, 1);

    // rirq_write sets write slot 0 to store VCOL_WHITE into vic.color_border
    // ($D020). When the raster IRQ fires, the handler executes exactly:
    //   LDA #VCOL_WHITE
    //   STA $D020
    // in hand-optimized assembly inside rasterirq.c. No C function overhead.
    rirq_write(&rirq, 0, &vic.color_border, VCOL_WHITE);

    // rirq_set installs the RIRQCode into slot 0, scheduled to fire one
    // raster line below line 100 (i.e., at the start of raster line 101).
    // Slots are numbered 0-15 (up to NUM_IRQS, default 16).
    rirq_set(0, 100, &rirq);

    // A second slot puts the border back to light blue at line 201. Without
    // it the first interrupt leaves the whole border white for good and
    // there is nothing to see: a register write persists until something
    // writes the register again.
    rirq_build(&restore, 1);
    rirq_write(&restore, 0, &vic.color_border, VCOL_LT_BLUE);
    rirq_set(1, 200, &restore);

    // rirq_sort orders all installed slots by ascending raster line.
    // Always call this after any rirq_set or rirq_move before rirq_start,
    // and once per frame after moving slots mid-loop.
    rirq_sort();

    // rirq_start enables the VIC-II raster interrupt (sets D01A bit 0,
    // programs D012 to the first slot's line) and unmasks the CPU IRQ.
    // From this point the handler fires automatically each frame.
    rirq_start();

    // Spin forever. The raster IRQ changes the border color on every frame
    // without any CPU involvement in the main loop.
    for (;;) { }

    return 0;
}
```

## Build

```bash
oscar64 -o=stable-raster-irq.prg -tf=prg stable-raster-irq.c
```

Expected outputs: `stable-raster-irq.prg`, `stable-raster-irq.map`,
`stable-raster-irq.asm`, `stable-raster-irq.lbl`.

Load with `LOAD"STABLE-RASTER-IRQ",8,1` followed by `RUN`, or pass
`-autostart stable-raster-irq.prg` to VICE.

## Expected output

A white band in the border from raster line 101 to line 200; light blue above
and below. Both edges are straight across the frame: the dispatcher's polling
loop (below) puts the write in the horizontal blank.

On both PAL (50 Hz, 312 lines) and NTSC (60 Hz, 263 lines) the effect is
identical in appearance.

Verified with Oscar64 (build 2026-05-19) and VICE x64sc. The earlier version
of this recipe had only the first slot and described a split at line 101;
what it produced was an all-white border, because nothing ever wrote light
blue back.

## Why this works

### What `rirq_init` actually does

`rirq_init(true)` performs three actions. First, it disables CIA1 timer A
interrupts (the source of the KERNAL's 1/60-second jiffy timer) by writing to
`$DC0D`. Without this, the CIA and VIC-II would both be driving the CPU IRQ line
simultaneously, and the handler would fire unpredictably. Second, it installs
the `rasterirq` dispatcher at `$0314`/`$0315` (the KERNAL software IRQ vector),
so the KERNAL's own IRQ entry at `$FF48`/`$EA31` jumps into the dispatcher after
doing its standard register save. Third, it programs `$D01A` bit 0 to enable
VIC-II raster interrupts. The CIA disable is the step that confuses hand-rolled
IRQ code most often; `rirq_init` handles it automatically.

### What "stable" means here, and what it does not

Raw VIC-II raster IRQs carry 0-6 cycles of jitter because the CPU finishes
its current instruction before entering the handler, and on top of that the
KERNAL dispatcher adds 29 fixed cycles, so the handler starts on cycle 37-43
of the line. A colour write from there lands two-thirds of the way across the
visible line.

What `rasterirq.c` does about it can be read in `rirq_build`: every
`RIRQCode` begins with `CMP $D012 / BCS -5`, a 7-cycle loop that spins until
the raster counter passes the programmed row. The dispatcher is entered on
the row *before* the target, so the loop exits within the first 1-7 cycles of
the target line and the first `STA` completes by about cycle 12, inside the
horizontal blank. That is why the band edges are straight: the write is
early, not exact. The residual jitter is the loop's granularity, up to six
cycles, which is invisible for a border colour and would not be for a
$D016 side-border write or an FLI $D018 write. The genuinely cycle-exact
entry — the double-IRQ method — is in
`docs/recipes/kickassembler/stable-raster-irq.md`; `rasterirq.h` does not
implement it, and the earlier text of this recipe, which said the offset
was "fixed" and "jitter-free", overstated the library.

### `rirq_build`, `rirq_write`, `rirq_set`

`rirq_build(&rirq, n)` initializes an `RIRQCode` struct for `n` writes (1-5).
The struct is 31 bytes; larger variants `RIRQCode10` and `RIRQCode20` hold 10
and 20 writes respectively. The writes are stored as address/data pairs directly
inside the struct — no heap, no indirection at fire time.

`rirq_write(&rirq, slot, addr, data)` patches slot `slot` of the struct with the
target address and data byte. At IRQ fire time the handler executes `LDA #data /
STA addr` for each slot in sequence. Up to five writes fire within the cycle
budget of a single raster line on both PAL (63 cycles/line) and NTSC
(65 cycles/line). For more writes per line, use `RIRQCode10` or `RIRQCode20`.

`rirq_set(n, row, &rirq)` installs the code into IRQ slot `n` and programs it to
fire one line below `row`. The "one below" offset is a documented convention in
`rasterirq.h`: `rirq_set(0, 100, ...)` fires at the start of line 101, not
line 100. This gives the CPU the entirety of line 101 to execute the writes
before the raster beam reaches the point where writes need to be visible.

### `rirq_sort` and `rirq_start`

`rirq_sort()` orders the slot table by ascending raster line. The dispatcher
walks this sorted table on every frame, firing each slot as the beam reaches its
line. If slots are installed out of order or moved mid-frame (via `rirq_move`),
`rirq_sort()` must be called again before the next frame begins. The idiomatic
call site is at the bottom of the main loop, after `rirq_wait()`.

`rirq_start()` unmasks the CPU IRQ and programs `$D012` to the first slot's
line, triggering the first interrupt on the next matching raster. After this
call the handler runs autonomously — the main loop never needs to touch IRQ
machinery again unless slots are being moved.

### Oscar64 vs cc65 IRQ style

The cc65 equivalent of this recipe requires writing `$DC0D = 0x7F` to disable
CIA interrupts, storing a function pointer at `$0314`/`$0315`, writing `$D01A =
0x01`, and writing `$D012 = 100` manually. The handler stub must acknowledge
`$D019`, re-arm `$D012` for the next frame, and return via RTI with A/X/Y/SR
restored. None of that appears in this recipe because `rasterirq.h` encapsulates
all of it. The Oscar64 idiom is three function calls to set up and one `for (;;)`
to hold: the handler is data, not code, and the dispatcher is a reusable library.
