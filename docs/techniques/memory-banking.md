---
category: banking
chip: 6510
---

<!-- doc-type: technique-reference -->

# Memory Banking Techniques

The Commodore 64's 6510 CPU sees a flat 16-bit address space. That 64 KB window
looks onto 64 KB of dynamic RAM, 8 KB of BASIC ROM, 8 KB of KERNAL ROM, 4 KB of
character generator ROM, the VIC-II register set, the SID, two CIA chips, and
Color RAM. These components share address ranges and are bank-switched in and out
by hardware. The program controls which device answers a given address at a given
moment, and keeps the VIC-II's separate 16 KB view coherent with the CPU-visible
layout it has selected.

Banking on the C64 is active from the first instruction after reset. Every write
to $D011 depends on the I/O chip being visible at $D000. Every IRQ relies on
KERNAL ROM or a RAM replacement being readable at $FFFA-$FFFF. Every C64 program
depends on the banking state.

Sections below: the CPU I/O port that selects which ROMs are visible, the
CIA2 register that defines VIC's 16 KB working window, the relationship between
VIC banking and character ROM visibility, $D018's role in positioning screen RAM
and bitmaps within the VIC bank, the EasyFlash cartridge's per-bank mechanism,
and the technique of hiding working data under KERNAL ROM.

---

## cpu_io_port_bank — $00/$01 port banking

**Complexity:** medium
**Region:** both

### Why

A C64 program that outgrows the default memory layout needs the ROM ranges.
BASIC ROM at $A000-$BFFF takes 8 KB that could hold graphics data, music, or
game code. KERNAL ROM at $E000-$FFFF takes another 8 KB. If a program needs to address the
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
$D000-$DFFF, for example to copy the ROM font into a custom RAM location for
modification.

### Why it works

The PLA chip (906114) sits between the CPU's address and data buses and all the
peripheral devices. It monitors the three processor-port bits from the 6510 along
with the GAME and EXROM lines from the cartridge port. For any given combination
of those five inputs it asserts or deasserts the chip-select lines for each ROM
and the I/O devices. The RAM is always physically present; the PLA merely disables
the RAM's CAS line in a specific address range when it wants a ROM or I/O device
to win that range on reads. Writes to a ROM-mapped range always go to the
underlying RAM: the PLA routes a write cycle at $A000-$BFFF or $E000-$FFFF to
RAM whatever $01 says, and the same holds for $D000-$DFFF while character ROM is
mapped there (CHAREN = 0 with LORAM or HIRAM set). It is NOT true of $D000-$DFFF
while I/O is mapped ($35/$36/$37): there the write goes to the VIC/SID/CIA/colour-RAM
register and the RAM beneath is untouched (measured in VICE x64sc: RAM under $D000
seeded $1D in mode $34; $2D written to $D000 with $01 = $37 read back as $2D, the
sprite-0 X register, and the RAM under it still read $1D once I/O was banked out;
the same test with $E000 put the byte in RAM). An earlier version of this page
said writes go to RAM in every banking state. Code or data can therefore be
written into $E000-$FFFF while KERNAL ROM is banked in. The bytes land in RAM and
become visible once KERNAL is banked out. To put data under I/O, bank it out
first ($34, or $33 if char ROM is acceptable) with interrupts disabled.

### Variations

**Mode $35 with custom IRQ vectors.** When HIRAM goes to 0, the CPU's hardware
IRQ vector at $FFFE/$FFFF and NMI vector at $FFFA/$FFFB are no longer in ROM —
they read from RAM. Before switching to $35, disable interrupts with SEI, write
the IRQ and NMI handler addresses to the RAM at $FFFE/$FFFF and $FFFA/$FFFB (an earlier version said "$FFFE/$FFFB"; writes reach the
underlying RAM even while KERNAL ROM covers them, so write directly), then
write $35 to $01 and re-enable with CLI. The KERNAL-provided interrupt chain at
$EA31 is gone; the program owns all interrupts.

**Temporarily banking in char ROM.** To copy the ROM font to a custom location:
disable IRQs (SEI), write $33 to $01 to swap char ROM into $D000-$DFFF, perform
the copy loop, then write $37 back to restore normal layout, then CLI. The copy
must be complete before re-enabling the I/O chips.

**Preserving bits 3-5.** Bits 3 and 5 of $01 are datasette outputs (bit 3 the
write line, bit 5 the motor, 0 = motor ON), and bit 4 is the tape-button sense
input (DDR $2F leaves it an input, so writes to it do nothing). The constants
above ($33-$37) all keep bit 5 set, so writing them directly does not start the
motor. A value with bit 5 clear does: `LDA #$05 / STA $01` banks out the ROMs
and switches the motor on, and under mode $35 nothing turns it off again, because
the interlock that does so ($EA61) is part of the KERNAL IRQ that mode removes.
Prefer read-modify-write when changing only the banking bits so that
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

No Phase 3 recipes target this technique directly. Banking supports other
techniques: recipes for specific effects (stable IRQ, raster bars,
custom charsets) use mode $35 or $37 as their starting point. Recipes land in
Phase 4+.

---

## vic_bank_select — CIA2 VIC bank select

**Complexity:** low
**Region:** both
**Uses registers:** DD00
**Claims:** cia2_vic_bank (owns)
**Claims basis:** estimated

### Why

The VIC-II chip has a 14-bit internal address bus: it can independently access
any of 16,384 bytes (16 KB) of the C64's RAM. But the C64 has 64 KB of RAM.
To allow VIC to reach graphics data anywhere in the address space, CIA2 port A
bits 0-1 act as a two-bit extension that shifts VIC's 16 KB window to one of
four positions. The VIC bank is the first decision in any memory layout.
Everything else (screen RAM position, char set or bitmap position,
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
outputs). Bits 0-1 of $DD00 reset to 11, placing VIC in bank 0, which is why
the default screen at $0400 is visible to VIC without any setup.

To change the bank, always read-modify-write $DD00: read the current value, mask
off bits 0-1 with AND #$FC, then OR in the desired two-bit bank code, then write
back. This preserves the IEC bus state and prevents glitches on the serial port.

### Why it works

Between CIA2 port A pins PA0-PA1 and the VIC-II's address-bus extension inputs
VA14-VA15 there is a pair of inverting buffers on the C64 motherboard. The two
bit-patterns are therefore inverted with respect to each other: when CIA2 drives
both pins high (the all-ones reset state), the VIC receives low on VA14-VA15,
which it interprets as bank 0. Bit pattern 11 means bank 0 because of this
inversion. TTL open-collector bus lines default to a pulled-high state, so the
reset state (everything high) delivers VIC bank 0 and screen RAM at $0400
without software configuration.

After changing $DD00, the new bank address extension takes effect immediately on
the next VIC fetch cycle. If the raster is currently rendering and VIC is
mid-fetch, the visible result will change partway through the current line.
Production code always makes bank changes during the vertical blank or in a
raster interrupt timed to occur in the overscan region.

### Variations

**Banks 1 and 3 for full custom layouts.** VIC banks 1 ($4000-$7FFF) and 3
($C000-$FFFF) contain no char ROM shadow; the VIC sees only RAM there. This is
the preferred layout for demos with fully custom graphics: all graphics live in
one 16 KB bank, the CPU never accidentally reads char ROM data, and the mapping
is unambiguous.

**Multi-bank sprite tricks.** Sprite data must be addressable within VIC's current
bank, but the CPU can freely write into any bank's RAM while VIC sees only its
own bank. Double-buffering sprite data in the off-bank (writing to the other
16 KB while VIC reads this 16 KB) animates sprites without tearing, by
flipping $DD00 once per frame rather than per-sprite.

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
uppercase/graphics and lower-case/uppercase font data. A program that needs a
custom font, custom symbols, or a modified character set must place that data
at the address VIC expects to find characters. The ROM characters are shadowed
into VIC banks 0 and 2, so the default font is available there without
consuming RAM.

### How

The character ROM resides at $D000-$DFFF from the CPU's perspective (when CHAREN
is 0 and at least LORAM or HIRAM is 1). But VIC-II does not share the CPU's
address space; VIC has its own 16 KB window determined by $DD00. The character
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
generates an internal address in the $1000-$1FFF window (CPU $1000-$1FFF in
bank 0, CPU $9000-$9FFF in bank 2), the PLA asserts char ROM's chip-select
instead of RAM's CAS line. The CPU does not see this: from the CPU's side those are ordinary RAM locations whose content is readable and writable. The char ROM
shadow is VIC-only hardware behavior, not a side-effect of CPU banking.

### Variations

**Dual-charset switching.** Because custom charsets live in RAM and the char
ROM shadow is a hardware overlay, a program can maintain two charsets in RAM
at different $D018 CB offsets and switch fonts by writing $D018 on a per-raster-
line basis in an IRQ. The VIC applies the new $D018 value from the next character
fetch onward, enabling per-line font changes.

**Charset placement at $3800 in bank 0.** Demos sometimes place a
charset near the end of bank 0 ($3800-$3FFF is 2 KB). This allows sprite pointers
and the sprite pool to coexist in the same 16 KB bank with no gaps.

**Copying the ROM font.** To modify the built-in font, copy it first: disable
IRQs, set $01 to $33 (char ROM in $D000-$DFFF), copy 2 KB from $D000-$D7FF
into target RAM, restore $01 to $37. Then point $D018 at the RAM copy.

### Cycle budget

No cycle budget for the bank configuration itself. If $D018 is changed inside a
raster IRQ, the timing of where the new char base takes effect matters; see the
raster techniques doc.

### Recipes

No Phase 3 recipes. Custom-charset setup is infrastructure shared by many
techniques and will be demonstrated in Phase 4+ recipe docs.

---

## charset_copy_rom_to_ram — Copy the character ROM into RAM

**Complexity:** low
**Region:** both
**Uses registers:** D018
**Requires:** cpu_io_port_bank
**Cost:** bytes_code=70, bytes_data=2048
**Cost basis:** derived-listing
**Cost measured on:** kickassembler-charset-copy-rom-to-ram (one-off copy)
**Claims:** vic_char_base (owns)
**Claims basis:** measured-vice

Store trace (`scripts/claims-watch.ts`, VICE x64sc, PAL) of
kickassembler-charset-copy-rom-to-ram: one `$D018` store points the VIC-II
at the copy, and the copy is only seen through it.

### Why

The built-in font lives in ROM, so it cannot be edited in place, and
the VIC only sees it in banks 0 and 2 (`char_rom_under_vic`). A program
that wants the stock glyphs plus a few of its own, or the stock font in
VIC bank 1 or 3, needs a RAM copy. The copy is cheap and runs once, but
it is the one moment in most programs when the I/O chips leave the
address map, and that moment has a failure mode that stops the machine.

### How

1. `SEI`.
2. Read `$01`, clear bits 0-2, set `$33` (CHAREN low, HIRAM and LORAM
   high): `$D000-$DFFF` now reads the character ROM. Keep bits 3-5 as
   found (`cpu_io_port_bank`, "Preserving bits 3-5").
3. Copy 2 KB (`$D000-$D7FF`, the upper-case set) or 4 KB (both sets)
   to a RAM address the VIC can reach and that is not the ROM shadow.
   In bank 0 that means anything but `$1000-$1FFF`.
4. Read `$01`, clear bits 0-2, set `$37`: I/O is back.
5. `CLI`.
6. Point `$D018`'s character-base field at the copy. Only then edit
   glyphs, or edit them first and switch afterwards; either order works
   because the VIC is not reading the copy until the switch.

### Why it works

`$01` bit 2 (CHAREN) with HIRAM or LORAM set selects the character ROM
in the `$D000` window instead of the VIC, SID, CIAs and colour RAM. The
PLA switches on the next bus cycle. Writes in that window go to the RAM
underneath, not to the ROM and not to the I/O chips.

The interrupt flag is what makes the copy safe. The KERNAL's
IRQ handler acknowledges CIA1 by reading `$DC0D`, scans the keyboard
through `$DC00`/`$DC01`, and a raster handler acknowledges the VIC by
writing `$D019`. While the ROM is mapped every one of those addresses
is a font byte. An acknowledge that never happens leaves the interrupt
line asserted, so the handler re-enters as soon as it returns, and the
copy loop never gets another cycle. Measured in VICE x64sc with the
recipe below: the copy done with interrupts enabled managed 30 of 256
loop iterations on PAL and 7 on NTSC before the first KERNAL IRQ, and
never advanced again; the handler ran 26 times in the 61,000 cycles a
watchdog NMI allowed it, and its keyboard scan queued one phantom key.
Pitfall `irq_during_charen_window` has the detail. A program that has
replaced the KERNAL IRQ with its own handler is in the same position if
that handler touches any I/O register, which every raster handler does.

### Variations

**Copy one set only.** The upper-case/graphics set is `$D000-$D7FF`,
the lower-case set `$D800-$DFFF`. Most programs want one; eight
load/store pairs in the loop instead of sixteen.

**Copy with the display blanked.** Every badline the copy spans costs
about 40 cycles. Clear `$D011` bit 4, wait for a frame past line `$30`
so the VIC samples DEN off, copy, restore. Or do the copy before the
display is switched on at all, which is where a loader or a title
screen usually has it anyway.

**Copy under a raster interrupt.** If a raster IRQ is already running,
`SEI` alone is not enough for a long copy: the interrupt is only
deferred, and the frame it was meant to split is torn. Stop the raster
IRQ (clear `$D01A` bit 0, acknowledge `$D019`), copy, restart it. The
copy is under 40,000 cycles, two PAL frames, so the interruption is one
or two frames of the default picture.

**Pointer loop.** In C, `memcpy(dst, (const char *)0xd000, 2048)`
between the two `$01` writes does the same job; the compiler's loop is
slower than the unrolled indexed one but the difference is one frame.

### Cycle budget

Measured in VICE x64sc with the CIA2 timers, the 17-cycle timing window
subtracted, in the recipe below: the 2 KB copy costs 19,733 cycles with
the display blanked on both models, which is exactly the instruction
table (eight `LDA abs,X` / `STA abs,X` pairs, `INX`, `BNE`, 256 times,
plus 22 for the two `$01` switches). With the display on it is 20,784
on PAL and 21,150 on NTSC, the difference being the badlines the window
spans. The 4 KB copy with the display on is 39,580 PAL, 40,267 NTSC;
arithmetic puts it at 38,165 with the display blanked, not measured
here. Two figures from earlier builds: a copy routine
that holds `SEI` and `CLI` inside the timed window reads about 470
cycles high, because the KERNAL IRQ that fell due during the copy runs
at the `CLI`; and a loop whose `BNE` crosses a page boundary reads 255
high (pitfall `branch_page_cross_extra_cycle`). The Cost line above is
the built 2 KB routine's code and the RAM the copy occupies; the copy
runs once, so it carries no per-frame figure.

### Recipes

- `recipes/kickassembler/charset-copy-rom-to-ram.md`: the copy,
  checked against a host checksum of the ROM, timed three ways, the
  VIC pointed at it, and then done once without `SEI` under a watchdog
  NMI so the hang is measured rather than described.
- `recipes/kickassembler/big-font-scroller.md` and
  `recipes/oscar64/load-asset-runtime.md` do the copy inline as a step
  of something else.

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
$0400. This is the "READY." screen at boot. ($14 is the value the KERNAL
writes; the register reads back as $15 because bit 0 is unused and reads 1;
measured in VICE x64sc.)

Sprite pointers always follow the screen RAM: the 8 bytes at screen_base + $3F8
(screen_base + 1016) hold the sprite data-block pointers. When screen RAM moves,
sprite pointers move with it: they are at a fixed offset from the
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
running character clock counter. Moving VM shifts the entire screen fetch window
by multiples of 1 KB within the VIC bank, with no software overhead per
character.

### Variations

**Screen at $3C00.** Placing screen RAM at the top of VIC bank 0 ($3C00-$3FE7,
the 1 KB block running to $3FFF; an earlier version said $3FEF, which is 1008 bytes)
frees the lower 15 KB for code and graphics. The 8 bytes of sprite pointers at
$3FF8-$3FFF are at the top of the bank. This is a common
layout for demos that use a full custom layout in bank 0.

**Double-buffered screen RAM.** (Worked through, with the sprite pointer
mirror and a measured recipe, as `screen_double_buffer_d018` below.) Two
screen buffers can live at different VM
offsets (e.g., $0000 and $0400 within the bank). The visible buffer flips by
changing VM bits; the invisible buffer is updated by the CPU. This avoids
screen tearing on text-mode displays; the flip lands at the next
badline, so write $D018 during the border or vertical blank for a whole-frame
swap.

### Cycle budget

A VM change is not seen until the next badline: the VIC fetches the 40
video-matrix bytes only during cycles 15-54 of a badline and reuses that latch
for the remaining seven lines of the character row, so a $D018 write mid-row
leaves the current row on the old base and moves the display from the next row
down (measured in VICE x64sc: written on line 54, effective from line 59).
Sprite pointers are the exception: they are fetched every line and follow the
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
two valid positions for the bitmap within the bank.

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

For VIC bank 0, bit 3 selects between:
- Bit 3 = 0: $0000-$1FFF. Not usable: the VIC sees character ROM at
  $1000-$1FFF in banks 0 and 2, so the lower half of the screen shows the
  ROM glyphs, and the upper half is zero page, stack and screen RAM.
  Measured in VICE x64sc: with $D018 = $10 in bank 0, all 488 cells from
  bitmap byte $1000 on showed the character ROM bytes. (An earlier version
  listed $0000-$1FFF as a legal bitmap position in bank 0.)
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
two from 0 to 8192 are legal: an 8 KB block must land on an 8 KB boundary.

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

**Bitmap at $0000 and sprite multiplexing.** In bank 0 the $0000-$1FFF bitmap
position is not usable (see above): its lower half overlaps zero page and the
stack, its upper half is character ROM to the VIC. Sprite data in $1000-$1FFF
of bank 0 reads character ROM too. In banks 1 and 3 offset $0000 is plain RAM.
Most programs use $2000 for the bitmap in bank 0 and leave $0000-$1FFF for code,
zero-page variables and stack. (An earlier version said sprite blocks anywhere
in $0000-$1FFF are valid.)

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
**Consumes formats:** CRT

### Why

A stock C64 program is limited to 64 KB of addressable memory with roughly
38-52 KB free for game or demo code and data, depending on which ROMs are banked
out. EasyFlash cartridges expand this by providing up to 1 MB of flash memory
organized as up to 64 banks of 16 KB each. The cartridge presents two 8 KB ROM
windows simultaneously (LOROM at $8000-$9FFF and HIROM at $A000-$BFFF), and
software selects which 16 KB bank to page in by writing to the cartridge's bank
register. The entire flash contents become accessible as a sequence of banked
8 KB ROM windows, so an EasyFlash can hold a large game or demo that exceeds
the 64 KB address space.

### How

An EasyFlash does not power up in 16 KB mode with the KERNAL present, as an
earlier version of this section said. With boot enabled (the EasyFlash jumper in
its start position; VICE's default, `-easyflashjumper` disables it and the
machine boots to BASIC with the cartridge invisible) the cartridge comes up in
Ultimax mode: bank 0's HIROM is mapped at $E000-$FFFF (ROML at $8000 in Ultimax
per the memory-map reference; not measured here), the CPU fetches its reset
vector from $FFFC of that HIROM, and the KERNAL is not mapped. The startup code
therefore lives in bank 0 HIROM, not LOROM. It typically copies a stub to RAM
and writes $07 to $DE02 (MODE=1, EXROM=1, GAME=1; bit set means the line is
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
high 8 KB appears at $A000-$BFFF. The switch takes effect on the next CPU
cycle.

Bank 0 is the entry bank: it is active when the cartridge powers on and its
HIROM (not LOROM, as an earlier version said; see above) contains the reset
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
them back, then bank cartridge ROM in for read-only access. EasyFlash
programs use this technique for per-level score tables, save states, and
configuration data.

**EasyFlash 3 and extended bank space.** Successor cartridges (EF3) support
more than 64 banks through an additional high-bank register and provide USB
or SD card access, but the basic $DE00 bank-switch mechanism is the same.

### Cycle budget

No cycle constraints for bank switching itself. The bank latch takes the value
on the write cycle of the STA $DE00 (the instruction's last cycle), so the STA
itself always completes correctly (its opcode and operand were fetched before the
write) and a switch can never fall inside an instruction. The hazard is the cycle
after it: the very next opcode fetch already comes from the new bank. Execute the
switching code from RAM, or from a region whose bytes are identical in every
bank, never from the $8000-$BFFF window being switched unless the code that
follows the STA is present at the same address in the target bank. The same
applies to $DE02 mode changes, which can swap $E000-$FFFF from HIROM to KERNAL
under the executing PC, which is why the EasyFlash start-up stub copies itself
to RAM before writing $DE02. (An earlier version advised aligning switches to
instruction boundaries against a mid-instruction switch, which cannot happen.)

### Recipes

- `recipes/kickassembler/easyflash-save.md` builds an EasyFlash `.crt` from one
  listing and saves to flash through the Am29F040 commands (technique
  `cartridge_save` on the file I/O page). An earlier version of this section
  said no recipe covered EasyFlash.

---

## ram_under_kernal — Hide RAM under KERNAL ROM
**Demands:** kernal_rom_out

**Complexity:** medium
**Region:** both
**Cost:** cycles_per_frame=0
**Cost basis:** arithmetic
**Cost measured on:** kickassembler-scroll-panel-split (one `$01` store at init, and the IRQ enters through `$FFFE` without the KERNAL dispatcher, so no per-frame work)
**Claims:** irq_vector_fffe (owns), nmi_vector_fffa (owns)
**Claims basis:** estimated

### Why

With KERNAL ROM banked in ($01 bit 1 = 1), the 8 KB region from $E000 to $FFFF
reads as ROM. But the underlying RAM at those addresses is still physically
present and is still written by any STA into that range. Banking KERNAL out
(bit 1 = 0) exposes that RAM to the CPU, providing 8 KB of additional work RAM
beyond the normal ~38 KB free. This is used for large data buffers,
custom IRQ and NMI handlers that must live at $FFFA-$FFFF, KERNAL replacement,
and packing maximum data into a 64 KB build.

### How

The HIRAM bit is bit 1 of $01. Setting it to 0 disables KERNAL ROM and exposes
the 8 KB RAM from $E000 to $FFFF. Bit 0 (LORAM) does not need to change:
KERNAL ROM visibility is controlled solely by HIRAM when no cartridge is present.

The standard sequence for switching to mode $35 (I/O visible, all ROM banked out):

1. Disable IRQs with SEI (mandatory: the KERNAL IRQ handler at $EA31 will be gone).
2. Write the address of the new IRQ handler into RAM at $FFFE/$FFFF. The bytes
   written land in RAM even while KERNAL is still visible on reads.
3. Write the address of the new NMI handler into RAM at $FFFA/$FFFB.
4. Write $35 to $01 (LORAM=1, HIRAM=0, CHAREN=1: I/O visible, no ROM).
5. Re-enable IRQs with CLI once the new handler is in place.

From this point the $E000-$FFFF range reads back the RAM values written in steps
2 and 3. The CPU fetches interrupt vectors from $FFFA-$FFFF and they
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
vector addresses from RAM, which must already contain valid handler addresses
before the bank switch happens.

### Variations

**KERNAL replacement.** Entire custom KERNAL images can be placed at
$E000-$FFFF by writing them in while HIRAM is still 1 (ROM wins on reads,
RAM accepts the writes), then clearing HIRAM to expose the RAM image. KERNAL
replacement cartridges and some fastloader implementations use this. The custom image must provide all jump-table entries at
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
**Cost:** cycles_per_frame=13196, cycles_per_item=814, cycles_item_base=57
**Cost basis:** measured-vice
**Cost measured on:** oscar64-double-buffer (the recipe's whole-page redraw with its caption, 12,598 PAL and 13,165 NTSC, plus the 31-cycle flip; an item is one 40-byte row copied into the hidden page by a C byte loop at -O2, fitted to -dREDRAW_ROWS builds of 0 to 25 rows on PAL and NTSC; the base is the flip, 31, and the sprite-pointer copy, 26; the wait for the blank is not in it)
**Claims:** vic_matrix_base (owns)
**Claims basis:** measured-vice

A `scripts/claims-watch.ts` store trace of `recipes/oscar64/double-buffer.md`
saw one `$D018` store a frame, changing only the matrix bits. `$D011` is
polled, not written. The recipe's sprite and CIA1 timer B are its
demonstration and measurement harness, not the technique's
([#71](https://github.com/bdgscotland/c64-kb/issues/71)).

The Cost line counts the redraw of the hidden page as items: a plan that
names `screen_double_buffer_d018 ×3` is charged 57 + 3 × 814 = 2,499
cycles, and one with no count is charged the recipe's whole-page redraw,
13,196. Until #106 the line was `cycles_per_frame=57`, the flip and the
pointer copy alone, so a plan budget counted none of the redraw and did
not name it unknown; the #22 game test's second run drew three rows a
frame at 1,716 to 1,776 cycles that no figure held.

The base is timed by a VICE monitor exec trace of the recipe's `-O2`
build (x64sc 3.10, PAL and NTSC, the same on every frame traced). The
flip, from the load of `vm[hidden]` after the wait to the store of the
toggled index, is 31 cycles. The copy of the sprite pointer into the
hidden page is 26, a bound: the traced block also sets up an argument
for the caption. The item is the recipe built with `-dREDRAW_ROWS=n`,
which copies n rows of a 1,000-byte map with a byte loop and times them
with CIA1 timer B (the recipe's "Row redraw builds"). 814 cycles a row is
the steepest step measured, 16,328 NTSC for 20 rows, so 57 + 814 × n is
at or above every build on both models. Rows drawn in the border cost
less, 750 to 790 each: 814 holds the badlines and the sprite fetch a draw
running into the display loses. A faster copy has a smaller item: the
recipe's own four-way template fill writes the whole 1 KB page in 12,598
cycles PAL, about 504 per 40 bytes, and the #22 game's three rows took
1,716 to 1,776 (run 2) and 2,015 to 2,180 (run 1).

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
changes A's cell now and B's cell after the flip. Three ways to handle
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
page flipped to shows a cell two frames stale. Keep a change list and
apply it to `page[hidden]` on two consecutive frames, or redraw everything.

Sprite pointers and libraries. Anything that writes sprite pointers
through a single screen address assumes one page. Oscar64's `vspr_init(char
* screen)` stores `screen + 0x3f8` once and bakes the absolute address of
that block into its raster IRQ entries (`c64/sprites.c`); `spr_init` keeps
the same single pointer. `vspr_screen(char * screen)` re-points them. With
two pages, either keep both blocks identical by hand after every image
change, or call `vspr_screen()` with the page about to be shown before the
update that writes the pointers. The second path is not measured here.
One failure is a clear routine that works in whole 1 KB pages:
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

The flip is one store. The draw has at most one frame. It runs during
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

## memory_layout_plan — Plan the memory map before the first build

**Complexity:** low
**Uses registers:** D018, DD00

**Why.** The toolchain places code where it likes; the VIC-II does not.
A music player expects `$1000`, a charset must start on a 2 KB boundary
inside the VIC's 16 KB bank, a screen on a 1 KB boundary, a sprite on 64
bytes, and none of them may overlap code that grows with the next
feature. A layout decided after the fact produces the collision the
`charset_blit_overruns_grown_code` pitfall describes: a build that boots
and shows garbage where the font was.

**How.** List every asset with a fixed address or alignment; choose the
VIC bank; place the aligned assets first, largest alignment first; then
let code and data fill what remains, and read the map file back after
every build to see that nothing moved into a reserved range. Write the
plan down as the toolchain's own words: Oscar64 regions and sections,
the cc65 linker configuration, KickAssembler `.pc` and segments. The
toolchain page `toolchains/memory-layout-planning.md` walks through it
for all three.

**Why it works.** The VIC reads through its own 16 KB window with fixed
alignments set by `$D018` and the bank bits of `$DD00`; the CPU sees the
whole 64 KB and does not care where anything is. Planning the VIC's
constraints first and letting the CPU's flexible material fill the gaps
meets the constraints by construction.

**Variations.** Two VIC banks with the assets split between them; data
under the ROMs for the CPU only (`ram_under_kernal`); a loader that owns
the top of RAM, which the plan leaves free.

**Cycle budget.** None: this is a build-time decision.

### Recipes

- `recipes/oscar64/memory-layout.md` — stub, music, charset, sprite, screen and code at planned addresses, printing each symbol's address so the screen can be read against the map

## relocated_code_block — Code stored at one address and run at another

**Complexity:** low
**Region:** both

**Why.** A PRG loads as one contiguous block from `$0801`, but some code
must run somewhere else: a loader or an IRQ handler under the I/O area or
the KERNAL, a routine at `$C000` that survives the main program being
overwritten, a stub in RAM that runs while a cartridge bank changes. The bytes
travel in the PRG at a load address and are copied to the run address at
start-up. Code assembled for the load address fails after the copy:
every `JSR`, `JMP` and absolute data address inside it still names the
load address.

**How.** Tell the toolchain the run address, keep the bytes at the load
address, and copy them before the first call:

| Toolchain | Stored at the load address, linked for the run address | Copy |
|---|---|---|
| KickAssembler | `* = $2000` then `.pseudopc $c000 { ... }`; labels inside take `$C0xx` | a copy loop over `block_end - block_load` bytes |
| Oscar64 | `#pragma section(rcode, 0)` and `#pragma region(rblock, 0x2000, 0x2100, , , {rcode}, 0xc000)`, then `#pragma code(rcode)` / `#pragma data(rcode)` around the block | `memcpy((char *)0xc000, (char *)0x2000, size)` |
| cc65 | a segment with `load = BLOCK, run = HIRAM, define = yes` in the linker configuration, selected with `#pragma code-name` and `#pragma rodata-name` | `memcpy(_RELOC_RUN__, _RELOC_LOAD__, size)` from the linker's symbols |

Each form was built and run in VICE by the three `relocated-code-block`
recipes: a border flash stored at `$2000`, copied to `$C000`, the stored
copy wiped, then called. All three left the border green on PAL and NTSC,
and a monitor break at `$C000` with the toolchain's label file loaded
stopped there.

**Why it works.** The CPU executes whatever bytes are at the program
counter. Relative branches are position-independent; `JSR`, `JMP`,
absolute and indexed operands are not, so the assembler or linker must
compute them for the address the code will run at. The copy moves bytes
unchanged, so the code is right at the run address and wrong anywhere
else. The KickAssembler recipe's control, assembled for `$2000` and run
at `$C000`, ended at `READY.` after executing a `BRK` in the wiped image.

**Symbols.** KickAssembler's `.vs` and cc65's `-Ln` file list the run
address. Oscar64's `.lbl` and `.map` list the storage address (`al 2000
.flash`), so a monitor break on the label never fires; add the offset to
the labels in the region before loading them (the Oscar64 recipe has a
one-line rewrite).

**The stored copy is a fixed address.** The program's own code must not
grow into it. Oscar64 linked its default `main` region over the block's
`$2000` with no diagnostic, and cc65 without `fill = yes` wrote the block
straight after `MAIN` while `__RELOC_LOAD__` still named `$2000` (both
measured in the recipes). That is the collision
`charset_blit_overruns_grown_code` in `pitfalls/banking.md` describes;
declare the block's range in the layout (`memory_layout_plan`).

**Variations.** Several blocks linked for the same run address and
copied in turn (overlays, `runtime_relocation` in
[loaders-packers](loaders-packers.md) for relocation at run time); a run
address under the KERNAL or I/O, which needs `$01` switched for the copy
and for every call (`cpu_io_port_bank`); a bank-switch stub copied to
`$0200` so it runs from RAM while the cartridge bank changes, the
`.pseudopc $0200` example in `pitfalls/banking.md`.

**Cycle budget.** The copy runs once at start-up. The code costs at its
run address what it would cost anywhere.

### Recipes

- `recipes/kickassembler/relocated-code-block.md` — `.pseudopc`, the `.vs` labels at `$C0xx`, the control that ends at `READY.`
- `recipes/oscar64/relocated-code-block.md` — a region with a run address, the `.lbl` rewrite for the monitor
- `recipes/cc65/relocated-code-block.md` — a `load`/`run` segment pair, the linker's `__RELOC_LOAD__` and `__RELOC_RUN__`

## irq_owns_processor_port — Interrupt handlers that save, set and restore $01

**Complexity:** medium
**Region:** both
**Uses registers:** D019, DD0D
**Requires:** cpu_io_port_bank, ram_under_kernal
**Demands:** kernal_rom_out
**Cost:** cycles_per_frame=18
**Cost basis:** measured-vice
**Cost measured on:** kickassembler-irq-owns-port (per interrupt taken)

### Why

The 4 KB of RAM under `$D000-$DFFF` is only reachable with I/O banked
out (`$01` = `$34`, or `$30`). The rule elsewhere on this page and in
`pitfalls/banking.md` is `SEI` first, because an interrupt handler run
in that state writes its acknowledge and its register updates into RAM.
That rule is fine for a short poke. It is not fine for a decruncher or
a loader filling 4 KB of level data, which takes frames: with `SEI` the
music stops and the raster splits fall apart for the whole depack. Games
and loaders instead make every interrupt handler put I/O back itself, so main code can leave `$01` at `$34` with interrupts on.

### How

1. Bank the KERNAL out for good. Write the IRQ handler's address to
   `$FFFE/$FFFF` and the NMI handler's to `$FFFA/$FFFB`; the writes
   reach the RAM under the ROM (`ram_under_rom_traps`). With HIRAM
   clear, as it is in both `$34` and `$35`, the CPU takes its vectors
   from that RAM. The KERNAL's `$0314`/`$0318` vectors are never read.
2. Every handler, IRQ and NMI alike, starts by saving `$01` and
   storing `#$35`:
   `PHA` / `LDA $01` / `PHA` / `LDA #$35` / `STA $01`.
3. The handler does its work: acknowledge (`$D019`, `$DC0D` or
   `$DD0D`), raster writes, the music player.
4. It ends by putting back exactly the value it found:
   `PLA` / `STA $01` / `PLA` / `RTI`.
5. Main code may now set `$01` = `$34` and copy, decrunch or load into
   `$D000-$DFFF` with interrupts enabled, and set `$35` again when it
   needs I/O itself.

### Why it works

The PLA chip decodes the processor-port lines on every access, so the handler's store of `#$35`
makes the VIC, SID and CIAs visible from its next instruction, and the
restore hides them again before `RTI` returns to the interrupted copy.
The copy never sees I/O, and the handler never sees RAM where it
expects a register.

The restore must be the saved value, not a constant. The interrupted
code may be mid-copy at `$34` or may itself be at `$35`; a handler that
ends with `#$35` returns a `$34` copy into the I/O window, and the rest
of the copy is written into the VIC, SID and CIA registers. Measured in
VICE with the recipe below: the display turned to garbage and main code
never finished its first pass.

The save goes on the stack, or in a byte of the handler's own. An NMI
can land inside an IRQ handler's wrapper, between its `LDA $01` and its
restore. With one shared save byte the NMI would overwrite the IRQ's
saved `$34` with `$35`. With the stack each handler restores its own
copy.

Store `#$35`, do not `ORA #$01`: from `$34` either gives `$35`, but
from `$30` the `ORA` gives `$31`, which maps the character ROM, not I/O
(`hardware/c64-registers-reference.md`, the `$01` bit description). `#$35` keeps bit 5 set, so the
datasette motor stays off; it does overwrite bits 3-5 while the handler
runs, and the restore puts back what the main code had.

The NMI needs the same treatment because `SEI` does not mask it: the
RESTORE key and CIA2 can raise one at any time. An NMI handler without
the wrapper reads `$DD0D` from RAM, CIA2's flag stays set, `/NMI` never
rises, and no later NMI, from CIA2 or RESTORE, can happen (pitfall
`kernal_nmi_handler_runs_stop_check`). The recipe's broken build showed
exactly one NMI in 115 million cycles.

A handler without the wrapper under `$34` fails at once: its `$D019`
write goes to RAM, the VIC's interrupt stays asserted, and the handler
re-enters as soon as it returns. Measured in VICE: the recipe's two
raster handlers re-entered each other for 115 million cycles (PAL; 100
million NTSC) and main code never completed a pass. This is the same
mechanism as `irq_during_charen_window`, with RAM in place of the
character ROM. The handler's other writes land in the RAM copy
(`$D020`, `$D012`, `$D400` were all found there).

### Variations

**Save in zero page.** `LDA $01` / `STA save` / `LDA #$35` / `STA $01`
and `LDA save` / `STA $01` cost 17 cycles, one fewer than the stack
form (arithmetic from the instruction table). Each handler that can
nest needs its own byte.

**Music code under I/O.** The wrapper assumes the handler and the
player live outside `$D000-$DFFF`. A player placed under I/O cannot
write the SID while its own code is visible. GoatTracker 2's
"zeropage ghostregs" option has the player write to a zero-page copy
of the SID registers, which a copy loop moves to `$D400` afterwards
with I/O banked in (GoatTracker 2 readme, section 5.1, not measured
here).

**Loaders that do it for you.** Sparkle's loader sets `$35` at each loader
call and `$34` while a bundle is decrunched under I/O, and its manual requires
every IRQ to save `$01`, set `$35` and restore it (Sparkle 3.4 manual,
"Loading to the RAM under I/O registers", not measured here).

### Cycle budget

Measured in VICE x64sc 3.10 with the recipe below, PAL and NTSC alike:
the wrapper costs 18 cycles per interrupt taken (`LDA zp` 3, `PHA` 3,
`LDA #` 2, `STA zp` 3, `PLA` 4, `STA zp` 3, which is what the
instruction table gives). The recipe's line-120 handler is 61 cycles
with it and 43 without, each plus the 7-cycle interrupt sequence. The
Cost line is one interrupt; a frame pays 18 for every IRQ and NMI it
takes: 36 for a two-split raster chain, 36 plus 18 per NMI with a CIA2
timer running; the recipe's own frame, 2 IRQs and up to 4 NMIs, is
108 (arithmetic). The wrapper is 10 bytes per handler (arithmetic from
the opcode sizes).

### Recipes

- `recipes/kickassembler/irq-owns-port.md` — main code copies 4 KB
  under I/O at `$34` and checks it by sum 32 times while two raster
  IRQs, a SID player and a CIA2 NMI keep running; handler cycles with
  and without the wrapper; two broken builds described.

### Sources

- Sparkle 3.4 user manual (Sparta), "Loading to the RAM under I/O
  registers ($D000-$DFFF)" and "Common issues" item 6:
  https://github.com/spartaomg/SparkleCPP
- GoatTracker 2 readme, section 5.1 "Playroutine options", option
  "Use zeropage ghostregs":
  https://sourceforge.net/projects/goattracker2/

## reu_dma — REU DMA transfers, fixed-address fills and the $FF00 trigger

**Complexity:** medium
**Region:** both
**Uses registers:** DF00, DF01, DF02, DF03, DF04, DF05, DF06, DF07, DF08, DF09, DF0A
**Claims:** expansion_io2 (owns)
**Claims basis:** measured-vice

Store trace (`scripts/claims-watch.ts`, VICE x64sc, PAL, `-reu -reusize
512`) of kickassembler-reu-dma: 161 stores to the REU registers
`$DF01-$DF0A`.

### Why

A 17xx RAM Expansion Unit (1700 128 KB, 1764 256 KB, 1750 512 KB, per
codebase64) and its modern equivalents add banks of RAM the CPU cannot
address, and a DMA controller that moves bytes between them and C64
memory at one byte per cycle. A game uses it as a store for level data
and graphics that would otherwise be loaded from disk, as a copier that
beats any CPU loop (an unrolled `LDA abs` / `STA abs` is 8 cycles a
byte, `speedcode_generation`), and as a filler: with one address held
still, it fills a block from one byte or streams a block into one
register. It is an optional extra. A program that uses it must detect
it and must still run without it.

### How

The registers sit at `$DF00-$DF0A`, in the cartridge I/O-2 page. Bit
meanings are from codebase64 `base:reu_programming`. The ones marked
"measured" were exercised by the recipe in VICE x64sc 3.10; the rest are
from that source only.

| Register | Meaning |
|---|---|
| `$DF00` status, read | bit 7 interrupt pending; bit 6 end of block (measured); bit 5 verify fault (measured); bit 4 size, set for 256 KB chips, so on a 1764 or 1750 (measured set with `-reusize 512`); bits 3-0 version (measured 0). Reading clears the fault bit (codebase64; not measured here). |
| `$DF01` command | bit 7 execute; bit 5 autoload, which restores the address and length registers after the transfer; bit 4 set = start now, clear = wait for a write to `$FF00` (both measured); bits 1-0 type: `00` stash C64 to REU, `01` fetch REU to C64, `10` swap, `11` verify (all measured). Bits 6, 3, 2 reserved. |
| `$DF02/$DF03` | C64 address, low/high (measured) |
| `$DF04/$DF05/$DF06` | REU address low/high and bank; bank bits 2-0 for 512 KB (measured: bits 7-3 read back as 1 in VICE with 512 KB) |
| `$DF07/$DF08` | length, low/high; 0 = 65,536 (measured) |
| `$DF09` interrupt mask | bit 7 enable, bit 6 on end of block, bit 5 on verify error; bits 4-0 unused |
| `$DF0A` address control | bit 7 holds the C64 address still, bit 6 the REU address (both measured); bits 5-0 unused |

1. Detect. Write a pattern to `$DF02-$DF08` and read it back. Compare
   `$DF06` on bits 2-0 only. With no REU the reads are open bus (the
   byte the VIC-II last fetched, `hardware/c64-registers-reference.md`)
   and the pattern does not come back: the recipe read all `$00` on PAL
   and `$00` with one `$FF` on NTSC. Another cartridge that decodes
   `$DF00` can pass this test (codebase64); knowing the cartridge is the
   caller's job.
2. Load the C64 address, REU address and bank, length and `$DF0A`.
   Without autoload the registers are left past the end, so load all of
   them before each transfer.
3. Write the command to `$DF01`: `$90` stash, `$91` fetch, `$92` swap,
   `$93` verify. The CPU is halted until the last byte has moved.
4. For a verify, read `$DF00` first to clear it, then test bit 5 after.
   On a mismatch the verify stops, bit 6 stays clear, and `$DF02/$DF03`
   point one past the differing byte (measured).

To reach the RAM under I/O, arm the transfer with bit 4 clear (`$81` for
a fetch) while I/O is visible, set `$01` = `$34`, and write to `$FF00`.
The write starts the DMA, which sees the memory configuration that is
in force, so it reaches the RAM at `$D000-$DFFF`. `LDA $FF00` / `STA
$FF00` keeps the byte already in the RAM under the KERNAL. Keep
interrupts masked while `$01` is `$34`, or give the handlers the
`irq_owns_processor_port` wrapper.

### Why it works

The REU is a bus master. It pulls the CPU off the bus and drives the
address and data lines itself, one access per cycle, so a stash, fetch
or verify moves one byte per cycle and a swap, which reads and writes
each C64 byte, one byte per two. The VIC-II keeps priority. On a badline
and on a sprite's fetch cycles it takes the bus from the REU as it
takes it from the CPU, so the transfer waits (pitfalls
`badline_cycle_loss`, `vic_bus_takeover_on_dma`). The `$FF00` trigger
exists because the store to `$DF01` needs I/O visible, while the
transfer may need it hidden.

### Variations

- **Fill.** Stash one byte once. Then fetch with `$DF0A` = `$40` (REU
  address held): every C64 byte in the block gets that value. The recipe
  fills 1,000 bytes of colour RAM this way in 1,000 cycles.
- **Stream to a register.** Fetch with `$DF0A` = `$80` (C64 address
  held) to write every REU byte to one address, such as `$D418` for a
  digi. The DMA runs flat out, one byte per cycle, so the samples do not
  come out at a controlled rate unless the transfer is split into short
  lengths and timed; this is not measured here. The recipe uses the
  same bit the other way round, stashing 65,536 reads of one byte.
- **Level store.** Fetch a level's map, charset and sprites at level
  start: 16 KB is about 16,400 cycles blanked, under one PAL frame of
  19,656 (arithmetic from the measured one cycle per byte).
- **Double buffer.** Fetch the next screen's 1,000 bytes in 1,008
  cycles; with the screen on, allow for the badlines it crosses.

### Cycle budget

Measured in VICE x64sc 3.10 with the recipe, PAL and NTSC. The store to
`$DF01` is part of the count; after it a stash, fetch, fill or verify of
n bytes takes n cycles and a swap 2n, with the screen blanked. A 1-byte
stash came to 9 cycles including the 8-cycle `LDA abs` / `STA abs`.
With the text screen on, a 65,536-byte stash took 69,414 cycles on PAL
(1.05 per byte) and 69,844 on NTSC (1.06). With eight sprites on 21
lines as well, it took 71,134 on PAL and 71,439 on NTSC. The cost of a
transfer depends on its length and where in the frame it runs, so this
page carries no Cost line: budget one cycle per byte blanked, and about 6 %
(PAL) and 7 % (NTSC) more with the screen on across whole frames. A transfer that must
fit a raster window should be timed in that window.

### Recipes

- `recipes/kickassembler/reu-dma.md` — detects the REU; stashes, fetches
  into screen RAM, fills colour RAM from one byte, swaps, verifies (and
  reads the fault bit on a changed byte), fetches under I/O with the
  `$FF00` trigger, and times each transfer blanked, with the screen on
  and with eight sprites on.

### Sources

- codebase64, "REU programming" (Richard Hable, Marko Mäkelä), register
  bits, transfer speed, `$FF00` use, detection and model sizes:
  https://codebase64.net/doku.php?id=base:reu_programming

## pucrunch_decruncher — Pucrunch: a small forward decruncher in the zero page, stack and input buffer

**Complexity:** low
**Region:** both
**Uses kernal:** (none)
**Cost:** bytes_code=245, zp_bytes=11
**Cost basis:** derived-listing

The Cost line is the default C64 decruncher's footprint as pucrunch prints
it after a crunch (`$2d/$2e`, `$f7-$1b6` and `$200-$234`: 192 plus 53
bytes of decruncher, and eleven bytes of zero page, nine of them `$F7` to
`$FF` and two more at `$2D`/`$2E`, which the stub rewrites as BASIC's
end-of-program pointer before it decrunches). The `-ffast` variant
reports 268 bytes and the `-fshort` variant 225, and `-fshort` widens the
low pair to `$2D` to `$30`. Decrunch time is in the cycle budget below; it
is a one-off cost at start, so it is not on the line.

### Why

Pucrunch is Pasi 'Albert' Ojala's LZ77 plus RLE cruncher, first published
in 1997. The compressor is a single C file (`pucrunch.c` with its
generated `pucrunch.h`) that builds with `cc` on any host; the source's
version string reads 1.14, dated 22 November 2008. The author's page says
that the compressor has been under the GNU LGPL since December 2005, and
that the decompression code is under the wxWindows Library Licence, which
lets the binary decruncher ship with the crunched data. That makes it one
of the few crunchers a shipped game can include without a licence question. The decruncher is small, sits in memory the KERNAL
does not need at start-up, and expands forwards, so a file crunched with
it can start as low as `$0258` and reach `$FFFF`. Exomizer is smaller on
output and, on the two inputs measured here, faster to decrunch as well;
the case for pucrunch is the licence, the C64-side footprint and the
one-file build, not the ratio.

Everything below marked "measured" was run on 2026-09-23 with pucrunch
1.14 built here (`cc -O2 -o pucrunch pucrunch.c -lm`, Apple clang 21,
macOS arm64; the `.h` must sit beside the `.c`) and Exomizer 3.1.3b0
built the night before, in the windowless x64sc build of VICE 3.10, PAL.

### How

The self-extracting form is the default. Give the machine and the PRG:

```text
pucrunch -c64 game.prg game-pu.prg           # default decruncher
pucrunch -c64 -ffast game.prg game-fast.prg  # a longer, faster decruncher
pucrunch -c64 -fshort game.prg game-tiny.prg # a shorter, slower one
pucrunch -c64 -fdelta game.prg game-dl.prg   # delta LZ77, helps ramps and tables
pucrunch -flist                              # every decruncher it can emit
```

The output is a PRG at `$0801` with a one-line BASIC stub (`SYS 2061` in
every run here) followed by the decruncher and the crunched stream. When
run, the stub copies the decruncher into the zero page from `$F7` upward, the
low part of the stack page and the system input buffer at `$0200`, moves
the crunched stream up in memory so that its last byte sits a computed
safety margin past the end of the original file, and expands the original
from its own load address upwards, back over the memory the stub and the
stream occupied. When it finishes it jumps to the execution address, which
it takes from the input file's own SYS line; `x<addr>` overrides it,
`l<addr>` overrides the load address, `i0` leaves interrupts off at the
jump and `g<val>` sets the `$01` bank configuration the program starts
under. `-fbasic` selects the decruncher meant for a BASIC program (not
run here).

The raw form has no stub. `-c0` writes a stand-alone stream with a short
header (18 bytes on the test file, load address and execution address
inside it) for a separately linked decruncher; `-d` marks the input as
headerless data with no load address, and `-c64 -d` still emits a C64
stub for it. The author's page publishes the decruncher source
(`uncrunch.asm`, DASM-style conditional assembly with switches for the
machine, the speed variant, delta and the wrap buffer), which is where a
raw-stream caller starts; the page places the decompression code under
the wxWindows licence. It is not reproduced here.

Two things the layout imposes. First, the span from `$00F7` to `$0258`
is the decruncher's during expansion: zero-page variables from `$F7` up,
the lower part of the stack page and the input buffer are overwritten,
so a pointer kept in `$FB` to `$FE` across the SYS comes back changed.
The stub also writes `$2D`/`$2E` (`$2D` to `$30` with `-fshort`) on its
way in, so state kept there is lost as well.
The author's page describes the stack use as the part BASIC is not using
at the time; whether a return to BASIC survives was not measured here.
Second, the original file's end plus the safety margin must fit below
`$10000`; when it does not, the compressor switches to a wrap-buffer
variant on its own, so a file that ends at `$FFFF` still crunches, and it
says which memory the result uses on every run, in the line beginning
`uses the memory`. Nothing below `$0258` can be the file's load address,
and pucrunch refuses such a file with a message saying so.

### Why it works

The stream mixes two codings. Run-length coding replaces a repeated byte
with a count and one byte; a ranked table of the most common run bytes,
built by the compressor and shrunk to the values actually used, lets the
frequent ones cost less. LZ77 replaces a string that already appeared in
the output with an offset back into it and a length. Anything neither
covers is a literal. The decruncher stays small because a literal carries
no flag bit of its own. Instead a few of its top
bits are compared with a running escape code; a literal that happens to
begin with the escape is written with an extra escape marker, and the
compressor picks the number of escape bits per file so that this happens
rarely (four bits on the test file, seven escaped literals). Lengths and
offsets are Elias gamma codes, short for small values. All three kinds
are decoded by one loop that writes forwards, which is why the stream can
be expanded in place from its original address up, with only a small
margin for the escaped literals.

### Variations

**The raw decruncher in your own loader.** For a level file the game
loads itself, crunch with `-c0` (or `-d` for data without a load
address), put the stream where the loader leaves it and call the raw
decruncher with the stream's address. The `$F7` to `$0258` span is then
the decruncher's for the duration, as above, so the loader's own zero
page must lie below `$F7` or be saved first. Not measured here: the raw
decruncher was not assembled in this run, because the shipped source is
DASM syntax and its licence forbids putting a copy on this page.

**Faster or smaller.** `-ffast` bought 16 % of decrunch time for 23
bytes on the mixed test file; `-fshort` saved 24 bytes and cost 20 % more
time. `-fdelta` halved the crunched size of the mixed file, whose ramp
and sine table it suits, and gained nothing on the code file.

**Comparison with Exomizer, measured.** Two subjects, both KickAssembler
PRGs at `$0801` with a SYS stub: a 4,519-byte file of code plus mixed
filler (a 1 KB zero run, a byte ramp, a sine table, repeated text), and a
4,231-byte file whose filler is 4 KB of KERNAL ROM copied in as data, so
that it looks like machine code. Each crunched PRG was run on its own to
a green border with the marker at `$02FF` set, then again under a small
loader that copied it to `$0801`, started a 32-bit CIA2 timer cascade and
jumped to the stub's SYS address; the subject reads the timer as its first
act. The figure is SYS to entry, decruncher setup included, and two runs
gave the same figure to the cycle (the loader alone measures 271 cycles
on the first subject and 228 on the second). One difference between the
rows: pucrunch's C64 stub runs under SEI from its first instruction, while
Exomizer's `sfx sys` stub reports interrupts enabled on entry, during and
on exit, and the loader has interrupts on when it jumps. Exomizer's
figures therefore include the KERNAL's IRQ service for the frames the
decrunch takes, and pucrunch's do not. That works against Exomizer, so
the ordering stands, but the two columns are not like for like.

| Cruncher | Mixed file: bytes | Mixed file: cycles | Code file: bytes | Code file: cycles |
|---|---|---|---|---|
| none | 4,519 | 271 | 4,231 | 228 |
| pucrunch default | 1,084 | 349,505 | 3,918 | 1,008,259 |
| pucrunch `-ffast` | 1,107 | 292,113 | 3,941 | 969,912 |
| pucrunch `-fshort` | 1,060 | 418,487 | 3,894 | 1,314,757 |
| pucrunch `-fdelta` | 598 | 253,598 | 3,919 | 1,024,326 |
| exomizer `sfx sys` | 1,103 | 189,276 | 3,772 | 590,882 |

Exomizer's stream was smaller on the code file and its decruncher faster
on both; pucrunch's default was 19 bytes smaller than Exomizer on the
mixed file. Per output byte that is about 77 cycles for pucrunch's
default and 42 for Exomizer on the mixed file, 238 and 140 on the code
file. A claim that pucrunch decrunches faster than Exomizer was not borne
out by either input here. Exomizer's own figures and its `-P` flag rules
are in `loaders-packers.md`, `exomizer_basics`.

**What the decruncher leaves behind.** After each sfx run the sixteen
bytes from `$0808` were printed: they matched the original file, BASIC
line terminator and padding included, for pucrunch's default and
`-fshort` decrunchers and for Exomizer. The host-side `pucrunch -u` on an
sfx file gave a file of the right length that differed from the input at
1,067 of its 4,519 byte positions, the first at offset 11; 1,063 of them
are a zero byte that came back as 1, the 1 KB zero run among them. `-u`
on the `-c0`
stream gave the input back byte for byte. The C64-side decruncher is the
one that matters, and it was checked only at the sixteen bytes above. Not
investigated further.

### Cycle budget

Measured, PAL, SYS to entry: 349,505 cycles (0.35 s) for 4,517 bytes of
mixed data and 1,008,259 cycles (1.02 s) for 4,229 bytes of code with the
default decruncher; `-ffast` 292,113 and 969,912. Code that crunches
badly is slow to decrunch as well as large, because most of its bytes go
through the literal path. Budget by the output's nature, not its size,
and measure a real level file before promising a load time.

### Recipes

- No recipe yet. The recipe verifier assembles a page's listing and runs
  the PRG; it has no step for running a cruncher on the result, so a page
  whose pin is a crunched program cannot be verified as the gate stands.

### Sources

- Pasi 'Albert' Ojala, "Pucrunch: An Optimizing Hybrid LZ77 RLE Data
  Compression Program" (the author's page, with `pucrunch.c`,
  `pucrunch.h` and `uncrunch.asm`), read for the memory layout, the
  escape scheme, the licence statements and the flag meanings:
  https://a1bert.kapsi.fi/Dev/pucrunch/
- `pucrunch.c` version string `pucrunch 1.14 22-Nov-2008`; usage text
  from `pucrunch -h` run here.

## zx0_lzsa_decrunchers — ZX0, Dali, ZX02 and LZSA: modern crunchers with tiny decrunchers

**Complexity:** low
**Region:** both
**Uses kernal:** (none)
**Requires:** ram_under_kernal
**Cost:** bytes_code=257, zp_bytes=236
**Cost basis:** arithmetic

The Cost line is Dali 0.3.5's standard self-extractor: 257 bytes of
copier and decruncher, worked as the sfx file's size less its two-byte
load address, its twelve-byte BASIC stub and the 770-byte stream the raw
mode writes for the same input (269 with the stub, which the pucrunch
section's 245 also leaves out), and the 236 bytes of zero page from `$01`
upward that the copier fills (the `LDY #$EC` in the stub's own bytes). Dali saves that zero page
on the stack and puts it back, so the figure is the space the decruncher
borrows, not what it destroys. The `--small` self-extractor is 210 bytes
and takes 183 bytes of zero page without saving them, and bitfire's own
ZX0 self-extractor is 263 bytes over 212 bytes of zero page, also without
saving. Decrunch times are in the cycle budget; they are a one-off cost at
start, so they are not on the line.

### Why

Exomizer and pucrunch trade decruncher size for ratio and speed. A newer
family of formats takes the other end of the trade: a decruncher of one
to two hundred bytes, a handful of zero-page bytes, a decrunch loop with
no tables to build, and a ratio that on the mixed test file below beats
both of the older tools. Four of them have C64 or generic 6502
decrunchers with a permissive licence, so a shipped game can carry the
decruncher without a licence question:

- **ZX0** by Einar Saukas, an optimal LZ77 cruncher whose repository
  holds the compressor and Z80 decrunchers, under the BSD 3-clause
  licence. It has no 6502 decruncher of its own; the README lists two
  6502 ports, one of them the copy inside bitfire.
- **Dali** by Tobias Bindhammer (Bitbreaker), a C64 tool that re-encodes
  ZX0 output into its own bit layout and writes a C64 self-extracting
  PRG. Its compressor is Emmanuel Marty's Salvador, which produces
  ZX0-compatible streams. The tarball's assembly sources carry a BSD
  3-clause header; Salvador's own licence file is zlib with a CC0 match
  finder. The `dali.c` file has no licence header of its own; a shipped
  product should take the assembly headers as the statement.
- **ZX02** by Daniel Serpell (DMSC), a ZX0 variant reworked for the 6502
  and not stream-compatible with ZX0, under the MIT licence. Its README
  names four 6502 decrunchers of 108 to 166 bytes, all using eight bytes
  of zero page.
- **LZSA1 and LZSA2** by Emmanuel Marty, a byte-aligned format designed
  for 8-bit decoders, under the zlib licence with a CC0 match finder.
  The repository carries six generic 6502 decrunchers; the faster v1 and
  v2 sources state their own sizes (165 and 191 bytes for LZSA1, 241 and
  256 for LZSA2) and their zero-page use (the last seven bytes of the
  zero page for v1, the last eleven for v2); the fast sources state
  neither, and the small v2 source uses one zero-page byte, `$FC`.

The C64 self-extractors measured here were built from bitfire (commit
`5a3964b`, 2026-09-10) and Dali 0.3.5 (the CSDb tarball). The 6502
decrunchers for ZX02 and LZSA were read, not assembled; they are written
for other assemblers, and their decrunch times were not measured here.

Everything below marked "measured" was run on 2026-09-23 in the
windowless x64sc build of VICE 3.10, PAL, with the same two inputs, the
same loader and the same method as the pucrunch section above.

### How

Each tool has a raw mode and, for two of them, a C64 self-extracting mode.
The commands as used here:

```text
zx0 game.bin game.zx0                       # ZX0 v2.2, raw stream, no load address
zx02 game.bin game.zx02                     # ZX02, raw stream
lzsa -f 1 -r game.bin game.lzsa1            # LZSA1 raw block
lzsa -f 2 -r game.bin game.lzsa2            # LZSA2 raw block
dali --sfx 0x0810 -o game-dali.prg game.prg # Dali C64 self-extractor, entry $0810
dali --sfx 0x0810 --small -o game-tiny.prg game.prg
dali -o game.dali game.prg                  # Dali raw stream for bitfire's decruncher
zx0 --sfx 0x0810 -o game-bf.prg game.prg    # bitfire's own ZX0 packer, same shape
```

ZX0, ZX02 and LZSA read a headerless file and write a headerless stream;
the caller's own decruncher knows where it goes. Dali and bitfire's
packer read a PRG, keep its load address as the decrunch target, and
report the original and packed spans on every run. Their `--sfx` takes
the entry address as a number after the flag; give it, or the flag eats
the next argument. Dali adds `--01` to set the processor port after
decrunching, `--cli` to leave with interrupts on (the default is off),
`--effect` for a border effect while it runs, `--no-inplace`,
`--binfile`, `--from`/`--to` for a slice, `--prefix-file` for a
dictionary already in memory, and `--relocate-sfx` for a stub without a
BASIC line. bitfire's packer shares `--sfx`, `--no-inplace`,
`--binfile`, `--from`/`--to` and the relocate flags, adds `-f` and `-q`,
and uses `--use-prefix` in place of the prefix-file options; it has no
`--01`, `--cli`, `--small` or `--effect`.

The self-extractor's layout, read from the two `sfx.asm` sources and
checked against the bytes of the output: a one-line BASIC stub (`SYS
2061` in every run here) followed by a copier, the decruncher and the
stream. When run, the copier moves the decruncher into the zero page, counting
down from `$EC` (Dali) or `$D4` (bitfire) to `$01`; the byte that lands
at `$01` is the processor port's new value, `$34`, which banks the ROMs
out so the whole 64 KB is writable. It then copies
the crunched stream to the top of memory, ending at `$FFFF` under the
KERNAL ROM, and decrunches forwards from the original load address,
which is why both files here landed with their own BASIC stub back at
`$0801` byte for byte. Dali's standard decruncher pushes the zero page
onto the stack before overwriting it and pops it back on exit, with `$37`
in the port unless `--01` says otherwise. Its `--small` decruncher and
bitfire's do not save anything: measured here, the subject's KERNAL
print path did not survive either. Under bitfire's self-extractor the
subject reached its green border but printed nothing, and its timer
bytes had to be read from memory with a monitor breakpoint; under Dali's
`--small` it never reached the border at all, in a stand-alone run and
under the loader alike. Which zero-page byte kills it was not traced;
the KERNAL's own variables live in the span both overwrite. Code that
follows a `--small` or bitfire decrunch must not call the KERNAL until it
has reset what it needs, or must be a program that owns the machine.

The raw decrunchers ask for less. bitfire's `dzx0` uses five zero-page
bytes at `$F8` to `$FC` and keeps its source pointer in its own operands;
its header warns that it reads the unmodified ZX0 stream only, not the
Dali one, which has its own `dzx0_dali.asm` with six bytes at `$F0`.
ZX02's four decrunchers take eight bytes from `$80` by default and are
ROM-able; the README names in-place decrunching with the compressor's
reported `delta` (at worst 12 bytes per KB) as the safety margin. LZSA's
small v1 decruncher keeps every pointer in self-modified operands and
uses no zero page at all as written; small v2 uses `$FC`. None of the
three formats carries a header that says which variant wrote it, so, as
with Exomizer's `-P` bits, a stream and its decruncher must come from the
same tool: ZX02 does not read ZX0, bitfire's decruncher does not read
Dali, and LZSA1 and LZSA2 are different formats.

### Why it works

All four are LZ77: the output is built from literal bytes and from copies
of what was already written, named by a distance back and a length. They
differ in how those are coded. ZX0 keeps three kinds of block, literal
run, match at the previous offset and match at a new offset, with lengths
and offsets in interleaved Elias gamma codes, and the compressor picks
the block sequence that is optimal for the whole file, which is where its
ratio comes from. ZX02 caps the gamma codes at eight bits, stores offsets
as positive values minus one and lets a match be one byte long, all so
that an 8-bit register holds every quantity the decoder handles; that
costs a little on long runs and gains on code. LZSA gives up the bit
stream altogether: each token is a byte whose fields hold a literal count
and a match length, with longer values in following bytes and the offset
as one or two whole bytes, so the decoder never shifts a bit reservoir.
LZSA2 adds nibble-sized fields and a repeat-offset match, which is why it
beats LZSA1 on both inputs below. Dali re-encodes ZX0's blocks into the
bit order bitfire's decruncher wants; the blocks themselves are ZX0's.

### Variations

**In-place decrunching.** Every tool here supports it. The stream is
placed so that its end sits a small margin past the end of the output,
and the decoder writes forwards without ever overtaking the input it has
not read. ZX0 and ZX02 print the margin as `delta` when they crunch
(3 bytes on the mixed file, 3 on the code file for ZX0); Dali and bitfire
assume it unless `--no-inplace` is given. The C64 self-extractors go one
further and copy the stream to the top of RAM first, so the caller need not
reserve the margin.

**Streaming from disk.** bitfire is a disk loader whose files are all
Dali-crunched, and it decrunches as sectors arrive; that path was not
run here and its figures are bitfire's, not this page's. LZSA's raw block
form and its stated small-decruncher sizes are the reason the format was
built for that use on other 8-bit machines.

**Comparison, measured.** The same two subjects and loader as the
pucrunch section: a 4,519-byte PRG of code plus mixed filler and a
4,231-byte PRG whose filler is 4 KB of KERNAL ROM bytes. Sizes for the
raw modes are the stream alone from a headerless input two bytes shorter;
Dali's raw mode reads the PRG and writes a PRG, so its row is the stream
after the two-byte load address it keeps (772 and 3,523 as files); sizes
for the sfx modes are the whole PRG. Cycles are SYS to entry with
the loader's own 271 or 228 cycles included, two runs each, identical to
the cycle. The pucrunch and Exomizer rows are quoted from the pucrunch
section above. One difference between the rows, as there: Dali's
self-extractor runs under SEI from its first instruction; so does
bitfire's.

| Cruncher | Mixed file: bytes | Mixed file: cycles | Code file: bytes | Code file: cycles |
|---|---|---|---|---|
| none | 4,519 | 271 | 4,231 | 228 |
| dali `--sfx` | 1,041 | 114,369 | 3,792 | 311,234 |
| dali `--sfx --small` | 982 | not measured here | 3,733 | not measured here |
| bitfire zx0 `--sfx` | 1,035 | 99,422 | 3,786 | 295,612 |
| zx0 v2.2 raw | 771 | not measured here | 3,522 | not measured here |
| dali raw (stream) | 770 | not measured here | 3,521 | not measured here |
| zx02 raw | 797 | not measured here | 3,522 | not measured here |
| lzsa1 raw | 785 | not measured here | 3,852 | not measured here |
| lzsa2 raw | 781 | not measured here | 3,682 | not measured here |
| pucrunch default (pucrunch section) | 1,084 | 349,505 | 3,918 | 1,008,259 |
| exomizer `sfx sys` (pucrunch section) | 1,103 | 189,276 | 3,772 | 590,882 |

Both ZX0 self-extractors are smaller than pucrunch's and Exomizer's on
the mixed file and decrunch it in a third of pucrunch's time and well
under Exomizer's; on the code file they are 20 bytes larger than
Exomizer's sfx and about half its time. Per output byte that is about
25 cycles for Dali and 22 for bitfire on the mixed file, 74 and 70 on the
code file. The `--small` variant saved 59 bytes of PRG; its time is not
on the table because the subject did not run to its entry under it.
Raw-mode times are not measured here: the ZX02 and LZSA 6502 sources are
written for other assemblers and were not ported for this run.

### Cycle budget

Measured, PAL, SYS to entry: 114,369 cycles (0.12 s) for 4,517 bytes of
mixed data and 311,234 cycles (0.32 s) for 4,229 bytes of code with
Dali's standard self-extractor; bitfire's 99,422 and 295,612. As with the
older tools, code that crunches badly costs more per byte to decrunch:
about three times as much per byte on both families, from a base a
third as high here. Measure a real level file before promising a load
time.

### Recipes

- No recipe yet. The recipe verifier assembles a page's listing and runs
  the PRG; it has no step for running a cruncher on the result, so a page
  whose pin is a crunched program cannot be verified as the gate stands.

### Sources

- Einar Saukas, ZX0 repository (`src/zx0.c` banner `ZX0 v2.2`, README's
  list of 6502 ports, `LICENSE`): https://github.com/einar-saukas/ZX0
- Tobias Bindhammer, bitfire repository, `packer/zx0/` (`zx0.c` usage,
  `sfx.asm`, `6502/dzx0_v2.asm`, `LICENSE`): https://github.com/bboxy/bitfire
- Tobias Bindhammer, Dali 0.3.5 (`dali035.tar.gz` from CSDb release
  247483: `dali.c` usage, `sfx.asm`, `dzx0_dali.asm`, `Makefile`,
  `salvador/README.md` and licence files): https://csdb.dk/release/?id=247483
- Daniel Serpell, ZX02 repository (README's decruncher list and format
  notes, `6502/zx02-small.asm` and `zx02-optim.asm` headers, `LICENSE`):
  https://github.com/dmsc/zx02
- Emmanuel Marty, LZSA repository (`src/lzsa.c` version string 1.4.1,
  README's licence section, `asm/6502/` headers): https://github.com/emmanuel-marty/lzsa
- Usage text from each tool run here without arguments.
