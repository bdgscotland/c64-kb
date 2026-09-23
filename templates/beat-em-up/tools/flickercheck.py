#!/usr/bin/env python3
"""flickercheck.py: prove the fighter band shows every part in the crowded moments.

    python3 tools/flickercheck.py --x64sc X --src src --expect whole|dropped \\
        [--model pal|ntsc] PRG CYCLES...

The AUTOPILOT build holds the game still three times, when four fighters
stand within 24 ground lines of each other (src/verdict.h, photo stops),
and prints on HUD rows 21-23 the camera and each fighter's world x, ground
line, height, pose, facing and kind. This script shoots the run at each
pin (headless VICE, the harness's flags), reads that text back, builds
each fighter's two parts from src/art.c (the POSES table, the SPRITE-ART
blocks, the mirror rule) and src/view.c (shirt and trousers colours), puts
the nearer fighter in front, and compares every sprite pixel the model
expects with the picture. It does not use the program's sprite table: a
part the multiplexer dropped, moved or drew behind the wrong fighter is a
mismatch.

A shot that is not inside a stop (no "PHOTO" on row 21) is an error: the
pins are chosen inside the stops. --expect whole passes when every shot
matches every expected pixel; --expect dropped (the FLICKER_DEMO build)
passes when at least one shot has a part missing, which proves the check
can see one.

Geometry (c64-kb docs/runtime/vice-reference.md): screenshot x = VIC X + 8;
row = raster line - 16 (PAL), - 28 (NTSC); a sprite at Y register y is
drawn from line y + 1. The 38-column window shows VIC X 31 to 334.
"""
import argparse
import os
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "harness"))
sys.path.insert(0, os.path.join(HERE, "..", "..", "_harness"))
import check  # noqa: E402  (the harness's palettes, geometry and ROM font)

VCOL = ["BLACK", "WHITE", "RED", "CYAN", "PURPLE", "GREEN", "BLUE", "YELLOW", "ORANGE", "BROWN",
        "LT_RED", "DARK_GREY", "MED_GREY", "LT_GREEN", "LT_BLUE", "LT_GREY"]
SPR_BLOCK = 192
X_MIN, X_MAX = 31, 334          # the 38-column display window, VIC X


def block(src, name, begin, end):
    text = open(os.path.join(src, name)).read()
    a, b = text.index(begin), text.index(end)
    return text[a:b]


def load_model(src):
    """(pose table, fighter blocks, colours) from the sources."""
    game = open(os.path.join(src, "game.h")).read()
    enum = re.search(r"enum Block \{(.*?)B_FIGHTER_COUNT", game, re.S).group(1)
    names = [n.strip() for n in enum.replace("\n", " ").split(",") if n.strip()]
    index = {n: i for i, n in enumerate(names)}
    poses = []
    for m in re.finditer(r"\{ \{ (B_\w+),\s*(-?\d+),\s*(-?\d+) \}, \{ (B_\w+),\s*(-?\d+),\s*(-?\d+) \} \}",
                         block(src, "art.c", "POSES-BEGIN", "POSES-END")):
        poses.append([(index[m.group(1)], int(m.group(2)), int(m.group(3))),
                      (index[m.group(4)], int(m.group(5)), int(m.group(6)))])
    art = block(src, "art.c", "SPRITE-ART-BEGIN", "SPRITE-ART-END")
    blocks = [re.findall(r'"([.axb]{12})"', chunk) for chunk in art.split("{   //")[1:]]
    blocks = [b for b in blocks if len(b) == 21][:len(names)]
    view = open(os.path.join(src, "view.c")).read()

    def colours(var):
        m = re.search(var + r"\[3\]\s*=\s*\{([^}]*)\}", view)
        return [VCOL.index(v.strip().replace("VCOL_", "")) for v in m.group(1).split(",")]
    skin = VCOL.index(re.search(r"#define COL_SKIN\s+VCOL_(\w+)", game).group(1))
    ink = VCOL.index(re.search(r"#define COL_INK\s+VCOL_(\w+)", game).group(1))
    return poses, blocks, colours("shirt"), colours("trousers"), skin, ink


def shoot(x64sc, prg, model, cycles, out):
    if os.path.exists(out):
        os.remove(out)
    args = [x64sc, "-default", "-warp", "+sound", "+autostart-delay-random", "-autostartprgmode", "1",
            "-limitcycles", str(cycles)]
    if model == "ntsc":
        args += ["-model", "ntsc"]
    args += ["-exitscreenshot", out, "-autostart", prg]
    subprocess.run(["timeout", "180"] + args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if not os.path.exists(out):
        sys.exit(f"flickercheck: VICE wrote no {out}")
    return out


def read_state(shot, glyphs):
    """(photo number, camera, fighters) from HUD rows 21-23, or None outside a stop."""
    row21 = check.read_text(shot, glyphs, 21, 0, 16)
    m = re.match(r"PHOTO (\d) CAM ([0-9A-F]{4})", row21)
    if not m:
        return None
    fighters = []
    for f in range(4):
        t = check.read_text(shot, glyphs, 22 + f // 2, (f & 1) * 14, 11)
        if not re.fullmatch(r"[0-9A-F]{11}", t):
            sys.exit(f"flickercheck: {shot.path}: fighter {f} reads '{t}'")
        fighters.append(dict(x=int(t[0:4], 16), y=int(t[4:6], 16), h=int(t[6:8], 16), pose=int(t[8], 16),
                             face=int(t[9], 16), kind=int(t[10], 16)))
    return int(m.group(1)), int(m.group(2), 16), fighters


def render(state, model):
    """{(vic_x, line): set of acceptable colour indices} for every sprite pixel the model expects,
    and per part the pixels it owns (for the report)."""
    poses, blocks, shirt, trousers, skin, ink = model
    _, cam, fighters = state
    # Nearest (largest ground line) first; fighters on one line may be in either order.
    order = sorted(range(4), key=lambda f: -fighters[f]["y"])
    want, owner = {}, {}
    for f in order:
        fi = fighters[f]
        for k, (b, dx, dy) in enumerate(poses[fi["pose"]]):
            x0 = fi["x"] - cam + 31
            x0 = x0 + dx if fi["face"] == 0 else x0 - 24 - dx
            y0 = fi["y"] - fi["h"] + dy
            if x0 <= 0 or x0 >= 344:
                continue
            art = blocks[b]
            colour = {"a": skin, "b": ink, "x": trousers[fi["kind"]] if k else shirt[fi["kind"]]}
            for r in range(21):
                for c in range(12):
                    ch = art[r][11 - c] if fi["face"] else art[r][c]
                    if ch == ".":
                        continue
                    for px in (0, 1):
                        p = (x0 + 2 * c + px, y0 + 1 + r)
                        if not X_MIN <= p[0] <= X_MAX:
                            continue
                        if p in want:
                            g = owner[p]
                            if fighters[g[0]]["y"] == fi["y"] and g[0] != f:
                                want[p].add(colour[ch])      # a tie: either may be in front
                            continue
                        want[p] = {colour[ch]}
                        owner[p] = (f, k)
    return want, owner


def compare(shot, want, owner):
    bad = {}
    total = {}
    for (vx, line), ok in want.items():
        x, y = check.point_xy({"vic_x": vx, "line": line}, shot.model)
        part = owner[(vx, line)]
        total[part] = total.get(part, 0) + 1
        if shot.index(x, y) not in ok:
            bad[part] = bad.get(part, 0) + 1
    return bad, total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--x64sc", required=True)
    ap.add_argument("--src", default="src")
    ap.add_argument("--expect", choices=("whole", "dropped"), required=True)
    ap.add_argument("--model", choices=("pal", "ntsc"), default="pal")
    ap.add_argument("--out", default="shots/flicker")
    ap.add_argument("prg")
    ap.add_argument("cycles", nargs="+", type=int)
    a = ap.parse_args()
    model = load_model(a.src)
    glyphs = check.load_glyphs()
    os.makedirs(a.out, exist_ok=True)
    tag = os.path.splitext(os.path.basename(a.prg))[0]
    outs = [os.path.join(a.out, f"{tag}-{a.model}-{c}.png") for c in a.cycles]
    with ThreadPoolExecutor(max_workers=4) as ex:
        list(ex.map(lambda co: shoot(a.x64sc, a.prg, a.model, co[0], co[1]), zip(a.cycles, outs)))
    whole = broken = 0
    for c, out in zip(a.cycles, outs):
        shot = check.Shot(out, a.model)
        state = read_state(shot, glyphs)
        if state is None:
            sys.exit(f"flickercheck: {out} ({c} cycles) is not inside a photo stop: re-pin it")
        want, owner = render(state, model)
        bad, total = compare(shot, want, owner)
        parts = len(total)
        miss = sum(bad.values())
        what = "whole" if not bad else "PART WRONG: " + ", ".join(
            f"fighter {f} part {k} {bad[(f, k)]} of {total[(f, k)]} px" for f, k in sorted(bad))
        print(f"  {a.model.upper()} {c:>10} photo {state[0]} cam {state[1]}: {parts} parts, "
              f"{len(want) - miss} of {len(want)} sprite pixels match: {what}")
        if bad:
            broken += 1
        else:
            whole += 1
    n = len(a.cycles)
    if a.expect == "whole":
        ok = broken == 0
        print(f"flickercheck: {whole} of {n} shots whole" + ("" if ok else ": FAIL"))
    else:
        ok = broken > 0
        print(f"flickercheck: {broken} of {n} shots with a part missing (the demo must show one)"
              + ("" if ok else ": FAIL, the check did not see the dropped part"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
