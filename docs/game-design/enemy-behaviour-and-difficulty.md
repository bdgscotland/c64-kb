<!-- doc-type: reference -->

# Enemy Behaviour and Difficulty: how enemies act and how a game gets harder

This page is about what enemies do and how a game ramps, as design. It sits above the actor table,
the state byte and the handler jump table, which `./game-design-patterns.md` covers in its "Enemy
/ actor state machines" section; read that first. These are design patterns, not techniques: a
technique steps an actor along a path; a pattern says which path, at what speed, and why the
player believes it.

Sources are named in prose and on each Sources line; a number from a source is that person's
number. Nothing on this page was measured in VICE.

---

## interaction_patterns — Six ways actors act on each other

**Kind:** structure
**Applies to:** vertical_shmup, horizontal_shmup, single_screen_platformer, scrolling_platformer, top_down_adventure, action_puzzle, beat_em_up
**Realised by:** object_pool, actor_activation_window, sprite_animation_table, jump_table_dispatch, oscar64/object-pool, oscar64/actor-activation-window
**Sources:** Lasse Öörni, Rant 18 (Interaction patterns in Covert Bitops games, undated); Lasse Öörni, Rant 4 (Multidirectional scrolling and the game world, undated)

**Checks:**

- Destroy an enemy and read its slot's type byte on the next frame: it holds the explosion type, not zero, until the explosion ends.
- Spawn a smoke trail every frame for a hundred frames, then press fire, and find a player bullet in a live slot.
- Enter a scripted conversation, hold the joystick right for sixty frames, and find the player's X unchanged.
- Stand the player on a moving lift with the joystick centred and find the player's X change equal to the lift's per-frame velocity.
- Place an enemy in level data outside the activation rectangle and find the live-slot count unchanged while it stays outside.
- Scroll the enemy inside the rectangle and find one new live slot and one fewer level-data entry.

### Why

Öörni's six patterns are the ones his released games (Metal Warrior 4, Hessian, Steel Ranger, MW
ULTRA) use. Each replaces a special case with a data rule: an explosion that is not an actor, an
attract mode with its own movement code, a cutscene that pokes the player's position directly.

### The shape

Actor transformation. A slot changes its type byte in place instead of being freed and re-spawned:
an enemy becomes its own explosion, a pickup becomes a sparkle, a boss enters its second phase.
Position and slot are kept, so the change cannot fail for want of a free slot. Öörni tried it in
Hessian to let the player take over an enemy tank and cut the feature; the mechanism stayed.

Spawning during another actor's life. Smoke puffs, multi-part explosions and turret bullets are
actors created by an actor. The trap is pool starvation: an effect that spawns every frame takes
the slot the player's next bullet needs. Öörni reserves index ranges for effects so it cannot.
Give the pool three bands: player and player shots, enemies and their shots, effects.

Control override. The player actor reads a virtual joystick byte, not the port. In play the byte
is a copy of the port; in a conversation the game feeds zero and the player stands still; from
Metal Warrior 4 onward enemy AI writes the same byte into the same movement routine. One walk, one
jump, one collision path, tested once. Feeding a recorded byte stream gives an attract mode with
no second code path; that use is this page's extension of Öörni's article, not measured here.

One actor updating another. A lift applies its own velocity to whatever stands on it (Metal
Warrior 4, Steel Ranger); MW ULTRA's grapple hook takes over the player's movement until it
detaches. Update from the carrier, after the carrier has moved, so the carried actor never trails
by a frame.

Data-set reduction. Do not walk the whole level's object list every frame. Rant 4 gives the shape:
level objects sleep in level data as position and type only; each frame a slice of that data is
scanned (Öörni's example is sixteen objects); an object inside a rectangle a little larger than
the screen becomes an actor and leaves the level data; an actor that leaves the rectangle goes
back; the player is never removed. `actor_activation_window` is this pattern as a technique.

Code-based render. An actor whose draw routine computes its sprites from state rather than looking
up a frame: MW ULTRA's rope, drawn from the angle between hook and player. It is the expensive
one; budget for one or two, not a pool.

### What breaks when it is skipped

Explosions vanish under load because the pool is full; attract mode and cutscenes drift from the
real controls after every physics change; a hundred placed objects cost a hundred compares a frame
whether or not any is near the player.

Related: `./game-design-patterns.md` (slot table, state byte, object pool), `../techniques/logic.md` (`object_pool`, `actor_activation_window`), `./game-structure.md` (attract and cutscene states).

---

## enemy_personality_by_target — Four personalities from four target rules

**Kind:** behaviour
**Applies to:** top_down_adventure, action_puzzle, single_screen_platformer, puzzle
**Realised by:** tile_grid_collision, lfsr_random, jump_table_dispatch, oscar64/tile-grid-collision, oscar64/lfsr-random
**Sources:** Jamey Pittman, The Pac-Man Dossier (Game Developer, 2009); Andrew Braybrook, Birth of a Paradroid, Zzap!64 (1985); Chris Crawford, The Art of Computer Game Design (1984)

**Checks:**

- At each junction, find the direct chaser took the open non-reverse exit whose next cell is nearest the player's cell by the game's distance rule.
- Move the player and find the ambusher's target cell ahead of the player's cell in the player's direction, never on it.
- Bring the shy type within its threshold distance and find its target equal to its own corner cell.
- Switch from scatter to chase and find every chaser's direction byte reversed on the frame it next enters a cell.
- Drive a patrolling robot into a junction cell and find its position unchanged for its pause count of frames.
- Close a door on a robot's route and find the robot never occupies a cell beyond it while it is closed.

### Why

Crawford's 1984 list of ways to balance a game against one player has four entries: vast
resources, artificial smarts, limited information and pace. Vast resources means many opponents
with rudimentary intelligence (Space Invaders, Missile Command, Asteroids, Centipede, Tempest); he
calls it by far the most used method and the easiest, and on an 8-bit machine it is the honest
default. What lifts it is distinct behaviour per type at near-zero cost, and the cheapest distinct
behaviour is a different target.

### The shape

Pittman's disassembly-checked account of Pac-Man is the canonical case: one chase routine and four
target rules.

```
type      target while chasing                                 reads as
direct    the player's own cell                                pursuer
ambusher  four cells ahead of the player, in the player's      cuts you off
          direction of travel
flanker   two cells ahead of the player, then that vector      erratic
          from the direct chaser's position, doubled
shy       the player's cell when more than eight cells away;   circles, retreats
          its own corner when nearer
```

Each type also has a fixed corner cell it targets in scatter mode and can never reach, so it
circles there. A timer alternates scatter and chase. Pittman's table: on levels one to four the
first two scatter periods are seven seconds and the last two five; from level five every scatter
period is five seconds; the first two chase periods are twenty seconds each; after the fourth
scatter the chase does not end. Every mode change forces a direction reversal, the tell the player
learns to read.

Braybrook's robots in Paradroid are the other 8-bit model. His diary for 5 June 1985 plans a
network of invisible roads and junctions, some robots as sentries and others on the beat. On 26
June they were following their courses and shuddering at corners; on 27 June they paused at
junctions as if looking around and waited for doors to open before going through. The pause and
the wait are what read as thought. The same entries record that at full speed the robots drifted
off their routes and were nearly impossible to shoot, so some were slowed.

Per type the table is small: target rule index, speed, junction pause in frames, threshold
distance for the shy rule, and a flag for waiting at doors.

Crawford's test for the result: reasonable yet unpredictable. Reasonable means no obviously stupid
move, and he warns against enumerating stupid moves one by one; write the general rule instead.
Unpredictable means the player cannot second-guess it, and he observes that algorithms which weigh
one thing (nearest enemy, fire) are the predictable ones. Two inputs per decision, a target and a
timer or an `lfsr_random` pause, are enough to pass.

### What breaks when it is skipped

Four enemies with one target rule are one enemy four times; the player finds the loop that beats
it in a minute. Robots that never pause read as bullets, and robots at bullet speed cannot be
shot, which Braybrook found on the first day they worked.

Related: `./game-design-patterns.md` ("Path-based vs reactive AI"), `./c64-game-archetypes.md` (`top_down_adventure`, `action_puzzle`), `./game-structure.md` (a level's end condition).

---

## attack_pattern_tables — Entrances, dives and aim as data

**Kind:** structure
**Applies to:** vertical_shmup, horizontal_shmup
**Realised by:** wave_director, object_pool, sine_table_generation, actor_activation_window, oscar64/wave-director, oscar64/object-pool, kickassembler/sine-table-runtime, atan2_8bit, kickassembler/sqrt-atan2
**Sources:** Retro Game Deconstruction Zone, Metamorphosis: From Galaxian to Galaga (2020, author unnamed); Lasse Öörni, Rant 4 (undated); John and Steve Rowlands, Let's Make a Monster part 8, Commodore Format (1993)

**Checks:**

- Run stage one with the player firing from a fixed column and find at least one entrant of each wave destroyed before any reaches its formation slot.
- Read every dive segment in the path table and find no per-frame step larger than the stage's declared maximum.
- Fire an enemy shot with the player to its left and find the shot's X velocity negative; to its right, positive.
- Compare consecutive stage records and find the simultaneous-attacker cap never decreases.
- After the spawn script places a wave, find no later write to those slots from the script; only the actors' own state handlers change them.
- Hold the scroll position and find no wave triggers a second time.

### Why

A shooter's enemies are choreography, and choreography is data. The Galaga analysis makes three
observations that transfer to any fixed or scrolling shooter: the aliens enter gradually and can
be shot before they reach formation; their dives are smooth, slow enough to be hit and fast enough
to be missed; and shots that lean toward the player, more concentrated than in Galaxian, look
aimed. It describes a handful of entrance patterns and eight distinct bonus rounds (Galaga's
challenging stages), the last first seen after stage 30, and gives no per-stage escalation figures.

### The shape

Four tables and one hand-over. An entrance table per stage: pattern id, enemy type, count, and the
frame or scroll position at which the group is released. A path table of (dx, dy, frames)
segments, which is the path bytecode `wave_director` runs, with curves from
`sine_table_generation`. A stage record: simultaneous-attacker cap, dive interval, shot interval,
aim bias. A formation map: which slot each entrant flies to and holds.

The hand-over is the part generated shooters miss. The spawn script puts an enemy into a slot with
a type, a position and a starting state; from then on the actor's own state byte drives it and the
script never touches the slot again (that last rule is this page's own, not measured here). Rant 4
keeps the same boundary in a scrolling world: level data holds only type and position, the rest
belongs to the live actor. The Rowlands' diary describes theirs: monster maps laid over the
background layout, and a sequencer placing creatures at set coordinates with a speed and direction.

Aim bias is one byte of the stage record: the fraction of shots whose X velocity takes the sign of
the player's X minus the shooter's X. At zero the fire never threatens; at full a still player is
always hit and learns to twitch. Tune a middle value in playtest.

Escalation by cap rather than by logic: raising the attacker cap and shortening the dive interval
per stage makes later stages harder with no new enemy code. That is this page's reading of the
Galaga material, not a figure from it, and not measured here; it is a data change, easy to undo.

### What breaks when it is skipped

Enemies released on a frame timer instead of a scroll position drift from the scenery they were
placed against. A dive faster than the player's shot cannot be hit. A spawn script that keeps
steering its enemies is a second state machine fighting the first.

Related: `../techniques/logic.md` (`wave_director`, `object_pool`), `../recipes/oscar64/wave-director.md`, `../recipes/oscar64/simple-shmup.md`, `./c64-game-archetypes.md` (`vertical_shmup`, `horizontal_shmup`).

---

## difficulty_ramp — Level tables, new problems, a floor and a cap

**Kind:** behaviour
**Applies to:** vertical_shmup, horizontal_shmup, single_screen_platformer, scrolling_platformer, top_down_adventure, puzzle, action_puzzle, sports, racing, beat_em_up
**Realised by:** logic_rate_decoupling, pal_ntsc_detection, lfsr_random, wave_director, kickassembler/logic-rate-decoupling, oscar64/pal-ntsc-detect, difficulty_ramp_tables, oscar64/difficulty-tables, seeded_level_fill, oscar64/seeded-level-fill
**Sources:** Jamey Pittman, The Pac-Man Dossier (2009); Jeff Minter, interviewed by John Blackford in COMPUTE!'s Gazette (August 1983); John and Steve Rowlands, Let's Make a Monster parts 6 and 8, Commodore Format (1993); Andrew Braybrook, Birth of a Paradroid, Zzap!64 (1985); Shmups Wiki, Gradius library page (undated); Chris Crawford, The Art of Computer Game Design (1984)

**Checks:**

- Read the level table's row for the highest level the game can reach and find it a real row, not bytes past the table's end.
- Compare the rows for levels 1 and 2 and find a difference in a type, count or hazard column, not only in a speed column.
- Read the top enemy speed in the table and find it below the value at which the player's shot can no longer cross the enemy's hitbox in one frame.
- Play until a rank counter has had every input maxed and find it equal to its cap, never above.
- Run the same input script under PAL and under NTSC and find the rank counter equal after the same number of logic ticks.
- Walk every screen of every level and find no screen with zero placed enemies.
- Replay the recorded level-1 input script with the starting weapon and find the level-complete flag set and the damage counter zero.

### Why

A ramp made of one column is a ramp the player reads in two levels. Minter said in 1983 that the
later levels of Attack of the Mutant Camels were made harder by adding new problems rather than by
speeding up the action, and that enemies were added to punish tactics found in Gridrunner: the
Traitorous Humanoid exists to stop a player sitting still. Crawford's test for the whole curve is
the plot of a player's score against time spent: it should slope up smoothly; one sharp jump means
there is one trick.

### The shape

A level-indexed table, one row per level, one column per knob (enemy speed, spawn interval,
maximum active, new type introduced, end condition), and a rule that the last row is held rather
than read past. Pittman's Pac-Man tables are the model: on level 1 the ghosts run at 75 % of top
speed, the player at 80 %, frightened ghosts at 50 %; from level 5 the ghosts are at 95 %, the
player at 100 %, frightened ghosts at 60 %; the frightened time shrinks level by level until on
level 19 the ghosts stop turning blue at all; from level 21 the player slows to 90 % while the
ghosts do not. Speed is one column. The others (frightened time, dot thresholds for release,
scatter duration) change what the problem is, which is Minter's rule in table form.

Density has a floor as well as a ceiling. The Rowlands wrote in part 8 that a sprinkle of enemies
makes a level too background-orientated and gives it an empty feel, while the hardware forbids too
many; they called it a fine line between a possible level and a playable level. Part 6 gives their
ceiling: fifteen monsters on screen, because eight sprites per raster line minus the three Mayhem
uses leaves five per line for enemies. Their floor is a judgement, not a number, and the check
above asks only that it is never zero.

Fairness is a rule, not a feeling. Braybrook's rule of 26 June 1985: when the player cannot
reasonably finish the job, the fault is the game's, and the cure is a gentler level or a stronger
gun. His decks also ramp by capability rather than speed: on 29 July he noted that the weak robots
on the easy decks do not fire and the big ones do.

The invisible rank counter is the period alternative to rubber banding. The Shmups Wiki gives
Gradius's Japanese formula as the sum of survival frames divided by 1000, stages completed times
three, a power-up value, options times two and a difficulty setting, the whole halved and capped
at 15; the US Nemesis version weights the terms differently. The page does not say what rank
changes in play, so nothing about its effect is claimed here. The shape is what matters: a handful
of additive counters the player never sees, a shift, and a small cap. It rises with success rather
than falling with failure, and it is a byte, not a system.

Frame rate is part of the table. Anything that counts frames ramps a fifth faster on NTSC. Read
"60 Hz vs 50 Hz update rate and cross-region releases" in `./game-design-patterns.md` and either
count logic ticks through `logic_rate_decoupling` or hold two tables selected by
`pal_ntsc_detection`.

### What breaks when it is skipped

A speed-only ramp has a wall where the enemy outruns the player's shot, and nothing before the
wall taught anything new. A rank counter without a cap climbs until the game is unplayable on one
credit, and one that resets to zero on death gives the losing player the easiest game.

Related: `./game-design-patterns.md` (60 Hz vs 50 Hz), `./game-structure.md` (level end and game over), `../techniques/logic.md` (`logic_rate_decoupling`), `../techniques/raster.md` (`pal_ntsc_detection`).

---

## playtest_protocol — Evaluate before coding, test with strangers, schedule the balance

**Kind:** production
**Applies to:** vertical_shmup, horizontal_shmup, single_screen_platformer, scrolling_platformer, top_down_adventure, puzzle, text_adventure, action_puzzle, sports, racing, beat_em_up
**Realised by:** lfsr_random, joystick_edge_detect, kickassembler/headless-verify, oscar64/headless-verify, oscar64/lfsr-random
**Sources:** Chris Crawford, The Art of Computer Game Design (1984); Jeff Minter in COMPUTE!'s Gazette (1983) and in his B3TA interview (undated); Codebase64 guide to programming games (unattributed, wiki); Andrew Braybrook, Birth of a Paradroid, Zzap!64 (1985); Willem Elbers, Armalyte at Hardcore Gaming 101 (2023)

**Checks:**

- Run the same seeded input script twice and find the same score and the same frame of death.
- Idle for ten thousand logic ticks and find every capped counter at or below its cap.
- Drive the player straight at the level exit without meeting the exit condition and find the level still running.
- Press every key on the build given to testers and find no debug or level-skip action fires.
- Search back from each death and find the killing object on screen for at least the reaction window the design states.
- Compare the tester build with the release build and find them equal apart from the version byte.

### Why

Crawford's design sequence puts an evaluation pass before any code: check that the game structure
keeps every value within reasonable upper and lower bounds (his example is money, and he allows a
brute-force clamp as a last resort); probe for unanticipated shortcuts to victory and block them
unobtrusively, so the player never notices being shepherded; then decide to abort or proceed,
because a design dropped now costs nothing and one dropped after coding costs everything.

### The shape

Two stages of testing, in Crawford's account. The first is the author's own, in the last stage of
debugging, and should remove every program bug and many game-structure bugs. The second hands a
bug-free build to outside testers, who should find only game-structure bugs; an early build
contaminates their objectivity. Never more than five or six testers, chosen for experience with
games rather than grabbed from among friends. A short manual, about a week alone with the game,
then a long interview with the same questions for everyone, without leading and without soliciting
praise.

Minter's version is cheaper and wider: he took the game to computer shows and let children play
it, reasoning that players find the bugs a coder cannot; his own habit was to grow a game in many
small increments. Asked on B3TA what makes a good game, he named three things: balance, the
learning curve's shape, and feedback the player can trust; a death the player thinks unfair fails
the third. That is the test for every death: was the killing thing visible, and was there a move
that would have survived it.

The Codebase64 guide's advice is narrower than often summarised: trusted friends and contacts,
preferably not in cracking groups, so a buggy build does not reach the scene. It gives no tester
count.

Braybrook's diary shows the roles in 1985: a chief test pilot, Robert, returning comments within
days in early May; the publisher, Gordon Hewson, suggesting on 30 July that a destroyed host robot
should eject the player with low energy rather than end the game, and on 14 August, after handling
changes, posting his best score. A design change from a tester's play, with its date, is what a
tester log looks like.

Balancing is a phase, not a week. Elbers' Armalyte history gives nine months of development, with
time spent on level design, enemy placement, general playtesting and balancing. Put a named
balancing phase on the schedule after content is complete, and expect the level tables above to
change in it.

### What breaks when it is skipped

A runaway value found after release is a design fault that was cheap to catch on paper. A shortcut
to victory found by a tester on day one means the level tables were never played. A game balanced
only by its author is balanced for the one person who cannot be surprised by it. A headless
harness can run the first stage's mechanical part and cannot run the second; the `headless-verify`
recipes give the invocation.

Related: `./game-structure.md`, the difficulty_ramp pattern above, `../recipes/kickassembler/headless-verify.md`, `../recipes/oscar64/headless-verify.md`, `../runtime/vice-reference.md`.
