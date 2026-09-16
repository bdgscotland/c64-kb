---
recipe: bitmap-koala-viewer
toolchain: oscar64
output_format: PRG
region: both
techniques: [koala_format, multicolor_bitmap]
file_formats: [PRG]
uses_registers: [D011, D016, D018, D020, D021]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 Koala Bitmap Viewer

## Synopsis

Loads a Koala Painter `.kla` file embedded at compile time via `#embed`,
copies the three memory regions to their correct VIC-II addresses, and
enables multicolor bitmap mode. The result is a full-screen 160x200
multicolor image displayed on a stock C64 using only the standard 16 KB VIC
bank 0 layout: bitmap at `$2000`, screen RAM at `$0400`, Color RAM at `$D800`.
This is the canonical Oscar64 starting point for any program that needs to
show precomputed C64 artwork as a background layer. It implements the
`koala_format` and `multicolor_bitmap` techniques from
`docs/techniques/bitmap-modes.md`.

## Source

```c
// bitmap-koala-viewer.c
//
// Displays a Koala Painter .kla image embedded at compile time.
// Memory layout:
//   Bitmap data:  $2000-$3F3F  (8000 bytes, VIC bank 0, CB2=1)
//   Screen RAM:   $0400-$07E7  (1000 bytes, VIC bank 0, VM=0001)
//   Color RAM:    $D800-$DBE7  (1000 bytes, fixed hardware address)
//   Background:   $D021        (1 byte, from Koala file byte 10002)
//
// Koala file format (10003 bytes with 2-byte load address):
//   $0000-$0001  load address (little-endian, typically $6000; we ignore it)
//   $0002-$1F41  bitmap data (8000 bytes)
//   $1F42-$232B  screen RAM  (1000 bytes)
//   $232C-$2713  Color RAM   (1000 bytes)
//   $2714        background color byte
//
// Replace "image.kla" with any Koala file to display different artwork.
//
#include <c64/vic.h>
#include <c64/memmap.h>
#include <string.h>

// ---------------------------------------------------------------------------
// Memory layout pragmas
// ---------------------------------------------------------------------------
// Bitmap lives at $2000-$3F40 inside VIC bank 0.
// Place code and data below $2000, bitmap at $2000, everything else above.
#pragma region( lower, 0x0a00, 0x2000, , , {code, data} )

#pragma section( bitmap, 0 )
#pragma region( bitmap_region, 0x2000, 0x4000, , , {bitmap} )

#pragma region( upper, 0x4000, 0xa000, , , {code, data, bss, heap, stack} )

// ---------------------------------------------------------------------------
// Embedded Koala file
// ---------------------------------------------------------------------------
// The full 10003-byte .kla file (including the 2-byte load-address header)
// is embedded here.  The viewer extracts each region by known byte offsets.
//
// To embed a real file: replace "image.kla" with its path.
// A stub image of all zeros is provided so the recipe compiles without a file.
//
// Real use:
//   static const char koala_file[] = { #embed "image.kla" };
//
// Stub (displays a solid background-colored screen):
static const char koala_file[10003] = {0};  // all zeros

// Offset constants for the Koala layout (skipping the 2-byte load address)
#define KLA_BITMAP_OFFSET   2
#define KLA_SCREEN_OFFSET   (KLA_BITMAP_OFFSET + 8000)    // 8002
#define KLA_COLOR_OFFSET    (KLA_SCREEN_OFFSET + 1000)    // 9002
#define KLA_BGCOL_OFFSET    (KLA_COLOR_OFFSET  + 1000)    // 10002

// ---------------------------------------------------------------------------
// Bitmap destination (placed at $2000 by the bitmap_region linker region)
// ---------------------------------------------------------------------------
// The #pragma data(bitmap) directive routes this array into the bitmap section.
// The linker region bitmap_region spans $2000-$4000, so bitmap_dest lands at $2000.
#pragma data(bitmap)
static char bitmap_dest[8000];
#pragma data(data)

// Screen RAM and Color RAM pointers
static byte * const Screen = (byte *)0x0400;
static byte * const Color  = (byte *)0xd800;

// ---------------------------------------------------------------------------
// Enable multicolor bitmap mode
// ---------------------------------------------------------------------------
// $D011 bit 5 (BMM): enable bitmap mode.
// $D016 bit 4 (MCM): enable multicolor (2-bit pixel interpretation).
// $D018:   VM bits 7-4 = 0001 (screen RAM at bank offset $0400)
//          CB bit 3    = 1    (bitmap at bank offset $2000)
//          Result: $D018 = 0001_1_000 = $18.
// $D021: background color (Koala %00 pattern color, from file byte 10002).
// $D020: border color, set to match background for a clean frameless look.
static void display_enable(byte bgcol)
{
    // Write background color register first (before mode bits) to avoid
    // a single-frame flash of the wrong background while the mode is enabling.
    vic.color_back   = (VICColors)bgcol;
    vic.color_border = (VICColors)bgcol;

    // $D018: VM = %0001 (screen RAM at $0400 = bank offset $0400 / 1024 = 1)
    //        CB2 = 1    (bitmap at $2000 = bank offset $2000 / 8192 = 1)
    // Bit layout of $D018: [VM3][VM2][VM1][VM0][CB2][0][0][0]
    //   VM = 0001 -> bits 7-4 = 0001 -> $10
    //   CB2 = 1   -> bit 3   = 1    -> $08
    //   Combined: $18
    vic.memptr = 0x18;

    // Enable BMM + YSCROLL=3 (default), keep other $D011 bits.
    // Reading $D011 at this point is safe; the raster may be anywhere but
    // the mode bits take effect at the next line boundary.
    vic.ctrl1 = (vic.ctrl1 & ~(VIC_CTRL1_ECM)) | VIC_CTRL1_BMM;

    // Enable MCM bit in $D016, preserve CSEL (40-column mode, bit 3).
    vic.ctrl2 = (vic.ctrl2 & 0xF7) | VIC_CTRL2_MCM;
}

int main(void)
{
    // mmap_trampoline + MMAP_NO_BASIC frees $A000-$BFFF (BASIC ROM) as RAM.
    // Not strictly required here since our image fits below $A000, but it
    // is good practice and follows the breakout.c/hscrollshmup.c pattern.
    mmap_trampoline();
    mmap_set(MMAP_NO_BASIC);

    // Wait for the raster to be in the vertical blank before performing
    // the large memory copies; this avoids tearing on the first frame.
    vic_waitBottom();
    vic_waitTop();

    // --- Copy bitmap (8000 bytes) ---
    // koala_file + KLA_BITMAP_OFFSET points at the 8000-byte bitmap body.
    // bitmap_dest is placed at $2000 by the linker region.
    memcpy(bitmap_dest, koala_file + KLA_BITMAP_OFFSET, 8000);

    // --- Copy screen RAM (1000 bytes) ---
    memcpy(Screen, koala_file + KLA_SCREEN_OFFSET, 1000);

    // --- Copy Color RAM (1000 bytes) ---
    memcpy(Color, koala_file + KLA_COLOR_OFFSET, 1000);

    // --- Enable multicolor bitmap mode ---
    display_enable(koala_file[KLA_BGCOL_OFFSET] & 0x0F);

    // Image is now displayed. Spin forever.
    for (;;) { }

    return 0;
}
```

## Build

```bash
oscar64 -O2 -o=bitmap-koala-viewer.prg -tf=prg bitmap-koala-viewer.c
```

To embed a real Koala file, replace the stub array with:

```c
static const char koala_file[] = { #embed "yourimage.kla" };
```

and rebuild. No other changes are needed provided the file is a standard 10003-byte
Koala `.kla` with a 2-byte load address prefix.

Outputs: `bitmap-koala-viewer.prg`, `.map`, `.asm`, `.lbl`.

## Expected output

With the zero-filled stub, the screen displays a plain black background (all
bitmap bits zero, all screen RAM zero, Color RAM zero, background color zero).
With a real `.kla` file embedded, the screen shows the full 160x200 multicolor
image filling the display area, border and background colors matching the image's
background register byte, no sprites, no HUD. The image is displayed from the
first frame and remains static; the for-loop keeps the program alive.

## Why this works

### Koala format anatomy

A Koala Painter `.kla` file is a direct serialization of the three hardware
memory regions that multicolor bitmap mode reads during rendering, plus a single
background color byte. The load address at bytes `$0000-$0001` is a standard C64
PRG header that Koala Painter uses when saving to disk; it tells the KERNAL where
to load the file in RAM. This recipe ignores the load address and copies each
region to the correct display addresses manually.

The three data regions map to the VIC-II's three memory accesses:

| Region | Koala offset | Bytes | VIC access type |
|--------|-------------|-------|-----------------|
| Bitmap | 2 | 8000 | g-access (pixel data per scanline) |
| Screen RAM | 8002 | 1000 | c-access (per-cell color nibbles on badlines) |
| Color RAM | 9002 | 1000 | c-access alternate (read by chip from $D800 direct) |
| Background | 10002 | 1 | $D021 register |

The 8000-byte bitmap stores the display as 25 rows of 40 cells, each cell
contributing 8 bytes (one per scanline within the cell). Cell `(col, row)` starts
at byte offset `(row * 40 + col) * 8` within the bitmap area. Each byte encodes
four 2-bit pixels in multicolor mode (or eight 1-bit pixels in hires mode).

### Multicolor bitmap mode: four-color per-cell palette

With `$D011` bit 5 (BMM) and `$D016` bit 4 (MCM) both set, the VIC-II
interprets each pair of adjacent bits in a bitmap byte as a 2-bit pixel index:

| Pattern | Color source |
|---------|-------------|
| %00 | `$D021` (BGCOL0) — shared global background |
| %01 | Screen RAM high nibble (per-cell, `$0400+cell`) |
| %10 | Screen RAM low nibble (per-cell, `$0400+cell`) |
| %11 | Color RAM nibble (per-cell, `$D800+cell`) |

The %00 color is global: changing `$D021` shifts the background tone of the
entire image simultaneously — the cheapest form of palette animation. The %01
and %10 colors are stored in the high and low nibbles of the screen RAM byte at
the cell's position. The %11 color comes from Color RAM, which is a fixed 1 KB
at `$D800` not subject to VIC banking. All three per-cell color sources allow
sixteen colors (the full C64 palette via 4-bit nibbles), so a Koala image can
use all sixteen colors, but each 8x8 cell is limited to four simultaneously:
the global background plus three from the cell's specific nibbles.

The effective resolution is 160x200 pixels (each displayed "pixel" is two
color-clock cycles wide), making Koala images noticeably coarser than hires
bitmap but far richer in per-cell color. This is the dominant tradeoff that
drove the Koala Painter design: the original 320x200 hires mode allowed only two
colors per cell, which is insufficient for painted artwork; the multicolor tradeoff
of halved horizontal resolution for four-per-cell colors was the right choice for
illustrative content.

### `$D018` and VIC bank layout

`$D018` (VMCSB) configures two base addresses within the current 16 KB VIC bank:

- Bits 7-4 (VM3-VM0): video matrix (screen RAM) base, in units of 1 KB.
  Value `%0001` places screen RAM at bank offset `$0400`.
- Bit 3 (CB2): character/bitmap base. In bitmap mode, CB2=0 places the
  bitmap at bank offset `$0000`; CB2=1 places it at `$2000`.

With the stock C64 VIC bank 0 (`$0000-$3FFF`, CIA2 `$DD00` bits `%11`), the
recipe writes `$D018 = $18` (`0001_1000`): VM=1 selects screen RAM at bank
`$0000 + 1*1024 = $0400`, CB2=1 selects bitmap at bank `$0000 + $2000 = $2000`.
Screen RAM at `$0400` and bitmap at `$2000` is the cleanest layout for Oscar64
programs because it matches the default Oscar64 stack and code layout (`$0A00`
onward) without overlapping any of the three data areas.

Color RAM at `$D800` is not configured through `$D018`. The VIC-II always reads
Color RAM from `$D800-$DBFF` regardless of bank selection; it is mapped to the
chip via a separate internal bus not subject to CIA2 banking. This is why the
recipe copies Color RAM with a direct `memcpy` to `$D800` rather than to a
bank-relative address.

### Why `#embed` is cleaner than a `.d64` load

The cc65 idiom for shipping artwork is either a disk load at runtime or an
`INCBIN` in an assembly stub. Oscar64's `#embed` makes both unnecessary: the file
is imported directly into the C array at compile time, the linker places the
array at the specified address, and the result is a single self-contained `.prg`
that works without a disk or a custom loader. For a 10003-byte Koala image, the
resulting PRG adds about 10 KB to the program size — negligible for a C64
program. The compile-time cost is one file-read and a copy into the object file;
there is no runtime overhead beyond the three `memcpy` calls that would be
needed regardless of how the data arrived.

For applications that need multiple Koala frames (animation, slideshow), embed
each as a separate array and cycle through them by copying each frame's regions
on a VBI boundary. Alternatively, embed a compressed array with `#embed lzo
"frame.kla"` and decompress with `oscar_expand_lzo` at startup.
