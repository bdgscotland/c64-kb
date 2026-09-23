#!/usr/bin/env python3
"""gen.py: pack tools/world.py into src/gen_world.h and src/gen_script.h.

  python3 tools/gen.py            write both headers, print the packing figures
  python3 tools/gen.py --print    also print the model's transcript of the full script

The text: every string becomes a message. Messages are packed as bytes:
$01-$3F a screen code, $40-$FF a pair of codes (byte-pair packing, below),
$00 the end.
The engine: a Python copy of src/engine.c and src/text.c (parser, action
table, built-in verbs, the output tokens, the line printer). It plays the
autopilot script and writes what the game must end with, the fold of every
printed line and the number of metered frames, per build variant.
"""
import math
import os
import re
import sys
import zlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import world as W  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WL = 4                      # letters a word is matched on
CARRIED = 0xFF
WIDTH = 40                  # the text window's columns
KEYS_PER_FRAME = 10         # the KERNAL keyboard queue's size ($0289)
TOK_NL, TOK_NUM, TOK_CHR, TOK_STYLE = 0xF0, 0xF1, 0xF2, 0xF3
STYLE_TEXT, STYLE_ECHO = 0x00, 0x80        # the typed command prints in reverse video

# ---- ids -----------------------------------------------------------------------
ROOM_KEYS = list(W.ROOMS)
ROOM_ID = {k: i + 1 for i, k in enumerate(ROOM_KEYS)}
ITEM_KEYS = list(W.ITEMS)
ITEM_ID = {k: i + 1 for i, k in enumerate(ITEM_KEYS)}
NITEM = len(ITEM_KEYS) + 1
VERB_ID = {k: i + 1 for i, k in enumerate(W.VERBS)}
NOUN_KEYS = list(W.NOUNS)
assert NOUN_KEYS[:6] == W.DIRECTIONS
NOUN_ID = {k: i + 1 for i, k in enumerate(NOUN_KEYS)}
FLAG_BIT = {k: i for i, k in enumerate(W.FLAGS)}
PIC_KEYS = list(W.PICTURES)
PIC_ID = {k: i for i, k in enumerate(PIC_KEYS)}

COND = {"AT": 1, "CARRIED": 2, "HERE": 3, "REACH": 4, "FLAG": 5, "NOTFLAG": 6, "DARK": 7}
CMD = {"MSG": 1, "GOTO": 2, "LOOK": 3, "SETF": 4, "SWAP": 5, "CARRY": 6, "DESTROY": 7,
       "SCORE": 8, "WIN": 9}

# ---- messages -----------------------------------------------------------------------
MSGS = [""]                 # id 0 unused
MSG_ID = {}


def msg(text):
    if text not in MSG_ID:
        MSG_ID[text] = len(MSGS)
        MSGS.append(text)
    return MSG_ID[text]


ENGINE_MSG = {k: msg(v) for k, v in W.MESSAGES.items()}
for k, v in [("COMMA", ", "), ("DOT", "."), ("COLON", ": "),
             ("CLOSEP", ")."), ("SCORELBL", "SCORE"), ("TURNSLBL", "TURNS")]:
    ENGINE_MSG[k] = msg(v)
for d in W.DIRECTIONS:
    ENGINE_MSG["DIR" + d] = msg(" " + d)
ROOM_NAME = {k: msg(v[0]) for k, v in W.ROOMS.items()}
ROOM_DESC = {k: msg(v[1]) for k, v in W.ROOMS.items()}
ITEM_DESC = {k: msg(v[0]) for k, v in W.ITEMS.items()}
ITEM_EXAM = {k: (msg(v[4]) if v[4] else 0) for k, v in W.ITEMS.items()}
ITEM_INSIDE = {k: msg(W.INSIDE[k]) if k in W.INSIDE else 0 for k in W.ITEMS}


def compile_actions():
    rows = []
    for verb, noun, conds, cmds in W.ACTIONS:
        assert len(conds) <= 4 and len(cmds) <= 4, (verb, noun)
        row = [VERB_ID[verb] if verb else 0, NOUN_ID[noun] if noun else 0]
        for c in conds + [None] * (4 - len(conds)):
            if c is None:
                row += [0, 0]
                continue
            op, _, arg = c.partition(" ")
            row += [COND[op], cond_arg(op, arg)]
        for c in cmds + [None] * (4 - len(cmds)):
            if c is None:
                row += [0, 0]
                continue
            op, _, arg = c.partition(" ")
            row += [CMD[op], cmd_arg(op, arg)]
        rows.append(row)
    return rows


def cond_arg(op, arg):
    if op == "AT":
        return ROOM_ID[arg]
    if op in ("CARRIED", "HERE", "REACH"):
        return ITEM_ID[arg]
    if op in ("FLAG", "NOTFLAG"):
        return FLAG_BIT[arg]
    return 0


def cmd_arg(op, arg):
    if op == "MSG":
        return msg(arg)
    if op == "GOTO":
        return ROOM_ID[arg]
    if op in ("SWAP", "CARRY", "DESTROY"):
        return ITEM_ID[arg]
    if op == "SETF":
        return FLAG_BIT[arg]
    if op == "SCORE":
        return int(arg)
    return 0


ACTS = compile_actions()
MAXTURNS = 999                  # the status bar's three digits
NEEDS_NOUN = {VERB_ID[k] for k in ("GET", "DROP", "OPEN", "CLOSE", "UNLOCK", "LIGHT", "WIND", "PUT")}

# The limits the C code assumes.
assert len(MSGS) < TOK_NL, f"{len(MSGS)} messages: ids must stay below $F0"
assert len(W.FLAGS) <= 16, "flags are one 16-bit word"
assert len(W.ITEMS) < 127 and len(W.ROOMS) < 127, "bit 7 of a place marks a container"
assert len(ACTS) <= 255, "the action index is a char"
assert sum(int(c.split()[1]) for a in W.ACTIONS for c in a[3] if c.startswith("SCORE")) <= 255 \
    and W.MAXSCORE <= 255, "the score is a char"
for _t in MSGS:
    assert all(len(w) <= 40 for w in _t.split(" ")), f"a word over 40 letters: {_t}"

# The save record's version: a hash of what gives rooms, items and flags their
# numbers. Any change to them makes an old save refused, not misread.
WORLD_VERSION = zlib.crc32(repr((list(W.ROOMS), list(W.ITEMS), W.FLAGS)).encode()) & 0xFFFF

# ---- text packing -------------------------------------------------------------------------


def sc(ch):
    """ASCII upper case to a screen code."""
    o = ord(ch)
    if 0x41 <= o <= 0x5A:
        return o - 0x40
    assert 0x20 <= o <= 0x3F, repr(ch)
    return o


def pack_text():
    """Byte-pair packing: each round the commonest adjacent pair of symbols
    becomes a new code ($40 up), until 192 codes are used or no pair repeats
    three times. A code costs two table bytes; the decoder expands it on a
    small stack."""
    msgs = [[sc(c) for c in m] for m in MSGS[1:]]
    pairs = []
    while len(pairs) < 192:
        count = {}
        for m in msgs:
            i = 0
            while i < len(m) - 1:
                p = (m[i], m[i + 1])
                count[p] = count.get(p, 0) + 1
                i += 2 if i + 2 < len(m) and m[i + 2] == m[i] == m[i + 1] else 1
        if not count:
            break
        best = min(count, key=lambda p: (-count[p], p))
        if count[best] < 3:
            break
        code = 0x40 + len(pairs)
        pairs.append(best)
        for m in msgs:
            i, out = 0, []
            while i < len(m):
                if i < len(m) - 1 and (m[i], m[i + 1]) == best:
                    out.append(code)
                    i += 2
                else:
                    out.append(m[i])
                    i += 1
            m[:] = out
    stream, offs = bytearray(), [0]
    for m in msgs:
        offs.append(len(stream))
        stream += bytes(m) + b"\0"
    return stream, offs, pairs


STREAM, MSG_OFFS, PAIRS = pack_text()


def depth(b):
    return 1 if b < 0x40 else 1 + max(depth(PAIRS[b - 0x40][0]), depth(PAIRS[b - 0x40][1]))


PAIR_DEPTH = max([depth(0x40 + i) for i in range(len(PAIRS))] + [1])
assert PAIR_DEPTH < 16, f"pair codes nest {PAIR_DEPTH} deep; text.c's stack holds 16"


def unpack(m):
    """The C decoder's output for message m, as a string (checks the packer)."""
    out, p = [], MSG_OFFS[m]
    while STREAM[p]:
        stack = [STREAM[p]]
        p += 1
        while stack:
            b = stack.pop()
            if b < 0x40:
                out.append(b)
            else:
                stack += [PAIRS[b - 0x40][1], PAIRS[b - 0x40][0]]
    return "".join(chr(c + 0x40) if 1 <= c <= 26 else chr(c) for c in out)


for _m in range(1, len(MSGS)):
    assert unpack(_m) == MSGS[_m], (_m, unpack(_m), MSGS[_m])

# ---- the engine model ---------------------------------------------------------------------


def stem(word):
    return (word[:WL] + " " * WL)[:WL]


def word_table(words):
    """(stem, id) rows sorted by stem, so the parser starts at the first row
    with the word's first letter (first_letter() below)."""
    rows = sorted({(stem(w), i) for w, i in words})
    stems = [s for s, _ in rows]
    assert len(stems) == len(set(stems)), f"one stem, two meanings: {rows}"
    assert all("A" <= s[0] <= "Z" for s in stems), stems
    return rows


def first_letter(rows):
    return [next((k for k, (s, _) in enumerate(rows) if s[0] >= chr(65 + c)), len(rows))
            for c in range(26)] + [len(rows)]


VERB_TAB = word_table((w, VERB_ID[k]) for k, ws in W.VERBS.items() for w in ws)
NOUN_TAB = word_table((w, NOUN_ID[k]) for k, ws in W.NOUNS.items() for w in ws)
NOISE_TAB = [s for s, _ in word_table((w, 1) for w in W.NOISE)]
ITEM_NOUN = [0] + [NOUN_ID[W.ITEMS[k][1]] for k in ITEM_KEYS]
ITEM_FLAGS = [""] + [W.ITEMS[k][3] for k in ITEM_KEYS]
EXITS = [[0] * 6] + [[ROOM_ID.get(W.ROOMS[k][2].get(d), 0) for d in W.DIRECTIONS]
                     for k in ROOM_KEYS]
DARK = [False] + [W.ROOMS[k][3] for k in ROOM_KEYS]
LIGHT = ITEM_ID[W.LIGHT_ITEM]


def start_loc(s):
    if s is None:
        return 0
    if s == "CARRIED":
        return CARRIED
    if s.startswith("IN:"):
        return 0x80 | ITEM_ID[s[3:]]
    return ROOM_ID[s]


class Game:
    def __init__(self):
        self.room = ROOM_ID[W.START]
        self.loc = [0] + [start_loc(W.ITEMS[k][2]) for k in ITEM_KEYS]
        self.opened = [0] + [1 if "O" in W.ITEMS[k][3] else 0 for k in ITEM_KEYS]
        self.flags = self.score = self.turns = self.over = 0
        self.out = []
        self.disk = None            # "SAVE" or "LOAD" after a turn that asked for one

    # -- output tokens
    def m(self, key):
        self.out.append(ENGINE_MSG[key] if isinstance(key, str) else key)

    def nl(self):
        self.out.append(TOK_NL)

    def num(self, v):
        self.out += [TOK_NUM, v & 0xFF, v >> 8]

    def chars(self, text):
        for c in text:
            self.out += [TOK_CHR, sc(c)]

    # -- the world
    def reach_raw(self, i):
        lc = self.loc[i]
        if lc in (CARRIED, self.room):
            return True
        if lc & 0x80 and lc != CARRIED:
            c = lc & 0x7F
            return bool(self.opened[c]) and self.loc[c] in (CARRIED, self.room)
        return False

    def lit(self):
        return not DARK[self.room] or self.reach_raw(LIGHT)

    def scope(self, i):
        return self.loc[i] == CARRIED or (self.lit() and self.reach_raw(i))

    def picture(self):
        return PIC_ID[W.DARK_PICTURE] if not self.lit() else PIC_ID[W.ROOMS[ROOM_KEYS[self.room - 1]][4]]

    def listing(self, where, skip_scenery):
        k = 0
        for i in range(1, NITEM):
            if self.loc[i] == where and not (skip_scenery and "S" in ITEM_FLAGS[i]):
                if k:
                    self.m("COMMA")
                self.m(ITEM_DESC[ITEM_KEYS[i - 1]])
                k += 1
        return k

    def has_listed(self, where):
        return any(self.loc[i] == where and "S" not in ITEM_FLAGS[i] for i in range(1, NITEM))

    def contents(self, c):
        if self.has_listed(0x80 | c):
            self.m(ITEM_INSIDE[ITEM_KEYS[c - 1]])
            self.m("COLON")
            self.listing(0x80 | c, True)
            self.m("DOT")
        else:
            self.m("EMPTY")
        self.nl()

    def look(self):
        if not self.lit():
            self.m("DARK")
            self.nl()
            return
        self.m(ROOM_DESC[ROOM_KEYS[self.room - 1]])
        self.nl()
        if self.has_listed(self.room):
            self.m("SEE")
            self.listing(self.room, True)
            self.m("DOT")
            self.nl()
        for c in range(1, NITEM):
            if "C" in ITEM_FLAGS[c] and self.loc[c] == self.room and self.opened[c] \
                    and self.has_listed(0x80 | c):
                self.contents(c)
        dirs = [d for d in range(6) if EXITS[self.room][d]]
        if dirs:
            self.m("EXITS")
            for d in dirs:
                self.m("DIR" + W.DIRECTIONS[d])
            self.m("DOT")
        else:
            self.m("NOEXITS")
        self.nl()

    def score_line(self):
        self.m("SCORED")
        self.num(self.score)
        self.m("OUTOF")
        self.num(W.MAXSCORE)
        self.m("IN")
        self.num(self.turns)
        self.m("TURN" if self.turns == 1 else "TURNS")
        self.nl()

    def finish(self, how):
        self.m(how)
        self.nl()
        self.score_line()
        self.m("RANK0" if self.score == W.MAXSCORE else "RANK1")
        self.nl()
        self.m("AGAIN")
        self.nl()
        self.over = 1 if how == "WON" else 2

    # -- the action table
    def cond(self, op, a):
        if op == 1:
            return self.room == a
        if op == 2:
            return self.loc[a] == CARRIED
        if op == 3:
            return self.loc[a] == self.room
        if op == 4:
            return self.scope(a)
        if op == 5:
            return bool(self.flags >> a & 1)
        if op == 6:
            return not self.flags >> a & 1
        if op == 7:
            return not self.lit()
        return True

    def cmd(self, op, a):
        if op == 1:
            self.m(a)
            self.nl()
        elif op == 2:
            self.room = a
        elif op == 3:
            self.look()
        elif op == 4:
            self.flags |= 1 << a
        elif op == 5:
            self.loc[a], self.loc[a + 1] = self.loc[a + 1], self.loc[a]
        elif op == 6:
            self.loc[a] = CARRIED
        elif op == 7:
            self.loc[a] = 0
        elif op == 8:
            self.score += a
        elif op == 9:
            self.finish("WON")

    def run_row(self, row):
        for k in range(2, 10, 2):
            if row[k] and not self.cond(row[k], row[k + 1]):
                return False
        for k in range(10, 18, 2):
            if row[k]:
                self.cmd(row[k], row[k + 1])
        return True

    def scan(self, v, n):
        for row in ACTS:
            if row[0] == v and (row[1] == 0 or row[1] == n) and self.run_row(row):
                return True
        return False

    # -- built-in verbs
    def find(self, n, test):
        for i in range(1, NITEM):
            if ITEM_NOUN[i] == n and test(i):
                return i
        return 0

    def not_found(self):
        self.m("NOTHERE" if self.lit() else "DARK")
        self.nl()

    def builtin(self, v, n):
        V = {k: VERB_ID[k] for k in W.VERBS}
        if not n and v in NEEDS_NOUN:
            self.m("WHAT")
            self.nl()
            return
        if v == V["GO"]:
            if not 1 <= n <= 6:
                self.m("WHICHWAY")
                self.nl()
            elif not EXITS[self.room][n - 1]:
                self.m("NOWAY")
                self.nl()
            else:
                self.room = EXITS[self.room][n - 1]
                self.look()
        elif v == V["GET"]:
            i = self.find(n, lambda i: self.loc[i] != CARRIED and self.scope(i))
            if not n:
                self.m("WHAT")
            elif i:
                held = sum(1 for j in range(1, NITEM) if self.loc[j] == CARRIED)
                if "P" not in ITEM_FLAGS[i]:
                    self.m("FIXED")
                elif held >= W.MAXLOAD:
                    self.m("FULL")
                else:
                    self.loc[i] = CARRIED
                    self.m("TAKEN")
            elif self.find(n, lambda i: self.loc[i] == CARRIED):
                self.m("HAVEIT")
            else:
                self.not_found()
                return
            self.nl()
        elif v == V["DROP"]:
            i = self.find(n, lambda i: self.loc[i] == CARRIED)
            if i:
                self.loc[i] = self.room
                self.m("DROPPED")
            else:
                self.m("NOTHAVE")
            self.nl()
        elif v == V["LOOK"]:
            if not n:
                self.look()
                return
            i = self.find(n, self.scope)
            if not i:
                self.not_found()
                return
            exam = ITEM_EXAM[ITEM_KEYS[i - 1]]
            if exam:
                self.m(exam)
                self.nl()
            if "C" in ITEM_FLAGS[i]:
                if self.opened[i]:
                    self.contents(i)
                else:
                    self.m("CLOSED")
                    self.nl()
            elif not exam:
                self.m("NOTHINGSPECIAL")
                self.nl()
        elif v == V["INV"]:
            self.m("CARRYING")
            if not self.listing(CARRIED, False):
                self.m("NOTHING")
            self.m("DOT")
            self.nl()
        elif v in (V["OPEN"], V["CLOSE"]):
            i = self.find(n, self.scope)
            if not i:
                self.not_found()
                return
            if "C" not in ITEM_FLAGS[i]:
                self.m("NOTOPEN" if v == V["OPEN"] else "CANT")
                self.nl()
            elif v == V["OPEN"] and self.opened[i]:
                self.m("ISOPEN")
                self.nl()
            elif v == V["OPEN"]:
                self.opened[i] = 1
                self.m("OPENED")
                self.nl()
                self.contents(i)
            elif self.opened[i]:
                self.opened[i] = 0
                self.m("CLOSEDOK")
                self.nl()
            else:
                self.m("ISSHUT")
                self.nl()
        elif v == V["SCORE"]:
            self.score_line()
        elif v == V["QUIT"]:
            self.finish("QUITS")
        elif v == V["HELP"]:
            self.m("HELP")
            self.nl()
        else:
            self.m("CANT")
            self.nl()

    # -- the parser and one command
    def parse(self, line):
        words = [w for w in line.split(" ") if w and stem(w) not in NOISE_TAB]
        if not words:
            self.m("PARDON")
            self.nl()
            return None
        noun = lambda w: next((i for s, i in NOUN_TAB if s == stem(w)), 0)
        v = next((i for s, i in VERB_TAB if s == stem(words[0])), 0)
        k = 1
        n = noun(words[1]) if len(words) > 1 else 0
        if v and v != VERB_ID["GO"] and 1 <= n <= 6 and len(words) > 2:
            k, n = 2, noun(words[2])            # PICK UP LAMP: the UP is not a direction
        if not v:
            d = noun(words[0])
            if 1 <= d <= 6 and len(words) == 1:
                return VERB_ID["GO"], d
            if d and len(words) == 1:
                self.m("WITHIT")                # LAMP alone
                self.nl()
                return None
            self.unknown(words[0])
            return None
        if len(words) > k and not n:
            self.unknown(words[k])
            return None
        return v, n

    def unknown(self, word):
        self.m("UNKNOWN")
        self.chars(word[:12])
        self.m("DOT")
        self.nl()

    def command(self, line):
        self.out += [TOK_STYLE, STYLE_ECHO]
        self.chars(">" + line)
        self.out += [TOK_NL, TOK_STYLE, STYLE_TEXT]
        p = self.parse(line)
        if not p:
            return
        v, n = p
        if v in (VERB_ID["SAVE"], VERB_ID["LOAD"]):
            self.disk = "SAVE" if v == VERB_ID["SAVE"] else "LOAD"
            return
        if self.turns < MAXTURNS:           # the status bar has three digits
            self.turns += 1
        if not self.scan(v, n):
            self.builtin(v, n)
        if not self.over:
            for row in ACTS:
                if row[0] == 0:
                    self.run_row(row)

    # -- the save record (src/save.c)
    def record(self):
        b = [ord("S"), ord("W"), WORLD_VERSION & 0xFF, WORLD_VERSION >> 8, self.room, self.score,
             self.turns & 0xFF, self.turns >> 8, self.flags & 0xFF, self.flags >> 8] + \
            self.loc[1:] + self.opened[1:]
        return bytes(b + [fold8(b)])

    def restore(self, rec):
        n = NITEM - 1
        self.room, self.score = rec[4], rec[5]
        self.turns = rec[6] | rec[7] << 8
        self.flags = rec[8] | rec[9] << 8
        self.loc = [0] + list(rec[10:10 + n])
        self.opened = [0] + list(rec[10 + n:10 + 2 * n])

    def disk_reply(self, key, code):
        self.m(key)
        self.chars("(%02d" % code)
        self.m("CLOSEP")
        self.nl()


def fold8(bs):
    c = 0
    for b in bs:
        c = ((c ^ b) * 3 + 1) & 0xFF
    return c


def fold16(c, v):
    return ((c ^ v) * 5 + 1) & 0xFFFF

# ---- the printer model: one window line per frame --------------------------------------


class Printer:
    def __init__(self, toks):
        self.toks, self.t = toks, 0
        self.src = []               # characters of the token being read (screen codes)
        self.pend = None
        self.back = None            # a new line read one character too early
        self.style = STYLE_TEXT

    def char(self):
        """Next screen code, 'NL' or None at the end; colour tokens act at once."""
        if self.back:
            self.back = None
            return "NL"
        while not self.src:
            if self.t >= len(self.toks):
                return None
            k = self.toks[self.t]
            self.t += 1
            if k == TOK_NL:
                return "NL"
            if k == TOK_STYLE:
                self.style = self.toks[self.t]
                self.t += 1
            elif k == TOK_CHR:
                self.src = [self.toks[self.t]]
                self.t += 1
            elif k == TOK_NUM:
                v = self.toks[self.t] | self.toks[self.t + 1] << 8
                self.t += 2
                self.src = [ord(c) for c in str(v)]
            else:
                self.src = [sc(c) for c in MSGS[k]]
        return self.src.pop(0)

    def item(self):
        """A word (list of screen codes), 'NL', or None at the end."""
        c = self.char()
        while c == 0x20:
            c = self.char()
        if c in ("NL", None):
            return c
        w = [c]
        while True:
            c = self.char()
            if c == 0x20:
                return w
            if c in ("NL", None):
                self.back = c == "NL"
                return w
            w.append(c)

    def line(self):
        """The next line's 40 screen codes, or None when done."""
        if self.pend is None:
            self.pend = self.item()
        if self.pend is None:
            return None
        row, col = [0x20] * WIDTH, 0
        while True:
            if self.pend is None:
                self.pend = self.item()
            p = self.pend
            if p is None:
                break
            if p == "NL":
                self.pend = None
                break
            need = len(p) + (1 if col else 0)
            if col + need > WIDTH:
                if col:
                    break
                p, self.pend = p[:WIDTH], p[WIDTH:]
                row[:len(p)] = p
                col = WIDTH
                break
            if col:
                col += 1
            row[col:col + len(p)] = p
            col += len(p)
            self.pend = None
        return [c | self.style if i < col else c for i, c in enumerate(row)]


def play(script, disk_saved=None, stop_after=None):
    """Play commands through the model. Returns (game, lines, frames, codes, saved)."""
    g = Game()
    g.out += [TOK_STYLE, STYLE_TEXT]
    g.m("INTRO")
    g.nl()
    g.nl()
    g.look()
    frames, lines, shown = 1, [], g.picture()          # the first frame draws the picture
    g.seen = {shown}
    pr = Printer(g.out)
    style = STYLE_TEXT
    codes, saved = {}, disk_saved

    def drain():
        nonlocal frames, style, pr
        while True:
            pr.style = style
            r = pr.line()
            style = pr.style
            if r is None:
                break
            lines.append(r)
            frames += 1

    drain()
    for cmd in script:
        g.out = []
        frames += math.ceil((len(cmd) + 1) / KEYS_PER_FRAME)
        g.command(cmd)
        assert len(g.out) < 250, f"{cmd}: {len(g.out)} output bytes; engine.c keeps 250"
        if g.picture() != shown:
            shown = g.picture()
            g.seen.add(shown)
            frames += 1
        pr = Printer(g.out)
        drain()
        if g.disk:
            g.out = []
            if g.disk == "SAVE":
                saved = g.record()
                g.disk_reply("SAVED", 0)
                codes["save"] = 0
            elif saved:
                g.restore(saved)
                g.disk_reply("LOADED", 0)
                g.look()
                codes["load"] = 0
            else:
                g.disk_reply("NOSAVE", 62)
                codes["load"] = 62
            g.disk = None
            if g.picture() != shown:
                shown = g.picture()
                frames += 1
            pr = Printer(g.out)
            drain()
        if g.over or cmd == stop_after:
            break
    return g, lines, frames, codes, saved


def text_fold(lines):
    f = 0
    for row in lines:
        for c in row:
            f = fold16(f, c)
    return f


def loc_fold(g):
    f = 0
    for b in g.loc[1:] + g.opened[1:]:
        f = fold16(f, b)
    return f


def row_text(row):
    return "".join(chr((c & 0x7F) + 0x40) if 1 <= c & 0x7F <= 26 else chr(c & 0x7F) for c in row)

# ---- pictures ---------------------------------------------------------------------------------


class Pic:
    def __init__(self):
        self.cells = [[("sky", 0)] * 40 for _ in range(7)]

    def put(self, x, y, glyph, colour=0):
        assert glyph in W.GLYPHS, glyph
        self.cells[y][x] = (glyph, colour if "c" in "".join(W.GLYPHS[glyph]) else 0)

    def fill(self, x0, y0, x1, y1, glyph, colour=0):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                self.put(x, y, glyph, colour)


GLYPH_KEYS = list(W.GLYPHS)
assert len(GLYPH_KEYS) <= 64


def glyph_bytes(rows):
    val = {".": 0, "a": 1, "b": 2, "c": 3}
    out = []
    for r in rows:
        assert len(r) == 4, r
        out.append(val[r[0]] << 6 | val[r[1]] << 4 | val[r[2]] << 2 | val[r[3]])
    return out


def build_pictures():
    tiles, tile_id, streams, raw = [], {}, [], 0
    for key in PIC_KEYS:
        p = Pic()
        W.PICTURES[key](p)
        cells = [c for row in p.cells for c in row]
        raw += 2 * len(cells)
        ids = []
        for c in cells:
            if c not in tile_id:
                tile_id[c] = len(tiles)
                tiles.append(c)
            ids.append(tile_id[c])
        s = bytearray()
        for row in range(7):                    # nothing crosses the end of a row
            i, end, lit = 40 * row, 40 * row + 40, []
            while i < end:
                j = i
                while j < end and ids[j] == ids[i]:
                    j += 1
                if j - i >= 3:                  # a run: its length, then the tile
                    if lit:
                        s += bytes([0x80 | len(lit)] + lit)
                        lit = []
                    s += bytes([j - i, ids[i]])
                else:                           # short: into a literal, $80 + count, tiles
                    lit += ids[i:j]
                i = j
            if lit:
                s += bytes([0x80 | len(lit)] + lit)
        streams.append(s)
    assert len(tiles) <= 255
    return tiles, streams, raw

# ---- sound ----------------------------------------------------------------------------------------
NOTES = {"C5": 523.25, "E5": 659.26, "G5": 783.99, "C6": 1046.50, "A4": 440.0}
PAL_CLOCK, NTSC_CLOCK = 985248, 1022727


def freq(hz, clock):
    return round(hz * 16777216 / clock)

# ---- C output ---------------------------------------------------------------------------------------


def carr(ctype, name, values, per=16, fmt="0x%02x"):
    body = ",\n    ".join(", ".join(fmt % v for v in values[i:i + per])
                          for i in range(0, len(values), per))
    return f"static const {ctype} {name}[{len(values)}] = {{\n    {body}\n}};\n"


def cname(k):
    return re.sub(r"[^A-Z0-9]", "_", k.upper())


def write_world(tiles, streams):
    o = ["// gen_world.h: written by tools/gen.py from tools/world.py. Do not edit.",
         "#ifndef GEN_WORLD_H", "#define GEN_WORLD_H", ""]
    o.append(f"#define NROOM {len(ROOM_KEYS) + 1}")
    o.append(f"#define NITEM {NITEM}")
    o.append(f"#define NACT {len(ACTS)}")
    o.append(f"#define NVERBW {len(VERB_TAB)}")
    o.append(f"#define NNOUNW {len(NOUN_TAB)}")
    o.append(f"#define NNOISE {len(NOISE_TAB)}")
    o.append(f"#define MAXLOAD {W.MAXLOAD}")
    o.append(f"#define MAXSCORE {W.MAXSCORE}")
    o.append(f"#define START_ROOM {ROOM_ID[W.START]}")
    o.append(f"#define LIGHT_ITEM {LIGHT}")
    o.append(f"#define DARK_PIC {PIC_ID[W.DARK_PICTURE]}")
    o.append(f"#define TITLE_PIC {PIC_ID[W.TITLE_PICTURE]}")
    o.append(f"#define NPIC {len(PIC_KEYS)}")
    o.append(f"#define MAXTURNS {MAXTURNS}")
    o.append(f"#define WORLD_VERSION 0x{WORLD_VERSION:04x}      // a hash of rooms, items, flags")
    o.append(f"#define NTILE {len(tiles)}")
    o.append(f"#define NGLYPH {len(GLYPH_KEYS)}")
    for k, v in VERB_ID.items():
        o.append(f"#define V_{k} {v}")
    for k in W.DIRECTIONS:
        o.append(f"#define N_{k} {NOUN_ID[k]}")
    for k, v in ENGINE_MSG.items():
        o.append(f"#define M_{k} {v}")
    for k, v in ITEM_ID.items():
        o.append(f"#define I_{cname(k)} {v}")
    o.append("#define IF_PORTABLE 1\n#define IF_CONTAINER 2\n#define IF_OPEN 4\n#define IF_SCENERY 8")
    o.append("")
    o.append("// Packed text: see tools/gen.py. msg_at[m] is message m's first byte.")
    o.append(carr("char", "text_bytes", list(STREAM)))
    o.append(carr("unsigned", "msg_at", [0] + MSG_OFFS[1:], 12, "%d"))
    o.append(carr("char", "pair_left", [a for a, _ in PAIRS]))
    o.append(carr("char", "pair_right", [b for _, b in PAIRS]))
    o.append("// Rooms: name, description, exits N S E W U D, dark, picture.")
    o.append(carr("char", "room_name", [0] + [ROOM_NAME[k] for k in ROOM_KEYS], 16, "%d"))
    o.append(carr("char", "room_desc", [0] + [ROOM_DESC[k] for k in ROOM_KEYS], 16, "%d"))
    o.append(carr("char", "room_exits", [x for e in EXITS for x in e], 6, "%d"))
    o.append(carr("char", "room_dark", [int(d) for d in DARK], 16, "%d"))
    o.append(carr("char", "room_pic", [0] + [PIC_ID[W.ROOMS[k][4]] for k in ROOM_KEYS], 16, "%d"))
    o.append("// Items: description, noun, start location, flags, examine text, container phrase.")
    o.append(carr("char", "item_desc", [0] + [ITEM_DESC[k] for k in ITEM_KEYS], 16, "%d"))
    o.append(carr("char", "item_noun", ITEM_NOUN, 16, "%d"))
    o.append(carr("char", "item_start", [0] + [start_loc(W.ITEMS[k][2]) for k in ITEM_KEYS]))
    fl = [0] + [("P" in f) | ("C" in f) << 1 | ("O" in f) << 2 | ("S" in f) << 3
                for f in (W.ITEMS[k][3] for k in ITEM_KEYS)]
    o.append(carr("char", "item_flags", fl, 16, "%d"))
    o.append(carr("char", "item_exam", [0] + [ITEM_EXAM[k] for k in ITEM_KEYS], 16, "%d"))
    o.append(carr("char", "item_inside", [0] + [ITEM_INSIDE[k] for k in ITEM_KEYS], 16, "%d"))
    o.append("// Words: four letters, space padded, then the id.")
    o.append(carr("char", "verb_words", [ord(c) for s, _ in VERB_TAB for c in s], 16, "%d"))
    o.append(carr("char", "verb_ids", [i for _, i in VERB_TAB], 16, "%d"))
    o.append(carr("char", "noun_words", [ord(c) for s, _ in NOUN_TAB for c in s], 16, "%d"))
    o.append(carr("char", "noun_ids", [i for _, i in NOUN_TAB], 16, "%d"))
    o.append(carr("char", "noise_words", [ord(c) for s in NOISE_TAB for c in s], 16, "%d"))
    o.append("// The first row of each table whose stem starts with A, B, ... Z, then the count.")
    o.append(carr("char", "verb_first", first_letter(VERB_TAB), 27, "%d"))
    o.append(carr("char", "noun_first", first_letter(NOUN_TAB), 27, "%d"))
    o.append(carr("char", "noise_first", first_letter([(s, 1) for s in NOISE_TAB]), 27, "%d"))
    o.append("// Actions: verb, noun (0 any), four (condition, arg), four (command, arg).")
    o.append(carr("char", "act", [x for r in ACTS for x in r], 18, "%d"))
    o.append("// Pictures: glyph bytes for codes 64 up, tiles (character, colour RAM), runs and literals.")
    o.append(carr("char", "glyph_bytes", [b for k in GLYPH_KEYS for b in glyph_bytes(W.GLYPHS[k])], 8))
    o.append(carr("char", "tile_char", [64 + GLYPH_KEYS.index(g) for g, _ in tiles]))
    o.append(carr("char", "tile_colour", [8 | c for _, c in tiles]))
    pic_at, allp = [], bytearray()
    for s in streams:
        pic_at.append(len(allp))
        allp += s
    o.append(carr("char", "pic_bytes", list(allp)))
    o.append(carr("unsigned", "pic_at", pic_at, 12, "%d"))
    o.append("// Note frequencies, PAL then NTSC: C5 E5 G5 C6 A4.")
    o.append(carr("unsigned", "note_pal", [freq(h, PAL_CLOCK) for h in NOTES.values()], 8, "%d"))
    o.append(carr("unsigned", "note_ntsc", [freq(h, NTSC_CLOCK) for h in NOTES.values()], 8, "%d"))
    o.append("#endif\n")
    open(os.path.join(ROOT, "src", "gen_world.h"), "w").write("\n".join(o))
    return len(allp)


def cstr(s):
    return '"' + s.replace('"', '\\"') + '"'


def write_script(variants):
    o = ["// gen_script.h: written by tools/gen.py (the autopilot script and what the",
         "// model says each build must end with). Do not edit.",
         "#ifndef GEN_SCRIPT_H", "#define GEN_SCRIPT_H", ""]
    for i, (cond, script, g, lines, frames, codes) in enumerate(variants):
        o.append(("#if " if i == 0 else "#elif ") + cond)
        o.append("static const char *const script[] = {\n    " +
                 ",\n    ".join(cstr(s) for s in script) + ",\n    0\n};")
        o.append(f"#define EXPECT_ROOM {g.room}")
        o.append(f"#define EXPECT_SCORE {g.score}")
        o.append(f"#define EXPECT_TURNS {g.turns}")
        o.append(f"#define EXPECT_FLAGS 0x{g.flags:04x}")
        o.append(f"#define EXPECT_OVER {g.over}")
        o.append(f"#define EXPECT_LOCFOLD 0x{loc_fold(g):04x}")
        o.append(f"#define EXPECT_TEXTFOLD 0x{text_fold(lines):04x}")
        o.append(f"#define EXPECT_FRAMES {frames}")
        o.append(f"#define METER_HOLD {min(frames, 255)}      // the meter records at most 255")
        o.append(f"#define EXPECT_LINES {len(lines)}")
        o.append(f"#define EXPECT_SAVE_CODE {codes.get('save', 0xff)}")
        o.append(f"#define EXPECT_LOAD_CODE {codes.get('load', 0xff)}")
    o.append("#endif\n#endif\n")
    open(os.path.join(ROOT, "src", "gen_script.h"), "w").write("\n".join(o))


def main():
    tiles, streams, pic_raw = build_pictures()
    pic_packed = write_world(tiles, streams)
    split = W.SCRIPT.index("SAVE")
    load_at = W.SCRIPT.index("LOAD")
    full = play(W.SCRIPT)
    # Every picture must be drawn under the meter: the library's, never drawn
    # by the first script, was over the frame (found in review).
    missing = sorted(k for k in PIC_KEYS if PIC_ID[k] not in full[0].seen)
    assert not missing, f"the script never shows the pictures {missing}: visit them"
    part1 = play(W.SCRIPT[:split + 1], stop_after="SAVE")
    part2 = play(W.SCRIPT[load_at:], disk_saved=part1[4])
    variants = [
        ("DISKTEST == 1", W.SCRIPT[:split + 1]) + part1[:4],
        ("DISKTEST == 2", W.SCRIPT[load_at:]) + part2[:4],
        ("1", W.SCRIPT) + full[:4],
    ]
    write_script(variants)
    for v in variants:
        if v[4] > 255:
            print(f"gen: WARNING: {v[0]}: {v[4]} play frames. The meter records the first 255, "
                  f"so the rest are not metered and check's frame count will not match. "
                  f"Shorten the script (README, Extending it).", file=sys.stderr)
    os.makedirs(os.path.join(ROOT, "build"), exist_ok=True)
    open(os.path.join(ROOT, "build", "save-expected.bin"), "wb").write(part1[4])

    plain = sum(len(m) + 1 for m in MSGS[1:]) + 2 * (len(MSGS) - 1)
    packed = len(STREAM) + 2 * len(PAIRS) + 2 * (len(MSGS) - 1)
    five = sum(2 * math.ceil(len(m) / 3) for m in MSGS[1:]) + 2 * (len(MSGS) - 1)
    print(f"gen: {len(MSGS) - 1} messages, {sum(len(m) for m in MSGS[1:])} characters")
    print(f"gen: text as C strings with a pointer table {plain} bytes; packed {packed} "
          f"(stream {len(STREAM)}, {len(PAIRS)} pair codes {2 * len(PAIRS)}, "
          f"pointers {2 * (len(MSGS) - 1)}): "
          f"{100 * (plain - packed) / plain:.1f} % smaller; 5-bit packing would be {five}")
    print(f"gen: pictures {len(PIC_KEYS)} x 280 cells, {pic_raw} bytes raw, {pic_packed} packed, "
          f"{len(tiles)} tiles over {len(GLYPH_KEYS)} glyphs")
    for v in variants:
        g = v[2]
        print(f"gen: {v[0]}: {len(v[1])} commands, room {g.room}, score {g.score}, "
              f"turns {g.turns}, over {g.over}, {len(v[3])} lines, {v[4]} play frames, "
              f"text fold 0x{text_fold(v[3]):04x}, codes {v[5]}")
    if "--print" in sys.argv:
        for row in full[1]:
            print(f"  |{row_text(row)}|")


if __name__ == "__main__":
    main()
