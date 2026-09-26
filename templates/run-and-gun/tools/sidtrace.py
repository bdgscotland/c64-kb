#!/usr/bin/env python3
"""sidtrace.py: the SID store trace that proves FIREBASE's audio
(sfx_voice_takeover). Two autopilot builds run headless in VICE with a monitor
store trace (the -moncommands / -monlog mechanism of harness/watch.py): the
normal one, whose script requests eight effects (src/sound.c), and the
-dNO_SFX=1 one, which requests none. Each SID store is named by its writer from
the symbol file (M the music, E the effect engine, I audio_init) and cut into
driver steps by the store sound.asm makes to aud_mark once a step, and into
frames by its clock (a frame starts at raster line 0).

    python3 tools/sidtrace.py --model pal|ntsc --cycles N --sym build/kernel.sym \
        [--x64sc PATH] [--keep DIR] FX.prg NOFX.prg

Checks, each a PASS or FAIL line; exit 0 when all pass, 1 when one fails,
2 when nothing could be graded:
  owned     no music store to voices 1-2 ($D400-$D40D) in a step that starts
            with an effect running (fx_on = $FF)
  voice3    no effect store to voice 3 or the filter and volume ($D40E-$D418);
            the FX build has effect stores, the NOFX build none
  same3     voice 3's music stores, (step, register, value), identical in the
            two builds: the tune on voice 3 does not notice the effects
  same12    voices 1-2's music stores in steps no effect owns, identical in the
            two builds (the notes after an effect come on their own steps)
  tempo     voice 3's note-ons fall on the steps the tune data and the tempo
            give (tools/mktune.py; one tick in AU_SPEED + 1 steps, on NTSC no
            tick count on every sixth step)
  frames    every step runs in its own frame or, the redraw's owed step, in
            the next; one step a frame over the run
It prints the cycles of each timed step (aud_loglo/hi stores, less aud_cal):
worst and median, and the worst step's content.
"""
import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import mktune  # noqa: E402  the tune data, for the tempo check

MODELS = {"pal": (63, 312), "ntsc": (65, 263)}
HEAD = re.compile(r"^#\d+ \(Trace\s+(store|exec|load)\s+([0-9a-f]{4})\)\s+(\d+)/\$[0-9a-f]+,\s+(\d+)/\$[0-9a-f]+")
INSN = re.compile(r"^\.C:([0-9a-f]{4})\s+(?:[0-9A-F]{2} )+\s*([A-Z]{3})\s*(.*?)\s*- A:([0-9A-F]{2}) "
                  r"X:([0-9A-F]{2}) Y:([0-9A-F]{2}) SP:[0-9a-f]{2}\s+\S+\s+(\d+)")
STORED = {"STA": lambda a, x, y: a, "STX": lambda a, x, y: x, "STY": lambda a, x, y: y}


def symbols(path):
    out = {}
    for line in open(path):
        m = re.match(r"\s*\.label\s+(\w+)=\$([0-9a-f]+)", line)
        if m:
            out.setdefault(m.group(1), int(m.group(2), 16))
    return out


def run(x64sc, prg, model, cycles, ranges, log):
    work = tempfile.mkdtemp(prefix="sidtrace-")
    try:
        shutil.copy(prg, os.path.join(work, "p.prg"))
        with open(os.path.join(work, "t.mon"), "w") as f:
            f.write("".join(f"trace store {a:04x} {b:04x}\n" for a, b in ranges))
        args = [x64sc, "-default", "-warp", "+sound", "+autostart-delay-random", "-autostartprgmode", "1"]
        args += ["-model", "ntsc"] if model == "ntsc" else []
        args += ["-moncommands", "t.mon", "-monlog", "-monlogname", log, "-limitcycles", str(cycles), "-autostart", "p.prg"]
        env = dict(os.environ)
        if os.path.isdir("/opt/homebrew/share/glib-2.0/schemas"):
            env.setdefault("GSETTINGS_SCHEMA_DIR", "/opt/homebrew/share/glib-2.0/schemas")
        r = subprocess.run(args, cwd=work, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if r.returncode not in (0, 1) or not os.path.exists(log):
            raise SystemExit(f"FAIL REFUSED: {x64sc} exited {r.returncode} and wrote no monitor log")
    finally:
        shutil.rmtree(work, ignore_errors=True)


def hits(path):
    head = None
    for text in open(path, errors="replace"):
        if head is not None:
            i = INSN.match(text)
            if i:
                a, x, y = (int(i.group(k), 16) for k in (4, 5, 6))
                v = STORED[i.group(2)](a, x, y) if i.group(2) in STORED else None
                yield int(head.group(2), 16), v, int(i.group(1), 16), int(i.group(7)), int(head.group(3)), int(head.group(4))
        head = HEAD.match(text)


class Trace:
    """One run: SID stores per step, fx_on at each step's start, frames, step costs."""

    def __init__(self, path, sym, model):
        cpl, lines = MODELS[model]
        self.frame_len = cpl * lines
        mark, fxon = sym["aud_mark"], sym["fx_on"]
        lo, hi = sym["aud_loglo"], sym["aud_loghi"]
        m0, m1, e0, e1 = sym["au_voice"], sym["fx_engine"], sym["fx_engine"], sym["fx_done"]
        self.sid = []            # (step, reg, value, writer)
        self.step_frame = []     # frame of each step's mark, index step - 1
        self.owned = set()       # steps that start with an effect running
        self.cost = {}           # log index -> [lo, hi]
        self.first = None
        self.timed0 = 0          # the first timed step: sound_start ran (play began)
        on, step = 0, 0
        code = (sym["audio_init"], sym["aud_loglo"])      # sound.asm's code
        for addr, v, pc, clock, line, cycle in hits(path):
            if not code[0] <= pc < code[1]:
                continue                  # Oscar64's start-up copies the blob into place: not the driver
            start = clock - (line * cpl + cycle)
            if addr == mark:
                step += 1
                if self.first is None:
                    self.first = start
                self.step_frame.append(round((start - self.first) / self.frame_len))
                if on:
                    self.owned.add(step)
            elif addr == fxon:
                on = v
            elif lo <= addr < lo + 255:
                self.timed0 = self.timed0 or step
                self.cost.setdefault(addr - lo, [0, 0, step])[0] = v
            elif hi <= addr < hi + 255:
                self.cost.setdefault(addr - hi, [0, 0, step])[1] = v
            elif 0xD400 <= addr <= 0xD418:
                w = "M" if m0 <= pc < m1 else "E" if e0 <= pc <= e1 else "I"
                self.sid.append((step, addr - 0xD400, v, w))
        self.steps = step
        self.cal = None

    def music(self, regs, steps=None):
        return sorted((s, r, v) for s, r, v, w in self.sid
                      if w == "M" and r in regs and (steps is None or s in steps))


def tempo_steps(model, nsteps):
    """Steps (1-based) on which voice 3 starts a note, from the tune data."""
    v3 = [e for bar in mktune.MELODY for e in bar]
    events = [(mktune.note(n), u * mktune.UNIT) for n, u in v3]
    tempo, six, dur, pos, out = 0, 0, 0, 0, []
    for s in range(1, nsteps + 1):
        tick = False
        skip = False
        if model == "ntsc":
            six -= 1
            if six < 0:
                six, skip = 5, True
        if not skip:
            tempo -= 1
            if tempo < 0:
                tempo, tick = mktune.SPEED, True
        if tick:
            dur -= 1
            if dur < 0:
                n, ticks = events[pos]
                pos = (pos + 1) % len(events)
                dur = ticks - 1
                if n:
                    out.append(s)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("fx")
    ap.add_argument("nofx")
    ap.add_argument("--model", choices=sorted(MODELS), default="pal")
    ap.add_argument("--cycles", type=int, default=10000000)
    ap.add_argument("--sym", required=True)
    ap.add_argument("--sym-nofx", help="symbol file of the NOFX build (default --sym)")
    ap.add_argument("--x64sc", default=os.environ.get("X64SC", os.path.expanduser("~/Developer/c64/vice-headless/bin/x64sc")))
    ap.add_argument("--keep", help="directory for the two monitor logs")
    a = ap.parse_args()
    tag = a.model.upper()
    traces = []
    for prg, symfile in ((a.fx, a.sym), (a.nofx, a.sym_nofx or a.sym)):
        sym = symbols(symfile)
        ranges = [(0xD400, 0xD418), (sym["aud_mark"], sym["aud_mark"]), (sym["fx_on"], sym["fx_on"]),
                  (sym["aud_loglo"], sym["aud_loghi"] + 254)]
        fd, log = tempfile.mkstemp(prefix="sidtrace-", suffix=".log")
        os.close(fd)
        run(a.x64sc, prg, a.model, a.cycles, ranges, log)
        t = Trace(log, sym, a.model)
        if a.keep:
            os.makedirs(a.keep, exist_ok=True)
            shutil.copy(log, os.path.join(a.keep, f"{os.path.basename(prg)[:-4]}-{a.model}.log"))
        os.unlink(log)
        traces.append(t)
    fx, nofx = traces
    if not fx.steps or not nofx.steps:
        print(f"FAIL REFUSED {tag}: no aud_mark store in a run: the driver never stepped")
        return 2
    n = min(fx.steps, nofx.steps)
    results = []

    v12 = set(range(0x00, 0x0E))
    bad = [(s, r, v) for s, r, v in fx.music(v12) if s in fx.owned]
    results.append((not bad and fx.owned, f"owned: {len(fx.owned)} steps start with an effect running; "
                    f"music stores to voices 1-2 in them: {len(bad)}" + (f", first step {bad[0][0]} ${0xD400 + bad[0][1]:04X}" if bad else "")))

    e_all = [x for x in fx.sid if x[3] == "E"]
    e3 = [x for x in e_all if x[1] >= 0x0E]
    e_nofx = [x for x in nofx.sid if x[3] == "E"]
    results.append((e_all and not e3 and not e_nofx,
                    f"voice3: effect stores {len(e_all)}, to $D40E-$D418 {len(e3)}; in the NOFX build {len(e_nofx)}"))

    v3 = set(range(0x0E, 0x15))
    a3 = [x for x in fx.music(v3) if x[0] <= n]
    b3 = [x for x in nofx.music(v3) if x[0] <= n]
    diff = next((i for i, (p, q) in enumerate(zip(a3, b3)) if p != q), None)
    results.append((a3 and a3 == b3, f"same3: voice 3 music stores in {n} steps: {len(a3)} and {len(b3)}, "
                    + ("identical in step, register and value" if a3 == b3 else f"first difference at #{diff}")))

    free = set(range(1, n + 1)) - fx.owned
    a12, b12 = fx.music(v12, free), nofx.music(v12, free)
    results.append((a12 and a12 == b12, f"same12: voices 1-2 music stores in the {len(free)} steps no effect owns: "
                    f"{len(a12)} and {len(b12)}, " + ("identical" if a12 == b12 else "different")))

    want = [s for s in tempo_steps(a.model, n)]
    got = sorted({s for s, r, v, w in fx.sid if w == "M" and r == 0x12 and v is not None and v & 1 and s <= n})
    results.append((got and got == want, f"tempo: voice 3 note-ons on {len(got)} steps; the tune data gives {len(want)}; "
                    + ("the same steps" if got == want else f"first difference {next((p, q) for p, q in zip(got + [0], want + [0]) if p != q)}")))

    k0 = max(fx.timed0, 1) - 1
    sf = fx.step_frame[k0:]
    late = [k for k in range(1, len(sf)) if sf[k] - sf[k - 1] not in (0, 1, 2)]
    offs = [f - k for k, f in enumerate(sf)]
    owed = sum(1 for k in range(1, len(offs)) if offs[k] > offs[k - 1])
    results.append((fx.timed0 and not late and max(offs) - min(offs) <= 1,
                    f"frames: from play's start (step {k0 + 1}), {len(sf)} steps in {sf[-1] - sf[0] + 1} frames; "
                    f"each step in its own frame or the next "
                    f"(frame minus step spans {min(offs)}..{max(offs)}, {owed} steps a frame late); "
                    f"gaps outside 0-2 frames: {len(late)}"))

    for ok, text in results:
        print(f"{'PASS' if ok else 'FAIL'} {tag:5} {text}")
    costs = sorted((c[0] + 256 * c[1], c[2]) for c in fx.cost.values())
    if costs:
        med = costs[(len(costs) - 1) // 2][0]
        worst, ws = costs[-1]
        inside = [x for x in fx.sid if x[0] == ws]
        ons = sum(1 for s, r, v, w in inside if w == "M" and r in (0x04, 0x0B, 0x12) and v is not None and v & 1)
        es = sum(1 for x in inside if x[3] == "E")
        print(f"INFO {tag:5} step cycles, stopwatch included (sound.c takes aud_cal off): {len(costs)} timed steps, "
              f"worst {worst} (step {ws}: {ons} note-ons, {es} effect stores, "
              f"{'an effect running' if ws in fx.owned else 'no effect running'} at its start), median {med}, least {costs[0][0]}")
    # The effect engine's own cycles, by difference: the same step of the NOFX build
    # runs the same music, so FX minus NOFX is the engine (a start step: the music
    # still writes voices 1-2 there; a running step: the music skips their writes).
    fxc = {c[2]: c[0] + 256 * c[1] for c in fx.cost.values()}
    noc = {c[2]: c[0] + 256 * c[1] for c in nofx.cost.values()}
    starts = {s for s, r, v, w in fx.sid if w == "E" and r == 0x05}   # the image's AD store: a start
    d_start = [fxc[s] - noc[s] for s in sorted(starts) if s in fxc and s in noc]
    d_run = [fxc[s] - noc[s] for s in sorted(fx.owned - starts) if s in fxc and s in noc]
    if d_start and noc:
        print(f"INFO {tag:5} effect engine by difference: a start {min(d_start)} to {max(d_start)} cycles "
              f"({len(d_start)} starts); a step of a running effect, stolen writes saved, {min(d_run)} to {max(d_run)}; "
              f"NOFX worst step {max(noc.values())}; worst step possible, a start on the NOFX worst: "
              f"{max(noc.values()) + max(d_start)} (arithmetic)")
    return 0 if all(ok for ok, _ in results) else 1


if __name__ == "__main__":
    sys.exit(main())
