#!/usr/bin/env python3
"""gen.py: the caves, the autopilot script, the rules model and the note table.

    python3 tools/gen.py            # writes src/gen_caves.h, gen_autopilot.h, gen_notes.h
    python3 tools/gen.py --show     # also prints the model's cave at game over

Edit CAVES (or SCRIPT) below, run this, rebuild. It
  1. packs every cave into the RLE row stream of c64-kb's level-rle-decoder
     recipe (control byte 0x80+n: the next byte n times; 1..127: that many
     literal bytes follow; 0: end of row), one stream per row of 40 cells;
  2. runs a model of the same rules as src/cave.c over the autopilot script
     and writes what the program must find at game over (the cave's fold,
     score, gems, play frames), which the AUTOPILOT build grades itself on;
  3. writes the SID frequency tables for PAL and NTSC.
The model is the specification of the rules: change a rule in cave.c and
here together, or the autopilot verdict turns red.
"""
import os
import sys

W, H = 40, 22

# Element codes, the same numbers as src/cave.h. Bit 7 is the scanned bit.
SPACE, DIRT, BRICK, STEEL, BOULDER, BOULDER_F, GEM, GEM_F = range(8)
EXIT_SHUT, EXIT_OPEN, PLAYER = 8, 9, 10
SPARK, MOTH, BLAST, BURST = 12, 16, 20, 23   # SPARK/MOTH + heading 0..3; BLAST/BURST + stage 0..2
SCANNED = 0x80
STEP = [-1, -W, 1, W]                          # headings: left, up, right, down

LEGEND = {'.': DIRT, ' ': SPACE, '#': BRICK, 'S': STEEL, 'o': BOULDER, '*': GEM,
          'X': EXIT_SHUT, 'P': PLAYER, 'f': SPARK + 0, 'm': MOTH + 0}

GEM_POINTS = 10
TICK_CAVE_FRAMES = 12      # cave frames per unit of the time counter
DEATH_FRAMES = 8           # cave frames between a death and the next life
SLICE_FRAMES = 4           # display frames per cave frame (the scan's four slices)

# Each cave: name (at most 16 characters), gems needed, time, 20 interior
# rows of 38 cells (shorter rows are padded with dirt). The steel border is
# added here. One player, one exit per cave. Original layouts.
CAVES = [
    ("FIRST DIG", 6, 99, [
        "...........o..*.........o............",
        ".P...*..*..*...*..o  ...........oo...",
        "...................*.....o...........",
        "...................*....oo...........",
        "....................XS...............",
        "..........................#####......",
        ".....o...............................",
        "..............####.......####........",
        "....*.........#  #.......#  #...*....",
        "..............# f#.......#m #........",
        "..............#  #.......#  #........",
        "..............####.......####........",
        "",
        "....o.............o........o.........",
        "....*....o...*....*.....o..*.....*...",
        "",
        "..............*..........#####.......",
        "......o..............................",
        "......*........o..............*......",
        "",
    ]),
    ("BOULDER HALL", 8, 120, [
        "....o................o...............",
        "..........o.......................o..",
        "..P..........*.........*.............",
        "...............o.....f     .X........",
        "...........#####.....................",
        "......*..............*.......*.......",
        "...........o...........o.............",
        "........  ...........................",
        "......#####...........#####..........",
        "...........*....*.........*..........",
        "",
        "........m     .......................",
        "....o.......o.......o........o.......",
        "....*.......*.......*........*.......",
        "",
        "..........####.............####......",
        "",
        "...*..................*.........*....",
        "",
        "",
    ]),
]

# The autopilot's moves, one per cave frame: L U R D, '-' stands still.
# Past the end of a cave's string the player stands still.
SCRIPT = [
    "RRRRRRRRRRRRRRRRRRDDDR",
    "RRUD",
]
LIVES_AUTOPILOT = 1
NAME_AUTOPILOT = "ABE"


def build(cave):
    name, need, time, rows = cave
    c = [STEEL] * (W * H)
    for y in range(1, H - 1):
        r = rows[y - 1] if y - 1 < len(rows) else ""
        if len(r) > W - 2:
            sys.exit(f"cave {name}: row {y} is {len(r)} cells, more than {W - 2}")
        for x, ch in enumerate(r.ljust(W - 2, '.'), 1):
            if ch not in LEGEND:
                sys.exit(f"cave {name}: row {y} has '{ch}', not in the legend")
            c[y * W + x] = LEGEND[ch]
    for code in (PLAYER, EXIT_SHUT):
        if c.count(code) != 1:
            sys.exit(f"cave {name}: {c.count(code)} cells of code {code}, want 1")
    return c


def rle_row(cells):
    """The level-rle-decoder stream for one row: runs of 3 or more, else literals."""
    out, i, lit = [], 0, []
    while i < len(cells):
        j = i
        while j < len(cells) and cells[j] == cells[i] and j - i < 127:
            j += 1
        if j - i >= 3:
            if lit:
                out += [len(lit)] + lit
                lit = []
            out += [0x80 | (j - i), cells[i]]
            i = j
        else:
            lit.append(cells[i])
            i += 1
            if len(lit) == 127:
                out += [len(lit)] + lit
                lit = []
    if lit:
        out += [len(lit)] + lit
    return out + [0]


def rle_decode(data):
    out, i = [], 0
    for _ in range(H):
        while True:
            c = data[i]; i += 1
            if c == 0:
                break
            if c & 0x80:
                out += [data[i]] * (c & 0x7f); i += 1
            else:
                out += data[i:i + c]; i += c
    return out


def fold(cells, chk=0):
    for v in cells:
        chk = ((chk ^ (v & 0x7f)) * 5 + 1) & 0xffff
    return chk


class Cave:
    """One cave's state and the rules. Mirrors src/cave.c line for line."""

    def __init__(self, cells, need, time):
        self.c = list(cells)
        self.need, self.time = need, time
        self.got = self.points = 0
        self.dead = self.exited = self.exit_open = False
        self.player = self.c.index(PLAYER)
        self.exit_at = self.c.index(EXIT_SHUT)
        self.tick = 0
        self.move = -1

    def put(self, d, v, s):
        if d > s:
            v |= SCANNED
        self.c[d] = v
        self.c[s] = SPACE
        if v & 0x7f == PLAYER:
            self.player = d

    def explode(self, centre, kind, at):
        for dy in (-W, 0, W):
            for dx in (-1, 0, 1):
                n = centre + dy + dx
                t = self.c[n] & 0x7f
                if t in (STEEL, EXIT_SHUT, EXIT_OPEN):
                    continue
                if t == PLAYER:
                    self.dead = True
                self.c[n] = kind | (SCANNED if n > at else 0)

    def roll(self, i, fall):
        for o in (-1, 1):
            if self.c[i + o] == SPACE and self.c[i + W + o] == SPACE:
                self.put(i + o, fall, i)
                return True
        return False

    @staticmethod
    def round_(t):
        return t in (BOULDER, GEM, BRICK)

    def cell(self, i):
        c, v = self.c, self.c[i]
        if v & SCANNED:
            c[i] = v & 0x7f
            return
        if v in (BOULDER, GEM):
            b = c[i + W]
            if b == SPACE:
                self.put(i + W, v + 1, i)
            elif self.round_(b & 0x7f):
                self.roll(i, v + 1)
        elif v in (BOULDER_F, GEM_F):
            b = c[i + W]; bt = b & 0x7f
            if b == SPACE:
                self.put(i + W, v, i)
            elif bt == PLAYER:
                self.explode(i + W, BLAST, i)
            elif SPARK <= bt < MOTH:
                self.explode(i + W, BLAST, i)
            elif MOTH <= bt < BLAST:
                self.explode(i + W, BURST, i)
            elif bt in (BOULDER_F, GEM_F):
                pass
            elif not (self.round_(bt) and self.roll(i, v)):
                c[i] = v - 1
        elif v == PLAYER:
            if 0 <= self.move < 4:
                t = i + STEP[self.move]
                tv = c[t]
                if tv in (SPACE, DIRT):
                    self.put(t, PLAYER, i)
                elif tv == GEM:
                    self.got += 1
                    self.points += GEM_POINTS
                    self.put(t, PLAYER, i)
                elif tv == EXIT_OPEN:
                    c[i] = SPACE
                    self.exited = True
                elif tv == BOULDER and self.move in (0, 2) and c[t + STEP[self.move]] == SPACE:
                    self.put(t + STEP[self.move], BOULDER, t)
                    self.put(t, PLAYER, i)
        elif v >= BLAST:
            if v in (BLAST + 2,):
                c[i] = SPACE
            elif v == BURST + 2:
                c[i] = GEM
            else:
                c[i] = v + 1
        elif v >= SPARK:
            base = SPARK if v < MOTH else MOTH
            kind = BLAST if v < MOTH else BURST
            d = v & 3
            for o in STEP:
                if c[i + o] & 0x7f == PLAYER:
                    self.explode(i, kind, i)
                    return
            first = (d + 3) & 3 if base == SPARK else (d + 1) & 3
            spin = (d + 1) & 3 if base == SPARK else (d + 3) & 3
            if c[i + STEP[first]] == SPACE:
                self.put(i + STEP[first], base + first, i)
            elif c[i + STEP[d]] == SPACE:
                self.put(i + STEP[d], base + d, i)
            else:
                c[i] = base + spin

    def scan(self):
        for y in range(1, H - 1):
            for x in range(1, W - 1):
                i = y * W + x
                if self.c[i] >= BOULDER:
                    self.cell(i)
        assert not any(v & SCANNED for v in self.c), "a scanned bit survived the scan"

    def end_of_frame(self):
        """What the game does after the last slice of a cave frame."""
        if not self.exit_open and self.got >= self.need:
            self.c[self.exit_at] = EXIT_OPEN
            self.exit_open = True
        if self.exited or self.dead:
            return
        self.tick += 1
        if self.tick == TICK_CAVE_FRAMES:
            self.tick = 0
            if self.time:
                self.time -= 1
            if self.time == 0:
                self.explode(self.player, BLAST, 0xffff)


def play():
    """The autopilot game, as the program plays it. Returns what it must show."""
    score, gems, frames, lives = 0, 0, 0, LIVES_AUTOPILOT
    ci = 0
    while True:
        name, need, time, _ = CAVES[ci]
        cv = Cave(build(CAVES[ci]), need, time)
        script, f, dead_frames = SCRIPT[ci] if ci < len(SCRIPT) else "", 0, 0
        while True:
            m = script[f] if f < len(script) else '-'
            cv.move = "LURD".find(m)
            cv.scan()
            cv.end_of_frame()
            f += 1
            frames += SLICE_FRAMES
            if cv.exited:
                break
            if cv.dead:
                dead_frames += 1
                if dead_frames == DEATH_FRAMES:
                    break
            if f > 5000:
                sys.exit("autopilot: the script never ends a cave")
        score += cv.points
        gems += cv.got
        if cv.exited:
            score += cv.time
            ci = (ci + 1) % len(CAVES)
            continue
        lives -= 1
        if lives == 0:
            return dict(fold=fold(cv.c), score=score, gems=gems, cave=ci, frames=frames,
                        cells=[v & 0x7f for v in cv.c])


def c_array(name, data):
    lines = [f"static const char {name}[{len(data)}] = {{"]
    for k in range(0, len(data), 16):
        lines.append("    " + ", ".join(f"0x{b:02x}" for b in data[k:k + 16]) + ",")
    lines.append("};")
    return "\n".join(lines)


def screen_codes(s):
    return [ord(ch) - 64 if 'A' <= ch <= 'Z' else ord(ch) for ch in s]


def write_caves(path):
    out = ["// gen_caves.h: written by tools/gen.py. Do not edit; edit tools/gen.py.",
           f"#define CAVE_COUNT {len(CAVES)}", ""]
    total = 0
    for k, cave in enumerate(CAVES):
        cells = build(cave)
        packed = []
        for y in range(H):
            packed += rle_row(cells[y * W:(y + 1) * W])
        assert rle_decode(packed) == cells
        total += len(packed)
        out.append(f"// {cave[0]}: 880 cells -> {len(packed)} bytes, fold 0x{fold(cells):04x}")
        out.append(c_array(f"cave{k}_rle", packed))
        out.append(c_array(f"cave{k}_name", screen_codes(cave[0].ljust(16)[:16])))
    out.append("")
    out.append("static const CaveInfo cave_info[CAVE_COUNT] = {")
    for k, (name, need, time, _) in enumerate(CAVES):
        fold0 = fold(build(CAVES[k]))
        out.append(f"    {{ cave{k}_rle, cave{k}_name, {need}, {time}, 0x{fold0:04x} }},")
    out.append("};")
    open(path, "w").write("\n".join(out) + "\n")
    return total


def write_autopilot(path, result):
    out = ["// gen_autopilot.h: written by tools/gen.py. Do not edit; edit tools/gen.py.",
           "// The autopilot: one move per cave frame (L U R D, '-' still), per cave;",
           "// past the end of a cave's string the player stands still."]
    for k, s in enumerate(SCRIPT):
        out.append(f'static const char script{k}[] = "{s}";')
    out.append(f"static const char * const script_for[{len(SCRIPT)}] = {{ " +
               ", ".join(f"script{k}" for k in range(len(SCRIPT))) + " };")
    out.append(f"#define SCRIPT_CAVES {len(SCRIPT)}")
    out.append(f"#define LIVES_AUTOPILOT {LIVES_AUTOPILOT}")
    out.append(f'#define NAME_AUTOPILOT "{NAME_AUTOPILOT}"')
    out.append("// What the rules model says the program must hold at game over.")
    out.append(f"#define EXPECT_FOLD 0x{result['fold']:04x}")
    out.append(f"#define EXPECT_SCORE {result['score']}UL")
    out.append(f"#define EXPECT_GEMS {result['gems']}")
    out.append(f"#define EXPECT_CAVE {result['cave']}")
    out.append(f"#define EXPECT_PLAY_FRAMES {result['frames']}")
    open(path, "w").write("\n".join(out) + "\n")


def write_notes(path):
    """SID frequency words for notes 0..59 (C1 up), A4 = 440 Hz, PAL and NTSC clocks."""
    clocks = {"pal": 985248, "ntsc": 1022727}
    out = ["// gen_notes.h: written by tools/gen.py. Note n is C1 + n semitones; A4 = 440 Hz.",
           "// Frequency word = Hz * 16777216 / clock (PAL 985,248 Hz; NTSC 1,022,727 Hz)."]
    for model, clk in clocks.items():
        words = []
        for n in range(60):
            hz = 440.0 * 2 ** ((n - 45) / 12)      # n = 45 is A4 (C1 + 45 semitones)
            words.append(min(0xffff, round(hz * 16777216 / clk)))
        out.append(f"static const unsigned note_{model}[60] = {{")
        for k in range(0, 60, 12):
            out.append("    " + ", ".join(f"0x{w:04x}" for w in words[k:k + 12]) + ",")
        out.append("};")
    open(path, "w").write("\n".join(out) + "\n")


def show(cells):
    rev = {v: k for k, v in LEGEND.items()}
    for y in range(H):
        row = ""
        for x in range(W):
            v = cells[y * W + x] & 0x7f
            if SPARK <= v < MOTH:
                row += 'f'
            elif MOTH <= v < BLAST:
                row += 'm'
            elif v >= BLAST:
                row += '%'
            elif v == EXIT_OPEN:
                row += 'x'
            else:
                row += rev.get(v, '?')
        print(row)


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    src = os.path.join(here, "..", "src")
    r = play()
    if "--show" in sys.argv:
        show(r["cells"])
    total = write_caves(os.path.join(src, "gen_caves.h"))
    write_autopilot(os.path.join(src, "gen_autopilot.h"), r)
    write_notes(os.path.join(src, "gen_notes.h"))
    print(f"gen: {len(CAVES)} caves, {total} bytes packed; autopilot: score {r['score']}, gems {r['gems']}, "
          f"died in cave {r['cave'] + 1}, {r['frames']} play frames, fold 0x{r['fold']:04x}")
    if r["frames"] > 255:
        print("gen: more than 255 play frames: the meter records the first 255 only")
