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
([irq-chain](../../docs/recipes/kickassembler/irq-chain.md) measures
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
[stable-raster-irq](../../docs/recipes/kickassembler/stable-raster-irq.md)
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
  shows in the picture. In six shots per model, 12.0M to 14.4M cycles,
  every changing bar line had its store in one column, x = 97. Without
  the probe the `$D020` store sits 95 pixels before the line's first
  visible pixel, and 26 (PAL) or 42 (NTSC) pixels after the line above
  leaves the picture.
- The sync padding was swept: PAL 2 and NTSC 6 give one column; PAL 3 or
  4 and NTSC 4, 5, 7 or 8 give two columns 8 pixels apart.
- `expect.json` checks every bar line from x 0 to 383 as one colour, on
  PAL and NTSC.

No sprite may sit on a bar line: sprite DMA takes cycles in the same blank
the stores use. The chain's Y range (100 to 124, lines 101 to 145) keeps
it clear. VICE's PAL default is a C64C, which draws the grey dot where a
colour register changes; the stores are in the blank, so none shows.

## The measured frame

The harness meter (CIA2 timer A) brackets every IRQ from the dispatcher's
first instruction to its exit, `FrameMeterStart` / `FrameMeterPause`; the
main loop records the sum once a frame. It records 232 frames: 60 of the
title, 20 of the wipe, the switch, and 151 of the main part, so the median
is a main-part frame. `make shot check`, VICE x64sc 3.10:

| Model | Worst | Typical (median) | Frame |
|---|---|---|---|
| PAL | 7,171 | 6,473 | 19,656 |
| NTSC | 7,351 | 6,612 | 17,095 |

The recorded samples, read with the monitor before the meter sorts them:
title frames 1,514 to 1,612 cycles on PAL, wipe frames 1,819 to 1,910, the
switch frame (the idle chain) 2,381, main-part frames 6,470 to 7,171. The
worst main-part frames are the ones where the scroller moves its row.
About 3,970 of a main-part frame is the bar slot, by arithmetic: from line
148 to the kernel's end on line 211 is 63 lines of 63 cycles, the CPU's
whole time, badlines included. The KERNAL's 36 cycles of IRQ entry and the
`$EA81` exit are outside the brackets.

`plan-budget` (PLAN.md) predicted 2,381 + 1,873 fixed cycles. Where it
differs:

- raster_bars' 990 is ten chained IRQs that each spin one line. This
  kernel holds the CPU for 63 lines, the price of full-width bars on
  every line with no edge in the picture.
- The 1,873 fixed cycles (badlines 1,075, sprite DMA 798) are real, but
  only the badlines under the bars fall in a bracket, and they are already
  in the 63 lines; the sprite lines 101 to 145 have no IRQ on them.
- The tune is a real three-voice player, not the stub the
  sid_play_routine_pattern figure was measured on; char_scroll_buffer_h
  had no figure. Both are in the frame slot's roughly 2,500 cycles.

Part 1's init runs in the main loop, outside the brackets: 9,255 cycles
from its first instruction to its return on PAL (VICE monitor stopwatch),
from line 295 to line 130 of the next frame, between two frame slots. The
2,381-cycle switch sample is the idle chain's frame slot running part 1's
first update.

## Autopilot and checks

A demo has no input, so the AUTOPILOT build is the normal timeline plus
the meter and a freeze: after the main part's 159th update every animation
stops and the chain keeps drawing that frame. The main loop then grades
real state: part 1 playing, the wipe finished and the title's teardown
run, the eight sprites' registers against the sine formula, the
scroller's XSCROLL, read pointer and the 38 cells of row 22, the bar
colour table, and the tune's call count against the frame count. `$02FF`
= `$01` and a green border on pass. `FORCE_FAULT` starts the sprite chain
four sine steps ahead: the verdict, seven of the eight sprite boxes and
the border checks either side of the bars fail, on both models.

`expect.json` is written by `tools/gen_expect.py`: it reads the numbers in
`config.asm` and recomputes the picture in Python. After changing any of
them, `make expect shot check`.

## Extending it

1. **Add a part.** Copy `part_title.asm`, give it a chain in `parts.asm`
   (rising lines, `frame_slot` last), add its column to the part table and
   raise `PART_COUNT`. A heavy init (decrunching, generating code) belongs
   in `init`: it runs in the main loop while the idle chain plays the tune.
   c64-kb: [irq-chain](../../docs/recipes/kickassembler/irq-chain.md),
   technique `multi_load_sequencing`.
2. **Load the next part while this one plays.** `loader_hook` in
   `main.asm` is called once a frame from the main loop, outside every IRQ.
   Put an IRQ loader's call there; not the KERNAL's LOAD, whose serial
   routines mask interrupts for whole bytes and end in `CLI`. c64-kb:
   techniques `sparkle_irq_loader`, `krill_loader_integration`,
   [spindle-reference](../../docs/toolchains/spindle-reference.md) (its
   part contract matches this one: prepare, setup, fadeout, cleanup).
3. **Change the effect or the music.** A new raster effect is a new slot;
   if it needs a stable start, call `stabilise` first and re-run `make
   probe`. For a fade instead of the wipe, write an `out` step that walks
   [colour-fade](../../docs/recipes/kickassembler/colour-fade.md)'s table.
   A tracker tune replaces `music.asm` at `$1000` / `$1003`
   ([oscar64/sid-music-player](../../docs/recipes/oscar64/sid-music-player.md)).
   Bigger scrollers:
   [big-font-scroller](../../docs/recipes/kickassembler/big-font-scroller.md),
   [sine-scroller](../../docs/recipes/kickassembler/sine-scroller.md).

## Left out on purpose

- Open borders, FLI, a sprite multiplexer: each needs its own raster
  region and its own budget.
- A custom character set: the logo is reverse spaces in the ROM set, so the
  meter and the text checks read the screen as it is.
- Run-time table generation. The sines come from the assembler;
  [sine-table-runtime](../../docs/recipes/kickassembler/sine-table-runtime.md)
  and [speedcode-generator](../../docs/recipes/kickassembler/speedcode-generator.md)
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
  ([pal-ntsc-reference](../../docs/hardware/pal-ntsc-reference.md)); model
  detection files it under NTSC, so it would run the 65-cycle kernel. It
  needs a third kernel and was not tried.
- How the tune sounds on a 6581 against an 8580: it uses no filter.
