---
category: logic
---

<!-- doc-type: technique-reference -->

# Logic Techniques

Game rules that run on the CPU against data the renderer already holds:
collision against a tile map, and the state that follows from it. Nothing
here touches a VIC-II collision register; the hardware ones are
`sprite_collision_detect` in `sprite.md`. Every number below that came
from an instrument says so; the rest is marked as arithmetic or as not
measured here.

---

## tile_grid_collision — Tile-grid collision against a decoded map

**Complexity:** medium
**Region:** both
**Requires:** tile_map_render
**Cost:** cycles_per_frame=2345
**Cost basis:** measured-vice

### Why

A platformer's floors, walls, ceilings and ladders are characters on the
text screen, and the player is a sprite. The VIC-II can report that a
sprite overlaps foreground pixels (`$D01F`), but not which cell, from
which side, or whether the cell is a floor to stand on or a ladder to
climb. The game has to answer that itself, from the map it decoded at
level start, and it has to answer it every frame for every moving actor
within the frame budget.

### How

The map is one byte per tile in RAM, indexed `map[row * MAP_W + col]`:
the array `tile_map_render` fills at level start (its step 2), or the
same array decoded from any other source. The test reads that array,
never screen RAM, so the map can be wider than the screen and the HUD
can overwrite cells without becoming walls.

1. **Body, not sprite.** Choose the box inside the 24 x 21 sprite that
   is the actor: the recipe uses columns 8 to 15 and rows 0 to 20. Every
   test is on points of that box.
2. **Pixel to tile.** A body point at screen pixel `(x, y)` is in tile
   column `(x - 24) >> 3` and screen row `(y - 50) >> 3`, because sprite
   coordinate 24, 50 is the top-left visible text pixel (settled in
   `hardware/vic-ii-reference.md`; the recipe keeps world coordinates
   with the 24 and 50 already removed). Subtract the map's first screen
   row to index the array. Outside the map, answer empty above and solid
   to the sides and below, so nothing can leave.
3. **Probe spacing.** Test points along an edge no further apart than a
   tile. A 21-pixel edge crosses up to four tile rows, so the side edge
   is probed at 0, 8, 16 and 20 pixels from the head; two corners alone
   miss a single tile between them. The 8-pixel-wide body's top and
   bottom edges need only their two corners.
4. **Horizontal first.** Move one step sideways, probe the leading edge
   at the new x against the current y. A solid probe cancels the move
   and sets the wall flag.
5. **Ladder.** A ladder is a tile class. The actor is on a ladder when
   the tile at the centre column of its feet, or one pixel below them,
   is one. While on a ladder and pressing up or down, move one pixel,
   hold the vertical velocity at zero and skip gravity. The climb up
   ends when the feet leave the last ladder tile, which puts them one
   pixel above it; the top rung counts as standable from above (a
   ladder tile with no ladder over it), so the actor can stand on it,
   walk off it and climb down into it.
6. **Ground test.** Otherwise ask whether either foot corner has a
   standable tile one pixel below it. Yes: velocity zero, a jump may
   start. No: this is a pit or a platform end, and gravity applies.
7. **Vertical move and snap.** Add the velocity, capped below one tile
   a frame so the feet cannot cross a tile without ending inside it.
   Falling: if either foot corner is now in a standable tile, put the
   feet on the pixel row above its top, `((y + h) & ~7) - h - 1` for a
   body `h + 1` tall, and clear the velocity. Rising: if either head
   corner is in a solid tile, put the head on the row below it,
   `(y | 7) + 1`, and clear the velocity.
8. **Events last.** A landing is the ground test turning true, not the
   snap: a fall can end exactly on the boundary, feet on the last pixel
   above the tile, and the snap never runs.

### Why it works

The screen's character grid is the collision grid: a tile is 8 x 8
pixels because a character cell is, so the pixel-to-tile conversion is a
shift and the whole test is a handful of array reads and compares per
probe. Snapping to a tile edge is a mask because the edges are at
multiples of 8. Holding the fall under one tile a frame is what makes a
single test at the new position sufficient; a faster fall would need the
rows between the old and new feet tested as well. The ladder rule works
because the tile class carries the permission: no code decides where
ladders are, the map does.

### Variations

- **Pixel versus corner tests.** The corner (and edge-probe) form above
  reads the tile class only. A pixel form goes on to the character's
  bitmap row for a probe inside a tile that is not fully solid (a ramp,
  a half-height step). It costs a character-ROM or charset read per
  probe and a mask; the tile form is the one to start with.
- **16-pixel tiles.** A 2 x 2 metatile map (`tile_map_render`) can be
  tested at metatile granularity, `>> 4`, with the mask `& ~15`, when
  every metatile is uniformly solid or empty; a metatile with a solid
  top half and an empty bottom half has to be tested at character
  granularity through its metatile table.
- **One-way platforms.** A tile class that is standable only when the
  feet were above it last frame: solid in the falling foot test, ignored
  in the rising head test and in the side probes. The ladder top in the
  recipe is a one-way platform in this sense. Not built in the recipe.
- **Scroll offset.** For a scrolling map, add the scroll position in
  pixels to the sprite's world position before the shift; the map array
  is indexed in level columns, not screen columns.

### Cycle budget

Measured in VICE x64sc 3.10 with a CIA1 timer B harness around the
recipe's `player_update`, interrupts masked, Oscar64 `-O2`, one actor
(rung 1): worst frame 2,345 cycles, best frame 604 (standing still, no
move). The figures are identical on PAL and NTSC because the update runs
inside the vertical blank after `vic_waitFrame()` and no badline falls in
it; an earlier build whose timed region included the asserts ran into
the NTSC badlines and read 3,863 there. The worst frame has four side
probes, two foot probes, the ladder tests and a snap, each probe a
bounds check, a 16-bit index and a load. At 2,345 cycles one actor is
about 12% of a PAL frame; eight actors of this shape do not fit
alongside a scroller, which is where the `self_modifying_code` and
`zero_page_burst` entries in the platformer fingerprints come in. The
asserts and the HUD are outside the timed region and are not part of
the figure.

### Recipes

- `recipes/oscar64/tile-grid-collision.md`
- `recipes/oscar64/platformer-scaffold.md` — the corner probes, landing snap and head bump inside a whole single-file platformer, with ladders; the page to copy when starting a game

## object_pool — Fixed-slot object pool for enemies, bullets and effects

**Complexity:** low
**Cost:** cycles_per_frame=380
**Cost basis:** measured-vice

**Why.** A game spawns and kills enemies, bullets and explosions all the
time, and it has no heap worth the name: eight sprites, a few hundred
bytes of zero page, and a frame budget that must not vary with how many
things are alive. A fixed pool of slots, allocated by finding a free one
and freed by marking it, keeps the cost bounded and the sprite mapping
static.

**How.** Hold the objects as parallel arrays, one per field (state, x,
y, type, timer), indexed by slot. State 0 means free. To spawn, scan for
the first zero and fill the fields; if none is free, refuse. To kill,
write 0. Tick every slot once a frame: move it, test it against the
screen edges, count its timer down, and free it when it leaves or
expires. A wave table drives the spawns: each entry says when, how many
and where. Bind slot n to hardware sprite n so the pool's index is the
sprite number and no remapping is needed.

**Why it works.** Parallel arrays let the 6502 address each field with
one indexed instruction, `LDA state,X`, where an array of structs would
need a multiply or a pointer walk. A scan over eight slots is a short
fixed loop, and the worst case, a full pool, is a known number rather
than a heap search.

**Variations.** A free list (a stack of free slot numbers) makes
allocation constant time at the price of a push on every free. Two pools
with different sizes, one for enemies and one for shots. A generation
counter per slot so a stale reference cannot revive a reused slot.

**Cycle budget.** Measured on the recipe with CIA1 timer A over one
hundred calls: the update pass over eight active slots costs 380 cycles,
over none 106; a scan allocation costs 27 with slot 0 free, 64 with slot
3 free and 124 when the pool is full and refuses; a free-list pop and
push together cost 44; a spawn plus despawn 146. The Cost line carries
the update pass with all eight slots live, which is the per-frame figure.

### Recipes

- `recipes/oscar64/object-pool.md` — eight slots, scan allocator, wave table, scripted spawns and despawns checked against a Python checksum, with the cycle harness on screen
- `recipes/oscar64/platformer-scaffold.md` — six enemy slots in parallel arrays fed by a wave table and an LFSR, despawn off screen, inside a whole single-file platformer

## actor_activation_window — Level-placed actors that wake near the view and return to the level table

**Complexity:** medium
**Requires:** object_pool
**Cost:** cycles_per_frame=2809
**Cost basis:** measured-vice

**Why.** In a scrolling platformer or adventure the level designer puts
each enemy, item and door at a place in the level. The level is far
wider than the screen and holds more actors than the game can run at
once. An `object_pool` alone despawns an actor when it leaves the screen
and forgets it, so a killed guard comes back and a wounded one heals.
Spawning from a timer cannot put an enemy where the map says. The actors
have to live in the level data while they are far away, and only the
ones near the view may take a slot.

**How.**

1. **The level actor table.** One entry per placed actor, as parallel
   arrays: position in blocks (a column, or a map block of several
   columns), row, type, and the state that must survive: hit points and
   a flag byte. The flag byte holds facing, a *live* bit (the actor is in
   a slot now) and a *dead* bit.
2. **The activation window.** The view plus a margin on each side, in
   the same block units as the table. Each tick, work out its bounds once
   from the camera and clamp them to the level.
3. **Scan a slice, not the table.** Each tick examine K entries from
   where the last tick stopped, wrapping at the end. An entry that is
   neither live nor dead and lies inside the window takes a free slot
   from the pool: copy its state in, set its live bit. If no slot is
   free, leave it; the next lap tries again.
4. **Drop what left.** Each tick test every live slot against a drop
   window a little wider than the activation window. An actor outside it
   goes back: write its block position, hit points and facing into its
   entry, clear the live bit, free the slot. The extra width stops an
   actor on the edge being dropped and woken on alternate ticks.
5. **Kill by flag.** A killed actor sets its entry's dead bit and frees
   its slot without writing a position. The scan skips dead entries for
   the rest of the level.
6. **Draw relative to the camera.** A live actor's sprite X is its world
   x minus the camera x plus 24. That runs past 255 in the right part of
   the screen, so the ninth bit goes in `$D010`.

**Why the margin must exceed the scroll step.** With N entries and K
examined per tick, an entry is looked at every N/K ticks. In that time a
camera moving S blocks a tick moves S × N/K blocks. An entry just outside
the window when it is examined can be that much closer at its next look.
So a margin of S × ⌈N/K⌉ blocks is enough to wake every actor before
it is in view, for any layout (arithmetic). It is not the least. When
the scan runs before the draw in the same tick, the entry is examined
again on the tick it would first be in view, and S × (⌈N/K⌉ − 1) blocks
is enough. Add one block when the camera's step is not a whole number
of blocks. In the recipe, N = 32, K = 8 and S = 2 columns (16 pixels) a
tick: 8 columns is safe and 6 is enough. A Python model of the scan over
adversarial layouts gives a worst of 15 pop-ins at margin 5 and 0 at
margin 6 (rung 3, a model; not run in VICE). Measured in the recipe:
0 pop-ins with a margin of 8, 37 with a margin of 1. A smaller margin
shows as an enemy that appears already on screen. A larger one costs
slots: the pool must hold every actor in the widest window, so the
densest stretch of the level sets the pool size.

**Why it works.** The table is the only record of an actor while it is
far away; a slot is a working copy. Because the copy always goes back
before the slot is freed, the table is correct whenever the actor is not
live. The live bit stops the scan waking an actor twice. The dead bit
costs no memory beyond the flag byte and keeps the table's indices
stable, so a save or a level-state record can refer to an entry by
number. Position goes back in blocks, so sub-block position is lost:
the recipe's actor woke at `column × 8` pixels, up to 7 pixels from where
it was left.

**Variations.**

- **Sorted by x with a cursor.** Keep the table sorted by block x and
  move two cursors with the window's edges. Each tick then looks only at
  entries crossing an edge, and the latency argument above goes away. An
  actor that moves and is written back at a new x can break the order;
  either re-sort it into place on write-back or keep its placed x as the
  sort key (not measured here).
- **Several levels or zones in one table.** c64gameframework keeps 96
  entries, each with an origin byte (level data, global or temporary,
  plus a level number) and a zone byte. It wakes only entries of the
  current level and zone, and scans 24 a frame
  (`actor.s`, `defines.s`; read, not run). The Cadaver scroll article
  describes 16-bit positions whose high byte is the map block, so the
  window test compares high bytes only, and about 16 entries checked per
  frame (not measured here).
- **Bounds patched into the code.** The same source writes the window
  bounds into the immediate operands of the scan's `CMP` instructions once
  a frame, so each compare is two cycles.

**Cycle budget.** Measured in VICE x64sc 3.10 with CIA1 timer A over 20
calls, on the Oscar64 -O2 recipe, identical on PAL and NTSC: a slice of 8
entries, none waking, 420 cycles; all 32 entries in one loop 1,153; the
drop pass over 8 live actors 529; window set-up, slice and drop pass
together 1,076, an average over the 20 timed calls with nothing waking
or dropping; one wake plus one drop 264. An ordinary scrolling tick
that wakes one actor and drops one costs about 1,076 + 264 = 1,340
(arithmetic). The worst tick wakes all K = 8 entries of its slice, then
runs the drop pass over 8 live: 2,809 cycles, measured, and that is the
Cost line. Wakes plus drops in one tick cannot exceed the 8 slots, and a
tick that drops 8 and wakes none measured 1,850, so waking is the heavy
case. The recipe's first tick wakes 6. Hand-written assembly
would cost less; the C figures are an upper reference, not a target.

### Recipes

- `recipes/oscar64/actor-activation-window.md` — 32 placed actors in a 256-column level, 8 slots, a camera out at 16 pixels a tick and back at 8, two kills and a hit that survive, a pop-in check with margins 8 and 1, a Python-checked table, scan costs on screen, PAL and NTSC

### Sources

- https://cadaver.github.io/rants/scroll.html (Cadaver: 16-bit positions
  with the map block in the high byte; about 16 level entries checked per
  frame; not measured here).
- https://github.com/cadaver/c64gameframework (MIT): `actor.s`
  (`AddActors`, `LVLACTSEARCH` = 24, window bounds patched into `CMP`
  operands), `defines.s` (`MAX_LVLACT` = 96). Read for facts; no code is
  taken from it.

## logic_rate_decoupling — Game logic at half the display rate, with interpolation and frame skip

**Complexity:** medium
**Region:** both
**Uses registers:** D000, D011, D012, D019, D01A
**Requires:** frame_sync_loop
**Cost:** cycles_per_frame=384, irq_slots=1
**Cost basis:** measured-vice

### Why

`frame_sync_loop` runs one logic step per frame and, when the work
overruns, can only count the frames it missed; the game slows down with the
display. Once a game has many actors, a scroller and a multiplexer, the
logic stops fitting in a frame. Shipped games solved it by running the
logic every second frame (25 Hz on PAL) and drawing every frame (50 Hz),
with sprite positions interpolated on the frames between logic steps. Cadaver
describes this for Metal Warrior 4, and his c64gameframework README states
"50Hz screen update, with actor update each second frame and interpolation
of sprite movement" (sources below; not measured here). The display stays
smooth, the logic gets two frames of time, and the game keeps its speed
when a step overruns.

### How

1. **Two rates, two owners.** A raster interrupt below the display counts
   display frames and, every second frame, adds one to an `owed` counter.
   The main loop runs the logic: it waits until `owed` is not zero, then
   runs ticks, taking one off `owed` per tick with a single `DEC`. The
   interrupt owns the frame count, the logic owns the tick count.
2. **Frame skip with the speed counter.** When a tick ends and `owed` is
   still not zero, run the next tick at once and do not publish in
   between. Game time then equals half the display frames however long a
   tick took; the display drops the positions it had no time to show.
   Cadaver's form of the rule: if the last render was N frames ago, run
   the logic N times before rendering again.
3. **Interpolate positions, never state.** The logic keeps every game
   variable at its own rate. Before moving an actor it copies the position
   to a previous-position field. The display needs only the two positions
   per actor. On the first display frame after a tick it shows the
   midpoint; on the next it shows the new position. c64gameframework does
   the equivalent: it draws the actors, runs the update, then adds half of
   each actor's movement to the drawn sprites for the in-between frame.
4. **Double-buffered sprite table.** The logic writes the previous and new
   positions into the half of a two-half table the display is not reading,
   then sets a `ready` index and, last, a `fresh` byte. The display update
   takes the fresh half at its next frame. The logic does not write again
   until `fresh` is clear, so the display never draws a half-written table.
   One byte hands the table over, so no `SEI` is needed.
5. **Re-entrant update interrupt.** The interrupt acknowledges `$D019`,
   does the timekeeping, increments a `busy` byte, and only at 1 runs
   `CLI` and the display update; at 2 it leaves at once. The raster-exact
   interrupts underneath (splits, the multiplexer, music) can then fire
   during a long update, and a second entry cannot start a second update on
   the same data. The timekeeping runs before the guard, so a frame the
   update missed still counts and still owes its tick. Cadaver's article shows
   the same shape: an `INC` of a counter, a compare with 2 and a skip,
   and colour-RAM writes kept after the bottom interrupt.

### Why it works

The 6510 finishes an instruction before it takes an interrupt, so a `DEC`
or `INC` on one byte cannot be split between the loop and the handler, and
a one-byte flag is read and written whole. That is enough to keep the two
clocks apart without masking interrupts. The midpoint of two unsigned
bytes is exact with `CLC`, `ADC`, `ROR`, because the carry holds bit 8 of
the sum. Writing the sprite registers from an interrupt below the lowest
sprite means the beam has already drawn every sprite of the frame, so no
sprite is drawn with half its new position. The registers stay on the
KERNAL's stack frame (`$FF48` pushes A, X, Y; `$EA81` pulls them), so a
nested entry corrupts nothing.

### Variations

- **Logic every fourth frame.** More time per step, and larger jumps to
  interpolate. Cadaver says four-frame interpolation "feels indeed quite
  lagged" (not measured here).
- **Scroll in the update.** In a scroller the fine scroll still moves every
  display frame, and the interpolation adds the scroll offset to each
  sprite. c64gameframework adds both in the same pass.
- **Interpolation off per actor.** An actor that teleports or spawns must
  not be drawn half-way from its old slot. c64gameframework marks this with
  a flag in the previous position.

### Cost and when not to use it

Measured in VICE x64sc 3.10 with CIA1 timer B around the display update of
`recipes/kickassembler/logic-rate-decoupling.md` (rung 1): 384 cycles on a
midpoint frame for eight sprites, the table pick and the interpolation
loop, identical on PAL and NTSC. The instruction table gives the same
count: 49 cycles for the call and the pick, 42 per sprite. The IRQ's
timekeeping and guard add about 67 cycles more by the instruction table
(80 while the event checks run; rung 3, not timed), and the KERNAL IRQ
entry and exit about 58 more, so the IRQ side is near 510 cycles a frame. Memory is
a table of two halves, each holding a from and a to byte per sprite per
axis, and a previous position per actor.

Do not use it when:

- **The game is a fast action game that runs its logic at 50 Hz already.**
  Half-rate logic halves the rate at which collisions and input are
  sampled. A bullet moving 8 pixels a frame moves 16 per tick, and a
  collision test that ran every frame must now test the whole path.
- **Input latency matters.** Measured in the recipe: an input raised on
  the frame that owes a tick showed 1 frame later; one raised on the other
  frame showed 2 frames later (PAL). By arithmetic, an input that arrives
  just after a tick has sampled it waits for the next tick, two frames on,
  and is drawn one frame after that: 3 frames, against 2 for one logic step
  per frame. The first frame shows only half the move.
- **It fits.** If the logic fits in a frame, `frame_sync_loop` is simpler
  and has less latency.

On NTSC the display is 60 Hz and the logic runs at 30 Hz, so game speed is
20% higher unless the tick advances less (`pal_ntsc_tempo_mismatch`).

### Recipes

- `recipes/kickassembler/logic-rate-decoupling.md` — eight sprites, logic every second frame with an overrunning tick every eighth, midpoint interpolation, a double-buffered table, a re-entrant update with one forced guard trip, latency and step records, and a PASS/FAIL check that ticks equal half the frames, PAL and NTSC

### Sources

- https://cadaver.github.io/rants/interp.html (Cadaver, interpolation,
  frame skip and the re-entrant update; also codebase64 `base:rant9`).
- https://github.com/cadaver/c64gameframework (MIT): README, `raster.s`
  (the update interrupt), `actor.s` `InterpolateActors`. Read for facts;
  no code is taken from it.

## wave_director — Attack waves triggered by scroll position, with path bytecode per enemy

**Complexity:** medium
**Requires:** object_pool
**Cost:** cycles_per_frame=3188
**Cost basis:** measured-vice

**Why.** A scrolling shooter is built from attack waves: a group of enemies
that enters at a set place in the level, flies a set path and leaves. The
`object_pool` recipe spawns from a table keyed by frame and moves every
object in a straight line. That is not enough for a shooter. The level
designer places each wave against the scenery, so the trigger must follow
the scroll. Enemies need curved entry and exit paths, one wave needs
several enemies spaced in time, and the game needs to know when a wave was
destroyed whole.

**How.**

1. **The wave list.** One record per wave, sorted by trigger position:
   the scroll position (16 bits for a long level), the enemy type, the
   count, the spacing in frames between spawns, the path id and the
   formation (a start x and an x step per enemy, or a table of offsets).
2. **The cursor.** Each frame, after the scroll moves, compare the scroll
   position with the record under the cursor. While it is due (`>=`,
   never `==`), start it and move the cursor on. Sorting makes the idle
   case one compare.
3. **The spawner.** A started wave hands its count and spacing to a
   spawner, which takes one slot from the pool every `spacing` frames
   until the count is spawned. A game that lets waves overlap in time
   keeps two or three spawners.
4. **Paths as bytecode.** A path is a byte string shared by every enemy
   on it. MOVE n, dx, dy moves n frames at that velocity. Control opcodes
   take no frame: FIRE, LOOP count and target, END. Each enemy holds a
   path id, a program counter, the steps left, its velocity and a loop
   counter. Each frame the interpreter fetches while the steps left are 0,
   then adds the velocity. A plainer form is a delta table of (dx, dy)
   pairs, one per frame, which costs more bytes and no fetch logic.
5. **Exit.** An enemy leaves when its path reaches END or its position
   crosses a screen edge. Either frees its slot.
6. **Wave accounting.** Count each wave's live and killed enemies. When
   the last one goes and the spawner has finished that wave, it is over:
   all killed earns the wave bonus, otherwise it escaped.
7. **Difficulty by loop.** When the list runs out and the level ends,
   reset the scroll and the cursor and count a loop. Scale by the loop
   counter: shorter spacing, faster velocities, more shots.

**Why keyed to scroll position.** The scroll can stop for a boss, slow on
a climb, or run faster later. A frame-keyed wave then meets different
scenery each time. A position-keyed wave waits: in the recipe the scroll
holds for 50 frames, and the three waves after the hold start 50 frames
late and each at its exact position (measured in VICE). The `>=` compare
with a loop means a scroll of several positions a frame starts every
wave it passes, in order. Corescape keeps one wave id per level block
of four tile rows and starts it when the scroll brings a new block in
(`display.cpp`, `enemies.cpp`; read, not run).

**Why it works.** Parallel arrays and one shared interpreter keep the
per-enemy state to a few bytes and the per-enemy cost to a few adds on
most frames; the fetch runs only when a segment ends. Paths as data let a
designer change a wave without touching code. With the position held in
bytes, one compare per axis against 250 catches every edge, because a
byte that goes below 0 wraps to 255. The cost of that choice is a
playfield of sprite X 0 to 249 with `$D010` held at 0
(`sprite_x_high_bit_wrong_register`); a full-width game carries a ninth x
bit per enemy and writes `$D010` from it.

**Variations.**

- **Compile-time path tables.** Corescape builds entry and exit curves
  as tables at compile time with Oscar64 `#for`, for example a 32-entry
  parabola, (31 - i)² / 10 (`enemies.cpp`; read, not run). A table
  costs a byte or two per frame of path against 3 bytes per MOVE segment.
- **Behaviour switched by a hit.** Iridis Alpha's per-level record is 40
  bytes, with movement pattern and rates, a pull toward the player, a
  spawn rate, and pointers to the wave data to switch to when an enemy is
  first hit (mwenge disassembly; from the research notes, not read here).
- **Fixed-velocity waves.** Death Weapon's wave record is 6 bytes: X
  speed, Y speed, colour, first and last animation frame and a quota
  (C64CD source; from the research notes, not read here). The record has
  no path field.
- **More enemies than sprites.** Put the enemies through a multiplexer
  (`sprite_multiplex_24`); the director does not change.

**Cycle budget.** Measured in VICE x64sc 3.10 with CIA1 timer A on the
Oscar64 -O2 recipe, identical on PAL and NTSC: one interpreter step with
steps left, 80 cycles; a step that fetches a MOVE, 158; FIRE, LOOP and a
MOVE fetch in one step, 289; the director with no wave due, 45. A frame
with eight live enemies mid-MOVE, director and spawner idle, costs 1,170,
about 146 per enemy with the edge and hit tests included. The worst frame
measured costs 3,188: seven enemies on the FIRE, LOOP and MOVE step, a
wave triggering, and its first enemy spawned into the last free slot and
fetching its first MOVE. The Cost line carries that figure. It covers the
director, the spawner and the enemy updates; it leaves out the scroll
advance, the sprite writes, and `gone()` with its end-of-wave accounting,
which runs only when an enemy leaves. Code layout moves these figures by
a few cycles. Hand-written assembly would cost less; the C figures are an upper
reference.

On NTSC the frame rate is 60 Hz, so a scroll that moves one position a
frame, and every wave with it, runs about 19% faster than on PAL unless
the step is scaled (arithmetic from 59.826 / 50.125 Hz).

### Recipes

- `recipes/oscar64/wave-director.md` — a scroll counter on autopilot with a 50-frame hold, six waves on three paths (dive, weave, swoop) as MOVE/FIRE/LOOP/END bytecode, eight sprite slots, an autopilot gun column and a wave-cleared bonus, a second loop at half spacing, triggers checked against the table and a Python model, interpreter costs on screen, PAL and NTSC

### Sources

- https://github.com/drmortalwombat/corescape (GPL-3.0): `display.cpp`
  (wave check on scroll), `enemies.cpp` (`wave_start`, `wave_loop`,
  path tables). Read for facts; no code is taken from it.
- https://github.com/mwenge/iridisalpha `src/level_data/level_data2.asm`
  (disassembly of a commercial game; facts only, not read here).
- https://github.com/C64CD/Death-Weapon-C64 `includes/levels.asm` (not
  read here).

## slope_collision — Slopes, ground snap and drop-through platforms from a per-cell attribute byte

**Complexity:** medium
**Region:** both
**Requires:** tile_grid_collision
**Cost:** cycles_per_frame=455
**Cost basis:** measured-vice

### Why

`tile_grid_collision` reads one class per cell and snaps to cell edges,
so its ground is flat and a hill is a staircase the actor has to jump. A
platformer with slopes needs the ground row inside a cell to change with
the x pixel, and it needs the actor to follow that row down a hill
instead of stepping off it into a fall. The answer is one attribute byte
per map cell and a height table per slope type; Cadaver's
c64gameframework `physics.s` is a public example (source below).

### How

1. **Attribute byte.** One byte per map cell, kept in its own array
   beside the map. The recipe's layout: bit 0 ground (the cell has a
   surface), bit 1 wall (stops a sideways move), bit 2 drop-through
   (one-way), bits 4 to 6 slope type. A ladder is one more bit, handled
   as in `tile_grid_collision`. c64gameframework uses ground $01, wall
   $02, climb $04, drop $08, a slope-end bit $10 and the slope type in
   bits 5 to 7.
2. **Height table.** Eight types of eight entries, one per pixel column
   of an 8-pixel cell: the row, 0 to 7, where the ground starts. Flat is
   all 0. 45 degrees rising to the right is 7 down to 0; falling, 0 up
   to 7. A 1-in-2 slope (26.6 degrees) takes two cells per 8 pixels of
   height: the lower cell 7, 7, 6, 6, 5, 5, 4, 4 and the upper cell 3,
   3, 2, 2, 1, 1, 0, 0, so the ground continues across the boundary in
   1-pixel steps. With
   the type in bits 4 to 6, `((a & $70) >> 1) | (x & 7)` indexes the
   64-byte table with no multiply. Store it, or generate it at start
   from the gradient; draw the slope glyphs from it either way, a pixel
   set where its row is at or below the column's entry, so the picture
   cannot disagree with the collision. The cells under a hill are flat
   ground; only surface cells carry a slope type.
3. **One foot point.** Test the ground under the middle column of the
   body, not its corners. On a slope the corners are at different
   heights; the middle is where the actor stands. Keep the foot row as
   the ground row under the feet, one below the sprite's last row. Foot
   rows run to 199 on a 25-row map, past 127, so compare them unsigned
   (`CMP` then `BCC`/`BCS`); a `BMI` after `SBC` gives the wrong order
   when the difference leaves -128 to 127.
4. **Walking step, ground snap.** Move x, then read the cell that holds
   the foot row. If it is ground and the cell above is ground too, the
   feet have walked into the fill under the next slope cell: the
   surface is in the cell above. If it is air, the feet have walked off
   the end of a slope cell: the surface, if any, is in the cell below.
   Put the feet on the surface found. Doing this every step is the
   ground snap: walking down a hill the feet follow it pixel by pixel
   instead of dropping in steps under gravity.
5. **Limits per step.** A rise larger than a set limit is a wall: undo
   the x move. A drop larger than a set limit is a ledge: keep the x
   move and start a fall. The rise limit must be at least the walking
   speed times the steepest gradient (1 pixel at 1 pixel a frame on 45
   degrees); the recipe uses 2 for both limits.
6. **Transitions.** Slope to flat and flat to slope need no code. A
   45-degree cell ends at row 0 or row 7, and the next cell along, at the
   same height or one cell up or down, starts one pixel away, which step
   4 finds.
7. **Falling and landing.** Add gravity with the fall capped below a cell
   a frame. Test the cell the feet left and the cell they reached; land
   on a surface that lies between the old and new foot rows.
8. **Drop-through.** A drop-through cell is ground from above only.
   Down + fire on one moves the feet one row below its surface and starts
   a fall, so step 7 never catches it again. The actor walking under it
   never tests it, because the foot cell is on the ground below, and the
   side probe tests the wall bit only. That needs the platform at least
   two cells above the ground: step 4 reads the cell above the foot
   cell, so a one-way cell there is taken as a surface 8 pixels up and
   refused as a wall (rung 3, read from the recipe's code, not run).

### Why it works

The height table turns a cell's shape into data: the walker needs no
per-slope code, only a table read, and a new slope shape is eight more
bytes and a type number. Looking at one neighbour cell, above or below,
is enough because the foot row moves at most one pixel per step on a
45-degree slope at 1 pixel a frame, so the surface can never be more
than one cell away. Snapping every step keeps the feet exactly on the
surface, and a rise limit turns any step steeper than a slope into a
wall without a separate test.

### Variations

- **Larger blocks.** c64gameframework keeps 16 entries per type,
  indexed by the actor's x within the block shifted right three times,
  and eight types: flat, 45 degrees each way, the
  two halves of a 1-in-2 slope each way, and a flat block at half height
  (`slopeTbl` in `aligneddata.s`). Its grounded step checks the block
  above or below only when the current block has no ground, choosing by
  the half of the block the feet are in.
- **Diagonal landing.** When the actor falls with an x speed onto a
  slope, c64gameframework adds the absolute x speed to the y speed in
  the landing test so a diagonal crossing of the surface is not missed.
  The recipe freezes x while airborne and does not need it.
- **Faster walking.** At 2 pixels a frame on 45 degrees the foot row
  changes by 2 per step, the recipe's limit; any faster walk needs larger
  limits, or the actor stalls on the slope (rung 3, not run).

### Cycle budget

Measured in VICE x64sc 3.10 with a CIA1 timer B harness around the
recipe's `actor_update`, interrupts masked, Oscar64 `-O2`, one actor
(rung 1): worst frame 455 cycles, best 87 (standing still), identical on
PAL and NTSC. A build that timed each state separately put the worst
frames at 455 walking, 370 landing, 329 falling and 250 against a wall.
One foot point and one neighbour cell are why this is far under the
2,345 of `tile_grid_collision`, whose worst step probes four points of a
side edge, two feet, the ladder and a snap; a game that needs both runs the box probes for walls and heads and this
for the ground.

### Recipes

- `recipes/oscar64/slope-collision.md` — flat ground, a 45-degree hill, a 1-in-2 hill and a drop-through platform, drawn with glyphs generated from the height table; a scripted walk right and back, the foot row logged per x and compared with a column-scan profile (error 0), PASS/FAIL and cycles per step, PAL and NTSC

### Sources

- https://github.com/cadaver/c64gameframework (MIT): `physics.s` (the
  block-info bits and `MoveWithGravity`), `aligneddata.s` (`slopeTbl`).
  Read for facts; no code is taken from it.
