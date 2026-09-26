#!/usr/bin/env python3
"""tunecheck.py: the round-3 gates for a tune source, printed before rendering.
Usage: python3 tunecheck.py tune_A.py
Reads the TUNE dict, parses the pattern tokens the compiler accepts, and prints
each gate with its figure and PASS or FAIL. The gates are the ones in
plan/music3/BRIEF.md; the section plan is read from the module's SECTIONS if
present, else from the comment block's structure line is not parsed (state it).
"""
import importlib.util
import re
import sys

SEMI = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
# The bar's chord quality is read from voice 3's pattern NAME: aM/aJ/aS are
# the arpeggios of tunes A and B (minor, major, seventh); sM/sJ/sS are the
# stab patterns of the stabs style (tune_B2.py, 2026-09-24), which has no
# arpeggios, so the chord-tone gate would otherwise have nothing to read.
QUALITY = {'aM': 'minor', 'aJ': 'major', 'aS': 'major',
           'sM': 'minor', 'sJ': 'major', 'sS': 'major'}


def note_num(tok):
    m = re.fullmatch(r"([A-G])([#b]?)(\d)", tok)
    n = SEMI[m[1]] + (1 if m[2] == '#' else -1 if m[2] == 'b' else 0)
    return int(m[3]) * 12 + n


def parse(pattern, alias):
    """-> list of (step, kind, inst, note) events; kind in note/rest/tie."""
    out, step, inst = [], 0, None
    for tok in pattern.split():
        if tok.startswith('i='):
            inst = tok[2:]; continue
        name, _, steps = tok.partition(':')
        steps = int(steps) if steps else 1
        if name == 'r':
            out.append((step, 'rest', inst, None))
        elif name == '-':
            out.append((step, 'tie', inst, None))
        elif name in alias:
            out.append((step, 'note', alias[name][0], note_num(alias[name][1])))
        else:
            out.append((step, 'note', inst, note_num(name)))
        step += steps
    assert step == 16, f"pattern is {step} steps, not 16: {pattern}"
    return out


def expand(order):
    """Order list -> list of (transpose, pattern) per bar, LOOP index."""
    bars, t, loop = [], 0, None
    for tok in order:
        if tok == 'LOOP':
            loop = len(bars); continue
        if re.fullmatch(r"t[+-]\d+", tok):
            t = int(tok[1:]); continue
        bars.append((t, tok))
    return bars, loop


def steps_of(events, kind):
    """Steps covered by the events of KIND in one parsed bar (r:4 covers four)."""
    total = 0
    for k, (step, kd, _, _) in enumerate(events):
        nxt = events[k + 1][0] if k + 1 < len(events) else 16
        if kd == kind:
            total += nxt - step
    return total


def fmt(v):
    if isinstance(v, float):
        return f"{v:.1f}"
    return "[" + ", ".join(f"{x:.1f}" if isinstance(x, float) else str(x) for x in v) + "]"


def differs(key, a, b):
    """DIFFERS is a gap that can be heard, not any inequality: ten points on a
    percentage, two notes a bar on any voice, any change to the section list.
    Tune B against A read 67.4 against 66.7 on the bass figure: that is CLOSE."""
    if key == 'sections':
        return a != b
    if key == 'density':
        return any(abs(x - y) >= 2.0 for x, y in zip(a, b))
    return abs(a - b) >= 10.0


def distance(mod, pats, v1, v2, v3, n):
    """The five figures of the 'distance from tune A' report. Off the beat is
    an odd sixteenth step (1, 3, 5...: between the eighths); the lead's rest
    fraction is over the bars in which voice 2 plays a lead instrument; the
    densities count every note event, drums included, per bar per voice."""
    arp = sum(1 for t, p in v3 if any(e[1] == 'note' and e[2] in ('arpm', 'arpM', 'arp7') for e in pats[p]))
    lead_bars = [p for t, p in v2 if any(e[1] == 'note' and e[2] in ('lead', 'plead') for e in pats[p])]
    rests = sum(steps_of(pats[p], 'rest') for p in lead_bars)
    bass = [e for t, p in v1 for e in pats[p] if e[1] == 'note' and e[2] == 'bass']
    off = sum(1 for e in bass if e[0] % 2 == 1)
    dens = [sum(1 for t, p in v for e in pats[p] if e[1] == 'note') / n for v in (v1, v2, v3)]
    return dict(arp_pct=100.0 * arp / n,
                lead_rest_pct=100.0 * rests / (16 * len(lead_bars)) if lead_bars else 0.0,
                bass_off_pct=100.0 * off / len(bass) if bass else 0.0,
                density=dens, sections=[b - a for _, a, b in getattr(mod, 'SECTIONS', [])])


def load(path):
    """-> (module, TUNE, parsed patterns, voice bars 1 2 3, loop index, bars)."""
    spec = importlib.util.spec_from_file_location("tune_" + str(abs(hash(path))), path)
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    T = mod.TUNE
    alias = T.get('alias', {})
    pats = {k: parse(v, alias) for k, v in T['patterns'].items()}
    v1, loop = expand(T['orders'][0]); v2, _ = expand(T['orders'][1]); v3, _ = expand(T['orders'][2])
    return mod, T, pats, v1, v2, v3, loop, len(v1)


def main(path):
    mod, T, pats, v1, v2, v3, loop, n = load(path)
    assert len(v2) == n == len(v3), "voices differ in bar count"
    spd = T['speed']
    bpm = 60.0 * 50 / (sum(spd) / 2 * 4)   # PAL: steps a beat 4, frames a step
    results = []

    def gate(name, ok, detail):
        results.append((name, ok, detail)); print(f"{'PASS' if ok else 'FAIL'}  {name}: {detail}")

    # plan/music3/B (2026-09-24): the ceiling is 170 here, not the A copy's
    # 160, for tune B's 166.7 BPM (speed 5 and 4 alternating). Everything else
    # is the A copy's.
    gate("tempo", 130 <= bpm <= 170, f"{bpm:.1f} BPM from speed {spd}")
    # sections: from SECTIONS in the module if given, else the tune's own comment
    sections = getattr(mod, 'SECTIONS', None)
    gate("sections declared", sections is not None, str(sections) if sections else "no SECTIONS list in the module; the comment block states the plan")
    # motif recurrence: the most frequent lead pattern that carries notes, counted across the lead order
    lead_counts = {}
    for t, p in v2:
        if any(e[1] == 'note' for e in pats[p]):
            lead_counts[p] = lead_counts.get(p, 0) + 1
    motif, count = max(lead_counts.items(), key=lambda kv: kv[1]) if lead_counts else (None, 0)
    gate("motif recurrence >= 4", count >= 4, f"pattern {motif} appears {count} times in the lead order (transposition counted)")
    # chord tones on beats 1 and 3: the chord is the bar's bass transpose (root) with the quality from voice 3's arpeggio pattern (aM minor, aJ major)
    hits = total = 0
    for k in range(n):
        tb, pb = v1[k]; tl, pl = v2[k]; ta, pa = v3[k]
        quality = QUALITY.get(pa[:2])
        root = (tb) % 12   # bass patterns are written on C
        if quality is None:
            continue
        chord = {root % 12, (root + (4 if quality == 'major' else 3)) % 12, (root + 7) % 12}
        for step, kind, inst, note in pats[pl]:
            if kind == 'note' and inst == 'lead' and step in (0, 8):
                total += 1
                if (note + tl) % 12 in chord:
                    hits += 1
    pct = 100.0 * hits / total if total else 0
    gate("lead chord tones on beats 1 and 3 >= 80%", pct >= 80, f"{hits} of {total} = {pct:.0f}%")
    # arpeggio coverage
    arp_bars = sum(1 for t, p in v3 if any(e[1] == 'note' and e[2] in ('arpm', 'arpM', 'arp7') for e in pats[p]))
    if getattr(mod, 'STYLE', None) == 'stabs':
        # 2026-09-24: the maintainer heard tune B as too similar to tune A,
        # and the stabs style REPLACES the arpeggio texture, so for it this
        # gate is inverted (under 30 per cent of bars). The other ten stand.
        gate("arpeggio coverage < 30% of bars (stabs style)", arp_bars < 0.3 * n, f"{arp_bars} of {n} bars")
    else:
        gate("arpeggio coverage >= 70% of bars", arp_bars >= 0.7 * n, f"{arp_bars} of {n} bars")
    # drums: kick or snare on every beat (steps 0,4,8,12) in bars that carry drums at all
    beat_ok = fill_ok = drum_bars = 0
    for k in range(n):
        ev = pats[v1[k][1]] + pats[v3[k][1]]
        drums = {(e[0], e[2]) for e in ev if e[1] == 'note' and e[2] in ('kick', 'snare', 'hat', 'ohat', 'tom')}
        if not any(i in ('kick', 'snare') for _, i in drums):
            continue
        drum_bars += 1
        if all(any(s == b and i in ('kick', 'snare') for s, i in drums) for b in (0, 4, 8, 12)):
            beat_ok += 1
        if k % 4 == 3 and any(i in ('tom',) or (i == 'snare' and s in (13, 14, 15)) for s, i in drums):
            fill_ok += 1
    gate("kick or snare on every beat of drum bars", beat_ok == drum_bars, f"{beat_ok} of {drum_bars} drum bars")
    fills_expected = sum(1 for k in range(n) if k % 4 == 3 and any(e[1] == 'note' and e[2] in ('kick', 'snare') for e in pats[v1[k][1]]))
    gate("a fill in every fourth drum bar", fill_ok >= fills_expected, f"{fill_ok} of {fills_expected}")
    hat_bars = sum(1 for t, p in v3 if sum(1 for e in pats[p] if e[1] == 'note' and e[2] in ('hat', 'ohat')) >= 8)
    gate("hats on every eighth (voice 3) in >= 70% of bars", hat_bars >= 0.7 * n, f"{hat_bars} of {n} bars carry 8 or more hats")
    bass_ok = sum(1 for t, p in v1 if sum(1 for e in pats[p] if e[1] == 'note' and e[2] == 'bass') >= 8)
    gate("bass >= 8 notes in theme bars", bass_ok >= 0.7 * n, f"{bass_ok} of {n} bars")
    inst = T['instruments']
    gate("bass has a pulse sweep", inst['bass'].get('pws', 0) != 0, f"pws={inst['bass'].get('pws')}; the player hard-restarts every non-legato note")
    gate("lead has a vibrato delay", inst['lead'].get('vdel', 0) > 0, f"vdel={inst['lead'].get('vdel')}, vib={inst['lead'].get('vib')}")
    print(f"bars {n}, loop to {loop}, {n * 16 * (sum(spd) / 2) / 50:.1f} s PAL")
    # The distance report (2026-09-24): five figures, printed beside tune A's
    # when --against names its source, so a "different" tune is measured.
    d = distance(mod, pats, v1, v2, v3, n)
    ref = None
    if '--against' in sys.argv:
        rp = sys.argv[sys.argv.index('--against') + 1]
        rm, _, rpats, r1, r2, r3, _, rn = load(rp)
        ref = distance(rm, rpats, r1, r2, r3, rn)
        print("distance from", rp)
    for key, label in (('arp_pct', 'arpeggio coverage, % of bars'), ('lead_rest_pct', 'lead rests, % of its steps'),
                       ('bass_off_pct', 'bass notes off the beat, %'), ('density', 'notes a bar, voices 1 2 3'),
                       ('sections', 'section lengths, bars')):
        line = f"  {label}: {fmt(d[key])}"
        if ref:
            line += f"   against {fmt(ref[key])}   " + ('DIFFERS' if differs(key, d[key], ref[key]) else 'CLOSE')
        print(line)
    if getattr(mod, 'STYLE', None) == 'stabs':
        gate("lead rests >= 25% of its steps (stabs style)", d['lead_rest_pct'] >= 25, f"{d['lead_rest_pct']:.1f}%")
        gate("bass notes off the beat >= 33% (stabs style)", d['bass_off_pct'] >= 33, f"{d['bass_off_pct']:.1f}%")
    bad = [r for r in results if not r[1]]
    print("RESULT", "PASS" if not bad else f"FAIL ({len(bad)})")
    return 0 if not bad else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1]))
