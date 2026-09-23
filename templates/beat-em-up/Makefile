# beat-em-up: the side-on brawler starter. Every target but flickercheck
# and joy comes from the harness:
#   make              build build/beat-em-up.prg (after the PLAN.md gate)
#   make run          windowed VICE, joystick in port 2
#   make shot         headless PAL and NTSC exit screenshots of the autopilot build
#   make check        grade shots/pal.png and shots/ntsc.png against expect.json
#   make selftest     prove check fails on the FORCE_FAULT=1 build
#   make flickercheck shoot the autopilot run inside its three photo stops and
#                     match the fighter band pixel for pixel against a render
#                     of the table the program printed (tools/flickercheck.py);
#                     then prove the check fails on the FLICKER_DEMO=1 build
#   make joy          the normal game reading its port byte from $02FE, for tools/drive.py
#   make disk         build/beat-em-up.d64
#   make claims       c64-kb's claims-watch over the autopilot build
#   make clean
NAME     := beat-em-up
C_MAIN   := src/main.c
KICK_SRC := src/engine.asm

# Pinned after the verdict (about frame 5,000: 100M cycles on PAL, 88M on
# NTSC), where nothing on the screen changes: 120M and 140M gave identical
# PAL pictures, 110M and 130M identical NTSC ones (VICE x64sc 3.10).
SHOT_CYCLES_PAL  := 120000000
SHOT_CYCLES_NTSC := 110000000

CLAIMS_ARGS :=

# The harness sits beside the starter in c64-kb (../_harness) or is vendored
# into ./harness when the starter is copied out on its own.
HARNESS ?= $(firstword $(wildcard harness) ../_harness)
$(if $(wildcard $(HARNESS)/harness.mk),,$(error No harness at '$(HARNESS)'. Copy c64-kb's templates/_harness to ./harness, or make the project with npm run new-project in c64-kb))
include $(HARNESS)/harness.mk
