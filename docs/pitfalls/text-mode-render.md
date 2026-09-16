---
category: render
---

<!-- doc-type: pitfall-reference -->

# Text-Mode Render Pitfalls

Bugs that show up when implementing a moving-piece overlay on a
text-mode playfield (Tetris-likes, Sokoban-likes, Boulder Dash, etc.).
All of them stem from over-thinking the rendering layer: a C64 text-mode
field redraw is cheap enough that the simplest "rewrite everything every
frame, overlay last" loop just works. Optimizing it is usually a
self-inflicted wound.

---

## dirty_cell_skip_leaves_overlay_trail — Skipping unchanged cells leaves the moving piece's prior position un-cleared

**Severity:** high
**Region:** both
**Triggered by techniques:** text_mode_overlay_render

### Symptom

A Tetris-like (or any falling-piece / moving-overlay game) draws the
playfield + an active piece on top. The active piece moves every
gravity tick, but on screen you see EITHER (a) a smeared trail of every
position the piece has occupied since spawn, or (b) the piece appears
to "skip" rows and only becomes visible near the bottom of the field,
where row activity is highest. Empty rows above appear truly empty
even though the piece passed through them.

The bug is the same in both cases — render_field's "skip cells where
field[r][c] hasn't changed" optimization is silently dropping the
writes needed to *clear* the piece's previous position.

### Mechanism

The piece is rendered as an OVERLAY — its cells aren't in the
`field[][]` array until the piece locks. The render loop is:

```c
render_field();   // walks field[][], writes screen + color RAM
render_piece();   // walks active piece's 4 cells, overwrites screen + color RAM
```

When `render_field` repaints every cell unconditionally, render_piece's
prior-frame writes get overwritten by the (correct) empty-cell content
of the playfield. The piece moves cleanly. The "trail" from the
previous frame is implicitly erased.

The moment `render_field` adds a "skip if field[r][c] equals last
frame's field[r][c]" cache, this property collapses:

- The piece at frame N-1 is drawn over cells (r, c) where field[r][c] == 0.
- Frame N: piece moves to (r+1, c). render_field sees field[r][c] is
  still 0, "unchanged" — skips. The piece's prior screen-RAM write
  ($A0 + color) survives. render_piece draws the new position.
- On screen: piece at (r, c) AND (r+1, c). Trail.
- After 20 gravity ticks: piece smeared across 20 rows.

If gravity is fast (level >= 5, or hard-drop) the smear is so dense
that the eye reads it as "the piece teleported to the bottom and
appeared with no descent."

### Fix

The naïve advice "just rewrite the whole field every frame" is WRONG
on a typical Oscar64 build — see `full_field_redraw_exceeds_vblank`.
The correct overlay shape is to track the piece's prior position and
erase + draw only those ~8 cells per frame; `render_field` runs only
on persistent-state changes (line clear, restart, initial paint).

The render order must be: erase prev piece (from field[][] content),
then draw current piece. Both passes use the piece-cells table — no
separate dirty-rectangle tracking on the field.

```c
// Correct: unconditional field redraw, piece overlay second.
void render_field(void) {
    for (unsigned char r = 0; r < FIELD_H; r++) {
        unsigned char *srow = Screen + (FIELD_ROW0 + r) * COLS + FIELD_COL0;
        unsigned char *crow = Color  + (FIELD_ROW0 + r) * COLS + FIELD_COL0;
        for (unsigned char c = 0; c < FIELD_W; c++) {
            unsigned char cell = field[r][c];
            unsigned char sc   = (cell == 0) ? 0x20 : 0xA0;
            unsigned char col  = piece_color[cell];
            srow[c*2 + 0] = sc; srow[c*2 + 1] = sc;
            crow[c*2 + 0] = col; crow[c*2 + 1] = col;
        }
    }
}

void render_piece(void) {
    // Walks the 4 cells of the active piece, writes 0xA0 + color.
    // No interaction with field[][]; the next frame's render_field()
    // call clears the piece's prior position.
    ...
}
```

If you genuinely need the optimization (e.g. a 40×25 full-screen
redraw is too slow for your frame budget), you must EITHER:

- Track the piece's prior position separately and explicitly write
  spaces there before drawing the new position (a "dirty rectangle"
  for the overlay, not the field), OR
- Skip the optimization for the rows the piece currently occupies +
  the rows it occupied last frame.

The first approach is cleaner. But neither is needed on a 10×20
playfield — the unconditional rewrite is simpler, well within budget,
and bug-free.

### Worked example

The broken pattern that causes the smear / "only-visible-near-bottom"
symptom:

```c
// BUGGY: prev_field caches last frame's content.
static unsigned char prev_field[FIELD_H][FIELD_W];

void render_field(void) {
    for (unsigned char r = 0; r < FIELD_H; r++) {
        for (unsigned char c = 0; c < FIELD_W; c++) {
            unsigned char cell = field[r][c];
            if (cell == prev_field[r][c]) continue;   // ❌ bug: piece's
            // prior screen write is at a cell where field[r][c] is still
            // 0 and prev_field[r][c] is still 0 — this skip leaves the
            // $A0 from last frame on screen, building a trail.
            prev_field[r][c] = cell;
            // ... write screen + color RAM ...
        }
    }
}
```

### Cross-references

- Technique: `text_mode_overlay_render` (`docs/techniques/text-mode-render.md`)
- Related: any game-archetype briefing that proposes a text-mode
  playfield + moving overlay (Tetris, Sokoban, Boulder Dash, board
  games). `c64_game_briefing` with archetype `puzzle` should surface
  this pitfall automatically.

---

## render_during_state_transition_clobbers_banner — Drawing field/piece after a state change overwrites GAME OVER or line-flash

**Severity:** medium
**Region:** both
**Triggered by techniques:** text_mode_overlay_render

### Symptom

A Tetris-like correctly draws a GAME OVER banner (or a line-clear flash
animation) — for ONE frame. The next frame the banner disappears and
the playfield reappears as if nothing happened. The state machine has
correctly flipped to STATE_OVER (or STATE_LINE_FLASH), but the screen
keeps showing the active game.

### Mechanism

A typical Tetris main loop looks like:

```c
switch (game_state) {
    case STATE_PLAY: update_play(act); break;
    case STATE_LINE_FLASH: update_line_flash(); break;
    case STATE_OVER: update_game_over(act); break;
}
```

And `update_play` does the gravity tick + renders:

```c
gravity_counter--;
if (gravity_counter == 0) {
    gravity_tick();          // may flip game_state to OVER / LINE_FLASH
    gravity_counter = ...;
}
render_field();              // ❌ runs even if state just changed
render_piece();
```

If `gravity_tick` flips `game_state` to STATE_OVER (because the new
piece collides at spawn) and calls `render_game_over()` to draw the
banner, the `render_field()` / `render_piece()` calls that follow in
the *same* iteration of update_play will repaint the playfield
including the cells the banner just drew. The banner is on screen for
zero visible frames.

### Fix

Gate the field+piece render on the current game_state, AFTER the
gravity tick has had a chance to change it:

```c
if (game_state == STATE_PLAY) {
    render_field();
    render_piece();
}
```

If the state transitioned, the renderer that handles the new state
(`render_game_over`, `render_line_flash`) has already drawn what it
needs, and the next loop iteration will dispatch to that state's
update function.

### Cross-references

- Technique: `text_mode_overlay_render`
- Related pitfall: `dirty_cell_skip_leaves_overlay_trail`

---

## full_field_redraw_exceeds_vblank — Per-frame `render_field()` overruns PAL vblank, tearing the upper rows

**Severity:** high
**Region:** both
**Triggered by techniques:** text_mode_overlay_render

### Symptom

A Tetris-like (or any per-frame text-mode redraw game) shows the
playfield correctly in the BOTTOM 4-5 rows but the UPPER rows look
empty or stale, even though a memory dump of screen RAM shows the
piece at the correct upper row. The piece appears to "teleport" into
the lower screen — you can see it land but never see it descend from
the top.

Confusingly, `readMemory` on screen RAM at any moment shows the piece
at the expected row. The bug is visual-only and exists because the
CPU and the VIC raster are racing.

### Mechanism

The C64 has no frame buffer. The VIC reads screen RAM line by line
during the visible portion of the raster (PAL lines ~50-249), and the
CPU can write to screen RAM at any time. Between frames there's a
vblank window of about 56 raster lines × 63 cycles ≈ **3,500 cycles**
where the CPU can write screen RAM without the raster racing it.

A naïve full-field redraw — walk every cell of a 10×20 playfield
(rendered 2-chars-wide = 200 cells × 2 chars), write screen RAM + color
RAM — costs ~92 cycles per cell in Oscar64 -O2 output. That's
**~18,400 cycles** for 200 cells. The vblank window is 3,500 cycles.

When `render_field` is called every frame after `vic_waitBottom`:

1. Frame N's render runs in vblank, then continues into frame N+1's
   visible draw (lines 0 → 156, ~76 lines past vblank end).
2. By the time the CPU is clearing row 0..7 of the playfield, the VIC
   raster has ALREADY drawn screen rows 0..7 for frame N+1 using
   whatever stale data was there.
3. The CPU eventually catches up around row 8 of the playfield (= screen
   row ~20). Lower screen rows are drawn with the new data.

Net effect: upper playfield rows show stale (or in-between-clear-and-
overlay) content for every frame; lower playfield rows show the
intended new content. The piece can only "appear" once the gravity has
moved it past the screen row where CPU writes beat the VIC raster.

This is a frame-budget bug, not a logic bug. The unconditional redraw
pattern that "feels safe" because it has no caching, no dirty-cell
state — is itself the trap.

### Fix

Stop full-redrawing every frame. Use an overlay pattern with explicit
prev-piece state:

```c
// In render.c (or wherever the per-frame paint lives):

static signed char   prev_x, prev_y;
static unsigned char prev_type, prev_rot;
static unsigned char have_prev = 0;

void render_piece(void) {
    // Pass 1: erase prev cells by reading field[][] (which has the
    // locked piece at those cells if a lock just happened — so this
    // pass correctly redraws a just-locked piece instead of clearing
    // it).
    if (have_prev) {
        for (unsigned char i = 0; i < 4; i++) {
            // ... compute (cx, cy) from prev_type/rot/x/y ...
            unsigned char cell = field[cy][cx];
            unsigned char sc = (cell == 0) ? 0x20 : 0xA0;
            // write screen + color
        }
    }
    // Pass 2: draw current piece.
    for (unsigned char i = 0; i < 4; i++) {
        // ... compute (cx, cy) from current_type/rot/x/y ...
        // write 0xA0 + piece_color
    }
    prev_x = current_x; prev_y = current_y;
    prev_type = current_type; prev_rot = current_rot;
    have_prev = 1;
}
```

Per-frame cost drops to ~8 cell writes ≈ **~120 cycles**, easily
inside vblank. Call `render_field()` only when persistent state
actually changes:

- After a line-clear shift (rare).
- After game-over restart (rare).
- Initial paint from `render_init()` (once).

Reset `have_prev = 0` whenever `render_field` runs so the next frame
doesn't try to "erase" cells that have moved.

For a brief frame during a line clear, the full redraw will tear —
that's acceptable because line clears are rare and the tear lasts
exactly one frame.

### Why the naïve advice is wrong

This pitfall corrects an earlier version of `text_mode_overlay_render`
and `dirty_cell_skip_leaves_overlay_trail` that claimed full redraw
is cheap on C64 ("4800 cycles, 24% of a PAL frame"). That estimate
under-counted Oscar64's loop overhead and ignored the cost of color
RAM writes. Empirical measurement in puzzle-tetris-c64-kb showed
~18,000 cycles, which crashes through vblank and into the visible
draw of the next frame.

The takeaway: 200 cell writes IS expensive on a 1 MHz 6502 when
each "write" is actually 2 STA-absolute + 2 color-RAM STA + indexed
addressing overhead + loop counter. Don't trust intuitive estimates
for per-frame text-mode work; measure or budget explicitly.

### Cross-references

- Technique: `text_mode_overlay_render`
- Related: `dirty_cell_skip_leaves_overlay_trail` (the bug class you
  hit if you try to fix this by adding a dirty-cell cache to
  `render_field` instead of switching to an overlay pattern).
