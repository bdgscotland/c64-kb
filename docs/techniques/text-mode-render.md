---
category: render
chip: VIC-II
---

<!-- doc-type: technique-reference -->

# Text-Mode Render Techniques

Text-mode rendering on the C64 is much cheaper than the sprite/raster
chapters might suggest. Writing screen RAM directly is a 4-cycle
operation per cell (LDA / STA absolute), and a full 40×25 redraw costs
only ~4000 cycles — about 1/5 of a PAL frame budget. The temptation to
"optimize" by tracking dirty cells almost always loses time you didn't
need to save AND opens a class of bugs (`dirty_cell_skip_leaves_overlay_trail`)
that don't exist if you just redraw unconditionally.

Most C64 games that look like Tetris, Boulder Dash, Sokoban, or any
top-down puzzle/board game ship a single tight render loop that walks
the playfield array each frame, then layers the active piece(s) on top
as a second pass. The active piece(s) never live in the playfield
array — they're an overlay drawn last, and the next frame's
field-redraw is what erases them.

---

## text_mode_overlay_render — Playfield + moving-piece overlay in text mode

**Complexity:** low
**Region:** both
**Uses registers:** (none — direct screen/color RAM writes only)
**Uses kernal:** (none)

### Why

Tetris-likes, Sokoban-likes, Boulder Dash variants, and most C64
puzzle / board games need to draw a mostly-static playfield with one
or more *moving* pieces on top of it. The pieces aren't part of the
playfield's persistent state — they move every gravity tick — so the
question is how the rendering layer keeps the field cells correct
while also drawing the piece on top of them.

The answer that "feels professional" is to track dirty cells and
repaint only what changed; the answer that *works* on a stock C64 in
text mode is to repaint the whole field every frame and draw the
piece overlay last. The frame budget is more than ample. The dirty-cell
approach has a subtle invariant that's easy to miss (see
`dirty_cell_skip_leaves_overlay_trail` in `pitfalls/text-mode-render.md`).

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
  writes per cell) = **~18,400 cycles**.
- PAL vblank after `vic_waitBottom` (raster ≥ 256) = **~3,500 cycles**
  before the visible area starts again.
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
4. ~8 cell writes per frame ≈ **~120 cycles**. Well under vblank.

`render_field` is reserved for events that change persistent state:
line-clear shift (rare), game-over restart (rare), initial paint. The
brief tearing on those one-frame events is acceptable.

### Variations

- **Two-byte-wide cells.** A 40-column screen with a 10-wide playfield
  often renders each playfield cell as 2 screen columns wide to give
  square-ish character cells. Same loop, one extra STA per cell — under
  3 % more cycles.
- **Color-only flash for line-clear.** During an animation (e.g.
  Tetris line clear), don't rewrite screen codes — just toggle the color
  RAM byte per cell on/off per N frames. Skip the screen-RAM write
  pass entirely.
- **Skip render during state transitions.** When the game flips to a
  non-playing state mid-frame (game-over banner drawn, line-flash
  starting), gate the render_field+render_piece pair on the state so the
  banner / flash isn't immediately clobbered.

### Cycle budget

For a 10×20 playfield rendered as 2-char-wide cells (= 20×20 screen
cells), per frame:

- render_field: 400 cells × ~12 cyc = 4800 cycles (24 % of a PAL frame)
- render_piece: 4 cells × 2 chars × ~12 cyc = ~96 cycles (negligible)
- Total: < 25 % of a PAL frame, < 27 % of an NTSC frame

For a full-screen 40×25 redraw (Boulder Dash-style scrolling map):

- 1000 cells × ~12 cyc = 12,000 cycles (61 % of a PAL frame)

That's the point at which dirty-cell tracking starts to pay off — but
even a 1000-cell redraw fits inside a single frame, so most games can
ignore the optimization.

### Recipes

- `recipes/oscar64/text-overlay-playfield.md`
