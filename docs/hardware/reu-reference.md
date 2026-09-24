---
chip: REU
---

# REU Register Reference

## Overview

The Commodore RAM Expansion Units (1700 with 128 KB, 1764 with 256 KB,
1750 with 512 KB) sit in the expansion port. Their controller, the REC,
answers in I/O-2: eleven registers at `$DF00-$DF0A`. It copies between
C64 memory and REU memory by DMA, halting the CPU while it runs.

Every register fact below was read from VICE 3.10's `src/c64/cart/reu.c`
(the emulator this repo verifies with; not a real REU). Where a fact was
also measured, the line says so and names
[`kickassembler/reu-dma`](../recipes/kickassembler/reu-dma.md), which ran
in VICE x64sc 3.10 with `-reu -reusize 512`. The device, its VICE flags
and the I/O page it claims are in
[devices.md](devices.md#reu-1750-512-kb).

VICE decodes the 32 bytes `$DF00-$DF1F` and mirrors them through `$DFFF`.
`$DF0B-$DF1F` read `$FF` and ignore writes. The REU decodes nothing in
`$DE00-$DEFF`. With no REU attached, `$DF00-$DFFF` reads open bus
(measured in `reu-dma`, "Without an REU").

## Quick reference

| Address | Register | Read | Write | After reset |
|---|---|---|---|---|
| $DF00 | Status | bits 7-5 clear on read | ignored | `$10` (1764, 1750); `$00` (1700) |
| $DF01 | Command | last written; bit 7 clears when the transfer ends | starts or arms a transfer | `$10` |
| $DF02 | C64 address, low | current | current and reload copy | `$00` |
| $DF03 | C64 address, high | current | current and reload copy | `$00` |
| $DF04 | REU address, low | current | current and reload copy | `$00` |
| $DF05 | REU address, high | current | current and reload copy | `$00` |
| $DF06 | REU bank | bits 7-3 read 1 | bits 2-0 kept | `$F8` |
| $DF07 | Length, low | current | current and reload copy | `$FF` |
| $DF08 | Length, high | current | current and reload copy | `$FF` |
| $DF09 | Interrupt mask | bits 4-0 read 1 | bits 7-5 kept | `$1F` |
| $DF0A | Address control | bits 5-0 read 1 | bits 7-6 kept | `$3F` |

Each address and length register has a reload copy. A write sets both.
After a transfer the registers keep the incremented values, unless
command bit 5 (autoload) is set; then they are reloaded from the copies.
`reu-dma` measured the incremented C64 address: after a verify stopped
at `$3ABC`, `$DF02/$DF03` read `$3ABD`.

## Registers

### $DF00 — DF00 — Status (R)

| Bit | Meaning |
|---|---|
| 7 | Interrupt pending |
| 6 | End of block: the transfer finished |
| 5 | Fault: a verify found a difference |
| 4 | Size: 1 = 256 Kbit DRAMs (1764, 1750), 0 = 64 Kbit (1700) |
| 3-0 | Chip version (0 in VICE) |

A read clears bits 7-5 and releases the REU's IRQ line. Writes are
ignored. Measured in `reu-dma`: `$50` after a 1-byte stash (bits 6 and
4), `$30` after a verify that failed (bits 5 and 4; bit 6 stays clear).

### $DF01 — DF01 — Command (RW)

| Bit | Meaning |
|---|---|
| 7 | Execute: a write with this bit set starts or arms the transfer |
| 5 | Autoload: reload the address and length registers after the transfer |
| 4 | 1 = start now; 0 = arm, and start on the next write to `$FF00` |
| 1-0 | Type: `%00` C64 → REU (stash), `%01` REU → C64 (fetch), `%10` swap, `%11` verify |

Bits 6, 3 and 2 are writable and do nothing. When a transfer ends the
REC clears bit 7 and sets bit 4. The `$FF00` trigger exists so a
transfer can use RAM under I/O: arm it with I/O visible, bank I/O out,
then write `$FF00` (measured in `reu-dma`, "The $FF00 trigger").

### $DF02 — DF02 — C64 address, low byte (RW)

The first C64 address of the transfer, low byte. The DMA sees the memory
configuration in force while it runs, not when it was armed.

### $DF03 — DF03 — C64 address, high byte (RW)

The first C64 address of the transfer, high byte.

### $DF04 — DF04 — REU address, low byte (RW)

The first REU address, bits 0-7.

### $DF05 — DF05 — REU address, high byte (RW)

The first REU address, bits 8-15.

### $DF06 — DF06 — REU bank (RW)

The first REU address, bits 16-18: 64 KB bank 0-7. Bits 7-3 always
read as 1. Measured in `reu-dma`: 5 written, `$FD` read back with
`-reusize 512`. Compare bits 2-0 only when detecting an REU.

### $DF07 — DF07 — Transfer length, low byte (RW)

Byte count, low byte. A count of 0 moves 65,536 bytes (measured in
`reu-dma`, `64K OFF`).

### $DF08 — DF08 — Transfer length, high byte (RW)

Byte count, high byte.

### $DF09 — DF09 — Interrupt mask (RW)

| Bit | Meaning |
|---|---|
| 7 | Interrupts enabled; bits 6 and 5 count only with this set |
| 6 | IRQ at end of block |
| 5 | IRQ on a verify fault |
| 4-0 | Unused, read 1 |

The REU pulls the CPU's IRQ line and sets status bit 7. Reading `$DF00`
releases it. Setting a mask bit when its event has already happened
raises the IRQ at once. Not measured here: `reu-dma` writes 0.

### $DF0A — DF0A — Address control (RW)

| Bit | Meaning |
|---|---|
| 7 | 1 = hold the C64 address fixed |
| 6 | 1 = hold the REU address fixed |
| 5-0 | Unused, read 1 |

A fixed REU address fills C64 memory with one byte; a fixed C64 address
stashes one location into many REU bytes. Both are measured in
`reu-dma`, "Fixed addresses". A fetch into one fixed C64 address, the
`$D418` digi case, is not measured here.

## Cost

A stash, fetch or verify takes one cycle per byte. A swap takes two.
There is no set-up cost beyond the store to `$DF01`. Badlines and
sprite fetches slow a transfer with the screen on. Measured in
`reu-dma`, which has the table.

## Oscar64

`reu.h` maps a `struct REU` onto `$DF00`. `reu_store`, `reu_load`,
`reu_fill` and the 2D loads write `$DF01-$DF08` and `$DF0A` with command
bit 4 set, so each transfer starts at once. `REU_CMD_FF00` (`$10`) is
that start-now bit, not the `$FF00` trigger. `REU_CTRL_FIXL` (`$80`)
fixes the C64 address and `REU_CTRL_FIXR` (`$40`) the REU address. The
per-function register list is in
[oscar64-headers-reference.md](../toolchains/oscar64-headers-reference.md#reuh--ram-expansion-unit-dma).

## Pitfalls

- A read of `$DF00` clears the end-of-block and fault bits. Read it once
  and keep the value.
- With no REU, `$DF00-$DFFF` read open bus. Detect by writing 1 to 7 to
  `$DF02-$DF08` and reading them back, comparing `$DF06` on bits 2-0
  only, as `reu-dma` does.
- A transfer is started while I/O is visible. To reach RAM under I/O, use
  the `$FF00` trigger (command bit 4 = 0).
- Autoload off leaves the address and length registers past the last
  byte. Reload all of them before the next transfer, or set bit 5.

## Sources

- VICE 3.10, `src/c64/cart/reu.c`: register offsets, bit masks, reset
  values, read and write side effects, the `$FF00` trigger and the
  end-of-transfer update.
- [`kickassembler/reu-dma`](../recipes/kickassembler/reu-dma.md): the
  measured values named above.

<!-- doc-type: hardware-reference -->
