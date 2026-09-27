# racing: a pseudo-3D road racer starter

A small race that plays: two laps of a 64-segment circuit against three
cars. The road recedes to a horizon, bends left and right and goes over
crests, and its edges move on every raster line: it is drawn in
multicolour characters whose slanted edge glyphs are computed when the
program is assembled, with a raster split on every road line for the bend
($D016) and for the grass, road and rumble-strip bands ($D021, $D022,
$D023), which alternate by segment and move every frame. The opponents
are sprites at six sizes, chosen by their distance. The player steers,
accelerates and brakes; the grass slows the car; running into a car costs
speed and pushes both apart. A lap clock, the laps, the position and the
speed on a panel under the road; an engine note, start beeps and a bump on
the SID. Title, three lights, the race, the finish, back to the title. PAL
and NTSC, Oscar64 C with a KickAssembler engine.

This is step 1 of c64-kb issue #110 (the road). Speed, challenge and
polish are the steps after it.

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
| `src/art.c` | The hills, the car at six sizes from one picture, the ROM font copy |
| `src/hud.c`, `src/sound.c` | The panel (the clock digit by digit); the engine note, beeps and the bump |
| `src/engine.asm` | KickAssembler: the IRQ chain (251, 101, 105, the road, the split at 203), the road's code (two copies of 96 blocks), the picture swap, PAL/NTSC detection |
| `src/glyphs.asm` | KickAssembler: the road's glyphs and row templates, computed at assembly from the projection; `glyph_init` fills the character sets |
| `src/builder.asm` | KickAssembler: the builder, in pieces: per-line $D016 and pads into the copy not shown, row templates into the screen not shown, glyphs for sheared rows |
| `src/track.asm` | The circuit: a curvature and a hill per segment |
| `src/autopilot.h`, `src/verdict.h` | AUTOPILOT builds only: the driver bot, the self-checks, the still the shots are pinned on |
| `tools/roadcheck.py` | Draws every road line from the machine's own tables, sets and registers and matches the shots (`make roadcheck`) |
| `expect.json`, `PLAN.md` | The screenshot checks; the plan with the c64-kb tool output |

## How a frame runs

irq_blank at line 251 starts the frame: it counts the tick, takes a
finished picture if one waits (the other road copy, screen, sprite set
and tables) and sets the top of the screen (the sky, the road screen's
$D018, the first road lines' bands). irq_top at line 101 arms line 105 and
waits in NOPs; the IRQ at 105 lands on a NOP, so it is 0 or 1 cycle late,
and two $D012 reads straddling the change to line 106 take that cycle out
(c64-kb double_irq). The sync then jumps into the shown copy's entry
block, which loads the first line's values and enters line 107's block on
cycle 2. Cycles here are Bauer's, 1 to 63 (c64-kb
`docs/runtime/vice-reference.md`, "What the CYC column counts").

irq_top used to be on line 103. From entry to its CLI is about 107 cycles
(arithmetic from the listing), which put the CLI 19 cycles before line
105's interrupt; a 29-cycle interrupt-off window in the main loop's poll
was enough to make the sync a line late, about 50 times a race (measured,
`road_late`). On 101 the margin is about 80 cycles and the poll runs with
interrupts on.

Each road line 107-202 is one 64-byte block, of four kinds by its place in
the character row (`engine.asm`, block layout). A normal line's block
stores $D016 (written on cycle 5), $D021 (9) and $D022 on even lines or
$D023 on odd (13), then loads the next line's three values: its $D016 from
the copy's table, its grass and its road band or kerb from the copy's z
table plus the camera's position through three colour tables. A badline's
block stores the row's character set in $D018 (cycle 5) and $D016 (9),
nothing else: the VIC holds the bus from cycle 12, and sprites can take 9
more. The row's second line stores $D021 and $D016 only. Every block ends
in a slide of `CMP #$C9` bytes entered by a patched `BNE`, so its line is
exactly 63 cycles (65 on NTSC) less what its sprites take. Line 203's
block sets the panel's $D018 (cycle 7) and $D016 (cycle 11, `STX`, X
loaded by line 202's block; #86).

The main loop runs one game step when the tick moves (input, cars, the
panel, sound) and in the time between builds the next picture, a piece at
a time: its start (the camera, the horizon, the sprites' lines), the
builder's start (`rb_begin`), then per row from the bottom up: the row's
geometry, $D016 bytes and pads; the template decoded; the screen row
copied; for a sheared row, its slots and four glyphs a piece. A piece is
under 4,300 cycles (measured below), so a step is never held past its
tick. A finished picture is taken by the main loop as soon as the beam is
clear of the road (lines 204-311 and 0-93), or by the chain at 204 or 251.

## The road

The width comes from static glyphs. With the road's centre held on a
4-pixel boundary, a row's characters depend only on the road's half-width
on its eight lines, w = W0 · d / D, and that depends only on the line and
the horizon offset. `glyphs.asm` computes every glyph for the 12 even
horizon offsets (the horizon moves two lines at a time), 12 rows and both
phases: 321 left glyphs in three character sets of 100, 115 and 106 (rows
0-3, 4-6, 7-11), their mirrors at id + $80, and 1,860 bytes of row
templates (the assembler's own count). A Python model before any code
gave the counts; a 1-line horizon step needs five sets.

The bend is per line: each line's shift from the row's content centre
goes to $D016 (its low three bits) and, when 8 or more, into whole-column
moves. A row with such a line is sheared and gets glyphs built at run
time from its static ones (line l of a column is line l of the glyph m(l)
columns to its left), in one of two dynamic sets ($F000 for copy A, $F800
for B), twenty slots a row, cached by template and shear. The camera
leans half as far as one fixed on the centre line: full lean sheared
every row by up to 10 pixels with the car off-centre.

The screen is 38 columns wide (CSEL 0), sky, road and panel alike. In 40
columns the first 0-7 pixels of a line shifted by XSCROLL show the
background colour, which was invisible while the road stayed inside the
window and a green sawtooth over the road and kerb once a tight bend
brought them to the screen's edge (the maintainer saw it at top speed on
the first play, 2026-09-26). The 38-column border hides those pixels on
both sides; the panel's text keeps to columns 1-37.

The curvature is eased: `track.asm` holds one value a segment, and
`curvf` samples it four times a segment as a straight line from one
segment's value at its middle to the next's, at half the table's scale.
Before this a bend switched on at a segment boundary and showed as a kink
walking down the road, and 3 was a hairpin that left the screen's side
within 40 lines (the maintainer, first play: "bends like choppy, too
sharp"). The car's push in a bend reads the same eased value.

The bands are the kernel's: each line's grass, road band and kerb stripe
come from z × 8 plus the camera's position (a zero-page byte the game
writes every frame), so they move at the frame rate whatever the picture
rate. Grass green and light green by bit 7; road dark grey and grey by
bit 7; kerb red and white by bit 6.

## The road with sprites on it

Sprites 0-2 stand on the road lines. They fetch at a line's end, so a
line's stores at its start are not touched, but the line's length is: the
VIC holds the CPU for 5 + 2 x (last - first) cycles for the sprites on the
line (c64-kb docs/hardware/vic-ii-reference.md, Sprite DMA). The builder
keeps each line's set of sprites (`lmask`) and writes a line's pad only
when its set changed in that copy. A sprite is never switched off after
its picture is built; a car off the side of the road is moved behind the
left border instead. Sprites 3-7 fetch at a line's start, over the stores:
they stay off.

A block must end in a read: with sprite 2 on the line, its DMA ends one
cycle before the next block, and a block that ended in a write (an earlier
version stored $D018 after the slide) came out a cycle short there (PROBE
build, VICE x64sc). The blocks branch into their slides on `BNE`: an
earlier version used `BVC`, and the colour lookup's `ADC` set V whenever
its sum overflowed as a signed byte, so the branch fell through into the
whole slide.

## The road's timing

Measured with the PROBE build (`make build/racing-probe.prg`, KickAssembler
`-define PROBE`): every normal block stores a yellow $D021 on cycle 19,
and VICE x64sc 3.10 shows it from screenshot x 49. Shots at eight cycle
counts on PAL (12, 16, 24, 28, 36, 44, 52 and 60 million) and six on NTSC
(12, 20, 30, 40, 50, 60 million), the race running and three sprites
moving: every visible normal line puts the probe's edge on x 49 on both
models (a line the road or a sprite covers at x 48-49 is not visible to
the check; 18 to 84 lines were, per shot).

| Constant | PAL | NTSC | What it is |
|---|---|---|---|
| `SYNC_P`, `SYNC_N` | 40 | 42 | cycles before the two $D012 reads |
| `ENTRY_P`, `ENTRY_N` | 58 | 60 | cycles from the reads to the copy's entry block |
| `PRE_CYC` | 24 | 24 | the entry block's cycles before line 107's block |
| `BADLOSS` | 43 | 43 | cycles a badline takes from a block that reads on cycle 12 |

`SYNC_*`, `ENTRY_*` and `BADLOSS` are the values measured for the earlier
road (its README); `PRE_CYC` is arithmetic from the entry block's listing
and the probe confirms the sum.

## The measured frame

The harness meter (CIA2 timer A) over 255 race frames from race frame 200,
`make shot check`, VICE x64sc 3.10, the local Oscar64. A frame's figure is
the game step's bracket plus every IRQ from its start to the next step
(irq_blank and the road chain): the work the frame must do. The builder
uses what is left and is measured apart.

| | PAL (19,656 a frame) | NTSC (17,095 a frame) |
|---|---|---|
| Worst / typical step + IRQs | 10,430 / 8,969 | 10,725 / 9,197 |
| Pictures in the race's 3,615 steps | 1,158: one every 3.04 frames | 699: one every 5.03 frames |
| Lost steps (`late`), late road chains (`road_late`) | 0, 0 | 0, 0 |

The old stepped road built a picture every 3.5 PAL frames; the
work-in-progress branch's per-picture glyph drawing every 9.2.

The builder's pieces, own time with no IRQ inside (a `-dPIECETIME=1`
build: CIA1 timer B around each piece, pieces whose start and end lie
between lines 204 and 101 in order; PAL, worst over the race): the picture
start 4,278 cycles, `rb_begin` 3,864, a row's start 2,043, its template
decode 1,610, its copy 1,093, a sheared row's slots 4,125 and its glyphs
1,972 a piece, the picture's end 3,261. Wall time with the chain inside
is about 6,500 cycles more.

Against `plan-budget` (PLAN.md): undetermined, 44,006-60,027 + 1,075 on
PAL. Its figures are other programs' recipes summed; the frame above is
this program measured whole.

## Proving it

| Command | What it proves | Last result |
|---|---|---|
| `make shot check` | 34 checks a model: the verdict, the panel's text and lap times, the still's horizon (line 124 sky, the road's first line on 125), the rumble strips' white and red bands, the road and grass bands, the left edge line by line inside rows (163-178), the three cars' boxes (sizes by distance), the road and the sky identical on PAL and NTSC, the meter | 68 of 68 passed |
| `make selftest` | FORCE_FAULT records lap 1 a frame long: the verdict fails | check.py rejected the build |
| `make roadcheck` | Reads the shown copy's $D016 and z tables, each row's $D018, the camera's position, the colour tables, the screen, colour RAM, the character sets under I/O and the KERNAL, the VIC-II and the sprites out of the machine, draws lines 107-202 from them in 38 columns, and matches the shots pixel for pixel | 96 of 96 lines on PAL and NTSC, 58 XSCROLL changes, 3 character sets in the still, largest left-edge step 2 px |
| `make mutants` | Seven faults, each caught: 1 pads that ignore the sprites (roadcheck: 64 of 96 lines wrong on PAL, 63 on NTSC), 2 no curve, 3 no hill, 4 one car size, 5 the clock counting every other frame, 6 no contact, 7 one step past the next tick | 7 of 7 caught |
| `make drivetest` | The normal build, the stick on `$DC00` (harness/drive.py): fire on the title starts the lights, fire held after GO! reaches SPEED 480 | drivetest: PASS |
| `make claims` | Every store the run makes, title to verdict, against CLAIMS_ARGS (the road's character sets under I/O are declared ranges) | 0 violations |
| `make watch` | Every frame's work ends before the deadline; the SID is written in at least 2,000 frames | PASS |

`npm run verify:templates -- --only racing --selftest` runs `make`, `make
shot check`, `make disk`, `make selftest` and `VERIFY_TARGETS` (roadcheck,
mutants, drivetest).

The verdict (`src/verdict.h`) grades the game's own state after the finish:
two laps and a place; each lap's frames against the bot's own count; the
panel's lap times against that count; contact, the verge, an overtake; no
lost frame and no late road chain; the horizon's range over the race (at
least 10 lines); the bend's range (the farthest road row's centre less a
straight road's, at least 60 pixels); four of the six car sizes drawn; the
VIC-II's sprite registers equal to the set shown; the meter's 255 frames.
Then the still: the camera 64 units into the left kink over the crest
(segments 50-53), car 1 16 units ahead, car 2 120, the player 20 pixels
right of the centre line. Its picture comes from the real projection and
builder, and is the same on both models.

Driving the normal build headless (the harness's drive.py, the stick on
the real `$DC00`; the panel is `DRIVE_SCREEN`, C800 rows 19-24):

```bash
make drive STEPS='"until:PRESS FIRE" tap:fire "until:GO!" hold:fire+left run:4 print'
```

## Memory

The KickAssembler blob runs from $0880 to $870A (its two road copies, the
builder, the glyph and template data, the tables); the C program starts
on the page after it and ends below $C000 with Oscar64's 4 KB stack and
no heap. VIC bank 3: road screens $C000 and $C400, the panel's screen
$C800, sprites $CC00, road character sets $D000, $D800 and $E000 (the
first two under I/O, written with $01 = $34 and interrupts off), the ROM
font copy $E800, the dynamic sets $F000 and $F800 (set B's last character
is under the vectors and unused).

## Which Oscar64

Built and checked with the build named in c64-kb's CLAUDE.md. The released
v1.32.273 was not re-run for this step. One fault shapes the code from
the earlier road: in `hud_draw`, the local build compiled
`frames / (fps / 10)` as `frames / frames`, so the frames per tenth are a
variable (`fpt`) and the lap clock counts digit by digit.

## Left out on purpose

- Two opponent sprites at a time: the nearest two in view. More opponents
  are step 3 (sprites reused down the road).
- The cars do not overtake or avoid each other; only the player touches
  them.
- No Y expansion: an expanded sprite's fetches would need the pads worked
  out again.
- The horizon moves two lines at a time (12 offsets have glyphs); one line
  needs five character sets and about 4 KB more.
- A sheared row past twenty dynamic columns keeps its static code for the
  rest; not seen in the race.
- NTSC runs the same step at 60 Hz: the race is 6/5 as fast (c64-kb
  pal_ntsc_tempo_mismatch); the clock counts real tenths on both.

## Next steps (issue #110)

2. Speed: roadside objects scaled by distance, gears or a rev curve, a top
   speed that feels fast.
3. Challenge: checkpoints with a countdown, more than three opponents,
   crashes into roadside objects, two stages.
4. Polish: title, an original tune, sound effects, the finish screen.
