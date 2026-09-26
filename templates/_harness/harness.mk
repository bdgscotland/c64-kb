# harness.mk: the build, run, screenshot and check loop every starter shares.
#
# A starter's Makefile sets these, then includes this file:
#
#   NAME             program name: build/$(NAME).prg
#   C_MAIN           Oscar64 main source. Leave empty for a pure KickAssembler starter.
#   C_DEPS           every C source and header, so a change rebuilds (default: src/*.c src/*.h)
#   KICK_SRC         KickAssembler source. With C_MAIN it is assembled to a raw blob at its own
#                    `* =` address plus build/asm.h (ASM_ORG, ASM_END, ASM_<LABEL> for every
#                    top-level label); C places the blob with #pragma region + #embed "asm.bin".
#                    Without C_MAIN it is the whole program.
#   KICK_DEPS        files KICK_SRC imports (default: src/*.asm)
#   SHOT_CYCLES_PAL  -limitcycles for the PAL exit screenshot
#   SHOT_CYCLES_NTSC -limitcycles for the NTSC (-model ntsc) exit screenshot
#   AUTOPILOT_DEFINE the define that switches the scripted input on (default AUTOPILOT)
#   FAULT_DEFINE     the define that makes the program fail its own check (default FORCE_FAULT)
#   DISK_NAME        disk header for make disk (default: NAME, upper case)
#   DISK_FILES       extra host files make disk writes beside the PRG
#   SHOT_DISK        1: each headless run attaches a fresh copy of build/$(NAME).d64 as drive 8 (default 0)
#   CLAIMS_ARGS      arguments to c64-kb's scripts/claims-watch.ts after the PRG
#   VERIFY_TARGETS   this starter's own proof targets (disktest, tearcheck, probe, ...);
#                    `npm run verify:templates -- --selftest` runs each after selftest
#   DRIVE_SCREEN     where make drive and drivetest read screen text (harness/drive.py; default 0400:0-24)
#   DRIVE_STEPS      drivetest's steps: the normal build played headless, joystick on $DC00
#   DRIVE_DISK       a .d64 drivetest attaches (a fresh copy each run)
#   GALLERY_SCRIPT   make gallery's steps: the normal build played to the moment its
#                    presentation picture shows; the last step's end is the moment
#   GALLERY_DRIVER   what plays GALLERY_SCRIPT (default harness/drive.py); a starter's own
#                    tool takes the same arguments and imports drive.py (HARNESS_DIR is set)
#   SOUND_SINK       off (default, +sound: fastest), dump or wav. With off, and with
#                    VICE's dummy sink, $D41B and $D41C (OSC3, ENV3) read wrong values;
#                    a program that reads them sets SOUND_SINK := dump (the output goes
#                    to /dev/null). See docs/runtime/vice-reference.md, "The SID under +sound".
#   DEADLINE_LINE    a raster line: in the autopilot run every frame's work, from WORK_BEGIN
#                    to WORK_END (meter/frame_meter.h, .asm), must end before the first
#                    start of that line after its begin (harness/watch.py). Empty: not checked
#   DEADLINE_LINE_NTSC  the same on NTSC (default DEADLINE_LINE)
#   OVERRUN_DEFINE   the define whose build must fail the deadline (default OVERRUN)
#   SID_FRAMES       the least frames of the autopilot run that store to the SID ($D400-$D7FF):
#                    the player runs. Empty: not checked
#   SID_FRAMES_NTSC  the same on NTSC (default SID_FRAMES)
#   SILENT_DEFINE    the define whose build never calls the player and must fail the SID
#                    check (default NO_PLAYER)
#   WATCH_CYCLES_PAL, WATCH_CYCLES_NTSC  the watched runs' length (default SHOT_CYCLES_*)
#                    With DEADLINE_LINE or SID_FRAMES set, make check runs make watch and
#                    make selftest runs make watchtest.
#
# Tools, each from the environment first:
#   OSCAR64, KICKASS_JAR, JAVA, X64SC (headless runs), X64SC_WINDOWED (make run),
#   C1541, PYTHON, C64KB (the c64-kb checkout, default ../.. from the starter)
#   A local.mk beside the Makefile, if present, is read first.

HARNESS_DIR := $(patsubst %/,%,$(dir $(lastword $(MAKEFILE_LIST))))
STARTER_MAKEFILE := $(firstword $(MAKEFILE_LIST))

# A project made by c64-kb's `npm run new-project` keeps its machine settings
# (C64KB, tool paths) here, so nothing has to be exported by hand.
-include local.mk

# ---- defaults a starter may leave out ---------------------------------------
C_DEPS           ?= $(wildcard src/*.c src/*.h)
KICK_DEPS        ?= $(wildcard src/*.asm)
SHOT_CYCLES_PAL  ?= 8000000
SHOT_CYCLES_NTSC ?= 8000000
AUTOPILOT_DEFINE ?= AUTOPILOT
FAULT_DEFINE     ?= FORCE_FAULT
DISK_NAME        ?= $(NAME)
DISK_ID          ?= 01
SHOT_DISK        ?= 0
CLAIMS_ARGS      ?=
VERIFY_TARGETS   ?=
PLAN_GATE        ?= on
SOUND_SINK       ?= off
DEADLINE_LINE    ?=
DEADLINE_LINE_NTSC ?= $(DEADLINE_LINE)
OVERRUN_DEFINE   ?= OVERRUN
SID_FRAMES       ?=
SID_FRAMES_NTSC  ?= $(SID_FRAMES)
SILENT_DEFINE    ?= NO_PLAYER
WATCH_CYCLES_PAL  ?= $(SHOT_CYCLES_PAL)
WATCH_CYCLES_NTSC ?= $(SHOT_CYCLES_NTSC)
WATCH_ON = $(strip $(DEADLINE_LINE)$(SID_FRAMES))

# ---- tools --------------------------------------------------------------------
OSCAR64 ?= $(firstword $(shell command -v oscar64 2>/dev/null) $(wildcard $(HOME)/Developer/c64/oscar64/bin/oscar64) oscar64)
OSCAR64_FLAGS ?= -tm=c64 -O2
KICKASS_JAR ?= $(HOME)/Developer/c64/kickassembler/KickAss.jar
JAVA ?= java
KICKASS = $(JAVA) -jar $(KICKASS_JAR)
KICKASS_FLAGS ?=
# Headless runs prefer the windowless VICE build (no window, no focus theft).
X64SC ?= $(firstword $(wildcard $(HOME)/Developer/c64/vice-headless/bin/x64sc) $(shell command -v x64sc 2>/dev/null) x64sc)
X64SC_WINDOWED ?= $(firstword $(shell command -v x64sc 2>/dev/null) x64sc)
C1541 ?= $(firstword $(shell command -v c1541 2>/dev/null) c1541)
PYTHON ?= python3
C64KB ?= $(abspath $(CURDIR)/../..)
# Every emulator call is wrapped: timeout, gtimeout, else perl's alarm.
TIMEOUT ?= $(or $(shell command -v timeout 2>/dev/null),$(shell command -v gtimeout 2>/dev/null),perl -e 'alarm shift; exec @ARGV')
VICE_TIMEOUT ?= 180

# The Homebrew GTK build of VICE aborts in g_settings_new without this.
ifneq ($(wildcard /opt/homebrew/share/glib-2.0/schemas),)
export GSETTINGS_SCHEMA_DIR ?= /opt/homebrew/share/glib-2.0/schemas
endif

# ---- outputs --------------------------------------------------------------------
PRG       := build/$(NAME).prg
PRG_AUTO  := build/$(NAME)-auto.prg
PRG_FAULT := build/$(NAME)-fault.prg
PRG_RELEASED := build/$(NAME)-released.prg
D64       := build/$(NAME).d64
SHOTS     := shots/pal.png shots/ntsc.png
FAULT_SHOTS := shots/fault-pal.png shots/fault-ntsc.png
RELEASED_SHOTS := shots/released-pal.png shots/released-ntsc.png

METER_DEPS := $(wildcard $(HARNESS_DIR)/meter/*)

SOUND_FLAGS = $(if $(filter off,$(SOUND_SINK)),+sound,-sound -sounddev $(SOUND_SINK) -soundarg /dev/null)
VICE_FLAGS = -default -warp $(SOUND_FLAGS) +autostart-delay-random -autostartprgmode 1
# With SHOT_DISK = 1 every headless run attaches its own fresh copy of the
# release D64 (shots/<shot>.d64), never build/$(NAME).d64 itself: VICE writes
# a save back into the image it attached, so a run on the shared image would
# start the next one from a different disk and the pinned shot would move.
ifeq ($(strip $(SHOT_DISK)),1)
SHOT_DISK_DEP = $(D64)
shot_disk = @cp $(D64) $(1:.png=.d64)
shot_disk_flags = -8 $(1:.png=.d64) -drive8wobbleamplitude 0 -drive8wobblefrequency 0
endif

.PHONY: all build run run-auto shot check selftest watch watchtest disk claims zp released clean plan-gate tools verify-targets drive drivetest joyprobe gallery
.DELETE_ON_ERROR:

all: plan-gate build
build: $(PRG)

# ---- PLAN.md gate: no build until the plan holds the tool output ----------
# Every PRG depends on it (order-only), so make, shot, check, selftest, disk,
# claims and run all stop while the plan does not pass.
plan-gate:
ifeq ($(PLAN_GATE),on)
	@$(PYTHON) $(HARNESS_DIR)/hooks/plan-gate.py --check PLAN.md --c64kb "$(C64KB)" --cache build/.plan-gate
endif

# ---- build ------------------------------------------------------------------------
ifneq ($(strip $(C_MAIN)),)
ifneq ($(strip $(KICK_SRC)),)
ASM_OUT := build/asm.bin build/asm.h
build/asm.bin: $(KICK_SRC) $(KICK_DEPS) $(HARNESS_DIR)/gen-asm-header.py | plan-gate
	@mkdir -p build
	$(KICKASS) $(KICK_SRC) $(KICKASS_FLAGS) -binfile -symbolfile -vicesymbols -libdir $(HARNESS_DIR)/meter -odir $(CURDIR)/build -o $(CURDIR)/build/asm.bin > build/asm.log || { cat build/asm.log; exit 1; }
	$(PYTHON) $(HARNESS_DIR)/gen-asm-header.py build/asm.log build/$(basename $(notdir $(KICK_SRC))).sym build/asm.bin build/asm.h || { rm -f build/asm.bin; exit 1; }
build/asm.h: build/asm.bin
endif

OSCAR64_BUILD = $(OSCAR64) $(OSCAR64_FLAGS) -i=$(CURDIR)/build -i=$(abspath $(HARNESS_DIR))/meter

$(PRG): $(C_DEPS) $(ASM_OUT) $(METER_DEPS) | plan-gate
	@mkdir -p build
	$(OSCAR64_BUILD) -o=$@ $(C_MAIN)
$(PRG_AUTO): $(C_DEPS) $(ASM_OUT) $(METER_DEPS) | plan-gate
	@mkdir -p build
	$(OSCAR64_BUILD) -d$(AUTOPILOT_DEFINE)=1 -o=$@ $(C_MAIN)
$(PRG_FAULT): $(C_DEPS) $(ASM_OUT) $(METER_DEPS) | plan-gate
	@mkdir -p build
	$(OSCAR64_BUILD) -d$(AUTOPILOT_DEFINE)=1 -d$(FAULT_DEFINE)=1 -o=$@ $(C_MAIN)
# The autopilot build from a second compiler, for `make released`.
$(PRG_RELEASED): $(C_DEPS) $(ASM_OUT) $(METER_DEPS) | plan-gate
	@mkdir -p build
	@test -n "$(OSCAR64_RELEASED)" || { echo "released: set OSCAR64_RELEASED=/path/to/a released oscar64"; exit 2; }
	$(OSCAR64_RELEASED) $(OSCAR64_FLAGS) -i=$(CURDIR)/build -i=$(abspath $(HARNESS_DIR))/meter -d$(AUTOPILOT_DEFINE)=1 -o=$@ $(C_MAIN)
else
KICK_BUILD = $(KICKASS) $(KICK_SRC) $(KICKASS_FLAGS) -libdir $(HARNESS_DIR)/meter -vicesymbols -odir $(CURDIR)/build

$(PRG): $(KICK_SRC) $(KICK_DEPS) $(METER_DEPS) | plan-gate
	@mkdir -p build
	$(KICK_BUILD) -o $(CURDIR)/$@ > build/kick.log || { cat build/kick.log; exit 1; }
$(PRG_AUTO): $(KICK_SRC) $(KICK_DEPS) $(METER_DEPS) | plan-gate
	@mkdir -p build
	$(KICK_BUILD) -define $(AUTOPILOT_DEFINE) -o $(CURDIR)/$@ > build/kick-auto.log || { cat build/kick-auto.log; exit 1; }
$(PRG_FAULT): $(KICK_SRC) $(KICK_DEPS) $(METER_DEPS) | plan-gate
	@mkdir -p build
	$(KICK_BUILD) -define $(AUTOPILOT_DEFINE) -define $(FAULT_DEFINE) -o $(CURDIR)/$@ > build/kick-fault.log || { cat build/kick-fault.log; exit 1; }
endif

# ---- run: the windowed emulator, for a human ----------------------------------------
# Joystick port 2 on the numeric keypad (8 2 4 6, fire 0): -joydev2 1.
run: $(PRG)
	$(X64SC_WINDOWED) -joydev2 1 -autostart $(PRG)
run-auto: $(PRG_AUTO)
	$(X64SC_WINDOWED) -autostart $(PRG_AUTO)

# ---- shot: headless PAL and NTSC, autopilot build, pinned cycles -------------------
# $(1) = prg, $(2) = cycles, $(3) = model flags, $(4) = png
define vice_shot
	@mkdir -p shots
	@rm -f $(4)
	$(call shot_disk,$(4))
	@$(TIMEOUT) $(VICE_TIMEOUT) $(X64SC) $(VICE_FLAGS) -limitcycles $(2) $(3) $(call shot_disk_flags,$(4)) -exitscreenshot $(4) -autostart $(1) > $(4:.png=.log) 2>&1 || true
	@# x64sc exits 1 after -limitcycles, pass or fail; the PNG is the result.
	@test -s $(4) || { echo "shot: $(X64SC) wrote no $(4); see $(4:.png=.log)"; exit 1; }
	@echo "shot: $(4) ($(2) cycles$(if $(3), $(3),), $(notdir $(1)))"
endef

# A shot is stale when the PRG, the starter's Makefile or the pin changes.
# The pin stamp's name carries the cycle count; a new count deletes the old
# stamp, so switching back also re-shoots.
PIN_PAL  := build/pin/pal-$(SHOT_CYCLES_PAL)
PIN_NTSC := build/pin/ntsc-$(SHOT_CYCLES_NTSC)
$(PIN_PAL) $(PIN_NTSC):
	@mkdir -p build/pin
	@rm -f build/pin/$(firstword $(subst -, ,$(notdir $@)))-*
	@touch $@
SHOT_DEPS = $(STARTER_MAKEFILE) $(SHOT_DISK_DEP)

shots/pal.png: $(PRG_AUTO) $(PIN_PAL) $(SHOT_DEPS)
	$(call vice_shot,$(PRG_AUTO),$(SHOT_CYCLES_PAL),,$@)
shots/ntsc.png: $(PRG_AUTO) $(PIN_NTSC) $(SHOT_DEPS)
	$(call vice_shot,$(PRG_AUTO),$(SHOT_CYCLES_NTSC),-model ntsc,$@)
shots/fault-pal.png: $(PRG_FAULT) $(PIN_PAL) $(SHOT_DEPS)
	$(call vice_shot,$(PRG_FAULT),$(SHOT_CYCLES_PAL),,$@)
shots/fault-ntsc.png: $(PRG_FAULT) $(PIN_NTSC) $(SHOT_DEPS)
	$(call vice_shot,$(PRG_FAULT),$(SHOT_CYCLES_NTSC),-model ntsc,$@)
shots/released-pal.png: $(PRG_RELEASED) $(PIN_PAL) $(SHOT_DEPS)
	$(call vice_shot,$(PRG_RELEASED),$(SHOT_CYCLES_PAL),,$@)
shots/released-ntsc.png: $(PRG_RELEASED) $(PIN_NTSC) $(SHOT_DEPS)
	$(call vice_shot,$(PRG_RELEASED),$(SHOT_CYCLES_NTSC),-model ntsc,$@)

shot:
	@rm -f $(SHOTS)
	@$(MAKE) --no-print-directory $(SHOTS)

# ---- check: grade both shots against expect.json ---------------------------------
check: $(SHOTS)
	C64KB="$(C64KB)" $(PYTHON) $(HARNESS_DIR)/check.py expect.json shots/pal.png shots/ntsc.png
ifneq ($(WATCH_ON),)
	@$(MAKE) --no-print-directory watch
endif

# The check must fail on a build that fails its own test. Passes when it does.
selftest:
	@rm -f $(FAULT_SHOTS)
	@$(MAKE) --no-print-directory $(FAULT_SHOTS)
	@# Only a graded failure counts: exit 1 with FAIL lines. Exit 0 is a checker
	@# that passed a broken build; exit 2 or a traceback is one that never graded.
	@C64KB="$(C64KB)" $(PYTHON) $(HARNESS_DIR)/check.py expect.json $(FAULT_SHOTS) > shots/fault-check.txt 2>&1; st=$$?; \
	if [ $$st -eq 1 ] && grep -q '^FAIL' shots/fault-check.txt; then \
	  grep '^FAIL' shots/fault-check.txt | head -8; echo "selftest: PASS, check.py rejected the $(FAULT_DEFINE) build"; \
	elif [ $$st -eq 0 ]; then \
	  cat shots/fault-check.txt; echo "selftest: FAIL, check.py passed the $(FAULT_DEFINE) build"; exit 1; \
	else \
	  cat shots/fault-check.txt; echo "selftest: FAIL, check.py did not grade the shots (exit $$st)"; exit 1; \
	fi
ifneq ($(WATCH_ON),)
	@$(MAKE) --no-print-directory watchtest
endif

# ---- watch: the frame deadline and the SID player, from a VICE store trace --------
# harness/watch.py runs the autopilot PRG once a model with a monitor trace on
# $02FE (WORK_BEGIN, WORK_END) and $D400-$D7FF, and grades DEADLINE_LINE and
# SID_FRAMES. watchtest proves each check can fail: the OVERRUN_DEFINE build
# must fail the deadline and the SILENT_DEFINE build the SID check, on PAL and
# NTSC, and the normal build must pass both.
WATCH = $(TIMEOUT) $(VICE_TIMEOUT) $(PYTHON) $(HARNESS_DIR)/watch.py --x64sc '$(X64SC)' --sound $(SOUND_SINK) $(if $(SHOT_DISK_DEP),--disk $(D64))
watch_pal  = $(WATCH) --model pal --cycles $(WATCH_CYCLES_PAL) $(1)
watch_ntsc = $(WATCH) --model ntsc --cycles $(WATCH_CYCLES_NTSC) $(1)
DEADLINE_ARGS_PAL  = $(if $(DEADLINE_LINE),--deadline $(DEADLINE_LINE))
DEADLINE_ARGS_NTSC = $(if $(DEADLINE_LINE_NTSC),--deadline $(DEADLINE_LINE_NTSC))
SID_ARGS_PAL  = $(if $(SID_FRAMES),--sid-frames $(SID_FRAMES))
SID_ARGS_NTSC = $(if $(SID_FRAMES_NTSC),--sid-frames $(SID_FRAMES_NTSC))

watch: $(PRG_AUTO) $(SHOT_DISK_DEP)
ifeq ($(WATCH_ON),)
	@echo "watch: $(NAME) sets neither DEADLINE_LINE nor SID_FRAMES; nothing was checked."
else
	@mkdir -p shots
	@$(call watch_pal,$(DEADLINE_ARGS_PAL) $(SID_ARGS_PAL)) $(PRG_AUTO) > shots/watch-pal.txt 2>&1; echo $$? > shots/watch-pal.st & \
	 $(call watch_ntsc,$(DEADLINE_ARGS_NTSC) $(SID_ARGS_NTSC)) $(PRG_AUTO) > shots/watch-ntsc.txt 2>&1; echo $$? > shots/watch-ntsc.st & \
	 wait; cat shots/watch-pal.txt shots/watch-ntsc.txt; \
	 [ "$$(cat shots/watch-pal.st)" = 0 ] && [ "$$(cat shots/watch-ntsc.st)" = 0 ] || { echo "watch: FAIL"; exit 1; }
	@echo "watch: PASS"
endif

# A variant of the autopilot build with one more define: $(1) its name, $(2) the define.
ifneq ($(strip $(C_MAIN)),)
define variant_prg
build/$(NAME)-$(1).prg: $(C_DEPS) $(KICK_SRC) $(KICK_DEPS) $(METER_DEPS) | plan-gate
	@mkdir -p build/$(1)
	$(if $(strip $(KICK_SRC)),$(KICKASS) $(KICK_SRC) $(KICKASS_FLAGS) -define $(2) -binfile -symbolfile -libdir $(HARNESS_DIR)/meter -odir $(CURDIR)/build/$(1) -o $(CURDIR)/build/$(1)/asm.bin > build/$(1)/asm.log || { cat build/$(1)/asm.log; exit 1; })
	$(if $(strip $(KICK_SRC)),$(PYTHON) $(HARNESS_DIR)/gen-asm-header.py build/$(1)/asm.log build/$(1)/$(basename $(notdir $(KICK_SRC))).sym build/$(1)/asm.bin build/$(1)/asm.h)
	$(OSCAR64) $(OSCAR64_FLAGS) -i=$(CURDIR)/build/$(1) -i=$(abspath $(HARNESS_DIR))/meter -d$(AUTOPILOT_DEFINE)=1 -d$(2)=1 -o=$$@ $(C_MAIN)
endef
else
define variant_prg
build/$(NAME)-$(1).prg: $(KICK_SRC) $(KICK_DEPS) $(METER_DEPS) | plan-gate
	@mkdir -p build
	$(KICK_BUILD) -define $(AUTOPILOT_DEFINE) -define $(2) -o $(CURDIR)/$$@ > build/kick-$(1).log || { cat build/kick-$(1).log; exit 1; }
endef
endif
$(eval $(call variant_prg,overrun,$(OVERRUN_DEFINE)))
$(eval $(call variant_prg,silent,$(SILENT_DEFINE)))

# $(1) the variant, $(2) the model, $(3) the check's arguments: exit 1 with a FAIL line passes.
define watch_must_fail
	@$(call watch_$(2),$(3)) build/$(NAME)-$(1).prg > shots/watch-$(1)-$(2).txt 2>&1; st=$$?; \
	grep '^FAIL' shots/watch-$(1)-$(2).txt | head -2; \
	if [ $$st -eq 1 ] && grep -q '^FAIL' shots/watch-$(1)-$(2).txt; then echo "watchtest: the $(1) build fails on $(2): PASS"; \
	else cat shots/watch-$(1)-$(2).txt; echo "watchtest: FAIL, the $(1) build was not failed on $(2) (exit $$st)"; exit 1; fi
endef

watchtest: watch $(if $(DEADLINE_LINE),build/$(NAME)-overrun.prg) $(if $(SID_FRAMES),build/$(NAME)-silent.prg)
ifneq ($(DEADLINE_LINE),)
	$(call watch_must_fail,overrun,pal,$(DEADLINE_ARGS_PAL))
	$(call watch_must_fail,overrun,ntsc,$(DEADLINE_ARGS_NTSC))
endif
ifneq ($(SID_FRAMES),)
	$(call watch_must_fail,silent,pal,$(SID_ARGS_PAL))
	$(call watch_must_fail,silent,ntsc,$(SID_ARGS_NTSC))
endif

lc = $(shell echo '$(1)' | tr A-Z a-z)

# ---- disk: a .d64 with the PRG and DISK_FILES ---------------------------------------
disk: $(D64)
$(D64): $(PRG) $(DISK_FILES)
	@rm -f $@
	@# Names and the header go to c1541 in lower case: an upper-case host name
	@# is stored as shifted PETSCII that the KERNAL cannot open by its plain
	@# name (c64-kb pitfall c1541_uppercase_filename_petscii_shift).
	$(C1541) -format "$(call lc,$(DISK_NAME)),$(DISK_ID)" d64 $@ -write $(PRG) $(call lc,$(NAME)) $(foreach f,$(DISK_FILES),-write $(f) $(call lc,$(basename $(notdir $(f))))) > build/c1541.log
	$(C1541) -attach $@ -list

# ---- claims: every store the autopilot run makes, against what it declared ------------
claims: $(PRG_AUTO)
	@if [ -f "$(C64KB)/scripts/claims-watch.ts" ]; then \
	  cd "$(C64KB)" && X64SC_BIN="$(X64SC)" $(TIMEOUT) $(VICE_TIMEOUT) node scripts/claims-watch.ts "$(abspath $(PRG_AUTO))" $(CLAIMS_ARGS); \
	else \
	  echo "claims: not available. $(C64KB)/scripts/claims-watch.ts does not exist (it lands in c64-kb with issue #22 step 6)."; \
	  echo "claims: set C64KB=/path/to/c64-kb to a checkout that has it. Nothing was checked."; \
	fi

# ---- released: the same checks on a build from another Oscar64 ------------------
# The starters are verified with a locally patched Oscar64 (c64-kb #25); an
# agent downstream has a release. `make released OSCAR64_RELEASED=...` builds
# the autopilot program with that compiler and grades its shots with this
# starter's expect.json. A failure here is worth reading in the .asm listing:
# two v1.32.273 miscompiles were found this way (#30).
released:
ifneq ($(strip $(C_MAIN)),)
	@rm -f $(PRG_RELEASED) $(RELEASED_SHOTS)
	@$(MAKE) --no-print-directory $(RELEASED_SHOTS)
	C64KB="$(C64KB)" $(PYTHON) $(HARNESS_DIR)/check.py expect.json $(RELEASED_SHOTS)
else
	@echo "released: $(NAME) has no C part; no Oscar64 is involved."
endif

# ---- zp: the zero page the compiled C touches, from Oscar64's listing ----------
# Oscar64's temporaries run from $43 up by each function's temp count, so the
# top of its zero page depends on the program. ZP_CLAIM ('$$02-$$55' in a
# Makefile, '$02-$55' on the command line) makes it a
# gate: exit 1 when the code touches an address outside the claim.
zp: $(PRG_AUTO)
ifneq ($(strip $(C_MAIN)),)
	@$(PYTHON) $(HARNESS_DIR)/zp-used.py build/$(NAME)-auto.asm $(if $(value ZP_CLAIM),--claim '$(value ZP_CLAIM)')
else
	@echo "zp: $(NAME) has no C part; a KickAssembler program's zero page is what its source says."
endif

# ---- drive: the normal game played headless, joystick on the real $DC00 ----------
# harness/drive.py sets control port 2's lines through VICE's Joyport I/O
# simulation device and counts time in frames, so a run repeats exactly.
#   make drive STEPS='"until:PRESS FIRE" tap:fire "until:LIVES" print'
# drivetest plays DRIVE_STEPS, the starter's own proof that its normal build
# (no autopilot) answers the stick; DRIVE_SCREEN says where its text is.
DRIVE_SCREEN ?= 0400:0-24
DRIVE_STEPS  ?=
DRIVE = DRIVE_SCREEN='$(DRIVE_SCREEN)' DRIVE_SOUND=$(SOUND_SINK) X64SC='$(X64SC)' $(TIMEOUT) $(VICE_TIMEOUT) $(PYTHON) $(HARNESS_DIR)/drive.py

drive: $(PRG)
	$(DRIVE) $(PRG) $(STEPS)
drivetest: $(PRG) $(DRIVE_DISK)
	@test -n '$(strip $(DRIVE_STEPS))' || { echo "drivetest: set DRIVE_STEPS in the Makefile"; exit 2; }
	$(if $(DRIVE_DISK),@cp $(DRIVE_DISK) build/drivetest.d64)
	$(if $(DRIVE_DISK),DRIVE_DISK=build/drivetest.d64) $(DRIVE) $(PRG) $(DRIVE_STEPS)
	@echo "drivetest: PASS"

# gallery: shots/gallery.png, a PAL picture of the normal build in play for a
# README: no verdict, no meter. GALLERY_SCRIPT plays to the moment; VICE's exit
# screenshot is written when the steps end, with the machine stopped at raster
# line 0, so the picture is a whole frame. drive.py counts emulated frames, so
# the same script gives the same picture every run.
GALLERY_SCRIPT ?=
GALLERY_DRIVER ?= $(HARNESS_DIR)/drive.py
gallery: $(PRG)
	@test -n '$(strip $(GALLERY_SCRIPT))' || { echo "gallery: set GALLERY_SCRIPT in the Makefile"; exit 2; }
	@mkdir -p shots
	@rm -f shots/gallery.png
	HARNESS_DIR='$(HARNESS_DIR)' DRIVE_EXITSHOT=shots/gallery.png DRIVE_SCREEN='$(DRIVE_SCREEN)' DRIVE_SOUND=$(SOUND_SINK) X64SC='$(X64SC)' $(TIMEOUT) $(VICE_TIMEOUT) $(PYTHON) $(GALLERY_DRIVER) $(PRG) $(GALLERY_SCRIPT)
	@test -s shots/gallery.png || { echo "gallery: FAIL, VICE wrote no shots/gallery.png"; exit 1; }
	@echo "gallery: shots/gallery.png"

# joyprobe: drive.py's own proof. A KickAssembler program waits for fire on
# $DC00; drive.py presses it at the same frame in three runs. The press must
# show, and the three screens and CIA1 timer A readings must match.
JOYPROBE_STEPS = "until:RUN" wait:100 tap:fire "until:FIRE AT FRAME" peek:d020,dc04,dc05 print
joyprobe: $(HARNESS_DIR)/joyprobe.asm
	@mkdir -p build
	$(KICKASS) $(HARNESS_DIR)/joyprobe.asm -odir $(CURDIR)/build -o $(CURDIR)/build/joyprobe.prg > build/joyprobe.log || { cat build/joyprobe.log; exit 1; }
	@for i in 1 2 3; do DRIVE_SCREEN=0400:0-24 X64SC='$(X64SC)' $(TIMEOUT) $(VICE_TIMEOUT) $(PYTHON) $(HARNESS_DIR)/drive.py build/joyprobe.prg $(JOYPROBE_STEPS) > build/joyprobe-$$i.txt || { cat build/joyprobe-$$i.txt; exit 1; }; done
	@cat build/joyprobe-1.txt
	@for i in 2 3; do diff build/joyprobe-1.txt build/joyprobe-$$i.txt || { echo "joyprobe: FAIL, runs 1 and $$i differ"; exit 1; }; done
	@grep -q 'peek d020: 245' build/joyprobe-1.txt || { echo "joyprobe: FAIL, the border is not green: fire never reached \$$DC00"; exit 1; }
	@echo "joyprobe: PASS, fire read on \$$DC00 at the same frame in 3 of 3 runs"

# The starter's own proof targets, one line, for verify-templates to read.
verify-targets:
	@echo $(VERIFY_TARGETS)

tools:
	@echo "OSCAR64=$(OSCAR64)"; echo "KICKASS_JAR=$(KICKASS_JAR)"; echo "X64SC=$(X64SC)"
	@echo "X64SC_WINDOWED=$(X64SC_WINDOWED)"; echo "C1541=$(C1541)"; echo "C64KB=$(C64KB)"; echo "TIMEOUT=$(TIMEOUT)"

clean:
	rm -rf build shots
