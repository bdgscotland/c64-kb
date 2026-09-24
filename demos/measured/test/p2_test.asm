// test/p2_test.asm: standalone runner for part 2 (TWIST). Build with
//   java -jar KickAss.jar test/p2_test.asm -odir build -o build/p2_test.prg
// -define FORCE_FAULT for the poisoned depth table (selfcheck must fail, a
// far grey ball is drawn over a near white one), and -define FADE for the
// variant that requests the fade at frame 100.
#import "../src/api.inc"
.const TEST_PART      = 2
.const TEST_FRAMES    = 300
#if FADE
.const TEST_FADE_AT   = 100
#else
.const TEST_FADE_AT   = 0
#endif
.import source "../src/parts/p2_twist.asm"
.macro PartPrepare()   { jsr p2.prepare }
.macro PartSetup()     { jsr p2.setup }
.macro PartMain()      { jsr p2.main }
.macro PartFadeout()   { jsr p2.fadeout }
.macro PartCleanup()   { jsr p2.cleanup }
.macro PartSelfcheck() { jsr p2.selfcheck }
.label part_irq_count  = p2.irq_count
.label part_irq_lines  = p2.irq_lines
.label part_irq_hi     = p2.irq_hi
.label part_irq_lo     = p2.irq_lo
.label part_irq_hi_addr = p2.irq_hi_addr
.label part_worst      = p2.worst
.label part_typical    = p2.typical
#import "stub.inc"
