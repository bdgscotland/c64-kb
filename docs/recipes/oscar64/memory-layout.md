---
recipe: memory-layout
toolchain: oscar64
output_format: PRG
region: both
techniques: [cpu_io_port_bank, char_rom_under_vic]
file_formats: [PRG]
uses_registers: [D000, D001, D010, D012, D015, D018, D027, DD00]
uses_kernal: [CHROUT]
---

<!-- doc-type: recipe -->

# Oscar64 memory layout: stub, music, charset, sprites, screen, code

## Synopsis

Oscar64 regions and sections for a fixed layout: the BASIC stub at
`$0801`, a "music" stub at `$1000` that increments a counter once per
frame, a 2 KB charset at `$2000` with glyph 0 replaced by a hollow box,
one sprite at `$2800`, the screen left at `$0400`, and `main` from
`$3000`. The program prints the address each of its own symbols carries,
so the screen can be read against the `.map`. The planning behind the
addresses is on
[memory-layout-planning](../../toolchains/memory-layout-planning.md).

## Source

```c
// memory-layout.c
#include <stdio.h>
#include <string.h>
#include <conio.h>
#include <c64/vic.h>
#include <c64/cia.h>
#include <c64/memmap.h>

// ---- Regions. Redefining "main" replaces the default $0880-$A000 one.
#pragma section( music, 0 )
#pragma section( charset, 0, , , bss )
#pragma section( sprites, 0 )

#pragma region( music,   0x1000, 0x2000, , , { music } )
#pragma region( charset, 0x2000, 0x2800, , , { charset } )
#pragma region( sprites, 0x2800, 0x3000, , , { sprites } )
#pragma region( main,    0x3000, 0xa000, , , { code, data, bss, heap, stack } )

// ---- $1000: "music" stub. Called once per frame, bumps a counter.
#pragma bss( music )
unsigned music_frames;
#pragma bss( bss )

#pragma code( music )
void music_play(void)
{
	music_frames++;
}
#pragma code( code )

// ---- $2000: charset. Filled at run time from the character ROM,
// then glyph 0 (screen code 0, '@') is replaced. Not in the .prg.
#pragma bss( charset )
char charset[2048];
#pragma bss( bss )

// ---- $2800: one sprite. Pointer value = $2800 / 64 = 160.
#pragma data( sprites )
__export const char sprite0[64] = {
	0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
	0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
	0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
	0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
	0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
	0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
	0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00
};
#pragma data( data )

// ---- from here on: code and data in "main", from $3000.
#define SCREEN ((char *)0x0400)

static const char glyph0[8] = { 0xff, 0x81, 0x81, 0x81, 0x81, 0x81, 0x81, 0xff };
static const char hexdigits[16] = {
	0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37,
	0x38, 0x39, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06     // screen codes 0-9, A-F
};

static void put_hex16(char *cell, unsigned v)
{
	cell[0] = hexdigits[(v >> 12) & 15];
	cell[1] = hexdigits[(v >>  8) & 15];
	cell[2] = hexdigits[(v >>  4) & 15];
	cell[3] = hexdigits[ v        & 15];
}

int main(void)
{
	// copy the uppercase ROM font ($D000-$D7FF) into RAM at $2000
	__asm { sei }
	char pla = mmap_set(MMAP_CHAR_ROM);
	memcpy(charset, (const char *)0xd000, 2048);
	mmap_set(pla);
	__asm { cli }

	// replace glyph 0 ('@') with a hollow box
	memcpy(charset, glyph0, 8);

	// screen $0400, charset $2000
	vic.memptr = (char)(((0x0400 >> 10) << 4) | ((0x2000 >> 10) & 0x0e));

	// sprite 0 from $2800, yellow, at (280, 180)
	SCREEN[0x3f8] = (char)(0x2800 / 64);
	vic.spr_color[0] = VCOL_YELLOW;
	vic.spr_pos[0].x = 280 & 0xff;
	vic.spr_msbx = 1;
	vic.spr_pos[0].y = 180;
	vic.spr_enable = 1;

	// what the VIC is actually showing, from CIA2 and $D018
	unsigned bank   = (unsigned)(3 - (cia2.pra & 3)) << 14;
	unsigned screen = bank + ((unsigned)(vic.memptr >> 4) << 10);

	clrscr();
	printf("STUB    $%04X\n", *(unsigned *)0x2b);        // BASIC TXTTAB
	printf("MUSIC   $%04X\n", (unsigned)&music_play);
	printf("CHARSET $%04X\n", (unsigned)charset);
	printf("SPRITES $%04X\n", (unsigned)sprite0);
	printf("SCREEN  $%04X\n", screen);
	printf("CODE    $%04X\n", (unsigned)&main);
	printf("FRAMES  $\n");
	printf("@@@@@@@@\n");

	for (;;)
	{
		// once per frame: leave line 200, wait for the wrap, call the stub
		while (vic.raster < 200) ;
		while (vic.raster >= 200) ;
		music_play();
		put_hex16(SCREEN + 8 * 40 + 8, music_frames);
	}

	return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=memory-layout.prg memory-layout.c
```

No flag is needed for the map: this command writes `memory-layout.map`
next to the `.prg`, together with `.asm`, `.int` and `.lbl` (Oscar64
build 2026-05-19). The `regions` block and the placed objects:

```
regions
1000 - 2000 : 100b, 000b, music
2000 - 2800 : 0000, 0800, charset
2800 - 3000 : 2840, 0040, sprites
3000 - 9000 : 4287, 1287, main
00f7 - 00ff : 0000, 0000, zeropage
0801 - 0880 : 0853, 0052, startup

1000 - 1009 : music_play, NATIVE_CODE:music
1009 - 100b : music_frames, DATA:music
2000 - 2800 : charset, DATA:charset
2800 - 2840 : sprite0, DATA:sprites
3000 - 3161 : main, NATIVE_CODE:code
```

`main` prints as `3000 - 9000` because the 4 KB stack is carved from the
top of the declared `0xa000`. The PRG is 14,984 bytes and loads
`$0801`-`$4286`; the bss charset is inside that span as zero fill because
the file is contiguous.

## Expected output

Run with the pinned command (`-limitcycles 8000000`, PAL, and again with
`-model ntsc`); the pictures are
`screenshots/memory-layout.png` and `screenshots/memory-layout-ntsc.png`.
Measured with PIL on both:

- Rows 0-6 from column 0 read `STUB    $0801`, `MUSIC   $1000`,
  `CHARSET $2000`, `SPRITES $2800`, `SCREEN  $0400`, `CODE    $3000`,
  `FRAMES  $`. Each address equals the map entry above; `SCREEN` is
  recomputed from `$DD00` and `$D018` rather than read from a symbol.
- Row 7, columns 0-7: eight cells of the replaced glyph 0. Each 8x8 cell
  is a hollow box: all eight pixels of the top and bottom pixel rows in
  ink, the six middle rows ink only at the left and right edge, six
  background pixels between. On PAL the first cell is at PNG (32, 91), on
  NTSC at (32, 79).
- Row 8, columns 8-11: the frame counter in hex. At 8,000,000 cycles it
  read `00F9` on PAL and `0118` on NTSC (one run each; `verify:recipes`
  is what holds it fixed, with `+autostart-delay-random`).
- The sprite: a 24x21 block of 504 yellow pixels at PNG x 288-311, y
  165-185 on PAL (RGB 255,255,70) and y 153-173 on NTSC (RGB 255,248,141).
  That is sprite X 280 and Y 180: sprite X 24 lines up with text column
  0 at PNG x 32, so X 280 is PNG x 280 + 8 = 288; the top row of a
  sprite at Y 180 is on raster line 181, which is PNG y 181 - 16 = 165
  on PAL and 181 - 28 = 153 on NTSC. Measured on these PNGs (rung 1);
  [vice-reference](../../runtime/vice-reference.md) gives the text-row
  geometry only.
- Border (115,133,255) and background (44,61,236) on PAL; (98,145,251)
  and (25,73,180) on NTSC. The text colour was not measured.

## Why this works

A `#pragma section` names a section, a `#pragma region` gives it an
address range, and `#pragma code`, `#pragma data` and `#pragma bss` route
the objects that follow into it until the matching pragma switches back
to the default section. Redefining `main` at `0x3000` replaces the default
`$0880`-`$A000` region, so nothing from the runtime lands below `$3000`
except the `startup` region at `$0801`, which stays. An uninitialised
variable is a bss object whatever `#pragma data` says: with
`#pragma data( music )` the counter landed at `$4287` in `main`; with
`#pragma bss( music )` it sits at `$1009` behind the stub (measured, both
builds). `__export` on `sprite0` keeps it in the output whether or not
anything references it.

`mmap_set(MMAP_CHAR_ROM)` from `<c64/memmap.h>` writes `$31` to the
port: no BASIC, no KERNAL, no I/O, character ROM at `$D000`. Interrupts
are masked around it because the KERNAL's IRQ handler is gone while the
copy runs. After glyph 0 is overwritten, `vic.memptr` = `$18` points the
VIC at screen `$0400` and charset `$2000`. Oscar64's `printf` goes
through CHROUT, so `@` (PETSCII `$40`) prints screen code 0, the glyph
that was replaced. The `hexdigits` table holds screen codes, not PETSCII,
because `put_hex16` writes straight into screen memory.

The frame loop waits until `vic.raster` passes line 200 and then until it
wraps, once per frame on PAL and NTSC alike, then calls the stub at
`$1000`.
