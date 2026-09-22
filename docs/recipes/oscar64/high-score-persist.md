---
recipe: high-score-persist
toolchain: oscar64
output_format: PRG
region: both
techniques: [kernal_file_write_seq, kernal_file_read_seq, error_channel_check]
file_formats: [PRG]
uses_registers: []
uses_kernal: [SETLFS, SETNAM, OPEN, CLOSE, CHKIN, CHKOUT, CLRCHN, CHRIN, CHROUT, READST]
---

<!-- doc-type: recipe -->

# Oscar64 High-Score File: First Run, Replace, Version Check

## Synopsis

The save-file policy a game needs around the file calls, run end to
end against drive 8 through Oscar64's `kernalio.h`. On start the
program tries to read the sequential file `HISCORE`. That OPEN sends a
name down the bus, so it is also the device test: when no drive answers
it returns false with ST bit 7 set and the bus is left alone for the
rest of the run. A drive reply of
`62` is the first run: it shows the default table and writes it. A
reply of `00` with a record of the right size, magic and version is a
load. A record of the wrong size or version is rejected, scratched and
replaced. Any other reply, `74` with no disk in the drive for one,
turns saving off for the session and the defaults are used. It then
enters a new score, replaces the file by scratch-then-write, reads it
back and prints it, with the drive's reply and `krnio_status()` after
every step and a 16-bit checksum of the record that came back matched
against the value Python computed. The verifier gives every run a
freshly formatted disk, so one pinned run exercises the first-run path,
the first write, the scratch, the rewrite and the read-back in
sequence. The other paths were run once each and are described below.
Use it as the skeleton for a high-score file or a save slot.

## Source

```c
// high-score-persist.c
// The save-game policy in one run against drive 8, through Oscar64's
// kernalio.h. On start, try to read the SEQ file HISCORE. That OPEN
// sends a name down the bus, so it is also the device test: if no drive
// answers it returns false with ST bit 7 (KRNIO_NODEVICE) and the bus
// is not touched again. A drive reply of 62 means first run: show the
// default table and write it. A reply of 00 with a record of the right
// size and version means loaded. Any other reply means saving is off
// for this session and the defaults are used. Then a new high score is
// entered, the file is scratched and rewritten, and read back. The
// drive reply and krnio_status() are printed at every step, and a
// 16-bit checksum of the record that came back is shown with PASS or
// FAIL against the value Python computed.
#include <stdio.h>
#include <string.h>
#include <c64/kernalio.h>

#define DRIVE       8
#define VERSION     1
#define ENTRIES     3
#define EXPECT_CHK  0xF1F6           // python: same fold over the 21 bytes

typedef struct {
    char     name[4];                // three letters and a terminating zero
    unsigned score;                  // 16 bits, stored low byte first
} Score;

typedef struct {
    char  magic[2];                  // 'H','S'
    char  version;                   // bump when the layout changes
    Score entry[ENTRIES];
} Table;                             // 21 bytes: no padding in Oscar64

static const Table defaults = {
    { 'H', 'S' }, VERSION,
    {{ "ABC", 5000 }, { "DEF", 2500 }, { "GHI", 1000 }}
};

static Table table;                  // the live table
static char  back[64];               // read buffer, bigger than the file
static char  reply[40];              // one drive status line
static char  code;                   // first two digits of the last reply
static bool  saving;                 // false: drive 8 is not usable

static void put_hex2(char v)
{
    char d = v >> 4;
    putchar(d < 10 ? '0' + d : 'A' + d - 10);
    d = v & 15;
    putchar(d < 10 ? '0' + d : 'A' + d - 10);
}

// Open the command channel with cmd as the name ("" to read the status,
// or a DOS command such as "S0:HISCORE"), read one status line from the
// same open channel, close it. The reply to a command is only there
// until the channel that sent it is closed. Sets code to the two-digit
// number at the head of the line. Never called once the device is known
// to be absent: an empty name sends nothing on the bus, so this OPEN
// succeeds whether or not a drive exists, and the CHKIN inside
// krnio_gets would then hang with no timeout.
static void drive_reply(const char *cmd)
{
    reply[0] = 0;
    code = 99;
    krnio_setnam(cmd);
    if (krnio_open(15, DRIVE, 15)) {
        int n = krnio_gets(15, reply, sizeof(reply));
        if (n > 0 && reply[n - 1] == 13)
            reply[n - 1] = 0;
        if (n >= 2)
            code = (reply[0] - '0') * 10 + (reply[1] - '0');
        krnio_close(15);
    }
    printf("DRIVE: %s\n", reply);
}

// chk = ((chk ^ b) * 5 + 1) & 0xffff over n bytes
static unsigned fold(const char *p, int n)
{
    unsigned c = 0;
    for (int i = 0; i < n; i++)
        c = (c ^ p[i]) * 5 + 1;
    return c;
}

// Write the live table as HISCORE,S,W. Returns true when the drive
// answered 00 after the close.
static bool save_table(void)
{
    printf("WRITE HISCORE,S,W %d BYTES\n", (int)sizeof(Table));
    krnio_setnam("HISCORE,S,W");
    bool ok = krnio_open(2, DRIVE, 2);
    printf("OPEN %d ST=", ok);   put_hex2(krnio_status());
    int n = krnio_write(2, (const char *)&table, sizeof(Table));
    printf(" WRITE %d ST=", n);   put_hex2(krnio_status());
    krnio_close(2);
    printf(" CLOSE ST=");         put_hex2(krnio_status());
    putchar('\n');
    drive_reply("");
    return code == 0;
}

// Try to read HISCORE,S,R into back[]. Returns the byte count (0 when
// the file is missing or the device did not answer). This OPEN sends
// the name down the bus, so it is the one call that can see an absent
// drive: it then returns false with KRNIO_NODEVICE in the status.
static int load_table(void)
{
    printf("READ HISCORE,S,R\n");
    krnio_setnam("HISCORE,S,R");
    bool ok = krnio_open(2, DRIVE, 2);
    printf("OPEN %d ST=", ok);   put_hex2(krnio_status());
    if (!ok && (krnio_status() & KRNIO_NODEVICE)) {
        // nothing answered: do not CHKIN, it hangs with no timeout on a
        // device that does not answer, and do not ask for a reply
        krnio_close(2);
        printf("\nDRIVE: NO DEVICE\n");
        code = 99;
        saving = false;
        return 0;
    }
    int n = 0;
    if (ok) {
        n = krnio_read(2, back, sizeof(back));
        printf(" READ %d ST=", n); put_hex2(krnio_pstatus[2]);
    }
    putchar('\n');
    krnio_close(2);
    drive_reply("");
    return n;
}

// Replace the file on disk: scratch it, then write. Writing HISCORE,S,W
// over an existing name is refused with 63, FILE EXISTS, and every byte
// written afterwards comes back with ST=$80, KRNIO_NODEVICE: the drive
// does not acknowledge bytes on a channel it never opened.
static bool rewrite_table(void)
{
    printf("SCRATCH S0:HISCORE\n");
    drive_reply("S0:HISCORE");
    return save_table();
}

static void show_table(const char *label)
{
    printf("%s", label);
    for (char i = 0; i < ENTRIES; i++)
        printf(" %s %u", table.entry[i].name, table.entry[i].score);
    putchar('\n');
}

// Insert a score in rank order, dropping the last entry.
static void enter_score(const char *name, unsigned score)
{
    char i = ENTRIES;
    while (i > 0 && table.entry[i - 1].score < score) {
        if (i < ENTRIES)
            table.entry[i] = table.entry[i - 1];
        i--;
    }
    if (i < ENTRIES) {
        strcpy(table.entry[i].name, name);
        table.entry[i].score = score;
    }
}

int main(void)
{
    printf("%cHIGH SCORE PERSIST (KERNALIO.H)\n", 147);

    // 1. try to load; the named OPEN inside is also the device test
    table = defaults;
    saving = true;
    int n = load_table();
    const Table *got = (const Table *)back;

    // 2. decide what state the save is in
    if (code == 0 && n == sizeof(Table) &&
        got->magic[0] == 'H' && got->magic[1] == 'S' &&
        got->version == VERSION) {
        table = *got;
        show_table("LOADED:");
    } else if (code == 0 && n > 0) {
        // right name, wrong layout: reject it and start again
        printf("OLD FORMAT %d BYTES V%d: RESET\n", n, got->version);
        saving = rewrite_table();
        show_table("DEFAULTS:");
    } else if (code == 62) {
        printf("FIRST RUN\n");
        saving = save_table();
        show_table("DEFAULTS:");
    } else {
        // 74 with no disk, 99 with no device, anything else unexpected
        printf("SAVING OFF (%d)\n", code);
        saving = false;
        show_table("DEFAULTS:");
    }

    // 3. a new high score, then rewrite: scratch first, then write
    enter_score("YOU", 4000);
    show_table("NEW:");
    if (saving)
        saving = rewrite_table();

    // 4. read back what is on the disk now and check it
    if (saving) {
        n = load_table();
        got = (const Table *)back;
        printf("BACK V%d:", got->version);
        for (char i = 0; i < ENTRIES; i++)
            printf(" %s %u", got->entry[i].name, got->entry[i].score);
        putchar('\n');
    } else {
        printf("NOT SAVED\n");
        memcpy(back, &table, sizeof(Table));
        n = sizeof(Table);
    }
    unsigned chk = fold(back, n);
    printf("CHK ");
    put_hex2(chk >> 8);
    put_hex2(chk & 0xff);
    printf(chk == EXPECT_CHK ? " PASS\n" : " FAIL\n");
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=high-score-persist.prg high-score-persist.c
```

Produces `high-score-persist.prg`. `kernalio.h` carries
`#pragma compile("kernalio.c")`, so the wrapper source is compiled in
without a second file on the command line. The run needs a disk in
drive 8:

```bash
c1541 -format "test,01" d64 test.d64
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 \
      -limitcycles 24000000 -8 test.d64 \
      -drive8wobbleamplitude 0 -drive8wobblefrequency 0 \
      -exitscreenshot high-score-persist.png -autostart high-score-persist.prg
```

## Expected output

```
HIGH SCORE PERSIST (KERNALIO.H)
READ HISCORE,S,R
OPEN 1 ST=00 READ 0 ST=42
DRIVE: 62, FILE NOT FOUND,00,00
FIRST RUN
WRITE HISCORE,S,W 21 BYTES
OPEN 1 ST=00 WRITE 21 ST=00 CLOSE ST=00
DRIVE: 00, OK,00,00
DEFAULTS: ABC 5000 DEF 2500 GHI 1000
NEW: ABC 5000 YOU 4000 DEF 2500
SCRATCH S0:HISCORE
DRIVE: 01, FILES SCRATCHED,01,00
WRITE HISCORE,S,W 21 BYTES
OPEN 1 ST=00 WRITE 21 ST=00 CLOSE ST=00
DRIVE: 00, OK,00,00
READ HISCORE,S,R
OPEN 1 ST=00 READ 21 ST=40
DRIVE: 00, OK,00,00
BACK V1: ABC 5000 YOU 4000 DEF 2500
CHK F1F6 PASS

READY.
```

Light blue text on blue, the ordinary power-on screen. The text is the
same on PAL and NTSC. Screenshots from the VICE runs this page
describes: `screenshots/high-score-persist.png` (PAL) and
`screenshots/high-score-persist-ntsc.png` (NTSC), both from the pinned
command above with a disk formatted as `TEST,01` immediately before the
run. A second PAL run on another fresh disk gave a pixel-identical PNG.
`c1541 -list` of the disk afterwards shows one file, `"hiscore" seq`,
and 663 blocks free.

Read the lines in pairs. `ST=` is `krnio_status()`, the KERNAL's status
byte (READST, `$FFB7`); after the read it is `krnio_pstatus[2]`, the
value the wrapper kept for that logical file. `DRIVE:` is the text the
1541 put on its command channel.

- The first call is the OPEN for read, and it is the device test as
  well: it sends the name `HISCORE,S,R` down the bus, so a bus with no
  drive on it returns `OPEN 0 ST=80` (measured below). The 1541's
  power-on banner, `73,CBM DOS V2.6 1541,00,00`, does not appear in
  this run: the error the OPEN raises replaces it before the channel is
  first read. A probe that reads the channel before any other command
  gets the `73` line first (measured in the same VICE build).
- First run: the OPEN for read succeeds (`OPEN 1 ST=00`), the read
  returns 0 bytes with ST `$42` (EOF and timeout bits) and the drive
  says `62, FILE NOT FOUND`. The program takes that as "no save yet",
  writes the defaults (21 bytes, ST `00` through open, write and close,
  drive `00, OK`) and shows them.
- New score: `YOU 4000` is inserted in rank order and `GHI 1000` drops
  off the end.
- Replace: `S0:HISCORE` on the command channel answers `01, FILES
  SCRATCHED,01,00`, read from the same open channel. The rewrite then
  opens cleanly. An earlier build of this listing wrote over the
  existing name without the scratch: the drive answered `63, FILE
  EXISTS,00,00`, `krnio_write` still returned 21 but ST was `$80` after
  the write and the close, and nothing reached the disk. That `$80` is
  the device-not-present bit (`KRNIO_NODEVICE`), not a timeout: the
  drive did not acknowledge bytes on a channel it never opened.
  Reading the
  scratch reply after closing and reopening channel 15 gave `00, OK`
  instead of the `01` line; the reply to a command lasts only while the
  channel that sent it is open.
- Read-back: 21 bytes with ST `$40` (EOF), drive `00, OK`, and the
  record decodes to the table that was written. `CHK F1F6` is the fold
  `chk = ((chk ^ byte) * 5 + 1) & 0xFFFF` over those 21 bytes; Python
  gives `0xF1F6` for the same bytes, so the line reads `PASS`.

### The other paths, run once each (not pinned)

**Second run, same disk, file present.** The same command run again on
the disk the pinned run left behind. The read returns 21 bytes with ST
`$40` and the drive says `00, OK`; the program prints `LOADED: ABC 5000
YOU 4000 DEF 2500`. The new score is entered again, so the table becomes
`ABC 5000 YOU 4000 YOU 4000` (a tie is placed below the entry already
there), the scratch answers `01, FILES SCRATCHED,01,00`, the rewrite and
read-back succeed, and the last line reads `CHK B91C FAIL`. That FAIL
is expected: `EXPECT_CHK` is the first-run table's value, and Python's
fold of the second-run table is `0xB91C`, so the disk holds exactly
what was written. The screen ends at row 15 with `READY.` on row 17.

**No disk attached.** The same command with no `-8` argument. VICE
`-default` still emulates a 1541 on device 8, so the drive answers: the
OPEN for read succeeds with ST `00`, the read returns 0 bytes with ST
`$42`, and the error channel says `74,DRIVE NOT READY,00,00`. The
program prints `SAVING OFF (74)`, shows the defaults, enters the new
score, prints `NOT SAVED`, and the checksum line reads `CHK F1F6 PASS`
because it is then folded over the in-memory table, which is the same
21 bytes. Nine lines of text on rows 0 to 8, `READY.` on row 10. This
measures a drive with no disk, not an absent drive.

**No device on the bus.** The same command with no `-8` and
`-drive8type 0` added, so that nothing is emulated on device 8. The
OPEN for read comes back as `OPEN 0 ST=80`: OPEN returned C=1,
and ST holds bit 7, `KRNIO_NODEVICE`, which the KERNAL sets when no
device pulls DATA low in answer to the LISTEN
(`../../hardware/kernal-routines-reference.md`, CHKOUT entry). The
program prints `DRIVE: NO DEVICE`, then `SAVING OFF (99)`, the defaults,
the new score, `NOT SAVED` and `CHK F1F6 PASS`: the same nine lines as
the no-disk case with the two drive lines changed, `READY.` on row 10.
The same screen comes from `+drive8truedrive` with no `-8` and the
drive type left at its default.

Two things about that path are worth knowing, both measured in this
VICE build with `-drive8type 0`. First, an OPEN of channel 15 with an
empty name cannot detect an absent drive: the KERNAL sends nothing on
the bus when the filename length is zero, so that OPEN returned 1 with
ST `00` with no drive present, while OPEN of `I0` on channel 15 and of
`HISCORE,S,R` on channel 2 both returned 0 with ST `$80`. Second, the
first CHKIN on a channel whose device does not answer hangs with no
timeout (`../../hardware/kernal-routines-reference.md`, CHKIN entry), and
`krnio_gets` starts with CHKIN. An earlier build of this listing read
the banner with an empty-name OPEN before anything else and then hung
inside `krnio_gets` with the title line alone on screen after 24,000,000
cycles. That is why `drive_reply` is only ever called after a named OPEN
has succeeded, and why the named OPEN of the save file comes first.

**Old format on the disk.** A 15-byte `HISCORE` with version byte 0 was
written to a fresh disk with `c1541 -write old.bin hiscore,s`. The read
returned 15 bytes with ST `$40` and drive `00, OK`; the program printed
`OLD FORMAT 15 BYTES V0: RESET`, scratched (`01, FILES SCRATCHED,01,00`),
wrote the defaults, then entered the new score, scratched and wrote
again, and read back `BACK V1: ABC 5000 YOU 4000 DEF 2500` with
`CHK F1F6 PASS`.

## Why this works

The policy turns on the first two digits of the drive's reply, not on
the KERNAL's status byte alone. After a failed OPEN for read the
KERNAL only knows that the read timed out (ST `$42`); it is the error
channel that separates `62` (no file: write the defaults) from `74` (no
disk: leave the disk alone) from `00` (a file came back: check it).
The one case the status byte does settle on its own is an absent drive:
OPEN of a named file returns false with `KRNIO_NODEVICE` set, and the
program never touches the bus again. `drive_reply` opens logical file
15 on secondary 15 with the string it is given, an empty name to read
the status or a DOS command such as `S0:HISCORE`, reads one line with
`krnio_gets`, strips the CR and closes; `code` keeps the two digits so
the caller can branch on them. The reply is read on the same open
channel in both uses because the reply to a command is gone once
channel 15 is closed.

A 21-byte record with a magic pair, a version byte and three fixed
six-byte entries lets `load_table` accept or reject a file with three
comparisons: the byte count, the magic and the version. A record that
grows in a later release changes the version byte, and the old file is
then rejected and rewritten rather than read as garbage. Oscar64 packs
the struct with no padding, so `sizeof(Table)` is the file size on disk
and the record can be written and read as raw bytes.

Replacing the file is scratch, then write. OPEN of `HISCORE,S,W` over an
existing name is refused by the DOS with `63, FILE EXISTS` and every
byte written afterwards comes back with ST `$80`, the device-not-present
bit (`KRNIO_NODEVICE`): the drive does not acknowledge bytes on a
channel it never opened. The earlier build of this listing measured
that, and the disk was unchanged afterwards. `@0:HISCORE,S,W` would ask
the DOS to replace in place; `../../techniques/file-io.md` says why this
KB does not lean on that command. A scratch of a name that is not there
costs one command-channel round trip and does no harm: `S0:NOSUCH` on a
disk without that file answers `01, FILES SCRATCHED,00,00`, count `00`,
and the directory is unchanged (measured in VICE). Every call here is a
KERNAL call, so the ROM must be banked in from the first OPEN to the
last CLOSE; the write of a 21-byte file and its close must also be
allowed to finish before the machine is reset or the emulator exits, or
the directory holds a splat file (`../../pitfalls/kernal-and-io.md`,
`krnio_save_leaves_splat_file`). The bare write-and-read sequence
without the policy is `save-load-seq-file.md` in this directory and
`../kickassembler/file-io-roundtrip.md` in assembly.
