---
recipe: relative-file-records
toolchain: oscar64
output_format: PRG
region: both
techniques: [kernal_relative_file_io, error_channel_check]
file_formats: [PRG]
uses_registers: [D020]
uses_kernal: [SETLFS, SETNAM, OPEN, CLOSE, CHKIN, CHKOUT, CLRCHN, CHRIN, CHROUT, READST]
devices: [disk_1541_ii]
---

<!-- doc-type: recipe -->

# Oscar64 Relative File Records with kernalio.h

## Synopsis

Against a freshly formatted disk in drive 8, using Oscar64's
`kernalio.h` wrappers: create the relative file `REC` with 32-byte
records, write records 1, 3 and 5 with distinct content, read record 3
back and checksum it, read record 4, which nobody wrote, then position
on record 9, which the drive answers with `50, RECORD NOT PRESENT`,
write it and read it back. The command channel stays open for the
whole run and every reply the drive puts on it is printed, so the
positioning command's answers can be read next to the KERNAL's own
status byte. The verdict goes to `$02FF`, the border and a text line.
Use it as the skeleton for anything that wants one record out of many
without reading the file from the start: a save slot, a level bank, a
table of player names.

## Source

```c
// relative-file-records.c
// Against a fresh disk in drive 8: create the relative file REC with
// 32-byte records, write records 1, 3 and 5 with distinct content, read
// record 3 back and checksum it, read record 4 (never written, but
// inside the block the open allocated), then position on record 9,
// which answers 50, write it, and read it back. Every drive reply is
// printed. The command channel stays open for the whole run, because
// closing secondary 15 closes every channel the drive has, the REL file
// included. The verdict goes to $02FF (01 pass, 02 fail), the border
// (green, red) and a line of text.
#include <stdio.h>
#include <c64/kernalio.h>
#include <c64/vic.h>

#define DRIVE       8
#define DATA_LF     2                    // logical file and secondary address
#define CMD_LF      15
#define RECLEN      32
#define EXPECT_CHK3 0x414A               // python: same fold over record 3
#define EXPECT_CHK9 0x5FA4               // and over record 9

#define CODE_PASS   0x01
#define CODE_FAIL   0x02
#define RESULT      (*(volatile char *)0x02ff)

static char rec[RECLEN];                 // one record, out or in
static char reply[40];                   // one drive status line

// Two hex digits, upper case.
static void put_hex2(char v)
{
    char d = v >> 4;
    putchar(d < 10 ? '0' + d : 'A' + d - 10);
    d = v & 15;
    putchar(d < 10 ? '0' + d : 'A' + d - 10);
}

// Read one status line from the open command channel and print it
// after a label, ending with end (' ' or '\n'). Reading the line is
// what clears it. krnio_gets returns 0 at once if the last line left
// EOF in krnio_pstatus, so that entry is cleared first.
static void drive_reply(const char *label, char end)
{
    reply[0] = 0;
    krnio_pstatus[CMD_LF] = KRNIO_OK;
    int n = krnio_gets(CMD_LF, reply, sizeof(reply));
    if (n > 0 && reply[n - 1] == 13)
        reply[n - 1] = 0;
    printf("%s %s%c", label, reply, end);
}

// P command: "P", channel + 96, record low, record high, byte 1.
static void position(unsigned recno)
{
    char cmd[5];
    cmd[0] = 'P';
    cmd[1] = 96 + DATA_LF;
    cmd[2] = recno & 0xff;
    cmd[3] = recno >> 8;
    cmd[4] = 1;
    krnio_write(CMD_LF, cmd, 5);
}

// 32 bytes that name the record: "REC n:" then letters, no zero byte.
static void fill(unsigned recno)
{
    rec[0] = 'R';  rec[1] = 'E';  rec[2] = 'C';  rec[3] = ' ';
    rec[4] = '0' + recno;  rec[5] = ':';
    for (char i = 6; i < RECLEN; i++)
        rec[i] = 'A' + (i + recno) % 26;
}

// chk = ((chk ^ b) * 5 + 1) & 0xffff over n bytes
static unsigned fold(const char *p, int n)
{
    unsigned c = 0;
    for (int i = 0; i < n; i++)
        c = (c ^ p[i]) * 5 + 1;
    return c;
}

// Position on recno, write the record there, print both replies.
static void write_record(unsigned recno)
{
    char label[3];
    label[0] = 'P'; label[1] = '0' + recno; label[2] = 0;
    position(recno);
    drive_reply(label, ' ');
    fill(recno);
    krnio_write(DATA_LF, rec, RECLEN);
    label[0] = 'W';
    drive_reply(label, '\n');
}

// Position on recno, print the reply, read up to one record and print
// the count, the KERNAL status and the first byte, then the reply
// after the read. A 50 reply is too long to share the row, hence nl.
static int read_record(unsigned recno, bool nl)
{
    char label[3];
    label[0] = 'P'; label[1] = '0' + recno; label[2] = 0;
    position(recno);
    drive_reply(label, '\n');
    for (char i = 0; i < RECLEN; i++)
        rec[i] = 0;
    krnio_pstatus[DATA_LF] = KRNIO_OK;   // a previous EOF would short-circuit krnio_read
    int n = krnio_read(DATA_LF, rec, RECLEN);
    printf("R%u N=%d ST=", recno, n);
    put_hex2(krnio_pstatus[DATA_LF]);
    printf(" B0=");
    put_hex2(rec[0]);
    putchar(nl ? '\n' : ' ');
    label[0] = 'A';
    drive_reply(label, '\n');
    return n;
}

int main(void)
{
    char code = CODE_FAIL;
    char name[8];
    unsigned chk3, chk9;
    int n9;

    printf("%cRELATIVE FILE RECORDS (KERNALIO.H)\n", 147);

    // 1. command channel open for the whole run; the first reply is 73
    krnio_setnam("");
    if (!krnio_open(CMD_LF, DRIVE, CMD_LF)) {
        printf("NO DRIVE\n");
        RESULT = code;
        vic.color_border = 2;
        return 0;
    }
    drive_reply("ST", '\n');

    // 2. create the REL file: name, ",L," and the record length as a byte
    name[0] = 'R'; name[1] = 'E'; name[2] = 'C';
    name[3] = ','; name[4] = 'L'; name[5] = ',';
    name[6] = RECLEN;
    krnio_setnam_n(name, 7);
    printf("OPEN REC,L,%d %d ", RECLEN, krnio_open(DATA_LF, DRIVE, DATA_LF));
    drive_reply("OP", '\n');

    // 3. write records 1, 3 and 5
    write_record(1);
    write_record(3);
    write_record(5);

    // 4. record 3 back, checksummed, first eight bytes shown
    read_record(3, false);
    chk3 = fold(rec, RECLEN);
    printf("CHK ");
    put_hex2(chk3 >> 8);
    put_hex2(chk3 & 0xff);
    putchar(' ');
    for (char i = 0; i < 8; i++)
        putchar(rec[i]);
    putchar('\n');

    // 5. record 4: never written, but the open allocated the block it is in
    read_record(4, false);

    // 6. record 9: past the allocated block, so 50; then the write creates it
    read_record(9, true);
    position(9);
    drive_reply("P9", '\n');
    fill(9);
    krnio_write(DATA_LF, rec, RECLEN);
    drive_reply("W9", ' ');
    n9 = read_record(9, false);
    chk9 = fold(rec, RECLEN);

    krnio_close(DATA_LF);
    drive_reply("CL", '\n');
    krnio_close(CMD_LF);

    if (chk3 == EXPECT_CHK3 && n9 == RECLEN && chk9 == EXPECT_CHK9)
        code = CODE_PASS;
    RESULT = code;
    vic.color_border = (code == CODE_PASS) ? 5 : 2;
    printf("RESULT ");
    put_hex2(code);
    printf(code == CODE_PASS ? " PASS\n" : " FAIL\n");
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=relative-file-records.prg relative-file-records.c
```

Produces `relative-file-records.prg`. `kernalio.h` carries
`#pragma compile("kernalio.c")`, so the wrapper source is compiled in
without a second file on the command line. The run needs a disk in
drive 8:

```bash
c1541 -format "test,01" d64 test.d64
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 \
      -limitcycles 32000000 -8 test.d64 \
      -drive8wobbleamplitude 0 -drive8wobblefrequency 0 \
      -exitscreenshot relative-file-records.png -autostart relative-file-records.prg
```

## Expected output

```
RELATIVE FILE RECORDS (KERNALIO.H)
ST 73,CBM DOS V2.6 1541,00,00
OPEN REC,L,32 1 OP 00, OK,00,00
P1 00, OK,00,00 W1 00, OK,00,00
P3 00, OK,00,00 W3 00, OK,00,00
P5 00, OK,00,00 W5 00, OK,00,00
P3 00, OK,00,00
R3 N=32 ST=40 B0=52 A3 00, OK,00,00
CHK 414A REC 3:JK
P4 00, OK,00,00
R4 N=1 ST=40 B0=FF A4 00, OK,00,00
P9 50, RECORD NOT PRESENT,00,00
R9 N=1 ST=40 B0=0D
A9 50, RECORD NOT PRESENT,00,00
P9 50, RECORD NOT PRESENT,00,00
W9 00, OK,00,00 P9 00, OK,00,00
R9 N=32 ST=40 B0=52 A9 00, OK,00,00
CL 00, OK,00,00
RESULT 01 PASS

READY.
```

Light blue text on blue with a green border, `$02FF` holding `$01`.
The screen is the same on both models. Screenshots from the VICE runs
this page describes: `screenshots/relative-file-records.png` (PAL) and
`screenshots/relative-file-records-ntsc.png` (NTSC), both from the
pinned command above with a disk formatted as `TEST,01` immediately
before the run. A second run of the same command on another fresh
disk gave a byte-identical PNG on each model.

The labels are `P` for the reply to a position command, `W` for the
reply after a record was written, `R` for what `krnio_read` returned,
`A` for the reply after that read, and `CL` for the reply after the
data channel was closed. `ST=` is `krnio_pstatus[2]`, the KERNAL's
status byte as `krnio_read` last saw it; `B0=` is the first byte that
came back. Read the lines in order:

- `ST 73`: the drive's power-on banner, read once so it does not get
  mistaken for an error later. `OPEN REC,L,32 1`: `krnio_open`
  returned true, and the drive said `00, OK` to the creation of a new
  relative file. After this open, with nothing written, the disk
  already holds the file at two blocks (a fresh disk lists 664 free;
  a run that only opened and closed the file listed 662 free, with the
  directory entry showing 0 blocks until something was written).
- Records 1, 3 and 5: every position answers `00` and every write
  answers `00`, including `P3` and `P5` when the file had only one
  written record. The drive did not say `50` here, and the next two
  points say why.
- `R3 N=32 ST=40 B0=52`: the read returned all 32 bytes, the last one
  with EOF, and the first is `R` (`$52`). `CHK 414A` is the fold
  `chk = ((chk ^ b) * 5 + 1) & 0xffff` over the 32 bytes, the value
  Python computed for `REC 3:JKLMNOPQRSTUVWXYZABCDEFGHI`; the first
  eight characters follow it.
- `R4 N=1 ST=40 B0=FF`: record 4 was never written, yet the position
  answered `00` and the read returned one byte, `$FF`, with EOF. The
  drive counts it as present. A side run with the same program
  positioned on records 6, 8 and 20: 6 answered `00` and read one
  `$FF` like record 4; 8 and 20 answered `50`. Seven 32-byte records
  are 224 bytes and the eighth would run past the 254 data bytes of
  one block, so the boundary sits where one data block ends. That the
  open allocates that block and marks each record in it with `$FF` is
  the reading this page puts on the two measurements, not a separate
  one.
- `P9 50, RECORD NOT PRESENT,00,00`: the first position past the
  allocated block. The read that follows still returns one byte, but
  it is `$0D`, a carriage return, with EOF, and the status line reads
  `50` again after it. Then `P9` once more, still `50`, and the write
  of 32 bytes answers `00, OK`: the write is what creates the record.
  The next `P9` answers `00`, the read returns 32 bytes starting with
  `R`, and the verdict includes this read-back (fold `5FA4`). After
  the run `c1541 -attach test.d64 -list` printed
  `3    "rec"              rel` and `661 blocks free.`, one more block
  than after the writes to 1, 3 and 5.
- `51` was provoked in the same side run, not in the pinned one: a
  write of 33 bytes to record 1 answered `51,OVERFLOW IN RECORD,00,00`
  (no space after the comma, as the ROM spells it; see
  `../../formats/iec-disk-reference.md`, "The 1541 DOS Error Codes").
  Neither `50` nor `51` shows up in `ST`: the KERNAL byte stayed `$40`
  or `$00` throughout, and only channel 15 knows.

Cycle cost was not measured here. The limit of 32,000,000 cycles is
what the pinned run needs to reach `READY.` on both models with room
to spare; the same program stopped at 24,000,000 cycles in a control
run without the record 9 steps and also reached `READY.`.

## Why this works

A relative file is opened like any other, with the type letter `L`
and one extra byte: `krnio_setnam_n(name, 7)` sends `REC,L,` followed
by the byte 32, the record length, and `krnio_open(2, 8, 2)` is SETLFS
plus OPEN on data channel 2. `krnio_setnam_n` is used rather than
`krnio_setnam` so the length byte need not be a printable character;
for 32 it happens to be a space, but a shorter record would put a
control code in a C literal and a length of 0 could not go through one
at all. On an existing file the same name opens it again; that the
length byte can then be left off is the DOS rule, not measured here.

The drive keeps a record pointer for each relative file it has open,
and the P command on the command channel moves it: the letter `P`, the
channel number plus 96 (`$60 + 2` here, the drive's own secondary-
address encoding), the record number low byte then high byte, counted
from 1, and the byte offset inside the record, also from 1. The
program sends those five bytes with `krnio_write(15, cmd, 5)` and then
reads the reply, because the reply to a P is the only place the drive
says whether the record exists. The P must be sent before every read
and every write, not just the first: the pointer advances as bytes
move, and a read stops at the end of the record's data (the drive
raises EOI there), so the next read without a P would start on the
next record.

Reading channel 15 with the data file open is safe; closing it is not.
CLOSE of secondary 15 tells the drive to close every channel it has,
which would drop the REL file and lose the drive's pointer, so the
program opens channel 15 once and closes it last. `krnio_gets` needs
one more line of help: it returns 0 at once if `krnio_pstatus[15]`
still holds the EOF the previous status line ended with, and an
earlier draft of this program printed empty replies after the first
for exactly that reason. `drive_reply` clears the entry before every
read, and `read_record` does the same for the data channel.

What comes back from a record is its data up to the last non-zero
byte. The program fills every byte of a record with a letter so 32
come back; a record padded with zeros would return fewer, and a
never-written record inside an allocated block returns the single
`$FF` the drive put there. All of this is the 1541's own behaviour as
VICE emulates it: the KERNAL routines underneath are the ones
`techniques/file-io.md` describes for `kernal_relative_file_io` and
`error_channel_check`, and none of them know what a record is.

No `P""` prefix is needed on the literals. Oscar64 string literals
are ASCII by default, and ASCII and PETSCII agree on digits,
punctuation and upper-case letters, so `REC,L,` and the printed labels
are the same bytes either way; `oscar64.md` covers the case where they
would not be.
