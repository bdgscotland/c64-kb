---
recipe: pal-ntsc-detect
toolchain: oscar64
output_format: PRG
region: both
techniques: [pal_ntsc_detection]
file_formats: [PRG]
uses_registers: [D011, D012, D020, D021]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 PAL/NTSC Detection

## Synopsis

Decide at start-up which VIC-II the program is running on, a 6569 (PAL),
a 6567R8 (NTSC) or a 6567R56A (old NTSC), by watching one frame's RST8
band and keeping the highest `$D012` value seen inside it. The answer is
shown two ways: as a border colour (green 5 = PAL, red 2 = NTSC R8, yellow
7 = NTSC R56A, orange 8 = a chip this page does not know) and as the raw
byte in hex on screen row 0, so a screenshot can be measured rather than
looked at. Use it as the first thing a region-aware program does, keep the
result in a byte, and branch on that byte for the music tick, CIA reloads
and raster tables; the technique is `pal_ntsc_detection` in
`techniques/raster.md` and the three things that go wrong without it are
in `pitfalls/region-timing.md`.

## Source

```c
// pal-ntsc-detect.c
// Which VIC-II is this machine running? Decided once at start-up from the
// last raster line of one frame, then shown as a border colour and as the
// raw byte, so the picture can be measured rather than eyeballed.
#include <c64/vic.h>

#define SCREEN ((char *)0x0400)      // default text screen
#define COLOUR ((char *)0xd800)      // colour RAM

// Low byte of the last raster line of the frame: the last value $D012 holds
// while RST8 ($D011 bit 7) is set.
//   6569 (PAL)       lines 0..311, RST8 band 256..311 -> $37
//   6567R8 (NTSC)    lines 0..262, RST8 band 256..262 -> $06
//   6567R56A (NTSC)  lines 0..261, RST8 band 256..261 -> $05
#define LAST_PAL      0x37
#define LAST_NTSC_R8  0x06
#define LAST_NTSC_R56 0x05

// Screen codes for the sixteen hex digits: "0".."9", then "A".."F".
static const char hex_glyph[16] = {
    0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37,
    0x38, 0x39, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06
};

// Watch one complete RST8 band and return the highest $D012 value seen in
// it. Interrupts are off for the whole frame so nothing can hold the loop
// away from the registers for a raster line.
static char last_raster_line(void)
{
    char top = 0;

    __asm { sei }

    // If the beam is already inside the band, let it finish first. Not for
    // the lines a mid-band start would skip -- those are the smaller values
    // and 'top' does not need them -- but so that the next wait can only end
    // at line 256. Without this, a call landing in the last cycles of the
    // band's final line reads RST8 set here, then clear on line 0 at the top
    // of the sampling loop, and returns 'top' still 0: the orange verdict.
    while (vic.ctrl1 & 0x80)
        ;
    // Wait for the band to open. That is line 256 on every chip.
    while (!(vic.ctrl1 & 0x80))
        ;
    // Inside the band $D012 climbs 0, 1, 2 ... and wraps to 0 in the same
    // line RST8 clears, so a read that lands on the wrap cannot raise 'top'.
    while (vic.ctrl1 & 0x80)
    {
        char r = vic.raster;
        if (r > top)
            top = r;
    }

    __asm { cli }
    return top;
}

int main(void)
{
    char top = last_raster_line();
    char verdict;

    if (top == LAST_PAL)
        verdict = VCOL_GREEN;         // 5
    else if (top == LAST_NTSC_R8)
        verdict = VCOL_RED;           // 2
    else if (top == LAST_NTSC_R56)
        verdict = VCOL_YELLOW;        // 7
    else
        verdict = VCOL_ORANGE;        // 8: a chip this page does not know

    // Blank the screen: white ink on black.
    for (unsigned i = 0; i < 1000; i++)
    {
        SCREEN[i] = 0x20;
        COLOUR[i] = VCOL_WHITE;
    }
    vic.color_back = VCOL_BLACK;
    vic.color_border = verdict;

    // Row 0: three solid reference cells in colours 5, 2 and 7, so a script
    // can take its palette from this very picture, then the byte itself as
    // two hex digits in cells 5 and 6.
    SCREEN[0] = 0xa0; COLOUR[0] = VCOL_GREEN;
    SCREEN[1] = 0xa0; COLOUR[1] = VCOL_RED;
    SCREEN[2] = 0xa0; COLOUR[2] = VCOL_YELLOW;
    SCREEN[5] = hex_glyph[top >> 4];
    SCREEN[6] = hex_glyph[top & 0x0f];

    for (;;)
        ;
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=pal-ntsc-detect.prg pal-ntsc-detect.c
```

Produces `pal-ntsc-detect.prg` (341 bytes including the BASIC stub) plus
the usual `.map`, `.asm` and `.lbl` side files. Load with
`LOAD"PAL-NTSC-DETECT",8,1 : RUN` or via VICE autostart. That is the exact
invocation the verification below used; `npm run check:listings` builds the
listing the same way.

## Expected output

A black screen. Row 0 holds three solid cells at columns 0–2 (green, red,
yellow: the palette reference), then two white hex digits at columns 5–6.
The border is the verdict:

| VICE model | Chip | Border | Digits on row 0 |
|---|---|---|---|
| default (the `c64c` configuration) | 8565 PAL | green (5) | `37` |
| `-model ntsc` | 6567R8 | red (2) | `06` |
| `-model oldntsc` | 6567R56A | yellow (7) | `05` |

An earlier version of this table said the default model was a 6569: VICE's
default is the `c64c` configuration, VIC-II 8565 (`x64sc -default
-dumpconfig` gives VICIIModel=1, the same as `-model c64c`). The listing
was also run on `-model c64` (6569), `c64old` (6569R1) and `drean` (6572):
`37` on all three, border pixel (2, 100) = (94, 214, 56), that model's
green; on `newntsc` (8562), `06` and (174, 71, 93), red (VICE x64sc 3.10,
2026-09-23, digits matched against the char ROM).

The digits are the low byte of the last raster line of the frame, and they
agree with the settled line counts: 312 lines end at 311 = `$137`, 263 at
262 = `$106`, 262 at 261 = `$105`.

Measured in VICE x64sc 3.10 (rung 1) with Oscar64 build 2026-05-19:
`recipes/oscar64/screenshots/pal-ntsc-detect-pal.png`,
`recipes/oscar64/screenshots/pal-ntsc-detect-ntsc.png` and
`recipes/oscar64/screenshots/pal-ntsc-detect-oldntsc.png`. Each model was
run twice, stopped at 8,000,000 and at 5,000,000 cycles, and gave the same
border and the same digits both times. The check was a script, not an eye:
the border pixel at (2,100) was compared with the three reference cells in
the same picture (each cell 64 of 64 pixels one colour), and the two digit
cells were matched, bit for bit, against the uppercase set of
`chargen-901225-01.bin`. A re-measurement needs the same method: the NTSC
pictures are 384×247, not 384×272, and the same colour index has
different RGB values in them (colour 2 is (175,60,88) in the PAL picture,
(169,71,100) in the `ntsc` one and (146,49,78) in the `oldntsc` one), so a
PAL RGB constant compared against an NTSC picture fails on a correct render.

## Why this works

### One counter, nine bits

The VIC-II's raster position is a nine-bit counter: `$D012` is its low
eight bits and RST8, bit 7 of `$D011`, is the ninth (Bauer, §3.2). RST8 is
therefore set for exactly the lines from 256 upward, whatever the chip. The
three chips differ only in how many such lines they have (PAL runs to 311,
the 6567R8 to 262, the 6567R56A to 261; settled), and the low byte of that
last line is `$37`, `$06` or `$05`. The routine waits for RST8 to be clear
and then set, so that its sampling can only begin at line 256, and keeps the
highest `$D012` it reads until RST8 clears again. Because the counter climbs
monotonically inside the band, "highest" and "last" are the same value; the
routine keeps the highest because it is immune to the one race at the wrap,
where `vic.ctrl1` is read on the last line and `vic.raster` a few cycles
later on line 0 already reads `$00`. The first wait is there for a second
race, at the same boundary but before any sample has been taken: a call
that lands in the last cycles of the band's final line would pass the
"wait for set" test on that line and fail the loop's RST8 test on line 0,
returning `top` untouched. Measured on the KickAssembler form of this loop
in VICE x64sc 3.10 (`techniques/raster.md`, How, step 2): without the first
wait, entered on PAL line 311 with the result preloaded to `$EE`, two of
sixteen entry phases returned `$EE`; with the wait restored, both of those
phases returned `$37`. It is not there for
calls that land mid-band (the same wait-less loop entered on lines 256 and
300 still returned `$37`); this page gave that reason until 2026-09-22.
A single read taken right after RST8
rises tells nothing: it lands on line 256 and returns `$00` on every
chip. That was measured too (a KickAssembler control doing that
read showed `00` on all three models), and it is why the earlier detection
listings in this knowledge base misfired (their pages carry the correction).

### What Oscar64 does with the loop

`vic.ctrl1` and `vic.raster` are `volatile` fields of `struct VIC` in
`<c64/vic.h>`, so `-O2` keeps every read. The compiled sampling loop, read
from the generated `.asm`, is 21 cycles when a new maximum is stored and 22
when it is not, under a third of a raster line on any chip, so every line
of the band is read at least twice and the last line cannot slip through.
`__asm { sei }` and `__asm { cli }` bracket the measurement so the KERNAL's
60 Hz interrupt cannot hold the loop away from the registers across a line
boundary; nothing else about interrupts is touched, and `rasterirq.h` is
not used. It runs once, and how long it holds the CPU depends on where in
the frame it is entered: from 57 raster lines (about 3.6 ms) when called
just before the band to 368 lines (about 23.5 ms, 1.2 frames) when called
as RST8 rises on PAL, and from 8 to 270 lines (about 0.5 to 17 ms) on the
6567R8 (line counts measured with a CIA timer on the KickAssembler form of
the same loop, `techniques/raster.md`, Why it works); the compiled loop is
longer per pass but is bounded by the same lines. It never takes two frames.
**Correction (2026-09-22):** this page said "between one and two frames"
until this date; that figure was not measured, and it was wrong.

### Making the picture measurable

The verdict goes to `$D020` because the border is the largest uniform area
in a screenshot. The three reference cells are reversed spaces (screen code
`$A0`, every pixel in the foreground colour) with colours 5, 2 and 7 written
to colour RAM, so any script can read the palette from the picture it is
measuring. The hex digits are screen codes (`$30`–`$39` for `0`–`9`, `$01`–
`$06` for `A`–`F`), poked straight into the screen, with the background set
to black and colour RAM to white so the glyph decodes against the
character ROM. Any chip whose last line is none of the three known values
paints orange; the page does not claim what such a chip reads.

## Sources

- Christian Bauer, "The MOS 6567/6569 video controller (VIC-II) and its
  application in the Commodore 64", https://www.cebix.net/VIC-Article.txt —
  §3.2 (RST8 is bit 8 of the raster register), §3.4 (lines per frame for
  the 6569, 6567R8 and 6567R56A).
- Oscar64, `include/c64/vic.h`, local build dated 2026-05-19
  (https://github.com/drmortalwombat/oscar64) — `struct VIC` field names
  `ctrl1`, `raster`, `color_border`, `color_back`; the `VCOL_` colour names.
- VICE 3.10, `x64sc` — the instrument; the model names come from
  `x64sc -help` (`ntsc`, `oldntsc`). https://vice-emu.sourceforge.io/
- VICE's `chargen-901225-01.bin` — the glyph shapes the digits were decoded
  against.
- This repository: `hardware/pal-ntsc-reference.md` (settled line counts,
  Method 1 and Method 2) and `pitfalls/region-timing.md`.
