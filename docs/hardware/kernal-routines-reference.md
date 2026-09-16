# KERNAL Routines Reference

## Overview

The Commodore 64 KERNAL is the 8 KiB ROM at `$E000-$FFFF` that provides the
machine's operating-system layer: character I/O, file I/O over the IEC serial
bus, the screen editor, the 60/50 Hz IRQ jiffy clock, the STOP-key check, and
the cold-start / warm-start sequences. User programs do not call KERNAL code at
its real ROM addresses — those moved between Commodore machines (VIC-20, PET,
C64, C128, Plus/4). Instead, the KERNAL exposes a **jump table** in the last
128 bytes of the address space, from `$FF81` upward, where each entry is a
3-byte `JMP abs` instruction to the real routine. Commodore promised this
table would be source-compatible across machines; in practice, every
Commodore-8-bit shares the entries from `$FF81` onward and a sub-table from
`$FFC0` onward in identical positions.

There are **39 jump-table entries** spanning `$FF81-$FFF3`. The portion from
`$FFC0-$FFF5` is the historically-documented "user jump table" that the
*Commodore 64 Programmer's Reference Guide* and the *KERNAL Reference Manual*
encourage application programmers to call directly. The entries from
`$FF81-$FFBD` are lower-level — most are used internally by the higher-level
routines, but a handful (SETLFS, SETNAM, READST, MEMTOP, MEMBOT) are essential
for application code as well.

Every routine in this document is documented at its **jump-table address**,
not its real ROM address. Calling code should always `JSR $FFD2` (CHROUT),
never `JSR $E716` (the actual ROM address for CHROUT in the C64 KERNAL).
The jump-table addresses are the stable contract; the ROM-internal addresses
are private implementation detail and can move between KERNAL revisions
(901227-01, -02, -03 all differ in places).

The 39 routines group naturally into eight categories:

1. **Initialization** — CINT, IOINIT, RAMTAS, RESTOR, VECTOR. These run at
   power-on and reset; an application normally calls them only to recover
   after corrupting state.
2. **High-level file I/O** — SETLFS, SETNAM, OPEN, CLOSE, CHKIN, CHKOUT,
   CLRCHN, CLALL, LOAD, SAVE. The supported way to talk to disk, tape, and
   printer.
3. **Character I/O** — CHRIN, CHROUT, GETIN. The screen editor and keyboard
   queue funnel through these.
4. **Low-level IEC bus** — LISTEN, TALK, SECOND, TKSA, IECIN, IECOUT, UNLSN,
   UNTLK, READST. Direct serial-bus protocol for fast loaders and bus
   custom code.
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

Three production-run KERNAL ROMs shipped in the C64 lifetime, identified
by the Commodore part number printed on the ROM chip:

- **901227-01** — original 1982 KERNAL. Identifiable by the slower
  IEC bus protocol (about 400 bytes/sec). Quickly superseded.
- **901227-02** — early-1983 revision. Tweaked the cassette routines,
  fixed a power-on RAM-test bug.
- **901227-03** — the most common ROM, shipped in the bulk of C64
  units sold from mid-1983 onward. Source of all addresses in this
  doc and the source most other documentation cites by default.

All three expose **the same 39-entry jump table at the same
addresses**. Only the ROM-internal routine addresses change between
revisions. Code that always calls via `JSR $FFxx` works on every
KERNAL revision unchanged; code that calls a ROM-internal address
(`JSR $E716`, `JSR $F49E`, etc.) is silently broken on a different
revision. This is the entire point of the jump table.

The C128 in C64 mode uses a separate KERNAL ROM (318020-05) but
exposes the same 39-entry jump table at the same addresses, with
identical semantics — programs that use only the jump table run
unchanged on a C128 in C64 mode.

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
| `$FF87` | RAMTAS  | RAM test, set top/bottom of memory, clear page 0/1/2/3             |
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

Three categorical points are non-obvious from the names:

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

The high-level file I/O surface is a stateful three-step protocol:

1. **Configure** the next file operation with SETLFS (logical file, device,
   secondary address) and SETNAM (filename buffer pointer, length).
2. **Open** the file with OPEN, LOAD, or SAVE.
3. **Use** it: redirect input with CHKIN, redirect output with CHKOUT, read
   with CHRIN / GETIN, write with CHROUT. Reset to defaults with CLRCHN.
4. **Close** with CLOSE or CLALL.

This is the same protocol the BASIC `OPEN`, `PRINT#`, `INPUT#`, and `CLOSE`
statements drive. A machine-language program that wants to open and read
a sequential file from drive 8 does:

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

        lda #2
        jsr $FFC3       ; CLOSE
        jsr $FFCC       ; CLRCHN
        rts

fname:  .byte "FILE,S,R"
fname_end:
```

Three rules trip up first-time KERNAL programmers:

- **SETLFS + SETNAM state survives across calls** until you overwrite it.
  If you call SETLFS once with secondary=2 and then call OPEN a second
  time without calling SETLFS again, the second OPEN will reuse
  secondary=2.
- **CHKIN/CHKOUT require a prior successful OPEN.** They return C=1 +
  error code 3 ("file not open") if the logical file number doesn't
  refer to an open file.
- **CLRCHN must be called before CLOSE.** If you `CLOSE` while CHKIN
  has redirected input to that file, the next CHRIN reads from a
  closed file and returns garbage. Always: `CLRCHN`, then `CLOSE`.

### $FFBA — SETLFS — Set logical file parameters

**Input:** A = logical file number (1-255), X = device number (0-31), Y = secondary address (0-31 or `$FF`)
**Output:** None
**Affects:** None (parameters stored in zero-page workspace `$B8`, `$BA`, `$B9`)
**Pairs with:** SETNAM, OPEN, LOAD, SAVE
**Description:** Stores the three file parameters that the next OPEN, LOAD,
or SAVE will use. The logical file number (A) is a program-chosen tag in the
range 1-255; it appears in subsequent CHKIN/CHKOUT/CLOSE calls to identify
this file. Numbers 1-127 cause LF to be passed verbatim to the device;
128-255 add an implicit linefeed after each carriage return on output.
The device number (X) selects the bus device: 0=keyboard, 1=tape (Datasette),
2=RS-232 (user port), 3=screen, 4-7=printer/plotter, 8-30=IEC disk/printer
units. Secondary address (Y) is device-specific: for the 1541 disk drive,
0=load PRG, 1=save PRG, 2-14=open named channel, 15=command channel, `$FF`
means "no secondary" (used by tape).

### $FFBD — SETNAM — Set filename

**Input:** A = filename length (0-16, longer accepted but truncated by device), X = low byte of filename pointer, Y = high byte of filename pointer
**Output:** None
**Affects:** None (length stored at `$B7`, pointer at `$BB`/`$BC`)
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
**Pairs with:** SETLFS, SETNAM, CLOSE, CHKIN, CHKOUT
**Description:** Opens a logical file using the parameters previously
stored by SETLFS and SETNAM. For disk devices, sends LISTEN +
secondary-address (`$F0 | sec`) over the IEC bus, then sends the
filename bytes one at a time via IECOUT, then UNLISTEN. On success the
KERNAL records the logical file number in its open-file table
(`$0259-$0262` for LF, `$0263-$026C` for device, `$026D-$0276` for
secondary). Errors: 1=too many open files (max 10), 2=file already
open (logical file number reused), 4=file not found (LOAD only),
5=device not present, 6=not input file, 7=not output file. On error
the file is not added to the open-file table.

### $FFC3 — CLOSE — Close a logical file

**Input:** A = logical file number
**Output:** C=0 on success; C=1 on error, A = error code
**Affects:** A, X, Y, C
**Pairs with:** OPEN, CLRCHN
**Description:** Closes the named logical file. For IEC devices, sends
LISTEN + close-secondary (`$E0 | sec`), then UNLISTEN. The KERNAL
removes the entry from its open-file table. Calling CLOSE on a
logical file number that isn't open returns silently (no error). If
the file is currently the active input or output channel, CLOSE does
*not* reset the channel — call CLRCHN first.

### $FFC6 — CHKIN — Redirect input to logical file

**Input:** X = logical file number (must already be OPEN)
**Output:** C=0 on success; C=1 on error, A = error code
**Affects:** A, X, C
**Pairs with:** OPEN, CHRIN, GETIN, CLRCHN
**Description:** Tells the KERNAL that subsequent CHRIN / GETIN calls
should read from the named logical file rather than the keyboard. For
IEC devices, sends TALK + secondary (`$60 | sec`). Errors: 3=file not
open, 6=not input file (the device was opened for write).

### $FFC9 — CHKOUT — Redirect output to logical file

**Input:** X = logical file number (must already be OPEN)
**Output:** C=0 on success; C=1 on error, A = error code
**Affects:** A, X, C
**Pairs with:** OPEN, CHROUT, CLRCHN
**Description:** Tells the KERNAL that subsequent CHROUT calls should
write to the named logical file rather than the screen. For IEC
devices, sends LISTEN + secondary (`$60 | sec`). Errors: 3=file not
open, 7=not output file (the device was opened for read).

### $FFCC — CLRCHN — Reset default I/O channels

**Input:** None
**Output:** None
**Affects:** A, X
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
**Pairs with:** CLRCHN
**Description:** Closes all open logical files at once by zeroing the
KERNAL's open-file count (`$0098`). This does *not* send proper CLOSE
commands to IEC devices — it just discards the KERNAL's open-file
table. CLALL also calls CLRCHN, so default channels are reset. Use
CLALL when you need to reset I/O state from an unknown starting
point (e.g. in an error handler), and accept that any disk-side state
(open relative-file channels with dirty buffers) will be left
dangling until you UNLISTEN. The jump-table entry for CLALL is at
`$FFE7`, despite its conceptual pair with CLOSE.

### $FFD5 — LOAD — Load or verify a file

**Input:** A = 0 to load, 1 to verify; X = low byte of start address (used only if SETLFS Y=0); Y = high byte of start address; SETLFS + SETNAM state required
**Output:** C=0 on success, X+Y = end-address+1 (one past the last byte loaded); C=1 on error, A = error code
**Affects:** A, X, Y, C
**Pairs with:** SETLFS, SETNAM
**Description:** Loads a file from the device specified by SETLFS into
RAM. If the secondary address from SETLFS is 0, the file is loaded at
the address in X/Y (passed in by the caller). If secondary is 1
(non-zero), the file's first two bytes are used as the load address
(this is how `LOAD "FILE",8,1` works in BASIC). On the C64 the load
goes into RAM even where ROM is mapped, because the KERNAL stores
via indirect indexed addressing through page 1 and the CPU writes
always go to RAM. After a successful load, X/Y hold the address
immediately *past* the last byte loaded. With A=1, LOAD compares the
file against memory instead of writing — sets the status byte's "verify
mismatch" bit on differences. Errors: 4=file not found, 5=device not
present, 8=missing filename, 9=illegal device.

### $FFD8 — SAVE — Save memory to file

**Input:** A = zero-page pointer to start address (e.g. A=`$2B` means start = ($2B/$2C) ); X = low byte of end-address+1; Y = high byte of end-address+1; SETLFS + SETNAM state required
**Output:** C=0 on success; C=1 on error, A = error code
**Affects:** A, X, Y, C
**Pairs with:** SETLFS, SETNAM
**Description:** Saves the memory range [start, end+1) to the device.
The start address is read indirectly through the zero-page byte
pointed to by A (the BASIC start-of-program pointer at `$2B/$2C`
is the conventional value, which is why BASIC `SAVE` saves the
current program). The end-address+1 is passed directly in X/Y.
On tape and serial bus the first two bytes written are the load
address (matching the LOAD format), then the data. Errors: 5=device
not present, 8=missing filename, 9=illegal device.

## Character I/O

The C64's character-I/O layer has three entry points: CHROUT for writing,
CHRIN for blocking reads, and GETIN for non-blocking reads. All three
indirect through RAM vectors at `$0326` (BSOUT), `$0324` (CHRIN), and
`$032A` (GETIN) — patching those vectors hooks every character that
flows through the KERNAL.

### $FFD2 — CHROUT — Output a character

**Input:** A = PETSCII byte to print
**Output:** None
**Affects:** A (preserved on success), C
**Pairs with:** CHKOUT, CLRCHN
**Description:** Writes one byte to the current output channel (screen
by default; a logical file if CHKOUT was called). The byte is
interpreted as PETSCII: printable codes (`$20-$5F`, `$60-$7F`,
`$A0-$FF`) display the corresponding character; control codes do
their named action — `$0D` = carriage return, `$11` = cursor down,
`$13` = home, `$14` = delete, `$93` = clear screen, `$05/$1C/$1E/$1F/$81/$90/$95/$9F` etc.
= color changes, `$0E` = lower/upper case, `$8E` = upper/graphics
case. When writing to the screen, CHROUT *does* modify VIC-II state:
PETSCII `$0E` and `$8E` write to `$D018` to switch the character
ROM source between charset 1 and charset 2; color changes write to
the current-color zero-page byte at `$0286`. To suppress these side
effects, write directly to screen RAM (`$0400`) and color RAM
(`$D800`) instead. A and the carry flag are conventionally preserved
on success.

### $FFCF — CHRIN — Read a character (blocking)

**Input:** None (current input channel must be set; default is keyboard)
**Output:** A = PETSCII byte read; C=0 on success, C=1 on error
**Affects:** A, X, Y, C
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

**Input:** None
**Output:** A = PETSCII byte (0 if no byte available); C=0 on success
**Affects:** A, X, Y, C
**Pairs with:** CHKIN, SCNKEY, STOP
**Description:** Returns immediately. With the default keyboard
channel, GETIN reads one byte from the keyboard queue (`$0277-$0280`)
maintained by the IRQ handler; if the queue is empty, A=0. With an
IEC device active (after CHKIN), GETIN behaves like CHRIN — it
*does* block on the bus, because the IEC protocol has no peek-ahead.
The non-blocking property only applies to the keyboard. GETIN is
the standard primitive for game loops and any code that must remain
responsive while polling input.

## Screen and cursor

### $FFED — SCREEN — Read screen dimensions

**Input:** None
**Output:** X = number of columns, Y = number of rows
**Affects:** X, Y
**Pairs with:** PLOT
**Description:** Returns the physical dimensions of the screen. On a
stock C64 this is always X=40, Y=25. The routine exists so that
programs targeting the whole Commodore-8-bit family (which includes
80-column machines like the C128) can adapt to the screen they're
running on without hard-coding 40x25.

### $FFF0 — PLOT — Get or set cursor position

**Input:** C=0 to set: X = row (0-24), Y = column (0-39); C=1 to read: input ignored
**Output:** With C=1 on entry: X = row, Y = column
**Affects:** A, X, Y
**Pairs with:** CHROUT, SCREEN
**Description:** Reads or writes the cursor position used by the
screen editor. With C=1 (read mode), returns the current row in X
and current column in Y. With C=0 (write mode), moves the cursor
to the supplied row/column. PLOT does not draw anything; it just
positions the cursor so the next CHROUT writes there. Note the
unusual axis order: X holds the *row* (0-24) and Y holds the
*column* (0-39), which is the opposite of typical (x,y) plotting
conventions.

### $FF81 — CINT — Initialize screen editor

**Input:** None
**Output:** None
**Affects:** A, X, Y
**Pairs with:** IOINIT, RAMTAS
**Description:** Performs the screen-editor portion of the cold-start
sequence: programs the VIC-II registers for 25-row x 40-column text
mode, sets screen RAM to `$0400-$07E7` and color RAM to `$D800-$DBE7`,
fills screen with `$20` (space) and color RAM with the current
foreground color, sets the cursor to row 0 column 0, sets all
keyboard-tables pointers (`$028F-$0290`, `$F5/$F6`) to their KERNAL
defaults, and initializes the IRQ-driven keyboard queue. CINT is
called once at power-on after RAMTAS and IOINIT. Applications can
re-invoke it to recover from screen corruption (e.g. after a wild
write to `$D000` zeroed half the VIC registers), but doing so
overwrites screen and color RAM.

## Stop key

### $FFE1 — STOP — Test the RUN/STOP key

**Input:** None
**Output:** Z=1 if RUN/STOP currently down (and was pressed since last STOP call), Z=0 otherwise; A = `$7F` if pressed, else unchanged
**Affects:** A, Z
**Pairs with:** GETIN, UDTIM
**Description:** Reads the STOP-key flag (zero page `$91`, set by the
IRQ-driven keyboard scan to `$7F` when STOP is in the bottom row of
the matrix) and returns Z=1 if STOP is currently pressed. The
canonical interruptible-loop pattern is:

```asm
loop:   jsr $FFE1       ; STOP
        beq abort       ; Z=1 means STOP pressed
        ; ... work ...
        jmp loop
abort:  ; restore state, exit
        rts
```

STOP reads `$91`, not the keyboard matrix directly, so it depends on
the IRQ handler running. If the user has disabled IRQs (`SEI` without
re-enabling), STOP will never return Z=1. To make STOP work in an
IRQ-disabled context, call SCNKEY (`$FF9F`) inside the loop. STOP
also serves a secondary purpose in some KERNAL routines: when called
from inside disk I/O, it aborts the operation, and when called from
the cassette routines, it aborts the tape transfer.

## Time and jiffy clock

The C64 maintains a 24-bit "jiffy clock" — a counter of `1/60`-second
ticks (1/50 in PAL territory, despite the name) that wraps every
24 hours. The counter lives at `$A0/$A1/$A2` (high/mid/low byte) and
is incremented by UDTIM, which is called from the IRQ handler every
jiffy. BASIC exposes the counter via the `TI` (numeric) and `TI$`
(string `HHMMSS`) reserved variables.

### $FFDB — SETTIM — Set the jiffy clock

**Input:** A = jiffy-clock high byte (will go to `$A0`), X = mid byte (`$A1`), Y = low byte (`$A2`)
**Output:** None
**Affects:** None (writes `$A0`, `$A1`, `$A2`)
**Pairs with:** RDTIM, UDTIM
**Description:** Stores the supplied 24-bit value into the jiffy-clock
counter. Note the high-byte-first ordering, which is opposite the
6502's natural little-endian. This is the routine that BASIC's
`TI$ = "000000"` translates to. SETTIM disables IRQs while writing
the three bytes, so the IRQ handler can't see a half-updated value.

### $FFDE — RDTIM — Read the jiffy clock

**Input:** None
**Output:** A = high byte, X = mid byte, Y = low byte
**Affects:** A, X, Y
**Pairs with:** SETTIM, UDTIM
**Description:** Reads the three-byte jiffy counter and returns it in
A/X/Y (high/mid/low). Disables IRQs during the read so the value is
atomic. For a millisecond-ish elapsed-time stopwatch, call RDTIM
twice and subtract; one jiffy = 1/60 s NTSC or 1/50 s PAL.

### $FFEA — UDTIM — Increment jiffy clock + check STOP

**Input:** None
**Output:** None
**Affects:** A, X
**Pairs with:** RDTIM, SETTIM, STOP
**Description:** Increments the 24-bit jiffy-clock counter at
`$A0/$A1/$A2` by one. Wraps to zero after `$4F1A00` (24 hours of
1/60 s ticks) or `$4A6800` (24 hours of 1/50 s ticks; KERNAL uses
the NTSC constant unless explicitly told otherwise, so PAL drifts
slightly). UDTIM also reads the keyboard-matrix row that contains
the STOP key (column at port `$DC00`, row at port `$DC01`) and
sets `$91` to `$7F` if STOP is pressed, which is what makes the
STOP routine work. UDTIM is called from the IRQ handler at `$EA31`
every jiffy — if you replace the IRQ vector with your own code,
you must `JSR $FFEA` somewhere in your handler or the jiffy clock
and STOP will freeze.

## Memory

The two memory routines manipulate the KERNAL's notion of where RAM
starts and ends. They share a unified read/write convention:
**carry-flag = direction**. C=0 means "write the supplied value into
the KERNAL pointer"; C=1 means "read the current value into the
return registers".

### $FF99 — MEMTOP — Read or set top of RAM

**Input:** C=1 to read (input ignored); C=0 to set, X = low byte, Y = high byte of new top
**Output:** With C=1: X = low byte, Y = high byte of current top
**Affects:** A, X, Y
**Pairs with:** MEMBOT, RAMTAS
**Description:** Reads or writes the KERNAL's top-of-memory pointer,
stored at `$0283-$0284`. On a stock 38911-byte BASIC system, the
default value is `$A000` (`$00`/`$A0`) — BASIC strings grow downward
from this address, and BASIC's free-memory message reports
`top - vartab`. Lowering MEMTOP reserves a block at the top of RAM
that BASIC will not touch; for example, setting it to `$C000` keeps
the 4 KiB at `$C000-$CFFF` free for machine-language code that
coexists with BASIC. Most programs use this protect-from-BASIC
mechanism by writing MEMTOP early in their startup. Note that
lowering MEMTOP does *not* shrink memory available to ML programs;
it only signals BASIC to stay below the new ceiling.

### $FF9C — MEMBOT — Read or set bottom of RAM

**Input:** C=1 to read (input ignored); C=0 to set, X = low byte, Y = high byte of new bottom
**Output:** With C=1: X = low byte, Y = high byte of current bottom
**Affects:** A, X, Y
**Pairs with:** MEMTOP, RAMTAS
**Description:** Reads or writes the KERNAL's bottom-of-memory
pointer, stored at `$0281-$0282`. The default value is `$0800`,
placing the bottom of the BASIC text area at `$0801` (the byte at
`$0800` is a required zero terminator). Raising MEMBOT reserves a
block at the bottom of RAM for non-BASIC use. Setting MEMBOT does
*not* relocate the existing BASIC program; if BASIC has already
loaded a program, you must move it manually. Application programs
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
vectors and other related state.

### $FF84 — IOINIT — Initialize I/O chips

**Input:** None
**Output:** None
**Affects:** A, X, Y
**Pairs with:** CINT, RAMTAS, RESTOR
**Description:** Initializes the two CIA chips (sets DDRs, programs
Timer A on CIA1 for the 60/50 Hz jiffy IRQ), initializes the SID
(silences all three voices), sets the IEC bus lines to idle, and
clears the CIA interrupt-control registers. Called once at power-on
between RAMTAS and CINT. Application code can call IOINIT to recover
from chip-state corruption, but doing so will silence any in-progress
sound and reset the keyboard-scan IRQ rate to the KERNAL default.

### $FF87 — RAMTAS — RAM test and clear

**Input:** None
**Output:** None
**Affects:** A, X, Y
**Pairs with:** IOINIT, CINT, MEMTOP, MEMBOT
**Description:** Performs the RAM-test portion of cold start: walks
through each page from `$0800` upward writing `$55` then `$AA` then
reading back, until it finds a page that doesn't echo back the
written value, which becomes the top-of-RAM. Zeroes pages 2 and 3
(`$0200-$03FF`, including the BASIC input buffer and the screen-editor
work area), sets MEMTOP to the discovered top and MEMBOT to `$0800`,
clears the cassette buffer at `$033C-$03FB`. RAMTAS is destructive
and is normally called only at power-on. Calling it from a running
program will erase the BASIC input buffer and the open-file table.

### $FF8A — RESTOR — Restore default vectors

**Input:** None
**Output:** None
**Affects:** A, X, Y
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
**Pairs with:** RESTOR
**Description:** Block-copies the 16 RAM vectors between memory and
the KERNAL's vector area at `$0314-$0333`. With C=1, copies *from*
the vector area into the supplied buffer (snapshot the current vector
state). With C=0, copies *into* the vector area from the supplied
table (install a complete vector set in one call). Typical use:
snapshot with C=1, patch one or two entries, install with C=0 — but
in practice it's cheaper to just write the two bytes of the one
vector you care about directly to `$0326`/`$0327` etc.

### $FF90 — SETMSG — Set KERNAL message verbosity

**Input:** A = message-control bits (bit 7 = print KERNAL error messages, bit 6 = print KERNAL control messages like "SEARCHING", "LOADING", "PRESS PLAY ON TAPE")
**Output:** None
**Affects:** None (stores A at `$009D`)
**Pairs with:** OPEN, LOAD, SAVE
**Description:** Controls whether the KERNAL prints status messages
to the screen during file operations. A=`$80` (bit 7 only) enables
error messages but suppresses control messages — useful when an
application wants to handle "press play on tape" prompts itself.
A=`$C0` enables both (the default for BASIC). A=`$00` suppresses
everything — useful for headless tools that drive the KERNAL from
machine code and don't want stray text appearing on screen.

## IEC bus low-level

The eight routines in this section drive the C64's serial IEC bus
directly, byte by byte. Most application code never calls them
because OPEN/CLOSE/LOAD/SAVE wrap them, but custom bus protocols
(fast loaders, IEEE-488 adapters, custom drive commands) use them.

The IEC protocol is a five-state sequence:

1. **LISTEN/TALK** sends a device-address byte with the ATN line low
   to announce which device is being addressed.
2. **SECOND/TKSA** sends a secondary-address byte (still with ATN
   low) — typically a file-channel number on disk drives, or a
   format command.
3. **IECOUT/IECIN** transfers data bytes one at a time, with ATN
   high — IECOUT writes (after LISTEN+SECOND), IECIN reads (after
   TALK+TKSA).
4. **UNLSN/UNTLK** ends the transfer by releasing the bus.

### $FFB1 — LISTEN — Send LISTEN command

**Input:** A = device number (0-31)
**Output:** None (status byte set on error)
**Affects:** A
**Pairs with:** SECOND, IECOUT, UNLSN
**Description:** Sends the LISTEN command byte (`$20 | device`) on
the IEC bus with the ATN line asserted. After LISTEN, all subsequent
data sent via IECOUT goes to the addressed device until UNLSN is
sent. The status byte (READST) is set to `$80` if the device does
not acknowledge — device not present. Internally the routine
manipulates the data line (`$DD00` bit 5), clock line (`$DD00`
bit 4), and ATN line (`$DD00` bit 3) of CIA2 port A to drive the
serial bus signals; on a real C64 the entire byte takes about
1 ms. Multiple LISTEN commands can be sent in sequence to address
multiple listeners simultaneously, but only one device can talk
at a time. The device argument is just the device number 0-30;
the `$20 | device` encoding is done internally.

### $FFB4 — TALK — Send TALK command

**Input:** A = device number (0-31)
**Output:** None (status byte set on error)
**Affects:** A
**Pairs with:** TKSA, IECIN, UNTLK
**Description:** Sends the TALK command byte (`$40 | device`) on the
IEC bus with ATN asserted. After TALK, the addressed device becomes
the bus talker, and the C64 will receive its data via IECIN until
UNTLK is sent. Status byte set to `$80` on no-acknowledge. Only one
device on the bus can be the talker at any time, so a TALK command
implicitly silences any previous talker. After the TALK byte goes
out, the routine releases ATN and the device begins to drive the
data line; the first IECIN call then reads the first byte the
device produces. If you want to read from a specific channel of a
disk drive (e.g. the error channel at secondary 15), follow TALK
with TKSA.

### $FF93 — SECOND — Send secondary address after LISTEN

**Input:** A = secondary-address byte (typically `$60 | channel` for open channel, `$F0 | channel` to open a file, `$E0 | channel` to close)
**Output:** None
**Affects:** A
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
**Pairs with:** TALK, IECIN
**Description:** Sends a secondary-address byte after a TALK, same
encoding as SECOND. Use TKSA to tell the talking device which
channel to read from. Like SECOND, keeps ATN asserted during the
byte to mark it as a command.

### $FFA5 — IECIN — Receive one byte from serial bus

**Input:** None (TALK + TKSA must have been called)
**Output:** A = byte received; status byte updated on EOI / error
**Affects:** A
**Pairs with:** TALK, TKSA, UNTLK, READST
**Description:** Clocks one byte off the IEC bus from the currently
talking device. On the last byte of a transfer (EOI), the device
holds the data line low for an extended period before the eighth
bit; the KERNAL detects this and sets status byte bit 6 (`$40`).
Call READST after each IECIN to detect EOI and error conditions
(`$01` = timeout writing, `$02` = timeout reading, `$80` = device
not present). Historical name: ACPTR.

### $FFA8 — IECOUT — Send one byte to serial bus

**Input:** A = byte to send
**Output:** None (status byte updated on error)
**Affects:** None (A preserved)
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
**Pairs with:** TALK, TKSA, IECIN
**Description:** Sends the UNTALK command (`$5F`) with ATN
asserted. The current talking device, if any, releases the data
line and the bus returns to idle. The command is broadcast, so
all listeners and the (single) talker simultaneously hear it; the
talker stops talking, the listeners stop listening for that
talker. Use UNTLK to end a TALK transaction. Calling UNTLK with
no active talker is harmless — the command is sent to all
devices but none act on it.

### $FFAE — UNLSN — Send UNLISTEN

**Input:** None
**Output:** None
**Affects:** A
**Pairs with:** LISTEN, SECOND, IECOUT
**Description:** Sends the UNLISTEN command (`$3F`) with ATN
asserted. All bus-listening devices stop receiving data. Use
UNLSN to end a LISTEN transaction. On a disk drive, UNLSN with
secondary `$F0` (file-open) pending tells the drive to finalize
the OPEN — the drive parses the filename it received since
LISTEN+SECOND, locates the file, and is ready for subsequent
IECIN/IECOUT against the opened channel. Without UNLSN the
drive doesn't know the filename is complete and won't open the
file. This is why OPEN always ends with UNLSN even though no
filename byte follows.

### $FFB7 — READST — Read serial bus status

**Input:** None
**Output:** A = status byte (alias for the zero-page `$90` ST byte)
**Affects:** A
**Pairs with:** IECIN, IECOUT, CHRIN, CHROUT
**Description:** Reads and clears the KERNAL's serial-bus status
byte. Bit values:

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
**Pairs with:** GETIN, STOP
**Description:** Scans the 8x8 keyboard matrix via CIA1 ports A
and B, decodes the pressed key against the current keyboard table
(four tables: unshifted, shifted, Commodore-shifted, control), and
pushes the resulting PETSCII byte into the keyboard queue. SCNKEY
also detects shift-key state and updates the STOP-key flag at
`$91`. It is called from the IRQ handler at `$EA31`; an application
that disables IRQs must call SCNKEY manually if it wants the
keyboard queue and the STOP key to keep working.

### $FFA2 — SETTMO — Set IEEE timeout flag

**Input:** A = timeout flag (bit 7 = enable timeouts)
**Output:** None
**Affects:** None
**Pairs with:** READST
**Description:** On the C64 this routine is a no-op. It exists for
source compatibility with the PET, where it controlled the timeout
behavior of the IEEE-488 bus. The C64's IEC serial bus has its own
fixed timeout logic that cannot be disabled. Code can call SETTMO
without effect; the routine just returns. The C64 ROM does contain
a SETTMO entry point for compatibility with code originally written
for the VIC-1541 IEEE adapter and PET — on those machines the
input A controls whether the bus driver times out after about 64 ms
or waits forever. On a stock C64 with only IEC devices, the
timeouts are wired in: the KERNAL's IEC driver gives up after
about 64 ms of clock-low time and sets the status byte to `$02`
(read timeout) or `$01` (write timeout). Reading READST after a
suspicious IECIN/IECOUT is the C64 substitute for SETTMO.

### $FFF3 — IOBASE — Get I/O block base address

**Input:** None
**Output:** X = low byte, Y = high byte of I/O base (always `$00`/`$DC` on C64)
**Affects:** X, Y
**Pairs with:** SCREEN
**Description:** Returns the base address of the I/O block, which
on the C64 is always `$DC00` (the start of CIA1). Self-relocating
code that wants to address CIAs / SID / VIC-II by offset from
this base can use IOBASE so that it remains portable to other
Commodore machines where the I/O block lives elsewhere. On the
C64 the value is fixed in ROM and never changes. The original
intent was to let one program binary run on C64, C128, B-series,
and Plus/4 by replacing all `LDA $DC00` constants with
`LDY ($IOBASE_VEC),Y` indirect-Y addressing through an
IOBASE-derived pointer. In practice almost no C64 software
took advantage — the I/O addresses are so deeply hard-coded
in tutorials and listings that compatibility was lost long
before IOBASE was needed.

## Pairs and contracts

KERNAL routines compose into stateful sequences. The graph below
captures which calls must precede which.

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

Each step is independent — the KERNAL doesn't enforce ordering — but
skipping or reordering creates predictable bugs:

- **Skipping SETLFS before OPEN** uses stale parameters from the
  previous SETLFS call. Calling OPEN twice in a row will reuse the
  last set of parameters, which is usually wrong.
- **Skipping SETNAM** is legal for some devices (printer, screen,
  tape with no name) but produces error 8 ("missing filename") for
  disk OPENs that need a filename.
- **CHRIN/CHROUT without CHKIN/CHKOUT** acts on the default channel
  (keyboard in, screen out). This is sometimes intentional, but it's
  a frequent bug when programmers forget that CHKIN/CHKOUT are
  required to redirect.
- **CLOSE without CLRCHN** leaves the channel selected as the active
  input or output. The next CHRIN/CHROUT will operate on a
  freshly-closed file and fail. Always: CLRCHN, then CLOSE.

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

RESTOR is the brute-force option. If your program patched only the
IRQ vector, RESTOR is fine. If something else (e.g. a wedge that
patched IBSOUT to filter screen output) was already running, RESTOR
will erase its patches too.

### Time-clock pairing

`SETTIM`/`RDTIM` operate on the three-byte counter that `UDTIM`
increments. Programs that disable IRQs and then read the jiffy clock
will see a frozen value; either re-enable IRQs or call UDTIM manually
inside the critical section to keep the counter advancing.

### Cold-start / warm-start sequence

The KERNAL's reset vector (`$FFFC`) points at the cold-start routine
that runs this sequence:

```
RESET → STX $D016         ; harmless write to anchor the stack
      → JSR $FDA3 (IOINIT)
      → JSR $FD50 (RAMTAS)
      → JSR $FD15 (RESTOR)
      → JSR $FF5B (CINT)
      → JMP ($A000)       ; cold-start BASIC
```

In jump-table terms: IOINIT → RAMTAS → RESTOR → CINT, then jump to
BASIC. An application that wants to restart "from scratch" without
a hard reset can call the same four routines (in the same order)
followed by `JMP $A000` (or its own entry point).

### Status-byte interaction with file I/O

Every file-I/O routine that touches the IEC or cassette bus updates
the status byte at `$90`. Reading the status byte via READST is the
*only* reliable way to detect end-of-file and bus errors — the
carry flag returned from CHRIN/CHROUT/IECIN/IECOUT signals only
"could not complete this operation", not "end of file".

The canonical end-of-file read loop:

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
become set until the byte *after* EOI, by which point you've
already read past end-of-file. Always test READST, not carry, for
end-of-file.

### Worked examples

These are complete, runnable snippets that show the canonical
KERNAL call sequences. All examples assume the assembler's
default segment starts somewhere safe (e.g. `$0801` with a BASIC
SYS stub, or `$C000` for a standalone ML program).

#### Reading the disk error channel

A common "is my disk command happy?" check — open the command
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
key keep working.

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
        lda $D019       ; ack VIC IRQs
        sta $D019
        jsr $FFEA       ; UDTIM — keep jiffy clock + STOP working
        jmp (old_irq_target)
old_irq_target = $EA31  ; default KERNAL IRQ entry, or use stashed vector
old_lo: .byte 0
old_hi: .byte 0
```

#### Polling input non-blocking in a game loop

The canonical game-loop input pattern:

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
iteration. This is the same loop structure BASIC programs use
when they alternate between `GET A$` and game logic, except in
ML it runs hundreds of times faster.

#### Reading the jiffy clock for timing

A simple "wait 30 jiffies" delay using RDTIM:

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
subtraction. Note that RDTIM reads atomically (with IRQs briefly
disabled), so the three bytes are always consistent.

### Pair-with notation

The `**Pairs with:**` lines on each routine identify routines that
typically appear together in correct code. The pairing has three
flavors:

- **Setup pairing** — must call routine X before routine Y for Y
  to have valid input (e.g. SETLFS pairs with OPEN; LISTEN pairs
  with IECOUT).
- **Cleanup pairing** — must call routine X after routine Y to
  release state (e.g. CLRCHN pairs with CHKIN/CHKOUT; UNLSN
  pairs with LISTEN+IECOUT).
- **Symmetric pairing** — routines that read and write the same
  state (e.g. MEMTOP and RAMTAS; SETTIM and RDTIM).

The graph extractor reads these lines and produces `PAIRS_WITH`
edges in the knowledge graph, so a developer asking "what do I
need to call before OPEN?" can navigate from OPEN to its
SETLFS+SETNAM dependencies in one query.

## Pitfalls

- **CHROUT modifies VIC-II state.** Writing PETSCII `$0E` (charset 2
  / lower case) or `$8E` (charset 1 / upper-graphics) causes CHROUT
  to write to `$D018`, changing the character ROM source. If your
  program has set up a custom bitmap or a charset other than the
  KERNAL defaults, sending a `$0E` or `$8E` byte will revert it.
  Color-code PETSCII bytes (`$05`, `$1C`-`$1F`, `$81`, `$90`-`$9F`)
  similarly write to the current-color zero-page byte at `$0286` and
  change the foreground color of subsequent character writes. To
  send a literal `$0E` to a file (e.g. when dumping binary to disk),
  use IECOUT directly rather than CHROUT after CHKOUT.

- **CHKIN/CHKOUT require a prior successful OPEN.** They return
  C=1 + error code 3 ("file not open") if the logical file isn't
  in the open-file table. A common pattern bug is to call OPEN,
  check carry, jump to error on failure, then unconditionally call
  CHKIN on the (un-opened) logical file — which then fails with
  the misleading error 3. Always re-check carry after each
  KERNAL call.

- **CHKOUT to a read-only file returns error 7, not silent failure.**
  If you OPEN a disk file with secondary 2 to read (the disk drive
  treats `,R` as read-only) and then call CHKOUT on it, you'll get
  error 7. Use CHKIN instead.

- **CLOSE without CLRCHN leaves a dangling channel.** Subsequent
  CHRIN/CHROUT will read/write to a closed file's slot. Symptoms:
  garbage bytes, frozen reads, status byte not updating. The cure
  is unconditional: `JSR $FFCC` (CLRCHN) immediately after every
  CHRIN/CHROUT loop, before any CLOSE.

- **CLALL doesn't tell IEC devices to close.** Unlike CLOSE, CLALL
  just zeros the KERNAL's open-file table. Disk-side state (channel
  buffers, dirty relative-file blocks) is left untouched until the
  device sees an UNLISTEN. After CLALL, if you re-OPEN a file
  with the same secondary on the same device, the drive may return
  stale data from the abandoned channel.

- **LOAD destination is X/Y on the call, but X/Y on return mean
  end-address.** A programmer who calls LOAD then expects X/Y to
  still hold the load address will see the value after the last
  byte loaded — often 65535-ish for a long load that fills memory
  to the top. The output-X/Y convention is *end-address + 1*, so
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
  `$7F` if the IRQ handler has been calling SCNKEY each jiffy. In
  an SEI-protected critical section, STOP will never trigger. To
  make STOP work inside SEI code, call SCNKEY explicitly inside
  your loop.

- **UDTIM is required by STOP.** If you install a custom IRQ
  handler that doesn't `JSR $FFEA`, the jiffy clock will stop and
  the STOP-key detection will stop working as a side effect (since
  STOP reads `$91`, which UDTIM updates via the keyboard-row read
  buried in its code).

- **PAL machines drift on TI$.** The KERNAL uses the same constants
  for the jiffy-clock wrap regardless of region. On PAL machines
  the clock ticks at 50 Hz but wraps at the NTSC-calibrated 24-hour
  value, so `TI$` slowly drifts behind wall-clock time. For
  accurate timing on PAL, use a CIA timer A in 50 Hz mode and
  ignore TI$.

- **GETIN blocks on IEC.** Only the keyboard channel makes GETIN
  non-blocking. After a CHKIN to an IEC device, GETIN waits for a
  byte from the bus just like CHRIN does. If you need a polling
  read from a disk file, you must implement timeouts yourself
  using a CIA timer.

- **SECOND/TKSA encoding is non-obvious.** The secondary-address
  byte is not just the secondary number — it's `$60 | sec` for an
  open channel, `$F0 | sec` for open-file, `$E0 | sec` for close.
  Passing the raw secondary number to SECOND will address the
  wrong command bits.

- **IOBASE on the C64 is always `$DC00`.** Code that uses IOBASE
  to access VIC-II (`$D000-$D02E`) or SID (`$D400-$D41C`) needs to
  subtract from `$DC00`, not add. The convention exists for C128
  / PET compatibility where I/O lives at different addresses, but
  on the C64 the offset arithmetic is non-trivial.

- **SETTMO is a no-op.** It accepts a parameter and returns. If
  you're chasing a real timeout misbehavior on the IEC bus, SETTMO
  isn't the answer — the C64's bus timeouts are wired in and
  cannot be changed from software. The right fix is usually
  retrying the operation after the status byte reports `$01`
  (write timeout) or `$02` (read timeout).

- **MEMTOP doesn't protect RAM from ML code.** Lowering MEMTOP
  only tells BASIC to stay below the new ceiling. Direct
  pokes from ML, including the KERNAL's own LOAD into RAM
  beyond MEMTOP, ignore it. To truly protect RAM from
  KERNAL+BASIC, you must also avoid `LOAD` calls that would
  span the protected region.

- **MEMBOT doesn't relocate the BASIC program.** Raising MEMBOT
  after BASIC has loaded a program leaves the program at the
  old address; BASIC will then misread its own start pointer.
  Set MEMBOT before BASIC loads anything (or before any
  CHRGET-based BASIC operation runs), or accept that you must
  also move the program manually.

- **RAMTAS is destructive.** Never call RAMTAS from a running
  program unless you want to lose the BASIC input buffer,
  the cassette buffer at `$033C-$03FB`, and the open-file
  table. The cold-start sequence calls RAMTAS exactly once,
  before any application state exists.

- **CINT clears the screen.** Calling CINT from an application
  will fill screen RAM with spaces and color RAM with the
  current foreground color. If you need to re-init the VIC-II
  for text mode without clearing the screen, write to the
  VIC-II registers directly rather than calling CINT.

- **VECTOR with C=0 installs all 16 vectors.** Don't use VECTOR
  to patch one vector — pointing the supplied table at random
  memory will overwrite the other 15 KERNAL vectors with
  garbage and crash the machine on the next IRQ. Patch single
  vectors by writing directly to `$0314`-`$0333`.

- **SETMSG bit 7 alone suppresses control messages but allows
  errors.** A `$80` value is the standard "no chatty messages
  but tell me about real errors" setting for applications.
  `$C0` is the default BASIC-style verbose setting. `$00` is
  silent — the KERNAL will not print anything during file
  operations even if the device is missing, so the
  application must check carry/status itself.

- **The fast-load problem.** The KERNAL's IEC bus protocol is
  notoriously slow — about 400-800 bytes/sec on a 1541. Every
  successful commercial fast-loader (Action Replay, Final
  Cartridge, Krakout, JiffyDOS, Epyx Fastload, etc.) replaces
  the KERNAL's IECIN/IECOUT bit-banging with custom code that
  uploads a small handler to the drive's 6502 and uses
  non-standard line timing for 5-15x speedup. Such fast-loaders
  typically patch IBSOUT, ILOAD, and ISAVE vectors to call into
  the cartridge code. After running with a fast-loader cart,
  vector state is non-default and RESTOR is necessary before
  removing the cartridge or returning to BASIC.

- **CHKIN on the screen returns success silently.** CHKIN on
  device 3 (screen) succeeds with C=0 but then CHRIN returns
  the screen contents at the cursor row, byte by byte, in a
  PETSCII-encoded form. This is the legacy "read the screen as
  if it were input" mechanism that early Commodore BASIC used
  to implement the screen editor. Modern code that accidentally
  invokes this by re-using a logical file number tied to the
  screen sees mysterious "input" arriving from nowhere.

- **A logical-file collision is a silent error in some calls.**
  OPEN with a logical file number that is already open returns
  error 2 ("file already open"). But CLOSE on a logical file
  that is not open returns C=0 (success). This asymmetry can
  mask state bugs — a CLOSE that should report "wasn't open"
  silently succeeds. The cure is to track open-file state in
  the application rather than relying on the KERNAL to detect
  double-closes.

- **Zero-page locations the KERNAL routines use.** Many KERNAL
  routines use specific zero-page bytes as workspace. Programs
  that themselves use the same zero-page locations and call
  the KERNAL between writes will see their values clobbered.
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
  (`$D1-$F2`) are particularly aggressive — calling CHROUT
  modifies a dozen of them.

- **Banking and KERNAL calls.** KERNAL ROM is mapped in at
  `$E000-$FFFF` only when `$01` bit 1 (HIRAM) is set. When
  HIRAM is cleared (e.g. to expose the underlying RAM at
  `$E000-$FFFF`), KERNAL jump-table calls become "JMP to
  whatever's in RAM at `$FFD2`" — typically garbage. The
  conventional pattern is to save `$01`, set HIRAM, call the
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
  programming that drives the 60/50 Hz IRQ that calls UDTIM.
  See [vic-ii-reference.md](vic-ii-reference.md) for the
  `$D018` register that CHROUT writes when processing PETSCII
  case-toggle bytes (`$0E`, `$8E`).

<!-- doc-type: hardware-reference -->
