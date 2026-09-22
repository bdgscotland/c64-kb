<!-- doc-type: reference -->

# C64 Art Asset Pipelines

This document answers one narrow question: how does a file produced by an artist
or musician on a modern host — a Koala bitmap, a SpritePad sprite sheet, a CharPad
charset, a PETSCII screen, a GoatTracker song — become bytes that Oscar64 or
KickAssembler code can include at build time?

The artist side of the workflow is covered in `./art-production-reference.md`. The
music side is covered in `../music/music-production-reference.md`. The compression
and loading side is covered in `../techniques/loaders-packers.md`. The binary format
specifications are in `../formats/c64-file-formats.md`. This document sits between
those references and focuses purely on the conversion and integration step.

---

## Format breakdown per asset type

### Koala bitmap (.kla)

Koala Painter's native format is a 10003-byte file laid out as follows:

| Offset | Size   | Contents                                     |
|--------|--------|----------------------------------------------|
| 0x0000 | 2      | Load address (`$6000`, little-endian)        |
| 0x0002 | 8000   | Bitmap data (320×200, 2bpp multicolor)       |
| 0x1F42 | 1000   | Screen RAM (color pair per 4×8 cell)         |
| 0x232A | 1000   | Color RAM (third color per 4×8 cell)         |
| 0x2712 | 1      | Background color register value              |

The 2-byte load address is specific to Koala Painter's own load routine. Most C64
production pipelines discard it and place the three data regions independently:

- **Bitmap data (8000 bytes)** → typically at `$6000`, bank 1, VIC-visible
- **Screen RAM (1000 bytes)** → typically at `$5800` or `$0400`
- **Color RAM (1000 bytes)** → always at `$D800` (hardware-fixed)
- **Background byte (1 byte)** → written directly to `$D021` at runtime

For Oscar64, strip the 2-byte header and split the file into three `.bin` chunks
during the build. A Makefile recipe is shown in the worked examples below.

For KickAssembler, `.import binary` with an offset skips the header in-place:

```asm
* = $6000
.import binary "picture.kla", 2, 8000   ; bitmap, skip 2-byte header
* = $5800
.import binary "picture.kla", 8002, 1000 ; screen RAM
```

The 1000-byte color RAM chunk must be copied to `$D800` at runtime because the
C64's color memory is not directly addressable for `incbin`-style placement. A
tight loop or `memcpy`-style routine handles this before the VIC is switched to
multicolor bitmap mode.

**Byte-order note.** The Koala format uses no multi-byte fields beyond the load
address — all data regions are plain bytes. There is no endianness issue beyond
the load address itself.

**Multicolor cell layout.** Each 8×8 cell in the bitmap uses 2 bits per pixel,
packed high-bit-first within each byte. Bit pairs `%00`, `%01`, `%10`, `%11` map
to background, screen-RAM low nybble, screen-RAM high nybble, and color-RAM values
respectively. The cell ordering is left-to-right, top-to-bottom in reading order.
A converter that re-packs pixels must replicate this cell-major layout or the
image will display with scrambled columns.

---

### Sprites (.spd from SpritePad)

SpritePad's native `.spd` format stores a header followed by 64-byte sprite blocks.
SpritePad 2.x `.spd` files begin with a 9-byte header:

| Offset | Size | Contents                            |
|--------|------|-------------------------------------|
| 0x00   | 4    | Magic `"SPD"` + version byte        |
| 0x04   | 1    | Number of sprites minus one         |
| 0x05   | 1    | Number of animations minus one      |
| 0x06   | 1    | Multicolor flag (0=hires, 1=multi)  |
| 0x07   | 2    | Multicolor registers MC1, MC2       |

Each sprite immediately follows as a 64-byte block (63 bytes of pixel data + 1
byte containing the sprite color in the low nybble).

For production use, the typical path is:

1. Export from SpritePad as a raw binary (File → Export → Binary). SpritePad
   writes only the 64-byte blocks with no header, suitable for direct `incbin`.
2. If multiplexer tables are needed (Y-sort order, pointer lookup), generate them
   from a converter script at build time rather than by hand.

A sprite multiplexer expects a table of sprite data pointers. Each pointer is a
single byte giving the high byte of the sprite data address divided by 64 — the
value written to `$07F8`–`$07FF` (the VIC sprite data pointers at the default
screen location). For a contiguous 64-byte-aligned sprite bank starting at `$3000`:

```
sprite 0 data at $3000 → pointer byte = $3000 / 64 = $C0
sprite 1 data at $3040 → pointer byte = $C1
...
```

**Multicolor double-pixel padding.** In multicolor sprite mode, each pixel is 2
bits wide and displays as a double-width pixel — the physical sprite is 24 pixels
wide but displayed as 12 double-pixels. A converter tool porting hires art to
multicolor must halve the horizontal resolution. Direct incbin of a hires sprite
block into a multicolor slot produces the correct bit layout but the wrong visual —
no converter can recover lost horizontal detail, so multicolor sprites must be
authored at the correct reduced resolution.

---

### Charsets (.ctm from CharPad)

CharPad's native `.ctm` (CharPad Tilemap) format is a structured binary with a
32-byte header, followed by character data, attribute data, and optional tile/map
data. Drawing the tile and map data it carries is `tile_map_render` in
`../techniques/scroll.md`; the Oscar64 `#embed ctm_*` specifiers are in
`../toolchains/oscar64-reference.md`. For a charset-only extraction (no tiles):

- **Character data:** 8 bytes per character × N characters. A full 256-char
  charset is 2048 bytes.
- **Attribute data (CharPad 2.x):** 1 byte per character giving the character's
  color and attribute flags.

For most production work, CharPad's File → Export paths emit simpler outputs:

- **Characters binary:** raw 8-byte character data, 2048 bytes for a full charset.
  Load this at a VIC-visible address aligned to a 2KB boundary (e.g., `$2000`,
  `$2800`, `$3000`, `$3800`) by setting `$D018` bits 1–3.
- **Screen binary:** 1000-byte screen map (character indices for the 40×25 display).
  Load this into the VIC screen RAM region (`$0400` default, or another 1 KB
  boundary within the active bank).
- **Color binary:** 1000-byte color map for the screen. Must be copied to `$D800`
  at runtime, exactly as with Koala.

In Oscar64, these three exports become three `incbin` or `#pragma data` blocks.
KickAssembler places them with `.import binary` at the appropriate addresses.

**Alignment requirement.** The VIC-II reads character ROM or custom charset data
from addresses determined by `$D018` bits 1–3 (charset base) and bit 4 (screen
base). The charset must be aligned to a 2 KB boundary within the current VIC bank
(`$DD00` bits 0–1 select the bank). A charset placed at an odd address will
display as garbage — the alignment constraint must be enforced in the build script
or the linker config, not left to chance.

---

### PETSCII screens

A PETSCII screen consists of two 1000-byte arrays:

- **Screen RAM:** 40×25 bytes of character codes (PETSCII or screen codes,
  depending on the editor). KoalaPad, Marq's PETSCII Editor, and PetMate use
  screen codes (the VIC-II's native representation); terminal-mode PETSCII uses
  a different code point mapping.
- **Color RAM:** 40×25 bytes of color nybbles (low 4 bits used, high 4 ignored).

For PetMate and Marq's editor, File → Export → Binary produces a 2000-byte file
(screen + color concatenated) or two separate 1000-byte files. Either layout is
suitable for `incbin`. The color half must be `memcpy`'d to `$D800` at runtime.

Most PETSCII editors export with load addresses prepended. Strip 2 bytes from each
chunk as with Koala. Some editors export in SEQ or PRG format — use `dd` or a
small Python script to extract just the payload bytes.

---

### Music: GoatTracker (.sng) → usable output

GoatTracker 2 is the most common demoscene tracker for producing SID music in a
build pipeline. Its native format is `.sng` (a binary song file). The conversion
targets are:

**Option A: Standalone `.prg` with embedded player.** GoatTracker's `gt2reloc`
tool (included in the GoatTracker distribution) combines the song data with a
small SID player routine and produces a standalone `.prg`. This is useful for
quick playback testing or for dropping a complete music PRG into a multi-part demo
that loads it as a separate segment.

```bash
gt2reloc -f song.sng player.prg $1000
```

The second argument is the output `.prg` and the third is the base address where
the player+data will be placed in C64 memory. The player entry point is at the
specified base address; the init call is `JSR base` and the play call is
`JSR base+3` (standard SID player convention).

**Option B: Assembly include file for inline projects.** GoatTracker's `gt2asm`
converter emits a KickAssembler or 64tass-compatible `.asm` / `.inc` file
containing the song data as labeled byte tables and a small player stub. Import
this file into a KickAssembler project with `.import source "music.inc"` and call
the player entry points from the IRQ handler. This keeps everything in one
assembled `.prg` and avoids a separate load step.

For Oscar64, Option A is usually more practical: compile the music player as a
separate segment or load it as a raw binary at a known address, then call the
player entry points via function pointers or inline assembler.

---

## Conversion toolchain

### Standalone tools

| Tool | Input | Output | Notes |
|------|-------|--------|-------|
| SpritePad 2.x | .spd | raw sprite binary, .asm includes | GUI; built-in export |
| CharPad 2.x | .ctm | charset binary, screen binary, color binary | GUI; built-in export |
| Koala Painter (PC port) | .kla | n/a | Use strip-header script instead |
| koala-tools (CLI) | .kla | .bin chunks, C headers | Python; strips header, splits regions |
| gt2reloc | .sng | .prg (player + data) | GoatTracker distribution |
| gt2asm | .sng | .asm / .inc | GoatTracker distribution |
| Exomizer 3 | any binary | .exo stream or .prg with depacker | Compression; see below |
| c1541 | .d64 | individual files | Commodore disk image tool |

### Oscar64 native data inclusion

Oscar64's `#pragma data` and `__attribute__((aligned))` allow static byte arrays
to be placed at specific linker-controlled addresses. For small assets that do not
need to be VIC-bank-aligned, embedding data directly in the C source avoids an
extra conversion step:

```c
// Declares a byte array placed by the linker in the 'main' region.
// Address alignment must match VIC bank requirements if applicable.
__attribute__((section("charset"), aligned(0x800)))
static const unsigned char charset_data[] = {
#embed "charset_export.bin"
};
```

Oscar64 supports `#embed` (C23) for importing raw binary files at compile time.
This is suitable for assets under a few kilobytes. For larger assets or assets
that must be placed at hardware-constrained addresses, use a separate `.bin` with
the linker config or KickAssembler's `.import binary`.

### Custom Python/Node converter patterns

When the standard tool chain cannot produce the exact layout needed — address
remapping, palette quantization, table reordering — a short converter script is
the least-friction solution. The skeleton below handles the most common case:
strip a load-address header and split into named output chunks.

```python
#!/usr/bin/env python3
"""Strip a 2-byte load-address header and emit named chunks.
Usage: convert_koala.py picture.kla out/
"""
import sys
import pathlib

BITMAP_SIZE = 8000
SCREEN_SIZE = 1000
COLOR_SIZE  = 1000

src  = pathlib.Path(sys.argv[1]).read_bytes()
dest = pathlib.Path(sys.argv[2])
dest.mkdir(parents=True, exist_ok=True)

payload = src[2:]           # strip 2-byte load address
offset  = 0

(dest / "bitmap.bin").write_bytes(payload[offset : offset + BITMAP_SIZE])
offset += BITMAP_SIZE

(dest / "screen.bin").write_bytes(payload[offset : offset + SCREEN_SIZE])
offset += SCREEN_SIZE

(dest / "color.bin").write_bytes(payload[offset : offset + COLOR_SIZE])
offset += COLOR_SIZE

(dest / "bgcolor.bin").write_bytes(payload[offset : offset + 1])
print("Wrote bitmap, screen, color, bgcolor to", dest)
```

This pattern — read entire file, slice by known offsets, write named outputs —
applies to any format with a fixed layout. Extend it to emit a C header with
`__attribute__((section(...)))` declarations if the Oscar64 build benefits from
compile-time inclusion.

---

## Build-pipeline integration

### Makefile / build-script pattern

The canonical pattern for a C64 build with asset conversion is:

1. Artist commits source files (`.kla`, `.spd`, `.ctm`, `.sng`) to the repository.
2. A conversion step runs first, producing `.bin` / `.inc` artifacts in a build
   output directory.
3. The compiler or assembler references those artifacts via `#embed`, `.import
   binary`, or `incbin`.
4. The linker (Oscar64 integrated, or `ld65` for cc65) produces the final `.prg`.

This separation keeps source-controlled art in the artist's native format and the
build artifacts reproducible and disposable.

```makefile
BUILD    := build
SRC_ART  := art
SRC_MUS  := music
OSCAR64  := oscar64

# Asset conversion outputs
$(BUILD)/bitmap.bin $(BUILD)/screen.bin $(BUILD)/color.bin $(BUILD)/bgcolor.bin: \
    $(SRC_ART)/picture.kla | $(BUILD)
	python3 tools/convert_koala.py $< $(BUILD)

$(BUILD)/music_player.prg: $(SRC_MUS)/song.sng | $(BUILD)
	gt2reloc -f $< $@ $$1000

# Final PRG
$(BUILD)/game.prg: src/main.c \
    $(BUILD)/bitmap.bin $(BUILD)/screen.bin \
    $(BUILD)/color.bin $(BUILD)/bgcolor.bin \
    $(BUILD)/music_player.prg
	$(OSCAR64) -n -O2 -tf=prg $< -o $@

$(BUILD):
	mkdir -p $(BUILD)

clean:
	rm -rf $(BUILD)
```

Make's dependency tracking ensures that a changed `.kla` triggers re-conversion
and recompilation automatically. For projects with many assets, a per-asset
conversion pattern rule (`$(BUILD)/%.bin: $(SRC_ART)/%.kla`) reduces boilerplate.

### Common pitfalls

**Byte-order surprises with multi-byte table entries.** Any time a converter emits
16-bit values (sprite pointer tables, PRG load addresses, tilemap indices), verify
endianness. The 6502 is little-endian; a script that emits `struct.pack('>H', v)`
(big-endian) will produce a reversed pointer table that causes subtle crashes.
Use `struct.pack('<H', v)` for all 16-bit and 32-bit fields in 6502-targeted data.

**Color-RAM endianness.** Color RAM at `$D800` holds one nybble per cell. The
nybble is in the low 4 bits of each byte; the upper 4 bits are undefined on read.
Some older tools export color data with the color in the high nybble. A color
display that appears uniformly wrong (all cells one color, or all black) is
usually a nybble-position bug: `AND #$0F` or shift the data appropriately in the
converter.

**Multicolor sprite double-pixel padding.** A multicolor sprite cell is 24 bits
wide but displayed as 12 double-pixels. If the source sprite was drawn at 24-pixel
hires resolution and then converted by bit-packing pairs, the result will look
compressed horizontally. Multicolor sprites must be drawn at 12-pixel effective
width, stored as the standard 64-byte block format, and imported without horizontal
scaling. Document this constraint in the art brief so artists author at the correct
resolution.

**VIC bank and charset alignment.** The VIC-II can only address 16 KB at a time
(bank 0: `$0000`–`$3FFF`, bank 1: `$4000`–`$7FFF`, bank 2: `$8000`–`$BFFF`,
bank 3: `$C000`–`$FFFF`). Within a bank, charset data must start at a 2 KB
boundary and bitmap data at an 8 KB boundary. A build that places a charset at
`$2100` instead of `$2000` due to a missing `ALIGN` directive in the linker config
will display character corruption that has no obvious cause at runtime.

### Compression: Exomizer integration

For productions where disk space or RAM footprint is a constraint, Exomizer 3 is
the standard compression pass. Exomizer accepts any raw binary or PRG and produces
either a self-extracting PRG or a raw compressed stream for use with a separate
depacker. See `../techniques/loaders-packers.md` for the full operational details.

The key trade-off in an asset pipeline is decrunch time versus disk size:

- A Koala bitmap (10001 payload bytes) compresses to roughly 6000–7500 bytes with
  Exomizer, depending on the image content. Bitmaps with large solid areas compress
  better; dithered bitmaps approach incompressibility.
- Decrunch time for a 6 KB stream on a stock 6510 at 1 MHz is approximately
  0.3–0.5 seconds, imperceptible during a loading screen.
- A full sprite bank (e.g., 128 sprites × 64 bytes = 8192 bytes) typically
  compresses to around 4000–6000 bytes. Sprite data with animation frames sharing
  similar content compresses well.

Exomizer raw stream mode (`exomizer raw`) is used when the depacker is embedded in
the production code rather than prepended to the file:

```bash
exomizer raw -o bitmap.exo build/bitmap.bin
```

The depacker entry point and depacker code are linked into the production's PRG,
and the decompression call precedes the VIC switch-on. This avoids the overhead of
a separate self-extracting PRG layer when multiple assets are decompressed in
sequence.

---

## Worked examples

### Example 1: Koala bitmap → Oscar64 C header

This Makefile target converts a Koala file and produces a C header that Oscar64
can `#include`. The header declares `extern` arrays with section attributes that
the Oscar64 linker places at the correct VIC-visible addresses.

```makefile
# Makefile excerpt
$(BUILD)/koala.h: art/title.kla tools/koala_to_header.py | $(BUILD)
	python3 tools/koala_to_header.py $< $@
```

```python
#!/usr/bin/env python3
"""koala_to_header.py — emit an Oscar64-compatible C header from a Koala .kla file."""
import sys, pathlib

BITMAP_ADDR = 0x6000
SCREEN_ADDR = 0x5800
src = pathlib.Path(sys.argv[1]).read_bytes()
out = pathlib.Path(sys.argv[2])

payload = src[2:]  # strip load address
bitmap  = list(payload[0:8000])
screen  = list(payload[8000:9000])
color   = list(payload[9000:10000])
bgcolor = payload[10000]

def array(name, section, align, data):
    hex_vals = ", ".join(f"0x{b:02X}" for b in data)
    return (
        f'__attribute__((section("{section}"), aligned({align})))\n'
        f"static const unsigned char {name}[] = {{{hex_vals}}};\n\n"
    )

lines = ["#pragma once\n\n"]
lines.append(array("koala_bitmap", "bitmap",  0x2000, bitmap))
lines.append(array("koala_screen", "screen",  0x0400, screen))
lines.append(array("koala_color",  "color",   0x0001, color))
lines.append(f"static const unsigned char koala_bgcolor = 0x{bgcolor:02X};\n")
out.write_text("".join(lines))
```

In the C source, `#include "koala.h"` makes the arrays available. The linker
places each at its declared section address. The runtime code copies `koala_color`
to `$D800`, writes `koala_bgcolor` to `$D021`, and enables multicolor bitmap mode
via `$D011`/`$D016`/`$D018`.

---

### Example 2: GoatTracker → KickAssembler include flow

```bash
# 1. Convert song to assembly include
gt2asm -f song.sng music.inc $1000

# 2. KickAssembler source fragment
.pc = $1000 "Music"
.import source "music.inc"

# 3. In the IRQ handler (after stable raster setup):
#    JSR $1000   ; init (call once at startup, A = song number 0)
#    JSR $1003   ; play (call every frame from IRQ)
```

`gt2asm` emits the player code and song data as labeled tables. The player exposes
a three-entry-point interface: `init` at base, `play` at base+3, and `stop` at
base+6. The song data follows immediately after the player code within the same
`.inc` file. The result is a single `.import source` that brings in both code and
data, with no separate binary file needed in the build.

---

### Example 3: Sprite sheet converter skeleton

This skeleton reads a SpritePad raw binary export (64 bytes per sprite, no header)
and emits a C array plus a pointer table for an 8-sprite multiplexer. It produces
one `.h` file.

```python
#!/usr/bin/env python3
"""spd_to_header.py — SpritePad raw binary → Oscar64 sprite table header.
Usage: spd_to_header.py sprites.bin $3000 out/sprites.h
"""
import sys, pathlib, struct

SPRITE_BYTES = 64
src_path   = pathlib.Path(sys.argv[1])
base_addr  = int(sys.argv[2], 16)
out_path   = pathlib.Path(sys.argv[3])

raw   = src_path.read_bytes()
count = len(raw) // SPRITE_BYTES

sprites = [raw[i*SPRITE_BYTES:(i+1)*SPRITE_BYTES] for i in range(count)]

# VIC sprite pointer = (base_addr + i*64) / 64
pointers = [(base_addr // 64) + i for i in range(count)]

lines = ["#pragma once\n\n"]
lines.append(f"#define SPRITE_COUNT {count}\n\n")

hex_data = ", ".join(f"0x{b:02X}" for sprite in sprites for b in sprite)
lines.append(
    f'__attribute__((section("sprites"), aligned(64)))\n'
    f"static const unsigned char sprite_data[{count * SPRITE_BYTES}] = {{{hex_data}}};\n\n"
)

ptr_vals = ", ".join(str(p) for p in pointers)
lines.append(
    f"static const unsigned char sprite_ptrs[{count}] = {{{ptr_vals}}};\n"
)

out_path.write_text("".join(lines))
print(f"Converted {count} sprites from {src_path.name}")
```

The alignment constraint `aligned(64)` ensures the Oscar64 linker places the sprite
bank at a 64-byte boundary, making the pointer arithmetic (`address / 64`) exact.
If the linker does not honor the 64-byte alignment (verify with the `.map` output),
add a dedicated linker segment with an explicit start address.

---

## Cross-references

- `./art-production-reference.md` — upstream: art tool workflows, canvas setup,
  multicolor vs hires decisions, PETSCII editor workflows.
- `../music/music-production-reference.md` — upstream: GoatTracker composition,
  SID voice routing, tracker export settings.
- `../techniques/loaders-packers.md` — compression (Exomizer, ByteBoozer, WCF)
  and fast-loader integration for asset streaming.
- `../formats/c64-file-formats.md` — authoritative byte-level specifications for
  `.prg`, `.d64`, and raw binary formats referenced here.
