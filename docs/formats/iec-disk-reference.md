<!-- doc-type: format-reference -->

# IEC Bus and 1541 Disk Drive Reference

This document covers the Commodore IEC serial bus protocol, the 1541 floppy drive's command interface, and the practical concerns of writing C64 code that talks to disk drives. The IEC bus is the physical transport underlying KERNAL disk I/O (LOAD, SAVE, OPEN, CLOSE, CHKIN, CHKOUT) and any custom fast-loader that bypasses the KERNAL. For the KERNAL jump-table entries that drive IEC communication from the C64 side, see `../hardware/kernal-routines-reference.md`.

---

## Overview

The IEC bus (serial IEEE-488 bus) is Commodore's cost-reduced adaptation of the IEEE-488/HP-IB parallel bus used on PET computers. Commodore replaced the 16-wire parallel bus with a 3-wire serial bus to save component costs, at a severe performance penalty: the standard 1541 protocol delivers approximately 300–400 bytes/second, against the PET's ~4 KB/second. The bus connects the C64 to disk drives (1541, 1571, 1581), printers (MPS-801, MPS-803), and other peripherals via a 6-pin DIN connector on the back of the computer.

The C64 drives the IEC bus through three CIA2 port lines (and a fourth for the hardware handshake clock). The same CIA2 chip (`$DD00`–`$DD0F`) that controls the VIC-II bank-switching (`$DD00` bits 0–1) also owns the IEC bus lines. This dual use means that code which manipulates CIA2 for RS-232 or custom bit-banging must be aware of IEC bus contention.

All IEC communication from the C64 side goes through KERNAL routines. User programs should always call the KERNAL jump table (`$FF81`–`$FFF5`), never poke CIA2 directly for IEC purposes — the internal routine addresses changed between KERNAL revisions and are private implementation details.

---

## Pin Map and Electrical Characteristics

The IEC bus uses an open-collector (open-drain) topology: any device can pull a line low; lines float high via pull-up resistors when no device is asserting. Logic is **inverted**: a logical TRUE (asserted) corresponds to a low voltage on the line (~0 V), and a logical FALSE (released) corresponds to a high voltage (~5 V). The C64's CIA2 port register bits also reflect this inversion: writing 1 to a data direction output bit AND the corresponding data bit low drives the line low.

**DIN-6 connector pinout:**

| Pin | Signal | Direction | Description |
|-----|--------|-----------|-------------|
| 1 | SRQ | Bidirectional | Service Request (unused by 1541; used by some fast loaders for handshake) |
| 2 | GND | — | Signal ground |
| 3 | ATN | C64 → drives | Attention: C64 claims bus and sends command bytes |
| 4 | CLK | Bidirectional | Clock line: transmitter controls timing |
| 5 | DATA | Bidirectional | Serial data |
| 6 | RESET | C64 → drives | Reset line (tied to C64 reset; resets all devices on power-cycle) |

**CIA2 port mapping:**

| CIA2 register | Bit | IEC signal |
|--------------|-----|-----------|
| `$DD00` (Port A data) | 7 | CLK input from bus (read) |
| `$DD00` (Port A data) | 6 | DATA input from bus (read) |
| `$DD00` (Port A data) | 4 | ATN output (write; also controls VIC bank select for CIA2) |
| `$DD00` (Port A data) | 3 | CLK output (write) |
| `$DD00` (Port A data) | 2 | DATA output (write) |
| `$DD02` (Port A DDR) | — | Bits 2, 3, 4 should be output; bits 6, 7 should be input |

Reading `$DD00` gives the current bus state; writing drives the C64's output lines. The IEC input lines (bits 6–7) are ORed with the output lines inside the CIA, so both read and write operations use `$DD00`.

Note: `$DD01` (Port B) and `$DD03` (Port B DDR) are also present on CIA2 but are not used for IEC under the standard KERNAL. They are available for RS-232 (user port) or custom hardware.

---

## Bus Protocol

### Roles: Controller, Talker, Listener

The IEC bus has one **controller** (always the C64), one **talker** (the device sending data), and one or more **listeners** (devices receiving data). During a LOAD, the drive is the talker and the C64 is the listener. During a SAVE, the C64 is the talker and the drive is the listener. A printer is always a listener.

### ATN Phase (Command Phase)

The C64 initiates bus activity by pulling ATN low. While ATN is asserted, all devices on the bus treat incoming bytes as command bytes (not data). The C64 sends a 1-byte command:

- **Bits 7–5:** Command type:
  - `$20` (001xxxxx) — LISTEN: address a device as a listener
  - `$40` (010xxxxx) — TALK: address a device as a talker
  - `$60` (011xxxxx) — OPEN CHANNEL / SECONDARY ADDRESS: follows LISTEN or TALK
  - `$E0` (111xxxxx) — CLOSE
  - `$F0` (111xxxxx) — OPEN (also a secondary address command)
- **Bits 4–0:** Device address (0–30; C64 itself is address 0, drives default to 8–11, printers to 4–7)

After sending LISTEN or TALK + secondary address, the C64 releases ATN. The addressed device becomes active; all others go passive.

### Serial Frame (Data Phase)

Each byte is transferred serially, bit-by-bit, using a two-line handshake on CLK and DATA:

1. Talker asserts CLK (signals it is about to send a bit)
2. Listener releases DATA (signals ready to receive)
3. Talker toggles CLK while holding DATA stable at the bit value
4. Listener reads DATA on the CLK edge
5. Repeat for all 8 bits (LSB first)
6. Listener holds DATA low (ACK) briefly after the last bit

This handshake means transmission speed is limited by the slowest device on the bus. The 1541 introduces significant overhead because it processes bytes in its own 6502 CPU, handling each bit-transfer in a software loop at 1 MHz. The result is the notorious ~300 byte/sec standard-load throughput.

### EOI (End Or Identify)

The talker signals the last byte in a data stream via EOI (End or Identify). After the receiver is ready (DATA released), the talker holds CLK low for more than ~200 µs before beginning the final byte's bit transfer. The listener recognizes this timing as EOI and acknowledges by briefly pulling DATA low before the byte transfer begins.

The KERNAL READST routine (`$FFB7`) returns a status byte where bit 6 indicates EOI was received on the last IECIN call.

### UNLISTEN / UNTALK

After data transfer is complete, the C64 asserts ATN and sends the UNLISTEN (`$3F`) or UNTALK (`$5F`) command to release the addressed devices.

---

## Drive Commands

### High-Level KERNAL Interface

The standard way for C64 programs to communicate with a disk drive is via the KERNAL file I/O layer. The typical sequence for loading a file:

```asm
; Set logical file number, device, secondary address (channel)
; LFN=1, device=8, SA=0 (load to original address)
LDA #1
LDX #8
LDY #0
JSR $FFBA   ; SETLFS

; Set filename
LDA #<filename_len
LDX #<filename_addr
LDY #>filename_addr
JSR $FFBD   ; SETNAM

; LOAD: A=0 (load), A=1 (verify)
LDA #0
LDX #<dest_addr_lo
LDY #<dest_addr_hi
JSR $FFD5   ; LOAD
```

For arbitrary file access (read/write):

```asm
JSR $FFC0   ; OPEN  — opens the file (uses LFN/device/SA from SETLFS/SETNAM)
JSR $FFC6   ; CHKIN  — redirect character input from file
JSR $FFCF   ; CHRIN  — read one byte
JSR $FFC9   ; CHKOUT — redirect character output to file
JSR $FFD2   ; CHROUT — write one byte
JSR $FFCC   ; CLRCHN — restore default I/O channels
JSR $FFC3   ; CLOSE  — close the file
```

See `../hardware/kernal-routines-reference.md` for the full register contracts, error-status handling, and secondary address conventions for each jump-table entry.

### Secondary Addresses and Channels

The secondary address (SA) passed to SETLFS encodes the channel number and access type:

| Secondary address | Meaning |
|------------------|---------|
| 0 | LOAD (drive sends file to C64 memory) |
| 1 | SAVE (C64 sends file to drive) |
| 2–14 | Arbitrary I/O channels |
| 15 | Command/status channel |

The **command channel** (SA=15, device=8) is a special bidirectional channel for sending DOS commands to the drive and reading the drive status. To scratch a file:

```
OPEN 1,8,15,"S0:FILENAME"
```

Common drive commands sent to the command channel:

| Command | Example | Effect |
|---------|---------|--------|
| SCRATCH | `S0:FILENAME` | Delete file |
| RENAME | `R0:NEW=OLD` | Rename file |
| COPY | `C0:DST=0:SRC` | Copy file |
| VALIDATE | `V0` | Rebuild BAM (like CHKDSK) |
| INITIALIZE | `I0` | Force drive to re-read BAM |
| NEW | `N0:NAME,ID` | Format disk |
| BLOCK-READ | `B-R chn drv trk sec` | Read arbitrary sector |
| BLOCK-WRITE | `B-W chn drv trk sec` | Write arbitrary sector |
| MEMORY-READ | `M-R addrlo addrhi len` | Read drive RAM/ROM |
| MEMORY-WRITE | `M-W addrlo addrhi len data` | Write drive RAM |
| MEMORY-EXECUTE | `M-E addrlo addrhi` | Execute code in drive RAM |

Reading from the command channel after any operation returns the drive status string: a 2-digit error code, message text, track number, sector number, and newline. Error code `00` means no error.

### Sequential vs Random Access Files

**Sequential files** (PRG, SEQ, USR types) are stored as a linked chain of 256-byte sectors (254 bytes of data per sector; first 2 bytes are next-track/next-sector pointers). Reading is strictly forward.

**Random access files** (REL type) allow seeking to arbitrary records. They use a fixed record length declared at file-open time and maintain side-sectors — dedicated bookkeeping sectors that map logical record numbers to physical track/sector locations. REL files are rarely used in demo/game code but common in productivity applications.

---

## 1541 Drive ROM

The 1541 contains its own 6502 processor running at 1 MHz, 2 KiB of RAM (`$0000–$07FF`), and 16 KiB of ROM (`$C000–$FFFF`). The drive firmware (CBM DOS 2.6) handles all file system operations autonomously; the C64 communicates with it exclusively via the IEC bus.

Key ROM entry points (for reference; direct calling requires running code on the drive via M-E):

| Address | Routine | Notes |
|---------|---------|-------|
| `$C100` | Main idle/command loop | Entry point for DOS command processing |
| `$D042` | Execute drive command | Parses the command buffer at `$0200` |
| `$D486` | Format disk (NEW) | Full format routine |
| `$C8B6` | Read sector into drive buffer | Low-level GCR read |
| `$C83C` | Write sector from drive buffer | Low-level GCR write |
| `$E505` | Bump head to track 1 | Used in initialization |
| `$F5E9` | Transmit byte via IEC | Serial output handler |
| `$F78F` | Receive byte via IEC | Serial input handler |

These addresses are for the standard 1541 ROM (901229-05 and -06). The earlier 1540 ROM and various clone ROMs may differ. Full drive ROM disassembly is maintained at `https://www.pagetable.com/c64ref/1541/`.

Direct ROM manipulation is outside the scope of normal C64 programming. Most fastloader implementations upload a small stub to drive RAM via `M-W` commands and then invoke it with `M-E`.

---

## Custom Code on the 1541

### Drive RAM and the Parallel Trick

The 1541 has 2 KiB of general-purpose RAM. Because the drive's 6502 operates independently of the C64's 6510, both CPUs can coordinate via the IEC bus for synchronization, enabling **parallel loading**: data is transferred over all 8 bits of the user port (Centronics-style) simultaneously rather than serially over the 1-bit IEC DATA line. Combined with bit-banging on the drive side, this achieves 10–25 KB/sec — 30–80x faster than the standard KERNAL loader.

The technique requires custom code running on the drive CPU. The C64 uploads the drive-side routine via the command channel's `M-W` (Memory Write) command, then starts it with `M-E` (Memory Execute). Once the drive routine is running, both sides enter a tight handshake loop using the user-port lines for data and the IEC bus for control.

### Notable Fastloaders

Several widely-used fastloaders from the demoscene implement this approach:

- **Krill's Loader** — widely used in modern demos; open source; supports 1541/1571/1581/SD2IEC; PAL and NTSC safe via CIA-timer calibration
- **Spindle** — DreamLoad-compatible, optimized for original 1541 hardware
- **DreamLoad** — older but common in late-1990s/early-2000s releases
- **Kung Fu Flash loader** — targets flash-cart hardware with direct SD access

From the KB's toolchain perspective, a fastloader is an assembly module linked into the PRG (Oscar64: inline asm or an external `.asm` included via the linker; KickAssembler: `import binary` or included source). The drive-side routine is a binary blob uploaded at runtime. Oscar64 or KickAssembler produce the drive-side stub as a `.BIN` and the loader includes it as a `char[]` array or embedded resource.

### Timing Considerations

The drive's 6502 runs from a clock derived from the disk rotation rate (synchronous with the GCR bit cells), not a fixed oscillator. This means the drive clock speed varies slightly between drive units and can drift. Standard KERNAL code is immune to this because the IEC handshake is fully asynchronous. Custom fastloader code that uses tight cycle counts on both sides must account for this timing variation and include calibration steps.

PAL C64 drives run at 985,248 Hz; NTSC C64 drives run at 1,022,730 Hz. Fastloaders that measure CIA timer ticks for synchronization must check and compensate for the video standard. The `c64_pal_ntsc_diff` tool in this KB can retrieve timing difference data.

---

## SD2IEC and Ultimate II+

These modern IEC-compatible peripherals are flagged here for completeness but are **out of scope** for this KB's primary hardware target (stock C64 PAL/NTSC).

**SD2IEC** is a microcontroller-based IEC device that reads/writes SD cards. It emulates the 1541 command set well enough for most purposes but has no drive CPU — it cannot execute drive-side code, making all `M-W`/`M-E` based fastloaders non-functional. SD2IEC supports a subset of fastloaders via native acceleration modes (Krill's Loader, for example, has an SD2IEC-compatible codepath).

**Ultimate II+** (Gideon's Logic) is an FPGA cartridge that includes an accurate 1541 emulation with real drive CPU, plus fast IEC (via FBI fast loader built into the cartridge firmware). It is the gold standard for hardware-accurate fast loading on modern C64 setups but represents cartridge-extended hardware outside the stock scope.

Both devices handle `.D64`, `.D71`, `.D81`, `.T64`, and `.PRG` files from SD cards, making them the most common way demosceners develop on real hardware today.

---

## Pitfalls

### Standard IEC Load Speed (~300 bytes/sec)

The headline limitation of the IEC bus is its throughput. A full 35-track 1541 disk (664 KB usable) takes over 30 minutes to read entirely via the KERNAL LOAD. A typical 50 KB program takes about 2.5 minutes. This is universally considered unacceptable for released software; virtually every released demo and game uses a custom fastloader. Plan for fastloader integration from the start of any project targeting real hardware.

### VICE Timing Differences with Real Hardware

VICE's 1541 emulation is accurate for correctness but the default configuration does not emulate the real-time IEC bus timing precisely. Programs that rely on cycle-counted timing in IEC routines (including some fastloaders) may work correctly in VICE but fail on real hardware, or vice versa. Use VICE's `--drivesound 1 --drive8truedrive 1` options to enable the more accurate (but slower) true-drive emulation during testing.

The `c64_pal_ntsc_diff` MCP tool and `../hardware/pal-ntsc-reference.md` detail the clock-rate differences that affect CIA-timer-based IEC routines.

### CIA2 Contention: IEC Bus vs RS-232

CIA2 Port B (`$DD01`) is shared between the user port (RS-232, Centronics data) and is physically adjacent to the IEC bus Port A lines. Code that uses the user port for parallel fastloading (the classic trick) must coordinate carefully: Port A bits 2–4 are IEC bus outputs; Port B is the 8-bit parallel data port. When a parallel fastloader is active, driving Port B rapidly while CIA2 is also the IEC ATN/CLK/DATA controller requires disciplined bit-mask operations. A common bug is accidentally clearing or asserting ATN while writing to Port B.

Similarly, code that uses CIA2 for RS-232 (via the user port ACIA emulation) must ensure IEC I/O is not simultaneously active. The KERNAL does not serialize these; user code must guard access.

### Drive-Not-Ready and Timeout Errors

The KERNAL IEC routines enforce a timeout via CIA1 timer B. If the drive does not respond within approximately 64 ms, the KERNAL declares a timeout, sets bit 1 of the READST status byte, and returns. This happens silently on a powered-off or absent drive. Code that depends on drive presence should check READST after every OPEN/CHKIN/CHKOUT and handle the timeout gracefully rather than spinning forever.

### Directory Track Corruption

Track 18 is the most-written track on a 1541. The directory and BAM are updated on every file write or scratch. Repeated use without a VALIDATE (`V0` command channel) command can produce a corrupted BAM — sectors marked allocated that are actually free, or vice versa. VALIDATE rebuilds the BAM by walking every file chain and reconstructing the bitmap. Running VALIDATE on a disk with active writes will abort any open file writes. The c1541 utility (bundled with VICE) can perform offline BAM repair.

---

## See Also

- `../runtime/vice-reference.md` — VICE emulator configuration for IEC/drive emulation
- `c64-file-formats.md` — Disk image formats (.D64, .D71, .D81, .G64)
- `../hardware/kernal-routines-reference.md` — KERNAL jump table: SETLFS, SETNAM, OPEN, CLOSE, CHKIN, CHKOUT, LOAD, SAVE, LISTEN, TALK, IECIN, IECOUT, READST, UNLSN, UNTLK
