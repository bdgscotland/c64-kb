---
chip: VIC-II
---

# VIC-II Hardware Reference

## Overview

The VIC-II (Video Interface Chip II, MOS 6567/6569/8562/8565) is the
display generator of the Commodore 64. It produces a composite-video signal
40 columns wide by 25 rows tall, with eight hardware sprites, four
selectable display modes, a per-cell color attribute system, and a raster
counter that can interrupt the CPU at any visible scanline. Almost every
C64 visual trick (smooth scrolling, FLD/FLI, sprite multiplexing, side
borders open, 64-pixel-tall character cells) depends on the documented
coupling between the chip and the 6510 CPU bus.

The VIC-II shares the bus with the 6510. During each PAL raster line the
chip takes the bus for itself on the first half of every cycle (phi1) to
fetch pixel data and on roughly five extra cycles for sprite DMA, while
the CPU runs on the second half (phi2). Once per text row
(25 times every frame, every eighth raster line: 51, 59, ..., 243 with the
default YSCROLL = 3; measured in VICE x64sc on PAL and NTSC alike) the
chip needs an entire row of character pointers from screen RAM and steals
40 consecutive cycles from the CPU: the *badline*. (An earlier revision of
this page said "eight times"; eight is the spacing in lines, not the
count.) Most cycle-exact C64 code is shaped by the badline. See the
[Raster system](#raster-system) section.

### Chip variants

The VIC-II shipped in four primary variants. The PAL parts have an extra
line of vertical resolution and a slower system clock; the NTSC parts run
faster but have fewer lines. The HMOS-II 8000-series revisions behave like
the original NMOS parts in the common cases but differ in DC
characteristics, color shades, and a few timing edge cases that affect
cycle-exact code.

| Variant | Region | Process | Lines/frame | Cycles/line | Master clock | System (phi2) |
|---------|--------|---------|-------------|-------------|--------------|---------------|
| 6569    | PAL    | NMOS    | 312         | 63          | 17.734472 MHz / 18 | 0.985 MHz |
| 6567 R56A | NTSC | NMOS    | 262         | 64          | 14.318181 MHz / 14 | 1.022 MHz |
| 6567 R8 / R9 | NTSC | NMOS | 263       | 65          | 14.318181 MHz / 14 | 1.022 MHz |
| 8565    | PAL    | HMOS-II | 312         | 63          | 17.734472 MHz / 18 | 0.985 MHz |
| 8562    | NTSC   | HMOS-II | 263         | 65          | 14.318181 MHz / 14 | 1.022 MHz |

Notes on variants:

- 6569 PAL machines run at 50.125 Hz refresh; the 6567 NTSC at ~59.83 Hz.
- The 6567 R56A is rare. It has only 262 lines and 64 cycles per line,
  one fewer than the more common R8. Most NTSC C64s use R8.
- 8565 (PAL) / 8562 (NTSC) are the late-model HMOS-II parts found in the
  C64C. The C128 does not carry them: its VIC is the VIC-IIe (MOS 8564 /
  8566), a different chip with extra registers at $D02F–$D030 (see the
  $D02F entry below). An earlier revision of this page listed the C128
  alongside the C64C here, contradicting its own $D02F entry.
  The 8565 and 8562 are pin-compatible with the 6569/6567 but produce slightly different
  colors (notably grays and reds) and have sharper color transitions on
  composite. Some sprite-crunch and color-DMA edge cases differ.
- All variants share the same register map and the same 47 documented
  registers at $D000–$D02E plus a 48th unused address $D02F.

### What this chip does for software

- Generates the picture: characters, bitmaps, or a mix of modes.
- Provides eight 24×21 hardware sprites with optional 2×/1×/×1 expansion,
  multicolor mode, and per-sprite-pair priority.
- Drives the IRQ line on configurable conditions (raster match, sprite
  collisions, light pen, sprite/background collisions).
- Owns 16 KB of address space (the VIC bank), selected by CIA2 port A.
- Reads color attributes from a dedicated 1024×4-bit Color RAM at $D800.

The CPU sees the VIC-II as a 64-byte register window at $D000–$D03F. The
last 17 addresses ($D02F–$D03F) are unimplemented: they read $FF and
ignore writes (measured in VICE x64sc; an earlier version of this page
called them images of $D000–$D00F, which they are not). The Color RAM at
$D800–$DBFF belongs to the VIC subsystem but is a separate 2114-family
static RAM.

## Quick reference

All 47 documented registers plus the one unused address are listed below.
Each register has its own entry further down with bit layout and
behavior notes.

| Addr  | Dec   | Name   | Description                          | Access |
|-------|-------|--------|--------------------------------------|--------|
| $D000 | 53248 | M0X    | Sprite 0 X position (low 8 bits)     | RW     |
| $D001 | 53249 | M0Y    | Sprite 0 Y position                  | RW     |
| $D002 | 53250 | M1X    | Sprite 1 X position (low 8 bits)     | RW     |
| $D003 | 53251 | M1Y    | Sprite 1 Y position                  | RW     |
| $D004 | 53252 | M2X    | Sprite 2 X position (low 8 bits)     | RW     |
| $D005 | 53253 | M2Y    | Sprite 2 Y position                  | RW     |
| $D006 | 53254 | M3X    | Sprite 3 X position (low 8 bits)     | RW     |
| $D007 | 53255 | M3Y    | Sprite 3 Y position                  | RW     |
| $D008 | 53256 | M4X    | Sprite 4 X position (low 8 bits)     | RW     |
| $D009 | 53257 | M4Y    | Sprite 4 Y position                  | RW     |
| $D00A | 53258 | M5X    | Sprite 5 X position (low 8 bits)     | RW     |
| $D00B | 53259 | M5Y    | Sprite 5 Y position                  | RW     |
| $D00C | 53260 | M6X    | Sprite 6 X position (low 8 bits)     | RW     |
| $D00D | 53261 | M6Y    | Sprite 6 Y position                  | RW     |
| $D00E | 53262 | M7X    | Sprite 7 X position (low 8 bits)     | RW     |
| $D00F | 53263 | M7Y    | Sprite 7 Y position                  | RW     |
| $D010 | 53264 | MSIGX  | Sprite X position MSBs (bit 8)       | RW     |
| $D011 | 53265 | SCROLY | Screen control register 1 / Y scroll | RW     |
| $D012 | 53266 | RASTER | Raster line counter / compare        | RW     |
| $D013 | 53267 | LPENX  | Light pen X position (latched)       | R      |
| $D014 | 53268 | LPENY  | Light pen Y position (latched)       | R      |
| $D015 | 53269 | SPENA  | Sprite enable                        | RW     |
| $D016 | 53270 | SCROLX | Screen control register 2 / X scroll | RW     |
| $D017 | 53271 | YXPAND | Sprite Y expansion                   | RW     |
| $D018 | 53272 | VMCSB  | Memory pointers (video matrix / char)| RW     |
| $D019 | 53273 | VICIRQ | Interrupt status / latch             | RW     |
| $D01A | 53274 | IRQMSK | Interrupt mask / enable              | RW     |
| $D01B | 53275 | SPBGPR | Sprite-to-background priority        | RW     |
| $D01C | 53276 | SPMC   | Sprite multicolor enable             | RW     |
| $D01D | 53277 | XXPAND | Sprite X expansion                   | RW     |
| $D01E | 53278 | SPSPCL | Sprite-sprite collision              | R      |
| $D01F | 53279 | SPBGCL | Sprite-background collision          | R      |
| $D020 | 53280 | EXTCOL | Border color                         | RW     |
| $D021 | 53281 | BGCOL0 | Background color 0                   | RW     |
| $D022 | 53282 | BGCOL1 | Background color 1 (MCM/ECM)         | RW     |
| $D023 | 53283 | BGCOL2 | Background color 2 (MCM/ECM)         | RW     |
| $D024 | 53284 | BGCOL3 | Background color 3 (ECM only)        | RW     |
| $D025 | 53285 | SPMC0  | Sprite multicolor shared 0           | RW     |
| $D026 | 53286 | SPMC1  | Sprite multicolor shared 1           | RW     |
| $D027 | 53287 | SP0COL | Sprite 0 individual color            | RW     |
| $D028 | 53288 | SP1COL | Sprite 1 individual color            | RW     |
| $D029 | 53289 | SP2COL | Sprite 2 individual color            | RW     |
| $D02A | 53290 | SP3COL | Sprite 3 individual color            | RW     |
| $D02B | 53291 | SP4COL | Sprite 4 individual color            | RW     |
| $D02C | 53292 | SP5COL | Sprite 5 individual color            | RW     |
| $D02D | 53293 | SP6COL | Sprite 6 individual color            | RW     |
| $D02E | 53294 | SP7COL | Sprite 7 individual color            | RW     |
| $D02F | 53295 | —      | Unused — reads $FF, writes ignored   | R      |

Addresses $D02F–$D03F are unused and read $FF. The 64-byte window is
repeated 16 times across $D000–$D3FF (15 further images at $D040–$D3FF).
Code should never rely on the mirrors. They come from incomplete address
decoding.

### Color RAM and the wider VIC address window

| Range         | Length | Description                              |
|---------------|--------|------------------------------------------|
| $D000–$D02E   | 47 B   | VIC-II registers                         |
| $D02F–$D03F   | 17 B   | Unused — read $FF, writes ignored        |
| $D040–$D3FF   | 960 B  | 15 further mirrors of $D000–$D03F        |
| $D800–$DBFF   | 1024 B | Color RAM (4 bits per cell, upper nibble reads as garbage) |

The Color RAM is described in detail in [Color RAM](#color-ram).

## Register reference

Each register address in $D000–$D02F has its own entry below. Bit fields
are described inline. Reset behavior other than "cleared to 0 on reset"
is stated.

### $D000 — M0X — Sprite 0 X position (RW)

**Chip:** VIC-II

Low 8 bits of sprite 0 horizontal position. Bit 8 of the X position lives
in $D010 bit 0. Coordinate space is 0–511 with the visible display roughly
spanning 24..343 in non-CSEL-trimmed mode; X = 0 is well off the left edge
of the visible screen. Write at any time; the new position takes effect
the next time the sprite's DMA fetch occurs.

### $D001 — M0Y — Sprite 0 Y position (RW)

**Chip:** VIC-II

Sprite 0 vertical position (8 bits, 0–255). The register holds the raster
line on which the sprite's DMA is switched on; its first pixel row is
displayed on the NEXT line, so the sprite occupies raster lines
Y + 1 .. Y + 21 (Y + 1 .. Y + 42 if vertically expanded via $D017). Y = 50
therefore puts the top of the sprite on line 51, the first line of the
25-row text display, and Y = 249 shows a single row on line 250 before the
lower border covers the rest. An earlier revision of this entry said
Y .. Y + 20, one line too high. Measured in VICE x64sc 3.10 on the PAL
C64C (VIC-II 8565, VICE's default) and NTSC 6567R8 models (an earlier version said the VICE PAL run was a 6569; `x64sc -default` is the C64C: 8565, 8580, 8521); the DMA-on-line-Y / display-on-line-Y+1
mechanism is from Bauer's VIC article, not measured here.

### $D002 — M1X — Sprite 1 X position (RW)

**Chip:** VIC-II

Sprite 1 horizontal position, low 8 bits. MSB in $D010 bit 1.

### $D003 — M1Y — Sprite 1 Y position (RW)

**Chip:** VIC-II

Sprite 1 vertical position.

### $D004 — M2X — Sprite 2 X position (RW)

**Chip:** VIC-II

Sprite 2 horizontal position, low 8 bits. MSB in $D010 bit 2.

### $D005 — M2Y — Sprite 2 Y position (RW)

**Chip:** VIC-II

Sprite 2 vertical position.

### $D006 — M3X — Sprite 3 X position (RW)

**Chip:** VIC-II

Sprite 3 horizontal position, low 8 bits. MSB in $D010 bit 3.

### $D007 — M3Y — Sprite 3 Y position (RW)

**Chip:** VIC-II

Sprite 3 vertical position.

### $D008 — M4X — Sprite 4 X position (RW)

**Chip:** VIC-II

Sprite 4 horizontal position, low 8 bits. MSB in $D010 bit 4.

### $D009 — M4Y — Sprite 4 Y position (RW)

**Chip:** VIC-II

Sprite 4 vertical position.

### $D00A — M5X — Sprite 5 X position (RW)

**Chip:** VIC-II

Sprite 5 horizontal position, low 8 bits. MSB in $D010 bit 5.

### $D00B — M5Y — Sprite 5 Y position (RW)

**Chip:** VIC-II

Sprite 5 vertical position.

### $D00C — M6X — Sprite 6 X position (RW)

**Chip:** VIC-II

Sprite 6 horizontal position, low 8 bits. MSB in $D010 bit 6.

### $D00D — M6Y — Sprite 6 Y position (RW)

**Chip:** VIC-II

Sprite 6 vertical position.

### $D00E — M7X — Sprite 7 X position (RW)

**Chip:** VIC-II

Sprite 7 horizontal position, low 8 bits. MSB in $D010 bit 7.

### $D00F — M7Y — Sprite 7 Y position (RW)

**Chip:** VIC-II

Sprite 7 vertical position.

### $D010 — MSIGX — Sprite X position MSBs (RW)

**Chip:** VIC-II

Bit 8 of each sprite's X coordinate. Read-modify-write to move a single
sprite across the X=255 boundary.

| Bit | Name | Description                          |
|-----|------|--------------------------------------|
| 7   | M7X8 | Sprite 7 X position MSB              |
| 6   | M6X8 | Sprite 6 X position MSB              |
| 5   | M5X8 | Sprite 5 X position MSB              |
| 4   | M4X8 | Sprite 4 X position MSB              |
| 3   | M3X8 | Sprite 3 X position MSB              |
| 2   | M2X8 | Sprite 2 X position MSB              |
| 1   | M1X8 | Sprite 1 X position MSB              |
| 0   | M0X8 | Sprite 0 X position MSB              |

To position a sprite at X = 320 (center-ish), write $40 to
the sprite's low-byte X register and OR the corresponding bit into $D010.

### $D011 — SCROLY — Screen control register 1 (RW)

**Chip:** VIC-II

The most-poked register on the C64. Combines the Y-scroll fine offset,
display geometry, the master enable, the mode bits, and the raster compare
MSB.

| Bit | Name  | Description                                        |
|-----|-------|----------------------------------------------------|
| 7   | RST8  | Bit 8 of the raster compare value (read: raster bit 8) |
| 6   | ECM   | Extended background color mode enable              |
| 5   | BMM   | Bitmap mode enable                                 |
| 4   | DEN   | Display enable (must be set on raster line $30 to allow badlines for the frame) |
| 3   | RSEL  | Row select: 1 = 25 rows / 200 px tall, 0 = 24 rows / 192 px |
| 2-0 | YSCROLL | Vertical fine scroll, 0–7 lines                  |

Reading $D011 returns the *current* raster line's bit 8 in bit 7 (it is
not the value last written; it is overlaid with the live raster MSB). To
program a raster IRQ at line ≥ 256, set $D012 to (line & $FF), read
$D011, clear bit 7, OR in ((line >> 8) & 1) << 7, and write it back.

DEN must be set at some point during raster line $30 (decimal 48) for
badlines to be enabled for the frame. The chip accepts the bit on any cycle
of that line (Bauer §3.5, not measured cycle-by-cycle here); in VICE x64sc
a write landing anywhere from about cycle 18 to cycle 57 of line $30 still
enabled every badline of the frame, and the same write on line $31 enabled
none. An earlier version of this page said DEN had to be 1 during cycle 14
specifically. Holding DEN clear for the whole of line $30 removes every
badline of that frame. Clearing DEN does not show the background colour:
the vertical border flip-flop is reset only if DEN is set at cycle 63 of
the top comparison line (51 with RSEL = 1, 55 with RSEL = 0), so with DEN
clear across that line the border colour ($D020) covers the whole screen,
sprites hidden under it (measured in VICE x64sc; an earlier version of
this page said the interior turned to the background colour). The two
samples are independent: DEN clear on line $30 but set again before line
51 gives a frame with no badlines whose window still opens on idle-state
graphics (BGCOL0 where $3FFF is 0, sprites visible); DEN set on line $30
but clear across line 51 gives a frame with badlines whose window never
opens. Clearing DEN after line $30 does not stop the remaining badlines
of that frame, and clearing it after line 51 has no effect at all until
the next frame: display state, border and sprites all continue
(measured in VICE x64sc).

YSCROLL = 3 is the default, set by the KERNAL boot screen. The badline
condition is "current raster ≥ $30, ≤ $F7, and bottom 3 bits == YSCROLL,
and DEN was set on line $30". Changing YSCROLL therefore shifts every
badline by the corresponding number of lines.

### $D012 — RASTER — Raster line counter / compare (RW)

**Chip:** VIC-II

Reading returns the low 8 bits of the current raster line; the high bit
lives in $D011 bit 7. Writing programs the *compare* value for raster
interrupts (low 8 bits); the MSB to compare lives in $D011 bit 7.

The raster line counter increments at the start of cycle 1 of each line
except for line 0, where it increments one cycle later. This one-cycle
offset can break tightly timed stable-raster code. See the
[Raster system](#raster-system).

PAL line range: 0..311. NTSC R8 line range: 0..262. NTSC R56A: 0..261.

### $D013 — LPENX — Light pen X position (R)

**Chip:** VIC-II

X coordinate latched the last time the LP pin (CIA1 PB4) went low. Value
is X/2; the chip's horizontal counter divided by 2 to fit 8 bits. The
light pen latch fires *once per frame*; reads after the first latch return
the same value until the next vertical blanking interval. With no light
pen attached this register reflects whatever spurious LP events the
joystick fire button on port 1 caused (joystick fire on port 1 is tied to
the LP pin).

### $D014 — LPENY — Light pen Y position (R)

**Chip:** VIC-II

Y coordinate latched at the same instant as $D013. Full 8-bit raster line
number; the latch only captures the bottom 8 bits so lines ≥ 256 wrap.

### $D015 — SPENA — Sprite enable (RW)

**Chip:** VIC-II

Per-sprite enable. Bit n enables sprite n. A disabled sprite still has its
DMA pointer fetched (one p-access per line), but the three s-accesses are
skipped, freeing the CPU to use those cycles. Clearing this register
disables all eight sprites simultaneously.

| Bit | Name | Description           |
|-----|------|-----------------------|
| 7-0 | Mn E | Sprite n enable (bit n)|

### $D016 — SCROLX — Screen control register 2 (RW)

**Chip:** VIC-II

Holds the X-scroll, column-select, and MCM toggle. Bits 6 and 7 read
back as 1 on every variant. They are unimplemented, although some sources
include them in masks.

| Bit | Name  | Description                                       |
|-----|-------|---------------------------------------------------|
| 7,6 | —     | Unused (always read 1)                            |
| 5   | RES   | Hardware reset of VIC-II video shift register (reserved; never works as intended on production chips) |
| 4   | MCM   | Multicolor mode enable                            |
| 3   | CSEL  | Column select: 1 = 40 cols / 320 px wide, 0 = 38 cols / 304 px |
| 2-0 | XSCROLL | Horizontal fine scroll, 0–7 pixels              |

Setting CSEL = 0 narrows the window from X 24–343 to X 31–334, 16 pixels
in all: 7 extra border pixels on the left and 9 on the right (measured in
VICE x64sc; an earlier version of this page said 8 on each side). Those
two strips are where the *border* is drawn but the chip's display
sequencer never starts; the side-borders-open technique relies on them.

### $D017 — YXPAND — Sprite Y expansion (RW)

**Chip:** VIC-II

Per-sprite vertical 2× expansion. When bit n is set, sprite n renders each
of its 21 lines twice for a total of 42 visible lines. The expansion
*toggle* flag is internal. Clearing $D017 on the raster line where the
chip would apply the toggle triggers the sprite crunch bug (see
[Pitfalls](#pitfalls)).

| Bit | Name | Description           |
|-----|------|-----------------------|
| 7-0 | Mn YE| Sprite n Y expansion  |

### $D018 — VMCSB — Memory pointers (RW)

**Chip:** VIC-II

Selects, within the current VIC bank, the base addresses of the video
matrix and either the character generator (text modes) or bitmap (bitmap
modes).

| Bit | Name  | Description                                        |
|-----|-------|----------------------------------------------------|
| 7-4 | VM    | Video matrix base / 1024 within the VIC bank (bits 0–3 of pointer) |
| 3-1 | CB    | In text mode: character generator base / 2048. In bitmap mode: bit 2 selects $0000 or $2000 within the bank |
| 0   | —     | Unused (reads 1)                                   |

Computed addresses inside the VIC bank:

```
video matrix base = (VM3..VM0) * $0400        ; 16 possible positions
char base (text)  = (CB2..CB0) * $0800        ; 8 possible positions
bitmap base       = (CB2) * $2000             ; 2 possible positions
```

The default kernal screen is at $0400 (VM = %0001 = 1) with charrom
shadowed at $1000 (CB = %010 = 2) in bank 0.

The character generator ROM appears only in VIC banks 0 and 2, at
$1000–$1FFF and $9000–$9FFF respectively. Banks 1 and 3 need a character
set in RAM. See
[Memory access](#memory-access).

### $D019 — VICIRQ — Interrupt status / latch (RW)

**Chip:** VIC-II

Latched IRQ source flags. Bits 7 and 4–6 ordinarily read 0/1 depending
on chip state. To acknowledge an IRQ, write a 1 to the corresponding
latch bit (write to clear).

| Bit | Name | Description                                       |
|-----|------|---------------------------------------------------|
| 7   | IRQ  | 1 = at least one enabled source is pending (IRQ line asserted) |
| 6-4 | —    | Unused, read 1                                    |
| 3   | ILP  | Light pen latch fired                             |
| 2   | IMMC | Sprite-sprite collision latched                   |
| 1   | IMBC | Sprite-background collision latched               |
| 0   | IRST | Raster compare matched                            |

Acknowledging is mandatory: until the latch bit is cleared, the chip keeps
asserting IRQ at the start of every cycle.

### $D01A — IRQMSK — Interrupt mask / enable (RW)

**Chip:** VIC-II

Per-source IRQ enable. Mirrors the layout of $D019 bits 3–0. Setting a bit
allows the corresponding latch in $D019 to assert the IRQ output.

| Bit | Name | Description                          |
|-----|------|--------------------------------------|
| 7-4 | —    | Unused                               |
| 3   | ELP  | Enable light pen IRQ                 |
| 2   | EMMC | Enable sprite-sprite collision IRQ   |
| 1   | EMBC | Enable sprite-background collision IRQ |
| 0   | ERST | Enable raster IRQ                    |

Reset value is 0 (all disabled), and the KERNAL leaves it there: its VIC
init table ($ECB9, copied to $D000–$D02E by the loop at $E5A8) writes $00
to $D01A, and nothing else in the KERNAL writes the register. After boot
it reads $F0 (measured in VICE x64sc; bits 7–4 read as 1). The system tick
is CIA1 timer A ($FDDD loads $4025 PAL / $4295 NTSC, $FF6E enables it with
$81 → $DC0D), not a raster IRQ. The compare line the KERNAL does leave is
311 ($D011 = $9B, $D012 = $37), which CINT uses once to tell PAL from NTSC
through the $D019 latch. An earlier version of this page said the KERNAL
enabled a raster IRQ at line 0 for the tick; it does not.

### $D01B — SPBGPR — Sprite-to-background priority (RW)

**Chip:** VIC-II

Per-sprite priority versus foreground pixels. Bit n = 0: sprite n appears
in front of foreground graphics (the default). Bit n = 1: sprite n appears
*behind* foreground pixels but still in front of background pixels.

| Bit | Name  | Description                              |
|-----|-------|------------------------------------------|
| 7-0 | Mn DP | Sprite n data priority                   |

Sprite-vs-sprite priority is fixed: sprite 0 is always in front of sprite
1, sprite 1 in front of sprite 2, etc. (lower index wins).

### $D01C — SPMC — Sprite multicolor enable (RW)

**Chip:** VIC-II

Per-sprite multicolor mode toggle.

| Bit | Name  | Description                              |
|-----|-------|------------------------------------------|
| 7-0 | Mn MC | Sprite n multicolor enable               |

When set, the sprite is rendered at half the horizontal resolution (12×21
double-wide pixels) with 4 colors instead of 24×21 with 2 colors. Color
mapping for multicolor sprites:

| 2-bit pattern | Color source                              |
|---------------|-------------------------------------------|
| %00           | Transparent                               |
| %01           | $D025 (sprite multicolor 0, shared)       |
| %10           | $D027 + n (sprite n individual color)     |
| %11           | $D026 (sprite multicolor 1, shared)       |

### $D01D — XXPAND — Sprite X expansion (RW)

**Chip:** VIC-II

Per-sprite horizontal 2× expansion. When bit n is set, sprite n is drawn
48 pixels wide instead of 24. With Y expansion as well the sprite is 48×42
and still costs 64 bytes of sprite data plus DMA.

| Bit | Name | Description           |
|-----|------|-----------------------|
| 7-0 | Mn XE| Sprite n X expansion  |

### $D01E — SPSPCL — Sprite-sprite collision (R)

**Chip:** VIC-II

Sprite-versus-sprite collision flags, latched. Bit n is set when any
non-transparent pixel of sprite n overlapped any non-transparent pixel of
any other sprite since the last read. Reading clears all bits in this
register (read-to-clear, *not* write-to-clear, unlike $D019).

If only one bit is set, no collision occurred: a bit is set only in the
presence of a second sprite. Read the register once per frame and test
for any nonzero value.

### $D01F — SPBGCL — Sprite-background collision (R)

**Chip:** VIC-II

Sprite-versus-foreground collision flags, latched. Bit n is set when any
non-transparent pixel of sprite n overlapped a foreground pixel of the
display: a 1 bit with MCM clear, or bit pair 10 or 11 with MCM set (pair 01
counts as background even though it is drawn in `$D022` or a screen RAM
colour; Bauer's VIC-II article, section 3.8.2; see "Priority" below).
Read-to-clear. Border and overscan pixels do not
count as foreground.

### $D020 — EXTCOL — Border color (RW)

**Chip:** VIC-II

Color register for the screen border. Only the low 4 bits matter; the
upper 4 bits read as 1. Border color can be changed mid-line for stripe
effects.

| Bit | Description                              |
|-----|------------------------------------------|
| 7-4 | Unused, read 1                           |
| 3-0 | Border color index, 0–15                 |

### $D021 — BGCOL0 — Background color 0 (RW)

**Chip:** VIC-II

The primary background color used in standard text, multicolor text,
multicolor bitmap, and (alongside three other regs) ECM modes. In
multicolor sprite mode this is *not* the sprite background; sprite
transparency is implicit. Bits 7–4 read 1.

### $D022 — BGCOL1 — Background color 1 (RW)

**Chip:** VIC-II

Used in multicolor text mode as the %01 color, in ECM as one of four
background colors selected by character code bits 6–7, and in multicolor
bitmap as the %01 color.

### $D023 — BGCOL2 — Background color 2 (RW)

**Chip:** VIC-II

Used in multicolor text mode as the %10 color, and in ECM/multicolor
bitmap analogously.

### $D024 — BGCOL3 — Background color 3 (RW)

**Chip:** VIC-II

Fourth ECM background color. Unused in standard text and multicolor
bitmap. In multicolor text mode this register is not used: the %11
color comes from the per-cell Color RAM nibble.

### $D025 — SPMC0 — Sprite multicolor 0 (RW)

**Chip:** VIC-II

Shared sprite multicolor #0. Used by every sprite that has $D01C bit n
set, as the %01 pixel color. Bits 7–4 read 1.

### $D026 — SPMC1 — Sprite multicolor 1 (RW)

**Chip:** VIC-II

Shared sprite multicolor #1. Used as the %11 pixel color in multicolor
sprites.

### $D027 — SP0COL — Sprite 0 color (RW)

**Chip:** VIC-II

Sprite 0 individual color. In hires sprite mode this is the only non-
transparent color. In multicolor sprite mode this is the %10 color.

### $D028 — SP1COL — Sprite 1 color (RW)

**Chip:** VIC-II

Sprite 1 individual color.

### $D029 — SP2COL — Sprite 2 color (RW)

**Chip:** VIC-II

Sprite 2 individual color.

### $D02A — SP3COL — Sprite 3 color (RW)

**Chip:** VIC-II

Sprite 3 individual color.

### $D02B — SP4COL — Sprite 4 color (RW)

**Chip:** VIC-II

Sprite 4 individual color.

### $D02C — SP5COL — Sprite 5 color (RW)

**Chip:** VIC-II

Sprite 5 individual color.

### $D02D — SP6COL — Sprite 6 color (RW)

**Chip:** VIC-II

Sprite 6 individual color.

### $D02E — SP7COL — Sprite 7 color (RW)

**Chip:** VIC-II

Sprite 7 individual color.

### $D02F — UNUSED — Unused, reads $FF (R)

**Chip:** VIC-II

This address is unimplemented on the VIC-II. It always reads $FF and
silently ignores writes. The MOS 8564 / 8566 VIC-IIe (C128 only)
implements it as the extra-keyboard row-select register (K0–K2 in bits
0–2, the upper bits read back as 1; the C128 KERNAL's keyboard scanner
drives it alongside CIA 1 port A and reads the rows back on CIA 1 port B)
and implements $D030 as the 2 MHz / test register (bit 0 = 2 MHz, which is
what BASIC 7.0's FAST and SLOW write). An earlier revision of this page
called $D02F a "mode-control register (50/60 Hz, fast-mode)"; that was
wrong: fast mode is $D030 bit 0, and the C128 ROM writes $D02F only from
its keyboard scanner. Measured in VICE x128 and read from the C128 ROMs
(318020-05 keyboard scan at $C56B–$C597; BASIC 7.0 FAST/SLOW at
$77B3/$77C4). On the C64's VIC-II both addresses are unimplemented.

## Display modes

The VIC-II's display sequencer can run in one of four combinations of two
mode bits ECM ($D011 bit 6) and BMM ($D011 bit 5), each in either single-
color or multicolor (MCM = $D016 bit 4). That gives eight combinations,
but only six are "legal" (well documented and useful). The other two are
the *illegal* or *invalid* modes, which produce solid color output and
are useful only as oddities.

| BMM | ECM | MCM | Mode name                  |
|-----|-----|-----|----------------------------|
| 0   | 0   | 0   | Standard text mode         |
| 0   | 0   | 1   | Multicolor text mode       |
| 0   | 1   | 0   | Extended color text mode (ECM) |
| 0   | 1   | 1   | Invalid (ECM + MCM text) — output is black |
| 1   | 0   | 0   | Standard bitmap mode (hires) |
| 1   | 0   | 1   | Multicolor bitmap mode     |
| 1   | 1   | 0   | Invalid (ECM bitmap) — output is black |
| 1   | 1   | 1   | Invalid (ECM + MCM bitmap) — output is black |

In all cases the chip outputs 320×200 pixels of content within the
RSEL = 1, CSEL = 1 window. Multicolor modes halve horizontal
resolution to 160×200 pixels.

### Standard text mode (ECM=0, BMM=0, MCM=0)

The default. 40 columns × 25 rows of 8×8 character cells, each cell drawn
from a 2K character generator pointed to by $D018 bits 3–1. Each character
cell has two colors:

- **Background**: $D021 (BGCOL0), global.
- **Foreground**: the low 4 bits of the matching Color RAM byte at
  $D800 + (row × 40) + col.

Character codes are 8-bit values stored in the video matrix (default
$0400–$07E7). The character generator is its own 4 KB ROM (901225,
separate from the 8 KB KERNAL ROM), which the CPU can read at $D000–$DFFF
only while CHAREN ($01 bit 2) is 0. The VIC never sees it at that address:
it appears to the VIC at $1000–$1FFF in bank 0 and $9000–$9FFF in bank 2,
and nowhere in banks 1 and 3. The default $D018 = $14 (CB = 2) therefore
selects the uppercase/graphics set from its first 2 KB; CB = 3
($D018 = $16) selects the lowercase/uppercase set from its second 2 KB. An
earlier revision of this paragraph called it "the KERNAL ROM character set
at $D000 in VIC bank 0/2": $D000 is a CPU-side address the VIC cannot
form, and pointing the VIC at CPU $D000 (bank 3, CB = 2) reads RAM,
measured in VICE x64sc (default C64C model, VIC-II 8565), not on a bench.

Cell address inside the character generator:

```
cell_addr = char_base + (char_code * 8) + row_within_cell
```

The chip fetches one character pointer (c-access) per cell during the
badline of each text row, caches it in an internal 40×12-bit row buffer,
and then performs eight g-accesses per cell over the next eight raster
lines to read the pixel data.

### Multicolor text mode (ECM=0, BMM=0, MCM=1)

Same character matrix and same character generator as standard text mode.
The interpretation of cells depends on the color RAM nibble.

If the high color RAM bit (bit 3) is **clear**, the cell renders exactly
like standard text mode (high resolution, 2-color, foreground = color RAM
bits 0–2).

If the high bit is **set**, the cell renders as multicolor: 4×8 double-
wide pixels with this color map:

| Bit pattern | Color source                              |
|-------------|-------------------------------------------|
| %00         | $D021 (BGCOL0)                            |
| %01         | $D022 (BGCOL1)                            |
| %10         | $D023 (BGCOL2)                            |
| %11         | Color RAM bits 0–2 (foreground)           |

In multicolor text mode a cell has only 8 possible foreground colors
(colors 0–7), not the full 16. Multicolor and standard text cells can be
mixed on one screen by choosing which cells have the color RAM high bit
set.

### Extended color mode (ECM) text (ECM=1, BMM=0, MCM=0)

Each character cell still has 8×8 hi-res pixels, but the top two bits of
the character code are used to select one of four background colors,
leaving only 64 distinct glyph codes:

| Char code bits 7–6 | Background        |
|--------------------|-------------------|
| %00 (0–63)         | $D021 (BGCOL0)    |
| %01 (64–127)       | $D022 (BGCOL1)    |
| %10 (128–191)      | $D023 (BGCOL2)    |
| %11 (192–255)      | $D024 (BGCOL3)    |

Foreground color still comes from Color RAM. Games use it for per-region
background colors; the cost is the loss of 192 of the 256 glyphs.

### Standard bitmap mode (ECM=0, BMM=1, MCM=0)

8000 bytes (320×200/8) of bitmap data with per-8×8-cell foreground/
background colors stored in the video matrix.

- Bitmap base: $0000 or $2000 within the VIC bank, selected by $D018 bit 3.
- Video matrix base: any 1K boundary in the VIC bank, selected by $D018
  bits 7–4.

Each video matrix byte holds two color nibbles for one 8×8 cell:

| Bits | Use                                  |
|------|--------------------------------------|
| 7-4  | Foreground color (set bits in bitmap)|
| 3-0  | Background color (clear bits)        |

Color RAM is not used in hires bitmap mode. Pixel addresses inside the
bitmap:

```
byte_addr = bitmap_base + (cell_row * 320) + (cell_col * 8) + row_in_cell
```

### Multicolor bitmap mode (ECM=0, BMM=1, MCM=1)

Same bitmap addressing as hires bitmap; same video matrix layout for two
colors per cell; *plus* the Color RAM nibble for a third per-cell color;
plus $D021 BGCOL0 as the shared fourth color.

| Bit pattern | Color source                              |
|-------------|-------------------------------------------|
| %00         | $D021 (BGCOL0)                            |
| %01         | Video matrix byte high nibble             |
| %10         | Video matrix byte low nibble              |
| %11         | Color RAM low nibble                      |

Horizontal resolution drops to 160 double-wide pixels. Most C64 pictures
are multicolor bitmaps.

### Illegal display modes

Setting ECM+MCM together, or BMM+ECM together, puts the chip into an
"invalid" mode. The display sequencer still runs, but the pixel data
output is forced to black. Collisions and sprites still work. Switching
to an invalid mode briefly blanks the display
without touching DEN (a DEN clear only blanks the frame if it is clear on
line $30 and line 51, which also removes the frame's badlines and hides
the sprites under the border; sprite DMA and collisions are unaffected by
DEN either way; measured in VICE x64sc).

### Mode-switch timing

The mode bits ECM, BMM, MCM are sampled by the display sequencer every
cycle. Switching modes mid-line therefore changes pixels mid-row at
character-cell boundaries. This is the foundation of FLI (Flexible Line
Interpretation), AGSP, and other extra-color tricks. The
c-accesses for the *next* line happen during cycles 15–54 of the
previous badline, so a mode switch on cycle 14 of the current line affects
pixel rendering immediately.

## Sprites

The VIC-II provides eight hardware sprites. Each sprite is 24×21 pixels
in hires mode or 12×21 (double-width) in multicolor mode, with optional
2× horizontal and/or 2× vertical expansion. Sprites are independent of
text/bitmap modes; the same eight sprites are available in every mode.

### Sprite data layout

Each sprite consumes 63 bytes of memory plus 1 byte of padding (total 64).
The 63 bytes form a 24-pixel-wide, 21-line image:

```
byte 0  byte 1  byte 2     <- first scanline of sprite
byte 3  byte 4  byte 5     <- second scanline
...
byte 60 byte 61 byte 62    <- 21st scanline
byte 63 unused
```

In hires mode each bit is a pixel: 1 = sprite color from $D027 + n, 0 =
transparent. In multicolor mode each pair of bits is a pixel (12 pixels
per line) using the color map under [$D01C](#d01c--spmc--sprite-multicolor-enable-rw).

### Sprite pointers

Each enabled sprite reads a pointer byte once per raster line from the
last 8 bytes of the video matrix. The pointer × 64 is the address (inside
the VIC bank) where the sprite's 63 bytes of pixel data begin.

```
pointer_addr = video_matrix_base + $3F8 + sprite_index
sprite_data_addr = (pointer_value) * 64
```

With the default screen at $0400, the eight pointer bytes live at
$07F8–$07FF. Writing a pointer of $80 places the sprite data at
$80 × 64 = $2000.

### Positioning

X is 9-bit (0–511) split between $D000+2n and $D010 bit n. Y is 8-bit
(0–255) in $D001+2n. The visible 200-line display occupies Y = 50 (top of
character row 0) through Y = 249 inclusive, with Y = 250 the first value
whose top row falls in the lower border (raster line 251; raster line 250
itself is the last display line). To place a sprite on top of character
row r,
column c (cell coordinates), the formula is:

```
sprite_X = 24 + c * 8        ; offset 24 because X = 0 is well off-screen
sprite_Y = 50 + r * 8
```

### Expansion

`$D017` and `$D01D` toggle vertical and horizontal 2× expansion per
sprite. The expansion takes effect immediately on the X axis (next pixel
shifted is doubled), but on Y axis the chip uses an internal "expansion
flip-flop" that toggles each line. Changing $D017 mid-line can upset
the flip-flop and cause sprite crunch (variable-height sprites, used on
purpose in some demos and seen by accident in some bugs).

### Multicolor

Setting bit n in $D01C makes sprite n multicolor: 12-pixel horizontal
resolution, 4-color (one transparent, plus three pickable). See the
[$D01C](#d01c--spmc--sprite-multicolor-enable-rw) entry for the color map.

### Priority

Sprite-sprite priority is fixed: index 0 wins over 1, 1 over 2, etc.;
sprite 0 always renders in front of sprite 7 when they overlap.

Sprite-background priority is per-sprite via $D01B. When bit n = 0
(default), sprite n appears in front of foreground graphics. When bit
n = 1, sprite n appears *behind* foreground but still in front of
background.

Each pixel has these layers from back to front:

```
background  <-  [sprites with $D01B bit set]  <-  foreground  <-  [sprites with $D01B bit clear]  <-  border
```

The border is the front-most layer: it hides sprites unless it is opened
(measured in VICE x64sc; an earlier version of this page drew it at the
back).

"Background" for sprite priority and for `$D01F` is decided by the pixel's
bit pattern, not its colour register. With MCM clear (standard text, ECM,
standard bitmap), a 0 bit is background and a 1 bit is foreground. With MCM
set (multicolour text cells and multicolour bitmap), bit pairs 00 and 01 are
background and 10 and 11 are foreground, whatever colour 01 draws in
(`$D022` in multicolour text, the screen RAM high nibble in multicolour
bitmap). A sprite with its `$D01B` bit clear is drawn over all of these; with
the bit set, 00 and 01 pixels show the sprite through. Measured in VICE
x64sc in multicolour text by the `oscar64/mixed-fighters` recipe (pair 01
showed the sprite, pairs 10 and 11 covered it); Bauer's VIC-II article,
section 3.8.2, gives the same table
(http://www.zimmers.net/cbmpics/cbm/c64/vic-ii.txt). An earlier version of
this paragraph defined background as the pixels drawn in `$D021` (and
BGCOL1-3 in multicolour bitmap or ECM), which counted `$D022` pixels in
multicolour text as foreground and named the wrong source for bitmap
colour 01.

### Collisions

Two collision registers latch at pixel-by-pixel resolution:

- **$D01E**: any non-transparent pixel of sprite n overlaps a non-
  transparent pixel of any other sprite.
- **$D01F**: any non-transparent pixel of sprite n overlaps a foreground
  pixel of the background graphics.

Each is read-to-clear. If the corresponding IRQ enable bit in $D01A is
set, the first collision per latch interval also triggers an IRQ via
$D019. Border pixels and the screen blanking area do not generate
collisions.

The *latch interval* spans from the previous read to the current read. If
the register is not read at all during a frame, a collision that happens
and then resolves is lost.

### Sprite DMA

For each sprite that is enabled or in the middle of its 21-line render,
the VIC-II steals additional cycles from the CPU on its raster lines. The
exact pattern:

1. One **p-access** (pointer fetch) per raster line, always, regardless of
   enable state, on cycles 58, 60, 62, 1, 3, 5, 7, 9 for sprites 0–7 on
   PAL, measured in VICE x64sc on its default C64C model, VIC-II 8565 (an
   earlier version said 6569): with sprites 0..k active the CPU
   resumes two cycles after sprite k's slot (60, 1, 3, 9, 11 for
   k = 0, 2, 3, 6, 7). On the 65-cycle 6567R8 the slots are 60, 62, 64,
   1, 3, 5, 7, 9 (from Bauer's tables; only the relative structure,
   eight contiguous two-cycle slots ending on cycle 10, was reproduced
   here). An earlier version of this page listed 58, 60, 62, 64, 1, 3, 5,
   7, which puts a cycle 64 on a 63-cycle line and sprite 7 two cycles
   early.
2. Three **s-accesses** (sprite data fetch) per raster line, but only when
   that sprite's render row is active. These follow each sprite's
   p-access slot.

With all eight sprites active the chip steals 3 (BA lead-in before
sprite 0, usable only for write cycles) + 8 × 2 (two bus cycles of
s-accesses per sprite; the p-access is a phi1 access and costs the CPU
nothing) = up to 19 cycles per line on top of any badline overhead,
leaving the CPU ~44 of the 63 PAL cycles (~46 of 65 on NTSC). An earlier
version of this page wrote the sum as (8 × 2 + 8 × 1), which is 24 and
counted the free p-access as a stolen cycle; the 19 is measured in VICE
x64sc (399 cycles over the 21 DMA lines of eight sprites, 105 for one
sprite, 210 for sprites 0 and 7 as two separate BA groups). This is why
full-screen multiplexers of more than 8 sprites have to do their pointer
rewrites during specific cycle windows.

The VIC-II asserts BA (Bus Available) low three cycles before each sprite
fetch. The CPU then completes its current memory cycle and releases the
bus on the next read cycle. Write cycles are not blocked by BA, so the
CPU continues to execute write instructions for up to three additional
cycles before the chip actually steals the bus.

### Number-of-sprites limits

A single VIC-II shows eight sprites *per scanline*. The classic
multiplexer technique reuses sprites across vertical bands by rewriting
their Y position and pointer during the lines between bands. Modern
multiplexer routines show 16–24 sprites per frame.

The hardware enforces no limit beyond 8 simultaneous sprites. A sprite
moved while it is rendering shows the new value on the next line it is
fetched, which is what makes multiplexing work.

## Raster system

The VIC-II's raster engine ticks once per character pixel column, and
its interaction with the CPU bus is deterministic. Stable rasters,
hardware scrolling, FLD/FLI/CRT effects, and sprite multiplexing all
depend on what this section describes.

### Raster line counter

`$D012` holds the low 8 bits of the current line; bit 7 of $D011 holds
bit 8. The counter increments at the start of cycle 1 of each raster line
*except* line 0, where it ticks one cycle later. This off-by-one is
documented in Bauer's article and is why some stable-raster code
double-checks the counter on the cycle after it expects an increment.

Line numbering on a PAL 6569:

| Line range | Region                                          |
|------------|-------------------------------------------------|
| 0..15      | Top border (with VBI)                           |
| 16..50     | Top border                                      |
| 51..250    | Visible 25-row display window (RSEL = 1)        |
| 55..246    | Visible 24-row display window (RSEL = 0)        |
| 251..299   | Bottom border                                   |
| 300..311   | Bottom border (with VBI)                        |

NTSC line numbering is similar but with fewer lines below 0 and a
different total (262 or 263).

### Raster IRQ

Write the desired compare line into $D012 (low 8 bits) and into $D011
bit 7 (bit 8), enable raster IRQ in $D01A bit 0, and the chip will pull
its IRQ output low at the start of cycle 1 of that line (cycle 2 for
line 0). The CPU sees this as a normal 6502/6510 IRQ and vectors via
($FFFE/$FFFF) or via $0314/$0315 if the KERNAL IRQ handler at $EA31 is
in place.

The handler **must** acknowledge by writing 1 to bit 0 of $D019, or the
IRQ re-fires as soon as it executes RTI.

Two-byte raster compare write sequence (canonical):

```
lda #target_line_lo
sta $d012
lda $d011
and #$7f
ora #(target_line_hi_bit << 7)
sta $d011
```

Do not skip the second step, even for target lines below 256. The KERNAL's
VIC init (the table at $ECB9, copied to $D000–$D02E by $E5A0 during CINT)
writes $9B to $D011, so after boot RST8 = 1 and the compare value is $137.
A program that writes only $D012 gets its interrupt on line target+256 if
that line exists (PAL lines 256..311, i.e. targets 0..55) and otherwise
never. Measured in VICE x64sc 3.10: with $D011 untouched, $D012 = $64 gave
0 IRQs in 20 frames on both PAL and NTSC; $D012 = $30 gave one IRQ per
frame at line $130 (304) on PAL and none on NTSC; after
`lda $d011 / and #$7f / sta $d011` the $64 target fired once per frame at
line 100 on both. Always do the read-modify-write above. An earlier
version of this page said the step could be skipped below 256 because
bit 7 "should already be 0"; it is 1 after boot.

### Badlines

A badline is a raster line on which the chip must perform 40 c-accesses
(character pointer + Color RAM fetches) to load the next row's video
matrix into its internal row buffer. The condition is:

```
($30 <= raster <= $F7) AND (raster & 7 == YSCROLL) AND DEN was set on $30
```

PAL line $30 is decimal 48; $F7 is 247. With the default YSCROLL = 3,
badlines occur on lines 51, 59, 67, ..., 243: every 8 lines, once per
character row.

On a badline the chip pulls BA low at cycle 12 to warn the CPU, then
takes the bus from cycle 15 through cycle 54. Total stolen cycles: 40,
plus up to 3 cycles of CPU "tail" before BA actually takes hold (because
the CPU finishes its current read instruction). Effective CPU budget on a
badline: 63 - 43 = 20 cycles on PAL.

Badlines are *prevented* for a whole frame by keeping DEN ($D011 bit 4)
clear for the whole of raster line $30 (48); setting it on any cycle of
that line re-enables them (an earlier version said "before cycle 14"). The
chip then stays in idle state for the frame; the screen shows the border
colour ($D020) if DEN is still clear at cycle 63 of line 51 (the vertical
border flip-flop is never reset), or the idle-state $3FFF picture (BGCOL0
/ idle-state graphics) if DEN was set again before line 51. Measured in
VICE x64sc; an earlier version of this page said the display turns to
BGCOL0. Clearing DEN after line $30 does not stop the remaining badlines
of that frame.

Changing YSCROLL *shifts* badlines; changing YSCROLL on the badline
immediately before *delays one badline*. FLD (Flexible Line Distance)
and other vertical-stretch tricks are built on this.

### c-access, g-access, p-access, s-access

The chip performs four kinds of memory access:

| Access | When                                  | What is read                |
|--------|---------------------------------------|----------------------------|
| c      | Cycles 15–54 of every badline         | Char pointer + color RAM nibble (12-bit) |
| g      | Cycles 16–55 of every visible line    | 8 bits of pixel data (char gen or bitmap) |
| p      | Cycles 58, 60, 62, 1, 3, 5, 7, 9 (PAL); 60, 62, 64, 1, 3, 5, 7, 9 (6567R8) | Sprite pointer byte         |
| s      | After each p, when sprite is active   | 3 bytes of sprite pixel data |

The c- and g-accesses are pipelined so that the c-access on badline N
fetches the row that will be g-rendered on lines N+1..N+8 (or N..N+7 in
some sources depending on which line is "first"). The internal video
matrix latch holds these 40 12-bit entries until the next badline.

### Idle vs display state

The chip distinguishes two operating states:

- **Display state**: the c-access pipeline has data, g-accesses fetch from
  char gen or bitmap, and pixel output reflects the video matrix. Entered
  when a badline occurs and the chip is in the visible Y range.
- **Idle state**: c-accesses are skipped, the video matrix latch is
  zeroed out (so all cells read as 0), and g-accesses fetch from a fixed
  address ($3FFF, or $39FF if ECM is set). Pixel output is black
  (or whatever bit pattern is at $3FFF, with the current foreground/
  background colors).

The chip is in idle state whenever no badline has loaded the row buffer:
outside the display Y range, or for the whole frame when DEN was clear on
raster line $30. DEN itself is not consulted by the idle/display logic.
Clearing DEN later in the frame changes nothing for the rest of that
frame: badlines, display state, border and sprites all continue
(measured in VICE x64sc: DEN cleared on line 100, window fully displayed
and the badline count between lines 104 and 200 unchanged, 12 of 12). An
earlier version of this section said clearing DEN entered idle state. It
re-enters display state on the next badline.

The "$3FFF phantom pixels" picture is a whole-frame effect, not a
mid-frame strip: it appears when DEN is clear on line $30 (no badlines, so
the frame never leaves idle state) but set again by line 51 (so the
vertical border opens); the window then shows the byte at $3FFF ($39FF
with ECM) in colour 0 over $D021 on every line.

### Light pen latch

Pulling the LP pin (CIA1 PB4, also tied to joystick port 1 fire button)
low latches the current X (÷ 2) into $D013 and Y into $D014. The latch
fires *once per frame*; subsequent LP edges in the same frame are ignored.
On PAL the latch is reset at the start of line 0; on NTSC at line 0 of
the next frame.

### Stable raster technique

To synchronize execution to a known cycle within a known raster line:

1. Set up a raster IRQ at the target line.
2. In the IRQ handler, immediately write a *second* raster IRQ for
   line + 1 and acknowledge the current one.
3. Pad the handler with NOPs so that the worst-case IRQ entry latency is
   absorbed. The 6510 recognises an IRQ only at the end of the instruction
   it is executing, and that instruction can be 2–7 cycles long, so the
   latency varies over a window of 0–6 cycles (seven possible entry
   timings; an earlier version of this page said 5, which is the 7−2
   subtraction and undercounts by one; measured in VICE x64sc: a sled of
   7-cycle INC abs,X gives exactly seven distinct entry cycles).
   Undocumented 8-cycle read-modify-write opcodes such as SLO (zp),Y widen
   the window to 0–7.
4. After the second IRQ fires, the code runs on a known cycle of a known
   line.

Most demo code uses the double-IRQ technique above for every effect that
needs cycle accuracy (border opening, FLI, sprite multiplexer rasters).

## Color RAM

The Color RAM is a 1024-nibble (1024 × 4-bit) static RAM at $D800–$DBFF,
backing the per-cell foreground/attribute color in text and multicolor
bitmap modes.

### Layout

The 1000 cells of the 40×25 character matrix map directly to the first
1000 nibbles of Color RAM:

```
color_addr = $D800 + (row * 40) + col
```

The remaining 24 nibbles ($DBE8–$DBFF) are not used by the display but
the RAM is readable and writable. Some software uses these 24 cells as
spare 4-bit-per-cell storage.

### Reads return only 4 bits

The Color RAM chip only stores 4 bits per cell. Reading $D800+n returns
the low nibble in bits 0–3; the upper 4 bits read whatever happens to be
on the bus at that moment (usually the high nibble of the most recently
fetched byte). Always AND with $0F when reading Color RAM.

Writes only honor the low 4 bits; the upper 4 bits are discarded by the
hardware.

### Color values

Each nibble encodes one of 16 colors:

| Value | Color        | Value | Color       |
|-------|--------------|-------|-------------|
| 0     | Black        | 8     | Orange      |
| 1     | White        | 9     | Brown       |
| 2     | Red          | 10    | Light red   |
| 3     | Cyan         | 11    | Dark grey   |
| 4     | Purple       | 12    | Medium grey |
| 5     | Green        | 13    | Light green |
| 6     | Blue         | 14    | Light blue  |
| 7     | Yellow       | 15    | Light grey  |

The 8565/8562 produce slightly different shades, particularly for grays
and reds, because of differences in the HMOS-II color encoder.

### Use across display modes

| Mode                  | Color RAM use                              |
|-----------------------|--------------------------------------------|
| Standard text         | Foreground color, 16 colors                |
| Multicolor text       | If bit 3 set: %11 color (8 colors); else hires foreground (8 colors) |
| Extended color mode   | Foreground color, 16 colors                |
| Standard bitmap (hires)| Not used                                  |
| Multicolor bitmap     | %11 color (16 colors)                      |

### Initialization gotcha

Color RAM contents are random on power-on. The KERNAL clears it to the
current `$0286` (text color) value during reset. Code that takes over
before the KERNAL clear runs can show random colors where it expected
color 0 (black on black).

### Sprite color registers

The per-sprite color registers ($D027–$D02E) and the shared
sprite multicolor registers ($D025, $D026) live in the VIC-II register
space, *not* in Color RAM. Color RAM affects backgrounds and characters
only; sprite colors are programmed directly.

## Memory access

The VIC-II reads memory through a 16 KB address window called the *VIC
bank*. The chip itself only generates 14 bits of address (A0–A13); the
upper 2 bits come from CIA2 port A.

### VIC bank selection (via CIA2 $DD00)

CIA2 port A bits 0–1 are inverted and used as the high 2 bits of every
VIC-II memory access. Writing %xx to bits 0–1 sets the VIC bank as:

| CIA2 $DD00 bits 1–0 | VIC bank | Address range  |
|---------------------|----------|----------------|
| %11                 | 0        | $0000–$3FFF    |
| %10                 | 1        | $4000–$7FFF    |
| %01                 | 2        | $8000–$BFFF    |
| %00                 | 3        | $C000–$FFFF    |

The default after RESET is bank 0 ($0000–$3FFF), placing the screen at
$0400 and the character generator ROM at $1000.

To change banks, also set CIA2 data direction register $DD02 bits 0–1 to
1 (output). The KERNAL does this at boot.

### Character ROM shadowing

The character generator ROM at $D000–$DFFF in CPU address space appears
at $1000–$1FFF inside VIC banks 0 and 2 only. In VIC banks 1 and 3 the
chip sees RAM at $1000–$1FFF, where VIC banks 0 and 2 see the ROM. An
earlier draft of this paragraph also placed the ROM at $9000–$9FFF in VIC banks 1 and 3; it is not there.

| VIC bank | $1000–$1FFF region sees |
|----------|--------------------------|
| 0        | Character ROM            |
| 1        | RAM at $5000–$5FFF       |
| 2        | Character ROM            |
| 3        | RAM at $D000–$DFFF (which is I/O from the CPU's view) |

This shadowing is independent of the CPU's view: the CPU sees $D000–$DFFF
as I/O (or character ROM, or RAM, depending on $01 banking), while the
VIC-II *always* sees character ROM at $1000–$1FFF in banks 0 and 2.

In banks 1 and 3 a character set must be placed in RAM at one of the 8
possible character base positions inside the bank.

### Video matrix and char base inside the bank ($D018)

`$D018` selects, within the 16 KB VIC bank, the position of the video
matrix (1 KB) and the character generator (2 KB):

```
video_matrix_offset = VM_bits * $0400
char_base_offset    = CB_bits * $0800
```

with VM_bits in 0..15 and CB_bits in 0..7. For example, $D018 = $14
(binary 0001 0100) puts VM at $0400 and CB at $1000, the default.

In bitmap mode bit CB2 (the high bit of the 3-bit CB field) selects
between $0000 and $2000 as the bitmap base. The low two CB bits are
ignored.

### What if the VIC-II reads $D000–$DFFF?

Inside the C64, $D000–$DFFF is the I/O area for the CPU, but the VIC-II
itself does not see I/O. It sees RAM (the 1K backing RAM behind the
I/O space, sometimes called the "shadow RAM"). In bank 3, addresses
$D000–$DFFF from the VIC's side are 4K of RAM that the CPU
cannot normally reach (unless I/O is banked out via $01). It can hold
sprite data or character sets that the CPU never touches.

### Address translation summary

```
vic_address = (NOT CIA2_PRA[1:0]) << 14 | vic_internal_14bit_addr
```

When designing a memory layout: choose a VIC bank first (CIA2 $DD00),
then within that 16 KB place the video matrix (VM × 1 KB), char gen or
bitmap (CB × 2 KB or CB2 × 8 KB), sprite data (any 64-byte boundary),
and finally the sprite pointer table at video_matrix + $3F8.

## Programming patterns

Idioms found in most C64 programs that use the VIC-II.

### Reading the current raster line

```
; spin until a specific raster is reached (line < 256)
wait:
    lda $d012
    cmp #target_line
    bne wait
```

For target lines ≥ 256, also check $D011 bit 7:

```
wait_hi:
    lda $d011
    and #$80
    beq wait_hi          ; wait until raster MSB is 1
    lda $d012
    cmp #(target - 256)
    bne wait_hi
```

### Programming a raster IRQ

```
sei
lda #<irq_handler
sta $0314
lda #>irq_handler
sta $0315

lda #target_line_lo
sta $d012
lda $d011
and #$7f
ora #(target_line_hi_bit * $80)
sta $d011

lda #$01            ; enable raster IRQ only
sta $d01a
lda #$7f            ; mask all CIA IRQs to avoid jitter
sta $dc0d
sta $dd0d
lda $dc0d           ; ack any pending CIA IRQ
lda $dd0d
cli

irq_handler:
    pha
    txa
    pha
    tya
    pha
    lda #$01
    sta $d019       ; ack raster IRQ
    ; ... do work ...
    pla
    tay
    pla
    tax
    pla
    rti
```

### Double-IRQ stable raster

The single-IRQ approach above has up to 6 cycles of jitter (seven possible
entry timings; 7 only if 8-cycle undocumented opcodes are in the
interrupted code) due to the 6510's variable instruction length when an
IRQ fires. The double-IRQ method removes that jitter:

```
irq1:
    ; first IRQ: schedule second IRQ on next line and rti immediately
    lda #<irq2
    sta $0314
    lda #>irq2
    sta $0315
    inc $d012       ; raster + 1
    lda #$01
    sta $d019       ; ack
    tsx
    cli
    nop
    nop
    nop
    nop
    nop
    nop
    nop
    nop             ; waste max-cycle window
irq2:
    txs             ; restore stack
    lda #<irq1      ; reschedule irq1 for the original line
    sta $0314
    lda #>irq1
    sta $0315
    lda #original_lo
    sta $d012
    lda #$01
    sta $d019
    ; now we are at a known cycle of a known line
    ; ... cycle-exact effect code ...
    jmp $ea81       ; or rti through KERNAL
```

### Setting up a screen + character set in bank 1

```
; switch CIA2 DDR + PRA to put VIC on bank 1
lda $dd02
ora #$03
sta $dd02
lda $dd00
and #$fc
ora #$02            ; bits 1..0 = %10 -> bank 1
sta $dd00

; place video matrix at $4400 (VM = %0001), charset at $5000 (CB = %100)
lda #(%0001_0000 | %0000_1000 | %0)    ; VM=1, CB=4
sta $d018           ; final value $18
```

The value written is $18.

### Building a sprite

```
; copy 63 bytes of sprite data to $2000
; set sprite pointer 0 to $2000 / 64 = $80
lda #$80
sta $07f8           ; sprite pointer 0, assuming screen at $0400

; enable sprite 0
lda #$01
sta $d015

; position it on top-left of display
lda #24+0
sta $d000
lda #50+0
sta $d001
lda $d010
and #$fe
sta $d010

; color it white
lda #$01
sta $d027
```

### Smooth scrolling with YSCROLL

For vertical fine-scroll, change YSCROLL each frame and shift the
screen RAM up by one row every 8 frames:

```
scroll_step:
    dec yscroll_var
    bpl scroll_done
    lda #7
    sta yscroll_var
    jsr shift_screen_up_one_row
scroll_done:
    lda $d011
    and #$f8
    ora yscroll_var
    sta $d011
    rts
```

XSCROLL via $D016 works identically for horizontal scrolling.

### Switching display modes safely

To switch between modes without flicker:

1. Wait for the VBI (raster ≥ 250).
2. Write the new $D011 and $D016 values.
3. Update $D018 if char base or VM moved.
4. Update $DD00 if VIC bank changed.

Mid-frame mode switches are valid but produce visible seams; useful for
splitscreen effects (text status bar + bitmap play area) when timed to a
raster IRQ.

## Detailed timing reference

### PAL cycle map of a non-badline raster line (6569)

```
cycle  bus master     access type
1      VIC            p1 (sprite 3 pointer)
2      CPU            phi2
3      VIC            p2 (sprite 4 pointer)
4      CPU
5      VIC            p3 (sprite 5 pointer)
6      CPU
7      VIC            p4 (sprite 6 pointer)
8      CPU
9      VIC            p7 (sprite 7 pointer); 9-10 s-accesses if active
11     CPU            ; CPU runs freely if no badline
...
55     VIC            g-access (last one of line)
56     CPU
57     VIC            refresh
58     VIC            p0 (sprite 0 pointer)
59     CPU
60     VIC            p1 (sprite 1 pointer)
61     CPU
62     VIC            p2 (sprite 2 pointer)
63     CPU            ; last cycle of line on PAL
```

This picture is simplified; the exact cycle of each access is in the
appendix of Bauer's article.

### PAL badline (40 stolen cycles)

```
cycle  bus master  notes
1-11   alternating
12     VIC sets BA low      ; CPU has up to 3 more cycles to finish writes
13-14  CPU may finish writes
15     VIC takes bus        ; first c-access
16-54  VIC                  ; 40 c-accesses total
55     CPU returns
56-63  alternating
```

Net effect: CPU loses 40-43 cycles depending on whether it was reading
or writing when BA went low.

### Y range visibility on PAL

| Y position  | What you see                              |
|-------------|-------------------------------------------|
| 0–50        | Top border                                |
| 51–250      | 25-row text display (RSEL = 1)            |
| 55–246      | 24-row text display (RSEL = 0)            |
| 251–311     | Bottom border                             |
| 300–311     | Vertical blanking (no video output)       |

A sprite's first row appears on the line AFTER its Y register value, so
Y = 50 puts its top edge on line 51, the first line of the visible
display, and the sprite Y range that lands inside the 25-row window is
50–249.

### Effective CPU cycles per second

```
PAL  6569:  63 cycles/line * 312 lines * 50 Hz  =  982,800 cycles/s nominal
NTSC 6567:  65 cycles/line * 263 lines * ~60 Hz =  1,025,700 cycles/s nominal
```

Subtract 25 badlines × 40 stolen cycles × 50 Hz = 50,000 cycles/s for a
text frame; the CPU gets ~933,000 cycles/s on PAL.
Sprites can subtract another 50–100K cycles/s if used heavily.

## Pitfalls

- **Badline cycle steal**: any raster line where (raster ≥ $30 AND
  raster ≤ $F7 AND raster & 7 == YSCROLL AND DEN was set on line $30)
  steals 40-43 CPU cycles. A worst-case PAL line with 8 sprites and a
  badline leaves the CPU one guaranteed cycle: 43 + 19 = 62 of 63 stolen,
  measured in VICE x64sc (an earlier version of this bullet said ~14, which
  disagreed with this page's own 19-cycle sprite figure). See
  [raster-and-badline.md](../pitfalls/raster-and-badline.md)
  (`badline_cycle_loss`, `vic_bus_takeover_on_dma`).
- **$D012 raster wrap**: comparing $D012 against ≥ 256 requires combining
  with $D011 bit 7. Forgetting the MSB makes raster IRQs misfire at
  line N mod 256 instead of line N. See
  [raster-and-badline.md](../pitfalls/raster-and-badline.md) (`d012_wrap_around`).
- **Color RAM high nibble garbage**: reading $D800+n returns garbage in
  bits 4–7: the byte the VIC fetched in the preceding phi1 cycle, not
  the address high byte. Always mask with #$0F. See
  [c64-registers-reference.md](c64-registers-reference.md) (Color RAM).
- **Sprite DMA timing**: each sprite steals 2 bus cycles per line while
  its DMA is on (the two phi2 s-accesses; the p-access and the third
  s-access are phi1), plus 3 cycles of BA lead-in per contiguous group
  of active slots. Worst-case 19 stolen cycles on top of any badline. See
  [raster-and-badline.md](../pitfalls/raster-and-badline.md)
  (`vic_bus_takeover_on_dma`).
- **Sprite crunch**: clearing a Y-expand bit ($D017) on one particular
  cycle (cycle 15 in VICE's PAL numbering, just before the cycle-16
  MCBASE step) of one of the sprite's display lines after the first
  changes the sprite's remaining length once, by a data-dependent amount.
  Every crunch measured in VICE x64sc lengthened the sprite, by 4 to 21
  lines (an earlier version of this bullet said it shortened the sprite to
  ≤ 21 lines). Used on purpose for tricks; breaks multiplexer code that
  does not expect it. See [sprite.md](../pitfalls/sprite.md)
  (`sprite_y_expand_double_register_write`) and
  `sprite_y_stretch_glitch` in `techniques/sprite.md`.
- **DEN must be set on line $30 (48)**: if $D011 bit 4 is clear for all
  of line 48, badlines are inhibited for the entire frame. A write
  setting it on any cycle of that line is enough to enable them (an
  earlier version of this bullet said "before cycle 14"). Many effects
  rely on badlines firing, and the cause of an idle display is easy to
  miss.
- **$D011 read overlay**: reading $D011 returns the live raster MSB in
  bit 7, not the value last written. To preserve other bits when
  writing raster targets, write the bits wanted; do not
  read-modify-write naively.
- **$D019 acknowledgment**: IRQ latch bits in $D019 must be cleared by
  writing 1 (not 0) to the bit. Forgetting causes the IRQ handler to
  immediately re-enter.
- **$D01E / $D01F read-to-clear**: collision registers clear when read,
  unlike $D019 which clears on write. Reading them in a debugger
  destroys live state.
- **VIC bank vs CPU view**: the VIC-II's view of memory is independent
  of the CPU's $01 banking. Placing data at $D000–$DFFF and pointing
  the VIC at bank 3 makes it visible to the chip but not to the CPU
  (without further $01 manipulation).
- **Character ROM only in banks 0 and 2**: in VIC banks 1 and 3 a
  character set must be copied or generated in RAM. The default PETSCII
  display shows garbage after a switch to bank 1 or 3 without one.
- **Sprite pointer location**: the eight sprite pointers always live at
  video_matrix_base + $3F8 inside the current VIC bank, *not* at a fixed
  CPU address. Moving the screen also moves the sprite pointer table.
- **Mid-line mode switches**: ECM, BMM, MCM are sampled every cycle.
  Mid-line switches change pixels at character-cell boundaries; used for
  FLI, but a stray write during a badline can rewrite the row buffer in
  unexpected ways.
- **NTSC R56A oddity**: the rare 6567 R56A NTSC chip has 262 lines and
  64 cycles/line instead of the more common R8's 263/65. Code that
  hard-codes "65 cycles per line on NTSC" miscounts on the R56A.
- **HMOS-II color differences**: 8565/8562 chips produce different shades
  for some colors (notably greys and reds). Pixel-exact graphics that
  rely on specific colors may look different on later C64C machines.
- **$D02F unused**: writes to $D02F are silently ignored on the C64's
  VIC-II proper. The 8564/8566 VIC-IIe in the C128 uses this address as
  the extra-keyboard row select (K0–K2) and $D030 as the 2 MHz / test
  register (previously misdescribed here as a mode-control register); on
  the C64 both are unused.

## Sources

- Christian Bauer, *The MOS 6567/6569 video controller (VIC-II) and its
  application in the Commodore 64*, July 1996. https://www.cebix.net/VIC-Article.txt
- "VIC", C64-Wiki. https://www.c64-wiki.com/wiki/VIC
- "Page 208-211" (VIC-II register list), C64-Wiki.
  https://www.c64-wiki.com/wiki/Page_208-211
- Dustlayer, "VIC-II" tutorial series. https://www.dustlayer.com/vic-ii
- "VIC-II", Codebase 64. https://codebase64.org/doku.php?id=base:vicii
- Codebase 64 articles on stable rasters, sprite multiplexing, badline
  abuse, and the various display-mode tricks referenced above.

<!-- doc-type: hardware-reference -->
