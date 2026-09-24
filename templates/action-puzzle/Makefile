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
#   make disktest   the high-score save on a true-drive 1541: save, save over it, cold start, load
#   make modelcheck every visible cave cell of the shots against tools/gen.py's model
#   make drive      the normal game played headless: make drive STEPS='"until:FIRE TO START" tap:fire print'
#   make clean
NAME   := action-puzzle
C_MAIN := src/main.c

# Pinned after the verdict, which follows the save and its read-back on the
# shot's fresh disk. Measured with VICE x64sc 3.10: at 18,000,000 cycles the
# save is still running on both models; at 20,000,000, 24,000,000 and
# 30,000,000 the picture is byte-identical, PAL and NTSC.
SHOT_CYCLES_PAL  := 24000000
SHOT_CYCLES_NTSC := 24000000

# Every headless shot attaches its own fresh copy of the release D64 (the
# harness makes it), so the autopilot saves its table and reads it back.
SHOT_DISK := 1

# What the program may write, for make claims (claims-watch's grammar).
# zero_page $02-$52 is Oscar64's register block, as in hello; $53-$55 is the
# start of its BC_REG_TMP_SAVED block (MachineTypes.cpp), which this
# program's larger functions use (claims-watch found 902 stores there on
# the first run). --kernal names the routines hiscore.c calls through
# kernalio.h and the KERNAL IRQ, which runs during those calls only.
# vic_raster_irq: wait_frame sets the compare line and acknowledges the
# $D019 latch to count dropped frames; the interrupt itself stays disabled.
# vic_char_base: render_init points $D018 at the charset at $2000.
CLAIMS_ARGS := --cycles 24000000 --kernal SETLFS,SETNAM,OPEN,CLOSE,CHKIN,CHKOUT,CLRCHN,CHRIN,CHROUT,READST,IRQ --claim 'sid_voice_1, sid_voice_2, sid_voice_3, sid_filter_volume, cia1_port_a, cia1_timer_b, vic_raster_irq, vic_char_base, zero_page $$02-$$55' --range 'screen=$$0400-$$07FF,colour=$$D800-$$DBFF,charset=$$2000-$$27FF,result=$$02FF' --harness 'cia2_timer_a, cia2_timer_b, cia2_tod'

# The harness sits beside the starter in c64-kb (../_harness) or is vendored
# into ./harness when the starter is copied out on its own.
# Proof targets `npm run verify:templates -- --selftest` runs after selftest.
VERIFY_TARGETS := disktest modelcheck selftest-scan drivetest

# make drivetest: the normal build (no autopilot) played through harness/drive.py
# with the stick on $DC00: fire on the title starts cave 1, and holding right
# digs to a gem.
DRIVE_STEPS := "until:FIRE TO START" tap:fire "until:LIVES" hold:right "until:GEMS 01/06" print

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

# The disk test, on a true-drive 1541 (DISK_MODEL=pal or ntsc):
#  1. the autopilot build runs against a fresh copy of the release D64: no
#     file (62), it plays, saves (scratch, then write) and shows SAVED (00);
#  2. it runs again on the same D64: it loads that file, its score ties row 4
#     and goes in row 5, and the save must replace the file (without the
#     scratch the drive answers 63, FILE EXISTS). Its verdict is red by
#     design: the table it started from is not the default one;
#  3. a cold VICE boots the release PRG from the D64 with LOAD"*",8,1; it
#     loads the table and shows it on the title screen.
# tools/disk_check.py grades the three pictures, both files c1541 read back,
# and the directory (one HISCORE entry).
DISKTEST_D64 := build/disktest.d64
DISK_MODEL ?= pal
# PAL is the -default machine: "-model pal" selects a 6569R3 whose palette
# differs from the one check.py matches (border green read (94, 214, 56)).
DISK_VICE = $(TIMEOUT) $(VICE_TIMEOUT) $(X64SC) $(VICE_FLAGS) $(if $(filter ntsc,$(DISK_MODEL)),-model ntsc) -drive8type 1541 -drive8truedrive -drive8wobbleamplitude 0 -drive8wobblefrequency 0
# $(1) = the picture's name, $(2) = cycles, $(3) = what to autostart, $(4) = extra flags
define disk_run
	@rm -f shots/$(1).png
	@$(DISK_VICE) -limitcycles $(2) $(4) -exitscreenshot shots/$(1).png -autostart $(3) > shots/$(1).log 2>&1 || true
	@test -s shots/$(1).png || { echo "disktest: no picture from the $(1) run; see shots/$(1).log"; exit 1; }
endef
disktest: $(D64) $(PRG_AUTO)
	@mkdir -p shots
	cp $(D64) $(DISKTEST_D64)
	$(call disk_run,disk-save,30000000,$(PRG_AUTO),-8 $(DISKTEST_D64))
	$(C1541) -attach $(DISKTEST_D64) -read "hiscore,s" build/hiscore-1.seq > /dev/null
	$(call disk_run,disk-save2,30000000,$(PRG_AUTO),-8 $(DISKTEST_D64))
	$(C1541) -attach $(DISKTEST_D64) -read "hiscore,s" build/hiscore-2.seq > /dev/null
	$(C1541) -attach $(DISKTEST_D64) -list > build/disktest-dir.txt 2>/dev/null
	$(call disk_run,disk-load,60000000,$(DISKTEST_D64),)
	$(PYTHON) tools/disk_check.py $(HARNESS_DIR) build $(DISK_MODEL)

# The scanned bit's self-test: the autopilot built with SCAN_FLAG=0 (the
# cave-scan recipe's double-move bug) must fail check.py and name E in its
# verdict, the test that the scan meets the living player once a cave frame.
PRG_NOSCAN := build/$(NAME)-noscan.prg
$(PRG_NOSCAN): $(C_DEPS) $(METER_DEPS) | plan-gate
	@mkdir -p build
	$(OSCAR64_BUILD) -d$(AUTOPILOT_DEFINE)=1 -dSCAN_FLAG=0 -o=$@ $(C_MAIN)
shots/noscan-pal.png: $(PRG_NOSCAN) $(PIN_PAL) $(SHOT_DEPS)
	$(call vice_shot,$(PRG_NOSCAN),$(SHOT_CYCLES_PAL),,$@)
shots/noscan-ntsc.png: $(PRG_NOSCAN) $(PIN_NTSC) $(SHOT_DEPS)
	$(call vice_shot,$(PRG_NOSCAN),$(SHOT_CYCLES_NTSC),-model ntsc,$@)
.PHONY: selftest-scan
selftest-scan:
	@rm -f shots/noscan-pal.png shots/noscan-ntsc.png
	@$(MAKE) --no-print-directory shots/noscan-pal.png shots/noscan-ntsc.png
	@$(PYTHON) $(HARNESS_DIR)/check.py expect.json shots/noscan-pal.png shots/noscan-ntsc.png > shots/noscan-check.txt 2>&1; st=$$?; \
	if [ $$st -ne 1 ]; then cat shots/noscan-check.txt; echo "selftest-scan: FAIL, check.py exit $$st on the SCAN_FLAG=0 build"; exit 1; fi
	@$(PYTHON) tools/verdict_codes.py $(HARNESS_DIR) shots/noscan-pal.png pal E
	@$(PYTHON) tools/verdict_codes.py $(HARNESS_DIR) shots/noscan-ntsc.png ntsc E
	@echo "selftest-scan: PASS, the SCAN_FLAG=0 build failed, E among its letters"

# Every visible cave cell of both autopilot shots against tools/gen.py's model.
modelcheck: $(SHOTS)
	$(PYTHON) tools/model_check.py $(HARNESS_DIR) shots/pal.png shots/ntsc.png
