# C64 Memory Map

## Overview

The Commodore 64 has a flat 16-bit address space — exactly 65,536 bytes from
$0000 to $FFFF — but it ships with far more than 64 KB of physical storage.
Inside the machine there are 64 KB of dynamic RAM, 8 KB of BASIC ROM, 8 KB
of KERNAL ROM, 4 KB of character generator ROM, the 47-register VIC-II,
the 29-register SID, two CIA chips, and 1 KB of nibble-wide Color RAM. All
of those pieces have to share the single address bus the 6510 sees. They do
not coexist in parallel — they are *banked* in and out of view by a tiny
configuration latch built into the CPU itself.

The 6510 has six on-chip I/O pins that exit the chip alongside the address
and data buses. The lowest three of those pins (P0, P1, P2) drive the
PLA chip's bank-select inputs. Software controls them by writing the
data-direction register at $0000 (DDR) and the data register at $0001.
With three bits there are eight possible patterns; the PLA collapses them
into seven distinct memory layouts that swap chunks of RAM, ROM, and I/O
into the address space. Every C64 program — every game, every demo, every
copy-protection scheme — ultimately reduces to choosing one of those
seven configurations and writing to whatever happens to be visible.

This document maps the entire $0000-$FFFF address space, explains how
banking works, lists every fixed-purpose region of zero page, the stack
page, KERNAL workspace, ROM ranges, and the I/O area. It is the primary
reference for any code that needs to know "is this address RAM or ROM
right now?" or "what does the KERNAL clobber if I let it run?"

Memory addresses in this doc use the standard Commodore convention:
hexadecimal with a `$` prefix, four digits, uppercase. The dollar sign is
syntactically meaningful in 6502 assemblers and is the recognized
canonical form across the entire C64 documentation corpus. Decimal
equivalents are given where useful.

### The 64KB address space at a glance

| Range         | Contents (default after reset)               |
|---------------|----------------------------------------------|
| $0000-$0001   | 6510 processor port (DDR + data)             |
| $0002-$00FF   | Zero page (BASIC + KERNAL workspace + free)  |
| $0100-$01FF   | CPU stack                                    |
| $0200-$02FF   | KERNAL input buffer + workspace              |
| $0300-$03FF   | KERNAL vectors + workspace                   |
| $0400-$07E7   | Default screen RAM (40 × 25 = 1000 bytes)    |
| $07E8-$07FF   | Default sprite pointers                      |
| $0800-$9FFF   | BASIC program + variables / general user RAM |
| $A000-$BFFF   | BASIC ROM (or RAM under it)                  |
| $C000-$CFFF   | Free RAM (never banked, always present)      |
| $D000-$D3FF   | VIC-II registers (or character ROM, or RAM)  |
| $D400-$D7FF   | SID registers (or character ROM, or RAM)     |
| $D800-$DBFF   | Color RAM (4 bits wide; or character ROM)    |
| $DC00-$DCFF   | CIA #1 (or character ROM, or RAM)            |
| $DD00-$DDFF   | CIA #2 (or character ROM, or RAM)            |
| $DE00-$DEFF   | I/O expansion area 1 (cartridge)             |
| $DF00-$DFFF   | I/O expansion area 2 (cartridge)             |
| $E000-$FFFF   | KERNAL ROM (or RAM under it)                 |

### Hardware backing for each region

Address space is the CPU's view; *physical storage* is what the bytes
actually live in. The C64 has the following physical sources of bytes
visible to the CPU:

- 64 KB DRAM (eight 4164 chips), addressing the full $0000-$FFFF
- 8 KB KERNAL ROM, mapped at $E000-$FFFF when banked in
- 8 KB BASIC ROM, mapped at $A000-$BFFF when banked in
- 4 KB character ROM, mapped at $D000-$DFFF when banked in (charrom mode)
- 1 KB Color RAM (a separate 4-bit static RAM at $D800-$DBFF)
- VIC-II registers, mapped at $D000-$D02F (64-byte window, shadow-repeats
  through $D03F and the whole way to $D3FF as 64-byte mirrors)
- SID registers, mapped at $D400-$D41C (29 bytes; shadow-repeats every
  32 bytes through $D7FF)
- CIA #1 at $DC00-$DC0F (16 bytes; shadow-repeats every 16 bytes through $DCFF)
- CIA #2 at $DD00-$DD0F (16 bytes; shadow-repeats every 16 bytes through $DDFF)
- Cartridge ROMs and expansion-port I/O at $DE00-$DFFF and $8000-$9FFF
  and $A000-$BFFF (depending on cartridge type — GAME and EXROM lines)

The 64 KB of DRAM is always physically present at every address. When a
ROM is "banked in," the PLA disables the RAM's CAS line for reads only in
that range — writes still go to RAM. This is why you can poke a value into
$E000 even though KERNAL ROM is mapped there: the byte lands in the RAM
underneath and reveals itself if you bank the ROM out. This dual-write
behavior is critical for relocating screens, swapping in custom fonts,
and using $E000-$FFFF as 8 KB of additional RAM by banking KERNAL out.

### Reset state

When the CPU comes out of reset, the 6510 processor port is forced to a
known state. The DDR at $0000 is set to $2F (00101111, bits 0-3 + 5 are
outputs; bits 4 and 6 are inputs; bit 7 unused on stock C64). The data
register at $0001 is set to $37 (00110111). Bits 2-0 = 111 mean: BASIC
ROM in, KERNAL ROM in, I/O in (the default user layout).

The KERNAL initialization routine RAMTAS clears RAM $0002-$03FF, sets
zero-page pointers, clears the screen at $0400-$07FF, and installs the
default IRQ vector at $0314/$0315 pointing to $EA31. By the time BASIC's
"READY." prompt prints, the system is in mode 31 (the default seven-bank
configuration) with all ROMs visible.

### Banks vs banking — terminology

"Bank" is overloaded in C64 literature. Three distinct uses:

- **CPU bank** / **memory mode** / **mode N** (0-31): one of the 32
  configurations controlled by $01 bits 0-2 plus the GAME and EXROM lines
  from the cartridge port. Only 7 of the 32 are functionally distinct in
  the absence of a cartridge.
- **VIC-II bank** (0-3): a 16 KB window the VIC-II chip uses to fetch
  screen, character, sprite, and bitmap data. Selected by CIA #2 port A
  bits 0-1 (inverted). Bank 0 = $0000-$3FFF; bank 1 = $4000-$7FFF;
  bank 2 = $8000-$BFFF; bank 3 = $C000-$FFFF. See
  [vic-ii-reference.md](vic-ii-reference.md) for VIC-II bank details.
- **Bank** in the C128/REU sense: 64 KB chunks. Not applicable to a
  stock C64.

This doc covers CPU banks. VIC-II banking is independent and orthogonal —
the VIC sees its own memory map and never sees ROMs (with one wrinkle:
the character ROM is shadowed into VIC banks 0 and 2 at $1000-$1FFF and
$9000-$9FFF respectively).

### Sources

- *Mapping the Commodore 64* (Sheldon Leemon, Compute! Publications 1984;
  Project 64 transcription at zimmers.net) — the canonical zeropage and
  KERNAL workspace map.
- C64-Wiki Memory Map article — modern collation.
- sta.c64.org cbm64mem.html (Joe Forster/STA's "Commodore 64 Memory Map")
  — exhaustive per-byte zero-page reference.
- *Commodore 64 Programmer's Reference Guide* (Commodore, 1982) chapters 2 + 7.
- *The C64 PLA Dissected* (Thomas Giesel, 2010) for bank-select truth table.

## Quick reference

The address space resolves at each fetch through three layers:

1. **CPU pins** A0-A15 emit the address.
2. **PLA (906114)** sees A8-A15, the GAME/EXROM lines from the cartridge,
   and the LORAM/HIRAM/CHAREN lines from the 6510's processor port. It
   produces enable signals: CASRAM (RAM read enable), ROML/ROMH (cartridge
   ROM enables), KERNAL, BASIC, CHAROM, and I/O.
3. **Selected device** drives the data bus.

For most software the only thing that matters is the value at $01. Bits
2-0 of $01 control:

| $01 bit | Name    | 0 means                                 | 1 means                       |
|---------|---------|-----------------------------------------|-------------------------------|
| 0       | LORAM   | $A000-$BFFF is RAM                      | $A000-$BFFF can be BASIC ROM  |
| 1       | HIRAM   | $E000-$FFFF is RAM                      | $E000-$FFFF can be KERNAL ROM |
| 2       | CHAREN  | $D000-$DFFF is character ROM            | $D000-$DFFF is I/O            |

Higher bits of $01 are used for cassette control (bits 3-5) and the cassette
sense line (bit 4 input).

The seven distinct CPU bank configurations (with no cartridge attached —
GAME=1, EXROM=1) are summarized in the [Bank switching](#bank-switching)
section.

### Memory ranges that are always RAM

These ranges are always RAM regardless of $01 setting, on a stock C64 with
no cartridge:

- $0000-$0001 — processor port (special — see below)
- $0002-$9FFF — 40 KB of contiguous RAM
- $C000-$CFFF — 4 KB of free RAM

The remaining 20 KB ($A000-$BFFF, $D000-$DFFF, $E000-$FFFF) is the
multiplexed region.

### Memory ranges that change meaning

These ranges depend on $01 and cartridge lines:

- $A000-$BFFF — 8 KB: BASIC ROM, RAM, or cartridge ROM (ROMH)
- $D000-$DFFF — 4 KB: I/O, character ROM, or RAM
- $E000-$FFFF — 8 KB: KERNAL ROM, RAM, or cartridge ROM (ROMH in Ultimax)
- $8000-$9FFF — 8 KB: RAM, or cartridge ROM (ROML in 8K/16K/Ultimax)

## Memory regions

The following H3 entries cover the entire $0000-$FFFF address space. Each
region includes its default function on a freshly-booted C64, whether the
region is bank-switchable, and key sub-addresses or registers within it.

### $0000-$0001 — Processor I/O port

**Default use:** 6510 on-chip I/O port; controls memory banking and cassette
**Bank-switchable:** No (the port itself is on-die in the CPU and is always reachable)

The 6510 CPU has six general-purpose I/O pins that exit the chip on the
package pins normally unused by a stock 6502. These pins are made
accessible to software as memory locations $0000 (the data direction
register) and $0001 (the data register). The PLA reads three of those
pins to decide which ROMs are banked into the address space.

$0000 = DDR. Each bit decides whether the corresponding pin in $0001 is
an output (bit = 1) or an input (bit = 0).

$0001 = data. For output pins, the written value drives the pin. For
input pins, the value read reflects the pin's external state.

**Reset value:** DDR = $2F; data = $37.

After reset, bits 0-2 of $01 are outputs driving LORAM, HIRAM, CHAREN
high — selecting BASIC ROM + KERNAL ROM + I/O visible.

| Bit | Name      | I/O   | Function                                                              |
|-----|-----------|-------|-----------------------------------------------------------------------|
| 0   | LORAM     | Out   | 0 = $A000-$BFFF is RAM; 1 = BASIC ROM enabled (subject to HIRAM)      |
| 1   | HIRAM     | Out   | 0 = $E000-$FFFF is RAM; 1 = KERNAL ROM enabled                        |
| 2   | CHAREN    | Out   | 0 = $D000-$DFFF is char ROM (if HIRAM or LORAM); 1 = $D000-$DFFF I/O  |
| 3   | CASSDOUT  | Out   | Datasette write line                                                  |
| 4   | CASSSENS  | In    | Datasette sense (0 = button pressed)                                  |
| 5   | CASSMOT   | Out   | Datasette motor control (0 = motor on)                                |
| 6   | -         | -     | Unused on a stock C64 (pulled high)                                   |
| 7   | -         | -     | Unused on a stock C64 (pulled high)                                   |

**Notes:**
- **DDR must be set first.** When you write a new value to $01, the
  underlying CPU latches the value through the DDR mask. Bits configured
  as input ignore writes. If you intend to drive a pin, set the DDR
  bit to 1 first, then write the data register.
- **Reading $01 can be glitchy.** When CASSMOT is driving low (motor on)
  and you read $01, the input bit CASSSENS may read back as the most
  recent value the line was driven to during the cassette sense window;
  this is documented in *Mapping the Commodore 64* p. 32.
- **Bit 6/7 unconnected.** On a stock C64 these pins are not bonded out
  and read as their previous output state with very slow capacitive
  decay. *Do not rely on bit 6/7 values for anything.*

### $0002-$0002 — Unused / BASIC accumulator scratch

**Default use:** BASIC's "search pointer" temp; freely usable when BASIC is not running
**Bank-switchable:** No (always RAM)

Cleared at reset by RAMTAS to $00. BASIC uses this as a working register
during garbage collection and during the IO error code. Assembly programs
that don't call ROM routines can use this freely.

### $0003-$0004 — Float-to-fix vector

**Default use:** Vector to BASIC's float-to-fix conversion ($B1AA)
**Bank-switchable:** No (always RAM)

Patchable: if you want to override how BASIC converts floats to integers,
point this here. Pre-loaded by KERNAL RESTOR.

### $0005-$0006 — Fix-to-float vector

**Default use:** Vector to BASIC's fix-to-float conversion ($B391)
**Bank-switchable:** No (always RAM)

### $0007-$0008 — Search character / quote flag

**Default use:** BASIC tokenization workspace (current search char + quote-state flag)
**Bank-switchable:** No

### $0009-$000A — Input buffer pointer / dimension flag

**Default use:** BASIC keyboard input column counter and array-dim flag
**Bank-switchable:** No

### $000B-$000B — Type flags

**Default use:** Subscript-allowed / numeric-vs-string flag for BASIC
**Bank-switchable:** No

### $000C-$000C — DEF mode flag

**Default use:** BASIC DEF FN active flag
**Bank-switchable:** No

### $000D-$000D — Data type flag

**Default use:** $00 = numeric expression result, $FF = string
**Bank-switchable:** No

### $000E-$000E — Integer/float flag

**Default use:** $80 = integer, $00 = floating-point result
**Bank-switchable:** No

### $000F-$0010 — Garbage collection scratch

**Default use:** BASIC garbage-collection workspace and DATA pointer
**Bank-switchable:** No

### $0011-$0013 — Input source + LIST mode + scan offset

**Default use:** Subscript pointer and IO type code; LIST current line pointer
**Bank-switchable:** No

### $0014-$0015 — Line number temp

**Default use:** Temporary line number from BASIC text — used by GOTO, GOSUB, RUN, LIST
**Bank-switchable:** No

### $0016-$001A — String descriptor stack

**Default use:** Top of BASIC string descriptor stack (LASTPT, TEMPPT)
**Bank-switchable:** No

### $001B-$0021 — Misc BASIC workspace

**Default use:** String descriptor temp + index/temp pointers used by BASIC
**Bank-switchable:** No

### $0022-$0025 — INDEX1, INDEX2

**Default use:** General-purpose 16-bit pointers used by BASIC functions
**Bank-switchable:** No

Usable by assembly when BASIC is dormant.

### $0026-$002A — Floating-point accumulator C

**Default use:** Working register for BASIC's floating-point routines
**Bank-switchable:** No

### $002B-$002C — TXTTAB (start of BASIC program)

**Default use:** Pointer to first byte of stored BASIC program (default $0801)
**Bank-switchable:** No

Reset value: $0801. Set lower to relocate the BASIC program below the
screen; set higher to reserve memory below the program. After modifying
TXTTAB, set $0800 = $00 and run NEW so BASIC initializes the link bytes.

### $002D-$002E — VARTAB (start of BASIC variables)

**Default use:** Pointer to first byte past the tokenized BASIC program; start of simple variables
**Bank-switchable:** No

Set by BASIC at the end of every program edit. Reading VARTAB gives the
true end of the BASIC program in memory.

### $002F-$0030 — ARYTAB (start of arrays)

**Default use:** Pointer to first byte past simple variables; start of array storage
**Bank-switchable:** No

### $0031-$0032 — STREND (end of arrays)

**Default use:** Pointer to first byte past arrays; bottom of free memory
**Bank-switchable:** No

The 256-byte BASIC variable namespace lives between $002B and $0033 as a
chain of four pointers. The order is invariant: TXTTAB < VARTAB < ARYTAB
< STREND. STREND <= MEMSIZ (top-of-BASIC) always.

### $0033-$0034 — STRBOT (bottom of string descriptor heap)

**Default use:** Pointer to bottom of string heap (grows down from MEMSIZ)
**Bank-switchable:** No

Strings live at the top of BASIC's workspace and grow downward. The
distance between STREND and STRBOT is the available free memory before
garbage collection runs.

### $0035-$0036 — Unused / FRESPC

**Default use:** Pointer used during string concatenation; safe to clobber
**Bank-switchable:** No

### $0037-$0038 — MEMSIZ (top of BASIC)

**Default use:** Highest address BASIC can use (default $A000 on cold boot)
**Bank-switchable:** No

Lower MEMSIZ to reserve a chunk of high RAM for assembly code, custom
char sets, or sprite data. MEMSIZ is BASIC's hard cap — string heap
grows down from MEMSIZ.

### $0039-$003A — CURLIN (current BASIC line number)

**Default use:** Line number of currently-executing BASIC statement; $FFFF in immediate mode
**Bank-switchable:** No

A useful test: PEEK($39) + PEEK($3A) * 256 = current line, or 65535 in
direct mode.

### $003B-$003C — OLDLIN (previous BASIC line)

**Default use:** Line of last STOP, END, or CONT-able statement
**Bank-switchable:** No

### $003D-$003E — OLDTXT (previous BASIC text pointer)

**Default use:** Text pointer for CONT (continue) command
**Bank-switchable:** No

### $003F-$0040 — DATLIN (last DATA line number)

**Default use:** Line number containing the next DATA item for READ
**Bank-switchable:** No

### $0041-$0042 — DATPTR (next DATA pointer)

**Default use:** Pointer to next DATA byte to be read by READ
**Bank-switchable:** No

RESTORE sets DATPTR back to start of program.

### $0043-$0044 — INPTR (input vector)

**Default use:** Pointer to current INPUT character source
**Bank-switchable:** No

### $0045-$0046 — VARNAM (current variable name)

**Default use:** Two-character variable name being looked up
**Bank-switchable:** No

### $0047-$0048 — VARPNT (current variable pointer)

**Default use:** Pointer to variable value in BASIC variable space
**Bank-switchable:** No

### $0049-$004A — FORPNT (FOR loop pointer)

**Default use:** Pointer to FOR-loop control variable
**Bank-switchable:** No

### $004B-$0052 — Misc BASIC arithmetic / expression evaluation

**Default use:** Op stack temps for BASIC's expression evaluator
**Bank-switchable:** No

### $0053-$0053 — VALTYP (length of garbage-collection name)

**Default use:** Garbage-collection string length temporary
**Bank-switchable:** No

### $0054-$0056 — Jump-to-function temp

**Default use:** JMP instruction template used by BASIC to call function code
**Bank-switchable:** No

### $0057-$0060 — Floating-point accumulator #2 (ARG)

**Default use:** Second floating-point register used by BASIC math
**Bank-switchable:** No

### $0061-$0066 — Floating-point accumulator #1 (FAC)

**Default use:** Primary floating-point register; result of every BASIC math op
**Bank-switchable:** No

| Address | Meaning                                |
|---------|----------------------------------------|
| $0061   | Exponent                               |
| $0062-$0065 | Mantissa (4 bytes, MSB first)      |
| $0066   | Sign                                   |

### $0067-$006F — Polynomial evaluation workspace

**Default use:** Series-expansion temporaries for SIN/COS/LOG/EXP
**Bank-switchable:** No

### $0070-$0072 — CHRGET / CHRGOT

**Default use:** Inline BASIC routine that fetches the next program byte
**Bank-switchable:** No

The bytes at $0073-$008A actually contain machine-language code copied
in by KERNAL at reset — the CHRGET/CHRGOT subroutine that BASIC uses to
read its own tokenized program. The pointer used by CHRGET lives in
$007A/$007B (TXTPTR).

### $0073-$008A — CHRGET routine (executable code)

**Default use:** Inline machine code for BASIC's next-token reader
**Bank-switchable:** No

**Notes:**
- This block is *executable code in zeropage*. Overwriting it crashes BASIC.
- If you don't use BASIC (i.e. you're a pure assembly program that
  doesn't return to the READY prompt), this 24-byte range is free.

### $007A-$007B — TXTPTR (BASIC program pointer)

**Default use:** Pointer to next byte the BASIC interpreter will read
**Bank-switchable:** No

Embedded inside the CHRGET routine. Modifying TXTPTR changes where
BASIC reads its next statement — used by RUN, GOTO, GOSUB.

### $008B-$008F — RNDX (random number seed)

**Default use:** 5-byte floating-point seed for BASIC's RND function
**Bank-switchable:** No

### $0090-$0090 — STATUS (KERNAL I/O status)

**Default use:** I/O operation status flags; read by READST/CALLST
**Bank-switchable:** No

| Bit | Meaning (after IEC/cassette op)                  |
|-----|--------------------------------------------------|
| 0   | Time out write (IEC)                             |
| 1   | Time out read (IEC)                              |
| 2   | Short block (cassette)                           |
| 3   | Long block (cassette)                            |
| 4   | Unrecoverable read error (cassette)              |
| 5   | Checksum error (cassette)                        |
| 6   | EOI (end-of-info) line set on IEC                |
| 7   | Device not present (IEC)                         |

ST in BASIC reads this byte.

### $0091-$0091 — Stop key flag

**Default use:** Set to $7F if RUN/STOP key was depressed at last keyboard scan
**Bank-switchable:** No

Polled by the KERNAL STOP routine ($FFE1). $7F means STOP pressed
*alone*. Any other value means STOP not pressed.

### $0092-$0092 — Cassette timing constant

**Default use:** Timing adjustment for cassette read; KERNAL internal
**Bank-switchable:** No

### $0093-$0093 — LOAD/VERIFY flag

**Default use:** $00 = LOAD, $01 = VERIFY for the next ROM LOAD call
**Bank-switchable:** No

### $0094-$0094 — Serial output deferred char

**Default use:** Holds the next IEC byte to send (output buffer flag)
**Bank-switchable:** No

### $0095-$0095 — Serial deferred char

**Default use:** Buffered byte for IEC output
**Bank-switchable:** No

### $0096-$0096 — Cassette short-count

**Default use:** Cassette read short-count tracker
**Bank-switchable:** No

### $0097-$0097 — Temp for register save during IRQ

**Default use:** Y-register temp during IRQ entry to GETIN
**Bank-switchable:** No

### $0098-$0098 — Logical files open (LDTND)

**Default use:** Number of currently-open logical files; max 10
**Bank-switchable:** No

### $0099-$0099 — Default input device (DFLTN)

**Default use:** Current input device (0 = keyboard)
**Bank-switchable:** No

Used by CHKIN/CHRIN. Changed by CHKIN to redirect input from a file.

### $009A-$009A — Default output device (DFLTO)

**Default use:** Current output device (3 = screen)
**Bank-switchable:** No

Used by CHKOUT/CHROUT. Changed by CHKOUT to redirect output to a file.

### $009B-$009B — Parity byte (cassette / IEC)

**Default use:** Running parity during cassette/IEC byte transfer
**Bank-switchable:** No

### $009C-$009C — Byte-received flag

**Default use:** Flag for byte ready (IEC RS-232-ish protocols)
**Bank-switchable:** No

### $009D-$009D — Direct/program mode message flag

**Default use:** $80 = direct mode, $00 = program mode; controls KERNAL message printing
**Bank-switchable:** No

Set bit 7 = $80 to suppress KERNAL error messages. Read by KERNAL when
deciding whether to print "FILE NOT FOUND" etc.

### $009E-$009F — Cassette block-read pointer + byte temp

**Default use:** KERNAL cassette internal
**Bank-switchable:** No

### $00A0-$00A2 — Jiffy clock (TI variable)

**Default use:** 24-bit jiffy counter incremented by KERNAL IRQ; TI in BASIC
**Bank-switchable:** No

| Address | Meaning                  |
|---------|--------------------------|
| $00A0   | Jiffy MSB                |
| $00A1   | Jiffy middle byte        |
| $00A2   | Jiffy LSB                |

Incremented once every 1/60 s by the IRQ handler (UDTIM). Updates
*regardless* of region — PAL machines run a slightly fast TI clock
because the 50 Hz IRQ + the firmware update count produces a TI rate
faster than wall-clock seconds. See pal-ntsc-reference.md.

TI$ in BASIC formats the jiffy clock as "HHMMSS".

### $00A3-$00A4 — Serial bit count + cassette bit timer

**Default use:** Workspace for serial/cassette bit-banging
**Bank-switchable:** No

### $00A5-$00A6 — Cassette synchronization

**Default use:** Cassette sync mark counter
**Bank-switchable:** No

### $00A7-$00A8 — Serial-byte buffer + cycle counter

**Default use:** Cassette and serial-bus workspace
**Bank-switchable:** No

### $00A9-$00B1 — Tape header / file workspace

**Default use:** Workspace for OPEN, LOAD, SAVE tape protocols
**Bank-switchable:** No

### $00B2-$00B3 — Tape buffer pointer

**Default use:** Pointer to next byte in tape I/O buffer at $033C
**Bank-switchable:** No

### $00B4-$00BD — Cassette read/write internal state

**Default use:** Bit/byte/dword counters for tape protocol
**Bank-switchable:** No

### $00BE-$00BE — Tape block count

**Default use:** Number of tape blocks remaining
**Bank-switchable:** No

### $00BF-$00C0 — Serial output workspace

**Default use:** IEC clock-low timing constants
**Bank-switchable:** No

### $00C1-$00C2 — Memory pointer #1 / Filename source

**Default use:** Start-address pointer for LOAD/SAVE/VERIFY
**Bank-switchable:** No

Used by LOAD, SAVE, VERIFY to point to the buffer (or to the program
start when saving).

### $00C3-$00C4 — Tape end address / program end pointer

**Default use:** End-address pointer (one past last byte) for LOAD/SAVE
**Bank-switchable:** No

### $00C5-$00C5 — Last key pressed (matrix code)

**Default use:** Raw matrix index of last key scanned by IRQ; $40 = no key
**Bank-switchable:** No

Updated 60 times per second by the KERNAL IRQ. *Not* the PETSCII code —
this is the row/column matrix index 0-63. The actual key code goes
through KEYTAB ($EB81-$ECB9) to produce a PETSCII byte that gets
written to the keyboard buffer at $0277.

### $00C6-$00C6 — Number of chars in keyboard buffer (NDX)

**Default use:** Count of characters waiting in keyboard buffer; 0-10
**Bank-switchable:** No

Polled by GETIN. Stuff $C6 to a count and write characters to $0277-$0280
to simulate keyboard input.

### $00C7-$00C7 — Reverse-video flag

**Default use:** $00 = normal, $12 = reverse video; controls upcoming PRINT chars
**Bank-switchable:** No

### $00C8-$00C8 — End-of-line pointer

**Default use:** PRINT routine end-of-line column
**Bank-switchable:** No

### $00C9-$00CA — Cursor X/Y on input

**Default use:** Cursor position saved at INPUT command entry
**Bank-switchable:** No

### $00CB-$00CB — Key being processed

**Default use:** Current key matrix code being processed by IRQ
**Bank-switchable:** No

### $00CC-$00CC — Cursor enable flag

**Default use:** $00 = blink enabled, $01 = disabled (set to $01 to suppress cursor)
**Bank-switchable:** No

### $00CD-$00CD — Blink timer

**Default use:** Frames until next cursor blink
**Bank-switchable:** No

### $00CE-$00CE — Character under cursor

**Default use:** Screen code of the character the cursor is sitting on
**Bank-switchable:** No

### $00CF-$00CF — Cursor blink phase

**Default use:** $00 or $01 — which half of the blink cycle
**Bank-switchable:** No

### $00D0-$00D0 — Input from screen flag

**Default use:** $00 = keyboard input, $03 = screen scroll buffer input
**Bank-switchable:** No

### $00D1-$00D2 — Pointer to current screen line (PNT)

**Default use:** Address of first character of the line containing the cursor
**Bank-switchable:** No

The cursor line pointer. PNT + cursor X = the screen RAM byte for the
character about to be printed.

### $00D3-$00D3 — Cursor column (X)

**Default use:** Cursor column 0-39
**Bank-switchable:** No

### $00D4-$00D4 — Quote-mode flag

**Default use:** $01 = inside a quoted string in PRINT; controls control-char printing
**Bank-switchable:** No

### $00D5-$00D5 — Screen line length

**Default use:** 39 for unwrapped lines, 79 for logical wrapped lines
**Bank-switchable:** No

### $00D6-$00D6 — Cursor row (Y)

**Default use:** Cursor row 0-24
**Bank-switchable:** No

### $00D7-$00D7 — Last key shift state / temp char

**Default use:** Last PETSCII char output; shift state during keyscan
**Bank-switchable:** No

### $00D8-$00D8 — Insert count

**Default use:** Number of pending insert operations
**Bank-switchable:** No

### $00D9-$00F1 — Screen line link table

**Default use:** 25-byte table — for each row, high byte of line address + wrap flag
**Bank-switchable:** No

Bit 7 of each byte indicates whether that row is the continuation of a
logical 80-column line. The KERNAL uses this when handling cursor-down
across wrapped lines.

### $00F2-$00F2 — Insert mode count

**Default use:** Number of times INST/DEL was pressed in insert mode
**Bank-switchable:** No

### $00F3-$00F4 — Color RAM pointer

**Default use:** Pointer to current line's color RAM (PNT + $D800)
**Bank-switchable:** No

### $00F5-$00F6 — Keytable pointer

**Default use:** Pointer to one of four keyboard decode tables (selected by shift state)
**Bank-switchable:** No

### $00F7-$00F8 — RS-232 input buffer pointer

**Default use:** Pointer to user-allocated RS-232 input ring buffer
**Bank-switchable:** No

### $00F9-$00FA — RS-232 output buffer pointer

**Default use:** Pointer to user-allocated RS-232 output ring buffer
**Bank-switchable:** No

### $00FB-$00FE — Free zero-page

**Default use:** Unused by KERNAL or BASIC; 4 bytes of free zero-page for user code
**Bank-switchable:** No

**Notes:** These are the *only* four zero-page locations that both KERNAL
and BASIC are documented to leave alone. Assembly programs that coexist
with BASIC should preferentially use $FB-$FE for their hottest pointers.

### $00FF-$00FF — BASIC float-to-ASCII workspace

**Default use:** Temp byte used by BASIC's FOUT (float-to-string) routine
**Bank-switchable:** No

If BASIC's PRINT is not in use, $FF is free.

### $0100-$01FF — Stack page

**Default use:** 6510 hardware stack (S pointer descends from $01FF)
**Bank-switchable:** No

The 6510 has a single 8-bit stack pointer S that fixes the stack on
memory page 1 ($0100-$01FF). Pushes write to $0100+S then decrement S;
pulls increment S then read $0100+S. The stack grows downward from
$01FF toward $0100.

Initial value of S after KERNAL init is $FB (stack pointer at $01FB).
KERNAL has typically pushed a few bytes by the time control reaches
user code.

**Subdivisions:**

- $0100-$010F shared with tape buffer index in some workflows
- $01FA-$01FF reserved for KERNAL's deepest pushes during reset
- Floating-point ASCII conversion uses $0100-$010A as a temporary
  buffer (see *Mapping the C64* p. 39)

**Notes:**
- **Stack overflow wraps.** If S decrements past $00, it wraps to $FF
  and overwrites the top of the stack page. There is no overflow trap.
- **JSR pushes return-address-minus-one.** RTS pulls then increments.
  This affects manual stack manipulation.
- BASIC uses *much* more of the stack than a typical assembly program,
  especially with deep GOSUBs and nested FOR loops. Each GOSUB pushes
  5 bytes; each FOR pushes 18 bytes.

### $0200-$0258 — BASIC input buffer (BUF)

**Default use:** Direct-mode keyboard input buffer; lines from screen end up here
**Bank-switchable:** No

89-byte buffer. When you hit RETURN at the BASIC prompt, the screen line
under the cursor is copied to $0200-$0258 (or until 89 chars or RETURN
hits) and then tokenized.

### $0259-$0262 — Logical file table (LAT)

**Default use:** 10-entry table of logical file numbers passed to OPEN
**Bank-switchable:** No

### $0263-$026C — Device number table (FAT)

**Default use:** Device numbers for each open logical file
**Bank-switchable:** No

### $026D-$0276 — Secondary address table (SAT)

**Default use:** Secondary addresses for each open logical file
**Bank-switchable:** No

### $0277-$0280 — Keyboard buffer (KEYD)

**Default use:** PETSCII keystrokes waiting to be consumed by GETIN; max 10 chars
**Bank-switchable:** No

Stuff characters here and update NDX ($C6) to inject keystrokes — this
is how autostart utilities feed BASIC a "LOAD..." command after reset.

### $0281-$0282 — MEMSTR (start of basic memory)

**Default use:** Lowest address BASIC can use (default $0800)
**Bank-switchable:** No

### $0283-$0284 — MEMSIZ (top of memory)

**Default use:** Copy of top-of-RAM pointer set by MEMTOP at boot ($A000)
**Bank-switchable:** No

### $0285-$0285 — IEC timeout

**Default use:** Serial bus timeout flag
**Bank-switchable:** No

### $0286-$0286 — Current screen color (COLOR)

**Default use:** Current PRINT color — value 0-15 (next char printed uses this)
**Bank-switchable:** No

Loaded by KERNAL CHROUT with the upper-nibble color of any color control
char processed. Read by all subsequent PRINTs.

### $0287-$0287 — Color under cursor

**Default use:** Color RAM value the cursor is currently sitting over
**Bank-switchable:** No

### $0288-$0288 — Screen memory page

**Default use:** High byte of current screen RAM start ($04 = $0400)
**Bank-switchable:** No

Used by PLOT and CHROUT to compute screen addresses. Change this byte to
move the screen to a different page; also update VIC-II $D018 and the
line-link table to keep things consistent.

### $0289-$0289 — Keyboard buffer max size

**Default use:** Maximum chars allowed in keyboard buffer (default 10)
**Bank-switchable:** No

Lower this to zero to disable keyboard input; raise it to extend buffer
(buffer area is only 10 bytes; raising doesn't extend storage).

### $028A-$028A — Key repeat enable

**Default use:** Bit 7 set = all keys repeat; bit 6 set = only repeatable keys; 0 = no repeat
**Bank-switchable:** No

### $028B-$028C — Repeat speed counter / countdown

**Default use:** Frames between key repeats
**Bank-switchable:** No

### $028D-$028D — Shift / Ctrl / C= state

**Default use:** Bitmask of shift modifier keys held down this frame
**Bank-switchable:** No

| Bit | Meaning                                                   |
|-----|-----------------------------------------------------------|
| 0   | Left Shift                                                |
| 1   | Right Shift OR shift-lock                                 |
| 2   | Commodore key                                             |
| 3   | Control key                                               |

### $028E-$028E — Last shift state

**Default use:** Previous frame's $028D value (debouncing)
**Bank-switchable:** No

### $028F-$0290 — Keyscan table pointer

**Default use:** Vector to current keyboard decode table
**Bank-switchable:** No

### $0291-$0291 — Shift-lock / Commodore-shift switch

**Default use:** $00 = SHIFT+C= switches between upper/lower; $80 = locked
**Bank-switchable:** No

### $0292-$0292 — Scroll-down flag

**Default use:** $00 enables auto-scroll on cursor down past line 24
**Bank-switchable:** No

### $0293-$0297 — RS-232 workspace

**Default use:** Baud rate, parity, etc., for RS-232 implementation
**Bank-switchable:** No

### $0298-$029B — RS-232 status + buffer pointers

**Default use:** Software UART internal state
**Bank-switchable:** No

### $029C-$029F — RS-232 bit counters

**Default use:** Sample timing for software UART
**Bank-switchable:** No

### $02A0-$02A1 — RS-232 timer constants

**Default use:** CIA-derived bit timing constants for RS-232
**Bank-switchable:** No

### $02A2-$02FF — Unused / extra RS-232 workspace

**Default use:** Reserved; safe for user code if RS-232 is not in use
**Bank-switchable:** No

### $0300-$0301 — IERROR (BASIC error vector)

**Default use:** Pointer to BASIC's error-message routine; default $E38B
**Bank-switchable:** No

Patch this to intercept all BASIC errors. The KERNAL hand-off into
"ERROR" passes the error number in X.

### $0302-$0303 — IMAIN (BASIC warm-start vector)

**Default use:** Pointer to BASIC's input-loop routine; default $A483
**Bank-switchable:** No

Default is the BASIC interpreter ready-prompt loop. Patch this to take
control after every command.

### $0304-$0305 — ICRNCH (BASIC crunch / tokenize vector)

**Default use:** Pointer to BASIC's tokenize routine; default $A57C
**Bank-switchable:** No

### $0306-$0307 — IQPLOP (BASIC LIST vector)

**Default use:** Pointer to BASIC's de-tokenize routine; default $A71A
**Bank-switchable:** No

### $0308-$0309 — IGONE (BASIC execute-statement vector)

**Default use:** Pointer to BASIC's statement-dispatch routine; default $A7E4
**Bank-switchable:** No

### $030A-$030B — IEVAL (BASIC expression evaluator)

**Default use:** Pointer to BASIC's expression evaluator; default $AE86
**Bank-switchable:** No

### $030C-$030C — Saved A

**Default use:** Saved A register for SYS call argument-pass
**Bank-switchable:** No

### $030D-$030D — Saved X

**Default use:** Saved X for SYS
**Bank-switchable:** No

### $030E-$030E — Saved Y

**Default use:** Saved Y for SYS
**Bank-switchable:** No

### $030F-$030F — Saved P (flags)

**Default use:** Saved status flags for SYS
**Bank-switchable:** No

### $0310-$0312 — USR vector

**Default use:** USR()'s 3-byte jump instruction (JMP to user routine); set by USR()
**Bank-switchable:** No

### $0313-$0313 — Unused

**Default use:** Unused
**Bank-switchable:** No

### $0314-$0315 — CINV (IRQ vector)

**Default use:** Pointer to IRQ handler; default $EA31
**Bank-switchable:** No

**This is THE vector** for replacing the IRQ. Every C64 demo that does
raster effects writes to $0314/$0315 to point at its own raster handler.

### $0316-$0317 — CBINV (BRK vector)

**Default use:** Pointer to BRK handler; default $FE66
**Bank-switchable:** No

BRK instructions vector through here (which on a 6510 is the same line
as IRQ; the handler reads the B flag to distinguish).

### $0318-$0319 — NMINV (NMI vector)

**Default use:** Pointer to NMI handler; default $FE47
**Bank-switchable:** No

NMI fires on RESTORE key and on CIA #2 events. The default NMI handler
checks for RUN/STOP+RESTORE (warm boot) and returns.

### $031A-$031B — IOPEN

**Default use:** Pointer to OPEN logic; default $F34A
**Bank-switchable:** No

### $031C-$031D — ICLOSE

**Default use:** Pointer to CLOSE logic; default $F291
**Bank-switchable:** No

### $031E-$031F — ICHKIN

**Default use:** Pointer to CHKIN logic; default $F20E
**Bank-switchable:** No

### $0320-$0321 — ICKOUT

**Default use:** Pointer to CHKOUT logic; default $F250
**Bank-switchable:** No

### $0322-$0323 — ICLRCH

**Default use:** Pointer to CLRCHN logic; default $F333
**Bank-switchable:** No

### $0324-$0325 — IBASIN

**Default use:** Pointer to CHRIN; default $F157
**Bank-switchable:** No

Patching IBASIN intercepts all input from any device.

### $0326-$0327 — IBSOUT

**Default use:** Pointer to CHROUT; default $F1CA
**Bank-switchable:** No

Patching IBSOUT intercepts all output; the default lets KERNAL handle
character output, but games and demos hook here to add character filters,
implement custom screen managers, or capture printf-style debug streams.

### $0328-$0329 — ISTOP

**Default use:** Pointer to STOP-key check; default $F6ED
**Bank-switchable:** No

### $032A-$032B — IGETIN

**Default use:** Pointer to GETIN; default $F13E
**Bank-switchable:** No

### $032C-$032D — ICLALL

**Default use:** Pointer to CLALL; default $F32F
**Bank-switchable:** No

### $032E-$032F — User vector (USRCMD)

**Default use:** Generic user-command vector; default $FE66
**Bank-switchable:** No

### $0330-$0331 — ILOAD

**Default use:** Pointer to LOAD; default $F4A5
**Bank-switchable:** No

Patching ILOAD is the classic way to install a fastloader: when BASIC's
LOAD command runs, control goes through this vector instead of the
ROM's IEC-bus byte-banging routine.

### $0332-$0333 — ISAVE

**Default use:** Pointer to SAVE; default $F5ED
**Bank-switchable:** No

### $0334-$033B — Unused KERNAL workspace

**Default use:** Reserved; usually safe for user code
**Bank-switchable:** No

### $033C-$03FB — Cassette tape buffer

**Default use:** 192-byte tape I/O buffer
**Bank-switchable:** No

When the cassette is not in use, this 192-byte buffer is free RAM. It
is a popular place to hide small machine-language routines (raster
interrupt handlers, sprite editors). Programs that load themselves into
this buffer and then exit can survive a tape LOAD.

### $03FC-$03FF — Unused / sound workspace

**Default use:** Free RAM in default configuration
**Bank-switchable:** No

### $0400-$07E7 — Default screen RAM

**Default use:** 40 × 25 = 1000 screen-code character bytes
**Bank-switchable:** No (always RAM; the *VIC* sees this address through its VIC bank)

The screen at $0400 is the default location after a cold boot. The
VIC-II reads screen codes from here when fetching characters for the
text display. Writing a character code (0-255) to $0400+row*40+col
places that character on screen.

The screen code is *not* PETSCII — it is an 8-bit index into the
character generator. See [vic-ii-reference.md#screen-codes](vic-ii-reference.md#screen-codes)
for the mapping.

To move the screen: set the upper nibble of $D018 to point to a 1 KB
boundary inside the current VIC bank (4 × upper nibble = screen offset
in KB from base of VIC bank). Then update $0288 (the KERNAL's idea of
screen page) and the line-link table at $D9-$F1.

### $07E8-$07FF — Default sprite pointers

**Default use:** 8 bytes — one sprite pointer per hardware sprite (0-7)
**Bank-switchable:** No (RAM region; visible to VIC inside VIC bank)

The eight bytes at the *very end* of screen memory hold the sprite
pointers. Each byte's value × 64 is the address (within the current
VIC bank) of that sprite's 63-byte data block.

By default sprite 0's data pointer is at $07F8, sprite 1's at $07F9, etc.
If you relocate the screen, the sprite pointers move too (always 1016
bytes past the start of screen RAM).

### $0800-$9FFF — BASIC program area / general user RAM

**Default use:** Tokenized BASIC program + variables + free user RAM (38.4 KB)
**Bank-switchable:** No (always RAM; only $A000-$BFFF can swap to ROM)

**Subdivisions on cold boot:**

- $0800 = zero byte (BASIC program-start sentinel; mandatory)
- $0801-VARTAB = tokenized BASIC program
- VARTAB-ARYTAB = simple variables
- ARYTAB-STREND = arrays
- STREND-STRBOT = free RAM
- STRBOT-MEMSIZ = string descriptor heap (grows down)

**Notes:**
- A pure-assembly program with no BASIC stub can use $0801-$9FFF as 38 KB
  of contiguous free RAM.
- Loading at $0801 with a BASIC stub like `1 SYS 2061` is the canonical
  way to autostart a machine-language program (2061 = $080D, the address
  just past the stub).
- The screen at $0400-$07FF is a separate region — *not* part of the BASIC
  area despite being lower in memory.

### $0800-$0800 — BASIC start sentinel

**Default use:** Always $00; BASIC program-start marker
**Bank-switchable:** No

### $0801-$9EFF — BASIC program + variables + free RAM

**Default use:** Tokenized BASIC + variables + heap
**Bank-switchable:** No

### $9F00-$9FFF — Top of BASIC RAM (just below ROM boundary)

**Default use:** Last 256 bytes of contiguous free RAM before $A000 ROM/RAM switch
**Bank-switchable:** No

### $A000-$BFFF — BASIC ROM region

**Default use:** 8 KB of BASIC interpreter ROM (when LORAM = 1 and HIRAM = 1)
**Bank-switchable:** Yes — see [Bank switching](#bank-switching)

The BASIC interpreter lives here on a fresh boot. Bank out by clearing
LORAM ($01 bit 0) to reveal the 8 KB of RAM underneath. The RAM is
*always there* — writes to $A000-$BFFF always go to RAM. Reads return
ROM bytes only when the BASIC ROM is banked in.

**Notes:**
- This is the standard place to put a 256-cell character set (only need
  2 KB at $1000 or $3000 inside the VIC bank — but the underlying RAM
  here is sometimes used for sprite data or extra screen pages).
- Cartridges may map their ROMH here (16 KB cart): the cartridge port's
  EXROM/GAME lines override LORAM/HIRAM behavior. See
  [Bank switching](#bank-switching) modes 8 and 16.

### $A000-$A00B — BASIC cold-start vectors

**Default use:** Cold-start jump table — first 12 bytes of BASIC ROM
**Bank-switchable:** Yes

| Address  | Content      | Meaning                         |
|----------|--------------|---------------------------------|
| $A000    | $94 $E3      | Cold-start vector (jumps $E394) |
| $A002    | $7B $E3      | Warm-start vector ($E37B)       |
| $A004    | $43 $42 $4D…  | "CBMBASIC" ID string           |

The cold-start vector at $A000-$A001 is what the KERNAL JSRs after RAM
test to start BASIC. Cartridge auto-start works by mapping a cart ROM
into $A000-$BFFF whose first 9 bytes are `xx yy zz zz $C3 $C2 $CD $38 $30`
("CBM80" magic) — the KERNAL recognizes this and jumps to the cartridge
warm-start vector.

### $A00C-$A47F — BASIC keyword tables + dispatch

**Default use:** Token tables, error messages, message printing
**Bank-switchable:** Yes

### $A480-$A52A — BASIC main loop

**Default use:** Ready-prompt loop, line-tokenize entry point
**Bank-switchable:** Yes

### $A52B-$A659 — BASIC editor (NEW, CLR, LIST)

**Default use:** Routines for line-edit commands
**Bank-switchable:** Yes

### $A65A-$A833 — BASIC RUN, GOTO, GOSUB, FOR, NEXT

**Default use:** Control-flow statement handlers
**Bank-switchable:** Yes

### $A834-$A9A4 — Expression evaluator + variable lookup

**Default use:** EVAL routine, VARDEF, dimensions
**Bank-switchable:** Yes

### $A9A5-$AB45 — String functions (CHR$, LEFT$, MID$, etc.)

**Default use:** String manipulation primitives
**Bank-switchable:** Yes

### $AB46-$AF7D — Print routines, I/O statements

**Default use:** PRINT, INPUT, GET, READ, OPEN, CLOSE
**Bank-switchable:** Yes

### $AF7E-$BAE1 — Floating-point math package

**Default use:** Add, subtract, multiply, divide, transcendentals
**Bank-switchable:** Yes

This is the famous "Microsoft BASIC math" — the routines at $B6DB (FADD)
through $BAE1 are useful enough that demo coders sometimes bank in BASIC
just to call them.

### $BAE2-$BFFF — Initialization, sign-on message, IO error handler

**Default use:** Cold-start initialization, BASIC error vector, "READY." message
**Bank-switchable:** Yes

### $C000-$CFFF — Free RAM (never banked)

**Default use:** 4 KB of always-RAM, never overlaid by any ROM or I/O
**Bank-switchable:** No

This 4 KB region is special: it is the **largest contiguous chunk of RAM
guaranteed to be RAM in every bank configuration**. Cartridges can't map
here; KERNAL doesn't touch it; BASIC doesn't use it.

Everyone uses $C000 for machine-language routines that need to coexist
with BASIC. The canonical pattern is to write a BASIC loader that POKEs
a small ML routine into $C000 and then SYS 49152 to call it.

**Notes:**
- Some software uses $C800-$CFFF as a 2 KB custom character set since
  it falls within VIC bank 3 at $C000-$FFFF — but only after relocating
  the VIC bank. By default the VIC sees bank 0 ($0000-$3FFF) and would
  not fetch from $C000.
- Cassette I/O does NOT use $C000-$CFFF (it uses $033C-$03FB only).

### $D000-$D02E — VIC-II registers

**Default use:** 47 VIC-II registers (when CHAREN = 1 and I/O is banked in)
**Bank-switchable:** Yes — character ROM or RAM replaces this when CHAREN = 0

Full per-register details are in [vic-ii-reference.md](vic-ii-reference.md).

| Range       | Function                                       |
|-------------|------------------------------------------------|
| $D000-$D00F | Sprite X/Y positions (8 sprites × 2 bytes)     |
| $D010       | Sprite X MSBs                                  |
| $D011       | Screen control 1 / Y-scroll / display enable   |
| $D012       | Raster compare / current raster line           |
| $D013-$D014 | Light pen X, Y (latched)                       |
| $D015       | Sprite enable                                  |
| $D016       | Screen control 2 / X-scroll / 38-col           |
| $D017       | Sprite Y expand                                |
| $D018       | Memory pointers (video matrix / charset)       |
| $D019       | IRQ status (write 1 to clear)                  |
| $D01A       | IRQ mask                                       |
| $D01B       | Sprite-to-background priority                  |
| $D01C       | Sprite multicolor enable                       |
| $D01D       | Sprite X expand                                |
| $D01E-$D01F | Collision registers (sprite-sprite / sprite-BG)|
| $D020-$D024 | Border + background colors                     |
| $D025-$D026 | Sprite multicolor (shared)                     |
| $D027-$D02E | Sprite 0-7 individual colors                   |

### $D02F-$D03F — VIC-II unused / shadow padding

**Default use:** Unused; reads as $FF
**Bank-switchable:** Yes

### $D040-$D3FF — VIC-II shadow mirrors

**Default use:** $D000-$D03F repeats every 64 bytes through $D3FF
**Bank-switchable:** Yes

Reading $D040 returns the same value as $D000, and so on. Avoid relying
on this — direct-address all VIC writes in the $D000-$D03F window.

### $D400-$D418 — SID registers

**Default use:** 25 SID write registers (voice control, filter, master volume)
**Bank-switchable:** Yes — character ROM or RAM replaces this when CHAREN = 0

Full per-register details are in [sid-reference.md](sid-reference.md).

| Range       | Function                                       |
|-------------|------------------------------------------------|
| $D400-$D406 | Voice 1 (freq lo/hi, pulse lo/hi, ctrl, AD, SR)|
| $D407-$D40D | Voice 2 (same layout)                          |
| $D40E-$D414 | Voice 3 (same layout)                          |
| $D415-$D416 | Filter cutoff lo/hi                            |
| $D417       | Filter resonance / voice routing               |
| $D418       | Master volume + filter type select             |

### $D419-$D41C — SID read registers

**Default use:** Paddle X/Y, oscillator 3 / envelope 3 readback
**Bank-switchable:** Yes

| Addr   | Function                                  |
|--------|-------------------------------------------|
| $D419  | Paddle X (POTX)                           |
| $D41A  | Paddle Y (POTY)                           |
| $D41B  | Voice 3 oscillator readback (OSC3)        |
| $D41C  | Voice 3 envelope readback (ENV3)          |

### $D41D-$D41F — SID unused

**Default use:** Reads return last data-bus value (open bus)
**Bank-switchable:** Yes

### $D420-$D7FF — SID shadow mirrors

**Default use:** $D400-$D41F repeats every 32 bytes through $D7FF
**Bank-switchable:** Yes

Like the VIC mirrors, every 32-byte block from $D420 onward is an alias
of $D400-$D41F. The SID's last register $D41C cuts off at 29; writes to
$D41D-$D41F have no effect.

### $D800-$DBE7 — Color RAM (visible 1000 bytes)

**Default use:** 4-bit color attribute per character cell on screen
**Bank-switchable:** Yes — character ROM replaces this when CHAREN = 0

The Color RAM is a separate 1024 × 4-bit static RAM chip. Each byte
corresponds positionally with screen RAM at $0400-$07E7: writing $1
to $D800 makes the character at top-left ($0400) display as color 1
(white).

Only the lower 4 bits matter; the upper 4 bits are open bus and read
random values. *Always mask with #$0F when reading Color RAM*.

### $D8E8-$DBFF — Color RAM (unused 24 bytes)

**Default use:** 24 bytes of Color RAM not aligned with any visible cell
**Bank-switchable:** Yes

The Color RAM is 1024 bytes but only 1000 cells are on screen. The
trailing 24 bytes ($D8E8-$DBFF or — more typically — the bytes positioned
just past the last screen cell) are still RAM and can hold 24 nibbles
of program state.

### $DC00-$DC0F — CIA #1 registers

**Default use:** Keyboard scan, joystick port 2, IRQ timer
**Bank-switchable:** Yes — character ROM or RAM replaces this when CHAREN = 0

Full details in [cia-reference.md](cia-reference.md).

| Addr   | Function                                        |
|--------|-------------------------------------------------|
| $DC00  | Data port A (keyboard col output, joy 2)        |
| $DC01  | Data port B (keyboard row input, joy 1)         |
| $DC02  | Data direction A                                |
| $DC03  | Data direction B                                |
| $DC04  | Timer A low                                     |
| $DC05  | Timer A high                                    |
| $DC06  | Timer B low                                     |
| $DC07  | Timer B high                                    |
| $DC08  | TOD tenths                                      |
| $DC09  | TOD seconds                                     |
| $DC0A  | TOD minutes                                     |
| $DC0B  | TOD hours                                       |
| $DC0C  | Serial shift register                           |
| $DC0D  | Interrupt control                               |
| $DC0E  | Control A                                       |
| $DC0F  | Control B                                       |

CIA #1's IRQ line drives the 6510's IRQ pin. The KERNAL's 60 Hz IRQ
ticks via CIA #1 Timer A.

### $DC10-$DCFF — CIA #1 shadow mirrors

**Default use:** $DC00-$DC0F repeats every 16 bytes through $DCFF
**Bank-switchable:** Yes

### $DD00-$DD0F — CIA #2 registers

**Default use:** Serial IEC bus, VIC-II bank select, RS-232 port, user port
**Bank-switchable:** Yes

| Addr   | Function                                        |
|--------|-------------------------------------------------|
| $DD00  | Data port A (IEC bus + VIC-II bank select bits) |
| $DD01  | Data port B (user port / RS-232)                |
| $DD02  | Data direction A                                |
| $DD03  | Data direction B                                |
| $DD04  | Timer A low                                     |
| $DD05  | Timer A high                                    |
| $DD06  | Timer B low                                     |
| $DD07  | Timer B high                                    |
| $DD08  | TOD tenths                                      |
| $DD09  | TOD seconds                                     |
| $DD0A  | TOD minutes                                     |
| $DD0B  | TOD hours                                       |
| $DD0C  | Serial shift register                           |
| $DD0D  | Interrupt control                               |
| $DD0E  | Control A                                       |
| $DD0F  | Control B                                       |

CIA #2's IRQ line drives the 6510's NMI pin (not IRQ). The RESTORE key
also generates an NMI through CIA #2.

**$DD00 bits 0-1** select the VIC-II bank, *inverted*:

| Bits | VIC bank | Address range  |
|------|----------|----------------|
| 11   | 0        | $0000-$3FFF    |
| 10   | 1        | $4000-$7FFF    |
| 01   | 2        | $8000-$BFFF    |
| 00   | 3        | $C000-$FFFF    |

### $DD10-$DDFF — CIA #2 shadow mirrors

**Default use:** $DD00-$DD0F repeats every 16 bytes through $DDFF
**Bank-switchable:** Yes

### $DE00-$DEFF — I/O expansion area 1

**Default use:** Cartridge I/O area 1 (mapped only when a cartridge presents I/O)
**Bank-switchable:** Yes — open bus when no cartridge present

On a bare machine, reads from $DE00-$DEFF return open-bus values
(usually echoes of the most recent VIC fetch). Cartridges with an
I/O space (REU, geoRAM, IDE64, etc.) decode their registers here.

### $DF00-$DFFF — I/O expansion area 2

**Default use:** Cartridge I/O area 2 (mapped only when a cartridge presents I/O)
**Bank-switchable:** Yes — open bus when no cartridge present

Same logic as area 1. The REU at $DF00-$DF0A is the most prominent user.

### $E000-$FFFF — KERNAL ROM region

**Default use:** 8 KB of KERNAL ROM (when HIRAM = 1)
**Bank-switchable:** Yes — bank out by clearing HIRAM ($01 bit 1)

Holds the I/O routines, IRQ handler, BRK handler, NMI handler,
character output, screen editor, IEC bus driver, cassette driver, RS-232
driver, and the public jump table at $FF81-$FFF5.

Writes to $E000-$FFFF go to RAM regardless of HIRAM. To use this 8 KB
as RAM, bank out KERNAL and read it back: `LDA #$35 / STA $01` puts
KERNAL out and I/O still in.

### $E000-$E04A — KERNAL initialization

**Default use:** Boot routine, hardware init, sign-on
**Bank-switchable:** Yes

### $E04B-$E394 — Screen editor (CRT driver)

**Default use:** Screen scroll, character print, cursor management
**Bank-switchable:** Yes

### $E395-$E4AB — BASIC cold-start, vectors setup, RAMTAS

**Default use:** Boot-time RAM check, vector table copy, BASIC entry
**Bank-switchable:** Yes

### $E4AC-$E5C9 — Keyboard scan (IRQ handler component)

**Default use:** Keyboard matrix decode, key-repeat logic, modifier tracking
**Bank-switchable:** Yes

### $E5CA-$E775 — Screen scroll, color, line linkage

**Default use:** Line wrap, screen-bottom scroll, line link table maintenance
**Bank-switchable:** Yes

### $E716-$E97C — Character print, cursor positioning (CHROUT body)

**Default use:** Bottom of CHROUT logic — character print, color attribute write
**Bank-switchable:** Yes

### $E97D-$EA30 — IRQ handler (default)

**Default use:** KERNAL's default IRQ handler — keyboard scan + jiffy + cursor blink
**Bank-switchable:** Yes

The default IRQ handler at $EA31 is what $0314/$0315 points to. It:

1. Acknowledges CIA #1 IRQ (LDA $DC0D).
2. Calls UDTIM ($FFEA) to bump the jiffy clock.
3. Calls the keyscan routine.
4. Updates the cursor blink.
5. RTI.

Replacing $0314/$0315 with your own handler lets you intercept this
sequence — typically you call the default at $EA31 (or $EA7E for a
shorter path that skips the cursor) after your raster routine completes.

### $EA31-$EA7E — Default IRQ entry / cursor-blink path

**Default use:** Full IRQ chain including cursor + keyscan
**Bank-switchable:** Yes

### $EA7E-$EC00 — Alternate IRQ paths, RUN/STOP, RESTORE handlers

**Default use:** Branches into IRQ for various edge cases
**Bank-switchable:** Yes

### $EC00-$ECE6 — Character set 1 alternate code, screen-clear, color clear

**Default use:** Switching between upper/lower case + screen utility code
**Bank-switchable:** Yes

### $ECE7-$ED08 — Keyboard decode tables (KEYTAB)

**Default use:** PETSCII lookup tables for keyboard matrix → ASCII
**Bank-switchable:** Yes

### $ED09-$EE12 — IEC bus driver (LISTEN/TALK/SECOND/TKSA)

**Default use:** Serial bus low-level send + receive
**Bank-switchable:** Yes

### $EE13-$EF93 — IEC bus data routines (CIOUT, CIIN, UNLSN, UNTLK)

**Default use:** Byte-at-a-time IEC bus data path
**Bank-switchable:** Yes

### $EF94-$F12F — RS-232 driver

**Default use:** Software UART (baud rate, parity, framing) using CIA #2 NMI
**Bank-switchable:** Yes

### $F130-$F156 — STATUS, SETMSG, MEMTOP, MEMBOT

**Default use:** Small utility routines
**Bank-switchable:** Yes

### $F157-$F1F4 — CHRIN, BASIN

**Default use:** Get-a-char-from-current-input-device
**Bank-switchable:** Yes

### $F1F5-$F33F — CHROUT, BSOUT, CHKIN, CHKOUT, CLRCHN

**Default use:** Output / channel switching
**Bank-switchable:** Yes

### $F340-$F4A4 — CLALL, CLOSE, OPEN

**Default use:** File-system operations
**Bank-switchable:** Yes

### $F4A5-$F5EC — LOAD

**Default use:** Top-level LOAD that calls device-specific routines
**Bank-switchable:** Yes

### $F5ED-$F69B — SAVE

**Default use:** Top-level SAVE
**Bank-switchable:** Yes

### $F69C-$F7AF — VERIFY, MEMTOP/MEMBOT defaults

**Default use:** LOAD compare; memory pointer setters
**Bank-switchable:** Yes

### $F7B0-$F900 — Cassette LOAD/SAVE routines

**Default use:** Tape protocol primitives
**Bank-switchable:** Yes

### $F901-$FB54 — Disk LOAD/SAVE (IEC-bus protocol)

**Default use:** Drive interaction for LOAD/SAVE via IEC
**Bank-switchable:** Yes

### $FB55-$FCFB — Cassette buffer manipulation, additional tape protocol

**Default use:** Cassette block read/write, tape header processing
**Bank-switchable:** Yes

### $FCFC-$FD2F — RESET handler

**Default use:** Hardware reset entry; sets up DDR and bank to mode 31
**Bank-switchable:** Yes

The first code that runs after the CPU comes out of reset. Entered via
the reset vector at $FFFC.

### $FD30-$FD8F — KERNAL vectors initialization

**Default use:** Copies default vector table to $0314-$0333
**Bank-switchable:** Yes

### $FD90-$FF47 — More initialization, RAMTAS, miscellaneous

**Default use:** RAM test, screen clear, hardware init
**Bank-switchable:** Yes

### $FF48-$FF80 — IRQ + BRK dispatchers

**Default use:** Save registers, dispatch through $0314 or $0316
**Bank-switchable:** Yes

### $FF81-$FFA5 — KERNAL routine jump table (Editor + new)

**Default use:** Public jump table entries for CINT, IOINIT, RAMTAS, RESTOR, VECTOR
**Bank-switchable:** Yes

| $FF81 | CINT    | Initialize screen editor              |
| $FF84 | IOINIT  | Initialize I/O                        |
| $FF87 | RAMTAS  | Initialize RAM, allocate workspace    |
| $FF8A | RESTOR  | Restore default I/O vectors           |
| $FF8D | VECTOR  | Read/set indirect vectors             |
| $FF90 | SETMSG  | Control KERNAL messages               |
| $FF93 | SECOND  | Send secondary address after LISTEN   |
| $FF96 | TKSA    | Send secondary address after TALK     |
| $FF99 | MEMTOP  | Set/read top of memory                |
| $FF9C | MEMBOT  | Set/read bottom of memory             |
| $FF9F | SCNKEY  | Scan keyboard                         |
| $FFA2 | SETTMO  | Set IEC bus timeout                   |

### $FFA5-$FFC0 — KERNAL jump table (IEC bus)

**Default use:** IEC bus jump entries
**Bank-switchable:** Yes

| $FFA5 | IECIN   | Read byte from IEC bus                |
| $FFA8 | IECOUT  | Write byte to IEC bus                 |
| $FFAB | UNTLK   | Send UNTALK on IEC bus                |
| $FFAE | UNLSN   | Send UNLISTEN on IEC bus              |
| $FFB1 | LISTEN  | Command device on IEC to LISTEN       |
| $FFB4 | TALK    | Command device on IEC to TALK         |
| $FFB7 | READST  | Read I/O STATUS                       |
| $FFBA | SETLFS  | Set logical file params               |
| $FFBD | SETNAM  | Set filename                          |

### $FFC0-$FFE5 — KERNAL jump table (File I/O + Char I/O)

**Default use:** Public entry points for KERNAL routines
**Bank-switchable:** Yes

| $FFC0 | OPEN    | Open a logical file                   |
| $FFC3 | CLOSE   | Close a logical file                  |
| $FFC6 | CHKIN   | Set input channel                     |
| $FFC9 | CHKOUT  | Set output channel                    |
| $FFCC | CLRCHN  | Restore default I/O                   |
| $FFCF | CHRIN   | Get char from current input           |
| $FFD2 | CHROUT  | Output char to current output         |
| $FFD5 | LOAD    | Load file from device                 |
| $FFD8 | SAVE    | Save file to device                   |
| $FFDB | SETTIM  | Set jiffy clock                       |
| $FFDE | RDTIM   | Read jiffy clock                      |
| $FFE1 | STOP    | Check if STOP key pressed             |
| $FFE4 | GETIN   | Get char from queue (non-blocking)    |

### $FFE6-$FFF5 — KERNAL jump table (close-all, etc.)

**Default use:** Final entries of the public jump table
**Bank-switchable:** Yes

| $FFE7 | CLALL   | Close all files                       |
| $FFEA | UDTIM   | Update jiffy clock + STOP flag        |
| $FFED | SCREEN  | Return screen dimensions              |
| $FFF0 | PLOT    | Read/set cursor row/col               |
| $FFF3 | IOBASE  | Return base address of CIA #1         |

### $FFFA-$FFFB — NMI vector

**Default use:** Pointer to NMI handler ($FE43 in KERNAL ROM)
**Bank-switchable:** Yes — if KERNAL banked out, this is RAM and you must write your own vector

The CPU reads $FFFA/$FFFB on every NMI to find the handler address. In
the default config this is in KERNAL ROM and points to the chained NMI
handler that dispatches through $0318.

### $FFFC-$FFFD — Reset vector

**Default use:** Pointer to RESET handler ($FCE2 in KERNAL ROM)
**Bank-switchable:** Yes

Read by the CPU on power-on and on the hardware RESET line.

### $FFFE-$FFFF — IRQ / BRK vector

**Default use:** Pointer to IRQ/BRK handler ($FF48 in KERNAL ROM)
**Bank-switchable:** Yes — if KERNAL banked out, must point at user-supplied handler

The CPU reads $FFFE/$FFFF on every IRQ and BRK. With KERNAL banked in,
this points at $FF48 which saves registers and then JMPs through
$0314 (IRQ) or $0316 (BRK).

**Crucial:** If you bank out KERNAL ROM ($01 = $35 or lower) and IRQ
fires, the CPU reads $FFFE/$FFFF *from RAM*. You must have pre-loaded
RAM bytes at $FFFE/$FFFF with the address of your own IRQ handler before
banking out, or the machine will crash. Same for NMI ($FFFA/$FFFB) and
RESET ($FFFC/$FFFD).

## Bank switching

The 6510 sees a 64 KB address space but the C64 holds more memory than
that. The PLA (programmable logic array, MOS 906114) decides, at every
memory access, which physical resource the CPU is talking to. Its
inputs are:

- **A15-A12** — the high nibble of the address bus, which selects the
  4 KB chunk.
- **R/W** — distinguishes reads from writes.
- **LORAM, HIRAM, CHAREN** — the three configurable processor-port pins
  from $01 bits 0, 1, 2.
- **GAME, EXROM** — the two cartridge-port lines, pulled high (1) when
  no cart is present.

The PLA hardwires 32 possible input combinations into seven distinct
output configurations (plus a few cartridge-only modes). These are the
**memory modes** — sometimes called **banks** in PLA literature.

Software running on a bare C64 (no cart) sees five practically-useful
configurations and two rarely-used edge cases.

### Mode 31 — default (BASIC + KERNAL + I/O)

**$01 value:** $37 (or any value with bits 0-2 = 111)
**LORAM:** 1, **HIRAM:** 1, **CHAREN:** 1

| Range        | Contents     |
|--------------|--------------|
| $0000-$0FFF  | RAM          |
| $1000-$7FFF  | RAM          |
| $8000-$9FFF  | RAM          |
| $A000-$BFFF  | BASIC ROM    |
| $C000-$CFFF  | RAM          |
| $D000-$DFFF  | I/O          |
| $E000-$FFFF  | KERNAL ROM   |

The mode the machine boots into. BASIC visible, KERNAL visible, I/O
visible at $D000-$DFFF.

### Mode 30 — KERNAL + I/O (BASIC banked out)

**$01 value:** $36
**LORAM:** 0, **HIRAM:** 1, **CHAREN:** 1

| Range        | Contents     |
|--------------|--------------|
| $A000-$BFFF  | RAM (BASIC banked out) |
| $D000-$DFFF  | I/O          |
| $E000-$FFFF  | KERNAL ROM   |

Used by machine-language programs that want the 8 KB at $A000-$BFFF as
RAM but still want KERNAL routines accessible.

### Mode 27 — character ROM + KERNAL + BASIC (no I/O)

**$01 value:** $33
**LORAM:** 1, **HIRAM:** 1, **CHAREN:** 0

| Range        | Contents     |
|--------------|--------------|
| $A000-$BFFF  | BASIC ROM    |
| $D000-$DFFF  | Character ROM|
| $E000-$FFFF  | KERNAL ROM   |

The I/O chips at $D000-$DFFF are replaced by the character generator
ROM. Useful for copying the character set into RAM (`LDA $D000,X / STA
target,X`) — you read the font directly, then bank I/O back in.

**Caution:** With I/O banked out, you cannot read CIA, VIC, or SID
registers. *And* the IRQ vector goes through $FFFE/$FFFF which still
points at the KERNAL ROM, so the KERNAL IRQ handler will run — and the
KERNAL handler tries to LDA $DC0D *which now reads the character ROM*.
On a real C64 this generally still works because the read just returns
font data and the handler ignores the value, but it is a sharp edge.
*Disable interrupts (SEI) before banking the character ROM in if any
timing matters.*

### Mode 26 — KERNAL + character ROM (no BASIC, no I/O)

**$01 value:** $32
**LORAM:** 0, **HIRAM:** 1, **CHAREN:** 0

| Range        | Contents     |
|--------------|--------------|
| $A000-$BFFF  | RAM          |
| $D000-$DFFF  | Character ROM|
| $E000-$FFFF  | KERNAL ROM   |

### Mode 25 — Character ROM only (no BASIC, no KERNAL, no I/O)

**$01 value:** $31
**LORAM:** 0, **HIRAM:** 0, **CHAREN:** 0

| Range        | Contents     |
|--------------|--------------|
| $A000-$BFFF  | RAM          |
| $D000-$DFFF  | Character ROM|
| $E000-$FFFF  | RAM          |

Almost never used — see Mode 24 instead.

### Mode 29 — I/O only (no BASIC, no KERNAL)

**$01 value:** $35
**LORAM:** 0, **HIRAM:** 0, **CHAREN:** 1

| Range        | Contents     |
|--------------|--------------|
| $A000-$BFFF  | RAM          |
| $D000-$DFFF  | I/O          |
| $E000-$FFFF  | RAM          |

The most common alternative to mode 31. Demos and games use this when
they want all RAM but still need to talk to VIC/SID/CIA. The big catch:
the IRQ vectors at $FFFE/$FFFF are now in RAM. You must:

1. Disable IRQs with SEI.
2. Write your IRQ handler's address into $FFFE/$FFFF (and NMI into
   $FFFA/$FFFB).
3. Bank out KERNAL with `LDA #$35 / STA $01`.
4. Re-enable IRQs with CLI when ready.

### Mode 24 — all RAM (no ROM, no I/O)

**$01 value:** $30
**LORAM:** 0, **HIRAM:** 0, **CHAREN:** 1 (or any value with bits 0-1 = 00 and CHAREN doesn't matter)

| Range        | Contents     |
|--------------|--------------|
| $A000-$BFFF  | RAM          |
| $D000-$DFFF  | RAM          |
| $E000-$FFFF  | RAM          |

A pure 64 KB of RAM. Used for software that brings its own everything
— typically the cracked-game intro / demoscene "filler" code that
needs maximum RAM for music + graphics + code.

**Same IRQ catch as mode 29.** Plus you lose all I/O — your code must
either disable interrupts and never need to talk to VIC/SID/CIA, or
temporarily bank I/O back in (`LDA #$35 / STA $01`) when needed.

### The full 32-mode truth table

Below is the canonical PLA truth table with all 32 input combinations.
Modes are numbered 0-31 in the order LORAM + HIRAM × 2 + CHAREN × 4 +
GAME × 8 + EXROM × 16. The seven distinct user-relevant modes (with no
cart, GAME = 1, EXROM = 1) are highlighted by the value of $01.

Cart-active modes (EXROM = 0 or GAME = 0) include "Ultimax" cartridges
where ROMH+ROML+CHAREN+I/O selectively replace huge swaths of the map.

| Mode | $01 | LORAM | HIRAM | CHAREN | $8000-$9FFF | $A000-$BFFF | $D000-$DFFF | $E000-$FFFF |
|------|-----|-------|-------|--------|-------------|-------------|-------------|-------------|
| 31   | 7   | 1     | 1     | 1      | RAM         | BASIC ROM   | I/O         | KERNAL ROM  |
| 30   | 6   | 0     | 1     | 1      | RAM         | RAM         | I/O         | KERNAL ROM  |
| 29   | 5   | 1     | 0     | 1      | RAM         | RAM         | I/O         | RAM         |
| 28   | 4   | 0     | 0     | 1      | RAM         | RAM         | RAM         | RAM         |
| 27   | 3   | 1     | 1     | 0      | RAM         | BASIC ROM   | CHARROM     | KERNAL ROM  |
| 26   | 2   | 0     | 1     | 0      | RAM         | RAM         | CHARROM     | KERNAL ROM  |
| 25   | 1   | 1     | 0     | 0      | RAM         | RAM         | CHARROM     | RAM         |
| 24   | 0   | 0     | 0     | 0      | RAM         | RAM         | RAM         | RAM         |

The seven distinct configurations boil down to **which of {RAM, BASIC,
CHARROM} sits at $A000-$BFFF**, **which of {RAM, KERNAL} sits at
$E000-$FFFF**, and **which of {RAM, CHARROM, I/O} sits at $D000-$DFFF**.

### Writes always go to RAM

This is the most important invariant in C64 banking: **writes to
$A000-$BFFF, $D000-$DFFF (when I/O isn't there), and $E000-$FFFF always
hit RAM**. Reads return ROM bytes when ROM is banked in; writes never
do — they always update the underlying DRAM cell.

Exceptions to this rule:
- $D000-$DFFF when I/O is banked in: writes go to the chip (VIC, SID,
  CIA, Color RAM, etc.) — not to RAM.
- $D000-$DFFF when CHARROM is banked in: writes go to RAM (character ROM
  is read-only). This is unintuitive — you can write to $D000 while
  CHARROM is selected and the byte will be silently buried in RAM, only
  visible if you then bank I/O *out* and CHARROM out and read again.

### DDR must be set before $01 writes

The DDR at $0000 controls which bits of $01 are outputs. Bits configured
as inputs ignore writes to $01.

The KERNAL sets DDR to $2F at reset (bits 0-3 and 5 are outputs; bits 4
and 6 are inputs). Bits 0-2 are *always* outputs in the default config,
so writing $35, $36, $37 to $01 takes effect.

**The pitfall:** code that does `LDA #$30 / STA $01` to bank to mode 24
needs to *first* write $2F to $00 — otherwise some prior program may
have left bit 7 of DDR as an input, in which case the high bit of $01
won't change. In practice this is rarely a problem on a reset-fresh C64
but is a known reliability issue when chaining loader stages.

The safest banking sequence:

```
SEI         ; disable IRQs
LDA #$2F    ; DDR mask: bits 0-3,5 output
STA $00
LDA #$35    ; new bank value
STA $01
```

### Cartridge modes (EXROM / GAME)

When a cartridge is inserted, EXROM and/or GAME pull low and the PLA
maps cartridge ROM into the address space. The two relevant cart
configurations are:

- **8 KB cart** (EXROM = 0, GAME = 1): ROML at $8000-$9FFF.
- **16 KB cart** (EXROM = 0, GAME = 0): ROML at $8000-$9FFF + ROMH at
  $A000-$BFFF, with BASIC ROM disabled.
- **Ultimax cart** (EXROM = 1, GAME = 0): a weird hybrid where ROML is
  at $8000-$9FFF + ROMH is at $E000-$FFFF replacing KERNAL, *and* most
  of the RAM is disabled. Used by the Commodore Ultimax — the only place
  in the C64 ecosystem this matters.

The PLA truth table for cart modes is documented in *The C64 PLA
Dissected*. Most software developers don't need to think about cart
modes unless they're writing cartridges or copy-protection.

## Zero page details

The 6510's zero-page addressing modes — LDA $XX, LDA $XX,X, LDA
($XX,X), LDA ($XX),Y — are one or two cycles faster than absolute
modes and use one fewer byte. Zero page (the first 256 bytes of RAM,
$0000-$00FF) is therefore precious real estate. The KERNAL and BASIC
have already claimed most of it.

### What KERNAL uses

The KERNAL workspace in zero page is roughly $90-$FE. Subsections:

- **$90-$93** — I/O state: STATUS, STOP-key flag, cassette flag, etc.
- **$94-$9F** — IEC and cassette bit-level workspace.
- **$A0-$A2** — Jiffy clock (TI).
- **$A3-$BD** — More cassette + IEC workspace.
- **$BE-$BF** — Tape block + serial workspace.
- **$C1-$C4** — Memory pointer pairs (LOAD/SAVE/VERIFY).
- **$C5-$D7** — Screen editor: last key, keyboard buffer count, cursor
  X/Y, cursor blink state, line pointer.
- **$D8-$F1** — Screen line link table + color RAM pointer.
- **$F2** — Insert count.
- **$F3-$F4** — Color RAM pointer.
- **$F5-$F6** — Key decode table pointer.
- **$F7-$FA** — RS-232 buffer pointers.

If your program calls *any* KERNAL routine — even CHROUT — the KERNAL
will read and write zero page. The full list of zeropage bytes the
KERNAL uses is in *Mapping the Commodore 64* chapter 1.

The four "free" zeropage bytes ($FB-$FE) are the only ones documented
as never touched by KERNAL.

### What BASIC uses

BASIC's workspace is roughly $02-$8F, with the executable CHRGET
routine at $73-$8A.

- **$02-$8A** — Working registers and pointers for parsing, tokenization,
  expression evaluation, floating-point math.
- **$8B-$8F** — RND seed.

If your program doesn't return to the BASIC READY prompt and doesn't
call BASIC ROM routines, all of $02-$8F is free except where it overlaps
the CHRGET code at $73-$8A. To free up $73-$8A, you'd need to make sure
no future BASIC interpretation happens.

### Best practices for zero page

When writing assembly that coexists with KERNAL:

1. **Use $FB-$FE first.** These four bytes are guaranteed safe.
2. **Disable IRQs (SEI) before using any other zeropage location.** That
   prevents the KERNAL IRQ (jiffy clock + keyscan) from clobbering your
   bytes mid-operation.
3. **Read $0314-$0333 to find what hooks you've installed.** A
   non-default vector indicates someone else has installed a handler
   and may use additional zero page.

When writing assembly that takes over the machine completely (bank
KERNAL out + own IRQ handler):

1. The entire zero page $00-$FF is yours, except $00 and $01 which still
   talk to the 6510 processor port.

## Stack page

$0100-$01FF is the 6502/6510 hardware stack. The stack pointer S
descends from $01FF and the page address is hard-coded — the stack
*always* lives on page 1.

### Stack operations

- **PHA / PHP** — push 1 byte, decrement S.
- **PLA / PLP** — increment S, pull 1 byte.
- **JSR addr** — push return-address-minus-one (2 bytes, hi-byte first
  on the *push order*, so the low byte of (PC-1) is at higher stack
  address), then PC := addr.
- **RTS** — pull return-address-minus-one + 1.
- **BRK / IRQ / NMI** — push PCH, PCL, status; PC := vector.

### BASIC use of the stack

BASIC pushes substantial state on the stack for GOSUB and FOR-NEXT:

- **GOSUB** pushes 5 bytes: `$8D` (GOSUB token), current line number
  (2 bytes), text pointer (2 bytes).
- **FOR** pushes 18 bytes: text pointer (2), line number (2), step (5
  bytes FP), step-sign (1), limit (5 bytes FP), index pointer (2), `$81`
  (FOR token), index variable name (2).

So a deeply-nested BASIC program can exhaust the stack faster than you'd
expect — 8 nested FORs = 144 bytes, more than half the stack.

### Assembly hygiene

The stack pointer is initialized by KERNAL to $FB at reset. Pure-assembly
programs that take over should usually do an `LDX #$FF / TXS` to reset
the stack pointer to the top.

When you push values for "local variables" via PHA, pull them back in
*reverse order*. The 6502 has no offset-based stack-relative addressing
(unlike the 65C816), so manually accessing pushed values from inside a
routine requires `TSX` to load S into X and then absolute-indexed reads
from $0100,X.

## KERNAL ROM map

The KERNAL ROM at $E000-$FFFF (8 KB) contains the firmware that handles
all I/O, character output, screen scrolling, cursor management,
keyboard scanning, the IRQ/NMI handlers, the BRK handler, the IEC bus
driver, the RS-232 driver, and the cassette driver. It also contains
the standard reset routine.

The public interface is the jump table at $FF81-$FFF5 — 39 entries,
each a 3-byte `JMP addr` instruction. Calling KERNAL routines through
the jump table is *strongly* preferred over calling them directly: the
jump table is stable across KERNAL ROM revisions; the implementation
addresses are not.

### KERNAL revisions

There are at least four documented KERNAL ROM revisions (901227-01,
-02, -03, and the C64C's "kernal" inside the combined BASIC+KERNAL
"251913-01" mask). The jump-table entry points are identical across
revisions; the internals differ in cassette timing constants and one
keyboard-handling fix. *Always JSR through the jump table*.

### KERNAL layout summary

| Range         | Function                                           |
|---------------|----------------------------------------------------|
| $E000-$E394   | Initialization, screen editor                      |
| $E395-$E4AB   | BASIC entry (vectors, RAMTAS)                      |
| $E4AC-$E97C   | Keyboard scan, screen scroll, character print      |
| $E97D-$EA7E   | IRQ handler (default $EA31)                        |
| $EA7E-$EE12   | IEC bus driver                                     |
| $EE13-$EF93   | IEC bus data path                                  |
| $EF94-$F12F   | RS-232 driver                                      |
| $F130-$F33F   | CHROUT, CHRIN, CHKIN, CHKOUT, CLRCHN, STATUS       |
| $F340-$F4A4   | OPEN, CLOSE, CLALL                                 |
| $F4A5-$F69B   | LOAD, SAVE                                         |
| $F69C-$F900   | Cassette LOAD/SAVE                                 |
| $F901-$FB54   | Disk LOAD/SAVE via IEC                             |
| $FB55-$FCFB   | More cassette protocol                             |
| $FCFC-$FF47   | Reset, vector init, RAMTAS, IRQ/BRK dispatchers    |
| $FF48-$FF80   | IRQ/BRK preamble                                   |
| $FF81-$FFF5   | Public jump table (39 entries)                     |
| $FFFA-$FFFF   | CPU vectors (NMI, RESET, IRQ/BRK)                  |

### Public jump table at $FF81-$FFF5

The full jump table is documented in
[kernal-routines-reference.md](kernal-routines-reference.md). Summary:

| Addr  | Routine | Function                              |
|-------|---------|---------------------------------------|
| $FF81 | CINT    | Initialize screen editor              |
| $FF84 | IOINIT  | Initialize I/O chips                  |
| $FF87 | RAMTAS  | RAM test, allocate workspace          |
| $FF8A | RESTOR  | Restore default vectors               |
| $FF8D | VECTOR  | Read or set indirect vectors          |
| $FF90 | SETMSG  | Control KERNAL messages               |
| $FF93 | SECOND  | Send secondary address (after LISTEN) |
| $FF96 | TKSA    | Send secondary address (after TALK)   |
| $FF99 | MEMTOP  | Set / read top-of-memory              |
| $FF9C | MEMBOT  | Set / read bottom-of-memory           |
| $FF9F | SCNKEY  | Scan the keyboard                     |
| $FFA2 | SETTMO  | Set IEC timeout                       |
| $FFA5 | IECIN   | Receive byte from IEC bus             |
| $FFA8 | IECOUT  | Send byte to IEC bus                  |
| $FFAB | UNTLK   | Send UNTALK on IEC bus                |
| $FFAE | UNLSN   | Send UNLISTEN on IEC bus              |
| $FFB1 | LISTEN  | Command device on IEC to LISTEN       |
| $FFB4 | TALK    | Command device on IEC to TALK         |
| $FFB7 | READST  | Read I/O STATUS                       |
| $FFBA | SETLFS  | Set logical file parameters           |
| $FFBD | SETNAM  | Set filename                          |
| $FFC0 | OPEN    | Open a file                           |
| $FFC3 | CLOSE   | Close a file                          |
| $FFC6 | CHKIN   | Set input channel                     |
| $FFC9 | CHKOUT  | Set output channel                    |
| $FFCC | CLRCHN  | Restore default I/O                   |
| $FFCF | CHRIN   | Get char from input                   |
| $FFD2 | CHROUT  | Output char                           |
| $FFD5 | LOAD    | Load file                             |
| $FFD8 | SAVE    | Save file                             |
| $FFDB | SETTIM  | Set jiffy clock                       |
| $FFDE | RDTIM   | Read jiffy clock                      |
| $FFE1 | STOP    | Test STOP key                         |
| $FFE4 | GETIN   | Get char from queue                   |
| $FFE7 | CLALL   | Close all files                       |
| $FFEA | UDTIM   | Update jiffy clock                    |
| $FFED | SCREEN  | Return screen dimensions              |
| $FFF0 | PLOT    | Read / set cursor                     |
| $FFF3 | IOBASE  | Return base of CIA #1                 |

### Critical KERNAL internal addresses

A few internal KERNAL addresses are worth knowing because they're
referenced by replacement IRQ handlers:

- **$EA31** — default IRQ handler entry (the one $0314 points to).
  After your custom raster IRQ, you typically `JMP $EA31` to chain
  back to the default handler.
- **$EA7E** — "no-cursor" IRQ entry — chains to UDTIM (jiffy + STOP)
  + keyscan but skips cursor blink. Useful for raster IRQs that don't
  want the cursor.
- **$FF48** — IRQ preamble (saves A, X, Y to stack). The default IRQ
  vector at $FFFE points here.
- **$F6BC** — RUN/STOP loop entry — bouncing here is what RUN/STOP+
  RESTORE does.

## BASIC ROM map

The BASIC ROM at $A000-$BFFF (8 KB) contains Microsoft BASIC v2.0,
licensed from Microsoft in 1977. The implementation is virtually
identical to PET BASIC 4.0 minus the disk commands, plus a few C64
quirks.

### BASIC ROM layout

| Range        | Function                                       |
|--------------|------------------------------------------------|
| $A000-$A00B  | Cold/warm-start vectors, "CBMBASIC" magic      |
| $A00C-$A47F  | Token tables, error messages                   |
| $A480-$A52A  | Main loop (ready prompt, tokenize)             |
| $A52B-$A659  | NEW, CLR, LIST                                 |
| $A65A-$A833  | RUN, GOTO, GOSUB, FOR, NEXT, RETURN            |
| $A834-$A9A4  | Expression evaluator + variable lookup         |
| $A9A5-$AB45  | String functions (CHR$, LEFT$, MID$, RIGHT$)   |
| $AB46-$AF7D  | PRINT, INPUT, GET, READ, OPEN, CLOSE, DATA    |
| $AF7E-$B6DA  | Float-to-string, string-to-float (FOUT, FIN)   |
| $B6DB-$BAE1  | Floating-point math (FADD, FMULT, FDIV, FSIN…) |
| $BAE2-$BFFF  | Cold-start init, sign-on, error vector default |

### Useful BASIC entry points

Even if you're writing pure assembly, a few BASIC ROM routines are
worth calling:

- **$A560 / $A57C** — CRUNCH (tokenize the line at $0200).
- **$AB1E** — STROUT (print a null-terminated string at A=lo X=hi).
- **$BA8C** — MOVFA (move arg to FAC).
- **$BC0C** — FOUT (FAC to ASCII string at $0100).
- **$BBA2** — FIN (ASCII to FAC).
- **$BFED** — MULT2 (multiply FAC by 2; useful binary-shift float math).

### BASIC vectors (RAM)

BASIC's behavior is partly steered by 7 vector pairs at $0300-$030B:

| Vector  | Default | Function                           |
|---------|---------|------------------------------------|
| IERROR  | $E38B   | Print BASIC error message          |
| IMAIN   | $A483   | Main BASIC interpreter loop        |
| ICRNCH  | $A57C   | Tokenize a line                    |
| IQPLOP  | $A71A   | De-tokenize for LIST               |
| IGONE   | $A7E4   | Execute a tokenized statement      |
| IEVAL   | $AE86   | Evaluate an expression             |

These get re-initialized to the defaults above on every reset. Custom
BASIC extensions (Simon's BASIC, Power BASIC, etc.) wedge in by patching
these vectors.

## Character ROM map

The character generator ROM is a 4 KB ROM that the VIC-II reads to
fetch the pixel patterns for text characters. The CPU can also read
it via $D000-$DFFF, but only when CHAREN is 0 (and either LORAM or
HIRAM is 1 so the I/O area isn't kept visible).

### Two character sets

The character ROM holds two complete 256-character sets:

- **Set 1 (uppercase + graphics):** $D000-$D7FF (2 KB) — the default
  after reset.
- **Set 2 (uppercase + lowercase):** $D800-$DFFF (2 KB) — switched in
  by pressing SHIFT+C= or by VIC's character pointer.

Each character is 8 bytes (8 × 8 = 64 pixels). 256 chars × 8 bytes =
2 KB per set.

### Character ROM layout

| Range        | Set | Codes         | Contents                       |
|--------------|-----|---------------|--------------------------------|
| $D000-$D1FF  | 1   | 0-63          | @, A-Z, [\\]↑←                 |
| $D200-$D3FF  | 1   | 64-127        | spc, !"#$%&'()...0-9...;<=>?   |
| $D400-$D5FF  | 1   | 128-191       | Reverse of 0-63                |
| $D600-$D7FF  | 1   | 192-255       | Reverse of 64-127              |
| $D800-$D9FF  | 2   | 0-63          | @, a-z (lowercase), [\\]↑←     |
| $DA00-$DBFF  | 2   | 64-127        | spc, !"#$%&'(), A-Z, ;<=>?     |
| $DC00-$DDFF  | 2   | 128-191       | Reverse of set 2 0-63          |
| $DE00-$DFFF  | 2   | 192-255       | Reverse of set 2 64-127        |

### How VIC-II finds the character set

The VIC-II's $D018 register controls character pointer + screen pointer
within the current 16 KB VIC bank. The default value $14 means:

- Screen RAM at offset $400 inside VIC bank 0 → $0400-$07E7.
- Character ROM at offset $1000 inside VIC bank 0 → $1000-$1FFF (a
  shadow of $D000-$D7FF inside the VIC bank).

The character ROM is *shadowed* into VIC banks 0 and 2:
- Bank 0 ($0000-$3FFF): char ROM at $1000-$1FFF.
- Bank 2 ($8000-$BFFF): char ROM at $9000-$9FFF.
- Banks 1 and 3 see RAM there.

This is why custom character sets typically live in VIC bank 1 or 3:
those banks don't have the character ROM shadowed, so the VIC sees
whatever RAM is there.

### Copying the char ROM to RAM

The canonical pattern for a custom font is to copy the char ROM out
of $D000-$D7FF into RAM somewhere (often $3000-$37FF), then update
$D018 to point at the RAM copy. The copy code:

```
SEI                ; disable IRQs (KERNAL will choke)
LDA $01
PHA
AND #$FB           ; clear CHAREN bit (CHAREN = 0 → char ROM visible)
STA $01

LDX #$00
loop:
LDA $D000,X
STA $3000,X
LDA $D100,X
STA $3100,X
...                ; repeat for $D200-$D7FF
INX
BNE loop

PLA
STA $01            ; restore $01 (CHAREN back to default)
CLI
```

After copying, set $D018 bits 1-3 to point at $3000 (= $0C):
`LDA #$1C / STA $D018`.

## I/O area

The I/O area at $D000-$DFFF is only present when CHAREN = 1 *and*
LORAM = 1 *or* HIRAM = 1. In the default config it's a 4 KB window
containing five chips' worth of registers plus 1 KB of Color RAM plus
2 × 256 bytes of cartridge I/O.

### Sub-regions

| Range        | Contents                                     |
|--------------|----------------------------------------------|
| $D000-$D3FF  | VIC-II registers + 16-fold shadow            |
| $D400-$D7FF  | SID registers + 32-fold shadow               |
| $D800-$DBFF  | Color RAM (1024 × 4 bits)                    |
| $DC00-$DCFF  | CIA #1 + 16-fold shadow                      |
| $DD00-$DDFF  | CIA #2 + 16-fold shadow                      |
| $DE00-$DEFF  | I/O expansion area 1 (cartridge)             |
| $DF00-$DFFF  | I/O expansion area 2 (cartridge)             |

### Shadow / mirror behavior

Each chip occupies a small number of register bytes but is decoded
across a much larger address window:

- **VIC-II**: 47 registers ($D000-$D02E) + 1 unused. The chip decodes
  on the lower 6 bits of the address, so the next 64-byte block
  ($D040-$D07F) is a mirror, and the pattern repeats every 64 bytes
  through $D3FF.
- **SID**: 29 registers ($D400-$D41C). Decoded on the lower 5 bits, so
  $D420-$D43F mirrors $D400-$D41F, repeating every 32 bytes through
  $D7FF.
- **Color RAM**: 1024 bytes; no shadow within $D800-$DBFF.
- **CIA #1**: 16 registers ($DC00-$DC0F). Mirrors every 16 bytes through
  $DCFF.
- **CIA #2**: 16 registers ($DD00-$DD0F). Mirrors every 16 bytes through
  $DDFF.

Software should always address the canonical low addresses ($D000,
$D400, $DC00, $DD00) — the shadows are an artifact of partial address
decoding, not a feature, and some clones don't replicate them.

### When you read from a non-existent I/O location

If you read from a byte that has no chip behind it (e.g. $D02F when
VIC-II is decoded but $D02F is undefined), you get an "open bus" read
that returns whatever the data bus was driven to last — usually the
last VIC-II fetch. This is unpredictable; don't rely on it.

### I/O timing

Reading or writing any I/O register takes the normal 4 CPU cycles for
the access. The CIAs and SID have no wait states. The VIC-II can,
however, *steal* the bus from the CPU on badlines and during sprite
DMA, which appears to the CPU as the instruction simply taking longer
to execute. See [vic-ii-reference.md](vic-ii-reference.md#raster-system).

## Pitfalls

- **$0001 — clobbering KERNAL zeropage.** Writing to addresses in
  $90-$FE while interrupts are enabled risks the KERNAL IRQ handler
  reading or writing the same byte. The IRQ ticks 60 times a second
  (or 50 Hz on PAL) and runs UDTIM ($FFEA) + the keyscan, both of
  which touch zeropage. Disable IRQs (SEI) before manipulating
  KERNAL-owned zero-page bytes.

- **$0000 / $0001 — DDR must be set first.** Writing to the
  processor-port data register $01 only affects pins configured as
  outputs by the DDR at $00. If a prior program (or a bug) has left
  bits of $00 as inputs, your bank-switch write won't take. Always
  write the expected DDR ($2F for a stock C64) before writing $01:
  `LDA #$2F / STA $00 / LDA #$35 / STA $01`.

- **$01 bit 6/7 — unconnected pins on stock C64.** Bits 6 and 7 of $01
  are not bonded out on a stock C64 (some C128 and SX-64 boards differ).
  Reading them yields the last-driven value with very slow capacitive
  decay. Treat as undefined and mask off when reading $01 for the
  bank-config bits.

- **$E000-$FFFF — IRQ vectors live in RAM when KERNAL banked out.**
  When you bank KERNAL ROM out (any mode with HIRAM = 0), $FFFA/$FFFB
  (NMI), $FFFC/$FFFD (RESET), and $FFFE/$FFFF (IRQ/BRK) are *RAM*. The
  CPU still reads them on interrupts. You *must* populate those RAM
  bytes with valid handler addresses before banking out. Forgetting
  causes the machine to jump to wherever-uninitialized-RAM-happens-to-
  point and crash. The fix: SEI; write your handler addresses into
  $FFFA-$FFFF; then write $01.

- **$D018 — write modifies $D018 in mode 1.** The KERNAL's CHROUT
  in screen mode 1 (the default) writes to $D018 each time you call
  it. If your raster IRQ relies on $D018 holding a specific value,
  CHROUT will corrupt it. Either bank out the screen editor (use
  IBSOUT $0326/$0327 + custom output) or save/restore $D018 around
  CHROUT calls.

- **$DC00-$DCFF — VIC-II bank changes via CIA #2 are inverted.** Setting
  $DD00 bits 0-1 to 11 (binary) selects VIC bank 0, not 3. The bits
  are inverted because the lines drive the VIC's address pins active-
  low. Off-by-one bank selection is a classic crash mode.

- **$D7FF — SID write side-effects via shadow.** A write to $D7FF lands
  in SID register $1F (which is undefined). Some emulators handle this
  differently from real hardware. Avoid writing to SID shadow addresses;
  always use the canonical $D400-$D41C window.

- **$00FB-$00FE — only four bytes of "safe" zeropage.** When coexisting
  with BASIC and KERNAL, $FB-$FE are the only documented-safe zero-page
  bytes. Using $02-$8F clobbers BASIC; using $90-$FE (other than the
  free 4 bytes) clobbers KERNAL. The fix: take over the machine, or
  use $FB-$FE.

- **$0100-$01FF — stack page wraparound.** The stack pointer S is 8
  bits and wraps from $00 to $FF without warning. A deep GOSUB or FOR
  nest in BASIC can decrement S past zero and overwrite the top of
  the stack page. No trap fires. Watch your nesting depth.

- **$0314-$0333 — vector resetting on KERNAL RESTOR.** The KERNAL's
  RESTOR routine ($FF8A) reinstalls the default vectors at $0314-$0333.
  Calling RESTOR (or any KERNAL routine that internally calls it, like
  IOINIT) wipes your custom IRQ handler. Hook by writing $0314/$0315
  *after* the last RESTOR-equivalent call.

- **$0801 — BASIC program-start sentinel.** BASIC requires the byte at
  $0801 to be $00 (the previous-line link byte of the implicit first
  line). Loading a machine-language program at $0801 without preserving
  this sentinel breaks NEW. Either use a BASIC SYS stub at $0801 or
  load at $0810+.

- **$A000 — "CBM80" cart auto-start magic.** Cartridges that map ROM
  at $A000-$BFFF can auto-start by placing the byte sequence
  `xx yy zz zz $C3 $C2 $CD $38 $30` at $A000-$A008. If your RAM
  happens to look like that at reset, the KERNAL will jump to garbage.
  In practice this is rare on a stock C64 (RAM is random or zero) but
  is a known crash mode in fastloaders.

- **$D018 — pointing at non-existent character data.** The character-set
  bits in $D018 (bits 1-3) point to 2 KB chunks inside the current VIC
  bank. If you select a chunk that has no font data — say a screen
  RAM range — the display will show garbage. Always set $D018 to a
  known-good font pointer before enabling display.

- **$DD00 — touching CIA #2 disables RS-232.** Writes to $DD00 control
  both VIC-II bank selection *and* the RS-232 transmit line. If you're
  using RS-232 + want to change VIC bank, you must mask carefully:
  preserve bits 2-7 of $DD00 while updating bits 0-1.

- **$FFFE-$FFFF — IRQ fired during bank switch.** If an IRQ fires between
  your write to $01 (banking KERNAL out) and your install of the new
  IRQ handler, the CPU will read $FFFE/$FFFF from RAM and crash. *Always*
  SEI before banking; install $FFFA-$FFFF; only then CLI.

- **$D012 raster wrap vs $D011 bit 7.** $D012 reports the low 8 bits
  of the current raster line, but PAL has 312 raster lines (NTSC has
  263). Lines ≥ 256 read $D012 with bit 8 in $D011. Comparing $D012
  to 256+ requires combining $D011 bit 7 — see
  [vic-ii-reference.md](vic-ii-reference.md#raster-system).

- **Mixing CHAREN + raster IRQs.** If you bank in the character ROM
  ($01 with CHAREN = 0) and a raster IRQ fires, the IRQ handler will
  read $DC0D as part of acknowledging — but $DC0D is now reading
  character-ROM data, not the CIA. The KERNAL's IRQ acknowledge will
  not clear the CIA, and the IRQ will fire again immediately, locking
  the machine. Always bank I/O in before allowing IRQs.

- **Color RAM upper nibble is random.** Reads from $D800-$DBFF return
  4 bits of color in the lower nibble and garbage in the upper. Always
  AND with #$0F when reading Color RAM.

- **Stack page double-duty.** The KERNAL's floating-point-to-ASCII
  routine writes a temporary string buffer into $0100-$010A. If you've
  PHA'd 11+ bytes onto the stack and then call CHROUT to print a
  float, those bytes get overwritten. Don't keep significant data
  near the stack bottom across BASIC calls.

- **$DE00/$DF00 open bus.** With no cartridge, reads from $DE00-$DFFF
  return open-bus garbage (typically the last VIC fetch). Don't probe
  for cartridge presence by reading these — write a known pattern
  and read it back, or use a dedicated detection sequence.

- **$0000/$0001 cassette-motor write side-effect.** Writing to $01
  with bit 5 cleared turns on the cassette motor. If your bank-switch
  code uses `LDA #$05 / STA $01`, you're also turning the cassette
  motor *on*. Mask carefully: typical bank values keep bit 5 = 1.

- **MEMSIZ caching in BASIC.** BASIC caches MEMSIZ at $0283/$0284 at
  RAMTAS time. Changing $0283/$0284 directly after BASIC is running
  doesn't always take effect for string operations — call MEMTOP
  ($FF99) instead.

- **TXTPTR mid-statement.** Modifying $7A/$7B (TXTPTR) while a BASIC
  statement is executing makes BASIC read its next token from your
  chosen address. Useful for "GOSUB to dynamic line number" but easy
  to crash if you point at non-BASIC data.

- **$0801 BASIC stub for ML programs.** The canonical ML autostart
  uses a BASIC stub like `10 SYS 2064` at $0801. The bytes encoded
  are: `0B 08 0A 00 9E 20 32 30 36 34 00 00 00` and then your ML at
  $080D. Skipping the stub and loading raw at $0801 means the user
  must type `SYS 2049` (= $0801 + skip the implicit zero byte).

- **CIA timer ticks under DC clock.** CIA timer underflows once per
  CPU cycle on the C64; the divisor is fixed. Programs that assume
  the timer ticks at a different rate (perhaps copying CIA code from
  a different platform) will produce wrong timing.

<!-- doc-type: hardware-reference -->
