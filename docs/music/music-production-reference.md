<!-- doc-type: reference -->

# C64 Music Production Reference

This document covers the musician's side of C64 audio: tracker software,
composition workflow, voice and filter strategy, the digi pipeline, and
tempo considerations across PAL and NTSC. It is deliberately separate from
[docs/techniques/music-sid.md](../techniques/music-sid.md), which covers
the SID runtime from the programmer's perspective — init/play conventions,
hard-restart, ADSR register sequencing, and assembly-level filter routing.
Read that document for the code side. Read this one for the composition
side and the pipeline from tracker output to player binary.

The underlying hardware reference is
[docs/hardware/sid-reference.md](../hardware/sid-reference.md).

---

## What a C64 musician actually works in

C64 music production does not use a DAW in the conventional sense. The
three voices of the SID chip map directly to three independent tracks in
a tracker, and the tracker is the primary authoring environment. A tracker
presents notes as sequences of rows in a pattern grid. Each row carries a
pitch, a waveform/instrument command, an ADSR preset number, and optional
effect commands. Patterns are assembled into a song table that sequences
them across the three voice channels.

The musician's deliverable is a player binary: a small piece of 6502
machine code that, when called at the interrupt rate (typically every
raster frame), reads the pattern data compiled from the tracker and writes
the resulting register values to the SID at $D400. The tracker compiles
the composition directly into this binary or into a standalone data block
that the player consumes. The programmer integrates the player binary into
the final demo or game by calling its init address once and its play
address from the raster interrupt handler.

This split — musician owns the tracker file, programmer owns the
integration — is the standard handoff model. The format of the compiled
output (SID file, raw binary at a fixed address, or a relocatable blob)
determines how the programmer receives the music. Understanding which
format a tracker produces, and what constraints the player binary imposes
on memory layout, is shared knowledge between both roles.

---

## Tracker landscape

### GoatTracker 2

GoatTracker is the dominant modern tracker for C64 music. It runs
natively on Windows, macOS, and Linux, which makes it accessible to
musicians who do not own hardware. The voice model mirrors the SID
exactly: three voice channels, independent pattern sequences per channel,
and a shared instrument table where each instrument defines waveform
tables, ADSR parameters, pulse width sequences, and arpeggio tables.

GoatTracker compiles to SID file format (PSID/RSID), to a raw binary
player at a configurable load address, or to a relocatable module.
The bundled player binary (GoatTracker Stereo Player or the mono variant)
is compact, typically under 1 KB for the player code alone. Pattern data
size depends entirely on the composition. The player is interrupt-driven
and expects to be called once per frame.

GoatTracker's instrument table supports multi-frame waveform and pulse
sequences — you can define complex attack shapes by stepping through
a waveform table entry per player tick. This is how experienced composers
create the characteristic hard-restart attacks that dominate scene-quality
SID music. The hard-restart is a GoatTracker convention as much as it is
a hardware technique.

Audience: broad. GoatTracker is used for scene demos, game soundtracks,
standalone SID releases, and chiptune sets.

### CheeseCutter

CheeseCutter takes a different ergonomic approach. Where GoatTracker
exposes a deep instrument editor with separate waveform/pulse/arp tables,
CheeseCutter presents a more visual pattern editor with in-pattern effect
commands. Composers who come from the Amiga MOD tracker tradition often
find CheeseCutter's layout more intuitive.

The voice and pattern model is comparable: three SID voices, pattern-based
sequencing, per-instrument ADSR. CheeseCutter's player is larger than
GoatTracker's; the trade-off is a more expressive effect command set
accessible directly from the pattern grid without entering a separate
instrument editor. Compiled output is a player binary with embedded data.

Audience: scene composers who prefer pattern-centric workflow; also used
by composers coming from other platforms.

### Defmon

Defmon targets the old-school scene revival aesthetic. It runs on real
C64 hardware or in VICE, positioning itself as a native tool rather than a
cross-platform editor. The voice model is standard three-voice SID, but
the instrument design intentionally limits itself to the register-level
operations available in classic 1980s players. This constraint is
deliberate: Defmon music sounds immediately period-authentic because the
instrument architecture does not permit modern multi-frame table tricks.

Compiled output integrates with the Defmon player binary. The player is
small and well-tested on real hardware. Because the tracker runs natively,
composers get immediate hardware feedback rather than relying on emulation.

Audience: scene musicians prioritising hardware authenticity and the
old-school sound over modern compositional tools.

### JCH NewPlayer

JCH NewPlayer is both a tracker and the player binary it drives. The
player itself has a long history in the C64 scene and is known for its
efficiency. The tracker is designed around the specific data format that
NewPlayer consumes, which means the player behavior is tightly predictable:
what you compose in the tracker is exactly what the player executes.

NewPlayer supports an expanded voice model through its effect system,
including pulse modulation and vibrato as first-class commands. The player
binary size is modest. Because NewPlayer is a specific player with a
specific tracker tied to it, integration is straightforward: the musician
delivers the compiled data block, the programmer links the NewPlayer binary
and calls its interface.

Audience: scene musicians who know the NewPlayer sound and want its
specific tonal character; some game music work.

### SID Factory II

SID Factory II is Linus Akesson's modern tracker, open-source and
cross-platform. It is built around a driver model: the tracker compiles
against a driver binary, and different drivers expose different feature
sets. The default driver supports multi-frame instrument tables, filter
automation, and a structured approach to the gate/hard-restart cycle that
makes the hard-restart behavior explicit and controllable.

The player (driver) binary size varies by driver variant, but the standard
driver is lean. SID Factory II exports to SID format and to raw binaries.
Its open architecture makes it suited for composers who want to understand
or modify the player behavior rather than treat it as a black box.

Audience: technically inclined composers; scene musicians who want modern
tooling with transparent internals; contributors to open-source C64
projects.

---

## The voice-3-as-drum dogma

For most of C64 music history, voice 3 has been the percussion voice.
The convention exists because the noise waveform — the best available
approximation of a drum sound — shares the voice with the other
waveforms. Setting a voice to noise, gating it briefly with a fast attack
and fast release, and modulating the filter cutoff around that transient
produces kick and snare approximations. Hi-hat textures come from short
noise bursts with high cutoff frequencies.

The deeper reason voice 3 became the dedicated percussion voice is that
the SID's filter can optionally disconnect voice 3 from the filter output.
The $D417 FLTX register's bit 7 (FILT3) routes voice 3 through the
filter, while the $D418 MOLVOL register's bit 7 (3OFF) disconnects voice
3 from the output entirely. Using 3OFF, a musician can play a gate-based
waveform on voice 3 for ring modulation or oscillator sync effects
without that voice appearing in the audio output at all. The percussion
convention exploits this: voice 3 runs in 3OFF mode except when a drum
hit fires, at which point the player briefly enables voice 3 output,
triggers the noise envelope, and silences it again. This way the drum
hits punch through without disrupting the melodic voices.

The cost is real: voice 3 reserved for drums means the composition is
effectively two-voice melodic content. Classic C64 game music from the
1980s — Rob Hubbard, Martin Galway, Jeroen Tel, Chris Hülsbeck — worked
within this constraint. The best of that era achieved remarkable melodic
richness through arpeggiated chords on voices 1 and 2 combined with
gate-timed rhythm on voice 3.

When to break it: scene-tier productions from the 2000s onward increasingly
treat all three voices as melodic instruments and source percussion
elsewhere — either from a separate digi voice (see section below) or by
accepting that the composition has no percussion and relying on rhythm
through arpeggiated basslines. A three-voice melodic arrangement without
percussion is a valid aesthetic choice in modern scene music. The dogma
is a convention, not a hardware constraint. Break it intentionally, not
by accident.

---

## Filter as a melodic instrument

The SID's shared analog filter is a single resonant multi-mode unit that
processes whichever voices are routed through it. The filter registers
($D415-$D418) set the cutoff frequency in 11 bits, the resonance level,
the mode (low-pass, band-pass, high-pass, or combinations), and the voice
routing. Because the filter is shared and analog, it acts on the sum of
routed voices rather than per-voice — this is a structural constraint that
composers must plan around.

Used actively, the filter is a synth lead instrument. A slow cutoff sweep
on a high-resonance low-pass setting creates the characteristic SID synth
pad sound. A fast cutoff sweep timed to the note gate creates a filter
attack — the note starts dark and opens to full brightness. A pulsing LFO
pattern on the cutoff register (written by the player once per frame)
produces a wah effect. These techniques are implemented in the player
through cutoff automation tables, which most modern trackers support as
part of the instrument definition.

### The 6581 vs 8580 resonance problem

The original 6581 SID (manufactured through approximately 1986) has a
steeper, more aggressive resonance character and a lower effective cutoff
range. Its filter is notoriously variable between individual chips; two
6581s from the same production batch can sound audibly different. The
later 8580 (from approximately 1987) has a more linear filter response,
higher effective cutoff ceiling, and much lower chip-to-chip variation.
The 8580 filter sounds cleaner and more predictable; the 6581 filter is
warmer and more characterful but harder to control.

The practical consequence for composition: a cutoff sweep written against
a 6581 will sound different — sometimes radically so — on an 8580 and
vice versa. Composer coping strategies are:

- Target one chip revision explicitly. Scene releases typically state a
  chip preference. A musician writing for a known hardware setup can
  calibrate against that chip and accept degraded quality on the other.

- Maintain two instrument presets. This is labor-intensive but thorough:
  tune the resonance and cutoff tables separately for 6581 and 8580,
  and switch at integration time based on the target.

- Use modal cutoff curves. Rather than sweeping cutoff over a wide range,
  keep cutoff movements within the range where the two chips overlap
  most closely — roughly the midpoint of the 11-bit scale. The audible
  difference between chip revisions narrows in this region. Filter
  movement still reads as expressive without pushing into the extremes
  where divergence is largest.

- Accept the difference. Many compositions sound acceptable on both chips
  even without active compensation, because the filter movement is
  secondary to the melodic content. Reserve chip-specific tuning effort
  for compositions where the filter is the primary voice.

GoatTracker and SID Factory II both allow the musician to audition their
work in emulators with explicit 6581 or 8580 filter models. Testing in
both before delivery is the minimum due diligence.

---

## Digi techniques from the music side

Standard three-voice SID music uses only the three synthesis voices. Digi
techniques add a fourth audio stream by abusing the 4-bit master volume
register at $D418 (bits 3-0, MVOL). Writing a rapid sequence of values to
MVOL while the synthesis voices are silent on a given path produces rough
but recognizable sample playback — the D/A converter at the output stage
responds to volume changes quickly enough to reproduce waveforms up to
roughly 8 kHz at 4-bit resolution.

From the musician's perspective, adding digi means deciding whether the
composition needs it and what the CPU cost is acceptable. Digi playback
requires the CPU to service the sample stream at a high rate — every few
raster lines for 8 kHz playback. This competes directly with the raster
effects and multiplexers in a demo. A game soundtrack playing during
active game logic has even less CPU headroom. The musician must negotiate
with the programmer about whether digi is feasible for a given scene.

When a musician does add digi voices, the modern preparation pipeline is:

1. Record or synthesize the source sound as a WAV at a high sample rate
   (44.1 kHz or 48 kHz) with appropriate processing (gate, compress,
   high-pass filter to reduce DC offset).

2. Downsample to the target digi rate, typically 7.8 kHz or 11 kHz
   (both are common player rates matched to the raster interrupt cadence).

3. Convert to 4-bit unsigned samples. Several open-source tools perform
   this conversion; the output is a raw binary blob.

4. Hand the binary to the programmer along with the target sample rate.
   The programmer configures the player's digi interrupt handler to
   consume the blob at the agreed rate.

The musician's constraint is that digi sample data is large relative to
the rest of the music data and relative to available RAM. A 4-second
sample at 7.8 kHz, 4-bit resolution, occupies approximately 15.6 KB — a
significant fraction of the C64's 64 KB address space. Keeping digi
samples short (drum hits, short vocal stabs) is the standard approach
rather than continuous digi playback.

---

## PAL vs NTSC tempo

The C64's system clock runs at 985248 Hz on PAL hardware and 1022727 Hz
on NTSC hardware. The raster interrupt fires every frame: 50 Hz on PAL,
approximately 60 Hz on NTSC. Because most SID players call the play
routine once per frame, the tempo of a composition is measured in frames
per beat — and the absolute tempo in beats per minute differs between PAL
and NTSC even when the frame count is identical.

A composition written at 6 frames per beat plays at 500 BPM on NTSC
(60 / 6 * 60) and 500 BPM on PAL (50 / 6 * 60 = 500 BPM). Wait — that
arithmetic is the same because frames-per-beat is a ratio. The difference
emerges in absolute time: on PAL, 6 frames is 120 ms per beat; on NTSC,
6 frames is 100 ms. The music plays noticeably faster on NTSC.

Player conventions for handling both regions fall into two approaches:

- PAL-only assumption. The player assumes 50 Hz and the musician
  calibrates tempo in frames at 50 Hz. On NTSC hardware the music plays
  faster. This is the dominant approach in the European scene. Most SID
  files in the HVSC (High Voltage SID Collection) are authored for PAL.
  NTSC users experience a slight tempo inflation.

- Dual-rate players. Some players detect the hardware region by measuring
  the raster interrupt frequency or by reading CIA timer values against
  a known reference, then select a different frames-per-beat value that
  approximates the intended tempo on each platform. This requires the
  player to carry two tempo tables. The compensation is approximate
  because the ratio 60/50 = 1.2 is not an integer; the best attainable
  match is a closest-fraction approximation that may still drift over
  longer compositions.

Practical advice for musicians: author at PAL (50 Hz). If NTSC
compatibility matters, alert the programmer and request a dual-rate player.
The note frequency tables in the player are also region-specific (the
correct SID frequency register value for a given pitch differs between PAL
and NTSC due to the different system clock), so a truly NTSC-compatible
music build uses NTSC-tuned frequency tables. See
[docs/techniques/music-sid.md](../techniques/music-sid.md) for the
frequency formula and register values.

---

## Modern workflow integration

Several musicians compose a draft in a DAW environment using SID
emulation, then port the composition into a tracker to produce the final
binary. The DAW phase is useful for rapid arrangement sketching,
especially for composers whose primary background is in software
production rather than tracker-based music.

SID emulation options used for DAW work:

- reSID is the most accurate software emulation of the 6581/8580. It
  forms the audio backend in VICE and several SID player applications.
  reSID as a VST or AU plugin (in various third-party wrappers) gives
  DAW composers direct access to a high-accuracy SID model.

- Plogue Chipsounds includes a SID model that targets compositional
  convenience over cycle-accurate emulation. It smooths over some
  hardware quirks to make the instrument more predictable from a DAW
  context. The trade-off is that compositions tuned in Chipsounds may
  behave differently in a real player.

- Hardware: composers with access to a SIDStation synthesizer (which
  contains a real 6581) can route MIDI from the DAW to the SIDStation
  for authentic hardware audition. SIDStation does not produce C64-
  compatible output directly; it is a studio instrument. Compositions
  developed on SIDStation must be rebuilt in a tracker to produce
  a player binary.

The porting step from DAW to tracker is the friction point. No tool
directly converts a MIDI arrangement to a GoatTracker or SID Factory II
file with correct instrument definitions. The musician transcribes note
sequences by hand into the tracker, selects instruments that approximate
the DAW sounds, and re-tunes against the tracker's native playback. This
is a deliberate step rather than an automated one; the tracker format's
constraints (three voices, discrete waveform selection, ADSR as stepped
envelopes) do not map cleanly from DAW plugin parameters.

Common modern setup: compose the high-level arrangement in a DAW with a
reSID VST for tonal reference, export a MIDI render for pitch reference,
open GoatTracker or SID Factory II alongside the MIDI, transcribe
patterns, tune instruments against the target chip version (6581 or
8580 emulation), then hand the compiled binary to the programmer.

Reyn Ouwehand's workflow for later compositions (publicly documented in
scene interviews) demonstrates that experienced C64 musicians often stay
entirely within the tracker. The DAW-first approach is more common among
composers who started in software production and came to C64 secondarily.

---

## Cross-references

- [docs/techniques/music-sid.md](../techniques/music-sid.md) — Runtime
  player patterns: init/play convention, ADSR register sequencing, filter
  routing, voice setup, hard-restart. The code counterpart to this
  document.

- [docs/hardware/sid-reference.md](../hardware/sid-reference.md) — Full
  register-level reference for the SID chip: $D400-$D418, voice
  architecture, filter modes, 6581 vs 8580 differences, envelope timing
  tables.

- [docs/toolchains/sidreloc.md](../toolchains/sidreloc.md) — Moving a
  finished `.sid` to another page and zero-page range when the tracker
  source is not available; the command line, what defeats it, and a
  register-write comparison to check the result.

- [docs/art/asset-pipelines.md](../art/asset-pipelines.md) — How tracker
  output (player binary, SID file, or raw data blob) is integrated into
  a demo or game build: load address conventions, multi-file PRG assembly,
  digi sample packing.
