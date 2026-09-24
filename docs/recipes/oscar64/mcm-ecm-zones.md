---
recipe: mcm-ecm-zones
toolchain: oscar64
output_format: PRG
region: both
techniques: [mcm_text, ecm_mode, raster_split_modes]
file_formats: [PRG]
uses_registers: [D011, D012, D016, D018, D019, D01A, D020, D021, D022, D023, D024, DD00]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 Multicolour Text and ECM Zones on One Screen

## Synopsis

Rows 1 to 10 are multicolour text (`mcm_text`) and rows 13 to 22 are
extended background colour text (`ecm_mode`). Two `rasterirq.h` slots
switch the mode bits, one inside the blank rows between the zones and one
below the window, so the switch lands on lines where every cell is
background (`raster_split_modes`). Column i has colour RAM i & 15, so each
zone shows what all sixteen colour RAM values do in that mode, and the two
zones share `$D021`-`$D023`. Every pixel of the window was checked against
the colour rule below.

## Source

```c
// mcm-ecm-zones.c
//
// Two text modes on one screen: multicolour text (MCM, $D016 bit 4) on
// rows 1-10 and extended background colour text (ECM, $D011 bit 6) on
// rows 13-22. Two raster IRQ slots switch the mode bits inside blank
// separator rows, so no visible cell is ever drawn half in each mode.
// Every column i has colour RAM i & 15, so each row shows all sixteen
// colour RAM values under each mode.
//
#include <c64/vic.h>
#include <c64/rasterirq.h>
#include <string.h>

#define Screen ((char *)0x0400)
#define Color  ((char *)0xd800)
#define Font   ((char *)0x3800)

// Glyph 2: one bit pattern per pair of pixel lines, %00, %01, %10, %11.
// Glyph 3: four set pixels on the left in lines 0-3, on the right in 4-7.
static const char pairs[8] = {0x00, 0x00, 0x55, 0x55, 0xaa, 0xaa, 0xff, 0xff};
static const char halves[8] = {0xf0, 0xf0, 0xf0, 0xf0, 0x0f, 0x0f, 0x0f, 0x0f};

// $D011: DEN, RSEL, YSCROLL 3, plus ECM for the lower zone.
#define D011_TEXT 0x1b
#define D011_ECM  0x5b
// $D016: CSEL, XSCROLL 0, plus MCM for the upper zone.
#define D016_TEXT 0xc8
#define D016_MCM  0xd8

RIRQCode to_ecm, to_mcm;

int main(void)
{
	// Font: all blank except the two test glyphs (codes 2 and 3; an ECM
	// cell uses the low six bits of its code, so 3, 67, 131 and 195 all
	// draw glyph 3).
	memset(Font, 0, 2048);
	memcpy(Font + 2 * 8, pairs, 8);
	memcpy(Font + 3 * 8, halves, 8);

	memset(Screen, 0x20, 1000);
	for (char i = 0; i < 40; i++)
	{
		for (char r = 0; r < 25; r++)
			Color[r * 40 + i] = i & 15;
		for (char r = 1; r <= 10; r++)
			Screen[r * 40 + i] = 2;
		for (char r = 13; r <= 22; r++)
			Screen[r * 40 + i] = 3 | (((r - 13) & 3) << 6);
	}

	vic_setmode(VICM_TEXT, Screen, Font);
	vic.color_border = VCOL_BLACK;
	vic.color_back = VCOL_BLUE;      // $D021: background 0 in both modes
	vic.color_back1 = VCOL_ORANGE;   // $D022: MCM %01, ECM background 1
	vic.color_back2 = VCOL_GREEN;    // $D023: MCM %10, ECM background 2
	vic.color_back3 = VCOL_PURPLE;   // $D024: ECM background 3

	rirq_init(true);

	// Line 143, inside blank row 11 (lines 139-146): ECM on, MCM off.
	rirq_build(&to_ecm, 2);
	rirq_write(&to_ecm, 0, &vic.ctrl1, D011_ECM);
	rirq_write(&to_ecm, 1, &vic.ctrl2, D016_TEXT);
	rirq_set(0, 142, &to_ecm);

	// Line 251, below the window: MCM on, ECM off for the next frame.
	rirq_build(&to_mcm, 2);
	rirq_write(&to_mcm, 0, &vic.ctrl1, D011_TEXT);
	rirq_write(&to_mcm, 1, &vic.ctrl2, D016_MCM);
	rirq_set(1, 250, &to_mcm);

	rirq_sort(false);
	rirq_start();

	for (;;)
		;
	return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=mcm-ecm-zones.prg mcm-ecm-zones.c
```

## Expected output

Black border, blue background. The top zone: in columns 0-7 of every
16-column group (colour RAM 0-7) hires cells, blue on top, then two lines
of alternating blue and colour pixels in each phase, then two solid lines
of the cell colour; in columns 8-15 (colour RAM 8-15) multicolour cells in
four bands of two lines, blue, orange, green and the colour RAM value's low
three bits. The bottom zone: rows in the order blue, orange, green, purple
background, repeating, each cell with its colour RAM colour (all sixteen,
8-15 as themselves) in the top-left and bottom-right quarter.

### The colour rule, measured

Measured in VICE x64sc 3.10, PAL c64c (8565/8580/8521) and NTSC 6567R8, with
PIL: every pixel of the 320 × 200 window, 64,000 per model, was compared
with the colour the rule below predicts for its cell, glyph line and pixel.
None differed on either model. Screenshots:
`screenshots/mcm-ecm-zones.png` (PAL), `screenshots/mcm-ecm-zones-ntsc.png`
(NTSC).

Multicolour text, glyph 2 (lines 0-1 `%00`, 2-3 `%01`, 4-5 `%10`, 6-7 `%11`
in every pair):

| Colour RAM | Cell | `%00` | `%01` | `%10` | `%11` |
|---|---|---|---|---|---|
| 0-7 | hires, 1 bit a pixel | `$D021` | 0 bit `$D021`, 1 bit colour RAM | same | colour RAM |
| 8-15 | multicolour, 2 bits a pixel pair | `$D021` | `$D022` | `$D023` | colour RAM & 7 |

ECM text, glyph 3 drawn by codes 3, 67, 131 and 195:

| Code bits 7-6 | 0 bits | 1 bits |
|---|---|---|
| `%00` (3) | `$D021` | colour RAM, all four bits |
| `%01` (67) | `$D022` | colour RAM |
| `%10` (131) | `$D023` | colour RAM |
| `%11` (195) | `$D024` | colour RAM |

The difference that matters when one screen mixes the two: colour RAM 14
draws light blue in an ECM cell and blue (14 & 7 = 6) in a multicolour
cell. A multicolour cell has eight colours for `%11`; an ECM cell's
foreground has sixteen.

### Where the switch lands

A store trace on `$D011` and `$D016` (PAL) put the slot 0 stores on line 143,
cycles 10 to 16, and the slot 1 stores on line 251, cycles 10 to 16, with
the jitter `rasterirq.h` leaves (its slots poll `$D012`). Line 143 is in
row 11, inside the display window: in a row with drawn cells, part of that
line would be drawn in each mode. Row 11 and row 12 hold only spaces, which
are background in both modes, so the line shows `$D021` either way. The
blank rows are what make a polled split clean; a split between two drawn
rows needs a store placed between lines, as in
`../kickassembler/raster-split-modes.md`.

## Why this works

### MCM is per cell, ECM per frame region

MCM (`$D016` bit 4) takes effect per cell through colour RAM bit 3: with the
bit clear the cell is hires even while MCM is on, which is why columns 0-7
of the top zone draw one bit a pixel. ECM (`$D011` bit 6) has no such
opt-out: every cell in its lines uses code bits 7-6 as a background
selector and bits 5-0 as the glyph. So in an ECM zone only 64 glyphs
exist, and a code from 64 up is the same glyph on another background.
Setting both bits together is one of the invalid modes, which draw black
(`docs/techniques/raster.md`, `raster_split_modes`; not measured here). The
two slots always write both registers, so the zones never overlap.

### Shared registers

`$D022` and `$D023` are the multicolour `%01` and `%10` colours in the top
zone and the ECM backgrounds 1 and 2 in the bottom zone. One value serves
both here. To give the zones different colours, add the colour stores to
each slot: an `RIRQCode` holds five writes.

### The font

The listing builds its own font at `$3800` with only glyphs 2 and 3. The
ROM font would do for the ECM zone, whose codes 3, 67, 131 and 195 would
all draw its glyph 3 (`C`), but the multicolour test needs a glyph with each
bit pair in known lines.
