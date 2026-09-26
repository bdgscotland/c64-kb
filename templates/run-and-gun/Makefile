# run-and-gun (FIREBASE): a vertical run-and-gun starter. Every target but
# assets, assetcheck, mapend, phases, enemies, weapons, weaponsfault, audio and
# audiotest comes from the harness:
#   make            build build/run-and-gun.prg (after the PLAN.md gate)
#   make run        windowed VICE, joystick in port 2
#   make shot       headless PAL and NTSC exit screenshots of the autopilot build
#   make check      grade shots/pal.png and shots/ntsc.png against expect.json
#   make selftest   prove check fails on the FORCE_FAULT=1 build
#   make drive      the normal game played headless (harness/drive.py), stick on $DC00
#   make gallery    shots/gallery.png: the normal game in play, for a README
#   make enemies    the enemies' own proof (expect-enemies.json) and its ENEMY_FAULT build
#   make assets     re-run tools/mkassets.py, tools/mkweapons.py and tools/mktune.py (src/gen/ is committed)
#   make assetcheck the committed src/gen/ is what the tool writes now
#   make weapons    the -dWEAPONS=1 build: shots and grenades played and graded (expect-weapons.json)
#   make weaponsfault  its WEAPONS_FAULT build (autofire) must fail those checks
#   make audio      the SID store trace: effects on voices 1-2, the tune on voice 3 in time
#   make audiotest  its AUDIO_FAULT and AUDIO_DROP builds must fail the trace
#   make disk       build/run-and-gun.d64
#   make clean
NAME     := run-and-gun
C_MAIN   := src/main.c
KICK_SRC := src/kernel.asm
KICK_DEPS := $(wildcard src/*.asm src/gen/*.asm)
C_DEPS   := $(wildcard src/*.c src/*.h src/gen/*)

# The autopilot freezes at play frame 224 or a few after (the first YSCROLL 3),
# about 6,000,000 cycles after reset on PAL and 5,000,000 on NTSC with
# -autostartprgmode 1 (PLAN.md, "Autopilot and checks"); nothing on screen
# changes after the verdict.
SHOT_CYCLES_PAL  := 10000000
SHOT_CYCLES_NTSC := 10000000

# make watch (run by make check): the SID is written in at least SID_FRAMES frames
# of the autopilot run. Measured (make watch): 324 frames on PAL, 370-371 on NTSC in
# 10,000,000 cycles (the driver starts about 160 frames in); the NO_PLAYER build
# writes it in 2 (the start-up's copy of the blob and audio_init), which make
# watchtest wants to fail.
SID_FRAMES := 300

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
	$(PYTHON) tools/mktune.py

assetcheck:
	@rm -rf build/gencheck && mkdir -p build/gencheck && cp -r src/gen build/gencheck/was
	$(PYTHON) tools/mkassets.py > /dev/null
	$(PYTHON) tools/mkweapons.py > /dev/null
	$(PYTHON) tools/mktune.py > /dev/null
	@diff -r build/gencheck/was src/gen && echo "assetcheck: PASS, src/gen/ is what tools/mkassets.py, mkweapons.py and mktune.py write" || { cp build/gencheck/was/* src/gen/; echo "assetcheck: FAIL, src/gen/ differs from the tool's output (restored)"; exit 1; }

# ---- mapend: the scroll stops at the map's top --------------------------------------
# The -dMAPEND=1 autopilot build starts 7 lines from the map's top with the
# soldier on the threshold, holds up, and grades itself (main.c first_fail,
# MAPEND): the view stops at map y 0 after 7 lines (YSCROLL 0 to 7), and he
# walks on through the fort's gate to sprite Y 52. expect-mapend.json reads
# its verdict at YSCROLL 7 ("dy": 4).
VERIFY_TARGETS := mapend enemies weapons weaponsfault audio audiotest
PRG_MAPEND := build/$(NAME)-mapend.prg
$(PRG_MAPEND): $(C_DEPS) $(ASM_OUT) $(METER_DEPS) | plan-gate
	@mkdir -p build
	$(OSCAR64_BUILD) -d$(AUTOPILOT_DEFINE)=1 -dMAPEND=1 -o=$@ $(C_MAIN)

.PHONY: mapend
mapend: $(PRG_MAPEND)
	$(call vice_shot,$(PRG_MAPEND),$(SHOT_CYCLES_PAL),,shots/mapend-pal.png)
	$(call vice_shot,$(PRG_MAPEND),$(SHOT_CYCLES_NTSC),-model ntsc,shots/mapend-ntsc.png)
	$(PYTHON) $(HARNESS_DIR)/check.py expect-mapend.json shots/mapend-pal.png shots/mapend-ntsc.png

# ---- enemies: the spawn list, the three kinds, their fire, the parked slots ------------
# The -dENEMYTEST=1 autopilot build walks the graded shot's script and grades
# the objects module (main.c first_fail_enemies): every due event spawned on
# the frame its row reached the view's top, shots and grenades fired, a shot
# ended on a blocking cell, every free slot parked and the multiplexer showing
# exactly the slots above its cut on every frame, shown slots on their map
# cells on redraw frames too, and obj_kill. expect-enemies.json grades the
# verdict and the enemies where the arithmetic puts them. The ENEMY_FAULT=1
# build (spawns a row late, freed slots left unparked, no redraw-frame move)
# must fail the same checks.
PRG_ENEMIES := build/$(NAME)-enemies.prg
PRG_ENEMIES_FAULT := build/$(NAME)-enemies-fault.prg
$(PRG_ENEMIES): $(C_DEPS) $(ASM_OUT) $(METER_DEPS) | plan-gate
	@mkdir -p build
	$(OSCAR64_BUILD) -d$(AUTOPILOT_DEFINE)=1 -dENEMYTEST=1 -o=$@ $(C_MAIN)
$(PRG_ENEMIES_FAULT): $(C_DEPS) $(ASM_OUT) $(METER_DEPS) | plan-gate
	@mkdir -p build
	$(OSCAR64_BUILD) -d$(AUTOPILOT_DEFINE)=1 -dENEMYTEST=1 -dENEMY_FAULT=1 -o=$@ $(C_MAIN)

.PHONY: enemies
enemies: $(PRG_ENEMIES) $(PRG_ENEMIES_FAULT)
	$(call vice_shot,$(PRG_ENEMIES),$(SHOT_CYCLES_PAL),,shots/enemies-pal.png)
	$(call vice_shot,$(PRG_ENEMIES),$(SHOT_CYCLES_NTSC),-model ntsc,shots/enemies-ntsc.png)
	$(PYTHON) $(HARNESS_DIR)/check.py expect-enemies.json shots/enemies-pal.png shots/enemies-ntsc.png
	$(call vice_shot,$(PRG_ENEMIES_FAULT),$(SHOT_CYCLES_PAL),,shots/enemies-fault-pal.png)
	$(call vice_shot,$(PRG_ENEMIES_FAULT),$(SHOT_CYCLES_NTSC),-model ntsc,shots/enemies-fault-ntsc.png)
	@$(PYTHON) $(HARNESS_DIR)/check.py expect-enemies.json shots/enemies-fault-pal.png shots/enemies-fault-ntsc.png > shots/enemies-fault.txt 2>&1; st=$$?; \
	if [ $$st -eq 1 ] && grep -q '^FAIL' shots/enemies-fault.txt; then \
	  grep '^FAIL' shots/enemies-fault.txt | head -6; echo "enemies: PASS, check.py rejected the ENEMY_FAULT build"; \
	else cat shots/enemies-fault.txt; echo "enemies: FAIL, check.py did not reject the ENEMY_FAULT build (exit $$st)"; exit 1; fi

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

# ---- audio: the SID store trace (tools/sidtrace.py) ----------------------------------
# The autopilot build requests eight effects on scripted frames (src/sound.c); the
# -dNO_SFX=1 build requests none. tools/sidtrace.py runs both headless with a
# monitor store trace and wants: no music store to voices 1-2 while an effect
# runs, no effect store to voice 3, voice 3's stores identical in both builds,
# voices 1-2's identical outside the effects, voice 3's note-ons on the steps
# the tune data gives, one driver step a frame with as many steps as frames,
# $D418 at $0F and voice 3's pitches from the table. PAL and NTSC.
# audiotest: the -define AUDIO_FAULT build (the music writes voices 1-2 during
# an effect) must fail owned, and the -define AUDIO_DROP build (the first owed
# step after a redraw is never played) must fail frames, on both models.
PRG_NOSFX := build/$(NAME)-nosfx.prg
$(PRG_NOSFX): $(C_DEPS) $(ASM_OUT) $(METER_DEPS) | plan-gate
	@mkdir -p build
	$(OSCAR64_BUILD) -d$(AUTOPILOT_DEFINE)=1 -dNO_SFX=1 -o=$@ $(C_MAIN)
$(eval $(call variant_prg,audiofault,AUDIO_FAULT))
$(eval $(call variant_prg,audiodrop,AUDIO_DROP))

# 20,000,000 cycles: past one whole loop of the tune (768 frames) after the start-up.
AUDIO_CYCLES := 20000000
SIDTRACE = $(TIMEOUT) $(VICE_TIMEOUT) $(PYTHON) tools/sidtrace.py --x64sc '$(X64SC)'

.PHONY: audio audiotest
audio: $(PRG_AUTO) $(PRG_NOSFX)
	@mkdir -p shots
	@$(SIDTRACE) --model pal --cycles $(AUDIO_CYCLES) --sym build/kernel.sym $(PRG_AUTO) $(PRG_NOSFX) > shots/audio-pal.txt 2>&1; echo $$? > shots/audio-pal.st & \
	 $(SIDTRACE) --model ntsc --cycles $(AUDIO_CYCLES) --sym build/kernel.sym $(PRG_AUTO) $(PRG_NOSFX) > shots/audio-ntsc.txt 2>&1; echo $$? > shots/audio-ntsc.st & \
	 wait; cat shots/audio-pal.txt shots/audio-ntsc.txt; \
	 [ "$$(cat shots/audio-pal.st)" = 0 ] && [ "$$(cat shots/audio-ntsc.st)" = 0 ] || { echo "audio: FAIL"; exit 1; }
	@echo "audio: PASS"

# $(1) the variant, $(2) the check its build must fail: exit 1, a FAIL line for that
# check, and no Python traceback (a crashed checker also exits 1).
define audio_must_fail
	@for m in pal ntsc; do \
	  $(SIDTRACE) --model $$m --cycles $(AUDIO_CYCLES) --sym build/$(1)/kernel.sym --sym-nofx build/kernel.sym build/$(NAME)-$(1).prg $(PRG_NOSFX) > shots/audiotest-$(1)-$$m.txt 2>&1; st=$$?; \
	  grep '^FAIL' shots/audiotest-$(1)-$$m.txt | head -3; \
	  if [ $$st -eq 1 ] && grep -q '^FAIL .* $(2):' shots/audiotest-$(1)-$$m.txt && ! grep -q '^Traceback' shots/audiotest-$(1)-$$m.txt; then \
	    echo "audiotest: the $(1) build fails $(2) on $$m: PASS"; \
	  else cat shots/audiotest-$(1)-$$m.txt; echo "audiotest: FAIL, the $(1) build did not fail $(2) on $$m (exit $$st)"; exit 1; fi; \
	done
endef

audiotest: build/$(NAME)-audiofault.prg build/$(NAME)-audiodrop.prg $(PRG_NOSFX)
	@mkdir -p shots
	$(call audio_must_fail,audiofault,owned)
	$(call audio_must_fail,audiodrop,frames)

check: audio
selftest: audiotest
