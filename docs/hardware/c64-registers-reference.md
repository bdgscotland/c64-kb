# C64 Registers Quick Reference

## Overview

A single-page index of every memory-mapped I/O register visible to the
6510 in the $D000-$DFFF window of a stock Commodore 64. A reader who
knows only an address ("what lives at $D012?") finds the right chip
here without guessing which datasheet to open.

It is **tabular only**. Each chip's registers are listed in a name +
address + R/W + one-line description grid. Per-register detail (bit
layouts, side effects, timing notes, code snippets) is in the per-chip
reference documents:

- [VIC-II reference](vic-ii-reference.md) — $D000-$D02F
- [SID reference](sid-reference.md) — $D400-$D41C
- [CIA reference](cia-reference.md) — $DC00-$DC0F (CIA1) and $DD00-$DD0F (CIA2)

**Why no register H3s in this file.** The graph extractor in
`src/graph/extract.ts` pulls one `Register` node per H3 of the form
`### $XXXX — NAME — Description (RW)`. Duplicating those H3s here and
in the per-chip docs would create double-counted nodes and ambiguous
ownership edges. The Phase-1 plan (Task 8) records this choice:
H3s live in the per-chip docs; this file is only an index. The doc-type marker at the foot of the file tells the extractor
this is hardware-reference content so it is parsed and validated, but
since there are no register-shaped H3s in it, no `Register` nodes are
created from this file.

This file is also the one place that documents the **shadow regions**:
the $D040-$D3FF VIC-II mirror, the $D420-$D7FF SID mirror and the
per-CIA $xx10-$xxFF mirrors. They come from the hardware decode, not
from software aliases. Touching them counts as touching the underlying register and
can cause every side effect the real register causes.

## Conventions used in this doc

- All addresses are hex, dollar-prefixed: `$D012`.
- Register tables use the canonical name from the per-chip reference docs.
  These are the same short symbolic names that appear in the MOS data sheets
  and in the C64 Programmer's Reference Guide ("MSIGX", "SCROLY", "VMCSB",
  "FRELO1", etc.). Some sources use different mnemonics for the same
  register; the per-chip doc is authoritative.
- "R", "W", "RW" describe what the CPU can do at that address.
- "Latching" / "destructive" notes mean the act of reading or writing that
  address changes hidden state in the chip beyond the visible data byte;
  see the bit-level treatment in the per-chip doc.
- "Mirror" / "shadow" mean the same physical register responds to multiple
  CPU addresses because the chip only decodes the low bits of the address.
  This is not aliasing for convenience; it is the actual decode.

## I/O window layout

The $D000-$DFFF window is what appears to the CPU when the I/O area is
banked in (the default state after RESET: HIRAM/LORAM/CHAREN = `%111`,
which gives BASIC + KERNAL + I/O). The window is divided as follows.

| Range         | Owner            | Size       | Notes                                                        |
|---------------|------------------|------------|--------------------------------------------------------------|
| $D000-$D02F   | VIC-II           | 48 bytes   | 47 registers + 1 unused ($D02F reads $FF)                    |
| $D030-$D03F   | VIC-II "unused"  | 16 bytes   | Read as $FF; writes ignored                                  |
| $D040-$D3FF   | VIC-II shadow    | 960 bytes  | $D000-$D03F mirror, repeats every $40 bytes                  |
| $D400-$D41C   | SID              | 29 bytes   | 25 W + 4 R; full register set                                |
| $D41D-$D41F   | SID "unused"     | 3 bytes    | Not decoded. Reads return the byte the SID last drove on its bus (last SID write, or last $D419-$D41C read), on either chip model — not $FF, not $00; see the SID registers section below |
| $D420-$D7FF   | SID shadow       | 992 bytes  | $D400-$D41F mirror, repeats every $20 bytes                  |
| $D800-$DBFF   | Color RAM        | 1024 bytes | 4-bit-wide static RAM (nybble-wide)                          |
| $DC00-$DC0F   | CIA1             | 16 bytes   | Keyboard / joystick / IRQ source                             |
| $DC10-$DCFF   | CIA1 shadow      | 240 bytes  | $DC00-$DC0F mirror, repeats every $10 bytes                  |
| $DD00-$DD0F   | CIA2             | 16 bytes   | VIC bank / serial bus / user port / NMI source               |
| $DD10-$DDFF   | CIA2 shadow      | 240 bytes  | $DD00-$DD0F mirror, repeats every $10 bytes                  |
| $DE00-$DEFF   | I/O-1 expansion  | 256 bytes  | Cartridge I/O page 1 (open bus if no cart)                   |
| $DF00-$DFFF   | I/O-2 expansion  | 256 bytes  | Cartridge I/O page 2 (open bus if no cart)                   |

The window only appears at all because CHAREN (bit 2 of $01) and the
HIRAM/LORAM bits decide whether the area maps to I/O, to character
ROM, or to RAM. With CHAREN = 1 (and LORAM or HIRAM = 1) the CPU sees
I/O; with CHAREN = 0 (and LORAM or HIRAM = 1) the CPU sees the 4 KB
character ROM at $D000-$DFFF instead. This is how programs copy the
ROM font ($01 = $33, SEI first, because the KERNAL IRQ handler's
LDA $DC0D would read font bytes instead of the CIA). To reach the RAM
under $D000-$DFFF clear both LORAM and HIRAM ($01 = $30 or $34); CHAREN
alone never exposes RAM. The VIC-II ignores CHAREN and the rest of $01
entirely: it sees the character ROM at $1000-$1FFF of bank 0 and
$9000-$9FFF of bank 2 regardless of what the CPU has banked in. See
[c64-memory-map.md](c64-memory-map.md) modes 25-27 for the full
bank-switching treatment.

(An earlier version of this page said the character ROM was visible to
the VIC-II only and never to the CPU, and that clearing CHAREN exposed
RAM; both were wrong. Measured in VICE x64sc: with $01 = $33 the CPU
reads $3C/$66/$18 at $D000/$D001/$DBE8, bytes 0, 1 and $BE8 of the
chargen ROM, and with $01 = $30 it reads back RAM.)

## VIC-II registers ($D000-$D02F)

The video chip exposes 47 active registers in a 48-byte page (the final
$D02F always reads $FF). All addresses are CPU-visible only when the
I/O area is banked in. For bit-level detail, mode-by-mode behaviour, and
race-condition notes, see [vic-ii-reference.md](vic-ii-reference.md).

| Address | Name   | R/W | Description                              |
|---------|--------|-----|------------------------------------------|
| $D000   | M0X    | RW  | Sprite 0 X position (low 8 bits)         |
| $D001   | M0Y    | RW  | Sprite 0 Y position                      |
| $D002   | M1X    | RW  | Sprite 1 X position (low 8 bits)         |
| $D003   | M1Y    | RW  | Sprite 1 Y position                      |
| $D004   | M2X    | RW  | Sprite 2 X position (low 8 bits)         |
| $D005   | M2Y    | RW  | Sprite 2 Y position                      |
| $D006   | M3X    | RW  | Sprite 3 X position (low 8 bits)         |
| $D007   | M3Y    | RW  | Sprite 3 Y position                      |
| $D008   | M4X    | RW  | Sprite 4 X position (low 8 bits)         |
| $D009   | M4Y    | RW  | Sprite 4 Y position                      |
| $D00A   | M5X    | RW  | Sprite 5 X position (low 8 bits)         |
| $D00B   | M5Y    | RW  | Sprite 5 Y position                      |
| $D00C   | M6X    | RW  | Sprite 6 X position (low 8 bits)         |
| $D00D   | M6Y    | RW  | Sprite 6 Y position                      |
| $D00E   | M7X    | RW  | Sprite 7 X position (low 8 bits)         |
| $D00F   | M7Y    | RW  | Sprite 7 Y position                      |
| $D010   | MSIGX  | RW  | Sprite X position MSBs (bit n = sprite n) |
| $D011   | SCROLY | RW  | Screen control register 1 / raster MSB / Y-scroll |
| $D012   | RASTER | RW  | Raster line counter (R) / compare (W), low 8 bits |
| $D013   | LPENX  | R   | Light pen X position (latched at trigger) |
| $D014   | LPENY  | R   | Light pen Y position (latched at trigger) |
| $D015   | SPENA  | RW  | Sprite enable (bit n = sprite n)         |
| $D016   | SCROLX | RW  | Screen control register 2 / X-scroll / MCM / 38-col |
| $D017   | YXPAND | RW  | Sprite Y expansion (bit n = sprite n)    |
| $D018   | VMCSB  | RW  | Memory pointers (video matrix + character base) |
| $D019   | VICIRQ | RW  | Interrupt status / latch (write 1 to ack) |
| $D01A   | IRQMSK | RW  | Interrupt mask / enable                  |
| $D01B   | SPBGPR | RW  | Sprite-to-background priority (bit n = sprite n) |
| $D01C   | SPMC   | RW  | Sprite multicolor enable (bit n = sprite n) |
| $D01D   | XXPAND | RW  | Sprite X expansion (bit n = sprite n)    |
| $D01E   | SPSPCL | R   | Sprite-sprite collision (clears on read) |
| $D01F   | SPBGCL | R   | Sprite-background collision (clears on read) |
| $D020   | EXTCOL | RW  | Border color (low nibble)                |
| $D021   | BGCOL0 | RW  | Background color 0 (low nibble)          |
| $D022   | BGCOL1 | RW  | Background color 1 (low nibble) — MCM / ECM |
| $D023   | BGCOL2 | RW  | Background color 2 (low nibble) — MCM / ECM |
| $D024   | BGCOL3 | RW  | Background color 3 (low nibble) — ECM only |
| $D025   | SPMC0  | RW  | Sprite multicolor 0 (shared)             |
| $D026   | SPMC1  | RW  | Sprite multicolor 1 (shared)             |
| $D027   | SP0COL | RW  | Sprite 0 individual color (low nibble)   |
| $D028   | SP1COL | RW  | Sprite 1 individual color (low nibble)   |
| $D029   | SP2COL | RW  | Sprite 2 individual color (low nibble)   |
| $D02A   | SP3COL | RW  | Sprite 3 individual color (low nibble)   |
| $D02B   | SP4COL | RW  | Sprite 4 individual color (low nibble)   |
| $D02C   | SP5COL | RW  | Sprite 5 individual color (low nibble)   |
| $D02D   | SP6COL | RW  | Sprite 6 individual color (low nibble)   |
| $D02E   | SP7COL | RW  | Sprite 7 individual color (low nibble)   |
| $D02F   | UNUSED | R   | Unused on stock VIC-II; reads $FF        |

Quick groupings:

| Function                  | Addresses                                                   |
|---------------------------|-------------------------------------------------------------|
| Sprite positions          | $D000-$D00F (low) + $D010 (MSBs)                            |
| Screen control            | $D011 (SCROLY), $D016 (SCROLX), $D018 (VMCSB)               |
| Raster / IRQ              | $D011 bit 7, $D012, $D019, $D01A                            |
| Sprite enable + flags     | $D015, $D017, $D01B, $D01C, $D01D                           |
| Collisions                | $D01E (sprite-sprite), $D01F (sprite-background)            |
| Colors (screen)           | $D020, $D021, $D022, $D023, $D024                           |
| Colors (sprites)          | $D025, $D026, $D027-$D02E                                   |
| Light pen                 | $D013, $D014                                                |

The remaining bytes in $D030-$D03F all read $FF on a stock VIC-II and
ignore writes. They are reserved by Commodore and are used on later
chips: the VIC-IIe (8564/8566) in the C128 uses $D02F for the three
extra keyboard lines (bits 0-2 are stored; the upper five read 1) and
$D030 for the 2 MHz clock select (bit 0) and the test bit (bit 1; the
upper six read 1). On a stock 64 both addresses are dead. An earlier
revision of this page put the key port at "$D02F-$D030", which was
wrong: $D030 holds no keyboard bit. The register widths and the clock
bit were measured in VICE x128 3.10, in native and C64 mode with
identical results; which keyboard lines the $D02F bits drive is from
the C128 documentation and was not measured here.

## VIC-II shadow registers ($D040-$D3FF)

The VIC-II decodes only the bottom 6 bits of the address for register
selection. The chip's chip-select responds to the whole page $D000-$D3FF,
so the visible 64-byte page repeats sixteen times across that range.

| Mirror base | Mirrors           |
|-------------|-------------------|
| $D040-$D07F | $D000-$D03F       |
| $D080-$D0BF | $D000-$D03F       |
| $D0C0-$D0FF | $D000-$D03F       |
| $D100-$D13F | $D000-$D03F       |
| $D140-$D17F | $D000-$D03F       |
| $D180-$D1BF | $D000-$D03F       |
| $D1C0-$D1FF | $D000-$D03F       |
| $D200-$D23F | $D000-$D03F       |
| $D240-$D27F | $D000-$D03F       |
| $D280-$D2BF | $D000-$D03F       |
| $D2C0-$D2FF | $D000-$D03F       |
| $D300-$D33F | $D000-$D03F       |
| $D340-$D37F | $D000-$D03F       |
| $D380-$D3BF | $D000-$D03F       |
| $D3C0-$D3FF | $D000-$D03F       |

So `LDA $D012`, `LDA $D052`, `LDA $D092`, ..., `LDA $D3D2` all read the
same raster counter; `STA $D020`, `STA $D060`, ..., `STA $D3E0` all
write the border color. The mapping is `effective = ((addr - $D000) AND
$003F) + $D000`.

Code seen in the wild that uses shadow addresses (for example writing
$D420 instead of $D400, or addressing the raster counter as $D052 in a
relocatable loop) is correct hardware-level code, but rare. More
often, an address outside $D000-$D02F is a bug: a missing zero
in the literal, a stale pointer, a `STA absolute,Y` whose Y register
walked past 47.

$D02F-$D03F inside the page are unused on the 6569: measured in VICE
x64sc, `LDA` from $D02F, $D030, $D03F and the mirror $D06F all return
$FF. That gap, not the mirroring, is what let the C128's VIC-IIe put
new registers at $D02F and $D030 (rung 4) without breaking C64
software. (An earlier version credited the 16x mirror.)

### VIC-II quick lookup by function

From the visual effect to the register:

| You want to ...                                             | Register(s)               |
|-------------------------------------------------------------|---------------------------|
| Move sprite N horizontally                                  | $D000 + 2N, $D010 bit N   |
| Move sprite N vertically                                    | $D001 + 2N                |
| Turn sprite N on / off                                      | $D015 bit N               |
| Change sprite N's individual color                          | $D027 + N                 |
| Stretch sprite N horizontally                               | $D01D bit N               |
| Stretch sprite N vertically                                 | $D017 bit N               |
| Put sprite N "behind" character cells                       | $D01B bit N (set)         |
| Detect sprite-sprite overlap                                | $D01E (read, clears)      |
| Detect sprite-background overlap                            | $D01F (read, clears)      |
| Read the current raster line                                | $D012 (low), $D011 bit 7 (MSB) |
| Arm a raster interrupt at line L                            | $D012 + $D011 bit 7, $D01A bit 0 |
| Acknowledge a raster interrupt                              | $D019 (write 1 to bit 0)  |
| Switch screen mode (text / bitmap / MCM / ECM)              | $D011 bits 5,6; $D016 bit 4 |
| Smooth-scroll vertically                                    | $D011 bits 0-2 (YSCROLL)  |
| Smooth-scroll horizontally                                  | $D016 bits 0-2 (XSCROLL)  |
| Switch to 38-column mode (window 16 px narrower; the border stays shut) | $D016 bit 3 = 0 |
| Switch to 24-row mode (window 4 lines shorter at top and bottom; the border stays shut) | $D011 bit 3 = 0 |
| Open the borders                                            | Timed CSEL / RSEL writes, not the bits alone: see vic-ii-reference.md. An earlier revision of the two rows above said the bits opened the borders |
| Set border color                                            | $D020                     |
| Set background color (mode 0)                               | $D021                     |
| Point video matrix at screen RAM base                       | $D018 bits 4-7            |
| Point video matrix at character base                        | $D018 bits 1-3            |

## SID registers ($D400-$D41C)

The SID (MOS 6581 or its later 8580 successor) exposes 29 registers in a
32-byte page. The first 25 are write-only and the last 4 read-only, so
state in the first 25 cannot be recovered by reading them back.
Reading a write-only SID register ($D400-$D418),
or one of the undecoded addresses $D41D-$D41F (and their mirrors
through $D7FF), returns the byte the SID last drove on its data bus:
the last value WRITTEN to any SID register, or the last value READ from
$D419-$D41C (a read of ENV3 or OSC3 refreshes it too). It is not $FF,
not $00, and not the CPU's last fetched byte, on either chip model.
Measured in VICE 3.10 x64sc with reSID (`-sound -sounddev dummy
-sidengine 1`, both `-sidmodel 0` and `1`): after STA $D400,#$AA the
reads of $D401 and $D41D-$D41F all return $AA; after LDA $D41C (=$00)
a read of $D41D returns $00. The held byte fades to $00: in reSID
after about 7k cycles on the 6581 model and about 660k on the 8580
model, measured on [sid-reference.md](sid-reference.md) ("Write-only
registers"); an earlier version of this paragraph said the byte was
still there 1.3 M cycles later, which the SID page's measurement and
reSID's own time-to-live constants contradict. Real chips fade too;
the rates are not measured here. Never use these addresses
as a constant source or for read-modify-write; keep a software shadow.
Earlier versions of this page gave $FF, $00-on-8580 and the CPU's last
fetch; none matched the instrument. Harness note: with sound disabled
(`+sound`, the command line in CLAUDE.md) VICE substitutes a stand-in
SID that returns $00 for every write-only/undecoded read, so a $00 seen
that way is the emulator, not the chip. For bit-level detail on each register, the
ADSR rate table, filter routing, and the known oddities (the
$D418 master-volume click, the ADSR-bug, voice 3 mute, the absent
test pin readback), see [sid-reference.md](sid-reference.md).

| Address | Name    | R/W | Description                                  |
|---------|---------|-----|----------------------------------------------|
| $D400   | FRELO1  | W   | Voice 1 frequency, low byte                  |
| $D401   | FREHI1  | W   | Voice 1 frequency, high byte                 |
| $D402   | PWLO1   | W   | Voice 1 pulse width, low byte                |
| $D403   | PWHI1   | W   | Voice 1 pulse width, high nibble (bits 0-3)  |
| $D404   | VCREG1  | W   | Voice 1 control: gate / sync / ring / test / waveform |
| $D405   | ATDCY1  | W   | Voice 1 attack (hi nibble) / decay (lo nibble) |
| $D406   | SUREL1  | W   | Voice 1 sustain (hi nibble) / release (lo nibble) |
| $D407   | FRELO2  | W   | Voice 2 frequency, low byte                  |
| $D408   | FREHI2  | W   | Voice 2 frequency, high byte                 |
| $D409   | PWLO2   | W   | Voice 2 pulse width, low byte                |
| $D40A   | PWHI2   | W   | Voice 2 pulse width, high nibble (bits 0-3)  |
| $D40B   | VCREG2  | W   | Voice 2 control: gate / sync / ring / test / waveform |
| $D40C   | ATDCY2  | W   | Voice 2 attack / decay                       |
| $D40D   | SUREL2  | W   | Voice 2 sustain / release                    |
| $D40E   | FRELO3  | W   | Voice 3 frequency, low byte                  |
| $D40F   | FREHI3  | W   | Voice 3 frequency, high byte                 |
| $D410   | PWLO3   | W   | Voice 3 pulse width, low byte                |
| $D411   | PWHI3   | W   | Voice 3 pulse width, high nibble (bits 0-3)  |
| $D412   | VCREG3  | W   | Voice 3 control: gate / sync / ring / test / waveform |
| $D413   | ATDCY3  | W   | Voice 3 attack / decay                       |
| $D414   | SUREL3  | W   | Voice 3 sustain / release                    |
| $D415   | CUTLO   | W   | Filter cutoff frequency, low 3 bits          |
| $D416   | CUTHI   | W   | Filter cutoff frequency, high 8 bits         |
| $D417   | RESON   | W   | Filter resonance (hi nibble) + voice routing (lo nibble) |
| $D418   | SIGVOL  | W   | Filter mode select / voice-3 mute / master volume |
| $D419   | POTX    | R   | Paddle X — A/D converter result               |
| $D41A   | POTY    | R   | Paddle Y — A/D converter result               |
| $D41B   | RANDOM  | R   | Voice 3 oscillator output, high 8 bits        |
| $D41C   | ENV3    | R   | Voice 3 envelope generator output             |

$D41D, $D41E, and $D41F are not decoded. Reads return the held bus byte
described above: the last SID write or the last $D419-$D41C read, on
either chip model (VICE 3.10 x64sc, reSID, both `-sidmodel` values:
$AA after STA $D400,#$AA; $00 after LDA $D41C). Writes are discarded.
An earlier version of this paragraph said floating bus on a 6581 and
$00 on an 8580; neither matched the instrument.

Quick groupings:

| Voice | Frequency       | Pulse width      | Control | Attack/Decay | Sustain/Release |
|-------|-----------------|------------------|---------|--------------|-----------------|
| 1     | $D400 / $D401   | $D402 / $D403    | $D404   | $D405        | $D406           |
| 2     | $D407 / $D408   | $D409 / $D40A    | $D40B   | $D40C        | $D40D           |
| 3     | $D40E / $D40F   | $D410 / $D411    | $D412   | $D413        | $D414           |

| Function          | Addresses                |
|-------------------|--------------------------|
| Filter            | $D415, $D416, $D417, $D418 |
| Volume / mode     | $D418                    |
| Paddles           | $D419, $D41A             |
| Voice 3 readback  | $D41B (oscillator), $D41C (envelope) |

The voice-3 readbacks at $D41B (RANDOM / oscillator high byte) and $D41C
(ENV3) are the only way to read state out of an oscillator/envelope.
They are wired to voice 3 specifically. Code that wants a noise source
or an LFO routes voice 3 to an arbitrary frequency/waveform, optionally
disconnects it from the audio output via $D418 bit 7, and samples
$D41B or $D41C as needed.

## SID shadow registers ($D420-$D7FF)

The SID, like the VIC-II, decodes only the bottom 5 bits of the
address. Its chip-select responds to the whole 1 KB at $D400-$D7FF, so
the 32-byte register page repeats 31 times.

| Mirror base | Mirrors           |
|-------------|-------------------|
| $D420-$D43F | $D400-$D41F       |
| $D440-$D45F | $D400-$D41F       |
| $D460-$D47F | $D400-$D41F       |
| ...         | ...               |
| $D7C0-$D7DF | $D400-$D41F       |
| $D7E0-$D7FF | $D400-$D41F       |

`effective = ((addr - $D400) AND $001F) + $D400`.

A write to $D420 hits FRELO1. A write to $D7E0 hits FRELO1. A write to
$D7E0+$18 = $D7F8 hits SIGVOL ($D418). A stray store to a high address in the I/O range
can therefore pop the speaker as loudly as a direct write to $D418, in
code that never mentions $D418 by name. See the [Pitfalls](#pitfalls) section
below.

Second-SID boards decode a second chip at $D420 or $D500 (or another
base inside this shadow window), gating the original SID's chip-select.
Which products do so, and at which base, is not verified here (an earlier
version named "SID-Wizard 8-bit DAC", which is a tracker, not a board).
On stock hardware the entire $D420-$D7FF range is one chip: the same
SID, mirrored.

### SID quick lookup by function

| You want to ...                                       | Register(s)                |
|-------------------------------------------------------|----------------------------|
| Set voice N pitch                                     | $D400 + 7(N-1), $D401 + 7(N-1) |
| Set voice N pulse width                               | $D402 + 7(N-1), $D403 + 7(N-1) |
| Gate / release voice N                                | $D404 + 7(N-1) bit 0       |
| Pick waveform for voice N                             | $D404 + 7(N-1) bits 4-7    |
| Set voice N attack/decay                              | $D405 + 7(N-1)             |
| Set voice N sustain/release                           | $D406 + 7(N-1)             |
| Enable ring modulation on voice N                     | $D404 + 7(N-1) bit 2       |
| Enable hard sync on voice N                           | $D404 + 7(N-1) bit 1       |
| Reset voice N oscillator (test bit)                   | $D404 + 7(N-1) bit 3 = 1   |
| Set filter cutoff frequency                           | $D415, $D416               |
| Set filter resonance                                  | $D417 bits 4-7             |
| Route voice N through filter                          | $D417 bit (N-1)            |
| Route external audio in through filter                | $D417 bit 3                |
| Select filter mode (LP / BP / HP / BR)                | $D418 bits 4-6             |
| Mute voice 3 from audio output (keep oscillator)      | $D418 bit 7                |
| Set master volume                                     | $D418 bits 0-3             |
| Read paddle X / Y                                     | $D419, $D41A               |
| Read voice 3 oscillator output (random source)        | $D41B                      |
| Read voice 3 envelope output (LFO source)             | $D41C                      |
| Reset SID completely                                  | Write 0 to $D404, $D40B, $D412, $D418; then re-init |

Warnings:

- A common "fade out" routine writes $00..$0F to $D418 over time.
  Writing $D418 also reconfigures filter mode and voice-3 mute,
  so the usual idiom is to OR with the current $D418 value
  cached in zero page, not to write a raw nibble. Writing a raw
  nibble un-mutes voice 3 and switches the filter to "no
  filter" mode.
- How completely $D418 bit 7 (3OFF) silences voice 3 on real silicon
  is reported differently for the two chips in different sources, and
  is not measured here (an earlier version of this bullet asserted
  that the 6581's mixer leaks; `pitfalls/sid.md` asserts the reverse).
  In reSID both models drop voice 3 from the direct path. Do not rely
  on 3OFF for silence on either chip; set the voice's volume to zero
  through its envelope instead.

## Color RAM ($D800-$DBFF)

Color RAM is a 1 KB block of static RAM dedicated to the per-character
foreground color. Unlike RAM elsewhere in the C64, it is **4 bits wide**:
each address stores only the low nibble (0-15). The high nibble is not
stored anywhere: on a 6510 read it is whatever was last left on the
data bus, and on a C64 that is the byte the VIC-II fetched in the phi1
half-cycle just before the CPU's read: glyph or bitmap data inside the
display window, sprite pointers and sprite data, the DRAM-refresh bytes
from $3Fxx, and the idle fetch from $3FFF (or $39FF with ECM) in the
borders. It therefore changes with raster position, screen contents and
the VIC bank, and it is not the address high byte $D8 as this page
previously said; the CPU's operand fetch of $D8 is overwritten by the
VIC's fetch before the read cycle. Measured in VICE x64sc 3.10 (PAL):
with $3FFF=$A5, $3F00-$3FFE=$C3 and the sprite pointers set to $B0, a
cell holding 5 read $A5 in 77 of 100 border samples, $B5, $C5 and $05
in the rest, and $55 once $3FFF was changed to $5A — never $D5. Code
that needs a byte-clean value must mask with `AND #$0F`.

| Range         | Description                                                |
|---------------|------------------------------------------------------------|
| $D800-$DBE7   | Foreground color for each of the 1000 text cells (40 x 25). Byte n corresponds to character at $0400+n in the default screen RAM. |
| $D800-$DBFF   | Used as additional color storage by multicolor bitmap mode |
| $DBE8-$DBFF   | Unused by stock screen modes; on 4-bit chip, reads as undefined nibble high, low nibble is RAM |

Color RAM is always at $D800-$DBFF regardless of which VIC-II video
bank is selected by CIA2 $DD00 bits 0-1, because it is a separate
4-bit-wide chip, not part of the DRAM the bank bits choose from. Each
c-access reads 12 bits: the 8-bit screen code from the bank and the
colour nibble from color RAM in the same cycle
([vic-ii-reference.md](vic-ii-reference.md), memory access table). The
nibble arrives on four extra VIC data lines (rung 4). (An earlier
version said a dedicated wire bypassed the address multiplexer and that
the nibble shared a pin with the matrix's high bits.)

Consequences:

- **Always writable — through the I/O window.** Colour RAM never
  write-protects, but the CPU only reaches it while I/O is mapped at
  $D000. A write made with I/O banked out lands in the DRAM underneath
  $D800 and the VIC never sees it (measured in VICE x64sc: colour RAM
  seeded 5, then `LDA #$34 / STA $01 / LDA #9 / STA $D800`; the cell
  still displays colour 5 and reads back 5 once I/O is restored).
- **High nibble undefined.** Reads of $D800+n only contain meaningful
  data in bits 0-3.
- **Reachable only through the I/O window.** The VIC always sees colour
  RAM, whatever $01 or $DD00 say. The CPU sees it only while I/O is
  banked in: $01 bits 0-2 = %101, %110 or %111 ($35/$36/$37). With
  CHAREN = 0 and LORAM or HIRAM set (%001-%011, $31-$33) the CPU reads
  character ROM at $D800-$DBFF instead; with LORAM = HIRAM = 0
  (%000/%100, $30/$34) it reads and writes the plain RAM underneath, and
  CHAREN makes no difference. All eight modes measured in VICE x64sc.
  An earlier version of this page said only CHAREN mattered; it does
  not. Code in the all-RAM configuration ($34) must bank I/O back in
  ($35) before touching colour RAM.
- **Power-on contents are random.** Most programs `LDA #col / STA $D800,X`
  in a loop before turning on the screen. A screen mode switched on
  before initializing color RAM shows glyphs in whatever random
  nibble is in RAM as their foreground color.

For multicolor character mode, bit 3 of color RAM toggles per-cell
whether that character uses the multicolor palette ($D021/$D022/$D023
+ low 3 bits of color RAM) or the standard hi-res palette ($D021 +
color RAM bits 0-2, so only colours 0-7). (An earlier version said the
hi-res cell used the whole nibble; bit 3 is the mode switch.) See [vic-ii-reference.md](vic-ii-reference.md)
multicolor text mode section.

## CIA1 registers ($DC00-$DC0F)

CIA1 is the 6526 Complex Interface Adapter wired to the keyboard
matrix, the two control-port joysticks, the paddle select for both
ports ($DC00 bits 6-7 pick which port's pair the SID's POTX/POTY read;
see the quick lookup below), and the system IRQ line. (An earlier
version said the paddles were multiplexed with joystick port 1.) It is the source of the
jiffy-clock IRQ that drives most KERNAL timing. The KERNAL programs it
to ~60 Hz on BOTH regions, not 60/50: the timer-load tail of IOINIT
($FDDD-$FDF8), which CINT ($FF5B) re-enters once it has detected the
region into $02A6 (the VIC init table sets raster compare 311, a line
only a PAL frame reaches), writes Timer A latch $4025 on PAL
(985,248 / 16,422 = 59.996 Hz) and $4295 on NTSC (1,022,727 / 17,046 =
59.998 Hz). One jiffy is 1/60 s everywhere; only the video frame rate
differs (50.12 Hz PAL, 59.83 Hz NTSC 6567R8). An earlier version of
this page said 50 Hz on PAL; the ROM bytes at $FDE2-$FDF5 of
kernal-901227-03 say otherwise, and a VICE x64sc count gives 299
jiffies in 250 PAL frames, not 250.

For bit-level detail on each register (the keyboard scan
matrix, the joystick bit-to-pin mapping, the TOD clock's BCD
encoding, and how the timer control bits interact), see
[cia-reference.md](cia-reference.md).

| Address | Name | R/W | Description                                            |
|---------|------|-----|--------------------------------------------------------|
| $DC00   | DC00 | RW  | Data Port A — keyboard column drive / joystick port 2 |
| $DC01   | DC01 | RW  | Data Port B — keyboard row read / joystick port 1     |
| $DC02   | DC02 | RW  | Data Direction Register A                              |
| $DC03   | DC03 | RW  | Data Direction Register B                              |
| $DC04   | DC04 | RW  | Timer A low byte (latch on write, current on read)     |
| $DC05   | DC05 | RW  | Timer A high byte (latch on write, current on read)    |
| $DC06   | DC06 | RW  | Timer B low byte                                       |
| $DC07   | DC07 | RW  | Timer B high byte                                      |
| $DC08   | DC08 | RW  | Time-of-day tenths-of-second (BCD)                     |
| $DC09   | DC09 | RW  | Time-of-day seconds (BCD)                              |
| $DC0A   | DC0A | RW  | Time-of-day minutes (BCD)                              |
| $DC0B   | DC0B | RW  | Time-of-day hours (BCD, bit 7 = AM/PM)                 |
| $DC0C   | DC0C | RW  | Serial shift register                                  |
| $DC0D   | DC0D | RW  | Interrupt control register — drives /IRQ               |
| $DC0E   | DC0E | RW  | Control register A (Timer A run / mode / TOD freq)     |
| $DC0F   | DC0F | RW  | Control register B (Timer B run / mode / TOD set)      |

Quick groupings:

| Function           | Addresses                            |
|--------------------|--------------------------------------|
| Ports              | $DC00, $DC01, $DC02, $DC03           |
| Timer A            | $DC04, $DC05, $DC0E                  |
| Timer B            | $DC06, $DC07, $DC0F                  |
| Time-of-day clock  | $DC08, $DC09, $DC0A, $DC0B; $DC0E bit 7 (50/60 Hz input), $DC0F bit 7 (clock/alarm write select) |
| Serial port        | $DC0C                                |
| Interrupts         | $DC0D only (write: mask, bit 7 = set/clear; read: flags, and the read clears them). An earlier revision listed $DC0E bit 7 and $DC0F bit 7 here; they are TOD controls, not interrupt bits (measured in VICE x64sc). |

The system jiffy IRQ comes from Timer A on CIA1, programmed by the
KERNAL at boot to fire ~60 times per second on both PAL and NTSC
(latch $4025 PAL / $4295 NTSC, $DC0D=$81, $DC0E=$11) and to invoke the
IRQ vector via $0314/$0315. Programs that want their
own raster IRQ usually disable CIA1's Timer A IRQ at $DC0D (and
re-enable VIC-II's raster IRQ at $D01A bit 0) so the only interrupt
source is the video chip.

### CIA1 quick lookup by function

| You want to ...                                  | Register(s)               |
|--------------------------------------------------|---------------------------|
| Scan the keyboard                                | $DC00 (drive col), $DC01 (read row), $DC02/$DC03 (DDR) |
| Read joystick port 2                             | $DC00 bits 0-4 (low = pressed) |
| Read joystick port 1                             | $DC01 bits 0-4 (low = pressed) |
| Read paddle buttons                              | $DC00 (port 2) / $DC01 (port 1) bits 2 and 3 — paddle A and paddle B buttons appear on the joystick LEFT and RIGHT lines, not on FIRE (bit 4). From the Programmer's Reference Guide's paddle section, not measured here: a headless VICE cannot press a paddle button. An earlier version of this row said bit 4 |
| Switch which paddle pair is multiplexed in       | $DC00 bits 6-7 (%01 = port 1, %10 = port 2; $DC02 bits 6-7 must be outputs, which the KERNAL leaves them). Measured in VICE x64sc; an earlier revision of this row said $DD00, whose bits 6-7 are IEC CLK IN / DATA IN and have nothing to do with paddles. The KERNAL keyboard scan rewrites $DC00 every jiffy IRQ, so select the pair with IRQs masked or re-select before each read, and allow the ~512-cycle settle |
| Program Timer A as a one-shot                    | $DC04, $DC05, $DC0E bit 3 = 1 |
| Program Timer A as continuous                    | $DC04, $DC05, $DC0E bit 3 = 0 |
| Start Timer A                                    | $DC0E bit 0 = 1           |
| Enable Timer A underflow IRQ                     | $DC0D = $81               |
| Disable all CIA1 IRQs (e.g. for raster work)     | $DC0D = $7F (clear all)   |
| Acknowledge any pending CIA1 IRQ                 | Read $DC0D                |
| Read the TOD clock                               | Read $DC0B first (latches), then $DC0A, $DC09, $DC08 |
| Set the TOD clock                                | $DC0F bit 7 = 0, then write $DC0B (hours; stops the clock), $DC0A, $DC09, $DC08 (tenths; restarts it). With bit 7 = 1 the same four writes program the ALARM and leave the clock untouched — this row used to say bit 7 = 1 (measured in VICE x64sc). Write the alarm while the clock cannot equal any intermediate alarm value: a partially written alarm that matches the running clock sets $DC0D bit 2 at once (observed in VICE). Both rules and the probe behind them: `pitfalls/cia.md` → `tod_read_order_latch` |
| Toggle TOD source frequency (50 vs 60 Hz)        | $DC0E bit 7               |

## CIA1 shadow registers ($DC10-$DCFF)

CIA1 decodes only the bottom 4 bits of the address. Its chip-select
responds to all of $DC00-$DCFF, so the 16-byte register page repeats
15 times.

| Mirror base | Mirrors        |
|-------------|----------------|
| $DC10-$DC1F | $DC00-$DC0F    |
| $DC20-$DC2F | $DC00-$DC0F    |
| $DC30-$DC3F | $DC00-$DC0F    |
| $DC40-$DC4F | $DC00-$DC0F    |
| $DC50-$DC5F | $DC00-$DC0F    |
| $DC60-$DC6F | $DC00-$DC0F    |
| $DC70-$DC7F | $DC00-$DC0F    |
| $DC80-$DC8F | $DC00-$DC0F    |
| $DC90-$DC9F | $DC00-$DC0F    |
| $DCA0-$DCAF | $DC00-$DC0F    |
| $DCB0-$DCBF | $DC00-$DC0F    |
| $DCC0-$DCCF | $DC00-$DC0F    |
| $DCD0-$DCDF | $DC00-$DC0F    |
| $DCE0-$DCEF | $DC00-$DC0F    |
| $DCF0-$DCFF | $DC00-$DC0F    |

`effective = ((addr - $DC00) AND $000F) + $DC00`.

The shadow has the same destructive properties as the real registers.
In particular, **a read of $DCnD with the low nibble = D acknowledges and
clears all pending IRQ source bits**. A loop that walks `LDA $DC00,X`
across a wide range of X acknowledges CIA1's IRQ register on every
16th byte and loses any pending interrupt source bits. C64 software
does not walk $D000-$DFFF with a generic loop for this reason. A memory test or copy that needs those 4 KB either skips them or
banks the I/O area out first and reads the RAM underneath (see the I/O
window layout section above and c64-memory-map.md). An earlier revision
of this sentence had lost its negation and read as though software
walks the I/O area deliberately. The hazard is measured:
in VICE x64sc 3.10, with a Timer A underflow pending, a `LDA $DC00,X`
walk over X = 0..255 left $DC0D reading $00, while a walk over
X = 0..12 that never touched an $xD address left it reading $81.

## CIA2 registers ($DD00-$DD0F)

CIA2 is the second 6526. It owns the VIC-II's two bank-select bits
(the high two address bits the chip uses to choose its 16 KB window),
the serial bus to peripherals like the 1541, the RS-232 lines, the
user port's data lines, and the system NMI line.

| Address | Name | R/W | Description                                                |
|---------|------|-----|------------------------------------------------------------|
| $DD00   | DD00 | RW  | Data Port A — VIC bank select (bits 0-1) + IEC serial bus  |
| $DD01   | DD01 | RW  | Data Port B — user port data                               |
| $DD02   | DD02 | RW  | Data Direction Register A                                  |
| $DD03   | DD03 | RW  | Data Direction Register B                                  |
| $DD04   | DD04 | RW  | Timer A low byte                                           |
| $DD05   | DD05 | RW  | Timer A high byte                                          |
| $DD06   | DD06 | RW  | Timer B low byte                                           |
| $DD07   | DD07 | RW  | Timer B high byte                                          |
| $DD08   | DD08 | RW  | Time-of-day tenths-of-second                               |
| $DD09   | DD09 | RW  | Time-of-day seconds                                        |
| $DD0A   | DD0A | RW  | Time-of-day minutes                                        |
| $DD0B   | DD0B | RW  | Time-of-day hours                                          |
| $DD0C   | DD0C | RW  | Serial shift register (unused by the KERNAL)               |
| $DD0D   | DD0D | RW  | Interrupt control register — drives /NMI                   |
| $DD0E   | DD0E | RW  | Control register A (Timer A)                               |
| $DD0F   | DD0F | RW  | Control register B (Timer B)                               |

Quick groupings:

| Function                   | Addresses                            |
|----------------------------|--------------------------------------|
| Ports + VIC bank + serial  | $DD00, $DD01, $DD02, $DD03           |
| Timer A                    | $DD04, $DD05, $DD0E                  |
| Timer B                    | $DD06, $DD07, $DD0F                  |
| Time-of-day                | $DD08-$DD0B                          |
| Shift register             | $DD0C                                |
| NMI source                 | $DD0D                                |

Key wiring points (the per-pin table is in
[cia-reference.md](cia-reference.md)):

- **$DD00 bits 0-1** — VIC-II bank select. Inverted: `00 = $C000-$FFFF`,
  `01 = $8000-$BFFF`, `10 = $4000-$7FFF`, `11 = $0000-$3FFF` (default
  after RESET).
- **$DD00 bit 2** — user-port PA2, the KERNAL's RS-232 TXD output (idle
  high; the NMI transmit code masks it with `AND #$FB` at `$FE7E` before
  the store at `$FE82`).
- **$DD00 bits 3-5** — IEC outputs: ATN OUT, CLK OUT, DATA OUT. Writing 1
  pulls the bus line low (the KERNAL's CLKLO at `$EE8E` is `ORA #$10`,
  CLKHI at `$EE85` is `AND #$EF`).
- **$DD00 bits 6-7** — IEC inputs: CLK IN, DATA IN. These are *not*
  inverted: 1 = line released (high), 0 = line pulled low by some device.
  Measured in VICE x64sc 3.10: with all outputs released $DD00 reads $C7;
  with a 1541 answering ATN, bit 7 reads 0; and the KERNAL's
  device-not-present test at `$ED47` is `BCS` on bit 7. The KERNAL's DDR
  of $3F (`$FDD0`) makes exactly bits 0-5 outputs. (An earlier version of
  this list put the inputs inside "bits 2-5".)
- **$DD0D** — write with bit 7 = 1 plus bit n to enable NMI source n
  (bit 7 = 0 plus bit n to disable it); a read returns the pending flags
  and clears them. RESTORE is **not** a CIA2 source: the key reaches the
  6510's /NMI pin through its own one-shot timer, in parallel with CIA2's
  /IRQ output (wiring in [cia-reference.md](cia-reference.md)). The
  KERNAL handler at $FE47 masks $DD0D with $7F, reads it, and goes to the
  RS-232 code only if a CIA2 bit is set; with none set it checks for a
  cartridge (CBM80 → JMP ($8002)), then the STOP key, and warm-starts
  BASIC through ($A002) only when RUN/STOP is held; RESTORE alone
  returns. That is why RUN/STOP+RESTORE is almost a reset. (An earlier
  version of this page said RESTORE came in on /FLAG, bit 4, and that the
  KERNAL armed it; IOINIT at $FDA3 writes $7F to $DD0D, which disables
  FLAG, and the only KERNAL code that enables FLAG is RS-232 receive at
  $EF7E; read from kernal-901227-03.bin.) The dispatch table, the
  20-cycle cost of taking $0318 and the NMI lock are in
  `pitfalls/kernal-and-io.md` → `restore_nmi_not_maskable`.

### CIA2 quick lookup by function

| You want to ...                                  | Register(s)               |
|--------------------------------------------------|---------------------------|
| Switch VIC-II to bank N (0-3)                    | $DD00 bits 0-1 = NOT N    |
| Drive the IEC serial bus (1541 etc.)             | $DD00 bits 3,4,5 (ATN, CLK, DATA out) |
| Read IEC serial bus status                       | $DD00 bits 6,7 (CLK IN, DATA IN). $DD01 is the user port, not the bus; an earlier revision of this row added it |
| Set up an RS-232 receive                         | $DD01 bit 0 (RXD), Timer B $DD06/$DD07/$DD0F, FLAG in $DD0D. The KERNAL ROM never reads or writes $DD0C (searched kernal-901227-03.bin); an earlier revision of this row and of the table above called $DD0C the RS-232 receive register |
| Use Timer A for music IRQ via NMI                | $DD04, $DD05, $DD0E, $DD0D bit 0 |
| Neutralise the RESTORE key                       | Point $0318/$0319 at an RTI or your own handler ($FE43 does SEI / JMP ($0318) with nothing pushed, so a bare RTI is valid). No $DD0D value masks it — an earlier revision of this row said $DD0D = $10, which clears an already-clear bit and leaves RESTORE armed. Pitfall: `restore_nmi_not_maskable` |
| Acknowledge any pending CIA2 NMI                 | Read $DD0D                |
| Use the user port as 8 GPIO lines                | $DD01, $DD03 (DDR)        |

## CIA2 shadow registers ($DD10-$DDFF)

Same 4-bit decode rule as CIA1: the 16-byte page mirrors 15 times.

| Mirror base | Mirrors        |
|-------------|----------------|
| $DD10-$DD1F | $DD00-$DD0F    |
| $DD20-$DD2F | $DD00-$DD0F    |
| $DD30-$DD3F | $DD00-$DD0F    |
| $DD40-$DD4F | $DD00-$DD0F    |
| $DD50-$DD5F | $DD00-$DD0F    |
| $DD60-$DD6F | $DD00-$DD0F    |
| $DD70-$DD7F | $DD00-$DD0F    |
| $DD80-$DD8F | $DD00-$DD0F    |
| $DD90-$DD9F | $DD00-$DD0F    |
| $DDA0-$DDAF | $DD00-$DD0F    |
| $DDB0-$DDBF | $DD00-$DD0F    |
| $DDC0-$DDCF | $DD00-$DD0F    |
| $DDD0-$DDDF | $DD00-$DD0F    |
| $DDE0-$DDEF | $DD00-$DD0F    |
| $DDF0-$DDFF | $DD00-$DD0F    |

`effective = ((addr - $DD00) AND $000F) + $DD00`.

Like CIA1, reads of $DDnD with low nibble = D ack and clear CIA2's
pending NMI source bits. NMIs are usually not enabled and the shadow
does no harm, but a program using a CIA2 timer NMI (the KERNAL's
RS-232 driver is one) faces the same hazard. (An earlier version called
CIA2 timer NMIs common for fast loaders and SoundMonitor-style audio;
nothing here supports that.)

## I/O expansion ($DE00-$DFFF)

These two 256-byte pages are reserved for cartridges. They are wired
to the expansion-port pins /IO1 and /IO2, which a cartridge can use to
decode its own registers.

| Range         | Pin   | Notes                                                                   |
|---------------|-------|-------------------------------------------------------------------------|
| $DE00-$DEFF   | /IO1  | Cartridge I/O page 1. No internal devices.                              |
| $DF00-$DFFF   | /IO2  | Cartridge I/O page 2. No internal devices.                              |

Behaviour with no cartridge present:

- Reads return open bus: the byte the VIC-II fetched in the preceding
  phi1 half-cycle, all eight bits: in the border the idle byte at $3FFF
  of the current VIC bank, on screen glyph/bitmap data, plus sprite
  pointers and $3Fxx refresh bytes. It is not the address high byte, and
  the CPU drives nothing during a read (this page previously said
  $DE/$DF; the operand byte the CPU fetched is overwritten by the VIC's
  fetch before the read cycle). Measured in VICE x64sc 3.10: $DE00 and
  $DF00 both returned $A5/$B0/$C3/$00, tracking $3FFF, the sprite
  pointers, $3Fxx and the last display line's glyph rows — never $DE or
  $DF. Board-revision differences are not measured here. Do not detect a
  cartridge by reading these addresses; write a pattern and read it back
  (see c64-memory-map.md).
- Writes are discarded.

Behaviour with a cartridge present is entirely cartridge-defined. The
rows below are read from VICE 3.10's cartridge emulation source,
`src/c64/cart/<file>.c` (the `io_source_t` range of each I/O device and
its read and store functions). That is how VICE decodes each cartridge,
the machine every recipe here is verified on; no row was measured on a
real cartridge. Where the source's comment and its decode differ, the
decode is given.

| Cartridge (VICE file)                  | $DE00-$DEFF (/IO1)                                                                   | $DF00-$DFFF (/IO2)                                                            |
|----------------------------------------|--------------------------------------------------------------------------------------|-------------------------------------------------------------------------------|
| Action Replay 4.2-6 (`actionreplay.c`) | One write-only control register at $DE00, mirrored through $DEFF: ROM bank, EXROM/GAME, RAM enable, freeze release, cartridge off. VICE warns that a read corrupts it | The last page of the cartridge's 8 KB RAM ($9F00-$9FFF) when RAM is enabled, else cartridge ROM |
| Retro Replay (`retroreplay.c`)         | Registers at $DE00 and $DE01; the rest of the page is cartridge RAM or ROM          | Cartridge RAM or ROM                                                          |
| Final Cartridge I/II (`final.c`)       | Any access turns the cartridge ROM off; reads show a ROM mirror                      | Any access turns the cartridge ROM on; reads show a ROM mirror                |
| Final Cartridge III (`final3.c`)       | A mirror of the last two pages of the selected ROM bank                              | The same mirror, and at $DFFF the one control register (bank, EXROM, GAME, NMI, hide bit) |
| EasyFlash (`easyflash.c`)              | $DE00 bank register (6 bits), $DE02 mode register (bit 7 LED, bit 2 mode, bits 1-0 EXROM/GAME); VICE decodes $DE00-$DE03, mirrored through $DEFF; write only | 256 bytes of RAM, read and write                                              |
| Magic Desk (`magicdesk.c`)             | One write-only register at $DE00, mirrored through $DEFF: bits 0-6 bank, bit 7 = 1 turns the cartridge off. Originals have 4, 8 or 16 banks of 8 KB | Not decoded                                                                   |
| KCS Power Cartridge (`kcs.c`)          | Reads show ROM (the second-last page of the first 8 KB bank); an access sets EXROM from address bit 1 and GAME from R/W | $DF00-$DF7F 128 bytes of RAM; $DF80-$DFFF reads the GAME and EXROM lines      |
| GeoRAM (`georam.c`)                    | A 256-byte window into the GeoRAM                                                    | $DFFE selects the 256-byte page (0-63) within a 16 KB block, $DFFF the block; decoded at $DF80-$DFFF, so each mirrors through that half page |
| REU 1700/1764/1750 (`reu.c`)           | Not decoded                                                                          | The REC registers at $DF00-$DF0A (status, command, C64 address, REU address and bank, length, interrupt mask, address control); $DF0B-$DF1F unused; the 32 bytes mirror through $DFFF |
| MMC64 (`mmc64.c`)                      | VICE also answers the same four registers at $DE10-$DE13                             | SD card SPI and control registers at $DF10-$DF13                              |
| MMC Replay (`mmcreplay.c`)             | Registers at $DE00 and $DE01; $DE02-$DEFF can be cartridge RAM                       | SD card registers at $DF10-$DF13, mirrored through the rest of the page       |

An earlier version of this table cited no source and had four rows wrong:
it gave EasyFlash's $DF00 as "LED + I/O" (the LED is bit 7 of $DE02 and
$DF00-$DFFF is RAM), put the REU's and the MMC64's $DFxx registers in the
$DE00 column, gave the KCS Power Cartridge as "$DF00 control" in both
columns, and grouped the Final Cartridge with Action Replay's $DE00
control register.

Software written to be cartridge-agnostic must avoid touching $DE00-$DFFF
unless it knows what cartridge is plugged in. By the decodes above, a
stray write can switch a cartridge's ROM bank or turn it off (Action
Replay, Magic Desk, EasyFlash), raise an NMI (Final Cartridge III,
$DFFF bit 6 = 0), or start a REU transfer over memory ($DF01 with bit 7
set; with bit 4 set too it starts at once, not at the next write to
$FF00). An earlier version of this paragraph said a write could trigger
the Action Replay's freeze; in VICE's decode $DE00 bit 6 releases the
freeze, and the freeze itself comes from the button.

## Address-to-chip dispatch table

The inverse of the per-chip lists above: given any address in
$D000-$DFFF, for example a literal seen in disassembly, find the chip
and the effective canonical register it resolves to.

| If address is in ...   | The chip is ...    | The effective register is ...                                                              |
|------------------------|--------------------|--------------------------------------------------------------------------------------------|
| $D000-$D02F            | VIC-II             | The literal address.                                                                       |
| $D030-$D03F            | VIC-II ("unused")  | Reads $FF, writes ignored. Do not write — VIC-IIe uses these.                              |
| $D040-$D3FF            | VIC-II shadow      | `((addr - $D000) AND $3F) + $D000`. Watch for $D019 (IRQ ack) and $D01E/$D01F (clear-on-read). |
| $D400-$D41C            | SID                | The literal address.                                                                       |
| $D41D-$D41F            | SID ("unused")     | Not decoded. Reads return the byte the SID last drove on its bus (last SID write or last $D419-$D41C read), either chip model — not $FF, not $00 (VICE reSID; see SID registers above); writes discarded. |
| $D420-$D7FF            | SID shadow         | `((addr - $D400) AND $1F) + $D400`. Watch for $D418 (master vol pop) and write-only registers — a read returns the SID's last bus byte, not the register's contents. |
| $D800-$DBFF            | Color RAM          | The literal address. 4-bit-wide RAM; mask reads with `AND #$0F`.                           |
| $DC00-$DC0F            | CIA1               | The literal address.                                                                       |
| $DC10-$DCFF            | CIA1 shadow        | `((addr - $DC00) AND $0F) + $DC00`. Any read of $DCxD ($DC0D, $DC1D, ..., $DCFD) acks/clears IRQ source bits. |
| $DD00-$DD0F            | CIA2               | The literal address.                                                                       |
| $DD10-$DDFF            | CIA2 shadow        | `((addr - $DD00) AND $0F) + $DD00`. Any read of $DDxD acks/clears NMI source bits.         |
| $DE00-$DEFF            | Cartridge /IO1     | Cartridge-defined. Open bus if no cartridge.                                               |
| $DF00-$DFFF            | Cartridge /IO2     | Cartridge-defined. Open bus if no cartridge.                                               |

## Power-on / reset state

After RESET, the KERNAL initializes a subset of these registers to
known values before turning on the screen. The chips themselves do
not all power-up in a defined state; the per-chip docs list which
bits are guaranteed and which are floating.

The KERNAL-set state, in two columns because they differ:
what the KERNAL stores (ROM 901227-03, IOINIT $FDA3 and the VIC table
at $ECB9) and what the register reads back afterwards (measured in VICE
x64sc 3.10). An earlier version of this table mixed the two in one
column, called $7F in $DC00 "all columns high", and said $DD0D left
FLAG enabled for RESTORE; all three were wrong.

| Address | KERNAL writes | Reads back | What it means |
|---------|---------------|------------|---------------|
| $D011   | $9B | $1B (raster < 256; $9B on lines 256+) | RSEL=1, DEN=1, YSCROLL=3, BMM/ECM=0; bit 7 is the raster-compare MSB — with $D012=$37 the compare line is $137 |
| $D016   | $08 | $C8 | CSEL=1, MCM=0, XSCROLL=0; bits 6-7 always read 1 |
| $D018   | $14 | $15 | Video matrix $0400, character base $1000 (char ROM); bit 0 reads 1 |
| $D019   | $0F | $71 PAL / $70 NTSC | Write-1-to-ack of every latch; bits 4-6 read 1, and on PAL the raster latch is already set again because compare line 311 exists in a 312-line frame and not in NTSC's 263 |
| $D01A   | $00 | $F0 | All VIC-II IRQ sources disabled; bits 4-7 read 1 |
| $D020   | $0E | $FE | Border light blue; high nibble reads 1 |
| $D021   | $06 | $F6 | Background blue; high nibble reads 1 |
| $D418   | $00 | (write-only) | Volume 0, filter off. The only SID register the KERNAL touches ($FDC4). $D400-$D417 are not written by software; the 6581 datasheet says the chip's own /RES clears them, which cannot be measured here because they are write-only |
| $DC00   | $7F | $7F | Column 7 driven low, the other seven high. UDTIM's STOP-key test ($F6BC) reads $DC01 bit 7 against this without re-selecting a column, and SCNKEY exits with the same $7F |
| $DC0D   | $81 | $00 (pending flags; the mask cannot be read) | Timer A IRQ enabled (the jiffy clock) |
| $DC0E   | $11 | $01 | Timer A running, continuous; bit 4 (LOAD) is a strobe and reads 0 |
| $DD00   | $07 | $97 | VIC bank 0 ($0000-$3FFF), TXD high, serial lines released; bits 6-7 are CLK IN / DATA IN and read 1 with the bus idle |
| $DD0D   | $7F | $00 | All five CIA2 NMI sources disabled, FLAG included. RESTORE reaches /NMI directly, not through this register (see cia-reference.md); RS-232 OPEN enables FLAG and the timers later |

RUN/STOP+RESTORE is not a hardware reset, but it re-initialises far
more than an earlier version of this page said (it claimed the VIC-II
kept its display mode and colour RAM was untouched; both are wrong,
read from the 901227-03 ROM and measured in VICE x64sc). The KERNAL NMI
handler ($FE47) reads $DD0D; when no CIA2 source fired it checks for a
cartridge, scans the STOP key, and with STOP held runs RESTOR ($FD15:
the RAM vectors $0314-$0333 go back to the KERNAL defaults, so a custom
IRQ or NMI handler is gone too), IOINIT ($FDA3: both CIAs
re-programmed, $DD00 = $07, $01 = $E7, and $D418 = 0, the KERNAL's only
SID write) and CINT ($E518: all 47 VIC-II registers rewritten from the
$ECB9 table: $D011 $1B, $D016 $C8 as read back ($08 is written), $D018
$14, $D020 $0E, $D021 $06, sprite colours 1-7 and grey for sprite 7,
then screen RAM filled with spaces and colour RAM with $0E), and
finally jumps through ($A002) to the BASIC warm start. Only the SID's
$D400-$D417 keep their values, muted by volume 0: a note that was
sounding keeps oscillating and comes back the moment $D418 is written
again (POKE 54296,15). A plain RESTORE without RUN/STOP leaves screen,
colour RAM and SID alone: the handler finds no CIA2 source, sees STOP
up and RTIs; its only side effect is writing $7F to $DD0D, reading it
back (which acknowledges any CIA2 source), and restoring the mask from
the RS-232 enable byte $02A1.

## Pitfalls

- **Shadow-register confusion.** A wrong address that falls
  inside the I/O area often does the same thing as the matching
  base address, not nothing. Writing $D420 is writing $D400 (FRELO1);
  writing $D7F8 is writing $D418 (SIGVOL, speaker pop); writing $D052
  is writing $D012 (raster compare: the raster IRQ moves). A null
  pointer plus a small offset can hit live hardware. See the per-chip
  shadow sections above for the exact modulo rules.

- **$D7FF SID side-effects.** The last byte of the SID shadow
  region, $D7FF, mirrors $D41F, which is unused on a stock
  SID. But $D7F8 mirrors $D418, $D7E5 mirrors $D405, $D7E0 mirrors
  $D400. A program that uses $D700-$D7FF as scratchpad RAM because
  the addresses look free is writing SID registers on every store.
  This is a common cause of random clicks, sustained tones after a
  tune ends, and paddle-readback corruption.

- **Color RAM high nibble is garbage.** `LDA $D800` returns `$?n` where
  `?` is the byte the VIC fetched in the preceding phi1 cycle (idle byte
  $3FFF in the border, glyph/bitmap data on screen, sprite pointers,
  $3Fxx refresh), not $D8, as this page once said. VICE x64sc:
  $A5/$B5/$C5/$05 for a cell holding 5 with $3FFF=$A5. Always mask with
  `AND #$0F` before comparing.

- **$DC0D / $DD0D destructive read.** Reading the interrupt control
  register of either CIA acknowledges and clears every pending source
  bit. Code that wants to inspect IRQ state without losing pending
  interrupts has to mask interrupts (SEI), latch the read, and then
  re-enable. The same hazard applies to every shadow address ending
  in $D inside CIA1 or CIA2; there are 16 such addresses per CIA in
  the $xx00-$xxFF page.

- **$DE00 / $DF00 cartridge clobbering.** A memory test or RAM
  copy that walks $D000-$DFFF, on a machine with an Action
  Replay or Final Cartridge plugged in, switches the cartridge's
  banks or turns its ROM off under the program, and on a Final
  Cartridge III can raise an NMI (the table above; an earlier version
  said it triggers the freeze logic, which VICE's decode does not
  support for the Action Replay). The stock
  C64 KERNAL avoids $DE00 / $DF00 entirely. Software that needs to
  detect free RAM should treat $DE00-$DFFF as off-limits unless it
  has positively identified the cartridge (or absence thereof).

- **$D02F / $D030-$D03F are not always idle.** On a stock C64 these
  read $FF and writes are ignored. On a C128 in C64 mode (with the
  C128's VIC-IIe chip) $D02F is the extra-keyboard scan and $D030 is
  the test-bit / 2 MHz clock select. Writing $D030 on a C128
  drops the machine into 2 MHz mode and corrupt the display. Code that
  targets "the C64" should still treat $D030-$D03F as untouchable.

- **VIC-II $D019 acknowledge.** Writing $D019 acknowledges interrupts
  by writing a 1 to each source bit. Programs that do `LDA $D019 / STA
  $D019` to "ack all sources" rely on $D019 reading only
  meaningful bits and on the latch+ack pattern working. The shadow
  registers $D059, $D099, ..., $D3D9 work the same way, so a stray
  write that lands on one of these is a real acknowledgement.

- **Color RAM extra bytes ($DBE8-$DBFF).** These 24 bytes are RAM but
  are unused by any standard screen mode. Some games use them as
  free RAM for sprite multiplexers or scratch. Their contents survive
  any bank switch (the chip is separate and is not written through
  while I/O is out), but like the rest of colour RAM the CPU can only
  read or write them while I/O is mapped, and they are
  nibble-wide, so do not use them for byte storage.

- **SID write-only registers do not read back.** Code that wants to
  modify a single bit of, say, $D404 (voice 1 control) cannot
  `LDA $D404 / ORA #$01 / STA $D404`: the read returns the SID's
  last bus byte (see the SID registers section), not the register's
  contents, so the OR result is wrong. The usual idiom is to keep a
  shadow copy of every SID register in zero page or low RAM and to
  read/modify/write the shadow, then `STA $D404`. The same applies
  to every $D400-$D418 register. Player libraries (Hubbard's, Galway's,
  SoundMonitor, GoatTracker's player) all maintain shadow tables for
  this reason.

- **TOD clock latching ($DC08-$DC0B).** Reading $DC0B (hours) latches
  the entire TOD value into the read register so that minutes, seconds,
  and tenths can be read coherently. The latch is released by reading
  $DC08 (tenths). Reading hours and then never reading tenths leaves
  the clock frozen in the read register: the underlying counter keeps
  running, but later reads of seconds/minutes return the latched value
  until tenths is read. Code that reads only the hour freezes its own
  view of the time. The write side has the mirror rule (writing $DC0B
  stops the clock until $DC08 is written), and $DC0F
  bit 7 must be 0 for those writes to reach the clock rather than the
  alarm; `pitfalls/cia.md` → `tod_read_order_latch` carries both rules
  and the VICE measurement behind them.

- **$DD00 bits are inverted for VIC bank select.** Bits 0-1 of $DD00
  drive the high two address pins of the VIC-II, but they are
  inverted. `LDA #$00 / STA $DD00` (with DDR set appropriately) puts
  the VIC into bank 3 ($C000-$FFFF), not bank 0. The VIC needs
  `%11` in bits 0-1 for bank 0. The KERNAL's
  default leaves the VIC in bank 0 ($0000-$3FFF) by writing $07 to
  $DD00 (DDR = $3F).

- **Invalid display modes are black; $D016 bit 5 is inert.** Bit 5 of
  $D016 is the datasheet's RES bit and has no function on the 6567/6569
  (Bauer's VIC-II article, not measured on hardware here; in VICE x64sc
  it reads back as written and the display is unchanged with it set).
  The all-black screens are the three *invalid* mode combinations —
  ECM+BMM, ECM+MCM and ECM+BMM+MCM, i.e. $D011 bit 6 (ECM) and bit 5
  (BMM) together with $D016 bit 4 (MCM); see
  [Illegal display modes](vic-ii-reference.md#illegal-display-modes).
  Measured in VICE x64sc, each turns all 64,000 display-window pixels
  black while the border keeps its colour and sprites and
  sprite-foreground collisions ($D01F) still work. That is not the same
  as clearing DEN, which paints the whole frame in the border colour and
  stops badlines; and it has nothing to do with opening the side
  borders, which is the CSEL ($D016 bit 3) 1→0 write on cycle 56. Code
  that lands on one of these combinations during initialization looks
  crashed while the chip is drawing black. (An earlier version of
  this entry attributed the black modes to $D016 bit 5 and to "bits 4
  and 5 of $D011", called them equivalent to disabling the screen, and
  said demos used them to open the side borders; none of that is so.)

- **Reading $DC04 / $DC05 while Timer A is running IS racy.** An earlier
  version of this note claimed a "hidden read latch" made the two-byte
  read atomic; there is none. The 6526 latches only the TOD (a read of
  the hours freezes it, a read of the tenths releases it). Timer reads
  return the live counter, so a borrow out of the low byte between the
  two reads leaves the pair one page off (measured in VICE x64sc 3.10
  with the KERNAL's Timer A running: 5 of 100 back-to-back low/high
  pairs read 256 low, and a high byte read 1,297 cycles after a low-byte
  read had moved five pages, not zero). Read high, low, high and retry
  when the two high bytes differ, or stop the timer ($DC0E bit 0) around
  the read (the idioms in cia-reference.md). Writes are the other half:
  they go to the latch, and the counter takes the value only on
  underflow, on force-load ($DC0E bit 4), or on a high-byte write while
  the timer is stopped, so "set timer, then read back to confirm" on a
  running timer sees the old count.

## Sources

Primary:

- [C64-Wiki: Memory Map](https://www.c64-wiki.com/wiki/Memory_Map)
- [C64-Wiki: I/O area](https://www.c64-wiki.com/wiki/I/O_area)
- [Codebase64 reference](https://codebase64.org/doku.php?id=base:c64_memory_map)
- MOS Technology 6567/6569 (VIC-II) datasheet
- MOS Technology 6581 (SID) datasheet, and revision notes for 8580
- MOS Technology 6526 (CIA) datasheet
- C64 Programmer's Reference Guide (Commodore Business Machines, 1982),
  chapters on VIC-II, SID, and I/O
- *The MOS 6567 / 6569 video controller (VIC-II) and its application
  in the Commodore 64* — Christian Bauer, January 1996
  ([pagetable.com mirror](https://www.pagetable.com/?p=189))
- [pagetable.com c64ref](https://www.pagetable.com/c64ref/c64disasm/) —
  annotated KERNAL & memory-map disassembly

Cross-checked against the per-chip references in this repository,
which carry the bit-level register detail this index
omits:

- [vic-ii-reference.md](vic-ii-reference.md)
- [sid-reference.md](sid-reference.md)
- [cia-reference.md](cia-reference.md)
- [c64-memory-map.md](c64-memory-map.md)

<!-- doc-type: hardware-reference -->
