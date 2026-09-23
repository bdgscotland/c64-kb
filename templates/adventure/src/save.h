// save.h: SAVE and LOAD of the game state as the sequential file SAVEGAME on
// drive 8 (c64-kb techniques kernal_file_write_seq, kernal_file_read_seq,
// error_channel_check; the policy is oscar64/high-score-persist's).
//
// The record: 'S' 'W' version(2) room score turns(2) flags(2) loc[] opened[]
// check. check is a fold of every byte before it. version is gen.py's
// WORLD_VERSION, a hash of the rooms, items and flags, so a save from a build
// with another world is refused ("FROM ANOTHER VERSION"), as is one of the
// wrong size or fold, or naming a room or place this world lacks; nothing
// is changed then.
//
// Both run on a frame outside the meter, with the sound muted. The KERNAL's
// serial routines end in CLI; CIA1's interrupts are masked, so nothing runs
// when they do, and the caller sets SEI again after.
#ifndef SAVE_H
#define SAVE_H

extern char disk_code;          // the drive's two-digit reply; 99: no device answered

void game_save(void);           // appends the reply to the output tokens
void game_load(void);           // on success restores the state and appends a LOOK

#pragma compile("save.c")

#endif
