#!/usr/bin/env python3
"""Grade the tune by the stores it makes to the SID, from a VICE store trace.

usage: audio.py --c64kb DIR --x64sc PATH [--cycles N] build/demo-auto.prg

The demo cannot read its own sound back: under the harness's `+sound`,
VICE returns values from $D41B and $D41C that do not follow the voice
(measured here: they change with no SID write at all), so the verdict
cannot hear a silent player. This check runs c64-kb's claims-watch over the
AUTOPILOT PRG on PAL and counts the program's stores to each SID unit:

- voice 2 (the arpeggio) is written twice every play call, and the tune is
  played every PAL frame from the chain's start. So its stores, less the
  twelve of init, over two, must match the frames from its first store to
  the end of the trace, within SLACK (measured: 447 calls in 451 frames).
- voice 1 (bass) and voice 3 (drums) change on steps, so each must have at
  least one store per step of seven frames; the volume at least one.

Exit 0 when all hold, 1 when one fails, 2 when the trace cannot be run.
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile

PAL_FRAME = 19656
STEP_FRAMES = 7
INIT_V2 = 12                               # m_init: 7 in its clearing loop, 5 to set the voice up
SLACK = 6                                  # frames between init and the first play call:
                                           # measured 4 (the meter's calibration and the
                                           # title's init run between them)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--c64kb", required=True)
    ap.add_argument("--x64sc", required=True)
    ap.add_argument("--cycles", type=int, default=12000000)
    ap.add_argument("prg")
    a = ap.parse_args()
    with tempfile.TemporaryDirectory() as t:
        out = os.path.join(t, "claims.json")
        r = subprocess.run(
            ["node", "scripts/claims-watch.ts", os.path.abspath(a.prg),
             "--claim", "sid_voice_1, sid_voice_2, sid_voice_3, sid_filter_volume",
             "--cycles", str(a.cycles), "--json", out],
            cwd=a.c64kb, env={**os.environ, "X64SC_BIN": a.x64sc}, capture_output=True, text=True)
        if not os.path.exists(out):
            print(r.stdout[-2000:], r.stderr[-2000:])
            print("audio: claims-watch wrote no trace")
            return 2
        with open(out) as f:
            tallies = json.load(f)["tallies"]
    units = {t["target"]: t for t in tallies if t["source"] == "program" and t["target"].startswith("sid_")}
    ok = True
    v2 = units.get("sid_voice_2")
    if not v2:
        print("FAIL audio: no store to voice 2 at all")
        return 1
    calls = (a.cycles - v2["first"]["clock"]) // PAL_FRAME + 1
    played = (v2["count"] - INIT_V2) // 2
    line = f"voice 2: {v2['count']} stores = {played} play calls; {calls} frames from its first store"
    if abs(played - calls) > SLACK:
        print(f"FAIL audio: {line}")
        ok = False
    else:
        print(f"PASS audio: {line}")
    for unit, least in (("sid_voice_1", calls // STEP_FRAMES), ("sid_voice_3", calls // STEP_FRAMES),
                        ("sid_filter_volume", 1)):
        n = units.get(unit, {}).get("count", 0)
        print(f"{'PASS' if n >= least else 'FAIL'} audio: {unit}: {n} stores, want at least {least}")
        ok = ok and n >= least
    print("audio: " + ("the tune writes the SID every frame" if ok else "FAILED"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
