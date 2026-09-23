---
recipe: adventure-engine
toolchain: oscar64
output_format: PRG
region: both
techniques: [adventure_database_engine]
file_formats: [PRG]
uses_registers: [D011, D020, D021, DD04, DD05, DD06, DD07, DD0E, DD0F]
uses_kernal: [GETIN]
---

<!-- doc-type: recipe -->

# Oscar64 Adventure Engine: a two-word parser, an action table and packed text, played on autopilot

## Synopsis

A table-driven text adventure engine in the Scott Adams style and an
original seven-room game for it: a beach, a cliff path, a locked
lighthouse door, a dark hall, stair and cellar, and a beacon to light.
Nine items, among them a key hidden in a net, a lamp in three states and
a can of oil. The lamp lasts seven turns; an occurrence warns at three
and puts it out at zero. Words count on their first four letters and
synonyms share an id. The action table is scanned in order and the first
entry whose conditions hold runs; occurrences run every turn. Messages
are packed 5 bits a character, three to a 16-bit word. A script of 19
commands is typed one key per frame into the KERNAL keyboard queue and
read back through GETIN. It includes an unknown word, a locked door
tried before it is opened, and the synonyms `TAKE` and `LANTERN`, and it
wins. The program then compares the room, the items carried, the flags,
the turns, the score, a fold of every character printed and a fold of
the packed text with a Python model, prints PASS or FAIL, and prints the
cycles of parse, turn and print. It implements
`adventure_database_engine` (`techniques/text.md`). The game and its
text are original, not an Adams game's data.

## Source

```c
// adventure-engine.c
// A table-driven two-word adventure engine in the Scott Adams style, with
// an original seven-room game. Vocabulary words are compared on their first
// WL letters and synonyms share an id; the action table is scanned in order
// and the first entry whose verb, noun and conditions all hold runs its
// commands; entries with verb 0 are occurrences, run after every turn.
// Messages are packed 5 bits a character, three to a 16-bit word, and
// decoded into an output buffer that a word-wrapping terminal prints.
// A script is typed on autopilot through the KERNAL keyboard queue. At the
// end the final state and a fold of every printed character are compared
// with a Python model of the same engine and data; PASS or FAIL and the
// cycle costs are printed.
#include <c64/vic.h>
#include <c64/cia.h>
#include <conio.h>

#define SCREEN ((char *)0x0400)
#define COLOUR ((char *)0xd800)
#define TROWS 21                     // terminal rows 0..20; report rows 21..24
#define WL 4                         // significant letters per word
#define CARRIED 255
#define MAXLOAD 4
#define LAMPTIME 7
#define NITEM 10                     // items 1..9, 0 unused
#define LIGHT 3                      // the lit lamp

// Python model: final state and fold of the printed text.
#define EXP_ROOM 6
#define EXP_TURNS 18
#define EXP_SCORE 100
#define EXP_INV 0x0012
#define EXP_FLAGS 0x01
#define EXP_TEXT 0x7a7a
#define EXP_PACK 0x0774              // fold of the packed words, low byte first

// ---- messages: plain text here, packed at start-up by pack_all() ----------
static const char * const msgs[] = {
    "",
    "YOU ARE ON A PEBBLE BEACH. A PATH CLIMBS NORTH.",
    "YOU ARE ON A CLIFF PATH. A LIGHTHOUSE STANDS TO THE NORTH AND A HUT TO THE EAST.",
    "YOU ARE IN THE LIGHTHOUSE HALL. STAIRS GO UP AND DOWN.",
    "YOU ARE IN A FISHER'S HUT.",
    "YOU ARE ON A SPIRAL STAIR.",
    "YOU ARE IN THE LAMP ROOM. THE SEA BELOW IS BLACK.",
    "YOU ARE IN A DAMP CELLAR.",
    "A BRASS KEY", "AN UNLIT LAMP", "A LIT LAMP", "A DEAD LAMP",
    "A FISHING NET", "A CAN OF OIL", "A LOCKED DOOR", "AN OPEN DOOR",
    "THE GREAT BEACON",
    "IT IS TOO DARK TO SEE.",                            // 17
    "YOU CAN SEE ", "EXITS", "YOU ARE CARRYING ", "NOTHING",
    "I DON'T KNOW HOW TO ", "I DON'T KNOW WHAT A ", " IS.",
    "YOU CAN'T GO THAT WAY.", "OK.", "YOU CARRY TOO MUCH.",
    "YOU ALREADY HAVE IT.", "I DON'T SEE IT HERE.", "YOU DON'T HAVE IT.",
    "YOU CAN'T DO THAT.",                                // 31
    "THE DOOR IS LOCKED.",
    "THE KEY TURNS AND THE DOOR SWINGS OPEN.",
    "YOU HAVE NO KEY.",
    "TANGLED IN THE NET IS A BRASS KEY.",
    "YOU FIND NOTHING MORE.",
    "THE LAMP FLICKERS INTO LIFE.",
    "THE LAMP IS SPENT.",
    "YOU POUR IN THE OIL AND LIGHT THE BEACON. ITS BEAM SWEEPS THE SEA.",
    "THE BEACON HAS NO OIL.",
    "YOU FALL DOWN THE STAIRS IN THE DARK.",
    "YOUR LAMP IS GROWING DIM.",
    "YOUR LAMP GOES OUT.",                               // 43
    "YOU HAVE SCORED ", " OUT OF ", " TURNS.", "YOU HAVE WON!",
    "YOU ARE DEAD.", "WHICH WAY.", " IN "                // 50
};
#define NMSG (sizeof(msgs) / sizeof(msgs[0]))

// 5-bit alphabet: codes 0-30 as screen codes, 31 pads the last word.
static const char alpha[32] = {
    0x20, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 0x2e, 0x2c, 0x27, 0x21, 0 };

static unsigned text[400];           // packed words
static unsigned msg_at[NMSG];        // first word of each message
static unsigned nchars, nwords;

static char code_of(char c)          // ASCII upper case to a 5-bit code
{
    if (c >= 'A' && c <= 'Z') return c - 'A' + 1;
    if (c == '.') return 27;
    if (c == ',') return 28;
    if (c == '\'') return 29;
    if (c == '!') return 30;
    return 0;                        // space
}

static void pack_all(void)
{
    for (char m = 1; m < NMSG; m++) {
        const char *s = msgs[m];
        msg_at[m] = nwords;
        char k = 0, c[3];
        while (*s) {
            c[k++] = code_of(*s++); nchars++;
            if (k == 3 || !*s) {
                while (k < 3) c[k++] = 31;
                text[nwords++] = ((unsigned)c[0] << 10) | ((unsigned)c[1] << 5) | c[2];
                k = 0;
            }
        }
        text[nwords - 1] |= 0x8000;  // bit 15 ends the message
    }
}

// ---- the world ------------------------------------------------------------
static const char room_desc[8] = { 0, 1, 2, 3, 4, 5, 6, 7 };
static const char exits[8][6] = {    // N S E W U D
    {0,0,0,0,0,0}, {2,0,0,0,0,0}, {0,1,4,0,0,0}, {0,2,0,0,5,7},
    {0,0,0,2,0,0}, {0,0,0,0,6,3}, {0,0,0,0,0,5}, {0,0,0,0,3,0} };
static const char dark_room[8] = { 0, 0, 0, 1, 0, 1, 0, 1 };
static const char dir_sc[6] = { 14, 19, 5, 23, 21, 4 };   // N S E W U D

// Items: description message, noun id (0: cannot be carried), start room.
// The lamp's states are adjacent, so SWAP i trades items i and i + 1.
static const char item_desc[NITEM]  = { 0, 8, 9, 10, 11, 12, 13, 14, 15, 16 };
static const char item_noun[NITEM]  = { 0, 7, 8, 8, 8, 9, 10, 0, 0, 0 };
static const char item_start[NITEM] = { 0, 0, 4, 0, 0, 4, 7, 2, 0, 6 };

// Vocabulary: first WL letters, space padded, and the word's id.
#define NVERB 15
static const char verb_w[NVERB][WL] = {
    {'G','O',' ',' '}, {'W','A','L','K'}, {'G','E','T',' '}, {'T','A','K','E'},
    {'D','R','O','P'}, {'L','O','O','K'}, {'L',' ',' ',' '}, {'I','N','V','E'},
    {'I',' ',' ',' '}, {'U','N','L','O'}, {'O','P','E','N'}, {'L','I','G','H'},
    {'S','E','A','R'}, {'E','X','A','M'}, {'S','C','O','R'} };
static const char verb_id[NVERB] = { 1, 1, 2, 2, 3, 4, 4, 5, 5, 6, 6, 7, 8, 8, 9 };
#define NNOUN 20
static const char noun_w[NNOUN][WL] = {
    {'N','O','R','T'}, {'N',' ',' ',' '}, {'S','O','U','T'}, {'S',' ',' ',' '},
    {'E','A','S','T'}, {'E',' ',' ',' '}, {'W','E','S','T'}, {'W',' ',' ',' '},
    {'U','P',' ',' '}, {'U',' ',' ',' '}, {'D','O','W','N'}, {'D',' ',' ',' '},
    {'K','E','Y',' '}, {'L','A','M','P'}, {'L','A','N','T'}, {'N','E','T',' '},
    {'O','I','L',' '}, {'C','A','N',' '}, {'D','O','O','R'}, {'B','E','A','C'} };
static const char noun_id[NNOUN] = { 1,1,2,2,3,3,4,4,5,5,6,6,7,8,8,9,10,10,11,12 };

// Conditions (op, arg) and commands (op, arg); op 0 ends a list.
enum { C_AT = 1, C_CARRIED, C_HERE, C_ACCESS, C_EXISTS, C_FLAG, C_NOTFLAG, C_CTREQ, C_DARK };
enum { K_MSG = 1, K_GOTO, K_LOOK, K_INV, K_SCORE, K_SWAP, K_PLACE, K_DESTROY,
       K_SETF, K_SETC, K_DECC, K_ADDSC, K_DIE, K_WIN };

// verb, noun (0: any), four conditions, four commands. Verb 0: occurrence.
#define NACT 17
static const char act[NACT][18] = {
    {4, 0,  0,0, 0,0, 0,0, 0,0,  K_LOOK,0, 0,0, 0,0, 0,0},
    {5, 0,  0,0, 0,0, 0,0, 0,0,  K_INV,0, 0,0, 0,0, 0,0},
    {9, 0,  0,0, 0,0, 0,0, 0,0,  K_SCORE,0, 0,0, 0,0, 0,0},
    {1, 1,  C_AT,2, C_HERE,8, 0,0, 0,0,  K_GOTO,3, K_LOOK,0, 0,0, 0,0},
    {1, 1,  C_AT,2, 0,0, 0,0, 0,0,  K_MSG,32, 0,0, 0,0, 0,0},
    {1, 6,  C_AT,5, C_DARK,0, 0,0, 0,0,  K_MSG,41, K_DIE,0, 0,0, 0,0},
    {6, 11, C_AT,2, C_HERE,7, C_CARRIED,1, 0,0,  K_SWAP,7, K_ADDSC,20, K_MSG,33, 0,0},
    {6, 11, C_AT,2, C_HERE,7, 0,0, 0,0,  K_MSG,34, 0,0, 0,0, 0,0},
    {8, 9,  C_ACCESS,5, C_NOTFLAG,0, 0,0, 0,0,  K_SETF,0, K_PLACE,1, K_ADDSC,20, K_MSG,35},
    {8, 9,  C_ACCESS,5, 0,0, 0,0, 0,0,  K_MSG,36, 0,0, 0,0, 0,0},
    {7, 8,  C_ACCESS,2, 0,0, 0,0, 0,0,  K_SWAP,2, K_SETC,LAMPTIME, K_MSG,37, 0,0},
    {7, 8,  C_ACCESS,4, 0,0, 0,0, 0,0,  K_MSG,38, 0,0, 0,0, 0,0},
    {7, 12, C_AT,6, C_CARRIED,6, 0,0, 0,0,  K_DESTROY,6, K_ADDSC,60, K_MSG,39, K_WIN,0},
    {7, 12, C_AT,6, 0,0, 0,0, 0,0,  K_MSG,40, 0,0, 0,0, 0,0},
    {0, 0,  C_EXISTS,3, 0,0, 0,0, 0,0,  K_DECC,0, 0,0, 0,0, 0,0},
    {0, 0,  C_EXISTS,3, C_CTREQ,3, 0,0, 0,0,  K_MSG,42, 0,0, 0,0, 0,0},
    {0, 0,  C_EXISTS,3, C_CTREQ,0, 0,0, 0,0,  K_SWAP,3, K_MSG,43, 0,0, 0,0} };

// The autopilot: typed one key per frame into the KERNAL queue. 13 = RETURN.
static const char script[] =
    "XYZZY\rN\rGO NORTH\rE\rTAKE LANTERN\rEXAMINE NET\rGET KEY\rW\r"
    "UNLOCK DOOR\rN\rLIGHT LAMP\rLOOK\rD\rGET OIL\rI\rU\rU\rU\rLIGHT BEACON\r";

// ---- game state -------------------------------------------------------------
static char room, loc[NITEM], flags, ctr, score, turns, over;

// ---- output buffer: screen codes, 0xff = new line ---------------------------
static char ob[256];
static char on;

static void o_put(char c) { if (on < 255) ob[on++] = c; }
static void o_nl(void) { o_put(0xff); }

static void o_msg(char m)            // decode a packed message
{
    const unsigned *p = text + msg_at[m];
    unsigned w;
    do {
        w = *p++;
        char c = (w >> 10) & 31;
        if (c < 31) o_put(alpha[c]);
        c = (w >> 5) & 31;
        if (c < 31) o_put(alpha[c]);
        c = w & 31;
        if (c < 31) o_put(alpha[c]);
    } while (!(w & 0x8000));
}

static char sc_of(char k)            // PETSCII upper case to screen code
{
    return (k >= 0x41 && k <= 0x5a) ? k - 0x40 : k;
}

static void o_num(char n)
{
    if (n >= 100) { o_put(0x30 + n / 100); n %= 100; o_put(0x30 + n / 10); }
    else if (n >= 10) o_put(0x30 + n / 10);
    o_put(0x30 + n % 10);
}

// ---- terminal: rows 0..20, word wrap at 40, scroll on new line --------------
static char col;
static unsigned tchk;

static void fold(char v) { tchk = ((tchk ^ v) * 5 + 1); }

static void t_nl(void)
{
    char *p = SCREEN;
    for (char r = 0; r < TROWS - 1; r++, p += 40)
        for (char i = 0; i < 40; i++) p[i] = p[i + 40];
    for (char i = 0; i < 40; i++) p[i] = 0x20;
    col = 0;
    fold(0xff);
}

static void t_put(char c)
{
    if (col == 40) t_nl();
    SCREEN[40 * (TROWS - 1) + col++] = c;
    fold(c);
}

static void t_text(char i, char n)   // ob[i..n) as words
{
    while (i < n) {
        char j = i;
        while (j < n && ob[j] != 0x20) j++;
        if (col && col + (j - i) > 40) t_nl();
        for (char k = i; k < j; k++) t_put(ob[k]);
        if (j < n && col < 40) t_put(0x20);
        i = j + 1;
    }
}

static void flush(void)
{
    char s = 0;
    for (char i = 0; i < on; i++)
        if (ob[i] == 0xff) { t_text(s, i); t_nl(); s = i + 1; }
    if (s < on) t_text(s, on);
    on = 0;
}

// ---- the engine -------------------------------------------------------------
static bool lit(void)
{
    return !dark_room[room] || loc[LIGHT] == CARRIED || loc[LIGHT] == room;
}

static void list_items(char where)
{
    char k = 0;
    for (char i = 1; i < NITEM; i++)
        if (loc[i] == where) {
            if (k++) { o_put(0x2c); o_put(0x20); }
            o_msg(item_desc[i]);
        }
    if (where == CARRIED && !k) o_msg(21);
}

static void look(void)
{
    if (!lit()) { o_msg(17); o_nl(); return; }
    o_msg(room_desc[room]); o_nl();
    char k = 0;
    for (char i = 1; i < NITEM; i++) if (loc[i] == room) k = 1;
    if (k) { o_msg(18); list_items(room); o_put(0x2e); o_nl(); }
    o_msg(19);
    for (char d = 0; d < 6; d++)
        if (exits[room][d]) { o_put(0x20); o_put(dir_sc[d]); }
    o_put(0x2e); o_nl();
}

static void say_score(void)
{
    o_msg(44); o_num(score); o_msg(45); o_num(100); o_msg(50);
    o_num(turns); o_msg(46); o_nl();
}

static bool cond(char op, char a)
{
    switch (op) {
    case C_AT:      return room == a;
    case C_CARRIED: return loc[a] == CARRIED;
    case C_HERE:    return loc[a] == room;
    case C_ACCESS:  return loc[a] == CARRIED || loc[a] == room;
    case C_EXISTS:  return loc[a] != 0;
    case C_FLAG:    return (flags >> a) & 1;
    case C_NOTFLAG: return !((flags >> a) & 1);
    case C_CTREQ:   return ctr == a;
    case C_DARK:    return !lit();
    }
    return true;
}

static void cmd(char op, char a)
{
    char t;
    switch (op) {
    case K_MSG:     o_msg(a); o_nl(); break;
    case K_GOTO:    room = a; break;
    case K_LOOK:    look(); break;
    case K_INV:     o_msg(20); list_items(CARRIED); o_put(0x2e); o_nl(); break;
    case K_SCORE:   say_score(); break;
    case K_SWAP:    t = loc[a]; loc[a] = loc[a + 1]; loc[a + 1] = t; break;
    case K_PLACE:   loc[a] = room; break;
    case K_DESTROY: loc[a] = 0; break;
    case K_SETF:    flags |= 1 << a; break;
    case K_SETC:    ctr = a; break;
    case K_DECC:    if (ctr) ctr--; break;
    case K_ADDSC:   score += a; break;
    case K_DIE:     o_msg(48); o_nl(); over = 2; break;
    case K_WIN:     o_msg(47); o_nl(); say_score(); over = 1; break;
    }
}

static bool run_entry(const char *e)  // conditions all true: run the commands
{
    for (char i = 2; i < 10 && e[i]; i += 2)
        if (!cond(e[i], e[i + 1])) return false;
    for (char i = 10; i < 18 && e[i]; i += 2)
        cmd(e[i], e[i + 1]);
    return true;
}

static bool scan(char v, char n)      // first matching action only
{
    for (char a = 0; a < NACT; a++) {
        const char *e = act[a];
        if (e[0] == v && v && (e[1] == 0 || e[1] == n) && run_entry(e))
            return true;
    }
    return false;
}

static void builtin(char v, char n)
{
    if (v == 1) {                                   // GO
        if (n < 1 || n > 6) { o_msg(49); o_nl(); return; }
        char r = exits[room][n - 1];
        if (!r) { o_msg(25); o_nl(); return; }
        room = r; look(); return;
    }
    if ((v == 2 || v == 3) && n) {                  // GET, DROP
        char held = 0;
        for (char i = 1; i < NITEM; i++) if (loc[i] == CARRIED) held++;
        for (char i = 1; i < NITEM; i++) {
            if (item_noun[i] != n) continue;
            if (v == 2 && loc[i] == CARRIED) { o_msg(28); o_nl(); return; }
            if (v == 2 && loc[i] == room) {
                if (!lit()) o_msg(17);
                else if (held >= MAXLOAD) o_msg(27);
                else { loc[i] = CARRIED; o_msg(26); }
                o_nl(); return;
            }
            if (v == 3 && loc[i] == CARRIED) { loc[i] = room; o_msg(26); o_nl(); return; }
        }
        o_msg(v == 2 ? 29 : 30); o_nl(); return;
    }
    o_msg(31); o_nl();
}

static void turn(char v, char n)
{
    turns++;
    if (!scan(v, n)) builtin(v, n);
    if (!over)
        for (char a = 0; a < NACT; a++)
            if (act[a][0] == 0) run_entry(act[a]);
}

// ---- the parser -------------------------------------------------------------
static char line[40], len;
static char w_at[2], w_len[2], nw;

static char find(const char *tab, const char *ids, char count, char w)
{
    char key[WL];
    for (char k = 0; k < WL; k++)
        key[k] = k < w_len[w] ? line[w_at[w] + k] : ' ';
    for (char t = 0; t < count; t++, tab += WL) {
        char k = 0;
        while (k < WL && tab[k] == key[k]) k++;
        if (k == WL) return ids[t];
    }
    return 0;
}

static void o_word(char w)
{
    for (char k = 0; k < w_len[w] && k < 8; k++) o_put(sc_of(line[w_at[w] + k]));
}

static char pv, pn;                  // parsed verb and noun

static bool parse(void)
{
    nw = 0;
    char i = 0;
    while (nw < 2) {
        while (i < len && line[i] == ' ') i++;
        if (i >= len) break;
        w_at[nw] = i;
        while (i < len && line[i] != ' ') i++;
        w_len[nw] = i - w_at[nw];
        nw++;
    }
    if (!nw) return false;
    pv = find(verb_w[0], verb_id, NVERB, 0);
    pn = nw > 1 ? find(noun_w[0], noun_id, NNOUN, 1) : 0;
    if (!pv) {
        char d = find(noun_w[0], noun_id, NNOUN, 0);
        if (d >= 1 && d <= 6 && nw == 1) { pv = 1; pn = d; return true; }
        o_msg(22); o_word(0); o_put(0x2e); o_nl(); return false;
    }
    if (nw > 1 && !pn) { o_msg(23); o_word(1); o_msg(24); o_nl(); return false; }
    return true;
}

// ---- timing: CIA2 timer A counts phi2, timer B counts A's underflows --------
static void t_start(void)
{
    cia2.cra = 0; cia2.crb = 0;
    cia2.ta = 0xffff; cia2.tb = 0xffff;
    cia2.crb = 0x51;
    cia2.cra = 0x11;
}

static unsigned long t_stop(void)
{
    cia2.cra = 0; cia2.crb = 0;
    return ((unsigned long)(0xffff - cia2.tb) << 16) + (0xffff - cia2.ta);
}

// ---- report -----------------------------------------------------------------
static void put_text(char row, char c, const char *s)
{
    char *p = SCREEN + 40 * row + c;
    while (*s) *p++ = sc_of(*s++);
}

static void put_dec(char row, char c, unsigned long v, char digits)
{
    char *p = SCREEN + 40 * row + c + digits;
    while (digits--) { *--p = 0x30 + v % 10; v /= 10; }
}

static void put_hex(char row, char c, unsigned v, char digits)
{
    char *p = SCREEN + 40 * row + c + digits;
    while (digits--) { char h = v & 15; *--p = h < 10 ? 0x30 + h : h - 9; v >>= 4; }
}

int main(void)
{
    vic.color_border = VCOL_BLACK;
    vic.color_back = VCOL_BLACK;
    for (unsigned i = 0; i < 1000; i++) { SCREEN[i] = 0x20; COLOUR[i] = VCOL_LT_GREEN; }

    pack_all();
    unsigned pchk = 0;
    for (unsigned i = 0; i < nwords; i++) {
        pchk = ((pchk ^ (text[i] & 0xff)) * 5 + 1);
        pchk = ((pchk ^ (text[i] >> 8)) * 5 + 1);
    }

    // A command that matches no entry walks the whole table: time it alone.
    __asm { sei }
    t_start(); unsigned long c_null = t_stop();
    t_start(); scan(99, 0); unsigned long c_miss = t_stop() - c_null;
    __asm { cli }

    room = 1;
    for (char i = 0; i < NITEM; i++) loc[i] = item_start[i];
    look(); flush();
    t_put(0x3e);                                     // prompt

    unsigned long pmin = 0xffffff, pmax = 0, tmin = 0xffffff, tmax = 0, fmax = 0, cmax = 0;
    unsigned si = 0;
    while (!over) {
        vic_waitFrame();
        if (script[si] && *(volatile char *)0xc6 == 0) {     // queue empty: type one key
            __asm { sei }
            *(volatile char *)0x0277 = script[si++];
            *(volatile char *)0xc6 = 1;
            __asm { cli }
        }
        char k = getchx();                               // GETIN
        if (k == 0x0d || k == 0x0a) {                    // RETURN ($0A from getchx)
            t_nl();
            __asm { sei }
            t_start();
            bool ok = parse();
            unsigned long c = t_stop() - c_null;
            if (c < pmin) pmin = c;
            if (c > pmax) pmax = c;
            unsigned long both = c;
            if (ok) {
                t_start();
                turn(pv, pn);
                c = t_stop() - c_null;
                if (c < tmin) tmin = c;
                if (c > tmax) tmax = c;
                both += c;
            }
            if (both > cmax) cmax = both;       // parse + turn of one command
            t_start();
            flush();
            c = t_stop() - c_null;
            if (c > fmax) fmax = c;
            __asm { cli }
            len = 0;
            if (!over) t_put(0x3e);
        } else if (k == 0x14) {                          // DEL
            if (len) { len--; col--; SCREEN[40 * (TROWS - 1) + col] = 0x20; }
        } else if (k >= 0x20 && k <= 0x5a && len < 30 && col < 40) {
            line[len++] = k;
            t_put(sc_of(k));                             // echo as a screen code
        }
    }

    unsigned inv = 0;
    for (char i = 1; i < NITEM; i++) if (loc[i] == CARRIED) inv |= 1 << i;
    bool pass = room == EXP_ROOM && turns == EXP_TURNS && score == EXP_SCORE &&
                inv == EXP_INV && flags == EXP_FLAGS && tchk == EXP_TEXT &&
                pchk == EXP_PACK && over == 1;

    put_text(21, 0, "ROOM   TURNS    SCORE     INV      F");
    put_dec(21, 5, room, 1); put_dec(21, 13, turns, 2); put_dec(21, 22, score, 3);
    put_hex(21, 30, inv, 4); put_hex(21, 37, flags, 2);
    put_text(22, 0, "TEXT     /     PACK     /     ");
    put_hex(22, 5, tchk, 4); put_hex(22, 10, EXP_TEXT, 4);
    put_hex(22, 20, pchk, 4); put_hex(22, 25, EXP_PACK, 4);
    put_dec(22, 30, nwords * 2, 4); put_text(22, 34, "/"); put_dec(22, 35, nchars, 4);
    put_text(23, 0, "PARSE      -      TURN       -");
    put_dec(23, 6, pmin, 5); put_dec(23, 12, pmax, 5);
    put_dec(23, 23, tmin, 6); put_dec(23, 30, tmax, 6);
    put_text(24, 0, "PRINT        MISS       CMD");
    put_dec(24, 6, fmax, 6); put_dec(24, 18, c_miss, 5); put_dec(24, 28, cmax, 6);
    put_text(24, 36, pass ? "PASS" : "FAIL");
    vic.color_border = pass ? VCOL_GREEN : VCOL_RED;
    for (;;) ;
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=adventure-engine.prg adventure-engine.c
```

Run headless (PAL; add `-model ntsc` for NTSC):

```bash
timeout 180 x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 -limitcycles 10000000 -exitscreenshot adventure-engine.png -autostart adventure-engine.prg
```

The report is on screen between 7,000,000 and 7,500,000 cycles on PAL
and between 6,000,000 and 7,000,000 on NTSC (measured by bisecting
`-limitcycles`); 10,000,000 leaves a margin.

## Expected output

`screenshots/adventure-engine.png` (PAL) and
`screenshots/adventure-engine-ntsc.png` (NTSC). Black screen, light green
text, green border. Rows 0 to 20 are the terminal's last 21 lines:

```text
LAMP, A CAN OF OIL.
>U
YOU ARE IN THE LIGHTHOUSE HALL. STAIRS
GO UP AND DOWN.
EXITS S U D.
>U
YOU ARE ON A SPIRAL STAIR.
EXITS U D.
YOUR LAMP GOES OUT.
>U
YOU ARE IN THE LAMP ROOM. THE SEA BELOW
IS BLACK.
YOU CAN SEE THE GREAT BEACON.
EXITS D.
>LIGHT BEACON
YOU POUR IN THE OIL AND LIGHT THE
BEACON. ITS BEAM SWEEPS THE SEA.
YOU HAVE WON!
YOU HAVE SCORED 100 OUT OF 100 IN 18
TURNS.
```

Rows 21 to 24, PAL:

```text
ROOM 6 TURNS 18 SCORE 100 INV 0012 F 01
TEXT 7A7A/7A7A PACK 0774/0774 0752/1061
PARSE 00722-03944 TURN 002888-012734
PRINT 109866 MISS 01695 CMD 014908  PASS
```

NTSC reads `PARSE 00636-03944 TURN 003017-013161` and
`PRINT 110762 MISS 01609 CMD 015206`; the rest is the same.

- `ROOM 6`: the lamp room. `TURNS 18`: 19 commands, less the unknown
  word, which costs no turn. `SCORE 100`: 20 for finding the key, 20
  for the door, 60 for the beacon. `INV 0012`: bits 1 and 4, the key
  and the dead lamp; the oil was poured into the beacon. `F 01`: flag 0,
  the net has been searched.
- `TEXT` is the fold of every screen code the terminal printed, prompts,
  echoes and new lines included, then the model's value. `PACK` is the
  fold of the packed words the program built at start-up, then the
  model's. `0752/1061` is the packed size in bytes and the characters it
  holds: a ratio of 0.709.
- `PARSE` and `TURN` are the fewest and most cycles one parse and one
  turn took, CIA2 timer A cascaded into timer B, interrupts off,
  display on. A turn includes the occurrences and decoding its messages
  into the output buffer. `CMD` is the most that parse and turn took
  together for one command.
- `PRINT` is the most cycles the terminal took to print one command's
  output. `MISS` is one scan of the 17-entry table with a verb that
  matches nothing.

The whole transcript, from the model, starts:

```text
YOU ARE ON A PEBBLE BEACH. A PATH CLIMBS
NORTH.
EXITS N.
>XYZZY
I DON'T KNOW HOW TO XYZZY.
>N
YOU ARE ON A CLIFF PATH. A LIGHTHOUSE
STANDS TO THE NORTH AND A HUT TO THE
EAST.
YOU CAN SEE A LOCKED DOOR.
EXITS S E.
>GO NORTH
THE DOOR IS LOCKED.
>E
YOU ARE IN A FISHER'S HUT.
YOU CAN SEE AN UNLIT LAMP, A FISHING
NET.
EXITS W.
>TAKE LANTERN
OK.
>EXAMINE NET
TANGLED IN THE NET IS A BRASS KEY.
```

and goes on through `UNLOCK DOOR`, a hall too dark to see, `LIGHT
LAMP`, the cellar, `GET OIL` with "YOUR LAMP IS GROWING DIM." and an
inventory, to the screen above.

The model, the engine and the game written again in Python:

```python
# Python model of adventure-engine.c: the same data, rules, packing and
# 21-row terminal. g.term holds the last screen of the terminal.

WL = 4                      # significant letters per word
CARRIED, MAXLOAD, LAMPTIME = 255, 4, 7

MSGS = [
    "",                                                              # 0 unused
    "YOU ARE ON A PEBBLE BEACH. A PATH CLIMBS NORTH.",              # 1
    "YOU ARE ON A CLIFF PATH. A LIGHTHOUSE STANDS TO THE NORTH AND A HUT TO THE EAST.",  # 2
    "YOU ARE IN THE LIGHTHOUSE HALL. STAIRS GO UP AND DOWN.",       # 3
    "YOU ARE IN A FISHER'S HUT.",                                    # 4
    "YOU ARE ON A SPIRAL STAIR.",                                    # 5
    "YOU ARE IN THE LAMP ROOM. THE SEA BELOW IS BLACK.",            # 6
    "YOU ARE IN A DAMP CELLAR.",                                     # 7
    "A BRASS KEY",                                                   # 8
    "AN UNLIT LAMP",                                                 # 9
    "A LIT LAMP",                                                    # 10
    "A DEAD LAMP",                                                   # 11
    "A FISHING NET",                                                 # 12
    "A CAN OF OIL",                                                  # 13
    "A LOCKED DOOR",                                                 # 14
    "AN OPEN DOOR",                                                  # 15
    "THE GREAT BEACON",                                              # 16
    "IT IS TOO DARK TO SEE.",                                        # 17
    "YOU CAN SEE ",                                                  # 18
    "EXITS",                                                         # 19
    "YOU ARE CARRYING ",                                             # 20
    "NOTHING",                                                       # 21
    "I DON'T KNOW HOW TO ",                                          # 22
    "I DON'T KNOW WHAT A ",                                          # 23
    " IS.",                                                          # 24
    "YOU CAN'T GO THAT WAY.",                                        # 25
    "OK.",                                                           # 26
    "YOU CARRY TOO MUCH.",                                           # 27
    "YOU ALREADY HAVE IT.",                                          # 28
    "I DON'T SEE IT HERE.",                                          # 29
    "YOU DON'T HAVE IT.",                                            # 30
    "YOU CAN'T DO THAT.",                                            # 31
    "THE DOOR IS LOCKED.",                                           # 32
    "THE KEY TURNS AND THE DOOR SWINGS OPEN.",                       # 33
    "YOU HAVE NO KEY.",                                              # 34
    "TANGLED IN THE NET IS A BRASS KEY.",                            # 35
    "YOU FIND NOTHING MORE.",                                        # 36
    "THE LAMP FLICKERS INTO LIFE.",                                  # 37
    "THE LAMP IS SPENT.",                                            # 38
    "YOU POUR IN THE OIL AND LIGHT THE BEACON. ITS BEAM SWEEPS THE SEA.",  # 39
    "THE BEACON HAS NO OIL.",                                        # 40
    "YOU FALL DOWN THE STAIRS IN THE DARK.",                         # 41
    "YOUR LAMP IS GROWING DIM.",                                     # 42
    "YOUR LAMP GOES OUT.",                                           # 43
    "YOU HAVE SCORED ",                                              # 44
    " OUT OF ",                                                      # 45
    " TURNS.",                                                       # 46
    "YOU HAVE WON!",                                                 # 47
    "YOU ARE DEAD.",                                                 # 48
    "WHICH WAY.",                                                    # 49
    " IN ",                                                          # 50
]

# Rooms 1-7. Exits N S E W U D; 0 = none. The path's north exit is an action.
ROOM_DESC = [0, 1, 2, 3, 4, 5, 6, 7]
EXITS = [[0] * 6,
         [2, 0, 0, 0, 0, 0], [0, 1, 4, 0, 0, 0], [0, 2, 0, 0, 5, 7],
         [0, 0, 0, 2, 0, 0], [0, 0, 0, 0, 6, 3], [0, 0, 0, 0, 0, 5],
         [0, 0, 0, 0, 3, 0]]
DARK = {3, 5, 7}

# Items 1-9: description, noun (0 = cannot be carried), start room.
# Lamp states are adjacent (2 unlit, 3 lit, 4 dead) so SWAP i trades i, i+1.
ITEMS = [(0, 0, 0),
         (8, 7, 0), (9, 8, 4), (10, 8, 0), (11, 8, 0), (12, 9, 4),
         (13, 10, 7), (14, 0, 2), (15, 0, 0), (16, 0, 6)]
LIGHT = 3                                     # the lit lamp

# Vocabulary: word, id. Synonyms share an id.
VERBS = [("GO", 1), ("WALK", 1), ("GET", 2), ("TAKE", 2), ("DROP", 3),
         ("LOOK", 4), ("L", 4), ("INVENTORY", 5), ("I", 5), ("UNLOCK", 6),
         ("OPEN", 6), ("LIGHT", 7), ("SEARCH", 8), ("EXAMINE", 8), ("SCORE", 9)]
NOUNS = [("NORTH", 1), ("N", 1), ("SOUTH", 2), ("S", 2), ("EAST", 3), ("E", 3),
         ("WEST", 4), ("W", 4), ("UP", 5), ("U", 5), ("DOWN", 6), ("D", 6),
         ("KEY", 7), ("LAMP", 8), ("LANTERN", 8), ("NET", 9), ("OIL", 10),
         ("CAN", 10), ("DOOR", 11), ("BEACON", 12)]

# Condition and command opcodes; each is one byte of op and one of argument.
C_AT, C_CARRIED, C_HERE, C_ACCESS, C_EXISTS, C_FLAG, C_NOTFLAG, C_CTREQ, C_DARK = range(1, 10)
K_MSG, K_GOTO, K_LOOK, K_INV, K_SCORE, K_SWAP, K_PLACE, K_DESTROY, K_SETF, \
    K_SETC, K_DECC, K_ADDSC, K_DIE, K_WIN = range(1, 15)

# (verb, noun, [conditions], [commands]); verb 0 = occurrence, run every turn.
ACTIONS = [
    (4, 0, [], [(K_LOOK, 0)]),
    (5, 0, [], [(K_INV, 0)]),
    (9, 0, [], [(K_SCORE, 0)]),
    (1, 1, [(C_AT, 2), (C_HERE, 8)], [(K_GOTO, 3), (K_LOOK, 0)]),
    (1, 1, [(C_AT, 2)], [(K_MSG, 32)]),
    (1, 6, [(C_AT, 5), (C_DARK, 0)], [(K_MSG, 41), (K_DIE, 0)]),
    (6, 11, [(C_AT, 2), (C_HERE, 7), (C_CARRIED, 1)], [(K_SWAP, 7), (K_ADDSC, 20), (K_MSG, 33)]),
    (6, 11, [(C_AT, 2), (C_HERE, 7)], [(K_MSG, 34)]),
    (8, 9, [(C_ACCESS, 5), (C_NOTFLAG, 0)], [(K_SETF, 0), (K_PLACE, 1), (K_ADDSC, 20), (K_MSG, 35)]),
    (8, 9, [(C_ACCESS, 5)], [(K_MSG, 36)]),
    (7, 8, [(C_ACCESS, 2)], [(K_SWAP, 2), (K_SETC, LAMPTIME), (K_MSG, 37)]),
    (7, 8, [(C_ACCESS, 4)], [(K_MSG, 38)]),
    (7, 12, [(C_AT, 6), (C_CARRIED, 6)], [(K_DESTROY, 6), (K_ADDSC, 60), (K_MSG, 39), (K_WIN, 0)]),
    (7, 12, [(C_AT, 6)], [(K_MSG, 40)]),
    (0, 0, [(C_EXISTS, 3)], [(K_DECC, 0)]),
    (0, 0, [(C_EXISTS, 3), (C_CTREQ, 3)], [(K_MSG, 42)]),
    (0, 0, [(C_EXISTS, 3), (C_CTREQ, 0)], [(K_SWAP, 3), (K_MSG, 43)]),
]

SCRIPT = ["XYZZY", "N", "GO NORTH", "E", "TAKE LANTERN", "EXAMINE NET",
          "GET KEY", "W", "UNLOCK DOOR", "N", "LIGHT LAMP", "LOOK", "D",
          "GET OIL", "I", "U", "U", "U", "LIGHT BEACON"]

# ---- text packing: 5-bit codes, three to a 16-bit word, bit 15 ends a message
ALPHA = " ABCDEFGHIJKLMNOPQRSTUVWXYZ.,'!"          # codes 0-30; 31 pads
def pack(s):
    codes = [ALPHA.index(ch) for ch in s]
    while len(codes) % 3: codes.append(31)
    words = [(codes[i] << 10) | (codes[i + 1] << 5) | codes[i + 2]
             for i in range(0, len(codes), 3)]
    words[-1] |= 0x8000
    return words

def screen_code(ch):                            # ASCII/PETSCII upper case -> screen code
    o = ord(ch)
    return o - 0x40 if 0x41 <= o <= 0x5a else o

# ---- the engine
class Game:
    def __init__(s):
        s.room, s.loc = 1, [it[2] for it in ITEMS]
        s.flags, s.ctr, s.score, s.turns, s.over = 0, 0, 0, 0, 0
        s.out = []                             # screen codes, 0xFF = newline
        s.term = [[0x20] * 40 for _ in range(21)]
        s.col, s.chk = 0, 0

    # output buffer
    def o_msg(s, m): s.out += [screen_code(c) for c in MSGS[m]]
    def o_nl(s): s.out.append(0xFF)
    def o_word(s, w): s.out += [screen_code(c) for c in w[:8]]
    def o_num(s, n):
        s.out += [0x30 + int(d) for d in str(n)]

    def light(s):
        return s.room not in DARK or s.loc[LIGHT] in (CARRIED, s.room)

    def look(s):
        if not s.light(): s.o_msg(17); s.o_nl(); return
        s.o_msg(ROOM_DESC[s.room]); s.o_nl()
        seen = [i for i in range(1, len(ITEMS)) if s.loc[i] == s.room]
        if seen:
            s.o_msg(18)
            for k, i in enumerate(seen):
                if k: s.out += [0x2C, 0x20]
                s.o_msg(ITEMS[i][0])
            s.out.append(0x2E); s.o_nl()
        s.o_msg(19)
        for d in range(6):
            if EXITS[s.room][d]: s.out += [0x20, screen_code("NSEWUD"[d])]
        s.out.append(0x2E); s.o_nl()

    def inv(s):
        s.o_msg(20)
        held = [i for i in range(1, len(ITEMS)) if s.loc[i] == CARRIED]
        if not held: s.o_msg(21)
        for k, i in enumerate(held):
            if k: s.out += [0x2C, 0x20]
            s.o_msg(ITEMS[i][0])
        s.out.append(0x2E); s.o_nl()

    def cond(s, op, a):
        if op == C_AT: return s.room == a
        if op == C_CARRIED: return s.loc[a] == CARRIED
        if op == C_HERE: return s.loc[a] == s.room
        if op == C_ACCESS: return s.loc[a] in (CARRIED, s.room)
        if op == C_EXISTS: return s.loc[a] != 0
        if op == C_FLAG: return bool(s.flags >> a & 1)
        if op == C_NOTFLAG: return not (s.flags >> a & 1)
        if op == C_CTREQ: return s.ctr == a
        if op == C_DARK: return not s.light()

    def cmd(s, op, a):
        if op == K_MSG: s.o_msg(a); s.o_nl()
        elif op == K_GOTO: s.room = a
        elif op == K_LOOK: s.look()
        elif op == K_INV: s.inv()
        elif op == K_SCORE: s.say_score()
        elif op == K_SWAP: s.loc[a], s.loc[a + 1] = s.loc[a + 1], s.loc[a]
        elif op == K_PLACE: s.loc[a] = s.room
        elif op == K_DESTROY: s.loc[a] = 0
        elif op == K_SETF: s.flags |= 1 << a
        elif op == K_SETC: s.ctr = a
        elif op == K_DECC:
            if s.ctr: s.ctr -= 1
        elif op == K_ADDSC: s.score += a
        elif op == K_DIE: s.o_msg(48); s.o_nl(); s.over = 2
        elif op == K_WIN: s.o_msg(47); s.o_nl(); s.say_score(); s.over = 1

    def say_score(s):
        s.o_msg(44); s.o_num(s.score); s.o_msg(45); s.o_num(100); s.o_msg(50); s.o_num(s.turns); s.o_msg(46); s.o_nl()

    def run_entry(s, a):
        for op, arg in a[2]:
            if not s.cond(op, arg): return False
        for op, arg in a[3]:
            s.cmd(op, arg)
        return True

    # parse: two words, truncated to WL letters, synonyms share an id
    def parse(s, line):
        words = line.split()
        def find(table, w):
            for t, i in table:
                if t[:WL] == w[:WL]: return i
            return 0
        if not words: return None
        v = find(VERBS, words[0])
        n = find(NOUNS, words[1]) if len(words) > 1 else 0
        if not v:
            d = find(NOUNS, words[0])
            if 1 <= d <= 6 and len(words) == 1: return (1, d)
            s.o_msg(22); s.o_word(words[0]); s.out.append(0x2E); s.o_nl(); return None
        if len(words) > 1 and not n:
            s.o_msg(23); s.o_word(words[1]); s.o_msg(24); s.o_nl(); return None
        return (v, n)

    def turn(s, v, n):
        s.turns += 1
        for a in ACTIONS:
            if a[0] == v and (a[1] == 0 or a[1] == n) and a[0] and s.run_entry(a):
                break
        else:
            s.builtin(v, n)
        if not s.over:
            for a in ACTIONS:
                if a[0] == 0: s.run_entry(a)

    def builtin(s, v, n):
        if v == 1:
            if not 1 <= n <= 6: s.o_msg(49); s.o_nl(); return
            r = EXITS[s.room][n - 1]
            if not r: s.o_msg(25); s.o_nl(); return
            s.room = r; s.look(); return
        if v in (2, 3) and n:
            held = sum(1 for l in s.loc if l == CARRIED)
            for i in range(1, len(ITEMS)):
                if ITEMS[i][1] != n: continue
                if v == 2 and s.loc[i] == CARRIED: s.o_msg(28); s.o_nl(); return
                if v == 2 and s.loc[i] == s.room:
                    if not s.light(): s.o_msg(17)
                    elif held >= MAXLOAD: s.o_msg(27)
                    else: s.loc[i] = CARRIED; s.o_msg(26)
                    s.o_nl(); return
                if v == 3 and s.loc[i] == CARRIED:
                    s.loc[i] = s.room; s.o_msg(26); s.o_nl(); return
            s.o_msg(29 if v == 2 else 30); s.o_nl(); return
        s.o_msg(31); s.o_nl()

    # terminal: 21 rows, word wrap at 40, scroll up on newline
    def t_nl(s):
        s.term = s.term[1:] + [[0x20] * 40]; s.col = 0
        s.fold(0xFF)
    def t_put(s, c):
        if s.col == 40: s.t_nl()
        s.term[20][s.col] = c; s.col += 1; s.fold(c)
    def fold(s, v): s.chk = ((s.chk ^ v) * 5 + 1) & 0xFFFF
    def flush(s):
        seg = []
        for c in s.out:
            if c == 0xFF: s.t_text(seg); s.t_nl(); seg = []
            else: seg.append(c)
        if seg: s.t_text(seg)
        s.out = []
    def t_text(s, seg):
        i, n = 0, len(seg)
        while i < n:
            j = i
            while j < n and seg[j] != 0x20: j += 1
            if s.col and s.col + (j - i) > 40: s.t_nl()
            for k in range(i, j): s.t_put(seg[k])
            if j < n and s.col < 40: s.t_put(0x20)
            i = j + 1

    def play(s):
        s.look(); s.flush()
        for line in SCRIPT:
            if s.over: break
            s.t_put(0x3E)                       # prompt '>'
            for ch in line: s.t_put(screen_code(ch))
            s.t_nl()
            p = s.parse(line)
            if p: s.turn(*p)
            s.flush()

if __name__ == "__main__":
    for tab in (VERBS, NOUNS):                  # truncation must not merge two ids
        seen = {}
        for w, i in tab:
            assert seen.setdefault(w[:WL], i) == i, w
    g = Game(); g.play()
    inv = sum(1 << i for i in range(1, len(ITEMS)) if g.loc[i] == CARRIED)
    pk = 0
    for w in [w for m in MSGS[1:] for w in pack(m)]:
        pk = ((pk ^ (w & 0xFF)) * 5 + 1) & 0xFFFF
        pk = ((pk ^ (w >> 8)) * 5 + 1) & 0xFFFF
    chars = sum(len(m) for m in MSGS[1:])
    nbytes = 2 * sum(len(pack(m)) for m in MSGS[1:])
    print(g.room, g.turns, g.score, g.over, "%04X %02X %04X %04X" % (inv, g.flags, g.chk, pk),
          nbytes, chars)                        # 6 18 100 1 0012 01 7A7A 0774 752 1061
```

## Why this works

The game is the tables; the code is the same for any game. `scan()`
walks the action table from the top and stops at the first entry whose
verb and noun match and whose conditions all hold, so the order of
entries carries the logic. The two `UNLOCK DOOR` entries are the
pattern: the first needs the key and opens the door, the second catches
the same command without the key and says so. The locked door is not in
the exit table at all. `GO NORTH` at the path matches an action that
needs the open door and moves the player; the entry after it prints
"THE DOOR IS LOCKED". The script tries it once before the key is found.

`SWAP i` trades the locations of items `i` and `i + 1`. The lamp's three
states are items 2, 3 and 4, so lighting it is one swap and its going
out is another, and whichever state is carried stays carried. The three
occurrences are the lamp's clock: each turn the lit lamp exists they
decrease the counter, print a warning at 3 and swap in the dead lamp at
0. In the script the warning comes in the cellar and the lamp goes out
on the stair, one move short of the lamp room, which is not dark.

The parser works on PETSCII, the encoding GETIN delivers, because the
vocabulary is stored as upper-case ASCII, which is the same bytes for
`$20` to `$5A`. Only the echo is converted to screen codes, by
`sc_of()`. Messages never exist as PETSCII at run time: the 5-bit
alphabet decodes straight to screen codes. Oscar64's `getchx()` turns
RETURN into `$0A`, so the loop accepts `$0D` and `$0A`
(`pitfalls/kernal-and-io.md`, `getchx_petscii_remaps_return`).

The autopilot writes one byte to the queue at `$0277` and sets the count
at `$C6` to 1, with interrupts off, only when the count is zero. GETIN
then takes the key exactly as if it had been typed, so the line editor,
the echo and the parser see nothing different.

The timings use CIA2 because CIA1 timer A drives the KERNAL interrupt
that fills the keyboard queue. Interrupts are off while a parse, a turn
or a print is timed, so the figures are the engine's alone; the queue
is filled between commands. Printing is the slow part, over five frames
for the longest output. Almost all of it is the scroll: the debugging
build below showed about 17,400 cycles for a command that prints one
line, which is one 800-byte scroll in C.

**Which command is the worst.** A build that kept every command's
figures (not pinned; its code layout differs, so its parse and turn are within
about 90 cycles of the pinned ones; print and the miss scan differ by up
to about 4,000) showed the parse maximum on `XYZZY`
(both tables scanned, then an error message decoded), the turn maximum
and the `CMD` maximum on `LIGHT BEACON` (the win: two long messages and
the score line), and turns of 7,800 to 12,000 cycles on a move into a room whose items
are listed, depending on how much text is decoded (debug build).

## Verification

VICE x64sc 3.10, windowless build, Oscar64 as installed on 2026-09-23.

**The terminal against the model.** A script read the 840 cells of rows
0 to 20 in both pictures, matched each 8x8 cell against
`chargen-901225-01.bin`, and compared the screen codes with the model's
`g.term`. 0 mismatches and 0 undecoded cells on PAL and on NTSC.

**Text and border.** Rows 21 to 24 were decoded the same way and read
as quoted above. The pictures hold three colours: black, the border
(98, 213, 50) on PAL and (114, 189, 103) on NTSC, colour 5, and the
text (183, 255, 134) and (198, 255, 186), colour 13
(`runtime/vice-reference.md`, "The default palette").

**Reproducibility.** The pinned command was run twice per model; the
PNG bytes were identical each time.

**Lint.** `npx tsx src/cli.ts lint adventure-engine.c`: no findings.

## Sources

- https://www.miketaylor.org.uk/tech/advent/sac/Manual.html (the
  Scott Adams Adventure Compiler (sac) manual): the database model this engine follows, including
  the condition and result names, occurrences, first-match evaluation
  and darkness. The game here is original.
- `text-input.md`: the GETIN key path and the RETURN test, reused in
  shape. `cave-scan.md` and `print-number.md`: the cascaded timer
  harness, here on CIA2, and the fold.
