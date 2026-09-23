# shmup-vertical

A vertically scrolling shoot-em-up for the stock C64, PAL and NTSC, built
to be copied and grown into a game. It plays: title, fire to start, three
lives, game over, back to the title.

- A river scrolls down one line a frame, through all eight YSCROLL phases,
  above a fixed score panel.
- The ship is a multicolour sprite on joystick port 2. Its bullets are
  characters.
- Enemies arrive in waves set off by how far the river has scrolled. Each
  flies a small path program. With the ship, up to 13 sprites go through a
  multiplexer onto the 8 hardware sprites.
- Hits are tested with a box per sprite frame.
- A three-voice tune plays; shot, explosion and ship-lost effects borrow
  voice 3 and hand it back.
- The high score is saved to drive 8 and loaded at start. With no drive,
  the game runs without saving.

Make a project from it in c64-kb with
`npm run new-project -- shmup-vertical <dir>`, then `make run`.

## Files

| File | What it holds |
|---|---|
| `src/main.c` | States (title, play, game over), the ship, the frame loop, the autopilot script and its verdict |
| `src/level.c` | The river map and the downward scroll through two screens |
| `src/waves.c` | The wave list, the path bytecode, the pool of 12 enemies |
| `src/bullets.c` | Character bullets: save under, merge the glyph, restore in reverse |
| `src/hitbox.c` | Boxes per sprite frame; enemies against the ship and the bullets |
| `src/display.c` | Character set, sprite art (as text), the score panel |
| `src/hiscore.c` | The HISCORE file on drive 8 |
| `src/game.h` | Memory map, the kernel's variables as C names, shared state |
| `src/kernel.asm` | The raster IRQ chain and the panel split (KickAssembler) |
| `src/mux.asm` | The sprite multiplexer: sort, build, zone IRQs |
| `src/sound.asm` | The music player with effects inside it, and the tune |
| `PLAN.md` | The plan, with the c64-kb tool output it was built from |
| `expect.json` | What the screenshots must show |

C does the game; KickAssembler does what needs exact cycles and no zero
page. The harness assembles `kernel.asm` to a blob at `$0880` and writes
`build/asm.h`, so C calls it as `ASM_<LABEL>`.

## How a frame runs

The frame IRQ on line 252 sets the playfield's registers, shows the first
eight sprites and tells C a frame began. C then restores and redraws the
bullets (before the beam reaches the playfield), tests hits, moves the
ship, runs the waves, hands the actors to the multiplexer, draws three rows
of the hidden screen and sets next frame's scroll. Zone IRQs reuse sprites
down the screen. The split IRQ on line 212 switches to the panel on line
215 and plays the music.

## Measured

VICE x64sc 3.10, the autopilot's 240 play frames, the harness meter:

| Model | Worst frame | Typical (median) | Frame |
|---|---|---|---|
| PAL | 12,471 cycles | 7,099 | 19,656 |
| NTSC | 12,715 cycles | 7,283 | 17,095 |

The figures hold the C loop and every IRQ, with badlines and sprite DMA;
about 45 cycles of entry and exit per IRQ outside the C loop's bracket are
not in them. The script does not stage the heaviest case (12 enemies, 4
bullets and a kill on a carry frame); PLAN.md bounds it at about 15,600
cycles from the steps' separate maxima. The panel was pixel-identical at
all eight YSCROLL phases on both models. More in PLAN.md.

## Next steps

1. **Enemy fire.** Add an enemy-shot pool beside `bullets.c` (characters
   again, or sprites if they must pass over the panel's lines) and test it
   against the ship in `collide()`. Technique `char_bullets`, recipe
   `oscar64-char-bullets`; the group pairs of `per_frame_hitbox`, recipe
   `oscar64-per-frame-hitbox`.
2. **A boss.** Several sprites at fixed offsets from one origin, moved as
   one, entered as consecutive actors of the multiplexer. Technique
   `multi_sprite_object`, recipe `oscar64-multi-sprite-object`.
3. **Difficulty.** Replace the spacing shift in `spawner()` with level
   tables read from data: speeds, counts and spacing per loop, held at the
   last row. Technique `difficulty_ramp_tables`, recipe
   `oscar64-difficulty-tables`.

The level is the `bank` table in `level.c` (river widths every 4 map rows)
and the `wave` table in `waves.c` (map row, path, type, count, spacing,
formation). Paths are the byte arrays above them.

## Left out on purpose

- Colour per map cell: colour RAM cannot be double-buffered, so every
  playfield cell shares one colour RAM value and the map is 4 colours.
- Sprites below line 208: the panel split is timed on lines 212-215.
- Enemy fire, power-ups, a boss, a high-score table with names.
- Keyboard and a second joystick; RESTORE does nothing.

## Checks

`make shot check` runs the autopilot on PAL and NTSC with drive 8
attached. The script shoots darts and saucers, takes one ram, fires
through a parade of ten enemies, then stops; the program freezes on
YSCROLL 3, saves and reloads the high score and grades 14 facts, printing
the number of the first that fails. `expect.json` then checks the verdict,
the text, the meter, the ship and all ten parade sprites, the river's
banks at 30 rows scrolled, the split and the panel. `make selftest` starts
the ship 16 pixels to the right and must fail. `make claims` checks every
store the program makes against what the Makefile declares.
