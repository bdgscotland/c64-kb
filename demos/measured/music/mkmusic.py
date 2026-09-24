#!/usr/bin/env python3
"""Compile a tune written in note names into data for src/music.asm.

Our own code: the INTERCEPTOR agent's mkmusic.py (2026-09-23) as the
MEASURED demo extended it (tn_loop1, the pattern index voice 1's order list
loops to, for music_pos; and a timing table of voice 1's order list, the PAL
second each pattern index starts at), copied from
the MEASURED music2 compiler for
TOURNEY with one addition: the tune must hold a pattern named 'silent' (all
rests), and the output defines TN_SILENT (its index) and TN_LOOP1 as
assembler constants, which src/music.asm uses to build the bout's silent
order list beside the tune's own.

A tune module defines TUNE, a dict:
  name, speed (two frame counts that alternate step by step),
  instruments: name -> dict(ad, sr, wave, pw=0, pws=0, vib=0, vdel=0,
               flt=None|name, fretrig=False, legato=False)
      wave: list of (waveform, note) rows, one per frame (the gate bit of the
            waveform is ignored: the player gates notes); note is a relative
            semitone count (int >= 0) or '=N' for absolute note N; the row
            'loop:K' jumps to row K, and without it the last row holds.
  filters: name -> dict(cut, spd, min, max, res, mode, bounce)
  alias: token -> (instrument, note name) for drums
  patterns: name -> text
      tokens: i=inst  NOTE[:steps]  r[:steps] (rest)  -[:steps] (tie)
      NOTE: C4 = 48 (A4 = 57 = 440 Hz), sharps C#4, flats Db4
  orders: three lists of pattern names, 't+N'/'t-N' transposes and 'LOOP'
Writes <out>.asm. Prints the length, the byte count and the timing table.
usage: mkmusic.py tune.py out.asm [--quiet]
"""
import importlib.util
import re
import sys

SEMI = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}


def note_num(tok):
    m = re.fullmatch(r"([A-G])([#b]?)(\d)", tok)
    if not m:
        raise ValueError(f"bad note {tok}")
    n = SEMI[m[1]] + (1 if m[2] == '#' else -1 if m[2] == 'b' else 0)
    return int(m[3]) * 12 + n


def compile_tune(T):
    assert min(T['speed']) >= 5, "speeds under 5 break the staggered reads"
    inst_names = list(T['instruments'])
    filt_names = list(T.get('filters', {}))
    assert len(inst_names) <= 64, "more than 64 instruments"
    assert len(filt_names) <= 127, "more than 127 filter programs"
    # wavetable: rows 0-1 are a silent hold for the first frames
    wtw, wtn = [0x10, 0x00], [0, 0xff]
    wt_start, max_rel = {}, {}
    for name in inst_names:
        rows = T['instruments'][name]['wave']
        base = len(wtw)
        wt_start[name] = base
        max_rel[name] = 0
        loop = None
        for r in rows:
            if isinstance(r, str) and r.startswith('loop:'):
                loop = int(r[5:])
                continue
            w, n = r
            w &= 0xfe                       # the player owns the gate bit
            assert w != 0, "waveform 0 is the jump code"
            if isinstance(n, str):
                code = 0x80 | int(n[1:])
            else:
                assert 0 <= n < 0x80
                code = n
                max_rel[name] = max(max_rel[name], n)
            wtw.append(w)
            wtn.append(code)
        wtw.append(0)
        wtn.append(0xff if loop is None else base + loop)   # $FF: hold the last row
    assert len(wtw) <= 255, "wavetable over 255 rows"

    aliases = T.get('alias', {})
    pats, pat_steps, pat_notes = {}, {}, {}
    for pname, text in T['patterns'].items():
        out, steps, inst, dur, notes = [], 0, None, None, []
        for tok in text.split():
            if tok.startswith('i='):
                inst = tok[2:]
                assert inst in inst_names, f"{pname}: unknown instrument {inst}"
                out.append(0x80 + inst_names.index(inst))
                continue
            head, _, d = tok.partition(':')
            d = int(d) if d else 1
            if head in aliases:
                ai, an = aliases[head]
                if ai != inst:
                    inst = ai
                    out.append(0x80 + inst_names.index(ai))
                head = an
            if d != dur:
                assert 1 <= d <= 63, f"{pname}: duration {d}"
                out.append(0xbf + d)
                dur = d
            if head == 'r':
                out.append(0x60)
            elif head == '-':
                out.append(0x61)
            else:
                assert inst is not None, f"{pname}: note before instrument"
                n = note_num(head)
                notes.append((n, inst))
                out.append(n)
            steps += d
        out.append(0xff)
        pats[pname], pat_steps[pname], pat_notes[pname] = out, steps, notes

    pat_names = list(pats)
    assert len(pat_names) <= 96, "more than 96 patterns (pattern numbers must stay below $60)"
    orders, totals, loops, loop_idx = [], [], [], []
    v1_starts = []                      # (pattern index, start step, name, transpose) for voice 1
    for v, olist in enumerate(T['orders']):
        out, steps, trn, loop_pos, loop_steps, pidx, loop_pidx = [], 0, 0, 0, 0, 0, 0
        for tok in olist:
            if tok == 'LOOP':
                loop_pos, loop_steps, loop_pidx = len(out), steps, pidx
                continue
            m = re.fullmatch(r"t([+-]\d+)", tok)
            if m:
                trn = int(m[1])
                assert -32 <= trn <= 31
                out.append(0xa0 + trn)
                continue
            assert tok in pats, f"voice {v+1}: unknown pattern {tok}"
            for n, inst in pat_notes[tok]:
                top = n + trn + max_rel[inst] + 1
                assert 0 <= n + trn and top < 96, f"voice {v+1} {tok}: note {n}+{trn} out of range"
            if v == 0:
                v1_starts.append((pidx, steps, tok, trn))
            out.append(pat_names.index(tok))
            steps += pat_steps[tok]
            pidx += 1
        out += [0xff, loop_pos]
        orders.append(out)
        totals.append(steps)
        loops.append(loop_steps)
        loop_idx.append(loop_pidx)
    assert len(set(totals)) == 1, f"voices differ in length: {totals}"
    assert len(set(loops)) == 1, f"loop points differ: {loops}"
    for o in orders:
        assert len(o) <= 256

    I = T['instruments']
    F = T.get('filters', {})
    L = []
    emit = lambda label, vals: L.append(f"{label}: .byte " + ", ".join(f"${v & 0xff:02x}" for v in vals) if vals else f"{label}:")
    L.append(f"// {T['name']}: generated by mkmusic.py from {T['source']}; do not edit here.")
    emit("tn_speed", list(T['speed']))
    emit("tn_loop1", [loop_idx[0]])
    L.append(f".const TN_LOOP1 = {loop_idx[0]}")
    assert 'silent' in pat_names, "the tune needs a pattern named 'silent' (all rests) for the bout's order list"
    assert not pat_notes['silent'], "the 'silent' pattern must hold no notes"
    L.append(f".const TN_SILENT = {pat_names.index('silent')}")
    L.append("tn_ordlo: .byte <tn_ord1, <tn_ord2, <tn_ord3")
    L.append("tn_ordhi: .byte >tn_ord1, >tn_ord2, >tn_ord3")
    L.append("tn_patlo: .byte " + ", ".join(f"<tn_p{k}" for k in range(len(pat_names))))
    L.append("tn_pathi: .byte " + ", ".join(f">tn_p{k}" for k in range(len(pat_names))))
    emit("tn_ad", [I[n]['ad'] for n in inst_names])
    emit("tn_sr", [I[n]['sr'] for n in inst_names])
    emit("tn_wt", [wt_start[n] for n in inst_names])
    pw = [I[n].get('pw', 0) * 16 for n in inst_names]      # 'pw' is the width / 16
    emit("tn_pwl", [p & 0xff for p in pw])
    emit("tn_pwh", [(p >> 8) if p else 0x80 for p in pw])   # $80: keep the last width
    # the player sweeps every other frame: 'pws' is per frame, stored doubled
    for n in inst_names: assert -64 <= I[n].get('pws', 0) <= 63, f"{n}: pws out of range"
    emit("tn_pws", [2 * I[n].get('pws', 0) for n in inst_names])
    emit("tn_vib", [I[n].get('vib', 0) for n in inst_names])
    emit("tn_vdel", [I[n].get('vdel', 0) for n in inst_names])
    fl = []
    for n in inst_names:
        f = I[n].get('flt')
        assert f is None or f in filt_names, f"{n}: unknown filter {f}"
        fl.append(0 if f is None else (filt_names.index(f) + 1) | (0x80 if I[n].get('fretrig') else 0))
    emit("tn_flt", fl)
    emit("tn_flags", [1 if I[n].get('legato') else 0 for n in inst_names])
    emit("tn_wtw", wtw)
    emit("tn_wtn", wtn)
    for key, lab in (('cut', 'tn_fcut'), ('spd', 'tn_fspd'), ('min', 'tn_fmin'), ('max', 'tn_fmax'), ('res', 'tn_fres')):
        emit(lab, [0] + [F[f][key] for f in filt_names])
    emit("tn_fmode", [0] + [F[f]['mode'] | (1 if F[f].get('bounce') else 0) for f in filt_names])
    for v, o in enumerate(orders):
        emit(f"tn_ord{v+1}", o)
    for k, p in enumerate(pat_names):
        L.append(f"// {p}")
        emit(f"tn_p{k}", pats[p])

    sp = T['speed']
    fps = (sp[0] + sp[1]) / 2
    frames = totals[0] * fps
    loop_frames = (totals[0] - loops[0]) * fps
    nbytes = (2 + 1 + 6 + 2 * len(pat_names) + 10 * len(inst_names) + 2 * len(wtw)
              + 6 * (len(filt_names) + 1) + sum(map(len, orders)) + sum(map(len, pats.values())))
    info = dict(steps=totals[0], seconds=frames / 50, loop_seconds=loop_frames / 50,
                loop_step=loops[0], loop_index=loop_idx[0], bytes=nbytes, instruments=len(inst_names),
                wavetable=len(wtw), patterns=len(pat_names), voice1_patterns=len(v1_starts))
    # timing table: music_pos value -> the PAL second its pattern starts at
    # (arithmetic: 5 frames of lead-in, then steps x mean speed; the read
    # that sets music_pos lands 2 calls earlier)
    timing = [(i, (5 + s * fps) / 50, name, trn) for i, s, name, trn in v1_starts]
    return "\n".join(L) + "\n", info, timing


if __name__ == "__main__":
    src, out = sys.argv[1], sys.argv[2]
    quiet = '--quiet' in sys.argv
    spec = importlib.util.spec_from_file_location("tune", src)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    T = mod.TUNE
    T['source'] = src.split('/')[-1]
    text, info, timing = compile_tune(T)
    open(out, "w").write(text)
    print(f"{T['name']}: {info}")
    if not quiet:
        print("music_pos  starts at (s PAL)  pattern")
        for i, sec, name, trn in timing:
            print(f"{i:9d}  {sec:16.2f}  {name}{' t%+d' % trn if trn else ''}")
        print(f"      end  {info['seconds']:16.2f}  loops to index {info['loop_index']}")
