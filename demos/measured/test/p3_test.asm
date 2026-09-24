// test/p3_test.asm: the standalone runner for part 3 (border + DYSP + scroller).
// Build: java -jar KickAss.jar test/p3_test.asm -odir build -o build/p3_test.prg
// -define FADE: the fade is requested at frame 250; by frame 300 the scroller
// row is dissolved, sprites are off, and fadeout has returned 1.
#import "../src/api.inc"
.const TEST_PART      = 3
.const TEST_FRAMES    = 300
#if FADE
.const TEST_FADE_AT   = 250
#else
.const TEST_FADE_AT   = 0
#endif
.import source "../src/parts/p3_border.asm"
.macro PartPrepare()   { jsr p3.prepare }
.macro PartSetup()     { jsr p3.setup }
.macro PartMain()      { jsr p3.main }
.macro PartFadeout()   { jsr p3.fadeout }
.macro PartCleanup()   { jsr p3.cleanup }
.macro PartSelfcheck() { jsr p3.selfcheck }
.label part_irq_count  = p3.irq_count
.label part_irq_lines  = p3.irq_lines
.label part_irq_hi     = p3.irq_hi
.label part_irq_lo     = p3.irq_lo
.label part_irq_hi_addr = p3.irq_hi_addr
.label part_worst      = p3.worst
.label part_typical    = p3.typical
#import "stub.inc"
