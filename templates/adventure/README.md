# adventure: STARWATCH

A two-word text adventure for a stock C64, PAL and NTSC, in Oscar64 C.
Copy it to start a game of this kind:

```bash
npm run new-project -- adventure ~/c64/mygame     # in c64-kb
```

The player explores an astronomer's house on the night a comet passes:
twelve rooms, eight things to carry, four containers (chest, drawer, crate,
desk), a key fished out of a pond, a dark cellar and a lamp that needs
matches, and a clock that opens the tower hatch. The ending is scored out
of 100 with a rank. SAVE and LOAD write the game to drive 8. The room text
scrolls in a window under a strip of multicolour pictures; commands are
typed on the line below. Story, text, pictures and code are original.

Type commands on the keyboard: `GO NORTH` or `N`, `GET LAMP`, `OPEN CHEST`,
`LOOK`, `EXAMINE POND`, `INVENTORY`, `SCORE`, `SAVE`, `LOAD`, `QUIT`. Words
match on their first four letters, synonyms share a meaning (`PICK UP
LANTERN` is `GET LAMP`), and `THE`, `A`, `AT`, `IN` and the like are skipped,
so `PUT LENS IN TELESCOPE` works. A direction after a verb that is not GO
is skipped when a noun follows (`PICK UP LAMP`). A noun alone gets `WHAT DO
YOU WANT TO DO WITH IT?`, a verb that needs one alone gets `WHAT?`. RETURN
or fire on port 2 starts the game.

## Files

| File | What it holds |
|---|---|
| `tools/world.py` | The world: rooms, items, words, the action table, the engine's messages, the pictures, the autopilot script. Edit this |
| `tools/gen.py` | Packs the world into `src/gen_world.h` and `src/gen_script.h`; a Python model of the engine and printer plays the script and writes what the game must end with; asserts the limits the C code assumes |
| `src/main.c` | States (title, play, ending), the frame loop, the keyboard, the disk clock, the autopilot and its verdict |
| `src/engine.c`, `engine.h` | Game state, the two-word parser, the action table, the built-in verbs; output is a list of tokens (`adventure_database_engine`, `two_word_parser`) |
| `src/text.c`, `text.h` | The printer (tokens to word-wrapped lines, one a frame), the window scroll, the status bar, the input line (`text_input_line`, `decimal_print`) |
| `src/picture.c`, `picture.h` | The RAM character set and the picture strip (`mcm_text`, `charset_copy_rom_to_ram`) |
| `src/save.c`, `save.h` | SAVE and LOAD of the state record on drive 8, and what the drive answered (`kernal_file_write_seq`, `kernal_file_read_seq`, `error_channel_check`) |
| `src/sound.c`, `sound.h` | A key click, a chime when the score rises, a fanfare at the end (`sid_voice_setup`) |
| `tools/disk_check.py` | Makes the bad saves and grades `make disktest` against the model |
| `expect.json`, `PLAN.md` | The screenshot checks; the plan with the c64-kb tool output it was made from |

Memory: code and data from `$0880` up to the character set at `$3800`
(the release build ends at `$32F1`, the autopilot build at `$37F4`; more
spills to `$4000`), the character set `$3800`-`$3FFF` (`$D018` = `$1E`),
screen `$0400`. Rows 0-6 are the picture, row 7 the status bar, rows 8-21
the window, row 22 a rule, row 23 the input line (the disk clock in
AUTOPILOT builds at the end), row 24 the verdict and the meter.

## How it runs

One frame does one bounded job, chosen in this order:

1. the room's picture, when it changed (a room move, or the lamp lit);
2. one line of the window: scroll 13 rows up, then decode and word-wrap
   the next line into row 21;
3. the typed keys: every key in the KERNAL queue, echoed; on RETURN the
   parse and the turn, which only append tokens (message numbers, numbers,
   new lines) for the printer.

SAVE and LOAD run on a frame of their own, outside the meter, with the
sound muted. The KERNAL IRQ is off: CIA1's interrupts are masked, the loop
calls SCNKEY (`$FF9F`) itself, and takes keys out of the queue at `$0277`
as GETIN's LP2 does, without the `CLI` LP2 ends with (ROM bytes at `$E5B4`).
`$0291` = `$80` stops SHIFT + C= from switching the character set.

**The picture strip needs no raster split.** Multicolour mode is on for the
whole screen (`$D016` = `$18`); a cell whose colour RAM is 8-15 is
multicolour, one of 0-7 stays hires. The pictures use 8-15; all text uses
0-7. The shared colours: `$D021` black, `$D022` grey, `$D023` brown.

**Pictures are coded row by row, runs and literals.** A run of three or
more cells of one tile is two bytes; shorter stretches are a literal, one
byte a cell. The first version coded runs only, across rows: the library,
whose book rows are runs of one cell, took 20,240 cycles, over the frame on
both models. The first script never entered the library, so the meter never
saw it (found in review). Now `tools/gen.py` refuses a script that does not
show every picture, and the dearest picture, the garden, measured 12,483
cycles on PAL and 12,739 on NTSC (profile build).

**The typed command is in reverse video, not a colour.** The window's
colour RAM is fixed, so the scroll moves 520 screen bytes a line instead of
1,040. A build that scrolled colour RAM too had a worst frame of 22,000
cycles on PAL and 22,087 on NTSC, over both frames (meter, rung 1).

**The text is packed by byte pairs.** Messages hold screen codes `$01`-`$3F`;
each byte from `$40` stands for a pair of codes, found by `tools/gen.py`
(the commonest adjacent pair becomes a new code, 181 rounds). The printer
expands a code on a 16-byte stack. The plain text is not in the PRG.
`make gen` prints the figures (arithmetic on the generated bytes):

| Text (132 messages, 2,954 characters) | Bytes |
|---|---|
| C strings plus a 2-byte pointer each | 3,350 |
| Byte-pair packed: 1,370 stream + 362 pair table + 264 pointers | 1,996 (40.4 % smaller) |
| For comparison: 5-bit packing, three characters in two bytes | 2,326 |

The decoders cost code: `next_char` is 266 bytes (it also reads the other
tokens) and `put_msg` 136 (from the build's `.asm`). A dictionary of whole
words, tried first, saved 18 %. The pictures: 13 of 280 cells, 7,280 bytes
as screen and colour, 793 coded.

**The save record** is 45 bytes: `S W`, the world's version (two bytes),
room, score, turns, flags, every item's place and open state, and a fold.
The version is a hash of the rooms, items and flags that `tools/gen.py`
writes into `gen_world.h`, so a save made by a build with another world is
refused (`THE SAVE IS FROM ANOTHER VERSION`), not loaded into the wrong
rooms. A record of the wrong size or fold, or one naming a room or place
this world does not have, is refused as damaged. Errors print the drive's
own words: `DISK ERROR: 74,DRIVE NOT READY.`; with no drive on the bus,
`NO DRIVE ANSWERS AS DEVICE 8.`

**The disk clock** times each SAVE and LOAD on CIA2 timers A and B chained
(A counts cycles, B counts A's underflows). Timer A is the frame meter's,
so the clock puts back its latch (`$FFFF`) and reads `$DD0D` to clear the
underflow flag; without that read the meter's next frame reads 65,524
cycles (a mutant did). The autopilot shows the counts on row 23 and its
verdict wants each between 0.1 and 30 million. Measured on the shot's
true-drive 1541 (VICE, rung 1):

| Model | SAVE (scratch, write, reply) | LOAD (read, reply) |
|---|---|---|
| PAL | 4,463,001 cycles | 515,221 cycles |
| NTSC | 4,636,828 cycles | 562,405 cycles |

## Checks

| Command | What it proves |
|---|---|
| `make shot check` | The autopilot game on PAL and NTSC, with SAVE and LOAD on a true-drive 1541: 41 checks (verdict, fold, status bar, window lines, reverse video, picture cells in all three multicolour sources, the disk clock's labels, PAL = NTSC, the meter) |
| `make selftest` | The FORCE_FAULT build (39 points, not 40, for the comet) fails: red border, 99 in the status bar and the ending |
| `make disktest` | SAVE, a cold reset, LOAD and the same state back; three bad saves refused; a drive with no disk (below) |
| `make claims` | Every store the autopilot run makes is one the Makefile declares |
| `make zp` | The zero page Oscar64's code touches, inside `ZP_CLAIM` |

The autopilot types 45 commands into the keyboard queue, up to ten bytes a
frame (the queue's size), the same bytes SCNKEY puts there for a real key.
It tries an unknown word, `PICK UP LANTERN`, a noun alone (`POND`), fishes
out the key, finds the door locked, unlocks it, SAVEs in the hall, makes a
mistake (drops the lamp), LOADs, looks into the library, and plays on to the
comet: 100 points in 37 turns. `tools/gen.py` plays the same script through
its model and writes the room, score, turns, flags, a fold of every item's
place, a fold of every printed line, the line count, the metered frames and
the drive's replies. The program compares, then sets `$02FF` and the
border. The shot shows the text fold (`FAB8`) beside the verdict.

These mutants were each caught (2026-09-23): the parser's direction skip
and the bare-noun reply removed (verdict red); the disk clock's `$DD0D` read
removed (meter worst 65,524); timer B not chained (verdict red); LOAD's range
check or version check removed, or the error line cut to the code (disk test
fails on the bad save or the no-disk run); the library dropped from the
script (`gen.py` stops).

**The shot pin.** 18,000,000 cycles on both models. The verdict is on
screen between 13,000,000 and 14,000,000 on PAL and between 14,000,000 and
16,000,000 on NTSC; shots at 16,000,000, 18,000,000 and 24,000,000 were
byte-identical on each model, across separate runs (VICE x64sc 3.10,
windowless). Most of the time goes to the drive. Each run gets a fresh copy
of the release D64 (the harness's `SHOT_DISK = 1`).

**The disk test.** `make disktest` (`DISK_MODEL=ntsc` for NTSC), on a
true-drive 1541:

1. `DISKTEST=1` plays the script up to its SAVE on a fresh copy of the
   release D64 and grades itself (state and the drive's `00`);
2. c1541 reads SAVEGAME back: its 45 bytes equal the record the model
   makes, byte for byte, and the directory has one entry;
3. a new VICE, a cold start, runs `DISKTEST=2`: it types LOAD first, then
   the rest of the script, which reaches the ending only from the saved
   state; its own verdict is green;
4. a new VICE boots the release PRG from the D64 (`LOAD"*",8,1`) and types
   RETURN, LOAD, SCORE and I with `-keybuf`: every window line and the status
   bar match the model (the hall, 20 points, turn 16);
5. the release PRG LOADs three bad saves made from the good one by
   `tools/disk_check.py --make-bad`: one byte changed (the fold catches it),
   room 200 with the fold fixed up (only the range check catches it), and
   another world's version with the fold fixed up. Each is refused and the
   game stays at the start;
6. the release PRG types SAVE to a drive with no disk: `DISK ERROR: 74,DRIVE
   NOT READY.`

Run on 2026-09-23: PASS on PAL and NTSC. Without `-keybuf-delay` the keys of
step 4 arrived before the program ran and were lost; 2,500 held them past
the load. A real world change was also tried by hand: a flag added to
`world.py` moved the version from `$6A2B` to `$2811`, and that build
refused the save the disk test made with `THE SAVE IS FROM ANOTHER VERSION
(00).`

## Driving it headless

`make drive` plays the release build through `harness/drive.py`, over
VICE's binary monitor. It types through the monitor's keyboard feed, which
writes the KERNAL queue, presses fire on the real `$DC00`, counts time in
emulated frames (a run repeats exactly), and reads screen RAM as text:

```bash
make drive STEPS='"until:PRESS RETURN OR FIRE" key:RETURN "until:EXITS: N." \
    "type:GO NORTH" "until:A SHED" "type:TAKE THE ROSE" "type:QUIT" \
    "until:PLAY AGAIN" print'
```

That run (2026-09-23, again 2026-09-24 through the harness) reached the
garden, answered `I DON'T KNOW THE WORD ROSE.` without a turn, and ended
the game. `tap:fire` steps showed title to game, `QUIT`, and ending back
to the title; `make drivetest` (a proof target) starts the game with fire.
An earlier version pressed fire in a separate `make joy` build that read
the port byte from `$02FE`, because VICE's joyport command seemed not to
reach `$DC00`; it does, once control port 2 holds the "Joyport I/O
simulation" device, which `drive.py` selects.
The first version tested fire by level: fire at the ending went to the
title and, still held, started a new game; it now acts on a new press.

## The measured frame

The harness meter (CIA2 timer A) over all 251 play frames of the script,
VICE x64sc 3.10:

| Model | Worst | Typical (median) | Frame |
|---|---|---|---|
| PAL | 15,272 | 8,543 | 19,656 |
| NTSC | 15,488 | 8,842 | 17,095 |

The worst is a window line, the score line of the ending: the scroll
(5,390 cycles, measured earlier on its own) plus decoding and wrapping the
line. A profile build that kept the worst of each job put the line at
15,232 on PAL (15,449 NTSC), a turn frame at 11,262 (11,518) and a picture
at 12,483 (12,739, the garden). Turns stop at 999, the status bar's three
digits, which also bounds the score line's number printing; a build started
at turn 996 showed 999 after five SCOREs.

The meter records at most 255 frames; this script uses 251. `make gen`
warns when a script passes 255: the frames after that are not metered and
check's frame count will not match.

Against `plan-budget` (the PLAN.md output): it summed the recipe's parse
and turn (14,908, with the recipe's printing inside) and a separate parse
(2,036) into every play frame, 19,004 + 1,075 for badlines, "undetermined",
and had no figure for `mcm_text`, `frame_sync_loop` or `sid_voice_setup`.
This program's worst frame is 15,272, and no frame holds a whole command:
the recipe printed a command's output in one go (its PRINT figure, 109,866
cycles), here it is one line a frame. The tool's budget cannot model that
split; the meter settles it.

## Extending it

1. **More world.** Add rooms, items, words and action rows in
   `tools/world.py`, extend `SCRIPT` (it must show every picture), run `make
   gen shot check`, and copy the new fold, turns, frame count and texts into
   `expect.json`. The script has 4 frames left under the meter's 255: for a
   bigger game, meter a shorter script that still shows every picture and
   the longest reply, and test the rest through `make disktest`'s split or
   `make drive`. Every turn scans the whole action table for
   occurrences, so a large table's turn frame must be metered again. Timed
   events (a lamp that burns down) are occurrences with a counter: technique
   `adventure_database_engine`, recipe `oscar64/adventure-engine`.
2. **A bigger game than memory.** Keep rooms' text on disk and load a
   block per region: `kernal_load_to_address`, or one file with an offset
   table, `iffl_single_file`; or move the tables under the KERNAL,
   `ram_under_kernal`.
3. **Livelier pictures.** Animate glyphs (twinkling stars, the pond) by
   rewriting their bytes in the RAM set: `charset_animation`, recipe
   `oscar64/charset-animation`. A saved game as a code instead of a file:
   `password_encoding`, recipe `oscar64/password-state`.

## Left out on purpose

- Music: text adventures of the period mostly had none. The three sounds
  are not checked by anything here: a build that never gates a note on
  passed every check (found in review). Listen with `make run`.
- A `MORE` prompt: a reply longer than the 14-line window scrolls past.
- Three-word commands with two nouns (`PUT LENS IN TELESCOPE` reads as
  `PUT LENS`), pronouns and `ALL`.
- Words longer than the 40-column line: `tools/gen.py` refuses them in the
  world's text; typed words are cut at 36 characters by the input line.
- SAVE scratches the old file before writing the new one, so a write that
  fails after the scratch loses the old save. Writing a temporary file and
  renaming it would not; not done.
- The disk calls run on a static screen; the frame they take is not
  metered, and the sound is muted during them.
- Real hardware, and the released Oscar64 (built with the build c64-kb's
  CLAUDE.md names).
