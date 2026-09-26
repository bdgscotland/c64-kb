# run-and-gun (FIREBASE): a vertical run-and-gun starter. Every target but
# assets and assetcheck comes from the harness:
#   make            build build/run-and-gun.prg (after the PLAN.md gate)
#   make run        windowed VICE, joystick in port 2
#   make shot       headless PAL and NTSC exit screenshots of the autopilot build
#   make check      grade shots/pal.png and shots/ntsc.png against expect.json
#   make selftest   prove check fails on the FORCE_FAULT=1 build
#   make drive      the normal game played headless (harness/drive.py), stick on $DC00
#   make gallery    shots/gallery.png: the normal game in play, for a README
#   make assets     re-run tools/mkassets.py (src/gen/ is committed)
#   make assetcheck the committed src/gen/ is what the tool writes now
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

assetcheck:
	@rm -rf build/gencheck && mkdir -p build/gencheck && cp -r src/gen build/gencheck/was
	$(PYTHON) tools/mkassets.py > /dev/null
	@diff -r build/gencheck/was src/gen && echo "assetcheck: PASS, src/gen/ is what tools/mkassets.py writes" || { cp build/gencheck/was/* src/gen/; echo "assetcheck: FAIL, src/gen/ differs from the tool's output (restored)"; exit 1; }

# ---- mapend: the scroll stops at the map's top --------------------------------------
# The -dMAPEND=1 autopilot build starts 7 lines from the map's top with the
# soldier on the threshold, holds up, and grades itself (main.c first_fail,
# MAPEND): the view stops at map y 0 after 7 lines (YSCROLL 0 to 7), and he
# walks on through the fort's gate to sprite Y 52. expect-mapend.json reads
# its verdict at YSCROLL 7 ("dy": 4).
VERIFY_TARGETS := mapend frontend fedrive
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

# ---- frontend: title, play, game over, name entry, table, title ------------------------
# The -dFRONTEND=1 autopilot build (main.c's FRONTEND script; flow.c's forced
# deaths, FORCE_OVER) plays the whole front end in one run and grades itself
# on the title it returns to (main.c first_fail, FRONTEND). expect-frontend.json
# grades that title on PAL and NTSC; the expect-fe-*.json pins grade the game
# over, entry and table screens, each shot inside the same run at its own
# cycle count (the run is the same every time: no random autostart delay).
# The FORCE_FAULT build files every score into row 0 (the fault
# high_score_table_insert names) and must fail the title's checks.
PRG_FE := build/$(NAME)-frontend.prg
PRG_FE_FAULT := build/$(NAME)-frontend-fault.prg
FE_CYCLES_PAL  := 22000000
FE_CYCLES_NTSC := 19000000
# Pins, each in the middle of its screen's window on that model (measured by a
# sweep of shots every 1,000,000 cycles; PLAN.md, "Front end"). The entry pin
# is before the name is typed; the table and the verdict show it filed.
FE_OVER_PAL  := 7000000
FE_OVER_NTSC := 6800000
FE_ENTRY_PAL  := 9400000
FE_ENTRY_NTSC := 8600000
FE_TABLE_PAL  := 13000000
FE_TABLE_NTSC := 12000000
$(PRG_FE): $(C_DEPS) $(ASM_OUT) $(METER_DEPS) | plan-gate
	@mkdir -p build
	$(OSCAR64_BUILD) -d$(AUTOPILOT_DEFINE)=1 -dFRONTEND=1 -o=$@ $(C_MAIN)
$(PRG_FE_FAULT): $(C_DEPS) $(ASM_OUT) $(METER_DEPS) | plan-gate
	@mkdir -p build
	$(OSCAR64_BUILD) -d$(AUTOPILOT_DEFINE)=1 -dFRONTEND=1 -d$(FAULT_DEFINE)=1 -o=$@ $(C_MAIN)

define fe_pin
	$(call vice_shot,$(PRG_FE),$(2),,shots/fe-$(1)-pal.png)
	$(call vice_shot,$(PRG_FE),$(3),-model ntsc,shots/fe-$(1)-ntsc.png)
	$(PYTHON) $(HARNESS_DIR)/check.py expect-fe-$(1).json shots/fe-$(1)-pal.png shots/fe-$(1)-ntsc.png
endef

.PHONY: frontend
frontend: $(PRG_FE) $(PRG_FE_FAULT)
	$(call fe_pin,over,$(FE_OVER_PAL),$(FE_OVER_NTSC))
	$(call fe_pin,entry,$(FE_ENTRY_PAL),$(FE_ENTRY_NTSC))
	$(call fe_pin,table,$(FE_TABLE_PAL),$(FE_TABLE_NTSC))
	$(call vice_shot,$(PRG_FE),$(FE_CYCLES_PAL),,shots/fe-pal.png)
	$(call vice_shot,$(PRG_FE),$(FE_CYCLES_NTSC),-model ntsc,shots/fe-ntsc.png)
	$(PYTHON) $(HARNESS_DIR)/check.py expect-frontend.json shots/fe-pal.png shots/fe-ntsc.png
	$(call vice_shot,$(PRG_FE_FAULT),$(FE_CYCLES_PAL),,shots/fe-fault-pal.png)
	$(call vice_shot,$(PRG_FE_FAULT),$(FE_CYCLES_NTSC),-model ntsc,shots/fe-fault-ntsc.png)
	@$(PYTHON) $(HARNESS_DIR)/check.py expect-frontend.json shots/fe-fault-pal.png shots/fe-fault-ntsc.png > shots/fe-fault-check.txt; st=$$?; \
	if [ $$st -eq 1 ]; then grep '^FAIL' shots/fe-fault-check.txt | head -6; echo "frontend: PASS, the FORCE_FAULT build (every score into row 0) failed"; \
	else cat shots/fe-fault-check.txt; echo "frontend: FAIL, check.py exit $$st on the FORCE_FAULT build (want 1)"; exit 1; fi

# ---- fedrive: the normal build's front end, played on the real $DC00 --------------------
# The -dFORCE_OVER=1 build is the normal game (no autopilot) with flow.c's
# forced deaths. harness/drive.py presses the stick: the title idles into the
# table and the demo and back; fire; the game ends; DAB typed on the letter
# wheel; the table shows it fourth; the title again. A second game ties DAB's
# 25,500 and ranks fifth, below it (the tie rule); B is typed and the entry
# is left alone until ENTRY_IDLE closes it as "B..". Each until: step fails
# the run if its text never comes.
PRG_FEDRIVE := build/$(NAME)-fedrive.prg
$(PRG_FEDRIVE): $(C_DEPS) $(ASM_OUT) $(METER_DEPS) | plan-gate
	@mkdir -p build
	$(OSCAR64_BUILD) -dFORCE_OVER=1 -o=$@ $(C_MAIN)
FEDRIVE_STEPS := "until:PUSH FIRE TO START" "until:HIGH SCORES" "until:DEMO" "until:PUSH FIRE TO START" \
	tap:fire "until:LIVES 3" "until:GAME OVER" print "until:ENTER YOUR INITIALS" \
	tap:up tap:up tap:up tap:fire tap:fire tap:up tap:fire "until:4  025500  DAB" print "until:PUSH FIRE TO START" print \
	tap:fire "until:LIVES 3" "until:RANK 5" tap:up tap:fire "until:5  025500  B.." print

.PHONY: fedrive
fedrive: $(PRG_FEDRIVE)
	$(DRIVE) $(PRG_FEDRIVE) $(FEDRIVE_STEPS)
	@echo "fedrive: PASS"
