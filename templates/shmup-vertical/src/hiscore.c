// hiscore.c: the high score in the sequential file HISCORE on drive 8, with
// the policy of c64-kb's oscar64/high-score-persist recipe: the first named
// OPEN is also the device test (no drive: saving off, the bus is never
// touched again); the drive's reply separates 62 (no file: first run, write
// it) from 00 (a file: check its size, magic and version) from anything else
// (saving off). A file is replaced by scratch, then write.
//
// The game runs with the KERNAL banked out and its own raster IRQ chain.
// Around every file call the chain is stopped with $D01A = 0 (not SEI: the
// KERNAL's serial routines end in CLI) and the KERNAL is banked in; after,
// the KERNAL is banked out, SEI again, and the chain restarted. The screen
// holds still meanwhile: saving happens on the game-over screen.
//
// Sprites go off too. With the autopilot's eleven sprites left on, the
// status read after writing HISCORE never returned on PAL in 3 of 3 runs on a
// fresh disk (VICE x64sc 3.10, true drive); with $D015 = 0 it returned in
// every run, PAL and NTSC. Sprite DMA stealing cycles from the KERNAL's
// serial timing is the likely cause; it was not isolated further.
#include "hiscore.h"
#include <c64/kernalio.h>

#define DRIVE   8
#define VERSION 1

bool disk_on = true;
char disk_code = 99;

static char record[5];                  // 'S', 'V', version, hiscore low, high
static char back[8];
static char reply[40];
static char saved_01, saved_d01a;

static void io_begin(void)
{
    __asm { sei }
    saved_d01a = vic.intr_enable;
    vic.intr_enable = 0;                // no raster IRQ during the serial calls
    vic.spr_enable = 0;                 // no sprite DMA either (see the top of this file)
    saved_01 = *(volatile char *)0x01;
    *(volatile char *)0x01 = 0x36;      // KERNAL and I/O in
}

static void io_end(void)
{
    __asm { sei }                       // the serial routines left CLI behind
    *(volatile char *)0x01 = saved_01;
    cia1.icr = 0x7f;                    // no CIA1 interrupt, whatever the KERNAL set
    char c = cia1.icr;
    (void)c;
    vic.intr_ctrl = 0x0f;               // drop a raster match latched meanwhile
    vic.intr_enable = saved_d01a;
    if (saved_d01a & 0x01)              // the chain was running: let it run again
        __asm { cli }
}

// Send cmd on the command channel ("" only reads the status) and read the
// reply line on the same open channel; disk_code = its two digits.
static void drive_reply(const char *cmd)
{
    disk_code = 99;
    krnio_setnam(cmd);
    if (krnio_open(15, DRIVE, 15)) {
        int n = krnio_gets(15, reply, sizeof(reply));
        if (n >= 2)
            disk_code = (reply[0] - '0') * 10 + (reply[1] - '0');
        krnio_close(15);
    }
}

static void write_record(void)
{
    record[0] = 'S';
    record[1] = 'V';
    record[2] = VERSION;
    record[3] = (char)hiscore;
    record[4] = (char)(hiscore >> 8);
    drive_reply("S0:HISCORE");          // a missing file answers 01, harmless
    krnio_setnam("HISCORE,S,W");
    if (krnio_open(2, DRIVE, 2))
        krnio_write(2, record, sizeof(record));
    krnio_close(2);
    drive_reply("");
    disk_on = disk_code == 0;
}

void hiscore_load(void)
{
    if (!disk_on)
        return;
    io_begin();
    krnio_setnam("HISCORE,S,R");
    bool ok = krnio_open(2, DRIVE, 2);
    if (!ok && (krnio_status() & KRNIO_NODEVICE)) {
        krnio_close(2);                 // nothing answered: never CHKIN (no timeout)
        disk_on = false;
        disk_code = 99;
        io_end();
        return;
    }
    int n = ok ? krnio_read(2, back, sizeof(back)) : 0;
    krnio_close(2);
    drive_reply("");
    if (disk_code == 0 && n == sizeof(record) && back[0] == 'S' && back[1] == 'V' && back[2] == VERSION)
        hiscore = back[3] | (back[4] << 8);
    else if (disk_code == 62 || disk_code == 0)
        write_record();                 // first run, or an old layout: write ours
    else
        disk_on = false;                // 74 no disk, or anything unexpected
    io_end();
}

void hiscore_save(void)
{
    if (!disk_on)
        return;
    io_begin();
    write_record();
    io_end();
}

void hiscore_forget(void)
{
    io_begin();
    krnio_setnam("HISCORE,S,R");        // the device test, as in hiscore_load
    bool ok = krnio_open(2, DRIVE, 2);
    bool none = !ok && (krnio_status() & KRNIO_NODEVICE);
    krnio_close(2);
    if (none)
        disk_on = false;
    else
        drive_reply("S0:HISCORE");
    io_end();
}
