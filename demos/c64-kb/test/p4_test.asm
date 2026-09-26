// test/p4_test.asm: standalone runner for part 4 (FIRE). Build with
//   java -jar KickAss.jar test/p4_test.asm -odir build -o build/p4_test.prg
// and -define FADE for the variant that requests the fade at frame 270, so
// the grading frame 300 shows the dissolve part way (30 fade frames: the
// chain three colour steps down, the field one and a half sweeps in);
// -define FADE_FULL requests it at frame 100 so the fade has finished by 300.
// -define WORDS prints the part's words in hex on screen row 1 before grading
// (worst, typical, dissolve worst, dissolve last, LFSR period, lines_hi,
// dissolve_n, fade_frames, nonblack, pal_idx); row 1 holds no selfcheck cell.
#import "../src/api.inc"
.const TEST_PART      = 4
.const TEST_FRAMES    = 300
#if FADE
.const TEST_FADE_AT   = 270
#elif FADE_FULL
.const TEST_FADE_AT   = 100
#else
.const TEST_FADE_AT   = 0
#endif
.import source "../src/parts/p4_fire.asm"
.macro PartPrepare()   { jsr p4.prepare }
.macro PartSetup()     { jsr p4.setup }
.macro PartMain()      { jsr p4.main }
.macro PartFadeout()   { jsr p4.fadeout }
.macro PartCleanup()   { jsr p4.cleanup }
// After grading the stub freezes the main loop but leaves interrupts on, so
// the chain would go on moving until the emulator's cycle limit; freezing it
// here pins the shot to the grading frame. A (the verdict) is kept.
#if WORDS
.macro PartSelfcheck() { jsr show_words
                         jsr p4.selfcheck
                         ldx #1
                         stx p4.chain_frozen }
#else
.macro PartSelfcheck() { jsr p4.selfcheck
                         ldx #1
                         stx p4.chain_frozen }
#endif
.label part_irq_count  = p4.irq_count
.label part_irq_lines  = p4.irq_lines
.label part_irq_hi     = p4.irq_hi
.label part_irq_lo     = p4.irq_lo
.label part_irq_hi_addr = p4.irq_hi_addr
.label part_worst      = p4.worst
.label part_typical    = p4.typical
#import "stub.inc"

#if WORDS
.const WROW = $0400 + 40
.const WCOL = $d800 + 40
.macro HexByte(src, col) {
    lda src
    lsr
    lsr
    lsr
    lsr
    jsr hex_digit
    sta WROW + col
    lda src
    and #$0f
    jsr hex_digit
    sta WROW + col + 1
}
show_words:
    ldx #39
    lda #1
!:  sta WCOL, x
    dex
    bpl !-
    HexByte(p4.worst + 1, 0)
    HexByte(p4.worst, 2)
    HexByte(p4.typical + 1, 5)
    HexByte(p4.typical, 7)
    HexByte(p4.dissolve_worst + 1, 10)
    HexByte(p4.dissolve_worst, 12)
    HexByte(p4.dissolve_cost + 1, 15)
    HexByte(p4.dissolve_cost, 17)
    HexByte(p4.lfsr_period + 1, 20)
    HexByte(p4.lfsr_period, 22)
    HexByte(p4.lines_hi, 25)
    HexByte(p4.dissolve_n, 28)
    HexByte(p4.fade_frames, 31)
    HexByte(p4.nonblack + 1, 34)
    HexByte(p4.nonblack, 36)
    HexByte(p4.pal_idx, 38)
    rts
hex_digit:
    cmp #10
    bcc !+
    sbc #9                   // carry is set: 10..15 becomes screen codes 1..6, A..F
    rts
!:  ora #$30
    rts
#endif
