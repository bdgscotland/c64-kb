---
tool: agent-harness
tool_kind: reference-catalog
maintainer: bdgscotland
license: BSD-3-Clause
home_url: https://github.com/bdgscotland/c64-kb
---

<!-- doc-type: toolchain-reference -->

# The agent harness: build, run, shoot, check, measure

## Tool

`templates/_harness` is the loop every starter in `templates/` shares. A
starter's Makefile sets a few variables and includes `harness.mk`; from then
on `make shot check` builds the program, runs it headless in VICE on PAL and
on NTSC with scripted input, and grades both exit screenshots against the
expectations the starter wrote down. A frame meter prints the program's
measured cycle cost where the checker can read it back. `templates/hello`
(Oscar64 calling KickAssembler) and `templates/hello-kick` (KickAssembler
alone) are the smallest starters that use every target.

Every figure on this page was measured on 2026-09-23 with VICE x64sc 3.10
(the windowless build), KickAssembler 5.25, Oscar64 as named in `CLAUDE.md`,
c1541 from VICE 3.10 and GNU Make 3.81, unless it says otherwise.

## The loop

| Command | What it does |
|---|---|
| `make` | Checks `PLAN.md` (see "The plan gate"), then builds `build/<name>.prg` |
| `make run` | The windowed x64sc with the normal build, for a human |
| `make shot` | Builds the AUTOPILOT variant and writes `shots/pal.png` and `shots/ntsc.png` at the pinned cycle counts |
| `make check` | `check.py expect.json shots/pal.png shots/ntsc.png`; exit 1 names each failed check |
| `make selftest` | Builds with FORCE_FAULT, shoots it, and passes only if `check.py` fails |
| `make disk` | `build/<name>.d64` with the PRG and `DISK_FILES`, then lists it |
| `make claims` | c64-kb's `scripts/claims-watch.ts` over the AUTOPILOT PRG, when the checkout has it |
| `make clean` | Removes `build/` and `shots/` |

The headless runs use `-default -warp +sound +autostart-delay-random
-autostartprgmode 1 -limitcycles N`, add `-model ntsc` for NTSC, and are
wrapped in `timeout 180`. The windowless x64sc at
`~/Developer/c64/vice-headless/bin/x64sc` is used when it exists. `+sound`
selects the dummy sound driver, which breaks reads of `$D41B` and `$D41C`
(issue #2; not measured here): a program that seeds a random generator
from SID voice 3 needs another seed under the harness.

`npm run verify:templates` copies each starter with an `expect.json` to a
temporary directory, vendors `templates/_harness` into its `./harness`, and
runs `make shot check` there (`--selftest` adds `make selftest`, `--only
<name>` picks one). The copy is the real use: a starter must work outside
this repository.

## A starter's files

| File | Holds |
|---|---|
| `Makefile` | `NAME`, `C_MAIN` and/or `KICK_SRC`, `SHOT_CYCLES_PAL`, `SHOT_CYCLES_NTSC`, `CLAIMS_ARGS`, optional `DISK_FILES`, then `include $(HARNESS)/harness.mk` |
| `src/` | The program. `AUTOPILOT` selects scripted input; `FORCE_FAULT` must make the program's own verdict fail |
| `expect.json` | The checks `check.py` runs on both shots |
| `PLAN.md` | The plan, with the pasted output of `check-compatibility` and `plan-budget` |
| `CLAUDE.md` | `_harness/CLAUDE.md.template` plus a section on this starter |
| `.claude/settings.json` | `_harness/claude/settings.json`: the plan gate as a PreToolUse hook |

`HARNESS` defaults to `./harness` when a copy vendors it and to
`../_harness` inside this repository. The tools come from `OSCAR64`,
`KICKASS_JAR`, `X64SC`, `X64SC_WINDOWED`, `C1541` and `C64KB` in the
environment, else from PATH and this machine's default locations;
`make tools` prints what was found.

## Reading the screenshots

`check.py` takes its geometry and palette from
[vice-reference](../runtime/vice-reference.md), "Reading the exit
screenshot": PAL 384 x 272 with screenshot row = raster line - 16; NTSC
384 x 247 with row = line - 28, NTSC lines 0 to 11 landing on rows 235 to
246; x = VIC-II X coordinate + 8; text cell (r, c) at x = 32 + 8c,
y = 35 + 8r on PAL and 23 + 8r on NTSC; sixteen exact RGB triples per
model. Text is decoded against `chargen-901225-01.bin` (`C64_CHARGEN`
overrides the path); a cell's ink is every pixel that is not the cell's
majority colour, so the reader needs no background colour.

One geometry fact was measured here: a sprite whose Y register holds y is
drawn from raster line y + 1. hello's sprite at X 188, Y 116 covered
screenshot x 196 to 219 and rows 101 to 121 on PAL, 89 to 109 on NTSC,
504 pixels each: lines 117 to 137 on both. A check written for line y
fails; the first draft of hello's `expect.json` did.

| Check type | Passes when |
|---|---|
| `verdict` | The border sample point is colour 5. Colour 2 is the program's own FAIL; anything else means it never reached its verdict |
| `pixel` | The point has the colour index. The point is `x`/`y`, `vic_x`/`line`, or `row`/`col` (a cell's centre) |
| `text` | The cells from `row`, `col` read `text` |
| `same` | Every pixel of the `cells` rectangle has the same colour index on PAL and NTSC |
| `meter` | The meter's readout is there; optional `frames` must match, `worst` must fit `max_worst` (default one frame: 19,656 cycles PAL, 17,095 NTSC) |

The verdict follows the result-byte contract in vice-reference, "Verifying
a run without a human": `$02FF` = `$01` and a green border on pass, `$02`
and red on fail.

## Linking KickAssembler into Oscar64

Oscar64 has no object linker, and a `.prg` given on its command line is
ignored ([oscar64-reference](../toolchains/oscar64-reference.md), "Calling
KickAssembler code from Oscar64"). The old `c64-game-starter` fed one in
that way. The harness uses the placed-blob method that page describes, and
automates the addresses:

1. KickAssembler assembles `KICK_SRC` with `-binfile -vicesymbols`:
   `build/asm.bin` is the raw bytes from the lowest address, no load
   address; `build/<src>.vs` lists every label.
2. `gen-asm-header.py` writes `build/asm.h`: `ASM_ORG` from KickAssembler's
   memory map, `ASM_END` = `ASM_ORG` + the blob's size, and `ASM_<LABEL>`
   for every top-level label.
3. The C side places the blob and calls it. Oscar64 expands the macros
   inside `#pragma region` and inside `__asm`, and finds `#embed "asm.bin"`
   through `-i=build`.

hello's KickAssembler half, whole:

```asm
// sprite.asm: sprite 0 to (spr_x, spr_y); the parameters live in the blob.
* = $0900 "asm"

put_sprite:
        lda spr_x
        sta $d000
        lda $d010
        and #$fe
        ldx spr_x+1
        beq !+
        ora #$01
!:      sta $d010
        lda spr_y
        sta $d001
        rts

spr_x:  .word 0
spr_y:  .byte 0
```

The header the harness wrote from it, and the C that uses it (from
`templates/hello/src/main.c`, which `verify:templates` builds):

```text
#define ASM_ORG 0x0900
#define ASM_END 0x091f
#define ASM_SIZE 31
#define ASM_SPR_Y 0x091e
#define ASM_SPR_X 0x091c
#define ASM_PUT_SPRITE 0x0900

#pragma section( asmcode, 0 )
#pragma region( asmreg, ASM_ORG, 0x1000, , , { asmcode } )
#pragma region( main, 0x1000, 0xa000, , , { code, data, bss, heap, stack } )
#pragma data( asmcode )
__export const char asm_blob[] = {
#embed "asm.bin"
};
#pragma data( data )
...
SPR_X = x;                              // *(volatile unsigned *)ASM_SPR_X
SPR_Y = y;
__asm { jsr ASM_PUT_SPRITE }
```

Evidence, rung 1:

- `build/hello.map`: `0900 - 1000 : 091f, 001f, asmreg` and
  `0900 - 091f : asm_blob, DATA:asmcode`; `main` starts at `$1000`.
- `build/hello.asm`: `1118 : 20 00 09 JSR $0900 ; (asm_blob[0] + 0)`.
- The AUTOPILOT build moves the sprite through the scripted path, reads
  `$D000`, `$D001` and `$D010` back at frame 180, and grades them; the
  screenshots show the green border and the sprite at X 188, lines 117 to
  137, on PAL and NTSC. Only the KickAssembler routine writes those
  registers, so the call and its arguments arrived.

Rules the mechanism brings. Moving `main` to `$1000` leaves room below it
for the blob (hello's starts at `$0900`); one that grows past `$1000` fails the link with
"Could not place object". Arguments go through bytes the blob owns, not
Oscar64's zero page: the compiler's registers run from `$02` to `$52`
(`BC_REG_WORK_Y` to below `BC_REG_TMP_SAVED` in its `MachineTypes.cpp`).
The routine may change A, X and Y. A pure KickAssembler starter leaves
`C_MAIN` empty and `KICK_SRC` is the whole program.

## The frame meter

`meter/frame_meter.h` (Oscar64) and `meter/frame_meter.asm` (KickAssembler
macros) implement one contract. The program brackets one frame's work with
`METER_START` / `METER_STOP` (`FrameMeterStart()` / `FrameMeterStop()`),
then prints. The readout is `F<frames> W<worst> T<typical>`, five digits
each, 20 cells from row 24, column 20, in the power-on character set.

- **Timer.** CIA2 timer A, counting phi2 cycles, force-loaded with `$FFFF`
  at start and stopped before its two bytes are read, as in
  [raster-profile-bars](../recipes/oscar64/raster-profile-bars.md). The
  KERNAL IRQ uses CIA1 timer A and the KERNAL serial routines write CIA1
  timer B (issue #35), so neither collides. CIA2 timer A is the KERNAL's
  RS-232 bit timer: no device 2 while the meter runs. Init masks timer A's
  NMI only (`$DD0D` = `$01`).
- **What it counts.** Wall time between the two stores: badline and sprite
  DMA steals and any interrupt that lands inside the bracket are in the
  figure. The empty bracket's own count is measured once at init and
  subtracted. More than 65,535 cycles reads 65,535 (the underflow flag in
  `$DD0D`).
- **Worst** is the largest bracket recorded. **Typical** is the mean of the
  last 16 recorded frames, and 0 until 16 have been recorded. Recording
  stops after `hold` frames (0 = never), so a pinned screenshot taken later
  shows fixed figures and `check.py` can require the count.
- **Build switch.** `FRAME_METER` defaults to `AUTOPILOT`. Without it every
  macro is empty and the release carries none of the meter.

Calibration, rung 1: a 1,001-cycle loop (`ldx #200`, `dex`, `bne`: 2 +
199 x 5 + 4, arithmetic) bracketed in the lower border read `W01001
T01001` from the C meter. Frames alternating between 1,017 and 517 cycles
(the same loop with 200 or 100, plus 18 cycles of table lookup) read
`W01017 T00767` from both the C meter and the KickAssembler meter, on PAL
and on NTSC; 767 is the mean of the two.

hello's figures: worst 1,510, typical 146 cycles; hello-kick's: worst 453,
typical 136. Each is the same on PAL and NTSC because both bracket from
raster line 250, in the lower border, where no badline and no sprite DMA
falls. The worst frame is frame 180, which also grades the result and
prints it.

## The plan gate

The old starters had a `.kb-briefing-done` marker that `touch` satisfied
without reading anything. The harness checks the plan itself:
`hooks/plan-gate.sh` passes when `PLAN.md` exists, has no `FILL:` line
left, and holds a line starting `# Compatibility:` and one starting
`# Budget plan:`, the first lines `check-compatibility` and `plan-budget`
print. As a PreToolUse hook it blocks (exit 2) an Edit, MultiEdit, Write or
NotebookEdit under `src/` until then; as `make plan-gate` it stops the
build. `make PLAN_GATE=off` is the deliberate override. Measured: a
project with no `PLAN.md` was blocked with exit 2, hello was allowed with
exit 0, and `make` without `PLAN.md` stopped with "the plan is not filled".

## make claims

When `$(C64KB)/scripts/claims-watch.ts` exists, `make claims` runs it from
the c64-kb checkout over the AUTOPILOT PRG with the starter's
`CLAIMS_ARGS`; otherwise it prints that the script is not available and
exits 0. The script lands with issue #22 step 6 and is not on this branch.
Run against the copy on the `onto22-watch` branch, hello first failed:
Oscar64's zero page and the `$FF` store to `$DC00` were undeclared, and so
was the meter's one `$DD0D` store, which claims-watch counts against
`cia2_timer_b` and `cia2_tod` as well as `cia2_timer_a`. With
`zero_page $02-$52` and `cia1_port_a` claimed and all three CIA2 units
declared as harness, hello and hello-kick both report `PASS: 0 stores in 0
violation groups`.

## End-to-end transcript

`templates/hello` copied to a directory outside the repository with the
harness vendored into `./harness`, then each target run in turn. The last
lines of each:

```text
$ make
oscar64 -tm=c64 -O2 -i=<copy>/build -i=<copy>/harness/meter -o=build/hello.prg src/main.c
$ make shot check
PASS PAL+NTSC display the same on both models: cells 0,0 to 23,39 identical on PAL and NTSC
PASS PAL      frame meter: frames 200, worst 1510, typical 146 cycles (CIA2 timer A; limit 19656)
PASS NTSC     frame meter: frames 200, worst 1510, typical 146 cycles (CIA2 timer A; limit 17095)
check: 19 of 19 passed
$ make selftest
selftest: PASS, check.py rejected the FORCE_FAULT build
$ make disk
0 "HELLO           " 01 2a
10   "hello"            prg
654 blocks free.
$ make claims
claims: not available. <copy>/../../scripts/claims-watch.ts does not exist (it lands in c64-kb with issue #22 step 6).
claims: set C64KB=/path/to/c64-kb to a checkout that has it. Nothing was checked.
$ make claims C64KB=<a checkout of onto22-watch>
PASS: 0 stores in 0 violation groups
$ mv PLAN.md PLAN.bak; make
plan-gate: the plan is not filled, so nothing is built.
  PLAN.md does not exist: copy it from the harness's PLAN.md.template
$ npm run verify:templates -- --selftest          # from this repository
verify-templates: 2 of 2 starters passed
```

The disk image boots: `x64sc -autostart build/hello.d64` for 25,000,000
cycles on PAL showed `HELLO HARNESS` on row 1 and the black border. The
shots are stable: hello's PAL picture at 7,600,000 and 8,000,000 cycles,
and its NTSC picture at 8,000,000 and 12,000,000, were identical pixel for
pixel, because nothing on screen changes after the meter's hold.

## Writing a starter

1. Copy `templates/hello` (C with a KickAssembler part) or
   `templates/hello-kick` (KickAssembler alone) to `templates/<name>`.
2. Fill `PLAN.md` from `game-briefing`, `check-compatibility` and
   `plan-budget` before any code.
3. Give the program an AUTOPILOT script that plays, a verdict at a fixed
   frame that reads real state back, and a FORCE_FAULT that turns it red.
4. Keep row 24, columns 20 to 39 free in AUTOPILOT builds, or move the
   meter and say so in `expect.json`. Call the meter around the whole
   frame's work, including any IRQ work you want counted.
5. Write `expect.json`: the verdict, the text, the pixels that prove the
   feature, a `same` rectangle, the meter with its `frames`.
6. Pin `SHOT_CYCLES_*` after the hold and after the verdict, where the
   screen no longer changes; prove it with two pins.
7. `make shot check selftest disk`, then `npm run verify:templates --
   --only <name> --selftest`.

## Not measured here

- The settings.json hook wrapper string was not executed by Claude Code in
  this session; `plan-gate.sh` itself was run in hook mode with a sample
  tool call.
- A starter that uses `SHOT_DISK=1`, `DISK_FILES` or a raster IRQ inside
  the meter's bracket. hello and hello-kick use none of them.
- Any VICE other than 3.10, or a palette other than `-default`; `check.py`
  matches exact triples and would fail closed.
- The released Oscar64 (issue #25): the starters were built with the
  build `CLAUDE.md` names.
- Real hardware.

## See also

- [vice-reference](../runtime/vice-reference.md), "Reading the exit screenshot" and "Verifying a run without a human"
- [oscar64-reference](../toolchains/oscar64-reference.md), "Calling KickAssembler code from Oscar64"
- [release-disk](../toolchains/release-disk.md), for a release image
- Recipes: [oscar64/headless-verify](../recipes/oscar64/headless-verify.md),
  [kickassembler/headless-verify](../recipes/kickassembler/headless-verify.md),
  [oscar64/raster-profile-bars](../recipes/oscar64/raster-profile-bars.md)
