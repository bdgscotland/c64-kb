---
category: effect
chip: VIC-II
---

<!-- doc-type: technique-reference -->

# Vector and 3D Effects

The C64's hardware was never designed to draw three-dimensional graphics. There is no depth buffer, no triangle rasterizer, no framebuffer in the conventional sense. What the machine does have is a 1 MHz CPU with fast zero-page addressing, a sprite system whose pixel coordinates can be reprogrammed between scanlines, a character mode whose cell contents can be swapped every frame, a bitmap mode whose pixels can be filled row by row from lookup tables, and a community of demoscene coders who spent forty years pushing every one of those mechanisms further than Commodore ever imagined.

Every effect in this document is built from the same raw materials: lookup tables (sine, cosine, distance, angle), per-frame register writes, and careful cycle accounting. The VIC-II's display is the output device; the CPU is the renderer. That arrangement imposes hard limits on polygon count, resolution, and frame rate, but those limits have shaped a distinct aesthetic — the flat-shaded rotating cube, the sine-wave plasma wash, the tunnel drawing the viewer forward — that is recognizable as C64 3D even before any music starts.

The techniques below range from medium-complexity plasma writes (achievable in a weekend) to scene-tier voxel landscapes that require precomputed data tables, double-buffering, and careful frame-rate management. All are achievable on stock PAL or NTSC hardware. None require expansion hardware.

---

## dot_3d_rotator — Dotted 3D point cloud rotation

**Complexity:** scene-tier
**Region:** both
**Uses registers:** D015, D000, D001, D002, D003, D004, D005, D006, D007, D008, D009, D00A, D00B, D00C, D00D, D00E, D00F, D010, D027, D028, D029, D02A, D02B, D02C, D02D, D02E, D018

### Why

A 3D point cloud rotator is the classic entry-level demoscene 3D effect: a set of points, described in three-dimensional coordinates, rotated by a time-varying angle and projected flat onto the screen. Every point traces a continuous elliptical path as the object rotates. The visual result — a spinning wire-frame-like mass of dots — communicates solid 3D form through motion, even though no edges or faces are drawn. The effect's appeal is partly mathematical (the first time you see a paraboloid or sphere constructed from only dots, rotating smoothly) and partly the achievement of having a microprocessor do real-time 3D geometry.

### How

The rotation is computed via a 3x3 rotation matrix applied to each point in the cloud. For a rotation about two axes (a common choice: Y then X), the matrix multiplication reduces to six multiplications and six additions per point. On a C64, multiplications are performed via lookup tables: a 512-entry sine table indexed by angle gives both `sin(θ)` and `cos(θ)` (offset by 128 entries), allowing a multiply-by-sine to be implemented as a table lookup plus a scaling shift.

The per-frame sequence is:

1. Advance the rotation angles (two 8-bit counters, one per axis, incremented by a speed constant each frame).
2. Recompute the six rotation coefficients from the sine/cosine table: `cos(ax)`, `sin(ax)`, `cos(ay)`, `sin(ay)`, and the four products needed for the combined matrix.
3. For each point in the cloud, apply the rotation: compute transformed X, Y, Z from the original coordinates and the coefficients.
4. Apply perspective projection: `screen_x = cx + (tx * FOCAL) / (tz + DEPTH_OFFSET)`, `screen_y = cy + (ty * FOCAL) / (tz + DEPTH_OFFSET)`. Division is a second lookup table: a reciprocal table indexed by Z (built as in `table_generation`, `cpu-cycle-tricks.md`).
5. Output the projected point to the display.

Two display strategies exist:

**Sprite-based plot.** Each hardware sprite is treated as a single large pixel. With 8 sprites enabled and multiplexed across the frame, up to approximately 24–32 points can be displayed simultaneously before flicker sets in (the VIC-II's 8-sprite-per-line limit means points at the same Y coordinate compete for sprite slots). Individual point size is one sprite with all-pixels-on data (a solid 24×21 block, typically clipped to 8×8 via masking). Color can be varied per point by writing the sprite color registers.

**Charset-based plot.** Points are rendered by writing custom 8×8 character cells (a small dot pattern: a single lit pixel at a specific bit position) into character RAM and then filling the corresponding screen RAM positions. A fixed charset of 64 single-dot glyphs (plus one blank) gives every pixel position inside a cell — an 8×8 cell has only 64 pixel positions, so an earlier version of this paragraph claiming "256 distinct per-cell dot positions" from a 256-entry charset was wrong; the remaining codes can hold a selection of two-dot combinations. Points are therefore pixel-positioned, not cell-aligned; the cost is that two points falling in the same cell collide unless a glyph for that pair exists. The alternative is to allocate a fresh character to each occupied cell per frame and OR the point's bit into it, which never collides but is limited to 255 occupied cells per frame and requires clearing the used glyphs each frame (hence the double-buffered charset below). This allows far more than 8 points per scanline. Multicolor character mode halves horizontal resolution but allows colored dots against a background.

### Why it works

The mathematics of 3D rotation is linear: a rotation matrix transforms any 3D point into a new 3D point by mixing the original coordinates via sine and cosine coefficients. The result is exact (given integer precision) and requires no iterative or recursive computation — it is six multiplies and six adds per point, which on a 6510 translates to six table lookups and six ADC/SBC chains.

Perspective projection divides by Z to simulate depth recession: distant points appear closer together, near points spread apart. The reciprocal table makes this a lookup rather than a software divide. The effective resolution of the depth effect depends on the table's index range and the FOCAL constant; typical C64 implementations use a FOCAL of 128–256 and a DEPTH_OFFSET of 4–8 to prevent division by zero (or near-zero) at the front face.

The VIC-II cooperates by allowing sprite X and Y registers to be reprogrammed between frames. All 8 sprite positions, colors, and enable bits can be written in the vertical blank, then the chip draws all of them on the next frame without further CPU involvement during the display period.

### Variations

**Depth-cueing.** Map the post-projection Z value to a sprite or character color. Near points appear bright (white or yellow), far points dim (dark gray). The VIC-II's 16 colors support approximately 5–6 distinguishable brightness steps, which is enough to give the cloud convincing three-dimensionality.

**Object morphing.** Define two point clouds (e.g., a sphere and a cube). Each frame, interpolate between the two sets of unrotated coordinates using a morph parameter. The rotated display shows the object smoothly deforming between shapes.

**Double buffering with charset approach.** With two charset banks (two character RAM areas), one is being displayed while the other is cleared and redrawn. Swap via $D018 in the vertical blank. Eliminates the visible erasure flicker that occurs when dots are cleared in the same frame they are redrawn.

### Cycle budget

Per-point cost (approximate, varies by implementation):

- Sine/cosine lookups and matrix multiply: approximately 60–90 cycles per point using 8-bit fixed-point arithmetic (6 multiply-via-table lookups, each roughly 10–15 cycles including index computation and 8-bit shift for scaling). The table multiply itself, with its measured cost, is `table_multiply_8x8` in `techniques/maths.md`.
- Perspective divide (reciprocal table lookup): approximately 15–20 cycles.
- Sprite register writes (X, Y, pointer, color): approximately 20 cycles per sprite, all 8 sprites written in the vertical blank = ~160 cycles total for sprite output.
- Charset-based output (write one char cell + screen RAM byte): approximately 8–12 cycles per point.

For a 32-point cloud at ~75 cycles per point: approximately 2400 cycles per frame computation, well within the ~19,500 available on PAL. Frame rate is typically 25fps (every other PAL frame) for 32 points, or every frame for 16-point clouds.

### Recipes

- No recipe yet. (An earlier version of this page pointed at `recipes/kickassembler/cracktro-template.md`; that recipe has no sprite layer and no dot rotator — its only rotation is of the bar palette.)

---

## solid_vector_3d — Solid-shaded polygon rendering

**Complexity:** scene-tier
**Region:** both
**Uses registers:** D011, D018, D016, DD00

### Why

Filled polygon rendering transforms the 3D wireframe aesthetic into something that more closely resembles a solid object. Instead of dots tracing the surface geometry, filled faces show which polygons are visible (front-facing) and shade them with a flat color derived from the polygon's orientation relative to a light source. The result — a rotating cube or pyramid whose faces shade and swap visibility as it turns — is the canonical "solid vector" demoscene effect. It appears in virtually every major C64 demo from the late 1980s onward.

The technique is more demanding than the dot rotator because filled polygons require two additional operations beyond point projection: face visibility determination (do not draw back-facing polygons) and scanline fill (for each visible face, fill every horizontal span between the face's left and right edges on each display row).

### How

**Face culling.** For each polygon face (triangle or quad), compute the face normal vector after rotation. If the Z component of the normal points away from the viewer (in the standard camera-at-origin setup, this means the normal Z is positive, assuming a left-handed coordinate system), the face is back-facing and not drawn. This eliminates roughly half the polygons in a convex solid without any rendering work.

**Z-sorting.** For transparent or non-convex objects, sort the remaining visible faces by their average Z depth (painter's algorithm: draw farthest first). This avoids visible-surface errors without a depth buffer. For a simple convex solid, Z-sorting is not necessary because correct back-face culling already prevents overlap errors.

**Scanline fill.** For each visible face, scan the face's edges to build a left-edge and right-edge table: for each row Y spanned by the face, record the leftmost X (left edge) and rightmost X (right edge). Then fill each row by writing pixels from left X to right X in bitmap RAM. The fill loop is the performance-critical inner loop.

The VIC-II bitmap mode is used for output. Standard bitmap mode ($D011 bit 5 set, $D011 bit 6 clear, $D016 bit 4 clear) provides 320×200 pixels at 1 bit per pixel, with one foreground and one background color per 8×8 character cell. Multicolor bitmap mode ($D016 bit 4 set) provides 160×200 pixels at 2 bits per pixel with four colors per cell, commonly used for colored polygon faces. The screen is cleared (or back-buffer swapped) before each new frame.

### Why it works

The fill loop has to respect the VIC-II's bitmap memory layout, which is cell-major, not a linear framebuffer: cell (col,row) occupies 8 consecutive bytes at (row*40+col)*8, one byte per scanline of the cell, so horizontally adjacent bytes on one scanline are 8 bytes apart (see `bitmap-modes.md`; an earlier version of this paragraph described the bitmap as row-major, left to right, top to bottom, which would make a `STA base,X` walk fill a vertical 8-line strip instead of a row). Filling a horizontal span of N pixels from column Xl to column Xr on scanline Y requires computing the byte addresses for Xl and Xr, masking the partial bytes at each end, and filling the interior bytes with $FF (all pixels on for the face color). A span fill therefore either steps X by 8 along a scanline, or (the fast form) fills a cell column with eight consecutive `STA base+0..7` stores, and the interior needs only one STA per 8 (hires) or 4 (multicolour) pixels with $FF or the fill pattern pre-loaded in A.

Color RAM for multicolor mode is updated once per visible face (one byte per 8×8 cell the face overlaps), not once per pixel. For a quad-polygon face covering 32×32 pixels, color RAM updates hit 16 cells — 16 stores — against a pixel fill covering potentially 128 bytes. The fill dominates the cycle budget.

Frame rate is the key constraint. A typical C64 solid vector demo running on PAL operates at 12.5fps (rendering a new frame every 4 VIC-II frames). At this rate, the CPU has approximately 4 × 19,600 = 78,400 cycles per rendered frame. A cube shows at most three faces after back-face culling. With each visible face averaging 50 scanlines of 80–160-pixel fill (10–20 bytes per row), at 5 cycles per interior byte for an unrolled `STA abs,X` fill (7 if each byte is `LDA #$FF : STA abs,X`) plus ~30 cycles per row for edge masking and pointer advance: roughly 4,000–8,500 cycles per face, 12,000–25,000 cycles per frame for fill, leaving ample room in the 78,400 available at 12.5fps. (An earlier version of this paragraph costed six faces at ~8 cycles per byte and disagreed with the Cycle budget below by a factor of two; the per-byte figures now follow the 6510 reference.) Increasing to 12 faces (icosahedron) or larger polygons begins to strain the budget.

### Variations

**Flat shading with Lambert lighting.** Compute the dot product of each face's (rotated) normal with a fixed light-direction vector. Map the result to a VIC-II color index. The face is filled in that color. On the C64, this is typically done with a 16-entry lookup table (angle range → color index), approximating continuous shading with the available palette.

**Double buffering.** Maintain two bitmap areas in VIC bank memory. While one is displayed, the other is cleared and redrawn. Swap $D018 in the vertical blank. Eliminates partial-frame updates visible as tearing. A full-height (25-row) double buffer does not fit one 16 KB bank, as an earlier version of this paragraph implied: the bitmap can only sit at offset $0000 or $2000, so two 8,000-byte bitmaps leave two 192-byte gaps and no 1 KB-aligned slot for the 1,000-byte video matrix (see `bitmap-modes.md`, Koala animation). The usual layout is therefore two VIC banks, each holding one bitmap at offset $2000 plus its own matrix (and its own copy of sprite pointers and sprite data), with the swap a $DD00 bank write alongside $D018. A single-bank alternative is to draw only 22 character rows (7,040 bytes) so the matrix fits at offset $1C00 or $3C00 in the same bank and hide the bottom three rows with a raster split or the border; this only works in banks 1 or 3, because in banks 0 and 2 the VIC reads character ROM at $1000-$1FFF, where the offset-$0000 bitmap would lie. Neither scheme double-buffers Colour RAM at $D800, which is a single 1 KB, so in multicolor mode per-cell colour changes are written once per swap.

**Outline vectors (wireframe).** Skip the fill loop entirely; draw only the polygon edges as lines. Each edge is Bresenham line-drawn into the bitmap. Wireframe rendering is 10–20× faster than filled, enabling higher polygon counts or higher frame rates.

### Cycle budget

Critical inner loop (fill loop, multicolor bitmap, 160-pixel-wide row):

- A fully covered 160-pixel hires row is 20 bytes (a full 160-pixel multicolour row is 40 bytes, 4 double-wide pixels per byte).
- Interior fill with A pre-loaded: `STA abs,X` is 5 cycles per byte = 100 cycles per 20 bytes (7 cycles per byte if the `LDA #imm` is repeated: `LDA #imm` 2 + `STA abs,X` 5; `STA abs,X` never takes a page-cross penalty). So 100–140 cycles per fully-covered row; an earlier version of this line said 6 cycles × 20 bytes = 120.
- Left/right partial-byte masking: approximately 20–30 cycles per row.
- Row pointer advancement: approximately 8 cycles per row.
- Total per-row: approximately 130–180 cycles on a non-badline.
- On a badline (every 8th row): add 40 cycles = 170–220 cycles per row.
- A 50-row, 20-byte face: approximately 7,000–9,000 cycles (approximate; depends on face width and badline distribution).

Per-frame total (cube, 3 visible faces): approximately 12,000–25,000 cycles for fill alone, depending on face width. Comfortable within the ~78,400 available at 12.5fps; at 25fps (~39,200 cycles) it fits but leaves little for edge tables and matrix math. (An earlier version of this paragraph costed a 6-face cube at 45,000–50,000 cycles; a convex cube shows at most three faces after culling.) Most scene-tier demos choose 12.5fps or 25fps based on polygon complexity.

### Recipes

- No recipe yet. (An earlier version of this page pointed at `recipes/kickassembler/cracktro-template.md`; it contains no filled-box or vector sequence.)

---

## bobs_effect — BOB (Blitter OBject) parallel-sprite-like effect

**Complexity:** scene-tier
**Region:** both
**Uses registers:** D011, D018

### Why

The C64's hardware sprites are limited to 8 objects per frame, each 24 pixels wide. Many demoscene effects — particularly those popularized on the Amiga and later ported to or inspired on the C64 — require dozens of independently-positioned, independently-animated graphic objects on screen simultaneously. BOBs (Blitter OBjects, a term borrowed from the Amiga's blitter hardware but applied to any system using software-composited screen RAM objects) are the C64 solution: pre-render each "sprite-like" object into a block of screen RAM or character data, then position and display it as a character cell (or group of cells) rather than a hardware sprite.

This removes the 8-sprite hardware limit. The screen can hold as many BOBs as there are character cells to place them in, subject only to the CPU's ability to update those cells each frame.

### How

BOBs are implemented in bitmap mode or character mode. The two approaches differ in their flexibility and speed:

**Character-mode BOBs.** Each BOB occupies one or more 8×8 character cells. Each frame, the CPU writes the appropriate character indices into the screen RAM cells at the BOB's position, then writes the visual data for those characters into character RAM (a region of VIC bank memory not currently used for display). If the character RAM is pre-populated with all required animation frames, the per-frame update is only the screen RAM writes — one byte per cell — extremely fast. For a 16×16 pixel BOB (4 cells), this is 4 screen RAM writes = approximately 20 cycles per BOB. One hundred BOBs can be updated in under 2,000 cycles.

**Bitmap-mode BOBs.** The BOB's pixel data is blitted (copied with masking) directly into the bitmap RAM. A 16×16 BOB requires reading a 16-byte mask buffer, ORing with the existing bitmap data at the destination, and writing back — a masked blit. This allows pixel-accurate positioning (not cell-aligned) at the cost of much higher CPU cycles per BOB: a 16×16 masked blit is approximately 200–300 cycles per BOB. The advantage is full-resolution placement.

In both cases, erasing each BOB between frames is the bottleneck. Character-mode BOBs require restoring the background character indices at the old positions before drawing at the new positions. Bitmap-mode BOBs require re-clearing the blitted area. A common technique is to maintain a list of "dirty cells" or "dirty regions" from the previous frame and clear only those, rather than clearing the entire screen.

### Why it works

The VIC-II displays the screen using screen RAM (character indices) and character RAM (pixel data for those indices) or bitmap RAM. Because both are writable by the CPU at any time, the CPU can modify the displayed image dynamically. The VIC-II reads screen RAM (the character codes, together with Colour RAM) during the badline c-accesses, once per character row, and reads the pixel data (character generator bytes, or bitmap bytes in bitmap mode) in the g-accesses on every visible line. A screen-RAM write therefore shows only from the next badline for that row — in practice the next frame if that row's badline has already passed; a character-RAM or bitmap write shows at the next g-access of that pixel row, which is the next raster line if that row of the cell has not yet been drawn this frame, otherwise the next frame. (An earlier version of this sentence had the two fetches swapped, saying badlines read character RAM.) For BOBs, the simplest approach is to update all BOBs during the vertical blank (the interval between frames where the VIC is not actively rendering), guaranteeing all updates take effect on the next frame.

The critical limitation: **BOBs leave background residue.** When a BOB moves from position A to position B, the pixel data from the BOB remains in screen RAM at position A until explicitly erased. The programmer must track old positions and clear them each frame. Failure to do so produces the characteristic "smearing" artifact. Maintaining a double-buffered list of dirty regions and processing it systematically each frame is the standard solution.

### Variations

**Pre-multiplied character set.** For a single BOB image that appears many times (e.g., a starfield of identical dots), pre-populate a single character definition and write that character index to all screen RAM positions. Zero erase cost (the entire character set stays static) and minimal update cost.

**Animated BOBs via character cycling.** Change the character RAM content (rather than the screen RAM indices) each frame. All cells pointing to that character index change simultaneously. Efficient for animated foreground elements where every instance animates in lock-step — explosion particles, flame effects.

**Sprite + BOB composite.** Use hardware sprites for the player and a few enemies (requiring precise positioning), and BOBs for background debris, particles, or decorations. The character-mode BOBs free up the sprite layer for the objects that actually need sub-cell precision.

### Cycle budget

Character-mode BOBs (cell-aligned, pre-loaded character data):

- Screen RAM write per cell: 4 cycles (STA abs).
- A 16×16 BOB (4 cells): 16 cycles to draw, 16 cycles to erase at previous position = 32 cycles per BOB per frame.
- 50 BOBs: approximately 1,600 cycles per frame (approximately 8% of PAL frame budget).

Bitmap-mode BOBs (pixel-exact masked blit):

- 16×16 BOB, bitmasked: approximately 200–350 cycles per BOB (approximate; depends heavily on horizontal alignment and whether inner loop is unrolled).
- 20 BOBs: approximately 4,000–7,000 cycles per frame.
- Plus erase cost (similar): double the per-BOB figure.

The character-mode approach dominates for bulk object counts. The bitmap approach is used when pixel-exact positioning is essential (e.g., smooth-scrolling playfield with non-cell-aligned objects).

### Recipes

- No recipe yet. (An earlier version of this page pointed at `recipes/kickassembler/cracktro-template.md`; its logo is a static screen image copied to $0400, not character-mode BOBs.)

---

## plasma — Plasma effect via sine table additions

**Complexity:** medium
**Region:** both
**Uses registers:** D011, D018, D021, D022, D023, D024

### Why

The plasma effect fills the entire screen with a smoothly animated color pattern: rippling color waves that shift and interfere with each other, creating an organic, hypnotic motion with no sharp edges or hard boundaries. It is a staple of late 1980s and 1990s C64 demos and remains visually distinctive. Despite its complexity of appearance, the plasma algorithm is simple: the color at each screen cell is determined by the sum of two or more sine functions, one of which depends on X position, one on Y position, and one on time. The interaction of these functions produces the characteristic moiré-wave patterns.

### How

The screen is divided into a grid of color cells. In character mode (the most common approach), each cell corresponds to one screen RAM position and one color RAM position — a grid of 40×25 = 1,000 cells. In each rendered cell, the color is computed as:

`color = sin_table[(x * XSCALE + t) & 255] + sin_table[(y * YSCALE + t * 2) & 255]`

where `t` advances by a small constant each frame, `XSCALE` and `YSCALE` control the spatial frequency of each wave, and `sin_table` is a 256-entry table of values 0–15 (mapped to VIC-II colors). The sum of two such values (range 0–30) is used as an index into a 32-entry (or 16-entry wrapped) color palette table.

For richer plasma patterns, three or four sine terms are summed:

`color = sin(x + t) + sin(y + t * 3/2) + sin(x * 2 + y + t / 2)`

Each additional term requires an additional table lookup and addition, increasing the per-cell cycle cost linearly.

The result is written to color RAM (at $D800 in the standard VIC bank layout). Screen RAM is filled with an all-set glyph — $A0 (reverse space) from the ROM font, or a custom character of eight $FF bytes — so that the colour-RAM colour fills the whole cell. An earlier version of this paragraph said to fill the screen with spaces ($20) "so that the background color shows through"; that is backwards. In standard text mode Colour RAM sets the foreground (set-bit) pixels of a cell and the background (clear-bit) pixels are always $D021, so a plasma written to Colour RAM over space characters displays nothing but $D021. Writing to color RAM rather than screen RAM is still what makes the effect cheap: one 4-bit store per cell selects the visible colour without touching the character data.

Alternatively, for a full-color plasma that uses foreground pixels rather than background color, fill screen RAM with custom charset entries (varying dot patterns) and write both screen RAM and color RAM. This doubles the write count per cell but allows richer color patterns.

### Why it works

The VIC-II color RAM ($D800–$DBE7) stores a 4-bit color value for each of the 40×25 = 1,000 screen cells. In standard character mode, this color is applied to all foreground (set-bit) pixels in the character cell. The background color ($D021) is applied to all background (clear-bit) pixels. By using a character whose bit pattern is all ones (reverse space $A0, or a custom all-$FF glyph), every pixel of the cell takes the colour-RAM colour and the plasma is a pure Colour RAM write. (An earlier version of this section said an all-zero character shows the colour-RAM colour, then contradicted itself in the next sentence; the rule above is the one in `vic-ii-reference.md`.)

The trick for a screen-RAM-driven plasma is extended background color (ECM) mode, which provides four independently-settable background colors ($D021–$D024). Each character's high two bits (bits 7 and 6) select which of the four backgrounds to use for that cell, leaving only 6 bits of character index (64 glyphs). Colour RAM still sets the set-bit pixels in ECM, so each of the four 64-glyph banks should use a blank (all-zero) glyph — then the cell shows only the selected background register. This gives a 2-bit-per-cell color selection driven by screen RAM content, with four palette entries (the four background registers). The plasma write loop updates $D021–$D024 per line (via raster IRQ, cycling through sets of four colors) or per frame, and updates screen RAM bits 7-6 per cell. This approach is common in 4-color plasmas.

For full 16-color plasma, color RAM must be written every frame for every cell. At 1,000 color RAM writes per frame × 4 cycles each = 4,000 cycles minimum (stores only), the color RAM update loop is the dominant cost.

### Variations

**4-color ECM plasma.** Use ECM mode ($D011 bit 6 set). Four background color registers and screen RAM high-bits select color. 1,000 screen RAM writes + 4 background register writes per frame. Much faster than full color RAM updates. Limited to 4 simultaneous colors but visually convincing.

**Animated palette via raster IRQ.** Rather than updating color RAM every frame, hold color RAM static and cycle the four background registers ($D021–$D024) via a per-line raster IRQ chain. This effectively applies a different color mapping to each screen row, creating vertical color variation without per-cell CPU work. The visual result differs from a true plasma (the pattern is horizontally uniform within each row) but is extremely cycle-efficient.

**Hi-res character plasma.** Fill screen RAM with custom 8×8 dot characters whose bit patterns vary by position, and write color RAM with computed colors. The character data provides local spatial variation (pixel-level patterns within each cell), while color RAM provides per-cell color. Combined, the result has both pixel-scale and cell-scale structure — a richer visual but double the per-frame write cost.

### Cycle budget

Full 16-color plasma (40×25 color RAM update), per frame on PAL:

- Per-cell: two sine lookups (approximately 10 cycles each), one addition, one palette-table lookup, one color RAM write (4 cycles) = approximately 30–40 cycles per cell.
- 1,000 cells × 35 cycles = approximately 35,000 cycles per frame.
- PAL frame budget: ~19,600 cycles (63 × 312 = 19,656). Result: full plasma requires approximately 1.8 PAL frames of CPU time — so it renders every other frame, which at 50 frames/s is 25fps, not the "12–13fps" an earlier version of this line said. Anything over ~39,300 cycles drops to every third frame, 16.7fps.

4-color ECM plasma (1,000 screen RAM writes, no color RAM updates):

- Per-cell: one or two sine lookups, one masking/OR operation, one screen RAM write = approximately 20–25 cycles per cell.
- 1,000 cells × 22 cycles = approximately 22,000 cycles per frame.
- Achievable at 25fps (every other PAL frame, with ~10,000 cycles to spare for other work).

---

## dot_flag_sine_plotter — A grid of dots on two sines, plotted and erased every frame through the hires plot

**Complexity:** medium
**Region:** both
**Uses registers:** D011, D016, D018
**Uses kernal:** (none)
**Requires:** hires_plot, standard_bitmap
**Cost:** cycles_per_frame=16098
**Cost basis:** measured-vice
**Cost measured on:** kickassembler-dot-flag (the worst of 299 display-on PAL frames; 15,233 with the display blanked)
**Cost includes:** hires_plot

### Why

The dot flag is the smallest effect that makes a bitmap plot earn its
keep: a grid of single pixels, each column swung left and right by one
sine and each dot lifted and dropped by another, so the grid ripples
like a flag in a wind. It has no lines, no fill and no colour, which
means every cycle of the frame is either the plot primitive or the work
of undoing it, and a routine that can carry 128 of these at the frame
rate can carry the points of a vector object. It is also where the two
costs an animated bitmap always has, putting pixels down and taking the
old ones up, are seen side by side and can be measured apart.

### How

Four tables, all built by the assembler:

- `sinx`, 256 signed bytes of `round(100 * sin)`, and `siny`, 256
  signed bytes of `round(60 * sin)`. Both amplitudes are below 128, so
  no entry reaches the edge of a signed byte and nothing wraps
  (`sine_table_peak_wraps_to_zero` in `pitfalls/maths.md` is the
  unsigned amplitude-128 table whose peak comes out as 0). The recipe
  stores `siny` twice over so that a fixed offset added to the table's
  base can be indexed by a whole byte without running off the end.
- The row address table and the mask table of `hires_plot`, each in its
  own page, and an inverted copy of the mask table for the erase.
- A 40-entry table of `column * 8`, the byte offset of a column's cell
  within a bitmap row, in two bytes because it reaches 312.

Dot (i, j) of the 16 by 8 grid is at `x = 160 + sinx[(t + 12 * i) & 255]`
and `y = 100 + siny[(2 * t + 24 * j + 6 * i) & 255]`; t advances by 2 a
frame. The 12 spreads the columns over most of a period so the whole
flag bends; the 24 does the same for the rows; the `6 * i` term in y is
what makes the ripple run diagonally across the grid rather than up and
down in step; the `2 * t` makes the vertical wave run twice as fast as
the horizontal one. The amplitudes keep x in 60 to 260 and y in 40 to
160 (arithmetic: 160 ± 100 and 100 ± 60), so there is no clipping code.

Each frame, in this order:

1. Wait for the last display line. The erase runs in the blank.
2. Erase: walk the saved list of 128 bitmap addresses and inverted
   masks, and `AND` each byte with its inverted mask. This is the
   erase-list variation of `hires_plot`.
3. Plot: for each column, look up x, sign extend it to 16 bits, take
   the mask pair from `x & 7` and the column offset from `x >> 3`; then
   for each of the column's eight dots look up y, add the row address
   for y to the column offset, `ORA` the mask into that byte, and store
   the address and the inverted mask in the list. x depends only on the
   column, so it is computed sixteen times a frame and y one hundred
   and twenty-eight.
4. Advance t.

Erasing before plotting matters: a dot that lands this frame where
another dot sat last frame is not then wiped by that dot's erase, and
two dots that share a pixel are erased cleanly next frame because both
list entries clear the same bit.

### Why it works

A hires bitmap holds pixel (x, y) at `row[y] + (x >> 3) * 8`, bit
`7 - (x & 7)`, because the VIC-II fetches it cell by cell, eight
consecutive bytes per cell and 320 per cell row (the `hires_plot`
entry in `bitmap-modes.md` has the fetch order). Reading the byte,
`ORA` with the mask and writing it back sets the pixel without touching
its seven neighbours, and `AND` with the inverted mask clears it the
same way, so a dot can be removed without knowing what else is in the
byte. That is what makes the erase list possible: the list is a record
of exactly which bits were set, and replaying it with `AND` puts the
bitmap back as it was, however the dots overlapped. Screen RAM supplies
one ink and one paper colour per cell and is written once; `$D011` bit
5 turns bitmap mode on, `$D018` bit 3 puts the bitmap at `$2000` in the
bank and `$D016` bit 4 clear keeps it hires.

The sines are phases into a 256-entry table, so a phase is a byte, an
add wraps it, and the whole of the motion is table lookups and 8-bit
adds. The one 16-bit quantity is x, which reaches 260; it costs a sign
extension and a three-bit shift across two bytes, once per column.

### Variations

**A third sine for a twist.** Add a term in `i * j` or in `t` alone to
the y phase, or add a small `siny` term to x, and the flag folds over
itself rather than rippling. One more lookup and add per dot; the
amplitudes still have to sum to a range inside the screen.

**Sprites for the dots.** Eight hardware sprites, one per row of the
flag, each carrying a row of dots in its 24-pixel width, move by
register writes alone and need no erase; the columns then bend only as
far as the sprite's width allows and the rows are limited to eight
without a multiplexer, so the flag is small and stiff. Cheap enough for
a game's title screen.

**A rotozoom-style grid.** Keep the plot and the erase list and replace
the two sines with a rotation: x and y of dot (i, j) become
`cx + i * cos - j * sin` and `cy + i * sin + j * cos` with the angle
advancing each frame, which is the `dot_3d_rotator` with z held at
zero. The per-dot cost is the same as here plus two adds, because the
products are a per-frame table.

### Cycle budget

Measured in VICE x64sc 3.10 with CIA1 timer A in the `dot-flag`
recipe, overhead of an empty measurement removed:

- Erase plus plot of 128 dots, display blanked: 15,233 cycles, the same
  on PAL and NTSC. Per dot, 15,233 / 128 = 119.0 cycles (arithmetic).
- The same build without the erase pass, display blanked: 10,866, so the
  erase is 4,367 cycles, 34.1 per dot, and the plot with its per-column
  x work and loop overhead 84.9 per dot (arithmetic from the two
  measured frames).
- With the display on, the frame costs 16,005 to 16,098 cycles on PAL
  over 299 frames and 16,261 to 16,356 on NTSC: the plot pass runs while
  the VIC is fetching and its badline stalls are counted by the timer.
  Both fit a frame (19,656 on PAL, 17,095 on NTSC, arithmetic) so the
  effect runs at the frame rate on both models, with about 700 cycles
  to spare on NTSC.

How many dots fit a frame at this per-dot cost, from the blanked figure
and with nothing else in the frame (arithmetic, not built): 19,656 / 119
is 165 on PAL and 17,095 / 119 is 143 on NTSC, and the display-on
figures say to take about 1,000 cycles off each for badline stalls,
which is roughly 156 and 135. Beyond that the effect renders every other
frame.

The frame does not fit the blank. The erase, about 69 lines, does; the
plot, about 172 lines, runs on into the display window, and a dot whose
row the beam has already passed is missing from that field and present
from the next. That is the mechanism of `full_field_redraw_exceeds_vblank`
in `pitfalls/text-mode-render.md`, and the recipe's mid-motion picture
shows it as 91 lit pixels of 128. The cure the pitfall names, a second
buffer swapped by `$D018` in the blank, costs a second 8,000-byte bitmap
and a second erase list; the recipe does not build it.

### Recipes

- `recipes/kickassembler/dot-flag.md`: the tables, the erase list, the
  two sines, every frame CIA-timed with the display blanked and on, the
  128 pixels counted back out of the pinned picture, and the build
  without the erase pass as the control (3,570 lit pixels after 300
  frames).

### Sources

- `techniques/bitmap-modes.md`, `hires_plot`: the row table, the mask
  table, the 63-cycle plot and the erase-list variation this technique
  is built from.
- `pitfalls/maths.md`, `sine_table_peak_wraps_to_zero`: why the
  amplitudes are 100 and 60 and the tables signed.
- `pitfalls/text-mode-render.md`, `full_field_redraw_exceeds_vblank`:
  the 107-line, roughly 6,700-cycle blank the plot pass overruns.

---

## fire_effect — Colour-RAM heat map with decay and a luminance-ordered palette

**Complexity:** medium
**Region:** both
**Uses registers:** D011, D020, D021, DC04, DC05, DC0D, DC0E
**Requires:** lfsr_random
**Cost:** cycles_per_frame=27301, bytes_code=2548, bytes_data=1065
**Cost basis:** measured-vice
**Cost measured on:** kickassembler-fire-effect (the larger of the two half-screen updates, seed row and rows 23 to 12, PAL, screen on; the whole screen is 53,479 and the other half 26,115; bytes_data is the 1,000-byte heat map plus the 64-byte palette and the LFSR state)

### Why

A flame is the cheapest full-screen effect that reads as alive. Every cell is a number, the number cools and spreads as it rises, and the colour is looked up from the number: no character data, no bitmap, no sprites. Done in colour RAM over a screen of one solid glyph it is a thousand 4-bit stores per update plus the arithmetic, and it fills the whole display with motion from a forty-byte source row.

### How

1. Fill screen RAM with screen code 160, the reverse space, and set `$D021` and `$D020` to black. Every pixel of every cell is now a set pixel, so the cell shows its colour-RAM nibble and nothing else.
2. Keep a heat map of 40 by 25 bytes in RAM, values 0 to 63.
3. Seed row 24 each update: one 8-bit LFSR step per column (`lfsr_random`, Galois form, taps `$B8`, a constant non-zero seed), and bit 0 of the state sets the cell to 63 or 0.
4. For rows 23 down to 0, for every column `c`: `heat[r][c] = (heat[r+1][c-1] + heat[r+1][c] + heat[r+1][c+1] + heat[r+2][c]) / 4 - decay`, floored at 0, with decay 1. Column 0 uses itself in place of `c-1`, column 39 uses itself in place of `c+1`, and row 23 reads row 24 twice because there is no row 25. Going downwards through the rows means each row reads rows that were already updated this pass, which is what lifts the heat.
5. Four values of at most 63 sum to at most 252, so the sum fits one byte: `lda`, three `adc`, two `lsr`, then `beq` past a `sec` / `sbc #decay` when the quotient is already zero. No 16-bit temporary; that is why the heat range is 0 to 63.
6. Write `palette[heat]` into colour RAM for every cell, row by row, with the column in X: `sta $D800 + r * 40, x`. The index never passes 39, so it never reaches 1,024 and CIA1.
7. The palette is 64 bytes mapping heat to a VIC colour in rising luminance order. The recipe uses seven colours, black, brown, red, orange, light red, yellow, white (0, 9, 2, 8, 10, 7, 1), eight steps each for the first five and twelve for yellow and white; the choice of seven and the weighting are design decisions, the order is `colour_fade`'s luminance ranking with the non-fire hues left out.
8. The whole screen costs more than a frame, so run it in two halves on alternate frames: the seed row and rows 23 to 12 after one line-256 crossing, rows 11 to 0 after the next.

### Why it works

A bitmap fire has to compute a heat value per pixel and pack bits; a character fire computes one per cell and the VIC does the rest, so the arithmetic is 1,000 cells rather than 64,000 pixels and the write is one store per cell. Colour RAM is the right target because it is the only per-cell store that changes a cell's appearance without touching character data: with a solid glyph the nibble is the picture. The averaging kernel is a low-pass filter run once per row per update; heat diffuses sideways as it rises, which rounds the columns into flame shapes, and the constant decay is what makes the flame finite in height rather than a smear. The divide by four also decays, because it truncates: with decay 0 the recipe's fire still tops out at orange and light red rather than white.

Luminance order matters because the eye reads the palette as a temperature scale. A table that runs black, brown, red, orange, yellow, white is monotone in brightness, so a cell's brightness is its heat and the picture reads as a gradient; put a bright colour below a dark one and the flame gets a stripe that reads as a shape rather than heat. `colour_fade` in `transitions.md` gives the VICE PAL luminance order for all sixteen colours; the fire's seven are a subset of it.

### Cycle budget

Measured on the recipe with CIA1 timer A in VICE x64sc, screen on (badline stealing included):

- Whole screen, seed row and rows 23 to 0: 53,479 cycles PAL, 53,695 NTSC. About 2.7 PAL frames.
- Bottom half, seed row and rows 23 to 12: 27,301 PAL, 27,773 NTSC.
- Top half, rows 11 to 0: 26,115 PAL, 26,329 NTSC.
- Per cell in the X-indexed loop, from the listing: `clc`, `lda abs,x`, three `adc abs,x`, two `lsr`, `beq`, `sec`, `sbc #`, `sta abs,x`, `tay`, `lda abs,y`, `sta abs,x`, `inx`, `cpx`, `bne` is 51 cycles (arithmetic from the instruction table). The 950 loop cells are 48,450, the fifty edge cells at about 41 each about 2,050 and the seed row about 1,000: 51,500 before badline stealing, against the measured 53,479.

A half is still 1.3 PAL frames, so with the update synced to a line-256 crossing each half occupies two frames and the whole screen refreshes every four: 12.5 updates a second PAL, 15 NTSC. Fully unrolling the columns to absolute stores and replacing the shift and subtract with a 256-entry table would bring the per-cell cost to about 38 cycles (arithmetic, not built here): 19,000 for a half, which only just fits a PAL frame of 19,656 and does not fit an NTSC frame of 17,095.

### Variations

**2x2 cell fire with a half-height glyph pair.** Give every cell one of two custom glyphs, the top half set or the bottom half set, so a 40 by 25 screen shows 40 by 50 heat cells with two colours per character cell: the colour-RAM nibble for the set half and `$D021` for the clear half. Only one of the two halves can vary per cell, so it is a vertical resolution gain for the bright tip at the cost of a fixed black lower half; a real 2x2 needs four glyphs and the two-colour limit still holds.

**A wider kernel.** Add `heat[r+1][c-2]` and `heat[r+1][c+2]` and divide by eight (three shifts; six values of at most 63 still fit a byte at 378 only if the range is cut to 42, or keep a carry byte). Wider kernels spread the flame sideways faster and soften it; the cost is two more `adc` per cell.

**Wind.** Bias the kernel: read `c-1` twice and drop `c+1` for a flame that leans right, or swap them for left. Alternating the bias every few updates with a slow sine gives a flicker. Costs nothing extra per cell, since the kernel is the same size.

### Pitfalls

`full_field_redraw_exceeds_vblank` (`../pitfalls/text-mode-render.md`): this is a full rewrite of colour RAM every update and it does not fit a frame; the split into halves and the raster-crossing wait are the answer, and a viewer sees the tear within an update as motion because the picture is changing anyway. `colour_ram_index_past_last_cell_hits_cia1` (same page): every store is by row with X at most 39, so the index cannot reach 1,024; write the loop any other way and the first stray store hits `$DC00`. `lfsr_zero_state_lockup` (`../pitfalls/cpu.md`): the seed is a constant `$5A` and a Galois LFSR never enters zero from a non-zero state, so the lockup cannot happen unless the constant is set to zero; a seed taken from a timer or a keypress must be checked.

### Recipes

- `recipes/kickassembler/fire-effect.md`: the design above, seed `$5A`, decay 1, pinned at cycle 6,565,800 on both models with a per-colour cell census of the picture and a decay-0 control.

### Sources

- The measurements on this entry are from the recipe named above, VICE x64sc 3.10, CIA1 timer A; the luminance order is `colour_fade`'s.

---

## twister — A turning square column drawn as a band of per-line edge positions from a phase table

**Complexity:** medium
**Region:** both
**Uses registers:** D011, D012, D016, D018, D020, D021, DC04, DC05, DC0E
**Requires:** standard_bitmap, table_generation
**Cost:** cycles_per_frame=13561, bytes_code=9383, bytes_data=512
**Cost basis:** measured-vice
**Cost measured on:** kickassembler-twister (worst display-on frame, PAL, 128 lines of 8 bytes copied through a pointer; the blanked frame is 13,001 and the worst NTSC frame 13,819; bytes_code is the code segment reported by -showmem, almost all of it the unrolled copy; bytes_data is the 512-byte phase table)

### Why

A twister is a column that turns about its vertical axis while its cross-section is twisted along its height, so the faces wind down it and appear to climb as it turns. It reads as a solid 3D object, and it costs no 3D arithmetic at run time: every line of the band is a picture of the column's cross-section at one angle, there are only as many such pictures as there are angles, and they can all be drawn before the program starts. The frame loop is then a copy of one small image per line, with the image chosen by the line's angle.

### How

1. A standard bitmap at `$2000`, screen RAM at `$0400` with one colour pair in every cell, `$D011 = $3B`, `$D018 = $18`. The band is 64 pixels wide and 128 lines tall, byte columns 16 to 23 of bitmap rows 36 to 163, centred on x = 160.
2. **Edges from one sine.** A square column seen side on has four vertical edges; at rotation angle a (0 to 255 for a turn) edge i is at `x_i = 160 + 32 sin((a + 64 i) & 255)`, the four edges being one sine a quarter turn apart. Face i spans `x_i` to `x_(i+1)`, and it is in front when `x_i < x_(i+1)`; at most two faces pass that test at once, which is the hidden-face rule for free.
3. **Faces from pattern masks.** Each face has a fixed byte pattern: solid `$FF`, fifty percent `$AA`, twenty-five percent `$88`, empty `$00`. A pixel of the band is lit if some front face covers it and that face's pattern has the pixel's bit set. Four shades on a one-ink bitmap is what tells the faces apart.
4. **A phase table, so the frame loop is a copy.** At assembly time, for each of 64 angles a = 0, 4, .., 252, evaluate steps 2 and 3 for the 64 pixels of the band and pack them into 8 bytes: 64 images, 512 bytes, page aligned. The recipe does it with nested `.for` loops that fill a KickAssembler `List` and one `.fill 512, phases.get(i)`.
5. Per frame, line L of the band takes phase `(t + L) & 63`, a straight helix of one turn over 64 lines, and its 8 bytes are copied into the line's bitmap bytes: `ldy #k`, `lda (src),y`, `sta row + 8 k` eight times, then the pointer stepped by 8 with a page toggle on the carry, unrolled over the 128 lines. t advances by 1 a frame. The copy starts at raster line 250.

### Why it works

The column's appearance at any height depends only on the angle at that height, and the angle takes 64 values, so 64 images are the whole effect; the twist is nothing but the choice of which image each line gets, and moving the whole choice by one image a frame is the rotation. The per-line work is therefore the smallest thing a bitmap line can cost, eight loads and eight stores, and the sine, the face test and the patterns are paid once by the assembler. The straight helix comes from the phase being linear in the line; the fixed patterns come from evaluating them per pixel at build time rather than per row at run time, which is why the fifty percent face is `$AA` on every row and not a checkerboard, so that one image can serve any line.

### Cycle budget

Measured on the recipe with CIA1 timer A in VICE x64sc 3.10:

- The 128-line copy, display blanked: 13,001 cycles, both models; 101.6 a line (arithmetic).
- Display on, frames 1 to 299: 13,557 to 13,561 PAL, 13,813 to 13,819 NTSC. Both fit a frame, with about 6,100 cycles to spare on PAL and 3,300 on NTSC (arithmetic against 19,656 and 17,095).
- The control with no per-line phase step (`STRAIGHT`), blanked: 11,305; the pointer advance is the 1,696 between them, 13.25 a line.
- Per line from the instruction table: 8 by (2 + 5 + 4) = 88 for the copy, 13 for the advance, 20 on a page crossing; 128 lines of 101 plus the setup is 12,960 before the crossings, against the measured 13,001.

The copy exceeds the vertical blank (about 6,700 cycles on PAL after line 250) and runs on into the display, but it stays ahead of the beam: when the beam reaches the band's first line about 92 of the 128 lines are written, and at 63 cycles a line against 102 the beam would need 242 lines to catch up (arithmetic from the measured cost). A phase table laid out by plane, eight 64-byte tables indexed by the phase in X with `lda plane_k,x`, would bring a line to about 70 cycles (arithmetic, not built).

### Variations

**A bending helix.** Replace `t + L` with `t + L + sin2[(t + L) & 255]` or a slower sine of L alone, so the pitch of the twist varies down the column and the column seems to bend. It costs one more table read per line if the phase is worked per line at run time, or nothing if a 128-entry per-frame phase list is built in the blank first.

**Colour per face through screen RAM.** Screen RAM gives one colour pair per 8 by 8 cell, so a face can only be coloured where a whole cell is inside it; an edge that falls inside a cell splits that cell between two faces that must share one ink. With four faces and 8-pixel cells the only clean form is a colour per cell column that changes as the edge passes the cell boundary, which is a second per-frame write of 8 cells per cell row and still shows a one-cell step at each edge. Multicolour bitmap mode gives two more inks at half the horizontal resolution and the same cell limit.

**Two columns.** A second band with its own t, or the same t with an offset, is a second copy at the same per-line cost; two 64-pixel bands are 26,000 cycles a frame at this listing's cost (arithmetic), more than a PAL frame, so two columns want the plane layout or alternate-frame updates.

### Pitfalls

`full_field_redraw_exceeds_vblank` (`../pitfalls/text-mode-render.md`): the copy is 13,001 cycles against a blank of about 6,700, so it does run in the display; it does not tear only because it starts at line 250 and stays ahead of the beam for a band that begins at row 36, and a taller band or a slower copy would be caught (the recipe gives the arithmetic). `sine_table_peak_wraps_to_zero` (`../pitfalls/maths.md`) is about an unsigned table of amplitude 128 about 128; here the amplitude is 32 about 160, the values run 128 to 192, and the edges are compared in script and never stored as bytes, so it does not arise.

### Recipes

- `recipes/kickassembler/twister.md`: the design above, pinned at cycle 12,000,000 on both models, with the edges of three rows measured against the table, the timer figures, and a `STRAIGHT` control whose 128 lines are one row pattern.

### Sources

- The measurements on this entry are from the recipe named above, VICE x64sc 3.10, CIA1 timer A and the exit screenshot measured with PIL.

---

## tunnel — Tunnel effect

**Complexity:** high
**Region:** both
**Uses registers:** D018, D021

### Why

The tunnel effect simulates the viewer moving forward through an infinitely long cylindrical (or irregularly shaped) tunnel whose walls are texture-mapped. Each frame, the texture pattern on the walls appears to scroll toward the viewer, and the camera can rotate to look around the curve of the tunnel. The visual impression is of continuous forward motion through a geometric space, a compelling illusion created entirely in software. The tunnel effect became a hallmark of mid-1990s PC demoscene productions and was subsequently achieved on the C64 within the same decade.

### How

The tunnel is implemented as a per-cell lookup table precomputed at startup or embedded as static data. For each cell position `(cx, cy)` in the 40×25 character grid, two values are precomputed:

- **Distance:** how far from the center of the screen this cell would be mapped to on the tunnel wall. Cells near the screen center map to distant parts of the tunnel (the "far end"); cells near the edges map to nearby parts (just around the first curve).
- **Angle:** the angular position around the tunnel's circumference that this cell maps to. Cells at the same distance but different angular positions map to different parts of the texture column.

At each frame, the displayed color at cell `(cx, cy)` is:

`color = texture[(distance[cx][cy] + time_offset) & (TEX_H - 1)][(angle[cx][cy] + rotation_offset) & (TEX_W - 1)]`

where `time_offset` advances each frame (simulating forward motion) and `rotation_offset` changes the apparent camera rotation. The texture is a 2D pattern (typically a checkerboard, brick, or stripe design) stored as a byte array.

Because color RAM must be updated for every frame, the write loop visits all 1,000 cells and performs two table lookups plus one color RAM store per cell. The distance and angle tables are kept in RAM, and the texture access is a 2D index into a flat texture array. Self-modifying code or zero-page index arithmetic reduces the per-cell overhead.

### Why it works

The mathematical foundation is polar coordinate projection. Each screen cell's distance from the screen center corresponds to a Z-depth in the tunnel: cells close to center are far away (the vanishing point), cells at the edge are near. The mapping follows `distance ~ 1 / r` where `r` is the pixel-space distance from center, producing a hyperbolic depth mapping that correctly simulates perspective recession. The angle maps directly to the circumferential U coordinate of the tunnel texture.

By pre-computing both tables at startup, the per-frame inner loop does only table lookups and array indexing — no trigonometry or division at runtime. The time offset (added to the distance table index before texture access) scrolls the texture "into" the screen, simulating forward motion. The rotation offset (added to the angle table index) rotates the texture around the tunnel axis, simulating camera roll.

The VIC-II's character mode is used exactly as in the plasma technique: color RAM holds per-cell color values; screen RAM holds a fixed all-set character ($A0 reverse space or a custom all-$FF glyph) so that the colour-RAM colour fills the cell. (An earlier version of this sentence said a blank character "so that only the background color contributes"; in standard text mode Colour RAM sets the set-bit pixels, and a blank cell shows only $D021.)

### Variations

**Non-circular tunnel.** By modifying the distance and angle tables, the tunnel can be made elliptical, rectangular (a corridor), or irregular. The precomputed tables absorb the shape complexity; the per-frame loop is unchanged.

**Zooming tunnel.** Instead of scrolling the time offset at a constant rate, accelerate or decelerate it. Combined with a rotation offset that also accelerates, this produces a swirling, warping tunnel animation.

**Textured with character cells.** Rather than writing color RAM alone, also write screen RAM to select a character whose pixel pattern varies by position. This adds pixel-level texture detail to the per-cell color. Cost: doubles the per-cell write count (screen RAM + color RAM = 8 cycles per cell vs 4).

### Cycle budget

Per-frame, full 40×25 color RAM update:

- Per-cell: two table lookups (approximately 10 cycles each, self-modifying index or indexed indirect), one 2D texture access (approximately 10–15 cycles, depending on texture layout), one color RAM write (4 cycles) = approximately 35–45 cycles per cell.
- 1,000 cells × 40 cycles = approximately 40,000 cycles per frame.
- PAL frame budget: ~19,600 cycles. ~40,000 cycles is just over two PAL frames (2 × 19,656 = 39,312), so the render falls to every third frame, 16.7fps; trimming the loop under ~39,000 cycles (leaving room for the IRQ and offset update) recovers every-other-frame, 25fps. (An earlier version of this line said "approximately 12fps (every other frame)"; every other PAL frame is 25fps.)
- With screen RAM writes as well (character selection per cell): add 4,000 cycles (1,000 × 4), approximately 44,000 cycles per frame — also every third frame, 16.7fps.

The dominant optimization is the inner loop structure. Using an unrolled loop over 40 cells per row (8 unrolled iterations of 5 cells each, or fully unrolled at 40 cells per row) eliminates loop branch and counter-increment overhead. A fully unrolled 40-cell row costs fewer cycles than a tight loop due to the absence of branch instructions.

---

## starfield — Multi-layer starfield with depth parallax

**Complexity:** medium
**Region:** both
**Uses registers:** D015, D000, D001, D002, D003, D004, D005, D006, D007, D008, D009, D00A, D00B, D00C, D00D, D00E, D00F, D010

### Why

A moving starfield is the background layer of a substantial fraction of all C64 games and demos. Stars scroll horizontally or vertically to simulate the player's motion through space, and parallax (different layers at different speeds) adds the illusion of depth: bright foreground stars rush past quickly while dim background stars drift slowly. The technique is fast enough to run in the idle cycles of a game main loop and visually effective enough that it remains a standard element of intros and cracktros forty years after the C64's introduction.

### How

Each star is a hardware sprite. With 8 sprites available, a typical starfield uses all 8 — one sprite per star if the stars are large enough to need their own bitmap, or all 8 as single-pixel-like objects for classic small-dot starfields.

**Sprite-based (8 stars maximum per layer).** Each frame:

1. Advance each star's X position by its layer speed constant (foreground speed > background speed).
2. If the star passes the right (or left) edge of the screen, wrap it to the opposite edge and randomize its Y position within the playfield area (so the wrapping event is not visible at the same Y each loop).
3. Write updated X positions to $D000, $D002, ..., $D00E. Write MSB-X bits to $D010.
4. Write updated Y positions to $D001, $D003, ..., $D00F.

Each sprite's image data is a single-pixel-style custom shape (one bit set in the 8×8 effective area, or a small cluster of pixels for larger stars). Sprite color varies by layer: white or light yellow for foreground, medium gray or light blue for middle layer, dark gray for background.

**Combined sprite + charset (more than 8 stars).** The 8 hardware sprite stars are the foreground layer. A second and third layer are implemented as character cells: random character indices are placed in screen RAM positions, where each character index corresponds to a single-pixel dot at a specific position within the 8×8 cell. These cells scroll via $D016 XSCROLL (for horizontal) combined with per-column screen RAM copy (cycle the entire 40-column row each frame to shift the display content one cell per 8 frames). The character-based layers can hold hundreds of stars at near-zero per-star CPU cost after the initial setup.

### Why it works

The VIC-II's sprite registers accept any X coordinate 0–511 (using the MSB in $D010) and Y coordinate 0–255. Sprites at any of these coordinates will render on the appropriate scanlines as long as they are enabled. There is no hardware enforcement of a "playfield boundary" for sprites — they render wherever they are positioned, including outside the standard character display area.

The parallax illusion works because the visual system interprets faster-moving objects as closer. The two-layer or three-layer speed differential — typically a ratio of 2:1 or 3:1:0.5 between foreground, mid, and background — is sufficient to generate convincing depth without any 3D computation.

The random Y re-seed on edge wrap prevents the visible "column of stars appearing" artifact that occurs when all stars re-enter from the same vertical position. A simple LFSR (linear feedback shift register) operating on the star's Z layer value provides low-cost pseudo-random Y values.

### Variations

**Vertical starfield.** Instead of scrolling horizontally, advance Y positions downward (or upward) each frame. Useful for space shooters with vertical scrolling. Y-wrapping requires checking for Y > 255 and resetting to 0 (plus random X re-seed).

**Twinkle effect.** Randomly change a star's sprite color between white, light gray, and medium gray each frame. This simulates the star twinkling without any positional update cost. One random-byte read per star per frame, written to $D027+n. Approximately 8 cycles per twinkling star.

**Dense starfield via character layer.** Fill all 1,000 screen RAM positions with a computed character index based on a pseudo-random pattern generated at startup. Stars appear at fixed positions relative to the character map. Horizontal scrolling of the entire character layer (via XSCROLL + row-shift) makes the dense background scroll. The character layer approach supports hundreds of visible stars at essentially zero per-star per-frame cost.

### Cycle budget

8-sprite starfield, per frame on PAL:

- Per-star position update: 3 additions (X += speed, check wrap, conditional Y reset) = approximately 15–20 cycles per star including conditional branch.
- Write all 8 X positions: 4 cycles × 8 = 32 cycles.
- Write all 8 Y positions: 4 cycles × 8 = 32 cycles.
- Write $D010 MSB: 4 cycles.
- Total: approximately (8 × 18) + 68 = approximately 212 cycles per frame for an 8-sprite starfield.
- Well within PAL budget; typically takes under 1% of frame cycles.

Multi-layer (8 sprites + 40-column row-shift for character layer):

- Row shift: copy 40 bytes of screen RAM one position left = approximately 200 cycles per character-mode layer.
- Combined total: approximately 400–500 cycles per frame for sprite + two character layers.

---

## text_zoom — Per-line $D016 manipulation for zooming and wobbling text

**Complexity:** high
**Region:** both
**Uses registers:** D016, D011
**Demands:** midframe_raster_irqs
**Requires:** stable_raster_irq

### Why

Standard character mode displays text at a fixed position. The VIC-II's hardware scroll registers ($D016 bits 2-0 for horizontal, $D011 bits 2-0 for vertical) allow a global shift of the entire display by up to 7 pixels in each axis — one setting per frame. By changing these registers on a per-scanline basis via a stable raster IRQ chain, a different scroll offset can be applied to each row of the display. The result is that each text row appears horizontally displaced by a different amount, producing sine-wave wobble, zoom, and distortion effects that make the text appear to pulse, wave, or undulate. This technique is the basis for the classic "wobbly text" intro effect and is widely used in cracktros and menu systems.

### How

The technique requires a stable raster IRQ set to fire on every scanline within the text zone (or every other scanline for less resolution). At each IRQ entry:

1. Acknowledge the VIC-II interrupt ($D019).
2. Advance the IRQ to the next target scanline ($D012 = current + 1 or current + 8).
3. Compute the new XSCROLL value for this line: index a sine table using `(line_index + time_offset) & 255`, extract the low 3 bits of the result as the XSCROLL value.
4. Write the XSCROLL to $D016 (preserving bits 3–7: CSEL, MCM; mask with `AND #$F8` or use a precomputed table — an earlier version of this step said bits 4–7, which drops CSEL and puts the display in 38 columns). Common implementation: precompute a table of $D016 values where each entry combines the desired XSCROLL with the constant $D016 bit settings, avoiding a read-modify-write cycle.
5. Optionally write a new YSCROLL to $D011 for vertical displacement (less common; creates a vertical sine wobble in addition to horizontal).

The raster IRQ chain fires on each of the 8 scanlines within a character row (one IRQ per scanline for maximum sine resolution) or once per character row (one IRQ per 8 scanlines, giving coarser per-row resolution but using far fewer IRQ slots). For a 25-row text display with per-row precision, 25 IRQ slots per frame are needed. Per-scanline precision requires up to 200 IRQ slots — approaching the limit of practical IRQ chains, but achievable with a highly optimized dispatcher.

### Why it works

XSCROLL is not latched once per line: the display sequencer applies the current $D016 value continuously, so a write that lands mid-line shifts the remainder of that line (measured in VICE x64sc: a write landing around cycle 38–39 of line 100 left cells 0–21 at offset 0 and cells 22–39 at +7 on the same line, with line 101 fully shifted). An earlier version of this section said the VIC sampled XSCROLL "during the horizontal sync period" and held it for the whole line, with a latch "at approximately cycle 13"; neither is true, and `pitfalls/scroll.md` says the same — the value that lives in XSCROLL when the beam draws a given character is the one that applies.

For a clean per-line effect the write must complete before the first character's pixels start to shift out — on PAL that is X coordinate $18 at cycle 17, so the STA must finish by cycle 16 — or on the previous line only after its last character's pixels have left the sequencer, i.e. once the right border has begun (about cycle 58 on PAL), not merely after the last g-access on cycle 55. (The cycle-17/58 figures are arithmetic from the VIC X-coordinate table; the mid-line split is the measurement.) A stable raster IRQ (which eliminates jitter) is what makes that window reliable; without it, some lines take the write in time and some take it mid-line, producing a torn cell boundary rather than a smooth sine curve.

The sine table produces a smooth displacement value for each line. By advancing the time offset each frame, the displacement function appears to "move" through the text, creating the animation. Using different amplitude scaling or multiple sine terms produces more complex deformation patterns (figure-eight wobble, standing waves, etc.).

### Variations

**Zoom simulation.** Rather than a sine wave, use a linear ramp for XSCROLL values: row 0 gets XSCROLL = 0, row 12 gets XSCROLL = 3, row 24 gets XSCROLL = 7. This shifts lower rows further right, simulating a perspective tilt. Animated by updating the ramp's offset each frame.

**Horizontal color bars combined with wobble.** While the raster IRQ chain is already firing per scanline for the XSCROLL writes, also write $D020/$D021 (border/background color) at each IRQ entry. This overlays a color bar effect with the text wobble — the classic "colored wobbly text" combo seen in many C64 intros.

**YSCROLL manipulation for vertical displacement.** Writing $D011 bits 2-0 at each character-row IRQ entry displaces each character row vertically by 0–7 pixels. Produces a vertical sine wave across the text. Warning: changing YSCROLL at the wrong cycle can trigger spurious badlines (see `raster.md`, `badline_synchronization`). The write must arrive before the badline condition is evaluated for the row to avoid this side effect.

### Cycle budget

Per-scanline IRQ (one IRQ per raster line, 200 lines covered):

- IRQ entry and acknowledgment: approximately 15 cycles.
- Sine table lookup and XSCROLL preparation: approximately 10–15 cycles.
- $D016 write: 4 cycles.
- $D012 advance and RTI: approximately 8 cycles.
- Total per IRQ: approximately 37–42 cycles out of 63 available on PAL (non-badline).
- On badlines: 37–42 cycles out of 20 available on PAL (63 − 43; 23 only if the three cycles before BA takes hold happen to be write cycles — see `raster.md`, `badline_synchronization`). Exceeds the badline budget. An earlier version of this line said ~23.
- Standard mitigation: skip XSCROLL writes on badlines. The visual effect shows a 1-line horizontal glitch at each badline row (every 8 lines), usually acceptable.

Per-character-row IRQ (one IRQ per 8 scanlines, 25 rows):

- Same per-IRQ cost: approximately 40 cycles.
- Only 25 IRQs per frame: total approximately 1,000 cycles.
- All lines within each row share the same XSCROLL. Coarser wobble resolution but far cheaper. The standard approach for game scrollers and low-complexity text animations.

---

## voxel_landscape — Voxel-space landscape rendering

**Complexity:** scene-tier
**Region:** both
**Uses registers:** D011, D018

### Why

Voxel-space rendering draws a landscape by projecting a heightfield — a 2D grid of elevation values — onto the screen from a camera perspective. Each vertical column on the screen corresponds to one direction in the horizontal field of view; within each column, the algorithm walks from the camera outward along that direction, sampling the heightfield and projecting each sample's elevation onto the screen column. The result is a continuous terrain surface rendered as a series of vertical lines, producing the characteristic "Comanche"-style ragged horizon and rolling terrain. On the C64, voxel landscapes are slow but achievable, and their visual distinctiveness is worth the cost for scene-tier productions.

### How

The algorithm's inner loop walks outward from the camera for each screen column (there are 40 character columns in character mode, or 160 in multicolor bitmap mode):

1. For the current screen column, compute the horizontal direction angle from the camera.
2. For each depth step along that direction (stepping from near to far), compute the 2D heightfield coordinate: `hx = camera_x + depth * cos(angle)`, `hy = camera_y + depth * sin(angle)`.
3. Look up the height at `(hx & MAP_MASK, hy & MAP_MASK)` in the heightfield array.
4. Project the height to screen Y: `screen_y = HORIZON_Y - (height - camera_z) * FOCAL / depth`.
5. If this screen Y is above the previous highest rendered Y for this column, draw a vertical line from the previous top to this screen Y using the height's color value from the texture map.
6. Update the "highest Y" for this column. If it reaches the top of the screen, stop processing this column (no further depth steps can contribute visible pixels).

In character mode, drawing a vertical line means writing a character cell or a bitmap column. Most C64 voxel implementations use multicolor bitmap mode (160 pixels wide, 200 tall) to get sufficient horizontal resolution.

The depth stepping uses a fixed-point representation: depth increments by a small constant per step, and the `cos`/`sin` table provides the 2D direction vector components as fixed-point integers. Map coordinates wrap modulo the map size (power-of-two dimensions for cheap masking).

### Why it works

The key insight of voxel-space rendering is that each screen column is independent: it can be rendered in isolation without knowledge of adjacent columns. This allows the outer loop to iterate over columns and the inner loop to handle depth. The early-exit optimization (stop when the top of the column is reached) means that near terrain (which covers most of the column from top to bottom) is drawn quickly, while only open-sky columns incur the full depth-walk cost.

The C64 can store a 64×64 or 128×128 heightfield comfortably within the 64 KB address space. Larger maps require memory banking, adding complexity. The texture map (color for each height value) is a simple 256-entry table: height byte → VIC-II color index. The VIC-II's 4-bit color system means 16 distinct terrain colors, which is sufficient for a basic landscape (rock, grass, water, snow).

Frame rate is the dominant limitation. A 160-column 200-row bitmap with a 64-depth walk per column, with early exit typically cutting the average to 30–40 depth steps per column: 160 × 35 × (cost per step). Per-step cost: one heightfield lookup, one height compare, one conditional vertical fill increment — approximately 25–35 cycles per step. Total: approximately 160 × 35 × 30 = 168,000 cycles per frame. On PAL (19,656 cycles per frame) this is 8.5 PAL frames of work, so a new frame every ninth PAL frame: 50 / 9 = 5.6fps. An earlier version of this sentence said 2–4fps, which does not follow from its own cycle count. This is the realistic target for a C64 voxel renderer without extreme optimization.

### Variations

**Lower resolution.** Reduce to 40 character columns (using character mode, one character = one vertical column) and 100 depth steps. The visual resolution is coarser but the cycle cost drops proportionally: approximately 40 × 50 × 30 = 60,000 cycles per frame, just over 3 PAL frames of work (3 × 19,656 = 58,968), so a render every fourth frame: 12.5fps.

**Precomputed direction tables.** Move all `cos`/`sin` multiplications into precomputed per-column tables. At startup, for each column compute and store the per-step `(dx, dy)` fixed-point vector. The inner loop then needs only two additions (advance `hx` and `hy`) rather than a multiply. This is the standard approach for any real C64 voxel implementation.

**Color shading by distance.** Apply a depth fog: distant terrain uses darker colors (closer to black) than near terrain. Implemented by selecting the texture color entry based on both height and depth: `color = color_table[height & COLOR_MASK][depth >> DISTANCE_SHIFT]`. Adds approximately 5 cycles per step for the 2D color lookup.

### Cycle budget

Per column, per frame, 40-step depth walk (approximate):

- Per-step (after precomputed direction table optimization): map coordinate advance (2 additions: ~6 cycles), heightfield lookup (~5 cycles), height compare (~4 cycles), conditional bitmap column write (~10 cycles if writing, ~4 if skipping) = approximately 25–30 cycles per depth step.
- 40 steps × 27 cycles = approximately 1,080 cycles per column.
- 40 columns × 1,080 = approximately 43,200 cycles per frame.
- PAL: 43,200 cycles is 2.2 PAL frames of work, so a render every third frame = 16.7fps at this resolution (an earlier version of this line said 11fps). Reasonable target for scene-tier production.
- At 160-column multicolor bitmap mode: approximately 4× more columns = approximately 4× the cost = 172,800 cycles, 8.8 PAL frames, so a render every ninth frame = 5.6fps. (An earlier version of this line said 8–9fps, confusing PAL frames per render with frames per second.)

All cycle estimates above are approximate. Actual performance depends heavily on inner-loop implementation, memory layout, and whether the early-exit optimization eliminates a significant fraction of depth steps.

---

## mode7_lookalike — Pseudo-Mode-7 affine warp

**Complexity:** scene-tier
**Region:** both
**Uses registers:** D018, D016

### Why

The SNES's Mode 7 hardware applies a per-scanline affine transformation (scale, rotate, translate) to a flat texture map, producing the effect of a flat plane receding toward a horizon — the floor and ceiling warp used in F-Zero, Mario Kart, and dozens of other games. The C64 has no equivalent hardware. But by changing $D018 (video matrix / bitmap base pointer) and $D016 (XSCROLL) on every scanline via a stable raster IRQ chain, the apparent horizontal position and scale of the bitmap display can be varied per line, approximating the affine warp look. The result is not as smooth as hardware Mode 7, but is visually striking and was unambiguously impressive for a 1 MHz 8-bit machine.

### How

The standard approach uses a precomputed scaling table indexed by raster line number. The fundamental observation: as scanlines approach the horizon (the vertical midpoint of the display), the rendered row must show a wider field of view (the pixels are farther apart in world space), which means the bitmap should "shrink" horizontally toward the horizon. Below the horizon, rows are near the camera and show a narrow field of view (pixels close together), so the bitmap appears large.

In practice on the C64, this is implemented by changing $D018 bit 3 (which of the two 8 KB halves of the VIC bank holds the bitmap; bits 4-7 select the video matrix, i.e. the per-cell colour bytes, not the bitmap — an earlier version of this paragraph had the bits wrong) and $D016 bits 0-2 (XSCROLL) on each scanline. Changing bit 3 mid-frame redirects the bitmap fetch for the following lines to the other 8 KB half, so the two halves can hold differently laid-out row data. Combined with XSCROLL (which shifts by 0–7 pixels without changing the base address), the combined address + scroll offset gives enough control to simulate the affine scale.

A full implementation uses double-buffering: while one bitmap bank is displayed, the other is prepared with a set of pre-scaled row data. The row data is pre-rendered offline (or at startup) as a series of 40-byte rows at different scales: row 0 (near the camera) uses full-width bitmap data from the source texture; row 100 (near the horizon) uses a compressed version where the source texture is sampled at every 4th or 8th pixel. Each row in the pre-scaled buffer is drawn from this pre-compressed source. Swapping $D018 between frames (pointing to the newly-prepared buffer) completes the double-buffer.

### Why it works

The VIC-II reads bitmap data from the 8 KB half selected by $D018 bit 3 (bitmap base: $0000 or $2000 within the VIC bank; bits 7-4 select the video matrix, not the bitmap) combined with the current scan position. The bitmap base is read on every g-access, so a mid-row write changes the source from the very line it lands on (measured in VICE x64sc: a write landing on line 100, the second line of character row 6, switched the displayed bitmap on line 100 itself, not on line 107; see `raster.md`, `raster_split_modes`) — land it before cycle 16 of the target line, or after cycle 55 of the previous one. Only the video-matrix half (bits 7-4) is deferred: its 40 cells are fetched by the badline c-accesses and held in the row buffer, so a VM change shows from the next character row. An earlier version of this paragraph said a $D018 bitmap-base change waits for the next character row; that is true only of the video-matrix bits.

Per-scanline XSCROLL ($D016) changes are not latched either: the display sequencer applies the current value continuously, so a write that lands mid-line shifts only the remainder of that line (measured in VICE x64sc; see `text_zoom` above — an earlier version of this paragraph said XSCROLL was "sampled at approximately cycle 13", which is not how the sequencer behaves). By finishing the $D016 write by cycle 16 of a raster line, or in the right border of the preceding line (from about cycle 58 on PAL), a different XSCROLL can be applied cleanly to each individual scanline. This provides 0–7 pixel horizontal offset granularity per scanline.

The combination of per-line $D018 changes and per-scanline $D016 changes produces the visual scaling illusion — but the two levers are not symmetrical. The bitmap base has only two positions per bank (bit 3), so $D018 is a coarse two-way switch, useful for double-buffering or for splitting the display between two differently prepared buffers; it cannot supply a graded per-row offset. The per-row scale therefore has to come from the pre-scaled row data laid out in the buffer itself, with XSCROLL adding the 0–7 pixel fine shift that centres each row on the horizon point. (An earlier version of this paragraph described "small" and "progressively larger $D018 offsets" per row; no such graded offsets exist in the register.)

### Variations

**Static texture warp (no animation).** Use a precomputed static per-row layout in bitmap RAM. No per-frame double-buffer swap needed; $D018 and $D016 are written once at setup and not changed. The result is a stationary Mode-7-style floor graphic, useful for title screens or map displays.

**Rotation overlay.** Add a per-frame rotation offset to the per-row XSCROLL table (shifting all rows by a sine-derived offset). This rotates the apparent "camera heading" over the floor plane without redrawing the bitmap data. Fast: only 200 XSCROLL writes per frame (one per scanline via the IRQ chain), approximately 800 cycles.

**Animated texture.** Each frame, copy a new section of a larger source texture into the bitmap buffer, offset by a camera-position variable. Combined with the per-line scaling, this produces the impression of flying over a moving terrain. Very expensive: the 6510 has no block move, and even a fully unrolled `LDA abs,X` / `STA abs,X` copy costs 9-10 cycles per byte including page-cross penalties and loop overhead, so copying an entire 8,000-byte bitmap costs roughly 75,000-80,000 cycles (measured 79,041 in VICE with the screen blanked) — four PAL frames on its own, and nearer six or seven once the per-line IRQ chain below has taken its ~39% of each frame. An earlier version of this sentence said "approximately 8,000 cycles", i.e. one cycle per byte. A full-buffer animated texture therefore lands around 7-12fps on PAL; most implementations copy only the rows that change, or scroll the source through $D018/$DD00 bank selection instead of copying it.

### Cycle budget

Per-scanline IRQ chain (one IRQ per raster line, 200 active lines):

- Per-IRQ: acknowledge ($D019), advance $D012 (+1), look up XSCROLL from precomputed table (approximately 5 cycles), write $D016 (4 cycles), look up $D018 from table (5 cycles), write $D018 (4 cycles), RTI (6 cycles) = approximately 35–40 cycles per line.
- 200 lines × 38 cycles = approximately 7,600 cycles per frame for IRQ-chain overhead alone.
- PAL budget: ~19,600 cycles. The IRQ chain consumes approximately 39% of the frame. Remaining ~12,000 cycles are available for camera position update, input handling, and bitmap buffer preparation.
- $D018 does not need writing on every line. With only two bitmap bases available (bit 3), the register only needs writing on the lines where the source actually changes, which a per-row layout limits to at most 25 per frame — and if $D018 is being used only as the double-buffer flip, it is one write per frame. Writing $D018 in 25 rather than 200 of the per-line IRQs saves approximately 5 × 175 = 875 cycles. Worth doing. (An earlier version of this line justified the saving by saying $D018 "takes effect at character row boundaries (every 8 lines)"; that timing holds for the video-matrix bits 7-4, not for the bitmap-base bit, which takes effect on the line it is written.)

All cycle counts above are approximate and will vary with handler implementation, table layout, and whether badlines are handled separately.

### Recipes

- `recipes/kickassembler/pseudo-3d-road.md` — coarse layer only (fine layer timing not resolved in that build; see "What it does not establish").

---

## wireframe_pipeline — Rotated, projected, culled and clipped wireframe objects in a hires bitmap

**Complexity:** high
**Region:** both
**Uses registers:** D011, D018, DD00
**Requires:** standard_bitmap, table_multiply_8x8

### Why

A space trader, a flight game or a tank game draws solid-looking objects
as edges only. Lines are cheap on a 1 MHz CPU where filled faces are
not, and a convex object drawn with its hidden edges removed reads as
solid. This is the pipeline Elite uses. Each stage has a standard
6502-sized form, and the stages have to agree on number ranges, or a
coordinate wraps and a line lands across the screen.

### How

Per object, per update:

1. **Object model.** Signed-byte vertices, faces listed by their vertex
   indices in a consistent winding, and edges that name their two
   vertices and the two faces they separate. The object must be convex
   for culling alone to remove every hidden edge.
2. **Rotation.** Build a 3x3 fixed-point matrix from the object's angles
   with a sine table scaled to 64 and quarter-square multiplies
   (`table_multiply_8x8`, `techniques/maths.md`). Multiply each vertex
   by it: nine products, summed in 16 bits and shifted right 6.
3. **Translation and projection.** Add the object's position. Screen x
   is `cx + x * d / z`. The division is a reciprocal table indexed by z
   and one more multiply (`table_generation`,
   `techniques/cpu-cycle-tricks.md`), or the divide in
   `division_8_16bit` (`techniques/maths.md`).
4. **Back-face culling.** A face is visible when it faces the camera.
   Either rotate the face normals and test the sign of the normal dotted
   with the line of sight (Elite's way), or test the winding of the
   projected face (`dx1 * dy2 - dy1 * dx2`). The winding test needs no
   normals and is exact under perspective, up to rounding. An edge is
   visible when either of its faces is, and is drawn once.
5. **Clipping.** Give each endpoint an outcode (left, right, above,
   below). If both endpoints share a bit, drop the line. If both are
   inside, draw it plainly. Otherwise, either cut the line at the window
   edge (Cohen-Sutherland, one divide per crossing) or draw it with a
   plotter that skips pixels outside the window.
6. **Drawing.** Bresenham along the longer axis, plotting with EOR into
   the hires bitmap through row and column tables (`standard_bitmap`,
   `techniques/bitmap-modes.md`).
7. **Erasing.** Either keep each object's drawn endpoints in a line heap
   and draw them again with EOR in the next update, or double-buffer:
   two bitmaps in two VIC banks, clear and draw the hidden one, and
   switch banks with `$DD00` (and `$D018`) at the frame boundary. The
   two bitmaps need two banks because one 16 KB bank cannot hold two
   8,000-byte bitmaps and a matrix (`solid_vector_3d` above).

### Why it works

EOR is its own inverse, so drawing the same line twice leaves the bitmap
as it was, even where the line crosses another object's lines.
Erase-by-redraw therefore costs one line draw per old line and nothing
per empty pixel. Clearing a bitmap costs the whole area: a 4,000-byte
half-screen at 5 cycles a byte (an unrolled `STA abs,X`, instruction
table) is 20,000 cycles, whether the objects are small or large. The
price of redraw is flicker: a line is off the screen between its erase
and its redraw. Double buffering hides that but pays for the clear and
for a second bank. Where lines meet, EOR clears every pixel covered an
even number of times, so two-edge vertices show a missing pixel.

Culling edges through faces keeps the line count low: a cube shows at
most three faces and nine of its twelve edges. Culling also removes
every hidden edge of a convex object, so no depth sort is needed.

A per-pixel clip gives the same inside pixels as a cut line, because
Bresenham's pixels do not depend on where the line is cut. It costs
time on the outside part of the line, and it needs every coordinate to
fit the plotter's range. A cut line costs a divide per crossing but
handles coordinates far off screen.

### Variations

**Elite (C64).** Each ship has a line heap: one size byte, then four
bytes (X1, Y1, X2, Y2) per visible line; a Sidewinder never shows more
than 15 edges, so 61 bytes. Each frame, Elite redraws the old heap with
EOR to erase it, works out face visibility from the dot product of the
face normal and the line of sight, derives the visible vertices and
edges from the faces, projects, clips (routines LL145 and LL118), fills
the heap and draws it. The C64 screen is split by raster interrupts at
lines 51 and 51 + 143 = 194: a black-and-white standard bitmap space
view 144 pixels tall above a multicolour bitmap dashboard. Hardware
sprites draw the laser sights. (Mark Moxon's annotated source; not
measured here.)

**Double-buffered.** Two VIC banks, each with its own bitmap and matrix,
clear-and-draw instead of erase, and a `$DD00` write at the frame
boundary. There is no flicker and no EOR artefact, and plotting can use
OR. A `$DD00` bank switch also moves every sprite pointer and the
character set with the bank (`pitfalls/banking.md`,
`vic_bank_visibility_collision`).

**Faster plotting.** The recipe's plotter looks up the row address on
every y step. An incremental plotter moves the byte address by 8 and
rotates the bit mask as x steps, and adds 1 (or 313 from the last line
of a cell row to the first of the next) as y steps. It is faster, and
was not measured here.

### Cycle budget

Measured in VICE x64sc with the display on, badlines included, for
`recipes/kickassembler/wireframe-ships.md`: three objects (8, 5 and 7
vertices; 12, 8 and 12 edges), each 37 to 70 pixels across on screen
(model), in a 160 x 120 window.

- Worst update over 48: 155,708 cycles PAL, 157,212 NTSC; the frozen
  update 131,620 PAL. That is 7.9 PAL frames, about 6 updates a second.
- Line call (erase or draw): 2,350 PAL, 2,370 NTSC on average, for 32.5
  pixels a line in the model, so about 72 cycles a pixel including
  set-up. Line calls average 97,500 PAL cycles an update: 74% of the
  last update, 63% of the worst.
- Matrix build: 523 PAL, 522 NTSC.
- Transform and project: 1,179 PAL, 1,228 NTSC per vertex (nine signed
  multiplies at 56 to 60 cycles each with the call, by the instruction
  table, then two projection multiplies, sums and shifts).
- The ship (7 vertices, 7 faces, 12 edges): 47,467 PAL, 48,152 NTSC per
  update.

No Cost line: one update of this recipe takes 7.9 PAL frames and is
not spread across frames, so no per-frame figure was measured. A game
that spreads an update across frames states its own worst frame. The
two routines to speed up first are the plotter and the per-vertex
multiplies. The recipe's plotter is correct and fully measured; it is
not a fast plotter (`recipes/kickassembler/wireframe-ships.md`, "Why
the line drawer is slow").

### Recipes

- `recipes/kickassembler/wireframe-ships.md`: a cube, a pyramid and a
  ship hull in a hires window, winding cull, outcode reject and
  per-pixel clip, EOR erase-by-redraw, checked pixel-exact against a
  Python model on PAL and NTSC.

### Sources

- Mark Moxon, "Drawing ships" (line heap, EOR erase, frame order):
  https://elite.bbcelite.com/deep_dives/drawing_ships.html
- Mark Moxon, "Back-face culling" (normal dotted with line of sight):
  https://elite.bbcelite.com/deep_dives/back-face_culling.html
- Mark Moxon, "Line clipping" (LL145, LL118):
  https://elite.bbcelite.com/deep_dives/line-clipping.html
- Mark Moxon, "The split-screen mode in the Commodore 64 version"
  (lines 51 and 194, 144-pixel space view, sprites for laser sights):
  https://elite.bbcelite.com/deep_dives/the_split-screen_mode_commodore_64.html
