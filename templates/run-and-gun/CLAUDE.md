# Rules for an agent working on this C64 program

This program runs on a stock Commodore 64, PAL and NTSC. It is built on the
c64-kb harness (`./harness`, vendored from c64-kb's `templates/_harness`).
c64-kb is the reference: its pages give the registers, timings, techniques,
pitfalls and recipes this program is built from. A wrong number becomes a torn
screen or a crash, so every claim here is measured or says it is not.

A new program starts in c64-kb with `npm run new-project -- <starter> <dir>`.
That copies the starter and the harness, points `.mcp.json` and `local.mk`
at the c64-kb checkout, proves the copy with `make shot check`, and leaves a
blank `PLAN.md`.


## This starter: run-and-gun (FIREBASE)

A vertical run-and-gun (archetype `vertical_run_and_gun`): a soldier on foot
walks up a jungle map that scrolls only while he pushes past the middle of
the screen, over a black band and a three-row score panel. Trees, rocks and
sandbags stop him; canopies draw over him. It has the scroll, the redraw,
the band, the multiplexer with parked slots, the soldier, the enemies
(`objects.c`), his gun and grenades (`weapons.c`), a SID tune and five
effects (`sound.asm`, `sound.c`), and the front end: title, attract demo,
game over, name entry and a high-score table (`front.c`, `hiscore.c`,
`flow.c`). Collisions, checkpoints and the area-end gate are the next
modules; their interfaces are in `PLAN.md`, "Modules". `README.md` has the
file map and how to extend it. Start a program from it with
`npm run new-project -- run-and-gun <dir>` in c64-kb.

What will bite you here:

- `src/kernel.asm` owns the raster IRQ (`$FFFE`, KERNAL banked out): the
  frame IRQ on line 250, the multiplexer's zones, the band IRQ on line 211.
  Add work as a body in that chain; never install a second handler.
- One commit a frame. C writes `pend_ys` and the slot tables, calls
  `mux_sort` and `mux_build`, then stores `K_COMMIT` once (`COMMIT_YS |
  COMMIT_MUX`). The frame IRQ applies both at line 250. A frame whose work
  runs past line 250 is lost (`LOST_FRAMES`, `$02FD`).
- The redraw pair. On the frame YSCROLL wraps, main.c runs only the
  soldier and the spawns (and the sprites' move and sort if they end before
  line 64, `HOLD_LINES`), commits YSCROLL 0, and copies 21 map rows from
  line 64 (`RD_FIRST`). The frame after runs the repeat step, the weapons,
  collisions and rules; no enemy thinks on either frame. Work added to the
  redraw frame delays the copy line for line; work added to the frame after
  must still end before line 250. The copy must stay behind the beam: never
  start it before row 1's badline, and never make it faster than 8 lines a
  row (kernel.asm). Every IRQ cycle and sprite DMA during the copy comes off
  its lead. Budget now (PLAN.md, "Combined budget"): lead 195 PAL and 159
  NTSC in `make weapons`, the frame after a redraw ending by line 135 PAL
  and 197 NTSC, 0 lost frames. Re-read verdict rows 6 and 8 and run
  `make longplay` after adding work to either frame.
- Sprites stop at Y 187 (last line 208), above the band IRQ. `make phases`
  (run by `make check`) checks the band and panel at all eight YSCROLL
  phases with the soldier at Y 187.
- Slots, not sprites. Write a slot with `slot_show` (every field in one
  frame) and free it with `slot_park`. A parked slot sits below the
  multiplexer's cut, so it costs no sprite and no DMA; nothing tests "in
  use" in the IRQs.
- The map is raw screen codes (`$9000`, 96 rows of 40) and colour RAM is
  one value for the whole playfield, never scrolled. New glyphs, their
  `A_` attribute bits and the map come from `tools/mkassets.py`; never edit
  `src/gen/` by hand (`make assetcheck`).
- Multicolour characters: `%01` pixels (`$D022`) are background for sprite
  priority, so they show a sprite that is behind; the canopy's highlights
  use that.
- Text on the playfield needs colour RAM below 8 in its cells (hires);
  put it back with `playfield_colour()`.
- Oscar64's zero page reached `$56` here; the blob uses none. Pass values
  to the blob through its own bytes (`ASM_<LABEL>` in `build/asm.h`).
- The front end (front.c, hiscore.c) and the game's end (flow.c) are
  states of main.c's one state byte: write `state_next`, never `state`,
  and main.c runs the entry routine before the next frame. The score is
  three BCD bytes: add with `flow_add_score(bcd)`; change `lives` or
  `grenades` directly and `flow_frame` redraws the panel field. Death and
  the gate call `flow_player_died` and `flow_area_cleared` (hooks that do
  the minimum; PLAN.md, "Front end"). `make frontend` and `make fedrive`
  prove title, play, game over, name entry, table and title.
- Audio: C calls `sfx(SFX_...)` (sound.h); an effect takes voices 1 and 2,
  the tune keeps voice 3. The frame IRQ inside the redraw only counts its
  step and the next one plays it (`sound_hold`); keep that if you move the
  redraw. `make audio` traces the SID stores on both models.
- CIA timers: CIA2 A is the meter's, CIA2 B the IRQ time's, CIA1 A the
  audio stopwatch (in the frame IRQ), CIA1 B the main loop's stopwatches
  (the redraw, `make enemies`, `make weapons`). A stopwatch in C must not
  share a timer with an IRQ's.
- Proofs, each its own build (`VERIFY_TARGETS`): `make mapend` (the scroll
  stops at the map's top), `make enemies`, `make weapons`/`weaponsfault`,
  `make audio`/`audiotest`, `make frontend`, `make fedrive`, and
  `make longplay` (the normal build driven 2,700 frames on PAL and NTSC:
  no lost frame, the redraw's lead). `make drive STEPS=...` plays the
  normal build with the stick on `$DC00`; `make gallery` takes the README
  picture.
## Before any code

1. Brief: `npx tsx src/cli.ts game-briefing "<concept>" --archetype <name>`
   (or `demo-briefing`), in the c64-kb checkout. Read what it proposes.
2. For each technique you keep: `technique-lookup <name>` and
   `pitfalls-for <name>`. Start from the recipe it names (`recipe-lookup`).
3. Fill `PLAN.md`: paste the whole output of `check-compatibility` and of
   `plan-budget` (same techniques) into their sections, list every technique
   in its table, and replace every `FILL:` line.

Until `PLAN.md` passes, a hook blocks Edit and Write under `src/`, and every
make target that builds stops (`make plan-gate` says what is missing). With
C64KB set, `make` re-runs `check-compatibility` and wants the pasted Verdict;
if the KB's answer changed, re-run both tools and re-paste.
The gate cannot see writes made through a shell command, or outputs edited
into shape by hand: do neither. `make PLAN_GATE=off` overrides it; say why in
`PLAN.md` if you do.

## The loop

```bash
make                  # build build/<name>.prg
make shot check       # autopilot build, headless PAL and NTSC, graded by expect.json
make selftest         # the FORCE_FAULT build must fail the same checks
make disk             # build/<name>.d64
make claims           # every store the program makes, against what it declares
make watch            # frame deadline and SID player, from a VICE trace (run by make check)
make drive STEPS='"until:PRESS FIRE" tap:fire print'   # the normal build, played headless
make run              # windowed VICE, for a human
```

## Rules

- Build before claiming. Code that has not built is not done.
- Measure screenshots with `check.py` through `expect.json`, never by eye.
  Every visible claim gets a check. Add one before you trust a change.
- PAL and NTSC: both shots pass, or it is not done.
- Name the rung for every number: measured here (`make shot`, the meter, the
  VICE monitor), taken from a c64-kb page (say which), arithmetic, or not
  measured. Never call something verified that was not run.
- Frame cost comes from the meter: CIA2 timer A, printed as
  `F<frames> W<worst> T<typical>` at row 24, columns 20 to 39, in AUTOPILOT
  builds. It records the first `hold` frames: make that the autopilot
  script's play frames. Typical is the median of those frames, the KB's
  `cycles_per_frame_typical`. Keep grading, logging and printing outside the
  bracket; work split between the main loop and IRQs is summed with
  `METER_PAUSE` / `METER_START`.
- Do not invent a register, routine or address. Look it up:
  `lookup-register`, `lookup-kernal`, `memory-map`.
- Lint every source you change: `npx tsx src/cli.ts lint <file>`.
- Commit named paths only. Never `git add -A` or `git add .`. `build/`,
  `shots/` and `local.mk` are never committed.

## Harness facts you will need

- `AUTOPILOT=1` builds read a scripted joystick byte instead of `$DC00` and
  grade themselves: `$02FF` = `$01` and a green border on pass, `$02` and red
  on fail. `FORCE_FAULT=1` must turn the verdict red and move something a
  screenshot check can see.
- Screenshot geometry (c64-kb `docs/runtime/vice-reference.md`): PAL 384 x 272,
  row = raster line - 16; NTSC 384 x 247, row = line - 28; x = VIC X + 8. A
  sprite at Y register y is drawn from line y + 1.
- `check.py` reads text in the ROM character set unless a check names a
  `charset` file; the meter's cells need 0-9, F, W and T in the set on screen.
- A KickAssembler part called from C is a raw blob at its own `* =` address,
  `$0880` or above; `build/asm.h` gives C its labels as `ASM_<LABEL>`
  (`ASM_<SCOPE>_<LABEL>` inside a scope). Pass arguments through bytes in the
  blob, not Oscar64's zero page. Its registers are `$02`-`$52`; its saved
  temporaries start at `$53` and grow with the program (the platformer's main
  reaches `$54`). `make zp` lists what the build's code touches and `make
  claims` measures what the run writes; the `zero_page` item in CLAIMS_ARGS
  covers both. An earlier version said `$02` to `$52`, which is the registers
  only.
- The meter takes CIA2 timer A. Do not open RS-232 (device 2) while it runs.
- The KERNAL serial routines end in `CLI` (ROM bytes `58 60` / `58 18` at
  `$EDAB`, `$EDB5`, `$EDDB`, `$EE82`). After any disk call, `SEI` again if
  the program runs with the KERNAL IRQ off: otherwise that IRQ lands inside
  the meter's brackets and rewrites `$DC00`.
- `check.py` exits 0 when every check passed, 1 when one failed, 2 when it
  graded nothing (a `FAIL REFUSED` line says why). A script that calls it
  tests the exit code, never the text.
- The normal build (no autopilot) plays headless through `make drive
  STEPS='...'`: `harness/drive.py` presses the stick on the real `$DC00` and
  counts time in frames, so a run repeats exactly.
- PAL shots use `-default`'s machine. Never pass `-model pal`: its palette
  differs, and `check.py` refuses the picture.
- A program that reads `$D41B` or `$D41C` sets `SOUND_SINK := dump`; under
  the default `+sound` both read wrong values.
- With `DEADLINE_LINE` or `SID_FRAMES` set in the Makefile, `make check`
  runs `make watch`, a VICE store trace of the autopilot run: every frame's
  work, `WORK_BEGIN` to `WORK_END` (1, then 0, stored to `$02FE`), must end
  before line `DEADLINE_LINE`, and the SID must be written in at least
  `SID_FRAMES` frames. `make selftest` then runs `make watchtest`: the
  `OVERRUN=1` build must fail the deadline, the `NO_PLAYER=1` build the SID.
- Read the error channel before a file you open for reading, and read the
  file only on `00`. On a missing file (`62`) the drive keeps no channel;
  a read then sends a TALK it answers with a 68-cycle CLK pulse, a badline
  can hide that pulse from the KERNAL's wait at `$EDD6`, and the wait has
  no timeout (c64-kb pitfall `first_open_after_reset_hangs_on_pal`). A
  frame wait before the OPEN only moves the phase. Open channel 15 after
  the file and close it after the file: closing 15 closes every file on
  the drive. The shots autostart the PRG with the disk attached; prove the
  disk path once by loading the release from the D64.

## Calling c64-kb

- CLI, from the c64-kb checkout (`C64KB` in `local.mk`):
  `npx tsx src/cli.ts <command>`; `npx tsx src/cli.ts --help` lists them.
- MCP: `.mcp.json` starts `node <c64-kb>/dist/cli.js serve` (run
  `npm run build` in c64-kb first).
