# racing: a pseudo-3D road racer starter

A small race that plays: two laps of a 64-segment circuit against three
cars. The road recedes to a horizon, bends left and right and goes over
crests; it is drawn in multicolour characters with a raster split on every
road line: $D016 moves each line for the bend, $D021 gives each line its
grass band, or the sky above a horizon that the hills move up and down.
The opponents are sprites at six sizes, chosen by their distance. The
player steers, accelerates and brakes; the grass slows the car; running
into a car costs speed and pushes both apart. A lap clock, the laps, the
position and the speed on a panel under the road; an engine note, start
beeps and a bump on the SID. Title, three lights, the race, the finish,
back to the title. PAL and NTSC, Oscar64 C with a KickAssembler engine.

Start a game from it in c64-kb:
`npm run new-project -- racing ~/c64/mygame`.

## Playing

Joystick in port 2. Fire or up accelerates, down brakes, left and right
steer (steering needs speed). A bend pushes the car outwards; the grass
beyond the kerbs limits the speed to 4 units a frame. Two laps; the panel
shows the lap clock, the position (1-4) and each finished lap's time.

## Files

| File | Holds |
|---|---|
| `src/main.c` | The frame loop (one game step a tick, the next picture built between), the states, the meter |
| `src/game.h` | Every shared constant, variable and function |
| `src/cars.c` | The player's car (throttle, brake, steering, the grass, a bend's push), the opponents, contact, laps, the clock |
| `src/road.c` | The view: camera, horizon, the road's centre, the three sprites' lines, sizes and X; a picture a piece at a time |
| `src/art.c` | The road characters, the hills, the car at six sizes from one picture, the ROM font copy |
| `src/hud.c`, `src/sound.c` | The panel (the clock digit by digit); the engine note, beeps and the bump |
| `src/engine.asm` | KickAssembler: the IRQ chain (251, 103, 105, the road, the split at 203), the road's code (two copies of 96 blocks), PAL/NTSC detection |
| `src/builder.asm` | KickAssembler: the builder, per-line $D016, $D021 and pads into the copy not shown, the road's characters into the screen not shown |
| `src/track.asm` | The circuit: a curvature and a hill per segment |
| `src/autopilot.h`, `src/verdict.h` | AUTOPILOT builds only: the driver bot, the self-checks, the still the shots are pinned on |
| `tools/roadcheck.py` | Draws every road line from the machine's own splits and matches the shots (`make roadcheck`) |
| `expect.json`, `PLAN.md` | The screenshot checks; the plan with the c64-kb tool output |

## How a frame runs

irq_blank at line 251 starts the frame: it counts the tick, takes a
finished picture (the other road copy, the other screen, the other sprite
set) and sets the top of the screen (the sky, the road screen's $D018).
irq_top at line 103 arms line 105 and waits in NOPs; the IRQ at 105 lands
on a NOP, so it is 0 or 1 cycle late, and two $D012 reads straddling the
change to line 106 take that cycle out (c64-kb double_irq). The sync then
jumps into the road copy on display, whose first block starts on cycle 2
of line 107 and checks that the IRQ came on line 105. Cycles here are
Bauer's, 1 to 63 (c64-kb `docs/runtime/vice-reference.md`, "What the CYC
column counts"); an earlier version counted the block's first cycle as
cycle 1 and gave the block's stores one cycle lower.

Each road line 107-202 is one 64-byte block. A normal line's block stores
$D016 (written on cycle 7) and $D021 (cycle 13), then branches into a slide
of `CMP #$C9` bytes (`C9 C9 ... C5 EA`): entered R bytes from its end it
takes R + 1 cycles, so a patched branch operand pads the line to exactly 63
cycles (65 on NTSC). A badline's block stores $D016 only: the VIC holds the
bus from cycle 12 to 54, and that line shows the colour of the line above.
Line 203's block sets the panel's $D018 (cycle 7) and $D016. Line 203 is
a badline and the `STA $D016` reads on cycle 12, so the write waits for
the stall and lands on cycle 56 (VICE store trace, both models; an
earlier version said cycle 12). $D021 follows after the VIC's fetch,
over row 19's solid characters.

The main loop runs one game step when the tick moves (input, cars, the
panel, sound) and in the time between builds the next picture, a piece at
a time: its start (the camera, the horizon, the sprites' lines, `rb_begin`),
one row (twelve of them, bottom up), its end (the sprites' X, `rb_ready`).
A picture takes 3.5 frames on PAL and 4.9 on NTSC (measured below);
the game, the clock and the physics step every frame.

## The road with sprites on it

c64-kb's pseudo-3d-road recipe draws its road with the sprites off: a
sprite's fetches take cycles from the lines it is on, and the recipe's
unrolled loop counts every cycle. Here sprites 0-2 stand on the road lines.
They fetch at a line's end (their pointer slots are cycles 58, 60, 62 on
PAL), so a line's stores at its start are not touched, but the line's
length is: the VIC holds the CPU from three cycles before the first of
them to two after the last, 5 + 2 x (last - first) cycles (c64-kb
docs/hardware/vic-ii-reference.md, Sprite DMA; recipes/kickassembler/dysp.md
works the same arithmetic for the side border). The builder knows each
sprite's Y (it fetches on lines Y to Y + 20) and pads each line by what its
sprites take: 16 pad values, by the set of sprites and by badline or not
(`rb_init`). Sprites 3-7 fetch at a line's start, over the stores: they
stay off. A sprite is never switched off after its picture is built (its
lines' pads assume it fetches); a car off the side of the road is moved
behind the left border instead. The method alone, with a probe store
that shows each line's cycle in the picture, is c64-kb's
`recipes/kickassembler/road-sprite-lines.md`.

## The road's timing

Measured with the PROBE build (`make build/racing-probe.prg`, KickAssembler
`-define PROBE`): every normal block stores a yellow $D021 on cycle 19, and
VICE x64sc 3.10 shows it from screenshot x 49 (a grey dot on x 48 on PAL, the
8565's). Shots at eight cycle counts a model, the race running and three
sprites moving:

| Constant | PAL | NTSC | What it is |
|---|---|---|---|
| `SYNC_P`, `SYNC_N` | 40 | 42 | cycles before the two $D012 reads |
| `ENTRY_P`, `ENTRY_N` | 58 | 60 | cycles from the reads to the first block |
| `BADLOSS` | 43 | 43 | cycles a badline takes from a block that reads on cycle 12 |

With these, all 84 normal road lines put the probe on x 49 in 8 of 8 shots
on each model. One more or one less cycle of `SYNC_*` left a one-cycle
jitter between frames; `ENTRY_N` one cycle late broke the lines after
line 187 on NTSC. A first version tested V with `BVC` after a `Delay` that
ends in `BIT $EA`, which sets V from memory: blocks then fell through their
slides at random. `CLV` before the jump fixed it.

## The measured frame

The harness meter (CIA2 timer A) over 255 race frames from race frame 200,
`make shot check`, VICE x64sc 3.10, the local Oscar64. A frame's figure is
the game step's bracket plus every IRQ from its start to the next step
(irq_blank and the road chain): the work the frame must do. The builder
uses what is left and is measured apart.

| | PAL (19,656 a frame) | NTSC (17,095 a frame) |
|---|---|---|
| Worst / typical step + IRQs | 10,358 / 8,816 | 10,750 / 9,049 |
| Pictures in the race's 3,515 frames | 1,000: one every 3.5 frames | 712: one every 4.9 frames |
| Costliest builder piece: a row / a full row / a picture's start / end | 3,293 / 2,892 / 3,706 / 1,674 | 3,388 / 2,866 / - / - |

The race is the 3,515 game steps from GO! to the line (`race_frames` at the
grade, 3,615, less the 100 steps coasting after it); `pictures` counts only
those. An earlier version divided by 3,615 and said 3.6 and 5.1. Read from
the machine after the grade (VICE binary monitor), both models.

The pieces were timed with CIA1 timer A and interrupts off (`-define
ROWTIME` for rows; the start and end in a debug build); a row with sprites
on it, or with kerbs that moved far, is the costly one. The road chain
itself is 96 lines of its IRQ, about 6,300 cycles on PAL and 6,500 on NTSC
(arithmetic: lines 103-202 at 63 or 65 cycles, not measured).

Lost frames: none. `late` counts steps that ran past the next line 251 and
ticks that passed with no step; the chain counts road chains that armed
line 105 too late (the IRQ then comes a frame later and irq_blank's tick is
skipped, so `late` cannot see it), IRQs that did not arrive on line 105,
and panel splits off line 203-204 (`road_late`). Both are 0 over the whole
run on both models and the verdict wants 0. Mutant 7 (one step that waits
for the next tick) makes `late` 1. A test build that armed line 105 too
late every 128th frame graded itself PASS before irq_top checked the line
it armed on; with the check, `road_late` counted 30 on both models and the
verdict failed. The
AUTOPILOT build's bookkeeping covered 12 frames on PAL and 18 on NTSC
(`slow`; the meter's median when its recording ends is 7 of them, the rest
is the grade and the still, which build whole pictures at once); those are
not play.

Against `plan-budget` (PLAN.md): undetermined, 23,409-38,975 + 1,264 on
PAL. Its 17,975 for pseudo_3d_road_raster is the recipe's whole frame in
one; here the road's per-frame share is the chain, and the rest is the
builder, which is not per frame. Its car_contact_response (17,549) is 28
pairs; here three, inside the cars' step.

## Proving it

| Command | What it proves | Last result |
|---|---|---|
| `make shot check` | 27 checks a model: the verdict, the panel's text and lap times, the still's horizon (line 124 sky, 125 grass: the hill), the kerbs on lines 140-200 and line by line inside rows (the bend and XSCROLL), the three cars' boxes (sizes by distance), the road and the sky identical on PAL and NTSC, the meter | 54 of 54 passed |
| `make selftest` | FORCE_FAULT records lap 1 a frame long: the verdict fails | check.py rejected the build |
| `make roadcheck` | Reads the road copy on display, the screen, colour RAM, the characters, the VIC-II and the sprites out of the machine, draws lines 107-202 from them, and matches the shots pixel for pixel | 96 of 96 lines on PAL and NTSC, 30 XSCROLL changes inside rows |
| `make mutants` | Seven faults, each caught: 1 pads that ignore the sprites (roadcheck: 59 of 96 lines wrong on PAL, 52 on NTSC; the kerbs), 2 no curve (the verdict's bend; the kerbs), 3 no hill (the verdict; the horizon), 4 one car size (the verdict; car 2's box), 5 the clock counting every other frame (the verdict; the lap times), 6 no contact (the verdict), 7 one step past the next tick (the verdict's lost-frame bit) | 7 of 7 caught |
| `make drivetest` | The normal build, the stick on `$DC00` (harness/drive.py): fire on the title starts the lights, fire held after GO! reaches SPEED 480 | drivetest: PASS |
| `make claims` | Every store the run makes, title to verdict, against CLAIMS_ARGS | 0 violations (an earlier version left out vic_xscroll, vic_matrix_base and vic_char_base, units added to claims-watch before this starter landed: 3 violation groups) |
| `make released OSCAR64_RELEASED=<v1.32.273>` | The same 27 checks a model on a build from the released compiler | 54 of 54 passed |

`npm run verify:templates -- --only racing --selftest` runs `make`, `make
shot check`, `make disk`, `make selftest` and `VERIFY_TARGETS` (roadcheck,
mutants, drivetest).

The verdict (`src/verdict.h`) grades the game's own state after the finish:
two laps and a place; each lap's frames against the bot's own count; the
panel's lap times against that count; contact, the verge, an overtake; no
lost frame and no late road chain; the horizon's range over the race (at
least 10 lines); the bend's range (the farthest road row's centre less a
straight road's, at least 60 pixels: 306 on this run); four of the six car
sizes drawn; the VIC-II's sprite registers equal to the set shown; the
meter's 255 frames. Then the still: the camera 64 units into the left kink
over the crest (segments 50-53), car 1 16 units ahead, car 2 120, the
player 20 pixels right of the centre line. Its picture comes from the real
projection and builder, and is the same on both models.

Driving the normal build headless (the harness's drive.py, the stick on
the real `$DC00`; the panel is `DRIVE_SCREEN`, C800 rows 19-24):

```bash
make drive STEPS='"until:PRESS FIRE" tap:fire "until:GO!" hold:fire+left run:4 print'
```

## Which Oscar64

Built and checked with the build named in c64-kb's CLAUDE.md, and with the
released v1.32.273: `make shot check` 54 of 54 on both. One fault shapes
the code: in `hud_draw`, the local build compiled `frames / (fps / 10)` as
`frames / frames` (its divmod proxy copied ACCU into the divisor after the
dividend had been loaded into ACCU; `build/racing-auto.asm`), and the clock
read 0:00.1 for a whole lap. A four-line program with the same expression
divided correctly on both compilers, so the fault needs that function's
surroundings. Reproduced in review with the expression put back into
hud_draw: the local build loads `lap_frames` into ACCU over `fps / 10` and
then copies ACCU to the divisor; v1.32.273 and upstream 9a902f6 keep the
quotient in X and divide correctly. The fault is in the local build only. The frames per tenth are a variable (`fpt`), and the lap
clock counts digit by digit.

## Left out on purpose

- Two opponent sprites at a time: the nearest two in view. A third on the
  road lines would need sprites 1 and 2 reused down the road, their Y and
  X rewritten inside the road's blocks.
- The cars do not overtake or avoid each other; only the player touches
  them.
- No Y expansion: an expanded sprite's fetches would need the pads worked
  out again.
- The road's width steps by character rows (2-pixel kerb positions); the
  bend is per line. Near the horizon a bend that moves 8 or more pixels
  within a row is clamped to XSCROLL 7.
- The horizon's row has no road characters: the road starts at the first
  row wholly below the horizon.
- NTSC runs the same step at 60 Hz: the race is 6/5 as fast (c64-kb
  pal_ntsc_tempo_mismatch); the clock counts real tenths on both.

## Next steps

1. More pictures a second: the builder's costliest parts are the row
   drawing (`span`, `draw_row`) and the C picture start and end; a third
   road copy would let the builder start the next picture before the last
   is shown.
2. Reuse sprites 1 and 2 down the road for more opponents (their writes in
   the road's blocks, padded like the rest).
3. A track editor: `src/track.asm` is two numbers a segment.
