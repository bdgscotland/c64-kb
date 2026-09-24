# platformer: the side-scrolling platformer starter. Every target but
# tearcheck, stage and gameover comes from the harness:
#   make            build build/platformer.prg (after the PLAN.md gate)
#   make run        windowed VICE, joystick in port 2
#   make shot       headless PAL and NTSC exit screenshots of the autopilot build
#   make check      grade shots/pal.png and shots/ntsc.png against expect.json
#   make selftest   prove check fails on the FORCE_FAULT=1 build
#   make tearcheck  shoot the autopilot run mid-scroll and match every picture
#                   against a render of the level (tools/tearcheck.py); then
#                   prove the check fails on the TEAR_DEMO=1 build
#   make gameover   the AP_GIVE_UP=1 build: three lives go, and the title after
#                   GAME OVER must be clean; graded by expect-gameover.json
#   make drive      the normal game played headless (harness/drive.py; README "Driving it headless")
#   make gallery    shots/gallery.png: the normal game in play, for a README (GALLERY_SCRIPT)
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
#   reach $54: T1 is the word at $53-$54 (BC_REG_TMP_SAVED in its
#   MachineTypes.cpp), and main+250 stores the frame count's high byte in
#   $54 every frame (build/platformer-auto.asm; make zp lists $43-$54).
#   An earlier version declared $02-$53 and said main stopped at $53.
# - The engine writes $D016 (XSCROLL) and $D018 (matrix and character base)
#   at its splits, and view_init sets both.
# - The KERNAL's IRQ runs until main's SEI, so IRQ is declared.
# - $DC0D (all CIA1 interrupts off) counts against the three CIA1 units;
#   the meter's $DD0D against CIA2's three, declared as the harness's, and
#   so is WORK_BEGIN and WORK_END's byte, $02FE (make watch).
# - The whole run, title to verdict, is traced (--cycles, the PAL pin).
CLAIMS_ARGS := --claim 'sprite_0, sprite_1, sprite_2, sprite_3, sprite_4, sprite_5, sprite_6, sprite_7, vic_raster_irq, vic_xscroll, vic_matrix_base, vic_char_base, irq_vector_fffe, nmi_vector_fffa, cia2_vic_bank, cia1_port_a, cia1_timer_a, cia1_timer_b, cia1_tod, sid_voice_1, sid_voice_2, sid_voice_3, sid_filter_volume, zero_page $$02-$$54' --range 'colour=$$D800-$$DBFF,result=$$02FF' --harness 'cia2_timer_a, cia2_timer_b, cia2_tod, work_mark=$$02FE' --kernal IRQ --cycles 26000000

# The harness sits beside the starter in c64-kb (../_harness) or is vendored
# into ./harness when the starter is copied out on its own.
# Proof targets `npm run verify:templates -- --selftest` runs after selftest.
VERIFY_TARGETS := tearcheck stage gameover drivetest

# make watch (in make check): the player writes the SID. The autopilot run
# stored to it in 360 frames on PAL and 373 on NTSC; without the tune and
# sfx_update (NO_PLAYER) 14 and 14 (harness/watch.py, VICE x64sc 3.10).
SID_FRAMES := 180
# ... and every play frame's work, WORK_BEGIN after the line-251 tick to
# WORK_END after view_publish, ends before the next line 251, where the
# engine applies the published page and XSCROLL. Measured: the least to
# spare 100 lines on PAL, 50 on NTSC. OVERRUN=1 ends one in 64 on line 252.
DEADLINE_LINE := 251

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

# make gallery: shots/gallery.png, the normal build in play. The autopilot's
# opening played by hand: over the coins and the hill, a jump straight up,
# and the picture 10 frames later, above the walker it is about to stomp.
GALLERY_SCRIPT := "until:PRESS FIRE" hold:fire wait:1 hold:none wait:4 "until:LIVES 3" \
  hold:right wait:100 hold:none wait:31 hold:fire wait:1 hold:none wait:10

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

# ---- gameover: the picture after game over is the title ------------------------------
# The AP_GIVE_UP=1 build holds right from the first frame of play, so three
# lives go; GAME OVER times out, the title comes back, and fifty frames later
# the program checks the title (verdict.h, grade_gameover): no sprite
# enabled, the title text, the high score, no play HUD left. The pins are
# past that point on each model.
PRG_OVER := build/$(NAME)-over.prg
GAMEOVER_PAL  := 40000000
GAMEOVER_NTSC := 40000000
$(PRG_OVER): $(C_DEPS) $(ASM_OUT) $(METER_DEPS) | plan-gate
	@mkdir -p build
	$(OSCAR64_BUILD) -d$(AUTOPILOT_DEFINE)=1 -dAP_GIVE_UP=1 -o=$@ $(C_MAIN)

.PHONY: gameover
gameover: $(PRG_OVER)
	$(call vice_shot,$(PRG_OVER),$(GAMEOVER_PAL),,shots/over-pal.png)
	$(call vice_shot,$(PRG_OVER),$(GAMEOVER_NTSC),-model ntsc,shots/over-ntsc.png)
	$(PYTHON) $(HARNESS_DIR)/check.py expect-gameover.json shots/over-pal.png shots/over-ntsc.png
