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
