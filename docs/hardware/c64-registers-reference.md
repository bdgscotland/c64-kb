# C64 Registers Quick Reference

## Overview

This document is a single-page index of every memory-mapped I/O register
visible to the 6510 in the $D000-$DFFF window of a stock Commodore 64.
It exists so an agent (or a human) who knows only an address — "what
lives at $D012?" — can land on the right chip without first guessing
which datasheet to open.

It is intentionally **tabular only**. Each chip's registers are listed
in a name + address + R/W + one-line description grid. The full
per-register detail — bit layouts, side effects, timing notes, code
snippets — lives in the per-chip reference documents:

- [VIC-II reference](vic-ii-reference.md) — $D000-$D02F
- [SID reference](sid-reference.md) — $D400-$D41C
- [CIA reference](cia-reference.md) — $DC00-$DC0F (CIA1) and $DD00-$DD0F (CIA2)

**Why no register H3s in this file.** The graph extractor in
`src/graph/extract.ts` pulls one `Register` node per H3 of the form
`### $XXXX — NAME — Description (RW)`. Duplicating those H3s here and
in the per-chip docs would create double-counted nodes and ambiguous
ownership edges. The Phase-1 plan (Task 8) calls out this choice
explicitly: H3s live in the per-chip docs; this composite is purely an
index. The doc-type marker at the foot of the file tells the extractor
this is hardware-reference content so it is parsed and validated, but
since there are no register-shaped H3s in it, no `Register` nodes are
created from this file.

Wherever you see an unusual addressing range — the $D040-$D3FF VIC-II
mirror, the $D420-$D7FF SID mirror, the per-CIA $xx10-$xxFF mirrors —
this doc is also the single place that documents the **shadow regions**.
Those mirrors are real hardware behaviour, not aliases bolted on by
software. Touching them counts as touching the underlying register and
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
  address changes hidden state in the chip beyond the visible data byte —
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
| $D41D-$D41F   | SID "unused"     | 3 bytes    | Reads return $FF or floating bus on 6581 / last value on 8580 |
| $D420-$D7FF   | SID shadow       | 992 bytes  | $D400-$D41F mirror, repeats every $20 bytes                  |
| $D800-$DBFF   | Color RAM        | 1024 bytes | 4-bit-wide static RAM (nybble-wide)                          |
| $DC00-$DC0F   | CIA1             | 16 bytes   | Keyboard / joystick / IRQ source                             |
| $DC10-$DCFF   | CIA1 shadow      | 240 bytes  | $DC00-$DC0F mirror, repeats every $10 bytes                  |
| $DD00-$DD0F   | CIA2             | 16 bytes   | VIC bank / serial bus / user port / NMI source               |
| $DD10-$DDFF   | CIA2 shadow      | 240 bytes  | $DD00-$DD0F mirror, repeats every $10 bytes                  |
| $DE00-$DEFF   | I/O-1 expansion  | 256 bytes  | Cartridge I/O page 1 (open bus if no cart)                   |
| $DF00-$DFFF   | I/O-2 expansion  | 256 bytes  | Cartridge I/O page 2 (open bus if no cart)                   |

The window only appears at all because CHAREN (bit 2 of $01) and the
HIRAM/LORAM bits decide whether the area maps to character ROM, to RAM,
or to I/O. Almost every C64 program leaves it mapped to I/O; turning it
off is how you reach the underlying RAM at the same address.

The character ROM, when CHAREN = 0 with the I/O area enabled, occupies
$D000-$DFFF for the VIC-II only — it is not visible to the CPU even
when banked in via CHAREN, because CHAREN's effect is on the CPU view
and the chip view is independent. See
[c64-memory-map.md](c64-memory-map.md) for the full bank-switching
treatment.

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
chips (the VIC-IIe / 8564 / 8566 in the C128 puts the "extra keys" port
at $D02F-$D030 and the test bit at $D030; on a stock 64 those addresses
are dead).

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
relocatable loop) is correct hardware-level code, but it's rare. Most
of the time, an address outside $D000-$D02F is a bug — a missing zero
in the literal, a stale pointer, a `STA absolute,Y` whose Y register
walked past 47.

The 16x mirror is the same effect that lets the VIC-IIe revision
re-use those addresses for new functions without breaking software:
old software won't be writing $D030 on purpose, and if it does, it
already expected the write to be a no-op.

### VIC-II quick lookup by function

When you know the visual effect you want but not the register:

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
| Switch to 38-column mode (open side borders)                | $D016 bit 3 = 0           |
| Switch to 24-row mode (open top/bottom borders)             | $D011 bit 3 = 0           |
| Set border color                                            | $D020                     |
| Set background color (mode 0)                               | $D021                     |
| Point video matrix at screen RAM base                       | $D018 bits 4-7            |
| Point video matrix at character base                        | $D018 bits 1-3            |

## SID registers ($D400-$D41C)

The SID (MOS 6581 or its later 8580 successor) exposes 29 registers in a
32-byte page. The first 25 are write-only — reading them returns the
last value driven on the data bus by the previous instruction (the
"floating bus"), so you cannot recover state by reading them back.
The last 4 are read-only. For bit-level detail on each register, the
ADSR rate table, filter routing, and the well-known oddities (the
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

$D41D, $D41E, and $D41F are not decoded. On a 6581 they read as the
floating bus (last byte CPU fetched); on an 8580 they read $00. Writes
are discarded.

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
$D7E0+$18 = $D7F8 hits SIGVOL ($D418) — that means a stray store to a
"safe-looking" high address in the I/O range can pop the speaker just
as loudly as a direct write to $D418, and it can do so in code that
never mentions $D418 by name. See the [Pitfalls](#pitfalls) section
below.

Some commercial SID-cartridge add-ons (StereoSID, SID-Wizard 8-bit
DAC, etc.) decode a second SID at $D420 or $D500 or another base
inside this shadow window, gating the original SID's chip-select.
On stock hardware, however, the entire $D420-$D7FF range is one
chip — the same SID, mirrored.

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

Word-of-warning patterns:

- A common "fade out" routine writes $00..$0F to $D418 over time.
  But writing $D418 also reconfigures filter mode and voice-3 mute
  — so the standard idiom is to OR with the current $D418 value
  cached in zero page, not to write a raw nibble. Writing a raw
  nibble silently un-mutes voice 3 and switches the filter to "no
  filter" mode.
- The 8580 ear-test value for $D418 voice-3-mute differs from the
  6581 — the 8580 actually mutes when bit 7 is set, the 6581 has
  the same wiring but the analog mixer leaks. Tunes calibrated on
  one chip can sound different on the other.

## Color RAM ($D800-$DBFF)

Color RAM is a 1 KB block of static RAM dedicated to the per-character
foreground color. Unlike RAM elsewhere in the C64, it is **4 bits wide**:
each address stores only the low nibble (0-15). The high nibble reads
as undefined — on a 6510 read, the high nibble of the result is
typically the last byte that floated on the bus (i.e. `$D8nn`'s high
byte, $D8). Code that needs a byte-clean value should mask with
`AND #$0F`.

| Range         | Description                                                |
|---------------|------------------------------------------------------------|
| $D800-$DBE7   | Foreground color for each of the 1000 text cells (40 x 25). Byte n corresponds to character at $0400+n in the default screen RAM. |
| $D800-$DBFF   | Used as additional color storage by multicolor bitmap mode |
| $DBE8-$DBFF   | Unused by stock screen modes; on 4-bit chip, reads as undefined nibble high, low nibble is RAM |

Color RAM is always at $D800-$DBFF regardless of which VIC-II video
bank is selected by CIA2 $DD00 bits 0-1, because the VIC-II has a
dedicated wire to the color RAM that bypasses the normal address
multiplexer. The VIC-II reads the low nibble of color RAM in parallel
with each character matrix fetch — the chip pin is the same pin used
to provide the high 4 bits of the character matrix, and on display
fetch the color RAM's data is multiplexed on top.

Practical consequences:

- **Always writable.** Color RAM is RAM; writes always succeed.
- **High nibble undefined.** Reads of $D800+n only contain meaningful
  data in bits 0-3.
- **Not affected by I/O bank.** It sits where it sits; only CHAREN
  affects whether you see it instead of character ROM.
- **Power-on contents are random.** Most programs `LDA #col / STA $D800,X`
  in a loop before turning on the screen. If you switch into a screen mode
  before initializing color RAM, the visible glyphs will use whatever
  random nibble is in RAM as their foreground color.

For multicolor character mode, bit 3 of color RAM toggles per-cell
whether that character uses the multicolor palette ($D021/$D022/$D023
+ low 3 bits of color RAM) or the standard hi-res palette ($D021 +
color RAM low nibble). See [vic-ii-reference.md](vic-ii-reference.md)
multicolor text mode section.

## CIA1 registers ($DC00-$DC0F)

CIA1 is the 6526 Complex Interface Adapter wired to the keyboard
matrix, the two control-port joysticks, the paddles (multiplexed with
joystick port 1), and the system IRQ line. It is the source of the
60 Hz (NTSC) / 50 Hz (PAL) jiffy-clock IRQ that drives most KERNAL
timing.

For bit-level detail on each register — including the keyboard scan
matrix, the joystick bit-to-pin mapping, the TOD clock's BCD
encoding, and how the timer control bits interact — see
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
| Time-of-day clock  | $DC08, $DC09, $DC0A, $DC0B           |
| Serial port        | $DC0C                                |
| Interrupts         | $DC0D, $DC0E bit 7, $DC0F bit 7      |

The system jiffy IRQ comes from Timer A on CIA1, programmed by the
KERNAL at boot to fire 60 (NTSC) or about 50 (PAL) times per second
and to invoke the IRQ vector via $0314/$0315. Programs that want their
own raster IRQ usually disable CIA1's Timer A IRQ at $DC0D (and
re-enable VIC-II's raster IRQ at $D01A bit 0) so the only interrupt
source is the video chip.

### CIA1 quick lookup by function

| You want to ...                                  | Register(s)               |
|--------------------------------------------------|---------------------------|
| Scan the keyboard                                | $DC00 (drive col), $DC01 (read row), $DC02/$DC03 (DDR) |
| Read joystick port 2                             | $DC00 bits 0-4 (low = pressed) |
| Read joystick port 1                             | $DC01 bits 0-4 (low = pressed) |
| Read paddle button (fire)                        | $DC00 / $DC01 bit 4 (same wiring) |
| Switch which paddle pair is multiplexed in       | $DD00 bits 6-7            |
| Program Timer A as a one-shot                    | $DC04, $DC05, $DC0E bit 3 = 1 |
| Program Timer A as continuous                    | $DC04, $DC05, $DC0E bit 3 = 0 |
| Start Timer A                                    | $DC0E bit 0 = 1           |
| Enable Timer A underflow IRQ                     | $DC0D = $81               |
| Disable all CIA1 IRQs (e.g. for raster work)     | $DC0D = $7F (clear all)   |
| Acknowledge any pending CIA1 IRQ                 | Read $DC0D                |
| Read the TOD clock                               | Read $DC0B first (latches), then $DC0A, $DC09, $DC08 |
| Set the TOD clock                                | $DC0F bit 7 = 0 (bit 7 = 1 writes the ALARM), then write $DC0B, $DC0A, $DC09, $DC08 — the clock is stopped from the hours write until the tenths write |
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

The shadow has the same destructive properties as the real registers —
notably, **a read of $DCnD with the low nibble = D acknowledges and
clears all pending IRQ source bits**. A loop that walks `LDA $DC00,X`
across a wide range of X will, on every 16th byte, silently
acknowledge CIA1's IRQ register and lose any pending interrupt source
bits. Real C64 software memory-walks the I/O area for exactly this
reason: it is famously hostile to careless code.

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
| $DD0C   | DD0C | RW  | Serial shift register (RS-232 receive)                     |
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
| RS-232 receive             | $DD0C                                |
| NMI source                 | $DD0D                                |

Key wiring points (the per-pin table is in
[cia-reference.md](cia-reference.md)):

- **$DD00 bits 0-1** — VIC-II bank select. Inverted: `00 = $C000-$FFFF`,
  `01 = $8000-$BFFF`, `10 = $4000-$7FFF`, `11 = $0000-$3FFF` (default
  after RESET).
- **$DD00 bits 2-5** — IEC serial bus (ATN out, clock out/in, data
  out/in).
- **$DD0D** — write 1 to bit 7 + bit n to enable NMI source n; read
  clears all source bits. The RESTORE key is **not** one of those
  sources: it reaches the 6510 /NMI pin in parallel with CIA2's /IRQ
  output, through its own monostable (the wiring is rung 4 here — the
  schematic as the C64-Wiki describes it, not measured; the KERNAL's
  side that follows is from the ROM bytes), and no value in $DD0D
  affects it. The KERNAL's NMI handler treats "NMI with no CIA2 flag set" as a
  RESTORE press and, with RUN/STOP also held, warm-starts BASIC — which
  is why RESTORE is "almost a reset". (This entry used to say RESTORE
  was wired to /FLAG and arrived through bit 4; it is not, and the
  `$DD0D = $10` the lookup below recommended did nothing. See
  `pitfalls/kernal-and-io.md` → `restore_nmi_not_maskable`.)

### CIA2 quick lookup by function

| You want to ...                                  | Register(s)               |
|--------------------------------------------------|---------------------------|
| Switch VIC-II to bank N (0-3)                    | $DD00 bits 0-1 = NOT N    |
| Drive the IEC serial bus (1541 etc.)             | $DD00 bits 3,4,5 (ATN, CLK, DATA out) |
| Read IEC serial bus status                       | $DD00 bits 6,7 + $DD01 (user-port-routed) |
| Set up an RS-232 receive                         | $DD0C, $DD04, $DD05, $DD0E |
| Use Timer A for music IRQ via NMI                | $DD04, $DD05, $DD0E, $DD0D bit 0 |
| Disable the RESTORE key NMI                      | Not possible via $DD0D. Point $0318 at an RTI, or hold an unacknowledged CIA2 NMI — pitfall `restore_nmi_not_maskable` |
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
pending NMI source bits. Most of the time NMIs are not enabled and
the shadow does no harm, but if a program is using a CIA2 timer NMI
(common for fast loaders and SoundMonitor-style audio) the same hazard
applies.

## I/O expansion ($DE00-$DFFF)

These two 256-byte pages are reserved for cartridges. They are wired
to the expansion-port pins /IO1 and /IO2, which a cartridge can use to
decode its own registers.

| Range         | Pin   | Notes                                                                   |
|---------------|-------|-------------------------------------------------------------------------|
| $DE00-$DEFF   | /IO1  | Cartridge I/O page 1. No internal devices.                              |
| $DF00-$DFFF   | /IO2  | Cartridge I/O page 2. No internal devices.                              |

Behaviour with no cartridge present:

- Reads return open bus (typically the last byte CPU drove on the
  bus, i.e. the high byte of the address — $DE for $DEnn, $DF for
  $DFnn — but this is implementation-defined and varies between
  hardware revisions).
- Writes are discarded.

Behaviour with a cartridge present is entirely cartridge-defined.
Common conventions:

| Cartridge family          | $DE00 use                                                    | $DF00 use                                          |
|---------------------------|--------------------------------------------------------------|----------------------------------------------------|
| Action Replay / Final Cartridge / Retro Replay | Control register: write controls ROM bank, mode select, freeze release | RAM mirror or alt control                          |
| EasyFlash                 | Bank select / mode register at $DE00 / $DE02                 | EasyFlash LED + I/O                                 |
| Magic Desk                | $DE00 bit-mapped bank select (8x8 KB)                        | Unused                                              |
| KCS Power Cartridge       | $DF00 control                                                | $DF00 control                                       |
| GeoRAM / NeoRAM           | $DE00 window into a 256-byte RAM page; $DFFE/$DFFF select page | Page register                                      |
| Reu (1700/1750/1764)      | $DF00-$DF0A: full REC register set (status, command, base, target, length) | (same)                                  |
| MMC64 / MMC Replay        | $DF10-$DF13: SD card SPI port                                |                                                     |

Software written to be cartridge-agnostic must avoid touching $DE00-$DFFF
unless it knows what cartridge is plugged in. A spurious write here can
freeze the machine (Action Replay freeze trigger), swap RAM banks
underneath the running program (EasyFlash), or — for fast loaders that
use a REU detection routine — silently mis-detect and lose data.

## Address-to-chip dispatch table

This is the inverse table to the per-chip lists above: given any
address in $D000-$DFFF, find the chip and the effective canonical
register it resolves to. The intent is that an agent can land here
from an arbitrary literal seen in disassembly and figure out what
the program is touching.

| If address is in ...   | The chip is ...    | The effective register is ...                                                              |
|------------------------|--------------------|--------------------------------------------------------------------------------------------|
| $D000-$D02F            | VIC-II             | The literal address.                                                                       |
| $D030-$D03F            | VIC-II ("unused")  | Reads $FF, writes ignored. Do not write — VIC-IIe uses these.                              |
| $D040-$D3FF            | VIC-II shadow      | `((addr - $D000) AND $3F) + $D000`. Watch for $D019 (IRQ ack) and $D01E/$D01F (clear-on-read). |
| $D400-$D41C            | SID                | The literal address.                                                                       |
| $D41D-$D41F            | SID ("unused")     | Reads floating bus (6581) or $00 (8580); writes discarded.                                 |
| $D420-$D7FF            | SID shadow         | `((addr - $D400) AND $1F) + $D400`. Watch for $D418 (master vol pop) and writeable-only registers — the floating bus means reads do not work. |
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
not all power-up in a defined state — the per-chip docs list which
bits are guaranteed and which are floating.

Highlights of the KERNAL-set state (cold boot, NTSC):

| Address | Value      | What it means                                            |
|---------|------------|----------------------------------------------------------|
| $D011   | $1B        | RSEL=1 (25 rows), DEN=1 (display enable), YSCROLL=3, BMM/ECM=0 |
| $D016   | $C8        | CSEL=1 (40 cols), MCM=0, XSCROLL=0; high bits set        |
| $D018   | $14        | Video matrix at $0400, character base at $1000 (= char ROM) |
| $D019   | $0F        | All interrupt latches cleared (write-1-to-ack)           |
| $D01A   | $00        | All VIC-II IRQ sources disabled                          |
| $D020   | $0E        | Border color = light blue                                |
| $D021   | $06        | Background color = blue                                  |
| $D400-$D418 | $00    | SID all silent, volume = 0                               |
| $DC00   | $7F        | Column 7 driven low, the rest high — pre-selects the RUN/STOP column so the NMI handler's STOP sample at $F6BC can see the key (IOINIT's store at $FDAB; this row used to say "all columns high") |
| $DC0D   | $81        | Timer A IRQ enabled (the jiffy clock)                    |
| $DC0E   | $11        | Timer A running, continuous mode                         |
| $DD00   | $07 (low bits) | VIC bank 0 selected ($0000-$3FFF), serial bus idle    |
| $DD0D   | $00        | All NMI sources masked (RESTORE needs none — it drives /NMI directly) |

A "soft reset" via RUN/STOP+RESTORE or the NMI vector does not reset
every register — the SID retains its state, the VIC-II keeps the
current display mode, and color RAM is untouched. That is why some
programs survive a RESTORE press visually intact but with broken
sound.

## Pitfalls

- **Shadow-register confusion.** A "wrong" address that happens to fall
  inside the I/O area very often does the same thing as the matching
  base address, not nothing. Writing $D420 is writing $D400 (FRELO1);
  writing $D7F8 is writing $D418 (SIGVOL — speaker pop); writing $D052
  is writing $D012 (raster compare — your raster IRQ moves). A null
  pointer plus a small offset can hit live hardware. See the per-chip
  shadow sections above for the exact modulo rules.

- **$D7FF SID side-effects.** The very last byte of the SID shadow
  region, $D7FF, mirrors $D41F, which is technically unused on a stock
  SID. But $D7F8 mirrors $D418, $D7E5 mirrors $D405, $D7E0 mirrors
  $D400. A program that uses $D700-$D7FF as scratchpad RAM because
  "those addresses look free" is in fact writing every single SID
  register on every store. This is one of the more common causes of
  random clicks, mysterious sustained tones after a tune ends, and
  paddle-readback corruption.

- **Color RAM high nibble is garbage.** `LDA $D800` returns
  `$??0..F` where the `?` nibble is open bus, typically $D8 (the high
  byte of the address). Always mask with `AND #$0F` before comparing.

- **$DC0D / $DD0D destructive read.** Reading the interrupt control
  register of either CIA acknowledges and clears every pending source
  bit. Code that wants to inspect IRQ state without losing pending
  interrupts has to mask interrupts (SEI), latch the read, and then
  re-enable. The same hazard applies to every shadow address ending
  in $D inside CIA1 or CIA2 — there are 16 such addresses per CIA in
  the $xx00-$xxFF page.

- **$DE00 / $DF00 cartridge clobbering.** A naive memory test or RAM
  copy that walks $D000-$DFFF will, on a machine with an Action
  Replay or Final Cartridge plugged in, trigger the cartridge's
  freeze logic or swap its RAM banks under the program. The standard
  C64 KERNAL avoids $DE00 / $DF00 entirely. Software that needs to
  detect free RAM should treat $DE00-$DFFF as off-limits unless it
  has positively identified the cartridge (or absence thereof).

- **$D02F / $D030-$D03F are not always idle.** On a stock C64 these
  read $FF and writes are ignored. On a C128 in C64 mode (with the
  C128's VIC-IIe chip) $D02F is the extra-keyboard scan and $D030 is
  the test-bit / 2 MHz clock select. Writing $D030 on a C128 will
  drop the machine into 2 MHz mode and corrupt the display. Code that
  targets "the C64" should still treat $D030-$D03F as untouchable.

- **VIC-II $D019 acknowledge.** Writing $D019 acknowledges interrupts
  by writing a 1 to each source bit. Programs that do `LDA $D019 / STA
  $D019` to "ack all sources" rely on the fact that $D019 reads only
  meaningful bits and the latch+ack pattern works. The shadow
  registers $D059, $D099, ..., $D3D9 work the same way — but again,
  a stray write that happens to land on one of these is a real
  acknowledgement.

- **Color RAM extra bytes ($DBE8-$DBFF).** These 24 bytes are RAM but
  are unused by any standard screen mode. Some games use them as
  free RAM for sprite multiplexers or scratch. They survive any I/O
  bank switch because color RAM is wired directly, not via CHAREN —
  but they are still nibble-wide, so do not use them for byte storage.

- **SID write-only registers do not read back.** Code that wants to
  modify a single bit of, say, $D404 (voice 1 control) cannot
  `LDA $D404 / ORA #$01 / STA $D404` — the read returns floating
  bus, so the OR result is random. The standard idiom is to keep a
  shadow copy of every SID register in zero page or low RAM and to
  read/modify/write the shadow, then `STA $D404`. The same applies
  to every $D400-$D418 register. Player libraries (Hubbard's, Galway's,
  SoundMonitor, GoatTracker's player) all maintain shadow tables for
  this reason.

- **TOD clock latching ($DC08-$DC0B).** Reading $DC0B (hours) latches
  the entire TOD value into the read register so that minutes, seconds,
  and tenths can be read coherently. The latch is released by reading
  $DC08 (tenths). Reading hours and then never reading tenths leaves
  the clock frozen in the read register — although the underlying
  counter keeps running, subsequent reads of seconds/minutes return
  the latched value until tenths is read. Code that "peeks" at the
  hour without intending to read the rest of the clock will silently
  freeze its own view of the time. The write side has the mirror rule
  — writing $DC0B stops the clock until $DC08 is written — and $DC0F
  bit 7 must be 0 for those writes to reach the clock rather than the
  alarm; `pitfalls/cia.md` → `tod_read_order_latch` carries both rules
  and the VICE measurement behind them.

- **$DD00 bits are inverted for VIC bank select.** Bits 0-1 of $DD00
  drive the high two address pins of the VIC-II, but they are
  inverted. `STA #$00 / STA $DD00` (with DDR set appropriately) puts
  the VIC into bank 3 ($C000-$FFFF), not bank 0. To put the VIC into
  bank 0 you must write `%11` to bits 0-1. Confusingly, the KERNAL's
  default leaves the VIC in bank 0 ($0000-$3FFF) by writing $07 to
  $DD00 (DDR = $3F).

- **$D016 lock bit 5.** Bit 5 of $D016 is documented in the data sheet
  as "reset" but acts as an undocumented mode that, combined with bits
  4 and 5 of $D011 in the "illegal" combinations, produces all-black
  screen modes used in demos to open the side borders. Setting these
  combinations is harmless — but it is also functionally equivalent to
  "disable the screen". Code that accidentally lands on one of these
  combinations during initialization will appear to have crashed when
  in fact the chip is just drawing background.

- **Reading $DC04 / $DC05 etc. while Timer A is running** does not
  introduce hazard, because the 6526 provides a hidden read latch.
  But writing them does affect the running counter — a write goes
  to the latch and only loads the counter on the next underflow
  (or immediately, if you use the force-load bit). The hazard is
  in old code that does "set timer, then read back to confirm" and
  sees a different value than it wrote.

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
which carry the bit-level register detail this index intentionally
omits:

- [vic-ii-reference.md](vic-ii-reference.md)
- [sid-reference.md](sid-reference.md)
- [cia-reference.md](cia-reference.md)
- [c64-memory-map.md](c64-memory-map.md)

<!-- doc-type: hardware-reference -->
