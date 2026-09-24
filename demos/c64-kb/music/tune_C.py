# Candidate C: "After", C minor, 125 BPM (speed (6, 6): six frames a sixteenth
# on PAL, a bar 96 frames = 1.92 s), 4/4, one bar a pattern. For the END
# SCREEN only: calm, sparse, sixteen bars looping to bar 0 (30.7 s a lap).
# The same grammar as tunes A and B, written to the same tools, but not the
# same brief: it is a coda, not a theme, so the drum, hat, bass-density and
# tempo gates in tunecheck.py FAIL on it by design (there are no drums, no
# hats, one bass note a bar, 125 BPM) and the motif gate counts two
# statements. Those lines are reported, not hidden.
#
# Grammar
#   Key: C minor (tune A's key: the end screen returns home).
#   Progressions (one chord a bar): P1  i iv v i   = Cm Fm Gm Cm (all minor)
#                                   P2  i VI iv V  = Cm Ab Fm G7
#   Motif: tune A's hook at a quarter of its speed, C5 Eb5 G5 F5 | over two
#     bars, answered by the chord's own tones; the lead speaks in bars 4-7
#     and 12-15 only.
#   Voices: 1 = a triangle sub bass, one legato whole note a bar on the root;
#           2 = the sawtooth lead (tune A's 'lead'), sparse;
#           3 = held one-frame arpeggio chords, the pad.
#   Structure, bars: P1 0-7 (pads and bass; lead from bar 4) | P2 8-15 (the
#     same, the lead's answer) | LOOP to bar 0.
import importlib.util, os
_p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "instruments.py")
_s = importlib.util.spec_from_file_location("instruments", os.path.abspath(_p))
_i = importlib.util.module_from_spec(_s); _s.loader.exec_module(_i)

# 'bass' is picked for the gate that reads it; the tune plays the sub. All
# but the sub are tune A's instruments and pool with them byte for byte.
INST, FILT = _i.pick('bass', 'sub', 'flead', 'arpm', 'arpM', 'arp7')
INST['lead'] = dict(_i.INST['flead'])


def seq(*items):
    """Order list from (transpose, pattern) pairs and 'LOOP', as tune A's."""
    out, cur = [], None
    for it in items:
        if it == 'LOOP':
            out.append('LOOP'); cur = None; continue
        t, p = it
        if t != cur:
            out.append('t%+d' % t); cur = t
        out.append(p)
    return out


P1_ROOTS, P1_MAJOR = [0, 5, 7, 0], [False, False, False, False]      # Cm Fm Gm Cm
P2_ROOTS, P2_MAJOR = [0, -4, 5, 7], [False, True, False, 'seventh']  # Cm Ab Fm G7
HELD = {False: 'aMh', True: 'aJh', 'seventh': 'aSh'}
SECTIONS = [("P1", 0, 8), ("P2", 8, 16)]
SYNC_POS = []                   # the end screen runs until the maintainer's key

TUNE = dict(
    name="Candidate C: After",
    speed=(6, 6),
    instruments=INST,
    filters=FILT,
    alias={'M': ('arpm', 'C4'), 'J': ('arpM', 'C4'), 'Q': ('arp7', 'C4')},
    patterns=dict(
        sB="i=sub C2:16",                       # voice 1: one legato whole note a bar
        l0="r:16",
        silent="r:16",
        # voice 2: beats 1 and 3 on the bar's chord tones (Cm Fm Gm Cm; Cm Ab Fm G7)
        c1="i=lead C5:4 Eb5:4 G5:4 F5:4",
        c2="i=lead Ab4:4 F4:4 C5:8",
        c3="i=lead Bb4:4 D5:4 G4:8",
        c4="i=lead C5:8 r:8",
        c5="i=lead Ab4:4 C5:4 Eb5:8",
        c6="i=lead F5:4 Eb5:4 C5:8",
        c7="i=lead D5:4 B4:4 G4:8",
        aMh="M:16", aJh="J:16", aSh="Q:16",     # voice 3: the held chords
    ),
    orders=[
        # voice 1: the sub on the roots
        seq(*[(r, 'sB') for r in P1_ROOTS * 2], *[(r, 'sB') for r in P2_ROOTS * 2]),
        # voice 2: silent for four bars, then the phrase; twice
        seq(*[(0, 'l0')] * 4, (0, 'c1'), (0, 'c2'), (0, 'c3'), (0, 'c4'),
            *[(0, 'l0')] * 4, (0, 'c1'), (0, 'c5'), (0, 'c6'), (0, 'c7')),
        # voice 3: the held chords
        seq(*[(r, HELD[m]) for r, m in zip(P1_ROOTS * 2, P1_MAJOR * 2)],
            *[(r, HELD[m]) for r, m in zip(P2_ROOTS * 2, P2_MAJOR * 2)]),
    ],
)
