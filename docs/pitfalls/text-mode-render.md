---
category: render
---

<!-- doc-type: pitfall-reference -->

# Text-Mode Render Pitfalls

Bugs that show up when implementing a moving-piece overlay on a
text-mode playfield (Tetris-likes, Sokoban-likes, Boulder Dash, etc.).
Two of them come from over-thinking the rendering layer; the third comes
from under-budgeting it; the fourth is an encoding mistake rather than a
rendering one, PETSCII bytes stored where the VIC expects screen codes.
An earlier version of this page opened by saying
a C64 text-mode field redraw is "cheap enough that the simplest 'rewrite
everything every frame, overlay last' loop just works". It does not: the
10×20 `render_field` listed below costs about 16,400 cycles (15,500 with
the display blanked; VICE x64sc PAL, Oscar64 -O2, CIA-timed), and the
race-free budget is much smaller — `vic_waitBottom` returns at raster
256 and the display window resumes at 51, 107 lines, ~6,700 cycles — so
the full repaint runs to about line 205 of the next frame. The shape
that works is: paint the field on state changes only, and per frame
erase the piece's previous cells from `field[][]` and draw its current
ones. The first pitfall below is what goes wrong when the erase is
skipped; the third is what goes wrong when the whole field is repainted
instead.

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
// render_field: unconditional field repaint. Call it on state changes
// only (line clear, restart, initial paint) — NOT every frame; measured
// at about 16,400 cycles in Oscar64 -O2, see full_field_redraw_exceeds_vblank.
// (An earlier version of this comment called it the correct per-frame shape.)
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
    // Erase pass first: repaint the prev-position cells from field[][],
    // then draw the current cells (0xA0 + color) — see
    // full_field_redraw_exceeds_vblank for the listing. Do not rely on a
    // per-frame render_field() to erase the prior position.
    ...
}
```

Because even the 10×20 field redraw is too slow for the per-frame
budget on an Oscar64 build, you must EITHER:

- Track the piece's prior position separately and explicitly write
  spaces there before drawing the new position (a "dirty rectangle"
  for the overlay, not the field), OR
- Skip the optimization for the rows the piece currently occupies +
  the rows it occupied last frame.

The first approach is cleaner, and it is the one the listing under
`full_field_redraw_exceeds_vblank` shows. An earlier version of this
section ended by saying neither was needed on a 10×20 playfield because
the unconditional rewrite was "well within budget"; it is not — the
listing above measures about 16,400 cycles a call against a ~6,700-cycle
race-free window (VICE x64sc, PAL, CIA-timed), which is the third
pitfall on this page.

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
**Triggered by techniques:** text_mode_overlay_render, tile_map_render, char_scroll_buffer_v, soft_scroll_v, bitmap_scroll, colour_fade, plasma, text_zoom, speedcode_generation, charset_animation, dycp_scroller, colour_cycling, char_bullets, software_sprite_preshifted, charset_parallax
**Mitigated by techniques:** screen_double_buffer_d018

### Symptom

A Tetris-like (or any per-frame text-mode redraw game) shows the
piece correctly in the bottom few rows (at most screen rows 20-24) but
the UPPER rows look empty or stale, even though a memory dump of
screen RAM shows the piece at the correct upper row. The piece appears to "teleport" into
the lower screen — you can see it land but never see it descend from
the top.

Confusingly, `readMemory` on screen RAM at any moment shows the piece
at the expected row. The bug is visual-only and exists because the
CPU and the VIC raster are racing.

### Mechanism

The C64 has no frame buffer. The VIC reads screen RAM line by line
during the visible portion of the raster (PAL lines ~50-249), and the
CPU can write to screen RAM at any time. After `vic_waitBottom`
returns at raster 256 there are 107 raster lines — 56 of lower border
and blanking to the wrap at 311, then 51 of upper border — before the
display window resumes at raster 51 and the VIC fetches screen RAM
again: 107 × 63 ≈ **6,700 cycles** in which the CPU can write screen
RAM without the raster racing it. (The 56 lines to the wrap alone are
~3,500 cycles, which is what an earlier version of this page called
"the vblank window"; the race-free budget is nearly twice that.)

A naïve full-field redraw — walk every cell of a 10×20 playfield
(rendered 2-chars-wide = 200 cells × 2 chars), write screen RAM + color
RAM — costs about 78-86 cycles per cell in Oscar64 -O2 output: the
listing in the first section measures 15,519 cycles with the display
blanked and about 16,400 wall-clock started at raster 256 with badline
stalls counted in (CIA-timed in VICE x64sc), and the recipe's
`paint_cell` version 17,100-17,450. Call it **15,500-17,500 cycles**
for 200 cells. (An earlier version of this page said ~92 a cell /
~18,400; that was an estimate, not a measurement.) The race-free
window is ~6,700 cycles.

When `render_field` is called every frame after `vic_waitBottom`:

1. Started at raster 256 (where `vic_waitBottom` returns), the redraw
   runs about 16,400 cycles for the listing in the first section
   (measured in VICE x64sc, PAL, CIA2 timer; 17,100-17,450 for the
   recipe's version) and does not finish until about raster 205-220 of
   the NEXT frame — well past the top of the display window, which
   resumed at line 51. An earlier version of this page said "lines 0 →
   156, ~76 lines past vblank end"; neither number follows from its own
   figures (18,400 / 63 is 292 lines, which from 256 wraps to about
   236) and neither was measured.
2. The field rows themselves are not what you see go wrong. The loop
   advances about 13 raster lines per field row while the VIC's badlines
   advance 8, so each playfield row is rewritten before the VIC fetches
   it, for every playfield origin from screen row 1 down: rows 0-3 land
   in the previous frame's bottom border, and row r after that at about
   line 13r − 43 against a badline at 51 + 8·(FIELD_ROW0 + r). Measured:
   a cell written by `render_field` is displayed in every one of the 20
   rows. Only the last row is marginal, and only in the slower recipe
   build with FIELD_ROW0 = 2 (its last cells land a line or two after
   the row's badline, so that row can show the field one frame late
   after a lock). An earlier version of this page said the CPU was
   still clearing playfield rows 0..7 after the VIC had drawn them and
   "caught up around row 8 of the playfield (= screen row ~20)" — which
   is also impossible on its face, since a 20-row field on a 25-row
   screen puts playfield row 8 on screen row 13 at the lowest.
3. What loses the race is the piece overlay. `render_piece` runs only
   after `render_field` returns, at about raster 205-220, when every
   screen row whose badline (51 + 8·row) is earlier than that — rows 0
   to about 19 — has already been fetched for this frame; and the next
   frame's `render_field` erases the piece again before the badline of
   every row it could have reached. So only piece cells on screen rows
   whose fetch falls after the overlay write — screen rows 20-24 at
   most, whose badlines are 211-243, and fewer the longer the overlay
   takes — are ever displayed. With FIELD_ROW0 = 4 that is the bottom
   two to four playfield rows (rows 16-19); with a field ending higher
   on the screen, fewer or none. Every row above that shows the piece
   erased.

Net effect: the field content is current everywhere, but the piece is
invisible in every row above the bottom few; it "appears" only once
gravity has moved it into the screen rows whose badline falls after
the overlay write — which is the "teleports into the lower screen"
symptom.

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

Per-frame cost drops to 8 cell writes — about **~2,000 cycles** in
Oscar64 -O2 (`render_piece` measured at 1,998 cycles on CIA 2 timer A,
~250 a call through `paint_cell`; see
`recipes/oscar64/text-overlay-playfield.md`), or roughly 150–200 cycles
in hand assembly with precomputed addresses. Either fits the ~3,500
cycles to the frame wrap with room to spare, and the 107 raster lines
(~6,700 cycles) between raster 256 and the display window resuming at
line 51 are the real race-free budget. An earlier version of this page
said ~120 cycles, which is 15 a cell against the ~92 it had just priced
an Oscar64 cell write at. Call `render_field()` only when persistent
state actually changes:

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
RAM writes. puzzle-tetris-c64-kb put it at ~18,000 cycles — an
estimate in the fix commit, never timed; the same listing measures
15,500-16,400 in VICE and the recipe's version 17,100-17,450 — any of
which runs through the 107-line race-free window and well into the
visible draw of the next frame.

The takeaway: 200 cell writes IS expensive on a 1 MHz 6502 when
each "write" is actually 2 STA-absolute + 2 color-RAM STA + indexed
addressing overhead + loop counter. Don't trust intuitive estimates
for per-frame text-mode work; measure or budget explicitly.

### Cross-references

- Technique: `text_mode_overlay_render`
- Related: `dirty_cell_skip_leaves_overlay_trail` (the bug class you
  hit if you try to fix this by adding a dirty-cell cache to
  `render_field` instead of switching to an overlay pattern).

---

## petscii_written_to_screen_ram — PETSCII bytes stored in $0400 show graphics glyphs where the letters should be

**Severity:** high
**Region:** both
**Triggered by registers:** D018
**Triggered by techniques:** petscii_screen_code_conversion, text_input_line, decimal_print, password_encoding
**Mitigated by techniques:** petscii_screen_code_conversion

### Symptom

Text written straight into screen RAM comes out wrong in a pattern:
digits, space and punctuation are right, every letter is a graphics
character (a `HELLO` written this way shows five box-drawing and
line glyphs), and text taken from the keyboard with the shift or
Commodore key held comes out reversed. Sending the same bytes through
CHROUT shows the right letters. Switching character sets with `$0E`
or `$8E`, or by writing `$D018`, changes the pictures, and can make the
unshifted letters look right by accident: in the lower-case set they
show as upper-case letters, so a program tested after a `$0E` passes
and breaks when the set changes back. The reversed cells stay reversed
in both sets. The recipe below has the three rows side by side.

### Mechanism

PETSCII and screen codes are two different encodings of the same
glyphs and agree only in `$20-$3F`. The VIC-II fetches a glyph at
`charset base + 8 * byte` and knows nothing of PETSCII; CHROUT is
where the translation lives, in the KERNAL's screen editor at `$E716`,
and a store to `$0400` bypasses it. A letter is PETSCII `$41-$5A` but
screen code `$01-$1A`, so the byte `$48` (`H`) selects glyph `$48`.
In the upper-case/graphics set that glyph is a vertical bar; in the
lower-case set glyphs `$41-$5A` are the upper-case letters, byte for
byte the same bitmaps as `$01-$1A` in the first set (read from the
`chargen-901225-01.bin` image), so the same wrong byte shows the right
letter. Shifted PETSCII is `$C1-$DA` with bit 7 set, and bit 7 of a
screen code is reverse video, so those cells come out reversed in
either set, and Commodore-key graphics (`$A0-$BF`) likewise. `$D018`
bit 1 picks which 2 KB of the character ROM supplies the pictures,
which is why changing it changes the glyphs without touching the bytes
(measured in VICE x64sc 3.10: CHROUT `$0E` sets `$D018` to `$17`, `$8E`
back to `$15`, and the bytes in screen RAM are the same before and
after).

The same mistake in the other direction is quieter: screen codes
`$01-$1A` are PETSCII control codes, so a name read back from `$0400`
and handed to CHROUT loses its letters and keeps only its digits,
spaces and punctuation. Most of those codes print nothing and leave
the cursor column where it was; some change the colour or move the
cursor (measured in VICE x64sc 3.10: CHROUT of `$01-$04` after a PLOT
to column 0 leaves `$0400-$0403` at zero and the column at 0).

### Fix

Convert at the boundary, every time a byte crosses from a PETSCII
source (keyboard, file, CHROUT-style string) to screen RAM or back.
The rule is six compares and a mask (`petscii_screen_code_conversion`
in `techniques/text.md`): `$20-$3F` unchanged, `$40-$5F` less `$40`,
`$60-$7F` less `$20`, `$A0-$FF` low seven bits with bit 6 set, `$FF`
to `$5E`. Or write text through CHROUT and let the KERNAL convert,
accepting the cursor, the wrap and the clobbered registers. In
KickAssembler, `.text` already emits screen codes; the trap there is
the other way round, a `.text` string sent through CHROUT
(`toolchains/kickassembler-reference.md`). Keep stored text in one encoding,
PETSCII by preference, and convert on the way to the screen.

### Worked example

```c
// Bad: PETSCII bytes poked into screen RAM; every letter is a graphics glyph.
const char msg[] = { 0x48, 0x45, 0x4c, 0x4c, 0x4f, 0 };   // HELLO in PETSCII
for (char i = 0; msg[i]; i++) SCREEN[40 * 4 + i] = msg[i];

// Good: convert on the way in; digits and space pass through unchanged.
for (char i = 0; msg[i]; i++) SCREEN[40 * 3 + i] = pet2scr(msg[i]);
```

`pet2scr()` is the routine in `recipes/oscar64/petscii-screen-codes.md`,
whose screenshot shows both rows.

### Cross-references

- Technique: `petscii_screen_code_conversion` (the rule, measured
  against CHROUT over every code)
- Techniques that write screen RAM from a PETSCII source:
  `text_input_line`, `decimal_print`
- Register: `$D018` bit 1 (`hardware/vic-ii-reference.md`) selects the
  set; it never changes the code
- Recipe: `recipes/oscar64/petscii-screen-codes.md`
