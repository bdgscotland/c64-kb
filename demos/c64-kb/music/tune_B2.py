# Candidate B2: "Stabs", G minor, about 167 BPM (speed (5, 4) as tune B: a bar
# is 72 frames = 1.44 s), 4/4, one bar a pattern. Written after the
# maintainer heard tune B (2026-09-24): "too similar to the first one", "punchier
# less rolling", "the style progression is the same as the first tune too".
#
# Grammar (NOT tune A's): no arpeggios, no eighth-note bass under a long lead.
#   Bass: gated plucks (held at a sustain, cut dead by the rest or the next
#     note, the bank's fastest pulse-width snap), sixteenths with rests
#     between, six of every eight notes on an odd sixteenth. Kick 1 and 3,
#     snare 2 and 4, on voice 1 with the bass.
#   Stabs: voice 2 (clav, the chord's third) on steps 3, 6, 11, 14 of the bar
#     (a double tresillo against the beat), voice 3 (sawtooth, the fifth) with
#     it on 14, where the bass hits its fifth too: two or three voices, then
#     silence. Voice 3 carries the hats (eighths, open on 7 and 13).
#   Lead: sawtooth, answers the riff in two-bar phrases with half its steps
#     silent (RIFF2 only). Chords: | Gm | Gm | Bb | F | (i i III VII).
#   Structure, bars (= voice 1's pattern index = music_pos):
#     HITS 0-1 (chord hits and silence, a roll into the riff) | RIFF 2-9 |
#     DROP 10-11 (kick and the ENV3 filter-envelope bass only; voice 3 is the
#     envelope, silent) | BUILD 12-15 (snare roll, stabs rising Gm Bb Cm D7) |
#     RIFF2 16-21 (the riff doubled an octave up on voice 3, the lead on top
#     in bars 18-21) | BREAKDOWN 22-25 (bass, drums and hats only) | LOOP to 2.
#     26 bars = 37.4 s; section lengths 2 8 2 4 6 4 (A: 4 8 8 8 4 8 8 8 4).
#   SYNC_POS: 12 (part 4 fades at the build, 17.3 s), 22 (part 5 at the
#     breakdown, 14.4 s later): the same two numbers main.asm has for tune B.
import importlib.util, os
_p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "instruments.py")
_s = importlib.util.spec_from_file_location("instruments", os.path.abspath(_p))
_i = importlib.util.module_from_spec(_s); _s.loader.exec_module(_i)

STYLE = 'stabs'                 # tunecheck.py: inverts the arpeggio gate, adds two
INST, FILT = _i.pick('bass', 'fbass', 'flead', 'clav', 'kick', 'snare', 'hat', 'ohat', 'tom')
# The punchy bass: pulse, attack 0 decay 6 to a sustain of 10, release 0, so
# a note holds until the rest or the next note's hard restart cuts it dead;
# pws $3C is the bank's fastest snap. The first cut (sustain 0, the note left
# to decay) rendered at a median RMS of 2,146 on the 6581 and 1,680 on the
# 8580 against the brief's floor of 2,500: plucks that die between rests
# carry little average power. Holding them and cutting keeps the punch.
# Second step (sustain 10, width $500: medians 2,792 and 2,283, the 8580
# still under 2,500): sustain 12, the width starting at 50 per cent, the
# stabs at 10. The floor was written for tune A's texture; this style rests.
INST['bass'] = dict(ad=0x06, sr=0xc0, pw=0x80, pws=0x3c, wave=[(0x41, 0)])
INST['fbass'] = dict(_i.INST['fbass'], flt='env1')      # the drop: tune A's ENV3 bass
FILT = dict(env1=dict(env=(0x49, 0x39), base=0x14, res=0xb1, mode=0x90))
INST['st'] = dict(ad=0x07, sr=0xa0, wave=[(0x21, 0)])   # sawtooth stab, held, cut
INST['clav'] = dict(_i.INST['clav'], sr=0xa0)           # the clav stab, held, cut
INST['lead'] = dict(_i.INST['flead'])                   # the gates read 'lead'


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


# Patterns are written in C minor; the order lists transpose them so the
# gates' chord arithmetic reads the sounding root. G minor: the tonic is -5.
G = -5
RIFF_ROOTS, RIFF_Q = [G, G, G + 3, G - 2], ['m', 'm', 'j', 'j']       # Gm Gm Bb F
BUILD_ROOTS, BUILD_Q = [G, G + 3, G + 5, G + 7], ['m', 'j', 'm', 's']  # Gm Bb Cm D7
BRK_ROOTS, BRK_Q = [G, G, G - 4, G - 2], ['m', 'm', 'j', 'j']         # Gm Gm Eb F
V1_RIFF = ['bA', 'bB', 'bA', 'bF']              # the fourth bar of four fills
V2_STAB = dict(m='cm', j='cj', s='c7')          # the third (and seventh) on voice 2
V3_RIFF = dict(m='sMr', j='sJr', s='sSr')       # hats and the fifth on voice 3
V3_FILL = dict(m='sMf', j='sJf', s='sSr')
V3_DBL = dict(m='sMd', j='sJd', s='sSr')        # RIFF2: the riff doubled
V3_HATS = dict(m='sMb', j='sJb', s='sJb')       # breakdown: hats only


def bars(roots, quals, table, n, fill=None, start=0):
    """n bars of (root, pattern) from absolute bar START, the pattern by the
    bar's chord quality, from the fill table when the ABSOLUTE bar number is
    3 mod 4 (the fill gate counts absolute bars; the riff starts at bar 2, so
    its fills fall at the end of each Gm pair, before the chord changes)."""
    out = []
    for k in range(n):
        q = quals[k % 4]
        out.append((roots[k % 4], fill[q] if fill and (start + k) % 4 == 3 else table[q]))
    return out


def riff_v1(start, n):
    """Voice 1's riff from absolute bar START: bA bB bA bF by absolute bar."""
    return [(RIFF_ROOTS[k % 4], V1_RIFF[(start + k) % 4]) for k in range(n)]


SECTIONS = [("HITS", 0, 2), ("RIFF", 2, 10), ("DROP", 10, 12), ("BUILD", 12, 16),
            ("RIFF2", 16, 22), ("BREAKDOWN", 22, 26)]
SYNC_POS = [12, 22]

TUNE = dict(
    name="Candidate B2: Stabs",
    speed=(5, 4),
    instruments=INST,
    filters=FILT,
    alias={**_i.DRUM_ALIAS},
    patterns=dict(
        # voice 1. Hits: kick 1 and 3, snare 2 and 4, one bass note after each
        # kick, silence; h2 rolls into the riff.
        h1="K i=bass C2 r r S r r r K i=bass C2 r r S r r r",
        h2="K i=bass C2 r C2 S r r r K i=bass C2 r C2 S S S S",
        # The riff (written C, sounding G): eight plucks a bar, six of them on
        # odd sixteenths (the push after each kick), rests on 2, 5 and 10; the
        # fifth on 14 with the stab, a kick on 13 leading into it. bB answers
        # with fifths; bF fills on two toms; bR rolls back to the riff.
        bA="K i=bass C2 r C2 S r i=bass C3 C2 K i=bass Bb1 r C2 S K i=bass G2 C2",
        bB="K i=bass C2 r G1 S r i=bass C3 C2 K i=bass Bb1 r G1 S r i=bass Bb2 C2",
        bF="K i=bass C2 r C2 S r i=bass C3 C2 K i=bass Bb1 Bb1 C2 S i=bass G1 i=tom G4 F4",
        bR="K i=bass C2 C2 C2 S r i=bass C3 C2 K i=bass Bb1 Bb1 C2 S S S S",
        # The drop: the ENV3 bass alone on this voice, a 3-3-2 figure twice,
        # the chip's envelope restarted on each note (the kick is on voice 2)
        bP="i=fbass C2:3 C2:3 C3:2 C2:3 C2:3 G2:2",
        # The build: snare on every beat, then every eighth, then a roll
        bU="S i=bass C2 r C2 S i=bass C2 r C2 S i=bass C2 r C2 S i=bass C2 r C2",
        bU2="S i=bass C2 S i=bass C2 S i=bass C2 S i=bass C2 S i=bass C2 S i=bass C2 S i=bass C2 S i=bass C2",
        bU3="S S S S S S S S S S S S S S S S",
        l0="r:16",
        # voice 2. Hits (clav, the third); the riff stabs on 3, 6, 11, 14 with
        # the third (cm minor, cj major, c7 third and seventh); the drop's kick;
        # the build's stabs on the "and"s, then eighths, then sixteenths an
        # octave up; the lead's two two-bar phrases (bars 18-19, 20-21), half
        # their steps rests, beats 1 and 3 on chord tones or silent.
        c0="i=clav Eb4:2 r:6 Eb4:2 r:6",
        c1="i=clav Eb4:2 r Eb4:2 r Eb4:2 r:8",
        cm="r:3 i=clav Eb4:2 r Eb4:2 r:3 Eb4:2 r Eb4:2",
        cj="r:3 i=clav E4:2 r E4:2 r:3 E4:2 r E4:2",
        c7="r:3 i=clav E4:2 r Bb4:2 r:3 E4:2 r Bb4:2",
        dk="K r r r K r r r K r r r K r r r",
        u1m="r:2 i=clav Eb4:2 r:2 Eb4:2 r:2 Eb4:2 r:2 Eb4:2",
        u1j="r:2 i=clav E4:2 r:2 E4:2 r:2 E4:2 r:2 E4:2",
        u2m="i=clav Eb4 r Eb4 r Eb4 r Eb4 r Eb4 r Eb4 r Eb4 r Eb4 r",
        u3s="i=clav E5 G5 E5 G5 E5 G5 E5 G5 E5 G5 E5 G5 E5 G5 E5 G5",
        L1a="i=lead Bb4:2 G4 Bb4 r:4 Eb5:2 D5:2 r:4",
        L1b="r:4 i=lead D5:2 F5 D5 Bb4:4 r:4",
        L2a="i=lead G5:2 Eb5:2 r:4 C5:2 D5 Eb5 r:4",
        L2b="r:2 i=lead G4:2 Bb4:2 C5:2 r:2 Eb5:4 r:2",
        # voice 3, named by the bar's chord quality (sM minor, sJ major, sS
        # seventh: the chord-tone gate reads the name). Hits; the riff: hats on
        # the eighths, open on 7 and 13, the fifth (root for major, seventh
        # for the seventh chord) with the stab on 14; fills; the drop silent
        # (voice 3 is the ENV3 envelope); the build; RIFF2 doubles the bass
        # an octave up on 6 and 14; the breakdown keeps the hats alone.
        sM0="i=st C5:2 r:6 C5:2 r:6",
        sM1="i=st C5:2 r C5:2 r C5:2 r:8",
        sMr="H r H r H r H O H r H r H O i=st G4:2",
        sJr="H r H r H r H O H r H r H O i=st C5:2",
        sSr="H r H r H r H O H r H r H O i=st Bb4:2",
        sMf="H r H r H r H O H r H r H i=st G4 O O",
        sJf="H r H r H r H O H r H r H i=st C5 O O",
        d0="r:16",
        sMu="H r H r H r H r H r H r H r H O",
        sJu="H r H r H r H r H r H r H r H O",
        sMu2="H H H H H H H H H H H H H H H O",
        sSu3="H H H H H H H H O O O O O O O O",
        sMd="H r H r H O i=st C4:2 H r H r H O i=st G4:2",
        sJd="H r H r H O i=st C4:2 H r H r H O i=st C5:2",
        sMb="H r H r H r H r H r H r H r H O",
        sJb="H r H r H r H r H r H r H r H O",
    ),
    orders=[
        # voice 1: hits, LOOP, the riff (Gm Gm Bb F twice), the drop, the build
        # (Gm Bb Cm D7), the riff again (six bars), the breakdown (Gm Gm Eb F)
        seq((G, 'h1'), (G, 'h2'),
            'LOOP',
            *riff_v1(2, 8),
            (G, 'bP'), (G, 'bP'),
            *zip(BUILD_ROOTS, ['bU', 'bU', 'bU2', 'bU3']),
            *riff_v1(16, 6),
            *zip(BRK_ROOTS, ['bA', 'bF', 'bA', 'bR'])),
        # voice 2: the stabs; the drop's kick; the build's rising stabs; two
        # bars of stabs then the lead's call and answer; silent to the roll
        seq((G, 'c0'), (G, 'c1'),
            'LOOP',
            *bars(RIFF_ROOTS, RIFF_Q, V2_STAB, 8),
            (G, 'dk'), (G, 'dk'),
            *zip(BUILD_ROOTS, ['u1m', 'u1j', 'u2m', 'u3s']),
            (G, 'cm'), (G, 'cm'), (G, 'L1a'), (G, 'L1b'), (G, 'L2a'), (G, 'L2b'),
            (G, 'l0'), (G, 'l0'), (G, 'l0'), (G, 'c1')),
        # voice 3: hits; hats and the fifth, fills; silent for the envelope;
        # the build; the riff doubled; hats alone
        seq((G, 'sM0'), (G, 'sM1'),
            'LOOP',
            *bars(RIFF_ROOTS, RIFF_Q, V3_RIFF, 8, fill=V3_FILL, start=2),
            (G, 'd0'), (G, 'd0'),
            *zip(BUILD_ROOTS, ['sMu', 'sJu', 'sMu2', 'sSu3']),
            *bars(RIFF_ROOTS, RIFF_Q, V3_DBL, 6),
            *bars(BRK_ROOTS, BRK_Q, V3_HATS, 4)),
    ],
)
