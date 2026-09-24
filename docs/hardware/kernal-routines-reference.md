# KERNAL Routines Reference

## Overview

The Commodore 64 KERNAL is the 8 KiB ROM at `$E000-$FFFF` that provides the
machine's operating-system layer: character I/O, file I/O over the IEC serial
bus, the screen editor, the 60 Hz IRQ jiffy clock, the STOP-key check, and
the cold-start / warm-start sequences. User programs do not call KERNAL code at
its real ROM addresses, which moved between Commodore machines (VIC-20, PET,
C64, C128, Plus/4). They call the KERNAL's **jump table** in the last
128 bytes of the address space, from `$FF81` upward, where each entry is a
3-byte `JMP abs` instruction to the real routine. Commodore promised this
table would be source-compatible across machines; in practice the shared
part is narrower than the whole table. The block from `$FFC0` (OPEN) to
`$FFEA` (UDTIM) sits at the same positions on every machine from the PET
onward; BASIC 4 PETs also carry `$FF93-$FFBD`; the VIC-20's table starts at
`$FF8A` (RESTOR) and holds 36 of the 39 entries slot-for-slot with the C64's,
with `$FF7F-$FF84` occupied by its IRQ/BRK `JMP ($0316)`/`JMP ($0314)` tails;
SCREEN/PLOT/IOBASE at `$FFED-$FFF3` first appear on the VIC-20 and
CINT/IOINIT/RAMTAS at `$FF81-$FF87` first on the C64. The Plus/4 and C128
keep all 39 entries at the C64 positions. (An earlier version of this page
said every Commodore 8-bit shared the table from `$FF81`; the PET and VIC-20
ROMs do not. Read from the VICE ROM images: PET 901439-04-07 / 901465-03 /
901465-22, VIC-20 901486-07, C64 901227-03, Plus/4 318004-05, C128
318020-05.)

There are **39 jump-table entries** spanning `$FF81-$FFF3`. The portion from
`$FFC0-$FFF5` is the "user jump table" that the
*Commodore 64 Programmer's Reference Guide* and the *KERNAL Reference Manual*
tell application programmers to call directly. The entries from
`$FF81-$FFBD` are lower-level. The higher-level routines use most of them
internally; application code also needs SETLFS, SETNAM, READST, MEMTOP and
MEMBOT.

Every routine here is listed at its **jump-table address**,
not its real ROM address. Calling code should always `JSR $FFD2` (CHROUT),
never `JSR $F1CA` (CHROUT's own body, reached through the `$0326` vector) or
`JSR $E716` (the screen-output routine CHROUT dispatches to when the output
device is 3; device 4 and up goes to IECOUT at `$EDDD`). An earlier version
of this page named `$E716` as CHROUT's ROM address; it is the screen editor's
print routine; `$0326` defaults to `$F1CA` in every 901227 ROM (read from
the ROM images). The jump-table addresses are the stable contract; the
ROM-internal addresses are implementation detail and can move
between KERNAL revisions and do move between Commodore machines. (The three
C64 revisions 901227-01, -02 and -03 differ in 277 bytes of in-place patches
spread over several dozen byte ranges (e.g. `$E4AC-$E4FF`, `$F428-$F44C`,
`$FF5B-$FF80`), and no entry address moved; `$F1CA`, `$E716` and `$F49E` are
at the same addresses in all three, so the examples here illustrate the
contract, not a case where bypassing it breaks. Other Commodore machines put every
routine elsewhere.)

The 39 routines fall into eight categories:

1. **Initialization** — CINT, IOINIT, RAMTAS, RESTOR, VECTOR. These run at
   power-on and reset; an application normally calls them only to recover
   after corrupting state.
2. **High-level file I/O** — SETLFS, SETNAM, OPEN, CLOSE, CHKIN, CHKOUT,
   CLRCHN, CLALL, LOAD, SAVE. The supported way to talk to disk, tape and
   printer.
3. **Character I/O** — CHRIN, CHROUT, GETIN. The screen editor and keyboard
   queue funnel through these.
4. **Low-level IEC bus** — LISTEN, TALK, SECOND, TKSA, IECIN, IECOUT, UNLSN,
   UNTLK, READST. Direct serial-bus protocol for fast loaders and custom
   bus code.
5. **Screen + cursor** — PLOT, SCREEN.
6. **Time + STOP key** — RDTIM, SETTIM, UDTIM, STOP.
7. **Memory** — MEMTOP, MEMBOT (BASIC top-of-memory and bottom-of-memory
   pointers).
8. **Misc** — SETMSG (KERNAL message control), SETTMO (IEEE timeout — no-op
   on C64), SCNKEY (keyboard scan), IOBASE (I/O base address for
   self-relocating code).

The KERNAL also exposes a set of **RAM vectors** at `$0314-$0333`
(IRQ, BRK, NMI, OPEN, CLOSE, CHKIN, CHKOUT, CLRCHN, CHRIN, CHROUT, STOP,
GETIN, CLALL, USRCMD, LOAD, SAVE) that the jump-table routines indirect
through. Patching these vectors is how programs hook character I/O (e.g.
to capture screen output for printer redirection) or replace the IRQ
handler (e.g. to drive a player routine). The VECTOR jump-table entry
(`$FF8D`) reads or writes all of them in one call. See [Vectors](#vectors)
below.

### KERNAL ROM revisions

Three production KERNAL ROMs shipped in the C64's lifetime, identified
by the Commodore part number printed on the ROM chip:

- **901227-01** — the original KERNAL. No PAL/NTSC detection: CINT's
  entry is `JMP $E518` and IOINIT hard-codes the jiffy timer at `$411B`;
  the screen clear fills colour RAM with white (`LDA #$01` at `$EA0B`);
  after the tape FOUND message it waits for any key (`$F761`).
  `$FF5B-$FF80` is unused filler.
- **901227-02** — adds PAL/NTSC detection: CINT's entry becomes a
  wrapper at `$FF5B` that runs the old `$E518`, watches for raster line
  311 (the VIC init table now sets `$D011`/`$D012` to `$9B`/`$37`),
  stores the result in `$02A6` and lets IOINIT pick a jiffy timer of
  `$4025` (PAL) or `$4295` (NTSC); RS-232 gains a PAL baud table at
  `$E4EC` and region-aware OPEN/NMI code; BASIC's CHKOUT wrapper
  (`$E118`) preserves A via a patch at `$E4AD`; the screen clear fills
  colour RAM with the background colour (`$E4DA` = `LDA $D021`); the wait
  after the tape FOUND message becomes a timed wait on the jiffy clock
  that a keypress also ends (`$E4E0`). This is the only cassette change;
  no tape timing constant differs (`$F767-$FCFB` identical).
- **901227-03** — the most common ROM, shipped in most C64
  units sold from mid-1983 onward. All addresses in this page come from it,
  as do most other documents' by default.
  The screen clear fills colour RAM with the current text colour
  (`$E4DA` = `LDA $0286`), plus small screen-editor (`$E57C-$E599`,
  `$E621`) and RS-232 (`$EF94` -> `$E4D3`) patches.

Identify the revision from the byte at `$FF80`: `PEEK(65408)` returns
170 (-01), 0 (-02) or 3 (-03).

All three expose **the same 39-entry jump table at the same
addresses**, and the differences between them are in-place patches:
-01 and -03 differ in 277 bytes (-01/-02 227, -02/-03 57; `cmp` on the
VICE ROM images). No routine's entry address moved — 38 of 39
jump-table targets and all sixteen default RAM vectors are identical,
and the one changed entry (CINT) points at a wrapper that still calls
`$E518`. The IEC bus routines, RAMTAS, LOAD, CHROUT's body (`$F1CA`)
and the screen-output routine (`$E716`) are byte-identical in all
three, so `JSR $F1CA`, `JSR $E716` or `JSR $F49E` would work on
every 901227 revision. Use the jump table anyway: it is the contract
Commodore kept across machines (the VIC-20, C128 and Plus/4 internals
are elsewhere), and it survives the RAM-vector hooks that direct calls
bypass. An earlier version of this section said -01 had a slower IEC
protocol, that -02 fixed a RAM-test bug, that internal addresses moved
between revisions and that `JSR $E716` was "silently broken" on another
revision; none of that is in the ROM bytes.

The C128 in C64 mode maps a plain C64 KERNAL image, not the C128
KERNAL. An earlier revision of this page named 318020-05 here; that
part is the C128-mode KERNAL/editor ROM, a different program (its jump
table points into `$C000`/`$E1xx` and its reset vector is `$FF3D`).
VICE x128 loads `kernal64-901227-03.bin` for C64 mode, byte-identical
to the C64's 901227-03 (measured by dumping the `c64rom` bank from
x128 3.10 in `-go64` mode). VICE also ships two variants for that slot,
`kernal64-325179-01` and `-325182-01`, differing from 901227-03 in 54
and 24 bytes (table bytes and one small patch; none in the
`$FF81-$FFF4` jump table). The part number on a real C128's C64-ROM
chip (usually given as 251913-01, a combined BASIC+KERNAL mask) is from
documentation, not measured here. Either way the 39-entry jump table is
at the same addresses with identical semantics, so programs that use only
the jump table run unchanged on a C128 in C64 mode.

### Zero page each routine writes

Each routine below carries `**Clobbers zero page:**` lines, for any
program that keeps its own variables in zero page and still calls the
KERNAL.

- `(may; ROM walk from $FFxx, power-on vectors)` is an upper bound:
  every byte `$00-$FF` that code reachable from the jump-table slot can
  store to (STA, STX, STY, INC, DEC and the shifts; an indexed store
  counts the index range read off the ROM at that site). Error paths
  count. So does a tape IRQ handler the routine installs at `$0314`
  while it runs (the four in the table at `$FD9B`).
  Vectors are followed through their power-on values: RESTOR's table at
  `$FD30`, and `$028F` → `$EB48`, which CINT sets. A program that repoints
  a vector, such as `$0326` for CHROUT, changes what the routine runs, and
  the line no longer applies. "Also stores through (`$AC`)" means the
  routine writes where that pointer points, not to `$AC` itself.
  `scripts/kernal-zp-walk.ts` writes these lines from the 901227-03 image,
  and `npm test` fails if the page and the walk disagree.
- `(must; VICE x64sc store trace, <call>)` is what that one call wrote,
  measured by `scripts/kernal-zp-trace.ts` with every interrupt source
  masked. It is a lower bound for that call only. Every traced byte lies
  inside the may set; the walk's check enforces it.

The largest routines (OPEN, CLOSE, CHKIN, CHKOUT, CHRIN, CHROUT, GETIN,
LOAD, SAVE) may write `$D9-$F2`, the screen editor's line-link table. The
traced CHROUT, printing enough lines to scroll the screen, wrote all of
`$D9-$F4` and `$AC-$AF`. A loader or a routine that keeps state in
`$E0-$EF` and also prints through CHROUT loses it.

The IRQ and NMI services are not jump-table routines. With interrupts
enabled they run between any two instructions of a program, so their
writes apply everywhere. The NMI walk reaches the RUN/STOP-RESTORE warm
start, which leaves through `JMP ($A002)` into BASIC (or `JMP ($8002)`
into a cartridge) and does not return.

<!-- kernal-zp-walk: services (generated by scripts/kernal-zp-walk.ts --write) -->
| Entry | May write |
|---|---|
| IRQ `$FF48`, through `$0314` to `$EA31` | $01, $91, $A0-$A2, $C0, $C5-$C6, $CB, $CD-$CF, $F3-$F6 (may; ROM walk from $FF48, power-on vectors; also stores through ($D1), ($F3)) |
| NMI `$FE43`, through `$0318` to `$FE47` | $00-$01, $90-$91, $94-$95, $99-$9A, $A3, $A5, $A7-$AB, $B4-$B6, $BD, $C3-$C4, $C6, $CC-$CD, $CF, $D1-$D3, $D5-$D6, $D9-$F4 (may; ROM walk from $FE43, power-on vectors; not followed: JMP ($8002), JMP ($A002); also stores through ($C3), ($D1), ($F3), ($F7)) |

No jump-table routine but RAMTAS, and neither service, may write $02-$8F, $B2-$B3, $FB-$FF.
<!-- /kernal-zp-walk -->

The walk covers the KERNAL, not BASIC, which uses much of `$02-$8F`.

### Sources

- *Commodore 64 Programmer's Reference Guide* (1982), Appendix B — KERNAL ROM machine language subroutines
- *Commodore 64 KERNAL Reference Manual* (1983)
- C64-Wiki: KERNAL Jump Table — https://www.c64-wiki.com/wiki/KERNAL_Jump_Table
- sta.c64.org: CBM 64 KERNAL routines — https://sta.c64.org/cbm64krnfunc.html
- pagetable.com: annotated C64 KERNAL disassembly — https://www.pagetable.com/c64ref/c64disasm/
- Mapping the Commodore 64 (Sheldon Leemon), KERNAL section — https://www.zimmers.net/anonftp/pub/cbm/c64/manuals/mapping-c64.txt

## Quick reference

The full 39-entry jump table, in address order. Each entry is a 3-byte
`JMP abs` instruction.

| Addr    | Name    | One-line summary                                                   |
|---------|---------|--------------------------------------------------------------------|
| `$FF81` | CINT    | Initialize screen editor + VIC-II (cold-screen setup)              |
| `$FF84` | IOINIT  | Initialize CIA1/CIA2/SID; set up jiffy IRQ                         |
| `$FF87` | RAMTAS  | RAM test, set top/bottom of memory, clear `$0002-$00FF` and `$0200-$03FF` (not the stack page) |
| `$FF8A` | RESTOR  | Restore RAM vectors at `$0314-$0333` to KERNAL defaults            |
| `$FF8D` | VECTOR  | Read or write all RAM vectors as a block                           |
| `$FF90` | SETMSG  | Control KERNAL error / control-message verbosity                   |
| `$FF93` | SECOND  | Send secondary address after LISTEN                                |
| `$FF96` | TKSA    | Send secondary address after TALK                                  |
| `$FF99` | MEMTOP  | Read or set top of RAM (used by BASIC + KERNAL buffers)            |
| `$FF9C` | MEMBOT  | Read or set bottom of RAM (start of BASIC text area)               |
| `$FF9F` | SCNKEY  | Scan the keyboard matrix, push key into queue                      |
| `$FFA2` | SETTMO  | Set IEEE-488 timeout flag (no effect on C64)                       |
| `$FFA5` | IECIN   | Receive one byte from serial bus (alias ACPTR)                     |
| `$FFA8` | IECOUT  | Send one byte to serial bus (alias CIOUT)                          |
| `$FFAB` | UNTLK   | Send UNTALK on serial bus                                          |
| `$FFAE` | UNLSN   | Send UNLISTEN on serial bus                                        |
| `$FFB1` | LISTEN  | Send LISTEN command to a device on the serial bus                  |
| `$FFB4` | TALK    | Send TALK command to a device on the serial bus                    |
| `$FFB7` | READST  | Read the KERNAL serial-bus status byte                             |
| `$FFBA` | SETLFS  | Set logical file number, device, and secondary address             |
| `$FFBD` | SETNAM  | Set filename length and pointer                                    |
| `$FFC0` | OPEN    | Open a logical file (uses SETLFS+SETNAM state)                     |
| `$FFC3` | CLOSE   | Close a logical file                                               |
| `$FFC6` | CHKIN   | Redirect input from a previously opened logical file               |
| `$FFC9` | CHKOUT  | Redirect output to a previously opened logical file                |
| `$FFCC` | CLRCHN  | Reset default I/O channels (input=keyboard, output=screen)         |
| `$FFCF` | CHRIN   | Read one character from current input channel                      |
| `$FFD2` | CHROUT  | Write one character to current output channel                      |
| `$FFD5` | LOAD    | Load or verify a file from device into memory                      |
| `$FFD8` | SAVE    | Save memory range to device                                        |
| `$FFDB` | SETTIM  | Set the 24-bit jiffy clock                                         |
| `$FFDE` | RDTIM   | Read the 24-bit jiffy clock                                        |
| `$FFE1` | STOP    | Test RUN/STOP key, return Z=1 if pressed                           |
| `$FFE4` | GETIN   | Get one character from keyboard queue (non-blocking)               |
| `$FFE7` | CLALL   | Close all open files (calls CLRCHN internally)                     |
| `$FFEA` | UDTIM   | Update the jiffy clock; called from IRQ handler at `$EA31`         |
| `$FFED` | SCREEN  | Return screen dimensions (40 columns, 25 rows on stock C64)        |
| `$FFF0` | PLOT    | Read or set cursor row/column                                      |
| `$FFF3` | IOBASE  | Return base address of I/O block (always `$DC00` on C64)           |

Three points the names do not show:

- **`IECIN`/`IECOUT`** are documented in the original Commodore 64
  *Programmer's Reference Guide* under the older PET-era names `ACPTR`
  (accept byte from serial bus) and `CIOUT` (Commodore IEEE/IEC output).
  Most modern documentation uses the IEC-prefixed names.
- **`CHRIN`/`CHROUT`** are also documented as `BASIN`/`BSOUT` in some
  Commodore manuals. Same routine, different name.
- **`SETTMO`** (`$FFA2`) was meaningful on the PET's IEEE-488 bus; on
  the C64's IEC serial bus the timeout flag is hard-wired and the
  routine does nothing visible.

## File I/O routines

High-level file I/O is a stateful protocol:

1. **Configure** the next file operation with SETLFS (logical file, device,
   secondary address) and SETNAM (filename buffer pointer, length).
2. **Open** the file with OPEN, LOAD, or SAVE.
3. **Use** it: redirect input with CHKIN, redirect output with CHKOUT, read
   with CHRIN / GETIN, write with CHROUT. Reset to defaults with CLRCHN.
4. **Close** with CLOSE or CLALL.

BASIC's `OPEN`, `PRINT#`, `INPUT#`, and `CLOSE`
statements drive the same protocol. To open and read
a sequential file from drive 8:

```asm
        ; OPEN 2,8,2,"FILE,S,R"
        lda #2          ; logical file number
        ldx #8          ; device 8 (first disk drive)
        ldy #2          ; secondary address = 2 (channel)
        jsr $FFBA       ; SETLFS
        lda #fname_end-fname
        ldx #<fname
        ldy #>fname
        jsr $FFBD       ; SETNAM
        jsr $FFC0       ; OPEN
        bcs open_error  ; C=1 on failure, A = error code

        ldx #2          ; logical file from above
        jsr $FFC6       ; CHKIN  (redirect input)
read_loop:
        jsr $FFCF       ; CHRIN
        ; ... process A ...
        jsr $FFB7       ; READST
        beq read_loop   ; ST=0 means more bytes available

        jsr $FFCC       ; CLRCHN
        lda #2
        jsr $FFC3       ; CLOSE
        rts

fname:  .byte "FILE,S,R"
fname_end:
```

Listings in this page are generic 6502 assembler syntax (`;`
comments and `.byte "…"` strings, as ca65 accepts them), not
KickAssembler fragments, and `npm run check:listings` does not build
them (it assembles only `asm` fences written in KickAssembler syntax
with no `;` lines). In KickAssembler use `//` comments and `.text "…"`;
Kick's default `.text` encoding is screen codes, which for upper-case
letters, digits and punctuation coincide with the unshifted PETSCII a
drive expects (`FILE,S,R` -> `46 49 4C 45 2C 53 2C 52`; `petscii_mixed`
would give `C6 C9 CC C5 …`). Under ca65 `-t c64` the same literal
assembles to shifted PETSCII `C6 C9 CC C5 …`, so set the filename bytes
explicitly in either assembler (both byte sequences
measured with KickAssembler 5.25 and ca65 2.19).

Three rules of the KERNAL file protocol:

- **SETLFS + SETNAM state survives across calls** until overwritten.
  After SETLFS with secondary=2 and an OPEN, a second OPEN without another SETLFS
  reuses secondary=2.
- **CHKIN/CHKOUT require a prior successful OPEN.** They return C=1 +
  error code 3 ("file not open") if the logical file number doesn't
  refer to an open file.
- **CLRCHN must be called before CLOSE.** After a `CLOSE` while CHKIN
  has redirected input to that file, the next CHRIN reads from a
  closed file and returns garbage. The order is `CLRCHN`, then `CLOSE`.
  (An earlier version of the listing above called CLOSE first.)

### $FFBA — SETLFS — Set logical file parameters

**Input:** A = logical file number (1-255), X = device number (0-31), Y = secondary address (0-31 or `$FF`)
**Output:** None
**Affects:** None (parameters stored in zero-page workspace `$B8`, `$BA`, `$B9`)
**Clobbers zero page:** $B8-$BA (may; ROM walk from $FFBA, power-on vectors)
**Clobbers zero page:** $B8-$BA (must; VICE x64sc store trace, SETLFS 2,8,2)
**Pairs with:** SETNAM, OPEN, LOAD, SAVE
**Description:** Stores the three file parameters that the next OPEN, LOAD,
or SAVE will use. The logical file number (A) is a program-chosen tag in the
range 1-255; it appears in subsequent CHKIN/CHKOUT/CLOSE calls to identify
this file. The KERNAL stores the number in `$B8` and never interprets
it. The familiar rule that file numbers 128-255 get a linefeed after
every carriage return is BASIC's, not the KERNAL's: PRINT#, CMD and any
PRINT while CMD is active send `$0A` after `$0D` when bit 7 of the
current channel byte `$13` is set (BASIC ROM `$AAD7`, `BIT $13`). CHROUT
adds no byte of its own whatever the file number. Measured in VICE
x64sc: `SETLFS` 200 followed by `CHROUT $0D` delivers `$0D` alone, while
BASIC's `PRINT#200` hands CHROUT `$0D,$0A` and `PRINT#100` hands `$0D`.
(An earlier revision placed this rule under SETLFS as if the KERNAL
applied it.)
The device number (X) selects the bus device: 0=keyboard, 1=tape (Datasette),
2=RS-232 (user port), 3=screen, 4-7=printer/plotter, 8-30=IEC disk/printer
units. Secondary address (Y) is device-specific: for the 1541 disk drive,
0=load PRG, 1=save PRG, 2-14=open named channel, 15=command channel. `$FF`
(any value with bit 7 set) means "send no secondary address" on the
serial bus: OPEN, CHKIN, CHKOUT and CLOSE then skip the
secondary-address byte, and OPEN sends nothing at all, not even the
filename, so it suits an unnamed channel such as a printer, not a named
disk file. It is what BASIC's OPEN supplies for device 3 and above when
the third parameter is omitted; for tape and RS-232 BASIC defaults to 0.
Tape reads the secondary address: for OPEN, 0 = read, 1 = write, 2 =
write followed by an end-of-tape marker at CLOSE (measured in VICE
x64sc: SA `$FF` on device 1 takes the write path and prompts PRESS
RECORD & PLAY ON TAPE); for SAVE, bit 0 = absolute-address header, bit 1
= write an end-of-tape marker after the data; for LOAD, see `$FFD5`
below. An earlier revision said `$FF` was "used by tape"; it is not.

### $FFBD — SETNAM — Set filename

**Input:** A = filename length (0-16, longer accepted but truncated by device), X = low byte of filename pointer, Y = high byte of filename pointer
**Output:** None
**Affects:** None (length stored at `$B7`, pointer at `$BB`/`$BC`)
**Clobbers zero page:** $B7, $BB-$BC (may; ROM walk from $FFBD, power-on vectors)
**Clobbers zero page:** $B7, $BB-$BC (must; VICE x64sc store trace, SETNAM with a 4-byte name)
**Pairs with:** SETLFS, OPEN, LOAD, SAVE
**Description:** Records the filename for the next OPEN/LOAD/SAVE. The
filename is *not* copied; only its address is stored, so the buffer must
remain valid until OPEN/LOAD/SAVE returns. A=0 means "no filename" and is
legal for LOAD/SAVE on tape (loads the first PRG it finds) and for OPEN
on the printer or screen. Filenames sent to a disk drive may carry
embedded commas separating filename / file-type / mode, e.g.
`"DATA,S,R"` (sequential, read).

### $FFC0 — OPEN — Open a logical file

**Input:** SETLFS and SETNAM state must be set first
**Output:** C=0 on success; C=1 on error, A = error code
**Affects:** A, X, Y, C
**Clobbers zero page:** $01, $90-$96, $98-$9C, $9E-$B1, $B4-$B6, $B9, $BD-$C2, $C5-$C7, $C9, $CB, $CD-$FA (may; ROM walk from $FFC0, power-on vectors; also stores through ($AC), ($B2), ($D1), ($F3), ($F9))
**Clobbers zero page:** $90, $94-$95, $98, $A3, $A5, $B9 (must; VICE x64sc store trace, OPEN of a PRG file on drive 8 (true drive emulation))
**Pairs with:** SETLFS, SETNAM, CLOSE, CHKIN, CHKOUT
**Description:** Opens a logical file using the parameters previously
stored by SETLFS and SETNAM. For disk devices, sends LISTEN +
secondary-address (`$F0 | sec`) over the IEC bus, then sends the
filename bytes one at a time via IECOUT, then UNLISTEN. On success the
KERNAL records the logical file number in its open-file table
(`$0259-$0262` for LF, `$0263-$026C` for device, `$026D-$0276` for
secondary). Errors: 1=too many open files (10 already open), 2=logical
file number already open, 5=device not present, 6=logical file number 0
(the only 6 OPEN returns; OPEN never returns 7; 6 and 7 as direction
errors belong to CHKIN/CHKOUT), 9=illegal device (tape OPEN with the
tape-buffer pointer `$B2/$B3` below `$0200`). OPEN's own code-4 exit is
on the tape branch only and is reached only through the STOP key during
the header search, and then only when `$93` (the load/verify flag left
by the last LOAD or VERIFY) is non-zero; with `$93` = 0 the same STOP
returns C=1, A=0. A name that is not on the tape does not produce 4: the
search reads on until an end-of-tape marker, which OPEN returns as C=1,
A=5 (BASIC prints ?DEVICE NOT PRESENT). Disk OPEN never reports a
missing file; read the error channel. Errors 1, 2 and 6 are detected
before the table entry is stored; for 4, 5 and 9 the entry has already
been added (`$98` incremented, LFN/device/secondary stored at
`$0259/$0263/$026D,X`) and stays there, so a retry with the same logical
file number returns 2. CLOSE it (or CLALL) first. (An earlier version
of this entry listed 6 and 7 as direction errors, called 4 LOAD-only and
said a failed OPEN left no table entry; all three were checked against
the KERNAL ROM bytes and in VICE x64sc.) OPEN on tape (device 1) also
returns C=1 with A=0 if RUN/STOP is pressed while it waits for
PLAY/RECORD or during the header search or write (`$F399`/`$F3B8` ->
`$F3D4`); the serial OPEN path has no STOP check (ROM bytes).

### $FFC3 — CLOSE — Close a logical file

**Input:** A = logical file number
**Output:** C=0 on success; C=1 on error, A = error code
**Affects:** A, X, Y, C
**Clobbers zero page:** $01, $90-$96, $98-$9C, $9E-$B1, $B4-$B6, $B8-$BA, $BD-$C2, $C5-$C7, $C9, $CB, $CD-$F6, $F8, $FA (may; ROM walk from $FFC3, power-on vectors; also stores through ($AC), ($B2), ($D1), ($F3), ($F9))
**Clobbers zero page:** $95, $98, $A5, $B8-$BA (must; VICE x64sc store trace, CLOSE of that file)
**Pairs with:** OPEN, CLRCHN
**Description:** Closes the named logical file. For IEC devices, sends
LISTEN + close-secondary (`$E0 | sec`), then UNLISTEN. The KERNAL
removes the entry from its open-file table. Calling CLOSE on a
logical file number that isn't open returns silently (no error). If
the file is currently the active input or output channel, CLOSE does
*not* reset the channel; call CLRCHN first.

### $FFC6 — CHKIN — Redirect input to logical file

**Input:** X = logical file number (must already be OPEN)
**Output:** C=0 on success; C=1 on error, A = error code
**Affects:** A, X, C
**Clobbers zero page:** $01, $90-$96, $99-$9C, $9E-$B1, $B4-$B6, $B8-$BA, $BD-$C2, $C5-$C7, $C9, $CB, $CD-$F6 (may; ROM walk from $FFC6, power-on vectors; also stores through ($AC), ($B2), ($D1), ($F3), ($F9))
**Clobbers zero page:** $90, $95, $99, $A5, $B8-$BA (must; VICE x64sc store trace, CHKIN on that file)
**Pairs with:** OPEN, CHRIN, GETIN, CLRCHN
**Description:** Tells the KERNAL that subsequent CHRIN / GETIN calls
should read from the named logical file rather than the keyboard. For
IEC devices, sends TALK + secondary (`$60 | sec`). Errors: 3=file not
open; 6=not input file, raised only for a tape file whose secondary
address is not 0 (opened for write; `$F22A-$F230` compares the stored SA
with `$60`). CHKIN does not check direction on a serial device: on a
disk channel opened `,S,R` it returns C=0 (measured in VICE x64sc).
There is a device-not-present exit (5) at `$F24D` but it is not
reachable for a missing serial device: TKSA falls through into the bus
turnaround at `$EDCC`, whose wait for the talker's clock at `$EDD6` has
no timeout, so CHKIN on a serial device that does not answer hangs the
machine rather than returning (measured in VICE x64sc: an
open-file-table entry for device 9 hung CHKIN both on an empty bus and
with a 1541 on device 8). An earlier version of this entry said 6 meant
the device was opened for write; that is the tape rule only.

### $FFC9 — CHKOUT — Redirect output to logical file

**Input:** X = logical file number (must already be OPEN)
**Output:** C=0 on success; C=1 on error, A = error code
**Affects:** A, X, C
**Clobbers zero page:** $01, $90-$96, $99-$9C, $9E-$B1, $B4-$B6, $B8-$BA, $BD-$C2, $C5-$C7, $C9, $CB, $CD-$F6 (may; ROM walk from $FFC9, power-on vectors; also stores through ($AC), ($B2), ($D1), ($F3), ($F9))
**Pairs with:** OPEN, CHROUT, CLRCHN
**Description:** Tells the KERNAL that subsequent CHROUT calls should
write to the named logical file rather than the screen. For IEC
devices, sends LISTEN + secondary (`$60 | sec`). Errors: 3=file not
open; 5=device not present (no serial device pulled DATA low in answer
to ATN during LISTEN/SECOND, `$ED40-$ED47`, ST bit 7; measured C=1, A=5
in VICE x64sc both on an empty bus and with another drive present);
7=not output file, raised for the keyboard (device 0) and for a tape
file opened with secondary address 0 (read). Disk channels are not
direction-checked: CHKOUT on a channel opened `,S,R` returns C=0 (A=8),
bytes sent with CHROUT afterwards are accepted, and with the 1541-II DOS
in VICE the drive's error channel still read 00 afterwards, so nothing
reports the mistake. An earlier version said 7 meant the device was
opened for read; that is the tape rule only.

### $FFCC — CLRCHN — Reset default I/O channels

**Input:** None
**Output:** None
**Affects:** A, X
**Clobbers zero page:** $90, $94-$95, $99-$9A, $A3, $A5 (may; ROM walk from $FFCC, power-on vectors)
**Clobbers zero page:** $95, $99-$9A, $A5 (must; VICE x64sc store trace, CLRCHN with that file as input)
**Pairs with:** CHKIN, CHKOUT, CLOSE
**Description:** Resets the current input channel to the keyboard
(device 0) and the current output channel to the screen (device 3).
If a CHKOUT had redirected output to an IEC device, CLRCHN sends
UNLISTEN; if a CHKIN had redirected input to an IEC device, CLRCHN
sends UNTALK. It does *not* close any logical file; the files remain
open and can be re-selected with another CHKIN/CHKOUT. Always call
CLRCHN between operations on different files.

### $FFE7 — CLALL — Close all logical files

**Input:** None
**Output:** None
**Affects:** A, X
**Clobbers zero page:** $90, $94-$95, $98-$9A, $A3, $A5 (may; ROM walk from $FFE7, power-on vectors)
**Pairs with:** CLRCHN
**Description:** Closes all open logical files at once by zeroing the
KERNAL's open-file count (`$0098`). It does *not* send CLOSE
commands to IEC devices; it discards the KERNAL's open-file
table. CLALL also calls CLRCHN, so default channels are reset.
CLALL resets I/O state from an unknown starting
point (e.g. in an error handler). Any disk-side state
(open relative-file channels with dirty buffers) stays open in the
drive: CLALL sends UNLISTEN/UNTALK through CLRCHN but no close command
(ROM `$F32F`). Whether and when the drive closes those channels is not
measured here. (An earlier version said an UNLISTEN closes them.) The jump-table entry for CLALL is
`$FFE7`, not beside CLOSE.

### $FFD5 — LOAD — Load or verify a file

**Input:** A = 0 to load, 1 to verify; X = low byte of start address (used only if SETLFS Y=0); Y = high byte of start address; SETLFS + SETNAM state required
**Output:** C=0 on success, X+Y = end-address+1 (one past the last byte loaded); C=1 on error, A = error code
**Affects:** A, X, Y, C
**Clobbers zero page:** $01, $90-$96, $99-$9C, $9E-$B1, $B4-$B6, $B9, $BD-$C7, $C9, $CB, $CD-$F6 (may; ROM walk from $FFD5, power-on vectors; also stores through ($AC), ($AE), ($B2), ($D1), ($F3), ($F9))
**Clobbers zero page:** $90, $93-$95, $A3-$A5, $AE-$AF, $B9, $C3-$C4 (must; VICE x64sc store trace, LOAD of a 3-block PRG from drive 8 to its own address)
**Pairs with:** SETLFS, SETNAM
**Description:** Loads a file from the device specified by SETLFS into
RAM. If the secondary address from SETLFS is 0, the file is loaded at
the address in X/Y (passed in by the caller). If secondary is 1
(non-zero), the file's first two bytes are used as the load address
(this is how `LOAD "FILE",8,1` works in BASIC). On the C64 the load
goes into RAM even where BASIC or KERNAL ROM is mapped: the serial path
stores each byte with `STA ($AE),Y` through the zero-page pointer
`$AE/$AF` (EAL/EAH, the store at `$F51C`; the tape path stores through
`$AC/$AD` at `$FB41`), and a 6510 write to a ROM-mapped address always
lands in the RAM beneath. An earlier version of this page said the
pointer was in page 1, which is the stack. The rule does *not* extend
to `$D000-$DFFF`: LOAD never touches `$01`, so it runs with I/O mapped
in, and a file whose load address falls there is written into the
VIC/SID/CIA registers or colour RAM while the RAM underneath is left
untouched (measured in VICE x64sc: a `,8,1` load of two bytes to
`$D020` set the border and background registers and left the RAM
beneath at its prefill). I/O cannot be banked out around the call: the
serial routines drive the IEC bus through CIA2 at `$DD00` and the tape
routines time pulses through CIA1. LOAD such data elsewhere and
copy it under I/O with interrupts disabled. Loading straight
into colour RAM at `$D800` is the one case where writing the chips is
what you want. After a successful load, X/Y hold the address
immediately *past* the last byte loaded. With A=1, LOAD compares the
file against memory instead of writing and sets the status byte's "verify
mismatch" bit on differences. Errors: 4=file not found, 5=device not
present, 8=missing filename, 9=illegal device. A C=1 return with A=0 is
none of these: RUN/STOP aborted the transfer. The serial loop calls
STOP before every byte (`$F4F9`); the tape path polls it while waiting
for PLAY and throughout the IRQ-driven block transfer, so pressing STOP
at the PRESS PLAY prompt returns the same way. The KERNAL has already
closed the serial channel or stopped the tape motor. BASIC reports this
return as ?BREAK ERROR; Commodore's own KERNAL error table numbers it
0, "routine terminated by the STOP key" (Programmer's Reference Guide,
not verified here). Test A=0 before indexing an error-message table.
(Measured in VICE x64sc 3.10: LOAD from device 8 with STOP forced true
on its 10th poll returned A=`$00`, C=1 after nine bytes; ROM bytes
`$F4F9`/`$F633`.)

### $FFD8 — SAVE — Save memory to file

**Input:** A = zero-page pointer to start address (e.g. A=`$2B` means start = ($2B/$2C) ); X = low byte of end-address+1; Y = high byte of end-address+1; SETLFS + SETNAM state required
**Output:** C=0 on success; C=1 on error, A = error code
**Affects:** A, X, Y, C
**Clobbers zero page:** $01, $90-$96, $99-$9C, $9E-$B1, $B4-$B6, $B9, $BD-$C2, $C5-$C7, $C9, $CB, $CD-$F6 (may; ROM walk from $FFD8, power-on vectors; also stores through ($AC), ($B2), ($D1), ($F3), ($F9))
**Pairs with:** SETLFS, SETNAM
**Description:** Saves the memory range [start, end+1) to the device.
The start address is read indirectly through the zero-page byte
pointed to by A (the BASIC start-of-program pointer at `$2B/$2C`
is the conventional value, which is why BASIC `SAVE` saves the
current program). The end-address+1 is passed directly in X/Y.
On the serial bus the first two bytes sent are the start address (low,
high), then the data, the format LOAD expects. On tape the addresses
are not in the data stream at all: the KERNAL writes a separate
192-byte header block first (`$F76A`: type byte (1 relocatable, 3
non-relocatable when the secondary address has bit 0 set), then start
address, end-address+1, and the filename, space-padded), and the data
block that follows is the raw memory bytes with no address prefix. An
earlier version of this page said both tape and serial began with the
load address; only serial does (KERNAL 901227-03, `$F617-$F621` vs
`$F76A`/`$F867`). Errors: 5=device not present, 8=missing filename,
9=illegal device. As with LOAD, C=1 with A=0 means RUN/STOP aborted the
transfer, not an I/O error. STOP is polled before every byte on the serial bus (`$F62E`), and
while waiting for RECORD/PLAY and during the block write on tape.
BASIC reports it as ?BREAK ERROR (ROM bytes
`$F62E`/`$F633`, `$F8D0`).

## Character I/O

The C64's character-I/O layer has three entry points: CHROUT for writing,
CHRIN for blocking reads, and GETIN for non-blocking reads. All three
indirect through RAM vectors at `$0326` (BSOUT), `$0324` (CHRIN), and
`$032A` (GETIN); patching those vectors hooks every character that
flows through the KERNAL.

### $FFD2 — CHROUT — Output a character

**Input:** A = PETSCII byte to print
**Output:** None
**Affects:** A (preserved on success), C
**Clobbers zero page:** $01, $90-$96, $99-$9C, $9E-$B1, $B4-$B6, $BD-$C2, $C5-$C7, $C9, $CB, $CD-$F6 (may; ROM walk from $FFD2, power-on vectors; also stores through ($AC), ($B2), ($D1), ($F3), ($F9))
**Clobbers zero page:** $AC-$AF, $C7, $C9, $CD, $D0-$F4 (must; VICE x64sc store trace, CHROUT printing 33 lines, 30 of them 50 characters, so the screen scrolls)
**Pairs with:** CHKOUT, CLRCHN
**Description:** Writes one byte to the current output channel (screen
by default; a logical file if CHKOUT was called). The byte is
interpreted as PETSCII: printable codes (`$20-$5F`, `$60-$7F`,
`$A0-$FF`) display the corresponding character; control codes do
their named action: `$0D` = carriage return, `$11` = cursor down,
`$13` = home, `$14` = delete, `$93` = clear screen, `$05/$1C/$1E/$1F/$81/$90/$95/$9F` etc.
= color changes, `$0E` = lower/upper case, `$8E` = upper/graphics
case. When writing to the screen, CHROUT *does* modify VIC-II state:
PETSCII `$0E` and `$8E` write to `$D018` to switch the character
ROM source between charset 1 and charset 2; color changes write to
the current-color byte at `$0286` (page 2, not zero page. Earlier
text called it zero-page; the KERNAL stores it with an absolute
`STX $0286` at `$E8D6`, measured in VICE x64sc: CHROUT `$1C` leaves
`$0286` = 2). To suppress these side
effects, write directly to screen RAM (`$0400`) and color RAM
(`$D800`) instead. A and the carry flag are conventionally preserved
on success.

### $FFCF — CHRIN — Read a character (blocking)

**Input:** None (current input channel must be set; default is keyboard)
**Output:** A = PETSCII byte read; C=0 on success, C=1 on error
**Affects:** A, X, Y, C
**Clobbers zero page:** $01, $90-$97, $99-$9C, $9E-$B1, $B4-$B6, $BD-$C2, $C5-$F6 (may; ROM walk from $FFCF, power-on vectors; also stores through ($AC), ($B2), ($D1), ($F3), ($F9))
**Clobbers zero page:** $A4-$A5 (must; VICE x64sc store trace, 20 CHRIN calls reading that file)
**Clobbers zero page:** $C6, $C8-$CA, $CC-$CD, $D0, $D3-$D4, $D7, $F3-$F4 (must; VICE x64sc store trace, CHRIN from the keyboard reading a 2-character line)
**Pairs with:** CHKIN, CLRCHN, READST
**Description:** Reads one PETSCII byte from the current input
channel. With the default keyboard channel, CHRIN runs the screen
editor: it blinks the cursor, waits for the user to type a line and
press RETURN, then returns characters one at a time until the
RETURN (`$0D`) is delivered. This is the BASIC `INPUT` mechanism.
With an IEC device active (after CHKIN), CHRIN reads one byte from
the bus via IECIN, sets the status byte on EOI or error, and returns.
With tape, CHRIN reads one byte from the tape buffer. Use READST
after each CHRIN to check end-of-file: status byte `$40` indicates
EOI (last byte of file just delivered).

### $FFE4 — GETIN — Get a character (non-blocking)

A line-entry loop on top of GETIN (echo, DEL, RETURN, length cap, blinking
cursor) is `text_input_line` in `../techniques/text.md`.

**Input:** None
**Output:** A = PETSCII byte (0 if no byte available); C=0 on success
**Affects:** A, X, Y, C
**Clobbers zero page:** $01, $90-$97, $99-$9C, $9E-$B1, $B4-$B6, $BD-$C2, $C5-$C9, $CB-$F6 (may; ROM walk from $FFE4, power-on vectors; also stores through ($AC), ($B2), ($D1), ($F3), ($F9))
**Clobbers zero page:** $C6 (must; VICE x64sc store trace, 5 GETIN calls on a 4-key buffer)
**Pairs with:** CHKIN, SCNKEY, STOP
**Description:** Returns immediately. With the default keyboard
channel, GETIN reads one byte from the keyboard queue (`$0277-$0280`)
maintained by the IRQ handler; if the queue is empty, A=0. With an
IEC device active (after CHKIN), GETIN behaves like CHRIN and
*does* block on the bus, because the IEC protocol has no peek-ahead.
The non-blocking property only applies to the keyboard. GETIN is
the standard primitive for game loops and any code that must remain
responsive while polling input.

## Screen and cursor

### $FFED — SCREEN — Read screen dimensions

**Input:** None
**Output:** X = number of columns, Y = number of rows
**Affects:** X, Y
**Clobbers zero page:** none (may; ROM walk from $FFED, power-on vectors)
**Pairs with:** PLOT
**Description:** Returns the physical dimensions of the screen. On a
stock C64 this is always X=40, Y=25. The routine exists so that
programs targeting the whole Commodore-8-bit family (which includes
80-column machines like the C128) can adapt to the screen they
run on without hard-coding 40x25.

### $FFF0 — PLOT — Get or set cursor position

**Input:** C=0 to set: X = row (0-24), Y = column (0-39); C=1 to read: input ignored
**Output:** With C=1 on entry: X = row, Y = column
**Affects:** A, X, Y
**Clobbers zero page:** $D1-$D3, $D5-$D6, $F3-$F4 (may; ROM walk from $FFF0, power-on vectors)
**Clobbers zero page:** $D1-$D3, $D5-$D6, $F3-$F4 (must; VICE x64sc store trace, PLOT set, then read)
**Pairs with:** CHROUT, SCREEN
**Description:** Reads or writes the cursor position used by the
screen editor. With C=1 (read mode), returns the current row in X
and current column in Y. With C=0 (write mode), moves the cursor
to the supplied row/column. PLOT draws nothing; it
positions the cursor so the next CHROUT writes there. X holds the
*row* (0-24) and Y holds the *column* (0-39), the reverse of (x,y)
plotting convention.

### $FF81 — CINT — Initialize screen editor

**Input:** None
**Output:** None
**Affects:** A, X, Y
**Clobbers zero page:** $99-$9A, $CC-$CD, $CF, $D1-$D3, $D5-$D6, $D9-$F4 (may; ROM walk from $FF81, power-on vectors; also stores through ($D1), ($F3))
**Pairs with:** IOINIT, RAMTAS
**Description:** Performs the screen-editor portion of the cold-start
sequence: programs the VIC-II registers for 25-row x 40-column text
mode, sets screen RAM to `$0400-$07E7` and color RAM to `$D800-$DBE7`,
fills screen with `$20` (space) and color RAM with the current
foreground color, sets the cursor to row 0 column 0, sets the
keyboard-decode vector `$028F/$0290` to `$EB48`, the keyboard-buffer
size `$0289` = 10, the key-repeat delay `$028C` = 10 and speed `$028B`
= 4, and the default character colour `$0286` = 14 (light blue), and
initializes the IRQ-driven keyboard queue. (An earlier version of this
page said CINT also set the keyboard-table pointer `$F5/$F6`; it does
not. Read from the 901227-03 ROM and confirmed in VICE: `$E518-$E598`
never stores to `$F5/$F6`. That pointer is written by SCNKEY only on a
scan that finds a key held: first to `$EB81` at `$EA9D/$EAA1`, then
re-selected by shift state through the `$028F` vector at `$EB48`; an
idle scan leaves it alone.) CINT is
called once at power-on after RAMTAS and IOINIT. Applications can
re-invoke it to recover from screen corruption (e.g. after a wild
write to `$D000` zeroed half the VIC registers), but doing so
overwrites screen and color RAM.

## Stop key

### $FFE1 — STOP — Test the RUN/STOP key

**Input:** None
**Output:** Z=1 if `$91` = `$7F` (the last UDTIM sample of the STOP-key column showed RUN/STOP down with no shift key), Z=0 otherwise. A is always overwritten: when STOP is not detected A = `$91`, the raw column-7 row byte (`$FF` with nothing in that column held; the *Programmer's Reference Guide* documents using it to test the other keys in that column); when STOP is detected A = 0, because CLRCHN's final `LDA #0` is what is left in A. An earlier version of this page said A = `$7F` when pressed and unchanged otherwise, and that STOP latched "since the last call" — measured in VICE x64sc against the ROM bytes, none of that holds: `$FFE1` -> `$F6ED` = `LDA $91 / CMP #$7F / BNE / PHP / JSR CLRCHN / STA $C6 / PLP / RTS`, and the only writer of `$91` in the ROMs is UDTIM at `$F6DA`, so nothing is consumed by reading it.
**Affects:** A, N, Z, C (the flags are those of `CMP #$7F` against `$91`). When STOP is detected it also calls CLRCHN (`$FFCC`): input device `$99` is reset to 0 and output device `$9A` to 3, with UNTALK/UNLISTEN sent first only if the current device number was above 3, and the keyboard queue is emptied (`$C6` = 0).
**Clobbers zero page:** $90, $94-$95, $99-$9A, $A3, $A5, $C6 (may; ROM walk from $FFE1, power-on vectors)
**Clobbers zero page:** none (must; VICE x64sc store trace, STOP with no key down)
**Pairs with:** GETIN, UDTIM
**Description:** Reads the STOP-key flag (zero page `$91`, set by UDTIM
(`$FFEA`), not SCNKEY, to `$7F` when STOP is held in its matrix column)
and returns Z=1 if STOP is currently pressed. An
interruptible loop:

```asm
loop:   jsr $FFE1       ; STOP
        beq abort       ; Z=1 means STOP pressed
        ; ... work ...
        jmp loop
abort:  ; restore state, exit
        rts
```

STOP reads `$91`, not the keyboard matrix directly, so it depends on
the IRQ handler running. With IRQs disabled (`SEI` without
re-enabling), STOP never returns Z=1. To make STOP work in an
IRQ-disabled context, `JSR $FFEA` (UDTIM) inside the loop (this also
advances the jiffy clock, so if `TI$` matters call it once per
1/60 s; once per frame runs the clock 17% slow on PAL, where a frame
is 1/50 s. An earlier version said "at most once per frame"). An earlier version of this page said to call SCNKEY (`$FF9F`)
here; SCNKEY never writes `$91` (the only store to `$91` in the KERNAL
is UDTIM's at `$F6DA`), so that advice could not have worked. UDTIM
reads the STOP column through `$DC01` without selecting it, relying on
`$DC00` still holding `$7F` as SCNKEY and the KERNAL IRQ leave it. Some
KERNAL routines also call STOP: inside disk I/O it aborts the
operation, and in the cassette routines it aborts the tape transfer.

## Time and jiffy clock

The C64 keeps a 24-bit "jiffy clock", a counter of `1/60`-second
ticks on PAL and NTSC alike, that wraps every 24 hours. The CIA1 timer A
latch is chosen by region so the rate stays near 60 Hz: `$4025`
(16,421) on PAL, `$4295` (17,045) on NTSC (ROM `$FDDD-$FDF8`, the end of
IOINIT, which CINT jumps back into after setting `$02A6`); the
timer period is latch + 1, so 985,248 / 16,422 = 59.99 Hz PAL and
1,022,727 / 17,046 = 60.00 Hz NTSC. Measured in VICE x64sc: over 3,000
frames the counter advanced 3,590 jiffies on PAL (1.197 per frame) and
3,009 on NTSC. The jiffy is not tied to the video frame. (An earlier
version said the clock ticks at 1/50 s in PAL territory.) The counter lives at `$A0/$A1/$A2` (high/mid/low byte) and
is incremented by UDTIM, which is called from the IRQ handler every
jiffy. BASIC exposes the counter via the `TI` (numeric) and `TI$`
(string `HHMMSS`) reserved variables.

### $FFDB — SETTIM — Set the jiffy clock

**Input:** A = jiffy-clock high byte (will go to `$A0`), X = mid byte (`$A1`), Y = low byte (`$A2`)
**Output:** None
**Affects:** None (writes `$A0`, `$A1`, `$A2`)
**Clobbers zero page:** $A0-$A2 (may; ROM walk from $FFDB, power-on vectors)
**Clobbers zero page:** $A0-$A2 (must; VICE x64sc store trace, SETTIM)
**Pairs with:** RDTIM, UDTIM
**Description:** Stores the supplied 24-bit value into the jiffy-clock
counter. The order is high byte first, the reverse of the
6502's little-endian convention. BASIC's
`TI$ = "000000"` uses this routine. SETTIM disables IRQs while writing
the three bytes, so the IRQ handler can't see a half-updated value.

### $FFDE — RDTIM — Read the jiffy clock

**Input:** None
**Output:** A = high byte, X = mid byte, Y = low byte
**Affects:** A, X, Y
**Clobbers zero page:** $A0-$A2 (may; ROM walk from $FFDE, power-on vectors)
**Clobbers zero page:** $A0-$A2 (must; VICE x64sc store trace, RDTIM)
**Pairs with:** SETTIM, UDTIM
**Description:** Reads the three-byte jiffy counter and returns it in
A/X/Y (high/mid/low). Disables IRQs during the read so the value is
atomic. For elapsed time, call RDTIM
twice and subtract; one jiffy = 1/60 s on both PAL and NTSC (see
"Time and jiffy clock" above; an earlier version said 1/50 s PAL).

### $FFEA — UDTIM — Increment jiffy clock + check STOP

**Input:** None
**Output:** None
**Affects:** A, X
**Clobbers zero page:** $91, $A0-$A2 (may; ROM walk from $FFEA, power-on vectors)
**Clobbers zero page:** $91, $A2 (must; VICE x64sc store trace, UDTIM once)
**Pairs with:** RDTIM, SETTIM, STOP
**Description:** Increments the 24-bit jiffy-clock counter at
`$A0/$A1/$A2` by one. When the count reaches `$4F1A01` it is reset
to zero (compare at ROM `$F6A7-$F6B4`), so the clock runs `$000000` to
`$4F1A00`, 24 hours of 1/60 s ticks. There is one constant for both
regions; the PAL timer latch already runs the clock at 60 Hz. (An
earlier version gave a second PAL wrap constant, `$4A6800`, and said
PAL drifts; neither value nor drift is in the ROM.) UDTIM also reads the keyboard-matrix row that contains
the STOP key (column at port `$DC00`, row at port `$DC01`) and
sets `$91` to `$7F` if STOP is pressed, which is what makes the
STOP routine work. UDTIM is called from the IRQ handler at `$EA31`
every jiffy. A handler that replaces the IRQ vector must
`JSR $FFEA`, or the jiffy clock and STOP freeze.

## Memory

The two memory routines manipulate the KERNAL's notion of where RAM
starts and ends. Both use one read/write convention:
**carry-flag = direction**. C=0 means "write the supplied value into
the KERNAL pointer"; C=1 means "read the current value into the
return registers".

### $FF99 — MEMTOP — Read or set top of RAM

**Input:** C=1 to read (input ignored); C=0 to set, X = low byte, Y = high byte of new top
**Output:** With C=1: X = low byte, Y = high byte of current top
**Affects:** A, X, Y
**Clobbers zero page:** none (may; ROM walk from $FF99, power-on vectors)
**Pairs with:** MEMBOT, RAMTAS
**Description:** Reads or writes the KERNAL's top-of-memory pointer,
stored at `$0283-$0284`. On a stock 38911-byte BASIC system, the
default value is `$A000` (`$00`/`$A0`); BASIC strings grow downward
from this address, and BASIC's free-memory message reports
`top - vartab`. Lowering MEMTOP reserves a block at the top of RAM
that BASIC will not touch; for example, setting it to `$9000` keeps
the 4 KiB at `$9000-$9FFF` free for machine-language code that
coexists with BASIC. `$C000-$CFFF` needs no protection: it is above
the default `$A000`. (An earlier version used `$C000` as the example,
which raises MEMTOP.) BASIC copies MEMTOP into its own top pointer
`$37/$38` only at cold start (ROM `$E40A`), so a running program that
lowers MEMTOP must also set `$37/$38` (and `$33/$34`) or cold-start
BASIC. Lowering MEMTOP does
*not* shrink memory available to ML programs; it only tells BASIC
to stay below the new ceiling.

### $FF9C — MEMBOT — Read or set bottom of RAM

**Input:** C=1 to read (input ignored); C=0 to set, X = low byte, Y = high byte of new bottom
**Output:** With C=1: X = low byte, Y = high byte of current bottom
**Affects:** A, X, Y
**Clobbers zero page:** none (may; ROM walk from $FF9C, power-on vectors)
**Pairs with:** MEMTOP, RAMTAS
**Description:** Reads or writes the KERNAL's bottom-of-memory
pointer, stored at `$0281-$0282`. The default value is `$0800`,
placing the bottom of the BASIC text area at `$0801` (the byte at
`$0800` is a required zero terminator). Raising MEMBOT reserves a
block at the bottom of RAM for non-BASIC use. Setting MEMBOT does
*not* relocate the existing BASIC program; if BASIC has already
loaded a program, it must be moved by hand. Application programs
that need a small RAM scratchpad often raise MEMBOT to `$0900` or
`$0A00`, leaving the cassette buffer at `$033C-$03FB` free if
they need more space without disturbing BASIC.

## Vectors

The KERNAL exposes 16 indirect RAM vectors at `$0314-$0333` that the
high-level KERNAL routines and the CPU's IRQ/BRK/NMI hardware
dispatch through. Patching a vector replaces the corresponding
KERNAL routine.

| Addr          | Vector  | Purpose                                                  |
|---------------|---------|----------------------------------------------------------|
| `$0314-$0315` | CINV    | IRQ handler (CPU vector indirects here from `$FFFE`)     |
| `$0316-$0317` | CBINV   | BRK handler                                              |
| `$0318-$0319` | NMINV   | NMI handler (CPU vector indirects here from `$FFFA`)     |
| `$031A-$031B` | IOPEN   | OPEN (called by `$FFC0`)                                 |
| `$031C-$031D` | ICLOSE  | CLOSE (called by `$FFC3`)                                |
| `$031E-$031F` | ICHKIN  | CHKIN (called by `$FFC6`)                                |
| `$0320-$0321` | ICKOUT  | CHKOUT (called by `$FFC9`)                               |
| `$0322-$0323` | ICLRCH  | CLRCHN (called by `$FFCC`)                               |
| `$0324-$0325` | IBASIN  | CHRIN (called by `$FFCF`)                                |
| `$0326-$0327` | IBSOUT  | CHROUT (called by `$FFD2`)                               |
| `$0328-$0329` | ISTOP   | STOP (called by `$FFE1`)                                 |
| `$032A-$032B` | IGETIN  | GETIN (called by `$FFE4`)                                |
| `$032C-$032D` | ICLALL  | CLALL (called by `$FFE7`)                                |
| `$032E-$032F` | USRCMD  | User function (unused by KERNAL; BASIC `USR` hooks here) |
| `$0330-$0331` | ILOAD   | LOAD (called by `$FFD5`)                                 |
| `$0332-$0333` | ISAVE   | SAVE (called by `$FFD8`)                                 |

The four initialization routines below populate or restore these
vectors and related state.

### $FF84 — IOINIT — Initialize I/O chips

**Input:** None
**Output:** None
**Affects:** A, X, Y
**Clobbers zero page:** $00-$01 (may; ROM walk from $FF84, power-on vectors)
**Pairs with:** CINT, RAMTAS, RESTOR
**Description:** Initializes the two CIA chips (sets DDRs, programs
Timer A on CIA1 for the 60 Hz jiffy IRQ on both regions), initializes the SID
(silences all three voices), sets the IEC bus lines to idle, and
clears the CIA interrupt-control registers. Called once at power-on,
first, before RAMTAS, RESTOR and CINT (ROM `$FCF2`; an earlier version
said between RAMTAS and CINT). Application code can call IOINIT to recover
from chip-state corruption, but doing so silences any in-progress
sound and resets the keyboard-scan IRQ rate to the KERNAL default.

### $FF87 — RAMTAS — RAM test and clear

**Input:** None
**Output:** None
**Affects:** A, X, Y
**Clobbers zero page:** $02-$FF (may; ROM walk from $FF87, power-on vectors; also stores through ($C1))
**Pairs with:** IOINIT, CINT, MEMTOP, MEMBOT
**Description:** Performs the RAM-test portion of cold start: walks
through each page from `$0400` upward (ROM `$FD68`; an earlier
version said `$0800`) writing `$55` then `$AA` then
reading back, until it finds a page that doesn't echo back the
written value, which becomes the top-of-RAM. Zeroes `$0002-$00FF` and
`$0200-$03FF` (zero page below the stack, the BASIC input buffer and
the screen-editor work area); the stack page is not cleared apart from
the two bytes `$0100-$0101` that the `STA $0002,Y` loop spills into.
Earlier versions of this page said "pages 0/1/2/3" in the table and
"pages 2 and 3" here; the ROM loop at `$FD50` is `STA $0002,Y / STA
$0200,Y / STA $0300,Y` with Y 0-255, confirmed in VICE x64sc 3.10. It
sets MEMTOP to the discovered top and MEMBOT to `$0800`,
clears the cassette buffer at `$033C-$03FB`. RAMTAS is destructive
and is normally called only at power-on. Calling it from a running
program erases the BASIC input buffer and the open-file table.

### $FF8A — RESTOR — Restore default vectors

**Input:** None
**Output:** None
**Affects:** A, X, Y
**Clobbers zero page:** $C3-$C4 (may; ROM walk from $FF8A, power-on vectors; also stores through ($C3))
**Pairs with:** VECTOR, IOINIT
**Description:** Copies the KERNAL's default vector table (16 vectors
starting at `$FD30` in ROM) into the RAM vectors at `$0314-$0333`.
Use RESTOR after any program that has patched the KERNAL vectors
(e.g. a custom IRQ handler, a CHROUT wedge, a fast-load patch) to
return to known defaults. RESTOR is equivalent to calling VECTOR
with C=0 and a pointer to the ROM default table.

### $FF8D — VECTOR — Read or write all RAM vectors

**Input:** C=0 to write vectors from supplied table; C=1 to read vectors into supplied buffer. X = low byte of buffer/table, Y = high byte
**Output:** With C=1: buffer at (X,Y) filled with 32 bytes (16 vectors)
**Affects:** A, X, Y
**Clobbers zero page:** $C3-$C4 (may; ROM walk from $FF8D, power-on vectors; also stores through ($C3))
**Pairs with:** RESTOR
**Description:** Block-copies the 16 RAM vectors between memory and
the KERNAL's vector area at `$0314-$0333`. With C=1, copies *from*
the vector area into the supplied buffer (snapshot the current vector
state). With C=0, copies *into* the vector area from the supplied
table (install a complete vector set in one call). Typical use:
snapshot with C=1, patch one or two entries, install with C=0.
Writing the two bytes of a single vector directly to
`$0326`/`$0327` etc. is cheaper.

### $FF90 — SETMSG — Set KERNAL message verbosity

**Input:** A = message-control bits (bit 7 = print KERNAL error messages, bit 6 = print KERNAL control messages like "SEARCHING", "LOADING", "PRESS PLAY ON TAPE")
**Output:** None
**Affects:** None (stores A at `$009D`)
**Clobbers zero page:** $90, $9D (may; ROM walk from $FF90, power-on vectors)
**Pairs with:** OPEN, LOAD, SAVE
**Description:** Controls whether the KERNAL prints status messages
to the screen during file operations. A=`$80` (bit 7 only) enables
error messages but suppresses control messages, for an
application that handles "press play on tape" prompts itself.
A=`$C0` enables both (the default for BASIC). A=`$00` suppresses
everything, for headless tools that drive the KERNAL from
machine code and want no stray text on screen.

## IEC bus low-level

The eight routines in this section drive the C64's serial IEC bus
directly, byte by byte. Most application code never calls them
because OPEN/CLOSE/LOAD/SAVE wrap them, but custom bus protocols
(fast loaders, IEEE-488 adapters, custom drive commands) use them.

The IEC protocol is a fixed sequence:

1. **LISTEN/TALK** sends a device-address byte with the ATN line low
   to announce which device is being addressed.
2. **SECOND/TKSA** sends a secondary-address byte (still with ATN
   low): usually a file-channel number on disk drives, or a
   format command.
3. **IECOUT/IECIN** transfers data bytes one at a time, with ATN
   high. IECOUT writes (after LISTEN+SECOND), IECIN reads (after
   TALK+TKSA).
4. **UNLSN/UNTLK** ends the transfer by releasing the bus.

### $FFB1 — LISTEN — Send LISTEN command

**Input:** A = device number (0-31)
**Output:** None (status byte set on error)
**Affects:** A
**Clobbers zero page:** $90, $94-$95, $A3, $A5 (may; ROM walk from $FFB1, power-on vectors)
**Pairs with:** SECOND, IECOUT, UNLSN
**Description:** Sends the LISTEN command byte (`$20 | device`) on
the IEC bus with the ATN line asserted. After LISTEN, all subsequent
data sent via IECOUT goes to the addressed device until UNLSN is
sent. The status byte (READST) is set to `$80` if the device does
not acknowledge (device not present). Internally the routine
manipulates the data line (`$DD00` bit 5), clock line (`$DD00`
bit 4), and ATN line (`$DD00` bit 3) of CIA2 port A to drive the
serial bus signals; on a real C64 the entire byte takes about
1 ms. Multiple LISTEN commands can be sent in sequence to address
multiple listeners simultaneously, but only one device can talk
at a time. The device argument is the device number 0-30;
the routine applies the `$20 | device` encoding.

### $FFB4 — TALK — Send TALK command

**Input:** A = device number (0-31)
**Output:** None (status byte set on error)
**Affects:** A
**Clobbers zero page:** $90, $94-$95, $A3, $A5 (may; ROM walk from $FFB4, power-on vectors)
**Pairs with:** TKSA, IECIN, UNTLK
**Description:** Sends the TALK command byte (`$40 | device`) on the
IEC bus with ATN asserted. After TALK, the addressed device becomes
the bus talker, and the C64 receives its data via IECIN until
UNTLK is sent. Status byte set to `$80` on no-acknowledge. Only one
device on the bus can be the talker at any time, so a TALK command
implicitly silences any previous talker. After the TALK byte goes
out, the routine releases ATN and the device begins to drive the
data line; the first IECIN call then reads the first byte the
device produces. To read from a specific channel of a
disk drive (e.g. the error channel at secondary 15), follow TALK
with TKSA.

### $FF93 — SECOND — Send secondary address after LISTEN

**Input:** A = secondary-address byte (typically `$60 | channel` for open channel, `$F0 | channel` to open a file, `$E0 | channel` to close)
**Output:** None
**Affects:** A
**Clobbers zero page:** $90, $95, $A5 (may; ROM walk from $FF93, power-on vectors)
**Pairs with:** LISTEN, IECOUT
**Description:** Sends a secondary-address byte after a LISTEN. The
secondary address selects the file channel or command on the
addressed device. For disk drives, secondary `$60 | n` opens
channel n for data transfer, `$F0 | n` opens a file (followed by
filename bytes via IECOUT), and `$E0 | n` closes channel n. SECOND
keeps ATN asserted while sending so the device sees the byte as a
command, not data.

### $FF96 — TKSA — Send secondary address after TALK

**Input:** A = secondary-address byte
**Output:** None
**Affects:** A
**Clobbers zero page:** $90, $95, $A5 (may; ROM walk from $FF96, power-on vectors)
**Pairs with:** TALK, IECIN
**Description:** Sends a secondary-address byte after a TALK, same
encoding as SECOND. Use TKSA to tell the talking device which
channel to read from. Like SECOND, keeps ATN asserted during the
byte to mark it as a command.

### $FFA5 — IECIN — Receive one byte from serial bus

**Input:** None (TALK + TKSA must have been called)
**Output:** A = byte received; status byte updated on EOI / error
**Affects:** A
**Clobbers zero page:** $90, $95, $A4-$A5 (may; ROM walk from $FFA5, power-on vectors)
**Pairs with:** TALK, TKSA, UNTLK, READST
**Description:** Clocks one byte off the IEC bus from the currently
talking device. On the last byte of a transfer (EOI), the talker
waits before sending the first bit; if CLK stays unchanged for about
256 µs (CIA1 timer B, `$DC07` = `$01`), the KERNAL sets status bit 6
(`$40`), pulses DATA low to acknowledge, and then reads the eight bits
(ROM `$EE20-$EE55`). (An earlier version said the signal comes before
the eighth bit.)
Call READST after each IECIN to detect EOI and error conditions
(`$01` = timeout writing, `$02` = timeout reading, `$80` = device
not present). Historical name: ACPTR.

### $FFA8 — IECOUT — Send one byte to serial bus

**Input:** A = byte to send
**Output:** None (status byte updated on error)
**Affects:** None (A preserved)
**Clobbers zero page:** $90, $94-$95, $A5 (may; ROM walk from $FFA8, power-on vectors)
**Pairs with:** LISTEN, SECOND, UNLSN, READST
**Description:** Sends one byte to the currently listening device.
The byte is clocked out using the C64's bit-banged IEC protocol;
total time per byte is about 1 ms on a real drive. Errors
(`$01`/`$02`/`$80`) are recorded in the status byte. Historical
name: CIOUT.

### $FFAB — UNTLK — Send UNTALK

**Input:** None
**Output:** None
**Affects:** A
**Clobbers zero page:** $90, $94-$95, $A3, $A5 (may; ROM walk from $FFAB, power-on vectors)
**Pairs with:** TALK, TKSA, IECIN
**Description:** Sends the UNTALK command (`$5F`) with ATN
asserted. The current talking device, if any, releases the data
line and the bus returns to idle. The command is broadcast, so
all listeners and the (single) talker simultaneously hear it; the
talker stops talking, the listeners stop listening for that
talker. Use UNTLK to end a TALK transaction. Calling UNTLK with
no active talker is harmless: the command is sent to all
devices and none act on it.

### $FFAE — UNLSN — Send UNLISTEN

**Input:** None
**Output:** None
**Affects:** A
**Clobbers zero page:** $90, $94-$95, $A3, $A5 (may; ROM walk from $FFAE, power-on vectors)
**Pairs with:** LISTEN, SECOND, IECOUT
**Description:** Sends the UNLISTEN command (`$3F`) with ATN
asserted. All bus-listening devices stop receiving data. Use
UNLSN to end a LISTEN transaction. On a disk drive, UNLSN with
secondary `$F0` (file-open) pending tells the drive to finalize
the OPEN: the drive parses the filename it received since
LISTEN+SECOND, locates the file, and is ready for subsequent
IECIN/IECOUT against the opened channel. Without UNLSN the
drive doesn't know the filename is complete and won't open the
file. This is why OPEN always ends with UNLSN even though no
filename byte follows.

### $FFB7 — READST — Read serial bus status

**Input:** None
**Output:** A = status byte (alias for the zero-page `$90` ST byte)
**Affects:** A
**Clobbers zero page:** $90 (may; ROM walk from $FFB7, power-on vectors)
**Clobbers zero page:** $90 (must; VICE x64sc store trace, READST)
**Pairs with:** IECIN, IECOUT, CHRIN, CHROUT
**Description:** Reads the KERNAL's status byte `$90` and returns it
in A without clearing it (ROM `$FE1A`: `LDA $90`, `ORA $90`, `STA $90`).
Only for RS-232 (device 2) does READST clear its byte, `$0297`. (An
earlier version said READST clears the status byte.) Bit values:

| Bit | Hex   | Meaning (cassette)              | Meaning (serial bus)              |
|-----|-------|---------------------------------|-----------------------------------|
| 0   | `$01` | Unused                          | Timeout while writing             |
| 1   | `$02` | Unused                          | Timeout while reading             |
| 2   | `$04` | Short block (tape)              | Unused                            |
| 3   | `$08` | Long block (tape)               | Unused                            |
| 4   | `$10` | Unrecoverable read error (tape) | Verify error                      |
| 5   | `$20` | Checksum error (tape)           | Unused                            |
| 6   | `$40` | End of file (tape)              | EOI on input (last byte of file)  |
| 7   | `$80` | End of tape                     | Device not present                |

A status of `$00` after a CHRIN means "more data available". `$40`
after a CHRIN means "the byte just delivered was the last byte of
the file" (the file is now at EOF). `$80` indicates a missing
device and is set by LISTEN/TALK if no device acknowledges.

### $FF9F — SCNKEY — Scan keyboard

**Input:** None
**Output:** None (keyboard queue at `$0277-$0280` may gain new entries)
**Affects:** A, X, Y
**Clobbers zero page:** $C5-$C6, $CB, $F5-$F6 (may; ROM walk from $FF9F, power-on vectors)
**Clobbers zero page:** $C5, $CB (must; VICE x64sc store trace, SCNKEY with no key down)
**Pairs with:** GETIN, STOP
**Description:** Scans the 8x8 keyboard matrix via CIA1 ports A
and B, decodes the pressed key against the current keyboard table
(four tables: unshifted, shifted, Commodore-shifted, control), and
pushes the resulting PETSCII byte into the keyboard queue. SCNKEY
also tracks the shift/Commodore/CTRL state at `$028D`. It does not
touch the STOP flag at `$91` (an earlier version of this page said it
did; the only store to `$91` in the KERNAL is in UDTIM at `$F6DA`).
SCNKEY is called from the IRQ handler at `$EA31`, after UDTIM, and
exits with `$DC00` = `$7F`, which is the column drive UDTIM's `$DC01`
read relies on. An application that disables IRQs must call SCNKEY
itself to keep the keyboard queue filling and UDTIM (`$FFEA`) to keep
the STOP flag and jiffy clock updating.

### $FFA2 — SETTMO — Set IEEE timeout flag

**Input:** A = timeout flag (bit 7 = enable timeouts)
**Output:** None
**Affects:** None
**Clobbers zero page:** none (may; ROM walk from $FFA2, power-on vectors)
**Pairs with:** READST
**Description:** Stores A in `$0285` and returns (ROM `$FE21`). No
code in the KERNAL or BASIC ROM reads `$0285`, so the call changes
no bus behaviour; an IEEE-488 cartridge's own driver could read it.
(An earlier version said SETTMO is a no-op and named a "VIC-1541 IEEE
adapter"; the store is real, and that product name is not verified.)
It exists for source compatibility with the PET, where it controlled
the timeout behaviour of the IEEE-488 bus. The C64's IEC serial bus
has its own fixed timeout logic that cannot be disabled. On a stock C64 with only IEC devices, the
timeouts are wired in: the KERNAL's IEC driver gives up after
about 64 ms of clock-low time and sets the status byte to `$02`
(read timeout) or `$01` (write timeout). Reading READST after a
suspicious IECIN/IECOUT is the C64 substitute for SETTMO.

### $FFF3 — IOBASE — Get I/O block base address

**Input:** None
**Output:** X = low byte, Y = high byte of I/O base (always `$00`/`$DC` on C64)
**Affects:** X, Y
**Clobbers zero page:** none (may; ROM walk from $FFF3, power-on vectors)
**Pairs with:** SCREEN
**Description:** Returns the base address of the I/O block, which
on the C64 is always `$DC00` (the start of CIA1). Self-relocating
code that addresses CIAs / SID / VIC-II by offset from
this base can use IOBASE to stay portable to other
Commodore machines where the I/O block lives elsewhere. On the
C64 the value is fixed in ROM and never changes. The original
intent was to let one program binary run on C64, C128, B-series,
and Plus/4 by replacing all `LDA $DC00` constants with
`LDA (ptr),Y` indirect-indexed accesses through a zero-page pointer
set from IOBASE. (An earlier version wrote `LDY (…),Y`, which is not a
6502 addressing mode.) Almost no C64 software used IOBASE;
tutorials and listings hard-code the I/O addresses.

## Pairs and contracts

KERNAL routines form stateful sequences. The graph below
shows which calls must precede which.

```
SETLFS ─┐
         ├─► OPEN ─► CHKIN  ─► CHRIN  ─┐
SETNAM ─┘     │      CHKOUT ─► CHROUT ─┤
              │                         │
              ├─► LOAD                  │
              ├─► SAVE                  │
              └─► CLOSE ◄── CLRCHN ─────┘
```

### File-I/O setup chain

| Order | Routine | Why                                                       |
|-------|---------|-----------------------------------------------------------|
| 1     | SETLFS  | Stores logical file / device / secondary in zero page     |
| 2     | SETNAM  | Stores filename pointer + length in zero page             |
| 3     | OPEN    | Reads both, sends LISTEN+SECOND+filename+UNLISTEN         |
| 4     | CHKIN   | (or CHKOUT) — selects input (or output) channel           |
| 5     | CHRIN   | (or CHROUT, GETIN) — transfers data                       |
| 6     | CLRCHN  | Releases channel (sends UNTALK or UNLISTEN)               |
| 7     | CLOSE   | Tells device to close its end of the channel              |

The KERNAL does not enforce the order. Skipping or reordering a step
causes these bugs:

- **Skipping SETLFS before OPEN** uses stale parameters from the
  previous SETLFS call. Calling OPEN twice in a row reuses the
  last set of parameters, which is usually wrong.
- **OPEN with no filename** (SETNAM length 0) is legal on every
  device. On a serial device it returns C=0 and sends nothing to the
  drive (ROM `$F3D9`). Error 8 ("missing filename") comes from LOAD
  and SAVE to a serial device with no name (ROM `$F4B8`, `$F5FE`). (An
  earlier version said a disk OPEN without a name returns error 8.)
- **CHRIN/CHROUT without CHKIN/CHKOUT** acts on the default channel
  (keyboard in, screen out). Sometimes that is intended; forgetting
  that CHKIN/CHKOUT are required to redirect is a frequent bug.
- **CLOSE without CLRCHN** leaves the channel selected as the active
  input or output. The next CHRIN/CHROUT operates on a
  closed file and fails. The order is CLRCHN, then CLOSE.

### IEC raw-bus chain

The low-level routines parallel the high-level ones:

| To write to a device      | To read from a device     |
|---------------------------|---------------------------|
| 1. LISTEN (with device #) | 1. TALK (with device #)   |
| 2. SECOND (with secondary)| 2. TKSA (with secondary)  |
| 3. IECOUT (repeatedly)    | 3. IECIN (repeatedly)     |
| 4. UNLSN                  | 4. UNTLK                  |

LISTEN/TALK can be combined: send LISTEN to one device, then send a
sequence of SECOND+IECOUT to write commands to it, then LISTEN to a
second device for further writes, then UNLSN at the end to release
all listeners. The bus supports up to 31 devices simultaneously
(addresses 0-30; address 31 is reserved).

### Vector-patching chain

To install a custom IRQ handler with vector save/restore:

```asm
        sei
        lda $0314          ; save current IRQ vector
        sta old_irq_lo
        lda $0315
        sta old_irq_hi
        lda #<my_irq
        sta $0314
        lda #>my_irq
        sta $0315
        cli
        ; ... run ...
        sei
        lda old_irq_lo
        sta $0314
        lda old_irq_hi
        sta $0315
        cli
```

Or, equivalently, before exit:

```asm
        jsr $FF8A          ; RESTOR — restores all 16 vectors at once
```

RESTOR resets every vector. For a program that patched only the
IRQ vector, RESTOR is fine. If something else (e.g. a wedge that
patched IBSOUT to filter screen output) was already running, RESTOR
erases its patches too.

### Time-clock pairing

`SETTIM`/`RDTIM` operate on the three-byte counter that `UDTIM`
increments. Programs that disable IRQs and then read the jiffy clock
see a frozen value; either re-enable IRQs or call UDTIM manually
inside the critical section to keep the counter advancing.

### Cold-start / warm-start sequence

The KERNAL's reset vector (`$FFFC`) points at the cold-start routine
that runs this sequence:

```
RESET → STX $D016         ; VIC control 2; TXS at $FCE5 set the stack
      → JSR $FDA3 (IOINIT)
      → JSR $FD50 (RAMTAS)
      → JSR $FD15 (RESTOR)
      → JSR $FF5B (CINT)
      → JMP ($A000)       ; cold-start BASIC
```

In jump-table terms: IOINIT → RAMTAS → RESTOR → CINT, then jump to
BASIC. To restart without a hard reset, an application can call
the same four routines (in the same order) followed by `JMP ($A000)`
(or its own entry point). `$A000` holds the BASIC cold-start vector,
not code; an earlier version wrote `JMP $A000`.

### Status-byte interaction with file I/O

Every file-I/O routine that touches the IEC or cassette bus updates
the status byte at `$90`. Reading the status byte via READST is the
*only* reliable way to detect end-of-file and bus errors; the
carry flag returned from CHRIN/CHROUT/IECIN/IECOUT signals only
"could not complete this operation", not "end of file".

An end-of-file read loop:

```asm
read_loop:
        jsr $FFCF       ; CHRIN
        sta buffer,y
        iny
        jsr $FFB7       ; READST
        beq read_loop   ; ST == 0 means more data
        and #$40        ; EOI bit?
        bne ok          ; ok, file just ended
        ; non-zero ST without EOI bit = real error
        jmp error
ok:     rts
```

A common mistake is to use `bcc` after CHRIN instead of READST.
CHRIN clears carry on a successful read *including the last byte
of the file*, then sets EOI in the status byte. The carry doesn't
become set until the byte *after* EOI, by which point the program
has already read past end-of-file. Test READST, not carry, for
end-of-file.

### Worked examples

These snippets show the standard
KERNAL call sequences. All examples assume the assembler's
default segment starts somewhere safe (e.g. `$0801` with a BASIC
SYS stub, or `$C000` for a standalone ML program).

#### Reading the disk error channel

As a technique with a measured round-trip: `error_channel_check` in `../techniques/file-io.md` and `../recipes/kickassembler/file-io-roundtrip.md`.

To check the drive's status, open the command
channel (secondary 15), read the response into a buffer until
end-of-file or CR, then close.

```asm
read_error:
        lda #15         ; logical file
        ldx #8          ; device
        ldy #15         ; secondary = command channel
        jsr $FFBA       ; SETLFS
        lda #0          ; no filename
        jsr $FFBD       ; SETNAM
        jsr $FFC0       ; OPEN
        bcs err_open

        ldx #15
        jsr $FFC6       ; CHKIN
        bcs err_chkin

        ldy #0
@loop:  jsr $FFCF       ; CHRIN
        sta buf,y
        iny
        jsr $FFB7       ; READST
        beq @loop
        ; status non-zero — either EOI or error
        and #$BF        ; mask off EOI bit
        bne @err

        jsr $FFCC       ; CLRCHN
        lda #15
        jsr $FFC3       ; CLOSE
        rts

@err:   jsr $FFCC
        lda #15
        jsr $FFC3
        sec
        rts
```

After this call, `buf` contains the drive status line like
"00, OK,00,00" or "21,READ ERROR,18,01" (terminated by CR).

#### Writing a sequential disk file

As techniques with a measured round-trip: `kernal_file_write_seq` and `kernal_file_read_seq` in `../techniques/file-io.md`.

Write a small block to a new disk file. Two SETLFS+SETNAM
sequences are used: one to scratch any existing file with the
same name (via the command channel), then one to create the
new file.

```asm
        ; scratch FILE first
        lda #15
        ldx #8
        ldy #15
        jsr $FFBA       ; SETLFS for command channel
        lda #scr_end-scr
        ldx #<scr
        ldy #>scr
        jsr $FFBD       ; SETNAM (command string)
        jsr $FFC0       ; OPEN (sends the command)
        bcs err

        lda #15
        jsr $FFC3       ; CLOSE command channel

        ; now create FILE for write
        lda #2          ; logical
        ldx #8
        ldy #2          ; secondary = open channel
        jsr $FFBA       ; SETLFS
        lda #fn_end-fn
        ldx #<fn
        ldy #>fn
        jsr $FFBD       ; SETNAM
        jsr $FFC0       ; OPEN
        bcs err

        ldx #2
        jsr $FFC9       ; CHKOUT (redirect output)
        bcs err

        ldy #0
@loop:  lda data,y
        jsr $FFD2       ; CHROUT
        iny
        cpy #data_end-data
        bne @loop

        jsr $FFCC       ; CLRCHN
        lda #2
        jsr $FFC3       ; CLOSE
        rts

err:    jsr $FFCC
        lda #2
        jsr $FFC3
        sec
        rts

scr:    .byte "S0:FILE"
scr_end:
fn:     .byte "FILE,S,W"
fn_end:
data:   .byte "HELLO, WORLD", 13
data_end:
```

#### Custom IRQ handler that calls UDTIM

Replace the system IRQ handler with one that does custom work
each jiffy but still calls UDTIM so the jiffy clock and STOP
key keep working. It exits through `$EA81`, which pulls Y, X, A and
returns, so it skips the cursor blink and SCNKEY; to keep those, end
with `jmp (old_lo)` instead and drop the `jsr $FFEA`, because `$EA31`
calls UDTIM itself (ROM `$EA31` = `JSR $FFEA`).

```asm
install:
        sei
        lda $0314
        sta old_lo
        lda $0315
        sta old_hi
        lda #<my_irq
        sta $0314
        lda #>my_irq
        sta $0315
        cli
        rts

my_irq:
        ; ... my custom work, fast ...
        jsr $FFEA       ; UDTIM — keep jiffy clock + STOP working
        lda $DC0D       ; ack the CIA1 timer A IRQ
        jmp $EA81       ; KERNAL exit: restore Y, X, A; RTI
old_lo: .byte 0         ; saved $0314/$0315, for chaining or uninstall
old_hi: .byte 0
```

An earlier version acked `$D019`, called UDTIM and then did
`jmp (old_irq_target)` with `old_irq_target = $EA31`. That jumps
through the code bytes at `$EA31/$EA32` (to `$EA20`), acks the wrong
chip for the KERNAL's CIA IRQ, and would have run UDTIM twice per
jiffy had it reached `$EA31`.

#### Polling input non-blocking in a game loop

A game-loop input pattern:

```asm
game_loop:
        jsr $FFE4       ; GETIN
        beq @no_key
        cmp #$20        ; space?
        beq do_fire
        cmp #'A'
        beq turn_left
        cmp #'D'
        beq turn_right
@no_key:
        jsr $FFE1       ; STOP
        beq quit
        ; ... per-frame logic ...
        jmp game_loop
quit:   rts
```

GETIN doesn't block on the keyboard, so the loop runs every
frame regardless of input. STOP is checked at the end of each
iteration. BASIC programs that alternate between `GET A$` and
game logic use the same structure; in ML it runs hundreds of times
faster.

#### Reading the jiffy clock for timing

A 30-jiffy delay using RDTIM:

```asm
        jsr $FFDE       ; RDTIM — A=high, X=mid, Y=low
        sty start_lo
        ; assume the wait is < 256 jiffies so we ignore mid/high
@wait:  jsr $FFDE
        sec
        tya
        sbc start_lo
        cmp #30
        bcc @wait
        rts
start_lo: .byte 0
```

For longer waits, store all three RDTIM bytes and do 24-bit
subtraction. RDTIM reads atomically (with IRQs briefly
disabled), so the three bytes are always consistent.

### Pair-with notation

The `**Pairs with:**` lines on each routine name routines that
appear together in correct code. There are three kinds of pairing:

- **Setup pairing** — must call routine X before routine Y for Y
  to have valid input (e.g. SETLFS pairs with OPEN; LISTEN pairs
  with IECOUT).
- **Cleanup pairing** — must call routine X after routine Y to
  release state (e.g. CLRCHN pairs with CHKIN/CHKOUT; UNLSN
  pairs with LISTEN+IECOUT).
- **Symmetric pairing** — routines that read and write the same
  state (e.g. MEMTOP and RAMTAS; SETTIM and RDTIM).

The graph extractor reads these lines and produces `PAIRS_WITH`
edges in the knowledge graph, so one query from OPEN finds what must
precede OPEN: its SETLFS+SETNAM dependencies.

## Pitfalls

- **CHROUT modifies VIC-II state.** Writing PETSCII `$0E` (charset 2
  / lower case) or `$8E` (charset 1 / upper-graphics) causes CHROUT
  to write to `$D018`, changing the character ROM source. With a
  custom bitmap or a charset other than the KERNAL defaults set up,
  sending a `$0E` or `$8E` byte reverts it.
  Color-code PETSCII bytes (`$05`, `$1C`, `$1E`, `$1F`, `$81`, `$90`,
  `$95`-`$9C`, `$9E`, `$9F`; the table at ROM `$E8DA`; an earlier
  version gave `$1C`-`$1F` and `$90`-`$9F`, which include cursor and
  control codes)
  similarly write to the current-color byte at `$0286` (page 2, not
  zero page) and change the foreground color of subsequent character
  writes. To
  send a literal `$0E` to a file (e.g. when dumping binary to disk),
  use IECOUT directly rather than CHROUT after CHKOUT.

- **CHKIN/CHKOUT require a prior successful OPEN.** They return
  C=1 + error code 3 ("file not open") if the logical file isn't
  in the open-file table. A common pattern bug is to call OPEN,
  check carry, jump to error on failure, then unconditionally call
  CHKIN on the (un-opened) logical file, which then fails with
  the misleading error 3. Check carry after every
  KERNAL call.

- **CHKOUT to a disk file opened for read does NOT fail.** Measured
  in VICE x64sc: `OPEN 2,8,2,"FILE,S,R"` then CHKOUT 2 returns C=0; the
  bytes are accepted and, with the 1541-II DOS, the error channel still
  reads 00. Error 7 comes only from the keyboard (device 0) or a tape
  file opened for read. Use CHKIN for a read channel; nothing reports
  the mistake otherwise. (Earlier text said CHKOUT returned error 7 here;
  it does not.)

- **CLOSE without CLRCHN leaves a dangling channel.** Subsequent
  CHRIN/CHROUT read/write to a closed file's slot. Symptoms:
  garbage bytes, frozen reads, status byte not updating. Call
  `JSR $FFCC` (CLRCHN) immediately after every
  CHRIN/CHROUT loop, before any CLOSE.

- **CLALL doesn't tell IEC devices to close.** Unlike CLOSE, CLALL
  only zeros the KERNAL's open-file table and runs CLRCHN. Disk-side
  state (channel buffers, dirty relative-file blocks) is left
  untouched; no close command is sent. (An earlier version said the
  drive's state waits for an UNLISTEN; CLALL already sends one.) After CLALL, a re-OPEN of a file
  with the same secondary on the same device may return
  stale data from the abandoned channel.

- **LOAD destination is X/Y on the call, but X/Y on return mean
  end-address.** Code that expects X/Y to still hold the load
  address after LOAD gets the address after the last byte loaded
  (near 65535 for a long load that fills memory to the top). The output-X/Y convention is *end-address + 1*, so
  for a file loaded to `$1000-$1FFF` the call returns X=`$00`,
  Y=`$20` (i.e. `$2000`).

- **SAVE end-address is exclusive.** The end-address+1 passed to
  SAVE in X/Y is the byte after the last one to save. Saving
  `$1000-$1FFF` requires X=`$00`, Y=`$20`. A common bug is passing
  the inclusive end-address `$1FFF`, which produces a file one byte
  short.

- **SAVE start-address is indirect.** A holds a *zero-page byte
  number*, not an address. The KERNAL reads two bytes starting at
  that zero-page byte to get the actual start address. BASIC uses
  `$2B` because BASIC's start-of-program pointer lives at
  `$2B/$2C`. To save a custom range from ML, store the start
  address into two consecutive zero-page bytes (e.g. `$FB/$FC`)
  and pass A=`$FB`.

- **STOP depends on the IRQ handler.** Reading `$91` only returns
  `$7F` if UDTIM (`$FFEA`) has been sampling the STOP column each
  jiffy; the IRQ handler at `$EA31` calls it before SCNKEY. In an
  SEI-protected critical section, STOP never triggers. To make
  STOP work inside SEI code, `JSR $FFEA` inside the loop
  (once per 1/60 s if `TI$` matters, since it also advances the
  jiffy clock; once per PAL frame runs it slow; an earlier version
  said "at most once per frame"). An earlier version of this bullet said to call
  SCNKEY; SCNKEY does not write `$91` (the only store to it in the
  KERNAL is UDTIM's at `$F6DA`).

- **UDTIM is required by STOP.** A custom IRQ
  handler that does not `JSR $FFEA` stops the jiffy clock and
  STOP-key detection (STOP reads `$91`, which UDTIM updates from
  its keyboard-row read).

- **The jiffy clock is 60 Hz on PAL too, not the frame rate.** The
  KERNAL loads CIA1 timer A with `$4025` on PAL and `$4295` on NTSC,
  so both tick at about 60 Hz (measured in VICE x64sc: 3,590 jiffies in 3,000
  PAL frames, 1.2 per frame). A wait of N jiffies meant as N frames
  ends 17% early on PAL; sync to the raster for per-frame work. (An earlier version of
  this bullet said PAL ticks at 50 Hz and drifts on TI$; the ROM has
  one wrap value, `$4F1A01`, and no drift from region.)

- **GETIN blocks on IEC.** Only the keyboard channel makes GETIN
  non-blocking. After a CHKIN to an IEC device, GETIN waits for a
  byte from the bus just like CHRIN does. A polling
  read from a disk file needs its own timeout
  using a CIA timer.

- **SECOND/TKSA encoding is non-obvious.** The secondary-address
  byte is not the bare secondary number: it is `$60 | sec` for an
  open channel, `$F0 | sec` for open-file, `$E0 | sec` for close.
  Passing the raw secondary number to SECOND addresses the
  wrong command bits.

- **IOBASE on the C64 is always `$DC00`.** Code that uses IOBASE
  to access VIC-II (`$D000-$D02E`) or SID (`$D400-$D41C`) needs to
  subtract from `$DC00`, not add. The convention exists for C128
  / PET compatibility where I/O lives at different addresses, but
  on the C64 the offset arithmetic is non-trivial.

- **SETTMO does not change IEC timeouts.** It stores A in `$0285`,
  which nothing in the KERNAL reads (an earlier version called it a
  no-op). It does not fix IEC bus timeouts: the C64's bus timeouts are
  wired in and cannot be changed from software. The usual fix is
  retrying the operation after the status byte reports `$01`
  (write timeout) or `$02` (read timeout).

- **MEMTOP doesn't protect RAM from ML code.** Lowering MEMTOP
  only tells BASIC to stay below the new ceiling. Direct
  pokes from ML, including the KERNAL's own LOAD into RAM
  beyond MEMTOP, ignore it. Protecting RAM from
  KERNAL+BASIC also means avoiding `LOAD` calls that would
  span the protected region.

- **MEMBOT doesn't relocate the BASIC program.** Raising MEMBOT
  after BASIC has loaded a program leaves the program at the
  old address; BASIC will then misread its own start pointer.
  Set MEMBOT before BASIC loads anything (or before any
  CHRGET-based BASIC operation runs), or also move the program
  by hand.

- **RAMTAS is destructive.** Calling RAMTAS from a running
  program loses the BASIC input buffer,
  the cassette buffer at `$033C-$03FB`, and the open-file
  table. The cold-start sequence calls RAMTAS exactly once,
  before any application state exists.

- **CINT clears the screen.** Calling CINT from an application
  fills screen RAM with spaces and color RAM with the
  current foreground color. To re-init the VIC-II
  for text mode without clearing the screen, write the
  VIC-II registers directly rather than calling CINT.

- **VECTOR with C=0 installs all 16 vectors.** Do not use VECTOR
  to patch one vector: pointing the supplied table at random
  memory overwrites the other 15 KERNAL vectors with
  garbage and crashes the machine on the next IRQ. Patch single
  vectors by writing directly to `$0314`-`$0333`.

- **SETMSG bit 7 alone suppresses control messages but allows
  errors.** Applications use `$80` to keep error messages and
  drop the rest. `$C0` is the BASIC default, with both. `$00` is
  silent: the KERNAL prints nothing during file
  operations even if the device is missing, so the
  application must check carry/status itself.

- **The fast-load problem.** The KERNAL's IEC bus protocol is
  slow: about 400-800 bytes/sec on a 1541. Commercial
  fast-loaders (Action Replay, Final
  Cartridge, JiffyDOS, Epyx Fastload, etc.) replace
  the KERNAL's IECIN/IECOUT bit-banging with custom code that
  uploads a small handler to the drive's 6502 and uses
  non-standard line timing for 5-15x speedup. They
  usually patch IBSOUT, ILOAD, and ISAVE vectors to call into
  the cartridge code. After running with a fast-loader cart,
  vector state is non-default and RESTOR is necessary before
  removing the cartridge or returning to BASIC.

- **CHKIN on the screen returns success silently.** CHKIN on
  device 3 (screen) succeeds with C=0 but then CHRIN returns
  the screen contents at the cursor row, byte by byte, in a
  PETSCII-encoded form. Early Commodore BASIC used this
  mechanism to read the screen as input for the screen editor.
  Code that re-uses a logical file number tied to the screen
  receives that screen text as unexpected input.

- **A logical-file collision is a silent error in some calls.**
  OPEN with a logical file number that is already open returns
  error 2 ("file already open"). But CLOSE on a logical file
  that is not open returns C=0 (success), so a CLOSE that should
  report "wasn't open" succeeds silently and can mask state bugs.
  Track open-file state in the application; the KERNAL does not
  detect double-closes.

- **Zero-page locations the KERNAL routines use.** Many KERNAL
  routines use zero-page bytes as workspace. A program that
  uses the same zero-page locations and calls the KERNAL
  between writes sees its values clobbered.
  The most-touched locations:

  | Addr      | Used by                                            |
  |-----------|----------------------------------------------------|
  | `$90`     | Status byte (READST)                               |
  | `$91`     | STOP-key flag (UDTIM, STOP)                        |
  | `$93`     | LOAD/VERIFY flag                                   |
  | `$95`     | Buffered character (CHRIN/CHROUT)                  |
  | `$98`     | Number of open files                               |
  | `$99-$9A` | Default input/output devices                       |
  | `$9D`     | KERNAL message control (SETMSG)                    |
  | `$A0-$A2` | Jiffy clock (SETTIM, RDTIM, UDTIM)                 |
  | `$AC-$AF` | LOAD/SAVE start and end addresses                  |
  | `$B7`     | Filename length (SETNAM)                           |
  | `$B8`     | Logical file number (SETLFS)                       |
  | `$B9`     | Secondary address (SETLFS)                         |
  | `$BA`     | Device number (SETLFS)                             |
  | `$BB-$BC` | Filename pointer (SETNAM)                          |
  | `$C5`     | Current key pressed (SCNKEY)                       |
  | `$C6`     | Number of chars in keyboard queue                  |
  | `$D1-$D2` | Pointer to start of current screen line (PLOT)     |
  | `$D3`     | Cursor column (PLOT)                               |
  | `$D6`     | Cursor row (PLOT)                                  |

  An ML program that needs these zero-page locations for its
  own use must avoid calling any KERNAL routine that touches
  them, or save and restore the affected bytes around each
  KERNAL call. The screen-editor zero-page locations
  (`$D1-$F2`) take the most writes: calling CHROUT
  modifies a dozen of them.

- **Banking and KERNAL calls.** KERNAL ROM is mapped in at
  `$E000-$FFFF` only when `$01` bit 1 (HIRAM) is set. When
  HIRAM is cleared (e.g. to expose the underlying RAM at
  `$E000-$FFFF`), KERNAL jump-table calls become "JMP to
  whatever's in RAM at `$FFD2`", usually garbage. The
  usual pattern is to save `$01`, set HIRAM, call the
  KERNAL routine, restore `$01`. The CPU's IRQ/NMI vectors
  also live in the KERNAL bank at `$FFFA-$FFFF`, so disabling
  HIRAM without first disabling interrupts is a fast crash:

  ```asm
  pha
  lda $01
  pha
  ora #$02        ; set HIRAM
  sta $01
  jsr $FFD2       ; CHROUT
  pla
  sta $01
  pla
  rts
  ```

- **Cross-reference:** See [c64-memory-map.md](c64-memory-map.md)
  for the meanings of zero-page locations `$90` (status), `$91`
  (STOP flag), `$A0-$A2` (jiffy clock), `$0314-$0333` (RAM
  vectors), and `$0259-$0276` (open-file tables). See
  [cia-reference.md](cia-reference.md) for the CIA1 timer
  programming that drives the 60 Hz IRQ that calls UDTIM.
  See [vic-ii-reference.md](vic-ii-reference.md) for the
  `$D018` register that CHROUT writes when processing PETSCII
  case-toggle bytes (`$0E`, `$8E`).

<!-- doc-type: hardware-reference -->
