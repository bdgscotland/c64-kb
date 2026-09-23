# hello-kick: hello in KickAssembler alone, on the same harness targets as
# hello (make, run, shot, check, selftest, disk, claims, clean).
NAME     := hello-kick
KICK_SRC := src/main.asm

# Pinned after the meter's 200 recorded frames, as in hello.
SHOT_CYCLES_PAL  := 8000000
SHOT_CYCLES_NTSC := 8000000

# What the program may write, for make claims (claims-watch's own grammar).
# See hello's Makefile for why cia2_timer_b and cia2_tod are listed as harness.
CLAIMS_ARGS := --claim 'sprite_0, cia1_port_a' --range 'screen=$$0400-$$07FF,colour=$$D800-$$DBFF,spritedata=$$0340-$$037F,result=$$02FF' --harness 'cia2_timer_a, cia2_timer_b, cia2_tod'

HARNESS ?= $(firstword $(wildcard harness) ../_harness)
include $(HARNESS)/harness.mk
