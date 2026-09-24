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
| $07E8-$07F7   | Unused (tail of the screen page)             |
| $07F8-$07FF   | Default sprite pointers (8 bytes)            |
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

When the CPU comes out of reset, the KERNAL's IOINIT ($FDA3; called from
RESET at $FCF2, and reachable through the jump table at $FF84) puts the
6510 processor port into a known state: it writes $E7 to the data
register at $0001 first, then $2F (00101111, bits 0-3 + 5 outputs; bits 4
and 6 inputs; bit 7 unused on a stock C64) to the DDR at $0000
(`LDA #$E7 / STA $01 / LDA #$2F / STA $00` at $FDD5). With that DDR and no
tape button pressed, $01 reads back as $37 (00110111) once the
unconnected bits 6/7 have decayed to 0, and the KERNAL's default IRQ
service then writes the read-back value ORed with $20 (motor off) back
into $01 on every tick ($EA6B-$EA79, the datasette motor interlock), so a
running C64 holds $37 in the latch as well. An earlier version of this
section said the data register was "set to $37"; that is the settled
read-back value, not what IOINIT writes (measured in VICE x64sc: latch
$E7 immediately after `JSR $FF84`, $F7 a few frames after IRQs start, $37
by the time BASIC is running). Bits 2-0 = 111 mean: BASIC
ROM in, KERNAL ROM in, I/O in (the default user layout).

The KERNAL cold start ($FCE2, via the $FFFC vector) runs IOINIT, RAMTAS,
RESTOR and CINT in that order. RAMTAS ($FF87 → $FD50) clears $0002-$0101
and $0200-$03FF — the rest of the stack page, $0102-$01FF, is not touched
— sets the tape-buffer pointer $B2/$B3 to $033C, finds the top of memory
by walking pages from $0400 (MEMTOP = $A000 with BASIC ROM in), and sets
MEMBOT to $0800 ($0282) and the screen page $0288 to $04. It does not
clear the screen and it does not install any vector: its page-3 clear
leaves $0314/$0315 at $0000. RESTOR ($FF8A → $FD15) then copies the
16-vector table at $FD30 into $0314-$0333, which is what puts $EA31 in
$0314/$0315, and CINT ($FF81 → $FF5B → $E518) clears the screen at
$0400-$07E7 and initialises the VIC-II. An earlier version of this page
credited all of this to RAMTAS; the split is from the ROM bytes and a
VICE x64sc run calling $FF87 alone. By the time BASIC's
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
2. **PLA (906114)** sees A12-A15 (the high nibble, which picks the 4 KB
   chunk — the same inputs listed under [Bank switching](#bank-switching)),
   the GAME/EXROM lines from the cartridge, and the LORAM/HIRAM/CHAREN
   lines from the 6510's processor port. It produces enable signals:
   CASRAM (RAM read enable), ROML/ROMH (cartridge ROM enables), KERNAL,
   BASIC, CHAROM, and I/O. Splitting the I/O block below 4 KB into VIC,
   SID, colour RAM, CIA1, CIA2, IO1 and IO2 is done from A8-A11 by a
   separate decoder downstream of the PLA's I/O enable (a 74LS139 on the
   boards that carry the 906114; from the schematics, not measured here).
   An earlier revision of this line said A8-A15; the 906114 has no
   A8-A11 inputs.
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

**Reset value:** DDR = $2F; data written by IOINIT = $E7, reads back as $37 (see Reset state above).

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
| 6   | -         | -     | No pin on the 6510. As an input it reads the last level driven when it was an output, decaying to 0 after a few hundred ms (VICE models 350,000-420,000 cycles, ~0.35-0.43 s; measured 360k-417k in x64sc 3.10). Reads 0 after boot ($01 = $37). Do not rely on it. |
| 7   | -         | -     | No pin on the 6510. As an input it reads the last level driven when it was an output, decaying to 0 after a few hundred ms (VICE models 350,000-420,000 cycles, ~0.35-0.43 s; measured 360k-417k in x64sc 3.10). Reads 0 after boot ($01 = $37). Do not rely on it. |

**Notes:**
- **DDR must be set first.** When you write a new value to $01, the
  underlying CPU latches the value through the DDR mask. Bits configured
  as input ignore writes. If you intend to drive a pin, set the DDR
  bit to 1 first, then write the data register.
- **Reading $01 can be glitchy.** When CASSMOT is driving low (motor on)
  and you read $01, the input bit CASSSENS may read back as the most
  recent value the line was driven to during the cassette sense window.
  This is reported in *Mapping the Commodore 64* (p. 32) and is not
  checked here — no tape device is attached in the headless runs.
- **Bit 6/7 unconnected.** On a stock C64 these pins are not bonded out
  and read as their previous output state with very slow capacitive
  decay. *Do not rely on bit 6/7 values for anything.* An earlier version
  of the table said these bits were "pulled high"; the reset state
  DDR=$2F / $01=$37 contradicts that — they are inputs reading 0, and a
  driven 0 switched to input stays 0. See
  [6510-cpu-reference.md](6510-cpu-reference.md#reading-the-port) for the
  decay figure.

### $0002-$0002 — Unused (free zero-page byte)

**Default use:** None — not referenced by BASIC or the KERNAL; free for user code alongside $FB-$FE
**Bank-switchable:** No (always RAM)

Cleared to $00 by RAMTAS (`STA $0002,Y` at $FD53) and never touched
again: no instruction in the BASIC (901226-01) or KERNAL (901227-03) ROM
names $02 apart from that clearing loop — the only `$02` operands are
`$02,X` offsets into FAC1/FAC2 in the math package, with X = $61 or $69
(the sites at $B4DF and $B98D-$B9B0 run with X ≥ $19) — and a sentinel
POKEd into $02 survives a forced garbage collection (FRE(0)) and the
BASIC I/O error path (verified against the ROM images and in VICE x64sc
3.9). An earlier version of this entry said BASIC used $02 as a working
register during garbage collection and I/O error handling; neither
routine ($B526-$B605, $E0F9-$E109) references it. Programs that call ROM
routines can use it too; the one caveat is KERNAL SAVE, which reads its
start address through whichever zero-page pointer the caller names in A.

### $0003-$0004 — Float-to-fix vector

**Default use:** Vector to BASIC's float-to-fix conversion ($B1AA)
**Bank-switchable:** No (always RAM)

Patchable: if you want to override how BASIC converts floats to integers,
point this here. Installed by BASIC's cold-start initialisation at $E3BF
(the KERNAL reset reaches it only via JMP ($A000) -> $E394 -> JSR $E3BF),
not by the KERNAL. RESTOR ($FF8A -> $FD15) rewrites only $0314-$0333 from
the table at $FD30 and leaves $03-$06 alone; an earlier version of this
page said RESTOR pre-loads them (ROM bytes; confirmed in VICE x64sc 3.10).

### $0005-$0006 — Fix-to-float vector

**Default use:** Vector to BASIC's fix-to-float conversion ($B391)
**Bank-switchable:** No (always RAM)

Installed by the same BASIC init at $E3BF, default $B391; see $0003-$0004.

### $0007-$0008 — Search character / quote flag

**Default use:** BASIC tokenization workspace (current search char + quote-state flag)
**Bank-switchable:** No

### $0009-$0009 — TRMPOS (TAB/SPC cursor column)

**Default use:** Cursor column (read via PLOT $FFF0) at the moment PRINT evaluates a TAB( or SPC( — the column before the move. Earlier text called this an input-buffer pointer; the only ROM references are $AAFD/$AB0A in PRINT's TAB/SPC code (measured in VICE x64sc: 3 after PRINT "ABC";TAB(20)).
**Bank-switchable:** No

### $000A-$000A — VERCK (LOAD/VERIFY flag)

**Default use:** BASIC LOAD = $00, VERIFY = $01; passed in A to KERNAL LOAD ($FFD5). Earlier text called this an array-dimension flag; the only references are $E16A/$E16F/$E17A in the BASIC LOAD/VERIFY entry.
**Bank-switchable:** No

### $000B-$000B — COUNT (input-buffer index / subscript count)

**Default use:** Tokeniser keyword counter and crunched-line length; number of array subscripts while an array reference is processed (compared with the array header at $B256, counted down to 0 by the dimension loops). Earlier text called this a type flag; the numeric/string flag is VALTYP at $000D.
**Bank-switchable:** No

### $000C-$000C — DIMFLG (DIM in progress)

**Default use:** Non-zero while DIM is creating an array (DIM enters the variable-lookup routine with this set; it holds the first character of the array name), $00 for an ordinary variable reference. Earlier text called this a DEF FN flag; the FN flag is SUBFLG at $0010.
**Bank-switchable:** No

### $000D-$000D — Data type flag

**Default use:** $00 = numeric expression result, $FF = string
**Bank-switchable:** No

### $000E-$000E — Integer/float flag

**Default use:** $80 = integer, $00 = floating-point result
**Bank-switchable:** No

### $000F-$000F — GARBFL (DATA-scan / LIST-quote / garbage-collection flag)

**Default use:** Tokeniser: set when a DATA statement is found so the rest of the line is not tokenised, cleared at ':'; LIST: quote-mode toggle; string allocation: bit 7 set once garbage collection has run so it is not run twice. A flag, not workspace, and not a DATA pointer — DATPTR is $0041-$0042 below.
**Bank-switchable:** No

### $0010-$0010 — SUBFLG (subscript / FN reference allowed)

**Default use:** $00 = subscripts and integer variables allowed; $80 = set by FOR and DEF FN/FN so the variable-lookup routine refuses an integer name or a subscript (?SYNTAX ERROR). Cleared by CLR and after each plain variable lookup.
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
TXTTAB, POKE the byte at TXTTAB-1 with $00 (e.g. POKE 16384,0 for TXTTAB
= $4001) and run NEW so BASIC initializes the link bytes. RUN and NEW
both set TXTPTR to TXTTAB-1 ($A68E) and the statement loop ($A7C0) reads
that byte expecting an end-of-line zero, so anything else there gives
?SYNTAX ERROR before the first line runs; the cold start zeroes $0800
($E419) only because the default TXTTAB is $0801. An earlier version of
this page said to zero $0800, which is right only for the default.
(Measured in VICE x64sc 3.10: POKE44,64:POKE2048,0:NEW gave ?SYNTAX ERROR,
POKE44,64:POKE16384,0:NEW ran.)

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

**Default use:** Line number of the currently-executing BASIC statement; in direct mode only the high byte is set ($3A = $FF) — the low byte keeps whatever line ran last
**Bank-switchable:** No

A useful test: PEEK(58) = 255 means direct mode. Do not compare the
16-bit value with 65535 — the main loop ($A490: LDX #$FF / STX $3A) sets
only the high byte, so after a program has run the pair reads $FFnn with
nn the low byte of the last executed line, and even on a fresh boot it
reads 65280 ($39 is 0 from the KERNAL's RAM clear; nothing in either ROM
ever writes $FF to $39). BASIC's own direct-mode checks ($A46C, $A838,
$B3A6) test only $3A. An earlier version of this page said 65535;
measured in VICE x64sc 3.10: 65280 at boot, 65300 after a program ending
at line 20.

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

### $0053-$0053 — Garbage-collection step size

**Default use:** Step the BASIC garbage collector adds to its walk pointer ($22-$23): 3 while scanning the temporary string-descriptor stack and array elements, 7 while scanning simple variables (set at $B54D and $B56A, applied at $B5F6); BASIC cold start initialises it to 3 ($E3EA). Not a string length, and not VALTYP — the numeric/string type flag is $000D.
**Bank-switchable:** No

Conventionally labelled FOUR6 (the Microsoft/Commodore source name — not
verified from an instrument on this machine). An earlier version of this
entry was headed VALTYP; that name belongs to $000D, and the ROM shows
$53 is the collector's step size (3 or 7), not a length.

### $0054-$0056 — Jump-to-function temp

**Default use:** JMP instruction template used by BASIC to call function code
**Bank-switchable:** No

### $0057-$0060 — Misc numeric work area (two 5-byte FP temporaries)

**Default use:** BASIC math temporaries at $57-$5B and $5C-$60; MOV2F stores FAC to either ($BBCA -> $57, $BBC7 -> $5C), the series evaluator POLY1 ($E043) multiplies by them, and FIN clears $5D-$67 at entry and uses $5D-$60 as its digit/exponent counters
**Bank-switchable:** No

Earlier revisions called this ARG; ARG is at $69-$6E (see below), as the
BASIC ROM's CONUPK $BA8C shows. The conventional labels TEMPF1/TEMPF2
are names from the published maps, not read from an instrument.

### $0061-$0066 — Floating-point accumulator #1 (FAC)

**Default use:** Primary floating-point register; result of every BASIC math op
**Bank-switchable:** No

| Address | Meaning                                |
|---------|----------------------------------------|
| $0061   | Exponent                               |
| $0062-$0065 | Mantissa (4 bytes, MSB first)      |
| $0066   | Sign                                   |

### $0067-$0067 — SGNFLG

**Default use:** Sign flag during number input (FIN, $BD02); term counter during series evaluation, loaded from the coefficient table's first byte at $E062 and decremented at $E088 — it is a counter, not a pointer
**Bank-switchable:** No

### $0068-$0068 — BITS

**Default use:** FAC overflow byte, set by INT ($BCA9) and normalisation, cleared by BASIC init ($E3F0)
**Bank-switchable:** No

### $0069-$006E — Floating-point accumulator #2 (ARG)

**Default use:** Second floating-point register used by BASIC math; CONUPK ($BA8C) loads it from memory
**Bank-switchable:** No

| Address | Meaning                                                    |
|---------|------------------------------------------------------------|
| $0069   | Exponent                                                   |
| $006A-$006D | Mantissa (4 bytes, MSB first, bit 7 of $6A forced set) |
| $006E   | Sign                                                       |

### $006F-$006F — ARISGN

**Default use:** Sign-comparison byte = ARG sign EOR FAC sign, written by CONUPK ($BAA5-$BAA7) and tested by FADD ($B8A3)
**Bank-switchable:** No

Earlier revisions labelled $67-$6F polynomial workspace; the series
evaluator's temporaries are actually $57-$60, $67 and $71-$72.

### $0070-$0072 — FACOV + FBUFPT (floating-point scratch)

**Default use:** $70 is the FAC rounding/overflow byte (FADD reads it at $B86F, ROUND shifts it at $BC1B, MOVAF zeroes it, FMULT uses it as the first multiplier byte); $71-$72 is the pointer the series/polynomial evaluator POLY1 stores at $E043 for the coefficient table (also borrowed by the tokenizer and string routines as scratch)
**Bank-switchable:** No

Not part of CHRGET: the reset-time copy loop (LDX #$1C / LDA $E3A2,X /
STA $73,X) starts at $73, so an earlier version of this page that titled
$70-$72 "CHRGET / CHRGOT" was wrong. Label names FACOV/FBUFPT follow the
conventional Commodore source labels; the usages above are read from the
ROM images.

### $0073-$008A — CHRGET routine (executable code)

**Default use:** Inline machine code for BASIC's next-token reader
**Bank-switchable:** No

Machine code copied from the ROM image at $E3A2 by BASIC's cold-start
init ($E3BF, in the KERNAL ROM image) at reset — the CHRGET/CHRGOT
subroutine BASIC uses to read its own tokenized program. CHRGET is $0073
(advance TXTPTR then fetch); CHRGOT is $0079 (re-fetch the current byte
without advancing); the LDA operand at $007A-$007B is TXTPTR. The bytes
at $0073-$008F are a 29-byte image copied down from $E3A2 (LDX #$1C /
LDA $E3A2,X / STA $73,X): the CHRGET/CHRGOT subroutine at $73-$8A plus
the initial RND seed at $8B-$8F ($80 $4F $C7 $52 $58). $E3A2 is BASIC
interpreter code that physically lives in the KERNAL ROM chip's
$E000-$E4D2 span (kernal-901227-03.bin offset $03A2), not in
basic-901226-01.bin. Nothing else reinstalls it — not the KERNAL's
RESTOR/CINT/IOINIT and not the RUN/STOP-RESTORE warm start at $E37B — so
once overwritten only a cold start ($E394, SYS 58260) or a reset brings
it back. An earlier version of this page said the KERNAL copies it in at
reset.

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

Seeded to $80 $4F $C7 $52 $58 by the same 29-byte copy from $E3A2 that
installs CHRGET (BASIC cold-start init at $E3BF, not the KERNAL); nothing
else rewrites it except RND itself.

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

**Default use:** $80 = direct mode (control messages on, error text off), $00 = program mode (both off)
**Bank-switchable:** No

Bit 7 = print KERNAL control messages (SEARCHING FOR, LOADING, VERIFYING,
SAVING, FOUND); bit 6 = print KERNAL error messages ('I/O ERROR #n'). An
earlier version of this page had the two bits swapped. BASIC writes $80
here in direct mode (READY, $A47B) and $00 when a program is RUN ($A872),
so a running program prints neither unless it calls SETMSG ($FF90, which
just stores A at $9D). $C0 prints both; $00 is silent. Two things this
flag does NOT control: the tape prompts 'PRESS PLAY ON TAPE' / 'PRESS
RECORD & PLAY ON TAPE' and the 'OK' after them are printed
unconditionally ($F81E/$F82B enter the printer at $F12F, past the $9D
test), and 'FILE NOT FOUND' is BASIC's message from its own error table,
not the KERNAL's — the KERNAL prints 'I/O ERROR #4' for that case.
Verified against the ROM bytes and in VICE x64sc.

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

Incremented once per KERNAL IRQ by UDTIM ($FFEA → $F69B). That IRQ is
CIA #1 Timer A, which the KERNAL sets at $FDDD from the $02A6 region flag
to ≈60 Hz on BOTH regions — latch $4025 on PAL (16,422 cycles, 59.996 Hz)
and $4295 on NTSC (17,046 cycles, 59.998 Hz), read from the 901227-03
ROM and confirmed in VICE x64sc (359 jiffies in 300 PAL frames, 301 in
300 NTSC frames; a second run counted 298-299 ticks in 250 PAL frames).
So TI counts ~60ths of a second everywhere and runs very slightly *slow*
on both (0.007 % on PAL, 0.003 % on NTSC); UDTIM's 24-hour rollover at
$4F1A01 = 86,400 × 60 assumes the same 60/s. An earlier version of this
page said the PAL IRQ was 50 Hz and TI ran fast; neither was true. See
pal-ntsc-reference.md.

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

### $00A9-$00AD — Tape header / file workspace

**Default use:** Workspace for OPEN, LOAD, SAVE tape protocols
**Bank-switchable:** No

### $00AE-$00AF — EAL: end address of the last LOAD/SAVE

**Default use:** One past the last byte loaded or saved
**Bank-switchable:** No

SAVE ($FFD8) takes the end address in X/Y and stores it here on entry
($F5DD). LOAD uses it as the running store pointer (STA ($AE),Y / INC at
$F51C-$F522) and returns it in X/Y at exit ($F5AA-$F5AE), so after a
successful LOAD, $AE/$AF (or the returned X/Y) is the end of the program.
Also used as a temporary pointer by the screen-editor scroll
($E8F0-$E9ED). Verified against kernal-901227-03 and a SAVE/LOAD round
trip in VICE x64sc.

### $00B0-$00B1 — Tape header / file workspace

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

**Default use:** Start-address pointer for SAVE and for tape LOAD
**Bank-switchable:** No

Start address for SAVE (copied from the zero-page pointer named in A,
$F5E4/$F5E8) and for tape LOAD ($F59C/$F5A0); a serial LOAD does not use
it — it stores straight through $AE/$AF.

### $00C3-$00C4 — MEMUSS: load address passed to LOAD

**Default use:** The X/Y the caller hands to LOAD ($FFD5); honoured only when the secondary address is 0 (relocating load)
**Bank-switchable:** No

LOAD's entry ($F49E) stores X/Y here before anything else. With SA=0 the
KERNAL copies it into $AE/$AF and loads there; with SA≠0 it is ignored
and the file's own address is used. A tape LOAD overwrites it with the
header's start address for non-relocatable (type 3) files or when SA≠0
($F56C-$F575). The VECTOR routine ($FD1A) borrows it as the pointer to
the caller's vector table. SAVE never touches it. Earlier revisions of
this page called it the end-address pointer; that is $AE/$AF — verified
against the ROM bytes and a SAVE/LOAD round trip in VICE x64sc.

### $00C5-$00C5 — Last key pressed (matrix code)

**Default use:** Raw matrix index of last key scanned by IRQ; $40 = no key
**Bank-switchable:** No

Updated 60 times per second by the KERNAL IRQ. *Not* the PETSCII code —
this is the row/column matrix index 0-63. The actual key code goes
through KEYTAB ($EB81-$ECB8) to produce a PETSCII byte that gets
written to the keyboard buffer at $0277. An earlier version of this line
said $ECB9, which is the first byte of the VIC-II power-on table, not
KEYTAB (verified against `kernal-901227-03.bin`).

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

### $00D9-$00F2 — Screen line link table

**Default use:** 26-byte table — one entry per row plus a sentinel at $F2; bits 0-1 give the row's address high-byte offset, bit 7 set marks the start of a logical line
**Bank-switchable:** No

Bit 7 set means the row starts a logical line; clear means it is the
continuation of the row above (a fresh screen has bit 7 set on every
entry). The KERNAL walks this table to find a logical line's start and
length. (This page previously ended the table at $F1 and had a separate
"$00F2 — Insert mode count" entry; the KERNAL's fill loop at $E544
writes 26 entries and never addresses $F2 on its own — there is one
insert counter and it is $D8.)

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

**Notes:** Together with $02 these are the five zero-page bytes neither
ROM touches after reset (this page used to say $FB-$FE were the only
four). Assembly that coexists with BASIC should use $FB-$FE and $02 for
its hottest pointers.

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

The KERNAL reset ($FCE2) sets S = $FF and hands over with JMP ($A000),
leaving nothing of its own on the stack. It is BASIC that lowers it: the
cold start sets S = $FB ($E39D), and CLR -- run by NEW, CLR, RUN and the
RUN/STOP-RESTORE warm start via $A67A -- sets S = $FA ($A681). A routine
entered by SYS sees four bytes less again (NEWSTT's return address and
SYS's own pushed $E146): S = $F7 from immediate mode straight after a
cold start, S = $F6 from a RUN BASIC stub. Measured in VICE x64sc 3.10
against the ROM images; an earlier revision attributed the $FB to the
KERNAL.

**Subdivisions:**

- $0100-$010F shared with tape buffer index in some workflows
- $01FA-$01FF reserved for KERNAL's deepest pushes during reset
- Floating-point ASCII conversion (BASIC's FOUT, $BDDD) uses $00FF-$010F
  as a temporary buffer — $0100-$010F from PRINT, $00FF-$010E from STR$
  (measured in VICE; *Mapping the C64* p. 39 gives $0100-$010A, which is
  five bytes short)

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

**Default use:** Key-repeat mode (RPTFLG). Bit 7 set ($80) = all keys repeat; bit 6 set with bit 7 clear ($40) = no key repeats; $00 (the power-up value — RAMTAS clears it and nothing in the ROMs ever writes it) = only INST/DEL, SPACE and the four cursor keys repeat. Bit 7 wins when both are set (KERNAL $EAF2: BIT $028A / BMI / BVS, then CMP #$14/#$20/#$1D/#$11 — read from the 901227-03 ROM image; boot value measured in VICE x64sc). An earlier revision of this line had bit 6 and $00 the wrong way round.
**Bank-switchable:** No

### $028B-$028C — Repeat speed counter / countdown

**Default use:** Frames between key repeats
**Bank-switchable:** No

### $028D-$028D — Shift / Ctrl / C= state

**Default use:** Bitmask of shift modifier keys held down this frame
**Bank-switchable:** No

| Value | Bit | Meaning                                                                                              |
|-------|-----|------------------------------------------------------------------------------------------------------|
| 1     | 0   | SHIFT — left shift, right shift or shift-lock, which the KERNAL does not distinguish (both matrix positions carry the value 1 in the $EB81 table) |
| 2     | 1   | Commodore key                                                                                        |
| 4     | 2   | CTRL                                                                                                 |

There is no bit 3. The scanner ($EAB7) ORs the raw table values 1, 2 and
4 into $028D and never stores those keys as the keypress; the value 3 at
index 63 is RUN/STOP and is treated as an ordinary key. Table selection
($EB48-$EB76): 0 -> unshifted $EB81, 1 -> shifted $EBC2, 2 -> C= $EC03,
any value with CTRL set (4-7) -> CTRL $EC78. Value 3 (SHIFT+C=) does NOT
go through that selector: on the frame it first appears, and unless
$0291 bit 7 is set, the KERNAL flips $D018 bit 1 (upper/lower case) and
decodes the key through the unshifted table, which $EA9B resets to $EB81
at the start of every scan; while SHIFT+C= is held steady ($028D ==
$028E) the scan exits at $EB42 without decoding any key. An earlier
revision listed four bits (left shift, right shift, C=, CTRL as bits
0-3); the values were read from kernal-901227-03.bin.

### $028E-$028E — Last shift state

**Default use:** Previous frame's $028D value (debouncing)
**Bank-switchable:** No

### $028F-$0290 — Keyboard table-setup vector (KEYLOG)

**Default use:** Vector to the routine that selects the keyboard decode table from the shift state; default $EB48 (set by CINT at $E522)
**Bank-switchable:** No

The keyscan calls it with JMP ($028F) at $EADD; the routine reads the
shift/Ctrl/C= flags in $028D, picks one of the four tables listed at
$EB79 ($EB81 unshifted, $EBC2 shifted, $EC03 C=, $EC78 Ctrl) and stores
that address in $F5/$F6, then exits with JMP $EAE0, where the keyscan
fetches the PETSCII code with LDY $CB / LDA ($F5),Y. To install custom
key tables, point $028F/$0290 at a routine that does the same — leave
the table address in $F5/$F6 and exit via JMP $EAE0 — rather than at a
table: this vector holds a code address, not a table address. (An
earlier version of this entry called it a pointer to the decode table
itself; it never was — the table pointer is $F5/$F6, see $00F5-$00F6.
Read from the 901227-03 ROM and confirmed in VICE: $028F/$0290 = $48 $EB
at boot.)

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

### $02A2-$02A4 — Tape I/O temporaries

**Default use:** CIA #1 control/ICR images saved by the cassette code ($02A2 written at $F887 in the tape setup and read at $F911; $02A3 at $F94B/$F9B0 and $02A4 at $F917/$F9C0 in the tape read IRQ). Not RS-232: free only if you never touch tape.
**Bank-switchable:** No

### $02A5-$02A5 — Screen scroll temporary

**Default use:** Line index used by the screen editor's scroll and insert-line code ($E8EA-$E9C2: $E8FC, $E935, $E96C, $E978, $E993, $E9AB, $E9BF). Clobbered by any PRINT that scrolls the screen, whatever RS-232 is doing.
**Bank-switchable:** No

### $02A6-$02A6 — PAL/NTSC flag

**Default use:** 1 = PAL, 0 = NTSC. Written once by CINT ($FF5B: waits for $D012 = 0 after the VIC table set raster compare 311, then stores $D019 bit 0), read by IOINIT at $FDDD to pick the CIA #1 Timer A jiffy latch ($4025 PAL / $4295 NTSC) and by RS-232 OPEN at $F42C to pick the baud table. Leave it alone: RUN/STOP-RESTORE ($FE66) re-runs IOINIT but not CINT, so an overwritten flag is not re-derived and the jiffy clock and RS-232 timing switch to the other region (measured in VICE x64sc: storing 0 here and calling $FF84 on a PAL machine moves the Timer A latch from $4025 to $4295). Bit-exact in 901227-02 and -03; -01 has no detector and leaves this byte alone.
**Bank-switchable:** No

### $02A7-$02FF — Unused

**Default use:** Free for user code. No KERNAL or BASIC ROM write touches this range (census of absolute operands in 901227-03 / 901226-01); the only reads are two `BIT $02A9` skip idioms at $EFCF and $F6FD that discard the value. RAMTAS clears it at reset. An earlier version of this page lumped $02A2-$02A6 into this range as "extra RS-232 workspace, safe if RS-232 is not in use"; five of those bytes belong to the tape driver, the screen editor and the PAL/NTSC flag.
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

**Default use:** USR()'s 3-byte jump instruction (JMP to user routine)
**Bank-switchable:** No

The $4C opcode and the default target are installed by BASIC init
($E3BF), not by USR(): USR() jumps *through* $0310 (its entry in the
function-dispatch table at $A058 is $0310 itself, dispatched via the JMP
that the same init writes at $54). The default target is $B248 = LDX
#$0E / JMP $A437, i.e. ?ILLEGAL QUANTITY ERROR, so POKE 785/786 (lo/hi)
with the routine address before calling USR(). An earlier version said
USR() sets this vector.

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
character generator. In the default uppercase/graphics set, codes 0–31
are @ A–Z [ £ ] ↑ ←, 32–63 are space, punctuation and the digits (48–57
= 0–9), 64–127 are the graphics glyphs, and 128–255 are the same 128
glyphs in reverse video. The lowercase set puts a–z at 1–26 and A–Z at
65–90. See [Character ROM layout](#character-rom-layout) below (ranges
read from chargen-901225-01.bin; an earlier revision linked a
vic-ii-reference section that does not exist).

To move the screen: set the upper nibble of $D018 to the 1 KB slot
inside the current VIC bank (upper nibble × 1 KB = screen offset from
the base of the VIC bank; e.g. $D018 = $3x puts the screen at bank+$0C00,
and the default $14 gives $0400). An earlier revision said 4 × upper
nibble, which would have put the default screen at $1000; measured in
VICE x64sc: $D018 = $34 displays $0C00 and $C4 displays $3000. Then
update $0288 (the KERNAL's idea of screen page) and the line-link table
at $D9-$F2.

### $07E8-$07F7 — Unused tail of the screen page

**Default use:** 16 bytes between the 1000-byte screen and the sprite pointers; the KERNAL neither clears nor uses them (measured in VICE x64sc: they still hold the RAM-init pattern after boot)
**Bank-switchable:** No

### $07F8-$07FF — Default sprite pointers

**Default use:** 8 bytes — one sprite pointer per hardware sprite (0-7)
**Bank-switchable:** No (RAM region; visible to VIC inside VIC bank)

The eight bytes at the *very end* of screen memory hold the sprite
pointers. Each byte's value × 64 is the address (within the current
VIC bank) of that sprite's 63-byte data block.

By default sprite 0's data pointer is at $07F8, sprite 1's at $07F9, etc.
If you relocate the screen, the sprite pointers move too (always 1016
bytes past the start of screen RAM). (An earlier version of this page
headed this entry $07E8-$07FF, a 24-byte range; the pointers are the
last 8 bytes of the 1 KB screen page, screen base + $3F8.)

### $0800-$9FFF — BASIC program area / general user RAM

**Default use:** Tokenized BASIC program + variables + free user RAM (38 KB = 38,912 bytes; 38,911 from $0801, the figure the boot screen prints — an earlier revision said 38.4 KB, which matches no byte count)
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
- A 16 KB cartridge (EXROM = 0, GAME = 0) maps its ROMH here whenever
  HIRAM = 1, whatever LORAM is (modes 2, 3, 6 and 7); with HIRAM = 0 the
  range is RAM even with the cart present. See
  [Cartridge modes](#cartridge-modes-exrom--game). (This note used to
  point at 'modes 8 and 16': mode 8 is an 8 KB cart with all three port
  bits low and is all RAM, and mode 16 is Ultimax with ROMH at $E000 -
  measured in VICE x64sc, default C64C model, not on a bench.)

### $A000-$A00B — BASIC cold-start vectors

**Default use:** Cold-start jump table — first 12 bytes of BASIC ROM
**Bank-switchable:** Yes

| Address  | Content      | Meaning                         |
|----------|--------------|---------------------------------|
| $A000    | $94 $E3      | Cold-start vector (jumps $E394) |
| $A002    | $7B $E3      | Warm-start vector ($E37B)       |
| $A004    | $43 $42 $4D…  | "CBMBASIC" ID string           |

The cold-start vector at $A000-$A001 is where the KERNAL's reset routine
ends up (`JMP ($A000)` at $FCFE, after IOINIT, RAMTAS, RESTOR and CINT).
Cartridge auto-start does not involve $A000 at all. The reset routine
($FCE2) first calls the signature check at $FD02, which compares
$8004-$8008 with `$C3 $C2 $CD $38 $30` ("CBM80", held at $FD10) and, on
a match, does `JMP ($8000)` — the cartridge *cold*-start vector — before
any RAM or I/O initialisation. A cart ROM's first nine bytes are
therefore: cold vector (2), warm vector (2), `CBM80` (5), at
$8000-$8008. The warm vector at $8002 is taken by the RESTORE/NMI
handler ($FE56: `JSR $FD02; BNE; JMP ($8002)`), and only when CIA #2 did
not raise the NMI. See the $8000 pitfall below. (An earlier version of
this page put the signature at $A000 and had reset jump through the warm
vector; both were wrong — at reset $A000 is BASIC ROM, whose first bytes
are the `$94 $E3 $7B $E3 'CBMBASIC'` shown above. Verified against
kernal-901227-03 bytes and in VICE x64sc 3.10.)

### $A00C-$A389 — BASIC dispatch tables, keywords, messages

**Default use:** Statement dispatch ($A00C, entry-1), function dispatch ($A052), operator table, keyword text ($A09E), error messages, "OK"/"ERROR"/"IN"/"READY."/"BREAK" strings ($A364-$A389)
**Bank-switchable:** Yes

### $A38A-$A47F — Stack search, memory checks, ERROR, READY

**Default use:** FOR-stack search ($A38A), stack/memory checks ($A3FB, $A408), ERROR ($A437 = JMP ($0300)), READY ($A474)
**Bank-switchable:** Yes

### $A480-$A641 — BASIC main loop, line entry, CRUNCH

**Default use:** Main loop ($A480 = JMP ($0302), $A483), insert line, INLIN ($A560), CRUNCH ($A57C), FNDLIN ($A613)
**Bank-switchable:** Yes

### $A642-$A741 — NEW, CLR, LIST

**Default use:** NEW ($A642), CLR ($A65E), LIST ($A69C, detokenize $A71A)
**Bank-switchable:** Yes

### $A742-$A9A4 — FOR, statement loop, control-flow statements

**Default use:** FOR ($A742), NEWSTT/GONE ($A7AE/$A7E4), RESTORE ($A81D), STOP/END ($A82F/$A831), CONT ($A857), RUN ($A871), GOSUB ($A883), GOTO ($A8A0), RETURN ($A8D2), DATA ($A8F8), IF ($A928), REM ($A93B), ON ($A94B), LINGET
**Bank-switchable:** Yes

### $A9A5-$AC05 — LET, PRINT, GET, INPUT

**Default use:** LET ($A9A5), PRINT# ($AA80), CMD ($AA86), PRINT ($AAA0), STROUT ($AB1E), GET ($AB7B), INPUT# ($ABA5), INPUT ($ABBF)
**Bank-switchable:** Yes

### $AC06-$AD1D — READ

**Default use:** READ ($AC06) and its "?EXTRA IGNORED"/"?REDO FROM START" messages
**Bank-switchable:** Yes

### $AD1E-$AD89 — NEXT

**Default use:** NEXT ($AD1E)
**Bank-switchable:** Yes

### $AD8A-$B07D — Expression evaluator

**Default use:** FRMNUM ($AD8A), CHKNUM ($AD8D), FRMEVL ($AD9E), EVAL ($AE86), string concatenation entry via $ADE5
**Bank-switchable:** Yes

### $B07E-$B08A — DIM

**Default use:** DIM (dispatch entry $B081)
**Bank-switchable:** Yes

### $B08B-$B3B2 — Variable lookup, FRE, POS

**Default use:** PTRGET ($B08B) variable/array lookup, FRE ($B37D), POS ($B39E)
**Bank-switchable:** Yes

### $B3B3-$B6DA — DEF/FN, string allocation, garbage collection

**Default use:** DEF/FN ($B3B3), STR$ ($B465), string allocation ($B475), garbage collection ($B526), concatenation ($B63D), string move ($B67A)
**Bank-switchable:** Yes

### $B6DB-$B80C — String functions

**Default use:** CHR$ ($B6EC), LEFT$ ($B700), RIGHT$ ($B72C), MID$ ($B737), LEN ($B77C), ASC ($B78B), VAL ($B7AD), GETNUM/GETADR ($B7EB/$B7F7); the block opens with FRETMS ($B6DB), the string-descriptor-stack pop
**Bank-switchable:** Yes

### $B80D-$BAE1 — PEEK/POKE/WAIT and the floating-point add/multiply package

**Default use:** PEEK ($B80D), POKE ($B824), WAIT ($B82D), FADDH/FSUB/FADD ($B849/$B850/$B867), LOG ($B9EA), FMULT ($BA28), CONUPK ($BA8C)
**Bank-switchable:** Yes

This is the famous "Microsoft BASIC math". FADD is at $B867 (FADDT
$B86A; FSUB $B850, FMULT $BA28, FDIV $BB0F, FIN $BCF3, FOUT $BDDD, SQR
$BF71) — an earlier revision said $B6DB, which is FRETMS, the
string-descriptor-stack pop. The package runs on past $BAE1 to EXP at
$BFED, which ends with JMP $E000: SIN, COS, TAN, ATN and RND live in the
KERNAL ROM ($E26B, $E264, $E2B4, $E30E, $E097). Demo coders sometimes
bank in BASIC just to call these.

### $BAE2-$BFFF — Rest of the floating-point package (FIN, FOUT, SQR, EXP)

**Default use:** MUL10 ($BAE2), DIV10 ($BAFE), FDIV ($BB0F), MOVFM ($BBA2), MOVMF ($BBD4), MOVFA ($BBFC), MOVAF ($BC0C), SGN ($BC39), ABS ($BC58), FCOMP ($BC5B), INT ($BCCC), FIN ($BCF3), FOUT ($BDDD), SQR ($BF71), power, EXP ($BFED; ends with JMP $E000 and continues in the KERNAL ROM)
**Bank-switchable:** Yes

An earlier version of this sub-map placed the string functions at $A9A5
(that is LET), FIN/FOUT in $AF7E-$B6DA (they are at $BCF3/$BDDD) and
"initialization, sign-on message" in $BAE2-$BFFF; BASIC's cold start
($E394), warm start ($E37B), init ($E3BF), default vector table ($E447)
and sign-on text ($E460ff), plus the LOAD/SAVE/VERIFY/SYS/OPEN/CLOSE
statement handlers ($E12A-$E1C7) and RND/COS/SIN/TAN/ATN, live in the
KERNAL ROM, where EXP also finishes. Ranges read from basic-901226-01.bin
and kernal-901227-03.bin.

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

### $DBE8-$DBFF — Color RAM (unused 24 bytes)

**Default use:** 24 bytes of Color RAM not aligned with any visible cell
**Bank-switchable:** Yes

The Color RAM is 1024 bytes but only 1000 cells are on screen. The
trailing 24 bytes ($DBE8-$DBFF, immediately past the last screen cell at
$DBE7) are still RAM and can hold 24 nibbles of program state. An
earlier revision of this page headed this block $D8E8-$DBFF, which is a
792-byte range starting at row 5, column 32 of the visible screen;
$D800 + 1000 = $DBE8 is the first unused byte (measured in VICE x64sc: a
write to $DBE7 colours cell 24/39, a write to $DBE8 colours nothing).

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
also pulls /NMI low — in parallel with CIA2's /IRQ, not through the CIA,
so no $DD0D write touches it (this line used to say "through CIA #2";
see `pitfalls/kernal-and-io.md` → `restore_nmi_not_maskable`).

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

The sub-map below was rebuilt from the 901227-03 jump table and the
$FD30 vector table because ten of its earlier headings named routines
that live elsewhere — RESET at $FCE2 not $FCFC, RAMTAS at $FD50 not
$FD90+, SCNKEY at $EA87 not $E4AC, the keyboard decode tables at
$EB81-$ECB8 not $ECE7, SETMSG/MEMTOP/MEMBOT at $FE18/$FE25/$FE34 not
$F130, the IRQ handler at $EA31-$EA86 not $E97D, and the cassette read
IRQ at $F92C where "Disk LOAD/SAVE" stood. Every address below was read
from the ROM image; the routine names are the conventional Commodore
labels.

### $E000-$E393 — BASIC ROM continuation (EXP tail, RND, trig, BASIC I/O statements, warm start)

**Default use:** Not KERNAL code: EXP finishes here ($E000, entered by JMP from $BFED), the polynomial evaluator ($E043/$E059), RND ($E097), the SYS/SAVE/VERIFY/LOAD/OPEN/CLOSE statement handlers ($E12A-$E1C7), COS/SIN/TAN/ATN ($E264/$E26B/$E2B4/$E30E) and the RUN/STOP-RESTORE warm start ($E37B, reached through the $A002 vector)
**Bank-switchable:** Yes

### $E394-$E4AB — BASIC cold start, init, default vectors, sign-on text

**Default use:** Cold start $E394 (the $A000 vector), CHRGET/RND-seed image $E3A2, init $E3BF (copies CHRGET to $73, installs $03-$06, $54 and $0310, snapshots MEMTOP), default BASIC vector table $E447 (copied to $0300-$030B), sign-on text $E460-$E4AB printed from $E473 (" BASIC BYTES FREE" precedes "**** COMMODORE 64 BASIC V2 ****", which starts at $E47E)
**Bank-switchable:** Yes

### $E4AC-$E4FF — Revision patch area

**Default use:** Code added in 901227-02/-03: CHKOUT wrapper patch $E4AD (called from BASIC's $E118), RS-232 receive patch $E4D3, screen-clear colour $E4DA, FOUND-message pause $E4E0, PAL RS-232 baud table $E4EC; $E4B7-$E4D2 are unused ($AA fill)
**Bank-switchable:** Yes

### $E500-$E5C9 — IOBASE, SCREEN, PLOT, CINT body, screen clear, VIC init

**Default use:** IOBASE $E500 (returns $DC00), SCREEN $E505 (40 × 25), PLOT $E50A, CINT body $E518 (sets $028F/$0290 = $EB48 and the editor defaults, then VIC init $E5A0 from the $ECB9 table), clear screen $E544 (also fills the $D9-$F2 link table), home $E566, cursor set-up $E56C, keyboard-buffer fetch $E5B4
**Bank-switchable:** Yes

### $E5CA-$EA30 — Screen editor (keyboard/screen input, CHROUT screen body, scroll)

**Default use:** Keyboard input $E5CA, input from screen $E632, CHROUT's screen-device body $E716 (control codes, colour codes, cursor movement), scroll $E8EA, insert line $E965, screen-line set-up $E9F0, print-to-screen $EA13 and colour-pointer sync $EA24
**Bank-switchable:** Yes

### $EA31-$EA86 — Default IRQ handler

**Default use:** The service routine $0314/$0315 points to: jiffy clock, cursor blink, tape-motor sense, keyboard scan, CIA #1 acknowledge, register restore and RTI
**Bank-switchable:** Yes

The default IRQ handler at $EA31 is what $0314/$0315 points to. Read
from the kernal-901227-03 ROM bytes, it:

1. Calls UDTIM ($FFEA -> $F69B) to bump the jiffy clock and sample the
   STOP key.
2. Runs the cursor blink ($EA34-$EA60), skipped when $CC is non-zero.
3. Handles the cassette-switch / tape-motor sense via $01 ($EA61-$EA79).
4. Calls SCNKEY ($EA7B: JSR $EA87).
5. Reads $DC0D to acknowledge CIA #1 — last, at $EA7E.
6. Restores Y, X and A and RTIs ($EA81-$EA86).

Replacing $0314/$0315 with your own handler lets you intercept this
sequence — typically you JMP $EA31 to run the whole service after your
raster routine completes, or JMP $EA81 for the bare register-restore
exit. $EA7E is not a cursor-skipping shortcut: it is the
acknowledge-and-exit tail (LDA $DC0D, then $EA81's PLA/TAY/PLA/TAX/PLA/
RTI), so entering there skips the jiffy clock, the STOP-key sense and
the keyboard scan as well as the cursor. Measured in VICE x64sc: with
$0314 pointed at $EA7E, TI did not advance in one second (0 jiffies,
against 64 through $EA31). An earlier version of this page listed the
$DC0D read first and described $EA7E as a shorter path that skipped only
the cursor; the ROM bytes say otherwise.

### $EA87-$ECE6 — SCNKEY keyboard scanner, key decode and key tables

**Default use:** SCNKEY body $EA87 (jump table $FF9F; $EA9B resets the table pointer to $EB81), KEYLOG table-select routine $EB48 (reached via $028F/$0290; toggles $D018 bit 1 on SHIFT+C= at $EB5E), table pointers $EB79, decode tables $EB81 (unshifted), $EBC2 (shifted), $EC03 (C=), the CHR$(14)/CHR$(142) case switch $EC44-$EC5B, CTRL table $EC78-$ECB8, VIC-II power-on register table $ECB9-$ECE6 (46 bytes). The copy loop at $E5A8 (`LDX #$2F`, `LDA $ECB8,X`, `STA $CFFF,X`, `DEX`, `BNE`) copies 47 bytes to $D000-$D02E: the 47th is $ECE7, the `L` ($4C) of the LOAD/RUN string below, and lands in $D02E (sprite 7 colour). Read from `kernal-901227-03.bin`. An earlier version of this line called the table 47 bytes: its end, $ECE6, was right; 47 is the count the loop copies, not the table's length
**Bank-switchable:** Yes

### $ECE7-$ED08 — "LOAD/RUN" string and screen-line low-byte table

**Default use:** $ECE7-$ECEF is the PETSCII string `LOAD<CR>RUN<CR>` that SHIFT+RUN/STOP stuffs into the keyboard buffer; $ECF0-$ED08 is the 25-entry table of screen-line start low bytes ($00 $28 $50 …). Not the keyboard decode tables, which are at $EB81-$ECB8 — an earlier version of this page labelled this range KEYTAB
**Bank-switchable:** Yes

### $ED09-$EEBA — IEC bus driver

**Default use:** TALK $ED09, LISTEN $ED0C, SECOND $EDB9, TKSA $EDC7, IECOUT $EDDD, UNTLK $EDEF, UNLSN $EDFE, IECIN $EE13, clock/data line helpers to $EEB2, 1 ms delay $EEB3 — the only span of the ROM that touches $DD00
**Bank-switchable:** Yes

### $EEBB-$F0BC — RS-232 driver

**Default use:** Software UART: send $EEBB, receive, buffer handling; driven from CIA #2 timers through the NMI and touching only $DD01/$DD0D. (An earlier version of this page began the RS-232 driver at $EF94 and ran the IEC driver to $EF93; the IEC code ends at $EEBA.)
**Bank-switchable:** Yes

### $F0BD-$F12A — KERNAL message text

**Default use:** The control/error message table: I/O ERROR #, SEARCHING FOR, PRESS PLAY ON TAPE, PRESS RECORD & PLAY ON TAPE, LOADING, SAVING, VERIFYING, FOUND, OK (bit 7 set on the last character of each)
**Bank-switchable:** Yes

### $F12B-$F349 — Message printer, GETIN, CHRIN, CHROUT, CHKIN, CHKOUT, CLOSE, CLALL, CLRCHN

**Default use:** Message printer $F12B (tests $9D bit 7; $F12F prints unconditionally), GETIN $F13E, CHRIN $F157, CHROUT $F1CA, CHKIN $F20E, CHKOUT $F250, CLOSE $F291, CLALL $F32F, CLRCHN $F333 (RTS at $F349). STATUS/SETMSG/MEMTOP/MEMBOT are not here — READST is $FE07, SETMSG $FE18, MEMTOP $FE25, MEMBOT $FE34; an earlier version of this page headed $F130-$F156 with those names
**Bank-switchable:** Yes

### $F34A-$F49D — OPEN

**Default use:** OPEN body $F34A (the $031A default), including the RS-232 OPEN path $F409
**Bank-switchable:** Yes

### $F49E-$F5DC — LOAD

**Default use:** LOAD entry $F49E (stores X/Y to $C3/$C4, then JMP ($0330) → body $F4A5, the $0330 default); serial LOAD falls through at $F4B8, tape LOAD branches at $F4B6 to $F533. VERIFY is LOAD with A = 1
**Bank-switchable:** Yes

### $F5DD-$F69A — SAVE

**Default use:** SAVE entry $F5DD (stores the end address to $AE/$AF, then JMP ($0332) → body $F5ED, the $0332 default)
**Bank-switchable:** Yes

### $F69B-$F6FA — UDTIM, RDTIM, SETTIM, STOP

**Default use:** UDTIM $F69B (jiffy increment, then the STOP-key sample at $F6BC that debounces $DC01 row 7 into $91), RDTIM $F6DD, SETTIM $F6E4, STOP $F6ED (the $0328 default). An earlier version headed $F69C-$F7AF "VERIFY, MEMTOP/MEMBOT defaults"; VERIFY is a LOAD mode and MEMTOP/MEMBOT are at $FE25/$FE34
**Bank-switchable:** Yes

### $F6FB-$F92B — I/O error entries, tape header handling, tape prompts

**Default use:** I/O error entry points $F6FB-$F713 (errors 1-9 → "I/O ERROR #n" through the $9D bit-6 test), tape header find $F72C and write $F76A, buffer address helpers $F7D0, PRESS PLAY $F817 / PRESS RECORD $F838 prompts (printed unconditionally through $F12F), tape read/write set-up $F841/$F864
**Bank-switchable:** Yes

### $F92C-$FBCC — Cassette read IRQ

**Default use:** The tape READ interrupt service $F92C (installed from the $FD9B vector table; measures pulse widths on CIA #1 Timer B) and the byte-store routine $FA60. Not disk I/O: this span references CIA #1 sixteen times and CIA #2 never; an earlier version of this page headed $F901-$FB54 "Disk LOAD/SAVE (IEC-bus protocol)" — the serial path is inside LOAD/SAVE above
**Bank-switchable:** Yes

### $FBCD-$FCE1 — Cassette write IRQs and tape housekeeping

**Default use:** Tape WRITE interrupt services ($FBCD data, $FC6A leader), leader/bit timing, restore normal IRQ and screen $FC93, tape motor off $FCCA, read/write pointer compare and bump $FCD1/$FCDB
**Bank-switchable:** Yes

### $FCE2-$FD4F — RESET, cartridge check, RESTOR, VECTOR, default vector table

**Default use:** RESET $FCE2 (the $FFFC vector: LDX #$FF / SEI / TXS / CLD, cartridge check, then IOINIT, RAMTAS, RESTOR, CINT, CLI, JMP ($A000)), cartridge signature check $FD02 comparing $8004-$8008 with "CBM80" at $FD10, RESTOR $FD15, VECTOR $FD1A, 16-word default vector table $FD30-$FD4F copied to $0314-$0333. An earlier version headed $FCFC-$FD2F "RESET handler" and $FD30-$FD8F "vectors initialization"; RESET is $FCE2 and $FD30 is the table, not code
**Bank-switchable:** Yes

The first code that runs after the CPU comes out of reset is $FCE2,
entered via the reset vector at $FFFC.

### $FD50-$FDF8 — RAMTAS, tape IRQ vector table, IOINIT

**Default use:** RAMTAS $FD50 (clears $0002-$0101 and $0200-$03FF, finds top of memory, sets $B2/$B3, $0282, $0288), tape-IRQ vector table $FD9B ($FC6A, $FBCD, $EA31, $F92C), IOINIT $FDA3 (CIA set-up, $01/$00 = $E7/$2F at $FDD5, jiffy timer latch from $02A6 at $FDDD, continued at $FF6E)
**Bank-switchable:** Yes

### $FDF9-$FE42 — SETNAM, SETLFS, READST, SETMSG, SETTMO, MEMTOP, MEMBOT

**Default use:** SETNAM $FDF9, SETLFS $FE00, READST $FE07 (RS-232 status from $0297 when the device is 2), SETMSG $FE18 (STA $9D), SETTMO $FE21, MEMTOP $FE25, MEMBOT $FE34
**Bank-switchable:** Yes

### $FE43-$FF42 — NMI handler, RUN/STOP-RESTORE warm start, RS-232 NMI paths

**Default use:** NMI entry $FE43 (SEI, JMP ($0318)); default handler $FE47 (acknowledges CIA #2, cartridge check, STOP-key test); warm start $FE66 (RESTOR, IOINIT, CINT, JMP ($A002)); NMI exit $FEBC; RS-232 baud-rate table $FEC2; RS-232 NMI receive $FED6 and send $FF07
**Bank-switchable:** Yes

### $FF43-$FF7F — IRQ/BRK dispatcher, CINT wrapper, IOINIT tail

**Default use:** Fake-IRQ entry $FF43 (PHP / PLA / AND #$EF / PHA, falling into) the dispatcher $FF48 (the $FFFE vector: saves A, X, Y, tests the pushed B flag, JMP ($0316) or JMP ($0314)); CINT wrapper $FF5B (the $FF81 target: JSR $E518, PAL/NTSC detect into $02A6, JMP $FDDD); IOINIT timer-start tail $FF6E (reached by JMP from $FDF6)
**Bank-switchable:** Yes

### $FF80-$FF80 — KERNAL revision byte

**Default use:** $AA in 901227-01, $00 in -02, $03 in -03 (PEEK(65408))
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

### $FFF6-$FFF9 — Unused

**Default use:** Four bytes not reached by any code: $52 $52 $42 $59 in 901227-03
**Bank-switchable:** Yes

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
It does not work; an earlier version of this page said it generally did.
The handler does discard the value, but the read itself is the
acknowledge: `LDA $DC0D` at $EA7E is the only place the service routine
touches the CIA's interrupt register, and the ICR is cleared only when
the CIA sees the read. With CHAREN = 0 the PLA selects the character ROM
instead of the CIA, so the flag stays set, /IRQ stays low, and because
RTI has no interrupt-delay the CPU re-enters the handler immediately
after every RTI. The main program never executes another instruction —
measured in VICE x64sc: with a `$0314` handler counting passes, a
main-program instruction counter stayed at 0 across 4,909 handler passes
in 20M cycles and 7,822 in 30M, while the identical code with $01 = $37
finished inside one jiffy. (The handler also reads $DC01 as char-ROM
byte $99, so SCNKEY runs a full phantom matrix scan on every pass.)
*Always SEI before banking the character ROM in, and restore $01 before
CLI — not only "if timing matters".*

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
**LORAM:** 1, **HIRAM:** 0, **CHAREN:** 0

| Range        | Contents     |
|--------------|--------------|
| $A000-$BFFF  | RAM          |
| $D000-$DFFF  | Character ROM|
| $E000-$FFFF  | RAM          |

Almost never used — see Mode 24 instead.

### Mode 29 — I/O only (no BASIC, no KERNAL)

**$01 value:** $35
**LORAM:** 1, **HIRAM:** 0, **CHAREN:** 1

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

(An earlier version of this page gave LORAM = 0 for modes 29 and 25 and
CHAREN = 1 for mode 24; the $01 values and the truth table below were
right, the bit prose was not — measured in VICE x64sc: $35 maps
RAM/I-O/RAM at $A000/$D000/$E000, $31 maps RAM/char ROM/RAM, and $30
and $34 are both all RAM.)

### Mode 24 — all RAM (no ROM, no I/O)

**$01 value:** $30
**LORAM:** 0, **HIRAM:** 0, **CHAREN:** 0 ($34, CHAREN = 1, is mode 28 and maps identically — with LORAM and HIRAM both 0 the PLA ignores CHAREN)

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

### The truth table - no-cartridge rows

Below are the eight no-cartridge rows (GAME = EXROM = 1, modes 24-31) of
the 32-row PLA table. Modes are numbered 0-31 as LORAM + HIRAM x 2 +
CHAREN x 4 + GAME x 8 + EXROM x 16, so the eight rows here are $01 bits
0-2 plus 24. The remaining 24 rows are the cartridge configurations
(16 KB cart: modes 0-7; 8 KB cart: 8-15; Ultimax: 16-23) - see
[Cartridge modes](#cartridge-modes-exrom--game). An earlier version of
this page called this table the full 32-mode table; it never was.

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
  $A000-$BFFF, with BASIC ROM disabled. ROMH at $A000 requires HIRAM = 1;
  LORAM only gates ROML (measured in VICE x64sc).
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
- **$D8** — Insert count (INSRT): number of pending INST presses; CHROUT
  decrements it as characters are typed.
- **$D9-$F2** — Screen line link table (LDTB1), 26 entries: one per
  screen row plus a sentinel entry at $F2 so row 24 is never read as
  continued. Bits 0-1 of an entry are the row's screen-address high-byte
  offset (OR'd with $0288 when used); bit 7 set means the row starts a
  logical line, clear means it continues the row above. (This page
  previously ended the table at $F1 and put the insert count at $F2; the
  KERNAL's fill loop at $E544 writes 26 entries and never addresses $F2
  on its own — measured from the ROM and in VICE x64sc.)
- **$F3-$F4** — Colour RAM pointer for the current line (low byte = $D1;
  high byte = ($D2 & 3) | $D8).
- **$F5-$F6** — Key decode table pointer.
- **$F7-$FA** — RS-232 buffer pointers.

If your program calls *any* KERNAL routine — even CHROUT — the KERNAL
will read and write zero page. The full list of zeropage bytes the
KERNAL uses is in *Mapping the Commodore 64* chapter 1.

Five zero-page bytes are never touched by either ROM after RAMTAS's
reset clear: $02 and $FB-$FE (this page used to say $FB-$FE were the
only four).

### What BASIC uses

BASIC's workspace is $03-$8F, with the executable CHRGET routine at
$73-$8A ($02 is not BASIC's — see $0002 above).

- **$03-$8A** — Working registers and pointers for parsing, tokenization,
  expression evaluation, floating-point math.
- **$8B-$8F** — RND seed.

If your program doesn't return to the BASIC READY prompt and doesn't
call BASIC ROM routines, all of $03-$8F is free except where it overlaps
the CHRGET code at $73-$8A. To free up $73-$8A, you'd need to make sure
no future BASIC interpretation happens.

### Best practices for zero page

When writing assembly that coexists with KERNAL:

1. **Use $FB-$FE and $02 first.** These five bytes are safe.
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
- **JSR addr** — push the address of the JSR's last byte (the return
  address minus one), high byte first then low byte, so inside the
  callee the low byte is at $0101+S and the high byte at $0102+S
  (measured in VICE x64sc; an earlier version of this bullet said the
  low byte sat at the higher address, which is backwards). Then
  PC := addr.
- **RTS** — pull return-address-minus-one + 1.
- **BRK / IRQ / NMI** — push PCH, PCL, status; PC := vector.

### BASIC use of the stack

BASIC pushes substantial state on the stack for GOSUB and FOR-NEXT:

- **GOSUB** pushes 5 bytes: `$8D` (GOSUB token), current line number
  (2 bytes), text pointer (2 bytes).
- **FOR** pushes 18 bytes (push order; read back last-pushed first):
  text pointer (2), line number (2), TO limit (5 bytes FP, sign folded
  into the first mantissa byte), STEP sign (1), STEP value (5 bytes FP),
  pointer to the index variable's descriptor (2), `$81` (FOR token). The
  stack search at $A38A walks frames in steps of 18 (`ADC #$12`). An
  earlier revision of this page also listed an "index variable name (2)"
  entry and put STEP before the limit; the frame holds a pointer, not
  the name, and that entry made the itemization sum to 20 (verified
  against the ROM at $A75D-$A7AD and a stack dump in VICE x64sc).

So a deeply-nested BASIC program can exhaust the stack faster than you'd
expect — 8 nested FORs = 144 bytes, more than half the stack.

### Assembly hygiene

The KERNAL reset ($FCE2) sets S to $FF (LDX #$FF / SEI / TXS) and hands
over to BASIC with S still $FF; it is BASIC's cold start that then does
LDX #$FB / TXS ($E39D), and CLR/RUN lower the base to $FA ($A681).
Earlier text credited the $FB to the KERNAL. By the time a SYS reaches
your code S is lower again: $F7 for a SYS typed at the READY prompt on a
freshly booted machine, $F6 for a SYS inside a RUN program or typed
after one (RUN's CLR resets the base to $FA, then the statement
dispatcher's JSR and SYS's pushed return address each take two bytes) —
both measured in VICE x64sc 3.10. Pure-assembly programs that take over
should do `LDX #$FF / TXS` to reset the stack pointer to the top.

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

The public interface is the jump table at $FF81-$FFF5 — 39 entries of 3
bytes each. Twenty-nine are `JMP addr`; the ten I/O entries (OPEN,
CLOSE, CHKIN, CHKOUT, CLRCHN, CHRIN, CHROUT, STOP, GETIN, CLALL) are
`JMP (vector)` through the RAM vectors at $031A-$032D, which is why
patching $0326/$0327 redirects `JSR $FFD2` while a direct `JSR $F1CA`
bypasses the hook. (An earlier version said every entry was a direct
`JMP addr`; the ROM bytes show opcode $6C at ten of them.) Calling
KERNAL routines through the jump table is *strongly* preferred over
calling them directly: the jump table is stable across KERNAL ROM
revisions; the implementation addresses are not.

### KERNAL revisions

Three production KERNAL ROMs shipped: 901227-01, -02 and -03 (the C64C's
combined 16 KB BASIC+KERNAL mask, usually given as 251913-01, is
documented as carrying the -03 KERNAL — no image on this machine, not
measured here). `PEEK(65408)` ($FF80) returns 170, 0 or 3. The jump
table $FF81-$FFF5 is at the same addresses in all three and 38 of 39
targets are unchanged; the one that moved is CINT ($FF81 = `JMP $E518`
in -01, `JMP $FF5B` in -02/-03). The differences are 277 bytes of
in-place patches (-01/-02 227, -02/-03 57; `cmp` of the VICE 3.9
images):

- **-02 added PAL/NTSC detection.** A CINT wrapper at $FF5B runs $E518,
  waits for $D012 to wrap, stores $D019 bit 0 (the raster compare for
  line 311 set by the new VIC init table $D011/$D012 = $9B/$37) in
  $02A6, and IOINIT ($FDDD) then loads the jiffy timer with $4025 (PAL)
  or $4295 (NTSC) where -01 hard-coded $411B. RS-232 OPEN ($F428) and
  the NMI baud code ($FF08-$FF42) pick a PAL baud table at $E4EC by
  $02A6; BASIC's CHKOUT wrapper ($E118) calls a patch at $E4AD that
  preserves A.
- **-02 and -03 each changed the screen-clear colour** ($EA0B → $E4DA:
  -01 white `LDA #$01`, -02 background `LDA $D021`, -03 current text
  colour `LDA $0286`). -03 also patched the screen editor's cursor-line
  set-up ($E57C-$E599, $E621: the colour pointer $F3/$F4 is resynced via
  $EA24, and the line-start search is skipped when the cursor row
  already equals the input row $C9) and one RS-232 receive path ($EF94
  → $E4D3).
- **The only cassette change is the pause after the FOUND message**
  ($F761): -01 waits for a key to register in $91; -02/-03 wait until
  the jiffy clock's middle byte $A1 has advanced by three (`ADC #$02`
  with the carry left set by the preceding `CPY #$15`, roughly 9-13 s)
  or a key registers in $91 — routine $E4E0. The tape read/write code
  $F767-$FCFB, every pulse-timing constant included, is byte-identical
  in all three, and so are the keyboard scan, decode and key tables
  ($EA13-$ECC9). An earlier version of this section said the revisions
  differed in "cassette timing constants and one keyboard-handling fix";
  neither is in the ROM bytes.

*Always JSR through the jump table.* See kernal-routines-reference.md
§ KERNAL ROM revisions, which gives the same account.

### KERNAL layout summary

| Range         | Function                                           |
|---------------|----------------------------------------------------|
| $E000-$E393   | BASIC ROM overflow (EXP/RND/trig, BASIC I/O command handlers, warm start $E37B) |
| $E394-$E4AB   | BASIC cold start $E394, init $E3BF, default vector table $E447, sign-on text ($E460-$E4AB, printed from $E473) |
| $E4AC-$E4FF   | Revision patches (CHKOUT wrapper $E4AD, RS-232 $E4D3, screen-clear colour $E4DA, FOUND pause $E4E0, PAL baud table $E4EC); $E4B7-$E4D2 unused |
| $E500-$E5C9   | IOBASE $E500, SCREEN $E505, PLOT $E50A, CINT body $E518, clear screen $E544, VIC init $E5A0 |
| $E5CA-$EA30   | Screen editor: keyboard/screen input, CHROUT screen body $E716, scroll $E8EA |
| $EA31-$EA86   | Default IRQ handler (CIA acknowledge $EA7E, register restore/RTI $EA81) |
| $EA87-$ECE6   | SCNKEY $EA87, KEYLOG $EB48, key decode tables $EB81-$ECB8, VIC power-on table $ECB9-$ECE6 (the copy at $E5A8 also takes $ECE7) |
| $ECE7-$ED08   | "LOAD/RUN" string, screen-line low-byte table      |
| $ED09-$EEBA   | IEC bus (TALK $ED09, LISTEN $ED0C, SECOND $EDB9, TKSA $EDC7, IECOUT $EDDD, UNTLK $EDEF, UNLSN $EDFE, IECIN $EE13, 1 ms delay $EEB3) |
| $EEBB-$F0BC   | RS-232 driver                                      |
| $F0BD-$F12A   | KERNAL message text                                |
| $F12B-$F349   | Message printer $F12B, GETIN $F13E, CHRIN $F157, CHROUT $F1CA, CHKIN $F20E, CHKOUT $F250, CLOSE $F291, CLALL $F32F, CLRCHN $F333 |
| $F34A-$F49D   | OPEN                                               |
| $F49E-$F5DC   | LOAD (entry $F49E, body $F4A5; serial $F4B8, tape $F533) |
| $F5DD-$F69A   | SAVE (entry $F5DD, body $F5ED)                     |
| $F69B-$F6FA   | UDTIM $F69B (STOP-key sample $F6BC), RDTIM $F6DD, SETTIM $F6E4, STOP $F6ED |
| $F6FB-$F92B   | I/O error entries, tape header find/write, PRESS PLAY/RECORD prompts |
| $F92C-$FBCC   | Cassette READ IRQ ($F92C), tape byte store $FA60   |
| $FBCD-$FCE1   | Cassette WRITE IRQs ($FBCD, $FC6A), restore IRQ $FC93, motor off $FCCA |
| $FCE2-$FD4F   | RESET $FCE2, cartridge check $FD02, RESTOR $FD15, VECTOR $FD1A, vector table $FD30 |
| $FD50-$FDF8   | RAMTAS $FD50, tape IRQ vectors $FD9B, IOINIT $FDA3 (timer latch $FDDD) |
| $FDF9-$FE42   | SETNAM $FDF9, SETLFS $FE00, READST $FE07, SETMSG $FE18, SETTMO $FE21, MEMTOP $FE25, MEMBOT $FE34 |
| $FE43-$FF42   | NMI $FE43 → $FE47, RUN/STOP-RESTORE warm start $FE66, RS-232 NMI paths $FED6/$FF07 |
| $FF43-$FF7F   | IRQ/BRK dispatcher $FF48 (fake-IRQ entry $FF43), CINT wrapper $FF5B, IOINIT timer tail $FF6E |
| $FF80-$FF80   | Revision byte ($03)                                |
| $FF81-$FFF5   | Public jump table (39 entries; 10 indirect via $031A-$032D) |
| $FFF6-$FFF9   | Unused                                             |
| $FFFA-$FFFF   | CPU vectors (NMI $FE43, RESET $FCE2, IRQ/BRK $FF48) |

The previous version of this table misattributed several ranges — the
keyboard scan sat inside a row labelled "IEC bus driver", the cassette
read IRQ was labelled "Disk LOAD/SAVE via IEC", RAMTAS was placed in the
BASIC-entry row, "$FF48-$FF80" was called IRQ/BRK preamble although
$FF5B-$FF7F is CINT's PAL/NTSC wrapper and IOINIT's timer tail, and the
first row overlapped the second by one byte. The boundaries above were
read from the 901227-03 jump table, the $FD30 vector table and the
$FD9B tape-IRQ vector table.

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
- **$EA7E** — acknowledge-and-exit tail of the default handler:
  `LDA $DC0D`, then the `$EA81` register restore and RTI. It does not
  run UDTIM or SCNKEY; chain here only when your own handler has done,
  or does not need, the jiffy clock, the STOP key and the keyboard.
  (This bullet used to say $EA7E kept UDTIM and the keyscan and skipped
  only the cursor blink; it skips all three — an agent following the
  old text ships a dead keyboard, a frozen TI$ and a dead RUN/STOP.)
- **$EA81** — bare exit: PLA/TAY/PLA/TAX/PLA/RTI. Chain here from a
  handler that has acknowledged its own interrupt source.
- **$FF48** — IRQ preamble (saves A, X, Y to stack). The default IRQ
  vector at $FFFE points here.
- **$F6BC** — the STOP-key sample at the tail of UDTIM ($F69B falls
  into it): reads keyboard row 7 from $DC01 (SCNKEY leaves $DC00 = $7F,
  the row that holds RUN/STOP), debounces it and stores it in $91 for
  STOP ($FFE1 → $F6ED) to test, then RTS. Calling it yourself only
  refreshes $91. An earlier revision called this the "RUN/STOP loop
  entry" that RUN/STOP+RESTORE bounces to; it is not. RUN/STOP+RESTORE
  is the NMI handler ($FFFA → $FE43 → ($0318) = **$FE47**): it
  acknowledges CIA #2 ($DD0D — a CIA #2 NMI takes the RS-232 path
  instead), checks for a CBM80 cartridge ($FD02; a cartridge's $8002
  vector wins), then `JSR $F6BC`, `JSR $FFE1`, and if STOP is down falls
  into **$FE66**: RESTOR ($FD15), IOINIT ($FDA3), CINT ($E518),
  `JMP ($A002)` → $E37B warm start. RESTORE alone (STOP up) returns
  through $FEBC and does nothing. To do what RUN/STOP+RESTORE does from
  software use `SEI : JMP $FE66` (SYS 65126 from BASIC): the real path
  arrives with I set, RESTOR rewrites $0314–$0333 with no SEI of its
  own, and $E37B ends in CLI. Measured in VICE x64sc 3.10 against the
  901227-03 ROM: `JSR $F6BC` returns with $91 = $FF; `SEI : JMP $FE66`
  clears the screen, restores $D020/$D021 to $0E/$06 and prints READY.
  with no banner; `JMP $FCE2` (SYS 64738, cold reset) prints the banner.

## BASIC ROM map

The BASIC ROM at $A000-$BFFF (8 KB) contains Microsoft BASIC v2.0,
licensed from Microsoft in 1977. The implementation is virtually
identical to PET BASIC 4.0 minus the disk commands, plus a few C64
quirks.

### BASIC ROM layout

| Range | Function |
|---|---|
| $A000-$A00B | Cold/warm-start vectors ($E394/$E37B), "CBMBASIC" |
| $A00C-$A389 | Statement dispatch ($A00C, entry-1), function dispatch ($A052), operator table, keyword text ($A09E), error messages, "OK"/"ERROR"/"IN"/"READY."/"BREAK" strings ($A364-$A389) |
| $A38A-$A47F | FOR-stack search ($A38A), stack/memory checks ($A3FB, $A408), ERROR ($A437 = JMP ($0300)), READY ($A474) |
| $A480-$A641 | Main loop ($A480 = JMP ($0302), $A483), insert line, INLIN ($A560), CRUNCH ($A57C), FNDLIN ($A613) |
| $A642-$A741 | NEW ($A642), CLR ($A65E), LIST ($A69C, detokenize $A71A) |
| $A742-$A9A4 | FOR ($A742), NEWSTT/GONE ($A7AE/$A7E4), RESTORE ($A81D), STOP/END ($A82F/$A831), CONT ($A857), RUN ($A871), GOSUB ($A883), GOTO ($A8A0), RETURN ($A8D2), DATA ($A8F8), IF ($A928), REM ($A93B), ON ($A94B), LINGET |
| $A9A5-$AC05 | LET ($A9A5), PRINT# ($AA80), CMD ($AA86), PRINT ($AAA0), STROUT ($AB1E), GET ($AB7B), INPUT# ($ABA5), INPUT ($ABBF) |
| $AC06-$AD1D | READ ($AC06) and its "?EXTRA IGNORED"/"?REDO FROM START" messages |
| $AD1E-$AD89 | NEXT ($AD1E) |
| $AD8A-$B07D | Expression evaluator: FRMNUM ($AD8A), CHKNUM ($AD8D), FRMEVL ($AD9E), EVAL ($AE86), string concatenation entry via $ADE5 |
| $B07E-$B08A | DIM (dispatch entry $B081) |
| $B08B-$B3B2 | PTRGET ($B08B) variable/array lookup, FRE ($B37D), POS ($B39E) |
| $B3B3-$B6DA | DEF/FN ($B3B3), STR$ ($B465), string allocation ($B475), garbage collection ($B526), concatenation ($B63D), string move ($B67A) |
| $B6DB-$B80C | String functions: CHR$ ($B6EC), LEFT$ ($B700), RIGHT$ ($B72C), MID$ ($B737), LEN ($B77C), ASC ($B78B), VAL ($B7AD), GETNUM/GETADR ($B7EB/$B7F7) |
| $B80D-$BAE1 | PEEK ($B80D), POKE ($B824), WAIT ($B82D), FADDH/FSUB/FADD ($B849/$B850/$B867), LOG ($B9EA), FMULT ($BA28), CONUPK ($BA8C) |
| $BAE2-$BFFF | MUL10 ($BAE2), DIV10 ($BAFE), FDIV ($BB0F), MOVFM ($BBA2), MOVMF ($BBD4), MOVFA ($BBFC), MOVAF ($BC0C), SGN ($BC39), ABS ($BC58), FCOMP ($BC5B), INT ($BCCC), FIN ($BCF3), FOUT ($BDDD), SQR ($BF71), power, EXP ($BFED; ends with JMP $E000 and continues in the KERNAL ROM) |

An earlier version of this table placed the string functions at $A9A5
(that is LET), FIN/FOUT at $AF7E-$B6DA (they are at $BCF3/$BDDD) and
the cold start in $BAE2-$BFFF; BASIC's cold start ($E394), warm start
($E37B), init ($E3BF), default vector table ($E447) and sign-on text
($E460ff), plus the LOAD/SAVE/VERIFY/SYS/OPEN/CLOSE statement handlers
($E12A-$E1C7) and RND/COS/SIN/TAN/ATN, live in the KERNAL ROM, where EXP
also finishes. All addresses read from basic-901226-01.bin /
kernal-901227-03.bin.

### Useful BASIC entry points

Even if you're writing pure assembly, a few BASIC ROM routines are
worth calling. The addresses and behaviour below are read from the
basic-901226-01 ROM image; the names are the conventional Microsoft
BASIC labels, corroborated by the call sites (PRINT's number path is
FOUT's only caller, FPWRT's tail is EXP's only caller, FOR loads its
default STEP through $BBA2). An earlier version of this list had five of
the six entries mislabelled; each line says what it used to claim.

- **$A560** — INLIN (read a line of input into the buffer at $0200);
  an earlier version listed it as CRUNCH.
- **$A57C** — CRUNCH body (tokenize the line at $0200); $A579 is the
  `JMP ($0304)` that reaches it.
- **$AB1E** — STROUT (print a string terminated by $00 or a quote,
  pointer in A=lo, **Y=hi**; A, X and Y are all clobbered). An earlier
  version of this line said X=hi; STRLIT at $B487 stores `STA $6F /
  STY $70` and overwrites X with #$22 before ever reading it, so a call
  with the high byte in X prints from a garbage pointer.
- **$BA8C** — CONUPK (unpack the 5-byte float at (A/Y) into ARG,
  $69-$6E); an earlier version called this MOVFA. MOVFA (ARG → FAC) is
  $BBFC.
- **$BBA2** — MOVFM (load FAC from the 5-byte float at (A/Y)); an
  earlier version called this FIN.
- **$BC0C** — MOVAF (copy FAC to ARG); an earlier version called this
  FOUT.
- **$BCF3** — FIN (ASCII at TXTPTR to FAC). Call it the way the ROM
  does: JSR $0079 (CHRGOT) or $0073 (CHRGET) first, so A holds the first
  character and the carry is clear for a digit; both ROM callers ($AE8A,
  $B7D7) do exactly that.
- **$BDDD** — FOUT (FAC to a $00-terminated ASCII string starting at
  $0100; A/Y return the pointer).
- **$BFED** — EXP (e^FAC; continues at $E000). Earlier revisions called
  this MULT2.

### BASIC vectors (RAM)

BASIC's behavior is partly steered by 6 vector pairs at $0300-$030B (an
earlier revision of this page said 7; the range is 12 bytes, and the
defaults are the six words the BASIC cold start copies from the ROM
table at $E447 via the loop at $E453). $030C-$030F hold the SYS register
images and $0310-$0312 the USR JMP, not further vectors.

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

| Range        | Set | Codes   | Contents                                                        |
|--------------|-----|---------|-----------------------------------------------------------------|
| $D000-$D0FF  | 1   | 0-31    | @, A-Z, [ £ ] ↑ ←                                               |
| $D100-$D1FF  | 1   | 32-63   | space ! " # $ % & ' ( ) * + , - . / 0-9 : ; < = > ?             |
| $D200-$D3FF  | 1   | 64-127  | graphics: horizontal bar (64), card suits, box-drawing, blocks  |
| $D400-$D7FF  | 1   | 128-255 | reverse video of 0-127                                          |
| $D800-$D8FF  | 2   | 0-31    | @, a-z, [ £ ] ↑ ←                                               |
| $D900-$D9FF  | 2   | 32-63   | space, punctuation, 0-9 (byte-identical to set 1)               |
| $DA00-$DBFF  | 2   | 64-127  | horizontal bar (64), A-Z (65-90), remaining graphics            |
| $DC00-$DFFF  | 2   | 128-255 | reverse video of set 2's 0-127                                  |

An earlier version of this table put space, punctuation and the digits
at codes 64-127 and listed a backslash at code 28; measured against
`chargen-901225-01.bin`, the digits and punctuation are codes 32-63
(`0` is code 48 at $D180), codes 64-127 are the graphics set (code 64 at
$D200 is the horizontal bar), and code 28 is £ — the C64 character ROM
has no backslash. The reverse-video halves are the bitwise inverse of
codes 0-127 for every glyph except `@`: reversed `@` (code 128, $D400
and $DC00) differs from the true inverse by one pixel in row 6 ($99
where NOT $62 = $9D).

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
containing four chips' worth of registers (VIC-II, SID, CIA #1, CIA #2)
plus 1 KB of Color RAM plus 2 × 256 bytes of cartridge I/O. (An earlier
version of this sentence said five; the Color RAM is a nibble-wide
static RAM with no registers and is already counted separately here.)

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

If you read from an address in the I/O block that no chip drives, you
get an "open bus" read: whatever the data bus last carried, which on a
C64 is usually the byte the VIC-II fetched in the preceding half-cycle.
On a stock machine that means $DE00-$DFFF with no cartridge fitted (and
the upper nibble of Color RAM, see $D800 above). The VIC-II's unused
addresses $D02F-$D03F are *not* open bus: the chip answers $FF and
ignores writes (measured in VICE x64sc; see
[vic-ii-reference.md](vic-ii-reference.md)). An earlier version of this
section used $D02F as the open-bus example, which it is not. Open-bus
values are unpredictable; don't rely on them.

### I/O timing

Reading or writing any I/O register takes the normal 4 CPU cycles for
the access. The CIAs and SID have no wait states. The VIC-II can,
however, *steal* the bus from the CPU on badlines and during sprite
DMA, which appears to the CPU as the instruction simply taking longer
to execute. See [vic-ii-reference.md](vic-ii-reference.md#raster-system).

## Pitfalls

- **$0001 — clobbering KERNAL zeropage.** Writing to addresses in
  $90-$FE while interrupts are enabled risks the KERNAL IRQ handler
  reading or writing the same byte. The IRQ ticks about 60 times a
  second on both PAL and NTSC (CIA #1 Timer A, latch $4025 on PAL and
  $4295 on NTSC — the period is latch+1 cycles; see $00A0-$00A2; an
  earlier version said "or 50 Hz on PAL") and runs UDTIM ($FFEA) + the
  keyscan, both of which touch zeropage. Disable IRQs (SEI) before
  manipulating KERNAL-owned zero-page bytes.

- **$0000 / $0001 — DDR must be set first.** Writing to the
  processor-port data register $01 only affects pins configured as
  outputs by the DDR at $00. If a prior program (or a bug) has left
  bits of $00 as inputs, your bank-switch write won't take. Always
  write the expected DDR ($2F for a stock C64) before writing $01:
  `LDA #$2F / STA $00 / LDA #$35 / STA $01`.

- **$01 bit 6/7 — unconnected pins on stock C64.** Bits 6 and 7 of $01
  are not bonded out on a stock C64 (the C128's 8502 gives bit 6 to the
  CAPS LOCK key; whether SX-64 boards differ is sometimes claimed and
  not verified here).
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

- **$D018 — CHROUT changes it for exactly two codes, and the keyboard
  can too.** CHROUT does not touch $D018 on ordinary output (an earlier
  version of this page said it wrote $D018 on every call "in screen
  mode 1"; the KERNAL has no such path — the 901227-03 ROM holds only
  the two conditional stores named here). PETSCII $0E / CHR$(14) *sets*
  bit 1 (charset 2, lower case) and $8E / CHR$(142) *clears* it
  ($EC44-$EC5B); the IRQ keyscan *toggles* bit 1 with EOR when SHIFT+C=
  is pressed ($EB48-$EB61), once per press and only while $0291 bit 7
  is clear. Measured in VICE x64sc: with $D018 preset to $1C, 60
  CHROUTs of "A" and 30 scrolling CRs left it unchanged, and a sweep of
  all 256 codes changed it exactly twice, at $0E and $8E. A custom font
  is the usual victim, because bit 1 selects the odd 2 KB half: a font
  at $2000 ($D018 = $18) becomes $2800 ($1A) on SHIFT+C=. Remedies: do
  not send $0E/$8E; lock the keyboard path with CHR$(8) (or POKE $0291
  = $80) — which does *not* suppress the CHROUT codes (measured: after
  CHR$(8), CHR$(14) still set bit 1); or re-write $D018 in your own
  IRQ. Wrapping every CHROUT in a save/restore of $D018 is unnecessary.

- **$DD00 — VIC-II bank changes via CIA #2 are inverted.** Setting
  $DD00 bits 0-1 to 11 (binary) selects VIC bank 0, not 3. The bits
  are inverted because the lines drive the VIC's address pins active-
  low. Off-by-one bank selection is a classic crash mode. (An earlier
  version of this entry was headed $DC00-$DCFF; that range is CIA #1,
  the keyboard/joystick chip, and writing bank bits there leaves the
  VIC where it was — measured in VICE x64sc.)

- **$D7FF — SID write side-effects via shadow.** A write to $D7FF lands
  in SID register $1F (which is undefined). Some emulators handle this
  differently from real hardware. Avoid writing to SID shadow addresses;
  always use the canonical $D400-$D41C window.

- **$02, $00FB-$00FE — five bytes of safe zeropage.** When coexisting
  with BASIC and KERNAL, $02 and $FB-$FE are the only zero-page bytes
  neither ROM touches after reset. Using $03-$8F clobbers BASIC; using
  $90-$FA clobbers KERNAL; $FF is BASIC's FOUT workspace. (Earlier text
  counted four bytes and put $02 in BASIC's range; the ROM bytes show no
  reference to $02 beyond RAMTAS's reset clear.) The fix: take over the
  machine, or stay inside those five.

- **$0100-$01FF — stack page wraparound.** The stack pointer S is 8
  bits and wraps from $00 to $FF without warning — but only your own
  machine code can get there. BASIC guards its stack: every GOSUB, FOR
  and expression-nesting level first calls the check at $A3FB, which
  raises ?OUT OF MEMORY (error 16) unless the stack pointer seen inside
  that routine is at least 2×n+$3E ($44 for GOSUB, n=3; $50 for FOR,
  n=9; $40 per expression level, n=1). So `10 GOSUB 10` stops with
  "?OUT OF MEMORY ERROR IN 10" and S never falls below about $40 —
  measured in VICE x64sc: the GOSUB loop trips with S=$40, 64 bytes of
  the page still unused. An earlier version of this page said a deep
  BASIC nest wraps S past zero with no trap; it does not. PHA/JSR chains
  in your own code under an existing stack have no such guard: that is
  where the wrap bites.

- **$0314-$0333 — vector resetting on KERNAL RESTOR.** The KERNAL's
  RESTOR routine ($FF8A, body at $FD15) copies the ROM default table at
  $FD30-$FD4F over $0314-$0333. Calling RESTOR, VECTOR ($FF8D) with
  C=0, or anything that runs the reset ($FCE2) or RUN/STOP+RESTORE
  ($FE47) sequence — both of which call RESTOR themselves — wipes your
  custom IRQ handler. IOINIT ($FF84) and CINT ($FF81) do *not*: the only
  callers of $FD15 in the ROM are $FCF8 and $FE66, and in VICE x64sc a
  custom $0314/$0315 survives both IOINIT and CINT and is replaced by
  RESTOR (an earlier version of this page said IOINIT calls RESTOR
  internally; it does not). Hook by writing $0314/$0315 *after* the
  last such call.

- **$0800 — BASIC program-start sentinel.** BASIC requires the byte
  just below TXTTAB — $0800, not $0801 as an earlier revision of this
  entry said — to be $00 (see $0800 above). It stands in for the
  end-of-line marker of the line before the first one: RUN and NEW both
  reset TXTPTR to TXTTAB−1 (RUNC, $A68E) and the next-statement fetch
  ($A7BE) reads that byte, so anything but $00 there answers
  `?SYNTAX ERROR` (measured in VICE x64sc: `POKE 2048,1` then RUN →
  `?SYNTAX ERROR`; NEW → `?SYNTAX ERROR` too, although the program is
  still erased). LIST is unaffected — it walks the link chain from
  TXTTAB. $0801–$0802 are the first line's link pointer and are
  non-zero in any program with a line (`0B 08` for the stub below). A
  machine-language file with load address $0801 cannot disturb the
  sentinel; what breaks it is a file that loads at $0800 with a non-zero
  first byte, or code that uses $0800 as scratch. Use a BASIC SYS stub
  at $0801; a raw load at $0801 without one is started with `SYS 2049`,
  not RUN.

- **$8000 — "CBM80" cart auto-start magic.** At reset (and on NMI) the
  KERNAL routine at $FD02 (called from $FCE2) compares $8004-$8008 with
  `C3 C2 CD 38 30` ("CBM80" in PETSCII, the letters shifted); on a
  match reset does `JMP ($8000)` before any initialisation, and RESTORE
  jumps through $8002/$8003. A cartridge at $8000-$9FFF (or a 16 KB one
  at $8000-$BFFF) autostarts this way; ROM at $A000-$BFFF alone cannot,
  because the check runs while BASIC ROM is still mapped there.
  $8000-$9FFF is ordinary RAM when no cartridge is inserted, so if a
  program leaves those nine bytes looking like a cartridge header, the
  next reset jumps through whatever is at $8000 instead of booting
  BASIC — a trick reset-protected software has used deliberately, and a
  crash mode if it is left there by accident (which programs do it is
  not verified here). (An earlier version placed the check at
  $A000-$A008; $A000 is BASIC ROM at reset and is never checked — the
  ROM compares $8003,X, verified against kernal-901227-03 and in VICE.)

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

- **Stack page double-duty.** BASIC's float-to-ASCII routine FOUT
  ($BDDD, in the BASIC ROM; reached by PRINT and STR$, and by the
  line-number print that LIST and the `IN` message use) builds its
  string at the bottom of the stack page. The PRINT entry writes
  $0100-$010F in the worst case (`-1.23456789E+28` is 15 characters
  plus the terminator; the routine caps output at nine digits); the
  STR$ and LIST entries start one byte lower, at $00FF. Measured in
  VICE x64sc by seeding $00F8-$011F and calling the routine. An earlier
  version of this note called the routine the KERNAL's, said it was
  reached through CHROUT, and stopped the buffer at $010A — CHROUT
  prints one character and never converts a number. Anything parked at
  $00FF-$010F (a depacker, a saved register block, the tape error log)
  is overwritten the next time BASIC prints a number. Pushed data is
  only reached once S has descended below $10 — about 240 bytes deep —
  so "PHA'd 11 bytes" was never the hazard.

- **$DE00/$DF00 open bus.** With no cartridge, reads from $DE00-$DFFF
  return open-bus garbage (typically the last VIC fetch). Don't probe
  for cartridge presence by reading these — write a known pattern
  and read it back, or use a dedicated detection sequence.

- **$0000/$0001 cassette-motor write side-effect.** Writing to $01
  with bit 5 cleared turns on the cassette motor. If your bank-switch
  code uses `LDA #$05 / STA $01`, you're also turning the cassette
  motor *on*. Mask carefully: typical bank values keep bit 5 = 1.

- **MEMSIZ is snapshotted by BASIC.** $0283/$0284 is the KERNAL's
  top-of-memory, set by RAMTAS (via $FE2D) at reset. BASIC copies it
  into its own MEMSIZ ($37/$38) and STRBOT/FRETOP ($33/$34) once, at
  cold start ($E40A-$E414: SEC / JSR $FF99 / STX $37 / STY $38 /
  STX $33 / STY $34), and never reads $0283/$0284 again — the BASIC ROM
  contains no reference to it. Poking $0283/$0284, or calling MEMTOP
  ($FF99) with C=0 — which does nothing but STX $0283 / STY $0284 —
  therefore has no effect on BASIC's string space (an earlier revision
  of this page said to call MEMTOP instead of poking; measured in VICE,
  both leave BASIC's top at $A000 and the next string is placed just
  under it). To reserve memory above BASIC, lower $37/$38 and then CLR,
  which recopies MEMSIZ into FRETOP: `POKE 55,lo: POKE 56,hi: CLR`
  (e.g. `POKE 56,128: CLR` for $8000). The one runtime path that does
  resync BASIC from the KERNAL's top is RS-232: OPEN/CLOSE of device 2
  returns pseudo-error $F0 with the new top in X/Y ($F47D), and BASIC's
  error handler ($E0F9) stores it to $37/$38 and jumps into CLR at
  $A663 — which is why OPEN 2,2 performs an automatic CLR and lowers
  BASIC's top by 512 bytes.

- **TXTPTR mid-statement.** Modifying $7A/$7B (TXTPTR) while a BASIC
  statement is executing makes BASIC read its next token from your
  chosen address. Useful for "GOSUB to dynamic line number" but easy
  to crash if you point at non-BASIC data.

- **$0801 BASIC stub for ML programs.** The canonical ML autostart
  uses a BASIC stub like `10 SYS 2064` at $0801: `0B 08` (link to the
  next line at $080B) `0A 00` (line 10) `9E` (SYS token) `32 30 36 34`
  ("2064" as PETSCII digits) `00` (end of line) `00 00` (end of
  program) — 12 bytes, $0801-$080C — with the ML at $0810 (= 2064).
  This is byte-for-byte what KickAssembler 5.25's `BasicUpstart2` emits
  for code at `*=$0810`; the assembler zero-fills $080D-$080F. If you
  type the line at the keyboard instead, the tokenizer keeps the space
  after SYS: `0C 08 0A 00 9E 20 32 30 36 34 00 00 00`, 13 bytes to
  $080D with the link at $080C (measured in VICE x64sc 3.10). An earlier
  version of this bullet mixed the two forms — the $20 space with the
  12-byte link $080B — and put the ML at $080D, which SYS 2064 does not
  reach ($080D is 2061). Skipping the stub and loading raw code at
  $0801 means the user must type `SYS 2049` (2049 = $0801).

- **CIA timers count φ2 cycles.** In the default input mode (CRA bit 5
  = 0, CRB bits 5-6 = 00) a timer *decrements* once per CPU cycle —
  985,248/s PAL, 1,022,727/s NTSC — and underflows every latch+1 cycles
  (measured in VICE x64sc: latch 9 gives 400 underflows in 4006
  cycles). There is no prescaler; the rate is set by the latch, and
  Timer B can instead be clocked by Timer A underflows (CRB INMODE 10,
  also measured), or either timer by CNT-pin edges (datasheet; not
  measurable in VICE). Code copied from a platform whose timers tick at
  a divided clock will time wrong. (An earlier version of this bullet
  said the timer "underflows once per CPU cycle" under a "DC clock" and
  that the divisor was fixed; it decrements once per cycle, and Timer
  B's input is selectable.)

<!-- doc-type: hardware-reference -->
