---
category: music
chip: SID
---

<!-- doc-type: technique-reference -->

# SID Instruments

Techniques that make an instrument out of the chip's own parts: an
envelope generator, an oscillator or a readback register put to a use
other than the voice it belongs to. `music-sid.md` covers the foundation
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
| A, the mechanism on | 1003 | 460 | 1003 (frame 1) | 735 |
| B, voice 3 gated, the copy off | 996 | 453 | 996 | 728 |
| C, no envelope at all | 1026 | 459 | 1026 | 719 |

The copy costs 7 cycles more than the player's static-cutoff path on
every one of 192 frames (A minus B), which the instruction table
predicts: `LDA $D41C`, `STA mu_e3`, `LSR`, `CLC`, `ADC mu_fbase`, `STA
mu_fcut`, `STA $D416` is 24 against the static path's 18, and the kind
test's taken branch adds one. The mechanism alone, with an immediate
base and no log stores, is 14; with the base in memory 16. Against the
plain player (A minus C): +1 on 175 frames of 192, +22 on the six frames
where a lead note starts after a hard restart, +16 on the seven
hard-restart frames, +6 on the two rest frames, and -44 and -23 on the
loop's first two frames, where the plain player writes voice 3's rest
event and the envelope player skips voice 3's music writes altogether.
The worst-frame figure on the Cost line is the +22; the typical is the
+1. The whole player's worst call, 1,003 cycles, is 5.1 % of a PAL frame
and 5.9 % of an NTSC one (arithmetic). The build's four-file program,
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
