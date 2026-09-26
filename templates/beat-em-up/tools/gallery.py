#!/usr/bin/env python3
"""gallery.py PRG STEP...: make gallery's player for the normal build.

drive.py's steps, plus one of its own:

  fight:FRAMES  play FRAMES frames as the autopilot's bot does (src/autopilot.h,
                ap_fight): pick the nearest enemy that can be hit, line up in his
                lane, close to punch range, then punch, punch, punch, kick, jump
                kick; walk right when the stage is clear. It reads the fighters
                from RAM each frame, at the addresses Oscar64's map gives
                (build/NAME.map beside the PRG), and presses the stick on $DC00.

The normal build has no bot, so a scripted stick cannot keep a fight going
long enough to reach the brute; this one can. Time is emulated frames, so the
same steps give the same picture every run. HARNESS_DIR (set by make gallery)
says where drive.py is.
"""
import os
import re
import sys

sys.path.insert(0, os.environ.get("HARNESS_DIR", "harness"))
import drive  # noqa: E402  harness/drive.py

UP, DOWN, LEFT, RIGHT, FIRE = (drive.BITS[k] for k in ("up", "down", "left", "right", "fire"))
M_FREE, M_ATTACK, M_JUMP, M_HURT = 1, 2, 3, 4      # src/game.h, enum Mode
FACE_LEFT = 1                                      # src/game.h
KICK_ARC = 5                                       # autopilot.h: the kick, early in the jump arc
NFIGHT = 4
PATTERN = ("punch", "punch", "punch", "kick", "jump")


def symbols(prg):
    """name -> address for the map's data symbols ('5b6f - 5b73 : fmode, DATA:bss')."""
    out = {}
    with open(os.path.splitext(prg)[0] + ".map") as f:
        for line in f:
            m = re.match(r"([0-9a-f]{4}) - [0-9a-f]{4} : (\w+), DATA", line)
            if m:
                out[m.group(2)] = int(m.group(1), 16)
    return out


class Bot:
    def __init__(self, vice, sym):
        self.vice, self.sym = vice, sym
        self.move, self.last = 0, 0

    def read(self, name, n, width=1):
        d = self.vice.mem(self.sym[name], n * width)
        return [int.from_bytes(d[i * width:i * width + width], "little") for i in range(n)]

    def target(self, mode, fx, fy, camx):
        best, dist = 0, None
        for f in range(1, NFIGHT):
            if mode[f] in (M_FREE, M_ATTACK, M_HURT, M_JUMP) and camx + 8 < fx[f] < camx + 312:
                d = abs(fx[f] - fx[0]) + 2 * abs(fy[f] - fy[0])
                if dist is None or d < dist:
                    best, dist = f, d
        return best

    def stick(self):
        mode = self.read("fmode", NFIGHT)
        if mode[0] == M_JUMP:
            return FIRE if self.read("farc", 1)[0] == KICK_ARC else 0
        if mode[0] != M_FREE:
            return 0
        fx, fy = self.read("fx", NFIGHT, 2), self.read("fy", NFIGHT)
        t = self.target(mode, fx, fy, self.read("camx", 1, 2)[0])
        if not t:
            return RIGHT if self.read("stage_clear", 1)[0] else 0
        dx, ady = fx[t] - fx[0], abs(fy[t] - fy[0])
        toward, away = (LEFT, RIGHT) if dx < 0 else (RIGHT, LEFT)
        if ady > 2:
            return (DOWN if fy[t] > fy[0] else UP) | (away if abs(dx) < 12 else 0)
        if abs(dx) > 18:
            return toward
        if abs(dx) < 8:
            return away
        if (dx < 0) != (self.read("fface", 1)[0] == FACE_LEFT):
            return toward
        if self.last & FIRE:                       # held last frame: release first
            return 0
        attack = PATTERN[self.move]
        self.move = (self.move + 1) % len(PATTERN)
        return FIRE | {"punch": 0, "kick": toward, "jump": UP | toward}[attack]

    def fight(self, frames):
        for _ in range(frames):
            self.last = self.stick()
            self.vice.joy(self.last)
            self.vice.frames(1)


def main():
    prg = sys.argv[1]
    vice = drive.Vice(prg)
    bot = Bot(vice, symbols(prg))
    try:
        for s in sys.argv[2:]:
            name, _, arg = s.partition(":")
            if name == "fight":
                bot.fight(int(arg))
            else:
                drive.step(vice, name, arg)
    except drive.Fail as e:
        print(f"gallery: FAIL, {e}")
        return 1
    finally:
        vice.quit()
    return 0


if __name__ == "__main__":
    sys.exit(main())
