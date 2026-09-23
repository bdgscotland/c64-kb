# shmup-vertical: a vertically scrolling shoot-em-up starter. Every target
# comes from the harness:
#   make            build build/shmup-vertical.prg (after the PLAN.md gate)
#   make run        windowed VICE, joystick in port 2
#   make shot       headless PAL and NTSC exit screenshots of the autopilot build
#   make check      grade shots/pal.png and shots/ntsc.png against expect.json
#   make selftest   prove check fails on the FORCE_FAULT=1 build
#   make disk       build/shmup-vertical.d64
#   make claims     c64-kb's claims-watch over the autopilot build, when available
#   make clean
NAME     := shmup-vertical
C_MAIN   := src/main.c
KICK_SRC := src/kernel.asm

# Pinned after the verdict: the script's 240 play frames end near 13,000,000
# cycles and the verdict's disk round trip about 21,700,000 (PAL) and
# 21,600,000 (NTSC), the $02FF store under the VICE monitor on a fresh disk.
# After it nothing on screen changes: PAL at 30,000,000 and 34,000,000 cycles
# and NTSC at 30,000,000 and 36,000,000 gave byte-identical pictures.
SHOT_CYCLES_PAL  := 30000000
SHOT_CYCLES_NTSC := 30000000

# Drive 8 is attached during make shot: the autopilot writes and reads
# HISCORE on build/shmup-vertical.d64. A pin that lands inside a write leaves
# a splat file there; make clean (or delete the .d64) before the next shot.
SHOT_DISK := 1

# What the program may write, for make claims, found by claims-watch on the
# autopilot build (30,000,000 cycles, drive 8 attached). zero_page $02-$55:
# Oscar64's registers ($02-$52) and main's callee-saved temporaries at
# $53-$55 in this build; a bigger main can reach further. The $DC0D stores
# that mask CIA1 count against all its units. The KERNAL routines are the
# disk calls of src/hiscore.c (kernalio.h) and the KERNAL IRQ that runs
# during the first load. CIA2 timers A and B are the frame meter's. The
# stack page is declared because claims-watch counts a JSR's two pushes as
# stores when an IRQ is taken straight after it: VICE logs both with the SP
# after the IRQ's three pushes (seen at main's JSR meter_print).
CLAIMS_ARGS = --cycles 30000000 --disk $(abspath $(D64)) \
  --claim 'zero_page $$02-$$55, sprite_0-7, vic_raster_irq, irq_vector_fffe, nmi_vector_fffa, sid_voice_1-3, sid_filter_volume, cia1_port_a, cia1_timer_a, cia1_timer_b, cia1_tod, cia2_vic_bank' \
  --range 'colour=$$D800-$$DBE7,result=$$02FF,stack=$$0100-$$01FF' \
  --harness 'cia2_timer_a, cia2_timer_b, cia2_tod' \
  --kernal 'SETNAM,SETLFS,OPEN,CLOSE,CHKIN,CHKOUT,CLRCHN,CHRIN,CHROUT,READST,IRQ'

# The harness sits beside the starter in c64-kb (../_harness) or is vendored
# into ./harness when the starter is copied out on its own.
HARNESS ?= $(firstword $(wildcard harness) ../_harness)
$(if $(wildcard $(HARNESS)/harness.mk),,$(error No harness at '$(HARNESS)'. Copy c64-kb's templates/_harness to ./harness, or make the project with npm run new-project in c64-kb))
include $(HARNESS)/harness.mk

# claims runs the autopilot build with the disk attached.
claims: $(D64)
