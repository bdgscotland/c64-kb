<!-- doc-type: reference -->

# C64 Art Production Reference

This document covers the artist-facing constraints and workflows for C64 graphics production. It assumes the reader knows what the VIC-II is but needs to understand what that means when sitting down to create or convert artwork. Hardware register-level details, mode enable sequences, and cycle counts live in `../hardware/vic-ii-reference.md` and `../techniques/bitmap-modes.md`. This document is about what the artist can and cannot do, which tools exist, and how a production workflow typically runs.

---

## Graphics Modes: Artist-Facing Constraints

### Hires Bitmap (Standard Bitmap Mode)

The full 320×200 pixel canvas. Every pixel is individually set or clear, but color resolution is coarse: the screen is divided into 40×25 attribute cells of 8×8 pixels each. Each cell gets exactly two colors — one for set pixels, one for clear pixels — chosen from the full 16-color palette independently per cell. The constraint is hard: two pixels in the same 8×8 cell that are both set must be the same color. Pixels in different cells face no such restriction.

In practice this means that sharp diagonal edges between two colors of similar brightness will produce attribute clash unless the edge runs along an 8-pixel-aligned vertical boundary. Hires bitmap suits images with clearly separated color areas and strong contrast. Portraits with detailed skin gradients fight the mode; bold illustrative graphics or line-art thrive in it.

No additional CPU overhead beyond the baseline badline cost. The artist's render loop is straightforward: draw, then live with the attribute grid.

### Multicolor Bitmap (Koala Format)

The trade for extra colors is horizontal resolution: pixels are 2 pixels wide, giving an effective canvas of 160×200 pixels. Each 4×8 cell uses four colors assigned by 2-bit pixel values: color 00 maps to the global background ($D021), color 01 to the screen RAM high nibble, color 10 to the screen RAM low nibble, and color 11 to the Color RAM nibble for that cell. Three of the four colors are per-cell; only the global background is universal. This makes multicolor bitmap the richest standard mode for full-screen painted art. Most C64 paint programs (Koala Painter, Advanced Art Studio, Multipaint) target this mode.

The Koala format is the canonical file layout for multicolor bitmaps. It stores 8000 bytes of bitmap, 1000 bytes of screen RAM, 1000 bytes of Color RAM, and one byte for the global background color, totaling 10003 bytes with a 2-byte load address header. See `../formats/c64-file-formats.md` for the byte layout.

### Multicolor Character Mode

Instead of a 8000-byte raw bitmap, the screen is defined by 1000 character indices pointing into a 256-entry charset, each character 8×8 pixels. In multicolor character mode, pixels in each character are 2 pixels wide (like multicolor bitmap) and can reference four colors: the global background ($D021), plus two colors from $D022 and $D023, plus a per-cell color from Color RAM. The critical constraint is that the $D022/$D023 colors are truly global — all cells share them. The per-cell flexibility comes only from Color RAM and the character data itself.

The 256-tile budget is the binding constraint. With only 256 distinct glyphs, complex photographic imagery is out of reach; but for structured game tilemaps, title screens, or stylized logos, the memory savings over a full bitmap (2 KB for a charset vs 8 KB for a bitmap) are significant. Games almost universally use character or multicolor character mode for their play-field rendering. See the Charset / Tilemap Art section below.

### Hires Text Mode (Standard Character Mode)

The default C64 power-on mode. Each screen cell is two colors: the character foreground from Color RAM, and the global background from $D021. Characters can come from ROM (the built-in charset) or from a custom charset in RAM. The PETSCII aesthetic — the visual language of screen codes and box-drawing characters — is native to this mode. Hires text is beginner-accessible and produces recognizable C64 output without any special setup.

For the scene artist, hires text mode is the entry point for PETSCII graphics: careful arrangement of ROM characters to suggest shapes and shading. The constraint is that Color RAM is per-cell so foreground colors vary freely; only the background is global.

### Multicolor Text Mode

Setting bit 4 of $D016 switches character cells to 2bpp multicolor rendering. Colors 00 and 01 and 10 are global ($D021, $D022, $D023); color 11 is per-cell from Color RAM. High bit of Color RAM byte selects multicolor mode per character, so a mix of hires and multicolor characters is possible on the same screen. Useful for detailed bitmap-style characters at lower memory cost than a full bitmap.

### Extended Color Mode (ECM)

ECM assigns one of four background colors (from $D021–$D024) to each character cell based on the top two bits of the character code, leaving only 64 unique character shapes. This cuts the tile library to one quarter of normal. ECM is niche — it suits structured decorative work where four background colors are needed but 64 glyphs suffice. The 64-glyph limit makes it unsuitable for general-purpose text or complex tilesets.

### FLI — Flexible Line Interpretation

FLI is a software technique, not a hardware mode. By exploiting the timing of the VIC-II's video matrix fetch (which occurs on the first cycle of each badline), the CPU can substitute a different 1000-byte screen RAM for every 8-line group within the frame, giving per-row attribute control in bitmap mode. In standard multicolor bitmap the attribute cell is 4×8 pixels (horizontal) by 8 pixels (vertical); FLI breaks the 8-scanline vertical grouping. With one screen RAM per raster row, the effective color cell shrinks to 4×1 in the limit — any pixel row can have its own per-cell color selection.

The artist sees dramatically reduced attribute clash. Colors can change every scanline within a cell column. The tradeoff is an 8-column-wide artifact strip on the left side (the FLI bug, or "FLI bar"): the CPU cannot swap the screen RAM pointer fast enough for the first 3 character columns on each row, producing a characteristic discolored band. Productions work around this by placing the FLI bug in a black or off-screen area, covering it with a sprite overlay, or treating it as a design element.

FLI images are heavier on CPU time (the IRQ handler must run on every raster line during the visible frame) and require careful memory layout, but the resulting image quality for photographic or painted content is noticeably superior to plain multicolor bitmap. FLI is the standard format for high-quality C64 scene graphics.

### AFLI — Advanced FLI (Hires FLI)

AFLI applies the same per-row screen RAM substitution to standard hires bitmap mode. The effective attribute cell becomes 8×1 pixels, giving per-cell two-color control on every scanline. Each cell remains two-color; dithering between adjacent pairs simulates additional colors. AFLI images look closest to 16-color dithered PC graphics. CPU cost and the FLI bug are both present as in standard FLI.

### IFLI — Interlaced FLI

IFLI alternates two FLI frames on successive video fields, exploiting the PAL display's 50 Hz interlace. Because PAL composite monitors blend adjacent fields, two slightly offset FLI images appear to the eye as a single image with doubled vertical color resolution. The effective color cell approaches 4×0.5 pixels. The result on a real PAL monitor or a correctly configured PAL composite display is the highest achievable color fidelity on unmodified C64 hardware — images approach photo quality.

The cost is severe: the CPU is essentially fully occupied managing the dual-frame IRQ machinery, leaving little headroom for animation. IFLI is almost exclusively used for standalone art viewers or competition entries where the image itself is the demo. The artist must paint into a tool that generates the dual-frame format natively (Multipaint supports IFLI export). On NTSC hardware IFLI breaks down — the interlace phase relationship differs and the blending does not occur correctly. IFLI is inherently a PAL format.

---

## The 16-Color Palette as a Creative Palette

The C64's 16-color palette is fixed in hardware — there is no DAC register to remap colors. The 16 colors are: black, white, red, cyan, purple, green, blue, yellow, orange, brown, light red (pink), dark grey, medium grey, light green, light blue, light grey.

This palette has pronounced internal structure. The "screaming" colors — yellow, light green, light blue, white — are high-luminance and high-saturation. They punch hard in borders, logos, and large fills but fatigue the eye quickly. The neutral range — black through the three greys to white — gives a workable five-step luminance ramp for shading and dithering. The "muddy" middle — brown, orange, red — has low chroma relative to their luminance and clashes easily with the saturated colors. Brown in particular reads as desaturated; placing it next to yellow or white makes it appear almost grey.

For contrast the most reliable pairs exploit luminance difference rather than hue: black/white, black/yellow, black/light blue, blue/white. Cyan over red is a classic scene combination (high contrast, complementary hue); purple over light green works similarly. Avoid placing brown next to medium grey — the luminance step is too small for reliable differentiation on composite output.

Dithering exploits the eye's spatial averaging of adjacent colors. In multicolor mode the 4-pixel-wide pixel pitch is coarse enough that checkerboard patterns read as textures rather than blends at normal viewing distance; on composite the narrow chroma bandwidth can produce visible fringing. The most effective C64 dithering patterns are horizontal stripes (alternating pixel rows) in hires mode, where composite vertical blending is stronger than horizontal. In FLI and IFLI modes, dithering is a primary tool for extending the effective palette — per-scanline color control lets the artist introduce a new hue every row within a gradient.

PAL composite output introduces chroma artifacts that artists have learned to exploit. Certain color transitions produce a colored fringe between them — chroma phase interference — that adds a third perceived color not present in the source palette. This effect is monitor and cable dependent and will not appear on HDMI upscalers or clean S-Video. On real PAL hardware it is a reliable technique; for emulator-distributed releases it is a liability.

The PAL vs NTSC chroma problem affects palette selection. Perceived colors differ meaningfully between PAL and NTSC machines and between hardware revisions. Two palette reference standards are in wide use: the Pepto palette (derived by Philip "Pepto" Timmermann from real-hardware measurement) and the Colodore palette (derived by Tobias "Colodore" from a different reference set). Pepto produces slightly warmer reds; Colodore skews cooler. The practical advice is to use Colodore for modern emulator-target releases (it is the default in recent VICE builds) and to accept that images will look subtly different on real hardware. Avoid relying on exact hue relationships between the similar grey pairs or the similar browns — these are the most variable colors across chip revisions.

---

## Tools

### Multipaint

The modern cross-platform standard for C64 bitmap painting. Runs natively on Windows, macOS, and Linux. Supports hires bitmap, multicolor bitmap (Koala), FLI, AFLI, and IFLI modes. Exports to the canonical file formats consumed by assemblers and loaders. The critical feature for production work is real-time attribute clash visualization: pixels that would cause a color conflict in the current mode are flagged on-screen as the artist paints, allowing manual correction before export. Multipaint is available at multipaint.org. Complexity tier: intermediate (mode concepts are required before it makes sense).

### Spritemate

A browser-based sprite editor. Operates in the browser without installation, making it accessible to artists without a C64 toolchain setup. Supports both single-color and multicolor sprite editing, copy/paste between sprite slots, and export to assembly source or binary data. Produces data ready for direct inclusion in Oscar64 or KickAssembler projects. Complexity tier: beginner.

### SpritePad

A native Windows sprite and animation editor with a longer history than Spritemate. Supports up to 96 sprites in one project file, animation sequences, multicolor and hires modes, and overlay/background preview against a bitmap or character screen. Exports to `.spd` project format and binary or assembly source. SpritePad is the standard tool in Windows-centric scene groups. Complexity tier: beginner to intermediate.

### CharPad

The standard native Windows charset and tilemap editor. Manages the 256-tile budget, paints characters in multicolor or hires mode, assembles tiles into full-screen tilemaps, and exports screen RAM, Color RAM, and character data as binary or assembly source. CharPad project files carry all tile and map data together. Complexity tier: intermediate.

### PETSCII Studio

A browser-based PETSCII art editor. Treats the ROM charset as its canvas: the artist picks characters and colors from a palette and places them on the 40×25 grid, using box-drawing characters, reverse characters, and symbol characters to construct images. Exports to PRG (direct screen memory load), assembly source, or plain text. Complexity tier: beginner.

### ProjectOne

A scene-oriented cross-platform tool for creating structured C64 screen layouts combining sprites, characters, bitmaps, and raster splits. Primarily used for designing demo screens with multiple VIC-II modes in the same frame. Not a pixel painter; rather a layout compositor that wires together assets created in other tools and generates the screen RAM, sprite positioning data, and raster split timing tables. Complexity tier: scene-tier.

### Historical Tools

Koala Painter was the original multicolor bitmap editor for the real C64. Its file format became the de facto standard for C64 painted graphics and remains the primary interchange format today. Advanced Art Studio followed with hires and multicolor support. Both are emulated in VICE and remain useful for validating that modern tool output matches hardware behavior, but Multipaint has superseded them for new production work.

---

## Sprite Art Principles

Each hardware sprite is 24×21 pixels in single-color mode. The pixel is square at the C64's pixel clock rate (approximately 320 pixels across the visible display), so a 24-pixel-wide sprite occupies roughly 18.75% of the display width. In multicolor sprite mode, pixels double in width: the effective canvas is 12×21 pixels at 2bpp. The two extra bits per pixel give three foreground colors, but the horizontal resolution halves.

In multicolor sprite mode, two global multicolor registers ($D025, $D026) are shared across all sprites, plus one per-sprite color from $D027–$D02E. All multicolor sprites therefore share the same two global colors — an artist cannot give one sprite a red highlight and another a blue highlight via the multicolor slots. The per-sprite register provides the only per-sprite differentiation in this mode.

Sprite stretching is available in hardware. $D01D doubles width (48 pixels); $D017 doubles height (42 pixels). Both can combine for a 48×42 sprite. Stretching does not add resolution — the same 63-byte pixel data renders at double scale. Useful for large simple objects (explosions, large enemies) at no additional data cost.

When the side border is opened by software, sprites can extend across the full horizontal visible area including regions normally covered by the border color. Art intended for border-open productions must account for this extended horizontal range when compositing sprite layouts against the background.

---

## Charset / Tilemap Art Principles

The VIC-II references a charset of up to 256 characters, each 8×8 pixels at 8 bytes of data. In a 40×25 text screen, 1000 screen RAM bytes index into this charset; Color RAM provides per-cell color. The 256-tile budget is absolute — there is no overflow. Once all 256 tiles are used, adding a new distinct visual element requires repurposing an existing tile.

In hires text mode each tile is one foreground color (from Color RAM) on the global background. In multicolor text mode, tiles can use up to four colors with the pixel-doubling resolution tradeoff. A screen can mix hires and multicolor characters by setting or clearing bit 3 of each Color RAM byte — this is one of the mode's more powerful features for artists: detailed hires outlines can coexist with filled multicolor areas in the same screen.

Per-row attribute updates are possible with raster IRQs. By writing to $D022/$D023 (the shared multicolor text colors) at scanline boundaries, different horizontal bands of the screen can use different shared color pairs — effectively multiplying the available shared colors by the number of raster splits. This is a coder responsibility, but the artist must design tiles aware that the shared colors may change between rows.

The PETSCII aesthetic — building recognizable imagery from the ROM charset without any custom tiles — is a distinct artistic discipline. The ROM charset contains alphanumeric characters, box-drawing characters, and symbols that combine in ways their designers did not intend. Conventions: smooth curves are approximated with diagonal box characters, shading is implied through character density, and the full reverse-video set doubles the available shapes. Modern tools like PETSCII Studio make this accessible to artists without assembly knowledge.

When using a custom charset for game tilemaps, the 256-tile budget forces curation. Common strategies to stretch it: tile mirroring in software (storing only left-facing variants, flipping sprites to cover the right-facing case), shared edge tiles (a tile designed to abut two different neighbors reduces needed unique shapes), and palette rotation (varying Color RAM to reuse the same tile shape in different colors). CharPad shows tile usage frequency to help the artist spot where the budget is going.

---

## Bitmap Art Workflow

The standard production workflow starts outside the C64 palette. The artist roughs out the composition in a modern paint program (Photoshop, Krita, Procreate) using a C64 palette swatch — Pepto or Colodore — to gain access to layers, undo history, and modern brushes without fighting the attribute grid during creative work.

The rough is then imported into Multipaint, which quantizes to the 16-color palette and maps the image into the target mode's attribute structure. The initial quantized result will have attribute clashes. Multipaint highlights these visually, and the artist works through them manually: repainting pixels to respect cell boundaries, adjusting local colors, and accepting detail loss in complex areas. This clash-fixing pass is often the most time-consuming part of bitmap art production.

After clash resolution the palette assignment is reviewed. Multipaint lets the artist swap which palette index is assigned to which cell attribute, allowing optimization without repainting. Moving a frequently-used shadow color from a per-cell slot to a global background register (where applicable) can free cell palette slots for more varied local colors. In multicolor mode, identifying which colors appear most frequently across cells and assigning them to the global shared registers reduces clash pressure.

Export produces the canonical binary files for the target format. For Koala, this is a single 10003-byte file. For FLI, this is a set of screen RAM pages and the bitmap, typically managed by the editor. The exported files are then included in the project's asset directory and linked into the build by the assembler or Oscar64's data embedding syntax. See `./asset-pipelines.md` for how assets move from export to ROM or disk.

The Koala vs FLI vs IFLI choice is primarily a quality/complexity tradeoff. Koala is the default: minimum CPU overhead, maximum compatibility, tool support everywhere. FLI is appropriate when attribute clash in Koala is unacceptable and the CPU budget allows the per-line IRQ cost. IFLI is reserved for showcase pieces on PAL hardware where absolute image quality is the only constraint. A game will almost never use FLI or IFLI for its play-field graphics — the CPU cost prohibits it. A demo title screen or loader image may use any of the three formats depending on quality ambition and the group's toolset.

---

## Cross-References

- `../techniques/bitmap-modes.md` — runtime rendering of hires bitmap, multicolor bitmap, FLI, AFLI, and IFLI; register enable sequences; cycle budgets.
- `../formats/c64-file-formats.md` — byte-level file format specifications for Koala, Art Studio, and other art tool formats.
- `./asset-pipelines.md` — how exported art assets are embedded into a C64 build using Oscar64 or KickAssembler; disk layout for multi-file productions.
