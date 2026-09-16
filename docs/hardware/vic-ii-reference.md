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
visual trick the C64 is known for — smooth scrolling, FLD/FLI, sprite
multiplexing, side borders open, 64-pixel-tall character cells — leans on
its tight, documented coupling between the chip and the 6510 CPU bus.

The VIC-II shares the bus with the 6510. During each PAL raster line the
chip takes the bus for itself on the first half of every cycle (phi1) to
fetch pixel data and on roughly five extra cycles for sprite DMA, while
the CPU is allowed to run on the second half (phi2). Eight times every
text frame the chip needs an entire row of character pointers from screen
RAM and steals 40 consecutive cycles from the CPU — the *badline*. This
single quirk is responsible for most of the cycle-exact discipline a C64
demo coder lives by. See the [Raster system](#raster-system) section.

### Chip variants

The VIC-II shipped in four primary variants. The PAL parts have an extra
line of vertical resolution and a slower system clock; the NTSC parts run
faster but have less vertical real estate. The HMOS-II "8000-series"
revisions are functionally identical to the original NMOS parts in the
common cases but differ in DC characteristics, color shades, and a handful
of timing edges that only matter to demo coders.

| Variant | Region | Process | Lines/frame | Cycles/line | Master clock | System (phi2) |
|---------|--------|---------|-------------|-------------|--------------|---------------|
| 6569    | PAL    | NMOS    | 312         | 63          | 17.734472 MHz / 18 | 0.985 MHz |
| 6567 R56A | NTSC | NMOS    | 262         | 64          | 14.318181 MHz / 14 | 1.022 MHz |
| 6567 R8 / R9 | NTSC | NMOS | 263       | 65          | 14.318181 MHz / 14 | 1.022 MHz |
| 8565    | PAL    | HMOS-II | 312         | 63          | 17.734472 MHz / 18 | 0.985 MHz |
| 8562    | NTSC   | HMOS-II | 263         | 65          | 14.318181 MHz / 14 | 1.022 MHz |

Notes on variants:

- 6569 PAL machines run at 50.125 Hz refresh; the 6567 NTSC at ~59.83 Hz.
- The 6567 R56A is rare — it has only 262 lines and 64 cycles per line,
  one fewer than the more common R8. Most NTSC C64s use R8.
- 8565/8562 are the late-model HMOS-II parts found in the C64C and C128.
  They are pin-compatible with the 6569/6567 but produce slightly different
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
last 16 of those addresses are images of $D000–$D00F so the chip presents
47 unique registers + one unused. The Color RAM at $D800–$DBFF is logically
part of the VIC subsystem even though it is implemented in a separate
2114-family static RAM.

## Quick reference

All 47 documented registers plus the one unused address are listed below.
Each register has a full H3 entry later in the document with bit layout
and behavioral notes.

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

Addresses $D030–$D03F mirror $D000–$D00F. Addresses $D040–$D3FF mirror the
entire 64-byte window 64 more times (1024 / 64 = 16 images). Code should
never rely on the mirrors — they are an accident of incomplete address
decoding.

### Color RAM and the wider VIC address window

| Range         | Length | Description                              |
|---------------|--------|------------------------------------------|
| $D000–$D02E   | 47 B   | VIC-II registers                         |
| $D02F–$D03F   | 17 B   | Unused / register mirror tail            |
| $D040–$D3FF   | 960 B  | 15 further mirrors of $D000–$D03F        |
| $D800–$DBFF   | 1024 B | Color RAM (4 bits per cell, upper nibble reads as garbage) |

The Color RAM is described in detail in [Color RAM](#color-ram).

## Register reference

Each register address in $D000–$D02F gets its own H3 below in the canonical
conventions format. Bit fields are described inline. Where reset behavior
differs from "cleared to 0 on reset", that is called out explicitly.

### $D000 — M0X — Sprite 0 X position (RW)

**Chip:** VIC-II

Low 8 bits of sprite 0 horizontal position. Bit 8 of the X position lives
in $D010 bit 0. Coordinate space is 0–511 with the visible display roughly
spanning 24..343 in non-CSEL-trimmed mode; X = 0 is well off the left edge
of the visible screen. Write at any time — the new position takes effect
the next time the sprite's DMA fetch occurs.

### $D001 — M0Y — Sprite 0 Y position (RW)

**Chip:** VIC-II

Sprite 0 vertical position in raster lines (8 bits, 0–255). The sprite
appears on raster lines Y .. Y + 20 (or Y + 41 if vertically expanded).
Y = 50 places the top of the sprite at the top of the visible 25-row text
display.

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

When you want to position a sprite at X = 320 (center-ish), write $40 to
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

DEN must be 1 during cycle 14 of raster line $30 (decimal 48) for badlines
to be enabled throughout the frame; clearing DEN turns the display to the
background color across the entire screen interior and inhibits badlines.

YSCROLL = 3 is the default; the kernel boot screen uses this. The badline
condition is "current raster ≥ $30, ≤ $F7, and bottom 3 bits == YSCROLL,
and DEN was set on line $30". Changing YSCROLL therefore shifts every
badline by the corresponding number of lines.

### $D012 — RASTER — Raster line counter / compare (RW)

**Chip:** VIC-II

Reading returns the low 8 bits of the current raster line; the high bit
lives in $D011 bit 7. Writing programs the *compare* value for raster
interrupts (low 8 bits); the MSB to compare lives in $D011 bit 7.

The raster line counter increments at the start of cycle 1 of each line
except for line 0, where it increments one cycle later — this is the
single "wrong-by-one-cycle" timing quirk that occasionally bites tightly
written stable-raster code. See the [Raster system](#raster-system).

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

The X-scroll, column-select, and MCM toggle live here. Bits 6 and 7 read
back as 1 on every variant — they are unimplemented in this register
even though some sources include them in masks.

| Bit | Name  | Description                                       |
|-----|-------|---------------------------------------------------|
| 7,6 | —     | Unused (always read 1)                            |
| 5   | RES   | Hardware reset of VIC-II video shift register (reserved; never works as intended on production chips) |
| 4   | MCM   | Multicolor mode enable                            |
| 3   | CSEL  | Column select: 1 = 40 cols / 320 px wide, 0 = 38 cols / 304 px |
| 2-0 | XSCROLL | Horizontal fine scroll, 0–7 pixels              |

Setting CSEL = 0 opens up an 8-pixel sliver on each side of the screen
where the *border* is drawn but the chip's display sequencer never starts;
this is the side-borders-open exploit's foothold.

### $D017 — YXPAND — Sprite Y expansion (RW)

**Chip:** VIC-II

Per-sprite vertical 2× expansion. When bit n is set, sprite n renders each
of its 21 lines twice for a total of 42 visible lines. The expansion
*toggle* flag is internal; if you clear $D017 on the raster line that the
chip would normally apply the toggle, the famous "sprite crunch" bug
fires — see [Pitfalls](#pitfalls).

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

Important: the character generator ROM only appears mirrored into VIC
banks 0 and 2 at addresses $1000–$1FFF and $9000–$9FFF respectively. In
banks 1 and 3 you must place your own character set in RAM. See
[Memory access](#memory-access).

### $D019 — VICIRQ — Interrupt status / latch (RW)

**Chip:** VIC-II

Latched IRQ source flags. Bits 7 and 4–6 ordinarily read 0/1 depending
on chip state. To acknowledge an IRQ you write a 1 to the corresponding
latch bit (this is the canonical "write to clear" pattern).

| Bit | Name | Description                                       |
|-----|------|---------------------------------------------------|
| 7   | IRQ  | 1 = at least one enabled source is pending (IRQ line asserted) |
| 6-4 | —    | Unused, read 1                                    |
| 3   | ILP  | Light pen latch fired                             |
| 2   | IMMC | Sprite-sprite collision latched                   |
| 1   | IMBC | Sprite-background collision latched               |
| 0   | IRST | Raster compare matched                            |

Acknowledging is mandatory: until you clear the latch bit, the chip will
continue asserting IRQ at the start of every cycle.

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

Reset value is 0 (all disabled). The KERNAL boot sets bit 0 to enable
raster IRQ at line 0 for system tick.

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
48 pixels wide instead of 24. Combined with Y expansion you get 48×42
sprites that still cost only 64 bytes of sprite data plus DMA.

| Bit | Name | Description           |
|-----|------|-----------------------|
| 7-0 | Mn XE| Sprite n X expansion  |

### $D01E — SPSPCL — Sprite-sprite collision (R)

**Chip:** VIC-II

Sprite-versus-sprite collision flags, latched. Bit n is set when any
non-transparent pixel of sprite n overlapped any non-transparent pixel of
any other sprite since the last read. Reading clears all bits in this
register (read-to-clear, *not* write-to-clear, unlike $D019).

If only one bit is set, no collision occurred — that bit would only set in
the presence of a second sprite. Typically you read this once per frame
and inspect for any nonzero value.

### $D01F — SPBGCL — Sprite-background collision (R)

**Chip:** VIC-II

Sprite-versus-foreground collision flags, latched. Bit n is set when any
non-transparent pixel of sprite n overlapped a foreground pixel of the
display (a pixel that is not "background color 0" by the rules of the
current display mode). Read-to-clear. Border and overscan pixels do not
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
multicolor sprite mode this is *not* the sprite background — sprite
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
bitmap. In multicolor text mode this register is irrelevant — the %11
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
silently ignores writes. The MOS 8564 / 8566 VIC-IIe (C128 only) reuses
this address as the C128 mode-control register (50/60 Hz, fast-mode,
etc.); on the C64's VIC-II proper, it is dead silicon.

## Display modes

The VIC-II's display sequencer can run in one of four combinations of two
mode bits ECM ($D011 bit 6) and BMM ($D011 bit 5), each in either single-
color or multicolor (MCM = $D016 bit 4). That gives eight combinations —
but only six are "legal" (well-documented and useful); the other two are
the so-called *illegal* or *invalid* modes that produce solid color
output, useful only as oddities.

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
RSEL = 1, CSEL = 1 window. Multicolor modes effectively halve horizontal
resolution to 160×200 pixels.

### Standard text mode (ECM=0, BMM=0, MCM=0)

The default. 40 columns × 25 rows of 8×8 character cells, each cell drawn
from a 2K character generator pointed to by $D018 bits 3–1. Each character
cell has two colors:

- **Background**: $D021 (BGCOL0), global.
- **Foreground**: the low 4 bits of the matching Color RAM byte at
  $D800 + (row × 40) + col.

Character codes are 8-bit values stored in the video matrix (default
$0400–$07E7). The character generator at $D000 in VIC bank 0/2 is the
KERNAL ROM character set: uppercase/graphics at $D000–$D7FF and
lowercase/uppercase at $D800–$DFFF.

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

This means in multicolor text mode you only get 8 possible foreground
colors per cell (colors 0–7), not the full 16. Demo coders sometimes
combine multicolor and standard text by carefully choosing which color RAM
high-bits to set on which cells.

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

Foreground color still comes from Color RAM. Useful in games for cheap
per-region background coloring; downside is the loss of 192 of the 256
glyphs.

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

Horizontal resolution drops to 160 double-wide pixels. The vast majority
of "C64 paintings" you have ever seen are multicolor bitmap.

### Illegal display modes

Setting ECM+MCM together, or BMM+ECM together, puts the chip into an
"invalid" mode. The display sequencer still runs, but the pixel data
output is forced to black. Collisions and sprites still function. Demo
coders sometimes flip into invalid mode briefly to blank the display
without disabling DEN (which would inhibit badlines and disturb sprite
DMA).

### Mode-switch timing

The mode bits ECM, BMM, MCM are sampled by the display sequencer every
cycle. Switching modes mid-line therefore changes pixels mid-row at
character-cell boundaries. This is the foundation of FLI (Flexible Line
Interpretation), AGSP, and other "extra colors" tricks. The trick is that
the c-accesses for the *next* line happen during cycles 15–54 of the
previous badline, so a mode switch on cycle 14 of the current line affects
pixel rendering immediately.

## Sprites

The VIC-II provides eight hardware sprites. Each sprite is 24×21 pixels
in hires mode or 12×21 (double-width) in multicolor mode, with optional
2× horizontal and/or 2× vertical expansion. Sprites are independent of
text/bitmap modes; the same eight sprites are available regardless.

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

So with the default screen at $0400, the eight pointer bytes live at
$07F8–$07FF. Writing a pointer of $80 places the sprite data at
$80 × 64 = $2000.

### Positioning

X is 9-bit (0–511) split between $D000+2n and $D010 bit n. Y is 8-bit
(0–255) in $D001+2n. The visible 200-line display occupies Y = 50 (top of
character row 0) through Y = 249 inclusive, with line 250 being the first
row of the lower border. To place a sprite on top of character row r,
column c (cell coordinates), the formula is:

```
sprite_X = 24 + c * 8        ; offset 24 because X = 0 is well off-screen
sprite_Y = 50 + r * 8
```

### Expansion

`$D017` and `$D01D` toggle vertical and horizontal 2× expansion per
sprite. The expansion takes effect immediately on the X axis (next pixel
shifted is doubled), but on Y axis the chip uses an internal "expansion
flip-flop" that toggles each line — changing $D017 mid-line can confuse
the flip-flop and cause "sprite crunch" (variable-height sprites used in
some demos and unintentionally in some bugs).

### Multicolor

Setting bit n in $D01C makes sprite n multicolor: 12-pixel horizontal
resolution, 4-color (one transparent, plus three pickable). See the
[$D01C](#d01c--spmc--sprite-multicolor-enable-rw) entry for the color map.

### Priority

Sprite-sprite priority is fixed: index 0 wins over 1, 1 over 2, etc. So
sprite 0 always renders in front of sprite 7 when they overlap.

Sprite-background priority is per-sprite via $D01B. When bit n = 0
(default), sprite n appears in front of foreground graphics. When bit
n = 1, sprite n appears *behind* foreground but still in front of
background.

In effect each pixel has these layers from back to front:

```
border  <-  background  <-  [low-priority sprites]  <-  foreground  <-  [high-priority sprites]
```

In all modes, "background" is defined as the pixels rendered using
$D021 / BGCOL0 (and BGCOL1/2/3 in MCM bitmap or ECM modes); "foreground"
is everything else.

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

A subtle gotcha: the *latch interval* spans from the previous read to the
current read. If you do not read the register at all during a frame, a
collision that happens and then resolves is lost.

### Sprite DMA

For each sprite that is enabled or in the middle of its 21-line render,
the VIC-II steals additional cycles from the CPU on its raster lines. The
exact pattern:

1. One **p-access** (pointer fetch) per raster line, always, regardless of
   enable state, on cycles 58, 60, 62, 64, 1, 3, 5, 7 for sprites 0–7.
2. Three **s-accesses** (sprite data fetch) per raster line, but only when
   that sprite's render row is active. These follow each sprite's
   p-access slot.

With all eight sprites active, the chip steals (8 × 2 + 8 × 1) = up to
~19 cycles per line on top of any badline overhead, leaving the CPU only
~44 of the 63 PAL cycles. This is why "full-screen multiplexers" of more
than 8 sprites have to do their pointer rewrites during specific cycle
windows.

The VIC-II asserts BA (Bus Available) low three cycles before each sprite
fetch. The CPU then completes its current memory cycle and releases the
bus on the next read cycle. Write cycles are not blocked by BA, so the
CPU continues to execute write instructions for up to three additional
cycles before the chip actually steals the bus.

### Number-of-sprites limits

A single VIC-II shows eight sprites *per scanline*. The classic
multiplexer technique reuses sprites across vertical bands by rewriting
their Y position and pointer during the lines between bands; modern
multiplexer routines achieve 16–24 sprites per frame routinely.

The hardware does not enforce any limit beyond "8 simultaneous"; if you
move a sprite while it is rendering, the display will show the new value
on the next line it is fetched, which is what makes multiplexing work.

## Raster system

The VIC-II's raster engine ticks once per character pixel column with
high precision, and its interaction with the CPU bus is fully
deterministic. Everything in this section is the foundation of stable
rasters, hardware scrolling, FLD/FLI/CRT effects, and sprite multiplexing.

### Raster line counter

`$D012` holds the low 8 bits of the current line; bit 7 of $D011 holds
bit 8. The counter increments at the start of cycle 1 of each raster line
*except* line 0, where it ticks one cycle later — this off-by-one quirk
is documented in Bauer's article and is why some stable-raster code
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

You **must** acknowledge by writing 1 to bit 0 of $D019, or the IRQ will
re-fire as soon as you RTI.

Two-byte raster compare write sequence (canonical):

```
lda #target_line_lo
sta $d012
lda $d011
and #$7f
ora #(target_line_hi_bit << 7)
sta $d011
```

For target lines below 256 you can skip the second step (the existing
$D011 should already have bit 7 = 0 from the most recent write).

### Badlines

A badline is a raster line on which the chip must perform 40 c-accesses
(character pointer + Color RAM fetches) to load the next row's video
matrix into its internal row buffer. The condition is:

```
($30 <= raster <= $F7) AND (raster & 7 == YSCROLL) AND DEN was set on $30
```

PAL line $30 is decimal 48; $F7 is 247. With the default YSCROLL = 3 this
means badlines occur on lines 51, 59, 67, ..., 243 — exactly every 8
lines, once per character row.

On a badline the chip pulls BA low at cycle 12 to warn the CPU, then
takes the bus from cycle 15 through cycle 54. Total stolen cycles: 40,
plus up to 3 cycles of CPU "tail" before BA actually takes hold (because
the CPU finishes its current read instruction). Effective CPU budget on a
badline: 63 - 43 = 20 cycles on PAL.

You can *prevent* badlines for a whole frame by clearing DEN ($D011 bit 4)
*before* cycle 14 of raster line $30 (48). The display turns to BGCOL0
and the chip operates entirely in idle state for the frame.

You can *shift* badlines by changing YSCROLL, or *delay one badline*
by changing YSCROLL on the badline immediately before; this is the
foundation of FLD (Flexible Line Distance) and other vertical-stretch
tricks.

### c-access, g-access, p-access, s-access

Four kinds of memory accesses the chip can perform:

| Access | When                                  | What is read                |
|--------|---------------------------------------|----------------------------|
| c      | Cycles 15–54 of every badline         | Char pointer + color RAM nibble (12-bit) |
| g      | Cycles 16–55 of every visible line    | 8 bits of pixel data (char gen or bitmap) |
| p      | Cycles 58, 60, 62, 64, 1, 3, 5, 7     | Sprite pointer byte         |
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

The chip enters idle state when DEN is cleared or when the chip is in the
non-display Y range. It re-enters display state on the next badline.

This is why the trick "DEN off then on mid-frame" gives a strip of
"phantom" pixels driven by whatever happens to live at $3FFF in the
current VIC bank.

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
   absorbed. Because 6510 IRQ entry takes 7 cycles but the instruction
   being interrupted takes 2–7 cycles, the latency varies by up to 5
   cycles.
4. After the second IRQ fires, you know exactly which cycle of which line
   you are on.

Most demo coders use the "double-IRQ" technique above as the foundation
of every effect that needs cycle accuracy (border opening, FLI, sprite
multiplexer rasters).

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
the RAM is fully readable and writable. Some software uses these 24 cells
as "free" 4-bit-per-cell storage.

### Reads return only 4 bits

The Color RAM chip only stores 4 bits per cell. Reading $D800+n returns
the low nibble in bits 0–3; the upper 4 bits read whatever happens to be
on the bus at that moment (typically the high nibble of the most recently
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

The 8565/8562 produce subtly different shades, particularly for grays
and reds, due to differences in the HMOS-II color encoder.

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
current `$0286` (text color) value during reset, but if you take over
before the KERNAL clear runs you may see colorful garbage where you
expected color 0 (black on black).

### Sprite color registers

Note that the per-sprite color registers ($D027–$D02E) and the shared
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
shadowed at $1000–$1FFF in VIC banks 0 and 2, and at $9000–$9FFF in VIC
banks 1 and 3 — no, that's not right. Actually: the character ROM
appears at $1000–$1FFF inside VIC banks 0 and 2 only. In VIC banks 1 and
3 the chip sees RAM at those addresses.

| VIC bank | $1000–$1FFF region sees |
|----------|--------------------------|
| 0        | Character ROM            |
| 1        | RAM at $5000–$5FFF       |
| 2        | Character ROM            |
| 3        | RAM at $D000–$DFFF (which is I/O from the CPU's view) |

This shadowing is independent of the CPU's view: the CPU sees $D000–$DFFF
as I/O (or character ROM, or RAM, depending on $01 banking), while the
VIC-II *always* sees character ROM at $1000–$1FFF in banks 0 and 2.

In banks 1 and 3 you must place a character set in RAM at one of the 8
possible character base positions inside the bank.

### Video matrix and char base inside the bank ($D018)

`$D018` selects, within the 16 KB VIC bank, the position of the video
matrix (1 KB) and the character generator (2 KB):

```
video_matrix_offset = VM_bits * $0400
char_base_offset    = CB_bits * $0800
```

with VM_bits in 0..15 and CB_bits in 0..7. For example, $D018 = $14
(binary 0001 0100) puts VM at $0400 and CB at $1000 — the default.

In bitmap mode bit CB2 (the high bit of the 3-bit CB field) selects
between $0000 and $2000 as the bitmap base. The low two CB bits are
ignored.

### What if the VIC-II reads $D000–$DFFF?

Inside the C64, $D000–$DFFF is the I/O area for the CPU, but the VIC-II
itself does not see "I/O" — it sees RAM (the 1K backing RAM behind the
I/O space, sometimes called the "shadow RAM"). So in bank 3, addresses
$D000–$DFFF from the VIC's perspective are simply 4K of RAM that the CPU
cannot normally reach (unless I/O is banked out via $01). This is a
useful place to store sprite data or character sets that the CPU never
touches.

### Address translation summary

```
vic_address = (NOT CIA2_PRA[1:0]) << 14 | vic_internal_14bit_addr
```

When designing a memory layout: choose a VIC bank first (CIA2 $DD00),
then within that 16 KB place the video matrix (VM × 1 KB), char gen or
bitmap (CB × 2 KB or CB2 × 8 KB), sprite data (any 64-byte boundary),
and finally the sprite pointer table at video_matrix + $3F8.

## Programming patterns

This section collects the canonical idioms that appear in nearly every
C64 program that touches the VIC-II.

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

The single-IRQ approach above has up to 7 cycles of jitter due to the
6510's variable instruction length when an IRQ fires. The double-IRQ
trick removes that jitter:

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

(Comment for clarity; the actual value would be $18.)

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
9-10   VIC            s-accesses if sprite active
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

This is a simplified picture; the exact cycle each access happens on is
documented in Bauer's article appendix.

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

Sprite Y coordinates in this 8-bit register correspond directly to these
line numbers — placing a sprite at Y = 50 puts its top edge exactly at
the top of the visible display.

### Effective CPU cycles per second

```
PAL  6569:  63 cycles/line * 312 lines * 50 Hz  =  982,800 cycles/s nominal
NTSC 6567:  65 cycles/line * 263 lines * ~60 Hz =  1,025,700 cycles/s nominal
```

Subtract 25 badlines × 40 stolen cycles × 50 Hz = 50,000 cycles/s for a
typical text frame; the CPU effectively gets ~933,000 cycles/s on PAL.
Sprites can subtract another 50–100K cycles/s if used heavily.

## Pitfalls

- **Badline cycle steal**: any raster line where (raster ≥ $30 AND
  raster ≤ $F7 AND raster & 7 == YSCROLL AND DEN was set on line $30)
  steals 40+ CPU cycles. A worst-case PAL line with 8 sprites and a
  badline leaves only ~14 CPU cycles. See
  [c64-pitfalls.md](c64-pitfalls.md#badline-cycle-steal).
- **$D012 raster wrap**: comparing $D012 against ≥ 256 requires combining
  with $D011 bit 7. Forgetting the MSB makes raster IRQs misfire at
  line N mod 256 instead of line N. See
  [c64-pitfalls.md](c64-pitfalls.md#d012-raster-wrap).
- **Color RAM high nibble garbage**: reading $D800+n returns garbage in
  bits 4–7. Always mask with #$0F. See
  [c64-pitfalls.md](c64-pitfalls.md#color-ram-high-nibble).
- **Sprite DMA timing**: enabled sprites steal 2 cycles (p-access + 3
  s-accesses spread across one line) per active sprite per line.
  Worst-case 19 stolen cycles on top of any badline. See
  [c64-pitfalls.md](c64-pitfalls.md#sprite-dma-timing).
- **Sprite crunch**: clearing a Y-expand bit ($D017) at a precise cycle
  during the sprite's display row can confuse the expansion flip-flop
  and shorten the sprite to ≤ 21 lines. Used intentionally for tricks;
  bites unwary multiplexer code. See
  [c64-pitfalls.md](c64-pitfalls.md#sprite-crunch).
- **DEN must be set on line $30 (48)**: clearing $D011 bit 4 before
  cycle 14 of line 48 inhibits badlines for the entire frame; many
  effects rely on badlines firing, and you may not notice for a frame
  why the display has gone idle.
- **$D011 read overlay**: reading $D011 returns the live raster MSB in
  bit 7, not the value you last wrote. To preserve other bits when
  writing raster targets, write the same bits you want; do not
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
- **Character ROM only in banks 0 and 2**: in VIC banks 1 and 3 you must
  copy or generate a character set in RAM. Default PETSCII display will
  show garbage if you switch to bank 1 or 3 without preparing a charset.
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
  VIC-II proper. The 8564/8566 VIC-IIe in the C128 reuses this address
  as a mode-control register; on C64 it is dead.

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
