---
category: bitmap
chip: VIC-II
---

<!-- doc-type: technique-reference -->

# Bitmap Modes

The VIC-II supports two hardware bitmap modes — standard hires and multicolor — each with its own memory layout, color resolution, and practical constraints. On top of these two fundamental modes, the scene has developed several scanline-switching techniques (FLI, AFLI, IFLI) that exploit the chip's internal video-matrix pipeline to push color fidelity far beyond what the hardware naively supports. This document covers all eight techniques in the bitmap family, from the simplest mode enable through the most demanding interlaced scanline-switcher.

Understanding the bitmap modes thoroughly is a prerequisite before attempting FLI variants. The FLI family builds entirely on the standard bitmap addressing described here; a mistake in the memory layout will manifest as wrong colors in an FLI image just as much as in a plain bitmap.

---

## standard_bitmap — Standard bitmap mode

**Complexity:** low
**Region:** both
**Uses registers:** D011, D018
**Uses kernal:** (none)

### Why

The default character mode gives only 40x25 cells with two colors per cell drawn from a shared character generator. Bitmap mode breaks that constraint: every one of the 64,000 pixels in the 320x200 display window is individually addressable in one of two colors chosen independently for each 8x8 cell. This is the foundation of all full-screen painted or rendered graphics on the C64.

### How

Enable standard bitmap mode by setting bit 5 (BMM) of $D011 to 1. The VIC-II's display sequencer then treats the video data as raw pixel bits rather than character indices.

Two separate memory areas are required within the current 16 KB VIC bank:

- **Bitmap data**: 8000 bytes (320x200 / 8) arranged as 25 rows of 40 cells, each cell occupying 8 consecutive bytes (one byte per scanline within the cell). The base address is controlled by $D018 bit 3 (CB2): 0 places the bitmap at offset $0000 in the bank, 1 places it at $2000.
- **Screen RAM (video matrix)**: 1000 bytes at any 1 KB boundary within the VIC bank, selected by $D018 bits 7-4. Each screen RAM byte encodes the two colors for one 8x8 cell — the high nibble is the foreground color (set bits in bitmap), the low nibble is the background color (clear bits).

Color RAM ($D800-$DBFF) is not read in standard bitmap mode.

The cell layout inside the bitmap is row-major: cell (col, row) starts at byte offset `(row * 40 + col) * 8` within the bitmap area. Bit 7 of each bitmap byte is the leftmost pixel in that scanline row of the cell.

To set up a standard bitmap:
1. Write the screen RAM with color nibbles for all 1000 cells.
2. Write pixel data into the 8000-byte bitmap area.
3. Write $D018 with the correct VM (screen RAM) and CB (bitmap base) nibbles.
4. Set $D011 bit 5 to 1.

### Why it works

In standard text mode the chip's g-access fetches a byte from the character generator ROM or RAM. In bitmap mode the same g-access mechanism reads sequentially from the 8000-byte bitmap area instead — the chip simply treats the bitmap as a 40x25x8 character set in which every character has a unique glyph. The per-cell two-color attribute lives in the video matrix (screen RAM), which the chip fetches on each badline exactly as it does in text mode. The only difference is which pixel source the chip reads on g-access cycles.

### Variations

**Split-screen hires/text**: program a raster IRQ to toggle $D011 bit 5 at the desired scanline boundary. This gives a bitmap area above and a text area below (or vice versa) within the same frame. Remember to update $D018 if the screen RAM positions differ between the two halves.

**Two-bitmap pages**: keep two 8000-byte areas at $0000 and $2000 in the VIC bank and alternate $D018 bit 3 each frame for double-buffering. Allows one page to be drawn while the other is displayed, eliminating partial-frame tearing.

**Single-color full bitmap**: set both nibbles of every screen RAM byte to the same value to make a pure black-on-background image, then use the bitmap bits to draw a single-color sprite-resolution graphic across the whole screen.

### Cycle budget

Standard bitmap mode does not change the cycle budget versus text mode. Badlines still occur on the same schedule (every 8 visible lines, wherever YSCROLL aligns them), each costing 40-43 CPU cycles. With no sprites active, a non-badline gives the CPU all 63 PAL cycles (65 NTSC).

Drawing into the bitmap from the main program is safe in the vertical blank or in the overscan region. Modifying bitmap bytes while those cells are being rendered produces visible tearing.

### Recipes

- `recipes/oscar64/standard-bitmap.md` — allocate and clear a bitmap framebuffer, set up $D018, enable BMM.

---

## multicolor_bitmap — Multicolor bitmap (MCM)

**Complexity:** low
**Region:** both
**Uses registers:** D011, D016, D018
**Uses kernal:** (none)

### Why

Standard bitmap mode gives 320x200 pixel resolution with only two colors per 8x8 cell. Many full-screen paintings require more than two colors per cell. Multicolor bitmap trades horizontal resolution for additional colors: each 8x8 cell gets four independent colors, at the cost of halving horizontal resolution to 160x200 (each displayed pixel is two bits wide).

The overwhelming majority of "C64 art" seen online — artwork from Koala Painter, Advanced Art Studio, PETSCII editors set to bitmap mode — is multicolor bitmap.

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

Because each pixel is two bits, the bitmap's 160 logical pixels per row are stored as 40 cells x 4 bytes-per-horizontal-tile, but the bitmap remains 8000 bytes — byte layout is unchanged, only interpretation differs.

### Why it works

The multicolor bit in $D016 changes how the chip interprets the pixel shift register during g-access rendering. Instead of shifting one bit at a time (hires, 8 clocks per byte), the chip shifts two bits at a time (4 clocks per byte). The two-bit pattern is decoded through the four-entry color lookup described above. All other chip mechanics — badlines, video matrix fetches, memory banking — are unchanged.

### Variations

**Mixed hires/multicolor bitmap**: you cannot mix per-cell within a single bitmap frame using only these two mode bits. However, you can do a full-frame mode switch via raster IRQ between a hires region and a multicolor region.

**Programmatic color cycling**: write new values to $D021 or to screen RAM/Color RAM bytes during the vertical blank each frame. Changing $D021 shifts the %00 color across the entire bitmap simultaneously, a cheap way to animate background tones or produce global color washes.

**Koala-format integration**: Koala Painter's .kla file format encodes a multicolor bitmap image directly as bitmap data + screen RAM + Color RAM + $D021 value. See `koala_format` below for load and display procedures.

### Cycle budget

Multicolor bitmap mode has the same CPU cycle budget as standard bitmap mode. Badlines, sprite DMA, and VBI overhead are identical. There is no extra cost for the MCM pixel decoding — it is done entirely in VIC-II hardware.

### Recipes

- `recipes/oscar64/multicolor-bitmap.md` — set up multicolor bitmap, populate screen/color RAM, display a static image.

---

## ecm_mode — Extended Color Mode (text only)

**Complexity:** low
**Region:** both
**Uses registers:** D011, D022, D023, D024
**Uses kernal:** (none)

### Why

Standard text mode gives each character cell one foreground color and one global background color ($D021). For games that need distinct background regions — sky, ground, water — changing $D021 globally is too coarse. Extended Color Mode (ECM) allows four different background colors selectable per character cell, at the cost of reducing the usable character set from 256 to 64 glyphs.

ECM is a text mode, not a bitmap mode, but it belongs in this document because it shares the $D011 control register with the bitmap modes and is part of the full mode-bit matrix that technique writers must understand.

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

**Platform game zones**: use codes 0-63 for sky-colored background, 64-127 for earth-colored cells, 128-191 for cave cells. The glyphs can be the same 64 tiles — only their background tint changes. This gives a cheap color-region effect with minimal code.

**ECM + sprite overlay**: since sprites render over the ECM background exactly as in text mode, a sprite-based player character requires no special handling. The ECM background acts as a colored playing field.

### Cycle budget

ECM is a text mode; the cycle budget is identical to standard text mode. No additional register writes are needed per frame unless background colors need to change. Switching between ECM and standard text requires only a write to $D011.

### Recipes

- `recipes/oscar64/ecm-zones.md` — set up four background color regions using ECM character code remapping.

---

## mcm_text — Multicolor Char Mode

**Complexity:** low
**Region:** both
**Uses registers:** D016, D018, D021, D022, D023, D025, D026
**Uses kernal:** (none)

### Why

Standard text mode gives 8x8 hires character cells with two colors each. Sometimes you want per-cell multicolor character graphics — sprites are limited to 8 and are expensive in terms of DMA cycles; a custom character set with 4-color glyphs can render complex repeating graphics cheaply. Multicolor character mode gives 4x8 effective resolution per character cell (double-wide pixels) with four colors, three of which can be shared across all cells or chosen globally.

### How

Enable multicolor character mode by setting bit 4 of $D016 (MCM) to 1. BMM ($D011 bit 5) must be 0.

The color assignment per cell depends on bit 3 of the Color RAM nibble for that cell:

- If Color RAM bit 3 is **0**, the cell renders as a standard hires character — 8x8, two colors (foreground = Color RAM bits 0-2, background = $D021). MCM has no effect on this cell.
- If Color RAM bit 3 is **1**, the cell renders as multicolor: 4x8 double-wide pixels, four colors:

| Pattern | Color source |
|---------|-------------|
| %00 | $D021 (BGCOL0) |
| %01 | $D022 (BGCOL1) |
| %10 | $D023 (BGCOL2) |
| %11 | Color RAM bits 0-2 (per-cell, 8 colors only) |

The glyph data is fetched from the character generator normally; the chip only changes how it interprets the bit patterns. Custom character sets work identically to text mode — set $D018 bits 3-1 to the desired character generator base, and populate that RAM with 8 bytes per glyph.

Note that %11 pattern in MCM text uses only the low 3 bits of Color RAM, giving 8 foreground choices (not 16). This contrasts with multicolor bitmap mode, where %11 uses all 4 Color RAM bits for 16 choices.

For sprite multicolor shared colors ($D025, $D026): these are listed in the Uses registers line because many programs set them in the same setup routine, though they affect sprites only and not the character MCM logic itself.

### Why it works

In the chip's pixel rendering path, the MCM bit in $D016 selects whether to clock the output shift register at 1 bit per clock (hires) or 2 bits per clock (multicolor). The per-cell opt-in through Color RAM bit 3 means the chip must check that bit every cell during rendering. The character generator fetch is otherwise unchanged — the same 8 bytes are read; the bit-pair interpretation happens in the output shift register, not the character generator.

### Variations

**Mixed hires/multicolor cells**: set Color RAM bit 3 selectively so some cells render hires and others render multicolor. This allows a mix of fine-detail character graphics and color-rich multicolor ones in the same 40x25 grid.

**Animation through charset swaps**: switch $D018 bits 3-1 during the vertical blank to point to an alternate character set, giving full-screen character animation at 50/60 Hz without touching individual screen RAM bytes.

### Cycle budget

MCM text mode has the same cycle budget as standard text mode. No per-frame overhead beyond the initial setup writes.

### Recipes

- `recipes/oscar64/mcm-charset.md` — define a 64-glyph multicolor character set, configure Color RAM, render a tiled background.

---

## fli_image — FLI (Flexible Line Interpretation)

**Complexity:** scene-tier
**Region:** PAL
**Uses registers:** D011, D018, D016
**Uses kernal:** (none)
**Demands:** cpu_every_line, constant_sprite_set

### Why

Multicolor bitmap mode gives 160x200 pixels with only four colors per 8x8 cell. The constraint is that the VIC-II reuses the same screen RAM row for all 8 scanlines that make up one character row, meaning the per-cell color palette repeats 8 times vertically. An image with rich vertical color variation — a gradient, a portrait, a landscape — must compress 8 vertical pixels of color choice into a single screen RAM byte.

FLI (Flexible Line Interpretation) breaks this constraint by re-uploading new screen RAM values to the chip on every scanline. The result is that each of the 200 visible scanlines effectively has its own per-cell color palette. A multicolor FLI image has 160x200 pixels with up to 8000 unique color combinations (one per cell-per-line), versus MCM's 1000 cell palettes shared 8 lines each.

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
   nibbles. Bank 0 is too crowded below $2000; FLI displays usually live in
   bank 1 or 3.
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

**Reduced-bank FLI**: rather than 200 separate screen RAM pages, use 8 pages (one per row within a character cell) and index them by `scanline mod 8`. This compresses the data requirement from 200 KB to 8 KB while still achieving per-scanline color addressing.

**FLI with static bitmap**: the bitmap data itself does not change per scanline. Only screen RAM rotates. This allows the bitmap to carry shape information while screen RAM carries the color information, making them independently editable in tools.

**Sprite overlay on FLI**: sprites are not affected by $D018 changes. Sprites render normally on top of or behind the FLI bitmap according to $D01B priority bits. This means a FLI background can coexist with sprite-based characters.

### Cycle budget (PAL)

FLI on PAL, per display line:

- VIC bus: 40 cycles (15-54), BA low from 12.
- `LDA # / STA $D018 / LDA # / STA $D011`: 12 cycles, the last write on 15.
- Padding between the end of one line's stall (cycle 55) and the next
  block: 11 cycles.
- Left for anything else: nothing. Sprites active in the FLI region would
  add their own bus cycles and move the stall; music and logic run in the
  112 border lines.

Code size: 16 bytes per line unrolled, 3.2 KB for 200 lines. The old
figure of "25-30 cycles per line" for an IRQ-per-line handler described
something that does not fit in a badline and was never run.

On NTSC, the same timing window exists but the badline onset relative to IRQ fire differs by one to two cycles due to the different cycles-per-line count (65 vs 63). NTSC FLI is possible but requires separate cycle counting from PAL.

### Recipes

- `recipes/kickassembler/fli-image.md` — full FLI display engine with stable raster, page rotation, and bitmap layout. CROSS-REFERENCE Phase 4 deep recipe.

---

## afli_image — AFLI (Advanced FLI)

**Complexity:** scene-tier
**Region:** PAL
**Uses registers:** D011, D018
**Uses kernal:** (none)
**Demands:** cpu_every_line, constant_sprite_set

### Why

FLI updates only the screen RAM pointer per scanline, leaving the bitmap pointer fixed. A single 8000-byte bitmap is shared across all 200 lines. This means every 8 consecutive scanlines of the same character column share exactly the same 8 pixels of bitmap data — the bitmap itself has no per-scanline color granularity. AFLI adds a second dimension of per-scanline variation by also rotating the bitmap pointer on alternating scanlines, effectively giving each scanline a unique bitmap slice as well as a unique color palette.

The result is visibly improved color resolution, particularly in areas with fine vertical detail, at the cost of doubling the bitmap data requirement and significantly increasing IRQ handler complexity.

### How

AFLI requires alternating between two 8000-byte bitmap areas within the same frame. $D018 encodes both the VM (screen RAM) pointer in bits 7-4 and the CB (bitmap pointer) in bit 3. By updating all of bits 7-1 of $D018 per scanline in a FLI-like IRQ loop, the handler can point to a different screen RAM page and a different bitmap base on every scanline.

The memory layout within a 16 KB VIC bank for a full AFLI image therefore requires:
- Two 8 KB bitmap areas (at $0000 and $2000).
- A set of 200 (or modulo-8-indexed) screen RAM pages within the remaining bank space.

The IRQ structure is identical to FLI — stable raster, per-scanline write to $D018 — but the value written alternates the CB bit as well as the VM bits.

Because each bitmap frame has independent pixel data for its set of scanlines, AFLI images require a dedicated preparation and conversion pipeline. Standard Koala Painter files are not directly usable as AFLI source; the image must be pre-processed to split pixel data between the two bitmap planes.

### Why it works

The mechanism is a direct extension of FLI. When $D018 is updated before the c-access window of a badline, the new VM bits redirect the color fetch to a fresh screen RAM page. The new CB bit simultaneously redirects the g-access bitmap base for the eight lines that follow that badline. Because the chip samples $D018 independently for c-accesses (badlines) and g-accesses (every line), the CB change takes effect on the very first g-access of the next non-badline row.

This means the bitmap plane visible on odd-numbered character rows differs from that on even-numbered rows, creating the interleaved two-plane pixel structure that gives AFLI its resolution improvement.

### Variations

**AFLI with four bitmap planes**: technically possible with sufficiently complex IRQ handling and enough VIC bank space, though rarely implemented on stock hardware due to data bandwidth requirements.

**AFLI for portraits**: the technique is particularly effective for human faces and gradients where vertical color resolution is most perceptually significant.

### Cycle budget (PAL)

AFLI IRQ handlers are marginally more expensive than FLI because $D018 carries more information per write. The critical constraint is identical — the write must land before cycle 15 of the badline. A well-written AFLI handler running at PAL timing adds approximately 2-4 cycles per scanline versus a plain FLI handler.

---

## ifli_image — IFLI (Interlaced FLI)

**Complexity:** scene-tier
**Region:** PAL
**Uses registers:** D011, D018
**Uses kernal:** (none)
**Demands:** cpu_every_line, constant_sprite_set

### Why

Even with FLI providing per-scanline color variation, the horizontal pixel resolution of multicolor bitmap remains 160 pixels. IFLI (Interlaced FLI) pushes effective resolution to 320x200 by rendering two different FLI frames on alternating PAL frames and relying on the display's phosphor persistence to blend them. The viewer perceives an image with more horizontal detail than either frame alone provides.

IFLI images are some of the highest-quality C64 artwork in the demoscene. The technique requires two complete, independently prepared FLI images and a precise frame-alternating engine.

### How

IFLI requires two complete FLI images — each with its own 8000-byte bitmap, its own set of screen RAM pages, and a Color RAM state — stored in memory simultaneously. On even PAL frames, image A is displayed; on odd frames, image B. Alternating at 50 Hz with PAL phosphor persistence, the human eye integrates the two images.

The frame alternation is driven by a vertical blank IRQ (or a top-of-frame raster IRQ) that swaps the bank layout or bitmap/screen RAM addresses pointed to by $D018. Within each frame, the per-scanline FLI engine runs exactly as described in `fli_image`.

The two images are typically prepared as slightly horizontally-offset variants of the same source — image B shifted one pixel left or right relative to image A. The overlap creates the perception of 320-wide content. Preparing an IFLI pair from source art is a non-trivial image processing task; dedicated tools (IFLI converters) handle this.

### Why it works

The VIC-II's output is a composite video signal. On a real CRT display, each scanline's phosphors retain charge for a fraction of a frame. When two similar images alternate at 50 Hz, the eye blends them in both spatial and temporal dimensions. The 160-pixel-wide multicolor pixels of each sub-frame appear to blend with the offset pixels of the opposite frame, creating the illusion of 320-pixel hires color content.

This does not work at the pixel buffer level — both frames are full multicolor bitmap images with the same 160x200 pixel grid. The resolution improvement is entirely perceptual, a property of the human visual system and the CRT. IFLI images do not look the same on LCD monitors without post-processing; dedicated IFLI-aware emulator display modes apply a blending filter to simulate the CRT integration.

### Variations

**IFLI on NTSC**: NTSC runs at approximately 60 Hz, meaning alternating frames flicker at 30 Hz rather than PAL's 25 Hz. Thirty Hz flicker is more noticeable to most viewers than 25 Hz. IFLI is technically possible on NTSC but is considered less suitable — the higher refresh rate (counterintuitively) produces more visible flicker because 30 Hz is closer to the human flicker-fusion threshold than 25 Hz.

**IFLI with AFLI basis**: combining IFLI interlacing with AFLI bitmap-pointer rotation adds yet another dimension of color and pixel resolution, at the cost of requiring four complete image planes in memory simultaneously and a highly complex IRQ engine.

**Single-frame IFLI display**: some demo effects display an IFLI pair for a fixed number of frames then freeze on one sub-frame, useful for a zooming-in effect where the image appears to sharpen as it holds.

### Cycle budget (PAL)

IFLI's per-frame cycle budget is the same as FLI — one stable raster IRQ per scanline with a short handler. The additional cost is in the vertical blank handler that swaps between the two FLI engines. The VBI swap typically costs fewer than 50 cycles and can be amortized easily within the overscan.

The real cost of IFLI is not cycles but memory: two complete FLI images occupy roughly 2 x (8000 + 8 x 1000) = 32,000 bytes of VIC-accessible RAM, plus Color RAM, which is a fixed 1 KB at $D800 and shared between both sub-frames.

---

## koala_format — Koala Painter format load and display

**Complexity:** low
**Region:** both
**Uses registers:** D011, D016, D018, D021
**Uses kernal:** (none)

### Why

Koala Painter (1984) was the dominant C64 painting tool throughout the 1980s and into the 1990s. Its file format became the de facto interchange format for C64 multicolor bitmap images. An enormous corpus of C64 artwork survives in .kla format. Any program or demo that needs to display arbitrary C64 artwork must be able to parse and display Koala files.

Beyond historical importance, the Koala format is also the most compact and direct representation of a multicolor bitmap image. Understanding it means understanding the precise relationship between bitmap data, screen RAM, Color RAM, and the background color register.

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

The load address at offset 0 is a standard C64 PRG-format header — two bytes little-endian indicating where the file should be loaded in CPU address space. Koala Painter itself loads the file to $6000, placing bitmap at $6000, screen RAM at $7F40, Color RAM at $8328, and background byte at $8710. These addresses are commonly used by display loaders to avoid the need to parse the header.

**Display procedure**:

1. Copy the 8000-byte bitmap to the desired bitmap location in the VIC bank (typically $2000 or $6000).
2. Copy the 1000-byte screen RAM segment to the VIC bank's video matrix location.
3. Copy the 1000-byte Color RAM segment to $D800.
4. Read the single background color byte and write it to $D021.
5. Update $D018 to point the VIC at the bitmap and video matrix locations.
6. Set $D011 bit 5 (BMM) and $D016 bit 4 (MCM) to enable multicolor bitmap mode.

### Why it works

The Koala format is a direct serialization of the three memory regions that multicolor bitmap mode reads during rendering. The bitmap data feeds g-accesses directly; screen RAM feeds c-accesses on badlines; Color RAM is read separately by the chip at cycle granularity as $D800 + cell_offset. The background byte goes to $D021, which the chip reads for the %00 color on every rendered pixel. Placing these exactly as the format specifies and enabling the two mode bits produces the image immediately.

The VIC bank and $D018 pointer configuration determines where in the 64 KB address space the chip looks. If loading to $6000 (within VIC bank 1, CIA2 $DD00 bits = %10), the bitmap is at bank-offset $2000, placing $D018 CB2 = 1. Screen RAM at $7F40 is at bank-offset $3F40, which rounds to $3C00 (VM = %1111, the highest 1 KB within the 16 KB bank). Double-check: $4000 + $3C00 = $7C00, not $7F40 — in practice, Koala display loaders typically copy the data to a cleaner memory layout rather than using the Koala load address directly.

For Oscar64 programs, the recommended approach is to copy the Koala bitmap to $2000 in bank 0 (VIC offset $2000), screen RAM to $0400 (VIC offset $0400), and Color RAM directly to $D800, then set $D018 = $18 (VM = 1 = $0400, CB = bit 3 = 1 = $2000 bitmap). This keeps the VIC configuration simple and predictable.

### Variations

**Streaming from disk**: load the Koala file in the background using a turbo loader while displaying a placeholder screen, then swap in the bitmap on a VBI boundary. The Koala layout is sequential enough that the copy sequence is also the disk read order.

**Koala animation**: prepare several Koala frames in memory (each 10001 bytes) and flip between them on VBI by updating bitmap and screen RAM pointers in $D018. At 50 Hz this gives 50 fps; practical rates are 6-10 fps depending on copy speed from disk and RAM.

**Koala + sprite overlay**: because sprites are independent of bitmap mode, a Koala image can serve as a full-screen background with sprite-based animated foreground elements. Set $D01B appropriately for depth ordering.

**Paletted color shift**: write a different value to $D021 each frame without touching the bitmap or screen RAM. This shifts the background tone of the entire image, producing a cheap palette animation that works on any Koala image. Similarly, writing to screen RAM nibbles mid-frame or between frames alters the per-cell %01/%10 colors.

### Cycle budget

Koala display is not cycle-sensitive once the mode is enabled. The copy operations (bitmap 8000 bytes, screen RAM 1000 bytes, Color RAM 1000 bytes) take approximately 10000-12000 CPU cycles total using a basic copy loop — well within the VBI window on PAL (approximately 3900 cycles in the overscan region) if split across two VBIs, or manageable using a faster copy routine.

For real-time conversion from disk, the raw data rate of the 1541 (approximately 300 bytes/second with standard KERNAL I/O, or 4000-6000 bytes/second with a turbo loader) dominates the timing. Full Koala loads via standard KERNAL take approximately 33 seconds; turbo-loaded Koala files load in under 3 seconds.

### Recipes

- `recipes/oscar64/koala-display.md` — load a .kla file, copy to display RAM, enable multicolor bitmap mode.

<!-- doc-type: technique-reference -->
