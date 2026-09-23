// engine.h: the game state, the two-word parser, the action table and the
// built-in verbs (c64-kb techniques adventure_database_engine and
// two_word_parser). Nothing here touches the screen: a command appends
// output tokens to oq[], which the printer in text.c turns into lines.
// tools/gen.py holds a Python copy of this file; change both.
#ifndef ENGINE_H
#define ENGINE_H

#include "gen_world.h"

#define CARRIED 0xff            // loc[i]: 0 nowhere, 1.. a room, 0x80|c inside item c

// Output tokens. Bytes 1 to 0xEF are message numbers.
#define TOK_NL  0xf0            // end of a paragraph
#define TOK_NUM 0xf1            // then a 16-bit number, low byte first
#define TOK_CHR 0xf2            // then one screen code
#define TOK_STYLE 0xf3          // then the style of the lines that follow

#define STYLE_TEXT 0x00
#define STYLE_ECHO 0x80         // the typed command, in reverse video
#define COL_TEXT 1              // white: text colours stay 0-7 so MCM keeps them hires
#define COL_ECHO 7              // yellow: the input line's prompt

#define DISK_SAVE 1
#define DISK_LOAD 2

extern char room, score, over, disk_req;
extern unsigned turns, flags;
extern char loc[NITEM], opened[NITEM];

extern char oq[256];            // this command's output tokens
extern char oq_len;

void game_new(void);                            // the start state and its opening text
void game_command(const char *line, char len);  // echo, parse, run one turn
bool lit(void);
char picture_now(void);                         // the room's picture, or the dark one
void look(void);

void out_reset(void);
void out_msg(char m);
void out_nl(void);
void out_num(unsigned v);
void out_chr(char code);

#pragma compile("engine.c")

#endif
