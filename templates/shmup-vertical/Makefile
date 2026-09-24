# shmup-vertical: a vertically scrolling shoot-em-up starter. Every target
# but phases, stage, gameover, joytest and longplay comes from the harness:
#   make            build build/shmup-vertical.prg (after the PLAN.md gate)
#   make run        windowed VICE, joystick in port 2
#   make shot       headless PAL and NTSC exit screenshots of the autopilot build
#   make check      make phases, then grade shots/pal.png and shots/ntsc.png against expect.json
#   make phases     the panel split frozen on each of the eight YSCROLL phases, PAL and NTSC,
#                   compared with the graded phase-3 shot (tools/phases.py)
#   make selftest   prove check fails on the FORCE_FAULT=1 build
#   make stage      the heaviest frame the game makes (-dSTAGE=1): the meter's readout, PAL and NTSC
#   make gameover   the AP_GIVE_UP=1 build: three ships go, and the title after GAME OVER
#                   must show no sprite; graded by expect-gameover.json
#   make drive      the normal game played headless (harness/drive.py), stick on $DC00
#   make joytest    the normal game played to GAME OVER and rebooted: the saved HI must show
#   make longplay   a -dGOD=1 build played through the level's later loops, on lost frames
#   make disk       build/shmup-vertical.d64
#   make claims     c64-kb's claims-watch over the autopilot build, when available
#   make clean
NAME     := shmup-vertical
C_MAIN   := src/main.c
KICK_SRC := src/kernel.asm

# Pinned after the verdict. Its disk round trip ends with the $02FF store at
# about 21,700,000 cycles (PAL) and 21,600,000 (NTSC), under the VICE monitor
# on a fresh disk. After it nothing on screen changes: PAL at 30,000,000 and
# 34,000,000 cycles and NTSC at 30,000,000 and 36,000,000 gave byte-identical
# pictures.
SHOT_CYCLES_PAL  := 30000000
SHOT_CYCLES_NTSC := 30000000

# Drive 8 is attached during make shot: the autopilot writes and reads
# HISCORE on a fresh copy of build/shmup-vertical.d64 each run (the harness).
# A save cut off leaves a splat file; the program scratches and rewrites one
# (drive reply 60).
SHOT_DISK := 1

# What the program may write, for make claims, found by claims-watch on the
# autopilot build (30,000,000 cycles, drive 8 attached). zero_page $02-$56:
# Oscar64's registers ($02-$52) and main's callee-saved temporaries, which
# reached $56 in this build ($55 before the review's fixes grew main); a
# bigger main reaches further. The $DC0D stores
# that mask CIA1 count against all its units. The KERNAL routines are the
# disk calls of src/hiscore.c (kernalio.h) and the KERNAL IRQ that runs
# during the first load. CIA2 timers A and B are the frame meter's. $02FD
# is LOST_FRAMES (main.c), which make joytest reads. The frame and split IRQs
# write $D011 (YSCROLL, the river's row phase) and $D018 (the front screen
# and the panel's), and hold_screen sets $D018.
CLAIMS_ARGS = --cycles 30000000 --disk $(abspath $(D64)) \
  --claim 'zero_page $$02-$$56, sprite_0-7, vic_raster_irq, vic_yscroll, vic_matrix_base, vic_char_base, irq_vector_fffe, nmi_vector_fffa, sid_voice_1-3, sid_filter_volume, cia1_port_a, cia1_timer_a, cia1_timer_b, cia1_tod, cia2_vic_bank' \
  --range 'colour=$$D800-$$DBE7,result=$$02FF,lost_frames=$$02FD' \
  --harness 'cia2_timer_a, cia2_timer_b, cia2_tod' \
  --kernal 'SETNAM,SETLFS,OPEN,CLOSE,CHKIN,CHKOUT,CLRCHN,CHRIN,CHROUT,READST,IRQ'

# The harness sits beside the starter in c64-kb (../_harness) or is vendored
# into ./harness when the starter is copied out on its own.
# Proof targets `npm run verify:templates -- --selftest` runs after selftest.
VERIFY_TARGETS := stage gameover joytest longplay

# make watch (in make check): the player writes the SID. The autopilot run
# stored to it in 731 frames on PAL and 650 on NTSC; without the IRQ's
# music_play (NO_PLAYER) 1 and 1 (harness/watch.py, VICE x64sc 3.10).
SID_FRAMES := 300

HARNESS ?= $(firstword $(wildcard harness) ../_harness)
$(if $(wildcard $(HARNESS)/harness.mk),,$(error No harness at '$(HARNESS)'. Copy c64-kb's templates/_harness to ./harness, or make the project with npm run new-project in c64-kb))
include $(HARNESS)/harness.mk

# claims runs the autopilot build with the disk attached.
claims: $(D64)

# ---- phases: the split at every YSCROLL phase ----------------------------------------
# The graded shot freezes on YSCROLL 3 only, so a broken entry in the split's
# delay table (kernel.asm delay_tbl) for any other phase passes make shot
# check. Each build here freezes on one phase; tools/phases.py shoots all
# eight on both models and wants panel lines 207-246 identical to phase 3.
PHASES := 0 1 2 3 4 5 6 7
PRG_PHASES := $(foreach k,$(PHASES),build/$(NAME)-ph$(k).prg)
build/$(NAME)-ph%.prg: $(C_DEPS) $(ASM_OUT) $(METER_DEPS) | plan-gate
	@mkdir -p build
	$(OSCAR64_BUILD) -d$(AUTOPILOT_DEFINE)=1 -dFREEZE_Y=$* -o=$@ $(C_MAIN)

.PHONY: phases
phases: $(PRG_PHASES) $(D64)
	$(PYTHON) tools/phases.py --x64sc $(X64SC) --d64 $(D64) --pal $(SHOT_CYCLES_PAL) --ntsc $(SHOT_CYCLES_NTSC) $(PRG_PHASES)

check: phases

# ---- stage: the heaviest frame ------------------------------------------------------
# -dSTAGE=1 plays a script that puts 12 enemies, bolts, enemy dots and a kill
# in the same frames and meters play frames 150-399. Its verdict grades no
# overrun and every bullet cell restored; stage-expect.json adds the meter's
# worst inside a frame on both models. STAGE_DEFS='-dSD=24 -dSX=16' moves
# the script (the worst of a 4 x 4 sweep; see PLAN.md). Re-run it after
# adding work to a frame.
STAGE_DEFS ?= -dSD=24 -dSX=16
PRG_STAGE := build/$(NAME)-stage.prg
$(PRG_STAGE): $(C_DEPS) $(ASM_OUT) $(METER_DEPS) $(STARTER_MAKEFILE) | plan-gate
	@mkdir -p build
	$(OSCAR64_BUILD) -d$(AUTOPILOT_DEFINE)=1 -dSTAGE=1 $(STAGE_DEFS) -o=$@ $(C_MAIN)

.PHONY: stage
stage: $(PRG_STAGE) $(D64)
	$(call vice_shot,$(PRG_STAGE),40000000,,shots/stage-pal.png)
	$(call vice_shot,$(PRG_STAGE),40000000,-model ntsc,shots/stage-ntsc.png)
	$(PYTHON) tools/meter.py $(HARNESS_DIR) shots/stage-pal.png pal shots/stage-ntsc.png ntsc
	$(PYTHON) $(HARNESS_DIR)/check.py stage-expect.json shots/stage-pal.png shots/stage-ntsc.png

# ---- drive, joytest, longplay: the normal game played headless ---------------------
# harness/drive.py presses the stick on the real $DC00 and counts time in
# emulated frames. The text is on the two playfield screens and the panel.
DRIVE_SCREEN := 8000:0-20,8400:0-20,8800:20-22

# joytest: the normal build played on PAL and NTSC, fire held and the ship
# swept, to GAME OVER; its save, and a reboot on the same fresh disk showing
# that score as HI; then JOYTEST_SOAK more games a model, each graded on
# LOST_FRAMES (tools/joytest.py). Any lost frame fails.
JOYTEST_SOAK ?= 15
.PHONY: joytest
joytest: $(PRG) $(D64)
	X64SC=$(X64SC) $(PYTHON) tools/joytest.py $(PRG) $(D64) --harness $(HARNESS_DIR) --soak $(JOYTEST_SOAK)

# longplay: a build whose ship is never lost (-dGOD=1), so fire held and a
# sweep run through the level's later loops, where the waves come closer
# together: LONGPLAY_GAMES games a model at once, LONGPLAY_SECONDS of
# emulated time each, and any lost frame fails.
LONGPLAY_SECONDS ?= 740
LONGPLAY_GAMES ?= 4
PRG_GOD := build/$(NAME)-god.prg
$(PRG_GOD): $(C_DEPS) $(ASM_OUT) $(METER_DEPS) | plan-gate
	@mkdir -p build
	$(OSCAR64_BUILD) -dGOD=1 -o=$@ $(C_MAIN)

.PHONY: longplay
longplay: $(PRG_GOD) $(D64)
	X64SC=$(X64SC) $(PYTHON) tools/joytest.py $(PRG_GOD) $(D64) --harness $(HARNESS_DIR) --long $(LONGPLAY_SECONDS) --soak $$(( $(LONGPLAY_GAMES) - 1 )) --jobs $(LONGPLAY_GAMES)

# ---- gameover: the picture after game over is the title ------------------------------
# The AP_GIVE_UP=1 build plays LOOP_TEST's script (fire held, the ship never
# moves): three ships go, GAME OVER saves the high score to the disk, the
# title comes back, and fifty frames later the program checks the title
# (main.c, grade_gameover): no sprite shown, $D015 = 0, the title text, the
# high score. Graded before 30,000,000 cycles on both models; the pins are past it.
PRG_OVER := build/$(NAME)-over.prg
GAMEOVER_PAL  := 40000000
GAMEOVER_NTSC := 40000000
$(PRG_OVER): $(C_DEPS) $(ASM_OUT) $(METER_DEPS) | plan-gate
	@mkdir -p build
	$(OSCAR64_BUILD) -d$(AUTOPILOT_DEFINE)=1 -dAP_GIVE_UP=1 -o=$@ $(C_MAIN)

.PHONY: gameover
gameover: $(PRG_OVER) $(D64)
	$(call vice_shot,$(PRG_OVER),$(GAMEOVER_PAL),,shots/over-pal.png)
	$(call vice_shot,$(PRG_OVER),$(GAMEOVER_NTSC),-model ntsc,shots/over-ntsc.png)
	$(PYTHON) $(HARNESS_DIR)/check.py expect-gameover.json shots/over-pal.png shots/over-ntsc.png
