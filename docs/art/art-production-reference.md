<!-- doc-type: reference -->

# C64 Art Production Reference

Artist-facing constraints and workflows for C64 graphics production, for a reader who knows what the VIC-II is and needs to know what it means for creating or converting artwork. Register-level details, mode enable sequences and cycle counts are in `../hardware/vic-ii-reference.md` and `../techniques/bitmap-modes.md`. This page covers what the artist can and cannot do, which tools exist, and how a production workflow runs.

---

## Graphics Modes: Artist-Facing Constraints

### Hires Bitmap (Standard Bitmap Mode)

The full 320×200 pixel canvas. Every pixel is set or clear, but color resolution is coarse: the screen is divided into 40×25 attribute cells of 8×8 pixels each. Each cell gets exactly two colors, one for set pixels and one for clear pixels, chosen from the 16-color palette independently per cell. Two set pixels in the same 8×8 cell must be the same color. Pixels in different cells have no such restriction.

Sharp diagonal edges between two colors of similar brightness therefore produce attribute clash unless the edge runs along an 8-pixel-aligned vertical boundary. Hires bitmap suits images with clearly separated color areas and strong contrast. Portraits with detailed skin gradients fight the mode; bold illustration and line art suit it.

No CPU overhead beyond the baseline badline cost. The artist draws, then works within the attribute grid.

### Multicolor Bitmap (Koala Format)

Extra colors cost horizontal resolution: pixels are 2 pixels wide, giving an effective canvas of 160×200 pixels. Each 4×8 cell uses four colors assigned by 2-bit pixel values: color 00 maps to the global background ($D021), color 01 to the screen RAM high nibble, color 10 to the screen RAM low nibble, and color 11 to the Color RAM nibble for that cell. Three of the four colors are per-cell; only the background is global. This makes multicolor bitmap the richest standard mode for full-screen painted art. Most C64 paint programs (Koala Painter, Advanced Art Studio, Multipaint) target it.

The Koala format is the canonical file layout for multicolor bitmaps. It stores 8000 bytes of bitmap, 1000 bytes of screen RAM, 1000 bytes of Color RAM, and one byte for the background color, totaling 10003 bytes with a 2-byte load address header. See `../formats/c64-file-formats.md` for the byte layout.

### Multicolor Character Mode

Instead of a 8000-byte raw bitmap, the screen is 1000 character indices pointing into a 256-entry charset, each character 8×8 pixels. In multicolor character mode, pixels are 2 pixels wide (as in multicolor bitmap) and can use four colors: the global background ($D021), two colors from $D022 and $D023, and a per-cell color from Color RAM. The $D022/$D023 colors are global: all cells share them. Per-cell variation comes only from Color RAM and the character data.

The 256-tile budget is the binding constraint. With 256 distinct glyphs, photographic imagery is out of reach, but for game tilemaps, title screens and stylized logos the saving over a full bitmap (2 KB for a charset vs 8 KB for a bitmap) is large. Games almost always use character or multicolor character mode for the play-field. See the Charset / Tilemap Art section below.

### Hires Text Mode (Standard Character Mode)

The default C64 power-on mode. Each screen cell has two colors: the character foreground from Color RAM and the global background from $D021. Characters come from ROM (the built-in charset) or from a custom charset in RAM. The PETSCII look (screen codes and box-drawing characters) is native to this mode. It gives recognizable C64 output with no setup and is where beginners start.

For the scene artist, hires text mode is where PETSCII graphics are made: ROM characters arranged to suggest shapes and shading. Color RAM is per-cell, so foreground colors vary freely; only the background is global.

### Multicolor Text Mode

Setting bit 4 of $D016 switches character cells to 2bpp multicolor rendering. Colors 00 and 01 and 10 are global ($D021, $D022, $D023); color 11 is per-cell from Color RAM. High bit of Color RAM byte selects multicolor mode per character, so hires and multicolor characters can share a screen. It gives detailed bitmap-style characters for less memory than a full bitmap.

### Extended Color Mode (ECM)

ECM assigns one of four background colors (from $D021–$D024) to each character cell from the top two bits of the character code, leaving only 64 unique character shapes: one quarter of the normal tile library. ECM suits structured decorative work that needs four background colors and no more than 64 glyphs. The 64-glyph limit rules it out for general text or complex tilesets.

### FLI — Flexible Line Interpretation

FLI is a software technique, not a hardware mode. By using the timing of the VIC-II's video matrix fetch (which occurs on the first cycle of each badline), the CPU can substitute a different 1000-byte screen RAM for every 8-line group within the frame, giving per-row attribute control in bitmap mode. In standard multicolor bitmap the attribute cell is 4×8 pixels (horizontal) by 8 pixels (vertical); FLI breaks the 8-scanline vertical grouping. With one screen RAM per raster row, the color cell shrinks to 4×1 in the limit: any pixel row can have its own per-cell colors.

Attribute clash drops sharply for the artist. Colors can change every scanline within a cell column. The cost is an 8-column-wide artifact strip on the left side (the FLI bug, or "FLI bar"): the CPU cannot swap the screen RAM pointer fast enough for the first 3 character columns on each row, which leaves a discolored band. Productions place the FLI bug in a black or off-screen area, cover it with a sprite overlay, or use it as part of the design.

FLI images use more CPU time (the IRQ handler must run on every raster line during the visible frame) and need careful memory layout, but photographic or painted content looks noticeably better than in plain multicolor bitmap. FLI is the standard format for high-quality C64 scene graphics.

### AFLI — Advanced FLI (Hires FLI)

AFLI applies the same per-row screen RAM substitution to standard hires bitmap mode. The attribute cell becomes 8×1 pixels, with two colors per cell on every scanline. Dithering between adjacent pairs simulates more colors. AFLI images look closest to 16-color dithered PC graphics. The CPU cost and the FLI bug are the same as in standard FLI.

### IFLI — Interlaced FLI

IFLI alternates two FLI frames on successive video fields, using the PAL display's 50 Hz interlace. Because PAL composite monitors blend adjacent fields, two slightly offset FLI images appear as one image with doubled vertical color resolution. The color cell approaches 4×0.5 pixels. On a real PAL monitor or a correctly configured PAL composite display this is the highest color fidelity on unmodified C64 hardware, close to photo quality.

The CPU is almost fully occupied by the dual-frame IRQ work, leaving little time for animation. IFLI is used almost only for standalone art viewers or competition entries where the image is the demo. The artist must paint in a tool that writes the dual-frame format directly (Multipaint supports IFLI export). On NTSC hardware IFLI fails: the interlace phase relationship differs and the fields do not blend correctly. IFLI is a PAL format.

---

## The 16-Color Palette as a Creative Palette

The C64's 16-color palette is fixed in hardware; there is no DAC register to remap colors. The 16 colors are: black, white, red, cyan, purple, green, blue, yellow, orange, brown, light red (pink), dark grey, medium grey, light green, light blue, light grey.

The palette has clear internal structure. The bright colors (yellow, light green, light blue, white) are high-luminance and high-saturation. They stand out in borders, logos and large fills but tire the eye quickly. The neutral range, black through the three greys to white, gives a five-step luminance ramp for shading and dithering. The middle group (brown, orange, red) has low chroma relative to its luminance and clashes with the saturated colors. Brown reads as desaturated; next to yellow or white it looks almost grey.

The most reliable contrast pairs differ in luminance rather than hue: black/white, black/yellow, black/light blue, blue/white. Cyan over red is a classic scene combination (high contrast, complementary hue); purple over light green works the same way. Do not place brown next to medium grey: the luminance step is too small to tell apart on composite output.

Dithering relies on the eye averaging adjacent colors. In multicolor mode the 4-pixel-wide pixel pitch is coarse enough that checkerboard patterns read as textures rather than blends at normal viewing distance; on composite, the narrow chroma bandwidth can produce visible fringing. The most effective C64 dithering patterns are horizontal stripes (alternating pixel rows) in hires mode, where composite vertical blending is stronger than horizontal. In FLI and IFLI modes, dithering is a primary way to extend the palette: per-scanline color control lets the artist bring in a new hue every row within a gradient.

PAL composite output produces chroma artifacts that artists use. Some color transitions produce a colored fringe (chroma phase interference) that adds a third perceived color not in the source palette. The effect depends on monitor and cable and does not appear on HDMI upscalers or clean S-Video. On real PAL hardware it is reliable; in a release meant for emulators it is a liability.

The PAL vs NTSC chroma difference affects palette choice: perceived colors differ between PAL and NTSC machines and between hardware revisions. Two palette references are in wide use: the Pepto palette (derived by Philip "Pepto" Timmermann from real-hardware measurement) and the Colodore palette (derived by Tobias "Colodore" from a different reference set). Pepto has slightly warmer reds; Colodore is cooler. Use Colodore for releases aimed at emulators (it is the default in recent VICE builds) and expect images to look slightly different on real hardware. Do not rely on exact hue relationships between the similar grey pairs or the similar browns; they vary most across chip revisions.

---

## Tools

### Multipaint

The modern cross-platform standard for C64 bitmap painting. Runs natively on Windows, macOS and Linux. Supports hires bitmap, multicolor bitmap (Koala), FLI, AFLI and IFLI modes. Exports the canonical file formats that assemblers and loaders consume. Its main production feature is live attribute clash display: pixels that would cause a color conflict in the current mode are flagged as the artist paints, so they can be fixed before export. Multipaint is available at multipaint.org. Complexity tier: intermediate (it assumes the mode concepts).

### Spritemate

A browser-based sprite editor that needs no installation or C64 toolchain. Supports single-color and multicolor sprite editing, copy/paste between sprite slots, and export to assembly source or binary data ready for Oscar64 or KickAssembler projects. Complexity tier: beginner.

### SpritePad

A native Windows sprite and animation editor, older than Spritemate. Supports up to 96 sprites in one project file, animation sequences, multicolor and hires modes, and preview over a bitmap or character screen. Exports to `.spd` project format and binary or assembly source. SpritePad is the standard tool in Windows-based scene groups. Complexity tier: beginner to intermediate.

### CharPad

The standard native Windows charset and tilemap editor. Manages the 256-tile budget, paints characters in multicolor or hires mode, assembles tiles into full-screen tilemaps, and exports screen RAM, Color RAM and character data as binary or assembly source. CharPad project files hold all tile and map data together. Complexity tier: intermediate.

### PETSCII Studio

A browser-based PETSCII art editor. The canvas is the ROM charset: the artist picks characters and colors and places them on the 40×25 grid, building images from box-drawing, reverse and symbol characters. Exports to PRG (direct screen memory load), assembly source or plain text. Complexity tier: beginner.

### ProjectOne

A cross-platform scene tool for building C64 screen layouts that combine sprites, characters, bitmaps and raster splits, mainly demo screens with several VIC-II modes in one frame. It is a layout compositor, not a pixel painter: it takes assets made in other tools and generates the screen RAM, sprite positioning data and raster split timing tables. Complexity tier: scene-tier.

### Historical Tools

Koala Painter was the original multicolor bitmap editor on the real C64. Its file format became the de facto standard for C64 painted graphics and is still the main interchange format. Advanced Art Studio followed with hires and multicolor support. Both run in VICE and are useful for checking that modern tool output matches hardware behavior; Multipaint has replaced them for new work.

---

## Sprite Art Principles

Each hardware sprite is 24×21 pixels in single-color mode. The pixel is square at the C64's pixel clock rate (approximately 320 pixels across the visible display), so a 24-pixel-wide sprite occupies roughly 18.75% of the display width. In multicolor sprite mode, pixels double in width: the canvas is 12×21 pixels at 2bpp. The two bits per pixel give three foreground colors at half the horizontal resolution.

In multicolor sprite mode, two global multicolor registers ($D025, $D026) are shared by all sprites, plus one per-sprite color from $D027–$D02E. All multicolor sprites therefore share the same two global colors: one sprite cannot have a red highlight and another a blue one through the multicolor slots. The per-sprite register is the only per-sprite color in this mode.

Hardware sprite stretching: $D01D doubles width (48 pixels); $D017 doubles height (42 pixels). Both together give a 48×42 sprite. Stretching adds no resolution; the same 63-byte pixel data renders at double scale. It suits large simple objects (explosions, large enemies) at no extra data cost.

When software opens the side border, sprites can extend across the full visible width, including areas normally covered by the border color. Art for border-open productions must plan sprite layouts over that wider range.

---

## Charset / Tilemap Art Principles

The VIC-II reads a charset of up to 256 characters, each 8×8 pixels in 8 bytes. In a 40×25 text screen, 1000 screen RAM bytes index into this charset; Color RAM gives the per-cell color. The 256-tile budget is absolute. Once all 256 tiles are used, a new visual element means reusing an existing tile.

In hires text mode each tile is one foreground color (from Color RAM) on the global background. In multicolor text mode, tiles can use up to four colors at half horizontal resolution. A screen can mix hires and multicolor characters by setting or clearing bit 3 of each Color RAM byte, so detailed hires outlines can sit next to filled multicolor areas on the same screen.

Raster IRQs allow per-row changes. Writing $D022/$D023 (the shared multicolor text colors) at scanline boundaries gives different horizontal bands different shared color pairs, multiplying the shared colors by the number of raster splits. The coder implements this, but the artist must design tiles knowing the shared colors may change between rows.

PETSCII art builds recognizable images from the ROM charset alone, with no custom tiles. The ROM charset holds alphanumeric characters, box-drawing characters and symbols that combine in ways their designers did not intend. Conventions: curves are approximated with diagonal box characters, shading comes from character density, and the reverse-video set doubles the available shapes. Tools like PETSCII Studio make this possible without assembly knowledge.

A custom charset for game tilemaps forces choices within the 256-tile budget. Ways to stretch it: tile mirroring in software (store only left-facing variants, flip sprites for the right-facing case), shared edge tiles (a tile designed to abut two different neighbors reduces the number of unique shapes), and palette rotation (vary Color RAM to reuse one tile shape in different colors). CharPad shows tile usage frequency so the artist can see where the budget goes.

---

## Bitmap Art Workflow

Production starts outside the C64 palette. The artist roughs out the composition in a modern paint program (Photoshop, Krita, Procreate) with a C64 palette swatch (Pepto or Colodore), to keep layers, undo history and modern brushes without working inside the attribute grid yet.

The rough is imported into Multipaint, which quantizes to the 16-color palette and maps the image into the target mode's attribute structure. The first quantized result has attribute clashes. Multipaint highlights them and the artist fixes them by hand: repainting pixels to respect cell boundaries, adjusting local colors, and giving up detail in complex areas. This pass often takes longer than any other part of bitmap art production.

Next the palette assignment is reviewed. Multipaint lets the artist swap which palette index goes to which cell attribute, without repainting. Moving a frequently used shadow color from a per-cell slot to a global background register (where the mode allows) frees cell slots for more varied local colors. In multicolor mode, assigning the colors that appear in the most cells to the global shared registers reduces clash.

Export writes the canonical binary files for the target format. For Koala, this is a single 10003-byte file. For FLI, it is a set of screen RAM pages plus the bitmap, usually managed by the editor. The files go in the project's asset directory and are linked into the build by the assembler or Oscar64's data embedding syntax. See `./asset-pipelines.md` for how assets move from export to ROM or disk.

Koala vs FLI vs IFLI trades quality against complexity. Koala is the default: least CPU overhead, widest compatibility, supported by every tool. FLI fits when Koala's attribute clash is unacceptable and the CPU budget allows the per-line IRQ cost. IFLI is for showcase pieces on PAL hardware where image quality is the only goal. A game almost never uses FLI or IFLI for play-field graphics; the CPU cost rules it out. A demo title screen or loader image may use any of the three, depending on the quality wanted and the group's tools.

---

## Cross-References

- `../techniques/bitmap-modes.md` — runtime rendering of hires bitmap, multicolor bitmap, FLI, AFLI, and IFLI; register enable sequences; cycle budgets.
- `../formats/c64-file-formats.md` — byte-level file format specifications for Koala, Art Studio, and other art tool formats.
- `./asset-pipelines.md` — how exported art assets are embedded into a C64 build using Oscar64 or KickAssembler; disk layout for multi-file productions.
