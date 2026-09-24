#!/usr/bin/env python3
"""watch.py PRG --model pal|ntsc --cycles N [--deadline LINE] [--sid-frames N]:
two checks a screenshot cannot make, from one headless VICE run with a
monitor trace (the -moncommands / -monlog mechanism c64-kb's claims-watch
uses, src/services/vice-batch.ts).

--deadline LINE  every frame's work ends before raster line LINE. The program
                 marks the work: WORK_BEGIN stores $01 to $02FE when it starts,
                 WORK_END stores $00 when it ends (meter/frame_meter.h, .asm).
                 Each end is held to the first start of line LINE after its
                 begin, counted in CPU cycles, so work that runs a whole frame
                 or more late fails too; a raster line read alone cannot see
                 that. Fails when no begin-end pair was seen.
--sid-frames N   the player writes the SID: stores to $D400-$D7FF in at least
                 N frames of the run. A build whose player never runs still
                 writes the SID at init and when an effect starts; N is set
                 from a measured run, above what those leave.

A frame starts at raster line 0: each hit's frame is its clock less its
line and cycle (the trace's head gives both; src/re/monlog.ts reads the same
lines). PAL is 312 lines of 63 cycles, NTSC (6567R8) 263 of 65.

Other options: --x64sc PATH, --sound off|dump|wav (harness.mk's SOUND_SINK),
--disk D64 (attached through a copy), --log FILE (grade a saved trace, no
VICE), --keep-log FILE. Exit 0 every check passed, 1 one failed (a FAIL line
names it), 2 nothing was graded.
"""
import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile

MARK = 0x02FE
SID = (0xD400, 0xD7FF)
MODELS = {"pal": (63, 312), "ntsc": (65, 263)}
HEAD = re.compile(r"^#\d+ \(Trace\s+(store|exec|load)\s+([0-9a-f]{4})\)\s+(\d+)/\$[0-9a-f]+,\s+(\d+)/\$[0-9a-f]+")
INSN = re.compile(r"^\.C:([0-9a-f]{4})\s+(?:[0-9A-F]{2} )+\s*([A-Z]{3})\s*(.*?)\s*- A:([0-9A-F]{2}) "
                  r"X:([0-9A-F]{2}) Y:([0-9A-F]{2}) SP:[0-9a-f]{2}\s+\S+\s+(\d+)")
STORED = {"STA": lambda a, x, y: a, "STX": lambda a, x, y: x, "STY": lambda a, x, y: y,
          "SAX": lambda a, x, y: a & x}


class Refused(Exception):
    pass


def hits(lines):
    """(address, value or None, clock, line, cycle) per store hit: a head line, then the instruction."""
    head = None
    for text in lines:
        if head is not None:
            i = INSN.match(text)
            if i:
                a, x, y = (int(i.group(k), 16) for k in (4, 5, 6))
                value = STORED[i.group(2)](a, x, y) if i.group(2) in STORED else None
                yield int(head.group(2), 16), value, int(i.group(7)), int(head.group(3)), int(head.group(4))
        head = HEAD.match(text)


def frame_start(clock, line, cycle, cpl):
    return clock - (line * cpl + cycle)


def deadline(events, limit, model):
    """events: (value, clock, line, cycle) of each store to the mark, in order."""
    cpl, lines = MODELS[model]
    frame = cpl * lines
    begun, pairs, worst, late = None, 0, None, []
    for value, clock, line, cycle in events:
        if value is None:
            raise Refused(f"a store to ${MARK:04X} at clock {clock} is not STA/STX/STY/SAX: its value is unknown")
        if value == 1:
            begun = begun or (clock, line, cycle)
        elif value == 0 and begun:
            b_clock, b_line, b_cycle = begun
            due = frame_start(b_clock, b_line, b_cycle, cpl) + limit * cpl + (frame if b_line >= limit else 0)
            spare = due - clock
            pairs += 1
            if worst is None or spare < worst[0]:
                worst = (spare, b_line, line)
            if spare <= 0:
                late.append((pairs, b_line, line, -spare))
            begun = None
    tag = model.upper()
    if not pairs:
        return False, f"FAIL {tag:5} deadline: no WORK_BEGIN / WORK_END pair (stores of $01, $00 to ${MARK:04X}) in the run"
    spare, b_line, e_line = worst
    if late:
        n, b, e, over = late[0]
        return False, (f"FAIL {tag:5} deadline: {len(late)} of {pairs} frames' work ended at or past line {limit}; "
                       f"the first, pair {n}, began on line {b} and ended on line {e}, {over} cycles late")
    return True, (f"PASS {tag:5} deadline: {pairs} frames' work, each ended before line {limit}; "
                  f"the least to spare {spare} cycles ({spare // cpl} lines: began line {b_line}, ended line {e_line})")


def sid(events, least, model, cycles):
    cpl, lines = MODELS[model]
    frame = cpl * lines
    starts = [frame_start(c, ln, cy, cpl) for c, ln, cy in events]
    tag = model.upper()
    if not starts:
        return False, f"FAIL {tag:5} sid: no store to $D400-$D7FF in {cycles} cycles"
    first = starts[0]
    frames = {round((s - first) / frame) for s in starts}
    span = max(frames) + 1
    text = (f"stores to $D400-$D7FF in {len(frames)} frames ({len(events)} stores, "
            f"{span} frames from the first to the last); want at least {least}")
    return len(frames) >= least, f"{'PASS' if len(frames) >= least else 'FAIL'} {tag:5} sid: {text}"


def run_vice(a, log):
    cmds = [f"trace store {SID[0]:04x} {SID[1]:04x}"] if a.sid_frames else []
    cmds += [f"trace store {MARK:04x} {MARK:04x}"] if a.deadline is not None else []
    work = tempfile.mkdtemp(prefix="watch-")
    try:
        shutil.copy(a.prg, os.path.join(work, "p.prg"))
        with open(os.path.join(work, "watch.mon"), "w") as f:
            f.write("\n".join(cmds) + "\n")
        sound = ["+sound"] if a.sound == "off" else ["-sound", "-sounddev", a.sound, "-soundarg", os.devnull]
        args = [a.x64sc, "-default", "-warp", *sound, "+autostart-delay-random", "-autostartprgmode", "1"]
        args += ["-model", "ntsc"] if a.model == "ntsc" else []
        if a.disk:
            shutil.copy(a.disk, os.path.join(work, "d.d64"))
            args += ["-8", "d.d64", "-drive8wobbleamplitude", "0", "-drive8wobblefrequency", "0"]
        args += ["-moncommands", "watch.mon", "-monlog", "-monlogname", log,
                 "-limitcycles", str(a.cycles), "-autostart", "p.prg"]
        env = dict(os.environ)
        if os.path.isdir("/opt/homebrew/share/glib-2.0/schemas"):
            env.setdefault("GSETTINGS_SCHEMA_DIR", "/opt/homebrew/share/glib-2.0/schemas")
        # The windowless x64sc echoes every hit to stdout: discarded, or the pipe fills.
        # It exits 1 after -limitcycles, pass or fail.
        r = subprocess.run(args, cwd=work, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if r.returncode not in (0, 1) or not os.path.exists(log):
            raise Refused(f"{a.x64sc} exited {r.returncode} and wrote no monitor log")
    finally:
        shutil.rmtree(work, ignore_errors=True)


def grade(a, lines):
    marks, sids = [], []
    for addr, value, clock, line, cycle in hits(lines):
        if addr == MARK:
            marks.append((value, clock, line, cycle))
        elif SID[0] <= addr <= SID[1]:
            sids.append((clock, line, cycle))
    results = []
    if a.deadline is not None:
        results.append(deadline(marks, a.deadline, a.model))
    if a.sid_frames:
        results.append(sid(sids, a.sid_frames, a.model, a.cycles))
    return results


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("prg")
    ap.add_argument("--model", choices=sorted(MODELS), default="pal")
    ap.add_argument("--cycles", type=int, default=8000000)
    ap.add_argument("--deadline", type=int)
    ap.add_argument("--sid-frames", type=int)
    ap.add_argument("--x64sc", default=os.environ.get("X64SC", os.path.expanduser("~/Developer/c64/vice-headless/bin/x64sc")))
    ap.add_argument("--sound", default="off")
    ap.add_argument("--disk")
    ap.add_argument("--log")
    ap.add_argument("--keep-log")
    a = ap.parse_args()
    tag = a.model.upper()
    try:
        if a.deadline is None and not a.sid_frames:
            raise Refused("nothing to check: give --deadline, --sid-frames or both")
        if a.deadline is not None and not 0 < a.deadline < MODELS[a.model][1]:
            raise Refused(f"--deadline {a.deadline} is not a raster line of {tag} (1 to {MODELS[a.model][1] - 1})")
        if a.log:
            log = a.log
        else:
            fd, log = tempfile.mkstemp(prefix="watch-", suffix=".log")
            os.close(fd)
            run_vice(a, log)
            if a.keep_log:
                shutil.copy(log, a.keep_log)
        with open(log, errors="replace") as f:
            results = grade(a, f)
        if not a.log:
            os.unlink(log)
    except (Refused, OSError) as e:
        print(f"FAIL REFUSED {tag}: {e}")
        print(f"watch: {e}", file=sys.stderr)
        return 2
    for _, text in results:
        print(text)
    return 0 if all(ok for ok, _ in results) else 1


if __name__ == "__main__":
    sys.exit(main())
