---
category: render
chip: VIC-II
---

<!-- doc-type: technique-reference -->

# Text-Mode Render Techniques

Text-mode rendering on the C64 is cheap per byte and not free per frame.
Writing screen RAM is one STA absolute (4 cycles) per byte, but a redraw
from a field array needs a load and a store for the screen code and
again for the colour byte: 16 cycles per cell fully unrolled (a 12 KB
code footprint for 1000 cells), about 24 cycles per cell in a compact
indexed loop (both measured in VICE x64sc, CIA timer, DEN off). A 40×25
redraw with colour is therefore 16,000–24,000 cycles against a PAL frame
of 19,656 cycles, of which the CPU keeps roughly 18,600 once the 25
badlines have taken their 40-odd cycles each — most of a frame at best,
more than a frame in the looped form, and far more from a compiled loop
(see "Cycle budget"). An earlier version of this page said "a 4-cycle
operation per cell" and "~4000 cycles — about 1/5 of a PAL frame"; 4
cycles is one STA of a constant (a screen clear), not a redraw, and
that figure was below the page's own 1000-cell budget further down.
Redrawing unconditionally does avoid a class of bugs
(`dirty_cell_skip_leaves_overlay_trail`) that dirty-cell tracking opens,
but whether the budget allows it depends on the field size and the
toolchain — read "The frame-budget trap" before choosing.

Most C64 games that look like Tetris, Boulder Dash, Sokoban, or any
top-down puzzle/board game ship a single tight render loop that walks
the playfield array each frame (in hand-written assembly, at the costs
below), then layers the active piece(s) on top as a second pass. The active piece(s) never live in the playfield
array — they're an overlay drawn last, and the next frame's
field-redraw is what erases them.

---

## text_mode_overlay_render — Playfield + moving-piece overlay in text mode

**Complexity:** low
**Region:** both
**Uses registers:** (none)
**Uses kernal:** (none)

### Why

Tetris-likes, Sokoban-likes, Boulder Dash variants, and most C64
puzzle / board games need to draw a mostly-static playfield with one
or more *moving* pieces on top of it. The pieces aren't part of the
playfield's persistent state — they move every gravity tick — so the
question is how the rendering layer keeps the field cells correct
while also drawing the piece on top of them. The technique touches no
VIC or CIA register: it is direct screen and colour RAM writes only.

The answer that "feels professional" is to track dirty cells and
repaint only what changed; the simplest answer that works on a stock
C64 in text mode is to repaint the whole field every frame and draw the
piece overlay last — where the budget allows it. In hand assembly a
400-screen-cell field is 4,800–9,500 cycles a frame (see "Cycle
budget"), which fits; from an Oscar64 -O2 loop the same field is
17,100–19,400 cycles (recipe, measured in VICE x64sc), which does not
fit the blank window and tears — see "The frame-budget trap". An
earlier version of this section said "the frame budget is more than
ample" without that qualification, while the trap section below said
the opposite. The dirty-cell approach has a subtle invariant that's
easy to miss (see `dirty_cell_skip_leaves_overlay_trail` in
`pitfalls/text-mode-render.md`); the erase-prev/draw-current overlay
described under the trap avoids both problems.

### How

Two passes per frame. The piece overlay never writes back to the
playfield array — it's pure pixels on top of the field's render:

1. **render_field()** — walk every cell of `field[FIELD_H][FIELD_W]`,
   write its screen code + color to screen / color RAM. Empty cells
   get `$20` (space). Filled cells get `$A0` (reverse-space) in the
   piece's designated color.
2. **render_piece()** — walk the 4 cells of the active piece (read
   from a pieces-table indexed by `current_type`, `current_rot`),
   write `$A0` + piece color to screen / color RAM at the piece's
   absolute screen offset.

`render_piece` runs second, so its writes win for the cells the piece
currently occupies. Next frame, `render_field` re-paints every cell
based on the persistent playfield — which still has those cells as
empty, so they go back to spaces — and then `render_piece` redraws
the piece at its new (gravity-advanced) position. The "trail" from
the previous frame is implicitly cleared by render_field's
unconditional rewrite.

The piece only enters `field[][]` when it locks. From that point the
field redraw alone keeps it on screen and `render_piece` switches to
drawing the *next* piece.

### Why it works

`render_piece` writes second so its 4 piece cells overwrite the
empties `render_field` just laid down. Next frame, `render_field`
re-clears everything from `field[][]` (which doesn't contain the
moving piece), and `render_piece` re-overlays at the new position.
The old position is implicitly erased — no per-overlay book-keeping.

### The frame-budget trap

The naive "unconditional full redraw every frame" pattern WILL exceed
the PAL vblank window if you do it on a typical Oscar64 build. Empirical
numbers from puzzle-tetris-c64-kb (DEMO-DOG-T, 2026-05-18):

- 10×20 playfield rendered 2-chars wide = 200 cells × ~92 cycles
  (Oscar64 -O2: indexed-loop overhead, two screen writes, two color
  writes per cell) = **~18,400 cycles**. Measured since at 272 raster
  lines, 17,100–17,450 cycles, about 86 a cell (recipe, CIA-timed in
  VICE x64sc); a naive build reads up to ~19,400. Same order either way.
- After `vic_waitBottom` returns at raster 256 there are 107 raster
  lines = **~6,700 cycles** (56 lines of lower border and blanking to
  the wrap, then 51 of upper border) before the 25-row display window
  resumes at raster 51. The 56 lines to the wrap alone are ~3,500
  cycles, which is what an earlier version of this page called "the
  vblank window"; the race-free budget is nearly twice that.
- CPU writes continue while the VIC raster has already started drawing
  the next frame top-down. Upper rows show stale content (the old
  frame's piece position OR an "in-between" state from `render_field`).
  Lower rows show the new piece (CPU caught up before the raster).

The visible symptom is "pieces only appear in the last 4-5 rows of
the playfield, even though the in-memory state has them moving from
the top." See pitfall `full_field_redraw_exceeds_vblank`.

The fix is to NOT call `render_field` every frame. Use the
"erase-prev + draw-current" overlay pattern instead:

1. Track `prev_x, prev_y, prev_type, prev_rot` (the piece's last-frame
   state).
2. Each frame, erase the prev-position cells by repainting them from
   `field[][]` (which now has the locked piece at those cells if the
   piece just locked, so this "erase" pass correctly redraws a
   just-locked piece).
3. Draw the current-position cells with `$A0` + piece color.
4. Eight cell writes per frame: about **2,000 cycles** as the Oscar64
   recipe measures it (~33 raster lines; `render_piece` 1,998 cycles on
   CIA 2 timer A — see `recipes/oscar64/text-overlay-playfield.md`), or
   roughly 150–200 cycles in hand assembly with precomputed addresses.
   Either way well inside the 107-line window between raster 256 and
   the display window resuming at line 51. An earlier version said
   "~120 cycles", which is 15 a cell against the ~92 this section had
   just priced an Oscar64 cell write at.

`render_field` is reserved for events that change persistent state:
line-clear shift (rare), game-over restart (rare), initial paint. The
brief tearing on those one-frame events is acceptable.

### Variations

- **Two-byte-wide cells.** A 40-column screen with a 10-wide playfield
  often renders each playfield cell as 2 screen columns wide to give
  square-ish character cells. Same loop, but each cell now needs a
  second screen-code store and a second colour store. That is not
  cheap: one extra STA abs,X is 5 cycles on a ~24-cycle indexed cell
  (measured in VICE x64sc: 9,490 → 11,490 cycles over 400 cells,
  +21 %), and with the matching colour store it is 13,490 cycles,
  +42 % indexed; +50 % fully unrolled (16 → 24 cycles per cell).
  Budget for roughly one and a half times the single-width cost, not
  a rounding error. (An earlier version said "under 3 %".) The one
  form that stays cheap is sharing the load: read the field byte once
  and store it to both columns — see "Cycle budget".
- **Color-only flash for line-clear.** During an animation (e.g.
  Tetris line clear), don't rewrite screen codes — just toggle the color
  RAM byte per cell on/off per N frames. Skip the screen-RAM write
  pass entirely.
- **Skip render during state transitions.** When the game flips to a
  non-playing state mid-frame (game-over banner drawn, line-flash
  starting), gate the render_field+render_piece pair on the state so the
  banner / flash isn't immediately clobbered.

### Cycle budget

All hand-assembly figures below were measured in VICE x64sc (PAL, CIA 1
timer A, DEN off so no badline steals the count); frame lengths are
from `hardware/pal-ntsc-reference.md` (PAL 19,656; NTSC 6567R8 17,095;
6567R56A 16,768).

For a 10×20 playfield rendered as 2-char-wide cells (= 20×20 screen
cells), per frame, hand assembly:

- render_field, fully unrolled and sharing one LDA between the two
  columns of each field cell (LDA field / STA scr / STA scr+1 / LDA
  colr / STA col / STA col+1): 200 field cells × 24 cyc = 4,800 cycles
  (24 % of a PAL frame, 28 % NTSC). That is the only form in which
  "~12 cycles per screen cell" is true; a cell whose code and colour
  are read individually costs at least 16 (LDA abs / STA abs for the
  code and again for the colour) — 400 × 16 = 6,400 (33 % PAL, 37 %
  NTSC).
- The compact indexed loop (LDA field,x / STA screen,x / LDA colr,x /
  STA colour,x / INX / BNE): 23.7 cycles per cell, 9,490 for 400 cells
  (48 % PAL, 56 % NTSC).
- Oscar64 -O2 in C: about 86–97 cycles per two-wide field cell,
  17,100–19,400 for 200 cells (recipe; measured in VICE x64sc) — see
  "The frame-budget trap" above.
- render_piece: 8 screen cells × 16 cyc = ~128 cycles unrolled, ~190
  looped, ~2,000 in Oscar64 (negligible against the field either way).
- Total, hand assembly: ~4,900 cycles shared-unrolled (25 % PAL, 29 %
  NTSC R8), ~6,500 unrolled (33 % / 38 %), ~9,700 looped (49 % / 57 %).
  An earlier version said "< 27 % of an NTSC frame" for 4,896 cycles;
  4,896 / 17,095 is 28.6 %.

For a full-screen 40×25 redraw (Boulder Dash-style map, every cell
distinct, so no shared load):

- 1000 cells × 16 cyc = 16,000 cycles fully unrolled (81 % of a PAL
  frame, 94 % of an NTSC R8 frame, and ~12 KB of code); the indexed
  loop is ~23,700 cycles — more than a PAL frame (19,656).

That's the point at which dirty-cell tracking or a partial redraw pays
off: a looped 1000-cell screen+colour redraw does not fit in one frame.
An earlier version of this section said ~12 cycles per cell, 12,000
cycles for 1000 cells, and that "even a 1000-cell redraw fits inside a
single frame"; 12 is below the 16-cycle unrolled floor for a cell whose
code and colour are read individually, and holds only for the
two-column-shared unrolled form (4,800 for 200 field cells, measured as
above). Fitting inside a frame is not the criterion in any case: unless
screen RAM is double-buffered via `$D018`, the redraw races the beam,
so the budget is the blank window — 107 lines from raster 256 through
the wrap to raster 51, about 6,700 cycles — not the whole frame.

### Recipes

- `recipes/oscar64/text-overlay-playfield.md`

---

## charset_animation — Animating tiles by changing the glyph, not the cells

**Complexity:** low
**Region:** both
**Uses registers:** D018
**Uses kernal:** (none)
**Cost:** cycles_per_frame=196
**Cost basis:** measured-vice

### Why

Water, fire, lava, conveyor belts and blinking lights are the same tile
repeated across a field. Redrawing every cell that shows the tile each
frame costs cycles in proportion to the field: 12 cycles a cell from an
Oscar64 `-O2` store loop, 2,429 for 200 cells (recipe, CIA-timed in VICE
x64sc), so 240 water cells would be about 2,880 and a full screen of
them more than a blank window. The VIC has no copy of a glyph. It fetches
the 8 bytes for each cell's code from the character base on every raster
line it draws, so changing those 8 bytes changes every cell that shows
the code at once, whatever the field holds. That is the whole technique,
in two forms.

### How

**(a) Rewrite the glyph in place.** Keep an animation table of N phases,
8 bytes each, and once per frame copy phase `frame mod N` over the
glyph's 8 bytes in the charset the VIC is showing. Every cell with that
code animates. The cost is one 8-byte copy per animated glyph per frame,
independent of how many cells show it: 196 cycles in Oscar64 with the
call and pointer set-up inside the timed window, of which the eight
`LDA (zp),Y / STA (zp),Y` pairs with their index loads are 120
(recipe); 64 cycles in hand assembly as eight `LDA abs,Y / STA abs`
pairs (arithmetic, not measured here). An eight-phase table is 64 bytes.

**(b) Flip whole charsets.** Prepare two or more 2 KB charsets in the VIC
bank that differ in the animated glyphs, and once per frame write the
one to show into `$D018` bits 1 to 3. One 4-cycle store (the recipe's
harness reads 14 with its index load and its own stop store) moves the
glyph source for the whole screen. The cost is the same whether one cell
or a thousand shows the animated code, and the same however many glyphs
differ between the sets: a fire glyph, a water glyph and a belt glyph
can all step at once for the same store. The price is memory, 2 KB a
phase, and the bank: all the sets, the screen and any sprites must sit
in the one 16 KB VIC bank, and a compiler will not stop code growing
into a hardcoded set address (`charset_blit_overruns_grown_code`).

### Why it works

`$D018` bits 1 to 3 give the character base in 2 KB steps inside the VIC
bank, and the character generator reads glyph row `line & 7` of each
code at `base + code * 8` as it draws. Both forms change what that read
returns. (a) changes the bytes at the address; (b) changes the address.
The difference is atomicity. A `$D018` store is one write and the VIC
reads the register at each fetch, so there is no half state: rows above
the store show the old set, rows below it the new one, and if the store
is made below the display nobody sees the seam. An 8-byte rewrite is
eight writes. If a fetch of that glyph falls between them, the rows
above show the old glyph, the rows below the new one, and the text row
the beam is in can show old and new pixel rows of the same glyph. Do the
rewrite after the last display line and before the first badline: from
line 256 that is 107 lines on PAL and 58 on the 6567R8 (arithmetic from
the settled frame lengths). The recipe rewrites first thing after
`vic_waitFrame()`, 196 cycles, inside four raster lines of line 256
(arithmetic at 63 cycles a line).

Reading `$D018` back gives bit 0 as 1 whatever was written; mask it
before comparing (measured: the monitor shows `1D` for a stored `1C`).

### Variations

- **Animate a subset of rows.** The glyph is global, so cells that must
  not animate need a different code with a static copy of the glyph. A
  raster split that writes `$D018` mid-frame gives the rows below it a
  different set; it needs a stable raster IRQ and the store must land in
  the horizontal blank or the seam line shows both sets.
- **Double-buffered charsets.** Combine the two forms: rewrite glyphs
  into the set that is not being shown, anywhere in the frame, and flip
  `$D018` to it in the blank. The rewrite can then be spread across the
  frame and the flip is atomic. The recipe's in-place band does the
  single-buffered version, writing only the set about to be shown.
- **Colour RAM alongside.** The glyph carries shape, colour RAM carries
  the cell's colour; cycling colour RAM under an animated glyph gives a
  second axis (a fire glyph stepping through yellow, orange, red) at one
  store per cell, which is the redraw cost again. Use it on few cells.
- **More phases in (a) than (b).** An eight-phase table costs 64 bytes;
  eight charsets cost 16 KB, the whole bank. Long animations go in (a),
  many simultaneous glyphs in (b).

### Cycle budget

Per frame, in the blank: 196 cycles for one in-place glyph and 14 for a
flip as the recipe's harness reads them, 3,368 for the recipe's whole
loop including its 200-cell redraw comparison and the self-check, all
measured in VICE x64sc on both models with identical figures because
nothing runs across a badline. Against the 107-line PAL blank (about
6,700 cycles) an in-place glyph is 3 %; the 58-line NTSC blank (about
3,770) holds nineteen of them. The Cost line above is the in-place
form, 196 cycles; its 64-byte table is stated here and not on the line,
so that the line keeps the basis of its measured figure. The flip form's
per-frame cost is under 20 cycles and its data cost is 2,048 bytes a
set, which the line does not carry because the set count is the
design's.

### Recipes

- `recipes/oscar64/charset-animation.md`
