<!-- doc-type: reference -->

# Game Structure: the states a shipped C64 game is made of

This page is about how a finished game is put together above the level of
any one routine: which states it passes through, what each state resets,
how a level ends, and what a front end holds. These are design patterns,
not techniques. A technique tells you how to move a sprite; a pattern
tells you when the sprite must be switched off and who switches it back
on. Each pattern names the techniques and recipes that realise it and
lists checks a headless harness could run against a build. It exists
because three faults keep recurring in generated games: every level ends
on a frame counter, the player sprite and score digits stay on screen
after game over, and there is no working restart. Each is a missing or
merged state, not a missing effect. Sources are named in prose; a number
is its source's number. Nothing on this page was measured in VICE.

---

## game_state_machine — One state variable owns the machine

**Kind:** structure
**Applies to:** vertical_shmup, horizontal_shmup, single_screen_platformer, scrolling_platformer, top_down_adventure, puzzle, action_puzzle, sports, racing, beat_em_up
**Realised by:** jump_table_dispatch, irq_chain_table, frame_sync_loop, joystick_edge_detect, sid_play_routine_pattern, sfx_engine_beside_music, oscar64/platformer-scaffold, oscar64/simple-shmup, kickassembler/irq-chain, two_player_state_swap, oscar64/two-player
**Sources:** Codebase64 guide to programming games (unattributed, wiki); Andrew Braybrook, Morpheus diary in Zzap!64, 1987; John and Steve Rowlands, Mayhem in Monsterland diary in Commodore Format, 1992 to 1993

**Checks:**

- Read the state variable after boot and find it equal to the front-end state.
- Read the sprite enable register on the first frame of the front end and find only the bits the front end's own sprite list sets; the play sprites' bits read zero.
- Read the sprite enable register after game over resolves to the front end and find the play sprites cleared.
- Find no score, lives or level digits in screen RAM while the state is front end.
- Hold fire in the front end for one frame after entering it and confirm play has not begun.
- Play to game over, return to the front end, start again, and find the score, lives and level at their starting values.
- Read the current-tune variable, the value passed to the play routine's init, in the front end and find it equal to the front-end tune number.
- Enter the play state and find the frame counter, timer and per-level counters at their initial values.

### Why

Every screen in a C64 game shares one CPU, one interrupt chain and one
set of video registers, and nothing clears them when the story moves on.
If the title and the play loop are one routine with a flag, play's
sprites, raster split, music call and joystick reads are still live when
the title comes back, and the player sees a ship parked on the logo.

The remedy is a single state variable, a table of entry routines, and the
rule that every entry routine puts the machine into the shape its state
needs before the first frame is drawn. Braybrook's Morpheus diary treats
the title screen, the high-score table and a pre-game "meet the meanies"
sequence as pieces written and debugged apart from the play loop; one
entry records the title screens running unsynchronised at several times
frame rate, a bug that can only exist when the title has its own loop.

### The shape

One byte holds the state. A jump table indexed by it dispatches to the
state's per-frame routine; a second table holds the entry routine that
runs once on a change. Each frame: wait for the raster, run the per-frame
routine, read the requested next state, and if it differs run the new
entry routine before the next frame. The usual states:

```
state          entered from                 leaves to
front_end      boot, game_over, hiscore     attract, get_ready
attract        front_end                    front_end
get_ready      front_end, death, level_end  play
play           get_ready, pause             level_end, death, pause
pause          play                         play
level_end      play                         get_ready, ending
death          play                         get_ready, game_over
game_over      death                        hiscore_entry, front_end
hiscore_entry  game_over, ending            front_end
ending         level_end                    hiscore_entry, front_end
```

What each entry routine sets, and why. The register names below are
standard VIC, SID and CIA facts and were not measured here.

- Sprite enable ($D015) and the sprite pointers at the end of screen RAM.
  Each entry sets exactly the sprites its state uses. A multiplexer must
  be told to stop as well, or its IRQ re-enables them next frame.
- The IRQ chain: each state installs its own raster table. Screen RAM
  and colour RAM: clear or repaint both, or stale colour RAM shows the
  next text in the wrong colour.
- SID. Call the state's tune init, or gate every voice off and silence
  the effects engine. A voice left gated sustains into the next screen.
- The joystick latch. Read and discard the port on entry and require a
  release before accepting fire, or the press that ended the last state
  starts the next.
- Counters. Frame counter, timers, quotas and the spawn cursor are set
  by the entry routine of the state that uses them, not at boot.

Braybrook's pause is the pattern in miniature: the interrupt-driven
sprite system was told to reuse its previous positions when no new ones
arrived.

### What breaks when it is skipped

- Sprites and HUD digits on the title, because play's sprite enable is
  still live and the front end never repainted the panel rows; and no
  restart, because play was entered by falling through from the title
  once, so a second game inherits the first's score, level and actors.
  Both seen in a generated build this week.
- The first frame of play reads a held fire press, and two tunes play at
  once because the new init ran with the old play call still chained.

### Variations

A shop or between-phase screen is a state of its own: Braybrook's
Morpheus plays each level over two phases joined by a docking bay and
converts a phase's score to funds for parts. A flip-screen adventure adds
a short room-change state. Demos run the same machine under other names;
see `../demo-design/demo-design-philosophy.md`.

Related: `game-design-patterns.md`, `c64-game-archetypes.md`,
`../techniques/cpu-cycle-tricks.md`, `../techniques/raster.md`,
`../techniques/input.md`, `../techniques/music-sid.md`.

---

## level_end_conditions — A level ends on a condition the player caused

**Kind:** behaviour
**Applies to:** vertical_shmup, horizontal_shmup, single_screen_platformer, scrolling_platformer, top_down_adventure, puzzle, action_puzzle, beat_em_up
**Realised by:** wave_director, actor_activation_window, object_pool, tile_grid_collision, decimal_print, oscar64/wave-director, oscar64/level-rle-decoder
**Sources:** Peter Liepa, Boulder Dash interview transcript on boulder-dash.com, 2022; Jamey Pittman, The Pac-Man Dossier, Game Developer; Andrew Braybrook, Morpheus diary in Zzap!64, 1987; John and Steve Rowlands, Mayhem in Monsterland diary in Commodore Format, 1992 to 1993

**Checks:**

- Advance the frame counter past the level's nominal length with the player idle and find the level still in play.
- Satisfy the level's end condition (quota, exit cell, last enemy, boss) and find the state change to level_end within a bounded number of frames.
- Run the timer to zero and find the state change to death, not to level_end.
- Patch the level table's speed entry for level 1 before boot and find the level's measured speed follow the patch; a constant in code fails this.
- Start level 2 and find the level counter at 2 and the level 1 counters cleared.

### Why

A level that ends when a counter runs out ends whether or not the player
did anything, and the player learns that waiting is as good as playing.
Shipped games end a level on something the player did and use time as
pressure on that, never as the end itself.

### The catalogue

- Quota plus timer. Boulder Dash: Liepa describes sixteen caves plus
  four bonus caves, each at five difficulty levels, and says a harder
  level mostly means faster play and more boulders.
  The exit opens when the diamond quota is met and the clock is the
  pressure; the quota and time figures were not read in the interview.
  He also wanted every cave to run the same way for the same inputs.
- All pickups eaten. Pac-Man: Pittman gives 244 dots per maze, 240 small
  plus four energisers (240 + 4 = 244), and the level ends only when all
  are eaten.
- Docking or exit sequence as its own state. Morpheus: Braybrook
  describes an un-docking sequence in which the port slides off screen
  as the ship leaves, and a re-docking sequence debugged separately.
- Exit cell entered, with a condition on it. Mayhem in Monsterland: the
  Rowlands describe a finishing line at the end of each 25-screen level,
  and on the level's sad version reaching it drops the player through
  the platform to a chamber below.
- All enemies cleared, boss defeated, health that drains with time. The
  first two are the defaults for a single-screen shooter, a beat-em-up
  room and a stage end: the state changes when the object pool's active
  count is zero and the wave table is exhausted, or when one actor's
  hit points reach zero and its death animation completes. The third is
  Gauntlet's; Ed Logg's postmortem could not be read here. None of the
  three is sourced to a named designer on this page.

### The per-level table

The canonical shape is a row per level and a column per tunable, with
the rows running to the level after which nothing changes. Pittman's
Pac-Man tables have columns for the bonus symbol, the player's speed
normal and eating, the ghosts' speed normal, frightened and in the
tunnel, the frightened duration and flash count, and the scatter and
chase intervals; the tables' last row is level 21 and up. Liepa's five
difficulty levels are the same idea with two
columns. Write your own in that shape and read every value from it:

```
level  speed  duration  quota  enemy_count  spawn_rate  bonus
1      1      ..        ..     ..           ..          ..
2      ..
```

Duration is the pressure timer's length, not the level's. When the last
row is reached, hold it, as Pac-Man does from level 21.

### What breaks when it is skipped

- The level ends on a frame count and the player learns to wait, or the
  timer running out counts as success because it is the only end wired.
- Difficulty lives in code constants, so the ramp cannot be seen or
  changed without an assembler pass.

### Variations

Quota then exit is the common combined form. A shooter ends a level when
the scroll reaches the end of the map and the boss is dead. A puzzle
level ends when a predicate over the board is true, with no timer.

Related: `game-design-patterns.md`, `../techniques/logic.md`,
`../techniques/text.md`.

---

## level_transition_sequence — Get Ready, swap the level, reset the counters

**Kind:** composition
**Applies to:** vertical_shmup, horizontal_shmup, single_screen_platformer, scrolling_platformer, top_down_adventure, action_puzzle, beat_em_up
**Realised by:** screen_wipe, colour_fade, colour_cycling, tile_map_render, charset_copy_rom_to_ram, kickassembler/screen-wipe, kickassembler/colour-fade, oscar64/tile-map-render, oscar64/level-rle-decoder, flip_screen_rooms, oscar64/flip-screen-rooms
**Sources:** John and Steve Rowlands, Mayhem in Monsterland diary in Commodore Format, 1992 to 1993; Andrew Braybrook, Morpheus diary in Zzap!64, 1987

**Checks:**

- End level 1 and find the state pass through level_end and get_ready before play resumes.
- Read the character set pointer and the video bank in level 2 and find them equal to level 2's row in the level table.
- Read the sprite enable register during the get-ready screen and find only the sprites that screen owns.
- Read the object pool at the first frame of level 2 and find every slot free.
- Read the timer and quota counters at the first frame of level 2 and find them at level 2's starting values.
- Hold fire through the get-ready screen and find that play starts once, on the release.

### Why

The Rowlands give two reasons for a Get Ready screen: it tells the
player another go is coming, and it is a rest between lives. It is also
where the machine is put into the next level's shape while nothing is
moving. Their diary describes set-up routines that select the right
graphics bank and colour table before fire takes the player into the
level, and a Get Ready screen showing a scaled-down copy of the level.

### The shape

A per-level record holds everything that differs between levels: map
address and size, character set, colour table, sprite bank, tune number,
start position and difficulty row. The level_end entry increments the
level counter and, if the table has run out, requests the ending. The
get_ready entry reads the record, decompresses the map, copies the
character set, paints the colour table, starts the tune, frees every
object-pool slot, resets the timer and quota, and draws the text. Play's
entry then enables the player's sprites, installs the play IRQ chain and
clears the joystick latch. Score and lives are kept; frame counter,
timer, quota, spawn cursor, scroll position, object pool and per-level
flags are reset. Nothing carries over that the table did not put there.

The wipe is the visible part. The Rowlands describe pressing fire on Get
Ready, the screen blanking, the player character charging on and skidding
to a halt, and the level appearing behind him in an ever-growing box. Any
screen_wipe form, a colour_fade out and in, or a colour_cycling flash
serves; finish it before play's entry runs, so the swap happens on a
blank screen and no half-drawn frame shows.

### What breaks when it is skipped

- Level 2 draws with level 1's character set for a frame or more.
- Enemies from the end of level 1 are alive at the start of level 2, a
  held fire press fires on its first frame, and the timer carries its
  level 1 remainder over.

### Variations

A flip-screen adventure runs the short form on every room change. It does
not fit in one vertical blank: the flip-screen-rooms recipe measured a
full redraw of a 40 by 22 RLE room at 40,204 to 42,141 cycles, about two
PAL frames, so it blanks the display for two frames on PAL and three on
NTSC and redraws behind the blank (this sentence said "inside one vertical
blank" until that measurement). Morpheus puts a docking sequence where Get
Ready goes.

Related: `../techniques/transitions.md`, `../techniques/scroll.md`,
`../techniques/memory-banking.md`.

---

## front_end_and_attract — The title screen, the demo mode and the high-score table

**Kind:** production
**Applies to:** vertical_shmup, horizontal_shmup, single_screen_platformer, scrolling_platformer, top_down_adventure, puzzle, action_puzzle, sports, racing, beat_em_up
**Realised by:** text_input_line, kernal_file_write_seq, kernal_file_read_seq, joystick_edge_detect, decimal_print, colour_cycling, big_font_2x2, oscar64/high-score-persist, oscar64/text-input, kickassembler/big-font-scroller, kickassembler/colour-cycling, attract_mode_input_replay, oscar64/attract-replay
**Sources:** Codebase64 guide to programming games (unattributed, wiki); Lasse Öörni, Rant 18, Interaction patterns in Covert Bitops games; Tony Temple, Anatomy of Arcade High Score Tables, The Arcade Blogger, 2021; Andrew Braybrook, Morpheus diary in Zzap!64, 1987

**Checks:**

- Leave the front end idle for its attract delay and find the state change to attract, then back to the front end when the demo ends or fire is pressed.
- Read the player's input byte during attract and find it written by the attract source, not by the joystick port.
- Press fire during attract and find the state change to the front end within one frame.
- Score above the lowest table entry and find the state pass through hiscore_entry before the front end.
- Score below the lowest table entry and find the state go straight to the front end.
- Read the table after boot and find it seeded, not blank.
- Enter three characters and find the entry accepted and the table re-sorted.
- Leave hiscore_entry idle for its timeout and find the entry closed with the characters typed so far.
- Read screen RAM in the front end or during attract and find the table drawn.

### Why

The front end is the screen every game returns to, so it needs its own
entry routine for the reasons in game_state_machine. The Codebase64 guide
describes its author's usual title as a bitmap logo, a scroller and a
colour wash or flash, and says an ending should be more than a one-line
message: simple demo effects, sprite animation and an end tune.

### The shape

Title. Logo, scroller, one or two modest effects, the high-score table
and the prompt. Braybrook records a table of ten rows, scores of eight
digits and three-letter initials, and later an all-time table saved to
disk for disk owners only. His title ran on the play
multiplexer, which is the coupling the state machine has to manage.

Attract. Two ways to drive a demo of the game without a second code
path. First, Öörni's control-override pattern: the player actor reads a
virtual joystick byte rather than the port; he describes a conversation
freezing the player by feeding zero, and enemy AI in his later games
feeding enemy actors the same way. Driving attract through that byte
from a script is this page's use of the seam, not his. Second, replay
recorded input through the same override; this reproduces the run only
if the game is deterministic from its seed, the property Liepa wanted
for Boulder Dash. Both end on any real fire press and at the script's
end. The attract delay is not sourced here.

High-score subsystem. Temple quotes Atari's Steve Calfee, whose reason
for stopping at three letters was to keep obscenities off the attract
screen, and describes a Missile Command default table filled by a staff playoff
with the lead programmer's initials on top. The checklist:

- A seeded default table, so the first game has something to beat.
- Three initials, by text_input_line or a joystick letter wheel.
- An entry timeout, so an abandoned entry does not hold the machine.
  Temple states none and no period figure was read here; pick one.
- The table shown in the front end or during attract; Temple's examples
  put it on the attract screen, Missile Command among them.
- Persistence if the medium allows: Braybrook's disk-only save; Temple
  contrasts arcade tables reset at power-off with battery-backed ones.

Game over leads to hiscore_entry when the score qualifies and to the
front end when it does not. The ending state goes to the same place.

### What breaks when it is skipped

- The front end shows play's sprites and HUD because it is not a state.
- No attract, so the title is a still frame when it idles; a blank table,
  so the first player tops it with any score; no timeout, so a
  walked-away entry screen holds the machine.
- Game over drops to the title with no path to enter a score.

### Variations

A sports or racing game keeps best times or a league: same subsystem,
different sort key. Without disk access, seed the table at boot.

Related: `game-design-patterns.md`, `../techniques/text.md`,
`../techniques/file-io.md`, `../techniques/input.md`, and
`../demo-design/intro-cracktro-patterns.md` for the scroller and logo
conventions the front end borrows.
