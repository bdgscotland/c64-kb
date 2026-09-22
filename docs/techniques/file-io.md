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
`formats/iec-disk-reference.md`; the ways the KERNAL bites are in
`pitfalls/kernal-and-io.md`. Every number below that came from an
instrument says so. The instrument was VICE 3.10 x64sc with true drive
emulation of a 1541 (the `-default` configuration) and a disk freshly
formatted by c1541; a real 1541 was not on the bench.

Two facts run through all four techniques. First, a disk OPEN does not
report drive-side errors: OPEN returns C=0 for a name that is not on the
disk (measured: OPEN of `SCORES,S,R` on an empty disk returned C=0,
CHKIN C=0, and the first CHRIN left ST = `$42`) and for a write to a
name that already is (measured, see error_channel_check); only the
drive's error channel knows. Second, the
KERNAL talks to the drive at the bus's own pace, so these calls take
real time. The recipe below spends 4,846,078 cycles on the drive for a
32-byte write, a 32-byte read and two status reads, about 4.9 s at PAL
speed (measured with a CIA2 timer inside the program; rung 1).

---

## kernal_file_write_seq — Write a sequential file with OPEN/CHKOUT/CHROUT

**Complexity:** low
**Region:** both
**Uses registers:** (none)
**Uses kernal:** SETLFS, SETNAM, OPEN, CHKOUT, CHROUT, CLRCHN, CLOSE

### Why

A game that keeps a high-score table, a save slot or a level editor's
output needs to put a run of bytes on a disk under a name, and get the
same bytes back later. The KERNAL's sequential-file protocol does that
with seven calls and no drive code of its own. It is the same path
BASIC's `OPEN 2,8,2,"NAME,S,W"` / `PRINT#2` / `CLOSE 2` takes.

### How

1. SETLFS with A = a logical file number of your choosing (1 to 127),
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
  is then yours to CHROUT first. Use SAVE instead when the bytes are
  already contiguous in memory.
- **Text files for other software.** Write `$0D` after each line; the
  drive stores it as an ordinary byte.

### Recipes

- `recipes/kickassembler/file-io-roundtrip.md`
- `recipes/oscar64/save-load-seq-file.md` (the same sequence through Oscar64's kernalio.h, with a provoked 62)

---

## kernal_file_read_seq — Read a sequential file with CHKIN/CHRIN/READST

**Complexity:** low
**Region:** both
**Uses registers:** (none)
**Uses kernal:** SETLFS, SETNAM, OPEN, CHKIN, CHRIN, READST, CLRCHN, CLOSE

### Why

The read half of kernal_file_write_seq. The trap is end-of-file: CHRIN
delivers the last byte with the carry clear, exactly as it delivered
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
4. Bound the loop by your buffer size as well as by ST.
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

---

## error_channel_check — Read the drive's status line from channel 15

**Complexity:** low
**Region:** both
**Uses registers:** (none)
**Uses kernal:** SETLFS, SETNAM, OPEN, CHKIN, CHRIN, READST, CLRCHN, CLOSE

### Why

The drive keeps one status line and the KERNAL never reads it for you.
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
   buffer (whether every 1541 message fits is not measured here).
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
code first, so the first byte alone tells you whether to look further.

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

Not measured here, from the 1541 DOS message set (rung 4): `26, WRITE
PROTECT ON` when the notch is covered; `72, DISK FULL` when the last
block goes; `74, DRIVE NOT READY` when there is no disk in the drive;
`01, FILES SCRATCHED,nn,00` after a scratch, where the track field is the
count. Codes 20 to 29 are read or write errors with the track and sector
filled in.

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

---

## kernal_load_to_address — LOAD a raw asset to an address of your choosing

**Complexity:** low
**Region:** both
**Uses registers:** (none)
**Uses kernal:** SETLFS, SETNAM, LOAD, SETMSG

### Why

Level data, a character set or a music file arrives as a PRG on the
disk: two bytes of load address, then the bytes. Sometimes the program
wants it where the file says; sometimes it wants it somewhere else, for
example the same tile file into whichever of two buffers is free. LOAD
does both, and which one is chosen by the secondary address given to
SETLFS, not by a LOAD argument.

### How

1. SETLFS with any logical file number, X = 8, and Y = 0 or 1. With
   Y = 0 the address you pass in X/Y to LOAD is used and the file's own
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
  pitfall covers what that does to a raster IRQ.

### Recipes

- `recipes/kickassembler/file-io-roundtrip.md` (write and read side;
  the LOAD measurements above came from a scratch program that is not a
  recipe)
