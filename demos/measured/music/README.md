# Candidate A: "Lists" (round 3)

Written by the lead on 2026-09-24 after three composer agents died in their
reading phase. Composed to `the round-3 brief (summarised in music/README.md)`: a grammar first, then the
notes, then the gates, then the render. Nobody has listened to it except the
maintainer, who decides.

## Grammar

- Key C minor, 150 BPM (speed 5 and 5: five frames a sixteenth on PAL).
- Progressions, one chord a bar: A sections i VI III VII (Cm Ab Eb Bb);
  B sections i iv VI V (Cm Fm Ab G).
- Motif (the two-bar hook): C5 Eb5 G5 G5 F5 Eb5 D5 | C5 Bb4 C5 Ab4 (rest),
  stated in every A section, an octave up in A2 and A4, echoed one step
  behind at a third of the sustain in A3. Beats 1 and 3 of every lead bar sit
  on the bar's chord tones (100 of 100 by the gate).
- Voices: 1 pulse bass (pulse-width sweep 24, the player's two-frame hard
  restart) with the kick on beats 1 and 3 and the snare on 2 and 4
  interleaved, twelve bass notes a bar with octave jumps, a tom fill in every
  fourth bar; 2 the lead (pulse, vibrato after 12 frames); 3 one-frame
  arpeggio chords on the eighths with a closed hat between them and an open
  hat on the last off-beat; held arpeggios and a filtered pluck bass in the
  break; the echo of the lead in A3.

## Section map (bar = voice 1's pattern index = `music_pos`; 1.6 s a bar)

| Section | Bars | Starts at (s PAL) |
|---|---|---|
| INTRO (bass and drums, arpeggios from bar 2) | 0-3 | 0.0 |
| A | 4-11 | 6.4 |
| A2 (lead an octave up) | 12-19 | 19.2 |
| B | 20-27 | 32.0 |
| BREAK (held arpeggios, filtered bass, no drums) | 28-31 | 44.8 |
| A3 (lead with its echo on voice 3) | 32-39 | 51.2 |
| B2 | 40-47 | 64.0 |
| A4 (lead an octave up) | 48-55 | 76.8 |
| TAG | 56-59 | 89.6 |
| loop to bar 4 | | 96.0 |

Proposed `SYNC_POS_1..5` for MEASURED's sequencer: 12, 24, 36, 46, 56, so
the parts run 19.2, 19.2, 19.2, 16.0 and 16.0 seconds; 12, 24, 36 and 56 are
section boundaries, 46 is bar 7 of B2 (a half-phrase cut, taken to keep part
4 at 16 seconds). The loop returns to bar 4, below every SYNC value, so the
sequencer never waits on a position the tune cannot reach.

## Gates (`python3 tunecheck.py tune_A.py`)

All eleven pass: tempo 150.0; sections declared; motif recurrence 8 (the
gate asks 4); chord tones on beats 1 and 3, 80 of 80; arpeggio coverage 50 of
60 bars; kick or snare on every beat in 56 of 56 drum bars; a fill in 14 of
14 fourth bars; eight or more hats in 48 of 60 bars; eight or more bass notes
in 56 of 60 bars; the bass sweeps; the lead's vibrato is delayed.

## Measured (windowless VICE x64sc 3.10, the fixed player from TOURNEY's
`src/music.asm`: filter routing cleared when a program ends, NTSC skip
reloads 5)

- Player and tune: `$1000`-`$1BC9`, 3,018 bytes (tune 956 by the compiler's
  count); ceiling `$1D00`.
- Standalone runner (`runner.asm`, the music2 test shape), PAL, 12,000,000
  cycles: RESULT PASS, `music_pos` 3 at frame 300, calls 300, worst
  `music_play` call over frames 1 to 300 `$041F` = 1,055 cycles (net of the
  CIA1 bracket, JSR and RTS included). Whole tune, PAL, 120,000,000 cycles
  (`build/runner_A-pal-late.png`, row 6): worst `$04B9` = 1,209 cycles;
  `music_pos` `$0C` at frame 1,000 and `$31` (49) at frame 4,000, as 1.6 s
  a bar predicts. The old module's worst was 1,274 to 1,276.
- Renders, 100 seconds of PAL each, real time, 44,100 Hz mono:
  `candidate-A-6581.wav` (reSID 6581, `-sidenginemodel 256`) and
  `candidate-A-8580.wav` (reSID 8580, 257).

RMS per 5-second window (16-bit full scale 32,767):

```
6581: 3104 4506 4819 4861 4882 4808 4850 4847 4781 1745 4306 4795 4683 4224 4249 4157 4165 4041 2836 3959
      min 1745  median 4506  max 4882
8580: 2141 3124 3364 3396 3411 3361 3418 3399 3375 1485 3527 3913 3840 3503 3509 3467 3472 3367 2489 3305
      min 1485  median 3399  max 3913
```

The window at 45 to 50 seconds is the BREAK (no drums, held arpeggios,
filtered bass), quieter by design; on the 8580 model it reads 1,485 against
the brief's floor of 1,500. The brief's median floor of 2,500 is cleared on
both models.

## Not established

How it sounds. Whether the half-phrase cut at bar 46 shows on screen. The
8580 break window is 15 below the brief's floor. The NTSC run was made
before the melody fix and not repeated (the runner's NTSC verdict passed
then; the player's tempo correction makes the section timings the same in
seconds on both models).
