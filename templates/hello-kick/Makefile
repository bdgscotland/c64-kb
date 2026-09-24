# hello-kick: hello in KickAssembler alone, on the same harness targets as
# hello (make, run, shot, check, selftest, disk, claims, clean).
NAME     := hello-kick
KICK_SRC := src/main.asm

# Pinned as in hello: 7,000,000 and 8,000,000 cycles gave identical PAL
# pictures, 8,000,000 and 12,000,000 identical NTSC ones.
SHOT_CYCLES_PAL  := 8000000
SHOT_CYCLES_NTSC := 8000000

# What the program may write, for make claims (claims-watch's own grammar).
# See hello's Makefile for why cia2_timer_b and cia2_tod are listed as harness.
CLAIMS_ARGS := --claim 'sprite_0, cia1_port_a' --range 'screen=$$0400-$$07FF,colour=$$D800-$$DBFF,spritedata=$$0340-$$037F,result=$$02FF' --harness 'cia2_timer_a, cia2_timer_b, cia2_tod'

# drive.py's own proof: fire on $DC00 at the same frame in three runs.
VERIFY_TARGETS := joyprobe

HARNESS ?= $(firstword $(wildcard harness) ../_harness)
$(if $(wildcard $(HARNESS)/harness.mk),,$(error No harness at '$(HARNESS)'. Copy c64-kb's templates/_harness to ./harness, or make the project with npm run new-project in c64-kb))
include $(HARNESS)/harness.mk
