---
category: sprite
chip: VIC-II
---

<!-- doc-type: technique-reference -->

# Sprite Techniques

The VIC-II provides eight hardware sprites (MOBs — Movable Object Blocks) per
frame. Each sprite is a 24×21 pixel bitmap (or 12×21 in multicolor mode) stored
as 63 bytes plus one padding byte (64 bytes, 64-byte aligned). The chip fetches
sprite data via DMA only on the raster lines where a sprite is vertically
active (its 21, or 42 expanded, lines): two stolen CPU cycles per active sprite
per line plus a 3-cycle BA lead-in, up to 19 per line with all eight — the
s-access budget the CPU pays whether or not you touch a register. (The
pointer p-access happens every line for every sprite, enabled or not, and costs
the CPU nothing; an earlier version of this paragraph said data DMA runs on
every line a sprite is enabled.)

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
**Demands:** midframe_raster_irqs, changes_sprite_set

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

On PAL, each raster line is 63 cycles. Through the KERNAL vector ($0314) your
handler's first instruction runs 36 cycles after the interrupt is taken — 7 for
the interrupt sequence and 29 for the $FF48 dispatcher (PHA TXA PHA TYA PHA TSX
LDA $0104,X AND #$10 BEQ JMP ($0314)) — plus 0–6 cycles of jitter from the
interrupted instruction, and more if the interrupt lands on a badline.
Acknowledging $D019 costs about 6 more, and the bare exit through $EA81 (PLA
TAY PLA TAX PLA RTI) 22, so the round trip is about 64 cycles, a full raster
line, of which the 36–42 before your first write are what eat into the slack.
Banking the KERNAL out and pointing $FFFE/$FFFF at the handler removes the
29-cycle dispatcher. (An earlier version of this section put the whole
entry/acknowledge/exit overhead at about 15 cycles, which is not consistent
with the 29-cycle dispatcher documented in `raster.md`.) With 8 sprites per
group, writing each sprite's Y ($D001+2n), image pointer (screen + $3F8 + n),
and color ($D027+n) costs 3 stores × 4 cycles each = 12 cycles per sprite × 8
sprites = 96 cycles. Entry of 36–42 cycles plus 96 cycles of writes is 132–138
cycles, already more than two 63-cycle lines, so you need at least 3 lines of
slack (not 2, as this section used to say) between the IRQ trigger line and the
first new sprite's Y position to complete all writes before the VIC latches the
next activation. In practice, target 3–4 lines of slack.

### Recipes

- `recipes/oscar64/sprite-multiplex-8.md`

---

## sprite_multiplex_24 — Up to 24+ sprites via raster reuse

**Complexity:** scene-tier
**Region:** both
**Uses registers:** D015, D000, D001, D002, D003, D004, D005, D006, D007, D008, D009, D00A, D00B, D00C, D00D, D00E, D00F, D010, D027, D028, D029, D02A, D02B, D02C, D02D, D02E
**Uses kernal:** (none)
**Demands:** midframe_raster_irqs, changes_sprite_set

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

3. **Schedule reuse IRQs per hardware slot:** For each logical sprite beyond
   the first eight (sorted index ti+8, hardware slot ti & 7), `vspr_update()`
   calls `rirq_move(ti, spriteYPos[ti + 1] + 23)` — the raster line two below
   the bottom of the sprite that slot is currently showing (the previous
   occupant's Y + 21 lines + 2 lines of IRQ latency margin), not a line derived
   from the incoming sprite's Y. It then stores the incoming sprite's Y, X (low
   byte), image pointer, colour and the accumulated $D010 mask as that slot's
   five data bytes (`rirq_data`). Once the next incoming sprite's Y is ≥ 250,
   that slot and all later ones are cleared (`rirq_clear`). There are no fixed
   eight-sprite "groups" or "passes": each slot is reused as soon as its own
   previous sprite has finished, and the `80 + 4*i` rows set in `vspr_init()`
   are placeholders overwritten every frame. (An earlier version of this step
   said the IRQ was placed "just above the first sprite in the group"; the
   incoming sprite's Y is only written as data — `sprites.c` L318/L330.)

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
the `rasterirq` library's sorted IRQ slot table. Each virtual sprite beyond the
first eight gets one slot in the `spirq` array (`VSPRITES_MAX - 8` entries, 8
by default for 16 total; raise `VSPRITES_MAX` to extend). The raster IRQ
executor in `rasterirq.c` fires each slot when the raster counter matches the
programmed line, runs that slot's code template, and immediately re-arms for
the next slot. The template is not just "five STAs": each `rirq_build` template
starts with a raster busy-wait (LDY #/LDX #/CMP $D012/BCS) that holds the CPU
from the IRQ at row−1 (row−2 via the KERNAL vector) until $D012 reads row+1,
then does the five writes (Y, X low byte, image pointer, colour, $D010 mask),
re-arms $D012/$D019 and exits. Measured in VICE (PAL, `rirq_init_io`, RAM
vector): about 160 cycles of handler code plus the wait, roughly 225–280 cycles
stolen per slot (about 3.5–4.5 raster lines); via `rirq_init_kernal` about
300–330 cycles. An earlier version of this section put a slot at "roughly 25
cycles", which counted only the five stores and none of the entry, busy-wait,
re-arm or exit.

Because `vspr_init` builds one slot per virtual sprite beyond the first eight
(hardware sprite i & 7, moved to that sprite's Y + 23 each frame), 24 vspr
sprites cost 16 reuse IRQs per frame — roughly 16 × 250 ≈ 4,000 cycles, about
20 % of PAL's 312 × 63 = 19,656 cycles per frame, not the 120 cycles this
section used to claim. A hand-scheduled three-pass multiplexer that rewrites
all eight sprites per IRQ (as the KickAssembler recipe does) is a different
design with three IRQs per frame; the figures above are for the `vspr_*`
per-slot design. The other constraint is Y-band density: if ten logical
sprites cluster within a 21-line band, you only get one pass over them, not
ten; duplicates at the same Y simply are not all visible simultaneously.

### Variations

**32+ sprites:** Raise `VSPRITES_MAX` beyond 16 (rebuild required; pass it as
`-dVSPRITES_MAX=24` on the Oscar64 command line, since a `#define` in your own
file does not reach `sprites.c`, and raise `NUM_IRQS` with it or `rasterirq.c`
warns "Index out of bounds"). Each additional logical sprite adds one raster
IRQ slot and needs a 21-line gap below its slot's previous occupant. With vspr
slots at ~250 cycles each, 10 % of a PAL frame is about eight reuse IRQs, i.e.
about 16 logical sprites — not the "roughly 48" this section used to say,
which assumed 25-cycle slots.

**Per-sprite priority within a pass:** Within one pass (one set of eight
hardware sprites), hardware priority is fixed: sprite 0 is always in front of
sprite 1. Design the sort order so that in areas of overlap, the intended
top-priority sprite ends up in a lower-numbered hardware slot.

**Cross-reference:** `recipes/kickassembler/sprite-multiplex-24.md` is the
fixed three-band variant (the "Fixed three-pass" option above) in
KickAssembler: one raster IRQ above each band rewrites all eight hardware
slots, with no per-frame Y sort and nothing cycle-exact; the recipe's own text
says what that restriction costs. (An earlier version of this paragraph called
it a hand-scheduled, cycle-exact demoscene multiplexer, which it is not.)

### Cycle budget

With Oscar64's `vspr_*` system and `VSPRITES_MAX=24`, each of the 16 reuse
slots costs roughly 225–280 cycles (entry, busy-wait to row+1, five writes,
re-arm, exit — measured in VICE, PAL, RAM vector), about 4,000 cycles per
frame. `vspr_sort()` (`sprites.c`, a byte-array insertion sort) costs about
1,100 cycles per frame on an already-sorted list (~44–48 cycles per element ×
23), about 1,750 when one sprite has moved past a neighbour, and about 10,000
in the worst reverse-order case, measured in VICE with a CIA timer; the
16-sprite default already costs ~750 cycles sorted. Sort overhead alone is
therefore ~5.7 % of a 19,656-cycle PAL frame, and with the reuse IRQs (and
`vspr_update()`, not measured here) the total is well over 5,000 cycles, more
than a quarter of the frame. An earlier version of this section gave "40 cycles
per pass, 80–100 cycles to sort, under 250 cycles total (~1.3 %)"; every one of
those figures was too small by an order of magnitude, and they described a
three-pass design that `vspr_*` does not implement.

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

**Fake 48×84 via two expanded sprites stacked:** Two X+Y-expanded sprites at
the same X but offset 42 lines apart produce a visual object 84 lines tall —
about 42 % of the 200-line display window (three stacked reach 126). An
earlier version of this paragraph called 84 lines "two-thirds of the PAL screen
height"; two-thirds of 200 is 133.

### Recipes

- `recipes/kickassembler/sideborder-open.md` (sets $D017 Y-expand for 42-line
  sprite DMA). No Oscar64 recipe calls `spr_expand()`; an earlier version of
  this list pointed at `recipes/oscar64/sprite-multiplex-8.md`, which does not
  use it.

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
non-transparent pixel of sprite n overlaps a *foreground* pixel of the display,
where foreground means: in standard hires text and hires bitmap, any pixel not
drawn in background colour 0 ($D021); in ECM, any pixel not drawn in one of
BGCOL0–3 — the four background colours are all background; in multicolor text
and multicolor bitmap, only the %10 and %11 bit-pairs — %01 pixels (BGCOL1/$D022
in MC text, the video-matrix high nibble in MC bitmap) count as background and
do NOT set $D01F. This is the same foreground/background split that $D01B
priority uses. Measured in VICE x64sc (solid sprites over MC-text, MC-bitmap
and ECM cells: $D01F = $2E, $2E, $28); an earlier version of this section said
any pixel not in background colour 0, which over-reports collisions on MC %01
and ECM BGCOL1–3 pixels. Also read-to-clear.

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

- `recipes/oscar64/simple-shmup.md` (reads $D01E/$D01F each frame). An earlier
  version of this list pointed at `recipes/oscar64/sprite-multiplex-8.md`,
  which never reads the collision registers.

---

## sprite_y_stretch_glitch — Y-expand glitch (sprite crunch)

**Complexity:** high
**Region:** both
**Uses registers:** D017
**Uses kernal:** (none)
**Demands:** midframe_raster_irqs
**Requires:** stable_raster_irq

### Why

The VIC-II's Y-expansion mechanism contains a documented timing quirk: if a
sprite's $D017 bit is cleared on one particular cycle of one of its display
lines while its DMA is running, the sprite's remaining length changes — once,
by a data-dependent amount — and the sprite then ends on its own. Demoscene
coders call this the "sprite crunch"; the per-line variant that is meant to
hold a sprite on one row is the "Y stretch". An earlier version of this section
said a single clear at line Y−1 makes "the sprite's row counter stall,
repeating one or more rows indefinitely until the register is written again".
Measured in VICE x64sc (PAL), that is wrong on both counts: a clear at Y−1, or
anywhere on the first display line, simply gives a plain unexpanded 21-line
sprite, and a crunching clear on a later line lengthened the sprite by 4, 16 or
21 lines and then let it finish well before $D017 was touched again. Nothing
is left "stuck" waiting for a re-write.

### How

The VIC-II's Y expansion works via a per-sprite flip-flop — the "advance line"
flip-flop in Bauer's VIC-II article (older editions and the VICE source call it
the expansion flip-flop, `exp_flop`). It is held set while the sprite's $D017
bit is clear; while the bit is set and the sprite's DMA is on, it is inverted
in cycle 56 of every line. In cycle 16 of the next line, only if the flip-flop
is set, the 6-bit sprite data counter base MCBASE is loaded from the data
counter MC — which has advanced by 3 during that line's fetches — so the sprite
moves on to its next 3-byte row; if the flip-flop is clear, MCBASE stays and
the row is fetched again. MCBASE is a counter, not the toggle, and neither it
nor the flip-flop is documented in the Commodore 64 Programmer's Reference
Guide; the source is Bauer's article and the VICE emulator source. (An earlier
version of this paragraph called the toggle itself "MCBASE" and attributed the
name to the Programmer's Reference Guide; `docs/pitfalls/sprite.md` still uses
that wording.)

To crunch a sprite:

1. Enable Y expansion on the target sprite ($D017 bit n set) and let it start
   displaying.
2. On one of the sprite's display lines *after the first*, clear bit n in
   $D017 so that the STA's write cycle lands on the crunch cycle. In VICE 3.10's
   PAL cycle table (`viciisc` `cycle_tab_pal`) the crunch check is cycle 15,
   the MCBASE advance is cycle 16, the flip-flop inversion is cycle 56 and
   sprite DMA switch-on is checked in cycles 55–57. Measured: in a 260-position
   sweep over lines 98–103 for a sprite at Y=100, the only write position that
   crunched was cycle ~15 of the sprite's second display line.
3. The sprite's remaining length changes once, by an amount that depends on
   the row it is on: +21 lines at one row in the single-sprite sweep, +4 and
   +16 lines at other rows in the eight-sprite runs. Every crunch measured here
   lengthened the sprite; none shortened it. The sprite then finishes on its
   own — $D017 does not have to be re-written to release it, and re-writing it
   later does nothing to a sprite that has already ended.

A write at any cycle of the line before the sprite starts (Y−1), or of its
first display line, does not crunch: it yields an unexpanded 21-line sprite.
That is the write an earlier version of these steps prescribed.

The write to $D017 must happen with cycle precision on the correct raster line.
A stable raster IRQ (see `raster.md`, `stable_raster_irq`) is a prerequisite.

### Why it works

On an ordinary display line the cycle-16 step either copies MC into MCBASE
(advance a row) or leaves MCBASE alone (repeat the row). A $D017 clear that
lands on the crunch cycle immediately before it is the one case the chip does
not handle cleanly: the cycle-16 step then loads MCBASE with a bitwise blend of
the old MCBASE and the current MC rather than either value (the formula is in
Bauer's article and the VICE source; it was not derived here — rung 4 for the
formula, rung 1 for the effect). Because the blend depends on the two counter
values at that instant, the number of rows the sprite has left afterwards
depends on which row it was on, which is why the measured change was +21 at
one row and +4 or +16 at others. From the next line on, MC and MCBASE advance
normally again, so the effect is one-shot and the sprite ends by itself when
MCBASE reaches 63. An earlier version of this section described an
"inconsistent state" that "freezes" the row counter and placed the write "in
cycles 55–56 of the preceding line"; neither matched the measurement, and its
sentence about the 8565 being "more forgiving" is dropped as unverifiable on
this machine (VICE was run as a 6569 only).

### Variations

**Y stretch (unverified):** The demoscene "stretcher" — clearing and re-setting
the sprite's $D017 bit every line around cycle 55 so that the sprite repeats
one row for as long as the toggling continues, reaching the full display
height for waterfall and flag effects — is a widely described technique, but
no instrument run on this machine produced a clean stalled row from a per-line
clear+set (four write phases were tried; all gave irregular, data-dependent
rows). Treat it as an unverified demoscene technique pending a VICE-verified
recipe. An earlier version of this section stated it as fact, together with a
"partial stretch" heat-shimmer variant and a "crunch from line 50 to line 250"
full-screen sprite; those were not measured.

**Crunch with multicolor:** The crunch is a row-counter effect and does not
depend on the horizontal mode, so it applies to multicolor sprites as well
(not separately measured here). An earlier version of this paragraph claimed a
"12×tall result", which meant nothing.

### Cycle budget

The crunching write must land on one specific cycle — cycle 15 of the chosen
display line in VICE's PAL numbering — so the tolerance is a single cycle, and
the write has to be on one of the sprite's own display lines after the first,
not the line before it. Place the STA absolute (4 cycles; the write is its last
cycle) with a stable raster IRQ (see `raster.md`) whose entry-to-STA cost you
have counted, padded with NOPs to the cycle. The effect is one-shot, so no
further writes are needed on the lines that follow. An earlier version of this
section gave a "2-cycle window at cycles 55–56 of the preceding line" and a
"15 cycles total" budget; both are withdrawn (the sweep found no crunching
position on the preceding line at all).

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

A second constraint: the border is the front-most layer of the VIC-II's output
and is drawn over every sprite regardless of $D01B. A sprite that moves under
the (unopened) border disappears whether its priority bit is set or clear; it
does not become visible again. Border pixels are also not foreground for $D01F:
a sprite sitting entirely in the border latches no sprite-background collision
(measured in VICE x64sc). Only when the border has been opened (side- or
top/bottom-border tricks) are sprites drawn there, and then they are composited
against the idle-state graphics by the normal $D01B rule. An earlier version of
this paragraph said the border "counts as background" and that a
background-priority sprite "becomes fully visible again" in it; measured, both
a $D01B-set and a $D01B-clear sprite at X=0 are hidden by the border.

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

- No recipe yet. Oscar64's `spr_set()` has no priority argument (its signature
  is `spr_set(sp, show, xpos, ypos, image, color, multi, xexpand, yexpand)`);
  write `vic.spr_priority` ($D01B) directly. An earlier version of this list
  pointed at `recipes/oscar64/sprite-multiplex-8.md` for a "`spr_set()`
  priority parameter" that does not exist.

---

## sprite_color_swap_mid_line — Recolor sprites within a scanline

**Complexity:** high
**Region:** both
**Uses registers:** D027, D028, D029, D02A, D02B, D02C, D02D, D02E
**Uses kernal:** (none)
**Demands:** midframe_raster_irqs
**Requires:** stable_raster_irq

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
machine running at 0.985 MHz, each cycle is approximately 1 microsecond, and
one CPU cycle is eight pixels: the 40 character columns of 8 pixels are fetched
over the 40 g-access cycles 16–55. A sprite's 24 pixels are therefore 3 CPU
cycles wide, in both hires and multicolor — multicolor halves the resolution to
12 double-width pixels, not the width — and an X-expanded sprite's 48 pixels
are 6 cycles. (An earlier version of this paragraph said 6 cycles in hires and
12 in multicolor, which is wrong by a factor of two and inverts what multicolor
changes.) To achieve a specific horizontal split, the write must complete on
one particular CPU cycle. This demands a stable IRQ with no jitter and a fixed
cycle offset from the IRQ entry point to the STA instruction.

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
banded gradients on tall stretched sprites — flame and waterfall effects. This
depends on the Y stretch, which `sprite_y_stretch_glitch` now marks as
unverified on this machine.

### Cycle budget

On PAL (VICE 3.10 x64sc, 6569) a write to $D027+n that completes on CPU cycle
c — cycles numbered 1–63, the numbering in which the CSEL side-border pulse
lands on cycle 56 — takes effect from sprite X ≈ 8c − 111. So a write on cycle
16 recolours a sprite at X=24 (the left edge of the display window) from its
first pixel, cycle 18 splits it at X=33, and cycle 34 splits a sprite at X=152
at X=161. Equivalently, the STA's write cycle must be ≈ 16 + (X_split − 24)/8;
subtract your stable IRQ's entry-to-STA cost to get the delay. Use
`rirq_delay()` (5 cycles per unit) plus NOP padding (2 cycles) for sub-5-cycle
alignment. An earlier version of this section placed a sprite at X 24–47 "during
approximately CPU cycles 30–35" and asked for a "30-cycle delay for the left
edge, 33 for a midpoint"; cycles 30–35 are where a sprite at X ≈ 128–175 is
drawn, not one at X=24. The whole swap still fits within one raster line: STA 4
cycles plus whatever your IRQ entry and exit cost (see the `sprite_multiplex_8`
cycle budget for the KERNAL-vector figures).

### Recipes

- `recipes/oscar64/stable-raster-irq.md` and `recipes/oscar64/raster-bars.md`
  (`rirq_write` patterns). No recipe currently demonstrates `rirq_delay()`; it
  is documented only in `docs/toolchains/oscar64-headers-reference.md`. An
  earlier version of this list pointed at `recipes/oscar64/sprite-multiplex-8.md`,
  which uses neither call.

---

## sprite_sine_chain — Eight sprites phased along one sine table

**Complexity:** low
**Region:** both
**Uses registers:** D000, D001, D002, D003, D004, D005, D006, D007, D008, D009, D00A, D00B, D00C, D00D, D00E, D00F, D010, D012, D015, D017, D01D
**Uses kernal:** (none)

### Why

The middle band of a cracktro (`docs/demo-design/intro-cracktro-patterns.md`,
section 2.3) is eight sprites moving as one ribbon, chain or bouncing logo.
All eight hardware sprites are on at once and none is reused inside the
frame, so the whole effect is one table lookup per sprite per frame and a
single block of register writes in the vertical blank. It needs no raster
interrupt inside the display.

This is not `sprite_multiplex_8`. A multiplexer re-arms the eight sprites
between raster bands and demands `midframe_raster_irqs` and
`changes_sprite_set`; the chain keeps a constant sprite set and writes the
registers once a frame. `intro-cracktro-patterns.md` names
`sprite_multiplex_8` for the chain in its section 2.3 and its technique
checklist; that is the wrong name, and a compatibility check run with it
reports conflicts the chain does not have. `cracktro-template.md` does not
drive sprites at all: its sine table moves the scroller.

### How

One 256-entry sine table, built by the assembler (`table_generation` in
`docs/techniques/cpu-cycle-tricks.md`), serves all eight sprites. Each
frame a base index advances by `STRIDE` steps; sprite `n` reads the table at
`base + n * PHASE`. `STRIDE` sets the speed (2 steps per frame is one period
in 128 frames), `PHASE` sets the spacing along the curve (16 spreads the
eight over 112 steps, under half a period; 32 over 224 steps, seven-eighths
of it, so the chain nearly closes on itself). The index arithmetic is 8-bit and wraps on its
own; the table must be page-aligned so no indexed read crosses a page.

**X across the full width.** Sprite X is 9 bits: `$D000 + 2n` holds the low
byte and bit `n` of `$D010` the MSB. To sweep the whole window the table
holds `X = round(171.5 + 171.5 * sin)`, 0 to 343, stored as two tables (low
byte, high byte) so no run-time arithmetic is needed. Each frame the loop
starts a mask at zero, ORs in bit `n` for every sprite whose high byte is
non-zero, and writes the mask to `$D010` once after the loop. Writing
`$D010` last, after all sixteen position registers, means the MSB and the
low byte change on the same frame. The wrap from X 255 to 256 is the MSB
setting and the low byte going to 0 in the same update; a chain whose
positions are set per frame in the blank never shows it.

**Y from the same table.** A second table gives Y its own centre and
amplitude (`Y = round(150 + 50 * sin)`, so the sprite stays inside the
200-line window with its 21 rows). Reading it at `index + 64`, a quarter
period ahead of X, makes each sprite trace an ellipse and the chain a
rotating ring; reading it at the same index gives a diagonal line;
reading it at `2 * index` gives a figure of eight.

**Bounce.** Replace the Y table with a half-period table: a parabola
(`jump_arc_table` in `docs/techniques/maths.md` builds one from 8.8
gravity) or `|sin|`, for instance
`round(200 - 90 * abs(sin(toRadians(i * 180 / 64))))` over 64 entries,
played forwards and repeated. The X table stays as it is.
A table played forwards then backwards bounces symmetrically; one played
forwards only snaps back to the floor.

**Update in the blank.** Wait for a raster line below the window (the
listing polls `$D012` for 255, which both models reach), then write all
eight X and Y registers and `$D010`. A position written while that sprite
is being drawn can split it between the old and the new place; one written
below the window cannot. Then leave line 255 before polling again, or a fast update re-triggers on
the same line.

### Why it works

A sprite's first row is drawn on the raster line after the one numbered
in `$D001 + 2n`, and its first column at its 9-bit X. Measured in VICE
x64sc from the recipe's pictures: a sprite with Y 200 has its top row on
screenshot row 185, which is line 201, and one with X 163 starts at
screenshot column 171, which is X 163 plus the 8-pixel offset of the
picture. Both registers are compared every line; no image data is fetched
until a sprite starts. A constant set of eight enabled sprites costs the
same DMA every frame (2 cycles per sprite plus 3 per group of consecutive
sprites, on the lines where they are displayed), regardless of where the
table puts them, so the CPU cost of the effect is the update loop alone.

The side borders have priority over sprites. A sprite at X 320 to 343 is
progressively hidden under the right border and a sprite at X 0 to 23 under
the left one; at X 343 one column shows, at X 344 none. Measured in VICE
x64sc from the recipe's pictures: a sprite at X 343 covers screenshot
column 351 only, and one at X 16 starts at column 32. The chain therefore
slides off both edges without any clipping code, which is what the sweep
across 0 to 343 is for. Sprites in the border are visible only with
`sideborder_open`.

### Variations

**Sprite-built logo, bounced as one object.** Set bit 0 to 7 in both
`$D01D` and `$D017` (`sprite_expand`) so every sprite is 48 by 42. Lay
sprites 0 to 3 across one row at X spacing 48 and sprites 4 to 7 across a
second row 42 lines lower: a 192 by 84 pixel logo from eight 24 by 21
images, 512 bytes of sprite data. The eight pointers at screen + `$03F8`
are the eight tiles of the logo in reading order and never change; only
the positions move. Each frame read one X and one Y from the tables for
the logo's top-left corner and add `48 * (n & 3)` to X and `42 * (n >> 2)`
to Y, with the 9-bit add producing the `$D010` bit for each sprite as
above. Because every sprite gets the same table index the logo moves as
one piece; a per-sprite `PHASE` of 0 is the whole difference from the
chain. The X table must be narrowed so the right-hand tile stays on the
picture: with a left edge of 0 to 152 the right-hand tile sits at 144 to
296 and its last column at 343.
Not measured here; the arithmetic follows from the register widths and the
recipe's measured positions.

**Two tables, two speeds.** Give X and Y different `STRIDE` values (read
Y at `2 * base` or `3 * base`) for Lissajous figures. The 8-bit index
still wraps for free.

**Colour cycling along the chain.** Rotate the eight colour registers
`$D027` to `$D02E` one place every few frames so a hue runs down the
chain. This is a register write per sprite in the same blank; no extra
cost elsewhere.

### Cycle budget

Rung 3, from the instruction costs of the recipe's loop: about 68 cycles
per sprite, plus 12 for a sprite whose high byte is set, plus the
`$D010` write and the counter, so roughly 600 cycles or ten raster lines
per frame for all eight. It runs below the window, where the CPU is
otherwise idle. Not measured with a timer here. Sprite DMA is unchanged
by the effect: the eight sprites are on every frame whether or not they
move.

### Recipes

- `recipes/kickassembler/sprite-sine-chain.md` (the eight-sprite chain
  across the full width, MSB wrap, frame counter on screen, positions
  measured on PAL and NTSC). No logo or bounce recipe yet.
