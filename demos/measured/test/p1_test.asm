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
.macro PartSelfcheck() { jsr p1.selfcheck }
.label part_irq_count   = p1.irq_count
.label part_irq_lines   = p1.irq_lines
.label part_irq_hi      = p1.irq_hi
.label part_irq_lo      = p1.irq_lo
.label part_irq_hi_addr = p1.irq_hi_addr
.label part_worst       = p1.worst
.label part_typical     = p1.typical
#import "stub.inc"
