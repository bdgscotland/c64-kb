# instruments.py: the instrument bank the three MEASURED candidates draw on.
# Each instrument is a TECHNIQUE from the kb's SID pages first and a sound
# second; the instrument notes give the mechanism,
# the page lines and the register-trace check for each. Values are for
# player.asm's semantics (see mkmusic.py's docstring):
#   ad, sr       $D405/$D406 nibbles (attack.decay, sustain.release)
#   wave         one row a frame: (control byte without gate, note); a
#                relative note adds to the pattern note, '=N' is absolute;
#                the last row holds, or 'loop:K' cycles
#   pw, pws      pulse width / 16 and the sweep a frame (bounces $100-$EFF)
#   vib, vdel    (depth shift << 4) | half period in frames; delay in frames
#   flt, fretrig filter program name; restart it on every note
#   legato       same instrument, gate still on: no restart, no new envelope
# Control-byte bits (sid-reference.md $D404): $80 noise, $40 pulse, $20 saw,
# $10 tri, $08 TEST, $04 RING, $02 SYNC; the player supplies $01 GATE.

INST = dict(
    # 1. Pulse bass: pulse wave with a pulse-width sweep and the player's
    #    hard restart (gate off, AD = SR = 0 two frames before each note).
    bass=dict(ad=0x09, sr=0x40, pw=0x28, pws=0x18,
              wave=[(0x41, 0)]),

    # 2. Filtered pluck bass: sawtooth through the low-pass filter with a
    #    cutoff sweep that closes on every note (fretrig), resonance 11,
    #    routed to voice 1 only. The 6581 curve is chip-dependent; the
    #    values were chosen against reSID's 6581 model.
    fbass=dict(ad=0x09, sr=0x60, flt='pluck1', fretrig=True,
               wave=[(0x21, 0)]),

    # 3. Pulse lead: TEST on the note's first frame (phase-locked start),
    #    an octave-up transient on the second, then the note; pulse sweep;
    #    delayed triangle vibrato (depth 1/8 semitone a frame, half period 5).
    lead=dict(ad=0x0a, sr=0xa8, pw=0x60, pws=6, vib=0x35, vdel=12,
              wave=[(0x09, 0), (0x41, 12), (0x41, 0)]),

    # 4. Wavetable arpeggios: one chord note a frame, cycling (minor 0-3-7,
    #    major 0-4-7, dominant seventh 0-4-7-10); pulse with a slow sweep.
    arpm=dict(ad=0x06, sr=0x50, pw=0x40, pws=3,
              wave=[(0x41, 0), (0x41, 3), (0x41, 7), 'loop:0']),
    arpM=dict(ad=0x06, sr=0x50, pw=0x40, pws=3,
              wave=[(0x41, 0), (0x41, 4), (0x41, 7), 'loop:0']),
    arp7=dict(ad=0x06, sr=0x50, pw=0x40, pws=3,
              wave=[(0x41, 0), (0x41, 4), (0x41, 7), (0x41, 10), 'loop:0']),

    # 5. Sync stab: sawtooth with SYNC set, so this oscillator restarts on
    #    every cycle of the previous voice's (voice 2 follows voice 1). The
    #    pitch heard is the MASTER's; this voice's note is a formant, swept
    #    down two octaves over thirteen frames then held. Written in unison
    #    with a 'sub' on the previous voice.
    sync=dict(ad=0x0a, sr=0x8a, pw=0x80,
              wave=[(0x23, 24), (0x23, 22), (0x23, 20), (0x23, 18), (0x23, 16),
                    (0x23, 14), (0x23, 12), (0x23, 10), (0x23, 8), (0x23, 6),
                    (0x23, 4), (0x23, 2), (0x23, 0)]),

    # 6. Sub / sync master: a plain triangle, sustained; the oscillator
    #    the sync stab and the ring bell borrow. Audible as a sub bass.
    sub=dict(ad=0x10, sr=0xf5, legato=True,
             wave=[(0x11, 0)]),

    # 7. Ring-modulated bell: triangle with RING set, so the triangle's top
    #    bit is XORed with the previous voice's oscillator (voice 3 follows
    #    voice 2, voice 1 follows voice 3): inharmonic partials at the sum
    #    and difference. Fast attack, long decay, no sustain.
    bell=dict(ad=0x0a, sr=0x09,
              wave=[(0x15, 0)]),

    # 8. Combined-waveform pad: triangle AND pulse ($50), slow attack,
    #    legato, through a low-pass filter whose cutoff bounces between two
    #    limits (routed to voice 3). The width is fixed at $200: the AND
    #    makes the pulse a gate on the triangle, so the loudness follows the
    #    width, and with a sweep the 6581 render measured RMS 498, 64, 797,
    #    1,345 across four 5 s windows (near silent at $E00 and above).
    pad=dict(ad=0x8a, sr=0xc6, pw=0x20, legato=True, flt='swell3',
             wave=[(0x51, 0)]),

    # 9. Noise-to-pulse kick: one frame of high noise (the beater), then a
    #    pulse falling through absolute notes 40 to 23 (E2 to B0).
    kick=dict(ad=0x07, sr=0x00, pw=0x80,
              wave=[(0x81, '=62'), (0x41, '=40'), (0x41, '=34'), (0x41, '=30'),
                    (0x41, '=27'), (0x41, '=25'), (0x40, '=23')]),

    # 10. Snare: noise, two frames of pulse body, then noise falling.
    snare=dict(ad=0x08, sr=0x00, pw=0x80,
               wave=[(0x81, '=74'), (0x41, '=48'), (0x41, '=45'), (0x81, '=70'),
                     (0x81, '=68'), (0x81, '=67'), (0x80, '=66')]),

    # 11. Test-bit hi-hat: noise with TEST held for the first frame, so the
    #     accumulator that clocks the LFSR starts from zero on every hit
    #     (a phase-locked attack; TEST does NOT reseed the LFSR), then noise.
    hat=dict(ad=0x04, sr=0x00,
             wave=[(0x89, '=94'), (0x81, '=94'), (0x81, '=93')]),
    ohat=dict(ad=0x07, sr=0x00,
              wave=[(0x89, '=93'), (0x81, '=93')]),

    # 12. Pitched tom: a noise click then a pulse gliding down seven
    #     semitones from the pattern note.
    tom=dict(ad=0x07, sr=0x00, pw=0x80,
             wave=[(0x81, '=66'), (0x41, 7), (0x41, 5), (0x41, 3), (0x41, 2),
                   (0x41, 1), (0x40, 0)]),

    # 13. Clav: narrow pulse with the fastest sweep, short decay; the
    #     funk keyboard. An octave flick on the first frame.
    clav=dict(ad=0x06, sr=0x20, pw=0x10, pws=0x3c,
              wave=[(0x41, 12), (0x41, 0)]),

    # 14. Brass stab: sawtooth, medium attack, through a band-pass wah that
    #     opens and closes (bounce), routed to voice 2. It was sawtooth AND
    #     pulse ($60, the kb's "biting lead" pair) until the 6581 render
    #     measured it at RMS 333 against the bass's 2,384 (combined
    #     waveforms are quiet on a 6581, sid-reference.md 101-107, and the
    #     band-pass takes more); instrument-stab-combined.wav keeps that
    #     version. The pad still carries the combined-waveform technique.
    stab=dict(ad=0x18, sr=0x69, pw=0x40, pws=0x0c, flt='wah2', fretrig=True,
              wave=[(0x21, 0)]),

    # 15. Filtered lead: sawtooth with slow, wide vibrato after a delay and
    #     a two-frame octave slide in; unfiltered (the pad owns the filter).
    flead=dict(ad=0x2a, sr=0x99, vib=0x46, vdel=18,
               wave=[(0x09, 0), (0x21, 12), (0x21, 7), (0x21, 0)]),

    # 16. Slap bass: pulse bass whose first frame is noise (the slap), then
    #     a wide pulse; medium decay.
    slap=dict(ad=0x08, sr=0x30, pw=0x60, pws=0x08,
              wave=[(0x81, '=70'), (0x41, 0)]),
)

# Filter programs: cut = first $D416, spd a frame (signed), min and max,
# res = resonance << 4 | routing bits ($01 voice 1, $02 voice 2, $04 voice 3),
# mode = $D418 high nibble ($10 low-pass, $20 band-pass, $40 high-pass).
FILTERS = dict(
    pluck1=dict(cut=0x60, spd=-6, min=0x14, max=0x60, res=0xb1, mode=0x10, bounce=False),
    swell3=dict(cut=0x30, spd=2, min=0x24, max=0x90, res=0x54, mode=0x10, bounce=True),
    wah2=dict(cut=0x28, spd=6, min=0x20, max=0x80, res=0xa2, mode=0x20, bounce=True),
)

DRUM_ALIAS = {'K': ('kick', 'C4'), 'S': ('snare', 'C4'), 'H': ('hat', 'C4'),
              'O': ('ohat', 'C4')}


def pick(*names):
    """The instruments named, in order, with the filters they use."""
    inst = {n: INST[n] for n in names}
    flts = {f: FILTERS[f] for f in sorted({i['flt'] for i in inst.values() if i.get('flt')})}
    return inst, flts
