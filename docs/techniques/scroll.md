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
**Claims:** vic_xscroll (owns)
**Claims basis:** measured-vice

Read off a `scripts/claims-watch.ts` store trace of
`recipes/oscar64/soft-scroll-h.md`: the program's only unit store is
`$D016` changing XSCROLL, once a frame. Its zero-page bytes are Oscar64's
and its screen and colour RAM are the program's memory, so neither is the
technique's claim.

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
**Cost:** cycles_per_frame=46
**Cost basis:** measured-vice
**Cost measured on:** oscar64-simple-shmup (`stars_update` on a frame without a carry: the YSCROLL step and the `$D011` write, CIA2 timer A, screen on, PAL and NTSC; the carry frame's layer move is not the technique's)
**Claims:** vic_yscroll (owns)
**Claims basis:** measured-vice

The technique writes only `$D011` bits 0-2 (YSCROLL) and keeps bit 7
(store traces of `recipes/kickassembler/scroll-panel-split.md`,
`recipes/oscar64/simple-shmup.md` and `recipes/oscar64/vehicle-control.md`).
An earlier line said `none`, because no seeded unit held YSCROLL, and the
compatibility check then reported only a soft `shared_register` beside
`fld_flexible_line_distance`. The `vic_yscroll` unit
([#71](https://github.com/bdgscotland/c64-kb/issues/71)) makes that pair
an ownership conflict.

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

Measured on `recipes/oscar64/simple-shmup.md` (VICE x64sc 3.10, CIA2
timer A around `stars_update`, screen on): 46 cycles for the YSCROLL step
and the `$D011` write from Oscar64, the same on PAL and NTSC. That is the
Cost line. The carry once in eight frames moves the layer, which is not
this technique's work: that listing's 16 star cells took 3,525 to 3,802,
and a whole-screen move is `char_scroll_buffer_v`'s. A plan with a carry
lists the technique that moves the layer beside this one. The page had
no figure before #37.

### Recipes

- `recipes/kickassembler/scroll-panel-split.md` scrolls a playfield vertically through all eight YSCROLL phases above a fixed panel; `recipes/oscar64/soft-scroll-h.md` is the horizontal counterpart.
- `recipes/oscar64/soft-scroll-v.md` scrolls the whole text screen up one line a frame, measures the unrolled row move against the beam on PAL and NTSC, and builds the trap (`-dLATE_WRITE=1`: YSCROLL written on line 150 draws one row twice).

---

## char_scroll_buffer_h — Char-mode horizontal scroll with screen-RAM buffer rotation

**Complexity:** medium
**Region:** both
**Uses registers:** D016
**Uses kernal:** (none)
**Claims:** vic_xscroll (shares)
**Claims basis:** measured-vice

Store traces of `recipes/oscar64/soft-scroll-h.md`,
`recipes/kickassembler/sine-scroller.md`, `big-font-scroller.md`,
`dycp-scroller.md` and `cracktro-template.md`: each writes XSCROLL with one
`$D016` store a frame, and the carry's reset to 7 is that store's value
on the wrap frame. The carry follows `soft_scroll_h`'s phase, so it shares
the unit that technique owns, as `char_scroll_buffer_v` shares
`vic_yscroll`. Screen and colour RAM are the program's memory. The one
`$D018` store in the big-font and DYCP recipes is their own charset's.

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
**Claims:** vic_yscroll (shares)
**Claims basis:** derived-listing

Read off `recipes/kickassembler/scroll-panel-split.md`. The carry resets
YSCROLL in step with `soft_scroll_v`'s phase, so it shares the unit that
technique owns; an earlier line said `none`, before `vic_yscroll` existed
([#71](https://github.com/bdgscotland/c64-kb/issues/71)). The carry also
moves screen and colour RAM, which are the program's memory, not units. That listing copies with
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
- `recipes/oscar64/soft-scroll-v.md` moves 24 rows with an unrolled copy, top row first, from line 247: 7,403 cycles on PAL and 7,659 on NTSC, at least 114 and 66 lines ahead of the VIC's row fetches.

---

## row_map_redraw — Coarse vertical scroll as a full playfield redraw from a raw row map

**Complexity:** medium
**Region:** both
**Uses registers:** D011
**Uses kernal:** (none)
**Requires:** soft_scroll_v
**Alternative to:** char_scroll_buffer_v (redraws every row from the map instead of moving them; no colour RAM move and no seam row, but the level must sit in RAM as raw screen codes, 40 bytes a row, and the redraw frame has little time left for logic), eight_way_scroll_double_buffer (one screen and no `$D018` flip; vertical only, and the one-pass redraw must stay ahead of the beam)
**Cost:** cycles_per_frame=13304, every_n_frames=8
**Cost basis:** measured-vice
**Cost measured on:** kickassembler-row-map-redraw (one pixel a frame, so the redraw frame is every eighth; the redraw frame, 21 rows, CIA1 timer B, screen on, PAL: 13,916 measured, less the 546 cycles of per-row harness reads and the 66-cycle line-250 IRQ that `invalid_mode_band` already counts, arithmetic; 14,175 measured on NTSC; an earlier version said 14,673, measured with the copy loop across a page boundary and the harness included)
**Claims:** vic_yscroll (shares)
**Claims basis:** derived-listing

The redraw runs on the frame on which `soft_scroll_v` wraps YSCROLL, and the
new value must reach `$D011` for the same frame as the new rows, so it
shares the unit that technique owns, as `char_scroll_buffer_v` does. It
writes screen RAM and reads the map, which are the program's memory. Its
self-modified operands are the recipe's code, not a unit.

The redraw's 13,304 cycles fall on one frame in eight at the recipe's one
pixel a frame (its listing; one in four at two pixels a frame), and that
frame runs no other logic (How, step 6). The Cost line says so with
`every_n_frames=8`, and `c64_plan_budget` budgets that frame on its own. An
earlier Cost line had no such key, so the budget added the redraw to every
play frame: 36,916-47,124 cycles for the run-and-gun starter's plan, whose
measured logic frames are at most 3,049 (PAL) and whose redraw frame is
14,100 (templates/run-and-gun, KB-GAPS.md 1, VICE x64sc).

### Why

`char_scroll_buffer_v` moves 20 or 24 rows and writes one new row on a
coarse step, and it has to move colour RAM too. A game whose level is stored
as the screen itself, 40 screen codes a row, can skip the move: point the
copy at the map row now at the top and write the whole playfield. There is no
seam row to decode and no shift direction to get wrong, and if the whole
level is one colour, colour RAM is never touched.

### How

1. Store the level as raw screen codes, 40 bytes a row, row 0 at the top.
   The playfield's top row is map row `top`; the source for screen row r is
   `map + (top + r) × 40`.
2. Scroll with `soft_scroll_v`. When YSCROLL wraps (7 to 0 for content
   moving down), step `top` by one and redraw.
3. Start the redraw in the frame that still shows the old YSCROLL, once the
   beam has fetched row 0 there. A row may be rewritten as soon as it has
   been fetched: the VIC shows it from its buffer for the rest of the frame,
   and the new row is for the next frame. A copy slower than the beam then
   stays behind every fetch of that frame: it must need more cycles a row
   than 8 display lines leave the CPU, 8 × 63 − 43 = 461 on PAL and
   8 × 65 − 43 = 477 on NTSC with the row's badline (arithmetic). The
   recipe's `:early=64` starts on line 64 (row 0 is fetched on line 55 at
   YSCROLL 7). The simpler rule, after the last playfield row's badline
   (the recipe's default, line 225, when the band split ticks the frame
   counter), needs no rate condition and leaves a smaller lead. An earlier
   version of this step gave only the simpler rule.
4. Copy top row first with absolute indexed loads and stores whose operands
   are patched per row (`self_modifying_code`): `LDA map,Y` / `STA screen,Y`,
   Y from 39 down, then 40 added to both operands, 14 cycles a byte. Two
   bytes a pass, bytes Y and Y + 20 with Y from 19 down and four patched
   operands, is 11.5 cycles a byte and 503 a row with the patching (recipe
   `:pair=1`, instruction-table arithmetic).
5. Write the new YSCROLL for the next frame in the same frame as the redraw.
   An interrupt that runs between that store and the frame IRQ, such as a
   band split, must read the YSCROLL the frame shows, not the pending one
   (Pitfalls).
6. Divide the logic over the redraw frame and the frame after it. The
   redraw frame runs what ends before the copy starts; the rest waits one
   frame. With an early start the frame after is nearly whole (below, "The
   redraw pair in a game"). An earlier version of this step said "run no
   other logic on that frame, or only what fits", which leaves the frame
   after idle.

### Why it works

The VIC reads a character row from screen RAM once, on the row's badline,
and repeats it from its internal buffer for the other seven lines. After the
last playfield row's badline, screen RAM can change freely until row 0's
badline in the next frame. The copy starts in that gap and writes rows in the
order the beam reads them, so it only has to stay ahead, not finish, before
the display starts. Measured in VICE x64sc 3.10 on the recipe: from line 225
on PAL, rows 0-12 are written before line 48, and the last row finishes on
line 133 against its fetch on line 208. On the display lines a row costs
about 11 lines because of the badlines, so the lead shrinks by about three
lines a row, to 75 lines at row 20. On NTSC, whose frame is 263 lines,
only rows 0-7 are done by line 48 and the lead at row 20 is 29 lines. An
earlier version said 62 and 17 lines and a finish on line 145, from a build
whose copy loop crossed a page and so cost 15 cycles a byte.

Started on line 64 instead (`:early=64`), the same copy runs behind the
beam through the frame that shows YSCROLL 7 and ends on line 306 of it on
PAL, line 35 of the next frame on NTSC. The lead at row 20 is 216 lines on
PAL and 175 on NTSC. In 480 exit screenshots over the early builds (80 per
build and model, one every 39 PAL or 32 NTSC lines over ten frames) no row
showed out of order.

### When not to use it

- **Maps with colour per cell.** The redraw would need 840 more bytes into
  colour RAM, which has no second page; use `tile_map_render` with
  `char_scroll_buffer_v` or `eight_way_scroll_double_buffer`.
- **Tight memory.** A raw map costs 40 bytes a row, 7.5 to 8 KB for a level
  of about 190 rows. Metatiles (`tile_map_render`) store the same level in a
  fraction of that, but decoding them inside the copy adds cycles to every
  row of the race (not measured here); see the metatile variation below.
- **Heavy logic every frame.** With the start after the last badline, the
  redraw frame keeps only the time between the copy's end and the next
  interrupt: in the recipe, about 4,360 cycles on PAL and 1,780 on NTSC
  (arithmetic from the measured end lines, badlines taken off; an earlier
  version said 4,131 and 1,332 and did not count the harness report that
  then ran in that time). With the early start the copy takes the middle of
  the redraw frame and the logic moves to the frame after (How step 6). If
  no logic may wait a frame in eight, spread the move over the seven quiet
  frames into a second screen and flip `$D018`
  (`screen_double_buffer_d018`).

### Pitfalls

- **Starting late tears.** The recipe's `:wait=10` build starts the same copy
  on line 10: rows 0-12 are new, rows 13-20 show the old picture, and the
  PNG shows one map row missing between screen rows 12 and 13. The harness
  reported a lead of −18 lines at row 17.
- **Rows and YSCROLL in different frames jump.** A trial build that started
  the copy on line 40 wrote every row after its fetch: the whole frame showed
  the old rows at the new YSCROLL 0, a jump of seven pixels and back, not a
  tear. Both must change for the same frame.
- **Overtaking the beam.** A copy that starts before row 0's fetch, or
  runs faster than the beam, writes a row before the VIC fetches it in the
  current frame, and that row shows the new content at the old YSCROLL. The
  recipe's rows take about 10 lines; the two-byte loop's 503 cycles a row
  is still above the 461 (PAL) and 477 (NTSC) that 8 display lines leave
  (How step 3). A fully unrolled `LDA abs` / `STA abs` copy, 8 cycles a
  byte and 320 a row, would overtake the beam from line 64 (arithmetic;
  not built). An earlier version of this
  item said any start before line 215 overwrites unfetched rows; a slower
  copy started after row 0's fetch does not (recipe `:early=64`).
- **NTSC has less room.** 49 fewer lines between the playfield's end and the
  next frame's first badline; the recipe's lead falls from 75 lines to 29
  with the default start, and from 216 to 175 with `:early=64`.
- **Sprite DMA comes off the lead.** Every sprite on a line the copy runs
  over takes its DMA cycles from the copy. The recipe's `:sprites=8`, eight
  Y-expanded sprites on lines 92-133, added 879 cycles on PAL and 899 on
  NTSC and cut the lead by 14 lines on each (75 to 61, 29 to 15); on lines
  the copy has left they cost it nothing (PAL, `:spry=160`). FIREBASE
  (`templates/run-and-gun`, measured in VICE on that starter, its PLAN.md)
  lost the same way: NTSC lead 27 lines with the soldier alone, 13 with
  eight sprites up (redraw 14,317 to 15,231 cycles), 21 with up to four
  weapon sprites more. An earlier version of this page gave the leads
  without saying they were measured with no sprites.
- **Every interrupt inside the copy comes off the lead too.** With the
  default start the frame IRQ on line 250 lands inside it; with the early
  start the band split does as well. A once-a-frame music player in that
  IRQ is the usual large one; see the hold under Variations.
- **A mid-frame interrupt that reads the pending YSCROLL.** With the early
  start the next frame's YSCROLL is stored on line 64, and the band split
  on line 211 of the same frame still has to match the YSCROLL shown. The
  first `:early` build read the pending 0 there: on the redraw frame the
  panel text was shifted 15 to 20 columns or garbled (11 of 80 PAL exits, 8
  of 80 NTSC). Keep the shown and pending values apart: the recipe reads
  `$D011`; FIREBASE keeps `cur_ys` and `pend_ys`.
- **The lead past the frame IRQ.** A copy that starts early can end after
  the frame IRQ that applied YSCROLL 0 but inside that same frame (PAL
  lines 250-311). Row 20's fetch is then the next frame's line 208: the
  lead is 208 + lines a frame − end line (216 lines in `:early=64` on PAL),
  not negative. FIREBASE's own sum took such an end as late and read a PAL
  lead of 0 when it was 209 (`templates/run-and-gun/KB-GAPS.md`, gap 35).
- **The frame tick.** A redraw, or the work after it, that runs past the
  next frame-counter tick makes a wait-for-change loop miss a frame. The
  `:wait=10` build ends on line 252, after the tick on 224, and loses a
  frame on every redraw. An earlier recipe build printed its report (about
  3,500 cycles) right after the redraw; on NTSC that ran past the tick, so
  it scrolled one pixel in nine frames on every coarse step.
- **A copy loop across a page.** A taken branch into another page costs one
  more cycle. With `BPL` crossing a page, the copy is 15 cycles a byte, 819
  more a redraw. The recipe's PAL lead was 62 lines with its loop across a
  page and is 75 in one page, although its harness now spends 168 more
  cycles. Assert that the loop sits in one page.

### Variations

- **Spread over the quiet frames.** Build the next screen three rows a frame
  in a second matrix and flip `$D018` on the wrap frame: no race, no logic
  skipped, 1 KB more RAM (`screen_double_buffer_d018`).
- **Direction.** Content moving up steps `top` the other way and wraps
  YSCROLL from 0 to 7; the copy order stays top row first (not built here).
- **Metatile map.** Decode metatiles into a raw row buffer during the quiet
  frames, then run this copy from the buffer.
- **Hold a once-a-frame player off the copy.** Set a flag before the
  redraw and clear it after. The frame IRQ under the flag only counts the
  step it owes, and the next frame IRQ plays the owed step before its own.
  FIREBASE (its PLAN.md "Audio", measured in VICE on that starter): 15
  cycles under the hold (arithmetic from its code); NTSC lead 27 lines
  before and after adding the music; the tune keeps its tempo because its
  ticks are counted in steps, and a step is one frame late on 13 of 839
  frames. The IRQ that plays two steps took up to 1,188 cycles on NTSC, 19
  lines. Playing the owed step at the redraw's end instead pushed the frame
  after from NTSC line 205 to 232 and ran the step among badlines (868
  cycles against 782).

### The redraw pair in a game

FIREBASE, the `templates/run-and-gun` starter (Oscar64 C with a
KickAssembler kernel, a 16-slot multiplexer, enemies, weapons and music),
measured in VICE x64sc 3.10 on that starter (its PLAN.md "Combined budget",
commit 5dc1784). Its loop wakes on the frame IRQ at line 250.

- **Before.** The copy waited for the band's tick on line 224 and moved 14
  cycles a byte, and the whole frame's logic ran ahead of it. A raster
  trace of the redraw frames (NTSC, most lines per call): soldier 13, spawns
  9, objects' think 73, weapons 27, collisions and rules 8, draws 9, sort
  and build 65. The logic ended on line 202; the CPU idled to line 224; the
  copy (17,533 cycles) then ran past line 208 of the next frame. NTSC lead
  0 lines; `make weapons` lost 2 frames on PAL and 6 on NTSC.
- **After.** The redraw frame runs the soldier and the spawns, moves and
  sorts the sprites only if that ends before line 64, commits YSCROLL 0 and
  starts the copy on line 64. The frame after runs the soldier's repeat
  step, the weapons, the collisions and the rules. No enemy thinks on
  either frame: each misses one think in eight frames while the map
  scrolls. With the two-byte copy as well: NTSC lead 159 lines and PAL 195
  in `make weapons`, 0 lost frames on both, and the frame after ending by
  NTSC line 197 (limit 250). A 2,700-frame drive with 75 redraws read leads
  of 211 and 168 lines and no lost frame.
- **Objects on the redraw frame.** Moving the objects with the ground
  there, as Commando does, cost FIREBASE 2,553 cycles on PAL (the pool's
  move and a table build without a sort, about 40 lines). With the copy
  after line 224 that fitted after it on PAL (frame end 207-210) and not on
  NTSC, where the copy ended on line 195 and the band IRQ holds 211-224:
  forced, the run lost 6 frames. With the early start the move runs before
  line 64 when it fits; on NTSC, where the soldier's step ends about line
  20, it does not, and the sprites keep last frame's lines for one frame
  and move two lines on the frame after.

### Cycle budget

Measured in VICE x64sc 3.10 with CIA1 timer B around the redraw, screen on:
13,885 to 13,916 cycles on PAL and up to 14,175 on NTSC, including the
line-250 interrupt that lands inside, the badline stalls and 546 cycles of
harness reads. The recipe's variants, the same way: `:pair=1` 12,581 to
12,631 on PAL and up to 12,874 on NTSC; `:early=64` up to 15,068 and
15,095, with the band split inside; both together up to 13,857 and 13,879,
with leads of 235 and 192 lines. Without the harness and the interrupt that is about 13,304 on
PAL (arithmetic). The inner loop is 14 cycles a byte, 559 a row, plus a
cycle per page-crossing load (arithmetic), if the loop does not cross a
page itself. The copy ends on line 135 on PAL and 181 on NTSC; the band
split's interrupt comes on line 211, so logic on the redraw frame has about
4,360 cycles on PAL and 1,780 on NTSC. An earlier version gave 14,673 and
14,889 cycles and 4,100 and 1,300 left, from a build whose loop crossed a
page and whose report ran on the redraw frame.

### In Commando (1985)

Measured in VICE x64sc 3.10 (PAL C64C) on the maintainer's copy (rung 1).
The playfield is 21 rows on one screen with no second matrix. Every eighth
frame while scrolling, the game redraws all 21 rows, 840 bytes, from a raw
map: screen codes, 40 bytes a row, row 0 at the top, no tiles or
compression, 7,480 to 7,960 bytes per area, three areas resident. The copy
is a self-modified absolute-indexed load and store, top row first. It starts
on line 244, after the main loop wakes on the frame counter at about line
217, and returns on line 181 of the next frame: 15,714 cycles with
interrupts. Row 20 is written on line 182 and fetched on 208, so the copy
leads the beam by at least 26 lines. That frame runs no game logic except
object motion, and the frame still had at least 859 cycles spare in 77
measured redraw frames. Colour RAM is filled once per area with one
multicolour value and never scrolled.

### Recipes

- `recipes/kickassembler/row-map-redraw.md`: a 21-row playfield scrolling down one pixel a frame over a band and a panel, redrawn from a 60-row raw map on every wrap, with the redraw's lines, cycles and lead printed, a torn `:wait=10` build, and builds that start on line 64 (`:early=64`), copy two bytes a pass (`:pair=1`) and put eight sprites on the copy's lines (`:sprites=8`).

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
**Claims:** vic_raster_irq (owns), vic_yscroll (shares), vic_matrix_base (shares)
**Claims basis:** derived-listing

The split writes the panel's YSCROLL 7 and screen matrix mid-frame and
restores the playfield's below the panel, so it follows the values
`soft_scroll_v` and the program set: `shares`, not `owns`. A store trace
of the recipe (`scripts/claims-watch.ts`) saw both fields change; its
`$D016` store changes only CSEL, not XSCROLL. The two `shares` items were
added with the units ([#71](https://github.com/bdgscotland/c64-kb/issues/71)).

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

## threshold_scroll_v — Player-driven one-way vertical scroll past a threshold line

**Complexity:** low
**Region:** both
**Uses registers:** D011
**Uses kernal:** (none)
**Requires:** soft_scroll_v
**Cost:** cycles_per_frame=340
**Cost basis:** measured-vice
**Cost measured on:** kickassembler-threshold-scroll-v (worst tick of 132 frames: step applied, three objects moved, `$D011` and four sprite Y registers written, next step decided; in the lower border, no badline inside; the coarse redraw is not included)
**Cost includes:** soft_scroll_v
**Claims:** none
**Claims basis:** derived-listing

The technique's own work is a decision and RAM: the step byte, the
player's Y and the objects' Y table. The YSCROLL store belongs to
`soft_scroll_v`, which owns `vic_yscroll`; the sprite registers belong to
whatever displays the objects (the recipe's own `claims:`, or a
multiplexer's).

### Why

A game on foot that moves up a long map needs the view to advance when
the player advances, and only then. Scrolling at a constant rate (an
autoscroller) takes the pace away from the player. Following the player
in both directions needs a two-way coarse step and lets the player walk
back to ground already cleared. A threshold line gives the player the
lower part of the screen to move in and turns any push past the line
into scroll.

### How

Each frame, in this order:

1. **Apply last frame's step.** If the step is 1, add 1 to the fine
   scroll (0-7). When it wraps to 0, decrement the map row counter and
   make the coarse step: the screen now shows the map from one row
   higher. Add the step to the Y of every ground object, never the
   player's.
2. **Write the display** below the last visible line: YSCROLL into
   `$D011` and every sprite Y, in the same frame, so the field and the
   objects move on the same displayed frame.
3. **Decide the next step from input.** Step = 0. If up is held and the
   player's Y is below the line (a larger Y), move the player up. If up
   is held at the line and the map row is not 0, step = 1 and the player
   stays. At map row 0, the player may walk on up to a top limit.
4. **Switch off an object that leaves.** An object whose Y passes the
   bottom of the display is freed; a sprite Y is 8 bits and wraps.

There is no reverse step: down never scrolls back, so the coarse step
only ever brings in a new top row.

### Why it works

The map row counter and the fine scroll together are the camera: screen
row k shows map row `row + k`, displaced by YSCROLL pixels. Adding the
same step to an object's Y that the field moves keeps the object on the
same map cell. In the recipe's run on VICE x64sc 3.10, PAL and NTSC, a
10x10 outline sprite drawn one pixel above and left of a marker cell was
still one line above the marker in 19 PAL and 13 NTSC screenshots taken
across the walk, the 48 scroll frames and the walk after them, and on
the final frame (outline lines 143-152, marker lines 144-151). The
player's sprite stayed on lines 145-160 (Y 144) through every scroll
sample, and moved again only after the map ended.

The step decided on frame N is applied on frame N+1. In the recipe the
player reaches the line on frame 64, the step is set that frame, and the
field first moves on frame 65. The scroll ran for 48 frames, 8 per map
row over 6 rows, and the row counter reached 0 on frame 112, printed by
the program itself on both models.

### Cycle budget

The decision is a few compares; the object loop is one add per object.
The recipe times one whole tick with CIA 2 timer A, less an empty call:
at most 340 cycles on PAL and 334 on NTSC over 132 frames, including the
`$D011` store and four sprite Y stores. The 6-cycle difference between
the models was not traced; sprite DMA for objects near the bottom of
the display, still fetched around line 251, may fall inside the timed
tick (not tested). The `**Cost includes:**` line stops a budget
counting `soft_scroll_v`'s 46 cycles a second time.

The coarse step is not this technique's cost, but it sets the frame. The
recipe redraws all 25 rows from a raw 40-byte-per-row map (a copy loop
unrolled two ways) after the tick. It starts a few lines after the
loop's line-251 poll (the timer calls, the tick and the dirty check run
first; the start line was not recorded) and ends on
line 180 of the next frame on PAL and line 226 on NTSC (measured by the
program, `$D012` after the copy). Screen row 24 is first shown on line 240
at YSCROLL 0 (48 + 8 × 24, arithmetic), so the copy finishes 60 lines
ahead of the beam on PAL and 14 on NTSC. An earlier draft of the recipe,
with a one-byte loop, ended on NTSC line 246, which put rows 22-24 behind
the beam on that frame (arithmetic from the end line; that build was not
shot on the redraw frame).

The copy need not wait for the display's end. One slower than the beam
can start as soon as row 0 has been fetched in the frame that still shows
the old YSCROLL (`row_map_redraw`, "How" step 3): the row-map-redraw
recipe's `:early=64` build leads the beam by 216 lines on PAL and 175 on
NTSC, against 75 and 29 from its default start. The logic then divides
over the redraw frame and the frame after it; how one game did that, and
what moving the objects with the ground on the redraw frame cost it, is
in `row_map_redraw`, "The redraw pair in a game".

### When not to use it

- The player must be able to go back: use a two-way scroll, with a
  coarse step in both directions.
- The pace is the design, as in a shoot-em-up: scroll at a fixed rate
  with `soft_scroll_v` and `char_scroll_buffer_v`.
- The map scrolls in X as well: `eight_way_scroll_double_buffer`.

### Pitfalls

- **Objects written in another frame than YSCROLL slip by a pixel.**
  Write YSCROLL and every sprite Y in the same window below the display
  (the recipe does; the slip itself was not run here).
- **An object that scrolls off the bottom comes back at the top.** A
  sprite Y is 8 bits: the recipe's third object would reach Y 214 + 48 =
  262, which wraps to 6 (arithmetic). The recipe frees it at Y 248, below
  its 24-row display (lines 55-246, measured).
- **The coarse step races the beam.** The recipe's full redraw runs
  from a few lines after line 251 to line 180 of the next frame on PAL, about
  15,000 cycles; start it just below the display, or once row 0 has been
  fetched (above), and check where it ends. Sprites on the lines it runs
  over and interrupts inside it take cycles from its lead (`row_map_redraw`,
  Pitfalls).
- **Step 1 on the redraw frame.** Moving every ground object on the frame
  of the coarse step costs time the copy needs: 2,553 cycles on PAL in
  FIREBASE, which did not fit on NTSC (`row_map_redraw`, "The redraw pair
  in a game").
  Double buffering the screen with a `$D018` switch removes the race.
- **Spawns and collision must use the map row counter.** An object
  placed from the map at row r appears at `(r − row) × 8` plus the fine
  scroll plus the top offset; the map cell under a sprite is found from
  the same counter.
- **Limit the threshold.** The space above the line is the only warning
  the player gets of what comes down.

### In Commando (1985)

Measured in VICE x64sc 3.10 on the maintainer's copy (PAL C64C). While up
is held the player walks until his sprite Y is $A3; he moves while it is
$A4 or more. From then on the map scrolls under him at 1 pixel a frame,
with no speed variation. A step byte, $FF or 0, is recomputed from the stick
by the player routine on every frame that is not a redraw frame (on the
redraw frame the routine is skipped and the byte keeps $FF). The object update subtracts it
from the Y of the 15 other slots, not the player's, so enemies and
pickups move 1 pixel a frame with the ground; scenery is characters in
the map. A map row counter counts down to 0, the top of the area; the
scroll then stops and the player may walk on up to Y $6E. Down never
scrolls back. The coarse step, every eighth frame, is a full redraw of
the 21-row playfield from the map, 15,714 cycles including interrupts,
and the game skips its other logic on that frame. Enemy spawns are keyed
to the map row counter.

### Recipes

- `recipes/kickassembler/threshold-scroll-v.md`: a scripted walk up to a threshold, 48 frames of scroll with three ground objects locked to their cells, one freed below the display, the stop at the map's end, and the measured tick and redraw end line printed on screen, PAL and NTSC.

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
**Alternative to:** soft_scroll_h (scrolls a pixel-accurate drawn scene, not characters; the whole 8,000-byte bitmap must be shifted or double-buffered)

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
**Consumes formats:** CTM

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
**Claims:** vic_char_base (owns)
**Claims basis:** measured-vice

Store trace (`scripts/claims-watch.ts`, VICE x64sc, PAL) of
`recipes/kickassembler/dycp-scroller.md`: one `$D018` store (`$1C`) moves
the character base to the strip charset at `$3000`, which the copy
rewrites every frame. The matrix stays at `$0400`. The `$D016` stores are
`soft_scroll_h`'s; the raster interrupt and the CIA2 timer are the
recipe's frame tick and harness.

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

- **AGSP.** A few `$D011` writes at the top of the frame (linecrunch,
  FLD and one late badline) and one `$D016` write place the whole screen
  at any pixel position with no matrix redraw; see `agsp_free_scroll` in
  `techniques/raster.md`, measured. The writes hold the CPU only for the
  band above the text, from a stable raster, and the late badline is a
  VSP write with its crash risk. An earlier version of this item said
  AGSP rewrote `$D011` and `$D016` on every raster line and the video
  matrix nibble mid-frame, with a per-line interrupt; the codebase64 AGSP
  example and the recipe do neither.
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

---

## centred_sprite_map_scroll — The world moves under a player fixed at screen centre

**Complexity:** medium
**Region:** both
**Uses registers:** D011, D012, D016, D018
**Uses kernal:** (none)
**Requires:** soft_scroll_h, soft_scroll_v, screen_double_buffer_d018
**Alternative to:** eight_way_scroll_double_buffer (the whole window is redrawn from the map once every few frames and the fine scroll goes to the IRQ through one dirty byte, instead of a matrix prep on every pixel step with the colour RAM copied over four fields; the camera moves at the rate the game chooses and colour RAM is one value for the world)
**Cost:** cycles_per_frame=16923, every_n_frames=5, bytes_code=1177, bytes_data=3152
**Cost basis:** measured-vice
**Cost bytes basis:** derived-listing
**Cost measured on:** kickassembler-centred-sprite-map-scroll (one step: the stick read, the turn, the camera move, the 1,000-byte window redraw, the pose write and the report rows, screen on; 16,750 on NTSC; the redraw alone is 15,013 and 14,972)
**Claims:** none
**Claims basis:** derived-listing

The registers the hand-off writes belong to the techniques this one
composes: `$D011`'s YSCROLL is `soft_scroll_v`'s, `$D016`'s XSCROLL is
`soft_scroll_h`'s, and the `$D018` page is `screen_double_buffer_d018`'s.
The raster interrupt and the sprite are the recipe's claims, and the map,
the window and the one dirty byte are the program's own memory.

### Why

A player crossing a world map must stay on screen and stay steerable,
and the world must move when he moves, and only then. Scrolling at a
fixed rate takes the pace away from the player. Walking a sprite around
a map larger than the screen means sprites leave the display and the
game must decide what to draw at the edges. Fixing the player at the
centre turns all of that into one question: where is the camera?

The work is then a window redraw, and it wants to be cheap, predictable
and off the beam's path. Rewriting a 40 x 25 window every frame is too
much for a game that also runs logic; rewriting it once every few frames
gives the game a step it can budget.

### How

Hold the camera in map pixels, `camx`, `camy`. Everything else derives
from those two bytes:

1. **The window.** Matrix row k shows map row `(camy >> 3) + k` and
   matrix column c shows map column `(camx >> 3) + c`. `XSCROLL = 7 −
   (camx AND 7)` and `YSCROLL = 7 − (camy AND 7)`; a map pixel (x, y)
   then draws at VIC x `31 + x − camx` and raster line `55 + y − camy`
   (arithmetic from the two register writes, measured exactly on the
   recipe's landmark cells). A 40 x 25 matrix covers a 38 x 24 window at
   every fine scroll when CSEL and RSEL are 0: the partial column and
   row at each edge are behind the border.
2. **A step every N frames.** The step reads the stick, turns the facing
   one step toward the stick's direction (`facing_turn_step`), moves the
   camera one map pixel along the facing, and redraws the window from the
   map into the matrix that is not on display. The player's sprite keeps
   its X and Y; only its pointer changes, to the pose for `facing >> 1`.
3. **One dirty byte.** The step stores the fine X, the fine Y and the
   screen page of the matrix it drew, and sets bit 7 of the page byte.
   The raster IRQ sees that bit on line 0, writes `$0288`, `$D018`,
   `$D016` and `$D011` from the block, and clears the bit. The IRQ never
   reads the map; the map code never writes `$D011`, `$D016` or `$D018`.
4. **Between steps the technique does nothing.** The step is one unit of
   work, and the frames around it are the game's.

### Why it works

The camera is one number pair and the registers cannot disagree with
it: the fine scroll is the low three bits of the camera inverted, the
window origin is its high bits, and one store moves both. The flip is
one `$D018` write in the IRQ, atomic from the viewer's side, so the
window never shows a half-redrawn frame. Because the copy writes the
matrix that is not on display, it may run over the display's own lines:
the recipe's 1,000-byte copy ends on line 245 on PAL and 234-237 on
NTSC, inside the window's lines 55-246 (measured), with no tear.

The player is one sprite at a fixed position with a table of heading
poses, so turning is one pointer write and the hardware draws it. A
world of one colour per cell keeps the copy to screen codes; a world
that colours its cells has to move colour RAM as well, and colour RAM
is not paged (`eight_way_scroll_double_buffer`).

### Variations

- **Redraw the visible matrix and accept the tear.** One matrix and no
  `$D018` flip: the copy writes what the beam is reading. On the seven
  steps in eight where the camera did not cross a cell the bytes are
  unchanged and nothing shows; the crossing step can tear.
- **Redraw only what changed.** One pixel a step crosses a cell every
  eight steps, and then one row or one column enters the window: 25 or
  40 bytes instead of 1,000. The step rate and the dirty byte stay as
  they are.
- **A step the game chooses.** The rate is a constant: one step every
  four frames for a light redraw, every eight for a heavy one. What the
  player sees is the camera moving at that rate, or not at all.
- **Colour per cell.** Colour RAM is one value in the recipe. Moving it
  with the window needs its own copy every step and cannot be double
  buffered.

### Cycle budget

Measured in VICE x64sc 3.10 with CIA 2 timers A and B around the redraw
and the whole step, screen on, PAL C64C and NTSC 6567R8:

| | PAL | NTSC |
|---|---|---|
| Frame | 19,656 cycles | 17,095 cycles |
| Window redraw, 1,000 bytes | 15,013 (76%) | 14,972 (88%) |
| Whole step | 16,923 (86%) | 16,750 (98%) |
| The redraw returns on line | 245 | 234-237 |

The step runs once in five frames, so the four frames between steps
spend none of this. What they do spend is the frame counter's increment
and the test of the dirty byte in the IRQ, 12 cycles (arithmetic from
the listing); a plan that counts every cycle adds that to the IRQ's own
frame cost. The copy is 11.5 cycles a byte plus about 50 a row for the
self-modified pointers (arithmetic), and the measured figure carries the
badline stalls and the sprite fetches it runs across.

### In Pirates! (1987)

Measured in VICE x64sc 3.10 on the maintainer's copy (rung 1). The image
is a cracked copy, and its start-up options menu patched five
interpreter table entries, so an opcode meaning read from it describes
that copy. The sailing map is characters in multicolour mode (screen
$E400, charset $E000, VIC bank 3), with the world map a static
3,048-byte block at $C000. The ship is two overlaid sprites fixed at
x=180, y=144 and never leaves the centre: the world scrolls under it.
Its heading is a sprite-pointer pair, $40+H and $50+H for H=0-15, and a
left turn decrements H one step. One step is about 102,700 cycles, 5.2
PAL frames (measured): poll the stick, redraw the window matrix from the
map ($9BAE), hand the fine scroll over, update the sprites. The hand-off
is a three-byte block at $9B80: fine X at +$0A, fine Y at +$0B, and the
screen page with a dirty flag at +$0C. A routine in the IRQ path
($97BE-$97E1) writes $0288, $D018, $D016 and $D011 from those and clears
the dirty byte; 898 such applies were traced in one measured window. The
IRQ never reads the map, and the map code never writes the scroll
registers. The window is redrawn whole every step into the visible
matrix, with a second 1,000-byte buffer at $CC00 holding the same window
one character to the right as the scroll's working copy. Colour RAM
holds a multicolour index per cell and is written with the window. The
measured step advanced 2 units of window X and one fine pixel; the
recipe here redraws into the matrix that is not on display and flips the
page in the IRQ, which the study's own block already carries as its
third byte.

### Recipes

- `recipes/kickassembler/centred-sprite-map-scroll.md`: a 64 x 40 map under a ship fixed at the centre of a 38 x 24 window, eight heading poses, a scripted stick, a step every five frames, the redraw and the whole step timed against the frame on PAL and NTSC, and a second pinned run 600,000 cycles later that shows the window moved by exactly the camera's six pixels.
