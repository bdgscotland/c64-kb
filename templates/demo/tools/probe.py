#!/usr/bin/env python3
"""Where the bar kernel's colour stores land, read off the PROBE build's shots.

usage: probe.py probe-pal-*.png probe-ntsc-*.png   (at least 8 shots a model)

The PROBE build delays the whole kernel by 20 cycles, so the second store
of each line ($D021, the background) lands inside the visible line instead
of in the horizontal blank. On every bar line whose colour differs from the
line above, the first pixel of the new colour inside the display window is
that store. One column on every line, in every shot, means the entry is
stable and every badline chunk has the right length. Taking the 20 cycles
(160 pixels) back off says how far the real stores sit from the visible
edges: the $D020 store is 4 cycles (32 pixels) before the $D021 store.

Exit 0 when each model shows one column over all its shots and the stores
of every chunk fall in the horizontal blank without the probe; 1 otherwise.
Geometry from c64-kb docs/runtime/vice-reference.md: row = line - 16 (PAL),
line - 28 (NTSC); a PAL line is 504 pixels (63 cycles), an NTSC one 520.
"""
import os
import re
import sys

from PIL import Image

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
with open(os.path.join(HERE, "src", "config.asm")) as f:
    CONST = {m.group(1): int(m.group(2)) for m in re.finditer(r"^\.const (\w+)\s*=\s*(\d+)\b", f.read(), re.M)}
SHIFT_PX = 20 * 8
MIN_SHOTS = 8                          # the review saw wrong pads show one column in 16 of 16 single shots
GREY_DOT = (205, 205, 205)             # light grey, the same triple on both models
MODELS = {"pal": (16, 504), "ntsc": (28, 520)}


def columns(path, offset):
    """(line, x) of the first new-colour pixel in the display, per changing line."""
    im = Image.open(path).convert("RGB")
    top, n = CONST["BARS_TOP"], CONST["BARS_LINES"]
    out = []
    for line in range(top, top + n + 1):
        y = line - offset
        new, old = im.getpixel((383, y)), im.getpixel((0, y))
        # VICE's PAL default, a C64C, draws the grey dot: one light grey pixel
        # where a colour register changes. A change to or from light grey is
        # skipped, so the column is always the first pixel of the new colour.
        if new == old or GREY_DOT in (new, old):
            continue
        out.append((line, next((x for x in range(32, 352) if im.getpixel((x, y)) == new), None)))
    return out


def main():
    shots = {"pal": [], "ntsc": []}
    for path in sys.argv[1:]:
        shots["ntsc" if "ntsc" in os.path.basename(path) else "pal"].append(path)
    last_line = CONST["BARS_TOP"] + CONST["BARS_LINES"]
    ok = True
    for model, paths in shots.items():
        offset, line_px = MODELS[model]
        body, last = set(), set()
        for p in paths:
            for line, x in columns(p, offset):
                (last if line == last_line else body).add(x)
        print(f"{model}: {len(paths)} shot(s), $D021 store column(s) {sorted(body, key=str)}")
        if len(paths) < MIN_SHOTS:
            print(f"{model}: FAIL, {len(paths)} shot(s); a wrong SYNC_PAD can look right in fewer than {MIN_SHOTS}")
            ok = False
            continue
        if len(body) != 1 or None in body:
            print(f"{model}: FAIL, the stores do not line up")
            ok = False
            continue
        x2 = next(iter(body)) - SHIFT_PX     # the real $D021 store, relative to x = 0
        x1 = x2 - 32                         # the $D020 store, four cycles earlier
        # The last chunk's $D021 store writes black over black, so it never
        # shows; it is two cycles later than the others by the code.
        xl = x2 + 16
        after = x1 + line_px - 383           # pixels past the line above's last visible pixel
        print(f"{model}: without the probe, $D020 at x {x1} and $D021 at x {x2} (the last chunk's "
              f"$D021 at {xl} by the code, not measured), x 0 being the line's first visible pixel; "
              f"the $D020 store is {after} pixels after the line above leaves the picture")
        if not (xl < 0 and after > 0):
            print(f"{model}: FAIL, a store would land in the visible line")
            ok = False
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
