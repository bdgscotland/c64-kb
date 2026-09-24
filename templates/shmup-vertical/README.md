# shmup-vertical

A vertically scrolling shoot-em-up for the stock C64, PAL and NTSC, built
to be copied and grown into a game. It plays: title, fire to start, three
lives, game over, back to the title.

- A river scrolls down one line a frame, through all eight YSCROLL phases,
  above a fixed score panel.
- The ship is a multicolour sprite on joystick port 2. Its bolts are
  characters.
- Enemies arrive in waves set off by how far the river has scrolled. Each
  flies a small path program, which can fire: a dot, also a character,
  falls towards where the ship was. With the ship, up to 13 sprites go
  through a multiplexer onto the 8 hardware sprites.
- Hits are tested with a box per sprite frame.
- A three-voice tune plays; shot, explosion and ship-lost effects borrow
  voice 3 and hand it back.
- The high score is saved to drive 8 and loaded at start; a fresh disk's
  title shows HI 000000. With no drive, the game runs without saving. A
  save that was cut off (a splat file) is scratched and written again.

Fire starts a game on the title only after it has been released: hold it
through GAME OVER and the title waits.

Make a project from it in c64-kb with
`npm run new-project -- shmup-vertical <dir>`, then `make run`.

## Files

| File | What it holds |
|---|---|
| `src/main.c` | States (title, play, game over), the ship, the frame loop, the autopilot scripts and their verdict |
| `src/level.c` | The river map and the downward scroll through two screens |
| `src/waves.c` | The wave list, the path bytecode (MOVE, LOOP, FIRE, END), the pool of 12 enemies |
| `src/bullets.c` | The ship's bolts and the enemies' dots: firing and the rules |
| `src/hitbox.c` | The ship's box; the hits turned into events |
| `src/display.c` | Character set, sprite art (as text), the score panel |
| `src/hiscore.c` | The HISCORE file on drive 8 |
| `src/game.h` | Memory map, the kernel's variables as C names, shared state |
| `src/kernel.asm` | The raster IRQ chain, the panel split, the three-row copy (KickAssembler) |
| `src/mux.asm` | The sprite multiplexer: sort, build, zone IRQs |
| `src/sound.asm` | The music player with effects inside it, and the tune |
| `src/glyph.asm` | The character bullets: the bolts' and the dots' moves and draws, the list, the erase, the restore check |
| `src/hit.asm` | The dots against the ship; every enemy's box against the ship's and the bolts' |
| `src/step.asm` | The path bytecode run for every enemy, explosions, one path step for every flying enemy |
| `tools/phases.py` | `make phases`: the panel at every YSCROLL phase against the graded one |
| `tools/meter.py` | `make stage`: reads the meter off the staged run's shots |
| `tools/drive.py` | Plays the `make joy` build headless over VICE's binary monitor |
| `tools/joytest.py` | `make joytest`: games played on PAL and NTSC to GAME OVER, graded on lost frames, and a reboot that must show the saved HI; `make longplay`: long games with a ship that is never lost |
| `PLAN.md` | The plan, with the c64-kb tool output it was built from |
| `expect.json`, `stage-expect.json` | What the graded and the staged screenshots must show |

C does the game; KickAssembler does what needs exact cycles, no zero page,
or runs for every enemy or bullet every frame. The harness assembles
`kernel.asm` (which imports the other `.asm` files) to a blob at `$0880`
and writes `build/asm.h`, so C calls it as `ASM_<LABEL>`.

## How a frame runs

The frame IRQ on line 252 sets the playfield's registers, shows the first
eight sprites and tells C a frame began. C then restores the bullet cells,
checks them against the map (AUTOPILOT builds), and moves and draws the
bolts and dots before the beam reaches them. It tests hits, moves the ship,
runs the waves, hands the actors to the multiplexer, draws three rows of
the hidden screen and sets next frame's scroll. Zone IRQs reuse sprites down
the screen. The split IRQ on line 212 switches to the panel on line 215 and
plays the music.

## Measured

VICE x64sc 3.10, the harness meter. The graded script's 240 play frames:

| Model | Worst frame | Typical (median) | Frame |
|---|---|---|---|
| PAL | 11,681 cycles | 8,374 | 19,656 |
| NTSC | 11,875 cycles | 8,733 | 17,095 |

`make stage` plays a script that puts 12 enemies, bolts, dots and a kill in
the same frames, and meters play frames 150-399. The worst of a sweep of its
timing over 16 variants is the variant it runs:

| Model | `make stage` worst | Typical | Frame |
|---|---|---|---|
| PAL | 15,064 cycles | 9,280 | 19,656 |
| NTSC | 15,237 cycles | 9,967 | 17,095 |

The figures hold the C loop's frame and every IRQ, with badlines and sprite
DMA. They leave out the loop's head (the wait, the scroll hand-over, the
stick), the meter's own bookkeeping and about 45 cycles of entry and exit
per IRQ outside the C loop's bracket. So a frame can be lost below 17,095:
at 7974a7a the staged run lost one on NTSC with its worst at 16,122.

The staged worst was not the heaviest frame play reaches. With fire held
and the ship swept, NTSC play lost frames at 7974a7a: in the review's
drive, 6 of 15 games, at play frame 465 in 5 of them; in a build of it
with `-dWORKEND=1`, 4 of 4 games, at play frames 282-321 (the row-32 and
row-40 swoops) and 454-477 (the row-48 saucers and the row-56 darts on the
screen together), with bolts, dots and kills in the same frames. The staged
run stops recording at play frame 399, before the second stretch.
`-dWORKEND=1` reads the raster when a frame's work ends, in lines after the
frame IRQ's line 252: the staged run's latest end on NTSC is now line 249
of 263, and play's is 256, at play frames 464-472.

Cuts to the work brought play back inside the NTSC frame; PLAN.md lists
them with their figures. The largest: the bolts' loop, the paths and the
dots' test against the ship moved to KickAssembler; the enemy box scan
skips enemies whose lines miss every box and walks only the boxes that are
on; the multiplexer's build loop keeps its write place in a register.
`make joytest` now plays 16 games a model with fire held and a sweep, and
fails on any lost frame: 16 of 16 NTSC games lost none. `make longplay`
plays 4 games a model for 40 s of warp with a ship that is never lost
(about 44,000 play frames each on NTSC, through the level's later loops):
none lost a frame. The latest end over those runs was line 256 of 263 on
NTSC (7 lines, about 450 cycles, to spare) and 243 of 312 on PAL.

A frame far past the frame shows in the meter as about 65,524: CIA2 timer A
counts down from 65,535 and wraps. A reading that high is a wrap, not the
frame's size; count the lost frames instead (`OVERRUNS` in the verdict,
`LOST_FRAMES` at `$02FD` in any build).

The meter's readout is printed only after the freeze. Printed every frame,
it cost up to 3,404 cycles outside the bracket and made the autopilot build
drop frames that the game itself does not. The self-check of the bullet
cells (about 250 cycles, and the map code each draw notes for it) runs in
AUTOPILOT builds only and is inside the figures.

The bullet draw must end before the beam reaches the cells it changes. The
smallest margin measured (`-dDRAWEND=1`, NTSC) was 19 lines for a dot in
the graded run and 25 in the staged run; for the bolts, read after all of
them were drawn, 26 in both. On PAL the bolts were drawn before line 0 and
the dots had 69 lines or more.

`make phases` (part of `make check`) freezes the game on each of the eight
YSCROLL phases and wants the panel identical to the graded one on both
models: a bad entry in the split's delay table fails it. More in PLAN.md.

## Next steps

1. **A boss.** Several sprites at fixed offsets from one origin, moved as
   one, entered as consecutive actors of the multiplexer. Technique
   `multi_sprite_object`, recipe `oscar64-multi-sprite-object`.
2. **Difficulty.** Replace the spacing shift in `spawner()` with level
   tables read from data: speeds, counts, spacing and fire per loop, held
   at the last row. Technique `difficulty_ramp_tables`, recipe
   `oscar64-difficulty-tables`.
3. **Power-ups.** A pickup is one more actor with its own box group against
   the ship only: `hit.asm`'s `hit_scan` tests its boxes against enemies,
   so give pickups their own loop beside `dot_scan` there. Technique
   `per_frame_hitbox`, recipe `oscar64-per-frame-hitbox`.

The level is the `bank` table in `level.c` (river widths every 4 map rows)
and the `wave` table in `waves.c` (map row, path, type, count, spacing,
formation). Paths are the byte arrays above them; `P_FIRE` fires a dot when
the enemy is between sprite Y 72 and 140 (the window that keeps the draw
ahead of the beam). Re-run `make stage` after changing either.

## Left out on purpose

- Colour per map cell: colour RAM cannot be double-buffered, so every
  playfield cell shares one colour RAM value and the map is 4 colours.
- Sprites below line 208: a sprite on line 214 breaks the panel split
  (measured); 209-213 were clean, and MAX_SY keeps 5 lines of margin.
- Enemy fire from above sprite Y 72 or below 140; power-ups, a boss, a
  high-score table with names.
- Keyboard and a second joystick; RESTORE does nothing.

## Checks

`make shot check` runs the autopilot on PAL and NTSC with a fresh copy of
the disk on drive 8. The script shoots darts and saucers, is hit by a dart's
dot, fires through a parade of ten enemies, then stops; the program freezes
on YSCROLL 3, saves and reloads the high score and grades 18 facts,
printing the number of the first that fails. `expect.json` then checks the
verdict, the text, the meter, the ship and all ten parade sprites, the
river's banks at 30 rows scrolled, the split and the panel. `make selftest`
starts the ship 16 pixels to the right and must fail. `make stage`, `make
joytest` and `make longplay` are this starter's proof targets
(VERIFY_TARGETS), which `npm run verify:templates -- --selftest` runs too. `make claims` checks
every store the program makes against what the Makefile declares. `make
joy` builds the normal game reading its stick from `$02FE`, for
`python3 tools/drive.py build/shmup-vertical-joy.prg "until:PUSH FIRE" tap:fire ...`
(it takes a free monitor port unless DRIVE_PORT names one).

Measuring switches, none in a release build: `-dPROFILE=1` (each step of the
heaviest frame), `-dDRAWEND=1` (the bullet draw's margin to the beam),
`-dWORKEND=1` (how late in the frame the work ended, at `$0370`; `=2` adds
each step), `-dEVENTLOG=1` (each kill, hit and lost frame with its frame),
`-dGOD=1` (the ship is never lost), `-dLOOP_TEST=1` (play to GAME OVER and
back), `-dFREEZE_Y=0..7` (freeze on another phase).
