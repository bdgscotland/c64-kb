// save.c: see save.h. tools/gen.py's Game.record() writes the same record.
#include "save.h"
#include "engine.h"
#include <c64/kernalio.h>

#define DRIVE   8
#define VERSION 1
#define RECLEN  (10 + 2 * (NITEM - 1))

char disk_code;
static char rec[RECLEN + 8];                    // read buffer: bigger than the record
static char reply[40];

static char fold8(const char *p, char n)
{
    char c = 0;
    for (char i = 0; i < n; i++)
        c = (c ^ p[i]) * 3 + 1;
    return c;
}

// Send cmd on channel 15 ("" reads the status only) and keep the first two
// digits of the reply. Named first: an empty-name OPEN cannot see an absent
// drive, and the read after it would then hang (oscar64/high-score-persist).
static void drive_reply(const char *cmd)
{
    disk_code = 99;
    krnio_setnam(cmd);
    bool ok = krnio_open(15, DRIVE, 15);
    if (krnio_status() & KRNIO_NODEVICE)
        ok = false;
    if (ok && krnio_gets(15, reply, sizeof(reply)) >= 2)
        disk_code = (reply[0] - '0') * 10 + (reply[1] - '0');
    krnio_close(15);
}

static void reply_line(char m)                  // "GAME SAVED (00)."
{
    out_msg(m);
    out_chr('(');
    out_chr('0' + disk_code / 10);
    out_chr('0' + disk_code % 10);
    out_msg(M_CLOSEP);
    out_nl();
}

void game_save(void)
{
    char n = 0;
    rec[n++] = 'S';
    rec[n++] = 'W';
    rec[n++] = VERSION;
    rec[n++] = room;
    rec[n++] = score;
    rec[n++] = turns & 0xff;
    rec[n++] = turns >> 8;
    rec[n++] = flags & 0xff;
    rec[n++] = flags >> 8;
    for (char i = 1; i < NITEM; i++)
        rec[n++] = loc[i];
    for (char i = 1; i < NITEM; i++)
        rec[n++] = opened[i];
    rec[n] = fold8(rec, n);

    drive_reply("S0:SAVEGAME");                 // 01 FILES SCRATCHED, or 00 with none
    if (disk_code < 20)                         // the drive answered and is ready
    {
        krnio_setnam("SAVEGAME,S,W");           // over a file that exists this is 63
        if (krnio_open(2, DRIVE, 2))
            krnio_write(2, rec, RECLEN);
        krnio_close(2);
        drive_reply("");
    }
    reply_line(disk_code == 0 ? M_SAVED : M_DISKFAIL);
}

void game_load(void)
{
    krnio_setnam("SAVEGAME,S,R");
    bool ok = krnio_open(2, DRIVE, 2);
    if (!ok && (krnio_status() & KRNIO_NODEVICE))
    {
        krnio_close(2);                         // nothing answered: leave the bus alone
        disk_code = 99;
        reply_line(M_DISKFAIL);
        return;
    }
    int n = ok ? krnio_read(2, rec, sizeof(rec)) : 0;
    krnio_close(2);
    drive_reply("");
    if (disk_code == 62)
        reply_line(M_NOSAVE);
    else if (disk_code != 0)
        reply_line(M_DISKFAIL);
    else if (n != RECLEN || rec[0] != 'S' || rec[1] != 'W' || rec[2] != VERSION ||
             rec[RECLEN - 1] != fold8(rec, RECLEN - 1))
        reply_line(M_BADSAVE);
    else
    {
        char k = 3;
        room = rec[k++];
        score = rec[k++];
        turns = rec[k] | (rec[k + 1] << 8);
        flags = rec[k + 2] | (rec[k + 3] << 8);
        k += 4;
        for (char i = 1; i < NITEM; i++)
            loc[i] = rec[k++];
        for (char i = 1; i < NITEM; i++)
            opened[i] = rec[k++];
        over = 0;
        reply_line(M_LOADED);
        look();
    }
}
