# beat-em-up: a side-on street brawler starter

A small game that plays: a street 128 characters long scrolls right in
three stages, and each stage locks the camera until its two waves of
enemies are beaten. The hero and up to three enemies are two multicolour
sprites each and walk on a depth plane; the nearer fighter is drawn in
front. Punch, kick and jump kick land only on their attack frames and only
on a fighter within 6 ground lines. Enemies come in, line up in the
hero's lane, attack and back off; a kick, a jump kick or a third punch in
a row knocks a fighter down and he gets up again. Health bars and faces in
a HUD, an original two-voice tune, hit effects on the third voice. Title,
fire to start, game over back to the title. PAL and NTSC, Oscar64 C with a
KickAssembler part.

Start a game from it in c64-kb:
`npm run new-project -- beat-em-up ~/c64/mygame`.

## Playing

Joystick in port 2. Left and right walk, up and down change lane. Fire
alone punches; fire with left or right kicks that way; fire with up jumps
(forward with left or right); fire in the air kicks. A punch is 10 points,
a kick 20, a jump kick 30; a thug beaten is 100, a brute 200. Three lives.
The GO sign blinks when a stage is clear: walk right.

## Files

| File | Holds |
|---|---|
| `src/main.c` | The frame loop, the states (title, play, game over, street clear), lives, the meter |
| `src/game.h` | Every shared constant, variable and function, in one place |
| `src/street.c` | The street as ten lines of text, the 2 x 2 metatiles, the three stage locks |
| `src/art.c` | Every picture as text (street glyphs, bar glyphs, sprite blocks), the pose table, hurt and hit boxes |
| `src/anim.c` | Moves as (pose, frames, hit box) tables: only attack frames carry a box |
| `src/fighter.c` | What every fighter shares: walk, attack, jump, hurt, knock-down, get-up, KO; the depth-gated hit test; the joystick |
| `src/enemy.c` | The enemy state machine and the waves (three enemy slots) |
| `src/view.c` | VIC-II: bank 3, the camera and its locks, the scroll, the depth sort and the three sprite bands |
| `src/hud.c`, `src/sound.c` | Bars, score and text; the effects on SID voice 3 |
| `src/engine.asm` | KickAssembler: the IRQ chain that writes the sprite bands, the scroll's slice copy, the tune |
| `src/autopilot.h`, `src/verdict.h` | AUTOPILOT builds only: the bot, the photo stops, the self-check |
| `tools/flickercheck.py` | Renders the fighters from `src/` and proves every part is on the screen in the crowded moments (`make flickercheck`) |
| `tools/drive.py` | Plays the `make joy` build headless over VICE's monitor |
| `expect.json`, `PLAN.md` | The screenshot checks; the plan with the c64-kb tool output |

## How a frame runs

The IRQ at line 251 starts the frame. The main loop plays the tune and the
effects, reads the joystick, runs the hero, the enemies' AI, every
fighter's move, the hits, the waves and the camera, redraws the HUD if
something changed, builds the sprite tables and publishes the next
picture's `$D016`, `$D018` and sprite set as one.

Sprites come in three bands a frame (c64-kb `sprite_multiplex_game`'s
double-buffered table, with bands instead of a Y-sorted list). The IRQ at
line 251 writes band 0, the GO sign (lines 53-73). The IRQ at line 76
writes band 1, the fighters. The IRQ at line 212 switches the HUD to 40
columns, hires and its own page, and writes band 2, the faces (lines
219-239). All eight sprites are reused three times a frame; between bands
every sprite's last line has passed before it is rewritten.

Band 1 is where a brawler's multiplexer usually flickers: the fighters
stand on the same lines, so no sprite can be reused inside the band. Here
a fighter is two parts, a top and legs, at per-pose offsets from his feet
(c64-kb `multi_sprite_object`); four fighters are eight parts, and the band
never has to drop one. The depth sort (c64-kb `lane_depth_engine`) gives
the nearest fighter sprites 0 and 1, the next 2 and 3, and so on: the
VIC-II draws a lower sprite over a higher one, so its own priority is the
depth order. A fist or a foot is drawn inside the 24-pixel parts; a third
part per fighter would need 12 sprites on one line.

The scroll is the platformer starter's, for a camera that only moves
right: XSCROLL moves the picture a pixel; a column crossing is a `$D018`
flip to the other page, which was prepared five rows a frame by a
KickAssembler copy one column over. The page on display is never written.

Memory: VIC bank 3. Street pages at `$C000` and `$C400`, the HUD page at
`$C800`, the character set at `$E000` (the ROM's glyphs 0-63 copied in),
63 sprite blocks from `$F000`. BASIC and KERNAL are banked out (`$01` =
`$35`). The KickAssembler blob is `$0900`-`$0F59`, the C program from
`$1000`.

## The measured frame

The harness meter (CIA2 timer A) over 255 play frames of the autopilot
run, VICE x64sc 3.10, `make shot check`. The IRQs are in the figure: one
that lands inside the main loop's bracket is in its wall time; one that
lands outside times itself on CIA2 timer B and is added
(`engine.asm`, `IrqIn`/`IrqOut`). About 40 cycles an IRQ, the entry and
exit around the timer, are not counted (arithmetic).

| Window (`-dMETER_WINDOW=n`) | Model | Worst | Typical (median) | Frame |
|---|---|---|---|---|
| 0, the default: from the second stage's lock, the crowded fight | PAL | 12,375 | 7,429 | 19,656 |
| | NTSC | 13,417 | 7,789 | 17,095 |
| 1: from the first stage clear, the walk that scrolls | PAL | 11,663 | 6,907 | 19,656 |
| | NTSC | 11,949 | 7,275 | 17,095 |

Per subsystem in window 0, built with `-dPROF=n` (worst / typical):

| n | Subsystem | PAL | NTSC |
|---|---|---|---|
| 1 | hero, AI, moves, hits, waves | 3,398 / 2,722 | 3,398 / 2,722 |
| 2 | camera and scroll | 3,591 / 192 | 3,708 / 192 |
| 3 | depth sort, sprite bands, publish | 4,403 / 3,606 | 4,751 / 4,295 |
| 4 | tune, effects, HUD | 4,157 / 104 | 4,845 / 104 |
| 5 | the three IRQs alone | 981 / 652 | 981 / 652 |

Every figure is wall time: badline and sprite DMA, and an IRQ that lands
inside a section, are in it (the NTSC figures for 3 and 4 are higher for
that reason). The parts' worst frames do not fall together. `hud_draw`
rewrites every HUD figure when any of them changes, so a hit that moves a
bar pays for the whole HUD; most frames change nothing (typical 104).

Against `plan-budget` (PLAN.md): 36,919 to 43,868 cycles plus 1,873
fixed, about two frames, verdict undetermined. The measured worst is a
third of that. The budget adds up other programs' worst cases:
`sprite_multiplex_game`'s 16,600 is 24 actors in a reversed sort (here
the bands need no sort across sprites: 4,403 for the band build and 981
for the IRQs); `lane_pursuit_ai`'s 9,871 to 14,204 is four cars probing a
tile map (here three enemies comparing distances, inside PROF 1's 3,398);
`per_frame_hitbox`'s 3,693 is 28 box pairs (here at most three targets an
attacker). It leaves the scroll out at 74,041, an old in-place shift
(issue #18); the three-page scroll here costs 3,591 at most. It has no
figure for the split, the double buffer or the jump arc; the meter covers
them.

## Proving it

| Command | What it proves | Last result |
|---|---|---|
| `make shot check` | 29 checks: the verdict, the HUD text and bar, the hero's face in band 2, the hero's two parts in band 1 where the run leaves him, the scrolled street at camera 704 (an alley and its lamp), the kerb, the blank row 20, PAL and NTSC identical, the meter | 29 of 29 passed |
| `make selftest` | FORCE_FAULT makes a punch worth 20: the verdict fails, the HUD score reads 002330 | check.py rejected the build |
| `make flickercheck` | Two shots inside each of three photo stops, PAL and NTSC: every sprite pixel of the eight parts matches a render of the fighters built from `src/`; then the FLICKER_DEMO build, which drops one part, must fail | 12 of 12 whole (1,530 to 1,616 pixels each); the demo: 6 of 6 with a part missing |
| `make claims` | Every store the run makes, title to verdict, against CLAIMS_ARGS | 0 violations |
| `make disk` | `build/beat-em-up.d64`; it boots to the title (90M cycles, true drive) | |

The self-check (`src/verdict.h`) grades the game's own state after stage
3's first wave: every event seen (punch, kick and jump-kick hits, a
knock-down and a get-up, a KO, the hero hit and down, a life lost, the
locks, a stage clear, a scroll, a lane change), the score equal to the
hits and KOs counted, one life lost, the fighter band's IRQ never late,
no part dropped, both pages equal to the street at their columns, the
hero's parts in the band the IRQ shows, the camera at the last lock, no
late frame, three photo stops.

How the flicker check works: when four fighters are in view within 24
ground lines, all eight sprites of band 1 are on the same lines. The
AUTOPILOT build then holds the game for 64 frames (the IRQs run as in
play) and prints each fighter's x, ground line, height, pose, facing and
kind on HUD rows 21-23. `tools/flickercheck.py` reads that back, builds
the parts from `art.c`'s pose table and sprite text (not from the
program's sprite table), puts the nearer fighter in front and compares
every pixel. Two stops are in stage 2, one in stage 3.

## Extending it

1. **More fighters on the screen, or a big boss.** Band 1 holds eight
   sprites: four fighters of two parts. A fifth fighter on the same lines
   has no sprite. Either draw him in characters (c64-kb
   `mixed_sprite_char_actors`, `docs/recipes/oscar64/mixed-fighters.md`;
   the scroll pages then carry his cells) or keep the crowd rule in
   `enemy.c` (two turns, the others wait a lane off) and add a Y-sorted
   multiplexer for fighters who stand clear of the band's lines
   (`sprite_multiplex_game`, `docs/recipes/kickassembler/sprite-multiplex-game.md`).
   Run `make flickercheck` after, with new pins.
2. **Weapons and pickups.** A knife or a crate on the street is a few
   character cells in both pages (the platformer's `view_erase_tile`); a
   thrown knife is a new hit box on a new pose. Groups and masks for who
   can hurt whom: `per_frame_hitbox`, `docs/recipes/oscar64/per-frame-hitbox.md`.
3. **Grabs, throws and more moves.** A move is a table in `anim.c` and a
   pose in `art.c`; the hit box on its frames does the rest. Events on
   entries (a sound, a throw) and priorities between requests:
   `sprite_animation_table`, `docs/recipes/oscar64/sprite-animation-table.md`.

Smaller steps: a second player (`two_player_state_swap`,
`docs/recipes/oscar64/two-player.md`); the high score on disk
(`docs/recipes/oscar64/high-score-persist.md`; the harness's `SHOT_DISK=1`
attaches the image during `make shot`); harder waves by stage
(`difficulty_ramp_tables`, `docs/recipes/oscar64/difficulty-tables.md`).
A changed wave, AI or art moves the photo stops: re-scan the run and
re-pin `FLICKER_PAL` and `FLICKER_NTSC` in the Makefile.

## Driving it headless

`make joy` builds the normal game with its port byte read from `$02FE`
instead of `$DC00`; `tools/drive.py` plays it over VICE's binary monitor
and reads the HUD. Measured: title, fire, LIVES 3, the hero standing still
loses all three lives, the title again, fire, a new game at LIVES 3. Set
`DRIVE_PORT` if another VICE holds port 6581.

```bash
make joy
DRIVE_PORT=6811 python3 tools/drive.py build/beat-em-up-joy.prg "until:PRESS FIRE" tap:fire \
    "until:LIVES 3" "until:LIVES 1" "until:PRESS FIRE" tap:fire "until:LIVES 3" print
```

## Which Oscar64

The build named in c64-kb's CLAUDE.md (1.32.271 plus the local fix
c1270bc). Upstream was not tried. One behaviour of that build shapes the
code: an `int` converted from an `unsigned` of 32,768 or more is compared
as if it were not negative (`(int)65512 < (int)228` is false; a 20-line
test in VICE, both with a local `int` and with a cast). An enemy spawned at
world x -24 then walked the wrong way; world x is now never below 0
(`enemy.c`, `spawn_wave`). Keep positions under 32,768.

## Left out on purpose

- No more than four fighters at once, and no part beyond two a fighter
  (see "More fighters" above).
- No grabs, throws, weapons or pickups.
- The camera only moves right, and the street ends at the third lock.
- The high score is not saved: it lives until power-off.
- NTSC runs the same per-frame steps at 60 Hz: the game and the tune are
  6/5 as fast (c64-kb `pal_ntsc_tempo_mismatch`), and the tune's pitches,
  tabled for the PAL clock, about 4% sharp (arithmetic).
- One effect at a time on voice 3; a new one cuts the last.

## Not established

- A real `$DC00` joystick: the normal game was played through `make joy`
  (a RAM port byte), not through the CIA.
- Real hardware: everything was measured in VICE x64sc 3.10.
- The tune was never listened to; its note table is arithmetic.
- The flicker check covers the three photo stops, six moments a model; the
  verdict's `band_late` count covers every frame of the run, but only the
  IRQ's timing, not the picture.
- Frames outside the two meter windows (stage 1's fights, stage 3) were
  not metered.
