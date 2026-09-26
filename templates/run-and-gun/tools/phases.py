#!/usr/bin/env python3
"""phases.py: the invalid-mode band and the panel at every YSCROLL phase (make phases).

    python3 tools/phases.py --x64sc X --pal 10000000 --ntsc 10000000 build/run-and-gun-ph0.prg ... -ph7.prg

Each PRG is the autopilot build frozen on one phase (-dFREEZE_YS=k -dPHASES=1),
with the soldier moved to the lowest sprite Y (187, last line 208). Every
one is shot on PAL and NTSC. For each shot: line 213 is still playfield
(not all black), lines 214-222 are black across the 320-pixel window,
lines 223-246 (the panel) are pixel-identical to the YSCROLL 3 shot, the
soldier is drawn at the bottom (his white on line 200 or lower; his last
lines, 205-208, are black boots and outline).
Exit 1 on any failure, 2 on a run that wrote no picture.
"""
import argparse
import os
import subprocess
import sys

from PIL import Image

OFFSET = {"pal": 16, "ntsc": 28}            # screenshot row = raster line - offset
WHITE = (255, 255, 255)
BLACK = (0, 0, 0)


def shoot(x64sc, prg, cycles, model, png):
    if os.path.exists(png):
        os.remove(png)
    cmd = [x64sc, "-default", "-warp", "+sound", "+autostart-delay-random", "-autostartprgmode", "1",
           "-limitcycles", str(cycles)] + (["-model", "ntsc"] if model == "ntsc" else []) + [
           "-exitscreenshot", png, "-autostart", prg]
    subprocess.run(["timeout", "180"] + cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if not os.path.exists(png):
        print(f"FAIL REFUSED phases: {prg} wrote no {png}")
        sys.exit(2)


def line(im, model, n):
    return [im.getpixel((x, n - OFFSET[model])) for x in range(32, 352)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--x64sc", required=True)
    ap.add_argument("--pal", type=int, required=True)
    ap.add_argument("--ntsc", type=int, required=True)
    ap.add_argument("--out", default="shots")
    ap.add_argument("prgs", nargs=8)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    bad = 0
    for model in ("pal", "ntsc"):
        ims = []
        for k, prg in enumerate(a.prgs):
            png = os.path.join(a.out, f"phase{k}-{model}.png")
            shoot(a.x64sc, prg, getattr(a, model), model, png)
            ims.append(Image.open(png).convert("RGB"))
        ref = [line(ims[3], model, n) for n in range(223, 247)]
        for k, im in enumerate(ims):
            fails = []
            if all(p == BLACK for p in line(im, model, 213)):
                fails.append("line 213 is black")
            for n in range(214, 223):
                if any(p != BLACK for p in line(im, model, n)):
                    fails.append(f"line {n} not black")
                    break
            diff = sum(p != q for n, r in zip(range(223, 247), ref) for p, q in zip(line(im, model, n), r))
            if diff:
                fails.append(f"{diff} panel pixels differ from YSCROLL 3")
            last_white = max((n for n in range(180, 223) if WHITE in line(im, model, n)), default=None)
            if last_white is None or last_white < 200:
                fails.append(f"soldier's last white line {last_white}, want 200 or lower")
            print(f"{'FAIL' if fails else 'PASS'} {model.upper():4s} YSCROLL {k}: " +
                  ("; ".join(fails) if fails else f"band 214-222 black, panel 223-246 as YSCROLL 3, soldier white to line {last_white}"))
            bad += bool(fails)
    print(f"phases: {16 - bad} of 16 pass")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
