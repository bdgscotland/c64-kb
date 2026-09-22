---
category: scroll
chip: VIC-II
---

<!-- doc-type: technique-reference -->

# Scroll Techniques

The VIC-II provides two hardware scroll registers that shift the visible
display area up to 7 pixels in either axis without touching screen RAM.
Used alone, each register gives only eight positions — seven pixels of
travel — before it wraps (an earlier version said "one pixel of range per
frame", conflating the range with the 1 px/frame step rate). The real power comes from combining the hardware offset with
timed screen-RAM rotation: the hardware register handles sub-character
granularity while a CPU-side copy updates the coarser character grid. The
techniques in this document cover the full range from a single-axis
1-pixel-per-frame scroller to parallax depth effects and bitmap-mode
horizontal panning.

---

## soft_scroll_h — Hardware horizontal soft-scroll

**Complexity:** low
**Region:** both
**Uses registers:** D016
**Uses kernal:** (none)

### Why

Games and demos frequently need to shift the entire display left or right
by one pixel at a time — a news ticker, a side-scrolling landscape, a
credit scroll. Doing this by rewriting every byte of screen RAM each frame
is prohibitively expensive. The VIC-II's $D016 XSCROLL field solves this
by shifting the pixel output pipeline before it reaches the border logic,
so the chip does the work in hardware at zero CPU cost per pixel column.

### How

$D016 bits 2-0 (XSCROLL) hold a three-bit fine-scroll offset. Each frame,
increment (or decrement) the stored XSCROLL value and write the new three
bits into $D016, preserving the CSEL and MCM bits in bits 3 and 4. The
display shifts by the number of pixels indicated without any change to
screen RAM or color RAM.

XSCROLL = n places the display n pixels to the RIGHT of the character grid
(measured in VICE x64sc: a block at column 0 sat at x 32-39 with XSCROLL=0
and at x 36-43 with XSCROLL=4). An earlier version of the next two
paragraphs had the directions reversed.

To move the display content to the right, increment XSCROLL each frame:
0 → 1 → 2 → ... → 7, then roll to 0 and simultaneously shift the
screen-RAM columns one character to the right.

To move the display content to the left (the usual "scrolling" direction
for a ticker), decrement XSCROLL: 7 → 6 → ... → 0, then roll to 7 and
shift screen-RAM one column to the left.

The XSCROLL = 0 case produces no visual shift relative to the character
grid. XSCROLL = 7 shifts seven pixels, placing the display one pixel
short of a full character-width offset.

### Why it works

The VIC-II's horizontal pixel sequencer ordinarily starts drawing at a
fixed position aligned to the character grid. XSCROLL delays the start of
the visible area within each 8-pixel character cell by the specified number
of clock cycles (one clock per pixel). Because the delay applies globally
to the entire display, every column shifts uniformly. The border logic and
the display-window start position are unaffected, so the column count
remains 40 and the visible width is unchanged.

### Variations

- **Single-pixel tick:** Change XSCROLL by 1 each frame for 1 px/frame.
- **Multi-pixel skip:** Advance XSCROLL by 2 or 3 per frame for faster
  scrolling; just handle the boundary rollover at the correct modulus.
- **Bidirectional toggle:** Store scroll direction in a flag and negate
  the increment to reverse at runtime.

### Cycle budget

Writing $D016 costs 6 cycles (LDA #imm 2 + STA abs 4; an earlier version
said 4). Preserving CSEL, MCM and RES from a shadow byte — LDA shadow /
AND #$F8 / ORA new / STA $D016 — is 11-14 cycles depending on whether the
shadow and new value are immediate, zero-page or absolute (cycle counts
from `docs/hardware/6510-cpu-reference.md`). This technique has no
raster-critical timing requirement.

### Recipes

- `recipes/oscar64/soft-scroll-h.md`

---

## soft_scroll_v — Hardware vertical soft-scroll

**Complexity:** low
**Region:** both
**Uses registers:** D011
**Uses kernal:** (none)

### Why

Vertical soft-scroll is the companion to horizontal: shift the entire
displayed raster up or down by up to 7 pixels without rewriting screen
RAM. Commonly used for vertical credits, FLD split-screen effects, and
as one axis of a two-dimensional smooth-scroller.

### How

$D011 bits 2-0 (YSCROLL) hold a three-bit fine-scroll offset. Each frame,
write the new YSCROLL value into $D011, preserving the DEN, RSEL, RST8,
ECM, and BMM bits. The visible window shifts by the specified number of
raster lines.

The default YSCROLL value after KERNAL initialisation is 3. Decrementing
YSCROLL moves the display upward; incrementing moves it downward (the
reference point is the top of the character row, so larger values push
content down).

When YSCROLL reaches 0 and a further upward shift is needed, reset
YSCROLL to 7 and shift the screen-RAM rows one row upward (see
`char_scroll_buffer_v`). For downward scrolling, the symmetrical
procedure applies.

### Why it works

The VIC-II's vertical display window start is fixed relative to the
badline condition. A badline fires when the bottom three bits of the
current raster line match YSCROLL (and the line is within the active
region). By decrementing YSCROLL, you retard the point at which the chip
believes the first row of each character tile begins, which slides the
displayed image upward by one raster line. The effect is a pure hardware
shift with no pixel-by-pixel CPU work.

**Critical side effect:** changing YSCROLL shifts the entire set of
badlines for the current frame. Because a badline costs the CPU 40 to 43
of the line's 63 cycles (the VIC holds the bus for cycles 15-54, and BA
drops three cycles earlier at cycle 12, where the CPU halts on its first
read; ordinary code therefore keeps only 20 cycles on a badline — an
earlier version said "up to 40"), smooth-scrolling code that changes YSCROLL must
ensure any time-sensitive raster IRQ code is written to tolerate the
resulting change in badline positions. This is most relevant when
combining vertical scroll with raster split bars.

### Variations

- **FLD (Flexible Line Distance):** Change YSCROLL mid-frame inside a
  raster IRQ to open or close extra blank lines between rows, stretching
  the picture vertically. This technique is built on top of soft_scroll_v.
- **Row hold:** Set YSCROLL to 0 and hold it to keep the display
  "bottom-aligned" within each character row, which shifts the apparent
  top of the screen upward 3 pixels from the KERNAL default.

### Cycle budget

Writing $D011 requires a careful read-modify-write to preserve the mode
bits. The safest pattern is: LDA yscroll_shadow, AND #$F8, ORA new_yscroll,
STA $D011 — 12-14 cycles (3 + 2 + 3 + 4 with zero-page operands, 14 with
absolute ones; an earlier version said 10-12). Because changing YSCROLL inside a visible
raster can produce glitches, the write should happen during the vertical
blank or in a stable raster window above line $30.

### Recipes

- No recipe yet for vertical soft scroll; `recipes/oscar64/soft-scroll-h.md` is the horizontal counterpart.

---

## char_scroll_buffer_h — Char-mode horizontal scroll with screen-RAM buffer rotation

**Complexity:** medium
**Region:** both
**Uses registers:** D016
**Uses kernal:** (none)

### Why

The hardware XSCROLL register only provides a 0-7 pixel range. Scrolling
a character-mode display continuously requires advancing the content by
one full character column (8 pixels) at the moment XSCROLL would overflow.
This technique handles that overflow by rotating screen RAM and color RAM
in memory, effectively carrying new character data onto the visible edge
while resetting XSCROLL to maintain seamless motion.

### How

The display is backed by a 40×25 text screen (1000 bytes) and a parallel
40×25 color RAM at $D800 (1000 nibbles). To scroll left by one character
column:

1. Copy columns 1-39 of each row to columns 0-38 (memmove of 39 bytes
   per row, or equivalently shift the entire 1000-byte screen window left
   by one byte taking care at the row boundary).
2. Write fresh data into column 39 (the new rightmost column) from an
   off-screen content buffer.
3. Repeat the same move on color RAM at $D800.
4. Reset XSCROLL to 7 in $D016 (it has just wrapped from 0; the column
   move cancels the 8-pixel snap). An earlier version of this step said
   "reset to 0", which produces an 8-pixel jump every eighth frame.

The net result: the visible content has shifted one full character to the
left, and XSCROLL is back at 7 ready for the next seven single-pixel steps
down to 0.

For scrolling right, mirror the process: copy columns 0-38 to columns
1-39, write fresh data into column 0, reset XSCROLL to 0 (it has just
wrapped from 7). This matches the `if (xscroll == 0) { shift; xscroll = 7; }`
form in `recipes/oscar64/soft-scroll-h.md`.

### Why it works

The hardware XSCROLL shift and the software screen-RAM shift are
complementary. The hardware provides fractional (sub-character) precision;
the software provides whole-character carries. When the two are reset
atomically in the same frame, the viewer sees a seamless stream of 1-pixel
steps even though the underlying mechanism alternates between a hardware
shift and a memory copy.

### Variations

- **Double-buffered screen RAM:** Maintain two screen-RAM pages and
  alternate which one $D018 points to, avoiding tearing on fast machines.
- **Unrolled move:** On stock C64 there is no DMA. Unrolling the copy
  into straight LDA abs / STA abs pairs brings it to 8 cycles per byte
  (8,000 cycles for 40×25), which still exceeds the off-screen span on
  both PAL (~7,056 cycles) and NTSC (~4,095); unrolling reduces the cost,
  it does not make the move fit in the blank. An earlier version of this
  item claimed the unrolled move "can complete inside the vertical blank".
- **Wide content ring buffer:** Keep the source content in a ring buffer
  wider than 40 columns. Advance the ring pointer each time a column shift
  fires instead of precomputing content on demand.

### Cycle budget

A naive byte-by-byte shift of 1000 bytes at roughly 10 cycles per
byte costs ~10,000 cycles. PAL has 63 × 312 = 19,656 cycles per frame
minus ~25 × 43 = 1,075 badline-stolen cycles for a CPU budget of ~18,581
cycles per frame. The screen shift alone therefore consumes about 54% of
the frame budget. The color RAM shift doubles that cost to ~108%. This
means a brute-force shift must be overlapped across multiple frames or
replaced with a DEC-and-pointer approach. An unrolled inner loop using
indexed addressing and/or a 2-byte-per-iteration pattern roughly halves
the cycle count.

### Recipes

- `recipes/oscar64/soft-scroll-h.md`

---

## char_scroll_buffer_v — Char-mode vertical scroll

**Complexity:** medium
**Region:** both
**Uses registers:** D011
**Uses kernal:** (none)

### Why

The hardware YSCROLL register provides only a 0-7 raster-line range.
Continuous vertical scrolling requires a software carry to advance the
content by one full character row (8 raster lines) when YSCROLL overflows.
This technique handles that carry via a screen-RAM row shift, mirroring
`char_scroll_buffer_h` in the vertical axis.

### How

To scroll upward by one row (content moves up, new row appears at the
bottom):

1. Copy rows 1-24 of screen RAM to rows 0-23. Because a row is 40 bytes,
   this is a memmove of 40 × 24 = 960 bytes from offset 40 to offset 0.
2. Write a fresh 40-byte row into row 24 from the content source.
3. Perform the same move on color RAM at $D800.
4. Reset YSCROLL to 7 in $D011 (or to the value it had before it
   decremented to -1).

For scrolling downward, copy rows 0-23 to rows 1-24, write row 0 from
the source, and reset YSCROLL to 0.

The row shift should be performed while the VIC is not fetching display
data, or spread across raster interrupts, to avoid visible tearing. The
row shift does not fit in the blanking period (an earlier version said it
did). Even fully unrolled as LDA abs / STA abs it costs 8 cycles per byte
— 960 × 8 = 7,680 cycles for screen RAM alone, doubled again for colour
RAM — against an off-screen span of only 112 lines × 63 = 7,056 cycles on
PAL (lines 251-311 and 0-50) and 63 × 65 = 4,095 on NTSC; the hardware
vertical blank proper (PAL lines 300-15) is far smaller still. Production
scrollers therefore spread the move across the frames between carries,
shift only the rows that scroll, or write the shifted copy into a second
screen page during the active frame and flip $D018 in the border.

### Why it works

Same principle as the horizontal case. The hardware YSCROLL field provides
fine alignment within the current character row. The software row shift
provides the coarser row-level carry. Together they produce continuous
pixel-level motion.

### Variations

- **FLD combined scroll:** Use soft_scroll_v during most of the frame
  and trigger the screen-RAM row shift only when the YSCROLL carry fires.
  FLD effects (flexible line distance) can be applied to individual rows
  during the same IRQ pass.
- **Map streamer:** Instead of pre-constructing content in a buffer,
  decode map data on the fly into the newly exposed row. This is the
  approach used by most C64 platformers.

### Cycle budget

A 960-byte row shift at ~10 cycles per byte costs ~9,600 cycles (7,680
fully unrolled). Between the last display line (250, RSEL=1) and the
first badline of the next frame (48 + YSCROLL) there are no badlines and
no character/bitmap fetches: with the default YSCROLL=3 that is lines
251-311 and 0-50, 112 raster lines = 7,056 cycles on PAL; because this
technique itself drives YSCROLL through 0-7, the span guaranteed at every
scroll position is lines 251-311 and 0-47, 109 lines = 6,867 cycles
(VICE shows the first badline at 48, 51 and 55 for YSCROLL 0, 3 and 7;
window and badline bounds from `docs/hardware/vic-ii-reference.md`). Only
lines 300-15 are vertical blanking in the video sense — 28 lines, 1,764
cycles (`docs/hardware/pal-ntsc-reference.md`); the rest of the span is
visible border, which is equally free of display DMA. Enabled sprites
still take their DMA in these lines. An earlier version of this paragraph
offered a 3,780-cycle "vertical blank" of lines 300-311 + 0-47 "of which
many are non-badline"; no line in that span is a badline. Since the shift
does not fit in the off-screen span, spread it across several frames or
use a double-buffer scheme where row 24 is pre-populated during the next
frame's active display period.

### Recipes

- No recipe yet for vertical soft scroll; `recipes/oscar64/soft-scroll-h.md` is the horizontal counterpart.

---

## infinite_scroll_h — Combine soft + buffer for continuous horizontal scroll

**Complexity:** medium
**Region:** both
**Uses registers:** D016
**Uses kernal:** (none)
**Requires:** soft_scroll_h, char_scroll_buffer_h

### Why

`soft_scroll_h` alone stops after 7 pixels. `char_scroll_buffer_h` alone
produces only character-column-resolution jumps. Combining both into a
unified scroll engine yields genuinely seamless 1-pixel-per-frame
continuous horizontal scrolling, which is the backbone of virtually every
C64 side-scroller and horizontal text scroller.

### How

Maintain two state variables: a pixel-level scroll counter (0-7) and a
character-level content pointer into an off-screen map buffer.

Each frame, inside a vertical-blank or raster IRQ:

1. Decrement (or increment) the pixel counter.
2. Write the pixel counter into XSCROLL in $D016.
3. If the pixel counter has rolled over (crossed 0 for leftward scroll,
   or crossed 7 for rightward):
   a. Shift screen RAM one column in the scroll direction.
   b. Populate the newly exposed column from the map buffer at the
      current content pointer.
   c. Advance the content pointer by one column.
   d. Advance the color RAM column the same way.
4. Increment the frame counter for timing.

The pixel counter and the screen-RAM shift are always in sync. The viewer
sees a smooth stream of 1-pixel advances — the hardware register handles
sub-character motion, the software carry handles character-boundary
transitions.

### Why it works

The VIC-II draws each frame from the fixed content of screen RAM, offset
by XSCROLL. Changing XSCROLL by 1 between frames produces a 1-pixel shift.
When XSCROLL wraps, the 1-pixel offset becomes 0 (aligned to the grid
again). Without the screen-RAM shift, the content would snap back 8 pixels
at the wrap. With the shift, the screen RAM has already advanced by one
column, exactly canceling the wrap reset. The visual result is a perfectly
continuous sub-pixel stream.

### Variations

- **Variable speed:** Increment XSCROLL by more than 1 per frame (2, 3,
  or 4) to double, triple, or quadruple scroll speed. At 8 px/frame the
  software and hardware components become decoupled — just shift the screen
  each frame and skip the fractional register entirely.
- **Reversed direction:** All the same logic applies rightward; the only
  difference is the direction of the XSCROLL ramp (0→7 instead of 7→0)
  and the direction of the screen-RAM column copy.
- **Speed modulation:** For smooth acceleration and deceleration
  (ease-in / ease-out), store the current speed as a fixed-point number
  and accumulate it into the pixel counter, firing a carry whenever it
  crosses a character boundary.

### Cycle budget

The per-frame cost is dominated by the occasional screen-RAM column shift,
which fires once every 8 frames at 1 px/frame. Amortized over 8 frames
on PAL (50 Hz), the average cost per frame is approximately 1,000 / 8 ×
10 cycles = ~1,250 cycles amortized from screen copy, plus ~10 cycles per
frame for the XSCROLL write. This is comfortably within budget for a
game that can afford ~18,000 CPU cycles per frame.

### Recipes

- `recipes/oscar64/soft-scroll-h.md`

---

## parallax_dual_layer — Char + sprite layered scroll at different speeds

**Complexity:** high
**Region:** both
**Uses registers:** D016, D000-D00F, D010
**Uses kernal:** (none)
**Requires:** infinite_scroll_h

### Why

A single-plane scroller looks flat. Parallax — different screen layers
moving at different speeds — creates a strong illusion of depth. The C64
achieves this by running two conceptually separate scroll systems in the
same frame: the character-mode background scrolls at one rate, while
sprite-rendered foreground objects move at a different (usually faster)
rate. The viewer perceives the foreground as being closer because it moves
more quickly across the visual field.

### How

Divide the scene into two logical layers.

**Background layer:** the character-mode screen scrolled via `infinite_scroll_h`
(or the vertical equivalent). Each frame, advance XSCROLL by the background
speed and carry to the screen-RAM column shift when needed.

**Foreground layer:** hardware sprites. Each frame, update each sprite's
X position by the foreground speed. For a leftward-scrolling foreground
faster than the background, decrement each sprite's X position by more
pixels per frame than the background moves (sprite X grows to the right;
an earlier version said "increment"). When a sprite's X coordinate drops
below the left edge, wrap it to the right edge and update its content
pointer to the next foreground object.

Sprite X positions are set via $D000 (sprite 0 X low byte), $D002, $D004,
$D006, $D008, $D00A, $D00C, $D00E for sprites 0-7 respectively. Because
the X coordinate is 9 bits, the MSB for all eight sprites is packed into
$D010 (MSIGX), one bit per sprite. When a sprite's X coordinate exceeds
255, set its bit in $D010; when it drops below 256, clear it.

Typical speed ratios are 2:1 (foreground at 2 px/frame, background at 1
px/frame) or 4:1. The larger the ratio, the stronger the depth cue.

### Why it works

The VIC-II renders sprites on top of (or behind, if the sprite priority
bit is clear) the character background in the same frame. Because the chip
reads sprite data independently of character data, there is no coupling
between the two position systems. The background XSCROLL affects only the
character rendering pipeline; sprite positions are absolute screen
coordinates and are unaffected by XSCROLL. Advancing them at a different
rate than the background produces the parallax effect entirely at the
hardware level.

### Variations

- **Three-layer parallax:** Add a second character plane using a split-screen
  raster IRQ — the top half of the screen uses one $D018 character base,
  the bottom half uses another, with independent scroll variables for
  each half.
- **Sprite foreground at 4x speed:** At 4 px/frame a foreground object
  crosses the 320-px screen in 80 frames — 1.6 s on PAL — against 6.4 s
  for a 1 px/frame background, a 4:1 depth cue that convincingly simulates
  fast-moving near objects (bullets, sparks, foreground pillars). An
  earlier version claimed "25 full-screen traversals per second", which
  would need 160 px per frame.
- **Sprite-multiplexed deep parallax:** Combine a sprite multiplexer
  (`sprite_multiplex_8`, or `sprite_multiplex_24` for larger counts — see
  `docs/techniques/sprite.md`) with parallax to field more than 8 visible
  foreground objects at different parallax depths.

### Cycle budget

Per-frame sprite update cost: for N sprites, update the X low byte, check
the MSB threshold, and conditionally flip the $D010 bit. Roughly
16 cycles per sprite for the conditional MSB path. Eight sprites: ~128
cycles. Background scroll update: ~10 cycles for the XSCROLL write plus
the amortized ~1,250-cycle column shift (once per 8 frames). A
two-layer scene at 2:1 ratio costs approximately 150 cycles per frame
in positional math plus the occasional carry. Well within PAL budget.

### Recipes

- No recipe yet for parallax layers.

---

## bitmap_scroll — Bitmap-mode scroll via $D016 + bitmap shuffling

**Complexity:** high
**Region:** both
**Uses registers:** D011, D016, D018
**Uses kernal:** (none)

### Why

Bitmap mode gives pixel-level control over every dot on the screen —
320×200 in standard single-color mode, 160×200 in multicolor mode. Some
demos and games want to scroll a pixel-accurate drawn scene rather than
a character-based one. This is fundamentally harder than character-mode
scrolling because there is no sparse screen-RAM grid to rotate; the entire
8000-byte bitmap must be shifted, or an expensive double-buffer strategy
must be used.

### How

There are two viable approaches. Both use $D016 XSCROLL for fine-scroll
and $D011 YSCROLL for fine vertical scroll, exactly as in character mode.
The difference is how the coarser carry is handled.

**Approach 1 — memshift per frame.**

When the hardware XSCROLL register wraps (after 8 sub-pixel steps), shift
the entire 8000-byte bitmap left by one cell. The standard bitmap is 8000
bytes laid out as 25 bands (one per character row) × 40 cells × 8 bytes;
the 8 bytes of a cell are its 8 scanlines, so cell (col,row) starts at
(row*40+col)*8 and the cell to its right is 8 bytes further on (layout
from `docs/techniques/bitmap-modes.md`; an earlier version of this
paragraph gave "40 columns × 200 rows × 8 bytes", which is 64,000 bytes,
and "one byte per 8-row band"). Shifting the picture left by one cell
therefore moves every 8-byte cell to the cell before it — a memmove of the
whole 8000-byte bitmap down by 8 bytes — after which the last cell of each
of the 25 bands (40 × 8 = 320 bytes per band) is redrawn from source; the
1000-byte screen RAM (and Color RAM in multicolor mode) shifts by one byte
in step.

For vertical scrolling by one character row, the coarse carry is one
band: move the bitmap up by 320 bytes (40 cells × 8 bytes = one row of
characters, 8 raster lines) — a 7,680-byte memmove — and refill the
bottom 320 bytes. An earlier version said "40 bytes", which shifts by
five cells horizontally within the same band, not by one row. The
screen-RAM attribute matrix (1000 bytes) moves by 40 bytes at the same
time, and in multicolor bitmap mode colour RAM at $D800 moves by 40 bytes
as well. Note that a vertical shift of fewer than 8 lines is not a
memmove at all — each scanline byte moves within its own cell, and line 0
of a cell takes line 7 of the cell in the band above — which is why
bitmap scrollers carry vertically by whole bands and use YSCROLL for the
intermediate lines.

Cycle cost: an 8000-byte shift at ~10 cycles per byte = ~80,000 cycles.
PAL provides ~18,500 CPU cycles per frame (after badlines). An 8000-byte
shift is approximately 4.3 frames of CPU time at full speed. This approach
is not viable at 50 Hz for a full-screen scrolling bitmap without
significant compromises.

**Approach 2 — double-buffer with $D018 page flip.**

Maintain two 8000-byte bitmap buffers at offsets $0000 and $2000 of the
VIC bank. Use bank 1 ($4000-$7FFF) or bank 3 ($C000-$FFFF): in banks 0
and 2 the VIC sees character ROM at bank offset $1000-$1FFF (CPU $1000 /
$9000), which lands inside the low bitmap page
(`docs/hardware/vic-ii-reference.md`, character ROM shadowing). In bank 3
the low page spans $D000-$DFFF, which the CPU sees as I/O, so the CPU
must bank I/O out via $01 (e.g. $34) while writing that page. An earlier
version of this section named $8000, which is one of the banks that does
not work. Each frame, render
(draw and scroll) into the invisible back buffer, then toggle $D018 to
flip the two buffers at the start of vertical blank. This prevents tearing
and decouples the rendering time from the frame deadline — as long as
rendering completes before the vertical blank of the target frame.

$D018 bits 7-4 select the 1 KB video matrix within the VIC bank (screen
RAM in text mode; in bitmap mode it holds the per-cell
foreground/background colour nibbles). Bits 3-1 select the 2 KB character
generator in text mode; in bitmap mode only bit 3 matters: 0 puts the
8000-byte bitmap at bank offset $0000, 1 at $2000, and bits 2-1 are
ignored. Toggling bit 3 of $D018 therefore switches between the two
bitmap pages. (An earlier version of this paragraph described the video
matrix as "the character generator pointer in text mode" and never said
what it holds in bitmap mode.)

Even with double buffering, filling 8000 bytes per frame is expensive.
Practical scrolling bitmap scenes either reduce the scrolling area to a
sub-screen viewport, use hardware XSCROLL + YSCROLL to cover most frames
with no pixel work, and only do the 8000-byte shift once every 8 frames
when the coarse carry fires.

### Why it works

The VIC-II treats the bitmap as a contiguous region of video memory. XSCROLL
and YSCROLL shift the rendering pipeline's start position within each
8×8 cell exactly as in character mode. The fine-scroll mechanism is
identical. The cost difference is in the carry: where character mode
carries by rotating 1000 bytes of screen RAM, bitmap mode must carry by
rotating 8000 bytes of raw pixel data. The $D018 page-flip trick avoids
moving pixel data altogether by pointing the VIC at a different memory
region, leaving the shifting work to the back-buffer renderer which runs
across multiple cycles asynchronously.

### Variations

- **Reduced viewport:** Apply bitmap scrolling only to a horizontal strip
  (e.g., the bottom 100 rows). Use a raster IRQ to switch $D018 or the
  display mode at the viewport edge. This halves the bitmap size and
  memory requirement.
- **Sprite overlay on bitmap:** Hardware sprites work the same way in
  bitmap mode. Combine with `parallax_dual_layer` — sprite foreground
  objects at a faster rate over a slow-scrolling bitmap background.
- **Vertical bitmap scroll only:** Shifting 8000 bytes vertically is the
  same cost as horizontally, but the double-buffer flip approach works
  equally well. Vertical-only bitmap scroll is somewhat more common in
  intros because vertical motion on a bitmap preserves horizontal
  compositional alignment better than horizontal motion.

### Cycle budget

Fine-scroll step (XSCROLL or YSCROLL write only, no carry): ~10 cycles.

Coarse carry, memshift approach (fires once per 8 frames at 1 px/frame):
8000 bytes × 10 cycles/byte = 80,000 cycles. Spread across 8 frames:
10,000 cycles/frame average, or ~54% of the PAL per-frame budget.
The colour carry must move in lockstep with the pixel carry: the
1000-byte video matrix (each byte holds the cell's foreground and
background nibbles), plus the 1000 nibbles at $D800 in multicolour bitmap
mode — a further ~10,000-20,000 cycles per coarse step, about an eighth
to a quarter of the bitmap shift. (An earlier version spoke of a
"4000-byte" colour array; there are 40 × 25 = 1000 cells and no
4000-entry structure anywhere in the VIC.) Combined, the overhead is
practical only for slow-scrolling backgrounds or sub-screen viewports.

Double-buffer approach: the page flip itself costs ~10 cycles ($D018
write). The rendering work (clearing and redrawing the 8000-byte back
buffer) is the real budget item and is scene-specific.

### Recipes

- No recipe yet for bitmap scrolling.
