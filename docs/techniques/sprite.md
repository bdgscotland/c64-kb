---
category: sprite
chip: VIC-II
---

<!-- doc-type: technique-reference -->

# Sprite Techniques

The VIC-II provides eight hardware sprites (MOBs — Movable Object Blocks) per
frame. Each sprite is a 24×21 pixel bitmap (or 12×21 in multicolor mode) stored
as 63 bytes plus one padding byte (64 bytes, 64-byte aligned). The chip fetches
sprite data via DMA on every raster line where a sprite is enabled — this is
the s-access cycle budget that the CPU pays regardless of register writes.

The eight sprites are individually positioned, colored, expanded, and
prioritized via registers at $D000–$D02E. The fundamental constraint every
sprite technique works around: only eight hardware sprites exist, the frame is
312 lines on PAL (263 on NTSC), and sprite DMA competes with the CPU for bus
access. Everything below describes how to work within, around, or deliberately
against those constraints.

---

## sprite_multiplex_8 — 8-sprite multiplexer

**Complexity:** medium
**Region:** both
**Uses registers:** D015, D000, D001, D027, D012, D019, D01A
**Uses kernal:** (none)

### Why

A game with a scrolling playfield, player character, several enemy types, and
projectiles quickly exceeds eight simultaneous on-screen objects. The VIC-II
provides only eight hardware sprites per frame, but a typical action game needs
twelve to twenty-four distinct moving objects visible at once. The 8-sprite
multiplexer is the first level of the solution: reuse each of the eight hardware
sprites multiple times within a single frame by reprogramming them between
uses.

### How

The core idea is time-division multiplexing along the Y axis. Before the frame
begins, sort your logical sprite list by ascending Y position. Divide the screen
into horizontal bands: the top band gets the first pass of the eight hardware
sprites; below that, after each logical sprite has been drawn, re-arm the
hardware sprites with the attributes of the next logical sprite waiting in line.

In practice:

1. At the start of the frame (or in the vertical blank), write the top eight
   logical sprites to hardware registers ($D000-$D00F, $D027-$D02E, $D015).
2. For each subsequent group of logical sprites, program a raster IRQ at a
   scanline slightly above the Y position of the next group's topmost member.
3. Inside the raster IRQ handler, reprogram each hardware sprite's Y position,
   image pointer (via the sprite pointer block at video\_matrix + $3F8), and
   color ($D027-$D02E) to match the next group's attributes.
4. Acknowledge the interrupt ($D019), re-arm for the group after that, then
   return.

The trick is that the VIC-II reads sprite data on the *current* raster line but
compares the hardware sprite Y register at the *start* of each line. Once the
chip has started drawing a sprite it continues drawing its pixel rows even if
you change the Y register partway through. You can therefore safely repoint the
hardware sprite to a new logical sprite's data as soon as the old one has
started its last pixel row — provided your IRQ fires before the new Y position
is reached.

### Why it works

The VIC-II fetches sprite pointer bytes and pixel data during the portion of
each raster line where the chip has bus priority (p-accesses and s-accesses).
The sprite Y register ($D001, $D003, ...) is compared against the current raster
counter at the *start* of each line to determine whether that sprite's DMA
should fire this line. Once a sprite is vertically "active" (its top scanline
has been reached and the chip is counting through its 21 rows), changes to the
Y register take effect for the *next* activation comparison, not the current
one.

This means the hardware gives you a full 21 lines of safe window per sprite:
after you see the sprite start rendering (raster counter passes its Y), you have
21 lines to change the Y register and pointer to point at the next logical
sprite before the VIC looks for its new activation. The raster IRQ, triggered at
the right Y value via $D012/$D011, fires the CPU just in time to perform those
register writes.

### Variations

**Double-y-frame:** Instead of pure Y-band multiplexing, the interrupt fires
just below each sprite's *bottom* edge. This gives maximum flexibility but
requires careful ordering to avoid races when two logical sprites have nearly
the same Y position.

**Fixed three-pass:** Split the screen into three equal-height bands (roughly
top/middle/bottom thirds). Each band gets a fixed group of hardware sprites.
Less flexible but simpler code and more predictable cycle budget.

**Enable mask only:** A lighter version that skips image/color reprogramming
and only toggles $D015 bits and updates Y positions. Appropriate for
same-image, same-color sprite swarms (bullet patterns, particle effects).

### Cycle budget

On PAL, each raster line is 63 cycles. The interrupt handler overhead
(entry/acknowledge/exit) is approximately 15 cycles on a kernel-routing IRQ
handler. With 8 sprites per group, writing each sprite's Y ($D001+2n), image
pointer (screen + $3F8 + n), and color ($D027+n) costs 3 stores × 4 cycles
each = 12 cycles per sprite × 8 sprites = 96 cycles. You therefore need at
least 2 lines of slack between the IRQ trigger line and the first new sprite's
Y position to safely complete all writes before the VIC latches the next
activation. In practice, target 3–4 lines of slack.

### Recipes

- `recipes/oscar64/sprite-multiplex-8.md`

---

## sprite_multiplex_24 — Up to 24+ sprites via raster reuse

**Complexity:** scene-tier
**Region:** both
**Uses registers:** D015, D000, D001, D002, D003, D004, D005, D006, D007, D008, D009, D00A, D00B, D00C, D00D, D00E, D00F, D010, D027, D028, D029, D02A, D02B, D02C, D02D, D02E
**Uses kernal:** (none)

### Why

The basic 8-sprite multiplexer described above can extend to 16 in a
straightforward two-pass design. Going beyond 16 — to 24, 32, or more — requires
tighter IRQ scheduling, Y-sorted lists, and careful management of the MSB X
register ($D010) across passes. Scene-tier demoscene sprite engines routinely
display 30+ logical sprites on PAL systems by splitting the frame into three or
more reuse passes. Games needing large enemy crowds, parallax-layer overlays, or
sprite-based status bars use the same approach.

### How

The algorithm scales naturally from the 8-sprite multiplexer:

1. **Sort by Y:** Before each frame, sort the entire logical sprite array by
   ascending Y position. Oscar64's `vspr_sort()` performs an insertion sort,
   which is cache-friendly and fast on nearly-sorted lists (typical across
   consecutive frames).

2. **Assign the first eight to hardware directly:** The top eight logical
   sprites (lowest Y values) are written to hardware at frame start.
   `vspr_update()` handles this, writing all eight positions, images, colors,
   and the MSB-X byte ($D010) in one pass.

3. **Schedule reuse IRQs for subsequent groups:** For each group beyond the
   first, `vspr_update()` calls `rirq_move()` to place a raster IRQ just above
   the first sprite in that group. The raster IRQ code template writes the new
   Y position, X position (low byte), image pointer, and color for the
   corresponding hardware sprite slot.

4. **MSB-X accumulation:** Sprites whose X position exceeds 255 require bit n
   of $D010 to be set. Because $D010 covers all eight sprites in a single byte,
   mid-frame updates must accumulate the correct combined mask. `vspr_update()`
   computes a running `xymask` that encodes the MSB bits for all active sprites
   and writes it into each raster IRQ block.

5. **Synchronization:** `rirq_wait()` pauses the main loop until the last raster
   IRQ has completed, ensuring `vspr_sort()` and `vspr_update()` are never called
   while the raster IRQ list is being consumed by the chip.

### Why it works

Oscar64's virtual sprite system (`vspr_*` API) implements this algorithm using
the `rasterirq` library's sorted IRQ slot table. Each reuse pass beyond the
first gets one slot in the `spirq` array (up to `VSPRITES_MAX - 8` entries, 8
by default for 16 total; raise `VSPRITES_MAX` to extend). The raster IRQ
executor in `rasterirq.c` fires each slot when the raster counter matches the
programmed line, writes up to five register values per slot, and immediately
re-arms for the next slot. Because the IRQ code is pre-built (the templates are
populated at `vspr_init` time and only the data bytes change each frame), the
per-slot overhead is dominated by the five STA instructions in the template —
roughly 25 cycles per reuse event.

For 24 sprites (three passes), PAL has 312 × 63 = 19,656 total cycles per frame
with roughly 200 lines of display area. Three passes spaced 67 lines apart each
cost about 40 cycles (handler overhead + five writes), leaving the remaining
~19,400 cycles for game logic. The real constraint is Y-band density: if ten
logical sprites cluster within a 21-line band, you only get one pass over them,
not ten; duplicates at the same Y simply are not all visible simultaneously.

### Variations

**32+ sprites:** Raise `VSPRITES_MAX` beyond 16 (rebuild required). Each
additional 8 logical sprites adds one raster IRQ slot and one 21-line minimum
gap. On PAL, up to roughly 48 logical sprites before IRQ overhead exceeds 10%
of total frame cycles.

**Per-sprite priority within a pass:** Within one pass (one set of eight
hardware sprites), hardware priority is fixed: sprite 0 is always in front of
sprite 1. Design the sort order so that in areas of overlap, the intended
top-priority sprite ends up in a lower-numbered hardware slot.

**Cross-reference:** The Phase 4 deep recipe `recipes/kickassembler/sprite-multiplex-24.md`
demonstrates a hand-scheduled KickAssembler version with
cycle-exact slot placement for demoscene use.

### Cycle budget

Three passes on PAL, spaced 67 lines apart: each pass IRQ costs approximately
40 cycles (entry, five STAs, exit). Three passes = 120 cycles. Sorting 24
sprites per frame costs roughly 80–100 cycles (insertion sort on a nearly-sorted
list). Total sprite-system overhead: under 250 cycles per 19,656-cycle frame
(~1.3%).

### Recipes

- `recipes/oscar64/sprite-multiplex-8.md` (scales directly; raise VSPRITES_MAX)

---

## sprite_expand — Hardware-expand sprites

**Complexity:** low
**Region:** both
**Uses registers:** D017, D01D
**Uses kernal:** (none)

### Why

A standard C64 sprite is 24×21 pixels — small enough to look crisp at C64
resolution but too small for boss characters, large vehicles, title-screen
logos, or any object that needs to dominate the screen. Drawing a 48×42 sprite
by storing the full 48×42 bitmap would require four 64-byte sprite blocks laid
out as a 2×2 grid, plus positioning math. Hardware expansion achieves the same
visual result at zero extra memory cost and zero extra DMA bandwidth.

### How

$D01D (XXPAND) controls X expansion and $D017 (YXPAND) controls Y expansion.
Each register is a bitmask: bit n = 1 expands hardware sprite n by 2× in the
respective axis.

To double the size of sprite 3 in both axes:

- OR bit 3 into $D01D: sprite 3 now renders 48 pixels wide.
- OR bit 3 into $D017: sprite 3 now renders 42 lines tall.

The registers are independent, so X-only, Y-only, or both expansions are all
valid. The sprite image data remains the original 63-byte block; the chip
simply repeats each pixel column twice (X expansion) or each pixel row twice
(Y expansion) during output.

### Why it works

During sprite DMA the VIC-II reads the 63 data bytes for each active sprite once
per "sprite line" — its internal row counter. With X expansion enabled, the chip's
horizontal shift register clocks each pixel bit onto the output bus twice instead
of once, stretching each pixel to two display clocks wide (two pixels on screen).
With Y expansion enabled, the chip's internal row counter increments only on
every *second* raster line instead of every line, so the same bitmap row is output
twice, doubling the visible height.

The result is 2× linear scaling with no antialiasing, producing visibly blocky
edges at close range. This is generally acceptable for game objects (the C64
aesthetic tolerates visible pixels) and is often desirable for close-range
boss-fight scaling effects.

Combined X+Y expansion produces a 48×42 sprite that costs the same DMA bandwidth
as an unexpanded sprite: the chip still fetches exactly 63 bytes of data per 21
chip-internal rows.

### Variations

**Single-axis expand for squash-and-stretch:** Animate the Y-expand bit across
frames to simulate a bouncing ball compressing and expanding. The binary
nature of hardware expansion means the effect is coarse, but readable at
C64 pixel sizes.

**Mixed expanded/unexpanded sprites:** Sprite 0 (the player) can be fully
expanded while sprites 1–7 (small bullets) are unexpanded — the registers are
per-sprite. Mix freely.

**Fake 48×84 via two Y-expanded sprites stacked:** Two Y-expanded sprites at
the same X but offset 42 lines apart produce a visual object 84 lines tall —
two-thirds of the PAL screen height.

### Recipes

- `recipes/oscar64/sprite-multiplex-8.md` (demonstrates `spr_expand()` usage)

---

## sprite_collision_detect — Sprite-sprite and sprite-background collision

**Complexity:** low
**Region:** both
**Uses registers:** D01E, D01F
**Uses kernal:** (none)

### Why

Every action game needs collision detection: player versus enemy, bullet versus
enemy, player versus terrain. Software bounding-box tests are fast but require
explicit bounding-box data per sprite. The VIC-II provides hardware collision
detection as a free by-product of its rendering pipeline: the chip tracks pixel
overlap automatically and latches results in two read-only registers.

### How

**Sprite-sprite collision ($D01E, SPSPCL):** Each bit n is set whenever any
non-transparent pixel of sprite n overlaps any non-transparent pixel of any
other enabled sprite during rendering. The register is *read-to-clear*: as soon
as you read $D01E, all bits reset to zero. A nonzero value means at least one
collision occurred since the last read.

**Sprite-background collision ($D01F, SPBGCL):** Each bit n is set whenever any
non-transparent pixel of sprite n overlaps a *foreground pixel* in the current
display mode (any pixel that is not background color 0 in text/bitmap modes).
Also read-to-clear.

Typical polling pattern: once per frame (in the vertical blank or at the end of
the main game loop), read $D01E and $D01F and store both values. Then inspect
the stored values:

- A nonzero $D01E value with two or more bits set means those two sprites
  physically overlapped at the pixel level.
- A nonzero $D01F value means the sprite with that bit set touched a solid
  foreground pixel.

### Why it works

The VIC-II's sprite renderer maintains two internal shift registers per sprite:
one for the sprite's own pixels and one tracking whether any other sprite pixel
was active at the same screen position. When both are nonzero on the same clock,
the sprite-sprite latch fires. The sprite-background latch fires when a sprite
pixel is nonzero at the same position as a non-transparent background pixel from
the display data.

The latch is set by the chip during the *raster scan* — before the CPU ever sees
the result. This means the hardware has already resolved sub-pixel-exact
rectangular overlap by the time the CPU reads the register at end-of-frame.

The read-to-clear mechanic is a hardware simplification: there is no separate
write-clear path. The register's internal flip-flops reset on the read cycle.

### The "sticky" problem

A common pitfall: if you read $D01E inside an interrupt handler *and* again in
your main loop, the second read sees zeros because the interrupt already cleared
it. Read each register *once* per frame and cache the value in a RAM variable.

A second pitfall: the registers report which sprites were involved, not which
specific pair collided. With sprites A, B, C all overlapping, all three bits
are set. Distinguishing game-relevant pairs requires software reasoning on
the bit pattern.

### Variations

**IRQ-driven collision:** Enable the sprite-sprite or sprite-background
collision IRQ via bits 1–2 of $D01A (IRQMSK). The VIC fires the CPU IRQ line
on the same cycle the collision is latched. This gives sub-frame-latency
collision response, useful for precise physics reactions. Acknowledge by writing
the corresponding bit in $D019.

**Multicolor sprite collision:** Multicolor sprites have transparent pixels
between their double-wide colored pixels (the %00 pattern bits are transparent).
The hardware collision test correctly ignores transparent pixels, so collision
boundaries track visual content rather than bounding boxes.

### Recipes

- `recipes/oscar64/sprite-multiplex-8.md` (demonstrates reading $D01E in game loop)

---

## sprite_y_stretch_glitch — Y-expand glitch (sprite crunch)

**Complexity:** high
**Region:** both
**Uses registers:** D017
**Uses kernal:** (none)

### Why

The VIC-II's Y-expansion mechanism contains a documented timing quirk: if $D017
is cleared at the exact raster line where the chip's internal expansion toggle
would normally flip, the chip loses track of which "half line" it is on. The
result is that the sprite's row counter stalls, repeating one or more rows
indefinitely until the register is written again. Demoscene coders call this
the "sprite crunch" or "Y stretch glitch." While accidental sprite crunch is a
bug, deliberate use produces stretchable sprites taller than 42 lines — up to
the full screen height.

### How

The VIC-II's Y expansion works via an internal toggle bit, called MCBASE in the
Commodore 64 Programmer's Reference Guide and the Frodo/VICE emulator source.
On each raster line, if the corresponding $D017 bit is set, the chip toggles
the MCBASE flag instead of incrementing the sprite row counter. When MCBASE is
0 (first half), the row counter holds; when it is 1 (second half), the row
counter increments. This is how each row is displayed twice.

To crunch a sprite:

1. Enable Y expansion on the target sprite ($D017 bit n set).
2. Wait for the raster line immediately preceding the sprite's first rendered
   row (Y-1). At that line, clear bit n in $D017 (disable Y expansion).
3. The chip evaluates the expansion toggle at the line boundary. Because
   $D017 was cleared before the evaluation, the MCBASE flag is not toggled but
   the row counter is also not incremented — the chip is left in a half-expanded
   state where it never advances.
4. Re-enable $D017 on a later line to "unstick" the sprite. The number of
   scanlines between disable and re-enable determines how many extra rows are
   emitted before the sprite continues normally.

The write to $D017 must happen with cycle precision on the correct raster line.
A stable raster IRQ (see `raster.md`, `stable_raster_irq`) is a prerequisite.

### Why it works

The VIC-II checks the expansion toggle on the line where the sprite's Y register
matches the raster counter. The check happens in the phi1 half-cycle when the
VIC has the bus. If $D017 is 0 for that sprite at that instant, the chip marks
the sprite as "not expanded this line" and increments the row counter — but the
sprite is also not in the normal unexpanded path, because the transition away
from expansion mode left the internal state machine in an inconsistent state.
On the 6569 PAL chip (and most 8565 HMOS-II parts), this inconsistency causes
the row counter to freeze rather than increment.

The exact cycle window for the clearing write is chip-revision-dependent. On
the 6569, the write must occur in cycles 55–56 of the preceding line (using the
raster-cycle numbering from the Vic-II article). The 8565 (HMOS-II) is slightly
more forgiving due to its longer input setup time.

### Variations

**Partial stretch:** Crunch for only a few lines to produce a wavy
magnification effect — useful for heat-shimmer or water-reflection animations.

**Full-screen tall sprite:** Crunch from line 50 to line 250 for a sprite that
spans most of the PAL display height. Combined with a raster color bar the same
width as the sprite, this technique was used for title-screen waterfalls and
flag animations in 8-bit demoscene productions.

**Crunch with multicolor:** The crunch also works on multicolor sprites. Because
multicolor sprites are already half-resolution horizontally, the vertical crunch
produces a 12×tall result, useful for very tall but narrow design elements.

### Cycle budget

The critical window is 2 cycles wide on the 6569, located at raster cycles 55–56
of the line preceding the sprite's Y position. The write itself is 4 cycles (STA
absolute). A stable raster IRQ fires the CPU approximately 3 cycles before cycle
55 (with a nop sled for fine adjustment). Total IRQ entry + alignment + STA = 15
cycles. Crossing the line boundary costs nothing — the VIC does that automatically.

---

## mob_priority — Background-priority via $D01B

**Complexity:** low
**Region:** both
**Uses registers:** D01B
**Uses kernal:** (none)

### Why

By default, VIC-II sprites render on top of everything — characters, bitmap
pixels, even other sprites of higher index. For many game effects you want
a sprite to appear *behind* the playfield: a character walking behind a tree,
an enemy partially obscured by a wall tile, a shadow below a platform. Without
hardware priority, you would need to composite the sprite manually into the
screen data, which is expensive. $D01B provides per-sprite priority control at
zero CPU cost during rendering.

### How

$D01B (SPBGPR) is an 8-bit register where bit n controls sprite n's foreground
priority:

- Bit n = 0 (default): sprite n renders in front of all foreground pixels.
- Bit n = 1: sprite n renders *behind* foreground pixels but still in front of
  background color 0.

To make sprite 4 appear behind solid tiles: OR bit 4 into $D01B (`$D01B |= %00010000`).
To restore it to the front: AND the complement (`$D01B &= ~%00010000`).

The write takes effect immediately for the remainder of the current frame at the
sprite's current raster position. For clean visual results, update $D01B in the
vertical blank or at least before the sprite's first rendered line.

### Why it works

The VIC-II's output multiplexer operates in priority order during each pixel
clock. When rendering a pixel, the chip evaluates (from highest to lowest
priority): sprites 0–7 (in index order), then foreground pixels, then background.
However, if a sprite's $D01B bit is set, the chip inverts that sprite's position
in the priority stack: foreground pixels win over it, while background pixels
still lose. Background-priority sprites therefore appear to "punch through" the
sprite layer into the background layer, letting foreground pixels obscure them.

One important constraint: sprite-vs-sprite priority is **not** affected by
$D01B. Sprite 0 is always in front of sprite 1 regardless of their $D01B bits.
$D01B only modulates each sprite's relationship with the *background plane*.

A second constraint: the background-priority check uses the *rendered* foreground
signal, not the color value. The border region counts as background for this
purpose, so a sprite set to background priority that moves into the border area
becomes fully visible again (it re-enters front-of-background territory).

### Variations

**Layered depth via mixed priority:** Sprites 0–3 with $D01B = 0 appear in front
of everything. Sprites 4–7 with $D01B bits set appear behind solid foreground
tiles. Used in platform games to give a sense of depth between character layers
and the environment.

**Dynamic priority switching:** Switch a sprite's $D01B bit mid-frame (via
raster IRQ) to create a sprite that enters a "tunnel" (goes behind tiles) and
exits (returns to front) at precise screen positions.

**Collision interaction:** $D01B does not disable $D01F (sprite-background
collision). A background-priority sprite still registers collisions with
foreground pixels even when rendered behind them.

### Recipes

- `recipes/oscar64/sprite-multiplex-8.md` (shows `spr_set()` priority parameter)

---

## sprite_color_swap_mid_line — Recolor sprites within a scanline

**Complexity:** high
**Region:** both
**Uses registers:** D027, D028, D029, D02A, D02B, D02C, D02D, D02E
**Uses kernal:** (none)

### Why

A VIC-II sprite has one individual color register ($D027–$D02E). That color
applies uniformly to every pixel of the sprite across all 21 rows. If you want
a sprite to show a color gradient — a flame that transitions from white at the
center to orange to red at the edges, for example — the single color register
is the bottleneck. The solution is to change the color register mid-frame, on
a specific raster line, while the sprite is actively rendering. This produces
a sprite with visually distinct color bands at the cost of a tightly-timed
write.

### How

The technique requires a stable raster IRQ (see `raster.md`, `stable_raster_irq`).
The steps are:

1. Set the sprite's color to the desired *top band* color in $D027+n before the
   sprite's first row is rendered.
2. Schedule a raster IRQ to fire on the scanline where the color change should
   occur (e.g., 7 rows into the sprite's 21-row height).
3. Inside the IRQ, write the new color to $D027+n. The VIC reads the color
   register once per pixel, so the write takes effect on the *next* pixel clock
   after the CPU write completes. With a stable IRQ and a cycle-counted write
   placement (using NOP sled or `rirq_delay()`), the color boundary lands on a
   precise horizontal position.
4. Repeat for additional color bands.

To create a *vertical* gradient (top half one color, bottom half another),
schedule the IRQ on the correct row boundary. To create a *horizontal*
boundary (left half one color, right half another), place the write at the
correct cycle within the scanline after the sprite starts rendering.

### Why it works

$D027–$D02E are standard memory-mapped I/O registers. The VIC-II reads the
color for sprite n once per pixel clock when sprite n's shift register is
outputting a non-transparent pixel. There is no internal color latch per sprite
that holds the value for the whole line — the chip reads the register each time.
A CPU write to $D027+n that completes partway through a horizontal scan therefore
splits the sprite's pixel output into two color regions: pixels rendered before
the write use the old color, pixels after use the new one.

The cycle precision requirement comes from the VIC-II bus timing. On a PAL
machine running at 0.985 MHz, each cycle is approximately 1 microsecond. The
sprite's 24-pixel output spans 24 color clocks (approximately 6 CPU cycles in
hires mode, or 12 in multicolor). To achieve a specific horizontal split, the
write must complete within ±1 CPU cycle of the target clock. This demands a
stable IRQ with no jitter and a fixed cycle offset from the IRQ entry point to
the STA instruction.

### Variations

**Per-sprite gradient:** Apply independent color swap schedules to multiple
sprites, each with its own raster IRQ slot. With 8 sprites and 2 color bands
each, you can schedule 16 IRQ writes spread across the frame.

**Animated gradient:** Each frame, shift the color band assignments up or down
by one row by adjusting the IRQ trigger line. The result is a scrolling color
wash moving through the sprite.

**Multicolor sprite color swap:** In multicolor mode, the sprite has three
color registers: the individual color ($D027+n) and two shared colors ($D025,
$D026). All three can be swapped mid-line. Changing $D025 mid-frame affects
every multicolor sprite simultaneously — useful for palette flashes but
destructive if sprites need independent colors.

**Combined with Y-expand glitch:** A color swap on a Y-crunched sprite produces
banded gradients on tall stretched sprites — flame and waterfall effects.

### Cycle budget

On PAL, a sprite occupying screen columns 24–47 renders its hires pixels during
approximately CPU cycles 30–35 of the raster line (using the VIC-II dot clock
to CPU cycle mapping). A stable IRQ entry at cycle 0 of the target line needs a
30-cycle delay before the STA to hit the sprite's left edge, or a 33-cycle delay
for a midpoint split. Use `rirq_delay()` (5 cycles per unit) plus NOP padding
(2 cycles) for sub-5-cycle alignment. Total IRQ cost per swap: approximately 50
cycles (entry 15 + delay 30 + STA 4 + exit 4), fitting comfortably within one
raster line.

### Recipes

- `recipes/oscar64/sprite-multiplex-8.md` (see rirq_write / rirq_delay patterns)
