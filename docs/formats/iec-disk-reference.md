<!-- doc-type: format-reference -->

# IEC Bus and 1541 Disk Drive Reference

This document covers the Commodore IEC serial bus protocol, the 1541 floppy drive's command interface, and the practical concerns of writing C64 code that talks to disk drives. The IEC bus is the physical transport underlying KERNAL disk I/O (LOAD, SAVE, OPEN, CLOSE, CHKIN, CHKOUT) and any custom fast-loader that bypasses the KERNAL. For the KERNAL jump-table entries that drive IEC communication from the C64 side, see `../hardware/kernal-routines-reference.md`.

---

## Overview

The IEC bus (serial IEEE-488 bus) is Commodore's cost-reduced adaptation of the IEEE-488/HP-IB parallel bus used on PET computers. Commodore replaced the 16-wire parallel bus with a 3-wire serial bus to save component costs, at a severe performance penalty: the standard 1541 protocol delivers approximately 300–400 bytes/second, against the PET's ~4 KB/second. The bus connects the C64 to disk drives (1541, 1571, 1581), printers (MPS-801, MPS-803), and other peripherals via a 6-pin DIN connector on the back of the computer.

The C64 works the IEC bus through five lines of CIA2 port A: three outputs (ATN, CLK, DATA) and two inputs (CLK, DATA). The same CIA2 chip (`$DD00`–`$DD0F`) that controls the VIC-II bank-switching (`$DD00` bits 0–1) also owns the IEC bus lines. This dual use means that code which manipulates CIA2 for RS-232 or custom bit-banging must be aware of IEC bus contention.

All IEC communication from the C64 side goes through KERNAL routines. User programs should always call the KERNAL jump table (`$FF81`–`$FFF5`), never poke CIA2 directly for IEC purposes — the internal routine addresses changed between KERNAL revisions and are private implementation details.

---

## Pin Map and Electrical Characteristics

The IEC bus is open-collector. For each line, every device has a driver that can pull the line to ground and do nothing else, and a pull-up lets the line float to +5 V when no driver is on. A line is therefore **asserted ("true") when it is low** and **released ("false") when it is high**, and any one device can hold it low against all the others — which is what the handshakes rely on: a listener that is not ready keeps DATA low and the talker cannot proceed.

**DIN-6 connector pinout:**

| Pin | Signal | Direction | Description |
|-----|--------|-----------|-------------|
| 1 | SRQ | Bidirectional | Service Request (unused by 1541; used by some fast loaders for handshake) |
| 2 | GND | — | Signal ground |
| 3 | ATN | C64 → drives | Attention: C64 claims bus and sends command bytes |
| 4 | CLK | Bidirectional | Clock line: transmitter controls timing |
| 5 | DATA | Bidirectional | Serial data |
| 6 | RESET | C64 → drives | Reset line (tied to C64 reset; resets all devices on power-cycle) |

**CIA2 port A (`$DD00`) bit map**, read from the KERNAL 901227-03 image (rung 1; the instructions are in the next table):

| Bit | Direction (DDR default) | Signal | Sense |
|-----|-------------------------|--------|-------|
| 7 | input | DATA IN | 1 = DATA is high (released); 0 = some device, this C64 included, is holding DATA low |
| 6 | input | CLK IN | 1 = CLK is high (released); 0 = CLK is held low |
| 5 | output | DATA OUT | 1 = this C64 pulls DATA low; 0 = released |
| 4 | output | CLK OUT | 1 = this C64 pulls CLK low; 0 = released |
| 3 | output | ATN OUT | 1 = this C64 pulls ATN low; 0 = released |
| 2 | output | RS-232 TXD | user port, not IEC — the KERNAL's RS-232 transmitter writes it |
| 1–0 | output | VIC-II bank select | not IEC — see `../hardware/cia-reference.md` |

The two directions have opposite senses and both matter. **Writing 1 to an output bit pulls its line low** — the port reaches the bus through inverting open-collector drivers (the 7406 on the C64 schematic, rung 4) — so releasing a line means *clearing* its bit, and the KERNAL's routine for "clock high" is an `AND`. **Reading 1 on an input bit means the line is high**, i.e. released; a line that anything is holding low reads 0. The KERNAL's device-present test is exactly that: assert ATN, release our own DATA, and if DATA IN still reads 1 nobody is holding it, so nobody is there.

The evidence, all rung 1 from the ROM bytes (the labels are the KERNAL source's names, rung 4):

| Address | Label | Instructions | Establishes |
|---|---|---|---|
| `$EE85` | CLKHI | `LDA $DD00 / AND #$EF / STA $DD00` | CLK OUT is bit 4; release by clearing |
| `$EE8E` | CLKLO | `LDA $DD00 / ORA #$10 / STA $DD00` | assert by setting |
| `$EE97` | DATAHI | `LDA $DD00 / AND #$DF / STA $DD00` | DATA OUT is bit 5 |
| `$EEA0` | DATALO | `LDA $DD00 / ORA #$20 / STA $DD00` | |
| `$ED2E` | in LISTEN/TALK | `LDA $DD00 / ORA #$08 / STA $DD00` | ATN OUT is bit 3, asserted by setting |
| `$EDBE` | SCATN | `LDA $DD00 / AND #$F7 / STA $DD00` | released by clearing |
| `$EEA9` | DEBPIA | `LDA $DD00 / CMP $DD00 / BNE $EEA9 / ASL A / RTS` | debounced read: DATA IN (bit 7) lands in the carry, CLK IN (bit 6) in the sign flag |
| `$ED41`–`$ED47` | in ISOUR | `JSR DATAHI / JSR DEBPIA / BCS $EDAD` | carry set — DATA IN reads 1 — with ATN asserted goes to `$EDAD`, `LDA #$80`, the device-not-present status; a present drive holds DATA low, and low reads 0 |
| `$FE7B` | RS-232 transmit | `LDA $DD00 / AND #$FB / ORA $B5 / STA $DD00` | bit 2 is the RS-232 TXD bit |

Measured too, in VICE x64sc 3.10 with `-drive8truedrive` (rung 1): once the C64 has released its own lines — the probe stored `$07` before its first read; see the reset state below for why that matters — `$DD00` reads `$C7` (bits 6–7 both 1); write bit 4 and it reads `$97` (CLK IN fell to 0); write bit 5 instead and it reads `$67` (DATA IN fell to 0); after `JSR $FFB1` (LISTEN 8) with a 1541 attached it reads `$1F` — ATN and CLK held by the C64, DATA held by the drive, all three inputs 0 — and READST is `$00`, while with no drive attached the same call leaves `$C7` and READST `$80`.

**Data direction and reset state.** IOINIT (`$FDA3`) sets the port up at `$FDCB`–`$FDD4`: `LDA #$07 / STA $DD00`, then `LDA #$3F / STA $DD02` (rung 1). The DDR default is therefore `$3F` — bits 0–5 output, 6–7 input — and user code has no reason to change it. The `$07` is not where the port ends up, though. IOINIT's last instruction, at `$FDF6`, is `JMP $FF6E`, and `$FF6E`–`$FF7F` — `LDA #$81 / STA $DC0D / LDA $DC0E / AND #$80 / ORA #$11 / STA $DC0E / JMP $EE8E` — finishes with the only `JMP CLKLO` in the KERNAL (rung 1). A freshly reset C64 therefore parks CLK asserted: the port register is `$17` and `$DD00` reads `$97`. Measured in VICE x64sc 3.10 (rung 1): a program whose first instruction is `LDA $DD00` shows `$97`, and `$C7` only after it stores `$07`; the readings are identical with `-drive8truedrive` and a 1541 attached and with no drive, so nothing on the emulated bus was pulling. `$C7` is the bus after the C64 has released its lines — a `$07` store does that, and so does the `JSR CLKHI / JMP DATAHI` pair at `$EE0D`–`$EE12` that the KERNAL's UNLSN and UNTLK both end with.

**One register, both directions.** The C64 reads the bus and drives its own lines through the same byte, which is why every KERNAL primitive above is a read-modify-write: a bare `STA $DD00` would also rewrite the VIC bank and TXD. Custom IEC code must mask the same way, and anything that changes the VIC bank while the bus is busy — a raster interrupt switching banks under a loader, say — must carry bits 3–5 through unchanged or it will drop CLK or DATA in the middle of a byte.

Port B (`$DD01`) and its DDR (`$DD03`) carry no IEC signal. They are the user port's data lines, which is where parallel-cable loaders put their eight data bits.

**Correction (2026-09-21).** The table this replaces had every IEC row wrong — CLK IN on bit 7, DATA IN on bit 6, ATN on bit 4, CLK OUT on bit 3, DATA OUT on bit 2, and "bits 2, 3, 4 output" for the DDR — and said the inputs were "ORed with the output lines inside the CIA". A loader written from it would have toggled the RS-232 TXD line as DATA and sampled DATA as CLK. `../hardware/cia-reference.md` has the bit numbers right but gives the input sense the other way round ("reading `1` from bit 6 means the bus is being held low"); the ISOUR test and the VICE readings above both say 1 is released. A draft of this section written the same day said IOINIT's `$07` store left all three IEC lines released and called `$C7` the idle reading without saying whose idle; IOINIT's last instruction asserts CLK, and `$C7` is what the C64 sees after it has released its own lines.

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

### The 1541 DOS Error Codes

The status line is `cc,message,tt,ss` followed by a CR: a two-digit code, the text, then a track and a sector in decimal. The 1541 ROM assembles it at `$E6C7` into the buffer at `$02D5`: two BCD digits from the code, a comma, the text looked up in the table below, a comma, the track, a comma, the sector (rung 1: the `dos1541-325302-01+901229-05` image in `/opt/homebrew/opt/vice/share/vice/DRIVES/`, bytes `$E6C7`–`$E705`). Every code the ROM can put in that line is in this table. The message column is the text field exactly as it comes back, including the leading space some messages have; the "Provoked" column says whether the recipe `../recipes/kickassembler/dos-error-codes.md` produced that reply in VICE x64sc 3.10 (rung 1) or whether the text is only read from the ROM.

| Code | Message field | Cause | Class | Provoked |
|---|---|---|---|---|
| 00 | ` OK` | no error; the line reads `00, OK,00,00` | none | yes |
| 01 | ` FILES SCRATCHED` | the reply to SCRATCH; the track field is the number of files removed, so `01, FILES SCRATCHED,00,00` means nothing matched | none | yes (`S0:T` after writing T: `01, FILES SCRATCHED,01,00`) |
| 20 | `READ ERROR` | block header not found (job code 2) | media | ROM text only |
| 21 | `READ ERROR` | no sync found (job code 3): unformatted track, no disk, or the drive did not come up to speed | media | ROM text only |
| 22 | `READ ERROR` | data block not found after the header (job code 4) | media | ROM text only |
| 23 | `READ ERROR` | checksum error in the data block (job code 5) | media | ROM text only |
| 24 | `READ ERROR` | job code 6, and also job code 0 (the ROM maps both here); the 1541 manual calls it a byte-decoding error (rung 4) | media | ROM text only |
| 25 | ` WRITE ERROR` | write-verify mismatch (job code 7) | retry, then media | ROM text only |
| 26 | ` WRITE PROTECT ON` | write attempted with the notch covered (job code 8) | user error | yes, in a side run with `-attach8ro`: `26, WRITE PROTECT ON,18,00` |
| 27 | `READ ERROR` | checksum error in the block header (job code 9) | media | ROM text only |
| 28 | ` WRITE ERROR` | no sync after the data block was written, a long data block (job code 10) | media | ROM text only |
| 29 | ` DISK ID MISMATCH` | the sector header's ID is not the one in the BAM (job code 11): a disk was changed without INITIALIZE, or a disk was formatted over | user error | ROM text only |
| 30 | `SYNTAX ERROR` | the command parser could not make sense of the string (issued at `$C263`, `$C923`, `$CC2B`, `$D837`) | program bug | yes (`R0:A`, a RENAME with no `=`) |
| 31 | `SYNTAX ERROR` | the command letter does not exist, or the letter after `M-` or `B-` is not one the DOS has (`$C175`, `$C8C1`, `$CB4B`, `$CC26`) | program bug | yes (`XYZ`) |
| 32 | `SYNTAX ERROR` | the command string is too long (`$C2D7`) | program bug | ROM text only |
| 33 | `SYNTAX ERROR` | a wildcard in a name where none is allowed (`$D8F0`, `$EE14`) | program bug | yes (`T*,S,W`) |
| 34 | `SYNTAX ERROR` | no file name after the command (`$C1F3`) | program bug | yes (`N` alone) |
| 39 | ` FILE NOT FOUND` | raised at one site only, `$E7C0`; that it is the `&` utility-loader command's not-found case is rung 4 | user error | ROM text only |
| 50 | ` RECORD NOT PRESENT` | REL file: positioned past the last record; the DOS also reports it when a write extends the file (`$D9BE`, `$E169`, `$E449`) | program bug, or expected when extending | ROM text only |
| 51 | `OVERFLOW IN RECORD` | REL file: more bytes written than the record length (`$E297`) | program bug | ROM text only |
| 52 | ` FILE TOO LARGE` | REL file: the record position would need more blocks than the disk has (`$E363`) | program bug | ROM text only |
| 60 | ` WRITE FILE OPEN` | opening a file that is still open for write, an unclosed entry (`$D957`) | program bug | ROM text only |
| 61 | ` FILE NOT OPEN` | a data channel used with no file open on it (`$CFF8`) | program bug | ROM text only |
| 62 | ` FILE NOT FOUND` | the name is not in the directory (`$CAE1`, `$D945`); OPEN on the C64 side still returns C=0 | user error | yes (`NOFILE,S,R`) |
| 63 | ` FILE EXISTS` | open for write on a name that exists, without `@` (`$CAEF`, `$D8EB`) | user error | yes (`T,S,W` a second time) |
| 64 | ` FILE TYPE MISMATCH` | the type in the open string is not the entry's type (`$C982`, `$D965`, `$E223`) | program bug | yes (`T,P,R` on a SEQ file) |
| 65 | `NO BLOCK` | B-A on a block already allocated; the track and sector fields give the next free block, or `00,00` if none (`$CD31`) | program bug | ROM text only |
| 66 | `ILLEGAL TRACK OR SECTOR` | a block command named a track or sector that does not exist; the fields echo the request (`$D54D`) | program bug | yes (`B-R 2 0 40 0`: `66,ILLEGAL TRACK OR SECTOR,40,00`) |
| 67 | `ILLEGAL TRACK OR SECTOR` | a file chain or the BAM points at a block that does not exist (`$DC01`, `$E202`, `$F1DA`); same text as 66 | media | ROM text only |
| 70 | `NO CHANNEL` | no drive buffer free: the 1541 lends four to data channels (seven sites, among them `$CBA0`, `$D212`, `$E214`) | program bug | yes (a fifth `#` open) |
| 71 | `DIR ERROR` | the BAM disagrees with itself while allocating (`$F1F5`, `$F246`); VALIDATE rebuilds it | media | ROM text only |
| 72 | ` DISK FULL` | no free block, or no free directory entry (`$F15A`) | user error | ROM text only |
| 73 | `CBM DOS V2.6 1541` | the power-on message, put there at reset (`$EBD5`); also raised as an error at `$D575` when the BAM's DOS-version byte is not the ROM's `$41` and a write was attempted | none on the first read; media after an access | yes (first read) |
| 74 | `DRIVE NOT READY` | no disk, or the drive could not read it (job code 15, and `$C41B`) | user error | yes, in a side run with no image attached: `74,DRIVE NOT READY,00,00` |

The provoked lines are the twelve on the recipe's screenshot plus the two side runs. The side runs used the same PRG; `-attach8ro` before `-8 disk.d64` attaches the image read-only and the write step answered 26 (an `-attach8rw` option also exists), and a run with no `-8` at all answered 74 on the first OPEN. For codes marked "ROM text only" the message field is assembled from the table below by the same routine, so the text is rung 1; the cause column for those rows is from the 1541 manual and the ROM's call sites, and the track and sector fields were not measured.

The class column is for an agent deciding what to do with the line: **retry** means try the operation again once, **media** means the disk or drive is at fault and no retry will help, **user error** means the program is fine and the person needs to act (insert a disk, free space, remove a file), **program bug** means the command string or call sequence is wrong. Codes 20 to 29 all carry the failing track and sector.

**How the text is stored.** The message table runs from `$E4FC` to `$E5D4`, and a word table from `$E5D5` to `$E609` follows it (rung 1). An entry is one or more BCD code bytes followed by the text; the first and the last byte of a text carry bit 7 set, which is how the reader finds the ends, and several codes share one text (`20 21 22 23 24 27` precede `READ ERROR`, `25 28` precede `WRITE ERROR`, `30`–`34` precede `SYNTAX ERROR`, `39 62` precede `FILE NOT FOUND`, `66 67` precede `ILLEGAL TRACK OR SECTOR`). Nine words are stored once and referred to by a byte below `$10`:

| Token | Word | At |
|---|---|---|
| `$03` | FILE | `$E5E1` |
| `$04` | OPEN | `$E5E6` |
| `$05` | MISMATCH | `$E5EB` |
| `$06` | NOT | `$E5F4` |
| `$07` | FOUND | `$E5F8` |
| `$08` | DISK | `$E5FE` |
| `$09` | ERROR | `$E5D5` |
| `$0A` | WRITE | `$E5DB` |
| `$0B` | RECORD | `$E603` |

The lookup at `$E706` scans from `$E4FC` for a byte equal to the code, skips to the text, and copies it byte by byte; a byte below `$20` is a token, and the copier at `$E754` writes a space and then looks the token up through the same routine (the scan runs on past `$E5D5` into the word table). That space is why `62` reads `62, FILE NOT FOUND` with a space after the comma while `31` reads `31,SYNTAX ERROR` without one: a message that starts with a token gets the token's space, a message that starts with a literal letter does not, and `00` has its space stored as a literal `$A0`. Entry 62 is the three bytes `83 06 87` at `$E58F`, tokens FILE, NOT, FOUND with the end bits on the first and last. A code that is not in the table at all comes back with an empty text field; the scan stops at `$E60A`.

**D64 error bytes.** The per-sector error byte a `.d64` image can carry (683 bytes after the sector data, see `c64-file-formats.md`) is not the DOS number. It is the drive's job return code, the value the sector routines hand back, and the conversion to a DOS number is at `$E60A`–`$E62C` (rung 1): the code is masked to its low four bits; 0 becomes 24, 15 becomes 74, and anything else is ORed with `$20` and decremented twice, which reads as a decimal code because the results stay below `$2A`.

| Byte in the image | DOS code | Message |
|---|---|---|
| `$01` | none | sector read cleanly |
| `$02` | 20 | READ ERROR, header not found |
| `$03` | 21 | READ ERROR, no sync |
| `$04` | 22 | READ ERROR, data block not found |
| `$05` | 23 | READ ERROR, data checksum |
| `$06` | 24 | READ ERROR |
| `$07` | 25 | WRITE ERROR, verify |
| `$08` | 26 | WRITE PROTECT ON |
| `$09` | 27 | READ ERROR, header checksum |
| `$0A` | 28 | WRITE ERROR |
| `$0B` | 29 | DISK ID MISMATCH |
| `$0F` | 74 | DRIVE NOT READY |

A `$00` byte is treated as no error by image tools. So a D64 can carry 20 to 29 and 74 and nothing else; the 3x, 5x, 6x and 7x codes are conditions of a command or a file, not of a sector, and no image byte produces them. That the image's byte is the job code is the D64 format's convention (rung 4, from the format's documentation); the arithmetic from job code to DOS number is the ROM's. Which of these bytes VICE's 1541 emulation reproduces on a read is measured in `../pitfalls/loader.md` (`d64_error_byte_is_a_controller_code`): VICE 3.10 honours `$02`, `$03`, `$04`, `$05`, `$09` and `$0B` and ignores `$07`, `$08` and `$0F`, and a single sector flagged `$03` or `$0B` reports 20 rather than 21 or 29 unless the whole track carries the code.

---

## Identifying the drive over the command channel

`M-R` (memory read) on the command channel returns raw bytes from the drive's own address space, and each DOS keeps its power-on message in ROM at a fixed place. Four bytes therefore say which firmware is answering — and the same four bytes are the honest form of the "is this a real 1541?" test that a GCR fast loader wants before it uploads drive code (`../pitfalls/loader.md`, `gcr_timing_assumes_stock_drive`).

**Where the string is** (rung 1: the bytes of the drive ROM images VICE 3.10 ships in `/opt/homebrew/opt/vice/share/vice/DRIVES/`). In the 1541 the error-message table holds entry 73 at `$E5B6`: the number byte `$73`, then `CBM DOS V2.6 1541` from `$E5B7` to `$E5C7`, with bit 7 set on the first text byte (`$C3`) and on the last (`$B1`) — that is how the table marks a message's ends. The same entry in the other images:

| VICE image | Drive | Text at `$E5BF` | Bytes at `$E5C4`–`$E5C7` | Byte at `$E5C3` |
|---|---|---|---|---|
| `dos1541-325302-01+901229-05` | 1541 | `V2.6 1541` | `31 35 34 B1` — "1541" | `$20` |
| `dos1541ii-251968-03` | 1541-II | `V2.6 1541` | `31 35 34 B1` — identical | `$20` |
| `dos1540-325302+3-01` | 1540 | `V2.6 V170` | `56 31 37 B0` — "V170" | `$20` |
| `dos1571-310654-05` | 1571 | `V3.0 1571` | `31 35 37 B1` — "1571" | `$20` |
| `dos1571cr-318047-01` | 1571 (C128DCR) | `V3.1 1571` | `31 35 37 B1` — "1571" | `$20` |
| `dos1570-315090-01` | 1570 | `V3.0 1570` | `31 35 37 B0` — "1570" | `$20` |
| `dos1581-318045-02` | 1581 | `FF FF FF FF …` | `FF FF FF FF` | `$FF` |

The 1581's ROM (32 KB from `$8000`) has nothing at that address. Its message is `COPYRIGHT CBM DOS V10 1581`: entry 73 at `$A6D0`, text from `$A6D1`, with "1581" at `$A6E7`–`$A6EA` (`31 35 38 B1`). The 1551 image (`dos1551-318008-01`) is a different bus altogether — the Plus/4's parallel port, not IEC (rung 4) — and is laid out differently again.

**The command.** From the 1541's handler (MEMRD, `$CB20`, rung 1 from the bytes): the letter after `M-` is compared with `R`, `W` and `E` — anything else is error 31 — the address is taken from `$0203` (low byte) and `$0204` (high byte), and if the command is at least six bytes long the byte at `$0205` is the count; a shorter command, or a count of 1, returns one byte. So the full form is the six bytes `M-R` `lo` `hi` `count`, sent as the "filename" of an OPEN on secondary address 15 (or with `PRINT#`; the CR it appends is ignored). The drive then delivers `count` bytes on channel 15, the last with EOI; read them with CHRIN after CHKIN 15 (or `GET#`, one per call — `INPUT#` splits its input at a CR, a comma or a colon, so it is the wrong tool for raw bytes).

**A fragment that shows the answer.** Opens the command channel, asks for the four bytes at `$E5C4`, strips the end-marker bit and puts them at the top left of the screen (digits have the same code in PETSCII and in screen code):

```kick
show_drive_id:
    lda #15
    ldx #8
    ldy #15
    jsr $ffba          // SETLFS: logical file 15, device 8, channel 15
    lda #cmd_end-cmd
    ldx #<cmd
    ldy #>cmd
    jsr $ffbd          // SETNAM: the command text travels as the "filename"
    jsr $ffc0          // OPEN sends it
    bcs fail
    ldx #15
    jsr $ffc6          // CHKIN: channel 15 becomes the input channel
    ldy #0
loop:
    jsr $ffcf          // CHRIN: one reply byte per call
    and #$7f           // the string's last byte carries bit 7 as its end marker
    sta $0400,y
    lda #1
    sta $d800,y
    iny
    cpy #4
    bne loop
    jsr $ffcc          // CLRCHN
    lda #15
    jsr $ffc3          // CLOSE
fail:
    rts
cmd:
    .byte $4d, $2d, $52   // "M-R" in PETSCII
    .byte $c4, $e5        // address $E5C4, low byte first
    .byte $04             // byte count
cmd_end:
```

Run in VICE x64sc 3.10 (PAL) with `-drive8truedrive` and a freshly formatted `.d64` attached (rung 1): `-drive8type 1541`, `1542` (the 1541-II) and the default drive each put `1541` on the screen; `-drive8type 1571` puts `1571`; `-drive8type 1581` with a `.d81` puts four `$7F` glyphs, the `$FF` bytes with bit 7 stripped. Each glyph was matched against the character ROM's bitmap with zero differing pixels. With true drive emulation off the row stayed blank — the answer comes from the emulated drive's ROM, not from a VICE shortcut.

**`$41` is not a ROM byte.** The `$41` ("A") that detection routines sometimes go looking for is the DOS-version marker at offset 2 of the BAM sector, track 18 sector 0, written to the disk when it is formatted (rung 1: `c1541 -format test,01 d64 test.d64`, then byte 357 × 256 + 2 of the file reads `$41`). The 1541 ROM holds that constant at `$FED5` (VERNUM in the listing) and compares the BAM's byte against it. Testing for `$41` at `$E5C3` confuses the two: `$E5C3` is `$20`, the space between `V2.6` and `1541`, in every 1541-family image above, so such a test never passes.

One thing observed and not explained: in VICE, asserting ATN by hand with CLK left released did not get DATA pulled by the emulated 1541 within 330 ms, while ATN together with CLK — which is what the KERNAL does — did. Do as the KERNAL does; the mechanism was not chased.

---

## 1541 Drive ROM

The 1541 has its own 6502 at 1 MHz, 2 KiB of RAM at `$0000`–`$07FF` (rung 4) and 16 KiB of ROM at `$C000`–`$FFFF` (rung 1: the image is 16,384 bytes and its reset vector at `$FFFC` reads `$EAA0`). The firmware — CBM DOS 2.6 — runs the file system by itself; the C64 only ever talks to it over the bus.

Entry points, for reading a disassembly or for code uploaded with `M-W` and started with `M-E`. The bytes are rung 1 from the `dos1541-325302-01+901229-05` image and are identical in `dos1541ii-251968-03` and, except where the table says otherwise, in the 1540 image; the names are those of the g3sl.github.io listing, which takes them from *Inside Commodore DOS* (rung 4).

| Address | First bytes | Name | What it is |
|---|---|---|---|
| `$C100` | `78 A9 F7 2D 00 1C 48` | SETLDS | turn on the drive-active LED |
| `$CB20` | `B1 6F 85 85 AD 74 02 C9 06` | MEMRD | the `M-R` handler described above |
| `$D042` | `20 D1 F0 20 13 D3 20 0E D0` | INITDR | initialise the drive: read the BAM |
| `$E5B6` | `73 C3 42 4D 20 44 4F 53` | — | error table, entry 73: `CBM DOS V2.6 1541` (the 1540 has `V170` at `$E5C4`) |
| `$E85B` | `78 A9 00 85 7C 85 79 85 7A` | ATNSRV | ATN service: where the drive goes when the C64 asserts ATN |
| `$E909` | `78 20 EB D0 B0 06` | TALK | send bytes on the bus as talker |
| `$E9C9` | `A9 08 85 98 20 59 EA 20 C0 E9` | ACPTR | receive one byte from the bus |
| `$EBE7` | `58 AD 00 18 29 E5 8D 00 18` | IDLE | the idle loop; on entry it clears the DATA OUT, CLK OUT and ATNA bits of `$1800` |
| `$F4CA` | `C9 00 F0 03 4C 6E F5` | READ | job dispatch for a read job; not a sector read itself, and it hands anything else to WRIGHT |
| `$F56E` | `C9 10 F0 03 4C 91 F6` | WRIGHT | job dispatch for a write job |
| `$F5E9` | `A9 00 A8 51 30 C8 D0 FB 60` | CHKBLK | EOR checksum over the 256-byte data block |
| `$F78F` | `A9 00 85 30 85 2E 85 36 A9 BB` | BINGCR | convert the buffer to its GCR image |
| `$FED1` | `11 12 13 15` | — | sectors per track by zone index 0–3: 17, 18, 19, 21 |
| `$FED5` | `41` | VERNUM | the DOS-version byte the formatter writes into the BAM |
| `$FED7` | `24 1F 19 12` | MAXTRK | zone boundaries: 36, 31, 25, 18 |

The listing itself is at `https://g3sl.github.io/c1541rom.html`; it annotates the 325302-01 + 901229-01 pair, and the instruction it shows at each address above agrees with the -05 bytes quoted. Most fast loaders call none of this: they upload their own drive code with `M-W` and start it with `M-E`.

**Correction (2026-09-21).** The previous table was wrong in every row: `$C100` was called the "main idle/command loop" (it is the LED routine; the idle loop is `$EBE7`), `$E505` "bump head to track 1" (it is a data byte in the error-message table: `$E500`–`$E505` hold the numbers `20 21 22 23 24 27` that share one text, `$E505` is the last of them, `$27`, and `READ` starts at `$E506` with `$D2`), `$F5E9` "transmit byte via IEC" (the block checksum) and `$F78F` "receive byte via IEC" (the GCR conversion); `$D486` is OPNIWR, open an internal write channel, not the formatter, and `$C8B6` and `$C83C` are directory-entry deletion inside the scratch code, not sector read and write. It also pointed at `pagetable.com/c64ref/1541/`, which could not be reached from here to confirm it exists; the g3sl listing above was read.

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

The 1541's 6502 runs at 1 MHz from a 16 MHz crystal divided by sixteen — a fixed oscillator that has nothing to do with the disk. What changes with the track is the bit-cell clock: a programmable counter divides the same 16 MHz by 13, 14, 15 or 16 under two "density" bits, so the longer outer tracks are written denser in time and hold more sectors (rung 4: Ruud Baltissen's page on the 1541 board, which names a 74177 as the ÷16 stage and a 74LS193 as the counter the VIA's PB5/PB6 "density bits" preload, with divisors 13, 14, 15 and 16 for tracks 1–17, 18–24, 25–30 and 31–35 — not measured here). The ROM's half of that is rung 1: at `$F33C`–`$F358` the DOS compares the track against the boundary table at `$FED7` (36, 31, 25, 18), ending with a zone index of 3 for tracks 1–17 down to 0 for tracks 31–35, fetches the matching sectors-per-track from `$FED1` (21, 19, 18, 17 for indices 3 to 0), shifts the index left five places and writes it into bits 5–6 of `$1C00` with `LDA $1C00 / AND #$9F / ORA $44 / STA $1C00`. Index 3 is the fastest bit clock, index 0 the slowest.

Drives still vary — crystals have tolerances and spindles do not all turn at exactly 300 rpm — and a fast loader with cycle-counted loops on both ends has to leave room for that; the KERNAL protocol is immune because every bit is handshaken. The PAL/NTSC difference is on the C64 side only: 985,248 Hz against 1,022,727 Hz, while the drive is 1 MHz in both regions, so a loader that counts C64 cycles against drive cycles must know which C64 it is on. The `c64_pal_ntsc_diff` tool in this KB has the numbers.

**Correction (2026-09-21).** The earlier text said the drive CPU's clock was "derived from the disk rotation rate, synchronous with the GCR bit cells" and that "PAL C64 drives run at 985,248 Hz". Neither is so: the CPU clock is the crystal, only the bit clock is switched, and it is switched by track zone rather than by anything measured off the disk; the two frequencies quoted are the C64's, not the drive's.

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

VICE's 1541 emulation is accurate for correctness but the default configuration does not emulate the real-time IEC bus timing precisely. Programs that rely on cycle-counted timing in IEC routines (including some fastloaders) may work correctly in VICE but fail on real hardware, or vice versa. Use VICE's `-drive8truedrive` option (and `-drivesound` if you want to hear the head) to enable the more accurate (but slower) true-drive emulation during testing; an earlier version of this sentence spelled them `--drivesound 1 --drive8truedrive 1`, which x64sc 3.10 refuses — its options take a single dash and no argument.

The `c64_pal_ntsc_diff` MCP tool and `../hardware/pal-ntsc-reference.md` detail the clock-rate differences that affect CIA-timer-based IEC routines.

### CIA2 Contention: IEC Bus vs RS-232

CIA2 Port B (`$DD01`) is the user port's eight data lines (RS-232 or a parallel cable); Port A (`$DD00`) holds the IEC outputs in bits 3–5, the RS-232 TXD line in bit 2 and the VIC bank in bits 0–1. A parallel fast loader drives Port B freely — nothing there touches the bus — but every write to Port A must be a masked read-modify-write, and the bug to look for is a loader, or an interrupt handler switching VIC banks, that stores a whole byte to `$DD00` and thereby releases or asserts ATN, CLK or DATA. An earlier version of this paragraph had the IEC outputs at bits 2–4 and the fault on Port B; both were wrong.

Similarly, code that uses CIA2 for RS-232 (via the user port ACIA emulation) must ensure IEC I/O is not simultaneously active. The KERNAL does not serialize these; user code must guard access.

### Drive-Not-Ready and Timeout Errors

The KERNAL has one timeout on the bus, and it is short and narrow. The byte-send routine arms CIA1 timer B for about 1,024 cycles (it writes 4 to the timer's high byte at `$ED92`) while it waits for a listener to acknowledge; if nothing answers it sets the READST bit and returns, which is how an absent or unpowered drive is detected on the first byte of an OPEN. The talk turnaround and the byte-receive waits have no timeout at all: a drive that has accepted TALK and never pulls CLK leaves the CPU waiting for ever, which is the start-up hang measured in VICE and described on `recipes/oscar64/high-score-persist.md`. An earlier version of this page said "approximately 64 ms" and implied every stall returns; neither is so. Check READST after every OPEN/CHKIN/CHKOUT for the errors the KERNAL can report, and do not rely on it to return from a stalled transfer.

### Directory Track Corruption

Track 18 is the most-written track on a 1541. The directory and BAM are updated on every file write or scratch. Repeated use without a VALIDATE (`V0` command channel) command can produce a corrupted BAM — sectors marked allocated that are actually free, or vice versa. VALIDATE rebuilds the BAM by walking every file chain and reconstructing the bitmap. Running VALIDATE on a disk with active writes will abort any open file writes. The c1541 utility (bundled with VICE) can perform offline BAM repair.

---

## See Also

- `../runtime/vice-reference.md` — VICE emulator configuration for IEC/drive emulation
- `c64-file-formats.md` — Disk image formats (.D64, .D71, .D81, .G64)
- `../hardware/kernal-routines-reference.md` — KERNAL jump table: SETLFS, SETNAM, OPEN, CLOSE, CHKIN, CHKOUT, LOAD, SAVE, LISTEN, TALK, IECIN, IECOUT, READST, UNLSN, UNTLK

---

## Sources

- KERNAL ROM 901227-03 and the drive ROM images (1540 325302+3-01, 1541 325302-01+901229-05, 1541-II 251968-03, 1570 315090-01, 1571 310654-05, 1571CR 318047-01, 1581 318045-02) as shipped with VICE 3.10 in `/opt/homebrew/opt/vice/share/vice/C64/` and `…/DRIVES/` — every byte, address and instruction quoted above was read from these (rung 1).
- VICE x64sc 3.10, `-drive8truedrive`, drive types 1541, 1541-II, 1571 and 1581, and `c1541` — the `$DD00` readings, the reset-state reading, the `M-R` runs and the BAM byte (rung 1).
- *C1541 ROM disassembly with comments*, `https://g3sl.github.io/c1541rom.html` — the routine names SETLDS, MEMRD, INITDR, ATNSRV, TALK, ACPTR, IDLE, READ, WRIGHT, CHKBLK, BINGCR, VERNUM, MAXTRK and OPNIWR; the page credits its labels and comments to *Inside Commodore DOS* by Richard Immers and Gerald G. Neufeld, 1984 (rung 4).
- Ruud Baltissen, *1541: Transferring data*, `http://baltissen.org/newhtm/1541a.htm`, read directly — the 16 MHz clock, the 74177 ÷16 stage for the 6502, the 74LS193 counter preloaded from the VIA's PB5/PB6 density bits, and the divisors 13–16 by track zone (rung 4). An earlier draft of this list also cited the Commodore 1540/1541 Service Manual for those figures; it was not consulted, and the figures came from this page.
- The KERNAL labels CLKHI, CLKLO, DATAHI, DATALO, DEBPIA, SCATN, ISOUR and IOINIT are the names used in the published KERNAL source listings (rung 4).
