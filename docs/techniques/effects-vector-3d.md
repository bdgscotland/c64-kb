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
4. Apply perspective projection: `screen_x = cx + (tx * FOCAL) / (tz + DEPTH_OFFSET)`, `screen_y = cy + (ty * FOCAL) / (tz + DEPTH_OFFSET)`. Division is a second lookup table: a reciprocal table indexed by Z.
5. Output the projected point to the display.

Two display strategies exist:

**Sprite-based plot.** Each hardware sprite is treated as a single large pixel. With 8 sprites enabled and multiplexed across the frame, up to approximately 24–32 points can be displayed simultaneously before flicker sets in (the VIC-II's 8-sprite-per-line limit means points at the same Y coordinate compete for sprite slots). Individual point size is one sprite with all-pixels-on data (a solid 24×21 block, typically clipped to 8×8 via masking). Color can be varied per point by writing the sprite color registers.

**Charset-based plot.** Points are rendered by writing custom 8×8 character cells (a small dot pattern: a single lit pixel at a specific bit position) into character RAM and then filling the corresponding screen RAM positions. Up to 256 distinct per-cell dot positions are possible with a 256-entry custom charset. This allows far more than 8 points per scanline at the cost of character-aligned resolution (points snap to 8×8 cell boundaries). Multicolor character mode halves horizontal resolution but allows colored dots against a background.

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

- Sine/cosine lookups and matrix multiply: approximately 60–90 cycles per point using 8-bit fixed-point arithmetic (6 multiply-via-table lookups, each roughly 10–15 cycles including index computation and 8-bit shift for scaling).
- Perspective divide (reciprocal table lookup): approximately 15–20 cycles.
- Sprite register writes (X, Y, pointer, color): approximately 20 cycles per sprite, all 8 sprites written in the vertical blank = ~160 cycles total for sprite output.
- Charset-based output (write one char cell + screen RAM byte): approximately 8–12 cycles per point.

For a 32-point cloud at ~75 cycles per point: approximately 2400 cycles per frame computation, well within the ~19,500 available on PAL. Frame rate is typically 25fps (every other PAL frame) for 32 points, or every frame for 16-point clouds.

### Recipes

- `recipes/kickassembler/cracktro-template.md` (demonstrates sprite-based dot rotator in a demo context)

---

## solid_vector_3d — Solid-shaded polygon rendering

**Complexity:** scene-tier
**Region:** both
**Uses registers:** D011, D018, D016

### Why

Filled polygon rendering transforms the 3D wireframe aesthetic into something that more closely resembles a solid object. Instead of dots tracing the surface geometry, filled faces show which polygons are visible (front-facing) and shade them with a flat color derived from the polygon's orientation relative to a light source. The result — a rotating cube or pyramid whose faces shade and swap visibility as it turns — is the canonical "solid vector" demoscene effect. It appears in virtually every major C64 demo from the late 1980s onward.

The technique is more demanding than the dot rotator because filled polygons require two additional operations beyond point projection: face visibility determination (do not draw back-facing polygons) and scanline fill (for each visible face, fill every horizontal span between the face's left and right edges on each display row).

### How

**Face culling.** For each polygon face (triangle or quad), compute the face normal vector after rotation. If the Z component of the normal points away from the viewer (in the standard camera-at-origin setup, this means the normal Z is positive, assuming a left-handed coordinate system), the face is back-facing and not drawn. This eliminates roughly half the polygons in a convex solid without any rendering work.

**Z-sorting.** For transparent or non-convex objects, sort the remaining visible faces by their average Z depth (painter's algorithm: draw farthest first). This avoids visible-surface errors without a depth buffer. For a simple convex solid, Z-sorting is not necessary because correct back-face culling already prevents overlap errors.

**Scanline fill.** For each visible face, scan the face's edges to build a left-edge and right-edge table: for each row Y spanned by the face, record the leftmost X (left edge) and rightmost X (right edge). Then fill each row by writing pixels from left X to right X in bitmap RAM. The fill loop is the performance-critical inner loop.

The VIC-II bitmap mode is used for output. Standard bitmap mode ($D011 bit 5 set, $D011 bit 6 clear, $D016 bit 4 clear) provides 320×200 pixels at 1 bit per pixel, with one foreground and one background color per 8×8 character cell. Multicolor bitmap mode ($D016 bit 4 set) provides 160×200 pixels at 2 bits per pixel with four colors per cell, commonly used for colored polygon faces. The screen is cleared (or back-buffer swapped) before each new frame.

### Why it works

The fill loop exploits the VIC-II's bitmap memory layout: pixels are stored 8 per byte, left to right, top to bottom, in row-major order. Filling a horizontal span of N pixels from column Xl to column Xr on scanline Y requires computing the byte addresses for Xl and Xr, masking the partial bytes at each end, and filling the interior bytes with $FF (all pixels on for the face color). This is a standard horizontal span fill, fast on the 6510 because interior bytes require only `LDA #$FF : STA address` — two instructions per 8 pixels.

Color RAM for multicolor mode is updated once per visible face (one byte per 8×8 cell the face overlaps), not once per pixel. For a quad-polygon face covering 32×32 pixels, color RAM updates hit 16 cells — 16 stores — against a pixel fill covering potentially 128 bytes. The fill dominates the cycle budget.

Frame rate is the key constraint. A typical C64 solid vector demo running on PAL operates at 12.5fps (rendering a new frame every 4 VIC-II frames). At this rate, the CPU has approximately 4 × 19,600 = 78,400 cycles per rendered frame. A 6-face cube with each face averaging 50 scanlines of 80-pixel fill: 50 scanlines × 10 bytes per line fill × ~8 cycles per byte = 4,000 cycles per face × 6 faces = 24,000 cycles, leaving ample room for edge computation and matrix math. Increasing to 12 faces (icosahedron) or larger polygons begins to strain the budget.

### Variations

**Flat shading with Lambert lighting.** Compute the dot product of each face's (rotated) normal with a fixed light-direction vector. Map the result to a VIC-II color index. The face is filled in that color. On the C64, this is typically done with a 16-entry lookup table (angle range → color index), approximating continuous shading with the available palette.

**Double buffering.** Maintain two bitmap areas in VIC bank memory. While one is displayed, the other is cleared and redrawn. Swap $D018 in the vertical blank. Eliminates partial-frame updates visible as tearing. Requires 16 KB of contiguous VIC bank memory (two 8 KB bitmap areas), limiting sprite and character data layout.

**Outline vectors (wireframe).** Skip the fill loop entirely; draw only the polygon edges as lines. Each edge is Bresenham line-drawn into the bitmap. Wireframe rendering is 10–20× faster than filled, enabling higher polygon counts or higher frame rates.

### Cycle budget

Critical inner loop (fill loop, multicolor bitmap, 160-pixel-wide row):

- 160 pixels / 8 per byte = 20 bytes to fill.
- Interior fill: `LDA #$FF : STA bitmap_addr,X` per byte = 6 cycles × 20 bytes = 120 cycles per fully-covered row.
- Left/right partial-byte masking: approximately 20–30 cycles per row.
- Row pointer advancement: approximately 8 cycles per row.
- Total per-row: approximately 150–160 cycles on a non-badline.
- On a badline (every 8th row): add 40 cycles = 190–200 cycles per row.
- A 50-row face: approximately 7,500–8,000 cycles (approximate; depends on face width and badline distribution).

Per-frame total (6-face cube, 25fps): approximately 45,000–50,000 cycles for fill alone. Achievable within the ~78,400 available at 12.5fps, tight at 25fps. Most scene-tier demos choose 12.5fps or 25fps based on polygon complexity.

### Recipes

- `recipes/kickassembler/cracktro-template.md` (includes a filled-box vector sequence in the intro)

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

The VIC-II displays the screen using screen RAM (character indices) and character RAM (pixel data for those indices) or bitmap RAM. Because both are writable by the CPU at any time, the CPU can modify the displayed image dynamically. The VIC-II reads character RAM during character fetch cycles (badlines) and character pixel data during character display cycles; these reads happen at specific times in the raster scan. Writes that land before the VIC reads that data are reflected in the current frame; writes that land after miss the frame and show up one frame later. For BOBs, the simplest approach is to update all BOBs during the vertical blank (the interval between frames where the VIC is not actively rendering), guaranteeing all updates take effect on the next frame.

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

- `recipes/kickassembler/cracktro-template.md` (uses character-mode BOBs for logo elements)

---

## plasma — Plasma effect via sine table additions

**Complexity:** medium
**Region:** both
**Uses registers:** D018, D021, D022, D023

### Why

The plasma effect fills the entire screen with a smoothly animated color pattern: rippling color waves that shift and interfere with each other, creating an organic, hypnotic motion with no sharp edges or hard boundaries. It is a staple of late 1980s and 1990s C64 demos and remains visually distinctive. Despite its complexity of appearance, the plasma algorithm is simple: the color at each screen cell is determined by the sum of two or more sine functions, one of which depends on X position, one on Y position, and one on time. The interaction of these functions produces the characteristic moiré-wave patterns.

### How

The screen is divided into a grid of color cells. In character mode (the most common approach), each cell corresponds to one screen RAM position and one color RAM position — a grid of 40×25 = 1,000 cells. In each rendered cell, the color is computed as:

`color = sin_table[(x * XSCALE + t) & 255] + sin_table[(y * YSCALE + t * 2) & 255]`

where `t` advances by a small constant each frame, `XSCALE` and `YSCALE` control the spatial frequency of each wave, and `sin_table` is a 256-entry table of values 0–15 (mapped to VIC-II colors). The sum of two such values (range 0–30) is used as an index into a 32-entry (or 16-entry wrapped) color palette table.

For richer plasma patterns, three or four sine terms are summed:

`color = sin(x + t) + sin(y + t * 3/2) + sin(x * 2 + y + t / 2)`

Each additional term requires an additional table lookup and addition, increasing the per-cell cycle cost linearly.

The result is written to color RAM (at $D800 in the standard VIC bank layout). Screen RAM is filled with space characters ($20) or a constant character value so that the background color of each cell shows through as the visible color. Writing to color RAM rather than screen RAM is important: the VIC-II's character display color comes from color RAM, not from the character data itself, for the background pixels.

Alternatively, for a full-color plasma that uses foreground pixels rather than background color, fill screen RAM with custom charset entries (varying dot patterns) and write both screen RAM and color RAM. This doubles the write count per cell but allows richer color patterns.

### Why it works

The VIC-II color RAM ($D800–$DBE7) stores a 4-bit color value for each of the 40×25 = 1,000 screen cells. In standard character mode, this color is applied to all foreground (set-bit) pixels in the character cell. The background color ($D021) is applied to all background (clear-bit) pixels. By using a character whose bit pattern is all zeros (a space character, or a custom "blank" character), only the background color is visible in each cell — which is overridden by color RAM for each cell's foreground color.

Wait: color RAM overrides the foreground color, not the background. The trick for background-only plasma is to use extended background color (ECM) mode, which provides four independently-settable background colors ($D021–$D024). Each character's high two bits (bits 7 and 6) select which of the four backgrounds to use for that cell. This gives a 2-bit-per-cell color selection driven by screen RAM content, with four palette entries (the four background registers). The plasma write loop updates $D021–$D023 per line (via raster IRQ, cycling through sets of four colors) or per frame, and updates screen RAM bits 7-6 per cell. This approach is common in 4-color plasmas.

For full 16-color plasma, color RAM must be written every frame for every cell. At 1,000 color RAM writes per frame × 4 cycles each = 4,000 cycles minimum (stores only), the color RAM update loop is the dominant cost.

### Variations

**4-color ECM plasma.** Use ECM mode ($D011 bit 6 set). Four background color registers and screen RAM high-bits select color. 1,000 screen RAM writes + 4 background register writes per frame. Much faster than full color RAM updates. Limited to 4 simultaneous colors but visually convincing.

**Animated palette via raster IRQ.** Rather than updating color RAM every frame, hold color RAM static and cycle the four background registers ($D021–$D024) via a per-line raster IRQ chain. This effectively applies a different color mapping to each screen row, creating vertical color variation without per-cell CPU work. The visual result differs from a true plasma (the pattern is horizontally uniform within each row) but is extremely cycle-efficient.

**Hi-res character plasma.** Fill screen RAM with custom 8×8 dot characters whose bit patterns vary by position, and write color RAM with computed colors. The character data provides local spatial variation (pixel-level patterns within each cell), while color RAM provides per-cell color. Combined, the result has both pixel-scale and cell-scale structure — a richer visual but double the per-frame write cost.

### Cycle budget

Full 16-color plasma (40×25 color RAM update), per frame on PAL:

- Per-cell: two sine lookups (approximately 10 cycles each), one addition, one palette-table lookup, one color RAM write (4 cycles) = approximately 30–40 cycles per cell.
- 1,000 cells × 35 cycles = approximately 35,000 cycles per frame.
- PAL frame budget: ~19,600 cycles. Result: full plasma requires approximately 1.8 PAL frames of CPU time — runs at 12–13fps (every other frame) in practice.

4-color ECM plasma (1,000 screen RAM writes, no color RAM updates):

- Per-cell: one or two sine lookups, one masking/OR operation, one screen RAM write = approximately 20–25 cycles per cell.
- 1,000 cells × 22 cycles = approximately 22,000 cycles per frame.
- Achievable at 25fps (every other PAL frame, with ~10,000 cycles to spare for other work).

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

The VIC-II's character mode is used exactly as in the plasma technique: color RAM holds per-cell color values; screen RAM holds a fixed character pattern (usually a blank character so that only the background color contributes).

### Variations

**Non-circular tunnel.** By modifying the distance and angle tables, the tunnel can be made elliptical, rectangular (a corridor), or irregular. The precomputed tables absorb the shape complexity; the per-frame loop is unchanged.

**Zooming tunnel.** Instead of scrolling the time offset at a constant rate, accelerate or decelerate it. Combined with a rotation offset that also accelerates, this produces a swirling, warping tunnel animation.

**Textured with character cells.** Rather than writing color RAM alone, also write screen RAM to select a character whose pixel pattern varies by position. This adds pixel-level texture detail to the per-cell color. Cost: doubles the per-cell write count (screen RAM + color RAM = 8 cycles per cell vs 4).

### Cycle budget

Per-frame, full 40×25 color RAM update:

- Per-cell: two table lookups (approximately 10 cycles each, self-modifying index or indexed indirect), one 2D texture access (approximately 10–15 cycles, depending on texture layout), one color RAM write (4 cycles) = approximately 35–45 cycles per cell.
- 1,000 cells × 40 cycles = approximately 40,000 cycles per frame.
- PAL frame budget: ~19,600 cycles. Runs at approximately 12fps (every other frame) with the remaining cycles used for offset update and loop overhead.
- With screen RAM writes as well (character selection per cell): add 4,000 cycles (1,000 × 4), approximately 44,000 cycles per frame.

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
4. Write the XSCROLL to $D016 (preserving bits 4–7: the MCM flag and other bits). Common implementation: precompute a table of $D016 values where each entry combines the desired XSCROLL with the constant $D016 bit settings, avoiding a read-modify-write cycle.
5. Optionally write a new YSCROLL to $D011 for vertical displacement (less common; creates a vertical sine wobble in addition to horizontal).

The raster IRQ chain fires on each of the 8 scanlines within a character row (one IRQ per scanline for maximum sine resolution) or once per character row (one IRQ per 8 scanlines, giving coarser per-row resolution but using far fewer IRQ slots). For a 25-row text display with per-row precision, 25 IRQ slots per frame are needed. Per-scanline precision requires up to 200 IRQ slots — approaching the limit of practical IRQ chains, but achievable with a highly optimized dispatcher.

### Why it works

The VIC-II samples $D016 bits 2-0 (XSCROLL) during the horizontal sync period at the beginning of each raster line (before dot generation starts for that line). The sampled value is used for the entire line's horizontal start position. By writing a new value before the line begins, the display appears shifted horizontally by that amount for the entire line.

Because the write must land before the VIC samples the register, the timing is approximately: write $D016 during the last few cycles of the previous raster line or during the first cycles of the current line. The VIC's XSCROLL latch is updated at a specific cycle (approximately cycle 13 of the line on PAL, during the idle cycles before the active display region starts). The raster IRQ fires at the start of each line, giving a window of approximately 10–13 cycles to write $D016 before the latch is read. A stable raster IRQ (which eliminates jitter) is essential; without it, some lines take the write and some do not, producing irregular wobble rather than a smooth sine curve.

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
- On badlines: 37–42 cycles out of ~23 available. Exceeds the badline budget.
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

Frame rate is the dominant limitation. A 160-column 200-row bitmap with a 64-depth walk per column, with early exit typically cutting the average to 30–40 depth steps per column: 160 × 35 × (cost per step). Per-step cost: one heightfield lookup, one height compare, one conditional vertical fill increment — approximately 25–35 cycles per step. Total: approximately 160 × 35 × 30 = 168,000 cycles per frame. On PAL this is approximately 8–9 PAL frames per rendered frame, yielding approximately 2–4fps. This is the realistic target for a C64 voxel renderer without extreme optimization.

### Variations

**Lower resolution.** Reduce to 40 character columns (using character mode, one character = one vertical column) and 100 depth steps. The visual resolution is coarser but the cycle cost drops proportionally: approximately 40 × 50 × 30 = 60,000 cycles per frame, achievable at approximately 3 PAL frames per rendered frame.

**Precomputed direction tables.** Move all `cos`/`sin` multiplications into precomputed per-column tables. At startup, for each column compute and store the per-step `(dx, dy)` fixed-point vector. The inner loop then needs only two additions (advance `hx` and `hy`) rather than a multiply. This is the standard approach for any real C64 voxel implementation.

**Color shading by distance.** Apply a depth fog: distant terrain uses darker colors (closer to black) than near terrain. Implemented by selecting the texture color entry based on both height and depth: `color = color_table[height & COLOR_MASK][depth >> DISTANCE_SHIFT]`. Adds approximately 5 cycles per step for the 2D color lookup.

### Cycle budget

Per column, per frame, 40-step depth walk (approximate):

- Per-step (after precomputed direction table optimization): map coordinate advance (2 additions: ~6 cycles), heightfield lookup (~5 cycles), height compare (~4 cycles), conditional bitmap column write (~10 cycles if writing, ~4 if skipping) = approximately 25–30 cycles per depth step.
- 40 steps × 27 cycles = approximately 1,080 cycles per column.
- 40 columns × 1,080 = approximately 43,200 cycles per frame.
- PAL: approximately 2.2 PAL frames per rendered frame at this resolution = approximately 11fps. Reasonable target for scene-tier production.
- At 160-column multicolor bitmap mode: approximately 4× more columns = approximately 4× the cost = approximately 8–9fps is more realistic.

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

In practice on the C64, this is implemented by changing $D018 bits 4-7 (the bitmap base address within the VIC bank) and $D016 bits 0-2 (XSCROLL) on each scanline. Changing $D018 mid-frame redirects the bitmap data fetch for subsequent scanlines to a different memory address, allowing the effective horizontal position of the bitmap to be shifted. Combined with XSCROLL (which shifts by 0–7 pixels without changing the base address), the combined address + scroll offset gives enough control to simulate the affine scale.

A full implementation uses double-buffering: while one bitmap bank is displayed, the other is prepared with a set of pre-scaled row data. The row data is pre-rendered offline (or at startup) as a series of 40-byte rows at different scales: row 0 (near the camera) uses full-width bitmap data from the source texture; row 100 (near the horizon) uses a compressed version where the source texture is sampled at every 4th or 8th pixel. Each row in the pre-scaled buffer is drawn from this pre-compressed source. Swapping $D018 between frames (pointing to the newly-prepared buffer) completes the double-buffer.

### Why it works

The VIC-II reads bitmap data from the address determined by $D018 bits 4-7 combined with the current scan position. Changing $D018 during the active display region causes the chip to fetch subsequent character rows from a different base address. This does not produce an immediate visible effect for the current character row (the VIC has already fetched the screen codes for the current row on the preceding badline), but from the next character row onward the new base address is used.

Per-scanline XSCROLL ($D016) changes take effect more immediately: the XSCROLL value is sampled at the beginning of each raster line (approximately cycle 13 of the line), before the first pixel is output. By writing $D016 in the first few cycles of a raster line (or in the last cycles of the preceding line), a different XSCROLL can be applied to each individual scanline. This provides 0–7 pixel horizontal offset granularity per scanline.

The combination of per-character-row $D018 changes (coarser: 8 lines apart) and per-scanline $D016 changes (finer: every line) produces the visual scaling illusion. Rows near the horizon use small $D018 offsets and large XSCROLL values (the bitmap is shifted to center the horizon point), while rows near the camera use progressively larger $D018 offsets (accessing wider sections of the pre-scaled buffer) and small XSCROLL values.

### Variations

**Static texture warp (no animation).** Use a precomputed static per-row layout in bitmap RAM. No per-frame double-buffer swap needed; $D018 and $D016 are written once at setup and not changed. The result is a stationary Mode-7-style floor graphic, useful for title screens or map displays.

**Rotation overlay.** Add a per-frame rotation offset to the per-row XSCROLL table (shifting all rows by a sine-derived offset). This rotates the apparent "camera heading" over the floor plane without redrawing the bitmap data. Fast: only 200 XSCROLL writes per frame (one per scanline via the IRQ chain), approximately 800 cycles.

**Animated texture.** Each frame, copy a new section of a larger source texture into the bitmap buffer, offset by a camera-position variable. Combined with the per-line scaling, this produces the impression of flying over a moving terrain. Very expensive (copying an entire bitmap buffer each frame = approximately 8,000 cycles for a 8 KB buffer), but achievable at 12–15fps on PAL.

### Cycle budget

Per-scanline IRQ chain (one IRQ per raster line, 200 active lines):

- Per-IRQ: acknowledge ($D019), advance $D012 (+1), look up XSCROLL from precomputed table (approximately 5 cycles), write $D016 (4 cycles), look up $D018 from table (5 cycles), write $D018 (4 cycles), RTI (6 cycles) = approximately 35–40 cycles per line.
- 200 lines × 38 cycles = approximately 7,600 cycles per frame for IRQ-chain overhead alone.
- PAL budget: ~19,600 cycles. The IRQ chain consumes approximately 39% of the frame. Remaining ~12,000 cycles are available for camera position update, input handling, and bitmap buffer preparation.
- $D018 changes take effect at character row boundaries (every 8 lines), so only 25 $D018 writes are needed per frame (one per character row). Writing $D018 in only 25 of the 200 per-line IRQs saves approximately 5 × 175 = 875 cycles. Worth doing.

All cycle counts above are approximate and will vary with handler implementation, table layout, and whether badlines are handled separately.
