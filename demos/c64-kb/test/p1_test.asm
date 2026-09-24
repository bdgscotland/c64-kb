// test/p1_test.asm: standalone runner for part 1 (logo).
// Build: java -jar KickAss.jar test/p1_test.asm -odir build -o build/p1_test.prg
// -define FADE: fade requested at frame 200 (TEST_FADE_AT = 200)
#import "../src/api.inc"
.const TEST_PART      = 1
.const TEST_FRAMES    = 300
#if FADE
.const TEST_FADE_AT   = 200
#else
.const TEST_FADE_AT   = 0
#endif
.import source "../src/parts/p1_logo.asm"
.macro PartPrepare()   { jsr p1.prepare }
.macro PartSetup()     { jsr p1.setup }
.macro PartMain()      { jsr p1.main }
.macro PartFadeout()   { jsr p1.fadeout }
.macro PartCleanup()   { jsr p1.cleanup }
.macro PartSelfcheck() { jsr p1.selfcheck; jsr print_words }
.label part_irq_count   = p1.irq_count
.label part_irq_lines   = p1.irq_lines
.label part_irq_hi      = p1.irq_hi
.label part_irq_lo      = p1.irq_lo
.label part_irq_hi_addr = p1.irq_hi_addr
.label part_worst       = p1.worst
.label part_typical     = p1.typical
#import "stub.inc"

// print_words: after the selfcheck, write "W" and the four hex digits of
// p1.worst, then "T" and the four of p1.typical, on row 24 of matrix 0
// (cols 0-4 and 6-10) in the part's font, so the words can be read from the
// exit screenshot when the monitor route loses its output (several x64sc
// at once do that). Preserves A, the selfcheck's result. Row 24 is outside
// the plasma rows and its colour RAM is white. $0C00 is clear of the stub
// ($0810-$0A9C) and the TEST_P1_MODE sentinel ($0BF8).
* = $0c00 "p1 test words"
print_words:
        pha
        lda #23                     // W
        sta $07c0
        ldx #1
        lda p1.worst+1
        jsr hexcell
        lda p1.worst
        jsr hexcell
        lda #20                     // T
        sta $07c0 + 6
        ldx #7
        lda p1.typical+1
        jsr hexcell
        lda p1.typical
        jsr hexcell
        pla
        rts
hexcell:                            // A = byte, X = column; writes two cells
        pha
        lsr
        lsr
        lsr
        lsr
        jsr nib
        sta $07c0,x
        inx
        pla
        and #$0f
        jsr nib
        sta $07c0,x
        inx
        rts
nib:    cmp #10
        bcs !+
        clc
        adc #33                     // 0-9 are codes 33-42
        rts
!:      sec
        sbc #9                      // A-F are codes 1-6
        rts
