# run-and-gun (FIREBASE): a vertical run-and-gun starter. Every target but
# assets and assetcheck comes from the harness:
#   make            build build/run-and-gun.prg (after the PLAN.md gate)
#   make run        windowed VICE, joystick in port 2
#   make shot       headless PAL and NTSC exit screenshots of the autopilot build
#   make check      grade shots/pal.png and shots/ntsc.png against expect.json
#   make selftest   prove check fails on the FORCE_FAULT=1 build
#   make drive      the normal game played headless (harness/drive.py), stick on $DC00
#   make gallery    shots/gallery.png: the normal game in play, for a README
#   make assets     re-run tools/mkassets.py and tools/mkweapons.py (src/gen/ is committed)
#   make assetcheck the committed src/gen/ is what the tool writes now
#   make weapons    the -dWEAPONS=1 build: shots and grenades played and graded (expect-weapons.json)
#   make weaponsfault  its WEAPONS_FAULT build (autofire) must fail those checks
#   make disk       build/run-and-gun.d64
#   make clean
NAME     := run-and-gun
C_MAIN   := src/main.c
KICK_SRC := src/kernel.asm
C_DEPS   := $(wildcard src/*.c src/*.h src/gen/*)

# The autopilot freezes at play frame 224 or a few after (the first YSCROLL 3),
# about 6,000,000 cycles after reset on PAL and 5,000,000 on NTSC with
# -autostartprgmode 1 (PLAN.md, "Autopilot and checks"); nothing on screen
# changes after the verdict.
SHOT_CYCLES_PAL  := 10000000
SHOT_CYCLES_NTSC := 10000000

# make drive, make gallery: the text lives on the one screen at $8000.
DRIVE_SCREEN := 8000:0-23

# make gallery: the normal build in play for the README: fire on the title,
# the autopilot's walk, stopped with the soldier just below the canopy.
GALLERY_SCRIPT := "until:PUSH FIRE" wait:10 tap:fire wait:2 hold:up wait:75 hold:right wait:70 hold:up wait:66

HARNESS ?= $(firstword $(wildcard harness) ../_harness)
$(if $(wildcard $(HARNESS)/harness.mk),,$(error No harness at '$(HARNESS)'. Copy c64-kb's templates/_harness to ./harness, or make the project with npm run new-project in c64-kb))
include $(HARNESS)/harness.mk

.PHONY: assets assetcheck
assets:
	$(PYTHON) tools/mkassets.py
	$(PYTHON) tools/mkweapons.py

assetcheck:
	@rm -rf build/gencheck && mkdir -p build/gencheck && cp -r src/gen build/gencheck/was
	$(PYTHON) tools/mkassets.py > /dev/null
	$(PYTHON) tools/mkweapons.py > /dev/null
	@diff -r build/gencheck/was src/gen && echo "assetcheck: PASS, src/gen/ is what tools/mkassets.py and mkweapons.py write" || { cp build/gencheck/was/* src/gen/; echo "assetcheck: FAIL, src/gen/ differs from the tool's output (restored)"; exit 1; }

# ---- mapend: the scroll stops at the map's top --------------------------------------
# The -dMAPEND=1 autopilot build starts 7 lines from the map's top with the
# soldier on the threshold, holds up, and grades itself (main.c first_fail,
# MAPEND): the view stops at map y 0 after 7 lines (YSCROLL 0 to 7), and he
# walks on through the fort's gate to sprite Y 52. expect-mapend.json reads
# its verdict at YSCROLL 7 ("dy": 4).
VERIFY_TARGETS := mapend weapons weaponsfault
PRG_MAPEND := build/$(NAME)-mapend.prg
$(PRG_MAPEND): $(C_DEPS) $(ASM_OUT) $(METER_DEPS) | plan-gate
	@mkdir -p build
	$(OSCAR64_BUILD) -d$(AUTOPILOT_DEFINE)=1 -dMAPEND=1 -o=$@ $(C_MAIN)

.PHONY: mapend
mapend: $(PRG_MAPEND)
	$(call vice_shot,$(PRG_MAPEND),$(SHOT_CYCLES_PAL),,shots/mapend-pal.png)
	$(call vice_shot,$(PRG_MAPEND),$(SHOT_CYCLES_NTSC),-model ntsc,shots/mapend-ntsc.png)
	$(PYTHON) $(HARNESS_DIR)/check.py expect-mapend.json shots/mapend-pal.png shots/mapend-ntsc.png

# ---- phases: the band and the panel at every YSCROLL phase ---------------------------
# The graded shot freezes on YSCROLL 3 only. Each build here freezes on one
# phase with the soldier moved to the lowest sprite Y (last line 208), and
# tools/phases.py wants lines 214-222 black, the panel's lines 223-246
# identical to phase 3's, and the sprite drawn to line 208, on PAL and NTSC.
PHASES := 0 1 2 3 4 5 6 7
PRG_PHASES := $(foreach k,$(PHASES),build/$(NAME)-ph$(k).prg)
build/$(NAME)-ph%.prg: $(C_DEPS) $(ASM_OUT) $(METER_DEPS) | plan-gate
	@mkdir -p build
	$(OSCAR64_BUILD) -d$(AUTOPILOT_DEFINE)=1 -dPHASES=1 -dFREEZE_YS=$* -o=$@ $(C_MAIN)

.PHONY: phases
phases: $(PRG_PHASES)
	$(PYTHON) tools/phases.py --x64sc $(X64SC) --pal $(SHOT_CYCLES_PAL) --ntsc $(SHOT_CYCLES_NTSC) $(PRG_PHASES)

check: phases

# ---- weapons: the gun and the grenade, played and graded ---------------------------
# The -dWEAPONS=1 autopilot build (src/weapons_test.h: its script and verdict)
# fires, turns and fires, holds fire, fires with three shots flying, throws
# five grenades and presses once more with none, then walks up scrolling
# with shots in the air and freezes during the last blast. expect-weapons.json
# grades its verdict rows and the blast and bullet on screen, PAL and NTSC.
# weaponsfault: the same with -dWEAPONS_FAULT=1 (fire on the level, an
# autofire) must fail those checks.
WEAPONS_CYCLES := 16000000              # the freeze comes on play frame 540: about 12,600,000 on PAL
PRG_WEAPONS := build/$(NAME)-weapons.prg
PRG_WEAPONS_FAULT := build/$(NAME)-weaponsfault.prg
$(PRG_WEAPONS): $(C_DEPS) $(ASM_OUT) $(METER_DEPS) | plan-gate
	@mkdir -p build
	$(OSCAR64_BUILD) -d$(AUTOPILOT_DEFINE)=1 -dWEAPONS=1 -o=$@ $(C_MAIN)
$(PRG_WEAPONS_FAULT): $(C_DEPS) $(ASM_OUT) $(METER_DEPS) | plan-gate
	@mkdir -p build
	$(OSCAR64_BUILD) -d$(AUTOPILOT_DEFINE)=1 -dWEAPONS=1 -dWEAPONS_FAULT=1 -o=$@ $(C_MAIN)

.PHONY: weapons weaponsfault
weapons: $(PRG_WEAPONS)
	$(call vice_shot,$(PRG_WEAPONS),$(WEAPONS_CYCLES),,shots/weapons-pal.png)
	$(call vice_shot,$(PRG_WEAPONS),$(WEAPONS_CYCLES),-model ntsc,shots/weapons-ntsc.png)
	$(PYTHON) $(HARNESS_DIR)/check.py expect-weapons.json shots/weapons-pal.png shots/weapons-ntsc.png

weaponsfault: $(PRG_WEAPONS_FAULT)
	$(call vice_shot,$(PRG_WEAPONS_FAULT),$(WEAPONS_CYCLES),,shots/weaponsfault-pal.png)
	$(call vice_shot,$(PRG_WEAPONS_FAULT),$(WEAPONS_CYCLES),-model ntsc,shots/weaponsfault-ntsc.png)
	@$(PYTHON) $(HARNESS_DIR)/check.py expect-weapons.json shots/weaponsfault-pal.png shots/weaponsfault-ntsc.png > shots/weaponsfault.txt 2>&1; st=$$?; \
	if [ $$st -eq 1 ] && grep -q '^FAIL' shots/weaponsfault.txt; then \
	  grep '^FAIL' shots/weaponsfault.txt | head -8; echo "weaponsfault: PASS, check.py rejected the WEAPONS_FAULT build"; \
	else cat shots/weaponsfault.txt; echo "weaponsfault: FAIL, exit $$st"; exit 1; fi
