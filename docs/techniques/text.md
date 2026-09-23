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
from them with the same two-range conversion. Only the part the echo
needs is given here; the whole PETSCII to screen-code rule, measured
against CHROUT, is `petscii_screen_code_conversion` below (an earlier
version of this sentence said the full mapping was not on this page).

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
case; `bytes_code` is not measured on the page. The same five digits by
four shift-and-subtract divisions by ten cost 2,793 cycles for 65,535
in `recipes/oscar64/divide-check.md`, three times the subtract-powers
route (`division_8_16bit` in `techniques/maths.md` has the comparison).

### Recipes

- `recipes/oscar64/print-number.md` — both decimal routes and the hex route, checked over every 16-bit value against Python, with the cycle harness on screen

## high_score_table_insert — A new score into a sorted table: rank, shift down, drop the last, write

**Complexity:** low
**Region:** both
**Uses registers:** (none)
**Cost:** cycles_per_frame=481
**Cost basis:** measured-vice

### Why

A high-score table is a sorted list, and the game's job at the end of
a round is to keep it sorted: find where the new score ranks, move the
rows below that place down by one, drop the last row, and write the
new one. The fault seen in generated games is to skip the rank and
write every new entry into row 0, so the table reads in the order the
games were played, not the order of the scores. `front_end_and_attract`
in `game-design/game-structure.md` lists "the table re-sorted" among
its checks; this is the routine that check exercises.

### How

The table is a fixed number of rows of a fixed length: a name of three
screen codes and a score of three BCD bytes, most significant first.
Keeping the score in BCD means the digits print by a shift and a mask
(the variation `decimal_print` describes) and, as shown below, compare
with plain `CMP`.

1. **Rank.** Walk the rows from the top. For each, compare the new
   score's most significant byte with the row's; if they differ, that
   byte decides. If they are equal go to the next byte, and to the
   third. The first row the new score is strictly higher than is its
   rank. If no row loses, the score does not qualify and nothing else
   runs. A full table needs no separate "is it high enough" test: the
   last row is the threshold, and a score that beats no row is out.
2. **Tie rule.** Equal on all three bytes is not a win. The search
   moves on, so the new score lands below the row it equals and the
   earlier holder keeps the rank. State the rule in the code; a table
   that puts a tie above its holder is not wrong, but it must be a
   choice and not an accident of `BCS` where `BEQ` plus `BCS` was
   meant.
3. **Hand-off.** Between the rank and the write comes the name entry
   (`text_input_line`). The rank is known first, so the game can show
   the place the score will take and can skip the entry when the score
   does not qualify. The typed name goes into the new row's name bytes
   and the write follows. Keep rank and place as two calls with the
   rank held between them.
4. **Shift.** Start at the last row and copy the row above it down,
   then step up one row, until the row index equals the rank. The loop
   test is "stop on equal or below", not "stop on equal", so a rank
   that is not on a row boundary cannot carry the copy past the top of
   the table. The last row is never read as a source, which is how it
   is dropped.
5. **Write.** Copy the new row's bytes over the row at the rank.

### Why it works

A BCD byte's binary value orders the same way its two digits do:
`$50` is above `$49` whether it is read as eighty and seventy-three or
as fifty and forty-nine, because each nibble stays inside 0 to 9.
`CMP` therefore ranks BCD bytes correctly and the decimal flag is
never touched; `SED` belongs to the routine that adds to the score,
not to the one that files it. `CMP` sets `C` when the accumulator is
at or above the operand and `Z` when equal, so `BNE` then `BCS`
reads as "differs and is higher", and a `BEQ` past the `BCS` on the
last byte is the tie rule in one instruction.

Copying from the bottom up is what makes the shift safe in place:
every row is read before the row that overwrites it is written.
Going top down would copy row 0 over row 1 before row 1 had been
read, and fill the table with one entry.

### Variations

- **Binary scores.** A 16-bit or 24-bit binary score compares with the
  high-byte-first cascade of `compare_16bit_and_signed`
  (`techniques/maths.md`), the same shape as the BCD compare here, and
  prints through `decimal_print`. The rank, shift and write do not
  change.
- **A table longer than the screen.** Rank and shift do not change in
  shape; only the printing windows the rows. The recipe's loops index
  the table with X over six-byte rows, so they reach 42 rows at most:
  the row count times six must stay under 256 for `CPX #TABLEN` and
  the `table,X` reads. Within that bound the cost grows by 73 cycles a
  shifted row and 26 a row rejected on its first byte (arithmetic from
  the measured recipe), so the worst insert into a 42-row table is
  3,182 cycles, arithmetic and not run. A longer table needs a
  `(zp),Y` pointer loop through zero page, whose per-row cost is
  different and not measured here.
- **Saving after the insert.** Write the table to disk once, after the
  write, not on every rank test: `recipes/oscar64/high-score-persist.md`
  has the file policy (first run, replace, version check) around the
  table.

### Cycle budget

Measured in VICE x64sc 3.10 by `recipes/kickassembler/high-score-insert.md`
on the CIA2 timers, under `SEI` with the screen blanked, less an empty
call: 481 cycles for the worst insert into a five-row table (the top
row beaten on the third byte, four rows shifted), 339 for a rank of 4
after a tie, 284 for a rank of 5, 152 for a score that does not
qualify. The Cost line carries the worst case as the cost of one call,
on the assumption of one call in the frame it runs in. The routine is
called once at the end of a round, so no frame of play carries it; a
plan for the end-of-round frame is the only one that has to fit it.

### Recipes

- `recipes/kickassembler/high-score-insert.md` — five-row BCD table, four inserts (first, tie, none, last), the table printed after each with rank and cycles, verdict against an expected table

## petscii_screen_code_conversion — PETSCII to screen code and back, as range arithmetic

**Complexity:** low
**Region:** both
**Uses registers:** D018
**Uses kernal:** CHROUT
**Cost:** cycles_per_frame=32
**Cost basis:** measured-vice

### Why

The C64 has two byte codes for a character. PETSCII is what the
keyboard delivers, what CHROUT accepts, what a file holds and what a
string in most compilers is. A screen code is what the VIC-II reads from
screen RAM to pick a glyph. They agree only for space, digits and the
punctuation in `$20-$3F`; a letter written to `$0400` as its PETSCII
byte comes out as a graphics character
(`pitfalls/text-mode-render.md`, `petscii_written_to_screen_ram`). A
program that writes screen RAM itself, which every game HUD and text
field does, needs the rule in both directions, and it is small enough
that no table is needed.

### How

The rule, measured in VICE x64sc 3.10 by sending every PETSCII code `$20`
to `$FF` through CHROUT at row 0, column 0 and reading the screen RAM
byte back (recipe below; the same run shows `PASS` for all 224 codes):

| PETSCII | Screen code | Arithmetic |
|---|---|---|
| `$20-$3F` space, digits, punctuation | `$20-$3F` | unchanged |
| `$40-$5F` `@`, unshifted letters, `[`, `£`, `]`, arrows | `$00-$1F` | subtract `$40` |
| `$60-$7F` shifted letters and graphics | `$40-$5F` | subtract `$20` |
| `$80-$9F` | none | control codes, nothing printed |
| `$A0-$BF` Commodore-key graphics | `$60-$7F` | subtract `$40` |
| `$C0-$DF` shifted letters and graphics | `$40-$5F` | subtract `$80` |
| `$E0-$FE` graphics | `$60-$7E` | subtract `$80` |
| `$FF` pi (alias of `$DE`) | `$5E` | special case |
| `$00-$1F` | none | control codes |

Forward, PETSCII to screen code: below `$20` or in `$80-$9F` it is a
control code; below `$40` keep it; below `$60` subtract `$40`; below
`$80` subtract `$20`; `$FF` becomes `$5E`; otherwise take the low seven
bits and set bit 6 (`(c & $7F) | $40`), which covers `$A0-$FE` in one
step. Six compares and one mask; the recipe's C version costs 32 cycles
for `$C1`, the longest path (CIA1 timer A, VICE x64sc, PAL and NTSC
alike).

Backward, screen code to PETSCII: clear bit 7 first, then below `$20`
add `$40`; below `$40` keep it; below `$60` add `$80`; otherwise add
`$40`. This is a choice, not an inverse: screen codes `$40-$7F` each
have two PETSCII spellings (`$60-$7F` and `$C0-$DF` for the first block,
`$A0-$BF` and `$E0-$FF` for the second), and the rule picks the ones the
keyboard delivers, so that converting the result forward again gives the
same screen code. The recipe checks that round trip over all 128 codes.
22 cycles for `$41` on the same harness.

Bit 7 of a screen code is reverse video, not part of the character.
CHROUT sets it on every printable code after a `$12` (RVS ON) until a
`$92` or a carriage return; the flag is `$C7`, and a `$12` then `$41`
leaves `$81` in the cell (measured). A direct writer sets the bit itself
(`code | $80`) and needs no second character set.

The shifted set is a third thing. `$0E` and `$8E` through CHROUT set
`$D018` to `$17` and back to `$15` (measured), which is bit 1: the VIC
reads glyphs from the second 2 KB of the character ROM, where screen
codes `$01-$1A` are lower case and `$41-$5A` are upper case, instead of
the first, where they are upper case and graphics (the 26 upper case
bitmaps at `$01-$1A` in the first set are byte-identical to those at
`$41-$5A` in the second, read from the `chargen-901225-01.bin` image).
The bytes in screen RAM do not change when the set does; only the
pictures do.

### When to use CHROUT and when to write screen RAM

CHROUT (`$FFD2`) takes PETSCII, does this conversion for you, handles
control codes, scrolls, wraps, writes the colour, and moves the cursor.
Use it for a title screen, a text adventure, a debug print, anything
that is happy at the editor's cursor and does not run inside a tight
frame. Its price is the editor: it clobbers A, X and Y
(`pitfalls/kernal-and-io.md`, `kernal_clobbers_a_x_y`), it needs the
KERNAL ROM banked in and the editor's zero-page state intact, its cost
per character is not fixed, a `$22` in the stream flips quote mode and
turns later control codes into reversed glyphs, and a line that reaches
column 40 wraps and may scroll the whole screen.

Write screen RAM directly for a HUD, a score, a name field, a tile map,
anything placed by coordinate or drawn every frame: `$0400 + 40 * row +
column` on the default screen, one store per cell, with the conversion
above applied to any PETSCII source. Two consequences follow. Colour is
now yours: CHROUT writes the current colour from `$0286` into `$D800` for
every cell it prints (measured: with `$0286` set to 7 the colour RAM cell
reads 7 afterwards), and a direct write leaves colour RAM as it was, so
a cell that was never printed on keeps the colour the last clear left
there, and a cell in a colour that matches the background shows nothing
at all. And nothing scrolls, wraps or interprets: a byte below `$20`
written directly is a screen code (`@` and the letters), not a control
code.

### Why it works

The screen editor's print path at `$E716` in the KERNAL (901227-03, read
from the ROM image) folds the code with masks before storing it: the
`$40-$7F` half by clearing one bit or two, the `$A0-$FF` half by clearing
bit 7 and setting bit 6, with `$FF` replaced by `$5E` first and the
reverse flag ORed in at the end. The table above is that arithmetic
written out; the address is named so the routine can be found, not
copied. The glyph itself is fetched by the VIC from the character
generator at `charset base + 8 * screen code`, and `$D018` bits 1 to 3
choose the 2 KB base within the VIC bank, which is why the same screen
code shows two different pictures in the two sets and why an upper case
letter typed in the lower case set is a shifted letter in PETSCII terms.

### Variations

- **Two-range echo.** A field that admits only unshifted letters,
  digits and punctuation needs the first two rows of the table and
  rejects everything else; `text_input_line` does exactly that.
- **ASCII source.** A C string in ASCII has lower case at `$61-$7A`,
  which in PETSCII is the unshifted letters. Subtract `$60` for lower
  case ASCII and `$40` for upper case to reach screen codes `$01-$1A`,
  then choose the set with `$D018` bit 1; this is what `put_text` in
  the recipes does for upper case.
- **Assembler-time conversion.** KickAssembler's `.text` emits screen
  codes by default and `.encoding "petscii_mixed"` emits PETSCII
  (`toolchains/kickassembler-reference.md`), so a string destined for screen RAM
  needs no run-time conversion at all; the rule matters for bytes that
  arrive at run time, from the keyboard or a file.
- **A 256-byte table.** Faster by a few cycles per byte than the
  compares and needed if the mapping is a custom charset's rather than
  the ROM's; the arithmetic version is what a stock charset needs.

### Cycle budget

Not raster-critical. One conversion is 32 cycles forward and 22 backward
in the recipe's C, body only, so a forty-cell row converts in about 1,300
cycles (arithmetic from the measured per-call figure). The Cost line
carries one forward call.

### Recipes

- `recipes/oscar64/petscii-screen-codes.md`: both routines checked against CHROUT over every code, the round trip, the `$D018`, reverse and colour RAM readings, and the cycle harness on screen

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

## adventure_database_engine — Two-word parser, action table, occurrences and packed text for a text adventure

**Complexity:** medium
**Region:** both
**Uses registers:** (none)
**Requires:** text_input_line
**Cost:** cycles_per_frame=14908
**Cost basis:** measured-vice

### Why

A text adventure is mostly data: rooms, items, words and rules. Written
as code, every puzzle is an `if` in the parser, and the game outgrows
memory on its logic long before its text. The Scott Adams games put the
whole game in tables and kept one small interpreter to run them; the
Scott Adams Adventure Compiler (sac) compiles games in that model. The engine below is
that model: the game is a database, and a turn is a table scan.

### How

**The data.**

- **Rooms.** A description message and six exits, north, south, east,
  west, up and down, each a room number or 0. A dark room is marked by
  a bit. Room 0 is "nowhere", where items wait before they enter play.
- **Items.** A description message, a start room and a current
  location: a room, `CARRIED` (255), or 0. An item that can be carried
  names the noun that picks it up. Two states of one object, such as a
  lamp unlit and lit, are two items; a swap trades their locations.
- **Vocabulary.** A verb table and a noun table. Each entry is a word
  cut to its first `WL` letters and an id. Synonyms share an id, so
  `GET` and `TAKE` are both verb 2. Nouns 1 to 6 are the directions.
- **Actions.** Each entry is a verb, a noun (0 matches any), up to four
  conditions and up to four commands. A condition is an opcode and an
  argument: at room, item carried, item here, item accessible (carried
  or here), item exists, flag set, flag clear, counter equals, room
  dark. A command is an opcode and an argument: print a message, go to a
  room, look, inventory, score, swap two items, place an item here,
  destroy an item, set a flag, set the counter, decrease the counter,
  add to the score, die, win.
- **Occurrences.** Entries with verb 0. They match no command; they run
  every turn.
- **State.** The room, one location byte per item, a flag word, a
  counter, the score, the turn count.

**The parser.** Split the line at spaces and keep the first two words.
Pad or cut each to `WL` letters and look it up. If the first word is not
a verb but is a direction, the command is `GO` plus that direction, so
`N` works alone. An unknown verb prints "I DON'T KNOW HOW TO" and the
word; a known verb with an unknown noun prints "I DON'T KNOW WHAT A" and
the word. A parse failure costs no turn and runs no occurrence.

**The turn.**

1. Count the turn.
2. Scan the action table in order. The first entry whose verb and noun
   match and whose conditions all hold runs its commands, and the scan
   stops.
3. If no entry ran, fall back to the built-ins: `GO` through the exit
   table, then `GET` and `DROP` by the item's noun. `GET` refuses in a
   dark room without light and above the carry limit.
4. Unless the game has ended, run every occurrence whose conditions
   hold.

Then the terminal prints the buffer, a separate cost.

Order is the rule language. Two entries for the same verb and noun, the
first with more conditions, give "if it works, else say why": `UNLOCK
DOOR` with the key carried opens the door; the next entry, without the
key condition, prints "YOU HAVE NO KEY". A locked door is the same idea
with no special code: the path's north exit is not in the exit table,
and an action for `GO NORTH` at that room with the open door present
moves the player. The entry below it prints "THE DOOR IS LOCKED".

**The light source.** Darkness is a room bit plus a test: the room is
lit if it is not dark or if the lit lamp is carried or here. Lighting
the lamp swaps the unlit item for the lit one and sets the counter.
Three occurrences burn it: while the lit lamp exists, decrease the
counter; at 3, print a warning; at 0, swap the lit lamp for a dead one.

**The text.** Messages are packed five bits a character, three to a
16-bit word, with bit 15 set on a message's last word. The alphabet is
space, `A` to `Z`, full stop, comma, apostrophe and `!`; code 31 pads
the last word. A table gives each message's first word, 2 bytes a message.
Decoding writes screen codes into an output buffer; the terminal then
prints the buffer with word wrap. The recipe's 50 messages are 1,061
characters and pack into 752 bytes of words, a ratio of 0.709 (the
program counts both and prints them). With the 100-byte start table the
total is 852 bytes, 0.803. Three characters in two bytes is 0.667; the
padding of the last word of each message is the rest of the 0.709. The
recipe packs at start-up so that the packing itself is checked; a real
game packs at build time and ships only the words and the table. Numbers are printed as digits
straight from the value, so the alphabet needs none.

### Why it works

A turn is a linear scan with an early exit, so its cost is the number of
entries tried and the text it prints. Conditions are tested only on
entries whose verb and noun match, so most entries cost a byte compare.
Keeping output in a buffer separates the engine's work from the
screen's: the recipe times parse, turn and print on their own.

The engine meets the PETSCII and screen-code boundary twice. Typed keys
arrive from GETIN as PETSCII and are stored as PETSCII for the parser,
because the vocabulary is compared in that encoding; their echo is
converted to screen codes. Decoded messages are screen codes from the
start and go straight into screen RAM. A table stored in PETSCII and
poked to `$0400` shows graphics where letters belong
(`petscii_written_to_screen_ram`, `pitfalls/text-mode-render.md`).

### Variations

- **Scott Adams' limits.** The Scott Adams Adventure Compiler (sac)
  manual's Adventureland data uses 3 significant letters, a carry limit
  of 6 and a light that lasts 125 turns. ScottFree implements 32 flags (flag 15 is darkness), 16
  counters and 16 room-save slots, and occurrences can take a
  percentage chance. Light is only used up while the light source is in
  the game. None of these limits is measured here; the recipe uses 4
  letters, a carry limit of 4 and a 7-turn lamp.
- **Evaluation order in the original.** The manual says the
  occurrences whose conditions hold run before each turn, then at most
  one action, the first that matches. The recipe runs them after the
  player's action and before the next prompt, which is the same
  sequence seen from the prompt. Its built-ins run only when no action
  matched, a choice of this recipe.
- **Longer rules.** Adams' format has a `continue` entry that chains
  extra commands onto the one before, for rules with more commands than
  one slot holds. Four slots a record is this recipe's choice.
- **Dictionary compression.** Replacing common words with one-byte
  tokens is the other usual scheme. It is not built or measured here.
- **Story files and paging.** Infocom's Z-machine keeps the game in a
  story file and pages it from disk; that is a different engine.

### Memory for a 30-room game

Arithmetic, with the recipe's record sizes and assumed counts:

| Part | Assumed count | Bytes each | Bytes |
|---|---|---|---|
| Rooms (6 exits, description, dark) | 30 | 8 | 240 |
| Items (description, noun, start room, location) | 60 | 4 | 240 |
| Vocabulary (4 letters and an id) | 150 words | 5 | 750 |
| Actions and occurrences | 200 | 18 | 3,600 |
| Text, 30 rooms of 150 characters and 250 messages of 45, at 752/1,061 | 15,750 characters | | 11,163 |
| Message index (first word of each message) | 280 messages | 2 | 560 |
| Engine, parser and terminal (the recipe's Oscar64 map, `$1444-$1C19`, plus 133 bytes of its divide routine) | | | 2,138 |

That is about 18.7 KB (18,691 bytes), which fits between `$0801` and `$9FFF` with BASIC
in and room to spare. The text is the largest part, which is why the
packing matters more than the rule format. The 18-byte action record
is loose; half of it is empty on most entries.

### Cycle budget

The engine's work for one command fits one PAL frame (14,908). Printing
its output does not: up to 109,866 cycles, 5.6 frames, almost all of it
the C scroll at about 17,400 a line. Budget the terminal first; print a
line per frame or scroll in assembly if anything animates.

Measured on the recipe with CIA2 timer A cascaded into timer B,
interrupts off and the display on, on PAL (NTSC in brackets):

- **Parse:** 722 to 3,944 cycles (636 to 3,944). The top of the range
  is `XYZZY`: both tables scanned to the end and an error message
  decoded.
- **Turn:** 2,888 to 12,734 (3,017 to 13,161). The top of the range is
  `LIGHT BEACON`, which wins: 13 entries tried, 4 commands run, about 115
  characters decoded; a win skips the occurrences. Moving into a room
  with items listed costs 7,800 to 12,000, depending on how much text
  is decoded (debug build).
- **Parse and turn of one command, the worst:** 14,908 (15,206), the
  winning command. This is the Cost line: one command's work, within a
  PAL frame of 19,656 cycles.
- **Scanning the whole table with no match:** 1,695 cycles for 17
  entries (1,609), about 100 an entry. A 200-entry table would take
  about 20,000 cycles for a command that matches nothing, a frame on
  its own (arithmetic from the measured figure).
- **Printing:** up to 109,866 cycles (110,762) for one command. It is
  the terminal's cost, not the engine's.

### Recipes

- `recipes/oscar64/adventure-engine.md` — an original seven-room game with a locked door, a lamp that dims and goes out, and a scripted win typed through the KERNAL queue, including a failed command and synonyms; final state and a fold of every printed character checked against a Python model; cycles on screen, PAL and NTSC

### Sources

- https://www.miketaylor.org.uk/tech/advent/sac/Manual.html (the
  Scott Adams Adventure Compiler (sac) manual): rooms with six exits, items that may start
  nowhere, verb and noun synonyms, actions of a verb or verb-noun pair
  with conditions and results, the condition and result names,
  occurrences with an optional percentage, the evaluation order, the
  32 flags ScottFree implements with flag 15 as darkness, its 16
  counters and 16 room-save slots,
  `continue`, and the Adventureland values `%wordlen 3`, `%maxload 6`
  and `%lighttime 125`. Not measured here.
- https://www.ifarchive.org/indexes/if-archive/scott-adams/ (the IF
  Archive's Scott Adams directory: interpreters and tools). The byte
  format of the original data files was not read.
