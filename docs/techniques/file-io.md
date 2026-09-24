---
category: io
---

<!-- doc-type: technique-reference -->

# File I/O Techniques

Reading and writing files on a serial-bus disk drive through the KERNAL's
logical-file layer: SETLFS, SETNAM, OPEN, the CHKIN/CHKOUT redirection
pair, CHRIN/CHROUT, READST, CLRCHN, CLOSE and LOAD. The register
contracts for each routine are in `hardware/kernal-routines-reference.md`;
the drive-side command set and the secondary-address table are in
`formats/iec-disk-reference.md`; the KERNAL's failure modes are in
`pitfalls/kernal-and-io.md`. Every number below that came from an
instrument says so. The instrument was VICE 3.10 x64sc with true drive
emulation of a 1541 (the `-default` configuration) and a disk freshly
formatted by c1541; a real 1541 was not on the bench.

Two facts run through every technique below. First, a disk OPEN does not
report drive-side errors: OPEN returns C=0 for a name that is not on the
disk (measured: OPEN of `SCORES,S,R` on an empty disk returned C=0,
CHKIN C=0, and the first CHRIN left ST = `$42`) and for a write to a
name that already is (measured, see error_channel_check); only the
drive's error channel knows. Second, the
KERNAL talks to the drive at the bus's own pace, so these calls take
real time. The recipe below spends 4,846,078 cycles on the drive for a
32-byte write, a 32-byte read and two status reads, about 4.9 s at PAL
speed (measured with a CIA2 timer inside the program; rung 1).

The KERNAL's serial routines also take two units while they run, and
every technique below claims them as `shares`: the serial bus (`$DD00`
bits 3-5) and CIA1 timer B, which times each byte's handshake. A
`claims-watch.ts` store trace (VICE x64sc, `--all-ram`) counted, from
ROM, 314 stores to `$DC07`/`$DC0F` and 2,514 to `$DD00` in the
KickAssembler round trip below, and 8,438 and 63,448 in
`recipes/oscar64/load-asset-runtime.md`, whose LOAD is received at
`$EE22`. A program that keeps its own use of timer B loses it across
any disk call (`hardware/kernal-routines-reference.md`, "CIA1 timer B").

---

## kernal_file_write_seq — Write a sequential file with OPEN/CHKOUT/CHROUT

**Complexity:** low
**Region:** both
**Uses registers:** (none)
**Uses kernal:** SETLFS, SETNAM, OPEN, CHKOUT, CHROUT, CLRCHN, CLOSE
**Claims:** serial_bus (shares), cia1_timer_b (shares)
**Claims basis:** measured-vice

### Why

A game that keeps a high-score table, a save slot or a level editor's
output needs to put a run of bytes on a disk under a name, and get the
same bytes back later. The KERNAL's sequential-file protocol does that
with seven calls and no drive code of its own. It is the same path
BASIC's `OPEN 2,8,2,"NAME,S,W"` / `PRINT#2` / `CLOSE 2` takes.

### How

1. SETLFS with A = any logical file number from 1 to 127,
   X = 8 for the first drive, Y = a secondary address from 2 to 14. The
   secondary address is the drive's channel number; 0 and 1 are LOAD and
   SAVE, 15 is the command channel.
2. SETNAM with the length and address of the name string. The suffix
   `,S,W` names the type (sequential) and the mode (write). The string is
   not copied: it must still be there when OPEN runs.
3. OPEN. Test the carry: C=1 with A = 1, 2, 5 or 6 is a KERNAL-side
   refusal (table full, number already open, no device, number 0). C=0
   says nothing about the drive.
4. CHKOUT with X = the logical file number. From here every CHROUT byte
   goes to the file instead of the screen.
5. CHROUT once per byte. A sequential file is byte-transparent: `$00`
   and `$0D` go in and come back unchanged (measured: the recipe's
   payload contains both).
6. CLRCHN, then CLOSE. CLRCHN first: it sends UNLISTEN and puts CHROUT
   back on the screen; CLOSE then tells the drive to finish the file.
   The other order leaves output pointed at a closed file.

```asm
// kernal_file_write_seq: create SCORES as a SEQ file and write 32 bytes
.const SETLFS = $ffba
.const SETNAM = $ffbd
.const OPEN   = $ffc0
.const CLOSE  = $ffc3
.const CHKOUT = $ffc9
.const CLRCHN = $ffcc
.const CHROUT = $ffd2

* = $c000
write_scores:
    // scratch any old copy first: the command goes out as OPEN's filename
    lda #15
    ldx #8
    ldy #15                      // secondary 15 = command channel
    jsr SETLFS
    lda #scr_end-scr
    ldx #<scr
    ldy #>scr
    jsr SETNAM
    jsr OPEN                     // sends S0:SCORES to the drive
    lda #15
    jsr CLOSE

    lda #2                       // logical file 2
    ldx #8                       // device 8
    ldy #2                       // secondary 2..14 = a data channel
    jsr SETLFS
    lda #wname_end-wname
    ldx #<wname
    ldy #>wname
    jsr SETNAM
    jsr OPEN
    bcs open_failed              // C=1: KERNAL-side error, A = code
    ldx #2
    jsr CHKOUT                   // from here CHROUT writes to the file
    bcs open_failed
    ldy #0
put:
    lda payload,y
    jsr CHROUT
    iny
    cpy #32
    bne put
    jsr CLRCHN                   // output back to the screen FIRST
    lda #2
    jsr CLOSE                    // now the drive finalises the entry
    clc
    rts
open_failed:
    jsr CLRCHN
    lda #2
    jsr CLOSE                    // a failed OPEN can leave a table entry
    sec
    rts

.encoding "petscii_upper"        // a drive reads PETSCII, not screen codes
scr:    .text "S0:SCORES"
scr_end:
wname:  .text "SCORES,S,W"       // name, type S, mode W
wname_end:
payload: .fill 32, i
```

### Why it works

OPEN puts the drive into LISTEN with secondary `$F0 | 2` and sends the
name; the drive parses `,S,W`, allocates a first data block and keeps the
channel open. CHKOUT sends LISTEN with `$60 | 2`, after which the KERNAL's
CHROUT vector writes each byte to the bus with IECOUT. CLOSE sends
`$E0 | 2`, and it is on receiving that close that the drive writes out
the last partial block, fills in the block count and clears the "open"
flag in the directory entry. Until then the entry is a splat file: a
`*SEQ` with 0 blocks that no OPEN can read. That is also what an
emulator run stopped before CLOSE finished leaves behind; the
`krnio_save_leaves_splat_file` pitfall shows the same signature for SAVE.

### Overwriting

Opening `NAME,S,W` when NAME exists is refused by the drive. The OPEN
still returns C=0 and the error channel reads `63, FILE EXISTS,00,00`
(measured with a PRG of that name: OPEN of `BLOB,P,W` returned C=0 and
the channel read 63). What CHKOUT and CHROUT do on that channel
afterwards was not measured here. Two ways round it:

- `@0:NAME,S,W` asks the DOS to replace the file in place. 1541 DOS 2.6's
  save-with-replace has a long-reported defect that can corrupt the disk
  when the drive's buffers are in a particular state; that defect is not
  measured here (rung 4), and this page does not recommend relying on
  the command.
- Scratch, then write: send `S0:NAME` over the command channel as the
  fragment does, and then OPEN for write. It costs one extra OPEN/CLOSE
  pair, the result is visible on the error channel (`01, FILES
  SCRATCHED,01,00` reports the count; not measured here), and a
  scratch of a name that does not exist is harmless. This is the safer
  habit and the one the fragment uses.

### Variations

- **Logical file numbers 128 to 255** are safe here. CHROUT adds no
  linefeed whatever the number; the linefeed-after-CR rule belongs to
  BASIC's PRINT#, as `hardware/kernal-routines-reference.md` measured.
- **PRG rather than SEQ.** `,P,W` writes a PRG; the two-byte load address
  must then be sent first with CHROUT. Use SAVE instead when the bytes are
  already contiguous in memory.
- **Text files for other software.** Write `$0D` after each line; the
  drive stores it as an ordinary byte.

### Recipes

- `recipes/kickassembler/file-io-roundtrip.md`
- `recipes/oscar64/save-load-seq-file.md` (the same sequence through Oscar64's kernalio.h, with a provoked 62)
- `recipes/oscar64/high-score-persist.md` (the policy around the calls: first run, scratch-then-write, version byte, no drive; 74 and the scratch reply measured)

---

## kernal_file_read_seq — Read a sequential file with CHKIN/CHRIN/READST

**Complexity:** low
**Region:** both
**Uses registers:** (none)
**Uses kernal:** SETLFS, SETNAM, OPEN, CHKIN, CHRIN, READST, CLRCHN, CLOSE
**Claims:** serial_bus (shares), cia1_timer_b (shares)
**Claims basis:** measured-vice

### Why

The read half of kernal_file_write_seq. The trap is end-of-file: CHRIN
delivers the last byte with the carry clear, as it delivered
every earlier one, and the only signal that the byte was the last is bit
6 of the status byte. A loop that waits for the carry reads one byte too
many.

### How

1. SETLFS, SETNAM with `,S,R`, OPEN, as for writing. OPEN returns C=0
   whether or not the file exists.
2. CHKIN with X = the logical file number. From here CHRIN reads from the
   file.
3. CHRIN, store the byte, then READST. Zero means more bytes follow.
   `$40` means the byte just stored was the last one. Any other set bit
   is an error: `$42` (read timeout plus EOI) is what a missing file
   looks like, because the drive has nothing to say on that channel
   (measured: `SCORES,S,R` with no such file gave OPEN C=0, CHKIN C=0
   and ST = `$42` on the first CHRIN; VICE 3.10, empty disk).
4. Bound the loop by the buffer size as well as by ST.
5. CLRCHN, then CLOSE.

```asm
// kernal_file_read_seq: read SCORES back until the drive signals EOI
.const SETLFS = $ffba
.const SETNAM = $ffbd
.const OPEN   = $ffc0
.const CLOSE  = $ffc3
.const CHKIN  = $ffc6
.const CLRCHN = $ffcc
.const CHRIN  = $ffcf
.const READST = $ffb7

* = $c000
read_scores:
    lda #3
    ldx #8
    ldy #3
    jsr SETLFS
    lda #rname_end-rname
    ldx #<rname
    ldy #>rname
    jsr SETNAM
    jsr OPEN                     // C=0 even when the file is missing
    bcs read_failed
    ldx #3
    jsr CHKIN                    // from here CHRIN reads from the file
    bcs read_failed
    ldy #0
get:
    jsr CHRIN                    // one byte, blocking
    sta buffer,y
    iny
    jsr READST                   // ST: 0 = more, $40 = that was the last
    bne last_or_error
    cpy #64                      // never overrun the buffer
    bne get
last_or_error:
    sty count
    and #$bf                     // anything but the EOI bit is an error
    bne read_failed              // ($42 = read timeout: no such file)
    jsr CLRCHN
    lda #3
    jsr CLOSE
    clc
    rts
read_failed:
    jsr CLRCHN
    lda #3
    jsr CLOSE
    sec
    rts

.encoding "petscii_upper"
rname:  .text "SCORES,S,R"
rname_end:
count:  .byte 0
buffer: .fill 64, 0
```

### Why it works

CHKIN sends TALK with `$60 | 3` and turns the bus round so the drive
drives DATA. Each CHRIN then runs IECIN, which receives one byte and
notices EOI, the talker's "this is the last byte" signal described under
EOI in `formats/iec-disk-reference.md`; IECIN records it as bit 6 of
`$90`. READST returns `$90` unchanged (ROM `$FE1A`: it reads and rewrites
the byte; the read-and-clear applies only to the RS-232 status at
`$0297`). The byte is zeroed elsewhere in the ROM: `LDA #0 / STA $90`
sits at `$F30F`, `$F3DD` and `$F4A7` (rung 1, byte search of
kernal-901227-03), which is why a fresh OPEN or LOAD starts from ST = 0;
which routine owns each of those three was not traced here. The recipe's
readback of a 32-byte file
returned 32 bytes with ST = `$40` on the thirty-second (measured). The
status-byte table and the carry-versus-READST explanation are in
`hardware/kernal-routines-reference.md` under READST and "Status-byte
interaction with file I/O".

### Variations

- **GETIN instead of CHRIN.** On a serial channel GETIN goes through the
  same path; use CHRIN, which is the documented blocking read.
- **Counted reads.** If the writer stored a length first, read it and
  loop on the count; still test READST each time so a short file cannot
  hang the loop.
- **Two channels at once.** A second file on secondary 4 with its own
  logical number can stay open while this one reads; switch with
  CHKIN/CHKOUT and CLRCHN between them.

### Recipes

- `recipes/kickassembler/file-io-roundtrip.md`
- `recipes/oscar64/save-load-seq-file.md` (the same sequence through Oscar64's kernalio.h, with a provoked 62)
- `recipes/oscar64/high-score-persist.md` (the policy around the calls: first run, scratch-then-write, version byte, no drive; 74 and the scratch reply measured)

---

## error_channel_check — Read the drive's status line from channel 15

**Complexity:** low
**Region:** both
**Uses registers:** (none)
**Uses kernal:** SETLFS, SETNAM, OPEN, CHKIN, CHRIN, READST, CLRCHN, CLOSE
**Claims:** serial_bus (shares), cia1_timer_b (shares)
**Claims basis:** measured-vice

### Why

The drive keeps one status line and the KERNAL never reads it.
A disk OPEN returns C=0 for a name that is not there and for a write to
a name that is; LOAD reports a missing file as A=4 but says nothing
about a full or protected disk. The status line is the only place these
answers live, so a program reads it after any operation whose outcome it
cares about.

### How

1. SETLFS with logical file 15, device 8, secondary 15. SETNAM with
   length 0: opening the channel bare sends no command.
2. OPEN. Here C=1 with A=5 does mean something: no device answered.
3. CHKIN 15, then CHRIN/READST as in kernal_file_read_seq. The line ends
   with a CR and the drive raises EOI on that CR. The longest line seen
   in these runs was 27 bytes including the CR; 40 is a comfortable
   buffer (every message in the ROM's table, read from the drive ROM on this
   machine, is in `../formats/iec-disk-reference.md`, "The 1541 DOS Error
   Codes").
4. CLRCHN, CLOSE 15. Reading the line is what resets it to `00, OK,00,00`
   (the DOS rule; not measured separately here).

```asm
// error_channel_check: read the drive's status line into stbuf
.const SETLFS = $ffba
.const SETNAM = $ffbd
.const OPEN   = $ffc0
.const CLOSE  = $ffc3
.const CHKIN  = $ffc6
.const CLRCHN = $ffcc
.const CHRIN  = $ffcf
.const READST = $ffb7

* = $c000
read_status:
    lda #15
    ldx #8
    ldy #15                      // secondary 15 = command channel
    jsr SETLFS
    lda #0                       // no filename: open the channel bare
    jsr SETNAM
    jsr OPEN
    bcs no_drive                 // C=1, A=5: nothing answered on the bus
    ldx #15
    jsr CHKIN
    bcs no_drive
    ldy #0
get:
    jsr CHRIN
    sta stbuf,y
    iny
    jsr READST
    bne done                     // EOI comes with the closing CR
    cpy #39
    bne get
done:
    sty stlen
    jsr CLRCHN
    lda #15
    jsr CLOSE
    lda stbuf                    // first digit of the code, PETSCII
    cmp #$31                     // C=0 for 00 OK and 01 FILES SCRATCHED,
    rts                          // C=1 for anything from 20 upwards
no_drive:
    jsr CLRCHN
    lda #15
    jsr CLOSE
    sec
    rts

stlen:  .byte 0
stbuf:  .fill 40, 0              // "62, FILE NOT FOUND,00,00" + CR fits
```

The line is `code,message,track,sector` in PETSCII with the two-digit
code first, so the first byte alone says whether to look further.

### When to read it

- **Once at start, to clear the power-on message.** The first read after
  the drive resets returns `73,CBM DOS V2.6 1541,00,00` (measured; VICE's
  1541-II ROM). A program that treats any non-zero code as failure will
  refuse a healthy drive unless it reads this line first.
- **After CLOSE of a written file**, which is when a full disk or a
  refused name shows up.
- **After an OPEN for read** whose CHRIN loop ended with ST other than
  `$40`.
- **After a LOAD that returned C=1**, to tell 62 from a disk error.

### The codes an agent meets first

Measured in this page's runs: `00, OK,00,00` after a clean write and
read; `73,CBM DOS V2.6 1541,00,00` on the first read; `62, FILE NOT
FOUND,00,00` after LOAD of a name that was not on the disk (LOAD itself
returned C=1, A=4); `63, FILE EXISTS,00,00` after OPEN of `,P,W` on an
existing name (OPEN itself returned C=0).

Measured since, in `../recipes/oscar64/high-score-persist.md`: `74,DRIVE
NOT READY,00,00` with no disk attached and `01, FILES SCRATCHED,01,00`
after a scratch, where the track field is the count. Not measured here,
from the 1541 DOS message set (rung 4): `26, WRITE PROTECT ON` when the
notch is covered; `72, DISK FULL` when the last block goes. Codes 20 to
29 are read or write errors with the track and sector filled in. The
full table of codes, message text as the ROM spells it, causes and an
agent's class for each (retry, media, user error, program bug), read
from the 1541 ROM with four codes provoked in VICE, is
`../formats/iec-disk-reference.md`, "The 1541 DOS Error Codes", with
the recipe `../recipes/kickassembler/dos-error-codes.md`.

### Variations

- **Send a command and read the answer in one open.** SETNAM the command
  (`S0:NAME`, `I0`, `V0`), OPEN, then CHKIN and read: the reply to that
  command comes back on the same channel.
- **Keep channel 15 open for the program's life** and only CHKIN it when
  needed. This holds one of the KERNAL's ten table slots and one of the
  drive's channels, which is fine for a game.
- **Hang on a missing drive.** CHKIN on a device that does not answer
  hangs with no timeout, per `hardware/kernal-routines-reference.md`;
  the OPEN's C=1, A=5 return is the last chance to notice, so test it.

### Recipes

- `recipes/kickassembler/file-io-roundtrip.md`
- `recipes/oscar64/save-load-seq-file.md` (the same sequence through Oscar64's kernalio.h, with a provoked 62)
- `recipes/oscar64/high-score-persist.md` (the policy around the calls: first run, scratch-then-write, version byte, no drive; 74 and the scratch reply measured)
- `recipes/oscar64/relative-file-records.md` (the P command's 50 reply read next to the KERNAL status byte; 51 in a side run)

---

## directory_read_and_select — Read the disk directory into a table and pick an entry

**Complexity:** low
**Region:** both
**Uses registers:** (none)
**Uses kernal:** SETLFS, SETNAM, OPEN, CHKIN, CHRIN, CLRCHN, CLOSE, READST
**Requires:** kernal_file_read_seq
**Cost:** bytes_data=1539
**Cost basis:** derived-listing

### Why

A loader menu, a level chooser or a save slot picker needs to know
what is on the disk. The DOS provides it: the name `$` opens a
listing of the directory as if it were a file, and the same CHKIN and
CHRIN loop that reads a SEQ file reads it. What comes back is not
text. It is a BASIC program image, with link bytes and line numbers,
and the block counts live in the line numbers. A parser that knows
that turns the stream into a table in one pass, and a highlight moved
by the joystick over that table is the menu.

The trap: `LOAD "$",8` from BASIC puts
that program image where the BASIC program was, so a BASIC program
that lists the directory that way has replaced itself. Machine code
and C programs never meet the trap, because OPEN and CHRIN load
nothing; the bytes go only where the program puts them.

### How

1. SETLFS with a logical file number, device 8 and secondary
   address 0. SETNAM with the one byte `$`. OPEN. Test the carry:
   C=1 with A=5 is device not present.
2. CHKIN with X = the logical file number. From here CHRIN reads the
   listing.
3. The first two bytes are a load address (`$0401`). Skip them.
4. Each line is two link bytes, a two-byte line number low byte first,
   PETSCII text and a zero. Two zero link bytes end the listing. The
   link bytes carry nothing; skip them. The line number is the drive
   number on the first line, the block count on every entry, and the
   free block count on the last line.
5. The first line is the header: `$12` (reverse on), the disk name in
   quotes padded to sixteen characters with `$A0`, then the id. An
   entry's text is spaces, the name in quotes, spaces, an optional `*`
   (a file never closed), the three type letters `PRG`, `SEQ`, `REL`,
   `USR` or `DEL`, and an optional `<` (locked). The last line has no
   quotes and reads `BLOCKS FREE.`
6. Call READST after every CHRIN. Zero means more; `$40` arrives with
   the last byte; anything else is an error and the loop stops.
7. CLRCHN, then CLOSE. Do this before the next file operation, since
   the drive keeps the directory channel until the listing is consumed
   or closed.
8. For the selector: draw one row per entry, keep an index, move it on
   joystick up and down edges, act on fire. Reprint the old row plain
   and the new row in reverse video rather than redrawing the table.

```asm
// directory_read_and_select: stream "$" through CHRIN into a table of
// name, block count and type, one entry per line, no buffer for the listing
.const SETLFS = $ffba
.const SETNAM = $ffbd
.const OPEN   = $ffc0
.const CLOSE  = $ffc3
.const CHKIN  = $ffc6
.const CLRCHN = $ffcc
.const CHRIN  = $ffcf
.const READST = $ffb7
.const MAXENT = 16                   // entries the table holds
.const ENTLEN = 20                   // 16 name, 1 zero, 2 blocks, 1 type
.const ptr    = $fb                  // zero page pair for (ptr),y

* = $c000
read_dir:
    lda #0
    sta count
    sta line
    sta status
    lda #2
    ldx #8
    ldy #0                       // secondary 0: the load channel
    jsr SETLFS
    lda #1
    ldx #<dollar
    ldy #>dollar
    jsr SETNAM
    jsr OPEN
    bcc opened
    jmp dir_failed
opened:
    ldx #2
    jsr CHKIN
    bcc reading
    jmp dir_failed
reading:
    jsr get                      // load address, two bytes, unused
    jsr get
next_line:
    jsr get                      // link low
    sta tmp
    jsr get                      // link high
    ora tmp
    beq dir_done                 // a zero link ends the listing
    jsr get                      // line number = blocks (or free count)
    sta blocks
    jsr get
    sta blocks+1
    lda line
    beq skip_text                // line 0 is the disk header
    ldy #0
find_quote:
    jsr get
    beq end_of_line              // no quote at all: BLOCKS FREE line
    cmp #$22
    bne find_quote
    ldx count
    cpx #MAXENT
    bcs skip_text                // table full: drain the rest
    jsr entry_ptr                // ptr = table + count*ENTLEN
name_char:
    jsr get
    beq end_of_line
    cmp #$22
    beq name_done
    sta (ptr),y
    iny
    cpy #16
    bne name_char
    jsr get                      // a full 16-byte name: swallow its closing quote
name_done:
    lda #0
    sta (ptr),y                  // terminate the name
    ldy #17
    lda blocks
    sta (ptr),y
    lda blocks+1
    iny
    sta (ptr),y
type_char:
    jsr get                      // spaces, maybe '*', then P/S/R/U/D
    beq end_of_line
    cmp #' '
    beq type_char
    cmp #'*'
    beq type_char                // a splat: the type letter follows
    ldy #19
    sta (ptr),y                  // first letter of the type
    inc count
skip_text:
    jsr get                      // drain to the line's zero
    bne skip_text
end_of_line:
    inc line
    lda status
    beq next_line                // ST = 0: more bytes follow
dir_done:
    lda blocks
    sta free
    lda blocks+1
    sta free+1                   // the last line number is BLOCKS FREE
    jsr CLRCHN
    lda #2
    jsr CLOSE
    clc
    rts
dir_failed:
    jsr CLRCHN
    lda #2
    jsr CLOSE
    sec
    rts

// one byte from the channel; Z reflects the byte, status holds ST
get:
    jsr CHRIN
    sta byte
    jsr READST
    sta status
    lda byte
    rts

entry_ptr:
    lda #<table
    sta ptr
    lda #>table
    sta ptr+1
    txa
    beq ptr_done
mul:
    lda ptr
    clc
    adc #ENTLEN
    sta ptr
    bcc no_carry
    inc ptr+1
no_carry:
    dex
    bne mul
ptr_done:
    rts

.encoding "petscii_upper"
dollar: .text "$"
count:  .byte 0
line:   .byte 0
status: .byte 0
byte:   .byte 0
tmp:    .byte 0
blocks: .word 0
free:   .word 0
table:  .fill MAXENT*ENTLEN, 0
```

Assembled and run here from BASIC (`LOAD "DIRTECH",8,1` then
`SYS 49152`) against a disk holding three files and itself: `count`
came back 4, `status` `$40` and `free` 655, the figures `c1541 -list`
printed for the same disk. A second run against a disk holding a
300-byte SEQ file with a sixteen-character name and the routine itself
read the table back with PEEK: `count` 2, `status` `$40`, the first
entry's name bytes `A` to `P` with a zero after them, its block count 2
and its type letter `S`, the second entry's type `P`. An earlier draft
of the name loop left the closing quote unread after a full
sixteen-byte name and stored it as the type; the `jsr get` after the
loop is what that run checks.

### Why it works

The 1541 DOS recognises `$` at OPEN and builds the listing block by
block from the directory sectors on track 18, sending it on the data
channel with EOI on the last byte, which is why READST reads `$40`
there and nowhere earlier. The image is a BASIC program so that
`LOAD "$",8` followed by `LIST` shows it without any code on the C64
side. That is the reason for the load address, the
link bytes and the line numbers, and a parser that reads it as a file
only has to know the shape. The block count sits in the line number
because BASIC prints line numbers in decimal for free; the DOS never
writes it into the text. Each entry costs 32 bytes on the wire (link,
number, up to 27 bytes of text, zero), so a directory of `n` files is
about `32 * (n + 2)` bytes, 160 for three files (measured, the recipe
below).

### Variations

- **More entries than the screen.** A 1541 directory holds up to 144
  entries and a 25-row screen shows about 22. Keep the whole table
  (144 entries of 20 bytes is under 3 KB) and draw a window of it,
  moving the window when the index leaves it. The parse is one pass
  regardless.
- **Only PRG files.** Test the first type letter and skip an entry
  whose type is not `P`; the table stays small and the menu shows only
  what the loader can use. Skip splat files too, or mark them.
- **Filtered by the drive.** `$:NAME*` or `$:*=P` asks the DOS to
  filter by pattern or type before sending, so the C64 receives only
  the matching lines. Not measured here.
- **The LOAD "$" trap from BASIC.** A BASIC program that wants a
  directory opens `$` with `OPEN 2,8,0,"$"` and reads it with `GET#2`,
  skipping the link and number bytes as above; it never uses LOAD for
  it. The DOS wedge's `@$` does the same read.
- **Streaming or buffered.** The listing above parses straight from
  CHRIN and needs no buffer. The recipe buffers the stream first so the
  parse can be timed apart from the transfer and the channel is closed
  before any screen output; either shape gives the same table.

### Cycle budget

Measured in VICE 3.10 x64sc with a true-drive 1541 and wobble off, on
the recipe below, CIA2 timers chained: the transfer of a 160-byte
listing (OPEN, CHKIN, 160 CHRIN and READST pairs, CLRCHN, CLOSE) took
515,635 cycles on PAL and 535,744 on NTSC, about 3,200 cycles a byte.
The parse of the buffered 160 bytes took 13,821 cycles on PAL and
14,251 on NTSC, about 86 cycles a byte. Both are one-off costs paid
when the menu is built, not per frame, so the Cost line carries no
`cycles_per_frame`; both timings read the chained counter unlatched,
so each is good to within a few hundred cycles rather than to the
cycle. The Cost line's `bytes_data` is the recipe's own data: the
1,024-byte listing buffer, the 411-byte table, the 40-byte reply
buffer and the 64-byte write block; the linker map's data and BSS
segments together come to 1,620 bytes with the runtime's own. By
arithmetic from those rates, a full 144-entry directory of about
4,700 bytes would take some 15 million cycles to transfer and 400,000
to parse. The transfer runs with interrupts off inside the KERNAL, so
a raster IRQ misses most frames during it
(`raster_irq_during_serial_io`).

### Recipes

- `recipes/oscar64/directory-reader.md` (three files written, the table parsed and checked, a joystick selector with an autopilot pick; transfer and parse timed)

---

## kernal_load_to_address — LOAD a raw asset to an address of your choosing

**Complexity:** low
**Region:** both
**Uses registers:** (none)
**Uses kernal:** SETLFS, SETNAM, LOAD, SETMSG
**Claims:** serial_bus (shares), cia1_timer_b (shares)
**Claims basis:** measured-vice

### Why

Level data, a character set or a music file arrives as a PRG on the
disk: two bytes of load address, then the bytes. Sometimes the program
wants it where the file says; sometimes it wants it somewhere else, for
example the same tile file into whichever of two buffers is free. LOAD
does both, and which one is chosen by the secondary address given to
SETLFS, not by a LOAD argument.

### How

1. SETLFS with any logical file number, X = 8, and Y = 0 or 1. With
   Y = 0 the address passed in X/Y to LOAD is used and the file's own
   header is discarded. With Y = 1 the header decides and LOAD's X/Y are
   ignored.
2. SETNAM with the bare name. No `,P,R` is needed: the drive assumes PRG
   for a load.
3. A = 0 for load (1 verifies against memory instead). X/Y = the
   destination when the secondary address is 0.
4. JSR LOAD. On return C=0 and X/Y hold the address one past the last
   byte written, which is how to learn the file's length. C=1 with A=4
   is file not found, 5 no device, and A=0 means RUN/STOP was pressed.

```asm
// kernal_load_to_address: pull a raw asset in at an address of our choosing
.const SETLFS = $ffba
.const SETNAM = $ffbd
.const LOAD   = $ffd5
.const SETMSG = $ff90

* = $c000
load_tiles:
    lda #0
    jsr SETMSG                   // no SEARCHING FOR / LOADING on screen
    lda #1                       // logical file number: LOAD ignores it
    ldx #8
    ldy #0                       // secondary 0: OUR address wins
    jsr SETLFS
    lda #tname_end-tname
    ldx #<tname
    ldy #>tname
    jsr SETNAM
    lda #0                       // 0 = load, 1 = verify
    ldx #<$6000                  // destination, used only with secondary 0
    ldy #>$6000
    jsr LOAD
    bcs load_failed              // C=1: A=4 file not found, 5 no device,
    stx end_lo                   //      0 RUN/STOP; X/Y = end address + 1
    sty end_hi
    clc
    rts
load_failed:
    sec
    rts

load_where_saved:
    lda #1
    ldx #8
    ldy #1                       // secondary 1: the file's own header wins
    jsr SETLFS
    lda #tname_end-tname
    ldx #<tname
    ldy #>tname
    jsr SETNAM
    lda #0
    jsr LOAD                     // X/Y are ignored here
    rts

.encoding "petscii_upper"
tname:  .text "TILES"            // a PRG: two-byte load address, then data
tname_end:
end_lo: .byte 0
end_hi: .byte 0
```

Measured (VICE 3.10, 1541 true drive): a 16-byte PRG saved from `$5000`
loaded with secondary 0 and X/Y = `$6000` returned C=0 with X/Y =
`$6010` and the 16 bytes at `$6000`; the same file loaded with secondary
1 and X/Y set to `$1234` returned X/Y = `$5010` with the bytes back at
`$5000`; a name not on the disk returned C=1, A=`$04` and the error
channel then read `62, FILE NOT FOUND,00,00`.

### What the KERNAL prints

LOAD writes `SEARCHING FOR name` and `LOADING` to the screen only when
bit 7 of the message flag at `$9D` is set. BASIC sets that bit in direct
mode and clears it while a program runs, so a LOAD called from a program
started with RUN or a `SYS` line prints nothing: `$9D` read `$00` at
entry to the test program and the first LOAD left the screen alone
(measured). After `SETMSG` with A = `$80` the same LOAD printed a blank
line, `SEARCHING FOR BLOB` on the next, and `LOADING` with no carriage
return after it, so the program's next CHROUT landed on the same line
as `LOADING` (measured). Call SETMSG with A = 0 before loading from a game screen, or
save and restore `$9D` around the call if a BASIC front end expects it.

### Why it works

The serial LOAD reads the two header bytes first. With secondary 0 the
KERNAL substitutes the caller's X/Y; with secondary 1 it keeps them. Either way it then stores every following byte through
the zero-page pointer `$AE/$AF`, which is why a load lands in RAM under
BASIC or KERNAL ROM but into the chip registers at `$D000-$DFFF`, both
measured in `hardware/kernal-routines-reference.md` under LOAD. The
end address returned in X/Y is that pointer after the last store.

### Variations

- **Verify.** A = 1 compares the file against memory and sets bit 4 of
  ST on a mismatch; the memory is not written.
- **Load into colour RAM.** Secondary 0 with X/Y = `$D800` writes the
  colour nybbles straight in; the reference's LOAD entry shows why this
  works and why `$D000-$DFFF` in general is a trap.
- **Chained loads under an IRQ.** LOAD, like OPEN and the channel
  calls, does not respect a caller's SEI; the `kernal_assumes_sei_cleared`
  pitfall covers what that does to a raster IRQ. Measured on LOAD
  itself in `recipes/oscar64/load-asset-runtime.md`: entered with the
  I flag set, LOAD returned with it clear, and a `rasterirq.h` split
  armed across a 2 KB load entered in 222 of 283 PAL frames, as late
  as line 170; the screen was not blanked (`$D011` bit 4 still set,
  text drawn in a mid-transfer picture). `raster_irq_during_serial_io`
  has the fix, which is to clear `$D01A` around the call.
- **From Oscar64.** `krnio_load(fnum, device, channel)` in
  `kernalio.c` passes X = Y = 0 to LOAD, so with secondary 0 it loads
  to `$0000`; it is only useful with secondary 1. To choose the address
  from C, call SETLFS, SETNAM and LOAD from inline assembly as the
  recipe below does. `krnio_save(device, start, end)` writes the
  header from `start`, so a file saved from a buffer LOADs back to that
  buffer with secondary 1 and anywhere with secondary 0.

### Recipes

- `recipes/kickassembler/file-io-roundtrip.md` (write and read side;
  the LOAD measurements above came from a scratch program that is not a
  recipe)
- `recipes/oscar64/load-asset-runtime.md` (a 2 KB charset built in
  RAM, saved as a PRG on the first run, loaded with secondary 0 to
  `$3800` and shown; the I flag, the raster IRQ and `$D011` measured
  across the LOAD)

---

## kernal_relative_file_io — Read and write one record of a relative file by number

**Complexity:** medium
**Region:** both
**Uses registers:** (none)
**Uses kernal:** SETLFS, SETNAM, OPEN, CHKOUT, CHROUT, CHKIN, CHRIN, READST, CLRCHN, CLOSE

### Why

A sequential file gives back its bytes from the start, every time. A
game with eight save slots, a level bank of sixty rooms or a table of
player names wants slot 5 or room 42 without streaming everything before
it, and wants to overwrite one entry without rewriting the file. The
1541's relative file (directory type `REL`) does that: fixed-length
records, addressed by number, positioned by a command on channel 15,
and the same KERNAL calls as a sequential file for the bytes themselves.
The drive does the seeking; the C64 side sends five bytes and reads a
reply.

### How

1. SETLFS with a logical file number, device 8 and a secondary address
   from 2 to 14; SETNAM with the name followed by `,L,` and **one more
   byte, the record length** (1 to 254). The length byte is binary, not
   a digit, so the name is set by length and address rather than as a
   text string. OPEN. On a fresh disk this creates the file; the drive
   answers `00, OK` on channel 15 and the directory shows a `REL` entry.
2. Open the command channel (secondary 15, empty name) before the data
   file or after it, and **keep it open until the data file is closed**:
   CLOSE of secondary 15 makes the drive close every channel it has, the
   REL file included.
3. To reach a record, send the P command on channel 15: CHKOUT 15, then
   CHROUT of the five bytes `P`, the data channel's secondary address
   plus 96, the record number low byte, the record number high byte,
   and the byte offset inside the record, then CLRCHN. Records and
   offsets count from 1. Then read the reply from channel 15 as
   error_channel_check does: `00` means the record exists, `50, RECORD
   NOT PRESENT` means it does not yet.
4. Read: CHKIN the data file, CHRIN and READST until EOF, CLRCHN. The
   drive sends the record's bytes up to the last non-zero one and raises
   EOI there, so a record padded with zeros comes back short.
5. Write: CHKOUT the data file, CHROUT up to the record length, CLRCHN.
   The bytes go when the KERNAL sends EOI on the last one, and the
   drive pads the rest of the record with zeros. More bytes than the
   record length answer `51,OVERFLOW IN RECORD` on channel 15 and the
   KERNAL status stays `$00`.
6. Send a P before every read and every write. The pointer moves as
   bytes move, so a second read without a P starts on the next record.
7. CLOSE the data file, then CLOSE 15.

Measured in VICE x64sc 3.10 with the recipe below, a 32-byte record
length on a fresh disk (rung 1): after the OPEN that created the file
the disk was two blocks shorter, one data block and one side sector;
positioning on records 1 to 7 answered `00` before any of them was
written, and a read of an unwritten one returned a single `$FF` with
EOF; positioning on record 8, 9 or 20 answered `50, RECORD NOT
PRESENT,00,00`, and a read after that reply returned a single `$0D`
with EOF and left the status at `50`; a 32-byte write to record 9 after
the `50` answered `00, OK`, grew the file by one block, and the next P
to record 9 answered `00` with all 32 bytes reading back. Seven 32-byte
records are 224 bytes and an eighth would cross the 254 data bytes of a
block, so the boundary is the end of the first data block; that the
open allocates that block and marks each record in it with `$FF` is
inference from those two measurements (rung 3). The DOS also reports
`50` when a write extends the file, per the ROM's call sites in
`../formats/iec-disk-reference.md`; in these runs the write itself
answered `00` and only the P before it said `50`. `50` and `51` never
reached the KERNAL's status byte, which read `$00` after every write
and `$40` after every read; only channel 15 knows. A side run with a
scratch program, not the recipe, checked steps 3, 4 and 6 (rung 1): a
record written as ten letters and 22 zeros read back as ten bytes; a P
with offset 5 read six bytes from the fifth letter, and offset 0
behaved as 1; a read with no P after a full record returned a single
byte, the next record's.

### Why it works

The drive holds a record pointer per open relative file and a set of
side sectors, blocks that list the track and sector of every data block
in the file in order. A P command is arithmetic on the drive: record
number times record length gives a byte offset, the side sector turns
that into a data block, and the drive seeks straight to it. Extending
the file is where the cost lives: a write past the end allocates the
data blocks up to and including the new record, plus a side sector for
every 120 data blocks, and every new record starts with `$FF`. The
side sectors are why a REL costs one block more than the data on
creation and why creating a large file takes long. The figure of one
side sector per 120 data blocks was the format's stated rule when this
was first written; it has since been read off a disk image, a
one-byte write to record 125 of a 254-byte-record file allocating 125
data blocks and two side sectors of 120 and 5 entries
(`../formats/c64-file-formats.md`, "REL file", rung 1).

`c1541 -write` can create a REL entry but cannot lay out records. The
record length goes on the end of the name as one byte, so `c1541
-write blob.bin "blob,l, "` (the trailing space is byte 32) printed
`Open new REL file 'BLOB' with record length 32 on channel 1.`, and
the directory then showed `blob` as `rel` with 662 blocks free. But
c1541 streams the whole file as one record: a 64-byte blob drew `ERR =
51, OVERFLOW IN RECORD, 00, 00` once for each byte past the
thirty-second, so at most record 1 is filled. Without the length byte,
`c1541 -write blob.bin "blob,l"` answered `Open non-existing REL file
'BLOB' with unspecified record length on channel 1.` and `floppy write
failed`, and the directory gained no entry (both rung 1, c1541 3.10).

The KERNAL knows none of this. SETLFS, SETNAM, OPEN and the CHKIN,
CHKOUT, CHRIN, CHROUT, CLRCHN, CLOSE pairs behave exactly as in
kernal_file_write_seq and kernal_file_read_seq, and everything on this
page about interrupts, bus pace and the status byte applies: the calls
re-enable interrupts (`kernal_assumes_sei_cleared`), a raster IRQ armed
across them misses most frames (`raster_irq_during_serial_io`), and
they need the KERNAL ROM in (`kernal_io_mapping_dependency`). In
assembly, the P command is five CHROUT calls, and CHROUT and CHKOUT
keep none of A, X or Y, so a record number held in X or Y across them
is gone by the second byte (`kernal_clobbers_a_x_y`); keep it in
memory and load each byte fresh.

### When a REL beats a SEQ

- **Random access with rewrites in place.** Save slot 3 of 8, room 42
  of 60, the name at table entry 17: one P and one read or write, no
  rewrite of the neighbours. A SEQ needs the whole file read into RAM
  and written back.
- **Not for streaming.** A level that is always read whole is a SEQ or
  a LOAD; the REL's side sector and its per-record P are a cost that
  gives nothing back.
- **Not for assets shipped on the disk image.** `c1541 -write` can
  create the REL entry but fills at most record 1 (measured above), so
  the program should create and fill the REL on first run; a shipped
  table is a SEQ or PRG the program copies into a REL if it wants one.

### Variations

- **Record length 254 or less.** Choose a length that divides 254 with
  no remainder (2, 127, 254) or accept that records straddle blocks,
  which the drive handles and the program never sees.
- **Position on a byte inside the record.** The fifth byte of the P
  command is a 1-based offset (measured above on a read); a P with
  offset 17 followed by a write of four bytes changes only bytes 17 to
  20 (the DOS rule; the write at an offset was not measured here).
- **Pre-size the file.** Position on the highest record the program will use
  and write one byte to it once, at first run, so later writes never
  extend the file mid-game and pay the block allocation then. The
  extension cost itself was not measured here.
- **Ask before reading.** The `50` reply to a P is the cheap way to know
  a slot is empty: no read, no `$0D`, and no need to reserve a byte in
  the record as an "in use" flag.

### Recipes

- `recipes/oscar64/relative-file-records.md` (create, write 1, 3 and 5, read back with a checksum, the `50` on record 9 and the write that clears it; `51` in a side run)
- `recipes/oscar64/rel-side-sectors.md` (100-byte records across four blocks, then the directory entry and the side sector read back through `U1`; the bytes are decoded in `../formats/c64-file-formats.md`, "REL file")

---

## cartridge_save — Save game data to the cartridge: EasyFlash flash sectors, GMod2 serial EEPROM

**Complexity:** medium
**Region:** both
**Uses registers:** DE00, DE02
**Requires:** cartridge_bank_easyflash
**Demands:** kernal_rom_out

### Why

A game shipped on a cartridge may run on a C64 with no disk drive. Even
when there is one, the disk in it is not the game's. High scores and
save games therefore go into the cartridge. Two cartridge types built for
this are in common use. EasyFlash writes to its own flash chips.
GMod2 writes to a small serial EEPROM beside its flash. The C64 cannot
write to ROM, so both need their own write protocol, and both are slow
compared with a RAM store.

### How: EasyFlash

EasyFlash holds two 512 KB Am29F040-type flash chips, one behind ROML
(`$8000`) and one behind ROMH. Each 8 KB bank register value
(`$DE00`) selects the upper chip address lines. Three rules apply.

1. **Erase is per 64 KB sector, programming is per byte.** Erase sets a
   whole sector to `$FF`. That is 8 banks of one chip: the ROML halves of
   banks 8 to 15, for example. Programming can only turn 1 bits into 0
   bits. So reserve whole sectors for saves, never a sector that also
   holds code or data. The Am29F040B data sheet gives 1,000,000
   program/erase cycles per sector at minimum (not measured here).
2. **Writes need Ultimax mode.** Reads work in 16 KB mode (`$DE02` =
   `$07`), but writes to ROML in that mode reach only the C64 RAM
   underneath. Measured in VICE x64sc 3.10: an erase issued in 16 KB mode
   returned in 130 cycles and changed nothing, and the RAM at `$8555`
   read back `$A0`, the program command's third byte. EAPI switches to
   `$85` (Ultimax plus LED) for every write. Write to ROML at
   `$8000-$9FFF` and to ROMH at `$E000-$FFFF`, the Ultimax addresses.
   In Ultimax mode only RAM `$0000-$0FFF` is mapped and the KERNAL is
   gone, so the writing code and its data live below `$1000` (or in the
   cartridge's 256 bytes of RAM at `$DF00`), with interrupts off.
3. **Use EAPI in released software.** EAPI is the EasyFlash flash
   driver. A CRT carries it at bank 0 ROMH offset `$1800` (768 bytes
   reserved). The program copies it to C64 RAM (c64gameframework uses
   `$C000`) and calls EAPIInit, which builds a jump table in the
   cartridge RAM at `$DF80`. The calls are
   EAPIWriteFlash `$DF80`, EAPIEraseSector `$DF83`, EAPISetBank `$DF86`,
   EAPIGetBank `$DF89`, EAPISetPtr `$DF8C`, EAPISetLen `$DF8F`,
   EAPIReadFlashInc `$DF92` and EAPIWriteFlashInc `$DF95`. When EasyProg
   flashes a CRT that has the `eapi` signature there, it swaps in the
   version for the fitted flash chip. Code that sends Am29F040
   commands itself, as the recipe does, works only on that chip. VICE
   emulates it and warns `EF: EAPI not found!` when a CRT has no EAPI.

Saving then works like this. Keep the save sector's banks as `$FF` in
the CRT, because EasyProg erases only the sectors a CRT contains. At
boot, check a signature and erase the sector if it is foreign. Append
each save as a fixed-size record in the next all-`$FF` slot, program a
commit byte last, and load the newest committed record. Erase only when
no slot is left. A save of a few dozen bytes then costs one sector erase
every few hundred saves.

Times. VICE's sector erase took 1,000,147 to 1,000,191 cycles over three
erases (two PAL, one NTSC). That is about 1 s: freeze the game and blank the screen, or show
a "saving" message before starting. Programming 32 bytes took 2,866 to
3,123 cycles in VICE (PAL and NTSC), including the code around each byte. The
Am29F040B data sheet gives 1 s typical and 8 s maximum per sector erase,
and 7 µs typical and 300 µs maximum per byte (not measured here). VICE
does not model the byte time or its spread, so budget for the maximum
on hardware.

The recipe's wait loops poll the toggle bit (DQ6) and do not check DQ5,
which the data sheet sets when an operation exceeds its time limit; a
released game should add that check or use EAPI (hardware failure not
tested here). A power cut is still a risk in two places, and the recipe's
torn-slot path was not exercised. (a) When the bank is full, the erase
comes before the new record is written, so a cut there loses every save.
(b) A cut during an erase can leave the signature and a `$00` commit
byte over half-erased data, which goes undetected without a checksum.
Remedies: alternate between two sectors, and add a checksum byte.

### How: GMod2

GMod2 keeps saves in a serial EEPROM behind `$DE00`. The same register
also selects the ROM bank, so the code keeps a shadow copy and changes
one bit at a time. The bits, from c64gameframework's `gmod2boot.s`:

| `$DE00` bit | Signal | Direction |
|---|---|---|
| 7 | EEPROM data out | read |
| 6 | chip select | write |
| 5 | clock | write |
| 4 | EEPROM data in | write |

Each command is a start bit, a 2-bit opcode and a 10-bit word address,
clocked out MSB first. Opcode `10` reads and `01` writes. `00` followed
by `11` enables writes and `00` followed by `00` disables them. Data
follows as 16-bit words: the framework halves its byte address to get
the word address, and a write sends one word as two bytes. 1,024 16-bit
words is 2 KB (arithmetic from the 10-bit address). After each word, the
code drops and raises chip select, then waits until data out reads 1.
The framework issues no erase command, so there is no sector to manage.
It holds only 2 KB, though, and every bit costs several register writes. The part number and its
write time come from neither the framework nor VICE and are not stated
here. VICE emulates it with `-gmod2eepromimage <file>` and
`-gmod2eepromrw`. Nothing on GMod2 was measured here.

### Which one

- **EasyFlash** if the game is on EasyFlash already, the save is large (a
  whole level state), or saves are rare enough that a 1 s erase is
  acceptable. Reserve a sector per save area.
- **GMod2** for a 16-bit-word save of up to 2 KB that must be written
  often, with no erase planning. Its write time is not established here.
- **Neither** for data that changes every frame: keep it in RAM and
  write it on checkpoint or game over.

### Sources

- EasyFlash Programmer's Guide (Thomas Giesel): http://skoe.de/easyflash/files/devdocs/EasyFlash-ProgRef.pdf
- Am29F040B data sheet, AMD publication 21445: https://instrumentation.obs.carnegiescience.edu/ccd/parts/AM29F040B.pdf
- c64gameframework (Lasse Öörni, MIT), `efboot.s`, `gmod2boot.s`, `eapi-am29f040-14.bin`: https://github.com/cadaver/c64gameframework

### Recipes

- `recipes/kickassembler/easyflash-save.md` (a self-built EasyFlash CRT that appends a high-score record to bank 8 each boot; persistence shown across two VICE runs with `-easyflashcrtwrite`; erase and program timed)

---

## drive_code_upload_and_job_queue — Upload code to the 1541 with M-W, start it with M-E, read sectors through its job queue

**Complexity:** medium
**Region:** both
**Uses registers:** (none)
**Uses kernal:** SETLFS, SETNAM, OPEN, CHKOUT, CHROUT, CHKIN, CHRIN, CLRCHN, CLOSE
**Requires:** error_channel_check
**Cost:** bytes_code=865, bytes_data=341
**Cost basis:** derived-listing
**Cost measured on:** kickassembler-drive-job-queue (whole PRG less the BASIC stub: 837 bytes of host code and the 28-byte drive routine; the 40-byte ramp, the strings and the 128-byte read buffer are data)

### Why

The DOS reads what its file system describes. A loader that wants a
sector by track and sector number, a protection check that wants to
look at a sector the directory does not point to, or a fast loader that
wants the drive's CPU running its own transfer loop, all need code on
the drive side. The 1541 has a 6502 of its own, 2 KiB of RAM, and a
command channel that will write that RAM, read it back and jump into
it. The drive's disk controller then does the reading: uploaded code
never has to touch the head or decode GCR to fetch a sector, it asks
through the job queue.

### How

1. Open channel 15 bare (SETLFS 15, 8, 15; SETNAM length 0; OPEN), as
   error_channel_check does. It stays open for the whole exchange.
2. Upload. Each `M-W` is a command on channel 15: CHKOUT 15, then the
   bytes `M`, `-`, `W`, address low, address high, count, and `count`
   data bytes, then CLRCHN. The UNLISTEN runs it. Send at most 35 data
   bytes per command: the 1541 ROM refuses a command line longer than
   41 bytes (`CPY #$2A` at `$C2CE`, then error 32, SYNTAX ERROR; read
   from `dos1541-325302-01+901229-05.bin`), and the six header bytes
   leave 35. Krill's loader v194 sends 35-byte blocks
   (`techniques/loaders-packers.md`). The recipe sends 32, 32 and 4; a
   34-byte `M-W` also uploaded and ran in VICE, measured under
   `pitfalls/loader.md#atn_assert_drives_data_low_via_atna`; 35 was not
   run here. (An earlier version said 32 was the limit loaders use.)
   Advance the address by the count each time.
3. Verify with `M-R`: the six bytes `M`, `-`, `R`, low, high, count,
   then CHKIN 15 and `count` CHRIN calls, then CLRCHN. Compare with the
   source. The recipe reads 68 bytes in one command; larger counts were
   not measured here. The DOS takes the count from the sixth byte of
   the command.
4. Start with `M-E`: the five bytes `M`, `-`, `E`, low, high. The drive
   executes a JSR to that address from its command parser, with
   interrupts enabled, and returns to its idle loop on the routine's
   RTS. The host's next command is not accepted until then, so a host
   that sends `M-E` and then `M-R` waits.
5. Inside the routine, to read a sector: put the track in `$08` and the
   sector in `$09`, write `$80` to `$01`, and loop while `$01` has bit 7
   set. The controller, which runs from the drive's timer interrupt,
   replaces the job code with a result: `$01` is success and the data
   is in buffer 1 at `$0400`. Slot `$00` uses buffer 0 at `$0300` with
   its header at `$06`/`$07`; slot 2 buffer 2 at `$0500` with `$0A`/`$0B`;
   slot 3 buffer 3 at `$0600` with `$0C`/`$0D`; slot 4 buffer 4 at
   `$0700` with `$0E`/`$0F`; slot 5 has no RAM behind it. Job codes:
   `$80` read, `$90` write, `$A0` verify, `$B0` seek, `$C0` bump,
   `$D0` jump, `$E0` execute. The codes as run here were `$80` and
   `$B0`; the rest are from the ROM disassembly's list and were not run
   (see `../formats/iec-disk-reference.md`, "1541 job queue and
   buffers").
6. Before the first read, teach the controller the disk ID. It checks
   every header's two ID bytes against its master copy at `$12`/`$13`,
   and after power-on nothing has set those, so the first read job
   fails with `$0B` (measured). A seek job, `$B0` with the track in
   `$08`, reads any header and copies its ID there (measured: `$01`,
   and `$12`/`$13` then read `30 31` for a `TEST,01` disk). The DOS's
   own `I0` does the same seek.
7. Fetch the result and the data with `M-R` from the host: `M-R $0001`
   for the job byte, `M-R $0400` in chunks for the sector.

### Why it works

The drive's 6502 spends its time in two roles. From its idle loop it
parses commands and runs the file system; from its timer interrupt,
every ten milliseconds by the ROM disassembly's account (rung 4), it
becomes the disk controller, scans `$00` to `$05` for a byte with bit 7
set, and does that job with the head. `M-W` and `M-R` are ordinary
commands that read and write the drive's address space; `M-E` is a
command whose action is a subroutine call. Code started that way runs
in the file-system role, so it can post jobs for the controller role
as the DOS does, and the result comes back in the same byte.
The status line is not involved: after the track-40 job failed with
`$03` the error channel still read `00, OK,00,00` (measured), because
only the DOS writes that line and the DOS did not run the job.

Buffer choice: the DOS lends buffers 0 to 3 to data channels and keeps
the BAM in buffer 4 at `$0700` (the ROM disassembly's note, rung 4; the
"70, NO CHANNEL" on a fifth `#` open is the four in use). With no files
open, `$0300` to `$06FF` is free. The recipe puts its code in buffer 3
and reads into buffer 1; the code survived the four jobs and a seek.

### Variations

- **A resident drive program.** Upload once, `M-E` once, and never
  return: the routine takes over the bus with its own protocol over
  CLK and DATA, the host side drives it with a matching routine, and
  the KERNAL is out of the loop until the drive is reset. That is a
  fast loader, and the pitfalls are its own: `../pitfalls/loader.md`,
  `gcr_timing_assumes_stock_drive` (an SD2IEC has no CPU to run the
  upload, and a 1571 or 1581 has a different ROM and different
  addresses), `fastloader_resident_in_kernal_workspace` and
  `fastloader_dd00_write_corrupts_resident` for the host half. Not
  measured here.
- **The 1571 and 1581.** Both accept `M-W`, `M-R` and `M-E` (rung 4), but
  their job queues, buffer addresses and controller codes are their own
  ROMs' and were not measured here; detect the drive first
  (`../formats/iec-disk-reference.md`, "Identifying the drive over the
  command channel").
- **Writing.** Fill the buffer, post `$90`. Not run here, and it would
  change the disk, so it does not belong in the recipe's pinned run.
- **Another buffer.** Point the read at buffer 2 (`$0500`) by posting the
  job in slot `$02` with the track and sector at `$0A`/`$0B`: the same
  code, one slot along. Not run here.

### Cycle budget

Bus time, PAL, VICE 3.10 (rung 1): 132,742 host cycles for the three
`M-W` commands carrying 68 bytes, and 163,545 for the single `M-R` that
read them back, about 135 ms and 166 ms. On the drive side, in drive
cycles at 1 MHz: the seek 125,859, the successful read 224,071, the
failed read before the seek 902,630 and the track-40 failure 766,533;
the failures are the controller's retries and bumps. A loader that
uploads a few hundred bytes therefore spends a noticeable fraction of a
second on the upload alone, which is why resident loaders upload once.

### Recipes

- `recipes/kickassembler/drive-job-queue.md` (upload, readback, execute, a failed read, a seek, the BAM read and compared, a provoked `$03`, and what the error channel says afterwards; drive-side monitor trace of each job)

---

## tape_turbo_loader — Read a one-pulse-per-bit tape block by timing FLAG edges against a threshold

**Complexity:** medium
**Region:** both
**Uses registers:** DC06, DC07, DC0D, DC0F
**Uses kernal:** (none)
**Cost:** bytes_code=1060, bytes_data=110, zp_bytes=24
**Cost basis:** derived-listing
**Cost measured on:** kickassembler-tape-turbo-loader (whole PRG less the BASIC stub; the code figure includes the report and the 32-bit division, the data is the strings and counters)

### Why

The KERNAL's tape format spends twenty pulses on a byte, draws them from
three lengths, and writes every block twice; measured from a SAVE in
VICE (`../formats/c64-file-formats.md`, "KERNAL bit encoding") a byte
costs 9,448 cycles, about 104 bytes a second for one copy and half that
for the pair the KERNAL writes. A turbo loader replaces the
stream, not the reading of it: one pulse per bit, two lengths, eight
pulses to a byte, one copy. The recipe below moves 321 bytes a second on
PAL and 334 on NTSC (measured, VICE 3.10), three times the KERNAL's one
copy and six times its pair, with generous pulses; the trade is that the
loader now depends on the tape running at the speed the file was
mastered for, and on a threshold that sits between the two lengths.

### How

1. Master the tape with one pulse per bit. The recipe's script writes a
   TAP file: a lead-in of 1 bits, a sync byte `$5A`, a two-byte length,
   the data and an XOR checksum, most significant bit first, a 0 as a
   256-cycle pulse and a 1 as a 512-cycle pulse. TAP entries are cycles
   divided by eight, so the two lengths are `$20` and `$40`.
2. Take the machine over: `SEI`, `$7F` to `$DC0D` to mask CIA 1's
   interrupt sources, and one read of `$DC0D` to clear what was pending.
   Reading the register clears every bit in it, so any interrupt handler
   that reads it (the KERNAL's does) would steal the FLAG edges the
   loader needs. This is also why the KERNAL's tape routines are not
   called: they own the same register and the same timers and expect
   their own stream.
3. Start CIA 1 Timer B free-running: `$FF` to `$DC06` and `$DC07`, `$11`
   to `$DC0F` (force load, start, count the system clock, continuous).
   It is never restarted; each edge's reading is subtracted from the
   previous one.
4. Wait for PLAY (bit 4 of `$01` low), then drive bit 5 of `$01` low for
   the motor. The KERNAL's interrupt normally does this from its own
   sense logic; with interrupts off the loader must. Blank the screen
   (bit 4 of `$D011`) so no badline stretches a poll.
5. Per pulse: spin on bit 4 of `$DC0D`; read Timer B high, low, high
   again, and take both again if the high byte moved (the low byte can
   wrap in the seven cycles between the reads, and a version that only
   re-read on a low byte of `$FF` mismeasured one pulse in about sixty
   by 256 cycles); length is previous less current; the bit is length
   at or above the threshold, 384 here.
6. Sync: count consecutive 1 bits; after sixty-four, the first 0 is bit
   7 of the sync byte. Rotate seven more bits in and compare with `$5A`;
   on a mismatch start the count again. Because the tape has run since
   the KERNAL first saw PLAY, the loader joins the lead-in wherever it
   happens to be, and this is what makes that harmless.
7. Read the length, the block and the checksum, eight bits to a byte,
   most significant first. Verify, motor off, screen on, `$81` to
   `$DC0D` to give the KERNAL its Timer A interrupt back, `CLI`.

### Why it works

The cassette read line is wired to CIA 1's FLAG input, and the CIA
records each falling edge as bit 4 of its interrupt control register
whether or not that source is enabled; VICE raises one such edge per
TAP entry. The information is in the time between edges, and a
free-running 16-bit timer at the system clock measures it to the cycle
with no restart cost and no drift, provided the two-byte read is made
consistent. The threshold turns a continuous measurement into a bit,
and its margin is what absorbs everything that moves the edges: tape
speed, the loader's own polling granularity (nine cycles a turn here,
and the measured pulses were within 8 cycles of nominal) and the time
the loader spends between one poll and the next. The lead-in of one
value followed by a sync byte whose first bit is the other value gives
byte alignment from a cold start with no marker pulse of a third
length, which is the KERNAL's answer to the same problem.

### Variations

- **An adaptive threshold.** Measure the lead-in's pulses, which are all
  the long value, and set the threshold at three quarters of their
  average (or, with a lead-in that alternates the two values, halfway
  between the two averages). The loader then follows a tape recorded on
  a fast or slow deck, or played on one, instead of failing at a fixed
  figure. Not measured here: the recipe's threshold is a constant. What
  was measured is the margin it needs: with VICE's default tape speed
  error and wobble on, the pulse spread grew from 16 cycles to 52 on
  each value and the block still verified, at least 101 cycles of margin
  on either side.
- **Shorter pulses.** The recipe's per-bit path is about 175 cycles,
  most of it the minimum and maximum bookkeeping for the report, and a
  208-cycle 0 pulse failed on it (one bit read long after a 170-cycle
  setup between two bytes). A loader with nothing in the path but the
  poll, the timer read, the compare and the rotate can run pulses well
  under 200 cycles; the floor for a given loop is its longest path
  between two polls, not its average. Not measured here.
- **The FLAG interrupt instead of a poll.** Enable bit 4 in `$DC0D`
  (`$90`) and take the IRQ or, on CIA 2, the NMI; the handler reads the
  timer and stores a bit while the main code decrunches or draws. The
  interrupt latency and its variation then eat into the margin in the
  poll's place. Not built here.
- **A counted loop instead of a timer.** Increment a register while
  waiting for the edge and compare the count with a constant; that is
  the classic form and costs no CIA. Its unit is the loop's length, so
  a badline or an interrupt adds whole units, and the constant is
  specific to the loop. Not built here.
- **The mastering side.** A turbo needs its tape written the same way.
  No host tool for that ships in this knowledge base; the recipe's
  Python script is the whole of it, and a real cassette would need the
  TAP played out through a deck or written by a program on the C64 that
  drives the write line through bit 3 of `$01` with a timer, as the
  KERNAL's SAVE does. Not built here.

### Cycle budget

Measured, VICE 3.10, `-warp`, screen blanked, tape speed error and
wobble off (rung 1): 1,540,498 cycles on PAL and 1,540,502 on NTSC from
the end of the sync byte to the end of the checksum, 503 bytes, which is 3,062
cycles a byte and 383 cycles a bit for this block's mix of ones and
zeros (256 for a 0, 512 for a 1). The same cycles are 321 bytes a
second at the PAL clock and 334 at NTSC: the TAP stores cycles, so a
tape mastered for one region reads at the other's speed and the same
thresholds hold. The KERNAL figure it is set against is arithmetic from
the measured pulse modes on the formats page: 9,448 cycles a byte for
one copy.

### Recipes

- `recipes/kickassembler/tape-turbo-loader.md` (the TAP-writing script, the loader, the checksum verdict, bytes per second and pulse ranges on both models, and the run with VICE's tape wobble left on)
