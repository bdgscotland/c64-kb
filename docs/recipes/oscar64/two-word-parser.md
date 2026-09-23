---
recipe: two-word-parser
toolchain: oscar64
output_format: PRG
region: both
techniques: [two_word_parser]
file_formats: [PRG]
uses_registers: [D011, D020, DD04, DD05, DD06, DD07, DD0E, DD0F]
uses_kernal: [GETIN]
---

<!-- doc-type: recipe -->

# Oscar64 Two-Word Parser: a verb and noun dictionary, an action table and three rooms, scripted through the KERNAL queue

## Synopsis

The smallest text-adventure parser of the period: a verb dictionary and
a noun dictionary of stems cut to four letters, an input line split at
its first space, each half looked up by stem, and an action table of
verb, noun, room and handler rows searched in order. Three rooms with
exits, two portable objects, and three fixed responses for an unknown
verb, an unknown noun and a known pair no row accepts. Ten commands are
typed into the KERNAL keyboard queue with `-keybuf` and read back with
`getchx()`; each command's parse is timed on CIA 2 and its cycles are
printed beside the response. At the end the program checks the room,
both object locations and the count of each response class against
compiled-in expectations and reports `PASS` or `FAIL` at `$02FF` and in
the border. The game text is original. For a full engine with
conditions, occurrences and packed messages see `adventure-engine.md`;
this page is the parser alone.

## Source

```c
// two-word-parser.c
// A two-word parser and an action table over three rooms and two objects.
// The command line arrives through the KERNAL queue (GETIN via getchx);
// every response is written to screen RAM as screen codes. Each parse is
// timed on CIA 2. The verdict goes to $02FF and the border.
#include <c64/vic.h>
#include <c64/cia.h>
#include <conio.h>

#define SCREEN  ((char *)0x0400)
#define RESULT  (*(volatile char *)0x02ff)
#define WL      4          // letters a word is cut to
#define LINELEN 20         // longest input line kept
#define NOBJ    2
#define NROOM   3
#define RCOL    12         // column the response starts in
#define TCOL    35         // column the parse cycles start in

// ---- vocabulary: stems of up to WL letters and an id; synonyms share an id --
struct vocab { const char *stem; char id; };

#define V_LOOK 1
#define V_TAKE 2
#define V_DROP 3
#define V_GO   4
#define V_INV  5
#define V_OPEN 6
#define N_LAMP  1
#define N_KEY   2
#define N_NORTH 3
#define N_SOUTH 4
#define N_UP    5
#define N_DOWN  6
#define N_DOOR  7
#define ANY 0

static const struct vocab verbs[] = {
    { "LOOK", V_LOOK }, { "TAKE", V_TAKE }, { "GET",  V_TAKE },
    { "DROP", V_DROP }, { "GO",   V_GO   }, { "INVE", V_INV  },
    { "OPEN", V_OPEN }, { 0, 0 }
};

static const struct vocab nouns[] = {
    { "LAMP", N_LAMP }, { "KEY",  N_KEY  }, { "NORT", N_NORTH },
    { "SOUT", N_SOUTH }, { "UP",  N_UP   }, { "DOWN", N_DOWN  },
    { "DOOR", N_DOOR }, { 0, 0 }
};

// ---- rooms: a description pointer and four exits, 6 bytes a room -----------
#define R_HALL   1
#define R_GARDEN 2
#define R_CELLAR 3

struct room { const char *desc; char exits[4]; };   // N, S, U, D

static const struct room rooms[NROOM + 1] = {
    { 0, { 0, 0, 0, 0 } },
    { "A COLD STONE HALL.",    { R_GARDEN, 0, 0, R_CELLAR } },
    { "A WALLED GARDEN.",      { 0, R_HALL, 0, 0 } },
    { "A CELLAR WITH A DOOR.", { 0, 0, R_HALL, 0 } }
};

// ---- objects: noun id and name, 3 bytes a row; location is 1 byte of state ---
#define CARRIED 255
struct object { char noun; const char *name; };

static const struct object objects[NOBJ] = {
    { N_LAMP, "A BRASS LAMP" }, { N_KEY, "AN IRON KEY" }
};
static char obj_loc[NOBJ] = { R_HALL, R_CELLAR };

// ---- game state ---------------------------------------------------------------
static char here = R_HALL;
static char door_open;

// ---- fixed responses and the classes counted for the verdict -----------------
static const char *r_unk_verb = "I DON'T KNOW THAT WORD.";
static const char *r_unk_noun = "I DON'T SEE THAT HERE.";
static const char *r_cant     = "YOU CAN'T DO THAT.";

#define C_OK   0
#define C_VERB 1
#define C_NOUN 2
#define C_CANT 3
#define NCLASS 4
static char counts[NCLASS];

// ---- screen output: screen codes written straight into screen RAM ------------
static char row = 2;

static void put_at(char x, char y, const char *s)
{
    char *p = SCREEN + 40 * y + x;
    while (*s) {
        char c = *s++;
        if (c >= 0x41 && c <= 0x5a) c -= 0x40;   // ASCII A-Z -> screen 1..26
        *p++ = c;
    }
}

static void say(const char *s)
{
    put_at(RCOL, row, s);
    row++;
}

static void put_num(char x, char y, unsigned long v)
{
    char buf[10];
    char n = 0;
    do { buf[n++] = 0x30 + (char)(v % 10); v /= 10; } while (v);
    char *p = SCREEN + 40 * y + x;
    while (n) *p++ = buf[--n];
}

// ---- the parser ---------------------------------------------------------------
// The typed word matches a stem when its first letters equal the whole stem
// and either the stem is WL letters long (the rest of the word is ignored)
// or the word ends there. "INVENTORY" matches "INVE"; "GOLD" does not
// match "GO".
static char lookup(const struct vocab *t, const char *w)
{
    for (; t->stem; t++) {
        const char *s = t->stem;
        char i = 0;
        while (i < WL && s[i] && w[i] == s[i]) i++;
        if (i == WL || (!s[i] && (!w[i] || w[i] == ' ')))
            return t->id;
    }
    return 0;
}

// ---- the action table: verb, noun, room (ANY = every room), handler ---------
typedef void (*handler)(char noun);

static void a_look(char n);
static void a_take(char n);
static void a_drop(char n);
static void a_go(char n);
static void a_inv(char n);
static void a_open(char n);
static void a_nodoor(char n);

struct action { char verb; char noun; char room; handler fn; };   // 5 bytes a row

static const struct action actions[] = {
    { V_OPEN, N_DOOR,  R_CELLAR, a_open   },   // room-specific row first
    { V_OPEN, N_DOOR,  ANY,      a_nodoor },   // any-room fallback for the same words
    { V_LOOK, ANY,     ANY,      a_look   },
    { V_INV,  ANY,     ANY,      a_inv    },
    { V_TAKE, N_LAMP,  ANY,      a_take   },
    { V_TAKE, N_KEY,   ANY,      a_take   },
    { V_DROP, N_LAMP,  ANY,      a_drop   },
    { V_DROP, N_KEY,   ANY,      a_drop   },
    { V_GO,   N_NORTH, ANY,      a_go     },
    { V_GO,   N_SOUTH, ANY,      a_go     },
    { V_GO,   N_UP,    ANY,      a_go     },
    { V_GO,   N_DOWN,  ANY,      a_go     },
    { 0, 0, 0, 0 }
};

static char find_obj(char noun)
{
    for (char i = 0; i < NOBJ; i++)
        if (objects[i].noun == noun) return i;
    return 255;
}

static void a_look(char n)
{
    say(rooms[here].desc);
    for (char i = 0; i < NOBJ; i++)
        if (obj_loc[i] == here) say(objects[i].name);
}

static void a_take(char n)
{
    char i = find_obj(n);
    if (obj_loc[i] != here) { say("IT IS NOT HERE."); return; }
    obj_loc[i] = CARRIED;
    say("TAKEN.");
}

static void a_drop(char n)
{
    char i = find_obj(n);
    if (obj_loc[i] != CARRIED) { say("YOU DON'T HAVE IT."); return; }
    obj_loc[i] = here;
    say("DROPPED.");
}

static void a_go(char n)
{
    char to = rooms[here].exits[n - N_NORTH];
    if (!to) { say("YOU CAN'T GO THAT WAY."); return; }
    here = to;
    say(rooms[here].desc);
}

static void a_inv(char n)
{
    char any = 0;
    for (char i = 0; i < NOBJ; i++)
        if (obj_loc[i] == CARRIED) { say(objects[i].name); any = 1; }
    if (!any) say("YOU CARRY NOTHING.");
}

static void a_open(char n)
{
    if (obj_loc[1] != CARRIED) { say("IT IS LOCKED."); return; }
    door_open = 1;
    say("THE DOOR SWINGS OPEN.");
}

static void a_nodoor(char n)
{
    say("THERE IS NO DOOR HERE.");
}

// Parse one line: verb, split, noun, table scan. Returns the class and, for
// C_OK, the matching row through *hit. Nothing here touches the screen.
static char parse(const char *line, const struct action **hit)
{
    char v = lookup(verbs, line);
    if (!v) return C_VERB;
    const char *rest = line;
    while (*rest && *rest != ' ') rest++;
    while (*rest == ' ') rest++;
    char n = 0;
    if (*rest) {
        n = lookup(nouns, rest);
        if (!n) return C_NOUN;
    }
    for (const struct action *a = actions; a->fn; a++) {
        if (a->verb != v) continue;
        if (a->noun != ANY && a->noun != n) continue;
        if (a->room != ANY && a->room != here) continue;
        *hit = a;
        return C_OK;
    }
    return C_CANT;
}

static char noun_of(const char *line)
{
    while (*line && *line != ' ') line++;
    while (*line == ' ') line++;
    return *line ? lookup(nouns, line) : 0;
}

// ---- CIA 2 timer A counting phi2, timer B counting A's underflows ------------
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

// ---- the input line through the KERNAL queue ----------------------------------
static char line[LINELEN + 1];

static void read_line(void)
{
    char len = 0;
    for (;;) {
        vic_waitFrame();
        char k = getchx();                     // GETIN; 0 when the queue is empty
        if (k == 0x0d || k == 0x0a) break;     // RETURN: getchx delivers $0A
        if (k >= 0x41 && k <= 0x5a && len < LINELEN) line[len++] = k;
        else if (k == 0x20 && len && len < LINELEN) line[len++] = k;
    }
    line[len] = 0;
    put_at(0, row, ">");
    put_at(1, row, line);
}

// ---- the scripted run: ten commands, then the verdict --------------------------
#define NCMD 10
// LOOK, TAKE LAMP, GO NORTH, INVENTORY, DANCE, TAKE SWORD, TAKE DOOR,
// GO SOUTH, GO DOWN, OPEN DOOR: seven handled, one unknown verb, one
// unknown noun, one pair with no row.
static const char exp_counts[NCLASS] = { 7, 1, 1, 1 };

int main(void)
{
    clrscr();
    put_at(0, 0, "TWO-WORD PARSER");

    unsigned long worst = 0, total = 0;
    for (char c = 0; c < NCMD; c++) {
        read_line();
        const struct action *hit = 0;
        t_start();
        char cls = parse(line, &hit);
        unsigned long t = t_stop();
        total += t;
        if (t > worst) worst = t;
        put_num(TCOL, row, t);
        if (cls == C_OK) hit->fn(noun_of(line));
        else if (cls == C_VERB) say(r_unk_verb);
        else if (cls == C_NOUN) say(r_unk_noun);
        else say(r_cant);
        counts[cls]++;
    }

    put_at(0, 21, "ROOM   OBJ0 OBJ1  OK VERB NOUN CANT");
    put_num(0, 22, here);
    put_num(7, 22, obj_loc[0]);
    put_num(12, 22, obj_loc[1]);
    put_num(18, 22, counts[C_OK]);
    put_num(21, 22, counts[C_VERB]);
    put_num(26, 22, counts[C_NOUN]);
    put_num(31, 22, counts[C_CANT]);
    put_at(0, 23, "PARSE WORST       TOTAL");
    put_num(12, 23, worst);
    put_num(24, 23, total);

    bool ok = here == R_CELLAR && obj_loc[0] == CARRIED && obj_loc[1] == R_CELLAR;
    for (char i = 0; i < NCLASS; i++)
        if (counts[i] != exp_counts[i]) ok = false;
    RESULT = ok ? 1 : 2;
    vic.color_border = ok ? 5 : 2;
    put_at(0, 24, ok ? "RESULT 01 PASS" : "RESULT 02 FAIL");

    for (;;)
        ;
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=two-word-parser.prg two-word-parser.c
```

Then run headless with the ten commands typed into the KERNAL queue
(PAL; add `-model ntsc` for NTSC):

```bash
GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas x64sc -default -warp +sound \
  +autostart-delay-random -autostartprgmode 1 -limitcycles 8000000 \
  -keybuf 'look\x0dtake lamp\x0dgo north\x0dinventory\x0ddance\x0dtake sword\x0dtake door\x0dgo south\x0dgo down\x0dopen door\x0d' \
  -exitscreenshot two-word-parser.png -autostart two-word-parser.prg
```

The string is quoted for the shell so that VICE sees the backslashes.
Lower-case ASCII letters arrive as unshifted PETSCII (`$41` to `$5A`),
`\x0d` is RETURN; the escape syntax was measured on `text-input.md`. VICE
feeds the queue as the KERNAL empties it, so a string of 88 keys goes
through the ten-byte buffer at `$0277` without loss; the run read all
ten lines back intact (rung 1, this run). The first draft named the
vocabulary struct `word`, which Oscar64's `c64/types.h` already defines;
the compiler reported "duplicate struct declaration" and every
initialiser after it as "Constant initializer expected", so the struct
is `vocab`.

## Expected output

`screenshots/two-word-parser.png` (PAL, 8,000,000 cycles) and
`screenshots/two-word-parser-ntsc.png` (NTSC, `-model ntsc`, same cycles
and flags), both read cell by cell against the character ROM, and each
byte-identical over two runs of the same command. Light blue text on the
default blue screen, the border green (PAL (98, 213, 50), NTSC
(114, 189, 103)):

```
TWO-WORD PARSER

>LOOK       A COLD STONE HALL.     569
            A BRASS LAMP
>TAKE LAMP  TAKEN.                 998
>GO NORTH   A WALLED GARDEN.       1577
>INVENTORY  A BRASS LAMP           1175
>DANCE      I DON'T KNOW THAT WORD.698
>TAKE SWORD I DON'T SEE THAT HERE. 1157
>TAKE DOOR  YOU CAN'T DO THAT.     1949
>GO SOUTH   A COLD STONE HALL.     1730
>GO DOWN    A CELLAR WITH A DOOR.  2036
>OPEN DOOR  IT IS LOCKED.          1740








ROOM   OBJ0 OBJ1  OK VERB NOUN CANT
3      255  3     7  1    1    1
PARSE WORST 2036  TOTAL 13629
RESULT 01 PASS
```

Column 0 is the echo of the line as read back from the queue, column 12
the response, and column 35 the cycles the parse took: the verb lookup,
the split, the noun lookup and the action-table scan, with no screen
writes inside the timed region. The figures are identical on PAL and
NTSC in the pinned runs. The room line reads `3` (the cellar), `255` for
the lamp (carried) and `3` for the key (still in the cellar), then the
four class counts against the compiled-in `{ 7, 1, 1, 1 }`. `$02FF` holds
`01` and the border is green; a wrong room, object or count gives `02`
and red.

The parse costs, from the picture:

| Command | Cycles | Why |
|---|---|---|
| `LOOK` | 569 | one verb lookup, no noun, third row of the table |
| `DANCE` | 698 | all seven verb stems tried and rejected |
| `TAKE LAMP` | 998 | verb, first noun, fifth row |
| `TAKE SWORD` | 1,157 | verb, all seven noun stems rejected |
| `INVENTORY` | 1,175 | sixth verb stem, no noun, fourth row |
| `GO NORTH` | 1,577 | fifth verb, third noun, ninth row |
| `GO SOUTH` | 1,730 | fifth verb, fourth noun, tenth row |
| `OPEN DOOR` | 1,740 | seventh verb, seventh noun, first row |
| `TAKE DOOR` | 1,949 | verb, seventh noun, all twelve rows rejected |
| `GO DOWN` | 2,036 | fifth verb, sixth noun, twelfth row |

The worst command is a hit on the last row after a late noun, not the
miss: the miss (`TAKE DOOR`) scans every row but its stem matches were
cheaper. Ten commands total 13,629 cycles. `-O2` output, measured in VICE
x64sc with the display on, so a badline or two may sit inside the larger
figures; the same numbers on both models say the frame position did not
change between them in these runs.

## Why this works

`lookup()` walks a stem table and compares at most `WL` letters. A stem
shorter than `WL` (`GO`, `KEY`, `UP`) has to end where the typed word
ends or where a space begins, otherwise `GOLD` would parse as `GO`. A
stem of exactly `WL` letters matches any word that starts with it, which
is how `INVENTORY` reaches `INVE` and also why the period's parsers
answered `TAKEN.` to `TAKE LAMPSHADE`. Synonyms cost one row each and
share an id: `GET` and `TAKE` both return `V_TAKE`, so nothing after the
lookup knows which was typed.

The action table is searched from the top and the first row whose verb,
noun and room all match wins, so a room-specific row above an any-room
row for the same words is an if-else with no code: in the cellar `OPEN
DOOR` reaches `a_open`, anywhere else it falls through to `a_nodoor`.
The three refusals are decided before any handler runs: no verb id is
`C_VERB`, a verb but no noun id is `C_NOUN`, and both ids but no row is
`C_CANT`, which is how `TAKE DOOR` is refused without a `TAKE` handler
ever having to test for doors. `LOOK` and `INVENTORY` take `ANY` as their
noun, so `LOOK LAMP` reaches `a_look` too; a game that wants `LOOK LAMP`
to describe the lamp adds a row above it.

Per row the tables are 3 bytes a word, 6 a room, 3 an object plus 1 byte
of location state, and 5 an action (Oscar64 packs the structs; the
sizes were printed by a `sizeof` build and read off the screen). The
whole game here is 16 vocabulary rows (14 words and two terminators),
4 room slots, 2 objects and 13 action rows (12 and a terminator), 145
bytes of tables before the strings; the parser's work grows with the
table lengths and with nothing else, which is the figure a larger game
scales from.

The text path crosses the PETSCII and screen-code boundary twice.
`getchx()` returns GETIN's PETSCII byte, `$41` to `$5A` for unshifted
letters, and the line is kept in that form because the stems are ASCII
capitals with the same values. Every string is then converted on the way
to `$0400` by `put_at`, which maps `$41` to `$5A` down to codes `1` to
`26`; the apostrophe, full stop and space are the same in both. A
PETSCII byte stored raw into screen RAM would show a graphics glyph
(`pitfalls/text-mode-render.md`, `petscii_written_to_screen_ram`).
RETURN is tested as `$0D` or `$0A` because Oscar64's default character
map delivers `$0A` (`pitfalls/kernal-and-io.md`,
`getchx_petscii_remaps_return`).
