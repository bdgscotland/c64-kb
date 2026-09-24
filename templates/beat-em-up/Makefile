# beat-em-up: the side-on brawler starter. Every target but flickercheck
# and gameover comes from the harness:
#   make              build build/beat-em-up.prg (after the PLAN.md gate)
#   make run          windowed VICE, joystick in port 2
#   make shot         headless PAL and NTSC exit screenshots of the autopilot build
#   make check        grade shots/pal.png and shots/ntsc.png against expect.json
#   make selftest     prove check fails on the FORCE_FAULT=1 build
#   make flickercheck shoot the autopilot run inside its three photo stops and
#                     match the fighter band pixel for pixel against a render
#                     of the fighters the program printed (tools/flickercheck.py);
#                     then prove the check fails on the FLICKER_DEMO=1 build
#   make gameover     the AP_GIVE_UP=1 build: the bot never fights, three lives
#                     go, GAME OVER shows; graded by expect-gameover.json
#   make drive        the normal game played headless (harness/drive.py; README "Driving it headless")
#   make disk         build/beat-em-up.d64
#   make claims       c64-kb's claims-watch over the autopilot build
#   make clean
NAME     := beat-em-up
C_MAIN   := src/main.c
KICK_SRC := src/engine.asm

# Pinned after the verdict (graded before 100M cycles on both models), where
# nothing on the screen changes: 120M and 130M gave identical PAL pictures,
# 110M and 130M identical NTSC ones (VICE x64sc 3.10).
SHOT_CYCLES_PAL  := 120000000
SHOT_CYCLES_NTSC := 110000000

# What the program may write, for make claims (claims-watch's own grammar).
# - Oscar64's registers start at $02 (BC_REG_WORK_Y). A function with more
#   temporaries than BC_REG_TMP ($43) to BC_REG_TMP_SAVED ($53) spills
#   past $53 (its InterCode.cpp, AddSpace). Measured by claims-watch:
#   $54-$5F (view_sprites, vic_compare, vic_expect) and $60 (grade, in the
#   AUTOPILOT build); the first draft used $54-$56. $61-$6F is headroom for
#   the next such edit; nothing else lives there.
# - The IRQ chain writes $D016 (XSCROLL) and $D018 (matrix and character
#   base) at its splits, and view_init sets both.
# - The KERNAL's IRQ runs until main's SEI, so IRQ is declared.
# - $DC0D (all CIA1 interrupts off) counts against the three CIA1 units.
# - CIA2 timer A is the harness meter's; timer B times the IRQs for the
#   meter (engine.asm); the $DD0D stores count against all three CIA2
#   units, so all three are declared as the harness's.
# - The whole run, title to verdict, is traced (--cycles, the PAL pin).
CLAIMS_ARGS := --claim 'sprite_0, sprite_1, sprite_2, sprite_3, sprite_4, sprite_5, sprite_6, sprite_7, vic_raster_irq, vic_xscroll, vic_matrix_base, vic_char_base, irq_vector_fffe, nmi_vector_fffa, cia2_vic_bank, cia1_port_a, cia1_timer_a, cia1_timer_b, cia1_tod, sid_voice_1, sid_voice_2, sid_voice_3, sid_filter_volume, zero_page $$02-$$6F' --range 'colour=$$D800-$$DBFF,result=$$02FF' --harness 'cia2_timer_a, cia2_timer_b, cia2_tod' --kernal IRQ --cycles 120000000

# This starter's own proofs, which npm run verify:templates runs too.
VERIFY_TARGETS := flickercheck gameover drivetest

# The harness sits beside the starter in c64-kb (../_harness) or is vendored
# into ./harness when the starter is copied out on its own.
HARNESS ?= $(firstword $(wildcard harness) ../_harness)
$(if $(wildcard $(HARNESS)/harness.mk),,$(error No harness at '$(HARNESS)'. Copy c64-kb's templates/_harness to ./harness, or make the project with npm run new-project in c64-kb))
include $(HARNESS)/harness.mk

# ---- flickercheck: every fighter part is on the screen in the crowded moments ----
# Two pins inside each of the three photo stops (src/verdict.h), found by
# scanning the run; a stop is 64 frames, about 1.26M cycles on PAL and
# 1.09M on NTSC. A changed AI, wave or art moves the stops: re-scan with
# `-dDEBUG_AT=n` builds or shots, and re-pin.
FLICKER_PAL  := 34200000 34700000 44250000 44750000 80700000 81200000
FLICKER_NTSC := 30600000 31100000 42900000 43400000 78700000 78950000
PRG_FLICKER := build/$(NAME)-flicker.prg
$(PRG_FLICKER): $(C_DEPS) $(ASM_OUT) $(METER_DEPS) | plan-gate
	@mkdir -p build
	$(OSCAR64_BUILD) -d$(AUTOPILOT_DEFINE)=1 -dFLICKER_DEMO=1 -o=$@ $(C_MAIN)

FLICKER = $(PYTHON) tools/flickercheck.py --x64sc $(X64SC) --src src
.PHONY: flickercheck
flickercheck: $(PRG_AUTO) $(PRG_FLICKER)
	$(FLICKER) --expect whole --model pal $(PRG_AUTO) $(FLICKER_PAL)
	$(FLICKER) --expect whole --model ntsc $(PRG_AUTO) $(FLICKER_NTSC)
	$(FLICKER) --expect dropped --model pal $(PRG_FLICKER) $(FLICKER_PAL)

# ---- gameover: the game reaches GAME OVER, and the message is whole -----------------
# The AP_GIVE_UP=1 build presses fire on the title and never fights; the
# program checks the HUD a second into GAME OVER and freezes (verdict.h,
# grade_gameover). The pins are past that point on each model.
PRG_OVER := build/$(NAME)-over.prg
GAMEOVER_PAL  := 60000000
GAMEOVER_NTSC := 55000000
$(PRG_OVER): $(C_DEPS) $(ASM_OUT) $(METER_DEPS) | plan-gate
	@mkdir -p build
	$(OSCAR64_BUILD) -d$(AUTOPILOT_DEFINE)=1 -dAP_GIVE_UP=1 -o=$@ $(C_MAIN)

.PHONY: gameover
gameover: $(PRG_OVER)
	$(call vice_shot,$(PRG_OVER),$(GAMEOVER_PAL),,shots/over-pal.png)
	$(call vice_shot,$(PRG_OVER),$(GAMEOVER_NTSC),-model ntsc,shots/over-ntsc.png)
	$(PYTHON) $(HARNESS_DIR)/check.py expect-gameover.json shots/over-pal.png shots/over-ntsc.png

# make drive and drivetest read the HUD page's rows 21-24 (src/game.h HUDPAGE).
# drivetest: the normal build, stick on $DC00: fire on the title starts a game.
DRIVE_SCREEN := C800:21-24
DRIVE_STEPS  := "until:PRESS FIRE" tap:fire "until:LIVES 3" "until:LIVES 2" print
