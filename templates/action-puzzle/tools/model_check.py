#!/usr/bin/env python3
"""model_check.py HARNESS_DIR PAL.png NTSC.png: every visible cave cell against the model.

The autopilot shot shows cave 2 as it stood at game over, under the table
box. For each cave cell outside the box this reads the colour at the cell's
centre (every element glyph is inked there, see render.c) and compares it
with the colour of the element tools/gen.py's model holds at game over.
Exit 0 when all match on both pictures. `make modelcheck` runs it.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gen  # noqa: E402

TINT = [0, 9, 2, 12, 15, 15, 3, 3, 12, 13, 7, 0,     # render.c tint[], element 0..25
        8, 8, 8, 8, 4, 4, 4, 4, 1, 1, 1, 14, 14, 14]
BOX = (6, 7, 19, 32)                                   # main.c draw_box: rows 6-19, columns 7-32


def main():
    harness, pal, ntsc = sys.argv[1:4]
    sys.path.insert(0, harness)
    import check  # the harness's geometry and palette

    cells = gen.play()["cells"]
    bad = 0
    for path, model in ((pal, "pal"), (ntsc, "ntsc")):
        shot = check.Shot(path, model)
        seen = 0
        for y in range(gen.H):
            for x in range(gen.W):
                row, col = y + 1, x
                if BOX[0] <= row <= BOX[2] and BOX[1] <= col <= BOX[3]:
                    continue
                px, py = check.point_xy({"row": row, "col": col}, model)
                got, want = shot.index(px, py), TINT[cells[y * gen.W + x]]
                seen += 1
                if got != want:
                    bad += 1
                    print(f"FAIL {model.upper()} cave ({x}, {y}): colour {got}, the model's element "
                          f"{cells[y * gen.W + x]} is colour {want}")
        print(f"model_check: {model.upper()} {seen} cave cells compared with the model")
    print("model_check: PASS" if bad == 0 else f"model_check: {bad} cells differ")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
