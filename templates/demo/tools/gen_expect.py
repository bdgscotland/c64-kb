#!/usr/bin/env python3
"""Write expect.json for the demo starter from src/config.asm.

usage: python3 tools/gen_expect.py > expect.json      (or: make expect)

The numbers (lines, amplitudes, speeds, the freeze) are read from the plain
`.const NAME = number` lines of src/config.asm; the picture is computed here
again, in Python, not taken from the assembler: where the eight sprites
sit, which colour every bar line has, where row 22's ink falls at the
frozen XSCROLL (from the character ROM).
KickAssembler's round() is Java's Math.round, floor(x + 0.5), and so is
rnd() below.
"""
import json
import math
import os
import re

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
with open(os.path.join(HERE, "src", "config.asm")) as f:
    CONFIG = f.read()
C = {m.group(1): int(m.group(2), 0) for m in re.finditer(r"^\.const (\w+)\s*=\s*(\d+)\b", CONFIG, re.M)}

# The ramps and the message, from their source lines.
RAMPS = [[int(v) for v in m.group(1).split(",")]
         for m in re.finditer(r"List\(\)\.add\(([\d, ]+)\)", CONFIG)]
with open(os.path.join(HERE, "src", "tables.asm")) as f:
    TABLES = f.read()
MESSAGE = "".join(re.findall(r'\.text "([^"]*)"', TABLES[TABLES.index("message:"):]))
SUBTITLE = re.search(r'subtitle:\s*\.text "([^"]*)"', TABLES).group(1)
# scroll_colours: ".byte a, b, c / .fill n, v / .byte ..." read in order.
SCROLL_COLOURS = []
for kind, args in re.findall(r"\.(byte|fill) ([\d, ]+)", TABLES[TABLES.index("scroll_colours:"):TABLES.index(".encoding")]):
    vals = [int(v) for v in args.split(",")]
    SCROLL_COLOURS += vals if kind == "byte" else [vals[1]] * vals[0]

# The power-on character set, for where the scroller's ink falls (the same
# ROM check.py decodes text with).
CHARGEN_PATHS = [
    os.environ.get("C64_CHARGEN", ""),
    "/opt/homebrew/opt/vice/share/vice/C64/chargen-901225-01.bin",
    "/usr/local/share/vice/C64/chargen-901225-01.bin",
    "/usr/share/vice/C64/chargen-901225-01.bin",
    "/usr/lib/vice/C64/chargen-901225-01.bin",
]

BORDER_PASS = 5
BLACK = 0


def rnd(x):
    return math.floor(x + 0.5)


def sin256(amp, step):
    return rnd(amp * math.sin(2 * math.pi * (step & 255) / 256))


def sprites(k):
    px, py = (k * C["CHAIN_SX"]) & 255, (k * C["CHAIN_SY"]) & 255
    out = []
    for n in range(8):
        x = C["CHAIN_X0"] + n * C["CHAIN_DX"] + sin256(C["CHAIN_AX"], px + n * C["CHAIN_PX"])
        y = C["CHAIN_Y0"] + sin256(C["CHAIN_AY"], py + n * C["CHAIN_PY"])
        out.append((x, y, C["CHAIN_COL_A"] if n % 2 == 0 else C["CHAIN_COL_B"]))
    return out


def bar_lines(k):
    pb = (k * C["BAR_SPEED"]) & 255
    lines = [BLACK] * C["BARS_LINES"]
    for b, ramp in enumerate(RAMPS):
        top = C["BARS_CENTRE"] + sin256(C["BARS_AMP"], pb + b * C["BAR_STEP"])
        lines[top:top + C["BAR_H"]] = ramp
    return lines


def screen_code(ch):
    """KickAssembler's screencode_upper for the characters the message uses."""
    return ord(ch) - 64 if "A" <= ch <= "Z" else ord(ch)


def scroller_checks(k, rom):
    """Row 22 at the freeze: 38 columns, XSCROLL 7 - (k mod 8), after k // 8 shifts.
    For each visible cell, the leftmost ink pixel of its first inked glyph row
    and the pixel just left of it. A missing or wrong $D016 write moves them."""
    shifts, xs = k // 8, 7 - k % 8
    row = MESSAGE[shifts:shifts + 40]
    line0 = 51 + 8 * C["SCROLL_ROW"]

    def colour_at(vic_x, r):
        cell, bit = divmod(vic_x - 24 - xs, 8)
        if not 0 <= cell < 40:
            return BLACK
        glyph = rom[screen_code(row[cell]) * 8 + r]
        return SCROLL_COLOURS[cell] if glyph & (0x80 >> bit) else BLACK

    out = []
    for c in range(1, 38):
        code = screen_code(row[c])
        glyph = rom[code * 8: code * 8 + 8]
        r = next((r for r in range(8) if glyph[r]), None)
        if r is None:
            continue
        bit = next(b for b in range(8) if glyph[r] & (0x80 >> b))
        x = 24 + 8 * c + xs + bit
        for vx, what in ((x, "ink"), (x - 1, "left of it")):
            out.append({"name": f"scroller cell {c} '{row[c]}', XSCROLL {xs}: {what} at X {vx}, line {line0 + r}",
                        "type": "pixel", "vic_x": vx, "line": line0 + r, "colour": colour_at(vx, r)})
    # 38 columns: the border covers X 24-30 and 335-343 on the scroller's lines only.
    out.append({"name": "scroller in 38 columns: left border X 24-30", "type": "rect", "colour": BORDER_PASS,
                "vic_x": 24, "line": line0, "width": 7, "height": 8})
    out.append({"name": "scroller in 38 columns: right border X 335-343", "type": "rect", "colour": BORDER_PASS,
                "vic_x": 335, "line": line0, "width": 9, "height": 8})
    return out


def main():
    k = C["FREEZE_UPDATES"]
    top = C["BARS_TOP"]
    checks = [
        {"name": "own verdict (border)", "type": "verdict"},
        {"name": "verdict line", "type": "text", "row": 24, "col": 1, "text": "RESULT 01 PASS"},
        {"name": "subtitle under the logo (row 5)", "type": "text", "row": 5, "col": 0, "text": SUBTITLE},
    ]
    # The logo: two cells of the D's stem and one gap, rows 0 to 4.
    for row, colour in enumerate([4, 10, 7, 10, 4]):
        checks.append({"name": f"logo row {row}: the D's stem", "type": "pixel", "row": row, "col": 7, "colour": colour})
    checks.append({"name": "logo: the gap between D and E", "type": "pixel", "row": 2, "col": 13, "colour": BLACK})

    for n, (x, y, colour) in enumerate(sprites(k)):
        checks.append({
            "name": f"sprite {n} at X {x}, Y {y} (lines {y + 1}-{y + 21}), from the sine formula",
            "type": "sprite", "colour": colour, "vic_x": x, "line": y + 1, "width": 24, "height": 21,
            "search": {"vic_x": x - 16, "line": y - 7, "width": 56, "height": 37},
        })

    # Every bar line, left border to right border, one colour: runs of equal
    # colour become one rect each. The title card's rows 13, 15 and 17 lie in
    # these lines, so these checks also prove the wipe cleared it.
    lines = bar_lines(k)
    i = 0
    while i < len(lines):
        j = i
        while j + 1 < len(lines) and lines[j + 1] == lines[i]:
            j += 1
        checks.append({
            "name": f"bar lines {top + i}-{top + j}: colour {lines[i]} across the whole line",
            "type": "rect", "colour": lines[i], "vic_x": -8, "line": top + i, "width": 384, "height": j - i + 1,
        })
        i = j + 1
    for line, what in ((top - 1, "above"), (top + len(lines), "below")):
        checks.append({"name": f"line {line}, {what} the bars: border", "type": "rect", "colour": BORDER_PASS,
                       "vic_x": -8, "line": line, "width": 32, "height": 1})
        checks.append({"name": f"line {line}, {what} the bars: background", "type": "rect", "colour": BLACK,
                       "vic_x": 24, "line": line, "width": 320, "height": 1})

    rom = next(open(p, "rb").read() for p in CHARGEN_PATHS if p and os.path.exists(p))
    checks += scroller_checks(k, rom)
    checks.append({"name": "rows 0 to 23 the same on PAL and NTSC", "type": "same", "cells": [0, 0, 23, 39]})
    checks.append({"name": f"frame meter, {C['HOLD']} frames: title, wipe and main part", "type": "meter",
                   "row": 24, "col": 20, "frames": C["HOLD"]})
    print(json.dumps({"checks": checks}, indent=2))


if __name__ == "__main__":
    main()
