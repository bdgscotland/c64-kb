#!/usr/bin/env python3
"""Grade a starter's exit screenshots against the expectations it declares.

usage: check.py expect.json pal.png ntsc.png

Exit 0 when every check passes on every model it names, 1 when any fails
(each failure is a line starting "FAIL" that names the check), 2 on a
usage or setup error.

Geometry and palette are the ones measured in c64-kb's
docs/runtime/vice-reference.md, "Reading the exit screenshot" (VICE x64sc
3.10, -default): PAL 384 x 272, screenshot row = raster line - 16; NTSC
(-model ntsc) 384 x 247, row = line - 28, and NTSC lines 0-11 land on rows
235-246. Screenshot x = VIC-II X coordinate + 8 (sprite X 24 is display
column 32). Text cell (row r, column c) starts at x = 32 + 8c, y = 35 + 8r
(PAL) or 23 + 8r (NTSC). Colours are matched by exact triple against the
sixteen per model; another VICE version or palette will not match.

expect.json:
  {
    "checks": [
      {"name": "...", "type": "<type>", "models": ["pal", "ntsc"], ...},
      ...
    ]
  }
"models" defaults to both. Types:
  verdict  border colour index 5 (the program's own PASS); index 2 is FAIL,
           anything else means the program never reached its verdict.
           Optional "at": [x, y] (default the border sample point [2, 100]).
  pixel    colour index at a point. The point is one of
             "x", "y"          screenshot pixels
             "vic_x", "line"   VIC-II X coordinate and raster line. A sprite whose X and Y
                               registers are (sx, sy) covers vic_x sx to sx + 23 and lines
                               sy + 1 to sy + 21 (measured by templates/hello, PAL and NTSC)
             "row", "col"      the centre of a text cell
  text     "row", "col", "text": the cells decode, through the character ROM,
           to that text (upper case; case is ignored).
  same     "cells": [row0, col0, row1, col1] inclusive: every pixel of those
           cells has the same colour index on PAL and NTSC.
  meter    "row", "col": the frame meter's readout "F00000 W00000 T00000".
           Optional "frames" (exact count recorded), "max_worst" (cycles;
           default: one frame, 19,656 PAL / 17,095 NTSC), "min_typical".
           Prints the figures it read.
"""
import json
import os
import re
import sys

try:
    from PIL import Image
except ImportError:
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
    "/opt/homebrew/opt/vice/share/vice/C64/chargen-901225-01.bin",
    "/usr/local/share/vice/C64/chargen-901225-01.bin",
    "/usr/share/vice/C64/chargen-901225-01.bin",
    "/usr/lib/vice/C64/chargen-901225-01.bin",
    "/usr/share/vice/C64/chargen",
]


class Shot:
    def __init__(self, path: str, model: str):
        self.path, self.model = path, model
        im = Image.open(path).convert("RGB")
        g = GEOMETRY[model]
        if im.size != g["size"]:
            raise SystemExit(f"check.py: {path} is {im.size[0]} x {im.size[1]}, not a {model.upper()} "
                             f"exit screenshot ({g['size'][0]} x {g['size'][1]})")
        self.px, self.g = im.load(), g
        self.lookup = {rgb: i for i, rgb in enumerate(PALETTE[model])}

    def index(self, x: int, y: int):
        return self.lookup.get(self.px[x, y])

    def point(self, c: dict):
        if "vic_x" in c:
            y = (c["line"] - self.g["line_offset"]) % self.g["lines"]
            return c["vic_x"] + 8, y
        if "row" in c:
            return self.cell_xy(c["row"], c["col"], centre=True)
        return c["x"], c["y"]

    def cell_xy(self, row: int, col: int, centre: bool = False):
        x, y = TEXT_X0 + 8 * col, self.g["text_y0"] + 8 * row
        return (x + 4, y + 4) if centre else (x, y)

    def cell_pattern(self, row: int, col: int):
        """The cell's 8 rows as bytes: ink is any pixel not the cell's majority colour."""
        x0, y0 = self.cell_xy(row, col)
        pix = [[self.px[x0 + xx, y0 + yy] for xx in range(8)] for yy in range(8)]
        flat = [p for r in pix for p in r]
        bg = max(set(flat), key=flat.count)
        return tuple(sum((pix[yy][xx] != bg) << (7 - xx) for xx in range(8)) for yy in range(8))


def load_glyphs():
    for p in CHARGEN_PATHS:
        if p and os.path.isfile(p):
            rom = open(p, "rb").read()
            glyph = {}
            for code in range(256):  # the power-on upper-case set; first code wins ($20 over $60)
                glyph.setdefault(tuple(rom[code * 8:code * 8 + 8]), code)
            return glyph
    return None


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


def read_text(shot: Shot, glyphs, row: int, col: int, n: int) -> str:
    return "".join(screen_to_char(glyphs.get(shot.cell_pattern(row, col + i))) for i in range(n))


def colour_name(i):
    return "unknown colour" if i is None else f"{i} ({NAMES[i]})"


def check_verdict(c, shot, _glyphs, _other):
    x, y = c.get("at", BORDER_SAMPLE)
    i = shot.index(x, y)
    if i == 5:
        return True, "border green (PASS)"
    if i == 2:
        return False, "border red: the program graded itself FAIL"
    return False, f"border {colour_name(i)} at ({x}, {y}): the program never reached its verdict"


def check_pixel(c, shot, _glyphs, _other):
    x, y = shot.point(c)
    i = shot.index(x, y)
    want = c["colour"]
    return i == want, f"({x}, {y}) is {colour_name(i)}, want {colour_name(want)}"


def check_text(c, shot, glyphs, _other):
    want = c["text"].upper()
    got = read_text(shot, glyphs, c["row"], c["col"], len(want))
    return got == want, f"row {c['row']} col {c['col']} reads '{got}', want '{want}'"


def check_same(c, shot, _glyphs, other):
    if other is None:
        return True, "(needs both shots)"
    r0, c0, r1, c1 = c["cells"]
    diffs = 0
    first = None
    for row in range(r0, r1 + 1):
        for col in range(c0, c1 + 1):
            ax, ay = shot.cell_xy(row, col)
            bx, by = other.cell_xy(row, col)
            for yy in range(8):
                for xx in range(8):
                    a, b = shot.index(ax + xx, ay + yy), other.index(bx + xx, by + yy)
                    if a != b or a is None:
                        diffs += 1
                        first = first or (row, col, xx, yy, a, b)
    if diffs == 0:
        return True, f"cells {r0},{c0} to {r1},{c1} identical on PAL and NTSC"
    row, col, xx, yy, a, b = first
    return False, (f"{diffs} pixels differ between PAL and NTSC in cells {r0},{c0} to {r1},{c1}; first at "
                   f"cell {row},{col} pixel {xx},{yy}: {colour_name(a)} vs {colour_name(b)}")


def check_meter(c, shot, glyphs, _other):
    got = read_text(shot, glyphs, c["row"], c["col"], 20)
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
        problems.append(f"typical {typical} under {c.get('min_typical', 1)}")
    return not problems, msg + ("" if not problems else ": " + "; ".join(problems))


CHECKS = {"verdict": check_verdict, "pixel": check_pixel, "text": check_text,
          "same": check_same, "meter": check_meter}


def main() -> int:
    if len(sys.argv) != 4:
        print(__doc__.split("\n\n")[1], file=sys.stderr)
        return 2
    spec = json.load(open(sys.argv[1]))
    shots = {"pal": Shot(sys.argv[2], "pal"), "ntsc": Shot(sys.argv[3], "ntsc")}
    glyphs = None
    if any(c["type"] in ("text", "meter") for c in spec["checks"]):
        glyphs = load_glyphs()
        if glyphs is None:
            print("check.py: no character ROM found; set C64_CHARGEN to chargen-901225-01.bin", file=sys.stderr)
            return 2
    failed = 0
    for c in spec["checks"]:
        fn = CHECKS.get(c["type"])
        if fn is None:
            print(f"check.py: unknown check type '{c['type']}' in {c.get('name', '?')}", file=sys.stderr)
            return 2
        models = c.get("models", ["pal", "ntsc"])
        if c["type"] == "same":
            models = ["pal"]
        for model in models:
            other = shots["ntsc"] if c["type"] == "same" else None
            ok, msg = fn(c, shots[model], glyphs, other)
            label = "PAL+NTSC" if c["type"] == "same" else model.upper()
            print(f"{'PASS' if ok else 'FAIL'} {label:8} {c.get('name', c['type'])}: {msg}")
            failed += not ok
    total = sum(1 if c["type"] == "same" else len(c.get("models", ["pal", "ntsc"])) for c in spec["checks"])
    print(f"check: {total - failed} of {total} passed" + ("" if not failed else f", {failed} FAILED"))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
