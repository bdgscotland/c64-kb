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
It is an Oscar64 starting point for a program that shows precomputed
C64 artwork as a background layer. It implements the
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
//   $1F42-$2329  screen RAM  (1000 bytes)
//   $232A-$2711  Color RAM   (1000 bytes)
//   $2712        background color byte
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

// The bss flag keeps the 8000-byte destination out of the PRG file; it is
// filled at run time.
#pragma section( bitmap, 0, , , bss )
#pragma region( bitmap_region, 0x2000, 0x4000, , , {bitmap} )

#pragma region( upper, 0x4000, 0xa000, , , {code, data, bss, heap, stack} )

// ---------------------------------------------------------------------------
// Embedded Koala file
// ---------------------------------------------------------------------------
// The full 10003-byte .kla file (including the 2-byte load-address header)
// is embedded here.  The viewer extracts each region by known byte offsets.
//
// Set USE_TEST_IMAGE to 0 and put your .kla next to the source to display
// a real picture.  With USE_TEST_IMAGE at 1 the program draws a computed
// test card instead, so the recipe shows the mode working without a file.
// (An earlier version embedded a 10003-byte all-zero stub, which produced a
// black screen and demonstrated nothing.)
#define USE_TEST_IMAGE 1
#if !USE_TEST_IMAGE
static const char koala_file[] = {
#embed "image.kla"
};
#endif

// Offset constants for the Koala layout (skipping the 2-byte load address)
#define KLA_BITMAP_OFFSET   2
#define KLA_SCREEN_OFFSET   (KLA_BITMAP_OFFSET + 8000)    // 8002
#define KLA_COLOR_OFFSET    (KLA_SCREEN_OFFSET + 1000)    // 9002
#define KLA_BGCOL_OFFSET    (KLA_COLOR_OFFSET  + 1000)    // 10002

// ---------------------------------------------------------------------------
// Bitmap destination (placed at $2000 by the bitmap_region linker region)
// ---------------------------------------------------------------------------
// #pragma bss(bitmap) routes this UNINITIALISED array into the bitmap
// section; the linker region bitmap_region spans $2000-$4000, so bitmap_dest
// lands at $2000 (check the .map: "2000 - 3f40 : bitmap_dest").  An earlier
// version used #pragma data(bitmap), which only affects initialised data:
// the array silently landed in the upper region at $6713 and the VIC never
// saw a byte of it.
#pragma bss(bitmap)
static char bitmap_dest[8000];
#pragma bss(bss)

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

    // Enable MCM bit in $D016; leave CSEL (bit 3, 40 columns) and XSCROLL
    // alone.  An earlier version of this recipe masked with 0xF7, which
    // CLEARS CSEL and gave a 38-column picture with the outer cells hidden.
    vic.ctrl2 |= VIC_CTRL2_MCM;
}

#if USE_TEST_IMAGE
// Computed test image in Koala layout, written straight to the display areas.
// Four horizontal bands use pixel patterns %00, %01, %10, %11 (char rows 0-5,
// 6-11, 12-17, 18-24), a one-pixel diagonal runs top-left to bottom-right in
// pattern %11 (pattern %00 inside the %11 band).  Screen RAM is $25 in every
// cell (high nibble 2 = red for %01, low nibble 5 = green for %10); Color RAM
// alternates 1 (white) and 7 (yellow) by column; background is 6 (blue).
#define TEST_BGCOL 6
static void make_test_image(void)
{
    for (int y = 0; y < 200; y++)
    {
        char row  = y >> 3;
        char band = row / 6;
        if (band > 3) band = 3;
        char fill = band * 0x55;                // %00, %01, %10 or %11 x4
        char dpat = (band == 3) ? 0 : 3;
        int  px   = (y * 4) / 5;                // 0..159 along the diagonal
        char * line = bitmap_dest + row * 320 + (y & 7);
        for (char col = 0; col < 40; col++)
            line[col * 8] = fill;
        char shift = 6 - 2 * (px & 3);
        line[(px >> 2) * 8] = (fill & ~(3 << shift)) | (dpat << shift);
    }
    for (int i = 0; i < 1000; i++)
    {
        Screen[i] = 0x25;
        Color[i]  = (i % 40) & 1 ? 7 : 1;
    }
}
#endif

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

#if USE_TEST_IMAGE
    make_test_image();
    display_enable(TEST_BGCOL);
#else
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
#endif

    // Image is now displayed. Spin forever.
    for (;;) { }

    return 0;
}
```

## Build

```bash
oscar64 -O2 -o=bitmap-koala-viewer.prg -tf=prg bitmap-koala-viewer.c
```

To embed a real Koala file, set `USE_TEST_IMAGE` to 0 and point the `#embed`
at your file:

```c
static const char koala_file[] = {
#embed "yourimage.kla"
};
```

`#embed` must stand on its own line: the one-line form
`{ #embed "yourimage.kla" }` fails to compile (Oscar64 1.32.271: `error 3006:
Term starts with invalid token ''}''` in most runs here, `error 3037:
Semicolon expected` in one; an earlier version of this page gave
the one-line form, and its offset comment put screen RAM, Color RAM and the
background byte two bytes late).

and rebuild. No other changes are needed provided the file is a standard 10003-byte
Koala `.kla` with a 2-byte load address prefix. Check the `.map` after any layout
change: the line `2000 - 3f40 : bitmap_dest, DATA:bitmap` shows the
bitmap is where `$D018` says it is.

Outputs: `bitmap-koala-viewer.prg`, `.map`, `.asm`, `.lbl`.

## Expected output

With `USE_TEST_IMAGE` at 1 (as listed), border and background are blue (6) and
the 40x25 display area shows four horizontal bands, one per pixel pattern, with
all four colour sources visible: char rows 0-5 blue (%00, `$D021`), rows 6-11
red (%01, screen RAM high nibble 2), rows 12-17 green (%10, screen RAM low
nibble 5), rows 18-24 vertical stripes alternating white and yellow one cell
wide (%11, Color RAM 1/7 by column). A one-pixel-wide diagonal runs from the
top-left to the bottom-right of the display, taking the cell's Color RAM colour
(white or yellow) in the first three bands and the blue background inside the
fourth. Measured on the VICE screenshot (PAL, 8,000,000 cycles): red starts at
PNG row 83 (raster line 99) and at column 32 (VIC X 24), so the picture is a
full 40 columns; the earlier version's `& 0xF7` cleared CSEL and the outer
seven pixels of each side were border. (The earlier version's zero-filled stub
showed a plain black screen.)
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
| Color RAM | 9002 | 1000 | same c-access: the nibble arrives as the upper 4 bits of the 12-bit fetch (see `docs/hardware/vic-ii-reference.md`, access-type table) |
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
entire image at once, the cheapest form of palette animation. The %01
and %10 colors are stored in the high and low nibbles of the screen RAM byte at
the cell's position. The %11 color comes from Color RAM, which is a fixed 1 KB
at `$D800` not subject to VIC banking. All three per-cell color sources allow
sixteen colors (the full C64 palette via 4-bit nibbles), so a Koala image can
use all sixteen colors, but each 8x8 cell is limited to four simultaneously:
the global background plus three from the cell's specific nibbles.

The effective resolution is 160x200 pixels (each multicolor pixel is two
hires pixels wide: 320 / 160; an earlier version said "two color-clock
cycles", which is a different unit), so Koala images are coarser than hires bitmap
but have more colors per cell. The 320x200 hires mode allows only two
colors per cell; Koala Painter trades half the horizontal resolution for
four colors per cell.

### `$D018` and VIC bank layout

`$D018` (VMCSB) configures two base addresses within the current 16 KB VIC bank:

- Bits 7-4 (VM3-VM0): video matrix (screen RAM) base, in units of 1 KB.
  Value `%0001` places screen RAM at bank offset `$0400`.
- Bit 3 (CB2): character/bitmap base. In bitmap mode, CB2=0 places the
  bitmap at bank offset `$0000`; CB2=1 places it at `$2000`.

With the stock C64 VIC bank 0 (`$0000-$3FFF`, CIA2 `$DD00` bits `%11`), the
recipe writes `$D018 = $18` (`0001_1000`): VM=1 selects screen RAM at bank
`$0000 + 1*1024 = $0400`, CB2=1 selects bitmap at bank `$0000 + $2000 = $2000`.
Screen RAM at `$0400` and bitmap at `$2000` do not fit the default Oscar64
layout on their own: the default `main` region runs `$0880`–`$A000`
(oscar64-reference, section ".PRG"), so code and data past 6,016 bytes
(`$2000` − `$0880`) would grow into the bitmap. The `#pragma region` lines at the top of the listing
prevent that: `lower` stops at `$2000`, `bitmap_region` holds only the bitmap,
and `upper` takes everything else from `$4000`. (An earlier version said the
default layout, "`$0A00` onward", avoided the data areas by itself.)

Color RAM at `$D800` is not configured through `$D018`. The VIC-II always reads
Color RAM from `$D800-$DBFF` regardless of bank selection; it is mapped to the
chip via a separate internal bus not subject to CIA2 banking, so the
recipe copies Color RAM with a direct `memcpy` to `$D800` rather than to a
bank-relative address.

### Why `#embed` is cleaner than a `.d64` load

The cc65 idiom for shipping artwork is either a disk load at runtime or an
`INCBIN` in an assembly stub. Oscar64's `#embed` makes both unnecessary: the file
is imported directly into the C array at compile time, the linker places the
array at the specified address, and the result is a single self-contained `.prg`
that works without a disk or a custom loader. For a 10003-byte Koala image, the
resulting PRG adds about 10 KB to the C64 program. The compile-time cost is one file-read and a copy into the object file;
there is no runtime overhead beyond the three `memcpy` calls that would be
needed regardless of how the data arrived.

For applications that need multiple Koala frames (animation, slideshow), embed
each as a separate array and cycle through them by copying each frame's regions
on a VBI boundary. Alternatively, embed a compressed array with `#embed lzo
"frame.kla"` and decompress with `oscar_expand_lzo` at startup.
