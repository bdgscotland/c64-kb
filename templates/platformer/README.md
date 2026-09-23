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

`make run` opens VICE with the joystick in port 2. Left and right run,
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
| `src/actors.c` | Enemies: the activation window, six live slots, walker and hopper, hit tests |
| `src/view.c` | VIC-II: bank 3, the camera, the three-page scroll, sprite shadows |
| `src/anim.c` | Animation sequences (frame, duration, loop or hold) |
| `src/hud.c`, `src/sound.c` | Score digits and HUD text; sound effects on SID voice 3 |
| `src/engine.asm` | KickAssembler: the slice copy for the scroll, the two raster IRQs, the tune and its player |
| `src/autopilot.h`, `src/verdict.h` | AUTOPILOT builds only: the scripted joystick and the self-check |
| `tools/tearcheck.py` | Renders the level from `src/` and proves no picture tears (`make tearcheck`) |
| `expect.json`, `PLAN.md` | The screenshot checks; the plan with the c64-kb tool output |

## How a frame runs

The main loop waits for the IRQ at raster line 251, then writes the
sprites, plays the tune and the effects, runs the player, the enemies and
the camera, and publishes the next picture's `$D018` and `$D016` as one
pair. Two raster IRQs in `engine.asm` own those registers: at line 212,
inside the blank character row 20, the HUD gets 40 columns, hires and its
own screen page; at line 251 the playfield gets the published pair back.
A frame whose work runs long therefore shows the last picture again,
never a half-set one.

The scroll never writes the page on display. XSCROLL moves the picture a
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
| PAL | 12,553 | 7,039 | 19,656 |
| NTSC | 12,982 | 7,443 | 17,095 |

Per subsystem, built with `-dPROF=n` (worst / typical, PAL; NTSC within
400 cycles of each):

| n | Subsystem | Worst | Typical |
|---|---|---|---|
| 1 | player physics, coins | 4,265 | 1,698 |
| 2 | enemies: window, AI, hit tests | 4,631 | 2,410 |
| 3 | camera and scroll slice | 4,001 | 241 |
| 4 | sprites to the VIC, tune, effects | 925 | 706 |
| 5 | HUD, sprite shadows, publish | 3,488 | 973 |

The worst frames of the parts do not fall together: the whole frame's
worst is 12,553, not their sum. Every figure is wall time, so badline and
sprite DMA are in it, and so is the split IRQ when it lands inside the
bracket (work past line 212; about 56 cycles by arithmetic). The IRQ at
251 falls just before the bracket opens and is not counted: about 66
cycles by arithmetic.

Against `plan-budget` (PLAN.md): it gave 10,167 to 10,765 cycles plus
1,432 fixed, 11,599 to 12,197 in all, verdict undetermined, with the
scroll left out (its only figure was the old recipe's 74,041-cycle shift,
issue #18) and six techniques unknown. The measured worst is 356 cycles
(PAL) and 785 (NTSC) above that range's top. The parts disagree more than
the total: the budget charges per-frame-hitbox 3,693 and decimal-print
1,361 from their recipes, where this game tests six box pairs and adds
score digits without division, but has no figure at all for the player
physics, which is the costliest single part here. The measured typical
frame, 7,039, is far under the budget's low end, because most frames have
no column slice and no HUD change.

## Proving it

| Command | What it proves | Last result |
|---|---|---|
| `make shot check` | 23 checks: the verdict, the HUD text (so the split's 40 columns and XSCROLL 0), the player sprite where arithmetic puts it, the hopper where the run leaves it, the scrolled playfield's brick, grass and pit at camera 576, the blank row 20, PAL and NTSC identical, the meter | 23 of 23 passed |
| `make selftest` | FORCE_FAULT makes a coin worth 20: the verdict fails, the HUD score reads 000200 | check.py rejected the build |
| `make tearcheck` | 16 shots a model mid-play, each matched pixel for pixel against a render of the level | 32 of 32 whole or two-frame composites; the TEAR_DEMO build: 2 of 32 torn (the count moves with the code; one is enough) |
| `make claims` | Every store the run makes, title to verdict, against CLAIMS_ARGS | 0 violations |
| `make disk` | `build/platformer.d64`; it boots to the title | |

The self-check (`src/verdict.h`) grades the game's own state after the
script: every event seen (jump, landing, slope, ledge, coin, stomp, hit,
respawn, wake, sleep, both scroll directions, a wall), the score equal to
coins x 10 + stomps x 100, the lives, the player stopped by the brick at
x 716 and the camera at 576 (both arithmetic), every ready page equal to
the level at its column, the activation window's rules, the player's
sprite registers against the model, and no late frame.

How the tear check works: VICE's exit screenshot is taken mid-frame, so a
shot can hold two frames, split at the beam. `tools/tearcheck.py` finds,
line by line, the camera positions at which the level render matches the
shot, and allows one seam between parts at most 2 pixels (one frame of
camera) apart. It also reads the camera the program printed on HUD row 23
("CAM 0576") for the picture on display and wants the playfield there: a
page flipped without its XSCROLL is 8 pixels off. The TEAR_DEMO build
shifts the page on display in place, the old way; the check catches it
(off by 8, or torn), so the check can see a tear.

## Extending it

1. **A second level, or longer ones.** Edit the text in `src/level.c`;
   keep the metatile keys. For more than fits in memory, compress it with
   c64-kb `level-rle-decoder` (`docs/recipes/oscar64/level-rle-decoder.md`)
   or load levels from disk (`kernal_file_read_seq`,
   `docs/techniques/file-io.md`). Then re-time `src/autopilot.h` with
   `-dDEBUG_AT=n` builds: the script is a timeline, so a changed level
   changes the run.
2. **More enemies on screen than six.** One sprite per live slot is the
   limit here. A multiplexer lifts it: `sprite_multiplex_8`
   (`docs/recipes/oscar64/sprite-multiplex-8.md`) or the game multiplexer
   `sprite_multiplex_game` (`docs/recipes/kickassembler/sprite-multiplex-game.md`).
   Raise `NSLOT`; the activation window already hands out slots.
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

## Left out on purpose

- The high score is not saved: it lives until power-off.
- No sprite multiplexer: at most six enemies live.
- No vertical scroll; the playfield is 20 rows, the level 10 tiles high.
- Colour RAM does not scroll: four colours for the whole playfield.
- NTSC runs the same per-frame steps at 60 Hz, so the game and the tune
  are 6/5 as fast there (c64-kb `pal_ntsc_tempo_mismatch`), and the tune's
  pitches, tabled for the PAL clock, about 4% sharp (arithmetic).
- One effect at a time on voice 3; a new one cuts the last.

## Not established

- Joystick play by a person: every run here was the autopilot. The
  release build's title screen was shot, and so was the disk image booting
  to it, but no fire press was sent to it.
- Real hardware: everything was measured in VICE x64sc 3.10.
- The tune was never listened to; its note table is arithmetic.
- The tear check samples 32 moments of one run; it does not prove every
  frame. The three-page rule (no page written while shown) is the design
  reason; the self-check compares every ready page with the level.
