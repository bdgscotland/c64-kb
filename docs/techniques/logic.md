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
**Cost measured on:** oscar64-tile-grid-collision (worst frame, one actor, in the vertical blank)

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

## flip_screen_rooms — A world of room records, redrawn whole at every edge

**Complexity:** medium
**Region:** both
**Uses registers:** D011, D015, DC04, DC05, DC06, DC07, DC0E, DC0F
**Requires:** tile_map_render, tile_grid_collision, object_pool

### Why

A flip-screen world costs no scroll code: no soft-scroll register, no
buffer rotation, no column decode at the seam, and no wide map in RAM.
Each room is one hand-made screen, so the designer places every wall and
object by eye, and the player reads the whole room at once. The whole
world is a table of records that fits in memory beside the code, which
is the single-load model of the period: one tape or disk load, then the
game and every room it has. The price is the transition, a full redraw of
the screen from the next room's record, which is longer than one frame
and has to be hidden.

### How

1. **The record.** A header, then the tile stream, then the objects. The
   header holds four exits in a fixed order (up, down, left, right), each
   a target room and an entry cell, with a sentinel for no exit, plus
   whatever the room needs to draw itself (a wall colour, a character set
   number, a tune). The tile stream is the run-length format of
   `tile_map_render`, one stream per row. The decoder returns the byte
   after the stream, so the object list follows it with no offset field.
2. **The edge.** Every frame, the move is computed first and tested
   against the room's last cell. A move that would leave the room looks
   up the exit for that direction: none means the edge is a wall; a
   target means a transition. The test is on the attempted move, not on
   the cell the player stands in.
3. **The entry cell.** The record names the cell the player appears in,
   which is the gap on the far side of the next room. Because the edge
   fires only on a move that pushes out of the room, standing on the
   entry cell does not fire it, and the way back is to push at the edge
   again. A rule keyed on position would bounce the player between the
   two rooms for ever.
4. **The redraw.** Hide the sprites (`$D015` = 0), clear DEN in `$D011`,
   decode the next room's stream straight to the tile map, the screen and
   colour RAM in one pass, load its objects into the pool, place the
   player on the entry cell, set DEN. Set it as soon as the redraw
   returns and before any other work, such as a HUD update: the blank
   lasts from DEN clear to DEN set, not for the redraw alone. The recipe
   does this at raster 251, so the first writes fall in the lower border
   and the next line `$30` sample finds DEN clear.
5. **Objects.** Clear the pool, then load the room's list into it,
   skipping any object the world's taken-bits say is gone. Write the
   bit when the player takes an object, so a second visit does not put
   it back.

### Why it works

The frame that a redraw spans is the only hazard. DEN is sampled once
per frame on line `$30`; a frame that samples it clear shows the border
colour on every line and makes no badlines. A redraw that starts in the
lower border with DEN clear therefore writes into a screen nobody is
reading: the writes before the next `$30` sample land in the border, and
the frames after it are blank until DEN is set again. No frame is torn,
because no visible line is drawn while screen RAM is half-written. The
cost is a short blank, two frames on PAL and three on NTSC for the
recipe's redraw (arithmetic from the measured cycles, on the interval
from DEN clear to DEN set). A game that would rather not
blank can accept the torn frames instead, or draw the new room behind a
`screen_wipe` from `transitions.md`, which turns the redraw's frames into
the effect.

The edge rule on the attempted move is what makes the entry cell safe.
The player is placed on a cell, not past it, and the collision code sees
the room's own tiles there, so a wall under the entry cell is the
designer's error and not the engine's.

### Cycle budget

Measured in VICE x64sc 3.10 (`recipes/oscar64/flip-screen-rooms.md`,
CIA1 timers A and B cascaded, interrupts masked, display blanked so no
badline stalls are counted): the redraw of a 40 x 22 room, decode and
draw in one pass with an object load, costs 40,204 to 42,141 cycles over
the seven transitions of the recipe's walk, for rooms of 149 to 188
stream bytes. That is 46 to 48 cycles per cell, 2.1 PAL frames or 2.5
NTSC frames, and about six times the 6,700-cycle race-free window
`full_field_redraw_exceeds_vblank` gives, which is why the screen is
blanked. The decoder is 224 bytes of Oscar64 `-O2` code from the `.map`
file. The first version decoded into the map and then copied 880 cells in
a second loop with a 16-bit index, and cost 99,262 cycles, five frames; a
per-row pointer with a `char` index halved it. `level-rle-decoder.md`
measured the decode alone at 19,158 cycles by hand against 33,562 in C
for a room of 213 bytes, so a hand-written one-pass decoder should reach
about half the figure here (not measured here). The per-frame work
outside a transition, the edge test, two corner probes and the object
check, was not timed separately.

### Variations

- **Doors instead of edges.** A door tile carries the same three bytes
  as an exit, target room and entry cell, and fires when the player's
  cell is the door's cell. The rooms no longer have to share an edge, so
  the world can be a graph rather than a grid.
- **Bigger worlds.** A room of 22 rows costs about 200 bytes packed at
  the recipe's ratios; a world of a hundred rooms is 20 KB and still a
  single load. Past that, keep the records on disk and load the four
  neighbours of the current room while the player is in it.
- **Rooms with actors.** Load the room's actor list into the pool the
  same way as the objects and let `actor_activation_window` decide which
  of them run; a flip-screen room is the window, and the room change is
  the moment every slot is freed and refilled.
- **A wipe over the redraw.** Run a `screen_wipe` to black before the
  redraw and back after it, or a `colour_fade`; the redraw then sits
  inside frames the player expects to be dark.
- **The one-frame form.** Rooms of fewer, larger metatiles, or a room
  drawn from a second screen buffer that was decoded while the player
  was still in the last room, bring the visible change inside one
  vertical blank, which is the short form `game-structure.md` describes
  (not measured here).

### Recipes

- `recipes/oscar64/flip-screen-rooms.md` — five rooms in a 2 x 2 block
  with a dead end, an autopilot walk through all of them and back, the
  redraw timed and the blank policy stated

## object_pool — Fixed-slot object pool for enemies, bullets and effects

**Complexity:** low
**Cost:** cycles_per_frame=380
**Cost basis:** measured-vice
**Cost measured on:** oscar64-object-pool (eight live slots, screen blanked)

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
**Cost measured on:** oscar64-actor-activation-window (worst tick, screen blanked)

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
**Cost measured on:** kickassembler-logic-rate-decoupling (midpoint frame, eight sprites, in the vertical blank from line 251)
**Claims:** vic_raster_irq (owns)
**Claims basis:** derived-listing

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
**Cost:** cycles_per_frame=3188, cycles_per_frame_typical=1170
**Cost basis:** measured-vice
**Cost measured on:** oscar64-wave-director (worst frame, screen blanked)
**Cost includes:** object_pool

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
fetching its first MOVE. The Cost line carries that figure, and 1,170 as
the typical frame. It covers the director, the spawner, the spawn into
`object_pool`'s slots and the enemy updates, so the Cost includes line
names `object_pool` and a plan that lists both counts the pool once. It
leaves out the scroll advance, the sprite writes, and `gone()` with its end-of-wave accounting,
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
**Cost measured on:** oscar64-slope-collision (worst frame, one actor, in the vertical blank)

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

---

## world_state_bits — One bit per persistent object, packed per level and written back on level change

**Complexity:** low

**Why.** An adventure or a game with levels you can walk back into has
to remember what the player changed: the key taken, the door opened, the
boss killed. `actor_activation_window` keeps that state in the level
actor table, but only while the level is loaded. When the next level
loads over it, the table is gone, and without a record the key is back
on its ledge. The full table is too big to keep for every level. One bit
per object is enough.

**How.**

1. **Number the persistent objects per level.** Each level lists its
   objects in a fixed order; an object's index is its bit number. The
   order must not change between builds that share save files or
   passwords.
2. **One packed area for the whole game.** A table of byte offsets, one
   per level, worked out from the object counts:
   `start[l + 1] = start[l] + (count[l] + 7) / 8`. Levels of different
   sizes share one array with no padding beyond the last byte of each.
3. **Leaving a level.** Clear the level's bytes, then set bit i for each
   object i that is done (collected, opened, killed). Bit i is byte
   `i >> 3`, mask `1 << (i & 7)`, from an 8-byte mask table.
4. **Entering a level.** Rebuild the working state from the bits before
   the actors are placed. With `actor_activation_window`, a set bit is
   the entry's dead bit: the scan never wakes that actor.
5. **Global flags.** Story events that belong to no level (the generator
   switched on, a character met) go in a separate small bit area,
   addressed the same way by flag number.
6. **Saving.** A save file, a checkpoint or a password takes the packed
   areas and the global flags as they are. Run step 3 for the current
   level first, or the save misses what happened since it was entered.

**What not to persist.** Anything the game rebuilds on entry: effects,
bullets, respawning enemies, timers. Position and hit points of a live
actor: on return the actor starts at its placed position with full
health, and only its dead bit survives. A design that needs more (an
actor that follows the player between levels) keeps a few full records
aside. Hessian keeps 24 such records in a checkpoint (`MAX_SAVEACT`,
`memory.s`; read, not run).

**Size.** One bit per object (arithmetic): 40 objects is 5 bytes, a game
of 20 levels with 60 objects each is 160 bytes (8 a level; arithmetic). Hessian's limits are 80
level actors and 96 level objects a level, at most 22 bytes a level, and
16 global flags in 2 bytes (`memory.s`; arithmetic from its constants).
A password holds far less: 6 letters carry 20 bits once a 10-bit
checksum is paid (`password_encoding` below), so a password game keeps a
few global flags, not per-level bits.

**Why it works.** The bits are a projection of the level table onto the
one fact that must outlive it. Clearing the level's bytes before setting
bits makes the save idempotent, so leaving a level twice writes the same
bytes. The polarity is a choice: the recipe sets a bit for done and
starts a new game from all zeros. Hessian sets a bit for an actor that
still exists, and a new game fills the actor bits with `$FF` and the
object bits with `$00` (`level.s` `SaveLevelState`, `script00.s`; read,
not run).

**Variations.**

- **Only some objects persist.** Hessian gives a bit only to objects
  that are switches or animate, and none to objects that deactivate by
  themselves (`IsLevelObjectPersistent` in `level.s`; read, not run).
  That saves bits and keeps a door that closes on a timer from being
  saved open.
- **Bits in place of the working copy.** A game with few objects can test
  and set the bits directly while playing and skip steps 3 and 4. A
  bit test costs a shift, a table read and an AND each time, so this
  suits objects touched rarely.

**Cycle budget.** Runs on a level change, outside the frame loop.
Measured in VICE x64sc 3.10 with CIA1 timer A on the Oscar64 -O2 recipe,
a 40-object level with every object done, identical on PAL and NTSC:
leaving 2,224 cycles, entering 2,102, about 55 an object. That is a C
upper reference; a shift loop in assembly costs less (not measured here).

### Recipes

- `recipes/oscar64/password-state.md` — three levels of 20, 13 and 40 objects in one 10-byte area, done objects restored after two level changes, a global flag, the area checked against a Python value; also the password encoder below; PAL and NTSC

### Sources

- https://github.com/cadaver/hessian (MIT): `level.s` (`ChangeLevel`
  calls `SaveLevelState`; `SaveLevelState` runs on level change and on
  save; `IsLevelObjectPersistent`), `memory.s` (`MAX_LVLDATAACT` = 80,
  `MAX_LVLOBJ` = 96, `MAX_PLOTBITS` = 16, `MAX_SAVEACT` = 24),
  `script.s` (`DecodeBit`, `SetPlotBit`), `script00.s` (new-game fill).
  Read for facts; no code is taken from it.

---

## password_encoding — A game state as a short password: bit packing, checksum, scramble and a safe alphabet

**Complexity:** low

**Why.** A tape or cartridge game with no disk has nowhere to save.
A password shown at the end of a level, and typed back later, carries the
state instead. Players copy it by hand, misread it and mistype it, so it
has to be short, use letters that cannot be confused, and reject a wrong
entry instead of loading a broken state. It should also not be editable:
if level 3 and level 4 give passwords one letter apart, players find the
pattern.

**How.**

1. **Choose the state and its bits.** Only what the game cannot rebuild:
   level 0 to 31 is 5 bits, lives 0 to 7 is 3, eight items 8, four story
   flags 4. The recipe's total is 20 bits. Pack them into bytes with
   shifts and masks.
2. **Checksum.** Append C check bits computed from the state. The recipe
   uses a 10-bit CRC (polynomial `$233`) over the 20 bits. A random
   string of valid letters then passes with odds of 1 in 2^C, 1 in 1,024
   here (arithmetic).
3. **Length.** With a 32-letter alphabet each letter carries 5 bits, so
   the password is ⌈(state bits + C) / 5⌉ letters: 30 bits make 6
   (arithmetic). Each extra 5 bits of state costs one letter.
4. **Scramble.** Permute the bits, so no field sits in one letter, then
   XOR each 5-bit group with a fixed key, so the empty state does not
   print as `000000`. The recipe sends bit i to bit (7 × i) mod 30.
5. **Alphabet.** 32 letters, with one of each look-alike pair left out:
   the recipe uses `012345679ABCDEFGHJKMNPQRSTUVWXYZ`, no O, I, L or 8.
   On decode, O reads as 0, I and L as 1, 8 as B, so a misread copy
   still works. Keep the password as PETSCII: digits are `$30` to `$39`
   and letters `$41` to `$5A`, the bytes GETIN delivers. On screen the
   letters are screen codes `$01` to `$1A`; convert when drawing.
6. **Decode.** Map each letter to its value, refusing any byte outside
   the alphabet. Undo the key and the permutation, recompute the
   checksum from the state bits and compare. On a mismatch load
   nothing: tell the player, and leave the typed text in the field to
   correct. Check field ranges too when a field does not use all its
   values (22 levels in a 5-bit field).

**Why a single mistype is always caught.** The CRC and the permutation
are linear over bits and the key is a constant XOR. So a wrong letter
changes the decoded 30 bits by a pattern that depends only on the
position and the wrong value, never on the state. The recipe's Python
model tries all 6 × 31 = 186 such patterns and none passes the CRC, which
covers every state (rung 1 for the model, rung 3 for the argument). The
C64 program repeats it on 16 passwords, 2,976 strings, all rejected,
measured in VICE. The model also caught all 5,079,040 swaps of two unequal neighbouring
letters over all 2^20 states (run here).

**How unrelated neighbouring states look.** A linear scheme cannot
change every letter. In the model, states one bit apart give passwords
that differ in 2 to 5 of the 6 letters, and level n and n + 1 at 3 lives
differ in 3 to 6 (every state from 0 by a stride of 997, and all 31
level pairs). The CRC does the spreading: one state bit moves one
password bit, but it changes several CRC bits. A nonlinear mix, such as
a few Feistel rounds with a table lookup, spreads further, and loses the
state-independent proof above.

**Variations.**

- **Compress before packing.** Ouroboros, a C64 game, stores 50
  level-complete flags. It run-length codes them with a prefix-free
  code, permutes the bits, and prints usually 5 letters from a 32-letter
  alphabet with no 0, O, 1 or I, with a checksum (devlog; not measured
  here).
- **Larger alphabets and longer passwords.** On the NES, Metroid's
  password is 24 characters from a 64-letter alphabet, 144 bits with an
  8-bit checksum and a roll byte; Simon's Quest uses 16 characters from
  32 (forum report, not measured here). A 64-letter alphabet needs lower
  case or punctuation, which a C64 player types with SHIFT.

**Cycle budget.** Runs once per level end or prompt, outside the frame
loop. Measured in VICE x64sc 3.10 with CIA1 timer A on the Oscar64 -O2
recipe, all 20 state bits set, identical on PAL and NTSC: encode 3,639
cycles, decode 3,737, a decode that fails the checksum 3,702, one that
meets a bad letter at the first byte 8. The bit loops dominate; a
hand-written loop that shifts the word through the carry costs less
(not measured here).

### Recipes

- `recipes/oscar64/password-state.md` — 20 state bits plus a 10-bit CRC in 6 letters; 4,096 states round trip, every single-letter mistype of 16 passwords rejected, look-alike letters folded, a Python model of the encoder, cycles on screen; also per-level world bits; PAL and NTSC

### Sources

- https://aardvark-soup.itch.io/ouroboros64/devlog/1635214/designing-a-retro-password-save-system-thats-not-a-pain-to-use
  (Ouroboros: 50 flags, run-length and prefix-free coding, bit
  permutation, 32-letter alphabet without 0, O, 1, I, usually 5 letters,
  a checksum; devlog, not measured here).
- https://forums.nesdev.org/viewtopic.php?t=8657 (Metroid and Simon's
  Quest password formats; forum report, not measured here).

## nav_area_pathfinding — Platform-graph routes for chasing enemies, with a next-hop table and time-sliced line of sight

**Complexity:** medium
**Region:** both
**Cost:** cycles_per_frame=369
**Cost basis:** measured-vice
**Cost measured on:** oscar64-nav-area-pathfinding (per actor, worst line-of-sight step, in the vertical blank)

### Why

A chasing enemy in a side-view game cannot walk straight at the player:
the player may be on a platform above, reached by a ladder at the far
end, or below a drop the enemy has to walk off. `tile_grid_collision`
and `slope_collision` move an actor through the map; they do not say
which way to go. A search over map cells answers that, but at a cost per
query the CPU cannot pay for several actors every frame. A platform
level is mostly runs of floor, so the search can run over those runs
instead: a graph of a dozen areas rather than hundreds of cells.

### How

1. **Areas.** At level load, scan the map row by row. A cell is
   standable when it is not solid and the cell below is solid, or is the
   top rung of a ladder. A maximal run of standable cells on one row is
   an area: `(row, x_start, x_end)`. Keep an area number per standable
   cell, or scan the area list, to find an actor's area from its cell.
2. **Links.** Join the areas with the moves an actor can make, each with
   a cost (the recipe counts cells moved):
   - **walk** off an end cell onto an area one row lower, and back up;
   - **drop** off an end cell onto the first area below, one way only;
   - **jump** over a gap of one or two cells to an area on the same row,
     both ways, if the cells over the gap are clear;
   - **ladder** from the area over its top rung to the area at its foot,
     both ways.
   Each link stores its start cell in the source area and its end cell
   in the target, so the actor knows where to walk before it takes it.
3. **Next-hop table.** For every pair (from, to), store the first link
   on a cheapest route: N² bytes for N areas. Build it at level load
   with one search per destination (Dijkstra over the links read
   backwards, or Floyd-Warshall over the whole graph), then, for each
   pair, take the lowest-numbered link whose cost plus the rest of the
   route equals the route cost. A fixed tie rule makes the table
   repeatable.
4. **Per-frame query.** A standing actor looks up its area and the
   target's, reads the table, and walks one step toward the link's start
   cell, or starts the link if it is there. In the same area it walks
   straight at the target. A link in progress is played cell by cell and
   needs no query.
5. **Line of sight.** Step a line from the actor's cell to the target's
   through the tile map, one cell per call, comparing a doubled signed
   error term with the deltas, and stop at the first solid
   cell or at the target. One step per actor per frame, on frames the
   actor does not query, keeps the cost flat; a ray of k cells answers
   after k frames.

### Why it works

The area count, not the map size, sets the cost. Twelve areas and 43
links cover the recipe's 40 x 22 map, so one search visits twelve nodes,
and the whole answer set is 144 bytes. After the build, a decision is
two lookups and one table read, cheap enough to run for every actor
every frame. The links carry the movement rules, so the route chosen
over areas is exactly the path the actor plays out on screen.

### Variations

- **Search at run time.** Without the table, run one search from the
  target each time it changes area: about 16,000 cycles for twelve areas
  in the recipe, most of a PAL frame. It saves the N² bytes and suits a
  level with many areas and one pursuer.
- **Greedy one hop.** Cadaver's c64gameframework (`ai.s`, MIT) stores
  up to 48 nav areas per zone (`defines.s`) as left, right, top and
  bottom bounds plus a type (platform, ladder, slope up-right, slope
  up-left), built by its editor and loaded after the zone map
  (`level.s`). It does no global search: an actor picks, among areas
  whose edges touch its own, the one nearest the target. That is cheap
  and needs no table, but it can walk into a dead end that a real route
  avoids.
- **Walking cost.** The recipe's costs count cells moved during links
  only, so walking inside an area is free to the search. Splitting
  areas at link points and adding the walk from entry to exit makes
  routes exact at the price of more areas.
- **Hand-placed junctions.** Paradroid's robots follow patrol routes
  drawn by hand: Braybrook keyed the junction points and the valid
  directions from each into the assembler, and robots pause at a
  junction before moving off (his diary, part 3; no search, not measured
  here).
- **Rounds of line of sight.** c64gameframework runs one actor's line
  check per frame, round-robin, capped at 19 steps (`MAX_LINEDIST` in
  `ai.s`), instead of one step per actor per frame.
- **Pixel coordinates.** The recipe works in cells, so every coordinate
  and ray error term fits a signed byte (the listing uses 16-bit `int`
  anyway). A ray stepped in pixels, or
  across a map more than 63 cells wide, has deltas or an error term past
  127, and a `BMI` on its error term gives the wrong answer;
  compare with the carry or in 16 bits (`signed_compare_bmi_overflow`).
- **Diagonal corners.** A ray that moves one cell in x and y in one step
  passes between two solid cells that touch at a corner. Step x and y
  separately if walls must not leak.

### Cycle budget

Measured in VICE x64sc 3.10 with CIA1 timers, interrupts masked, Oscar64
`-O2`, one actor, identical on PAL and NTSC (rung 1): the worst query is
154 cycles and the worst line-of-sight step 369, including 5 cycles of
timer overhead. They never share a frame, so the technique's worst frame
is 369 cycles per actor, about 1.9% of a PAL frame; a frame that moves
the actor along a link in progress runs neither. Eight actors on their
ray frames at once would be about 2,950 cycles (arithmetic).

The build runs once, at level load: 703,502 cycles on PAL (709,939 on
NTSC, where the screen's badlines take a larger share), about 36 PAL
frames. Of that, finding areas and links is 407,948, the twelve searches
at most 16,061 each, and the next-hop pass 105,602.

### Recipes

- `recipes/oscar64/nav-area-pathfinding.md` — twelve areas joined by walks, drops, jumps and ladders; a chaser follows a player marker over eight waypoints; every hop checked against a Floyd-Warshall table from Python, the trail measured on the screenshot, build, query and ray-step cycles on screen, PAL and NTSC

### Sources

- https://github.com/cadaver/c64gameframework (MIT): `ai.s` (nav area
  types, the nearest-connected-area choice, `DoLineCheck`,
  `MAX_LINEDIST`), `actor.s` (one line check per frame), `level.s` and
  `defines.s` (nav areas loaded per zone, `MAX_NAVAREAS`). Read for
  facts; no code is taken from it.
- https://codetapper.com/c64/diary-of-a-game/paradroid/birth-of-a-paradroid-part-3/
  (Andrew Braybrook's Paradroid diary; patrol junctions; not measured
  here).

---

## two_player_state_swap — Two players from one game loop: a per-player state block swapped on death, or both ports read every frame

**Complexity:** low
**Region:** both
**Uses registers:** DC00, DC01
**Requires:** joystick_edge_detect, keyboard_matrix_scan
**Cost:** cycles_per_frame=65, bytes_data=24
**Cost basis:** measured-vice
**Cost measured on:** oscar64-two-player (the per-frame port read; the swap runs once per death)

### Why

A second player is cheap on the C64 and expensive to add late. The
machine has two control ports, and the arcade convention of the time
gave a game two shapes: players take turns, each continuing their own
game when the other dies, or both play at once on one screen. Both
shapes break the same way when they are bolted on: alternating play
that keeps one set of score, lives and level variables hands player 2
player 1's game; simultaneous play that reads port 1 the way it reads
port 2 picks up the keyboard. The pattern that avoids both is one
per-player block and one careful port read.

### How

**The block.** Put everything that belongs to a player in one struct
and hold two of them in an array. The recipe's block is eight bytes:

```
offset  size  field
0       2     score
2       1     lives
3       1     level
4       1     cx     cell column
5       1     cy     cell row
6       2     rng    16-bit xorshift seed, stepped only on that player's frames
```

The map file of the recipe's build gives the array a size of `0010`,
sixteen bytes, and the copy in play a size of `0008`, eight more, so
the data cost of two players over one is sixteen bytes.
The seed is in the block on purpose. A game that shares one random
generator between alternating players gives player 2 a sequence that
depends on how long player 1 survived, and two players who die at the
same point in a level see different enemies. With the seed swapped in
and out, each player's game is a function of their own input alone.

**The swap.** The game loop works on a copy in play, `g`. On death:
take the life and reset the position in `g`; store `g` into
`players[cur]`; flip `cur` if the other player still has lives; load
`g` from `players[cur]`. That is two eight-byte copies, a compare and a
branch, and the loop writes `g` back to `players[cur]` every frame so
the array is always current. Measured with CIA2 timer A in the lower
border, KERNAL IRQ held off, net of an empty span: 206 cycles per swap
in the Oscar64 build, the same on PAL and NTSC. The entry routine of
the next state (`game-design/game-structure.md`, game_state_machine)
redraws the HUD from both blocks and marks whose turn it is, so the
display is derived from the array and never carries state of its own.

**Simultaneous play and the port-1 hazard.** With both blocks live,
each frame steps `players[0]` from port 2 and `players[1]` from port 1.
Port 2 is `$DC00` bits 0 to 4. Port 1 is `$DC01` bits 0 to 4, and
`$DC01` is also the keyboard's row input: a key pulls its row low while
its column is driven low on `$DC00`. With the KERNAL IRQ live, SCNKEY
runs every jiffy and leaves `$DC00` at `$7F`, column 7 selected, so
between scans a held 1, left-arrow, CTRL, 2 or SPACE reads on port 1 as
up, down, left, right or fire (`pitfalls/input.md`,
joystick2_scan_phantom_press, Fix C). The mitigation is ordering under
a held-off interrupt: `php`, `sei`, write `$FF` to `$DC00`, read `$DC00`
for port 2 and `$DC01` for port 1, `plp`, every frame. No column is
selected during the reads. The store alone is not enough: the jiffy IRQ
comes from CIA1 timer A every 16,422 cycles on PAL and 17,046 on NTSC
(`hardware/cia-reference.md`), the game loop is locked to the raster,
so the interrupt drifts through the loop and can be taken between the
store and the read, and then the scan puts `$7F` back before the read.
The recipe measured it: the bare store-then-read shape, 50,000 times in
a tight loop with the IRQ live, found `$7F` on the read after the store
9 times; the held-off shape, 0 times. The compiled window was 19
cycles, which is about one frame in 860 on PAL, a few times a minute in
a real game. Holding the interrupt off for the 22 cycles of the pair
delays the scan and loses none of it, and `plp` rather than `cli` keeps
the interrupt off for a caller that already had it off. Leave the
direction registers as IOINIT set them; clearing `$DC02` to read a
joystick kills the keyboard (`pitfalls/input.md`,
cia1_ddr_cleared_kills_keyboard). The recipe counts reads taken with a
column selected: 0 of 40 with the held-off store, 40 of 40 without, on
both models. It cannot count the phantom itself, because a headless
VICE run holds no key; that half rests on the wiring in
`hardware/cia-reference.md` and was not measured here.

### Why it works

The swap is correct because the block is complete: nothing a player
would notice is kept outside it, so loading a block restores a game
exactly, including the next random number. The port read is correct
because it removes both halves of the port-1 hazard: the state the scan
leaves, column 7 selected, which the `$FF` store clears, and the one
timing case, the scan running between the store and the read, which
the held-off interrupt makes impossible. A main-loop read never lands
inside the scan (`pitfalls/input.md`, measured there), and with the
scan unable to run between the store and the read, a read that first
deselects every column sees only the stick.

### Variations

- Alternating play with a shared level: keep the level's world state in
  a third block and reload it from the level data on each turn, or both
  players play the same half-cleared screen.
- A two-player game with the KERNAL IRQ replaced (`keyboard_matrix_scan`)
  needs no `$FF` store, since nothing else writes `$DC00`; the matrix
  scan and the port-1 read must then be ordered by the game itself, and
  a port-1 stick still reads as keys during the scan.
- Three or four players through a port adapter are out of scope here;
  the block array extends, the port reads do not.

### Recipes

- `recipes/oscar64/two-player.md` — two sprites, one listing, `MODE`
  selects alternating or simultaneous from a byte at start; the
  alternating blocks checked against a host model after two scripted
  deaths; the simultaneous cells checked, the column-selected count 0
  with the `$FF` store and 40 without; swap and read cycles on screen;
  PAL and NTSC

## difficulty_ramp_tables — Level tables read from data, held at the last row, scaled by region

**Complexity:** low
**Region:** both
**Requires:** pal_ntsc_detection, object_pool, lfsr_random
**Cost:** cycles_per_frame=415, cycles_per_frame_typical=53
**Cost basis:** measured-vice
**Cost measured on:** oscar64-difficulty-tables (spawn frame, screen on)

**Why.** A ramp built from constants cannot be tuned without a rebuild
and cannot be tested by anyone but the programmer. It also cannot be
scaled: a spawn interval of 60 written as a literal means 1.2 seconds
on a PAL machine and 1.0 on an NTSC one, and every level of the game
arrives a fifth early on the second. Put the knobs in a table with one
row per level and every one of them becomes a byte a designer can
change, a row a test can read, and a value a region scaler can pass
through once at level start.

**How.** One row per level, one column per knob: enemy speed in 8.8
pixels per frame, spawn interval in frames, most enemies alive at once,
the end condition (a coin quota, a kill count, a distance) and a flag
byte that switches hazards on. Write every column for one region, PAL,
and say so in the comment above the table. At level start, clamp the
level index to the last row, copy the row into working variables, and
pass the frame and speed columns through a scaler: on NTSC multiply
frames by 6/5 and speeds by 5/6, rounding to nearest, so the interval
lasts as long and the enemy covers the same distance in the same real
time. The spawner and movers read only the working variables; the frame
loop never reads the table. Advance the level on
the row's end condition, not on a timer, so a slower player gets a
longer level and not a harder one. The recipe reaches level 3 at 1128
frames on PAL and 1352 on NTSC, 22,497 and 22,577 milliseconds by the
CIA, against 18,847 milliseconds when the same table runs unscaled on
NTSC.

**Why it works.** The table is the whole ramp, so a level's difficulty
is one row of bytes and the game's curve is the table read down a
column. Clamping the index makes every level past the table a copy of
the last row rather than a read of whatever follows it in memory, which
is the pattern page's first check. The scaler is exact for the
interval column when the row's frames divide by five, and within one
frame otherwise; for speed the 8.8 fraction keeps the rounding under
one part in two hundred. Doing the scaling once per level start keeps
the per-frame path to a compare and a countdown.

**Variations.** A rank counter beside the table, as the pattern page
describes from the Gradius account: a few additive counters the player
never sees (frames survived, stages cleared, power-ups held), summed,
shifted down and capped at a small number, then used as a second index
that picks a harder row or adds to a column. It rises with success, and
the cap is the whole point. Rubber banding by outcome rather than by
time: scale the damage a hit does, or the drop rate of health, by how
far the player is ahead of or behind the row's expectation, and never
below a floor. Two whole tables, one per region, selected once by
`pal_ntsc_detection`, when the rounding of a scaler is not acceptable
for some column. The last-row hold can also be a loop: index modulo the
row count, with a separate counter that adds to speed on each pass.

**Cycle budget.** Measured on the recipe with CIA1 timer A over one
hundred calls, screen on, so badline stalls are inside the figures and
they wander by a cycle or two between runs. The Cost line carries the
spawner's worst frame, the one on which the interval has run out and
it counts the eight-slot pool, rolls the LFSR once or twice, allocates
a slot and fills it: 409 cycles on PAL and 412 on NTSC in the
compensated build, 410 and 415 with the scaler compiled out, and the
line states the largest of the four. The spawn itself is `object_pool`
work, but the technique's spawner is what runs it, so that is the frame
a plan has to fit. The ordinary frame, when the interval is counting
down and nothing spawns, costs 51 cycles on PAL and 53 on NTSC. A
level start, the clamp, the row copy and both scalers, costs 181
cycles on PAL and 267 on NTSC in the compensated build, where the NTSC
path runs the multiply and divide, and 113 or 118 with the scaler
compiled out. A level start happens a handful of times in a game and
is not a per-frame figure.

### Recipes

- `recipes/oscar64/difficulty-tables.md` — six-row table, eight-slot pool, coin quota per level, spikes from level 3, one define for the region scaler, frame and CIA time at level 3 printed on both models

---

## ghost_target_tile_ai — Maze-chase ghosts that steer by target tiles: look-ahead, no reversing, per-ghost targets and a scatter/chase timer

**Complexity:** medium
**Region:** both
**Cost:** cycles_per_frame=7227, cycles_per_frame_typical=4171
**Cost basis:** measured-vice
**Cost measured on:** oscar64-ghost-targeting (built worst frame, screen blanked)

### Why

A maze-chase game needs four or so pursuers that feel different, never
dither, and fit in a frame together. A path search from each ghost to
the player every time it reaches a junction does not fit: even the
twelve-node run-time search of `nav_area_pathfinding` costs about 16,000
cycles, and a tile maze has hundreds of tiles and dozens of junctions (the recipe's: 245 and 34). Pac-Man (Namco, 1980)
does no search at all. Each ghost has a target tile and, at each
junction, takes the exit whose next tile is nearest that target. The
target rule gives each ghost its character. This page describes that
rule as Jamey Pittman's Pac-Man Dossier documents it, adapted to a C64
character maze.

### How

1. **Maze.** One byte per tile: bit d set when the neighbour in
   direction d is open. Directions are numbered in the tie order: up 0,
   left 1, down 2, right 3, so the reverse of d is d XOR 2. Build the
   table at level start from the map. The maze must have no dead ends,
   because a ghost may not turn back. The arcade screen is 28 x 36 tiles
   of 8 x 8 pixels (Dossier); a C64 text screen has 8 x 8 character
   cells, so one character is one tile.
2. **Look-ahead.** When a ghost enters a tile, it looks at the next tile
   along its heading and decides now which way it will leave that tile.
   On arrival it turns to the stored direction and looks ahead again
   (Dossier: "whenever a ghost enters a new tile, it looks ahead to the
   next tile").
3. **Junction test.** Take the look-ahead tile's exit mask and clear
   the reverse of the heading. One bit left is a corridor or a corner:
   take it, with no arithmetic. Two or three bits is a decision.
4. **Choice.** For each remaining exit, the test tile is one step
   beyond the junction in that direction. Take the exit whose test tile
   is nearest the target; on a tie take the lowest direction number,
   that is up, then left, then down, then right. The Dossier says the
   ghost "triangulates" the distance, a straight-line measure; compare
   squared distances, dx² + dy², which order the candidates the same
   way and need only a table of squares (arithmetic: squaring is
   monotonic for non-negative numbers).
5. **Targets.** Chase mode, per ghost (Dossier):
   - Blinky: Pac-Man's tile.
   - Pinky: four tiles ahead of Pac-Man in his direction of travel.
   - Inky: take the tile two ahead of Pac-Man, draw the vector from
     Blinky's tile to it, and double it. Inky needs Blinky's tile, so
     update Blinky first.
   - Clyde: Pac-Man's tile while Clyde is more than eight tiles from
     him, otherwise Clyde's scatter tile. The recipe tests squared
     distance > 64.
   Scatter mode: a fixed tile per ghost, outside the maze near its
   home corner, which it can never reach, so it circles the nearest
   block of walls.
6. **The up bug.** In the arcade, when Pac-Man faces up, Pinky's offset
   is four up and four left, and Inky's intermediate tile two up and two
   left, from an overflow in the offset code (Dossier). A port chooses
   whether to reproduce it; the recipe does, behind `UP_BUG`.
7. **Frightened mode.** A frightened ghost ignores its target. At a
   decision it takes a pseudo-random direction if that exit is open,
   otherwise the first open exit in the order up, left, down, right.
   The arcade reseeds its PRNG to the same value every level and every
   life (Dossier), so frightened paths repeat. A shift-register PRNG
   seeded with zero stays at zero, and every frightened ghost then
   tries up first (`lfsr_zero_state_lockup`); the recipe's xorshift
   seed is a fixed non-zero constant.
8. **Reversals.** A ghost never reverses on its own. The game forces
   every ghost to reverse when the mode changes from chase to scatter,
   scatter to chase, or either into frightened; not when frightened
   ends (Dossier). A forced reversal points the ghost back at the tile
   it came from and makes a fresh look-ahead from there.
9. **Mode timer.** Scatter and chase alternate on a timer that pauses
   while the ghosts are frightened. In seconds, from the Dossier:

   | Phase | Level 1 | Levels 2-4 | Level 5 on |
   |---|---|---|---|
   | Scatter | 7 | 7 | 5 |
   | Chase | 20 | 20 | 20 |
   | Scatter | 7 | 7 | 5 |
   | Chase | 20 | 20 | 20 |
   | Scatter | 5 | 5 | 5 |
   | Chase | 20 | 1033 | 1037 |
   | Scatter | 5 | 1/60 | 1/60 |
   | Chase | for good | for good | for good |

   Keep the table in seconds and convert with the region's frame rate
   (50 PAL, 60 NTSC); frame counts written for PAL run about 20% fast on
   NTSC (`pal_ntsc_tempo_mismatch`).

### Why it works

A decision looks at no more than three tiles and needs no memory
between frames beyond each ghost's tile, heading and planned turn. The
no-reverse rule keeps a ghost from oscillating between two tiles when
its target moves, and it commits the ghost to a corridor once chosen.
The four target rules are the whole of the ghosts' personalities: the
same choice code serves all four modes, and only the target tile
differs. Pinky aims ahead and so tends to arrive from the front; Inky's
target depends on Blinky and swings widely; Clyde's switch at eight
tiles makes him approach and retreat.

What it gets wrong: it is greedy by one tile. A ghost can take an exit
that leads away from its target round a long wall, and it can circle
for ever. The Dossier shows Clyde circling one block indefinitely,
because his target flips between Pac-Man and his corner as he crosses
the eight-tile ring. Scatter targets exist only to make each ghost
circle its corner block. A game that wants a pursuer that always finds
the player needs a path search or a distance map, at the cost above.

### Variations

- **Choose on arrival.** Deciding at the tile the ghost has just
  entered, not one ahead, drops the planned-turn byte. Targets are then
  one tile fresher, and the paths differ from the arcade's.
- **No-up tiles.** The arcade forbids upward turns in two zones of its
  maze in scatter and chase, not in frightened (Dossier). A
  per-tile flag that clears the up bit from the mask does it. The
  recipe's maze has none.
- **Manhattan distance.** |dx| + |dy| needs no squares, but ties become
  far more common and the tie order then decides most turns. The paths
  differ from the arcade's.
- **Speeds.** The arcade slows frightened ghosts, nearly halves a
  ghost's speed in the side tunnels, and speeds Blinky up as the dots
  run out (Dossier).
  The recipe moves every actor one tile every four frames.

### Cycle budget

Measured in VICE x64sc 3.10 with CIA1 timer B, the display and sprites
off, Oscar64 `-O2`, identical on PAL and NTSC (rung 1). The single
figures include one 5-cycle timer pair, the frame figures two.

| Work | Cycles |
|---|---|
| One 3-way decision (`choose` only; the target is set before timing) | 578 |
| One 1-exit tile (a corridor or a corner) | 89 |
| Built worst frame: scatter ends, all four ghosts reverse onto a 4-way junction, then all four step onto another 3-way decision in chase | 6,943 |
| The same frame with frightened mode starting too: a second reversal, step decisions from the PRNG | 7,227 |
| Worst frame of the recipe's 1,600-frame run | 4,171 |

The Cost line states the 7,227-cycle frame, 37% of a PAL frame (19,656
cycles; arithmetic), and the run's worst frame, 4,171, as its typical
figure: play reaches it, while the built frame needs every ghost at a
junction on a mode switch. A mode switch reverses all four ghosts at once, so
the worst frame is a switch frame that is also a step frame. On the
three frames in four when no actor steps and no mode changes, the work
is the mode-timer update only (not timed separately). An assembler version
would be cheaper; not measured here. The recipe's technique code is
757 bytes and its tables 882 bytes, of which 704 are the exit masks at
a 32-byte row stride (Oscar64 map).

### Recipes

- `recipes/oscar64/ghost-targeting.md` — four ghosts as sprites and a Pac-Man stand-in on a scripted loop in an original 27 x 22 character maze; the level-1 mode table at 16 frames per second with one frightened spell; every frame's ghost tiles checksummed against a Python model; decision and worst-frame cycles on screen, PAL and NTSC

### Sources

- https://www.gamedeveloper.com/design/the-pac-man-dossier (Jamey
  Pittman, The Pac-Man Dossier): tile grid, look-ahead, test tiles, tie
  order, no-reverse rule and forced reversals, the four chase targets
  and the up-direction overflow, scatter targets in dead space,
  frightened PRNG, the mode table, the no-up zones and Clyde's endless
  loop. Rules only; no arcade code was read.

## falling_block_rules — Falling-block rules: collision, rotation, gravity table, DAS, lock, line clear, scoring and a 7-bag

**Complexity:** medium
**Region:** both
**Requires:** joystick_autorepeat, lfsr_random
**Cost:** cycles_per_frame=5888
**Cost basis:** measured-vice
**Cost measured on:** oscar64-falling-blocks (constructed upper bound, screen on)

**Why.** A falling-block game is small, but its rules decide whether it
feels right. The renderer in `text_mode_overlay_render` draws a board and
a piece; it does not say when the piece falls, how a held direction
repeats, what rotating against a wall does, or how cleared rows collapse.
Each of those is a table or a counter, and each has a reference value in
NES Tetris that players know. This technique is that rules layer, with
the rules the recipe implements named and their sources cited.

**How.** The rules the recipe implements:

| Rule | This page | Reference |
|---|---|---|
| Board | 20 rows of 10 bytes, 0 empty, 1-8 a colour; a fill count per row | own |
| Pieces | seven, each four cells in a 4x4 box, two tables (x and y) per piece and rotation | own tables; I, S, Z have two states, O one |
| Rotation | clockwise on the fire press; try the new state in place, then one right, then one left | NES has no kick (tetris.wiki) |
| Gravity | frames per row by level, 48 at level 0 down to 1 at level 29 on NTSC; 36 down to 1 at level 19 on PAL | NES NTSC and PAL tables (tetris.wiki) |
| DAS | first step on the press, second 16 frames later, then every 6 (NTSC); 12 and 4 on PAL; the counter clears on release | NES values (tetris.wiki); NES clears the counter on a new press, not on release, and a blocked tap charges it fully; the recipe's DAS is the simple form |
| Soft drop | down held: one row every 2 frames, or gravity if faster | NES 1/2 G (tetris.wiki) |
| Lock | at once, on the frame a step down fails | NES has no lock delay (tetris.wiki) |
| Entry delay | none: the next piece spawns in the lock frame | NES 10-18 frames ARE by lock height, plus a line-clear delay of 17-20 frames (tetris.wiki) |
| Score | 40, 100, 300, 1200 for 1-4 lines at once, times level + 1, at the level after the clear's level-up | NES the same (tetris.wiki Scoring) |
| Level | +1 every 10 lines from level 0 | NES from level 0; a higher start level waits min(10s + 10, max(100, 10s - 50)) lines first (tetris.wiki) |
| Randomiser | 7-bag: a shuffled set of all seven, dealt out, then reshuffled | NES instead rolls 0-7 and rerolls once, 0-6, on a repeat or 7 (tetris.wiki) |
| Game over | the new piece does not fit where it spawns | NES the same |

The collision test is the whole engine. `fits(piece, rot, x, y)` adds
each of the four cell offsets to (x, y), refuses a cell outside the well
and refuses a cell whose board byte is non-zero. Everything else calls
it: a move tries x ± 1, a gravity step tries y + 1, a rotation tries the
next state at x, x + 1 and x - 1, and a spawn tries the spawn position.
Do the range test on the sum as an unsigned byte and one compare catches
both a negative column and one past 9. With the recipe's tables, an
upright I at the left wall cannot rotate (every try overlaps the wall)
and one at the right wall kicks one left (run on the Python model on the
recipe page; the J kick at the right wall is the one the C program
checks).

DAS is `joystick_autorepeat` with its delay and rate set per region: one
age counter per direction, cleared on release, and a step on age 1, on
age 1 + DELAY, and every RATE frames after that. Gravity is a counter
compared with the table entry for the level, clamped at level 29; soft
drop lowers the limit to 2. When the step down fails the piece is written
into the board and each touched row's fill count goes up by one.

Line clear reads only the fill counts of the rows the piece touched, at
most four. If none reached 10 the frame is done. Otherwise collapse in
one pass from the lowest full row upward: skip a full row, copy any other
row down to the next free destination, and zero the rows left at the
top. Keep the highest occupied row in a byte: the pass stops there, the
rows above it are already empty, and only the rows from the old top to
the lowest cleared row need redrawing.

**Why it works.** The fill count turns the full-row test into one
compare per touched row instead of ten reads. A single pass from the
bottom up is enough because a destination is always at or below its
source, so no row is overwritten before it is copied. Clearing only
touched rows is complete because a row that was not full before the lock
and was not touched cannot be full after it. The bag bounds the drought
of any piece: the longest run between two of the same piece is 12 others,
when it is first in one bag and last in the next (arithmetic). A plain
LFSR modulo 7 has no bound. The modulo in the shuffle has a bias of at
most 7 in 65,535 on a 16-bit state (arithmetic), too small to matter.
That figure treats each draw as independent, and they are not: a Galois
step shifts the state one bit right and flips at most the four tap bits
of `$B400`, so consecutive states share most of their 15 shifted bits
and the draws within one shuffle are correlated (arithmetic from the
recipe's `rnd`, not measured as a distribution here).

**Region.** The NES tables are frame counts. The recipe finds the
region by looking for raster line 280, which only PAL has, and selects
the NES PAL gravity and DAS tables on PAL. NES PAL runs at 50.007 Hz and
NTSC at 60.099 Hz (tetris.wiki); the C64 at 50.125 Hz and 59.826 Hz
(985,248 / 19,656 and 1,022,727 / 17,095, from
`hardware/pal-ntsc-reference.md`), so the NES tables carry over within
0.5 per cent (0.24 on PAL, 0.45 on NTSC, arithmetic). One table on both regions makes every
level a fifth faster on NTSC (`pal_ntsc_tempo_mismatch`).

**Variations.** A lock delay: count frames on the ground and lock at a
limit, reset by a move or a rotation, with a cap on resets. A wider kick
table (try ±2 for the I) or none at all, as on the NES. A two-row
representation where each row is a 16-bit mask with wall bits set: the
collision test becomes four ANDs of a shifted piece row, at the cost of
separate colour storage. Hard drop on up: step down until `fits` fails,
then lock in the same frame. A next-piece preview is the bag's next
entry.

**Cycle budget.** Measured in VICE x64sc with CIA1 timer A, KERNAL IRQ
off, screen on, starting at raster line 250, so badline stalls are in
the figures. The Cost line is the rules part of the recipe's worst-frame
subject: a full-height stack with column 9 open in every row, an upright
I locking into the bottom four with fire, left and right held, so three
rotation tries and both moves are tested and refused before the lock,
the four-line clear, sixteen rows collapsed and a spawn. It read 5,717
cycles on PAL and 5,888 on NTSC, 29 and 34 per cent of the 19,656 and
17,095 cycle frames. That stack cannot occur in play, because the spawn
would fail first, and a stick cannot hold left and right at once, so it
is an upper bound. The render of the same frame, timed apart, is
`text_mode_overlay_render`'s work: erasing and redrawing the locked
piece, redrawing all twenty rows and drawing the new piece took 9,311
cycles on PAL and 9,394 on NTSC. The four-line clear in the scripted
game, rules and render together with the stack top at row 14, took 6,276
on PAL and 6,491 on NTSC and was the dearest frame of the run; frames
with no lock peaked at 2,113 on both.

### Recipes

- `recipes/oscar64/falling-blocks.md` — the game in character mode, joystick port 2; the default build plays five scripted pieces through the input path (single, double, triple, four-line clear, level-up, DAS moves, a kick at the wall) and checks board, score, bag and spawn against a Python model and the screen against the board, including a piece moved on its lock frame, with the worst-frame subject's rules and render timed apart on PAL and NTSC

### Sources

- https://tetris.wiki/Tetris_(NES) (NES Tetris): gravity tables (NTSC and PAL), DAS 16/6 and 12/4 and when its counter resets, soft drop 1/2 G, no lock delay, no wall kick, ARE and line-clear delay, level rule, randomiser, frame rates.
- https://tetris.wiki/Scoring (scoring): 40, 100, 300, 1200 times level + 1, at the level after the clear.

---

## dig_and_refill — Dig-and-refill bricks, trapped guards and a greedy ladder chase (Lode Runner rules)

**Complexity:** medium
**Region:** both
**Cost:** cycles_per_frame=19759, cycles_per_frame_typical=4118
**Cost basis:** measured-vice
**Cost measured on:** oscar64-dig-and-guards (constructed stress tick, screen on)

### Why

Lode Runner's rules are exact and testable. The player digs a brick,
the hole traps a guard, the guard climbs out after a while, and a hole
that refills on a guard kills it. Guards chase over ladders and fall
into holes. None of that is collision or path search. It is timers on
map cells and a per-guard state, and it needs a chase rule cheap enough
for several guards a frame. No C64 primary source was found: what
follows about the original comes from the Apple II literate disassembly
(Sources below), read and not run here. The C64 port was not examined.

### How

1. **Tile states.** Map cells are one byte: empty, brick (diggable),
   solid (not diggable), ladder, hole, refilling. Only brick and solid
   stop a move. A hole and a refilling cell are passable; an actor in
   one is below the floor.
2. **Dig.** The player digs diagonally, below-left or below-right. The
   dig succeeds only if that cell is brick and the cell above it, beside
   the player, is empty with no guard in it. The Apple II original also
   refuses a dig on the bottom row or at the edge column (read from its
   `TRY_DIGGING_LEFT`).
3. **Hole list.** A dig writes the hole into the map and puts the cell
   and a timer into a free slot of a small list. One loop per tick
   counts each live slot down. At a set count the cell turns to the
   refilling state, so the player can see it closing. At 0 the cell is
   brick again and the loop checks the cell: a guard in it dies and
   respawns on the top row, the player in it dies. The original's dig
   routine searches 30 slots (`BRICK_FILL_TIMERS`) and starts a timer at
   180; the timer loop draws two refill frames at 20 and 10, and at
   expiry bricks over gold lying in the cell and takes it off the gold
   count (read from `DROP_PLAYER_IN_HOLE` and `HANDLE_TIMERS`, not run
   here). The recipe keeps 8 slots, 80 ticks, refill glyph from 16.
4. **Standing.** An actor is held up when its own cell is a ladder, or
   the cell below is brick, solid or ladder, or the cell below is a hole
   holding a trapped guard. The last clause is the walk-over rule: the
   player crosses a hole on the trapped guard's head. It also keeps a
   second guard out of an occupied hole. Otherwise the actor falls one
   cell a step.
5. **Guard states.** Free, trapped, escaping. A free guard that falls
   into a hole cell becomes trapped with a counter (30 guard ticks in
   the recipe). At 0 it climbs one cell, into the floor row, and is
   escaping: on its next tick it steps sideways toward the player
   without the fall test, so it does not drop straight back into the
   hole. A hole timer that runs out first kills it (step 3). In the
   original, a guard that lands in a dug hole has its per-guard timer
   reset to a value chosen at level start from a 13-entry table (38 to
   80), and the player scores 75; the move routine reads that timer to
   send a guard in a hole upward (read, not traced further).
6. **Greedy chase.** Once per guard move, first match wins:
   - on the player's row, if every cell up to the player can be stood
     on, step toward the player;
   - player above and the guard on a ladder with room above: climb;
     player below and a ladder or empty cell below: descend;
   - otherwise scan the guard's row outward, left before right at each
     distance, for the nearest column offering that vertical move, and
     step toward it; a side stops at a wall, the map edge or a cell the
     guard would fall from;
   - otherwise step toward the player's column.

   The original is also greedy but scores candidates. On the player's
   row it walks straight at the player when the cells between are
   ladder, rope or floored. Otherwise it finds how far the guard can go
   left and right, and scores the up, down, left and right candidates
   by a pseudo-distance: the column distance if the candidate row is the
   player's, 100 plus the row distance if it is above the player, 200
   plus the row distance if below (row 0 is the top). The smallest
   score wins, so a guard prefers to end above the player, from where
   it can drop to him (`DETERMINE_GUARD_MOVE`; `PSEUDO_DISTANCE` at
   `$72D4`). The disassembly's prose describes the two cases the other
   way round; this follows its code. The recipe's nearest-column rule
   is its own simplification: it has no above-or-below preference.
7. **Guards and gold.** In the original each guard has a gold timer.
   A guard on a cell with gold picks it up, and drops it later on a
   cell boundary with nothing there, when the timer allows
   (`CHECK_FOR_GOLD_PICKED_UP_BY_GUARD`, `GUARD_DROP_GOLD`; the timer's
   full cycle was not traced here). Not built in the recipe.

### Why it works

Every rule reads the map and one small list, so the state is the map,
the hole slots and a few bytes per guard. The hole slot and the map
cell change together, so they cannot disagree, and the kill test runs
only when a slot expires. Putting the trapped guard into the standing
test gives walk-over for free, with no special case in the player code.
The chase rule is greedy: it never plans past the next vertical move,
which is why guards walk into holes the player digs in their way. That
is the game, not a defect. A route search (`nav_area_pathfinding`)
would walk round the hole.

### Variations

- **Pseudo-distance scoring.** Score each candidate move as the original
  does (step 6) instead of taking the nearest column. It prefers a move
  that ends above the player to one that ends below.
- **Staggered guards.** Move one or two guards per frame instead of all
  on the same tick; four full-row scans at once overrun a frame in
  the recipe (Cycle budget). The original picks a guard move pattern at level start from
  the guard count (`GUARD_PATTERNS_LIST`) and keeps a phase
  (`GUARD_PHASE`); how that spreads the moves was not traced here.
- **Pixel movement.** The original moves actors in sub-cell steps
  (per-guard `GUARD_X_ADJS`, `GUARD_Y_ADJS`). Draw actors as sprites
  with the same cell rules;
  `tile_grid_collision` has the pixel-to-cell conversion.
- **Bars (ropes).** A cell class the actor hangs from: held up in it,
  moves sideways along it, drops on down. The original's same-row check
  treats rope like ladder. Not built in the recipe.

### Cycle budget

Measured in VICE x64sc 3.10 with a CIA1 timer B harness, interrupts
masked, Oscar64 `-O2`, screen on (rung 1). The Cost line is the recipe's
stress tick on PAL: 19,759 cycles, 19,716 on NTSC. That is 101% of a PAL
frame (19,656 cycles) and 115% of an NTSC one (17,095), so it is over a
frame on both; a budget that sums per-frame costs cannot fit it. The
tick is built as the worst frame: four free guards each scan their whole
row, because the player is above and no column offers a climb; eight
live holes sit off that row, one expiring and one turning to the refill
glyph (659 cycles for the list); the player tries a dig with the list
full. More cannot expire at once: one dig a tick and a fixed hole life
put at most one expiry in any tick. The slowest guard took 4,780
cycles, about 165 a probed cell by arithmetic over 29 probes.

Four guards scanning full rows overrun a frame in this C, so four or
more need staggering. With the fourth guard switched off the same tick
took 15,085 cycles on PAL (77%) and 15,299 on NTSC (89%): three fit.

The row scan is the whole cost, and about 165 cycles a cell is Oscar64
call overhead per probe, not the rule. Ways to bound it, none measured
here: stagger guard decisions over frames (Variations); keep a per-row
table of ladder columns, since ladders do not move, and look up the
nearest one instead of probing each cell (holes still cut a side short,
so check the cells between); write the probe loop in assembly.

The typical frame is far smaller. Over the recipe's 168-tick scenario,
one guard and at most two holes, the worst whole tick is 4,075 cycles on
PAL and 4,118 on NTSC, one guard's update at most 3,516 and 3,559, and
the hole list at most 366. The worst player update, a dig, is 505. PAL
and NTSC differ only by badline cycles, where the work runs past the
vertical blank.

### Recipes

- `recipes/oscar64/dig-and-guards.md` — 28 x 16 level with bricks and ladders; an autopilot digs two holes, traps a guard, walks over it and lets the second hole refill on it; the guard respawns and chases down a ladder; map and guard states checked every 16 ticks against a Python model (checksum), a built worst-frame stress tick, PASS/FAIL and cycles, PAL and NTSC

### Sources

- https://github.com/XekriRedmane/lode_runner_reveng (Apple II literate
  disassembly, CC BY-SA 4.0): `main.nw`, sections "Digging" and the
  guard routines: `BRICK_FILL_TIMERS`, `HANDLE_TIMERS`,
  `DROP_PLAYER_IN_HOLE`, `DETERMINE_GUARD_MOVE`, `PSEUDO_DISTANCE`,
  `GUARD_GOLD_TIMER_START_VALUES`, `GUARD_RESURRECTIONS`. Read for
  facts; no code or prose is taken from it.
- https://github.com/fschuhi/a2-lode-runner (research built on the
  above; its platform-neutral game spec is not written yet). Read for
  context only.

---

## cave_scan_engine — One-pass cave scan with a scanned bit: falling and rolling objects, digging and a wall-following enemy (Boulder Dash rules)

**Complexity:** medium
**Region:** both
**Cost:** cycles_per_frame=18559
**Cost basis:** measured-vice
**Cost measured on:** oscar64-cave-scan (one scan, run every fourth frame; slowest game-cave scan, NTSC, screen on)

**Why.** A Boulder Dash style game is a grid of one-byte cells in which
every boulder, diamond, enemy and the player act once per game tick.
The cheap way to update it is one scan over the grid per tick, in place,
with no second buffer. Scanned in place, an object that moves into a
cell the scan has not reached yet gets processed again when the scan
arrives there. A boulder falls the whole height of a shaft in one tick;
the player tunnels across a row on one step. Games of this kind
(sand, water, push chains) all meet the same bug.

**How.** Keep the cave as a byte per cell: 40x22 with a steel border and
a 38x20 play area is Boulder Dash I's size (elmerproductions, below).
Use the low bits for the element and bit 7 as the scanned bit. Give the
falling state its own code, one above the resting code, because the
rules differ: only a falling object kills the player. Once per cave
frame, walk the interior row by row, top to bottom, each row left to
right, the order the Boulder Dash forum thread describes (below). For
each cell:

- Space, dirt, brick, steel: nothing. Make this path as short as the
  compiler allows; it is most of the cave.
- Bit 7 set: clear it and do nothing else. The object moved here during
  this scan and has had its turn.
- Resting boulder or diamond: space below, start falling and move down.
  A round object below (boulder, diamond or brick in the recipe): roll,
  left if the left cell and the cell below it are empty, else right
  under the same test. The recipe's round set and left-first order are
  its own choice; Boulder Dash's exact rules are not established here. A tick counted in display frames runs 20 % fast
on NTSC (`pal_ntsc_tempo_mismatch`).
- Falling boulder or diamond: space below, move down. The player below:
  kill him. A falling object below: wait. A round object below: try to
  roll, else land (the resting code). Anything else: land.
- The player: take this tick's move; enter space or dirt (dig), or a
  diamond (collect); otherwise stay.
- An enemy: if the player is next to it, kill him; else turn left if
  that cell is empty, go on if not, and turn right on the spot if both
  are blocked. That keeps it running round the wall on its left.

Every move goes through one routine that writes the destination and
clears the source. When the destination is later in scan order, to the
right or below, it also sets bit 7. A move left or up lands on a cell
already passed and needs no mark.

**Why it works.** The scan reaches a cell to the right or below after
the object that moved there, so the mark always meets the scan before
the next cave frame, and clearing it on contact leaves the cave with no
marks at the end of every scan. There is no second pass to clear flags
(the recipe's model asserts that no cell keeps bit 7). Boulder Dash I
keeps separate "scanned this frame" codes for its moving elements for
the same reason (elmerproductions); the forum thread describes the
states being reset at the end of the frame. Under the recipe's rules,
top-to-bottom order also spreads a column of falling boulders: the upper
one sees the lower one still in place, waits a tick, and a gap opens.

A worked example of the bug, from the recipe's Python model with the
scanned bit left out, whose final cave the unflagged C build matched.
In cave frame 1 Rockford at column 2 is told to step right once. He moves
to column 3; the scan reaches column 3, finds him again and moves him
to 4, and so on: he ends the scan at column 38, having dug the whole
row. A boulder that rolled right off a brick fell two more cells in the
same scan. The run's cave differs from the model with the bit in 47 of
880 cells after 40 cave frames and matches a model without the bit in
all 880.

**Variations.** Boulder Dash's form: a separate element code for each
scanned state instead of a shared bit (elmerproductions lists one per
moving element). A second buffer: read the old grid, write a new one,
swap. That needs no marks but doubles the RAM and costs a copy or a
pointer swap per tick. Scan bottom to top for gravity only: falling
objects then move into cells already passed and need no mark, but
anything that moves up or sideways needs one again. Scrolling: Boulder
Dash drew each object as 2x2 characters and scrolled a window of about
19.5 by 11.5 objects over the cave; with one character per cell, as in
the recipe, the 40x22 cave fits a 40x25 screen with three rows left for
the status line.

**Cave frame rate.** The scan runs on a tick slower than the display.
The recipe runs one cave frame per four display frames, counted by a
raster IRQ (`frame_sync_loop`), and redraws only the cells the scan
changed. The logic-at-a-lower-rate pattern is `logic_rate_decoupling`
above. Boulder Dash's own tick, and how its cave-delay byte maps to it,
are not established here.

**Cycle budget.** Measured in the recipe with CIA1 timer A cascaded into
timer B, display on, VICE x64sc 3.10, Oscar64 -O2. The game cave's
scans took 16,609 to 18,175 cycles on PAL and 17,115 to 18,559 on NTSC:
close to a whole PAL frame of 19,656 cycles, which is why the recipe
scans once per four frames. On NTSC every game scan exceeds the 17,095-cycle
frame (263 x 65, arithmetic), so a scan never fits in one NTSC frame, and
the NTSC figures include one raster-IRQ service that fires inside the
timed scan. A 38x20 interior of dirt costs 14,206 (PAL)
and 14,421 (NTSC), about 19 cycles a cell: the floor for any cave. The
Cost line carries the game cave's slowest scan (18,559, NTSC), which runs
in one burst in the frame it starts in. Plan a cave from the measured
parts: the dirt floor plus about 325 cycles per falling object plus about
610 per moving enemy (arithmetic). A cave where everything moves is a
bound spanning several frames, not a per-frame cost: 380 falling
boulders on odd rows over empty rows took 137,818 cycles on PAL and 138,892 on NTSC, about
seven PAL frames, about 325 cycles per falling boulder over the dirt
floor (that scan's 64-entry dirty list fills after 32 moves and records
no more, so a renderer that records every change costs slightly more).
190 fireflies moving at once cost 130,451 and 131,531, about 610 each.
A cave where everything moves cannot be scanned in one frame in this
C; a scan in assembly would be cheaper, not measured here. The per-cell
floor is the figure to plan around. In Oscar64 the object rules must
stay out of the scan loop: with them inline, the dirt scan took about
48,000 cycles (47,731 when rebuilt with `cell()` inlined).

**Left out of the recipe.** Amoeba, magic wall, explosions, butterflies,
pushing boulders, the exit and the cave timer. A kill removes Rockford
from the cave; nothing explodes.

### Recipes

- `recipes/oscar64/cave-scan.md` — a 40x22 original cave; boulders and diamonds fall and roll, Rockford digs, collects one diamond and is killed by a boulder on a scripted path, one firefly; the cave after 40 cave frames checked against a Python model, scan cycles printed on both models; `-dSCAN_FLAG=0` shows the double move

### Sources

- https://www.elmerproductions.com/sp/peterb/rawCaveData.html (Peter
  Broadribb, Boulder Dash I raw cave data): the 40x22 cave with a steel
  border, the 38x20 play area, the visible area of 19.5 by 11.5
  objects, and the element codes with their "scanned this frame"
  variants, whose purpose it states as stopping an object being scanned
  more than once per frame. Falling boulders kill Rockford; stationary
  ones do not.
- https://www.boulder-dash.nl/forum/viewtopic.php?t=652 ("Cave Scanning
  Order" thread): scan order row by row, top to bottom, each row left to
  right; moved or grown elements take a delay state for the rest of the
  frame; the states reset at the end of the frame. Forum report, not
  measured here.

## game_tree_search — Board-game AI: move generation, evaluation and alpha-beta search within a frame budget

**Complexity:** high
**Region:** both
**Cost:** cycles_per_frame=9316, cycles_per_frame_typical=5325, bytes_code=704, bytes_data=199
**Cost basis:** derived-listing
**Cost measured on:** oscar64-game-tree-search (sliced, four nodes a frame, a bound from four worst calls, NTSC, display on)

**Why.** A board game needs an opponent that looks ahead. The standard
method is to generate every legal move, play each on a copy of the
position, look at the replies to some depth, and score the positions at
the bottom with a static evaluation. On a 1 MHz 6502 the question is how
many positions a second it can visit, and how to spend a fixed number of
frames on one move without freezing the game.

**How.** Five parts.

- **Board.** Use a byte per square with a border of sentinel bytes, so a
  step off the board reads a value that matches no piece and needs no
  bounds test. The recipe's Connect Four board is 8x8 bytes for a 7x6
  game: a sentinel row above and below and a sentinel column, and the
  four line directions are +1, +8, +9 and +7. Chess programs use the
  0x88 layout: the square is a byte with the rank in the high nibble and
  the file in the low one, so `AND #$88` is non-zero exactly when a step
  has left the board. Microchess (below) tests its moves that way.
  Bitboards, one bit per square, suit 64-bit CPUs; on the 6502 every
  shift or mask of a 42- or 64-bit board is six or eight byte operations
  (arithmetic), so a byte array is the usual choice. The bitboard cost
  was not measured here.
- **Move generation.** List the legal moves in the order they will be
  tried. For Connect Four a move is a column and legality is one compare
  with the column's height. Chess needs a table of step offsets per
  piece and a loop along each direction.
- **Make and unmake.** Change the board in place and undo it on the way
  back, rather than copying it per ply. Keep anything the evaluation
  needs up to date in the same two routines: the recipe keeps a sum of
  per-square weights, so a leaf costs a load and a negate.
- **Evaluation.** A static score from the view of one side: material,
  mobility, square weights. The recipe's weight is the number of
  four-in-a-row windows through a cell, 3 in a corner to 13 in the
  middle. A win scores a constant less the ply, so a quicker win scores
  higher and a slower loss scores higher than a quick one.
- **Search.** Negamax with alpha-beta: each ply returns the best value
  for the side to move, a child's value is negated on the way up, and a
  window (alpha, beta) is passed down negated and swapped. When a move
  scores at least beta, the ply stops: the opponent above already has a
  better line and will not allow this one.

**Move ordering.** Alpha-beta cuts most when the best move is tried
first. Counted with the recipe's Python model from the empty board: with
columns tried centre first, a depth-5 search visits 755 positions and a
depth-7 search 6,062; tried left to right, 4,072 and 56,996. Without
pruning a depth-5 search visits 7 + 7^2 + ... + 7^5 = 19,607 (arithmetic;
no game ends that early). A good static order (centre first, captures
first in chess) is worth more than a faster evaluation.

**Iterative deepening under a frame budget.** Search to depth 1, then 2,
then 3, keeping the best move of the last depth that finished. Before
each node, compare a frame counter with the budget; when it runs out,
abandon the unfinished depth and play the kept move. The early depths
are cheap: from the empty board, depths 1 to 5 together visit 7 + 23 +
75 + 172 + 755 = 1,032 positions against 755 for depth 5 alone, 37 %
more (model counts, arithmetic). Trying the previous depth's best move
first at the root cuts that overhead; not measured here. Budget in
frames on the model the game runs on: an NTSC frame is 17,095 cycles and
a PAL frame 19,656 (arithmetic). At the recipe's blocking rates, 901
cycles a node on PAL and 912 on NTSC, that is 21.8 and 18.7 nodes a
frame: the same frame budget buys 14 % fewer nodes on NTSC (arithmetic).

**Transposition table (optional).** Different move orders reach the same
position. A hash of the position (Zobrist: an XOR of one random word per
piece and square, updated in make and unmake) indexes a table of a few
KB holding each stored position's depth, value and best move; a hit
saves the subtree, and the stored best move is a good first move to try.
It pays most at depth; the recipe does not use one, and its gain on a
C64 was not measured here.

**Recursion and the stack.** Written as a recursive function, the search
needs a frame per ply. The 6502's hardware stack is 256 bytes, so an
assembly search keeps its per-ply state in tables indexed by ply and uses
the stack only for return addresses. Oscar64 allocates locals statically
from its call graph and cannot do that for a function that calls itself
(`toolchains/oscar64-reference.md`, "Avoid recursion and function
pointers"); it gives such a function a frame on its software stack.
Measured in the recipe, the recursive build took an 18-byte frame per ply
and ran about 9 % slower (981 cycles a node against 901 on PAL). The
iterative form has a second use: its state is all in the per-ply tables,
so it can stop after any node and go on in the next frame.

**Time slicing.** Give the search a node budget per frame and keep the
game running around it. The recipe's `search_step(n)` makes at most `n`
nodes; when the budget runs out it stores the ply and the side to move
and returns, and the per-ply records (window, best value, next move to
try, move made) hold the rest. The root's state is in the same static
records, so nothing lives on a stack between frames. The budget is
tested before each node, so the returns up the plies after a slice's
last node run in the next slice. Measured in the recipe on PAL and NTSC:
at four nodes a frame the sliced game made the same 42 moves with the
same node counts as the blocking search and the Python model, and the
main loop ran in every one of its 4,880 frames (no frame missed) while
it advanced a spinner and a frame counter. Size the budget from the
worst single node, not the average: the worst `search_step(1)` call was
2,301 cycles on PAL and 2,329 on NTSC, about two and a half times the
average node. The call includes the returns up the plies before its
node and the call itself, and can include badlines and the frame
interrupt; the parts were not separated here. The cost of slicing is time: the recipe's slowest move takes
591 frames, about 11.8 s on PAL, against 103 frames blocking.

**Scores are signed and span the whole range.** Alpha, beta and the
values run from -INF to +INF. A 16-bit compare of `v > best` done with a
subtract and `BMI` gives the wrong order when the difference overflows
(30,000 - (-30,000) does); use the overflow-corrected compare in
`compare_16bit_and_signed`. Choose INF at most 32,767 so that -INF can
be negated.

**Microchess.** Peter Jennings's Microchess (1976, KIM-1) fitted the
program and its data in 924 bytes of the KIM-1's 1,024 bytes of RAM, by
his account (benlo.com). From the source on 6502.org: the position is a
32-byte list of piece squares, one byte per piece, not a board of
squares; a square byte holds rank and file in nibbles and `AND #$88`
rejects steps off the board; each move's from-square, piece, captured
piece and move index are pushed on a second stack, exchanged with the
hardware stack by `TSX`/`TXS`, so the move can be unmade; and a
`REVERSE` routine flips the position so one generator serves both sides.
Jennings describes the search as a state machine that allowed recursion
and a move stack that retraced moves to the starting position. A full
chess engine is larger than this technique's recipe; the parts above
(0x88, piece list, make and unmake from a stack) are the chess-specific
pieces.

**Cycle budget.** Measured in the recipe (Oscar64 1.32.271 -O2, VICE
x64sc 3.10, display on, a one-IRQ-a-frame counter running). Blocking:
901 cycles per node on PAL and 912 on NTSC, averaged over 19,292 nodes,
about 1,090 and 1,120 nodes a second. A node there is make, a
four-direction win test, the leaf or descent step and unmake, for a
seven-column game. The slowest of the 42 depth-5 searches took 2,019,814
cycles on PAL (103 frames) and 2,043,608 on NTSC (120 frames), about two
seconds. The blocking search is multi-frame: its cost must not be summed
into a frame budget. The Cost line's `cycles_per_frame` is the sliced
form at four nodes a frame: four times the worst single call, 4 x 2,329
= 9,316 cycles (the NTSC figure, the larger), half a PAL frame. It is a
bound; the worst four-node slice measured was 5,024 cycles on PAL and
5,325 on NTSC, which the Cost line carries as its typical figure, and a
typical slice is about 4 x 900 (arithmetic from the average). A chess node, with a
longer move generator and evaluation, costs more; not measured here. The
bytes are the search, make, unmake, win test and leaf routines (704) and
the board, weights, move order, per-ply tables at depth 5 and the saved
ply and side (199), from the Oscar64 map.

### Recipes

- `recipes/oscar64/game-tree-search.md` — Connect Four played by the machine against itself at depth 5, 42 moves to a drawn full board, three times: blocking, one node a call and sliced at four nodes a frame with a per-frame counter running and no frame missed; every column and node count of each game checked against a Python model of the same search; nodes per second, cycles per node, frames per move, the worst single call and the worst slice printed on PAL and NTSC; `-dRECURSIVE=1` builds the recursive form

### Sources

- https://benlo.com/microchess/ (Peter Jennings's Microchess history):
  shipped for the KIM-1 in 1976; the program and data in 924 bytes, the
  KIM-1 with 1,024 bytes of RAM; a state machine design allowing
  recursion; a move stack to retrace moves; an evaluation after each
  generated move.
- https://6502.org/source/games/uchess/uchess.htm (Microchess source,
  posted with Jennings's permission; Daryl Rictor's 2002 serial-port
  adaptation): the 32-byte piece list `BOARD` at $50, the `AND #$88`
  off-board test in `CMOVE`, the second stack `SP2` swapped with the
  hardware stack in `MOVE` and `UMOVE`, and the `REVERSE` routine. Read
  for facts only; no code is reproduced here.

---

## creature_state_machine — Many small creatures, each a state machine on pixel probes: walk, climb, turn, fall, dig, build, block

**Complexity:** medium
**Region:** both
**Requires:** destructible_char_terrain, char_bullets
**Cost:** cycles_per_frame=14465
**Cost basis:** measured-vice
**Cost measured on:** oscar64-destructible-terrain (worst frame, 24 creatures, no terrain edits or draw, NTSC)

### Why

A Lemmings-style game has dozens of identical creatures that walk on
their own and change the landscape when told to. Each one is a few
bytes of state and a handful of rules, but the rules must agree with
the terrain to the pixel: a creature that sinks one pixel into a slope
or walks through a thin wall looks broken. The form here runs one small
state machine per creature against pixel probes of the character
terrain in `destructible_char_terrain`, and draws the creatures into
the characters as well.

### How

Keep per creature: x and y of its feet in pixels, a direction of +1 or
-1, a state, a fall counter, a step timer and a brick count. Once per
tick, update every creature in slot order. The recipe's rules, with
`solid(x, y)` the terrain probe (outside the level counts as solid):

| State | Rule each tick |
|---|---|
| walk | `nx = x + dir`. Off the level, or onto a blocker's column within 3 pixels of its height: turn. If `solid(nx, y)`: climb 1 if `(nx, y-1)` is clear, else 2 if `(nx, y-2)` is clear, else turn. Move. If `(x, y+1)` is clear, start falling with the counter at 0 |
| fall | If `(x, y+1)` is solid, land: dead if the counter is over 32, else walk. At the level's bottom, dead. Otherwise move down 1 and count |
| dig | Every 2nd tick. If none of `(x-1..x+1, y+1)` is solid, fall. Else clear those 3 pixels and move down 1 |
| build | Every 4th tick. After 12 bricks, or if `(x+dir, y-1)` is solid, walk. Else set `(x+dir, y)` and `(x+2·dir, y)` and move to `(x+dir, y-1)` |
| block | Nothing. Walkers turn at its column |
| dead | Nothing; not drawn |

Roles (dig, build, block) are given only to a walker; an order to a
creature in any other state is ignored and counted. Blockers go in a
short list when they are given the role, so a walker checks a few
entries, not every creature.

**Drawing.** Creatures are drawn after all updates and removed before
the next tick's updates, so the probes never see them. The recipe draws
each one into the characters the `char_bullets` way: save the code of
each cell the 4-pixel body covers (one or two), copy that glyph into a
code the creature owns, OR the body in, write the creature's code, and
restore in reverse order. In multicolour, OR-ing pair 11 gives the
body the colour-RAM colour over any terrain. Hardware sprites do not
suit this: creatures bunch on the same raster lines (sixteen stand on
one ledge at the end of the recipe), and eight sprites a line is the
limit even with a multiplexer. The cost is two codes per creature from
the charset's 256.

### Why it works

Every rule reads the terrain through the same probe the renderer's
glyphs feed, so a creature stands exactly on the pixels the player
sees. Updating in slot order with the terrain edited in place makes the
result depend only on that order, so a model in another language can
reproduce it: the recipe's Python model and the C agree on every
terrain pixel, position and state after 360 ticks, and on the terrain
after 24 dig steps with the pool cut to 32 codes, where 23 edits are
refused.

The fall counter makes fatal height a rule of the creature, not of the
level. The climb test looks at one or two pixels above the obstacle,
which is what lets a creature walk up a builder's staircase (one pixel
a step) and turn at an 8-pixel wall.

### Variations

- **Blockers in the terrain.** Write an invisible solid mark into a
  collision copy instead of keeping a list; walkers then need no
  blocker check. That needs a second map, since the glyphs are the
  map here. Not built here.
- **Fewer updates per frame.** Stagger the step timers, update in
  groups, or run the logic at a lower rate than the display
  (`logic_rate_decoupling`), when the count does not fit one frame.
  The scheme is under "Many creatures" below.
- **More states.** Climbing walls, floating down and bashing sideways
  are more rows in the same table, each with its own probes.

### Cycle budget

Measured in VICE x64sc 3.10 with the recipe's CIA timers (Oscar64
`-O2`). Worst single creature, over the 360-tick scenario and the
worst-frame subjects:

| Work per creature | PAL | NTSC |
|---|---|---|
| fall | 241 | 241 |
| walk | 562 | 648 |
| dig step (3 terrain edits included) | 1,403 | 1,532 |
| brick (2 terrain edits included) | 1,577 | 1,706 |
| draw, two cells (a 24-creature draw / 24) | about 796 | about 805 |
| restore (1,633 / 24) | about 68 | about 68 |

A probe is 52 cycles. Of a dig step, about 1,356 on NTSC is terrain
work (`destructible_char_terrain`, 32,555 for 72 edits / 24); the
walk, fall and brick figures include the timer reads around each
update.

The Cost line is the creatures' own logic in its worst frame, without
terrain edits and without the draw: all 24 walking into a 2-pixel wall
and climbing it (four probes and a blocker check each), 14,465 cycles
on NTSC and 14,209 on PAL. Terrain edits belong to
`destructible_char_terrain`'s Cost line; a plan adds them per edit.

The draw and restore are the `char_bullets`-style render the recipe
uses, not this technique: 19,319 and 1,633 cycles for 24 creatures on
NTSC (19,104 and 1,633 on PAL). A whole tick with all 24 on a dig
step, restore, updates and draw, took 57,606 on NTSC and 57,299 on
PAL; all 24 laying a brick, 56,701 and 56,357. The scenario's slowest
tick was 27,802 and 27,280.

**How many fit a frame** (arithmetic from these figures, rung 3). The
CIA figures already include the badlines, so the budget is the whole
frame: 19,656 cycles on PAL, 17,095 on NTSC. A walker costs update,
draw and restore: 1,426 on PAL and 1,521 on NTSC, so about 13 and 11
fit. A digger costs a twenty-fourth of the dig tick, about 2,390 and
2,400, so about 8 and 7. With 24 creatures this C cannot run a whole
tick in one frame on either model.

**Many creatures** (Lemmings scale). The recipe's pattern, restore all,
update all, draw all, does not scale. Redrawing all 24 costs 20,952
cycles on NTSC (19,319 + 1,633), more than a frame on its own. And
between the restore and the draw every creature is off the screen for
the whole update, about 36,500 cycles in the dig tick, so they flicker.
This is `full_field_redraw_exceeds_vblank` in another form. What to do
instead, none of it measured here:

- Offset each creature's step timer by its slot, so only a fraction
  act on a given tick: diggers start with `ct = slot & 1`, builders
  with `ct = slot & 3`. Then half the diggers and a quarter of the
  builders edit terrain on any one tick.
- Update in groups across frames. For 24 diggers that is at least 4
  groups on NTSC (57,606 / 4 = 14,402) and 3 on PAL (57,299 / 3 =
  19,100, which leaves little).
- Make the probe look through creature glyphs: a screen code from
  `CR_BASE` up to the pool is a creature's, so read `under[]` for that
  cell instead, again if that is another creature's code. Then no
  restore-all is needed before the updates, and only a creature that
  moved is restored and drawn again.
- Or draw into a second screen and flip `$D018` when it is complete
  (`screen_double_buffer_d018`, the pitfall's listed mitigation). The
  creatures never leave the visible screen. It costs 1 KB, a copy or
  redraw of the changed cells, and a second set of 48 creature codes,
  since the draw rewrites the glyphs of the codes the shown screen
  uses; with the recipe's budget those come out of the pool.

Hand-written assembly would also be cheaper; not measured here.

### Recipes

- `recipes/oscar64/destructible-terrain.md` — 24 creatures released from a hatch, a blocker, two diggers and a builder given their roles at fixed ticks, one fatal-fall rule; terrain and creature states checked against a Python model after 360 ticks; worst frames timed on both models
## seeded_level_fill — A whole level from a seed, three thresholds and a short object list

**Complexity:** low
**Region:** both
**Requires:** lfsr_random
**Cost:** bytes_data=880
**Cost basis:** arithmetic

**Why.** A hand-drawn 40 by 22 tile field is 880 bytes, or a few hundred
after a run-length pass; sixteen of them are a large share of the
memory a game has left. A level made from a seed is two bytes plus a
row of thresholds and a handful of placed objects, and a game can have
as many levels as it has table rows. Determinism is the design value
that makes this safe: the same seed gives the same field on every
machine and every run, so the level a designer tuned is the level the
player gets, and a recorded input script replays true. The game-design
page `../game-design/game-structure.md` gives that property as the one
Liepa wanted for Boulder Dash and the one attract-mode replay depends on.

**How.** One table row per level: a 16-bit seed, thresholds for each
tile class, and an object list. Generation sets the LFSR state from the
seed, then visits every cell in one fixed order, steps the generator
once per cell and reads the low byte of the state. The thresholds are
cumulative: below the first the cell is wall, below the second dirt,
below the third a gem, else empty; the frame round the field is forced
to wall. After the fill, the object list runs and writes over whatever
the fill left in those cells, so the player start, the exit and any
guaranteed items are exact. The difficulty table is the threshold
columns: raising the wall and dirt thresholds and lowering the gem span
makes a denser, poorer field without touching the generator. Clamp the
level index to the last row. Keep a checksum routine over the field as
a test aid: one 16-bit number on screen, or in a byte a harness reads,
says whether a build still generates the level it did last week. The
field is a tile map; a text screen draws it one character per cell as
the recipe does, and a metatile game hands it to its renderer.

**Why it works.** The LFSR is a permutation of its non-zero states, so
from a given seed the sequence of low bytes is fixed and every cell's
class is a pure function of the seed and its position in the visiting
order. The recipe generates level 1 twice into two buffers and finds no
differing byte in 880, with checksum `$1731` both times; level 2's seed
and thresholds give `$D622` (measured in VICE x64sc 3.10, both models).
The low byte over one period takes every value 256 times and zero 255
(`lfsr_random`), so a threshold of `n` selects close to `n` in 256
cells: level 2's thresholds of 64, 192 and 204 gave 290 wall cells of
which 120 are the frame, 400 dirt and 190 empty or sparse-glyph cells in
the picture. That is a proportion, not a guarantee: successive low bytes
of a right-shifting register are correlated, so the field has streaks, and
a design that needs a clean distribution mixes the state, or steps the
register more than once per cell, or takes a byte from a separate
8-bit register.

**Variations.** A solvability check: flood-fill from the player start
through the non-wall cells and require the exit and every guaranteed
gem to be reached; when one is not, step to the next seed and fill
again, and store the seed that passed in the table so the check runs
at design time, not on the player's machine. The design layer's
difficulty pattern asks that a level be finishable with the starting
kit; this is that check for a generated field. Described here, not
built. A zero-seed guard: a table entry of `$0000` never leaves state
zero (`lfsr_zero_state_lockup`, `pitfalls/cpu.md`), so replace it with a
constant before the first step, as the recipe does. A per-level
generator mode byte can select a second tile set or a second threshold
table for the same seed. A larger field than the screen fills a scroll
map in the same pass.

**Cycle budget.** Generation is a level-start cost, not a per-frame
one, so the Cost line above carries only the field buffer (40 by 22)
and no `cycles_per_frame`. The recipe times one call of its generator
with CIA1 timers A and B chained, interrupts off, screen on so badline
stalls are inside the figure: 97,643 cycles on PAL and 98,417 on NTSC,
about five PAL frames for 880 cells, or about 111 cycles per cell with
the loop, the compare chain and the frame test (measured in VICE x64sc
3.10). The LFSR step is a small part of that (`lfsr_random` gives its
per-call figure); the rest is C loop and classification, and an
assembler inner loop would cut it. Spread the fill over several frames
behind a level-start screen if five frames of black matter.

### Recipes

- `recipes/oscar64/seeded-level-fill.md` — three-row table (seed, three thresholds, five objects), 40 by 22 field generated twice and compared, checksums of two seeds, CIA-timed generation, verdict byte and border, levels drawn in turn on both models

---

## bfs_distance_map — One breadth-first flood from the player, sliced across frames, and every chaser steps downhill

**Complexity:** medium
**Region:** both
**Requires:** tile_grid_collision, object_pool
**Cost:** cycles_per_frame=8710
**Cost basis:** measured-vice
**Cost measured on:** oscar64-bfs-distance-map (one 32-cell flood slice, SHOW_DIST 0 build; 10,655 with the digit display the pinned picture shows)

### Why

A maze game with several chasers cannot afford a search per chaser.
`nav_area_pathfinding` cuts a platform level to a dozen areas and
answers from a table, but a tile maze has hundreds of open cells and no
useful areas. `ghost_target_tile_ai` avoids search altogether by steering
toward a target tile, which is right for a maze with no dead ends and
ghosts that may not reverse; in a maze with dead ends it walks into
them. A distance map is the third choice: one flood from the player
gives every cell its distance, and a chaser anywhere finds its next step
by reading four neighbours. The flood's cost is paid once per player
move, not once per chaser, and it is easy to slice across frames.

### How

1. **The map.** One byte per cell, 255 for a wall or a cell not yet
   reached. Keep two: the live map the chasers read and the work map
   the flood writes. Keep a separate wall byte per cell (or the tile
   map itself) so the flood can test a wall without reading the map it
   is filling.
2. **The queue.** A ring of 256 x bytes and 256 y bytes with byte head
   and tail indices; they wrap by themselves. The frontier of a
   breadth-first flood on a screen-sized grid is one or two rings of
   cells, far below 256, so no overflow test is needed. Seed it with
   the player's cell at distance 0.
3. **The slice.** Each frame, pop up to N cells. For each, look at its
   four neighbours: if the neighbour is not a wall and reads 255, write
   the cell's distance plus one and push it. Breadth-first order means
   the first write to a cell is its final distance. When the queue is
   empty, swap the two map pointers. The recipe clears the work map as
   the first two frames of each flood, 440 bytes each, so the clear
   never shares a frame with a full slice.
4. **The trigger.** Remember the cell the current flood started from.
   When no flood is running and the player is on a different cell,
   start one. A flood in progress runs to the end; the player's newer
   position is picked up by the next one. The live map is at most one
   flood old.
5. **The step.** A chaser reads its own cell and its four neighbours
   from the live map and moves to the lowest value that is strictly
   lower than its own; if none is, it stays. Test the neighbours in a
   fixed order and take the first minimum, so a tie is settled the same
   way on every run. Walls are 255 and can never be lower, so no wall
   test is needed for the step.

### Why it works

Breadth-first order visits cells by non-decreasing distance, so each
open cell is written once and popped once: a maze of 404 open cells is
404 pops, whatever the number of chasers. Stepping to a strictly lower
neighbour follows a shortest path, because every cell at distance d has
a neighbour at d minus 1 by construction, and it cannot loop because
the value falls at every step. Two maps make the slicing safe: the
chasers never see a half-flooded map, and the swap is one pointer
exchange. A chaser on a slightly stale map moves toward where the
player was a few cells ago and corrects when the next map lands.

### Variations

- **Flee by stepping uphill.** The same map, read the other way: a
  frightened enemy moves to the highest neighbour below 255. Seeding
  the queue with several cells at distance 0 (the player and its
  bullets, or every chaser to make a map the player's helper avoids)
  gives a distance to the nearest of them in one flood.
- **A cost map.** Give each tile a step cost (mud two, floor one) and
  the plain queue no longer gives shortest routes; a small bucket
  queue, one list per distance value, keeps the pops in order at the
  price of memory. For costs of one and two, two queues suffice.
- **A window round the player.** Flood only a region of r cells round
  the player and stop when the queue empties or the ring is full;
  chasers outside it fall back to walking toward the player's
  coordinates (`ghost_target_tile_ai`'s rule) until they enter the
  window. Cuts the flood to about (2r)² cells.
- **Larger slice, fewer frames.** The recipe's 32 cells per frame is
  about 44% of a PAL frame in Oscar64 and takes fifteen frames per
  flood; an assembler inner loop or a smaller slice moves that trade
  either way. A chaser that moves one cell every four frames does not
  see a map that is fifteen frames old.
- **Chasers as the flood source.** Seeding from the chasers and having
  the player's marker read the map gives the player a "danger" value
  per cell for an escort or an autopilot.

### Cycle budget

Measured in VICE x64sc 3.10 with CIA1 timers, interrupts masked, Oscar64
`-O2` (rung 1). One slice of 32 cells, expanding four neighbours each
and no drawing, is 8,710 cycles on PAL and 9,010 on NTSC, about 272
cycles per cell in C; with each cell's digit and colour drawn as it is
popped, 10,655 and 10,915. The NTSC figures are higher because the
slice runs on past the vertical blank into the badlines, and the CIA
counts the stolen cycles (arithmetic, rung 3). A full flood of 404
cells is 115,912 cycles on PAL as the sum of its slices, over fifteen
frames: two clearing the 880-byte work map at 440 bytes each, thirteen
expanding. Four chasers stepping once is 1,220 cycles for all four
including the timer, so the per-chaser cost is about 300 cycles every
step and nothing between steps. The recipe's whole iteration, actors
lifted and redrawn, one slice, the player and four chasers, peaks at
11,246 cycles on PAL without the digits and 13,196 with them; when the
880-byte clear shared a frame with a slice it peaked at 19,226, over an
NTSC frame, which is why the clear is sliced too.

### Recipes

- `recipes/oscar64/bfs-distance-map.md` — 40 by 22 maze, scripted player route, ring-queue flood at 32 cells per frame into a second map, four chasers stepping downhill every fourth frame, distance digits in colour bands on demand, map compared byte for byte with a Python flood and its checksum, arrival bound and wall check as the verdict, slice and flood cycles on screen, PAL and NTSC

## lane_depth_engine — Beat-em-up depth: plane Y as depth, a persistent Y-sort that sets sprite priority and hit order, and hits gated by a Y window and an active-frame table

**Complexity:** medium
**Region:** both
**Uses registers:** D000, D001, D010, D027
**Requires:** object_pool
**Cost:** cycles_per_frame=1413
**Cost basis:** measured-vice
**Cost measured on:** oscar64-beat-em-up-lanes (four actors: sort, priority draw and hit test in one step, screen on)

### Why

A beat-em-up puts its actors on a ground plane seen from the side and
a little above. Walking down the screen brings an actor nearer the
viewer, so its Y is both a screen position and a depth. Two things
follow that a flat game never meets. A nearer actor must be drawn over
a farther one, whatever order the actors were spawned in, or a fighter
behind another walks through him. And a punch that looks right on
screen must not connect with an actor who is standing a lane away: the
two sprites overlap in X and nearly in Y, and only the plane Y says
they are not on the same ground. `per_frame_hitbox` answers which pair
touched; it does not answer whether the pair shares a lane, and a box
test alone lands hits across lanes all game long.

### How

1. **The plane.** Each actor keeps a plane Y, the line its feet stand
   on, in the actor arrays (`object_pool`). The sprite is placed at
   plane Y less its height. The plane is a band of tile rows; lanes are
   bands of the plane, drawn in different colours so a player can read
   depth, and lane = (plane Y - plane top) / lane height is a HUD and
   AI value, not what the hit test uses.
2. **The sort.** An index array holds the actors far to near and is
   never reset. Each frame an insertion sort repairs it: an actor that
   has not passed a neighbour costs one compare, one that has passed k
   neighbours is shifted k places. This is the persistent sort
   `sprite_multiplex_game` uses; here it runs over a handful of actors.
3. **The priority assignment.** Walk the sorted list from the near
   end and write actor k into hardware sprite k: position, the `$D010`
   bit, the pointer and the colour all move with the actor. The VIC-II
   draws a lower-numbered sprite over a higher one, so the nearest
   actor is sprite 0 and overlaps every other. With a multiplexer the
   same sorted list is the slot order it builds from, and the depth
   order and the raster order agree because both are Y.
4. **The hit window.** For each attacker on an active frame, in sorted
   order, test each other actor: the absolute difference of the two
   plane Ys must be within a small window (six lines in the recipe),
   then the target's X offset, with its sign chosen by the attacker's
   facing, must be inside the reach. The Y compare goes first because
   it fails for most pairs and costs one byte compare.
5. **The active-frame table.** An attack is a short animation; a table
   indexed by its frame says which image to show and a parallel table
   says whether that frame can land. The frame gate is then an indexed
   load, and a flag per attacker stops one attack scoring twice across
   its active frames.

### Why it works

Between sprites the VIC-II has one priority, the sprite number, and it
cannot be changed per pixel or per line except by which actor is in
which sprite. Reassigning sprites from a sorted list turns that fixed
rule into a depth order at the cost of one table walk, and because the
sort is persistent and actors move a line or two a frame, the walk is
almost always the best case. The hit window uses the same plane Y the
sort used, so what the picture shows in front is also what the rules
treat as near; a game that sorts on one value and tests hits on another
has fights that look wrong at the edges. Keying the active frames to
the animation frame ties the moment a punch can land to the frames on
which the punch image is on screen, so the player sees the hit when it
happens.

### Variations

- **Shadow sprites.** A flat shadow sprite at the actor's plane Y under
  each fighter makes depth readable when an actor jumps; the shadow
  stays on the ground and the body leaves it.
- **A jump.** Keep the plane Y as the ground value and add a height;
  the sprite is drawn at plane Y less height, the sort and the hit
  window still use the plane Y, and a stored ground Y means landing
  restores the lane without a search.
- **More actors.** Past eight sprites the priority assignment becomes
  the slot order of `sprite_multiplex_game`, whose persistent sort is
  this one; the hit order still follows the same list.
- **Boxes per frame.** Replace the fixed reach with `per_frame_hitbox`
  boxes emitted at draw time, keeping the plane Y window as the first
  gate before the box compare.

### Cycle budget

Measured in VICE x64sc 3.10 with CIA1 timer B, interrupts masked,
Oscar64 `-O2`, on the recipe (rung 1). The insertion sort over four
actors costs 262 cycles from a reversed order and 157 already sorted,
screen blanked; over the run with the screen on it peaks at 269 on PAL
and 279 on NTSC, badline stalls landing inside it, and bottoms at 174.
The whole engine step, sort, priority draw of four sprites and the hit
test, peaks at 1,413 cycles with the screen on and an attack active,
and is 784 on a frame with no active attack, the sort and the draw
with no pair tests. An earlier version of this section gave that floor
as 84; the recipe's HUD had cut the figure to two digits. The Cost line
carries the peak. A game with more actors pays the pair loop
per attacker on active frames only; the sort grows by one compare per
actor on a quiet frame.

### Recipes

- `recipes/oscar64/beat-em-up-lanes.md` — four-lane tile plane, a player and three enemies on scripts, persistent insertion sort into sprite 0 to 3 by depth, six-line hit window and reach by facing, a six-frame attack with two active frames from a table, hit log re-checked against the window, counts and sort order as the verdict, sort and engine cycles on screen, PAL and NTSC
