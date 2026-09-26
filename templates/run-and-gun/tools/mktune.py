#!/usr/bin/env python3
"""mktune.py: FIREBASE's in-game tune and its five sound effects, as data for
src/sound.asm (sfx_voice_takeover, c64-kb recipe kickassembler/sfx-voice-takeover).
Deterministic: the same source gives the same bytes.

    python3 tools/mktune.py              # writes src/gen/tune.asm
    python3 tools/mktune.py --listing    # also prints the tune, bar by bar

The tune is original, composed here: "Firebase March", A minor, eight bars of
4/4 that loop, 15.4 s on PAL. One tick is 3 frames (AU_SPEED 2); a sixteenth
is 2 ticks, so a bar is 96 frames. On NTSC the driver skips the tick count one
frame in six, so the tempo is the same, and it plays from an NTSC frequency
table, so the pitch is the same.

    voice 1  bass, pulse: root and octave in eighths, one chord a bar
    voice 2  drums, noise: kick on 1 and 3, snare on 2 and 4, a pickup on 4
    voice 3  the melody, pulse with a slow width sweep

The melody is on voice 3 because an effect takes voices 1 and 2
(sfx_voice_takeover): in a fire-fight the melody is what keeps playing.

Pattern event: note, length in ticks (2 or more). Note 0 is a rest (no gate).
$FF ends the pattern, which loops. Each voice's pattern is its own table of up
to 255 bytes; the driver patches the table address per voice.

Effect: a 14-byte image of $D400-$D40D (voice 1 then voice 2: frequency lo/hi,
pulse lo/hi, control, AD, SR), then start note, end note, frames per step - 1,
direction (+1 or $FF), voice-2 interval (voice 2 plays index - interval) and
flags (bit 0: voice 1 keeps its start pitch; bit 7: voice 1's gate toggles
every step; bit 6: voice 2's). Length = |end - start| x (speed + 1) frames.
The driver writes the start pitches from the frequency table, so an effect is
in tune on NTSC too; the image's frequency bytes are the PAL values.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "src", "gen", "tune.asm")

PAL_CLOCK = 985248       # Hz, c64-kb docs (6569/8565 PAL phi2)
NTSC_CLOCK = 1022727     # Hz, 6567R8
NNOTES = 95              # C-0 to A#7: B-7 on PAL does not fit 16 bits
SPEED = 2                # a tick every SPEED + 1 frames
UNIT = 2                 # ticks per sixteenth

NAMES = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}


def note(name):
    """'A4' -> 57 (C-0 = 0, the recipe's numbering); '-' -> 0, a rest."""
    if name == "-":
        return 0
    n = NAMES[name[:-1]] + 12 * int(name[-1])
    assert 1 <= n < NNOTES, name
    return n


def freq(n, clock):
    return round(16.3516 * 2 ** (n / 12) * 16777216 / clock)


# ---- the tune: (note, sixteenths) per bar -----------------------------------------
MELODY = [
    [("A4", 3), ("A4", 1), ("C5", 2), ("E5", 2), ("D5", 4), ("C5", 2), ("B4", 2)],
    [("C5", 3), ("B4", 1), ("A4", 2), ("G4", 2), ("A4", 8)],
    [("A4", 3), ("A4", 1), ("C5", 2), ("E5", 2), ("G5", 4), ("F5", 2), ("E5", 2)],
    [("D5", 3), ("E5", 1), ("D5", 2), ("C5", 2), ("B4", 8)],
    [("F5", 3), ("E5", 1), ("D5", 2), ("C5", 2), ("D5", 4), ("E5", 4)],
    [("C5", 3), ("B4", 1), ("A4", 2), ("B4", 2), ("C5", 4), ("E5", 4)],
    [("A5", 4), ("G5", 2), ("E5", 2), ("F5", 2), ("E5", 2), ("D5", 2), ("B4", 2)],
    [("A4", 8), ("-", 4), ("E4", 2), ("G#4", 2)],
]
CHORDS = ["A2", "F2", "A2", "G2", "D2", "A2", ("F2", "G2"), "E2"]
DRUMS = [("K", 4), ("S", 4), ("K", 2), ("K", 2), ("S", 2), ("S", 2)]
DRUM_NOTE = {"K": note("C3"), "S": note("C6")}   # noise pitch: low thump, high crack


def bass_bar(chord):
    roots = chord if isinstance(chord, tuple) else (chord, chord)
    out = []
    for root in roots:                   # two half bars: root, octave, root, octave
        r = note(root)
        out += [(r, 2), (r + 12, 2), (r, 2), (r + 12, 2)]
    return out


def events_to_bytes(events):
    out = []
    for n, units in events:
        ticks = units * UNIT
        assert 2 <= ticks <= 255
        out += [n, ticks]
    out.append(0xFF)
    assert len(out) <= 255, len(out)
    return out


def voices():
    v1 = [e for c in CHORDS for e in bass_bar(c)]
    v2 = [(DRUM_NOTE[d], u) for _ in range(len(MELODY)) for d, u in DRUMS]
    v3 = [(note(n), u) for bar in MELODY for n, u in bar]
    for bar in MELODY:
        assert sum(u for _, u in bar) == 16
    lengths = {sum(u for _, u in v) for v in (v1, v2, v3)}
    assert lengths == {16 * len(MELODY)}, lengths
    return v1, v2, v3


# ---- instruments, index 0 = voice 1 ---------------------------------------------------
# control, AD, SR, pulse width (12 bits), pulse sweep per frame (0 = none)
INSTRUMENTS = [
    (0x41, 0x08, 0x48, 0x300, 0x00),     # bass: pulse, short decay to sustain 4
    (0x81, 0x06, 0x00, 0x000, 0x00),     # drums: noise, decay 6 to silence
    (0x41, 0x0A, 0x96, 0x600, 0x18),     # melody: pulse, sweep $4xx-$7xx
]

# ---- effects: (name, voice 1 (ctrl, AD, SR, pw), voice 2 (...), start, end, speed, interval, flags)
EFFECTS = [
    ("SHOT", (0x81, 0x00, 0xF0, 0x000), (0x41, 0x00, 0x90, 0x800), "C7", "E6", 0, 36, 0x00),
    ("THROW", (0x11, 0x00, 0xF2, 0x000), (0x81, 0x00, 0x62, 0x000), "G4", "B5", 0, 12, 0x00),
    ("BLAST", (0x81, 0x00, 0xFA, 0x000), (0x41, 0x00, 0xF8, 0x400), "D4", "D2", 1, 24, 0x40),
    ("KILL", (0x41, 0x00, 0xC4, 0x600), (0x21, 0x00, 0xC4, 0x000), "E6", "A#4", 0, 5, 0x80),
    ("DEATH", (0x11, 0x00, 0xF8, 0x000), (0x41, 0x00, 0xF8, 0x800), "G5", "G2", 1, 7, 0x40),
]


def effect_bytes(fx):
    name, i1, i2, start, end, speed, interval, flags = fx
    s, e = note(start), note(end)
    assert s != e and min(s, e) - interval >= 0, name
    img = []
    for (ctrl, ad, sr, pw), n in ((i1, s), (i2, s - interval)):
        f = freq(n, PAL_CLOCK)
        img += [f & 0xFF, f >> 8, pw & 0xFF, pw >> 8, ctrl, ad, sr]
    direction = 1 if e > s else 0xFF
    return img + [s, e, speed, direction, interval, flags], abs(e - s) * (speed + 1)


def row(label, values):
    lines = []
    for i in range(0, len(values), 16):
        chunk = ", ".join(f"${v:02x}" for v in values[i:i + 16])
        lines.append(f"{label if i == 0 else ' ' * len(label)} .byte {chunk}")
    return lines


def main():
    v1, v2, v3 = voices()
    pats = [events_to_bytes(v) for v in (v1, v2, v3)]
    L = [
        "// tune.asm: written by tools/mktune.py; do not edit (make assets, make assetcheck).",
        "// \"Firebase March\" and FIREBASE's five sound effects, data for src/sound.asm.",
        f".const AU_SPEED  = {SPEED}        // a tick every AU_SPEED + 1 frames",
        f".const AU_NNOTES = {NNOTES}",
        f".const AU_NFX    = {len(EFFECTS)}         // sfx_request numbers 1-{len(EFFECTS)}",
        "",
        "// Frequency tables, C-0 to A#7: PAL (used as is) and NTSC (copied over it by audio_init).",
    ]
    pal = [freq(n, PAL_CLOCK) for n in range(NNOTES)]
    ntsc = [freq(n, NTSC_CLOCK) for n in range(NNOTES)]
    assert max(pal) <= 0xFFFF
    L += row("au_freqlo:", [f & 0xFF for f in pal])
    L += row("au_freqhi:", [f >> 8 for f in pal])
    L += row("au_ntsclo:", [f & 0xFF for f in ntsc])
    L += row("au_ntschi:", [f >> 8 for f in ntsc])
    L += ["", "// Instruments, index 0 = voice 1: control, AD, SR, pulse width, pulse sweep a frame."]
    L += row("au_ictrl:", [i[0] for i in INSTRUMENTS])
    L += row("au_iad:  ", [i[1] for i in INSTRUMENTS])
    L += row("au_isr:  ", [i[2] for i in INSTRUMENTS])
    L += row("au_ipwlo:", [i[3] & 0xFF for i in INSTRUMENTS])
    L += row("au_ipwhi:", [i[3] >> 8 for i in INSTRUMENTS])
    L += row("au_ipws: ", [i[4] for i in INSTRUMENTS])
    L += ["", "// Pattern tables per voice (note, ticks; note 0 rests; $FF loops)."]
    L += ["au_pblo:   .byte <au_pat1, <au_pat2, <au_pat3", "au_pbhi:   .byte >au_pat1, >au_pat2, >au_pat3"]
    for k, p in enumerate(pats, 1):
        L += row(f"au_pat{k}:", p)
    L += ["", "// Effects: 14-byte image of $D400-$D40D, start, end, speed, direction, interval, flags."]
    L += ["fx_base:   .byte " + ", ".join(f"fx_{fx[0].lower()} - fx_data" for fx in EFFECTS), "fx_data:"]
    lens = []
    for fx in EFFECTS:
        b, n = effect_bytes(fx)
        lens.append((fx[0], n))
        L += row(f"fx_{fx[0].lower()}:", b)
    L += ["", "// sfx_request numbers (src/sound.h has the same):"]
    L += [f"// {k} {name:6} {n} frames" for k, (name, n) in enumerate(lens, 1)]
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, "w").write("\n".join(L) + "\n")
    loop_frames = 16 * len(MELODY) * UNIT * (SPEED + 1)
    print(f"mktune: tune.asm, patterns {len(pats[0])}+{len(pats[1])}+{len(pats[2])} bytes, "
          f"loop {loop_frames} frames, effects " + ", ".join(f"{n} {f}" for n, f in lens))
    if "--listing" in sys.argv:
        for b, bar in enumerate(MELODY, 1):
            c = CHORDS[b - 1]
            print(f"bar {b}: {'/'.join(c) if isinstance(c, tuple) else c:6} " + " ".join(f"{n}:{u}" for n, u in bar))


if __name__ == "__main__":
    main()
