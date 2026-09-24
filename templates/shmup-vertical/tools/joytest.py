#!/usr/bin/env python3
"""joytest.py PRG D64 --harness DIR [--models pal,ntsc] [--soak N] [--jobs J] [--long S]: the game played headless (make joytest, make longplay).

Each model, a fresh disk: the title must show HI 000000. Fire starts a game;
the stick holds fire and sweeps the ship left and right until GAME OVER and
the title again (the save runs in between). The panel's SCORE is read, and
LOST_FRAMES ($02FD, main.c: play frames whose work ran past the next frame
IRQ) must be 0. Then a new machine on the same disk: the title's HI must be
that score, loaded from HISCORE.

--soak N plays N more games per model (J machines at once, fresh disk
each), each graded on its lost frames only. Game n waits n frames longer
before it starts and sweeps with its own period, so no two games are the
same; each is the same on every run, because harness/drive.py counts time
in emulated frames. (An earlier version paced the stick by the wall clock
against a machine in warp, so no game could be repeated.) Exit 1 on any
failure or a step that never came (DRIVE_LIMIT frames, default 18,000).

--long S (make longplay, a build with -dGOD=1, whose ship is never lost):
each game is played for S seconds of emulated time, through the level's
later loops where the waves come closer together, and graded on its lost
frames; the play frames it reached are read from $02FB (GOD builds only).

The stick is the real $DC00: drive.py sets control port 2's lines through
VICE's Joyport I/O simulation device.
"""
import argparse
import os
import re
import shutil
import sys
import tempfile
import threading

HARNESS = sys.argv[sys.argv.index("--harness") + 1] if "--harness" in sys.argv[:-1] else "harness"
sys.path.insert(0, HARNESS)
import drive  # noqa: E402  harness/drive.py

LOST_FRAMES = 0x02fd                                # main.c
PLAY_FRAMES = 0x02fb                                # main.c, -dGOD=1 builds
FIRE, LEFT, RIGHT = 16, 4, 8
SCREEN = "8000:0-20,8400:0-20,8800:20-22"          # src/game.h PF0, PF1; the panel's text rows (21-23 before #107)
STEP = 0.1                                          # seconds of emulated time per stick move


class Fail(Exception):
    pass


def panel(vice):
    rows = vice.rows()[42:]                          # the panel's rows 20-22
    m = re.search(r"SCORE (\d{6}) +HI (\d{6})", rows[0])
    return (m.group(1), m.group(2)) if m else (None, None)


def on_screen(vice, text):
    return any(text in r for r in vice.rows())


def until(vice, text):
    try:
        vice.until(text)
    except drive.Fail as e:
        raise Fail(str(e))


def play(prg, disk, model, period, start, long=0):
    """One game on a fresh disk: returns (score, lost frames, play frames or None)."""
    vice = drive.Vice(prg, disk, model, SCREEN)
    try:
        until(vice, "PUSH FIRE")
        vice.run(1.0)                                # the start-up disk read is done by now
        _, hi = panel(vice)
        if hi != "000000":
            raise Fail(f"a fresh disk's title shows HI {hi}, not 000000")
        vice.frames(start)
        vice.joy(FIRE)
        vice.frames(3)
        vice.joy(0)
        vice.frames(6)
        k = 0
        while long or not on_screen(vice, "GAME OVER"):  # hold fire, sweep left and right
            vice.joy(FIRE | (LEFT if (k // period) % 2 == 0 else RIGHT))
            vice.run(STEP)
            k += 1
            if long and k * STEP >= long:
                score, _ = panel(vice)
                m = vice.mem(PLAY_FRAMES, 3)
                return score, m[2], m[0] + 256 * m[1]
            if not long and k * STEP > 360:
                raise Fail("'GAME OVER' never appeared in 360 s of play")
        vice.joy(0)
        until(vice, "PUSH FIRE")
        score, _ = panel(vice)
        return score, vice.mem(LOST_FRAMES, 1)[0], None
    finally:
        vice.quit()


def reboot(prg, disk, model, score):
    vice = drive.Vice(prg, disk, model, SCREEN)
    try:
        until(vice, "PUSH FIRE")
        until(vice, f"HI {score}")                   # the load lands after the title shows
    finally:
        vice.quit()


def game(prg, d64, model, n, full, out, long=0):
    period = 3 + n % 5                              # 0.3 to 0.7 s a way
    start = n                                       # frames waited on the title before fire
    with tempfile.TemporaryDirectory() as tmp:
        disk = os.path.join(tmp, "joytest.d64")
        shutil.copyfile(d64, disk)
        try:
            score, lost, frames = play(prg, disk, model, period, start, long)
            detail = f"SCORE {score}, {lost} lost frames"
            if frames is not None:
                detail += f" in {frames} play frames (the count wraps at 65,536)"
            if lost:
                raise Fail(f"{detail}: a play frame's work ran past the next frame IRQ")
            line = f"{model} game {n}: {detail}"
            if full:
                if score == "000000":
                    raise Fail(f"SCORE {score}: the game scored nothing, so the save proves nothing")
                reboot(prg, disk, model, score)
                line += f"; reboot on the same disk shows HI {score}"
            out.append((n, True, line))
        except Fail as e:
            out.append((n, False, f"{model} game {n}: FAIL, {e}"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("prg")
    ap.add_argument("d64")
    ap.add_argument("--harness", default="harness")
    ap.add_argument("--models", default="pal,ntsc")
    ap.add_argument("--soak", type=int, default=0)
    ap.add_argument("--jobs", type=int, default=4)
    ap.add_argument("--long", type=float, default=0)
    a = ap.parse_args()
    ok = True
    for model in a.models.split(","):
        out = []
        first = 0 if a.long else 1                  # a long game has no save to check
        if not a.long:
            game(a.prg, a.d64, model, 0, True, out)
        for n in range(first, a.soak + 1, a.jobs):
            ts = [threading.Thread(target=game, args=(a.prg, a.d64, model, m, False, out, a.long))
                  for m in range(n, min(n + a.jobs, a.soak + 1))]
            for t in ts:
                t.start()
            for t in ts:
                t.join()
        for _, good, line in sorted(out):
            print("joytest: " + line)
            ok = ok and good
        lost_games = sum(1 for _, good, _ in out if not good)
        print(f"joytest: {model}: {len(out) - lost_games} of {len(out)} games passed")
    print("joytest: PASS" if ok else "joytest: FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
