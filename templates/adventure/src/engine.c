// engine.c: see engine.h. The tables (rooms, items, words, actions) are
// generated from tools/world.py into gen_world.h.
#include "engine.h"
#include "text.h"

#ifndef FORCE_FAULT
#define FORCE_FAULT 0
#endif

#define WL 4                    // letters a word is matched on

char room, score, over, disk_req;
unsigned turns, flags;
char loc[NITEM], opened[NITEM];
char oq[256];
char oq_len;

// ---- output tokens --------------------------------------------------------------
static void out_byte(char b)
{
    if (oq_len < 250)                           // room for a whole token at the end
        oq[oq_len++] = b;
}

void out_reset(void)
{
    oq_len = 0;
    printer_reset();
}

void out_msg(char m) { out_byte(m); }
void out_nl(void) { out_byte(TOK_NL); }

void out_num(unsigned v)
{
    out_byte(TOK_NUM);
    out_byte(v & 0xff);
    out_byte(v >> 8);
}

void out_chr(char code)
{
    out_byte(TOK_CHR);
    out_byte(code);
}

static void say(char m)                         // a message and a new line
{
    out_msg(m);
    out_nl();
}

// ---- the world --------------------------------------------------------------------
// In reach, light aside: carried, here, or in an open container carried or here.
static bool reach_raw(char i)
{
    char l = loc[i];
    if (l == CARRIED || l == room)
        return true;
    if (l & 0x80)
    {
        char c = l & 0x7f;
        return opened[c] && (loc[c] == CARRIED || loc[c] == room);
    }
    return false;
}

bool lit(void)
{
    return !room_dark[room] || reach_raw(LIGHT_ITEM);
}

static bool scope(char i)
{
    return loc[i] == CARRIED || (lit() && reach_raw(i));
}

char picture_now(void)
{
    return lit() ? room_pic[room] : DARK_PIC;
}

static char carried_count(void)
{
    char n = 0;
    for (char i = 1; i < NITEM; i++)
        if (loc[i] == CARRIED)
            n++;
    return n;
}

static bool listed_at(char where)
{
    for (char i = 1; i < NITEM; i++)
        if (loc[i] == where && !(item_flags[i] & IF_SCENERY))
            return true;
    return false;
}

// "A NET, A LAMP": the items at `where`, scenery left out unless carried.
static char listing(char where)
{
    char k = 0;
    for (char i = 1; i < NITEM; i++)
        if (loc[i] == where && (where == CARRIED || !(item_flags[i] & IF_SCENERY)))
        {
            if (k++)
                out_msg(M_COMMA);
            out_msg(item_desc[i]);
        }
    return k;
}

static void contents(char c)
{
    if (listed_at(0x80 | c))
    {
        out_msg(item_inside[c]);
        out_msg(M_COLON);
        listing(0x80 | c);
        out_msg(M_DOT);
    }
    else
        out_msg(M_EMPTY);
    out_nl();
}

static const char dir_msg[6] = { M_DIRN, M_DIRS, M_DIRE, M_DIRW, M_DIRU, M_DIRD };

void look(void)
{
    if (!lit())
    {
        say(M_DARK);
        return;
    }
    say(room_desc[room]);
    if (listed_at(room))
    {
        out_msg(M_SEE);
        listing(room);
        say(M_DOT);
    }
    for (char c = 1; c < NITEM; c++)
        if ((item_flags[c] & IF_CONTAINER) && loc[c] == room && opened[c] && listed_at(0x80 | c))
            contents(c);
    const char *e = room_exits + 6 * room;
    char k = 0;
    for (char d = 0; d < 6; d++)
        if (e[d])
        {
            if (!k++)
                out_msg(M_EXITS);
            out_msg(dir_msg[d]);
        }
    say(k ? M_DOT : M_NOEXITS);
}

static void score_line(void)
{
    out_msg(M_SCORED);
    out_num(score);
    out_msg(M_OUTOF);
    out_num(MAXSCORE);
    out_msg(M_IN);
    out_num(turns);
    say(turns == 1 ? M_TURN : M_TURNS);
}

static void finish(char how)                    // M_WON or M_QUITS
{
    say(how);
    score_line();
    say(score == MAXSCORE ? M_RANK0 : M_RANK1);
    say(M_AGAIN);
    over = how == M_WON ? 1 : 2;
}

// ---- the action table -------------------------------------------------------------
enum { C_AT = 1, C_CARRIED, C_HERE, C_REACH, C_FLAG, C_NOTFLAG, C_DARK };
enum { K_MSG = 1, K_GOTO, K_LOOK, K_SETF, K_SWAP, K_CARRY, K_DESTROY, K_SCORE, K_WIN };

static bool cond(char op, char a)
{
    switch (op)
    {
    case C_AT:      return room == a;
    case C_CARRIED: return loc[a] == CARRIED;
    case C_HERE:    return loc[a] == room;
    case C_REACH:   return scope(a);
    case C_FLAG:    return (flags >> a) & 1;
    case C_NOTFLAG: return !((flags >> a) & 1);
    case C_DARK:    return !lit();
    }
    return true;
}

static void cmd(char op, char a)
{
    char t;
    switch (op)
    {
    case K_MSG:     say(a); break;
    case K_GOTO:    room = a; break;
    case K_LOOK:    look(); break;
    case K_SETF:    flags |= 1 << a; break;
    case K_SWAP:    t = loc[a]; loc[a] = loc[a + 1]; loc[a + 1] = t; break;
    case K_CARRY:   loc[a] = CARRIED; break;
    case K_DESTROY: loc[a] = 0; break;
    case K_SCORE:
#if FORCE_FAULT
        if (a == 40) a = 39;                    // the self-test: one point short at the end
#endif
        score += a;
        break;
    case K_WIN:     finish(M_WON); break;
    }
}

static bool run_row(const char *e)              // all conditions true: run the commands
{
    for (char i = 2; i < 10; i += 2)
        if (e[i] && !cond(e[i], e[i + 1]))
            return false;
    for (char i = 10; i < 18; i += 2)
        if (e[i])
            cmd(e[i], e[i + 1]);
    return true;
}

static bool scan(char v, char n)                // the first row that matches, only
{
    const char *e = act;
    for (char a = 0; a < NACT; a++, e += 18)
        if (e[0] == v && (e[1] == 0 || e[1] == n) && run_row(e))
            return true;
    return false;
}

// ---- built-in verbs ----------------------------------------------------------------
enum { F_ANY, F_CARRIED, F_LOOSE };             // which items find() accepts

static char find(char n, char which)            // the first item with noun n
{
    for (char i = 1; i < NITEM; i++)
    {
        if (item_noun[i] != n)
            continue;
        if (which == F_CARRIED ? loc[i] == CARRIED :
            which == F_LOOSE ? loc[i] != CARRIED && scope(i) : scope(i))
            return i;
    }
    return 0;
}

static void not_found(void)
{
    say(lit() ? M_NOTHERE : M_DARK);
}

static void do_go(char n)
{
    if (n < 1 || n > 6)
        say(M_WHICHWAY);
    else if (!room_exits[6 * room + n - 1])
        say(M_NOWAY);
    else
    {
        room = room_exits[6 * room + n - 1];
        look();
    }
}

static void do_get(char n)
{
    char i = find(n, F_LOOSE);
    if (!n)
        say(M_WHAT);
    else if (i)
    {
        if (!(item_flags[i] & IF_PORTABLE))
            say(M_FIXED);
        else if (carried_count() >= MAXLOAD)
            say(M_FULL);
        else
        {
            loc[i] = CARRIED;
            say(M_TAKEN);
        }
    }
    else if (find(n, F_CARRIED))
        say(M_HAVEIT);
    else
        not_found();
}

static void do_examine(char n)
{
    char i = find(n, F_ANY);
    if (!i)
    {
        not_found();
        return;
    }
    if (item_exam[i])
        say(item_exam[i]);
    if (item_flags[i] & IF_CONTAINER)
    {
        if (opened[i])
            contents(i);
        else
            say(M_CLOSED);
    }
    else if (!item_exam[i])
        say(M_NOTHINGSPECIAL);
}

static void do_open_close(char v, char n)
{
    char i = find(n, F_ANY);
    if (!i)
        not_found();
    else if (!(item_flags[i] & IF_CONTAINER))
        say(v == V_OPEN ? M_NOTOPEN : M_CANT);
    else if (v == V_OPEN)
    {
        if (opened[i])
            say(M_ISOPEN);
        else
        {
            opened[i] = 1;
            say(M_OPENED);
            contents(i);
        }
    }
    else if (opened[i])
    {
        opened[i] = 0;
        say(M_CLOSEDOK);
    }
    else
        say(M_ISSHUT);
}

static void builtin(char v, char n)
{
    if (!n && (v == V_GET || v == V_DROP || v == V_OPEN || v == V_CLOSE || v == V_UNLOCK ||
               v == V_LIGHT || v == V_WIND || v == V_PUT))
    {
        say(M_WHAT);                            // a verb that needs an object, alone
        return;
    }
    switch (v)
    {
    case V_GO:    do_go(n); break;
    case V_GET:   do_get(n); break;
    case V_DROP:
    {
        char i = find(n, F_CARRIED);
        if (i)
            loc[i] = room;
        say(i ? M_DROPPED : M_NOTHAVE);
        break;
    }
    case V_LOOK:
        if (n)
            do_examine(n);
        else
            look();
        break;
    case V_INV:
        out_msg(M_CARRYING);
        if (!listing(CARRIED))
            out_msg(M_NOTHING);
        say(M_DOT);
        break;
    case V_OPEN:
    case V_CLOSE: do_open_close(v, n); break;
    case V_SCORE: score_line(); break;
    case V_QUIT:  finish(M_QUITS); break;
    case V_HELP:  say(M_HELP); break;
    default:      say(M_CANT); break;
    }
}

// ---- the parser ------------------------------------------------------------------------
static const char *line_at;
static char word_at[3], word_len[3], words;     // the first three words that are not noise

static char to_screen(char c)                   // PETSCII letter to screen code
{
    return (c >= 0x41 && c <= 0x5a) ? c - 0x40 : c;
}

// The id of word w in a table of WL-letter stems, 0 if none. A word shorter
// than WL must match a stem of the same length (GO is not GOLD).
static char lookup(const char *tab, const char *ids, const char *first, char at, char len)
{
    const char *w = line_at + at;
    char k0 = w[0];
    if (k0 < 'A' || k0 > 'Z')
        return 0;
    char t = first[k0 - 'A'], end = first[k0 - 'A' + 1];
    tab += WL * t;
    char k1 = len > 1 ? w[1] : ' ';
    char k2 = len > 2 ? w[2] : ' ';
    char k3 = len > 3 ? w[3] : ' ';
    for (; t < end; t++, tab += WL)
        if (tab[0] == k0 && tab[1] == k1 && tab[2] == k2 && tab[3] == k3)
            return ids ? ids[t] : 1;
    return 0;
}

static void split(char len)
{
    words = 0;
    char i = 0;
    while (i < len)
    {
        while (i < len && line_at[i] == ' ')
            i++;
        if (i >= len)
            break;
        char s = i;
        while (i < len && line_at[i] != ' ')
            i++;
        if (lookup(noise_words, nullptr, noise_first, s, i - s))
            continue;
        if (words < 3)
        {
            word_at[words] = s;
            word_len[words] = i - s;
        }
        if (words < 255)
            words++;
    }
}

static void unknown(char w)
{
    out_msg(M_UNKNOWN);
    for (char k = 0; k < word_len[w] && k < 12; k++)
        out_chr(to_screen(line_at[word_at[w] + k]));
    say(M_DOT);
}

static char pv, pn;                             // the parsed verb and noun

static bool parse(char len)
{
    split(len);
    if (!words)
    {
        say(M_PARDON);
        return false;
    }
    pv = lookup(verb_words, verb_ids, verb_first, word_at[0], word_len[0]);
    char k = 1;
    pn = words > 1 ? lookup(noun_words, noun_ids, noun_first, word_at[1], word_len[1]) : 0;
    if (pv && pv != V_GO && pn >= 1 && pn <= 6 && words > 2)
    {
        k = 2;                                  // PICK UP LAMP: the UP is not a direction
        pn = lookup(noun_words, noun_ids, noun_first, word_at[2], word_len[2]);
    }
    if (!pv)
    {
        char d = lookup(noun_words, noun_ids, noun_first, word_at[0], word_len[0]);
        if (d >= 1 && d <= 6 && words == 1)
        {
            pv = V_GO;
            pn = d;
            return true;
        }
        if (d && words == 1)
            say(M_WITHIT);                      // LAMP alone
        else
            unknown(0);
        return false;
    }
    if (words > k && !pn)
    {
        unknown(k);
        return false;
    }
    return true;
}

// ---- one command -------------------------------------------------------------------------
void game_command(const char *line, char len)
{
    out_reset();
    out_byte(TOK_STYLE);
    out_byte(STYLE_ECHO);
    char n = oq_len;                            // the typed line: two bytes a character
    oq[n++] = TOK_CHR;
    oq[n++] = '>';
    for (char k = 0; k < len; k++)
    {
        oq[n++] = TOK_CHR;
        oq[n++] = to_screen(line[k]);
    }
    oq_len = n;
    out_nl();
    out_byte(TOK_STYLE);
    out_byte(STYLE_TEXT);
    line_at = line;
    if (!parse(len))
        return;                                 // no turn for a word it does not know
    if (pv == V_SAVE || pv == V_LOAD)
    {
        disk_req = pv == V_SAVE ? DISK_SAVE : DISK_LOAD;   // main.c runs it off the meter
        return;
    }
    if (turns < MAXTURNS)                       // the status bar has three digits
        turns++;
    if (!scan(pv, pn))
        builtin(pv, pn);
    if (!over)
    {
        const char *e = act;
        for (char a = 0; a < NACT; a++, e += 18)
            if (e[0] == 0)                      // occurrences: every turn
                run_row(e);
    }
}

void game_new(void)
{
    room = START_ROOM;
    for (char i = 0; i < NITEM; i++)
    {
        loc[i] = item_start[i];
        opened[i] = (item_flags[i] & IF_OPEN) ? 1 : 0;
    }
    score = over = disk_req = 0;
    turns = flags = 0;
    out_reset();
    out_byte(TOK_STYLE);
    out_byte(STYLE_TEXT);
    say(M_INTRO);
    out_nl();
    look();
}
