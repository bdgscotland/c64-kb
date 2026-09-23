#!/usr/bin/env python3
"""joytest.py PRG D64: the normal game played headless, twice, on one fresh disk (make joytest).

Run 1: the title on a fresh disk must show HI 000000. Fire starts a game;
the stick holds fire and stays still until GAME OVER and the title again
(the save runs in between); the panel's SCORE is read. Run 2, same disk, a new machine: the
title's HI must be that score, loaded from HISCORE. Exit 1 on any mismatch or
a step that never came (tools/drive.py's 300 s limit).
"""
import os
import re
import shutil
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
import drive  # noqa: E402


def panel(vice):
    rows = vice.rows()[42:]                          # the panel's rows 21-23
    m = re.search(r"SCORE (\d{6}) +HI (\d{6})", rows[0])
    return (m.group(1), m.group(2)) if m else (None, None)


def until(vice, text):
    t0 = time.time()
    while not any(text in r for r in vice.rows()):
        if time.time() - t0 > 300:
            sys.exit(f"joytest: '{text}' never appeared")
        vice.run(0.1)


def main():
    prg, d64 = sys.argv[1], sys.argv[2]
    disk = "shots/joytest.d64"
    os.makedirs("shots", exist_ok=True)
    shutil.copyfile(d64, disk)
    os.environ["DRIVE_DISK"] = disk

    vice = drive.Vice(prg)
    try:
        vice.joy(0)
        until(vice, "PUSH FIRE")
        vice.run(1.0)                                # the start-up disk read is done by now
        score, hi = panel(vice)
        print(f"joytest: fresh disk, title HI {hi}")
        if hi != "000000":
            sys.exit("joytest: FAIL, a fresh disk's title should show HI 000000")
        vice.joy(16)
        vice.run(0.05)
        vice.joy(0)
        vice.run(0.1)
        vice.joy(16)                                 # hold fire, stay put
        until(vice, "GAME OVER")
        vice.joy(0)
        until(vice, "PUSH FIRE")
        score, hi = panel(vice)
        print(f"joytest: game over, SCORE {score} HI {hi}")
    finally:
        vice.quit()

    vice = drive.Vice(prg)
    try:
        vice.joy(0)
        until(vice, "PUSH FIRE")
        if score == "000000":
            sys.exit("joytest: FAIL, the game scored nothing, so the save proves nothing")
        until(vice, f"HI {score}")                   # the load lands after the title shows
        print(f"joytest: reboot on the same disk, title HI {score}")
    finally:
        vice.quit()
    print("joytest: PASS")


if __name__ == "__main__":
    main()
