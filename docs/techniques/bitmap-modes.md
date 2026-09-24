---
category: bitmap
chip: VIC-II
---

<!-- doc-type: technique-reference -->

# Bitmap Modes

The VIC-II has two hardware bitmap modes, standard hires and multicolor, each with its own memory layout, color resolution and constraints. On top of them, scanline-switching techniques (FLI, AFLI, IFLI) use the chip's video-matrix pipeline to give more colors per cell than either mode allows. This page covers the bitmap family, from the mode enable, a pixel plot and a line, through the interlaced scanline-switcher.

Get the plain modes working before any FLI variant. The FLI family builds on the standard bitmap addressing described here, and a mistake in the memory layout shows as wrong colors in an FLI image just as in a plain bitmap.

---

## standard_bitmap — Standard bitmap mode

**Complexity:** low
**Region:** both
**Uses registers:** D011, D018
**Uses kernal:** (none)
**Claims:** vic_char_base (owns)
**Claims basis:** measured-vice

Store traces (`scripts/claims-watch.ts`, VICE x64sc, PAL) of
`recipes/kickassembler/hires-plot-line.md`, `recipes/kickassembler/twister.md`
and `recipes/kickassembler/dot-flag.md`: the set-up's one `$D018` store
(`$18`) moves the character base to the bitmap at `$2000`, and the mode
holds it every frame. The matrix stays at `$0400`, so the store changes no
matrix bits. The set-up's whole-register `$D011` store also clears the
raster-compare bit 8 the KERNAL left set; that is the listing's choice of
value, not the technique's claim.

### Why

The default character mode gives only 40x25 cells with two colors per cell drawn from a shared character generator. In bitmap mode every one of the 64,000 pixels in the 320x200 display window is individually addressable in one of two colors chosen independently for each 8x8 cell. Full-screen painted or rendered graphics on the C64 are built on it.

### How

Enable standard bitmap mode by setting bit 5 (BMM) of $D011 to 1. The VIC-II's display sequencer then treats the video data as raw pixel bits rather than character indices.

Two separate memory areas are required within the current 16 KB VIC bank:

- **Bitmap data**: 8000 bytes (320x200 / 8) arranged as 25 rows of 40 cells, each cell occupying 8 consecutive bytes (one byte per scanline within the cell). The base address is controlled by $D018 bit 3 (CB2): 0 places the bitmap at offset $0000 in the bank, 1 places it at $2000.
- **Screen RAM (video matrix)**: 1000 bytes at any 1 KB boundary within the VIC bank, selected by $D018 bits 7-4. Each screen RAM byte encodes the two colors for one 8x8 cell: the high nibble is the foreground color (set bits in bitmap), the low nibble is the background color (clear bits).

Color RAM ($D800-$DBFF) is not read in standard bitmap mode.

The cell layout inside the bitmap is row-major: cell (col, row) starts at byte offset `(row * 40 + col) * 8` within the bitmap area. Bit 7 of each bitmap byte is the leftmost pixel in that scanline row of the cell.

To set up a standard bitmap:
1. Write the screen RAM with color nibbles for all 1000 cells.
2. Write pixel data into the 8000-byte bitmap area.
3. Write $D018 with the correct VM (screen RAM) and CB (bitmap base) nibbles.
4. Set $D011 bit 5 to 1.

### Why it works

In standard text mode the chip's g-access fetches a byte from the character generator ROM or RAM. In bitmap mode the same g-access mechanism reads sequentially from the 8000-byte bitmap area instead; the chip treats the bitmap as a 40x25x8 character set in which every character has a unique glyph. The per-cell two-color attribute lives in the video matrix (screen RAM), which the chip fetches on each badline exactly as it does in text mode. The only difference is which pixel source the chip reads on g-access cycles.

### Variations

**Split-screen hires/text**: program a raster IRQ to toggle $D011 bit 5 at the desired scanline boundary. This gives a bitmap area above and a text area below (or vice versa) within the same frame. Update $D018 if the screen RAM positions differ between the two halves.

**Two-bitmap pages**: keep two 8000-byte areas at $0000 and $2000 in the VIC bank and alternate $D018 bit 3 each frame for double-buffering. Allows one page to be drawn while the other is displayed, eliminating partial-frame tearing.

**Single-colour full bitmap**: fill every screen RAM byte with the same value whose two nibbles differ (e.g. $10 = white ink on black), so the whole 320x200 area is one two-colour canvas; then the bitmap bits alone draw the picture. (Equal nibbles make ink and paper the same colour and the drawing disappears; an earlier version of this paragraph said to make them equal. Measured in VICE x64sc: screen byte $12 renders bitmap $FF white and $00 red.)

### Cycle budget

Standard bitmap mode does not change the cycle budget versus text mode. Badlines still occur on the same schedule (every 8 visible lines, wherever YSCROLL aligns them), each costing 40-43 CPU cycles. With no sprites active, a non-badline gives the CPU all 63 PAL cycles (65 NTSC).

Drawing into the bitmap from the main program is safe in the vertical blank or in the overscan region. Modifying bitmap bytes while those cells are being rendered produces visible tearing.

### Recipes

- `recipes/kickassembler/hires-plot-line.md` — the hires setup ($D018 = $18, $D016 = $08, $D011 = $3B) with screen RAM set to white on black, then plots and lines into it.
- `recipes/oscar64/bitmap-koala-viewer.md` sets up $D018 and BMM for the multicolour case; the hires setup differs only in $D016.

---

## hires_plot — Set one pixel in a hires bitmap through a row table and a mask table

**Complexity:** low
**Region:** both
**Uses registers:** D011, D016, D018
**Uses kernal:** (none)
**Requires:** standard_bitmap
**Cost:** cycles_per_frame=63
**Cost basis:** measured-vice
**Claims:** none
**Claims basis:** measured-vice

Store traces of `recipes/kickassembler/hires-plot-line.md` and
`recipes/kickassembler/dot-flag.md`: after `standard_bitmap`'s set-up the
plot stores only to the bitmap and to its own zero page and tables, which
are the program's memory, not units.

### Why

A hires bitmap is 8000 bytes laid out cell by cell, not scanline by scanline, so the byte that holds pixel (x, y) is not `y * 40 + x / 8`. Working the address out from scratch on each plot means a multiply by 320; a plot is the inner step of every line, circle and fill routine, so it has to be a table lookup and a handful of adds.

### How

Two tables, built at assembly time:

- A row address table with one 16-bit entry per y from 0 to 199: `BITMAP + (y / 8) * 320 + (y & 7)`. That is the address of the leftmost byte on scanline y. Store low bytes in one table and high bytes in another so each is indexed by y in one instruction.
- A mask table with one byte per x & 7: `$80, $40, $20, $10, $08, $04, $02, $01`. Bit 7 is the leftmost pixel of a byte.

The plot, with x in 16 bits because it reaches 319:

1. Take `x & $F8`. That is the column times eight, which is also the byte offset of that column's cell within the row, because each cell is eight bytes.
2. Add it to the row table's low byte for y; add x's high byte to the row table's high byte with the carry. The result is the address of the byte holding the pixel.
3. Read the byte, `ORA` the mask for `x & 7`, write it back.

```text
    ldy y
    lda x_lo
    and #$f8
    clc
    adc row_lo,y
    sta ptr
    lda row_hi,y
    adc x_hi
    sta ptr + 1
    lda x_lo
    and #$07
    tax
    lda mask,x
    ldy #0
    ora (ptr),y
    sta (ptr),y
```

Put each row table in its own page (`.align $100` in KickAssembler). `LDA abs,Y` costs one cycle more when the index carries into the next page; with the tables unaligned, the recipe's plot measured 65 cycles at y = 199 instead of 63.

### Why it works

The VIC-II fetches the bitmap in the same order it fetches a character set: on each badline it reads 40 screen RAM bytes, and on the eight lines that follow it reads one byte per cell per line, walking eight bytes per cell. So the eight bytes of a cell are consecutive, a row of 40 cells is 320 consecutive bytes, and the address arithmetic above is the fetch order inverted. `$D018` bit 3 chooses `$0000` or `$2000` within the VIC bank as the base; `$D011` bit 5 turns bitmap mode on; `$D016` bit 4 clear keeps it hires, one bit per pixel. Screen RAM supplies the ink and paper nibbles per cell and is not touched by the plot, so a canvas of one ink colour is set up once.

### Variations

**Multicolour plot.** In multicolour bitmap mode a pixel is two bits wide and x runs 0 to 159. The byte is `row + (x & $FC) * 2`, which is the column times eight; the doubling can carry out of the low byte for x of 128 and above, so add it in 16 bits or use a 40-entry column table. The mask table has four entries, `$C0, $30, $0C, $03`, indexed by `x & 3`, and the colour value is shifted into the same two bits. Clear with `AND` of the inverted mask, then `ORA` the shifted colour, so a plot can set any of the four colours and not just turn a bit on.

**Erase list.** An animated shape drawn with plots is cheapest to remove by replaying its own plots with `AND` of the inverted mask (an `unplot`). Record each plotted address and mask in a list as the shape is drawn; clearing the whole 8000 bytes costs about 8 cycles a byte, an erase list costs one `unplot` per pixel.

**Plot without the high byte.** A routine that only ever plots x below 256 can drop `x_hi` and the second `adc`; the mask and row tables are unchanged.

### Cycle budget

63 cycles for `jsr` and `rts` included, with both tables page-aligned, measured with CIA1 timer A in the `hires-plot-line` recipe with the display blanked; the instruction table gives the same 63. With the display on, a badline under the plot adds 40 to 43 cycles on the CIA's count without making the plot slower. Nothing here depends on the raster position; drawing is safe while the cells being written are not being fetched.

### Recipes

- `recipes/kickassembler/hires-plot-line.md` — the tables, the plot, timed, and 2,056 pixels counted back out of the bitmap.

---

## bresenham_line — Straight line by Bresenham's error term, all eight octants

**Complexity:** medium
**Region:** both
**Uses kernal:** (none)
**Requires:** hires_plot
**Cost:** cycles_per_frame=43606
**Cost basis:** measured-vice
**Claims:** none
**Claims basis:** measured-vice

Store trace of `recipes/kickassembler/hires-plot-line.md`: the line loop
stores only through `hires_plot` into the bitmap and to zero page the
recipe chose.

### Why

A line between two pixels has one pixel per step along its longer axis, and the shorter axis moves a fraction of a pixel per step. Keeping that fraction as a fixed-point value works but costs a 16-bit add per step and a division at setup. Bresenham's form keeps an integer error term whose sign says when the minor axis is due to move, needs no division, and every pixel it picks is the one nearest the ideal line.

### How

Given (x0, y0) to (x1, y1):

1. `dx = |x1 - x0|`, `dy = |y1 - y0|`, and a step of +1 or -1 for each axis from the signs. x needs 16 bits on a 320-wide bitmap; y fits 8, but a difference of two y values reaches -199, so take it in 16 bits too or sign-extend with care.
2. The major axis is the one with the larger delta. Two loops, one for each, are simpler and faster than one loop that swaps roles.
3. Error term `err = 2 * minor - major`, kept in 16 bits with the doubled deltas precomputed.
4. Loop `major + 1` times: plot; if the count is spent, stop; if `err >= 0`, step the minor axis and `err -= 2 * major`; then `err += 2 * minor` and step the major axis.

The sign test is `LDA err_hi : BMI skip`. The term stays within about -640 to +640 for any line on this screen, so bit 7 of the high byte is the true sign and no overflow case arises. The count is `major`, tested for zero before decrementing, so the last pixel is the end point in every octant and the count of pixels is `max(dx, dy) + 1`.

```text
shallow_loop:
    jsr plot
    lda n : ora n + 1 : beq done
    (n = n - 1)
    lda err + 1
    bmi no_y
    (y = y + sy ; err = err - dx2)
no_y:
    (err = err + dy2 ; x = x + sx)
    jmp shallow_loop
```

### Why it works

The error term is twice the signed distance between the ideal line and the pixel just plotted, measured along the minor axis in units of a pixel. Doubling keeps the half-pixel threshold an integer. Each major step moves the ideal line `minor / major` of a pixel, so adding `2 * minor` to a term that was scaled by `major` is that move; when the term reaches zero the ideal line has passed the half-way point, the minor axis steps, and subtracting `2 * major` recentres the term on the new pixel. Because only the sign is ever tested and the term is bounded by the deltas, 16 bits are enough and the test is one branch on one byte.

### Variations

**Clipped line.** Test each end point against 0 to 319 and 0 to 199 before drawing. A line with both ends inside never leaves the screen, because Bresenham's pixels lie between its end points on both axes. For a line with an end outside, clip the end point to the edge first (Cohen-Sutherland style code, not on this page) rather than testing every pixel; a per-pixel test doubles the loop cost.

**Erase list.** Record each pixel's address and mask as the line is drawn and replay the list with `AND` to remove it; see the erase-list variation of `hires_plot`.

**8-bit error term.** When the larger delta is below 64 the term and the doubled deltas fit a signed byte: the term stays within twice the major delta, so 126 at most, and the two 16-bit adds become one 8-bit add each, saving about 12 cycles a step. A line whose larger delta is 64 or more overflows the byte and the sign test then reads the wrong way (`pitfalls/cpu.md`, `signed_compare_bmi_overflow`); guard the setup, do not assume the caller did.

### Cycle budget

Measured with CIA1 timer A in the `hires-plot-line` recipe, display blanked, VICE x64sc, identical on PAL and NTSC: 214 cycles for a one-pixel line (setup, first plot, exit test) and 43,606 for the 320-pixel flat line along the bottom row, the longest line the screen holds. A sweep of flat lines from 2 to 320 pixels fits 214 + 136 per further pixel, plus 4 when the step count's low byte passes zero and 4 when x crosses 255. The 136 is 63 for the plot and 73 for the step, by the instruction table. A steep line costs the same step less the `jsr step_x`, about 130, when its major axis is y. Both figures are for the recipe's layout: the same loop with its `bne` sitting on `$0AFC` and its target on `$0B00` measured 43,925, one cycle more per step (`pitfalls/cpu.md`, `branch_page_cross_extra_cycle`). A frame of 19,656 PAL cycles holds about 140 pixels of line drawn this way; a game that draws more than that per frame unrolls the plot into the loop or draws across frames.

### Recipes

- `recipes/kickassembler/hires-plot-line.md` — eleven lines in every direction, the longest one timed, and the set-bit count checked against the endpoints.

---

## multicolor_bitmap — Multicolor bitmap (MCM)

**Complexity:** low
**Region:** both
**Uses registers:** D011, D016, D018
**Uses kernal:** (none)
**Claims:** vic_char_base (owns)
**Claims basis:** measured-vice

Store trace of `recipes/oscar64/bitmap-koala-viewer.md`: one `$D018`
store moves the character base to the bitmap at `$2000` and the mode holds
it. MCM and BMM are mode bits, not units yet.

### Why

Standard bitmap mode gives 320x200 pixel resolution with only two colors per 8x8 cell. Many full-screen paintings require more than two colors per cell. Multicolor bitmap trades horizontal resolution for additional colors: each 8x8 cell gets four independent colors, at the cost of halving horizontal resolution to 160x200 (each displayed pixel is two bits wide).

Most C64 bitmap art (Koala Painter, Advanced Art Studio, PETSCII editors set to bitmap mode) is multicolor bitmap.

### How

Enable multicolor bitmap by setting both bit 5 of $D011 (BMM) and bit 4 of $D016 (MCM) to 1.

The same 8000-byte bitmap and 1000-byte screen RAM areas are used as in standard bitmap mode, with identical addressing. The chip now interprets each byte of bitmap data as four 2-bit pixels instead of eight 1-bit pixels.

Each 2-bit pattern in a bitmap byte maps to a color source:

| Pattern | Color source |
|---------|-------------|
| %00 | $D021 (BGCOL0) — shared global background |
| %01 | Screen RAM high nibble (per-cell) |
| %10 | Screen RAM low nibble (per-cell) |
| %11 | Color RAM nibble at matching cell position (per-cell) |

This gives three per-cell colors plus one global shared background, for a total of four colors per cell. The Color RAM nibble (%11 color) is read from $D800 indexed by cell position, same as in multicolor text mode.

Because each pixel is two bits, each pixel row is still 40 bytes, one per cell, but each byte now yields four double-wide pixels, so a row is 160 pixels and the bitmap remains 8000 bytes; the byte layout is unchanged, only its interpretation differs. (An earlier version described this as "40 cells x 4 bytes per horizontal tile", which is not the layout.)

### Why it works

The multicolor bit in $D016 changes how the chip interprets the pixel shift register during g-access rendering. Instead of emitting one bit per pixel clock (hires: eight 1-clock pixels per byte), the chip takes two bits every second pixel clock and holds each 2-bit pair on the output for two clocks (four 2-clock pixels per byte). A byte still lasts the eight clocks of its cell (measured in VICE x64sc: the four pairs of one byte span the full 8-pixel cell width; an earlier version said "4 clocks per byte"). The two-bit pattern is decoded through the four-entry color lookup described above. All other chip mechanics (badlines, video matrix fetches, memory banking) are unchanged.

### Variations

**Mixed hires/multicolor bitmap**: these two mode bits cannot mix modes per cell within one bitmap frame. A raster IRQ can switch mode between a hires region and a multicolor region.

**Programmatic color cycling**: write new values to $D021 or to screen RAM/Color RAM bytes during the vertical blank each frame. Changing $D021 shifts the %00 color across the entire bitmap simultaneously, a cheap way to animate background tones or produce global color washes.

**Koala-format integration**: Koala Painter's .kla file format encodes a multicolor bitmap image directly as bitmap data + screen RAM + Color RAM + $D021 value. See `koala_format` below for load and display procedures.

### Cycle budget

Multicolor bitmap mode has the same CPU cycle budget as standard bitmap mode. Badlines, sprite DMA, and VBI overhead are identical. There is no extra cost for the MCM pixel decoding; the VIC-II does it in hardware.

### Recipes

- `recipes/oscar64/bitmap-koala-viewer.md` — set up multicolor bitmap, populate screen/color RAM, display a static image.

---

## ecm_mode — Extended Color Mode (text only)

**Complexity:** low
**Region:** both
**Uses registers:** D011, D022, D023, D024
**Uses kernal:** (none)
**Claims:** none
**Claims basis:** measured-vice

Store trace of `recipes/oscar64/vehicle-control.md`: the ECM bit rides on
`soft_scroll_v`'s `$D011` store, and ECM ($D011 bit 6) is not a unit
yet. A clash with another mode bit cannot be seen by the unit check.

### Why

Standard text mode gives each character cell one foreground color and one global background color ($D021). For games that need distinct background regions (sky, ground, water), changing $D021 globally is too coarse. Extended Color Mode (ECM) allows four different background colors selectable per character cell, at the cost of reducing the usable character set from 256 to 64 glyphs.

ECM is a text mode, not a bitmap mode, but it belongs in this document because it shares the $D011 control register with the bitmap modes and is part of the full mode-bit matrix.

### How

Enable ECM by setting bit 6 of $D011 to 1. BMM (bit 5) must remain 0; setting both ECM and BMM simultaneously produces one of the VIC-II's invalid (all-black) modes.

The top two bits of each character code byte in screen RAM are repurposed as a background selector rather than part of the glyph index. This means only character codes 0-63 address distinct glyphs; codes 64-127, 128-191, and 192-255 all display one of the 64 base glyphs but with a different background color:

| Code bits 7-6 | Background register |
|--------------|---------------------|
| %00 (codes 0-63) | $D021 (BGCOL0) |
| %01 (codes 64-127) | $D022 (BGCOL1) |
| %10 (codes 128-191) | $D023 (BGCOL2) |
| %11 (codes 192-255) | $D024 (BGCOL3) |

Foreground color for each cell still comes from Color RAM as in standard text mode. Sprite behavior, scroll registers, and all other VIC-II facilities work identically.

### Why it works

The VIC-II character decoder reads the character pointer from the video matrix (c-access), passes the low 6 bits to the character generator for the glyph fetch (g-access), and uses bits 6-7 of the pointer to select which of the four background color registers drives the cell's background pixels. The character generator still has 64 rows of 8 bytes each; bits 6-7 never reach the address bus on glyph lookup.

### Variations

**Platform game zones**: use codes 0-63 for sky-colored background, 64-127 for earth-colored cells, 128-191 for cave cells. The glyphs can be the same 64 tiles; only their background tint changes. This gives a cheap color-region effect with minimal code.

**ECM + sprite overlay**: since sprites render over the ECM background as in text mode, a sprite-based player character requires no special handling. The ECM background acts as a colored playing field.

### Cycle budget

ECM is a text mode; the cycle budget is identical to standard text mode. No additional register writes are needed per frame unless background colors need to change. Switching between ECM and standard text requires only a write to $D011.

### Recipes

- No recipe yet for ECM zones.

---

## mcm_text — Multicolor Char Mode

**Complexity:** low
**Region:** both
**Uses registers:** D016, D018, D021, D022, D023
**Uses kernal:** (none)
**Claims:** vic_char_base (owns)
**Claims basis:** measured-vice

Store trace (`scripts/claims-watch.ts`, VICE x64sc, PAL) of
`recipes/kickassembler/mcm-text.md`: one `$D018` store (`$1C`) moves the
character base to the multicolour charset at `$3000`; the matrix stays at
`$0400`. The ROM font is drawn for hires, so a multicolour screen needs
its own glyphs and holds the base. MCM ($D016 bit 4) is a mode bit, not a
unit yet, so a clash with another mode bit cannot be seen by the unit
check.

### Why

Standard text mode gives 8x8 hires character cells with two colors each. Sprites are limited to 8 and cost DMA cycles; a custom character set with 4-color glyphs renders repeating graphics cheaply. Multicolor character mode gives 4x8 effective resolution per character cell (double-wide pixels) with four colors, three of which can be shared across all cells or chosen globally.

### How

Enable multicolor character mode by setting bit 4 of $D016 (MCM) to 1. BMM ($D011 bit 5) must be 0.

The color assignment per cell depends on bit 3 of the Color RAM nibble for that cell:

- If Color RAM bit 3 is **0**, the cell renders as a standard hires character: 8x8, two colors (foreground = Color RAM bits 0-2, background = $D021). MCM has no effect on this cell.
- If Color RAM bit 3 is **1**, the cell renders as multicolor: 4x8 double-wide pixels, four colors:

| Pattern | Color source |
|---------|-------------|
| %00 | $D021 (BGCOL0) |
| %01 | $D022 (BGCOL1) |
| %10 | $D023 (BGCOL2) |
| %11 | Color RAM bits 0-2 (per-cell, 8 colors only) |

The glyph data is fetched from the character generator normally; the chip only changes how it interprets the bit patterns. Custom character sets work as in text mode: set $D018 bits 3-1 to the desired character generator base, and populate that RAM with 8 bytes per glyph.

The %11 pattern in MCM text uses only the low 3 bits of Color RAM, giving 8 foreground choices (not 16). This contrasts with multicolor bitmap mode, where %11 uses all 4 Color RAM bits for 16 choices.

$D025/$D026 (sprite multicolour 0/1) were formerly listed in the Uses registers line because setup routines often write them alongside; they play no part in character MCM (measured in VICE x64sc: an MCM cell with $D025/$D026 set to distinct colours rendered only $D021/$D022/$D023/Colour-RAM) and have been removed from the Uses line.

### Why it works

In the chip's pixel rendering path, the MCM bit in $D016 selects whether to clock the output shift register at 1 bit per clock (hires) or 2 bits per clock (multicolor). The per-cell opt-in through Color RAM bit 3 means the chip must check that bit every cell during rendering. The character generator fetch is otherwise unchanged: the same 8 bytes are read; the bit-pair interpretation happens in the output shift register, not the character generator.

### Variations

**Mixed hires/multicolor cells**: set Color RAM bit 3 selectively so some cells render hires and others render multicolor. Fine-detail hires characters and multicolor characters then share the same 40x25 grid.

**Animation through charset swaps**: switch $D018 bits 3-1 during the vertical blank to point to an alternate character set, giving full-screen character animation at 50/60 Hz without touching individual screen RAM bytes.

### Cycle budget

MCM text mode has the same cycle budget as standard text mode. No per-frame overhead beyond the initial setup writes.

### Recipes

- `recipes/kickassembler/mcm-text.md`: one glyph in eight multicolour
  and eight hires cells on one screen, measured pixel for pixel in VICE
  x64sc on PAL and NTSC, with `$D025`/`$D026` as a control.

---

## fli_image — FLI (Flexible Line Interpretation)

**Complexity:** scene-tier
**Region:** PAL
**Uses registers:** D011, D018, D016
**Uses kernal:** (none)
**Demands:** cpu_every_line, constant_sprite_set
**Requires:** stable_raster_irq, multicolor_bitmap, vic_bank_select
**Raster band:** 45-251 (the fli-image recipe's first IRQ is on line 45; its last FLI line is 250 and the handler exits near cycle 50 of line 251)
**Cost:** cycles_per_line=63, lines_active=207, cycles_per_frame=13041, bytes_code=3488, bytes_data=16001, irq_slots=1
**Cost basis:** arithmetic
**Cost measured on:** kickassembler-fli-image
**Cost includes:** stable_raster_irq, double_irq
**Claims:** vic_raster_irq (owns), cia2_vic_bank (owns), vic_yscroll (owns), vic_matrix_base (owns), vic_char_base (owns)
**Claims basis:** derived-listing

The handler stores `$D011` and `$D018` on every FLI line: YSCROLL forces
the badline, the matrix bits pick the line's colour screen, and each
whole-byte `$D018` store rewrites the bitmap base with it. A store trace
of `recipes/kickassembler/fli-image.md` (`scripts/claims-watch.ts`) saw
YSCROLL and the matrix bits change on every line. The three VIC field
units were added with the units themselves ([#71](https://github.com/bdgscotland/c64-kb/issues/71)).

### Why

Multicolor bitmap mode gives 160x200 pixels with only four colors per 8x8 cell. The VIC-II reuses the same screen RAM row for all 8 scanlines that make up one character row, meaning the per-cell color palette repeats 8 times vertically. An image with vertical color variation (a gradient, a portrait, a landscape) must compress 8 vertical pixels of color choice into a single screen RAM byte.

FLI (Flexible Line Interpretation) re-uploads new screen RAM values to the chip on every scanline, so each of the 200 visible scanlines has its own per-cell color palette. A multicolor FLI image has 160x200 pixels with up to 8000 unique color combinations (one per cell-per-line), versus MCM's 1000 cell palettes shared 8 lines each.

### How

FLI makes *every* display line a badline. The chip only reloads its 40-entry
colour latch on a badline, and a badline is any line where `(line & 7) ==
YSCROLL`; so on each line the code writes YSCROLL = line & 7 into $D011, and
before that writes $D018 to point at the screen page that holds this line's
colours. Two writes per line, 200 lines, from one stable raster entry at the
top of the frame; there are no per-line interrupts, and could not be, since
a badline leaves the CPU 20 cycles.

The full FLI setup:

1. Eight 1 KB screen RAM pages in the same 16 KB VIC bank as the bitmap
   (line `l` uses page `l & 7`), each pre-filled with that line's colour
   nibbles. With the bitmap at offset $2000 the eight screens fill offsets
   $0000-$1FFF, and in banks 0 and 2 the VIC sees the character ROM at
   offsets $1000-$1FFF (`memory-banking.md`, `../hardware/c64-memory-map.md`),
   so this layout needs bank 1 or 3, selected through `$DD00`
   (`vic_bank_select`). An earlier version said only that bank 0 was
   crowded and that FLI displays "usually" live in bank 1 or 3.
2. The 8000-byte multicolor bitmap at offset $2000 in the bank; $D016 with
   MCM set.
3. A stable raster IRQ (double IRQ) a few lines above the display, then a
   delay to the first display line, which is a natural badline and stalls
   the CPU to cycle 55 whatever the delay's exact length was.
4. For each line from the second to the last, unrolled: `LDA #page / STA
   $D018 / LDA #$38|(line&7) / STA $D011`, padded so the $D011 write's
   badline condition arises on cycle 15. The CPU then stalls until cycle 55,
   which is what makes each line's block start on the same cycle as the
   last without any counting of the stall itself.

Why cycle 15 and not earlier: in cycle 14 the VIC resets its row counter RC
to 0 if the badline condition holds *in that cycle*. A condition already
true in cycle 14 on every line would keep RC at 0 and display the first
line of the first character row forever. With the previous line's YSCROLL
still in the register during cycle 14, the condition is false there, RC
counts normally and the rows advance; the write on 15 then triggers the
c-accesses late. Why not later: c-accesses start three cycles after BA
drops and skip the columns whose slot has passed, and those columns read
$FF. Cycle 15 loses three columns; every cycle later loses one more.

That is the FLI bug: the three leftmost character columns of every line
show colour $F in both nibbles, light grey (in multicolour mode, both the
%01 and %10 pixels). It is intrinsic to the method on the 6569 and the
6567; FLI pictures cover it with sprites, a border, or content that does
not mind.

The colour resolution is 160x200 with four colours per 4x1 cell-line
(background, two from the line's screen page, one from Colour RAM, which is
not paged and stays per 8x8 cell), for 8000 distinct colour sets instead of
1000.

### Why it works

The VIC-II's c-access mechanism fetches 40 screen RAM bytes into an internal 40x12-bit latch during cycles 15-54 of each badline, and uses that latch for every line until the next badline. The address it fetches from is whatever $D018's VM bits say at the moment of each c-access. FLI forces a badline on every line and has $D018 already pointing at the line's page when the condition arises, so every line's latch is filled from a different page. The badline condition is evaluated every cycle, not only at the start of the line, which is what allows the code to *create* one mid-line with a $D011 write.

The stable raster entry is needed once, at the top: after that the natural badline on the first display line and the forced badlines on every line after it re-phase the CPU to cycle 55 each time, so the per-line code is straight-line and self-timing. Measured in VICE for `recipes/kickassembler/fli-image.md`: with the $D011 write placed for cycle 15 the picture shows three grey columns; one cycle later the grey band is a column to the right and column 0 keeps a stale colour; one cycle earlier the display repeats a row.

### Variations

**Eight pages, not "reduced"**: an earlier version listed the eight-page layout here as a "reduced-bank" variation of a 200-page baseline; there was no such baseline. Eight pages is what the data needs: a line needs 40 colour bytes, 200 lines need 8000, and eight 1 KB pages hold exactly that with page p, row r serving line 8r+p. Eight is also all that fits, since the pages must share the 16 KB VIC bank with the 8 KB bitmap and $D018's VM nibble reaches only 16 pages in a bank. The page is chosen by $D018, not by YSCROLL; YSCROLL only decides which line becomes a badline.

**FLI with static bitmap**: the bitmap data itself does not change per scanline. Only screen RAM rotates. The bitmap carries shape information and screen RAM carries color information, so tools can edit them independently.

**Sprite overlay on FLI**: sprites are not affected by $D018 changes. Sprites render normally on top of or behind the FLI bitmap according to $D01B priority bits. A FLI background can therefore coexist with sprite-based characters.

### Cycle budget (PAL)

FLI on PAL, per display line:

- VIC bus: 40 cycles (15-54), BA low from 12.
- `LDA # / STA $D018 / LDA # / STA $D011`: 12 cycles, the last write on 15.
- Padding between the end of one line's stall (cycle 55) and the next
  block: 11 cycles.
- Left for anything else: nothing. Sprites active in the FLI region would
  add their own bus cycles and move the stall; music and logic run in the
  112 border lines.

The Cost line charges the whole band: lines 45 to 251 are 207 lines, and
207 × 63 = 13,041 cycles a frame (arithmetic from the band). An earlier
Cost line said `lines_active=200` and 12,600: it counted the 200 FLI
lines, not the band the handler holds from its first IRQ to its exit.
The stable entry (`stable_raster_irq` by a double IRQ, step 3 above)
runs inside the band, so the Cost includes line names both and a budget
does not add them again.

The byte figures are KickAssembler 5.25's `-showmem` for the recipe
listing: code $0900-$169F is 3,488 bytes, and data is the one-byte
`saved_sp`, eight 1,000-byte screen pages and the 8,000-byte bitmap,
16,001 bytes. An earlier Cost line said `bytes_code=3277` and
`bytes_data=16384`, which are 3.2 KB and 16 KB multiplied by 1,024, not
the segments, and its basis said `estimated`; every figure on the line is
now arithmetic or read off the listing, so the basis is `arithmetic`.

Code size: 16 bytes per line unrolled, 3.2 KB for 200 lines. The old
figure of "25-30 cycles per line" for an IRQ-per-line handler described
something that does not fit in a badline and was never run.

On NTSC the block structure is unchanged: the c-accesses still occupy cycles 15-54, the stall still ends on cycle 55 and the $D011 write must still land on cycle 15, so each line's padding grows by the line's extra cycles: `LINE_PAD` 13 on the 6567R8 (65 cycles) and 12 on the 6567R56A (64), instead of the recipe's 11. The entry delay spans three lines and grows the same way (`ENTRY_PAD` 204 on the 6567R8); with the PAL value the first two or three FLI lines come out wrong. Measured in VICE x64sc `-model ntsc` / `-model oldntsc`: with the PAL padding one grey column appears on the 6567R8; with 13 (12 on the R56A) the same three as PAL, and with the entry delay also lengthened the picture matches PAL line for line. (An earlier version of this paragraph spoke of "badline onset relative to IRQ fire"; there is no per-line IRQ in the method, so that named nothing.)

### Recipes

- `recipes/kickassembler/fli-image.md` — full FLI display engine with stable raster, page rotation, and bitmap layout.

---

## afli_image — AFLI (Advanced FLI)

**Complexity:** scene-tier
**Region:** PAL
**Uses registers:** D011, D018
**Uses kernal:** (none)
**Demands:** cpu_every_line, constant_sprite_set
**Requires:** fli_image
**Raster band:** 45-251 (fli_image's engine, which How says this reuses unchanged)
**Claims:** none
**Claims basis:** measured-vice

Store trace (`scripts/claims-watch.ts`, VICE x64sc, PAL) of
`recipes/kickassembler/afli-image.md`: every unit the listing writes (VIC
bank, matrix base, character base, YSCROLL, raster compare) is claimed by
`fli_image` and its prerequisites. AFLI's own change is `$D016` with MCM
clear, a mode bit and not a unit yet. The recipe measures this section's
model pixel for pixel on PAL, including the `LINE_PAD` 10 row-counter
reset described under "Cycle budget".

### Why

AFLI is hires FLI: the FLI trick applied to standard bitmap mode instead of multicolour. Plain hires gives 320x200 pixels but only two colours per 8x8 cell, both from the cell's screen RAM byte. Re-fetching screen RAM on every line, as `fli_image` does, shrinks the attribute cell to 8x1: every line of every cell gets its own foreground and background pair. Each cell stays two-colour; dithering between adjacent pairs simulates more, and the result reads like 16-colour dithered PC graphics (`art/art-production-reference.md`, "AFLI — Advanced FLI (Hires FLI)", agrees and does not cite this page).

An earlier version of this section described AFLI as multicolour FLI plus a second 8 KB bitmap whose CB bit was toggled per line, giving "interleaved two-plane pixels". That was wrong: there is one bitmap, the mode is hires, and $D016's MCM bit stays clear. Its memory budget was also impossible: two 8 KB bitmaps at $0000 and $2000 fill a 16 KB VIC bank, leaving no room for the eight screen pages the same text required.

### How

Layout: eight 1 KB screen pages at bank+$0000..$1FFF (line `l` uses page `l & 7`) and the 8000-byte hires bitmap at bank+$2000, the `fli_image` layout, 16 KB in total. Set BMM ($D011 bit 5) and leave MCM ($D016 bit 4) clear; the CB bit of $D018 is 1 throughout, only the VM nibble changes per line.

The per-line engine is `fli_image`'s, unchanged: one stable raster entry at the top of the frame, then an unrolled `LDA #page / STA $D018 / LDA #$38|(line&7) / STA $D011` block per line, the $D011 write making the badline condition true on cycle 15, the CPU stalled to cycle 55 on every line. Colour RAM is fetched by the c-access but not used in hires bitmap mode, so both colours of every 8x1 cell come from the line's screen page (high nibble foreground, low nibble background).

Koala Painter files are multicolour and are not AFLI source; AFLI pictures come from hires-FLI editors or converters that emit a hires bitmap plus eight screen pages.

### Why it works

The VIC-II fills its 40-entry colour latch from the video matrix only on a badline, and in hires bitmap mode the two colours of a cell are the two nibbles of that latch entry. Forcing a badline on every line with $D018 already pointing at that line's page (see `fli_image`, "Why it works") refills the latch from a different page each line, so the two-colour attribute changes every line while the bitmap bit for line `l` of a cell is still read from its fixed place, `(row*320 + col*8 + (l & 7))`. The FLI bug is present as in multicolour FLI: the three leftmost columns of every line read $FF from the video matrix and show colour $F on colour $F, light grey.

### Variations

**AFLI for portraits**: suits faces and gradients, where vertical colour resolution shows most.

**Hires IFLI**: two AFLI frames alternated at frame rate, i.e. two bitmaps and two sets of eight screen pages (32 KB across two VIC banks); see `ifli_image`.

### Cycle budget (PAL)

The cycle budget is identical to `fli_image`: two writes per line (`STA $D018`, `STA $D011`), the $D011 write making the badline condition true on cycle 15, nothing left over; the $D018 value carries more bits but the instruction costs the same four cycles. An earlier version said AFLI adds 2-4 cycles per line and that the write lands "before cycle 15"; neither is right. The 63-cycle line is 40 VIC bus + 12 block + 11 padding, so there is no slack, and a write effective on cycle 14 resets RC: measured in VICE x64sc (PAL) with the fli-image listing's bitmap rows alternating $55/$00, `LINE_PAD` 10 shows every line drawing bitmap row 0 and only two grey columns, `LINE_PAD` 11 shows the rows advancing and three grey columns.

---

## ifli_image — IFLI (Interlaced FLI)

**Complexity:** scene-tier
**Region:** PAL
**Uses registers:** D011, D018
**Uses kernal:** (none)
**Demands:** cpu_every_line, constant_sprite_set
**Requires:** fli_image
**Raster band:** 45-251 (fli_image's per-line engine only; the page does not say on which line the image swap runs)

### Why

FLI gives per-scanline color variation, but the horizontal pixel resolution of multicolor bitmap remains 160 pixels. IFLI (Interlaced FLI) raises effective resolution to 320x200 by rendering two different FLI frames on alternating PAL frames and relying on the display's phosphor persistence to blend them. The viewer perceives an image with more horizontal detail than either frame alone provides.

IFLI is a demoscene C64 art format. It requires two complete, independently prepared FLI images and a frame-alternating engine.

### How

IFLI requires two complete FLI images (each with its own 8000-byte bitmap and its own eight screen RAM pages) stored in memory simultaneously. Colour RAM is single and shared: there is one 1 KB at $D800, read by the VIC-II over its own bus regardless of $D018 or $DD00, and rewriting it between frames (1,000 bytes, at least 8,000 cycles) does not fit in the roughly 7,000-cycle PAL vertical blank the FLI engine leaves free. The %11 colour of each cell is therefore the same in both sub-frames, and IFLI image formats store a single Colour RAM block. (An earlier version of this sentence gave each sub-frame "a Color RAM state", contradicting the cycle budget below.) On even PAL frames, image A is displayed; on odd frames, image B. The picture changes every frame, 50 times a second on PAL, so each image is shown 25 times a second; with CRT phosphor persistence the eye integrates the two. (An earlier version said the images alternate "at 50 Hz", which is the frame rate, not the rate of either image.)

The frame alternation is driven by a vertical blank IRQ (or a top-of-frame raster IRQ) that swaps the bank layout or bitmap/screen RAM addresses pointed to by $D018. Within each frame, the per-line FLI write block runs exactly as described in `fli_image`.

The two images are typically prepared as slightly horizontally-offset variants of the same source — image B shifted one pixel left or right relative to image A. The overlap creates the perception of 320-wide content. Preparing an IFLI pair from source art is an image-processing task that dedicated tools (IFLI converters) handle.

### Why it works

The VIC-II's output is a composite video signal. On a real CRT display, each scanline's phosphors retain charge for a fraction of a frame. When two similar images alternate frame by frame (each at 25 Hz on PAL), the eye blends them in both spatial and temporal dimensions. The 160-pixel-wide multicolor pixels of each sub-frame appear to blend with the offset pixels of the opposite frame, which reads as 320-pixel hires color content.

The pixel buffer does not change: both frames are full multicolor bitmap images with the same 160x200 pixel grid. The resolution improvement is perceptual, a property of the human visual system and the CRT. IFLI images do not look the same on LCD monitors without post-processing; dedicated IFLI-aware emulator display modes apply a blending filter to simulate the CRT integration.

### Variations

**IFLI on NTSC**: the two sub-frames alternate at 30 Hz (60 Hz frame rate) instead of PAL's 25 Hz. The engine is the same; what differs is the per-line cycle count (65 vs 63), which lengthens the per-line padding by two cycles and needs its own cycle counting; see the NTSC note under `fli_image`. An earlier version of this paragraph said 30 Hz flickers *more* because it is "closer to the flicker-fusion threshold"; that mechanism was inverted (the threshold is the rate above which flicker is no longer seen, so being nearer to it from below means less visible flicker, not more) and nothing in this repo measures either standard. How visible the flicker is on PAL or NTSC is a display and viewer question, not measured here.

**Hires IFLI**: two hires-FLI (`afli_image`) frames alternated, i.e. two bitmaps and two sets of eight screen pages (32 KB across two VIC banks), doubling the effective colour resolution of the 8x1 cells. (An earlier version called this "IFLI with AFLI basis" and spoke of "four complete image planes"; it is two.)

**Single-frame IFLI display**: some demo effects display an IFLI pair for a fixed number of frames then freeze on one sub-frame, useful for a zooming-in effect where the image appears to sharpen as it holds.

### Cycle budget (PAL)

IFLI's per-frame cycle budget is the same as FLI: one stable raster entry per frame and an unrolled two-write block per line; there is no per-line IRQ, and could not be (see `fli_image`; an earlier version of this sentence said "one stable raster IRQ per scanline"). The extra work is a handful of writes at the top of each frame to switch to the other image: since one FLI image (eight 1 KB screen pages plus an 8000-byte bitmap) fills a 16 KB VIC bank, the two images live in two banks and the swap is a $DD00 bank write, with the same unrolled $D018/$D011 block serving both. That is a few dozen cycles in the border lines.

The cost of IFLI is not cycles but memory: two complete FLI images occupy roughly 2 x (8000 + 8 x 1000) = 32,000 bytes of VIC-accessible RAM, plus Color RAM, which is a fixed 1 KB at $D800 and shared between both sub-frames.

---

## mci_interlace_bitmap — MCI (Multicolour Interlace): two multicolour bitmaps alternated with a half-pixel shift

**Complexity:** medium
**Region:** both
**Uses registers:** D011, D012, D016, D018, DD00
**Uses kernal:** (none)
**Requires:** multicolor_bitmap, frame_sync_loop
**Cost:** cycles_per_frame=50, bytes_data=18000
**Cost basis:** measured-vice
**Cost measured on:** kickassembler-mci-interlace
**Claims:** cia2_vic_bank (owns), vic_matrix_base (owns), vic_xscroll (owns)
**Claims basis:** measured-vice

Store trace of `recipes/kickassembler/mci-interlace.md`: each frame the
switch changes the VIC bank (`$DD00`), the matrix (`$D018` bits 4-7) and
XSCROLL (`$D016`, the half-pixel shift): 243-244 stores of each in 8
million cycles. The bitmap base is `multicolor_bitmap`'s.

### Why

A multicolour bitmap has 160 pixels across, each two hires pixels wide, and four colours per cell. Showing two different multicolour bitmaps on alternate frames, with the second moved one hires pixel to the right, gives a display with any persistence a picture whose colour changes every hires pixel: twice the horizontal colour resolution of one frame, from plain multicolour bitmap hardware and a three-store switch each frame. The price is that each frame is shown at half the frame rate, 25 Hz on PAL and 30 Hz on NTSC, so wherever the two frames differ the picture flickers; how visible that is on a given display and to a given viewer is not measured here. MCI is the flat-bitmap member of the family whose per-line member is `ifli_image`.

### How

Two multicolour bitmaps with their own screens, one per frame. They do not fit in one VIC bank: two 8000-byte bitmaps and two 1000-byte screens are 18,000 bytes and a bank is 16,384, so frame A lives in one bank and frame B in another (the recipe uses bank 1 for A, bitmap $6000 and screen $5C00, $D018 = $78, and bank 0 for B, bitmap $2000 and screen $0400, $D018 = $18; bank 0's character ROM shadow at $1000 to $1FFF touches neither). Colour RAM is one 1 KB block at $D800, read by the VIC-II whatever bank or $D018 is selected, so the %11 colour of every cell is the same in both frames; a converter preparing an MCI pair has two screen nibbles per cell per frame but one colour RAM nibble per cell for both, and the background $D021 is likewise one value unless it is changed in the blank as well.

Once per frame, below the display (`frame_sync_loop` on raster line 251, which is past the 200-line window on both models), the loop stores $DD00 for the bank, $D018 for the screen and bitmap, and $D016 whole: $D8 on even frames (MCM on, 40 columns, XSCROLL 0) and $D9 on odd frames (XSCROLL 1). XSCROLL moves the display in hires pixels and a multicolour pixel is two of them, so the odd frame is half a multicolour pixel to the right. The switch is made inside one raster line and the loop then waits for $D012 to leave that line, because a switch shorter than a line would otherwise match the same line twice and swap twice in one frame.

Measured in VICE x64sc on the `mci-interlace` recipe, which draws its own test card (eight two-colour bands with the colours swapped between the frames, and one diagonal at the same multicolour position in both bitmaps): the diagonal sits on columns 190 and 191 at row 134 in frame A and on 191 and 192 in frame B, one hires pixel apart at every measured row; with XSCROLL left at 0 on both frames (the control build) the two diagonals coincide at 190 and 191 and only the band colours alternate, a blend without the resolution gain. The pixel average of the two frames puts four distinct columns, pure colour, blend, the other pure colour, blend, where one frame has two; the numbers are on the recipe page. With XSCROLL 1 in 40-column mode the leftmost hires column shows the background colour, so frame B's column 32 is black on every row.

### Why it works

The VIC-II fetches its bitmap and screen bytes from whichever 16 KB the $DD00 bits and $D018 name at the moment of the fetch, so a bank and pointer change made in the vertical blank takes effect cleanly on the next field with no copying; the two frames are both complete pictures in memory all the time. XSCROLL delays the start of pixel output by up to seven hires clocks for the whole display, and in multicolour mode the shift register still emits its pairs two clocks wide, so a shift of one clock puts frame B's pixel boundaries exactly between frame A's. On a display with persistence, or in the eye, the two fields add, and each hires column of the sum carries either one frame's colour where the two agree or the mean of the two where they differ. That is the same perceptual mechanism as `ifli_image`, which adds the per-line colour changes of FLI to it; MCI keeps the plain 8x8 cell colour limits and gets its gain from the alternation alone. The improvement is not in the frame buffer: each field is still a 160-pixel-wide multicolour picture, and VICE's exit screenshot shows one field at a time.

### Cycle budget

Measured with CIA1 timer A on the recipe, the same on PAL and NTSC: 34 cycles on the even frame and 32 on the odd from the timer start after the $D012 match to the read after the last of the three stores (the even path takes a `jmp` the odd path does not), plus 16 from the match to the timer start by the instruction table, so 50 cycles from the raster match to the last store. With the two polls of $D012 the loop is under two raster lines a frame and the rest of the frame is free for other work. Memory, not time, is the cost: 18,000 bytes of bitmaps and screens in two VIC banks, plus the shared 1 KB of colour RAM.

### Variations

**IFLI.** The per-line cousin: two FLI pictures alternated the same way, with eight screen pages per frame and a stable raster engine rewriting $D018 every line; see `ifli_image`. It needs two banks for the same reason MCI does, and inherits FLI's cpu_every_line demand, where MCI leaves the frame free.

**Switch on a raster line inside the frame.** Making the bank and $D018 change at a line inside the display instead of below it gives a picture whose upper part is one frame and lower part the other for that field, so the interlaced region can be confined to a band of lines and the rest of the screen held static and flicker-free; the switch line must then be the same every frame, in the border of the line, or the join tears.

**Same bitmap, shifted.** Alternating one bitmap with itself, XSCROLL 0 and 1 on alternate frames, blends each multicolour pixel with its neighbour and reads as a soft 320-wide picture with no second bitmap and no second bank; the colour count does not rise, only the edges smear, and the flicker is confined to colour boundaries.

### Pitfalls

- `d016_unmasked_rmw_clobbers_csel_mcm` (`pitfalls/scroll.md`): the switch writes $D016 whole every frame; write it from a constant that carries MCM and CSEL, as the recipe does, not from the XSCROLL value alone.
- `vic_bank_visibility_collision` (`pitfalls/banking.md`): each frame's bitmap and screen must be inside the bank that frame selects, and the two banks are switched with $DD00 every frame; a bitmap or screen placed in the other bank, or a pair that does not fit in one, shows garbage on that frame only, which flickers at 25 Hz and reads as a timing fault.

### Recipes

- `recipes/kickassembler/mci-interlace.md` — two banks, a self-drawn test card, the half-pixel measured against a control, the frame-loop cost timed, and a PIL average of the two fields.

---

## koala_format — Koala Painter format load and display

**Complexity:** low
**Region:** both
**Uses registers:** D011, D016, D018, D021
**Uses kernal:** (none)
**Requires:** multicolor_bitmap
**Claims:** vic_char_base (owns)
**Claims basis:** measured-vice

Store trace of `recipes/oscar64/bitmap-koala-viewer.md`: display step 5,
the `$D018` store, moves the character base to the bitmap. The
`**Requires:**` line was added with the claim: the format is a
multicolour bitmap, and without it the check would set this technique
against `multicolor_bitmap` as a rival owner of the base.

### Why

Koala Painter (1984) was the most used C64 painting tool through the 1980s and into the 1990s, and its file format became the de facto interchange format for C64 multicolor bitmap images. Much C64 artwork survives in .kla format, so a program that displays arbitrary C64 artwork has to parse Koala files.

The format is also a direct representation of a multicolor bitmap image: bitmap data, screen RAM, Color RAM and the background color register, as the chip reads them.

### How

A Koala Painter file has the following structure:

| Offset | Size | Content |
|--------|------|---------|
| 0x0000 | 2 | Load address, little-endian (typically $6000 or $0000) |
| 0x0002 | 8000 | Bitmap data, 320x200 / 8 bytes |
| 0x1F42 | 1000 | Screen RAM (video matrix), 40x25 color nibbles |
| 0x232A | 1000 | Color RAM, 40x25 color nibbles |
| 0x2712 | 1 | Background color ($D021 value) |

Total file size: 10003 bytes (with 2-byte load address) or 10001 bytes (raw, some variants omit the load address).

The load address at offset 0 is a standard C64 PRG-format header: two bytes little-endian indicating where the file should be loaded in CPU address space. Koala Painter itself loads the file to $6000, placing bitmap at $6000, screen RAM at $7F40, Color RAM at $8328, and background byte at $8710. These addresses are commonly used by display loaders to avoid the need to parse the header.

**Display procedure**:

1. Copy the 8000-byte bitmap to the desired bitmap location in the VIC bank (typically $2000 or $6000).
2. Copy the 1000-byte screen RAM segment to the VIC bank's video matrix location.
3. Copy the 1000-byte Color RAM segment to $D800.
4. Read the single background color byte and write it to $D021.
5. Update $D018 to point the VIC at the bitmap and video matrix locations.
6. Set $D011 bit 5 (BMM) and $D016 bit 4 (MCM) to enable multicolor bitmap mode.

### Why it works

The Koala format is a direct serialization of the three memory regions that multicolor bitmap mode reads during rendering. The bitmap data feeds g-accesses directly; screen RAM feeds c-accesses on badlines; Color RAM is read separately by the chip at cycle granularity as $D800 + cell_offset. The background byte goes to $D021, which the chip reads for the %00 color on every rendered pixel. Placing these exactly as the format specifies and enabling the two mode bits produces the image immediately.

The VIC bank and $D018 pointer configuration determines where in the 64 KB address space the chip looks. If loading to $6000 (within VIC bank 1, CIA2 $DD00 bits = %10), the bitmap is at bank-offset $2000, placing $D018 CB2 = 1. The screen data at $7F40 is at bank-offset $3F40, which is not on a 1 KB boundary ($3F40 mod $400 = $340), so no $D018 VM value can point the VIC at it in place; the nearest page, VM = %1111, is $7C00. The offset $1F40 is itself $340 past a 1 KB boundary, so no 8 KB-aligned load address puts both the bitmap and the screen block where $D018 can reach them. The bitmap can stay at $6000 (bank 1, CB = 1), but the screen block must be copied to a 1 KB-aligned page in the same bank that does not overlap the bitmap ($4000-$5C00, i.e. VM = %0000-%0111), and Color RAM to $D800 in any case. Most display loaders copy all three blocks to a clean layout, as below. (An earlier version said the screen offset "rounds to $3C00"; it does not round, and the page at $7C00 holds no Koala data.)

For Oscar64 programs, the recommended approach is to copy the Koala bitmap to $2000 in bank 0 (VIC offset $2000), screen RAM to $0400 (VIC offset $0400), and Color RAM directly to $D800, then set $D018 = $18 (VM = 1 = $0400, CB = bit 3 = 1 = $2000 bitmap). This keeps the VIC configuration simple and predictable.

### Variations

**Streaming from disk**: load the Koala file in the background using a turbo loader while displaying a placeholder screen, then swap in the bitmap on a VBI boundary. The Koala layout is sequential enough that the copy sequence is also the disk read order.

**Koala animation**: $D018 can only place a bitmap at offset $0000 or $2000 of the current 16 KB bank (bit 3; bits 1-2 are ignored in bitmap mode, measured in VICE x64sc), and two 8000-byte bitmaps leave only two 192-byte gaps, neither a 1 KB-aligned block for a second screen RAM page, so two complete frames do not fit one bank. Each resident frame lives in its own VIC bank (bitmap at offset $2000 in banks 0 and 2 to avoid the character ROM shadow at $1000-$1FFF/$9000-$9FFF), selected by $DD00 bits 0-1 and $D018 together, so at most four frames resident at once. $D018/$DD00 redirect only the bitmap and video matrix: each frame's 1,000-byte Colour RAM block must still be copied to $D800 (about 8,000 cycles unrolled, LDA abs/STA abs) and its background byte written to $D021. With frames resident the flip itself is cheap; loading from disk is the limit, which is where the practical 6-10 fps comes from. (Earlier text said several frames could be flipped by $D018 alone.)

**Koala + sprite overlay**: because sprites are independent of bitmap mode, a Koala image can serve as a full-screen background with sprite-based animated foreground elements. Set $D01B appropriately for depth ordering.

**Paletted color shift**: write a different value to $D021 each frame without touching the bitmap or screen RAM. This shifts the background tone of the entire image, producing a cheap palette animation that works on any Koala image. Similarly, writing to screen RAM nibbles mid-frame or between frames alters the per-cell %01/%10 colors.

### Cycle budget

Koala display is not cycle-sensitive once the mode is enabled, but the copy is not small. Measured in VICE x64sc (PAL, CIA timer, screen blanked): a basic indexed page loop (LDA abs,X / STA abs,X / INX / BNE, 14 cycles per byte) copies the 10,000 bytes in about 140,000 cycles, and a fully unrolled LDA abs / STA abs copy costs 8 cycles per byte, 80,000 cycles for the whole image (and 60 KB of code, so a partially unrolled loop lands between the two). With the screen on, badline DMA adds roughly 6 % more. That is four to seven PAL frames of 19,656 cycles; it does not fit the 7,056-cycle vertical border (112 lines x 63, lines 0-50 and 251-311). Copy before enabling BMM, or with the screen blanked (DEN = 0), and only then set $D018/$D011/$D016. Only the bitmap can be displayed in place: a file loaded at $6000 puts it at an 8 KB-aligned offset in bank 1, but the screen RAM that follows at +$1F40 is never 1 KB-aligned when the bitmap is 8 KB-aligned, and Color RAM must always be copied to $D800. An earlier version of this page gave 10,000-12,000 cycles for the copy and a 3,900-cycle VBI window; both were wrong.

For real-time conversion from disk, the raw data rate of the 1541 dominates the timing: about 406 bytes/second with the standard KERNAL loader (measured in VICE, `formats/iec-disk-reference.md`), 4000-6000 bytes/second with a turbo loader (not measured here). A 10,003-byte Koala file therefore takes about 25 seconds through the KERNAL (arithmetic from the measured rate), and under 3 seconds turbo-loaded. (An earlier version said about 300 bytes/second and 33 seconds.)

### Recipes

- `recipes/oscar64/bitmap-koala-viewer.md` — embed a .kla file, copy it to display RAM, enable multicolor bitmap mode.

<!-- doc-type: technique-reference -->
