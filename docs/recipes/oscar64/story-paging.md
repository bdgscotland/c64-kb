---
recipe: story-paging
toolchain: oscar64
output_format: PRG
region: both
techniques: [story_file_virtual_memory_paging]
file_formats: [PRG, D64]
uses_registers: [D020, D021, DD04, DD05, DD06, DD07, DD0E, DD0F]
uses_kernal: [SETLFS, SETNAM, OPEN, CLOSE, CHKIN, CHKOUT, CLRCHN, CHRIN, CHROUT, READST]
devices: [disk_1541_ii]
---

<!-- doc-type: recipe -->

# Oscar64 story-file paging: a page table from the block chain and a 4-page LRU cache over U1 block reads

## Synopsis

A file larger than the memory set aside for it, read a byte at a time
through a page cache. The program writes a 24-block SEQ file, `STORY`,
to a fresh disk: 6,096 bytes, each a known function of its offset. It
finds the file's first block in the directory block 18/1, walks the
block chain once with `U1` reads to build a page table, then serves byte
reads from a cache of four 256-byte pages with least-recently-used
replacement. A miss reads one block through the drive's buffer channel.
An access pattern with locality, eight "routines" revisited in an
interpreter-like order, reads 640 bytes, and every byte is checked
against the formula. Last, it reads the sector where a page table that
assumed consecutive sectors would look for block 1. CIA2 timers A and B
time one miss and one hit with the KERNAL interrupt running. `$02FF`
holds `01` and the border is green when the file is found, the chain has
24 blocks, every byte read is right and the consecutive-sector guess is
wrong; else `02` and red. It implements
`story_file_virtual_memory_paging` (`techniques/file-io.md`) and
measures `page_table_assumes_consecutive_sectors`
(`pitfalls/kernal-and-io.md`).

## Source

```c
// story-paging.c
// A story file larger than the memory set aside for it, read through a
// page cache. The program writes a 24-block SEQ file, STORY, to a fresh
// disk (6,096 bytes, each byte a known function of its offset). It finds
// the file's first block in the directory (block 18/1), walks the block
// chain once with U1 reads to build a page table (block n of the file at
// track t[n], sector s[n]), then serves byte reads from a 4-page cache
// (1 KB) with least-recently-used replacement: a miss reads one block
// through the drive's buffer channel with U1. An access pattern with
// locality, like an interpreter's, reads 640 bytes; their sum is checked
// against the formula. The same block 1 is then read where a page table
// that assumed consecutive sectors would look for it. CIA2 timers A and
// B time one miss and one hit, KERNAL interrupt running. $02FF holds 01
// and the border is green when the file was found, the chain has 24
// blocks, every byte read matches, and the consecutive-sector guess is
// wrong; else 02 and red.
#include <c64/kernalio.h>
#include <c64/vic.h>
#include <c64/cia.h>

#define SCREEN ((char *)0x0400)
#define COLOUR ((char *)0xd800)
#define RESULT (*(volatile char *)0x02ff)

#define DRIVE   8
#define DATA_LF 2
#define BUF_LF  5
#define CMD_LF  15

#define BLOCKS  24                    // the story file, 254 data bytes each
#define FILE_LEN (BLOCKS * 254u)
#define FRAMES  4                     // the cache: 4 pages of 256 bytes

static char story_byte(unsigned i)    // the file's content, by offset
{
    return (char)((i >> 8) * 37 + i * 11 + 5);
}

// ---- screen --------------------------------------------------------------

static char *cur;

static void at(char row, char col) { cur = SCREEN + 40 * row + col; }

static void out(const char *s)
{
    while (*s)
    {
        char c = *s++;
        *cur++ = (c >= 'A' && c <= 'Z') ? c - 'A' + 1 : (c >= 'a' && c <= 'z') ? c - 'a' + 1 : c;
    }
}

static void dec(unsigned long v, char width)
{
    char *e = cur + width;
    char *p = e;
    do
    {
        *--p = '0' + (char)(v % 10);
        v /= 10;
    } while (p > cur);
    cur = e;
}

// ---- drive ---------------------------------------------------------------

static char blk[256];

// "U1 5 0 t s" on the command channel, then 256 bytes from channel 5.
static int read_block(char t, char s, char *dst)
{
    char cmd[16];
    char i = 0;
    cmd[i++] = 'U'; cmd[i++] = '1'; cmd[i++] = ' ';
    cmd[i++] = '0' + BUF_LF; cmd[i++] = ' '; cmd[i++] = '0'; cmd[i++] = ' ';
    cmd[i++] = '0' + t / 10; cmd[i++] = '0' + t % 10; cmd[i++] = ' ';
    cmd[i++] = '0' + s / 10; cmd[i++] = '0' + s % 10;
    krnio_write(CMD_LF, cmd, i);
    krnio_pstatus[BUF_LF] = KRNIO_OK;
    return krnio_read(BUF_LF, dst, 256);
}

static void write_story(void)
{
    char buf[254];
    krnio_setnam("STORY,S,W");
    krnio_open(DATA_LF, DRIVE, DATA_LF);
    for (unsigned b = 0; b < BLOCKS; b++)
    {
        for (unsigned k = 0; k < 254; k++)
            buf[k] = story_byte(b * 254 + k);
        krnio_write(DATA_LF, buf, 254);
    }
    krnio_close(DATA_LF);
}

// ---- page table and cache ---------------------------------------------------

static char pt_t[BLOCKS + 1], pt_s[BLOCKS + 1];
static char npages;

static bool find_story(char *t, char *s)
{
    read_block(18, 1, blk);
    for (char e = 0; e < 8; e++)
    {
        const char *d = blk + 2 + 32 * e;
        if ((d[0] & 7) == 1 && d[3] == 'S' && d[4] == 'T' && d[5] == 'O'
            && d[6] == 'R' && d[7] == 'Y' && d[8] == 0xa0)
        {
            *t = d[1];
            *s = d[2];
            return true;
        }
    }
    return false;
}

static void build_table(char t, char s)
{
    npages = 0;
    while (t != 0 && npages <= BLOCKS)
    {
        pt_t[npages] = t;
        pt_s[npages] = s;
        npages++;
        read_block(t, s, blk);
        t = blk[0];
        s = blk[1];
    }
}

static char frame[FRAMES][256];
static signed char tag[FRAMES];       // the page in each frame, -1 empty
static unsigned stamp[FRAMES];        // last use, for LRU
static unsigned clock;
static unsigned hits, misses;

__noinline char vm_byte(unsigned addr)
{
    char page = (char)(addr / 254);
    char off = (char)(addr - page * 254);
    char f;
    for (f = 0; f < FRAMES; f++)
        if (tag[f] == page)
            break;
    if (f == FRAMES)
    {
        f = 0;
        for (char g = 1; g < FRAMES; g++)
            if (tag[g] < 0 || (tag[f] >= 0 && stamp[g] < stamp[f]))
                f = g;
        read_block(pt_t[page], pt_s[page], frame[f]);
        tag[f] = page;
        misses++;
    }
    else
        hits++;
    stamp[f] = ++clock;
    return frame[f][2 + off];
}

static void timer_start(void)
{
    cia2.cra = 0x00;
    cia2.crb = 0x00;
    cia2.ta = 0xffff;
    cia2.tb = 0xffff;
    cia2.crb = 0x51;
    cia2.cra = 0x11;
}

static unsigned long timer_stop(void)
{
    cia2.cra = 0x00;
    cia2.crb = 0x00;
    return ((unsigned long)(0xffff - cia2.tb) << 16) + (0xffff - cia2.ta);
}

// Eight "routines" spread over the file, visited in an order that keeps
// returning to the first two, 40 bytes read from each visit.
static const unsigned routine[8] = { 100, 700, 1500, 2300, 3100, 3900, 4700, 5900 };
static const char visit[16] = { 0, 1, 0, 2, 0, 1, 3, 0, 1, 4, 5, 0, 1, 6, 7, 0 };

int main(void)
{
    for (unsigned i = 0; i < 1000; i++)
    {
        SCREEN[i] = 0x20;
        COLOUR[i] = VCOL_WHITE;
    }
    vic.color_back = VCOL_BLACK;
    vic.color_border = VCOL_BLACK;
    at(0, 0);
    out("story file paging through a page cache");

    krnio_setnam("");
    krnio_open(CMD_LF, DRIVE, CMD_LF);
    write_story();
    krnio_setnam("#");
    krnio_open(BUF_LF, DRIVE, BUF_LF);

    char t0 = 0, s0 = 0;
    bool found = find_story(&t0, &s0);
    build_table(t0, s0);
    at(2, 0);
    out("file ");
    dec(FILE_LEN, 4);
    out(" bytes ");
    dec(npages, 2);
    out(" blocks cache ");
    dec(FRAMES, 1);
    out(" pages");
    at(3, 0);
    out("chain");
    for (char i = 0; i < 5 && i < npages; i++)
    {
        out(" ");
        dec(pt_t[i], 2);
        out("/");
        dec(pt_s[i], 2);
    }

    // The access pattern, checked against the formula.
    for (char f = 0; f < FRAMES; f++)
        tag[f] = -1;
    clock = hits = misses = 0;
    unsigned long sum = 0, want = 0;
    unsigned bad = 0, reads = 0;
    unsigned long cyc_miss = 0, cyc_hit = 0;
    for (char v = 0; v < 16; v++)
    {
        unsigned a0 = routine[visit[v]];
        for (char k = 0; k < 40; k++)
        {
            unsigned a = a0 + k;
            char b;
            if (v == 2 && k == 0)
            {
                timer_start();              // routine 0 again: a hit
                b = vm_byte(a);
                cyc_hit = timer_stop();
            }
            else if (v == 3 && k == 0)
            {
                timer_start();              // routine 2: first visit, a miss
                b = vm_byte(a);
                cyc_miss = timer_stop();
            }
            else
                b = vm_byte(a);
            sum += b;
            want += story_byte(a);
            if (b != story_byte(a))
                bad++;
            reads++;
        }
    }
    at(5, 0);
    out("reads ");
    dec(reads, 3);
    out(" hits ");
    dec(hits, 3);
    out(" misses ");
    dec(misses, 2);
    at(6, 0);
    out("sum ");
    dec(sum, 6);
    out(" want ");
    dec(want, 6);
    out(" bad ");
    dec(bad, 3);
    at(7, 0);
    out("cycles: miss ");
    dec(cyc_miss, 7);
    out(" hit ");
    dec(cyc_hit, 4);

    // Where a consecutive-sector guess would put block 1.
    char gs = s0 + 1;
    read_block(t0, gs, blk);
    unsigned differ = 0;
    for (char k = 0; k < 254; k++)
        if (blk[2 + k] != story_byte(254 + k))
            differ++;
    unsigned guess_wrong = 0;
    for (char i = 1; i < npages; i++)
        if (pt_t[i] != t0 || pt_s[i] != s0 + i)
            guess_wrong++;
    at(9, 0);
    out("guess block 1 at ");
    dec(t0, 2);
    out("/");
    dec(gs, 2);
    out(": bytes wrong ");
    dec(differ, 3);
    at(10, 0);
    out("guess wrong for ");
    dec(guess_wrong, 2);
    out(" of ");
    dec(npages - 1, 2);
    out(" later blocks");

    krnio_close(BUF_LF);
    krnio_close(CMD_LF);

    bool ok = found && npages == BLOCKS && bad == 0 && sum == want && misses > 0
           && differ > 0 && guess_wrong > 0;
    at(12, 0);
    out(ok ? "pass" : "fail");
    RESULT = ok ? 0x01 : 0x02;
    vic.color_border = ok ? VCOL_GREEN : VCOL_RED;
    for (;;)
        ;
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=story-paging.prg story-paging.c
c1541 -format "test,01" d64 story.d64
```

Run headless with the fresh disk as drive 8, pinned at 80,000,000
cycles. The PAL run had not finished at 50,000,000 and had at
60,000,000; writing the file over the serial bus is most of that.

```bash
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 -limitcycles 80000000 -8 story.d64 -drive8wobbleamplitude 0 -drive8wobblefrequency 0 -exitscreenshot story-paging.png -autostart story-paging.prg
```

Add `-model ntsc` for the NTSC picture. `npm run verify:recipes` formats
the disk before each run. The PRG is 3,407 bytes.

## Expected output

White text on black, green border. PAL,
`screenshots/story-paging.png`:

```
story file paging through a page cache

file 6096 bytes 24 blocks cache 4 pages
chain 17/00 17/10 17/20 17/08 17/18

reads 640 hits 631 misses 09
sum 086032 want 086032 bad 000
cycles: miss 0708686 hit 0743

guess block 1 at 17/01: bytes wrong 254
guess wrong for 23 of 23 later blocks

pass
```

NTSC, `screenshots/story-paging-ntsc.png`: the same, with `cycles: miss
0740604 hit 0657`. Read from both screenshots with a PIL decoder against
the character ROM (VICE x64sc 3.10, 1541 emulation with its DOS ROM).

## Why this works

**The page table.** A file on a 1541 disk is a chain of blocks: bytes 0
and 1 of each block are the track and sector of the next, and 254 bytes
of data follow. The directory entry holds the first block's track and
sector. Following the chain once, 24 `U1` reads, gives the table from
page number to track and sector. After that any page is one read away,
in any order. The drive wrote this file from track 17 sector 0 with
sectors 10 apart: 0, 10, 20, 8, 18. A table that assumed block 1 was at
17/01 reads a sector that is not in the file: all 254 data bytes
differ from the file's block 1, and the guess is wrong for all 23 blocks
after the first.

**The cache.** A byte address splits into a page, `addr / 254`, and an
offset. Each of the four frames holds one page and the time it was last
used. A hit is a tag compare; a miss evicts the frame used longest ago
and reads the page into it. The access pattern returns to routines 0
and 1 between visits to the others, as an interpreter returns to its
main loop and common routines, so 631 of 640 reads hit and 9 missed.
The nine misses are the nine pages the eight routines touch (routine 2
straddles pages 5 and 6), each on first use; no page was evicted and
then needed again. A Python model of the same cache and pattern gives
631 and 9.

**The cost.** A miss took 708,686 cycles on PAL, about 36 frames: a
`U1` command and 256 bytes over the serial bus through the KERNAL. A hit
took 743 cycles on PAL and 657 on NTSC, with the KERNAL interrupt
running and the screen on; the difference between the two models was
not isolated. At these figures the hit rate decides the cost: a faster
transfer, such as a fast loader's block read, shortens only the misses.
