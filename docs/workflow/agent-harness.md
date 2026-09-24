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

## Starting a project

```bash
npm run new-project -- hello ~/c64/mygame        # or hello-kick; --list names the starters
```

`scripts/new-project.ts` copies the starter whole, dotfiles included,
vendors `templates/_harness` into `<dir>/harness`, writes `.mcp.json` with
this checkout's absolute `dist/cli.js`, and writes `local.mk` (read by the
harness first) with `C64KB` set to this checkout and the tool paths this
machine has. It proves the copy with `make shot check`, then renames the
starter's `PLAN.md` to `PLAN-<starter>-example.md` and puts a blank one in
its place, so the new program is held by the plan gate until its own plan
is filled.

## The loop

| Command | What it does |
|---|---|
| `make` | Builds `build/<name>.prg` once `PLAN.md` passes (see "The plan gate") |
| `make run` | The windowed x64sc with the normal build, for a human; joystick port 2 on the numeric keypad (8 2 4 6, fire 0) |
| `make shot` | Builds the AUTOPILOT variant and writes `shots/pal.png` and `shots/ntsc.png` at the pinned cycle counts |
| `make check` | `check.py expect.json shots/pal.png shots/ntsc.png`; exit 1 names each failed check |
| `make selftest` | Builds with FORCE_FAULT and shoots it; passes only when `check.py` exits 1 with FAIL lines |
| `make disk` | `build/<name>.d64` with the PRG and `DISK_FILES`, then lists it |
| `make claims` | c64-kb's `scripts/claims-watch.ts` over the AUTOPILOT PRG, when the checkout has it |
| `make released` | With `OSCAR64_RELEASED=<path>`: the autopilot build from that compiler, shot on PAL and NTSC and graded with the same `expect.json`. On v1.32.273, platformer graded 7 of 23 (a miscompile, #30) and action-puzzle 41 of 41 |
| `make zp` | The zero-page addresses the compiled C touches, read from Oscar64's listing; with `ZP_CLAIM='$02-$55'` a gate |
| `make drive STEPS='...'` | The normal build played headless by `harness/drive.py`, the stick on the real `$DC00` (see "Driving the normal build") |
| `make drivetest` | The starter's `DRIVE_STEPS` played that way; fails when a step never comes |
| `make joyprobe` | `drive.py`'s own proof: a fire press at the same frame in three runs |
| `make clean` | Removes `build/` and `shots/` |

The headless runs use `-default -warp +sound +autostart-delay-random
-autostartprgmode 1 -limitcycles N`, add `-model ntsc` for NTSC, and are
wrapped in `timeout 180`. The windowless x64sc at
`~/Developer/c64/vice-headless/bin/x64sc` is used when it exists. A shot is
re-taken when the PRG, the starter's Makefile or the pin changes: the pin
is a stamp file named by its cycle count.

`npm run verify:templates` makes a project from each starter with an
`expect.json`, as new-project does, in a temporary directory, and runs
`make`, `make shot check` and `make disk` there (`--selftest` adds
`make selftest` and every target the starter lists in `VERIFY_TARGETS`,
`--only <name>` picks one). A starter's own proof targets (action-puzzle's
`disktest`, `modelcheck`, `selftest-scan` and `drivetest`, adventure's
`disktest` and `drivetest`, platformer's `tearcheck`, `stage` and
`drivetest`, shmup-vertical's `stage`, `joytest` and `longplay`, demo's
`probe`, hello-kick's `joyprobe`, racing's `roadcheck` and `mutants`) prove
fixes that `make check` cannot see: the adventure's three save-validation
checks, for instance, fail only in `disktest`. Measured 2026-09-24: eight
starters with `--selftest` and their targets, 8 of 8, about 10 minutes, most
of it shmup-vertical's `joytest` and `longplay` (seven starters took about
3.5 minutes on 2026-09-23, before those two stepped by emulated frames).
The racing starter, added after that run, took 68 seconds alone
(`--only racing --selftest`, measured 2026-09-24; `mutants` runs its twelve
shots four at a time).

## A starter's files

| File | Holds |
|---|---|
| `Makefile` | `NAME`, `C_MAIN` and/or `KICK_SRC`, `SHOT_CYCLES_PAL`, `SHOT_CYCLES_NTSC`, `CLAIMS_ARGS`, optional `DISK_FILES`, then `include $(HARNESS)/harness.mk`, with a clear error when the harness is missing |
| `src/` | The program. `AUTOPILOT` selects scripted input; `FORCE_FAULT` must make the program's own verdict fail and move something a screenshot check sees |
| `expect.json` | The checks `check.py` runs on both shots |
| `PLAN.md` | The plan, with the pasted output of `check-compatibility` and `plan-budget` |
| `CLAUDE.md` | `_harness/CLAUDE.md.template` plus a section on this starter |
| `.claude/settings.json` | `_harness/claude/settings.json`: the plan gate as a PreToolUse hook |

`HARNESS` is `./harness` in a project and `../_harness` inside this
repository. The tools come from `local.mk`, then `OSCAR64`, `KICKASS_JAR`,
`X64SC`, `X64SC_WINDOWED`, `C1541` and `C64KB` in the environment, then
PATH and this machine's default locations; `make tools` prints them.

## Reading the screenshots

`check.py` takes its geometry and palette from
[vice-reference](../runtime/vice-reference.md), "Reading the exit
screenshot": PAL 384 x 272 with screenshot row = raster line - 16; NTSC
384 x 247 with row = line - 28, NTSC lines 0 to 11 landing on rows 235 to
246; x = VIC-II X coordinate + 8; text cell (r, c) at x = 32 + 8c,
y = 35 + 8r on PAL and 23 + 8r on NTSC; sixteen exact RGB triples per
model.

PAL is `-default`'s machine. Do not pass `-model pal`: it selects a 6569R3
whose palette differs in eleven of sixteen colours (measured with the
palette-cells recipe: green (94, 214, 56), not (98, 213, 50)). `check.py`
refuses a PAL shot in that palette by name (exit 2); an earlier version
graded it colour by colour and failed it with "unknown colour".

One geometry fact was measured here: a sprite whose Y register holds y is
drawn from raster line y + 1. hello's sprite at X 188, Y 116 covered
screenshot x 196 to 219 and rows 101 to 121 on PAL, 89 to 109 on NTSC,
504 pixels each: lines 117 to 137 on both. A check written for line y
fails; the first draft of hello's `expect.json` did.

`check.py` validates `expect.json` before it grades: at least one check and
one `verdict` check, the keys each type needs, colours 0 to 15, and every
point and area inside the picture on each model the check names. A fault
is exit 2 with the check's name, never a pass and never a traceback. A pin
taken inside a run, before the program can have reached its verdict, says
`"mid_run": true` and needs no `verdict` check.

Exit codes: 0 every check passed, 1 at least one failed (a `FAIL` line
names each), 2 nothing was graded. A refusal prints one line starting
`FAIL REFUSED` on stdout as well as the reason on stderr, so a caller that
greps for `FAIL` sees it, but a caller must test the exit code, never the
text. Before, a refusal went to stderr only, and the MEASURED demo's
verify script, which grepped stdout for `FAIL`, graded five refused expect
files as five passes for a day (#42).

| Check type | Passes when |
|---|---|
| `verdict` | The border sample point is colour 5. Colour 2 is the program's own FAIL; anything else means it never reached its verdict |
| `pixel` | The point has the colour index. The point is `x`/`y`, `vic_x`/`line`, or `row`/`col` (a cell's centre) |
| `rect` | Every pixel of an area (`vic_x`, `line`, `width`, `height`) has the colour: a raster bar, or a span with height 1 |
| `sprite` | The pixels of the colour inside `search` (default the expected box grown by 16) have exactly the expected bounding box |
| `ink` | At least `min` pixels of an area are not the `background` colour (default 0); optional `max`, and `colours` (the only indices they may take). For things drawn in an area at no fixed place, such as orbiting sprites: take `min` from the smallest count over every phase |
| `text` | The cells from `row`, `col` read `text` |
| `same` | Every pixel of the `cells` rectangle, or of an `area`, has the same colour index on PAL and NTSC |
| `meter` | The meter's readout is there; optional `frames` must match; worst fits `max_worst` (default one frame: 19,656 cycles PAL, 17,095 NTSC); typical is at least 1 (recording has finished) |

Text is decoded against the power-on ROM set (`chargen-901225-01.bin`;
`C64_CHARGEN` overrides the path), or `"charset": "rom-lower"`, or a
2,048-byte glyph file named by the check, with or without a two-byte load
address. A cell's ink is every pixel that is not its majority colour, so no
background colour is needed; multicolour cells do not decode. The meter's
cells need glyphs for 0 to 9, F, W and T in the set on screen.

The verdict follows the result-byte contract in vice-reference, "Verifying
a run without a human": `$02FF` = `$01` and a green border on pass, `$02`
and red on fail.

## Linking KickAssembler into Oscar64

Oscar64 has no object linker, and a `.prg` given on its command line is
ignored ([oscar64-reference](../toolchains/oscar64-reference.md), "Calling
KickAssembler code from Oscar64"). The old `c64-game-starter`, since removed, fed
one in that way. The harness uses the placed-blob method that page describes, and
automates the addresses:

1. KickAssembler assembles `KICK_SRC` with `-binfile -symbolfile`:
   `build/asm.bin` is the raw bytes from the lowest address, no load
   address; `build/<src>.sym` holds every label with its scope.
2. `gen-asm-header.py` writes `build/asm.h`: `ASM_ORG` from KickAssembler's
   memory map, `ASM_END` = `ASM_ORG` + the blob's size, `ASM_<LABEL>` for a
   top-level label and `ASM_<SCOPE>_<LABEL>` inside a scope or namespace. It
   refuses, naming both, two labels that give one name (`put_sprite` and
   `Put_Sprite`), and a label that would redefine `ASM_ORG`, `ASM_END`,
   `ASM_SIZE` or `ASM_H`. The `.sym` file is read, not the `-vicesymbols`
   file, because the latter flattens scopes into `loop__0`, `loop__1`,
   names that change with source order.
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
#if ASM_ORG < 0x0880
#error "the KickAssembler blob starts below $0880, over the Oscar64 startup code: raise its * = address"
#endif
#define ASM_PUT_SPRITE 0x0900
#define ASM_SPR_X 0x091c
#define ASM_SPR_Y 0x091e

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
  `$D000`, `$D001` and `$D010` back at frame 150, and grades them; the
  screenshots show the green border and the sprite at X 188, lines 117 to
  137, on PAL and NTSC. Only the KickAssembler routine writes those
  registers, so the call and its arguments arrived.

Rules that follow from the mechanism. The blob lives between `$0880` and `$1000`.
Below `$0880` it would overlap Oscar64's startup code, which the linker
allows in silence (a blob at `$0810` linked, and the program never
started); `asm.h`'s `#error` stops that build with "error 3032: the
KickAssembler blob starts below $0880". Past `$1000` the link fails with
"Could not place object". Arguments go through bytes the blob owns, not
Oscar64's zero page. The compiler's fixed registers start at `$02`
(`BC_REG_WORK_Y`) and each function's temporaries run from `$43`
(`BC_REG_TMP`) up by that function's own temp count, past
`BC_REG_TMP_SAVED` (`$53`): temps above it are saved and restored around
calls but still live in zero page (`MachineTypes.cpp`, `InterCode.cpp`,
read). So the top depends on the program; `make zp` reads it from the
build's listing (see "Zero page a build uses"). An earlier version of this
paragraph gave `$02` to `$52` as the whole range; hello's code reaches
`$55`, platformer's `$5B`, shmup-vertical's `$5D`.
The routine may change A, X and Y. A pure KickAssembler starter leaves
`C_MAIN` empty and `KICK_SRC` is the whole program.

## Zero page a build uses

`zp-used.py` reads the `.asm` listing Oscar64 writes beside the PRG. A
listed instruction two bytes long that is not immediate and not a branch
addresses zero page through its second byte; the BASIC stub at
`$0801`-`$080C`, which the listing decodes as instructions, is skipped.
It sees the compiled C and inline `__asm`; a KickAssembler blob is data
in the listing, so its zero page is what its own source says.

Measured on 2026-09-23 with the local Oscar64: hello's code touches
`$0D`-`$11`, `$13`, `$16`, `$19`-`$20`, `$23`-`$24` and `$43`-`$55` (plus
`$00` from the startup's indexed clear); platformer's reaches `$5B` and
shmup-vertical's `$5D`. claims-watch agreed on hello: its run stored to
`$53`-`$55`, outside the `$02`-`$52` it then claimed.

## Text under another YSCROLL

`text` and `meter` checks read cells on the grid a screen with YSCROLL 3
draws (rows start on line 51 + 8r). A panel that starts on another line,
as the one under a vertically scrolled playfield does (YSCROLL 7, rows on
line 55 + 8r), is read with `"dy": 4`: the pixel offset below that grid,
0 to 7. Measured on a panel at line 215 with YSCROLL 7: with `"dy": 4` the
score row decoded as written, without it every cell read `?`.

## The SID sink

The headless runs pass `+sound` unless the starter sets `SOUND_SINK`.
Under `+sound`, and under VICE's dummy sink, `$D41B` (OSC3) and `$D41C`
(ENV3) read wrong values; a program that reads them sets
`SOUND_SINK := dump` (`-sound -sounddev dump -soundarg /dev/null`), and
`drive.py` follows it. The measurements are in vice-reference, "The SID
under `+sound`". An earlier version of this page withdrew issue #2's claim
that the dummy driver breaks these reads, because a review read 16
different values from a noise voice under `+sound`; measured since, those
values were a wrapping ramp, not noise, and the dummy sink froze both
registers.

## A fresh disk per run

With `SHOT_DISK = 1` each headless run attaches its own copy of
`build/<name>.d64` (`shots/pal.d64`, `shots/ntsc.d64`), made just before the
run. VICE writes a save back into the image it attached, so two runs on one
shared image start from different disks and the pinned shot moves. Measured
with hello and `SHOT_DISK=1`: two `make shot` runs gave byte-identical
PNGs and `build/hello.d64` kept its checksum.

The shots autostart the PRG with the disk attached; they do not load it
from the disk. The INTERCEPTOR review (#44, reported on #42, not re-measured
here) saw pitfall `first_open_after_reset_hangs_on_pal` hang 9 of 9 PAL
builds started that way, and none when the same PRG was loaded from the
D64. A starter whose first disk call comes soon after the start must pass
it on PAL in `make shot`, and should prove it once from the disk as well
(action-puzzle's `disktest` loads its release from the D64).

## Driving the normal build

`harness/drive.py PRG STEP...` plays a program over VICE's binary monitor:
`hold:DIR`, `tap:DIR`, `wait:FRAMES`, `run:SECONDS`, `until:TEXT`,
`type:TEXT`, `key:RETURN`, `peek:ADDR` and `print`. It reads screen RAM as
text, at the regions `DRIVE_SCREEN` names (`0400:0-24` by default,
`C800:21-24` for a HUD page). `make drive STEPS='...'` runs it on the normal
build; `make drivetest` runs the starter's `DRIVE_STEPS`.

The stick is the real `$DC00`: control port 2 holds VICE's Joyport I/O
simulation device, whose lines the monitor's Joyport Set command drives.
Time is emulated frames, each wait stopped at raster line 0 by a
checkpoint, and the program is autostarted by the monitor after a power
cycle, so a run repeats exactly (`docs/runtime/vice-reference.md`,
"Pressing the joystick headless", has the measurements). An earlier
version of the harness said VICE's joyport command never reaches `$DC00`
in the windowless build; each game then carried a `make joy` build that
read its port byte from `$02FE`, and its own `tools/drive.py` stepped by
the wall clock. Both are gone.

`make joyprobe` builds `harness/joyprobe.asm`, a program that counts
frames until fire reads pressed on `$DC00`, and presses fire at the same
frame in three runs: the three screens and CIA1 timer A readings must
match. Measured 2026-09-24: `FIRE AT FRAME 0065` and timer A `$10F6` on
PAL, three of three.

## The frame meter

`meter/frame_meter.h` (Oscar64) and `meter/frame_meter.asm` (KickAssembler
macros) implement one contract. The program brackets its frame's work with
`METER_START` / `METER_STOP` (`FrameMeterStart()` / `FrameMeterStop()`),
then prints. Work split between a main loop and IRQ handlers is summed:
`METER_START` ... `METER_PAUSE` as often as needed, `METER_STOP` once a
frame. Brackets must not nest. The readout is `F<frames> W<worst>
T<typical>`, five digits each, 20 cells from row 24, column 20.

- **Timer.** CIA2 timer A, counting phi2 cycles, force-loaded with `$FFFF`
  at start and stopped before its two bytes are read, as in
  [raster-profile-bars](../recipes/oscar64/raster-profile-bars.md). The
  KERNAL IRQ uses CIA1 timer A and the KERNAL serial routines write CIA1
  timer B (issue #35), so neither collides. CIA2 timer A is the KERNAL's
  RS-232 bit timer: no device 2 while the meter runs. Init masks timer A's
  NMI only (`$DD0D` = `$01`).
- **What it counts.** Wall time between the two stores: badline and sprite
  DMA steals and any interrupt that lands inside a bracket are in the
  figure. The empty bracket's own count is subtracted: the least of four
  tries at raster line 0, with interrupts off, where no DMA falls. More
  than 65,535 cycles reads 65,535 (the underflow flag in `$DD0D`).
- **Recording.** The meter records the first `hold` frames (1 to 255) and
  then stops, so a pinned screenshot shows fixed figures and `check.py` can
  require the count. Make `hold` the autopilot script's play frames, so no
  title or idle frame counts.
- **Worst** is the largest recorded frame. **Typical** is the median of the
  recorded frames, computed when recording stops (0 until then): a cost
  some play frame took, with at least half the frames at or under it. The
  C meter finds it by selection (Wirth's FIND). Its first version sorted
  the samples by insertion, which held the platformer starter's main loop
  for about 94 frames (1.85M cycles) at its 255th play frame; with the
  selection its verdict came about 2M cycles sooner. The KickAssembler
  meter now selects too (#42); an earlier version of this page said it
  still sorted by insertion, which held one build's main loop for 294,808
  cycles (#55). That
  is the `cycles_per_frame_typical` of
  [CONVENTIONS-techniques](../CONVENTIONS-techniques.md), the frame play
  spends most of its time on, when the recorded frames are play. An
  earlier version used the mean of the last 16 frames: hello's figure was
  then the mean of idle frames after its script, and an alternating load
  read a cost no frame took.
- **Lost frames are not the meter's job, and are easy to count wrong.**
  The meter reports cost, not lateness: a starter that must not drop a
  frame counts drops itself. Count after the work: when the frame's work
  ends, test whether the next frame's IRQ has already fired (its flag or
  counter), and count that as a lost frame. A check at wake-up for a
  counter that moved by more than one misses every single overrun: work
  that ends just after the next IRQ still sees it move by exactly one.
  Measured on shmup-vertical 7974a7a: one frame made ~2,400 cycles late
  left the program's `wait_frame` counter at `OVERRUNS 00`, and a detector
  that tests the frame flag when the work ends found NTSC joystick play
  losing a frame in 6 of 15 runs. The demo's frame slot, which must end
  before a split line, reads the raster when its work ends instead.
- **Its own cost, outside the brackets.** Measured in VICE x64sc 3.10 with
  CIA1 timers A and B cascaded around each call (a scratch program, not a
  starter), 255 samples of 5,000 to 21,383 cycles from an LFSR: the
  KickAssembler median took 854,431 cycles by insertion sort and 38,742 by
  selection, and both gave 13,811. The print renders a field into a
  20-byte copy only when its value changed, stepping F in place, then
  writes the screen cells that differ from the copy, so a program that
  clears the row gets the readout back on the next print. Per call:

  | Print | KickAssembler | C (Oscar64 -O2) |
  |---|---|---|
  | Before: every field, every frame | 1,972 to 2,402 | 2,597 to 4,410 |
  | Nothing changed (after the hold) | 464 | 668 |
  | F one more (recording) | 582 | 776 |
  | All three fields new | 2,734 | 3,109 to 4,746 |

  Issue #42 put the old C print at up to 3,400 cycles a frame; the
  measured worst was 4,410, with every digit a 9 or near it.
- **Build switch.** `FRAME_METER` defaults to `AUTOPILOT`. Without it every
  macro is empty and the release carries none of the meter.
- **Interrupts.** The KERNAL serial routines end in `CLI`: the ROM bytes at
  `$EDAB`, `$EDB5`, `$EDDB` and `$EE82` are `58 60` or `58 18` (read from
  `kernal-901227-03.bin`). A program that runs with the KERNAL IRQ off must
  `SEI` again after any disk call, or that IRQ lands inside its brackets.

Calibration, rung 1, C and KickAssembler, PAL and NTSC:

| Bracketed code | Cycles by arithmetic | Read |
|---|---|---|
| `ldx #200` / `dex` / `bne` | 2 + 199 x 5 + 4 = 1,001 | `W01001 T01001` |
| A 12-cycle table lookup (`lda abs`, `and #3`, `tay`, `ldx abs,y`) replacing `ldx #`, then `inc abs`: 1,017 for 200, 517 for 100, one frame in four at 200 | 1,001 - 2 + 12 + 6 = 1,017; 501 - 2 + 12 + 6 = 517 | `W01017 T00517` over 48 frames |
| Two brackets a frame, 1,001 and 501, untimed work between | 1,502 | `W01502 T01502` |

The C meter's `meter_init` started at raster lines `$33`, `$37`, `$60`,
`$91` and `$F8` (badlines among them) read the same `W01017 T00517` each
time. The review of this harness found that the earlier single calibration
could land on DMA and read 5 cycles low; that is what the line-0 minimum
fixes. The same review saw W move between 1,510 and 1,538 cycles, in steps
of 14, with code layout alone, which it put down to branches crossing pages
(not re-measured here); allow for it when comparing two builds' W.

hello's figures: worst 194, typical 172 cycles (195 and 173 since the
selection changed the meter's code layout); hello-kick's: worst 178,
typical 154; each over the script's 144 play frames and the same on PAL and
NTSC. Both bracket from raster line 250, below the last badline (`$F7`),
and the sprite is on lines 117 to 137, so no DMA falls in the bracket. The
grading at frame 150 runs after `METER_STOP` and is in neither figure.

## The plan gate

`hooks/plan-gate.py` passes `PLAN.md` when it has no `FILL:` line left,
holds check-compatibility's output (a `# Compatibility: a + b` line and its
`**Verdict:**` line) and plan-budget's (`# Budget plan:`, `Techniques:`, a
`## play (` section with its `Range` line) for the same techniques, and
lists each of them as a row of its Techniques table. With `C64KB`
reachable, `make` also re-runs check-compatibility on the pasted names and
wants the same Verdict line. A pass prints one line naming the checkout's
`KB_DATA_VERSION` and commit, and is cached on `PLAN.md`'s hash with them;
a different verdict is refused with "the KB's answer changed", both
verdicts and that version. An unreachable checkout or graph warns and
checks the structure only.

The verdict can change with no change to the plan: another session's
ingest into a shared live graph, or a new KB version. So new-project and
`verify:templates` seed the cache for a starter's shipped `PLAN.md`
(`plan-gate.py --seed`), and building a shipped example never consults the
live graph; an edit to the plan or `make clean` brings the re-run back.
Before that, `new-project -- hello` failed with WARNINGS pasted against
COMPATIBLE live, and a starter's build failed during another session's
ingest (#42).

Every PRG depends on the gate, so `make`, `shot`, `check`, `selftest`,
`disk`, `claims` and `run` all stop while it fails. As a PreToolUse hook it
blocks (exit 2) an Edit, MultiEdit, Write or NotebookEdit under `src/`,
after resolving the path with realpath. `make PLAN_GATE=off` overrides
it. It replaces the old starters' `.kb-briefing-done`
marker, which `touch` satisfied.

Measured: two hand-typed heading lines fail it; a pasted Verdict changed
from WARNINGS to COMPATIBLE fails the re-run; a Write to `lib/../src/x.c`
and one under a `CLAUDE_PROJECT_DIR` with a trailing slash are blocked;
hello's plan passes. It cannot catch outputs edited by hand into the right
shape with the right verdict, or a write to `src/` made through a shell
command, which the hook never sees.

## make claims

When `$(C64KB)/scripts/claims-watch.ts` exists, `make claims` runs it from
the c64-kb checkout over the AUTOPILOT PRG with the starter's
`CLAIMS_ARGS`; otherwise it prints that the script is not available and
exits 0. The script landed with issue #22 step 6. Run against it before
it reached main, hello first failed:
Oscar64's zero page and the `$FF` store to `$DC00` were undeclared, and so
was the meter's one `$DD0D` store, which claims-watch counts against
`cia2_timer_b` and `cia2_tod` as well as `cia2_timer_a`. With
`zero_page $02-$52` and `cia1_port_a` claimed and all three CIA2 units
declared as harness, hello and hello-kick both reported `PASS: 0 stores in 0
violation groups`. Against main's claims-watch on 2026-09-23 hello failed
again: 309 stores to `$53`-`$55` outside the claim, and the KERNAL IRQ's
zero-page stores with no routine declared. Its claim is now
`zero_page $02-$55` with `--kernal IRQ`, and `make claims` reports `PASS: 0
stores in 0 violation groups`.

## End-to-end transcript

A project made from hello outside the repository, then each target in
turn. The last lines of each:

```text
$ npm run new-project -- hello <scratch>/mygame
  PASS PAL      frame meter, the script's 144 play frames: frames 144, worst 194, typical 172 cycles (CIA2 timer A; limit 19656)
  PASS NTSC     frame meter, the script's 144 play frames: frames 144, worst 194, typical 172 cycles (CIA2 timer A; limit 17095)
  check: 15 of 15 passed
new-project: ready. The starter's plan is now PLAN-hello-example.md; PLAN.md is blank.
$ make shot check                                 # the blank plan
plan-gate: the plan does not pass, so nothing is built.
  11 FILL: placeholder(s) left
$ cp PLAN-hello-example.md PLAN.md; make
oscar64 -tm=c64 -O2 -i=<project>/build -i=<project>/harness/meter -o=build/hello.prg src/main.c
$ make selftest
selftest: PASS, check.py rejected the FORCE_FAULT build
$ make disk
0 "hello           " 01 2a
10   "hello"            prg
654 blocks free.
$ make claims                                     # C64KB = this branch
claims: not available. <c64-kb>/scripts/claims-watch.ts does not exist (it lands in c64-kb with issue #22 step 6).
claims: set C64KB=/path/to/c64-kb to a checkout that has it. Nothing was checked.
$ make claims C64KB=<a checkout of onto22-watch>
PASS: 0 stores in 0 violation groups
$ npm run verify:templates -- --selftest          # from this repository
verify-templates: 2 of 2 starters passed
```

The FORCE_FAULT build fails four checks on both models, not only its own verdict: the
border and verdict text, and the sprite's box and solidity, because it ends
at X 189. The disk image boots: `x64sc -autostart build/hello.d64` for
25,000,000 cycles on PAL showed `HELLO HARNESS` on row 1. The shots are
stable: hello's and hello-kick's PAL pictures at 7,000,000 and 8,000,000
cycles, and their NTSC pictures at 8,000,000 and 12,000,000, were identical
pixel for pixel, because nothing on screen changes after the grade.

## Writing a starter

1. Make a project from `hello` (C with a KickAssembler part) or
   `hello-kick` (KickAssembler alone) under `templates/<name>`, or copy one.
2. Fill `PLAN.md` from `game-briefing`, `check-compatibility` and
   `plan-budget` before any code.
3. Give the program an AUTOPILOT script that plays from its first frame, a
   verdict after the script that reads real state back, outside the
   meter's bracket, and a FORCE_FAULT that turns it red and moves something
   a check can see.
4. Keep row 24, columns 20 to 39 free in AUTOPILOT builds. Set the meter's
   `hold` to the script's play frames. Bracket the whole frame's work,
   summing IRQ work with `METER_PAUSE`.
5. Write `expect.json`: the verdict, the text, a `sprite` or `rect` or
   `pixel` check for each feature, a `same` area, the meter with `frames`.
6. Pin `SHOT_CYCLES_*` after the verdict, where the screen no longer
   changes; prove it with two pins.
7. `make shot check selftest disk`, then `npm run verify:templates --
   --only <name> --selftest`.

## Not measured here

- The settings.json hook wrapper string was not executed by Claude Code in
  this session; `plan-gate.py` itself was run in hook mode with sample tool
  calls.
- A starter that uses `SHOT_DISK=1`, `DISK_FILES` or IRQ work inside the
  meter's brackets. hello and hello-kick use none of them; the review ran
  `SHOT_DISK=1` on hello and it passed.
- Any VICE other than 3.10, or a palette other than `-default`; `check.py`
  matches exact triples and would fail closed (and refuses `-model pal` by
  name).
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
