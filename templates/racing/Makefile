# racing: the pseudo-3D road racer starter. Every target but the ones below
# the include comes from the harness:
#   make              build build/racing.prg (after the PLAN.md gate)
#   make run          windowed VICE, joystick in port 2
#   make shot         headless PAL and NTSC exit screenshots of the autopilot build
#   make check        grade shots/pal.png and shots/ntsc.png against expect.json
#   make selftest     prove check fails on the FORCE_FAULT=1 build
#   make roadcheck    draw every road line from the program's own splits, read
#                     out of the machine, and match it with the shots pixel
#                     for pixel (tools/roadcheck.py)
#   make mutants      six builds with one fault each (MUTANT=1-6, src/game.h):
#                     each must fail a check
#   make drive        the normal game played headless (harness/drive.py)
#   make drivetest    DRIVE_STEPS: fire starts the race, fire held reaches top speed
#   make disk         build/racing.d64
#   make claims       c64-kb's claims-watch over the autopilot build
#   make clean
NAME     := racing
C_MAIN   := src/main.c
KICK_SRC := src/engine.asm

# Pinned after the verdict and the still it leaves (src/verdict.h), where
# nothing on the screen changes: 90M and 100M, 100M and 110M gave identical
# PAL pictures; 80M, 90M and 100M identical NTSC ones (VICE x64sc 3.10).
SHOT_CYCLES_PAL  := 100000000
SHOT_CYCLES_NTSC := 90000000

# What the program may write, for make claims (claims-watch's own grammar).
# - Oscar64's registers from $02, its temporaries from $43 up (make zp).
# - engine.asm's builder owns $D0-$D3 and $E0-$FF (the KERNAL is out and
#   never called).
# - The IRQ chain is the only interrupt; the KERNAL's runs until main's SEI.
# - $DC0D (all CIA1 interrupts off) counts against the three CIA1 units.
# - CIA2 timer A is the harness meter's; timer B times the IRQs for the
#   meter; the $DD0D stores count against all three CIA2 units.
CLAIMS_ARGS := --claim 'sprite_0, sprite_1, sprite_2, vic_raster_irq, irq_vector_fffe, nmi_vector_fffa, cia2_vic_bank, cia1_port_a, cia1_timer_a, cia1_timer_b, cia1_tod, sid_voice_1, sid_voice_2, sid_voice_3, sid_filter_volume, zero_page $$02-$$6F+$$D0-$$D3+$$E0-$$FF' --range 'colour=$$D800-$$DBFF,result=$$02FF' --harness 'cia2_timer_a, cia2_timer_b, cia2_tod' --kernal IRQ --cycles 100000000

# This starter's own proofs, which npm run verify:templates runs too.
VERIFY_TARGETS := roadcheck mutants drivetest

# make drive and drivetest read the panel, rows 19-24 of the HUD page
# (src/game.h HUDPAGE). drivetest: the normal build, stick on $DC00: fire on
# the title starts the lights, fire held after GO! reaches top speed (the
# panel's SPEED 480).
DRIVE_SCREEN := C800:19-24
DRIVE_STEPS  := "until:PRESS FIRE" tap:fire "until:GO!" hold:fire "until:SPEED 480" print

# The harness sits beside the starter in c64-kb (../_harness) or is vendored
# into ./harness when the starter is copied out on its own.
HARNESS ?= $(firstword $(wildcard harness) ../_harness)
$(if $(wildcard $(HARNESS)/harness.mk),,$(error No harness at '$(HARNESS)'. Copy c64-kb's templates/_harness to ./harness, or make the project with npm run new-project in c64-kb))
include $(HARNESS)/harness.mk

# ---- roadcheck: every road line is what its split says -------------------------------
.PHONY: roadcheck
roadcheck: $(SHOTS)
	$(PYTHON) tools/roadcheck.py --x64sc $(X64SC) --asm build/asm.h $(PRG_AUTO) shots/pal.png shots/ntsc.png

# ---- mutants: one deliberate fault each, and the check that catches it ----------------
# 1 the pads ignore the sprites: roadcheck (and the verdict's split line)
# 2 no curve, 3 no hill, 4 one car size, 5 the clock counts every other
# frame, 6 no contact: the verdict and the pinned pixels or text.
MUTANTS := 1 2 3 4 5 6
MUT_SHOTS := $(foreach n,$(MUTANTS),shots/mut$(n)-pal.png shots/mut$(n)-ntsc.png)
.SECONDARY: $(foreach n,$(MUTANTS),build/$(NAME)-mut$(n).prg)
build/$(NAME)-mut%.prg: $(C_DEPS) $(ASM_OUT) $(METER_DEPS) | plan-gate
	@mkdir -p build
	$(OSCAR64_BUILD) -d$(AUTOPILOT_DEFINE)=1 -dMUTANT=$* -o=$@ $(C_MAIN)
shots/mut%-pal.png: build/$(NAME)-mut%.prg
	$(call vice_shot,$<,$(SHOT_CYCLES_PAL),,$@)
shots/mut%-ntsc.png: build/$(NAME)-mut%.prg
	$(call vice_shot,$<,$(SHOT_CYCLES_NTSC),-model ntsc,$@)

.PHONY: mutants
mutants:
	@rm -f $(MUT_SHOTS)
	@$(MAKE) --no-print-directory -j4 $(MUT_SHOTS)
	@caught=0; for n in $(MUTANTS); do \
	  C64KB="$(C64KB)" $(PYTHON) $(HARNESS_DIR)/check.py expect.json shots/mut$$n-pal.png shots/mut$$n-ntsc.png > shots/mut$$n-check.txt 2>&1; st=$$?; \
	  if [ $$n = 1 ]; then \
	    $(PYTHON) tools/roadcheck.py --x64sc $(X64SC) --asm build/asm.h --expect fail build/$(NAME)-mut1.prg shots/mut1-pal.png shots/mut1-ntsc.png > shots/mut1-road.txt 2>&1 && st=1 || st=0; \
	    grep -h '^FAIL' shots/mut1-road.txt | head -2; \
	  fi; \
	  if [ $$st -eq 1 ]; then caught=$$((caught + 1)); echo "mutant $$n: caught"; grep -h '^FAIL' shots/mut$$n-check.txt | head -3; \
	  else echo "mutant $$n: NOT caught"; fi; \
	done; \
	echo "mutants: $$caught of $(words $(MUTANTS)) caught"; [ $$caught -eq $(words $(MUTANTS)) ]

# ---- probe: the road's timing, line by line ----------------------------------------
# PROBE=1 adds a second $D021 store to every normal road block, written on
# cycle 18: the probe colour starts at the same x on every such line when
# every block starts on cycle 1. This is how SYNC_* and ENTRY_* in
# engine.asm were found (README, "The road's timing").
PRG_PROBE := build/$(NAME)-probe.prg
KICK_PROBE_FLAGS ?=
$(PRG_PROBE): $(C_DEPS) $(KICK_SRC) $(KICK_DEPS) $(METER_DEPS) | plan-gate
	@mkdir -p build/probe
	$(KICKASS) $(KICK_SRC) -define PROBE $(KICK_PROBE_FLAGS) -binfile -symbolfile -libdir $(HARNESS_DIR)/meter -odir $(CURDIR)/build/probe -o $(CURDIR)/build/probe/asm.bin > build/probe/asm.log || { cat build/probe/asm.log; exit 1; }
	$(PYTHON) $(HARNESS_DIR)/gen-asm-header.py build/probe/asm.log build/probe/engine.sym build/probe/asm.bin build/probe/asm.h
	$(OSCAR64) $(OSCAR64_FLAGS) -i=$(CURDIR)/build/probe -i=$(abspath $(HARNESS_DIR))/meter -d$(AUTOPILOT_DEFINE)=1 -o=$@ $(C_MAIN)
