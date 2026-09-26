#!/usr/bin/env python3
"""mkassets.py: FIREBASE's jungle character set, attribute table, raw row map
and soldier sprites, generated from this file alone. Deterministic: the same
source gives the same bytes (no clock, no randomness but the LFSR below).

    python3 tools/mkassets.py            # writes src/gen/*.bin and src/gen/assets.h
    python3 tools/mkassets.py --preview build/preview   # also PNGs of the map and sprites (needs PIL)

Outputs (all committed, so a build needs no Python):
    src/gen/charset.bin  2,048 bytes: glyphs 64-255 drawn here; 0-63 are
                         left zero and copied from the character ROM at start-up
                         (display.c), so text reads as the ROM's letters
    src/gen/attr.bin     256 bytes: attr[screen code] (char_attribute_flags)
    src/gen/map.bin      MAP_ROWS x 40 screen codes, row 0 at the top (row_map_redraw)
    src/gen/sprites.bin  64-byte sprite blocks: the soldier's 8 directions x 4 walk
                         frames, then a blank block (sprite_slot_parking), then the
                         enemies (rifleman, runner, grenadier), the enemy bullet,
                         the enemy grenade's three sizes, its blast and a hit's dust
    src/gen/logo.bin     the title logo's cells (make_logo)
    src/gen/assets.h     the codes, sizes and positions C needs

Colours (multicolour characters, one colour RAM value for every playfield cell):
    00 $D021 brown (9) earth   01 $D022 light green (13)   10 $D023 black (0)
    11 colour RAM 5 green (colour RAM $0D)
The VIC treats %01 as background for sprite priority (c64-kb techniques/sprite.md,
mob_priority), so the canopy covers the soldier with its green and black pixels
and shows him through its light-green ones.
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.join(HERE, "..", "src", "gen")

MAP_ROWS = 96          # 3,840 bytes at $9000-$9EFF; attr at $9F00
COLS = 40

# ---- attribute bits (char_attribute_flags) ----------------------------------
A_BLOCK = 0x01         # stops a walker (and, later, a bullet)
A_BEHIND = 0x02        # a sprite whose probe is on it goes behind the playfield
A_DEADLY = 0x04        # kills (reserved: no glyph uses it yet)

# ---- glyph codes ----------------------------------------------------------------
G_FLOOR = 64
G_GRASS_A, G_GRASS_B, G_PEBBLES, G_ROOTS = 65, 66, 67, 68
G_CANOPY = 72          # 4 x 3 cells, 72-83
G_TRUNK = 84           # 1 cell, under the canopy's third column
G_BUSH = 86            # 2 x 2 cells, 86-89
G_ROCK = 90            # 2 x 2 cells, 90-93
G_BAG_L, G_BAG_M, G_BAG_R = 94, 95, 96     # sandbag wall, 1 row
G_FORT = 100           # fort wall, 2 x 2 repeating, 100-103
G_POST = 104           # gate posts, 1 x 2 each: 104-105 left, 106-107 right
G_GATE = 108           # the gate's opening, 4 x 2 cells, 108-115 (no flags)
G_SOLID = 255          # every pixel set: the title logo's block (front.c), hires cells

# MC pixel characters: '.' 00, 'g' 01, 'k' 10, 'G' 11
PIX = {".": 0, "g": 1, "k": 2, "G": 3}


def lfsr_seq(seed=0xACE1):
    """16-bit Galois LFSR, taps $B400: the only source of variation."""
    s = seed
    while True:
        lsb = s & 1
        s >>= 1
        if lsb:
            s ^= 0xB400
        yield s


def glyph_from_rows(rows):
    """8 strings of 4 MC pixels -> 8 bytes."""
    assert len(rows) == 8 and all(len(r) == 4 for r in rows), rows
    out = []
    for r in rows:
        b = 0
        for ch in r:
            b = (b << 2) | PIX[ch]
        out.append(b)
    return out


def canvas(w, h, fill="."):
    return [[fill] * w for _ in range(h)]


def slice_canvas(cv, cw, ch):
    """A canvas of cw*4 x ch*8 MC pixels -> cw*ch glyphs, row by row."""
    gl = []
    for cy in range(ch):
        for cx in range(cw):
            rows = ["".join(cv[cy * 8 + y][cx * 4:cx * 4 + 4]) for y in range(8)]
            gl.append(glyph_from_rows(rows))
    return gl


def blob(cv, cx, cy, rx, ry, body="G", edge="k", light="g", holes=None):
    """An ellipse (in MC pixels, which are 2 hires pixels wide): body colour,
    a dark rim on the lower right, a light rim on the upper left."""
    h, w = len(cv), len(cv[0])
    inside = [[((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1.0
               for x in range(w)] for y in range(h)]
    for y in range(h):
        for x in range(w):
            if not inside[y][x]:
                continue
            c = body
            dn = y + 1 >= h or not inside[y + 1][x]
            rt = x + 1 >= w or not inside[y][x + 1]
            up = y == 0 or not inside[y - 1][x]
            lf = x == 0 or not inside[y][x - 1]
            if dn or rt:
                c = edge
            elif up or lf:
                c = light
            cv[y][x] = c
    if holes:
        for (x, y) in holes:
            if inside[y][x] and cv[y][x] == body:
                cv[y][x] = light


def make_charset():
    glyphs = {}
    glyphs[G_FLOOR] = glyph_from_rows(["...."] * 8)
    glyphs[G_GRASS_A] = glyph_from_rows(["....", "....", ".g..", "g.g.", "....", "....", "....", "...."])
    glyphs[G_GRASS_B] = glyph_from_rows(["....", "....", "....", "....", "..g.", ".g.g", "....", "...."])
    glyphs[G_PEBBLES] = glyph_from_rows(["....", ".k..", "....", "....", "....", "...k", "....", "...."])
    glyphs[G_ROOTS] = glyph_from_rows(["....", "g...", ".g..", "....", "....", "..g.", "...g", "...."])

    glyphs[G_SOLID] = [0xFF] * 8   # the logo's block: foreground in a hires cell

    # Tree canopy: 16 x 24 MC pixels, with light holes the soldier shows through.
    cv = canvas(16, 24)
    holes = [(4, 6), (9, 4), (12, 9), (6, 12), (10, 15), (3, 16), (8, 19), (13, 13), (5, 9)]
    blob(cv, 8.0, 12.0, 8.6, 12.6, holes=holes)
    for i, g in enumerate(slice_canvas(cv, 4, 3)):
        glyphs[G_CANOPY + i] = g
    # Trunk: one cell under the canopy's third column.
    glyphs[G_TRUNK] = glyph_from_rows(["kGGk", "kGGk", "kGGk", "kGGk", "kGGk", "GGGG", "k..k", "...."])
    # Bush: 8 x 16, no flags.
    cv = canvas(8, 16)
    blob(cv, 4.0, 8.5, 3.8, 6.8, holes=[(2, 6), (5, 10)])
    for i, g in enumerate(slice_canvas(cv, 2, 2)):
        glyphs[G_BUSH + i] = g
    # Rock: 8 x 16, blocks.
    cv = canvas(8, 16)
    blob(cv, 4.0, 8.0, 3.9, 7.2, body="k", edge="k", light="g")
    for i, g in enumerate(slice_canvas(cv, 2, 2)):
        glyphs[G_ROCK + i] = g
    # Sandbag wall: rounded bags, two courses.
    glyphs[G_BAG_L] = glyph_from_rows([".kkk", "kGGG", "kGGG", ".kkk", ".kkk", "kGGG", "kGGG", ".kkk"])
    glyphs[G_BAG_M] = glyph_from_rows(["kkkk", "GGgk", "GGGk", "kkkk", "kkkk", "gkGG", "GkGG", "kkkk"])
    glyphs[G_BAG_R] = glyph_from_rows(["kkk.", "GGGk", "GGGk", "kkk.", "kkk.", "GGGk", "GGGk", "kkk."])
    # Fort wall: stone blocks, 2 x 2 cells repeating.
    fort = ["kkkkkkkk",
            "ggGGkggG",
            "gGGGkgGG",
            "GGGGkGGG",
            "kkkkkkkk",
            "kggGGkgg",
            "kgGGGkgG",
            "kGGGGkGG",
            "kkkkkkkk",
            "ggGGkggG",
            "gGGGkgGG",
            "GGGGkGGG",
            "kkkkkkkk",
            "kggGGkgg",
            "kgGGGkgG",
            "kkkkkkkk"]
    cv = [list(r) for r in fort]
    for i, g in enumerate(slice_canvas(cv, 2, 2)):
        glyphs[G_FORT + i] = g
    post_l = ["kkkk", "kggk", "kgGk", "kGGk", "kGGk", "kGGk", "kGGk", "kGGk",
              "kGGk", "kGGk", "kGGk", "kGGk", "kGGk", "kGGk", "kkkk", "kkkk"]
    for i in range(2):
        glyphs[G_POST + i] = glyph_from_rows(post_l[i * 8:i * 8 + 8])
        glyphs[G_POST + 2 + i] = glyph_from_rows(post_l[i * 8:i * 8 + 8])
    # Gate opening: a worn threshold in the earth, 4 x 2 cells.
    cv = canvas(16, 16)
    for x in range(16):
        cv[0][x] = "k"
        cv[15][x] = "k" if x % 3 else "."
    for y in range(2, 14, 3):
        for x in range(1 + y % 2, 15, 4):
            cv[y][x] = "g"
    for i, g in enumerate(slice_canvas(cv, 4, 2)):
        glyphs[G_GATE + i] = g

    data = bytearray(2048)
    for code, g in glyphs.items():
        data[code * 8:code * 8 + 8] = bytes(g)
    attr = bytearray(256)
    for c in range(G_CANOPY, G_CANOPY + 12):
        attr[c] = A_BEHIND
    for c in (G_TRUNK, G_BAG_L, G_BAG_M, G_BAG_R):
        attr[c] = A_BLOCK
    for c in range(G_ROCK, G_ROCK + 4):
        attr[c] = A_BLOCK
    for c in range(G_FORT, G_FORT + 4):
        attr[c] = A_BLOCK
    for c in range(G_POST, G_POST + 4):
        attr[c] = A_BLOCK
    return data, attr


# ---- the map ------------------------------------------------------------------
# Hand-placed features the autopilot walks through (main.c's script); the
# rest is scattered by the LFSR with a clear corridor kept free.
START_COL, START_ROW = 19, 91      # the soldier's feet at the start (map cells)
HAND = [
    ("bags", 82, 14, 12),           # a sandbag wall across the start column: the walk up stops here
    ("tree", 68, 27),               # a tree whose canopy the walk passes under (trunk to its right)
    ("rock", 76, 30),
    ("bush", 86, 8),
    ("tree", 84, 30),
]


def place(m, kind, row, col, arg=None):
    if kind == "tree":
        for y in range(3):
            for x in range(4):
                m[row + y][col + x] = G_CANOPY + y * 4 + x
        m[row + 3][col + 2] = G_TRUNK
    elif kind == "bush":
        for y in range(2):
            for x in range(2):
                m[row + y][col + x] = G_BUSH + y * 2 + x
    elif kind == "rock":
        for y in range(2):
            for x in range(2):
                m[row + y][col + x] = G_ROCK + y * 2 + x
    elif kind == "bags":
        n = arg
        m[row][col] = G_BAG_L
        for x in range(1, n - 1):
            m[row][col + x] = G_BAG_M
        m[row][col + n - 1] = G_BAG_R


def footprint(kind, arg=None):
    return {"tree": (4, 4), "bush": (2, 2), "rock": (2, 2), "bags": (1, arg or 1)}[kind]


def make_map():
    rnd = lfsr_seq()
    m = [[G_FLOOR] * COLS for _ in range(MAP_ROWS)]
    for y in range(MAP_ROWS):
        for x in range(COLS):
            r = next(rnd) & 31
            m[y][x] = {0: G_GRASS_A, 1: G_GRASS_B, 2: G_PEBBLES, 3: G_ROOTS}.get(r, G_FLOOR)
    used = [[False] * COLS for _ in range(MAP_ROWS)]

    def free(row, col, h, w):
        if row < 5 or row + h > MAP_ROWS or col < 0 or col + w > COLS:
            return False
        return all(not used[y][x] for y in range(row - 1, min(MAP_ROWS, row + h + 1))
                   for x in range(max(0, col - 1), min(COLS, col + w + 1)))

    def mark(row, col, h, w):
        for y in range(row, row + h):
            for x in range(col, col + w):
                used[y][x] = True

    # The fort at the top: its wall on rows 1-2, the gate in columns 18-21.
    for y in (1, 2):
        for x in range(COLS):
            m[y][x] = G_FORT + (y - 1) % 2 * 2 + x % 2
        m[y][17] = G_POST + (y - 1)
        m[y][22] = G_POST + 2 + (y - 1)
        for x in range(4):
            m[y][18 + x] = G_GATE + (y - 1) * 4 + x
    for y in range(0, 4):
        for x in range(COLS):
            used[y][x] = True
    # The start area stays clear.
    for y in range(START_ROW - 3, MAP_ROWS):
        for x in range(START_COL - 4, START_COL + 5):
            used[y][x] = True
    for kind, row, col, *rest in HAND:
        arg = rest[0] if rest else None
        h, w = footprint(kind, arg)
        place(m, kind, row, col, arg)
        mark(row, col, h, w)
    # The autopilot's walk up columns 27-28 from the sandbags to the canopy stays clear.
    mark(60, 26, 22, 4)
    # Scatter: rows 5-78, keep columns 17-22 as a corridor every 12 rows.
    kinds = ["tree", "tree", "tree", "bush", "bush", "rock", "bags"]
    for attempt in range(900):
        k = kinds[next(rnd) % len(kinds)]
        row = 5 + next(rnd) % 72
        col = next(rnd) % 38
        arg = 3 + next(rnd) % 6 if k == "bags" else None
        h, w = footprint(k, arg)
        if (row // 12) % 2 == 0 and col < 23 and col + w > 17:
            continue
        if free(row, col, h, w):
            place(m, k, row, col, arg)
            mark(row, col, h, w)
    return m


# ---- sprites: the soldier, 8 directions x 4 walk frames -------------------------
# Multicolour sprite pixel values: 00 clear, 01 $D025 black (outline, gun),
# 10 the sprite's colour (uniform), 11 $D026 light red (face, hands).
# Drawn on a 24 x 21 square grid, rotated per direction, then halved in X.
S_CLEAR, S_BLACK, S_UNIFORM, S_SKIN = 0, 1, 2, 3


def draw_soldier(direction, frame):
    ang = direction * math.pi / 4          # 0 up, clockwise
    fx, fy = math.sin(ang), -math.cos(ang)  # forward
    rx, ry = -fy, fx                         # right
    cx, cy = 12.0, 10.5
    step = [0.0, 2.2, 0.0, -2.2][frame]
    grid = [[S_CLEAR] * 24 for _ in range(21)]

    def local(x, y):
        """screen -> (right, forward) in body space"""
        dx, dy = x + 0.5 - cx, y + 0.5 - cy
        return dx * rx + dy * ry, dx * fx + dy * fy

    def disc(r0, f0, rad):
        for y in range(21):
            for x in range(24):
                r, f = local(x, y)
                if (r - r0) ** 2 + (f - f0) ** 2 <= rad * rad:
                    yield x, y

    def capsule(r0, f0, r1, f1, w):
        """Pixels within w of the segment (r0, f0)-(r1, f1), body space."""
        dr, df = r1 - r0, f1 - f0
        n = dr * dr + df * df
        for y in range(21):
            for x in range(24):
                r, f = local(x, y)
                t = max(0.0, min(1.0, ((r - r0) * dr + (f - f0) * df) / n))
                if (r - r0 - t * dr) ** 2 + (f - f0 - t * df) ** 2 <= w * w:
                    yield x, y

    def paint(points, colour):
        for (x, y) in points:
            grid[y][x] = colour

    # Legs behind the body, one forward and one back as he walks; black boots.
    paint(capsule(-1.9, -1.0, -1.9, -5.0 + step, 1.5), S_UNIFORM)
    paint(capsule(1.9, -1.0, 1.9, -5.0 - step, 1.5), S_UNIFORM)
    paint(disc(-1.9, -5.4 + step, 1.4), S_BLACK)
    paint(disc(1.9, -5.4 - step, 1.4), S_BLACK)
    # Shoulders and pack.
    for y in range(21):
        for x in range(24):
            r, f = local(x, y)
            if (r / 4.9) ** 2 + ((f - 0.2) / 2.5) ** 2 <= 1.0:
                grid[y][x] = S_UNIFORM
    # Arms forward to the gun, the gun along the facing, the hands on it.
    paint(capsule(3.6, 0.6, 2.2, 4.0, 1.2), S_UNIFORM)
    paint(capsule(-3.6, 0.6, 1.0, 5.6, 1.2), S_UNIFORM)
    paint(capsule(1.6, 1.5, 1.6, 10.2, 0.8), S_BLACK)
    paint(disc(2.1, 4.0, 1.1), S_SKIN)
    paint(disc(1.1, 5.8, 1.0), S_SKIN)
    # Helmet: a round top with a dark rim, so it reads apart from the shoulders.
    for y in range(21):
        for x in range(24):
            r, f = local(x, y)
            d = r * r + (f - 0.9) ** 2
            if d <= 2.5 ** 2:
                grid[y][x] = S_UNIFORM
            elif d <= 3.3 ** 2 and grid[y][x] == S_UNIFORM:
                grid[y][x] = S_BLACK
    # Halve X: a multicolour pixel takes the stronger of its two hires pixels.
    rank = {S_CLEAR: 0, S_UNIFORM: 1, S_SKIN: 2, S_BLACK: 3}
    mc = [[max(grid[y][2 * i], grid[y][2 * i + 1], key=lambda v: rank[v]) for i in range(12)]
          for y in range(21)]
    # Outline: a clear pixel next to the figure turns black.
    out = [row[:] for row in mc]
    for y in range(21):
        for x in range(12):
            if mc[y][x] != S_CLEAR:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < 12 and 0 <= ny < 21 and mc[ny][nx] in (S_UNIFORM, S_SKIN):
                    out[y][x] = S_BLACK
                    break
    block = bytearray(64)
    for y in range(21):
        for b in range(3):
            v = 0
            for k in range(4):
                v = (v << 2) | out[y][b * 4 + k]
            block[y * 3 + b] = v
    return block


# ---- sprites: enemies, their shots, grenades and blasts (objects.c) ------------
# Same pixel values as the soldier: 00 clear, 01 $D025 black, 10 the slot's
# colour, 11 $D026 light red. Each enemy is drawn in body space on a 24 x 21
# square grid (forward = the facing), then halved in X. Three figures, told
# apart by the head and what the hands hold: the rifleman wears a peaked cap
# and holds a long rifle across his body; the runner is bareheaded with empty
# swinging arms; the grenadier wears a banded helmet and carries a grenade,
# raised over his head in his throwing frame.
SPR_RIFLE = 33         # 8 directions x 2 step frames
SPR_RUNNER = 49        # 2 directions (right, left) x 2 step frames
SPR_GREN = 53          # 8 directions x 2 frames (carry, throw)
SPR_SHOT = 69          # the enemy bullet
SPR_NADE = 70          # the enemy grenade, 3 sizes (small, middle, large)
SPR_BLAST = 73         # 2 frames
SPR_DOWN = 75          # a hit enemy: a dust puff


def halve(grid, outline=True):
    """24 x 21 hires grid -> a 64-byte multicolour block (strongest pixel of
    each pair; clear pixels next to the figure turn black)."""
    rank = {S_CLEAR: 0, S_UNIFORM: 1, S_SKIN: 2, S_BLACK: 3}
    mc = [[max(grid[y][2 * i], grid[y][2 * i + 1], key=lambda v: rank[v]) for i in range(12)]
          for y in range(21)]
    out = [row[:] for row in mc]
    if outline:
        for y in range(21):
            for x in range(12):
                if mc[y][x] != S_CLEAR:
                    continue
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < 12 and 0 <= ny < 21 and mc[ny][nx] in (S_UNIFORM, S_SKIN):
                        out[y][x] = S_BLACK
                        break
    block = bytearray(64)
    for y in range(21):
        for b in range(3):
            v = 0
            for k in range(4):
                v = (v << 2) | out[y][b * 4 + k]
            block[y * 3 + b] = v
    return block


def draw_enemy(kind, direction, frame):
    ang = direction * math.pi / 4
    fx, fy = math.sin(ang), -math.cos(ang)
    rx, ry = -fy, fx
    cx, cy = 12.0, 10.5
    grid = [[S_CLEAR] * 24 for _ in range(21)]

    def local(x, y):
        dx, dy = x + 0.5 - cx, y + 0.5 - cy
        return dx * rx + dy * ry, dx * fx + dy * fy

    def fill(test, colour, only=None):
        for y in range(21):
            for x in range(24):
                r, f = local(x, y)
                if test(r, f) and (only is None or grid[y][x] == only):
                    grid[y][x] = colour

    def seg(r0, f0, r1, f1, w):
        dr, df = r1 - r0, f1 - f0
        n = dr * dr + df * df or 1.0

        def t(r, f):
            k = max(0.0, min(1.0, ((r - r0) * dr + (f - f0) * df) / n))
            return (r - r0 - k * dr) ** 2 + (f - f0 - k * df) ** 2 <= w * w
        return t

    def disc(r0, f0, rad):
        return lambda r, f: (r - r0) ** 2 + (f - f0) ** 2 <= rad * rad

    stride = {"rifle": 1.8, "runner": 3.2, "gren": 1.2}[kind]
    step = stride if frame == 0 else -stride
    if kind == "gren" and frame == 1:
        step = 0.0                              # planted to throw
    # Legs and boots.
    fill(seg(-1.8, -1.2, -1.8, -4.8 + step, 1.4), S_UNIFORM)
    fill(seg(1.8, -1.2, 1.8, -4.8 - step, 1.4), S_UNIFORM)
    fill(disc(-1.8, -5.2 + step, 1.3), S_BLACK)
    fill(disc(1.8, -5.2 - step, 1.3), S_BLACK)
    # Body: narrower than the soldier's pack-and-shoulders oval.
    fill(lambda r, f: (r / 4.6) ** 2 + ((f - 0.4) / 2.4) ** 2 <= 1.0, S_UNIFORM)
    if kind == "rifle":
        # Both arms forward to a rifle held across the body at an angle.
        fill(seg(3.4, 0.8, 1.8, 3.6, 1.1), S_UNIFORM)
        fill(seg(-3.4, 0.8, -1.2, 4.2, 1.1), S_UNIFORM)
        fill(seg(-2.6, 2.4, 3.2, 8.8, 0.8), S_BLACK)
        fill(disc(1.8, 3.8, 1.0), S_SKIN)
        fill(disc(-1.1, 4.4, 1.0), S_SKIN)
        # Peaked cap: a skin face under a flat cap whose brim points forward.
        fill(disc(0.0, 0.8, 2.3), S_SKIN)
        fill(lambda r, f: (r / 2.4) ** 2 + ((f - 0.2) / 2.0) ** 2 <= 1.0 and f < 1.4, S_UNIFORM)
        fill(lambda r, f: abs(r) <= 2.0 and 2.4 <= f <= 3.4, S_BLACK)
    elif kind == "runner":
        # Arms swing against the legs; nothing in the hands.
        fill(seg(3.8, 0.4, 3.8, 0.4 - step * 1.2, 1.1), S_UNIFORM)
        fill(seg(-3.8, 0.4, -3.8, 0.4 + step * 1.2, 1.1), S_UNIFORM)
        fill(disc(3.8, 0.4 - step * 1.4, 1.0), S_SKIN)
        fill(disc(-3.8, 0.4 + step * 1.4, 1.0), S_SKIN)
        # Bare head: skin, black hair on the back half.
        fill(disc(0.0, 1.0, 2.4), S_SKIN)
        fill(lambda r, f: r * r + (f - 1.0) ** 2 <= 2.4 ** 2 and f < 0.8, S_BLACK)
    else:
        if frame == 0:
            # Carrying: the grenade in the right hand, low at his side.
            fill(seg(3.6, 0.6, 4.2, 2.6, 1.1), S_UNIFORM)
            fill(seg(-3.6, 0.6, -3.0, 2.4, 1.1), S_UNIFORM)
            fill(disc(4.4, 3.4, 1.4), S_BLACK)
        else:
            # Throwing: the right arm raised forward over the head, the grenade in it.
            fill(seg(3.4, 0.8, 1.6, 6.6, 1.1), S_UNIFORM)
            fill(seg(-3.6, 0.6, -3.8, -1.6, 1.1), S_UNIFORM)
            fill(disc(1.4, 7.6, 1.5), S_BLACK)
        # Banded helmet: a round shell with a black band across it.
        fill(lambda r, f: r * r + (f - 0.8) ** 2 <= 2.9 ** 2, S_UNIFORM)
        fill(lambda r, f: r * r + (f - 0.8) ** 2 <= 2.9 ** 2 and abs(f - 0.8) <= 0.6, S_BLACK)
    return halve(grid)


def draw_round(rad, core, rim=True):
    """A ball centred on sprite pixel (12, 10): the slot's colour, a light-red
    core of radius `core`, a black rim."""
    grid = [[S_CLEAR] * 24 for _ in range(21)]
    for y in range(21):
        for x in range(24):
            d = math.hypot(x + 0.5 - 12.0, y + 0.5 - 10.5)
            if d <= core:
                grid[y][x] = S_SKIN
            elif d <= rad:
                grid[y][x] = S_UNIFORM
    return halve(grid, outline=rim)


def draw_blast(frame):
    """A starburst: light-red heart, the slot's colour (yellow) around it, black
    spikes; the second frame turned half a spike and wider."""
    grid = [[S_CLEAR] * 24 for _ in range(21)]
    spikes = 9
    turn = frame * math.pi / spikes
    for y in range(21):
        for x in range(24):
            dx, dy = x + 0.5 - 12.0, (y + 0.5 - 10.5) * 1.1
            d = math.hypot(dx, dy)
            a = math.atan2(dy, dx) + turn
            reach = (7.0 + 2.0 * frame) + (2.5 + frame) * math.cos(spikes * a)
            if d <= 2.2 + frame:
                grid[y][x] = S_SKIN
            elif d <= reach - 1.2:
                grid[y][x] = S_UNIFORM
            elif d <= reach:
                grid[y][x] = S_BLACK
    return halve(grid, outline=False)


def draw_down():
    """A hit enemy: three dust puffs in the slot's colour over black grit."""
    grid = [[S_CLEAR] * 24 for _ in range(21)]
    for (px, py, r) in ((9.0, 12.0, 4.2), (15.0, 11.0, 3.6), (12.0, 7.5, 3.4)):
        for y in range(21):
            for x in range(24):
                if math.hypot(x + 0.5 - px, y + 0.5 - py) <= r:
                    grid[y][x] = S_UNIFORM
    rnd = lfsr_seq(0x5EED)
    for _ in range(14):
        x, y = next(rnd) % 22 + 1, next(rnd) % 17 + 2
        if grid[y][x] == S_CLEAR:
            grid[y][x] = S_BLACK
    return halve(grid)


def make_sprites():
    data = bytearray()
    for d in range(8):
        for f in range(4):
            data += draw_soldier(d, f)
    data += bytearray(64)                       # the parking block: all zero
    assert len(data) // 64 == SPR_RIFLE
    for d in range(8):
        for f in range(2):
            data += draw_enemy("rifle", d, f)
    for d in (2, 6):
        for f in range(2):
            data += draw_enemy("runner", d, f)
    for d in range(8):
        for f in range(2):
            data += draw_enemy("gren", d, f)
    assert len(data) // 64 == SPR_SHOT
    data += draw_round(2.6, 1.0, rim=False)
    for rad in (2.2, 3.2, 4.2):
        data += draw_round(rad, 0.8)
    for f in range(2):
        data += draw_blast(f)
    data += draw_down()
    assert len(data) // 64 == SPR_DOWN + 1
    return data


def write_header(path, n_blocks):
    lines = [
        "// assets.h: written by tools/mkassets.py. Do not edit; change the tool and re-run it.",
        "#ifndef ASSETS_H",
        "#define ASSETS_H",
        f"#define MAP_ROWS     {MAP_ROWS}",
        f"#define A_BLOCK      0x{A_BLOCK:02x}   // attr bit 0: stops a walker",
        f"#define A_BEHIND     0x{A_BEHIND:02x}   // attr bit 1: the sprite goes behind",
        f"#define A_DEADLY     0x{A_DEADLY:02x}   // attr bit 2: kills (reserved)",
        f"#define G_FLOOR      {G_FLOOR}",
        f"#define G_CANOPY     {G_CANOPY}   // 12 codes, 4 x 3",
        f"#define G_TRUNK      {G_TRUNK}",
        f"#define G_GATE       {G_GATE}  // the fort's gate opening, 4 x 2, map rows 1-2, columns 18-21",
        f"#define START_COL    {START_COL}   // the soldier's feet at the start, map cells",
        f"#define START_ROW    {START_ROW}",
        f"#define SPR_SOLDIER  0    // block offset: direction * 4 + walk frame",
        f"#define SPR_BLANK    32   // the parking block (all zero)",
        f"#define SPR_RIFLE    {SPR_RIFLE}   // rifleman: direction (0 up, clockwise) * 2 + step frame",
        f"#define SPR_RUNNER   {SPR_RUNNER}   // runner: (0 right, 1 left) * 2 + step frame",
        f"#define SPR_GREN     {SPR_GREN}   // grenadier: direction * 2 + (0 carry, 1 throw)",
        f"#define SPR_SHOT     {SPR_SHOT}   // enemy bullet, centred on sprite pixel (12, 10)",
        f"#define SPR_NADE     {SPR_NADE}   // enemy grenade: small, middle, large",
        f"#define SPR_BLAST    {SPR_BLAST}   // grenade blast, 2 frames",
        f"#define SPR_DOWN     {SPR_DOWN}   // a hit enemy's dust",
        f"#define SPR_BLOCKS   {n_blocks}",
        f"#define G_SOLID      {G_SOLID}  // every pixel set: the logo's block",
        f"#define LOGO_W       {LOGO_W}   // logo.bin: LOGO_H rows of LOGO_W, 0 empty 1 letter 2 shadow",
        f"#define LOGO_H       {LOGO_H}",
        "#endif",
        "",
    ]
    open(path, "w").write("\n".join(lines))


# ---- the title logo ---------------------------------------------------------------
# FIREBASE in a 3 x 5 block font of G_SOLID cells, one column between letters,
# with a drop shadow one cell right and one down. logo.bin holds LOGO_H rows of
# LOGO_W bytes: 0 empty, 1 letter, 2 shadow; front.c draws 1 in its row's colour
# and 2 in black. Drawn here, not taken from any game.
LOGO_FONT = {
    "F": ["###", "#..", "##.", "#..", "#.."],
    "I": ["###", ".#.", ".#.", ".#.", "###"],
    "R": ["##.", "#.#", "##.", "#.#", "#.#"],
    "E": ["###", "#..", "##.", "#..", "###"],
    "B": ["##.", "#.#", "##.", "#.#", "##."],
    "A": [".#.", "#.#", "###", "#.#", "#.#"],
    "S": [".##", "#..", ".#.", "..#", "##."],
}
LOGO_TEXT = "FIREBASE"
LOGO_W = 4 * len(LOGO_TEXT)        # 3 columns a letter, 1 between, and the shadow's column
LOGO_H = 6                         # 5 rows and the shadow's row


def make_logo():
    grid = [[0] * LOGO_W for _ in range(LOGO_H)]
    for i, ch in enumerate(LOGO_TEXT):
        for y, row in enumerate(LOGO_FONT[ch]):
            for x, px in enumerate(row):
                if px == "#":
                    grid[y][4 * i + x] = 1
    for y in range(LOGO_H - 1, 0, -1):
        for x in range(LOGO_W - 1, 0, -1):
            if grid[y][x] == 0 and grid[y - 1][x - 1] == 1:
                grid[y][x] = 2
    return bytes(v for row in grid for v in row)


def preview(outdir, charset, m, sprites):
    from PIL import Image
    pal = {0: (0x70, 0x50, 0x20), 1: (0xa3, 0xe0, 0x7e), 2: (0, 0, 0), 3: (0x51, 0xa2, 0x4b)}
    img = Image.new("RGB", (COLS * 8, MAP_ROWS * 8))
    px = img.load()
    for r in range(MAP_ROWS):
        for c in range(COLS):
            g = charset[m[r][c] * 8:m[r][c] * 8 + 8]
            for y in range(8):
                for k in range(4):
                    v = (g[y] >> (6 - 2 * k)) & 3
                    px[c * 8 + 2 * k, r * 8 + y] = pal[v]
                    px[c * 8 + 2 * k + 1, r * 8 + y] = pal[v]
    os.makedirs(outdir, exist_ok=True)
    img.resize((COLS * 16, MAP_ROWS * 16), Image.NEAREST).save(os.path.join(outdir, "map.png"))
    spal = {0: (0x70, 0x50, 0x20), 1: (0, 0, 0), 2: (255, 255, 255), 3: (0xff, 0x77, 0x77)}
    sim = Image.new("RGB", (4 * 26, 8 * 23))
    sp = sim.load()
    for d in range(8):
        for f in range(4):
            blk = sprites[(d * 4 + f) * 64:(d * 4 + f) * 64 + 64]
            for y in range(21):
                for x in range(12):
                    v = (blk[y * 3 + x // 4] >> (6 - 2 * (x % 4))) & 3
                    sp[f * 26 + 2 * x, d * 23 + y] = spal[v]
                    sp[f * 26 + 2 * x + 1, d * 23 + y] = spal[v]
    sim.resize((sim.width * 4, sim.height * 4), Image.NEAREST).save(os.path.join(outdir, "sprites.png"))
    # Every block after the parking block, 8 to a row: enemies, shot, grenades, blasts, dust.
    first = SPR_RIFLE
    n = len(sprites) // 64 - first
    eim = Image.new("RGB", (8 * 26, (n + 7) // 8 * 23))
    ep = eim.load()
    for k in range(n):
        blk = sprites[(first + k) * 64:(first + k) * 64 + 64]
        ox, oy = k % 8 * 26, k // 8 * 23
        for y in range(21):
            for x in range(12):
                v = (blk[y * 3 + x // 4] >> (6 - 2 * (x % 4))) & 3
                ep[ox + 2 * x, oy + y] = spal[v]
                ep[ox + 2 * x + 1, oy + y] = spal[v]
    eim.resize((eim.width * 4, eim.height * 4), Image.NEAREST).save(os.path.join(outdir, "enemies.png"))


def main():
    charset, attr = make_charset()
    m = make_map()
    sprites = make_sprites()
    os.makedirs(GEN, exist_ok=True)
    open(os.path.join(GEN, "charset.bin"), "wb").write(charset)
    open(os.path.join(GEN, "attr.bin"), "wb").write(attr)
    open(os.path.join(GEN, "map.bin"), "wb").write(bytes(v for row in m for v in row))
    open(os.path.join(GEN, "sprites.bin"), "wb").write(sprites)
    open(os.path.join(GEN, "logo.bin"), "wb").write(make_logo())
    write_header(os.path.join(GEN, "assets.h"), len(sprites) // 64)
    if "--preview" in sys.argv:
        preview(sys.argv[sys.argv.index("--preview") + 1], charset, m, sprites)
    print(f"mkassets: charset 2048, attr 256, map {MAP_ROWS}x{COLS}, sprites {len(sprites) // 64} blocks")


if __name__ == "__main__":
    main()
