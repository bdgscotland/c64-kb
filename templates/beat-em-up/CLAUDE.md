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

## This starter: beat-em-up

A side-on street brawler that plays: `README.md` has the file map, how a
frame runs, the measured frame and the three most likely next steps. Rules
this program depends on:

- The sprite registers belong to the IRQ chain in `src/engine.asm`: three
  bands a frame (line 251 the GO sign, line 76 the fighters, line 212 the
  HUD faces). C fills the back half of the tables and publishes it with
  the next picture's `$D016` and `$D018` (`view_sprites`, `view_publish`).
- The fighter band holds eight sprites and never reuses one: four sprite
  fighters of two parts, or three and the brute. A fifth sprite fighter, or
  a third part, has no sprite on those lines. The nearest fighter takes
  sprites 0 and 1: depth is the VIC-II's sprite priority. Keep a fighter's
  highest line at 91 or below (ground line 150, jump 18) so the band's IRQ
  at line 76 has finished.
- The brute is character cells (`src/brute.c`): two character sets at
  `$E000` and `$E800`, one brute a wave, his cells in both street pages.
  Street glyphs on rows 2-19 use bit pairs 00 and 01 only, or `$D01B`
  hides fighters behind the street too. His cell moves must finish before
  his top row: the verdict counts the ones that did not.
- `make flickercheck` after any change to the fighters, the art, the poses
  or the IRQs: `tools/flickercheck.py` renders the fighters and the brute
  from `src/` (the `SPRITE-ART`, `BRUTE-ART` and `POSES` blocks in `art.c`,
  the enums and colours in `game.h`, the colours in `view.c`: keep their
  markers and shapes) and matches shots inside the photo stops. A changed
  wave, AI or art moves the stops: re-pin `FLICKER_PAL` and `FLICKER_NTSC`.
  `make gameover` checks the GAME OVER screen.
- The scroll never writes the page on display but for the brute's cells:
  it prepares the other page four rows a frame (`src/view.c`). Keep the
  camera at a pixel a frame.
- The frame is nearly full on NTSC (16,593 of 17,095 at the run's worst, README):
  meter anything you add, with `-dPROF=n` for one subsystem and
  `-dMETER_WINDOW=n` for another part of the run.
- World x stays below 32,768 and is compared as unsigned: Oscar64 compares
  an `int` loaded from a larger `unsigned` as not negative (c64-kb #30
  fault 8; README, "Which Oscar64").
- The autopilot is a bot (`src/autopilot.h`), not a timeline: it reads the
  game and plays on. `-dDEBUG_AT=n` freezes at frame n and prints the
  state on the HUD. On a failed verdict, row 24 shows the failed checks as
  bits and row 22 the counts behind them.

`PLAN.md` here is this starter's plan, filled from real tool output;
new-project keeps it as `PLAN-beat-em-up-example.md` and gives the new
program a blank one.

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
  blob, not Oscar64's zero page (`$02` to `$52`).
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
- The shots autostart the PRG with the disk attached. On PAL the first disk
  call after that can hang (c64-kb pitfall
  `first_open_after_reset_hangs_on_pal`); prove the disk path once by
  loading the release from the D64.

## Calling c64-kb

- CLI, from the c64-kb checkout (`C64KB` in `local.mk`):
  `npx tsx src/cli.ts <command>`; `npx tsx src/cli.ts --help` lists them.
- MCP: `.mcp.json` starts `node <c64-kb>/dist/cli.js serve` (run
  `npm run build` in c64-kb first).
