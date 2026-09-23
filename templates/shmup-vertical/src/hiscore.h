// hiscore.h: the high score in a file on drive 8.
#ifndef HISCORE_H
#define HISCORE_H

#include "game.h"

extern bool disk_on;            // drive 8 answered: saving is on this session
extern char disk_code;          // the drive's last reply: 0 OK, 62 no file, 99 none

void hiscore_load(void);        // read HISCORE into hiscore; first run: write it
void hiscore_save(void);        // replace HISCORE with hiscore (scratch, write)
void hiscore_forget(void);      // scratch HISCORE (the autopilot's fresh start)

#pragma compile("hiscore.c")

#endif
