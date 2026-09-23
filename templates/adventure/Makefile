# adventure: STARWATCH, a two-word text adventure. Harness targets:
#   make            build build/adventure.prg (after the PLAN.md gate)
#   make run        windowed VICE: type on the keyboard, SAVE and LOAD to drive 8
#   make shot       headless PAL and NTSC exit screenshots of the autopilot build
#   make check      grade shots/pal.png and shots/ntsc.png against expect.json
#   make selftest   prove check fails on the FORCE_FAULT=1 build
#   make disk       build/adventure.d64
#   make claims     c64-kb's claims-watch over the autopilot build, when available
# and this starter's own:
#   make gen        re-run tools/gen.py (world tables, packed text, pictures, script, model)
#   make disktest   SAVE, a cold reset, LOAD and the same state back, on a true-drive 1541
#   make clean
NAME   := adventure
C_MAIN := src/main.c

# Pinned after the verdict. Measured with VICE x64sc 3.10: see README.md, "The shot pin".
SHOT_CYCLES_PAL  := 18000000
SHOT_CYCLES_NTSC := 18000000

# The shot plays SAVE and LOAD for real: each headless run gets a fresh copy
# of the release D64 (the harness's SHOT_DISK), in a true-drive 1541 (the
# VICE_FLAGS line after the include).
SHOT_DISK := 1

# What the program may write, for make claims (claims-watch's grammar).
# zero_page $02-$57 is what Oscar64's code touches (make zp lists it); $C6 is
# the KERNAL's key count, which the loop and the autopilot write. keyqueue is
# the KERNAL keyboard queue; shiftmode $0291 locks SHIFT + C=. --kernal names
# SCNKEY, which the loop calls every frame, and the file routines save.c calls
# through kernalio.h.
CLAIMS_ARGS := --cycles 18000000 --kernal SCNKEY,SETLFS,SETNAM,OPEN,CLOSE,CHKIN,CHKOUT,CLRCHN,CHRIN,CHROUT,READST --claim 'sid_voice_1, sid_voice_2, sid_filter_volume, cia1_port_a, cia1_timer_a, cia1_timer_b, cia1_tod, zero_page $$02-$$57+$$C6' --range 'keyqueue=$$0277-$$0280,shiftmode=$$0291,screen=$$0400-$$07FF,colour=$$D800-$$DBFF,charset=$$3800-$$3FFF,result=$$02FF' --harness 'cia2_timer_a, cia2_timer_b, cia2_tod'

# The harness sits beside the starter in c64-kb (../_harness) or is vendored
# into ./harness when the starter is copied out on its own.
# Proof targets `npm run verify:templates -- --selftest` runs after selftest.
VERIFY_TARGETS := disktest

HARNESS ?= $(firstword $(wildcard harness) ../_harness)
$(if $(wildcard $(HARNESS)/harness.mk),,$(error No harness at '$(HARNESS)'. Copy c64-kb's templates/_harness to ./harness, or make the project with npm run new-project in c64-kb))
include $(HARNESS)/harness.mk
VICE_FLAGS += -drive8type 1541 -drive8truedrive
ZP_CLAIM := $$02-$$57,$$C6

# ---- this starter's own targets ---------------------------------------------------
# tools/gen.py writes the two src/gen_*.h headers from tools/world.py.
GEN_OUT := src/gen_world.h src/gen_script.h
$(GEN_OUT): build/gen.stamp
build/gen.stamp: tools/gen.py tools/world.py
	@mkdir -p build
	$(PYTHON) tools/gen.py
	@touch $@

.PHONY: gen disktest joy
gen:
	$(PYTHON) tools/gen.py

# The normal game with its fire button read from $02FE instead of $DC00, so
# tools/drive.py can press it headless (README, "Driving it headless").
joy: build/$(NAME)-joy.prg
build/$(NAME)-joy.prg: $(C_DEPS) $(METER_DEPS) | plan-gate
	@mkdir -p build
	$(OSCAR64_BUILD) -dJOY_SOURCE=0x02fe -o=$@ $(C_MAIN)

# The disk test, on a true-drive 1541 (DISK_MODEL=pal or ntsc):
#  1. DISKTEST=1 plays the script up to its SAVE on a fresh copy of the release
#     D64 and grades itself: the state the model says, and the drive's 00;
#  2. c1541 reads SAVEGAME back: tools/disk_check.py compares it byte for byte
#     with the record the model wrote (build/save-expected.bin);
#  3. a cold VICE (a reset) runs DISKTEST=2 on the same D64: it types LOAD
#     first, then the rest of the script, which reaches the ending only from
#     the saved state, and grades itself;
#  4. a cold VICE boots the release PRG from the D64 and types RETURN, LOAD,
#     SCORE and I through the keyboard queue (-keybuf). Without
#     -keybuf-delay the keys arrived before the program ran and were lost;
#     2500 held them past the load (measured, VICE 3.10).
#  5. the release PRG LOADs three bad saves (tools/disk_check.py --make-bad):
#     a changed byte, room 200 with a good fold, another world's version with
#     a good fold; each must be refused;
#  6. the release PRG types SAVE to a drive with no disk: the drive's words.
# tools/disk_check.py grades the pictures and the file against the model.
DISKTEST_D64 := build/disktest.d64
DISK_MODEL ?= pal
DISK_VICE = $(TIMEOUT) $(VICE_TIMEOUT) $(X64SC) $(VICE_FLAGS) $(if $(filter ntsc,$(DISK_MODEL)),-model ntsc) -drive8type 1541 -drive8truedrive -drive8wobbleamplitude 0 -drive8wobblefrequency 0
# $(1) = the picture's name, $(2) = cycles, $(3) = what to autostart, $(4) = extra flags
define disk_run
	@rm -f shots/$(1).png
	@$(DISK_VICE) -limitcycles $(2) $(4) -exitscreenshot shots/$(1).png -autostart $(3) > shots/$(1).log 2>&1 || true
	@test -s shots/$(1).png || { echo "disktest: no picture from the $(1) run; see shots/$(1).log"; exit 1; }
endef
build/$(NAME)-disk1.prg: $(C_DEPS) $(METER_DEPS) | plan-gate
	$(OSCAR64_BUILD) -dAUTOPILOT=1 -dDISKTEST=1 -o=$@ $(C_MAIN)
build/$(NAME)-disk2.prg: $(C_DEPS) $(METER_DEPS) | plan-gate
	$(OSCAR64_BUILD) -dAUTOPILOT=1 -dDISKTEST=2 -o=$@ $(C_MAIN)
# $(1) = a bad save (tools/disk_check.py --make-bad): the release PRG LOADs it
define bad_run
	cp $(D64) build/$(1).d64
	$(C1541) -attach build/$(1).d64 -write build/$(1).seq "savegame,s" > /dev/null
	$(call disk_run,$(1),8000000,$(PRG),-8 build/$(1).d64 -keybuf '\x0dload\x0d' -keybuf-delay 100)
endef
disktest: $(D64) $(PRG) build/$(NAME)-disk1.prg build/$(NAME)-disk2.prg
	@mkdir -p shots
	cp $(D64) $(DISKTEST_D64)
	$(call disk_run,disk-save,20000000,build/$(NAME)-disk1.prg,-8 $(DISKTEST_D64))
	$(C1541) -attach $(DISKTEST_D64) -read "savegame,s" build/savegame.seq > /dev/null
	$(call disk_run,disk-load,20000000,build/$(NAME)-disk2.prg,-8 $(DISKTEST_D64))
	$(call disk_run,disk-boot,60000000,$(DISKTEST_D64),-keybuf '\x0dload\x0dscore\x0di\x0d' -keybuf-delay 2500)
	$(C1541) -attach $(DISKTEST_D64) -list > build/disktest-dir.txt 2>/dev/null
	$(PYTHON) tools/disk_check.py --make-bad build
	$(call bad_run,bad-fold)
	$(call bad_run,bad-room)
	$(call bad_run,bad-world)
	$(call disk_run,no-disk,12000000,$(PRG),-keybuf '\x0dsave\x0d' -keybuf-delay 100)
	$(PYTHON) tools/disk_check.py $(HARNESS_DIR) build $(DISK_MODEL)
