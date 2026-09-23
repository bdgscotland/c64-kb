# platformer: a side-scrolling platformer starter

A small game that plays: a level 2,048 pixels wide scrolls through a
38-column window as you run; you jump with 8.8 fixed-point physics, walk
up 45-degree and 1-in-2 slopes, land on blocks and one-way ledges, stomp
enemies that wake as they come near the screen, collect coins, and have
three lives. A HUD sits under the playfield and an original two-voice tune
plays. Title, fire to start, game over back to the title. PAL and NTSC,
Oscar64 C with a KickAssembler part.

Start a game from it in c64-kb:
`npm run new-project -- platformer ~/c64/mygame`.

## Playing

`make run` opens VICE; give it a joystick device for port 2 ("Driving it
headless" below says how). Left and right run,
fire jumps, down + fire drops through a ledge. Land on an enemy from
above to squash it (100); a coin is 10; the flag at the far end is 1,000
and starts the level again.

## Files

| File | Holds |
|---|---|
| `src/main.c` | The frame loop, the states (title, play, dying, game over, level clear), lives |
| `src/game.h` | Every shared constant, variable and function, in one place |
| `src/level.c` | The level as ten lines of text, the 2 x 2 metatiles, cell lookups, the slope height table |
| `src/art.c` | Every picture as text: playfield glyphs, sprite shapes, hit boxes |
| `src/player.c` | The physics every body shares (walk, fall, land) and the player on top |
| `src/actors.c` | Enemies: the activation window, five live slots, walker and hopper, hit boxes by group |
| `src/view.c` | VIC-II: bank 3, the camera, the three-page scroll, sprite shadows |
| `src/anim.c` | Animation sequences (frame, duration, loop or hold) |
| `src/hud.c`, `src/sound.c` | Score digits and HUD text; sound effects on SID voice 3 |
| `src/engine.asm` | KickAssembler: the slice copy for the scroll, the two raster IRQs, the tune and its player |
| `src/autopilot.h`, `src/verdict.h` | AUTOPILOT builds only: the scripted joystick and the self-check |
| `tools/tearcheck.py` | Renders the level from `src/` and proves no picture tears (`make tearcheck`) |
| `expect.json`, `stage-expect.json`, `PLAN.md` | The screenshot checks, the crowded-level checks (`make stage`); the plan with the c64-kb tool output |

## How a frame runs

The main loop waits for the IRQ at raster line 251, then writes the
sprites, plays the tune and the effects, runs the player, the enemies and
the camera, and publishes the next picture's `$D018` and `$D016` as one
pair. Two raster IRQs in `engine.asm` own those registers: at line 212,
inside the blank character row 20, the HUD gets 40 columns, hires and its
own screen page; at line 251 the playfield gets the published pair back.
A frame whose work runs long therefore shows the last picture again,
never a half-set one.

The scroll never shifts or redraws the page on display; a taken coin's
cells and the sprite pointers are the only writes to it, and a level
restart redraws all three pages at a cut. XSCROLL moves the picture a
pixel; a column crossing is only a `$D018` flip, because three pages are
kept: the one on display, the one the camera just left, and one prepared
for the next column in the direction of travel, five rows a frame, by a
KickAssembler copy one column over plus the new column's cells from the
level. The camera moves at most 2 pixels a frame, so the next crossing is
at least 4 frames off and 4 slices are enough. A frame never carries a
whole 20-row shift (an earlier draft of this starter did: 9,457 cycles in
one frame, measured with `PROF=3`).

Memory: VIC bank 3. Pages at `$C000`, `$C400` and `$E800`, the HUD page at
`$C800`, sprites at `$CC00`, the character set at `$E000` (the ROM's
glyphs 0-63 copied in, so text and the meter read). BASIC and KERNAL are
banked out (`$01` = `$35`). Colour RAM is never scrolled: the playfield's
four colours are `$D021`, `$D022`, `$D023` and the colour RAM's green.

## The measured frame

The harness meter (CIA2 timer A) over the first 255 play frames of the
autopilot run, VICE x64sc 3.10, `make shot check`:

| Model | Worst | Typical (median) | Frame |
|---|---|---|---|
| PAL | 11,772 | 6,226 | 19,656 |
| NTSC | 12,222 | 6,585 | 17,095 |

Per subsystem, built with `-dPROF=n` (worst / typical, PAL; NTSC within
400 cycles of each):

| n | Subsystem | Worst | Typical |
|---|---|---|---|
| 1 | player physics, coins | 4,237 | 1,686 |
| 2 | enemies: window, AI, hit boxes | 3,682 | 2,269 |
| 3 | camera and scroll slice | 4,001 | 240 |
| 4 | sprites to the VIC, tune, effects | 925 | 706 |
| 5 | HUD, sprite shadows, publish | 1,346 | 915 |

The meter covers play frames 1-255 of about 835. A review of an earlier
build metered two later windows (from frames 275 and 560): their worst was
below the first window's, their typical about 1,000 cycles above it. Not
re-measured on this build.

The worst frames of the parts do not fall together: the whole frame's
worst is 11,772, not their sum. Every figure is wall time, so badline and
sprite DMA are in it, and so is the split IRQ when it lands inside the
bracket (work past line 212; about 56 cycles by arithmetic). The IRQ at
251 falls just before the bracket opens and is not counted: about 66
cycles by arithmetic.

Against `plan-budget` (PLAN.md): it gave 10,167 to 10,765 cycles plus
1,432 fixed, 11,599 to 12,197 in all, verdict undetermined, with the
scroll left out (its only figure was the old recipe's 74,041-cycle shift,
issue #18) and six techniques unknown. The measured worst, 11,772 PAL and
12,222 NTSC, falls inside that range (an earlier build, before the walker
and HUD cuts below, was 356 and 785 cycles above its top). The parts disagree more than
the total: the budget charges per-frame-hitbox 3,693 and decimal-print
1,361 from their recipes, where this game tests a few box pairs and adds
score digits without division. For the player physics it charges only
slope_collision's 455, with no figure for fixed_point_8_8 or
jump_arc_table; measured, the player is 4,237 worst. The measured typical
frame, 6,226, is far under the budget's low end, because most frames have
no column slice and no HUD change.

## Enemies on screen

The stock level never fills every slot, but a level an agent writes can. `make stage` builds the run with row 7 crowded (ten
enemies in the first view, `STAGE_CROWD` in `src/level.c`), so every slot
is live from the first play frame, and wants no late frame in the whole run
and the meter's worst inside one frame on each model.

| Build | NSLOT | Worst PAL | Worst NTSC | Late frames |
|---|---|---|---|---|
| walkers probing every step, HUD redrawn whole | 6 | 17,105 | 17,262 | yes |
| walker judges the column ahead once; HUD figures only | 6 | 15,632 | 15,977 in frames 1-255; 17,618 from frame 400 | on NTSC |
| the same | 5 | 14,523 | 14,829 in frames 1-255; 15,353 from frame 400 | none, either model |

So `NSLOT` is 5: sprites 1-5 are enemies, sprite 6 is free. Six live
enemies overran an NTSC frame by about 520 cycles; a sixth needs about
1,000 more cycles cut from the enemy loop first (`-dPROF=2`). The walker
cut: a walker judges the column 6 pixels ahead once, when it first reaches
it (edge, step or wall), and each step is one ground snap; odd and even
slots step on alternate frames.

## Proving it

| Command | What it proves | Last result |
|---|---|---|
| `make shot check` | 23 checks: the verdict, the HUD text (so the split's 40 columns and XSCROLL 0), the player sprite where arithmetic puts it, the hopper where the run leaves it, the scrolled playfield's brick, grass and pit at camera 576, the blank row 20, PAL and NTSC identical, the meter | 23 of 23 passed |
| `make selftest` | FORCE_FAULT makes a coin worth 20: the verdict fails, the HUD score reads 000200 | check.py rejected the build |
| `make tearcheck` | 16 shots a model mid-play, each matched pixel for pixel against a render of the level | 32 of 32 whole or two-frame composites; the TEAR_DEMO build: 2 of 32 torn (the count moves with the code; one is enough) |
| `make stage` | Every enemy slot live from the first play frame: no late frame, the meter inside one frame | 4 of 4 passed (worst 14,523 PAL, 14,829 NTSC) |
| `make claims` | Every store the run makes, title to verdict, against CLAIMS_ARGS | 0 violations |
| `make disk` | `build/platformer.d64`; it boots to the title | |

The self-check (`src/verdict.h`) grades the game's own state after the
script: every event seen (jump, landing, slope, ledge, coin, stomp, hit,
respawn, wake, sleep, both scroll directions, a wall), the score equal to
coins x 10 + stomps x 100, the lives, the player stopped by the brick at
x 716 and the camera at 576 (both arithmetic), every ready page equal to
the level at its column, the activation window's rules, the player's
sprite registers against the model, and no late frame.

After every play frame it also checks four invariants, each with its own
bit, so a fault that heals before the end still fails the run:

| Bit | Invariant | Mutation that trips it (PAL run) |
|---|---|---|
| `0800` | no dormant, living enemy inside the view (a pop-in) | wake window cut to the middle 24 columns: `FAIL 0880` |
| `1000` | every live enemy inside the drop window it was judged against | the drop never happens: `FAIL 1181` |
| `2000` | a grounded player stands exactly on its cell's surface | `surface_walk` reads every slope at column 0: `FAIL 223D` (tearcheck still 32 of 32: only this bit sees it) |
| `4000` | the page to show is the camera's column, and whole | left crossings ignored: `FAIL 4001`; tearcheck 28 of 32 |

Hits use boxes per animation frame with a group and a mask (c64-kb
`per_frame_hitbox`). The falling frame (`SH_FALL`, from the jump table's
apex on) carries two boxes, the body and the feet; only the feet are in the
stomp group, so a stomp is the feet reaching an enemy, not a height test.
Boxes are bytes relative to the player's foot; an enemy more than 40 pixels
away is not listed. Mutation: the feet box put in the player group turns
the scripted stomp into a hit, and the run ends in GAME OVER with the
verdict failed.

How the tear check works: VICE's exit screenshot is taken mid-frame, so a
shot can hold two frames, split at the beam. `tools/tearcheck.py` finds,
line by line, the camera positions at which the level render matches the
shot, and allows one seam between parts at most 2 pixels (one frame of
camera) apart, and only if the lower part, the older frame, is exactly
the camera the program printed on HUD row 23 ("CAM 0576") for that frame.
The same number must match the playfield in every shot: a page flipped
without its XSCROLL is 8 pixels off. A mid-picture XSCROLL write also
splits a shot into parts 1-2 pixels apart; the review's mutation (XSCROLL
written again at line 150) passed four shots as two frames until the
lower-part rule was added, and is now caught. Rows that are all sky match
every camera, so a tear inside them cannot be seen, by this check or by
eye. The TEAR_DEMO build
shifts the page on display in place, the old way; the check catches it
(off by 8, or torn), so the check can see a tear.

## Extending it

1. **A second level, or longer ones.** Edit the text in `src/level.c`;
   keep the metatile keys. For more than fits in memory, compress it with
   c64-kb `level-rle-decoder` (`docs/recipes/oscar64/level-rle-decoder.md`)
   or load levels from disk (`kernal_file_read_seq`,
   `docs/techniques/file-io.md`). `tools/tearcheck.py` renders the
   `LEVEL` text block, so a compressed level needs it changed too. Then re-time `src/autopilot.h` with
   `-dDEBUG_AT=n` builds: the script is a timeline, so a changed level
   changes the run.
2. **More enemies on screen than five.** One sprite per live slot is the
   limit here. A multiplexer lifts it: `sprite_multiplex_8`
   (`docs/recipes/oscar64/sprite-multiplex-8.md`) or the game multiplexer
   `sprite_multiplex_game` (`docs/recipes/kickassembler/sprite-multiplex-game.md`).
   The activation window already hands out slots; raising `NSLOT` is the
   easy part. The multiplexer's IRQs must join `engine.asm`'s `$FFFE`
   chain around lines 212 and 251, and it replaces `view_apply`.
3. **Parallax or a vertical component.** `charset_parallax`
   (`docs/recipes/oscar64/charset-parallax.md`) moves reserved glyphs for
   a background layer at no screen cost. Vertical scrolling needs
   `eight_way_scroll_double_buffer` (`docs/recipes/kickassembler/eight-way-scroll.md`),
   whose redraw and colour bands this three-page scheme would replace.

Smaller steps: a high-score table on disk (`high-score-persist`,
`docs/recipes/oscar64/high-score-persist.md`; the harness's `SHOT_DISK=1`
attaches the image during `make shot`), a variable jump height (cut
`pjump` to `JUMP_APEX` when fire is released while rising), more tiles
(add a key, four glyphs and their art).

## Driving it headless

`make joy` builds the normal game with its port byte read from `$02FE`
instead of `$DC00`; `tools/drive.py` (from the action-puzzle starter) plays
it over VICE's binary monitor, at real speed (no warp; the monitor port is
DRIVE_PORT or a free one), and reads the HUD page. Measured: title,
fire, LIVES 3, holding right loses all three lives, GAME OVER, the title
with HI 000030, fire, a new game at LIVES 3.

```bash
make joy
python3 tools/drive.py build/platformer-joy.prg "until:PRESS FIRE" tap:fire \
    "until:LIVES 3" hold:right "until:GAME OVER" "until:PRESS FIRE" print
```

`make run` starts the windowed VICE with no joystick device chosen: pick
one for port 2 in its settings, or pass one, e.g.
`make run X64SC_WINDOWED="x64sc -joydev2 1"` (1 is the numeric keypad,
from `x64sc -help`; not tried here).

## Which Oscar64

It builds and passes on both the local build named in c64-kb's CLAUDE.md
(1.32.271 plus c1270bc) and the released v1.32.273: `make shot check`,
`selftest` and `stage` pass on each (v1.32.273: worst 11,756 PAL, 12,204
NTSC). Two workarounds make that so, both for faults of the released
compiler that the local build does not have:

- `surface_at` (`src/level.c`) is `__noinline`. Inlined into
  `surface_walk`, v1.32.273 and upstream 9a902f6 compile
  `heights[((a & A_SLOPE) >> 1) | (x & 7)]` as `ORA heights,x` with X as
  `cell_attr` left it, and never compute the index: the player stops a few
  pixels up the first 45-degree slope and the run ends at LIVES 0. Issue
  #30 holds the fault.
- `hud_draw` writes the score through `put_digits`. A loop storing
  `HUD22[6 + i]` kept only the first digit on v1.32.273 (the HUD read
  `SCORE 0`); not reduced or filed.

## Left out on purpose

- The high score is not saved: it lives until power-off.
- No sprite multiplexer: at most five enemies live (see "Enemies on screen").
- No vertical scroll; the playfield is 20 rows, the level 10 tiles high.
- Colour RAM does not scroll: four colours for the whole playfield.
- NTSC runs the same per-frame steps at 60 Hz, so the game and the tune
  are 6/5 as fast there (c64-kb `pal_ntsc_tempo_mismatch`), and the tune's
  pitches, tabled for the PAL clock, about 4% sharp (arithmetic).
- One effect at a time on voice 3; a new one cuts the last.

## Not established

- A real `$DC00` joystick: the normal game was played through `make joy`
  (a RAM port byte), not through the CIA.
- Real hardware: everything was measured in VICE x64sc 3.10.
- The tune was never listened to; its note table is arithmetic.
- The tear check samples 32 moments of one run; it does not prove every
  frame. The three-page rule (the scroll never writes the page shown) is
  the design reason; the self-check compares every ready page with the
  level, and row 20 of every page with the sky.
