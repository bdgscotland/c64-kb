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
prioritized via registers at $D000–$D02E. Every sprite technique works around
three limits: only eight hardware sprites exist, the frame is 312 lines on PAL
(263 on NTSC), and sprite DMA competes with the CPU for bus access.

---

## sprite_multiplex_8 — 8-sprite multiplexer

**Complexity:** medium
**Region:** both
**Uses registers:** D015, D000, D001, D027, D012, D019, D01A
**Uses kernal:** (none)
**Demands:** midframe_raster_irqs, changes_sprite_set
**Cost:** cycles_per_frame=5301
**Cost basis:** arithmetic
**Cost measured on:** oscar64-sprite-multiplex-8 (the three calls' worst cases summed)
**Claims:** sprite_0-7 (owns), vic_raster_irq (owns)
**Claims basis:** derived-listing

### Why

A game with a scrolling playfield, player character, several enemy types, and
projectiles exceeds eight simultaneous on-screen objects. The VIC-II provides
only eight hardware sprites per frame, but a typical action game needs twelve
to twenty-four distinct moving objects visible at once. The 8-sprite
multiplexer reuses each of the eight hardware sprites several times within a
single frame by reprogramming them between uses.

### How

This is time-division multiplexing along the Y axis. Before the frame
begins, sort the logical sprite list by ascending Y position. Divide the screen
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

The VIC-II reads sprite data on the *current* raster line but compares the
hardware sprite Y register at the *start* of each line. Once the chip has
started drawing a sprite it continues drawing its pixel rows even if the Y
register changes partway through. The handler can therefore repoint the
hardware sprite to a new logical sprite's data as soon as the old one has
started its last pixel row, provided the IRQ fires before the new Y position
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

Each sprite therefore gives a window of 21 lines: once the sprite starts
rendering (the raster counter passes its Y), there are 21 lines to change the
Y register and pointer to the next logical sprite before the VIC looks for its
new activation. The raster IRQ, triggered at the right Y value via
$D012/$D011, starts the CPU on those register writes in time.

### Variations

**Double-y-frame:** Instead of pure Y-band multiplexing, the interrupt fires
just below each sprite's *bottom* edge. This is the most flexible scheme, but
it needs an ordering that avoids races when two logical sprites have nearly
the same Y position.

**Fixed three-pass:** Split the screen into three equal-height bands (roughly
top/middle/bottom thirds). Each band gets a fixed group of hardware sprites.
Less flexible but simpler code and more predictable cycle budget.

**Enable mask only:** A lighter version that skips image/color reprogramming
and only toggles $D015 bits and updates Y positions. Appropriate for
same-image, same-color sprite swarms (bullet patterns, particle effects).

### Cycle budget

On PAL, each raster line is 63 cycles. Through the KERNAL vector ($0314) the
handler's first instruction runs 36 cycles after the interrupt is taken (7 for
the interrupt sequence and 29 for the $FF48 dispatcher: PHA TXA PHA TYA PHA TSX
LDA $0104,X AND #$10 BEQ JMP ($0314)), and the interrupt is taken 2 to 8
cycles after the raster compare (0–6 cycles of jitter from the interrupted
instruction on top of a 2-cycle minimum), so the handler starts on cycle
39–45 of its line (measured in VICE, `techniques/raster.md`,
`stable_raster_irq` Cycle budget), later if the interrupt lands on a
badline.
Acknowledging $D019 costs about 6 more, and the bare exit through $EA81 (PLA
TAY PLA TAX PLA RTI) 22, so the round trip is about 64 cycles, a full raster
line, of which the 38–44 before the handler's first instruction eat into
the slack. An earlier version said 36–42 and gave no minimum.
Banking the KERNAL out and pointing $FFFE/$FFFF at the handler removes the
29-cycle dispatcher. (An earlier version of this section put the whole
entry/acknowledge/exit overhead at about 15 cycles, which is not consistent
with the 29-cycle dispatcher documented in `raster.md`.) With 8 sprites per
group, writing each sprite's Y ($D001+2n), image pointer (screen + $3F8 + n),
and color ($D027+n) costs 3 stores × 4 cycles each = 12 cycles per sprite × 8
sprites = 96 cycles. Entry of 36–42 cycles plus 96 cycles of writes is 132–138
cycles, already more than two 63-cycle lines, so at least 3 lines of
slack are needed (not 2, as this section used to say) between the IRQ trigger line and the
first new sprite's Y position to complete all writes before the VIC latches the
next activation. In practice, target 3–4 lines of slack.

The Cost line's 5,301 cycles is the sum of the three per-frame calls'
worst cases in the Oscar64 recipe, each measured there with a CIA 2 timer
over 200 frames in VICE: `vspr_sort` 2,018, `vspr_update` 1,853,
`rirq_sort` 1,430 (each maximum includes interrupts landing inside the
call). The sum is arithmetic, not one measured frame. An earlier Cost line
said 9,162, which was the recipe's whole frame loop including its
sine-table motion, a demonstration payload.

### Recipes

- `recipes/oscar64/sprite-multiplex-8.md`

---

## sprite_multiplex_24 — Up to 24+ sprites via raster reuse

**Complexity:** scene-tier
**Region:** both
**Uses registers:** D015, D000, D001, D002, D003, D004, D005, D006, D007, D008, D009, D00A, D00B, D00C, D00D, D00E, D00F, D010, D027, D028, D029, D02A, D02B, D02C, D02D, D02E
**Uses kernal:** (none)
**Demands:** midframe_raster_irqs, changes_sprite_set
**Cost:** cycles_per_frame=1667, irq_slots=3, bytes_code=977, sprites_per_line=8
**Cost basis:** measured-vice
**Cost bytes basis:** derived-listing
**Cost measured on:** kickassembler-sprite-multiplex-24 (three fixed bands, no sort, the $EA31 exit once, the animation left out; screen on; PAL and NTSC)
**Claims:** sprite_0-7 (owns), vic_raster_irq (owns)
**Claims basis:** derived-listing
**Alternative to:** sprite_multiplex_8 (more than 16 sprites; needs tighter IRQ scheduling, a Y-sorted list and $D010 managed across passes)

### Why

The 8-sprite multiplexer above extends to 16 in a two-pass design. Going
beyond 16 (to 24, 32, or more) requires
tighter IRQ scheduling, Y-sorted lists, and careful management of the MSB X
register ($D010) across passes. Scene-tier demoscene sprite engines routinely
display 30+ logical sprites on PAL systems by splitting the frame into three or
more reuse passes. Games needing large enemy crowds, parallax-layer overlays, or
sprite-based status bars use the same approach.

### How

The algorithm extends the 8-sprite multiplexer:

1. **Sort by Y:** Before each frame, sort the entire logical sprite array by
   ascending Y position. Oscar64's `vspr_sort()` performs an insertion sort
   on an index array (`spriteOrder`, in `include/c64/sprites.c`), which is
   fast on nearly-sorted lists (typical across consecutive frames). An
   earlier version called it cache-friendly; the 6510 has no cache.

2. **Assign the first eight to hardware directly:** The top eight logical
   sprites (lowest Y values) are written to hardware at frame start.
   `vspr_update()` handles this, writing all eight positions, images, colors,
   and the MSB-X byte ($D010) in one pass.

3. **Schedule reuse IRQs per hardware slot:** For each logical sprite beyond
   the first eight (sorted index ti+8, hardware slot ti & 7), `vspr_update()`
   calls `rirq_move(ti, spriteYPos[ti + 1] + 23)`: the raster line two below
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
   incoming sprite's Y is only written as data; see `sprites.c` L318/L330.)

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
the next slot. The template is more than five STAs: each `rirq_build` template
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
sprites cost 16 reuse IRQs per frame: roughly 16 × 250 ≈ 4,000 cycles, about
20 % of PAL's 312 × 63 = 19,656 cycles per frame, not the 120 cycles this
section used to claim. A hand-scheduled three-pass multiplexer that rewrites
all eight sprites per IRQ (as the KickAssembler recipe does) is a different
design with three IRQs per frame; the figures above are for the `vspr_*`
per-slot design. The other constraint is Y-band density: if ten logical
sprites cluster within a 21-line band, they get one pass, not ten; duplicates
at the same Y are not all visible at once.

### Variations

**32+ sprites:** Raise `VSPRITES_MAX` beyond 16 (rebuild required; pass it as
`-dVSPRITES_MAX=24` on the Oscar64 command line, since a `#define` in your own
file does not reach `sprites.c`, and raise `NUM_IRQS` with it or `rasterirq.c`
warns "Index out of bounds"). Each additional logical sprite adds one raster
IRQ slot and needs a 21-line gap below its slot's previous occupant. With vspr
slots at ~250 cycles each, 10 % of a PAL frame is about eight reuse IRQs, i.e.
about 16 logical sprites, not the "roughly 48" this section used to say,
which assumed 25-cycle slots.

**Per-sprite priority within a pass:** Within one pass (one set of eight
hardware sprites), hardware priority is fixed: sprite 0 is always in front of
sprite 1. Design the sort order so that in areas of overlap, the intended
top-priority sprite ends up in a lower-numbered hardware slot.

**Variation: fixed reposition rows.** Measured in a five-part
KickAssembler demo built from the KB: 24 balls on a ring over a 16-band
`$D021` gradient, in a part that shares one KERNAL-vectored dispatcher
with a sequencer and a music player. Per-frame reuse entries in that
table lost a frame whenever two were armed under about four lines apart
(`irq_table_rebuilt_per_frame_loses_close_entries` in
`pitfalls/raster-and-badline.md`), so the rows are assembled fixed: nine
reposition rows twenty lines apart, 62 to 222, beside the part's own rows
at 20, 249 and 252. One handler serves every row and takes, from a
running index, every entry whose due line is before the row's line plus
two; an entry is due at its slot's previous occupant's Y + 22, so it runs
at most eight lines late against a 31-line margin. The layout is proved
at assembly time: over all 256 offsets of the ring's Y table, the ball
eight places down in Y order sits at least 50 lines (22 + 20 + 8) under
its predecessor; the shipped tables give 53, and the latest due line is
213 against a limit of 223. Fewer rows fail the proof, at 25 lines apart
the latest write lands within two lines of its ball; seventeen rows ten
apart would admit a flatter ring at about 600 more cycles a frame. The
schedule (hardware sprite k mod 8 to ball k in Y order, entries grouped
by line) is built one frame ahead and triple-buffered, current, published
and building, because with two halves the build straddled the top row
once the main loop's phase moved, and the picture froze. Cost per frame,
CIA-timed with the rows' interrupts and the main loop's sort, projection
and build (projection on even frames, build on odd): PAL worst 8,294 and
median 6,339, NTSC worst 9,176 and median 7,835, for 24 balls with the
gradient; the demo's end screen later read PAL 8,332 and NTSC 9,126
worst. Ball Y stays at or above 36: at 28 the PAL frame showed the
sprite's rows ghosted at 256 + Y.

**Cross-reference:** `recipes/kickassembler/sprite-multiplex-24.md` is the
fixed three-band variant (the "Fixed three-pass" option above) in
KickAssembler: one raster IRQ above each band rewrites all eight hardware
slots, with no per-frame Y sort and nothing cycle-exact; the recipe's own text
says what that restriction costs. (An earlier version of this paragraph called
it a hand-scheduled, cycle-exact demoscene multiplexer, which it is not.)

### Cycle budget

With Oscar64's `vspr_*` system and `VSPRITES_MAX=24`, each of the 16 reuse
slots costs roughly 225–280 cycles (entry, busy-wait to row+1, five writes,
re-arm, exit; measured in VICE, PAL, RAM vector), about 4,000 cycles per
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

The Cost line is the fixed-band form, which needs no sort: three IRQs,
each writing eight sprites. Traced in `recipes/kickassembler/sprite-multiplex-24.md`
in VICE x64sc 3.10, from each interrupt's acceptance to the end of `RTI`:
501 or 502 cycles for each of bands 1 and 2, and 662 or 663 for band 0
without its `JSR animate` (the band 0 handler exits through `$EA31`);
1,665 to 1,667 a frame on PAL and 1,666 to 1,667 on NTSC. The recipe's
animation of 24 sprites adds 1,538 to 1,555, and is game logic, so the
line leaves it out. `bytes_code` is the recipe's code segment
(`$0900-$0CD0`), install and animation included, from KickAssembler's
memory map. The line said 700 cycles and 900 bytes before, both
estimates. Before #72 one basis word covered the whole Cost line, so it said `derived-listing`, the bytes' rung, beside measured cycles; the cycles now say `measured-vice` and the bytes keep `derived-listing` on their own line. A sorted `vspr_*` multiplexer costs the 5,000 and more above.

### Recipes

- `recipes/kickassembler/sprite-multiplex-24.md` (three fixed bands of eight, no sort; the Cost line's figures)
- `recipes/oscar64/sprite-multiplex-8.md` (scales directly; raise VSPRITES_MAX)

---

## sprite_multiplex_game — Game multiplexer in assembly: persistent sort, double-buffered table, zone IRQs, late guard

**Complexity:** high
**Region:** both
**Uses registers:** D000, D001, D010, D012, D015, D019, D01A, D027
**Uses kernal:** (none)
**Demands:** midframe_raster_irqs, changes_sprite_set
**Cost:** cycles_per_frame=16600, cycles_per_frame_typical=8995, irq_slots=17
**Cost basis:** arithmetic
**Cost measured on:** kickassembler-sprite-multiplex-game (worst frame: arithmetic, a reversed sort, CPU cycles only; typical: the largest whole frame of sort, build and IRQs in 2,142 frames of play, timed wall-clock by a probe build, NTSC, screen on)
**Claims:** sprite_0-7 (owns), vic_raster_irq (owns)
**Claims basis:** derived-listing
**Alternative to:** sprite_multiplex_24 (sprites anywhere on screen, a sort that stays cheap on game frames and IRQ code the game owns and can budget; the Oscar64 vspr path takes one IRQ per reused sprite and about 20 % of a PAL frame for 24 sprites)

### Why

`sprite_multiplex_24` covers Oscar64's `vspr_*` path, which takes one IRQ
per reused sprite and about 20 % of a PAL frame for 24 sprites. The
KickAssembler three-band recipe keeps every sprite inside a fixed band
and does not sort. A game needs sprites that go anywhere, a sort that is
cheap on the frames a game actually produces, and IRQ code it owns and
can budget. Cadaver found this structure in Ocean and Imagine games such
as Green Beret and Midnight Resistance (sources below).

### How

1. **Sort by Y, keeping last frame's order.** An index array `order[]` is
   never reset. Each frame an insertion sort repairs it: an actor that has
   not passed a neighbour costs one compare, one that has passed k
   neighbours is shifted k places. This is the "Ocean" or continuous
   insertion sort.
2. **Build into the half the IRQs are not reading.** Walk `order[]` and
   copy each accepted actor's Y, X, pointer, colour and a precalculated
   $D010 byte into a sorted table. The table has two halves; the main loop
   builds one while the IRQs show the other, then sets a ready flag. The
   frame IRQ swaps halves only when the flag is set, so a late build shows
   the previous frame again instead of a half-written table. The unsorted
   actor tables are single; only the main loop touches them.
3. **Reject the ninth sprite on a band.** Accepted entry a goes to slot
   a mod 8, which last showed entry a − 8. If the new Y is less than 21
   lines below that entry's Y, the slot cannot show it: reject the actor
   for this frame (`sprite_dma_overflow` measured Y = 100 then 120 lost,
   100 then 121 shown).
4. **Group sprites into zones.** The frame IRQ, below the last sprite
   line, writes the first eight. Every later sprite belongs to a zone: a
   run of sorted sprites close enough in Y to be written by one IRQ. The
   zone's IRQ line is set early enough for all its writes, Y first.
5. **Guard against a late IRQ.** At the end of each zone, store the next
   zone's line in $D012, then compare line − 3 with $D012. If the raster is
   already there, run the next zone now, without exit, acknowledge or
   entry. Otherwise acknowledge and return.

### Why it works

The VIC-II starts a sprite on the line after its Y matches the raster, and
only when that slot's DMA is off; it then draws 21 lines from whatever the
registers hold. A slot is free for a new Y once its old sprite has started,
provided the new Y is at least 21 lines lower. A Y write that lands after
the raster has passed it never matches that frame, so the sprite is lost,
not delayed. The sort and the 21-line rule decide what can be shown; the
zone lines decide whether each write is in time.

An IRQ line written after the raster has passed it does not fire until
the next frame. Without the guard, every zone after a late one is lost for
that frame. In the recipe, a build without the guard showed 11 of 24
actors in 2 of 16 swept shots (9.3 million cycles, PAL and NTSC) and 24
in the other 14; with it, 24 of 24 in all 16 (measured in VICE x64sc).

The guard fires in about 80 % of frames. That is zones being merged when
they sit close together, not IRQs arriving late by accident. A probe
measured the largest overshoot on the fall-through path as 5 lines past
line − 3, so at most 2 lines past the scheduled line, which leaves at
least 2 lines before the zone's first Y (PAL, 309 frames, VICE x64sc). An
8-sprite zone under full sprite DMA on a badline was not measured here.

### Choosing the sort

| Sort | Cost pattern | Wins when |
|---|---|---|
| Insertion from last frame's order (Ocean) | One compare per actor in place; about 30 cycles per place an actor moves. Measured in the recipe for 24 actors: 611 sorted, 5,228 shuffled, 8,783 reversed; 611 to 953 per frame in 16 shots of play, 1,411 the largest seen | Actors move a few lines a frame and rarely overtake many others: most games |
| Bucket on Y | Nearly the same every frame, whatever the order | Orders change wholesale: spawning waves, teleports, many actors re-entering at once. Falco Paul's Java model put it 18 % slower than Ocean on a game-like pattern, best with 128 buckets (not measured here) |
| Hybrid: Ocean, falling back to bucket when the swaps pile up | Ocean's cost on quiet frames, bucket's ceiling on bad ones | A frame budget that cannot absorb the insertion sort's worst case |

The Java figures are from a model of 64 sprites, not 6502 code. Cadaver
recommends the Ocean sort for real projects and uses it in MW4. Linus
Akesson's Field Sort and radix sorts are further options with published
6502 figures (sources below; not measured here).

### Variations

**Just after the old sprite.** Fire each reuse IRQ just below the slot's
previous sprite and write Y last. A late write then drops the new sprite
instead of drawing a glitch, but tight formations lose sprites. The
recipe uses "just before the new sprite", which keeps them but lets the
new X, colour and pointer land during the old sprite's last lines when
the gap is exactly 21.

**Priority mapping.** Instead of slot a mod 8, pick a free slot by the
actor's priority class, so that the player or explosions get
low-numbered slots and draw in front.

**Unrolled writes per slot.** One block of code per hardware slot with
constant register addresses, entered at the first slot to write, avoids
the slot lookups at the cost of code size.

### Cycle budget

Measured in the recipe on PAL (VICE x64sc, CIA2 timers): sort 611 cycles
for 24 sorted actors (26 per compare × 23 + 13 = 611, which matches the
measurement; 28 per compare when the loop branches cross a page), 611 to
953 per frame in 16 shots of play and 1,411 the largest seen; build
3,815; multiplexer IRQs 2,201 to 2,764 per frame with 7 to 13 zones
(10 in the pinned shot), plus 47 cycles per IRQ taken that the timer
cannot see (arithmetic from the listing).

The Cost line is the worst frame, by arithmetic: 8,783 (a full
reversal) + 3,815 + 2,764 + 17 × 47 + 6 × 76 ≈ 16,600 cycles. The last
term is six zones more than the ten in the 2,764 frame, at about 76
cycles of timed per-zone code each (arithmetic from the listing). That
is about 84 % of a PAL frame, and more than an NTSC frame leaves after
badline and sprite DMA. The double buffer turns the overrun into one
repeated frame (MISSED), not a torn one. Without a reversal the worst
frame is about 8,800 (1,411 + 3,815 + 2,764 + 17 × 47). The Cost line includes the
reversal a respawn of every actor can cause. `irq_slots=17` is a ceiling: the frame
IRQ plus 16 single-sprite zones, before the late guard merges any. The
recipe's frames built 7 to 13 zones.

The typical figure is one whole frame timed in play. A probe build ran
CIA1 timer A through the main loop's sort and build and through every
IRQ, and read it once a frame in the frame IRQ. The largest frame was
8,420 cycles on PAL (1,867 frames) and 8,604 on NTSC (2,142 frames),
measured in VICE x64sc with the screen on, so the badline and sprite
stalls inside those stretches are in it. Add 26 cycles per IRQ taken
outside the sort and build, which the timer cannot see, and 27 at the
read (arithmetic from the probe): at most 13 IRQs on PAL and 14 on NTSC
give 8,785 and 8,995. `cycles_per_frame_typical=8995` is the NTSC figure.
The smallest frame was 6,874 on PAL and 7,039 on NTSC.

### Sources

Cadaver, "Sprite multiplexing", https://cadaver.github.io/rants/sprite.html
(continuous insertion sort, 21-line rejection, double buffering,
precalculated $D010, the late check with a 3-line margin). Falco Paul in
"Speculative sprite sorting methods",
https://cadaver.github.io/rants/sorting.html (bucket, Ocean and hybrid
sorts in Java). Linus Akesson, Field Sort,
https://www.linusakesson.net/programming/fieldsort/index.php. Codebase64,
https://codebase.c64.org/doku.php?id=base%3Asprite_multiplexing (sort
families). cadaver/c64gameframework, https://github.com/cadaver/c64gameframework
(`screen.s`, `raster.s`; MIT; read for structure only).

### Recipes

- `recipes/kickassembler/sprite-multiplex-game.md`

---

## sprite_expand — Hardware-expand sprites

**Complexity:** low
**Region:** both
**Uses registers:** D017, D01D
**Uses kernal:** (none)
**Cost:** cycles_per_frame=48
**Cost basis:** measured-vice
**Cost measured on:** oscar64-sprite-expand (one spr_expand call with run-time arguments, screen blanked; PAL and NTSC)

### Why

A standard C64 sprite is 24×21 pixels, too small at C64 resolution for boss
characters, large vehicles, title-screen
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
repeats each pixel column twice (X expansion) or each pixel row twice
(Y expansion) during output.

### Why it works

During sprite DMA the VIC-II reads the 63 data bytes for each active sprite once
per "sprite line" (its internal row counter). With X expansion enabled, the chip's
horizontal shift register clocks each pixel bit onto the output bus twice instead
of once, stretching each pixel to two display clocks wide (two pixels on screen).
With Y expansion enabled, the chip's internal row counter increments only on
every *second* raster line instead of every line, so the same bitmap row is output
twice, doubling the visible height.

The result is 2× linear scaling with no antialiasing, with visibly blocky
edges. Game objects at C64 pixel sizes tolerate this, and close-range
boss-fight scaling effects often use it on purpose.

Combined X+Y expansion produces a 48×42 sprite that costs the same DMA bandwidth
as an unexpanded sprite: the chip still fetches exactly 63 bytes of data per 21
chip-internal rows.

### Variations

**Single-axis expand for squash-and-stretch:** Animate the Y-expand bit across
frames to simulate a bouncing ball compressing and expanding. The binary
nature of hardware expansion means the effect is coarse, but readable at
C64 pixel sizes.

**Mixed expanded/unexpanded sprites:** Sprite 0 (the player) can be fully
expanded while sprites 1–7 (small bullets) are unexpanded; the registers are
per-sprite.

**Fake 48×84 via two expanded sprites stacked:** Two X+Y-expanded sprites at
the same X but offset 42 lines apart produce a visual object 84 lines tall,
about 42 % of the 200-line display window (three stacked reach 126). An
earlier version of this paragraph called 84 lines "two-thirds of the PAL screen
height"; two-thirds of 200 is 133.

### Cycle budget

Expansion costs the CPU nothing while the VIC draws; the cost is the
register writes. Measured in VICE x64sc 3.10 with CIA1 timer B in the
Oscar64 recipe, screen blanked, one call less an empty call, the same on
PAL and NTSC: one `spr_expand(sp, x, y)` call with run-time arguments is
48 cycles (a masked read-modify-write of both registers), the Cost line;
both registers written as whole bytes with `lda #` / `sta` are 12. With
constant arguments Oscar64 folds the call to an `ORA #` per register
(read from its `.asm` listing, not timed).

### Recipes

- `recipes/oscar64/sprite-expand.md` (one image unexpanded, X-, Y- and
  both-expanded, each with a collision box scaled by the expand bits and
  drawn in front; the box and the outline located with PIL on PAL and
  NTSC; cycles for `spr_expand()`, whole-byte writes and one scaled box).
- `recipes/kickassembler/sideborder-open.md` (sets $D017 Y-expand for 42-line
  sprite DMA). An earlier version of this list said no Oscar64 recipe calls
  `spr_expand()`, and before that pointed at
  `recipes/oscar64/sprite-multiplex-8.md`, which does not use it.

---

## sprite_collision_detect — Sprite-sprite and sprite-background collision

**Complexity:** low
**Region:** both
**Uses registers:** D01E, D01F
**Uses kernal:** (none)
**Cost:** cycles_per_frame=16
**Cost basis:** measured-vice
**Cost measured on:** kickassembler-sprite-priority-classes (one read of each register stored to RAM, screen on; PAL and NTSC)

### Why

Every action game needs collision detection: player versus enemy, bullet versus
enemy, player versus terrain. Software bounding-box tests are fast but require
explicit bounding-box data per sprite. The VIC-II detects collisions as a
by-product of rendering: the chip tracks pixel overlap and latches results in
two read-only registers.

### How

**Sprite-sprite collision ($D01E, SPSPCL):** Each bit n is set whenever any
non-transparent pixel of sprite n overlaps any non-transparent pixel of any
other enabled sprite during rendering. The register is *read-to-clear*: reading
$D01E resets all bits to zero. A nonzero value means at least one
collision occurred since the last read.

**Sprite-background collision ($D01F, SPBGCL):** Each bit n is set whenever any
non-transparent pixel of sprite n overlaps a *foreground* pixel of the display,
where foreground means: in standard hires text and hires bitmap, a 1 bit (in a
hires bitmap the 0 bits are drawn in the screen-RAM low nibble, not $D021, and
are still background: measured by the `mob_priority` probe, whose sprite on
0 bits alone latched nothing; an earlier version of this sentence said "any
pixel not drawn in background colour 0 ($D021)"); in ECM, any pixel not drawn in one of
BGCOL0–3 (the four background colours are all background); in multicolor text
and multicolor bitmap, only the %10 and %11 bit-pairs: %01 pixels (BGCOL1/$D022
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
pixel is nonzero at the same position as a foreground pixel of the display
data: a 1 bit with MCM clear, bit pair 10 or 11 with MCM set; pair 01 counts
as background though it is drawn in a colour (`hardware/vic-ii-reference.md`,
"Priority"; Bauer's VIC-II article, section 3.8.2). An earlier version said
"a non-transparent background pixel", which would include pair 01.

The chip sets the latch during the *raster scan*, before the CPU sees the
result, so the hardware has already resolved pixel-exact overlap of
non-transparent pixels, not of bounding rectangles, by the time the CPU
reads the register at end-of-frame (`hardware/vic-ii-reference.md`,
"Collisions"). An earlier version said "sub-pixel-exact rectangular
overlap".

The read-to-clear mechanic is a hardware simplification: there is no separate
write-clear path. The register's internal flip-flops reset on the read cycle.

### The "sticky" problem

A common pitfall: if $D01E is read inside an interrupt handler *and* again in
the main loop, the second read sees zeros because the interrupt already cleared
it. Read each register *once* per frame and cache the value in a RAM variable.

A second pitfall: the registers report which sprites were involved, not which
specific pair collided. With sprites A, B, C all overlapping, all three bits
are set. Distinguishing game-relevant pairs requires software reasoning on
the bit pattern.

### Variations

**IRQ-driven collision:** Enable the sprite-sprite or sprite-background
collision IRQ via bits 1–2 of $D01A (IRQMSK). The VIC fires the CPU IRQ line
on the same cycle the collision is latched, so the response comes within the
frame (sub-frame latency). Acknowledge by writing
the corresponding bit in $D019.

**Multicolor sprite collision:** Multicolor sprites have transparent pixels
between their double-wide colored pixels (the %00 pattern bits are transparent).
The hardware collision test ignores transparent pixels, so collision
boundaries track visual content rather than bounding boxes.

### Cycle budget

The latching is free; the CPU pays only for the reads. The polling
pattern above, `lda $d01e / sta` then `lda $d01f / sta` to absolute RAM,
took 16 cycles in `kickassembler/sprite-priority-classes`, timed with the
VICE x64sc monitor stopwatch between breakpoints on PAL and NTSC. That
recipe is this technique's measured instance, and the Cost line. Acting
on the bits (which sprite, which pair) is the game's own code and not in
the figure.

### Recipes

- `recipes/oscar64/simple-shmup.md` (reads $D01E/$D01F each frame). An earlier
  version of this list pointed at `recipes/oscar64/sprite-multiplex-8.md`,
  which never reads the collision registers.
- `recipes/kickassembler/sprite-priority-classes.md` clears both registers, lets
  two frames of a still picture latch, reads each once and compares with an
  expectation; it measures that $D01F follows the playfield's bit pattern (pair
  01 in multicolour text latches nothing) and ignores $D01B. It is the
  instance the Cost line was measured on. There is no Oscar64 recipe that
  only polls the registers; `simple-shmup` above reads them in C.

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
lines while its DMA is running, the sprite's remaining length changes (once,
by a data-dependent amount) and the sprite then ends on its own. Demoscene
coders call this the "sprite crunch"; the per-line variant that is meant to
hold a sprite on one row is the "Y stretch". An earlier version of this section
said a single clear at line Y−1 makes "the sprite's row counter stall,
repeating one or more rows indefinitely until the register is written again".
Measured in VICE x64sc (PAL), that is wrong on both counts: a clear at Y−1, or
anywhere on the first display line, gives a plain unexpanded 21-line
sprite, and a crunching clear on a later line lengthened the sprite by 4, 16 or
21 lines and then let it finish well before $D017 was touched again. Nothing
is left "stuck" waiting for a re-write.

### How

The VIC-II's Y expansion works via a per-sprite flip-flop, the "advance line"
flip-flop in Bauer's VIC-II article (older editions and the VICE source call it
the expansion flip-flop, `exp_flop`). It is held set while the sprite's $D017
bit is clear; while the bit is set and the sprite's DMA is on, it is inverted
in cycle 56 of every line. In cycle 16 of the next line, only if the flip-flop
is set, the 6-bit sprite data counter base MCBASE is loaded from the data
counter MC, which has advanced by 3 during that line's fetches, so the sprite
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
   own: $D017 does not have to be re-written to release it, and re-writing it
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
Bauer's article and the VICE source; it was not derived here; rung 4 for the
formula, rung 1 for the effect). Because the blend depends on the two counter
values at that instant, the number of rows the sprite has left afterwards
depends on which row it was on, which is why the measured change was +21 at
one row and +4 or +16 at others. From the next line on, MC and MCBASE advance
normally again, so the effect is one-shot and the sprite ends by itself when
MCBASE reaches 63. An earlier version of this section described an
"inconsistent state" that "freezes" the row counter and placed the write "in
cycles 55–56 of the preceding line"; neither matched the measurement, and its
sentence about the 8565 being "more forgiving" is dropped as unverifiable on
this machine: every run was on one model, VICE's default C64C (VIC-II 8565),
and none was compared with a 6569. An earlier version of this sentence said
VICE was run as a 6569 only.

### Variations

**Y stretch:** The demoscene "stretcher", clearing and re-setting the
sprite's $D017 bit every line so that the sprite repeats one row for as
long as the toggling continues, is its own entry, `sprite_stretcher_d017`
below, measured in VICE by `recipes/kickassembler/sprite-stretcher.md`:
the setting write must land on cycle 55 or earlier (PAL); on 56 it is
pushed to 61 and nothing is stretched. An earlier version of this
paragraph marked the stretcher unverified because four write phases had
given irregular rows. Which cycles those were is not recorded; the
recipe's sweep gives irregular rows, this entry's crunch, for every
write from 57 to 62. The "partial stretch"
heat-shimmer variant and a "crunch from line 50 to line 250" full-screen
sprite, which an earlier version stated as fact, are still not measured.

**Crunch with multicolor:** The crunch is a row-counter effect and does not
depend on the horizontal mode, so it applies to multicolor sprites as well
(not separately measured here). An earlier version of this paragraph claimed a
"12×tall result", which meant nothing.

### Cycle budget

The crunching write must land on one specific cycle, cycle 15 of the chosen
display line in VICE's PAL numbering, so the tolerance is a single cycle, and
the write has to be on one of the sprite's own display lines after the first,
not the line before it. Place the STA absolute (4 cycles; the write is its last
cycle) with a stable raster IRQ (see `raster.md`) whose entry-to-STA cost is
counted, padded with NOPs to the cycle. The effect is one-shot, so no
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
**Cost:** cycles_per_frame=6
**Cost basis:** measured-vice
**Cost measured on:** kickassembler-sprite-priority-classes (one `lda #` / `sta $d01b` of the whole byte, screen on; PAL and NTSC)

### Why

By default, VIC-II sprites render on top of everything: characters, bitmap
pixels, even other sprites of higher index. Many game effects need a sprite
*behind* the playfield: a character walking behind a tree, an enemy partially
obscured by a wall tile, a shadow below a platform. Without hardware priority
the sprite would have to be composited into the screen data, which is
expensive. $D01B provides per-sprite priority control at
zero CPU cost during rendering.

### How

$D01B (SPBGPR) is an 8-bit register where bit n controls sprite n's foreground
priority:

- Bit n = 0 (default): sprite n renders in front of all foreground pixels.
- Bit n = 1: sprite n renders *behind* foreground pixels but still in front of
  background pixels. Which pixels are which is a matter of bit pattern, not
  colour; see "Pixel classes" below.

To make sprite 4 appear behind solid tiles: OR bit 4 into $D01B (`$D01B |= %00010000`).
To restore it to the front: AND the complement (`$D01B &= ~%00010000`).

The write takes effect immediately for the remainder of the current frame at the
sprite's current raster position. Update $D01B in the vertical blank or at least before the sprite's first rendered line.

### Why it works

The VIC-II's output multiplexer operates in priority order during each pixel
clock. When rendering a pixel, the chip evaluates (from highest to lowest
priority): sprites 0–7 (in index order), then foreground pixels, then background.
If a sprite's $D01B bit is set, the chip inverts that sprite's position
in the priority stack: foreground pixels win over it, while background pixels
still lose. Background-priority sprites therefore appear to "punch through" the
sprite layer into the background layer, letting foreground pixels obscure them.

Sprite-vs-sprite priority is **not** affected by $D01B. Sprite 0 is always in front of sprite 1 regardless of their $D01B bits.
$D01B only modulates each sprite's relationship with the *background plane*.

**Pixel classes, measured.** The `kickassembler/sprite-priority-classes`
recipe put multicolour sprites whose columns are bit pairs 01, 10 and 11 over
cells whose rows are every playfield pattern, in standard and in multicolour
text, with the bit set and clear, and counted every pixel of the result in
VICE x64sc on PAL and NTSC. Three rules came out, and one correction:

- The sprite's own pixel class never matters. Pairs 01, 10 and 11 of a
  multicolour sprite are treated alike; the only distinction on the sprite
  side is drawn (any non-zero pair, or a 1 bit in hires) against transparent.
  There is no mode in which only one of the sprite's colours goes behind the
  playfield.
- The playfield's class decides. With the bit set, a 1 bit in standard text
  and pairs 10 and 11 in multicolour text cover the sprite; a 0 bit and pairs
  00 and 01 show it. Pair 01 is background whatever colour `$D022` holds: a
  sprite with its bit set is entirely visible over a cell of solid pair 01.
- Bitmap modes follow the same rules, measured by a probe for this entry
  (VICE x64sc, PAL and NTSC, exit screenshot and `$D01F`). In a hires
  bitmap a 0 bit is background although its colour comes from the low
  nibble of screen RAM, not `$D021`: a sprite with its bit set showed on
  every line of a cell whose 0 bits were blue with `$D021` black, and the
  1 bits (white, the high nibble) covered it. In a multicolour bitmap pairs
  00 and 01 (the screen-RAM high nibble) showed the sprite and pairs 10
  (low nibble) and 11 (colour RAM) covered it. A sprite that sat only on
  hires 0 bits, or only on multicolour pairs 00 and 01, latched no
  `$D01F` bit. An earlier version of this list gave the multicolour bitmap
  rule from Bauer's VIC-II article, section 3.8.2, unmeasured, and said
  nothing of the hires bitmap.
- `$D01F` uses the same classes and ignores `$D01B`: the two sprites that
  sat only on pair 01 latched nothing, the six on 1 bits or pairs 10 and 11
  each latched their bit, set or clear.
- The order of decisions is sprite first, playfield second, and this is
  where the "inverts that sprite's position in the priority stack" picture
  two paragraphs up breaks down. Where sprite 4 (bit set) overlapped sprite 5
  (bit clear) over foreground, the playfield showed and *neither* sprite was
  drawn, although sprite 5 was drawn over the same foreground twelve pixels
  away. The VIC chooses the lowest-numbered sprite with a drawn pixel, then
  applies that sprite's bit; a lower-numbered sprite behind the playfield
  punches a hole through every higher-numbered sprite it overlaps wherever
  the playfield is foreground. `$D01E` latched both sprites all the same. An
  earlier version of this section, read as a stack of layers, would have
  drawn sprite 5 in front there.

The border is the front-most layer of the VIC-II's output
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

### Cycle budget

The VIC applies the bit while it draws, at no CPU cost. The CPU pays for
the write: `lda #` then `sta $d01b` took 6 cycles in
`kickassembler/sprite-priority-classes`, timed with the VICE x64sc monitor
stopwatch between breakpoints on PAL and NTSC. That is the Cost line, one
write per frame. Changing one sprite's bit and keeping the others
(`lda $d01b / ora # / sta $d01b`) is 10 cycles by the instruction table
(arithmetic, not measured here). A mid-frame switch under a raster IRQ
costs the IRQ, not the write (`sprite_multiplex_24` and `stable_raster_irq`
carry those figures).

### Recipes

- `recipes/kickassembler/sprite-priority-classes.md` puts eight still sprites over cells of every pixel pattern in both text modes, with `$D01B` set and clear and two sprites of mixed priority overlapping, and tabulates what shows per sprite class and playfield class from the exit screenshot; `$D01E` and `$D01F` are read once and checked against a compiled-in expectation.
- `recipes/oscar64/mixed-fighters.md` sets `$D01B` per frame to put a sprite actor in front of or behind a character actor, and measures that bit pair 01 in multicolour text is background. Oscar64's `spr_set()` has no priority argument (its signature
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
applies uniformly to every pixel of the sprite across all 21 rows, so one
register cannot give a color gradient (a flame that transitions from white at
the center to orange to red at the edges, for example). Changing the color
register mid-frame, on a specific raster line, while the sprite is rendering
gives distinct color bands at the cost of a tightly-timed write.

### How

The technique requires a stable raster IRQ (see `raster.md`, `stable_raster_irq`).

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
that holds the value for the whole line; the chip reads the register each time.
A CPU write to $D027+n that completes partway through a horizontal scan therefore
splits the sprite's pixel output into two color regions: pixels rendered before
the write use the old color, pixels after use the new one.

The cycle precision requirement comes from the VIC-II bus timing. On a PAL
machine running at 0.985 MHz, each cycle is approximately 1 microsecond, and
one CPU cycle is eight pixels: the 40 character columns of 8 pixels are fetched
over the 40 g-access cycles 16–55. A sprite's 24 pixels are therefore 3 CPU
cycles wide, in both hires and multicolor (multicolor halves the resolution to
12 double-width pixels, not the width), and an X-expanded sprite's 48 pixels
are 6 cycles. (An earlier version of this paragraph said 6 cycles in hires and
12 in multicolor, which is wrong by a factor of two and inverts what multicolor
changes.) To achieve a specific horizontal split, the write must complete on
one particular CPU cycle. This demands a stable IRQ with no jitter and a fixed
cycle offset from the IRQ entry point to the STA instruction.

### Variations

**Per-sprite gradient:** Apply independent color swap schedules to multiple
sprites, each with its own raster IRQ slot. With 8 sprites and 2 color bands
each, that is 16 IRQ writes spread across the frame.

**Animated gradient:** Each frame, shift the color band assignments up or down
by one row by adjusting the IRQ trigger line. The result is a scrolling color
wash moving through the sprite.

**Multicolor sprite color swap:** In multicolor mode, the sprite has three
color registers: the individual color ($D027+n) and two shared colors ($D025,
$D026). All three can be swapped mid-line. Changing $D025 mid-frame affects
every multicolor sprite at once: useful for palette flashes, destructive if
sprites need independent colors.

**Combined with Y-expand glitch:** A color swap on a Y-crunched sprite produces
banded gradients on tall stretched sprites for flame and waterfall effects. This
depends on the Y stretch, `sprite_stretcher_d017`, which is measured; the
colour swap on a stretched sprite is not. An earlier version said the
stretch itself was unverified.

### Cycle budget

On PAL (VICE 3.10 x64sc, default C64C model, VIC-II 8565; an earlier version
said 6569) a write to $D027+n that completes on CPU cycle
c (cycles numbered 1–63, the numbering in which the CSEL side-border pulse
lands on cycle 56) takes effect from sprite X ≈ 8c − 111. So a write on cycle
16 recolours a sprite at X=24 (the left edge of the display window) from its
first pixel, cycle 18 splits it at X=33, and cycle 34 splits a sprite at X=152
at X=161. Equivalently, the STA's write cycle is c = (X_split + 111)/8,
rounded down (X=24 gives 16, X=33 gives 18, X=161 gives 34); an earlier
version wrote 16 + (X_split − 24)/8, which gives 17 for X=33;
subtract the stable IRQ's entry-to-STA cost to get the delay. Use
`rirq_delay()` (5 cycles per unit) plus NOP padding (2 cycles) for sub-5-cycle
alignment. An earlier version of this section placed a sprite at X 24–47 "during
approximately CPU cycles 30–35" and asked for a "30-cycle delay for the left
edge, 33 for a midpoint"; cycles 30–35 are where a sprite at X ≈ 128–175 is
drawn, not one at X=24. The whole swap still fits within one raster line: STA 4
cycles plus the IRQ entry and exit cost (see the `sprite_multiplex_8`
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
**Cost:** cycles_per_frame=644, bytes_data=768
**Cost basis:** measured-vice
**Cost bytes basis:** derived-listing
**Cost measured on:** kickassembler-sprite-sine-chain (eight sprites, the update loop and the $D010 write, frame-counter print left out; in the lower border; PAL and NTSC)
**Claims:** sprite_0-7 (owns)
**Claims basis:** derived-listing

### Why

The middle band of a cracktro (`docs/demo-design/intro-cracktro-patterns.md`,
the Sprite-Chain Animation subsection of "Crack Intro") is eight sprites moving as one ribbon, chain or bouncing logo.
All eight hardware sprites are on at once and none is reused inside the
frame, so the whole effect is one table lookup per sprite per frame and a
single block of register writes in the vertical blank. It needs no raster
interrupt inside the display.

This is not `sprite_multiplex_8`. A multiplexer re-arms the eight sprites
between raster bands and demands `midframe_raster_irqs` and
`changes_sprite_set`; the chain keeps a constant sprite set and writes the
registers once a frame. `intro-cracktro-patterns.md` named
`sprite_multiplex_8` for the chain in an earlier version of its Sprite-Chain Animation subsection (it names `sprite_sine_chain` now) and its technique
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
still wraps with no extra code.

**Colour cycling along the chain.** Rotate the eight colour registers
`$D027` to `$D02E` one place every few frames so a hue runs down the
chain. This is a register write per sprite in the same blank; no extra
cost elsewhere.

### Cycle budget

Measured in the recipe, traced in VICE x64sc 3.10 from the frame
counter's increment to the `$D010` store, over 459 PAL and 521 NTSC
frames: 578 to 644 cycles, 578 plus 11 for each sprite past X 255,
the same on both models; 608 on average. That is about ten raster lines
of the lower border, where the CPU is otherwise idle. The frame-counter
print after it is the recipe's own and is not in the figure. The first
frame after start, the only one whose sprites had not been placed yet,
measured 836 on PAL and 820 on NTSC; its cause was not traced. Sprite DMA is unchanged by the
effect: the eight sprites are on every frame whether or not they move.

The Cost line said 200 cycles, estimated and not timed, 512 bytes of
tables and one IRQ slot. The recipe polls `$D012` and takes no
interrupt, and its tables are three of 256 bytes (`xlo`, `xhi`,
`ysin`), 768 from the listing. A demo starter that timed this loop with
CIA2 timer B measured 625 typical and 670 worst (`templates/demo`,
the #39 starter builds). Before #72 one basis word covered the whole Cost line, so it said `derived-listing`, the bytes' rung, beside measured cycles; the cycles now say `measured-vice` and the bytes keep `derived-listing` on their own line.

### Recipes

- `recipes/kickassembler/sprite-sine-chain.md` (the eight-sprite chain
  across the full width, MSB wrap, frame counter on screen, positions
  measured on PAL and NTSC). No logo or bounce recipe yet.
- `recipes/kickassembler/sine-table-runtime.md` (builds the sine table on
  the machine instead of with the assembler, then drives eight sprites
  from it; the way to get the table without `.fill`)

---

## dypp_sprite_sine_scroller — DYPP: a text scroller of eight sprites, each column on its own sine

**Complexity:** medium
**Region:** both
**Uses registers:** D000, D001, D002, D003, D004, D005, D006, D007, D008, D009, D00A, D00B, D00C, D00D, D00E, D00F, D010, D012, D015, D017, D01B, D01C, D01D
**Uses kernal:** (none)
**Requires:** sprite_sine_chain
**Cost:** cycles_per_frame=1869, cycles_per_frame_typical=1147, irq_slots=0
**Cost basis:** measured-vice
**Cost measured on:** kickassembler-dypp-sprite-scroller (in the vertical blank; worst frame is the constructed sum of the slowest position update, 1,154, and one character re-render, 715; typical is the update alone in 218 of 300 frames)
**Claims:** sprite_0-7 (owns)
**Claims basis:** derived-listing

### Why

A scroller whose columns each ride their own wave, with no character
buffer, no custom charset and no `$D016` fine scroll. DYPP, Different Y
Pixel Position, does with the sprite hardware what `dycp_scroller`
(`docs/techniques/scroll.md`) does with a charset: DYCP copies each glyph
into a strip of character slots at the pixel row the wave gives and
scrolls sideways through `$D016` and a ring buffer, several thousand
cycles a frame for a 39-column band. Here a column's height is its
sprite's Y register and its scroll is its X register, so the whole per-
frame cost is one loop of register writes in the blank.

The price is fixed by the hardware: eight sprites, so eight columns at
most, and a 24-pixel-wide sprite image, so the columns sit 48 pixels
apart and the glyphs are doubled 16 by 16 capitals rather than a
40-column line of 8 by 8 text. DYCP has the columns and the small font;
DYPP has the free vertical motion and the near-zero frame cost.

It is `sprite_sine_chain` with a payload. The chain phases eight
identical images along one sine; this puts a different character in each
sprite, moves them in a straight line horizontally with the sine on Y
alone, re-renders a sprite's image from the message each time it leaves
the left edge, and disables a sprite while it is in the 40-pixel gap
between X 343 and the wrap at 384. The chain's `$D010` mask, its blank-
line update and its measured position rules carry over unchanged.

### How

**The render.** At start all eight 64-byte slots (`$2000 + 64k`,
pointers `$80 + k`) are zeroed, so the sprites are blank until their
first hand-off. A hand-off reads the eight bytes of the character's ROM
glyph at `$D000 + code * 8` with `$01` set to `$33` (interrupts off, so
nothing else runs while I/O is hidden), puts `$01` back to `$37`, then
expands each glyph byte through three assembler-built tables into the
three bytes of a sprite row and stores that row twice. Glyph row `gy`
lands on sprite rows `2 + 2gy` and `3 + 2gy`, glyph column `gx` on sprite
columns `4 + 2gx` and `5 + 2gx`: the 8 by 8 glyph becomes a 16 by 16
block in rows 2 to 17 and columns 4 to 19. The recipe's `dbl(b)`
function doubles every bit of `b` into 16 bits; byte 0 of the row is its
top nibble, byte 1 its middle eight bits, byte 2 its bottom nibble in the
high half. The render writes the 48 bytes of rows 2 to 17; the 15 margin
bytes stay zero from the clear. Measured: 715 cycles, the same on every
hand-off.

**The positions.** One 9-bit `p`, 0 to 383, steps down by 2 a frame.
Sprite `k` is at `X = (p + 48k) mod 384`, kept as a 16-bit running sum:
add 48 per column with the carry, subtract 384 once when the sum reaches
it. The low byte goes to `$D000 + 2k`. The high byte decides three cases:
0, on screen with the `$D010` bit clear; 1 with a low byte under 88
(X 256 to 343), on screen with the bit set; 1 with a low byte of 88 or
more (X 344 to 383), disabled in `$D015` this frame, bit clear. The mask
and the enable byte are built in two locals and written once each after
the sixteen position registers, so low byte, MSB and enable change in the
same update. With 48-pixel spacing and 384 for a lap, exactly one sprite
is in the 40-pixel gap at any time, so at most seven are ever on screen.

**The two sines.** Only one is a sine: Y is `130 + siny[(p + 32k) &
255]`, `siny = round(40 sin)` as a signed byte, so each column bobs 40
lines either side of 130 and neighbours are an eighth of a period apart.
X is a straight line, `p` itself, which is what makes it a scroller;
a sine on X as well is a variation below. The amplitude is well under
128, so no entry of `siny` reaches 256 and wraps to zero
(`sine_table_peak_wraps_to_zero`, `docs/pitfalls/maths.md`).

**The wrap and the hand-off.** `X` is always even (`p` starts even and
every step and spacing is even), so a column passes X 4 exactly once a
lap. At X 4 the glyph's columns 4 to 19 sit at X 8 to 23, all under the
left border, so the character can change with nothing visible. (A
looser rule of "hand off anywhere below X 24" is realised as this single
even X: at X 6 to 22 the glyph's right-hand columns are still inside the
display and a re-render there would show.) The
update loop notes which sprite is at X 4; after the registers are written
that sprite is rendered from the next character of the message, whose
index wraps at a terminator byte. The sprite then steps to X 2, X 0,
wraps to 382, spends twenty frames disabled in the gap (X 382 down to
344) and re-enters at X 342 carrying the new character, twenty-three
frames after the hand-off. Starting `p` at 6 makes sprite 0's
first hand-off frame 1, and the message then streams in one character
every 24 frames.

**Update in the blank.** As for the chain: poll `$D012` for 255, do the
update and any hand-off there, and leave line 255 before polling again.
The whole worst frame, update plus render, is about 30 lines on PAL and
sits below the display on both models.

### Why it works

Everything the chain measured holds: a sprite's first row is the line
after its Y register, its first column is its 9-bit X, and the side
borders hide it below X 24 and above X 343 (`sprite_sine_chain`, Why it
works). The hand-off leans on the left border: a 16-pixel glyph placed
at sprite columns 4 to 19 is entirely under it once X is 4 or less, so a
re-render there is invisible, and the sprite is disabled through the
right-hand gap, so the new character first appears at the right edge.
Because `$D015`, `$D010` and all sixteen position registers are written
below the display, no frame ever shows a sprite half-moved or a mask
that disagrees with its low byte.

Measured in VICE x64sc from the recipe's pinned frame (`p = 174`): the
six glyphs on screen have their first lit column at `X + 14` (`X + 16`
for `I`, whose ROM glyph starts one column later) and their top lit row
at `Y - 13` on PAL, `Y - 25` on NTSC; `$D010` reads `$0C` for the two
sprites at X 270 and 318, and `$D015` reads `$EF` with sprite 4 at X 366
off. The control build with the `$D010` write removed draws those two
glyphs at X 14 and X 62, 256 pixels to the left, which is the failure
`sprite_x_high_bit_wrong_register` describes.

### Cycle budget

Measured with CIA 1 timer A in the recipe, both models giving identical
logs, raw figures including a 5-cycle empty bracket:

- position update of eight sprites, X, Y, `$D010` and `$D015`: 1,147
  cycles in 218 of 300 frames; minimum 1,091, maximum 1,154. The spread
  is the per-column branches (the 384 subtraction, the MSB, the off
  case, the X 4 test).
- one character re-render: 715 cycles, all thirteen hand-offs alike.

So a frame with a hand-off costs at most 1,869 cycles, about 30 PAL
raster lines, all in the vertical blank, and 218 of 300 frames cost
1,147. Sprite DMA is the usual 2 cycles per sprite plus 3 per group on
the lines where the sprites sit, unchanged by the effect; with the eight
spread across 80 lines of Y and 344 of X, fewer than eight ever share a
line.

### Variations

**More columns by multiplexing.** `sprite_multiplex_8` re-arms sprites
between raster bands; with the columns' Y range split into bands, a
second row of eight can share the sprites, at the cost of the
`midframe_raster_irqs` and `changes_sprite_set` demands the chain and
this entry avoid. Not built here.

**Expanded sprites for a bigger font.** Set the sprite's bit in `$D01D`
and `$D017` (`sprite_expand`) for a 32 by 32 glyph; the spacing must
grow to 96 and the lap to 768, so the 9-bit position no longer wraps in
a byte pair without a third case. Not built here.

**A second sine on X.** Add `sinx[(p + PHASE k) & 255]` to the column's
X before the 384 wrap, small enough that columns cannot overtake each
other (under 24 with 48-pixel spacing): the line of text sways as it
scrolls. The hand-off test then has to be a range rather than `X == 4`.
Not measured here.

### Pitfalls

- `sprite_x_high_bit_wrong_register` (`docs/pitfalls/sprite.md`): every
  column crosses X 255 once a lap; the control build shows the 256-pixel
  jump.
- `sprite_x_range_hidden_and_seam` (`docs/pitfalls/sprite.md`): the
  columns are deliberately parked under both borders and in the X 344 to
  383 gap; the entry relies on the hidden range.

### Sources

- `recipes/kickassembler/dypp-sprite-scroller.md`: the measurements
  above, the pinned frame tables for PAL and NTSC, the mid-motion shot
  and the `$D010` control.
- `sprite_sine_chain` above and `dycp_scroller` in
  `docs/techniques/scroll.md` for the two techniques this one is set
  against.

### Recipes

- `recipes/kickassembler/dypp-sprite-scroller.md` (eight yellow doubled
  capitals, 48 apart, each on its own Y sine; hand-off at X 4; frozen at
  frame 300; CIA-timed update and render; `$D010` control build)

---

## sprite_border_scroller — Sprite border scroller: a text scroller of eight sprites in the opened lower border

**Complexity:** medium
**Region:** both
**Uses registers:** D000, D001, D002, D003, D004, D005, D006, D007, D008, D009, D00A, D00B, D00C, D00D, D00E, D00F, D010, D011, D012, D015, D017, D019, D01A, D01B, D01C, D01D, D027, D028, D029, D02A, D02B, D02C, D02D, D02E
**Uses kernal:** (none)
**Requires:** topbottom_border_open, dypp_sprite_sine_scroller
**Demands:** midframe_raster_irqs
**Raster band:** movable (the sprite-border-scroller recipe updates from its RESTORE_LINE 20 for about 25 lines, its measured worst frame of 1,586 cycles, and opens the border on line 249; fli-music-scroller.md updates on lines 273-299, one-part-demo.md from line 273 to line 1)
**Cost:** cycles_per_frame=1586, cycles_per_frame_typical=829, irq_slots=2, sprites_per_line=8
**Cost basis:** measured-vice
**Cost measured on:** kickassembler-sprite-border-scroller (both handlers' brackets summed per frame, above the display; worst frame is a real hand-off frame, typical is 182 of 300 frames)
**Claims:** sprite_0-7 (owns), vic_raster_irq (owns)
**Claims basis:** derived-listing

The update can run on any lines where none of its sprites is drawn, so
the band is `movable`; a program states where it runs it as
`sprite_border_scroller@lines`. An earlier version stated the recipe's
lines, 20-46 and 249, as the technique's, and `c64_check_compatibility`
set it against the FLI's lines 45-251 in `fli-music-scroller.md`, which
runs the update on lines 273-299 (measured in VICE x64sc;
[#90](https://github.com/bdgscotland/c64-kb/issues/90)).

### Why

Text that costs the main screen nothing. A scroller on the character
screen takes a row of the forty by twenty-five and, if it is a fine
scroller, `$D016` and a ring buffer as well; a DYPP takes the sprites
but still lives inside the display, over whatever the screen shows. The
lower border is a region of the frame that draws nothing but `$D020`,
and once it is opened it is a strip of background under the display,
below line 250, that no character cell reaches. Put the sprites there
and the whole display is free: forty columns and twenty-five rows for
the game or the picture, and a line of scrolling text underneath that
touches none of it.

The price is the two raster interrupts that open the border each frame
and the loss of the top border too, since the method opens both (see
`topbottom_border_open`, raster.md: there is no bottom-only form). The
text is limited to what eight sprites carry, so seven doubled capitals
on screen at once, 48 pixels apart.

### How

**The border.** Exactly `topbottom_border_open`'s recipe: a raster
interrupt through `$0314` on line 249 reads `$D011`, clears RSEL (bit 3)
with bit 7 masked, and writes it back; a second interrupt on line 20 of
the next frame sets RSEL again. Line 249 is the middle of the three
lines, 248 to 250, that recipe measured as opening with a plain KERNAL
interrupt; line 20 is inside the window it swept (252 to 246 of the
next frame) and is chosen so that the same handler can move the sprites
while none of them is being drawn. `$3FFF`, the last byte of the VIC
bank, is written to zero, because below the display the VIC is idle and
fetches its graphics from that byte; zero draws plain background, a
non-zero byte draws its set bits over the strip.

**The sprites.** Eight single-colour, unexpanded sprites, pointers
`$80` to `$87` for eight 64-byte slots at `$2000` to `$21C0`, every Y
register 254. Sprite Y is compared against the low byte of the raster,
so 254 matches line 254 and the sprite's 21 rows are drawn on lines 255
to 275: below the display, inside the opened strip, and, on PAL, inside
the frame. On NTSC the frame ends at line 262 and the rows carry on
through the wrap onto lines 0 to 12 of the next frame.

**The positions and the wrap.** As `dypp_sprite_sine_scroller`: one
9-bit `p`, stepped down by 2 a frame, sprite `k` at
`X = (p + 48k) mod 384`; the low byte to `$D000 + 2k`, the `$D010` bit
set for X 256 to 343, the sprite disabled in `$D015` for X 344 to 383.
A sprite that reaches X 4 has its glyph, columns 4 to 19 of the image,
at X 8 to 23 under the left border, and there it takes the next
character of the message and is re-rendered from the character ROM into
its slot, 2 by 2 doubling into rows 2 to 17 and columns 4 to 19. All of
this runs in the line-20 handler, after the RSEL restore; the main loop
is empty.

### Why it works

The vertical border flip-flop is the only thing that hides a sprite in
the border. While it is set the border colour is drawn over graphics
and sprites alike; while it is clear the sequencer puts out background
and sprites are drawn as anywhere else. The flip-flop is set only when
the raster reaches the bottom comparison line, 251 with RSEL set or 247
with it clear. RSEL is 1 when line 247 passes and 0 when line 251
arrives, so neither comparison ever matches, the flip-flop stays clear
from line 251 to the end of the frame, and a sprite at Y 254 is
visible. The control build that never clears RSEL shows the converse:
the same seven sprites, enabled, positioned and pointed at
their glyphs, and zero white pixels below line 250 on either model.

Measured in VICE x64sc on the recipe's pinned frame (`p = 174`): white
pixels on screenshot rows 241 to 254 on PAL (raster lines 257 to 270,
sprite rows 2 to 15, the fourteen rows of a doubled seven-row ROM
capital) and on rows 229 to 242 on NTSC with identical per-row pixel
counts; six glyphs whose first lit column is `X + 14` (`X + 16` for
`I`); `$D010` reading `$0C` for the sprites at X 270 and 318, `$D015`
reading `$EF` with sprite 4 at X 366 off. On NTSC rows 235 to 242 of
those are lines 0 to 7 of the following frame, so the sprite is drawn
across the frame wrap; only sprite row 20, a blank margin row on line
12, falls outside the emulator's picture. Two runs per model gave
byte-identical screenshots.

### Cycle budget

Measured with CIA 1 timer A in the recipe, both models giving identical
logs, raw figures with each bracket's own start and stop stores inside:

- the line-249 handler, the RSEL clear with the compare, vector and
  acknowledge: 39 cycles, every frame.
- the line-20 handler, the RSEL restore plus the eight-sprite position
  update, `$D010` and `$D015`: 790 cycles in 182 of 300 frames, 734 to
  811 without a hand-off; 1,506 to 1,547 in the thirteen frames with
  one, the render being the difference.
- the two together: 829 cycles in 182 frames, worst 1,586, about 25 PAL
  lines from line 20, all above the display. The KERNAL's 29-cycle
  entry and the `$EA31` exit once a frame are outside the brackets, as
  is the DMA of up to eight sprites on lines 254 to 275 (all eight are
  enabled in four frames of every twenty-four, the eighth under the left
  border at X 0 to 6).

### Variations

**The upper border.** The method opens both borders, so the same
sprites could stand at the top instead: a Y of 4 draws from line 5 and
again from line 261, which is the topbottom recipe's parked sprite and
is drawn twice; a Y from 0 to 29 draws inside the open top border
(lines 1 to 50) and, on PAL, a second time on lines 257 to 306 of the
opened bottom strip, because Y is compared with the low eight bits of
the raster. On NTSC (6567R8, lines 0 to 262) the second copy starts on
line 257 + Y, so only Y up to 5 draws in the bottom strip; Y = 6 starts
on line 0 of the next frame. The copy then runs on across the frame
wrap as one 21-line sprite (Y = 4: lines 261, 262, then 0 onwards), with
no separate top copy. Measured in VICE x64sc with the topbottom recipe
and Y of 4 to 7; an earlier version said the NTSC copy was dropped for
Y above 6. A scroller there leaves the bottom strip empty only on
NTSC. Not built here.

**Expanded sprites for a taller font.** Setting the sprite's bit in
`$D017` doubles the 21 rows to 42, lines 255 to 296 on PAL, still inside
the frame; with `$D01D` as well the glyph is 32 by 32 and the spacing
must grow to 96 with a lap of 768, as the DYPP entry says. On NTSC 42
rows from line 255 reach line 33 of the next frame, into the top
border (measured in VICE x64sc with the topbottom recipe, Y = 254 and
`$D017` set; an earlier version said line 34 and "not measured").

**DYPP bobbing inside the border.** `dypp_sprite_sine_scroller`'s Y sine
fits in the strip only within a narrow band, because Y is eight bits
and is compared with the low eight bits of the raster: on PAL the only
Y values whose 21 rows stay below the display and match one line are
250 to 255 (lines 251 to 276), a bob of a few lines about 254; any
larger bob needs Y 0 to 34 for the lower rows, and each of those also
matches lines 0 to 34, drawing a mirror copy on lines 1 to 55 at the
top, into the display from line 51. On NTSC only lines 251 to 262 are
inside the frame and the rest wraps. Not built here.

### Pitfalls

- `sprite_x_high_bit_wrong_register` (`docs/pitfalls/sprite.md`): every
  column crosses X 255 once a lap and the `$D010` bit is written per
  sprite from the high byte, in the same handler as the low byte.
- `sprite_x_range_hidden_and_seam` (`docs/pitfalls/sprite.md`): the
  hand-off happens under the left border at X 4 and the sprite is
  parked disabled through X 344 to 383; the entry uses the hidden range
  on purpose.
- `d012_wrap_around` (`docs/pitfalls/raster-and-badline.md`): both
  handlers read `$D011` and write it back, so bit 7, the raster's ninth
  bit on a read, is masked off; the topbottom recipe explains why a
  handler that forgets moves its compare above line 255.

### Sources

- `recipes/kickassembler/sprite-border-scroller.md`: the measurements
  above, the pinned register and row tables for PAL and NTSC, the
  mid-motion description, the cycle logs and the `NOOPEN` control.
- `topbottom_border_open` in `docs/techniques/raster.md` and its recipe
  for the flip-flop rules, the 248-to-250 window and `$3FFF`;
  `dypp_sprite_sine_scroller` above for the render and the position
  rule this entry reuses.

### Recipes

- `recipes/kickassembler/sprite-border-scroller.md` (eight white doubled
  capitals at Y 254 in the opened lower border, 48 apart; the border
  opened on line 249 and restored on line 20 with the update in the same
  handler; hand-off at X 4; frozen at frame 300; CIA-timed handlers;
  `NOOPEN` control build)

---

## sprite_stretcher_d017 — Sprite stretcher: rows repeated by toggling the Y-expand bit every line

**Complexity:** high
**Region:** both
**Uses registers:** D000, D001, D010, D011, D012, D015, D017, D019, D01A, D01B, D01C, D01D, D021, D027, DC04, DC05, DC0D, DC0E
**Uses kernal:** (none)
**Requires:** stable_raster_irq
**Demands:** midframe_raster_irqs, cpu_every_line
**Raster band:** 97-181 (the recipe's first IRQ on line 97, its sync on 99, the toggled lines 100 to 180, the exit on 181)
**Cost:** cycles_per_frame=5094, cycles_per_line=63, lines_active=85, irq_slots=2, sprites_per_line=1, bytes_code=2628, bytes_data=67
**Cost basis:** measured-vice
**Cost measured on:** kickassembler-sprite-stretcher (CIA1 timer A over the toggled lines 100 to 181, screen on, one sprite; the double-IRQ entry on 97 to 99 is outside the bracket; the bytes are the `-showmem` blocks, code $0900-$1343 and the sprite plus three result bytes)
**Claims:** sprite_0 (owns), vic_raster_irq (owns), vic_yscroll (init)
**Claims basis:** derived-listing

The recipe sets YSCROLL 0 once, so its unrolled line table knows where
the badlines fall (one store in a `scripts/claims-watch.ts` trace). A
YSCROLL owner beside it moves those badlines and breaks the table; the
`init` item was added with the unit ([#71](https://github.com/bdgscotland/c64-kb/issues/71)).

### Why

A sprite made taller than its 21 rows without touching its data. The
classic use is the tall logo or the waterfall: one sprite's rows are
repeated down the screen for as long as the CPU keeps toggling, so a
24-pixel-wide column of any height costs 63 bytes of sprite data and no
redraw. The trick is old, widely described and, in this knowledge base,
was marked unverified: `sprite_y_stretch_glitch` above recorded that
its per-line clear+set attempts gave irregular rows. This entry settles that
by measurement. It is reproduced in VICE 3.10, and the edge is one cycle
wide: the setting write must complete in or before cycle 55 of the
line, the last CPU write cycle before the sprite's own DMA stalls the
6510, and one cycle later the write is pushed to cycle 61 and gives
nothing.

### How

1. Put the sprite up as usual (position, colour, pointer, $D015 bit),
   with its $D017 bit clear.
2. Take a stable raster interrupt on the line before the first line to be
   stretched (`stable_raster_irq`; the recipe uses the double-IRQ
   entry of `stable-raster-irq.md` on line 99 for a sprite at Y 100).
3. From there, run straight-line code for the whole region, one block
   per line, each exactly one line long. In each block, clear the
   sprite's $D017 bit with a store whose write cycle lands on C-4 and set
   it again with a store landing on C, where C is at most 55 (measured)
   and at least 17 (arithmetic from the cycle-16 row advance; nothing
   below C=48 was built); the recipe measures C from 48 to 55 as one
   plateau and pins 52. Pad the
   rest of the line with reads. The sprite's own DMA stops the CPU from
   cycle 55 to 59 on every line it is displayed, so a 58-cycle block is a
   63-cycle line; the recipe's `POST` constant is that arithmetic.
4. On a badline the CPU is stopped from cycle 12 to 59 and no write can
   land in the window; the recipe emits a 15-cycle block there and lets
   the row advance once. To hold one row across the region the badlines
   have to be moved out of it (`fld_flexible_line_distance`) or the
   sprite put where there are none; the recipe does not do this.
5. On the line after the last toggled one, write the bit clear early in
   the line and the sprite finishes its remaining rows unexpanded.

Measured (recipe, PAL, VICE 3.10): with C from 48 to 55 the sprite is 91
lines tall for 81 toggled lines: row 0 on five lines, rows 1 to 9 on
eight lines each, row 10 on four, rows 11 to 20 once. C=56 gives 24
lines, only the three rows after a badline doubled. C from 57 to 62
gives heights of 44 to 94 with rows skipped and, at 60, the sprite
wrapping through its data twice: the crunch of `sprite_y_stretch_glitch`,
reached because those builds' code runs longer than the line and the
writes drift into cycle 15 of the next one. The `NOSTRETCH` control,
identical code with the two stores aimed at a RAM byte, is 21 lines.
Three `-define NTSC` builds (C 48, 52, 55) give the same 91 lines on the
6567R8; the entry's Region rests on those three builds and not on the
recipe's pinned PRG, which is PAL-timed and on NTSC gives a 113-line
crunch, not a stretch (the recipe's region is therefore `pal`).

### Why it works

The expansion flip-flop and the counters are described under
`sprite_y_stretch_glitch` above (Bauer's article and the VICE source).
The audited hardware page names the flip-flop but not its cycle:
`hardware/vic-ii-reference.md`, Expansion, says that on the Y axis "the
chip uses an internal 'expansion flip-flop' that toggles each line", and
that changing $D017 mid-line "can confuse the flip-flop and cause
'sprite crunch'". The rule used here: while the bit
is clear the flip-flop is held set; while the bit is set and the
sprite's DMA is on it is inverted in cycle 56 (VICE 3.10's PAL cycle
table, as cited under `sprite_y_stretch_glitch`); and in cycle 16 of the
next line the row counter base moves on only if the flip-flop is set.
The clear on C-4 forces it set, the set on C hands it to the inversion,
cycle 56 clears it, and cycle 16 repeats the row. The sweep confirms the
placement from the CPU side: C=55 is the last write cycle that can
complete before the 6510 is stopped by the sprite's DMA (BA low from
55; a write proceeds under BA low, the read after it does not), and
C=56 is pushed to cycle 61 and does not stretch. What is measured is
the CPU write cycle against the DMA stop; the inversion's own cycle is
taken from the cycle table, and the data are consistent with any
inversion cycle from 56 to 61.

The C=56 column is the mechanism seen from the other side: its setting
write lands after the inversion, so on ordinary lines the bit is clear
at cycle 56, nothing is inverted, and the row advances; only after a
badline, where no clear was written and the bit stayed set across cycle
56, is a row doubled.

### Cycle budget

Measured in the recipe's pinned PAL run: 5,094 cycles between the timer
start on line 100 and its read on line 181 (arithmetic for that bracket
5,097; the three counts are the CIA's start latency, not separately
measured). Per line the CPU executes 58 cycles of its own code, eight of
them the two stores, and is stopped for five by the sprite's DMA; on the
ten badlines of the region it executes 15 and is stopped for 48. The
technique owns every cycle of every line it covers: with `cpu_every_line`
over an 85-line band it leaves nothing on those lines for anything else,
and nothing on the other lines is touched. The write window is wide (55
at the top, measured; 17 at the bottom, by arithmetic, with nothing
below 48 built), so the entry's stability matters more than its exact
phase: the
recipe's SYNC_PAD is the stable-raster recipe's 11, and a one-cycle
error would move C by one inside the plateau.

### Variations

**A toggle table.** The recipe's blocks are generated by a `.for` with a
constant decision per line; make that decision a byte per line (toggle,
or pad the same 58 cycles and do not) and the sprite's shape becomes a
table: N toggled lines then one plain line draws each row N+1 tall, a
run of plain lines draws the rows at their natural height, and the table
can be rewritten between frames. The badline positions are fixed by
YSCROLL and have to be in the table as plain lines unless the region is
kept clear of them. Not built here.

**All eight sprites.** $D017 is one byte for eight flip-flops, so the two
stores cost the same for eight sprites as for one; the DMA stop grows to
19 cycles (`sprites_per_line`, `hardware/vic-ii-reference.md`), which
moves the padding arithmetic and closes more of the window. Not
measured; with eight sprites `sprite_dma_overflow` applies.

**One row for the whole region.** Move the badlines out with
`fld_flexible_line_distance` (an extra $D011 write per line, inside the
same block) or run the stretch below the display with the lower border
opened (`topbottom_border_open`), where there are no badlines. Not
built here; the pinned picture is the eight-line staircase.

**Variable height per sprite, measured.** The c64-kb demo's part 8 (VICE
3.10, PAL and NTSC; parked over its background, see the FLD entry in
`techniques/raster.md`) stretched three sprites side by side, each to a
height of its own from a sine, with one clear-then-set pair a line from
a loop and no stable raster, and measured what the recipe could not.
With three sprites on the line the CPU is held from cycle 55 to cycle 1
of the next line, nine cycles, so a pass of 54 cycles (56 on NTSC)
repeats once a line. The pair written on line k sets the flip-flop the
VIC samples at cycle 16 of k + 1 and decides the row fetched for k + 2,
so every advance shows two lines after the line that decides it. A clear
landing at cycle 19 and a set at 27 repeat the row: the window's lower
edge, arithmetic above, holds there. A pass exactly the free window long
keeps whatever phase its entry gave it and walks one cycle a line
whenever a write cycle sits in the stalled window, since writes proceed
and reads stop, so a phase with a read at 55 is the stable one. Rows 0 to
3 and 18 to 20 of each sprite left blank take up the lines a shorter
stretch does not need, so all three sprites keep their DMA, and the stall
the loop is timed on, to the end of the band. The per-line advance table
was built in the main loop and double-buffered: on NTSC the build did
not finish before the band's interrupt, and a band that read a
half-built table ran 256 passes into the next frame.

### Pitfalls

- `raster_irq_first_line_jitter` (`docs/pitfalls/raster-and-badline.md`):
  the whole effect is a write on one cycle of every line, and the plain
  raster IRQ's 0-to-6 cycle entry jitter is larger than the distance
  from the pinned C=52 to the edge at 55; the double IRQ is what makes
  the write cycle a constant.
- `badline_cycle_loss` (`docs/pitfalls/raster-and-badline.md`): the CPU
  is stopped for 48 of the badline's 63 cycles once the sprite's DMA
  follows the character fetch, no write can land in the window, and the
  row advances there. In the sweep every plateau build shows it as the
  eight-line step; a block that did not allow for the stall would slip
  the rest of the region by 43 cycles.
- `sprite_y_expand_double_register_write` (`docs/pitfalls/sprite.md`):
  the same two writes one line too late, or with the setting write
  pushed past the sprite's DMA stall so that it lands after cycle 56,
  are the crunch; the C=57 to C=62 rows of the recipe's table are what
  that looks like.

### Sources

- `recipes/kickassembler/sprite-stretcher.md`: the fifteen-build sweep,
  the `CALIB` calibration of the write cycle against the sprite's DMA
  stop, the control, the NTSC builds and the CIA timer figure.
- `sprite_y_stretch_glitch` above, for the flip-flop, MCBASE and the
  crunch cycle; `stable_raster_irq` in `docs/techniques/raster.md` and
  its recipe for the entry this reuses.

### Recipes

- `recipes/kickassembler/sprite-stretcher.md` (one white sprite with
  numbered rows at X 160, Y 100; clear on C-4 and set on C every line
  from 100 to 180 with C=52 pinned; 91 lines tall; `C48` to `C62`,
  `NOSTRETCH`, `CALIB` and `NTSC` builds)

---

## sprite_cache_flip — Sprite cache: frames depacked and mirrored on demand

**Complexity:** medium
**Region:** both
**Uses registers:** D01C
**Uses kernal:** (none)
**Requires:** table_generation
**Cost:** cycles_per_frame=2672, cycles_per_frame_typical=20, bytes_data=1024
**Cost basis:** measured-vice
**Cost bytes basis:** arithmetic
**Cost measured on:** kickassembler-sprite-cache-flip (one cache miss, screen blanked)

### Why

A 16 KB VIC bank holds 256 sprite blocks of 64 bytes, fewer once the
screen, a charset and code take their share. A game whose hero and
enemies face both ways needs every frame twice. The fix is to store each
frame once, facing right and packed, outside the VIC bank, and to depack
it into a small cache of sprite blocks inside the bank only when it is
about to be shown, mirroring it on the way when the object faces left.
Metal Warrior 4 stores its frames facing right only and mirrors them at
load time, so 114 stored frames become about 170; Hessian caches 64 frames at $D000 to $DFFF, under the I/O area
(from Cadaver's articles, not measured here).

### How

**Mirroring a hires row.** A row is 3 bytes, 24 pixels, bit 7 of byte 0
the leftmost. The mirrored row is `T[b2], T[b1], T[b0]`: the three bytes
in reverse order, each with its 8 bits reversed. `T` is a 256-byte table
(HFLIP), so a row costs three indexed loads.

**Mirroring a multicolour row.** A multicolour pixel is a bit pair, four
to a byte. The mirror reverses the order of the pairs and keeps the bit
order inside each pair (MFLIP): `%aabbccdd` becomes `%ddccbbaa`. The
bytes are swapped as for hires. The hires table is wrong here: reversing
all 8 bits also reverses each pair, so %01 (colour from $D025) and %10
(the sprite's own colour) change places while %00 and %11 do not. The
shape comes out mirrored and the colours wrong. Measured in the recipe
with the hires table forced on the multicolour frames: the same screen
pixels are set, and 136 of the 156 the fish covers change colour.

**flip(flip(x)) = x does not catch the wrong table.** Both tables are
their own inverse, so a round trip through the wrong one passes. The
recipe's negative run showed it: 0 round-trip errors, 62 mirrored bytes
wrong.
Check a mirrored frame against a mirror made another way (the recipe has
the assembler reverse the pixel strings of each frame).

**Build the tables at start.** Each is 256 bytes of loop output, so
there is no reason to ship them: HFLIP takes 28,161 cycles and MFLIP
34,817, under two PAL frames each, once (measured, below). Page-align
both so `lda table,x` never adds a page-cross cycle. `table_generation`
in `techniques/cpu-cycle-tricks.md` covers the general case.

**Packing.** The recipe stores a 21-bit mask of the rows that are not
empty, then 3 bytes for each such row. Depacking and mirroring are one
pass: an empty row is three stores of zero, a present row three loads
and three stores, plus three table lookups when mirrored. Cadaver packs
into 6 slices of 7 bytes with one presence bit per slice (from his
article, not measured here). Any scheme that decodes row by row can
mirror as it goes.

**The cache.** A slot is one 64-byte block inside the VIC bank, and the
sprite pointer for it is its offset in the bank divided by 64. Two small
tables map both ways: `slot_of[key]` ($FF when not cached) and
`key_of[slot]` ($FF when free), where `key = frame * 2 + facing`. A
request looks up `slot_of`; a hit costs 20 cycles. A miss takes the next
slot, clears `slot_of` for the key that slot held, depacks into the
slot and records the new key. Forgetting to clear the old key is the
classic bug: its lookup then returns a slot that now holds another
frame.

**Eviction.** The recipe takes slots round-robin and has no protection,
which is safe only because it requests each displayed frame once and
has no more frames on screen than slots. A game must never evict a
frame that is on screen now or queued for the next frame. Cadaver's
c64gameframework stamps each slot with the frame counter when it is
used and skips slots stamped this frame or the last one, continuing the
search from where the last one stopped (read from its `sprite.s`, not
run here). Size the cache above the most distinct frames that can be on
screen in two frames, or the search finds no free slot.

**When to depack.** In the main loop, before the frame is built, never
in a raster IRQ. A fill costs 2,100 to 2,700 cycles, 33 to 43 PAL lines
(arithmetic from the measured figures at 63 cycles a line), far more
than a multiplexer IRQ has to spare. Request every frame the next
display needs, store the pointer each request returns in the object's
shadow pointer, and let the IRQ copy pointers only. A slot overwritten
while the VIC is fetching it can show parts of both frames for one frame
(not measured here).

**Cache under I/O.** Placing the cache at $D000 to $DFFF in VIC bank 3
uses RAM the CPU cannot see without banking out I/O through $01, so the
fill must run with interrupts off around the bank switch (Cadaver's
MW4 article, not measured here). See `ram_under_rom_traps` in
`pitfalls/banking.md`.

### Why it works

The VIC fetches sprite data through the pointer each line the sprite is
displayed, so a pointer change or a new block takes effect on the next
fetch; nothing is copied at display time. A horizontal mirror reverses
the pixel order of each row, and a row's pixel order runs from bit 7 of
byte 0 to bit 0 of byte 2 (hires) or pair by pair (multicolour), which
is what the byte swap and the table undo. The recipe checks the
result three ways: every table entry against a table the assembler
computed, every mirrored frame against the assembler's string-reversed
frame, and the exit screenshot, where each left-facing sprite is the
pixel mirror of its right-facing neighbour on PAL and NTSC.

### Variations

**Mirror once at load.** When the frame set fits the VIC bank twice,
mirror every frame once after loading into a resident second facing and
skip the cache. A turn is then a change of pointers and part offsets,
with no fill. `recipes/oscar64/sprite-mirror-at-load.md` does it for a
multicolour set with the pair-preserving table: building the table took
15,624 cycles, mirroring one 63-byte block 1,575 and a set of six blocks
(a three-sprite object, two frames) 9,658, all once at load (VICE x64sc,
CIA1 timer B, screen blanked, PAL and NTSC; compiled C). Every mirrored
pair matched its source read backwards and the exit screenshot showed
the left-facing object as the pixel mirror of the right-facing one with
the same colours. The price is 64 bytes of bank per frame per facing.
A three-sprite object turning through the cache instead needs three
fills of 2,100 to 2,700 cycles in the frame it turns (the misses above).
The Metal Warrior 4 note under Why is this variation. The platformer
starter's `templates/platformer/src/art.c` mirrors its player's hires
frames once at start, pixel by pixel without a table.

### Cycle budget

Measured in VICE x64sc 3.10 with CIA2 timers, screen blanked, IRQs off,
the cost of an empty timed call subtracted. Identical on PAL and NTSC.

| Operation | Cycles |
|---|---|
| Build HFLIP, 256 entries | 28,161 |
| Build MFLIP, 256 entries | 34,817 |
| Mirror one 63-byte sprite into another buffer, either table | 1,597 |
| Cache miss, 21 rows present, facing right | 2,441 |
| Cache miss, same frame, facing left | 2,672 |
| Cache miss, 15 of 21 rows present, right / left | 2,099 / 2,264 |
| Cache hit | 20 |

Mirroring during the fill costs 11 cycles a row over a plain copy (231
for 21 rows), so a cache that mirrors costs little more than one that
does not, and saves 64 bytes of storage per mirrored frame. The miss
figures include the lookup and the eviction bookkeeping. Moving the
mirror loop so its branch crossed a page raised the 1,597 to 1,617; the
recipe page-aligns its inner loops so the figures do not move as code
grows. The Cost line's `bytes_data` is arithmetic from the table and slot
sizes (256 + 256 + 8 x 64), run-time RAM outside the built segments; the
`cycles_per_frame` figure is measured. Before #72 one basis word covered the whole Cost line, so it said `arithmetic`, the bytes' rung, beside measured cycles; the cycles now say `measured-vice` and the bytes keep `arithmetic` on their own line. The frame data is extra.

The same cache in compiled C (`recipes/oscar64/sprite-cache-flip.md`,
multicolour frames only, CIA1 timer B, screen blanked, PAL and NTSC):
a miss is 3,692 cycles facing right and 3,902 facing left for a full
frame, 3,344 and 3,494 with 15 of 21 rows present, and a hit 42. That is
about 1,250 cycles a miss above the assembly figures; a left-facing
miss in C is 62 PAL lines. The Cost line stays the assembly figure; a C game
budgets the C one.

### Recipes

- `recipes/kickassembler/sprite-cache-flip.md` (both tables built at
  start and checked, four frames depacked into an 8-slot cache facing
  both ways, one eviction, figures and PASS on screen, the mirror
  measured from the screenshot on PAL and NTSC).
- `recipes/oscar64/sprite-cache-flip.md` (the cache in C: five packed
  multicolour frames, 8 slots round-robin, an eviction and a refill
  checked, four frames shown both ways and measured pixel by pixel on
  PAL and NTSC, cycles per miss and hit).
- `recipes/oscar64/sprite-mirror-at-load.md` (the mirror-once-at-load
  variation: a multicolour set of six blocks mirrored with the
  pair-preserving table, a three-sprite object turning in place, both
  facings measured pixel by pixel on PAL and NTSC).

### Sources

- Cadaver, on the sprite cache: https://cadaver.github.io/rants/sprcache.html
- Cadaver, on Metal Warrior 4's packed and mirrored frames:
  https://cadaver.github.io/rants/mw4trick.html
- cadaver/c64gameframework (MIT), `sprite.s`,
  https://github.com/cadaver/c64gameframework

---

## per_frame_hitbox — Collision boxes per animation frame, emitted at draw time, tested by group

**Complexity:** medium
**Region:** both
**Uses registers:** D010
**Uses kernal:** (none)
**Cost:** cycles_per_frame=3693, cycles_per_item=150, cycles_item_base=2992
**Cost basis:** measured-vice
**Cost measured on:** oscar64-per-frame-hitbox (eight boxes, 28 pairs of which the masks leave 10; an item is one tested pair that hits, over a base of eight boxes and no tested pair, see Cycle budget; 1,834 to test plus 1,859 to emit, from a build without the demo's pair counters and halved-X arrays; the recipe as shipped prints COLLIDE MAX 2,037 and EMIT MAX 2,148, which include them; in the vertical blank, PAL)

### Why

A game needs to know which object hit which, and whether that pair
matters. `sprite_collision_detect`'s `$D01E` cannot say either. It sets
one bit per sprite, so three touching sprites give three bits and no
pairs. It counts every opaque pixel, so a cape or a muzzle flash hits.
With a multiplexer the bit belongs to a hardware sprite that showed
several objects this frame. It cannot tell an enemy bullet passing
through an enemy from one hitting the player.

A single fixed box per actor (game-design-patterns.md, "Software
bounding-box collision") fixes the identity problem and gets poses
wrong: a crouching player is hit by a shot that passes over its head, and
a sword swing has no reach. Shipped engines give each animation frame its
own box and test boxes, not actors.

### How

**A box table per frame.** Each animation frame has zero or more boxes:
an offset from the sprite's origin (its top-left corner, or the engine's
anchor point), a width, a height and a group. A frame with no box is
harmless: an explosion or a pickup effect. An attack frame can carry a
body box and a separate weapon box.

**Fill the box list at draw time.** Where the draw sets a sprite's
position and pointer, it appends that frame's boxes to one list, in
screen coordinates: left, right, top and bottom edges, the group, and
the owning actor. An actor that is not drawn (off screen, or not
visible this frame) adds nothing, so the collision pass never looks at
it. The list is rebuilt every frame and is at most a few dozen entries.

**Groups and a pair mask.** Give each box one group bit: player, player
bullet, enemy, enemy bullet. For each group keep the set of groups it is
tested against: player with enemy and enemy bullet, player bullet with
enemy. Store that mask with each box when it is emitted; a pair `i, j`
is tested only when `mask[i] & group[j]` is not zero. Friendly fire is
then impossible, enemy bullets pass through enemies, and most pairs cost
one AND and a branch. The mask is symmetric, so each unordered pair is
visited once (`j > i`).

**The AABB test.** Two boxes overlap when `top[i] < bottom[j]`,
`top[j] < bottom[i]`, `left[i] < right[j]` and `left[j] < right[i]`,
with right and bottom exclusive. Any false compare ends the test. Put the
compare most likely to fail first: in a side-scrolling game most pairs
are apart in Y; in a vertical shooter, in X.

**8-bit and 9-bit X.** Sprite X is 9 bits, and the right 88 pixels of
the window are X 256 to 343. A test on the low byte alone wraps: an
enemy at 304 (low byte 48) is "hit" by a bullet at 52. Either store left
and right as a low and a high byte and compare the high bytes first (in
`left[i] < right[j]`: high less, true; high greater, false; equal,
compare the low bytes), or halve every X when the box is emitted and
test one byte at 2-pixel precision. Y fits a byte, but a box on a
sprite near the bottom can pass 255; clip it or halve Y too. Cadaver's
c64gameframework halves Y as it emits its bounds (`sprite.s`, source
read here).

### Why it works

The box and the image are chosen by the same frame number in the same
draw, so the collision shape cannot lag the picture. The pass tests what
the last draw put on screen. Groups carry the rule "who can hurt whom" in
data, so adding a type is a table entry, not a new branch in every test.
This is what c64gameframework does (`actor.s`, `sprite.s`, source read
here): the sprite draw appends each frame's bounds to one list, with an
end mark; a bullet skips actors whose group flags equal its own (an EOR
of the two flag bytes, masked) and actors with 0 hit points; an actor
may have several boxes, and a flipped frame mirrors its box about the
anchor.

### Variations

**Bullets against actors only.** Walk the bullet list against the actor
boxes instead of all pairs; with 8 bullets and 8 actors that is 64 pairs
before masking instead of 120.

**Several boxes per actor.** A boss or a multi-sprite actor emits one
box per part; the pass reports the owning actor and the box index, so a
weak spot can take damage and armour not.

**Flip.** For a frame drawn mirrored, the box's left offset becomes
`width_of_sprite - offset - box_width`; keep one table and mirror at
emit time.

**Expanded sprites.** Keep the box table in image pixels and scale at
emit time: on an X-expanded sprite the box's X offset and width double,
on a Y-expanded one its Y offset and height, and the origin (the X and Y
registers) does not move, because expansion grows the sprite right and
down from its top-left corner. `recipes/oscar64/sprite-expand.md` drew
an 8 x 5 box at image pixel 6, 8 as a sprite in front of its outline,
in all four expand states, and PIL found the drawn block exactly on the
scaled box each time: X 112 to 127 for a box of left 112, right 128 on
an X-expanded sprite at X 100, lines 167 to 176 for top 166, bottom 176
on a Y-expanded one at Y 150 (VICE x64sc, PAL and NTSC). The box's lines
are one below its coordinates, as for every sprite pixel, so boxes in
register coordinates still test correctly against each other. A flipped
expanded frame uses the expanded width: `48 - 2 * offset - 2 * box_width`
(arithmetic from the two rules, not measured here). Scaling the box in
compiled C with variable shifts took 158 cycles a box in that recipe.

**Guard.** A fighter's guard replaces the body box with a guard box: `fighter_guard_state` below, and the pattern of that name in `game-design/enemy-behaviour-and-difficulty.md`.

### Cycle budget

Measured in VICE x64sc 3.10 with CIA1 timer B, interrupts masked, in the
Oscar64 recipe: one 9-bit pair test costs 96 cycles when all four
compares run and 28 when the first fails; the halved 8-bit test costs 59
and 25 (100 calls less 100 empty calls, screen blanked). A frame with 8
boxes, 28 pairs of which the masks leave 10, costs 2,037 cycles to test
and 2,148 to emit on PAL as the recipe shows them. Those two figures
include the demo's pair counters and the halved-X arrays that only the
8-bit variant uses; built without them the same frame measured 1,834 to
test and 1,859 to emit, 3,693 in all, which is the Cost line. The same on
NTSC except the emit, which runs past the NTSC vertical blank into a
badline and reads 2,234. Figures move by a few cycles as the code grows
and the layout shifts.

**Per pair and per box.** Measured in VICE x64sc 3.10, CIA1 timer B,
interrupts masked, read from memory by the VICE monitor (rung 1). Two
kinds of build: the recipe's scenario without the pair counters and
halved-X arrays, with its masks as shipped (10 of 28 pairs tested),
all zero (none tested) or all set (all 28 tested); and a bench of the
recipe's `emit_boxes` and `collide` with N one-box actors at one
position, so every tested pair runs all four compares and hits, and
`event_bit` runs.

| Build | Collide | Emit |
|---|---|---|
| recipe, 8 boxes, none tested | 1,089 | 1,796 |
| recipe, 8 boxes, 10 tested (as shipped) | 1,826 | 1,860 PAL, 1,903 NTSC |
| recipe, 8 boxes, all 28 tested | 2,419 | 1,796 PAL, 1,882 NTSC |
| bench, 4 / 8 / 12 / 16 boxes, every pair masked | 343 / 1,082 / 2,202 / 3,706 | 505 / 1,097 / 1,641 / 2,185 |
| bench, 4 / 8 / 12 / 16 boxes, every pair tested and hitting | 1,237 / 5,249 / 11,499 / 20,233 | 497 / 1,081 / 1,617 / 2,153 |

The bench is the same on PAL and NTSC, screen blanked. A masked pair
costs 28 to 34 cycles (the bench's slope). A tested pair that hits
costs 138 to 149 more than a masked one from 6 pairs up (184 for a lone
pair); one that fails its first compare costs less. Emit is about 140
cycles a one-box actor in the bench and about 232 a box in the recipe,
whose actors carry one or two boxes each.

The Cost line's `cycles_per_item=150, cycles_item_base=2992` counts
tested pairs: 2,992 is the recipe's eight boxes with none tested, the
masked collide (1,089) plus the worst emit (1,903), and 150 is a hitting
pair. A plan that names `per_frame_hitbox ×40` is charged 2,992 + 40 ×
150 = 8,992. The base holds eight boxes and 28 pairs; with more boxes,
add about 232 per box emitted and 34 per masked pair from the table, by
hand. Without a count the plan is charged the recipe's frame, 3,693.

Hand-written assembly is much cheaper; this is arithmetic from the
instruction table (rung 3), not measured here. With the box arrays
indexed by X and Y, an 8-bit compare is `lda abs,y / cmp abs,x / bcs`,
10 cycles when it passes and 11 when it ends the test, so a full hit is
40 cycles and a first-compare miss 11. A 9-bit X compare with equal high
bytes adds a high-byte `lda / cmp / bcc / bne` before the low bytes, 22
cycles instead of 10, so a full 9-bit hit is 64. A masked-out pair is
`lda / and / beq`, 11 cycles.

### Recipes

- `recipes/oscar64/per-frame-hitbox.md` (stand, crouch and attack frames
  with their own boxes, a blade box in the player-bullet group, enemy
  bullets through enemies, a 9-bit miss that a low-byte test calls a hit,
  `$D01E` beside the box events, cycles per pair and per frame, the boxes
  drawn as outlines and measured on PAL and NTSC).
- `recipes/oscar64/sprite-expand.md` (one box scaled for the four expand
  states and measured on screen; the "Expanded sprites" variation).

### Sources

- cadaver/c64gameframework (MIT), `actor.s` (CheckActorCollision,
  CheckBulletCollision, AF_GROUPFLAGS) and `sprite.s` (bounds emitted by
  the sprite draw), https://github.com/cadaver/c64gameframework

---

## fighter_guard_state — A fighter's guard as a box: the guard box replaces the body box, and the box a blade meets decides block or hit

**Complexity:** low
**Region:** both
**Cost:** cycles_per_frame=364, cycles_per_frame_typical=41
**Cost basis:** measured-vice
**Cost measured on:** oscar64-fighter-opponent (both fighters' blades against body or guard boxes, X only, one floor; worst a hit with its push-apart; screen blanked, interrupts off)
**Claims:** none
**Claims basis:** derived-listing

The design, its checks and what breaks without it are the pattern of the
same name in `game-design/enemy-behaviour-and-difficulty.md`. This entry
is the mechanism and its cost, so that `technique-lookup` can name it; an
earlier version of the KB had only the pattern section (#113).

### Why

A guard changes what a blade meets. Put it in the boxes and the one
pair test that handles every contact resolves it. A guard flag checked
after damage has to be checked by every damage source, and a new one
(a projectile, a throw) forgets it.

### How

1. On a guard frame, emit a guard box in a guard group where the body
   box would be, over the part of the body the guard covers. Emit no
   body box.
2. Give a blade's pair mask both groups. A blade then meets a guard box
   or a body box, never both.
3. Guard box met: blocked, no damage, both fighters pushed apart (3
   pixels in the recipe). Body box met: a hit, a stun, a 6-pixel push.
4. A per-swing flag ends the blade after its first contact, so one swing
   resolves once.

### Why it works

The body box is absent while the guard box is present, so the group of
the box the blade met is the result. Height and facing are more boxes,
not more rules: a high and a low guard are two boxes, and a guard box
offset forward leaves the back of the body exposed. The full box test is
`per_frame_hitbox`'s four compares; the recipe has one floor and tests X
only.

### Variations

- High and low guards as two guard boxes over two parts of the body.
- A guard that covers the front only, so a blow from behind lands.

### Cycle budget

Measured in the recipe with CIA2 timer A around each of 2,400 `resolve`
calls, less an empty start and stop, interrupts off and the screen
blanked (Oscar64 -O2, VICE x64sc, PAL and NTSC the same): 364 cycles
worst, a hit with its push-apart loop, and 41 mean.

### Recipes

- `recipes/oscar64/fighter-opponent.md` — the opponent's guard frame replaces its body box; blows landed and blocked counted for both fighters and checked against a Python model

---

## sprite_animation_table — Sprite animation from tables: frames, durations, end actions and events

**Complexity:** low
**Region:** both
**Uses kernal:** (none)
**Cost:** cycles_per_frame=747, cycles_per_frame_typical=357
**Cost basis:** measured-vice
**Cost measured on:** oscar64-sprite-animation-table (six actors, the scenario's worst frame)
**Claims:** sprite_0-7 (shares)
**Claims basis:** measured-vice

### Why

Every game animates its sprites. Written as code in each actor's state
routine ("if timer = 6, next frame; if frame = 4, frame = 1"), the
frame logic is copied into every state, durations are hard to tune, and
the moment an attack spawns its bullet drifts from the frame that shows
the swing. Put the animation in data and the state code only asks for
one: "walk", "attack", "die".

### How

**The table.** An animation is a list of entries, each a frame (an
image number) and a duration in frames, then an end entry that says
what happens next:

| End action | Effect | Typical use |
|---|---|---|
| loop to entry N | continue from entry N; N > 0 plays an intro once | walk, idle, a rise then a loop |
| hold | stay on the last entry for good, report completion | death, a pose held until the next request |
| return to animation A | start A, report completion | attack, hurt, any one-shot |

A spare bit of the frame byte (bit 7 in the recipe) marks an entry that
fires an event when it is entered. Two parallel byte arrays for frame
and duration, plus a table of start indices, keep every lookup an
indexed load.

**Per-actor state.** The running animation, the current entry, a
countdown of frames left on it, and a facing: four or five bytes (the
recipe keeps five, with a held flag).

**The step, once per frame.** Decrement the countdown. When it reaches
zero, move to the next entry; if that is an end entry, apply its action
(loop, return or hold) until a real entry is reached; load the
countdown from its duration; fire its event if marked; write the sprite
pointer. On most frames the step is only the decrement, and the pointer
is written only when the entry changes.

**One-shot completion and events.** An attack whose third entry shows
the swing marks that entry, and the game spawns the bullet when the
event fires. Changing a duration then moves the shot with the picture,
and an attack cut off before its third entry never fires. The return
action reports completion ("done") and starts the default animation, so
the state code does not have to count frames to know the attack is
over. Cadaver's c64gameframework uses the same split: `AnimationDelay`,
a per-actor delay counter the caller uses to step a looping animation,
and `OneShotAnimation`, which stops on the last frame and
returns a carry flag, and `TransformActor`, which changes an actor's
type at the end (an enemy into an explosion) (`actor.s`, source read
here).

**Priority.** Give each animation a priority and refuse a request whose
priority is lower than the running animation's: a walk request during
an attack is refused, a hurt interrupts an attack, nothing overrides
death. Ignore a request for the animation already running, so a state
routine can request "walk" every frame without restarting it. Log or
count refusals while debugging; a refused request that the state code
expected to succeed is a common stuck-actor bug.

**Facing.** Store left-facing frames at a fixed offset in the block
numbers (the recipe uses +8) and add the offset when writing the
pointer: a turn keeps the entry and changes only the pointer. With
`sprite_cache_flip` on this page, only right-facing frames are stored
and the cache supplies the mirrored block; the table then yields a
frame number and a facing, and the cache request turns them into a
pointer. Dissecting Cadaver's engine, each actor has a base frame per
facing and the animation frame is added to it (from his article, not
measured here).

**Hitboxes.** A per-frame hitbox (`per_frame_hitbox` on this page)
belongs to the frame the table selects, so the draw that writes the
pointer also emits that frame's boxes. The table then drives the image,
the collision shape and the event in step.

### Why it works

The VIC reads each sprite's block number from screen + `$3F8` + n
(`$07F8` with the screen at `$0400`) and fetches 63 bytes from block ×
64 in the current VIC bank, so the whole animation is one byte written
per image change. Moving the screen or the bank moves both the pointer
bytes and the blocks (`vic_bank_visibility_collision` in
`pitfalls/banking.md`). Write pointers in the vertical blank, or from
the multiplexer's shadow table, so a change never lands while the VIC
is fetching that sprite.

The recipe checks the engine against the tables with a second model
that uses different arithmetic: it spends the elapsed frames entry by
entry from the animation's start instead of counting down, and reports
an event only when the time runs out exactly on an entry's first
frame. An off-by-one in the countdown moves every event and fails the
check. The check does not catch a wrong table, since both read it; the
pinned screenshot does.

### Variations

**Transform on completion.** Instead of returning to an animation, the
end action changes the actor's type (enemy to explosion, pickup to
nothing), as c64gameframework's `TransformActor` does.

**Speed per actor.** Scale durations by a per-actor rate, or step twice
on a frame, for a haste effect; a table of durations in 1/2 frames with
a fractional countdown does the same at finer grain.

**Direction-dependent animations.** Games with eight-way movement keep a
table of animations per direction instead of one facing offset.

### Cycle budget

Measured in VICE x64sc 3.10 with CIA1 timer B, interrupts masked, in the
Oscar64 recipe, the same on PAL and NTSC. One step that only
decrements costs 25 cycles; one that moves to the next entry and writes
the pointer costs 124 (averaged over a two-entry loop, half the calls
through the loop action). Both are 100 calls through a function pointer
less 100 empty calls, screen blanked. Six actors on a frame where all
only decrement cost 357 cycles, loop and calls included, about 60 each;
the worst frame of the recipe's scenario is 799, with one return to idle
and a log entry and three other actors changing entry. Without the
recipe's log write the same frame measured 747, which is the Cost line.
Hand-written assembly with the state in arrays indexed by X is
cheaper: `dec count,x` (7 cycles) and a taken `bne` (3) are 10 cycles
when the entry holds (instruction-table arithmetic, not measured here).

### Recipes

- `recipes/oscar64/sprite-animation-table.md` (six actors on a scripted
  run: looping walk, idle, a rise looping from entry 1, an attack firing
  on its third entry and returning to idle, a hurt cutting an attack
  off, a held death, two requests refused by priority; the log and the
  final pointers compared with a second model; cycles per step; the
  sprite images measured on PAL and NTSC).

### Sources

- Cadaver, dissecting his game engine (base frame per facing):
  https://cadaver.github.io/rants/dissect.html
- Cadaver, on actor interaction and transformation:
  https://cadaver.github.io/rants/interaction.html
- cadaver/c64gameframework (MIT), `actor.s` (AnimationDelay,
  OneShotAnimation, TransformActor),
  https://github.com/cadaver/c64gameframework

---

## software_sprite_preshifted — Pre-shifted masked software sprites in a character back buffer

**Complexity:** medium
**Region:** both
**Uses registers:** D018, D012
**Uses kernal:** (none)
**Requires:** unrolled_loops
**Cost:** cycles_per_frame=1890, bytes_code=1304, bytes_data=1344
**Cost basis:** measured-vice
**Cost bytes basis:** derived-listing
**Cost measured on:** kickassembler-software-sprite-preshifted (one object drawn and erased, with its own blit, erase and tables; screen blanked)

### Why

Eight hardware sprites run out. A multiplexer (`sprite_multiplex_8`)
stretches them down the screen, but it cannot put a ninth object on the
same raster lines as eight others, and many small objects on one row is
what a shooter's bullet cloud or a puzzle game's falling pieces
need. A software sprite is drawn by the CPU into memory the VIC is
already displaying: a block of character definitions laid out as a
canvas, or a bitmap. It costs CPU time instead of a hardware slot, and
there is no limit per line.

The naive draw shifts each row of the object right by the pixel offset
before writing it, which is a shift and a carry across three or four
bytes for every row, every frame. Pre-shifting does that once, off-line:
the object is stored eight times, once for each pixel offset within a
byte, together with its mask. A draw is then a straight copy through an
AND and an OR, and it costs the same at every one of the eight shifts.

### How

1. Lay out the back buffer. In character mode, point `$D018` at a
   custom font and give a block of consecutive character codes to the
   canvas: cell `(cx, cy)` is code `base + cy * W + cx`, so pixel row `y`
   of cell column `cx` is byte `font + (y / 8) * W * 8 + cx * 8 + (y & 7)`.
   One pixel row of the canvas is one byte per cell, eight bytes apart.
   Fill the canvas with the background tile and write the codes into the
   screen once; from then on only the font bytes change.
2. Build the pre-shift table. For a 24x21 object each shift is 4 bytes
   wide by 21 rows, 84 bytes of data and 84 of mask (mask bit 1 means
   leave the background alone). Eight shifts: `8 * 84 * 2 = 1,344` bytes
   an object (arithmetic; the recipe's assembler reports 2,688 for two).
   Store it transposed, the eight shifts of one byte position together,
   so the shift is a Y index and the position is a constant.
3. Draw: with `X = x & $F8` (the cell column times 8) and `Y = x & 7`
   (the shift), for each of the 84 byte positions `lda dest,x` /
   `and mask+p*8,y` / `ora data+p*8,y` / `sta dest,x`, unrolled, 17
   cycles each. The object's top row `y0` is baked into the unrolled
   addresses; a second object at another row is a second copy of the
   routine, about 1 KB each.
4. Erase before the next draw. With a tiled background the cheapest
   erase writes the tile's rows back over the 4-cell footprint: one
   immediate load and four stores a row. A background that is not a
   repeating tile needs a saved copy of the footprint instead, restored
   in the same order.
5. Run the erase and the draws where the VIC is not reading the canvas.
   The character generator bytes are fetched on every raster line the
   canvas cells are on, so a draw during those lines tears. Poll `$D012`
   for a line below the canvas and do the frame's work there; a canvas
   that fills the screen leaves only the vertical blank, and then two
   fonts and a `$D018` flip are needed, which is `screen_double_buffer_d018`
   applied to the font bits instead of the matrix bits.

### Why it works

The VIC reads character definitions from the font on every line, so a
byte written to the font shows on the next line that draws that row of
the cell. Cell-aligned characters mean the CPU does not have to know
where on screen the canvas is; the address arithmetic is all in font
memory, and X indexing by `x & $F8` moves the whole draw one cell
without touching any operand. The AND clears the object's silhouette
out of the background and the OR paints the shape into the hole, so
any number of objects can be layered in draw order, the later one on
top, without a sprite-priority register.

The recipe times one masked blit of a 24x21 object at each of the eight
shifts with CIA2 timer A, display blanked, net of the call: 1,428
cycles at every shift, on PAL and NTSC alike (measured in VICE x64sc).
That is `84 * 17`: the run-time cost of the shift is zero. The tile erase of the same footprint is 462 cycles.
One object drawn and erased is therefore 1,890 cycles a frame, about
9.6 % of a PAL frame; two are 3,780. The same blit started at raster
line 100 with the display on measured 1,557 on PAL and on NTSC: the
129 extra cycles are the three badlines the 23-line blit crosses,
which is `badline_cycle_loss` in the display area, and the reason the
timing figures were taken with DEN off.

### Against the multiplexer

Choose the multiplexer when the objects are few per raster line, need
free pixel placement in both axes and their own colours, and move over
a background that cannot cheaply be repainted: it costs a raster IRQ and
register writes, not a redraw. Choose pre-shifted software sprites
when several objects share raster lines, when they sit on a tiled or
saved background, or when the sprite hardware is spoken for by the
player and the bosses. The two combine: hardware sprites for the few
that need sub-cell placement and priority, software sprites for the
crowd. A software sprite has one colour per cell it touches, the cell's
colour RAM entry, and it is erased and redrawn every frame it moves, so
its cost scales with the count while a sprite in a hardware slot is
free to move.

### Variations

**Save-under erase.** Copy the 84 bytes under the footprint before the
draw and write them back to erase. Costs a copy per object per frame
(not measured here) but works over any background, and is what a
bitmap-mode version needs.

**Bitmap canvas.** The same tables and the same masked copy, with the
destination a bitmap: eight bytes per cell row, 320 bytes per cell row
of the screen. `bobs_effect` on `effects-vector-3d.md` describes both
the cell-aligned and the bitmap forms at the demo scale; this entry is
the pixel-placed, cell-mode case with a measured blit.

**Three-byte shift zero.** At shift 0 the fourth byte is all mask and
no data; a separate 63-byte routine for that shift saves 21 stores.
Not done in the recipe, which keeps one routine so the eight figures
are comparable.

### Cycle budget

Per object per frame, measured: 1,428 to draw, 462 to erase, 1,890 in
all. For the recipe's two objects, 3,780 cycles, which is about 60
raster lines of the 213 that lie below a canvas ending on line 98, and
inside the 6,700-cycle race-free blank the pitfall page quotes even if
the canvas filled the screen. Six such objects would not be: at 11,340
they would spill into the display, which is where
`full_field_redraw_exceeds_vblank` starts. The `cycles_per_frame` figure
on the Cost line is one object, drawn and erased, and so are the byte
figures: 1,304 bytes of code, 1,009 for its unrolled blit routine and
295 for its erase, and 1,344 bytes of tables. The built recipe has two
objects, 2,608 and 2,688 bytes (the assembler's own byte counts; the
timing and print harness is not counted). An earlier Cost line gave
the two objects' bytes beside one object's cycles. Before #72 one basis word covered the whole Cost line, so it said `derived-listing`, the bytes' rung, beside measured cycles; the cycles now say `measured-vice` and the bytes keep `derived-listing` on their own line.

### Recipes

- `recipes/kickassembler/software-sprite-preshifted.md` (16x4 cell
  canvas, tiled background, a ring and a diamond crossing it in opposite
  directions, the blit timed at all eight shifts, checksum verdict)

---

## multi_sprite_object — Bosses and large objects from several hardware sprites at fixed offsets from one origin

**Complexity:** medium
**Region:** both
**Uses registers:** D000, D001, D010, D015, D017, D01D, D027
**Uses kernal:** (none)
**Cost:** cycles_per_frame=1342, sprites_per_line=3
**Cost basis:** measured-vice
**Cost measured on:** oscar64-multi-sprite-object (worst frame, six parts, in the vertical blank)

### Why

One sprite is 24 x 21 pixels, 48 x 42 expanded. A boss, a tank or a
mothership is bigger. The game still wants to treat it as one actor: one
position, one movement routine, one death. The answer is a part table.
The object has one origin, and each part is a hardware sprite at a fixed
offset from it.

The offsets break assumptions that hold for one sprite. A part can be past X 255 while
the origin is not, or the reverse, so the ninth X bit belongs to each
part. A part can be off screen while the object is on screen. The parts
also use several of the eight sprites on the same raster lines, which a
multiplexer has to account for.

### How

**A part table.** Per part: `dx` and `dy` from the origin (signed), the
base frame, the colour, the expand flags and, if it animates, its
animation length. Keep the table per object type. Keep per object only
the origin and each part's animation state.

**9-bit X for every part.** Compute `x = origin + dx` in 16 bits for
each part. Its low byte goes to `$D000 + 2n` and its bit 8 to the part's
own bit in `$D010`. A part at `dx = -24` under an origin at 264 is at
240, bit clear, while its neighbours have the bit set. Build the
object's `$D010` bits in a byte and merge them under the object's sprite
mask: `$D010 = ($D010 & ~mask) | bits`. `$D015` is merged the same way.
A plain store would clear the bits of every other object's sprites.

**Clip each part.** Show a part only when some of it is inside the
window: X from 24 to 343 and Y from 50 to 249 (CSEL = 1, RSEL = 1),
with the part's own width and height. Otherwise clear its `$D015` bit and
skip its writes. A part under the border would be invisible anyway,
but it still takes a hardware sprite, its DMA and a multiplexer slot.
Past X 511 the 16-bit sum no longer fits the 9 bits and wraps to the
left side, and on PAL X 504 to 511 is never drawn
(`sprite_x_range_hidden_and_seam` in `pitfalls/sprite.md`). A part
partly left of X 0 needs the model's wrap: a probe for this entry put an
X-expanded sprite at X 500 and found its left edge at pixel -4 on PAL
and -12 on NTSC, so the wrap is at 504 on PAL and 512 on NTSC (VICE
x64sc, exit screenshot). Hide such a part, or pick the modulus at
start-up as that pitfall says. Clip Y in the 16-bit sum too: a part
at `dy = 42` under an origin at Y 230 is at 272, which `$D001` cannot
hold.

**Expanded parts cover more with the same sprite.** An X-expanded part
is 48 wide and a Y-expanded one 42 tall, for the DMA of one sprite
(`sprite_expand`). The pixel doubles too: 2 screen pixels wide for hires,
4 for multicolour (arithmetic), and 2 lines tall. Beside an unexpanded
part the difference shows, so draw the art for it: armour plates and
wings expanded, the face and the weak spot not. The clip test uses the
expanded size.

**Animate per part.** Only the parts that move need a countdown and a
current frame; the frame written is the base frame plus the step. An
eye blinks, a turret turns, and the other parts' pointers are still
written each frame without change. Colour and expand bits usually
stay fixed for the object's life, so they are written once at spawn,
under the mask.

**Hit boxes per part.** Emit one box per shown part where the part is
placed, as `per_frame_hitbox` (this page) does in its "Several boxes per
actor" variation. The collision pass then reports the part as well as
the actor, so armour can ignore a shot and a weak spot can take it. A
clipped part emits no box. Corescape gives each of its boss's parts its
own enemy type and hit count, 8 (16 in hard mode) against the core's 32
(64) (`enemies.cpp`, source read here).

**Overlap and flip.** Where parts overlap, the lower sprite number is in
front (`hardware/vic-ii-reference.md`), so put the part that must show
on top in the lower slot. To face the other way, each part's offset
becomes `-dx - width` and its image is mirrored (`sprite_cache_flip`).
c64gameframework stores a mirrored X offset beside the normal one for
every part, so the flip is a choice of column, not arithmetic
(`sprite.s`, source read here). With the anchor in the middle of the
object the parts cover the same span either way and the object turns
in place. `recipes/oscar64/sprite-mirror-at-load.md` turns a
three-sprite multicolour object this way, offsets -36, -12 and 12, with
a left-facing frame set mirrored once at load: every part's registers
matched a model in each of 128 frames with seven turns, and the exit
screenshot shows the left-facing object as the exact pixel mirror of the
right-facing one (PIL, PAL and NTSC). Placing the three parts took 417
cycles facing right and 460 facing left in compiled C.

### Why it works

The VIC-II does not know the parts belong together. Each part is a
complete sprite with its own X, Y, pointer, colour and expand bits. The
object stays in one piece because every part is recomputed from the same
origin in the same frame, before the raster reaches the object. Write
the parts in the vertical blank, or below the object's last line, and
the whole object moves at once. Writes that straddle the raster can show
the top parts at the new origin and the lower parts at the old one for
a frame (from the mechanism; not measured here).

The Oscar64 recipe checks this against a model each frame: every part's
X low byte, `$D010` bit, Y, `$D015` bit, pointer, colour and expand bits,
and the bits of a sprite that belongs to another object. It found no
mismatch in any frame of a sweep across X 255 and past the right edge,
on PAL and NTSC. Its screenshots put each part's pixels where
the model places it, including a part whose register X is 240 while its
pixels cross X 256 (VICE x64sc).

### With a multiplexer

Each part is one sprite to the multiplexer. An object that is k parts
wide on a raster line leaves 8 - k sprites for everything else on those
lines. The recipe's boss is 3 wide on every line it covers, and
Corescape's boss puts five of its six sprites within 4 lines of each
other (offsets in `enemies.cpp`), so on those lines only three are free.

`sprite_multiplex_game` rejects the ninth sprite on a band, one sprite
at a time. A boss part can lose that test while its neighbours pass,
and the boss shows with a hole in it. Either give the object's parts
priority in the sort or the acceptance pass so they go in first, or keep
the boss out of the multiplexer in fixed hardware sprites and multiplex
only the rest. Corescape does the first kind: each boss part is its own
virtual sprite (`vspr_set` for each part, `enemies.cpp`).

A Y-expanded part holds its hardware sprite for 42 lines, not 21, so the
reuse gap for that slot is 42 lines (arithmetic from the Y-expand
mechanism in `sprite_expand`; not measured here).

### Variations

**Logical sprites.** c64gameframework separates the logical sprite, the
object's picture, from the physical sprites it is made of, and each
part carries an expand flag. Its clip test has a separate X limit for
expanded parts. It drops a part that is outside the X or Y limits and
keeps the rest, and it stops adding parts when no sprite is left
(`sprite.s`, `screen.s`, source read here).

**Halved X.** Store every X halved, one byte, and double it when
writing the registers. Adding `dx / 2` is then an 8-bit add, at 2-pixel
resolution. c64gameframework keeps sprite X halved: its clip test
compares against `MAX_SPRX / 2` (`sprite.s`).

**A detachable part.** Give a part its own hit points and a flag that
drops it from the table when destroyed. The rest of the object keeps its
offsets, and the freed hardware sprite goes back to the pool.

### Cycle budget

Measured in VICE x64sc 3.10 with CIA1 timer B, interrupts masked, in the
Oscar64 recipe. Screen blanked, one call each, less an empty call: 197
cycles for each part shown, 78 for each part clipped, 67 fixed per
object. During the run, at the top of the vertical blank, a whole
six-part update took 808 to 1,342 cycles, the same on PAL and NTSC. The
worst frame, the Cost line, had all six parts shown and above X 255, and
the animated part stepping. A typical frame with all six shown is about
1,249 (6 x 197 + 67, arithmetic from the measured figures). The worst
and best figures include the timer start and stop and the call, 34 cycles
for an empty call timed the same way (measured here); the per-part figures
do not. These are
compiled C. Hand-written assembly with the table indexed by X is
cheaper; it was not measured here. The model check and the on-screen
counters are not in these figures.

### Recipes

- `recipes/oscar64/multi-sprite-object.md` (a six-sprite boss, three
  parts on top and an X-expanded wing, a Y-expanded core and a second
  wing below, one part animated; on autopilot it sweeps across X 255 and
  past the right edge; every part's registers, including its `$D010`
  bit, checked against a model every frame; cycles per update and per
  part; each part's box measured with PIL on PAL and NTSC)
- `recipes/oscar64/sprite-mirror-at-load.md` (a three-sprite object
  that turns in place about its anchor, `-dx - width`, with a mirrored
  frame set; registers checked every frame, the mirror measured on
  screen)

### Sources

- drmortalwombat/corescape (GPL-3.0), `enemies.cpp`: boss parts at
  offsets X -48, -24, 0, 24, 48 and Y -4, -2, 21, -2, -4 from the core,
  each with its own type and hit count, each a `vspr_set` virtual sprite.
  https://github.com/drmortalwombat/corescape
- cadaver/c64gameframework (MIT), `sprite.s` and `screen.s`: logical
  sprites made of physical sprites, per-part flipped X offset, expand
  flag, and per-part clip limits.
  https://github.com/cadaver/c64gameframework

---

## mixed_sprite_char_actors — Large actors drawn partly in hardware sprites and partly in reserved character cells

**Complexity:** medium
**Region:** both
**Uses registers:** D000, D001, D010, D018, D01B
**Uses kernal:** (none)
**Requires:** mob_priority
**Cost:** cycles_per_frame=6108, sprites_per_line=2
**Cost basis:** measured-vice
**Cost measured on:** oscar64-mixed-fighters (worst tick of the whole actor update, PAL)

### Why

A beat-'em-up or sports fighter is bigger than a sprite. Two fighters
of 2 x 2 multicolour sprites take all eight, and they stand side by
side on the same raster lines, so a multiplexer cannot reuse any of
them: it reuses a sprite only below the lines where it was last shown.
Nothing is left for a third actor, a ball or an effect. The alternative
is to draw part of the cast in character cells: a block of cells whose
glyphs belong to that actor alone and are rewritten when it animates
or moves inside a cell. It costs CPU time when the picture changes and
no sprite at all, and its size per line is limited only by the cells.

What IK+ (System 3, 1987) did is not established here. Games That
Weren't has preserved Archer Maclean's IK+ design notes as scanned
galleries; the page's text does not describe how the fighters were
drawn, and the source code was not published. A Lemon64 thread titled
"IK: How sprites and character graphics worked together" is a forum
report; it could not be read here (HTTP 403).

### How

1. Reserve a glyph range in a RAM font (`$D018`). A block W x H cells
   uses W x H codes, laid out once: cell `(cx, cy)` of the block shows
   code `base + cy * W + cx`. Nothing else on screen uses those codes.
2. Draw the actor's picture into those glyphs. Rewrite them when the
   animation frame changes, and when the actor moves inside a cell if
   it moves in steps finer than 8 pixels.
3. Move the block of codes when the actor crosses a cell boundary:
   clear the cells it leaves and write the codes at the new column.
4. Draw the other actor, or the parts that must move freely, in
   hardware sprites (`multi_sprite_object`).
5. Decide who is in front each frame with the sprites' `$D01B` bits,
   and finish every write before the raster reaches the actors' first
   line, or start it after their last line.

**Whole cells or pre-shifted.** Moving the block in whole cells needs
no extra table, and the glyphs change only on an animation frame; but
the actor steps 8 pixels, which shows beside a sprite moving in 1 or 2.
Pre-shifting stores each frame at every offset inside a cell, one
column wider, and copies the right one on every move. In multicolour
text a pixel is 2 screen pixels wide, so four shifts cover every
position. The recipe's 16 x 48-pixel actor in a 5 x 6 block is 240
bytes a shift, 1,920 for two poses (the Oscar64 map).

**Colour.** A multicolour cell has one colour of its own, colour RAM
0 to 7, and shares `$D022` and `$D023` with every multicolour cell on
the screen. A multicolour sprite has one colour of its own and shares
`$D025` and `$D026` with every multicolour sprite. Two actors drawn
different ways can therefore look alike only within those limits.

**Background.** The block replaces the cells under it. Its 00 pixels
show `$D021`, not the scenery. Keep the actors on a plain band, or
merge the background into the actor's glyphs as a masked draw
(`software_sprite_preshifted`), which costs more per frame (not
measured here). Two character actors that overlap share cells and need
that merge too; one character actor and one sprite actor do not.

### Overlap and priority

The character actor is playfield, so the sprite actor's `$D01B` bits
decide who is in front, one bit per sprite (`mob_priority`). Bits clear:
the sprite actor is in front of every pixel of the character actor.
Bits set: the character actor's foreground pixels cover the sprite.
In multicolour text only bit pairs 10 and 11 are foreground for this;
pairs 00 and 01 are background, so the sprite shows through any part
drawn in `$D022`. The recipe measured it: with the character fighter in
front, 344 pixels of it covered the sprite fighter and 44 pixels of
the sprite fighter showed through its `$D022` belt (VICE x64sc, PAL and
NTSC, every arena pixel compared with a model). The 344 were 296 of
pair 11 and 48 of pair 10. Draw the parts that
must cover the other actor in pairs 10 and 11.

Sprite-to-sprite order is fixed by sprite number and ignores `$D01B`.
It does not enter between the two actors here, since only one of them
is sprites. Flip the bits in the same update as the positions, before
the raster reaches the actors, so one frame never shows the old order.

### Why it works

The VIC reads the glyph bytes on every line that shows the cell, so a
glyph write shows on the next frame that draws it, and a code write
moves the whole cell. Because the actor owns its codes, a redraw is a
copy into a fixed address range: no mask, no read of the screen and no
search for which cells are affected. The sprite actor costs its
register writes only. The two meet only in the VIC's priority logic,
which needs no CPU time.

The Oscar64 recipe hashes the arena's screen codes, the 240 glyph bytes
and the sprite registers at 17 checkpoints of a scripted fight and
compares them with a Python model; none differed, on PAL or NTSC. The
pinned screenshots, and a probe with the sprite fighter in front, match
the model at every one of the 15,360 arena pixels (VICE x64sc 3.10).

### Against the alternatives

Choose all-sprite fighters when there are two actors and nothing else
shares their lines: no redraw, free placement, their own colours.
Choose a multiplexer when the extra actors are above or below one
another, not side by side. Choose a character actor when actors share
raster lines and the sprites are needed elsewhere, when an actor is
bigger than sprites cover, or when it stands still much of the time: a
standing character actor costs nothing. Choose masked software sprites
(`software_sprite_preshifted`) when the actor must pass over scenery.

### Variations

**Fewer stores on a move.** The recipe clears all 30 old cells and
writes 30 new ones. Only the column left behind needs clearing, 36
stores instead of 60 (arithmetic; not measured here).

**Bitmap actor.** The same idea in a bitmap: the actor owns an area of
bitmap bytes. There is no code to move, so every move is a copy of the
whole area, and colour comes from screen RAM per cell.

**Parts in sprites.** A character actor can carry a sprite for the part
that moves fastest, a fist or a foot, so the body is redrawn only on
pose changes. Not done in the recipe.

### Cycle budget

Measured in VICE x64sc 3.10 with CIA1 timer B, interrupts masked, in the
Oscar64 recipe. Screen blanked, one call each, less an empty call: 3,323
cycles to copy the 240 glyph bytes, about 13.8 a byte; 1,899 to clear
and rewrite the 5 x 6 block one cell over; 448 to place the four
sprites, two of them past X 255. The whole update, started at raster
line 256, took 508 to 6,108 cycles on PAL. The worst tick does all three
parts, which every walking tick on which the actor crosses a cell
boundary does; that is the Cost line. A walking tick inside a cell
skips the block move, about 4,209 (6,108 − 1,899, arithmetic). A hold
tick is 508. On NTSC the worst was 6,366: from line 256 an update that
long runs past the end of the 263-line frame into the badlines of the
top text rows, while on PAL it ends by line 41 (arithmetic from 63 and
65 cycles a line; the stall was not traced). These are compiled C. An
unrolled `lda abs,x` / `sta abs,x` copy is 9 or 10 cycles a byte,
about 2,200 to 2,400 for 240 bytes (arithmetic from the instruction
table; not measured here). The model check and the on-screen text are
not in these figures.

### Recipes

- `recipes/oscar64/mixed-fighters.md` (one fighter in four multicolour
  sprites, one in a 5 x 6 block of pre-shifted multicolour cells moving
  in 2-pixel steps; on autopilot they overlap, strike, cross with `$D01B`
  swapped and hold overlapped; screen codes, glyph bytes and sprite
  registers checked against a Python model at 17 ticks; cycles per
  glyph copy, block move, sprite update and tick; every arena pixel
  compared with the model with PIL on PAL and NTSC)

### Sources

- Games That Weren't, "IK+ design and development notes" (Frank
  Gasking, 19 December 2024): Archer Maclean's IK+ notes preserved as
  scanned galleries; source code withheld; the text does not describe
  the rendering method.
  https://www.gamesthatwerent.com/2024/12/ik-design-and-development-notes/
- Lemon64 forum, "IK: How sprites and character graphics worked
  together" (forum report; returned HTTP 403 here, not read).
  https://www.lemon64.com/forum/viewtopic.php?t=38956
- Christian Bauer, "The MOS 6567/6569 video controller (VIC-II)", section 3.8.2 (with MCM set, bit pairs 00 and 01 are background for priority and collisions): http://www.zimmers.net/cbmpics/cbm/c64/vic-ii.txt
