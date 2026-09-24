<!-- doc-type: reference -->

# C64 Music Production Reference

The musician's side of C64 audio: tracker software, composition workflow,
voice and filter strategy, the digi pipeline, and tempo on PAL and NTSC.
The programmer's side of the SID runtime (init/play conventions,
hard-restart, ADSR register sequencing, assembly-level filter routing) is in
[docs/techniques/music-sid.md](../techniques/music-sid.md). This page covers
composition and the pipeline from tracker output to player binary.

The underlying hardware reference is
[docs/hardware/sid-reference.md](../hardware/sid-reference.md).

---

## What a C64 musician actually works in

C64 music is written in a tracker, not a DAW. The three voices of the SID
chip map directly to three independent tracks in the tracker. A tracker
presents notes as sequences of rows in a pattern grid. Each row carries a
pitch, a waveform/instrument command, an ADSR preset number, and optional
effect commands. Patterns are assembled into a song table that sequences
them across the three voice channels.

The musician delivers a player binary: a small piece of 6502 machine code
that, when called at the interrupt rate (usually every raster frame), reads the pattern data compiled from the tracker and writes
the resulting register values to the SID at $D400. The tracker compiles
the composition directly into this binary or into a standalone data block
that the player consumes. The programmer integrates the player binary into
the final demo or game by calling its init address once and its play
address from the raster interrupt handler.

The standard handoff: the musician owns the tracker file, the programmer
owns the integration. The format of the compiled output (SID file, raw
binary at a fixed address, or a relocatable blob) decides how the
programmer receives the music. Both roles need to know which format a
tracker produces and what the player binary requires of the memory
layout.

---

## Tracker landscape

### GoatTracker 2

GoatTracker is the most used modern tracker for C64 music. It runs
on a PC, so musicians need no hardware; its SourceForge project page
(goattracker2, version 2.77) lists Windows and Linux. A macOS build was
not checked here; an earlier version said it runs natively on macOS. The
voice model mirrors the SID exactly: three voice channels, independent pattern sequences per channel,
and a shared instrument table where each instrument defines waveform
tables, ADSR parameters, pulse width sequences, and arpeggio tables.

GoatTracker compiles to SID file format (PSID/RSID), to a raw binary
player at a configurable load address, or to a relocatable module.
The player code is exported with the song; its size is not measured here,
and pattern data size depends on the composition. (An earlier version
named a "GoatTracker Stereo Player" and put the player under 1 KB;
neither is checked.) The player is interrupt-driven
and expects to be called once per frame.

GoatTracker's instrument table supports multi-frame waveform and pulse
sequences: an attack shape is built by stepping through one waveform table
entry per player tick. Composers build the hard-restart attacks heard in
most scene SID music this way. The hard-restart is a GoatTracker convention as much as it is
a hardware technique.

Audience: broad. GoatTracker is used for scene demos, game soundtracks,
standalone SID releases, and chiptune sets.

### CheeseCutter

CheeseCutter puts the work in the pattern editor. GoatTracker has a deep
instrument editor with separate waveform/pulse/arp tables; CheeseCutter has
a more visual pattern editor with in-pattern effect commands. Composers
from the Amiga MOD tracker tradition often find its layout easier.

The voice and pattern model is comparable: three SID voices, pattern-based
sequencing, per-instrument ADSR. CheeseCutter's player is larger than
GoatTracker's; in return, a larger effect command set is available directly
from the pattern grid without a separate instrument editor. Compiled output is a player binary with embedded data.

Audience: scene composers who prefer pattern-centric workflow; also used
by composers coming from other platforms.

### Defmon

Defmon targets the old-school scene revival sound. It is a native tool
that runs on real C64 hardware or in VICE, not a cross-platform editor. The
voice model is standard three-voice SID, but instruments are limited on
purpose to the register-level operations of classic 1980s players. Defmon
music sounds period-authentic because the instrument design does not allow
modern multi-frame table tricks.

Compiled output integrates with the Defmon player binary. The player is
small and well-tested on real hardware. Because the tracker runs natively,
composers hear the hardware directly, not an emulation.

Audience: scene musicians who want hardware authenticity and the old-school
sound more than modern compositional tools.

### JCH NewPlayer

JCH NewPlayer is both a tracker and the player binary it drives. The
player has a long history in the C64 scene and is known for its
efficiency. The tracker is built around NewPlayer's data format, so what
is composed in the tracker is exactly what the player executes.

NewPlayer supports an expanded voice model through its effect system,
including pulse modulation and vibrato as built-in commands. The player
binary is small. Because the tracker is tied to one player, integration is
simple: the musician
delivers the compiled data block, the programmer links the NewPlayer binary
and calls its interface.

Audience: scene musicians who want the NewPlayer sound; some game music
work.

### SID Factory II

SID Factory II is a modern tracker, open-source and cross-platform
(Windows, macOS, Linux). Its README credits main programming to Thomas
Egeskov Petersen, with Jens-Christian Huus, Michel de Bree and Thomas
Jansson (https://github.com/Chordian/sidfactory2; an earlier version
credited Linus Akesson). It is built around a driver model: the music
plays through a driver binary, and different drivers expose different
feature sets. The README says the drivers are by Laxity and JCH; its
changelog names driver 11.05.00 the default and lists what versions
added (11.02: pulse program index, tempo change and main volume commands;
11.03: a filter-enable bit in instruments; 11.04: note delay). A built-in
packer and relocator place the music anywhere in C64 memory.

Driver sizes and the exact export file formats were not checked here. (An
earlier version said the default driver supports multi-frame instrument
tables, filter automation and a controllable gate/hard-restart cycle, that
the standard driver is small, and that it exports to SID and raw binaries;
none of this was checked against the driver sources.)
Its open source suits composers who want to understand or modify the
player rather than treat it as a black box.

Audience: technical composers; scene musicians who want modern tools with
readable internals; contributors to open-source C64 projects.

---

## The voice-3-as-drum dogma

For most of C64 music history, voice 3 has been the percussion voice.
Every SID voice has the noise waveform (`../hardware/sid-reference.md`),
so the hardware does not force drums onto voice 3; this page does not
establish why the convention settled there. Setting a voice to noise, gating it briefly with a fast attack
and fast release, and modulating the filter cutoff around that transient
produces kick and snare approximations. Hi-hat textures come from short
noise bursts with high cutoff frequencies.

What is special about voice 3 is its mute. $D418 (SIGVOL) bit 7, 3OFF,
disconnects voice 3 from the unfiltered output while its oscillator keeps
running. $D417 (RESON) bit 2, FILT3, routes voice 3 through the filter,
and 3OFF does not mute a voice routed there (`../hardware/sid-reference.md`).
With 3OFF set and FILT3 clear, voice 3 can drive ring modulation or sync
on voice 1, or serve as an LFO read from $D41B/$D41C, without being heard.
(An earlier version called these registers FLTX and MOLVOL, put FILT3 at
bit 7, and said players toggle 3OFF around each drum hit; no source here
shows that scheme.)

With voice 3 reserved for drums, the melody has two voices. Classic C64
game music from the 1980s (Rob Hubbard, Martin Galway, Jeroen Tel, Chris
Hülsbeck) worked within this limit. The best of it built full harmony from
arpeggiated chords on voices 1 and 2 with gate-timed rhythm on voice 3.

When to break it: scene productions from the 2000s onward more often use
all three voices for melody and get percussion elsewhere, from a separate
digi voice (see section below), or drop percussion and carry the rhythm in
arpeggiated basslines. A three-voice melodic arrangement without percussion
is an accepted choice in modern scene music. The rule is a convention, not
a hardware constraint. Break it on purpose, not by accident.

---

## Filter as a melodic instrument

The SID's shared analog filter is a single resonant multi-mode unit that
processes whichever voices are routed through it. The filter registers
($D415-$D418) set the cutoff frequency in 11 bits, the resonance level,
the mode (low-pass, band-pass, high-pass, or combinations), and the voice
routing. Because the filter is shared and analog, it acts on the sum of
routed voices rather than per voice, and composers must plan around that.

Driven by the player, the filter becomes a lead instrument. A slow cutoff
sweep on a high-resonance low-pass setting gives the typical SID synth pad
sound. A fast cutoff sweep timed to the note gate gives a filter attack:
the note starts dark and opens to full brightness. A pulsing LFO
pattern on the cutoff register (written by the player once per frame)
produces a wah effect. These techniques are implemented in the player
through cutoff automation tables, which most modern trackers support as
part of the instrument definition.

### The 6581 vs 8580 resonance problem

The original 6581 SID (manufactured through approximately 1986) has
steeper, harsher resonance and a lower effective cutoff range. Its filter
varies widely between individual chips; two
6581s from the same production batch can sound audibly different. The
later 8580 (from approximately 1987) has a more linear filter response,
higher effective cutoff ceiling, and much lower chip-to-chip variation.
The 8580 filter sounds cleaner and more predictable; the 6581 filter is
warmer but harder to control.

A cutoff sweep written for a 6581 sounds different, sometimes very
different, on an 8580, and the reverse. Composers handle this in four ways:

- Target one chip revision explicitly. Scene releases usually state a
  chip preference. A musician writing for a known hardware setup can
  calibrate against that chip and accept degraded quality on the other.

- Maintain two instrument presets. This is slow but complete: tune the
  resonance and cutoff tables separately for 6581 and 8580,
  and switch at integration time based on the target.

- Use modal cutoff curves. Instead of sweeping cutoff over a wide range,
  keep it where the two chips overlap most closely, roughly the midpoint
  of the 11-bit scale, where the audible difference between revisions is
  smallest. Filter movement stays audible without reaching the extremes
  where the chips differ most.

- Accept the difference. Many compositions sound acceptable on both chips
  without compensation, because the filter movement is secondary to the
  melody. Save chip-specific tuning for compositions where the filter is
  the primary voice.

GoatTracker and SID Factory II both let the musician audition work in
emulators with explicit 6581 or 8580 filter models. Test in both before
delivery.

---

## Digi techniques from the music side

Standard three-voice SID music uses only the three synthesis voices. Digi
techniques add a fourth audio stream by misusing the 4-bit master volume
register at $D418 (bits 3-0, MVOL). Writing a rapid sequence of values to
MVOL while the synthesis voices are silent on a given path produces rough
but recognizable sample playback: the D/A converter at the output stage
responds to volume changes quickly enough to reproduce waveforms up to
roughly 8 kHz at 4-bit resolution.

For the musician, adding digi means deciding whether the composition
needs it and what CPU cost is acceptable. Digi playback needs the CPU to
feed the sample stream at a high rate: every few raster lines for 8 kHz
playback. This competes with the raster effects and multiplexers in a
demo. A game soundtrack during active game logic has even less CPU
headroom. Whether digi fits a given scene is agreed with the programmer.

The modern preparation pipeline for digi voices:

1. Record or synthesize the source sound as a WAV at a high sample rate
   (44.1 kHz or 48 kHz) with appropriate processing (gate, compress,
   high-pass filter to reduce DC offset).

2. Downsample to the target digi rate, usually 7.8 kHz or 11 kHz
   (both are common player rates matched to the raster interrupt cadence).

3. Convert to 4-bit unsigned samples. Several open-source tools do this;
   the output is a raw binary blob.

4. Hand the binary to the programmer along with the target sample rate.
   The programmer configures the player's digi interrupt handler to
   consume the blob at the agreed rate.

Digi sample data is large next to the rest of the music data and to
available RAM. A 4-second sample at 7.8 kHz, 4-bit resolution, occupies
approximately 15.6 KB, a large share of the C64's 64 KB address space. So
digi samples are kept short (drum hits, short vocal stabs) rather than
played continuously.

---

## PAL vs NTSC tempo

The C64's system clock runs at 985248 Hz on PAL hardware and 1022727 Hz
on NTSC hardware. The raster interrupt fires every frame: 50 Hz on PAL,
approximately 60 Hz on NTSC. Because most SID players call the play
routine once per frame, the tempo of a composition is measured in frames
per beat — and the absolute tempo in beats per minute differs between PAL
and NTSC even when the frame count is identical.

A composition written at 6 frames per beat plays at about 500 BPM on PAL
(50 / 6 * 60) and about 600 BPM on NTSC (60 / 6 * 60): 120 ms per beat
against 100 ms. The music plays 20% faster on NTSC. (An earlier version
gave 500 BPM for both and called frames per beat a ratio; the frame rates
are 985248 / (63 * 312) = 50.1 Hz and 1022727 / (65 * 263) = 59.8 Hz.)

Players handle the two regions in one of two ways:

- PAL-only assumption. The player assumes 50 Hz and the musician
  calibrates tempo in frames at 50 Hz. On NTSC hardware the music plays
  faster. This is the usual approach in the European scene. Most SID
  files in the HVSC (High Voltage SID Collection) are authored for PAL.
  NTSC users hear them about 20% fast.

- Dual-rate players. Some players detect the hardware region by measuring
  the raster interrupt frequency or by reading CIA timer values against
  a known reference, then select a different frames-per-beat value that
  approximates the intended tempo on each platform. The player carries two
  tempo tables. The compensation is approximate
  because the ratio 60/50 = 1.2 is not an integer; the best attainable
  match is a closest-fraction approximation that may still drift over
  longer compositions.

For musicians: author at PAL (50 Hz). If NTSC compatibility matters, tell
the programmer and ask for a dual-rate player.
The note frequency tables in the player are also region-specific (the
correct SID frequency register value for a given pitch differs between PAL
and NTSC due to the different system clock), so an NTSC-compatible music
build uses NTSC-tuned frequency tables. See
[docs/techniques/music-sid.md](../techniques/music-sid.md) for the
frequency formula and register values.

---

## Modern workflow integration

Some musicians draft in a DAW with SID emulation, then port the
composition into a tracker to produce the final binary. The DAW is quick
for sketching an arrangement, especially for composers from software
production rather than trackers.

SID emulation options used for DAW work:

- reSID is the most accurate software emulation of the 6581/8580. It is
  the audio backend in VICE and several SID player applications. reSID as
  a VST or AU plugin (in various third-party wrappers) puts that SID model
  in a DAW.

- Plogue Chipsounds includes a SID model built for ease of composition
  rather than cycle-accurate emulation. It smooths over some hardware
  quirks so the instrument is more predictable in a DAW. Compositions
  tuned in Chipsounds may behave differently in a real player.

- Hardware: composers with access to a SIDStation synthesizer (which
  contains a real 6581) can route MIDI from the DAW to the SIDStation
  to hear the real chip. SIDStation does not produce C64-
  compatible output directly; it is a studio instrument. Compositions
  developed on SIDStation must be rebuilt in a tracker to produce
  a player binary.

Porting from DAW to tracker is the slow step. No tool directly converts a MIDI arrangement to a GoatTracker or SID Factory II
file with correct instrument definitions. The musician transcribes note
sequences by hand into the tracker, selects instruments that approximate
the DAW sounds, and re-tunes against the tracker's native playback. It
cannot be automated because the tracker format's constraints (three
voices, discrete waveform selection, ADSR as stepped envelopes) do not map
cleanly from DAW plugin parameters.

A common modern setup: compose the high-level arrangement in a DAW with a
reSID VST for tonal reference, export a MIDI render for pitch reference,
open GoatTracker or SID Factory II alongside the MIDI, transcribe
patterns, tune instruments against the target chip version (6581 or
8580 emulation), then hand the compiled binary to the programmer.

Reyn Ouwehand's workflow for later compositions (described in scene
interviews) shows that experienced C64 musicians often stay entirely in
the tracker. DAW-first is more common among composers who started in
software production and came to C64 later.

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
