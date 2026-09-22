---
category: banking
---

<!-- doc-type: pitfall-reference -->

# Memory Banking Pitfalls

The C64 has three independent banking layers: $01 selects which ROMs the CPU
reads, $DD00 selects which 16 KB window VIC uses, and $D018 positions assets
within that window. Each layer has its own addressing logic, reset defaults, and
failure mode. The pitfalls here cover the most costly traps: the char ROM
invisible to the CPU under I/O mapping, the VIC 16 KB constraint that silently
invalidates all asset pointers when you move data between banks, the
read/write asymmetry that makes RAM under BASIC or KERNAL appear to vanish, and
the high-level-language trap where a growing code section silently runs into a
hardcoded charset/bitmap blit address.

---

## charset_under_io_invisible_to_cpu — Char ROM readable from CPU only when I/O is swapped out

**Severity:** medium
**Region:** both
**Triggered by registers:** D018, DD00
**Triggered by techniques:** char_rom_under_vic, cpu_io_port_bank

### Symptom

Code that tries to copy the built-in C64 character font from $D000-$D7FF reads
back all zeros or garbage bytes. The first 2 KB of the copy contains corrupted
data despite a loop that looks correct. The same loop copies fine from any other
address in the $0000-$CFFF range. On some rigs the bytes are not zero but shift
by one byte per iteration, suggesting a read from the SID or VIC shadow registers
instead of font data.

### Mechanism

The $D000-$DFFF range is what hardware engineers call a "multiplexed window." At
any given moment it can contain one of three things:

1. The I/O devices: VIC-II registers ($D000-$D3FF), SID ($D400-$D7FF), Color
   RAM ($D800-$DBFF), CIA #1 ($DC00-$DCFF), CIA #2 ($DD00-$DDFF), and cartridge
   expansion I/O ($DE00-$DFFF).
2. The 4 KB character ROM, containing the two built-in C64 fonts.
3. The underlying 4 KB of DRAM, when both ROM and I/O are banked out.

Which of those three wins is determined by bits 0-2 of the CPU I/O port at $0001.
Bit 2 = CHAREN: when set (default $37), I/O wins. When clear and at least HIRAM
or LORAM is set, character ROM wins. When CHAREN=0 and both LORAM=0 and HIRAM=0,
RAM wins. $01 = $33 (CHAREN=0, HIRAM=1, LORAM=1) is the canonical value for
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
banking bits. In VIC banks 0 and 2, the PLA automatically redirects VIC's
character generator fetches to the char ROM at the appropriate offset ($1000-$1FFF
in bank 0, $9000-$9FFF in bank 2) regardless of $01. This is why the default
screen works correctly out of reset — VIC reads the char ROM via its own path
while the CPU cannot see it at all.

The second trap is interrupt safety. While $01 = $33, I/O is invisible: a raster
IRQ that fires will try to acknowledge via $D019 but that address now reads char
ROM, not the VIC. The acknowledge is lost and the system hangs. Always SEI before
swapping I/O out.

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

    // Primary font: $D000-$D7FF (2048 bytes)
    ldx #0
copy_lo:
    lda $d000, x    // Now reads char ROM glyph data
    sta $2000, x    // Store into custom RAM charset location
    inx
    bne copy_lo

    ldx #0
copy_hi:
    lda $d100, x    // Handles the high 256 bytes of the first 512 bytes
    sta $2100, x    // (loop runs 8 times total for all 256 chars × 8 rows)
    inx
    bne copy_hi

    // Restore I/O layout
    lda $01
    and #%11111000      // Preserve cassette bits
    ora #%00000111      // $37: CHAREN=1, HIRAM=1, LORAM=1 → I/O visible again
    sta $01
    cli                 // IRQs safe to re-enable now
    rts
```

For a full 2 KB copy (256 characters × 8 rows per character) spanning $D000-$D7FF,
use two 256-byte loops as shown, or a 16-bit loop with pointer arithmetic if
using Oscar64's C compiler rather than raw KickAssembler.

### Cross-references

- Register `01` — CPU I/O port; bits 0-2 = LORAM/HIRAM/CHAREN.
- Register `D018` — VIC video matrix and charset base; independent of CPU char ROM visibility.
- Register `DD00` — CIA2 port A; selects the VIC 16 KB bank.
- Technique `char_rom_under_vic` — char ROM shadow in VIC banks 0 and 2.
- Technique `cpu_io_port_bank` — all seven CPU memory configurations.

---

## vic_bank_visibility_collision — VIC's 16 KB window invalidates all asset pointers simultaneously

**Severity:** high
**Region:** both
**Triggered by registers:** DD00, D018
**Triggered by techniques:** vic_bank_select, char_rom_under_vic, screen_ram_relocation

### Symptom

Sprites that display correctly in one VIC bank become invisible or show corrupt
graphics when the VIC bank is changed. The screen fills with garbage characters
or goes black. Moving a sprite's shape data to a new RAM location produces no
visible change, while the old — now incorrect — graphics continue to appear.
Setting up a bitmap in bank 1 while leaving the screen matrix in bank 0 produces
a garbled display that looks nothing like the intended bitmap. Setting sprite
pointer values ($07F8-$07FF or their equivalent in the current screen RAM) to
seemingly correct offsets results in the wrong sprite image appearing.

All of these symptoms share the same root cause: a mismatch between the 16 KB
window VIC is looking through and the actual RAM location of the assets it is
supposed to fetch.

### Mechanism

The VIC-II chip has a 14-bit address bus. It cannot independently access all
64 KB of the C64's RAM — it can only see 16,384 bytes at a time. CIA2 port A
bits 0-1 (register $DD00) act as the upper two bits of VIC's address, selecting
which 16 KB "bank" the VIC sees:

| $DD00 bits 1-0 | VIC bank | CPU address range | Notes                         |
|----------------|----------|-------------------|-------------------------------|
| 11 (default)   | 0        | $0000-$3FFF       | Default boot bank             |
| 10             | 1        | $4000-$7FFF       | No char ROM shadow here       |
| 01             | 2        | $8000-$BFFF       | Char ROM shadow at $9000      |
| 00             | 3        | $C000-$FFFF       | No char ROM shadow here       |

The bit patterns are inverted: `11` selects bank 0, `00` selects bank 3. This
inversion comes from inverting buffers between CIA2 PA0-PA1 and VIC's VA14-VA15
lines on the motherboard. Writing the raw bank number directly to $DD00 selects
the wrong bank — always invert and mask.

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

The most common collision scenario: a developer moves asset data to bank 1 for
more RAM, writes $DD00 to select bank 1, but leaves the screen matrix at $0400
and sprite pointers at $07F8-$07FF. VIC now reads its screen data from $4400
(bank 1 offset $0400), not $0400. Everything that was working in bank 0 is now
reading from a completely different area of RAM that may be uninitialized.

A subtler variant: screen matrix moved to bank 1 correctly, but sprite shape data
left in bank 0. Sprite pointer N × 64 now addresses bank 1 RAM at $4000 + N×64,
not the bank 0 shapes.

Bank 2 adds a char ROM shadow at VIC-relative $1000-$1FFF ($9000-$9FFF in CPU
view). Placing a custom charset there means VIC reads ROM instead. Banks 1 and 3
have no char ROM shadow and are preferred for fully custom graphics.

### Fix

Keep all VIC-readable assets (screen matrix, charset/bitmap, sprite shapes) in
the same 16 KB bank. For custom layouts prefer bank 1 ($4000-$7FFF) — no char
ROM shadow. When switching:

1. Pick the VIC bank; use bank 1 or 3 for custom graphics (no char ROM shadow).
2. Write $DD00: `lda $DD00 / and #$FC / ora #<inverted_bank_bits> / sta $DD00`.
   Inverted codes: bank 0 = %11, bank 1 = %10, bank 2 = %01, bank 3 = %00.
3. Set $D018: hi-nibble = screen_offset / $0400; lo-nibble = charset_offset / $0800.
4. Compute sprite pointer bytes: `ptr = (shape_addr - bank_base) / 64`.
   Store at `screen_base + $03F8` through `+ $03FF`.
5. Make bank changes during vertical blank to avoid mid-frame tears.

### Worked example

```kick
// Target layout: VIC bank 1 ($4000-$7FFF)
//   Screen RAM at $4400 → D018 hi-nibble = %0001
//   Charset at $4800    → D018 lo-nibble = %0100
//   Sprite 0 at $4FC0   → sprite ptr = ($4FC0-$4000)/64 = 63 = $3F
//   Sprite pointer table at screen_base + $03F8 = $47F8

// ─── BAD: changed DD00 but forgot to move screen and sprite data ──────────────
    lda $dd00
    and #%11111100
    ora #%00000010      // Bank 1 selected (inverted: %10 = bank 1)
    sta $dd00
    // $D018 hi-nibble still %0001 → VIC reads screen from $4400 (uninitialized)
    // Sprite pointers still at $07F8 (bank 0) → VIC reads ptrs from $43F8 (garbage)

// ─── GOOD: full bank-1 layout ────────────────────────────────────────────────
setup_bank1:
    lda $dd00
    and #%11111100
    ora #%00000010      // Bank 1: inverted bits = %10
    sta $dd00

    lda #%00010100      // hi=%0001 → screen at $4400; lo=%0100 → charset at $4800
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
**Triggered by techniques:** cpu_io_port_bank, ram_under_kernal

### Symptom

Code or data written to $A000-$BFFF or $E000-$FFFF appears to vanish. A store
loop runs without error, but reading back the same addresses returns the original
BASIC or KERNAL ROM contents rather than the stored data. Self-modifying code
placed at $E000 seems to have no effect. A sprite shape table written to $A000
reads back as floating-point math routines. Checksumming RAM that was just written
with known values returns the KERNAL ROM checksum instead.

The converse symptom also occurs: a developer banks ROM out with $01 = $35 to
reclaim RAM at $E000-$FFFF and then is surprised that the memory was already
populated — because a previous write through the ROM window succeeded silently
and the bytes were waiting in RAM all along.

### Mechanism

The PLA enforces an asymmetric rule: reads honour the banking state (ROM wins
when banked in), but writes always reach the underlying DRAM regardless. The ROM
chips' output enables are deasserted during write cycles by design. This means:

```kick
// $01 = $37 — BASIC ROM at $A000
lda #$42
sta $a000       // Byte stored in DRAM at $A000 — the write succeeds
lda $a000       // Returns BASIC ROM content, not $42 — the ROM wins the read
```

| Range         | ROM content   | Bank-out bit         | Safe $01 value |
|---------------|---------------|----------------------|----------------|
| $A000-$BFFF   | BASIC (8 KB)  | LORAM (bit 0) = 0    | $36 or $34     |
| $D000-$DFFF   | Char ROM (4K) | CHAREN (bit 2) = 0   | $33            |
| $E000-$FFFF   | KERNAL (8 KB) | HIRAM (bit 1) = 0    | $35 or $34     |

Banking KERNAL out moves the CPU's interrupt vectors ($FFFA-$FFFF) from ROM to
the RAM underneath. Pre-write custom IRQ/NMI addresses to those RAM locations
while KERNAL is still visible (writes go to RAM), then SEI and switch.

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

- Register `01` — the CPU I/O port; bits 0-2 are LORAM, HIRAM, CHAREN; the
  read-modify-write pattern for bits 3-5 (datasette lines) must be preserved.
- Technique `cpu_io_port_bank` — the full table of all seven CPU memory
  configurations, including the exact $01 values for each combination of banked
  ROMs. The technique doc has the full discussion of the PLA's write-transparency
  behavior and the interrupt-vector pre-write requirement.
- Technique `ram_under_kernal` — specifically covers using $E000-$FFFF as RAM,
  the custom interrupt vector setup, and cycle budget implications of losing the
  KERNAL IRQ chain.

---

## charset_blit_overruns_grown_code — A hardcoded charset/bitmap address collides with a code section that grew into it

**Severity:** high
**Region:** both
**Triggered by registers:** D018

### Symptom

A C64 program built with a high-level toolchain (Oscar64, cc65) boots, runs its
init, then crashes — often back to the BASIC `READY.` prompt — after a code
change that only touched logic far from the boot path. The init runs far enough
to set early globals (a sentinel byte you poll reads as initialised), but the
main loop never starts. Adding *more* unrelated code makes the crash appear or
worsen; reverting a few hundred bytes of code makes it vanish. The crash is
sensitive to total program size, not to the content of the change.

### Mechanism

C compilers place code and read-only data contiguously from the load address
upward; the linker grows the code/data image toward higher addresses as you add
functions and string literals. Custom-graphics C64 programs frequently blit a
charset to a *hardcoded* VIC address (commonly `$3000` or `$3800` in bank 0) and
sprite/bitmap data to other fixed addresses, deliberately time-sharing those
addresses with const data (e.g. a title bitmap that was already copied elsewhere
at startup). This works only while an **implicit invariant** holds: the code
section ends *below* the lowest hardcoded blit address.

Nothing enforces that invariant. The compiler does not know `$3000` is special —
it is just a literal pointer in a `memcpy`. When the code section grows past the
blit address, the runtime blit (e.g. `init_charset()` writing 2 KB of glyph data
to `$3000`) overwrites *live executable code* with charset bytes. Execution
survives until the CPU calls a function that now lives in the clobbered range and
runs glyph data as instructions — typically a `JAM`/`BRK` storm or a stray `RTS`
that unwinds into the KERNAL warm-start, i.e. `READY.`.

`$D018` is the register that makes the blit address load-bearing: its low nibble
selects the charset/bitmap offset within the VIC bank, so the asset *must* live
at that fixed 2 KB-aligned (charset) or 8 KB-aligned (bitmap) address — it cannot
simply be relocated to wherever the linker has free space.

### Fix

1. **Diagnose with the linker map.** Oscar64 emits a `.MAP` on every build; its
   region list shows `DATA, code : <start> - <end>`. Compare the code-section end
   against every hardcoded blit address. If `code_end > charset_addr`, that is the
   bug. (cc65: read the map's segment list the same way.)
2. **Move the blit targets to the top of the bank**, above the projected code
   ceiling: put the charset at the highest 2 KB-aligned slot in the bank (bank 0
   → `$3800`) and any sprite/extra data just below it at the right alignment.
   Update the asset pointer register write — with Oscar64's `vic_setmode(mode,
   screen, charset)` this is automatic; in assembly recompute `$D018` and the
   sprite-pointer bytes by hand.
3. **Document the surviving invariant** ("code must end below `$3780`") next to
   the address constants, because step 2 only raises the ceiling — it does not
   remove it. The durable cure is to move the graphics to a VIC bank that does
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
// vic_setmode(VICM_TEXT, SCREEN, CHARSET) → $D018 = $1F (screen $0400, charset $3800)
```

### Cross-references

- Register `D018` — VMCSB; high nibble = screen offset, low nibble bits 1-3 =
  charset offset (× $0800), bit 3 = bitmap offset (× $2000). Forces graphics
  assets to fixed bank-relative addresses.
- Pitfall `vic_bank_visibility_collision` — the other half of the layout story:
  once assets are correctly placed, they must all share one 16 KB VIC bank.
- Toolchain `oscar64-reference` — the `.MAP` "objects by size" / region list is
  the primary diagnostic for an over-large image; Oscar64 places BSS/heap/stack
  above the code+data image, so a growing image walks toward fixed asset
  addresses with no build-time warning.
