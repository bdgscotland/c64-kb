// hiscore.h: the five-row table, the insert, and the file on drive 8
// (c64-kb techniques high_score_table_insert, kernal_file_read_seq,
// kernal_file_write_seq, error_channel_check; the policy is
// oscar64/high-score-persist's).
#ifndef HISCORE_H
#define HISCORE_H

#define HI_ROWS 5

typedef struct {
    char name[3];               // screen codes 1..26
    unsigned long score;        // stored low byte first
} HiEntry;

typedef struct {
    char magic[2];              // 'C', 'R'
    char version;               // bump when the layout changes
    HiEntry row[HI_ROWS];
} HiTable;                      // 38 bytes: Oscar64 packs structs with no padding

// What the start-up load found; hi_code keeps the drive's two-digit reply
// (99: no device answered).
#define HI_LOADED 0             // 00 and a record of the right size and version
#define HI_FIRST  1             // 62: no file yet; saving is on
#define HI_OLD    2             // a file of another layout: replaced at the next save
#define HI_OFF    3             // anything else (74: no disk): saving off this session

extern HiTable hi;
extern char hi_state, hi_code;
extern bool hi_saving;
extern bool hi_verified;                // the last save read back byte for byte

void hi_defaults(void);
char hi_rank(unsigned long score);      // row a score goes in (a tie goes below), HI_ROWS if none
void hi_insert(char rank, const char *name, unsigned long score);
void hi_load(void);                     // KERNAL calls: the caller mutes, and SEIs after
bool hi_save(void);                     // scratch, write, read the reply, read the file back; true when it matches

#pragma compile("hiscore.c")

#endif
