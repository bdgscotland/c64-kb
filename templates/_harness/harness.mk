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
PLAN_GATE        ?= on

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
D64       := build/$(NAME).d64
SHOTS     := shots/pal.png shots/ntsc.png
FAULT_SHOTS := shots/fault-pal.png shots/fault-ntsc.png

METER_DEPS := $(wildcard $(HARNESS_DIR)/meter/*)

VICE_FLAGS = -default -warp +sound +autostart-delay-random -autostartprgmode 1
# With SHOT_DISK = 1 every headless run attaches its own fresh copy of the
# release D64 (shots/<shot>.d64), never build/$(NAME).d64 itself: VICE writes
# a save back into the image it attached, so a run on the shared image would
# start the next one from a different disk and the pinned shot would move.
ifeq ($(strip $(SHOT_DISK)),1)
SHOT_DISK_DEP = $(D64)
shot_disk = @cp $(D64) $(1:.png=.d64)
shot_disk_flags = -8 $(1:.png=.d64) -drive8wobbleamplitude 0 -drive8wobblefrequency 0
endif

.PHONY: all build run run-auto shot check selftest disk claims zp clean plan-gate tools
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
run: $(PRG)
	$(X64SC_WINDOWED) -autostart $(PRG)
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

shot:
	@rm -f $(SHOTS)
	@$(MAKE) --no-print-directory $(SHOTS)

# ---- check: grade both shots against expect.json ---------------------------------
check: $(SHOTS)
	C64KB="$(C64KB)" $(PYTHON) $(HARNESS_DIR)/check.py expect.json shots/pal.png shots/ntsc.png

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

tools:
	@echo "OSCAR64=$(OSCAR64)"; echo "KICKASS_JAR=$(KICKASS_JAR)"; echo "X64SC=$(X64SC)"
	@echo "X64SC_WINDOWED=$(X64SC_WINDOWED)"; echo "C1541=$(C1541)"; echo "C64KB=$(C64KB)"; echo "TIMEOUT=$(TIMEOUT)"

clean:
	rm -rf build shots
