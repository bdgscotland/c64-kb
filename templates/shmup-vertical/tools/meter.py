#!/usr/bin/env python3
"""meter.py HARNESS PNG MODEL...: print the frame meter's readout (row 13, column 10) of each shot.

make stage uses it on the STAGE build, which has no verdict to grade.
"""
import sys

sys.path.insert(0, sys.argv[1])
import check  # noqa: E402  (the harness's check.py)

glyphs = check.load_glyphs()
args = sys.argv[2:]
for png, model in zip(args[0::2], args[1::2]):
    shot = check.Shot(png, model)
    print(f"stage {model.upper():4s} {check.read_text(shot, glyphs, 13, 10, 20)}")
