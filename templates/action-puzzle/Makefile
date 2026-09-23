# action-puzzle: CAVE RUN, a Boulder Dash-style starter. Harness targets:
#   make            build build/action-puzzle.prg (after the PLAN.md gate)
#   make run        windowed VICE, joystick in port 2
#   make shot       headless PAL and NTSC exit screenshots of the autopilot build
#   make check      grade shots/pal.png and shots/ntsc.png against expect.json
#   make selftest   prove check fails on the FORCE_FAULT=1 build
#   make disk       build/action-puzzle.d64
#   make claims     c64-kb's claims-watch over the autopilot build, when available
# and this starter's own:
#   make gen        re-run tools/gen.py (caves, script, model, note table)
#   make disktest   the high-score save on a true-drive 1541: save, cold start, load, show
#   make clean
NAME   := action-puzzle
C_MAIN := src/main.c

# Pinned after the verdict. The autopilot plays 140 frames, enters a name and
# grades itself at about frame 330 from its start; from then on nothing on the
# screen changes, so any pin after it gives the same picture (two pins per
# model were compared; see README.md).
SHOT_CYCLES_PAL  := 16000000
SHOT_CYCLES_NTSC := 16000000

# What the program may write, for make claims (claims-watch's grammar).
# zero_page $02-$52 is Oscar64's register block, as in hello; $53-$55 is the
# start of its BC_REG_TMP_SAVED block (MachineTypes.cpp), which this
# program's larger functions use (claims-watch found 902 stores there on
# the first run). --kernal names the routines hiscore.c calls through
# kernalio.h and the KERNAL IRQ, which runs during those calls only.
CLAIMS_ARGS := --cycles 16000000 --kernal SETLFS,SETNAM,OPEN,CLOSE,CHKIN,CHKOUT,CLRCHN,CHRIN,CHROUT,READST,IRQ --claim 'sid_voice_1, sid_voice_2, sid_voice_3, sid_filter_volume, cia1_port_a, cia1_timer_b, zero_page $$02-$$55' --range 'screen=$$0400-$$07FF,colour=$$D800-$$DBFF,charset=$$2000-$$27FF,result=$$02FF' --harness 'cia2_timer_a, cia2_timer_b, cia2_tod'

# The harness sits beside the starter in c64-kb (../_harness) or is vendored
# into ./harness when the starter is copied out on its own.
HARNESS ?= $(firstword $(wildcard harness) ../_harness)
$(if $(wildcard $(HARNESS)/harness.mk),,$(error No harness at '$(HARNESS)'. Copy c64-kb's templates/_harness to ./harness, or make the project with npm run new-project in c64-kb))
include $(HARNESS)/harness.mk

# ---- this starter's own targets ---------------------------------------------------
# tools/gen.py writes the three src/gen_*.h headers; an edit to it rebuilds them.
GEN_OUT := src/gen_caves.h src/gen_autopilot.h src/gen_notes.h
$(GEN_OUT): build/gen.stamp
build/gen.stamp: tools/gen.py
	@mkdir -p build
	$(PYTHON) tools/gen.py
	@touch $@

.PHONY: gen disktest modelcheck
gen:
	$(PYTHON) tools/gen.py

# The disk test: the autopilot build saves its table to a fresh copy of the
# release D64 on a true-drive 1541 (DISK_MODEL=pal or ntsc); then a second, cold VICE boots the
# release PRG from that D64 with LOAD"*",8,1, and it loads the table and shows
# it on the title screen. tools/disk_check.py grades both pictures and the
# file c1541 reads back from the image.
DISKTEST_D64 := build/disktest.d64
DISK_MODEL ?= pal
# PAL is the -default machine: "-model pal" selects a 6569R3 whose palette
# differs from the one check.py matches (border green read (94, 214, 56)).
DISK_VICE = $(TIMEOUT) $(VICE_TIMEOUT) $(X64SC) $(VICE_FLAGS) $(if $(filter ntsc,$(DISK_MODEL)),-model ntsc) -drive8type 1541 -drive8truedrive -drive8wobbleamplitude 0 -drive8wobblefrequency 0
disktest: $(D64) $(PRG_AUTO)
	@mkdir -p shots
	cp $(D64) $(DISKTEST_D64)
	@rm -f shots/disk-save.png shots/disk-load.png
	@$(DISK_VICE) -limitcycles 30000000 -8 $(DISKTEST_D64) -exitscreenshot shots/disk-save.png -autostart $(PRG_AUTO) > shots/disk-save.log 2>&1 || true
	@test -s shots/disk-save.png || { echo "disktest: no picture from the save run; see shots/disk-save.log"; exit 1; }
	$(C1541) -attach $(DISKTEST_D64) -list
	$(C1541) -attach $(DISKTEST_D64) -read "hiscore,s" build/hiscore.seq > /dev/null
	@$(DISK_VICE) -limitcycles 60000000 -exitscreenshot shots/disk-load.png -autostart $(DISKTEST_D64) > shots/disk-load.log 2>&1 || true
	@test -s shots/disk-load.png || { echo "disktest: no picture from the load run; see shots/disk-load.log"; exit 1; }
	$(PYTHON) tools/disk_check.py $(HARNESS_DIR) build/hiscore.seq shots/disk-save.png shots/disk-load.png $(DISK_MODEL)

# Every visible cave cell of both autopilot shots against tools/gen.py's model.
modelcheck: $(SHOTS)
	$(PYTHON) tools/model_check.py $(HARNESS_DIR) shots/pal.png shots/ntsc.png
