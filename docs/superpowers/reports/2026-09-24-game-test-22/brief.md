# Game test brief (issue #22, step 7)

## The brief

This section is issue #22 section 4.1, verbatim.

> Build a vertically scrolling shoot-'em-up for a stock PAL C64 that also
> runs on NTSC. The playfield scrolls down one pixel a frame through a
> level map at least three screens tall, above a fixed five-row score
> panel. Up to 16 enemies and the player are sprites on screen at once.
> Enemies arrive in attack waves triggered by scroll position and follow
> entry paths. Player bullets are characters, up to eight. Collisions use
> a hitbox per animation frame. A three-voice tune plays throughout, and
> sound effects take over one voice. Enemy variation is random. A
> high-score table is saved to disk, and level 2's map is loaded from disk
> between levels. Use only the c64-kb tools for C64 facts. Before writing
> code, record the design and the output of `c64_check_compatibility` and
> `c64_plan_budget` in PLAN.md. Every figure you report names the
> instrument that produced it.

## Harness notes

These notes are not part of the brief. They say where to work, how to call
the tools, and what to hand back.

- **Checkout.** Your working directory is a git worktree of c64-kb. Read
  its `CLAUDE.md`. Do not edit `docs/`, `src/`, `templates/` or `scripts/`,
  and do not commit to the checkout.
- **The c64-kb tools.** Call them through the CLI:
  `node src/cli.ts <command>` from the checkout (`--help` lists the
  commands; `c64_check_compatibility` is `check-compatibility`,
  `c64_plan_budget` is `plan-budget`, `c64_game_briefing` is
  `game-briefing`). Prefix every call with the store settings:
  `FALKOR_GRAPH=c64_i22g QDRANT_COLLECTION=c64_docs_i22g`. That store was
  built from this tree. Do not run `ingest`.
- **C64 facts.** Only from those tools and the pages under `docs/` they
  point to. Do not read GitHub issues (`gh`), the web, or files outside the
  checkout and your project directory.
- **Starters.** `templates/` holds starters and the shared harness
  (`templates/_harness`; `docs/workflow/agent-harness.md` explains it).
  `npm run new-project -- <starter> <dir>` makes a project (run
  `npm run build` in the checkout first so its `.mcp.json` resolves). Use
  one, or none.
- **Project directory.** Put the game in `PROJECT_DIR` (given in your task
  message). It must not exist when you start.
- **Instruments.** KickAssembler, Oscar64, cc65, VICE x64sc headless and
  c1541 are on this machine; `CLAUDE.md` gives the commands. Use the
  windowless VICE: `X64SC_BIN=~/Developer/c64/vice-headless/bin/x64sc`.
  A disk image with drive 8 attached needs true drive emulation in VICE.

## What to hand back

In `PROJECT_DIR`:

1. `PLAN.md`: the design, and the verbatim output of `check-compatibility`
   and `plan-budget` on it, written before the first line of game code.
2. `DECISIONS.md`: every conflict between parts of the design you met,
   before or during the build; for each, whether a tool reported it before
   code (which tool, which finding) or you found it later (how), and what
   you did.
3. The sources, a `Makefile` or build script, the PRG, and a D64 holding the
   PRG and the level-2 map file.
4. `MEASURED.md`: every figure you measured (cycles per subsystem, the play
   frame, dropped frames, the load), each with the instrument that produced
   it and the VICE model and cycle count of the run.
5. `DESIGN-PAGE.md`: the game written as a GameDesign page in the form
   `docs/CONVENTIONS-game-designs.md` defines, with `**Measured frame:**`
   lines from your runs.

Your final message: what works, what does not, what you could not build and
why, and every place the c64-kb tools were wrong, silent or missing
something you needed.
