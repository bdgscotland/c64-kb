// test/p5_test.asm: the standalone runner for part 5 (sprites).
// Build: java -jar KickAss.jar test/p5_test.asm -odir build -o build/p5_test.prg
// -define FADE: the fade is requested at frame 160, so by frame 300 the
// balls have stepped to black and fadeout has returned 1 (sprites off).
#import "../src/api.inc"
.const TEST_PART      = 5
.const TEST_FRAMES    = 300
#if FADE
.const TEST_FADE_AT   = 160
#else
.const TEST_FADE_AT   = 0
#endif
.import source "../src/parts/p5_sprites.asm"
.macro PartPrepare()   { jsr p5.prepare }
.macro PartSetup()     { jsr p5.setup }
.macro PartMain()      { jsr p5.main }
.macro PartFadeout()   { jsr p5.fadeout }
.macro PartCleanup()   { jsr p5.cleanup }
.macro PartSelfcheck() { jsr p5.selfcheck }
.label part_irq_count  = p5.irq_count
.label part_irq_lines  = p5.irq_lines
.label part_irq_hi     = p5.irq_hi
.label part_irq_lo     = p5.irq_lo
.label part_irq_hi_addr = p5.irq_hi_addr
.label part_worst      = p5.worst
.label part_typical    = p5.typical
#import "stub.inc"
