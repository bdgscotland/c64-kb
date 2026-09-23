#!/usr/bin/env python3
"""Shoot a run mid-scroll and prove every picture is whole.

usage: tearcheck.py --x64sc X --harness DIR --src DIR --expect whole|torn PRG CYCLES...

Renders the level from the program's own sources (src/level.c, src/art.c,
src/game.h) into one picture 2,048 pixels wide, runs PRG headless in VICE
once per cycle count on PAL and on NTSC, and matches each exit screenshot's
playfield (character rows 0-19, the 38-column window) against that render:
which camera positions give exactly these pixels, row by row.

A whole picture is one camera for all 160 lines. VICE's exit screenshot is
taken mid-frame, so a picture may also be two frames: lines above the beam
from the frame being drawn, lines below from the one before. The two parts
then differ by one frame of camera movement, at most CAM_SPEED (2) pixels,
and the lower part must be exactly the camera the HUD shows (below).
A torn picture has a part a whole column (8 pixels) off, or more than one
seam. Sprite colours (white, light red, cyan) are masked; a coin cell may
show the coin or the sky (it may have been taken).

The phase test. The AUTOPILOT build prints on HUD row 23 ("CAM 0576") the
camera of the picture the IRQ at line 251 has just set up. The lowest part
of the playfield must be at that camera, give or take one frame's
movement: a page and an XSCROLL that disagree put the whole picture 8
pixels off, which the seam test alone cannot see.

--expect whole: exit 0 when every shot is whole or a two-frame composite.
--expect torn:  exit 0 when at least one shot is torn (the TEAR_DEMO build:
                the check can see a tear). Exit 1 otherwise, 2 on a setup
                error.
"""
import argparse
import importlib.util
import os
import re
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

CAM_SPEED = 2
SPRITE_COLOURS = {1, 10, 3}             # player, walker, hopper (src/game.h COL_*)
VCOL = ["BLACK", "WHITE", "RED", "CYAN", "PURPLE", "GREEN", "BLUE", "YELLOW",
        "ORANGE", "BROWN", "LT_RED", "DARK_GREY", "MED_GREY", "LT_GREEN", "LT_BLUE", "LT_GREY"]


def unescape(s):
    return s.encode().decode("unicode_escape")


def block(text, name):
    m = re.search(rf"// {name}-BEGIN\n(.*?)// {name}-END", text, re.S)
    if not m:
        raise SystemExit(f"tearcheck: no {name}-BEGIN/END block")
    return m.group(1)


def load_model(src):
    game = open(os.path.join(src, "game.h")).read()
    level = open(os.path.join(src, "level.c")).read()
    art = open(os.path.join(src, "art.c")).read()
    ch = {k: int(v) for k, v in re.findall(r"#define (CH_\w+)\s+(\d+)", game)}
    col = {k: VCOL.index(v) for k, v in re.findall(r"#define (COL_\w+)\s+VCOL_(\w+)", game)}
    rows = [unescape(s) for s in re.findall(r'"((?:[^"\\]|\\.)*)"', block(level, "LEVEL"))]
    tiles = block(level, "TILES")
    key = unescape(re.search(r'tile_key\[\] = "((?:[^"\\]|\\.)*)"', tiles).group(1))
    quads = [[ch[n] for n in q] for q in re.findall(r"\{\s*(CH_\w+),\s*(CH_\w+),\s*(CH_\w+),\s*(CH_\w+)\s*\}", tiles)]
    hbody = re.search(r"heights\[64\] = \{(.*?)\};", level, re.S).group(1)
    heights = [int(v) for v in re.findall(r"^\s*([\d, ]+),?\s*//", hbody, re.M) for v in v.split(",") if v.strip()]
    ga = block(art, "GLYPH-ART")
    codes = [ch[n] for n in re.findall(r"CH_\w+", re.search(r"glyph_code\[\] = \{(.*?)\};", ga, re.S).group(1))]
    strs = re.findall(r'"([.byg]{4})"', re.search(r"glyph_art\[\]\[8\]\[5\] = \{(.*?)\};", ga, re.S).group(1))
    if len(rows) != 10 or len(heights) != 64 or len(strs) != 8 * len(codes) or len(quads) != len(key):
        raise SystemExit(f"tearcheck: could not read the model (rows {len(rows)}, heights {len(heights)}, "
                         f"art {len(strs)}/{8 * len(codes)}, tiles {len(quads)}/{len(key)})")
    # glyph -> 8 rows of 4 multicolour pixel values
    glyph = {ch["CH_SKY"]: [[0] * 4 for _ in range(8)]}
    val = {".": 0, "b": 1, "y": 2, "g": 3}
    for i, code in enumerate(codes):
        glyph[code] = [[val[c] for c in strs[i * 8 + r]] for r in range(8)]
    for t in range(1, 7):                   # art.c slope_glyph: the higher of each pixel's two columns
        h = heights[t * 8:t * 8 + 8]
        g = []
        for r in range(8):
            row = []
            for k in range(4):
                s = min(h[2 * k], h[2 * k + 1])
                row.append(0 if r < s else 3 if r == s else 1)
            g.append(row)
        glyph[ch["CH_SLOPE1"] - 1 + t] = g
    palette = [col["COL_SKY"], col["COL_EARTH"], col["COL_GOLD"], col["COL_GRASS"]]
    coin = key.index("o")

    def render(with_coins):
        img = np.zeros((160, len(rows[0]) * 16), dtype=np.uint8)
        for ty, line in enumerate(rows):
            for tx, k in enumerate(line):
                t = key.index(k) if k in key else 0
                if t == coin and not with_coins:
                    t = 0
                for q, code in enumerate(quads[t]):
                    g = glyph[code]
                    y0, x0 = ty * 16 + (q >> 1) * 8, tx * 16 + (q & 1) * 8
                    for r in range(8):
                        for k4 in range(4):
                            img[y0 + r, x0 + 2 * k4:x0 + 2 * k4 + 2] = palette[g[r][k4]]
        return img

    return render(True), render(False)


def load_check(harness):
    spec = importlib.util.spec_from_file_location("check", os.path.join(harness, "check.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def shot_indices(path, model, chk):
    im = Image.open(path).convert("RGB")
    g = chk.GEOMETRY[model]
    pal = {tuple(c): i for i, c in enumerate(chk.PALETTE[model])}
    y0 = 51 - g["line_offset"]
    a = np.array(im)[y0:y0 + 160, 31 + 8:335 + 8]      # VIC X 31-334, lines 51-210
    out = np.full(a.shape[:2], 255, dtype=np.uint8)
    for rgb, i in pal.items():
        out[np.all(a == rgb, axis=2)] = i
    return out


def row_candidates(row, w1, w0):
    """Camera positions at which this 304-pixel row matches the render."""
    mask = np.isin(row, list(SPRITE_COLOURS)) | (row == 255)
    ok = (w1 == row) | (w0 == row) | mask
    return np.nonzero(ok.all(axis=1))[0]


def segments(img, world1, world0):
    from numpy.lib.stride_tricks import sliding_window_view
    segs, cur, start = [], None, 0
    for y in range(160):
        w1 = sliding_window_view(world1[y], 304)
        w0 = sliding_window_view(world0[y], 304)
        c = set(row_candidates(img[y], w1, w0).tolist())
        nxt = c if cur is None else cur & c
        if not nxt:
            segs.append((start, y - 1, cur))
            start, nxt = y, c
        cur = nxt
    segs.append((start, 159, cur))
    return segs


def hud_camera(png, model, chk):
    text = chk.read_text(chk.Shot(png, model), chk.load_glyphs(), 23, 30, 8)
    return int(text[4:]) if text.startswith("CAM ") and text[4:].isdigit() else None


def judge(segs, cam):
    if any(not s[2] for s in segs):
        return "no camera matches a part: not the level", None
    if len(segs) > 2:
        return f"TORN: {len(segs)} parts, seams at lines {[51 + s[0] for s in segs[1:]]}", None
    what = "whole"
    if len(segs) == 2:
        a, b = segs[0][2], segs[1][2]
        d = min(abs(x - y) for x in a for y in b)
        if d > CAM_SPEED:
            return f"TORN at line {51 + segs[1][0]}: parts {d} pixels apart", None
        what = f"two frames, seam at line {51 + segs[1][0]}, cameras {min(a)} / {min(b)}"
    low = segs[-1][2]
    # In a real two-frame shot the lower part is the older frame, the one the
    # HUD row (drawn after the playfield) belongs to: exactly its camera. A
    # mid-picture XSCROLL write also makes two parts 1-2 pixels apart, but
    # then the lower part is not the HUD camera (review mutation, line 150).
    if len(segs) == 2 and cam is not None and cam not in low:
        return f"SEAM NOT A FRAME BOUNDARY: lower part {sorted(low)[:3]} is not the HUD camera {cam}", None
    if cam is None:
        return what + "; HUD camera unreadable (the beam was on it)", low
    off = min(abs(c - cam) for c in low)
    if off > CAM_SPEED:
        return f"OFF PHASE: the picture is {off} pixels from the HUD camera {cam}", None
    return what + f", HUD camera {cam}", low


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--x64sc", required=True)
    ap.add_argument("--harness", required=True)
    ap.add_argument("--src", required=True)
    ap.add_argument("--expect", choices=["whole", "torn"], required=True)
    ap.add_argument("--timeout", default="180")
    ap.add_argument("prg")
    ap.add_argument("cycles", nargs="+")
    a = ap.parse_args()
    chk = load_check(a.harness)
    world1, world0 = load_model(a.src)
    torn = bad = 0
    with tempfile.TemporaryDirectory() as tmp:
        for model in ("pal", "ntsc"):
            for cyc in a.cycles:
                png = os.path.join(tmp, f"{model}-{cyc}.png")
                cmd = ["timeout", a.timeout, a.x64sc, "-default", "-warp", "+sound", "+autostart-delay-random",
                       "-autostartprgmode", "1", "-limitcycles", cyc]
                if model == "ntsc":
                    cmd += ["-model", "ntsc"]
                subprocess.run(cmd + ["-exitscreenshot", png, "-autostart", a.prg],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                if not os.path.exists(png):
                    print(f"tearcheck: no screenshot for {model} {cyc}", file=sys.stderr)
                    sys.exit(2)
                cam = hud_camera(png, model, chk)
                verdict, cams = judge(segments(shot_indices(png, model, chk), world1, world0), cam)
                if cams is None:
                    torn += 1
                    bad += 1
                print(f"{'TORN' if cams is None else 'ok  '} {model.upper():4s} {int(cyc):>10,} cycles: {verdict}")
    n = 2 * len(a.cycles)
    if a.expect == "whole":
        print(f"tearcheck: {n - bad} of {n} shots whole or two-frame composites")
        sys.exit(0 if bad == 0 else 1)
    print(f"tearcheck: {torn} of {n} shots torn; the check {'sees' if torn else 'does NOT see'} the tear")
    sys.exit(0 if torn else 1)


if __name__ == "__main__":
    main()
