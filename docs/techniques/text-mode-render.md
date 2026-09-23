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
**Cost measured on:** oscar64-charset-animation (one glyph a frame, in the vertical blank)

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

---

## char_bullets — Bullets drawn as characters, merged into reserved glyphs

**Complexity:** medium
**Region:** both
**Uses registers:** D018
**Uses kernal:** (none)
**Cost:** cycles_per_frame=3995
**Cost basis:** measured-vice
**Cost measured on:** oscar64-char-bullets (eight bullets, worst frame)

### Why

A shoot-'em-up or run-and-gun runs out of sprites for bullets first.
Eight hardware sprites go to the player and the enemies, and a
multiplexer is a poor fit for dozens of objects a few pixels across
that share raster lines. A bullet drawn into the character screen costs
no sprite at all. The naive form, writing a bullet glyph into the cell,
wipes out the background under it. The form here keeps the background
visible and puts the bullet at pixel precision inside the cell.

### How

Reserve a few screen codes in a RAM charset, one per bullet: eight
codes, $F8 to $FF, in the recipe. Keep a table per bullet of its pixel
position, the screen code and colour it saved, and the cell it was
drawn in. Each frame:

1. **Restore, in reverse draw order.** Write each bullet's saved code
   and colour back to its cell, last-drawn bullet first.
2. **Move** the bullets.
3. **Draw, in forward order.** For each bullet, find its cell from the
   position (`x >> 3`, `y >> 3` through a row-address table). Save the
   code and colour there. Copy the saved code's 8 glyph bytes into the
   bullet's reserved glyph, then OR the bullet's pixels into it at row
   `y & 7`, shifted by `x & 7`. Write the reserved code into the cell,
   and a colour if the bullet has one.

**Shared cells.** When bullet B lands in bullet A's cell, it saves A's
reserved code and builds its glyph from A's merged glyph, so both show.
Restoring B before A puts A's code back and then the background. That is
why restore runs in reverse. Forward order leaves A's reserved code on
screen for good (measured in the recipe: the compare fails).

**Pixel positioning.** The bullet's bits are shifted within the glyph by
`x & 7` and placed on row `y & 7`. A bullet that stays inside one cell
needs one reserved glyph. The recipe keeps both coordinates even and the
bullet 2 by 2, so it never crosses an edge. A bullet that can straddle a
cell edge needs two cells (four at a corner) and as many reserved glyphs.

**Collision with the background.** The saved code says what the bullet
is over. Look its class up in a 256-byte table (solid, destructible,
empty). If the saved code is itself a reserved code, the bullet is over
another bullet: follow that bullet's saved code until it is below the
reserved range. Bullets drawn earlier in the same frame have current
saved codes, so the walk ends. A reserved code left on screen by a
wrong restore can make a bullet save its own code, and the walk then
never ends (measured: the recipe's forward-order variant hung).

**Colour RAM.** A hires cell has one foreground colour, so a bullet
coloured differently from its cell also recolours the background pixels
in that cell. Either leave colour RAM alone (the bullet takes the
cell's colour, cost 0) or save and restore it with the code, as the
recipe does. Colour RAM is 4 bits wide and its upper nibble reads back
as bus noise; mask it with `$0F` before comparing a saved value.

**What the reserved count limits.** Each bullet on screen needs its own
reserved glyph, so the reserved count is the bullet limit, and every
reserved code is lost to the background art. The codebase64 merge page reserves
eight, $F8 to $FF (not measured here). A bullet that straddles cells needs more than one.

### Why it works

The VIC reads each cell's glyph from the charset on every raster line
it draws. A reserved glyph that is a copy of the background glyph plus
bullet bits therefore shows the background cell with the bullet on it.
The background glyph itself is never written, so every other cell with
the same code is untouched. Restoring is one code store and one colour
store per bullet.

The reserved glyphs are rewritten while their codes are off screen: the
restore runs first, and each glyph is built before its code goes into a
cell. So a glyph cannot tear the way an in-place glyph rewrite can
(compare `charset_animation`). What can still show is the gap between
restore and draw. If the beam passes a bullet's row in that gap, the
bullet is missing for that frame. Run restore and draw in the lower
border, or at least before the beam reaches the first row bullets can
occupy (`full_field_redraw_exceeds_vblank`). In the recipe the draw ends
on line 108 (PAL) or 156 (NTSC), and the arena starts on line 171.

### Variations

- **Masked bullets.** AND the glyph with an inverted mask before the OR,
  so a bullet with a dark outline shows on a busy background. That is
  the form the codebase64 "merge char bullets" page describes. It costs
  one more operation per glyph row touched.
- **Whole-cell bullets.** Save the code under the bullet, write one fixed
  bullet code, restore on move: no glyph build, no pixel positioning,
  and the background in that cell disappears. Escape From New York uses
  this form, with 16 bullets moving 8 pixels a frame (Cadaver's source
  dissection, not measured here).
- **Hand assembly.** The recipe is Oscar64 C. Hand-written 6502 with an
  unrolled glyph copy should draw a bullet in fewer cycles than the
  recipe's 407; not measured here.

### Cycle budget

Measured in VICE x64sc on both models with the recipe's CIA timers
(Oscar64 `-O2`): 641 cycles to restore eight bullets, 80 a bullet;
3,258 to 3,354 to draw eight, 407 to 419 a bullet. The Cost line is the
worst frame seen over about 240 frames on each model, 3,354 + 641 =
3,995 cycles, about a fifth of a PAL frame. The draw varies with shared
cells (one more chain step) and wall hits. The recipe's full-arena
compare, 5,873 cycles on PAL and 6,131 on NTSC, is its self-check and
not part of the technique.

### Recipes

- `recipes/oscar64/char-bullets.md`

### Sources

- codebase64, "Character bullets": https://codebase.c64.org/doku.php?id=base:character_bullets
- codebase64, "Merge char bullets": https://codebase.c64.org/doku.php?id=base:merge_char_bullets
- Cadaver, Escape From New York source dissection: https://cadaver.github.io/rants/dissect.html

---

## destructible_char_terrain — Destructible terrain in characters: private glyphs from a pool, pixel edits and pixel probes

**Complexity:** high
**Region:** both
**Uses registers:** D018
**Uses kernal:** (none)
**Cost:** cycles_per_frame=1450
**Cost basis:** measured-vice

### Why

A game where creatures dig tunnels and build bridges through the
landscape needs terrain that changes one pixel at a time. A bitmap does
that directly but costs 8 KB. Characters cost
1 KB of screen and 2 KB of charset, and most of a landscape is a few
repeated textures. The catch is that a glyph is shared: editing the
earth glyph to dig one hole digs it in every earth cell on screen. The
form here gives each edited cell its own copy.

### How

Draw the level with a few **shared glyphs** (the recipe has three:
empty, earth, and a 2-pixel step) and set aside a block of codes as a
**pool of private glyphs** ($80 to $FF, 128 codes, in the recipe), kept
as a stack of free codes.

**Editing a pixel.** Find the cell (`x >> 2`, `y >> 3` in multicolour;
`x >> 3` in hires) and its screen code.

1. If the pixel already has the wanted value, stop. This keeps a dig
   through empty air from allocating anything.
2. If the code is shared, pop a free code, copy the shared glyph's 8
   bytes into it and write the new code into the cell. If the pool is
   empty, refuse the edit and count it.
3. Change the pixel in the private glyph: clear its pair to dig, set it
   to build.
4. Compare the private glyph with each shared glyph. On a match, write
   the shared code back into the cell and push the private code on the
   free stack.

One cell owns each private glyph, so step 4 needs no reference count: a
cell dug out completely becomes the empty glyph again and its code goes
back (the recipe's two side-by-side diggers free two cells this way).

**Probing a pixel.** Cell from the coordinates, screen code from the
cell, glyph byte at row `y & 7`, then a mask for the pixel (`x & 3` in
multicolour, `x & 7` in hires). A non-zero result is terrain. The probe
reads what the VIC shows, so collision and picture cannot disagree.
Anything drawn into the glyphs that is not terrain, such as creatures
merged in the `char_bullets` way, must be restored before probes run.

**Pool exhaustion.** Choose a policy and state it. The recipe refuses:
the pixel stays as it was and a counter goes up. Its digger still steps
down, into earth it could not remove; a game should end the dig
instead. The other policy merges: before taking a new
code, look for a private glyph with the same 8 bytes and share it, which
needs a reference count per code and a search or hash (not built here).
Refusing is simpler and cannot corrupt anything; merging helps where
many edits make identical cells, such as a flat bridge.

**The code budget.** A charset has 256 codes. The recipe spends 64 on
HUD letters and digits, 3 on shared terrain, 48 on creatures (two per
creature for 24) and 128 on the pool; 13 are unused. So a level with
this HUD, these creatures and three shared glyphs can afford at most
141 private glyphs at once (arithmetic). A private glyph is needed for
each cell whose pixels match no shared glyph. In the recipe a shaft
through a 16-pixel platform, dug by two creatures side by side, and a
twelve-brick staircase used at most 7 at once;
24 simultaneous dig steps on untouched floor took 36. More shared
textures cost codes but do not change this: every edited cell that is
not back to a shared glyph costs one code.

### Why it works

The VIC-II reads each cell's glyph from the charset on every raster
line it draws, so a changed byte in a private glyph shows the next time
the beam draws that row of the cell. Shared glyphs are never written, so the cells
that still use them are untouched. A cell's screen code is the only
link between the cell and its private glyph, which is why freeing only
needs the cell's code rewritten.

An edit changes a glyph that is on screen. If the beam is inside that
cell's rows at that moment, one frame shows the old and new byte on
different lines. A dig or brick step changes one row of one or two
cells, so at most that row of a cell is late by a frame. The in-place
rewrite in `charset_animation` has the same effect over whole glyphs.

### Variations

- **Hires.** 8 pixels a byte, one colour a cell from colour RAM. The
  probe mask comes from `x & 7`. Pixels are twice as fine and the cells
  hold one colour, so terrain texture has to come from the pattern.
- **Different textures.** Every shared texture is one more code and one
  more comparison in step 4. A private glyph only returns to the pool
  when it equals one of them exactly.
- **Two charsets.** A raster interrupt that changes `$D018` part way
  down the screen gives the lower part its own 256 codes. Not built
  here.

### Cycle budget

Measured in VICE x64sc 3.10 with the recipe's CIA timers (Oscar64
`-O2`). A probe costs 52 cycles: 160 probes along one pixel row take
10,912 cycles and the same loop without the probe 2,580, with the
display off. The Cost line is one dig step's terrain work, the
technique called once: 3 pixel edits on untouched floor. The dearest
of 24 such steps took 1,450 cycles on both models, timer calls
included; half the steps span two cells and allocate twice.

A frame's terrain cost is edits times about 452. The 72 edits of 24 dig
steps at once, 36 of which allocate, took 32,037 cycles on PAL and
32,555 on NTSC, about 452 an edit and 1,356 a dig step. That is more
than a PAL frame (19,656 cycles) and nearly two NTSC frames (17,095).
A typical frame of the recipe edits nothing or one or two cells.
Hand-written assembly with a table of glyph addresses would be cheaper;
not measured here.

### Recipes

- `recipes/oscar64/destructible-terrain.md` — a 40 by 16 cell multicolour level; 24 creatures dig, build and block; terrain glyph bytes and creature states checked against a Python model after 360 ticks; worst frames timed on both models
