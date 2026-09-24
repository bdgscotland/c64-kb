// test/p4_test.asm: standalone runner for part 4 (FIRE). Build with
//   java -jar KickAss.jar test/p4_test.asm -odir build -o build/p4_test.prg
// and -define FADE for the variant that requests the fade at frame 100.
#import "../src/api.inc"
.const TEST_PART      = 4
.const TEST_FRAMES    = 300
#if FADE
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
.macro PartSelfcheck() { jsr p4.selfcheck }
.label part_irq_count  = p4.irq_count
.label part_irq_lines  = p4.irq_lines
.label part_irq_hi     = p4.irq_hi
.label part_irq_lo     = p4.irq_lo
.label part_irq_hi_addr = p4.irq_hi_addr
.label part_worst      = p4.worst
.label part_typical    = p4.typical
#import "stub.inc"
