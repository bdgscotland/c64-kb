# hello: the minimal starter. Every target comes from the harness:
#   make            build build/hello.prg (after the PLAN.md gate)
#   make run        windowed VICE, joystick in port 2
#   make shot       headless PAL and NTSC exit screenshots of the autopilot build
#   make check      grade shots/pal.png and shots/ntsc.png against expect.json
#   make selftest   prove check fails on the FORCE_FAULT=1 build
#   make disk       build/hello.d64
#   make claims     c64-kb's claims-watch over the autopilot build, when available
#   make clean
NAME     := hello
C_MAIN   := src/main.c
KICK_SRC := src/sprite.asm

# Pinned after the script's 144 play frames and the grade at frame 150. From
# then on nothing on the screen changes, so the pin can land anywhere in the
# frame: 7,000,000 and 8,000,000 cycles gave byte-identical PAL pictures,
# 8,000,000 and 12,000,000 identical NTSC ones (VICE x64sc 3.10, windowless).
SHOT_CYCLES_PAL  := 8000000
SHOT_CYCLES_NTSC := 8000000

# What the program may write, for make claims (claims-watch's own grammar).
# zero_page $02-$55: Oscar64's fixed registers start at BC_REG_WORK_Y ($02)
# and each function's temporaries run from BC_REG_TMP ($43) up by its own
# temp count, past BC_REG_TMP_SAVED ($53), so the top depends on the program.
# Measured, not assumed: `make zp` lists what this build's code touches ($43
# to $55 here), and claims-watch saw stores to $53-$55. An earlier version
# claimed $02-$52 and failed make claims with 309 stores to $53-$55. IRQ is
# declared because the KERNAL's IRQ handler runs and writes its own zero page.
# The meter's one $DD0D store ($01: mask timer A only) is listed under
# cia2_timer_b and cia2_tod too, because claims-watch maps any $DD0D store
# to every CIA2 source; so all three are declared as harness.
CLAIMS_ARGS := --claim 'sprite_0, cia1_port_a, zero_page $$02-$$55' --kernal IRQ --range 'screen=$$0400-$$07FF,colour=$$D800-$$DBFF,spritedata=$$0340-$$037F,result=$$02FF' --harness 'cia2_timer_a, cia2_timer_b, cia2_tod'

# The harness sits beside the starter in c64-kb (../_harness) or is vendored
# into ./harness when the starter is copied out on its own.
HARNESS ?= $(firstword $(wildcard harness) ../_harness)
$(if $(wildcard $(HARNESS)/harness.mk),,$(error No harness at '$(HARNESS)'. Copy c64-kb's templates/_harness to ./harness, or make the project with npm run new-project in c64-kb))
include $(HARNESS)/harness.mk
