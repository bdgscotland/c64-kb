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

## This starter: demo

A one-part demo skeleton in KickAssembler alone: a part table, a
table-driven raster IRQ chain per part, a stable raster kernel for the
bars, a sprite sine chain, a 1x1 scroller, an original tune, and a wipe
between two parts. `README.md` has the file map, how a frame runs, the
measured frame and the three likely next steps. `PLAN.md` here is a plan
filled from real tool output; new-project keeps it as
`PLAN-demo-example.md` and gives the new program a blank one.

What bites in this program:

- The bar kernel is cycle-counted from `stabilise`. Anything that changes
  the code between the second IRQ and the kernel, the chunk bodies, or
  the dispatcher's path to a stable slot can move the stores: run
  `make probe` after such a change, then `make shot check`. The probe
  takes eight shots per model of a build whose main loop varies the IRQ
  entry phase each frame, and exits 0 only on one column in all of them,
  at `PROBE_COLUMN` (config.asm) on both models.
  `make shot check` alone cannot see a wrong SYNC_PAD: the stores stay in
  the blank.
- No sprite on lines 148 to 211: each kernel chunk has a fixed length, so
  sprite DMA delays every later chunk until a badline resyncs them.
  `config.asm` refuses a chain that reaches those lines.
- Adding a part: follow README, "Extending it", step 1, to the letter
  (the `#import`, the table column, `PART_COUNT`, non-zero `frames` on
  the part before it).
- `src/config.asm` holds the numbers `tools/gen_expect.py` reads. After
  changing one, `make expect shot check`.
- Handlers run inside the dispatcher's meter bracket: keep grading and
  printing in the main loop, outside it.
- The verdict grades three lateness counters (`irq_late`, `irq_bad`,
  `frame_late`): the frame slot must finish before the next chain's first
  line. `make check` also runs `make audio`, which counts the tune's SID
  stores in a trace; the program cannot hear its own SID under `+sound`.
- `loader_hook` is the place for an IRQ loader. The KERNAL's LOAD masks
  interrupts for whole bytes and moves the bars.

## Before any code

1. Brief: `npx tsx src/cli.ts demo-briefing "<concept>" --archetype <name>`
   (or `game-briefing`), in the c64-kb checkout. Read what it proposes.
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

- AUTOPILOT builds (`-define AUTOPILOT` for KickAssembler) run a script and
  grade themselves: `$02FF` = `$01` and a green border on pass, `$02` and red
  on fail. A demo has no input, so here the script is the timeline, and the
  main part freezes for the grade. FORCE_FAULT must turn the verdict red and
  move something a screenshot check can see.
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
- The shots autostart the PRG with the disk attached. On PAL the first disk
  call after that can hang (c64-kb pitfall
  `first_open_after_reset_hangs_on_pal`); prove the disk path once by
  loading the release from the D64.

## Calling c64-kb

- CLI, from the c64-kb checkout (`C64KB` in `local.mk`):
  `npx tsx src/cli.ts <command>`; `npx tsx src/cli.ts --help` lists them.
- MCP: `.mcp.json` starts `node <c64-kb>/dist/cli.js serve` (run
  `npm run build` in c64-kb first).
