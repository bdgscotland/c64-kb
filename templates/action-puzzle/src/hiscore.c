// hiscore.c: the table and its file. The disk policy is the
// oscar64/high-score-persist recipe's: the named OPEN for read is also the
// device test; the drive's reply on channel 15 decides first run (62),
// loaded (00) or saving off (anything else); a file is replaced by scratch,
// then write, because OPEN ...,S,W over an existing name fails with 63.
#include "hiscore.h"
#include <c64/kernalio.h>
#include <string.h>

#ifndef FORCE_FAULT
#define FORCE_FAULT 0
#endif

#define DRIVE   8
#define VERSION 1

HiTable hi;
char hi_state, hi_code;
bool hi_saving, hi_verified;

static char back[64];                           // read buffer, bigger than the file
static char reply[40];                          // one line from channel 15

// Original default names and scores, as screen codes.
static const HiTable defaults = {
    { 'C', 'R' }, VERSION,
    {
        { { 4, 9, 7 },    400 },                // DIG
        { { 18, 15, 24 }, 300 },                // ROX
        { { 7, 5, 13 },   200 },                // GEM
        { { 13, 21, 4 },  100 },                // MUD
        { { 15, 18, 5 },   50 }                 // ORE
    }
};

void hi_defaults(void)
{
    hi = defaults;
}

// The first row whose score is strictly lower: a tie goes below the holder.
char hi_rank(unsigned long score)
{
    char r = 0;
    while (r < HI_ROWS && hi.row[r].score >= score)
        r++;
    return r;
}

// Shift the rows below `rank` down one, dropping the last, and write the new row.
void hi_insert(char rank, const char *name, unsigned long score)
{
    if (rank >= HI_ROWS)
        return;
    for (char r = HI_ROWS - 1; r > rank; r--)
        hi.row[r] = hi.row[r - 1];
    for (char k = 0; k < 3; k++)
        hi.row[rank].name[k] = name[k];
    hi.row[rank].score = score;
}

// Send `cmd` on channel 15 ("" to read the status only), read one reply
// line from the same open channel, close it. Sets hi_code from its first
// two digits. Only called after a named OPEN has answered, because an
// empty-name OPEN cannot see an absent drive and the CHKIN inside
// krnio_gets would then hang (the recipe measured it).
// drive_ask leaves channel 15 open and says whether it opened: read_file
// keeps it open while its file is, because closing 15 closes every file on
// the drive.
static bool drive_ask(const char *cmd)
{
    reply[0] = 0;
    hi_code = 99;
    krnio_setnam(cmd);
    bool open = krnio_open(15, DRIVE, 15);
    if (open)
    {
        int n = krnio_gets(15, reply, sizeof(reply));
        if (n >= 2)
            hi_code = (reply[0] - '0') * 10 + (reply[1] - '0');
    }
    return open;
}

static void drive_reply(const char *cmd)
{
    if (drive_ask(cmd))
        krnio_close(15);
}

// Read HISCORE into back[] (filled with $FF first, so a short read cannot
// pass on old bytes). Returns the byte count; hi_code holds the drive's
// reply to the OPEN, 99 when no device answered it. The reply is read
// before the file, and the file only on 00: after a 62 the drive keeps no
// channel, and a read would TALK to it. The drive answers that TALK with a
// 68-cycle CLK pulse, a badline can hide it from the KERNAL's wait at $EDD6,
// and that wait has no timeout (pitfall first_open_after_reset_hangs_on_pal).
// An earlier version read first and waited 50 frames at start-up, which only
// moved the phase.
static int read_file(void)
{
    memset(back, 0xff, sizeof(back));
    krnio_setnam("HISCORE,S,R");
    bool ok = krnio_open(2, DRIVE, 2);
    if (!ok && (krnio_status() & KRNIO_NODEVICE))
    {
        krnio_close(2);                         // nothing answered: leave the bus alone
        hi_code = 99;
        return 0;
    }
    bool cmd = drive_ask("");
    int n = 0;
    if (ok && hi_code == 0)
        n = krnio_read(2, back, sizeof(back));
    krnio_close(2);
    if (cmd)
        krnio_close(15);
    return n;
}

void hi_load(void)
{
    hi_defaults();
    hi_saving = false;
    hi_state = HI_OFF;
    int n = read_file();
    const HiTable *got = (const HiTable *)back;
    if (hi_code == 0 && n == sizeof(HiTable) && got->magic[0] == 'C' &&
        got->magic[1] == 'R' && got->version == VERSION)
    {
        hi = *got;
        hi_state = HI_LOADED;
        hi_saving = true;
    }
    else if (hi_code == 0 && n > 0)
    {
        hi_state = HI_OLD;                      // right name, wrong layout: replaced on save
        hi_saving = true;
    }
    else if (hi_code == 62)
    {
        hi_state = HI_FIRST;
        hi_saving = true;
    }
}

bool hi_save(void)
{
    if (!hi_saving)
        return false;
    drive_reply("S0:HISCORE");                  // 01 FILES SCRATCHED, count 00 when absent
    krnio_setnam("HISCORE,S,W");
    if (krnio_open(2, DRIVE, 2))
        krnio_write(2, (const char *)&hi, sizeof(HiTable));
    krnio_close(2);
    drive_reply("");
    hi_saving = hi_code == 0;
    hi_verified = false;
    if (!hi_saving)
        return false;
    // Read the file back and compare it with what was written: the drive's
    // 00 says the write was accepted, not that these bytes are on the disk.
    int n = read_file();
#if FORCE_FAULT
    back[3] ^= 1;                               // the self-test: a bad read-back must fail
#endif
    hi_verified = hi_code == 0 && n == sizeof(HiTable) &&
                  memcmp(back, &hi, sizeof(HiTable)) == 0;
    return hi_verified;
}
