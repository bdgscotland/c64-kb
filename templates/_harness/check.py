#!/usr/bin/env python3
"""Grade a starter's exit screenshots against the expectations it declares.

usage: check.py expect.json pal.png ntsc.png

Exit 0 when every check passes on every model it names, 1 when any fails
(each failure is a line starting "FAIL" that names the check), 2 when it
refuses to grade: a usage error, a setup error, a fault in expect.json, or a
picture from another palette (named, before any grading). A refusal prints
one line starting "FAIL REFUSED" on stdout, so a caller that greps for FAIL
still sees it; test the exit code, never the text: 0 passed, 1 failed, 2
nothing was graded. (An earlier version printed refusals on stderr only,
and a caller's loop that grepped stdout for FAIL graded five refused files
as five passes.)

Geometry and palette are the ones measured in c64-kb's
docs/runtime/vice-reference.md, "Reading the exit screenshot" (VICE x64sc
3.10, -default): PAL 384 x 272, screenshot row = raster line - 16; NTSC
(-model ntsc) 384 x 247, row = line - 28, and NTSC lines 0-11 land on rows
235-246. Screenshot x = VIC-II X coordinate + 8 (sprite X 24 is display
column 32). Text cell (row r, column c) starts at x = 32 + 8c, y = 35 + 8r
(PAL) or 23 + 8r (NTSC). Colours are matched by exact triple against the
sixteen per model; another VICE version or palette will not match.
PAL is -default's machine: `-model pal` selects a 6569R3 with its own
palette (measured: border green (94, 214, 56), not (98, 213, 50)). A shot
taken that way is refused by name, not graded colour by colour; do not
pass `-model pal`.

expect.json:
  {
    "checks": [
      {"name": "...", "type": "<type>", "models": ["pal", "ntsc"], ...},
      ...
    ]
  }
At least one check, and one of type "verdict", are required, unless the
file says "mid_run": true: a pin taken inside a run, before the program can
have reached its verdict, is graded on its other checks. "models"
defaults to both. A point is one of
    "x", "y"          screenshot pixels
    "vic_x", "line"   VIC-II X coordinate and raster line. A sprite whose X and Y
                      registers are (sx, sy) covers vic_x sx to sx + 23 and lines
                      sy + 1 to sy + 21 (measured by templates/hello, PAL and NTSC)
    "row", "col"      the centre of a text cell
and an area is {"vic_x", "line", "width", "height"}. Every point and area
must lie inside the picture on each model the check names.
Types:
  verdict  border colour index 5 (the program's own PASS); index 2 is FAIL,
           anything else means the program never reached its verdict.
           Optional "at": [x, y] (default the border sample point [2, 100]).
  pixel    a point, "colour": the colour index there.
  rect     an area, "colour": every pixel of it has that colour (a raster
           bar, a span of one line with "height": 1).
  sprite   an area, "colour": the pixels of that colour inside "search" (an
           area; default the expected box grown by 16 pixels each way) have
           exactly that bounding box.
  ink      an area, "min": at least that many pixels of the area are not the
           "background" colour index (default 0); optional "max" bounds them
           from above and "colours" lists the only indices they may take.
           For things drawn somewhere in an area but at no fixed place
           (orbiting sprites), where a box would pin one phase: choose "min"
           from the smallest count over every phase. Taken from the
           MEASURED demo's copy of this harness, where it caught a fault
           that removed five of six balls and every other check passed.
  text     "row", "col", "text": the cells decode to that text (upper case).
           Optional "dy" (0-7): the rows sit that many pixels below the
           YSCROLL-3 grid, as a panel under a scrolled playfield does (a
           panel starting on line 55 + 8k has YSCROLL 7: "dy": 4).
  same     "cells": [row0, col0, row1, col1] inclusive, or "area": every pixel
           has the same colour index on PAL and NTSC.
  meter    "row", "col": the frame meter's readout "F00000 W00000 T00000".
           Optional "dy" as for text.
           Optional "frames" (exact count recorded), "max_worst" (cycles;
           default one frame: 19,656 PAL / 17,095 NTSC), "min_typical"
           (default 1: the meter has finished recording). Prints the figures.
text and meter decode through a character set: the power-on upper-case ROM
set by default, "charset": "rom-lower" for the ROM's lower-case set, or
"charset": "<file>" (relative to expect.json) holding 2,048 bytes of glyphs,
with or without a two-byte load address. The meter's cells need glyphs for
0-9, F, W and T at their screen codes in whatever set the program shows.
A cell's ink is every pixel that is not the cell's majority colour; hires
cells only (a multicolour cell does not decode).
"""
import json
import os
import re
import sys

try:
    from PIL import Image
except ImportError:
    print("FAIL REFUSED check.py needs Pillow: python3 -m pip install pillow (exit 2: nothing was graded)")
    print("check.py needs Pillow: python3 -m pip install pillow", file=sys.stderr)
    sys.exit(2)

# docs/runtime/vice-reference.md, "The default palette".
PALETTE = {
    "pal": [
        (0, 0, 0), (255, 255, 255), (175, 60, 88), (126, 243, 214),
        (170, 64, 245), (98, 213, 50), (44, 61, 236), (255, 255, 70),
        (183, 99, 30), (119, 83, 0), (238, 123, 149), (98, 98, 98),
        (148, 148, 148), (183, 255, 134), (115, 133, 255), (205, 205, 205),
    ],
    "ntsc": [
        (0, 0, 0), (255, 255, 255), (169, 71, 100), (138, 230, 203),
        (154, 88, 185), (114, 189, 103), (25, 73, 180), (255, 248, 141),
        (196, 98, 65), (151, 64, 0), (230, 134, 163), (98, 98, 98),
        (148, 148, 148), (198, 255, 186), (98, 145, 251), (205, 205, 205),
    ],
}
# VICE 3.10's `-model pal` (6569R3) palette, measured with the palette-cells
# recipe: a shot in it is refused (see the docstring). Indices whose triple is
# the same in both palettes (0, 1, 11, 12, 15) cannot tell them apart.
PALETTE_MODEL_PAL = [
    (0, 0, 0), (255, 255, 255), (171, 60, 101), (135, 240, 203),
    (178, 61, 239), (94, 214, 56), (58, 49, 255), (255, 255, 59),
    (183, 100, 24), (129, 76, 0), (234, 121, 163), (98, 98, 98),
    (148, 148, 148), (178, 255, 141), (129, 120, 255), (205, 205, 205),
]
# docs/runtime/vice-reference.md, "Geometry".
GEOMETRY = {
    "pal": {"size": (384, 272), "line_offset": 16, "lines": 312, "text_y0": 35, "frame_cycles": 19656},
    "ntsc": {"size": (384, 247), "line_offset": 28, "lines": 263, "text_y0": 23, "frame_cycles": 17095},
}
TEXT_X0 = 32
BORDER_SAMPLE = (2, 100)
NAMES = ["black", "white", "red", "cyan", "purple", "green", "blue", "yellow", "orange",
         "brown", "light red", "dark grey", "grey", "light green", "light blue", "light grey"]

CHARGEN_PATHS = [
    os.environ.get("C64_CHARGEN", ""),
    # The data directory of c64-kb's own headless VICE (npm run vice:headless),
    # the only copy on a CI runner.
    os.path.join(os.environ.get("C64KB", "/nonexistent"), ".tools/vice-headless/data/C64/chargen-901225-01.bin"),
    "/opt/homebrew/opt/vice/share/vice/C64/chargen-901225-01.bin",
    "/usr/local/share/vice/C64/chargen-901225-01.bin",
    "/usr/share/vice/C64/chargen-901225-01.bin",
    "/usr/lib/vice/C64/chargen-901225-01.bin",
    "/usr/share/vice/C64/chargen",
]
REQUIRED = {
    "verdict": [], "pixel": ["colour"], "rect": ["colour"], "sprite": ["colour"], "ink": ["min"],
    "text": ["row", "col", "text"], "same": [], "meter": ["row", "col"],
}
AREA_KEYS = ("vic_x", "line", "width", "height")


class SpecError(Exception):
    pass


class Refused(Exception):
    pass


# ---- geometry, shared by validation and grading ------------------------------
def point_xy(c: dict, model: str):
    g = GEOMETRY[model]
    if "vic_x" in c:
        return c["vic_x"] + 8, (c["line"] - g["line_offset"]) % g["lines"]
    if "row" in c:
        return TEXT_X0 + 8 * c["col"] + 4, g["text_y0"] + 8 * c["row"] + 4
    return c["x"], c["y"]


def area_box(a: dict, model: str):
    """(x0, y0, x1, y1) inclusive in screenshot pixels."""
    x0, y0 = point_xy({"vic_x": a["vic_x"], "line": a["line"]}, model)
    return x0, y0, x0 + a["width"] - 1, y0 + a["height"] - 1


def cells_box(cells, model: str, dy: int = 0):
    r0, c0, r1, c1 = cells
    y0 = GEOMETRY[model]["text_y0"] + dy
    return TEXT_X0 + 8 * c0, y0 + 8 * r0, TEXT_X0 + 8 * c1 + 7, y0 + 8 * r1 + 7


def inside(box, model: str) -> bool:
    w, h = GEOMETRY[model]["size"]
    x0, y0, x1, y1 = box
    return 0 <= x0 <= x1 < w and 0 <= y0 <= y1 < h


# ---- expect.json validation ------------------------------------------------------
def need_int(c, keys, name):
    for k in keys:
        if not isinstance(c.get(k), int):
            raise SpecError(f"check '{name}': '{k}' must be a whole number")


def point_form(c, name):
    for keys in (("vic_x", "line"), ("row", "col"), ("x", "y")):
        if keys[0] in c:
            need_int(c, keys, name)
            return
    raise SpecError(f"check '{name}': needs a point: x/y, vic_x/line or row/col")


def area_of(c, name, key=None):
    a = c.get(key) if key else c
    if not isinstance(a, dict):
        raise SpecError(f"check '{name}': '{key}' must be an area {{vic_x, line, width, height}}")
    need_int(a, AREA_KEYS, name)
    if a["width"] < 1 or a["height"] < 1:
        raise SpecError(f"check '{name}': width and height must be at least 1")
    return a


def boxes_for(c, name):
    """Every screenshot box the check reads, as a function of the model."""
    t = c["type"]
    if t == "verdict":
        x, y = c.get("at", BORDER_SAMPLE)
        return lambda m: (x, y, x, y)
    if t == "pixel":
        point_form(c, name)
        return lambda m: point_xy(c, m) * 2
    if t in ("rect", "sprite", "ink"):
        a = area_of(c, name)
        return lambda m: area_box(a, m)
    if t in ("text", "meter"):
        need_int(c, ("row", "col"), name)
        dy = c.get("dy", 0)
        if not isinstance(dy, int) or not 0 <= dy <= 7:
            raise SpecError(f"check '{name}': 'dy' must be a whole number from 0 to 7")
        n = 20 if t == "meter" else len(c["text"])
        return lambda m: cells_box([c["row"], c["col"], c["row"], c["col"] + n - 1], m, dy)
    if "area" in c:
        a = area_of(c, name, "area")
        return lambda m: area_box(a, m)
    cells = c.get("cells")
    if not (isinstance(cells, list) and len(cells) == 4 and all(isinstance(v, int) for v in cells)):
        raise SpecError(f"check '{name}': 'same' needs \"cells\": [row0, col0, row1, col1] or an \"area\"")
    return lambda m: cells_box(cells, m)


def validate(spec) -> None:
    checks = spec.get("checks") if isinstance(spec, dict) else None
    if not isinstance(checks, list) or not checks:
        raise SpecError("expect.json has no checks")
    if not spec.get("mid_run") and not any(isinstance(c, dict) and c.get("type") == "verdict" for c in checks):
        raise SpecError("expect.json has no 'verdict' check: the program's own grade must be read "
                        "(a pin inside a run says \"mid_run\": true)")
    for i, c in enumerate(checks):
        name = c.get("name", f"#{i}") if isinstance(c, dict) else f"#{i}"
        if not isinstance(c, dict) or c.get("type") not in REQUIRED:
            raise SpecError(f"check '{name}': type must be one of {', '.join(REQUIRED)}")
        for k in REQUIRED[c["type"]]:
            if k not in c:
                raise SpecError(f"check '{name}': missing '{k}'")
        if "colour" in c and not (isinstance(c["colour"], int) and 0 <= c["colour"] <= 15):
            raise SpecError(f"check '{name}': 'colour' must be a colour index 0 to 15")
        if c["type"] == "ink":
            validate_ink(c, name)
        models = c.get("models", ["pal", "ntsc"])
        if not models or any(m not in GEOMETRY for m in models):
            raise SpecError(f"check '{name}': 'models' must list pal and/or ntsc")
        box = boxes_for(c, name)
        for m in (["pal", "ntsc"] if c["type"] == "same" else models):
            if not inside(box(m), m):
                raise SpecError(f"check '{name}': {box(m)} is outside the {m.upper()} picture")
        if c["type"] == "sprite" and "search" in c:
            s = area_of(c, name, "search")
            for m in models:
                if not inside(area_box(s, m), m):
                    raise SpecError(f"check '{name}': the search area is outside the {m.upper()} picture")


def validate_ink(c, name):
    need_int(c, ["min"] + (["max"] if "max" in c else []), name)
    if "background" in c and not (isinstance(c["background"], int) and 0 <= c["background"] <= 15):
        raise SpecError(f"check '{name}': 'background' must be a colour index 0 to 15")
    cols = c.get("colours", [])
    if not (isinstance(cols, list) and all(isinstance(v, int) and 0 <= v <= 15 for v in cols)):
        raise SpecError(f"check '{name}': 'colours' must be a list of colour indices 0 to 15")


# ---- pictures and glyphs -------------------------------------------------------------
class Shot:
    def __init__(self, path: str, model: str):
        self.path, self.model = path, model
        im = Image.open(path).convert("RGB")
        g = GEOMETRY[model]
        if im.size != g["size"]:
            raise Refused(f"{path} is {im.size[0]} x {im.size[1]}, not a {model.upper()} "
                          f"exit screenshot ({g['size'][0]} x {g['size'][1]})")
        self.px, self.g = im.load(), g
        self.lookup = {rgb: i for i, rgb in enumerate(PALETTE[model])}
        if model == "pal":
            self.refuse_model_pal(im)

    def refuse_model_pal(self, im):
        """A picture in the -model pal palette and none of -default's own colours is refused."""
        only_r3 = set(PALETTE_MODEL_PAL) - set(PALETTE["pal"])
        only_default = set(PALETTE["pal"]) - set(PALETTE_MODEL_PAL)
        seen = {rgb for _, rgb in im.getcolors(im.size[0] * im.size[1])}
        if seen & only_r3 and not seen & only_default:
            raise Refused(f"{self.path} is in VICE's -model pal (6569R3) palette, not the one -default's PAL "
                          "machine draws; shoot it without -model pal")

    def index(self, x: int, y: int):
        return self.lookup.get(self.px[x, y])

    def cell_pattern(self, row: int, col: int, dy: int = 0):
        """The cell's 8 rows as bytes: ink is any pixel not the cell's majority colour."""
        x0, y0 = TEXT_X0 + 8 * col, self.g["text_y0"] + 8 * row + dy
        pix = [[self.px[x0 + xx, y0 + yy] for xx in range(8)] for yy in range(8)]
        flat = [p for r in pix for p in r]
        bg = max(set(flat), key=flat.count)
        return tuple(sum((pix[yy][xx] != bg) << (7 - xx) for xx in range(8)) for yy in range(8))


def rom_path():
    return next((p for p in CHARGEN_PATHS if p and os.path.isfile(p)), None)


def load_glyphs(charset=None, base="."):
    """Pattern -> screen code for the named set; None when it cannot be read."""
    if charset in (None, "rom-upper", "rom-lower"):
        p = rom_path()
        if p is None:
            return None
        data = open(p, "rb").read()[(2048 if charset == "rom-lower" else 0):][:2048]
    else:
        p = os.path.join(base, charset)
        if not os.path.isfile(p):
            return None
        data = open(p, "rb").read()
        if len(data) % 256 == 2:        # a PRG-style load address
            data = data[2:]
        data = data[:2048]
    glyph = {}
    for code in range(len(data) // 8):  # first code wins: $20 over $60 for blank
        glyph.setdefault(tuple(data[code * 8:code * 8 + 8]), code)
    return glyph


def screen_to_char(code):
    if code is None:
        return "?"
    code &= 0x7F
    if code == 0:
        return "@"
    if 1 <= code <= 26:
        return chr(64 + code)
    if 0x20 <= code <= 0x3F:
        return chr(code)
    return "?"


def read_text(shot: Shot, glyphs, row: int, col: int, n: int, dy: int = 0) -> str:
    return "".join(screen_to_char(glyphs.get(shot.cell_pattern(row, col + i, dy))) for i in range(n))


def colour_name(i):
    return "unknown colour" if i is None else f"{i} ({NAMES[i]})"


# ---- the checks ------------------------------------------------------------------------
def check_verdict(c, shot, _ctx):
    x, y = c.get("at", BORDER_SAMPLE)
    i = shot.index(x, y)
    if i == 5:
        return True, "border green (PASS)"
    if i == 2:
        return False, "border red: the program graded itself FAIL"
    return False, f"border {colour_name(i)} at ({x}, {y}): the program never reached its verdict"


def check_pixel(c, shot, _ctx):
    x, y = point_xy(c, shot.model)
    i = shot.index(x, y)
    want = c["colour"]
    return i == want, f"({x}, {y}) is {colour_name(i)}, want {colour_name(want)}"


def check_rect(c, shot, _ctx):
    x0, y0, x1, y1 = area_box(c, shot.model)
    bad = [(x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1) if shot.index(x, y) != c["colour"]]
    if not bad:
        return True, f"({x0}, {y0}) to ({x1}, {y1}) all {colour_name(c['colour'])}"
    x, y = bad[0]
    return False, (f"{len(bad)} pixels of ({x0}, {y0}) to ({x1}, {y1}) are not {colour_name(c['colour'])}; "
                   f"first ({x}, {y}) is {colour_name(shot.index(x, y))}")


def check_sprite(c, shot, _ctx):
    want = area_box(c, shot.model)
    s = c.get("search") or {"vic_x": c["vic_x"] - 16, "line": c["line"] - 16,
                             "width": c["width"] + 32, "height": c["height"] + 32}
    sx0, sy0, sx1, sy1 = area_box(s, shot.model)
    w, h = shot.g["size"]
    sx0, sy0, sx1, sy1 = max(sx0, 0), max(sy0, 0), min(sx1, w - 1), min(sy1, h - 1)
    pts = [(x, y) for y in range(sy0, sy1 + 1) for x in range(sx0, sx1 + 1) if shot.index(x, y) == c["colour"]]
    if not pts:
        return False, f"no {colour_name(c['colour'])} pixel in ({sx0}, {sy0}) to ({sx1}, {sy1})"
    got = (min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts))
    return got == want, f"{colour_name(c['colour'])} box {got}, want {want}"


def check_ink(c, shot, _ctx):
    x0, y0, x1, y1 = area_box(c, shot.model)
    bg = c.get("background", 0)
    lit = [i for i in (shot.index(x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1)) if i != bg]
    n = len(lit)
    seen = sorted({i for i in lit if i is not None}, key=lambda i: -lit.count(i))
    msg = f"{n} pixels of ({x0}, {y0}) to ({x1}, {y1}) are not {colour_name(bg)}"
    if seen:
        msg += " (" + ", ".join(f"{lit.count(i)} {NAMES[i]}" for i in seen[:4]) + ")"
    problems = []
    if n < c["min"]:
        problems.append(f"under {c['min']}")
    if "max" in c and n > c["max"]:
        problems.append(f"over {c['max']}")
    if "colours" in c:
        stray = [i for i in seen if i not in c["colours"]] + ([None] if None in lit else [])
        if stray:
            problems.append("stray colour " + ", ".join(colour_name(i) for i in stray))
    return not problems, msg + ("" if not problems else ": " + "; ".join(problems))


def check_text(c, shot, ctx):
    want = c["text"].upper()
    got = read_text(shot, ctx["glyphs"](c), c["row"], c["col"], len(want), c.get("dy", 0))
    return got == want, f"row {c['row']} col {c['col']} reads '{got}', want '{want}'"


def check_same(c, shot, ctx):
    other = ctx["ntsc"]
    if "area" in c:
        a, b = area_box(c["area"], "pal"), area_box(c["area"], "ntsc")
        where = f"vic_x {c['area']['vic_x']}, line {c['area']['line']}, {c['area']['width']} x {c['area']['height']}"
    else:
        a, b = cells_box(c["cells"], "pal"), cells_box(c["cells"], "ntsc")
        where = "cells {},{} to {},{}".format(*c["cells"])
    diffs, first = 0, None
    for dy in range(a[3] - a[1] + 1):
        for dx in range(a[2] - a[0] + 1):
            p, q = shot.index(a[0] + dx, a[1] + dy), other.index(b[0] + dx, b[1] + dy)
            if p != q or p is None:
                diffs += 1
                first = first or (dx, dy, p, q)
    if diffs == 0:
        return True, f"{where} identical on PAL and NTSC"
    dx, dy, p, q = first
    return False, (f"{diffs} pixels differ between PAL and NTSC in {where}; first at offset ({dx}, {dy}): "
                   f"{colour_name(p)} vs {colour_name(q)}")


def check_meter(c, shot, ctx):
    got = read_text(shot, ctx["glyphs"](c), c["row"], c["col"], 20, c.get("dy", 0))
    m = re.fullmatch(r"F(\d{5}) W(\d{5}) T(\d{5})", got)
    if not m:
        return False, f"no meter readout at row {c['row']} col {c['col']}: reads '{got}'"
    frames, worst, typical = (int(v) for v in m.groups())
    budget = c.get("max_worst", shot.g["frame_cycles"])
    msg = f"frames {frames}, worst {worst}, typical {typical} cycles (CIA2 timer A; limit {budget})"
    problems = []
    if "frames" in c and frames != c["frames"]:
        problems.append(f"frames {frames}, want {c['frames']}: the shot was not taken after the meter's hold")
    if worst > budget:
        problems.append(f"worst {worst} over {budget}")
    if typical > worst:
        problems.append("typical over worst")
    if typical < c.get("min_typical", 1):
        problems.append(f"typical {typical} under {c.get('min_typical', 1)}: the meter has not finished recording")
    return not problems, msg + ("" if not problems else ": " + "; ".join(problems))


CHECKS = {"verdict": check_verdict, "pixel": check_pixel, "rect": check_rect, "sprite": check_sprite,
          "ink": check_ink, "text": check_text, "same": check_same, "meter": check_meter}


def glyph_loader(base):
    cache = {}

    def get(c):
        key = c.get("charset")
        if key not in cache:
            cache[key] = load_glyphs(key, base)
            if cache[key] is None:
                where = "set C64_CHARGEN to chargen-901225-01.bin" if key in (None, "rom-upper", "rom-lower") \
                    else f"no file {os.path.join(base, key)}"
                raise SpecError(f"check '{c.get('name', c['type'])}': cannot read the character set ({where})")
        return cache[key]
    return get


def refuse(msg) -> int:
    """Exit 2: nothing was graded. One line on stdout a FAIL grep sees, the same on stderr."""
    print(f"FAIL REFUSED check.py: {msg} (exit 2: nothing was graded)")
    print(f"check.py: {msg}", file=sys.stderr)
    return 2


def grade(spec, shots, ctx):
    failed = total = 0
    for c in spec["checks"]:
        models = ["pal"] if c["type"] == "same" else c.get("models", ["pal", "ntsc"])
        for model in models:
            ok, msg = CHECKS[c["type"]](c, shots[model], ctx)
            label = "PAL+NTSC" if c["type"] == "same" else model.upper()
            print(f"{'PASS' if ok else 'FAIL'} {label:8} {c.get('name', c['type'])}: {msg}")
            failed += not ok
            total += 1
    print(f"check: {total - failed} of {total} passed" + ("" if not failed else f", {failed} FAILED"))
    return 1 if failed else 0


def main() -> int:
    if len(sys.argv) != 4:
        print("usage: check.py expect.json pal.png ntsc.png", file=sys.stderr)
        return refuse("usage: check.py expect.json pal.png ntsc.png")
    try:
        spec = json.load(open(sys.argv[1]))
        validate(spec)
        shots = {"pal": Shot(sys.argv[2], "pal"), "ntsc": Shot(sys.argv[3], "ntsc")}
    except (OSError, ValueError, SpecError, Refused) as e:
        return refuse(f"{sys.argv[1]}: {e}")
    ctx = {"glyphs": glyph_loader(os.path.dirname(os.path.abspath(sys.argv[1]))), "ntsc": shots["ntsc"]}
    try:
        return grade(spec, shots, ctx)
    except SpecError as e:
        return refuse(f"{sys.argv[1]}: {e}")


if __name__ == "__main__":
    sys.exit(main())
