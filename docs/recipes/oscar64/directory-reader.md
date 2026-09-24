---
recipe: directory-reader
toolchain: oscar64
output_format: PRG
region: both
techniques: [directory_read_and_select, kernal_file_read_seq, kernal_file_write_seq, error_channel_check, joystick_edge_detect]
file_formats: [PRG, D64]
uses_registers: [DC00, D012, D020, DD04, DD05, DD06, DD07, DD0E, DD0F]
uses_kernal: [SETLFS, SETNAM, OPEN, CLOSE, CHKIN, CHKOUT, CLRCHN, CHRIN, CHROUT, READST]
devices: [disk_1541_ii]
---

<!-- doc-type: recipe -->

# Oscar64 Directory Reader and File Selector

## Synopsis

Against a freshly formatted disk in drive 8: write three small files
with known names and sizes (`ALPHA` 50 bytes, `BRAVO` 300 bytes and
`CHARLIE` 600 bytes, the third opened as a PRG), open the directory as
the file `$` on a data channel, stream it through CHKIN and CHRIN into
a buffer, parse every line into a table of name, block count and file
type, print the table, and let a joystick in port 2 move a highlight
and pick one entry. An autopilot presses down once and then fire
through the same edge logic, so the pinned picture shows the second
entry picked. The verdict compares the parsed table with the three
files just written: `$02FF` = 1 and a green border on PASS, 2 and red
on FAIL. The drive's status is read after the write and after the
directory read, and CIA2's timers count the transfer and the parse
separately. Use it as the skeleton for a loader menu or a save slot
picker. The technique is `directory_read_and_select` in
`techniques/file-io.md`.

## Source

```c
// directory-reader.c
// Against a fresh disk in drive 8: write three small files with known
// names and sizes, open the directory as the file "$" on a data channel,
// stream it through CHKIN and CHRIN into a buffer, parse every line into
// a table of name, block count and file type, print the table, and let a
// joystick in port 2 move a highlight and pick one entry. An autopilot
// feeds the same input path (down once, then fire) so the picture proves
// the selector as well as the parse. The verdict is the parsed table
// against the names, types and block counts of the files just written:
// $02FF = 1 and a green border on PASS, 2 and red on FAIL.
#include <stdio.h>
#include <c64/kernalio.h>
#include <c64/joystick.h>

#define DRIVE       8
#define DIR_LFN     2                    // logical file for "$"
#define DIR_MAX     16                   // entries the table can hold
#define TABLE_ROW   7                    // screen row of the first entry
#define RESULT      (*(volatile char *)0x02ff)
#define BORDER      (*(volatile char *)0xd020)
#define RASTER      (*(volatile char *)0xd012)
#define SCREEN      ((char *)0x0400)

#ifndef AUTOPILOT
#define AUTOPILOT 1
#endif

typedef struct {
    char     name[17];               // up to 16 PETSCII bytes plus zero
    char     type[4];                // PRG, SEQ, REL, USR or DEL
    unsigned blocks;                 // the line number of the "$" line
    bool     splat;                  // '*' before the type: not closed
} DirEntry;

typedef struct {
    char     disk[17];               // header name, 16 bytes plus zero
    char     id[7];                  // the six bytes after the name: " 01 2A"
    unsigned free;                   // the BLOCKS FREE line number
    char     count;                  // entries parsed
    DirEntry entry[DIR_MAX];
} Directory;

// The three files this program writes before it reads the directory.
// A 1541 data block holds 254 bytes, so 50, 300 and 600 bytes are
// 1, 2 and 3 blocks. The third is opened ",P,W" so the table shows
// a PRG beside two SEQs.
typedef struct { const char *open; const char *name; const char *type;
                 unsigned size; unsigned blocks; } Wanted;

static const Wanted wanted[3] = {
    { "ALPHA,S,W",   "ALPHA",   "SEQ",  50, 1 },
    { "BRAVO,S,W",   "BRAVO",   "SEQ", 300, 2 },
    { "CHARLIE,P,W", "CHARLIE", "PRG", 600, 3 }
};

static char      raw[1024];          // the "$" stream, link bytes and all
static unsigned  rawlen;
static Directory dir;
static char      reply[40];

// CIA2 timers A and B chained as a free-running 32-bit cycle counter.
#define CIA2 ((volatile char *)0xdd00)

static void counter_start(void)
{
    CIA2[4] = 0xff;  CIA2[5] = 0xff;
    CIA2[6] = 0xff;  CIA2[7] = 0xff;
    CIA2[15] = 0x41;                      // B: start, count A underflows
    CIA2[14] = 0x01;                      // A: start, continuous
}

static unsigned long counter_now(void)
{
    volatile char *c = CIA2;
    unsigned lo = c[4] | ((unsigned)c[5] << 8);
    unsigned hi = c[6] | ((unsigned)c[7] << 8);
    return ~(((unsigned long)hi << 16) | lo);
}

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

static void put_hex8(unsigned long v)
{
    put_hex4(v >> 16);
    put_hex4(v & 0xffff);
}

// Channel 15: one status line, without its CR.
static void drive_reply(void)
{
    reply[0] = 0;
    krnio_setnam("");
    if (krnio_open(15, DRIVE, 15)) {
        int n = krnio_gets(15, reply, sizeof(reply));
        if (n > 0 && reply[n - 1] == 13)
            reply[n - 1] = 0;
        krnio_close(15);
    }
    printf("DRIVE: %s\n", reply);
}

// Write one file of the given size; the bytes are a running count.
static void write_file(const Wanted *w)
{
    static char block[64];
    unsigned left = w->size;
    char v = 0;
    krnio_setnam(w->open);
    if (!krnio_open(3, DRIVE, 3))
        return;
    while (left) {
        unsigned n = left < sizeof(block) ? left : sizeof(block);
        for (unsigned i = 0; i < n; i++)
            block[i] = v++;
        krnio_write(3, block, n);
        left -= n;
    }
    krnio_close(3);
}

// Open "$" on secondary 0 and pull the whole stream into raw[]. This is
// CHKIN once, then CHRIN and READST per byte until EOI: the same loop as
// kernal_file_read_seq, stopped by the buffer size as well as by ST.
static char read_directory(void)
{
    char st = 0;
    rawlen = 0;
    krnio_setnam("$");
    if (!krnio_open(DIR_LFN, DRIVE, 0))
        return 0xff;
    if (krnio_chkin(DIR_LFN)) {
        for (;;) {
            char b = krnio_chrin();
            st = krnio_status();
            if (st & ~0x40)              // any error bit: keep nothing
                break;
            raw[rawlen++] = b;
            if (st || rawlen == sizeof(raw))
                break;
        }
    }
    krnio_clrchn();
    krnio_close(DIR_LFN);
    return st;
}

// Parse raw[] as the BASIC program the drive pretends "$" is: a load
// address, then lines of link (2), line number (2), text, zero; a zero
// link ends the listing. The first line is the header, the last is
// BLOCKS FREE, the rest are entries.
static void parse_directory(void)
{
    unsigned p = 2;                      // skip the load address $0401
    char     line = 0;
    dir.count = 0;
    while (p + 4 <= rawlen) {
        char link_lo = raw[p], link_hi = raw[p + 1];
        if (link_lo == 0 && link_hi == 0)
            break;
        unsigned number = raw[p + 2] | ((unsigned)raw[p + 3] << 8);
        p += 4;
        unsigned start = p;
        while (p < rawlen && raw[p] != 0)
            p++;
        unsigned end = p;                // raw[end] is the zero
        p++;
        // find the quoted name, if there is one
        unsigned q = start;
        while (q < end && raw[q] != '"')
            q++;
        if (q == end) {                  // no quotes: the free line
            dir.free = number;
        } else if (line == 0) {          // header: name then id
            char i = 0;
            q++;
            while (q < end && raw[q] != '"' && i < 16) {
                char c = raw[q++];
                if (c == 0xa0)           // the header pads with shifted spaces
                    c = ' ';
                dir.disk[i++] = c;
            }
            while (i > 0 && dir.disk[i - 1] == ' ')
                i--;
            dir.disk[i] = 0;
            q++;                         // closing quote
            i = 0;
            while (q < end && i < 6)
                dir.id[i++] = raw[q++];
            dir.id[i] = 0;
        } else if (dir.count < DIR_MAX) {
            DirEntry *e = &dir.entry[dir.count];
            char i = 0;
            q++;
            while (q < end && raw[q] != '"' && i < 16)
                e->name[i++] = raw[q++];
            e->name[i] = 0;
            q++;                         // closing quote
            while (q < end && raw[q] == ' ')
                q++;
            e->splat = (q < end && raw[q] == '*');
            if (e->splat)
                q++;
            for (i = 0; i < 3; i++)
                e->type[i] = (q < end) ? raw[q++] : ' ';
            e->type[3] = 0;
            e->blocks = number;
            dir.count++;
        }
        line++;
    }
}

static bool str_eq(const char *a, const char *b)
{
    while (*a && *a == *b) { a++; b++; }
    return *a == *b;
}

// One table row straight into screen RAM, so the highlight can move
// without disturbing the printf cursor. Upper-case PETSCII letters map
// to screen codes by clearing bit 6; digits, space and quotes are the
// same in both. Bit 7 set is reverse video.
static void draw_row(char i, bool selected)
{
    char *row = SCREEN + 40 * (TABLE_ROW + i);
    char buf[40];
    const DirEntry *e = &dir.entry[i];
    char n = 0, k;
    for (k = 0; k < 40; k++)
        buf[k] = ' ';
    buf[n++] = selected ? '>' : ' ';
    buf[n++] = ' ';
    buf[n++] = e->blocks >= 100 ? '0' + (e->blocks / 100) % 10 : ' ';
    buf[n++] = e->blocks >= 10  ? '0' + (e->blocks / 10) % 10  : ' ';
    buf[n++] = '0' + e->blocks % 10;
    buf[n++] = ' ';
    buf[n++] = '"';
    for (k = 0; e->name[k]; k++)
        buf[n++] = e->name[k];
    buf[n++] = '"';
    n = 26;
    buf[n++] = e->splat ? '*' : ' ';
    for (k = 0; k < 3; k++)
        buf[n++] = e->type[k];
    for (k = 0; k < 40; k++) {
        char c = buf[k];
        if (c >= 'A' && c <= 'Z')
            c &= 0x3f;
        row[k] = selected ? (c | 0x80) : c;
    }
}

static void wait_frame(void)
{
    while (RASTER != 0xff) ;
    while (RASTER == 0xff) ;
}

int main(void)
{
    unsigned long t0, txfer, tparse;
    char st, i;
    bool ok;

    counter_start();
    printf("%cDIRECTORY READER / FILE SELECTOR\n", 147);

    // 1. put three files on the blank disk so there is something to list
    printf("WRITE");
    for (i = 0; i < 3; i++) {
        printf(" %s %u", wanted[i].name, wanted[i].size);
        write_file(&wanted[i]);
    }
    putchar('\n');
    drive_reply();

    // 2. the directory as a stream, then the parse, timed apart
    t0 = counter_now();
    st = read_directory();
    txfer = counter_now() - t0;
    printf("READ $ %u BYTES ST=", rawlen);
    put_hex2(st);
    putchar('\n');
    drive_reply();

    t0 = counter_now();
    parse_directory();
    tparse = counter_now() - t0;

    // 3. the table: header, entries, free blocks
    printf("DISK \"%s\"%s, %d ENTRIES\n\n", dir.disk, dir.id, dir.count);
    for (i = 0; i < dir.count; i++) {
        draw_row(i, i == 0);
        putchar('\n');                  // leave the row to draw_row
    }
    printf("%u BLOCKS FREE\n", dir.free);

    // 4. the verdict: exactly the files written, in order
    ok = (dir.count == 3);
    for (i = 0; ok && i < 3; i++) {
        const DirEntry *e = &dir.entry[i];
        if (!str_eq(e->name, wanted[i].name) ||
            !str_eq(e->type, wanted[i].type) ||
            e->blocks != wanted[i].blocks || e->splat)
            ok = false;
    }
    printf("TABLE %s\n", ok ? "PASS" : "FAIL");
    RESULT = ok ? 1 : 2;
    BORDER = ok ? 5 : 2;

    printf("CYCLES XFER $");
    put_hex8(txfer);
    printf(" PARSE $");
    put_hex8(tparse);
    putchar('\n');

    // 5. the selector: joystick 2 moves the highlight, fire picks. The
    // autopilot presses down on frame 10 and fire on frame 30 through
    // the same edge logic, so the picture shows the second entry picked.
    char sel = 0, prev = 0, frame = 0;
    for (;;) {
        char now;
        wait_frame();
        joy_poll(0);                         // port 2 is index 0
        now = (joyy[0] < 0 ? 1 : 0) | (joyy[0] > 0 ? 2 : 0) | (joyb[0] ? 4 : 0);
#if AUTOPILOT
        if (frame == 10) now |= 2;
        if (frame == 30) now |= 4;
#endif
        char pressed = now & ~prev;
        prev = now;
        if (frame < 255) frame++;
        if ((pressed & 1) && sel > 0) {
            draw_row(sel, false); sel--; draw_row(sel, true);
        }
        if ((pressed & 2) && sel + 1 < dir.count) {
            draw_row(sel, false); sel++; draw_row(sel, true);
        }
        if (pressed & 4)
            break;
    }
    printf("PICKED %d \"%s\" %s %u\n", sel + 1, dir.entry[sel].name,
           dir.entry[sel].type, dir.entry[sel].blocks);
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=directory-reader.prg directory-reader.c
```

Produces `directory-reader.prg`, 7,199 bytes. `kernalio.h` and
`joystick.h` each carry a `#pragma compile` for their `.c` file, so no
second source goes on the command line. The run needs a fresh disk in
drive 8:

```bash
c1541 -format "TEST,01" d64 test.d64
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 \
      -limitcycles 30000000 -8 test.d64 -drive8truedrive \
      -drive8wobbleamplitude 0 -drive8wobblefrequency 0 \
      -exitscreenshot directory-reader.png -autostart directory-reader.prg
```

`-dAUTOPILOT=0` builds the version with no scripted presses; it waits
for a real joystick in port 2 and was not run here, because a headless
run cannot hold one. In the default build the joystick still works
beside the autopilot, since the two are ORed before the edge test.

## Expected output

```
DIRECTORY READER / FILE SELECTOR
WRITE ALPHA 50 BRAVO 300 CHARLIE 600
DRIVE: 00, OK,00,00
READ $ 160 BYTES ST=40
DRIVE: 00, OK,00,00
DISK "TEST" 01 2A, 3 ENTRIES

    1 "ALPHA"              SEQ
>   2 "BRAVO"              SEQ
    3 "CHARLIE"            PRG
658 BLOCKS FREE
TABLE PASS
CYCLES XFER $0007DE33 PARSE $000035FD
PICKED 2 "BRAVO" SEQ 2

READY.
```

Light blue text on blue with a green border. The `BRAVO` row is drawn
in reverse video. The `CYCLES` line is the only line that differs
between regions: NTSC shows `$00082CC0` and `$000037AB`. Screenshots
from the pinned command: `screenshots/directory-reader.png` (PAL) and
`screenshots/directory-reader-ntsc.png` (NTSC). A second run of the
same command on another fresh disk gave a byte-identical PNG on each
model.

One thing in the picture is not as typed above: the disk name after
`DISK` is four graphics glyphs, not `TEST`. The header line the drive
sent holds `D4 C5 D3 D4` for the name, shifted PETSCII, because
`c1541 -format "TEST,01"` stores an upper-case host argument shifted
(`pitfalls/kernal-and-io.md`, `c1541_uppercase_filename_petscii_shift`,
and the bytes were read back from track 18 sector 0 of the disk the
run left behind). The program prints the bytes as it received them;
the file names it wrote itself came back as plain `ALPHA`, `BRAVO`
and `CHARLIE` because SETNAM passed the ASCII literal's bytes through,
and those are the same as unshifted PETSCII. A disk formatted from the
C64 side would show its name in the ordinary font.

What the run measured:

- The three writes leave the drive at `00, OK,00,00`. The directory
  the drive sent is 160 bytes, the last of them arriving with
  ST = `$40`, and the drive says `00, OK,00,00` again after the close.
  Reading `$` is an ordinary read: the DOS builds a BASIC listing on
  the fly and hands it over on the data channel like any SEQ file.
- The parse found the header, three entries and the free line. The
  block counts are 1, 2 and 3 for 50, 300 and 600 bytes: a 1541 data
  block carries 254 bytes of payload, so 300 bytes need two blocks and
  600 need three. `658 BLOCKS FREE` is 664 less those six.
- `TABLE PASS`: names, types, block counts and the absence of a splat
  mark all match the table compiled in.
- The transfer (OPEN, CHKIN, 160 CHRIN and READST pairs, CLRCHN,
  CLOSE) took 515,635 cycles on PAL and 535,744 on NTSC, about 3,200
  cycles a byte with the open and close folded in. The parse of the
  160 bytes in the buffer took 13,821 cycles on PAL and 14,251 on
  NTSC, about 86 cycles a byte. The counter is CIA2 timers A and B
  chained, read before and after each step, as in
  `save-load-seq-file.md`. The counter is read unlatched, one byte at
  a time from running timers, so a carry between two reads can skew a
  sample; take each figure as good to within a few hundred cycles, not
  to the cycle. The two figures move by a few hundred cycles between
  builds of different size, as the earlier draft of this listing
  showed, and are identical between runs of one build.
- After the run, `c1541 -attach test.d64 -list` printed the same
  three entries with `seq`, `seq`, `prg` and `658 blocks free.`

## Why this works

The DOS treats `$` as a file name. OPEN on a data channel with that
name makes the drive assemble a BASIC program image, and CHRIN then
reads it byte by byte with EOI on the last one, so the loop is
`kernal_file_read_seq` with a different name. The image starts with a
two-byte load address (`$0401`, the PET's BASIC start, which is why a
`LOAD "$",8` lands where a program would). Each line is two link
bytes, a two-byte line number, PETSCII text and a zero; two zero link
bytes end the listing. The link bytes are meaningless here, since the
drive does not know where the listing will be stored, and the parser
skips them. The line number carries the payload: on the header line
it is the drive number, on an entry it is the file's block count, and
on the last line it is the count of free blocks. The text of an entry
is padding, the name in quotes, padding, an optional `*` for a file
that was never closed, the three type letters and an optional `<` for
a locked file. The header line begins with `$12`, reverse on, and
quotes the disk name padded to sixteen characters with `$A0`; the
parser turns those into spaces and trims them.

The parser reads from a buffer rather than from the bus so that the
parse can be timed on its own and so that CLRCHN and CLOSE happen
before any screen output. A version that parses straight from CHRIN
works the same way and needs no buffer; the technique entry shows the
shape. Either way the whole listing must be consumed or the channel
closed before the next file operation, because the drive keeps the
directory channel open until then.

The table rows are written straight into screen RAM by `draw_row`, so
the highlight moves without disturbing the KERNAL's cursor and the
`printf` lines before and after the table land where they should.
Upper-case PETSCII letters become screen codes by clearing bit 6;
digits, space and quotes are the same in both; bit 7 set is reverse
video. The selector reads port 2 through `joy_poll(0)`, builds a
three-bit level word (up, down, fire), ORs the autopilot's presses
for frames 10 and 30 into it, and takes the rising edges against the
previous frame, which is `joystick_edge_detect` from
`techniques/input.md`. A held direction therefore moves one row, not
one row a frame; a game that wants repeat adds `joystick_autorepeat`.
The frame wait polls `$D012` for the raster to pass line 255 and come
back, which is enough here because no IRQ is running.

`LOAD "$",8` from BASIC replaces the program in memory with the
listing, which is why a BASIC program cannot show a directory that
way and survive. A machine-code or C program has no such problem when
it uses OPEN and CHRIN: nothing is loaded anywhere, and the listing
goes only where the program puts it.
