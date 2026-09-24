---
category: render
---

<!-- doc-type: pitfall-reference -->

# Text-Mode Render Pitfalls

Bugs that show up when drawing a game on the text screen: a
moving-piece overlay on a character playfield (Tetris-likes,
Sokoban-likes, Boulder Dash, etc.), and the inputs that playfield
depends on. Some come from over-thinking the rendering layer and one
from under-budgeting it; the rest are mistakes in what is fed to the
VIC rather than in the drawing itself: PETSCII bytes where it expects
screen codes, a colour RAM index that runs past the last cell and into
the CIA, a colour register compared against the value written to it, a
mode bit left set from the previous screen, and a charset file embedded
with its header still on. (An earlier version of this paragraph
numbered the entries; the numbering went stale twice in a day.)
An earlier version of this page opened by saying
a C64 text-mode field redraw is "cheap enough that the simplest 'rewrite
everything every frame, overlay last' loop just works". It does not: the
10×20 `render_field` listed below costs about 16,400 cycles (15,500 with
the display blanked; VICE x64sc PAL, Oscar64 -O2, CIA-timed), and the
race-free budget is much smaller (`vic_waitBottom` returns at raster
256 and the display window resumes at 51: 107 lines, ~6,700 cycles), so
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
**Triggered by techniques:** text_mode_overlay_render, mixed_sprite_char_actors, bobs_effect, isometric_tile_engine

### Symptom

A Tetris-like (or any falling-piece / moving-overlay game) draws the
playfield + an active piece on top. The active piece moves every
gravity tick, but the screen shows EITHER (a) a smeared trail of every
position the piece has occupied since spawn, or (b) the piece appears
to skip rows and only becomes visible near the bottom of the field,
where row activity is highest. Empty rows above appear empty
even though the piece passed through them.

Both have one cause: render_field's "skip cells where field[r][c]
hasn't changed" optimization drops the writes that clear the piece's
previous position.

### Mechanism

The piece is rendered as an OVERLAY: its cells are not in the
`field[][]` array until the piece locks. The render loop is:

```c
render_field();   // walks field[][], writes screen + color RAM
render_piece();   // walks active piece's 4 cells, overwrites screen + color RAM
```

When `render_field` repaints every cell unconditionally, render_piece's
prior-frame writes get overwritten by the (correct) empty-cell content
of the playfield. The piece moves cleanly. The trail from the
previous frame is erased as a side effect.

When `render_field` adds a "skip if field[r][c] equals last frame's
field[r][c]" cache, that erase stops:

- The piece at frame N-1 is drawn over cells (r, c) where field[r][c] == 0.
- Frame N: piece moves to (r+1, c). render_field sees field[r][c] is
  still 0, treats it as unchanged and skips it. The piece's prior screen-RAM write
  ($A0 + color) survives. render_piece draws the new position.
- On screen: piece at (r, c) AND (r+1, c). Trail.
- After 20 gravity ticks: piece smeared across 20 rows.

If gravity is fast (level >= 5, or hard-drop) the smear is so dense
that the eye reads it as "the piece teleported to the bottom and
appeared with no descent."

### Fix

Rewriting the whole field every frame is WRONG on a typical Oscar64
build; see `full_field_redraw_exceeds_vblank`. Instead, track the
piece's prior position and erase + draw only those ~8 cells per frame; `render_field` runs only
on persistent-state changes (line clear, restart, initial paint).

The render order must be: erase prev piece (from field[][] content),
then draw current piece. Both passes use the piece-cells table; the
field needs no separate dirty-rectangle tracking.

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
budget on an Oscar64 build, the fix is EITHER:

- Track the piece's prior position separately and explicitly write
  spaces there before drawing the new position (a "dirty rectangle"
  for the overlay, not the field), OR
- Skip the optimization for the rows the piece currently occupies +
  the rows it occupied last frame.

The listing under `full_field_redraw_exceeds_vblank` uses the first. An earlier version of this
section ended by saying neither was needed on a 10×20 playfield because
the unconditional rewrite was "well within budget". It is not: the
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
  games). `c64_game_briefing` with archetype `puzzle` should return
  this pitfall.

---

## render_during_state_transition_clobbers_banner — Drawing field/piece after a state change overwrites GAME OVER or line-flash

**Severity:** medium
**Region:** both
**Triggered by techniques:** text_mode_overlay_render

### Symptom

A Tetris-like draws a GAME OVER banner (or a line-clear flash
animation) for ONE frame. The next frame the banner disappears and
the playfield reappears as if nothing happened. The state machine has
flipped to STATE_OVER (or STATE_LINE_FLASH), but the screen
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
**Triggered by techniques:** text_mode_overlay_render, tile_map_render, char_scroll_buffer_v, soft_scroll_v, bitmap_scroll, colour_fade, plasma, text_zoom, speedcode_generation, charset_animation, dycp_scroller, colour_cycling, char_bullets, software_sprite_preshifted, charset_parallax, flip_screen_rooms, creature_state_machine, mixed_sprite_char_actors, eight_way_scroll_double_buffer, tunnel, voxel_landscape, isometric_tile_engine, dot_flag_sine_plotter, fire_effect, twister, shadebobs
**Mitigated by techniques:** screen_double_buffer_d018

### Symptom

A Tetris-like (or any per-frame text-mode redraw game) shows the
piece correctly in the bottom few rows (at most screen rows 20-24) but
the UPPER rows look empty or stale, even though a memory dump of
screen RAM shows the piece at the correct upper row. The piece appears to "teleport" into
the lower screen: it is seen to land but never to descend from the top.

`readMemory` on screen RAM at any moment shows the piece at the
expected row. The bug is visual only: the CPU and the VIC raster are
racing.

### Mechanism

The C64 has no frame buffer. The VIC reads screen RAM line by line
during the display window (lines 51-250 with 25 rows; an earlier version
said "PAL lines ~50-249"), and the
CPU can write to screen RAM at any time. After `vic_waitBottom`
returns at raster 256 there are 107 raster lines (56 of lower border
and blanking to the wrap at 311, then 51 of upper border) before the
display window resumes at raster 51 and the VIC fetches screen RAM
again: 107 × 63 ≈ **6,700 cycles** in which the CPU can write screen
RAM without the raster racing it. (The 56 lines to the wrap alone are
~3,500 cycles, which is what an earlier version of this page called
"the vblank window"; the race-free budget is nearly twice that.)

A full-field redraw (walk every cell of a 10×20 playfield, rendered
2-chars-wide = 200 cells × 2 chars, write screen RAM + color RAM)
costs about 78-86 cycles per cell in Oscar64 -O2 output: the
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
   the NEXT frame, well past the top of the display window, which
   resumed at line 51. An earlier version of this page said "lines 0 →
   156, ~76 lines past vblank end"; neither number follows from its own
   figures (18,400 / 63 is 292 lines, which from 256 wraps to about
   236) and neither was measured.
2. The field rows themselves are not what goes wrong. The loop
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
   "caught up around row 8 of the playfield (= screen row ~20)", which
   is also impossible on its face, since a 20-row field on a 25-row
   screen puts playfield row 8 on screen row 13 at the lowest.
3. What loses the race is the piece overlay. `render_piece` runs only
   after `render_field` returns, at about raster 205-220, when every
   screen row whose badline (51 + 8·row) is earlier than that (rows 0
   to about 19) has already been fetched for this frame; and the next
   frame's `render_field` erases the piece again before the badline of
   every row it could have reached. So only piece cells on screen rows
   whose fetch falls after the overlay write (screen rows 20-24 at
   most, whose badlines are 211-243, and fewer the longer the overlay
   takes) are ever displayed. With FIELD_ROW0 = 4 that is the bottom
   two to four playfield rows (rows 16-19); with a field ending higher
   on the screen, fewer or none. Every row above that shows the piece
   erased.

Net effect: the field content is current everywhere, but the piece is
invisible in every row above the bottom few. It appears only once
gravity has moved it into the screen rows whose badline falls after
the overlay write. That is the "teleports into the lower screen"
symptom.

This is a frame-budget bug, not a logic bug. The unconditional redraw,
with no caching and no dirty-cell state, is itself the cause.

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

Per-frame cost drops to 8 cell writes, about **~2,000 cycles** in
Oscar64 -O2 (`render_piece` measured at 1,998 cycles on CIA 2 timer A,
~250 a call through `paint_cell`; see
`recipes/oscar64/text-overlay-playfield.md`), or roughly 150–200 cycles
in hand assembly with precomputed addresses. Either fits the ~3,500
cycles to the frame wrap, and the 107 raster lines (~6,700 cycles)
between raster 256 and the display window resuming at line 51 are the
full race-free budget. An earlier version of this page
said ~120 cycles, which is 15 a cell against the ~92 it had just priced
an Oscar64 cell write at. Call `render_field()` only when persistent
state changes:

- After a line-clear shift (rare).
- After game-over restart (rare).
- Initial paint from `render_init()` (once).

Reset `have_prev = 0` whenever `render_field` runs so the next frame
does not try to erase cells that have moved.

During a line clear the full redraw tears for exactly one frame. Line
clears are rare, so this is acceptable.

### Why the naïve advice is wrong

This pitfall corrects an earlier version of `text_mode_overlay_render`
and `dirty_cell_skip_leaves_overlay_trail` that claimed full redraw
is cheap on C64 ("4800 cycles, 24% of a PAL frame"). That estimate
under-counted Oscar64's loop overhead and ignored the cost of color
RAM writes. puzzle-tetris-c64-kb put it at ~18,000 cycles, an
estimate in the fix commit, never timed. The same listing measures
15,500-16,400 in VICE and the recipe's version 17,100-17,450; any of
these runs through the 107-line race-free window and well into the
visible draw of the next frame.

200 cell writes are expensive on a 1 MHz 6502 when each write is
2 STA-absolute + 2 color-RAM STA + indexed addressing overhead + loop
counter. Measure per-frame text-mode work or budget it from cycle
counts; do not estimate it by feel.

### Cross-references

- Technique: `text_mode_overlay_render`
- Related: `dirty_cell_skip_leaves_overlay_trail` (the bug that follows
  from fixing this by adding a dirty-cell cache to
  `render_field` instead of switching to an overlay pattern).

---

## petscii_written_to_screen_ram — PETSCII bytes stored in $0400 show graphics glyphs where the letters should be

**Severity:** high
**Region:** both
**Triggered by registers:** D018
**Triggered by techniques:** petscii_screen_code_conversion, text_input_line, decimal_print, password_encoding, high_score_table_insert, adventure_database_engine, text_window_and_menu, two_word_parser
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

---

## colour_ram_index_past_last_cell_hits_cia1 — A colour RAM index of 1,024 or more writes CIA1's registers, not colour RAM

**Severity:** high
**Region:** both
**Triggered by registers:** DC00, DC02, DC04, DC0D, DC0E
**Triggered by techniques:** tile_map_render, colour_cycling, colour_fade, screen_wipe, text_window_and_menu, text_mode_overlay_render, flip_screen_rooms, plasma, koala_format, char_scroll_buffer_h, difficulty_ramp_tables, fire_effect, screen_dissolve_lfsr, shadebobs

### Symptom

A colour fill or colour copy runs, the screen looks right, and
something unrelated stops. Which thing depends on how far the index
went and what value it carried. The jiffy clock freezes, the cursor
stops flashing and the keyboard goes dead; or the keyboard alone goes
dead while the joystick still reads; or a CIA-timed measurement returns
nonsense while the frame count stays plausible (the
`recipes/oscar64/difficulty-tables.md` build hit that last one: coins drawn on text
rows up to 28 put the colour writes at `$D800 + 1120` and beyond). No
cell on the screen is wrong, because every cell was written before the
index left the chip.

### Mechanism

The screen is 40 by 25, which is 1,000 cells, and colour RAM holds
them at `$D800` to `$DBE7`. The page it sits in, `$D800` to `$DBFF`, is
1,024 bytes long (arithmetic), so a fill whose 16-bit index is compared
against a page boundary, or a copy that moves four pages of 256 because
1,000 does not divide, writes 24 bytes past the last cell into the
spare colour RAM at `$DBE8` to `$DBFF`, which is harmless, and then
byte 1,024 lands at `$DC00`: CIA1. The next sixteen indices walk the
chip's sixteen registers in order, port A, port B, the two data
direction registers, timer A, timer B, the four time-of-day registers,
the serial register, the interrupt control register and the two control
registers. The registers repeat every 16 bytes to `$DCFF` (index 1,279),
so a longer overrun writes each of them again on every pass, and index
1,280 reaches CIA2.

What a single pass does was measured in VICE x64sc 3.10 (PAL) with a
fill of `$0E`, light blue, whose 16-bit index ran to 1,040. CIA1 before,
`$DC00` to `$DC0F`:

```text
7f ff ff 00  93 24 ff ff  00 00 00 01  00 00 01 08
```

After the fill:

```text
ff 7f 0e 0e  4e 21 0e 0e  0e 0e 0e 01  0e 00 0e 0e
```

Every register that reads back its written value now reads `$0E`.
Timer A read `$214E` on two samples about 600 cycles apart, where before
the fill the same two samples read `$2448` then `$2243`: the `$0E`
written to `$DC0E` has bit 0 clear, so timer A is stopped, and the `$0E`
written to `$DC0D` cleared the interrupt masks for timers B, the alarm
and the serial port. The KERNAL's jiffy clock at `$A2` advanced from
`$38` to `$4D` over a delay loop run before the fill and stayed at `$50`
over the same loop run after it. With no jiffy interrupt there is no
SCNKEY, so no key is read. `$DC02`, port A's data direction register,
reads `$0E`: only bits 1 to 3 drive, and a keyboard scan that then
selects every column by writing `$00` to `$DC00` reads `$F1` back from
the port, not `$00`. Bits 6 and 7 of `$DC01` now carry the timer outputs
(`$7F` after this run, `$3F` after an identical one), because the `$0E`
in both control registers set the port-B-on bit. The same fill with the
index stopped at 1,000 left all sixteen bytes as they were, timer A
counting (`$27C7` then `$256C`), and the column select reading `$00` from
`$DC00` and `$FF` from `$DC01`.

The most common fill value is `$00`, black, and it does its damage at
index 1,026: `$00` into `$DC02` turns every port A line into an input,
which is the state `cia1_ddr_cleared_kills_keyboard` in
`pitfalls/input.md` describes. Measured with a `$00` fill whose index
ran to 1,027: `$DC02` read `$00` after it, the timers were still running
(`$228A` then `$205A`), and the column select read `$FF` from `$DC00`
whatever was written to it, so the scanner's column drive is gone and the
keyboard is dead while the joystick, which grounds its lines, still
reads. A fill that runs to 1,136 rewrites the sixteen registers seven
times over; after it timer A read `$0E0E` on both samples, stopped and
reloaded from the latch the fill wrote (measured, same build).

The 24 spare bytes are real nibble RAM. After the `$0E` fill they read
`$0E` from `$DBE8` to `$DBFF`; after the `$00` fill they read `$00` in
21 places and `$F0` in three, the low nibble the value written and the
high nibble whatever the VIC last fetched, which changes from read to
read. With the index stopped at 1,000 they held what the machine came up
with (`02 0f f8 07 00 0f 04 0f 04 0f 05 0f 03 0e 00 0b`; a second boot
gave the same sixteen low nibbles under different high ones), because
the KERNAL's screen clear stops at 1,000 as well. Mask reads of this region
with `AND #$0F`; `hardware/c64-registers-reference.md` says the same.

### Fix

Bound the index at 1,000, not at a page boundary. A fill by rows, 25
rows of 40 with an 8-bit loop inside a row, cannot pass the last cell.
A fill that must be a single 16-bit loop compares the low byte against
`<1000` and the high byte against `>1000`, or counts four pages and
stops the last one at `$E8`. In a compiler, put the size in the type
(`char colour[25][40]`) or assert it (`static_assert(sizeof(map) ==
1000)` in Oscar64), and clamp any row index before it multiplies by 40:
row 25 is already the spare bytes, row 25 cell 24 onward is the CIA. If
a fill is allowed to run over on purpose, to 1,024 for a fast unrolled
copy, it must stop at 1,024 exactly, and the 24 bytes it writes past the
screen must not be counted on to hold a full byte.

### Worked example

Bad: a "fill four pages" loop, the shape a screen clear takes when the
programmer rounds 1,000 up. It writes `$DC00` to `$DC17` on its last
page.

```asm
// BAD: 4 x 256 = 1,024, and cell 1,000 onward is not colour RAM.
fill_colour_bad:
        lda #$0e
        ldx #$00
!:      sta $d800,x
        sta $d900,x
        sta $da00,x
        sta $db00,x          // stops at $dbff: the 24 spare nibbles, no harm
        inx
        bne !-
        rts
```

That form stops at `$DBFF` and is harmless. The one that reaches the
CIA is the 16-bit form, a pointer walked until the high byte turns
over, which is what the difficulty-tables build and the measured fill
above both did:

```asm
// BAD: meant to stop when the high byte reaches $dc; the compare is
// one page late, so all of $dc00-$dcff is written, CIA1 sixteen times.
fill_colour_bad16:
        lda #<$d800
        sta $fd
        lda #>$d800
        sta $fe
        ldy #$00
        lda #$0e
!:      sta ($fd),y
        iny
        bne !-
        inc $fe
        lda $fe
        cmp #$dd              // should be #$dc
        bne !-
        rts
```

Good: 25 rows of 40, and no index that can leave the chip. Run under
the same harness, this routine left all sixteen CIA1 bytes as the boot
had them (timer A still counting), wrote `$0E` to cell 0 and to cell
999 at `$DBE7`, and left `$DBE8` onward as it found it (measured, VICE
x64sc 3.10).

```asm
// GOOD: rows of 40, an 8-bit index inside each row.
fill_colour_good:
        lda #<$d800
        sta $fd
        lda #>$d800
        sta $fe
        ldx #25
        lda #$0e
!row:   ldy #39
!:      sta ($fd),y
        dey
        bpl !-
        pha
        clc
        lda $fd
        adc #40
        sta $fd
        bcc !+
        inc $fe
!:      pla
        dex
        bne !row-
        rts
```

### Cross-references

- **Sibling pitfall:** `cia1_ddr_cleared_kills_keyboard` in
  `pitfalls/input.md` is the state a `$00` fill leaves at index 1,026,
  reached there by a deliberate write; this entry is the same state
  reached by an index.
- **Hardware:** `hardware/c64-registers-reference.md`, the Color RAM
  section, for `$DBE8` to `$DBFF` (nibble RAM, high nibble undefined) and
  the I/O map that puts CIA1 at `$DC00`; `hardware/cia-reference.md` for
  what each of the sixteen registers does with the byte it is given.
- **Recipe:** `recipes/oscar64/difficulty-tables.md`, "A bug this page
  had": the overrun as it happened in a build, at `$D800 + 1120`.
- **Not measured here:** NTSC (the mechanism is address arithmetic and
  has no region term); a real key press after the overrun (the harness
  cannot press one; the keyboard consequence is read from the port bytes
  and from `cia1_ddr_cleared_kills_keyboard`); the CIA2 case at index
  1,280.

---

## vic_colour_register_upper_nibble_reads_set — A VIC colour register reads back as the colour plus 240, so a compare against the value written never matches

**Severity:** medium
**Region:** both
**Triggered by registers:** D020, D021, D022, D023, D024, D025, D026, D027, D028, D029, D02A, D02B, D02C, D02D, D02E, D016, D018, D019, D01A
**Triggered by techniques:** basic_extension_wedge

### Symptom

An `IF PEEK(53280)=2` that is false after `POKE 53280,2`. A
`cmp #2` after `lda $d020` whose branch is never taken. A colour saved
with `lda $d021` and used as a table index that reads 240 bytes past the
end of a sixteen-entry table. A "restore the border" routine that works,
because a write only takes the low four bits, while the compare in the
same program does not. Nothing crashes and nothing is drawn wrong; the
program takes the other branch, and the bug looks like logic.

The BASIC wedge recipe hit this on its first run: `&B 2` set the border
red, `IF PEEK(53280)=2 THEN` skipped its line, and the
verdict byte was never written.

### Mechanism

The VIC-II has four bits of storage behind each colour register
($D020 to $D02E). A write keeps the low nibble and drops the rest. A
read drives the low four bits from that storage and leaves the upper
four data lines undriven, and on this chip an undriven line reads as 1.
So every colour register reads back as the colour plus $F0 (240). VICE
models that as ones as well; measured below on both models, and the
audited `hardware/vic-ii-reference.md` says the same ("Only the low 4
bits matter; the upper 4 bits read as 1" under $D020, "Bits 7-4 read 1"
under $D021).

The same thing happens to every other unused VIC bit. Measured in the
same run: $D016 written $00 reads $C0 (bits 7-6), $D018 written $14
reads $15 (bit 0), $D019 reads with bits 6-4 set, and $D01A written $00
reads $F0 (bits 7-4). The hardware page marks each of those bits "read 1"
and agrees with the measurement. $D011 has no unused bit and read back
exactly what was written ($1B). $D01E and $D01F are eight full bits of
collision latch: both read $00 with no sprites on, and no bit reads set
there, so this pitfall does not touch them (their own trap is that the
read clears them, `sprite_priority_collision_silent` in
`pitfalls/sprite.md`). $D02F to $D03F have no register at all and read
$FF. Whether the upper nibble reads as 1 on every real VIC revision is
not measured here; VICE, both models, is what the table below shows.

### Fix

Mask before comparing: `and #$0f` after the read, or `(PEEK(53280)
AND 15)` in BASIC. If a colour is going to index a table, mask it first.
Better: keep a copy of each colour in RAM and never read the
register back; the register is write-only in effect, and a shadow byte
also survives a raster routine that changes the border mid-frame. A read
of a VIC colour register that is stored, compared or indexed without a
mask is wrong; a read that is written straight back to a colour register
is harmless, because the write drops the nibble again.

### Worked example

The fragment builds as written. The first compare is the bug; the
second is the fix.

```asm
// Bad: after a write of 2, $D020 reads $F2. Z is never set here.
        lda #2
        sta $d020
        lda $d020
        cmp #2
        beq bad_match          // never taken
        jmp keep_going
bad_match:
        inc $0400              // would show a glyph; it never does
keep_going:

// Good: mask the read, then compare the low nibble.
        lda $d020
        and #$0f
        cmp #2
        beq good_match         // taken
        jmp done
good_match:
        inc $0401              // the glyph appears
done:
        rts

// Better: a shadow byte, written once with the colour, is always exact.
border_shadow:
        .byte 2
```

The read-back measured in VICE 3.10 x64sc, `-model ntsc` and default
PAL, with the program above's write-and-read loop over every value.
Each register was written 0 to 15 and read straight back; the two
models gave identical bytes:

```text
register   written 0..15 reads back as
$D020-$D02E  240 241 242 243 244 245 246 247 248 249 250 251 252 253 254 255
                (all fifteen registers, PAL and NTSC; written value + 240)
$D020 <- 2, read, AND #$0F           -> 2
$D016 <- $08 / $C8 / $00, read       -> $C8 / $C8 / $C0   (bits 7-6 read 1)
$D018 <- $15 / $14, read             -> $15 / $15         (bit 0 reads 1)
$D019 read                           -> $71 PAL, $70 NTSC (bits 6-4 read 1;
                                        bit 0 is the raster latch, not an unused bit)
$D01A <- $00 / $0F / $01, read       -> $F0 / $FF / $F1   (bits 7-4 read 1)
$D011 <- $1B, read                   -> $1B               (no unused bit)
$D01E, $D01F read, sprites off       -> $00, $00          (no unused bit)
$D02F, $D03F read                    -> $FF, $FF          (no register)

BASIC, typed into the KERNAL buffer, PAL and NTSC:
POKE53280,2:PRINTPEEK(53280);PEEK(53280)AND15   ->  242  2
IF PEEK(53280)=2 THEN PRINT "EQ2"                ->  (nothing printed)
IF PEEK(53280)=242 THEN PRINT "EQ242"            ->  EQ242
POKE53281,3:PRINTPEEK(53281);PEEK(53281)AND15   ->  243  3
```

### Cross-references

- Technique: `basic_extension_wedge` (`techniques/text.md`), whose
  recipe hit this and masks with `AND 15`
- Recipe: `recipes/kickassembler/basic-wedge.md`, the run that found it
- Registers: `$D020` to `$D02E`, `$D016`, `$D018`, `$D019`, `$D01A`
  (`hardware/vic-ii-reference.md`; each entry marks the bits that read 1)
- Pitfall: `d016_unmasked_rmw_clobbers_csel_mcm` (`pitfalls/scroll.md`),
  the read-modify-write form of the same two bits on `$D016`
- Pitfall: `sprite_priority_collision_silent` (`pitfalls/sprite.md`),
  the read trap on `$D01E`/`$D01F`, which is clearing, not garbage
- Pitfall: `sid_write_only_registers` (`pitfalls/sid.md`), the
  neighbouring chip, where the whole byte is garbage rather than one
  nibble

## ecm_with_mcm_set_is_invalid_black_mode — Setting ECM while MCM is still on selects an invalid mode that draws the whole window black

**Severity:** medium
**Region:** both
**Triggered by registers:** D011, D016
**Triggered by techniques:** ecm_mode, mcm_text, raster_split_modes

### Symptom

The program switches a text screen to Extended Colour Mode and the
display window goes black. Not blank: black. The border keeps its
colour, the raster interrupts keep firing, and sprites still show, so
the machine is running. The four background bands the code set up are
not there, and neither are the glyphs. The game also keeps playing
against the invisible field: the sprite-to-background
collision bit still sets when a sprite crosses a glyph, and a sprite
set to run behind the playfield is still cut by the glyph pixels, which
are now the same black as everything round them.

The usual cause is a mode change. The previous screen was a
multicolour character screen, so `$D016` still holds `$D8` with MCM
(bit 4) set. The ECM screen's setup writes `$D011` with bit 6 and never
touches `$D016`, because ECM is a `$D011` mode and `$D016` is thought of
as "scroll and 38-column". ECM and MCM are now both
set, and that pair is not a mode.

### Mechanism

The VIC-II decodes its display mode from three bits: ECM (`$D011` bit
6), BMM (`$D011` bit 5) and MCM (`$D016` bit 4). Five of the eight
combinations are modes. The other three, every combination in which ECM
is set alongside BMM or MCM, are the invalid modes: the audited
`hardware/vic-ii-reference.md` lists ECM+MCM text, ECM+BMM and
ECM+BMM+MCM as "output is black", and says that in those modes "the
display sequencer still runs, but the pixel data output is forced to
black. Collisions and sprites still function."

The live collisions are the trap. The sequencer still classifies each
pixel as foreground or background, and the sprite unit still compares
against that classification for `$D01F` and for the `$D01B` priority
mask; only the colour lookup is replaced by black. So the picture
disappears while every part of the logic that reads the picture through
the VIC carries on as if it were there.

Measured in VICE 3.10 x64sc, PAL and NTSC, with a screen of four
character bands (codes 1, 65, 129, 193), white colour RAM, `$D021` to
`$D024` set to blue, green, red and yellow, a light blue border and one
solid white sprite parked over the second band. Setting `$D011` bit 6
with `$D016` at `$C8` gave the four coloured bands with white glyphs on
both models. Setting the same bit with `$D016` at `$D8` gave a window of
63,496 black pixels and 504 white ones, and the 504 are the 24 by 21
sprite. The border stayed light blue. `$D01F` read `$01` two frames
after the mode write and `$01` again a frame later, on both models, in
the black mode exactly as in the good one. With `$D01B` bit 0 set in
the black mode, 210 of the sprite's 504 pixels were black: the glyphs
under it still masked it. ECM with BMM (`$D011` written with bits 6 and
5) gave the same 63,496 black pixels and the same `$D01F` of `$01`.

Whether a real VIC of any revision matches VICE pixel for pixel in the
invalid modes is not measured here; the black output and the live
collisions are what the hardware page states and what the emulator
showed.

A mid-frame split that goes from a multicolour character zone to an ECM
zone meets the same pair for the cells between its two stores if it
writes `$D011` before `$D016`; `raster_split_modes` warns of an
"undefined intermediate mode" between the writes, and for this pair the
intermediate mode is black. How many cells that covers is not measured
here.

### Fix

Clear MCM before setting ECM, or in the same handful of cycles, and
never assume `$D016` from the last screen. Write the whole `$D016` byte
for the new screen (`$C8` for a 40-column, unscrolled ECM screen) rather
than leaving whatever the previous mode put there. For a
read-modify-write, `and #$EF` clears the bit without disturbing CSEL and
XSCROLL. In a raster split from multicolour text to ECM, store `$D016`
first and `$D011` second, so the only intermediate state is plain text
rather than black.

Write a sanity check into the setup routine during development: after
the mode writes, `lda $d011`, `and #$40`, and if it is set, `lda $d016`,
`and #$10`, which must be zero. Bits 7 and 6 of `$D016` read as ones
(`vic_colour_register_upper_nibble_reads_set` above), so mask before
comparing.

### Worked example

The fragment builds as written. The first block is the bug as it
arrives from a multicolour screen; the second is the fix.

```asm
// Bad: $D016 still holds $D8 from the multicolour text screen.
// Setting ECM on top of it selects the ECM+MCM invalid mode.
        lda #$d8               // MCM on, as the previous screen left it
        sta $d016
        lda $d011
        ora #$40               // ECM on: the window goes black
        sta $d011

// Good: put $D016 into its ECM-screen state first, then set ECM.
        lda #$c8               // MCM off, CSEL on, XSCROLL 0
        sta $d016
        lda $d011
        ora #$40               // ECM on: four background bands appear
        sta $d011

// Also good, when $D016 carries scroll state you want to keep.
        lda $d016
        and #$ef               // clear MCM only
        sta $d016
        lda $d011
        ora #$40
        sta $d011
        rts
```

The runs behind the table used the register writes above on a screen of
four bands with one white sprite at (100, 110). Each row is the bytes a
`-moncommands` trace dumped after the program stored them, followed by
the exit screenshot's pixel count over the 320 by 200 window. The two
models gave identical bytes and identical counts:

```text
variant                    $D011  $D016  $D01F   $D01F   window pixels (PAL and NTSC)
                                         +2 fr   +3 fr
plain text (control)        $1B    $C8    $01     $01    64,000 non-black: blue field, white glyphs
A: ECM, $D016 = $C8         $DB    $C8    $01     $01    64,000 non-black: blue/green/red/yellow bands
B: ECM, $D016 = $D8         $DB    $D8    $01     $01    63,496 black + 504 white (the sprite)
B with $D01B bit 0 set      $DB    $D8    $01     $01    63,706 black + 294 white (sprite cut by glyphs)
C: ECM + BMM, $D016 = $C8   $FB    $C8    $01     $01    63,496 black + 504 white (the sprite)
fix: $D016 -> $C8, then ECM $DB    $C8    $01     $01    64,000 non-black, identical to A

Border pixel (2, 100): light blue in every run, both models.
$D01E: $00 in every run (one sprite).
```

`$D016` reads back with bits 7 and 6 set, so `$C8` is the byte written
as `$C8` and also the byte written as `$08`; the low nibble is what the
table is about.

### Cross-references

- Technique: `ecm_mode` (`techniques/bitmap-modes.md`), which names
  ECM+BMM as invalid and is silent on ECM+MCM
- Technique: `mcm_text` (`techniques/bitmap-modes.md`), the screen that
  leaves MCM set on the way in
- Technique: `raster_split_modes` (`techniques/raster.md`), whose
  "undefined intermediate mode" between the `$D011` and `$D016` stores
  is this pair when the split runs from multicolour text to ECM
- Registers: `$D011`, `$D016` (`hardware/vic-ii-reference.md`, the mode
  table and "Illegal display modes")
- Pitfall: `d016_unmasked_rmw_clobbers_csel_mcm` (`pitfalls/scroll.md`),
  the other way to end up with the wrong MCM bit
- Pitfall: `sprite_priority_collision_silent` (`pitfalls/sprite.md`),
  the `$D01F` read that clears; the reads in the table were the only
  reads after the mode write
- Pitfall: `vic_colour_register_upper_nibble_reads_set` (this page), why
  the `$D016` check masks before comparing

---

## ctm_embedded_whole_shifts_charset — A CharPad `.ctm` embedded whole puts its header where glyph 0 should be and shifts every glyph

**Severity:** medium
**Region:** both
**Triggered by registers:** D018
**Triggered by techniques:** tile_map_render

### Symptom

The program points `$D018` at a charset the build embedded from the
artist's CharPad project file, and the screen is wrong everywhere at
once. If the program cleared the screen to code 0 itself, every cleared
cell shows the same small pattern, so the whole window is covered in
it. If it cleared through the KERNAL (`CHR$(147)`, or `$E544`), the
screen is full of `$20` instead, and that cell draws a mixture of two
other shifted glyphs, so the window reads as garbage rather than as one
repeated pattern (arithmetic from the shift below, not measured here).
The glyphs the program did print are there in outline but not as
drawn, each one a mixture of the tail of one source glyph and the head
of the next. Text
written with the same screen codes against a raw charset export comes
out right, so the codes and the `$D018` value are not the problem. Neither
the assembler nor the compiler reported anything.

### Mechanism

A `.ctm` is CharPad's save format, not a charset. The file opens with
the signature `CTM`, a version byte and a short fixed header, and then
the data sections; the character section is first, but it is not at
offset 0. On a version 8 file the header is 14 bytes and the character
section opens with a 2-byte marker and a 2-byte count, so the first
glyph row is at offset 18 (`$12`). The other versions put it elsewhere:
20 (`$14`) on version 5, which has no markers, and 23 (`$17`) on
version 9, whose header carries five extra grid bytes (both arithmetic
from the field tables in `formats/c64-file-formats.md`, not measured
here). After the glyphs come the materials, the optional tiles and the
map, so the file is also longer than the charset it holds.

Oscar64's `#embed "file"` and KickAssembler's `.import binary "file"`
both copy the file as written. The header lands on glyph 0, the marker
and count follow it, and every glyph after that sits 18 bytes late: two
whole glyphs and two rows. What the VIC draws for code `n` is the last
two rows of source glyph `n - 3` followed by the first six rows of
source glyph `n - 2`. Code 0, the code the rig below cleared the screen
to, draws the eight bytes `43 54 4D 08 00 00 00 0E`, which is `CTM`,
the version and the first half of the header, and that is the pattern
that covers the window. A KERNAL clear fills the screen with code 32,
which under the same shift is the last two rows of source glyph 29 and
the first six of glyph 30 (arithmetic, not measured here).

Measured on the windowless x64sc build of VICE 3.10, PAL, with a
synthetic version 8 file built in Python from the layout on the formats
page (no CharPad file exists on this machine): 64 glyphs, no tiles, a
40 by 25 map, 2,602 bytes, the same shape and size as the page's
`introfont.ctm` sample. Glyph 0 was blank, glyph 1 solid, glyph 2 a
checkerboard, glyph 3 a horizontal bar. The charset went to `$3000`
and `$D018` to `$1C`. A `-moncommands` trace on the store to `$D018`
dumped `$3000`:

- Oscar64 `#embed 2048 0 "font.ctm"`, and KickAssembler
  `.import binary "font.ctm"`, both gave `43 54 4D 08 00 00 00 0E 00
  0F 0C 09 08 07 DA B0 3F 00 00 00 00 00 00 00 00 00 FF FF FF FF FF
  FF`: header, marker, count, then glyph 0's zeros running into glyph
  1's `FF` rows two bytes late. Identical bytes from the two toolchains.
- Oscar64 `#embed 512 18 "font.ctm"` and KickAssembler
  `.import binary "font.ctm", 18, 512` both gave `00 00 00 00 00 00 00
  00 FF FF FF FF FF FF FF FF AA 55 AA 55 AA 55 AA 55 00 00 00 FF FF 00
  00 00`, the four glyphs as drawn.

The exit screenshots agree. The whole-file runs lit 14,086 pixels of
the 320 by 200 window with the screen cleared to code 0, and the code 0
cell itself lit 14 pixels; the eight cells printed with codes 0 to 7
lit 14, 20, 6, 48, 40, 24, 12 and 22. The skipped runs lit 332 pixels,
the code 0 cell lit none, and the same eight cells lit 0, 64, 32, 16,
16, 28, 8 and 8, which is blank, solid, checkerboard, bar, bar, box and
two diagonals. Those eight sum to 172, so 160 of the 332 lit outside
them; in the whole-file runs the 992 code 0 cells and the eight cells
account for 13,888 + 186 = 14,074 of the 14,086, leaving 12 (arithmetic
from the counts; what else the rig drew is not recorded here). Oscar64 and
KickAssembler gave the same counts as each other in both cases.

The bare `#embed "font.ctm"` did not compile into a sized array: with
`char Charset[2048]` Oscar64's first message was
`font.ctm(2049, 1) : error 3006: '}' expected`, followed by a run of
3037 and 3006 errors on the lines after it (the file's bytes past the
2,048 the array holds), and with `char Charset[]` inside a 2 KB region
it reported "Could not place object 'Charset'", size 2,602 against
2,048. The two
forms that build are the sized slice `#embed 2048 0`, which drops the
tail, and an unsized array in a region wider than 2 KB, which put the
same header at `$3000` and ran the data to `$3A2A`, 554 bytes into the
next charset bank. KickAssembler's whole import did the same: the
`.prg` for it was 12,843 bytes and the skipped one 10,753.

Within version 8 the character section is always first, so the 18-byte
skip is a constant for that version on the file built here; it is not
a constant across versions, and whether any CharPad option puts a
variable-length section before the characters is not measured here.

### Fix

Skip the container. In Oscar64, `#embed 2048 18 "font.ctm"` takes the
2 KB of glyphs from a 256-character version 8 file, or use the format-aware
`#embed ctm_chars "font.ctm"`, which reads the header and the markers
itself (versions 8 and 9 only; it takes a version 5 file without
complaint and returns the wrong bytes, see the formats page). In
KickAssembler, `.import binary "font.ctm", 18, $800`. Better than
either: have the artist export the raw charset (CharPad's "Characters
binary" export, per `art/asset-pipelines.md`, not measured here) and
embed that, so the build does
not carry the version-dependent offset at all; or strip the container
in a build step with the walker on the formats page. Check the version
byte before choosing an offset.

A guard for an existing build: read byte 0 of the charset bank
before pointing `$D018` at it, and stop if it is `$43`, the `C` of
`CTM`. A real glyph 0 can hold `$43` (it is a row of `01000011`), so
the check is a tripwire during development, not a proof.

### Worked example

The four embed lines with what each put at `$3000` (measured above):

```text
Oscar64:  #embed 2048 0  "font.ctm"    -> 43 54 4D 08 00 00 00 0E ...  header on glyph 0
Oscar64:  #embed 512 18  "font.ctm"    -> 00 00 00 00 00 00 00 00 FF FF ...  glyphs

KickAss:  .import binary "font.ctm"          -> 43 54 4D 08 ...  same 32 bytes as above
KickAss:  .import binary "font.ctm", 18, 512 -> 00 00 00 00 ... glyphs, same as above

The file built here holds 64 glyphs; a 256-glyph file takes 2048 in
place of 512 (arithmetic, not measured here).
```

The tripwire, which builds as written:

```asm
// Tripwire: refuse to switch charsets while the CTM header is on glyph 0.
.label charset = $3000         // the bank the build embedded into

        lda charset            // byte 0 of glyph 0
        cmp #$43               // 'C' of "CTM": the container came along
        beq container
        lda #$1c               // screen $0400, charset $3000
        sta $d018
        rts
container:
        inc $d020              // flash the border and stop
        jmp container
```

### Cross-references

- Format: `.CTM` in `formats/c64-file-formats.md`, the per-version
  header tables, the section order and the walker that prints each
  section's offset
- Toolchain: `#embed` in `toolchains/oscar64-reference.md`, the
  `LIMIT OFFSET` slice and the `ctm_chars` specifier;
  `.import binary` in `toolchains/kickassembler-reference.md`, the
  offset and length parameters
- Technique: `tile_map_render` (`techniques/scroll.md`), whose CharPad
  paragraph names the `ctm_*` specifiers; `table_generation`
  (`techniques/cpu-cycle-tricks.md`), the slice form on a host-built
  table
- Pipeline: `art/asset-pipelines.md`, "Charsets (.ctm from CharPad)",
  the raw export paths
- Register: `$D018` (`hardware/vic-ii-reference.md`)
