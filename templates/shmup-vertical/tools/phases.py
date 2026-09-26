#!/usr/bin/env python3
"""phases.py: the panel split at every YSCROLL phase (make phases).

    python3 tools/phases.py --x64sc X --d64 build/shmup-vertical.d64 \
        --pal 30000000 --ntsc 30000000 build/shmup-vertical-ph0.prg ... -ph7.prg

Each PRG is the autopilot build frozen on one phase (-dFREEZE_Y=k). Every one
is shot on PAL and NTSC with a copy of the disk on drive 8, and the display
window of the panel's lines 207-246, its five rows, is compared pixel by pixel with the
phase-3 shot, which make check grades. A phase whose split writes land late
shows playfield characters in the panel's first row and fails here; the
graded shot, frozen on phase 3 only, cannot see that. Exit 1 on any
difference, 2 on a run that wrote no picture.
"""
import argparse
import os
import shutil
import subprocess
import sys

from PIL import Image

OFFSET = {"pal": 16, "ntsc": 28}            # screenshot row = raster line - offset
PANEL_FIRST = 207                           # kernel.asm LAST_PF + 1; 215 before #107
PANEL_LAST = 246                            # RSEL = 0: the border from line 247; 250 before #107


def shoot(x64sc, prg, d64, cycles, model, png):
    disk = png[:-4] + ".d64"
    shutil.copyfile(d64, disk)
    if os.path.exists(png):
        os.remove(png)
    cmd = [x64sc, "-default", "-warp", "+sound", "+autostart-delay-random", "-autostartprgmode", "1",
           "-limitcycles", str(cycles)] + (["-model", "ntsc"] if model == "ntsc" else []) + [
           "-8", disk, "-drive8wobbleamplitude", "0", "-drive8wobblefrequency", "0",
           "-exitscreenshot", png, "-autostart", prg]
    subprocess.run(["timeout", "180"] + cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    os.remove(disk)
    if not os.path.exists(png):
        sys.exit(f"phases: {prg} wrote no {png}")


def panel(png, model):
    im = Image.open(png).convert("RGB")
    return [im.getpixel((x, line - OFFSET[model])) for line in range(PANEL_FIRST, PANEL_LAST + 1) for x in range(32, 352)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--x64sc", required=True)
    ap.add_argument("--d64", required=True)
    ap.add_argument("--pal", type=int, required=True)
    ap.add_argument("--ntsc", type=int, required=True)
    ap.add_argument("--out", default="shots")
    ap.add_argument("prgs", nargs=8)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    bad = 0
    for model in ("pal", "ntsc"):
        shots = []
        for k, prg in enumerate(a.prgs):
            png = os.path.join(a.out, f"phase{k}-{model}.png")
            shoot(a.x64sc, prg, a.d64, getattr(a, model), model, png)
            shots.append(panel(png, model))
        for k in range(8):
            diff = sum(1 for p, q in zip(shots[k], shots[3]) if p != q)
            print(f"{'PASS' if diff == 0 else 'FAIL'} {model.upper():4s} YSCROLL {k}: "
                  f"{diff} pixels of panel lines {PANEL_FIRST}-{PANEL_LAST} differ from YSCROLL 3")
            bad += diff != 0
    print(f"phases: {16 - bad} of 16 panels match")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
