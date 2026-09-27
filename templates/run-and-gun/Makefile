# run-and-gun (FIREBASE): a vertical run-and-gun starter. Every target but
# assets, assetcheck, mapend, phases, enemies, blasts, weapons, weaponsfault,
# audio, audiotest, frontend, fedrive, longplay, collide, death, area,
# fullpool, title and cleared comes from the harness:
#   make            build build/run-and-gun.prg (after the PLAN.md gate)
#   make run        windowed VICE, joystick in port 2
#   make shot       headless PAL and NTSC exit screenshots of the autopilot build
#   make check      grade shots/pal.png and shots/ntsc.png against expect.json
#   make selftest   prove check fails on the FORCE_FAULT=1 build
#   make drive      the normal game played headless (harness/drive.py), stick on $DC00
#   make gallery    shots/gallery.png: the normal game in play, for a README
#   make title      shots/title.png: the title screen, for a README
#   make enemies    the enemies' own proof (expect-enemies.json) and its ENEMY_FAULT build
#   make blasts     enemy grenade blasts expire: expect-blasts.json, and its BLAST_FAULT build must fail
#   make assets     re-run tools/mkassets.py, tools/mkweapons.py and tools/mktune.py (src/gen/ is committed)
#   make assetcheck the committed src/gen/ is what the tool writes now
#   make weapons    the -dWEAPONS=1 build: shots and grenades played and graded (expect-weapons.json)
#   make weaponsfault  its WEAPONS_FAULT build (autofire) must fail those checks
#   make audio      the SID store trace: effects on voices 1-2, the tune on voice 3 in time
#   make audiotest  its AUDIO_FAULT and AUDIO_DROP builds must fail the trace
#   make longplay   the normal game (99 lives) driven 2,700 frames on PAL and NTSC: no lost frame, redraw lead
#   make collide    kills by bullet and blast, score per kind, a death by an enemy and its restart
#   make death      three deaths on the swamp, checkpoint restarts, grenades topped up, game over
#   make area       the gate wave, the walk into the gate, the bonus, the beat, the next area
#   make fullpool   area 3's gate wave fills all 11 pool slots under fire: no lost frame
#   make cleared    shots/cleared.png: the AREA CLEARED beat, for the README
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

# make gallery: the normal build in play for the README, driven by
# tools/gallery.py (drive.py with a port-1 "throw" step): fire on the title,
# ten taps up while the runner of map row 88 crosses (150 points), right under
# the grenadier, up to face up, a grenade, two more shots, and the picture as
# the blast lands on him (200 more). make title: the title screen, for the README.
# make cleared: the AREA CLEARED beat for the README (shots/cleared.png), make
# area's PAL pin: shot mid-run, before the build draws its verdict or meter.
GALLERY_LAST ?= 10
GALLERY_DRIVER := tools/gallery.py
GALLERY_SCRIPT := "until:PUSH FIRE" wait:10 tap:fire wait:2 \
	tap:fire tap:fire tap:fire tap:fire tap:fire tap:fire tap:fire tap:fire tap:fire tap:fire \
	hold:right wait:132 hold:up wait:8 hold:none throw tap:fire tap:fire wait:$(GALLERY_LAST) print

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
VERIFY_TARGETS := mapend enemies blasts weapons weaponsfault audio audiotest frontend fedrive longplay \
	collide death area fullpool
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

# ---- blasts: every enemy grenade blast expires (issue #133) -------------------------
# The -dBLASTTEST=1 autopilot build (src/main.c, BLASTTEST) spawns enemy
# grenade blasts on blocking cells with the pool filled while the map scrolls
# (the redraw pair's think skip and the objects' deadline run over their
# lives) and freezes on play frame 260. Its verdict (main.c first_fail_blasts)
# wants every blast freed by age 20 and within BLAST_FRAMES_MAX frames of the
# frame it became one; expect-blasts.json pins the counts on PAL and NTSC.
# The BLAST_FAULT=1 build (the blast's age check dropped: the code Oscar64
# -O2 generated before the fix) must fail those checks.
PRG_BLASTS := build/$(NAME)-blasts.prg
PRG_BLASTS_FAULT := build/$(NAME)-blastsfault.prg
$(PRG_BLASTS): $(C_DEPS) $(ASM_OUT) $(METER_DEPS) | plan-gate
	@mkdir -p build
	$(OSCAR64_BUILD) -d$(AUTOPILOT_DEFINE)=1 -dBLASTTEST=1 -o=$@ $(C_MAIN)
$(PRG_BLASTS_FAULT): $(C_DEPS) $(ASM_OUT) $(METER_DEPS) | plan-gate
	@mkdir -p build
	$(OSCAR64_BUILD) -d$(AUTOPILOT_DEFINE)=1 -dBLASTTEST=1 -dBLAST_FAULT=1 -o=$@ $(C_MAIN)

.PHONY: blasts
blasts: $(PRG_BLASTS) $(PRG_BLASTS_FAULT)
	$(call vice_shot,$(PRG_BLASTS),$(SHOT_CYCLES_PAL),,shots/blasts-pal.png)
	$(call vice_shot,$(PRG_BLASTS),$(SHOT_CYCLES_NTSC),-model ntsc,shots/blasts-ntsc.png)
	$(PYTHON) $(HARNESS_DIR)/check.py expect-blasts.json shots/blasts-pal.png shots/blasts-ntsc.png
	$(call vice_shot,$(PRG_BLASTS_FAULT),$(SHOT_CYCLES_PAL),,shots/blastsfault-pal.png)
	$(call vice_shot,$(PRG_BLASTS_FAULT),$(SHOT_CYCLES_NTSC),-model ntsc,shots/blastsfault-ntsc.png)
	@$(PYTHON) $(HARNESS_DIR)/check.py expect-blasts.json shots/blastsfault-pal.png shots/blastsfault-ntsc.png > shots/blastsfault.txt 2>&1; st=$$?; \
	if [ $$st -eq 1 ] && grep -q '^FAIL' shots/blastsfault.txt; then \
	  grep '^FAIL' shots/blastsfault.txt | head -6; echo "blasts: PASS, check.py rejected the BLAST_FAULT build"; \
	else cat shots/blastsfault.txt; echo "blasts: FAIL, check.py did not reject the BLAST_FAULT build (exit $$st)"; exit 1; fi

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
FE_CYCLES_PAL  := 26000000
FE_CYCLES_NTSC := 23000000
# Pins, each in the middle of its screen's window on that model (measured by a
# sweep of shots every 1,000,000 cycles; PLAN.md, "Front end"). The entry pin
# is before the name is typed; the table and the verdict show it filed. Since
# the deaths run their animation and restarts (wave 2) the game over comes on
# play frame 314, not about 135: every pin moved 179 frames (3.5 million
# cycles on PAL, 3.1 on NTSC), each checked by a shot.
FE_OVER_PAL  := 10500000
FE_OVER_NTSC := 9900000
FE_ENTRY_PAL  := 12900000
FE_ENTRY_NTSC := 11700000
FE_TABLE_PAL  := 16500000
FE_TABLE_NTSC := 15100000
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

# ---- longplay: the combined budget on the normal build ---------------------------------
# tools/longplay.py drives the normal build (no autopilot) through harness/drive.py
# for 2,700 frames: up (scrolling to the map's top), taps and bursts of fire, the
# diagonals, left, right and down, with the enemies, weapons and music all up.
# It reads the game's own counters from RAM (addresses from build/$(NAME).map)
# and fails on a lost frame ($02FD), a late redraw, a redraw lead under 8 lines,
# or a frame after a redraw that ended past line 250. PLAN.md, "Combined budget".
# Since collisions (wave 2) the soldier dies on the way: the drive plays the
# normal game with START_LIVES 99, so its deaths and checkpoint restarts are
# inside the one game it measures (three lives ended it within 600 frames).
LONGPLAY = HARNESS_DIR='$(HARNESS_DIR)' X64SC='$(X64SC)' $(TIMEOUT) $(VICE_TIMEOUT) $(PYTHON) tools/longplay.py
PRG_LONGPLAY := build/$(NAME)-longplay.prg
$(PRG_LONGPLAY): $(C_DEPS) $(ASM_OUT) $(METER_DEPS) | plan-gate
	@mkdir -p build
	$(OSCAR64_BUILD) -dSTART_LIVES=99 -o=$@ $(C_MAIN)
.PHONY: longplay
longplay: $(PRG_LONGPLAY)
	@mkdir -p shots
	@$(LONGPLAY) --model pal $(PRG_LONGPLAY) build/$(NAME)-longplay.map > shots/longplay-pal.txt 2>&1; echo $$? > shots/longplay-pal.st & \
	 $(LONGPLAY) --model ntsc $(PRG_LONGPLAY) build/$(NAME)-longplay.map > shots/longplay-ntsc.txt 2>&1; echo $$? > shots/longplay-ntsc.st & \
	 wait; cat shots/longplay-pal.txt shots/longplay-ntsc.txt; \
	 [ "$$(cat shots/longplay-pal.st)" = 0 ] && [ "$$(cat shots/longplay-ntsc.st)" = 0 ] || { echo "longplay: FAIL"; exit 1; }
	@echo "longplay: PASS"

# ---- title: the title screen for the README ---------------------------------------------
.PHONY: title
title: $(PRG)
	@mkdir -p shots
	@rm -f shots/title.png
	HARNESS_DIR='$(HARNESS_DIR)' DRIVE_EXITSHOT=shots/title.png DRIVE_SCREEN='$(DRIVE_SCREEN)' X64SC='$(X64SC)' $(TIMEOUT) $(VICE_TIMEOUT) $(PYTHON) $(HARNESS_DIR)/drive.py $(PRG) "until:PUSH FIRE TO START" wait:20 print
	@test -s shots/title.png || { echo "title: FAIL, VICE wrote no shots/title.png"; exit 1; }
	@echo "title: shots/title.png"

# ---- wave 2: collisions, death and checkpoints, the area end -----------------------------
# Each is its own autopilot build graded by its expect-*.json on PAL and NTSC.
#   make collide   -dCOLLIDETEST=1: kills by bullet and blast, the score per kind, a death
#                  by an enemy; collide()'s cost (src/collide_test.h). Its walk and
#                  timings were re-cut for issue #133's fix (blasts expire at age 20):
#                  the death is now the fresh blast of the grenade the grenadier threw
#                  on 297 (age 8 at the hit, play frame 384 PAL / 386 NTSC). The old
#                  walk stood in the box of the grenade thrown on 178 and died on its
#                  blast at age 155 (play frame 413), a blast that stayed alive only
#                  because the expiry compare was dropped. Every pinned figure is
#                  unchanged; only the walk's timings moved.
#   make death     -dDEATHTEST=1: three deaths on the swamp, checkpoint restarts, grenades
#                  topped up, a life each, game over (src/death_test.h)
#   make area      -dAREATEST=1: the gate wave, the walk, the bonus, the next area (src/area_test.h)
#   make fullpool  -dFULLPOOL=1: area 3's gate wave (12) fills all 11 pool slots, then shots
#                  and blasts into it, no lost frame (src/area_test.h)
define wave2_test
PRG_$(2) := build/$(NAME)-$(1).prg
$$(PRG_$(2)): $$(C_DEPS) $$(ASM_OUT) $$(METER_DEPS) | plan-gate
	@mkdir -p build
	$$(OSCAR64_BUILD) -d$$(AUTOPILOT_DEFINE)=1 -d$(2)=1 -o=$$@ $$(C_MAIN)
.PHONY: $(1)
$(1): $$(PRG_$(2))
	$$(call vice_shot,$$(PRG_$(2)),$(3),,shots/$(1)-pal.png)
	$$(call vice_shot,$$(PRG_$(2)),$(3),-model ntsc,shots/$(1)-ntsc.png)
	$$(PYTHON) $$(HARNESS_DIR)/check.py expect-$(1).json shots/$(1)-pal.png shots/$(1)-ntsc.png
endef
$(eval $(call wave2_test,collide,COLLIDETEST,20000000))
$(eval $(call wave2_test,death,DEATHTEST,20000000))
$(eval $(call wave2_test,area,AREATEST,20000000))
# The AREA CLEARED beat, shot inside the same run: its window is play frames
# 211-311, about 7.6-9.6 million cycles on PAL and 7.3-9.0 on NTSC (a sweep of
# shots every 1,000,000 cycles); each pin is in the middle.
AREA_BEAT_PAL  := 8600000
AREA_BEAT_NTSC := 8100000
area: area-beat
.PHONY: area-beat cleared
cleared: area-beat
	cp shots/area-beat-pal.png shots/cleared.png
	@echo "cleared: shots/cleared.png"
area-beat: $(PRG_AREATEST)
	$(call vice_shot,$(PRG_AREATEST),$(AREA_BEAT_PAL),,shots/area-beat-pal.png)
	$(call vice_shot,$(PRG_AREATEST),$(AREA_BEAT_NTSC),-model ntsc,shots/area-beat-ntsc.png)
	$(PYTHON) $(HARNESS_DIR)/check.py expect-area-beat.json shots/area-beat-pal.png shots/area-beat-ntsc.png
$(eval $(call wave2_test,fullpool,FULLPOOL,20000000))
