# Makefile: C64-KB, the five-part C64 demo built from c64-kb techniques.
# See DESIGN.md for the part list and README.md for how it was verified.
NAME     := c64-kb
KICK_SRC := src/main.asm
KICK_DEPS := $(wildcard src/*.asm src/*.inc src/*/*.asm src/*/*.inc)

# SHOT_CYCLES: pinned at a cycle count after part 5's fade completes.
# Derivation (PAL, 19,656 cycles per frame):
#   Sync positions 5,10,15,19,22 for parts 1-5 (tune has 23 orders, loops to 19).
#   Total run: 960+960+960+768+576=4224 frames; fades ~330 frames. Total ~4554 frames.
#   4554 x 19,656 = 89.5M cycles; add KERNAL startup ~2M = ~91.5M.
#   Pinned at 100,000,000 (8.5M margin).
# Derivation (NTSC, 17,095 cycles per frame):
#   4554 frames x 17,095 = 77.8M; add startup = ~80M.
#   Pinned at 88,000,000 (8M margin).
SHOT_CYCLES_PAL  := 100000000
SHOT_CYCLES_NTSC := 100000000

DISK_NAME := c64-kb

# What the demo writes: sprites all, part data areas, result and selfcheck bytes,
# colour RAM; CIA2 timer A is the harness metre.
CLAIMS_ARGS := \
  --range 'screen=$$0400-$$07E7,colour=$$D800-$$DBE7,partdata0=$$2000-$$3FFE,partdata1=$$4000-$$7FFF,result=$$02FF,selfcheck=$$02E0-$$02E4' \
  --harness 'cia2_timer_a, cia2_timer_b, cia2_tod'

# The plan gate reads PLAN.md, the technique audit the KB's tools wrote before
# any code; that audit is working notes and is not in this tree, so the gate
# is off here. PLAN_GATE=on with a PLAN.md beside this file turns it back on.
PLAN_GATE ?= off

HARNESS ?= $(firstword $(wildcard harness) ../_harness)
$(if $(wildcard $(HARNESS)/harness.mk),,$(error No harness at '$(HARNESS)'. Copy c64-kb's templates/_harness to ./harness, or make the project with npm run new-project in c64-kb))
include $(HARNESS)/harness.mk

# ---- kernal-out-test: the whole demo with the KERNAL banked out -------------
# -define KERNAL_OUT_TEST sets $01 = $35 at the start of part 1 and leaves it,
# so every interrupt vectors through the RAM $FFFE (trackmo step 2). The end
# screen must still grade 29 of 29 on both models.
PRG_KOUT := build/$(NAME)-kout.prg
KOUT_SHOTS := shots/kout-pal.png shots/kout-ntsc.png
$(PRG_KOUT): $(KICK_SRC) $(KICK_DEPS) $(METER_DEPS) | plan-gate
	@mkdir -p build
	$(KICK_BUILD) -define $(AUTOPILOT_DEFINE) -define KERNAL_OUT_TEST -o $(CURDIR)/$@ > build/kick-kout.log || { cat build/kick-kout.log; exit 1; }
shots/kout-pal.png: $(PRG_KOUT) $(PIN_PAL) $(SHOT_DEPS)
	$(call vice_shot,$(PRG_KOUT),$(SHOT_CYCLES_PAL),,$@)
shots/kout-ntsc.png: $(PRG_KOUT) $(PIN_NTSC) $(SHOT_DEPS)
	$(call vice_shot,$(PRG_KOUT),$(SHOT_CYCLES_NTSC),-model ntsc,$@)
.PHONY: kernal-out-test
kernal-out-test:
	@rm -f $(KOUT_SHOTS)
	@$(MAKE) --no-print-directory $(KOUT_SHOTS)
	$(PYTHON) $(HARNESS_DIR)/check.py expect.json $(KOUT_SHOTS)
