---
recipe: iffl-kernal-skip
toolchain: oscar64
output_format: PRG
region: both
techniques: [iffl_single_file]
file_formats: [PRG]
uses_registers: [D011, D012, D020, DD04, DD05, DD06, DD07, DD0E, DD0F]
uses_kernal: [SETLFS, SETNAM, OPEN, CLOSE, CHKIN, CHKOUT, CHRIN, CHROUT, CLRCHN, READST]
devices: [disk_1541_ii]
---

<!-- doc-type: recipe -->

# Oscar64 IFFL File Loaded by Skipping, KERNAL Only

## Synopsis

Five level files packed into one disk file, `LEVELS`, behind a length
table, and loaded one at a time with nothing but KERNAL `OPEN` and
`CHRIN`. The program scans the table once, turns the lengths into
offsets, then loads subfiles 3, 1, 2, 4 and 5 by opening `LEVELS`,
reading and discarding every byte before the wanted subfile, and
reading the subfile into a buffer. Each load is checked against the
packer's checksum and timed in cycles with a CIA2 counter. The result
is the cost of the KERNAL-only form of `iffl_single_file`: it works on
any drive, and every skipped byte costs as much as a loaded one. Use
it as the fallback path of an IFFL game, or to see why IFFL games
ship their own drive code. The verdict goes to `$02FF` and the border,
green `01` or red `02`, as in `headless-verify.md`.

## Source

```c
// iffl-kernal-skip.c
// One disk file, LEVELS, holds five subfiles back to back behind a
// length table: byte 0 = count N, then N 16-bit lengths, low byte
// first, then the subfiles. The page's Python packer makes LEVELS on
// a PC; if the disk has none (the verifier hands over an empty disk)
// the program writes the same bytes itself. It scans the table once,
// turns the lengths into offsets, and loads subfiles 3, 1, 2, 4, 5 with
// nothing but KERNAL OPEN and CHRIN: open LEVELS, read and discard
// the bytes before the subfile, read the subfile, close. Each load is
// checked against the packer's checksum and timed with a CIA2 32-bit
// cycle counter. Verdict to $02FF and the border: green 01, red 02.
#include <stdio.h>
#include <c64/vic.h>
#include <c64/cia.h>
#include <c64/kernalio.h>

#define DRIVE   8
#define NSUB    5
#define MAXSUB  512
#define RESULT  (*(volatile char *)0x02ff)

// The packer's table: lengths and fold checksums of subfiles 1..5.
static const unsigned LEN[NSUB]    = { 200, 300, 500, 254, 350 };
static const unsigned EXPECT[NSUB] = { 0x7E00, 0x7C00, 0x7CA0, 0x965B, 0x5699 };

static unsigned sublen[NSUB];     // read from the file by the scan
static unsigned suboff[NSUB];     // byte offset of each subfile
static char     buf[MAXSUB];
static char     reply[40];
static unsigned long period;      // cycles per frame, PAL or NTSC

// Subfile k (1-based), byte i: the same formula as the packer's gen().
static char gen(char k, unsigned i)
{
    return (char)(i * (2 * k + 3) + k * 37 + (i >> 8));
}

// chk = ((chk ^ b) * 5 + 1) & 0xffff over n bytes
static unsigned fold(const char *p, unsigned n)
{
    unsigned c = 0;
    for (unsigned i = 0; i < n; i++)
        c = (c ^ p[i]) * 5 + 1;
    return c;
}

// CIA2 timer A counts cycles, timer B counts A underflows: a 32-bit
// down-counter the KERNAL's serial code never touches.
static void clock_init(void)
{
    cia2.cra = 0x00; cia2.crb = 0x00;
    cia2.ta = 0xffff; cia2.tb = 0xffff;
    cia2.crb = 0x51;
    cia2.cra = 0x11;
}

static unsigned long clock_now(void)
{
    unsigned hi, lo, hi2;
    do {
        hi = cia2.tb; lo = cia2.ta; hi2 = cia2.tb;
    } while (hi != hi2);
    return 0xffffffffUL - (((unsigned long)hi << 16) | lo);
}

static void report(const char *tag, unsigned long cyc)
{
    printf("%s %lu CYC %lu F\n", tag, cyc, cyc / period);
}

// Send cmd on the command channel (or nothing) and print the reply.
static void drive_cmd(const char *cmd)
{
    reply[0] = 0;
    krnio_setnam(cmd);
    if (krnio_open(15, DRIVE, 15)) {
        int n = krnio_gets(15, reply, sizeof(reply));
        if (n > 0 && reply[n - 1] == 13) reply[n - 1] = 0;
        krnio_close(15);
    }
    printf("DRIVE: %s\n", reply);
}

// The packer, on the C64: write the table and the five subfiles.
// Used only when the disk has no LEVELS yet.
static bool write_levels(void)
{
    krnio_setnam("LEVELS,P,W");
    if (!krnio_open(2, DRIVE, 2)) return false;
    krnio_chkout(2);
    krnio_chrout(NSUB);
    for (char k = 0; k < NSUB; k++) {
        krnio_chrout((char)LEN[k]);
        krnio_chrout((char)(LEN[k] >> 8));
    }
    for (char k = 0; k < NSUB; k++)
        for (unsigned i = 0; i < LEN[k]; i++)
            krnio_chrout(gen(k + 1, i));
    krnio_clrchn();
    krnio_close(2);
    return true;
}

// The scan: read the count and the lengths once, build the offsets.
static bool scan(void)
{
    krnio_setnam("LEVELS,P,R");
    if (!krnio_open(2, DRIVE, 2)) return false;
    krnio_chkin(2);
    char n = krnio_chrin();
    for (char k = 0; k < NSUB; k++) {
        char lo = krnio_chrin();
        sublen[k] = lo | (krnio_chrin() << 8);
    }
    char st = krnio_status();
    krnio_clrchn();
    krnio_close(2);
    if (n != NSUB || st) return false;
    unsigned off = 1 + 2 * NSUB;
    for (char k = 0; k < NSUB; k++) {
        suboff[k] = off;
        off += sublen[k];
    }
    return true;
}

// Load subfile k (1-based) to buf by skipping the bytes before it.
static bool load_sub(char k)
{
    unsigned skip = suboff[k - 1], n = sublen[k - 1];
    krnio_setnam("LEVELS,P,R");
    if (!krnio_open(2, DRIVE, 2)) return false;
    krnio_chkin(2);
    for (unsigned i = 0; i < skip; i++) krnio_chrin();
    for (unsigned i = 0; i < n; i++) buf[i] = krnio_chrin();
    char st = krnio_status();
    krnio_clrchn();
    krnio_close(2);
    return (st & 0xbf) == 0;          // EOF alone is fine
}

static const char ORDER[NSUB] = { 3, 1, 2, 4, 5 };

int main(void)
{
    printf("%cIFFL LOAD BY SKIPPING (KERNAL)\n", 147);

    // PAL or NTSC from the highest raster line seen
    char top = 0;
    for (unsigned i = 0; i < 20000; i++) {
        char h1 = vic.ctrl1, r = vic.raster, h2 = vic.ctrl1;
        if ((h1 & h2 & 0x80) && r > top) top = r;
    }
    period = (top >= 0x37) ? 19656UL : 17095UL;
    clock_init();

    // The scan. On a disk from the packer it succeeds at once; on the
    // empty disk the verifier formats it fails with 62 and the program
    // writes LEVELS itself, then scans again.
    unsigned long t0 = clock_now();
    bool ok = scan();
    report(ok ? "SCAN" : "SCAN FAIL", clock_now() - t0);
    if (!ok) {
        drive_cmd("");
        t0 = clock_now();
        ok = write_levels();
        report(ok ? "WRITE" : "WRITE FAIL", clock_now() - t0);
        drive_cmd("");
        t0 = clock_now();
        ok = ok && scan();
        report(ok ? "SCAN" : "SCAN FAIL", clock_now() - t0);
    }
    bool pass = ok;
    for (char k = 0; k < NSUB; k++) {
        unsigned o = suboff[k];
        printf(" %d OFF %4u LEN %3u BLK %u BYTE %3u\n",
               k + 1, o, sublen[k], o / 254, o % 254 + 2);
    }

    for (char j = 0; j < NSUB; j++) {
        char k = ORDER[j];
        t0 = clock_now();
        ok = load_sub(k);
        unsigned long cyc = clock_now() - t0;
        unsigned chk = fold(buf, sublen[k - 1]);
        bool good = ok && chk == EXPECT[k - 1];
        printf("SUB %d CHK %04X %s", k, chk, good ? "PASS" : "FAIL");
        report("", cyc);
        pass = pass && good;
    }

    printf(pass ? "ALL PASS\n" : "FAIL\n");
    vic.color_border = pass ? VCOL_GREEN : VCOL_RED;
    RESULT = pass ? 1 : 2;
    for (;;) ;
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=iffl-kernal-skip.prg iffl-kernal-skip.c
```

Produces `iffl-kernal-skip.prg`, 6,274 bytes. `kernalio.h` pulls in its
own `.c` with `#pragma compile`, so nothing else goes on the command
line.

The disk file comes from this packer, run on the PC. It prints each
subfile's offset, the block and byte where the subfile starts in the
DOS chain (254 data bytes a block, data from byte 2), and the fold
checksum the C listing compiles in as `EXPECT`:

```python
# pack-iffl.py: build the IFFL file LEVELS from five subfiles.
# Layout: byte 0 = subfile count N, then N lengths (16-bit, low byte
# first), then the subfiles back to back. Prints each subfile's offset,
# its block and byte in the DOS chain, and its fold checksum.
import sys

LENS = [200, 300, 500, 254, 350]

def gen(k, i):                       # subfile k (1-based), byte i
    return (i * (2 * k + 3) + k * 37 + (i >> 8)) & 0xFF

def fold(bs):                        # chk = ((chk ^ b) * 5 + 1) & 0xffff
    c = 0
    for b in bs:
        c = ((c ^ b) * 5 + 1) & 0xFFFF
    return c

subs = [bytes(gen(k, i) for i in range(n)) for k, n in enumerate(LENS, 1)]
head = bytes([len(subs)]) + b"".join(len(s).to_bytes(2, "little") for s in subs)
off = len(head)
for k, s in enumerate(subs, 1):
    print(f"sub {k}: len {len(s):4} off {off:4} block {off // 254} "
          f"byte {off % 254 + 2:3} chk {fold(s):04X}")
    off += len(s)
data = head + b"".join(subs)
print(f"total {len(data)} bytes, {-(-len(data) // 254)} blocks")
open(sys.argv[1] if len(sys.argv) > 1 else "levels.bin", "wb").write(data)
```

```bash
python3 pack-iffl.py levels.bin
c1541 -format "game,01" d64 game.d64 -write levels.bin levels
```

Its output:

```text
sub 1: len  200 off   11 block 0 byte  13 chk 7E00
sub 2: len  300 off  211 block 0 byte 213 chk 7C00
sub 3: len  500 off  511 block 2 byte   5 chk 7CA0
sub 4: len  254 off 1011 block 3 byte 251 chk 965B
sub 5: len  350 off 1265 block 4 byte 251 chk 5699
total 1615 bytes, 7 blocks
```

Give c1541 the name in lower case. It stores the name as PETSCII
unshifted, which the program's `LEVELS` matches; an upper-case name
on the c1541 line does not match
(`c1541_uppercase_filename_petscii_shift` in
`pitfalls/kernal-and-io.md`). `-write` stores the host file's bytes
as they are, so the two bytes at the front of `levels.bin` are the
count and the first length, not a load address.

The verifier hands the program an empty disk instead, so the listing
carries the packer too: when the first scan fails with `62`, it writes
the same bytes as `LEVELS` and scans again. The pinned run:

```bash
c1541 -format "TEST,01" d64 test.d64
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 \
      -limitcycles 36000000 -8 test.d64 \
      -drive8wobbleamplitude 0 -drive8wobblefrequency 0 \
      -exitscreenshot iffl-kernal-skip.png -autostart iffl-kernal-skip.prg
```

## Expected output

On a fresh disk, PAL:

```text
IFFL LOAD BY SKIPPING (KERNAL)
SCAN FAIL 1535763 CYC 78 F
DRIVE: 62, FILE NOT FOUND,00,00
WRITE 6714862 CYC 341 F
DRIVE: 00, OK,00,00
SCAN 475342 CYC 24 F
 1 OFF   11 LEN 200 BLK 0 BYTE  13
 2 OFF  211 LEN 300 BLK 0 BYTE 213
 3 OFF  511 LEN 500 BLK 2 BYTE   5
 4 OFF 1011 LEN 254 BLK 3 BYTE 251
 5 OFF 1265 LEN 350 BLK 4 BYTE 251
SUB 3 CHK 7CA0 PASS 3179760 CYC 161 F
SUB 1 CHK 7E00 PASS 974300 CYC 49 F
SUB 2 CHK 7C00 PASS 1997070 CYC 101 F
SUB 4 CHK 965B PASS 3922492 CYC 199 F
SUB 5 CHK 5699 PASS 4520907 CYC 230 F
ALL PASS
```

The border is green. The text was read off the screenshot by a script
that matches each 8x8 cell against `chargen-901225-01.bin`, not by
eye. Screenshots from the pinned command, 36,000,000 cycles, each on a
disk formatted as `TEST,01` just before the run:
`screenshots/iffl-kernal-skip.png` (PAL) and
`screenshots/iffl-kernal-skip-ntsc.png` (NTSC, `-model ntsc`). A
second run of each gave a byte-identical PNG, and so did runs at
32,000,000 cycles. At 28,000,000 cycles the NTSC run had not reached
`ALL PASS`.

NTSC differs in the timings only: first scan `1600170` (93 frames),
write `6972504` (407), scan `493791` (28), and the loads in the same
order `3304505`, `1015015`, `2072376`, `4071167`, `4695129` cycles
(193, 59, 121, 238, 274 frames). `F` is cycles divided by 19,656 on
PAL and 17,095 on NTSC.

Two cross-checks, both run here:

- After the NTSC run, `c1541 -attach test.d64 -read levels out.bin`
  gave a 7-block PRG whose bytes are identical to the packer's
  `levels.bin` (`cmp` silent). The C64 writer and the PC packer make
  the same file.
- A disk built with the packer and the `c1541 -write` line above, run
  on PAL at 32,000,000 cycles: the first scan succeeds at once
  (`SCAN 1824005 CYC 92 F`, spin-up and directory search included),
  no write happens, and all five loads pass with timings within 2,400
  cycles of the fresh-disk run.

Reading the numbers:

- `SCAN`: one `OPEN`, 11 bytes, one `CLOSE`. The table is at the front
  of the file, so the scan never reads past the first block. Its cost
  is the directory search in `OPEN`, not the bytes.
- `BLK` and `BYTE`: where each subfile starts in the file's chain of
  blocks, the pair a drive-side loader would record. The KERNAL path
  cannot use them; they are printed to show what an IFFL table holds.
  On the disk the pinned NTSC run wrote, a script walking the D64 links
  found the chain 17/0, 17/10, 17/20, 17/8, 17/18, 17/6, 17/16, ten
  sectors apart, with 91 data bytes in the last block (6 x 254 + 91 =
  1,615). So subfile 3, `BLK 2 BYTE 5`, starts at track 17 sector 20,
  byte 5: the address a drive-side loader records for it.
- The loads: the time grows with how far into the file the subfile
  ends, not with its length. Subfile 4 (254 bytes) is half the length
  of subfile 3 (500) and takes longer. From subfile 1 (211 bytes read) to subfile 5
  (1,615 bytes read) the time rises by 3,546,607 cycles on PAL, 2,526
  cycles per extra byte; on NTSC 2,621. That rate is arithmetic on
  the measured pairs, and the pairs in between do not sit exactly on
  one line: subfile 3 took about 184,600 cycles more than the line
  predicts. The likely cause is that each new block waits for its
  sector to come round under the head; that was not measured here.
- Subfile 1 at 974,300 cycles is mostly `OPEN` and `CLOSE`: the
  directory search is paid on every load, since the KERNAL cannot
  keep a file open at a position and rewind it.

## Why this works

The file holds no structure the drive knows about. The DOS sees one
PRG of seven blocks; the length table at its front is the program's
own convention. `scan()` reads the count and the five lengths and adds
them up, which gives each subfile's byte offset in the file. That is
the whole scan when the lengths are stored up front. Cadaver's IFFL
format puts the table in the first 254 bytes, 127 low bytes then 127
high bytes, so it fills exactly the first block and the data starts at
the second (https://cadaver.github.io/rants/iffl.html); this recipe
packs the table tighter because it only has five entries.

`load_sub()` has no way to start mid-file. The KERNAL's sequential
channel delivers bytes from the start of the file, one `CHRIN` at a
time, so the loop `for (i = 0; i < skip; i++) krnio_chrin();` is the
seek. Each discarded byte crosses the serial bus exactly as a kept one
does, which is why the cost follows the end offset. Across the whole
of a full 1541 disk, 664 blocks of 254 bytes (the free count c1541
reports for a fresh image), 168,656 bytes, the same rate puts the last
subfile about 426 million cycles, some 7 minutes on PAL, from the
start (arithmetic from the measured 2,526 cycles per byte). A skip
past a whole block still fetches that block.

The timer is CIA2's two 16-bit counters cascaded, which the KERNAL's
serial code does not use; the same clock is in
`load-asset-runtime.md`. The checksum is the 16-bit fold used there
too, computed by the packer in Python and by `fold()` on the C64, and
compared with the constants in `EXPECT`. The last byte of subfile 5
is the last byte of the file, where `READST` can carry bit 6 (EOF),
so `load_sub()` masks that bit and treats any other as an error.
