# beat-em-up: a side-on street brawler starter

A small game that plays: a street 128 characters long scrolls right in
three stages, and each stage locks the camera until its two waves of
enemies are beaten. The hero and the thugs are two multicolour sprites
each; the brute is drawn in character cells, and a fighter farther away
than he is goes behind him. Everyone walks on a depth plane and the nearer
fighter is drawn in front. Punch, kick and jump kick land only on their
attack frames and only on a fighter within 6 ground lines. Enemies come
in, line up in the hero's lane, attack and back off; a kick, a jump kick or
a third punch in a row knocks a fighter down and he gets up again. Health
bars and faces in a HUD, an original two-voice tune, hit effects on the
third voice. Title, fire to start, game over back to the title. PAL and
NTSC, Oscar64 C with a KickAssembler part.

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
| `src/art.c` | Every picture as text (street glyphs, bar glyphs, sprite blocks, the brute), the pose table, hurt and hit boxes |
| `src/anim.c` | Moves as (pose, frames, hit box) tables: only attack frames carry a box |
| `src/fighter.c` | What every fighter shares: walk, attack, jump, hurt, knock-down, get-up, KO; the depth-gated hit test; the joystick |
| `src/enemy.c` | The enemy state machine (one enemy thinks a frame) and the waves (three enemy slots, one brute a wave) |
| `src/brute.c` | The brute in character cells: pre-shifted pictures, two character sets, his cells in both scroll pages |
| `src/view.c` | VIC-II: bank 3, the camera and its locks, the scroll, the depth sort, the three sprite bands, `$D01B` |
| `src/hud.c`, `src/sound.c` | Bars, score and text, redrawn only where they changed; the effects on SID voice 3 |
| `src/engine.asm` | KickAssembler: the IRQ chain that writes the sprite bands, the scroll's slice copy, the brute's glyph builder, the tune |
| `src/autopilot.h`, `src/verdict.h` | AUTOPILOT builds only: the bot, the photo stops, the self-checks |
| `tools/flickercheck.py` | Renders the fighters and the brute from `src/` and proves every pixel is on the screen in the crowded moments (`make flickercheck`) |
| `tools/drive.py` | Plays the `make joy` build headless over VICE's monitor |
| `expect.json`, `expect-gameover.json`, `PLAN.md` | The screenshot checks; the plan with the c64-kb tool output |

## How a frame runs

The IRQ at line 251 starts the frame. The main loop moves the brute's cells
if he stepped a whole cell (in the vertical blank, before the beam reaches
him), reads the joystick, runs the hero, the enemies' AI, every fighter's
move, the hits, the waves and the camera, plays the tune and the effects,
builds a row of the brute's next picture, redraws what changed on the HUD,
builds the sprite tables and publishes the next picture's `$D016`, `$D018`
and sprite set as one.

Sprites come in three bands a frame (c64-kb `sprite_multiplex_game`'s
double-buffered table, with bands instead of a Y-sorted list). The IRQ at
line 251 writes band 0, the GO sign (lines 53-73). The IRQ at line 76
writes band 1, the fighters. The IRQ at line 212 switches the HUD to 40
columns, hires and its own page, and writes band 2, the faces (lines
219-239). All eight sprites are reused three times a frame; between bands
every sprite's last line has passed before it is rewritten.

Band 1 is where a brawler's multiplexer usually flickers: the fighters
stand on the same lines, so no sprite can be reused inside the band. Here
a sprite fighter is two parts, a top and legs, at per-pose offsets from his
feet (c64-kb `multi_sprite_object`); three fighters and the hero are eight
parts, and the band never has to drop one. The depth sort (c64-kb
`lane_depth_engine`) gives the nearest fighter sprites 0 and 1, the next 2
and 3, and so on: the VIC-II draws a lower sprite over a higher one, so its
own priority is the depth order.

The brute is not a sprite (c64-kb `mixed_sprite_char_actors`, ported from
the other #39 draft): 16 multicolour pixels by 48 lines, stored at the four
2-pixel shifts, shown as a block of 5 x 6 cells with codes of their own.
Two character sets, alike but for his 30 glyphs, sit at `$E000` and
`$E800`; his next picture is built into the one not shown, a row of the
block a frame (KickAssembler, about 1,300 cycles), then `$D018` switches
sets. His cells are rewritten only when he moves a whole cell, in both
street pages. On street rows 2-19 the street uses bit pairs 00 and 01
only, which the VIC counts as background; his pairs 10 and 11 are
foreground, so a sprite with its `$D01B` bit set (every fighter farther
away than he is) goes behind him and behind nothing else (c64-kb
`mob_priority`).

The scroll is the platformer starter's, for a camera that only moves right,
a pixel a frame: XSCROLL moves the picture a pixel; a column crossing is a
`$D018` flip to the other page, which was prepared four rows a frame by a
KickAssembler copy one column over. The page on display is never written,
but for the brute's cells.

Memory: VIC bank 3. Street pages at `$C000` and `$C400`, the HUD page at
`$C800`, the two character sets at `$E000` and `$E800` (the ROM's glyphs
0-63 copied in), 63 sprite blocks from `$F000`. BASIC and KERNAL are banked
out (`$01` = `$35`). The KickAssembler blob is `$0880`-`$0FFF`, the C
program from `$1000`.

## The measured frame

The harness meter (CIA2 timer A) over 255 play frames of the autopilot
run, VICE x64sc 3.10, `make shot check`, the local Oscar64 build. Each
window starts where the run reaches a point (`-dMETER_WINDOW=n`); the
default is the run's worst:

| n | Window (255 play frames from) | PAL worst / typical | NTSC worst / typical |
|---|---|---|---|
| 0 (default) | the second stage's lock: the brute, two thugs, the hero's KO | 14,960 / 9,359 | 16,464 / 9,897 |
| 1 | the third stage's lock: three thugs, eight sprites in the band | 12,255 / 7,317 | 13,254 / 7,990 |
| 2 | the first stage clear: the walk, every frame scrolls | 7,343 / 6,979 | 8,215 / 7,304 |
| 3 | the first stage's lock: two thugs, then the brute | 10,930 / 6,132 | 10,744 / 6,421 |

The frame is 19,656 cycles on PAL and 17,095 on NTSC. The IRQs are in the
figure: one that lands inside the main loop's bracket is in its wall time;
one that lands outside times itself on CIA2 timer B and is added
(`engine.asm`, `IrqIn` and `IrqOut`). About 123 cycles an IRQ, its entry
and exit around the timer, are not counted (arithmetic from the listing,
the #39 review; an earlier version of this page said 40): a typical frame,
all three IRQs outside the bracket, reads about 370 low, a worst frame
about 250. NTSC's worst plus that is about 16,700 of 17,095. No play
frame's work ran past the next blank in the whole run, on either model
(the verdict's `late`, 0). The autopilot's own checks (the bot, the VIC
read-back) run after the work, outside the bracket; with them the loop ran
past a blank 89 times on PAL and 610 on NTSC, which slows the AUTOPILOT
run, not the game.

Per subsystem in window 0, built with `-dPROF=n` (worst / typical):

| n | Subsystem | PAL | NTSC |
|---|---|---|---|
| 1 | hero, AI, moves, hits, waves | 3,629 / 2,110 | 3,672 / 2,110 |
| 2 | camera and scroll | 3,031 / 192 | 3,074 / 192 |
| 3 | depth sort, sprite bands, publish | 4,333 / 4,027 | 4,409 / 4,161 |
| 4 | tune, effects, HUD | 846 / 105 | 1,006 / 121 |
| 5 | the three IRQs alone | 1,961 / 993 | 2,102 / 993 |
| 6 | the brute's cell moves (`brute_draw`) | 6,735 / 30 | 7,712 / 30 |
| 7 | the brute's picture, a row a frame (`brute_prepare`) | 6,312 / 2,385 | 6,846 / 2,514 |

Every figure is wall time: badline and sprite DMA, and an IRQ that lands
inside a section, are in it. The parts' worst frames do not fall together
(`brute_prepare` starts no new picture in a frame that moved his cells).
PROF 5's worst is a loop that ran over a blank, so two frames' IRQs.
PROF 7 was 18,000 cycles a frame when the glyphs were built in C; the frame
also got a round-robin AI, a HUD that redraws only what changed, and a
camera at a pixel a frame, all to fit the brute and the VIC read-back.

Against `plan-budget` (PLAN.md): 43,027 to 49,976 cycles plus 1,873
fixed, over two frames, verdict undetermined. The measured worst is a third
of that. The budget adds up other programs' worst cases:
`sprite_multiplex_game`'s 16,600 is 24 actors in a reversed sort (here the
bands need no sort across sprites: 4,333 for the band build and about
1,000 a frame for the IRQs); `lane_pursuit_ai`'s 9,871 to 14,204 is four
cars probing a tile map (here the enemies' AI is inside PROF 1's 3,629);
`mixed_sprite_char_actors`' 6,108 is a whole character actor updated in
one tick (here a row a frame, 2,385 typical); `per_frame_hitbox`'s 3,693 is
28 box pairs (here at most three targets an attacker). It leaves the
scroll out at 74,041, an old in-place shift (issue #18); the two-page
scroll here costs 3,031 at most.

## Proving it

| Command | What it proves | Last result |
|---|---|---|
| `make shot check` | 29 checks: the verdict, the HUD text and bar, the hero's face in band 2, the hero's two parts in band 1 where the run leaves him, the scrolled street at camera 704 (an alley and its lamp), the kerb, the blank row 20, PAL and NTSC identical, the meter | 29 of 29 passed |
| `make selftest` | FORCE_FAULT makes a punch worth 20: the verdict fails, the HUD score differs | check.py rejected the build |
| `make flickercheck` | Two shots inside each of three photo stops, PAL and NTSC: every pixel of the sprite fighters and the brute's cells matches a render built from `src/`, `$D01B` priority included; then the FLICKER_DEMO build, which drops one sprite part, must fail | 12 of 12 whole; photo 1 has 162 of the brute's pixels over a fighter behind him, photo 2 98 of a fighter over him; the demo: 2 of 6 with a part missing |
| `make gameover` | The AP_GIVE_UP build loses three lives; GAME OVER must be whole with LIVES 0 (it once read GAME OVETHUG) | 8 of 8 passed |
| `make claims` | Every store the run makes, title to verdict, against CLAIMS_ARGS | 0 violations |
| `make disk` | `build/beat-em-up.d64`; it boots to the title (90M cycles, true drive) | |

`npm run verify:templates -- --only beat-em-up --selftest` runs all of
these (`VERIFY_TARGETS` in the Makefile).

The self-check (`src/verdict.h`) grades the game's own state after stage
3's first wave, the whole run behind it:

- every event seen (punch, kick and jump-kick hits, a knock-down and a
  get-up, a KO, the hero hit and down, a life lost, the locks, a stage
  clear, a scroll, a lane change, a cross-lane miss);
- the score equal to the hits and KOs counted; one life lost;
- no play frame late; the fighter band's IRQ never late; no part dropped;
- both pages equal to the street and the brute's cells at their columns;
  his cell moves always before his top row; two brutes beaten;
- every hit recomputed on its own: the lane difference and the box
  overlap (`check_hit`). The bot throws one punch at an enemy a lane away,
  which must count as a miss;
- the fighter band read back from the VIC every frame (the IRQ at line 76
  copies `$D000`-`$D010`, `$D015` and `$D01B`) against an independent
  sort: 4,115 frames compared on PAL, 4,068 on NTSC, none wrong
  (56 hits recomputed, none wrong);
- the hero's parts in the table the IRQ shows; the camera at the last
  lock; three photo stops.

Mutations, each run through `make shot check` (and `make gameover` for the
last): the lane gate widened to 60 lines (fails: a cross-lane hit, no
cross-lane miss); the band filled far to near (fails: the VIC read-back,
1,669 frames); the `$D010` bit dropped (fails: the VIC read-back and the
hero's parts); `$D01B` never set (fails: the VIC read-back, 495 frames);
the HUD redraw put back after GAME OVER, as the first draft had it (fails:
GAME OVE). The figures are from those runs. The FLICKER_DEMO
build is the flicker check's own mutation.

## Extending it

1. **More fighters on the screen, or a big boss.** Band 1 holds eight
   sprites: the hero and three thugs, or fewer with the brute. A fifth
   sprite fighter on the same lines has no sprite. Draw him in characters
   like the brute (`src/brute.c`; c64-kb `mixed_sprite_char_actors`,
   `docs/recipes/oscar64/mixed-fighters.md`), with his own 30 codes, or
   keep the crowd rule in `enemy.c` and add a Y-sorted multiplexer for
   fighters who stand clear of the band's lines
   (`sprite_multiplex_game`, `docs/recipes/kickassembler/sprite-multiplex-game.md`).
   Beware its slot order: it gives the upper (farther) actor the lower
   sprite, so where two overlap the farther one is drawn in front. The #39
   review measured it in VICE with the recipe's own listing, both ways
   round (`/tmp/c64kb-write/BEU/depth/`, not in this repository). Depth
   needs the slots reversed inside each zone. Run `make flickercheck`
   after, with new pins.
2. **Weapons and pickups.** A knife or a crate on the street is a few
   character cells in both pages (the brute's `block_put`); a thrown knife
   is a new hit box on a new pose. Groups and masks for who can hurt whom:
   `per_frame_hitbox`, `docs/recipes/oscar64/per-frame-hitbox.md`.
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

Built and checked with the build named in c64-kb's CLAUDE.md (1.32.271
plus the local fix c1270bc) and with the released v1.32.273: on both,
`make shot check` 29 of 29, `make selftest`, `make flickercheck` 12 of 12
and the demo caught, `make gameover` 8 of 8, `make claims` 0 violations.
The meter reads a little lower on v1.32.273 (window 0: 14,759 / 9,031 PAL,
16,283 / 9,588 NTSC). Two faults shape the code:

- c64-kb #30 fault 8, on both compilers at every level: an `int` loaded
  from an `unsigned` of 32,768 or more is compared as if it were not
  negative, when the other side is another non-constant `int`. Against a
  constant, or against the result of arithmetic, it is right. An enemy
  spawned at world x -24 (65,512) walked the wrong way. World x is never
  below 0 (`enemy.c`, `spawn_wave`), and `think` compares the unsigned
  positions as they are. Keep positions under 32,768.
- v1.32.273 only: `page_d018[shown_page] | (b_cs ? D018_CS1 : 0)` in one
  expression indexed `page_d018` with X before loading X (its `.asm`), so
  `$D018` pointed the street at the sprite data. Two statements
  (`view_publish`) are right on both.

## Left out on purpose

- No more than four fighters at once, one brute a wave, two sprite parts
  a fighter (see "More fighters" above).
- No grabs, throws, weapons or pickups.
- The camera only moves right, and the street ends at the third lock.
- The high score is not saved: it lives until power-off.
- The street on rows 2-19 has two colours (bit pairs 00 and 01), so the
  brute's `$D01B` rule holds.
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
  VIC read-back covers every frame but reads the registers, not the
  picture.
- The four meter windows are 1,020 play frames of the run; the rest were
  not metered (the verdict's `late` covers every play frame, but only
  whether it fitted).
