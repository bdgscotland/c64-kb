# demo: the demo starter. KickAssembler alone; every target comes from the
# harness (make, run, shot, check, selftest, disk, claims, clean), plus:
#   make probe   the PROBE build's PAL and NTSC shots, for re-measuring the
#                stable entry after a change before the bar kernel
#   make expect  rewrite expect.json from src/config.asm (tools/gen_expect.py)
NAME     := demo
KICK_SRC := src/main.asm

# After the verdict: the main part is frozen, so the picture no longer changes.
# The PAL and NTSC pictures at 10,000,000, 12,000,000 and 16,000,000 cycles
# were identical, pixel for pixel.
SHOT_CYCLES_PAL  := 12000000
SHOT_CYCLES_NTSC := 12000000

# What the program may write, for make claims (claims-watch's own grammar).
# - The eight sprites, the raster IRQ and its $0314 vector; the tune's three
#   voices and the volume.
# - The one $7F store to $DC0D (every CIA1 interrupt off) counts against all
#   three CIA1 units; the meter's $DD0D against CIA2's, declared as harness.
# - The KERNAL's IRQ runs until start's SEI; every IRQ after it enters
#   through $FF48, which only pushes.
# - --all-ram traces the screen and the program's own bytes too.
CLAIMS_ARGS := --claim 'sprite_0, sprite_1, sprite_2, sprite_3, sprite_4, sprite_5, sprite_6, sprite_7, vic_raster_irq, irq_vector_0314, cia1_timer_a, cia1_timer_b, cia1_tod, sid_voice_1, sid_voice_2, sid_voice_3, sid_filter_volume' --range 'screen=$$0400-$$07FF,colour=$$D800-$$DBFF,spritedata=$$0340-$$037F,result=$$02FF' --harness 'cia2_timer_a, cia2_timer_b, cia2_tod' --kernal IRQ --cycles 12000000 --all-ram

HARNESS ?= $(firstword $(wildcard harness) ../_harness)
$(if $(wildcard $(HARNESS)/harness.mk),,$(error No harness at '$(HARNESS)'. Copy c64-kb's templates/_harness to ./harness, or make the project with npm run new-project in c64-kb))
include $(HARNESS)/harness.mk

PRG_PROBE := build/$(NAME)-probe.prg
$(PRG_PROBE): $(KICK_SRC) $(KICK_DEPS) $(METER_DEPS) | plan-gate
	@mkdir -p build
	$(KICK_BUILD) -define $(AUTOPILOT_DEFINE) -define PROBE -o $(CURDIR)/$@ > build/kick-probe.log || { cat build/kick-probe.log; exit 1; }

.PHONY: probe expect
probe: $(PRG_PROBE)
	$(call vice_shot,$(PRG_PROBE),$(SHOT_CYCLES_PAL),,shots/probe-pal.png)
	$(call vice_shot,$(PRG_PROBE),$(SHOT_CYCLES_NTSC),-model ntsc,shots/probe-ntsc.png)
	$(PYTHON) tools/probe.py shots/probe-pal.png shots/probe-ntsc.png

expect:
	$(PYTHON) tools/gen_expect.py > expect.json
