#!/usr/bin/env python3
"""mkmusic_multi.py: several tunes in ONE data block, under the KERNAL.

plan/music3/A/mkmusic_env3.py (filter kind 2, the ENV3 filter envelope)
extended on 2026-09-24 to take several tune modules:

    python3 mkmusic_multi.py tune_A2.py tune_B.py [tune_C.py] out.asm [--quiet]

The tunes are numbered 0, 1, 2 in the order given; the silent list is the
number after them. The patterns, instruments, filter programs and the
wavetable are POOLED: tune 0 goes in first and verbatim (its tables and
pattern bytes come out identical to mkmusic_env3.py's, only the addresses
move), and every later tune reuses an instrument, filter program or pattern
whose compiled content is identical to one already in the pool, else
appends it. Order lists, loop indexes, speed pairs and the voice-3 read
tick are per tune.

The output is two pieces in one file:
  the HEADER, assembled where the player imports it (the $1000 block), is
  everything music_init reads with the KERNAL in: TUNES, tune_speed (2 a
  tune), tune_loop, tune_ftk3, tune_ord_lo/hi (3 a tune, the silent list
  last), and the label music_data_hdr_end;
  the IMAGE, `* = MUSIC_IMAGE_LOAD "music data (load image)"` holding
  `.pseudopc MUSIC_IMAGE_RUN { ... }`, is everything music_play reads, every
  internal address $E000-based; the lead copies it to $E000 once and banks
  the KERNAL out around music_play. It errors if it ends at or above $7800
  in the load image or at or above $F000 where it runs: the disk loader
  takes $F000-$F1FF and $F800-$FFF9 is its resident and the RAM interrupt
  vectors (plan/maximum-design.md 1.5; the lead's cap of 2026-09-24, first
  $F800 then $F000), so all the tunes together get 4 KB.

A speed of 4 is allowed (mkmusic_env3.py refused it): a four-frame step
has ticks 3, 2, 1 after the step frame, so voice 3 cannot read on tick 4;
the header's tune_ftk3 byte is 3 for such a tune and 4 otherwise, and the
player reads it in music_init. Speeds under 4 are refused (tick 2 is the
hard restart's and tick 1 the instrument's).

The tune module format is mkmusic_env3.py's, unchanged.
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


def filter_row(f):
    """Normalise a filter entry to the six table columns plus AD/SR and kind."""
    if 'env' in f:
        ad, sr = f['env']
        return dict(cut=f['base'], spd=0, min=0, max=0, res=f['res'],
                    mode=(f['mode'] & 0xf0) | 2, ad=ad, sr=sr, kind=2)
    return dict(cut=f['cut'], spd=f['spd'], min=f['min'], max=f['max'], res=f['res'],
                mode=(f['mode'] & 0xf0) | (1 if f.get('bounce') else 0), ad=0, sr=0, kind=1)


def norm_inst(d):
    """An instrument as a hashable key: the fields the tables read, defaults
    filled, the wavetable rows as tuples. Two instruments with equal keys
    compile to equal table rows and equal wavetable rows."""
    wave = tuple((r if isinstance(r, str) else (r[0] & 0xfe, r[1])) for r in d['wave'])
    return (d['ad'], d['sr'], wave, d.get('pw', 0), d.get('pws', 0), d.get('vib', 0),
            d.get('vdel', 0), d.get('flt'), bool(d.get('fretrig')), bool(d.get('legato')))


class Pool:
    """What the tunes share: instruments (dicts, in pooled order), filter
    programs (rows), patterns (compiled bytes). Tune 0 is added verbatim,
    later tunes by content."""
    def __init__(self):
        self.inst, self.inst_key = [], {}          # list of dicts; key -> index
        self.filt, self.filt_key = [], {}          # list of rows; key -> index (0-based; the table has a zero row first)
        self.pats, self.pat_key = [], {}           # list of byte lists; bytes -> index
        self.pat_names = []                        # a name for each pooled pattern (the first tune's)
        self.inst_flt = []                         # per pooled instrument: pooled filter index or None


def add_filters(pool, T):
    """-> this tune's filter name -> pooled index (by row content)."""
    idx = {}
    for name, f in T.get('filters', {}).items():
        row = filter_row(f)
        key = tuple(sorted(row.items()))
        if key not in pool.filt_key:
            pool.filt_key[key] = len(pool.filt)
            pool.filt.append(row)
        idx[name] = pool.filt_key[key]
    assert len(pool.filt) <= 127, "more than 127 filter programs"
    return idx


def add_instruments(pool, T, fidx, first):
    """-> this tune's instrument name -> pooled index. The key carries the
    POOLED filter index, not the tune's filter name, so two tunes naming
    different programs 'env1' cannot merge an instrument."""
    idx = {}
    for name, d in T['instruments'].items():
        f = d.get('flt')
        assert f is None or f in fidx, f"{name}: unknown filter {f}"
        key = norm_inst(d)[:7] + (None if f is None else fidx[f],) + norm_inst(d)[8:]
        if first or key not in pool.inst_key:
            pool.inst_key.setdefault(key, len(pool.inst))
            pool.inst.append(d)
            pool.inst_flt.append(None if f is None else fidx[f])
            idx[name] = len(pool.inst) - 1
        else:
            idx[name] = pool.inst_key[key]
    assert len(pool.inst) <= 64, "more than 64 instruments"
    return idx


def compile_patterns(T, iidx):
    """-> pattern name -> (bytes, steps, [(note, instrument name)])."""
    aliases = T.get('alias', {})
    out = {}
    for pname, text in T['patterns'].items():
        b, steps, inst, dur, notes = [], 0, None, None, []
        for tok in text.split():
            if tok.startswith('i='):
                inst = tok[2:]
                assert inst in iidx, f"{pname}: unknown instrument {inst}"
                b.append(0x80 + iidx[inst])
                continue
            head, _, d = tok.partition(':')
            d = int(d) if d else 1
            if head in aliases:
                ai, an = aliases[head]
                if ai != inst:
                    inst = ai
                    b.append(0x80 + iidx[ai])
                head = an
            if d != dur:
                assert 1 <= d <= 63, f"{pname}: duration {d}"
                b.append(0xbf + d)
                dur = d
            if head == 'r':
                b.append(0x60)
            elif head == '-':
                b.append(0x61)
            else:
                assert inst is not None, f"{pname}: note before instrument"
                n = note_num(head)
                notes.append((n, inst))
                b.append(n)
            steps += d
        b.append(0xff)
        out[pname] = (b, steps, notes)
    return out


def add_patterns(pool, pats, first):
    """-> this tune's pattern name -> pooled index (by compiled bytes)."""
    pidx = {}
    for name, (b, steps, notes) in pats.items():
        key = bytes(b)
        if first or key not in pool.pat_key:
            pool.pat_key.setdefault(key, len(pool.pats))
            pool.pats.append(b)
            pool.pat_names.append(name)
            pidx[name] = len(pool.pats) - 1
        else:
            pidx[name] = pool.pat_key[key]
    assert len(pool.pats) <= 96, "more than 96 patterns (pattern numbers must stay below $60)"
    return pidx


def compile_orders(T, pats, pidx, max_rel):
    """-> (three order lists, total steps, loop step, loop index, voice 1's
    (index, start step, name, transpose) list)."""
    orders, totals, loops, loop_idx, v1_starts = [], [], [], [], []
    for v, olist in enumerate(T['orders']):
        out, steps, trn, loop_pos, loop_steps, pi, loop_pi = [], 0, 0, 0, 0, 0, 0
        for tok in olist:
            if tok == 'LOOP':
                loop_pos, loop_steps, loop_pi = len(out), steps, pi
                continue
            m = re.fullmatch(r"t([+-]\d+)", tok)
            if m:
                trn = int(m[1])
                assert -32 <= trn <= 31
                out.append(0xa0 + trn)
                continue
            assert tok in pats, f"voice {v+1}: unknown pattern {tok}"
            for n, inst in pats[tok][2]:
                top = n + trn + max_rel[inst] + 1
                assert 0 <= n + trn and top < 96, f"voice {v+1} {tok}: note {n}+{trn} out of range"
            if v == 0:
                v1_starts.append((pi, steps, tok, trn))
            out.append(pidx[tok])
            steps += pats[tok][1]
            pi += 1
        out += [0xff, loop_pos]
        orders.append(out)
        totals.append(steps)
        loops.append(loop_steps)
        loop_idx.append(loop_pi)
    assert len(set(totals)) == 1, f"voices differ in length: {totals}"
    assert len(set(loops)) == 1, f"loop points differ: {loops}"
    for o in orders:
        assert len(o) <= 256
    return orders, totals[0], loops[0], loop_idx[0], v1_starts


def wavetable(pool):
    """Rows 0-1 are a silent hold for the first frames, then each pooled
    instrument's rows and its end row (0, $FF hold or 0, loop row)."""
    wtw, wtn, start = [0x10, 0x00], [0, 0xff], []
    for d in pool.inst:
        base = len(wtw)
        start.append(base)
        loop = None
        for r in d['wave']:
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
            wtw.append(w)
            wtn.append(code)
        wtw.append(0)
        wtn.append(0xff if loop is None else base + loop)
    assert len(wtw) <= 255, "wavetable over 255 rows"
    return wtw, wtn, start


def compile_tune(pool, T, first):
    assert min(T['speed']) >= 4, "speeds under 4 break the staggered reads (see the docstring)"
    fidx = add_filters(pool, T)
    iidx = add_instruments(pool, T, fidx, first)
    max_rel = {n: max([r[1] for r in d['wave'] if not isinstance(r, str) and not isinstance(r[1], str)] + [0])
               for n, d in T['instruments'].items()}
    pats = compile_patterns(T, iidx)
    pidx = add_patterns(pool, pats, first)
    orders, steps, loop_steps, loop_idx, v1 = compile_orders(T, pats, pidx, max_rel)
    return dict(name=T['name'], source=T['source'], speed=tuple(T['speed']), orders=orders, steps=steps,
                loop_steps=loop_steps, loop_idx=loop_idx, v1_starts=v1, pidx=pidx, iidx=iidx)


def emit_all(tunes, pool, wtw, wtn, wt_start):
    L = []
    emit = lambda label, vals: L.append(f"{label}: .byte " + ", ".join(f"${v & 0xff:02x}" for v in vals) if vals else f"{label}:")
    n = len(tunes)
    L.append("// Music data: generated by mkmusic_multi.py from " + ", ".join(t['source'] for t in tunes) + "; do not edit here.")
    L.append("// Tunes: " + "; ".join(f"{k} {t['name']}" for k, t in enumerate(tunes)) + f"; {n} the silent list.")
    L.append("// ---- header: what music_init reads with the KERNAL in; assembled where imported (the $1000 block)")
    L.append(f".const TUNES = {n + 1}")
    emit("tune_count", [n + 1])                 # the player reads the byte: a .const cannot be referenced before its line
    emit("tune_speed", [s for t in tunes for s in t['speed']] + [5, 5])
    emit("tune_loop", [t['loop_idx'] for t in tunes] + [0])
    emit("tune_ftk3", [4 if min(t['speed']) >= 5 else 3 for t in tunes] + [4])
    for c, lab in (('<', 'tune_ord_lo'), ('>', 'tune_ord_hi')):
        L.append(f"{lab}: .byte " + ", ".join(f"{c}t{k}_ord{v}" for k in range(n) for v in (1, 2, 3))
                 + ", " + ", ".join([f"{c}tn_silent_ord"] * 3))
    L.append("music_data_hdr_end:")
    L.append("// ---- image: what music_play reads; copy MUSIC_IMAGE_LEN bytes from music_image to MUSIC_IMAGE_RUN once,")
    L.append("// and bank the KERNAL out ($01 = $35) around every music_play call")
    L.append(".label MUSIC_IMAGE_LOAD = $6000    // labels, not consts: code assembled before this import may name them")
    L.append(".label MUSIC_IMAGE_RUN = $e000")
    L.append('* = MUSIC_IMAGE_LOAD "music data (load image)"')
    L.append("music_image:")
    L.append(".pseudopc MUSIC_IMAGE_RUN {")
    L.append("tn_patlo: .byte " + ", ".join(f"<tn_p{k}" for k in range(len(pool.pats))))
    L.append("tn_pathi: .byte " + ", ".join(f">tn_p{k}" for k in range(len(pool.pats))))
    I = pool.inst
    emit("tn_ad", [d['ad'] for d in I])
    emit("tn_sr", [d['sr'] for d in I])
    emit("tn_wt", wt_start)
    pw = [d.get('pw', 0) * 16 for d in I]                   # 'pw' is the width / 16
    emit("tn_pwl", [p & 0xff for p in pw])
    emit("tn_pwh", [(p >> 8) if p else 0x80 for p in pw])   # $80: keep the last width
    for d in I:
        assert -64 <= d.get('pws', 0) <= 63, "pws out of range"
    emit("tn_pws", [2 * d.get('pws', 0) for d in I])        # the player sweeps every other frame
    emit("tn_vib", [d.get('vib', 0) for d in I])
    emit("tn_vdel", [d.get('vdel', 0) for d in I])
    emit("tn_flt", [0 if f is None else (f + 1) | (0x80 if d.get('fretrig') else 0) for d, f in zip(I, pool.inst_flt)])
    emit("tn_flags", [1 if d.get('legato') else 0 for d in I])
    emit("tn_wtw", wtw)
    emit("tn_wtn", wtn)
    for key, lab in (('cut', 'tn_fcut'), ('spd', 'tn_fspd'), ('min', 'tn_fmin'), ('max', 'tn_fmax'),
                     ('res', 'tn_fres'), ('mode', 'tn_fmode'), ('ad', 'tn_fad'), ('sr', 'tn_fsr')):
        emit(lab, [0] + [row[key] for row in pool.filt])
    silent = tunes[0]['pidx']['silent']
    L.append("// the silent list: the all-rest pattern, then a loop back to it; one list serves all three voices")
    emit("tn_silent_ord", [silent, 0xff, 0x00])
    for k, t in enumerate(tunes):
        L.append(f"// tune {k}: {t['name']}")
        for v, o in enumerate(t['orders']):
            emit(f"t{k}_ord{v+1}", o)
    for k, p in enumerate(pool.pats):
        L.append(f"// {pool.pat_names[k]}")
        emit(f"tn_p{k}", p)
    L.append("}")
    L.append("music_image_end:")
    L.append(".label MUSIC_IMAGE_LEN = music_image_end - music_image")
    L.append('.errorif music_image_end > $7800, "music data: the load image ends at or above $7800"')
    L.append('.errorif MUSIC_IMAGE_RUN + MUSIC_IMAGE_LEN > $f000, "music data: the image ends at or above $F000 where it runs ($F000 up is the disk loader, then the RAM vectors)"')
    nbytes = (2 * len(pool.pats) + 10 * len(I) + 2 * len(wtw) + 8 * (len(pool.filt) + 1) + 3
              + sum(len(o) for t in tunes for o in t['orders']) + sum(map(len, pool.pats)))
    return "\n".join(L) + "\n", nbytes


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    quiet = '--quiet' in sys.argv
    srcs, out = args[:-1], args[-1]
    assert srcs, __doc__
    pool, tunes = Pool(), []
    for k, src in enumerate(srcs):
        spec = importlib.util.spec_from_file_location(f"tune{k}", src)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        T = mod.TUNE
        T['source'] = src.split('/')[-1]
        tunes.append(compile_tune(pool, T, first=(k == 0)))
    assert 'silent' in tunes[0]['pidx'], "tune 0 needs a pattern named 'silent' (all rests) for the silent list"
    wtw, wtn, wt_start = wavetable(pool)
    text, nbytes = emit_all(tunes, pool, wtw, wtn, wt_start)
    open(out, "w").write(text)
    print(f"pool: {len(pool.inst)} instruments, {len(wtw)} wavetable rows, {len(pool.filt)} filter programs, "
          f"{len(pool.pats)} patterns; image {nbytes} bytes by count; {len(tunes)} tunes + the silent list")
    for k, t in enumerate(tunes):
        fps = sum(t['speed']) / 2
        print(f"tune {k} {t['name']}: speed {t['speed']}, {t['steps']} steps = {t['steps'] * fps / 50:.1f} s PAL, "
              f"loop to index {t['loop_idx']} ({(t['steps'] - t['loop_steps']) * fps / 50:.1f} s a lap), "
              f"{len(t['v1_starts'])} bars")
        if not quiet:
            print("  music_pos  starts at (s PAL)  pattern")
            for i, s, name, trn in t['v1_starts']:
                print(f"  {i:9d}  {(5 + s * fps) / 50:16.2f}  {name}{' t%+d' % trn if trn else ''}")
