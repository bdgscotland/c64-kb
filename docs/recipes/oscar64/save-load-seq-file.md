---
recipe: save-load-seq-file
toolchain: oscar64
output_format: PRG
region: both
techniques: [kernal_file_write_seq, kernal_file_read_seq, error_channel_check]
file_formats: [PRG]
uses_registers: [DD04, DD05, DD06, DD07, DD0E, DD0F]
uses_kernal: [SETLFS, SETNAM, OPEN, CLOSE, CHKIN, CHKOUT, CLRCHN, CHRIN, CHROUT, READST]
devices: [disk_1541_ii]
---

<!-- doc-type: recipe -->

# Oscar64 Save and Load a SEQ File with kernalio.h

## Synopsis

Against a freshly formatted disk in drive 8, using Oscar64's
`kernalio.h` wrappers: read the drive's status line and print it, write
a three-entry score table (18 bytes) as the sequential file `SCORES`
with `krnio_setnam` / `krnio_open` / `krnio_write` / `krnio_close`,
read it back with `krnio_read` into a buffer larger than the file,
compare, print `MATCH` and a 16-bit checksum of the bytes that came
back against the value Python computed, then open a file that is not
on the disk and print the drive's `62` reply. `krnio_status()` is
printed after every call, so the KERNAL's own ST byte can be read next
to the drive's reply on the same screen. Use it as the skeleton for a
save slot or a high-score file, and as the thing to run when a disk
routine misbehaves, to tell whether the drive or the program
is at fault.

## Source

```c
// save-load-seq-file.c
// Against a fresh disk in drive 8: read the drive's status line, write a
// three-entry score table as the SEQ file SCORES through Oscar64's
// kernalio.h, read it back into a second buffer, compare, fold the bytes
// that came back into a 16-bit checksum shown with PASS or FAIL against
// the value Python computed, then open a file that does not exist and
// print the drive's reply. krnio_status() is printed after every call so
// the KERNAL's own ST byte can be read against the drive's reply, and
// CIA2's timers count the cycles each transfer took.
#include <stdio.h>
#include <c64/kernalio.h>

#define DRIVE       8
#define EXPECT_CHK  0xCD2A           // python: same fold over the 18 bytes

typedef struct {
    char     name[4];                // three letters and a terminating zero
    unsigned score;                  // 16 bits, stored low byte first
} Score;

typedef struct {
    Score entry[3];
} Table;                             // 18 bytes: no padding in Oscar64

static const Table saved = {{
    { "ABC", 12000 },
    { "DEF",  9500 },
    { "GHI",   700 }
}};

static char back[32];                // bigger than the file on purpose
static char reply[40];               // one drive status line

// CIA2 timers A and B chained as a free-running 32-bit cycle counter.
// The KERNAL serial code runs with interrupts off, so the jiffy clock
// loses most of the time a drive transfer takes; this counter does not.
#define CIA2 ((volatile char *)0xdd00)

static void counter_start(void)
{
    CIA2[4] = 0xff;  CIA2[5] = 0xff;      // timer A from $FFFF
    CIA2[6] = 0xff;  CIA2[7] = 0xff;      // timer B from $FFFF
    CIA2[15] = 0x41;                      // B: start, count A underflows
    CIA2[14] = 0x01;                      // A: start, continuous
}

static unsigned long counter_now(void)   // cycles since counter_start
{
    volatile char *c = CIA2;
    unsigned lo = c[4] | ((unsigned)c[5] << 8);
    unsigned hi = c[6] | ((unsigned)c[7] << 8);
    return ~(((unsigned long)hi << 16) | lo);
}

// Two hex digits, upper case, through the KERNAL screen editor.
static void put_hex2(char v)
{
    char d = v >> 4;
    putchar(d < 10 ? '0' + d : 'A' + d - 10);
    d = v & 15;
    putchar(d < 10 ? '0' + d : 'A' + d - 10);
}

static void put_hex4(unsigned v)
{
    put_hex2(v >> 8);
    put_hex2(v & 0xff);
}

// Open the command channel and read one status line; the channel stays
// open. Prints the line without its trailing CR and returns whether the
// channel opened. drive_reply closes it again.
static bool drive_ask(void)
{
    reply[0] = 0;
    krnio_setnam("");
    bool open = krnio_open(15, DRIVE, 15);
    if (open) {
        int n = krnio_gets(15, reply, sizeof(reply));
        if (n > 0 && reply[n - 1] == 13)
            reply[n - 1] = 0;
    }
    printf("DRIVE: %s\n", reply);
    return open;
}

static void drive_reply(void)
{
    if (drive_ask())
        krnio_close(15);
}

// chk = ((chk ^ b) * 5 + 1) & 0xffff over n bytes
static unsigned fold(const char *p, int n)
{
    unsigned c = 0;
    for (int i = 0; i < n; i++)
        c = (c ^ p[i]) * 5 + 1;
    return c;
}

int main(void)
{
    unsigned long t0, tw, tr;
    int n, i;
    bool ok;

    counter_start();
    printf("%cSAVE/LOAD SEQ FILE (KERNALIO.H)\n", 147);

    // 1. the error channel before anything else: a fresh drive says 73
    printf("STATUS 1\n");
    drive_reply();

    // 2. write the table as SCORES,S,W on logical file 2, secondary 2
    printf("WRITE SCORES,S,W %d BYTES\n", (int)sizeof(saved));
    t0 = counter_now();
    krnio_setnam("SCORES,S,W");
    ok = krnio_open(2, DRIVE, 2);
    printf("OPEN %d ST=", ok);   put_hex2(krnio_status());
    n = krnio_write(2, (const char *)&saved, sizeof(saved));
    printf(" WRITE %d ST=", n);   put_hex2(krnio_status());
    krnio_close(2);
    printf(" CLOSE ST=");         put_hex2(krnio_status());
    putchar('\n');
    tw = counter_now() - t0;
    drive_reply();

    // 3. read it back into a bigger buffer; the read stops at EOF
    printf("READ SCORES,S,R INTO %d BYTES\n", (int)sizeof(back));
    t0 = counter_now();
    krnio_setnam("SCORES,S,R");
    ok = krnio_open(2, DRIVE, 2);
    printf("OPEN %d ST=", ok);   put_hex2(krnio_status());
    n = krnio_read(2, back, sizeof(back));
    printf(" READ %d ST=", n);    put_hex2(krnio_pstatus[2]);
    krnio_close(2);
    printf(" CLOSE ST=");         put_hex2(krnio_status());
    putchar('\n');
    tr = counter_now() - t0;
    drive_reply();

    // 4. compare length and bytes, then decode one entry from the copy
    ok = (n == sizeof(saved));
    for (i = 0; ok && i < n; i++)
        if (back[i] != ((const char *)&saved)[i])
            ok = false;
    const Table *loaded = (const Table *)back;
    printf("%s %s %u\n", ok ? "MATCH" : "MISMATCH",
           loaded->entry[0].name, loaded->entry[0].score);

    // 5. checksum of what came back
    unsigned chk = fold(back, n);
    printf("CHK ");
    put_hex4(chk);
    printf(chk == EXPECT_CHK ? " PASS\n" : " FAIL\n");

    // 6. provoke 62: open a file that is not on the disk. Ask the drive
    //    before reading, and read only on 00: after 62 the drive has no
    //    channel, and a read would TALK to it, which can hang for ever
    //    (pitfall first_open_after_reset_hangs_on_pal). Channel 15 is
    //    closed after channel 4: closing 15 closes every file on the drive.
    printf("OPEN NOFILE,S,R\n");
    krnio_setnam("NOFILE,S,R");
    ok = krnio_open(4, DRIVE, 4);
    printf("OPEN %d ST=", ok);   put_hex2(krnio_status());
    putchar('\n');
    bool cmd = drive_ask();
    if (ok && reply[0] == '0' && reply[1] == '0') {
        n = krnio_read(4, back, sizeof(back));
        printf("READ %d ST=", n);    put_hex2(krnio_pstatus[4]);
    } else
        printf("NOT READ");
    putchar('\n');
    krnio_close(4);
    if (cmd)
        krnio_close(15);

    printf("CYCLES WRITE $");
    put_hex4(tw >> 16);  put_hex4(tw & 0xffff);
    printf(" READ $");
    put_hex4(tr >> 16);  put_hex4(tr & 0xffff);
    putchar('\n');
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=save-load-seq-file.prg save-load-seq-file.c
```

Produces `save-load-seq-file.prg`. `kernalio.h` carries
`#pragma compile("kernalio.c")`, so the wrapper source is compiled in
without a second file on the command line. The run needs a disk in
drive 8:

```bash
c1541 -format "test,01" d64 test.d64
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 \
      -limitcycles 16000000 -8 test.d64 \
      -exitscreenshot save-load-seq-file.png -autostart save-load-seq-file.prg
```

## Expected output

```
SAVE/LOAD SEQ FILE (KERNALIO.H)
STATUS 1
DRIVE: 73,CBM DOS V2.6 1541,00,00
WRITE SCORES,S,W 18 BYTES
OPEN 1 ST=00 WRITE 18 ST=00 CLOSE ST=00
DRIVE: 00, OK,00,00
READ SCORES,S,R INTO 32 BYTES
OPEN 1 ST=00 READ 18 ST=40 CLOSE ST=40
DRIVE: 00, OK,00,00
MATCH ABC 12000
CHK CD2A PASS
OPEN NOFILE,S,R
OPEN 1 ST=00
DRIVE: 62, FILE NOT FOUND,00,00
NOT READ
CYCLES WRITE $003A7A60 READ $0007CE9C

READY.
```

Light blue text on blue, the ordinary power-on screen. The `CYCLES`
line is the run's own measurement and is the only line that differs
between regions: the NTSC picture shows `$003CDB03` and `$00081937` (both regions with the emulated drive's RPM wobble switched off, as the verifier pins it; an earlier version of this page quoted a run with VICE's default wobble, which moves these figures by a few hundred cycles between runs).
Screenshots from the VICE runs this page describes:
`screenshots/save-load-seq-file.png` (PAL) and
`screenshots/save-load-seq-file-ntsc.png` (NTSC), both from the pinned
command above with a disk formatted as `TEST,01` immediately before the
run. A second PAL run of the same command on another fresh disk gave a
pixel-identical PNG.

Read the lines in pairs. `ST=` is `krnio_status()`, the KERNAL's status
byte (READST, `$FFB7`). `DRIVE:` is the text the 1541 itself put on its
command channel. They answer different questions:

- The first status line is `73`, not `00`. A 1541 answers its first
  status read after reset with its DOS banner, and VICE's drive resets
  with the machine; read this line once before judging the code.
- Write: `krnio_open` returns 1 and ST stays `00` through the write and
  the close. `krnio_write` returns 18, the count it was asked for. Per
  `kernalio.c` it never reads ST inside its loop, so 18 means the bytes
  were handed to CHROUT, not that they reached the disk. The drive's
  `00, OK` after the close is what says they did.
- Read into a 32-byte buffer: `krnio_read` returns 18, the file's real
  length, and `krnio_pstatus[2]` holds `$40`. `KRNIO_EOF` is the bit
  the last byte arrives with; `krnio_read` stores that byte and stops
  (`kernalio.c`), and a further `krnio_read` on the same file number
  returns 0 without touching the bus. ST still reads `$40` after the
  close.
- Missing file: `krnio_open` returns 1 and ST is `00`. KERNAL OPEN's
  carry flag reports device-not-present or too-many-files, never a DOS
  error, so a true from `krnio_open` is not a found file. The drive's
  reply is `62, FILE NOT FOUND,00,00`, and the listing then does not
  read. Reading channel 15 is the only way to get that text. An earlier
  version read first: `krnio_read` returned 0 with ST `$42`, EOF plus a
  read timeout, and only then read the reply. That read sends a TALK to
  a channel the drive does not have, which can hang for ever on PAL
  (`../../pitfalls/kernal-and-io.md`,
  `first_open_after_reset_hangs_on_pal`). Channel 15 stays open until
  channel 4 is closed, because closing the command channel closes every
  file on the drive.

The cycle figures come from CIA2 timers A and B chained as a 32-bit
counter, measured in VICE x64sc with true drive emulation, and cover
the open, transfer and close of each step (PAL: write 3,832,416 cycles,
read 511,644; NTSC: 3,988,227 and 530,743; the build before #93 changed
step 6 read 3,836,200 and 511,742, 3,989,946 and 530,736: moving the
code moved the phase by a few thousand cycles). The write costs seven times
the read; the likely reason is that the drive writes the data block,
the directory and the BAM at close, but that split was not measured
here. An earlier draft printed the KERNAL jiffy clock
instead and showed 0 and 2 jiffies: the serial routines run with
interrupts off, so the jiffy clock loses most of a transfer.

After the run the disk holds the file. `c1541 -attach test.d64 -list`
printed:

```
0 "test            " 01 2a
1    "scores"           seq
663 blocks free.
```

One SEQ entry, no `*` splat. `c1541 -attach test.d64 -read "scores,s"
scores.bin` followed by `xxd scores.bin` printed the table byte for
byte, each entry a zero-padded 4-byte name and a little-endian 16-bit
score:

```
00000000: 4142 4300 e02e 4445 4600 1c25 4748 4900  ABC...DEF..%GHI.
00000010: bc02                                     ..
```

The `-read` argument needs the `,s`: c1541 looks for a PRG by
default, and `-read scores` on this disk answered `ERR = 62, FILE NOT
FOUND, 00, 00`. Python's fold `chk = ((chk ^ b) * 5 + 1) & 0xffff`
over those 18 bytes gives `0xCD2A`, the value compiled in as
`EXPECT_CHK` and printed with `PASS`. The same 18 bytes compared equal
to the struct built in Python from the three names and scores, so
Oscar64 laid the struct out with no padding.

Error 26 was provoked as well, in a control run that is not the pinned
one: the same PRG with `-attach8ro -8 test.d64` (x64sc: "Attach disk
image for drive #8:0 read only") printed, at the write step,
`OPEN 1 ST=00 WRITE 18 ST=80 CLOSE ST=80` and
`DRIVE: 26, WRITE PROTECT ON,18,00`; the read step then answered `62`,
the compare said `MISMATCH`, and the disk stayed empty (`664 blocks
free`). The trailing `18,00` are the reply's track and sector fields;
18 is the directory track, and why the drive names it was not traced
here. ST `$80` is `KRNIO_NODEVICE` in the header's enum, the bit the
KERNAL sets when the drive stops answering. So a write-protected disk
shows up in ST during the write, before anyone reads channel 15, while
a missing file does not show up in ST until the read.

## Why this works

`krnio_open(fnum, device, channel)` is SETLFS plus OPEN; on carry set
it closes the file and returns false, and it clears
`krnio_pstatus[fnum]`. `krnio_write` is CHKOUT, a CHROUT loop, CLRCHN.
`krnio_read` is CHKIN, then CHRIN and READST per byte until the count
is met or ST is non-zero; it records ST in `krnio_pstatus[fnum]`,
keeps the byte that arrived with `KRNIO_EOF` and drops the one that
arrived with any other error. `krnio_gets` is the same loop stopped at
CR or LF with the terminator kept and a zero appended, which is why
`drive_reply` strips the CR before printing. All of this is read from
`kernalio.c` beside the header; the KERNAL routines behind it are the
ones `techniques/file-io.md` describes for `kernal_file_write_seq`,
`kernal_file_read_seq` and `error_channel_check`.

The filename does the work `SETLFS` cannot: `SCORES,S,W` asks the DOS
for a sequential file opened for writing on data channel 2, and
`SCORES,S,R` opens the same file for reading. On a disk that already
holds `SCORES` the write open would be refused with `63, FILE EXISTS`,
and `krnio_open` would still return true; prefix the name with `@0:`
to replace, as the Oscar64 sample `samples/kernalio/filewrite.c` does.
The command channel is secondary address 15 with an empty name:
`krnio_setnam("")` sends a zero-length name, and `krnio_gets(15, ...)`
reads one reply line, which the DOS clears once it has been read.

No `P""` prefix is needed on these literals. Oscar64 string literals
are ASCII by default, and the KERNAL wants PETSCII, but the two
encodings agree on digits, punctuation and upper-case letters, so
`"SCORES,S,W"` is the same bytes either way. A lower-case or shifted
name would not be; `p"..."` (or building with `-psci`) makes the
literal PETSCII, per `oscar64.md`. The screen text is unchanged for
the same reason: `printf` goes through `putpch` in `conio.c`, which in
its default `IOCHM_ASCII` mode maps only `\n` to CR and passes letters
through, so the drive's own PETSCII reply prints correctly and the
program's upper-case labels print as upper case. The hex digits are
printed by `put_hex2` rather than `%x` so that `A` to `F` are
upper-case bytes the default font shows as letters.
