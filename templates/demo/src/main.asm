// main.asm: the demo starter. Start-up, the main loop and the memory map.
//
//   framework.asm   dispatcher, stable entry, sequencer, frame slot, wipe
//   parts.asm       the running order and every part's IRQ chain
//   part_title.asm  part 0: the title card
//   part_main.asm   part 1: logo, sprite chain, bars kernel, scroller
//   tables.asm      part 1's sines, ramps, sprite, logo and message
//   music.asm       the tune and its player, $1000 init / $1003 play
//   verdict.asm     AUTOPILOT: grades the frozen frame
//
// -define AUTOPILOT: the frame meter runs (row 24, columns 20-39) and the
// main part freezes after FREEZE_UPDATES updates for the verdict.
// -define FORCE_FAULT: the sprite chain starts sixteen sine steps ahead; the
// verdict and the screenshot checks must both fail.
// -define PROBE: the bar kernel's stores move 20 cycles right, into the
// visible line, to measure where they land (README, "The stable entry and the bars").
#import "frame_meter.asm"              // templates/_harness/meter, via -libdir
#import "config.asm"

BasicUpstart2(start)

* = $0810 "code"
start:
        sei
        lda #$7f
        sta $dc0d                      // CIA1: no interrupts; every IRQ is a raster match
        lda $dc0d                      // drop one already flagged
        lda #0
        sta $d015
        sta $d01a
        jsr detect_model
        lda model
        beq !+
        lda #<kernel_ntsc              // the NTSC kernel's lines are 65 cycles
        sta kernel_call+1
        lda #>kernel_ntsc
        sta kernel_call+2
!:      ldx #63                        // the sprite image to block 13
!:      lda sprite_image,x
        sta SPRITE_BLOCK * 64,x
        dex
        bpl !-
        lda #0                         // the tune: subtune 0, X = this model's pitch
        ldx model
        jsr MUSIC_INIT
        lda #0
        sta part
        jsr start_part                 // part 0's init, frame count and chain
        FrameMeterInit()               // after the init: the meter tints its own cells
        lda chain_first                // arm the chain's first row
        sta slot
        tax
        lda slots+0,x
        sta $d012
        lda $d011
        and #$7f
        ora slots+1,x
        sta $d011
        lda #<irq
        sta $0314
        lda #>irq
        sta $0315
        lda #$01
        sta $d01a
        sta $d019
        cli

// The main loop: everything that is not tied to a raster line. Once a
// frame: record the meter, start the next part when the sequencer asks, and
// give the loader its turn.
main_loop:
#if PROBE
        // PROBE only: the IRQs must land in every phase of the instruction
        // they interrupt, or a wrong SYNC_PAD looks right. A frozen frame
        // repeats exactly, so each pass waits 5 x n cycles (n = 1 to 19, one
        // more each frame) and then spins in a 19-cycle loop with a 6-cycle
        // instruction in it; 19 is prime and divides neither frame length.
        inc probe_n
        lda probe_n
        cmp #20
        bcc !+
        lda #1
        sta probe_n
!:      tax
!:      dex
        bne !-
!:      lda frame_flag                 // 4
        bne !+                         // 2
        inc probe_spin                 // 6
        nop                            // 2
        nop                            // 2
        jmp !-                         // 3
!:
#else
        lda frame_flag
        beq main_loop
#endif
        lda #0
        sta frame_flag
        FrameMeterEnd()                // the frame's IRQ work, summed, is one sample
        FrameMeterPrint()
        jsr switch_parts
        jsr loader_hook
#if AUTOPILOT
        lda verdict_done               // grading is bookkeeping: outside every bracket
        bne !+
        lda frozen
        beq !+
        jsr verdict
!:
#endif
        jmp main_loop

// The loader hook. A real demo loads its next part here while this one
// plays, with an IRQ loader (Sparkle, Spindle or Krill: see c64-kb's
// loader techniques). It runs outside every IRQ, so the chain keeps its
// lines. Not the KERNAL's LOAD: its serial routines run with interrupts
// masked for whole bytes, which moves the bars, and end in CLI.
loader_hook:
        rts

probe_spin: .byte 0
probe_n:    .byte 0

#import "framework.asm"
#import "parts.asm"
#import "part_title.asm"

#import "music.asm"                    // * = $1000

* = $1400 "main part"
#import "part_main.asm"
#if AUTOPILOT
#import "verdict.asm"
#endif
frame_meter:                           // the meter's macros jsr into this label
        FrameMeterCode(SCREEN, 24, 20, 1, HOLD)
#import "tables.asm"                   // page-aligned
