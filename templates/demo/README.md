# demo: a one-part demo skeleton

A title card, a wipe, then the main part: a character logo, eight sprites
on a sine chain, four raster bars drawn line by line from a stable raster
IRQ, and a 1x1 scroller, with an original three-voice SID tune playing
once a frame. Everything runs in one frame with room to spare. The
structure is the point: a part table, a table-driven IRQ chain per part,
and a transition between parts, so a demo grows by adding parts, not by
rewriting the loop. KickAssembler alone. PAL and NTSC, detected at start.

Start a demo from it in c64-kb:
`npm run new-project -- demo ~/c64/mydemo`.

## Files

| File | Holds |
|---|---|
| `src/main.asm` | Start-up, the main loop, the loader hook, the memory map |
| `src/config.asm` | Every constant: timeline, raster lines, sine speeds, the stable entry's padding |
| `src/framework.asm` | The IRQ dispatcher, `stabilise` (the double IRQ), the sequencer, the frame slot, model detection, `wipe_columns`, `Delay` |
| `src/parts.asm` | The running order (the part table) and every part's IRQ chain |
| `src/part_title.asm` | Part 0, the title card: the smallest complete part, the one to copy |
| `src/part_main.asm` | Part 1: logo, sprite chain, bar kernel, scroller |
| `src/tables.asm` | Part 1's sines, sprite image, logo and message, built by the assembler |
| `src/music.asm` | The tune and its player at `$1000` (init) / `$1003` (play) |
| `src/verdict.asm` | AUTOPILOT only: grades the frozen frame |
| `tools/gen_expect.py` | Recomputes the picture from `config.asm` and writes `expect.json` (`make expect`) |
| `tools/audio.py` | Counts the tune's SID stores in a claims-watch trace against the frames (`make audio`, run by `make check`) |
| `tools/probe.py` | Reads where the bar kernel's stores land from the PROBE build (`make probe`) |
| `expect.json`, `PLAN.md` | The screenshot checks; the plan with the c64-kb tool output |

## How it runs

A part is six things (`parts.asm` lists them): `init` and `teardown` run in
the main loop; `update` and `out` run in the frame slot, an IRQ below the
picture; `frames` says how long it plays; `chain` names its rows in the
slot table. The sequencer plays a part until its frames run out, then
calls its `out` step every frame until that returns carry set (the title
uses `wipe_columns`, two columns a frame). It then switches the chain to
the idle chain, the frame slot alone, so the tune keeps playing, and the
main loop runs the teardown and the next part's init. A part with
`frames` 0 plays forever; `LOOP_PART` says where to go after the last.

The IRQ chain is one dispatcher behind `$0314` and a table of five-byte
rows: line, ninth bit, handler, and a flag on the chain's last row. It
acknowledges, arms the next row's line, then calls the handler, so an
overrunning handler makes the next slot late instead of losing it
(c64-kb `docs/recipes/kickassembler/irq-chain.md` measures
that). Every chain ends with the frame slot at line 236: music, the part's
update, the sequencer. The main part's chain:

| Line | Slot | Work |
|---|---|---|
| 148 | `bars_slot` | `stabilise`, then the bar kernel for this model, lines 155 to 210 |
| 224 | `scroll_slot` | Row 22 in 38 columns with this frame's XSCROLL |
| 236 | `frame_slot` | `$D016` back to 40 columns, the tune, `main_update` (sprites, bar table, scroller), the sequencer |

`update` writes only what the next frame uses (sprite registers, the bar
colour table, XSCROLL and row 22), from line 236 on, so nothing tears.

## The stable entry and the bars

`stabilise` is the double IRQ of
c64-kb `docs/recipes/kickassembler/stable-raster-irq.md`
as a subroutine a slot handler calls. It arms a second IRQ four lines on,
slides through NOPs, and on the second entry reads `$D012` twice so the
last cycle of jitter is absorbed; then it puts back the line the
dispatcher armed and returns. Measured with the VICE monitor: the caller
goes on at cycle 51 of line 153 on both models (the monitor numbers the
cycles of a line 0 to 62 on PAL, 0 to 64 on NTSC).

The kernel is one unrolled chunk per bar line: load the line's colour,
store it to `$D020` and `$D021`, wait. Each `STA $D020` starts on cycle 60
(PAL) or 62 (NTSC) of the line above, so the stores write on cycles 0 and
4 of the bar line, and the next chunk starts exactly 63 or 65 cycles later
on normal lines and badlines alike (VICE monitor, two consecutive chunks,
the first on the badline 155). On a badline the chunk has only NOPs after
its stores, and the VIC's stall is the rest of the line.

Evidence, VICE x64sc 3.10:

- `make probe` builds the kernel 20 cycles late, so the `$D021` store
  shows in the picture, and makes the main loop's wait vary from frame to
  frame, so the IRQs land in every phase of the instruction they
  interrupt. It takes eight shots per model (12.0M to 15.6M cycles) and
  passes only when every changing bar line in every shot has its store in
  one column, and that column is `PROBE_COLUMN` in `config.asm`: x = 97
  on both models. Without the probe the `$D020` store
  sits 95 pixels before the line's first visible pixel, and 26 (PAL) or
  42 (NTSC) pixels after the line above leaves the picture.
- A wrong padding fails it. SYNC_PAD_PAL 0, 3 or 4 and SYNC_PAD_NTSC 4,
  7 or 8 each gave two columns 8 pixels apart and exit 2. SYNC_PAD_NTSC 5
  can put every store in one column, x = 89, in all eight shots (a later
  re-check found it; an earlier version of this line said it always
  split), so the probe also requires x = `PROBE_COLUMN`; with pad 5 it
  now exits 2. Before the
  varying wait was added, pads 0 and 3 passed a single shot: the idle loop
  (7 cycles) divides the PAL frame (19,656 = 7 x 2,808), so every frame
  was entered in the same phase. `make shot check` cannot see a wrong pad:
  a store up to about 11 cycles late still lands in the blank.
- `expect.json` checks every bar line from x 0 to 383 as one colour, on
  PAL and NTSC.

No sprite may be on any line from 148 (the stable slot) to 211. Each
chunk is a fixed 63 or 65 cycles, so the cycles sprite DMA takes on one
line delay that chunk and every later one until a badline's stall
resyncs them, and the bars tear. The chain's Y range (100 to 124, lines
101 to 145) keeps it clear, and an `.errorif` in `config.asm` refuses a
chain that reaches those lines. VICE's PAL default is a C64C, which draws the grey dot where a
colour register changes; the stores are in the blank, so none shows.

## The measured frame

The harness meter (CIA2 timer A) brackets every IRQ from the dispatcher's
first instruction to its exit, `FrameMeterStart` / `FrameMeterPause`; the
main loop records the sum once a frame. It records 232 frames: 60 of the
title, 20 of the wipe, 2 of the switch and 150 of the main part, so the
median is a main-part frame. `make shot check`, VICE x64sc 3.10:

| Model | Worst | Typical (median) | Frame |
|---|---|---|---|
| PAL | 7,332 | 6,586 | 19,656 |
| NTSC | 7,476 | 6,735 | 17,095 |

The recorded samples, read with the monitor before the meter sorts them:

| Phase | PAL | NTSC |
|---|---|---|
| Title | 1,602 to 1,702 | 1,510 to 1,716 |
| Wipe | 1,906 to 2,000 | 1,824 to 2,029 |
| Idle chain while part 1's init runs | 371 | 380 |
| Idle chain running part 1's first update | 2,466 | 2,495 |
| Main part | 6,583 to 7,332 | 6,626 to 7,480 |

(The dispatcher's lateness counters, below, cost about 30 cycles an IRQ;
the build before them read 7,225 / 6,478 on PAL and 7,360 / 6,615 on
NTSC. These samples are from the build before the verdict ran
`hard_cut`; that change moved code outside the brackets, and the NTSC
worst then read 7,476 instead of 7,480, the median 6,735 instead of
6,734. The harness page notes that code layout alone moves W by a few
cycles.)

The worst main-part frames are the ones where the scroller moves its row.
The bar slot is about 3,970 cycles of a main-part frame on PAL and 4,095
on NTSC, by arithmetic: from line 148 to the kernel's end on line 211 is
63 lines, of 63 or 65 cycles, the CPU's whole time, badlines included.

What the main loop has left for a loader or a heavy init, by arithmetic
on the measured worst frame (rung 3): outside the brackets the VIC takes
about 17 badlines x 43 = 731 cycles (25 in the display, 7 under the bars
and 1 in the frame slot are inside) and 400 to 855 cycles of sprite DMA
on lines 101 to 145 ((3 + 2 x 8) cycles a line on 21 to 45 lines, as
plan-budget counts it), and the KERNAL's entry and exit take 3 x 61 = 183
(7 + 29 in, 25 out through `JMP $EA81`). That leaves about 10,600 to
11,000 cycles a frame on PAL and 7,800 to 8,300 on NTSC in the worst
main-part frame.

The frame slot has a deadline: `update` must finish before line 148 of
the next frame, where the stable slot fires, or the bars tear. From line
236 that is 224 lines on PAL and 175 on NTSC, less their badlines (by
arithmetic; the review of this starter tore the bars on PAL with 12,800
cycles added to `main_update`, and `make check` caught it). The program
now counts it itself, and the verdict grades it: see "Autopilot and
checks".

`plan-budget` (PLAN.md) predicted 2,381 + 1,873 fixed cycles when the demo
was planned; re-run for #78, with more Cost lines measured, it says
4,169-4,588 + 1,873. Where the first prediction differs:

(Its low end, 2,381, matches the PAL switch sample of an earlier build by
coincidence; neither was derived from the other.)

- raster_bars' 990 is ten chained IRQs that each spin one line. This
  kernel holds the CPU for 63 lines, the price of full-width bars on
  every line with no edge in the picture.
- The 1,873 fixed cycles (badlines 1,075, sprite DMA 798) are real, but
  only the badlines under the bars fall in a bracket, and they are already
  in the 63 lines; the sprite lines 101 to 145 have no IRQ on them.
- The tune is a real three-voice player, not the stub the
  sid_play_routine_pattern figure was measured on; char_scroll_buffer_h
  had no figure. Both are in the frame slot's roughly 2,500 cycles.

Part 1's init runs in the main loop, outside the brackets: 16,737 cycles
of wall time from its first instruction to its return on PAL (VICE
monitor stopwatch), from line 295 to line 249 of the next frame, with one
idle frame slot inside it. It clears the whole screen first, so it does
not rely on the part before ending with a wipe.

## Autopilot and checks

A demo has no input, so the AUTOPILOT build is the normal timeline plus
the meter and a freeze: after the main part's 156th update every animation
and the sequencer's part timer stop, and the chain keeps drawing that
frame. XSCROLL is then 3, not 0, so a missing or wrong `$D016` write shows
in the picture. The main loop grades real state: part `MAIN_PART` playing, the wipe finished and the title's teardown
run, the eight sprites' registers against the sine formula, the
scroller's XSCROLL, read pointer and the 38 cells of row 22, the bar
colour table, and the tune's call count against the frame count. `$02FF`
= `$01` and a green border on pass. `FORCE_FAULT` starts the sprite chain
sixteen sine steps ahead: the verdict, seven of the eight sprite boxes and
the border checks fail, on both models (26 FAIL lines).

Three counters, kept in every build, are graded too, and must be 0:

- `irq_late`: dispatcher entries that began `LATE_LINES` (3) or more lines
  after their row's line;
- `irq_bad`: chains whose last row was not entry number (rows in the chain);
- `frame_late`: frame slots that ended at or past the next chain's first
  line (148 in the main part), the frame slot's deadline.

With 11,520 cycles added to `main_update` the verdict read `irq_late` 255
(saturated), `irq_bad` 156 and `frame_late` 156, and failed on PAL; on
NTSC that load never reached the verdict. The shipped build reads 0, 0, 0.

The tune is graded twice. The verdict reads the player's tick and step
with interrupts held off and checks them against its call count (after c
calls: tick c mod 7, step (c div 7) mod 32), and the call count against
the frame count. The SID's own output cannot be read back under the
harness's `+sound`: `$D41C` returned a changing value with no SID write at
all (measured here with a test PRG). So `make check` first runs `make
audio` (`tools/audio.py`): c64-kb's claims-watch traces the PAL run and
counts the program's SID stores. Voice 2 must be written twice a frame
from its first store (measured: 444 play calls in 448 frames, the gap
being the meter's calibration and the title's init), and voices 1 and 3
at least once a step. With every `STA $D4xx` in `music.asm` made a `CMP`,
`make check` failed: "no store to voice 2 at all". `make audio` is
skipped, and says so, where the c64-kb checkout has no claims-watch.

`expect.json` also places row 22's ink at XSCROLL 3: for each of the 37
visible cells, the leftmost ink pixel of its first inked glyph row (from
the character ROM) and the pixel left of it, plus the 38-column border
on the scroller's lines. With `scroll_slot`'s `$D016` write removed,
`make check` failed 64 checks; before this, it passed 111 of 111.

`expect.json` is written by `tools/gen_expect.py`: it reads the numbers in
`config.asm` and recomputes the picture in Python. After changing any of
them, `make expect shot check`.

## Extending it

1. **Add a part** (tested exactly as written, with a third part after
   the main one):
   - Copy `src/part_title.asm` to `src/part_<name>.asm` and rename its
     labels and constant: `title_` to `<name>_`, `TITLE_ROW` to
     `<NAME>_ROW`. Change its text. Its init must draw the whole screen:
     the part before may end on a hard cut.
   - In `src/main.asm`, add `#import "part_<name>.asm"` after
     `#import "part_title.asm"`. If KickAssembler reports that the `code`
     block overlaps `music`, import it after `part_main.asm` instead.
   - In `src/parts.asm`, give it a chain: a label and at least
     `Slot(FRAME_LINE, frame_slot, true)` (rows in rising line order, the
     frame slot last; `StableSlot` for a row whose handler calls
     `stabilise`). Add its column to every row of the part table: init,
     update, out (`wipe_columns` or `hard_cut`), teardown, frames, chain.
   - The verdict grades the title-to-main transition as shipped: it wants
     the wipe finished (`tr_step` 40 in `verdict.asm`) and the title's
     teardown run. Changing a part's `out` step, or putting a part between
     the title and `MAIN_PART`, means updating those checks in
     `verdict.asm` and re-running `make expect`. `hard_cut` itself is
     run by the verdict (no shipped part names it), so it cannot break
     unseen.
   - In `src/config.asm`, raise `PART_COUNT`. `LOOP_PART` is where the
     demo goes after the last part.
   - A part after the main one is reached only if the main part ends:
     its `frames` is 0 (forever) as shipped, so give it a count, as
     `part_frames_lo`/`_hi` in the table.
   - The AUTOPILOT build freezes the main part (`MAIN_PART`) after
     `FREEZE_UPDATES` updates and stops the sequencer there, so while the
     main part's frame count is above `FREEZE_UPDATES` the new part never
     plays in the graded run and `make shot check` still passes. `make
     run` shows it. To grade the new part, freeze and verify it instead
     (`verdict.asm`, `tools/gen_expect.py`).

   A heavy init (decrunching, generating code) belongs in `init`: it runs
   in the main loop while the idle chain plays the tune. c64-kb:
   `docs/recipes/kickassembler/irq-chain.md`, technique
   `multi_load_sequencing`.
2. **Load the next part while this one plays.** `loader_hook` in
   `main.asm` is called once a frame from the main loop, outside every IRQ.
   Put an IRQ loader's call there; not the KERNAL's LOAD, whose serial
   routines mask interrupts for whole bytes and end in `CLI`. c64-kb:
   techniques `sparkle_irq_loader`, `krill_loader_integration`,
   `docs/toolchains/spindle-reference.md` (its
   part contract matches this one: prepare, setup, fadeout, cleanup).
3. **Change the effect or the music.** A new raster effect is a new slot;
   if it needs a stable start, call `stabilise` first, name its row
   `StableSlot`, and re-run `make probe`; if the stores move on purpose,
   set `PROBE_COLUMN` to the new column once the probe shows one column
   on both models and the blank margins it prints are positive. For a
   fade instead of the wipe, write an `out` step that walks
   c64-kb `docs/recipes/kickassembler/colour-fade.md`'s table.
   A tracker tune replaces `music.asm` at `$1000` / `$1003`
   (c64-kb `docs/recipes/oscar64/sid-music-player.md`).
   Bigger scrollers:
   c64-kb `docs/recipes/kickassembler/big-font-scroller.md`,
   c64-kb `docs/recipes/kickassembler/sine-scroller.md`.

## Left out on purpose

- Open borders, FLI, a sprite multiplexer: each needs its own raster
  region and its own budget.
- A custom character set: the logo is reverse spaces in the ROM set, so the
  meter and the text checks read the screen as it is.
- Run-time table generation. The sines come from the assembler;
  c64-kb `docs/recipes/kickassembler/sine-table-runtime.md`
  and c64-kb `docs/recipes/kickassembler/speedcode-generator.md`
  show how to build them, or the bar kernel, on the machine to save space.
- A disk loader and packing. `make disk` writes the PRG to a .d64 that
  boots (checked: the main part on screen at 40,000,000 cycles); nothing
  in the demo needs the disk after that.
- KERNAL banked out. The IRQs go through `$0314`; a part that banks the
  KERNAL out must move the dispatcher to `$FFFE` and re-run `make probe`,
  because the entry is 29 cycles shorter.

## Not measured here

- Real hardware. The stable entry's padding and the kernel's lead are VICE
  x64sc 3.10 figures, on its default PAL model (C64C) and `-model ntsc`
  (6567R8). A 6567R56A has 64-cycle lines
  (c64-kb `docs/hardware/pal-ntsc-reference.md`); model
  detection files it under NTSC, so it would run the 65-cycle kernel. It
  needs a third kernel and was not tried.
- How the tune sounds on a 6581 against an 8580: it uses no filter.
