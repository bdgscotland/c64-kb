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

The dirty list holds 16 cells: 8 moves, since a move marks two cells (an
explosion marks nine). When a slice changes more, the list overflows and
the slice's rows (one above to one below) are queued instead;
`draw_pending` redraws at most two queued rows a frame, 34 cycles a cell
from the generated code, about 2,800 cycles for two rows. The first version
redrew all seven rows in the frame of the overflow, 55,305 cycles for 280
cells (measured in comparison), almost three PAL frames.

**How many objects a slice can move.** Each moving or landing object costs
about 440 cycles on top of the slice's usual work: 16 boulders falling in
one slice made a 13,643-cycle PAL frame and a 13,861-cycle NTSC one, against
a typical frame of about 6,500 to 6,800 (the meter; arithmetic for the per-object
figure). So about 20 moving objects a slice fit an NTSC frame, and about 25
fit a PAL one. A cave that moves more in one slice drops frames. The
autopilot's verdict counts dropped frames (below), so a cave designed past
that limit fails its own check. The cave-scan recipe's 380-boulder fill is
far past it; this starter's caves keep falls short and spread out.

The KERNAL IRQ is off during play; the loop polls raster line 250. Disk
calls happen on a static screen with the sound muted, and `SEI` follows
each one, because the KERNAL serial routines end in `CLI`.

## Checks

| Command | What it proves |
|---|---|
| `make shot check` | The autopilot game on PAL and NTSC, each on a fresh D64 (`SHOT_DISK := 1`): 41 checks (verdict, HUD, the table row it inserted, the save read back, cave cells, PAL = NTSC, the meter) |
| `make modelcheck` | 516 visible cave cells per shot match the model's cave at game over |
| `make selftest` | The FORCE_FAULT build flips one byte of the save as it is read back: red border, letter V, and `READ BACK BAD` in the table |
| `make selftest-scan` | The build with `SCAN_FLAG=0` (no scanned bit, the cave-scan recipe's double-move bug) fails, and its verdict names E |
| `make disktest` | The save, a second save over it, and the load on a true-drive 1541 (below) |
| `make claims` | Every store the autopilot run makes is one the Makefile declares |

The autopilot plays a whole game of three lives. Its script is keyed to
the game's own counter of cave starts: start 1 digs right along row 2,
collects four gems, pushes a boulder twice, digs down for two more and walks
into the open exit. Starts 2, 3 and 4 are cave 2 after each lost life: out
from under a boulder, then under another, then the first again, and each
time the boulder falls on him. So the restart path (the cave decoded again,
a life taken, the score banked) runs twice. It enters the name ABE; 158
goes in row 4, and the table is saved and read back from the shot's fresh
disk. In cave 1 a boulder on the end of a brick rolls right, and a row of
16 boulders falls and lands in one slice, which overflows the dirty list.

`tools/gen.py` plays the same script through its model and writes what the
game must end with. The verdict prints one letter for each test that
failed, after the fold on row 23:

| Letter | Test |
|---|---|
| F | the fold, chained over every cave the game left (0x75FA), against the model's |
| S, G, C, P, K | score, gems, cave, play frames, cave starts |
| T | the table row: rank, name and score |
| L | every cave decode matched its fold |
| E | the scan met the living player exactly once in every cave frame |
| M | at every cave end, after the row queue is drained, every screen cell shows its cave cell |
| D | no play frame's work ran past line 250 (the `$D019` raster latch, below) |
| V | the save read back byte for byte (`memcmp`) |

A watchdog ends the game once play runs past the model's frame count, so a
broken rule still reaches the verdict. Each gate was checked with a
mutation (2026-09-23): no right roll (F), no `dead_frames` reset on restart
(F P K D), the row queue disabled (M), the save one byte short (V), the
`memcmp` replaced by true (selftest then passes the fault build and fails),
a busy loop in one play frame (D), and the E test removed (selftest-scan
then finds no E).

**Dropped frames.** The VIC sets bit 0 of `$D019` on every raster compare
match even with the interrupt disabled. `wait_frame` acknowledges it at line
250, so a set bit on entry means the frame's work overran. The KERNAL leaves
the compare at line 311 (bit 8 set in `$D011`), so `main` clears that bit
first: without it the latch never set (0 of 200 frames against 199 of 200,
a test program in VICE x64sc 3.10).

**The shot pin.** Both models are shot at 24,000,000 cycles. At
18,000,000 the save is still running on both models; at 20,000,000,
24,000,000 and 30,000,000 the picture is byte-identical, PAL and NTSC
(VICE x64sc 3.10, windowless).

**The disk test.** `make disktest` (`DISK_MODEL=ntsc` for NTSC) copies the
release D64. It runs the autopilot build against the copy with
`-drive8truedrive`, so the emulated 1541 runs its own DOS ROM. The build
finds no file (62), plays, saves (scratch, then write) and shows
`SAVED TO DISK (00)`. It then runs a second time on the same image. It
loads that file, its 158 ties row 4 and goes in row 5, and the save must
replace the file. Without the scratch the drive answers 63 (FILE EXISTS)
and nothing is written: a build with the scratch removed fails this test.
The second run's own verdict is red by design, because it did not start
from the default table. c1541 reads the 38-byte `HISCORE` file back after
each save, and the directory must hold one entry. Last, a cold VICE
autostarts the D64: the drive loads the release PRG, which reads the file
and shows the title with rows 4 and 5 `ABE 000158` and `SCORES FROM DISK
(00)`. Three pictures, two files and the directory are graded. Run on
2026-09-23: PASS on PAL and NTSC.

## Driving it headless

`harness/drive.py` plays the normal game (three lives, title, no autopilot)
over VICE's binary monitor, with the stick on the real `$DC00`. It counts
time in frames, so the same steps give the same run every time, and reads
screen RAM as text:

```bash
make drive STEPS='"until:FIRE TO START" tap:fire until:LIVES hold:right \
    "until:ENTER YOUR NAME" hold:none tap:up tap:fire tap:fire tap:fire \
    "until:GAME OVER" print tap:fire "until:FIRE TO START" print'
```

That run (2026-09-24, VICE x64sc 3.10) held right through three time-outs
(cave 1 each time, 14,475 frames), entered BAA, and showed `4. BAA 000120`
in the table, `NOT SAVED (74)` with no disk attached, and then the title.
`make drivetest` (a proof target) plays the first cave until a gem is taken.
Two findings behind this design:

- VICE's joyport command reaches `$DC00` only when control port 2 holds the
  "Joyport I/O simulation" device (`-controlport2device 37`); the default
  joystick device ignores it. An earlier version of this page said the
  windowless build's joyport commands never reach `$DC00`, and the game read
  its port byte from `$02FE` in a separate `make joy` build; both are gone.
- Monitor screenshots from the windowless build came back stale while the
  game ran, so `drive.py` reads screen RAM. Entering the text monitor during
  the start-up disk read left that read hung twice here; the binary monitor
  under warp did not.

## The measured frame

The harness meter (CIA2 timer A), over the autopilot's 240 play frames,
VICE x64sc 3.10:

| Model | Worst | Typical (median) | Frame |
|---|---|---|---|
| PAL | 13,643 | 6,518 | 19,656 |
| NTSC | 13,861 | 6,776 | 17,095 |

The worst frame is play frame 7, the slice where the 16 boulders fall and
overflow the dirty list (a debug build that kept the worst frame's index
found it). The cave decode between caves is not a play frame: 40,041 cycles
on PAL and 40,519 on NTSC for cave 2, screen on, CIA1 timer B, printed after
the verdict.

The same checks pass with the released Oscar64 v1.32.273 (make shot check,
modelcheck, selftest, selftest-scan and disktest on PAL, run 2026-09-23).
Its meter reads 13,412 / 6,392 cycles on PAL and 13,669 / 6,607 on NTSC
(measured on 3048ac1 by the other #39 session's comparator).

Against `plan-budget` (the PLAN.md output): it summed the recipe's whole
scan, 18,559 cycles, into every PAL play frame (range 19,599 to 19,807 plus
1,075 for badlines, "undetermined") and left it out of the NTSC frame as
multi-frame (1,040 to 1,248 plus 1,075). Neither is this program's frame:
the scan here runs a quarter at a time. The scan loop takes 17 cycles a
cell of dirt (counted from the generated code). The recipe's loop measured 18.7 (14,206 cycles
for 760 cells, with badlines in). So a slice of 190 cells costs about 3,230
cycles, plus the objects in it (arithmetic). The tool's
music figure is the recipe's stub tune; this tune and its effects are
measured only inside the whole frame.

## Extending it

1. **Scroll a bigger cave.** Draw cells as 2 x 2 characters and scroll a
   window over a cave larger than the screen: `tile_map_render` and the
   recipe `oscar64/tile-map-render` (metatiles), then a scroll technique
   from `technique-lookup` (`techniques-for --category scroll`).
2. **Add amoeba, a magic wall or more enemies.** Add codes in `cave.h`
   (at most 32: glyphs sit at `$40` + code), a branch in `cell()`, a glyph
   and a tint in `render.c`, the same colour in `tools/model_check.py`'s
   `TINT`, and the same rule in `tools/gen.py`'s `Cave.cell`. Extend the
   script and run `make gen shot check modelcheck`. The rules and the
   scanned bit are `cave_scan_engine` (recipe `oscar64/cave-scan`).
3. **Faster scans.** The scan loop is C; the recipe `oscar64/level-rle-decoder`
   shows a hand-written decoder a little under twice as fast as the C one,
   and the same move applies to `cave_scan_rows`. Measure before and after
   with the meter.

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
- A physical joystick: the release build was driven headless through VICE's
  simulated port 2 lines on `$DC00` (above), not a stick. An earlier
  version drove a build that read `$02FE` instead.
- Real hardware.
