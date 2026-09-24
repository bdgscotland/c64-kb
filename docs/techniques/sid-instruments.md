---
category: music
chip: SID
---

<!-- doc-type: technique-reference -->

# SID Instruments

Techniques that make an instrument out of the chip's own parts: an
envelope generator, an oscillator or a readback register put to a use
other than the voice it belongs to, and instruments built from the
control register's features (sync, ring modulation, the pulse width, the
gate and the envelope rates) through the #50 music player, each
measured against the same instrument with the feature off.
`music-sid.md` covers the foundation
these stand on (voice setup, filter routing, the play routine convention,
the two chip revisions); the entries here presuppose it and say so on
their **Requires:** lines. Every figure carries its rung: measured in
VICE x64sc 3.10 (reSID) by the recipe's own checks, arithmetic from the
instruction table, or not measured, named as such.

---

## sid_env3_filter_envelope — Voice 3's envelope generator drives the filter cutoff

**Complexity:** medium
**Region:** both
**Uses registers:** D412, D413, D414, D416, D417, D418, D41C
**Requires:** sid_play_routine_pattern, sid_filter_routing
**Cost:** cycles_per_frame=22, cycles_per_frame_typical=1
**Cost basis:** measured-vice
**Cost measured on:** kickassembler-sid-env3-filter (the play call's increment over the same player with no envelope, per frame, from a CIA1 bracket; worst is a lead note frame after a hard restart; the recipe's two log stores are inside it)
**Claims:** sid_voice_3 (owns), sid_filter_volume (shares), sid_voice_3_readback (reads)
**Claims basis:** measured-vice

Every claim below is register-level, measured in VICE x64sc 3.10 (reSID,
6581 and 8580 models, PAL and NTSC) by the recipe's own checks, a monitor
memory dump and the sound driver's register log. Nobody has listened to
the recordings; the recipe reports their level per second and nothing
about how they sound.

### Why

The filter is the SID's one moving timbre. The KB moves it with a
software table stepped once a frame (`sid_filter_routing`, the #50
player's filter program) or voice 3's oscillator read as an LFO
(`sid_filter_routing`, "Filter as LFO target"). Neither gives the cutoff
what every voice already has: an attack, a decay through the chip's
exponential stages, a sustain level, a release. The chip has a third
envelope generator, and its output is readable at `$D41C`. With voice 3
silenced, its envelope can drive the filter.

### How

- Route the voices that should be filtered through the filter (FILT1,
  FILT2 in `$D417`) and leave FILT3 clear. Set 3OFF (bit 7 of `$D418`)
  with the filter mode and volume.
- Give voice 3 the filter's ADSR in `$D413`/`$D414`. Its frequency stays
  at zero and it never needs a note.
- On the lead's note frame, after the lead's own AD, SR and gate, gate
  voice 3 too: `$D412` = `$11` (triangle and GATE; any waveform bit will
  do). On the lead's hard restart, restart voice 3 the same way (AD = SR =
  0, gate off). On the lead's rest, clear voice 3's gate.
- Every frame, in the player's filter section: read `$D41C`, shift right
  once, add a base, write `$D416`. The cutoff then moves between the base
  and the base plus 127.

The recipe adds this to the #50 player as filter program kind 2: a filter
entry carries the envelope's AD, SR and base; the voice whose instrument
names it is the lead; the player's mu_skip mechanism, which keeps a music
voice from writing while an effect owns it, keeps voice 3 silent in the
same way, and masks FILT3 off in `$D417` while the envelope owns the
voice. The recipe checks the identity in the last bullet: for every frame the
byte written to `$D416` equals the byte read from `$D41C`, shifted, plus
the base.

### Why it works

`$D41C` returns the 8-bit output of voice 3's envelope generator, which
runs whether or not the voice is audible (`sid-reference.md`, ENV3). 3OFF
disconnects voice 3 from the mixer on the bypass path, and with FILT3
clear that is voice 3's only path (`sid-reference.md`, "Voice 3 mute only
mutes the bypass path"; `pitfalls/sid.md`,
`sid_voice3_disable_silent_bit`). The envelope generator does not know
what its output is used for: attack is a linear count to 255, decay and
release step down with periods that double at 93, 54, 26, 14 and 6
(`sid-reference.md`, ADSR rate table), sustain holds at level times `$11`.
Halving the byte fits the 8-bit cutoff register above a base, and the
filter takes each write as it lands.

The register trace is a `$D416` sequence that rises by a constant step (about 25 a frame at attack 8), falls with
a per-frame slope that halves at the stage boundaries, holds at a level,
and falls again to the base when the gate clears, while satisfying
`$D416` = (`$D41C` >> 1) + base on every frame. A software sweep gives
constant steps that stop or reverse; an OSC3 LFO gives a triangle that
never holds. ENV3 as a pulse-width source (`sid-reference.md`, ENV3,
"Wizball") and the filter registers are each documented; the combination,
and the trace it leaves, were on no page of this knowledge base when the
technique was built (2026-09-23).

Measured on the recipe (PAL, attack 8, decay 10, sustain 2, release 8,
base `$20`, one sample per frame at the end of the play call):

- ENV3 as the player read it, from the note frame: `01 32 64 96 C8 FB F6
  EC E2 D8 CE C4 BA B0 A6 9C 92 88 7E 73 69 5F 59 54 4F 4A 45 40 3B 36 34
  31 2F 2C 2A 27 25 22 22 22 ...`: five rising steps of 49 to 51, a peak
  sample of `$FB` (the attack reaches 255 and the decay begins inside the
  same frame, so a per-frame sample never lands on `$FF`), then a fall of
  9.5 a frame down to 93, 5.0 a frame down to 54, 0.7 a frame down to 34,
  then `$22` held for 35 frames until the note ends.
- `$D416` on the same frames: `20 20 39 52 6B 84 9D 9B 96 91 8C 87 82 7D
  ... 31 31 31`, each byte the ENV3 byte halved plus `$20`, 192 of 192
  frames.
- In the rest after the note, ENV3 falls `22 18 12 0D 0A 07 05 03 02 00`
  over nine frames (release 8) and the cutoff returns to `$20`.
- NTSC differs only by the frame: 44 a frame in the rise, a peak sample
  of `$FE`, 36 frames at `$22`.

### Variations

**A second lead voice.** The program that loads the filter program is the
lead; a second voice with the same instrument gates voice 3 too and the
last gate written wins. Keep it monophonic, or give the second voice an
instrument without the program.

**Other scalings.** `$D416` = `$D41C` with no shift spans the whole
register from the base (and wraps above 255 minus the base: the recipe's
FORCE_FAULT build does this and its cutoff wraps to `$1B` at the peak).
Two shifts give a quarter-range sweep. `$D415` can take the bits the
shift drops for an 11-bit cutoff.

**Inverted.** Subtract instead of add, from a top: the filter closes on
the attack and opens through the decay.

**Voice 3 kept as a modulator.** The oscillator is not used. It can still
be read at `$D41B` for another purpose while the envelope drives the
filter; the two are independent (not built here).

### Cycle budget

Measured on the recipe with a CIA1 timer A bracket around every play call
(the call including its JSR and RTS, net of the bracket's 5 cycles), the
same on the 6581 and 8580 models; NTSC reads 8 higher in every cell:

| | worst frame | plain frame | lead note frame | lead restart frame |
|---|---|---|---|---|
| A, the mechanism on | 1062 | 466 | 1062 (frame 1) | 742 |
| B, voice 3 gated, the copy off | 1055 | 459 | 1055 | 735 |
| C, no envelope at all | 1092 | 465 | 1092 | 726 |

The table was re-measured after the player moved each note's gate
before its AD and SR (#118); it read 1003, 460, 1003 and 735 on row A
before, and the differences below are unchanged except the first two
frames'.

The copy costs 7 cycles more than the player's static-cutoff path on
every one of 192 frames (A minus B), which the instruction table
predicts: `LDA $D41C`, `STA mu_e3`, `LSR`, `CLC`, `ADC mu_fbase`, `STA
mu_fcut`, `STA $D416` is 24 against the static path's 18, and the kind
test's taken branch adds one. The mechanism alone, with an immediate
base and no log stores, is 14; with the base in memory 16. Against the
plain player (A minus C): +1 on 175 frames of 192, +22 on the six frames
where a lead note starts after a hard restart, +16 on the seven
hard-restart frames, +6 on the two rest frames, and -51 and -30 on the
loop's first two frames (-44 and -23 before #118), where the plain player writes voice 3's rest
event and the envelope player skips voice 3's music writes altogether.
The worst-frame figure on the Cost line is the +22; the typical is the
+1. The whole player's worst call, 1,062 cycles (NTSC 1,070), is 5.4 %
of a PAL frame and 6.3 % of an NTSC one (arithmetic; 1,003 before
#118). The build's four-file program,
with a frame meter assembled in after the verdict's variables, measured
1,002, 464 and 737 on row A and +21 on the six note frames: moving the
player moved page crossings in its indexed loads, and every figure by at
most four cycles.

Bytes, by the instruction table over the listing (arithmetic): about 157
bytes of code and state added to the player, and two bytes per filter
entry in the tune.

### Pitfalls met

- `sid_voice3_disable_silent_bit`: FILT3 must be clear or 3OFF does
  nothing; the player masks it off whenever the envelope owns voice 3.
  On an 8580 R5 with a bypass residual, voice 3's oscillator stands at
  frequency zero here (never written after init), so what leaks is a DC
  level that follows the envelope, not a tone. Not measured: reSID has
  no residual.
- `sid_adsr_bug_8580`: the lead's hard restart (AD = SR = 0, gate off,
  two frames early) is mirrored onto voice 3, so the filter's attack
  starts from a reset envelope.
- `sid_filter_chip_variation`: the same `$D416` path is a different sweep
  in hertz on the two chips. Both models were run; the identity and the
  ENV3 sequence are the same on both, as they must be: nothing here is
  downstream of the filter.
- `sid_write_only_registers`: the identity is checked on what the player
  read and what it meant to write; the sound driver's register log shows
  what the SID received, 576 of 576 writes equal.
- `sfx_in_player`: an effect slot on voice 3 and this envelope cannot
  share the voice. The recipe requests no effect.
- A SID replacement that cannot read `$D41B` (`sid_replacement_d41b_unreadable`)
  may not read `$D41C` either (not measured); the cutoff would then sit
  at the base plus whatever the read returns.
- Testing in VICE: with `+sound` or `-sounddev dummy`, `$D41C` does not
  return the envelope (measured; `sidasid_emulation_notes` says so for
  reads in general). The pinned run uses `-sound -sounddev dump`.

### Recipes

- `recipes/kickassembler/sid-env3-filter.md`

---

## sid_hard_restart_drum — A fast-attack drum from noise and pulse rows, hard-restarted, gate before AD and SR

**Complexity:** low
**Region:** both
**Uses registers:** D40E, D40F, D410, D411, D412, D413, D414
**Requires:** sid_play_routine_pattern
**Cost:** cycles_per_frame=47, cycles_per_frame_typical=0
**Cost basis:** measured-vice
**Cost measured on:** kickassembler-sid-hr-snare (per play call, the hard restart and the gate-first order against the plain #50 player: phase A against phase B of the FORCE_FAULT build; worst is a restart call, PAL and NTSC alike)
**Claims:** sid_voice_3 (owns)
**Claims basis:** derived-listing

Every claim below was measured in VICE x64sc 3.10 (reSID, 6581 and 8580
models, PAL and NTSC) by the recipe's ENV3 reads, the dump sink's
register trace and WAV recordings. Nobody has listened to the
recordings.

### Why

A drum wants its attack on the frame the pattern names. With attack 0
the envelope reaches its peak in about 2 ms, unless the ADSR bug holds
it: a rate counter that has run past the attack's period waits for its
15-bit wrap, 32,768 cycles, 33 ms on PAL (`pitfalls/sid.md`,
`sid_adsr_bug_8580`). A drum's rest runs a release rate whose period is
far above attack 0's, so an unprepared hit almost always waits.

### How

- Give the drum AD with attack 0 and SR with sustain 0: here AD `$08`,
  SR `$08`. Voice 3 in the recipe, so ENV3 can watch it; any voice works.
- A wavetable of one waveform per row: noise at a high absolute note,
  two pulse rows falling (absolute C4 and A3, width `$800`), then noise
  falling and held. Absolute notes make every hit the same drum whatever
  note the pattern gives.
- Two frames before each hit, gate off and AD = SR = 0 (the #50
  player's hard restart, `mu_hr`).
- On the hit's frame write the control byte with the gate first, then
  AD, then SR. The recipe's player defers AD and SR to just after the
  control write (`mu_envp`): 15 and 24 cycles after the gate.

### Why it works

The restart sets release 0, the shortest period, two frames (39,312
cycles) before the hit, so any wrap it starts is over and the counter
cycles inside that period when the gate arrives. At the gate's edge the
registers still hold the restart's zeros, so the attack begins at once;
AD and SR then set the drum's own rates. Written before the gate, SR's
release 8 runs the counter past 8 in the 150 cycles to the gate, and AD's
decay 8 is the period reSID uses for the edge's first cycles
(`src/resid/envelope.cc`, `writeCONTROL_REG`); either undoes the
restart.

Measured on the recipe (PAL, eight hits a phase; the start-up wait moved
through ten values to move the SID's counter phase, 80 hits a row):

| Note-frame order | Hard restart | None |
|---|---|---|
| gate, AD, SR | 80 / 80 on time | 10 / 80 |
| AD, gate, SR | 73 / 80 | 8 / 80 |
| AD, SR, gate (the #50 player) | 0 / 80 | 1 / 80 |

"On time" is ENV3 above zero when read just after the hit's play call.
The on-time hits without a restart are each phase's first, which follows
the harness's `music_init`. Gate first: 80 of 80 on the 6581 model and 35
of 35 on NTSC. In the recordings, on-time hits reach 30 % of their peak
0.2 to 1.1 ms after the gate write and late ones 33.0 to 34.8 ms, on
both models; a late hit plays its first two wavetable rows, the noise
crack and the first pulse row, into a silent envelope.

The trace a correct build leaves in the dump sink: two calls before
every hit, `$D413` = `$D414` = 0 with the gate off; on the hit, `$D412`
with the gate, then `$D413` and `$D414`. A #50-order build writes the
hit's `$D413` and `$D414` about 150 cycles before `$D412`.

### Variations

**Longer drums.** A release above 0 is safe with the gate-first order:
the recipe's release is 8. A sustain above 0 would hold a tone until the
rest (not built).

**The TEST-bit restart.** `sid-reference.md` lists a restart that sets
TEST on the middle frame to phase-lock the oscillator (not built here).

**Without the player.** Another player that writes AD, SR and the gate
on one frame can take the same order: gate, then AD, then SR (not built
here).

### Cycle budget

Per play call, PAL, the listing against the plain #50 player: 0 on 102
calls of 192, +7 on 54 (the `mu_envp` test on a control write), +28 on
hit calls, +29 on restart calls, +47 worst. The restart alone (phase A
against B): +29 on a restart call, +9 on a call that checks for one
before a rest; the same on NTSC.

### Pitfalls met

- `sid_adsr_bug_8580`: the restart and the write order are the fix; the
  order is the part the pitfall's hard restart does not cover on its own.
- `sidasid_emulation_notes`: ENV3 reads need a real sound sink in VICE;
  the pinned run uses `-sound -sounddev dump`.

### Recipes

- `recipes/kickassembler/sid-hr-snare.md`

---

## sid_sync_lead — A hard-sync lead: voice 3 the unheard master, a stepped slave on voice 1

**Complexity:** low
**Region:** both
**Uses registers:** D400, D401, D404, D405, D406, D40E, D40F, D412, D417, D418
**Requires:** sid_play_routine_pattern
**Cost:** cycles_per_frame=292, cycles_per_frame_typical=36
**Cost basis:** measured-vice
**Cost measured on:** kickassembler-sid-sync-lead (per play call, phase A against phase B, which has SYNC off and voice 3 resting: the master voice's player work; the SYNC bit itself adds nothing; worst is a call where the master starts a note, PAL and NTSC alike)
**Claims:** sid_voice_1 (owns), sid_voice_3 (owns), sid_filter_volume (shares)
**Claims basis:** derived-listing

Every claim below was measured in VICE x64sc 3.10 (reSID, 6581 and 8580
models, PAL and NTSC) by the recipe's log, the dump sink's register
trace and WAV recordings. Nobody has listened to the recordings.
`sid_voice_setup` in `music-sid.md` describes sync as a variation; this
is the instrument built and measured through the #50 player.

### Why

Hard sync gives a lead whose timbre can move while its pitch stays put:
the brightness sweep of an analogue sync lead. The SID syncs voice 1 to
voice 3, so voice 3 has to run at the note's pitch. A player that spends
voice 3 on it needs that voice to be silent.

### How

- Voice 1, the slave: a wavetable whose rows carry sawtooth + SYNC
  (`$22`) with relative notes that climb, here +12, +14, +17, +19, +22,
  +24, +26, +27, +29, one row a frame, then hold. Attack 0, sustain 10.
- Voice 3, the master: the same pattern notes with a plain instrument
  (triangle). Its instrument loads a filter program that writes `$D417`
  = `$F0` (no voice filtered) and `$D418` = `$8F` (3OFF, volume 15).
- Choose a final interval that is not a whole-number ratio; the recipe's
  +29 semitones is a ratio of 5.339.

### Why it works

SYNC resets voice 1's accumulator each time voice 3's accumulator MSB
rises (`sid-reference.md`, "Oscillator sync"). The output repeats at the
master's period; the slave's frequency sets how much of its sawtooth ramp
plays inside each period. Voice 3's oscillator runs whether gated or not,
and 3OFF with FILT3 clear takes it off the only path to the output.

Measured on the recipe, a window of ten frames after each note's sweep,
the fundamental by autocorrelation:

| | E4 | G4 | A4 | B4 | D5 |
|---|---|---|---|---|---|
| master, Hz | 329.6 | 392.0 | 440.0 | 493.9 | 587.4 |
| heard with SYNC (both models) | 329.5 | 392.0 | 440.2 | 494.1 | 587.5 |
| heard without (the slave alone) | 1,760.7 | 2,094.3 | 2,345.1 | 2,631.0 | 3,138.5 |

The trace a correct build leaves: every call where voice 1 sounds has
`$D404` = `$23`; voice 3's frequency is the note's on every call; `$D418`
= `$8F` and `$D417` = `$F0` from voice 3's first note. The slave's
frequency over the master's steps 2.000, 2.245, 2.669, 2.996, 3.563,
4.000, 4.490, 4.756 and holds at 5.339.

### Variations

**A different sweep.** Any wavetable shape works; a fall, a bounce or a
slower climb (not built).

**Pulse slave.** `$42` syncs a pulse wave; its width is a second timbre
control (not built).

**Voice 2 as slave.** Voice 2 syncs to voice 1: a sync lead that leaves
voice 3 free, at the cost of voice 1 (not built).

### Cycle budget

Per play call, the lead with its master against the slave alone, PAL:
+36 on 147 calls of 192, +57 on 12; for each master note, +112 on the
call that reads it, +99 on its hard restart, +190 on the call before it
and +292 on its own call; NTSC the same. The whole player's
worst call here is 1,012 cycles on PAL.

### Pitfalls met

- `sid_voice3_disable_silent_bit`: 3OFF silences voice 3 only with FILT3
  clear; the tune's filter program routes no voice.
- `sid_adsr_bug_8580`: the lead's attack is 0; the player writes the gate
  before AD and SR (`sid_hard_restart_drum`, #118).

### Recipes

- `recipes/kickassembler/sid-sync-lead.md`

---

## sid_ring_mod_bell — A ring-modulated bell: triangle carrier, an unheard modulator a tritone up

**Complexity:** low
**Region:** both
**Uses registers:** D400, D401, D404, D405, D406, D40E, D40F, D412, D417, D418
**Requires:** sid_play_routine_pattern
**Cost:** cycles_per_frame=289, cycles_per_frame_typical=36
**Cost basis:** measured-vice
**Cost measured on:** kickassembler-sid-ring-bell (per play call, phase A against phase B, which has RING off and voice 3 resting: the modulator voice's player work; the RING bit itself adds nothing; worst is a call where the modulator starts a note, PAL and NTSC alike)
**Claims:** sid_voice_1 (owns), sid_voice_3 (owns), sid_filter_volume (shares)
**Claims basis:** derived-listing

Every claim below was measured in VICE x64sc 3.10 (reSID, 6581 and 8580
models, PAL and NTSC) by the recipe's log, the dump sink's register
trace and WAV recordings. Nobody has listened to the recordings.
`sid_voice_setup` in `music-sid.md` describes ring modulation as a
variation; this is the instrument built and measured through the #50
player.

### Why

A bell's partials are not harmonics of one pitch. The SID's waveforms
give only harmonic spectra, except through ring modulation, which puts a
voice's triangle at the sums and differences of two frequencies. Voice 1
rings against voice 3, so voice 3 has to run at the modulator's pitch
and stay silent.

### How

- Voice 1, the carrier: triangle + RING (`$14`) in its wavetable; attack
  0, decay 9, sustain 0, release 9, for a struck envelope.
- Voice 3, the modulator: the carrier's pattern, through an order list
  whose transpose puts it six semitones up (`$A6`). A plain instrument;
  it loads a filter program that writes `$D417` = `$F0` (no voice
  filtered) and `$D418` = `$8F` (3OFF, volume 15).
- Pick an interval whose frequency ratio is not a small whole number; six
  semitones is 1.414.

### Why it works

The SID folds its sawtooth into a triangle on the accumulator's MSB; with
RING set the fold uses voice 1's MSB XORed with voice 3's
(`sid-reference.md`, "Ring modulation"). The triangle flips at the
modulator's rate, which multiplies it by a square wave: the output lies
at the sums and differences of the two frequencies and their odd
multiples. Voice 3's accumulator runs gated or not, and 3OFF with FILT3
clear takes it off the output.

Measured on the recipe, a spectrum over eight frames from each note's
gate, carrier E5 659.3 Hz and modulator 932.3 Hz on the first note:

| | Strongest partials, × carrier | On the carrier's harmonics |
|---|---|---|
| RING on (both models) | 2.414, 0.418, 3.241, 5.247 | 1.5 % to 5.1 % over 8 notes |
| RING off (the carrier alone) | 1, 3, 5, 7 | 100 % |

0.414 and 2.414 are the modulator minus and plus the carrier; 3.243 and
5.243 are three times the modulator minus and plus it (arithmetic). The
two strongest partials are within 1 dB of each other on every note.

The trace a correct build leaves: every call where voice 1 sounds has
`$D404` = `$15`; voice 3's frequency is 1.414 times voice 1's on every
such call; `$D418` = `$8F` and `$D417` = `$F0` from voice 3's first note.

### Variations

**Other intervals.** Any ratio away from a whole number gives an
inharmonic set; a whole number of octaves puts every partial on the
carrier's harmonics (arithmetic; not built).

**Moving modulator.** A wavetable or vibrato on voice 3 sweeps the
partials while the carrier holds (not built).

**Voice 2 as carrier.** Voice 2 rings against voice 1, leaving voice 3
free (not built).

### Cycle budget

Per play call, the bell with its modulator against the carrier alone,
PAL: +36 on 147 calls of 192, +56 on 13; for each modulator note, +112
on the call that reads it, +98 on its hard restart, +189 on the call
before it and +289 on its own call; NTSC the same. The whole player's
worst call here is 1,014 cycles on PAL.

### Pitfalls met

- `sid_voice3_disable_silent_bit`: 3OFF silences voice 3 only with FILT3
  clear; the tune's filter program routes no voice.
- `sid_adsr_bug_8580`: the bell's attack is 0; the player writes the gate
  before AD and SR (`sid_hard_restart_drum`, #118).

### Recipes

- `recipes/kickassembler/sid-ring-bell.md`

---

## sid_pwm_pad — A pulse-width-modulated pad: the player's width sweep moves the even harmonics

**Complexity:** low
**Region:** both
**Uses registers:** D400, D401, D402, D403, D404, D405, D406
**Requires:** sid_play_routine_pattern
**Cost:** cycles_per_frame=114
**Cost basis:** measured-vice
**Cost measured on:** kickassembler-sid-pwm-pad (per play call, phase A against phase B, which holds the width: +114 on a sweep call, +12 on the call between, one voice, PAL and NTSC alike)
**Claims:** sid_voice_1 (owns)
**Claims basis:** derived-listing

Every claim below was measured in VICE x64sc 3.10 (reSID, 6581 and 8580
models, PAL and NTSC) by the recipe's log, the dump sink's register
trace and WAV recordings. Nobody has listened to the recordings.
`sid_voice_setup` in `music-sid.md` describes PWM pads driven from
`$D41B`; this one uses the #50 player's own width sweep and leaves voice
3 alone.

### Why

A held pulse is a static timbre. Moving its width moves the balance of
its odd and even harmonics, the slow motion a pad needs, with no filter
and no second voice.

### How

- An instrument with the pulse waveform (`$40`), a slow attack (attack
  8), full sustain (`SR` `$F8`), a start width (`tn_pwh` `$02`: `$200`)
  and a sweep byte (`tn_pws` `$30`).
- The #50 player adds the sweep to the width every other frame (stored
  doubled: `$30` is 48 a step, 24 a frame), turns round at `$100` and
  `$EFF`, and writes `$D402`/`$D403` only when the width changed.
- Each new note reloads the start width unless its pulse byte has bit 7
  set (keep the running width).

### Why it works

A pulse of duty d has harmonic n at an amplitude proportional to
|sin(π n d)| / n, so the second harmonic over the first is |cos(π d)|
(arithmetic): 1 at a thin pulse, 0 at a square. Measured on the recipe,
in windows of four frames through two notes of 96 frames, the ratio
follows |cos(π × width / 4096)| to 0.026 on average and 0.079 at most on
both models, from 0.035 near `$830` to 0.895 near `$200`; held at
`$200` it stays at 1.042 (A3) and 0.885 (E3). Level rises as the width
nears half: RMS 3,612 to 4,690 on the 6581 model, 2,720 to 3,532 on the
8580.

The trace a correct build leaves: `$D402`/`$D403` change every other
call while the note sounds, by the sweep, and return to the start width
at each new note; nothing else in the voice changes.

### Variations

**Keep the width across notes.** A pulse byte with bit 7 set carries the
running width into the next note, so the sweep is continuous over a
phrase (not built).

**Two voices, opposite sweeps.** A second pad voice sweeping down against
this one sweeping up (not built).

**Tri+pulse.** Its level follows the width (`sid-reference.md`, combined
waveforms): the same sweep would move its volume as well. Hold the width
below `$700` for a steady level, as that page says (not built here).

### Cycle budget

Per play call against the same pad with its width held, PAL: +114 on a
sweep call, +12 on the call between (the parity test), 0 on 8 calls of
192; NTSC the same. The whole player's worst call here is 959
cycles on PAL, the phase's first call in both phases.

### Pitfalls met

- `sid_write_only_registers`: the width cannot be read back from
  `$D402`/`$D403`; the player's copy in RAM is the width.

### Recipes

- `recipes/kickassembler/sid-pwm-pad.md`
