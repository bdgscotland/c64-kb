# shmup-vertical: a vertically scrolling shoot-em-up starter. Every target
# but phases, stage and joy comes from the harness:
#   make            build build/shmup-vertical.prg (after the PLAN.md gate)
#   make run        windowed VICE, joystick in port 2
#   make shot       headless PAL and NTSC exit screenshots of the autopilot build
#   make check      make phases, then grade shots/pal.png and shots/ntsc.png against expect.json
#   make phases     the panel split frozen on each of the eight YSCROLL phases, PAL and NTSC,
#                   compared with the graded phase-3 shot (tools/phases.py)
#   make selftest   prove check fails on the FORCE_FAULT=1 build
#   make stage      the heaviest frame the game makes (-dSTAGE=1): the meter's readout, PAL and NTSC
#   make joy        the normal game reading its port byte from $02FE, for tools/drive.py
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
# HISCORE on build/shmup-vertical.d64. A pin that lands inside a write leaves
# a splat file there; the program scratches and rewrites one (drive reply 60).
SHOT_DISK := 1

# What the program may write, for make claims, found by claims-watch on the
# autopilot build (30,000,000 cycles, drive 8 attached). zero_page $02-$56:
# Oscar64's registers ($02-$52) and main's callee-saved temporaries, which
# reached $56 in this build ($55 before the review's fixes grew main); a
# bigger main reaches further. The $DC0D stores
# that mask CIA1 count against all its units. The KERNAL routines are the
# disk calls of src/hiscore.c (kernalio.h) and the KERNAL IRQ that runs
# during the first load. CIA2 timers A and B are the frame meter's.
CLAIMS_ARGS = --cycles 30000000 --disk $(abspath $(D64)) \
  --claim 'zero_page $$02-$$56, sprite_0-7, vic_raster_irq, irq_vector_fffe, nmi_vector_fffa, sid_voice_1-3, sid_filter_volume, cia1_port_a, cia1_timer_a, cia1_timer_b, cia1_tod, cia2_vic_bank' \
  --range 'colour=$$D800-$$DBE7,result=$$02FF' \
  --harness 'cia2_timer_a, cia2_timer_b, cia2_tod' \
  --kernal 'SETNAM,SETLFS,OPEN,CLOSE,CHKIN,CHKOUT,CLRCHN,CHRIN,CHROUT,READST,IRQ'

# The harness sits beside the starter in c64-kb (../_harness) or is vendored
# into ./harness when the starter is copied out on its own.
# Proof targets `npm run verify:templates -- --selftest` runs after selftest.
VERIFY_TARGETS := stage

HARNESS ?= $(firstword $(wildcard harness) ../_harness)
$(if $(wildcard $(HARNESS)/harness.mk),,$(error No harness at '$(HARNESS)'. Copy c64-kb's templates/_harness to ./harness, or make the project with npm run new-project in c64-kb))
include $(HARNESS)/harness.mk

# claims runs the autopilot build with the disk attached.
claims: $(D64)

# ---- phases: the split at every YSCROLL phase ----------------------------------------
# The graded shot freezes on YSCROLL 3 only, so a broken entry in the split's
# delay table (kernel.asm delay_tbl) for any other phase passes make shot
# check. Each build here freezes on one phase; tools/phases.py shoots all
# eight on both models and wants panel lines 215-250 identical to phase 3.
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
# -dSTAGE=1 plays a script that puts 12 enemies, bolts and a kill in the same
# frames and meters play frames 150-399. Its verdict is not graded; the
# meter's readout is printed. Re-run it after adding work to a frame.
PRG_STAGE := build/$(NAME)-stage.prg
$(PRG_STAGE): $(C_DEPS) $(ASM_OUT) $(METER_DEPS) | plan-gate
	@mkdir -p build
	$(OSCAR64_BUILD) -d$(AUTOPILOT_DEFINE)=1 -dSTAGE=1 -o=$@ $(C_MAIN)

.PHONY: stage
stage: $(PRG_STAGE) $(D64)
	$(call vice_shot,$(PRG_STAGE),40000000,,shots/stage-pal.png)
	$(call vice_shot,$(PRG_STAGE),40000000,-model ntsc,shots/stage-ntsc.png)
	$(PYTHON) tools/meter.py $(HARNESS_DIR) shots/stage-pal.png pal shots/stage-ntsc.png ntsc

# ---- joy: the normal game driven headless ------------------------------------------
# The port byte comes from $02FE instead of $DC00, so a VICE monitor can
# drive it (tools/drive.py).
PRG_JOY := build/$(NAME)-joy.prg
$(PRG_JOY): $(C_DEPS) $(ASM_OUT) $(METER_DEPS) | plan-gate
	@mkdir -p build
	$(OSCAR64_BUILD) -dJOY_SOURCE=0x02fe -o=$@ $(C_MAIN)

.PHONY: joy
joy: $(PRG_JOY)
