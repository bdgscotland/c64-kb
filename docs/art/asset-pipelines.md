<!-- doc-type: reference -->

# C64 Art Asset Pipelines

How a file an artist or musician makes on a modern host (a Koala bitmap, a
SpritePad sprite sheet, a CharPad charset, a PETSCII screen, a GoatTracker song)
becomes bytes that Oscar64 or KickAssembler code can include at build time.

The artist side is in `./art-production-reference.md`, the music side in
`../music/music-production-reference.md`, compression and loading in
`../techniques/loaders-packers.md`, and the binary format specifications in
`../formats/c64-file-formats.md`. This page covers only the conversion and
integration step between them.

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
short loop or `memcpy`-style routine copies it before the VIC is switched to
multicolor bitmap mode.

**Byte-order note.** The Koala format has no multi-byte field except the load
address; all data regions are plain bytes.

**Multicolor cell layout.** Each 8×8 cell in the bitmap uses 2 bits per pixel,
packed high-bit-first within each byte. Bit pairs `%00`, `%01`, `%10`, `%11` map
to background, screen-RAM high nybble, screen-RAM low nybble, and color-RAM values
respectively. An earlier version of this paragraph had the two screen-RAM nybbles
the other way round; decoding a png2prg Koala file against its source image gave
0 wrong pixels with this order and 16,000 of 32,000 with the old one, and VICE
showed the file pixel-exact (see [png2prg](../toolchains/png2prg.md), "Round trip,
measured"). The cell ordering is left-to-right, top-to-bottom in reading order.
A converter that re-packs pixels must keep this cell-major layout or the image
displays with scrambled columns.

---

### Sprites (.spd from SpritePad)

SpritePad's native `.spd` format stores a header followed by 64-byte sprite blocks.
**Correction (2026-09-23).** The 9-byte table below is the version 1 layout, and its byte at `0x06` is the transparent colour, not a multicolour flag (the version 1 meaning is read from Oscar64's reader, not measured here: no version 1 file was found); the version 5 files SpritePad Pro writes and Oscar64 embeds have a 20-byte header with two-byte counts, decoded per version in `../formats/c64-file-formats.md` under `.SPD`.
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

For production use, the usual path is:

1. Export from SpritePad as a raw binary (File → Export → Binary). SpritePad
   writes only the 64-byte blocks with no header, suitable for direct `incbin`.
2. If multiplexer tables are needed (Y-sort order, pointer lookup), generate them
   from a converter script at build time rather than by hand.

A sprite multiplexer expects a table of sprite data pointers. Each pointer is a
single byte giving the high byte of the sprite data address divided by 64: the
value written to `$07F8`–`$07FF` (the VIC sprite data pointers at the default
screen location). For a contiguous 64-byte-aligned sprite bank starting at `$3000`:

```
sprite 0 data at $3000 → pointer byte = $3000 / 64 = $C0
sprite 1 data at $3040 → pointer byte = $C1
...
```

**Multicolor double-pixel padding.** In multicolor sprite mode, each pixel is 2
bits wide and displays as a double-width pixel: the physical sprite is 24 pixels
wide but displayed as 12 double-pixels. A converter porting hires art to
multicolor must halve the horizontal resolution. Direct incbin of a hires sprite
block into a multicolor slot gives the correct bit layout but the wrong picture.
No converter can recover lost horizontal detail, so multicolor sprites must be
drawn at the reduced resolution.

---

### Charsets (.ctm from CharPad)

CharPad's native `.ctm` (CharPad Tilemap) format is a structured binary with a
32-byte header, followed by character data, attribute data, and optional tile/map
data. **Correction (2026-09-23).** No decoded file has a 32-byte header: version 5 has 20 bytes and version 8 has 14 (both decoded from files), and version 9 has 19 (read from Oscar64's reader, not measured here), followed by marker-framed sections whose presence depends on the flags and colouring method; the per-version field tables are in `../formats/c64-file-formats.md` under `.CTM`. Drawing the tile and map data it carries is `tile_map_render` in
`../techniques/scroll.md`; the Oscar64 `#embed ctm_*` specifiers are in
`../toolchains/oscar64-reference.md`. For a charset-only extraction (no tiles):

- **Character data:** 8 bytes per character × N characters. A full 256-char
  charset is 2048 bytes.
- **Attribute data (CharPad 2.x):** 1 byte per character giving the character's
  color and attribute flags.

For most production work, CharPad's File → Export paths give simpler outputs:

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
from addresses determined by `$D018` bits 1–3 (charset base) and bits 4–7 (screen
base). (An earlier version said bit 4 alone selects the screen base; the video
matrix field is bits 4–7, per `../hardware/vic-ii-reference.md`.) The charset must be aligned to a 2 KB boundary within the current VIC bank
(`$DD00` bits 0–1 select the bank). A charset at a misaligned address displays as
garbage, so enforce the alignment in the build script or the linker config.

---

### PETSCII screens

A PETSCII screen consists of two 1000-byte arrays:

- **Screen RAM:** 40×25 bytes of character codes (PETSCII or screen codes,
  depending on the editor). Marq's PETSCII Editor and PetMate use screen codes
  (the VIC-II's native representation); terminal-mode PETSCII uses a different
  code point mapping. (An earlier version also listed KoalaPad here; KoalaPad is
  a graphics tablet, and its Koala Painter software edits multicolor bitmaps,
  not PETSCII screens.)
- **Color RAM:** 40×25 bytes of color nybbles (low 4 bits used, high 4 ignored).

For PetMate and Marq's editor, File → Export → Binary produces a 2000-byte file
(screen + color concatenated) or two separate 1000-byte files. Either works with
`incbin`. The color half must be `memcpy`'d to `$D800` at runtime.

Most PETSCII editors export with load addresses prepended. Strip 2 bytes from each
chunk as with Koala. Some editors export in SEQ or PRG format; use `dd` or a
small Python script to extract the payload bytes.

---

### Music: GoatTracker (.sng) → usable output

GoatTracker 2 is the most common cross-platform tracker for SID music in a
build pipeline. Its native format is `.sng`, a binary song file; the field
table is in `../formats/c64-file-formats.md` under `.SNG`. The tracker does not
export source code. Its one export is the packer/relocator, reached with F9 in
the editor or as the standalone `gt2reloc` utility, and it writes one of three
things, chosen by the extension of the output file name:

| Extension | Contents |
|-----------|----------|
| `.prg` | two-byte load address, then the player code and the packed song data |
| `.bin` | the same bytes without the load address |
| `.sid` | a PSID v2 header (`$7C` bytes), then the `.prg` bytes |

**Option A: Standalone `.prg` with embedded player.**

```bash
gt2reloc song.sng music.prg -W10 -ZFC
```

`-Wxx` is the player address high byte in hex (default `10`, so `$1000`) and
`-Zxx` the first of the two zero-page bytes the player uses (default `$FC`).
There is no positional address argument. The other options that matter in a
game build are `-B1` buffered SID writes, `-D1` sound-effect support, `-E1`
volume-change support, `-H1` store the author string at `base+$20`, `-N` NTSC
timing and `-Sx` the speed multiplier; `gt2reloc -?` lists them all. The
relocator drops unused patterns, instruments, table rows and player code, so
the output size depends on the song. Measured with `gt2reloc` built from the
GoatTracker 2.77 source (its banner says v2.73): the distribution's
`consultant.sng` gives 1,786 bytes at `$1000` (1,119 of them player) and a
1,788-byte `.prg`; `dojo.sng` gives 2,655 bytes.

The player's jump table is at the start of the output: `JSR base` with the
subtune number in A (from 0) initialises, `JSR base+3` plays one frame. A third
entry at `base+6` exists only when `-D1` or `-E1` compiled it in (sound effect,
or volume; with both, volume is at `base+9`). There is no stop entry. The full
call contract, zero-page use and ghost-register copy loop are in the
`goattracker_player_api` entry of the SID techniques page under
`../techniques/`.

**Option B: Inline in a KickAssembler build.** Write a `.bin` (or `.prg`) and
import it at the address it was relocated for:

```text
.pc = $1000 "music"
.import binary "music.bin"      ; relocated with -W10
```

or write a `.sid` and let KickAssembler read the header:

```text
.var music = LoadSid("music.sid")
.pc = music.location "music"
.fill music.size, music.getData(i)
// music.init and music.play hold the entry addresses
```

Both fragments were assembled with KickAssembler 5.25 against `dojo.sng`
relocated to `$1000`; each produced a file byte-identical to the relocator's
own `.prg`. For Oscar64 the `.bin` goes in through `#embed` into an array
placed at the relocation address (see "Oscar64 native data inclusion" below),
or the `.prg` is loaded as a separate file and called through a function
pointer.

**Correction (2026-09-23).** An earlier version of this section named a
`gt2asm` converter that emits a `.asm`/`.inc` file with the song as labelled
tables. No such utility exists: the GoatTracker 2.77 distribution ships
`goattrk2` (the editor), `gt2reloc` (the packer/relocator), `ins2snd2`
(instrument to sound-effect data), `sngspli2` (pattern splitter) and `mod2sng`
(MOD import), and its makefile builds nothing else. The same text gave
`gt2reloc` a `-f` flag and a positional `$1000` argument, which it does not
accept, and a `stop` entry at `base+6`, which is the sound-effect or volume
entry when compiled in.

---

## Conversion toolchain

### Standalone tools

| Tool | Input | Output | Notes |
|------|-------|--------|-------|
| SpritePad 2.x | .spd | raw sprite binary, .asm includes | GUI; built-in export |
| CharPad 2.x | .ctm | charset binary, screen binary, color binary | GUI; built-in export |
| Koala Painter (PC port) | .kla | n/a | Use strip-header script instead |
| koala-tools (CLI) | .kla | .bin chunks, C headers | Python; strips header, splits regions |
| gt2reloc | .sng | .prg / .bin (player + data), .sid | GoatTracker 2 distribution; format chosen by output extension |
| ins2snd2 | .ins | sound-effect data as DASM-style source or binary (`-b`) | GoatTracker 2 distribution; an earlier row here named a `gt2asm` .sng-to-include converter, which does not exist |
| Exomizer 3 | any binary | .exo stream or .prg with depacker | Compression; see below |
| c1541 | .d64 | individual files | Commodore disk image tool |
| [png2prg](../toolchains/png2prg.md) 1.12 | .png (C64 palette, cell rules already met) | Koala, hires, charset, sprite .prg; optional self-running viewer | CLI; refuses colour clashes and a 17th colour instead of fixing them |
| [sidreloc](../toolchains/sidreloc.md) 1.0 | .sid | .sid moved by whole pages, zero page remapped | CLI; for tunes you have only as a `.sid`; checks its own output |

### Oscar64 native data inclusion

Oscar64 places data with pragmas: `#pragma section` and `#pragma region` fix an
address, `#pragma data` sends the following globals there, and `#pragma align`
aligns one symbol (see `../toolchains/oscar64-reference.md`, "Memory layout and
banking"). Embedding the data in the C source saves a conversion step. This
block puts a charset at `$2000`, a 2 KB boundary in VIC bank 0:

```c
// Split the default main region around $2000-$27FF.
#pragma region( lower, 0x0880, 0x2000, , , {code, data} )
#pragma section( charset, 0 )
#pragma region( charset, 0x2000, 0x2800, , , {charset} )
#pragma region( main, 0x2800, 0xa000, , , {code, data, bss, heap, stack} )

#pragma data( charset )
// __export keeps it: the VIC reads it, but no C code names it.
__export const unsigned char charset_data[2048] = {
#embed "charset_export.bin"
};
#pragma data( data )
```

When any 2 KB boundary will do, `#pragma align( charset_data, 2048 )` after the
declaration lets the linker choose; read the address from the `.map` file.
Both forms were compiled with Oscar64 (`-tm=c64 -O2 -n`); the `.map` put the
array at `$2000` and at `$1000`, and the `.prg` held the embedded bytes there.
(An earlier version wrote this block, and the generated headers below, with
GCC's `__attribute__((section(...), aligned(...)))`. Oscar64 rejects it:
`error 3005: Identifier not defined '__attribute__'`.)

Oscar64 supports `#embed` (C23) for importing raw binary files at compile time,
suitable for assets under a few kilobytes. For larger assets or assets
that must be placed at hardware-constrained addresses, use a separate `.bin` with
the linker config or KickAssembler's `.import binary`.

### Custom Python/Node converter patterns

When the standard tools cannot produce the layout needed (address remapping,
palette quantization, table reordering), write a short converter script. The
skeleton below covers the most common case: strip a load-address header and split
the file into named output chunks.

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

The same pattern (read the file, slice at known offsets, write named outputs)
works for any format with a fixed layout. Extend it to emit a C header with
`#pragma section` / `#pragma region` / `#pragma data` placement (Example 1
below) if the Oscar64 build benefits from compile-time inclusion.

---

## Build-pipeline integration

### Makefile / build-script pattern

A C64 build with asset conversion runs in this order:

1. Artist commits source files (`.kla`, `.spd`, `.ctm`, `.sng`) to the repository.
2. A conversion step runs first, producing `.bin` / `.inc` artifacts in a build
   output directory.
3. The compiler or assembler references those artifacts via `#embed`, `.import
   binary`, or `incbin`.
4. The linker (Oscar64 integrated, or `ld65` for cc65) produces the final `.prg`.

Source control holds the art in the artist's native format; the build artifacts
are reproducible and disposable.

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
	gt2reloc $< $@ -W10

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

Make's dependency tracking re-converts and recompiles when a `.kla` changes. For projects with many assets, a per-asset
conversion pattern rule (`$(BUILD)/%.bin: $(SRC_ART)/%.kla`) reduces boilerplate.

### Common pitfalls

**Byte-order surprises with multi-byte table entries.** Any time a converter emits
16-bit values (sprite pointer tables, PRG load addresses, tilemap indices), check
endianness. The 6502 is little-endian; a script that emits `struct.pack('>H', v)`
(big-endian) produces a byte-swapped pointer table and crashes that are hard to
trace.
Use `struct.pack('<H', v)` for all 16-bit and 32-bit fields in 6502-targeted data.

**Color-RAM endianness.** Color RAM at `$D800` holds one nybble per cell. The
nybble is in the low 4 bits of each byte; the upper 4 bits are undefined on read.
Some older tools export color data with the color in the high nybble. A color
display that is uniformly wrong (all cells one color, or all black) is usually a
nybble-position bug: `AND #$0F` or shift the data appropriately in the
converter.

**Multicolor sprite double-pixel padding.** A multicolor sprite cell is 24 bits
wide but displayed as 12 double-pixels. If the source sprite was drawn at 24-pixel
hires resolution and then converted by bit-packing pairs, the result looks
compressed horizontally. Multicolor sprites must be drawn at 12-pixel effective
width, stored as the standard 64-byte block format, and imported without horizontal
scaling. Put this constraint in the art brief so artists draw at the right
resolution.

**VIC bank and charset alignment.** The VIC-II can only address 16 KB at a time
(bank 0: `$0000`–`$3FFF`, bank 1: `$4000`–`$7FFF`, bank 2: `$8000`–`$BFFF`,
bank 3: `$C000`–`$FFFF`). Within a bank, charset data must start at a 2 KB
boundary and bitmap data at an 8 KB boundary. A build that places a charset at
`$2100` instead of `$2000` because of a missing `ALIGN` directive in the linker
config shows corrupted characters with no obvious cause at runtime.

### Compression: Exomizer integration

Where disk space or RAM is short, Exomizer 3 is the standard compression pass. Exomizer accepts any raw binary or PRG and produces
either a self-extracting PRG or a raw compressed stream for use with a separate
depacker. See `../techniques/loaders-packers.md` for the full operational details.

The trade-off in an asset pipeline is decrunch time against disk size:

- A Koala bitmap (10001 payload bytes) compresses to roughly 6000–7500 bytes with
  Exomizer, depending on the image content. Bitmaps with large solid areas compress
  better; dithered bitmaps barely compress.
- Decrunch time for a 6 KB stream on a stock 6510 at 1 MHz is approximately
  0.3–0.5 seconds, imperceptible during a loading screen.
- A full sprite bank (e.g., 128 sprites × 64 bytes = 8192 bytes) compresses to
  around 4000–6000 bytes. Animation frames with similar content compress well.

Exomizer raw stream mode (`exomizer raw`) is used when the depacker is embedded in
the production code rather than prepended to the file:

```bash
exomizer raw -o bitmap.exo build/bitmap.bin
```

The depacker code and entry point are linked into the production's PRG, and the
decompression call comes before the VIC switch-on. When several assets are
decompressed in sequence, this avoids a separate self-extracting PRG layer for
each.

---

## Worked examples

### Example 1: Koala bitmap → Oscar64 C header

This Makefile target converts a Koala file into a C header that Oscar64 can
`#include`. The header defines the bitmap and screen arrays inside
`#pragma region` blocks at fixed VIC-visible addresses in bank 1, and moves the
default main region out of their way.

```makefile
# Makefile excerpt
$(BUILD)/koala.h: art/title.kla tools/koala_to_header.py | $(BUILD)
	python3 tools/koala_to_header.py $< $@
```

```python
#!/usr/bin/env python3
"""koala_to_header.py — emit an Oscar64-compatible C header from a Koala .kla file."""
import sys, pathlib

SCREEN_ADDR = 0x5800   # VIC bank 1: screen at +$1800
BITMAP_ADDR = 0x6000   # bitmap at +$2000, the only 8 KB boundary left in the bank
src = pathlib.Path(sys.argv[1]).read_bytes()
out = pathlib.Path(sys.argv[2])

payload = src[2:]  # strip load address
bitmap  = list(payload[0:8000])
screen  = list(payload[8000:9000])
color   = list(payload[9000:10000])
bgcolor = payload[10000]

def hexes(data):
    return ", ".join(f"0x{b:02X}" for b in data)

def placed(name, addr, data):
    # One section and one region per array, at a fixed address.
    # __export keeps it: the VIC reads it, no C code names it.
    return (
        f"#pragma section( {name}_sec, 0 )\n"
        f"#pragma region( {name}_reg, 0x{addr:04X}, 0x{addr + len(data):04X}, , , {{{name}_sec}} )\n"
        f"#pragma data( {name}_sec )\n"
        f"__export const unsigned char {name}[{len(data)}] = {{{hexes(data)}}};\n"
        f"#pragma data( data )\n\n"
    )

lines = ["#pragma once\n\n",
         # Move the default main region ($0880-$9000) out of $5800-$7F40.
         f"#pragma region( lower, 0x0880, 0x{SCREEN_ADDR:04X}, , , {{code, data}} )\n",
         "#pragma region( main, 0x8000, 0xa000, , , {code, data, bss, heap, stack} )\n\n"]
lines.append(placed("koala_bitmap", BITMAP_ADDR, bitmap))
lines.append(placed("koala_screen", SCREEN_ADDR, screen))
lines.append(f"static const unsigned char koala_color[1000] = {{{hexes(color)}}};\n")
lines.append(f"static const unsigned char koala_bgcolor = 0x{bgcolor:02X};\n")
out.write_text("".join(lines))
```

In the C source, `#include "koala.h"` makes the arrays available. The linker
places the bitmap at `$6000` and the screen at `$5800`; `koala_color` stays in
the default data section because it is copied. The runtime code copies `koala_color`
to `$D800`, writes `koala_bgcolor` to `$D021`, and enables multicolor bitmap mode
via `$D011`/`$D016`/`$D018`. The script was run on a 10,003-byte test file
and the header compiled with Oscar64 (`-tm=c64 -O2 -n`) into a program that
copies `koala_color`; the `.prg` held the bitmap bytes at `$6000` and the screen
bytes at `$5800`. The earlier version emitted `__attribute__` declarations
(rejected by Oscar64, see above) and never used its two address constants.

---

### Example 2: GoatTracker → KickAssembler import flow

```text
# 1. Pack and relocate the song to $1000 as a headerless binary
gt2reloc song.sng music.bin -W10

# 2. KickAssembler source fragment
.pc = $1000 "Music"
.import binary "music.bin"

# 3. In the IRQ handler (after stable raster setup):
#    LDA #0        ; subtune number
#    JSR $1000     ; init, once at startup
#    JSR $1003     ; play, every frame from the IRQ
```

The relocator's output is player code followed by the packed song data, with
the jump table first: `init` at base and `play` at base+3. A third entry is
present only when the song was packed with sound-effect (`-D1`) or volume
(`-E1`) support. One `.import binary` brings in code and data together, so no
separate load step is needed; the block must sit at the address given to
`-W`, because the player is not position-independent. An earlier version of
this example ran a `gt2asm` converter and imported its output with
`.import source`; no such converter exists in the GoatTracker 2 distribution,
and the `stop` entry it described at base+6 is not in the player's jump table.

---

### Example 3: Sprite sheet converter skeleton

This skeleton reads a SpritePad raw binary export (64 bytes per sprite, no header)
and emits a C array plus a pointer table for an 8-sprite multiplexer, in one `.h`
file.

```python
#!/usr/bin/env python3
"""spd_to_header.py — SpritePad raw binary → Oscar64 sprite table header.
Usage: spd_to_header.py sprites.bin $3000 out/sprites.h
"""
import sys, pathlib, struct

SPRITE_BYTES = 64
src_path   = pathlib.Path(sys.argv[1])
base_addr  = int(sys.argv[2].lstrip("$"), 16)
out_path   = pathlib.Path(sys.argv[3])

raw   = src_path.read_bytes()
count = len(raw) // SPRITE_BYTES
end   = base_addr + count * SPRITE_BYTES

sprites = [raw[i*SPRITE_BYTES:(i+1)*SPRITE_BYTES] for i in range(count)]

# VIC sprite pointer = offset of the block inside its 16 KB bank / 64
pointers = [((base_addr & 0x3FFF) // 64) + i for i in range(count)]

lines = ["#pragma once\n\n"]
lines.append(f"#define SPRITE_COUNT {count}\n\n")

# Place the sheet at base_addr: split the default main region around it.
lines.append(
    f"#pragma region( lower, 0x0880, 0x{base_addr:04X}, , , {{code, data}} )\n"
    f"#pragma section( sprites, 0 )\n"
    f"#pragma region( sprites, 0x{base_addr:04X}, 0x{end:04X}, , , {{sprites}} )\n"
    f"#pragma region( main, 0x{end:04X}, 0xa000, , , {{code, data, bss, heap, stack}} )\n\n"
)

hex_data = ", ".join(f"0x{b:02X}" for sprite in sprites for b in sprite)
lines.append(
    "#pragma data( sprites )\n"
    f"__export const unsigned char sprite_data[{count * SPRITE_BYTES}] = {{{hex_data}}};\n"
    "#pragma data( data )\n\n"
)

ptr_vals = ", ".join(str(p) for p in pointers)
lines.append(
    f"static const unsigned char sprite_ptrs[{count}] = {{{ptr_vals}}};\n"
)

out_path.write_text("".join(lines))
print(f"Converted {count} sprites from {src_path.name}")
```

The `sprites` region puts the sheet at the address given on the command line,
so the pointer table matches it; the address must be a multiple of 64. Run
with `$3000` on a 512-byte test file and compiled with Oscar64, the `.map` put
`sprite_data` at `$3000` and the pointers came out 192–199. The earlier version
only aligned the array to 64 bytes with `__attribute__` (rejected by Oscar64),
which does not put it at `base_addr`; it also computed pointers as
`base_addr / 64`, wrong outside bank 0 (a pointer is the offset inside the
16 KB bank / 64), and could not parse the `$3000` its usage line shows.

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
