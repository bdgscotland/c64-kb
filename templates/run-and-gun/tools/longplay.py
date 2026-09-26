#!/usr/bin/env python3
"""longplay.py [--model pal|ntsc] PRG MAP: the normal build played for about
2,700 frames on the real $DC00 (harness/drive.py's Vice class), then its own
counters read from RAM by the addresses in Oscar64's .map file.

The stick walks up (scrolling), fires in taps and held bursts, and walks the
diagonals, left, right and down, four times over. The run fails unless
LOST_FRAMES ($02FD) is 0, no redraw started late, every redraw kept at least
MIN_LEAD lines over the beam, and every frame after a redraw ended before line
250. PLAN.md, "Combined budget", records what it printed.
"""
import argparse
import os
import sys

sys.path.insert(0, os.environ.get("HARNESS_DIR", os.path.join(os.path.dirname(__file__), "..", "harness")))
import drive  # noqa: E402

UP, DOWN, LEFT, RIGHT, FIRE = 1, 2, 4, 8, 16
PATTERN = [
    (UP, 120), (UP | FIRE, 8), (UP, 40), (FIRE, 3), (0, 6), (UP | LEFT, 60), (UP, 100),
    (UP | RIGHT, 60), (FIRE, 3), (0, 6), (UP | FIRE, 40), (DOWN, 20), (LEFT, 30),
    (UP, 80), (FIRE, 3), (0, 6), (RIGHT, 30), (UP, 60),
]
ROUNDS = 4
MIN_LEAD = 8
VARS = ["play_frames", "scroll_steps", "rd_count", "rd_lead", "rd_late", "rd_cyc",
        "rd_start_min", "pre_end", "light_end", "shots_fired", "overruns"]


def symbols(path):
    out = {}
    for line in open(path):
        parts = line.split()
        # "41fe - 4200 : scroll_wy, DATA:bss"
        if len(parts) >= 5 and parts[1] == "-" and parts[3] == ":":
            out[parts[4].rstrip(",")] = (int(parts[0], 16), int(parts[2], 16) - int(parts[0], 16))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="pal")
    ap.add_argument("prg")
    ap.add_argument("map")
    a = ap.parse_args()
    syms = symbols(a.map)
    missing = [v for v in VARS if v not in syms]
    if missing:
        print(f"longplay: {', '.join(missing)} not in {a.map}")
        return 2
    vice = drive.Vice(a.prg, model=a.model, screen="8000:0-23")
    try:
        vice.until("PUSH FIRE TO START")
        vice.joy(FIRE)
        vice.frames(3)
        vice.joy(0)
        vice.until("LIVES 3")
        frames = 0
        for _ in range(ROUNDS):
            for bits, n in PATTERN:
                vice.joy(bits)
                vice.frames(n)
                frames += n
        vice.joy(0)
        got = {}
        for v in VARS:
            addr, n = syms[v]
            b = vice.mem(addr, n)
            val = int.from_bytes(b, "little")
            if v == "rd_lead" and val >= 0x8000:
                val -= 0x10000
            got[v] = val
        lost = vice.mem(0x02FD, 1)[0]
    finally:
        vice.quit()
    print(f"longplay {a.model.upper()}: {frames} frames driven, " +
          ", ".join(f"{k} {v}" for k, v in got.items()) + f", LOST_FRAMES {lost}")
    bad = []
    if lost:
        bad.append(f"LOST_FRAMES {lost}")
    if got["rd_late"]:
        bad.append(f"{got['rd_late']} redraws late")
    if got["rd_count"] and got["rd_lead"] < MIN_LEAD:
        bad.append(f"redraw lead {got['rd_lead']} lines, under {MIN_LEAD}")
    if got["light_end"] >= 250:
        bad.append(f"a frame after a redraw ended on line {got['light_end']}")
    if got["play_frames"] < 2500:
        bad.append(f"only {got['play_frames']} frames of play")
    if bad:
        print(f"longplay {a.model.upper()}: FAIL, " + "; ".join(bad))
        return 1
    print(f"longplay {a.model.upper()}: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
