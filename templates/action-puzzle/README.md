# action-puzzle: CAVE RUN

A Boulder Dash-style cave game for a stock C64, PAL and NTSC, in Oscar64 C.
Copy it to start a game of this kind:

```bash
npm run new-project -- action-puzzle ~/c64/mygame     # in c64-kb
```

The player digs through earth. Boulders and gems fall and roll. Sparks keep
a wall on their left, moths a wall on their right; either explodes when the
player is next to it, and a moth crushed by a boulder bursts into gems.
Boulders can be pushed sideways into space. Collecting the cave's quota of
gems opens the exit. A time counter, a score, three lives. At game over a
new high score is entered with the joystick and the five-row table is saved
to drive 8; it is loaded again at start-up. An original two-voice tune plays
throughout, with sound effects on the third voice. Graphics, caves and tune
are original.

Joystick in port 2. Fire starts; up and down pick a letter, fire sets it.

## Files

| File | What it holds |
|---|---|
| `src/main.c` | States (title, next cave, play, name entry, table), the frame loop, input, the autopilot and its verdict |
| `src/cave.c`, `cave.h` | The rules: the cave scan, split into row slices (technique `cave_scan_engine`) |
| `src/level.c`, `level.h` | The RLE cave decoder, timed on CIA1 timer B (`tile_map_render`, decode half) |
| `src/render.c`, `render.h` | RAM character set at `$2000`, cell drawing, the dirty list, text, glyph animation (`charset_animation`) |
| `src/sound.c`, `sound.h` | The tune on voices 1 and 2, effects on voice 3 (`sid_play_routine_pattern`, `sfx_engine_beside_music`) |
| `src/hiscore.c`, `hiscore.h` | The table, the insert, the file on drive 8 (`high_score_table_insert`, `kernal_file_read_seq`, `kernal_file_write_seq`, `error_channel_check`) |
| `tools/gen.py` | The caves, the autopilot script, a Python model of the rules, the note table. Writes `src/gen_*.h` |
| `tools/model_check.py` | Every visible cave cell of both shots against the model (`make modelcheck`) |
| `tools/disk_check.py` | Grades `make disktest` |
| `expect.json`, `PLAN.md` | The screenshot checks; the plan with the c64-kb tool output it was made from |

Memory: code and data `$0880`-`$1FFF` and `$2800` up; the character set
`$2000`-`$27FF` (`$D018` = `$18`); screen `$0400`. Screen row 0 is the HUD,
rows 1 to 22 the cave (one character a cell), row 23 messages, row 24 the
cave name and, in AUTOPILOT builds, the frame meter.

## How it runs

One cave frame is one scan of the 38 x 20 interior. It is split into four
slices of five rows, one slice a display frame, so the cave moves once every
four frames on both models (12.5 cave frames a second on PAL, 15 on NTSC).
The player's direction is latched at the first slice. Each slice redraws
only the cells it changed. After the fourth slice the exit opens if the
quota is met and the time counter ticks (once every 12 cave frames).

The KERNAL IRQ is off during play; the loop polls raster line 250. Disk
calls happen on a static screen with the sound muted, and `SEI` follows
each one, because the KERNAL serial routines end in `CLI`.

## Checks

| Command | What it proves |
|---|---|
| `make shot check` | The autopilot game on PAL and NTSC: 41 checks (verdict, HUD, the table row it inserted, cave cells, PAL = NTSC, the meter) |
| `make modelcheck` | 516 visible cave cells per shot match the model's cave at game over |
| `make selftest` | The FORCE_FAULT build (11 points a gem) fails: red border, wrong score in the HUD and the table |
| `make disktest` | The save and the load on a true-drive 1541 (below) |
| `make claims` | Every store the autopilot run makes is one the Makefile declares |

The autopilot digs right along row 2, collects four gems, pushes a boulder
twice, digs down for two more, walks into the open exit, then in cave 2 digs
out from under a boulder and stands still: the boulder falls and kills him.
It starts with one life, so that is game over. It enters the name ABE; the
score 158 goes in row 4. `tools/gen.py` plays the same script through its
model and writes what the game must end with: the cave's fold (0xC0F1),
score, gems, cave and play frames. The program compares, then sets `$02FF`
and the border.

**The disk test.** `make disktest` (`DISK_MODEL=ntsc` for NTSC) copies the
release D64, runs the autopilot build against it with `-drive8truedrive`
(the emulated 1541 runs its own DOS ROM): it finds no file (62), plays,
saves (scratch, then write), and shows `SAVED TO DISK (00)`. c1541 then
reads the 38-byte `HISCORE` file back from the image. A second, cold VICE
autostarts the D64 itself: the drive loads the release PRG, which reads the
file and shows the title with `4. ABE 000158` and `SCORES FROM DISK (00)`.
Both pictures and the file are graded. Run on 2026-09-23: PASS on PAL and
NTSC; the PAL pictures were byte-identical over two runs.

## The measured frame

The harness meter (CIA2 timer A), over the autopilot's 140 play frames,
VICE x64sc 3.10:

| Model | Worst | Typical (median) | Frame |
|---|---|---|---|
| PAL | 10,037 | 6,371 | 19,656 |
| NTSC | 10,294 | 6,629 | 17,095 |

The worst frame is play frame 80, where the exit opens: the fourth slice,
the cave-frame end, the HUD rewriting the gem count and the score, and the
exit's effect starting, in one frame. A debug build that kept the worst
frame's index found it (its own worst read 10,496, with the extra code). The
cave decode between caves is not a play frame: 40,057 cycles on PAL and
40,571 on NTSC for cave 2 (293 bytes packed), screen on, CIA1 timer B,
printed after the verdict.

Against `plan-budget` (the PLAN.md output): it summed the recipe's whole
scan, 18,559 cycles, into every PAL play frame (range 19,599 to 19,807 plus
1,075 for badlines, "undetermined") and left it out of the NTSC frame as
multi-frame (1,040 to 1,248 plus 1,075). Neither is this program's frame:
the scan here runs a quarter at a time. A scan loop of 14 cycles a cell of
dirt (from the generated code; the recipe's loop measured about 19) makes a
slice of 190 cells about 2,700 cycles plus the objects in it. The tool's
music figure is the recipe's stub tune; this tune and its effects are
measured only inside the whole frame.

## Extending it

1. **Scroll a bigger cave.** Draw cells as 2 x 2 characters and scroll a
   window over a cave larger than the screen: `tile_map_render` and the
   recipe `oscar64/tile-map-render` (metatiles), then a scroll technique
   from `technique-lookup` (`techniques-for --category scroll`).
2. **Add amoeba, a magic wall or more enemies.** Add codes in `cave.h`, a
   branch in `cell()` and the same rule in `tools/gen.py`'s `Cave.cell`;
   extend the script and run `make gen shot check modelcheck`. The rules and
   the scanned bit are `cave_scan_engine` (recipe `oscar64/cave-scan`).
3. **Faster scans.** The scan loop is C; the recipe `oscar64/level-rle-decoder`
   shows a hand-written decoder at about half the C one's cycles, and the same
   move applies to `cave_scan_rows`. Measure before and after with the meter.

More caves: add them to `CAVES` in `tools/gen.py` and run `make gen`.

## Left out on purpose

- Scrolling, 2 x 2 cells, multicolour graphics, sprites: one cell is one
  hires character, so the whole 40 x 22 cave is on screen.
- Amoeba, magic wall, slime, collecting falling gems, the fire-to-grab move.
- A raster IRQ: the loop polls line 250. Music keeps time only while the
  loop does; it stops during disk calls.
- Equal speed on both models: NTSC plays 20 % faster in real time,
  tune included (pitfall `pal_ntsc_tempo_mismatch`). The note pitches are
  right on both (a PAL and an NTSC table).
- Anyone listening to the sound: the tune and effects were checked by the
  registers claims-watch saw written, not by ear.
- A human at the joystick: headless runs drive the autopilot, which feeds
  the same input path the port does. The title screen was seen from the
  disk boot; play by hand was not run here.
- Real hardware, and the released Oscar64 (built with the build c64-kb's
  CLAUDE.md names).
