# Candidate A2, round 3: "Lists (darker)", C minor, 150 BPM (speed 5: five frames a
# sixteenth on PAL), 4/4, one bar a pattern (16 steps = 80 frames = 1.6 s).
# Written to plan/music3/BRIEF.md: a grammar first (key, progressions, a
# two-bar motif, a section plan), then the notes.
#
# Grammar
#   Key: C minor.  Progressions (one chord a bar):
#     A sections: i VI III VII  = Cm Ab Eb Bb   (the brief's first row)
#     B sections: i iv VI V     = Cm Fm Ab G    (the brief's third row)
#   Motif (two bars, the hook): C5 Eb5 G5 F5 Eb5 D5 | C5 Bb4 G4 (rest)
#   Voices: 1 = pulse bass with the kick and snare interleaved on the beats
#           (the classic single-voice bass-and-drums), 2 = the lead,
#           3 = one-frame arpeggio chords with a closed hat on every off
#           eighth (the arpeggio voice carries the hats, so the chord and the
#           hat share the step grid), the echo of the lead in A3.
#   Structure, bars (= voice 1's pattern index = music_pos):
#     INTRO 0-3 | A 4-11 | A2 12-19 (lead up an octave) | B 20-27 |
#     BREAK 28-31 (held arpeggios, filtered pluck bass, no drums) |
#     A3 32-39 (lead with its echo one step behind on voice 3) |
#     B2 40-47 | A4 48-55 (lead up an octave, arpeggios back) |
#     TAG 56-59 | LOOP to bar 4.   60 bars = 96 s; the loop is endless.
#   SYNC_POS for MEASURED (parts fade when music_pos reaches these):
#     12, 24, 36, 46, 56 -> parts of 19.2, 19.2, 19.2, 16.0, 16.0 s.
#     12, 24, 36 and 56 are section boundaries; 46 is bar 7 of B2 (a
#     half-phrase cut, taken to keep part 4 at 16 s).
import importlib.util, os
_p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "instruments.py")
_s = importlib.util.spec_from_file_location("instruments", os.path.abspath(_p))
_i = importlib.util.module_from_spec(_s); _s.loader.exec_module(_i)

INST, FILT = _i.pick('bass', 'fbass', 'flead', 'arpm', 'arpM', 'arp7',
                     'kick', 'snare', 'hat', 'ohat', 'tom')
INST['lead'] = dict(_i.INST['flead'])   # the sawtooth lead: darker than the pulse one
# The echo: the lead's own sound at a third of its sustain, one step behind.
INST['echo'] = dict(_i.INST['flead'], sr=0x38)

# The break's bass (2026-09-24): the filtered pluck's cutoff sweep (pluck1, a
# linear sweep the player counts) is replaced by the kb's ENV3 filter
# envelope, sid_env3_filter_envelope: the player gates voice 3 with each bass
# note, holding voice 3 out of the mix (3OFF in the mode byte, $90 = low-pass
# with bit 7), and every frame writes $D416 = ($D41C >> 1) + base, so the
# cutoff is the chip's own ADSR, read back from voice 3's envelope register.
# Attack 4 (38 ms, two frames) opens the filter after the note starts, decay
# 9 closes it towards sustain 3 over about 300 ms, and the two-frame hard
# restart before the next note drops it to base. Cutoff range $14 to $93;
# after the break the program stays as a static cutoff at $14 on voice 1,
# which is the register state the pluck's sweep left before this change.
# Voice 3 rests during the break, so its held arpeggios move to voice 2,
# which rested there. Compiled by mkmusic_env3.py (this directory), not the
# tourney compiler, which has no kind 2.
INST['fbass'] = dict(_i.INST['fbass'], flt='env1')
FILT = dict(env1=dict(env=(0x49, 0x39), base=0x14, res=0xb1, mode=0x90))


def seq(*items):
    """Order list from (transpose, pattern) pairs and 'LOOP'. A transpose
    token is emitted whenever it differs from the previous entry INCLUDING
    the first entry after LOOP (the compiler's transposes persist on the
    voice, and the tune loops to bar 4, whose transpose must be explicit)."""
    out, cur = [], None
    for it in items:
        if it == 'LOOP':
            out.append('LOOP'); cur = None; continue
        t, p = it
        if t != cur:
            out.append('t%+d' % t); cur = t
        out.append(p)
    return out


# Chord roots relative to C: C 0, Ab -4, Eb +3, Bb -2, F +5, G +7.
A_ROOTS = [0, 5, 7, 0]      # Cm Fm Gm Cm: i iv v i, all minor
B_ROOTS = [0, -4, 5, 7]     # Cm Ab Fm G: i VI iv V, the V major for tension
A_MAJOR = [False, False, False, False]
B_MAJOR = [False, True, False, 'seventh']

BAR_PAT = ['bA', 'bA', 'bA', 'bF']    # the fourth bar of every four fills


def bass(roots, bars=8):
    return [(roots[k % 4], BAR_PAT[k % 4]) for k in range(bars)]


def arps(roots, major, bars=8, held=False):
    out = []
    for k in range(bars):
        q = major[k % 4]
        pat = ('aSh' if held else 'aS') if q == 'seventh' else ('aJh' if held else 'aJ') if q else ('aMh' if held else 'aM')
        out.append((roots[k % 4], pat))
    return out


A_LEAD = [(0, 'm1'), (0, 'm2'), (0, 'm3'), (0, 'm4'), (0, 'm1'), (0, 'm2'), (0, 'm5'), (0, 'm6')]
A_LEAD_HI = [(-12, p) for _, p in A_LEAD]   # the second statement an octave DOWN
B_LEAD = [(0, 'n1'), (0, 'n2'), (0, 'n3'), (0, 'n4'), (0, 'n1'), (0, 'n2'), (0, 'n5'), (0, 'n6')]

# The section plan, bars [start, end), and the sequencer's fade positions.
SECTIONS = [("INTRO", 0, 4), ("A", 4, 12), ("A2", 12, 20), ("B", 20, 28),
            ("BREAK", 28, 32), ("A3", 32, 40), ("B2", 40, 48), ("A4", 48, 56),
            ("TAG", 56, 60)]
SYNC_POS = [12, 24, 36, 46, 56]
A_ECHO = [(0, 'e1'), (0, 'e2'), (0, 'e3'), (0, 'e4'), (0, 'e1'), (0, 'e2'), (0, 'e5'), (0, 'e6')]
REST8 = [(0, 'l0')] * 8

TUNE = dict(
    name="Candidate A2: Lists darker",
    speed=(5, 5),
    instruments=INST,
    filters=FILT,
    alias={**_i.DRUM_ALIAS, 'M': ('arpm', 'C4'), 'J': ('arpM', 'C4'), 'Q': ('arp7', 'C4')},
    patterns=dict(
        # voice 1: bass with kick (beats 1 and 3) and snare (2 and 4) on the
        # beat steps; twelve bass notes a bar, octave jumps, a walk-up at the end
        bA="K i=bass C1 C2 C1 S i=bass C1 C2 C1 K i=bass C1 C2 C1 S i=bass C1 Bb1 C2",
        bF="K i=bass C1 C2 C1 S i=bass C1 C2 C1 K i=bass C1 C2 C1 S S i=tom C4 A3",
        bP="i=fbass C1:4 C1:4 C2:4 C2:4",   # four sweeps a bar, one a beat
        # (bR, aJh and aSh, which no order list used, were dropped on
        # 2026-09-24 for the room the kind-2 player code takes below $1D00)
        # voice 2: the hook and its variations ('silent' is the all-rest
        # pattern the fixed player's compiler requires for its silent list)
        l0="r:16",
        silent="r:16",
        # beats 1 and 3 (steps 0 and 8) sit on the bar's chord tones:
        # A bars run Cm Ab Eb Bb, B bars Cm Fm Ab G
        m1="i=lead C5:2 Eb5:2 G5:4 G5:2 F5:2 Eb5:2 D5:2",
        m2="i=lead C5:6 Bb4:2 Ab4:2 F4:4 r:2",
        m3="i=lead D5:2 Bb4:2 G4:4 G4:2 A4:2 Bb4:4",
        m4="i=lead C5:6 Eb5:2 C5:2 G4:4 r:2",
        m5="i=lead Bb4:2 D5:2 G5:4 G5:2 F5:2 D5:4",
        m6="i=lead Eb5:4 D5:4 C5:8",
        n1="i=lead C5:2 Eb5:2 G5:4 G5:2 F5:2 Eb5:2 D5:2",
        n2="i=lead C5:6 Bb4:2 C5:2 Ab4:4 r:2",
        n3="i=lead Ab4:2 C5:2 F5:4 F5:2 Eb5:2 C5:4",
        n4="i=lead D5:4 B4:4 G4:4 B4:4",
        n5="i=lead C5:2 Ab4:2 F5:4 F5:2 Eb5:2 Db5:4",
        n6="i=lead B4:2 D5:2 G5:4 G5:4 D5:4",
        # voice 3: arpeggio chords on the eighths, a closed hat between them,
        # an open hat on the last off-beat; held arpeggios for the break;
        # the echo patterns are the m patterns one step late
        aM="M H M H M H M H M H M H M H M O",
        aJ="J H J H J H J H J H J H J H J O",
        aMh="M:16",
        aS="Q H Q H Q H Q H Q H Q H Q H Q O",
        hI="H r H r H r H r H r H r H r O r",
        e1="r i=echo C5:2 Eb5:2 G5:4 G5:2 F5:2 Eb5:2 D5",
        e2="r i=echo C5:6 Bb4:2 Ab4:2 F4:4 r",
        e3="r i=echo D5:2 Bb4:2 G4:4 G4:2 A4:2 Bb4:3",
        e4="r i=echo C5:6 Eb5:2 C5:2 G4:4 r",
        e5="r i=echo Bb4:2 D5:2 G5:4 G5:2 F5:2 D5:3",
        e6="r i=echo Eb5:4 D5:4 C5:7",
    ),
    orders=[
        # voice 1: bass and drums
        seq((0, 'bA'), (0, 'bA'), (0, 'bA'), (0, 'bF'),
            'LOOP',
            *bass(A_ROOTS), *bass(A_ROOTS), *bass(B_ROOTS),
            (0, 'bP'), (-4, 'bP'), (3, 'bP'), (-2, 'bP'),
            *bass(A_ROOTS), *bass(B_ROOTS), *bass(A_ROOTS),
            (0, 'bA'), (0, 'bA'), (0, 'bA'), (0, 'bF')),
        # voice 2: the lead; the break's held arpeggios (voice 3 is the
        # envelope's during the break, so it rests there)
        seq(*[(0, 'l0')] * 4,
            'LOOP',
            *A_LEAD, *A_LEAD_HI, *B_LEAD,
            *arps(A_ROOTS, A_MAJOR, bars=4, held=True),
            *A_LEAD, *B_LEAD, *A_LEAD_HI,
            *[(0, 'l0')] * 4),
        # voice 3: arpeggios and hats, rests in the break, the echo in A3
        seq((0, 'hI'), (0, 'hI'), (0, 'aM'), (0, 'aM'),
            'LOOP',
            *arps(A_ROOTS, A_MAJOR), *arps(A_ROOTS, A_MAJOR), *arps(B_ROOTS, B_MAJOR),
            *[(0, 'l0')] * 4,
            *A_ECHO, *arps(B_ROOTS, B_MAJOR), *arps(A_ROOTS, A_MAJOR),
            (0, 'aM'), (0, 'aM'), (0, 'aM'), (0, 'aM')),
    ],
)
