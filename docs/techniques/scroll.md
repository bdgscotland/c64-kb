---
category: scroll
chip: VIC-II
---

<!-- doc-type: technique-reference -->

# Scroll Techniques

The VIC-II provides two hardware scroll registers that shift the visible
display area up to 7 pixels in either axis without touching screen RAM.
Used alone, each register gives only eight positions (seven pixels of
travel) before it wraps (an earlier version said "one pixel of range per
frame", conflating the range with the 1 px/frame step rate). Continuous scrolling combines the hardware offset with
timed screen-RAM rotation: the hardware register handles sub-character
granularity while a CPU-side copy updates the coarser character grid. The
techniques below run from a single-axis
1-pixel-per-frame scroller to parallax depth effects and bitmap-mode
horizontal panning.

---

## soft_scroll_h — Hardware horizontal soft-scroll

**Complexity:** low
**Region:** both
**Uses registers:** D016
**Uses kernal:** (none)
**Cost:** cycles_per_frame=7938
**Cost basis:** measured-vice
**Cost measured on:** oscar64-soft-scroll-h (carry frame: an unrolled 25-row move of screen RAM, colour RAM not moved)
**Cost includes:** char_scroll_buffer_h

### Why

Games and demos often shift the entire display left or right by one
pixel at a time: a news ticker, a side-scrolling landscape, a credit
scroll. Rewriting every byte of screen RAM each frame for this is too
expensive. The VIC-II's $D016 XSCROLL field shifts the pixel output
pipeline before it reaches the border logic,
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
  scrolling; handle the boundary rollover at the correct modulus.
- **Bidirectional toggle:** Store scroll direction in a flag and negate
  the increment to reverse at runtime.

### Cycle budget

Writing $D016 costs 6 cycles (LDA #imm 2 + STA abs 4; an earlier version
said 4). Preserving CSEL, MCM and RES from a shadow byte (LDA shadow /
AND #$F8 / ORA new / STA $D016) is 11-14 cycles depending on whether the
shadow and new value are immediate, zero-page or absolute (cycle counts
from `docs/hardware/6510-cpu-reference.md`). This technique has no
raster-critical timing requirement.

The Cost line's 7,938 cycles is not the register write. It is the carry
frame of `recipes/oscar64/soft-scroll-h.md`, measured there in VICE: an
unrolled `LDA abs` / `STA abs` move of all 25 rows of screen RAM. It is
more than the PAL blank (6,741 cycles after line 256), so the recipe moves
the rows top first and finishes each before the beam reaches it (row 24 at
line 82 on PAL). An earlier Cost line said 74,041 cycles: the recipe's
earlier `memmove` of screen and colour RAM, 3.8 PAL frames, which tore.

### Recipes

- `recipes/oscar64/soft-scroll-h.md`

---

## soft_scroll_v — Hardware vertical soft-scroll

**Complexity:** low
**Region:** both
**Uses registers:** D011
**Uses kernal:** (none)
**Claims:** none
**Claims basis:** derived-listing

`none` is read off `recipes/kickassembler/scroll-panel-split.md`: the
technique writes only `$D011` bits 0-2 (YSCROLL) and keeps bit 7, and no
seeded HardwareUnit holds YSCROLL. Beside another YSCROLL writer such as
`fld_flexible_line_distance` the compatibility check reports only the
soft `shared_register` on `$D011`, never an ownership conflict
([#71](https://github.com/bdgscotland/c64-kb/issues/71)).

### Why

Vertical soft-scroll shifts the entire displayed raster up or down by up
to 7 pixels without rewriting screen RAM. Used for vertical credits, FLD split-screen effects, and
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
region). Decrementing YSCROLL moves the point at which the chip starts the first
row of each character tile, which slides the displayed image upward by
one raster line. The shift is done in hardware with no pixel-by-pixel
CPU work.

**Critical side effect:** changing YSCROLL shifts the entire set of
badlines for the current frame. Because a badline costs the CPU 40 to 43
of the line's 63 cycles (the VIC holds the bus for cycles 15-54, and BA
drops three cycles earlier at cycle 12, where the CPU halts on its first
read; ordinary code therefore keeps only 20 cycles on a badline; an
earlier version said "up to 40"), smooth-scrolling code that changes YSCROLL must
ensure any time-sensitive raster IRQ code is written to tolerate the
resulting change in badline positions. This is most relevant when
combining vertical scroll with raster split bars.

### Variations

- **FLD (Flexible Line Distance):** Change YSCROLL mid-frame inside a
  raster IRQ to open or close extra blank lines between rows, stretching
  the picture vertically. It builds on soft_scroll_v.
- **Row hold:** Set YSCROLL to 0 and hold it to keep the display
  "bottom-aligned" within each character row, which shifts the apparent
  top of the screen upward 3 pixels from the KERNAL default.

### Cycle budget

Writing $D011 requires a careful read-modify-write to preserve the mode
bits. The safest pattern is: LDA yscroll_shadow, AND #$F8, ORA new_yscroll,
STA $D011: 12-14 cycles (3 + 2 + 3 + 4 with zero-page operands, 14 with
absolute ones; an earlier version said 10-12). Because changing YSCROLL inside a visible
raster can produce glitches, the write should happen during the vertical
blank or in a stable raster window above line $30.

### Recipes

- `recipes/kickassembler/scroll-panel-split.md` scrolls a playfield vertically through all eight YSCROLL phases above a fixed panel; `recipes/oscar64/soft-scroll-h.md` is the horizontal counterpart.

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
in memory, carrying new character data onto the visible edge
while resetting XSCROLL to maintain seamless motion.

### How

The display is backed by a 40×25 text screen (1000 bytes) and a parallel
40×25 color RAM at $D800 (1000 nibbles). To scroll left by one character
column:

1. Copy columns 1-39 of each row to columns 0-38, top row first. An
   unrolled `LDA abs` / `STA abs` per byte costs 8 cycles; a library
   `memmove` measured about 41 (`recipes/oscar64/soft-scroll-h.md`). An
   earlier version of this step suggested `memmove`.
2. Write fresh data into column 39 (the new rightmost column) from an
   off-screen content buffer.
3. Repeat the same move on color RAM at $D800.
4. Reset XSCROLL to 7 in $D016 (it has just wrapped from 0; the column
   move cancels the 8-pixel snap). An earlier version of this step said
   "reset to 0", which produces an 8-pixel jump every eighth frame.

The visible content has now shifted one full character to the
left, and XSCROLL is back at 7 ready for the next seven single-pixel steps
down to 0.

For scrolling right, mirror the process: copy columns 0-38 to columns
1-39, write fresh data into column 0, reset XSCROLL to 0 (it has just
wrapped from 7). The leftward form is the one in
`recipes/oscar64/soft-scroll-h.md`: it writes the new XSCROLL at line 256,
then moves the rows when XSCROLL has wrapped. An earlier version of this
sentence quoted an `if (xscroll == 0) { shift; xscroll = 7; }` form that
wrote `$D016` after the move.

### Why it works

The hardware XSCROLL shift and the software screen-RAM shift are
complementary. The hardware provides fractional (sub-character) precision;
the software provides whole-character carries. When the two are reset
atomically in the same frame, the viewer sees continuous 1-pixel steps
although the mechanism alternates between a hardware
shift and a memory copy.

### Variations

- **Double-buffered screen RAM:** Maintain two screen-RAM pages and
  alternate which one $D018 points to. The copy goes into the hidden page
  and the switch is one write, so the raster never overtakes a half-done
  copy. (An earlier version said this avoids tearing "on fast machines";
  every stock C64 runs at the same ~1 MHz.)
- **Unrolled move:** On stock C64 there is no DMA. Unrolling the copy
  into straight LDA abs / STA abs pairs brings it to 8 cycles per byte
  (8,000 cycles for 40×25), which still exceeds the off-screen span on
  both PAL (~7,056 cycles) and NTSC (~4,095); unrolling reduces the cost,
  it does not make the move fit in the blank. An earlier version of this
  item claimed the unrolled move "can complete inside the vertical blank".
  It can race the beam instead: started at line 256 and done top row
  first, 975 bytes take 7,938 cycles and every row is finished before it
  is displayed (row 24 at line 82 PAL, 127 NTSC; measured in VICE by
  `recipes/oscar64/soft-scroll-h.md`).
- **Wide content ring buffer:** Keep the source content in a ring buffer
  wider than 40 columns. Advance the ring pointer each time a column shift
  fires instead of precomputing content on demand.

### Cycle budget

A byte-by-byte shift of 1000 bytes at roughly 10 cycles per
byte costs ~10,000 cycles. PAL has 63 × 312 = 19,656 cycles per frame
minus ~25 × 43 = 1,075 badline-stolen cycles for a CPU budget of ~18,581
cycles per frame. The screen shift alone therefore consumes about 54% of
the frame budget. The color RAM shift doubles that cost to ~108%. A
brute-force shift must therefore be overlapped across multiple frames or
replaced with a DEC-and-pointer approach. An unrolled inner loop using
indexed addressing and/or a 2-byte-per-iteration pattern roughly halves
the cycle count. Fully unrolled, 975 bytes of screen RAM measured 7,938
cycles (`recipes/oscar64/soft-scroll-h.md`).

### Recipes

- `recipes/oscar64/soft-scroll-h.md`

---

## char_scroll_buffer_v — Char-mode vertical scroll

**Complexity:** medium
**Region:** both
**Uses registers:** D011
**Uses kernal:** (none)
**Claims:** none
**Claims basis:** derived-listing

`none` is read off `recipes/kickassembler/scroll-panel-split.md`: besides
YSCROLL (see `soft_scroll_v`) the carry moves screen and colour RAM,
which are the program's memory, not units. That listing copies with
absolute indexed loads and stores and no zero-page pointer; a pointer
copy's bytes are the recipe's claim.

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
(960 × 8 = 7,680 cycles for screen RAM alone, doubled again for colour
RAM), against an off-screen span of only 112 lines × 63 = 7,056 cycles on
PAL (lines 251-311 and 0-50) and 63 × 65 = 4,095 on NTSC; the hardware
vertical blank proper (PAL lines 300-15) is smaller still.
Scrollers therefore spread the move across the frames between carries,
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
fully unrolled). The ~10 is an estimate, not measured: 8 cycles unrolled
as LDA abs / STA abs, 14 in an LDA abs,X / STA abs,X / INX / BNE loop
(instruction-table arithmetic). Between the last display line (250, RSEL=1) and the
first badline of the next frame (48 + YSCROLL) there are no badlines and
no character/bitmap fetches: with the default YSCROLL=3 that is lines
251-311 and 0-50, 112 raster lines = 7,056 cycles on PAL; because this
technique itself drives YSCROLL through 0-7, the span guaranteed at every
scroll position is lines 251-311 and 0-47, 109 lines = 6,867 cycles
(VICE shows the first badline at 48, 51 and 55 for YSCROLL 0, 3 and 7;
window and badline bounds from `docs/hardware/vic-ii-reference.md`). Only
lines 300-15 are vertical blanking in the video sense: 28 lines, 1,764
cycles (`docs/hardware/pal-ntsc-reference.md`); the rest of the span is
visible border, which is equally free of display DMA. Enabled sprites
still take their DMA in these lines. An earlier version of this paragraph
offered a 3,780-cycle "vertical blank" of lines 300-311 + 0-47 "of which
many are non-badline"; no line in that span is a badline. Since the shift
does not fit in the off-screen span, spread it across several frames or
use a double-buffer scheme where row 24 is pre-populated during the next
frame's active display period.

### Recipes

- `recipes/kickassembler/scroll-panel-split.md` shifts the rows on the carry frame and scrolls through all eight YSCROLL phases above a fixed panel.

---

## scroll_panel_split — Vertically scrolled playfield over a fixed score panel

**Complexity:** medium
**Region:** both
**Uses registers:** D011, D012, D016, D018, D021
**Uses kernal:** (none)
**Requires:** soft_scroll_v
**Demands:** midframe_raster_irqs
**Cost:** irq_slots=2, lines_active=5, cycles_per_frame=413
**Cost basis:** measured-vice
**Cost measured on:** kickassembler-scroll-panel-split (two IRQs, screen on; not the carry frame)
**Claims:** vic_raster_irq (owns)
**Claims basis:** derived-listing

### Why

A game whose playfield scrolls vertically still needs a score panel that
stays still. The playfield's YSCROLL changes every frame; the panel's must
not. A raster split has to change `$D011`, and usually `$D016`, `$D018` and a
colour, between the playfield's last line and the panel's first. A split at
one fixed line with one fixed delay works at seven YSCROLL phases and breaks
at the eighth (pitfall `scroll_phase_breaks_panel_split`).

### How

1. Put the panel's first line on a line that is 7 mod 8, 48 + 8k + 7, and give
   the panel YSCROLL 7. The playfield then ends on the line before, at every
   phase.
2. Let the playfield scroll with `soft_scroll_v` and `char_scroll_buffer_v`.
   The last playfield row is cut short by the panel's badline and shows
   7 − YSCROLL lines.
3. Take a raster IRQ two lines before the playfield's last line. Load every
   register value, poll `$D012` for the last line, then wait for a delay read
   from an eight-entry table indexed by the playfield's YSCROLL.
4. Store the panel's `$D016`, `$D011` and `$D018` in the right border of the
   last playfield line.
5. Poll for the panel's first line and let its badline stall the CPU; store
   the panel's background colour after the stall.
6. Below the panel, restore the playfield's registers and write the next
   frame's YSCROLL before line 48.

### Why it works

A character row is fetched again from its start until it has shown all eight
lines. A playfield row cut short by the panel's badline therefore does not
count, and the panel's first row is the screen row after the last complete
playfield row. With the panel's first badline on 48 + 8k + 7, exactly k
playfield rows complete at every YSCROLL, so the panel always reads the same
screen row. Measured in VICE x64sc 3.10 (`recipes/kickassembler/scroll-panel-split.md`):
with the panel on line 216 at YSCROLL 0 instead, the panel read screen row 21
at playfield YSCROLL 0 and row 20 at YSCROLL 3. The cut-short playfield row
and the panel's first row are the same screen row, so the panel needs its own
screen matrix, selected through `$D018`. They also share one colour RAM row.

The split line L is a badline at exactly one playfield phase, YSCROLL = L mod
8. At that phase the VIC holds the CPU from cycle 12 to cycle 54 while the
split code waits (`badline_cycle_loss`), and a full delay lands the stores
about 40 cycles late, inside the panel's first line. The table entry for that
phase is 0: the stall is the wait. c64gameframework's panel IRQ uses the same
scheme, a delay table indexed by `$D011` (source:
https://github.com/cadaver/c64gameframework, `raster.s` and `aligneddata.s`,
not run here). Its panel `$D011` value `$57` has YSCROLL 7, which matches the
row rule above.

The panel's first line is always a badline once the split has run. Any code
that reads memory across cycle 12 of that line resumes at cycle 55 at every
phase, so a store after it has no poll jitter. The recipe puts `$D021` there.

### Variations

- **Panel at the top:** the split sets the playfield's YSCROLL below the
  panel instead. The row-count rule above was measured only for a panel at
  the bottom.
- **Horizontal scrolling too:** the split resets XSCROLL in `$D016` and
  usually switches 38 columns to 40, as the recipe does.
- **Colour RAM:** a colour-RAM shift for the playfield must not touch the
  panel's rows; it is usually run while the beam is in the panel or the
  border (Cadaver, https://cadaver.github.io/rants/scroll.html, not measured
  here).

### Cycle budget

The measured write window is narrow. At YSCROLL 3 the delay loop (`dec` on an
absolute counter and `bpl`, 9 cycles a pass) is clean at 4 and 5 passes on
PAL and NTSC; 3 writes `$D016` before line 214's right border and 6 misses the
start of line 215. Two consecutive pass counts are clean, so the margin is
between one and three passes (9-27 cycles) beyond the poll's 0-6 cycle jitter
(arithmetic; the poll loop is `cmp` absolute 4 + `bcs` taken 3 = 7 cycles). The delay
counter is at an absolute address (`DEC` opcode `$CE` in the assembled PRG),
so a pass is 9 cycles.

Two IRQs a frame: the split and the one below the panel. Measured in VICE
x64sc 3.10 with CIA 2 timer A free-running, read at entry and exit of both
handlers in a separate build of the recipe, 32 consecutive frames on PAL and
NTSC, from the IRQ sequence to the end of `rti`: the split takes 267-310
cycles depending on the phase (267 at YSCROLL 4, when line 212 is a badline)
and spans five raster lines; the bottom handler takes 103. That is at most 413
cycles a frame, the same on both models. On the one frame in eight that
carries, the bottom handler also shifts twenty rows (20 × 560 cycles,
arithmetic) and took 13,262 cycles on PAL, 13,519 on NTSC; that cost belongs
to `char_scroll_buffer_v`, not to the split.

### Recipes

- `recipes/kickassembler/scroll-panel-split.md`: playfield scrolling up through all eight phases over a five-row panel, with the per-phase naive-versus-table measurement on PAL and NTSC.

---

## infinite_scroll_h — Combine soft + buffer for continuous horizontal scroll

**Complexity:** medium
**Region:** both
**Uses registers:** D016
**Uses kernal:** (none)
**Requires:** soft_scroll_h, char_scroll_buffer_h

### Why

`soft_scroll_h` alone stops after 7 pixels. `char_scroll_buffer_h` alone
produces only character-column-resolution jumps. Combining both gives
continuous 1-pixel-per-frame horizontal scrolling, the method behind most
C64 side-scrollers and horizontal text scrollers.

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
sees continuous 1-pixel advances: the hardware register handles
sub-character motion, the software carry handles character-boundary
transitions.

### Why it works

The VIC-II draws each frame from the fixed content of screen RAM, offset
by XSCROLL. Changing XSCROLL by 1 between frames produces a 1-pixel shift.
When XSCROLL wraps, the 1-pixel offset becomes 0 (aligned to the grid
again). Without the screen-RAM shift, the content would snap back 8 pixels
at the wrap. With the shift, the screen RAM has already advanced by one
column, exactly canceling the wrap reset. The visual result is
continuous motion.

### Variations

- **Variable speed:** Increment XSCROLL by more than 1 per frame (2, 3,
  or 4) to double, triple, or quadruple scroll speed. At 8 px/frame the
  software and hardware components become decoupled: shift the screen
  each frame and skip the fractional register entirely.
- **Reversed direction:** The same logic applies rightward; the
  differences are the direction of the XSCROLL ramp (0→7 instead of 7→0)
  and the direction of the screen-RAM column copy.
- **Speed modulation:** For smooth acceleration and deceleration
  (ease-in / ease-out), store the current speed as a fixed-point number
  and accumulate it into the pixel counter, firing a carry whenever it
  crosses a character boundary.

### Cycle budget

The cost is dominated by the column shift, which fires once every 8
frames at 1 px/frame and lands in one frame, not eight. At ~10 cycles per
byte (an estimate between 8 unrolled and 14 in an indexed loop; not
measured) the 1,000-byte screen-RAM shift costs ~10,000 cycles, and the colour
RAM shift in step 3d as much again: ~20,000 cycles against a PAL budget of
~18,581 per frame (`char_scroll_buffer_h`, Cycle budget). The seven frames
between carries cost ~10 cycles each for the XSCROLL write. So the carry
frame does not fit as written. Build the shifted screen in a second page
over the frames before the carry and flip $D018 on it (`char_scroll_buffer_h`,
Variations); colour RAM at $D800 has no second page, so its shift stays in
the carry frame unless the colours are uniform. (An earlier version
averaged the shift over 8 frames, ~1,250 cycles per frame, and said it
fits a ~18,000-cycle game budget; the average does not help the frame
the shift lands in.)

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

A single-plane scroller looks flat. Parallax (screen layers moving at
different speeds) gives an illusion of depth. The C64 does this by
running two separate scroll systems in the same frame: the character-mode background scrolls at one rate, while
sprite-rendered foreground objects move at a different (usually faster)
rate. The viewer perceives the foreground as closer because it moves faster
across the screen.

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
rate than the background produces the parallax effect.

### Variations

- **Three-layer parallax:** Add a second character plane using a split-screen
  raster IRQ: the top half of the screen uses one $D018 character base,
  the bottom half uses another, with independent scroll variables for
  each half.
- **Sprite foreground at 4x speed:** At 4 px/frame a foreground object
  crosses the 320-px screen in 80 frames (1.6 s on PAL) against 6.4 s
  for a 1 px/frame background, a 4:1 depth cue for fast-moving near
  objects (bullets, sparks, foreground pillars). An
  earlier version claimed "25 full-screen traversals per second", which
  would need 160 px per frame.
- **Sprite-multiplexed deep parallax:** Combine a sprite multiplexer
  (`sprite_multiplex_8`, or `sprite_multiplex_24` for larger counts; see
  `docs/techniques/sprite.md`) with parallax to field more than 8 visible
  foreground objects at different parallax depths.

### Cycle budget

Per-frame sprite update cost: for N sprites, update the X low byte, check
the MSB threshold, and conditionally flip the $D010 bit. Roughly
16 cycles per sprite for the conditional MSB path. Eight sprites: ~128
cycles. Background scroll update: ~10 cycles for the XSCROLL write plus
the amortized ~1,250-cycle column shift (once per 8 frames). A
two-layer scene at 2:1 ratio costs approximately 150 cycles per frame
in positional math plus the occasional carry, within the PAL budget.

### Recipes

- No recipe yet for parallax layers.

---

## charset_parallax — Parallax inside the character layer by rolling reserved glyphs

**Complexity:** medium
**Region:** both
**Uses registers:** D018
**Uses kernal:** (none)
**Requires:** infinite_scroll_h
**Cost:** cycles_per_frame=378, bytes_code=26
**Cost basis:** measured-vice
**Cost bytes basis:** derived-listing
**Cost measured on:** oscar64-charset-parallax (roll frame, every second frame, in the vertical blank)

### Why

`parallax_dual_layer` gets its second layer from sprites, and a raster
band split gets it from a second scroll value per band, so its layers
cannot overlap. Character parallax needs neither. The background is a
repeating pattern drawn with a few reserved glyphs, and the glyph bytes
are shifted so the pattern moves at a different speed from the
foreground tiles that share the screen. It costs a few hundred cycles a
frame, no sprites and no raster interrupt.

### How

1. **Reserve the background glyphs.** Pick a tile of glyphs, 2x2 is
   usual (A B over C D, a 16x16 pattern), in a RAM charset. Fill every
   background cell with A, B, C or D by world column and row parity:
   `code = base + (world_col & 1) + 2 * (row & 1)`. Foreground tiles use
   other codes, never these four.
2. **Scroll the whole screen as the foreground.** `$D016` XSCROLL each
   frame and a one-column shift of screen RAM on the carry
   (`infinite_scroll_h`). Background cells ride along with it, so
   without step 3 the pattern moves at the foreground's speed.
3. **Shift the glyph bytes against the scroll.** Each pixel row of the
   tile is a 16-bit word, left glyph's byte high. One pixel right is
   `LDA right,X / LSR / ROR left,X / ROR right,X`: LSR drops the right
   byte's last pixel into carry, the first ROR takes it in at the left
   edge and drops the left byte's last pixel into carry, the second ROR
   takes that in. That is 20 cycles a pixel row, 320 for the 16 rows of
   a 2x2 tile. One pixel left is the mirror: `LDA left,X / ASL / ROL
   right,X / ROL left,X`.
4. **Pick the rate.** The pattern's speed on screen is the foreground's
   speed minus the glyph shift speed. A foreground at 1 px a frame
   leftward with a one-pixel right roll every second frame puts the
   background at 1/2 px a frame leftward. A roll every frame holds it
   still; a roll in the same direction as the scroll makes it faster
   than the foreground.
5. **Do it in the blank.** The glyph bytes are read on every raster
   line of every background row, so the roll must finish before the
   first background row is fetched, or that frame shows old rows above
   the write and new rows below it.

Vertical is byte rotation, not bit rotation: to move the tile down one
pixel, each 16-byte column (A over C, B over D) moves every byte to the
next row's address, and the last row's byte wraps to the first. Unrolled, that
is a load and a store per byte, about 128 cycles a column (arithmetic
from 4-cycle absolute loads and stores, not built here).

### Why it works

The VIC-II has no copy of a glyph. It reads eight bytes from the
charset for each cell's code on every line of the row, so changing the
tile's 32 bytes changes every background cell on the screen at once,
however many there are. The screen RAM is untouched; the scroll code
still moves the cells, and the cell grid and the glyph content add. In
the recipe the foreground moved 203 px in 203 frames and the pattern
101 px against it, so the pattern moved 102 px, which the exit
screenshot confirms to the pixel.

### Variations

- **Pre-shifted copies instead of a roll.** Keep every phase of the
  tile in a table (16 phases of 32 bytes for a 2x2 hires tile, 512
  bytes) and copy this frame's phase in. The copy does not accumulate
  error and can jump phases, but in the recipe it cost 560 cycles,
  including the pointer set-up for the phase, against 378 for the roll.
  The roll is cheaper because it touches each byte in place.
- **One charset per phase.** Store each phase in its own charset and
  flip `$D018` (Hawkeye used four charsets switched continuously, per
  C64-Wiki; not measured here). One store a frame, 2 KB of RAM per
  phase, and every other glyph copied into every charset.
- **Multicolour.** A multicolour pixel is two bits, so one pixel step is
  two rolls, twice the cycles (codebase64; not built here).
- **Shared cells.** Where a foreground tile and the background share a
  cell, that cell needs its own glyph, rebuilt after each roll as
  `(background AND NOT mask) OR foreground` per byte, the merge
  `char_bullets` does for bullets. The recipe forbids shared cells
  instead: foreground tiles are whole cells, so a tile's edge is a cell
  edge.
- **Animated glyphs.** Rewriting a glyph's bytes in place is
  `charset_animation`; this technique is that method with the new bytes
  computed from the old ones by a shift.

### Cycle budget

The roll of a 2x2 hires tile is 378 cycles measured with CIA1 timer B,
which includes about five cycles of the timer's stop; the instruction
count is 373 with `JSR` and `RTS`. Measured in VICE x64sc 3.10 on PAL and NTSC alike,
because it runs in the vertical blank where no cycles are stolen. It
runs every second frame at half speed, so the typical frame is 378 or 0.
The worst frame is a roll frame; the `**Cost:**` line states it, and
the 26-byte routine from the Oscar64 map. Before #72 one basis word covered the whole Cost line, so it said `derived-listing`, the bytes' rung, beside measured cycles; the cycles now say `measured-vice` and the bytes keep `derived-listing` on their own line. A larger tile scales the roll
linearly: 20 cycles per pixel row per glyph pair. The recipe's screen
shift on the carry frame, 12,321 cycles on PAL and 12,537 on NTSC, is
`infinite_scroll_h`'s cost, not this technique's.

### Recipes

- `recipes/oscar64/charset-parallax.md` — a 2x2 background tile rolled
  one pixel every second frame under a foreground scrolled at 1 px a
  frame; the program checks the glyph bytes against a model and every
  cell against the map after 203 frames, and prints both methods'
  cycles; PAL and NTSC

### Sources

- https://codebase.c64.org/doku.php?id=base:simple_parallax_shifting
  (2x2 tile, ASL/ROL and LSR/ROR across the glyph pair, byte moves for
  vertical, a call every second frame for a slower layer, twice per
  frame in multicolour). Read for facts; no code is taken from it.
- https://www.c64-wiki.com/wiki/Parallax_Scrolling (bits "rolled
  (horizontally) or copied (all directions) within one or several
  chars"; X-Out, Snare and Parallax named; Hawkeye's four charsets;
  raster-band layers "cannot overlap"). Not measured here.

---

## bitmap_scroll — Bitmap-mode scroll via $D016 + bitmap shuffling

**Complexity:** high
**Region:** both
**Uses registers:** D011, D016, D018
**Uses kernal:** (none)

### Why

Bitmap mode gives pixel-level control over every dot on the screen:
320×200 in standard single-color mode, 160×200 in multicolor mode. Some
demos and games want to scroll a pixel-accurate drawn scene rather than
a character-based one. This is harder than character-mode
scrolling because there is no sparse screen-RAM grid to rotate; the entire
8000-byte bitmap must be shifted, or an expensive double-buffer strategy
must be used.

### How

There are two approaches. Both use $D016 XSCROLL for fine-scroll
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
therefore moves every 8-byte cell to the cell before it (a memmove of the
whole 8000-byte bitmap down by 8 bytes), after which the last cell of each
of the 25 bands (40 × 8 = 320 bytes per band) is redrawn from source; the
1000-byte screen RAM (and Color RAM in multicolor mode) shifts by one byte
in step.

For vertical scrolling by one character row, the coarse carry is one
band: move the bitmap up by 320 bytes (40 cells × 8 bytes = one row of
characters, 8 raster lines), a 7,680-byte memmove, and refill the
bottom 320 bytes. An earlier version said "40 bytes", which shifts by
five cells horizontally within the same band, not by one row. The
screen-RAM attribute matrix (1000 bytes) moves by 40 bytes at the same
time, and in multicolor bitmap mode colour RAM at $D800 moves by 40 bytes
as well. A vertical shift of fewer than 8 lines is not a
memmove at all (each scanline byte moves within its own cell, and line 0
of a cell takes line 7 of the cell in the band above), which is why
bitmap scrollers carry vertically by whole bands and use YSCROLL for the
intermediate lines.

Cycle cost: an 8000-byte shift at ~10 cycles per byte = ~80,000 cycles
(an estimate between 8 cycles unrolled and 14 in an indexed loop; not
measured).
PAL provides ~18,500 CPU cycles per frame (after badlines). An 8000-byte
shift is approximately 4.3 frames of CPU time at full speed. This approach
does not run at 50 Hz for a full-screen scrolling bitmap without
compromises.

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
and decouples the rendering time from the frame deadline, as long as
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
Scrolling bitmap scenes reduce the scrolling area to a sub-screen
viewport, or use hardware XSCROLL + YSCROLL to cover most frames with no
pixel work and do the 8000-byte shift only once every 8 frames, when the
coarse carry fires.

### Why it works

The VIC-II treats the bitmap as a contiguous region of video memory. XSCROLL
and YSCROLL shift the rendering pipeline's start position within each
8×8 cell exactly as in character mode. The fine-scroll mechanism is
identical. The cost difference is in the carry: where character mode
carries by rotating 1000 bytes of screen RAM, bitmap mode must carry by
rotating 8000 bytes of raw pixel data. The $D018 page-flip trick avoids
moving pixel data altogether by pointing the VIC at a different memory
region, leaving the shifting work to the back-buffer renderer, which runs
across several frames. (An earlier version said "across multiple cycles".)

### Variations

- **Reduced viewport:** Apply bitmap scrolling only to a horizontal strip
  (e.g., the bottom 100 rows). Use a raster IRQ to switch $D018 or the
  display mode at the viewport edge. This halves the bitmap size and
  memory requirement.
- **Sprite overlay on bitmap:** Hardware sprites work the same way in
  bitmap mode. Combine with `parallax_dual_layer`: sprite foreground
  objects at a faster rate over a slow-scrolling bitmap background.
- **Vertical bitmap scroll only:** Shifting 8000 bytes vertically is the
  same cost as horizontally, but the double-buffer flip approach works
  equally well. Vertical-only bitmap scroll is somewhat more common in
  intros because vertical motion on a bitmap preserves horizontal
  compositional alignment better than horizontal motion.

### Cycle budget

Fine-scroll step (XSCROLL or YSCROLL write only, no carry): ~10 cycles.

Coarse carry, memshift approach (fires once per 8 frames at 1 px/frame):
8000 bytes × 10 cycles/byte = 80,000 cycles (the same ~10 estimate). Spread across 8 frames:
10,000 cycles/frame average, or ~54% of the PAL per-frame budget.
The colour carry must move in lockstep with the pixel carry: the
1000-byte video matrix (each byte holds the cell's foreground and
background nibbles), plus the 1000 nibbles at $D800 in multicolour bitmap
mode: a further ~10,000-20,000 cycles per coarse step, about an eighth
to a quarter of the bitmap shift. (An earlier version spoke of a
"4000-byte" colour array; there are 40 × 25 = 1000 cells and no
4000-entry structure anywhere in the VIC.) Combined, the overhead is
practical only for slow-scrolling backgrounds or sub-screen viewports.

Double-buffer approach: the page flip itself costs ~10 cycles ($D018
write). The rendering work (clearing and redrawing the 8000-byte back
buffer) is the main budget item and is scene-specific.

### Recipes

- No recipe yet for bitmap scrolling.

---

## tile_map_render — Metatile map decode to screen and colour RAM

**Complexity:** medium
**Region:** both
**Uses registers:** (none)
**Uses kernal:** (none)
**Cost:** cycles_per_frame=268
**Cost basis:** arithmetic
**Cost measured on:** oscar64-tile-map-render (one column edge, 11 metatiles)

### Why

A scrolling game level is far larger than the 1000 cells of one text
screen, and a level stored as raw screen codes plus colour costs two bytes
a cell. Storing the level as a grid of metatiles (here 2x2 characters plus
one colour) divides that by eight, and run-length coding the metatile
rows takes it down further: the recipe's 20 x 11 map is 135 stream bytes
for 220 metatiles, which expand to 880 screen bytes and 880 colour
nibbles. The decoder is also the thing that feeds `char_scroll_buffer_h`
and `char_scroll_buffer_v`: both say "write fresh data into column 39"
or "into the new row" from an off-screen source, and this technique is
that source.

### How

Three tables and two decoders.

1. **Metatile table.** One entry per metatile: four screen codes
   (top-left, top-right, bottom-left, bottom-right) and one colour. A
   per-character colour variant stores four colour bytes instead of one;
   the write count is the same, the table is three bytes larger per
   metatile.
2. **Map.** One byte per metatile, MAP_W wide by MAP_H high, decoded once
   into RAM at level start. It is indexed as `map[my * MAP_W + mx]`. For
   a level wider than the screen MAP_W is the level width, not 20.
3. **RLE row streams.** Each map row is its own stream of control bytes.
   In the recipe's format bit 7 set means a run (the next byte repeated
   `c & 0x7f` times), bit 7 clear means `c` literal bytes follow, and zero
   ends the row. The decoder returns the address after the terminator, so
   the rows are walked in sequence with no offset table.
4. **Row decode.** Draw the top or bottom character row of one map row
   into one screen row: for each metatile write two screen codes and two
   colours. This is the new-row source for `char_scroll_buffer_v` and
   `soft_scroll_v`: a vertical scroll steps one character row at a time,
   so it asks for half a metatile row per step and alternates `half`
   between 0 and 1.
5. **Column decode.** Draw the left or right character column of one
   map column into screen column 0 or 39, all rows: for each metatile row
   write one screen code and one colour at `s[0]` and again at `s[40]`,
   then step 80 bytes. This is the new-column source for
   `char_scroll_buffer_h` and `soft_scroll_h`, and again `half` alternates
   because a metatile is two columns wide.

The two edge decoders, as built in scratch with Oscar64 build 2026-05-19
at `-O2` to confirm they compile (they are not the recipe's listing and
their cost is not measured here):

```c
struct Metatile { char c[4]; char col; };
extern const struct Metatile tiles[];
extern char map[MAP_W * MAP_H];      // one byte per metatile, decoded once

// Left (half 0) or right (half 1) character column of map column mx,
// into screen column sx (0 or 39), every metatile row.
void decode_column(char mx, char half, char sx)
{
    char *s = Screen + MAP_ROW * 40 + sx;
    char *k = Color + MAP_ROW * 40 + sx;
    const char *m = map + mx;
    for (char y = 0; y < MAP_H; y++) {
        const struct Metatile *t = tiles + *m;
        s[0] = t->c[half]; s[40] = t->c[half + 2];
        k[0] = t->col;     k[40] = t->col;
        s += 80; k += 80; m += MAP_W;
    }
}

// Top (half 0) or bottom (half 1) character row of map row my, starting
// at map column mx, into screen row sy.
void decode_row(char mx, char my, char half, char sy)
{
    char *s = Screen + sy * 40;
    char *k = Color + sy * 40;
    const char *m = map + my * MAP_W + mx;
    for (char x = 0; x < 20; x++) {
        const struct Metatile *t = tiles + m[x];
        s[0] = t->c[2 * half]; s[1] = t->c[2 * half + 1];
        k[0] = t->col;         k[1] = t->col;
        s += 2; k += 2;
    }
}
```

### Why it works

Screen RAM holds screen codes and colour RAM at `$D800` holds one nibble
per cell, so a metatile is a fixed pattern of writes to
both. The VIC-II reads the two arrays every badline; nothing in the chip
knows about metatiles, which is why the decoder can write at any time
the cell is off-screen or about to be overwritten anyway. Keeping the map
as one byte per metatile in RAM, rather than decoding the RLE on demand,
is what makes the column decode cheap: a column of a run-length coded row
cannot be reached without decoding the row up to it, but an unpacked map
is a stride-MAP_W walk.

### Variations

- **Per-character colour.** `char col[4]` in the metatile instead of one
  byte. Same write count; use it when a metatile mixes, say, a green tree
  top over a brown trunk.
- **Larger metatiles.** 4x4 characters with a 16-byte pattern divides the
  map size by a further four. The edge decoders then alternate `half`
  over four values.
- **CharPad import.** CharPad's `.ctm` (version 8) already holds
  characters, tiles, attributes and a map, and Oscar64's `#embed` extracts
  each channel directly: `ctm_chars`, `ctm_tiles8` / `ctm_tiles16`,
  `ctm_map8` / `ctm_map16`, `ctm_attr1` / `ctm_attr2`
  (`docs/toolchains/oscar64-reference.md`, "Embedding" section, the
  `#embed ctm_chars` paragraph; the Oscar64 manual `oscar64.md`,
  "Embedding sprite and graphics data", is the source). The directive
  must stand alone on its own line inside the initialiser braces. The
  `.ctm` layout is summarised in `docs/art/asset-pipelines.md` under
  "Charsets (.ctm from CharPad)". A CharPad tile maps onto the
  `Metatile` struct here as its character indices plus its attribute
  byte; the RLE streams are then whatever the build produces, or
  `#embed ... rle` for a plain run-length pass. No page in this KB ships
  a `.ctm`, and the recipe below needs none.
- **RLE variants.** The recipe's format caps a run at 127 and has no
  escape for a single repeated pair. A two-byte `(count, value)` format
  with no literal mode is smaller code and worse on noisy rows.

### Cycle budget

Measured in VICE x64sc 3.10 with a CIA1 timer B harness, display blanked
and interrupts masked, Oscar64 `-O2`, the recipe's listing (rung 1; the
figures are identical on PAL and NTSC because they count CPU cycles
only):

| Step | Cycles | Per unit |
|---|---|---|
| RLE decode, 11 rows, 135 stream bytes to 220 map bytes | 8,828 | 40.1 per decoded byte |
| Expand 220 metatiles (880 screen + 880 colour writes) | 10,731 | 48.8 per metatile |

The edge decoders above were not timed. One column decode touches 11
metatiles and writes four bytes for each, half of what `expand_row`
writes per metatile, so a figure in the low hundreds of cycles is
arithmetic from the expand figure (rung 3), not a measurement: half of
48.8 is 24.4 per metatile, and eleven metatiles come to about 268
cycles, which is the figure on the Cost line above. A full-map expand at 10,731
cycles is about 55% of the ~19,656-cycle PAL frame, so it belongs at level
start, not inside the scroll loop; the scroll loop does one edge decode
per character step.

A whole-level unpack is a transition cost, and the Cost line cannot
carry it beside the per-frame column edge: one technique has one
`cycles_per_frame`. The recipe's 11-row map takes 8,828 + 10,731 =
19,559 cycles to decode and expand (the table above; arithmetic on
two measurements). A game-sized cave takes more:
`templates/action-puzzle` times its decode of cave 2 at 40,041 cycles
on PAL and 40,519 on NTSC, screen on, CIA1 timer B, about two PAL
frames, and its PLAN gives 28,193 to 50,447 a room for the C decoder
of `recipes/oscar64/level-rle-decoder.md`. Budget it in the transition
phase, on a static or blanked screen. An earlier version of this page
gave only the column edge, 268.

### Recipes

- `recipes/oscar64/tile-map-render.md`
- `recipes/oscar64/level-rle-decoder.md` (the same RLE format on three 40 x 22 rooms: ratio, decode cycles and decoder size measured, in C and by hand)
- `recipes/oscar64/tile-grid-collision.md` (tests a sprite against the decoded map array this technique fills; `tile_grid_collision` in `logic.md`)

---

## dycp_scroller — DYCP: each text column at its own pixel Y, drawn through the charset

**Complexity:** medium
**Region:** both
**Uses registers:** D012, D016, D018
**Uses kernal:** (none)
**Requires:** frame_sync_loop
**Cost:** cycles_per_frame=5343, bytes_code=4117, bytes_data=1090, zp_bytes=2, irq_slots=1
**Cost basis:** measured-vice
**Cost bytes basis:** derived-listing
**Cost measured on:** kickassembler-dycp-scroller (worst frame, 39 columns, in the vertical blank)

### Why

A sine scroller that moves whole characters between rows
(`recipes/kickassembler/sine-scroller.md`) steps eight pixels at a time
vertically. DYCP, Different Y Character Position, puts every column at
its own pixel height. DYCP does not move characters around the
screen. Each column of the band is a fixed vertical strip of
character cells that never changes; what moves is the glyph inside the
strip, copied every frame into a custom charset at the pixel row the wave
gives. The VIC-II reads the charset afresh on every raster line, so a
glyph written at byte offset `y` of a strip appears `y` pixels down it.

### How

1. **Lay the strips once.** Give the band N screen rows. Column `c`,
   cell `k` holds charset slot `base + c*N + k`. Because a slot is eight
   consecutive bytes, the N cells of one column are `8N` consecutive
   charset bytes, and pixel row `y` of the strip is the single byte
   `strip + y`. Set `$D018` to point at the charset and never write the
   band's screen RAM again. Everything outside the band shows a blank
   slot from the same charset, and any text elsewhere on the screen has
   to be drawn from slots the strips do not use.
2. **Each frame, per column:** blank the eight bytes the glyph occupied
   last frame; look the column's new `Y` up (`sine[phase + c*STEP]`);
   copy the glyph's eight rows to `strip + Y .. strip + Y + 7`. Seen as
   cells, rows `0 .. 7 - (Y & 7)` of the glyph land in cell `Y >> 3` at
   row offset `Y & 7` and the rest in the cell below; the address form
   does that split at no cost. `Y` runs from 0 to `8N - 8`, so a strip
   N cells tall gives `8N - 8` pixels of travel: six cells, 40 pixels.
3. **Keep the glyph source indexable.** A copy of the glyphs the message
   uses, 32 of them, in 256 bytes: `glyph * 8` then fits a byte and one
   `lda font+r,y` reaches any row of any glyph. Screen codes for space
   and punctuation lie above 31, so the message is remapped onto the 32
   slots when it is assembled or when it is fed into the ring buffer.
4. **Scroll horizontally as usual.** `$D016` XSCROLL a pixel a frame and
   a ring-buffer shift every eighth frame (`soft_scroll_h` and
   `char_scroll_buffer_h` above); the shift changes which glyph a column
   copies, nothing else.

### Why it works

The character generator reads eight bytes per glyph at charset base plus
code times eight, one byte per raster line of the row. Consecutive slots
are consecutive in memory, so a column of consecutive slots is one
unbroken run of bytes and a glyph can be placed at any byte offset in
it. Where the old and new positions overlap, the write after the clear
wins, so clearing the previous eight rows and then writing the new eight
is correct for any move up to eight pixels a frame. The screen RAM never
changes, so nothing is redrawn on the character grid and no part of the
effect costs screen or colour writes. `$D016` still applies: the fine
scroll shifts every row including any caption outside the band.

### Variations

- **Two charsets, `$D018` flip.** Copy into the charset the VIC is not
  showing and swap at the frame sync. This lets the copy run inside the
  display, at 2 KB per charset and one register write; not
  needed when the copy is budgeted to finish above the band, which the
  recipe measures.
- **Cheaper clear.** When the per-frame move is at most one pixel, two
  zero stores (the row above and the row below the new glyph) replace
  the eight-store clear, six stores a column fewer. Ties the copy to the
  wave's speed.
- **1x2 letters.** Sixteen-row glyphs in strips two cells wider apart:
  twice the copy per column, half the columns for the same slot budget.
- **Wave tables.** Separate speed and amplitude tables indexed by frame
  give a wave that breathes; a second sine added to the first gives a
  compound wave. Amplitude is bounded by `8N - 8` less the glyph height.

### Cycle budget

Per column per frame: 16 stores and 8 loads, plus the table lookups.
Unrolled with absolute-indexed addressing, the recipe's copy is 136
cycles a column: 39 columns in 5,305 to 5,343 cycles over 304 PAL frames,
measured with CIA2 timer A in VICE x64sc 3.10 (the spread is the page
crossing of the sine lookup in some columns). The `**Cost:**` line above
states that worst frame, the code segment (`$0900-$1914`, of which the
unrolled copy is most) and the table segment (`$2000-$2441`) from
KickAssembler's memory map; the 2 KB charset the copy writes is cleared
at run time and is in neither segment. Before #72 one basis word covered the whole Cost line, so it said `derived-listing`, the bytes' rung, beside measured cycles; the cycles now say `measured-vice` and the bytes keep `derived-listing` on their own line.

The budget depends on where in the frame the copy runs. A column's strip
bytes are read by the VIC on every raster line of the band, so the copy
must finish before the band's first line, or run into a charset the VIC
is not showing. From an interrupt at line 250 the recipe's copy ends by
line 35 on PAL and by line 84 on NTSC, against a band starting at line
122. The NTSC figure is 49 lines later for the same CPU work because the
263-line frame leaves 13 lines of blank after 250, so the copy runs over
the top of the display and crosses three to five badlines, each 40 to 43
cycles: the timer reads 5,433 to 5,556 on NTSC against 5,305 to 5,343 on
PAL. Each extra column costs 136 cycles and about two lines; each extra
strip cell costs eight slots and nothing per frame. The slot budget
binds first: with 22 slots kept for a blank and a caption, 39 columns
of six cells is 234, and a seventh cell would allow only 33 columns.

### Recipes

- `recipes/kickassembler/dycp-scroller.md`

---

## eight_way_scroll_double_buffer — Eight-way tile scroll over two screen matrices

**Complexity:** high
**Region:** both
**Uses registers:** D011, D012, D016, D018
**Uses kernal:** (none)
**Requires:** screen_double_buffer_d018, soft_scroll_h, soft_scroll_v
**Cost:** cycles_per_frame=13152
**Cost basis:** measured-vice

### Why

`soft_scroll_h` and `soft_scroll_v` together move the display by up to
seven pixels in each axis. Past that the character grid has to move, and
in eight directions that means the whole matrix, not an edge: a diagonal
step changes every cell's contents, so the column shift that serves
`char_scroll_buffer_h` has nothing to shift into.

A full 1,000-byte matrix rewrite does not fit the vertical blank on
either model, and written into the live matrix it tears: the beam crosses
the rewrite and shows the top of the old world above the bottom of the
new. Two matrices in the same VIC bank solve it. The redraw goes into the
one that is not on display, over as many fields as it needs, and the
`$D018` VM nibble swaps them in the blank when it is finished.

### How

1. **Camera in world pixels.** Tile origin is `camx >> 3` and `camy >> 3`.
   XSCROLL moves the display right, so a rightward camera needs
   `7 - (camx & 7)` in `$D016` bits 0 to 2 and `7 - (camy & 7)` in `$D011`
   bits 0 to 2. Write both registers whole from a shadow rather than
   read-modify-write, or the store takes CSEL and MCM with it
   (`d016_unmasked_rmw_clobbers_csel_mcm`).
2. **Both windows narrow.** RSEL 0 and CSEL 0 hide the partial row and
   column at each edge, so a 40 x 25 matrix covers the display at every
   fine scroll value.
3. **Draw for the origin after next.** The spare matrix cannot be drawn
   for the origin the camera has now, because the camera moves while it is
   being drawn. Work out which axis crosses a tile boundary first, from
   `8 - (cam & 7)` when it is increasing and `(cam & 7) + 1` when it is
   decreasing, and draw for the origin that crossing will produce. On a
   diagonal the axes cross on different fields and one spare matrix cannot
   serve two origins, so only the nearer crossing is targeted.
4. **Flip only on a match.** The flip is taken only if the
   spare matrix already holds exactly the origin wanted. Count the
   refusals; a non-zero count is the scroll stuttering.
5. **Colour RAM in four calls.** Colour RAM is not paged. Both halves are
   written in `irqColB` at raster 4, at most `BAND_MAX` rows per call.
   After a flip, the first top-half call uses `BAND_FIRST` rows (fewer
   than `BAND_MAX`) so it finishes before the first top rows' badlines even
   when `irqColB` starts late on NTSC. Four calls cover all 25 rows over
   four fields, producing three displayed fields of stale colour per
   crossing before all rows are updated.
6. **Cap every band of the redraw.** Spread the matrix over the fields
   available, and put a ceiling on every field, not only the ones doing
   colour work.

### Why it works

The VIC reads the matrix at the address the VM nibble names, on the
badline of each character row. Changing that nibble between fields
changes which 1,000 bytes the next field reads, and nothing else: the
fine scroll, the charset base and the bank are untouched. So a matrix
drawn over several fields is invisible until the field it first appears
in, and appears whole.

Sub-tile and whole-tile motion are the same motion split at the eight
pixel boundary. `camx` is the only state; the fine scroll is its low three
bits inverted and the origin its high bits, so they can never disagree.

Colour RAM is the part that cannot be double buffered, and it is why the
technique is a raster problem rather than a blank-interval one. All 25
rows are written in four calls of `irqColB`, which fires at raster 4 each
field. The first call is limited to `BAND_FIRST` rows so it finishes
before row 6's badline, which is what the verdict checks; rows 0 to 4 can
still show old colour for one field on NTSC when `irqColB` starts late.
The matrix appears whole on the flip field; the colour
takes three more displayed fields to catch up, producing a transient
mismatch of about 60 ms PAL and 50 ms NTSC per crossing.

### Variations

- **AGSP.** Rewriting `$D011` and `$D016` per raster line, and the VM
  nibble mid-frame, gives a hardware-scrolled playfield without any matrix
  redraw at all, at the price of a per-line interrupt and a much harder
  stability problem. It is the standard answer when the whole screen
  scrolls and nothing else needs the CPU.
- **A panel that does not scroll.** A world of 25 rows plus a status area
  wants the split raster to become a mode change rather than a colour
  deadline; see `scroll_panel_split`.
- **Colour in one page.** If the world is one colour per screen, or the
  colour changes only on a flip that also changes the palette, the two
  halves collapse to nothing and the budget roughly halves.
- **Smaller worlds.** A world of 40 x 25 tiles or less needs no redraw at
  all, only the fine scroll and a wrap.

### Cycle budget

Measured in VICE x64sc 3.10 over runs of 20,946,000 cycles on each model,
with CIA 1 timer B read on entry to and exit from each of the three
handlers and the per-field totals compared, so badline stalls are
included:

| Model | Field | Worst field measured | Headroom |
|---|---|---|---|
| PAL | 19,656 | 13,111 | 6,545 |
| NTSC | 17,095 | 13,152 | 3,943 |

The worst field is the one that writes seven colour rows in `irqColB` and
seven matrix rows in `irqPrep`. A copy loop of `lda abs,x` / `sta abs,x`
/ `dex` / `bpl` is 14 cycles a byte in instruction terms and measures
17.6 to 17.8 with badlines (measured-vice, 25-row draw, 1,000 bytes, CIA
timer), so a 40-byte row costs around 710 cycles.

`BAND_MAX = 7` keeps every call within the available window: the prep
handler has 92 rasters from 152 + YSCROLL to 251, and the colour handler
has from raster 4 to 152 + YSCROLL. The first colour call uses
`BAND_FIRST = 5` rows instead of `BAND_MAX` to fit within NTSC's late
start. At half speed (one pixel every two fields), tile crossings are
sixteen fields apart on straight legs. The requirement is five fields: four
matrix preps plus four colour calls finish in the same four-field span, and
a flip is possible from the fifth field. The six-field minimum gap leaves
one field of slack.

### Recipes

- `recipes/kickassembler/eight-way-scroll.md`
