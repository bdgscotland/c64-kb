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

### Why

The VIC-II has sixteen fixed colours and no brightness control, so a
picture cannot be dimmed by scaling. What it can do is substitute: each
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
rank 1, is black from step 9) while white takes all sixteen steps, which
is what a real fade looks like: the dark parts go first.

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
