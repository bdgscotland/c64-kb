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

## This starter: shmup-vertical

A vertically scrolling shoot-em-up: a river scrolls down over a fixed
score panel, the ship and the enemies fire character bullets, waves of
enemies keyed to the scroll go through a sprite multiplexer, effects play
inside the tune,
and the high score is saved to drive 8. `README.md` has the file map and
the first three things to extend. Start a program from it with
`npm run new-project -- shmup-vertical <dir>` in c64-kb. `PLAN.md` here is
a plan filled from real tool output; new-project keeps it as
`PLAN-shmup-vertical-example.md` and gives the new program a blank one.

What will bite you here:

- `src/kernel.asm` owns the raster IRQ (`$FFFE`, KERNAL banked out). Add a
  split as a new body in its chain; do not install a second handler.
- No sprite may reach raster line 214 (sprites stop at Y 187, last line
  208): a sprite there delays the panel split's writes (measured: 16 of
  16 PAL shots broken with eight sprites on it; lines 209-213 were clean).
  `make check` runs `make phases`, which compares the panel at all eight
  YSCROLL phases; keep it passing after touching the split.
- NTSC has little time to spare. `make stage` meters a staged heavy
  stretch (worst 15,237 of 17,095 cycles on NTSC), but play reaches
  heavier frames: `make joytest` and `make longplay` play the game with
  fire held and a sweep and fail on any lost frame (`LOST_FRAMES`, `$02FD`).
  In play's heaviest frames the work ended 7 lines before the frame IRQ
  (`-dWORKEND=1`). Re-run all three after adding work to a frame. Work that
  runs for every enemy or bullet every frame lives in `glyph.asm`,
  `hit.asm` and `step.asm` for that reason.
- Enemy dots are drawn before the beam reaches them only because enemies
  fire from sprite Y 72-140 (`bullets.c`); `-dDRAWEND=1` measures the
  margin. Keep new shots inside a window like it.
- The two playfield screens are drawn from the map; write game text to
  `level_screen()` and give its cells colour RAM below 8 (hires).
- Oscar64's zero page reached `$56` here; the kernel uses none. Pass values
  to the blob through its own bytes (`ASM_<LABEL>` in `build/asm.h`).
- Disk calls go through `src/hiscore.c`, which stops the chain and turns
  sprites off around them (sprite DMA on badlines hangs the KERNAL's serial
  transfers). `make joytest` proves the save and the reboot.
- `-dPROFILE=1` times each step of `play_frame` into `$0340` (CIA1 timer B,
  IRQs held off per step); `-dWORKEND=1` records how late a frame's work
  ended, at `$0370`; `-dLOOP_TEST=1` plays to GAME OVER and back to the
  title; `-dEVENTLOG=1` logs each kill, hit and lost frame with its frame;
  `-dGOD=1` keeps the ship; `make drive STEPS=...` (harness/drive.py)
  plays the normal game with the stick on `$DC00`.

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
  blob, not Oscar64's zero page (`$02` up; the top depends on the program:
  `make zp` lists what the build's code touches).
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
