#!/usr/bin/env python3
"""Write expect.json for the demo starter from src/config.asm.

usage: python3 tools/gen_expect.py > expect.json      (or: make expect)

The numbers (lines, amplitudes, speeds, the freeze) are read from the plain
`.const NAME = number` lines of src/config.asm; the picture is computed here
again, in Python, not taken from the assembler: where the eight sprites
sit, which colour every bar line has, what row 22 of the scroller reads.
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

    shifts = k // 8
    shown = MESSAGE[shifts + 1: shifts + 38]   # column 38 loses its last pixel to the 38-column border
    checks.append({"name": f"scroller row {C['SCROLL_ROW']} after {shifts} shifts, XSCROLL 0 (columns 1-37)",
                   "type": "text", "row": C["SCROLL_ROW"], "col": 1, "text": shown})
    checks.append({"name": "rows 0 to 23 the same on PAL and NTSC", "type": "same", "cells": [0, 0, 23, 39]})
    checks.append({"name": f"frame meter, {C['HOLD']} frames: title, wipe and main part", "type": "meter",
                   "row": 24, "col": 20, "frames": C["HOLD"]})
    print(json.dumps({"checks": checks}, indent=2))


if __name__ == "__main__":
    main()
