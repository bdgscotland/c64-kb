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
| `src/bullets.c` | The ship's bolts and the enemies' dots: firing, moving, what to draw |
| `src/hitbox.c` | The ship's and bolts' boxes; the hits turned into events |
| `src/display.c` | Character set, sprite art (as text), the score panel |
| `src/hiscore.c` | The HISCORE file on drive 8 |
| `src/game.h` | Memory map, the kernel's variables as C names, shared state |
| `src/kernel.asm` | The raster IRQ chain, the panel split, the three-row copy (KickAssembler) |
| `src/mux.asm` | The sprite multiplexer: sort, build, zone IRQs |
| `src/sound.asm` | The music player with effects inside it, and the tune |
| `src/glyph.asm` | The character-bullet list: draw, erase, the restore check; the dots' step |
| `src/hit.asm` | Every enemy's box against the ship's and the bolts' |
| `src/step.asm` | One path step for every flying enemy |
| `tools/phases.py` | `make phases`: the panel at every YSCROLL phase against the graded one |
| `tools/meter.py` | `make stage`: reads the meter off the staged run's shots |
| `tools/drive.py` | Plays the `make joy` build headless over VICE's binary monitor |
| `tools/joytest.py` | `make joytest`: a game to GAME OVER, then a reboot that must show the saved HI |
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
| PAL | 12,912 cycles | 9,529 | 19,656 |
| NTSC | 13,015 cycles | 9,659 | 17,095 |

The heaviest case, `make stage` (12 enemies flying, bolts, dots and a kill
in the same frames, play frames 150-399). The worst of a sweep of its
timing over 16 variants, and the default it runs:

| Model | Worst of the sweep | `make stage` worst | Typical | Frame |
|---|---|---|---|---|
| PAL | 15,991 cycles | 15,982 | 11,376 | 19,656 |
| NTSC | 16,136 cycles | 16,123 | 11,676 | 17,095 |

No staged or graded run lost a frame (the verdict counts frames that ran
into the next). The figures hold the C loop's frame and every IRQ, with
badlines and sprite DMA; about 45 cycles of entry and exit per IRQ outside
the C loop's bracket are not in them. The meter's readout is printed only
after the freeze. Printed every frame, it cost up to 3,404 cycles outside the
bracket and made the autopilot build drop frames that the game itself does
not. The self-check of the bullet cells (about 250 cycles) runs in AUTOPILOT
builds only and is inside the figures.

The bullet draw must end before the beam reaches the cells it changes. The
smallest margin measured (`-dDRAWEND=1`) was 17 lines, for a dot on NTSC in
the graded run, and 28 lines, for both kinds, in the staged run.

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
   the ship only: `hit.asm` tests its boxes against enemies, so give pickups
   their own loop beside `ship_hit()` in `hitbox.c`. Technique
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
starts the ship 16 pixels to the right and must fail. `make stage` and
`make joytest` are this starter's proof targets (VERIFY_TARGETS), which
`npm run verify:templates -- --selftest` runs too. `make claims` checks
every store the program makes against what the Makefile declares. `make
joy` builds the normal game reading its stick from `$02FE`, for
`python3 tools/drive.py build/shmup-vertical-joy.prg "until:PUSH FIRE" tap:fire ...`
(it takes a free monitor port unless DRIVE_PORT names one).

Measuring switches, none in a release build: `-dPROFILE=1` (each step of the
heaviest frame), `-dDRAWEND=1` (the bullet draw's margin to the beam),
`-dEVENTLOG=1` (each kill and hit with its frame), `-dLOOP_TEST=1` (play to
GAME OVER and back), `-dFREEZE_Y=0..7` (freeze on another phase).
