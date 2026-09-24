---
category: banking
---

<!-- doc-type: pitfall-reference -->

# Memory Banking Pitfalls

The C64 has three independent banking layers: $01 selects which ROMs the CPU
reads, $DD00 selects which 16 KB window VIC uses, and $D018 positions assets
within that window. Each layer has its own addressing logic, reset defaults, and
failure mode. The pitfalls here: the char ROM invisible to the CPU under I/O
mapping; the VIC 16 KB window, which invalidates all asset pointers when data
moves between banks; the read/write asymmetry that makes RAM under BASIC or
KERNAL appear to vanish; and a high-level-language build whose growing code
section runs into a hardcoded charset/bitmap blit address.

---

## charset_under_io_invisible_to_cpu — Char ROM readable from CPU only when I/O is swapped out

**Severity:** medium
**Region:** both
**Triggered by techniques:** char_rom_under_vic, cpu_io_port_bank, big_font_2x2, charset_copy_rom_to_ram

### Symptom

Code that tries to copy the built-in C64 character font from $D000-$D7FF reads
back all zeros or garbage bytes. The first 2 KB of the copy contains corrupted
data despite a loop that looks correct. The same loop copies fine from any other
address in the $0000-$CFFF range. With $01 = $37 the loop is reading I/O: the
VIC-II registers, repeated every 64 bytes through $D000-$D3FF, and the SID,
repeated every 32 bytes through $D400-$D7FF (`hardware/vic-ii-reference.md`,
`hardware/sid-reference.md`). (An earlier version said that on some rigs the
bytes shift by one per iteration, "suggesting" SID or VIC shadow registers;
nothing supported that.)

### Mechanism

The $D000-$DFFF range holds one of three things at any moment:

1. The I/O devices: VIC-II registers ($D000-$D3FF), SID ($D400-$D7FF), Color
   RAM ($D800-$DBFF), CIA #1 ($DC00-$DCFF), CIA #2 ($DD00-$DDFF), and cartridge
   expansion I/O ($DE00-$DFFF).
2. The 4 KB character ROM, containing the two built-in C64 fonts.
3. The underlying 4 KB of DRAM, when both ROM and I/O are banked out.

Which of those three wins is determined by bits 0-2 of the CPU I/O port at $0001.
When LORAM=0 and HIRAM=0, RAM wins whatever CHAREN holds ($30 and $34, as the
table below measures). Otherwise bit 2 = CHAREN picks: set (default $37), I/O
wins; clear, character ROM wins. (An earlier version said CHAREN set always gives
I/O, which is false for $34.) $01 = $33 (CHAREN=0, HIRAM=1, LORAM=1) is the canonical value for
reading the char ROM from the CPU.

The C64 resets with $01 = $37. With CHAREN = 1, reading $D000 returns a VIC-II
register byte, not font data.

The character ROM never appears to the CPU unless CHAREN (bit 2 of $01) is
cleared AND at least one of HIRAM (bit 1) or LORAM (bit 0) is set. The
combination $01 = $33 (binary 00110011) satisfies this: CHAREN=0, HIRAM=1,
LORAM=1. In that state the character ROM is readable at $D000-$DFFF by the CPU,
and the default BASIC + KERNAL ROMs remain banked in at $A000-$BFFF and
$E000-$FFFF respectively.

The VIC-II is not subject to this constraint. VIC has its own separate hardware
pathway to the character ROM, routed through the PLA independently of the CPU
banking bits. In VIC banks 0 and 2, the PLA redirects VIC's
character generator fetches to the char ROM ($1000-$1FFF
in bank 0, $9000-$9FFF in bank 2) regardless of $01. This is why the default
screen works out of reset: VIC reads the char ROM through its own path
while the CPU cannot see it.

The second trap is interrupt safety. While $01 = $33, I/O is invisible: any IRQ
that fires (the KERNAL's own 60 Hz CIA-1 timer interrupt as much as a raster
IRQ) cannot acknowledge its source. The KERNAL handler's LDA $DC0D
at $EA7E reads character ROM instead of the CIA, and a raster handler's write to
$D019 lands in the RAM under the ROM instead of the VIC. The flag stays set,
/IRQ stays low, the handler re-enters after every RTI and the main program never
runs another instruction (measured in VICE x64sc: with $01 = $33, no raster IRQ
configured and a counting $0314 handler, 28,695 handler passes and 0 main-loop
iterations in 20M cycles, against 1,028 passes and 31,183 iterations with
$01 = $37). An earlier version of this paragraph blamed only a raster IRQ's
$D019 acknowledge, which read as if SEI were optional without one; it is not.
Always SEI before swapping I/O out.

### Fix

SEI before swapping I/O out. Always read-modify-write $01 to preserve bits 3-5
(datasette motor/write/sense). Pattern: SEI → read $01 → mask bits 0-2 → OR $03
($33 result) → write → copy $D000-$D7FF → read $01 → mask bits 0-2 → OR $07
($37 result) → write → CLI. The DDR at $0000 is $2F after KERNAL init; bits 0-2
are already outputs, so no DDR change is needed.

### Worked example

```kick
// Destination: RAM at $2000 (example: custom charset location)
// Source: built-in font from char ROM at $D000-$D7FF (2 KB)
//
// ─── BAD: reads VIC registers, not char ROM ──────────────────────────────────
bad_copy:
    // $01 is $37 at this point — I/O is mapped. Reading $D000 gives
    // VIC register 0 (sprite 0 X position), not font data.
    ldx #0
!:  lda $d000, x    // Returns VIC/SID register byte, not font pixel!
    sta $2000, x
    inx
    bne !-           // All 256 bytes are I/O register garbage

// ─── GOOD: temporarily bank char ROM into $D000-$DFFF for the CPU ────────────
copy_charset_from_rom:
    sei                 // Disable IRQs — I/O is about to disappear
    lda $01
    and #%11111000      // Preserve bits 3-5 (cassette lines), clear bits 0-2
    ora #%00000011      // $33: CHAREN=0, HIRAM=1, LORAM=1 → char ROM visible
    sta $01

    // Primary font: $D000-$D7FF = eight 256-byte pages (256 chars × 8 bytes)
    ldx #0
copy_page:
    lda $d000, x    // Now reads char ROM glyph data
    sta $2000, x    // Store into custom RAM charset location
    lda $d100, x
    sta $2100, x
    lda $d200, x
    sta $2200, x
    lda $d300, x
    sta $2300, x
    lda $d400, x
    sta $2400, x
    lda $d500, x
    sta $2500, x
    lda $d600, x
    sta $2600, x
    lda $d700, x
    sta $2700, x
    inx
    bne copy_page

    // Restore I/O layout
    lda $01
    and #%11111000      // Preserve cassette bits
    ora #%00000111      // $37: CHAREN=1, HIRAM=1, LORAM=1 → I/O visible again
    sta $01
    cli                 // IRQs safe to re-enable now
    rts
```

A full copy of the primary font is 2 KB (256 characters × 8 bytes = eight
256-byte pages, $D000-$D7FF), which is why the loop above has eight load/store
pairs; a single-page or two-page loop copies only the first 32 or 64 characters.
An earlier version of this listing had two pages and claimed to copy the whole
font; it moved 512 bytes, and the remaining 1,536 were never copied (measured in
VICE x64sc: 174 mismatches against char ROM in $2200-$27FF; the eight-pair loop
leaves $2000-$27FF byte-identical). In Oscar64 or cc65, a 16-bit pointer loop
over 2048 bytes does the same job.

### Cross-references

- Memory region [$0000-$0001 — Processor I/O port](../hardware/c64-memory-map.md#0000-0001--processor-io-port) — bits 0-2 = LORAM/HIRAM/CHAREN; resolvable via `c64_memory_map 0001`, not `c64_register_lookup` (the KB has no Register node for the CPU port).
- Register `D018` — VIC video matrix and charset base; independent of CPU char ROM visibility.
- Register `DD00` — CIA2 port A; selects the VIC 16 KB bank.
- Technique `char_rom_under_vic` — char ROM shadow in VIC banks 0 and 2.
- Technique `cpu_io_port_bank` — all seven CPU memory configurations.

---

## vic_bank_visibility_collision — VIC's 16 KB window invalidates all asset pointers simultaneously

**Severity:** high
**Region:** both
**Triggered by registers:** DD00, D018
**Triggered by techniques:** vic_bank_select, char_rom_under_vic, screen_ram_relocation, screen_double_buffer_d018, bitmap_relocation, standard_bitmap, multicolor_bitmap, koala_format, fli_image, afli_image, ifli_image, mci_interlace_bitmap, charset_animation, big_font_2x2, dycp_scroller, sprite_cache_flip, sprite_animation_table, wireframe_pipeline, eight_way_scroll_double_buffer, hires_plot, bresenham_line, solid_vector_3d

### Symptom

Sprites that display correctly in one VIC bank become invisible or show corrupt
graphics when the VIC bank is changed. The screen fills with garbage characters
or goes black. Moving a sprite's shape data to a new RAM location produces no
visible change, while the old graphics continue to appear.
Setting up a bitmap in bank 1 while leaving the screen matrix in bank 0 produces
a garbled display that looks nothing like the intended bitmap. Setting sprite
pointer values ($07F8-$07FF or their equivalent in the current screen RAM) to
seemingly correct offsets results in the wrong sprite image appearing.

All of these have one cause: the 16 KB window VIC reads through does not
contain the RAM the assets are in.

### Mechanism

The VIC-II chip has a 14-bit address bus. It sees 16,384 bytes at a time, not
all 64 KB of the C64's RAM. CIA2 port A
bits 0-1 (register $DD00) act as the upper two bits of VIC's address, selecting
which 16 KB bank the VIC sees:

| $DD00 bits 1-0 | VIC bank | CPU address range | Notes                         |
|----------------|----------|-------------------|-------------------------------|
| 11 (default)   | 0        | $0000-$3FFF       | Default boot bank             |
| 10             | 1        | $4000-$7FFF       | No char ROM shadow here       |
| 01             | 2        | $8000-$BFFF       | Char ROM shadow at $9000      |
| 00             | 3        | $C000-$FFFF       | No char ROM shadow here       |

The bit patterns are inverted: `11` selects bank 0, `00` selects bank 3. This
inversion comes from inverting buffers between CIA2 PA0-PA1 and VIC's VA14-VA15
lines on the motherboard. Writing the raw bank number directly to $DD00 selects
the wrong bank; invert and mask.

Within its current 16 KB window, VIC interprets every pointer as a bank-relative
offset, not an absolute address. Every VIC data structure is affected at once:

- **Screen matrix (video matrix):** The high nibble of $D018 selects which 1 KB
  block within the VIC bank holds the screen character codes. A value of `%0001`
  means offset $0400, which is $0000+$0400 in bank 0 (absolute $0400), or
  $4000+$0400 in bank 1 (absolute $4400), and so on.

- **Character generator / bitmap base:** The low nibble of $D018 selects which
  2 KB block within the VIC bank holds the character font or bitmap data (in
  text mode) or the high bit of the low nibble selects the 8 KB bitmap base
  (in bitmap mode). These offsets are bank-relative.

- **Sprite data pointers:** Each of the 8 sprite pointer bytes at the end of
  the screen matrix (at screen_base + $03F8 through screen_base + $03FF, i.e.
  $07F8-$07FF in the default bank-0 layout) contains an index into VIC's bank
  in 64-byte blocks. Sprite pointer 0 = $07F8; the value N means the sprite
  shape data starts at (vic_bank_base + N × 64).

The common collision: a developer moves asset data to bank 1 for
more RAM, writes $DD00 to select bank 1, but leaves the screen matrix at $0400
and sprite pointers at $07F8-$07FF. VIC now reads its screen data from $4400
(bank 1 offset $0400), not $0400. Everything that was working in bank 0 is now
reading from a different area of RAM that may be uninitialized.

A subtler variant: screen matrix moved to bank 1 correctly, but sprite shape data
left in bank 0. Sprite pointer N × 64 now addresses bank 1 RAM at $4000 + N×64,
not the bank 0 shapes.

Bank 2 adds a char ROM shadow at VIC-relative $1000-$1FFF ($9000-$9FFF in CPU
view). Placing a custom charset there means VIC reads ROM instead. Banks 1 and 3
have no char ROM shadow and are preferred for fully custom graphics.

### Fix

Keep all VIC-readable assets (screen matrix, charset/bitmap, sprite shapes) in
the same 16 KB bank. For custom layouts prefer bank 1 ($4000-$7FFF), which has no char
ROM shadow. When switching:

1. Pick the VIC bank; use bank 1 or 3 for custom graphics (no char ROM shadow).
2. Write $DD00: `lda $DD00 / and #$FC / ora #<inverted_bank_bits> / sta $DD00`.
   Inverted codes: bank 0 = %11, bank 1 = %10, bank 2 = %01, bank 3 = %00.
3. Set $D018: hi-nibble = screen_offset / $0400; low nibble =
   (charset_offset / $0800) << 1; the 3-bit charset field occupies bits 1-3 and
   bit 0 is unused (reads as 1). In bitmap mode only bit 3 matters:
   (bitmap_offset / $2000) << 3. An earlier version of this step omitted the
   shift, which for the example below yields $D018 = $11 and a charset fetched
   from bank offset $0000, not $0800.
4. Compute sprite pointer bytes: `ptr = (shape_addr - bank_base) / 64`.
   Store at `screen_base + $03F8` through `+ $03FF`.
5. Make bank changes during vertical blank to avoid mid-frame tears.

### Worked example

```kick
// Target layout: VIC bank 1 ($4000-$7FFF)
//   Screen RAM at $4400 → D018 hi-nibble = %0001
//   Charset at $4800    → D018 lo-nibble = %0010 (offset $0800 / $0800 = 1, << 1)
//   Sprite 0 at $4FC0   → sprite ptr = ($4FC0-$4000)/64 = 63 = $3F
//   Sprite pointer table at screen_base + $03F8 = $47F8

// ─── BAD: changed DD00 but forgot to move screen and sprite data ──────────────
    lda $dd00
    and #%11111100
    ora #%00000010      // Bank 1 selected (inverted: %10 = bank 1)
    sta $dd00
    // $D018 hi-nibble still %0001 → VIC reads screen from $4400 (uninitialized)
    // Sprite pointers still written at $07F8 (bank 0) → VIC reads ptrs from $47F8 (garbage)

// ─── GOOD: full bank-1 layout ────────────────────────────────────────────────
setup_bank1:
    lda $dd00
    and #%11111100
    ora #%00000010      // Bank 1: inverted bits = %10
    sta $dd00

    lda #%00010010      // hi=%0001 → screen at $4400; lo=%0010 → charset at $4800
                        // ($12 — an earlier version wrote $14, which selects
                        // bank offset $1000 = $5000, verified in VICE)
    sta $d018

    // Clear screen RAM at $4400
    lda #$20
    ldx #0
!:  sta $4400, x
    sta $4500, x
    sta $4600, x
    sta $4700, x
    inx
    bne !-

    // Sprite 0 pointer: $4FC0 is 63 blocks of 64 bytes into bank 1
    lda #$3f
    sta $47f8           // Sprite ptr table lives at screen_base($4400)+$03F8

    lda #%00000001
    sta $d015           // Enable sprite 0
    rts
```

### Cross-references

- Register `DD00` — CIA2 port A; bits 0-1 select VIC bank (inverted encoding).
- Register `D018` — video matrix and char base; nibble values are bank-relative.
- Technique `vic_bank_select` — bank selection mechanism and inverting buffer.
- Technique `char_rom_under_vic` — char ROM shadow in VIC banks 0 and 2.
- Technique `screen_ram_relocation` — $D018 hi-nibble address calculations.

---

## ram_under_rom_traps — Writes go to RAM under ROM; reads return ROM bytes

**Severity:** medium
**Region:** both
**Triggered by techniques:** cpu_io_port_bank, ram_under_kernal, bitmap_relocation, speedcode_generation, irq_owns_processor_port, cartridge_save, cartridge_bank_easyflash, basic_rom_float_calls

### Symptom

Code or data written to $A000-$BFFF or $E000-$FFFF appears to vanish. A store
loop runs without error, but reading back the same addresses returns the original
BASIC or KERNAL ROM contents rather than the stored data. Self-modifying code
placed at $E000 seems to have no effect. A sprite shape table written to $A000
reads back as floating-point math routines. Checksumming RAM that was just written
with known values returns the KERNAL ROM checksum instead.

The converse symptom also occurs: a developer banks ROM out with $01 = $35 to
reclaim RAM at $E000-$FFFF and finds the memory already populated: an earlier
write through the ROM window reached RAM, and the bytes were there all along.

### Mechanism

The PLA enforces an asymmetric rule: reads honour the banking state (ROM wins
when banked in), but a write to a ROM-mapped range reaches the underlying DRAM:
$A000-$BFFF and $E000-$FFFF whatever $01 says, and $D000-$DFFF while character
ROM is mapped there (CHAREN = 0 with LORAM or HIRAM set, e.g. $33). It is NOT
true of $D000-$DFFF while I/O is mapped ($35/$36/$37): there the write lands in
the VIC/SID/CIA/colour-RAM register and the RAM beneath is untouched (measured in
VICE x64sc: RAM under $D000 seeded $A5 at $34, $2D written at $37 read back $2D
(the sprite-0 X register), and the RAM still read $A5 once I/O was banked out; the
same write at $A000 and $E000 landed in RAM). An earlier version of this
paragraph said writes reach RAM "regardless" of the banking state, which is
false for the I/O window. To put data under I/O, bank it out first ($34, or $33
if char ROM is acceptable) with interrupts disabled. See
techniques/memory-banking.md and hardware/c64-memory-map.md, which record the
same measurement. This means:

```kick
// $01 = $37 — BASIC ROM at $A000
lda #$42
sta $a000       // Byte stored in DRAM at $A000 — the write succeeds
lda $a000       // Returns BASIC ROM content, not $42 — the ROM wins the read
```

| Range         | ROM content   | Bank-out bit         | Safe $01 value |
|---------------|---------------|----------------------|----------------|
| $A000-$BFFF   | BASIC (8 KB)  | LORAM (bit 0) = 0    | $36 or $34     |
| $D000-$DFFF   | I/O (default), or char ROM when CHAREN=0 | LORAM=0 AND HIRAM=0 (CHAREN then ignored) | $30 or $34 |
| $E000-$FFFF   | KERNAL (8 KB) | HIRAM (bit 1) = 0    | $35 or $34     |

$33 is the value for READING the char ROM at $D000 (see above), not for reaching
the RAM under it; an earlier version of this table listed $33 on the $D000 row,
which banks the char ROM *in* (measured in VICE x64sc: $D000 under $31/$32/$33
reads $3C, glyph '@' row 0; RAM seeded $A5 under $D000 is seen only at $30 and
$34). $30/$34 also bank out KERNAL, BASIC and all I/O, so SEI first and touch no
VIC/SID/CIA register until $01 is restored. The write asymmetry in this section
applies to the ROM windows only: with I/O banked in ($35-$37) a write to
$D000-$DFFF goes to the I/O chip, not to the RAM beneath; with the char ROM
banked in ($31-$33) the write does reach RAM.

Banking KERNAL out moves the CPU's interrupt vectors ($FFFA-$FFFF) from ROM to
the RAM underneath. Pre-write custom IRQ/NMI addresses to those RAM locations
while KERNAL is still visible (writes go to RAM), then SEI and switch.

Cartridge ROM at $8000-$BFFF (ROML and ROMH) is a fourth ROM-mapped range with
the same asymmetry: while a cartridge maps it, a write lands in the RAM beneath
and a read returns the cartridge byte (recorded under `cartridge_bank_easyflash`
in techniques/memory-banking.md; not re-measured here).

### Fix

BASIC zone: SEI → `lda $01 / and #%11111000 / ora #%00000110 / sta $01` ($36:
BASIC out, I/O + KERNAL remain) → access $A000-$BFFF → restore $01 → CLI.

KERNAL zone: Write IRQ/NMI vectors to $FFFE/$FFFA while KERNAL is banked in
(the writes reach RAM). Then SEI → `$01 = ($01 & %11111000) | %00000101` ($35)
→ access $E000-$FFFF → restore or stay in $35 for a permanent KERNAL replacement.

### Worked example

```kick
// Demonstrate the read/write asymmetry at $A000, then fix it.

// ─── BAD: write to $A000 while BASIC ROM is banked in ────────────────────────
bad_ram_write:
    // $01 = $37 (default). BASIC ROM visible at $A000-$BFFF.
    lda #$42
    sta $a000       // Write: lands in RAM under BASIC. Byte stored.
    lda $a000       // Read: returns BASIC ROM byte ($94 = STY, the first
                    // byte of the BASIC cold-start vector table) — NOT $42!
    // Accumulator contains BASIC ROM content, not $42. Surprise.

// ─── GOOD: bank BASIC out before reading ─────────────────────────────────────
safe_ram_under_basic:
    sei
    lda #$42
    sta $a000           // Write lands in RAM regardless

    lda $01
    and #%11111000
    ora #%00000110      // $36: LORAM=0 — BASIC banked out, I/O + KERNAL remain
    sta $01

    lda $a000           // Now reads RAM: returns $42
    // ... use $A000-$BFFF freely ...

    lda $01
    and #%11111000
    ora #%00000111      // $37: restore BASIC
    sta $01
    cli
    rts

// ─── Permanent KERNAL replacement ────────────────────────────────────────────
install_custom_kernal:
    sei
    // Write IRQ/NMI vectors to RAM while KERNAL ROM is still visible.
    // The ROM is write-transparent — bytes land in the RAM underneath.
    lda #<custom_irq
    sta $fffe
    lda #>custom_irq
    sta $ffff
    lda #<custom_nmi
    sta $fffa
    lda #>custom_nmi
    sta $fffb

    lda $01
    and #%11111000
    ora #%00000101      // $35: HIRAM=0 — KERNAL banked out, RAM vectors now live
    sta $01
    cli
    rts

custom_irq:
    pha
    lda #$ff
    sta $d019           // Ack all VIC interrupt sources
    pla
    rti

custom_nmi:
    rti                 // Suppress RESTORE key NMI
```

### Cross-references

- Memory region [$0000-$0001 — Processor I/O port](../hardware/c64-memory-map.md#0000-0001--processor-io-port) — bits 0-2 are LORAM, HIRAM, CHAREN; the
  read-modify-write pattern for bits 3-5 (datasette lines) must be preserved.
  Resolvable via `c64_memory_map 0001`, not `c64_register_lookup` (the KB has no
  Register node for the CPU port).
- Technique `cpu_io_port_bank` — the full table of all seven CPU memory
  configurations, including the exact $01 values for each combination of banked
  ROMs. The technique doc has the full discussion of the PLA's write-transparency
  behavior and the interrupt-vector pre-write requirement.
- Technique `ram_under_kernal` — covers using $E000-$FFFF as RAM,
  the custom interrupt vector setup, and cycle budget implications of losing the
  KERNAL IRQ chain.

---

## charset_blit_overruns_grown_code — A hardcoded charset/bitmap address collides with a code section that grew into it

**Severity:** high
**Region:** both
**Triggered by registers:** D018
**Triggered by techniques:** screen_double_buffer_d018, bitmap_relocation, speedcode_generation, charset_animation, big_font_2x2, dycp_scroller, char_bullets, charset_parallax, destructible_char_terrain, hires_plot
**Mitigated by techniques:** memory_layout_plan

### Symptom

A C64 program built with a high-level toolchain (Oscar64, cc65) boots, runs its
init, then crashes (often back to the BASIC `READY.` prompt) after a code
change that only touched logic far from the boot path. The init runs far enough
to set early globals (a polled sentinel byte reads as initialised), but the
main loop never starts. Adding *more* unrelated code makes the crash appear or
worsen; reverting a few hundred bytes of code makes it vanish. The crash is
sensitive to total program size, not to the content of the change.

### Mechanism

C compilers place code and read-only data contiguously from the load address
upward; the linker grows the code/data image toward higher addresses as
functions and string literals are added. Custom-graphics C64 programs frequently blit a
charset to a *hardcoded* VIC address (commonly `$3000` or `$3800` in bank 0) and
sprite/bitmap data to other fixed addresses, deliberately time-sharing those
addresses with const data (e.g. a title bitmap that was already copied elsewhere
at startup). This works only while an **implicit invariant** holds: the code
section ends *below* the lowest hardcoded blit address.

Nothing enforces that invariant. The compiler does not know `$3000` is special;
it is a literal pointer in a `memcpy`. When the code section grows past the
blit address, the runtime blit (e.g. `init_charset()` writing 2 KB of glyph data
to `$3000`) overwrites *live executable code* with charset bytes. Execution
survives until the CPU calls a function that now lives in the clobbered range and
runs glyph data as instructions: typically a `JAM`/`BRK` storm or a stray `RTS`
that unwinds into the KERNAL warm-start, i.e. `READY.`.

`$D018` is the register that pins the blit address: its low nibble
selects the charset/bitmap offset within the VIC bank, so the asset *must* live
at that fixed 2 KB-aligned (charset) or 8 KB-aligned (bitmap) address; it cannot
be relocated to wherever the linker has free space.

### Fix

1. **Diagnose with the linker map.** Oscar64 emits a `.MAP` on every build; its
   `sections` list shows `<start> - <end> : DATA, code` (address range first,
   then the name; an earlier version of this step had the order reversed, so a
   grep for `DATA, code :` finds nothing). Compare the code-section end
   against every hardcoded blit address. If `code_end > charset_addr`, that is the
   bug. (cc65: read the map's segment list the same way.)
2. **Move the blit targets to the top of the bank**, above the projected code
   ceiling: put the charset at the highest 2 KB-aligned slot in the bank (bank 0
   → `$3800`) and any sprite/extra data just below it at the right alignment.
   Update the asset pointer register write. With Oscar64's `vic_setmode(mode,
   screen, charset)` this is automatic; in assembly recompute `$D018` and the
   sprite-pointer bytes by hand.
3. **Document the surviving invariant** ("code must end below `$3780`") next to
   the address constants, because step 2 only raises the ceiling; it does not
   remove it. The lasting fix is to move the graphics to a VIC bank that does
   not overlap the program image at all, or to shrink the time-shared const.

### Worked example

```c
// BAD: charset hardcoded at $3000. Works until the code section grows past it,
// after which init_charset() overwrites live code at $3000+ → crash to READY.
#define CHARSET ((unsigned char *)0x3000u)
// .MAP after a feature lands:  0880 - 3050 : DATA, code   ← code end $3050 > $3000

// GOOD: charset at the top 2KB of bank 0; sprite just below; vic_setmode
// recomputes $D018. Invariant becomes "code must end below $3780".
#define CHARSET             ((unsigned char *)0x3800u)   // $3800-$3FFF
#define SELSPRITE_DATA_ADDR 0x3780u                      // 64-byte aligned
#define SELSPRITE_PTR_VALUE 0xdeu                        // $3780 / 64
// vic_setmode(VICM_TEXT, SCREEN, CHARSET) → writes $D018 = $1E (screen $0400, charset $3800;
// reads back as $1F because bit 0 always reads 1)
```

### Cross-references

- Register `D018` — VMCSB; high nibble = screen offset, low nibble bits 1-3 =
  charset offset (× $0800), bit 3 = bitmap offset (× $2000). Forces graphics
  assets to fixed bank-relative addresses.
- Pitfall `vic_bank_visibility_collision` — the other layout constraint:
  once assets are correctly placed, they must all share one 16 KB VIC bank.
- Toolchain `oscar64-reference` — the `.MAP` "objects by size" / region list is
  the diagnostic for an over-large image; Oscar64 places BSS/heap/stack
  above the code+data image, so a growing image walks toward fixed asset
  addresses with no build-time warning.

---

## irq_during_charen_window — An interrupt taken while the char ROM covers I/O can never acknowledge itself

**Severity:** high
**Region:** both
**Triggered by registers:** DC0D, D019
**Triggered by techniques:** charset_copy_rom_to_ram, char_rom_under_vic, cpu_io_port_bank, irq_owns_processor_port

### Symptom

The program stops somewhere inside a character ROM copy, or just
after one. No crash to `READY.`, no garbage, no border flash: the
screen stays as it was. If the copy was meant to be followed by a
`$D018` write, the font never changes. A machine in this state does not
respond to keys, and on a real C64 RUN/STOP-RESTORE may or may not get
it back, depending on what the NMI handler touches.

### Mechanism

With `$01` = `$33` the `$D000-$DFFF` window is the character ROM. An
interrupt that arrives in that state runs a handler written for the
normal map. The KERNAL IRQ handler ends with `LDA $DC0D` to clear CIA1's
interrupt flag; a raster handler writes `$D019` to clear the VIC's. Both
now address font bytes. The read does not reach the CIA, the write goes
to the RAM under the ROM, and the source's flag stays set. `/IRQ`
stays low, `RTI` restores a clear I flag, the CPU takes the interrupt
again on the next instruction boundary, and the copy loop between
those instruction boundaries gets nothing. Everything the handler does
before the failed acknowledge also happens against the wrong chip: the
KERNAL keyboard scan writes its column selects into RAM and reads its
row byte from the ROM, and decodes whatever glyph row that is as keys.

Measured in VICE x64sc 3.10 (`charset-copy-rom-to-ram` recipe, PAL): a
4 KB copy started with interrupts enabled ran 30 of 256 loop iterations
before the KERNAL IRQ fell due, then the handler ran 26 times in the
61,000 cycles a watchdog allowed and the loop counter never moved; one
byte was in the keyboard buffer afterwards. NTSC: 7 iterations, 27
handler passes, one key. Both runs reproduce byte for byte. The
iteration count depends only on where in the timer period the copy
began (CIA1 timer A is latched with `$4025` on PAL, `$4295` on NTSC,
from the KERNAL image; about 16,400 and 17,000 cycles), so a copy that
happens to start just after a tick can get through several thousand
bytes and still hang.

`charset_under_io_invisible_to_cpu` on this page has the other half of
this trap and a longer run of the same hang; that pitfall is about
reading the wrong bytes when `$01` is left at `$37`, this one is about
what happens when `$01` is set right and interrupts are left on.

### Fix

`SEI` before the `$01` write that maps the ROM; `CLI` after the write
that restores I/O. Nothing in between may enable interrupts, which
rules out KERNAL calls (`kernal_assumes_sei_cleared`). If a raster IRQ
is live and the copy is long, stop it rather than defer it: clear
`$D01A` bit 0 and acknowledge `$D019` before the switch, restart after.
A program that has to take an interrupt while the ROM is mapped (rare;
a sample player, say) needs a handler that restores `$37` as its first
instruction and puts `$33` back before `RTI`, and that handler must be
in RAM or KERNAL, never under `$D000`.

The recipe's watchdog is a debugging aid, not a fix: a CIA2 timer NMI
that restores `$37`, acknowledges both CIAs and unwinds the stack turns
the silent hang into a reported failure while the copy is being
developed.

### Worked example

```kick
// BAD: the ROM is mapped and the KERNAL IRQ is still armed.
    lda $01
    and #$f8
    ora #$03
    sta $01             // char ROM at $D000
    ldx #0
!:  lda $d000, x        // ~30 iterations later on PAL the IRQ fires,
    sta $3000, x        // LDA $DC0D reads a font byte, and the handler
    inx                 // re-enters for ever
    bne !-

// GOOD: no interrupt can run while I/O is out of the map.
    sei
    lda $01
    and #$f8
    ora #$03
    sta $01
    ldx #0
!:  lda $d000, x
    sta $3000, x
    inx
    bne !-
    lda $01
    and #$f8
    ora #$07
    sta $01             // I/O back
    cli                 // the deferred IRQ runs now, and acknowledges
```

### Cross-references

- Technique `charset_copy_rom_to_ram`: the copy done safely, timed, and done once unsafely under a watchdog.
- Technique `cpu_io_port_bank`: the `$01` values and the bits to preserve.
- Technique `char_rom_under_vic`: where the VIC sees the ROM without any copy.
- Pitfall `charset_under_io_invisible_to_cpu`: the copy made with I/O still mapped.
- Pitfall `kernal_assumes_sei_cleared` (kernal-and-io.md): why a KERNAL call inside the window would defeat the `SEI`.
- Register `DC0D`: CIA1 interrupt control; the acknowledge the KERNAL handler cannot make.
- Register `D019`: VIC interrupt flags; the acknowledge a raster handler cannot make.
- Recipe `recipes/kickassembler/charset-copy-rom-to-ram.md`.

---

## decruncher_overwrites_kernal_zero_page — A self-extractor that runs from the zero page leaves the KERNAL's variables full of decruncher code

**Severity:** high
**Region:** both
**Triggered by kernal:** CHROUT
**Triggered by techniques:** zx0_lzsa_decrunchers, pucrunch_decruncher, doynax_decruncher, zero_page_burst, byteboozer_packer
**Mitigated by techniques:** cpu_io_port_bank

### Symptom

A program that runs from its own PRG stops working the moment it is
wrapped in a self-extracting cruncher. Nothing is reported. The two shapes
measured here, on a payload that prints one line through `CHROUT` and
then sets a byte:

- Under Dali 0.3.5 `--sfx --small`, the payload is entered and never
  comes back from its first `JSR $FFD2`. No text, no later store, the
  border colour it sets afterwards never appears.
- Under bitfire's `zx0 --sfx`, every `CHROUT` call returns, the later
  store happens and the border changes, but the line is not on the
  screen. The eleven screen codes were found at `$4CC7`, an address in
  otherwise unused RAM well above the payload (which ends at `$1433`):
  it is the two decruncher bytes left in the editor's
  line pointer `$D1/$D2` (`$4CBA`) plus its column `$D3` (`$0D`).

The same payload crunched with Dali's standard `--sfx` and with pucrunch
`-c64` printed its line where the uncrunched build did.

### Mechanism

The zero page is the cheapest place to put a decruncher: zero-page
addressing saves a byte and a cycle on every operand, `(zp),Y` and
`(zp,X)` take their pointer only from it (an earlier version called
`(zp),Y` the only indirect mode; `(zp,X)` and `JMP (abs)` are the others), and the page is free of anything the
decruncher itself needs. Dali's and bitfire's self-extractors both copy
their decruncher into it from the top of the copy down to `$01`, and the
byte that lands at `$01` banks every ROM out so the whole 64 KB can be a
decrunch target: `$34` under Dali `--small`, `$38` under bitfire, both
with LORAM and HIRAM (bits 0 and 1) clear, which gives RAM at $D000
whatever bit 2 holds (measured with a store trace on `$0001`; neither
stub writes the port again during the decrunch). An earlier version said
bits 0 to 2 were clear in both; `$34` has bit 2 set. The stream is moved to the top of
memory under the KERNAL and decrunched forwards from the payload's load
address. The page they overwrite is where the KERNAL and BASIC keep
their state.

Measured in the windowless x64sc build of VICE 3.10, PAL, 2026-09-23. A
tracepoint at the payload's entry (`SYS 2061`, `$080D`) dumped `$0000`
to `$00FF`, and each dump was compared with the same dump from the
uncrunched payload. The stopwatch at entry was 2,970,597 cycles for the
plain build and 3,032,679 to 3,180,431 for the four crunched builds, so
each decrunch cost under a quarter of a second of emulated time.

| Build | Zero-page bytes changed at entry | `$01` | `$9A` | Printed |
|---|---|---|---|---|
| uncrunched | 0 | `$37` | `$03` | yes |
| Dali `--sfx` | 20 | `$37` | `$03` | yes |
| pucrunch `-c64` | 16 | `$37` | `$03` | yes |
| Dali `--sfx --small` | 178 (`$01` to `$B7`) | `$34` | `$02` | no |
| bitfire `zx0 --sfx` | 201 (`$02` to `$D4`) | `$37` | `$A6` | no |

The two failures have different fatal bytes:

- **Dali `--small`** leaves `$01` at `$34`. `JSR $FFD2` then executes
  the last bytes of the crunched stream, which the stub parked under
  the KERNAL. Putting `$37` back is not enough on its own: measured,
  the payload still hung. The byte that hangs it is `$9A`, the default
  output device (DFLTO), which the decruncher code left at `$02`.
  `CHROUT` reads `$9A` before it does anything else, and `2` is the
  RS-232 device. Traced: `CHROUT` hands the byte to the RS-232 output
  routine, which stores it through the unopened output buffer pointer
  at `$F9/$FA` (zero on a clean boot, so the byte lands in `$0000`),
  starts CIA2's timer and enables its NMI; the NMI handler at `$FE47`
  then re-enters about every 75 cycles, the stack pointer falls six
  bytes per entry, and the payload never runs again. It is not a wait
  loop: the routine's buffer check at `$F017` ran once. Restoring `$01` and `$9A` (and `$99`)
  and nothing else made the payload print on the
  original screen, at the row `RUN` left the cursor on.
- **bitfire** hands over with the KERNAL mapped: the last thing its
  zero-page decruncher does before the jump is `DEC $01`, thirteen
  cycles before entry, which turns its `$38` into `$37` (measured at
  the store, not read from its source; Dali `--small` leaves `$34`
  there). It leaves `$9A` at `$A6`, so
  `CHROUT` treats the output as a serial-bus device and returns after
  the bus times out. That is why its calls come back. With `$9A` put
  back to `3`, the calls reach the screen editor, and the text still
  does not appear: the editor's line pointer `$D1/$D2` (PNT) reads
  `$4CBA` and its column `$D3` reads `$0D`, so the characters go to
  `$4CC7`. `$C7`, the reverse-video flag, reads `$85`, so once the
  pointer is right the line comes out in reverse video. Three of the
  KERNAL's variables are wrong in three different ways, and the list
  stops there only because the payload calls nothing else.

The two stubs that pass also change the zero page, but not bytes the
print path reads. Dali's standard stub pushes the zero page onto the
stack before the copy and pops it back before the jump; it entered the
payload with the stack pointer at `$FF`, ten bytes of its own exit code
still at `$E3` to `$EC` (in the screen line link table), and BASIC's
pointers at `$2D` to `$32`, `$39/$3A` and `$AE/$AF` rewritten, none of
which the print path reads. Pucrunch's decruncher sits at `$F7` to `$FF`
and leaves those nine bytes changed, plus the same BASIC pointers; the
KERNAL's own variables are below `$F7` and the RS-232 pointers at `$F7`
to `$FA` are idle. Pucrunch is still on the Triggered-by line for those nine
unsaved bytes: `$F7` to `$FA` are the RS-232 buffer
pointers, `$FB` to `$FE` the free zero page a payload may already be
using, `$FF` BASIC's float-to-ASCII workspace, and `$2D/$2E` BASIC's
end-of-program pointer, so a payload that expects any of them to hold
what they held before the stub ran meets the same mechanism on fewer
bytes; this payload did not. The Doynax self-extractor copies its depacker to
`$00C2` and up (its technique entry says so); whether it saves what it
covers was not measured here.

### Fix

One of three, in order of cost:

1. **Choose a stub that saves.** Dali's standard `--sfx` and pucrunch's
   default decruncher both let a KERNAL-calling payload run unchanged
   here. The `--small` flag bought 59 bytes of file on this payload and cost
   the machine state; take it only for a payload that owns the machine.
2. **Re-initialise in the payload's prologue.** Before the first KERNAL
   call: write `$37` to `$01` (`cpu_io_port_bank`), then `JSR $FF84`
   (IOINIT) and `JSR $FF81` (CINT). CINT resets the screen editor's
   pointers, sets `$9A` back to the screen and `$99` to the keyboard,
   and clears the screen; it does not clear `$C7`, so store zero there
   as well. Measured: the payload printed its line at row 0 under both
   failing stubs. A payload that must keep the screen contents restores
   the specific bytes instead: for Dali `--small` that was `$01` and
   `$9A`; for bitfire it was `$9A`, `$C7`, `$D3` and `$D1/$D2`.
   Measured: a build that stored `3` to `$9A`, `0` to `$C7` and `$D3`
   and `$0518` to `$D1/$D2`, and nothing else, printed its line on row
   7 in normal video under bitfire. `$99` was left as the decruncher
   left it and `$D4`, the quote-mode flag, stayed at `$08`; plain
   letters were unaffected, though a payload that prints colour or
   cursor codes would see them as reversed glyphs under that flag (the
   editor's quote-mode rule, not measured here). The line pointer is
   `$0400` plus 40 times the row, and CINT rebuilds it if the screen
   contents do not matter.
3. **Keep the payload's own zero-page use above the stub's span.** The
   stub's copy runs down to `$01`, so nothing of the payload's survives
   below `$B8` (Dali `--small`) or `$D5` (bitfire); values the payload
   needs at start must be in its body, not in the zero page it was
   crunched with.

A program that sets up its own interrupts, screen and I/O and never
returns to BASIC needs none of this, which is why the `--small` stub
exists.

### Worked example

The good prologue was measured with and without the `$C7` store: with
it the line reads normally under both stubs; without it, under bitfire,
row 0 is eleven reverse-video glyphs.

```kick
// BAD: the payload's first act is a KERNAL call. Under a stub that
// decrunches from the zero page, $01 may be $34 and $9A is whatever
// opcode the decruncher left there. Measured: hangs (Dali --small)
// or prints to $4CC7 (bitfire).
entry_bad:
    ldx #$00
bad_loop:
    lda msg, x
    beq bad_done
    jsr $ffd2
    inx
    bne bad_loop
bad_done:
    rts

// GOOD: bank the KERNAL in, re-initialise I/O and the screen editor,
// clear the one flag CINT leaves alone. Measured: prints under both.
entry_good:
    lda #$37
    sta $01             // KERNAL, BASIC and I/O back in the map
    jsr $ff84           // IOINIT: CIAs, timers, $01 direction bits
    jsr $ff81           // CINT: editor pointers, $99/$9A, clears screen
    lda #$00
    sta $c7             // reverse-video flag is not CINT's to clear
    ldx #$00
good_loop:
    lda msg, x
    beq good_done
    jsr $ffd2
    inx
    bne good_loop
good_done:
    rts

msg:
    .text "DECRUNCH OK"
    .byte $0d, $00
```

The diff that names the bytes, from the bitfire run (address, value in
the uncrunched build, value at entry after decrunch; the lines the print
path reads, out of 201 that changed):

```text
01: 37 > 37   port: $38 during the decrunch, DEC $01 before the jump; $34 under Dali --small
99: 00 > 00   DFLTN   untouched
9a: 03 > a6   DFLTO   output device is now "serial device $A6"
c7: 00 > 85   RVS     reverse video on
d1: 18 > ba   PNT lo  screen line pointer was $0518 (row 7), now $4CBA
d2: 05 > 4c   PNT hi
d3: 00 > 0d   column 13
d4: 00 > 08   quote-mode flag set
```

### Cross-references

- Technique `zx0_lzsa_decrunchers`: the stubs' layout, the copy loop's span (`$EC` and `$D4` down to `$01`) and the measured footprints.
- Technique `pucrunch_decruncher`: a decruncher that sits at `$F7` and up and leaves the KERNAL's variables alone.
- Technique `doynax_decruncher` (loaders-packers.md): a depacker at `$00C2` and up; its saving behaviour is not measured here.
- Technique `cpu_io_port_bank`: the `$01` values; `$34` is the all-RAM map the stubs decrunch under.
- Technique `memory_layout_plan`: where the payload's own zero-page claims should be written down, so the stub's span is checked against them.
- Pitfall `ram_under_rom_traps`: the other consequence of a `$01` left at `$34`, reads that return RAM where ROM was expected.
- Hardware `c64-memory-map.md`: `$0099`/`$009A` (DFLTN/DFLTO), `$00C7`, `$00D1`-`$00D4`.

---

## cartridge_bank_switch_under_executing_pc — A bank or mode write executed from the window it switches

**Severity:** high
**Region:** both
**Triggered by techniques:** cartridge_bank_easyflash

`$DE00` and `$DE02` are not Register nodes in this knowledge base (the
hardware pages carry `$DE00-$DEFF` as a memory region, not as registers),
so this entry anchors on the technique alone.

### Symptom

An EasyFlash program goes wrong at its first bank switch. Code runs to
the `STA $DE00` and then crashes, or runs a routine nobody called, or leaves
the screen and border colours the previous bank's code would never have chosen. The same routine works when the test
build copies it to RAM and runs it there, and fails again the moment it is
run from the cartridge. The store itself is
fine: a monitor confirms the bank register took the value.

The mode-register form is worse. A `STA $DE02` written in bank 0 HIROM at
`$E000` (where the cartridge boots, in Ultimax mode) swaps the KERNAL ROM in
under the program counter, and the CPU runs the KERNAL's floating-point
code from wherever the PC happened to be.

### Mechanism

The 6510 does not know a bank switch happened. `STA $DE00` is four cycles:
opcode, operand low, operand high, write. The cartridge latches the new bank
number on the write, which is the instruction's last cycle, so the store
always completes and the accumulator keeps its value. The next cycle is
the next opcode fetch, at the next address, and if that address is inside
`$8000-$9FFF` (or `$A000-$BFFF` in 16 KB mode) the fetch is served by the
NEW bank. Whatever bytes the new bank holds at that offset are executed as
code. Nothing is skipped and nothing is delayed by an instruction: the
switch lands on the first fetch after the write.

Measured in VICE x64sc 3.10 (windowless build, PAL and NTSC, same bytes in
both) with a two-bank type `$0020` EasyFlash `.crt`. Bank 0 LOROM at `$8000`
held `LDX #0 / LDA #1 / STA $DE00 / LDA #$41 / STA $0400 / STA $0401 / STX $0402 / INC $D020`.
Bank 1 LOROM held `$FF` bytes up to `$8006` and, at `$8007`, `LDX #$42 /
STX $0400 / STA $0401 / STX $0402 / LDA #6 / STA $D020`. The monitor trace
(`trace exec 8000 8020`, which prints the bytes actually fetched):

```text
.C:8004  8D 00 DE    STA $DE00      - A:01 X:00    cycle 193
.C:8007  A2 42       LDX #$42       - A:01 X:00    cycle 197   <- bank 1's bytes
.C:8009  8E 00 04    STX $0400      - A:01 X:42    cycle 199
```

The store began at cycle 193, wrote on cycle 196 (arithmetic, four-cycle
STA), and the opcode fetched at cycle 197 was `$A2`, bank 1's byte, not the
`$A9` that bank 0 holds at `$8007`. Final memory, from `m 0400 0403` and
`m d020 d020` on the last store:

```text
run                          $0400 $0401 $0402   $D020        border in the screenshot
BAD: switch from $8004         42    01    42     F6 (blue)   (44, 61, 236)
CONTROL: STA $DE00 with #0     41    41    00     FF (grey)   (205, 205, 205)
FIX: sequence run from $0200   41    41    00     FF (grey)   (205, 205, 205)
FIX: bank 1 identical here     41    41    00     FF (grey)   (205, 205, 205)
```

`$0400` never reads `$41` in the bad build: the `LDA #$41` that follows the
store in bank 0 was never fetched. `$0401` reads `$01`, the accumulator as
the STA left it, so the write itself was whole. The control build writes
bank 0 back into `$DE00` and reads `$41`, `$41`, `$00`, which is the same
instruction stream with the same store and no switch, so the fault is the
switch and not the store. (`$D020` reads with its upper nibble set, `$F6`
for blue and `$FF` for `$0F`, light grey.)

The mode write was measured the same way. Bank 0 HIROM at `$E022` ran
`LDA #$07 / STA $DE02 / LDA #$41 / STA $0400 / INC $D020` from Ultimax mode:

```text
.C:e024  8D 02 DE    STA $DE02      - A:07 X:00    cycle 52
.C:e027  10 F5       BPL $E01E      - A:07 X:00    cycle 56    <- KERNAL's bytes
.C:e026  CA          DEX
.C:e029  A5 56       LDA $56
.C:e02d  20 53 B8    JSR $B853
```

The bytes fetched from `$E027` onwards (`10 F5 ... A5 56 85 70 20 53 B8`)
are the KERNAL ROM's (901227-03, offsets `$0027-$002F`), not the
cartridge's. `$0400` stayed `$00` and the border stayed light blue: nothing
after the store in HIROM ever ran.

The fault is therefore in the bytes at the ADDRESS AFTER the
store. Two things make it safe: the code after the store lives in RAM, which
no bank register touches; or every bank that can be selected carries the
same bytes at that address, so it does not matter which one serves the
fetch. The fix build that made bank 1 a byte-for-byte copy of bank 0 at the
switch site read `$41` like the RAM build, and its trace shows `A9 41` at
`$8007` served by bank 1.

### Fix

Run the switch from RAM. Copy a stub of `LDA #bank / STA $DE00 / JMP entry`
to a page the cartridge does not map (`$0200`, or the `$DF00` cartridge RAM
if the program already uses it), jump to the stub, and let it jump into the
new bank at an address the new bank guarantees is code. Do the same for
`$DE02`: the EasyFlash start-up stub in the recipe copies its main code to
RAM before it writes `$07`, for this reason.

If the switch must stay in ROM, put the switch routine at the same offset in
every bank, byte for byte, in the linker or the assembler's segment layout,
and check that claim with a byte compare of the built `.crt` rather than by
reading the source. A common shape is a small shared trampoline in the top
page of LOROM present in all banks.

Never put the store at the end of a routine and rely on the `RTS` after it:
the `RTS` is fetched from the new bank too. The same holds for a subroutine
in RAM that switches banks and returns to a caller in ROM: the return
address is in the old bank's code, and the new bank's bytes are there now
(not measured here; it follows from the fetch order above).

### Worked example

```kick
// BAD: the switch runs from the LOROM it switches. Measured: after the
// STA the next opcode fetch, at switch_from_rom+5, already comes from
// bank 1, and the LDA #$41 below is never executed.
switch_from_rom:
    lda #$01
    sta $de00           // latches bank 1 on this instruction's last cycle
    lda #$41            // bank 1's byte at this address runs instead
    sta $0400
    rts

// GOOD: copy the switch and the entry jump to RAM and run them there.
// Measured: $0400 reads $41 with the same two banks in the cartridge.
switch_from_ram:
    ldx #$00
copy_stub:
    lda stub, x
    sta $0200, x
    inx
    cpx #stub_end - stub
    bne copy_stub
    jmp $0200
stub:
    .pseudopc $0200 {
    lda #$01
    sta $de00           // fetched from RAM: what $8000 shows no longer matters
    jmp $8000           // an address that is code in bank 1
    }
stub_end:
```

The other fix is layout: identical bytes at the switch site in every bank,
checked in the built `.crt`.

### Cross-references

- Technique `cartridge_bank_easyflash` (techniques/memory-banking.md): the
  bank and mode registers, the Ultimax boot, and its Cycle budget section,
  which states this hazard; the measurement here is the one that section
  did not have.
- Recipe `recipes/kickassembler/easyflash-save.md`: a boot stub that copies
  its main code to `$0800` before writing `$DE02`, and a two-bank `.crt`
  emitted from one listing (the rig above was built the same way).
- Technique `cartridge_save` (techniques/file-io.md): keeps its flash
  writing code in RAM below `$1000` because Ultimax mode maps nothing else,
  which also keeps it clear of this pitfall; it is not on the Triggered-by
  line because its text never switches banks from cartridge code.
- Pitfall `ram_under_rom_traps`: the other direction of the same PLA rule,
  a write that reaches the RAM under `$8000-$BFFF` while a read returns the
  cartridge byte.
