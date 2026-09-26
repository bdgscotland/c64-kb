// hiscore.h: the high-score table (high_score_table_insert, c64-kb recipe
// kickassembler/high-score-insert, ported to C). Five rows of three name
// screen codes and a six-digit BCD score, most significant byte first, the
// recipe's row layout. Seeded at boot (front_end_and_attract: "a seeded
// default table, so the first game has something to beat"); not saved.
//
// A game over calls hs_rank first, so the entry screen can show the place
// and skip the entry when the score does not qualify, then hs_place with the
// typed name: rank and place are two calls with the rank held between them
// (the technique's "Hand-off").
#ifndef HISCORE_H
#define HISCORE_H

#include "game.h"

#define HS_ROWS   5
#define HS_ROWLEN 6                     // name 0-2 (screen codes), score 3-5 (BCD)
#define HS_TABLEN (HS_ROWS * HS_ROWLEN)

extern char hs_table[HS_TABLEN];

void hs_seed(void);                                 // the default table
char hs_rank(const char *bcd);                      // row 0-4 the score takes, HS_ROWS: none
void hs_place(char rank, const char *bcd, const char *name);   // shift the rows below down, write

#pragma compile("hiscore.c")

#endif
