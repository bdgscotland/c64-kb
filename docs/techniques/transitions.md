---
category: effect
chip: VIC-II
---

<!-- doc-type: technique-reference -->

# Transitions

The effects that carry a demo from one part to the next. The demo-design
pages name the family (`demo-design/demo-design-philosophy.md`, "Amazing
transitions": palette splits, screen-clearing raster sweeps, charset swap
flickers, DRAM fades) and say a transition is an effect in its own right,
not a cut. This page holds the members that have a page and a recipe. A
raster sweep, a charset flicker and a DRAM fade have no recipe yet.

## colour_fade — Fade to black through a luminance-ordered colour table

**Complexity:** low
**Region:** both
**Uses registers:** D020, D021, D012
**Cost:** cycles_per_frame=400, bytes_data=272
**Cost basis:** estimated
**Cost measured on:** kickassembler-colour-fade (per step)

### Why

The VIC-II has sixteen fixed colours and no brightness control, so a
picture cannot be dimmed by scaling. It can substitute instead: each
colour on screen is replaced, step by step, by a darker colour from the
same sixteen until everything is black. Done over a second or so this
reads as a fade, and it costs nothing in the picture itself: the shapes
stay where they are, only the colour registers and colour RAM change.

### How

1. Order the sixteen colours from darkest to brightest. Over the RGB
   triples VICE emits for its PAL palette (`runtime/vice-reference.md`,
   "Reading the exit screenshot"), Y = 0.299 R + 0.587 G + 0.114 B gives
   0, 6, 9, 2, 11, 8, 4, 14, 12, 5, 10, 3, 15, 13, 7, 1 (arithmetic on
   the table, rung 3). The NTSC triples give the same order except that
   2 and 11 swap and 4 and 8 swap; the recipe uses the PAL order on both
   models and the difference is one rank in two places.
2. Build a table `fade[step][colour]` of seventeen rows by sixteen
   colours. Row 0 is the identity, row 16 is all zeros, and row `s` maps
   colour `c` to `order[round(pos(c) * (16 - s) / 16)]`, where `pos(c)`
   is the colour's rank in the order. Each column is monotone: a colour
   never gets brighter as the fade goes on. KickAssembler builds the 272
   bytes at assembly time with two nested `.for` loops.
3. Every N frames advance the step. For each step, look up every colour
   the picture uses in the current row and write the result where the
   picture reads it: `$D020`/`$D021` for bars, colour RAM for text,
   `$D027`-`$D02E` for sprites, the screen-RAM nibbles for a bitmap.
4. At step 16 hold; the picture is black. To fade in, walk the rows in
   the other direction.

### Why it works

The VIC-II reads its colour registers as it draws (see `raster_bars` in
`raster.md`: the registers are transparent, there is no per-line latch),
so writing the substituted colour recolours the picture on the next line
with no redraw of screen or bitmap memory. The luminance order is what
makes the substitution read as dimming rather than as a palette change:
at each step the eye sees the same shapes, darker. Hue shifts are the
price of a fixed palette: white goes through light grey, mid grey and
dark grey; yellow through light green and green. Rounding in the table
merges ranks, so two colours adjacent in the order can show the same
colour for a step; in the recipe, step 9 shows only eight distinct
colours across the sixteen bars. Dark colours reach black first (blue,
rank 1, is black from step 9) while white takes all sixteen steps, so
the dark parts go first.

### Variations

**Text screen.** Rewrite the thousand colour-RAM bytes through the table.
Per cell `LDA $D800,X` (4), `AND #15` (2), `TAY` (2), `LDA (ROW),Y` (5),
`STA $D800,X` (5) is 18 cycles counted from the instruction timings, not
measured here, so a full screen is about 18,000 cycles, close to a whole
PAL frame (19,656). Spread it over frames, or keep a list of the colours
the screen actually uses and only write those.

**Bitmap.** In multicolour bitmap mode three of the four colours per cell
sit in screen RAM as two nibbles and in colour RAM. A 256-entry table per
step that maps both nibbles of a screen byte at once halves the work.

**Fade in, or fade to white.** Walk the rows from 16 down to 0 for a fade
in. For a fade to white, build the order the other way round so every
column walks up the luminance order.

**Easing.** A table of frames-per-step instead of a constant gives a slow
start and a quick finish, or the reverse.

**Partial fade.** Fade one region and pin another. The recipe fades the
bars and leaves the caption's colour RAM at white, so the held frame
still says which step it is.

### Cycle budget

Not raster critical. The table lookup for sixteen bars in the recipe is
`LDY base,X` (4), `LDA (ROW),Y` (5), `STA barcol,X` (5), `DEX` (2),
`BPL` (3): 19 cycles per bar, about 300 per step, from the instruction
timings. The busy-wait that draws the bars is the raster bars' cost, not
the fade's. Step 16 needs the row pointer to be formed with the carry
kept: `step * 16` is 256 at the last step, and a `CLC` after the shifts
sends the pointer back to row 0, so the picture snaps back to full colour
instead of going black. An earlier draft of the recipe did exactly that,
and the run at 8,000,000 cycles showed the step-0 bars under a caption
reading step 16.

### Recipes

- `recipes/kickassembler/colour-fade.md`

---

## colour_cycling — Rotate a colour table through a fixed set of cells

**Complexity:** low
**Region:** both
**Uses registers:** D012, D021
**Cost:** cycles_per_frame=3265
**Cost basis:** measured-vice
**Cost measured on:** kickassembler-colour-cycling (one step, in the vertical blank from line 251)

### Why

Water, a conveyor belt, a glowing rune, a pulsing logo: things that move
without changing shape. Redrawing them costs screen or bitmap writes every
frame. Cycling costs colour writes only. The shapes are drawn once, in a
pattern that steps through a short list of colours, and each step rotates
which colour each cell shows. The eye reads the rotation as motion along
the pattern.

### How

1. Choose a short palette, eight colours or fewer, and draw the region so
   that adjacent cells take consecutive entries. A band that runs down
   the screen gives each row one entry; a diagonal gives cell `(row, col)`
   entry `(row + col) mod n`.
2. Keep a phase counter. Every N frames add one to it, modulo the palette
   length. The recipe steps every second frame.
3. On a step, rewrite the region's colour cells: the cell that held entry
   `k` now takes entry `k + phase`. Write the table twice end to end so an
   index of `phase + k` never needs masking.
4. Land the rewrite where the beam is not: after the last text line, or
   before the first line of the region. Colour RAM is read as each row is
   drawn, so a rewrite that overlaps the beam shows the old colour above
   the beam and the new one below it for that frame.

### Why it works

Colour RAM is the picture's colour, not its shape: the VIC-II reads a
cell's colour nibble on the badline that fetches the row and uses it for
that row's eight lines (`hardware/vic-ii-reference.md`). A reverse space
in every cell makes the colour the whole picture, and rotating the colours
moves the pattern without a single screen-RAM write. The write budget is
what bounds the region. In the recipe one step rewrites 320 cells at ten
cycles a cell (`STA abs,X`, `DEX`, `BPL`), and the CIA timer in the
listing reads 3,265 cycles for it on both models, 52 raster lines,
measured in VICE. Started at the first line of the lower border, 251,
that ends on line 303 on PAL and, after the wrap at 263, line 38 on NTSC,
both before the region's first row is fetched, so no frame shows a torn
band.

### Variations

**A $D021 triple.** In multicolour text the colours in `$D021`, `$D022`
and `$D023` are shared by every cell, so rotating three register writes
cycles the whole screen's pattern in a dozen cycles. It cannot cycle two
regions differently.

**Sprite colours.** Rotate `$D027` to `$D02E`, or the two shared
multicolour registers `$D025` and `$D026`, for a glow that costs eight
writes a step.

**Every frame.** Stepping each frame doubles the speed and the budget
stays the same per step; the recipe's two-frame step is a choice of pace,
not a limit.

**Sub-region.** Cycle a list of cell addresses instead of whole rows. The
cost falls to the cells that carry the pattern; a list of 40 addresses is
40 indirect stores.

### Cycle budget

Not raster critical as long as the rewrite is off the beam. The step is
3,265 cycles for eight rows of forty cells, measured by CIA1 timer A in
the recipe on both models; that is a sixth of a PAL frame and a fifth of
an NTSC one. A rewrite of the whole thousand cells at the same rate would
be about 10,200 cycles (arithmetic), which is 162 PAL lines and cannot
fit between line 251 and the first badline at line 51; a full-screen
cycle has to run over two frames or use a double buffer, which is the
`full_field_redraw_exceeds_vblank` case. The step rate is in frames, so
the pace differs by a fifth between PAL and NTSC.

### Recipes

- `recipes/kickassembler/colour-cycling.md`

---

## screen_wipe — Reveal or hide the screen a row, a column or a line at a time

**Complexity:** low
**Region:** both
**Uses registers:** D012, D021
**Cost:** cycles_per_frame=709
**Cost basis:** measured-vice
**Cost measured on:** kickassembler-screen-wipe (one reveal step, worst row)

### Why

A wipe replaces the cut between two parts: the old picture goes out along
an edge, the new one comes in along another. On the C64 the cheap version needs no picture
buffer at all. The screen stays where it is and its colour is taken away
or given back, one strip at a time.

### How

1. Draw the screen. Keep a copy of, or a rule for, each row's colours so
   the reveal can restore them.
2. Keep a row counter and a direction. Every N frames take one step: in
   the hide direction write the current row's forty colour RAM cells to
   the background colour, in the reveal direction write them back from the
   copy. Advance the row; at the last row turn the direction round or
   stop.
3. Land the step where the beam is not, as for `colour_cycling`. A row
   write is short, so the lower border is more than enough.

### Why it works

A cell whose colour equals `$D021` is invisible whatever character it
holds, so writing a row's colour RAM to the background colour hides the
row without touching screen RAM, and writing it back reveals it. Nothing
about the picture moves, which is why a wipe of this kind is cheap: the
per-step cost is forty stores. In the recipe the hide step reads 491
cycles and the reveal step 708 or 709 by CIA1 timer A, measured in VICE,
the difference being one indirect load per cell for the reveal. Both are
under a dozen raster lines. The reveal figure depends on the row, not the
model: 708 at row 3 and 709 at row 11 on PAL, and 709 at row 11 on NTSC.
The cause of the per-row cycle is not established.

### Variations

**Column by column.** Write one cell in each of the 25 rows per step
instead of one row. The addresses stride by 40; a table of 25 row bases
indexed by the column serves.

**Diagonal by cell.** Hide cell `(row, col)` on step `row + col`. Each
step touches at most 25 cells, one per row, and the edge runs at 45
degrees.

**Iris by table.** A table of cell addresses ordered by distance from the
centre, hidden or revealed so many per step, gives a circle closing or
opening. The table is the whole cost: a thousand two-byte entries, or a
one-byte index into a row and column pair.

**A $D011 blank moving down.** Clearing the display-enable bit at a
raster line blanks from that line to the bottom of the frame and shows
the border colour there. It needs a compare per frame and a raster split,
which brings `d012_wrap_around` and `badline_cycle_loss` into the
account; it is not built here and its timing is not measured here.

**A per-line $D021 split.** Change the background colour at a raster line
that moves down each frame, so the picture's background sweeps to black
while its ink stays. The split's write must land in the horizontal border
of the line or it shows as a step in the colour; the recipe does not do
this and no figure is given for it here.

### Cycle budget

Not raster critical. The step is a single row's colour RAM, 491 cycles
to hide and at most 709 to reveal, measured by CIA1 timer A in the recipe.
Twenty-four rows at two frames each make a 48-frame wipe, 0.96 s on PAL
and 0.8 s on NTSC (arithmetic from 19,656 and 17,095 cycles a frame). The
step rate is in frames, so the two models finish at different times for
the same cycle count; the recipe's verdict is taken on the frame count,
not the cycle count, so it holds on both.

### Recipes

- `recipes/kickassembler/screen-wipe.md`

---

## screen_dissolve_lfsr — Cross-fade two text screens cell by cell in LFSR order

**Complexity:** low
**Region:** both
**Uses registers:** D012
**Requires:** lfsr_random
**Cost:** cycles_per_frame=3203, cycles_per_frame_typical=3032, bytes_code=483
**Cost basis:** measured-vice
**Cost measured on:** kickassembler-screen-dissolve (one frame of 20 cells with its LFSR pulls, the worst and the median of the 50 frames; bytes are the code block less its two captions)

### Why

The fade changes colours, the cycling moves them and the wipe takes them
away along an edge. None of them can put a second picture in place of
the first: a fade to black and back is the nearest, and it costs a
luminance table and a black frame in the middle. A dissolve replaces the
screen one cell at a time in an order that looks random, so the new
picture comes up through the old everywhere at once and the eye reads it
as a cross-fade, with no palette work and no black in between. It needs
the target screen in RAM, which the wipe does not, and a source of cell
indices that visits every cell once, which is what a maximal LFSR is.

### How

1. Build the target screen in RAM, screen bytes and colour bytes, 1,000
   of each. The visible screen holds the source.
2. Take a 10-bit Galois LFSR with taps `$240`, the polynomial
   x^10 + x^7 + 1, in the right-shifting form of `lfsr_random`: shift the
   state right, and if the bit that fell out was 1 XOR the taps in. Seed
   it with any non-zero value; the recipe uses 1.
3. Each frame, in the lower border, pull N indices. A state of 1000 to
   1023 is not a cell: pull again. For each cell copy the target's screen
   byte and colour byte to the visible screen.
4. When the state comes back to the seed every value from 1 to 1023 has
   been produced once, so 999 cells are done. Copy cell 0 by hand; the
   register never produces it. Then stop, and the picture is static.

At N = 20 the whole screen takes 50 frames, 1.0 s on PAL and 0.83 s on
NTSC (arithmetic from 19,656 and 17,095 cycles a frame), measured in the
recipe as the last cell landing on frame 50 on both models, with cell 0
as the twentieth slot of that frame.

### Why it works

A maximal-length LFSR is a permutation of its 2^n - 1 non-zero states,
so it produces each cell index exactly once and never repeats one before
the whole set is out; a random number generator with a repeat would copy
some cells twice and leave others until the end. The recipe checks the
permutation two ways: 1,023 steps in Python give 1,023 distinct values
from 1 to 1,023, and the run comes back to its seed on the 1,023rd pull
with 999 cells copied.

Ten bits and not sixteen because 2^10 is the first power of two above
1,000. Every state above 999 is a wasted pull; ten bits wastes 24 in
1,023, sixteen would waste 64,536 in 65,535 and spend about 66 pulls
for every cell (65,535 / 999; an earlier version said 64,535 and
sixty-four). The 24 wasted pulls fall where the sequence puts them,
and the frame that meets most of them is the worst frame: 3,203 cycles
against a median of 3,032 in the recipe, so the spread is small and the
per-frame budget can be taken as N times the per-cell cost plus a little.

The zero cell is the one an LFSR cannot give, for the reason in
`lfsr_zero_state_lockup` (`pitfalls/cpu.md`): from zero the register
stays at zero. That is also why the seed must be non-zero. The skip of
1000 to 1023 keeps the index below the 24 bytes past the last cell that
`colour_ram_index_past_last_cell_hits_cia1`
(`pitfalls/text-mode-render.md`) is about: on the screen side those are
unused bytes and the sprite pointers, on the colour side they are the end
of the page, and one more past them is CIA1.

### Variations

**Colour RAM only.** Copy the colour byte alone and leave the screen
bytes, so a picture dissolves from one palette to another; half the
stores a cell, and no target screen RAM is needed, only 1,000 colour
bytes. Not built here.

**2 by 2 blocks.** Run a 250-state permutation over block indices (an
8-bit LFSR wastes 5 in 255) and copy four cells a pull. Fewer, larger
steps: the same 50 frames at N = 5 blocks, or a faster dissolve at the
same cost. The block's four cells are at `i`, `i + 1`, `i + 40` and
`i + 41` from the block's top-left cell. Not built here.

**Bitmap by byte.** The same permutation over 8,000 bitmap bytes with a
13-bit LFSR (8,191 states, 191 wasted), copying a byte a pull; the
colour cells follow with a second 10-bit pass or by copying each cell's
colour with its first byte. Eight times the cells of a text dissolve at
the same N is eight times the frames, so N has to rise with it. Not
built or timed here.

### Cycle budget

Not raster critical. The recipe's frame of 20 cells with its LFSR pulls
costs 3,203 cycles at worst and 3,032 at the median, by CIA1 timer A,
identical on PAL and NTSC because the work starts on line 251 in the
lower border where there is no badline and nothing in it depends on the
model. That is about 150 cycles a cell for the recipe's shape (a
subroutine call, four pointer high bytes and two indirect copies a
cell), and the frame is over about 50 lines after line 251: line 302 on
PAL, and on NTSC, whose frame wraps at 263, about line 37 of the next
frame, both in the border. The blank the copies have to fit is not the
same on the two models: about 7,000 cycles on PAL and about 4,100 on
NTSC between line 251 and line 51 of the next frame (arithmetic:
(312 - 251 + 51) x 63 and (263 - 251 + 51) x 65). The cost scales with
N at about 150 cycles a cell, so 40 cells a frame, about 6,000 cycles
and a 25-frame dissolve, fits the PAL blank only; on NTSC the copies
stay in the blank up to roughly N = 27 (4,095 / 150; arithmetic, not
measured here). Past that N the copies run into the display and a cell
can be caught between its screen byte and its colour byte, which is the
tearing `full_field_redraw_exceeds_vblank` describes; at N = 20 it is
not near on either model.
The sequential control in the recipe, the same copies in index order,
costs 2,226 at worst, so the LFSR and its skip are about a third of the
frame.

### Recipes

- `recipes/kickassembler/screen-dissolve.md`

---

## luminance_dissolve — Fade a colour-RAM picture to black cell by cell in LFSR order, each visit one step down the luminance table

**Complexity:** low
**Region:** both
**Uses registers:** D012
**Requires:** lfsr_random, colour_fade
**Cost:** cycles_per_frame=7490, cycles_per_frame_typical=6185, bytes_code=684, bytes_data=1269
**Cost basis:** measured-vice
**Cost measured on:** kickassembler-luminance-dissolve (the worst of the 84 fade frames on PAL, 60 visits with their LFSR pulls, skips and the seed test, screen on, from the listing's CIA1 timer A bracket; typical is the last fade frame, when most visits find a black cell and leave early; NTSC at 50 visits 6,544 worst and 6,176 last over 100 fade frames; bytes_code is the code without the autopilot block; bytes_data is the 16-byte step table, the 1,000-byte picture and 13 bytes of state, with 240 bytes of page padding after the table. The same design in a five-part KickAssembler demo built from the KB, with a sequencer and a sprite interrupt inside the bracket, read 7,928 to 8,036 worst over three runs on PAL and 7,015 to 7,279 on NTSC)
**Claims:** none
**Claims basis:** derived-listing

### Why

`colour_fade` darkens every cell in lockstep, so the picture dims as a
whole; `screen_dissolve_lfsr` replaces cells one at a time but needs a
second picture in RAM to replace them with. A fade that should look
granular, an old picture going dark in scattered grains rather than
dimming evenly, is the two put together: visit the cells in a maximal
LFSR order and step each visited cell down the luminance order instead
of copying a target. It needs no target screen and no black frame in
the middle, it touches colour RAM only, and the shapes stay where they
are until their colour reaches black. It was proposed from the
technique graph's compatibility census and measured in a demo part.

### How

1. Take `colour_fade`'s luminance order of the sixteen colours, dark to
   bright: 0 6 9 2 11 8 4 14 12 5 10 3 15 13 7 1. Build a sixteen-entry
   table, indexed by colour, that maps each colour to the one three
   places down the order and the three darkest to black:
   0 15 0 12 2 4 0 3 9 0 14 6 8 10 11 5. (The demo part ranked 4 before
   8 and 7 before 13, a variant of the same order; its table was
   0 15 0 12 9 8 0 10 2 0 14 6 4 3 11 5.)
2. Take the 10-bit Galois LFSR of `screen_dissolve_lfsr`, the polynomial
   x^10 + x^7 + 1 in `lfsr_random`'s right-shifting form, seeded with
   any non-zero value. Its period is 1,023; the demo measures it once at
   start-up by stepping until the seed recurs, and checks the count.
3. Each frame pull N states. A state of 1,000 to 1,023 is not a cell:
   pull again. For each cell read its colour nibble at `$D800 + i`, look
   the nibble up in the step table and write the result back. Visit cell
   0, which no state names, each time the seed recurs.
4. Stop when no lit cell is left. The demo counts lit cells once before
   the first frame and decrements the count when a visit reaches black,
   with a cap of 200 frames as a guard.

N is chosen from the raster line count: 60 on PAL and 50 on NTSC. The
whole screen was black after 84 frames on PAL and 100 on NTSC, 1.68 s
and 1.67 s, measured in the demo; a cell at white needs five visits, so
five sweeps of 1,023 pulls, 86 frames at 60 and 103 at 50 by arithmetic,
is the bound, and the last lit cell went out a little before it.

### Why it works

A maximal LFSR is a permutation of its non-zero states, so one sweep
visits every cell once (`screen_dissolve_lfsr`, "Why it works"), and
every cell has taken the same number of steps at the end of each sweep.
The picture therefore darkens evenly on average while the order within
a sweep looks random, which is the grain. Stepping down a luminance
order rather than a hue order means a cell never gets brighter on the
way, the same guarantee `colour_fade` rests on, and three places at a
time makes the brightest colour black in five visits instead of fifteen,
so the fade finishes in about five sweeps. A cell already black maps to
black, so an extra visit costs nothing but the cycles. Colour RAM holds
one nibble a cell, so a visit is one read and one write and there is
nothing to tear: a cell is never half-way between two colours.

### Variations

**Step one place.** Fifteen visits for a white cell and fifteen sweeps:
a slower, smoother fade at the same cost a frame. Not built.

**Dissolve to a palette.** Replace the step table with one that moves
each colour one place towards its target colour in a second palette, and
the picture crossfades in grain to a recoloured version of itself
instead of to black. Not built.

**Sprites alongside.** The demo stepped its six sprites' colour
registers down the same table every eight frames and switched them off
at black, so the sprites and the field reached black together.

### Cycle budget

Not raster critical; the visits can run anywhere in the frame. Measured
in the demo with CIA1 timer A around one fade frame, the sequencer and
sprite interrupts inside the bracket: PAL at N = 60 worst 7,928 to 8,036
over three runs and the last frame 5,720 to 7,329; NTSC at N = 50 worst
7,015 to 7,279 and last 4,952 to 6,909. That is about 130 cycles a visit
with the pulls and skips, and the frames differ because the 24 wasted
pulls fall where the sequence puts them. The census of lit cells on the
first call is about 14,000 cycles once and was not bracketed.

### Pitfalls

- `lfsr_zero_state_lockup` (`pitfalls/cpu.md`): the seed must be
  non-zero, and cell 0 has to be visited by hand.
- `colour_ram_index_past_last_cell_hits_cia1`
  (`pitfalls/text-mode-render.md`): the skip of states 1,000 and above
  is what keeps the write inside colour RAM.
- A count of lit cells decremented on the wrong flag runs the fade to
  its cap: the demo's first build tested `bne` after a `sta`, which sets
  no flags, and every fade ran 200 frames until the compare was moved.

### Recipes

- `recipes/kickassembler/luminance-dissolve.md`

---
