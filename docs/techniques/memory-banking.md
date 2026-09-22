---
category: banking
chip: 6510
---

<!-- doc-type: technique-reference -->

# Memory Banking Techniques

The Commodore 64 is a machine built on layered illusions. Its 6510 CPU sees a flat
16-bit address space, but that 64 KB window simultaneously looks onto 64 KB of
dynamic RAM, 8 KB of BASIC ROM, 8 KB of KERNAL ROM, 4 KB of character generator
ROM, the VIC-II register set, the SID, two CIA chips, and a slab of Color RAM.
None of those components occupy distinct address ranges — they all occupy the same
ranges, bank-switched in and out by hardware. The programmer's job is to control
which physical device answers a given address at any given moment, and to keep
the VIC-II's separate 16 KB view coherent with whatever CPU-visible layout has
been selected.

Banking on the C64 is not a special mode you enable for advanced work. It is the
default state of the machine from the first instruction after reset. Every write to
$D011 silently depends on the I/O chip being visible at $D000. Every IRQ relies on
KERNAL ROM or a RAM replacement being readable at $FFFA-$FFFF. Understanding the
banking system is a prerequisite for any serious C64 development.

This document covers the CPU I/O port that selects which ROMs are visible, the
CIA2 register that defines VIC's 16 KB working window, the relationship between
VIC banking and character ROM visibility, $D018's role in positioning screen RAM
and bitmaps within the VIC bank, the EasyFlash cartridge's per-bank mechanism,
and the technique of hiding working data under KERNAL ROM.

---

## cpu_io_port_bank — $00/$01 port banking

**Complexity:** medium
**Region:** both

### Why

Every C64 program eventually outgrows the default memory layout. BASIC ROM at
$A000-$BFFF eats 8 KB that could hold graphics data, music, or game code.
KERNAL ROM at $E000-$FFFF eats another 8 KB. If a program needs to address the
character ROM to copy its bitmap patterns into RAM, the I/O chips must be
temporarily replaced by the character ROM window. The CPU I/O port is the
single switch that controls all of this.

### How

The 6510 CPU has six on-chip general-purpose I/O pins that are accessible
through two memory locations that exist below the normal RAM map:

- **$0000 — Data Direction Register (DDR).** Each bit set to 1 makes the
  corresponding $0001 bit an output; each bit set to 0 makes it an input.
  The DDR must be configured before writing $0001 has any effect on output pins.
  The KERNAL sets the DDR to $2F at reset (bits 0-3 and 5 are outputs; bit 4,
  the cassette sense line, is an input).

- **$0001 — Data register.** Bits 0-2 are the three banking control lines.
  Writing a new value here changes which ROMs the PLA presents to the CPU.

The three relevant bits are:

| Bit | Name   | 0 means                  | 1 means                              |
|-----|--------|--------------------------|--------------------------------------|
| 0   | LORAM  | $A000-$BFFF is RAM       | $A000-$BFFF can be BASIC ROM         |
| 1   | HIRAM  | $E000-$FFFF is RAM       | $E000-$FFFF can be KERNAL ROM        |
| 2   | CHAREN | $D000-$DFFF is char ROM  | $D000-$DFFF is I/O (VIC/SID/CIA)    |

BASIC ROM appears only when both LORAM and HIRAM are 1. KERNAL ROM appears
when HIRAM is 1 (regardless of LORAM). Character ROM appears at $D000-$DFFF
when CHAREN is 0 and at least one of LORAM or HIRAM is 1.

The commonly-used configurations are:

| $01 value | Name                          | $A000-$BFFF | $D000-$DFFF | $E000-$FFFF |
|-----------|-------------------------------|-------------|-------------|-------------|
| $37 (55)  | Default (BASIC + KERNAL + I/O)| BASIC ROM   | I/O         | KERNAL ROM  |
| $36 (54)  | KERNAL + I/O (no BASIC)       | RAM         | I/O         | KERNAL ROM  |
| $35 (53)  | I/O only (no ROM)             | RAM         | I/O         | RAM         |
| $34 (52)  | All RAM (no ROM, no I/O)      | RAM         | RAM         | RAM         |
| $33 (51)  | BASIC + KERNAL + char ROM     | BASIC ROM   | Char ROM    | KERNAL ROM  |

Mode $35 is the most common alternative to the default for demos and games: all
ROM is banked out, I/O remains accessible at $D000-$DFFF so the program can still
talk to VIC-II, SID, and CIA. Mode $34 replaces I/O with RAM as well, giving a
flat 64 KB of RAM at the cost of losing direct register access.

Mode $33 is used when a program needs to read the built-in character ROM at
$D000-$DFFF — for example to copy the ROM font into a custom RAM location for
modification.

### Why it works

The PLA chip (906114) sits between the CPU's address and data buses and all the
peripheral devices. It monitors the three processor-port bits from the 6510 along
with the GAME and EXROM lines from the cartridge port. For any given combination
of those five inputs it asserts or deasserts the chip-select lines for each ROM
and the I/O devices. The RAM is always physically present; the PLA merely disables
the RAM's CAS line in a specific address range when it wants a ROM or I/O device
to win that range on reads. Writes to a ROM-mapped range always go to the
underlying RAM — the PLA routes a write cycle at $A000-$BFFF or $E000-$FFFF to
RAM whatever $01 says, and the same holds for $D000-$DFFF while character ROM is
mapped there (CHAREN = 0 with LORAM or HIRAM set). It is NOT true of $D000-$DFFF
while I/O is mapped ($35/$36/$37): there the write goes to the VIC/SID/CIA/colour-RAM
register and the RAM beneath is untouched (measured in VICE x64sc: RAM under $D000
seeded $1D in mode $34; $2D written to $D000 with $01 = $37 read back as $2D — the
sprite-0 X register — and the RAM under it still read $1D once I/O was banked out;
the same test with $E000 put the byte in RAM). An earlier version of this page
said writes go to RAM in every banking state. So you can write code or data into
$E000-$FFFF even while KERNAL ROM is banked in — the bytes land in RAM and become
visible once KERNAL is banked out; to put data under I/O, bank it out first ($34,
or $33 if char ROM is acceptable) with interrupts disabled.

### Variations

**Mode $35 with custom IRQ vectors.** When HIRAM goes to 0, the CPU's hardware
IRQ vector at $FFFE/$FFFF and NMI vector at $FFFA/$FFFB are no longer in ROM —
they read from RAM. Before switching to $35, disable interrupts with SEI, write
your IRQ and NMI handler addresses to the RAM at $FFFE/$FFFB (these are in the
underlying RAM even while KERNAL ROM covers them — just write directly), then
write $35 to $01 and re-enable with CLI. The KERNAL-provided interrupt chain at
$EA31 is gone; the program owns all interrupts.

**Temporarily banking in char ROM.** To copy the ROM font to a custom location:
disable IRQs (SEI), write $33 to $01 to swap char ROM into $D000-$DFFF, perform
the copy loop, then write $37 back to restore normal layout, then CLI. The copy
must be complete before re-enabling the I/O chips.

**Preserving bits 3-5.** Bits 3 and 5 of $01 are datasette outputs — bit 3 the
write line, bit 5 the motor (0 = motor ON) — and bit 4 is the tape-button sense
input (DDR $2F leaves it an input, so writes to it do nothing). The constants
above ($33-$37) all keep bit 5 set, so writing them directly does not start the
motor; a value with bit 5 clear does — `LDA #$05 / STA $01` banks out the ROMs
and switches the motor on, and under mode $35 nothing turns it off again, because
the interlock that does so ($EA61) is part of the KERNAL IRQ you have just
removed. Prefer read-modify-write when changing only the banking bits so that
bits 3 and 5 are left as the tape code set them: read $01, AND #$F8, OR in the
new banking value, write back. (An earlier version of this paragraph called bit 4
an output that controls the datasette; it is the switch-sense input, as the DDR
note above says.)

### Cycle budget

Banking switches take effect on the very next bus cycle after the write to $01
completes. There is no pipeline delay or setup time. The PLA combinatorially
decodes the processor-port lines on every cycle, so a STA $01 is followed
immediately by the new memory layout being visible on the next instruction fetch.

### Recipes

No Phase 3 recipes target this technique directly. Banking is a supporting
infrastructure technique — recipes for specific effects (stable IRQ, raster bars,
custom charsets) use mode $35 or $37 as their starting point. Recipes land in
Phase 4+.

---

## vic_bank_select — CIA2 VIC bank select

**Complexity:** low
**Region:** both
**Uses registers:** DD00

### Why

The VIC-II chip has a 14-bit internal address bus: it can independently access
any of 16,384 bytes (16 KB) of the C64's RAM. But the C64 has 64 KB of RAM.
To allow VIC to reach graphics data anywhere in the address space, CIA2 port A
bits 0-1 act as a two-bit extension that shifts VIC's 16 KB window to one of
four positions. Choosing the right VIC bank is the first decision in any
memory layout — everything else (screen RAM position, char set or bitmap position,
sprite data, sprite pointer table) is relative to whichever 16 KB bank VIC sees.

### How

CIA2 port A, the register at $DD00, multiplexes the VIC bank selection onto its
lowest two bits alongside the IEC serial bus and RS-232 lines:

| $DD00 bits 1-0 | VIC bank | Address range in CPU view |
|----------------|----------|---------------------------|
| 11             | 0        | $0000-$3FFF               |
| 10             | 1        | $4000-$7FFF               |
| 01             | 2        | $8000-$BFFF               |
| 00             | 3        | $C000-$FFFF               |

After reset the KERNAL sets $DD02 (CIA2 port A DDR) to $3F (bits 0-5 are
outputs). Bits 0-1 of $DD00 reset to 11, placing VIC in bank 0 — which is why
the default screen at $0400 is visible to VIC without any setup.

To change the bank, always read-modify-write $DD00: read the current value, mask
off bits 0-1 with AND #$FC, then OR in the desired two-bit bank code, then write
back. This preserves the IEC bus state and prevents glitches on the serial port.

### Why it works

Between CIA2 port A pins PA0-PA1 and the VIC-II's address-bus extension inputs
VA14-VA15 there is a pair of inverting buffers on the C64 motherboard. The two
bit-patterns are therefore inverted with respect to each other: when CIA2 drives
both pins high (the all-ones reset state), the VIC receives low on VA14-VA15,
which it interprets as bank 0. The counter-intuitive mapping — that bit pattern
11 means bank 0 — comes from this inversion. The design choice is pragmatic:
TTL open-collector bus lines default to a pulled-high state, so the safe reset
state (everything high) naturally delivers VIC bank 0 and screen RAM at $0400
without any software configuration.

After changing $DD00, the new bank address extension takes effect immediately on
the next VIC fetch cycle. If the raster is currently rendering and VIC is
mid-fetch, the visible result will change partway through the current line.
Production code always makes bank changes during the vertical blank or in a
raster interrupt timed to occur in the overscan region.

### Variations

**Banks 1 and 3 for full custom layouts.** VIC banks 1 ($4000-$7FFF) and 3
($C000-$FFFF) contain no char ROM shadow; the VIC sees only RAM there. This is
the preferred layout for demos that use fully custom graphics and want maximum
clarity: all graphics live in one 16 KB bank, the CPU never accidentally reads
char ROM data, and the mapping is unambiguous.

**Multi-bank sprite tricks.** Sprite data must be addressable within VIC's current
bank, but the CPU can freely write into any bank's RAM while VIC sees only its
own bank. Double-buffering sprite data in the off-bank (writing to the other
16 KB while VIC reads this 16 KB) is a clean way to animate sprites without
tearing, by flipping $DD00 once per frame rather than per-sprite.

### Cycle budget

No critical cycle constraints. The $DD00 write is a single STA instruction;
the bank switch is instantaneous from VIC's perspective on the next cycle.

### Recipes

No Phase 3 recipes. VIC bank selection is a layout prerequisite used by all
graphics recipes. Recipes land in Phase 4+.

---

## char_rom_under_vic — Map char ROM into VIC's bank

**Complexity:** medium
**Region:** both
**Uses registers:** DD00, D018

### Why

The C64 ships with a 4 KB character generator ROM containing the default
uppercase/graphics and lower-case/uppercase font data. Most programs need a
custom font, custom symbols, or a modified character set at some point. Before
any custom character data can be used, the developer must either place their
custom data at the address VIC expects to find characters, or understand how
the ROM characters are shadowed into VIC banks 0 and 2 so that the default
font remains available without consuming RAM.

### How

The character ROM resides at $D000-$DFFF from the CPU's perspective (when CHAREN
is 0 and at least LORAM or HIRAM is 1). But VIC-II does not share the CPU's
address space — VIC has its own 16 KB window determined by $DD00. The character
ROM hardware includes a second set of decode logic that makes it appear inside
VIC banks 0 and 2 at specific offsets:

| VIC bank | CPU range     | Char ROM visible to VIC at | VIC-relative address |
|----------|---------------|---------------------------|----------------------|
| 0        | $0000-$3FFF   | Yes                       | $1000-$1FFF (CPU $1000-$1FFF) |
| 1        | $4000-$7FFF   | No — VIC sees RAM only    | n/a                  |
| 2        | $8000-$BFFF   | Yes                       | $1000-$1FFF (CPU $9000-$9FFF) |
| 3        | $C000-$FFFF   | No — VIC sees RAM only    | n/a                  |

In VIC bank 0, addresses $1000-$1FFF in VIC's view return char ROM data even
though those CPU addresses ($1000-$1FFF) contain normal RAM. The KERNAL defaults
take advantage of this: the default $D018 value of $14 points the character
generator base to $1000 within bank 0, which silently reads the char ROM without
occupying any RAM.

To place a custom character set at a specific address, choose a VIC bank and
pick a character base address that does not conflict with the char ROM shadow.
Common choices:

- Bank 0, char base at $2000 (VIC-relative): no char ROM interference.
  CPU loads the charset into RAM at $2000-$27FF.
  $D018 CB field = %100 (= 4), giving $D018 = $18 for VM at $0400 + CB at $2000.
  (An earlier version said $14; $14 is CB = %010 = $1000, the char ROM shadow,
  i.e. the KERNAL default.)

- Bank 1 (any address): no char ROM shadow in bank 1 at all.
  CPU loads the charset anywhere in $4000-$7FFF.

- Bank 2, char base at VIC-relative $0000 (CPU $8000), $D018 CB field = %000:
  clear of the char ROM shadow, which in bank 2 sits at VIC-relative $1000-$1FFF
  (CPU $9000-$9FFF). CPU loads the charset into RAM at $8000-$87FF. (An earlier
  version of this bullet and of the table above put CPU addresses in the
  VIC-relative slots for bank 2; VIC-relative addresses only run $0000-$3FFF.
  Measured in VICE x64sc: bank 2, CB=0 reads CPU $8000; bank 2, CB=2 reads char
  ROM although CPU $9000 RAM is zero.)

### Why it works

Inside the C64 motherboard, the character ROM's chip-select line responds not
only to the CPU-side address decoder but also to a separate signal derived from
VIC's address bus via the same PLA. When VIC is in bank 0 or bank 2, and VIC
generates an internal address in the $1000-$1FFF window — CPU $1000-$1FFF in
bank 0, CPU $9000-$9FFF in bank 2 — the PLA asserts char ROM's chip-select instead of RAM's CAS
line. The CPU never knows this is happening — from the CPU's side those are
ordinary RAM locations whose content is readable and writable. The char ROM
shadow is VIC-only hardware behavior, not a side-effect of CPU banking.

### Variations

**Dual-charset switching.** Because custom charsets live in RAM and the char
ROM shadow is a hardware overlay, a program can maintain two charsets in RAM
at different $D018 CB offsets and switch fonts by writing $D018 on a per-raster-
line basis in an IRQ. The VIC applies the new $D018 value from the next character
fetch onward, enabling per-line font changes.

**Charset placement at $3800 in bank 0.** Advanced demos sometimes place a
charset near the end of bank 0 ($3800-$3FFF is 2 KB). This allows sprite pointers
and the sprite pool to coexist in the same 16 KB bank with no gaps.

**Copying the ROM font.** To modify the built-in font, copy it first: disable
IRQs, set $01 to $33 (char ROM in $D000-$DFFF), copy 2 KB from $D000-$D7FF
into target RAM, restore $01 to $37. Then point $D018 at the RAM copy.

### Cycle budget

No cycle budget for the bank configuration itself. If $D018 is changed inside a
raster IRQ, the timing of where the new char base takes effect matters — see the
raster techniques doc.

### Recipes

No Phase 3 recipes. Custom-charset setup is infrastructure shared by many
techniques and will be demonstrated in Phase 4+ recipe docs.

---

## screen_ram_relocation — Move screen RAM via $D018 hi-nibble

**Complexity:** low
**Region:** both
**Uses registers:** D018

### Why

The default screen RAM at $0400-$07E7 (1000 bytes for 40×25 characters) sits
inside VIC bank 0 but is also in the middle of the general-purpose RAM range.
Programs that want to use $0400-$07FF for code, sprite data, or other graphics
must relocate screen RAM. The mechanism is in $D018: the upper nibble (bits 4-7)
selects any 1 KB boundary inside the current VIC bank as the new screen RAM base.

### How

Bits 7-4 of $D018 (the VM field) hold a 4-bit value that selects the screen RAM
offset within the 16 KB VIC bank:

```
screen_ram_address_in_vic_bank = VM_bits * $0400
```

With VM_bits ranging from 0 to 15, the 16 possible positions are:

| VM bits (7-4) | Offset in VIC bank | CPU address in bank 0 |
|---------------|--------------------|-----------------------|
| 0000          | $0000              | $0000                 |
| 0001          | $0400              | $0400 (default)       |
| 0010          | $0800              | $0800                 |
| 0011          | $0C00              | $0C00                 |
| ...           | ...                | ...                   |
| 1111          | $3C00              | $3C00                 |

The default KERNAL value of $D018 is $14 (binary 0001 0100), giving VM = %0001
= 1, which places screen RAM at offset $0400 within bank 0, i.e. CPU address
$0400. This is the "READY." screen you see at boot. ($14 is the value the KERNAL
writes; the register reads back as $15 because bit 0 is unused and reads 1 —
measured in VICE x64sc.)

Sprite pointers always follow the screen RAM: the 8 bytes at screen_base + $3F8
(screen_base + 1016) hold the sprite data-block pointers. When screen RAM moves,
sprite pointers move with it automatically — they are at a fixed offset from the
screen base, not at a fixed CPU address.

To move screen RAM, write a new value to $D018 keeping the CB bits unchanged:
read the register, mask bits 3-0 to preserve the char base, OR in the new VM
nibble shifted to bits 7-4, write back.

If KERNAL is still active (mode $37), the KERNAL's shadow of screen RAM location
at $0288 (HIBASE) should be updated to reflect the new screen RAM page. KERNAL
routines including CHROUT use $0288 to find the screen; if it is stale, KERNAL
output will write to the old location.

### Why it works

The VIC-II uses the VM bits to generate the high bits of its 14-bit address bus
during the video matrix fetch phase. During cycles 15-54 of each badline the VIC
fetches the 40 bytes for that character row from video_matrix_base + row*40 +
column into an internal latch, and reuses the latch for the row's remaining
seven lines; sprite pointers at video_matrix_base + $3F8 are fetched once per
raster line. (An earlier version said one byte was fetched on each character
clock of the visible area, which is not how the video matrix is read.)
Only the upper bits of that address come from VM; the lower 10 bits are the
running character clock counter. The effect is that moving VM simply shifts the
entire screen fetch window by multiples of 1 KB within the VIC bank — a pure
hardware address-offset operation with no software overhead per character.

### Variations

**Screen at $3C00.** Placing screen RAM at the top of VIC bank 0 ($3C00-$3FE7,
the 1 KB block running to $3FFF; an earlier version said $3FEF, which is 1008 bytes)
frees the lower 15 KB for code and graphics. The 8 bytes of sprite pointers at
$3FF8-$3FFF are conveniently at the very top of the bank. This is a common
layout for demos that use a full custom layout in bank 0.

**Double-buffered screen RAM.** (Worked through, with the sprite pointer
mirror and a measured recipe, as `screen_double_buffer_d018` below.) Two
screen buffers can live at different VM
offsets (e.g., $0000 and $0400 within the bank). The visible buffer flips by
changing VM bits; the invisible buffer is updated by the CPU. This avoids all
screen-tearing artifacts on text-mode displays; the flip lands at the next
badline, so write $D018 during the border or vertical blank for a whole-frame
swap.

### Cycle budget

A VM change is not seen until the next badline: the VIC fetches the 40
video-matrix bytes only during cycles 15-54 of a badline and reuses that latch
for the remaining seven lines of the character row, so a $D018 write mid-row
leaves the current row on the old base and moves the display from the next row
down (measured in VICE x64sc: written on line 54, effective from line 59).
Sprite pointers are the exception — they are fetched every line and follow the
new base from the next line. There is no cycle overhead beyond the write. (An
earlier version said the write took effect at the next video matrix fetch, which
read as "immediately".)

### Recipes

No Phase 3 recipes. This technique is infrastructure used by other Phase 4+
recipe docs.

---

## bitmap_relocation — Move bitmap base via $D018 lo-nibble

**Complexity:** low
**Region:** both
**Uses registers:** D018

### Why

Standard C64 bitmap modes (hires and multicolor) require an 8 KB block of RAM
holding the pixel data. With the VIC bank being only 16 KB wide, there are only
two valid positions for the bitmap within the bank. Programs need to know which
positions are available and how to select between them.

### How

In bitmap mode, bits 3-1 of $D018 (the CB field) serve a reduced role: only bit 3
(CB2, the high bit of the three-bit CB field) is meaningful. It selects between
two possible bitmap base addresses within the VIC bank:

| $D018 bit 3 | Bitmap base offset in VIC bank |
|-------------|-------------------------------|
| 0           | $0000                         |
| 1           | $2000                         |

The lower two CB bits (bits 2-1) are ignored in bitmap mode; they still affect
character base selection in text mode but have no effect on the bitmap address.

For VIC bank 0, the two legal bitmap positions in CPU address space are:
- Bit 3 = 0: bitmap at $0000-$1FFF
- Bit 3 = 1: bitmap at $2000-$3FFF

Screen RAM (the color/nybble data in standard bitmap mode) is positioned
independently via the VM bits (bits 7-4), as described in screen_ram_relocation.
A common layout for hires bitmap in bank 0 is bitmap at $2000 (bit 3 = 1) with
screen RAM at $0400 (VM = 1). The $D018 value for this is $18 (bitmap bit set,
VM = 1): binary 0001 1000.

### Why it works

In bitmap mode the VIC-II generates pixel addresses differently from text mode.
Instead of a separate character fetch to look up a bitmap address, the VIC
directly computes: bitmap_base + (character_row * 320) + (character_column * 8)
+ scan_line_within_row. The bitmap base is the one degree of freedom in this
computation, and it is encoded in a single bit of $D018 because only powers of
two from 0 to 8192 are legal — an 8 KB block must land on an 8 KB boundary.

### Variations

**FLI (Flexible Line Interpretation).** FLI forces a badline on every raster
line by writing $D011 (YSCROLL = line & 7) so the badline condition becomes true
on cycle 15; each forced badline re-fetches the 40 video-matrix bytes
(c-accesses, cycles 15-54) from whatever page the VM nibble of $D018 selects, so
with $D018 changed once per line (before the $D011 write) each 8×1 strip gets its
own colour bytes. The cycle-exact write is the $D011 one; $D018 only has to be
in place before it. The bitmap base is not changed. See fli_image in
bitmap-modes.md and recipes/kickassembler/fli-image.md. (An earlier version of
this paragraph described FLI as a cycle-exact $D018 write during an idle fetch
and did not mention $D011 or the forced badline.)

**Bitmap at $0000 and sprite multiplexing.** The $0000-$1FFF bitmap position
overlaps with zero page and the stack ($0000-$01FF). Sprites whose data blocks
land in $0000-$1FFF are valid as long as the sprite pointer value accounts for
the collision. In practice most demos use $2000 for the bitmap and leave
$0000-$1FFF for code, zero-page variables, and stack.

### Cycle budget

No per-line cycle cost. The bitmap base is a one-time configuration write.
FLI timing is covered under `fli_image` in `docs/techniques/bitmap-modes.md`
(Cycle budget (PAL)) and in `docs/recipes/kickassembler/fli-image.md`. (An
earlier version pointed at the raster techniques doc, which declares FLI out of
scope.)

### Recipes

No Phase 3 recipes. Bitmap setup will be demonstrated in Phase 4+ recipe docs.

---

## cartridge_bank_easyflash — EasyFlash cart bank switching

**Complexity:** medium
**Region:** both

### Why

A stock C64 program is limited to 64 KB of addressable memory with roughly
38-52 KB free for game or demo code and data, depending on which ROMs are banked
out. EasyFlash cartridges expand this by providing up to 1 MB of flash memory
organized as up to 64 banks of 16 KB each. The cartridge presents two 8 KB ROM
windows simultaneously (LOROM at $8000-$9FFF and HIROM at $A000-$BFFF), and
software selects which 16 KB bank to page in by writing to the cartridge's bank
register. The entire flash contents become accessible as a sequence of banked
8 KB ROM windows, making EasyFlash the simplest way to distribute a large game
or demo that exceeds the 64 KB address space.

### How

An EasyFlash does not power up in 16 KB mode with the KERNAL present, as an
earlier version of this section said. With boot enabled (the EasyFlash jumper in
its start position; VICE's default, `-easyflashjumper` disables it and the
machine boots to BASIC with the cartridge invisible) the cartridge comes up in
Ultimax mode: bank 0's HIROM is mapped at $E000-$FFFF (ROML at $8000 in Ultimax
per the memory-map reference; not measured here), the CPU fetches its reset
vector from $FFFC of that HIROM, and the KERNAL is not mapped. The startup code
therefore lives in bank 0 HIROM, not LOROM. It typically copies a stub to RAM
and writes $07 to $DE02 (MODE=1, EXROM=1, GAME=1 — bit set means the line is
asserted) to enter 16 KB mode, in which:

- $8000-$9FFF is LOROM (cartridge ROM, low bank)
- $A000-$BFFF is HIROM (cartridge ROM, high bank)
- $D000-$DFFF is I/O (as normal when CHAREN = 1)
- $E000-$FFFF is KERNAL ROM

Measured in VICE x64sc 3.10 with a two-bank type-$0020 .CRT: a CBM80 stub in
bank 0 LOROM is never executed at power-on (the same stub in a generic 16 KB
.CRT is), the HIROM reset vector is, and the CRT header's EXROM/GAME bytes do
not change this.

The EasyFlash hardware decodes two I/O addresses in expansion area 1:

| Register  | Address | Function                                          |
|-----------|---------|---------------------------------------------------|
| EF_BANK   | $DE00   | Select the active 16 KB flash bank (0-63)         |
| EF_CONTROL| $DE02   | Control: GAME (bit 0), EXROM (bit 1), MODE (bit 2), LED (bit 7) |

Writing a bank number (0-63) to $DE00 immediately pages in the corresponding
16 KB chunk of flash. The low 8 KB of that chunk appears at $8000-$9FFF; the
high 8 KB appears at $A000-$BFFF. This happens on the next CPU cycle — the switch
is instantaneous.

Bank 0 is the entry bank: it is active when the cartridge powers on and its
HIROM (not LOROM, as an earlier version said — see above) contains the reset
vector and the startup and loader stub. The remaining banks hold game
chapters, level data, music, graphics, or further code segments. The cartridge
author decides how to partition and use the 64 banks.

$DE02 is the control register: bit 0 = GAME, bit 1 = EXROM (1 = line asserted),
bit 2 = MODE, bit 7 = LED. Bit 1 always drives EXROM, but bit 0 drives GAME only
while bit 2 is set; with bit 2 clear, GAME follows the cartridge's boot jumper
instead, so on a cartridge set to boot, writes of $00-$03 only ever give Ultimax
($00, $01) or 16 KB ($02, $03) and neither 8 KB nor off can be selected. Always
write with bit 2 set: $07 = 16 KB, $06 = 8 KB, $05 = Ultimax, $04 = cartridge
off. Bit names from Oscar64's easyflash.h; mode table measured in VICE x64sc
(3.10) against its EasyFlash emulation, not against hardware. (An earlier
version described $DE02 as a two-bit GAME/EXROM register and omitted MODE.) For
standard EasyFlash operation during gameplay the register is left at $07.

### Why it works

The C64 cartridge port exposes the full 16-bit address bus, the data bus, the
GAME and EXROM input lines, the phi-2 clock, and dedicated ROML/ROMH strobe
outputs. The PLA generates ROML and ROMH based on address range and the
GAME/EXROM configuration. EasyFlash decodes ROML and ROMH as chip-selects for
its flash memory array. A small CPLD or FPGA on the cartridge board intercepts
$DE00 writes and stores the bank number in a latch; on every subsequent ROML or
ROMH access the latch value is OR'd onto the higher address lines of the flash
chip, selecting which physical page of flash responds to that $8000 or $A000
access. The CPU address bus sees ROM at the same two fixed windows; only the
source flash page changes.

### Variations

**Self-modifying cartridge ROM.** Because the C64 PLA disables RAM CAS on reads
in cartridge ROM ranges but writes still reach RAM, any write to $8000-$BFFF
(while cartridge ROM is mapped there) actually writes to the underlying RAM.
This allows a program to maintain RAM buffers at $8000-$BFFF and bank the
cartridge ROM out ($DE02 = $04) when the program needs to write
them back, then bank cartridge ROM in for read-only access. Advanced EasyFlash
programs use this technique for per-level score tables, save states, and
configuration data.

**EasyFlash 3 and extended bank space.** Successor cartridges (EF3) support
more than 64 banks through an additional high-bank register and provide USB
or SD card access, but the basic $DE00 bank-switch mechanism is the same.

### Cycle budget

No cycle constraints for bank switching itself. The bank latch takes the value
on the write cycle of the STA $DE00 — the instruction's last cycle — so the STA
itself always completes correctly (its opcode and operand were fetched before the
write) and a switch can never fall inside an instruction. The hazard is the cycle
after it: the very next opcode fetch already comes from the new bank. Execute the
switching code from RAM, or from a region whose bytes are identical in every
bank, never from the $8000-$BFFF window being switched unless the code that
follows the STA is present at the same address in the target bank. The same
applies to $DE02 mode changes, which can swap $E000-$FFFF from HIROM to KERNAL
under the executing PC — which is why the EasyFlash start-up stub copies itself
to RAM before writing $DE02. (An earlier version advised aligning switches to
instruction boundaries against a mid-instruction switch, which cannot happen.)

### Recipes

No Phase 3 recipes cover EasyFlash. Cartridge-targeting recipes land in a later
phase focused on distribution formats.

---

## ram_under_kernal — Hide RAM under KERNAL ROM
**Demands:** kernal_rom_out

**Complexity:** medium
**Region:** both

### Why

With KERNAL ROM banked in ($01 bit 1 = 1), the 8 KB region from $E000 to $FFFF
reads as ROM. But the underlying RAM at those addresses is still physically
present and is still written by any STA into that range. Banking KERNAL out
(bit 1 = 0) exposes that RAM to the CPU, providing 8 KB of additional work RAM
above and beyond the normal ~38 KB free. This is used for large data buffers,
custom IRQ and NMI handlers that must live at $FFFA-$FFFF, KERNAL replacement,
and packing maximum data into a 64 KB build.

### How

The HIRAM bit is bit 1 of $01. Setting it to 0 disables KERNAL ROM and exposes
the 8 KB RAM from $E000 to $FFFF. Bit 0 (LORAM) does not need to change:
KERNAL ROM visibility is controlled solely by HIRAM when no cartridge is present.

The standard sequence for switching to mode $35 (I/O visible, all ROM banked out):

1. Disable IRQs with SEI (mandatory — KERNAL IRQ handler at $EA31 will be gone).
2. Write the address of the new IRQ handler into RAM at $FFFE/$FFFF. The bytes
   written land in RAM even while KERNAL is still visible on reads.
3. Write the address of the new NMI handler into RAM at $FFFA/$FFFB.
4. Write $35 to $01 (LORAM=1, HIRAM=0, CHAREN=1 — I/O visible, no ROM).
5. Re-enable IRQs with CLI once the new handler is in place.

From this point the $E000-$FFFF range reads back the RAM values written in steps
2 and 3. The CPU correctly fetches interrupt vectors from $FFFA-$FFFF and they
point to the program's custom handlers.

If the program needs to call any KERNAL routine (CHROUT, CHKIN, OPEN, etc.),
it must copy those routines into RAM before banking KERNAL out, or temporarily
bank KERNAL back in with interrupts disabled, call the routine, and bank it
out again.

### Why it works

All ROM banking on the C64 is read-only from the PLA's perspective. The PLA
asserts or deasserts chip-select lines for ROM reads only; it never generates
a ROM chip-select for write cycles. Writes to $E000-$FFFF always reach the
underlying RAM regardless of the HIRAM bit. This is the same property that
applies to BASIC ROM at $A000-$BFFF and char ROM at $D000-$DFFF. The distinction
is that KERNAL ROM also contains the hardware interrupt vectors at $FFFA-$FFFF,
so when KERNAL is banked out and the CPU takes an IRQ or NMI, it reads those
vector addresses from RAM — which must already contain valid handler addresses
before the bank switch happens.

### Variations

**KERNAL replacement.** Entire custom KERNAL images can be placed at
$E000-$FFFF by writing them in while HIRAM is still 1 (ROM wins on reads,
RAM accepts the writes), then clearing HIRAM to expose the RAM image. This
technique powers KERNAL replacement cartridges and some fastloader
implementations. The custom image must provide all jump-table entries at
$FF81-$FFF5 if any downstream code calls KERNAL via the standard jump table.

**RAM at $E000-$FFFF for music and graphics.** In a demo build where KERNAL is
never called and all interrupts are custom-managed, the full 64 KB becomes
available: mode $34 (no ROM, no I/O) gives $A000-$BFFF plus $E000-$FFFF plus
$D000-$DFFF as RAM, totaling 20 KB of previously-ROM space. I/O access in mode
$34 requires temporarily toggling CHAREN: write $35 to $01 for a VIC/SID/CIA
access, then write $34 back. Most demo engines instead use mode $35 (I/O always
visible) and accept that $D000-$DFFF is occupied by I/O rather than RAM.

**The stack cannot move under the KERNAL.** The stack cannot leave page 1: S is
8 bits and the 6510 fixes stack accesses to $0100-$01FF, so RAM under the KERNAL
cannot host a hardware stack. Engines short of stack keep page 1 free of other
data and use a software stack (indexed store through a pointer) for bulk state.
Measured: TXS with X=$50 followed by PHA writes $0150 (VICE x64sc). (An earlier
version of this variation claimed a secondary stack could be relocated to $E1xx
via TXS/TSX; it cannot.)

### Cycle budget

No special cycle budget. Switching HIRAM is a single STA $01. The KERNAL
is gone from the very next read after the write completes.

### Recipes

No Phase 3 recipes. Custom-IRQ-with-RAM-KERNAL infrastructure is prerequisite
to the raster and sprite recipes landing in Phase 4+.

---

## screen_double_buffer_d018 — Screen double buffer via $D018

**Complexity:** medium
**Region:** both
**Uses registers:** D018, D011
**Requires:** screen_ram_relocation

### Why

A program that redraws most of the text screen every frame cannot finish
before the VIC reads the cells it is still writing. The result is a frame
that is half old and half new. Two screen pages fix it: the CPU draws into
the page the VIC is not showing, then one write to $D018 swaps them. The
swap is atomic from the viewer's side, so a frame is always whole.

### How

1. Pick two 1 KB pages in the same VIC bank. Each starts on a 1 KB boundary
   and is selected by the VM nibble (bits 7-4 of $D018), so the two flip
   values differ only in their upper nibble. The pages must not overlap the
   character set (the ROM font the VIC sees at $1000-$1FFF in banks 0 and
   2, or a 2 KB custom set) or a bitmap. The recipe below uses $2800 (VM 10)
   and $2C00 (VM 11) in bank 0 with the ROM font, flip values $A4 and $B4.
2. Keep an index `hidden`. Every draw of the frame goes to `page[hidden]`
   and nowhere else.
3. When the frame is drawn, wait for the vertical blank and write
   `(vm[hidden] << 4) | charset_bits` to $D018. Then `hidden ^= 1`. The
   toggle sits next to the write so no draw can land between them.
4. Before the flip, make the hidden page's sprite pointer block (bytes
   +$3F8 to +$3FF) equal to the visible page's. The VIC reads the pointers
   from whichever page is on display.

Waiting for the blank: poll bit 7 of $D011 (RST8). It sets on line 256,
after the last display line (250 for 25 rows), and clears at line 0. Wait
for it to be clear and then set, not just set: a draw that finishes inside
the bottom border would otherwise see RST8 already high and flip twice in
one frame. Oscar64's `vic_waitFrame()` does exactly this (`vic.c`: while
RST8 set, then while clear).

### Why it works

The VM nibble is only read when the VIC fetches the video matrix, on a
badline, and the 40 bytes are held in a latch for the rest of the character
row (`screen_ram_relocation`, measured there: written on line 54, effective
from line 59). A write in the blank is therefore complete before the first
badline of the next frame, and the whole frame comes from the new page.
The sprite pointers are the exception: they are fetched every raster line
from `visible_page + $3F8`, so a flip moves them on the next line. That is
why the hidden page's pointer block has to be right before the flip and
not after.

Colour RAM at $D800 is not selected by $D018. There is one 1,000-byte
colour map and both pages share it. A colour written while page A is shown
changes A's cell now and B's cell after the flip. Three ways to live with
that: keep the colour map fixed and change only characters (the recipe
sets all 1,000 cells white once); write colour changes in the blank, after
the flip, so the character and its colour arrive together; or confine
colour changes to cells whose character is the same on both pages. The
blank is short for a full colour rewrite. By arithmetic from 312 lines at
63 cycles and 263 lines at 65: lines 251-311 plus 0-50 give 112 lines,
about 7,000 cycles on PAL; 251-262 plus 0-50 give 63 lines, about 4,100
on NTSC. A 1,000-byte fill does not fit the NTSC figure with a C loop.

Frame parity. The page being drawn holds what was on screen two frames
ago, not one. A full redraw does not care. A partial (dirty-cell) update
does: each change has to be applied to both pages, one frame apart, or the
page you flip to shows a cell two frames stale. Keep a change list and
apply it to `page[hidden]` on two consecutive frames, or redraw everything.

Sprite pointers and libraries. Anything that writes sprite pointers
through a single screen address assumes one page. Oscar64's `vspr_init(char
* screen)` stores `screen + 0x3f8` once and bakes the absolute address of
that block into its raster IRQ entries (`c64/sprites.c`); `spr_init` keeps
the same single pointer. `vspr_screen(char * screen)` re-points them. With
two pages, either keep both blocks identical by hand after every image
change, or call `vspr_screen()` with the page about to be shown before the
update that writes the pointers. The second path is not measured here.
The cheapest failure is a clear routine that works in whole 1 KB pages:
bytes 1000 to 1023 hold the pointer block, and a fill that runs to the end
of the page rewrites it every frame. The companion recipe shows the sprite
that results.

If the KERNAL prints to the screen (CHROUT), it prints to the page named by
HIBASE ($0288), which is one page. Set $0288 to the hidden page's high byte
before printing. Not measured here.

### Variations

**Two bitmap pages.** A bitmap needs 8 KB and can only sit at offset $0000
or $2000 in a bank, so two full bitmaps plus their matrices do not fit one
bank; the usual layout is two banks and a $DD00 write alongside the $D018
one (`effects-vector-3d.md`, Double buffering; `bitmap-modes.md`,
Two-bitmap pages).

**Two pages, one charset, two fonts.** With two pages the CB bits can
differ between the two flip values as well, so each page can carry its own
2 KB character set. The cost is 4 KB of charset instead of 2 KB and the
same 1 KB rule for the pages.

**Triple buffering.** A third page lets the draw run more than one frame
without stalling the flip. Three 1 KB pages plus the ROM font still fit
bank 0. Not built here.

### Cycle budget

The flip is one store. The draw has one frame minus nothing: it runs during
the display, so badline and sprite DMA cycles come out of it. Measured in
VICE x64sc 3.10 with the recipe below at `-O2`: a whole-page fill from a
256-byte template (`LDA (zp),y` plus four `STA abs,y`, 30 cycles per four
bytes) plus a 30-cell caption costs 12,598 cycles on PAL and 13,165 on
NTSC, the difference being the badlines and sprite fetches it overlapped.
Both are under a frame (19,656 PAL, 17,095 NTSC), and two runs one PAL
frame apart show consecutive frame numbers on opposite pages. The first
draft filled the page with `memcpy` and `memset` in 40-byte rows at 17,437
and 22,760 cycles; PAL still alternated on the short draw, and NTSC showed
the same frame number in two runs one frame apart, because neither draw
fit in 17,095 cycles. If the counter stops advancing once per frame, the
draw is too slow, not the flip.

### Recipes

- `recipes/oscar64/double-buffer.md` — two pages, one sprite, flip every frame, pointer block mirrored
- `recipes/oscar64/double-buffer-nomirror.md` — the same listing without the mirror, and the sprite it shows
