<!-- doc-type: reference -->

# C64 Music Design: Instruments, Form, Voices and Cost

How to design the sounds and the arrangement of a game tune for the
player in `recipes/kickassembler/music-player.md`. The worked example is
that recipe's tune, "Test Card": every instrument byte quoted here is in
its listing.

Two kinds of statement are on this page, and each is marked:

- **Craft guidance** is the author's own knowledge (rung 4). Nobody has
  listened to "Test Card". Why an instrument is built this way is taste,
  not measurement.
- **Measured** figures come from the recipe (cycle counts, register
  traces) or from the reSID WAV captures in `hardware/sid-reference.md`
  (loudness). Each one names its source.

The musician's tools and pipeline are in `music/music-production-reference.md`.
The player mechanics are in `techniques/music-sid.md` and
`techniques/sid-instruments.md`.

---

## Instruments

Each instrument in the player is ten bytes: AD, SR, a wavetable start,
pulse width (two bytes), pulse sweep, vibrato, vibrato delay, filter
program and flags (the format comment in the recipe's tune part). The wavetable gives
a waveform and a note offset per frame, so one instrument can change
waveform and pitch on each of its first few frames. That is how
all the sounds below are made.

### Filter-plucked sawtooth bass

"Test Card" instrument 0. AD `$0A`, SR `$80`, sawtooth, filter program 1.
Filter program 1 starts the low-pass cutoff (`$D416`) at `$58` and lowers
it by 5 a frame to `$14`, with resonance `$A` on voice 1 (`$D417` =
`$A1`). It restarts on every note (`tn_flt` = `$81`).

Craft guidance: the note starts bright and turns dull within about 14
frames, which reads as a plucked string. The decay (`$A`) and the
cutoff fall work together. Sustain 8 keeps the tail at half level so
the pitch stays clear under the drums.

### Resonant filter bounce

Instrument 1, the second-half bass. Sawtooth, AD `$08`, SR `$A6`,
filter program 2: cutoff from `$10`, rising 2 a frame and bouncing
between `$10` and `$60`, resonance `$C` (`$D417` = `$C1`). It does not
restart on each note, so the sweep runs across the bar.

Craft guidance: a slow bounce under a moving bass line gives the "wah"
that carries a section without a new melody. High resonance makes the
sweep audible; too high and the 6581 whistles (below).

### Pulse lead with delayed vibrato

Instrument 2. AD `$0A`, SR `$A9`, pulse width `$800` with a sweep of 4 a
frame (measured: `$D409`-`$D40A` read `$800`, `$808`, `$810` on
alternate frames, recipe "Expected output"). Vibrato `$35`: depth shift
3, half period 5 frames, starting after a delay of 10 frames. The
wavetable's first row is TEST (the note's first frame, under the hard
restart), then one frame an octave up, then the note.

Craft guidance: the octave-up frame sharpens the attack. The
vibrato delay keeps short notes steady and lets long notes sing. A slow
pulse sweep keeps a held note from sounding static.

### One-frame chord arpeggios

Instruments 4 and 5, on voice 3. Pulse `$400`, sweep 3 a frame, AD
`$06`, SR `$50`. The wavetable cycles root, +3, +7 semitones (minor,
instrument 4) or root, +4, +7 (major, instrument 5), one frame each,
and loops.

Craft guidance: at 50 frames a second a three-note cycle is heard as a
chord with a buzz, not as three notes. It gives harmony without a
voice per note.

### Noise-plus-pulse drums

Instruments 6 to 8, on voice 3. The wavetable uses absolute notes, so
the drum sounds the same whatever the pattern's pitch.

| Drum | AD / SR | Wavetable (one row a frame) |
|---|---|---|
| Kick, 6 | `$07` / `$00` | noise at note 62, then pulse falling from note 40 through 34, 30, 27, 25 to 23, held |
| Snare, 7 | `$08` / `$00` | noise at note 74, pulse at 48, pulse at 45, then noise at 70, 68, 67, 66, held |
| Hat, 8 | `$03` / `$00` | noise at note 94, held |

Craft guidance: the noise frame is the click of the stick; the falling
pulse is the body of the kick. Sustain 0 makes each drum stop by itself,
so a pattern needs no note-off.

### Legato run

Instrument 3, the fast sixteenth-note runs. Pulse `$600`, sweep 5 a
frame, AD `$09`, SR `$C8`, legato flag set: a new note changes the pitch
without a hard restart or a new attack.

### Combined waveforms: check the 6581

"Test Card" uses no combined waveform. If an instrument does, check it
on both SID models first. Measured in reSID (`hardware/sid-reference.md`,
"Combined waveforms"):

- Saw+pulse (`$61`) reads 16 % of a sawtooth on the 6581 below PW `$800`
  and nothing from `$800` up. On the 8580 it is as loud as a sawtooth.
- Tri+pulse (`$51`) loses level as the width rises past `$700`, on both
  models. A pulse sweep on a tri+pulse pad sweeps its volume.

---

## Song form and looping

"Test Card" is 10 bars in E minor, 960 frames (19.15 s), and loops to
its third order-list entry, a loop of 768 frames (15.32 s) (recipe,
"Tempo on both clocks", arithmetic).

Voice 1's order list is the plan of the song:

| Section | Patterns | Transpose |
|---|---|---|
| Intro, played once | bass pattern 0 twice | 0 |
| Loop, part A | pattern 0, then 1, 1, 0 | 0, −4, −2, −5 |
| Loop, part B | bounce-bass pattern 2, four times | 0, 0, −4, −2 |

In E minor the transposes −4, −2 and −5 put the bass on C, D and B, so
the four bars run i, VI, VII, V. One pattern and a transpose byte give
a chord change for one byte of order list.

Craft guidance:

- Loop to the first bar after the intro, not to the start, so the intro
  plays once.
- End the loop on a chord that leads back to the first. Here the last
  bar is D (the VII), a whole tone below the E the loop returns to.

Tempo: two speeds alternate, 7 and 5 frames a step, an average of 6. The
unequal pair is the swing. On PAL a step is 0.1197 s, 125.3 beats a
minute (recipe, arithmetic from 50.125 Hz). Speeds under 5 break the
player's cost spread (below).

---

## Voice allocation

| Voice | Role in "Test Card" | Why |
|---|---|---|
| 1 | Bass, both filter programs | The filter programs set `$D417` for voice 1 only |
| 2 | Lead and runs; rests through the two intro bars | The melody keeps its voice all through |
| 3 | Drums and chord arpeggios | Sound effects take voice 3 |

Measured (recipe): while an effect runs, voice 3's music keeps reading
its patterns but writes nothing, and `$D417` is masked with `$FB` so
voice 3 leaves the filter. When the effect ends, the music's next note
on voice 3 gates a fresh attack. All 11 hand-backs in the recipe's
script were followed by that attack, within 11 frames on PAL and 13 on
NTSC.

Craft guidance: put on voice 3 what the tune can lose for a second. A
shot that cuts the drums and chords leaves bass and melody, and the
tune still sounds whole. Never put the melody on the effects voice.

---

## Cycle budget

Measured on the recipe with this tune, per `music_play` call, CIA1
timer A around the call:

| Figure | PAL | NTSC |
|---|---|---|
| Worst call | 1,250 | 1,250 |
| Worst call with no effect | 1,242 | 1,250 |
| Median | 782 | 784 |
| Best | 451 | 459 |
| Skipped call (NTSC tempo) | none | 32 each, one call in six |

The table was re-measured after the player moved each note's gate
before its AD and SR (#118); it read 1,198, 1,159, 773 and 454 on PAL
before.

What costs the most, from the recipe's traces:

- **Three notes starting on one step.** The costliest frames with no
  effect each start a note on all three voices (gate, AD and SR written
  for each).
- **An effect handing voice 3 back.** On PAL the worst hand-back frame
  costs 8 cycles more than the worst music-only frame (39 before #118);
  on NTSC the worst frame has no effect.
- **A shadow copy.** This player writes straight to the SID. The
  shadow-register player in `recipes/kickassembler/sfx-in-player.md`
  pays 351 cycles a frame for its copy.

How the player keeps the worst frame down: each voice reads its next
event on its own frame (4, 3 and 2 frames before the step), the hard
restart runs two frames before, and the new instrument loads one frame
before, so the step frame writes only envelopes and gates. A voice that
holds, with no vibrato or sweep, writes nothing.

The cost of each feature on its own (vibrato, pulse sweep, filter
program, wavetable row) has not been measured here. Budget the worst
call, 1,200 cycles on either clock, and re-measure with the recipe's
harness when the tune changes.

---

## 6581 and 8580

The two chips differ most in the filter and the combined waveforms
(`hardware/sid-reference.md`, "6581 vs 8580").

- **Filter.** The 6581's cutoff curve is not linear and varies from chip
  to chip. A filter program tuned on one model will open at a different
  point on the other. The "Test Card" cutoffs (`$10` to `$60`) were not
  compared between models here.
- **Resonance.** Craft guidance: high resonance (`$C` and up) whistles
  on many 6581s and is mild on the 8580. See
  `music/music-production-reference.md`, "The 6581 vs 8580 resonance problem".
- **Combined waveforms.** Measured, see Instruments above: saw+pulse is
  nearly silent on the 6581.
- **Plain waveforms.** Measured in reSID: sawtooth, triangle and pulse
  read about 30 % louder on the 6581 model than on the 8580.

A tune meant for both models should use plain waveforms for anything
that must be heard, and should keep the filter programs short enough
that a wrong cutoff is brief. Detecting the model and choosing a cutoff
table is `sid_filter_chip_variation` in `pitfalls/sid.md`.
