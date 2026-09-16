// raster.asm — KickAssembler escape-hatch stub
//
// This file demonstrates the external-asm linking pattern between
// KickAssembler and Oscar64. Oscar64 declares the function extern "C"
// and the .prg produced by KickAssembler is passed as extra source:
//
//   java -jar KickAss.jar src/asm/raster.asm -o raster_asm.prg
//   oscar64 -O2 -o=main.prg -tf=prg src/main.c raster_asm.prg
//
// Oscar64 calling convention (see docs/toolchains/oscar64-reference.md):
//   First argument: zero-page register pair at $02/$03
//   Return value:   ACCU zero-page location
//   Preserved:      caller saves A/X/Y before JSR
//
// On the Oscar64 side declare:
//   extern "C" void raster_irq_install(void);
// Then call: raster_irq_install();
//
// Replace this stub with a real cycle-tight raster IRQ handler when you
// are ready for pixel-accurate raster work.
//
// References:
//   docs/recipes/kickassembler/stable-raster-irq.md  — double-IRQ pattern
//   docs/recipes/kickassembler/raster-bars.md        — per-bar IRQ ring
//   docs/recipes/kickassembler/cracktro-template.md  — full IRQ chain example

// VIC-II register constants
.const D011 = $d011   // control register 1 (YSCROLL, DEN, BMM, ECM, RST8)
.const D012 = $d012   // raster line counter / IRQ target
.const D019 = $d019   // interrupt flag register (W1C: write 1 to clear)
.const D01A = $d01a   // interrupt mask register (bit 0 = raster enable)
.const D020 = $d020   // border colour register
.const IRQ_VEC_LO = $0314  // KERNAL software IRQ vector low byte
.const IRQ_VEC_HI = $0315  // KERNAL software IRQ vector high byte
.const KERNAL_IRQ_RET = $ea31  // KERNAL IRQ return / register restore

// ---------------------------------------------------------------------------
// raster_irq_install
//
// Stub: installs a minimal raster IRQ at line 100 that acknowledges the
// interrupt and chains back to the KERNAL handler. Replace the body of
// raster_irq_handler with a real effect (raster bars, border open, etc.).
//
// This function is exported for Oscar64 linkage.
// ---------------------------------------------------------------------------
.export raster_irq_install
raster_irq_install: {
    sei

    // Mask CIA1 timer A interrupt so it doesn't compete with the raster IRQ.
    // rirq_init() in Oscar64 handles this automatically; include it here if
    // this stub is used standalone (without the Oscar64 rasterirq.h runtime).
    lda #$7f
    sta $dc0d          // CIA1 ICR: write $7F to mask all CIA1 interrupts
    lda $dc0d          // read to clear any pending CIA1 IRQ

    // Install the handler into the KERNAL software IRQ vector.
    lda #<raster_irq_handler
    sta IRQ_VEC_LO
    lda #>raster_irq_handler
    sta IRQ_VEC_HI

    // Enable VIC-II raster interrupt source.
    lda #$01
    sta D01A           // bit 0 = raster IRQ enable

    // Acknowledge any stale VIC IRQ.
    lda #$01
    sta D019

    // Set the target raster line to 100.
    // For lines >= 256 also set bit 7 of $D011 (RST8); line 100 is safe.
    lda #100
    sta D012

    // Ensure $D011 RST8 (bit 7) is clear for raster line < 256.
    lda D011
    and #$7f
    sta D011

    cli
    rts
}

// ---------------------------------------------------------------------------
// raster_irq_handler
//
// Called by the KERNAL's IRQ dispatch when the raster line fires.
// This stub just acknowledges the interrupt and returns.
// Replace with real register writes for raster colour changes, border
// opening, or scroller updates.
//
// See docs/recipes/kickassembler/cracktro-template.md for a full IRQ chain.
// ---------------------------------------------------------------------------
raster_irq_handler: {
    // Acknowledge the raster interrupt (write 1 to bit 0 of $D019).
    lda #$01
    sta D019

    // TODO: add your raster effect register writes here.
    // Example: change border colour
    //   inc D020

    // Re-arm $D012 for the next frame at the same line.
    lda #100
    sta D012

    // Return via the KERNAL's register restore / RTI sequence.
    jmp KERNAL_IRQ_RET
}
