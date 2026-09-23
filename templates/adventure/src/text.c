// text.c: see text.h. tools/gen.py's Printer class is a Python copy of the
// printer here (the verdict compares a fold of every line); change both.
#include "text.h"
#include "engine.h"

#define WIDTH  40
#define CH_NL  0xf0             // next_char(): a paragraph ends
#define CH_END 0xff             // next_char(): no more tokens

enum { P_NONE, P_WORD, P_NL, P_END };

char input[INPUT_MAX];
char input_len;

// ---- plain text ----------------------------------------------------------------
static char to_screen(char c)                   // ASCII / PETSCII upper case to screen code
{
    return (c >= 0x41 && c <= 0x5a) ? c - 0x40 : c;
}

void put_text(char row, char col, const char *s, char colour)
{
    char *d = SCREEN + 40 * row + col;
    char *t = COLOUR + 40 * row + col;
    while (*s)
    {
        *d++ = to_screen(*s++);
        *t++ = colour;
    }
}

// A packed message straight to the screen: each byte below $40 is a screen
// code, each byte from $40 a pair of codes expanded on a small stack.
void put_msg(char row, char col, char m, char colour)
{
    char st[16], n = 0;
    const char *p = text_bytes + msg_at[m];
    char *d = SCREEN + 40 * row + col;
    char *t = COLOUR + 40 * row + col;
    while (*p)
    {
        st[n++] = *p++;
        while (n)
        {
            char b = st[--n];
            if (b < 0x40)
            {
                *d++ = b;
                *t++ = colour;
            }
            else
            {
                st[n++] = pair_right[b - 0x40];
                st[n++] = pair_left[b - 0x40];
            }
        }
    }
}

// decimal_print, subtract-powers (oscar64/print-number): no division.
static const unsigned pow10[4] = { 10000, 1000, 100, 10 };

static char digits5(unsigned v, char *d)       // five digits into d[]; returns the first not 0
{
    for (char i = 0; i < 4; i++)
    {
        char c = 0x30;
        while (v >= pow10[i])
        {
            v -= pow10[i];
            c++;
        }
        d[i] = c;
    }
    d[4] = 0x30 + v;
    char f = 0;
    while (f < 4 && d[f] == 0x30)
        f++;
    return f;
}

// Right-aligned in `digits` cells (at most 5), leading zeros as spaces.
void put_num(char row, char col, unsigned v, char digits, char colour)
{
    char d[5];
    char f = digits5(v, d);
    char *s = SCREEN + 40 * row + col;
    char *t = COLOUR + 40 * row + col;
    for (char i = 0; i < digits; i++)
    {
        char k = 5 - digits + i;
        s[i] = k < f ? 0x20 : d[k];
        t[i] = colour;
    }
}

void clear_rows(char from, char to)
{
    for (char r = from; r <= to; r++)
    {
        char *d = SCREEN + 40 * r;
        char *t = COLOUR + 40 * r;
        for (char i = 0; i < 40; i++)
        {
            d[i] = 0x20;
            t[i] = COL_TEXT;
        }
    }
}

// ---- the printer: tokens to characters ------------------------------------------------
static char stk[16], sp;                        // right halves of pair codes still to print
static const char *mp;                          // the message being read, 0 if none
static char digit[5], nd, dn;                   // a number: digit[dn..4], nd of them left
static bool back_nl;                            // a new line read one character early
static char tpos;                               // next token in oq[]
static char pr_style;                           // STYLE_TEXT, or STYLE_ECHO: reverse video
static char word[WIDTH], wlen, pend;

void printer_reset(void)
{
    tpos = sp = nd = 0;
    mp = nullptr;
    back_nl = false;
    pend = P_NONE;
}

// The next screen code, CH_NL or CH_END. A pair code prints its left half
// now and keeps its right half on the stack.
static char next_char(void)
{
    if (back_nl)
    {
        back_nl = false;
        return CH_NL;
    }
    for (;;)
    {
        char b;
        if (sp)
            b = stk[--sp];
        else if (mp)
        {
            b = *mp;
            if (!b)
            {
                mp = nullptr;
                continue;
            }
            mp++;
        }
        else if (nd)
        {
            nd--;
            return digit[dn++];
        }
        else if (tpos >= oq_len)
            return CH_END;
        else
        {
            char k = oq[tpos++];
            if (k == TOK_NL)
                return CH_NL;
            if (k == TOK_CHR)
                return oq[tpos++];
            if (k == TOK_STYLE)
                pr_style = oq[tpos++];
            else if (k == TOK_NUM)
            {
                dn = digits5(oq[tpos] | (oq[tpos + 1] << 8), digit);
                nd = 5 - dn;
                tpos += 2;
            }
            else
                mp = text_bytes + msg_at[k];
            continue;
        }
        while (b >= 0x40)
        {
            stk[sp++] = pair_right[b - 0x40];
            b = pair_left[b - 0x40];
        }
        return b;
    }
}

// The next word, new line or end, into pend (and word[]).
static void fetch(void)
{
    char c = next_char();
    while (c == 0x20)
        c = next_char();
    if (c == CH_NL || c == CH_END)
    {
        pend = c == CH_NL ? P_NL : P_END;
        return;
    }
    char n = 0;
    for (;;)
    {
        if (n < WIDTH)
            word[n++] = c;
        c = next_char();
        if (c == 0x20 || c == CH_END)
            break;
        if (c == CH_NL)
        {
            back_nl = true;
            break;
        }
    }
    wlen = n;
    pend = P_WORD;
}

bool printer_ready(void)
{
    if (pend == P_NONE)
        fetch();
    return pend != P_END;
}

// Rows 9-21 move up one row and row 21 is cleared: one pass over the columns
// with every row's move written out, so each move is an absolute,X load and
// store. Screen codes only: the window's colour RAM stays white, and the typed
// command is set apart by reverse video, which halves the moves.
#define SROW(r) ((char *)(0x0400 + 40 * (r)))
#define MV(r) SROW(r)[x] = SROW((r) + 1)[x];

static void window_scroll(void)
{
    for (char x = 0; x < WIDTH; x++)
    {
        MV(8) MV(9) MV(10) MV(11) MV(12) MV(13) MV(14)
        MV(15) MV(16) MV(17) MV(18) MV(19) MV(20)
        SROW(21)[x] = 0x20;
    }
}

// One line: words while they fit. A word that does not fit waits in word[]
// for the next line.
void printer_line(void)
{
    window_scroll();
    char *row = SROW(WIN_BOTTOM);
    char col = 0;
    for (;;)
    {
        if (pend == P_NONE)
            fetch();
        if (pend == P_END)
            break;
        if (pend == P_NL)
        {
            pend = P_NONE;
            break;
        }
        if (col + wlen + (col ? 1 : 0) > WIDTH)
        {
            if (col)
                break;
            wlen = WIDTH;                       // a word as wide as the window: cut it
        }
        if (col)
            col++;
        char *d = row + col;
        for (char k = 0; k < wlen; k++)
            d[k] = word[k];
        col += wlen;
        pend = P_NONE;
    }
    if (pr_style)
        for (char i = 0; i < col; i++)
            row[i] |= pr_style;
}

// ---- status bar and input line -----------------------------------------------------------
// Only the fields that changed: a room name costs a decode, a number five
// rounds of subtraction.
static char shown_name, shown_score;
static unsigned shown_turns;

void status_draw(void)
{
    char name = lit() ? room_name[room] : M_DARKNAME;
    if (name != shown_name)
    {
        char *d = SCREEN + 40 * STATUS_ROW;
        for (char i = 1; i < 20; i++)
            d[i] = 0x20;
        put_msg(STATUS_ROW, 1, name, 7);
        shown_name = name;
    }
    if (score != shown_score)
        put_num(STATUS_ROW, 26, shown_score = score, 3, 1);
    if (turns != shown_turns)
        put_num(STATUS_ROW, 37, shown_turns = turns, 3, 1);
}

void status_init(void)
{
    put_msg(STATUS_ROW, 20, M_SCORELBL, 3);
    put_msg(STATUS_ROW, 31, M_TURNSLBL, 3);
    shown_name = 0;
    shown_score = 0xff;
    shown_turns = 0xffff;
    status_draw();
}

void input_clear(void)
{
    clear_rows(INPUT_ROW, INPUT_ROW);
    SCREEN[40 * INPUT_ROW] = 0x3e;              // '>'
    COLOUR[40 * INPUT_ROW] = COL_ECHO;
    input_len = 0;
}

// text_input_line: letters (shifted ones folded to plain), digits and space
// are echoed; DEL takes one back; RETURN ends the line.
bool input_key(char k)
{
    char *cell = SCREEN + 40 * INPUT_ROW + 1;
    if (k == 0x0d)
        return true;
    if (k == 0x14)
    {
        if (input_len)
        {
            cell[input_len] = 0x20;             // the cursor's old cell
            input_len--;
        }
        return false;
    }
    if (k >= 0xc1 && k <= 0xda)
        k -= 0x80;
    bool ok = (k >= 0x41 && k <= 0x5a) || (k >= 0x30 && k <= 0x39) || k == 0x20;
    if (ok && input_len < INPUT_MAX)
    {
        input[input_len] = k;
        cell[input_len] = to_screen(k);
        input_len++;
    }
    return false;
}

void input_cursor(char frame)
{
    SCREEN[40 * INPUT_ROW + 1 + input_len] = (frame & 16) ? 0xa0 : 0x20;
}
