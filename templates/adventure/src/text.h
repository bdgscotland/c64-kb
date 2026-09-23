// text.h: the screen's text parts. The printer turns the engine's output
// tokens into word-wrapped lines of the scrolling window, one line a frame;
// the packed messages are decoded as they print. Also the status bar, the
// input line and plain text for the title (c64-kb techniques
// adventure_database_engine, text_input_line, decimal_print,
// petscii_screen_code_conversion).
#ifndef TEXT_H
#define TEXT_H

#define SCREEN ((char *)0x0400)
#define COLOUR ((char *)0xd800)

#define STATUS_ROW 7
#define WIN_TOP    8            // the window: rows 8 to 21
#define WIN_BOTTOM 21
#define RULE_ROW   22
#define INPUT_ROW  23
#define INPUT_MAX  36           // typed characters; the cursor takes the next cell

extern char input[INPUT_MAX];
extern char input_len;

void put_text(char row, char col, const char *s, char colour);   // ASCII upper case
void put_msg(char row, char col, char m, char colour);            // a packed message
void put_num(char row, char col, unsigned v, char digits, char colour);
void clear_rows(char from, char to);

void printer_reset(void);       // a new token list starts at oq[0]; the colour carries on
bool printer_ready(void);       // true when a line is waiting (reads ahead one word)
void printer_line(void);        // scroll the window, print the next line at the bottom

void status_init(void);        // the labels and every field
void status_draw(void);        // the fields that changed
void input_clear(void);
bool input_key(char k);         // PETSCII from the keyboard queue; true on RETURN
void input_cursor(char frame);

#pragma compile("text.c")

#endif
