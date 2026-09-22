---
category: text
chip: VIC-II
---

<!-- doc-type: technique-reference -->

# Text Techniques

Reading typed text from the keyboard and showing it in the character
screen: a name-entry field for a high-score table, a password prompt, a
save-game name. The key path is the KERNAL's, the echo path is a direct
write of screen codes into screen RAM, and the cursor is drawn by the
program, not by the KERNAL's screen editor. Every number below that came
from an instrument says so; the rest is marked as arithmetic or as not
measured here.

---

## text_input_line — Name entry with echo, DEL, RETURN, a length cap and a blinking cursor

**Complexity:** low
**Region:** both
**Uses registers:** D011
**Uses kernal:** GETIN
**Cost:** cycles_per_frame=200
**Cost basis:** estimated

### Why

A game that wants a name typed into a field cannot hand the screen to the
KERNAL's line editor: CHRIN scrolls, wraps, and returns only when RETURN
is pressed, and the whole frame loop stops while it waits. What the game
needs is one key per frame, an echo at a fixed place on the screen, a cap
on the length, a filter that admits only the characters the high-score
table can show, and a cursor that keeps blinking while nobody types.

### How

Once per frame:

1. Fetch one key. On the KERNAL path this is GETIN (`$FFE4`), which
   returns the next PETSCII byte from the keyboard queue at `$0277` and
   `0` when the queue is empty, so it never blocks
   (`hardware/kernal-routines-reference.md`, "Polling input non-blocking
   in a game loop" is the same call in the same position). In Oscar64
   `getchx()` is that call: `conio.c` defines `bsin` as `$FFE4` and
   `getchx()` returns `0` with no key waiting; `getch()` is the blocking
   form and stalls the frame loop, so use it only where nothing else
   moves. `kbhit()` reads the queue count at `$C6` if you want to know
   before fetching.
2. Test for RETURN first. GETIN delivers `$0D`; Oscar64's `getchx()`
   delivers `$0A` under the default character map
   (`pitfalls/kernal-and-io.md`, `getchx_petscii_remaps_return`), so
   accept both. A `$0D` test alone never fires in an Oscar64 program
   that has not called `iocharmap(IOCHM_TRANSPARENT)`.
3. Test for DEL, PETSCII `$14`. If the length is non-zero, clear the cell
   the cursor sits on, then decrement the length. The cell that held the
   deleted character is the cursor's new cell and is redrawn in step 5.
4. Otherwise filter and echo. Convert the PETSCII byte to a screen code
   and reject anything outside the set the field allows. For the echo
   the conversion is two ranges: unshifted letters `$41` to `$5A` become
   screen codes `$01` to `$1A` (subtract `$40`); digits, space and the
   punctuation `$20` to `$3F` keep their value. Everything else,
   including cursor keys, colour codes, function keys and shifted
   letters (`$C1` and up), is dropped. If the length is below the cap,
   store the PETSCII byte, write the screen code into the field's next
   cell, and increment the length. At the cap the key is ignored and
   the cursor stays put.
5. Draw the cursor. The cursor cell is the one after the last accepted
   character. Write a space with bit 7 set (`$A0`, reverse video) when a
   chosen bit of the frame counter is set, and a plain space (`$20`)
   when it is clear. Bit 4 gives 16 frames on, 16 frames off, about
   three blinks in two seconds on PAL (arithmetic from 50 frames a
   second). The reverse-video bit is the top bit of the screen code, so
   the cursor needs no second character set and no colour RAM write.
   When the field is full the cursor sits in the cell one past the cap,
   so anything drawn round the field, a bracket or a box edge, has to
   leave that cell free or the cursor will overwrite it.

When RETURN arrives, write a plain space over the cursor cell so it does
not stay reversed, and hand the stored bytes to the caller. Store the
PETSCII bytes rather than the screen codes: a high-score file, a CHROUT
print or a later compare all want PETSCII, and the echo can be recomputed
from them with the same two-range conversion. The full PETSCII, ASCII and
screen-code mapping is not on this page; only the part the echo needs is
given here.

### Why it works

The KERNAL's IRQ scans the matrix once a jiffy and puts PETSCII bytes in
the ten-byte queue at `$0277` to `$0280`, with the count at `$C6`
(`hardware/kernal-routines-reference.md`; Oscar64's `kbhit()` reads
`$C6`). GETIN takes the head of that queue, or returns `0` when the
count is zero, which is why the poll costs almost nothing in an idle
frame. Nothing in that path touches the screen, so echoing is the
program's job and it can put the character anywhere it likes by writing
screen RAM directly, at `$0400` plus `40 * row + column` on the default
screen. The KERNAL's own screen editor is never called, so the cursor
the editor draws does not appear; the program's frame counter reverses
the cell of its choosing instead.

Frame counting comes from a wait on the raster: the technique's counter
advances once per `vic_waitFrame()` in Oscar64, which spins on bit 7 of
`$D011` (raster line 256 and above) clearing and then setting, so one
increment per frame on either model. The keyboard queue is filled from
the KERNAL's IRQ regardless of what the main loop is doing, so a key
pressed between two polls is not lost; only a burst of more than ten
keys inside one frame overflows the queue, and the KERNAL drops the
excess.

The KERNAL's own auto-repeat applies on a real keyboard: with the
default repeat flag at `$028A` only the cursor keys, space and DEL
repeat, so holding DEL empties the field after the repeat delay while a
held letter enters once. Not measured here: VICE's `-keybuf` feeds the
queue directly and cannot hold a key (`recipes/oscar64/joystick-input.md`
records the same limit).

### Variations

- **Games that own the IRQ.** If the KERNAL's IRQ is replaced, nothing
  fills the queue and GETIN returns `0` forever. Read the matrix
  yourself with `keyboard_matrix_scan` (`techniques/input.md`): its
  scan returns a key's column and row, not a PETSCII byte. INST/DEL is
  column 0, row 0 and RETURN is column 0, row 1
  (`hardware/cia-reference.md`, the full-matrix table). Oscar64's
  `keyb_poll()` fills `keyb_key` with a scan code and `keyb_codes[]`
  in `<c64/keyboard.h>` maps that to PETSCII (first 64 entries
  unshifted, next 64 shifted), after which steps 2 to 5 apply
  unchanged.
- **Restricted alphabets.** A three-letter arcade initials field takes
  only `$41` to `$5A`; a numeric field only `$30` to `$39`. The filter is
  the only line that changes.
- **Cursor as a character.** Instead of reversing a space, write an
  underscore (`$64`) or a block (`$A0`) on the on phase and the cell's
  own content on the off phase. Reversing the cell itself (`code ^
  $80`) lets the cursor sit on top of an existing character, which a
  field with an insert point in the middle needs.
- **Blocking entry.** If the frame loop has nothing else to do,
  `getch()` blocks inside GETIN's caller until a key arrives; the
  cursor then has to be blinked from an interrupt or not at all.

### Cycle budget

Not raster-critical. The poll is one GETIN call on an empty queue per
frame, well inside any frame budget; the cost was not measured here.

### Recipes

- `recipes/oscar64/text-input.md`

## decimal_print — Decimal score and counters written as screen codes

**Complexity:** low
**Cost:** cycles_per_frame=1361, bytes_code=0
**Cost basis:** measured-vice

**Why.** A HUD shows a score, a timer, lives, a coordinate, and it shows
them every frame or every time they change. The KERNAL's number printing
goes through the screen editor, moves the cursor, and clobbers registers;
a game wants five screen codes written straight into screen RAM.

**How.** The 6502 has no divide instruction, so the digits come from
repeated subtraction of powers of ten: subtract 10,000 while it fits,
counting; then 1,000; then 100; then 10; what is left is the units digit.
Each digit is `$30` plus the count as a screen code. Leading zeros become
spaces or stay as zeros by choice. Redraw only the fields that changed,
because the cost is per call, not per frame.

**Why it works.** The worst case is nine subtractions per digit, each a
16-bit compare and subtract of a constant, which is cheap on the 6502.
Double-dabble (shift and add-three) is the textbook alternative and is
more than twice as slow here, because the 6502 shifts and adjusts one
byte at a time.

**Variations.** BCD counters kept in decimal mode (`SED`) give one digit
per nibble and print with a shift and a mask, at the price of the decimal
flag inside an interrupt (`decimal_mode_in_irq_handler`). Hex output for a
debugging display is a table lookup per nibble. A changed-field redraw
compares the new value with the last one drawn.

**Cycle budget.** Measured on the recipe with CIA1 timer A around the
call body, less the 17 cycles of an empty call: 957 cycles for 65,535 and
1,361 for 59,999 by subtraction of powers of ten (the count of
subtractions is what varies), 2,537 by double-dabble for 65,535, 74 for
an 8-bit hex value. The Cost line carries the worst measured decimal
case; `bytes_code` is not measured on the page.

### Recipes

- `recipes/oscar64/print-number.md` — both decimal routes and the hex route, checked over every 16-bit value against Python, with the cycle harness on screen

## big_font_2x2 — Big-font text: one glyph across four cells, and a two-row scroller

**Complexity:** medium
**Region:** both
**Uses registers:** D016, D018
**Requires:** char_scroll_buffer_h
**Cost:** cycles_per_frame=672
**Cost basis:** measured-vice

### Why

A title, a scroller or a score that has to read from across the room
wants letters bigger than the 8x8 cell. Sprites give eight of them and
bitmap mode costs the whole screen. Text mode can draw a letter twice its
size at no per-frame cost if the charset itself holds the enlarged
quadrants: the VIC does the drawing and the program only writes screen
codes, four per letter instead of one.

### How

Each source glyph becomes four characters, one per 4x4 quadrant scaled
by two. For source row `s` of glyph `g` (0 to 7), the high nibble goes to
the left quadrant and the low nibble to the right; each nibble becomes
one byte with every bit doubled (`%1010` becomes `%11001100`), written
to two consecutive rows of its quadrant. Rows 0 to 3 fill the top pair of
quadrants, rows 4 to 7 the bottom pair. With the quadrants laid out as
codes `4g`, `4g+1`, `4g+2`, `4g+3` (top-left, top-right, bottom-left,
bottom-right), placing glyph `g` is two writes on one row and two on the
row below, and the code arithmetic is two shifts and an OR. Sixty-four
source glyphs fill all 256 codes, so the charset has room for the
upper-case letters, digits and punctuation of screen codes 0 to 63 and
nothing else; there is no plain space and the screen is blanked with a
quadrant of the space glyph.

Three ways to get the charset:

- **Build it from the ROM font at start.** Bank the character ROM in
  for the CPU (`$01` from `$37` to `$33` under SEI, back to `$37`
  before any interrupt is enabled), read 64 glyphs by 8 bytes, write 2 KB.
  The recipe does this in 57,757 cycles on PAL with the display on
  (measured in VICE x64sc, CIA1 timer A), about three frames, once.
- **Embed a font.** A 512-byte source font of 64 glyphs expands the same
  way, or the expanded 2 KB ships in the PRG ready to use.
- **A code-mapping table instead of an arithmetic layout.** If the
  charset also has to hold ordinary characters, give the big glyphs
  whatever codes are free and index a 64-entry table of top-left codes;
  the other three quadrants are at fixed offsets from it.

A two-row scroller then moves the text the way `char_scroll_buffer_h`
moves one row, twice: every frame XSCROLL in `$D016` steps down one pixel;
when it would pass 0, both rows shift one cell left, column 39 of each
takes the next half-letter (left half, then right half, then the next
letter), and XSCROLL is reset to 7. Read-modify-write `$D016` so CSEL and
MCM survive, and set CSEL to 0 so the ragged column 39 sits under the
border. The whole screen shifts with XSCROLL; anything static on it sees
the 7-pixel snap every eighth frame unless a second interrupt confines
the scroll value to the scroller's lines.

### Why it works

The character generator reads 8 bytes per screen code from charset base
plus code times 8, one byte per pixel row of the cell, and every bit set
draws one pixel. A quadrant of a doubled glyph is 8 rows of a 4-pixel
pattern with each pixel two wide and two high, which is exactly 8 bytes
in which row `2k` equals row `2k+1` and every bit is paired. Nothing about
the enlargement is done per frame: the cost is 2 KB of charset and a
one-off build, and the display afterwards is ordinary text mode, with
the badlines it always has. `$D018` bits 1 to 3 select the charset in
2 KB steps inside the VIC bank, so the built set has to sit on a 2 KB
boundary the VIC can see; the recipe uses $3000 in bank 0.

### Variations

- **1x2, two cells tall and one wide.** Only the rows are doubled: cell
  `2g` holds source rows 0 to 3 each written twice, cell `2g+1` rows 4
  to 7. The glyph is 8 pixels wide and 16 tall, 64 glyphs take 128
  codes, and the other 128 stay free for an ordinary font or graphics.
- **3x3 and beyond.** The same construction with 3-pixel pixels needs 9
  cells per glyph and 576 codes, more than one charset holds; a 3x3 font
  is a subset of the alphabet, or a charset swap on `$D018` between the
  rows.
- **Colour per row.** The two rows of a 2x2 letter are two rows of colour
  RAM, so a letter can be two-tone with no charset change; the recipe
  draws the scroller white over cyan.
- **A 1x2 or 2x2 HUD.** A score in doubled digits is the same `put`
  routine driven by `decimal_print`; the recipe's readout is exactly
  that.

### Cycle budget

Not raster-critical while nothing is drawn per frame. The carry frame is
the frame to plan for: on the recipe, rotating both rows (78 unrolled
`lda abs` / `sta abs` pairs) and appending the half-letter is 665 cycles
for a left half and 672 for a right half, which also advances the message
pointer, measured with CIA1 timer A in VICE x64sc with the interrupt
moved to line 251 so that no badline falls inside the copy. The Cost line
states the 672: the worse carry, and the technique's own work. The
recipe's own interrupt is at line 240 and its copy crosses the badline at
243, so its readout shows 708 or 715, the same work plus the 43-cycle
stall; which of the two a screenshot shows depends on which half that
frame's carry appended. The `$D016` read-modify-write and the XSCROLL
step are on top of that, about 25 cycles by the instruction table. Run
from line 240, the copy ended with the raster at 253 on PAL and 252 on
NTSC, the difference being the 63- against 65-cycle line. Wider text (a
third row, or forty columns of colour RAM moved as well) scales the copy
linearly: 8 cycles a byte unrolled; in a loop, 25 an iteration for both
rows (about 12.5 a byte) or 16 a byte for one row.

### Recipes

- `recipes/kickassembler/big-font-scroller.md`
