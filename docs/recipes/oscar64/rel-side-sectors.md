---
recipe: rel-side-sectors
toolchain: oscar64
output_format: PRG
region: both
techniques: [kernal_relative_file_io, error_channel_check]
file_formats: [PRG, D64]
uses_registers: [D020]
uses_kernal: [SETLFS, SETNAM, OPEN, CLOSE, CHKIN, CHKOUT, CLRCHN, CHRIN, CHROUT, READST]
---

<!-- doc-type: recipe -->

# Oscar64 REL File Side Sectors: What the 1541 Writes to the Disk

## Synopsis

Against a freshly formatted disk in drive 8, using Oscar64's
`kernalio.h` wrappers: create the relative file `SS` with 100-byte
records, write records 1 to 8 with record 3 cut short at ten bytes,
read record 3 back, position on record 20, which is past the end, and
read it, then read the directory block and the file's side sector back
through a buffer channel with `U1` and print the bytes that describe
the file: the type byte, the first data block, the side-sector block,
the record length, the side sector's own header and its list of data
blocks. Every drive reply is printed as its two-digit code so the `50`
on a record that starts past the last allocated block can be read next
to the `00` on one that does not. The verdict goes to `$02FF`, the
border and a text line. Use it when a program needs to know how much
disk a REL file will take, or to check a REL file on an image without
trusting the directory listing.

## Source

```c
// rel-side-sectors.c
// Against a fresh disk in drive 8: create the relative file SS with
// 100-byte records, write records 1 to 8 (record 3 short, ten bytes, so
// the drive pads it), read record 3 back, position on record 20, past
// the end, and read it, then read the directory block 18/1 and the
// file's side sector through a buffer channel with U1 and print the
// bytes that describe the file. Every drive reply is printed as its
// two-digit code. The command channel stays open for the whole run.
// The verdict goes to $02FF (01 pass, 02 fail), the border (green,
// red) and a line of text.
#include <stdio.h>
#include <c64/kernalio.h>
#include <c64/vic.h>

#define DRIVE       8
#define DATA_LF     2                    // logical file and secondary address
#define BUF_LF      5                    // buffer channel for U1
#define CMD_LF      15
#define RECLEN      100
#define LAST_REC    8
#define SHORT_REC   3
#define SHORT_LEN   10

#define CODE_PASS   0x01
#define CODE_FAIL   0x02
#define RESULT      (*(volatile char *)0x02ff)

static char rec[RECLEN];                 // one record, out or in
static char reply[40];                   // one drive status line
static char blk[256];                    // one disk block

// Two hex digits, upper case.
static void put_hex2(char v)
{
    char d = v >> 4;
    putchar(d < 10 ? '0' + d : 'A' + d - 10);
    d = v & 15;
    putchar(d < 10 ? '0' + d : 'A' + d - 10);
}

// Read one status line from the open command channel. Reading the line
// is what clears it. krnio_gets returns 0 at once if the last line left
// EOF in krnio_pstatus, so that entry is cleared first.
static void drive_read(void)
{
    reply[0] = 0;
    krnio_pstatus[CMD_LF] = KRNIO_OK;
    int n = krnio_gets(CMD_LF, reply, sizeof(reply));
    if (n > 0 && reply[n - 1] == 13)
        reply[n - 1] = 0;
}

// Print a label and the whole reply line.
static void drive_reply(const char *label, char end)
{
    drive_read();
    printf("%s %s%c", label, reply, end);
}

// Print a label and only the two-digit code of the reply.
static void drive_code(const char *label, char end)
{
    drive_read();
    printf("%s %c%c%c", label, reply[0], reply[1], end);
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

// n bytes that name the record: "REC n:" then letters, no zero byte.
static void fill(unsigned recno, char n)
{
    rec[0] = 'R';  rec[1] = 'E';  rec[2] = 'C';  rec[3] = ' ';
    rec[4] = '0' + recno;  rec[5] = ':';
    for (char i = 6; i < n; i++)
        rec[i] = 'A' + (i + recno) % 26;
}

// Position on recno, write n bytes there, print both reply codes.
static void write_record(unsigned recno, char n)
{
    char label[3];
    label[0] = 'P'; label[1] = '0' + recno; label[2] = 0;
    position(recno);
    drive_code(label, ' ');
    fill(recno, n);
    krnio_write(DATA_LF, rec, n);
    label[0] = 'W';
    drive_code(label, (recno % 3 == 0 || recno == LAST_REC) ? '\n' : ' ');
}

// Position on recno, print the reply code, read up to one record and
// print the count, the KERNAL status and the first byte, then the reply
// code after the read.
static int read_record(unsigned recno)
{
    printf("P%u", recno);
    position(recno);
    drive_code("", ' ');
    for (char i = 0; i < RECLEN; i++)
        rec[i] = 0;
    krnio_pstatus[DATA_LF] = KRNIO_OK;   // a previous EOF would short-circuit krnio_read
    int n = krnio_read(DATA_LF, rec, RECLEN);
    printf("R%u N=%d ST=", recno, n);
    put_hex2(krnio_pstatus[DATA_LF]);
    printf(" B0=");
    put_hex2(rec[0]);
    drive_code(" A", '\n');
    return n;
}

// Read the block at track t, sector s into blk through the buffer
// channel: "U1 channel drive track sector", then 256 bytes.
static int read_block(char t, char s)
{
    char cmd[16];
    int i = 0;
    cmd[i++] = 'U'; cmd[i++] = '1'; cmd[i++] = ' ';
    cmd[i++] = '0' + BUF_LF; cmd[i++] = ' '; cmd[i++] = '0'; cmd[i++] = ' ';
    cmd[i++] = '0' + t / 10; cmd[i++] = '0' + t % 10; cmd[i++] = ' ';
    cmd[i++] = '0' + s / 10; cmd[i++] = '0' + s % 10;
    krnio_write(CMD_LF, cmd, i);
    drive_code("U", ' ');
    for (int k = 0; k < 256; k++)
        blk[k] = 0;
    krnio_pstatus[BUF_LF] = KRNIO_OK;
    return krnio_read(BUF_LF, blk, 256);
}

int main(void)
{
    char code = CODE_FAIL;
    char name[8];
    char sst, sss, ndata;
    int n3, n20;
    bool r3ok;

    printf("%cREL SIDE SECTORS (L=%d)\n", 147, RECLEN);

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
    name[0] = 'S'; name[1] = 'S';
    name[2] = ','; name[3] = 'L'; name[4] = ',';
    name[5] = RECLEN;
    krnio_setnam_n(name, 6);
    printf("OPEN SS,L,%d %d ", RECLEN, krnio_open(DATA_LF, DRIVE, DATA_LF));
    drive_reply("OP", '\n');

    // 3. write records 1 to 8, record 3 short
    for (unsigned r = 1; r <= LAST_REC; r++)
        write_record(r, r == SHORT_REC ? SHORT_LEN : RECLEN);

    // 4. record 3 back: ten bytes, the padding is not sent
    n3 = read_record(SHORT_REC);
    r3ok = rec[0] == 'R' && rec[4] == '3' && rec[SHORT_LEN] == 0;

    // 5. record 20: past the last block, so 50 before and after the read
    n20 = read_record(20);

    // 6. directory block 18/1, first entry at byte 2
    krnio_setnam("#");
    krnio_open(BUF_LF, DRIVE, BUF_LF);
    read_block(18, 1);
    sst = blk[0x15]; sss = blk[0x16];
    printf("DIR ");
    put_hex2(blk[0x02]);
    printf(" TS=%d,%d SS=%d,%d L=%d BL=%d\n",
           blk[0x03], blk[0x04], sst, sss, blk[0x17], blk[0x1e]);

    // 7. the side sector: bytes 0 to 9, then the data block list
    read_block(sst, sss);
    printf("SS");
    for (char i = 0; i < 10; i++) {
        putchar(' ');
        put_hex2(blk[i]);
    }
    printf("\nDB");
    ndata = 0;
    for (char i = 16; blk[i] != 0; i += 2) {
        printf(" %d,%d", blk[i], blk[i + 1]);
        ndata++;
    }
    putchar('\n');
    krnio_close(BUF_LF);

    krnio_close(DATA_LF);
    drive_reply("CL", '\n');
    krnio_close(CMD_LF);

    if (n3 == SHORT_LEN && r3ok && n20 == 1
        && blk[2] == 0 && blk[3] == RECLEN && ndata >= 4)
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
oscar64 -tm=c64 -O2 -o=rel-side-sectors.prg rel-side-sectors.c
```

Produces `rel-side-sectors.prg`. `kernalio.h` carries
`#pragma compile("kernalio.c")`, so the wrapper source is compiled in
without a second file on the command line. The run needs a disk in
drive 8 with true drive emulation, because the side sectors are laid
out by the drive's own ROM:

```bash
c1541 -format "TEST,01" d64 test.d64
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 \
      -limitcycles 60000000 -8 test.d64 -drive8truedrive \
      -drive8wobbleamplitude 0 -drive8wobblefrequency 0 \
      -exitscreenshot rel-side-sectors.png -autostart rel-side-sectors.prg
```

## Expected output

```
REL SIDE SECTORS (L=100)
ST 73,CBM DOS V2.6 1541,00,00
OPEN SS,L,100 1 OP 00, OK,00,00
P1 00 W1 00 P2 00 W2 00 P3 50 W3 00
P4 00 W4 00 P5 00 W5 00 P6 50 W6 00
P7 00 W7 00 P8 50 W8 00
P3 00 R3 N=10 ST=40 B0=52 A 00
P20 50 R20 N=1 ST=40 B0=0D A 50
U 00 DIR 84 TS=17,0 SS=17,10 L=100 BL=0
U 00 SS 00 17 00 64 11 0A 00 00 00 00
DB 17,0 17,11 17,1 17,12
CL 00, OK,00,00
RESULT 01 PASS

READY.
```

Light blue text on blue with a green border, `$02FF` holding `$01`.
The screen is the same on both models. Screenshots from the VICE runs
this page describes: `screenshots/rel-side-sectors.png` (PAL) and
`screenshots/rel-side-sectors-ntsc.png` (NTSC), both from the pinned
command above with a disk formatted as `TEST,01` immediately before
the run. A second run of the same command on another fresh disk gave
a byte-identical PNG on each model.

Read the lines in order:

- `P1 00 W1 00 P2 00 W2 00 P3 50 W3 00`: two 100-byte records fit in
  the 254 data bytes of the block the open allocated, so positions 1
  and 2 answer `00` before anything is written. Record 3 starts at
  byte 200 and runs past the block, so its position answers `50,
  RECORD NOT PRESENT` and the write that follows extends the file and
  answers `00`. The same pattern repeats at 6 (byte 500, past the
  second block's 508) and 8 (byte 700, past 762). A `50` is where any
  byte of the record would lie beyond the last allocated data block; a
  record that fits whole inside the allocated blocks answers `00`
  whether or not it was ever written, as 2, 4, 5 and 7 show.
  Record 3's first byte, 200, is inside the first block; it is
  the tail that does not fit.
- `P3 00 R3 N=10 ST=40 B0=52 A 00`: record 3 was written as ten bytes
  and comes back as ten, with EOF on the last. The other ninety bytes
  are on the disk as `$00`, which the host decode below shows, and the
  drive does not send them.
- `P20 50 R20 N=1 ST=40 B0=0D A 50`: past the end, the read returns
  one carriage return and the status stays `50`.
- `U 00 DIR 84 TS=17,0 SS=17,10 L=100 BL=0`: the first directory
  entry in block 18/1, read while the file is still open. Type byte
  `$84` (REL, closed bit set already), first data block 17/0, side
  sector 17/10, record length 100, and a block count of 0: the count
  is written at close. After the run the host read 5 from the same
  field.
- `U 00 SS 00 17 00 64 11 0A 00 00 00 00`: the first ten bytes of the
  side sector. Next track 0 means this is the last side sector, and
  the byte after it, `$17` = 23, is then the index of the last used
  byte in the block: the list starts at byte 16 and four pairs end at
  byte 23. Byte 2 is the side sector's number, 0. Byte 3 is the
  record length, `$64` = 100. Bytes 4 to 15 list the track and sector
  of every side sector in the group, `11 0A` = 17/10 for this one and
  zeros for the five that do not exist.
- `DB 17,0 17,11 17,1 17,12`: the data blocks, in file order, read
  from byte 16 onwards. Four blocks hold records 1 to 8 (800 bytes
  need four blocks of 254).

`ST=40` is the KERNAL status after each read: EOF only. `50` never
reaches it; only channel 15 knows. The limit of 60,000,000 cycles is
what the pinned run needs to reach `READY.` on both models with room
to spare; the cycle cost of the run was not measured here.

## Why this works

The file is created and written exactly as `relative-file-records.md`
does it, and that page explains the open string, the five-byte P
command, why the command channel stays open, and why `krnio_gets`
needs its status entry cleared. What this recipe adds is the look at
the disk from the C64 side. A `#` open on secondary 5 borrows one of
the drive's buffers; `U1 5 0 18 1` on the command channel reads track
18 sector 1 into it and leaves the buffer pointer at byte 0, so a
`krnio_read` of 256 bytes on channel 5 returns the whole block, with
EOI on the last byte. `U1` is used rather than `B-R` because `B-R`
takes the block's first byte as the count of bytes to hand back and
starts at byte 1. Measured on a fresh disk with a scratch program, not
the listing above: `B-R 5 0 18 0`, where byte 0 is the link track 18,
returned 18 bytes and the first of them was the link sector `$01`;
`B-R 5 0 18 1`, where byte 0 is `$00` because 18/1 is the last
directory block, returned 256 bytes, the first of them byte 1's `$FF`;
`U1` on the same two blocks returned 256 bytes each, starting with
bytes 0 and 1 of the block, `$12 $01` and `$00 $FF`. A directory
entry read through `B-R` would therefore be shifted by one byte and,
on 18/0, cut off at the eighteenth. The same `U1` with the side sector's track and
sector, taken from bytes `$15` and `$16` of the entry, reads the side
sector.

The directory entry is decoded at the offsets `../../formats/c64-file-formats.md`
gives for the `.D64` entry: type at `$02`, first block at `$03`,
side sector at `$15`, record length at `$17`, block count at `$1E`.
The side sector's layout is decoded on the same page under "REL file",
from the image this run left behind: the drive itself wrote every byte
this program prints, so the page and the screen are two readings of
one object. The verdict checks the record read-back, the `50`, the
side sector's number and record length, and that at least four data
blocks are listed; it does not check the block numbers, because the
drive's choice of sectors is its own and this page only reports the
one it made here (17/0, 17/11, 17/1, 17/12, an interleave of ten with
the wrap the track's 21 sectors force).

A second run of a scratch reader against the disk this program left
(not the pinned run) opened `SS,L,` with the same length byte, and
`P` to record 5 byte 1 read 100 bytes starting `REC 5:`; `P` to record
5 byte 7 read 94 bytes starting at the seventh; `P` to record 10
answered `00` and read one `$FF`, the mark the drive puts at the start
of every record it has allocated but nobody has written; `P` to record
11 answered `50`. Ten 100-byte records fit the four blocks (1,016
bytes), so records 9 and 10 exist on the disk without anyone writing
them, and record 11 does not.
