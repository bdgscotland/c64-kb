# platformer: the side-scrolling platformer starter. Every target but
# tearcheck comes from the harness:
#   make            build build/platformer.prg (after the PLAN.md gate)
#   make run        windowed VICE, joystick in port 2
#   make shot       headless PAL and NTSC exit screenshots of the autopilot build
#   make check      grade shots/pal.png and shots/ntsc.png against expect.json
#   make selftest   prove check fails on the FORCE_FAULT=1 build
#   make tearcheck  shoot the autopilot run mid-scroll and match every picture
#                   against a render of the level (tools/tearcheck.py); then
#                   prove the check fails on the TEAR_DEMO=1 build
#   make drive      the normal game played headless (harness/drive.py; README "Driving it headless")
#   make disk       build/platformer.d64
#   make claims     c64-kb's claims-watch over the autopilot build
#   make clean
NAME     := platformer
C_MAIN   := src/main.c
KICK_SRC := src/engine.asm

SHOT_CYCLES_PAL  := 26000000
SHOT_CYCLES_NTSC := 24000000

# What the program may write, for make claims (claims-watch's own grammar).
# - Oscar64's registers start at $02 (BC_REG_WORK_Y). main's temporaries
#   reach $53 (T5, BC_REG_TMP_SAVED in its MachineTypes.cpp): this trace
#   stores there from main+122, one past the $02-$52 that hello declares.
# - The KERNAL's IRQ runs until main's SEI, so IRQ is declared.
# - $DC0D (all CIA1 interrupts off) counts against the three CIA1 units;
#   the meter's $DD0D against CIA2's three, declared as the harness's.
# - The whole run, title to verdict, is traced (--cycles, the PAL pin).
CLAIMS_ARGS := --claim 'sprite_0, sprite_1, sprite_2, sprite_3, sprite_4, sprite_5, sprite_6, sprite_7, vic_raster_irq, irq_vector_fffe, nmi_vector_fffa, cia2_vic_bank, cia1_port_a, cia1_timer_a, cia1_timer_b, cia1_tod, sid_voice_1, sid_voice_2, sid_voice_3, sid_filter_volume, zero_page $$02-$$53' --range 'colour=$$D800-$$DBFF,result=$$02FF' --harness 'cia2_timer_a, cia2_timer_b, cia2_tod' --kernal IRQ --cycles 26000000

# The harness sits beside the starter in c64-kb (../_harness) or is vendored
# into ./harness when the starter is copied out on its own.
# Proof targets `npm run verify:templates -- --selftest` runs after selftest.
VERIFY_TARGETS := tearcheck stage drivetest

HARNESS ?= $(firstword $(wildcard harness) ../_harness)
$(if $(wildcard $(HARNESS)/harness.mk),,$(error No harness at '$(HARNESS)'. Copy c64-kb's templates/_harness to ./harness, or make the project with npm run new-project in c64-kb))
include $(HARNESS)/harness.mk

# ---- tearcheck: the scroll never shows a torn picture -------------------------------
# Sixteen shots a model from 5,000,000 cycles (the first play frames) in steps
# of 977,777 (no whole number of frames on either model, so the beam lands on
# a different line each time), each matched against a render of the level.
# Then the TEAR_DEMO build, which shifts the page on display in place, must
# fail the same check: proof that the check can see a tear.
TEAR_CYCLES := $(shell $(PYTHON) -c "print(' '.join(str(5000000 + 977777 * i) for i in range(16)))")
# The TEAR_DEMO build tears only in the frames of a column crossing, so it
# gets three times the shots: one torn shot of 32 was all the first list
# found after a timing change.
TEAR_DEMO_CYCLES := $(shell $(PYTHON) -c "print(' '.join(str(5000000 + 311111 * i) for i in range(48)))")
PRG_TEAR := build/$(NAME)-tear.prg
$(PRG_TEAR): $(C_DEPS) $(ASM_OUT) $(METER_DEPS) | plan-gate
	@mkdir -p build
	$(OSCAR64_BUILD) -d$(AUTOPILOT_DEFINE)=1 -dTEAR_DEMO=1 -o=$@ $(C_MAIN)

.PHONY: tearcheck
tearcheck: $(PRG_AUTO) $(PRG_TEAR)
	$(PYTHON) tools/tearcheck.py --x64sc $(X64SC) --harness $(HARNESS_DIR) --src src --expect whole $(PRG_AUTO) $(TEAR_CYCLES)
	$(PYTHON) tools/tearcheck.py --x64sc $(X64SC) --harness $(HARNESS_DIR) --src src --expect torn $(PRG_TEAR) $(TEAR_DEMO_CYCLES)

# make drive and drivetest read the HUD page's rows 21-24 (src/game.h HUDPAGE).
# drivetest: the normal build, stick on $DC00: fire on the title starts a game.
DRIVE_SCREEN := C800:21-24
DRIVE_STEPS  := "until:PRESS FIRE" tap:fire "until:LIVES 3" hold:right "until:GAME OVER" print

# ---- stage: the worst frame with every enemy slot full ------------------------------
# STAGE_CROWD puts ten enemies in the first view (src/level.c), so all five
# slots are live from the first play frame; the autopilot runs as usual and
# grades only late frames. stage-expect.json wants the meter's worst inside
# one frame on each model.
PRG_STAGE := build/$(NAME)-stage.prg
$(PRG_STAGE): $(C_DEPS) $(ASM_OUT) $(METER_DEPS) | plan-gate
	@mkdir -p build
	$(OSCAR64_BUILD) -d$(AUTOPILOT_DEFINE)=1 -dSTAGE_CROWD=1 -o=$@ $(C_MAIN)

.PHONY: stage
stage: $(PRG_STAGE) $(PIN_PAL) $(PIN_NTSC)
	$(call vice_shot,$(PRG_STAGE),$(SHOT_CYCLES_PAL),,shots/stage-pal.png)
	$(call vice_shot,$(PRG_STAGE),$(SHOT_CYCLES_NTSC),-model ntsc,shots/stage-ntsc.png)
	$(PYTHON) $(HARNESS_DIR)/check.py stage-expect.json shots/stage-pal.png shots/stage-ntsc.png
