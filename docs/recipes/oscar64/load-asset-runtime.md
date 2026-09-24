---
recipe: load-asset-runtime
toolchain: oscar64
output_format: PRG
region: both
techniques: [kernal_load_to_address, error_channel_check]
file_formats: [PRG]
uses_registers: [D011, D012, D018, D019, D01A, D020, DD04, DD05, DD06, DD07, DD0E, DD0F]
uses_kernal: [SETLFS, SETNAM, LOAD, SAVE, OPEN, CLOSE, CHKIN, CHRIN, CLRCHN, READST]
---

<!-- doc-type: recipe -->

# Oscar64 Load an Asset at Run Time with KERNAL LOAD

## Synopsis

A character set fetched from drive 8 when the program runs, instead of
being compiled into the PRG. The set is built in RAM first, so the run
has something to compare against: the ROM font with a dotted underline
added to every glyph but space. The program then LOADs the file
`CHARSET` with secondary address 0 to `$3800`, an address it chose and
not the one in the file's header, points the VIC at it, and compares
the bytes that landed with the bytes it built. On a fresh disk the
first LOAD fails with `62`, so the program SAVEs the built set as a PRG
and LOADs it straight back; on the next start the first LOAD succeeds
and the SAVE is skipped. The drive's reply is printed after every step.
Two things are measured along the way: a `rasterirq.h` border split
stays armed across the calls and counts its entries, and LOAD is
entered under `SEI` so the I flag it returns with can be read. The
verdict goes to `$02FF` and the border, green `01` or red `02`, the
way `headless-verify.md` does it. The verifier formats a fresh disk
before each run, so the pinned picture is the first-run path, SAVE
then LOAD; the second-start path was run once and is quoted below.

## Source

```c
// load-asset-runtime.c
// Fetch a 2 KB character set from drive 8 at run time instead of
// embedding it in the PRG. The set is built in RAM first (the ROM font
// with a dotted underline under every glyph but space), then LOADed with secondary
// address 0 to $3800, the address this program chooses, not the one in
// the file's header. On a fresh disk the first LOAD answers 62, so the
// program SAVEs the built set as the PRG "CHARSET" and LOADs it again;
// on the next start the first LOAD succeeds and the SAVE is skipped.
// Every step prints the KERNAL's return values and the drive's reply.
// A rasterirq.h border split stays armed across the calls and counts
// how often it ran, and LOAD is entered under SEI so the I flag it
// returns with can be read. The loaded block is compared with the
// built one, the VIC is pointed at it, and the verdict goes to $02FF
// and the border: green 01 pass, red 02 fail.
#include <stdio.h>
#include <string.h>
#include <c64/vic.h>
#include <c64/cia.h>
#include <c64/memmap.h>
#include <c64/rasterirq.h>
#include <c64/kernalio.h>

// Keep the runtime below the charset: nothing but the $0801 startup
// stub lands outside $0880-$37FF.
#pragma stacksize( 1024 )
#pragma heapsize( 256 )
#pragma region( main, 0x0880, 0x3800, , , { code, data, bss, heap, stack } )

#define DRIVE       8
#define SIZE        2048
#define CHARSET     ((char *)0x3800)          // VIC bank 0, char base 7
#define RESULT      (*(volatile char *)0x02ff)
#define EXPECT_CHK  0xC4FF                    // python fold of the built set
#define SPLIT_ROW   100
#define RESTORE_ROW 200

static char built[SIZE];                      // the set as built in RAM
static char reply[40];
static RIRQCode split, restore;

static volatile unsigned irqs;                // split handler entries
static volatile char     rmin, rmax;          // $D012 at handler entry

__interrupt void on_split(void)
{
    char r = vic.raster;
    if (r < rmin) rmin = r;
    if (r > rmax) rmax = r;
    irqs++;
}

static void stats_reset(void)
{
    irqs = 0; rmin = 255; rmax = 0;
}

// CIA2 timer A counts cycles, timer B counts A underflows: a 32-bit
// counter the KERNAL never touches (its serial timeout is CIA1 B).
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

// chk = ((chk ^ b) * 5 + 1) & 0xffff over n bytes
static unsigned fold(const char *p, unsigned n)
{
    unsigned c = 0;
    for (unsigned i = 0; i < n; i++)
        c = (c ^ p[i]) * 5 + 1;
    return c;
}

static void drive_reply(void)
{
    reply[0] = 0;
    krnio_setnam("");
    if (krnio_open(15, DRIVE, 15)) {
        int n = krnio_gets(15, reply, sizeof(reply));
        if (n > 0 && reply[n - 1] == 13) reply[n - 1] = 0;
        krnio_close(15);
    }
    printf("DRIVE: %s\n", reply);
}

// What LOAD handed back: carry, A, the I flag, and X/Y (end + 1).
static char     ld_carry, ld_a, ld_iflag;
static unsigned ld_end;
static bool     no_drive;

// LOAD name to dest. SETLFS secondary 0 makes LOAD take the address in
// X/Y and discard the two header bytes in the file; secondary 1 would
// do the opposite (krnio_load passes X/Y = 0, so it is only usable
// with secondary 1). Entered under SEI on purpose: the flags LOAD
// returns with say what the KERNAL did to the I bit.
static void load_to(const char *name, char *dest)
{
    krnio_setnam(name);
    __asm {
        sei
        lda #1                  // logical file: LOAD ignores it
        ldx #8                  // device
        ldy #0                  // secondary 0: our address wins
        jsr $ffba               // SETLFS
        lda #0                  // 0 = load, 1 = verify
        ldx dest
        ldy dest + 1
        jsr $ffd5               // LOAD
        php
        sta ld_a
        stx ld_end
        sty ld_end + 1
        lda #0
        rol
        sta ld_carry            // C: 1 = failed, A says why
        pla
        and #4
        sta ld_iflag            // I bit as LOAD left it
        cli
    }
}

static unsigned long period;                  // cycles per frame

static void report(const char *tag, unsigned long cyc)
{
    printf("%s CYC=%lu F=%lu IRQ=%u R=%u..%u\n",
           tag, cyc, cyc / period, irqs, rmin, rmax);
}

static bool do_load(void)
{
    stats_reset();
    unsigned long t0 = clock_now();
    load_to("CHARSET", CHARSET);
    unsigned long cyc = clock_now() - t0;
    printf("LOAD C=%d A=%02X I=%d ST=%02X END=%04X\n",
           ld_carry, ld_a, ld_iflag ? 1 : 0, krnio_status(), ld_end);
    report(" ", cyc);
    // A=5 is device not present: nothing answered, so do not open the
    // command channel, whose bare OPEN sends nothing and whose read
    // would then wait for ever.
    no_drive = ld_carry && ld_a == 5;
    if (!no_drive) drive_reply();
    return ld_carry == 0;
}

int main(void)
{
    printf("%cLOAD ASSET AT RUN TIME\n", 147);

    // model, from the highest raster line seen in one frame; bit 7 of
    // $D011 is read on both sides of $D012 so a line-255 read followed
    // by a line-256 flag cannot count as $1FF
    char top = 0;
    for (unsigned i = 0; i < 20000; i++) {
        char h1 = vic.ctrl1, r = vic.raster, h2 = vic.ctrl1;
        if ((h1 & h2 & 0x80) && r > top) top = r;
    }
    period = (top >= 0x37) ? 19656UL : 17095UL;

    // 1. build the set: ROM font, row 7 of every glyph but space XORed with $55
    __asm { sei }
    char port = mmap_set(MMAP_CHAR_ROM);
    memcpy(built, (const char *)0xd000, SIZE);
    mmap_set(port);
    __asm { cli }
    for (unsigned i = 7; i < SIZE; i += 8)
        if (i != 32 * 8 + 7) built[i] ^= 0x55;    // leave space blank
    unsigned want = fold(built, SIZE);
    printf("BUILT %u BYTES CHK %04X\n", SIZE, want);

    // 2. a border split armed for the whole run, counting its entries
    rirq_init(true);
    rirq_build(&split, 2);
    rirq_write(&split, 0, &vic.color_border, VCOL_WHITE);
    rirq_call(&split, 1, on_split);
    rirq_set(0, SPLIT_ROW, &split);
    rirq_build(&restore, 1);
    rirq_write(&restore, 0, &vic.color_border, VCOL_LT_BLUE);
    rirq_set(1, RESTORE_ROW, &restore);
    rirq_sort();
    rirq_start();
    clock_init();

    stats_reset();
    unsigned long t0 = clock_now();
    for (char i = 0; i < 50; i++) rirq_wait();
    report("IDLE", clock_now() - t0);

    // 3. try the asset first; on a fresh disk this is the 62 path
    bool have = do_load();
    if (!have && !no_drive) {
        // 4. first run: write the built set as a PRG whose header says
        //    where "built" lives, then fetch it to $3800 regardless
        stats_reset();
        t0 = clock_now();
        krnio_setnam("CHARSET");
        bool ok = krnio_save(DRIVE, built, built + SIZE);
        unsigned long cyc = clock_now() - t0;
        printf("SAVE %d ST=%02X\n", ok, krnio_status());
        report(" ", cyc);
        drive_reply();
        have = do_load();
    }

    // 5. compare what landed at $3800 with what was built
    bool same = have && memcmp(CHARSET, built, SIZE) == 0;
    unsigned got = fold(CHARSET, SIZE);
    printf("%s CHK %04X %s D011=%02X\n", same ? "MATCH" : "MISMATCH",
           got, got == EXPECT_CHK ? "PASS" : "FAIL", vic.ctrl1);

    // 6. show the loaded set, drop the split, report the verdict
    vic.memptr = (char)(((0x0400 >> 10) << 4) | ((0x3800 >> 10) & 0x0e));
    vic.intr_enable = 0;
    vic.intr_ctrl = 1;
    bool pass = same && got == EXPECT_CHK;
    vic.color_border = pass ? VCOL_GREEN : VCOL_RED;
    RESULT = pass ? 1 : 2;
    for (;;) ;
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=load-asset-runtime.prg load-asset-runtime.c
```

Produces `load-asset-runtime.prg`, 6,710 bytes. `kernalio.h` and
`rasterirq.h` carry `#pragma compile` lines for their `.c` files, so
nothing else goes on the command line. The `#pragma region` at the top
redefines `main` as `$0880` to `$3800` with a 1 KB stack and a 256-byte
heap minimum; without the two size pragmas the linker refused with
`Cannot place stack section`, because the C64 default stack is 4 KB
(`toolchains/oscar64-reference.md`). The `.map` shows bss at `$2235`
to `$2B0D`, so `built` sits at `$2235` and nothing but the `$0801`
startup stub is outside the region. The run needs a disk in drive 8:

```bash
c1541 -format "TEST,01" d64 test.d64
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 \
      -limitcycles 24000000 -8 test.d64 \
      -drive8wobbleamplitude 0 -drive8wobblefrequency 0 \
      -exitscreenshot load-asset-runtime.png -autostart load-asset-runtime.prg
```

## Expected output

On a fresh disk, PAL:

```
LOAD ASSET AT RUN TIME
BUILT 2048 BYTES CHK C4FF
IDLE CYC=981940 F=49 IRQ=50 R=101..101
LOAD C=1 A=04 I=0 ST=42 END=0003
  CYC=1536937 F=78 IRQ=2 R=101..101
DRIVE: 62, FILE NOT FOUND,00,00
SAVE 1 ST=00
  CYC=7675684 F=390 IRQ=146 R=101..248
DRIVE: 00, OK,00,00
LOAD C=0 A=C7 I=0 ST=40 END=4000
  CYC=5572444 F=283 IRQ=222 R=101..170
DRIVE: 00, OK,00,00
MATCH CHK C4FF PASS D011=1B
```

Every character on the screen has a dotted line under it, because
the VIC is reading the loaded set at `$3800` by the time the picture
is taken; the space glyph was left alone so the gaps stay blank. The
border is green, `$02FF` holds `01`. Screenshots from the pinned
command: `screenshots/load-asset-runtime.png` (PAL) and
`screenshots/load-asset-runtime-ntsc.png` (NTSC), each from a disk
formatted as `TEST,01` immediately before the run. A second run of each
on another fresh disk gave a byte-identical PNG. The NTSC picture
differs in the `CYC`, `F`, `IRQ` and `R` figures only: idle
`854250 F=49`, the failed LOAD `1588028 F=92 IRQ=3 R=101..111`, the
SAVE `7971572 F=466 IRQ=171 R=101..242`, the LOAD
`5773293 F=337 IRQ=265 R=101..237`.

The `$02FF` trace, route 2 of `runtime/vice-reference.md` "Verifying a
run without a human", with the pinned command plus `-moncommands` on
a fresh disk: two dumps, `>C:02ff  00` from the reset clearing page 2
and `>C:02ff  01` from the program.

Read the lines in order:

- `BUILT`: the 2 KB set is the uppercase ROM font copied out from under
  I/O with `mmap_set(MMAP_CHAR_ROM)`, row 7 of every glyph except 32
  XORed with `$55`. `C4FF` is the fold `chk = ((chk ^ b) * 5 + 1) &
  0xffff` over those bytes, and the same fold in Python over
  `chargen-901225-01.bin` with the same edit gives `0xC4FF`, the
  compiled-in `EXPECT_CHK`.
- `IDLE`: 50 `rirq_wait()` frames with the bus quiet: 50 handler
  entries, all on line 101, one past the row-100 slot. This is the
  baseline the two transfers are read against.
- First `LOAD`: `C=1 A=04`, the KERNAL's file-not-found, with `ST=42`
  and the drive saying `62, FILE NOT FOUND,00,00`. It cost 1.5 million
  cycles, 78 PAL frames, for the drive to spin up and search the
  directory, and the split handler ran twice in those 78 frames.
  `END=0003` is whatever X/Y held on the failure path and means
  nothing. `I=0`: LOAD was entered with the I flag set and returned
  with it clear. That is the `kernal_assumes_sei_cleared` pitfall
  measured on LOAD itself: the serial primitives end in `CLI`, so a
  caller's `SEI` does not survive the first byte on the bus, and there
  is nothing to restore afterwards because the flag is already clear.
- `SAVE 1 ST=00`: `krnio_save(8, built, built + 2048)` wrote the set as
  the PRG `CHARSET` whose two-byte header says `$2235`, the address of
  `built`. 7.7 million cycles, 390 frames, drive reply `00, OK`. The
  split handler entered 146 times in those 390 frames and as late as
  line 248.
- Second `LOAD`: `C=0`, `END=4000`, which is `$3800` plus 2,048: the
  file's own header was discarded and the bytes went where X/Y said.
  `ST=40` is EOF, the bit the last byte arrives with, and it is what
  READST reports after a successful LOAD; test the carry, not ST, for
  success. 5.6 million cycles, 283 frames, 222 handler entries. `A=C7`
  is a leftover in the accumulator with no meaning on the success path.
- `MATCH CHK C4FF PASS`: `memcmp` of `$3800` against `built` is zero
  and the fold of `$3800` is the expected value. `D011=1B`: bit 4, the
  display enable, is set after the load, so the KERNAL did not blank
  the screen; bit 7 is the raster counter's ninth bit at the moment of
  the read and varies.

### What LOAD does to the screen and the raster IRQ

Two control runs of the same PRG on fresh disks, PAL, not pinned. At
9,000,000 cycles the program is inside the SAVE: the text area shows
the six lines up to `DRIVE: 62` in the ROM font on the normal blue,
and the border is light blue from the top of the frame to the bottom,
no white band at all. At 16,000,000 cycles it is inside the second
LOAD: the same text plus the three SAVE lines, background unchanged,
and the border is white from PNG y 105 to 206, raster lines 121 to
222, against 101 to 200 when idle. So the screen is never blanked and
the raster IRQ is not stopped, but it is late or missing: the handler
armed for row 100 entered in 146 of 390 SAVE frames and 222 of 283
LOAD frames, as late as line 248. `raster_irq_during_serial_io` in
`pitfalls/kernal-and-io.md` has the mechanism and the fix, which is to
clear `$D01A` around the call rather than rely on `SEI`; this program
keeps the IRQ armed on purpose, to count what happens.

The C64 KERNAL's LOAD does not touch `$D011`: `D011=1B` after the
load, and the control pictures show the text area drawn mid-transfer.
Fast loaders and other Commodore machines that blank the screen while
the drive works are doing it themselves, and were not measured here.

### The second start

The pinned run leaves `CHARSET` on the disk. Running the same PRG
again against that disk, PAL, 24,000,000 cycles, gave:

```
LOAD C=0 A=C7 I=0 ST=40 END=4000
  CYC=6931765 F=352 IRQ=223 R=101..195
DRIVE: 00, OK,00,00
MATCH CHK C4FF PASS D011=1B
```

No `62`, no SAVE. The one LOAD took 6.9 million cycles against 5.6
million for the second LOAD of the first run; the 1.4 million cycle
difference is about what the failed first LOAD cost, the drive's
spin-up and directory search, which the first run paid once and the
second start pays inside its only LOAD.

### The disk afterwards

`c1541 -attach test.d64 -list` printed:

```
0 "TEST            " 01 2a
9    "charset"          prg
655 blocks free.
```

`c1541 -read charset charset-back.prg` gave 2,050 bytes: header
`35 22`, that is `$2235`, then 2,048 bytes equal to the set Python
built from the ROM image. c1541 prints the name in lower case because
it shows unshifted PETSCII that way; the program wrote `CHARSET` in
upper case and reads it back with the same literal, so the shift never
comes into it. It would if the file were put on the disk with `c1541
-write` from the host, which is the `c1541_uppercase_filename_petscii_shift`
pitfall; a game that ships its asset on the disk image has to get that
right, and this recipe sidesteps it by writing the file from the C64.

## Why this works

`load_to` is SETLFS, SETNAM and LOAD written out in inline assembly
because Oscar64's `krnio_load(fnum, device, channel)` passes X = Y = 0
to LOAD (`kernalio.c`), which with secondary address 0 means load to
`$0000`. `krnio_load` is only useful with secondary 1, where the file's
header decides. With `ldy #0` to SETLFS the KERNAL reads the two header
bytes and throws them away, substituting the X/Y the caller gave LOAD;
with `ldy #1` it keeps them. Either way the bytes are stored through
the pointer at `$AE/$AF`, and the X/Y returned is that pointer after
the last store, which is why `END=4000` says 2,048 bytes arrived.
`techniques/file-io.md` under `kernal_load_to_address` has the same
sequence in KickAssembler and the measurements for both secondary
addresses.

A game supplies its own address for the reason this program does: the
file was saved from wherever the buffer happened to be when the artist
or the build made it, `$2235` here, and the game wants it somewhere
else, in the VIC's bank at a character-set boundary. Secondary 0 makes
the file's header irrelevant, so one file serves both buffers of a
double-buffered charset or any map slot. Secondary 1 is for the case
where the file's author chose the address and the program must honour
it, a PRG-format music file assembled to `$1000` for example.

`krnio_save(device, start, end)` is SETLFS with secondary 0, then SAVE
with A pointing at the start pointer in zero page and X/Y the end. It
writes the two-byte header from `start`, so the file on the disk is a
PRG that LOADs back to `built` with secondary 1 and anywhere with
secondary 0. The `krnio_save_leaves_splat_file` pitfall applies if the
emulator is stopped before the drive finishes; the 24,000,000 cycle
pin is well past the end of the run, and the listing shows no `*`.

The raster split is `iotest.c` from `high-score-persist.md`, section
"A raster IRQ during file I/O", cut down to one handler. It keeps the
KERNAL IRQ (`rirq_init(true)`) so the jiffy clock and the keyboard scan
still run, and it is switched off with `vic.intr_enable = 0` before
the verdict colour goes in the border so the split cannot repaint it.
One correction to that test program: its model check read `PAL` on
NTSC in two of its builds, and the cause is a race in
`if ((vic.ctrl1 & 0x80) && r > top)` with `r` read first. A `$D012`
read on line 255 followed by a `$D011` read on line 256 counts as line
`$1FF`, which is above the PAL top, and it happens on either model. The
first version of this program had the same defect and printed `F=42`
for the NTSC idle frames, that is 844,100 cycles divided by 19,656.
Reading bit 7 of `$D011` on both sides of the `$D012` read and
requiring both set removes it: the NTSC idle line now reads `F=49`.

The drive's status channel is opened only after a LOAD has answered,
and not at all when LOAD returns `A=5`, device not present. A bare
`OPEN` of secondary 15 sends nothing on the bus, so it cannot fail for
want of a drive, and the read that follows would then wait for ever
(`high-score-persist.md`). The KB's lint flags every bare `OPEN 15`
followed by a read as a heuristic, this one included; the guard is
what makes it safe here.

Nothing on this page was measured on hardware. The cycle counts are
CIA2 timers A and B chained, read in VICE x64sc 3.10 with true drive
emulation and the drive's RPM wobble switched off, as the verifier pins
it; frames are those cycles over 19,656 (PAL) or 17,095 (NTSC).
